/* ===================================================================
   environment.js — the world the house sits in: the desert plateau on
   the rim of Larkmont Vale, the valley falling away to the south, the
   garden/courtyard planting, boundary walls and neighbouring plots.

   The planting is ALEX'S REAL GARDEN, learned from his photos:
     · COURTYARD (z7.2..10.29, x0..7.78 open ground, storage x7.78..10.50) — his
       signature dense collection: aloe + spiky succulent rosettes, rounded jade
       clusters, a tall prickly-pear (opuntia), an olive sapling, a window-box of
       red geraniums, herb/flower crates, all in LOTS of black plastic pots +
       a few terracotta ones, grouped along the walls.
     · TERRACE (first floor, y≈2.80, wide SE south band x3.18..10.50 z3.60..7.20) —
       potted blueberry shrubs, a tall sunflower, climbing vines on thin
       trellis supports, a fig sapling, a big ribbed concrete planter,
       wooden raised planter crates, more black pots, string lights.
     · BACKYARD / open plot — his fruit: apricot, fig, mulberry & olives as
       small trees, plus a DATA-GROUNDED set of trees/shrubs placed at the
       real vegetation-canopy locations detected in geo/central_wide.png.

   --- CHANGE LOG (this revision) ---
   (1) CLIPPING FIXED. Every ground-level plant/pot/tree/rock is now kept
       OUT of the heated footprint — the L (NORTH band x0..8.41 + wide SOUTH
       band x0..10.50, z3.60..7.20). The apricot, which previously sat INSIDE
       the house, is now in the open courtyard (z>7.2). The decorative rock scatter,
       which spawned rocks inside the rooms, is now masked to skip the
       footprint. A small inFootprint() guard rejects anything that lands in
       a room. (The terrace plants are intentionally up on the deck at y≈2.80
       and are exempt.)
   (2) BETTER PLANT FIDELITY. Foliage is now built from MANY small varied
       clusters (instanced-ish leaf tufts with colour + scale jitter) instead
       of a few big balloon spheres, so canopies read denser and more plant-
       like. Aloe = proper spiky upcurving rosettes; jade = fleshy rounded
       paddles; prickly-pear = stacked flat pads with areole dots; blueberry
       = arching stems with glossy ovate leaf-fans + crowned dusty berries;
       sunflower = ridged stalk, broad leaves, layered ray petals + seeded
       disc; vines = leafy spirals on trellises. Signature black pots kept.
   (3) DATA-GROUNDED TREES. At load we read geo/central_wide.png on an
       offscreen canvas, detect vegetation pixels (green clearly dominating
       red & blue — the same validated rule town.js uses), cluster them, and
       plant Alex's larger trees/shrubs at the real canopy centroids within
       ~40 m of the house that fall OUTSIDE the footprint. Pixel→world per the
       brief: world_x=(px/W-0.5)*1050, world_z=(py/H-0.5)*1050; world→local
       undoes the houseWrap 5° spin and the (HCX,HCZ) offset that app.js
       applies, so canopies land where the imagery actually shows green.

   All planting materials are created LOCALLY in this file (see makePalette);
   materials.js is intentionally NOT used for the planting so it can be
   edited in parallel. PUBLIC API is unchanged: buildGarden(M)->{group,sway}.

   Coordinate frame (house local): +x=east, +y=up, +z=SOUTH.
   Key zones (from building.js) — the block is an L (south band juts +2.09 m E):
     built block  NORTH x0..8.41 z0..3.60 + SOUTH x0..10.50 z3.60..7.20  (HEATED — keep plants OUT)
     COURTYARD    z7.20..10.29, x0..7.78 (ground, now to the wider east edge)
     STORAGE      x7.78..10.50 z7.20..10.14   (SE of the wider courtyard)
     TERRACE      deck at y≈2.80 over SE: x3.18..10.50, z3.60..7.20  (wide south band)
   =================================================================== */
const Environment = (function(){

  // ---- the built-block footprint (HEATED volume) — nothing at ground
  //      level may sit inside it. The block is an L: a NORTH band (east edge
  //      8.41) + a wider SOUTH band (living, east edge 10.50, juts +2.09 m E,
  //      stepping at z=3.60). Terrace plants live ON the deck at y≈2.80 and pass
  //      a baseY>1 so they are exempt. -----------------------------------------
  const GZ = 3.60;                                       // N|S band / east-step line
  const FOOT  = { x0:0.0, x1:8.41,  z0:0.0,  z1:7.20 };  // NORTH-band E extent (back-compat)
  const FOOTS = { x0:0.0, x1:10.50, z0:GZ,   z1:7.20 };  // SOUTH band (wide) — east edge 10.50
  // terrace deck footprint (ground-rule exemption, y≈2.80) — now to the wide edge
  const DECK  = { x0:3.18, x1:10.50, z0:GZ, z1:7.20 };

  // is a ground-level (x,z) inside the heated footprint? (small margin so a
  // pot rim doesn't poke through a wall). baseY high enough => on the deck.
  // L-aware: north band to x=8.41 (z<GZ) OR wide south band to x=10.50 (z≥GZ).
  function inFootprint(x,z,baseY){
    if(baseY && baseY>1.0) return false;          // it's up on the terrace deck
    const m=0.18;
    const inN = x>FOOT.x0-m  && x<FOOT.x1+m  && z>FOOT.z0-m && z<GZ;            // north band
    const inS = x>FOOTS.x0-m && x<FOOTS.x1+m && z>=GZ        && z<FOOTS.z1+m;   // south band (wide)
    return inN || inS;
  }
  // is (x,z) on the terrace deck plane? (wide south band, x to 10.50)
  function onDeck(x,z){ return x>DECK.x0 && x<DECK.x1 && z>DECK.z0 && z<DECK.z1; }

  // ---- LOCAL planting palette (kept inside this file on purpose) --------
  // varied greens (sage / olive / emerald) + Alex's black-pot signature.
  function makePalette(){
    const std = (c,r=0.85,m=0.0)=>new THREE.MeshStandardMaterial({color:c,roughness:r,metalness:m});
    return {
      blackPot:   std(0x23211f, 0.92),   // his ubiquitous black plastic pots
      blackPot2:  std(0x2c2a27, 0.92),
      terracotta: std(0xa55a39, 0.9),    // the few clay pots in the courtyard
      greyPot:    std(0xb9b2a6, 0.95),   // big ribbed light-grey concrete planter (terrace)
      woodBox:    std(0x5a4631, 0.85),   // dark wooden raised planter crates (terrace)
      crateRed:   std(0x7d2b2b, 0.9),    // red seedling crates (courtyard)
      soil:       std(0x2f241a, 1.0),    // exposed potting soil (dark, perlite-flecked)
      // foliage greens — a spread so canopies read varied, not uniform
      sage:       std(0x7d9b6c, 0.9),
      olive:      std(0x6f7d3f, 0.9),
      oliveDk:    std(0x566331, 0.9),
      emerald:    std(0x2f6e3a, 0.85),
      emeraldDk:  std(0x255a2f, 0.85),
      leafLt:     std(0x6fa24a, 0.85),   // bright new growth
      jade:       std(0x4f7d52, 0.78),   // fleshy blue-green jade
      jadeLt:     std(0x6f9a6a, 0.78),
      aloe:       std(0x83a96e, 0.85),   // grey-green aloe
      aloeDk:     std(0x6f9558, 0.85),
      succBlue:   std(0x6f9e86, 0.8),    // blue-green succulent rosettes
      succPurp:   std(0x8a7d9a, 0.8),    // purplish echeveria tips
      cactusPad:  std(0x5b8f55, 0.85),   // prickly-pear pad green
      cactusPadLt:std(0x77a85f, 0.85),
      areole:     std(0xcfc8a8, 0.9),    // pale areole/spine dots on cactus
      blueberry:  std(0x244a2c, 0.55),   // dark glossy blueberry leaf (low rough = glossy)
      blueberryLt:std(0x356b3a, 0.55),
      berry:      std(0x3b5a86, 0.5),    // blueberry fruit (dusty blue)
      berryCrown: std(0xb9c4c0, 0.7),    // pale calyx crown on the berry
      stalk:      std(0x6a8f3c, 0.85),   // sunflower / soft green stalk
      sunPetal:   new THREE.MeshStandardMaterial({color:0xf2b300,roughness:0.7,emissive:0x3a2900,emissiveIntensity:0.25}),
      sunPetalDk: new THREE.MeshStandardMaterial({color:0xe09a00,roughness:0.7,emissive:0x2a1d00,emissiveIntensity:0.2}),
      sunDisc:    std(0x5b3a1e, 0.9),    // brown sunflower centre
      sunSeed:    std(0x3a2510, 0.9),    // seed speckle
      vine:       std(0x4c7a3c, 0.85),   // climbing-vine foliage
      vineLt:     std(0x6a9a4a, 0.85),
      trellis:    std(0xe6e2d8, 0.6, 0.1), // white-painted trellis / railing
      string:     new THREE.MeshStandardMaterial({color:0xffe6a0,roughness:0.5,emissive:0xffcf6a,emissiveIntensity:0.6}), // string-light bulbs
      bloomRed:   std(0xc0392b, 0.7),    // geranium / pomegranate flower
      bloomPink:  std(0xd86a86, 0.7),
      bloomWhite: std(0xe8e6df, 0.7),
      fruitPom:   std(0xb83b2e, 0.6),    // pomegranate fruit
      fruitFig:   std(0x5a4663, 0.6),    // ripe fig
      fruitApri:  std(0xe39a3b, 0.6),    // apricot fruit
      fruitApriBag: new THREE.MeshStandardMaterial({color:0xd9d27a,roughness:0.6,transparent:true,opacity:0.6}), // mesh fruit bag
      mulberry:   std(0x3a1530, 0.5),    // dark mulberry fruit
      bark:       std(0x6b5436, 0.95),
      barkPale:   std(0x8a7a5e, 0.9),    // pale fig bark
    };
  }

  // small helpers ---------------------------------------------------------
  function rnd(a,b){ return a+Math.random()*(b-a); }
  function pick(arr){ return arr[(Math.random()*arr.length)|0]; }
  function jitter(g,amt){ g.rotation.y=rnd(0,Math.PI*2); g.scale.multiplyScalar(rnd(1-amt,1+amt)); }

  // a black/clay/grey pot: short tapered cylinder + soil disc on top
  function makePot(r,h,potMat,soilMat){
    const g=new THREE.Group();
    const p=new THREE.Mesh(new THREE.CylinderGeometry(r,r*0.78,h,12),potMat);
    p.position.y=h/2; p.castShadow=true; p.receiveShadow=true; g.add(p);
    // a thin rim lip so the black pots read as real plastic nursery pots
    const lip=new THREE.Mesh(new THREE.TorusGeometry(r*0.99,r*0.06,5,12),potMat);
    lip.rotation.x=Math.PI/2; lip.position.y=h; lip.castShadow=true; g.add(lip);
    if(soilMat){ const s=new THREE.Mesh(new THREE.CylinderGeometry(r*0.9,r*0.9,0.03,12),soilMat);
      s.position.y=h-0.015; s.receiveShadow=true; g.add(s); }
    g.userData.rim=h;            // top-of-soil height for stacking plants
    return g;
  }

  // ---- a DENSE leaf cluster: scatter many small flattened spheres in a
  //      blob, with colour + scale jitter. Replaces the old single big
  //      balloon sphere — reads as real foliage. Returns the cluster Group
  //      (caller may push it to `sway`). -----------------------------------
  function leafCluster(R, mats, opts){
    opts=opts||{};
    const g=new THREE.Group();
    const n = opts.n || Math.max(8, Math.round(R*22));   // many small leaves
    const flat = opts.flat!=null ? opts.flat : 0.8;      // y-squash of the blob
    const seg = opts.seg || 5;
    for(let i=0;i<n;i++){
      // random point in a (slightly flattened) sphere of radius R
      const u=Math.random(), v=Math.random(), w=Math.random();
      const rr = R*Math.cbrt(Math.random());
      const th = u*Math.PI*2, ph = Math.acos(2*v-1);
      const lx = rr*Math.sin(ph)*Math.cos(th);
      const ly = rr*Math.cos(ph)*flat;
      const lz = rr*Math.sin(ph)*Math.sin(th);
      const lr = R*rnd(0.16,0.30);                       // small leaf-tuft
      const leaf=new THREE.Mesh(new THREE.SphereGeometry(lr,seg,seg-1), pick(mats));
      leaf.position.set(lx,ly,lz);
      leaf.scale.set(rnd(0.8,1.2), rnd(0.6,0.9), rnd(0.8,1.2));
      leaf.rotation.set(rnd(0,3),rnd(0,3),rnd(0,3));
      if(w>0.92) leaf.scale.multiplyScalar(1.3);         // a few larger lobes at the surface
      leaf.castShadow=true; g.add(leaf);
    }
    return g;
  }

  // ===================================================================
  //  MAIN ENTRY — returns { group, sway } exactly as before.
  // ===================================================================
  function buildGarden(M){
    const sway=[];
    const G=new THREE.Group();
    const PAL=makePalette();

    // gravel apron around the house (unchanged)
    const apron=new THREE.Mesh(new THREE.PlaneGeometry(20,22), M.gravel);
    apron.rotation.x=-Math.PI/2; apron.position.set(4.2,0.01,4.5); apron.receiveShadow=true; G.add(apron);

    // ---- boundary walls of the plot ----
    //   These outline the wider plot (the site plan marks "קיר" along the
    //   west/south/east edges). They must read as the SAME sandy STUCCO as the
    //   house — not grey — or, combined with the old grey foundation pad, the
    //   plot looked like a chunky raised platform. Colour is matched to the
    //   house wall (materials.js M.wall = 0xe0cda3); we reuse M.wall directly
    //   so the texture/lighting match. The street (north) side stays a lower
    //   ~1.3 m garden wall; the side runs are the taller ~2 m backyard wall
    //   from his photos. Thickness ≈0.2 m. (The courtyard back-strip wall
    //   itself is built faithfully in building.js; this is the outer plot line.)
    const bw = M.wall;
    function lowWall(x1,z1,x2,z2,h){ const horiz=Math.abs(z2-z1)<1e-6, len=horiz?Math.abs(x2-x1):Math.abs(z2-z1);
      const m=new THREE.Mesh(new THREE.BoxGeometry(horiz?len:0.2,h,horiz?0.2:len),bw);
      m.position.set((x1+x2)/2,h/2,(z1+z2)/2); m.castShadow=true; m.receiveShadow=true; G.add(m); }
    lowWall(-1.2,-1.2, 9.6,-1.2, 1.30);    // north (street) boundary — lower garden wall
    lowWall(-1.2,-1.2, -1.2,11.0, 2.00);   // west — tall sandy backyard wall
    lowWall(9.6,-1.2, 9.6,11.0, 2.00);     // east — tall sandy backyard wall

    // ---- NEIGHBOUR CLUSTER massing (Alex's unit is 1 of ~5 around a shared plaza) ----
    //   Solid context blocks at the SAME plan-frame positions as the derive.js neighbour
    //   OCCLUDERS, so the picture matches the shading. They rotate with the house (+95°)
    //   → world-WEST (units across the plaza) / world-NORTH (abutting, the sealed wall
    //   faces it) / world-SOUTH (row). world-EAST is left OPEN (the desert/view), and a
    //   plaza gap (~ -1.2..-4.5 on world-W) is left open between Alex and the west units.
    //   Each block is named 'homeblock' + uses its OWN material instance (a clone of
    //   the house stucco) so the "מבנים סביב הבית" display layer (app.js applyBlocks)
    //   can fade/hide JUST the neighbours via the opacity slider, without touching the
    //   house. castShadow off — the REAL neighbour shading is the derive.js occluders;
    //   the scene shadow here would be cosmetic (and odd when the layer is faded).
    const nbrMat=(bw&&bw.clone)?bw.clone():new THREE.MeshStandardMaterial({color:0xe0cda3,roughness:0.95});
    nbrMat.transparent=true;
    [ [-1.0, 10.50, -11.0, -4.5, 6.0],   // world-WEST: units across the plaza
      [10.7, 16.0,   0.0,  10.3, 6.0],   // world-NORTH: abutting unit
      [-7.5, -1.3,   0.0,  10.3, 6.0]    // world-SOUTH: row unit
    ].forEach(([x0,x1,z0,z1,h])=>{
      const m=new THREE.Mesh(new THREE.BoxGeometry(x1-x0,h,z1-z0), nbrMat);
      m.position.set((x0+x1)/2, h/2, (z0+z1)/2);
      m.name='homeblock';            // ← driven by the "מבנים סביב הבית" layer toggle + opacity slider
      m.castShadow=false; m.receiveShadow=true; G.add(m);
    });

    // ============================================================================
    //  DECORATIVE PLANTS + ROCKS — REMOVED per the developer's cleanup (2026-06).
    //  The olives, courtyard potted collection, terrace plants, fruit trees,
    //  desert shrubs, scattered rocks, and aerial-detected trees were drawn props
    //  that cheapened the model. The REAL plants now live as the in-world tracking
    //  markers (garden.js / GardenPins). Kept above: the gravel apron + the plot
    //  boundary walls (structure). The builder helpers (buildCourtyard /
    //  buildTerrace / olive / fruitTree / placeAerialTrees / …) remain defined
    //  below but are no longer invoked.
    // ============================================================================

    return { group:G, sway };
  }

  // ===================================================================
  //  COURTYARD builder
  // ===================================================================
  function buildCourtyard(G,PAL,sway){
    // courtyard footprint: x 0.15..5.55, z 7.35..10.10 (inset from walls)
    // Group dense potted succulents along the WEST wall and the SOUTH wall.

    // --- west-wall run of pots (his big aloe + jade collection) ---
    const westZ=[7.55,7.95,8.35,8.8,9.25,9.65,10.0];
    westZ.forEach((z,i)=>{
      const x=rnd(0.35,0.95);
      const kind=i%3;
      if(kind===0) pottedAloe(x,z, G,PAL,sway);
      else if(kind===1) pottedJade(x,z, G,PAL,sway);
      else pottedSucculent(x,z, G,PAL,sway);
    });
    // a front row spilling toward the courtyard centre (the foreground aloes)
    pottedAloe(1.15, 9.9, G,PAL,sway, 1.25);     // big foreground aloe (terracotta)
    pottedJade(1.4, 9.35, G,PAL,sway, 1.2);
    pottedSucculent(1.5, 8.7, G,PAL,sway);

    // --- a prickly-pear (opuntia) standing tall by the wall ---
    pricklyPear(0.55, 8.55, G,PAL,sway);

    // --- olive sapling in a pot in the courtyard corner ---
    pottedOliveSapling(4.9, 9.9, G,PAL,sway);

    // --- window-box of red geraniums against the house (south wall, z≈7.3) ---
    windowBox(3.1, 7.32, 2.30, G,PAL,sway);      // raised on a low stand under the wall

    // --- herb / flower crates clustered (his red seedling crates) ---
    seedlingCrate(2.0, 9.95, PAL.crateRed, G,PAL,sway);
    seedlingCrate(2.55, 10.0, PAL.crateRed, G,PAL,sway);
    seedlingCrate(2.3, 9.55, PAL.blackPot, G,PAL,sway);

    // --- a scatter of extra small black pots (signature density) ---
    const extra=[[3.0,9.9],[3.4,9.6],[3.7,10.0],[4.1,9.4],[4.4,9.95],[0.4,7.95],[0.5,9.05],[5.2,9.6],[5.0,8.7],[4.7,8.3]];
    extra.forEach(([x,z],i)=>{
      const r=rnd(0.10,0.16), h=rnd(0.16,0.24);
      const pot=makePot(r,h, (i%4===0)?PAL.terracotta:PAL.blackPot, PAL.soil);
      pot.position.set(x,0,z);
      // tiny succulent / shrub tuft — a little dense cluster, not one ball
      const tuft=leafCluster(r*1.05, [PAL.jade,PAL.jadeLt,PAL.succBlue,PAL.sage,PAL.aloe], {n:7,flat:0.7});
      tuft.position.y=h+r*0.5; tuft.castShadow=true; pot.add(tuft);
      jitter(pot,0.08); G.add(pot); sway.push({o:tuft,amp:0.03,ph:Math.random()*6});
    });

    // a watering can by the pots (his real one) — galvanised look
    wateringCan(3.85, 9.15, G,PAL);
  }

  // ===================================================================
  //  TERRACE builder  (deck top at y≈2.80; rim ~ +0.03 for the deck mesh)
  // ===================================================================
  function buildTerrace(G,PAL,sway){
    const Y=2.85;   // sit pots on the terrace deck
    // terrace usable area: x 3.4..10.3, z 3.85..7.0 (inside the railing; the deck
    // is the WIDE south band now reaching x≈10.50 — existing pots sit mid-deck).

    // --- a row of potted BLUEBERRY shrubs in tall black pots (his pride) ---
    pottedBlueberry(7.6, 4.2, Y, G,PAL,sway);
    pottedBlueberry(7.7, 5.0, Y, G,PAL,sway);
    pottedBlueberry(7.5, 5.8, Y, G,PAL,sway, 1.15);

    // --- tall SUNFLOWER (green stalk + yellow petals + brown disc) ---
    sunflower(6.7, 4.3, Y, G,PAL,sway);

    // --- CLIMBING VINES on thin trellis supports against the railing ---
    climbingVine(8.05, 6.4, Y, 2.1, G,PAL,sway);   // tall trellis at SE corner
    climbingVine(4.0, 6.85, Y, 1.9, G,PAL,sway);   // along the south railing
    climbingVine(8.1, 4.8, Y, 1.7, G,PAL,sway);

    // --- a FIG sapling on the terrace (balcony zone per resident_plants) ---
    figTree(4.5, 4.6, 0.7, G,PAL,sway, Y);

    // --- the big ribbed CONCRETE planter (with a young pomegranate) ---
    concretePlanter(5.7, 6.4, Y, G,PAL,sway);

    // --- wooden raised planter boxes (herbs / seedlings + a red geranium) ---
    woodPlanterBox(3.75, 4.4, Y, G,PAL,sway, true);
    woodPlanterBox(3.7, 5.3, Y, G,PAL,sway, false);

    // --- string lights along the south railing (his fairy lights) ---
    stringLights(3.18, 7.05, 8.3, 7.05, Y+1.0, G,PAL);

    // --- scatter of extra black pots on the deck (signature density) ---
    const extra=[[5.0,4.3],[5.4,4.9],[6.0,5.6],[6.6,6.6],[7.0,5.9],[4.4,6.2],[5.0,6.7]];
    extra.forEach(([x,z],i)=>{
      const r=rnd(0.13,0.19), h=rnd(0.22,0.32);
      const pot=makePot(r,h,PAL.blackPot,PAL.soil); pot.position.set(x,Y,z);
      const f=leafCluster(r*1.1, [PAL.emerald,PAL.emeraldDk,PAL.sage,PAL.vine,PAL.olive], {n:8,flat:0.85});
      f.position.y=h+r*0.7; f.castShadow=true; pot.add(f);
      jitter(pot,0.06); G.add(pot); sway.push({o:f,amp:0.04,ph:Math.random()*6});
    });
  }

  /* ============================ PLANT MAKERS ============================ */

  // ---- olive (parametric) — trunk + dense small-leaf canopy (silvery) ----
  function olive(x,z,scale,G,PAL,sway){
    const g=new THREE.Group();
    const tr=new THREE.Mesh(new THREE.CylinderGeometry(0.12*scale,0.18*scale,1.6*scale,7), PAL.bark);
    tr.position.y=0.8*scale; tr.castShadow=true; g.add(tr);
    const canopy=new THREE.Group(); canopy.position.y=1.9*scale;
    // several overlapping DENSE leaf clusters → a full silvery-green crown
    [[0,0,0,1.0],[0.55,0.15,0.2,0.7],[-0.5,0.1,0.25,0.65],[0.2,0.32,-0.45,0.6],[-0.25,0.28,-0.35,0.6],[0.0,0.45,0.0,0.55]]
      .forEach(([dx,dy,dz,r])=>{
        const c=leafCluster(0.6*scale*r, [PAL.olive,PAL.oliveDk,PAL.sage], {flat:0.8});
        c.position.set(dx*scale,dy*scale,dz*scale); canopy.add(c);
      });
    g.add(canopy); g.position.set(x,0,z); G.add(g); sway.push({o:canopy,amp:0.03,ph:Math.random()*6});
  }

  // ---- a single aloe rosette: long upcurving pointed fleshy leaves ----
  function aloeRosette(parent,baseY,scale,mat,matDk){
    const n=13;
    for(let i=0;i<n;i++){
      // a fleshy blade: a tapered cone, flattened, arching outward & up
      const len=rnd(0.8,1.0)*scale;
      const leaf=new THREE.Mesh(new THREE.ConeGeometry(0.065*scale,len,4), (i%2?matDk:mat)||mat);
      const a=i/n*Math.PI*2 + rnd(-0.1,0.1);
      const tilt=rnd(0.45,0.7);                       // outward arch
      leaf.position.set(Math.cos(a)*0.10*scale, baseY+len*0.45*Math.cos(tilt)+0.02, Math.sin(a)*0.10*scale);
      leaf.rotation.set(Math.PI/2-tilt, 0, -a+Math.PI/2);
      leaf.scale.set(1,1,0.42);                       // flatten into a blade
      leaf.castShadow=true; parent.add(leaf);
    }
    // a couple of short central upright leaves
    for(let i=0;i<3;i++){
      const leaf=new THREE.Mesh(new THREE.ConeGeometry(0.05*scale,0.45*scale,4),mat);
      leaf.position.set(rnd(-0.03,0.03)*scale, baseY+0.22*scale, rnd(-0.03,0.03)*scale);
      leaf.rotation.set(rnd(-0.2,0.2),0,rnd(-0.2,0.2)); leaf.scale.set(1,1,0.45);
      leaf.castShadow=true; parent.add(leaf);
    }
  }
  function pottedAloe(x,z,G,PAL,sway,scale){
    scale=scale||rnd(0.9,1.15);
    const r=0.17*scale, h=0.24*scale;
    const pot=makePot(r,h, Math.random()<0.4?PAL.terracotta:PAL.blackPot, PAL.soil);
    aloeRosette(pot,h,scale,PAL.aloe,PAL.aloeDk);
    pot.position.set(x,0,z); jitter(pot,0.06); G.add(pot);
    sway.push({o:pot,amp:0.02,ph:Math.random()*6});
  }

  // ---- jade: rounded clusters of fleshy paddle-leaves on woody stems ----
  function jadeClump(parent,baseY,scale,mat,matLt){
    // short woody stems fanning out, each tipped with a rosette of fleshy ovals
    const stemM=PAL_BARK;
    const tips=[[0,0.20,0],[0.16,0.26,0.05],[-0.14,0.24,0.08],[0.06,0.34,-0.14],[-0.08,0.30,-0.10],[0.18,0.20,-0.08]];
    tips.forEach(([dx,dy,dz],k)=>{
      const tx=dx*scale, ty=baseY+dy*scale, tz=dz*scale;
      // a little fleshy rosette: 4-6 squashed spheres
      const m=k%2?matLt:mat;
      for(let i=0;i<5;i++){
        const a=i/5*Math.PI*2;
        const s=new THREE.Mesh(new THREE.SphereGeometry(0.085*scale*rnd(0.8,1.1),7,6),m);
        s.position.set(tx+Math.cos(a)*0.05*scale, ty+rnd(-0.01,0.03)*scale, tz+Math.sin(a)*0.05*scale);
        s.scale.set(1.0,0.62,1.0); s.castShadow=true; parent.add(s);
      }
      // a crowning paddle
      const top=new THREE.Mesh(new THREE.SphereGeometry(0.075*scale,7,6),m);
      top.position.set(tx,ty+0.05*scale,tz); top.scale.set(1,0.6,1); top.castShadow=true; parent.add(top);
    });
  }
  let PAL_BARK; // set once inside makePalette consumer (see pottedJade)
  function pottedJade(x,z,G,PAL,sway,scale){
    PAL_BARK=PAL.bark;
    scale=scale||rnd(0.9,1.2);
    const r=0.18*scale, h=0.22*scale;
    const pot=makePot(r,h, Math.random()<0.35?PAL.terracotta:PAL.blackPot, PAL.soil);
    jadeClump(pot,h,scale,PAL.jade,PAL.jadeLt);
    pot.position.set(x,0,z); jitter(pot,0.06); G.add(pot);
    sway.push({o:pot,amp:0.025,ph:Math.random()*6});
  }

  // ---- generic low spiky succulent rosette (echeveria-ish) in a pot ----
  function pottedSucculent(x,z,G,PAL,sway,scale){
    scale=scale||rnd(0.85,1.1);
    const r=0.15*scale, h=0.2*scale;
    const pot=makePot(r,h, PAL.blackPot, PAL.soil);
    // tight low rosette of short fat blades, purplish at the tips
    const n=12;
    for(let i=0;i<n;i++){
      const leaf=new THREE.Mesh(new THREE.ConeGeometry(0.055*scale,0.40*scale,4), (i%3===0?PAL.succPurp:PAL.succBlue));
      const a=i/n*Math.PI*2;
      const tilt=0.95-(i%3)*0.12;
      leaf.position.set(Math.cos(a)*0.06*scale, h+0.10*scale, Math.sin(a)*0.06*scale);
      leaf.rotation.set(Math.PI/2-tilt,0,-a+Math.PI/2);
      leaf.scale.set(1,1,0.55); leaf.castShadow=true; pot.add(leaf);
    }
    pot.position.set(x,0,z); jitter(pot,0.06); G.add(pot);
    sway.push({o:pot,amp:0.02,ph:Math.random()*6});
  }

  // ---- prickly-pear / opuntia: flat oval pads stacked, with areole dots --
  function pricklyPear(x,z,G,PAL,sway){
    const g=new THREE.Group();
    const r=0.2, h=0.26;
    const pot=makePot(r,h,PAL.blackPot,PAL.soil); g.add(pot);
    function pad(px,py,pz,s,rot,tilt){
      const grp=new THREE.Group();
      const p=new THREE.Mesh(new THREE.SphereGeometry(0.22*s,12,10), Math.random()<0.5?PAL.cactusPad:PAL.cactusPadLt);
      p.scale.set(0.62,1.0,0.16); p.castShadow=true; grp.add(p);
      // areole dots in a grid across the pad face
      for(let u=-1;u<=1;u++) for(let v=-1;v<=1;v++){
        if(Math.random()<0.35) continue;
        const dot=new THREE.Mesh(new THREE.SphereGeometry(0.012*s,4,3),PAL.areole);
        dot.position.set(u*0.10*s, v*0.14*s, 0.036*s); grp.add(dot);
        const dot2=dot.clone(); dot2.position.z=-0.036*s; grp.add(dot2);
      }
      grp.position.set(px,py,pz); grp.rotation.z=rot||0; grp.rotation.x=tilt||0; g.add(grp); return grp;
    }
    pad(0,h+0.32,0,1.0,0.1,0);
    pad(0.18,h+0.62,0.02,0.8,-0.4,0.2);
    pad(-0.16,h+0.66,-0.02,0.78,0.5,-0.2);
    pad(0.04,h+0.95,0.0,0.62,0.05,0.05);
    pad(0.24,h+0.95,0.04,0.5,-0.7,0.3);
    g.position.set(x,0,z); g.rotation.y=rnd(0,Math.PI); G.add(g);
    sway.push({o:g,amp:0.012,ph:Math.random()*6});
  }

  // ---- olive sapling in a pot (thin trunk, sparse silvery canopy) ----
  function pottedOliveSapling(x,z,G,PAL,sway){
    const g=new THREE.Group();
    const r=0.2, h=0.3;
    const pot=makePot(r,h,PAL.blackPot,PAL.soil); g.add(pot);
    const tr=new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.05,1.5,6),PAL.bark);
    tr.position.y=h+0.75; tr.castShadow=true; g.add(tr);
    const can=new THREE.Group(); can.position.y=h+1.45;
    [[0,0,0,0.36],[0.18,0.08,0.05,0.26],[-0.15,0.05,0.1,0.24],[0.05,0.2,-0.12,0.22]]
      .forEach(([dx,dy,dz,rr])=>{ const c=leafCluster(rr, [PAL.sage,PAL.olive,PAL.oliveDk], {n:9,flat:0.85});
        c.position.set(dx,dy,dz); can.add(c); });
    g.add(can); g.position.set(x,0,z); jitter(g,0.04); G.add(g);
    sway.push({o:can,amp:0.05,ph:Math.random()*6});
  }

  // ---- window box (rectangular trough) of red geraniums on a low stand ----
  function windowBox(x,z,standH,G,PAL,sway){
    const g=new THREE.Group();
    // low metal stand legs
    const legM=new THREE.MeshStandardMaterial({color:0x4a4a48,roughness:0.7,metalness:0.3});
    [-0.35,0.35].forEach(sx=>{ const l=new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,standH,6),legM);
      l.position.set(sx,standH/2,0); l.castShadow=true; g.add(l); });
    // trough
    const box=new THREE.Mesh(new THREE.BoxGeometry(0.85,0.18,0.22),PAL.blackPot);
    box.position.y=standH+0.09; box.castShadow=true; box.receiveShadow=true; g.add(box);
    const soil=new THREE.Mesh(new THREE.BoxGeometry(0.8,0.04,0.18),PAL.soil);
    soil.position.y=standH+0.18; g.add(soil);
    // green tufts + red geranium blooms (dense little clusters + bloom balls)
    for(let i=0;i<6;i++){
      const f=leafCluster(0.11, [PAL.emerald,PAL.emeraldDk,PAL.leafLt], {n:6,flat:0.9});
      f.position.set(-0.34+i*0.135, standH+0.27, rnd(-0.05,0.05)); f.castShadow=true; g.add(f);
      // geranium umbel: a tight cluster of small red florets
      for(let k=0;k<5;k++){ const b=new THREE.Mesh(new THREE.SphereGeometry(0.022,5,4), Math.random()<0.3?PAL.bloomPink:PAL.bloomRed);
        b.position.set(-0.34+i*0.135+rnd(-0.03,0.03), standH+0.36+rnd(-0.02,0.02), rnd(-0.03,0.03)); g.add(b); }
    }
    g.position.set(x,0,z); G.add(g);
    sway.push({o:g,amp:0.015,ph:Math.random()*6});
  }

  // ---- a shallow seedling crate full of small herb/flower tufts ----
  function seedlingCrate(x,z,mat,G,PAL,sway){
    const g=new THREE.Group();
    const crate=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.18,0.36),mat);
    crate.position.y=0.09; crate.castShadow=true; crate.receiveShadow=true; g.add(crate);
    const soil=new THREE.Mesh(new THREE.BoxGeometry(0.46,0.03,0.32),PAL.soil);
    soil.position.y=0.18; g.add(soil);
    const greens=[PAL.sage,PAL.emerald,PAL.emeraldDk,PAL.olive,PAL.vine,PAL.leafLt];
    for(let i=0;i<8;i++){
      const f=leafCluster(rnd(0.07,0.1), greens, {n:6,flat:0.9});
      f.position.set(rnd(-0.2,0.2),rnd(0.22,0.26),rnd(-0.13,0.13)); f.castShadow=true; g.add(f);
      if(Math.random()<0.4){ const bl=new THREE.Mesh(new THREE.SphereGeometry(0.025,5,4),
          Math.random()<0.5?PAL.bloomRed:PAL.bloomWhite); bl.position.copy(f.position); bl.position.y+=0.06; g.add(bl); }
    }
    g.position.set(x,0,z); g.rotation.y=rnd(-0.3,0.3); G.add(g);
    sway.push({o:g,amp:0.02,ph:Math.random()*6});
  }

  // ---- galvanised watering can (his real one) ----
  function wateringCan(x,z,G,PAL){
    const g=new THREE.Group();
    const metal=new THREE.MeshStandardMaterial({color:0x9aa0a3,roughness:0.5,metalness:0.6});
    const body=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.14,0.22,12),metal);
    body.position.y=0.13; body.castShadow=true; g.add(body);
    const spout=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.035,0.34,8),metal);
    spout.position.set(0.2,0.2,0); spout.rotation.z=-0.7; spout.castShadow=true; g.add(spout);
    const handle=new THREE.Mesh(new THREE.TorusGeometry(0.07,0.012,6,10,Math.PI),metal);
    handle.position.set(-0.05,0.27,0); handle.rotation.x=Math.PI/2; g.add(handle);
    g.position.set(x,0,z); g.rotation.y=rnd(0,Math.PI*2); G.add(g);
  }

  /* --------------------------- TERRACE plants -------------------------- */

  // ---- one arching blueberry stem with a fan of glossy ovate leaves ----
  function blueberryStem(parent, baseY, len, ang, lean, PAL){
    const stemM=new THREE.MeshStandardMaterial({color:0x5a4636,roughness:0.9});
    const seg=4;                                   // a gently arching cane
    let px=0, py=baseY, pz=0, dirx=Math.cos(ang)*lean, dirz=Math.sin(ang)*lean, diry=1.0;
    for(let s=0;s<seg;s++){
      const sl=len/seg;
      const st=new THREE.Mesh(new THREE.CylinderGeometry(0.012,0.016,sl,5),stemM);
      const nx=px+dirx*sl, ny=py+diry*sl, nz=pz+dirz*sl;
      st.position.set((px+nx)/2,(py+ny)/2,(pz+nz)/2);
      st.lookAt(new THREE.Vector3(nx,ny,nz)); st.rotateX(Math.PI/2);
      st.castShadow=true; parent.add(st);
      // a fan of 3-4 glossy ovate leaves along this segment
      for(let l=0;l<3;l++){
        const leaf=new THREE.Mesh(new THREE.SphereGeometry(rnd(0.05,0.075),6,5), Math.random()<0.5?PAL.blueberry:PAL.blueberryLt);
        leaf.scale.set(0.55,0.16,1.0);             // flat ovate leaf
        const la=ang+rnd(-1,1);
        leaf.position.set((px+nx)/2+Math.cos(la)*0.06,(py+ny)/2+rnd(-0.02,0.04),(pz+nz)/2+Math.sin(la)*0.06);
        leaf.rotation.set(rnd(-0.3,0.3),la,rnd(-0.2,0.2)); leaf.castShadow=true; parent.add(leaf);
      }
      diry*=0.82; dirx*=1.05; dirz*=1.05;          // arch over toward horizontal
      px=nx; py=ny; pz=nz;
    }
    return {x:px,y:py,z:pz};
  }
  // ---- potted blueberry: arching stems, glossy leaf fans + crowned berries
  function pottedBlueberry(x,z,Y,G,PAL,sway,scale){
    scale=scale||rnd(0.95,1.1);
    const g=new THREE.Group();
    const r=0.22*scale, h=0.5*scale;          // tall black/grey nursery pot
    const pot=makePot(r,h,PAL.blackPot2,PAL.soil); g.add(pot);
    const can=new THREE.Group(); can.position.y=h;
    const tips=[];
    const nstem=5;
    for(let s=0;s<nstem;s++){
      const tip=blueberryStem(can, 0, rnd(0.7,0.95)*scale, s/nstem*Math.PI*2, rnd(0.18,0.30), PAL);
      tips.push(tip);
    }
    // a few dusty-blue berries with a pale calyx crown, hanging near the tips
    for(let b=0;b<9;b++){
      const t=pick(tips);
      const berry=new THREE.Mesh(new THREE.SphereGeometry(0.026,7,6),PAL.berry);
      berry.position.set(t.x+rnd(-0.06,0.06), t.y+rnd(-0.08,0.0), t.z+rnd(-0.06,0.06));
      berry.scale.y=0.92; berry.castShadow=true; can.add(berry);
      const crown=new THREE.Mesh(new THREE.SphereGeometry(0.012,5,4),PAL.berryCrown);
      crown.position.copy(berry.position); crown.position.y+=0.024; crown.scale.set(1,0.5,1); can.add(crown);
    }
    g.add(can); g.position.set(x,Y,z); jitter(g,0.04); G.add(g);
    sway.push({o:can,amp:0.05,ph:Math.random()*6});
  }

  // ---- tall sunflower: ridged stalk, broad leaves, layered ray petals ----
  function sunflower(x,z,Y,G,PAL,sway){
    const g=new THREE.Group();
    const r=0.18, h=0.34;
    const pot=makePot(r,h,PAL.blackPot,PAL.soil); g.add(pot);
    const Hstalk=1.7;
    const stalk=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.05,Hstalk,8),PAL.stalk);
    stalk.position.y=h+Hstalk/2; stalk.castShadow=true; g.add(stalk);
    // broad heart-shaped leaves up the stalk
    for(let i=0;i<4;i++){
      const leaf=new THREE.Mesh(new THREE.SphereGeometry(0.18,8,6),PAL.stalk);
      leaf.scale.set(1.2,0.09,0.85);
      const a=i*2.0, yy=h+0.45+i*0.34;
      leaf.position.set(Math.cos(a)*0.2,yy,Math.sin(a)*0.2);
      leaf.rotation.y=a; leaf.rotation.z=0.35; leaf.castShadow=true; g.add(leaf);
    }
    // flower head at the top, facing roughly up/out
    const head=new THREE.Group(); head.position.y=h+Hstalk+0.04; head.rotation.x=-0.35;
    // green sepal backing
    const back=new THREE.Mesh(new THREE.CylinderGeometry(0.17,0.17,0.03,18),PAL.stalk);
    back.position.y=-0.02; head.add(back);
    // two offset rings of ray petals (denser, layered)
    function petalRing(R, count, mat, yo, twist){
      for(let i=0;i<count;i++){
        const pet=new THREE.Mesh(new THREE.ConeGeometry(0.035,0.18,4),mat);
        const a=i/count*Math.PI*2 + (twist||0);
        pet.position.set(Math.cos(a)*R, yo, Math.sin(a)*R);
        pet.rotation.set(Math.PI/2,0,-a+Math.PI/2); pet.scale.set(1,1,0.38);
        head.add(pet);
      }
    }
    petalRing(0.165, 16, PAL.sunPetalDk, 0.0, 0);
    petalRing(0.15, 16, PAL.sunPetal, 0.02, Math.PI/16);
    // seeded brown disc
    const disc=new THREE.Mesh(new THREE.CylinderGeometry(0.115,0.115,0.05,18),PAL.sunDisc);
    disc.position.y=0.03; head.add(disc);
    for(let i=0;i<40;i++){ const s=new THREE.Mesh(new THREE.SphereGeometry(0.009,4,3),PAL.sunSeed);
      const rr=Math.sqrt(Math.random())*0.10, a=Math.random()*Math.PI*2;
      s.position.set(Math.cos(a)*rr,0.058,Math.sin(a)*rr); head.add(s); }
    g.add(head); g.position.set(x,Y,z); g.rotation.y=rnd(0,Math.PI*2); G.add(g);
    sway.push({o:head,amp:0.04,ph:Math.random()*6});
    sway.push({o:stalk,amp:0.015,ph:Math.random()*6});
  }

  // ---- climbing vine on a thin white trellis: uprights + crossbars + leaves
  function climbingVine(x,z,Y,height,G,PAL,sway){
    const g=new THREE.Group();
    const r=0.16, h=0.26;
    const pot=makePot(r,h,PAL.blackPot,PAL.soil); g.add(pot);
    // trellis: 2 thin uprights + crossbars (white-painted)
    const up=(sx)=>{ const u=new THREE.Mesh(new THREE.CylinderGeometry(0.012,0.012,height,6),PAL.trellis);
      u.position.set(sx,h+height/2,0); u.castShadow=true; g.add(u); };
    up(-0.12); up(0.12);
    for(let i=1;i<=3;i++){ const cb=new THREE.Mesh(new THREE.CylinderGeometry(0.008,0.008,0.26,6),PAL.trellis);
      cb.rotation.z=Math.PI/2; cb.position.set(0,h+height*i/3.5,0); g.add(cb); }
    // vine: spiralling line of small leafy clusters climbing the trellis
    const vg=new THREE.Group();
    const turns=Math.round(height/0.12);
    for(let i=0;i<turns;i++){
      const t=i/turns, a=t*Math.PI*6;
      const lf=leafCluster(rnd(0.06,0.09), [PAL.vine,PAL.vineLt,PAL.emerald], {n:5,flat:0.7});
      lf.position.set(Math.cos(a)*0.13, h+0.1+t*height, Math.sin(a)*0.13);
      vg.add(lf);
      // an occasional tendril / pink bloom (his climbers flower)
      if(Math.random()<0.18){ const bl=new THREE.Mesh(new THREE.SphereGeometry(0.025,5,4),PAL.bloomPink);
        bl.position.set(Math.cos(a)*0.15, h+0.1+t*height, Math.sin(a)*0.15); vg.add(bl); }
    }
    g.add(vg); g.position.set(x,Y,z); g.rotation.y=rnd(0,Math.PI*2); G.add(g);
    sway.push({o:vg,amp:0.06,ph:Math.random()*6});
  }

  // ---- big ribbed LIGHT-GREY concrete planter w/ a young pomegranate ----
  function concretePlanter(x,z,Y,G,PAL,sway){
    const g=new THREE.Group();
    const r=0.36, h=0.62;
    // ribbed body: stack thin discs of slightly varying radius for the ribs
    const body=new THREE.Group();
    const ribs=10;
    for(let i=0;i<ribs;i++){
      const rr=r*(0.86 + 0.14*(i/ (ribs-1)));
      const rad = rr * (1 + (i%2? 0.0 : 0.012));   // subtle horizontal ridging
      const disc=new THREE.Mesh(new THREE.CylinderGeometry(rad,rad,h/ribs+0.004,20),PAL.greyPot);
      disc.position.y=h*(i+0.5)/ribs; disc.castShadow=true; disc.receiveShadow=true; body.add(disc);
    }
    g.add(body);
    const soil=new THREE.Mesh(new THREE.CylinderGeometry(r*0.86,r*0.86,0.03,18),PAL.soil);
    soil.position.y=h-0.015; g.add(soil);
    // young pomegranate: thin trunk, glossy foliage, a couple of red flowers
    const tr=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.05,0.7,6),PAL.bark);
    tr.position.y=h+0.35; tr.castShadow=true; g.add(tr);
    const can=new THREE.Group(); can.position.y=h+0.8;
    [[0,0,0,0.38],[0.2,0.06,0.04,0.26],[-0.16,0.04,0.1,0.24],[0.04,0.22,-0.12,0.22]]
      .forEach(([dx,dy,dz,rr])=>{ const c=leafCluster(rr, [PAL.emerald,PAL.emeraldDk,PAL.leafLt], {flat:0.85});
        c.position.set(dx,dy,dz); can.add(c); });
    for(let i=0;i<5;i++){ const fl=new THREE.Mesh(new THREE.SphereGeometry(0.03,5,4),PAL.bloomRed);
      fl.position.set(rnd(-0.25,0.25),rnd(-0.05,0.2),rnd(-0.2,0.2)); can.add(fl); }
    g.add(can); g.position.set(x,Y,z); jitter(g,0.03); G.add(g);
    sway.push({o:can,amp:0.04,ph:Math.random()*6});
  }

  // ---- wooden raised planter box (herbs / seedlings, optional geranium) --
  function woodPlanterBox(x,z,Y,G,PAL,sway,withBloom){
    const g=new THREE.Group();
    const w=0.7,d=0.36,bh=0.34, legH=0.28;
    // legs
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sz])=>{
      const l=new THREE.Mesh(new THREE.BoxGeometry(0.05,legH,0.05),PAL.woodBox);
      l.position.set(sx*(w/2-0.05),legH/2,sz*(d/2-0.05)); l.castShadow=true; g.add(l); });
    const box=new THREE.Mesh(new THREE.BoxGeometry(w,bh,d),PAL.woodBox);
    box.position.y=legH+bh/2; box.castShadow=true; box.receiveShadow=true; g.add(box);
    const soil=new THREE.Mesh(new THREE.BoxGeometry(w-0.08,0.04,d-0.08),PAL.soil);
    soil.position.y=legH+bh; g.add(soil);
    const greens=[PAL.sage,PAL.emerald,PAL.emeraldDk,PAL.olive,PAL.vine,PAL.leafLt];
    for(let i=0;i<7;i++){ const f=leafCluster(rnd(0.08,0.11), greens, {n:7,flat:0.9});
      f.position.set(rnd(-w/2+0.1,w/2-0.1),legH+bh+rnd(0.05,0.12),rnd(-d/2+0.08,d/2-0.08));
      f.castShadow=true; g.add(f); }
    if(withBloom){ // a red geranium spilling over one end
      for(let k=0;k<7;k++){ const b=new THREE.Mesh(new THREE.SphereGeometry(0.025,5,4),Math.random()<0.3?PAL.bloomPink:PAL.bloomRed);
        b.position.set(-w/2+0.12+rnd(-0.05,0.05), legH+bh+rnd(0.12,0.22), rnd(-0.08,0.08)); g.add(b); }
    }
    g.position.set(x,Y,z); g.rotation.y=rnd(-0.2,0.2); G.add(g);
    sway.push({o:g,amp:0.02,ph:Math.random()*6});
  }

  // ---- string lights: a drooping wire with little glowing bulbs ----
  function stringLights(x1,z1,x2,z2,y,G,PAL){
    const g=new THREE.Group();
    const wireM=new THREE.MeshStandardMaterial({color:0x222222,roughness:0.8});
    const N=14;
    const sag=0.18;
    for(let i=0;i<=N;i++){
      const t=i/N;
      const px=x1+(x2-x1)*t, pz=z1+(z2-z1)*t;
      const py=y - Math.sin(t*Math.PI)*sag;             // catenary-ish droop
      if(i<N){ // wire segment to next point
        const t2=(i+1)/N, nx=x1+(x2-x1)*t2, nz=z1+(z2-z1)*t2, ny=y-Math.sin(t2*Math.PI)*sag;
        const seg=new THREE.Mesh(new THREE.CylinderGeometry(0.004,0.004,Math.hypot(nx-px,ny-py,nz-pz),4),wireM);
        seg.position.set((px+nx)/2,(py+ny)/2,(pz+nz)/2);
        seg.lookAt(new THREE.Vector3(nx,ny,nz)); seg.rotateX(Math.PI/2); g.add(seg);
      }
      if(i%1===0){ const bulb=new THREE.Mesh(new THREE.SphereGeometry(0.022,6,5),PAL.string);
        bulb.position.set(px,py-0.03,pz); g.add(bulb); }
    }
    G.add(g);
  }

  /* ----------------------------- FRUIT TREES --------------------------- */

  // ---- generic small fruit tree (trunk + DENSE clustered canopy + fruit) -
  function fruitTree(x,z,scale,leafMats,fruitMat,G,PAL,sway,baseY,fruitN){
    baseY=baseY||0;
    const g=new THREE.Group();
    const tr=new THREE.Mesh(new THREE.CylinderGeometry(0.07*scale,0.11*scale,1.3*scale,7),PAL.bark);
    tr.position.y=0.65*scale; tr.castShadow=true; g.add(tr);
    // a couple of forked branches for a less lollipop silhouette
    [[0.3,1.1,0.6],[-0.35,1.15,-0.5]].forEach(([bx,by,bang])=>{
      const br=new THREE.Mesh(new THREE.CylinderGeometry(0.03*scale,0.05*scale,0.7*scale,5),PAL.bark);
      br.position.set(bx*0.5*scale,by*scale,0); br.rotation.z=bang; br.castShadow=true; g.add(br);
    });
    const canopy=new THREE.Group(); canopy.position.y=1.5*scale;
    [[0,0,0,1.0],[0.5,0.15,0.18,0.72],[-0.45,0.1,0.22,0.7],[0.18,0.32,-0.4,0.66],[-0.2,0.3,-0.28,0.64],[0.0,0.42,0.0,0.6]]
      .forEach(([dx,dy,dz,rr])=>{ const c=leafCluster(0.5*scale*rr, leafMats, {flat:0.9});
        c.position.set(dx*scale,dy*scale,dz*scale); canopy.add(c); });
    if(fruitMat){ const fn=fruitN||8; for(let i=0;i<fn;i++){ const fr=new THREE.Mesh(new THREE.SphereGeometry(0.05*scale,6,5),fruitMat);
      fr.position.set(rnd(-0.5,0.5)*scale,rnd(-0.15,0.35)*scale,rnd(-0.5,0.5)*scale); canopy.add(fr); } }
    g.add(canopy); g.position.set(x,baseY,z); jitter(g,0.03); G.add(g);
    sway.push({o:canopy,amp:0.035,ph:Math.random()*6});
  }

  // ---- apricot: broad-leaved small tree with golden fruit + a few mesh bags
  function apricotTree(x,z,scale,G,PAL,sway,baseY){
    baseY=baseY||0;
    fruitTree(x,z,scale,[PAL.olive,PAL.emerald,PAL.leafLt,PAL.sage],PAL.fruitApri,G,PAL,sway,baseY,11);
    // his fruit-protection mesh bags hanging in the canopy
    const tag=new THREE.Group(); tag.position.set(x,baseY+1.5*scale,z);
    for(let i=0;i<5;i++){ const bag=new THREE.Mesh(new THREE.SphereGeometry(0.07*scale,6,5),PAL.fruitApriBag);
      bag.position.set(rnd(-0.45,0.45)*scale,rnd(-0.1,0.25)*scale,rnd(-0.45,0.45)*scale); bag.scale.y=1.25; tag.add(bag); }
    G.add(tag);
  }

  // ---- mulberry: rounded leafy tree with dark berries (he picks these) ----
  function mulberryTree(x,z,scale,G,PAL,sway,baseY){
    fruitTree(x,z,scale,[PAL.emerald,PAL.emeraldDk,PAL.leafLt],PAL.mulberry,G,PAL,sway,baseY||0,12);
  }

  // ---- fig: broad-leaved small tree (bigger, lobed-looking canopy) ----
  function figTree(x,z,scale,G,PAL,sway,baseY){
    baseY=baseY||0;
    const g=new THREE.Group();
    const tr=new THREE.Mesh(new THREE.CylinderGeometry(0.06*scale,0.1*scale,1.1*scale,6),PAL.barkPale);  // pale fig bark
    tr.position.y=0.55*scale; tr.castShadow=true; g.add(tr);
    const can=new THREE.Group(); can.position.y=1.3*scale;
    // broad fig foliage from flattened dense clusters
    [[0,0,0,1.0],[0.42,0.1,0.12,0.72],[-0.38,0.08,0.2,0.7],[0.12,0.28,-0.32,0.66],[-0.16,0.25,-0.22,0.64],[0.0,0.4,0.0,0.6]]
      .forEach(([dx,dy,dz,rr])=>{ const c=leafCluster(0.5*scale*rr, [PAL.emerald,PAL.emeraldDk,PAL.leafLt], {flat:0.62});
        c.position.set(dx*scale,dy*scale,dz*scale); c.scale.set(1.15,1.0,1.15); can.add(c); });
    // a few ripe figs
    for(let i=0;i<5;i++){ const fg=new THREE.Mesh(new THREE.SphereGeometry(0.05*scale,6,5),PAL.fruitFig);
      fg.position.set(rnd(-0.4,0.4)*scale,rnd(-0.1,0.25)*scale,rnd(-0.4,0.4)*scale); fg.scale.y=1.2; can.add(fg); }
    g.add(can); g.position.set(x,baseY,z); jitter(g,0.03); G.add(g);
    sway.push({o:can,amp:0.04,ph:Math.random()*6});
  }

  // ---- pomegranate in a raised stone-edged bed (his courtyard pomegranate)
  function pomegranateBed(x,z,G,PAL,sway){
    const g=new THREE.Group();
    // low stone kerb ring around a soil bed
    const stoneM=new THREE.MeshStandardMaterial({color:0xcdb892,roughness:0.95});
    const bed=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.55,0.22,12),stoneM);
    bed.position.y=0.11; bed.castShadow=true; bed.receiveShadow=true; g.add(bed);
    const soil=new THREE.Mesh(new THREE.CylinderGeometry(0.47,0.47,0.03,12),PAL.soil);
    soil.position.y=0.225; g.add(soil);
    // multi-stem pomegranate shrub with red flowers + a couple of fruit
    for(let s=0;s<3;s++){ const st=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.04,1.0,6),PAL.bark);
      const a=s/3*Math.PI*2; st.position.set(Math.cos(a)*0.1,0.7,Math.sin(a)*0.1);
      st.rotation.z=Math.cos(a)*0.15; st.castShadow=true; g.add(st); }
    const can=new THREE.Group(); can.position.y=1.25;
    [[0,0,0,1.0],[0.42,0.12,0.16,0.72],[-0.4,0.08,0.22,0.7],[0.14,0.3,-0.34,0.66],[-0.16,0.26,-0.24,0.64]]
      .forEach(([dx,dy,dz,rr])=>{ const c=leafCluster(0.42*rr, [PAL.emerald,PAL.emeraldDk,PAL.leafLt], {flat:0.88});
        c.position.set(dx,dy,dz); can.add(c); });
    for(let i=0;i<9;i++){ const fl=new THREE.Mesh(new THREE.SphereGeometry(0.035,5,4),PAL.bloomRed);
      fl.position.set(rnd(-0.42,0.42),rnd(-0.1,0.3),rnd(-0.42,0.42)); can.add(fl); }
    for(let i=0;i<3;i++){ const fr=new THREE.Mesh(new THREE.SphereGeometry(0.06,7,6),PAL.fruitPom);
      fr.position.set(rnd(-0.35,0.35),rnd(-0.15,0.1),rnd(-0.35,0.35)); fr.scale.y=1.05; can.add(fr); }
    g.add(can); g.position.set(x,0,z); G.add(g);
    sway.push({o:can,amp:0.035,ph:Math.random()*6});
  }

  // ---- desert shrub (varied greens, small dense cluster) ----
  function desertShrub(x,z,G,PAL,sway){
    const f=leafCluster(0.22+Math.random()*0.18, [PAL.aloe,PAL.aloeDk,PAL.olive,PAL.sage], {n:7,flat:0.7});
    f.position.set(x,0.18,z); f.castShadow=true; G.add(f);
    sway.push({o:f,amp:0.05,ph:Math.random()*6});
  }

  /* ======================= DATA-GROUNDED TREES ========================= */
  // Read geo/central_wide.png, detect vegetation, cluster it, and plant
  // Alex's bigger trees/shrubs at real canopy centroids (≤~40 m, outside the
  // footprint). Async via an offscreen canvas — same technique as town.js.
  //
  // World↔local: app.js shifts the garden group by (-HCX,-HCZ)=(-4.2,-5.1)
  // and spins houseWrap +5° about world-Y. The PNG is centred on the house
  // at the WORLD origin, so to place a tree at world (wx,wz) we map back to
  // GARDEN-LOCAL coords (the frame this file authors in):
  //     undo the +5° spin:  (rx,rz) = R(-5°)·(wx,wz)
  //     undo the offset:     local = (rx + HCX, rz + HCZ)
  // (HCX/HCZ are app.js's house-centre constants; if those ever change, the
  //  trees shift with the house, which is correct.)
  function placeAerialTrees(G,PAL,sway){
    const W_M = 1050;                 // aerial ground width in metres (brief)
    const HCX = 4.2, HCZ = 5.1;       // mirror of app.js house-centre offset
    const ROT = THREE.MathUtils.degToRad(5);
    const cos = Math.cos(-ROT), sin = Math.sin(-ROT);
    const RADIUS = 40;                // only plant within ~40 m of the house
    function worldToLocal(wx, wz){
      const rx = wx*cos - wz*sin;     // R(-ROT)
      const rz = wx*sin + wz*cos;
      return { x: rx + HCX, z: rz + HCZ };
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';    // same-origin, harmless
    img.onload = ()=>{
      let W,H,data;
      try{
        W=img.naturalWidth; H=img.naturalHeight;
        const c=document.createElement('canvas'); c.width=W; c.height=H;
        const ctx=c.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(img,0,0);
        data=ctx.getImageData(0,0,W,H).data;
      }catch(e){ return; }            // tainted/failed canvas → skip silently

      // ---- coarse vegetation mask on a downsampled grid ----------------
      // We only care about a window ±~45 m around the house, so we restrict
      // the scan to the central pixels (saves work + ignores far suburbs).
      // px→world: world_x=(px/W-0.5)*1050 ; world_z=(py/H-0.5)*1050.
      const mPerPxX = W_M / W, mPerPxY = W_M / H;
      const halfWinPxX = Math.ceil((RADIUS+8)/mPerPxX);
      const halfWinPxY = Math.ceil((RADIUS+8)/mPerPxY);
      const cx = W/2, cy = H/2;
      const xs = Math.max(0, Math.floor(cx-halfWinPxX)), xe = Math.min(W, Math.ceil(cx+halfWinPxX));
      const ys = Math.max(0, Math.floor(cy-halfWinPxY)), ye = Math.min(H, Math.ceil(cy+halfWinPxY));
      const STEP = 2;                  // sample every 2 px (still fine-grained)

      // vegetation test — the SAME validated rule town.js uses:
      //   green clearly dominates red AND blue (ratio OR absolute margin).
      function isVeg(i){
        const r=data[i], g=data[i+1], b=data[i+2];
        return (g>r*1.08 && g>b*1.08) || (g>r+14 && g>b+14);
      }

      // collect vegetation sample points (in world metres)
      const pts=[];
      for(let py=ys; py<ye; py+=STEP){
        for(let px=xs; px<xe; px+=STEP){
          const i=(py*W+px)*4;
          if(data[i+3]<128) continue;            // transparent → skip
          if(!isVeg(i)) continue;
          const wx=(px/W-0.5)*W_M, wz=(py/H-0.5)*W_M;
          if(Math.hypot(wx,wz) > RADIUS) continue;
          pts.push([wx,wz]);
        }
      }
      if(pts.length===0) return;

      // ---- cluster the vegetation points (simple grid-bucket clustering) -
      // Bucket onto a ~4 m grid, keep buckets with enough hits, then merge
      // adjacent buckets greedily into canopy centroids.
      const CELL=4;                              // metres
      const buckets=new Map();
      for(const [wx,wz] of pts){
        const bx=Math.round(wx/CELL), bz=Math.round(wz/CELL);
        const key=bx+','+bz;
        let e=buckets.get(key);
        if(!e){ e={bx,bz,n:0,sx:0,sz:0}; buckets.set(key,e); }
        e.n++; e.sx+=wx; e.sz+=wz;
      }
      // keep dense buckets only (a real canopy lights up many sample pixels)
      const MIN_HITS=10;
      const dense=[...buckets.values()].filter(e=>e.n>=MIN_HITS)
                    .sort((a,b)=>b.n-a.n);

      // greedy merge: absorb any kept bucket within MERGE_R of an accepted
      // cluster centroid, so one tree-clump → one tree.
      const MERGE_R=5.0;                         // metres
      const clusters=[];
      for(const e of dense){
        const ex=e.sx/e.n, ez=e.sz/e.n;
        let merged=false;
        for(const c of clusters){
          if(Math.hypot(ex-c.x, ez-c.z) < MERGE_R){
            c.x=(c.x*c.w+ex*e.n)/(c.w+e.n);
            c.z=(c.z*c.w+ez*e.n)/(c.w+e.n);
            c.w+=e.n; merged=true; break;
          }
        }
        if(!merged) clusters.push({x:ex,z:ez,w:e.n});
      }

      // ---- place trees at the strongest clusters, OUTSIDE the footprint --
      // Convert each world centroid to garden-local; reject any that lands
      // in the heated footprint or under the terrace deck; cap the count so
      // a handful of well-placed trees beats arbitrary scatter.
      clusters.sort((a,b)=>b.w-a.w);
      let n=0; const MAX=8; const used=[];
      const report=[];
      for(const c of clusters){
        if(n>=MAX) break;
        const loc=worldToLocal(c.x, c.z);
        if(inFootprint(loc.x, loc.z, 0)) continue;       // never inside a room
        if(onDeck(loc.x, loc.z)) continue;
        // don't drop two aerial trees on top of each other (local spacing)
        if(used.some(u=>Math.hypot(u.x-loc.x,u.z-loc.z)<3.0)) continue;
        // size from cluster weight: bigger canopy → bigger tree
        const scale = Math.min(1.5, 0.85 + c.w/600);
        // alternate species so the planting reads like his mixed garden
        const kind = n%3;
        if(kind===0)      olive(loc.x, loc.z, scale, G,PAL,sway);
        else if(kind===1) fruitTree(loc.x, loc.z, scale, [PAL.emerald,PAL.emeraldDk,PAL.olive,PAL.leafLt], null, G,PAL,sway);
        else              figTree(loc.x, loc.z, scale*0.95, G,PAL,sway);
        used.push(loc); n++;
        report.push({wx:+c.x.toFixed(1), wz:+c.z.toFixed(1), lx:+loc.x.toFixed(2), lz:+loc.z.toFixed(2), hits:c.w, scale:+scale.toFixed(2)});
      }
      // leave a breadcrumb for debugging / the build report
      try{
        window.__aerialTrees = { sampledVegPx:pts.length, clusters:clusters.length, planted:n, trees:report };
        if(window.console) console.log('[environment] aerial vegetation → '+n+' trees planted (of '+clusters.length+' clusters, '+pts.length+' veg samples within '+RADIUS+'m)', report);
      }catch(e){}
    };
    img.onerror = ()=>{ /* aerial unavailable → garden still complete without data trees */ };
    img.src = 'geo/central_wide.png';
  }

  return { buildGarden };
})();
window.Environment = Environment;
