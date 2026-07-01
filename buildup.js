/* ===================================================================
   buildup.js — window.HouseBuildup: the house BUILD-UP knowledge layer.
   A tiny keyless/offline loader for data/house_buildup.json (the real
   structural facts proven in building.js + the permit area schedule).
   Pure data — NO DOM, NO network beyond the one JSON, NO keys. Loads
   AFTER building.js and BEFORE workbench.js (per index.html order).

   workbench.js's 'structure' tab calls HouseBuildup.get(roomId)
   to render verified build-up rows; every fact carries `verified` so the
   view can stamp a «Estimated» pill on what the drawings don't actually prove.

   HONESTY (gotcha #2): only facts directly readable in building.js are
   verified:true (wall 0.20/0.12, slab 0.20, roof slab 0.16, levels,
   areas). Concrete-belt / columns / wall-layer build-up / MEP routing are
   NOT in the byte-identical scanned permit PDFs (no structural sheet), so
   they ship verified:false + 'not drawn' and BLANK-AND-EDITABLE — never
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
      disclaimer_he: "Structure data is derived from a synthetic 3D model. «Estimated · not drawn» rows are editable.",
      verified_src_he: "Synthetic 3D model"
    },
    sources: [
      { id:"building.js", he:"Synthetic 3D model" },
      { id:"plan", he:"Synthetic model (demo)" },
      { id:"permit", he:"Permit area schedule" },
      { id:"derived", he:"Engineering inference — not drawn" }
    ],
    assemblies: {
      extWall:  { label:"Exterior wall", thickness_m:0.20, thickness_note_he:"20 cm in the model · marked 18 in the plan", finish_he:"Light stucco", layers:[{n:"Block",t:"",verified:false}], src:"building.js", verified:true, layers_verified:false, note_he:"Thickness verified; the layer make-up (block type · insulation · finish) is not specified — estimated" },
      partition:{ label:"Interior partition", thickness_m:0.12, src:"building.js", verified:true, note_he:"Interior room partition ~12 cm per the floor plans" },
      slab:     { label:"Concrete slab", thickness_m:0.20, src:"building.js", verified:true },
      roofSlab: { label:"Roof slab", thickness_m:0.16, src:"building.js", verified:true },
      parapet:  { label:"Parapet wall", thickness_m:0.20, height_m:0.40, src:"building.js", verified:true, note_he:"Roof parapet 0.40 m above the roof level (5.30 → 5.70)" }
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
     verified:false so the view shows «Estimated · not drawn», honest by
     construction. terrace gets walls:[parapet] (it's the roof terrace). */
  function defaultRoom(floor){
    return {
      floor: floor || 'ground',
      walls: ['extWall','partition'],
      floorFinish:  { he:'', src:'derived',  verified:false, note_he:'Floor finish not specified in the plan — estimated' },
      concreteBelt: { present:null, he:'', src:'derived', verified:false, note_he:'Concrete ring-beam not drawn (no structural sheet)' },
      columns:      { count:null, he:'', src:'derived', verified:false, note_he:'No column markings appear in the plan' },
      circuit:      { he:'', src:'derived', verified:false, note_he:'Circuit mapping not drawn — fill in from the electrical panel' }
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
