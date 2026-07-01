/* ===================================================================
   app.js — wires the living house: renderer, camera, the real-time
   (or scrubbable) clock, the sky/weather engines, and the RTL UI.
   =================================================================== */
(function(){
  // a persisted preview window can retain render loops from earlier script runs — nuke them
  let mr=requestAnimationFrame(()=>{}); while(mr-- > 0) cancelAnimationFrame(mr);
  let mi=setInterval(()=>{},9e6); while(mi-- > 0) clearInterval(mi);
  const errEl=document.getElementById('err');
  // Alex never sees a raw stack: render a warm fallback card; the raw
  // error hides behind a "Technical details" toggle (revealed only if he asks for it).
  const fail=(m)=>{
    console.error(m);
    try{
      const esc=String(m).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      errEl.innerHTML=
        '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;'+
        'background:#06070f;z-index:120;font-family:\'Heebo\',sans-serif;padding:24px;" dir="ltr">'+
        '<div style="max-width:420px;text-align:center;color:#efe6cf;background:linear-gradient(150deg,rgba(14,16,30,.92),rgba(8,9,18,.9));'+
        'border:1px solid rgba(202,161,90,.32);border-radius:6px;box-shadow:0 16px 44px rgba(0,0,0,.5);padding:26px 24px;">'+
        '<div style="font-size:34px;line-height:1;margin-bottom:14px;">🌅</div>'+
        '<div style="font-family:\'Frank Ruhl Libre\',serif;font-size:17px;color:#fff7e6;line-height:1.55;">'+
        'The 3D view failed to load — try a different browser or device</div>'+
        '<button id="errTechToggle" type="button" style="margin-top:18px;background:transparent;border:1px solid rgba(202,161,90,.4);'+
        'color:#e7c98a;font-family:\'Heebo\',sans-serif;font-size:12px;padding:7px 14px;border-radius:4px;cursor:pointer;min-height:34px;">'+
        'Technical details</button>'+
        '<pre id="errTechBody" style="display:none;text-align:left;direction:ltr;margin-top:14px;color:#ff9b9b;'+
        'font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-word;max-height:40vh;overflow:auto;">'+esc+'</pre>'+
        '</div></div>';
      const tg=errEl.querySelector&&errEl.querySelector('#errTechToggle');
      const bd=errEl.querySelector&&errEl.querySelector('#errTechBody');
      if(tg&&bd) tg.addEventListener('click',()=>{ bd.style.display = bd.style.display==='none' ? 'block' : 'none'; });
    }catch(_e){ try{ errEl.textContent='The 3D view failed to load 🌅'; }catch(__e){} }
  };
  const MYGEN=(window.__gen=(window.__gen||0)+1);  // newest run supersedes older loops
  try{
  const canvas=document.getElementById('c');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setSize(innerWidth,innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputEncoding=THREE.sRGBEncoding; renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=0.45;

  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(42, innerWidth/innerHeight, 0.5, 30000);
  camera.position.set(15.5, 11, 18.5);
  const controls=new THREE.OrbitControls(camera,canvas);
  controls.target.set(0,1.8,0); controls.enableDamping=true; controls.dampingFactor=0.08;
  // ---- POLAR-ANGLE CLAMP: ground-safe for MANUAL orbit, lifted only for sky focus ----
  // OrbitControls.update() runs EVERY frame and clamps the camera's polar angle φ to
  // [minPolarAngle, maxPolarAngle] (then spherical.makeSafe()). So maxPolarAngle limits
  // BOTH manual drag AND any programmatic move. A previous build set it to π so the
  // sky-focus could centre a zenith object (see __lookAtSky) — but that also let manual
  // dragging tip the camera BELOW the terrain (φ>π/2 ⇒ camera under the look point), so
  // the user saw through the ground/house and the garden rocks looked "floating" (seen
  // from beneath). Fix: keep a GROUND-SAFE clamp (~1.5 rad, just shy of horizontal so the
  // camera can skim along the horizon but never dive underground) for manual control, and
  // lift the clamp to π ONLY for a programmatic sky-focus; the ground-safe clamp is re-armed
  // the next time MANUAL control begins (a pointer-down on the canvas — see __lookAtSky's
  // handoff note below). __flyToGround / __flyHome need no lift — they move the camera
  // up-and-back over the target, a shallow downward look (φ<π/2), well inside the clamp.
  // FREE 360° MOUSE ORBIT (user request): allow the manual drag to rotate all the way up
  // to look at the sky. We no longer hard-clamp at the horizon — the decorative rocks that
  // looked bad "from beneath" were removed (environment.js SHOW_PLANTS_ROCKS=false), so the
  // under-view is just clean terrain. ~171° (not exactly π) avoids the polar gimbal flip.
  const GROUND_SAFE_POLAR=Math.PI*0.95;   // ~171°: full manual vertical orbit incl. looking straight up
  controls.maxPolarAngle=GROUND_SAFE_POLAR; controls.minDistance=6; controls.maxDistance=2600;
  controls.update();
  window.__camera=camera; window.__controls=controls; window.__scene=scene;   // __scene: lets the GIS terrain-layer module drape georeferenced overlays

  // ---- FOCUS THE VIEW ON A SKY OBJECT --------------------------------------
  // window.__lookAtSky(azDeg, altDeg): smoothly aim the OrbitControls camera so
  // the view points toward the given horizon direction. World dir from az/alt
  // (matches astro.js vec(): world +x=East, +z=South, +y=up, az from N clockwise):
  //   dir = { x: sin(az)·cos(alt), y: sin(alt), z: −cos(az)·cos(alt) }
  // We keep the CAMERA position fixed and move controls.target to
  // camera.position + dir·D (D a few hundred units, well inside the sky shell),
  // eased over ~0.6 s, so the view rotates to put the object dead-centre. The
  // main loop already calls controls.update() every frame; the tween just walks
  // the target there. panels.js wires each listed object's row to call this with
  // that object's CURRENT az/alt (from Astro.star/moon/sun/planets).
  //
  // POLAR-CLAMP HANDOFF — the crux of decoupling sky-look from the manual clamp.
  // OrbitControls.update() re-derives the camera from the target each frame and
  // clamps the polar angle φ to [0,maxPolarAngle]. __lookAtSky parks the target ~400
  // units along the look ray, so when the object is above the camera the target sits
  // ABOVE it and (camera−target) points DOWN ⇒ the RESTING φ = π/2 + altitude (e.g.
  // ~2.4 rad for a 45° object). The ground-safe manual clamp (1.5 rad) would chop
  // that, snapping the camera and making it impossible to REST looking up. So:
  //   • a programmatic sky-focus LIFTS maxPolarAngle to π (so the view can tip fully
  //     up AND rest there — makeSafe() still nudges φ off exactly 0/π, no gimbal flip);
  //   • we DON'T restore on tween-end (that would yank the resting sky view down);
  //   • instead a canvas pointer-DOWN (the user grabbing to orbit = MANUAL control)
  //     restores GROUND_SAFE_POLAR, so the very next manual drag is clamped and can
  //     never dive under the terrain. __flyToGround / __flyHome also restore (they
  //     look gently DOWN, φ<π/2, comfortably inside the ground-safe clamp).
  // Net: automated aiming centres any zenith object; manual drag stays above ground.
  const FOCUS_D=400, _D2R=Math.PI/180;
  let _focusTween=null;
  function restoreGroundClamp(){ controls.maxPolarAngle=GROUND_SAFE_POLAR; }
  // MANUAL orbit start ⇒ re-engage the ground-safe clamp (decouples from any lifted
  // sky-look). A drag-orbit always begins with a pointer-DOWN on the canvas, so we
  // re-arm there. We deliberately do NOT use controls' 'start' event: in r128 that
  // also fires on mouse-WHEEL zoom (onMouseWheel dispatches it), which would snap a
  // resting sky-view down on a mere zoom. pointerdown fires only for press/drag, so
  // zooming while looking up is preserved; the first drag still re-clamps to ground.
  canvas.addEventListener('pointerdown',restoreGroundClamp);
  window.__lookAtSky=function(azDeg, altDeg){
    if(!isFinite(azDeg)||!isFinite(altDeg)) return;
    const az=azDeg*_D2R, alt=altDeg*_D2R, ca=Math.cos(alt);
    const dir=new THREE.Vector3(Math.sin(az)*ca, Math.sin(alt), -Math.cos(az)*ca);
    const dest=camera.position.clone().add(dir.multiplyScalar(FOCUS_D));
    const from=controls.target.clone();
    controls.maxPolarAngle=Math.PI;        // let the view tip fully up AND rest there
    _focusTween={ from, dest, t0:performance.now(), dur:600 };
  };
  // advance the focus easing; called once per frame from the render loop
  function stepFocus(){
    if(!_focusTween) return;
    const k=Math.min(1,(performance.now()-_focusTween.t0)/_focusTween.dur);
    const e=k<0.5? 2*k*k : 1-Math.pow(-2*k+2,2)/2;   // easeInOutQuad
    controls.target.lerpVectors(_focusTween.from, _focusTween.dest, e);
    if(k>=1) _focusTween=null;             // keep maxPolarAngle lifted so the sky view RESTS;
    // the ground-safe clamp is re-armed on the next manual orbit ('start') / fly-home / fly-to-ground.
  }

  // ---- FLY THE VIEW TO A GROUND POINT (iNaturalist sighting) ---------------
  // window.__flyToGround(lng, lat): ease the OrbitControls *target* to a real
  // GROUND location (a lon/lat near the house) AND bring the camera to a sane
  // viewing distance/angle of it. Distinct from __lookAtSky (which aims at the
  // sky shell and never moves the camera): a sighting may be far (up to ~15 km),
  // so we MUST move the camera or the target would sit thousands of units away
  // beyond controls.maxDistance and the view would be a blur. We convert lon/lat
  // to the SAME world frame as the terrain (+x=East, +z=South; 1 world unit = 1
  // metre — see terrain.js EX=4000 over 4 km) and clamp the target to the terrain
  // surface via Terrain.sampleHeight. The camera is then placed up-and-back from
  // the target along its current view bearing at a distance that scales with how
  // far the point is (clamped into controls' [minDistance,maxDistance]), looking
  // down at a gentle angle. Both target and camera ease over ~0.8 s (easeInOutQuad),
  // advanced each frame by stepGroundFly() in the render loop.
  const _MPD_LAT=110540, _MPD_LON=111320*Math.cos(34.0*Math.PI/180); // metres per deg here
  let _groundTween=null;
  function groundWorld(lng, lat){
    // lon/lat → world metres (house at world origin; +x=E, +z=S so +lat → −z)
    const x=(lng-(-40.0))*_MPD_LON;
    const z=-(lat-34.0)*_MPD_LAT;
    let y=1.0;
    if(window.Terrain&&Terrain.sampleHeight){
      // terrain mesh sits in scene space; houseWrap (the house) was dropped to
      // sampleHeight(0,0)-0.2, so add houseWrap.position.y to stay consistent.
      y=Terrain.sampleHeight(x,z)+(houseWrap?houseWrap.position.y:0)+0.6;
    }
    return new THREE.Vector3(x,y,z);
  }
  window.__flyToGround=function(lng, lat){
    if(!isFinite(lng)||!isFinite(lat)) return;
    const gt=groundWorld(lng,lat);
    // current view bearing on the XZ plane (so we approach from where we already
    // look, rather than snapping orientation); fall back to a south-east-ish view.
    let dx=camera.position.x-controls.target.x, dz=camera.position.z-controls.target.z;
    let h=Math.hypot(dx,dz); if(h<1e-3){ dx=0.6; dz=0.8; h=1; }
    dx/=h; dz/=h;
    // viewing distance grows with the target's offset from the scene centre, so a
    // far sighting is framed from afar; clamped into the controls' allowed range.
    // The offset (back + up) is UNIT-normalised then scaled by `dist`, so the
    // camera↔target distance equals `dist` exactly and OrbitControls.update()'s
    // [minDistance,maxDistance] clamp won't fight the framing.
    const reach=Math.hypot(gt.x,gt.z);
    const dist=Math.max(controls.minDistance+2,
               Math.min(controls.maxDistance-20, 40+reach*0.55));
    const off=new THREE.Vector3(dx,0.6,dz).normalize().multiplyScalar(dist); // ~31° down
    const camDest=gt.clone().add(off);
    _groundTween={ tFrom:controls.target.clone(), tDest:gt,
                   cFrom:camera.position.clone(),  cDest:camDest,
                   t0:performance.now(), dur:800 };
    _focusTween=null;        // cancel any sky-focus tween so they don't fight
    restoreGroundClamp();    // a ground fly looks DOWN (φ<π/2); re-clamp so we don't inherit a lifted sky clamp
  };
  function stepGroundFly(){
    if(!_groundTween) return;
    const g=_groundTween;
    const k=Math.min(1,(performance.now()-g.t0)/g.dur);
    const e=k<0.5? 2*k*k : 1-Math.pow(-2*k+2,2)/2;   // easeInOutQuad
    controls.target.lerpVectors(g.tFrom, g.tDest, e);
    camera.position.lerpVectors(g.cFrom, g.cDest, e);
    if(k>=1) _groundTween=null;
  }

  // ---- RETURN HOME: ease the view back to the default house framing -------
  // window.__flyHome(): smoothly returns the camera + target to the canonical
  // "looking at the house" pose. That pose is the same one the terrain-load
  // callback sets once the real ground height is known (target ≈ (0,h+3,0),
  // camera ≈ (28,h+20,38)); we capture it into _home there (and seed a sane
  // fallback now, before terrain resolves). Reuses the same easeInOutQuad tween
  // plumbing as the sky/ground flights, advanced each frame by stepHome(). It
  // also clears any active sky-focus / ground-fly so nothing fights it, and
  // restores the ground-safe polar clamp (the home pose looks gently DOWN at the
  // house, φ<π/2, so it's well inside that clamp). The home button (see injectUI)
  // calls this.
  let _home={ cam:new THREE.Vector3(28,20,38), tgt:new THREE.Vector3(0,3,0) };
  let _homeTween=null;
  window.__flyHome=function(){
    _focusTween=null; _groundTween=null;   // cancel any in-flight camera tween
    restoreGroundClamp();                  // home looks down at the house — ground-safe clamp is fine
    _homeTween={ tFrom:controls.target.clone(), tDest:_home.tgt.clone(),
                 cFrom:camera.position.clone(),  cDest:_home.cam.clone(),
                 t0:performance.now(), dur:850 };
  };
  // window.__flyTopHome(): a near-top-down "from above" overview of the house + yard — fired
  // when the House/Yard tabs open so the spatial view is immediate. Reuses the home-tween plumbing;
  // a small +z keeps OrbitControls' polar clamp (φ<π/2) off the exact pole.
  window.__flyTopHome=function(){
    _focusTween=null; _groundTween=null; restoreGroundClamp();
    const h=(_home&&_home.tgt&&_home.tgt.y)||3;
    _homeTween={ tFrom:controls.target.clone(), tDest:new THREE.Vector3(0,Math.max(0,h-2),0),
                 cFrom:camera.position.clone(),  cDest:new THREE.Vector3(0,h+46,6),
                 t0:performance.now(), dur:850 };
  };
  function stepHome(){
    if(!_homeTween) return;
    const g=_homeTween;
    const k=Math.min(1,(performance.now()-g.t0)/g.dur);
    const e=k<0.5? 2*k*k : 1-Math.pow(-2*k+2,2)/2;   // easeInOutQuad
    controls.target.lerpVectors(g.tFrom, g.tDest, e);
    camera.position.lerpVectors(g.cFrom, g.cDest, e);
    if(k>=1) _homeTween=null;
  }

  // ---- world: detailed house + garden re-centred onto the real terrain ----
  const M=Mats.build();
  const houseWrap=new THREE.Group(); scene.add(houseWrap);
  const house=Building.build(M);
  const garden=Environment.buildGarden(M);
  const HCX=4.2, HCZ=5.1;                       // house-model centre in its own coords
  house.position.set(-HCX,0,-HCZ);
  garden.group.position.set(-HCX,0,-HCZ);
  houseWrap.add(house); houseWrap.add(garden.group);
  houseWrap.rotation.y=THREE.MathUtils.degToRad(95);  // RE-ORIENTED: +90° so the open back-yard/courtyard/terrace faces EAST (open desert, per the aerial) and the entrance faces WEST (the shared plaza). Was 5° (which assumed the floor plan was north-up; it isn't). 90° + the 4.8° site tilt ≈ 95°.
  const glass=house.userData.glass, ilights=house.userData.ilights;
  SkyRig.init({scene,renderer,glass,ilights});
  Weather.init(scene);

  // ====================================================================
  //  ENTER THE HOUSE  ("Enter the house")  — reveal the interior + dollhouse view
  //  --------------------------------------------------------------------
  //  building.js already models the FULL interior inside the shell (partitions,
  //  per-room floor tiles, stairs, kitchen counter, bathtub). It's normally
  //  hidden under the ROOF SLABS + PARAPET (over the enclosed upper L) and the
  //  UPPER-FLOOR SLAB (the storey divider over the ground floor). This mode
  //  REVEALS the rooms by hiding exactly those cap pieces and pulling the camera
  //  into a top-down "dollhouse" framing (orbit/zoom preserved), then EXIT
  //  restores everything. We touch building.js's meshes ONLY via .visible —
  //  never geometry/material — and remember each mesh's prior .visible so EXIT
  //  restores it exactly. (building.js is NOT edited.)
  //
  //  HOW WE IDENTIFY THE PIECES TO HIDE (position-based, self-contained):
  //  We traverse the `house` group and, per mesh, take its WORLD axis-aligned
  //  bounding box, then convert it into the house group's OWN local frame
  //  (house.worldToLocal). Because houseWrap only YAWS (about +y) and DROPS
  //  (+y) the house, local Y equals building.js's own metre coordinates exactly
  //  (a Y-rotation preserves Y; house.position.y is 0). Using building.js's
  //  published storey heights GH=2.80, UH=2.50 (from house.userData) we classify:
  //    • ROOF + PARAPET  — any mesh whose local bbox MIN.y ≥ GH+UH−0.30 (≈5.0).
  //        The two roof slabs (M.roof) and the 6 parapet ring segments all sit
  //        at y≥5.30; the UPPER exterior walls top out at exactly 5.30 but START
  //        at 2.80, so their bbox MIN.y (2.80) excludes them — only the cap is
  //        caught. (We also OR-in material===M.roof as belt-and-suspenders for
  //        the slabs.)
  //    • UPPER-FLOOR SLAB — the single full-footprint concrete divider centred
  //        at y≈GH+0.10 (2.90). We match a mesh whose bbox CENTRE.y is in
  //        [2.82,2.98] AND whose horizontal footprint is large (size.x>6.5 &&
  //        size.z>5.5 ≈ the 8.41×7.20 block). That uniquely hits the storey
  //        slab — the ground slab sits at y≈0.02, the terrace deck at y≈3.02 and
  //        is far smaller, counters/stairs are small. Hiding it lets you also
  //        see DOWN into the ground-floor rooms from the dollhouse view.
  //  Everything found is cached once (lazily, on first enter — meshes exist by
  //  then) so toggling is cheap and EXIT is an exact restore.
  //
  //  CAMERA: ENTER eases (easeInOutQuad, same plumbing as __flyHome) to a pose
  //  ABOVE-and-back of the house centre looking DOWN into the now-open rooms,
  //  and DROPS controls.minDistance (6 → ENTER_MIN_DIST 1.2) so you can zoom in
  //  to near eye-level inside, while TIGHTENING controls.maxDistance (→ 60) so
  //  orbit stays around the house. The ground-safe polar clamp (≤1.5 rad) is
  //  kept armed so manual orbit never dives under the floor. EXIT restores the
  //  saved outside pose + the original min/max distance. __flyHome() also EXITs
  //  (so "⌂ Home" doubles as a leave-the-house action).
  // ====================================================================
  const EnterMode=(function(){
    const _GH=(house.userData&&house.userData.GH)||2.80;   // ground storey ≈2.80
    const _UH=(house.userData&&house.userData.UH)||2.50;   // upper storey ≈2.50

    // ---- TIER THRESHOLDS (house-LOCAL bbox-centre Y; building.js metre frame) ----
    // Verified against building.js dims (GH=2.80, SLAB=0.20, roof slab top 5.38,
    // parapet top 5.70):
    //   • GROUND  (centre.y < GROUND_TOP_Y=2.85): footing(-0.05), gnd slab(0.02),
    //       gnd ext+interior walls (span 0..2.80 ⇒ centre≈1.40), gnd floor tiles
    //       (0.01), kitchen counter (≈0.45), stairs (≈1.40), courtyard paving,
    //       perimeter walls (≈1.0), storage walls (≈1.2) + shingle roof (≈2.42),
    //       gnd window glass/frames/sills.
    //   • UPPER  (UPPER_MIN_Y=2.85 ≤ centre.y < ROOF_MIN_Y=5.0): first-floor SLAB
    //       (centre 2.90 — the storey divider), upper ext+interior walls (span
    //       2.80..5.30 ⇒ centre≈4.05), upper floor tiles (3.00), bathtub (≈3.27),
    //       terrace deck (3.02), terrace kerb (≈2.89), terrace railing (≈3.5),
    //       upper lintels, upper window glass/frames/sills.
    //   • ROOF   (centre.y ≥ ROOF_MIN_Y=5.0): the two roof slabs (centre 5.38) +
    //       the 6 parapet-ring segments (centre 5.50). (We also OR-in
    //       material===M.roof for the slabs as belt-and-suspenders.)
    // NOTE: thresholds are bbox-CENTRE based — ground walls (centre 1.40) never
    // leak into upper, upper walls (4.05) never leak into roof. The storage shingle
    // roof (2.42) deliberately stays GROUND: it's a detached courtyard shed, not
    // part of the dwelling's storeys, so it should remain visible on both floors.
    const GROUND_TOP_Y=2.85;     // ground tier: centre.y below this
    const UPPER_MIN_Y =2.85;     // upper tier:  GROUND_TOP_Y ≤ centre.y < ROOF_MIN_Y
    const ROOF_MIN_Y  =5.00;     // roof tier:   centre.y at/above this
    // ---- CAMERA FRAMING CONSTANTS (easy to tweak once the user sees the render) ----
    const ENTER_MIN_DIST=1.0, ENTER_MAX_DIST=60;   // sit inside a room ↔ stay near the house
    const ROOM_EYE_Y=0.8;        // aim just above the room floor (m)
    const ROOM_BACK =2.4;        // small horizontal offset (was 5.5 — that pulled the camera ACROSS the house, behind intervening walls)
    const ROOM_UP   =5.6;        // high above → STEEP look DOWN into the room, clearing the ~2.8 m walls (roof + storey above are hidden in floor view)
    const OVER_UP_GF=15.0;       // overview camera height above floor — ground (m)
    const OVER_UP_UF=14.0;       // overview camera height above floor — upper (m)
    const OVER_BACK =2.0;        // slight south offset on overview so it isn't perfectly plan-flat (m)
    const TWEEN_MS  =900;

    // ---- ROOM TABLE (building.js LOCAL coords; floorY + room centre) ----
    const FLOOR_Y={ ground:0.0, upper:_GH+0.20 };   // upper rooms stand on the first-floor slab top (3.00)
    // cx/cz = room centre (camera aim). x0..x1, z0..z1 = the room's LOCAL-coord
    // rectangle (midpoint-tiled from the centres across the footprint: north band
    // z 0–3.6 width 8.41, south band z 3.6–7.2 width 10.50 = the L). Used by
    // roomAtLocal() so a click on a room's floor in the 3D model selects it.
    const ROOMS={
      ground:[
        {id:'kitchen',  he:'Kitchen',    cx:6.39, cz:1.80, x0:4.745, x1:8.41,  z0:0.0, z1:3.6},
        {id:'living',   he:'Living room', cx:6.84, cz:5.40, x0:4.215, x1:10.50, z0:3.6, z1:7.2},
        {id:'bedroomG', he:'Bedroom',    cx:1.59, cz:5.40, x0:0.0,   x1:4.215, z0:3.6, z1:7.2},
        {id:'bathG',    he:'Bathroom',   cx:2.03, cz:1.80, x0:1.375, x1:2.565, z0:0.0, z1:3.6},
        {id:'pantry',   he:'Pantry',     cx:0.72, cz:1.80, x0:0.0,   x1:1.375, z0:0.0, z1:3.6},
        {id:'stairsG',  he:'Stairs',     cx:3.10, cz:1.80, x0:2.565, x1:4.745, z0:0.0, z1:3.6},
      ],
      upper:[
        {id:'bedroomNE',he:'Bedroom (north)', cx:6.80, cz:1.80, x0:5.175, x1:8.41,  z0:0.0, z1:3.6},
        {id:'bedroomSW',he:'Bedroom (south)', cx:1.59, cz:5.40, x0:0.0,   x1:4.215, z0:3.6, z1:7.2},
        {id:'bathU',    he:'Bathroom',        cx:3.55, cz:1.80, x0:2.41,  x1:5.175, z0:0.0, z1:3.6},
        {id:'terrace',  he:'Terrace',         cx:6.84, cz:5.40, x0:4.215, x1:10.50, z0:3.6, z1:7.2},
        {id:'landing',  he:'Stair landing',   cx:1.27, cz:1.80, x0:0.0,   x1:2.41,  z0:0.0, z1:3.6},
      ],
    };
    // footprint centre (building.js: BX=8.41, BZ=7.20) for the floor overview
    const BX=8.41, BZ=7.20, FP_CX=BX/2, FP_CZ=BZ/2;

    // ---- in-world ROOM HEAT-MAP (floor overview): tint each room's floor by its derived
    //      warmth (window.__workbench.climateSummary) + a ~temp label. Shown only while
    //      looking down on a floor; rebuilt per floor so the tints stay current. ----
    const RoomHeat=(function(){
      const grp=new THREE.Group(); grp.renderOrder=8; house.add(grp); grp.visible=false;
      let curFloor=null;
      // the scene date the labels were last computed at, bucketed to the hour, so the
      // settle gate can skip redundant rebuilds while still following a date/time scrub.
      let _dateSig=null;
      // the authoritative scene date (published by the render loop's currentDate →
      // window.__mcDate). Falls back to real "now" before the loop publishes one.
      function sceneDate(){ return (window.__mcDate instanceof Date) ? window.__mcDate : new Date(); }
      function dateSig(d){ return Math.floor(d.getTime()/3600000); }   // hour bucket — labels are ~°C
      const lp=(a,b,t)=>a+(b-a)*t;
      function heatColor(f){                       // 0 cool-blue → .5 gold → 1 warm-orange
        const c=new THREE.Color();
        if(f<0.5){ const t=f/0.5; c.setRGB(lp(0.42,0.79,t), lp(0.62,0.63,t), lp(0.82,0.36,t)); }
        else { const t=(f-0.5)/0.5; c.setRGB(lp(0.79,0.86,t), lp(0.63,0.42,t), lp(0.36,0.30,t)); }
        return c;
      }
      function label(text){
        const cv=document.createElement('canvas'); cv.width=200; cv.height=80; const x=cv.getContext('2d');
        x.font='700 46px Heebo, Arial, sans-serif'; x.textAlign='center'; x.textBaseline='middle';
        x.lineWidth=7; x.strokeStyle='rgba(8,9,16,0.85)'; x.strokeText(text,100,42);
        x.fillStyle='#fff7e6'; x.fillText(text,100,42);
        const t=new THREE.CanvasTexture(cv); t.anisotropy=4;
        const m=new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false,depthTest:false}); m.toneMapped=false;
        const s=new THREE.Sprite(m); s.scale.set(1.5,0.6,1); s.renderOrder=21; return s;
      }
      function clear(){ for(let i=grp.children.length-1;i>=0;i--){ const o=grp.children[i];
        if(o.material){ if(o.material.map)o.material.map.dispose(); o.material.dispose(); } if(o.geometry)o.geometry.dispose(); grp.remove(o); } }
      function build(floor){
        clear(); curFloor=floor;
        // compute every room's warmth/temp for the CURRENT scene date (scrub-aware): the
        // workbench's climateSummary(id,date) re-derives the modelled indoor temp for that
        // date. NOTE: these are MODELLED room temps (a damped response to measured/forecast
        // outdoor air through the house mass) — never a physical sensor. The label reads "~X°".
        const d=sceneDate(); _dateSig=dateSig(d);
        const WB=window.__workbench;
        // Tint BOTH floors' room floors (not just the active `floor`): build the heat
        // items for every room of ground+upper, each carried with ITS OWN floorY so the
        // coloured plane + ~°C sprite sit on that room's own slab. (The `floor` arg only
        // governs camera/visibility elsewhere; tinting covers both decks so the lower
        // floor is tinted the same as the upper — never the raw floor texture.)
        const items=[];
        ['ground','upper'].forEach(fl=>{
          const floorY=FLOOR_Y[fl]||0;
          (ROOMS[fl]||[]).forEach(r=>{
            const cs=(WB&&WB.climateSummary)?WB.climateSummary(r.id,d):null;
            if(cs) items.push({r, cs, floorY, fl});
          });
        });
        if(!items.length) return;
        // normalise across ALL rooms of BOTH floors together (one shared min/max) so the
        // coolest room is full-blue and the hottest full-warm — colours stay comparable
        // between the two floors.
        const ss=items.map(x=>x.cs.score), mn=Math.min.apply(null,ss), mx=Math.max.apply(null,ss);
        items.forEach(({r,cs,floorY,fl})=>{
          const f=(mx>mn)?(cs.score-mn)/(mx-mn):0.5;
          const w=Math.max(0.2,(r.x1-r.x0)-0.12), d=Math.max(0.2,(r.z1-r.z0)-0.12);
          const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),
            new THREE.MeshBasicMaterial({color:heatColor(f),transparent:true,opacity:0.92,depthWrite:false}));
          m.rotation.x=-Math.PI/2; m.position.set((r.x0+r.x1)/2, floorY+0.05, (r.z0+r.z1)/2); m.renderOrder=8; grp.add(m);
          // tint BOTH decks (so the lower floor reads when visible), but only LABEL the floor
          // being viewed — otherwise the two decks' ~°C labels overlap in the top-down view.
          if(cs.tempC!=null && fl===floor){ const sp=label('~'+cs.tempC+'°'); sp.position.set((r.x0+r.x1)/2, floorY+0.55, (r.z0+r.z1)/2); grp.add(sp); }
        });
      }
      return {
        show(floor){ if(curFloor!==floor||!grp.children.length||dateSig(sceneDate())!==_dateSig) build(floor);
          grp.visible=true; if(window.__heatLegend)window.__heatLegend(true); },
        hide(){ grp.visible=false; if(window.__heatLegend)window.__heatLegend(false); },
        // re-derive the tints + ~°C labels for the CURRENT scene date — but only when the
        // overview is showing AND the date moved to a new hour bucket (cheap label re-render,
        // no per-cell bake; mirrors the yard-heatmap debounce so continuous PLAY never hitches).
        refresh(){ if(grp.visible&&curFloor&&dateSig(sceneDate())!==_dateSig) build(curFloor); }
      };
    })();

    let _tiers=null;             // {roof:[{mesh,prevVisible}], upper:[…], ground:[…]} captured lazily
    let _on=false;
    let _floor='ground';         // active floor while inside
    let _saved=null;             // outside pose to restore on exit {cam,tgt,minD,maxD}
    let _enterTween=null;
    let _props=null;             // exterior houseWrap props (garden plants/pots/trees + yard-shade overlay) hidden while inside; [{obj,prevVisible}]

    // classify every house mesh into roof / upper / ground tiers ONCE (lazily, on
    // first enter — meshes all exist by then). Stores prevVisible so EXIT restores
    // each mesh's prior .visible exactly. Verified mapping is documented above.
    function collect(){
      if(_tiers) return _tiers;
      _tiers={ roof:[], upper:[], ground:[] };
      const _b=new THREE.Box3(), _mn=new THREE.Vector3(), _mx=new THREE.Vector3();
      house.updateWorldMatrix(true,true);
      house.traverse(o=>{
        if(!o.isMesh||!o.geometry) return;
        _b.setFromObject(o);
        if(!isFinite(_b.min.y)||!isFinite(_b.max.y)) return;
        // world bbox corners → house-local (Y is exact under the yaw + y-drop:
        // a Y-rotation preserves Y and house.position.y is 0)
        _mn.copy(_b.min); _mx.copy(_b.max);
        house.worldToLocal(_mn); house.worldToLocal(_mx);
        const cy=(Math.min(_mn.y,_mx.y)+Math.max(_mn.y,_mx.y))/2;
        const rec={mesh:o, prevVisible:o.visible};
        const isRoof = (cy>=ROOF_MIN_Y) || (M&&M.roof&&o.material===M.roof);
        if(isRoof) _tiers.roof.push(rec);
        else if(cy>=UPPER_MIN_Y) _tiers.upper.push(rec);
        else _tiers.ground.push(rec);
      });
      return _tiers;
    }

    // apply visibility for the chosen floor:
    //   GROUND → hide roof ∪ upper (nothing above the ground rooms)
    //   UPPER  → hide roof only (keep the upper slab + walls so you look DOWN in)
    function applyFloorVis(floor){
      const t=collect();
      t.roof.forEach(h=>{ h.mesh.visible=false; });
      const hideUpper = (floor==='ground');
      t.upper.forEach(h=>{ h.mesh.visible = hideUpper ? false : h.prevVisible; });
      t.ground.forEach(h=>{ h.mesh.visible = h.prevVisible; });
    }
    function restoreAllVis(){
      if(!_tiers) return;
      ['roof','upper','ground'].forEach(k=>_tiers[k].forEach(h=>{ h.mesh.visible=h.prevVisible; }));
    }
    // hide every houseWrap child EXCEPT the house itself while inside — i.e. the
    // garden (plants/pots/trees/apron) and the translucent yard-shade overlay — so
    // they don't float over or show through the interior view. prevVisible is
    // re-snapshotted on each enter so EXIT restores whatever state they were in.
    function hideProps(){
      if(!_props) _props=houseWrap.children.filter(c=>c!==house).map(c=>({obj:c, prevVisible:c.visible}));
      _props.forEach(p=>{ p.prevVisible=p.obj.visible; p.obj.visible=false; });
    }
    function restoreProps(){ if(_props) _props.forEach(p=>{ p.obj.visible=p.prevVisible; }); }

    // ---- camera framing helpers (all compute LOCAL offsets then localToWorld so
    //      the house's 5° yaw is respected) ----
    function setEnterTween(camDest,tgtDest,dur){
      _enterTween={ cFrom:camera.position.clone(), cDest:camDest.clone(),
                    tFrom:controls.target.clone(),  tDest:tgtDest.clone(),
                    t0:performance.now(), dur:dur||TWEEN_MS };
    }
    // jump to a single room: target a bit above its floor; camera pulled back+up
    // (back = toward south/+z, the courtyard side) — offset in LOCAL space, then
    // localToWorld so the yaw carries it.
    function frameRoom(floorY, cx, cz){
      house.updateWorldMatrix(true,true);
      const tgt=house.localToWorld(new THREE.Vector3(cx, floorY+ROOM_EYE_Y, cz));
      const cam=house.localToWorld(new THREE.Vector3(cx, floorY+ROOM_UP, cz+ROOM_BACK));
      setEnterTween(cam, tgt, TWEEN_MS);
      RoomHeat.hide();                      // single-room view → drop the heat-map
    }
    // floor overview: look DOWN onto the whole footprint from high above its centre.
    function frameOverview(floor){
      house.updateWorldMatrix(true,true);
      const floorY=FLOOR_Y[floor]||0;
      const up = (floor==='upper') ? OVER_UP_UF : OVER_UP_GF;
      const tgt=house.localToWorld(new THREE.Vector3(FP_CX, floorY+0.4, FP_CZ));
      const cam=house.localToWorld(new THREE.Vector3(FP_CX, floorY+up, FP_CZ+OVER_BACK));
      setEnterTween(cam, tgt, TWEEN_MS);
      RoomHeat.show(floor);                 // tint each room's floor by its derived warmth
    }

    // ---- public floor / room actions ----
    function showFloor(floor){
      if(floor!=='ground'&&floor!=='upper') return;
      _floor=floor;
      applyFloorVis(floor);
      frameOverview(floor);     // default to that floor's overview when switching floors
      restoreGroundClamp();     // never tip below the floor
      rebuildRoomRow();
      syncNavUI();
    }
    function goRoom(roomId){
      const list=ROOMS[_floor]||[];
      const r=list.find(x=>x.id===roomId);
      if(!r) return;
      frameRoom(FLOOR_Y[_floor]||0, r.cx, r.cz);
      restoreGroundClamp();
      syncNavUI(roomId);
      if(window.__workbench) window.__workbench.showRoom(roomId);   // open the room's in-world workbench
    }
    function floorOverview(){ frameOverview(_floor); syncNavUI('__over');
      if(window.__workbench) window.__workbench.hide(); }            // close the workbench on overview
    // which room contains a LOCAL-coord point (from a 3D click raycast → worldToLocal),
    // for the active floor. Falls back to the nearest room centre so a click near a
    // wall still resolves. Returns a room id or null.
    function roomAtLocal(lx,lz){
      const list=ROOMS[_floor]||[]; if(!list.length) return null;
      for(const r of list){ if(lx>=r.x0&&lx<=r.x1&&lz>=r.z0&&lz<=r.z1) return r.id; }
      let best=null,bd=Infinity;
      list.forEach(r=>{ const d=(lx-r.cx)*(lx-r.cx)+(lz-r.cz)*(lz-r.cz); if(d<bd){bd=d;best=r;} });
      return best?best.id:null;
    }

    function enter(){
      if(_on) return; _on=true;
      _focusTween=null; _groundTween=null; _homeTween=null;   // cancel competing camera tweens
      // remember the outside pose so EXIT restores it exactly
      _saved={ cam:camera.position.clone(), tgt:controls.target.clone(),
               minD:controls.minDistance, maxD:controls.maxDistance };
      _floor='ground';
      applyFloorVis('ground');                                // reveal ground rooms (hide roof+upper)
      hideProps();                                            // hide garden + yard-shade overlay (exterior clutter)
      controls.minDistance=ENTER_MIN_DIST;                    // allow sitting inside a room
      controls.maxDistance=ENTER_MAX_DIST;                    // keep orbit around the house
      restoreGroundClamp();                                   // never tip below the floor
      frameOverview('ground');                                // start on the ground overview
      showNav(true); rebuildRoomRow(); syncNavUI('__over');
      mcHouseCatchUp();                                       // reveal correct house thermal colours at the current time
      syncBtn();
    }
    function exit(){
      if(!_on) return; _on=false;
      RoomHeat.hide();                                        // drop the room heat-map
      restoreAllVis();                                        // restore roof/upper/ground exactly
      restoreProps();                                         // restore garden + yard-shade overlay
      restoreGroundClamp();
      // restore the outside framing + zoom limits; tween the camera back
      const back=_saved||{ cam:_home.cam.clone(), tgt:_home.tgt.clone(), minD:6, maxD:2600 };
      controls.minDistance=back.minD; controls.maxDistance=back.maxD;
      _focusTween=null; _groundTween=null; _homeTween=null;
      setEnterTween(back.cam, back.tgt, TWEEN_MS);
      mcHouseCatchUp();                                       // re-show correct house thermal colours on the way out
      _saved=null; showNav(false); syncBtn();
      if(window.__workbench) window.__workbench.hide();             // close the room workbench on leaving
    }
    // the per-vertex house thermal is gated by play-state in the render loop (so PLAY
    // never hitches) and may be holding slightly stale colours; entering/exiting
    // interior mode must show the CORRECT house colours at the current model time, so
    // force a house-thermal catch-up here (no-op unless the microclimate layer is on
    // with a temperature variable). __microclimate is defined later in this file but
    // exists by the time the user can toggle interior mode.
    function mcHouseCatchUp(){
      if(window.__microclimate && window.__microclimate.isOn() && window.__microclimate.isTempVar())
        window.__microclimate._refreshHouse();
    }
    function toggle(){ _on?exit():enter(); }
    function step(){
      if(!_enterTween) return;
      const g=_enterTween;
      const k=Math.min(1,(performance.now()-g.t0)/g.dur);
      const e=k<0.5? 2*k*k : 1-Math.pow(-2*k+2,2)/2;   // easeInOutQuad (matches the other flights)
      controls.target.lerpVectors(g.tFrom, g.tDest, e);
      camera.position.lerpVectors(g.cFrom, g.cDest, e);
      if(k>=1) _enterTween=null;
    }

    // ================= INTERIOR NAV PANEL (DOM) =================
    // Injected ONCE, shown only while inside (display:none otherwise). Top-centre,
    // clear of the left weather column, the right tabs panel (#inst), the bottom
    // time bar and the bottom-left compass. Styled like .panel (dark glass + gold),
    // RTL. Row 1 = floor pills; Row 2 = [Overview] + room buttons for the active floor.
    let _nav=null, _floorRowEls=null, _roomRow=null;
    function buildNav(){
      if(_nav) return _nav;
      const root=document.getElementById('ui')||document.body;
      _nav=document.createElement('div'); _nav.id='enterNav'; _nav.className='panel';
      _nav.setAttribute('dir','ltr'); _nav.style.display='none';
      // Row 1 — floor selector
      const r1=document.createElement('div'); r1.className='enRow enFloors';
      // explicit EXIT pill — leaving the dollhouse from the floating button alone was easy to miss
      const bX=document.createElement('button'); bX.type='button'; bX.className='enPill enExit'; bX.textContent='✕ Exit'; bX.title='Exit the house';
      bX.addEventListener('click',()=>exit());
      r1.appendChild(bX);
      const bUp=document.createElement('button'); bUp.type='button'; bUp.className='enPill'; bUp.dataset.floor='upper'; bUp.textContent='Upper floor';
      const bGn=document.createElement('button'); bGn.type='button'; bGn.className='enPill'; bGn.dataset.floor='ground'; bGn.textContent='Ground floor';
      bUp.addEventListener('click',()=>showFloor('upper'));
      bGn.addEventListener('click',()=>showFloor('ground'));
      r1.appendChild(bUp); r1.appendChild(bGn);
      _floorRowEls={ upper:bUp, ground:bGn };
      // Row 2 — room buttons (rebuilt per floor)
      _roomRow=document.createElement('div'); _roomRow.className='enRow enRooms';
      _nav.appendChild(r1); _nav.appendChild(_roomRow);
      root.appendChild(_nav);
      return _nav;
    }
    function rebuildRoomRow(){
      buildNav(); _roomRow.innerHTML='';
      // leading floor-overview button
      const ov=document.createElement('button'); ov.type='button'; ov.className='enPill enOver'; ov.dataset.room='__over'; ov.textContent='Overview';
      ov.addEventListener('click',()=>floorOverview());
      _roomRow.appendChild(ov);
      (ROOMS[_floor]||[]).forEach(r=>{
        const b=document.createElement('button'); b.type='button'; b.className='enPill'; b.dataset.room=r.id; b.textContent=r.he;
        b.addEventListener('click',()=>goRoom(r.id));
        _roomRow.appendChild(b);
      });
    }
    function showNav(v){ buildNav(); _nav.style.display = v ? 'flex' : 'none'; }
    // reflect active floor (solid gold) + active room highlight
    function syncNavUI(activeRoom){
      buildNav();
      if(_floorRowEls){ _floorRowEls.upper.classList.toggle('on',_floor==='upper');
        _floorRowEls.ground.classList.toggle('on',_floor==='ground'); }
      if(activeRoom!==undefined && _roomRow){
        _roomRow.querySelectorAll('.enPill').forEach(b=>b.classList.toggle('on', b.dataset.room===activeRoom));
      }
    }

    // keep the toggle button's look/label in sync (wired up in injectUI)
    function syncBtn(){
      const b=document.getElementById('enterBtn'); if(!b) return;
      b.classList.toggle('on',_on);
      b.setAttribute('aria-pressed',_on?'true':'false');
      b.innerHTML = _on ? '<span class="hg">⤴</span> Leave the house'
                        : '<span class="hg">🚪</span> Enter the house';
      b.title = _on ? 'Exit the house' : 'Enter the house — reveal the rooms';
    }
    // room plan-frame geometry by id (for the workbench's derived room-climate)
    function roomGeom(id){
      for(const fl of ['ground','upper']){ const r=(ROOMS[fl]||[]).find(x=>x.id===id); if(r) return Object.assign({floor:fl}, r); }
      return null;
    }
    return { enter, exit, toggle, step, syncBtn, showFloor, goRoom, floorOverview, roomAtLocal, roomGeom,
             refreshHeat:()=>{ try{ RoomHeat.refresh(); }catch(e){} },   // scrub-aware room-temp labels (settle-gated from frame())
             get on(){return _on;}, get floor(){return _floor;},
             get tierCounts(){return _tiers?{roof:_tiers.roof.length,upper:_tiers.upper.length,ground:_tiers.ground.length}:null;} };
  })();
  window.__enterMode=EnterMode;
  // legend for the room heat-map (toggled by RoomHeat.show/hide)
  (function heatLegend(){
    const st=document.createElement('style'); st.textContent=`
      #heatLegend{position:absolute;left:30px;bottom:360px;z-index:7;width:154px;font-family:'Heebo',sans-serif;
        color:#efe6cf;background:linear-gradient(150deg,rgba(14,16,30,.74),rgba(8,9,18,.68));backdrop-filter:blur(11px);
        border:1px solid rgba(202,161,90,.3);border-radius:8px;padding:9px 11px;box-shadow:0 16px 44px rgba(0,0,0,.42);
        text-shadow:0 1px 4px rgba(0,0,0,.7);display:none}
      #heatLegend b{font-family:'Frank Ruhl Libre',serif;font-weight:500;font-size:13px;color:#fff7e6}
      #heatLegend .grad{height:8px;border-radius:20px;margin:7px 0 3px;background:linear-gradient(90deg,#6b9ed1,#caa15a,#db6b4d)}
      #heatLegend .ends{display:flex;justify-content:space-between;font-size:9.5px;color:#a99b78}
      #heatLegend .hint{font-size:9px;color:#7d7150;margin-top:5px;line-height:1.4}
      @media(max-width:960px){#heatLegend{display:none!important}}`;
    document.head.appendChild(st);
    let el=null;
    window.__heatLegend=function(on){
      if(on&&!el){ el=document.createElement('div'); el.id='heatLegend'; el.setAttribute('dir','ltr');
        el.innerHTML='<b>Heat map · Rooms</b><div class="grad"></div>'+
          '<div class="ends"><span>Cool</span><span>Warm</span></div>'+
          '<div class="hint">Temperature estimated by exposure and floor · model</div>';
        document.body.appendChild(el); }
      if(el) el.style.display=on?'block':'none';
    };
  })();
  // make the home button / __flyHome double as "leave the house": if we're inside,
  // exit reveal mode (which itself eases the camera back out) instead of the normal fly.
  const _flyHomeBase=window.__flyHome;
  window.__flyHome=function(){ if(EnterMode.on){ EnterMode.exit(); return; } _flyHomeBase(); };

  // ====================================================================
  //  YARD SUN / SHADE OVERLAY (YardShade) — REMOVED.
  //  The per-zone shade rectangles were permanently disabled (SHOW_YARD_SHADE
  //  =false, per the developer): mispositioned for the front/back yard + floated above
  //  the ground. The proper, on-surface shade viz is the toggleable
  //  microclimate heatmap (YardGrid, below). window.__yardShade is no longer
  //  defined; the per-frame caller is guarded with `if(window.__yardShade)`.
  // ====================================================================

  // ====================================================================
  //  YARD MICROCLIMATE HEATMAP  (YardGrid) + the window.__microclimate API
  //  ------------------------------------------------------------------
  //  A fine ~0.5 m vertex-coloured ground grid over Alex's three zones,
  //  driven by the physically-grounded microclimate engine in derive.js
  //  (Derive.cellGrid / cellProfile / surfaceTemp / airDelta / tempColor).
  //  It is the spatial half of the energy panel's microclimate control
  //  (the control + readout live in panels.js → renderEnergy via this API).
  //
  //  FRAME: derive.js cellGrid() emits cell.{xL,zL,y} in the SAME house-local
  //  model coords as the YardShade overlay above (CX=BX/2, CZ=SITE_Z/2;
  //  east=+x, north=-z; y = the zone's elevation_offset_m). So we build the
  //  grid into a group placed at grp.position.set(-HCX,0,-HCZ) and added to
  //  houseWrap — IDENTICAL to YardShade — and drop each cell quad at
  //  (cell.xL, cell.y+lift, cell.zL). Because it is a houseWrap child,
  //  EnterMode's prop-hide auto-hides it inside the house (intended).
  //
  //  COLOUR: each cell is coloured by the SELECTED VARIABLE for the SELECTED
  //  SEASON. Temperature variables go through Derive.tempColor (the shared
  //  blue→red ramp); the others use per-variable ramps below. Ramp bounds are
  //  named constants (RAMP) so the user can retune once they see the render.
  //  We only recolour on variable/season change, and — for season 'live' — on
  //  the existing __thermalSig minute-gate (never every frame).
  // ====================================================================
  const YardGrid=(function(){
    const CELL_M=0.5;                       // matches derive.js cell spacing
    const LIFT=0.075;                       // float just above YardShade (0.06)
    const grp=new THREE.Group(); grp.position.set(-HCX,0,-HCZ);   // SAME frame as YardShade
    grp.renderOrder=4; grp.visible=false; houseWrap.add(grp);
    let mesh=null, colAttr=null, posAttr=null, cells=null, _placed=false, _lastPlaced=0;
    const SURF_LIFT=0.04;     // small lift above the ACTUAL surface a raycast finds (deck/terrain)
    const DOWN=new THREE.Vector3(0,-1,0);   // raycast direction for surface placement

    // ---- the variables + seasons the control offers (shared with panels.js) ----
    const VARIABLES=[
      { key:'surfaceTemp', label_he:'Surface temp', unit:'°C', temp:true },
      { key:'airDelta',    label_he:'Δ from city',  unit:'°C', signed:true },
      { key:'dli',         label_he:'Light · DLI',  unit:'mol/m²/d' },
      { key:'sunHours',    label_he:'Sun hours',     unit:'h/day' },
      { key:'frost',       label_he:'Frost risk',    unit:'0–100' },
      { key:'etc',         label_he:'Water · demand', unit:'mm/day' },
      { key:'wind',        label_he:'Wind exposure', unit:'0–1' }
    ];
    const SEASONS=[
      { key:'live',   label_he:'Now' },
      { key:'winter', label_he:'Winter' },
      { key:'spring', label_he:'Spring' },
      { key:'summer', label_he:'Summer' },
      { key:'autumn', label_he:'Autumn' }
    ];
    // Per-variable colour ramps + display bounds. Bounds are NAMED CONSTANTS so
    // the colours/legend can be retuned once the render is seen (see report).
    // Temperature variables (surfaceTemp / airDelta) defer to Derive.tempColor.
    const RAMP={
      // surfaceTemp uses a wide skin-temp window (gravel can bake well past air).
      surfaceTemp:{ min:5,   max:60,  unit:'°C',       label_he:'Surface temp' },
      // airDelta is a small signed window centred on 0 (cell vs town).
      airDelta:   { min:-3,  max:3,   unit:'°C',       label_he:'Δ air vs city' },
      dli:        { min:4,   max:45,  unit:'mol/m²/d', label_he:'Daily DLI' },
      sunHours:   { min:0,   max:12,  unit:'h/day',    label_he:'Direct sun hours' },
      frost:      { min:0,   max:100, unit:'0–100',    label_he:'Frost risk index' },
      etc:        { min:0,   max:7,   unit:'mm/day',   label_he:'Water demand (ETc)' },
      wind:       { min:0,   max:1,   unit:'0–1',      label_he:'Wind exposure' }
    };
    // simple 0..1 ramp helpers for the non-temperature variables.
    const lerp=(a,b,t)=>a+(b-a)*t;
    function lerpStops(stops,t){
      t=Math.max(0,Math.min(1,t));
      let a=stops[0], b=stops[stops.length-1];
      for(let i=0;i<stops.length-1;i++){ if(t>=stops[i][0]&&t<=stops[i+1][0]){a=stops[i];b=stops[i+1];break;} }
      const span=(b[0]-a[0])||1, k=(t-a[0])/span;
      return { r:lerp(a[1],b[1],k), g:lerp(a[2],b[2],k), b:lerp(a[3],b[3],k) };
    }
    // light → dark-amber sun ramp (DLI / sun-hours): dim blue-grey → gold → white-hot
    const SUN_STOPS=[[0,0.16,0.22,0.40],[0.4,0.55,0.55,0.40],[0.7,0.90,0.74,0.30],[1,1.0,0.97,0.80]];
    // frost: warm/safe green → cyan → deep blue (cold/at-risk)
    const FROST_STOPS=[[0,0.30,0.72,0.42],[0.45,0.30,0.78,0.85],[0.75,0.20,0.45,0.92],[1,0.10,0.16,0.74]];
    // water demand: pale → teal → deep blue (more water needed)
    const WATER_STOPS=[[0,0.86,0.84,0.62],[0.5,0.35,0.74,0.74],[1,0.10,0.32,0.78]];
    // wind exposure: sheltered green → amber → exposed red
    const WIND_STOPS=[[0,0.30,0.66,0.40],[0.5,0.90,0.74,0.30],[1,0.86,0.30,0.22]];

    function rampColor(varKey, value){
      const R=RAMP[varKey]||RAMP.surfaceTemp;
      const span=(R.max-R.min)||1;
      const t=(value-R.min)/span;
      if(varKey==='surfaceTemp'||varKey==='airDelta'){
        return Derive.tempColor(value,[R.min,R.max]);   // shared thermal ramp
      }
      if(varKey==='dli'||varKey==='sunHours') return lerpStops(SUN_STOPS,t);
      if(varKey==='frost') return lerpStops(FROST_STOPS,t);
      if(varKey==='etc')   return lerpStops(WATER_STOPS,t);
      if(varKey==='wind')  return lerpStops(WIND_STOPS,t);
      return Derive.tempColor(value,[R.min,R.max]);
    }

    // extract the scalar value for a cell+variable+season from the Derive API.
    // season 'live' uses live surfaceTemp/airDelta at `date`; other variables in
    // 'live' fall back to the current-season cached profile (they're daily
    // integrals — sun-hours/DLI/frost/etc — that have no instantaneous value).
    function liveSeasonKey(date){
      const m=date.getMonth();
      return (m===11||m<2)?'winter':m<5?'spring':m<8?'summer':'autumn';
    }
    function cellValue(cell, varKey, season, date){
      if(varKey==='surfaceTemp'){
        if(season==='live') return Derive.surfaceTemp(cell.normal,date,{ cell, material:'gravel' });
        const p=Derive.cellProfile(cell,season); return p?p.Tpeak:null;
      }
      if(varKey==='airDelta'){
        if(season==='live'){ const a=Derive.airDelta(cell,date); return a?a.delta:null; }
        const p=Derive.cellProfile(cell,season); return p?p.dAir:null;
      }
      const seas=(season==='live')?liveSeasonKey(date):season;
      const p=Derive.cellProfile(cell,seas); if(!p) return null;
      if(varKey==='dli')      return p.DLI;
      if(varKey==='sunHours') return p.sunHours;
      if(varKey==='frost')    return p.frost?Math.max(60,Math.round(60+(0-(p.frostTdawn!=null?p.frostTdawn:p.Tdawn))*8)):Math.round(Math.max(0,Math.min(55,(6-(p.frostTdawn!=null?p.frostTdawn:p.Tdawn))*7)));
      if(varKey==='etc')      return p.ETc;
      if(varKey==='wind')     return p.exposure;
      return null;
    }

    // build the BufferGeometry once: two triangles per cell (a flat XZ quad of
    // CELL_M, centred on the cell). One mesh, one draw call, vertex-coloured.
    function build(){
      cells=Derive.cellGrid()||[];
      if(!cells.length) return;
      const n=cells.length;
      const positions=new Float32Array(n*6*3);     // 6 verts/quad
      const colors=new Float32Array(n*6*3);
      for(let i=0;i<n;i++){
        const c=cells[i], x=c.xL, y=(c.y||0)+LIFT, z=c.zL, h=(c.cellM||CELL_M)/2;   // per-cell size — ambient ground cells are coarser (1.5 m) than zone cells (0.5 m)
        // quad corners in XZ (flat, up-facing); two CCW triangles
        const v=[ [x-h,y,z-h],[x+h,y,z-h],[x+h,y,z+h], [x-h,y,z-h],[x+h,y,z+h],[x-h,y,z+h] ];
        for(let k=0;k<6;k++){ const o=(i*6+k)*3;
          positions[o]=v[k][0]; positions[o+1]=v[k][1]; positions[o+2]=v[k][2];
          colors[o]=0.4; colors[o+1]=0.5; colors[o+2]=0.6; }
      }
      const geo=new THREE.BufferGeometry();
      posAttr=new THREE.BufferAttribute(positions,3); geo.setAttribute('position',posAttr);
      colAttr=new THREE.BufferAttribute(colors,3); geo.setAttribute('color',colAttr);
      const mat=new THREE.MeshBasicMaterial({ vertexColors:true, transparent:true,
        opacity:0.82, side:THREE.DoubleSide, depthWrite:false });
      mat.toneMapped=false;
      mesh=new THREE.Mesh(geo,mat); mesh.renderOrder=5; grp.add(mesh);
      placeOnSurface();   // drop each cell quad onto the REAL surface beneath it (deck/terrain)
    }

    // ---- DROP EACH CELL ONTO THE REAL SURFACE BENEATH IT (render placement only) ----
    // The grid is built in grp's local frame (cell.xL, cell.zL) where Y was the zone's
    // SURVEYED elevation_offset_m (site.json) — but the BUILT deck sits a bit lower than
    // the surveyed balcony, and ground cells were dropped at y≈0 regardless of the real
    // terrain height. So the patches floated off the surfaces. Here we, ONCE (static),
    // raycast DOWNWARD in WORLD space from well above each cell against [the house group
    // + the terrain mesh + the central aerial patch], take the TOPMOST hit, and rewrite
    // that cell's quad Y to the hit height (+ a small lift) — converted back into grp's
    // local frame. Balcony cells land on the deck; backyard/front cells land on the
    // terrain. The XZ frame is already identical to the house/garden (grp & house share
    // position (-HCX,0,-HCZ) under the same houseWrap yaw+drop), so X/Z are untouched —
    // only Y/height changes. derive.js's physics elevation (cell.y) is left untouched.
    const _rc=new THREE.Raycaster(); _rc.far=400;
    const _wOrig=new THREE.Vector3(), _wHit=new THREE.Vector3();
    function placeOnSurface(){
      if(!mesh||!posAttr||!cells) return false;
      // surfaces to raycast against: the detailed house (a Group of meshes) + the
      // real terrain mesh + the crisp central aerial patch over the house area.
      // GROUND cells (backyard/front) raycast the TERRAIN ONLY — open ground with no
      // house above; including the house made the ray grab a low eave/overhang (a
      // backyard cell was landing at y≈2.7). ELEVATED terrace cells raycast the HOUSE
      // (their surface IS the deck).
      const terr=scene.getObjectByName('terrain');
      const cen=scene.getObjectByName('central');
      const groundTargets=[]; if(terr) groundTargets.push(terr); if(cen) groundTargets.push(cen);
      const houseTargets=house?[house]:[];
      // need the terrain (or central) present for ground heights. If neither exists yet
      // (terrain loads async), bail; the readiness poll re-runs this once they appear.
      if(!terr && !cen) return false;
      // make sure world matrices are current: houseWrap drops to the terrain height in
      // Terrain.load's callback, and that drop must be baked before we localToWorld.
      houseWrap.updateWorldMatrix(true,true);
      grp.updateWorldMatrix(true,true);
      const arr=posAttr.array;
      let placedCount=0;
      const diag={};   // per-zone: {old:surveyedLocalY, new:placedLocalY, worldY, n}
      for(let i=0;i<cells.length;i++){
        const c=cells[i];
        const elevated=(c.y||0)>=1.0;   // terrace/balcony deck cell vs ground cell
        // ELEVATED: start the ray JUST above the nominal deck so the first surface DOWN
        // is the deck (~3.0), NOT the roof/parapet (~5.5) higher up. GROUND: start high
        // and hit the terrain. Use the matching target set (house vs terrain).
        _wOrig.set(c.xL, elevated ? (c.y||0)+0.6 : (c.y||0)+30, c.zL);
        grp.localToWorld(_wOrig);
        _rc.set(_wOrig, DOWN);
        const hits=_rc.intersectObjects(elevated?houseTargets:groundTargets,true);
        if(!hits.length) continue;            // no surface under this cell → keep prior Y
        // hits are distance-sorted; nearest from above is the intended surface.
        const worldY=hits[0].point.y;
        _wHit.copy(hits[0].point);
        grp.worldToLocal(_wHit);              // back into the grid group's local frame
        // ground cells must not sink below the visible gravel apron (~0.01) — the bare
        // terrain east of the house dips below it, which would BURY the backyard grid.
        const yL=(elevated ? _wHit.y : Math.max(_wHit.y, 0)) + SURF_LIFT;
        for(let k=0;k<6;k++){ arr[(i*6+k)*3+1]=yL; }   // rewrite the 6 verts' Y for this cell
        placedCount++;
        // record a representative sample per zone for the placement report
        const z=c.zoneId||'?'; if(!diag[z]) diag[z]={ old:+(c.y||0).toFixed(3), localY:+yL.toFixed(3), worldY:+worldY.toFixed(3), n:0 }; diag[z].n++;
      }
      posAttr.needsUpdate=true;
      mesh.geometry.computeBoundingSphere();
      if(placedCount>0){ _placed=true; _lastPlaced=placedCount; window.__mcPlaceInfo=diag;
        try{ console.log('[microclimate] yard heatmap placed on surface — per-zone (surveyed local y → placed local y / hit world y):', diag); }catch(e){} }
      return placedCount>0;
    }

    // recolour every cell for the active variable+season at `date`. Cheap enough
    // to run on a control change or the live minute-gate (one Derive lookup/cell;
    // the seasonal table is cached in derive.js after its first ~0.56 s bake).
    function recolor(varKey, season, date){
      if(!mesh||!colAttr||!cells) return;
      const arr=colAttr.array;
      for(let i=0;i<cells.length;i++){
        let val=cellValue(cells[i],varKey,season,date);
        if(val==null||!isFinite(val)) val=RAMP[varKey]?RAMP[varKey].min:0;
        const col=rampColor(varKey,val);
        for(let k=0;k<6;k++){ const o=(i*6+k)*3; arr[o]=col.r; arr[o+1]=col.g; arr[o+2]=col.b; }
      }
      colAttr.needsUpdate=true;
    }
    function setVisible(v){ grp.visible=!!v; }

    // build once Derive's grid/site data is ready (derive.js loads after app.js).
    let _ready=false;
    (function waitForDerive(tries){
      if(window.Derive&&window.Derive.ready){
        window.Derive.ready.then(()=>{ if(!mesh) build(); _ready=true;
          if(window.__microclimate&&window.__microclimate.isOn()) window.__microclimate._refresh(true);
        }).catch(()=>{});
      } else if((tries||0)<200){ setTimeout(()=>waitForDerive((tries||0)+1),50); }
    })(0);
    // Terrain loads async (its own image onload), independently of Derive.ready, and
    // houseWrap only drops to the terrain height inside Terrain.load's callback. If the
    // first placeOnSurface() (in build) ran before the terrain mesh existed / before the
    // drop, it bailed (kept the provisional surveyed Y). Re-run it ONCE the terrain mesh
    // is in the scene AND the houseWrap drop has happened — a one-shot, so it stays static.
    (function waitForSurfaces(tries){
      if(mesh && !_placed && scene.getObjectByName('terrain') && houseWrap.position.y!==0){
        if(placeOnSurface()){
          if(window.__microclimate && window.__microclimate.isOn()) window.__microclimate._refresh(true);
          return;   // placed — done (static)
        }
      }
      if((tries||0)<400) setTimeout(()=>waitForSurfaces((tries||0)+1),60);
    })(0);

    return { build, recolor, setVisible, placeOnSurface, get ready(){return _ready;},
             get placed(){return _placed;}, get lastPlaced(){return _lastPlaced;},
             get count(){return cells?cells.length:0;}, VARIABLES, SEASONS, RAMP };
  })();

  // documentElement alias — declared BEFORE the __microclimate IIFE that uses it
  // (moved up from its old spot further down) to avoid a temporal-dead-zone crash
  // at load. The time/weather state below reuse this same const.
  const D=document.documentElement;
  // ---- window.__microclimate — the contract panels.js consumes ----
  // Owns the on/off + variable + season state (persisted on documentElement
  // .dataset.mcOn / .mcVar / .mcSeason so a preview re-run keeps it). Drives
  // BOTH the YardGrid heatmap AND (for temperature variables) Building.setThermal
  // so the house surfaces colour alongside the yard. Default state: OFF.
  (function(){
    if(D.dataset.mcOn===undefined) D.dataset.mcOn='0';          // default OFF
    if(D.dataset.mcVar===undefined) D.dataset.mcVar='surfaceTemp';
    if(D.dataset.mcSeason===undefined) D.dataset.mcSeason='live';
    const isTempVar=k=>(k==='surfaceTemp'||k==='airDelta');
    function legend(){
      const k=D.dataset.mcVar||'surfaceTemp';
      const R=YardGrid.RAMP[k]||YardGrid.RAMP.surfaceTemp;
      return { min:R.min, max:R.max, unit:R.unit, label_he:R.label_he, variable:k };
    }
    // DECOUPLED RECOMPUTE — the yard recolour is cheap (~few ms, one Derive lookup
    // per cell) and the per-vertex HOUSE thermal (Building.setThermal) is the ~31 ms
    // cost. They used to run on the SAME debounced live tick, so continuous PLAY
    // hitched every recompute. So we split them:
    //   • refreshYard()  — on/off visibility + the cheap yard recolour. Runs on every
    //       debounced live tick so the ground/balcony sweep stays smooth.
    //   • refreshHouse() — the expensive per-vertex house thermal. The render loop
    //       only calls this when the timeline is SETTLED (not actively playing /
    //       fast-scrubbing), so PLAY holds its last colours (no 31 ms hitch); it
    //       catches up the moment play pauses / the scrub is released.
    //   • refresh()      — both, immediately (control changes: on/off / variable /
    //       season — those aren't continuous play, so a single full recompute is fine).
    // refreshYard() also owns the OFF teardown (hide the grid AND restore the house
    // thermal) so turning the layer off fully cleans up regardless of the house gate.
    function refreshYard(){
      if(D.dataset.mcOn!=='1'){ YardGrid.setVisible(false);
        if(window.Building&&Building.setThermal&&window.__mcThermalOn){ Building.setThermal(false); window.__mcThermalOn=false; }
        return;
      }
      const varKey=D.dataset.mcVar||'surfaceTemp';
      const season=D.dataset.mcSeason||'live';
      const date=(window.__mcDate||window.__wxDate||new Date());
      YardGrid.setVisible(true);
      YardGrid.recolor(varKey,season,date);
    }
    // the EXPENSIVE half: per-vertex house thermal. No-op when OFF (refreshYard's
    // teardown already restored it). Follows the house ONLY for temperature variables;
    // for a non-temp variable it restores the house to its normal materials.
    function refreshHouse(){
      if(D.dataset.mcOn!=='1') return;                 // OFF teardown handled by refreshYard
      if(!(window.Building&&Building.setThermal)) return;
      const varKey=D.dataset.mcVar||'surfaceTemp';
      const date=(window.__mcDate||window.__wxDate||new Date());
      if(isTempVar(varKey)){ const r=Building.setThermal(true,date); window.__mcThermalOn=true;
        if(window.__updateThermalLegend) window.__updateThermalLegend(r); }
      else if(window.__mcThermalOn){ Building.setThermal(false); window.__mcThermalOn=false; }
    }
    // full recompute (yard + house) for a control change / on-off / build — immediate.
    function refresh(){ refreshYard(); refreshHouse(); }
    window.__microclimate={
      setOn(b){ D.dataset.mcOn=b?'1':'0'; window.__mcOn=!!b; refresh();
        if(window.__onMicroclimateChange) window.__onMicroclimateChange(); },
      isOn(){ return D.dataset.mcOn==='1'; },
      setVariable(k){ if(!YardGrid.RAMP[k]) return; D.dataset.mcVar=k; refresh();
        if(window.__onMicroclimateChange) window.__onMicroclimateChange(); },
      getVariable(){ return D.dataset.mcVar||'surfaceTemp'; },
      setSeason(k){ D.dataset.mcSeason=k; refresh();
        if(window.__onMicroclimateChange) window.__onMicroclimateChange(); },
      getSeason(){ return D.dataset.mcSeason||'live'; },
      VARIABLES:YardGrid.VARIABLES, SEASONS:YardGrid.SEASONS,
      legend, isTempVar(){ return isTempVar(D.dataset.mcVar||'surfaceTemp'); },
      // internal: render-loop live-gate + post-build refresh.
      //   _refresh      — full recompute (yard + house), for control changes / build.
      //   _refreshYard  — cheap yard recolour only (the smooth live sweep).
      //   _refreshHouse — expensive per-vertex house thermal only (gated by play-state
      //                   in the render loop so continuous PLAY never hitches).
      _refresh:refresh, _refreshYard:refreshYard, _refreshHouse:refreshHouse,
      _liveSurfaceVar(){ return D.dataset.mcSeason==='live'; }
    };
    window.__mcOn=(D.dataset.mcOn==='1');
  })();

  // ====================================================================
  //  SPATIAL iNaturalist SIGHTINGS  (the Nature tab, made spatial)
  //  Each live sighting from Derive.fetchSightings() carries its REAL
  //  lon/lat; we place a small pin/billboard at that real world position
  //  around the house — SAME frame as the terrain (+x=E, +z=S; 1 unit = 1 m,
  //  see terrain.js EX=4000/4 km) — clamped to the terrain surface via
  //  Terrain.sampleHeight. Each pin is tinted by its iconic taxon (plant=green,
  //  bird=blue, insect=amber, …). The group is added to `scene` (NOT houseWrap,
  //  whose 5° yaw + drop is house-only) so geo points land truthfully on the
  //  ground. An "Observations" switch in the layer panel toggles the group. Pins are
  //  raycast-clickable → __flyToGround(lng,lat) + surface the sighting name.
  //  Markers are rebuilt whenever the live fetch resolves (see refresh()).
  // ====================================================================
  const Sightings=(function(){
    const grp=new THREE.Group(); grp.renderOrder=6; scene.add(grp);
    // iconic-taxon → pin colour (iNaturalist iconic_taxon_name values)
    const TINT={ Plantae:0x6fcf73, Aves:0x4aa3e8, Insecta:0xe8b24a, Arachnida:0xe09a4a,
      Reptilia:0x9bd14a, Amphibia:0x4ad1b0, Mammalia:0xd98a6a, Mollusca:0xc58ad9,
      Fungi:0xd96a9a, Actinopterygii:0x4ad1d1 };
    const DEF=0xcaa15a;
    let pins=[];   // {grp, sprite, sighting, base(Vector3)}
    // a soft round dot texture for the billboard head (cached once)
    let _dotTex=null;
    function dotTex(){
      if(_dotTex) return _dotTex;
      const c=document.createElement('canvas'); c.width=c.height=64; const x=c.getContext('2d');
      const g=x.createRadialGradient(32,32,2,32,32,30);
      g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.35,'rgba(255,255,255,0.95)');
      g.addColorStop(1,'rgba(255,255,255,0)');
      x.fillStyle=g; x.beginPath(); x.arc(32,32,30,0,7); x.fill();
      _dotTex=new THREE.CanvasTexture(c); _dotTex.needsUpdate=true; return _dotTex;
    }
    function worldOf(s){
      const x=(s.lng-(-40.0))*_MPD_LON, z=-(s.lat-34.0)*_MPD_LAT;
      let y=0.6; if(window.Terrain&&Terrain.sampleHeight)
        y=Terrain.sampleHeight(x,z)+(houseWrap?houseWrap.position.y:0);
      return new THREE.Vector3(x,y,z);
    }
    function makePin(s){
      const col=new THREE.Color(TINT[s.iconic]||DEF);
      const pg=new THREE.Group();
      // thin vertical stem so the pin reads as standing on the ground
      const stemH=2.4;
      const stemMat=new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.85,depthWrite:false});
      stemMat.toneMapped=false;
      const stem=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,stemH,6),stemMat);
      stem.position.y=stemH/2; pg.add(stem);
      // glowing head billboard (sprite always faces the camera)
      const sm=new THREE.SpriteMaterial({map:dotTex(),color:col,transparent:true,
        depthTest:true,depthWrite:false}); sm.toneMapped=false;
      const head=new THREE.Sprite(sm); head.scale.set(2.0,2.0,1); head.position.y=stemH+0.4;
      pg.add(head);
      const base=worldOf(s); pg.position.copy(base);
      pg.userData.sighting=s;
      grp.add(pg);
      pins.push({grp:pg, head, stem, sighting:s, base});
    }
    function clear(){ pins.forEach(p=>grp.remove(p.grp)); pins=[]; }
    // (re)build from a fresh sightings array (only those with real coords)
    function setData(list){
      clear(); _reclamped=false;   // force a terrain re-clamp on the next ready frame
      (list||[]).forEach(s=>{ if(s&&isFinite(s.lng)&&isFinite(s.lat)) makePin(s); });
    }
    // keep heads a roughly-constant on-screen size so far pins stay visible, and
    // (re-)clamp Y to terrain once the heightmap has loaded (it loads async, so an
    // early build may have used the flat fallback height).
    let _reclamped=false;
    function update(date){
      if(!grp.visible||!pins.length) return;
      if(!_reclamped && window.Terrain && Terrain.sampleHeight){
        pins.forEach(p=>{ p.base.copy(worldOf(p.sighting)); p.grp.position.copy(p.base); });
        _reclamped=true;
      }
      const camP=camera.position;
      pins.forEach(p=>{
        const d=p.grp.position.distanceTo(camP);
        const s=THREE.MathUtils.clamp(d*0.018, 1.4, 26);   // ~constant angular size
        p.head.scale.set(s,s,1);
        p.stem.scale.set(1,1,1);
      });
    }
    function setVisible(v){ grp.visible=v; }
    // pull the live sightings (same source the Nature tab lists) and build pins.
    // Re-runnable so panels.js / a refresh can rebuild from the latest fetch.
    function refresh(radiusKm){
      if(!(window.Derive&&Derive.fetchSightings)) return Promise.resolve([]);
      return Derive.fetchSightings(radiusKm||15).then(list=>{
        window.__sightingsData=list||[]; setData(list||[]); return list||[];
      }).catch(()=>[]);
    }
    // raycast click on the scene → if a pin (or its parts) was hit, fly there.
    const _ray=new THREE.Raycaster(), _ndc=new THREE.Vector2();
    function pinAt(clientX, clientY){
      if(!grp.visible||!pins.length) return null;
      _ndc.x=(clientX/innerWidth)*2-1; _ndc.y=-(clientY/innerHeight)*2+1;
      _ray.setFromCamera(_ndc,camera);
      // sprites + meshes both intersect; recurse the pin group
      const hits=_ray.intersectObjects(grp.children,true);
      if(!hits.length) return null;
      let o=hits[0].object; while(o&&!o.userData.sighting) o=o.parent;
      return o?o.userData.sighting:null;
    }
    return { setData, refresh, update, setVisible, pinAt, get count(){return pins.length;} };
  })();
  window.__sightings=Sightings;
  // kick the first fetch once Derive (and ideally the terrain) are around; pins
  // re-clamp to the surface on the first frame Terrain.sampleHeight is ready.
  (function loadSightings(t){
    if(window.Derive&&Derive.fetchSightings){ Sightings.refresh(15); }
    else if((t||0)<200) setTimeout(()=>loadSightings((t||0)+1),60);
  })(0);
  // canvas click → fly to a clicked sighting pin (mirrors the list-row click).
  // Uses a tiny drag threshold so orbiting (drag) never triggers a fly.
  (function wireSightingClicks(){
    let dx0=0,dy0=0,down=false;
    canvas.addEventListener('pointerdown',e=>{ down=true; dx0=e.clientX; dy0=e.clientY; });
    canvas.addEventListener('pointerup',e=>{
      if(!down) return; down=false;
      if(Math.hypot(e.clientX-dx0,e.clientY-dy0)>5) return;   // it was a drag/orbit
      const s=Sightings.pinAt(e.clientX,e.clientY);
      if(s&&isFinite(s.lng)&&isFinite(s.lat)){
        window.__flyToGround(s.lng,s.lat);
        if(window.__onSightingPicked) window.__onSightingPicked(s);   // let panels.js surface it
      }
    });
  })();
  // ROOM PICK — while inside the house (EnterMode), a click (not a drag) on a
  // room's floor/wall raycasts the house, converts the hit to house-LOCAL coords,
  // and selects that room → frames it + opens its in-world workbench (Approach A).
  // Hidden meshes (roof/other floor) are skipped by the raycaster, so the hit is
  // on the visible floor you clicked. Sightings pins are hidden inside, so the two
  // click handlers never conflict.
  (function wireRoomClicks(){
    const _rr=new THREE.Raycaster(), _rn=new THREE.Vector2(); let rx=0,ry=0,rdown=false;
    canvas.addEventListener('pointerdown',e=>{ rdown=true; rx=e.clientX; ry=e.clientY; });
    canvas.addEventListener('pointerup',e=>{
      if(!rdown) return; rdown=false;
      if(!window.__enterMode||!window.__enterMode.on) return;
      if(Math.hypot(e.clientX-rx,e.clientY-ry)>5) return;            // drag/orbit, not a click
      _rn.x=(e.clientX/innerWidth)*2-1; _rn.y=-(e.clientY/innerHeight)*2+1;
      _rr.setFromCamera(_rn,camera);
      const hits=_rr.intersectObject(house,true);
      if(!hits.length) return;
      const lp=house.worldToLocal(hits[0].point.clone());
      const id=window.__enterMode.roomAtLocal(lp.x,lp.z);
      if(id) window.__enterMode.goRoom(id);
    });
  })();

  // ====================================================================
  //  GARDEN PLANT MARKERS (GardenPins)  — Phase 2 of Approach A
  //  ------------------------------------------------------------------
  //  Billboarded plant markers sitting on the REAL garden surface. The
  //  plant DATA + tracking card live in garden.js (DOM); this is the scene
  //  half (mirrors Sightings + YardGrid): a houseWrap-child group in the
  //  SAME local frame as YardGrid/YardShade (grp at -HCX,0,-HCZ), each
  //  marker a Sprite (emoji on a gold-ringed disc) dropped onto the actual
  //  surface — the deck for balcony, the terrain for backyard/front — by a
  //  downward raycast (same logic as the heatmap's placeOnSurface). Click →
  //  window.__garden.open(id). Auto-hidden inside the house (prop-hide).
  // ====================================================================
  const GardenPins=(function(){
    const grp=new THREE.Group(); grp.position.set(-HCX,0,-HCZ); grp.renderOrder=6; houseWrap.add(grp);
    let data=[]; const sprites=[];
    const _rc=new THREE.Raycaster(); _rc.far=400; const DOWN=new THREE.Vector3(0,-1,0);
    const _o=new THREE.Vector3(), _h=new THREE.Vector3(), _ndc=new THREE.Vector2();
    function tex(emoji){
      const s=128, cv=document.createElement('canvas'); cv.width=cv.height=s; const x=cv.getContext('2d');
      x.beginPath(); x.arc(s/2,s/2,s*0.40,0,Math.PI*2); x.fillStyle='rgba(10,12,22,0.82)'; x.fill();
      x.lineWidth=s*0.06; x.strokeStyle='#caa15a'; x.stroke();
      x.font=Math.round(s*0.5)+'px serif'; x.textAlign='center'; x.textBaseline='middle';
      x.fillText(emoji||'🌱', s/2, s*0.55);
      const t=new THREE.CanvasTexture(cv); t.anisotropy=4; return t;
    }
    function clear(){ sprites.forEach(s=>{ grp.remove(s); if(s.material.map)s.material.map.dispose(); s.material.dispose(); }); sprites.length=0; }
    function rebuild(){
      clear();
      data.forEach(p=>{
        const m=new THREE.SpriteMaterial({ map:tex(p.emoji), transparent:true, depthWrite:false });
        m.toneMapped=false;
        const sp=new THREE.Sprite(m); sp.scale.set(0.92,0.92,0.92); sp.renderOrder=7;
        sp.userData.plantId=p.id; sp.position.set(p.xL,(p.baseY||0)+0.5,p.zL); grp.add(sp); sprites.push(sp);
      });
      _ensurePlaced();
    }
    function setData(list){ data=list||[]; rebuild(); }
    function placeOnSurface(){
      const terr=scene.getObjectByName('terrain'), cen=scene.getObjectByName('central');
      const groundTargets=[]; if(terr)groundTargets.push(terr); if(cen)groundTargets.push(cen);
      const houseTargets=house?[house]:[];
      if(!terr&&!cen) return false;
      houseWrap.updateWorldMatrix(true,true); grp.updateWorldMatrix(true,true);
      sprites.forEach((sp,i)=>{
        const p=data[i]; if(!p) return; const elevated=!!p.elevated;
        _o.set(p.xL, elevated?(p.baseY||0)+0.6:(p.baseY||0)+30, p.zL); grp.localToWorld(_o);
        _rc.set(_o,DOWN);
        const hits=_rc.intersectObjects(elevated?houseTargets:groundTargets,true);
        if(!hits.length) return;
        _h.copy(hits[0].point); grp.worldToLocal(_h);
        sp.position.y=(elevated?_h.y:Math.max(_h.y,0))+0.45;   // float ~0.45 m above the surface
      });
      return true;
    }
    let _tries=0;
    function _ensurePlaced(){ if(placeOnSurface()) return; if(_tries++<200) setTimeout(_ensurePlaced,80); }
    function pinAt(cx,cy){
      if(!grp.visible||!sprites.length) return null;
      _ndc.x=(cx/innerWidth)*2-1; _ndc.y=-(cy/innerHeight)*2+1; _rc.setFromCamera(_ndc,camera);
      const hits=_rc.intersectObjects(sprites,true);
      if(!hits.length) return null;
      let o=hits[0].object; while(o&&!o.userData.plantId) o=o.parent;
      return o?o.userData.plantId:null;
    }
    function setVisible(v){ grp.visible=!!v; }
    function spriteFor(id){ for(const s of sprites) if(s.userData.plantId===id) return s; return null; }
    //  DRAG: raycast the cursor onto the garden surface (ground/deck), move that
    //  sprite there live, and return its new LOCAL (xL,zL) — the same frame the
    //  microclimate cell-grid uses. Prefers up-facing hits so a plant lands on a
    //  floor/deck/terrain, never on a wall or a roof slope.
    function dragTo(id,cx,cy){
      const sp=spriteFor(id); if(!sp) return null;
      const terr=scene.getObjectByName('terrain'), cen=scene.getObjectByName('central');
      const targets=[]; if(terr)targets.push(terr); if(cen)targets.push(cen); if(house)targets.push(house);
      if(!targets.length) return null;
      _ndc.x=(cx/innerWidth)*2-1; _ndc.y=-(cy/innerHeight)*2+1; _rc.setFromCamera(_ndc,camera);
      const hits=_rc.intersectObjects(targets,true); if(!hits.length) return null;
      let hit=null;
      for(const h of hits){ const n=h.face&&h.face.normal;
        if(!n){ hit=h; break; }
        const wn=n.clone().transformDirection(h.object.matrixWorld);
        if(wn.y>0.45){ hit=h; break; } }      // up-facing surface
      if(!hit) hit=hits[0];
      _h.copy(hit.point); grp.worldToLocal(_h);
      sp.position.set(_h.x, _h.y+0.45, _h.z);
      return { xL:+_h.x.toFixed(3), zL:+_h.z.toFixed(3) };
    }
    return { setData, rebuild, placeOnSurface, pinAt, spriteFor, dragTo, setVisible, get count(){return sprites.length;} };
  })();
  window.__gardenPins=GardenPins;
  //  GARDEN MARKER interaction (only OUTSIDE the house):
  //   • press a marker and release without moving  → open its card (click)
  //   • press a marker and drag                     → reposition it to the exact
  //     spot; on drop we persist (xL,zL) and the plant reads THAT cell's climate.
  //  Pressing a marker freezes OrbitControls so the camera doesn't orbit; pressing
  //  empty space leaves orbit untouched. A grab cursor hints the marker is draggable.
  (function wireGardenDrag(){
    let armed=null, sx=0, sy=0, dragging=false; const DRAG_PX=5;
    const inside=()=>!!(window.__enterMode&&window.__enterMode.on);
    canvas.addEventListener('pointerdown',e=>{
      if(inside()||e.button!==0) return;
      const id=GardenPins.pinAt(e.clientX,e.clientY); if(!id) return;   // not on a marker → normal orbit
      armed=id; sx=e.clientX; sy=e.clientY; dragging=false;
      controls.enabled=false;                                          // freeze camera while pressing a marker
    });
    canvas.addEventListener('pointermove',e=>{
      if(!armed){                                                      // idle hover affordance
        if(inside()||e.buttons) return;
        canvas.style.cursor = GardenPins.pinAt(e.clientX,e.clientY) ? 'grab' : '';
        return;
      }
      if(!dragging && Math.hypot(e.clientX-sx,e.clientY-sy)>DRAG_PX){ dragging=true; canvas.style.cursor='grabbing'; }
      if(dragging) GardenPins.dragTo(armed,e.clientX,e.clientY);
    });
    function release(e){
      if(!armed) return;
      const id=armed; armed=null; controls.enabled=true; canvas.style.cursor='';
      if(dragging){ dragging=false;
        const pos=GardenPins.dragTo(id,e.clientX,e.clientY);
        if(pos&&window.__garden&&window.__garden.setPos) window.__garden.setPos(id,pos.xL,pos.zL);
      } else if(window.__garden&&window.__garden.open){ window.__garden.open(id); }   // click → card
    }
    canvas.addEventListener('pointerup',release);
    canvas.addEventListener('pointercancel',()=>{ if(armed){ armed=null; dragging=false; controls.enabled=true; canvas.style.cursor=''; } });
  })();

  // ====================================================================
  //  COMPASS + MOON-FINDER HUD
  //  A small dark-glass/gold compass rose (corner overlay) that shows which
  //  way the CAMERA faces, plus celestial bearings (moon, sun, bright planets)
  //  laid on the rose, plus a moon-finder: when the moon is below the horizon
  //  OR off the screen, a clear arrow + label points toward its azimuth and
  //  (when it's down) shows its next RISE time.
  //
  //  WORLD-FRAME CONVENTION (fixed, from astro.js vec(az,alt)):
  //    +x = East, +z = South  ⇒  North = −z.  Compass bearing is measured
  //    clockwise from North: N=0°, E=90°, S=180°, W=270°.
  //  Camera VIEW heading = bearing of (controls.target − camera.position)
  //    projected on the XZ plane:  heading = atan2(dir.x, −dir.z)  (degrees).
  //  Astro azDeg uses the SAME 0°=N / 90°=E clockwise convention, so a body's
  //  position ON the rose is simply its azDeg, and its on-screen direction
  //  relative to where the user looks is (azDeg − heading).
  //  The rose is rotated by −heading so the cardinal the camera faces sits at
  //  the TOP; a body then sits at screen-angle (azDeg − heading) from the top.
  // ====================================================================
  const Compass=(function(){
    const SIZE=128, dpr=Math.min(devicePixelRatio||1,2);
    // build DOM: HUD wrap (rose canvas + readout)
    const wrap=document.createElement('div'); wrap.id='compass';
    const cv=document.createElement('canvas'); cv.id='compassRose';
    cv.width=SIZE*dpr; cv.height=SIZE*dpr; cv.style.width=cv.style.height=SIZE+'px';
    const read=document.createElement('div'); read.id='compassRead';
    wrap.appendChild(cv); wrap.appendChild(read);
    // append once the UI root exists (injectUI runs slightly later); poll briefly.
    // Positioned BOTTOM-LEFT (see #compass CSS) — moved there from bottom-right
    // because the long right-side Sky tab panel overlapped/hid it. The moon-finder
    // pointer on the rose + the readout below it carry the moon bearing/rise info;
    // the fuller moon block now also lives in the Sky tab (panels.js).
    (function attach(t){ const root=document.getElementById('ui');
      if(root){ root.appendChild(wrap); }
      else if((t||0)<200) setTimeout(()=>attach((t||0)+1),40); })(0);
    const x=cv.getContext('2d');

    // cardinal labels: N=north, E=east, S=south, W=west
    const CARD=[{b:0,t:'N'},{b:90,t:'E'},{b:180,t:'S'},{b:270,t:'W'}];
    const TICKS=[0,45,90,135,180,225,270,315];
    const D2R=Math.PI/180;

    // --- bearing helpers (world frame: N=−z=0°, E=+x=90°) ---
    const _v=new THREE.Vector3();
    function viewHeading(){
      _v.copy(controls.target).sub(camera.position);   // look direction
      if(_v.x*_v.x+_v.z*_v.z<1e-9) return lastHeading;  // looking straight up/down → keep last
      let b=Math.atan2(_v.x,-_v.z)/D2R;                 // +x=E→90, −z=N→0
      return ((b%360)+360)%360;
    }

    // --- next moonrise: forward-scan Astro.moon().altDeg for the up-crossing ---
    // (mirrors panels.js's moonRiseSet, but only forward from `date`, up to 48h,
    //  so it still finds a rise that falls after midnight). Returns "HH:MM" (local
    //  time, DST-aware via ilMinutes) or null.
    let riseCache={key:'',val:null};
    function nextMoonrise(date){
      if(!window.Astro) return null;
      const key=Math.floor(date.getTime()/600000);     // recompute at most every ~10 min of model time
      if(riseCache.key===key) return riseCache.val;
      let prev=Astro.moon(date).altDeg, out=null;
      for(let m=10;m<=48*60;m+=10){
        const t=new Date(date.getTime()+m*60000), a=Astro.moon(t).altDeg;
        if(prev<0 && a>=0){ out=fmtHM(ilMinutes(t)); break; }
        prev=a;
      }
      riseCache={key,val:out}; return out;
    }

    // --- is the moon currently on-screen? project its sky direction with the camera ---
    const _m=new THREE.Vector3();
    function moonOnScreen(Mo){
      if(!Mo||Mo.altDeg<=0) return false;               // below horizon → never "on screen"
      _m.set(Mo.dir.x,Mo.dir.y,Mo.dir.z).multiplyScalar(1000).add(camera.position).project(camera);
      if(_m.z>=1) return false;                         // behind camera
      const pad=0.04;                                   // small margin so edge-of-screen still triggers the finder
      return _m.x>=-1+pad && _m.x<=1-pad && _m.y>=-1+pad && _m.y<=1-pad;
    }

    // --- draw the rose; only called when heading/moon bearing/state changed enough ---
    let lastHeading=0, lastMoonAz=999, lastMoonUp=null;
    function drawRose(heading, bodies, moonAz, moonUp){
      x.setTransform(dpr,0,0,dpr,0,0); x.clearRect(0,0,SIZE,SIZE);
      const c=SIZE/2, R=SIZE*0.40;
      // glass disc
      x.beginPath(); x.arc(c,c,R+8,0,7);
      x.fillStyle='rgba(10,12,24,0.62)'; x.fill();
      x.lineWidth=1; x.strokeStyle='rgba(202,161,90,0.45)'; x.stroke();
      // rotate so the heading sits at TOP: screen-angle of bearing b = (b − heading)
      const ang=b=>(b-heading-90)*D2R;                  // −90 so 0° lands at top (−y)
      // tick marks
      x.strokeStyle='rgba(202,161,90,0.5)';
      TICKS.forEach(t=>{ const a=ang(t), inr=R-(t%90===0?9:5);
        x.beginPath(); x.moveTo(c+Math.cos(a)*R, c+Math.sin(a)*R);
        x.lineTo(c+Math.cos(a)*inr, c+Math.sin(a)*inr); x.lineWidth=t%90===0?1.6:1; x.stroke(); });
      // north needle (gold triangle pointing to where North is, relative to view)
      (function(){ const a=ang(0); const tip=R-1, base=R-13, hw=5;
        const ax=Math.cos(a),ay=Math.sin(a), px=-ay,py=ax;
        x.beginPath(); x.moveTo(c+ax*tip,c+ay*tip);
        x.lineTo(c+ax*base+px*hw, c+ay*base+py*hw);
        x.lineTo(c+ax*base-px*hw, c+ay*base-py*hw); x.closePath();
        x.fillStyle='#e0c07a'; x.fill(); })();
      // cardinal letters
      x.fillStyle='#f0e3c4'; x.font='600 13px Heebo, sans-serif'; x.textAlign='center'; x.textBaseline='middle';
      CARD.forEach(cd=>{ const a=ang(cd.b), rr=R-21;
        x.fillStyle=cd.b===0?'#fff7e6':'#cdbd92';
        x.fillText(cd.t, c+Math.cos(a)*rr, c+Math.sin(a)*rr); });
      // centre "you face" marker (always points up = view direction)
      x.beginPath(); x.arc(c,c,2.6,0,7); x.fillStyle='#caa15a'; x.fill();
      x.beginPath(); x.moveTo(c,c-6); x.lineTo(c-4,c+5); x.lineTo(c+4,c+5); x.closePath();
      x.fillStyle='rgba(240,227,196,0.55)'; x.fill();

      // celestial bodies on the rose (at radius rB)
      const rB=R-30;
      bodies.forEach(bd=>{
        const a=ang(bd.az), bx=c+Math.cos(a)*rB, by=c+Math.sin(a)*rB;
        if(bd.kind==='moon'){
          const up=bd.alt>0;
          x.beginPath(); x.arc(bx,by,up?5.5:4.5,0,7);
          if(up){ x.fillStyle='#fff7e6'; x.shadowColor='rgba(255,247,230,0.9)'; x.shadowBlur=8; x.fill(); x.shadowBlur=0; }
          else { x.fillStyle='rgba(20,24,40,0.6)'; x.fill(); x.lineWidth=1.4; x.strokeStyle='rgba(207,200,170,0.85)'; x.stroke(); }
        } else if(bd.kind==='sun'){
          if(bd.alt>-2){ x.beginPath(); x.arc(bx,by,4.5,0,7); x.fillStyle='#ffcf6b';
            x.shadowColor='rgba(255,200,90,0.9)'; x.shadowBlur=7; x.fill(); x.shadowBlur=0; }
        } else { // planet
          x.beginPath(); x.arc(bx,by,2.6,0,7); x.fillStyle='#cdbf9b'; x.fill();
        }
      });

      // moon-finder pointer ON the rose when the moon is below horizon or off-screen
      if(moonAz!=null && moonUp!=null){
        const a=ang(moonAz), arT=R-2, arB=R-16, hw=4;
        const ax=Math.cos(a),ay=Math.sin(a), px=-ay,py=ax;
        x.beginPath(); x.moveTo(c+ax*arT,c+ay*arT);
        x.lineTo(c+ax*arB+px*hw, c+ay*arB+py*hw);
        x.lineTo(c+ax*arB-px*hw, c+ay*arB-py*hw); x.closePath();
        x.fillStyle=moonUp?'rgba(255,247,230,0.95)':'rgba(160,176,201,0.95)'; x.fill();
      }
    }

    // throttle: track last drawn heading and moon bearing; redraw on meaningful change
    function update(date, Mo){
      if(!camera||!controls) return;
      const heading=viewHeading();
      Mo = Mo || (window.Astro&&Astro.moon(date)) || null;
      if(!Mo) return;
      const moonUp=Mo.altDeg>0;
      const onScreen=moonOnScreen(Mo);
      const showFinder=!onScreen;                       // below horizon OR off-screen
      // bodies for the rose: moon always; sun if near/above horizon; bright planets (mag<2, above horizon)
      const bodies=[{kind:'moon',az:Mo.azDeg,alt:Mo.altDeg}];
      if(window.Astro){ const s=Astro.sun(date); bodies.push({kind:'sun',az:s.azDeg,alt:s.altDeg});
        if(Astro.planets){ try{ Astro.planets(date).forEach(p=>{ if(p.altDeg>0 && p.mag<2.0)
          bodies.push({kind:'planet',az:p.azDeg,alt:p.altDeg}); }); }catch(e){} } }

      // redraw rose only when heading or moon az/up changed enough (lightweight)
      if(Math.abs(heading-lastHeading)>0.8 || Math.abs(((Mo.azDeg-lastMoonAz+540)%360)-180)>0.8 || moonUp!==lastMoonUp){
        drawRose(heading, bodies, showFinder?Mo.azDeg:null, showFinder?moonUp:null);
        lastHeading=heading; lastMoonAz=Mo.azDeg; lastMoonUp=moonUp;
      }

      // readout under the rose: heading cardinal + moon state
      const CARD8=['N','NE','E','SE','S','SW','W','NW'];
      const card=CARD8[Math.round(heading/45)%8];
      const moonTxt = moonUp ? ('Moon '+Math.round(Mo.altDeg)+'° above the horizon')
                             : ('Moon below the horizon'+(()=>{const r=nextMoonrise(date);return r?' · rise '+r:'';})());
      read.innerHTML='<span class="ch">Compass · '+card+' '+Math.round(heading)+'°</span>'+
                     '<span class="cm '+(moonUp?'up':'down')+'">'+moonTxt+'</span>';
      // NOTE: the old #moonDirArrow / #moonDirState writes (which fed the bottom-left
      // moon card) were removed — that card is gone; its moon-direction arrow + rise
      // info now lives in the Sky tab (panels.js). The compass keeps its own
      // on-rose moon-finder pointer + the readout above.
    }
    return { update };
  })();
  window.__compass=Compass;

  // ---- real terrain + town, then drop the house onto the surface ----
  Terrain.load(scene,M,(sampleHeight)=>{
    const h=sampleHeight(0,0);
    houseWrap.position.set(0,h-0.2,0);
    controls.target.set(0,h+3,0);
    camera.position.set(28,h+20,38);
    controls.update();
    // capture THIS (terrain-correct) pose as the canonical "home" framing so the
    // Home button returns here exactly, not to the pre-terrain fallback.
    _home.tgt.copy(controls.target); _home.cam.copy(camera.position);
  });

  // ---- time engine ----
  const TZ='Etc/GMT+3';
  function localOffset(d){ const s=new Date(d.toLocaleString('en-US',{timeZone:TZ}));
    const u=new Date(d.toLocaleString('en-US',{timeZone:'UTC'})); return (s-u)/3600000; }
  function localYMD(d){ const f=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'});
    const [Y,Mo,D]=f.format(d).split('-').map(Number); return {Y,Mo,D}; }
  function dateForHour(mins){ const now=new Date(); const {Y,Mo,D}=localYMD(now); const off=localOffset(now);
    return new Date(Date.UTC(Y,Mo-1,D, 0,0,0) + (mins-off*60)*60000); }
  // ---- DATE (season) scrubbing -------------------------------------------
  // The hour scrubber sets the time-of-day; the date scrubber sets the
  // calendar day. Both share documentElement.dataset.tscrub (an absolute ms
  // timestamp), so the 3D sun/shadows AND the panels move with either one.
  // All arithmetic is on the CIVIL (local) calendar so it stays robust
  // across the DST jump — we never divide an absolute ms span by 24h.
  const DAYMS=86400000;
  // the date we treat as "current" for season editing (scrubbed, or now if live)
  function refDate(){ if(getMode()==='live') return new Date(); const ms=getScrub(); return isFinite(ms)?new Date(ms):new Date(); }
  // build the UTC timestamp whose local WALL-CLOCK reads (Y, Mo, D) at todMin
  // minutes past local midnight — using that civil day's own DST offset.
  function localDateMs(Y,Mo,D,todMin){
    const guess=Date.UTC(Y,Mo-1,D,0,0,0);
    const off=localOffset(new Date(guess+12*3600000));        // that day's UTC offset (DST-aware)
    return guess + (todMin - off*60)*60000;
  }
  // day index (0 = Jan 1) of date `d` within its own local-calendar year — pure
  // calendar difference, so DST never shifts it.
  function dayOfYear(d){ const {Y,Mo,D}=localYMD(d);
    return Math.round((Date.UTC(Y,Mo-1,D) - Date.UTC(Y,0,1)) / DAYMS); }
  // total days in the ref year (365/366) for slider bounds
  function daysInYear(Y){ return Math.round((Date.UTC(Y+1,0,1)-Date.UTC(Y,0,1))/DAYMS); }
  // map a day-of-year back to a civil {Mo,D} in year Y
  function ymdFromDoy(Y,doy){ const t=new Date(Date.UTC(Y,0,1)+Math.round(doy)*DAYMS);
    return {Mo:t.getUTCMonth()+1, D:t.getUTCDate()}; }
  // build a timestamp on day-of-year `doy`, KEEPING the currently-scrubbed time-of-day
  function dateForDay(doy){ const ref=refDate(); const {Y}=localYMD(ref); const todMin=ilMinutes(ref);
    const dn=daysInYear(Y); doy=Math.max(0,Math.min(dn-1,Math.round(doy)));
    const {Mo,D}=ymdFromDoy(Y,doy); return new Date(localDateMs(Y,Mo,D,todMin)); }
  // time state lives in the DOM — the one thing every execution shares
  const getMode=()=>D.dataset.tmode||'live';
  const getScrub=()=>(+D.dataset.tscrub)||Date.now();
  const getPlaying=()=>D.dataset.tplay==='1';
  const setScrub=(ms)=>{ D.dataset.tmode='scrub'; D.dataset.tscrub=ms; };
  const setLive=()=>{ D.dataset.tmode='live'; };
  const setPlaying=(p)=>{ D.dataset.tplay=p?'1':'0'; };
  // set time-of-day, PRESERVING the currently-scrubbed calendar date
  // (so the hour & date scrubbers compose; from 'live' it anchors to today)
  function dateForHourKeepDay(mins){
    if(getMode()==='live') return dateForHour(mins);
    const ref=refDate(); const {Y,Mo,D}=localYMD(ref);
    return new Date(localDateMs(Y,Mo,D,mins));
  }
  window.__setMins=(m)=>{ setScrub(dateForHourKeepDay(m).getTime()); setPlaying(false);
    const lb=document.getElementById('liveBtn'); if(lb) lb.classList.remove('on');
    const pb=document.getElementById('playBtn'); if(pb) pb.classList.remove('on');
    const sl=document.getElementById('tslider'); if(sl) sl.value=m;
    syncDateUI(); };
  // scrub the SEASON: jump to day-of-year `doy`, keeping the time-of-day
  window.__setDay=(doy)=>{ setScrub(dateForDay(doy).getTime()); setPlaying(false);
    const lb=document.getElementById('liveBtn'); if(lb) lb.classList.remove('on');
    const pb=document.getElementById('playBtn'); if(pb) pb.classList.remove('on');
    syncDateUI(); };
  window.__live=()=>{ setLive(); setPlaying(false); syncDateUI(); };
  // keep the date slider + label in sync with whatever date is current
  function syncDateUI(){ const ds=document.getElementById('dslider'); const dl=document.getElementById('dateLabel');
    if(!ds&&!dl) return; const d=refDate(); const doy=dayOfYear(d);
    if(ds && document.activeElement!==ds) ds.value=doy;
    if(dl) dl.textContent=fmtDate(d); }
  const MON_HE=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtDate(d){ const {Mo,D}=localYMD(d); return D+' '+MON_HE[Mo-1]; }
  function currentDate(dt){
    if(getMode()==='live') return new Date();
    let ms=getScrub(); if(getPlaying()){ ms+=dt*1000*900; setScrub(ms); } return new Date(ms);
  }
  function ilMinutes(d){ const t=d.getTime()+localOffset(d)*3600000; const x=new Date(t); return x.getUTCHours()*60+x.getUTCMinutes(); }
  function fmtHM(m){ m=((Math.round(m)%1440)+1440)%1440; return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); }

  // ---- weather (live) ----
  // Weather mode lives in the DOM (like the time engine) so it survives a preview
  // re-run: 'live' = follow Open-Meteo current conditions (and auto-refresh on a
  // timer); a mood key (clear/dust/clouds/rain) = a manual override that must NOT
  // be clobbered by the auto-refresh.
  if(D.dataset.wmode===undefined) D.dataset.wmode='live';
  const getWMode=()=>D.dataset.wmode||'live';
  const setWMode=(m)=>{ D.dataset.wmode=m; };
  // pull current conditions once, and (in parallel) the hourly cloud forecast used
  // for tonight's stargazing verdict in the Sky tab. ALSO pull the hyper-local
  // data layers the top-left card needs: AIR QUALITY (PM/AQI/dust/UV) and the
  // garden+water ENV (soil temp/moisture, ET0, precip prob, accumulated rain) —
  // these have no manual override, so we always (re)fetch them on the same cadence
  // and re-render the card when each resolves.
  Weather.fetchLive().then(st=>{ Weather.apply(st); updateWeatherUI(st); });
  if(Weather.fetchForecast) Weather.fetchForecast();
  function refreshLocalData(){
    if(Weather.fetchAir) Weather.fetchAir().then(()=>updateWeatherUI(Weather.state));
    if(Weather.fetchEnv) Weather.fetchEnv().then(()=>updateWeatherUI(Weather.state));
    // POLLEN/ENV (keyless Open-Meteo, optional Google key): refresh() is internally
    // cache-gated (~3h TTL) so this hits the network only when stale, on the same
    // 12-min cadence + boot + pill-click. Repaint the 'Environment' tab after each refresh.
    if(window.EnvAPI&&EnvAPI.refresh) EnvAPI.refresh().then(()=>{ if(window.__renderEnv) window.__renderEnv(); });
  }
  refreshLocalData();
  // AUTO-REFRESH: re-pull live conditions every ~12 min, but ONLY while in 'live'
  // mode so a manually-selected pill (clear/dust/clouds/rain) is never overwritten.
  // Also refresh the forecast occasionally so 'tonight's cloud' stays current.
  // Air + env refresh on the SAME cadence (they're location facts, not a mood, so
  // they update regardless of the live/override pill state).
  const WX_REFRESH_MS=12*60*1000;
  let wxRefreshTicks=0;
  const wxRefresh=setInterval(()=>{
    if(window.__gen!==MYGEN){ clearInterval(wxRefresh); return; }   // superseded by a newer run
    refreshLocalData();                                              // air + env every cycle
    if((++wxRefreshTicks % 5)===0 && Weather.fetchForecast) Weather.fetchForecast();  // ~hourly
    if(getWMode()!=='live') return;                                  // manual override active → skip live re-pull
    Weather.fetchLive().then(st=>{ if(getWMode()==='live'){ Weather.apply(st); updateWeatherUI(st); } });
  }, WX_REFRESH_MS);

  // ================= UI =================
  // Loop/UI shared state declared BEFORE injectUI() so the toggle wiring inside
  // injectUI() (e.g. the thermal layer's restore-on-load) can read them without
  // hitting a temporal-dead-zone. The render loop below also uses these.
  //   __wxDate/__wxSig — latest model Date + coarse signature for the weather card.
  //   __thermalSig     — model-minute(+weather) signature throttling the heatmap.
  let __wxDate=new Date(), __wxSig='';
  // __thermalSig — model-minute(+weather) signature throttling the LIVE microclimate
  // recolour so we never recompute every frame. The CHEAP yard recolour rides this
  // (debounced ~140 ms) gate; the EXPENSIVE per-vertex house thermal is gated SEPARATELY
  // (see the render loop) so continuous PLAY never hitches on the ~31 ms house pass.
  let __thermalSig='';
  let __mcLastRefresh=0;     // wall-clock ms of the last live YARD recolour — debounces the cheap sweep during fast scrubs
  // ---- HOUSE-THERMAL gate (decoupled from the yard) ----
  //   __mcSigChangedMs — wall-clock when the live sig last CHANGED (time/weather moved).
  //                      The scrub/drag is "settled" once this stops advancing.
  //   __mcHouseSig     — the live sig the house was last computed at (skip redundant work).
  //   __mcWasPlaying   — last observed play state, to fire a final house recompute on PAUSE.
  let __mcSigChangedMs=0, __mcHouseSig='', __mcWasPlaying=false;
  const MC_HOUSE_SETTLE_MS=160;   // after a scrub/drag (or a live minute tick): "settled" once the sig is this old → catch up the house
  // legend writer for the microclimate temperature ramp — fed the live °C range
  // from Building.setThermal(); the energy panel (panels.js) owns the legend
  // elements (#mc-tlMin/#mc-tlMax), so this is exposed globally for __microclimate.
  function updateThermalLegend(r){
    const lo=document.getElementById('mc-tlMin'), hi=document.getElementById('mc-tlMax');
    if(r&&r.range){ if(lo) lo.textContent=r.range[0]+'°'; if(hi) hi.textContent=r.range[1]+'°'; }
  }
  window.__updateThermalLegend=updateThermalLegend;
  injectUI();
  function injectUI(){
    const css=document.createElement('style'); css.textContent=getUICSS(); document.head.appendChild(css);
    const w=document.createElement('div'); w.id='ui'; w.innerHTML=getUIHTML(); document.body.appendChild(w);

    // direction tabs not needed; wire controls
    document.querySelectorAll('.wbtn').forEach(b=>b.addEventListener('click',()=>{
      document.querySelectorAll('.wbtn').forEach(x=>x.classList.toggle('on',x===b));
      const m=b.dataset.m;
      setWMode(m);   // record live vs manual override so the auto-refresh respects it
      if(m==='live'){ Weather.fetchLive().then(st=>{Weather.apply(st);updateWeatherUI(st);});
        if(Weather.fetchForecast) Weather.fetchForecast();     // refresh tonight's forecast on resume
        refreshLocalData(); }                                  // re-pull air + garden/water data too
      else Weather.override(m);
    }));
    // restore the weather-pill UI + override from persisted mode (survives a preview
    // re-run). The HTML defaults 'live' to .on; if a manual override was active,
    // re-mark its pill and re-apply it so the scene + auto-refresh stay consistent.
    (function restoreWMode(){ const m=getWMode(); if(m==='live') return;
      document.querySelectorAll('.wbtn').forEach(x=>x.classList.toggle('on',x.dataset.m===m));
      Weather.override(m); })();
    const sl=document.getElementById('tslider');
    sl.addEventListener('input',()=>{ setScrub(dateForHourKeepDay(+sl.value).getTime()); setPlaying(false);
      document.getElementById('liveBtn').classList.remove('on'); document.getElementById('playBtn').classList.remove('on');
      syncDateUI(); });
    // ---- DATE / season scrubber (sits beside the hour scrubber) ----
    const ds=document.getElementById('dslider');
    if(ds){ ds.max=String(daysInYear(localYMD(refDate()).Y)-1);   // 364 / 365 (leap-aware)
      ds.addEventListener('input',()=>{ setScrub(dateForDay(+ds.value).getTime()); setPlaying(false);
      document.getElementById('liveBtn').classList.remove('on'); document.getElementById('playBtn').classList.remove('on');
      const dl=document.getElementById('dateLabel'); if(dl) dl.textContent=fmtDate(refDate()); }); }
    document.getElementById('liveBtn').addEventListener('click',()=>{ setLive(); setPlaying(false);
      document.getElementById('liveBtn').classList.add('on'); document.getElementById('playBtn').classList.remove('on');
      syncDateUI(); });
    document.getElementById('playBtn').addEventListener('click',()=>{
      if(getMode()==='live'){ setScrub(Date.now()); }
      setPlaying(!getPlaying()); document.getElementById('playBtn').classList.toggle('on',getPlaying());
      document.getElementById('liveBtn').classList.remove('on'); });
    syncDateUI();

    // ---- surrounding-buildings control (homeblock meshes only) ----
    // State lives in the DOM (like the time engine) so it survives a preview re-run.
    if(D.dataset.bldOn===undefined) D.dataset.bldOn='1';           // default ON
    if(D.dataset.bldOp===undefined) D.dataset.bldOp='45';          // default 45% — preserves the current look
    const toggle=document.getElementById('bldToggle');
    const opSl=document.getElementById('opslider');
    const opVal=document.getElementById('opVal');
    const bld=document.getElementById('bld');
    // restore UI from state
    opSl.value=D.dataset.bldOp;
    syncBldUI();
    function syncBldUI(){
      const on=D.dataset.bldOn==='1';
      toggle.classList.toggle('on',on); toggle.setAttribute('aria-checked',on?'true':'false');
      bld.classList.toggle('off',!on);
      opVal.textContent=Math.round(+D.dataset.bldOp)+'%';
    }
    toggle.addEventListener('click',()=>{ D.dataset.bldOn = D.dataset.bldOn==='1'?'0':'1'; syncBldUI(); applyBlocks(); });
    opSl.addEventListener('input',()=>{ D.dataset.bldOp=opSl.value; syncBldUI(); applyBlocks(); });

    applyBlocks();
    // homeblock meshes load late (Terrain.load → buildTown → buildHomeBlock → async fetch),
    // so re-apply a few times after first paint to catch them once they exist.
    [200,600,1200,2500,4500].forEach(t=>setTimeout(applyBlocks,t));

    // ---- SKY-LAYER TOGGLES (constellations / Milky Way / sun&moon paths / sats) ----
    // Same dark/gold switch UI as the buildings toggle. Each drives the matching
    // sky.js layer via SkyRig.setLayer(name,on), which sets .visible on conLines+
    // labels / milky / sun&moonPathLine / the satellite group. State persists on
    // documentElement.dataset (layer<Name>='1'|'0'), default ON, so a preview
    // re-run keeps it — exactly like the time + buildings controls. SkyRig is
    // defined synchronously before app.js (see index.html load order), and
    // setLayer caches the desired state, so applying it immediately is safe even
    // though some layer objects (constellations, Milky Way, sats) load async.
    // sky-layer toggles (constellations / Milky Way / sun-moon paths / satellites) now live
    // ONLY in the Sky tab as on/off switches (panels.js renderSky → SkyRig.setLayer).

    // ---- SPATIAL SIGHTINGS toggle (same switch UI; drives Sightings.setVisible).
    // Not a SkyRig layer — it shows/hides the iNaturalist pin group. State
    // persists on documentElement.dataset.layerSightings ('1'|'0'), default ON.
    (function(){
      if(D.dataset.layerSightings===undefined) D.dataset.layerSightings='1';
      const sw=document.getElementById('lyr-sightings'); if(!sw) return;
      const sync=()=>{ const on=D.dataset.layerSightings==='1';
        sw.classList.toggle('on',on); sw.setAttribute('aria-checked',on?'true':'false');
        if(window.__sightings) window.__sightings.setVisible(on); };
      sw.addEventListener('click',()=>{ D.dataset.layerSightings=D.dataset.layerSightings==='1'?'0':'1'; sync(); });
      sync();
    })();

    // NOTE: the old loose "thermal layer" toggle that lived here was
    // REMOVED. The thermal/microclimate visualization is now the full
    // microclimate engine (yard heatmap + per-zone readout + plant recs), driven
    // from the Energy panel via window.__microclimate (exposed above).
    // The house-surface thermal (Building.setThermal) is now slaved to that API
    // for the temperature variables, and the LIVE recolour is gated in the render
    // loop below (see the __microclimate live block).

    // ---- RETURN-HOME button → smoothly fly back to the default house framing.
    // __flyHome() also cancels any active sky-focus / ground-fly tween and restores
    // the ground-safe polar clamp, so it doubles as a "reset the view" action.
    const homeBtn=document.getElementById('homeBtn');
    if(homeBtn) homeBtn.addEventListener('click',()=>{ if(window.__flyHome) window.__flyHome(); });

    // ---- ENTER-THE-HOUSE: the floating #enterBtn was REMOVED — entering now lives in the
    // House tab (panels.js) and exiting in the dollhouse nav pill (#enterNav). EnterMode.toggle/
    // enter/exit are still the public API those call; EnterMode.syncBtn() stays defensive (no-ops
    // when the button is absent) so nothing breaks if a caller still invokes it.
  }
  // Traverse the scene LIVE every time — homeblock meshes may not exist yet when
  // the UI is built. Touches ONLY meshes named 'homeblock'; never the house/terrain/central/garden.
  function applyBlocks(){
    const on = D.dataset.bldOn!=='0';
    const op = Math.max(0,Math.min(100,(+D.dataset.bldOp))) / 100;
    if(typeof scene==='undefined' || !scene) return;
    scene.traverse(o=>{
      if(!o.isMesh || o.name!=='homeblock') return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(mat=>{ if(!mat) return;
        mat.transparent=true; mat.opacity=op; mat.depthWrite=(op>=0.99); mat.needsUpdate=true; });
      o.visible = on && op>0;     // off, or fully transparent → hide
    });
  }
  window.__applyBlocks=applyBlocks;
  // ---- THE HYPER-LOCAL CLIMATE CARD --------------------------------------
  // Rebuilds the top-left card from the live town reading + the weather.js data
  // layers (air / env) DOWNSCALED to his house via derive.js. Auto-prioritises
  // sections by time-of-day (night → darkness first; day → garden/UV first) and
  // season (cold months → frost/water surfaced). Modeled values carry an "estimate"
  // tag. Robust to missing pieces (Derive not loaded, air/env null, Astro absent).
  const _windHe=deg=>{const d=['Northerly','North-easterly','Easterly','South-easterly','Southerly','South-westerly','Westerly','North-westerly'];
    return d[Math.round(((deg%360)+360)%360/45)%8];};
  // his backyard zone is EAST-facing & wide-open to the desert; the house wall
  // shelters it from W/SW. Give a short shelter/exposure note from wind direction.
  function shelterNote(windDir,windKmh){
    const from=((windDir%360)+360)%360;
    // open quadrant ≈ E (45–135): wind off the larkmont-vale hits the yard unbroken
    const exposed=from>=45&&from<=135;
    // sheltered ≈ W/SW (200–320): the house body blocks it
    const sheltered=from>=200&&from<=320;
    if(windKmh<6) return 'Light wind — the yard is calm';
    if(exposed) return _windHe(windDir)+' wind — blows in freely from the valley into the open yard';
    if(sheltered) return _windHe(windDir)+' wind — the house wall shelters the yard';
    return _windHe(windDir)+' wind';
  }
  // European AQI → {label, class}
  function aqiBadge(a){
    if(a==null) return null;
    if(a<=20) return {t:'Excellent',c:'bg-good'};
    if(a<=40) return {t:'Good',c:'bg-good'};
    if(a<=60) return {t:'Moderate',c:'bg-fair'};
    if(a<=80) return {t:'Moderate-poor',c:'bg-mod'};
    if(a<=100) return {t:'Poor',c:'bg-poor'};
    return {t:'Very poor',c:'bg-bad'};
  }
  const uvHe=u=>u==null?'—':u<3?'low':u<6?'moderate':u<8?'high':u<11?'very high':'extreme';
  const dustHe=d=>d==null?null:d<20?'Negligible':d<50?'Light':d<100?'Moderate':d<200?'High':'Heavy haze';
  const esc=s=>String(s==null?'':s);
  function backyardZone(){
    const zs=(window.Derive&&Derive.data&&Derive.data.site&&Derive.data.site.zones)||[];
    return zs.find(z=>z.id==='backyard')||null;
  }
  function updateWeatherUI(st){
    st = st || (window.Weather&&Weather.state) || {};
    const wTemp=document.getElementById('wTemp'); if(!wTemp) return;   // UI not built yet
    const date=__wxDate||new Date();
    const sun=(window.Astro&&Astro.sun)?Astro.sun(date):null;
    const alt=sun?sun.altDeg:25;
    const isNight=alt<0;
    const mon=date.getMonth();                                        // 0..11
    const coldSeason=(mon<=2||mon>=10);                               // Nov–Mar: frost/water relevant
    const town=(st.temp!=null)?st.temp:null;
    const hum=(st.hum!=null)?st.hum:null;
    const windKmh=(st.wind!=null)?st.wind:null;
    const windDir=(st.windDir!=null)?st.windDir:0;
    const cloudPct=(st.cloud!=null)?Math.round(st.cloud*100):null;
    const cloudFrac=(st.cloud!=null)?st.cloud:0.1;

    // --- downscale to his house ---
    const bz=backyardZone();
    const byState=(window.Derive&&Derive.zoneState&&bz&&sun)?Derive.zoneState(bz,sun.azDeg,sun.altDeg):{sunlit:!isNight};
    const mc=(window.Derive&&Derive.houseTempDelta)?
      Derive.houseTempDelta(town,byState,alt,{cloud:cloudFrac,wind:windKmh}):null;
    const houseTemp=(town!=null&&mc)?Math.round((town+mc.delta)*10)/10:town;
    const feels=(window.Derive&&Derive.feelsLike)?Derive.feelsLike(houseTemp,hum,windKmh):null;
    const dew=(window.Derive&&Derive.dewPoint)?Derive.dewPoint(houseTemp,hum):null;

    // ----- HEADLINE -----
    wTemp.textContent = (houseTemp!=null?houseTemp+'°':(town!=null?town+'°':'—'));
    const dEl=document.getElementById('wDelta');
    if(dEl){
      if(mc&&town!=null&&Math.abs(mc.delta)>=0.1){
        const cooler=mc.delta<0;
        dEl.textContent='~'+Math.abs(mc.delta).toFixed(1)+'° '+(cooler?'cooler':'warmer')+' than the city ('+town+'° in Larkmont) · estimate';
        dEl.style.color=cooler?'#9fc2e0':'#e0b070';
      } else if(town!=null){ dEl.textContent='Same as Larkmont ('+town+'°)'; dEl.style.color='#a99b78'; }
      else dEl.textContent='';
    }
    const fEl=document.getElementById('wFeels');
    if(fEl) fEl.textContent=(feels!=null)?('Feels like '+feels+'° · estimate'):'';
    const descEl=document.getElementById('wDesc'); if(descEl) descEl.textContent=esc(st.desc||'');

    // ----- BUILD SECTIONS (each is a string of HTML) -----
    const air=(window.Weather&&Weather.air)||null;
    const envT=(window.Weather&&Weather.envAt)?Weather.envAt('soilT',date):null;
    const envM=(window.Weather&&Weather.envAt)?Weather.envAt('soilM',date):null;
    const et0Day=(window.Weather&&Weather.dailyToday)?Weather.dailyToday('dEt0',date):null;
    const pProb=(window.Weather&&Weather.dailyToday)?Weather.dailyToday('dProb',date):null;
    const accum=(window.Weather&&Weather.accumPrecip)?Weather.accumPrecip(30):null;

    // ALWAYS block — humidity / dew / wind / air / UV / cloud
    const uvNow=(air&&air.uv!=null)?air.uv:null;
    const secAlways=
      '<div class="sec"><div class="sech">Air Now</div>'+
        '<div class="grid">'+
          '<div class="cell"><div class="v">'+(hum!=null?hum+'%':'—')+'</div><div class="l">Humidity</div></div>'+
          '<div class="cell"><div class="v">'+(dew!=null?dew+'°':'—')+'</div><div class="l">Dew point</div></div>'+
          '<div class="cell"><div class="v">'+(cloudPct!=null?cloudPct+'%':'—')+'</div><div class="l">Clouds</div></div>'+
        '</div>'+
        '<div class="grid g2" style="margin-top:7px">'+
          '<div class="cell"><div class="v">'+(windKmh!=null?Math.round(windKmh)+'<small> km/h</small>':'—')+'</div><div class="l">Wind</div></div>'+
          '<div class="cell"><div class="v">'+(uvNow!=null?uvNow:'—')+'<small> '+uvHe(uvNow)+'</small></div><div class="l">UV</div></div>'+
        '</div>'+
        (windKmh!=null?'<div class="note">'+esc(shelterNote(windDir,windKmh))+'</div>':'')+
      '</div>';

    // AIR QUALITY block
    let secAir='';
    if(air&&(air.pm25!=null||air.pm10!=null||air.aqi!=null)){
      const b=aqiBadge(air.aqi);
      const dl=dustHe(air.dust);
      // POLLEN (keyless Open-Meteo via EnvAPI): a single allergen line reusing the
      // air-card .aqline/.lab/.badge classes. EnvAPI.pollen.index is a 0..5 level;
      // gracefully absent until env_api.js + a refresh populate it.
      const pol=(window.EnvAPI&&EnvAPI.pollen)||null;
      const pIdx=(pol&&pol.index!=null)?pol.index:null;
      const polHe=v=>v==null?null:v<0.5?'None':v<1.5?'Low':v<2.5?'Medium':v<3.5?'High':'Very high';
      const pl=polHe(pIdx);
      secAir='<div class="sec"><div class="sech">Air Quality</div>'+
        '<div class="grid g2">'+
          '<div class="cell"><div class="v">'+(air.pm25!=null?Math.round(air.pm25):'—')+'<small> µg</small></div><div class="l">PM2.5</div></div>'+
          '<div class="cell"><div class="v">'+(air.pm10!=null?Math.round(air.pm10):'—')+'<small> µg</small></div><div class="l">PM10</div></div>'+
        '</div>'+
        (b?'<div class="aqline"><span class="lab">European air index</span><span class="badge '+b.c+'">'+b.t+' · '+Math.round(air.aqi)+'</span></div>':'')+
        (dl?'<div class="aqline"><span class="lab">Airborne dust</span><span class="badge '+(air.dust>=100?'bg-poor':air.dust>=50?'bg-mod':'bg-good')+'">'+dl+'</span></div>':'')+
        (pl?'<div class="aqline"><span class="lab">Pollen</span><span class="badge '+(pIdx>=3.5?'bg-poor':pIdx>=2.5?'bg-mod':pIdx>=1.5?'bg-fair':'bg-good')+'">'+pl+'</span></div>':'')+
      '</div>';
    }

    // NIGHT block — Bortle-3 darkness + moon brightening
    let secNight='';
    if(isNight){
      const bortle=(window.Derive&&Derive.data&&Derive.data.site&&Derive.data.site.bortle)||3;
      const moon=(window.Astro&&Astro.moon)?Astro.moon(date):null;
      let darkTxt, darkClass;
      if(moon&&moon.altDeg>0){
        const bright=moon.illum*Math.min(1,(moon.altDeg+5)/40);      // illum scaled by how high it is
        if(bright<0.12){ darkTxt='The moon gives almost no light — very dark sky'; darkClass='bg-good'; }
        else if(bright<0.4){ darkTxt='A partial moon slightly brightens the sky'; darkClass='bg-fair'; }
        else { darkTxt='Moon '+Math.round(moon.illum*100)+'% and high — strongly brightens the sky'; darkClass='bg-mod'; }
        secNight='<div class="sec"><div class="sech">How Dark the Night Is</div>'+
          '<div class="aqline"><span class="lab">Light pollution · Bortle</span><span class="badge bg-good">'+bortle+' (dark sky)</span></div>'+
          '<div class="dark">'+esc(moon.name||'')+' moon · <b>'+Math.round(moon.illum*100)+'% illuminated</b>, '+Math.round(moon.altDeg)+'° above the horizon.</div>'+
          '<div class="aqline"><span class="lab">Sky brightness</span><span class="badge '+darkClass+'">'+darkTxt+'</span></div>'+
        '</div>';
      } else {
        secNight='<div class="sec"><div class="sech">How Dark the Night Is</div>'+
          '<div class="aqline"><span class="lab">Light pollution · Bortle</span><span class="badge bg-good">'+bortle+' (dark sky)</span></div>'+
          '<div class="dark">The moon is below the horizon — <b>maximally dark sky</b> above the house.</div>'+
        '</div>';
      }
    }

    // GARDEN block — soil temp / moisture / ET0 + watering hint
    let secGarden='';
    if(envT!=null||envM!=null||et0Day!=null){
      const moistPct=(envM!=null)?Math.round(envM*100):null;         // m³/m³ → %
      let hint='';
      if(et0Day!=null){
        hint=(et0Day>6)?'High evaporation — water in early morning or evening':
             (et0Day>3)?'Moderate evaporation — check soil moisture before watering':
                        'Low evaporation — you can water less often';
      }
      secGarden='<div class="sec"><div class="sech">Garden <span class="est">estimate</span></div>'+
        '<div class="grid">'+
          '<div class="cell"><div class="v">'+(envT!=null?Math.round(envT)+'°':'—')+'</div><div class="l">Soil temp</div></div>'+
          '<div class="cell"><div class="v">'+(moistPct!=null?moistPct+'%':'—')+'</div><div class="l">Soil moisture</div></div>'+
          '<div class="cell"><div class="v">'+(et0Day!=null?(Math.round(et0Day*10)/10):'—')+'<small> mm</small></div><div class="l">Evaporation today</div></div>'+
        '</div>'+
        (et0Day!=null?'<div class="note">The beds lost ~<b>'+(Math.round(et0Day*10)/10)+' mm</b> today'+(hint?' · '+hint:'')+'</div>':'')+
      '</div>';
    }

    // WINTER / WATER block — precip chance + accumulated + frost risk
    let secWater='';
    const fr=(window.Derive&&Derive.frostRisk)?Derive.frostRisk({town,alt,cloud:cloudFrac,wind:windKmh,hum,backyard:byState}):null;
    const showFrost=fr&&fr.level&&fr.level!=='none';
    if(pProb!=null||accum!=null||showFrost){
      const frCls=fr?(fr.level==='high'?'bg-poor':fr.level==='medium'?'bg-mod':'bg-cool'):'';
      secWater='<div class="sec"><div class="sech">Water &amp; Cold</div>'+
        '<div class="grid g2">'+
          '<div class="cell"><div class="v">'+(pProb!=null?pProb+'%':'—')+'</div><div class="l">Rain chance today</div></div>'+
          '<div class="cell"><div class="v">'+(accum!=null?accum+'<small> mm</small>':'—')+'</div><div class="l">Rain, 30 days</div></div>'+
        '</div>'+
        (showFrost?'<div class="aqline"><span class="lab">Frost risk in your spot <span class="est" style="margin-right:4px">estimate</span></span>'+
            '<span class="badge '+frCls+'">'+fr.level+'</span></div>'+
            '<div class="note">'+esc(fr.note)+(fr.lowHouse!=null?' · est. min ~<b>'+fr.lowHouse+'°</b>':'')+'</div>':'')+
      '</div>';
    }

    // ----- AUTO-PRIORITISE ORDER by time-of-day + season -----
    // Night → darkness first. Cold season → water/frost surfaced earlier.
    // Day → garden/UV emphasis. Air quality always near the top (desert dust).
    let order;
    if(isNight){
      order=[secAlways, secNight, secAir, (coldSeason?secWater:''), secGarden, (coldSeason?'':secWater)];
    } else if(coldSeason){
      order=[secAlways, secWater, secAir, secGarden, secNight];
    } else {
      order=[secAlways, secGarden, secAir, secWater, secNight];
    }
    const body=document.getElementById('wxBody');
    if(body) body.innerHTML=order.filter(Boolean).join('');

    // ----- LIVE STATUS -----
    const live=document.getElementById('wLive');
    if(live){
      live.textContent = st.live?'Live data':(st.live===false?'Offline':'Loading…');
      live.style.color = st.live?'#8fc99a':'#c9a06a';
    }
    // mirror the same weather into the Environment tab's consolidated block (the floating
    // #wx card is retired). No-op unless that tab is the active panel.
    if(window.__envWeatherTick) window.__envWeatherTick();
  }

  // ---- resize ----
  addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth,innerHeight); });

  // ---- celestial hover info ----------------------------------------------
  // On mousemove, ask SkyRig for the notable objects it projected to screen this
  // frame (sun, moon, planets, brightest named stars), find the nearest within a
  // few px of the cursor, and show a dark/gold tooltip with a fact or two. The
  // tooltip follows the cursor and hides when nothing is near. Lightweight: no
  // raycasting — just 2D distance to pre-projected points.
  (function hoverInfo(){
    const tip=document.getElementById('skytip'); if(!tip) return;
    const dirHe=az=>{const d=['North','Northeast','East','Southeast','South','Southwest','West','Northwest'];return d[Math.round(((az%360)+360)%360/45)%8];};
    function html(o){
      const altaz=`Alt ${Math.round(o.alt)}° · ${dirHe(o.az)} (${Math.round(o.az)}°)`;
      if(o.kind==='sun') return `<div class="tn"><span>${o.name}</span><span class="tk">SUN</span></div>`+
        `<div class="tm">${altaz}</div>`;
      if(o.kind==='moon') return `<div class="tn"><span>${o.name}</span><span class="tk">MOON</span></div>`+
        `<div class="tm">${o.phase} · ${Math.round(o.illum*100)}% illuminated</div><div class="tm">${altaz}</div>`;
      if(o.kind==='planet') return `<div class="tn"><span>${o.name}</span><span class="tk">${o.en.toUpperCase()}</span></div>`+
        `<div class="tm">Mag ${o.mag.toFixed(1)} · ${altaz}</div>`+
        (o.fact?`<div class="tf">${o.fact}</div>`:'');
      // constellation: figure name only (NO star-only fields like .mag, which a
      // figure doesn't have — calling o.mag.toFixed here would throw).
      if(o.kind==='constellation') return `<div class="tn"><span>${o.name}</span><span class="tk">${(o.en||'').toUpperCase()}</span></div>`+
        `<div class="tm">Constellation${(o.alt!=null&&o.az!=null)?' · '+altaz:''}</div>`;
      // star
      return `<div class="tn"><span>${o.name}</span><span class="tk">${o.en.toUpperCase()}</span></div>`+
        `<div class="tm">Mag ${o.mag.toFixed(1)} · ${o.con||''}</div>`+
        `<div class="tf">Distance ~${o.ly} light-years · ${altaz}</div>`;
    }
    function onMove(e){
      const list=(window.SkyRig&&SkyRig.notables)?SkyRig.notables():null;
      if(!list||!list.length){ tip.classList.remove('on'); return; }
      const mx=e.clientX, my=e.clientY; let best=null, bestD=1e9;
      for(const o of list){
        const sc=o.screen; if(!sc||!sc.vis) continue;
        const r=(o.pick||14)*0.5+12;                 // pick radius: object size + a few px
        const dx=sc.x-mx, dy=sc.y-my, d=Math.hypot(dx,dy);
        if(d<r && d<bestD){ bestD=d; best=o; }
      }
      if(!best){ tip.classList.remove('on'); return; }
      tip.innerHTML=html(best);
      // keep the tooltip on-screen: flip to the left/up near edges
      const flipX=mx>innerWidth-260, flipY=my>innerHeight-140;
      tip.style.left=mx+'px'; tip.style.top=my+'px';
      tip.style.transform=`translate(${flipX?'calc(-100% - 14px)':'14px'},${flipY?'calc(-100% - 14px)':'14px'})`;
      tip.classList.add('on');
    }
    canvas.addEventListener('mousemove',onMove);
    canvas.addEventListener('mouseleave',()=>tip.classList.remove('on'));
  })();

  // ---- loop ----
  let last=performance.now(), uiT=0, first=true;
  // (__wxDate/__wxSig and __thermalSig + updateThermalLegend are declared above,
  //  before injectUI(), so the thermal toggle's restore can use them safely.)
  window.__frames=0;
  function frame(now){
   try{
    window.__frames++;
    const dt=Math.min(0.05,(now-last)/1000); last=now;
    const date=currentDate(dt);
    const info=SkyRig.update(date,camera,dt);
    Weather.update(dt,camera);
    // live yard sun/shade overlay — recoloured from the same sun the sky uses
    if(window.__yardShade) window.__yardShade.update(info.S || (window.Astro&&Astro.sun(date)));
    // plant sway
    const wind=0.4+Weather.cur.wind;
    garden.sway.forEach(s=>{ s.o.rotation.z=Math.sin(now*0.001+s.ph)*s.amp*wind; });
    stepFocus();          // ease the view toward a clicked sky object (if focusing)
    stepGroundFly();      // ease the view toward a clicked ground sighting (if flying)
    stepHome();           // ease the view back to the default house framing (Home button)
    if(window.__enterMode) window.__enterMode.step();   // ease into/out of the dollhouse interior view
    if(window.__sightings) window.__sightings.update(date);  // billboard sightings → face camera
    controls.update();
    // compass + moon-finder: ties to the live camera orbit AND the scrubbed clock
    if(window.__compass) window.__compass.update(date, info.Mo);
    renderer.render(scene,camera);

    uiT+=dt;
    if(uiT>0.25){ uiT=0; updateClockUI(date,info);
      // keep the hyper-local weather card's TIME-OF-DAY/SEASON face live as the
      // clock/season scrubs: rebuild only when the 10-min model bucket OR the
      // day/night state changed (cheap signature) so we don't thrash innerHTML
      // (which would also kill mood-pill hover). The card reads the same `date`.
      __wxDate=date; window.__mcDate=date;   // share the live model date with __microclimate
      const sig=Math.floor(date.getTime()/600000)+'|'+((info.altDeg<0)?'n':'d');
      if(sig!==__wxSig){ __wxSig=sig; updateWeatherUI(Weather.state); }
      // MICROCLIMATE LIVE drive: while the heatmap is ON *and* the season is
      // 'live', re-run the heatmap as the clock scrubs / live air temp/wind/cloud
      // shift. DECOUPLED so continuous PLAY never hitches (a CACHED season
      // winter/…/autumn is static → recoloured only on a control change, not here):
      //   • YARD (cheap, ~few ms) — recoloured on the model-MINUTE + coarse-weather
      //     signature, debounced to ~140 ms wall-clock, so the ground/balcony sweep
      //     stays smooth and catches the settled time within 140 ms.
      //   • HOUSE per-vertex thermal (~31 ms) — gated SEPARATELY so continuous PLAY
      //     HOLDS its last colours (no 31 ms hitch per recompute). It recomputes only
      //     when the timeline is SETTLED — not playing AND the live sig has been stable
      //     ≥ MC_HOUSE_SETTLE_MS (i.e. the scrub/drag was released, or live time just
      //     ticked over a minute) — and it fires once on the play→PAUSE transition so it
      //     CATCHES UP the moment PLAY pauses / the scrub settles. During fast scrubbing
      //     the sig keeps moving, so it never settles mid-drag. (Control changes
      //     recompute BOTH immediately via __microclimate._refresh; entering/exiting
      //     interior mode recomputes the house via EnterMode's mcHouseCatchUp.)
      if(window.__microclimate && window.__microclimate.isOn() && window.__microclimate._liveSurfaceVar()){
        const st=Weather.state||{};
        const tsig=Math.floor(date.getTime()/60000)+'|'+(D.dataset.mcVar||'')+'|'+
          (st.temp!=null?Math.round(st.temp):'?')+'|'+
          (st.wind!=null?Math.round(st.wind):'?')+'|'+
          (Weather.cur?Math.round((Weather.cur.cloud||0)*10):'?');
        const nowMs=performance.now();
        const playing=getPlaying();
        // — CHEAP YARD: debounced ~140 ms; keep the live sweep smooth.
        if(tsig!==__thermalSig && (nowMs-__mcLastRefresh)>=140){
          __thermalSig=tsig; __mcLastRefresh=nowMs;
          __mcSigChangedMs=nowMs;                 // mark that the live state just moved (for the settle test)
          window.__microclimate._refreshYard();
        }
        // — EXPENSIVE HOUSE: only for a TEMPERATURE variable. Recompute ONLY when the
        //   timeline is settled (scrub/drag released, or a live minute ticked over) or
        //   on the play→pause transition — so continuous PLAY never hitches.
        if(window.__microclimate.isTempVar()){
          const settled = !playing && (nowMs-__mcSigChangedMs)>=MC_HOUSE_SETTLE_MS;  // scrub/drag released / live minute ticked
          const paused  = (__mcWasPlaying && !playing);                              // just hit pause → catch up now
          if((settled||paused) && __mcHouseSig!==tsig){
            __mcHouseSig=tsig; window.__microclimate._refreshHouse();
          }
        } else if(window.__mcThermalOn){
          // variable is non-temp but the house is still thermally coloured → restore it once.
          window.__microclimate._refreshHouse();
        }
        __mcWasPlaying=playing;
      } else { __mcWasPlaying=getPlaying(); }
      // INTERIOR ROOM-TEMP LABELS follow the date/time scrub too — INDEPENDENT of the
      // microclimate heatmap (these dollhouse ~°C tints exist whenever you're inside on a
      // floor overview, even with the heatmap off). RoomHeat.refresh is self-gated: it only
      // rebuilds when the overview is showing AND the scene date crossed an hour bucket, so
      // this is a near-free label re-render (no per-cell bake) and never hitches PLAY.
      // Same idea for the open workbench Climate card (the workbench agent exposes
      // rerenderClimate()). Both stay quiet while actively PLAYING; they catch up on settle.
      if(window.__enterMode && window.__enterMode.on){
        try{ window.__enterMode.refreshHeat(); }catch(e){}
        try{ if(window.__workbench && window.__workbench.rerenderClimate) window.__workbench.rerenderClimate(); }catch(e){}
      }
      // self-heal: if homeblock meshes appeared (async, possibly very late), re-apply the control state once
      let n=0; scene.traverse(o=>{ if(o.isMesh&&o.name==='homeblock') n++; });
      if(n!==window.__hbCount){ window.__hbCount=n; if(window.__applyBlocks) window.__applyBlocks(); }
    }
    if(first){ first=false; const sp=document.getElementById('splash'); if(sp){sp.style.opacity=0; setTimeout(()=>sp.remove(),800);} }
   }catch(e){ fail('loop: '+e.message+' · '+(e.stack||'').split('\n')[1]); }
  }
  window.__tick=frame;
  function updateClockUI(date,info){
    const mins=ilMinutes(date);
    const sl=document.getElementById('tslider'); if((getMode()==='live'||getPlaying()) && document.activeElement!==sl) sl.value=mins;
    // keep the DATE slider/label live too (so 'live'/'play' advance the season readout)
    const ds=document.getElementById('dslider');
    if((getMode()==='live'||getPlaying()) && document.activeElement!==ds){
      if(ds) ds.value=dayOfYear(date);
      const dl=document.getElementById('dateLabel'); if(dl) dl.textContent=fmtDate(date);
    }
    document.getElementById('clock').textContent=fmtHM(mins);
    // phase label lives in the bottom-centre time bar (NOT the old moon card) — kept.
    let ph='Night'; if(info.altDeg>6) ph='Day'; else if(info.altDeg>-1) ph='Sunrise/Sunset'; else if(info.altDeg>-8) ph='Twilight';
    document.getElementById('phaseLabel').textContent=ph;
    // The standalone bottom-left moon card was removed; its content (phase name,
    // illum %, above/below-horizon, sun altitude, direction arrow + rise) now lives
    // in the Sky tab (panels.js). No moon-card DOM to update here anymore.
  }

  let lastRafTime=performance.now();
  function rafLoop(now){ if(window.__gen!==MYGEN) return; if(!window.__worldPaused) frame(now); lastRafTime=now; requestAnimationFrame(rafLoop); }
  requestAnimationFrame(rafLoop);
  const wd=setInterval(()=>{ if(window.__gen!==MYGEN){clearInterval(wd);return;} if(!window.__worldPaused && performance.now()-lastRafTime>150) frame(performance.now()); }, 33);
  }catch(e){ fail(e.message+' · '+(e.stack||'').split('\n')[1]); }

  // ================= UI markup / style =================
  function getUICSS(){ return `
  #ui{ position:fixed; inset:0; pointer-events:none; font-family:'Heebo',sans-serif; color:#efe6cf; }
  #ui>*{ pointer-events:auto; }
  .brand{ position:absolute; top:22px; right:30px; text-align:right; text-shadow:0 2px 18px rgba(0,0,0,.85), 0 0 2px rgba(0,0,0,.6); }
  .brand .k{ font-family:'Bellefair',serif; letter-spacing:.34em; font-size:11.5px; color:#e7c98a; }
  .brand h1{ font-family:'Frank Ruhl Libre',serif; font-weight:500; font-size:25px; margin-top:2px; color:#fff7e6; }
  .panel{ background:linear-gradient(150deg,rgba(14,16,30,.72),rgba(8,9,18,.66)); backdrop-filter:blur(11px);
    border:1px solid rgba(202,161,90,.28); border-radius:4px; box-shadow:0 16px 44px rgba(0,0,0,.4); }
  /* LEFT COLUMN: the hyper-local weather card (#wx) stacked above the layer
     panel (#bld). A flex column anchored top-left so #bld always sits directly
     UNDER the card at the card's REAL rendered height (no magic-pixel offset),
     and the whole stack is bounded so it clears the bottom-left compass + the
     ⌂ Home button (those are bottom-anchored). The card keeps priority for
     height (it doesn't shrink); on short screens #bld gives way (shrinks + scrolls)
     so nothing ever overlaps the bottom controls. pointer-events:none on the wrap
     (with auto on its children) keeps the transparent gap between the two cards
     from stealing drag/orbit events from the 3D canvas behind it.
     max-height stops the column above the home button: home button sits at
     bottom:208px (~40px tall) + ~30px gap ⇒ ~278px of reserved bottom space.
     SHORT-VIEWPORT FALLBACK: overflow-y:auto (thin scrollbar) — if even the
     capped card + all toggle rows + the bottom gap can't fit, the WHOLE column
     scrolls so every toggle stays reachable, instead of clipping #bld out of
     sight (the previous overflow:hidden hid the layer panel entirely). */
  #leftcol{ position:absolute; top:22px; left:30px; width:268px; display:flex;
    flex-direction:column; gap:12px; max-height:calc(100vh - 330px);
    overflow-y:auto; overflow-x:hidden;
    scrollbar-width:thin; scrollbar-color:rgba(202,161,90,.5) transparent;
    pointer-events:none; }
  #leftcol::-webkit-scrollbar{ width:6px; }
  #leftcol::-webkit-scrollbar-thumb{ background:rgba(202,161,90,.42); border-radius:3px; }
  #leftcol::-webkit-scrollbar-track{ background:transparent; }
  #leftcol>*{ pointer-events:auto; }
  /* hyper-local weather card: fixed header + SCROLLABLE body + fixed footer
     (live status + mood pills). Capped so a tall card never runs off-screen; the
     body scrolls for the remainder. The cap is the tighter of 430px and
     (100vh - 470px) — the 470px reservation leaves room BELOW the card for the
     full layer-toggle panel (#bld, ~8 rows) plus the bottom gap, so the card no
     longer eats the whole column and pushes #bld out of view. It only shrinks
     (flex:0 1 auto) when the column is squeezed — and its body keeps a min-height
     so several rows stay visible — otherwise it sits at content height up to 430. */
  /* (#wx weather-card styles removed — the card is retired; see getUIHTML.) */
  /* AQI / risk colour ramp — global .bg-* badge classes; reused live by the
     instrument panel (panels.js) + aqiBadge(), so they STAY. */
  .bg-good{ background:rgba(120,190,120,.22); color:#a8e0a0; border:1px solid rgba(120,190,120,.5); }
  .bg-fair{ background:rgba(210,200,110,.2); color:#e3d76e; border:1px solid rgba(210,200,110,.5); }
  .bg-mod{ background:rgba(225,160,80,.2); color:#f0b46e; border:1px solid rgba(225,160,80,.5); }
  .bg-poor{ background:rgba(220,110,90,.22); color:#ef9a86; border:1px solid rgba(220,110,90,.55); }
  .bg-bad{ background:rgba(190,90,150,.24); color:#e29ad0; border:1px solid rgba(190,90,150,.55); }
  .bg-cool{ background:rgba(110,150,205,.2); color:#9fc2e0; border:1px solid rgba(110,150,205,.5); }
  .wbtn,.tbtn{ font-family:'Heebo'; font-size:11.5px; color:#cdbd92; background:rgba(255,255,255,.04);
    border:1px solid rgba(202,161,90,.26); border-radius:30px; padding:5px 11px; cursor:pointer; transition:.25s; }
  .wbtn:hover{ border-color:rgba(202,161,90,.6); } .wbtn.on,.tbtn.on{ background:linear-gradient(#caa15a,#a07c38); color:#1a1606; border-color:#e0c483; }
  /* layer-toggle GROUP (top-left, under the weather card). The buildings toggle
     keeps its opacity slider; the sky-layer toggles (constellations, Milky Way,
     sun/moon paths, satellites) are simple label+switch rows in the same
     dark/gold style. */
  /* layer panel — a flex sibling that sits DIRECTLY UNDER the weather card inside
     #leftcol, tracking the card's real height (no fixed top that could overlap a
     taller card). It takes the room left below the (now capped) card and is itself
     scrollable (overflow-y:auto): a min-height keeps at LEAST ~5 toggle rows visible
     even when the column is squeezed, and on a short screen its own thin scrollbar
     reaches the rest of the rows (incl. the thermal toggle) rather than the panel
     being clipped out of sight. flex:1 1 auto lets it absorb the freed column space
     so it never runs into the bottom-left compass / home button. */
  #bld{ flex:1 1 auto; min-height:200px; overflow-y:auto; width:100%; padding:13px 16px;
    scrollbar-width:thin; scrollbar-color:rgba(202,161,90,.5) transparent; }
  #bld::-webkit-scrollbar{ width:6px; }
  #bld::-webkit-scrollbar-thumb{ background:rgba(202,161,90,.42); border-radius:3px; }
  #bld::-webkit-scrollbar-track{ background:transparent; }
  #bld .gtitle{ font-family:'Bellefair',serif; letter-spacing:.16em; font-size:10px; color:#caa15a;
    margin-bottom:9px; }
  #bld .hd{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
  /* each toggle row (one per layer + the buildings row) */
  #bld .lrow{ display:flex; align-items:center; justify-content:space-between; gap:10px;
    padding:6px 0; border-top:1px solid rgba(202,161,90,.12); }
  #bld .lrow:first-of-type{ border-top:none; }
  #bld .lbl{ font-size:13px; color:#f3ead2; }
  #bld .sw{ position:relative; width:42px; height:22px; flex:0 0 auto; border-radius:30px; cursor:pointer;
    background:rgba(255,255,255,.06); border:1px solid rgba(202,161,90,.3); transition:.25s; }
  #bld .sw::after{ content:''; position:absolute; top:2px; right:2px; width:16px; height:16px; border-radius:50%;
    background:#cdbd92; transition:.25s; box-shadow:0 1px 4px rgba(0,0,0,.5); }
  #bld .sw.on{ background:linear-gradient(#caa15a,#a07c38); border-color:#e0c483; }
  #bld .sw.on::after{ right:22px; background:#fff7e6; }
  /* (The old #bld thermal-layer legend CSS was removed with the loose thermal
     toggle; the microclimate legend now lives in the Energy panel — panels.js.) */
  #bld .oprow{ display:flex; align-items:center; gap:10px; margin-top:8px; margin-bottom:2px; }
  #bld .opval{ font-family:'Bellefair',serif; letter-spacing:.08em; font-size:12px; color:#caa15a; min-width:38px; text-align:left; }
  #bld.off .oprow{ opacity:.4; }
  #opslider{ -webkit-appearance:none; appearance:none; flex:1; height:4px; border-radius:3px;
    background:linear-gradient(90deg,#0b1430 0%,#36406e 40%,#caa15a 100%); outline:none; }
  #opslider::-webkit-slider-thumb{ -webkit-appearance:none; width:15px; height:15px; border-radius:50%;
    background:#f0e3c4; border:2px solid #caa15a; cursor:pointer; box-shadow:0 0 8px rgba(202,161,90,.6); }
  #opslider::-moz-range-thumb{ width:15px;height:15px;border-radius:50%;background:#f0e3c4;border:2px solid #caa15a;cursor:pointer; }
  #tbar{ position:absolute; bottom:24px; left:50%; transform:translateX(-50%); width:min(640px,86vw); padding:12px 20px; display:flex; flex-direction:column; gap:9px; }
  #tbar .trow{ display:flex; align-items:center; gap:14px; }
  #tbar .clock{ font-family:'Frank Ruhl Libre',serif; font-size:22px; min-width:64px; text-align:center; }
  #tbar .ph{ font-size:11px; color:#caa15a; text-align:center; min-width:78px; font-family:'Bellefair'; letter-spacing:.12em; }
  #tbar .drow{ border-top:1px solid rgba(202,161,90,.16); padding-top:9px; }
  #tbar .datev{ font-family:'Frank Ruhl Libre',serif; font-size:16px; min-width:64px; text-align:center; color:#f3ead2; }
  #tbar .dk{ font-family:'Bellefair'; letter-spacing:.16em; font-size:10px; color:#caa15a; min-width:78px; text-align:center; }
  #tslider,#dslider{ -webkit-appearance:none; appearance:none; flex:1; height:4px; border-radius:3px; outline:none; }
  #tslider{ background:linear-gradient(90deg,#0b1430 0%,#36406e 30%,#caa15a 50%,#36406e 70%,#0b1430 100%); }
  /* date track: cool winter → warm summer → cool winter (Jan→Jul→Dec) */
  #dslider{ background:linear-gradient(90deg,#2a4a7a 0%,#caa15a 50%,#2a4a7a 100%); }
  #tslider::-webkit-slider-thumb,#dslider::-webkit-slider-thumb{ -webkit-appearance:none; width:16px; height:16px; border-radius:50%;
    background:#f0e3c4; border:2px solid #caa15a; cursor:pointer; box-shadow:0 0 10px rgba(202,161,90,.7); }
  #tslider::-moz-range-thumb,#dslider::-moz-range-thumb{ width:16px;height:16px;border-radius:50%;background:#f0e3c4;border:2px solid #caa15a;cursor:pointer; }
  .tbtn{ padding:6px 13px; } #hint{ position:absolute; bottom:118px; left:50%; transform:translateX(-50%);
    font-family:'Bellefair'; letter-spacing:.2em; font-size:10.5px; color:rgba(226,214,184,.5); }
  /* hover tooltip for celestial objects (sun/moon/planets/bright stars) */
  #skytip{ position:fixed; z-index:30; pointer-events:none; opacity:0; transition:opacity .12s;
    max-width:236px; padding:9px 12px; border-radius:7px; transform:translate(14px,14px);
    background:linear-gradient(155deg,rgba(12,14,26,.95),rgba(6,7,15,.96)); backdrop-filter:blur(8px);
    border:1px solid rgba(202,161,90,.5); box-shadow:0 12px 34px rgba(0,0,0,.6);
    font-family:'Heebo',sans-serif; color:#efe6cf; text-align:left; }
  #skytip.on{ opacity:1; }
  #skytip .tn{ font-family:'Frank Ruhl Libre',serif; font-size:15px; color:#fff7e6; display:flex; gap:7px; align-items:baseline; justify-content:flex-end; }
  #skytip .tk{ font-family:'Bellefair'; letter-spacing:.14em; font-size:9.5px; color:#caa15a; }
  #skytip .tm{ font-size:11px; color:#bcae8a; margin-top:3px; line-height:1.45; }
  #skytip .tf{ font-size:10.5px; color:#9fb0c9; margin-top:5px; line-height:1.45; border-top:1px solid rgba(202,161,90,.18); padding-top:5px; }
  /* compass + moon-finder HUD — BOTTOM-LEFT corner (moved from bottom-right, where
     the long right-side Sky tab panel overlapped/hid it). It now sits in the
     space the old floating moon card vacated. Bottom-left keeps it clear of the
     weather card (top-left) and the time bar (bottom-centre). */
  #compass{ position:absolute; bottom:30px; left:30px; width:128px; display:flex; flex-direction:column;
    align-items:center; gap:7px; text-align:center; }
  #compassRose{ display:block; filter:drop-shadow(0 8px 22px rgba(0,0,0,.45)); }
  #compassRead{ display:flex; flex-direction:column; gap:2px; align-items:center; line-height:1.3; }
  #compassRead .ch{ font-family:'Bellefair',serif; letter-spacing:.12em; font-size:11px; color:#caa15a; }
  #compassRead .cm{ font-size:10.5px; color:#bcae8a; }
  #compassRead .cm.down{ color:#9fb0c9; } #compassRead .cm.up{ color:#e7dcc0; }
  /* RETURN-HOME button — dark/gold pill in the SAME panel style, sitting just
     ABOVE the compass HUD (bottom-left), clear of the weather card (top-left) and
     the time bar (bottom-centre). Returns the camera to the default house framing. */
  #homeBtn{ position:absolute; left:30px; display:flex; align-items:center; gap:7px;
    font-family:'Heebo',sans-serif; font-size:12.5px; color:#f0e3c4; padding:8px 15px; cursor:pointer;
    border-radius:30px; transition:.25s; bottom:208px; }
  #homeBtn .hg{ font-size:15px; line-height:1; color:#caa15a; transition:.25s; }
  #homeBtn:hover{ border-color:rgba(202,161,90,.6); color:#fff7e6; }
  #homeBtn:hover .hg{ color:#e0c07a; }
  #homeBtn:active{ background:linear-gradient(#caa15a,#a07c38); color:#1a1606; border-color:#e0c483; }
  #homeBtn:active .hg{ color:#1a1606; }
  /* (#enterBtn removed — enter lives in the House tab, exit in the #enterNav dollhouse pill.) */
  /* INTERIOR NAV PANEL — shown only while INSIDE (enter mode). Top-centre, clear
     of the left weather column (left:30px+268px), the right tabs panel (#inst,
     right:22px+300px), the bottom time bar and the bottom-left compass. Dark-glass
     + gold (.panel), RTL. Two rows: floor pills, then floor-overview + room pills. */
  #enterNav{ position:absolute; top:18px; left:50%; transform:translateX(-50%);
    z-index:12; display:flex; flex-direction:column; gap:8px; padding:10px 14px;
    max-width:min(560px, calc(100vw - 700px)); }
  #enterNav .enRow{ display:flex; flex-wrap:wrap; gap:6px; justify-content:center; }
  #enterNav .enRooms{ border-top:1px solid rgba(202,161,90,.16); padding-top:8px; }
  #enterNav .enPill{ font-family:'Heebo',sans-serif; font-size:12.5px; color:#cdbd92;
    background:rgba(255,255,255,.04); border:1px solid rgba(202,161,90,.26);
    border-radius:30px; padding:6px 13px; cursor:pointer; transition:.25s; white-space:nowrap; }
  #enterNav .enPill:hover{ border-color:rgba(202,161,90,.6); color:#fff7e6; }
  #enterNav .enPill.on{ background:linear-gradient(#caa15a,#a07c38); color:#1a1606; border-color:#e0c483; }
  #enterNav .enFloors .enPill{ font-size:13px; padding:6px 16px; }
  #enterNav .enOver{ font-family:'Bellefair',serif; letter-spacing:.06em; }
  @media(max-width:760px){ #leftcol{ width:212px; max-height:calc(100vh - 250px); } #skytip{display:none}
    #compass{ bottom:14px; left:14px; transform:scale(.86); transform-origin:bottom left; }
    #homeBtn{ bottom:178px; left:14px; font-size:11.5px; padding:7px 13px; }
    #enterNav{ top:10px; max-width:calc(100vw - 28px); padding:8px 10px; }
    #enterNav .enPill{ font-size:11.5px; padding:5px 11px; } }
  `; }
  function getUIHTML(){ return `
  <div class="brand"><div class="k">LARKMONT · 34.0°N -40.0°E</div><h1>Alex's House</h1></div>
  <div id="leftcol">
  <!-- The floating weather card (#wx) is RETIRED — its content lives in the
       instrument panel's Environment tab (panels.js weatherBlockHTML); movable.js
       force-hid it. updateWeatherUI() now no-ops on its absent body/pills. -->
  <div id="bld" class="panel">
    <div class="gtitle">Display Layers</div>
    <div class="lrow"><div class="lbl">Buildings Around the House</div>
      <div class="sw on" id="bldToggle" role="switch" aria-checked="true"></div></div>
    <div class="oprow">
      <input id="opslider" type="range" min="0" max="100" value="45" />
      <div class="opval" id="opVal">45%</div>
    </div>
    <!-- sky-layer toggles (constellations / Milky Way / paths / satellites) moved to the Sky tab -->
    <div class="lrow"><div class="lbl">Nature Observations</div>
      <div class="sw on" id="lyr-sightings" role="switch" aria-checked="true"></div></div>
    <!-- The loose "thermal layer" toggle + its legend were removed; the microclimate
         control (on/off + variable + season), per-zone readout, plant
         recommendations and the legend now live in the Energy panel. -->
  </div>
  </div>
  <div id="hint">Drag to rotate · Scroll to zoom · Slide the time and date</div>
  <button id="homeBtn" class="panel" type="button" title="Back to house view" aria-label="Back to house view"><span class="hg">⌂</span> Home</button>
  <!-- #enterBtn removed: entering the house now lives in the House tab; exiting in the dollhouse nav pill (#enterNav). -->
  <div id="skytip"></div>
  <div id="tbar" class="panel">
    <div class="trow">
      <div class="clock" id="clock">—</div>
      <div class="ph" id="phaseLabel">—</div>
      <input id="tslider" type="range" min="0" max="1439" value="720" />
      <div class="tbtn on" id="liveBtn">Live</div>
      <div class="tbtn" id="playBtn">▶</div>
    </div>
    <div class="trow drow">
      <div class="datev" id="dateLabel">—</div>
      <div class="dk">Date · Season</div>
      <input id="dslider" type="range" min="0" max="365" value="172" />
    </div>
  </div>`; }
})();
