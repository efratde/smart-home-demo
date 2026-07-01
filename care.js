/* ===================================================================
   care.js — window.PlantCare: a thin, keyless, offline loader for the
   baked per-plant month-by-month CARE CALENDAR (data/plant_care.json),
   keyed by name_latin (the same join key garden.js obsName()/plantMeta
   use). Pure data — NO DOM, NO network beyond the one JSON, NO intervals.
   Loads before garden.js; garden.js boot() awaits loadCare() so the
   "this month's care" card has data on first open.

   Mirrors garden.js loadCurated(): fetch the JSON once with a hard-coded
   inline FALLBACK so it still works on file:// where fetch can fail.
   The care content is GENERAL high-the highlands-rim horticultural guidance —
   NOT a prescription (see meta.disclaimer_he); the card surfaces that.
   =================================================================== */
(function(){
  if(window.PlantCare) return;                 // idempotency guard (house pattern)

  /* minimal inline fallback so a single this-month task still renders on
     file:// if the fetch is blocked. The full, authoritative content lives
     in data/plant_care.json; this is a tiny safety net, not a duplicate. */
  const FALLBACK={
    schema:1,
    meta:{ disclaimer_he:'General guidance, not a prescription',
           source_he:'General gardening knowledge — not tailored to the specific variety' },
    kinds:{
      fertilize:{emoji:'🌱',he:'Fertilize'}, prune:{emoji:'✂️',he:'Prune'},
      thin:{emoji:'🍈',he:'Thinning'}, plant:{emoji:'🪴',he:'Planting'},
      harvest:{emoji:'🧺',he:'Harvest'}, protect:{emoji:'🛡️',he:'Protection'},
      water_check:{emoji:'💧',he:'Irrigation check'}, propagate:{emoji:'🌿',he:'Propagation'}
    },
    plants:{}
  };

  let CARE=null;                               // the loaded doc (or fallback)
  let _loading=null;                           // the in-flight promise (load-once)

  function _normalize(doc){
    if(!doc || typeof doc!=='object') return FALLBACK;
    if(!doc.kinds || typeof doc.kinds!=='object') doc.kinds=FALLBACK.kinds;
    if(!doc.plants || typeof doc.plants!=='object') doc.plants={};
    if(!doc.meta || typeof doc.meta!=='object') doc.meta=FALLBACK.meta;
    return doc;
  }

  function loadCare(){
    if(CARE) return Promise.resolve(CARE);
    if(_loading) return _loading;
    _loading = fetch('data/plant_care.json')
      .then(r=>r.ok?r.json():FALLBACK)
      .then(d=>{ CARE=_normalize(d); return CARE; })
      .catch(()=>{ CARE=_normalize(FALLBACK); return CARE; });
    return _loading;
  }

  /* ---- accessors (all null-safe; return [] / null when not loaded) ---- */
  function _doc(){ return CARE; }
  function _plant(nameLatin){
    if(!CARE || !nameLatin) return null;
    return CARE.plants[nameLatin] || null;
  }

  // this-month task list for a plant: array of {task_he, kind}. monthIdx 0=Jan..11=Dec.
  function tasksFor(nameLatin, monthIdx){
    const p=_plant(nameLatin); if(!p || !Array.isArray(p.month_tasks)) return [];
    let m=(monthIdx==null)?new Date().getMonth():(+monthIdx);
    if(!isFinite(m)) m=new Date().getMonth();
    m=((m%12)+12)%12;                          // clamp/wrap to 0..11
    const cell=p.month_tasks[m];
    return Array.isArray(cell)?cell.filter(t=>t&&t.task_he):[];
  }
  function companionsFor(nameLatin){ const p=_plant(nameLatin); return (p&&Array.isArray(p.companions))?p.companions:[]; }
  function pollinatorsFor(nameLatin){ const p=_plant(nameLatin); return (p&&Array.isArray(p.pollinators))?p.pollinators:[]; }
  // #14 PESTS: common pests for this crop in the high-the highlands — array of {name_he, sign_he, remedy_he}.
  function pestsFor(nameLatin){ const p=_plant(nameLatin); return (p&&Array.isArray(p.pests))?p.pests.filter(x=>x&&x.name_he):[]; }
  // #15 ENRICH: one actionable line each — good/bad neighbours, and how to draw the right pollinators.
  function companionTipFor(nameLatin){ const p=_plant(nameLatin); return (p&&p.companion_tip_he)?p.companion_tip_he:null; }
  function pollinatorTipFor(nameLatin){ const p=_plant(nameLatin); return (p&&p.pollinator_tip_he)?p.pollinator_tip_he:null; }
  function nameHe(nameLatin){ const p=_plant(nameLatin); return p?p.name_he:null; }
  function has(nameLatin){ return !!_plant(nameLatin); }

  // kind → {emoji,he}; falls back to a generic glyph for an unknown kind.
  function kindMeta(kind){
    const k=(CARE&&CARE.kinds)||FALLBACK.kinds;
    return k[kind] || { emoji:'•', he:String(kind||'') };
  }

  function disclaimer(){ return (CARE&&CARE.meta&&CARE.meta.disclaimer_he) || FALLBACK.meta.disclaimer_he; }

  // ISO yyyy-mm-dd ~`days` out, clamped to the end of THIS month, used as the
  // `due` when pushing a care task to LogStore 'schedule'. Local-date based so
  // it matches alerts.js Date.parse(due) / the brain-tab date input.
  function dueDateForThisMonth(days){
    const d=new Date();
    const offset=(days==null)?7:(+days||7);
    const target=new Date(d.getFullYear(), d.getMonth(), d.getDate()+offset);
    // clamp to the last day of the CURRENT month so a "this month" task stays this month
    const lastOfMonth=new Date(d.getFullYear(), d.getMonth()+1, 0);
    const use=(target>lastOfMonth)?lastOfMonth:target;
    const z=n=>String(n).padStart(2,'0');
    return `${use.getFullYear()}-${z(use.getMonth()+1)}-${z(use.getDate())}`;
  }

  window.PlantCare={
    loadCare, tasksFor, companionsFor, pollinatorsFor, pestsFor,
    companionTipFor, pollinatorTipFor, nameHe, has,
    kindMeta, disclaimer, dueDateForThisMonth, _doc
  };
})();
