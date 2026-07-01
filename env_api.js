/* ===================================================================
   env_api.js — the LIVE ENVIRONMENT layer (Feature A). window.EnvAPI.
   Loads in index.html AFTER weather.js and BEFORE app.js. It does NOT
   replace Weather.fetchAir (that stays the keyless Open-Meteo default for
   the 3D dust). EnvAPI adds the POLLEN layer + the single dust→0..1 mapping
   reused by the scene/alerts, and an OPTIONAL Google-key accuracy upgrade.

   Default path = keyless Open-Meteo (the air-quality endpoint also exposes
   alder/birch/grass/mugwort/olive/ragweed *_pollen, same host as fetchAir,
   no key, CORS-ok — verified live at 34.00/-40.00). A Google Cloud key
   (localStorage 'home_env_keys_v1'.googleKey) is an opt-in upgrade and
   degrades to a graceful no-op when absent.

   Aggressive ~3h cache (localStorage 'home_env_cache_v1', single-doc +
   mergeDefaults, fire-and-forget) so a reload/tab-switch inside the TTL
   does NOT re-hit any API. Never throws — every fetch is try/catch→null,
   matching the weather.js fire-and-forget house pattern.

   FIXED public interface (parallel agents rely on these EXACT names):
     EnvAPI.pollen = {grass,tree,weed,olive,ragweed,mugwort,index,time,tz,hourly[]}
     EnvAPI.pollenAt(date) -> the same shape for the hour containing `date`
     EnvAPI.dustIntensity() -> 0..1 from pm10 / desert dust
     EnvAPI.refresh()       -> Promise; network-hits ONLY when cache is stale
     EnvAPI.fetchGoogleAir() / EnvAPI.fetchGooglePollen() -> no-op w/o key
     EnvAPI.hasKey()        -> bool (a Google key is present)
   =================================================================== */
const EnvAPI = (function(){
  if(window.EnvAPI) return window.EnvAPI;          // idempotency guard (house pattern)

  const LAT=34.00, LON=-40.00;
  const CACHE_KEY='home_env_cache_v1';
  const KEYS_KEY ='home_env_keys_v1';
  const TTL_MS   = 3*60*60*1000;                   // ~3h: air + pollen update hourly at most
  const SEASON_URL='data/pollen_seasonal.json';

  const clamp01=v=>Math.max(0,Math.min(1, v==null?0:v));
  const num=v=>(typeof v==='number'&&isFinite(v))?v:null;
  const maxN=(...a)=>{ let m=null; a.forEach(v=>{ v=num(v); if(v!=null&&(m==null||v>m)) m=v; }); return m; };

  /* ----------------------------------------------------------------
     Baked-in seasonal fallback (file:///offline) — mirrors the JSON in
     data/pollen_seasonal.json so the allergen card is NEVER blank
     even double-clicked locally where fetch('data/...') fails. Garden.js
     CATALOG_FALLBACK pattern: a tiny in-file default object.
     month(1..12) -> {grass,tree,weed,olive,ragweed,mugwort} level 0..4.
  ---------------------------------------------------------------- */
  const SEASON_FALLBACK={
    "1":{grass:0,tree:1,weed:0,olive:0,ragweed:0,mugwort:0},
    "2":{grass:1,tree:2,weed:0,olive:1,ragweed:0,mugwort:0},
    "3":{grass:2,tree:3,weed:0,olive:2,ragweed:0,mugwort:0},
    "4":{grass:3,tree:3,weed:0,olive:3,ragweed:0,mugwort:0},
    "5":{grass:3,tree:2,weed:1,olive:3,ragweed:0,mugwort:1},
    "6":{grass:2,tree:1,weed:1,olive:1,ragweed:0,mugwort:1},
    "7":{grass:1,tree:0,weed:2,olive:0,ragweed:1,mugwort:1},
    "8":{grass:1,tree:0,weed:3,olive:0,ragweed:2,mugwort:2},
    "9":{grass:1,tree:0,weed:3,olive:0,ragweed:3,mugwort:3},
    "10":{grass:1,tree:0,weed:2,olive:0,ragweed:2,mugwort:2},
    "11":{grass:0,tree:1,weed:1,olive:0,ragweed:1,mugwort:1},
    "12":{grass:0,tree:1,weed:0,olive:0,ragweed:0,mugwort:0}
  };
  let SEASON=null;                                  // loaded JSON.months (or fallback)
  function seasonTable(){ return SEASON||SEASON_FALLBACK; }
  function loadSeasonTable(){
    if(SEASON) return Promise.resolve(SEASON);
    try{
      return fetch(SEASON_URL).then(r=>r.ok?r.json():null).then(j=>{
        SEASON=(j&&j.months)?j.months:SEASON_FALLBACK; return SEASON;
      }).catch(()=>{ SEASON=SEASON_FALLBACK; return SEASON; });
    }catch(e){ SEASON=SEASON_FALLBACK; return Promise.resolve(SEASON); }
  }

  /* ----------------------------------------------------------------
     Single-doc cache (mergeDefaults, versioned _v1, fire-and-forget).
     {source:'om'|'goog', fetchedAt:ms, air:{...}, pollen:{...}}
  ---------------------------------------------------------------- */
  function cacheDefaults(){ return { source:null, fetchedAt:0, air:null, pollen:null }; }
  function mergeCache(saved){
    const d=cacheDefaults();
    if(!saved||typeof saved!=='object') return d;
    return { source: saved.source||d.source,
             fetchedAt: num(saved.fetchedAt)||0,
             air: (saved.air&&typeof saved.air==='object')?saved.air:null,
             pollen: (saved.pollen&&typeof saved.pollen==='object')?saved.pollen:null };
  }
  function readCache(){ let raw=null; try{ raw=JSON.parse(localStorage.getItem(CACHE_KEY)); }catch(e){} return mergeCache(raw); }
  function writeCache(doc){ try{ localStorage.setItem(CACHE_KEY, JSON.stringify(doc)); }catch(e){} }
  const isFresh=doc=>doc&&doc.fetchedAt && (Date.now()-doc.fetchedAt)<TTL_MS;

  /* ---- keys (Google opt-in) ---- */
  function keys(){ let k=null; try{ k=JSON.parse(localStorage.getItem(KEYS_KEY)); }catch(e){} return (k&&typeof k==='object')?k:{}; }
  function googleKey(){ const k=keys().googleKey; return (typeof k==='string'&&k.trim())?k.trim():null; }
  function hasKey(){ return !!googleKey(); }

  /* ---- local wall-clock parts in the local zone (matches weather.js) ---- */
  function localParts(date,tz){
    try{
      const f=new Intl.DateTimeFormat('en-CA',{timeZone:tz||'Etc/GMT+3',year:'numeric',
        month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false});
      const p={}; f.formatToParts(date).forEach(o=>{p[o.type]=o.value;});
      let hh=+p.hour; if(hh===24) hh=0;
      return { ymd:`${p.year}-${p.month}-${p.day}`, hour:hh, month:+p.month };
    }catch(e){
      const z=n=>String(n).padStart(2,'0');
      return { ymd:`${date.getFullYear()}-${z(date.getMonth()+1)}-${z(date.getDate())}`,
               hour:date.getHours(), month:date.getMonth()+1 };
    }
  }

  /* ----------------------------------------------------------------
     POLLEN normalisation. Open-Meteo gives grains/m³ per species; map to a
     0..5 level per type and synthesise the tree/weed aggregates the FIXED
     interface requires (Open-Meteo has no tree_pollen/weed_pollen).
       tree = max(olive, birch, alder); weed = max(ragweed, mugwort).
     index = max level across all types (the headline allergen level).
  ---------------------------------------------------------------- */
  // grains/m³ -> 0..5 level. Thresholds approximate common aerobiology bands;
  // grasses peak lower than trees so the same µg reads "higher" for grass.
  function lvl(grains,type){
    const g=num(grains); if(g==null) return 0;
    const T = (type==='grass'||type==='weed'||type==='ragweed'||type==='mugwort')
              ? [0.3,3,15,50,200]     // herbaceous: sensitive earlier
              : [1,15,90,500,1500];   // tree/olive: tolerate more before "high"
    let L=0; for(let i=0;i<T.length;i++){ if(g>=T[i]) L=i+1; }
    return L; // 0..5
  }
  function pollenFromGrains(o){
    o=o||{};
    const grass  = lvl(o.grass_pollen,'grass');
    const olive  = lvl(o.olive_pollen,'olive');
    const birch  = lvl(o.birch_pollen,'tree');
    const alder  = lvl(o.alder_pollen,'tree');
    const ragweed= lvl(o.ragweed_pollen,'ragweed');
    const mugwort= lvl(o.mugwort_pollen,'mugwort');
    const tree = Math.max(olive,birch,alder);
    const weed = Math.max(ragweed,mugwort);
    const index= Math.max(grass,tree,weed,ragweed,mugwort);
    return { grass, tree, weed, olive, ragweed, mugwort, index };
  }
  // build {grass,tree,weed,...,index,time,tz,hourly[]} from an Open-Meteo doc
  function buildPollen(j){
    const c=(j&&j.current)||{};
    const head=pollenFromGrains(c);
    const h=(j&&j.hourly)||{};
    const times=h.time||[];
    const hourly=times.map((t,i)=>{
      const row={
        grass_pollen:   h.grass_pollen   ? h.grass_pollen[i]   : null,
        olive_pollen:   h.olive_pollen   ? h.olive_pollen[i]   : null,
        birch_pollen:   h.birch_pollen   ? h.birch_pollen[i]   : null,
        alder_pollen:   h.alder_pollen   ? h.alder_pollen[i]   : null,
        ragweed_pollen: h.ragweed_pollen ? h.ragweed_pollen[i] : null,
        mugwort_pollen: h.mugwort_pollen ? h.mugwort_pollen[i] : null
      };
      return Object.assign({ time:t }, pollenFromGrains(row));
    });
    return Object.assign(head, { time:c.time||null, tz:(j&&j.timezone)||'Etc/GMT+3', hourly });
  }
  // seasonal-JSON fallback as the SAME pollen shape (no live → 'seasonal table')
  function pollenFromSeason(date){
    const {month}=localParts(date||new Date(),'Etc/GMT+3');
    const row=seasonTable()[String(month)]||SEASON_FALLBACK[String(month)]||{};
    const grass=row.grass||0, tree=row.tree||0, weed=row.weed||0,
          olive=row.olive||0, ragweed=row.ragweed||0, mugwort=row.mugwort||0;
    return { grass, tree, weed, olive, ragweed, mugwort,
             index:Math.max(grass,tree,weed,ragweed,mugwort),
             time:null, tz:'Etc/GMT+3', hourly:[], seasonal:true };
  }

  /* ---- live state (exposed via getters) ---- */
  let _air=null;      // {pm25,pm10,aqi,dust,uv,uvClear,time,tz}
  let _pollen=null;   // FIXED shape

  /* ----------------------------------------------------------------
     KEYLESS Open-Meteo: ONE call gets air-quality + pollen (same host).
  ---------------------------------------------------------------- */
  async function fetchOpenMeteo(){
    try{
      const cur=['pm2_5','pm10','european_aqi','dust','uv_index','uv_index_clear_sky',
                 'grass_pollen','olive_pollen','birch_pollen','alder_pollen',
                 'ragweed_pollen','mugwort_pollen'].join(',');
      const hourly=['grass_pollen','olive_pollen','birch_pollen','alder_pollen',
                    'ragweed_pollen','mugwort_pollen'].join(',');
      const url=`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}`+
        `&current=${cur}&hourly=${hourly}&forecast_days=2&timezone=auto`;
      const r=await fetch(url); if(!r.ok) throw 0;
      const j=await r.json(), c=j.current||{};
      const air={ pm25:num(c.pm2_5), pm10:num(c.pm10), aqi:num(c.european_aqi),
                  dust:num(c.dust), uv:num(c.uv_index), uvClear:num(c.uv_index_clear_sky),
                  time:c.time||null, tz:j.timezone||'Etc/GMT+3' };
      const pollen=buildPollen(j);
      return { source:'om', air, pollen };
    }catch(e){ return null; }
  }

  /* ----------------------------------------------------------------
     OPTIONAL Google upgrade path. Graceful no-op (returns null) without a
     key — never throws, never blocks. Endpoints CORS-verified per design;
     key-in-URL, key-presence-gated. NOT verified end-to-end with a real
     key (out of scope now) — code paths exist so a key just lights it up.
  ---------------------------------------------------------------- */
  async function fetchGoogleAir(){
    const k=googleKey(); if(!k) return null;        // graceful no-op
    try{
      const url=`https://airquality.googleapis.com/v1/currentConditions:lookup?key=${encodeURIComponent(k)}`;
      const body={ location:{latitude:LAT,longitude:LON},
        extraComputations:['POLLUTANT_CONCENTRATION','LOCAL_AQI'],
        universalAqi:false };
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!r.ok) throw 0;
      const j=await r.json();
      const conc={}; ((j.pollutants)||[]).forEach(p=>{
        const code=(p.code||'').toLowerCase();
        const v=p.concentration&&num(p.concentration.value);
        if(v!=null) conc[code]=v;
      });
      let aqi=null; ((j.indexes)||[]).forEach(ix=>{ if(num(ix.aqi)!=null) aqi=ix.aqi; });
      return { pm25:conc['pm25']!=null?conc['pm25']:null, pm10:conc['pm10']!=null?conc['pm10']:null,
               aqi:aqi, dust:null, uv:null, uvClear:null, time:j.dateTime||null, tz:'Etc/GMT+3' };
    }catch(e){ return null; }
  }
  async function fetchGooglePollen(){
    const k=googleKey(); if(!k) return null;        // graceful no-op
    try{
      const url=`https://pollen.googleapis.com/v1/forecast:lookup?key=${encodeURIComponent(k)}`+
        `&location.latitude=${LAT}&location.longitude=${LON}&days=1&languageCode=he`;
      const r=await fetch(url); if(!r.ok) throw 0;
      const j=await r.json();
      const day=(j.dailyInfo&&j.dailyInfo[0])||{};
      const byType={}; ((day.pollenTypeInfo)||[]).forEach(t=>{
        const code=(t.code||'').toLowerCase();      // GRASS / TREE / WEED
        const v=(t.indexInfo&&num(t.indexInfo.value));
        if(v!=null) byType[code]=Math.round(clamp01(v/5)*5); // Google UPI 0..5 → 0..5
      });
      const grass=byType['grass']||0, tree=byType['tree']||0, weed=byType['weed']||0;
      // Google's plant breakdown (olive/ragweed/mugwort) when present
      const byPlant={}; ((day.plantInfo)||[]).forEach(p=>{
        const code=(p.code||'').toLowerCase();
        const v=(p.indexInfo&&num(p.indexInfo.value));
        if(v!=null) byPlant[code]=Math.round(clamp01(v/5)*5);
      });
      const olive=byPlant['olive']!=null?byPlant['olive']:0;
      const ragweed=byPlant['ragweed']!=null?byPlant['ragweed']:0;
      const mugwort=byPlant['mugwort']!=null?byPlant['mugwort']:0;
      return { grass, tree, weed, olive, ragweed, mugwort,
               index:Math.max(grass,tree,weed,ragweed,mugwort),
               time:null, tz:'Etc/GMT+3', hourly:[] };
    }catch(e){ return null; }
  }

  /* ----------------------------------------------------------------
     refresh(): the single entry point. Returns the cached payload WITHOUT
     any network call while fresh; only on stale/miss does it fetch and
     rewrite the cache. Chooses Google-vs-Open-Meteo by key presence.
  ---------------------------------------------------------------- */
  let _inflight=null;
  async function refresh(){
    await loadSeasonTable();                         // cheap; resolves to fallback offline
    const wantSource = hasKey() ? 'goog' : 'om';
    const cached=readCache();
    // serve cache when fresh AND it matches the current source preference
    if(isFresh(cached) && cached.source===wantSource && (cached.air||cached.pollen)){
      _air=cached.air||_air; _pollen=cached.pollen||_pollen;
      return { source:cached.source, air:_air, pollen:_pollen, cached:true };
    }
    if(_inflight) return _inflight;                  // coalesce concurrent callers
    _inflight=(async()=>{
      let source=wantSource, air=null, pollen=null;
      if(wantSource==='goog'){
        const [ga,gp]=await Promise.all([fetchGoogleAir(),fetchGooglePollen()]);
        air=ga; pollen=gp;
        if(!air||!pollen){                           // partial/failed Google → backfill keyless
          const om=await fetchOpenMeteo();
          if(om){ if(!air)air=om.air; if(!pollen)pollen=om.pollen; }
        }
      } else {
        const om=await fetchOpenMeteo();
        if(om){ air=om.air; pollen=om.pollen; }
      }
      if(!air && !pollen){
        // total network failure → keep last good cache; ensure pollen has a value
        _air=cached.air||_air;
        _pollen=cached.pollen||_pollen||pollenFromSeason(new Date());
        _inflight=null;
        return { source:cached.source||'season', air:_air, pollen:_pollen, cached:true, offline:true };
      }
      _air=air||_air; _pollen=pollen||_pollen;
      writeCache({ source, fetchedAt:Date.now(), air:_air, pollen:_pollen });
      _inflight=null;
      return { source, air:_air, pollen:_pollen, cached:false };
    })();
    return _inflight;
  }

  /* ----------------------------------------------------------------
     pollenAt(date): the FIXED-shape pollen for the hour containing `date`.
     Uses the live hourly[] when available (so the scrubber/alerts can ask
     a specific hour), else the current headline, else the seasonal table.
  ---------------------------------------------------------------- */
  function pollenAt(date){
    const p=_pollen;
    const d=date||new Date();
    if(p && Array.isArray(p.hourly) && p.hourly.length){
      const {ymd,hour}=localParts(d,p.tz);
      const stamp=`${ymd}T${String(hour).padStart(2,'0')}:00`;
      let row=p.hourly.find(h=>h.time===stamp);
      if(!row){ // nearest hour by ms
        const tgt=d.getTime(); let best=1e15;
        p.hourly.forEach(h=>{ const t=Date.parse(h.time); if(!isNaN(t)){ const dd=Math.abs(t-tgt); if(dd<best){best=dd;row=h;} } });
      }
      if(row) return { grass:row.grass, tree:row.tree, weed:row.weed, olive:row.olive,
                       ragweed:row.ragweed, mugwort:row.mugwort, index:row.index,
                       time:row.time, tz:p.tz, hourly:p.hourly };
    }
    if(p) return p;                                  // current headline
    return pollenFromSeason(d);                       // seasonal fallback
  }

  /* ----------------------------------------------------------------
     dustIntensity(): the SINGLE pm10/desert-dust → 0..1 mapping, reused by
     weather.js (scene) and the alerts engine so badge text + 3D haze agree.
     Prefer desert dust mass (≈0 at 20µg → ≈0.9 at 200µg via /250); else
     PM10 ((pm10-20)/180). Matches the app.js dustHe() thresholds. Reads the
     freshest of EnvAPI._air and Weather.air. Returns null when no data.
  ---------------------------------------------------------------- */
  function dustIntensity(){
    const a=_air || (window.Weather&&Weather.air) || null;
    if(!a) return null;
    if(num(a.dust)!=null) return clamp01(a.dust/250);
    if(num(a.pm10)!=null) return clamp01((a.pm10-20)/180);
    return null;
  }

  const API={
    refresh, pollenAt, dustIntensity, hasKey,
    fetchGoogleAir, fetchGooglePollen,
    // exposed for verification / consumers that read the keyless source directly
    fetchOpenMeteo, loadSeasonTable,
    get pollen(){ return _pollen; },
    get air(){ return _air; },
    get source(){ return hasKey()?'goog':'om'; }
  };
  window.EnvAPI=API;
  return API;
})();
window.EnvAPI = EnvAPI;
