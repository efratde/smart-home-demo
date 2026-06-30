/* ===================================================================
   cloud_sync.js — a tiny, fully-defensive CLOUD-SYNC layer for the
   smart-home demo app. The app is a NO-BACKEND static site (Cloudflare Pages)
   that stores everything in localStorage under the 'home_' prefix
   (LogStore collections, the workbench DOC, per-module keys, the v2
   drag positions, …). This module mirrors those keys through a single
   same-origin endpoint (/api/state, a KV-backed Pages Function) so:
     • the recipient's edits persist beyond one device, and
     • the giver (the developer) sees them by opening the same link.

   DESIGN — last-write-wins by timestamp, ADD/UPDATE only:
     Synced doc shape:  { state:{ home_*:value,… }, ts:<number>, by:<deviceId> }
     • collect()  → every home_* localStorage entry, as {key:value}.
     • On LOAD and on a ~20s POLL we GET /api/state → applyIfNewer.
     • A wrapped localStorage.setItem schedules a DEBOUNCED (~2.5s)
       push() whenever an home_* key is written, so a burst of edits
       coalesces into ONE PUT.
     • push() PUTs {state:collect(), ts:Date.now(), by:deviceId} and
       remembers the pushed blob so we never re-PUT an identical doc.

   SAFETY (this module must NEVER throw and NEVER lose local data):
     • applyIfNewer only ADDS/UPDATES keys present in the cloud doc; it
       NEVER removes a local home_* key that's missing from the cloud.
     • a 503 'sync-not-configured' (no KV bound) OR any fetch error →
       status='disabled' and we STOP: the app runs fully local-only,
       no crash, no console spam, no retry storm.

   LOOP-GUARD (why applying a remote doc can't cause an endless reload):
     applyIfNewer reloads the page to re-render the app with the pulled
     state. To stop a reload→pull→reload loop we use TWO gates:
       1) by !== our own deviceId  → we ignore the echo of our OWN push.
       2) doc.ts MUST be strictly > the last-applied ts, which we persist
          in sessionStorage 'home_sync_applied_ts' (default 0) BEFORE the
          reload. After the reload the guard already holds that ts, so the
          SAME doc.ts is no longer "newer" → applyIfNewer is a no-op → no
          second reload. A genuinely newer remote edit (a bigger ts) still
          gets through exactly once. sessionStorage (not localStorage) so a
          brand-new tab re-pulls the latest cloud state on its first load.

   Exposes: window.__cloudSync = { pull(), push(), status() }.
   =================================================================== */
(function(){
  'use strict';
  if(window.__cloudSync) return;                 // idempotency guard (house pattern)

  var PREFIX        = 'home_';                    // every app namespace is home_*
  var API           = '/api/state';               // same-origin Pages Function
  var DEVICE_KEY    = 'home_sync_device';         // our random id (persisted, local)
  var APPLIED_TS    = 'home_sync_applied_ts';     // loop-guard ts (sessionStorage)
  var PUSH_DEBOUNCE = 2500;                        // ms — coalesce a burst of edits
  var POLL_EVERY    = 20000;                       // ms — see the other side's writes

  /* ---- defensive primitives: every storage/parse op is try/caught so a
     quirky private-mode / quota / serialization error can NEVER throw out
     of this module and break the host app. ---- */
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsLen(){  try{ return localStorage.length||0; }catch(e){ return 0; } }
  function lsKeyAt(i){ try{ return localStorage.key(i); }catch(e){ return null; } }
  function ssGet(k){ try{ return sessionStorage.getItem(k); }catch(e){ return null; } }
  function ssSet(k,v){ try{ sessionStorage.setItem(k, v); }catch(e){} }
  function isAlex(k){ return typeof k==='string' && k.indexOf(PREFIX)===0; }

  /* the REAL setItem, captured before we wrap it, so push/apply write
     through WITHOUT re-triggering our own change detector (no feedback). */
  var rawSetItem = (function(){
    try { return localStorage.setItem.bind(localStorage); }
    catch(e){ return function(){}; }
  })();

  /* device id — random, persisted in localStorage so it survives reloads
     and identifies THIS browser as the author of its pushes. */
  function getDeviceId(){
    var id = lsGet(DEVICE_KEY);
    if(!id){
      id = 'd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,10);
      try { rawSetItem(DEVICE_KEY, id); } catch(e){}
    }
    return id;
  }
  var deviceId = getDeviceId();

  /* the loop-guard ts: the highest doc.ts we've already applied. Persisted
     in sessionStorage so it survives the applyIfNewer→reload but resets per
     tab/session (a fresh tab should re-pull the newest cloud doc once). */
  function appliedTs(){
    var n = parseInt(ssGet(APPLIED_TS), 10);
    return isFinite(n) ? n : 0;
  }

  var state  = 'init';        // init → ok | disabled
  var lastPushedBlob = null;  // the exact body of our last PUT (skip identical re-pushes)
  var pushTimer = null;       // debounce handle

  /* collect() → a plain object of every home_* localStorage entry. This is
     the 'state' field of the synced doc. (Never includes our deviceId key?
     It does — home_sync_device IS home_*, but it's harmless to sync and the
     loop-guard relies on doc.by, not on the key, so we keep the scan simple
     and inclusive.) */
  function collect(){
    var out = {};
    var n = lsLen();
    for(var i=0;i<n;i++){
      var k = lsKeyAt(i);
      if(isAlex(k)){
        var v = lsGet(k);
        if(v != null) out[k] = v;
      }
    }
    return out;
  }

  /* deep-ish compare: does the cloud doc.state differ from what we hold
     locally for the keys the cloud knows about? (ADD/UPDATE semantics —
     we only care whether applying would CHANGE anything.) */
  function differsFromLocal(cloudState){
    for(var k in cloudState){
      if(!Object.prototype.hasOwnProperty.call(cloudState, k)) continue;
      if(!isAlex(k)) continue;                 // never apply a non-alex key
      if(lsGet(k) !== cloudState[k]) return true;
    }
    return false;
  }

  /* applyIfNewer(doc) — the heart of the merge + loop-guard.
     Returns true iff it applied & is reloading. Conditions, ALL required:
       • doc is an object with a numeric ts and an object state,
       • doc.ts > our applied-ts guard       (newer than what we've seen),
       • doc.by !== our deviceId             (not the echo of our own push),
       • the state actually differs locally  (avoid a no-op reload).
     Then: ADD/UPDATE each home_* key (NEVER remove a local key absent from
     the doc), advance the guard to doc.ts, and reload ONCE. */
  function applyIfNewer(doc){
    try{
      if(!doc || typeof doc !== 'object') return false;
      var ts = doc.ts;
      if(typeof ts !== 'number' || !isFinite(ts)) return false;
      if(ts <= appliedTs()) return false;            // loop-guard gate #2 (ts)
      if(doc.by === deviceId) return false;          // loop-guard gate #1 (own echo)
      var st = doc.state;
      if(!st || typeof st !== 'object') return false;
      if(!differsFromLocal(st)) {                    // nothing new → just advance guard
        ssSet(APPLIED_TS, String(ts));
        return false;
      }
      // ADD/UPDATE only — we never removeItem a local home_ key missing here.
      for(var k in st){
        if(!Object.prototype.hasOwnProperty.call(st, k)) continue;
        if(!isAlex(k)) continue;                     // ignore any non-alex key in the doc
        var v = st[k];
        if(typeof v !== 'string') continue;          // localStorage values are strings
        try { rawSetItem(k, v); } catch(e){}
      }
      ssSet(APPLIED_TS, String(ts));                 // advance the guard BEFORE reload
      try { location.reload(); } catch(e){}          // re-render the app with pulled state
      return true;
    } catch(e){ return false; }
  }

  /* once we hit a 503/'sync-not-configured' or any fetch failure we DISABLE
     and stop all activity — the app is fully usable local-only. */
  function disable(){
    state = 'disabled';
    if(pushTimer){ try{ clearTimeout(pushTimer); }catch(e){} pushTimer = null; }
  }

  /* pull() — GET the cloud doc and applyIfNewer. Any non-OK / 503 / network
     error disables sync. Safe to call manually via window.__cloudSync.pull(). */
  function pull(){
    if(state === 'disabled') return Promise.resolve(false);
    return fetch(API, { method:'GET', headers:{ 'Accept':'application/json' } })
      .then(function(res){
        if(!res) { disable(); return false; }
        if(res.status === 503){ disable(); return false; }   // sync-not-configured
        if(!res.ok){ disable(); return false; }
        return res.text().then(function(txt){
          var doc = null;
          try { doc = JSON.parse(txt || '{}'); } catch(e){ doc = null; }
          if(state !== 'disabled') state = 'ok';
          return applyIfNewer(doc);
        });
      })
      .catch(function(){ disable(); return false; });
  }

  /* push() — PUT the current local home_* state as a fresh doc. We stamp a
     NEW ts and our deviceId, advance our OWN guard to that ts (so the echo of
     this very push can never reload us), and remember the blob to skip an
     identical re-push. Any failure disables sync. */
  function push(){
    if(state === 'disabled') return Promise.resolve(false);
    var ts  = Date.now();
    var doc = { state: collect(), ts: ts, by: deviceId };
    var body;
    try { body = JSON.stringify(doc); }
    catch(e){ return Promise.resolve(false); }      // serialization failure → skip, never throw

    // skip a byte-identical re-push (the state field unchanged since last PUT).
    if(lastPushedBlob != null){
      try {
        var prev = JSON.parse(lastPushedBlob);
        if(JSON.stringify(prev.state) === JSON.stringify(doc.state)) {
          return Promise.resolve(false);
        }
      } catch(e){ /* fall through and push */ }
    }

    // our own write should never trigger our own reload: advance the guard.
    if(ts > appliedTs()) ssSet(APPLIED_TS, String(ts));

    return fetch(API, {
      method:'PUT',
      headers:{ 'Content-Type':'application/json' },
      body: body
    })
    .then(function(res){
      if(!res || res.status === 503 || !res.ok){ disable(); return false; }
      lastPushedBlob = body;
      if(state !== 'disabled') state = 'ok';
      return true;
    })
    .catch(function(){ disable(); return false; });
  }

  /* DEBOUNCED change detector: wrap localStorage.setItem so any home_* write
     (anywhere in the app) schedules a single push() ~2.5s later. A burst of
     edits collapses into one PUT. The wrapper NEVER swallows the original
     write's behaviour or errors — it calls through first, then schedules. */
  function schedulePush(){
    if(state === 'disabled') return;
    if(pushTimer){ try{ clearTimeout(pushTimer); }catch(e){} }
    pushTimer = setTimeout(function(){
      pushTimer = null;
      push();
    }, PUSH_DEBOUNCE);
  }

  (function wrapSetItem(){
    try{
      var orig = localStorage.setItem;
      if(typeof orig !== 'function' || orig.__homeSyncWrapped) return;
      var wrapped = function(k, v){
        var r = orig.apply(this, arguments);     // do the REAL write first
        try { if(isAlex(k)) schedulePush(); } catch(e){}
        return r;
      };
      wrapped.__homeSyncWrapped = true;
      localStorage.setItem = wrapped;
    } catch(e){ /* if we can't wrap, sync still works via poll/manual push */ }
  })();

  /* status() — for diagnostics / window.__cloudSync.status() */
  function status(){
    return { state: state, deviceId: deviceId, appliedTs: appliedTs() };
  }

  /* ---- boot: pull once on load, then poll. Each step is independently
     guarded; a disabled state short-circuits everything. ---- */
  function boot(){
    pull();
    try {
      setInterval(function(){ if(state !== 'disabled') pull(); }, POLL_EVERY);
    } catch(e){}
  }

  window.__cloudSync = { pull: pull, push: push, status: status };

  boot();
})();
