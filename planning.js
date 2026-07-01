/* ===================================================================
   planning.js — "what may be built on the plot".
   A live, NO-BACKEND lookup of the OFFICIAL planning that governs Alex's
   lot, served from a public planning registry — the same kind of GIS the
   official planning viewers read. In this demo build no external registry
   endpoint is contacted; the lookup resolves a clean offline result.

   HONESTY: we surface WHICH plans govern the plot + a link to each plan's
   official page (planUrl). The detailed building-rights numbers (height,
   coverage, setbacks, far) live in those plan documents — NOT in the GIS
   attributes — so we link to them and never fabricate numbers here. The GIS
   *does* return a few genuinely plot-specific bits we now also surface (each
   plan's stated PURPOSE, its registered area, approved dwelling-units
   where non-zero) — clearly labelled plot-specific vs. the generic planning
   rules that come from the static plot_rights.json reference.

   Pattern mirrors weather.js: a const-IIFE exposing window.Planning with
   load()/get(). Defensive throughout — never throws; on failure or zero
   results it resolves a clean {plans:[],landUse:[],error} so the workbench
   can render an honest "couldn't load" state. Result cached in localStorage
   with a ~30-day TTL (planning changes rarely).

   ENRICHMENT API (additive — load()/get() keep their exact old shape):
     Planning.rights() → Promise resolving the static plot_rights.json
       reference (concrete renovation/extension possibilities + the
       exemption list + official links), or null if it can't be fetched. Cached
       in-memory. NEVER throws.
     Planning.getRights() → the in-memory rights object or null (sync).
   =================================================================== */
const Planning = (function(){
  'use strict';
  // Alex's house (Larkmont). geometry is "lon,lat" (sr=4326) per the registry API.
  const LON=-40.0, LAT=34.0;
  const ENDPOINT='';   // demo build: the live planning-registry endpoint is intentionally not wired
  const CACHE_KEY='home_planning_v1';
  const TTL_MS=30*24*60*60*1000;          // ~30 days
  const PLAN_LAYER='Building plans layer';            // layerName carrying the governing plans
  const LANDUSE_LAYER='Land designation';                 // layerName carrying land designation
  // layerId FALLBACK — confirmed from the live identify response: plans=1, land-use=4.
  // Name match stays primary; matching by id too means a future layer-RENAME on the
  // registry side won't silently drop the data (the numeric layer ids are stable).
  const PLAN_LAYER_ID=1;
  const LANDUSE_LAYER_ID=4;
  // plan-registry placeholder code/name for "the plan does not apply here" — not a real
  // designation, so we suppress it rather than surface a misleading land-use.
  const LANDUSE_NOISE=/does not apply|not applicable/;

  let data=null;        // the in-memory parsed object (mirrors the cache)
  let inflight=null;    // de-dupe concurrent load() calls

  // attribute reader tolerant of small key/encoding variants in the (Hebrew) API field names.
  function attr(a,keys){
    if(!a) return '';
    for(const k of keys){ const v=a[k]; if(v!=null && v!=='' && v!=='Null') return String(v); }
    return '';
  }

  // The registry plan-purpose field is plot-specific and useful — but it
  // is prefixed with the plan name and uses ' ^ ' as a soft separator, and the
  // GIS truncates long text mid-word. Clean it into a short, honest one-liner:
  // strip the leading echo of the plan name, collapse separators/whitespace,
  // and mark a clearly-truncated tail so we never present a cut-off word as a
  // complete sentence. Returns '' when there's no real purpose text.
  function cleanPurpose(raw,planName){
    let s=String(raw||'').replace(/\r/g,' ').replace(/\^/g,' ').replace(/\s+/g,' ').trim();
    if(!s) return '';
    const nm=String(planName||'').trim();
    if(nm && s.indexOf(nm)===0) s=s.slice(nm.length).replace(/^[\s.,;:–-]+/,'').trim();
    if(!s) return '';
    // a tail with no terminal punctuation that ends mid-clause is likely truncated
    // by the GIS — flag it so the card can show a "…" + a read-at-source nudge.
    const truncated = !/[.!?…)\]]\s*$/.test(s) && s.length>40;
    if(truncated) s=s.replace(/[\s,;:–-]+$/,'')+'…';
    return s;
  }

  // a positive integer from a numeric-ish attribute, else 0 (so '0' / '' / noise
  // all read as "nothing approved" — we only surface a count when it's real).
  function posInt(v){ const n=parseInt(String(v||'').replace(/[^\d-]/g,''),10); return (isFinite(n)&&n>0)?n:0; }
  // a positive number (plan areas can be fractional), else 0.
  function posNum(v){ const n=parseFloat(String(v||'').replace(/[^\d.\-]/g,'')); return (isFinite(n)&&n>0)?n:0; }

  function buildUrl(){
    const p=new URLSearchParams({
      geometry: LON+','+LAT,
      geometryType:'esriGeometryPoint',
      sr:'4326',
      tolerance:'3',
      mapExtent:'-40.02,33.98,-39.98,34.02',
      imageDisplay:'700,700,96',
      layers:'all',
      returnGeometry:'false',
      f:'json'
    });
    return ENDPOINT+'?'+p.toString();
  }

  // results[] → { plans:[{name,number,subtype,status,planUrl}], landUse:[strings] }
  function parse(results){
    const plans=[], byNum=Object.create(null), landUse=[], seenLU=Object.create(null);
    (results||[]).forEach(r=>{
      const ln=r&&r.layerName, lid=r&&r.layerId, a=(r&&r.attributes)||{};
      if(ln===PLAN_LAYER || lid===PLAN_LAYER_ID){
        const number=attr(a,['plan number','plan no']);
        const name=attr(a,['plan name']);
        const planUrl=attr(a,['plan link']);
        const subtype=attr(a,['plan subtype','plan sub-type']);
        const status=attr(a,['status description','status']);
        if(!name && !number) return;        // nothing identifying → skip
        const key=number||name;
        if(byNum[key]) return;              // DEDUPE by plan number (then name)
        // PLOT-SPECIFIC enrichments straight from this plan's GIS attributes —
        // additive fields; the old {name,number,subtype,status,planUrl} are intact.
        const purpose=cleanPurpose(attr(a,['objectives']),name);     // what the plan is FOR (plot-specific)
        const areaReg=posNum(attr(a,['registered plan area'])); // registered plan area (its scope)
        const homesApproved=posInt(attr(a,['residential approved dwelling units'])); // approved dwelling units (0 → omitted)
        const updated=attr(a,['last update date']);
        const plan={name,number,subtype,status,planUrl,purpose,areaReg,homesApproved,updated};
        byNum[key]=plan; plans.push(plan);
      } else if(ln===LANDUSE_LAYER || lid===LANDUSE_LAYER_ID){
        const lu=attr(a,['land designation name','land use name','land use','land designation']);
        if(lu && !LANDUSE_NOISE.test(lu) && !seenLU[lu]){ seenLU[lu]=1; landUse.push(lu); }
      }
    });
    return { plans, landUse };
  }

  function readCache(){
    try{
      const raw=JSON.parse(localStorage.getItem(CACHE_KEY));
      if(raw && typeof raw==='object' && Array.isArray(raw.plans)) return raw;
    }catch(e){}
    return null;
  }
  function writeCache(obj){ try{ localStorage.setItem(CACHE_KEY,JSON.stringify(obj)); }catch(e){} }
  function fresh(obj){ return !!(obj && obj.fetchedAt && (Date.now()-obj.fetchedAt)<TTL_MS); }

  // load() → Promise resolving to the parsed object. Uses a fresh cache when
  // available; otherwise resolves a clean offline result. NEVER throws and
  // NEVER contacts an external endpoint in this demo build — the workbench
  // renders an honest "no online plan" state from the resolved {plans:[],...}.
  // (parse()/buildUrl() remain for reference but are not invoked at runtime.)
  function load(){
    const cached=readCache();
    if(fresh(cached)){ data=cached; return Promise.resolve(cached); }
    const out={ plans:[], landUse:[], error:'no-results', fetchedAt:Date.now() };
    data=out; writeCache(out);
    return Promise.resolve(out);
  }

  // get() → the cached/in-memory parsed object, or null if nothing loaded yet.
  function get(){ if(data) return data; const c=readCache(); if(c){ data=c; return c; } return null; }

  /* ---- static plot-rights reference (concrete renovation possibilities + the
     exemption list + official links). This is the GENERIC-rules layer,
     loaded from app/data/plot_rights.json once and cached in-memory. Separate
     from the live registry lookup on purpose: the card pairs the two so the reader
     sees plot-specific facts (from the registry) next to the general pathways (here),
     each clearly labelled. NEVER throws; resolves null if it can't be read. */
  const RIGHTS_URL='data/plot_rights.json';
  let rights=null, rightsInflight=null;
  function loadRights(){
    if(rights) return Promise.resolve(rights);
    if(rightsInflight) return rightsInflight;
    if(typeof fetch!=='function') return Promise.resolve(null);
    rightsInflight=(async()=>{
      try{
        const r=await fetch(RIGHTS_URL);
        if(!r||!r.ok) throw new Error('http '+(r&&r.status));
        const j=await r.json();
        rights=(j && typeof j==='object')?j:null;
        return rights;
      }catch(e){ return null; }
      finally{ rightsInflight=null; }
    })();
    return rightsInflight;
  }
  function getRights(){ return rights; }

  return { load, get, rights:loadRights, getRights };
})();
// idempotency guard: don't clobber an already-installed Planning (re-injection safe).
if(typeof window!=='undefined' && !window.Planning) window.Planning=Planning;
