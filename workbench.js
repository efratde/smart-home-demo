/* ===================================================================
   workbench.js — the IN-WORLD room workbench (Make pillar, approach A).
   No separate 2D screen: when a room is selected in EnterMode (by a room
   pill OR by clicking the room on the real 3D model), THIS panel opens in
   the exact #inst instrument language (brass-on-glass, serif niqqud title,
   six tabs), anchored where the instrument panel sits. The data model +
   tab/CRUD logic are ported from the retired twin.js; the flat 2D plan and
   its blue skin are gone. Pure DOM overlay — never touches the WebGL scene.

   Wiring (app.js EnterMode): goRoom(id) → __workbench.showRoom(id);
   floorOverview()/exit() → __workbench.hide(). A canvas raycast in app.js
   turns a click on a room's floor into goRoom(id).
   Persistence: localStorage `home_workbench_v1` (mergeDefaults so added
   fields never wipe saved edits).
   =================================================================== */
(function(){
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};

  /* ---------------- model (ported from twin.js SEED, re-keyed flat by the
     app's stable room id; the 2D `pts` polygons dropped — geometry now lives
     in the real 3D model). floor ∈ ground|upper. ---------------- */
  function R(id,name,floor,type,area,extra){
    return Object.assign({ id,name,floor,type,area,
      // NOTE: no est default → est is undefined ("estimated, not yet verified") so the
      // overview shows 'estimated' on structure/circuit/water until the user explicitly verifies.
      comps:[], inv:[], tasks:[], notes:[], parts:[], bu:{}, circuit:'', water:'', structure:'' }, extra||{});
  }
  // SEED — areas/structure/wet-zones/openings/ceilings for a synthetic demo model
  // (floor plans + sections). circuit:'' on purpose — the permit set has NO electrical
  // drawing, so circuits/sockets are UNKNOWN (the old C1–C5 were fabricated). bu = the
  // build-up panel (ceiling height + source). GF ceiling 2.80, upper 2.50 (from sections).
  function SEED(){ return {
    // ---- GROUND FLOOR (ceiling 2.80 m) ----
    bathG:  R('bathG','Bathroom','ground','bath',4.0,
      { water:'Shower · sink · toilet · drain', circuit:'', structure:'Wet zone — concrete walls',
        bu:{ceiling:'2.80 m', source:'Synthetic model'},
        notes:[{t:'Wet zone: plumbing + drainage here — expensive to relocate in a renovation',d:'From the plan'}],
        tasks:[{t:'Tiling + plumbing',s:'prog',cost:9500}],
        comps:[{n:'Faucet',d:'2019'},{n:'Solar water heater',d:'2018'}],
        parts:[{n:'Faucet',installed:'2019',replaced:'',warr:'',supplier:''},
               {n:'Solar water heater',installed:'2018',replaced:'',warr:'',supplier:''}] }),
    stairsG:R('stairsG','Stairs','ground','stairs',4.0,
      { circuit:'', structure:'Cast-concrete stair flight', bu:{ceiling:'2.80 m', source:'Synthetic model'} }),
    kitchen:R('kitchen','Kitchen','ground','kitchen',10.9,
      { circuit:'', water:'Sink · dishwasher (wet zone)', structure:'Concrete ring beam',
        bu:{ceiling:'2.80 m', source:'Synthetic model'},
        notes:[{t:'East window 80/120 (open, next to the AC unit); interior door 90/205 from the entrance',d:'From the plan'}],
        tasks:[{t:'Cabinet replacement',s:'prog',cost:12000}],
        comps:[{n:'Oven',d:'2021'},{n:'Dishwasher',d:'2020'}], inv:[{n:'Fridge'},{n:'Microwave'}],
        parts:[{n:'Oven',installed:'2021',replaced:'',warr:'',supplier:''},
               {n:'Dishwasher',installed:'2020',replaced:'',warr:'',supplier:''}] }),
    living: R('living','Living room','ground','living',22.0,
      { circuit:'', structure:'Concrete ring beam + column (span ~6.8 m)',
        bu:{ceiling:'2.80 m', source:'Synthetic model'},
        notes:[{t:'Large sliding door to the back yard (east); east/south window sealed (window opening closed up)',d:'From the plan'}],
        inv:[{n:'Sofa'},{n:'TV'},{n:'AC unit',lent:'Rani'}], tasks:[{t:'Renovation planning',s:'plan',cost:0}] }),
    bedroomG:R('bedroomG','Bedroom','ground','bedroom',9.7,
      { circuit:'', structure:'Concrete ring beam', bu:{ceiling:'2.80 m', source:'Synthetic model'},
        notes:[{t:'Window 100/130 to the back yard (east)',d:'From the plan'}],
        inv:[{n:'Bed'},{n:'Wardrobe'}], tasks:[{t:'Renovated',s:'done',cost:18000}] }),
    pantry: R('pantry','Pantry','ground','storage',5.4,
      { circuit:'', structure:'Block walls', bu:{ceiling:'2.80 m', source:'Synthetic model'},
        notes:[{t:'West + north windows, high sill (uk=180)',d:'From the plan'}],
        inv:[{n:'Shelves'}], tasks:[{t:'Door + ventilation',s:'prog',cost:3200}] }),
    // ---- FIRST FLOOR (ceiling ~2.50 m) ----
    bedroomSW:R('bedroomSW','Bedroom (south)','upper','bedroom',9.7,
      { circuit:'', structure:'Concrete ring beam', bu:{ceiling:'2.50 m', source:'Synthetic model'},
        notes:[{t:'Window 100/130 in the south wall',d:'From the plan'}], inv:[{n:'Double bed'}] }),
    bedroomNE:R('bedroomNE','Bedroom (north)','upper','room',9.5,
      { circuit:'', structure:'Concrete ring beam', bu:{ceiling:'2.50 m', source:'Synthetic model'},
        notes:[{t:'Window in the east wall',d:'From the plan'}] }),
    terrace:R('terrace','Terrace','upper','roof',25.7,
      { water:'Roof drain', circuit:'', structure:'Concrete floor slab + railing',
        bu:{ceiling:'Open (outdoor)', source:'Synthetic model'},
        notes:[{t:'Paved terrace above the back yard; opening 148/205; solar potential',d:'From the plan'}],
        inv:[{n:'Solar water heater'},{n:'Solar panel'}], tasks:[{t:'Solar potential',s:'plan',cost:0}] }),
    bathU:  R('bathU','Bathroom','upper','bath',5.0,
      { water:'Bathtub 160 · sink · toilet', circuit:'', structure:'Wet zone — concrete walls',
        bu:{ceiling:'2.50 m', source:'Synthetic model'},
        notes:[{t:'Bathtub 160 cm; wet zone',d:'From the plan'}] }),
    landing:R('landing','Staircase','upper','stairs',5.0,
      { circuit:'', structure:'Stair shaft 187 + vestibule', bu:{ceiling:'2.50 m', source:'Synthetic model'},
        notes:[{t:'Vestibule at the top of the stairs; utility strip with shelves on the west',d:'From the plan'}] }),
  }; }

  /* ---------------- persistence: home_workbench_v1 + mergeDefaults ---------------- */
  const KEY='home_workbench_v1';
  function mergeRoom(seed,saved){
    if(!seed) return saved; if(!saved) return seed;
    const out=Object.assign({},seed,saved);
    ['comps','inv','tasks','notes','parts'].forEach(k=>{ out[k]=Array.isArray(saved[k])?saved[k]:(seed[k]||[]); });
    // bu = per-room build-up overrides (object map field→value); preserve user edits
    out.bu=(saved.bu&&typeof saved.bu==='object')?saved.bu:(seed.bu||{});
    return out;
  }
  function mergeDefaults(saved){
    const seed=SEED();
    if(!saved||typeof saved!=='object'||!saved.rooms) return { schema:1, rooms:seed };
    const out={ schema:1, rooms:{} };
    Object.keys(seed).forEach(id=>{ out.rooms[id]=mergeRoom(seed[id], saved.rooms[id]); });
    // keep any user-added rooms not in the seed
    Object.keys(saved.rooms).forEach(id=>{ if(!out.rooms[id]) out.rooms[id]=saved.rooms[id]; });
    return out;
  }
  let DOC;
  function load(){ let raw=null; try{ raw=JSON.parse(localStorage.getItem(KEY)); }catch(e){} DOC=mergeDefaults(raw); }
  function save(){ try{ localStorage.setItem(KEY,JSON.stringify(DOC)); }catch(e){} }
  function room(id){ return DOC.rooms[id]||null; }
  load();

  /* ---------------- CSS (the #inst brass-on-glass language, scoped #wbPanel) ---------------- */
  const CSS=`
  #wbPanel{position:absolute;top:18px;right:22px;width:316px;max-height:calc(100vh - 40px);
    display:none;flex-direction:column;font-family:'Heebo',sans-serif;color:#efe6cf;z-index:9;
    text-shadow:0 1px 2px rgba(0,0,0,.5)}
  #wbPanel.on{display:flex}
  #wbPanel .tabs{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:8px}
  #wbPanel .tab{flex:1 0 auto;text-align:center;font-size:11px;padding:7px 6px;border-radius:7px 7px 0 0;cursor:pointer;
    background:rgba(8,9,18,.86);border:1px solid rgba(202,161,90,.28);border-bottom:none;color:#d7c290;user-select:none;
    backdrop-filter:blur(10px)}
  #wbPanel .tab.on{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;font-weight:600;text-shadow:none}
  #wbPanel .body{overflow-y:auto;padding:14px 15px;border-radius:4px;
    background:linear-gradient(160deg,rgba(12,14,26,.93),rgba(6,7,15,.95));
    backdrop-filter:blur(12px);border:1px solid rgba(202,161,90,.22);box-shadow:0 18px 48px rgba(0,0,0,.55)}
  #wbPanel .hd{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  #wbPanel h3{font-family:'Frank Ruhl Libre',serif;font-weight:500;font-size:19px;color:#fff7e6;line-height:1.1}
  #wbPanel .x{flex:0 0 auto;cursor:pointer;color:#a99b78;font-size:15px;line-height:1;padding:2px 4px;border-radius:6px;
    border:1px solid rgba(202,161,90,.22);background:rgba(255,255,255,.03);transition:.15s}
  #wbPanel .x:hover{color:#fff7e6;border-color:rgba(202,161,90,.5)}
  #wbPanel .sub{font-size:10px;color:#a99b78;margin:3px 0 11px;line-height:1.4}
  #wbPanel .sub .floor{font-family:'Bellefair',serif;letter-spacing:.1em;color:#caa15a}
  #wbPanel .row{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:12.5px;color:#d6ccb2;
    padding:7px 0;border-top:1px solid rgba(202,161,90,.13)}
  #wbPanel .row:first-of-type{border-top:none} #wbPanel .row b{color:#fff7e6;font-weight:600}
  #wbPanel .edit{cursor:pointer;color:#caa15a;font-size:12px;padding:0 4px;border-radius:5px;transition:.15s}
  #wbPanel .edit:hover{color:#fff7e6;background:rgba(202,161,90,.14)}
  #wbPanel .it{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:#d6ccb2;
    padding:6px 0;border-top:1px solid rgba(202,161,90,.1)}
  #wbPanel .it:first-child{border-top:none}
  #wbPanel .pill{font-size:9.5px;padding:1px 8px;border-radius:20px;white-space:nowrap}
  #wbPanel .pill.amber{background:rgba(224,178,74,.18);color:#e8c474;border:1px solid rgba(224,178,74,.4)}
  #wbPanel .pill.green{background:rgba(120,200,120,.16);color:#a7e0a7;border:1px solid rgba(120,200,120,.4)}
  #wbPanel .pill.blue{background:rgba(120,150,210,.16);color:#bcd0f0;border:1px solid rgba(120,150,210,.4)}
  #wbPanel .pill.gold{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;border:1px solid #e0c483}
  #wbPanel .tag{font-size:10px;color:#a99b78}
  #wbPanel .note{font-size:10.5px;color:#a99b78;line-height:1.5;margin-top:8px;
    border-right:2px solid rgba(202,161,90,.3);padding-right:8px}
  #wbPanel .card{background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.15);border-radius:8px;padding:9px 11px;margin-top:9px}
  #wbPanel .card:first-child{margin-top:0}
  #wbPanel .cct{font-family:'Bellefair',serif;letter-spacing:.05em;font-size:12px;color:#caa15a;
    margin-bottom:2px;display:flex;align-items:center;gap:6px}
  #wbPanel .card .row:first-of-type{border-top:none}
  #wbPanel .cons{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;color:#cdbd92;line-height:1.5;
    padding:6px 0;border-top:1px solid rgba(202,161,90,.1)}
  #wbPanel .cons:first-of-type{border-top:none}
  #wbPanel .cons .ci{flex:0 0 auto;font-size:15px;line-height:1.3}
  #wbPanel .ridea{padding:7px 0;border-top:1px solid rgba(202,161,90,.1)}
  #wbPanel .ridea:first-of-type{border-top:none}
  #wbPanel .ridea .rih{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12.5px;color:#fff7e6}
  #wbPanel .ridea .rih b{font-weight:600}
  #wbPanel .ridea .rim{font-size:12px;color:#e8c474;margin-top:2px}
  #wbPanel .ridea .rip{font-size:10px;color:#a99b78;margin-top:1px;line-height:1.4}
  #wbPanel .add{margin-top:10px;font-size:11.5px;color:#cdbd92;background:rgba(255,255,255,.04);
    border:1px dashed rgba(202,161,90,.4);border-radius:7px;padding:7px 10px;text-align:center;cursor:pointer;transition:.15s}
  #wbPanel .add:hover{border-color:rgba(202,161,90,.7);color:#fff7e6}
  #wbPanel .bar{height:7px;border-radius:20px;background:rgba(255,255,255,.07);overflow:hidden;margin-top:6px}
  #wbPanel .bar i{display:block;height:100%;border-radius:20px}
  #wbPanel .foot{font-size:9.5px;color:#7d7150;margin-top:11px}
  @media(max-width:960px){#wbPanel{width:calc(100vw - 24px);max-width:none;right:12px;left:12px;top:10px;max-height:calc(100vh - 20px)}}
  @media(max-width:760px){
    /* phone: keep the instrument fully on-screen, never overflow, scroll internally */
    #wbPanel{right:8px;left:8px;top:8px;width:auto;max-width:none;max-height:calc(100vh - 16px)}
    #wbPanel .tabs{gap:4px;margin-bottom:6px}
    /* 8-tab strip wraps; give each chip a comfortable tap target */
    #wbPanel .tab{flex:1 0 auto;min-width:62px;font-size:11px;padding:9px 7px;min-height:34px;
      display:flex;align-items:center;justify-content:center;border-radius:8px}
    #wbPanel .body{padding:11px 12px;max-height:none}
    #wbPanel h3{font-size:18px}
    #wbPanel .sub{font-size:11px}
    /* ✕ close — bigger hit area */
    #wbPanel .x{font-size:16px;padding:6px 9px;min-width:34px;min-height:34px;
      display:inline-flex;align-items:center;justify-content:center}
    /* rows / items stay readable; let long values wrap instead of squashing */
    #wbPanel .row{font-size:12.5px;flex-wrap:wrap}
    #wbPanel .it,#wbPanel .cons{font-size:12px;flex-wrap:wrap}
    /* inline ✎ / ＋ / ↻ / ✕ edit controls — pad out to ~34px tap targets */
    #wbPanel .edit,#wbPanel a.edit{font-size:12px;padding:6px 8px;min-width:30px;
      display:inline-flex;align-items:center;justify-content:center;line-height:1}
    /* full-width dashed add buttons — taller for the thumb */
    #wbPanel .add{padding:11px 12px;font-size:12px;min-height:40px;
      display:flex;align-items:center;justify-content:center}
    #wbPanel .card{padding:10px 11px}
    #wbPanel .note{font-size:11px}
    #wbPanel .tag,#wbPanel .ridea .rip,#wbPanel .foot{font-size:11px}
    #wbPanel .pill{font-size:11px;padding:2px 9px}
    #wbPanel .ridea .rih,#wbPanel .ridea .rim{font-size:12.5px}
  }
  `;

  /* ---------------- view ---------------- */
  let panel=null, body=null, tabsEl=null, cur=null, TAB='overview', _instPrev=null;
  const FLOOR_HE={ground:'Ground floor',upper:'Upper floor'};
  const FLOOR_SH={ground:'Ground',upper:'Upper'};
  const TABS=[['overview','Overview'],['climate','Climate'],['structure','Structure'],['inv','Inventory'],['mep','Power·Water'],['reno','Renovation'],['parts','Parts·Replacements'],['notes','Notes']];

  /* ---- derived ROOM CLIMATE (parallels the garden's microclimate). Aspect/sun/floor are
     GEOMETRY, from the plan-frame room rect via __enterMode.roomGeom (PLAN→WORLD: -z=West/
     plaza, +z=East/back-yard, -x=South, +x=North). Temperature = the engine's whole-house
     Derive.indoorTemp + a TRANSPARENT per-room exposure lean (afternoon-west & upper run
     hottest; north & ground coolest, ≈34.0°N). Labelled a model. ---- */
  const ASPECT_HE={W:'West',E:'East',N:'North',S:'South'};
  const ASPECT_SUN={W:'Afternoon sun',E:'Morning sun',S:'Midday sun',N:'Little direct sun'};
  const ASPECT_HEAT={W:2.0,S:1.5,E:0.9,N:0.0};
  const WB_BX=8.41, WB_BXS=10.50, WB_BZ=7.20;
  function geomOf(id){ return (window.__enterMode&&window.__enterMode.roomGeom)?window.__enterMode.roomGeom(id):null; }
  function roomAspect(g){
    if(!g) return []; const ext=[], e=0.06;
    if(g.z0<=e) ext.push('W');
    if(g.z1>=WB_BZ-e) ext.push('E');
    if(g.x0<=e) ext.push('S');
    const xmax=(g.z0>=3.6-e)?WB_BXS:WB_BX;
    if(g.x1>=xmax-e) ext.push('N');
    return ext;
  }
  function warmthScore(g){ if(!g) return 0; let s=(g.floor==='upper')?2.0:0; roomAspect(g).forEach(d=>s+=ASPECT_HEAT[d]||0); return s; }
  const RISK_HE={high:'High',med:'Medium',low:'Low'};
  // WINTER CONDENSATION: a surface fogs when its inner face drops below the indoor dew
  // point. Coldest exterior wall (north > E/W > south; no solar gain) vs the dew point of
  // a heated room (~20°/55%). Inner-surface ≈ indoor − f·(indoor−outdoor); f bigger for
  // north/upper (thermal-bridge proxy). Outdoor = MR winter design low ~1°. Labelled model.
  function condensationRisk(g){
    const D=window.Derive; if(!D||!D.dewPoint||!g) return null;
    const ext=roomAspect(g), indoorT=20, indoorRH=55, out=1;
    const dew=Math.round(D.dewPoint(indoorT,indoorRH)*10)/10;
    if(!ext.length) return { ext, dew, risk:'low', wall:null, surf:null };
    const cold = ext.indexOf('N')>=0?'N':(ext.indexOf('E')>=0?'E':(ext.indexOf('W')>=0?'W':'S'));
    const chill={N:1.3,E:1.0,W:1.0,S:0.8}[cold]*(g.floor==='upper'?1.05:1.0);
    const surf=Math.round((indoorT-0.35*chill*(indoorT-out))*10)/10;
    const risk=surf<dew-0.5?'high':(surf<dew+1.5?'med':'low');
    return { ext, dew, risk, wall:cold, surf };
  }
  // RENOVATION smarts: what's costly/hard to change, from the room's type/water/aspect/structure.
  function renoConsiderations(r,g){
    const ext=roomAspect(g), bits=[];
    const wet=(r.type==='bath'||r.type==='kitchen'||(r.water&&r.water!=='—'&&r.water!==''));
    if(wet) bits.push({icon:'🚰',he:'Wet zone — plumbing and drainage are here. Relocating the plumbing is among the costliest parts of a renovation; keeping the wet zone in place saves money.'});
    if(ext.length) bits.push({icon:'🧱',he:`${ext.length} exterior walls (${ext.map(d=>ASPECT_HE[d]).join(' · ')}) — insulation, windows and sealing affect comfort and energy. Interior walls are far cheaper to move.`});
    else bits.push({icon:'🧱',he:'Interior room — no exterior envelope; the interior walls are flexible and cheap to change.'});
    if(r.structure && /concrete|beam|column|bearing/i.test(r.structure)) bits.push({icon:'🏗️',he:'There is a structural element (concrete / ring beam / column) — load-bearing; do not remove without a structural engineer.'});
    return bits;
  }

  /* ---- scrub-aware date: the render loop publishes the live MODEL date on
     window.__mcDate (a Date). Fall back to real now. isToday() = same civil day
     as the wall clock, so "now"-only data (live Weather.state) is shown only
     when the scene is parked at today. ---- */
  function sceneDate(){ const d=window.__mcDate; return (d instanceof Date && !isNaN(d))?d:new Date(); }
  function sameDay(a,b){ return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }
  function isToday(d){ return sameDay(d,new Date()); }

  /* ---- ACTUAL HISTORY (the Living Record, for THIS room).
     Honesty contract: there is NO interior sensor and NO per-interior-room
     measured store — RecordStore accumulates the YARD zones. What is genuinely
     MEASURED (Open-Meteo, based on real measurements) is the OUTDOOR weather the whole
     house actually sat in: real days recorded, absolute outdoor min/max, frost
     nights, rain. The INTERIOR figures stay MODELED (modeled) — the room's damped
     response to that measured outdoor, via the same warmth lean used above.
     We probe for a future RecordStore.roomTotals/roomDaily or Derive.roomDay and
     use them if a parallel build ever lands them; otherwise we surface the real
     measured OUTDOOR envelope + the modeled interior, never faking a sensor. ---- */
  function houseOutdoorMeasured(){
    const RS=window.RecordStore; if(!RS) return null;
    let st=null; try{ st=RS.status&&RS.status(); }catch(e){}
    // representative yard zone = the whole-house OUTDOOR envelope (one town air).
    let z0=null; try{ const zs=RS.allZones&&RS.allZones(); if(zs&&zs.length) z0=zs[0]; }catch(e){}
    let tot=null;
    if(z0&&RS.zoneTotals){ try{ tot=RS.zoneTotals(z0.id); }catch(e){} }
    const days=(st&&st.days)||(tot&&tot.days)||0;
    if(!days) return { days:0, building:!!(st&&st.building), pct:(st&&st.pct)||0,
                       firstDate:st&&st.firstDate, lastDate:st&&st.lastDate, tMinAbs:null, tMaxAbs:null, frostNights:null, rainSum:null };
    return { days,
      building:!!(st&&st.building), pct:(st&&st.pct)||100,
      firstDate:(st&&st.firstDate)||null, lastDate:(st&&st.lastDate)||null,
      tMinAbs:(tot&&tot.tMinAbs!=null)?tot.tMinAbs:null,
      tMaxAbs:(tot&&tot.tMaxAbs!=null)?tot.tMaxAbs:null,
      frostNights:(tot&&tot.frostNights!=null)?tot.frostNights:null,
      rainSum:(tot&&tot.rainSum!=null)?tot.rainSum:null };
  }
  // GENUINE per-ROOM record (foundation's RecordStore.roomTotals — the room's
  // MODELED indoor curve from MEASURED outdoor via Derive.roomDay, accumulated).
  // roomTotals lacks dates, so borrow the recorded span from status().
  function roomMeasured(id){
    const RS=window.RecordStore; if(!RS||typeof RS.roomTotals!=='function') return null;
    try{
      const t=RS.roomTotals(id); if(!t||!t.days) return null;
      let st=null; try{ st=RS.status&&RS.status(); }catch(e){}
      return Object.assign({ firstDate:st&&st.firstDate, lastDate:st&&st.lastDate }, t);
    }catch(e){ return null; }
  }
  // pretty he date span (DD.MM) from ISO; null-safe.
  function spanHe(a,b){ const f=s=>{ const p=String(s||'').slice(0,10).split('-'); return (p[2]&&p[1])?(p[2]+'.'+p[1]):''; };
    const x=f(a),y=f(b); return (x&&y)?(x+'–'+y):(x||y||''); }
  // the room's MODELED interior min/max from the MEASURED outdoor extremes: damp
  // the outdoor swing through the mass (same ~10h-lag idea indoorTemp uses → the
  // interior barely tracks the outdoor min/max), then add the room's warmth lean.
  function modelRoomFromOutdoor(tOutMin,tOutMax,myScore,mean){
    if(tOutMin==null||tOutMax==null) return null;
    const lean=(myScore-mean)*0.45;                 // same lean as the live card
    const mid=(tOutMin+tOutMax)/2, half=(tOutMax-tOutMin)/2;
    const damp=0.28;                                 // masonry attenuation of the daily swing
    return { min:Math.round((mid-half*damp+lean)*10)/10, max:Math.round((mid+half*damp+lean)*10)/10 };
  }
  function historyCardHTML(r,g,myScore,mean){
    const rm=roomMeasured(r.id);                      // genuine per-room store, if a build ever lands it
    const ho=houseOutdoorMeasured();
    // NEITHER source has data yet → honest model-only line.
    if(!rm && (!ho || !ho.days)){
      const bld=(ho&&ho.building);
      return `<div class="card"><div class="cct">🗒️ The room's history <span class="pill amber">Model · estimate</span></div>`+
        `<div class="note">${bld?'The live log is being built right now from real measurements (Open-Meteo)… the accumulated data will appear here.':'No accumulated measurements yet. What is shown above is a local-climate model (an estimate), not a sensor.'}</div></div>`;
    }
    // GENUINE per-room living record (preferred): the room's MODELED indoor curve
    // accumulated day-by-day from the MEASURED outdoor air. Honest: the inputs are
    // real measurements (Open-Meteo) but the indoor figures are computed, never a
    // sensor — the pill credits the measurements, the note states the modeling.
    if(rm){
      const span=spanHe(rm.firstDate,rm.lastDate);
      let h=`<div class="card"><div class="cct">🗒️ What the room has been through <span class="pill green">Based on real measurements</span></div>`+
        `<div class="row"><span>Days in the log</span><b>${rm.days}${span?` · ${span}`:''}</b></div>`;
      if(rm.tMinAbs!=null&&rm.tMaxAbs!=null)
        h+=`<div class="row"><span>Room range <span class="pill amber">Model</span></span><b>~${rm.tMinAbs}° … ~${rm.tMaxAbs}°</b></div>`;
      if(rm.tMeanAvg!=null)
        h+=`<div class="row"><span>Room average</span><b>~${rm.tMeanAvg}°</b></div>`;
      if(rm.hoursBelow18)
        h+=`<div class="row"><span>Cool hours (&lt;18°)</span><b>${Math.round(rm.hoursBelow18)}</b></div>`;
      if(rm.hoursAbove28)
        h+=`<div class="row"><span>Hot hours (&gt;28°)</span><b>${Math.round(rm.hoursAbove28)}</b></div>`;
      if(rm.comfortHours)
        h+=`<div class="row"><span>Comfort hours (18–26°)</span><b>${Math.round(rm.comfortHours)}</b></div>`;
      if(rm.condensationRiskDays)
        h+=`<div class="row"><span>Condensation-risk days</span><b>${rm.condensationRiskDays}</b></div>`;
      h+=`<div class="note">The outdoor weather is measured (Open-Meteo) for the house's location; the room temperature is computed from it through the house geometry — not a physical sensor.</div></div>`;
      return h;
    }
    // measured OUTDOOR envelope the house sat in + the room's MODELED interior.
    const span=spanHe(ho.firstDate,ho.lastDate);
    const interior=modelRoomFromOutdoor(ho.tMinAbs,ho.tMaxAbs,myScore,mean);
    let h=`<div class="card"><div class="cct">🗒️ What the room has been through <span class="pill green">Based on real measurements</span></div>`+
      `<div class="row"><span>Accumulated days</span><b>${ho.days}${span?` · ${span}`:''}</b></div>`;
    if(ho.tMinAbs!=null&&ho.tMaxAbs!=null)
      h+=`<div class="row"><span>Outdoor range (measured)</span><b>~${ho.tMinAbs}° … ~${ho.tMaxAbs}°</b></div>`;
    if(ho.frostNights!=null)
      h+=`<div class="row"><span>Frost nights</span><b>${ho.frostNights}</b></div>`;
    if(ho.rainSum!=null)
      h+=`<div class="row"><span>Accumulated rain</span><b>${ho.rainSum} mm</b></div>`;
    if(interior)
      h+=`<div class="row"><span>Room range <span class="pill amber">Model</span></span><b>~${interior.min}° … ~${interior.max}°</b></div>`;
    if(ho.building)
      h+=`<div class="tag" style="margin-top:6px">⏳ The log is still building in the background${ho.pct?` (${ho.pct}%)`:''}</div>`;
    h+=`<div class="note">Outdoor weather — measured (Open-Meteo) for the house's location. Room range — modeled: the damped response of the interior mass to the measurements, not a sensor.</div></div>`;
    return h;
  }

  function ensure(){
    if(panel) return;
    document.head.appendChild(el('style',null,CSS));
    panel=el('div'); panel.id='wbPanel'; panel.setAttribute('dir','ltr');
    tabsEl=el('div','tabs'); body=el('div','body'); panel.appendChild(tabsEl); panel.appendChild(body);
    document.body.appendChild(panel);
    tabsEl.addEventListener('click',e=>{ const t=e.target.closest('.tab'); if(!t) return; TAB=t.dataset.t; render(); });
    body.addEventListener('click',onBodyClick);
  }
  // the instrument panel (#inst) and the workbench share the top-right slot; show
  // one at a time — hide #inst while a room is open, restore it on close.
  function hideInst(){ const i=document.querySelector('#inst:not(.inst-embed)'); if(i&&_instPrev===null){ _instPrev=i.style.display; i.style.display='none'; } }
  function restoreInst(){ const i=document.querySelector('#inst:not(.inst-embed)'); if(i&&_instPrev!==null){ i.style.display=_instPrev; } _instPrev=null; }

  // ---- renovation KB (data/renovation_kb.json): per-room renovation IDEAS with $ ranges +
  //      permit + duration, surfaced in the Renovation tab. Honest ESTIMATES (ranges, not quotes). ----
  let _renoKB=null, _renoKBtried=false;
  function loadRenoKB(){
    if(_renoKBtried) return; _renoKBtried=true;
    try{ fetch('data/renovation_kb.json').then(r=>r&&r.ok?r.json():null).then(j=>{ _renoKB=j||null;
      if(TAB==='reno' && cur && panel && panel.classList.contains('on')) render(); }).catch(()=>{}); }catch(e){}
  }
  const RENO_TYPE_TAG={ bath:'bath', kitchen:'kitchen', living:'living', bedroom:'bedroom', room:'bedroom', storage:'whole-house', stairs:'stairs', roof:'roof' };
  function renoIdeasHTML(r){
    if(!_renoKB || !Array.isArray(_renoKB.renovations)){ loadRenoKB(); return ''; }
    const tag=RENO_TYPE_TAG[r.type]||'whole-house';
    const ideas=_renoKB.renovations.filter(rv=>Array.isArray(rv.suits) && (rv.suits.indexOf(tag)>=0 || rv.suits.indexOf('whole-house')>=0));
    if(!ideas.length) return '';
    const rows=ideas.map(rv=>`<div class="ridea"><div class="rih"><span>${rv.emoji||'🔧'} <b>${esc(rv.name_he)}</b></span>`+
        `<span class="edit" data-act="addReno" data-arg="${esc(rv.id)}" title="Add to the plan">＋</span></div>`+
        `<div class="rim">${esc(rv.cost_he||'')}</div>`+
        `<div class="rip">${esc([rv.permit_he,rv.duration_he].filter(Boolean).join(' · '))}</div></div>`).join('');
    return `<div class="card"><div class="cct">💡 Renovation ideas for the room <span class="pill blue">Estimate</span></div>${rows}`+
      `<div class="note">Costs are estimated ranges (not a quote) · click ＋ to add as a task.</div></div>`;
  }

  function render(){
    const r=room(cur); if(!r){ return; }
    tabsEl.innerHTML=TABS.map(([k,l])=>`<div class="tab${k===TAB?' on':''}" data-t="${k}">${l}</div>`).join('');
    // Structure/circuit/water are NOT in the byte-identical scanned drawings — show
    // 'estimated' by DEFAULT; only an explicit user "verify" (r.est===false) clears it.
    const est=(r.est===false)?'':' <span class="pill amber">estimated</span>';
    let html='';
    if(TAB==='overview'){
      const open=(r.tasks||[]).filter(t=>t.s!=='done').length;
      html=`<div class="row"><span>Floor</span><span>${FLOOR_SH[r.floor]||''}</span></div>`+
        `<div class="row"><span>Area</span><b>${r.area} m²</b></div>`+
        `<div class="row"><span>▦ Structure</span><span>${esc(r.structure||'—')}${r.structure?est:''}</span></div>`+
        `<div class="row"><span>🔧 Components</span><b>${(r.comps||[]).length}</b></div>`+
        `<div class="row"><span>📦 Inventory</span><b>${(r.inv||[]).length}</b></div>`+
        `<div class="row"><span>⚡ Power</span><span>${esc(r.circuit||'—')}${r.circuit?est:''}</span></div>`+
        `<div class="row"><span>🚰 Water</span><span>${esc(r.water||'—')}${r.water?est:''}</span></div>`+
        `<div class="row"><span>✅ Open tasks</span><b>${open}</b></div>`;
    } else if(TAB==='climate'){
      const g=geomOf(r.id), ext=roomAspect(g), D=window.Derive;
      // scrub-aware: read the BASE house temp at the current SCENE date (not only
      // live now), so scrubbing the clock/season moves the room estimate.
      const wbDate=sceneDate(), today=isToday(wbDate);
      const base=(D&&D.indoorTemp)?D.indoorTemp(wbDate):null;
      const scores=Object.keys(DOC.rooms).map(id=>({id,g:geomOf(id)})).filter(x=>x.g).map(x=>({id:x.id,s:warmthScore(x.g)}));
      const mean=scores.length?scores.reduce((a,x)=>a+x.s,0)/scores.length:0;
      const sorted=scores.slice().sort((a,b)=>b.s-a.s);
      const n=sorted.length, rank=sorted.findIndex(x=>x.id===r.id);
      const myScore=g?warmthScore(g):mean;
      const tier=rank<0?'':(rank<n/3?'Among the warmest in the house':(rank>=Math.ceil(2*n/3)?'Among the coolest':'Mid-range room'));
      const offset=Math.round((myScore-mean)*0.45*10)/10;
      const roomTemp=base?Math.round((base.tempC+offset)*10)/10:null;
      // night-cooling uses the LIVE outdoor air — honest only when the scene is
      // parked at today. When scrubbed to another day we have no measured outdoor
      // AIR for that hour, so we suppress the card rather than show today's reading.
      const W=window.Weather, out=(today&&W&&W.state&&W.state.temp!=null)?W.state.temp:null;
      const canCool=(out!=null&&base&&out<base.tempC-1&&ext.length>0);
      const frac=(n>1&&sorted[0].s!==sorted[n-1].s)?(myScore-sorted[n-1].s)/(sorted[0].s-sorted[n-1].s):0.5;
      let h=`<div class="card"><div class="cct">Orientation & sun <span class="pill green">Plan</span></div>`;
      if(ext.length){
        h+=`<div class="row"><span>Exterior faces</span><span>${ext.map(d=>ASPECT_HE[d]).join(' · ')}</span></div>`+
           `<div class="row"><span>Sun</span><span>${[...new Set(ext.map(d=>ASPECT_SUN[d]))].join(' · ')}</span></div>`;
      } else h+=`<div class="tag">Interior room — no direct exterior wall; thermally stable.</div>`;
      h+=`<div class="row"><span>Floor</span><span>${FLOOR_HE[r.floor]||''}${r.floor==='upper'?' · close to the roof':''}</span></div></div>`;
      if(roomTemp!=null){
        h+=`<div class="card"><div class="cct">Temperature ${today?'now':'on this date'} <span class="pill amber">Model</span></div>`+
          `<div class="row"><span>The room (estimated)</span><b>~${roomTemp}°C</b></div>`+
          `<div class="row"><span>House baseline</span><span>~${base.tempC}°C${offset?` · room ${offset>0?'+':''}${offset}°`:''}</span></div>`+
          `<div class="bar"><i style="width:${Math.round(frac*100)}%;background:linear-gradient(90deg,#6f9fd0,#caa15a,#d98a5a)"></i></div>`+
          `<div class="row"><span>Tendency</span><span>${tier}</span></div>`+
          `<div class="note">${esc(base.note_he||'')}</div></div>`;
      }
      if(canCool) h+=`<div class="card"><div class="cct">🌙 Night cooling</div>`+
        `<div class="row"><span>Outside ~${Math.round(out)}° · inside ~${base.tempC}°</span></div>`+
        `<div class="note">The outdoor air is already colder than the interior mass — opening windows will cool for free instead of using AC.</div></div>`;
      const cd=condensationRisk(g);
      if(cd&&cd.wall){ const rp=cd.risk==='low'?'green':'amber';
        h+=`<div class="card"><div class="cct">💧 Winter condensation <span class="pill amber">Model</span></div>`+
          `<div class="row"><span>${ASPECT_HE[cd.wall]} wall (the coldest)</span><span>~${cd.surf}°</span></div>`+
          `<div class="row"><span>Dew point (interior)</span><span>~${cd.dew}°</span></div>`+
          `<div class="row"><span>Risk</span><span class="pill ${rp}">${RISK_HE[cd.risk]}</span></div>`+
          `<div class="note">On a cold winter night (outside ~1°, heated house ~20° · humidity ~55%). ${cd.risk!=='low'?'Short daytime ventilation and reducing moisture (cooking/showering) lower condensation and mold on the wall.':'The wall stays above the dew point — low risk.'}</div></div>`;
      }
      // ---- ACTUAL HISTORY (Living Record) — real measured outdoor envelope the
      // house sat in + the room's MODELED response. Honest fallback when empty. ----
      h+=historyCardHTML(r,g,myScore,mean);
      html=h+`<div class="note">Orientation and floor — from the plan (synthetic model). Temperature and condensation — local-climate model, an estimate.</div>`;
    } else if(TAB==='structure'){
      html=structureHTML(r)+
        `<div class="row" style="margin-top:8px"><span>Free-text description</span><span>${esc(r.structure||'—')}${r.structure?est:''}</span></div>`+
        `<div class="add" data-act="plan">📄 About the model source (demo)</div>`+
        `<div class="add" data-act="setField" data-arg="structure">✎ Edit structure description</div>`+
        `<div class="add" data-act="toggleEst">${r.est!==false?'✓ Mark the description as verified':'⚑ Mark the description as estimated'}</div>`;
    } else if(TAB==='inv'){
      html=listHTML(r.comps,'comps','🔧 No components','Fixed components')+
        `<div class="add" data-act="addItem" data-arg="comps">＋ Add component</div>`+
        `<div style="height:6px"></div>`+
        listHTML(r.inv,'inv','📦 No items','Inventory / furniture')+
        `<div class="add" data-act="addItem" data-arg="inv">＋ Add inventory item</div>`;
    } else if(TAB==='mep'){
      html=`<div class="row"><span>⚡ Electrical circuit</span><span><span>${esc(r.circuit||'Unknown')}</span> <span class="edit" data-act="setField" data-arg="circuit">✎</span></span></div>`+
        `<div class="row"><span>🚰 Water</span><span><span>${esc(r.water||'—')}</span> <span class="edit" data-act="setField" data-arg="water">✎</span></span></div>`+
        `<div class="note">⚡ <b>No electrical plan in the model</b> — circuits/sockets are not in the drawings. (The previous C1–C5 data was a placeholder and not real; it was deleted.) Fill in manually whatever the resident knows.<br>🚰 Wet zones — from the plan.</div>`;
    } else if(TAB==='reno'){
      const tot=(r.tasks||[]).reduce((a,t)=>a+(t.cost||0),0);
      const rows=(r.tasks||[]).map((t,i)=>`<div class="it"><span><span class="pill ${t.s==='done'?'green':t.s==='prog'?'amber':'blue'}">${t.s==='done'?'Done':t.s==='prog'?'In progress':'Planned'}</span> ${esc(t.t)}</span>`+
        `<span>${t.cost?'$'+t.cost.toLocaleString():''} <span class="edit" data-act="addMat" data-arg="${i}" title="Add material to the project (→ shared procurement)">🔩</span> <span class="edit" data-act="cycleTask" data-arg="${i}">↻</span> <span class="edit" data-act="delItem" data-arg="tasks" data-arg2="${i}">✕</span></span></div>`).join('')||'<div class="tag">No tasks</div>';
      // PLOT-LEVEL planning card at the TOP — identical for every room (the planning
      // governs the whole lot, not a single room). Kicks off Planning.load() once.
      // When the RICH card module (window.__planning) is loaded we mount its full
      // 'What's allowed on the lot' content (building addition / safe room / floor / yard / exemption / links)
      // into a host placeholder AFTER body.innerHTML is set — see render()'s tail.
      // Otherwise we fall back to the simpler inline planningCardHTML() (load-order safe).
      const cons=renoConsiderations(r,geomOf(r.id));
      const consHTML=cons.length?`<div class="card"><div class="cct">Renovation considerations <span class="pill green">Derived</span></div>`+
        cons.map(c=>`<div class="cons"><span class="ci">${c.icon}</span><span>${c.he}</span></div>`).join('')+`</div>`:'';
      const richPlan=!!(window.__planning&&window.__planning.render);
      const planHTML=richPlan?`<div id="wbRichPlan"></div>`:planningCardHTML();
      html=planHTML+consHTML+renoIdeasHTML(r)+rows+`<div class="row" style="margin-top:6px"><span>Estimated total</span><b>$${tot.toLocaleString()}</b></div>`+
        `<div class="add" data-act="addTask">＋ Add task</div>`;
      if(!richPlan) kickPlanning();
    } else if(TAB==='parts'){
      html=partsHTML(r)+
        `<div class="add" data-act="addPart">＋ Add part / replacement</div>`+
        `<div class="note">Log of parts and replacements — when installed, when replaced, warranty and supplier. The house's maintenance memory.</div>`;
    } else if(TAB==='notes'){
      html=listHTML(r.notes,'notes','📝 No notes',null)+`<div class="add" data-act="addNote">＋ Add note</div>`;
    }
    body.innerHTML=`<div class="hd"><h3>${esc(r.name)}</h3><span class="x" data-act="close" title="Close">✕</span></div>`+
      `<div class="sub"><span class="floor">${FLOOR_HE[r.floor]||''}</span> · ${r.area} m² · ${typeHe(r.type)}</div>`+
      html+
      `<div class="foot">Saved automatically · same language as Yard · Sky · Energy</div>`;
    // mount the RICH plot-rights card (planning_card.js) into its host placeholder,
    // now that the markup is in the DOM. Defensive: only if the host rendered AND
    // the module is present (the reno branch already chose the inline fallback when
    // it isn't). __planning.render() is itself a safe no-op on a bad host.
    if(TAB==='reno'){
      const host=body.querySelector('#wbRichPlan');
      if(host && window.__planning && window.__planning.render){
        try{ window.__planning.ensureCSS&&window.__planning.ensureCSS(); }catch(e){}
        try{ window.__planning.render(host, sceneDate()); }catch(e){}
      }
    }
  }
  function typeHe(t){ return ({bath:'Bath',kitchen:'Kitchen',living:'Living',bedroom:'Bedroom',room:'Room',storage:'Storage',stairs:'Passage',roof:'Roof / outdoor'})[t]||''; }

  /* ---- structure build-up rows from HouseBuildup (gotcha #2):
     verified facts (wall/slab/roof/levels/areas, all proven in building.js)
     render plain; anything not in the drawings (belt/columns/circuit/floor
     finish / wall layers) gets an «estimated» pill + a 'not drawn' note and stays
     blank-and-editable. Falls back to a single honest note if the loader
     isn't present. ---- */
  function estPill(){ return ' <span class="pill amber">estimated</span>'; }
  function buRow(label,val,verified,note){
    const v=(val==null||val==='')?'—':esc(val);
    return `<div class="row"><span>${esc(label)}</span><span><b>${v}</b>${verified?'':estPill()}</span></div>`+
      (note?`<div class="note">${esc(note)}</div>`:'');
  }
  function structureHTML(r){
    if(!(window.HouseBuildup&&HouseBuildup.get)){
      return `<div class="note">Structure data is a synthetic-model estimate — not measured on site.</div>`;
    }
    const b=HouseBuildup.get(cur, r.floor), A=b.assemblies||{}, L=b.levels||{}, rm=b.room||{};
    let h='<div class="tag" style="margin:2px 0 4px">Verified construction · from the model</div>';
    // walls present in this room
    (b.walls||[]).forEach(w=>{
      const t=(w.thickness_m!=null)?(Math.round(w.thickness_m*100)+' cm'):'';
      h+=buRow(w.label||'Wall', t+(w.finish_he?(' · '+w.finish_he):''), w.verified, '');
      if(w.layers && w.layers_verified===false){
        h+=buRow('Wall layer composition', (w.layers.map(x=>x.n).filter(Boolean).join(' · ')||''), false, w.note_he||'');
      }
    });
    if(A.slab)     h+=buRow(A.slab.label||'Concrete floor slab', Math.round(A.slab.thickness_m*100)+' cm', A.slab.verified, '');
    if(r.floor==='upper' && A.roofSlab) h+=buRow(A.roofSlab.label||'Roof slab', Math.round(A.roofSlab.thickness_m*100)+' cm', A.roofSlab.verified, '');
    // levels (verified)
    if(L.verified){
      const lev=r.floor==='upper'
        ? `${L.firstFloor_m.toFixed(2)} → roof ${L.roofSlab_m.toFixed(2)}`
        : `${L.ground_m.toFixed(2)} → ceiling ${L.firstFloor_m.toFixed(2)}`;
      h+=buRow('Levels (m)', lev, true, '');
    }
    // unverified deep rows — blank + editable + estimated/not drawn
    h+='<div class="tag" style="margin:9px 0 4px">Not drawn · editable</div>';
    h+=buRowEditable('Floor finish', rm.floorFinish, 'floorFinish');
    h+=buRowEditable('Concrete ring beam', rm.concreteBelt, 'concreteBelt');
    h+=buRowEditable('Columns', rm.columns, 'columns');
    return h;
  }
  /* ---- parts/replacements log (Parts·Replacements): reuses .it/.pill/.tag/.edit,
     no new CSS. Each part {n, installed, replaced, warr, supplier}. ---- */
  function partsHTML(r){
    const arr=r.parts||[];
    if(!arr.length) return `<div class="tag">🔧 No parts recorded</div>`;
    return arr.map((p,i)=>{
      const sub=[];
      if(p.installed) sub.push('Installed '+esc(p.installed));
      if(p.replaced)  sub.push('Replaced '+esc(p.replaced));
      if(p.warr)      sub.push('Warranty '+esc(p.warr));
      if(p.supplier)  sub.push('Supplier '+esc(p.supplier));
      const replPill=p.replaced?` <span class="pill green">Replaced</span>`:'';
      return `<div class="it"><span><b>${esc(p.n||'Part')}</b>${replPill}`+
        (sub.length?`<div class="tag" style="margin-top:2px">${sub.join(' · ')}</div>`:'')+
        `</span><span><span class="edit" data-act="editPartDate" data-arg="${i}" title="Update replacement / details">✎</span> `+
        `<span class="edit" data-act="delItem" data-arg="parts" data-arg2="${i}">✕</span></span></div>`;
    }).join('');
  }
  // an editable unverified build-up row: value is the user-saved override
  // (r.bu[field]) when present, else the JSON blank; shows estimated + a ✎.
  function buRowEditable(label,cell,field){
    const r=room(cur), saved=(r&&r.bu&&r.bu[field]!=null)?r.bu[field]:null;
    const val=(saved!=null&&saved!=='')?saved:((cell&&cell.he)?cell.he:'');
    const note=(cell&&cell.note_he)?cell.note_he:'';
    const v=(val==='')?'—':esc(val);
    return `<div class="row"><span>${esc(label)}</span><span><b>${v}</b>${estPill()} <span class="edit" data-act="setBU" data-arg="${field}">✎</span></span></div>`+
      (note?`<div class="note">${esc(note)}</div>`:'');
  }
  function listHTML(arr,key,empty,title){
    arr=arr||[]; const head=title?`<div class="tag" style="margin:2px 0 4px">${title}</div>`:'';
    if(!arr.length) return head+`<div class="tag">${empty}</div>`;
    return head+arr.map((x,i)=>`<div class="it"><span>${esc(x.n||x.t)}`+
      `${x.lent?` <span class="pill blue">Lent to ${esc(x.lent)}</span>`:''}`+
      `${x.d?` <span class="tag">· ${esc(x.d)}</span>`:''}</span>`+
      `<span class="edit" data-act="delItem" data-arg="${key}" data-arg2="${i}">✕</span></div>`).join('');
  }

  /* ---- PLOT-LEVEL planning card ('📋 What's allowed on the lot · planning'): lists the
     official planning-registry plans that GOVERN the lot, each with a link to
     its planUrl page where the real building-rights text lives. PLOT-level → the
     same card regardless of which room is open. Reuses .card/.cct/.row/.tag/.pill
     /.note — no new CSS. States: loading (no data yet), error (couldn't load /
     no plans), and the list. HONEST: we never print height/coverage numbers here
     — only which plans apply + a link to the official document. ---- */
  function planningCardHTML(){
    const P=window.Planning, d=P&&P.get&&P.get();
    let h=`<div class="card"><div class="cct">📋 What's allowed on the lot · planning <span class="pill green">Registry · live</span></div>`;
    if(!d){
      // not loaded yet — show a loading line; kickPlanning() will fetch + re-render.
      return h+`<div class="tag">Loading planning data from the planning authority…</div></div>`;
    }
    const plans=d.plans||[];
    if(!plans.length){
      // error or genuinely no governing plan returned — honest, non-fabricated state.
      const msg=d.error&&d.error!=='no-results'
        ? 'Unable to load planning data right now — try again later.'
        : 'No online plan applying to the lot was found in the planning registry.';
      return h+`<div class="tag">${esc(msg)}</div></div>`;
    }
    plans.forEach(p=>{
      const meta=[p.number, p.subtype, p.status].filter(Boolean).map(esc).join(' · ');
      const link=p.planUrl
        ? ` <a class="edit" target="_blank" rel="noopener" href="${esc(p.planUrl)}" title="The official plan page in the plans repository">Plans repository ↗</a>`
        : '';
      h+=`<div class="row"><span><b>${esc(p.name||'Plan')}</b>`+
         (meta?`<div class="tag" style="margin-top:2px">${meta}</div>`:'')+
         `</span><span>${link}</span></div>`;
    });
    const lu=(d.landUse||[]).filter(Boolean);
    if(lu.length){
      h+=`<div class="row"><span>Land use</span><span>${lu.map(esc).join(' · ')}</span></div>`;
    }
    h+=`<div class="foot">Planning-registry data, live · the full building rights are in the link</div>`;
    return h+'</div>';
  }
  // CSS for links inside the planning card (the .edit anchor needs underline-free,
  // inherited-size styling so it reads like a quiet gold link, not a button).
  // Injected once, scoped to #wbPanel a.edit. Idempotent via a marker id.
  (function planningCardCSS(){
    if(document.getElementById('wbPlanLinkCss')) return;
    const st=document.createElement('style'); st.id='wbPlanLinkCss';
    st.textContent=`#wbPanel a.edit{text-decoration:none;font-size:11px;white-space:nowrap}
      #wbPanel a.edit:hover{text-decoration:underline}`;
    document.head.appendChild(st);
  })();
  // Kick off the planning-registry fetch ONCE per session if nothing is cached yet; when it
  // resolves, re-render only if the Renovation tab is still open on a room (so a late
  // network reply paints into the right view, and never into a closed/other tab).
  let _planKicked=false;
  function kickPlanning(){
    const P=window.Planning; if(!P||!P.load) return;
    if(P.get && P.get()) return;          // already have data (cache/in-memory)
    if(_planKicked) return; _planKicked=true;
    P.load().then(()=>{ if(TAB==='reno' && cur && panel && panel.classList.contains('on')) render(); })
            .catch(()=>{ _planKicked=false; });   // allow a retry on a hard failure
  }

  /* ---------------- CRUD (prompt-based, ported) ---------------- */
  function onBodyClick(e){
    const t=e.target.closest('[data-act]'); if(!t) return;
    const act=t.dataset.act, arg=t.dataset.arg, arg2=t.dataset.arg2, r=room(cur);
    if(act==='close'){ closeToOverview(); return; }
    if(!r) return;
    if(act==='plan'){ const src=r.floor==='ground'?'':'';
      if(window.__planView) window.__planView(src,'Plan · '+(FLOOR_HE[r.floor]||'')+' · synthetic model'); return; }
    if(act==='setField'){ const v=prompt('New value:',r[arg]||''); if(v===null) return; r[arg]=v; save(); render(); }
    else if(act==='toggleEst'){ r.est=(r.est===false); save(); render(); }
    else if(act==='addItem'){ const n=prompt('Item name:'); if(!n) return;
      const lent=arg==='inv'?(prompt('Lent to whom? (blank = not lent)')||''):''; r[arg].push(lent?{n,lent}:{n}); save(); render(); }
    else if(act==='addTask'){ const tt=prompt('Task description:'); if(!tt) return;
      const cost=parseInt(prompt('Estimated cost $ (optional):')||'0',10)||0;
      const task={t:tt,s:'plan',cost}; projMirrorAdd(r,task); r.tasks.push(task); save(); render(); }
    else if(act==='addReno'){ const rv=(_renoKB&&Array.isArray(_renoKB.renovations)?_renoKB.renovations:[]).filter(x=>x.id===arg)[0]; if(!rv) return;
      const task={t:rv.name_he+(rv.cost_he?' — '+rv.cost_he:''),s:'plan',cost:0}; projMirrorAdd(r,task); r.tasks.push(task); save(); render(); }
    else if(act==='addMat'){ const t=r.tasks[+arg]; if(!t) return;
      // add a material tagged with this project (task) → window.__materials connects it across
      // projects (Alex's ask: "I need iron rods for project X AND Y — know it's for both").
      const nm=prompt('Material name (e.g.: iron rods):'); if(!nm) return;
      const qty=parseFloat(prompt('How much?')||'0')||0; const unit=prompt('Unit (pcs / m / kg / bag…):')||'pcs';
      try{ if(window.__materials&&window.__materials.add) window.__materials.add(nm,qty,unit,t.t); }catch(e){}
      try{ alert('Added: '+nm+' to the project "'+t.t+'". See the shared procurement in Brain → 🔩 Materials.'); }catch(e){} }
    else if(act==='addNote'){ const tt=prompt('Note:'); if(!tt) return;
      r.notes.push({t:tt,d:new Date().toLocaleDateString('he-IL')}); save(); render(); }
    else if(act==='delItem'){
      if(arg==='tasks'){ const tk=r.tasks[+arg2]; if(tk) projMirrorRemove(tk); }
      r[arg].splice(+arg2,1); save(); render(); }
    else if(act==='cycleTask'){ const o={plan:'prog',prog:'done',done:'plan'};
      if(r.tasks[+arg]){ r.tasks[+arg].s=o[r.tasks[+arg].s]; projMirrorUpdate(r,r.tasks[+arg]); save(); render(); } }
    else if(act==='setBU'){ const cur0=(r.bu&&r.bu[arg]!=null)?r.bu[arg]:'';
      const v=prompt('Value (estimated · not drawn):',cur0); if(v===null) return;
      if(!r.bu||typeof r.bu!=='object') r.bu={}; r.bu[arg]=v; save(); render(); }
    else if(act==='addPart'){ const n=prompt('Part name (gutter · railing · faucet · solar water heater · AC unit…):'); if(!n) return;
      const installed=prompt('Installation year (optional):')||''; const supplier=prompt('Supplier / manufacturer (optional):')||'';
      r.parts.push({n,installed,replaced:'',warr:'',supplier}); save(); render(); }
    else if(act==='editPartDate'){ const p=r.parts[+arg]; if(!p) return;
      const replaced=prompt('Date/year of last replacement:',p.replaced||''); if(replaced===null) return; p.replaced=replaced;
      const warr=prompt('Warranty until (optional):',p.warr||''); if(warr!==null) p.warr=warr;
      save(); render(); }
  }

  /* ---- reno tasks mirror to LogStore 'projects' so alerts.js / the Brain tab
     see renovation work. add on create, update on cycle, remove on delete —
     keyed by a stored projId on the task. Soft-guarded: no LogStore → no-op
     (the task still lives in the workbench DOC, as before). ---- */
  function projStatusHe(s){ return ({plan:'Planned',prog:'In progress',done:'Done'})[s]||'Planned'; }
  function projMirrorAdd(r,task){
    if(!(window.LogStore&&window.LogStore.add)) return;
    try{ const rec=window.LogStore.add('projects',{ room:r.id, roomHe:r.name, t:task.t, title:task.t,
        cost:task.cost||0, status:projStatusHe(task.s) });
      if(rec&&rec.id) task.projId=rec.id; }catch(e){}
  }
  function projMirrorUpdate(r,task){
    if(!(window.LogStore&&window.LogStore.update)) return;
    if(!task.projId){ projMirrorAdd(r,task); return; }   // heal an un-mirrored seed task
    try{ window.LogStore.update('projects',task.projId,{ status:projStatusHe(task.s), cost:task.cost||0 }); }catch(e){}
  }
  function projMirrorRemove(task){
    if(!(window.LogStore&&window.LogStore.remove)||!task.projId) return;
    try{ window.LogStore.remove('projects',task.projId); }catch(e){}
  }
  function closeToOverview(){
    if(window.__enterMode&&window.__enterMode.floorOverview) window.__enterMode.floorOverview();
    else hide();
  }

  /* ---------------- shared plan lightbox (window.__planView) ----------------
     In this synthetic demo there are NO building plans/scans — the house is a
     parametric model. The lightbox stays as a UI hook but shows an honest
     placeholder note instead of loading any (non-existent) drawing. */
  (function planSetup(){
    const css=`
    #planLightbox{position:absolute;inset:0;z-index:40;display:none;align-items:center;justify-content:center;
      background:rgba(4,5,12,.74);backdrop-filter:blur(4px)}
    #planLightbox.on{display:flex}
    #planLightbox .pv{position:relative;max-width:92vw;max-height:88vh;border-radius:8px;overflow:hidden;
      border:1px solid rgba(202,161,90,.4);box-shadow:0 30px 80px rgba(0,0,0,.7);background:#0b0f1a}
    #planLightbox img{display:block;max-width:92vw;max-height:80vh}
    #planLightbox .pcap{padding:8px 12px;font-family:'Bellefair',serif;letter-spacing:.06em;font-size:12px;
      color:#caa15a;background:rgba(8,9,18,.92);border-top:1px solid rgba(202,161,90,.25);text-align:center}
    #planLightbox .px{position:absolute;top:8px;left:10px;cursor:pointer;color:#fff7e6;font-size:17px;line-height:1;
      background:rgba(8,9,18,.7);border:1px solid rgba(202,161,90,.4);border-radius:6px;padding:2px 9px}
    #planLightbox .px:hover{border-color:rgba(202,161,90,.7)}`;
    const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
    let lb=null,img=null,cap=null;
    function build(){ if(lb) return;
      lb=document.createElement('div'); lb.id='planLightbox'; lb.setAttribute('dir','ltr');
      lb.innerHTML=`<div class="pv"><span class="px" data-x title="Close">✕</span><img alt=""><div class="pcap"></div></div>`;
      img=lb.querySelector('img'); cap=lb.querySelector('.pcap'); document.body.appendChild(lb);
      lb.addEventListener('click',e=>{ if(e.target===lb||e.target.closest('[data-x]')) lb.classList.remove('on'); });
    }
    // Synthetic demo: there is NO real plan/scan to show. Ignore any src and
    // render an honest placeholder note instead of loading a (non-existent) image.
    window.__planView=function(src,caption){ build();
      if(img){ img.removeAttribute('src'); img.style.display='none'; }
      cap.textContent='📐 The demo includes no building plans — the structure was generated from a synthetic model, with no permit or scan.';
      lb.classList.add('on'); };
  })();

  /* ---------------- public API (wired from EnterMode) ---------------- */
  window.__workbench={
    showRoom(id){ if(!room(id)){ return; } ensure(); cur=id; panel.classList.add('on'); hideInst(); render(); },
    hide(){ if(panel) panel.classList.remove('on'); restoreInst(); cur=null; },
    isOpen(){ return !!(panel&&panel.classList.contains('on')); },
    current(){ return cur; },
    // re-render the open card on a scene-date scrub (driven from app.js's settle
    // gate). Cheap: only re-renders when the climate tab is the live one, and
    // only while a room is open — never thrashes other tabs / closed panel.
    rerenderClimate(){ try{ if(TAB==='climate' && cur && panel && panel.classList.contains('on')) render(); }catch(e){} },
    // derived warmth summary for a room (for app.js's floor-overview heat-map). Null for
    // non-workbench spaces (stairs/pantry/terrace). frac 0=coolest…1=hottest among rooms.
    climateSummary(id,date){
      const r=room(id), g=geomOf(id); if(!r||!g) return null;
      const when=(date instanceof Date && !isNaN(date))?date:sceneDate();
      const D=window.Derive, base=(D&&D.indoorTemp)?D.indoorTemp(when):null;
      const scores=Object.keys(DOC.rooms).map(x=>({id:x,g:geomOf(x)})).filter(x=>x.g).map(x=>({id:x.id,s:warmthScore(x.g)}));
      const mean=scores.length?scores.reduce((a,x)=>a+x.s,0)/scores.length:0;
      const sorted=scores.slice().sort((a,b)=>b.s-a.s), n=sorted.length;
      const my=warmthScore(g), rank=sorted.findIndex(x=>x.id===id);
      const frac=(n>1&&sorted[0].s!==sorted[n-1].s)?(my-sorted[n-1].s)/(sorted[0].s-sorted[n-1].s):0.5;
      const tier=rank<0?'':(rank<n/3?'Warm':(rank>=Math.ceil(2*n/3)?'Cool':'Mid'));
      return { tempC: base?Math.round((base.tempC+(my-mean)*0.45)*10)/10:null, frac, tier, score:my, floor:g.floor };
    },
    _doc(){ return DOC; },
  };
})();
