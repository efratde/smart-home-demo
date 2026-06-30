/* ===================================================================
   building.js — a FICTIONAL L-shaped house, generated parametrically for the
   smart-home demo. Every dimension below is a generic modelling value: there
   is no real property, no permit/blueprint, and no photographs behind it.
   The numbers exist only so the 3D massing renders a believable little house.

   World frame: +x = east, +y = up, +z = SOUTH.  Origin = NW corner of the
   built block.  Distances in METRES.

   FOOTPRINT (from the area table + plans) — the block is an L in plan:
     NORTH band       x 0.00..8.41   z 0.00..3.60   (top chain 841 = 144+637+60)
     SOUTH band       x 0.00..10.50  z 3.60..7.20   (living+terrace; juts +2.09 m E,
                        stepping at z=GZ=3.60; bottom courtyard chain 1050)
     back strip       z 7.20..10.29  (309 deep): חצר (courtyard, now to x 10.50) + מחסן
     storage (מחסן)   2.72 × 2.94  →  x 7.78..10.50  z 7.20..10.14  (SE of the wider courtyard)
   LEVELS (from sections/elevations):
     ground floor finish ............. +0.00
     first-floor / terrace finish .... +2.80   (ground storey ≈ 2.80)
     roof slab (top of upper volume) . +5.30   (upper storey ≈ 2.50)
     top parapet ..................... +5.70
     terrace railing top ............. +3.88
     storage shingle roof ............ +2.30 (ridge) .. +2.55 (parapet)

   PUBLIC API (unchanged — app.js / sky.js depend on it):
     Building.build(M) -> THREE.Group with
        userData = { glass:[Mesh…], ilights:[PointLight…], center:{x,z}, GH, UH }
     Building.GH (exported number)
   =================================================================== */
const Building = (function(){
  // real storey heights (m)
  const GH = 2.80;            // ground floor height  (0.00 → first-floor slab 2.80)
  const UH = 2.50;            // upper floor height    (2.80 → roof slab 5.30)
  const PARA = 0.40;          // parapet above roof slab (5.30 → 5.70)
  const TER  = 2.80;          // terrace finished floor level
  const RAILH = 1.08;         // terrace railing height (3.88 − 2.80)
  const EXT = 0.20, INT = 0.10, SLAB = 0.20;   // wall / partition / slab thickness
  const IW  = 0.12;           // interior room-partition thickness (per floor plans, ~12cm)

  // built-block footprint — the house is an L in plan:
  //   NORTH band (z 0..GZ): east edge at BX   = 8.41  (top dim chain 841 = 144+637+60)
  //   SOUTH band (z GZ..BZ) + COURTYARD (z BZ..SITE_Z): east edge at BXS = 10.50
  //     (bottom courtyard dim chain 1050). The SE living/terrace/courtyard juts
  //     +2.09 m further east than the north band, stepping at z=GZ. BX and BXS are
  //     both OUTER dimension lines (walls are seg()-centred on them, the existing
  //     convention; the 841/1050 plan chains are outer faces).
  const BX = 8.41, BZ = 7.20, SITE_Z = 10.29;
  const BXS = BX + 2.09;                        // 10.50 — south-band / courtyard east extent
  // back strip: courtyard fills it; storage (מחסן) sits SE against the BXS edge
  const STW = 2.72, STD = 2.94;                // storage 272 × 294
  const ST_X0 = BXS - STW;                      // 7.78  (SE corner of the now-wider courtyard)
  const ST_Z1 = BZ + STD;                      // 10.14
  // interior grid lines (from the plans, m, incl. wall centres)
  const GX = 3.18;            // N-S partition: west rooms | east rooms (bedroom 300 + wall)
  const GZ = 3.60;            // E-W partition: street band | south band (360); ALSO the east-wall step line

  // ---- THERMAL SUBDIVISION target edge length (m). The per-vertex thermal
  //      heatmap can only show detail WHERE the mesh has vertices: a flat wall
  //      that is one 2-triangle face can show at most a corner-to-corner gradient,
  //      never a shade line crossing it. So large flat thermal surfaces (stucco
  //      walls, terrace deck, courtyard paving, roof slabs) are subdivided to a
  //      moderate ~0.6 m grid at build time. This is PURELY more vertices on the
  //      SAME flat planes — identical silhouette + normals under the normal
  //      materials — it only gives the heatmap somewhere to put spatial detail.
  // Two densities, chosen to keep a full house recolor a few tens of ms (the live
  // recompute is debounced to ~7/s by app.js) and the one-time SVF bake ~3 s:
  //  · FLAT slabs (terrace deck, courtyard paving, roof) → fine ~0.7 m. These are
  //    cheap (few m²) and are exactly where the user sees uniform colour today
  //    ("all of the balcony gets the same values"), so they get the finest grid.
  //  · WALLS (the bulk of the surface area) → coarser ~1.5 m. Fine enough to carry
  //    a crossing shade line + a base-to-top SVF gradient, but the wall area is
  //    large so a fine grid here would blow the vertex budget (warm recolor must
  //    stay well under the ~140 ms debounce). Honest tradeoff — see the report.
  const THERM_SEG=0.7;          // flat slabs
  const THERM_SEG_WALL=1.5;     // extruded walls
  const segCount=(L)=>Math.max(1,Math.min(40,Math.round(Math.abs(L)/THERM_SEG)));

  // tessellate a (flat-faced) BufferGeometry by splitting any triangle whose
  // longest edge exceeds maxEdge at that edge's midpoint, recursively. On FLAT
  // faces the midpoints lie exactly on the original face and normals interpolate
  // identically, so the rendered shape/shading is unchanged — there are just more
  // vertices for the heatmap. Used for the extruded stucco walls (which can't take
  // BoxGeometry-style segment counts). Operates on the non-indexed triangle soup.
  function tessellateGeo(geo,maxEdge){
    let g=geo.index?geo.toNonIndexed():geo;
    const src=g.attributes.position.array;
    let tris=[];                                  // each: [ax,ay,az, bx,by,bz, cx,cy,cz]
    for(let i=0;i<src.length;i+=9) tris.push(src.slice(i,i+9));
    const max2=maxEdge*maxEdge;
    const d2=(t,o1,o2)=>{const dx=t[o1]-t[o2],dy=t[o1+1]-t[o2+1],dz=t[o1+2]-t[o2+2];return dx*dx+dy*dy+dz*dz;};
    let guard=0;
    for(let pass=0; pass<8; pass++){
      let changed=false; const out=[];
      for(const t of tris){
        const eAB=d2(t,0,3), eBC=d2(t,3,6), eCA=d2(t,6,0);
        const mx=Math.max(eAB,eBC,eCA);
        if(mx<=max2 || guard>200000){ out.push(t); continue; }
        changed=true; guard++;
        // split the LONGEST edge at its midpoint into two triangles
        const A=[t[0],t[1],t[2]], B=[t[3],t[4],t[5]], C=[t[6],t[7],t[8]];
        let P,Q,R;                                // R is the apex opposite the split edge
        if(mx===eAB){ P=A;Q=B;R=C; } else if(mx===eBC){ P=B;Q=C;R=A; } else { P=C;Q=A;R=B; }
        const Mid=[(P[0]+Q[0])/2,(P[1]+Q[1])/2,(P[2]+Q[2])/2];
        out.push([P[0],P[1],P[2], Mid[0],Mid[1],Mid[2], R[0],R[1],R[2]]);
        out.push([Mid[0],Mid[1],Mid[2], Q[0],Q[1],Q[2], R[0],R[1],R[2]]);
      }
      tris=out; if(!changed) break;
    }
    const arr=new Float32Array(tris.length*9);
    for(let i=0;i<tris.length;i++) arr.set(tris[i],i*9);
    const ng=new THREE.BufferGeometry();
    ng.setAttribute('position',new THREE.BufferAttribute(arr,3));
    ng.computeVertexNormals();
    return ng;
  }

  // ---- a wall panel with rectangular openings; local frame
  //      x:0..len  y:0..h  z:-t/2..t/2 ----
  function wallMesh(len,h,t,holes,mat){
    const sh=new THREE.Shape();
    sh.moveTo(0,0); sh.lineTo(len,0); sh.lineTo(len,h); sh.lineTo(0,h); sh.lineTo(0,0);
    (holes||[]).forEach(o=>{ const p=new THREE.Path();
      p.moveTo(o.u,o.v); p.lineTo(o.u+o.w,o.v); p.lineTo(o.u+o.w,o.v+o.h); p.lineTo(o.u,o.v+o.h); p.lineTo(o.u,o.v);
      sh.holes.push(p); });
    let g=new THREE.ExtrudeGeometry(sh,{depth:t,bevelEnabled:false});
    g.translate(0,0,-t/2);
    // subdivide the big flat wall faces so the thermal heatmap shows a real shade
    // line / base-vs-top gradient across a wall, not one flat colour. Only large
    // triangles split (the longest-edge test leaves thin reveals/jambs alone), so
    // this stays cheap and the wall looks identical under its normal material.
    if(len*h>2.2){ g=tessellateGeo(g,THERM_SEG_WALL); } else { g.computeVertexNormals(); }
    const m=new THREE.Mesh(g,mat); m.castShadow=true; m.receiveShadow=true; return m;
  }

  function build(M){
    const G=new THREE.Group();
    const glass=[], ilights=[];
    const box=(w,h,d,x,y,z,mat,noShadow)=>{ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
      m.position.set(x,y,z); m.castShadow=!noShadow; m.receiveShadow=true; G.add(m); return m; };

    // ---- place a wall between (x1,z1)-(x2,z2); fills its openings with
    //      glass panes (logged → night glow) and timber doors ----
    function seg(x1,z1,x2,z2,h,baseY,holes,mat,t){
      t=t||EXT;
      const horiz = Math.abs(z2-z1) < 1e-6;
      const len = horiz ? Math.abs(x2-x1) : Math.abs(z2-z1);
      const ox = Math.min(x1,x2), oz = Math.min(z1,z2);
      const g = new THREE.Group();
      g.add(wallMesh(len,h,t,holes,mat));
      g.position.set(horiz?ox:x1, baseY, horiz?z1:oz);
      g.rotation.y = horiz ? 0 : -Math.PI/2;
      G.add(g);
      (holes||[]).forEach(o=>{
        const cx = horiz ? ox+o.u+o.w/2 : x1;
        const cz = horiz ? z1 : oz+o.u+o.w/2;
        const cy = baseY+o.v+o.h/2;
        const hh=o.h, hw=o.w;
        const REV=0.05;                 // glass recessed ~5cm behind frame face
        const FR=0.055, FD=t-0.02;      // frame member width & its depth in the wall
        // a wall-local box helper: bx = size along wall breadth, by = height,
        //   dz = size thru wall; bOff/yOff/zOff offset from opening centre.
        //   Parametric for both horizontal (rot 0) and vertical (rot -90°) walls;
        //   world placement uses cx/cz/cy so any GLASS pane centre is unchanged.
        const wbox=(bx,by,dz,bOff,yOff,zOff,mat)=>{
          const m=new THREE.Mesh(new THREE.BoxGeometry(horiz?bx:dz, by, horiz?dz:bx), mat);
          m.position.set(horiz?cx+bOff:cx+zOff, cy+yOff, horiz?cz+zOff:cz+bOff);
          m.castShadow=true; m.receiveShadow=true; G.add(m); return m;
        };
        // a brass lever handle, fixed ~1.05 m above the door's own floor and set
        //   proud of the inner leaf face (toward the room, the −REV side). 'frac'
        //   in [−1..1] places it across the leaf width (near a stile = ±~0.8).
        const handle=(frac)=>{
          const knob=new THREE.Mesh(new THREE.BoxGeometry(horiz?0.04:0.05, 0.12, horiz?0.05:0.04), M.brass);
          const bOff=frac*(hw/2-0.10), zOff=-REV-0.03;
          knob.position.set(horiz?cx+bOff:cx+zOff, baseY+o.v+1.05, horiz?cz+zOff:cz+bOff);
          knob.castShadow=true; G.add(knob); return knob;
        };

        if(o.door && !o.glass){
          // ===== SOLID / OPAQUE DOOR =====
          //   A real timber LEAF filling the opening down to the floor, set into
          //   the inner half of the wall, with a frame/casing on the room face and
          //   a brass lever handle. No glass, no projecting sill — reads as a door.
          // door casing/jamb lining around the reveal (head + 2 jambs, no sill)
          wbox(hw+0.04, FR, FD, 0,  hh/2-FR/2, 0, M.wood);          // head casing
          wbox(FR, hh,      FD, -hw/2+FR/2, 0, 0, M.wood);          // jamb A (to floor)
          wbox(FR, hh,      FD,  hw/2-FR/2, 0, 0, M.wood);          // jamb B (to floor)
          // the solid leaf, inset toward the room, slightly smaller than the reveal
          const lw=hw-2*FR, lh=hh-FR, ld=Math.min(0.05, t*0.35);
          const leaf=wbox(lw, lh, ld, 0, -FR/2, -REV, M.wood);     // leaf body
          // a couple of raised panels to give the leaf a paneled-door read
          wbox(lw*0.6, lh*0.32, ld*0.4, 0,  lh*0.22-FR/2, -REV-ld*0.6, M.wood); // upper panel
          wbox(lw*0.6, lh*0.32, ld*0.4, 0, -lh*0.22-FR/2, -REV-ld*0.6, M.wood); // lower panel
          // brass lever handle near the latch stile (toward the room)
          handle(+1);
        } else if(o.door && o.glass){
          // ===== GLAZED DOOR (sliding / French) =====
          //   A large glass pane framed as a DOOR: full height to the floor, a flat
          //   floor THRESHOLD (not a raised sill), door-style stiles + top/bottom
          //   rails + a central vertical meeting stile (sliding/French divide), and
          //   a brass handle. Pane stays in glass[] so it still glows at night.
          const pane=new THREE.Mesh(new THREE.PlaneGeometry(hw-2*FR, hh-FR), M.glass.clone());
          pane.position.set(cx,cy-FR/2,cz); if(!horiz) pane.rotation.y=Math.PI/2;
          if(horiz) pane.position.z = cz - REV; else pane.position.x = cx - REV;
          pane.receiveShadow=false; G.add(pane); glass.push(pane);
          // door surround: head + two full-height jambs (stiles), reaching the floor
          wbox(hw+0.02, FR, FD, 0,  hh/2-FR/2, 0, M.wood);          // head rail
          wbox(FR, hh, FD, -hw/2+FR/2, 0, 0, M.wood);               // left stile (to floor)
          wbox(FR, hh, FD,  hw/2-FR/2, 0, 0, M.wood);               // right stile (to floor)
          // bottom rail just above the threshold (door foot, not a window sill)
          wbox(hw-2*FR, FR, FD, 0, -hh/2+FR*1.5, 0, M.wood);        // bottom rail
          // central vertical meeting stile — the tell of a sliding/French pair
          wbox(FR*0.9, hh-2*FR, FD, 0, -FR/2, 0, M.wood);           // meeting stile
          // flat floor THRESHOLD: a low, wide flush strip on the floor (no projection up)
          const thW = horiz ? hw+0.04 : t+0.06, thD = horiz ? t+0.06 : hw+0.04;
          const thr=new THREE.Mesh(new THREE.BoxGeometry(thW, 0.04, thD), M.concrete);
          thr.position.set(cx, baseY+o.v+0.02, cz); thr.castShadow=true; thr.receiveShadow=true; G.add(thr);
          // brass handle on the meeting/leading stile
          handle(+0.18);
        } else {
          // ===== WINDOW =====  (glazed, no door)
          //   Recessed glass with a slim timber surround, a central mullion when
          //   wide, and a PROJECTING stone sill — sits above the floor on its sill.
          const pane=new THREE.Mesh(new THREE.PlaneGeometry(hw-2*FR, hh-2*FR), M.glass.clone());
          pane.position.set(cx,cy,cz); if(!horiz) pane.rotation.y=Math.PI/2;
          if(horiz) pane.position.z = cz - REV; else pane.position.x = cx - REV;
          pane.receiveShadow=false; G.add(pane); glass.push(pane);
          // frame surround: head + sill + two jambs, lining the reveal
          wbox(hw+0.02, FR, FD, 0,  hh/2-FR/2, 0, M.wood);          // head
          wbox(hw+0.02, FR, FD, 0, -hh/2+FR/2, 0, M.wood);          // window sill member
          wbox(FR, hh-FR, FD, -hw/2+FR/2, 0, 0, M.wood);            // jamb A
          wbox(FR, hh-FR, FD,  hw/2-FR/2, 0, 0, M.wood);            // jamb B
          if(hw>0.95) wbox(FR*0.8, hh-2*FR, FD, 0, 0, 0, M.wood);   // central mullion
          // projecting stone sill under windows (off the floor)
          if(o.v>0.2){
            const sl=new THREE.Mesh(new THREE.BoxGeometry(horiz?hw+0.18:t+0.10, 0.05, horiz?t+0.10:hw+0.18), M.concrete);
            sl.position.set(cx, cy-hh/2-0.025, cz); sl.castShadow=true; sl.receiveShadow=true; G.add(sl);
          }
        }
      });
    }

    // ============================================================
    //  GROUND FOOTING (thin, ground-flush — NOT a raised plinth)
    //  Previously this was a 9.0×10.9×0.30 m grey concrete pad in M.concrete
    //  that spanned the WHOLE site (incl. the courtyard) and read as a chunky
    //  grey raised platform under the house. The house actually sits at grade
    //  on its sandy plot. We replace it with a thin SAND-COLOURED footing that
    //  follows only the BUILT BLOCK, sunk so its top is ~flush with the ground
    //  (≈0.0) and barely shows — no grey pedestal, no courtyard platform.
    //  L-SHAPED: the south band (living/terrace footprint) juts +2.09 m east, so
    //  both the sand footing and the floor slab are TWO boxes — a north band
    //  (x 0..BX, z 0..GZ) + a wider south band (x 0..BXS, z GZ..BZ).
    box(BX+0.10,  0.12, GZ+0.10,    BX/2,  -0.05, GZ/2,          M.sand, true);     // sand footing — north band
    box(BXS+0.10, 0.12, (BZ-GZ)+0.10, BXS/2, -0.05, GZ+(BZ-GZ)/2, M.sand, true);     // sand footing — south band (wide)
    // ground-floor slab top (kept; reads as the interior floor edge) — L in two boxes
    box(BX,  0.05, GZ,     BX/2,  0.02, GZ/2,          M.concrete, true);            // slab — north band
    box(BXS, 0.05, BZ-GZ,  BXS/2, 0.02, GZ+(BZ-GZ)/2,  M.concrete, true);            // slab — south band (wide)

    // ============================================================
    //  GROUND FLOOR — exterior shell  (z=0 street/north … z=BZ courtyard)
    //  Facade openings transcribed from חזית קדמית / אחורית / צדדית.
    // ============================================================
    // NORTH facade (z=0): kitchen window (east) + bedroom window (west).
    //   NOTE: the real ENTRANCE is on the WEST facade (front=west per his
    //   site/zone data: site.json front offset_e=-6.85 & shades open to the
    //   west arc; zones.json front bbox is the westernmost; resident_plants
    //   "חזית הבית הפונה למערב"). The model's live front sun-zone is placed at
    //   the WEST wall (x≈0) by app.js's YardShade, so the door belongs there —
    //   NOT here. This opening is therefore a WINDOW, not the entry door.
    // This is the narrow-band outer wall. After the +90° re-orientation it faces
    // REAL WEST — the shared-plaza / entrance side. The ENTRANCE (90/205) goes here,
    // at the entry/stair bay (off the plaza), per Alex's photos + the front elevation.
    seg(0,0, BX,0, GH,0, [
      {u:0.80, v:1.00, w:1.10, h:1.30, glass:1},          // pantry-end window
      {u:3.30, v:0.05, w:0.90, h:2.05, glass:1, door:1},  // ENTRANCE 90/205 — from the shared plaza (west) into the entry/stairs
      {u:6.55, v:1.05, w:1.20, h:1.20, glass:1},          // kitchen window
    ], M.wall);
    // EAST facade — STEPPED L (the SE living band juts +2.09 m east at z=GZ).
    //   Both east ground-floor windows are SEALED on the plan ("סגירת פתח חלון",
    //   filled-in wall — this face abuts the neighbour), so this whole east run is
    //   now SOLID (no glass holes).
    seg(BX,0, BX,GZ, GH,0, [ {u:1.00, v:1.30, w:0.80, h:1.20, glass:1} ], M.wall);   // kitchen EAST window 80/120 — OPEN per plan (AC beside it)
    seg(BX,GZ, BXS,GZ, GH,0, [], M.wall);                 // STEP face: short E-W wall x=BX→BXS at z=GZ
    seg(BXS,GZ, BXS,BZ, GH,0, [], M.wall);                // SOUTH band east wall (living) — was living window, SEALED
    // SOUTH facade (courtyard, z=BZ): the ENTRANCE side. Per Alex's photos the
    //   real front door is a recessed single door on this courtyard face, tucked
    //   under the terrace overhang near the storage, opening onto the planted
    //   entry patio — plus the living↔courtyard glazed garden doors and the
    //   bedroom 100/130 window (was wrongly 150/140).
    seg(0,BZ, BXS,BZ, GH,0, [
      {u:1.30, v:1.00, w:1.00, h:1.30, glass:1},          // bedroom window 100/130 (its back-yard wall)
      {u:4.00, v:0.05, w:2.40, h:2.10, glass:1, door:1},  // LIVING big SLIDING glass door → back yard (חצר אחורי); reality (permit drew 70/205 ×2)
    ], M.wall);
    // WEST facade (x=0): SOLID wall, WINDOWS ONLY — there is NO entry door here.
    //   (Correcting an earlier mistake: the entrance was wrongly forced onto the
    //   west wall to match the solar 'front' zone. Alex's photos + the front
    //   elevation show the real entrance on the COURTYARD/south side, under the
    //   terrace overhang — modelled on the south facade below.) Plan's west wall
    //   carries only the green pantry window + the bedroom 100/130.
    seg(0,0, 0,BZ, GH,0, [
      {u:0.70, v:1.80, w:0.80, h:0.55, glass:1},          // pantry window (green-framed; uk=180 → high sill)
      {u:5.10, v:1.00, w:1.00, h:1.30, glass:1},          // bedroom 100/130
    ], M.wall);

    // ============================================================
    //  INTERIOR ROOM STRUCTURE  (NOT exterior — built from the floor
    //  plans; revealed only by the future "enter mode" that hides the
    //  roof/upper slab). Interior partitions get NO glass panes and are
    //  NOT pushed into userData.glass/ilights. Doorways are modelled as
    //  plain rectangular openings (no leaf) via the seg() door branch
    //  with a tiny solid filler removed — here we just leave holes open.
    //  Thickness IW≈0.12 m. Local helpers float just over the slab.
    // ============================================================
    // a thin per-room floor surface (so each room reads as a standable
    //   space); receive-only, no shadow casting, sits just above the slab.
    function floorTile(x0,z0,x1,z1,y,mat){
      const w=Math.abs(x1-x0), d=Math.abs(z1-z0);
      const f=new THREE.Mesh(new THREE.PlaneGeometry(w,d), mat||M.concrete);
      f.rotation.x=-Math.PI/2;
      f.position.set((x0+x1)/2, y+0.012, (z0+z1)/2);
      f.receiveShadow=true; G.add(f); return f;
    }
    // an OPEN doorway in an interior wall: build the wall as two stub
    //   pieces flanking a gap (so you can walk through), plus a slim head
    //   lintel above. No glass, no leaf. `axis` 'x' = wall runs E-W along
    //   z=fix; 'z' = wall runs N-S along x=fix. `a0..a1` is the wall run,
    //   `d0` start of the door gap along that run, `dw` door width.
    function partWithDoor(axis,fix,a0,a1,baseY,h,d0,dw,mat){
      const t=IW, dh=2.05, m=mat||M.wall;
      const lo=Math.min(a0,a1), hi=Math.max(a0,a1);
      const seg2=(s,e)=>{ if(e-s<0.02) return;
        if(axis==='x') seg(s,fix, e,fix, h,baseY, [], m, t);
        else           seg(fix,s, fix,e, h,baseY, [], m, t);
      };
      seg2(lo, d0);                 // wall before the doorway
      seg2(d0+dw, hi);              // wall after the doorway
      // head lintel over the opening (from door top up to wall top)
      if(h>dh+0.02){
        const lh=h-dh, ly=baseY+dh+lh/2;
        const lintel=new THREE.Mesh(new THREE.BoxGeometry(
          axis==='x'? dw : t, lh, axis==='x'? t : dw), m);
        lintel.position.set(axis==='x'? d0+dw/2 : fix, ly, axis==='x'? fix : d0+dw/2);
        lintel.castShadow=true; lintel.receiveShadow=true; G.add(lintel);
      }
    }

    // ---- GROUND FLOOR interior partitions (ground-floor partitions) ----
    //  North band (z 0..GZ):  מזווה (pantry, x 0..1.44) | bathroom (1.44..2.62)
    //    | stairs (2.62..3.59) | hall passage | מטבח (kitchen, x 4.37..east).
    //  South band (z GZ..BZ): ח.שינה (bedroom, x 0..GX=3.18) | סלון (living).
    const GFh = GH;
    // pantry east wall (solid; pantry opens south into the hall) x=1.44
    seg(1.44,0, 1.44,GZ, GFh,0, [], M.wall, IW);
    // bathroom east wall (separates bath from stair run) x=2.62
    seg(2.62,0, 2.62,GZ, GFh,0, [], M.wall, IW);
    // GX (x=3.18) bedroom|living wall — SOUTH band ONLY. It must NOT continue into
    //   the north band: the staircase occupies x 2.66..3.54 there, so a wall at 3.18
    //   would slice straight through the middle of the stairs (the stair core is open
    //   eastward to the hall).
    seg(GX,GZ, GX,BZ, GFh,0, [], M.wall, IW);                // bedroom | living (solid)
    // kitchen west wall (x=4.37) with a doorway/passage from the hall (the
    //   plan's ~92 cm opening near its SW corner) — open hole, no leaf.
    partWithDoor('z', 4.37, 0, GZ, 0, GFh, GZ-1.05, 0.92, M.wall);
    // E-W band wall (z=GZ) splitting north band from south band, with two
    //   doorways: into the bedroom (from the hall) and kitchen→living.
    partWithDoor('x', GZ, 0, GX, 0, GFh, 1.70, 0.80, M.wall);     // hall → bedroom door
    partWithDoor('x', GZ, GX, BX, 0, GFh, 5.10, 0.90, M.wall);    // kitchen → living door (90/205)

    // ---- GROUND FLOOR per-room floor tiles (where the slab edge alone
    //      isn't enough to read the space) ----
    floorTile(0,0,        1.44,GZ,   0, M.concrete);   // pantry
    floorTile(1.44,0,     2.62,GZ,   0, M.concrete);   // bathroom
    floorTile(0,GZ,       GX,BZ,     0, M.wood);       // bedroom (timber floor)
    floorTile(GX,GZ,      BXS,BZ,    0, M.wood);       // living  (timber floor) — wide south band to BXS
    floorTile(4.37,0,     BX,GZ,     0, M.concrete);   // kitchen (north band, east edge BX)

    // ---- KITCHEN counter (L-shape, light built-in) along the N & E walls
    //      of the NE kitchen. ~0.90 m high, 0.60 m deep, timber carcass with
    //      a pale stone worktop. Cheap boxes; cast/receive shadow. ----
    (function(){
      const H0=0.86, WT=0.04, D=0.60;
      // north run: x 4.55..8.05 along z≈0.30 (counter centre)
      const nL=3.50, nz=0.10+D/2;
      box(nL, H0, D, 4.55+nL/2, H0/2, nz, M.wood);                       // carcass
      box(nL+0.04, WT, D+0.04, 4.55+nL/2, H0+WT/2, nz, M.concrete, true);// worktop
      // east return: z 0.70..1.95 along x≈7.95
      const eL=1.25, ex=BX-0.18-D/2;
      box(D, H0, eL, ex, H0/2, 0.70+eL/2, M.wood);                        // carcass
      box(D+0.04, WT, eL+0.04, ex, H0+WT/2, 0.70+eL/2, M.concrete, true); // worktop
    })();

    // ---- GROUND-FLOOR FIXTURES (so 'enter mode' rooms read as inhabited; the plan
    //      draws these). Simple light boxes — a WC pan + wall basin in the bathroom
    //      (wet zone, x 1.44..2.62) and a sink inset on the kitchen's north counter. ----
    (function(){
      const cer=M.concrete;                                       // light ceramic stand-in
      box(0.38,0.42,0.55, 2.30, 0.21, 0.55, cer, true);          // WC pan (east end of bath)
      box(0.50,0.18,0.32, 1.72, 0.85, 0.28, cer, true);          // wall basin (north wall)
      box(0.55,0.06,0.42, 6.20, 0.89, 0.40, cer, true);          // kitchen sink (inset in the north worktop ~0.86)
    })();

    // ---- STAIRS ground→first (straight flight, climbing -z/north) ----
    //  Per plan: ~99 cm wide run in the stair core (x 2.62..3.56), treads
    //  running N-S, ascending from its south foot (z≈3.0, y0) up toward the
    //  north (z≈0.4) to reach the first-floor slab at y=GH.
    stairsFlight(2.66, 3.54, 3.00, 0.45, 0, GH, G, M);

    // ============================================================
    //  FIRST-FLOOR SLAB  (top of ground floor, y = GH) — L-SHAPED:
    //  north band (BX × GZ) + wide south band (BXS × (BZ−GZ)). The south band
    //  carries the terrace deck, which juts +2.09 m east with the living room.
    // ============================================================
    box(BX,  SLAB, GZ,    BX/2,  GH+SLAB/2, GZ/2,          M.concrete, true);   // north band
    box(BXS, SLAB, BZ-GZ, BXS/2, GH+SLAB/2, GZ+(BZ-GZ)/2,  M.concrete, true);   // south band (wide)

    // ============================================================
    //  UPPER FLOOR — enclosed L  (north full-width band z 0..GZ
    //  + SW bedroom x 0..GX z GZ..BZ).  Terrace fills the SE.
    //  Facade openings from the elevations (first-floor row).
    // ============================================================
    const yb = GH;
    // NORTH facade (street): two windows (bedroom + stair/landing)
    seg(0,0, BX,0, UH,yb, [
      {u:0.55, v:0.95, w:1.00, h:1.20, glass:1},          // SW-bedroom upper window
      {u:3.60, v:1.35, w:0.55, h:0.55, glass:1},          // small stair/bath window
      {u:6.50, v:0.95, w:1.10, h:1.20, glass:1},          // NE-bedroom window
    ], M.wall);
    // EAST facade (north band only, z 0..GZ): NE-bedroom window 100/130
    seg(BX,0, BX,GZ, UH,yb, [ {u:1.00, v:0.95, w:1.00, h:1.30, glass:1} ], M.wall);
    // WEST facade: SW-bedroom window 100/130  + small bath/stair window
    seg(0,0, 0,BZ, UH,yb, [
      {u:0.55, v:1.45, w:0.55, h:0.60, glass:1},          // bath/stair (high, small)
      {u:4.90, v:0.95, w:1.00, h:1.30, glass:1},          // SW-bedroom 100/130
    ], M.wall);
    // inner wall facing the terrace, along z=GZ for the EAST part (x GX..BX):
    //   NE-bedroom door + window onto terrace
    seg(GX,GZ, BX,GZ, UH,yb, [
      {u:0.80, v:0.05, w:0.92, h:2.05, glass:1, door:1},  // bedroom→terrace door (92/205)
      {u:3.20, v:0.95, w:1.45, h:1.30, glass:1},          // bedroom window onto terrace
    ], M.wall);
    // east edge of SW bedroom facing terrace (x=GX, z GZ..BZ): door onto terrace
    seg(GX,GZ, GX,BZ, UH,yb, [ {u:1.40, v:0.05, w:0.92, h:2.05, glass:1, door:1} ], M.wall);
    // south edge of SW bedroom (z=BZ, x 0..GX): window over the courtyard
    seg(0,BZ, GX,BZ, UH,yb, [ {u:0.70, v:0.95, w:1.30, h:1.30, glass:1} ], M.wall);

    // ---- FIRST-FLOOR interior partitions (first-floor partitions) ----
    //  North band (z 0..GZ): stair landing/void (x 0..2.55) | bathroom w/
    //    tub (2.55..4.55) | ח.שינה NE bedroom (x 5.47..BX, 294 interior).  South band:
    //    ח.שינה SW bedroom (x 0..GX) — rest of the south band is the open
    //    terrace (no interior here).  Interior partitions: no glass.
    const Uh = UH, uy = yb;
    // bathroom west wall (separates bathroom from the stair landing) x=2.55
    seg(2.55,0, 2.55,GZ, Uh,uy, [], M.wall, IW);
    // bathroom east wall x=4.55, with a doorway from the landing/hall
    partWithDoor('z', 4.55, 0, GZ, uy, Uh, 1.80, 0.80, M.wall);
    // NE-bedroom west wall x=5.47 → interior 294 (BX 8.41 − 5.47), per plan.
    //   (Was 5.20 → 321, ~27 cm too wide — audit fix.) East edge stays BX (north band).
    //   Doorway from the central landing.
    partWithDoor('z', 5.47, 0, GZ, uy, Uh, 0.40, 0.80, M.wall);
    // E-W band wall (z=GZ) under the SW bedroom (x 0..GX) with a doorway
    //   from the landing into the SW bedroom (the plan's 80/205 + 145/205).
    partWithDoor('x', GZ, 0, GX, uy, Uh, 1.55, 0.85, M.wall);

    // ---- FIRST-FLOOR per-room floor tiles ----
    floorTile(0,0,    2.55,GZ,  GH+SLAB, M.concrete);   // stair landing
    floorTile(2.55,0, 4.55,GZ,  GH+SLAB, M.concrete);   // bathroom
    floorTile(5.47,0, BX,GZ,    GH+SLAB, M.wood);       // NE bedroom (timber) — 294 wide, west wall at 5.47
    floorTile(0,GZ,   GX,BZ,    GH+SLAB, M.wood);       // SW bedroom (timber)

    // ---- BATHROOM tub (אמבטיה ~1.60 m) along the bathroom's north wall ----
    box(0.75, 0.50, 1.55, 2.55+0.40, GH+SLAB+0.27, 0.18+0.78, M.wallWarm); // tub body
    box(0.69, 0.18, 1.49, 2.55+0.40, GH+SLAB+0.52, 0.18+0.78, M.concrete, true); // tub rim/inner

    // ============================================================
    //  ROOF SLAB over the enclosed L + parapet  (y = GH+UH = 5.30)
    // ============================================================
    const yr = yb + UH;
    // roof slabs subdivided on their wide top face so the heatmap shows the flat
    // roof's own midday peak with spatial structure (not one flat colour).
    const roofSlab=(w,h,d,x,y,z)=>{
      const g=new THREE.BoxGeometry(w,h,d, segCount(w),1,segCount(d));
      const m=new THREE.Mesh(g,M.roof); m.position.set(x,y,z);
      m.castShadow=true; m.receiveShadow=true; G.add(m); return m;
    };
    roofSlab(BX, 0.16, GZ,     BX/2, yr+0.08, GZ/2);            // north band
    roofSlab(GX, 0.16, BZ-GZ,  GX/2, yr+0.08, GZ+(BZ-GZ)/2);   // SW bedroom
    // parapet ring around the enclosed L (top at 5.70)
    [[0,0,BX,0],[BX,0,BX,GZ],[0,0,0,BZ],[0,BZ,GX,BZ],[GX,GZ,GX,BZ],[GX,GZ,BX,GZ]]
      .forEach(s=>seg(s[0],s[1],s[2],s[3], PARA, yr, [], M.wall, 0.16));

    // ============================================================
    //  TERRACE (מרפסת ריצוף) — tiled deck at +2.80 over the living room.
    //  The living room (and so the terrace over it) is the WIDE south band, so
    //  the deck + its east kerb/railing run to BXS (=10.50). Terrace interior
    //  ≈ 714 (x GX..BXS minus the wall reveal), per plan / site.json (7.14).
    //  Railing (מעקה) on the open south & east edges.
    // ============================================================
    const tdx0=GX, tdz0=GZ, tdw=BXS-GX, tdd=BZ-GZ;
    // subdivided so the thermal heatmap shows the terrace splitting warm/cool as
    // the sun tracks (its open SE vs the strip shaded by the upper rooms beside it).
    const deck=new THREE.Mesh(new THREE.PlaneGeometry(tdw, tdd, segCount(tdw), segCount(tdd)), M.deck);
    deck.rotation.x=-Math.PI/2;
    deck.position.set(tdx0+tdw/2, TER+SLAB+0.02, tdz0+tdd/2);
    deck.receiveShadow=true; G.add(deck);
    // low kerb under the railing on the open edges — south edge runs GX..BXS,
    // east edge at x=BXS (above the wide ground-floor living wall). The terrace
    // juts +2.09 m east of the north band, so the STEP segment (x BX..BXS) along
    // z=GZ faces open air on its NORTH side too → it gets its own kerb + railing.
    seg(GX,BZ, BXS,BZ, 0.18, TER, [], M.wall, 0.12);   // south kerb (wide)
    seg(BXS,GZ, BXS,BZ, 0.18, TER, [], M.wall, 0.12);   // east kerb at BXS (above GF living wall)
    seg(BX,GZ, BXS,GZ, 0.18, TER, [], M.wall, 0.12);   // north step kerb (the jutting NE edge, above GF step)
    railing(GX,BZ, BXS,BZ, TER, G, M);                  // south railing (wide)
    railing(BXS,GZ, BXS,BZ, TER, G, M);                  // east railing at BXS
    railing(BX,GZ, BXS,GZ, TER, G, M);                  // north step railing (jutting NE edge)

    // ============================================================
    //  COURTYARD (חצר) — paved back strip
    // ============================================================
    const yard=new THREE.Mesh(new THREE.PlaneGeometry(ST_X0, SITE_Z-BZ, segCount(ST_X0), segCount(SITE_Z-BZ)), M.paving);
    yard.rotation.x=-Math.PI/2;
    yard.position.set(ST_X0/2, -0.02, BZ+(SITE_Z-BZ)/2);   // courtyard −0.02 per plan
    yard.receiveShadow=true; G.add(yard);

    // ============================================================
    //  COURTYARD / BACK-YARD PERIMETER WALL (קיר)
    //  Ground-truth: site plan 03-site-and-garden-plan.jpg marks "קיר" along
    //  the WEST, SOUTH and EAST plot edges (segment dims 13.13/10.48/11.62/7.40
    //  /3.25 west; 6.76/3.05/7.82 south; 7.05/7.23/10.35 east). His photos show
    //  this as a TALL (~2 m) SANDY STUCCO wall — same M.wall stucco family as
    //  the house (NOT grey) — with a patched-up former opening on the back run.
    //  We render it only on the back strip (z BZ..SITE_Z), the part that
    //  actually encloses the courtyard, at realistic ~0.20 m thickness.
    const PW_H = 2.00, PW_T = 0.20;            // perimeter wall height / thickness
    // SOUTH boundary wall (z = SITE_Z), now spanning the WIDE courtyard 0..BXS
    seg(0,SITE_Z, BXS,SITE_Z, PW_H,0, [], M.wall, PW_T);
    // WEST boundary wall (x = 0), along the courtyard back strip
    seg(0,BZ, 0,SITE_Z, PW_H,0, [], M.wall, PW_T);
    // EAST boundary wall (x = BXS now), the courtyard run SOUTH of the store
    //   (the store fills z BZ..ST_Z1 against BXS; this closes ST_Z1..SITE_Z).
    seg(BXS,ST_Z1, BXS,SITE_Z, PW_H,0, [], M.wall, PW_T);
    // PATCHED-UP FORMER OPENING (per photo): a slightly proud stucco patch on
    // the west boundary wall — a shallow box of the same stucco, read as a
    // filled-in old gate/doorway. Centred ~1.4 m along the wall, 0.9 m wide.
    (function(){
      const px=0, pz0=BZ+0.9, pw=0.90, ph=2.05;
      const patch=new THREE.Mesh(new THREE.BoxGeometry(PW_T+0.04, ph, pw), M.wall);
      patch.position.set(px, ph/2, pz0+pw/2);
      patch.castShadow=true; patch.receiveShadow=true; G.add(patch);
    })();

    // ============================================================
    //  STORAGE (מחסן) + pitched שינגלס roof  (SE of the back strip)
    //  Walls are the same sandy stucco; per his photo the courtyard-facing
    //  side has a WOODEN door (single timber leaf), NOT glazing.
    // ============================================================
    //   Store sits in the SE corner of the wider courtyard (ST_X0=7.78, east wall
    //   at BXS). Per the plan it has TWO doors: one in its WEST wall (from the
    //   courtyard paving into the store) and one in its SOUTH wall (to the
    //   exterior); its NORTH (courtyard-facing) wall had a window now sealed.
    seg(ST_X0,BZ, BXS,BZ, 2.40,0, [], M.wall);                                          // north wall (courtyard) — sealed
    seg(ST_X0,BZ, ST_X0,ST_Z1, 2.40,0, [ {u:1.10, v:0.02, w:0.80, h:2.05, door:1} ], M.wall);  // WEST wall door (from courtyard)
    seg(ST_X0,ST_Z1, BXS,ST_Z1, 2.40,0, [ {u:1.20, v:0.02, w:0.80, h:2.05, door:1} ], M.wall); // SOUTH wall door (exterior)
    seg(BXS,BZ, BXS,ST_Z1, 2.40,0, [], M.wall);                                         // east wall of store (at BXS)
    box(STW, 0.04, STD, ST_X0+STW/2, -0.01, BZ+STD/2, M.concrete, true);                // store floor (−0.01 per plan)
    // TRUE pitched שינגלס roof — two slopes meeting at a ridge (~2.62) dropping to
    //   eaves (~2.30), per the elevation, with a small overhang (was a flat box).
    (function(){
      const rw=STW+0.30, rd=STD+0.30, eave=2.30, ridge=2.62;
      const cx=ST_X0+STW/2, cz=BZ+STD/2, half=rd/2;
      const slopeLen=Math.hypot(half, ridge-eave), pitch=Math.atan2(ridge-eave, half);
      [-1,1].forEach(s=>{
        const pl=new THREE.Mesh(new THREE.BoxGeometry(rw,0.10,slopeLen), M.shingle);
        pl.position.set(cx, (eave+ridge)/2, cz + s*half/2);
        pl.rotation.x = -s*pitch;                              // each plane rises to the ridge at cz
        pl.castShadow=true; pl.receiveShadow=true; G.add(pl);
      });
    })();

    // ============================================================
    //  INTERIOR WARM LIGHTS — one per main room (drive night-window glow).
    //  Start at intensity 0; sky.js animates them after dusk.
    // ============================================================
    [
      [6.6,1.7,1.8],            // kitchen (GF, NE)
      [6.8,1.7,5.2],            // living  (GF, SE) — wide south band, centred ~6.8
      [1.6,1.7,5.2],            // bedroom (GF, SW)
      [6.6,GH+1.7,1.8],         // NE bedroom (1F)
      [1.6,GH+1.7,5.0],         // SW bedroom (1F)
    ].forEach(p=>{
      const L=new THREE.PointLight(0xffcf8a, 0, 6.5, 2);
      L.position.set(p[0],p[1],p[2]); G.add(L); ilights.push(L);
    });

    // center = bounding-box centre of the L envelope (x 0..BXS, z 0..SITE_Z).
    //   NOTE: no code currently reads userData.center (verified across app.js /
    //   panels.js / sky.js); app.js computes its own footprint centre from its
    //   own BX/SITE_Z constants. Recomputed here to the L for correctness.
    G.userData = { glass, ilights, center:{x:BXS/2, z:SITE_Z/2}, GH, UH };
    // THERMAL LAYER support: keep the materials palette + a glass set on the
    // group so Building.setThermal() can (a) map each mesh's material to a solar
    // ABSORPTIVITY role and (b) skip the glass panes (sky.js owns their night
    // glow). No geometry/material is mutated here — purely a reference snapshot.
    G.userData.mats = M;
    G.userData.thermal = null;        // populated lazily by setThermal()
    _register(G);                     // hand this group to the thermal heatmap
    return G;
  }

  // ---- THERMAL HEATMAP ----------------------------------------------------
  // Building.setThermal(on, date): when ON, recolour every house surface
  // (walls / roof / parapet / terrace deck / courtyard paving / storage / sills
  // / stairs / railings…) by a per-VERTEX MODELLED skin temperature, so you see
  // differential warm/cool zones (sun-facing walls hot, shaded faces cool, the
  // flat roof peaking at midday, the terrace splitting warm/cool as the sun
  // tracks). When OFF, restore each mesh's original material exactly.
  //
  // HOW THE COLOUR IS COMPUTED (high-resolution, per-vertex, LOCATION-aware):
  //   For each mesh we transform every vertex into the house MODEL frame — the
  //   SAME frame Derive's occluder boxes + Astro.sun().dir live in (+x=E, +y=up,
  //   +z=S, origin at the block's NW corner) — by undoing the houseWrap yaw/offset
  //   with G.worldToLocal(mesh.localToWorld(vtxLocal)) for the POSITION and the
  //   relative (G⁻¹·meshWorld) normal matrix for the NORMAL. We then call
  //   Derive.surfaceTempAtPoint(xL,yL,zL, modelNormal, date, opts), which builds
  //   an OUTWARD-BIASED cell at that point so the vertex feels ITS OWN local
  //   sky-view factor + sun/shade: walls now differ from each other (sunlit vs
  //   shaded) AND vary WITHIN a surface (base vs top by SVF, a strip beside the
  //   upper rooms or the storage going into shade as the sun tracks). Earlier this
  //   passed only the normal (SVF defaulted to 1, shadow to 1) so a flat wall was
  //   one uniform colour — the bug this revision fixes.
  //
  //   PERFORMANCE: the per-vertex SVF + model position + model normal are
  //   GEOMETRY-STATIC, so we build the per-vertex Derive cells ONCE and memoise
  //   them on geo.userData.__thermCells; across frames only the sun-dependent
  //   shadow + energy balance recompute, and the house path uses lag:false (one
  //   shadow eval per vertex, not the lag filter's three).
  //
  //   This is an ESTIMATE from a physical model (see derive.js surfaceTemp) —
  //   the UI labels it "מודל · הערכה". The temperature RANGE used for the colour
  //   ramp is returned to the caller (app.js) so the legend can show real °C.
  let _thermalOn=false, _lastRange=null;
  function _roleMap(G){
    const M=G.userData&&G.userData.mats; if(!M) return {};
    // material instance → absorptivity role (see derive.js ABSORPTIVITY)
    const map=new Map();
    const put=(mat,role)=>{ if(mat) map.set(mat,role); };
    put(M.roof,'roof'); put(M.shingle,'shingle'); put(M.paving,'paving');
    put(M.deck,'deck'); put(M.wall,'stucco'); put(M.wallWarm,'stucco');
    put(M.concrete,'stone'); put(M.sand,'sand'); put(M.wood,'wood');
    put(M.brass,'metal'); put(M.railing,'metal'); put(M.rim,'stone');
    return map;
  }
  // recolour one mesh's vertices in place; returns {temps,colAttr,lo,hi} (or null).
  // `G` is the house group whose LOCAL frame IS the model frame (Derive's frame).
  // Static per-vertex Derive cells (model position + model normal + cached SVF/expo)
  // are memoised on geo.userData.__thermCells and reused every frame.
  const _mRel=new THREE.Matrix4(), _mNorm=new THREE.Matrix3(), _vp=new THREE.Vector3(), _vn=new THREE.Vector3();
  function _colorMesh(mesh,roleMap,glassSet,date,sun,env,G){
    const geo=mesh.geometry; if(!geo||!geo.attributes||!geo.attributes.position) return null;
    // skip glass panes (sky.js drives their emissive glow) and non-thermal bits
    const mat0=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
    if(glassSet&&glassSet.has(mesh)) return null;
    if(mat0&&mat0.userData&&mat0.userData.__noThermal) return null;
    // material → absorptivity role (default if unknown)
    let role='default';
    if(!Array.isArray(mesh.material) && roleMap.has(mesh.material)) role=roleMap.get(mesh.material);
    else if(Array.isArray(mesh.material)){ for(const m of mesh.material){ if(roleMap.has(m)){ role=roleMap.get(m); break; } } }
    const pos=geo.attributes.position, n=pos.count;
    let normAttr=geo.attributes.normal;
    if(!normAttr){ geo.computeVertexNormals(); normAttr=geo.attributes.normal; }
    // stash the original material once so OFF restores it exactly
    if(!mesh.userData.__origMat){ mesh.userData.__origMat=mesh.material; }
    // build / reuse a color attribute
    let colAttr=geo.attributes.color;
    if(!colAttr || colAttr.count!==n){ colAttr=new THREE.BufferAttribute(new Float32Array(n*3),3); geo.setAttribute('color',colAttr); }

    // ---- STATIC per-vertex Derive cells + INTERIOR/EXTERIOR class: build ONCE,
    // memoise on the geometry. Each cell carries the MODEL-frame position +
    // MODEL-frame normal (so it matches Astro.sun().dir + the occluder boxes) and
    // lazily-cached SVF/exposure. Rebuilt only if the vertex count changed (e.g. a
    // re-subdivide) or the role changed.
    //
    // INTERIOR/EXTERIOR (GOAL A): for each vertex we ask Derive.classifyHouseFace
    // whether its face looks OUT to open air or IN to an enclosed room (analytic
    // test against the house solids — see derive.js). The per-vertex class is
    // cached in __thermClass (Uint8): 0=EXTERIOR (full sun/sky balance),
    // 1=INTERIOR PARTITION / interior floor (≈ indoor air, uniform), 2=INNER FACE
    // OF AN EXTERIOR WALL (indoor air + a small conduction nudge toward the baking
    // exterior face). For class 2 we also build a FLIPPED exterior cell (same point,
    // outward-flipped normal) so each frame we can cheaply read that wall's real
    // EXTERIOR-face temperature to feed the conduction nudge. Static geometry →
    // classified ONCE; interior verts are then CHEAPER per frame (no shadow ray-cast
    // + no sky terms), so enabling this only helps performance.
    let cells=geo.userData.__thermCells;
    let cls=geo.userData.__thermClass;
    let extCells=geo.userData.__thermExtCells;   // sparse: flipped exterior cell for class-2 verts
    if(!cells || cells.length!==n || geo.userData.__thermRole!==role){
      mesh.updateWorldMatrix(true,false);
      // relative transform mesh-local → G-local (model frame): G⁻¹ · meshWorld
      _mRel.copy(G.matrixWorld).invert().multiply(mesh.matrixWorld);
      _mNorm.getNormalMatrix(_mRel);
      cells=new Array(n);
      cls=new Uint8Array(n);
      extCells=new Array(n);
      if(window.Derive && Derive.makeHouseCell){
        const canClassify=!!Derive.classifyHouseFace;
        for(let i=0;i<n;i++){
          _vp.set(pos.getX(i),pos.getY(i),pos.getZ(i)).applyMatrix4(_mRel);          // model position
          _vn.set(normAttr.getX(i),normAttr.getY(i),normAttr.getZ(i)).applyMatrix3(_mNorm).normalize(); // model normal
          cells[i]=Derive.makeHouseCell(_vp.x,_vp.y,_vp.z,{x:_vn.x,y:_vn.y,z:_vn.z});
          if(canClassify){
            const here=Derive.classifyHouseFace(_vp.x,_vp.y,_vp.z,{x:_vn.x,y:_vn.y,z:_vn.z});
            if(!here.interior){ cls[i]=0; }                       // EXTERIOR
            else {
              // interior face: is it the INNER face of an EXTERIOR wall? flip the
              // normal — if the OTHER side looks OUT to open air, this is an exterior
              // wall's inner face (conduction nudge); if the other side is ALSO
              // interior, it's a pure partition / interior floor (uniform indoor).
              const flip=Derive.classifyHouseFace(_vp.x,_vp.y,_vp.z,{x:-_vn.x,y:-_vn.y,z:-_vn.z});
              if(!flip.interior){
                cls[i]=2;
                // flipped exterior cell: same point, OUTWARD-flipped normal → its
                // bias points to the true exterior, giving the real outdoor balance.
                extCells[i]=Derive.makeHouseCell(_vp.x,_vp.y,_vp.z,{x:-_vn.x,y:-_vn.y,z:-_vn.z});
              } else { cls[i]=1; }
            }
          }
        }
      }
      geo.userData.__thermCells=cells; geo.userData.__thermRole=role;
      geo.userData.__thermClass=cls; geo.userData.__thermExtCells=extCells;
    }

    let lo=Infinity, hi=-Infinity;
    const temps=new Float32Array(n);
    const usePoint=!!(window.Derive && Derive.surfaceTempAtPoint && cells[0]);
    // indoor air temp computed ONCE per call (cheap, same for every interior vertex
    // this frame) and threaded into the interior path.
    const indoorC=env.indoorC;
    for(let i=0;i<n;i++){
      let T;
      if(usePoint){
        const c=cells[i];
        const k=cls?cls[i]:0;
        if(k===0){
          // EXTERIOR: full energy balance — its OWN cached SVF + this-instant shadow.
          // lag:false → ONE shadow eval per vertex (the dominant per-vertex cost).
          T=Derive.surfaceTempAtPoint(c.xL,c.y,c.zL, c.normal, date, {
            cell:c, material:role, sun:sun, airC:env.airC, rad:env.rad,
            windKmh:env.windKmh, cloud:env.cloud, lag:false });
        } else if(k===2){
          // INNER FACE OF AN EXTERIOR WALL: compute that wall's exterior-face temp
          // (the flipped cell, full outdoor balance) then nudge indoor toward it.
          const ec=extCells[i];
          let extT=null;
          if(ec){ extT=Derive.surfaceTempAtPoint(ec.xL,ec.y,ec.zL, ec.normal, date, {
              cell:ec, material:role, sun:sun, airC:env.airC, rad:env.rad,
              windKmh:env.windKmh, cloud:env.cloud, lag:false }); }
          T=Derive.surfaceTempAtPoint(c.xL,c.y,c.zL, c.normal, date, {
            interior:true, indoorTempC:indoorC, extFaceTempC:extT, lag:false });
        } else {
          // INTERIOR PARTITION / interior floor: ≈ indoor air, uniform (sun-indep).
          T=Derive.surfaceTempAtPoint(c.xL,c.y,c.zL, c.normal, date, {
            interior:true, indoorTempC:indoorC, lag:false });
        }
      } else {
        // defensive fallback: normal-only (old behaviour) if Derive lacks the helper.
        _vn.set(normAttr.getX(i),normAttr.getY(i),normAttr.getZ(i));
        T=Derive.surfaceTemp(_vn,date,{ material:role, sun:sun,
          airC:env.airC, rad:env.rad, windKmh:env.windKmh, cloud:env.cloud });
      }
      const t=(T==null)?env.airC:T; temps[i]=t;
      if(t<lo) lo=t; if(t>hi) hi=t;
    }
    return { temps, colAttr, lo, hi };
  }
  function setThermal(on,date){
    // find the live house group via the global app handle, falling back to a
    // scan of window.__houseGroup if app.js exposed it. app.js calls us with the
    // group available through window.__house (set at build wiring) — but to stay
    // decoupled we accept whatever group registered itself last via _register.
    const G=_activeGroup;
    if(!G){ _thermalOn=on; return null; }
    const glassSet=new Set((G.userData&&G.userData.glass)||[]);
    if(!on){
      // RESTORE: put every mesh's original material back (the shared M.* material
      // it was built with). The thermal MeshBasicMaterial + color attribute are
      // kept cached on the mesh for a cheap re-enable; they don't affect the
      // restored look because the original material has vertexColors=false.
      G.traverse(o=>{ if(o.isMesh && o.userData.__origMat){
        o.material=o.userData.__origMat; o.userData.__origMat=null;
      }});
      _thermalOn=false; return null;
    }
    _thermalOn=true;
    const A=(typeof window!=='undefined')&&window.Astro;
    const W=(typeof window!=='undefined')&&window.Weather;
    const d=date||new Date();
    const sun=(A&&A.sun)?A.sun(d):null;
    // sample the live environment ONCE per call (not per vertex) for consistency
    const env={
      airC:(W&&W.state&&W.state.temp!=null)?W.state.temp:18,
      rad:(W&&W.envAt)?W.envAt('rad',d):null,
      windKmh:(W&&W.state&&W.state.wind!=null)?W.state.wind
             :((W&&W.cur&&W.cur.wind!=null)?Math.max(0,(W.cur.wind-0.1)*40):8),
      cloud:(W&&W.cur&&W.cur.cloud!=null)?W.cur.cloud:((W&&W.state&&W.state.cloud!=null)?W.state.cloud:0.1)
    };
    // INDOOR air temp for THIS instant — the damped/lagged response of the heavy
    // mass to the outdoor temp (derive.js). Computed ONCE here and reused for every
    // interior vertex (they all share it). Falls back to the outdoor air if Derive
    // lacks the model.
    env.indoorC=(window.Derive&&Derive.indoorTemp)?Derive.indoorTemp(d).tempC:env.airC;
    if(!window.Derive||!Derive.surfaceTemp||!Derive.tempColor){ return null; }
    const roleMap=_roleMap(G);
    // make sure the whole house chain's world matrices are current before we read
    // mesh.matrixWorld / G.matrixWorld for the model-frame transforms.
    G.updateWorldMatrix(true,true);
    // PASS 1: compute per-vertex temps + the global min/max across the house, so
    // the colour ramp is auto-scaled to the actual spread THIS frame (high
    // contrast between warm & cool zones regardless of the absolute air temp).
    const jobs=[];
    let lo=Infinity, hi=-Infinity;
    G.traverse(o=>{ if(!o.isMesh) return;
      const r=_colorMesh(o,roleMap,glassSet,d,sun,env,G);
      if(r){ jobs.push({mesh:o,r}); if(r.lo<lo)lo=r.lo; if(r.hi>hi)hi=r.hi; }
    });
    if(!isFinite(lo)||!isFinite(hi)){ return null; }
    // pad the range a touch and guarantee a minimum span so flat-temp scenes
    // (e.g. overcast night) still show subtle structure rather than uniform blue.
    if(hi-lo<6){ const mid=(lo+hi)/2; lo=mid-3; hi=mid+3; }
    const range=[Math.round(lo),Math.round(hi)];
    // PASS 2: map temps → colours through the shared ramp, write vertex colors,
    // swap each mesh to an unlit vertex-coloured MeshBasicMaterial (the heatmap
    // must read as DATA, independent of sun/shadow lighting in the scene).
    jobs.forEach(({mesh,r})=>{
      const arr=r.colAttr.array, t=r.temps;
      for(let i=0;i<t.length;i++){ const c=Derive.tempColor(t[i],range);
        arr[i*3]=c.r; arr[i*3+1]=c.g; arr[i*3+2]=c.b; }
      r.colAttr.needsUpdate=true;
      // reuse a per-mesh thermal material so repeated frames don't leak materials
      if(!mesh.userData.__thermMat){
        mesh.userData.__thermMat=new THREE.MeshBasicMaterial({ vertexColors:true });
      }
      mesh.material=mesh.userData.__thermMat;
      mesh.material.vertexColors=true; mesh.material.needsUpdate=true;
    });
    _lastRange=range;
    return { range, count:jobs.length };
  }
  // app.js registers the built house group so setThermal can find it without
  // app.js having to thread it through every call.
  let _activeGroup=null;
  function _register(G){ _activeGroup=G; }

  // ---- terrace/courtyard railing (מעקה): green-painted tubular metal ----
  function railing(x1,z1,x2,z2, baseY, G, M){
    const horiz=Math.abs(z2-z1)<1e-6, len=horiz?Math.abs(x2-x1):Math.abs(z2-z1);
    const ox=Math.min(x1,x2), oz=Math.min(z1,z2);
    const y0=baseY+0.15;                      // sit on the kerb
    const grp=new THREE.Group();
    const r=0.022;
    [RAILH-0.05, RAILH*0.55].forEach(hy=>{    // top + mid rails
      const rail=new THREE.Mesh(new THREE.CylinderGeometry(r,r,len,8),M.railing);
      rail.rotation.z=Math.PI/2; rail.position.set(len/2,y0+hy,0); rail.castShadow=true; grp.add(rail);
    });
    const n=Math.max(2,Math.round(len/0.95));
    for(let i=0;i<=n;i++){
      const p=new THREE.Mesh(new THREE.CylinderGeometry(r,r,RAILH,8),M.railing);
      p.position.set(len*i/n, y0+RAILH/2, 0); p.castShadow=true; grp.add(p);
    }
    grp.position.set(ox, 0, horiz?z1:oz); grp.rotation.y=horiz?0:-Math.PI/2; G.add(grp);
  }

  // ---- a straight stepped stair flight, climbing in the -z (north)
  //      direction. (x0..x1) = tread width band; zBottom = south foot,
  //      zTop = north head; yBottom→yTop the storey rise. Lightweight
  //      stacked boxes (treads) + two stringers; casts/receives shadow.
  function stairsFlight(x0,x1, zBottom, zTop, yBottom, yTop, G, M){
    const w=Math.abs(x1-x0), cx=(x0+x1)/2;
    const runZ=Math.abs(zBottom-zTop), rise=yTop-yBottom;
    const n=Math.max(8, Math.round(rise/0.19));   // ~19 cm risers
    const tread=runZ/n, riserH=rise/n;
    const grp=new THREE.Group();
    for(let i=0;i<n;i++){
      // step i: top surface at yBottom + (i+1)*riserH; spans one tread depth.
      const zc = zBottom - (i+0.5)*tread;          // marching north (-z)
      const topY = yBottom + (i+1)*riserH;
      const step=new THREE.Mesh(new THREE.BoxGeometry(w, riserH+0.02, tread+0.01), M.concrete);
      step.position.set(cx, topY-riserH/2, zc);
      step.castShadow=true; step.receiveShadow=true; grp.add(step);
    }
    // two side stringers (sloped slabs) for a finished read
    const len=Math.hypot(runZ, rise), ang=Math.atan2(rise, runZ);
    [x0+0.04, x1-0.04].forEach(sx=>{
      const str=new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, len), M.wood);
      str.position.set(sx, yBottom+rise/2-0.10, (zBottom+zTop)/2);
      str.rotation.x = -ang;                       // tilt to follow the climb
      str.castShadow=true; str.receiveShadow=true; grp.add(str);
    });
    G.add(grp); return grp;
  }

  return { build, GH, setThermal, _register, get thermalOn(){return _thermalOn;}, get thermalRange(){return _lastRange;} };
})();
window.Building = Building;
