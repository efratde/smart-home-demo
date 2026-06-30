/* ===================================================================
   log_store.js — window.LogStore: the "second brain" persistence layer
   (Feature C). A per-collection localStorage CRUD store for Alex's
   personal-knowledge collections. Pure data: NO DOM, NO intervals, no
   network — so it can load anywhere after panels.js (no deps).

   Reuses the EXACT LS/save idiom from panels.js (JSON array, []-default
   on parse error, fire-and-forget try/catch write). Each collection is
   backed by its own versioned key 'home_log_<coll>_v1'.

   SHARED-KEY REUSE (no duplication): the collections 'readings' and
   'sightings' map onto the EXISTING panels.js stores 'home_read' and
   'home_obs' via KEYMAP, so the אנרגיה meter-reading UI and the טבע
   observation UI and the new מוח tab all read/write one shared store.
   add() spreads caller fields AFTER the {t,d} stamps, so existing record
   shapes ({k,v,d} for readings, {t,d} for observations) are preserved
   bit-for-bit while still gaining an id.
   =================================================================== */
(function(){
  if(window.LogStore) return;            // idempotency guard (house pattern)

  /* the panels.js LS/save idiom, verbatim: array store, []-default on
     parse error, fire-and-forget try/catch write (never break a caller). */
  const LS  = k => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch(e){ return []; } };
  const save = (k,v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} };

  /* the personal-knowledge collections (Feature C #17-33). The trailing
     'airbnb','work','invoices' back the host/work/invoicing log UIs; they get
     their own 'home_log_<coll>_v1' keys (no KEYMAP entry → fresh stores).
     'app_feedback' (feedback.js) + 'materials' (materials_hub.js) are also
     LogStore collections — listed here so the manual גיבוי export (all())
     picks them up like every other store, not just cloud-sync. */
  const COLLS = ['sightings','plantcond','projects','lending','readings','visitors','neighbors','schedule','airbnb','work','invoices','app_feedback','materials'];

  /* collections that carry a `due` ISO date so alerts.js can scan them. */
  const DUE_COLLS = { schedule:1, lending:1, airbnb:1, invoices:1 };

  /* share the EXISTING panels.js stores instead of creating duplicates.
     Everything else gets its own 'home_log_<coll>_v1' key. */
  const KEYMAP = { readings:'home_read', sightings:'home_obs' };
  const keyFor = coll => KEYMAP[coll] || ('home_log_' + coll + '_v1');

  const isoNow   = () => new Date().toISOString();
  const heToday  = () => new Date().toLocaleDateString('he-IL');   // panels.js display idiom
  const newId    = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

  /* optional per-record PHOTO support (#19/#27). A record may carry a `photo`
     string = a downscaled image dataURL (the מוח add-form downscales to ~800px
     JPEG before calling add()). To keep the ~5MB localStorage budget sane we
     CAP a single stored photo string; anything larger (an un-downscaled paste)
     is dropped rather than risking a QuotaExceededError that would lose the
     whole collection. ~280KB of base64 ≈ a ~200KB JPEG — ample for an 800px
     thumbnail, still small enough to keep dozens of them. */
  const PHOTO_CAP = 280000;
  function sanitizePhoto(p){
    if(typeof p !== 'string' || !p) return null;
    // only keep an actual image dataURL, and only if it's within the cap.
    if(!/^data:image\//.test(p)) return null;
    if(p.length > PHOTO_CAP) return null;
    return p;
  }

  /* ---- reads ---- */
  function list(coll){ return LS(keyFor(coll)); }

  function all(){
    const out = {};
    COLLS.forEach(c => { out[c] = list(c); });
    return out;
  }

  /* ---- writes ---- */
  function add(coll, rec){
    rec = rec || {};
    const a = list(coll);
    /* stamp {id, t:ISO, d:he-IL}; caller fields spread LAST so they win
       (preserves existing {t:<text>,d}/{k,v,d} shapes on the shared keys
       while still attaching an id + a `d` fallback). */
    const out = {
      id: newId(),
      t : isoNow(),
      d : heToday(),
      ...rec
    };
    /* due ISO date for the date-scanned collections (alerts.js reads it).
       Honour a caller-supplied `due` if present; otherwise leave it set
       only when the caller actually passed one (we never invent a date). */
    if(DUE_COLLS[coll] && rec.due != null) out.due = rec.due;
    /* optional photo: keep only a valid, capped image dataURL — otherwise drop
       it entirely so a stray oversized string can't break the store write. */
    if(rec.photo != null){
      const ph = sanitizePhoto(rec.photo);
      if(ph) out.photo = ph; else delete out.photo;
    }
    a.unshift(out);                       // newest-first, like the panels.js lists
    save(keyFor(coll), a);
    return out;
  }

  function update(coll, id, patch){
    const a = list(coll);
    let hit = null;
    for(let i=0;i<a.length;i++){
      if(a[i] && a[i].id === id){
        const p = { ...(patch||{}) };
        /* a patched photo gets the same validate-or-drop treatment as add(). */
        if('photo' in p){ const ph = sanitizePhoto(p.photo); if(ph) p.photo = ph; else delete p.photo; }
        a[i] = { ...a[i], ...p, id: a[i].id };             // never let a patch clobber id
        hit = a[i];
        break;
      }
    }
    if(hit) save(keyFor(coll), a);
    return hit;
  }

  function remove(coll, id){
    const a = list(coll);
    const next = a.filter(r => !(r && r.id === id));
    const changed = next.length !== a.length;
    if(changed) save(keyFor(coll), next);
    return changed;
  }

  /* ---- date scan for alerts.js ----
     upcoming(coll, withinDays): records in `coll` whose `due` ISO date is
     between now and now+withinDays (inclusive). Skips records with no/invalid
     due. Used by the rules engine for maintenance / pet-food / lending-return
     reminders. Pure read — no mutation. */
  function upcoming(coll, withinDays){
    const days = (withinDays==null) ? 2 : +withinDays;
    const now  = Date.now();
    const horizon = now + days * 86400000;
    return list(coll).filter(r => {
      if(!r || r.due == null) return false;
      const t = Date.parse(r.due);
      return isFinite(t) && t >= now && t <= horizon;
    });
  }

  const LogStore = { list, add, update, remove, all, upcoming, COLLS, keyFor, sanitizePhoto, PHOTO_CAP };
  window.LogStore = LogStore;
})();
