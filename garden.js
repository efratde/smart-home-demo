/* ===================================================================
   garden.js — IN-WORLD plant tracking (Make pillar, approach A, Phase 2).
   Plants live as markers on the REAL garden in 3D (the scene half is
   GardenPins in app.js); clicking a marker opens THIS card in the #inst
   instrument skin — tracking (status / water ± / notes) made smart by the
   microclimate engine (Derive.cellProfile / rankPlantsForCell). Marker
   POSITIONS are computed here from Derive.cellGrid() zone centroids and fed
   to window.__gardenPins. Data model ported from the retired twin.js
   __homeGarden; the flat 2D zone list + blue skin are gone.
   Persistence: localStorage `home_garden_v1` (mergeDefaults).
   =================================================================== */
(function(){
  if(window.__garden) return;
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const $=id=>document.getElementById(id);
  const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};

  /* ---------------- zones / seasons ---------------- */
  const ZONES=[
    { id:'backyard', name_he:'Backyard', emoji:'🌄', sub:'East · morning sun' },
    { id:'balcony',  name_he:'Balcony',  emoji:'☀️', sub:'Elevated · most sun' },
    { id:'front',    name_he:'Front yard', emoji:'🌅', sub:'West · afternoon sun' },
  ];
  const zoneHe=id=>(ZONES.find(z=>z.id===id)||{}).name_he||id;
  const SEASONS=[['winter','Winter'],['spring','Spring'],['summer','Summer'],['autumn','Autumn']];
  const seasonHe=s=>(SEASONS.find(x=>x[0]===s)||[,s])[1];
  const WATER_FIELD={ winter:'water_winter_l_week', spring:'water_spring_l_week',
                      summer:'water_summer_l_week', autumn:'water_autumn_l_week' };
  const STATUSES=[['Planted','planted'],['Thriving','thriving'],['Needs care','care']];
  const POT_PRESETS=[0,3,5,10,20,40];     // litres; 0 = planted in the ground (no pot)

  /* ---------------- data: curated plants + add-catalog ---------------- */
  let CURATED=[], CATALOG=null;
  const CATALOG_FALLBACK=[
    {id:'tomato_cherry',name_he:'Cherry tomatoes',emoji:'🍅',kc:1.05},{id:'basil',name_he:'Basil',emoji:'🌿',kc:0.9},
    {id:'rosemary',name_he:'Rosemary',emoji:'🌿',kc:0.5},{id:'sage',name_he:'Sage',emoji:'🌿',kc:0.6},
    {id:'thyme',name_he:'Thyme',emoji:'🌿',kc:0.6},{id:'oregano',name_he:'Oregano',emoji:'🌿',kc:0.7},
    {id:'lavender',name_he:'Lavender',emoji:'💜',kc:0.5},{id:'olive',name_he:'Olive',emoji:'🫒',kc:0.7},
    {id:'lemon',name_he:'Lemon',emoji:'🍋',kc:0.85},{id:'grape',name_he:'Grapevine',emoji:'🍇',kc:0.85},
    {id:'strawberry',name_he:'Strawberry',emoji:'🍓',kc:0.85},{id:'pepper',name_he:'Pepper',emoji:'🌶️',kc:1.05},
    {id:'cucumber',name_he:'Cucumber',emoji:'🥒',kc:1.0},{id:'parsley',name_he:'Parsley',emoji:'🌱',kc:1.0},
    {id:'cilantro',name_he:'Cilantro',emoji:'🌱',kc:1.0},{id:'lettuce',name_he:'Lettuce',emoji:'🥬',kc:1.0},
    {id:'spinach',name_he:'Spinach',emoji:'🥬',kc:1.0},{id:'carrot',name_he:'Carrot',emoji:'🥕',kc:1.05},
    {id:'garlic',name_he:'Garlic',emoji:'🧄',kc:0.95},{id:'almond',name_he:'Almond',emoji:'🌰',kc:0.9},
  ];
  function loadCurated(){
    return fetch('data/resident_plants.json').then(r=>r.ok?r.json():[]).then(a=>{CURATED=Array.isArray(a)?a:[];return CURATED;}).catch(()=>{CURATED=[];return CURATED;});
  }
  // candidate plants Alex does NOT own (the "worth adding to the garden" suggestions).
  // Loaded once, then cross-checked against the curated set by name_latin so we
  // never suggest a plant he already has (e.g. pomegranate).
  let CANDIDATES=[];
  function loadCandidates(){
    return fetch('data/plant_candidates.json').then(r=>r.ok?r.json():[]).then(a=>{
      const arr=Array.isArray(a)?a:[];
      const ownLatin={}; (CURATED||[]).forEach(p=>{ if(p.name_latin) ownLatin[p.name_latin.toLowerCase().trim()]=1; });
      const ownId={}; (CURATED||[]).forEach(p=>{ if(p.id) ownId[p.id]=1; });
      CANDIDATES=arr.filter(c=>{
        const lat=(c.name_latin||'').toLowerCase().trim();
        return !(lat&&ownLatin[lat]) && !(c.id&&ownId[c.id]);
      });
      return CANDIDATES;
    }).catch(()=>{CANDIDATES=[];return CANDIDATES;});
  }
  // per-plant PLANTING & CARE advice (data/planting_tips.json) — soil / pot-vs-ground /
  // fertilizer / special needs, grounded in his site soil (X1/Aridisols) + species lore.
  // Loaded once, indexed by id AND name_latin (lowercased) so the card matches either.
  let TIPS_BY_ID={}, TIPS_BY_LATIN={};
  function loadPlantingTips(){
    return fetch('data/planting_tips.json').then(r=>r.ok?r.json():null).then(j=>{
      const arr=(j&&Array.isArray(j.tips))?j.tips:(Array.isArray(j)?j:[]);
      arr.forEach(t=>{ if(!t) return;
        if(t.id) TIPS_BY_ID[t.id]=t;
        if(t.name_latin) TIPS_BY_LATIN[String(t.name_latin).toLowerCase().trim()]=t;
      });
      // re-render an open card if the tips arrived after it opened
      if(cur&&card&&card.classList.contains('on')) render();
      return arr;
    }).catch(()=>{ TIPS_BY_ID={}; TIPS_BY_LATIN={}; return []; });
  }
  // match a plant → its planting tip: by id first, else by curated/catalog name_latin.
  function tipFor(p){
    if(!p) return null;
    if(p.id && TIPS_BY_ID[p.id]) return TIPS_BY_ID[p.id];
    const m=plantMeta(p.id)||{};
    const lat=(m.name_latin||p.name_latin||'').toLowerCase().trim();
    return (lat&&TIPS_BY_LATIN[lat])||null;
  }
  function catalog(){
    if(CATALOG) return CATALOG;
    const byId={}; CATALOG_FALLBACK.forEach(c=>byId[c.id]=c);
    CURATED.forEach(p=>byId[p.id]=Object.assign({},byId[p.id],{id:p.id,name_he:p.name_he,emoji:p.emoji,kc:p.kc,_curated:true}));
    CATALOG=Object.values(byId); return CATALOG;
  }
  // metadata for a plant id: prefer his curated set, then the add-catalog, then a
  // candidate (so a suggestion he ADDS keeps its full requirement/water schema for
  // the card's fit/water/lifecycle — candidates carry the same field shape).
  const plantMeta=id=>CURATED.find(p=>p.id===id)||(CATALOG||CATALOG_FALLBACK).find(p=>p.id===id)||(CANDIDATES||[]).find(p=>p.id===id)||null;

  /* ---------------- persistence: home_garden_v1 + mergeDefaults ---------------- */
  const KEY='home_garden_v1';
  function autoSeason(){ const m=new Date().getMonth(); return (m<=1||m===11)?'winter':m<=4?'spring':m<=8?'summer':'autumn'; }
  function seedPlants(){ return (CURATED||[]).map(p=>({ id:p.id, zoneId:p.best_zone_id||'balcony', status:'',
    water_adjust_pct:0, notes_he:'', emoji:p.emoji, name_he:p.name_he, source:'curated',
    xL:null, zL:null, pot:null, planted:null })); }
  function defaultsDoc(){ return { schema:1, season:autoSeason(), plants:seedPlants(), removed:[] }; }
  function mergePlant(seed,saved){ return seed?Object.assign({},seed,saved):saved; }
  function mergeDefaults(saved){
    const def=defaultsDoc();
    if(!saved||typeof saved!=='object') return def;
    const removed=Array.isArray(saved.removed)?saved.removed:[];
    const seedById={}; def.plants.forEach(p=>seedById[p.id]=p);
    const savedArr=Array.isArray(saved.plants)?saved.plants:[]; const seen={};
    const out={ schema:1, season:SEASONS.some(s=>s[0]===saved.season)?saved.season:def.season, plants:[], removed };
    savedArr.forEach(sp=>{ seen[sp.id]=1; out.plants.push(mergePlant(seedById[sp.id],sp)); });
    def.plants.forEach(sp=>{ if(!seen[sp.id]&&removed.indexOf(sp.id)<0) out.plants.push(sp); });
    return out;
  }
  let DOC;
  // readiness (delay fix): panels.js mounts the embedded yard overview the instant DOC
  // is built, via onReady() — no 120ms poll lag. markReady() fires once DOC exists.
  let _ready=false; const _readyCbs=[];
  function markReady(){ if(_ready) return; _ready=true; const cbs=_readyCbs.splice(0); cbs.forEach(fn=>{ try{ fn(); }catch(e){} }); }
  function onReady(fn){ if(typeof fn!=='function') return; if(_ready){ try{ fn(); }catch(e){} } else _readyCbs.push(fn); }
  function load(){ let raw=null; try{ raw=JSON.parse(localStorage.getItem(KEY)); }catch(e){} DOC=mergeDefaults(raw); }
  function save(){ try{ localStorage.setItem(KEY,JSON.stringify(DOC)); }catch(e){} }
  const plant=id=>DOC.plants.find(p=>p.id===id)||null;

  /* ---------------- microclimate (rep cell per zone, mirrors panels.js) ---------------- */
  const _repCache={};
  function repCell(zoneId){
    if(_repCache[zoneId]) return _repCache[zoneId];
    const cells=(window.Derive&&Derive.cellGrid&&Derive.cellGrid())||[];
    const mine=cells.filter(c=>c.zoneId===zoneId); if(!mine.length) return null;
    let mx=0,mz=0; mine.forEach(c=>{mx+=c.xL;mz+=c.zL;}); mx/=mine.length; mz/=mine.length;
    let best=mine[0],bd=Infinity; mine.forEach(c=>{const d=(c.xL-mx)**2+(c.zL-mz)**2; if(d<bd){bd=d;best=c;}});
    _repCache[zoneId]=best; return best;
  }
  function profileOf(zoneId,season){ const c=repCell(zoneId); return c&&Derive.cellProfile?Derive.cellProfile(c,season):null; }
  // this plant's fit (score/reason) in a given zone, via Derive.rankPlantsForCell
  function fitIn(plantId,zoneId,season){
    const c=repCell(zoneId); if(!c||!Derive.rankPlantsForCell) return null;
    const ranked=Derive.rankPlantsForCell(c,season)||[];
    return ranked.find(r=>r.plant&&r.plant.id===plantId)||ranked.find(r=>r.id===plantId)||null;
  }
  function bestZone(plantId,season){
    let best=null,bs=-1;
    ZONES.forEach(z=>{ const f=fitIn(plantId,z.id,season); if(f&&f.score>bs){bs=f.score;best=z.id;} });
    return best?{zoneId:best,score:bs}:null;
  }

  /* ---------------- EXACT position → the plant's OWN microclimate cell ----------------
     When Alex drags a marker to its real spot we store (xL,zL). These helpers find
     the nearest 0.5 m grid cell to that point so the plant reads ITS cell's profile
     (sun-hours/ETc/frost), not the zone's single rep cell — two plants in the same
     zone but different corners now get different guidance. Falls back to the zone
     rep cell for plants that haven't been placed yet. */
  let _cellsCache=null;
  function allCells(){ if(_cellsCache&&_cellsCache.length) return _cellsCache;
    _cellsCache=(window.Derive&&Derive.cellGrid&&Derive.cellGrid())||[]; return _cellsCache; }
  function nearestCell(xL,zL){
    const cells=allCells(); if(!cells.length) return null;
    let best=null,bd=Infinity;
    for(const c of cells){ const d=(c.xL-xL)*(c.xL-xL)+(c.zL-zL)*(c.zL-zL); if(d<bd){bd=d;best=c;} }
    return best;
  }
  const isPlaced=p=>p&&p.xL!=null&&p.zL!=null;
  function cellForPlant(p){
    if(isPlaced(p)){ const c=nearestCell(p.xL,p.zL); if(c) return c; }
    return repCell(p.zoneId);
  }
  function profileOfPlant(p,season){ const c=cellForPlant(p); return c&&Derive.cellProfile?Derive.cellProfile(c,season):null; }
  function fitInForPlant(p,season){
    const c=cellForPlant(p); if(!c||!Derive.rankPlantsForCell) return null;
    const ranked=Derive.rankPlantsForCell(c,season)||[];
    return ranked.find(r=>(r.plant&&r.plant.id===p.id)||r.plantId===p.id)||null;
  }

  /* ---------------- pot size → irrigation (reservoir / "checkbook" scheduling) --------
     pot=0/null ⇒ planted in the ground (canopy ~1 m² demand model). pot>0 (litres) ⇒
     a container: (a) demand scales to the pot's top footprint (a basil in a 3 L pot
     uses far less than a tree in the bed), and (b) the pot is a finite reservoir, so
     watering FREQUENCY = reservoir ÷ daily demand. Nurseries sell pots by litre,
     so litres is the natural input. All an honest estimate (labelled). */
  function potTopArea(litres){ const v=Math.max(0.5,+litres||0);     // pot top footprint, m² ≈ π(6·V^⅓/100)²
    return Math.min(0.6, Math.max(0.02, 0.0113*Math.pow(v,2/3))); }
  const POT_CANOPY_SPREAD=2.2;   // a healthy container canopy spreads ~1.5× the pot width ⇒ ~2.2× its footprint
  const RES_FRAC=0.12;           // usable water before stress ≈ EAW(.25)×MAD(.5) of pot volume (errs toward MORE frequent)
  function wateringSchedule(p,season){
    const weekly=waterWeekly(p,season); if(weekly==null) return null;
    if(!(p&&p.pot>0)) return { potted:false, weekly };
    const daily=weekly/7, reservoir=p.pot*RES_FRAC;
    let days = daily>0 ? reservoir/daily : 14; days=Math.min(14,Math.max(1,Math.round(days)));
    return { potted:true, weekly, days, per:Math.round(daily*days*10)/10, pot:p.pot };
  }
  function scheduleText(p,season){
    const s=wateringSchedule(p,season); if(!s) return '—';
    if(!s.potted) return '~'+s.weekly+' L/wk';
    return `~${s.per} L every ${s.days===1?'day':s.days+' days'} · ~${s.weekly} L/wk`;
  }

  /* ---------------- marker positions (fed to GardenPins in app.js) ----------------
     Each zone's plants are spread on a small ring around the zone's cell-grid
     centroid; elevated=balcony (its surface is the deck). baseY = mean cell y. */
  function zoneCentroid(zoneId){
    const cells=(window.Derive&&Derive.cellGrid&&Derive.cellGrid())||[];
    const mine=cells.filter(c=>c.zoneId===zoneId); if(!mine.length) return null;
    let x=0,z=0,y=0; mine.forEach(c=>{x+=c.xL;z+=c.zL;y+=(c.y||0);});
    const baseY=y/mine.length;
    return { xL:x/mine.length, zL:z/mine.length, baseY, elevated:baseY>=1.0 };
  }
  function positions(){
    const out=[], autoByZone={};
    // PLACED plants → their exact (xL,zL); the rest → auto-ring around the zone centroid.
    DOC.plants.forEach(p=>{
      if(isPlaced(p)){
        const c=nearestCell(p.xL,p.zL), baseY=c?(c.y||0):0;
        out.push({ id:p.id, emoji:p.emoji||(plantMeta(p.id)||{}).emoji||'🌱',
          xL:p.xL, zL:p.zL, baseY, elevated:baseY>=1.0 });
      } else (autoByZone[p.zoneId]=autoByZone[p.zoneId]||[]).push(p);
    });
    Object.keys(autoByZone).forEach(zid=>{
      const c=zoneCentroid(zid); if(!c) return;
      const arr=autoByZone[zid], R=0.95;
      arr.forEach((p,i)=>{
        const ang=(i/Math.max(1,arr.length))*Math.PI*2 + 0.6;
        const dx=arr.length>1?Math.cos(ang)*R:0, dz=arr.length>1?Math.sin(ang)*R:0;
        out.push({ id:p.id, emoji:p.emoji||(plantMeta(p.id)||{}).emoji||'🌱',
          xL:c.xL+dx, zL:c.zL+dz, baseY:c.baseY, elevated:c.elevated });
      });
    });
    return out;
  }
  function refreshPins(t){
    if(!window.__gardenPins){ if((t||0)<200) setTimeout(()=>refreshPins((t||0)+1),80); return; }
    const cells=(window.Derive&&Derive.cellGrid&&Derive.cellGrid())||[];
    if(!cells.length){ if((t||0)<200) setTimeout(()=>refreshPins((t||0)+1),100); return; }
    window.__gardenPins.setData(positions());
  }

  /* ---------------- CSS (the #inst brass-on-glass language) ---------------- */
  const CSS=`
  #gardenCard{position:absolute;top:18px;right:22px;width:316px;max-height:calc(100vh - 40px);
    display:none;flex-direction:column;font-family:'Heebo',sans-serif;color:#efe6cf;z-index:9;
    text-shadow:0 1px 2px rgba(0,0,0,.5)}
  #gardenCard.on{display:flex}
  #gardenCard .body{overflow-y:auto;padding:14px 15px;border-radius:4px;
    background:linear-gradient(160deg,rgba(12,14,26,.93),rgba(6,7,15,.95));
    backdrop-filter:blur(12px);border:1px solid rgba(202,161,90,.22);box-shadow:0 18px 48px rgba(0,0,0,.55)}
  #gardenCard .hd{display:flex;align-items:center;justify-content:space-between;gap:8px}
  #gardenCard h3{font-family:'Frank Ruhl Libre',serif;font-weight:500;font-size:19px;color:#fff7e6;line-height:1.1}
  #gardenCard h3 .e{font-size:20px;margin-left:4px}
  #gardenCard .x{flex:0 0 auto;cursor:pointer;color:#a99b78;font-size:15px;line-height:1;padding:2px 4px;border-radius:6px;
    border:1px solid rgba(202,161,90,.22);background:rgba(255,255,255,.03);transition:.15s}
  #gardenCard .x:hover{color:#fff7e6;border-color:rgba(202,161,90,.5)}
  #gardenCard .sub{font-size:10px;color:#a99b78;margin:4px 0 10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  #gardenCard select,#gardenCard textarea{background:#0b1322;border:1px solid rgba(202,161,90,.3);color:#fff;
    border-radius:7px;padding:5px 8px;font-size:12px;font-family:inherit}
  #gardenCard textarea{width:100%;resize:vertical;margin-top:4px}
  #gardenCard .card{background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.15);border-radius:8px;padding:9px 11px;margin-top:9px}
  #gardenCard .ct{font-family:'Bellefair',serif;letter-spacing:.08em;font-size:10.5px;color:#caa15a;margin-bottom:5px}
  #gardenCard .zg{display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;font-size:11.5px;color:#d6ccb2}
  #gardenCard .zg .k{color:#a99b78} #gardenCard .zg b{color:#fff7e6;font-weight:600}
  #gardenCard .score{font-family:'Frank Ruhl Libre',serif;font-size:22px;color:#a3e635;line-height:1}
  #gardenCard .score.mid{color:#e0b24a} #gardenCard .score.lo{color:#c98a8a}
  #gardenCard .reason{font-size:10.5px;color:#a99b78;line-height:1.45;margin-top:4px}
  #gardenCard .best{font-size:10.5px;color:#cdbd92;margin-top:6px;padding-top:6px;border-top:1px solid rgba(202,161,90,.13)}
  #gardenCard .caretasks{display:flex;flex-direction:column;gap:6px}
  #gardenCard .caretask{display:flex;align-items:center;gap:7px}
  #gardenCard .caretask .ce{font-size:14px;flex:0 0 auto;line-height:1.2}
  #gardenCard .caretask .ctx{flex:1;font-size:11.5px;color:#e3d9bf;line-height:1.4}
  #gardenCard .chip.cadd{flex:0 0 auto;font-size:10px;padding:3px 9px;white-space:nowrap}
  #gardenCard .chip.cadd.on{cursor:default}
  #gardenCard .cdisc{font-size:9px;color:#8a7a52;margin-top:7px;font-style:italic}
  #gardenCard .best .caretip{display:block;font-size:10px;color:#bcb08a;line-height:1.5;margin-top:2px}
  /* honesty-spine basis labels (Living Record vs model) — real | model | frost pills */
  #gardenCard .ct .lab{font-family:'Heebo';font-size:9px;font-weight:400;letter-spacing:.02em;padding:1px 7px;border-radius:20px;white-space:nowrap}
  #gardenCard .lab.real{background:rgba(120,200,120,.16);color:#a7e0a7;border:1px solid rgba(120,200,120,.42)}
  #gardenCard .lab.model{background:rgba(224,178,74,.18);color:#e8c474;border:1px solid rgba(224,178,74,.42)}
  #gardenCard .lab.frost{background:rgba(120,150,235,.20);color:#bcd0f0;border:1px solid rgba(120,150,235,.48)}
  #gardenCard .ct.lr{display:flex;align-items:center;justify-content:space-between;gap:6px}
  #gardenCard .lrrow{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:11.5px;color:#d6ccb2;padding:5px 0;border-top:1px solid rgba(202,161,90,.1)}
  #gardenCard .lrrow:first-of-type{border-top:0}
  #gardenCard .lrrow b{color:#fff7e6;font-weight:600;text-align:left}
  #gardenCard .lrbasis{font-size:9px;color:#8a7a52;line-height:1.45;margin-top:6px;font-style:italic}
  #gardenCard .pesthd{font-family:'Bellefair',serif;letter-spacing:.06em;font-size:11px;color:#caa15a;margin-bottom:5px}
  #gardenCard .pest{font-size:10.5px;color:#d6ccb2;line-height:1.45;padding-top:5px;margin-top:5px;border-top:1px solid rgba(202,161,90,.1)}
  #gardenCard .pest:first-of-type{border-top:0;padding-top:0;margin-top:0}
  #gardenCard .pest b{color:#fff7e6;font-weight:600}
  #gardenCard .pest .psign{display:block;color:#bcb08a;margin-top:2px}
  #gardenCard .pest .prem{display:block;color:#a3c79a;margin-top:2px}
  #gardenCard .lbl{font-size:9.5px;color:#8a7a52;letter-spacing:.05em;margin:11px 0 5px}
  #gardenCard .chips{display:flex;gap:5px;flex-wrap:wrap}
  #gardenCard .chip{font-size:11px;padding:4px 11px;border-radius:20px;cursor:pointer;user-select:none;
    background:rgba(255,255,255,.05);border:1px solid rgba(202,161,90,.25);color:#cdbd92;transition:.15s}
  #gardenCard .chip:hover{border-color:rgba(202,161,90,.55);color:#fff7e6}
  #gardenCard .chip.on{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;font-weight:600;border-color:#e0c483}
  #gardenCard .chip.season.on{background:linear-gradient(#7fa8d8,#4f79b0);border-color:#9cc0e8;color:#06121f}
  #gardenCard .water{display:flex;align-items:center;gap:9px;margin-top:4px}
  #gardenCard input[type=range]{flex:1;accent-color:#caa15a}
  #gardenCard .wv{font-size:12px;color:#fff7e6;min-width:74px;text-align:left}
  #gardenCard .foot{display:flex;justify-content:space-between;align-items:center;margin-top:12px}
  #gardenCard .rm{font-size:11px;color:#c98a8a;cursor:pointer;border:1px solid rgba(201,138,138,.4);
    border-radius:7px;padding:5px 10px;background:rgba(201,138,138,.08);transition:.15s}
  #gardenCard .rm:hover{background:rgba(201,138,138,.18);color:#f0b6b6}
  #gardenCard .save{font-size:9.5px;color:#7d7150}
  #gardenCard .draghint{font-size:10px;color:#8fae8f;margin:6px 0 2px;line-height:1.45;
    padding:5px 8px;border-radius:6px;background:rgba(143,206,143,.07);border:1px solid rgba(143,206,143,.18)}
  #gardenCard .sublbl{font-size:9.5px;color:#8a7a52;font-weight:400}
  #gardenCard .potchips{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
  #gardenCard .potchips .chip{font-size:11px;padding:4px 9px}
  #gardenCard .potfree{width:50px;background:#0b1322;border:1px solid rgba(202,161,90,.3);color:#fff;
    border-radius:7px;padding:4px 7px;font-size:11.5px;font-family:inherit}
  #gardenCard .plrow{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:1px 0 6px}
  #gardenCard .plrow label{font-size:11px;color:#a99b78}
  #gardenCard .pldate{background:#0b1322;border:1px solid rgba(202,161,90,.3);color:#efe6cf;border-radius:7px;
    padding:4px 8px;font-size:11.5px;font-family:inherit;color-scheme:dark}
  #gardenCard .agerow{font-size:12.5px;color:#cdbd92;margin-bottom:7px}
  #gardenCard .lcrow{font-size:11.5px;color:#d6ccb2;margin-top:5px;line-height:1.5}
  #gardenCard .lcrow b{color:#fff7e6;font-weight:600}
  #gardenCard .timeline{display:flex;gap:2px;margin:3px 0 7px}
  #gardenCard .tlc{flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;padding:3px 0;border-radius:4px;
    background:rgba(255,255,255,.03);border:1px solid transparent}
  #gardenCard .tlc.h{background:rgba(202,161,90,.24)}
  #gardenCard .tlc.g{background:rgba(143,206,143,.18)}
  #gardenCard .tlc.p{background:rgba(150,155,170,.14)}
  #gardenCard .tlc.now{border-color:#caa15a;box-shadow:0 0 0 1px rgba(202,161,90,.45)}
  #gardenCard .tlc .tle{font-size:10px;height:13px;line-height:13px}
  #gardenCard .tlc .tlm{font-size:8px;color:#8a7a52}
  /* the "+ plant" garden control (bottom-left, above the home/enter stack) */
  #gardenAdd{position:absolute;left:30px;bottom:296px;display:flex;align-items:center;gap:7px;z-index:7;
    font-family:'Heebo',sans-serif;font-size:12.5px;color:#e7dcc0;cursor:pointer;border-radius:7px;padding:8px 13px;
    background:linear-gradient(150deg,rgba(14,16,30,.72),rgba(8,9,18,.66));backdrop-filter:blur(11px);
    border:1px solid rgba(202,161,90,.28);box-shadow:0 16px 44px rgba(0,0,0,.4);transition:.2s}
  #gardenAdd:hover{border-color:rgba(202,161,90,.6);color:#fff7e6}
  #gardenAdd .hg{color:#8fce8f}
  /* catalog popup */
  #gardenCat{position:absolute;inset:0;z-index:30;display:none;align-items:center;justify-content:center;
    background:rgba(4,5,12,.55);backdrop-filter:blur(3px);font-family:'Heebo',sans-serif}
  #gardenCat.on{display:flex}
  #gardenCat .box{width:min(440px,92vw);max-height:78vh;overflow:auto;border-radius:10px;padding:16px 18px;
    background:linear-gradient(160deg,rgba(14,16,30,.97),rgba(7,8,16,.98));border:1px solid rgba(202,161,90,.3);
    box-shadow:0 24px 70px rgba(0,0,0,.6)}
  #gardenCat h4{font-family:'Frank Ruhl Libre',serif;font-weight:500;font-size:17px;color:#fff7e6;margin-bottom:3px}
  #gardenCat .gsub{font-size:10.5px;color:#a99b78;margin-bottom:10px}
  #gardenCat input.s{width:100%;background:#0b1322;border:1px solid rgba(202,161,90,.3);color:#fff;border-radius:7px;
    padding:7px 10px;font-size:12.5px;font-family:inherit;margin-bottom:10px}
  #gardenCat .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:7px}
  #gardenCat .gp{display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 5px;border-radius:9px;cursor:pointer;
    background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.18);transition:.15s;text-align:center}
  #gardenCat .gp:hover{border-color:rgba(202,161,90,.6);background:rgba(202,161,90,.12)}
  #gardenCat .gp .e{font-size:24px} #gardenCat .gp .n{font-size:10.5px;color:#d6ccb2}
  #gardenCat .gplan{margin-top:12px;text-align:center;font-size:11.5px;color:#cdbd92;cursor:pointer;padding:8px;
    border-radius:7px;border:1px dashed rgba(202,161,90,.35);background:rgba(255,255,255,.03);transition:.15s}
  #gardenCat .gplan:hover{border-color:rgba(202,161,90,.6);color:#fff7e6}
  #gardenCat .gx{float:left;cursor:pointer;color:#a99b78;font-size:16px}
  /* Pl@ntNet ID + iNaturalist nearby blocks (reuse the brass-on-glass language) */
  #gardenCard .idrow{display:flex;align-items:center;gap:9px}
  #gardenCard .idthumb{width:46px;height:46px;border-radius:7px;object-fit:cover;flex:0 0 auto;
    border:1px solid rgba(202,161,90,.3)}
  #gardenCard .obs{display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid rgba(202,161,90,.1)}
  #gardenCard .obs:first-child{border-top:0}
  #gardenCard .obs.clk{cursor:pointer;border-radius:6px;padding:5px 4px;transition:.15s}
  #gardenCard .obs.clk:hover{background:rgba(202,161,90,.1)}
  #gardenCard .obs img,#gardenCard .obs .ph{width:34px;height:34px;border-radius:6px;object-fit:cover;flex:0 0 auto;
    background:rgba(255,255,255,.05);border:1px solid rgba(202,161,90,.18)}
  #gardenCard .obs .oi{display:flex;flex-direction:column;min-width:0}
  #gardenCard .obs .oi b{font-size:12px;color:#fff7e6;font-weight:600}
  #gardenCard .obs .oi i{font-size:10px;color:#a99b78;font-style:normal;margin-top:1px}
  /* ---- GARDEN OVERVIEW cockpit (all-plants list + planner) ---- */
  #gardenOverview{position:absolute;top:18px;right:22px;width:344px;max-height:calc(100vh - 40px);
    display:none;flex-direction:column;font-family:'Heebo',sans-serif;color:#efe6cf;z-index:9;
    text-shadow:0 1px 2px rgba(0,0,0,.5)}
  #gardenOverview.on{display:flex}
  #gardenOverview .body{overflow-y:auto;padding:14px 15px;border-radius:4px;
    background:linear-gradient(160deg,rgba(12,14,26,.93),rgba(6,7,15,.95));
    backdrop-filter:blur(12px);border:1px solid rgba(202,161,90,.22);box-shadow:0 18px 48px rgba(0,0,0,.55)}
  #gardenOverview .hd{display:flex;align-items:center;justify-content:space-between}
  #gardenOverview h3{font-family:'Frank Ruhl Libre',serif;font-weight:500;font-size:19px;color:#fff7e6}
  #gardenOverview .x{cursor:pointer;color:#a99b78;font-size:15px;line-height:1;border:1px solid rgba(202,161,90,.22);
    border-radius:6px;padding:2px 6px;background:rgba(255,255,255,.03)} #gardenOverview .x:hover{color:#fff7e6}
  #gardenOverview .sub{font-size:10px;color:#a99b78;margin:4px 0 8px;line-height:1.4}
  #gardenOverview .ovq{width:100%;background:#0b1322;border:1px solid rgba(202,161,90,.3);color:#fff;border-radius:7px;
    padding:6px 9px;font-size:12px;font-family:inherit;margin-bottom:6px}
  #gardenOverview .ovhdr{display:flex;gap:8px;font-size:9px;color:#8a7a52;letter-spacing:.04em;padding:0 4px 4px;border-bottom:1px solid rgba(202,161,90,.13)}
  #gardenOverview .ovz{font-family:'Bellefair',serif;letter-spacing:.06em;font-size:12px;color:#caa15a;margin:10px 0 2px;
    display:flex;justify-content:space-between;align-items:baseline;gap:8px}
  #gardenOverview .ovz .ovzm{font-family:'Heebo';font-size:9.5px;color:#8a7a52;text-align:left}
  #gardenOverview .ovrow{display:flex;align-items:center;gap:8px;padding:6px 4px;border-top:1px solid rgba(202,161,90,.08);
    cursor:pointer;border-radius:6px;transition:.12s}
  #gardenOverview .ovrow:hover{background:rgba(202,161,90,.1)}
  #gardenOverview .ove{font-size:16px;flex:0 0 20px;text-align:center}
  #gardenOverview .ovn{flex:1;font-size:12.5px;color:#efe6cf;min-width:0}
  #gardenOverview .ovn .ovst{font-size:9px;color:#a99b78}
  #gardenOverview .ovpot{font-size:9px;color:#8fce8f;background:rgba(143,206,143,.1);
    border:1px solid rgba(143,206,143,.22);border-radius:5px;padding:1px 5px;white-space:nowrap}
  #gardenOverview .ovplaced{font-size:9px;opacity:.85}
  #gardenOverview .ovreal{font-size:9px;opacity:.8}
  #gardenOverview .ovw{flex:0 0 58px;text-align:left;font-size:11px;color:#bcd0e8}
  #gardenOverview .ovfit{flex:0 0 28px;text-align:center;font-size:12px;font-weight:600;color:#a3e635}
  #gardenOverview .ovfit.mid{color:#e0b24a} #gardenOverview .ovfit.lo{color:#c98a8a}
  #gardenOverview .ovfl{flex:0 0 56px;text-align:left;font-size:11px;line-height:1.3;white-space:nowrap}
  #gardenOverview .ovsec{font-family:'Bellefair',serif;letter-spacing:.06em;font-size:12px;color:#8fce8f;
    margin:12px 0 2px;padding-top:8px;border-top:1px solid rgba(202,161,90,.18)}
  #gardenOverview .add{margin-top:10px;font-size:11.5px;color:#cdbd92;background:rgba(255,255,255,.04);
    border:1px dashed rgba(202,161,90,.4);border-radius:7px;padding:7px 10px;text-align:center;cursor:pointer}
  #gardenOverview .add:hover{border-color:rgba(202,161,90,.7);color:#fff7e6}
  #gardenOverview .foot{font-size:9.5px;color:#7d7150;margin-top:10px}
  #gardenOverview .reason{font-size:11px;color:#a99b78}
  /* "worth adding to the garden" candidate suggestions (#6) — same row skin, a why-line + a hint */
  #gardenOverview .ovcsub{font-size:9.5px;color:#8a7a52;font-style:italic;margin:1px 2px 3px;line-height:1.4}
  #gardenOverview .ovcand .ove{align-self:flex-start;padding-top:2px}
  #gardenOverview .ovcand .ovn{display:flex;flex-direction:column;gap:2px}
  #gardenOverview .ovwhy{font-size:9.5px;color:#a99b78;line-height:1.45;font-weight:400}
  /* the magazine entry button in the overview */
  #gardenOverview .magbtn{margin:2px 0 8px;padding:9px 12px;border-radius:8px;cursor:pointer;
    font-family:'Frank Ruhl Libre',serif;font-size:14px;color:#fff7e6;
    background:linear-gradient(150deg,rgba(202,161,90,.18),rgba(202,161,90,.06));
    border:1px solid rgba(202,161,90,.4);transition:.18s;display:flex;align-items:baseline;gap:8px}
  #gardenOverview .magbtn:hover{border-color:rgba(202,161,90,.7);background:linear-gradient(150deg,rgba(202,161,90,.26),rgba(202,161,90,.1))}
  #gardenOverview .magbtn span{font-family:'Heebo';font-size:9.5px;color:#a99b78;letter-spacing:.04em}
  /* ---- the weekly garden MAGAZINE (The Weekly) ---- */
  #gardenMag{position:absolute;top:18px;right:22px;width:384px;max-height:calc(100vh - 40px);
    display:none;flex-direction:column;font-family:'Heebo',sans-serif;color:#efe6cf;z-index:10;
    text-shadow:0 1px 2px rgba(0,0,0,.5)}
  #gardenMag.on{display:flex}
  #gardenMag .body{overflow-y:auto;border-radius:5px;
    background:linear-gradient(165deg,rgba(13,15,28,.96),rgba(7,8,16,.975));
    backdrop-filter:blur(13px);border:1px solid rgba(202,161,90,.26);box-shadow:0 20px 56px rgba(0,0,0,.62)}
  #gardenMag .mast{padding:16px 18px 12px;border-bottom:2px solid rgba(202,161,90,.32);position:relative}
  #gardenMag .mast h2{font-family:'Frank Ruhl Libre',serif;font-weight:500;font-size:25px;color:#fff7e6;line-height:1.1}
  #gardenMag .mast .date{font-family:'Bellefair',serif;font-size:11.5px;color:#caa15a;letter-spacing:.14em;margin-top:4px}
  #gardenMag .mast .x{position:absolute;top:14px;left:14px;cursor:pointer;color:#a99b78;font-size:15px;
    border:1px solid rgba(202,161,90,.22);border-radius:6px;padding:2px 6px;background:rgba(255,255,255,.03)}
  #gardenMag .mast .x:hover{color:#fff7e6}
  #gardenMag .lead{padding:14px 18px 16px;border-bottom:1px solid rgba(202,161,90,.14);
    display:flex;gap:13px;align-items:flex-start;cursor:pointer}
  #gardenMag .lead:hover{background:rgba(202,161,90,.06)}
  #gardenMag .lead .le{font-size:42px;line-height:1;flex:0 0 auto;filter:drop-shadow(0 3px 8px rgba(0,0,0,.55))}
  #gardenMag .lead .lk{font-family:'Bellefair',serif;font-size:9.5px;color:#caa15a;letter-spacing:.16em;margin-bottom:3px}
  #gardenMag .lead .lt{font-family:'Frank Ruhl Libre',serif;font-weight:500;font-size:18px;color:#fff7e6;line-height:1.25}
  #gardenMag .lead .ll{font-size:12px;color:#cdbd92;margin-top:5px;line-height:1.55}
  #gardenMag .dept{padding:12px 18px;border-bottom:1px solid rgba(202,161,90,.1)}
  #gardenMag .dept:last-of-type{border-bottom:0}
  #gardenMag .dh{font-family:'Bellefair',serif;font-size:13px;color:#caa15a;letter-spacing:.08em;
    display:flex;align-items:center;gap:8px;margin-bottom:7px}
  #gardenMag .dh::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,rgba(202,161,90,.32),transparent)}
  #gardenMag .mi{display:flex;align-items:center;gap:8px;padding:5px 4px;border-radius:6px;cursor:pointer;font-size:12.5px}
  #gardenMag .mi:hover{background:rgba(202,161,90,.09)}
  #gardenMag .mi .mie{font-size:16px;flex:0 0 22px;text-align:center}
  #gardenMag .mi .min{flex:1;color:#efe6cf;min-width:0}
  #gardenMag .mi .mid{font-size:10px;color:#a99b78}
  #gardenMag .mi .mik{font-size:9px;color:#8fce8f;background:rgba(143,206,143,.1);border:1px solid rgba(143,206,143,.22);
    border-radius:5px;padding:2px 7px;white-space:nowrap;flex:0 0 auto}
  #gardenMag .mi .mik.on{color:#1a1606;background:#8fce8f;border-color:#8fce8f}
  #gardenMag .note{font-size:12px;color:#d6ccb2;line-height:1.6}
  #gardenMag .note b{color:#fff7e6}
  #gardenMag .spot{display:flex;gap:11px;align-items:flex-start;cursor:pointer;padding:4px;border-radius:7px}
  #gardenMag .spot:hover{background:rgba(202,161,90,.07)}
  #gardenMag .spot .se{font-size:32px;flex:0 0 auto;filter:drop-shadow(0 3px 8px rgba(0,0,0,.5))}
  #gardenMag .spot .st{font-family:'Frank Ruhl Libre',serif;font-size:15px;color:#fff7e6}
  #gardenMag .spot .ss{font-size:11px;color:#bcae86;margin-top:3px;line-height:1.55}
  #gardenMag .magfoot{padding:11px 18px;font-size:9.5px;color:#7d7150;display:flex;justify-content:space-between;align-items:center;gap:10px}
  #gardenMag .magfoot .allbtn{font-size:10.5px;color:#cdbd92;border:1px dashed rgba(202,161,90,.4);border-radius:7px;
    padding:5px 10px;cursor:pointer;white-space:nowrap}
  #gardenMag .magfoot .allbtn:hover{border-color:rgba(202,161,90,.7);color:#fff7e6}
  /* ---- authored plant-data rows (warnings / why-zone / planting window / hardiness) ---- */
  #gardenCard .arow{font-size:11.5px;color:#d6ccb2;line-height:1.5;padding:5px 0;
    border-top:1px solid rgba(202,161,90,.1);display:flex;gap:7px;align-items:flex-start}
  #gardenCard .arow:first-of-type{border-top:0;padding-top:0}
  #gardenCard .arow .ai{flex:0 0 auto;font-size:13px;line-height:1.35}
  #gardenCard .arow .at{flex:1;min-width:0}
  #gardenCard .arow .ak{color:#a99b78}
  #gardenCard .arow b{color:#fff7e6;font-weight:600}
  #gardenCard .arow .anote{display:block;color:#bcb08a;margin-top:2px;font-size:10.5px;line-height:1.45}
  #gardenCard .arow.risk{color:#f0c0a0}
  #gardenCard .arow.risk .ai{color:#e6a35a}
  #gardenCard .arow.ok .ai{color:#8fce8f}
  #gardenCard .arow .xpl-chip{margin-top:1px}
  /* ---- "this week" magazine teaser at the top of the plant card ---- */
  #gardenCard .magteaser{display:flex;align-items:center;gap:8px;margin:9px 0 2px;padding:8px 11px;border-radius:8px;
    cursor:pointer;background:linear-gradient(150deg,rgba(202,161,90,.16),rgba(202,161,90,.05));
    border:1px solid rgba(202,161,90,.36);transition:.18s}
  #gardenCard .magteaser:hover{border-color:rgba(202,161,90,.65);background:linear-gradient(150deg,rgba(202,161,90,.24),rgba(202,161,90,.09))}
  #gardenCard .magteaser .mte{font-size:18px;flex:0 0 auto}
  #gardenCard .magteaser .mtt{flex:1;min-width:0;font-size:11.5px;color:#fff7e6;line-height:1.4}
  #gardenCard .magteaser .mtt span{display:block;font-family:'Bellefair',serif;letter-spacing:.1em;font-size:9px;color:#caa15a}
  #gardenCard .magteaser .mtgo{flex:0 0 auto;font-size:14px;color:#caa15a}
  /* ---- dated photo strip (p.photos[], up to 6) ---- */
  #gardenCard .photostrip{display:flex;gap:6px;overflow-x:auto;padding:2px 0 1px;margin-top:3px}
  #gardenCard .photostrip .pcell{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:2px}
  #gardenCard .photostrip img{width:54px;height:54px;border-radius:7px;object-fit:cover;
    border:1px solid rgba(202,161,90,.28);background:rgba(255,255,255,.04)}
  #gardenCard .photostrip .pcd{font-size:8.5px;color:#8a7a52;white-space:nowrap}
  @media(max-width:960px){
    #gardenCard,#gardenOverview,#gardenMag{width:calc(100vw - 24px);max-width:none;right:12px;left:12px;top:10px;max-height:calc(100vh - 20px)}
    #gardenAdd{bottom:auto;top:auto}
  }
  `;

  /* ---------------- the plant card ---------------- */
  let card=null, body=null, cur=null, _instPrev=null, catBox=null;
  // iNaturalist "seen near you" per-plant cache (undefined=not yet fetched, []=fetched-empty)
  const _obsCache={};
  // ONE shared hidden file input for the Pl@ntNet "📷 photograph & identify" flow
  let _fileInput=null;
  // iNat query name for a plant: prefer the curated/catalog name_latin, else a Pl@ntNet ID
  function obsName(p){ const m=plantMeta(p.id)||{}; return m.name_latin||p.id_latin||null; }
  // one nearby-observation row, mirroring panels.js sightHtml re-skinned to #gardenCard classes
  function obsRow(o){
    const hasGeo=o&&isFinite(o.lng)&&isFinite(o.lat);
    const attrs=hasGeo?` class="obs clk" data-act="flyobs" data-lng="${o.lng}" data-lat="${o.lat}"`:' class="obs"';
    return `<div${attrs}>${o.photo?`<img src="${esc(o.photo)}">`:'<span class="ph"></span>'}`+
      `<span class="oi"><b>${esc(o.name||'—')}</b>`+
      `<i>${esc(o.date||'')}${o.place?' · '+esc(o.place):''}</i></span></div>`;
  }
  function loadObs(p){
    if(_obsCache[p.id]!==undefined) return;
    const nm=obsName(p);
    if(!nm){ _obsCache[p.id]=[]; return; }
    _obsCache[p.id]=null; // in-flight sentinel
    const want=p.id;
    if(!(window.Derive&&Derive.fetchObservations)){ _obsCache[p.id]=[]; return; }
    Derive.fetchObservations({taxon_name:nm, radiusKm:15}).then(r=>{
      _obsCache[want]=Array.isArray(r)?r:[];
      if(cur===want) render();
    }).catch(()=>{ _obsCache[want]=[]; if(cur===want) render(); });
  }
  /* ---- EMBEDDED-skin shim: re-scope the overview's look for the yard tab ----------
     The whole overview stylesheet is scoped under "#gardenOverview …". When the
     overview is mounted INSIDE the #inst yard tab (renderOverviewInto → #yard-garden),
     none of those rules would match, so the plant table / magazine / recommendations
     would render unstyled. Mirroring panels.js's own "#inst2" approach, we duplicate
     just the overview's DESCENDANT rules ("#gardenOverview .x" / "#gardenOverview h3")
     with the prefix swapped to "#yard-garden", so the embedded markup gets the exact
     same brass-on-glass skin. We deliberately DROP the bare "#gardenOverview{…}" /
     ".on" base rules (those float/position/hide the standalone panel — wrong for an
     in-tab block; #inst's own .body already provides the scrim/padding). */
  function overviewEmbedCSS(){
    return CSS.split('}')
      .filter(chunk=>{
        const sel=chunk.split('{')[0];
        if(!/#gardenOverview/.test(sel)) return false;          // overview rules only
        if(/#gardenCard|#gardenMag/.test(sel)) return false;    // skip the shared mobile group rule
        // keep only descendant/compound selectors, not the bare base/visibility rules
        return /#gardenOverview\s+\S/.test(sel) || /#gardenOverview\s*h3/.test(sel);
      })
      .map(chunk=>chunk.replace(/#gardenOverview/g,'#yard-garden')+'}')
      .join('\n');
  }
  function ensureCSS(){
    if(!document.getElementById('gardenCSS')){ const s=el('style',null,CSS); s.id='gardenCSS'; document.head.appendChild(s); }
    if(!document.getElementById('gardenEmbedCSS')){ const s2=el('style',null,overviewEmbedCSS()); s2.id='gardenEmbedCSS'; document.head.appendChild(s2); }
  }
  function ensure(){
    if(card) return;
    ensureCSS();
    card=el('div'); card.id='gardenCard'; card.setAttribute('dir','ltr');
    body=el('div','body'); card.appendChild(body); document.body.appendChild(card);
    body.addEventListener('click',onClick);
    body.addEventListener('input',onInput);
    body.addEventListener('change',onChange);
    // ONE hidden file input, reused for every plant's identify tap
    _fileInput=el('input'); _fileInput.type='file'; _fileInput.accept='image/*';
    _fileInput.setAttribute('capture','environment'); _fileInput.style.display='none';
    _fileInput.addEventListener('change',onPhotoPicked);
    document.body.appendChild(_fileInput);
  }
  async function onPhotoPicked(e){
    const file=e.target&&e.target.files&&e.target.files[0];
    if(_fileInput) _fileInput.value=''; // allow re-picking the same file
    const p=plant(cur); if(!file||!p) return;
    if(!(window.GardenID)) return;
    if(GardenID.hasKey&&!GardenID.hasKey()){
      if(GardenID.promptKey){ const k=GardenID.promptKey(); if(!k) return; }
      else return;
    }
    try{
      const down = GardenID.downscale ? await GardenID.downscale(file,1024) : {blob:file,dataUrl:null};
      const res  = await GardenID.identify(down.blob||file);
      if(res){
        if(res.latin) p.id_latin=res.latin;
        if(res.common) p.id_common=res.common;
        if(res.score!=null) p.id_score=res.score;
        p.id_at=Date.now();
        if(down.dataUrl){
          if(!Array.isArray(p.photos)) p.photos=[];
          p.photos.unshift({dataUrl:down.dataUrl, date:new Date().toLocaleDateString('he-IL')});
          if(p.photos.length>6) p.photos.length=6; // cap base64 for ~5MB localStorage
        }
        // a fresh ID means a fresh iNat species → invalidate that plant's cache
        delete _obsCache[p.id];
        save();
      }
    }catch(err){}
    render();
  }
  function hideInst(){ const i=document.querySelector('#inst:not(.inst-embed)'); if(i&&_instPrev===null){ _instPrev=i.style.display; i.style.display='none'; } }
  function restoreInst(){ const i=document.querySelector('#inst:not(.inst-embed)'); if(i&&_instPrev!==null){ i.style.display=_instPrev; } _instPrev=null; }

  function waterWeekly(p,season){
    const meta=plantMeta(p.id)||{}; const base=meta[WATER_FIELD[season]];
    const potted=!!(p&&p.pot>0);
    // curated per-season anchor assumes IN-GROUND; for a pot we recompute from ETc ×
    // the pot's footprint so the amount reflects the actual container.
    let v = (base!=null && !potted) ? base : null;
    if(v==null){
      const prof=profileOfPlant(p,season), etc=prof?(prof.ETc||0):null;
      if(etc!=null){ const area=potted?potTopArea(p.pot)*POT_CANOPY_SPREAD:1.0; v=Math.round(etc*(meta.kc||0.8)*7*area*10)/10; }
    }
    if(v==null) return null;
    return Math.round(v*(1+(p.water_adjust_pct||0)/100)*10)/10;
  }

  /* ---------------- care calendar card (PlantCare, "care this month") ----------------
     A baked per-plant month-by-month task list (when to fertilize/prune/thin/
     harvest…) + companion/pollinator notes, surfaced as one more .card right
     after fitHtml. Each task has a 🔔 chip that pushes it to LogStore 'schedule'
     so the existing Alerts engine reminds Alex. Care content is GENERAL the highlands-rim
     guidance (disclaimer shown), not a prescription. */
  const HE_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  function careCard(p){
    if(!window.PlantCare) return '';
    const nm=obsName(p);                       // name_latin join key (curated/catalog or a Pl@ntNet ID)
    if(!nm || !PlantCare.has(nm)) return '';   // no baked calendar for this plant → no card (honest)
    const mi=new Date().getMonth();
    const tasks=PlantCare.tasksFor(nm,mi)||[];
    const comps=PlantCare.companionsFor(nm)||[];
    const polls=PlantCare.pollinatorsFor(nm)||[];
    const compTip=(PlantCare.companionTipFor&&PlantCare.companionTipFor(nm))||'';   // #15 actionable
    const pollTip=(PlantCare.pollinatorTipFor&&PlantCare.pollinatorTipFor(nm))||''; // #15 actionable
    const pests=(PlantCare.pestsFor&&PlantCare.pestsFor(nm))||[];                    // #14 pests
    const due=PlantCare.dueDateForThisMonth(7);
    let html=`<div class="card"><div class="ct">Care this month · ${HE_MONTHS[mi]}</div>`;
    if(tasks.length){
      html+=`<div class="caretasks">`+tasks.map((t,i)=>{
        const km=PlantCare.kindMeta(t.kind)||{};
        return `<div class="caretask"><span class="ce">${km.emoji||'•'}</span>`+
          `<span class="ctx">${esc(t.task_he)}</span>`+
          `<span class="chip cadd" data-act="caretask" data-i="${i}" `+
            `data-task="${esc(t.task_he)}" data-kind="${esc(t.kind||'')}" data-due="${esc(due)}">🔔 Add</span>`+
          `</div>`;
      }).join('')+`</div>`;
    } else {
      html+=`<div class="reason">No special tasks this month — carry on with the routine.</div>`;
    }
    if(comps.length||polls.length||compTip||pollTip){
      html+=`<div class="best">`+
        (comps.length?`🤝 Good companions: ${esc(comps.join(' · '))}`:'')+
        (compTip?`${comps.length?'<br>':''}<span class="caretip">${esc(compTip)}</span>`:'')+
        ((comps.length||compTip)&&(polls.length||pollTip)?`<br>`:'')+
        (polls.length?`🐝 ${esc(polls.join(' · '))}`:'')+
        (pollTip?`${polls.length?'<br>':''}<span class="caretip">${esc(pollTip)}</span>`:'')+
        `</div>`;
    }
    // #14 — common high-the highlands pests for this crop: how to spot + an organic-first remedy
    if(pests.length){
      html+=`<div class="best"><div class="pesthd">🐜 Common pests</div>`+
        pests.map(x=>`<div class="pest"><b>${esc(x.name_he)}</b>`+
          (x.sign_he?`<span class="psign">🔍 ${esc(x.sign_he)}</span>`:'')+
          (x.remedy_he?`<span class="prem">🌿 ${esc(x.remedy_he)}</span>`:'')+
          `</div>`).join('')+`</div>`;
    }
    html+=`<div class="cdisc">${esc(PlantCare.disclaimer()||'')}</div></div>`;
    return html;
  }

  /* ================= HONESTY SPINE: real measured history + model forecast =================
     For any quantity that BOTH the Living Record (RecordStore) and the model can give
     (DLI / sun-hours / frost / GDD / water), PREFER the measured record when it covers
     the date, else fall back to the model — and LABEL which is showing. Per the
     integration spec: if RecordStore.status().days===0 we show the MODEL, labelled
     "model · estimate"; otherwise we show the MEASURED totals, labelled "based on real measurements".
     Both blocks are fully DEFENSIVE — guarded on window.RecordStore / window.Predict,
     never throw, never block on the idle backfill (days===0 tolerated). ============== */
  const _r1=v=>(v==null||!isFinite(v))?null:Math.round(v*10)/10;
  const _r0=v=>(v==null||!isFinite(v))?null:Math.round(v);
  function _isoUTC(d){ return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0'); }
  function _isoDaysAgo(n){ const d=new Date(); return _isoUTC(new Date(d.getTime()-n*864e5)); }
  function _ddmm(iso){ const p=String(iso||'').slice(0,10).split('-'); return (p[2]&&p[1])?(p[2]+'/'+p[1]):(iso||'—'); }
  // a model-derived estimate of the SAME totals, for the days===0 fallback. Built from
  // the plant's own cell seasonal profile × ~365 days so the labels stay parallel.
  function _modelTotals(p){
    const prof=profileOfPlant(p,DOC.season); if(!prof) return null;
    // crude annual estimate: per-day model values × 365 (clearly labelled "model · estimate")
    const litresWk=waterWeekly(p,DOC.season);
    return {
      dliSum:(prof.DLI!=null)?prof.DLI*365:null,
      sunHoursSum:(prof.sunHours!=null)?prof.sunHours*365:null,
      etcSum:(prof.ETc!=null)?prof.ETc*365:null,
      waterWk:litresWk
    };
  }
  /* "how it actually was so far" — the real-data block on the per-plant card. */
  function realHistoryCard(p){
    const RS=window.RecordStore; if(!RS) return '';            // not wired → no block (honest)
    let st={}; try{ st=(RS.status&&RS.status())||{}; }catch(e){ st={}; }
    const days=st.days||0;
    // MEASURED path — the Living Record covers real dates → show it, labelled real.
    if(days>0 && RS.plantTotals){
      const from=st.firstDate||_isoDaysAgo(365), to=st.lastDate||_isoUTC(new Date());
      let tot=null; try{ tot=RS.plantTotals(p.id,from,to); }catch(e){ tot=null; }
      if(tot && tot.days){
        let h=`<div class="card"><div class="ct lr">How it actually was so far <span class="lab real">Based on real measurements</span></div>`+
          `<div class="zg">`+
          `<span class="k">Days recorded</span><b>${tot.days}</b>`+
          `<span class="k">Frost nights</span><b>${tot.frostNights}</b>`+
          `<span class="k">Total DLI</span><b>${_r0(tot.dliSum)} mol/m²</b>`+
          `<span class="k">Sun hours</span><b>${_r0(tot.sunHoursSum)} h</b>`+
          `<span class="k">Accumulated GDD</span><b>${_r0(tot.gddSum)}</b>`+
          `<span class="k">Water (ETc)</span><b>${_r1(tot.etcSum)} mm</b>`+
          `<span class="k">Rain received</span><b>${_r1(tot.rainSum)} mm</b>`+
          (tot.tMinAbs!=null?`<span class="k">Coldest low</span><b>${_r1(tot.tMinAbs)}°</b>`:'')+
          `</div>`;
        // GDD-toward-fruit gauge (measured accumulation vs the curated varietal threshold)
        const meta=plantMeta(p.id)||{};
        if(meta.gdd_to_fruit>0 && tot.gddSum!=null){
          const pct=Math.max(0,Math.min(100,Math.round(100*tot.gddSum/meta.gdd_to_fruit)));
          h+=`<div class="lrrow"><span>Heat accumulation toward fruit (measured)</span><b>${_r0(tot.gddSum)} / ${meta.gdd_to_fruit}</b></div>`+
             `<div class="zbar" style="height:7px;border-radius:20px;background:rgba(255,255,255,.07);overflow:hidden;margin-top:5px">`+
             `<i style="display:block;height:100%;border-radius:20px;width:${pct}%;background:linear-gradient(90deg,#4da866,#e6bd4d,#db4d38)"></i></div>`;
        }
        h+=`<div class="lrbasis">${esc(st.note_he||'Based on real measurements (Open-Meteo) through the house geometry — not a physical sensor')}`+
          (st.firstDate?` · ${_ddmm(st.firstDate)}–${_ddmm(st.lastDate)}`:'')+`</div></div>`;
        return h;
      }
    }
    // FALLBACK path — days===0 (still building / nothing yet) → show the MODEL, labelled.
    const mt=_modelTotals(p);
    let h=`<div class="card"><div class="ct lr">How it actually was so far <span class="lab model">Model · estimate</span></div>`;
    if(st.building){
      h+=`<div class="reason">Building the log${st.pct!=null?(' · '+st.pct+'%'):''}… meanwhile — a model estimate.</div>`;
    } else {
      h+=`<div class="reason">No recorded days yet — a model estimate is shown until real records accumulate.</div>`;
    }
    if(mt){
      h+=`<div class="zg" style="margin-top:7px">`+
        (mt.dliSum!=null?`<span class="k">DLI (~year)</span><b>~${_r0(mt.dliSum)} mol/m²</b>`:'')+
        (mt.sunHoursSum!=null?`<span class="k">Sun (~year)</span><b>~${_r0(mt.sunHoursSum)} h</b>`:'')+
        (mt.etcSum!=null?`<span class="k">Water (ETc ~year)</span><b>~${_r1(mt.etcSum)} mm</b>`:'')+
        (mt.waterWk!=null?`<span class="k">Irrigation/week</span><b>~${mt.waterWk} L</b>`:'')+
        `</div>`;
    }
    h+=`<div class="lrbasis">An estimate from the physical model for the point (not a measurement). Once real records accumulate — it will be replaced by the measured value.</div></div>`;
    return h;
  }
  /* model basis → a real|model pill (Predict carries its own honest basis per field) */
  function _basisLab(basis){
    const b=String(basis||'').toLowerCase();
    return (b.indexOf('real')>=0) ? '<span class="lab real">Measured</span>' : '<span class="lab model">Model</span>';
  }
  /* Predict outlook — best window / season forecast / frost, each with its OWN basis +
     confidence. Snapshot is pulled async (loadPredictFor) and cached; render is sync. */
  const _predCache={};
  function loadPredictFor(id){
    const P=window.Predict; if(!P) return;
    const zid=(plant(id)||{}).zoneId||null;
    const apply=()=>{
      const snap={};
      try{ snap.win=P.bestWindow?P.bestWindow(id):null; }catch(e){ snap.win=null; }
      try{ snap.season=P.seasonForecast?P.seasonForecast(id):null; }catch(e){ snap.season=null; }
      try{ snap.frost=P.frostDates?P.frostDates():null; }catch(e){ snap.frost=null; }
      try{ snap.water=(P.waterForecast&&zid)?P.waterForecast(zid,7):null; }catch(e){ snap.water=null; }
      _predCache[id]=snap;
      if(cur===id && card && card.classList.contains('on')) render();
    };
    try{ if(P.ready && typeof P.ready.then==='function'){ P.ready.then(apply).catch(apply); } else apply(); }
    catch(e){ try{ apply(); }catch(_){} }
  }
  function forecastCard(p){
    const P=window.Predict; if(!P) return '';                  // not wired → no block (honest)
    const snap=_predCache[p.id];
    if(snap===undefined){ loadPredictFor(p.id);                // kick the async pull, show a placeholder
      return `<div class="card"><div class="ct lr">Forecast ahead <span class="lab model">Forecast</span></div><div class="reason">Computing forecast…</div></div>`; }
    let h=`<div class="card"><div class="ct lr">Forecast ahead <span class="lab model">Forecast — not a fact</span></div>`;
    let any=false;
    if(snap && snap.win && (snap.win.windowStart||snap.win.windowEnd)){ any=true;
      h+=`<div class="lrrow"><span>Recommended window ${_basisLab(snap.win.basis)}</span>`+
        `<b>${esc(_ddmm(snap.win.windowStart)||'—')}–${esc(_ddmm(snap.win.windowEnd)||'—')}</b></div>`+
        (snap.win.reason_he?`<div class="lrbasis">${esc(snap.win.reason_he)}</div>`:'');
    }
    if(snap && snap.season){ const s=snap.season; any=true;
      const bits=[];
      if(s.gddToDate!=null) bits.push(`GDD ${_r0(s.gddToDate)}${s.gddExpected!=null?(' / '+_r0(s.gddExpected)):''}`);
      if(s.chillToDate!=null) bits.push(`Chill ${_r0(s.chillToDate)}${s.chillExpected!=null?(' / '+_r0(s.chillExpected)):''}`);
      h+=`<div class="lrrow"><span>Season so far ${_basisLab(s.basis)}</span><b>${bits.join(' · ')||'—'}</b></div>`+
        (s.note_he?`<div class="lrbasis">${esc(s.note_he)}</div>`:'');
    }
    if(snap && snap.frost && (snap.frost.lastFrostEst||snap.frost.firstFrostEst)){ const f=snap.frost; any=true;
      h+=`<div class="lrrow"><span>Estimated last/first frost ${_basisLab(f.basis)}</span>`+
        `<b>${esc(_ddmm(f.lastFrostEst)||'—')} · ${esc(_ddmm(f.firstFrostEst)||'—')}</b></div>`+
        (f.confidence_he?`<div class="lrbasis">Confidence: ${esc(f.confidence_he)}${f.n_years?(' · '+f.n_years+' years'):''}</div>`:'');
    }
    if(snap && snap.water && snap.water.totalLiters!=null){ const w=snap.water; any=true;
      h+=`<div class="lrrow"><span>Water next week ${_basisLab(w.basis)}</span><b>~${_r1(w.totalLiters)} L</b></div>`+
        (w.note_he?`<div class="lrbasis">${esc(w.note_he)}</div>`:'');
    }
    if(!any) h+=`<div class="reason">No forecast available for this plant yet.</div>`;
    h+=`<div class="lrbasis">Each row carries its own basis tag (measured / model). A forecast is an estimate, not a fact.</div></div>`;
    return h;
  }

  /* ---------------- lifecycle card (pillar 3): planting date → age, next harvest,
     the plant's year, and his-site heat/chill suitability ----------------
     • Age is exact (from Alex's planting date). • The harvest window + the 12-month
       timeline come from the baked care calendar (real per-plant harvest/bloom/prune
       months). • The heat/chill line is the hyper-local gem: his rim site's derived
       winter chill-hours + growing-season GDD vs THIS plant's chill_hours_req /
       gdd_to_fruit — "will my desert spot chill this enough to fruit?" (labelled est). */
  const TL_MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function todayISO(){ const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10); }
  function ageText(iso){
    if(!iso) return null; const d=new Date(iso); if(isNaN(d.getTime())) return null;
    const now=new Date(); const days=Math.floor((now-d)/864e5); if(days<0) return null;
    let mo=(now.getFullYear()-d.getFullYear())*12+(now.getMonth()-d.getMonth()); if(now.getDate()<d.getDate()) mo--;
    if(mo<1) return days<=1?'Planted yesterday':`Planted ${days} days ago`;
    const y=Math.floor(mo/12), m=mo%12, parts=[];
    if(y) parts.push(y===1?'1 year':`${y} years`);
    if(m) parts.push(m===1?'1 month':`${m} months`);
    return 'Planted '+parts.join(' and ')+' ago';
  }
  function lifecycleEvents(p){            // [ [kinds…] × 12 ] from the care calendar, or null
    const nm=obsName(p); if(!nm||!window.PlantCare||!PlantCare.has(nm)) return null;
    const out=[]; for(let m=0;m<12;m++) out.push((PlantCare.tasksFor(nm,m)||[]).map(t=>t.kind));
    return out;
  }
  function headlineKind(kinds){
    if(kinds.indexOf('harvest')>=0) return 'h';
    if(kinds.indexOf('plant')>=0||kinds.indexOf('propagate')>=0) return 'g';
    if(kinds.indexOf('prune')>=0) return 'p';
    return kinds.length?'c':'';
  }
  const TL_EMOJI={h:'🧺',g:'🌱',p:'✂️',c:'','':''};
  function harvestInfo(ev){
    if(!ev) return null; const hM=[]; ev.forEach((k,m)=>{ if(k.indexOf('harvest')>=0) hM.push(m); });
    if(!hM.length) return null;
    const cur=new Date().getMonth(); let next=hM.find(m=>m>=cur); if(next==null) next=hM[0];
    const set=new Set(hM); let a=next,b=next;
    while(set.has((a-1+12)%12)&&(a-1+12)%12!==b) a=(a-1+12)%12;
    while(set.has((b+1)%12)&&(b+1)%12!==a) b=(b+1)%12;
    return { next, window:[a,b], inSeason:set.has(cur), monthsAway:((next-cur)+12)%12 };
  }
  function lifecycleCard(p){
    const meta=plantMeta(p.id)||{}, ev=lifecycleEvents(p), age=ageText(p.planted);
    let html=`<div class="card"><div class="ct">Life cycle</div>`+
      `<div class="plrow"><label>Planting date</label>`+
      `<input type="date" class="pldate" data-act="planted" value="${esc(p.planted||'')}" max="${todayISO()}"></div>`;
    if(age) html+=`<div class="agerow">🌱 ${age}</div>`;
    if(ev){
      const cur=new Date().getMonth();
      html+=`<div class="timeline">`+ev.map((k,m)=>{ const hk=headlineKind(k);
        return `<div class="tlc ${hk}${m===cur?' now':''}" title="${HE_MONTHS[m]}${k.length?' · '+k.join(', '):''}">`+
          `<span class="tle">${TL_EMOJI[hk]}</span><span class="tlm">${TL_MON[m]}</span></div>`; }).join('')+`</div>`;
      const hv=harvestInfo(ev);
      if(hv){ const w=hv.window, win=w[0]===w[1]?HE_MONTHS[w[0]]:`${HE_MONTHS[w[0]]}–${HE_MONTHS[w[1]]}`;
        const away=hv.inSeason?'In season now ✓':(hv.monthsAway<=1?'Soon':`In ~${hv.monthsAway} months`);
        html+=`<div class="lcrow">🧺 <b>Next harvest:</b> ${win} · ${away}</div>`; }
    }
    const hc=(window.Derive&&Derive.siteHeatChill)?Derive.siteHeatChill():null;
    if(hc&&(meta.chill_hours_req||meta.gdd_to_fruit)){
      const bits=[];
      if(meta.chill_hours_req){ const ok=hc.chillHours>=meta.chill_hours_req;
        bits.push(`Chill ~${hc.chillHours}/${meta.chill_hours_req} ${ok?'✓':'⚠️'}`); }
      if(meta.gdd_to_fruit){ const ok=hc.gddGrowing>=meta.gdd_to_fruit;
        bits.push(`Heat ~${hc.gddGrowing}/${meta.gdd_to_fruit} ${ok?'✓':'⚠️'}`); }
      html+=`<div class="lcrow" title="Winter chill accumulation and seasonal heat units (GDD) at Alex's site vs the plant's requirements">🌡️ <b>Climate at the site:</b> ${bits.join(' · ')}</div>`;
    }
    html+=`<div class="cdisc">Exact age · harvest window from the calendar · climate = local estimate</div></div>`;
    return html;
  }

  /* ---------------- authored plant data (curated JSON) as plain card rows ----------------
     resident_plants.json carries per-plant fields a human authored — why this is the best
     zone (zone_reason_he), the planting window (planting_months_he + planting_note_he),
     species hardiness limits (frost_hardy_c / t_max_tol) and free-text warnings_he.
     Until now only warnings/zone_reason were used as a magazine BLURB fallback; here
     they become explicit rows on the plant card. The two hardiness numbers are
     cross-checked against THIS plant's derived microclimate (winter frost-screen dawn
     temp / summer canopy-air peak) and flagged ⚠️ when the site sits past the limit. */
  // mount any deferred Explain "?" chips after innerHTML is written (cards rebuild on
  // every render; chips are real DOM nodes, so we re-attach them post-paint).
  let _pendingChips=[];
  function flushChips(){
    if(!_pendingChips.length) return;
    const list=_pendingChips; _pendingChips=[];
    if(!(window.Explain&&Explain.chip)) return;
    list.forEach(({sel,model})=>{ const slot=body&&body.querySelector(sel); if(!slot) return;
      try{ const c=Explain.chip(model); if(c) slot.appendChild(c); }catch(e){} });
  }
  function chipSlot(id,model){ _pendingChips.push({sel:`[data-xpl="${id}"]`,model}); return `<span data-xpl="${id}"></span>`; }
  function authoredCard(p){
    const m=plantMeta(p.id)||{};
    const months=Array.isArray(m.planting_months_he)?m.planting_months_he.filter(Boolean):[];
    const warns=Array.isArray(m.warnings_he)?m.warnings_he.filter(Boolean):[];
    const hasHardy=(m.frost_hardy_c!=null||m.t_max_tol!=null);
    if(!m.zone_reason_he && !months.length && !m.planting_note_he && !warns.length && !hasHardy) return '';
    let html=`<div class="card"><div class="ct">From the guide · ${esc(p.name_he||m.name_he||p.id)}</div>`;
    // why this zone
    if(m.zone_reason_he){
      html+=`<div class="arow"><span class="ai">📍</span><span class="at">`+
        `<span class="ak">Why ${esc(zoneHe(m.best_zone_id||p.zoneId))}? </span>${esc(m.zone_reason_he)}</span></div>`;
    }
    // planting window + note
    if(months.length||m.planting_note_he){
      html+=`<div class="arow"><span class="ai">🗓️</span><span class="at">`+
        (months.length?`<span class="ak">Planting window: </span><b>${esc(months.join(' · '))}</b>`:'')+
        (m.planting_note_he?`<span class="anote">${esc(m.planting_note_he)}</span>`:'')+`</span></div>`;
    }
    // hardiness limits, each cross-checked against the plant's derived microclimate.
    if(m.frost_hardy_c!=null){
      const wp=profileOfPlant(p,'winter');
      const dawn=wp?(wp.frostTdawn!=null?wp.frostTdawn:wp.Tdawn):null;
      const risk=(dawn!=null && dawn<m.frost_hardy_c);
      const cls=dawn==null?'':(risk?' risk':' ok');
      let txt=`<span class="ak">Cold hardiness: </span>down to <b>${m.frost_hardy_c}°C</b>`;
      if(dawn!=null) txt+= risk
        ? `<span class="anote">⚠️ Winter dawn minimum at the point ~${dawn}°C — below the threshold; cold risk. Covering on cold nights is recommended.</span>`
        : `<span class="anote">Winter dawn minimum at the point ~${dawn}°C — within range ✓</span>`;
      html+=`<div class="arow${cls}"><span class="ai">${risk?'❄️':'❄️'}</span><span class="at">${txt}`+
        chipSlot('frost-'+p.id,{ title:'Cold hardiness', estimate:true,
          summary:'The varietal threshold (frost_hardy_c) from the guide vs the computed winter dawn minimum at the plant\'s exact point.',
          gloss:'The variety\'s cold hardiness vs the cold at the point.',
          data:[{k:'Variety threshold',v:m.frost_hardy_c+'°C'},{k:'Winter dawn minimum (point)',v:(dawn!=null?dawn+'°C':'—')}],
          assumptions:['The dawn minimum accounts for cold-air drainage (an elevated spot stays warmer) and radiative cooling.','A climatic estimate — not a field measurement.'],
          sources:[{label:'The plant guide (resident_plants.json)'}] })+
        `</span></div>`;
    }
    if(m.t_max_tol!=null){
      const sp=profileOfPlant(p,'summer');
      const peak=sp?(sp.airPeak!=null?sp.airPeak:sp.Tpeak):null;
      const risk=(peak!=null && peak>m.t_max_tol);
      const cls=peak==null?'':(risk?' risk':' ok');
      let txt=`<span class="ak">Heat threshold: </span>up to <b>${m.t_max_tol}°C</b>`;
      if(peak!=null) txt+= risk
        ? `<span class="anote">⚠️ Summer heat peak at the point ~${peak}°C — above the threshold; heat-stress risk. Midday shading will help.</span>`
        : `<span class="anote">Summer heat peak at the point ~${peak}°C — within range ✓</span>`;
      html+=`<div class="arow${cls}"><span class="ai">🌡️</span><span class="at">${txt}`+
        chipSlot('heat-'+p.id,{ title:'Heat threshold', estimate:true,
          summary:'The varietal heat ceiling (t_max_tol) from the guide vs the computed summer canopy-air heat peak at the point.',
          gloss:'The variety\'s heat tolerance vs the heat peak at the point.',
          data:[{k:'Variety threshold',v:m.t_max_tol+'°C'},{k:'Summer air heat peak (point)',v:(peak!=null?peak+'°C':'—')}],
          assumptions:['The heat peak is canopy-air (seasonal peak + the sheltered-cell Δ), not hot bare soil.','A climatic estimate — not a field measurement.'],
          sources:[{label:'The plant guide (resident_plants.json)'}] })+
        `</span></div>`;
    }
    // free-text warnings (authored), each on its own row.
    warns.forEach(w=>{ html+=`<div class="arow"><span class="ai">⚠️</span><span class="at">${esc(w)}</span></div>`; });
    html+=`<div class="cdisc">From the local guide · hardiness comparison = climatic estimate</div></div>`;
    return html;
  }

  /* ---------------- 🌱 Planting & cultivation (planting & care advice) ----------------
     Per-plant horticultural guidance from data/planting_tips.json — grounded in HIS
     site soil (X1 / USDA Aridisols-Cambids: shallow, calcareous, loess-over-rock,
     ~1700–1800 mm/yr evaporation, aridic) and in species lore. Four practical rows:
     SOIL prep (deep holes through rock, organic amendment, drainage, lime/salinity),
     POT vs GROUND (+ pot size in L when potted), FERTILIZER (what + when), and SPECIAL
     needs (frost, pruning, pollination partner, wind…). Renders NOTHING if no tip
     matches the open plant. General guidance for his conditions — not a guarantee. */
  function plantingCard(p){
    const t=tipFor(p); if(!t) return '';
    const rows=[];
    if(t.soil_he)        rows.push(['🪨','Soil',  t.soil_he]);
    if(t.container_he)   rows.push(['🪴','Pot or ground', t.container_he]);
    if(t.fertilizer_he)  rows.push(['🌾','Fertilizing',  t.fertilizer_he]);
    if(t.special_he)     rows.push(['✨','Special',    t.special_he]);
    if(!rows.length) return '';
    let html=`<div class="card"><div class="ct">🌱 Planting & cultivation</div>`+
      rows.map(([ic,k,v])=>`<div class="arow"><span class="ai">${ic}</span>`+
        `<span class="at"><span class="ak">${esc(k)}: </span>${esc(v)}</span></div>`).join('');
    // sources (ids → label from _meta if loadable; else show the raw id list)
    const srcs=Array.isArray(t.sources)?t.sources.filter(Boolean):[];
    const srcTxt=srcs.length?(' · Sources: '+srcs.map(esc).join(', ')):'';
    html+=`<div class="cdisc">General guidance for the site conditions (X1 / Aridisols soil, high evaporation) — not a guarantee${srcTxt}</div></div>`;
    return html;
  }

  /* ---- "this week" magazine teaser at the top of the card → one click into the issue ---- */
  function magTeaserHtml(){
    const season=DOC.season;
    const lead=magLead(season, spotlightPlant());
    const hN=magHarvest().filter(x=>x.hs.inSeason).length;
    const tN=magTasks().length;
    let line = lead ? esc(lead.title)
      : (hN?`🧺 ${hN} plants in harvest season`
        : (tN?`🔔 ${tN} tasks this week`:'Your garden this week'));
    const extra=[]; if(hN) extra.push(`🧺 ${hN}`); if(tN) extra.push(`🔔 ${tN}`);
    return `<div class="magteaser" data-act="openmag"><span class="mte">📖</span>`+
      `<span class="mtt"><span>The Weekly</span>${line}${extra.length?` · ${extra.join(' · ')}`:''}</span>`+
      `<span class="mtgo">←</span></div>`;
  }

  /* ---- dated photo strip from p.photos[] (up to 6 stored; show them all, newest→oldest) ---- */
  function photoStripHtml(p){
    const ph=Array.isArray(p.photos)?p.photos.filter(x=>x&&x.dataUrl):[];
    if(ph.length<2) return '';                 // photos[0] already shown as the ID thumb
    return `<div class="lbl">Photos over time <span class="sublbl">(${ph.length})</span></div>`+
      `<div class="photostrip">`+ph.map(x=>`<div class="pcell">`+
        `<img src="${esc(x.dataUrl)}" alt="">`+
        `<span class="pcd">${esc(x.date||'')}</span></div>`).join('')+`</div>`;
  }
  function render(){
    const p=plant(cur); if(!p){ return; }
    const meta=plantMeta(p.id)||{}; const season=DOC.season;
    const prof=profileOfPlant(p,season);
    const fit=fitInForPlant(p,season);
    const litres=waterWeekly(p,season);
    const sc=fit?fit.score:null, scCls=sc==null?'':sc>=66?'':sc>=40?'mid':'lo';
    const bz=bestZone(p.id,season);
    const zoneSel=`<select data-act="zone">${ZONES.map(z=>`<option value="${z.id}"${z.id===p.zoneId?' selected':''}>${z.emoji} ${z.name_he}</option>`).join('')}</select>`;
    const seasonChips=`<span class="chips">${SEASONS.map(([k,l])=>`<span class="chip season${k===season?' on':''}" data-act="season" data-s="${k}">${l}</span>`).join('')}</span>`;
    let mc='';
    if(prof){
      const fr=prof.frost?'high':((prof.frostTdawn!=null?prof.frostTdawn:prof.Tdawn)<=3?'medium':'low');
      mc=`<div class="card"><div class="ct">Microclimate · ${zoneHe(p.zoneId)}${isPlaced(p)?' · 📍 exact point':''} · ${seasonHe(season)}</div>`+
        `<div class="zg">`+
        `<span class="k">Direct sun</span><b>${prof.sunHours} h</b>`+
        `<span class="k">DLI</span><b>${prof.DLI}</b>`+
        `<span class="k">Peak · dawn</span><b>${prof.Tpeak}°/${prof.Tdawn}°</b>`+
        `<span class="k">Frost</span><b>${fr}</b>`+
        `<span class="k">Wind</span><b>${Math.round((prof.exposure||0)*100)}%</b>`+
        `<span class="k">Water/week</span><b>${litres!=null?'~'+litres+' L':'—'}</b>`+
        `</div></div>`;
    } else {
      mc=`<div class="card"><div class="ct">Microclimate</div><div class="reason">The model is loading…</div></div>`;
    }
    let fitHtml='';
    if(fit){
      fitHtml=`<div class="card"><div class="ct">Zone fit</div>`+
        `<div style="display:flex;align-items:baseline;gap:6px"><span class="score ${scCls}">${sc}</span><span style="font-size:11px;color:#a99b78">/100</span></div>`+
        `<div class="reason">${esc(fit.reason_he||'')}</div>`+
        (bz&&bz.zoneId!==p.zoneId?`<div class="best">💡 Best zone: <b style="color:#fff7e6">${zoneHe(bz.zoneId)}</b> (${bz.score}/100)</div>`:
          (bz?`<div class="best">✓ This is the best zone for it</div>`:''))+
        `</div>`;
    }
    // (a) Pl@ntNet identification block — shows last ID + thumb if present; camera chip only when a key is set
    const idThumb = (Array.isArray(p.photos)&&p.photos[0]&&p.photos[0].dataUrl) ? p.photos[0].dataUrl : null;
    let idHtml=`<div class="card"><div class="ct">Plant identification · Pl@ntNet</div>`;
    if(p.id_latin){
      idHtml+=`<div class="idrow">`+
        (idThumb?`<img class="idthumb" src="${esc(idThumb)}" alt="">`:'')+
        `<div class="reason"><b style="color:#fff7e6">${esc(p.id_latin)}</b>`+
        (p.id_score!=null?` · ${esc(p.id_score)}%`:'')+
        (p.id_common?`<br>${esc(p.id_common)}`:'')+`</div></div>`;
    }
    // Only offer the camera-identify chip when a Pl@ntNet key is actually present.
    // On the gift device there is no key, so we must NOT dead-end the recipient in
    // a window.prompt asking for an API key (garden_id.js promptKey). No key → no chip.
    const _hasIdKey = !!(window.GardenID && GardenID.hasKey && GardenID.hasKey());
    idHtml+=(_hasIdKey?`<div class="chips" style="margin-top:7px"><span class="chip" data-act="plantnet">📷 Photograph & identify</span></div>`:'')+`</div>`;
    // (b) iNaturalist "seen near you" block — lazy-loaded via _obsCache + Derive.fetchObservations
    let obsHtml='';
    if(obsName(p)){
      loadObs(p);
      const obs=_obsCache[p.id];
      const inner = (obs===undefined||obs===null) ? `<div class="reason">Loading…</div>`
        : (obs.length ? obs.map(obsRow).join('') : `<div class="reason">No nearby observations found</div>`);
      obsHtml=`<div class="card"><div class="ct">Observations nearby · iNaturalist</div>`+
        `<div data-inat>${inner}</div></div>`;
    }
    body.innerHTML=
      `<div class="hd"><h3><span class="e">${p.emoji||meta.emoji||'🌱'}</span>${esc(p.name_he||meta.name_he||p.id)}</h3>`+
        `<span class="x" data-act="close" title="Close">✕</span></div>`+
      `<div class="sub">${zoneSel} ${seasonChips}</div>`+
      magTeaserHtml()+
      `<div class="draghint">📍 Drag the plant's marker in the model to its exact spot — the climate is computed for that point.</div>`+
      mc+fitHtml+realHistoryCard(p)+forecastCard(p)+authoredCard(p)+plantingCard(p)+lifecycleCard(p)+careCard(p)+idHtml+obsHtml+
      `<div class="lbl">Status</div><div class="chips">`+
        STATUSES.map(([l])=>`<span class="chip${p.status===l?' on':''}" data-act="status" data-v="${l}">${l}</span>`).join('')+`</div>`+
      `<div class="lbl">Pot size <span class="sublbl">(for watering-frequency calc)</span></div>`+
        `<div class="chips potchips">`+
        POT_PRESETS.map(v=>`<span class="chip${(+p.pot||0)===v?' on':''}" data-act="pot" data-v="${v}">${v===0?'In ground':v+' L'}</span>`).join('')+
        `<input class="potfree" type="number" min="0" step="1" placeholder="L" value="${p.pot>0?p.pot:''}" data-act="potfree" title="Pot volume in litres"></div>`+
      `<div class="lbl">Irrigation <span class="sublbl">(${(p.water_adjust_pct||0)>=0?'+':''}${p.water_adjust_pct||0}% manual)</span></div>`+
        `<div class="water"><input type="range" min="-50" max="50" step="5" value="${p.water_adjust_pct||0}" data-act="water">`+
        `<span class="wv">${scheduleText(p,season)}</span></div>`+
      `<div class="lbl">Notes</div><textarea rows="2" data-act="notes" placeholder="When planted, what you noticed…">${esc(p.notes_he||'')}</textarea>`+
      photoStripHtml(p)+
      `<div class="foot"><span class="save">Saved automatically</span><span class="rm" data-act="remove">Remove from garden</span></div>`;
    flushChips();   // mount any deferred Explain "?" chips after the card HTML is in the DOM
  }
  function onClick(e){
    const t=e.target.closest('[data-act]'); if(!t) return;
    const act=t.dataset.act, p=plant(cur);
    if(act==='close'){ hide(); return; }
    if(act==='openmag'){ hide(); openMag(); return; }
    if(act==='flyobs'){
      const lng=+t.dataset.lng, lat=+t.dataset.lat;
      if(isFinite(lng)&&isFinite(lat)&&window.__flyToGround) window.__flyToGround(lng,lat);
      return;
    }
    if(act==='plantnet'){ if(_fileInput) _fileInput.click(); return; }
    if(act==='caretask'){
      const taskHe=t.dataset.task||'', kind=t.dataset.kind||'', due=t.dataset.due||'';
      if(taskHe && p && window.LogStore){
        // CRITICAL field-name fix (verified): LogStore.add stamps t:isoNow() and
        // alerts.js:195 reads r.t||r.title FIRST, while the brain tab (panels.js:692)
        // reads r.text FIRST. Write t+title+text (all=taskHe) so the banner AND the
        // brain list both show the real task name; `due` drives upcoming('schedule',2).
        try{ LogStore.add('schedule', { t:taskHe, title:taskHe, text:taskHe, due,
          plant:p.id, name_he:p.name_he||'', kind, src:'care' }); }catch(e){}
        t.textContent='✓ Added'; t.classList.add('on'); t.removeAttribute('data-act');
      }
      return;
    }
    if(!p) return;
    if(act==='status'){ p.status=(p.status===t.dataset.v?'':t.dataset.v); save(); render(); }
    else if(act==='pot'){ p.pot=parseInt(t.dataset.v,10)||0; save(); render(); }
    else if(act==='season'){ DOC.season=t.dataset.s; save(); render(); }
    else if(act==='remove'){
      if(!confirm('Remove this plant from the garden?')) return;
      DOC.plants=DOC.plants.filter(x=>x.id!==p.id);
      if(p.source==='curated'&&DOC.removed.indexOf(p.id)<0) DOC.removed.push(p.id);
      save(); refreshPins(); hide();
    }
  }
  function onInput(e){
    const t=e.target.closest('[data-act]'); if(!t||t.dataset.act!=='water') return;
    const p=plant(cur); if(!p) return; p.water_adjust_pct=parseInt(t.value,10)||0;
    const wv=body.querySelector('.wv'); if(wv) wv.textContent=scheduleText(p,DOC.season);
    const lbl=t.closest('.water').previousElementSibling;
    if(lbl) lbl.innerHTML=`Irrigation <span class="sublbl">(${p.water_adjust_pct>=0?'+':''}${p.water_adjust_pct}% manual)</span>`;
  }
  function onChange(e){
    const t=e.target.closest('[data-act]'); if(!t) return; const p=plant(cur); if(!p) return;
    if(t.dataset.act==='water'){ p.water_adjust_pct=parseInt(t.value,10)||0; save(); }
    else if(t.dataset.act==='potfree'){ p.pot=Math.max(0,parseFloat(t.value)||0); save(); render(); }
    else if(t.dataset.act==='planted'){ p.planted=t.value||null; save(); render(); }
    else if(t.dataset.act==='notes'){ p.notes_he=t.value||''; save(); }
    else if(t.dataset.act==='zone'){ p.zoneId=t.value; delete _predCache[p.id]; save(); refreshPins(); render(); }
  }

  /* ---------------- add-plant catalog ---------------- */
  function ensureCat(){
    if(catBox) return;
    const wrap=el('div'); wrap.id='gardenCat'; wrap.setAttribute('dir','ltr');
    wrap.innerHTML=`<div class="box"><span class="gx" data-cat="close">✕</span><h4>＋ Add a plant to the garden</h4>`+
      `<div class="gsub">It will be added to the best zone — then drag the marker in the model to the exact spot</div>`+
      `<input class="s" placeholder="Search…" data-cat="search"><div class="grid" data-cat="grid"></div>`+
      `<div class="gplan" data-cat="plan">📄 Site & garden model (demo)</div></div>`;
    document.body.appendChild(wrap); catBox=wrap;
    wrap.addEventListener('click',e=>{
      if(e.target===wrap||e.target.closest('[data-cat=close]')){ closeCat(); }
      else if(e.target.closest('[data-cat=plan]')&&window.__planView){ window.__planView('','Site & garden model · demo'); }
    });
    wrap.querySelector('[data-cat=search]').addEventListener('input',e=>renderCat(e.target.value));
    wrap.querySelector('[data-cat=grid]').addEventListener('click',e=>{
      const g=e.target.closest('.gp'); if(g) addPlant(g.dataset.id);
    });
  }
  function renderCat(q){
    q=(q||'').trim(); const grid=catBox.querySelector('[data-cat=grid]');
    const have={}; DOC.plants.forEach(p=>have[p.id]=1);
    const list=catalog().filter(c=>!q||(c.name_he||'').includes(q));
    grid.innerHTML=list.map(c=>`<div class="gp" data-id="${c.id}"><span class="e">${c.emoji||'🌱'}</span>`+
      `<span class="n">${esc(c.name_he)}${have[c.id]?' ✓':''}</span></div>`).join('')||'<div class="gsub">No results</div>';
  }
  function openCat(){ ensureCat(); renderCat(''); catBox.classList.add('on'); const s=catBox.querySelector('[data-cat=search]'); if(s){s.value='';s.focus();} }
  function closeCat(){ if(catBox) catBox.classList.remove('on'); }
  function addPlant(id){
    const meta=plantMeta(id)||{}; let p=plant(id);
    if(!p){
      const season=DOC.season;
      // owned-plant scoring can't site a never-owned candidate (rankPlantsForCell
      // iterates only DATA.plants), so for a candidate use its microclimate best
      // cell (bestCellForCandidate) → its best_zone_hint → balcony default.
      const cand=(CANDIDATES||[]).find(c=>c.id===id);
      let zoneId;
      if(cand){ const bc=(window.Derive&&Derive.bestCellForCandidate)?Derive.bestCellForCandidate(cand,season):null;
        zoneId=(bc&&bc.zoneId)||cand.best_zone_hint||'balcony'; }
      else { const bz=bestZone(id,season); zoneId=(bz&&bz.zoneId)||meta.best_zone_id||'balcony'; }
      p={ id, zoneId, status:'Planted', water_adjust_pct:0, notes_he:'',
        emoji:meta.emoji, name_he:meta.name_he, source:(meta._curated?'curated':cand?'candidate':'user'), xL:null, zL:null, pot:null, planted:null };
      DOC.plants.push(p); DOC.removed=DOC.removed.filter(x=>x!==id); save();
    }
    closeCat(); refreshPins(); open(id);
  }
  // RETIRED: the floating "🌿 The garden" launcher button. The garden overview now lives
  // INSIDE the #inst yard tab (Garden.renderOverviewInto, mounted by panels.js), so the
  // standalone button + floating panel are no longer created/shown. Kept as a no-op
  // that also removes any stale button (e.g. left by a hot-reload) so nothing dangles.
  function ensureAddBtn(){ const b=$('gardenAdd'); if(b&&b.parentNode) b.parentNode.removeChild(b); }

  /* ================= GARDEN OVERVIEW (cockpit) — pillar 1 + a planner ==============
     One scrollable view of ALL plants (grouped by zone, searchable) so the garden
     scales past clicking markers one-by-one. Rows show water / fit / attention
     (⚠️ poor fit · 🔔 care due this month · 💧 high water); click → the rich per-plant
     card (open). Plus "what to plant this month" — plantable-now picks (PlantCare 'plant' tasks)
     with their best zone. Built entirely on the existing data/engine/PlantCare. ====== */
  let ov=null, ovBody=null, ovQuery='', ovEmbed=false, _ovEmbedWired=false;
  function isHarvestSoon(p){                      // {inSeason|soon} from the care calendar, or null
    const hv=harvestInfo(lifecycleEvents(p));
    if(!hv) return null;
    if(hv.inSeason) return {inSeason:true};
    if(hv.monthsAway<=1) return {soon:true};
    return null;
  }
  function attn(p,season){                       // attention flags for a plant row
    const f=[]; const fit=fitInForPlant(p,season);
    if(fit&&fit.score<40) f.push({e:'⚠️',t:'Low zone fit'});
    const nm=obsName(p);
    if(nm&&window.PlantCare&&PlantCare.has(nm)&&(PlantCare.tasksFor(nm,new Date().getMonth())||[]).length) f.push({e:'🔔',t:'Care task this month'});
    const hs=isHarvestSoon(p);
    if(hs) f.push({e:'🧺',t:hs.inSeason?'In harvest season':'Harvest soon'});
    const meta=plantMeta(p.id)||{}, hc=(window.Derive&&Derive.siteHeatChill)?Derive.siteHeatChill():null;
    if(hc&&((meta.chill_hours_req&&hc.chillHours<meta.chill_hours_req)||(meta.gdd_to_fruit&&hc.gddGrowing<meta.gdd_to_fruit)))
      f.push({e:'🌡️',t:'Marginal climate for fruit set'});
    const w=waterWeekly(p,season); if(w!=null&&w>=25) f.push({e:'💧',t:'High water use'});
    return f;
  }
  // subtle "how it actually was so far" hint for an overview row: a small 📋 with the measured
  // span / frost-nights as a tooltip — ONLY when the Living Record actually covers
  // days for this plant's zone (defensive; absent store or days===0 → no hint).
  function realHint(p){
    const RS=window.RecordStore; if(!RS) return '';
    let st={}; try{ st=(RS.status&&RS.status())||{}; }catch(e){ return ''; }
    if(!(st.days>0) || !RS.plantTotals) return '';
    let tot=null; try{ tot=RS.plantTotals(p.id, st.firstDate||_isoDaysAgo(365), st.lastDate||_isoUTC(new Date())); }catch(e){ return ''; }
    if(!tot || !tot.days) return '';
    const ti=`Real measurements · ${tot.days} days${tot.frostNights?` · ${tot.frostNights} frost nights`:''}`;
    return ` <span class="ovreal" title="${esc(ti)}">📋</span>`;
  }
  function ovRow(p,season){
    const meta=plantMeta(p.id)||{}; const fit=fitInForPlant(p,season); const sc=fit?fit.score:null;
    const scCls=sc==null?'':sc>=66?'':sc>=40?'mid':'lo'; const w=waterWeekly(p,season);
    const sch=wateringSchedule(p,season);
    const potBadge=(sch&&sch.potted)?` <span class="ovpot" title="Pot ${sch.pot} L · ~${sch.per} L per watering">🪴 every ${sch.days===1?'day':sch.days+' days'}</span>`:'';
    const placed=isPlaced(p)?` <span class="ovplaced" title="Placed precisely">📍</span>`:'';
    const fl=attn(p,season).map(a=>`<span title="${a.t}">${a.e}</span>`).join('');
    return `<div class="ovrow" data-act="open" data-id="${esc(p.id)}">`+
      `<span class="ove">${p.emoji||meta.emoji||'🌱'}</span>`+
      `<span class="ovn">${esc(p.name_he||meta.name_he||p.id)}${placed}${realHint(p)}${potBadge}${p.status?` <span class="ovst">${esc(p.status)}</span>`:''}</span>`+
      `<span class="ovw">${w!=null?'~'+w+' L':''}</span>`+
      `<span class="ovfit ${scCls}">${sc!=null?sc:''}</span>`+
      `<span class="ovfl">${fl}</span></div>`;
  }
  function plannerHTML(season){                   // "what to plant this month" (pillar 4, lightweight)
    if(!window.PlantCare) return '';
    const mi=new Date().getMonth(), have={}; DOC.plants.forEach(p=>have[p.id]=1);
    const picks=[];
    catalog().forEach(c=>{ if(have[c.id]) return; const nm=c.name_latin; if(!nm||!PlantCare.has(nm)) return;
      if(!(PlantCare.tasksFor(nm,mi)||[]).some(t=>t.kind==='plant')) return;
      picks.push({c, bz:bestZone(c.id,season)}); });
    picks.sort((a,b)=>((b.bz&&b.bz.score)||0)-((a.bz&&a.bz.score)||0));
    if(!picks.length) return '';
    return `<div class="ovsec">🪴 What to plant this month</div>`+
      picks.slice(0,6).map(({c,bz})=>`<div class="ovrow" data-act="add" data-id="${esc(c.id)}">`+
        `<span class="ove">${c.emoji||'🌱'}</span><span class="ovn">${esc(c.name_he)}</span>`+
        `<span class="ovw">${bz?zoneHe(bz.zoneId):''}</span>`+
        `<span class="ovfit ${bz&&bz.score>=66?'':bz&&bz.score>=40?'mid':'lo'}">${bz?bz.score:''}</span>`+
        `<span class="ovfl">＋</span></div>`).join('');
  }
  /* ---- "🌱 worth adding to the garden" — candidate plants ranked against HIS zones ----
     Pillar 4 (#6). Scores each the highlands/high-desert candidate (data/plant_candidates.json,
     plants he does NOT own) against his REAL zones via the microclimate engine
     (Derive.bestCellForCandidate → best cell + score + zone), then shows the top
     ~5 with the best zone + a one-line WHY it suits his desert plot. Falls back to
     a simple sun-need vs zone-sun-hours match if the scorer is unavailable. This is
     SUGGESTION / general guidance — labelled, not a prescription. Click a row to
     add the plant (the candidate's full schema carries over via plantMeta). ------ */
  const SUN_HOURS_NEED={ full:6, part:4, shade:2 };   // sun_need → min daily sun hours (fallback)
  function rankCandidate(c,season){
    // primary: the real microclimate scorer over the whole cell grid.
    if(window.Derive&&Derive.bestCellForCandidate){
      const bc=Derive.bestCellForCandidate(c,season);
      if(bc) return { zoneId:bc.zoneId||(bc.cell&&bc.cell.zoneId), score:bc.score, reason:bc.reason_he, src:'derive' };
    }
    // fallback: pick the zone whose sun-hours best meet the candidate's sun need.
    let best=null;
    ZONES.forEach(z=>{ const prof=profileOf(z.id,season); if(!prof) return;
      const need=SUN_HOURS_NEED[c.sun_need]||5;
      const fit=Math.max(0,Math.min(1, prof.sunHours/Math.max(1,need)));
      const sc=Math.round(fit*100);
      if(!best||sc>best.score) best={ zoneId:z.id, score:sc, reason:null, src:'fallback' }; });
    return best;
  }
  function candidatesHTML(season){
    if(!Array.isArray(CANDIDATES)||!CANDIDATES.length) return '';
    const have={}; const haveLatin={};
    DOC.plants.forEach(p=>{ have[p.id]=1; const m=plantMeta(p.id)||{}; if(m.name_latin) haveLatin[m.name_latin.toLowerCase().trim()]=1; });
    const ranked=CANDIDATES
      .filter(c=>!have[c.id] && !(c.name_latin&&haveLatin[c.name_latin.toLowerCase().trim()]))
      .map(c=>({ c, r:rankCandidate(c,season) }))
      .filter(x=>x.r)
      .sort((a,b)=>(b.r.score||0)-(a.r.score||0))
      .slice(0,5);
    if(!ranked.length) return '';
    return `<div class="ovsec">🌱 Worth adding to the garden</div>`+
      `<div class="ovcsub">Suggestions matched to your zones — general guidance, not a prescription.</div>`+
      ranked.map(({c,r})=>{
        const scCls=r.score>=66?'':r.score>=40?'mid':'lo';
        const why=c.why_he||r.reason||'';
        return `<div class="ovrow ovcand" data-act="add" data-id="${esc(c.id)}" title="Add to the garden">`+
          `<span class="ove">${c.emoji||'🌱'}</span>`+
          `<span class="ovn">${esc(c.name_he)}${c.name_latin?` <span class="ovst">${esc(c.name_latin)}</span>`:''}`+
            (why?`<span class="ovwhy">${esc(why)}</span>`:'')+`</span>`+
          `<span class="ovw">${r.zoneId?zoneHe(r.zoneId):''}</span>`+
          `<span class="ovfit ${scCls}">${r.score!=null?r.score:''}</span>`+
          `<span class="ovfl">＋</span></div>`;
      }).join('');
  }
  /* ---- DEFERRED candidates (perf / "freeze" fix) ----------------------------------
     candidatesHTML() scores every candidate against the WHOLE 235-cell grid; the first
     touch bakes each cell's seasonal profile (Derive._bakeSeason) — measured at ~1.4 s
     to bake + ~0.7 s to score = ~2 s of SYNCHRONOUS work, which froze the yard tab on
     first open. Fix: render a light placeholder, warm the cellProfile + ranking caches
     in idle-time CHUNKS (no single long task), then build the real section once and
     re-render in place. Cached by season + owned-plant signature; after the first warm
     candidatesHTML() is ~40 ms (caches persist on the cell objects for the session). */
  let _candCache={}, _candWarming=null;
  function _candSig(season){ return season+'|'+DOC.plants.map(p=>p.id).slice().sort().join(','); }
  function candidatesSection(season){
    const sig=_candSig(season);
    if(_candCache[sig]!=null) return _candCache[sig];      // already warm → instant (may be '')
    warmCandidates(season,sig);                            // cold → compute off the main thread
    return `<div id="ovCandidates" class="ovsec ovcand-wait">🌱 Worth adding to the garden`+
      `<div class="ovcsub">Computing recommendations matched to your zones…</div></div>`;
  }
  function warmCandidates(season,sig){
    if(_candCache[sig]!=null || _candWarming===sig) return;
    _candWarming=sig;
    const D=window.Derive;
    // no microclimate engine (only the cheap fallback scorer) → candidatesHTML is light;
    // just compute it now.
    if(!(D&&D.cellGrid&&D.cellProfile)){ _finishCands(season,sig); return; }
    const cells=D.cellGrid()||[]; let i=0;
    const ric=window.requestIdleCallback;
    const schedule=function(cb){ return ric? ric(cb,{timeout:800}) : setTimeout(function(){cb(null);},0); };
    function slice(deadline){
      const t0=Date.now();
      while(i<cells.length){
        const c=cells[i++];
        try{ D.cellProfile(c,season); if(D.rankPlantsForCell) D.rankPlantsForCell(c,season); }catch(e){}
        // yield when the idle deadline is nearly up (or, without rIC, after ~8 ms)
        const over = (deadline&&deadline.timeRemaining) ? deadline.timeRemaining()<6 : (Date.now()-t0)>=8;
        if(over) break;
      }
      if(i<cells.length) schedule(slice);
      else _finishCands(season,sig);
    }
    schedule(slice);
  }
  function _finishCands(season,sig){
    try{ _candCache[sig]=candidatesHTML(season); }catch(e){ _candCache[sig]=''; }
    _candWarming=null;
    if(_candSig(DOC.season)!==sig) return;                 // owned plants / season changed → a newer render owns it
    // re-render the overview in place so the now-warm section replaces the placeholder
    if(ovEmbed){ if(ovBody&&ovBody.isConnected&&ovBody.offsetParent!==null) renderOverview(); }
    else if(ov&&ov.classList.contains('on')) renderOverview();
  }
  function renderOverview(){
    const season=DOC.season, q=ovQuery.trim();
    let plants=DOC.plants.slice();
    if(q) plants=plants.filter(p=>String((p.name_he||'')+' '+((plantMeta(p.id)||{}).name_he||'')).includes(q));
    const tw=plants.reduce((a,p)=>a+(waterWeekly(p,season)||0),0);
    const need=plants.filter(p=>attn(p,season).length).length;
    const harvestN=plants.filter(p=>isHarvestSoon(p)).length;
    // EMBEDDED (inside the #inst yard tab): no header/close ✕ — the tab owns the
    // chrome. FLOATING (legacy): keep the titled header + close button. The body
    // we paint into is `ovBody`, which renderOverviewInto() repoints at the tab's
    // own sub-container.
    let html = ovEmbed
      ? `<div class="sub" style="margin-top:2px">${plants.length} plants · ${seasonHe(season)} · water ~${Math.round(tw)} L/wk${need?` · ${need} need attention`:''}${harvestN?` · 🧺 ${harvestN} to harvest`:''}</div>`
      : `<div class="hd"><h3>The garden</h3><span class="x" data-act="close" title="Close">✕</span></div>`+
        `<div class="sub">${plants.length} plants · ${seasonHe(season)} · water ~${Math.round(tw)} L/wk${need?` · ${need} need attention`:''}${harvestN?` · 🧺 ${harvestN} to harvest`:''}</div>`;
    html+=`<div class="magbtn" data-act="mag">📖 The Weekly <span>Alex's garden · ${seasonHe(season)}</span></div>`+
      `<input class="ovq" placeholder="Search a plant…" value="${esc(ovQuery)}">`+
      `<div class="ovhdr"><span class="ove"></span><span class="ovn">Plant</span><span class="ovw">Water/wk</span><span class="ovfit">Fit</span><span class="ovfl"></span></div>`;
    ZONES.forEach(z=>{
      const inZ=plants.filter(p=>p.zoneId===z.id); if(!inZ.length) return;
      const prof=profileOf(z.id,season);
      const mini=prof?`${prof.sunHours} h · frost ${prof.frost?'high':((prof.frostTdawn!=null?prof.frostTdawn:prof.Tdawn)<=3?'medium':'low')}`:'';
      html+=`<div class="ovz">${z.emoji} ${z.name_he}<span class="ovzm">${mini}</span></div>`;
      html+=inZ.map(p=>ovRow(p,season)).join('');
    });
    if(!plants.length) html+=`<div class="reason" style="padding:6px 2px">${q?'No results':'No plants yet — add one below.'}</div>`;
    html+=plannerHTML(season);
    if(!q) html+=candidatesSection(season);         // DEFERRED off the main thread (see candidatesSection) — was a ~2s freeze
    html+=`<div class="add" data-act="addnew">＋ Add a plant to the garden</div>`;
    html+=`<div class="foot">Click a plant for the full card · saved automatically</div>`;
    ovBody.innerHTML=html;
  }
  function ensureOverview(){
    if(ov) return; ensure();                      // ensure() injects the shared CSS + #gardenCard infra
    ov=el('div'); ov.id='gardenOverview'; ov.setAttribute('dir','ltr');
    ovBody=el('div','body'); ov.appendChild(ovBody); document.body.appendChild(ov);
    ovBody.addEventListener('click',e=>{ const t=e.target.closest('[data-act]'); if(!t) return; const a=t.dataset.act;
      if(a==='close') closeOverview();
      else if(a==='open'){ closeOverview(); open(t.dataset.id); }
      else if(a==='add'){ closeOverview(); addPlant(t.dataset.id); }
      else if(a==='addnew'){ closeOverview(); openCat(); }
      else if(a==='mag'){ closeOverview(); openMag(); } });
    ovBody.addEventListener('input',e=>{ if(e.target.classList.contains('ovq')){ ovQuery=e.target.value; renderOverview(); } });
  }
  function openOverview(){ ensureOverview(); ov.classList.add('on'); hideInst(); renderOverview(); }
  function closeOverview(){ if(ov) ov.classList.remove('on'); restoreInst(); }

  /* ---- EMBEDDED overview: mount the SAME overview into the #inst yard tab ----------
     panels.js renderYard() keeps a persistent sub-container (#yard-garden) that the
     1-second microclimate tick does NOT touch, and calls Garden.renderOverviewInto(el)
     once per tab-show. We repoint the overview's body (`ovBody`) at that container,
     wire its click/search handlers ONCE (idempotent across re-shows), and render in
     EMBEDDED mode (no titled header / close ✕ — the tab owns the chrome). All the
     interactions are preserved: plant row → its full card (open), ＋recommendation →
     addPlant, "add a plant" → openCat, 📖 → openMag. The standalone floating panel +
     its launcher button are retired (no longer created/shown). ensure() is still
     called for the shared CSS + the plant-card (#gardenCard) infra the rows open. */
  function renderOverviewInto(host){
    if(!host) return;
    ensure();                         // shared CSS + #gardenCard plant-card infra
    ovEmbed=true; ovBody=host;
    // Wire per-HOST (not a global one-shot): if panels.js rebuilds #yard-garden on a
    // later tab-show, the fresh node must get its own handlers (the old node's are GC'd
    // with it). Re-wire only when the host node actually changes — avoids stacking
    // duplicate listeners when the same node is re-rendered each tab-show.
    if(_ovEmbedWired!==host){
      _ovEmbedWired=host;
      host.addEventListener('click',e=>{ const t=e.target.closest('[data-act]'); if(!t) return; const a=t.dataset.act;
        // 'close' is never rendered in embedded mode; the rest open the same surfaces
        // as the floating overview did, but WITHOUT hiding #inst (we're inside it).
        if(a==='open') open(t.dataset.id);
        else if(a==='add') addPlant(t.dataset.id);
        else if(a==='addnew') openCat();
        else if(a==='mag') openMag(); });
      // search: rebuild the list, then restore focus + caret to the box (innerHTML
      // re-render replaces the input node, which would otherwise drop focus mid-type).
      host.addEventListener('input',e=>{ if(!e.target.classList.contains('ovq')) return;
        const caret=e.target.selectionStart; ovQuery=e.target.value; renderOverview();
        const q=host.querySelector('.ovq'); if(q){ q.focus(); try{ q.setSelectionRange(caret,caret); }catch(_){} } });
    }
    renderOverview();
  }

  /* ================= "The Weekly" — the weekly garden magazine ==============
     A magazine ABOUT his garden THIS WEEK, generated fresh from real derived data (NOT a
     passive almanac): masthead + a synthesized lead cover-story + departments —
     🧺 harvest · 🔔 tasks · 💧 watering & climate · 🪴 plant of the week. Every plant line opens its card;
     care lines push to LogStore('schedule') so Alerts nudges Alex. Lead + spotlight rotate
     by the week, so each issue feels new. ============================================= */
  let mag=null, magBody=null;
  const MON_B=['January','February','March','April','May','June','July','August','September','October','November','December'];
  function weekIdx(){ return Math.floor(Date.now()/6048e5); }       // stable within a calendar week
  function magPlants(){ return DOC.plants.slice(); }
  function magTasks(){                            // care tasks this month → [{p,task_he,kind,due}]
    if(!window.PlantCare) return [];
    const mi=new Date().getMonth(), due=PlantCare.dueDateForThisMonth?PlantCare.dueDateForThisMonth(7):'';
    const out=[];
    magPlants().forEach(p=>{ const nm=obsName(p); if(!nm||!PlantCare.has(nm)) return;
      (PlantCare.tasksFor(nm,mi)||[]).forEach(t=>out.push({p, task_he:t.task_he, kind:t.kind, due})); });
    return out;
  }
  function magHarvest(){
    return magPlants().map(p=>({p,hs:isHarvestSoon(p),hv:harvestInfo(lifecycleEvents(p))}))
      .filter(x=>x.hs&&x.hv).sort((a,b)=>(a.hs.inSeason?0:1)-(b.hs.inSeason?0:1));
  }
  function magMarginal(){
    const hc=(window.Derive&&Derive.siteHeatChill)?Derive.siteHeatChill():null; if(!hc) return [];
    return magPlants().filter(p=>{ const m=plantMeta(p.id)||{};
      return (m.chill_hours_req&&hc.chillHours<m.chill_hours_req)||(m.gdd_to_fruit&&hc.gddGrowing<m.gdd_to_fruit); });
  }
  function spotlightPlant(){ const ps=magPlants(); return ps.length?ps[weekIdx()%ps.length]:null; }
  function magBlurb(p,season){                    // a short editorial line from real per-plant data
    const m=plantMeta(p.id)||{};
    if(m.zone_reason_he) return m.zone_reason_he.split(/[.;]/)[0].trim()+'.';
    const fit=fitInForPlant(p,season); if(fit&&fit.reason_he) return fit.reason_he;
    if(Array.isArray(m.warnings_he)&&m.warnings_he[0]) return m.warnings_he[0];
    return zoneHe(p.zoneId)+' · '+seasonHe(season);
  }
  function magLead(season,spot){
    const inS=magHarvest().filter(x=>x.hs.inSeason);
    if(inS.length){ const {p,hv}=inS[0], m=plantMeta(p.id)||{}, w=hv.window, win=w[0]===w[1]?HE_MONTHS[w[0]]:`${HE_MONTHS[w[0]]}–${HE_MONTHS[w[1]]}`;
      return { id:p.id, emoji:p.emoji||m.emoji||'🌱', kicker:'Peak season',
        title:`${p.name_he||m.name_he} at peak harvest`,
        line:`Harvest window ${win}. ${inS.length>1?`and ${inS.length-1} more waiting — `:''}pick at peak flavor.`, spot:false }; }
    if(spot){ const m=plantMeta(spot.id)||{};
      return { id:spot.id, emoji:spot.emoji||m.emoji||'🌱', kicker:'Plant of the week',
        title:`${spot.name_he||m.name_he}`, line:magBlurb(spot,season), spot:true }; }
    return null;
  }
  function magItem(p,sub,chip){
    const m=plantMeta(p.id)||{};
    return `<div class="mi" data-act="magopen" data-id="${esc(p.id)}">`+
      `<span class="mie">${p.emoji||m.emoji||'🌱'}</span>`+
      `<span class="min">${esc(p.name_he||m.name_he||p.id)}${sub?` <span class="mid">${sub}</span>`:''}</span>`+
      (chip||'')+`</div>`;
  }
  function renderMag(){
    const season=DOC.season, d=new Date();
    const spot=spotlightPlant(), lead=magLead(season,spot), harvest=magHarvest(), tasks=magTasks(), marginal=magMarginal();
    const tw=Math.round(magPlants().reduce((a,p)=>a+(waterWeekly(p,season)||0),0));
    let html=`<div class="mast"><span class="x" data-act="magclose" title="Close">✕</span>`+
      `<h2>The garden this week</h2><div class="date">Issue · ${d.getDate()} ${MON_B[d.getMonth()]} · ${seasonHe(season)}</div></div>`;
    if(lead) html+=`<div class="lead" data-act="magopen" data-id="${esc(lead.id)}">`+
      `<span class="le">${lead.emoji}</span><div><div class="lk">${lead.kicker}</div>`+
      `<div class="lt">${esc(lead.title)}</div><div class="ll">${esc(lead.line)}</div></div></div>`;
    if(harvest.length){ html+=`<div class="dept"><div class="dh">🧺 This week's harvest</div>`+
      harvest.map(({p,hs,hv})=>{ const w=hv.window, win=w[0]===w[1]?HE_MONTHS[w[0]]:`${HE_MONTHS[w[0]]}–${HE_MONTHS[w[1]]}`;
        return magItem(p, hs.inSeason?`In season · ${win}`:`Soon · ${win}`); }).join('')+`</div>`; }
    if(tasks.length){ html+=`<div class="dept"><div class="dh">🔔 This week's tasks</div>`+
      tasks.slice(0,7).map(t=>{ const km=(PlantCare.kindMeta&&PlantCare.kindMeta(t.kind))||{};
        return `<div class="mi" data-act="magopen" data-id="${esc(t.p.id)}">`+
          `<span class="mie">${km.emoji||'•'}</span>`+
          `<span class="min">${esc(t.task_he)} <span class="mid">${esc(t.p.name_he||(plantMeta(t.p.id)||{}).name_he||'')}</span></span>`+
          `<span class="mik" data-act="magtask" data-id="${esc(t.p.id)}" data-task="${esc(t.task_he)}" data-kind="${esc(t.kind||'')}" data-due="${esc(t.due||'')}">🔔 Add</span>`+
          `</div>`; }).join('')+`</div>`; }
    let wnote=`<div class="note">Total watering this week: <b>~${tw} L</b>.`;
    const potted=magPlants().map(p=>({p,s:wateringSchedule(p,season)})).filter(x=>x.s&&x.s.potted);
    if(potted.length) wnote+=` Pots: ${potted.map(x=>`${x.p.emoji||''}${x.p.name_he||''} every ${x.s.days===1?'day':x.s.days+' d'}`).join(' · ')}.`;
    wnote+=`</div>`;
    if(marginal.length) wnote+=`<div class="note" style="margin-top:6px">🌡️ Marginal climate for fruit set: ${marginal.map(p=>`${p.emoji||''}${p.name_he||''}`).join(' · ')} — the site is at the edge of their chill/heat requirements.</div>`;
    html+=`<div class="dept"><div class="dh">💧 Watering & climate</div>${wnote}</div>`;
    if(spot&&!(lead&&lead.spot)){ const m=plantMeta(spot.id)||{};
      html+=`<div class="dept"><div class="dh">🪴 Plant of the week</div>`+
        `<div class="spot" data-act="magopen" data-id="${esc(spot.id)}"><span class="se">${spot.emoji||m.emoji||'🌱'}</span>`+
        `<div><div class="st">${esc(spot.name_he||m.name_he||spot.id)}</div><div class="ss">${esc(magBlurb(spot,season))}</div></div></div></div>`; }
    html+=`<div class="magfoot"><span>Built from the garden's data · local estimate</span>`+
      (tasks.length?`<span class="allbtn" data-act="magall">📌 Add tasks to the log</span>`:'')+`</div>`;
    magBody.innerHTML=html;
  }
  function addTaskToAlerts(pid,task_he,kind,due){
    const p=plant(pid); if(!task_he||!p||!window.LogStore) return false;
    try{ LogStore.add('schedule',{t:task_he,title:task_he,text:task_he,due,plant:p.id,name_he:p.name_he||'',kind,src:'mag'}); return true; }catch(e){ return false; }
  }
  function ensureMag(){
    if(mag) return; ensure();
    mag=el('div'); mag.id='gardenMag'; mag.setAttribute('dir','ltr');
    magBody=el('div','body'); mag.appendChild(magBody); document.body.appendChild(mag);
    magBody.addEventListener('click',e=>{ const t=e.target.closest('[data-act]'); if(!t) return; const a=t.dataset.act;
      if(a==='magclose') closeMag();
      else if(a==='magtask'){ e.stopPropagation();
        if(addTaskToAlerts(t.dataset.id,t.dataset.task,t.dataset.kind,t.dataset.due)){ t.textContent='✓ Added'; t.classList.add('on'); t.removeAttribute('data-act'); } }
      else if(a==='magall'){ const ts=magTasks(); let n=0; ts.forEach(x=>{ if(addTaskToAlerts(x.p.id,x.task_he,x.kind,x.due)) n++; }); t.textContent=`✓ ${n} added`; t.removeAttribute('data-act'); }
      else if(a==='magopen'){ closeMag(); open(t.dataset.id); } });
  }
  function openMag(){ ensureMag(); markMagWeek(); mag.classList.add('on'); hideInst(); renderMag(); }
  function closeMag(){ if(mag) mag.classList.remove('on'); restoreInst(); }

  /* ---- gentle WEEKLY nudge: surface this week's issue once, via the Alerts banner.
     alerts.js bridges to __garden.weeklyNudge() (live mode only). Opening OR dismissing
     marks the week seen (home_mag_week), so it never nags more than once a week. ---- */
  const MAG_WEEK_KEY='home_mag_week';
  function magSeenWeek(){ let v=NaN; try{ v=parseInt(localStorage.getItem(MAG_WEEK_KEY),10); }catch(e){} return isNaN(v)?-1:v; }
  function markMagWeek(){ try{ localStorage.setItem(MAG_WEEK_KEY,String(weekIdx())); }catch(e){} }
  function magHasContent(){ return magHarvest().length>0 || magTasks().length>0; }
  function weeklyNudge(){
    if((document.documentElement.dataset.tmode||'live')!=='live') return null;   // real "now" only
    if(!DOC || magSeenWeek()===weekIdx() || !magHasContent()) return null;       // already seen / nothing to say
    const lead=magLead(DOC.season, spotlightPlant());
    const hv=magHarvest().filter(x=>x.hs.inSeason).length;
    const he=lead?`The Weekly is ready — ${lead.title}${hv?` · 🧺 ${hv} to harvest`:''}`:'The Weekly is ready';
    return { id:'garden-weekly', sev:'good', icon:'📖', key:'gardenWeekly', he,
      action:()=>{ markMagWeek(); openMag(); }, onDismiss:markMagWeek };
  }

  /* ---------------- public API (wired from GardenPins click/drag in app.js) ---------------- */
  function open(id){ if(!plant(id)) return; ensure(); cur=id; card.classList.add('on'); hideInst(); render();
    // one-brain: a user-initiated plant open brings the yard tab forward (deep-link from
    // home/alerts lands in the yard context). Safe no-op if nobody's subscribed / already on yard.
    if(window.Bus&&window.Bus.emit) window.Bus.emit('tab:open',{tab:'yard'}); }
  function hide(){ if(card) card.classList.remove('on'); restoreInst(); cur=null; }
  // app.js drag → store exact local (xL,zL); re-derive the zone from the cell it lands in;
  // refresh markers + any open card/overview so the new microclimate shows immediately.
  function setPos(id,xL,zL){
    const p=plant(id); if(!p||xL==null||zL==null) return;
    p.xL=+(+xL).toFixed(3); p.zL=+(+zL).toFixed(3);
    const c=nearestCell(p.xL,p.zL); if(c&&c.zoneId&&c.zoneId!=='house'&&c.zoneId!==p.zoneId){ p.zoneId=c.zoneId; delete _predCache[id]; }
    save(); refreshPins();
    if(cur===id&&card&&card.classList.contains('on')) render();
    if(ov&&ov.classList.contains('on')) renderOverview();
    refreshEmbeddedOverview();
  }
  // re-render the overview when it's EMBEDDED in the yard tab and currently on screen
  // (its host has size). Lets a 3D drag / late data refresh update the in-tab list
  // without the floating panel. Cheap + guarded; no-op if not embedded/visible.
  function refreshEmbeddedOverview(){
    if(!ovEmbed||!ovBody||!ovBody.isConnected) return;
    if(ovBody.offsetParent===null) return;      // hidden (tab not shown) → skip
    renderOverview();
  }
  window.__garden={ open, hide, openOverview, closeOverview, openMag, closeMag, weeklyNudge, setPos,
    renderOverviewInto, refresh:()=>refreshPins(),
    // delay fix: readiness so panels.js mounts the embedded overview the moment data lands
    isReady:()=>!!DOC, onReady,
    isOpen:()=>!!(card&&card.classList.contains('on')),
    current:()=>(card&&card.classList.contains('on'))?cur:null, _doc:()=>DOC };

  /* ---------------- boot ---------------- */
  // DELAY FIX: start the data fetches the instant garden.js loads (don't wait for
  // Derive.ready to even KICK them). The resident_plants.json fetch + the care calendar
  // are pure network — independent of Derive — so racing them against Derive.ready
  // (instead of serializing AFTER it) shaves the wait. DOC (→ isReady) is set as
  // soon as the curated-plants fetch resolves, then any onReady() callbacks
  // (panels.js's embedded-overview mount) fire immediately — no 120 ms poll lag.
  // positions()/refreshPins still need Derive's cell grid, so they stay gated behind it.
  function boot(){
    // (1) care calendar — fire now, independent of Derive (self-guarded if care.js absent)
    if(window.PlantCare&&PlantCare.loadCare){ try{ const _p=PlantCare.loadCare();
      // re-render an already-open card once the care/pest JSON resolves (was a race:
      // a card opened in the first ms showed an empty care section). Also refresh the
      // embedded overview so its 🔔/🧺 attention flags + planner appear when care loads.
      if(_p&&_p.then) _p.then(()=>{ if(cur&&card&&card.classList.contains('on')) render(); refreshEmbeddedOverview(); }); }catch(e){} }
    // (1b) planting & care tips (data/planting_tips.json) — pure network, independent of
    // Derive; fire now so the 🌱 Planting & cultivation card is ready the moment a plant opens.
    try{ loadPlantingTips(); }catch(e){}
    // (2) curated plants (data/resident_plants.json) — fire NOW, in parallel with Derive.
    const curatedP = loadCurated();
    const deriveP  = (window.Derive&&Derive.ready) ? Derive.ready : new Promise(res=>{
      (function wait(){ if(window.Derive&&Derive.ready) Derive.ready.then(res).catch(res); else setTimeout(wait,40); })();
    });
    // (3) the moment the plant data is parsed → build DOC and signal readiness so the
    // embedded overview can mount AT ONCE. We don't block DOC on Derive (the overview
    // only needs DOC; the microclimate fit columns gracefully fill in once Derive's
    // grid is ready and refreshEmbeddedOverview re-renders).
    curatedP.then(()=>{ if(!DOC){ load(); markReady(); refreshEmbeddedOverview(); } }).catch(()=>{});
    // (4) once Derive's grid is ready: ensure DOC, place the 3D pins, then load
    // candidates (need curated first) and re-render any visible overview/card.
    deriveP.then(()=>{
      curatedP.then(()=>{ if(!DOC){ load(); markReady(); } ensureAddBtn(); refreshPins();
        loadCandidates().then(()=>{ if(ov&&ov.classList.contains('on')) renderOverview(); refreshEmbeddedOverview(); });
        if(cur&&card&&card.classList.contains('on')) render();   // late grid → re-render an open card with real microclimate
      }).catch(()=>{});
    }).catch(()=>{});
  }
  boot();
})();
