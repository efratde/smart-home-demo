/* ===================================================================
   garden_id.js — Feature B (GARDEN ID), Pl@ntNet half.
   Self-contained module: photograph a plant → species identification.
   Keeps the net-new external dependency (Pl@ntNet) OUT of garden.js so
   garden.js stays a pure UI/persistence file. The keyless iNaturalist
   "seen near you" half lives in derive.js (Derive.fetchObservations).

   Public API (FIXED by the Feature-B design — do not rename):
     GardenID.identify(fileOrBlob) -> Promise<{latin,common,score,raw}|null>
     GardenID.hasKey()             -> bool
     GardenID.setKey(k)            -> persists localStorage 'home_plantnet_key'
     GardenID.promptKey()          -> prompt() once, persist; returns key|null
     GardenID.downscale(file,maxPx=1024) -> Promise<{blob,dataUrl}>

   GRACEFUL NO-KEY: hasKey() gates the flow; nothing throws without a key.
   Pure browser fetch + canvas. No <script> deps beyond being loaded.
   Idempotency-guarded (garden.js:13 pattern), window export (weather.js:342).

   NOTE: a real keyed identify round-trip is DEFERRED / unverified here —
   the code path exists with a graceful no-key/offline/quota/401 fallback.
   =================================================================== */
(function(){
  if(window.GardenID) return;            // idempotency guard (garden.js:13)

  const KEYK = 'home_plantnet_key';      // localStorage key for the Pl@ntNet API key
  const ENDPOINT = 'https://my-api.plantnet.org/v2/identify/all';
  let _promptedThisSession = false;      // never nag more than once per page load

  /* ---------------- key management ---------------- */

  // Safe localStorage read (private-mode / quota / disabled storage → null).
  function lsGet(k){
    try { return localStorage.getItem(k); } catch(_){ return null; }
  }
  function lsSet(k, v){
    try { localStorage.setItem(k, v); return true; } catch(_){ return false; }
  }

  function getKey(){
    const k = lsGet(KEYK);
    return (k && String(k).trim()) ? String(k).trim() : null;
  }

  function hasKey(){ return getKey() != null; }

  // Persist a key. Empty/blank clears it. Returns the stored key (or null).
  function setKey(k){
    const v = (k == null) ? '' : String(k).trim();
    if(!v){ try { localStorage.removeItem(KEYK); } catch(_){} return null; }
    lsSet(KEYK, v);
    return v;
  }

  // One-time prompt() for a free Pl@ntNet key. Returns the key, or null if the
  // user cancels / has no prompt available. Only ever asks once per page load
  // so a repeated tap doesn't re-nag (cancel = skip cleanly, no crash).
  function promptKey(){
    const existing = getKey();
    if(existing) return existing;
    if(_promptedThisSession) return null;
    _promptedThisSession = true;
    let ans = null;
    try {
      ans = window.prompt(
        'Paste a free Pl@ntNet key to identify plants (my.plantnet.org).\n' +
        'You can cancel — identification will simply be skipped.',
        ''
      );
    } catch(_){ ans = null; }   // no prompt() in this environment
    if(ans == null) return null; // user cancelled
    const v = String(ans).trim();
    if(!v) return null;
    return setKey(v);
  }

  /* ---------------- image downscale (canvas) ---------------- */

  // Load a File/Blob into an <img>, resize so the longest edge <= maxPx, and
  // return {blob, dataUrl} as JPEG. Keeps base64 thumbnails small enough for
  // the ~5MB localStorage budget. Resolves null on any decode/encode failure.
  function downscale(file, maxPx){
    maxPx = maxPx || 1024;
    return new Promise(function(resolve){
      if(!file){ resolve(null); return; }
      let url = null;
      try { url = URL.createObjectURL(file); } catch(_){ url = null; }
      if(!url){ resolve(null); return; }

      const img = new Image();
      img.onload = function(){
        try {
          const w0 = img.naturalWidth  || img.width;
          const h0 = img.naturalHeight || img.height;
          if(!w0 || !h0){ try{ URL.revokeObjectURL(url); }catch(_){}; resolve(null); return; }
          const scale = Math.min(1, maxPx / Math.max(w0, h0));
          const w = Math.max(1, Math.round(w0 * scale));
          const h = Math.max(1, Math.round(h0 * scale));

          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          try { URL.revokeObjectURL(url); } catch(_){}

          const dataUrl = cv.toDataURL('image/jpeg', 0.82);
          cv.toBlob(function(blob){
            // toBlob can yield null on some browsers; fall back to dataURL→Blob.
            if(blob){ resolve({ blob: blob, dataUrl: dataUrl }); return; }
            resolve({ blob: dataUrlToBlob(dataUrl), dataUrl: dataUrl });
          }, 'image/jpeg', 0.82);
        } catch(_){
          try { URL.revokeObjectURL(url); } catch(__){}
          resolve(null);
        }
      };
      img.onerror = function(){
        try { URL.revokeObjectURL(url); } catch(_){}
        resolve(null);
      };
      img.src = url;
    });
  }

  // dataURL → Blob (fallback when canvas.toBlob is unavailable).
  function dataUrlToBlob(dataUrl){
    try {
      const parts = String(dataUrl).split(',');
      const mime = (parts[0].match(/:(.*?);/) || [,'image/jpeg'])[1];
      const bin = atob(parts[1]);
      const len = bin.length;
      const arr = new Uint8Array(len);
      for(let i=0;i<len;i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    } catch(_){ return null; }
  }

  /* ---------------- Pl@ntNet identify ---------------- */

  // identify(fileOrBlob) -> Promise<{latin,common,score,raw}|null>
  // No key → resolves null (caller gates with hasKey()/promptKey() first).
  // Any network/quota/401/parse failure → null (never throws).
  async function identify(fileOrBlob){
    try {
      const key = getKey();
      if(!key) return null;                 // graceful no-key: nothing to do
      if(!fileOrBlob) return null;

      const fd = new FormData();
      // Pl@ntNet expects the image part named 'images' and a matching 'organs'.
      fd.append('images', fileOrBlob, 'photo.jpg');
      fd.append('organs', 'auto');

      const url = ENDPOINT
        + '?api-key=' + encodeURIComponent(key)
        + '&lang=en&nb-results=3';

      const res = await fetch(url, { method: 'POST', body: fd });
      if(!res || !res.ok) return null;      // 401 / quota / 4xx / 5xx → null

      const data = await res.json();
      const results = data && data.results;
      if(!Array.isArray(results) || !results.length) return null;

      const top = results[0] || {};
      const sp = top.species || {};
      const latin = sp.scientificNameWithoutAuthor || sp.scientificName || null;
      const common = (Array.isArray(sp.commonNames) && sp.commonNames.length)
        ? sp.commonNames[0] : null;
      const score = (typeof top.score === 'number') ? Math.round(top.score * 100) : null;

      if(!latin && !common) return null;    // nothing usable

      return { latin: latin, common: common, score: score, raw: data };
    } catch(_){
      return null;                          // offline / quota / 401 / parse → null
    }
  }

  /* ---------------- export (weather.js:342 pattern) ---------------- */
  const GardenID = {
    identify: identify,
    hasKey: hasKey,
    setKey: setKey,
    promptKey: promptKey,
    downscale: downscale
  };
  window.GardenID = GardenID;
})();
