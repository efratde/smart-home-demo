/* ===================================================================
   workbench.js — the IN-WORLD room workbench (Make pillar, גישה א׳).
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
      // overview shows משוער on structure/circuit/water until the user explicitly verifies.
      comps:[], inv:[], tasks:[], notes:[], parts:[], bu:{}, circuit:'', water:'', structure:'' }, extra||{});
  }
  // SEED — areas/structure/wet-zones/openings/ceilings for a synthetic demo model
  // (floor plans + sections). circuit:'' on purpose — the permit set has NO electrical
  // drawing, so circuits/sockets are UNKNOWN (the old C1–C5 were fabricated). bu = the
  // build-up panel (ceiling height + source). GF ceiling 2.80, upper 2.50 (from sections).
  function SEED(){ return {
    // ---- GROUND FLOOR (ceiling 2.80 m) ----
    bathG:  R('bathG','חדר רחצה','ground','bath',4.0,
      { water:'מקלחת · כיור · אסלה · ניקוז', circuit:'', structure:'אזור רטוב — קירות בטון',
        bu:{ceiling:'2.80 מ׳', source:'מודל סינתטי'},
        notes:[{t:'אזור רטוב: צנרת + ניקוז כאן — יקר להזיז בשיפוץ',d:'מהתוכנית'}],
        tasks:[{t:'ריצוף + אינסטלציה',s:'prog',cost:9500}],
        comps:[{n:'ברז',d:'2019'},{n:'דוד שמש',d:'2018'}],
        parts:[{n:'ברז',installed:'2019',replaced:'',warr:'',supplier:''},
               {n:'דוד שמש',installed:'2018',replaced:'',warr:'',supplier:''}] }),
    stairsG:R('stairsG','מדרגות','ground','stairs',4.0,
      { circuit:'', structure:'גרם מדרגות בטון יצוק', bu:{ceiling:'2.80 מ׳', source:'מודל סינתטי'} }),
    kitchen:R('kitchen','מטבח','ground','kitchen',10.9,
      { circuit:'', water:'כיור · מדיח (אזור רטוב)', structure:'חגורת בטון',
        bu:{ceiling:'2.80 מ׳', source:'מודל סינתטי'},
        notes:[{t:'חלון מזרח 80/120 (פתוח, ליד המזגן); דלת פנים 90/205 מהכניסה',d:'מהתוכנית'}],
        tasks:[{t:'החלפת ארונות',s:'prog',cost:12000}],
        comps:[{n:'תנור',d:'2021'},{n:'מדיח',d:'2020'}], inv:[{n:'מקרר'},{n:'מיקרוגל'}],
        parts:[{n:'תנור',installed:'2021',replaced:'',warr:'',supplier:''},
               {n:'מדיח',installed:'2020',replaced:'',warr:'',supplier:''}] }),
    living: R('living','סלון','ground','living',22.0,
      { circuit:'', structure:'חגורת בטון + עמוד (מפתח ~6.8 מ׳)',
        bu:{ceiling:'2.80 מ׳', source:'מודל סינתטי'},
        notes:[{t:'דלת הזזה גדולה לחצר האחורית (מזרח); חלון מזרח/דרום נאטם (סגירת פתח חלון)',d:'מהתוכנית'}],
        inv:[{n:'ספה'},{n:'טלוויזיה'},{n:'מזגן',lent:'רני'}], tasks:[{t:'תכנון שיפוץ',s:'plan',cost:0}] }),
    bedroomG:R('bedroomG','חדר שינה','ground','bedroom',9.7,
      { circuit:'', structure:'חגורת בטון', bu:{ceiling:'2.80 מ׳', source:'מודל סינתטי'},
        notes:[{t:'חלון 100/130 לחצר האחורית (מזרח)',d:'מהתוכנית'}],
        inv:[{n:'מיטה'},{n:'ארון'}], tasks:[{t:'שופץ',s:'done',cost:18000}] }),
    pantry: R('pantry','מזווה','ground','storage',5.4,
      { circuit:'', structure:'קירות בלוק', bu:{ceiling:'2.80 מ׳', source:'מודל סינתטי'},
        notes:[{t:'חלונות מערב + צפון, סף גבוה (uk=180)',d:'מהתוכנית'}],
        inv:[{n:'מדפים'}], tasks:[{t:'דלת + אוורור',s:'prog',cost:3200}] }),
    // ---- FIRST FLOOR (ceiling ~2.50 m) ----
    bedroomSW:R('bedroomSW','חדר שינה (דרום)','upper','bedroom',9.7,
      { circuit:'', structure:'חגורת בטון', bu:{ceiling:'2.50 מ׳', source:'מודל סינתטי'},
        notes:[{t:'חלון 100/130 בקיר הדרומי',d:'מהתוכנית'}], inv:[{n:'מיטה זוגית'}] }),
    bedroomNE:R('bedroomNE','חדר שינה (צפון)','upper','room',9.5,
      { circuit:'', structure:'חגורת בטון', bu:{ceiling:'2.50 מ׳', source:'מודל סינתטי'},
        notes:[{t:'חלון בקיר המזרחי',d:'מהתוכנית'}] }),
    terrace:R('terrace','מרפסת','upper','roof',25.7,
      { water:'ניקוז גג', circuit:'', structure:'מרצפת בטון + מעקה',
        bu:{ceiling:'פתוח (חוץ)', source:'מודל סינתטי'},
        notes:[{t:'מרפסת ריצוף מעל החצר האחורית; פתח 148/205; פוטנציאל סולארי',d:'מהתוכנית'}],
        inv:[{n:'דוד שמש'},{n:'פאנל סולארי'}], tasks:[{t:'פוטנציאל סולארי',s:'plan',cost:0}] }),
    bathU:  R('bathU','חדר רחצה','upper','bath',5.0,
      { water:'אמבטיה 160 · כיור · אסלה', circuit:'', structure:'אזור רטוב — קירות בטון',
        bu:{ceiling:'2.50 מ׳', source:'מודל סינתטי'},
        notes:[{t:'אמבטיה 160 ס״מ; אזור רטוב',d:'מהתוכנית'}] }),
    landing:R('landing','גרם המדרגות','upper','stairs',5.0,
      { circuit:'', structure:'פיר מדרגות 187 + מבואה', bu:{ceiling:'2.50 מ׳', source:'מודל סינתטי'},
        notes:[{t:'מבואה בראש המדרגות; רצועת מ.שירות עם מדפים במערב',d:'מהתוכנית'}] }),
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
  const FLOOR_HE={ground:'קומת קרקע',upper:'קומה עליונה'};
  const FLOOR_SH={ground:'קרקע',upper:'עליונה'};
  const TABS=[['overview','סקירה'],['climate','אקלים'],['structure','מבנה'],['inv','מלאי'],['mep','חשמל·מים'],['reno','שיפוץ'],['parts','רכיבים·החלפות'],['notes','הערות']];

  /* ---- derived ROOM CLIMATE (parallels the garden's microclimate). Aspect/sun/floor are
     GEOMETRY, from the plan-frame room rect via __enterMode.roomGeom (PLAN→WORLD: -z=West/
     plaza, +z=East/back-yard, -x=South, +x=North). Temperature = the engine's whole-house
     Derive.indoorTemp + a TRANSPARENT per-room exposure lean (afternoon-west & upper run
     hottest; north & ground coolest, ≈34.0°N). Labelled a model. ---- */
  const ASPECT_HE={W:'מַעֲרָב',E:'מִזְרָח',N:'צָפוֹן',S:'דָּרוֹם'};
  const ASPECT_SUN={W:'שֶׁמֶשׁ אַחַר־הַצָּהֳרַיִם',E:'שֶׁמֶשׁ בֹּקֶר',S:'שֶׁמֶשׁ צָהֳרַיִם',N:'מְעַט שֶׁמֶשׁ יְשִׁירָה'};
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
  const RISK_HE={high:'גָּבוֹהַּ',med:'בֵּינוֹנִי',low:'נָמוּךְ'};
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
    if(wet) bits.push({icon:'🚰',he:'אֵזוֹר רָטוֹב — צֶנֶּרֶת וְנִקּוּז כָּאן. הֲזָזַת אִינְסְטָלַצְיָה הִיא מֵהַיָּקָר בְּשִׁפּוּץ; שְׁמִירַת מִקּוּם הָרָטוֹב חוֹסֶכֶת.'});
    if(ext.length) bits.push({icon:'🧱',he:`${ext.length} קִירוֹת חוּץ (${ext.map(d=>ASPECT_HE[d]).join(' · ')}) — בִּדּוּד, חַלּוֹנוֹת וַאֲטִימוּת מַשְׁפִּיעִים עַל נוֹחוּת וְאֶנֶרְגְּיָה. קִירוֹת פְּנִים זוֹלִים בְּהַרְבֵּה לַהֲזָזָה.`});
    else bits.push({icon:'🧱',he:'חֶדֶר פְּנִימִי — אֵין מַעֲטֶפֶת חוּץ; קִירוֹת הַפְּנִים גְּמִישִׁים וְזוֹלִים לְשִׁנּוּי.'});
    if(r.structure && /בטון|חגור|עמוד|נושא/.test(r.structure)) bits.push({icon:'🏗️',he:'יֵשׁ אֵלֵמֶנְט מִבְנִי (בֵּטוֹן/חֲגוֹרָה/עַמּוּד) — נוֹשֵׂא מִשְׁקָל; אֵין לְהָסִיר לְלֹא יוֹעֵץ קוֹנְסְטְרוּקְצְיָה.'});
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
     MEASURED (Open-Meteo, מבוסס מדידות אמת) is the OUTDOOR weather the whole
     house actually sat in: real days recorded, absolute outdoor min/max, frost
     nights, rain. The INTERIOR figures stay MODELED (מוֹדֵל) — the room's damped
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
      return `<div class="card"><div class="cct">🗒️ הַהִיסְטוֹרְיָה שֶׁל הַחֶדֶר <span class="pill amber">מוֹדֵל · הַעֲרָכָה</span></div>`+
        `<div class="note">${bld?'הַיּוֹמָן הַחַי נִבְנֶה כָּעֵת מִמְּדִידוֹת אֲמִתִּיּוֹת (Open-Meteo)… הַנְּתוּנִים הַמְּצֻבָּרִים יוֹפִיעוּ כָּאן.':'עֲדַיִן אֵין מְדִידוֹת מְצֻבָּרוֹת. הַמֻּצָּג לְמַעְלָה הוּא מוֹדֵל אַקְלִים מְקוֹמִי (הַעֲרָכָה), לֹא חַיְשָׁן.'}</div></div>`;
    }
    // GENUINE per-room living record (preferred): the room's MODELED indoor curve
    // accumulated day-by-day from the MEASURED outdoor air. Honest: the inputs are
    // real measurements (Open-Meteo) but the indoor figures are computed, never a
    // sensor — the pill credits the measurements, the note states the modeling.
    if(rm){
      const span=spanHe(rm.firstDate,rm.lastDate);
      let h=`<div class="card"><div class="cct">🗒️ מַה הַחֶדֶר עָבַר <span class="pill green">מְבֻסָּס מְדִידוֹת אֲמֶת</span></div>`+
        `<div class="row"><span>יָמִים בַּיּוֹמָן</span><b>${rm.days}${span?` · ${span}`:''}</b></div>`;
      if(rm.tMinAbs!=null&&rm.tMaxAbs!=null)
        h+=`<div class="row"><span>טְוַח הַחֶדֶר <span class="pill amber">מוֹדֵל</span></span><b>~${rm.tMinAbs}° … ~${rm.tMaxAbs}°</b></div>`;
      if(rm.tMeanAvg!=null)
        h+=`<div class="row"><span>מְמֻצָּע הַחֶדֶר</span><b>~${rm.tMeanAvg}°</b></div>`;
      if(rm.hoursBelow18)
        h+=`<div class="row"><span>שָׁעוֹת קְרִירוֹת (&lt;18°)</span><b>${Math.round(rm.hoursBelow18)}</b></div>`;
      if(rm.hoursAbove28)
        h+=`<div class="row"><span>שָׁעוֹת חַמּוֹת (&gt;28°)</span><b>${Math.round(rm.hoursAbove28)}</b></div>`;
      if(rm.comfortHours)
        h+=`<div class="row"><span>שָׁעוֹת נוֹחוּת (18–26°)</span><b>${Math.round(rm.comfortHours)}</b></div>`;
      if(rm.condensationRiskDays)
        h+=`<div class="row"><span>יְמֵי סִכּוּן עִבּוּי</span><b>${rm.condensationRiskDays}</b></div>`;
      h+=`<div class="note">מֶזֶג־הָאֲוִיר בַּחוּץ מָדוּד (Open-Meteo) לְמִקּוּם הַבַּיִת; טֶמְפֵּרָטוּרַת הַחֶדֶר מְחֻשֶּׁבֶת מִמֶּנּוּ דֶּרֶךְ גֵּאוֹמֶטְרְיַת הַבַּיִת — לֹא חַיְשָׁן פִיזִי.</div></div>`;
      return h;
    }
    // measured OUTDOOR envelope the house sat in + the room's MODELED interior.
    const span=spanHe(ho.firstDate,ho.lastDate);
    const interior=modelRoomFromOutdoor(ho.tMinAbs,ho.tMaxAbs,myScore,mean);
    let h=`<div class="card"><div class="cct">🗒️ מַה הַחֶדֶר עָבַר <span class="pill green">מְבֻסָּס מְדִידוֹת אֲמֶת</span></div>`+
      `<div class="row"><span>יָמִים מְצֻבָּרִים</span><b>${ho.days}${span?` · ${span}`:''}</b></div>`;
    if(ho.tMinAbs!=null&&ho.tMaxAbs!=null)
      h+=`<div class="row"><span>טְוַח בַּחוּץ (מָדוּד)</span><b>~${ho.tMinAbs}° … ~${ho.tMaxAbs}°</b></div>`;
    if(ho.frostNights!=null)
      h+=`<div class="row"><span>לֵילוֹת כְּפוֹר</span><b>${ho.frostNights}</b></div>`;
    if(ho.rainSum!=null)
      h+=`<div class="row"><span>גֶּשֶׁם מְצֻבָּר</span><b>${ho.rainSum} מ״מ</b></div>`;
    if(interior)
      h+=`<div class="row"><span>טְוַח הַחֶדֶר <span class="pill amber">מוֹדֵל</span></span><b>~${interior.min}° … ~${interior.max}°</b></div>`;
    if(ho.building)
      h+=`<div class="tag" style="margin-top:6px">⏳ הַיּוֹמָן עוֹד נִבְנֶה ברקע${ho.pct?` (${ho.pct}%)`:''}</div>`;
    h+=`<div class="note">מֶזֶג־הָאֲוִיר בַּחוּץ — מָדוּד (Open-Meteo) לְמִקּוּם הַבַּיִת. טְוַח הַחֶדֶר — מוֹדֵל: הַתְּגוּבָה הַמְּמֻסֶּכֶת שֶׁל הַמָּסָה הַפְּנִימִית לַמְּדִידוֹת, לֹא חַיְשָׁן.</div></div>`;
    return h;
  }

  function ensure(){
    if(panel) return;
    document.head.appendChild(el('style',null,CSS));
    panel=el('div'); panel.id='wbPanel'; panel.setAttribute('dir','rtl');
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
  //      permit + duration, surfaced in the שיפוץ tab. Honest ESTIMATES (ranges, not quotes). ----
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
        `<span class="edit" data-act="addReno" data-arg="${esc(rv.id)}" title="הוֹסֵף לַתָּכְנִית">＋</span></div>`+
        `<div class="rim">${esc(rv.cost_he||'')}</div>`+
        `<div class="rip">${esc([rv.permit_he,rv.duration_he].filter(Boolean).join(' · '))}</div></div>`).join('');
    return `<div class="card"><div class="cct">💡 רַעְיוֹנוֹת שִׁפּוּץ לַחֶדֶר <span class="pill blue">הַעֲרָכָה</span></div>${rows}`+
      `<div class="note">עֲלֻיּוֹת הֵן טְוָחִים מַעֲרִיכִים (לֹא הַצָּעַת מְחִיר) · לְחַץ ＋ לְהוֹסִיף כִּמְשִׂימָה.</div></div>`;
  }

  function render(){
    const r=room(cur); if(!r){ return; }
    tabsEl.innerHTML=TABS.map(([k,l])=>`<div class="tab${k===TAB?' on':''}" data-t="${k}">${l}</div>`).join('');
    // Structure/circuit/water are NOT in the byte-identical scanned drawings — show
    // 'משוער' by DEFAULT; only an explicit user "verify" (r.est===false) clears it.
    const est=(r.est===false)?'':' <span class="pill amber">משוער</span>';
    let html='';
    if(TAB==='overview'){
      const open=(r.tasks||[]).filter(t=>t.s!=='done').length;
      html=`<div class="row"><span>קומה</span><span>${FLOOR_SH[r.floor]||''}</span></div>`+
        `<div class="row"><span>שטח</span><b>${r.area} מ״ר</b></div>`+
        `<div class="row"><span>▦ מבנה</span><span>${esc(r.structure||'—')}${r.structure?est:''}</span></div>`+
        `<div class="row"><span>🔧 רכיבים</span><b>${(r.comps||[]).length}</b></div>`+
        `<div class="row"><span>📦 מלאי</span><b>${(r.inv||[]).length}</b></div>`+
        `<div class="row"><span>⚡ חשמל</span><span>${esc(r.circuit||'—')}${r.circuit?est:''}</span></div>`+
        `<div class="row"><span>🚰 מים</span><span>${esc(r.water||'—')}${r.water?est:''}</span></div>`+
        `<div class="row"><span>✅ משימות פתוחות</span><b>${open}</b></div>`;
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
      const tier=rank<0?'':(rank<n/3?'מֵהַחַמִּים בַּבַּיִת':(rank>=Math.ceil(2*n/3)?'מֵהַקְּרִירִים':'חֲדַר־בֵּינַיִם'));
      const offset=Math.round((myScore-mean)*0.45*10)/10;
      const roomTemp=base?Math.round((base.tempC+offset)*10)/10:null;
      // night-cooling uses the LIVE outdoor air — honest only when the scene is
      // parked at today. When scrubbed to another day we have no measured outdoor
      // AIR for that hour, so we suppress the card rather than show today's reading.
      const W=window.Weather, out=(today&&W&&W.state&&W.state.temp!=null)?W.state.temp:null;
      const canCool=(out!=null&&base&&out<base.tempC-1&&ext.length>0);
      const frac=(n>1&&sorted[0].s!==sorted[n-1].s)?(myScore-sorted[n-1].s)/(sorted[0].s-sorted[n-1].s):0.5;
      let h=`<div class="card"><div class="cct">כִּוּוּן וְשֶׁמֶשׁ <span class="pill green">תָּכְנִית</span></div>`;
      if(ext.length){
        h+=`<div class="row"><span>חֲזִיתוֹת חוּץ</span><span>${ext.map(d=>ASPECT_HE[d]).join(' · ')}</span></div>`+
           `<div class="row"><span>שֶׁמֶשׁ</span><span>${[...new Set(ext.map(d=>ASPECT_SUN[d]))].join(' · ')}</span></div>`;
      } else h+=`<div class="tag">חֶדֶר פְּנִימִי — אֵין קִיר חִיצוֹנִי יָשִׁיר; יַצִּיב טֶרְמִית.</div>`;
      h+=`<div class="row"><span>קוֹמָה</span><span>${FLOOR_HE[r.floor]||''}${r.floor==='upper'?' · קָרוֹב לַגַּג':''}</span></div></div>`;
      if(roomTemp!=null){
        h+=`<div class="card"><div class="cct">טֶמְפֵּרָטוּרָה ${today?'עַכְשָׁו':'בַּתַּאֲרִיךְ'} <span class="pill amber">מוֹדֵל</span></div>`+
          `<div class="row"><span>הַחֶדֶר (מוֹעֲרָךְ)</span><b>~${roomTemp}°C</b></div>`+
          `<div class="row"><span>בָּסִיס הַבַּיִת</span><span>~${base.tempC}°C${offset?` · חֶדֶר ${offset>0?'+':''}${offset}°`:''}</span></div>`+
          `<div class="bar"><i style="width:${Math.round(frac*100)}%;background:linear-gradient(90deg,#6f9fd0,#caa15a,#d98a5a)"></i></div>`+
          `<div class="row"><span>נְטִיָּה</span><span>${tier}</span></div>`+
          `<div class="note">${esc(base.note_he||'')}</div></div>`;
      }
      if(canCool) h+=`<div class="card"><div class="cct">🌙 קֵרוּר לַיְלָה</div>`+
        `<div class="row"><span>בַּחוּץ ~${Math.round(out)}° · בִּפְנִים ~${base.tempC}°</span></div>`+
        `<div class="note">אֲוִיר הַחוּץ כְּבָר קַר מֵהַמָּסָה הַפְּנִימִית — פְּתִיחַת חַלּוֹנוֹת תְּקָרֵר חִנָּם בִּמְקוֹם מִיזוּג.</div></div>`;
      const cd=condensationRisk(g);
      if(cd&&cd.wall){ const rp=cd.risk==='low'?'green':'amber';
        h+=`<div class="card"><div class="cct">💧 עִבּוּי בַּחֹרֶף <span class="pill amber">מוֹדֵל</span></div>`+
          `<div class="row"><span>קִיר ${ASPECT_HE[cd.wall]} (הַקַּר בְּיוֹתֵר)</span><span>~${cd.surf}°</span></div>`+
          `<div class="row"><span>נְקֻדַּת טַל (פְּנִים)</span><span>~${cd.dew}°</span></div>`+
          `<div class="row"><span>סִכּוּן</span><span class="pill ${rp}">${RISK_HE[cd.risk]}</span></div>`+
          `<div class="note">בְּלֵיל חֹרֶף קַר (בַּחוּץ ~1°, בַּיִת מְחֻמָּם ~20° · לַחוּת ~55%). ${cd.risk!=='low'?'אֲוְרוּר קָצָר בַּיּוֹם וּמְנִיעַת לַחוּת (בִּשּׁוּל/מִקְלַחַת) מַפְחִיתִים עִבּוּי וְעֹבֶשׁ עַל הַקִּיר.':'הַקִּיר נִשְׁאָר מֵעַל נְקֻדַּת הַטַּל — סִכּוּן נָמוּךְ.'}</div></div>`;
      }
      // ---- ACTUAL HISTORY (Living Record) — real measured outdoor envelope the
      // house sat in + the room's MODELED response. Honest fallback when empty. ----
      h+=historyCardHTML(r,g,myScore,mean);
      html=h+`<div class="note">כִּוּוּן וְקוֹמָה — מֵהַתָּכְנִית (מודל סינתטי). טֶמְפֵּרָטוּרָה וְעִבּוּי — מוֹדֵל אַקְלִים מְקוֹמִי, הַעֲרָכָה.</div>`;
    } else if(TAB==='structure'){
      html=structureHTML(r)+
        `<div class="row" style="margin-top:8px"><span>תיאור חופשי</span><span>${esc(r.structure||'—')}${r.structure?est:''}</span></div>`+
        `<div class="add" data-act="plan">📄 על מקור המודל (דמו)</div>`+
        `<div class="add" data-act="setField" data-arg="structure">✎ ערוך תיאור מבנה</div>`+
        `<div class="add" data-act="toggleEst">${r.est!==false?'✓ סמן את התיאור כמאומת':'⚑ סמן את התיאור כמשוער'}</div>`;
    } else if(TAB==='inv'){
      html=listHTML(r.comps,'comps','🔧 אין רכיבים','רכיבים קבועים')+
        `<div class="add" data-act="addItem" data-arg="comps">＋ הוסף רכיב</div>`+
        `<div style="height:6px"></div>`+
        listHTML(r.inv,'inv','📦 אין פריטים','מלאי / ריהוט')+
        `<div class="add" data-act="addItem" data-arg="inv">＋ הוסף פריט מלאי</div>`;
    } else if(TAB==='mep'){
      html=`<div class="row"><span>⚡ מעגל חשמל</span><span><span>${esc(r.circuit||'לא ידוע')}</span> <span class="edit" data-act="setField" data-arg="circuit">✎</span></span></div>`+
        `<div class="row"><span>🚰 מים</span><span><span>${esc(r.water||'—')}</span> <span class="edit" data-act="setField" data-arg="water">✎</span></span></div>`+
        `<div class="note">⚡ <b>אין תוכנית חשמל במודל</b> — מעגלים/שקעים אינם בשרטוטים. (הנתון הקודם C1–C5 היה זמני ולא אמיתי; נמחק.) מלא ידנית את מה שידוע לדייר.<br>🚰 אזורים רטובים — מהתוכנית.</div>`;
    } else if(TAB==='reno'){
      const tot=(r.tasks||[]).reduce((a,t)=>a+(t.cost||0),0);
      const rows=(r.tasks||[]).map((t,i)=>`<div class="it"><span><span class="pill ${t.s==='done'?'green':t.s==='prog'?'amber':'blue'}">${t.s==='done'?'בוצע':t.s==='prog'?'בתהליך':'מתוכנן'}</span> ${esc(t.t)}</span>`+
        `<span>${t.cost?'$'+t.cost.toLocaleString():''} <span class="edit" data-act="addMat" data-arg="${i}" title="הוֹסֵף חֹמֶר לַפְּרוֹיֶקְט (→ רֶכֶשׁ מְשֻׁתָּף)">🔩</span> <span class="edit" data-act="cycleTask" data-arg="${i}">↻</span> <span class="edit" data-act="delItem" data-arg="tasks" data-arg2="${i}">✕</span></span></div>`).join('')||'<div class="tag">אין משימות</div>';
      // PLOT-LEVEL planning card at the TOP — identical for every room (the planning
      // governs the whole מגרש, not a single room). Kicks off Planning.load() once.
      // When the RICH card module (window.__planning) is loaded we mount its full
      // 'מה מותר במגרש' content (תוספת בנייה / חדר מָגֵן / קומה / חצר / פטור / קישורים)
      // into a host placeholder AFTER body.innerHTML is set — see render()'s tail.
      // Otherwise we fall back to the simpler inline planningCardHTML() (load-order safe).
      const cons=renoConsiderations(r,geomOf(r.id));
      const consHTML=cons.length?`<div class="card"><div class="cct">שִׁקּוּלֵי שִׁפּוּץ <span class="pill green">נִגְזָר</span></div>`+
        cons.map(c=>`<div class="cons"><span class="ci">${c.icon}</span><span>${c.he}</span></div>`).join('')+`</div>`:'';
      const richPlan=!!(window.__planning&&window.__planning.render);
      const planHTML=richPlan?`<div id="wbRichPlan"></div>`:planningCardHTML();
      html=planHTML+consHTML+renoIdeasHTML(r)+rows+`<div class="row" style="margin-top:6px"><span>סה״כ מְשֹׁעָר</span><b>$${tot.toLocaleString()}</b></div>`+
        `<div class="add" data-act="addTask">＋ הוסף משימה</div>`;
      if(!richPlan) kickPlanning();
    } else if(TAB==='parts'){
      html=partsHTML(r)+
        `<div class="add" data-act="addPart">＋ הוסף רכיב / החלפה</div>`+
        `<div class="note">יומן רכיבים והחלפות — מתי הותקן, מתי הוחלף, אחריות וספק. הזיכרון התחזוקתי של הבית.</div>`;
    } else if(TAB==='notes'){
      html=listHTML(r.notes,'notes','📝 אין הערות',null)+`<div class="add" data-act="addNote">＋ הוסף הערה</div>`;
    }
    body.innerHTML=`<div class="hd"><h3>${esc(r.name)}</h3><span class="x" data-act="close" title="סגור">✕</span></div>`+
      `<div class="sub"><span class="floor">${FLOOR_HE[r.floor]||''}</span> · ${r.area} מ״ר · ${typeHe(r.type)}</div>`+
      html+
      `<div class="foot">נשמר אוטומטית · אותה שפה כמו חצר · שמיים · אנרגיה</div>`;
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
  function typeHe(t){ return ({bath:'רחצה',kitchen:'מטבח',living:'מגורים',bedroom:'שינה',room:'חדר',storage:'אחסון',stairs:'מעבר',roof:'גג / חוץ'})[t]||''; }

  /* ---- structure (מבנה) build-up rows from HouseBuildup (gotcha #2):
     verified facts (wall/slab/roof/levels/areas, all proven in building.js)
     render plain; anything not in the drawings (belt/columns/circuit/floor
     finish / wall layers) gets a «משוער» pill + a 'לא משורטט' note and stays
     blank-and-editable. Falls back to a single honest note if the loader
     isn't present. ---- */
  function estPill(){ return ' <span class="pill amber">משוער</span>'; }
  function buRow(label,val,verified,note){
    const v=(val==null||val==='')?'—':esc(val);
    return `<div class="row"><span>${esc(label)}</span><span><b>${v}</b>${verified?'':estPill()}</span></div>`+
      (note?`<div class="note">${esc(note)}</div>`:'');
  }
  function structureHTML(r){
    if(!(window.HouseBuildup&&HouseBuildup.get)){
      return `<div class="note">נתוני מבנה הם הערכת מודל סינתטי — לא נמדד בשטח.</div>`;
    }
    const b=HouseBuildup.get(cur, r.floor), A=b.assemblies||{}, L=b.levels||{}, rm=b.room||{};
    let h='<div class="tag" style="margin:2px 0 4px">בנייה מאומתת · מהמודל</div>';
    // walls present in this room
    (b.walls||[]).forEach(w=>{
      const t=(w.thickness_m!=null)?(Math.round(w.thickness_m*100)+' ס״מ'):'';
      h+=buRow(w.label||'קיר', t+(w.finish_he?(' · '+w.finish_he):''), w.verified, '');
      if(w.layers && w.layers_verified===false){
        h+=buRow('הרכב שכבות קיר', (w.layers.map(x=>x.n).filter(Boolean).join(' · ')||''), false, w.note_he||'');
      }
    });
    if(A.slab)     h+=buRow(A.slab.label||'רצפת בטון', Math.round(A.slab.thickness_m*100)+' ס״מ', A.slab.verified, '');
    if(r.floor==='upper' && A.roofSlab) h+=buRow(A.roofSlab.label||'תקרת גג', Math.round(A.roofSlab.thickness_m*100)+' ס״מ', A.roofSlab.verified, '');
    // levels (verified)
    if(L.verified){
      const lev=r.floor==='upper'
        ? `${L.firstFloor_m.toFixed(2)} → גג ${L.roofSlab_m.toFixed(2)}`
        : `${L.ground_m.toFixed(2)} → תקרה ${L.firstFloor_m.toFixed(2)}`;
      h+=buRow('מפלסים (מ׳)', lev, true, '');
    }
    // unverified deep rows — blank + editable + משוער/לא משורטט
    h+='<div class="tag" style="margin:9px 0 4px">לא משורטט · ניתן לעריכה</div>';
    h+=buRowEditable('גמר רצפה', rm.floorFinish, 'floorFinish');
    h+=buRowEditable('חגורת בטון', rm.concreteBelt, 'concreteBelt');
    h+=buRowEditable('עמודים', rm.columns, 'columns');
    return h;
  }
  /* ---- parts/replacements log (רכיבים·החלפות): reuses .it/.pill/.tag/.edit,
     no new CSS. Each part {n, installed, replaced, warr, supplier}. ---- */
  function partsHTML(r){
    const arr=r.parts||[];
    if(!arr.length) return `<div class="tag">🔧 אין רכיבים רשומים</div>`;
    return arr.map((p,i)=>{
      const sub=[];
      if(p.installed) sub.push('הותקן '+esc(p.installed));
      if(p.replaced)  sub.push('הוחלף '+esc(p.replaced));
      if(p.warr)      sub.push('אחריות '+esc(p.warr));
      if(p.supplier)  sub.push('ספק '+esc(p.supplier));
      const replPill=p.replaced?` <span class="pill green">הוחלף</span>`:'';
      return `<div class="it"><span><b>${esc(p.n||'רכיב')}</b>${replPill}`+
        (sub.length?`<div class="tag" style="margin-top:2px">${sub.join(' · ')}</div>`:'')+
        `</span><span><span class="edit" data-act="editPartDate" data-arg="${i}" title="עדכן החלפה / פרטים">✎</span> `+
        `<span class="edit" data-act="delItem" data-arg="parts" data-arg2="${i}">✕</span></span></div>`;
    }).join('');
  }
  // an editable unverified build-up row: value is the user-saved override
  // (r.bu[field]) when present, else the JSON blank; shows משוער + a ✎.
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
      `${x.lent?` <span class="pill blue">מושאל ל${esc(x.lent)}</span>`:''}`+
      `${x.d?` <span class="tag">· ${esc(x.d)}</span>`:''}</span>`+
      `<span class="edit" data-act="delItem" data-arg="${key}" data-arg2="${i}">✕</span></div>`).join('');
  }

  /* ---- PLOT-LEVEL planning card ('📋 מה מותר במגרש · תכנון'): lists the
     official planning-registry plans that GOVERN the lot, each with a link to
     its planUrl page where the real building-rights text lives. PLOT-level → the
     same card regardless of which room is open. Reuses .card/.cct/.row/.tag/.pill
     /.note — no new CSS. States: loading (no data yet), error (couldn't load /
     no plans), and the list. HONEST: we never print height/coverage numbers here
     — only which plans apply + a link to the official document. ---- */
  function planningCardHTML(){
    const P=window.Planning, d=P&&P.get&&P.get();
    let h=`<div class="card"><div class="cct">📋 מה מותר במגרש · תכנון <span class="pill green">מִרְשָׁם · חי</span></div>`;
    if(!d){
      // not loaded yet — show a loading line; kickPlanning() will fetch + re-render.
      return h+`<div class="tag">טוען נתוני תכנון מרשות התכנון…</div></div>`;
    }
    const plans=d.plans||[];
    if(!plans.length){
      // error or genuinely no governing plan returned — honest, non-fabricated state.
      const msg=d.error&&d.error!=='no-results'
        ? 'לא ניתן לטעון נתוני תכנון כעת — נסה שוב מאוחר יותר.'
        : 'לא נמצאה תכנית מקוונת החלה על המגרש בַּמִּרְשָׁם הַתִּכְנוּנִי.';
      return h+`<div class="tag">${esc(msg)}</div></div>`;
    }
    plans.forEach(p=>{
      const meta=[p.number, p.subtype, p.status].filter(Boolean).map(esc).join(' · ');
      const link=p.planUrl
        ? ` <a class="edit" target="_blank" rel="noopener" href="${esc(p.planUrl)}" title="עמוד התכנית הרשמי במאגר התכניות">מאגר התכניות ↗</a>`
        : '';
      h+=`<div class="row"><span><b>${esc(p.name||'תכנית')}</b>`+
         (meta?`<div class="tag" style="margin-top:2px">${meta}</div>`:'')+
         `</span><span>${link}</span></div>`;
    });
    const lu=(d.landUse||[]).filter(Boolean);
    if(lu.length){
      h+=`<div class="row"><span>ייעוד קרקע</span><span>${lu.map(esc).join(' · ')}</span></div>`;
    }
    h+=`<div class="foot">נתוני מרשם התכנון, חי · זכויות הבנייה המלאות בקישור</div>`;
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
  // resolves, re-render only if the שיפוץ tab is still open on a room (so a late
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
      if(window.__planView) window.__planView(src,'תוכנית '+(FLOOR_HE[r.floor]||'')+' · מודל סינתטי'); return; }
    if(act==='setField'){ const v=prompt('ערך חדש:',r[arg]||''); if(v===null) return; r[arg]=v; save(); render(); }
    else if(act==='toggleEst'){ r.est=(r.est===false); save(); render(); }
    else if(act==='addItem'){ const n=prompt('שם הפריט:'); if(!n) return;
      const lent=arg==='inv'?(prompt('מושאל למי? (ריק = לא מושאל)')||''):''; r[arg].push(lent?{n,lent}:{n}); save(); render(); }
    else if(act==='addTask'){ const tt=prompt('תיאור המשימה:'); if(!tt) return;
      const cost=parseInt(prompt('עלות משוערת $ (אופציונלי):')||'0',10)||0;
      const task={t:tt,s:'plan',cost}; projMirrorAdd(r,task); r.tasks.push(task); save(); render(); }
    else if(act==='addReno'){ const rv=(_renoKB&&Array.isArray(_renoKB.renovations)?_renoKB.renovations:[]).filter(x=>x.id===arg)[0]; if(!rv) return;
      const task={t:rv.name_he+(rv.cost_he?' — '+rv.cost_he:''),s:'plan',cost:0}; projMirrorAdd(r,task); r.tasks.push(task); save(); render(); }
    else if(act==='addMat'){ const t=r.tasks[+arg]; if(!t) return;
      // add a material tagged with this project (task) → window.__materials connects it across
      // projects (Alex's ask: "I need iron rods for project X AND Y — know it's for both").
      const nm=prompt('שֵׁם הַחֹמֶר (לְמָשָׁל: מוֹטוֹת בַּרְזֶל):'); if(!nm) return;
      const qty=parseFloat(prompt('כַּמָּה?')||'0')||0; const unit=prompt('יְחִידָה (יח׳ / מ׳ / ק״ג / שַׂק…):')||'יח׳';
      try{ if(window.__materials&&window.__materials.add) window.__materials.add(nm,qty,unit,t.t); }catch(e){}
      try{ alert('נוֹסַף: '+nm+' לַפְּרוֹיֶקְט "'+t.t+'". רְאֵה אֶת הָרֶכֶשׁ הַמְּשֻׁתָּף בְּמוֹחַ → 🔩 חֹמֶר.'); }catch(e){} }
    else if(act==='addNote'){ const tt=prompt('הערה:'); if(!tt) return;
      r.notes.push({t:tt,d:new Date().toLocaleDateString('he-IL')}); save(); render(); }
    else if(act==='delItem'){
      if(arg==='tasks'){ const tk=r.tasks[+arg2]; if(tk) projMirrorRemove(tk); }
      r[arg].splice(+arg2,1); save(); render(); }
    else if(act==='cycleTask'){ const o={plan:'prog',prog:'done',done:'plan'};
      if(r.tasks[+arg]){ r.tasks[+arg].s=o[r.tasks[+arg].s]; projMirrorUpdate(r,r.tasks[+arg]); save(); render(); } }
    else if(act==='setBU'){ const cur0=(r.bu&&r.bu[arg]!=null)?r.bu[arg]:'';
      const v=prompt('ערך (משוער · לא משורטט):',cur0); if(v===null) return;
      if(!r.bu||typeof r.bu!=='object') r.bu={}; r.bu[arg]=v; save(); render(); }
    else if(act==='addPart'){ const n=prompt('שם הרכיב (מרזב · מעקה · ברז · דוד שמש · מזגן…):'); if(!n) return;
      const installed=prompt('שנת התקנה (אופציונלי):')||''; const supplier=prompt('ספק / יצרן (אופציונלי):')||'';
      r.parts.push({n,installed,replaced:'',warr:'',supplier}); save(); render(); }
    else if(act==='editPartDate'){ const p=r.parts[+arg]; if(!p) return;
      const replaced=prompt('תאריך/שנת החלפה אחרונה:',p.replaced||''); if(replaced===null) return; p.replaced=replaced;
      const warr=prompt('אחריות עד (אופציונלי):',p.warr||''); if(warr!==null) p.warr=warr;
      save(); render(); }
  }

  /* ---- reno tasks mirror to LogStore 'projects' so alerts.js / the מוח tab
     see renovation work. add on create, update on cycle, remove on delete —
     keyed by a stored projId on the task. Soft-guarded: no LogStore → no-op
     (the task still lives in the workbench DOC, as before). ---- */
  function projStatusHe(s){ return ({plan:'מתוכנן',prog:'בתהליך',done:'בוצע'})[s]||'מתוכנן'; }
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
      lb=document.createElement('div'); lb.id='planLightbox'; lb.setAttribute('dir','rtl');
      lb.innerHTML=`<div class="pv"><span class="px" data-x title="סגור">✕</span><img alt=""><div class="pcap"></div></div>`;
      img=lb.querySelector('img'); cap=lb.querySelector('.pcap'); document.body.appendChild(lb);
      lb.addEventListener('click',e=>{ if(e.target===lb||e.target.closest('[data-x]')) lb.classList.remove('on'); });
    }
    // Synthetic demo: there is NO real plan/scan to show. Ignore any src and
    // render an honest placeholder note instead of loading a (non-existent) image.
    window.__planView=function(src,caption){ build();
      if(img){ img.removeAttribute('src'); img.style.display='none'; }
      cap.textContent='📐 הדמו אינו כולל תוכניות בנייה — המבנה נוצר ממודל סינתטי, ללא היתר או סריקה.';
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
      const tier=rank<0?'':(rank<n/3?'חם':(rank>=Math.ceil(2*n/3)?'קריר':'ביניים'));
      return { tempC: base?Math.round((base.tempC+(my-mean)*0.45)*10)/10:null, frac, tier, score:my, floor:g.floor };
    },
    _doc(){ return DOC; },
  };
})();
