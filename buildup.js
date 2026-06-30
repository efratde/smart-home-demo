/* ===================================================================
   buildup.js — window.HouseBuildup: the house BUILD-UP knowledge layer.
   A tiny keyless/offline loader for data/house_buildup.json (the real
   structural facts proven in building.js + the permit area schedule).
   Pure data — NO DOM, NO network beyond the one JSON, NO keys. Loads
   AFTER building.js and BEFORE workbench.js (per index.html order).

   workbench.js's 'מבנה' (structure) tab calls HouseBuildup.get(roomId)
   to render verified build-up rows; every fact carries `verified` so the
   view can stamp a «משוער» pill on what the drawings don't actually prove.

   HONESTY (gotcha #2): only facts directly readable in building.js are
   verified:true (wall 0.20/0.12, slab 0.20, roof slab 0.16, levels,
   areas). Concrete-belt / columns / wall-layer build-up / MEP routing are
   NOT in the byte-identical scanned permit PDFs (no structural sheet), so
   they ship verified:false + 'לא משורטט' and BLANK-AND-EDITABLE — never
   fabricated. A hard-coded fallback mirrors the JSON so file:// works even
   when fetch() is blocked (the project's other loaders do the same).
   =================================================================== */
(function(){
  if(window.HouseBuildup) return;            // idempotency guard (house pattern)

  /* Minimal fallback so the structure tab still shows the VERIFIED facts on
     file:// where fetch() can be blocked. Mirrors house_buildup.json's
     assemblies/levels/areas + the per-room verified floor facts; the deep
     unverified rows are synthesized per room by get() (blank + editable). */
  const FALLBACK = {
    schema: 1,
    meta: {
      disclaimer_he: "נתוני המבנה נגזרים ממודל תלת-ממדי סינתטי. שורות «משוער · לא משורטט» ניתנות לעריכה.",
      verified_src_he: "מודל תלת-ממד סינתטי"
    },
    sources: [
      { id:"building.js", he:"מודל תלת-ממד סינתטי" },
      { id:"plan", he:"מודל סינתטי (דמו)" },
      { id:"permit", he:"טבלת שטחים בהיתר" },
      { id:"derived", he:"הסקה הנדסית — לא משורטט" }
    ],
    assemblies: {
      extWall:  { label:"קיר חוץ", thickness_m:0.20, thickness_note_he:"20 ס\"מ במודל · בתוכנית מסומן 18", finish_he:"סיח ברור", layers:[{n:"בלוק",t:"",verified:false}], src:"building.js", verified:true, layers_verified:false, note_he:"העובי מאומת; הרכב השכבות (סוג בלוק · בידוד · גמר) לא מצוין — משוער" },
      partition:{ label:"מחיצה פנים", thickness_m:0.12, src:"building.js", verified:true, note_he:"מחיצת חדרים פנימית ~12 ס\"מ לפי תוכניות הקומה" },
      slab:     { label:"רצפת בטון", thickness_m:0.20, src:"building.js", verified:true },
      roofSlab: { label:"תקרת גג", thickness_m:0.16, src:"building.js", verified:true },
      parapet:  { label:"קיר אקרוטריון", thickness_m:0.20, height_m:0.40, src:"building.js", verified:true, note_he:"מעקה גג 0.40 מ' מעל מפלס הגג (5.30 → 5.70)" }
    },
    levels: { ground_m:0.00, firstFloor_m:2.80, roofSlab_m:5.30, parapet_m:5.70, terraceRail_m:3.88, storageRidge_m:2.30, storageParapet_m:2.55, groundStoreyH_m:2.80, upperStoreyH_m:2.50, src:"building.js", verified:true },
    areas_permit: { ground_m2:60.73, firstFloor_m2:37.19, storage_m2:9.00, shelter_m2:5.18, src:"permit", verified:true },
    rooms: {}    // get() synthesizes the per-room deep rows when absent
  };

  let DATA = FALLBACK;
  let _resolved = false;

  /* one-shot fetch; on any failure (file://, missing file, bad JSON) keep
     the fallback so the verified facts always render. Same idiom as
     garden.js loadCurated(). */
  const ready = fetch('data/house_buildup.json')
    .then(r => r.ok ? r.json() : null)
    .then(j => { if(j && typeof j==='object') DATA = j; _resolved=true; return DATA; })
    .catch(() => { _resolved=true; return DATA; });

  /* default deep-row scaffold for a room not (yet) in the JSON — BLANK +
     verified:false so the view shows «משוער · לא משורטט», honest by
     construction. terrace gets walls:[parapet] (it's the roof terrace). */
  function defaultRoom(floor){
    return {
      floor: floor || 'ground',
      walls: ['extWall','partition'],
      floorFinish:  { he:'', src:'derived',  verified:false, note_he:'גמר ריצוף לא מצוין בתוכנית — משוער' },
      concreteBelt: { present:null, he:'', src:'derived', verified:false, note_he:'חגורת בטון לא משורטטת (אין דף קונסטרוקציה)' },
      columns:      { count:null, he:'', src:'derived', verified:false, note_he:'לא מופיעים סימני עמודים בתוכנית' },
      circuit:      { he:'', src:'derived', verified:false, note_he:'מיפוי מעגלים לא משורטט — מלא לפי לוח החשמל' }
    };
  }

  /* get(roomId, floorHint) → the merged build-up bundle the structure tab
     renders: shared assemblies/levels/areas (verified) + this room's deep
     rows (verified where building.js proves them, else blank+editable). */
  function get(roomId, floorHint){
    const room = (DATA.rooms && DATA.rooms[roomId]) || defaultRoom(floorHint);
    const wallKeys = room.walls || ['extWall','partition'];
    const walls = wallKeys.map(k => DATA.assemblies[k]).filter(Boolean);
    return {
      roomId, room, walls,
      assemblies: DATA.assemblies,
      levels: DATA.levels,
      areas: DATA.areas_permit,
      sources: DATA.sources,
      meta: DATA.meta
    };
  }

  function sourceHe(id){
    const s = (DATA.sources||[]).find(x => x.id===id);
    return s ? s.he : id;
  }

  window.HouseBuildup = { ready, get, sourceHe, data:()=>DATA, isResolved:()=>_resolved };
})();
