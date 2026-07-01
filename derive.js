/* ===================================================================
   derive.js — the ESSENCE layer: hyper-local facts DERIVED for Alex's
   exact house & land that he can't get from any generic app.
   Pure logic over his real geometry + real terrain horizon + his real
   alex-gift model data + live sun/weather/biodiversity. No UI here.

   This revision replaces the one-term surface-temperature overlay with a
   physically-grounded SURFACE ENERGY BALANCE resolved per ~0.5 m cell over
   Alex's three yard zones, and a plant-suitability ranking ("which plant in
   which corner of which terrace in which season"). See microclimate-spec.md.
   Everything modelled is flagged estimate:true — a physically-grounded
   ESTIMATE, not a measurement and not a CFD/ENVI-met solve ("model · estimate").
   =================================================================== */
const Derive = (function(){
  const LAT=34.0000, LON=-40.0000;
  const DATA={ site:null, horizon:null, zoneSun:null, energy:null, plants:null, numbers:null };

  async function load(){
    const get=(p)=>fetch(p).then(r=>r.json()).catch(()=>null);
    const [site,horizon,zoneSun,energy,plants,numbers]=await Promise.all([
      get('data/site.json'),get('data/horizon.json'),get('data/zone_sun_hours.json'),
      get('data/energy.json'),get('data/resident_plants.json'),get('data/resident_numbers.json')]);
    Object.assign(DATA,{site,horizon,zoneSun,energy,plants,numbers});
    return DATA;
  }
  const ready=load();

  /* ---- his real terrain horizon ---- */
  function horizonAt(azDeg){
    const H=DATA.horizon; if(!H||!H.length) return 0;
    let az=((azDeg%360)+360)%360, i=Math.round(az-0.5); if(i<0)i+=H.length; i%=H.length;
    const e=H[i]; return (e&&(e.horizon_elev_deg!=null?e.horizon_elev_deg:e.elev))||0;
  }
  const sunAboveRidge=(alt,az)=>alt>horizonAt(az);
  const azIn=(az,a,b)=>{az=((az%360)+360)%360;return a<=b?(az>=a&&az<=b):(az>=a||az<=b);};

  /* ---- per-zone sun/shade for a sun position ---- */
  function zoneState(z,az,alt){
    if(alt<=-0.5) return {sunlit:false,by:'night',label:'night'};
    if(!sunAboveRidge(alt,az)) return {sunlit:false,by:'terrain',label:'behind the ridge'};
    for(const s of (z.shades||[])) if(azIn(az,s.blocked_azimuth_from,s.blocked_azimuth_to)&&alt<s.blocked_above_elev_deg)
      return {sunlit:false,by:'wall',label:'shaded by the wall'};
    return {sunlit:true,by:'sun',label:'in the sun'};
  }
  function radiation(alt,sunlit,cloud){
    const s=Math.max(0,Math.sin(alt*Math.PI/180));
    let ghi=1000*s*(1-0.75*(cloud||0)); if(!sunlit) ghi*=0.12; ghi=Math.round(ghi);
    const level=ghi>750?'extreme':ghi>500?'high':ghi>220?'moderate':ghi>40?'low':'negligible';
    const uv=Math.max(0,Math.round((sunlit?1:0.25)*12*s*(1-0.6*(cloud||0))*10)/10);
    return {ghi,level,uv,frac:Math.min(1,ghi/1000)};
  }

  /* ====================================================================
     §1 PHYSICS CONSTANTS + SHARED HELPERS for the surface energy balance.
     ==================================================================== */
  const SIGMA=5.67e-8;                 // Stefan–Boltzmann (W/m²K⁴)
  const EPS_SURF=0.90;                 // long-wave emissivity of natural surfaces
  const ALBEDO_GROUND=0.30;            // pale the highlands gravel/stucco ground albedo
  const ABSORPTIVITY={                 // solar absorptivity α by material role
    roof:0.90, shingle:0.92, paving:0.70, deck:0.68, stone:0.62,
    wall:0.50, stucco:0.50, sand:0.66, glass:0.40, metal:0.55, wood:0.78,
    leaf:0.50, gravel:0.65, default:0.55 };
  const SOLAR_CONST=1050;              // clear-sky beam reference at zenith (W/m²)
  const C2K=273.15;
  const clamp01=v=>Math.max(0,Math.min(1,v));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  // vapour pressure (hPa) from air temp °C + RH % (Magnus form for e_s).
  function vapourPressure(tempC,rh){
    const es=6.112*Math.exp(17.62*tempC/(243.12+tempC));   // saturation hPa
    return es*(clamp01((rh==null?40:rh)/100));
  }
  // Brunt clear-sky emissivity + cloud adjustment → sky temperature (K).
  // ε_clear = 0.52 + 0.065·√e ; ε_sky = ε_clear + (1−ε_clear)·c ;
  // T_sky = T_air·ε_sky^0.25 (grey-sky radiative equivalent). Clear dry the highlands
  // night → T_sky ~20–25 K below T_air — the engine of radiative frost.
  function skyTempK(airC,rh,cloud){
    const e=vapourPressure(airC,rh);
    let epsC=0.52+0.065*Math.sqrt(Math.max(0,e));
    epsC=clamp(epsC,0.45,0.92);
    const c=clamp01(cloud==null?0.1:cloud);
    const epsSky=epsC+(1-epsC)*c;                 // overcast → ε≈1 → T_sky≈T_air
    return (airC+C2K)*Math.pow(clamp01(epsSky),0.25);
  }
  // clear-sky GHI (W/m²) for a solar altitude — used for the seasonal bake when
  // live Open-Meteo radiation isn't available for the representative date.
  // ALTITUDE/TURBIDITY-ADJUSTED Kasten clear-sky (M3): the old sea-level
  // 0.7^(AM^0.678) standard-atmosphere model under-predicted this 300 m clean-air
  // desert site (~808 vs the measured ~1000 W/m² clear noon; ~15-20% low), which
  // starved baked DLI / ET0. We now use a Kasten-Young air mass with a 0.965
  // ALTITUDE pressure correction (p/p0 at 300 m) and a cleaner-desert beam
  // transmission. Validated: clear summer noon (alt≈79.4°)→~1010 W/m²; the clear
  // annual horizontal GHI integrates to ~2,150 kWh/m²/yr, in the Larkmont TMY band
  // (~2,100) — which is why the energy.json ghi_calibration fudge is now ~1.0.
  // (Live per-frame path uses real Open-Meteo radiation and is untouched.)
  const _CS_I0N=1140;        // clear-sky beam reference at AM≈1 (W/m², clean desert)
  const _CS_TB=0.79;         // beam transmission base (less turbidity at altitude)
  const _CS_PRESS=0.965;     // relative pressure p/p0 at ~300 m (exp(-300/8400))
  function clearSkyGHI(altDeg,cloud){
    const alt=altDeg||0;
    const s=Math.max(0,Math.sin(alt*Math.PI/180));
    if(s<=0) return 0;
    // Kasten-Young (1989) relative air mass, altitude-pressure corrected.
    const am=_CS_PRESS/(s+0.50572*Math.pow(alt+6.07995,-1.6364));
    const beam=_CS_I0N*Math.pow(_CS_TB,Math.pow(am,0.678));   // beam-normal (W/m²)
    const dhi=0.10*beam*s + 12*s;                             // clean-sky diffuse on horizontal
    const ghi=(beam*s + dhi)*(1-0.75*clamp01(cloud==null?0.1:cloud));
    return Math.max(0,ghi);
  }
  // Erbs-style diffuse fraction of GHI from a clearness proxy. Clear the highlands →
  // ~12% diffuse; heavy cloud → most of the (reduced) GHI is diffuse.
  function diffuseFraction(altDeg,cloud,ghi){
    const s=Math.max(0.001,Math.sin((altDeg||0)*Math.PI/180));
    const ghi0=SOLAR_CONST*s;                         // rough clear-sky horizontal beam
    let kt=(ghi0>1)?clamp01(ghi/ghi0):0.2;            // clearness index
    const c=clamp01(cloud==null?0.1:cloud);
    // blend a clearness-based fraction with a cloud-based one
    let dfClear;
    if(kt<=0.22) dfClear=1-0.09*kt;
    else if(kt<0.8) dfClear=0.9511-0.1604*kt+4.388*kt*kt-16.638*kt*kt*kt+12.336*Math.pow(kt,4);
    else dfClear=0.165;
    const dfCloud=0.12+0.83*c;                        // empirical: 12% clear .. ~95% overcast
    return clamp01(Math.max(dfClear,dfCloud*0.0+ (0.6*dfClear+0.4*dfCloud)));
  }

  /* --------------------------------------------------------------------
     ANALYTIC OCCLUDER BOXES (house-local frame: +x=E, +y=up, +z=S; origin
     at the NW corner of the built block — the SAME frame site.json zone
     offsets + app.js YardShade use). From building.js geometry constants +
     environment.js boundary walls + site.json neighbours. Used by the fast
     box-ray shadow test (preferred over THREE.Raycaster for a <~1 s bake).
     -------------------------------------------------------------------- */
  const BX=8.41, BZ=7.20, SITE_Z=10.29;       // built block + back strip (building.js)
  const BXS=BX+2.09;                          // 10.50 — SOUTH-band / courtyard east extent (L-shape)
  const ROOF=5.30, PARAPET=5.70;              // top of upper volume / parapet
  const DECK_Y=2.80;                          // terrace deck level
  const GX=3.18, GZ=3.60;                      // interior grid lines (building.js): upper-L extent + east step line
  const CX=BX/2, CZ=SITE_Z/2;                 // footprint centre in model coords (app.js cx,cz)
  // ---- HOUSE YAW (re-orientation) ----------------------------------------------
  //   building.js geometry + these OCCLUDERS + the site.json zones are all authored
  //   in the PLAN frame (courtyard at +z). app.js rotates the RENDERED house by
  //   HOUSE_YAW_DEG so the real open back-yard/courtyard faces EAST and the entrance
  //   faces WEST. Astro's sun is in the WORLD frame (+x=E), so to test it against
  //   these plan-frame occluders we rotate the sun INTO the plan frame (Ry(-yaw));
  //   terrain-ridge horizon stays in WORLD az. KEEP IN SYNC with app.js houseWrap.rotation.y.
  const HOUSE_YAW_DEG=95, _hyR=HOUSE_YAW_DEG*Math.PI/180, _hcy=Math.cos(_hyR), _hsy=Math.sin(_hyR);
  function toPlanDir(d){ return { x:d.x*_hcy - d.z*_hsy, y:d.y, z:d.x*_hsy + d.z*_hcy }; } // world dir → plan dir
  function realAz(planAz){ return ((planAz - HOUSE_YAW_DEG)%360+360)%360; }                // plan sweep az → world az
  // boundary-wall + neighbour geometry
  const NEI_OFF=14.5, NEI_H=7.0, NEI_NS=10.50, NEI_EW=10.29; // site.json neighbours
  // box list: {x0,x1,y0,y1,z0,z1}.
  // The house is now split into a LOWER full-footprint block (everything below
  // the terrace deck) + the UPPER enclosed-L volume (north band + SW bedroom),
  // because the upper rooms ARE a real self-occluder for the open terrace deck
  // beside them: the part of the balcony next to the upper rooms is in shade for
  // part of the day. The old single full-height 'house' box let a deck cell (which
  // self-skips the block it rests on) skip the upper rooms too → the whole balcony
  // got identical sun. Splitting lets a terrace cell self-skip only the LOWER
  // block (role 'deck') it rests on while the upper-L still shades it.
  const OCCLUDERS=[
    // LOWER built block — full footprint up to the terrace deck level, now L-SHAPED:
    //   NORTH band (x 0..BX, z 0..GZ) + wide SOUTH band (x 0..BXS, z GZ..BZ). A
    //   terrace cell rests ON THIS (selfRole 'deck') so it self-skips both 'deck'
    //   boxes. Two boxes trace the same L footprint as building.js's slab.
    {x0:0.0, x1:BX,  y0:0.0, y1:DECK_Y, z0:0.0, z1:GZ, role:'deck'},   // lower block — north band
    {x0:0.0, x1:BXS, y0:0.0, y1:DECK_Y, z0:GZ,  z1:BZ, role:'deck'},   // lower block — south band (wide)
    // UPPER enclosed-L volume above the deck (north band z 0..GZ across the width).
    //   The upper enclosed rooms do NOT jut — only the deck/living band below does —
    //   so the north-band upper box stays at x 0..BX.
    {x0:0.0, x1:BX, y0:DECK_Y, y1:PARAPET, z0:0.0, z1:GZ, role:'house_upper'},
    // UPPER enclosed-L volume — SW bedroom block (x 0..GX, z GZ..BZ) above the deck
    {x0:0.0, x1:GX, y0:DECK_Y, y1:PARAPET, z0:GZ, z1:BZ, role:'house_upper'},
    // courtyard back-strip storage (storage shed), SE corner of the wider courtyard, against
    //   the BXS east edge; low shingle roof ~2.55
    {x0:BXS-2.72, x1:BXS, y0:0.0, y1:2.55, z0:BZ, z1:BZ+2.94, role:'storage'},
    // outer plot boundary walls (environment.js lowWall)
    {x0:-1.30, x1:10.70, y0:0.0, y1:1.30, z0:-1.30, z1:-1.10, role:'wall_n'}, // north (street) 1.3 m
    {x0:-1.30, x1:-1.10, y0:0.0, y1:2.00, z0:-1.20, z1:11.0, role:'wall_w'}, // west 2.0 m
    {x0: 10.60, x1: 10.80, y0:0.0, y1:2.00, z0:-1.20, z1:11.0, role:'wall_e'}, // east 2.0 m (just E of BXS)
    // ---- NEIGHBOUR CLUSTER (Alex's unit is 1 of ~5 sharing a plaza) -------------
    //   After the re-orientation, world-EAST is OPEN desert (NO neighbour); the built
    //   units + the shared plaza are on world-WEST, the row continues world-N/S.
    //   PLAN→WORLD (houseWrap +95°): world-W=plan -z, world-N=plan +x, world-S=plan -x,
    //   world-E=plan +z (LEFT OPEN). Heights ~6 m (1-2 storey, INFERRED — refine from a
    //   photo). The sealed east-facade windows abut the world-N neighbour. These match
    //   the environment.js visual massing so shading + picture agree. (Replaces the two
    //   ±14.5 m N/S boxes — one of which wrongly shaded the open eastern back-yard.)
    {x0:-1.0,  x1:BXS,  y0:0.0, y1:6.0, z0:-11.0, z1:-4.5,  role:'nbr_w'},  // world-WEST: units ACROSS the plaza (plaza gap left open ~-1.2..-4.5)
    {x0:10.7,  x1:16.0, y0:0.0, y1:6.0, z0:0.0,   z1:10.3,  role:'nbr_n'},  // world-NORTH: abutting unit (sealed wall faces it)
    {x0:-7.5,  x1:-1.3, y0:0.0, y1:6.0, z0:0.0,   z1:10.3,  role:'nbr_s'}   // world-SOUTH: row unit
    // world-EAST (plan +z beyond the courtyard) intentionally OPEN — the desert/view
  ];
  // house-family roles (the built structure itself) — used by the per-vertex
  // house path, which skips whichever house box the (biased) point sits ON while
  // still letting OTHER house sub-blocks (e.g. the upper rooms over a lower roof,
  // the storage wing) shade it. 'house' kept for back-compat (legacy callers /
  // cells that pass selfRole:'house' still skip ALL of these via HOUSE_FAMILY).
  const HOUSE_FAMILY={ deck:1, house_upper:1, house:1, storage:1 };

  // Slab/ray vs AABB: does the ray from `p` (origin, slightly lifted) in
  // unit direction `d` hit box `b` at any t>eps? (standard slab test). We only
  // care about a hit existing (binary shadow), and we exclude the box the cell
  // itself sits on by a small epsilon start-offset along d.
  function rayHitsBox(px,py,pz,dx,dy,dz,b){
    const EPS=1e-4;
    let tmin=EPS, tmax=Infinity;
    // x slab
    if(Math.abs(dx)<1e-9){ if(px<b.x0||px>b.x1) return false; }
    else { let t1=(b.x0-px)/dx, t2=(b.x1-px)/dx; if(t1>t2){const t=t1;t1=t2;t2=t;}
      tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2); if(tmin>tmax) return false; }
    // y slab
    if(Math.abs(dy)<1e-9){ if(py<b.y0||py>b.y1) return false; }
    else { let t1=(b.y0-py)/dy, t2=(b.y1-py)/dy; if(t1>t2){const t=t1;t1=t2;t2=t;}
      tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2); if(tmin>tmax) return false; }
    // z slab
    if(Math.abs(dz)<1e-9){ if(pz<b.z0||pz>b.z1) return false; }
    else { let t1=(b.z0-pz)/dz, t2=(b.z1-pz)/dz; if(t1>t2){const t=t1;t1=t2;t2=t;}
      tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2); if(tmin>tmax) return false; }
    return tmax>tmin;
  }
  // the low plot-edge garden walls (environment.js lowWall, 1.3–2.0 m) are
  // decorative boundary lines, not surveyed for solar geometry. Treating them as
  // hard direct-beam occluders boxes the open eastern backyard in and contradicts
  // the VALIDATED per-zone sun-hours baseline (data/zone_sun_hours.json: backyard
  // ~7.5 h summer). So they are EXCLUDED from the direct-beam shadow test and
  // count only weakly toward SVF/wind (a low wall does block a sliver of low sky).
  // The real solar massing — the house block, its storage wing, and the ±14.5 m
  // neighbour houses — is always honoured. (Documented approximation; see the
  // fidelity note. The hand-authored shades[] in site.json remain a fallback.)
  const WALL_ROLES={ wall_n:1, wall_w:1, wall_e:1 };
  function blockedByGeometry(px,py,pz,dx,dy,dz,selfRole,skipWalls){
    for(const b of OCCLUDERS){
      // self-skip: a cell on the LOWER block passes selfRole 'deck' (skip just the
      // lower block — the upper rooms still shade it); the legacy 'house' selfRole
      // skips the WHOLE house family (back-compat for old callers / cells).
      if(selfRole){
        if(selfRole==='house'){ if(HOUSE_FAMILY[b.role]) continue; }
        else if(b.role===selfRole) continue;
      }
      if(skipWalls && WALL_ROLES[b.role]) continue;
      if(rayHitsBox(px,py,pz,dx,dy,dz,b)) return true;
    }
    return false;
  }
  // PER-VERTEX HOUSE shadow test: the point sits ON the house, so we (a) start
  // the ray slightly OUTWARD along the surface normal (shadow bias, supplied by
  // the caller in px/py/pz) and (b) skip any HOUSE_FAMILY box the biased point is
  // still inside/touching, so the wall it sits on cannot spuriously block its own
  // sun — while OTHER house sub-blocks (the upper rooms oversailing a lower roof,
  // the storage wing) and the neighbours / boundary walls DO shade it. This is
  // what gives a single wall real intra-surface variation (a corner or a strip
  // beside the upper block goes into shade) instead of one flat colour.
  function blockedForHousePoint(px,py,pz,dx,dy,dz,skipWalls){
    const PAD=0.12;   // a vertex on a face is ~on the box plane → pad the inside test
    for(const b of OCCLUDERS){
      if(skipWalls && WALL_ROLES[b.role]) continue;
      if(HOUSE_FAMILY[b.role]){
        // is the (biased) point inside/on this house box? then it's the structure
        // the vertex belongs to — skip it (the bias already cleared its own face).
        if(px>b.x0-PAD && px<b.x1+PAD && py>b.y0-PAD && py<b.y1+PAD && pz>b.z0-PAD && pz<b.z1+PAD) continue;
      }
      if(rayHitsBox(px,py,pz,dx,dy,dz,b)) return true;
    }
    return false;
  }

  /* ---- INTERIOR vs EXTERIOR FACE CLASSIFICATION (analytic, geometry-only) ----
     building.js needs to know, per thermal vertex, whether its face looks OUT to
     open air (sun/sky-driven skin) or IN to an enclosed room (indoor-driven).

     The robust signal, given that the house OCCLUDERS are COARSE FILLED solids
     (the lower full-footprint block, the upper enclosed-L volume, the storage),
     NOT room-resolved boxes: push the vertex a small bias ALONG ITS OUTWARD
     NORMAL, then ask whether that biased point is still INSIDE the house's solid
     envelope.
       · EXTERIOR faces (outer walls, roof top, deck top): the outward bias pops
         the point just OUTSIDE every solid box → it sees open air immediately.
       · INTERIOR faces (inner wall faces, BOTH faces of a thin partition, the
         interior floor/ceiling underside): their normal points into a room that
         is itself inside the solid envelope, so the "outward"-biased point stays
         INSIDE a solid box → enclosed.
     This is equivalent to (and cross-checked by) the spec's room-scale ray test
     and by SVF (a point inside the envelope scans ~no sky → SVF≈0), but works
     with the coarse filled-box geometry where an outward ray-vs-other-surfaces
     test cannot (the rooms aren't modelled as cavities). A slightly larger bias
     than the shadow bias is used so a thin-partition face clears its own ~0.12 m
     slab but is still well within the metres-deep solid block around it. ------ */
  const CLASSIFY_BIAS=0.25;   // m along the outward normal for the inside/outside test
  function _insideHouseSolid(px,py,pz){
    const PAD=0.02;   // tiny tolerance so a point right on an inner face still reads inside
    for(const b of OCCLUDERS){
      if(!HOUSE_FAMILY[b.role]) continue;            // only the dwelling's solid volumes
      if(b.role==='storage') continue;               // store is a thin shed, not a room shell
      // EFFECTIVE enclosed-room TOP: the upper-L occluder box runs up to the PARAPET
      // (5.70) for shadow casting, but the ROOM CEILING is the ROOF SLAB (5.30) —
      // the 5.30→5.70 band between the parapets is OPEN SKY, not enclosed. So a
      // ROOF-TOP vertex biased upward must escape the solid → read EXTERIOR. Cap the
      // top at ROOF for the upper volume; lower block's top (DECK_Y) is the 1F slab.
      const yTop=(b.role==='house_upper')?ROOF:b.y1;
      if(px>b.x0+PAD && px<b.x1-PAD && py>b.y0-PAD && py<yTop-PAD && pz>b.z0+PAD && pz<b.z1-PAD) return true;
    }
    return false;
  }
  // classify a house-surface point. Returns {interior:bool, svf:number} where svf
  // is the same cell SVF building.js will reuse (cross-check: interior ≈ 0).
  function classifyHouseFace(xL,yL,zL, worldNormal){
    let nx=worldNormal&&worldNormal.x, ny=worldNormal&&worldNormal.y, nz=worldNormal&&worldNormal.z;
    if(nx==null||ny==null||nz==null){ nx=0; ny=1; nz=0; }
    const nlen=Math.hypot(nx,ny,nz)||1; nx/=nlen; ny/=nlen; nz/=nlen;
    // biased point along the OUTWARD normal
    const bx=xL+nx*CLASSIFY_BIAS, by=yL+ny*CLASSIFY_BIAS, bz=zL+nz*CLASSIFY_BIAS;
    const inside=_insideHouseSolid(bx,by,bz);
    return { interior:inside };
  }
  // max obstruction elevation (deg) along an azimuth, from the analytic boxes:
  // sample a few candidate elevations and find where a ray first clears all
  // boxes. Combined with the terrain horizon for the full skyline. Used by SVF
  // + windExposure (geometry side). Coarse (binary search) but cached.
  // `housePoint` routes the occlusion through blockedForHousePoint (a point ON the
  // house surface), so its own block doesn't self-block the sky scan; selfRole is
  // used for yard cells. Both feed the SVF + wind-exposure horizon scan.
  function geomHorizonElev(px,py,pz,azDeg,selfRole,housePoint){
    const blk=housePoint
      ? (dx,dy,dz)=>blockedForHousePoint(px,py,pz,dx,dy,dz,false)
      : (dx,dy,dz)=>blockedByGeometry(px,py,pz,dx,dy,dz,selfRole,false);
    // azimuth → world direction (matches Astro.vec: +x=E sin(az), +z=-cos(az))
    const a=azDeg*Math.PI/180, hx=Math.sin(a), hz=-Math.cos(a);
    // binary search the lowest elevation that is NOT blocked (0..85°)
    let lo=0, hi=85, blockedHi=false;
    // quick check: is the top of the band clear?
    {
      const el=hi*Math.PI/180, dy=Math.sin(el), c=Math.cos(el);
      blockedHi=blk(hx*c,dy,hz*c);
    }
    if(blockedHi) return hi;     // very tall obstruction overhead (rare)
    // is the horizon itself (0°) clear? if so, no geometry obstruction here.
    {
      const dy=0, c=1;
      if(!blk(hx*c,dy,hz*c)) return 0;
    }
    // bisect: find the boundary elevation where blocked→clear. 9 iterations →
    // ~0.17° resolution, ample for an SVF integral and far cheaper than 14 (the
    // per-vertex house SVF bake calls this thousands of times).
    for(let it=0;it<9;it++){
      const mid=(lo+hi)/2, el=mid*Math.PI/180, dy=Math.sin(el), c=Math.cos(el);
      if(blk(hx*c,dy,hz*c)) lo=mid; else hi=mid;
    }
    return (lo+hi)/2;
  }

  /* ====================================================================
     §3 SPATIAL DISCRETIZATION — the ~0.5 m cell grid over the 3 zones.
     Each cell carries house-local x/z (cell centre), y(=elevation_offset),
     an up-normal for ground, zoneId, plus lazily-baked SVF/exposure/seasonal
     tables. Built from site.json offsets/sizes (same mapping as YardShade).
     ==================================================================== */
  const CELL_M=0.5;                       // ~0.5 m sample spacing
  let _grid=null;                         // cached cell list
  let _zoneCellIdx=null;                  // zoneId → [cellIndices]
  // is a GROUND-LEVEL point (x,z) buried inside an opaque solid (house block /
  // storage / neighbour)? A surveyed zone footprint can overlap the modelled
  // block (e.g. the backyard strip's inner edge sits against/under the house).
  // Such ground cells aren't real open ground → drop them so SVF/shadow aren't
  // degenerate. We ONLY test near-ground cells (y<1.0): an ELEVATED cell (the
  // terrace/balcony deck at y≈3.88) legitimately rests ON TOP of the block and
  // must be kept — the deck is open sky above, not buried.
  function insideSolid(x,y,z){
    if(y>=1.0){
      // ELEVATED (terrace/balcony) cell: keep only if on the OPEN terrace. The
      // site.json balcony footprint overspills the roofed UPPER ROOMS (north band +
      // SW bedroom), so drop any elevated cell inside the enclosed upper volume —
      // those were the stray "squares" floating over the 2nd floor / inside rooms.
      for(const b of OCCLUDERS){
        if(b.role!=='house_upper') continue;
        if(x>b.x0 && x<b.x1 && z>b.z0 && z<b.z1) return true;
      }
      return false;
    }
    for(const b of OCCLUDERS){
      if(b.role==='wall_n'||b.role==='wall_w'||b.role==='wall_e') continue; // thin walls
      if(x>b.x0 && x<b.x1 && z>b.z0 && z<b.z1 && b.y1>1.0) return true;      // inside a tall solid
    }
    return false;
  }
  function buildGrid(){
    const cells=[]; const byZone={};
    const zones=(DATA.site&&DATA.site.zones)||[];
    zones.forEach(z=>{
      const wE=Math.max(CELL_M,z.size_e_m||1), dN=Math.max(CELL_M,z.size_n_m||1);
      const nE=Math.max(1,Math.round(wE/CELL_M)), nN=Math.max(1,Math.round(dN/CELL_M));
      const xCenter=CX+(z.offset_e_m||0);     // east=+x (matches app.js YardShade)
      const zCenter=CZ-(z.offset_n_m||0);     // north=-z
      const y=(z.elevation_offset_m||0);
      byZone[z.id]=[];
      for(let i=0;i<nE;i++){
        for(let j=0;j<nN;j++){
          // local offset within the zone footprint, centred on the patch centre
          const ex=((i+0.5)/nE-0.5)*wE;       // east displacement from centre
          const nz=((j+0.5)/nN-0.5)*dN;        // north displacement from centre
          const x=xCenter+ex;
          const zz=zCenter-nz;                 // +north = -z
          if(insideSolid(x,y,zz)) continue;    // skip cells buried in the house/storage
          const id=z.id+'_'+i+'_'+j;
          const cell={ id, zoneId:z.id, xL:+x.toFixed(3), zL:+zz.toFixed(3),
                       y:+y.toFixed(3), normal:{x:0,y:1,z:0}, facing:z.facing,
                       // a cell sitting on the terrace deck rests on the LOWER block,
                       // so it self-skips ONLY that ('deck') — the UPPER rooms beside
                       // it still cast shade across part of the balcony through the
                       // day (the user's "part of the balcony was in shade" case).
                       selfRole:(y>1.0?'deck':null),
                       _svf:null, _expo:null, _seasonal:null };
          byZone[z.id].push(cells.length); cells.push(cell);
        }
      }
    });
    // ---- AMBIENT GROUND LAYER — the bare brown terrain AROUND the house --------
    // The per-zone cells above cover only the three surveyed patches; the rest of
    // Alex's plot (the gravel ground between the house, the zones and the boundary
    // walls) had NO thermal cell, so the heat-map stopped at the zone edges (the developer's
    // note: "the climate model isn't applied to the brown ground around the house").
    // Here we tile that ground with a COARSE ambient grid so the heat-map is
    // CONTINUOUS over the whole plot. PERF: ambient cells run the SAME per-season
    // bake (×N cells/season ≈ seconds — the known bottleneck), so we keep N small
    // with a coarse cell (~1.5 m vs the 0.5 m zone cells → ~9× fewer cells/m²) and
    // skip anything the house or a ground zone already covers.
    const AMB_M=1.5;                                   // coarse ambient cell (≥1.3 m, per the perf budget)
    // plot bounds in model coords, from the boundary walls / built extent (OCCLUDERS):
    //   west wall inner ≈ -1.1, east wall inner ≈ 10.6; street wall (N) ≈ -1.1;
    //   south extends past the courtyard to the storage wing (BZ+2.94 ≈ 10.14 ≈ SITE_Z).
    const AX0=-1.1, AX1=10.6, AZ0=-1.1, AZ1=SITE_Z;
    // GROUND zone footprints (model AABBs) to exclude — a ground ambient cell whose
    // centre falls inside one of these is already a real zone cell. The ELEVATED
    // balcony (y≈3.88) is ABOVE the bare ground, so it does NOT mask the ambient
    // ground beneath it (the open courtyard floor still wants its own ground reading).
    const zoneAABBs=[];
    zones.forEach(z=>{
      if((z.elevation_offset_m||0)>1.0) return;        // elevated patch → not a ground mask
      const wE=Math.max(CELL_M,z.size_e_m||1), dN=Math.max(CELL_M,z.size_n_m||1);
      const xc=CX+(z.offset_e_m||0), zc=CZ-(z.offset_n_m||0);
      zoneAABBs.push({ x0:xc-wE/2, x1:xc+wE/2, z0:zc-dN/2, z1:zc+dN/2 });
    });
    const inGroundZone=(x,zz)=>{
      for(const b of zoneAABBs) if(x>=b.x0 && x<=b.x1 && zz>=b.z0 && zz<=b.z1) return true;
      return false;
    };
    byZone.ambient=[];
    const nAX=Math.max(1,Math.round((AX1-AX0)/AMB_M)), nAZ=Math.max(1,Math.round((AZ1-AZ0)/AMB_M));
    for(let i=0;i<nAX;i++){
      for(let j=0;j<nAZ;j++){
        const x=AX0+(i+0.5)*(AX1-AX0)/nAX;
        const zz=AZ0+(j+0.5)*(AZ1-AZ0)/nAZ;
        if(insideSolid(x,0,zz)) continue;              // buried in the house/storage block
        if(inGroundZone(x,zz)) continue;               // already a surveyed ground zone cell
        // bare-desert gravel ground: flat up-normal at grade, no self-block role; the
        // bake feeds material:'gravel' for every cell, so the thermal model treats it
        // identically to a zone ground cell (house-shadow ray-cast + SVF + exposure).
        const cell={ id:'ambient_'+i+'_'+j, zoneId:'ambient', xL:+x.toFixed(3), zL:+zz.toFixed(3),
                     y:0, normal:{x:0,y:1,z:0}, facing:null, selfRole:null, ambient:true, cellM:AMB_M,
                     _svf:null, _expo:null, _seasonal:null };   // cellM → drawn at its OWN 1.5 m size (not the 0.5 m zone size), so the brown ground is actually covered
        byZone.ambient.push(cells.length); cells.push(cell);
      }
    }
    _grid=cells; _zoneCellIdx=byZone; return cells;
  }
  // NB: rebuild when EMPTY, not just when null — an early consumer (panels/seasonal
  // lookups) can call this before DATA.site has loaded, which would otherwise
  // memoise a permanently-empty grid (→ no yard heatmap, "backyard has no thermal").
  // Rebuilding an empty grid self-heals once the zones are present (buildGrid is cheap).
  function cellGrid(){ if(!_grid || _grid.length===0) buildGrid(); if(!_seasonsWarmed) _warmSeasons(); return _grid; }
  // PERF: bake all 4 named seasons' per-cell profiles in IDLE time so switching the
  // microclimate heat-map's SEASON is instant — instead of a ~1.4s synchronous re-bake of
  // all ~235 cells on the FIRST selection of a season. Time-budgeted slices via
  // requestIdleCallback (setTimeout fallback); never blocks a frame. cellProfile() caches
  // each result on cell._seasonal, so the heat-map recolor() then becomes a fast lookup.
  let _seasonsWarmed=false;
  function _warmSeasons(){
    const cells=_grid||[]; if(!cells.length) return;            // grid not built yet → retry on next cellGrid()
    _seasonsWarmed=true;
    const seasons=['winter','spring','summer','autumn'], q=[];
    seasons.forEach(s=>cells.forEach(c=>q.push([c,s])));
    let i=0;
    // Advance via setTimeout(0), NOT requestIdleCallback: during active PLAY there is no idle
    // time, so ric starves (fires only at its ~1500ms timeout) and the seasons never warm —
    // which is EXACTLY the multi-second cold-_bakeSeason gap at each season transition.
    // setTimeout(0) keeps the warm progressing steadily even mid-play, so every season is
    // cached before/by the time play reaches it. Bigger slices when idle (warm in ~6s),
    // gentler slices during play so the animation keeps moving.
    const schedule=(cb)=>setTimeout(cb,0);
    function slice(){
      const t0=Date.now();
      const dde=(typeof document!=='undefined')?document.documentElement:null;
      const playing=!!(dde&&dde.dataset&&dde.dataset.tplay==='1');
      const budget=playing?6:14;
      while(i<q.length){
        const it=q[i++];
        try{ cellProfile(it[0],it[1]); }catch(e){}
        if((Date.now()-t0)>=budget) break;
      }
      if(i<q.length) schedule(slice);
    }
    schedule(slice);
  }

  /* ---- §1a/§3 SKY-VIEW FACTOR (Zakšek horizon-angle) — cached per cell ----
     SVF = 1 − (1/N)·Σ_i sin(γ_i) over N azimuth bins, γ_i = max obstruction
     elevation in bin i (terrain via horizonAt + geometry via the analytic
     boxes). Static geometry → computed once and memoised on the cell. ------ */
  const SVF_N=24;                         // azimuth bins
  function skyViewFactor(cell){
    if(!cell) return 1;
    if(cell._svf!=null) return cell._svf;
    // a HOUSE-surface point scans the sky from just OUTSIDE its own face (its
    // outward-biased position, supplied as xL/y/zL by surfaceTempAtPoint) so the
    // wall it sits on doesn't swallow its own hemisphere; yard cells lift ~5 cm.
    // a HOUSE-surface point OR an elevated DECK cell scans the sky with the
    // "skip the block it's embedded in" rule (blockedForHousePoint): the site.json
    // balcony footprint overlaps the upper-room volume, so a deck cell can sit
    // INSIDE that block — it must not let the block it rests in swallow its own sky,
    // while the rooms BESIDE it still reduce its view.
    const housePt=cell.isHouse||cell.selfRole==='deck';
    const px=cell.xL, py=(cell.y||0)+(cell.isHouse?0:0.05), pz=cell.zL;
    // the per-vertex house SVF is baked for THOUSANDS of points, so it uses fewer
    // azimuth bins (12) than the yard grid (24) — still smooth enough for a diffuse
    // + longwave view factor, and the dominant one-time cost of enabling thermal.
    const NB=housePt?12:SVF_N;
    let sumSin=0;
    for(let k=0;k<NB;k++){
      const az=(k+0.5)*360/NB;
      const gGeom=geomHorizonElev(px,py,pz,az,cell.selfRole,housePt);
      const gTerr=horizonAt(realAz(az));                 // plan sweep az → world az for the real ridge
      const g=Math.max(0,gGeom,gTerr);
      sumSin+=Math.sin(g*Math.PI/180);
    }
    const svf=clamp01(1-sumSin/NB);
    cell._svf=+svf.toFixed(4);
    return cell._svf;
  }

  /* ---- §2.4 WIND EXPOSURE 0..1 — cached per cell ----
     exposure = mean over azimuths of (1 − obstructionElevFraction). An open
     rim/backyard ≈ 1.0; a 3-walled courtyard ≈ 0.3–0.5. Geometry only (boxes
     + terrain), so it is baked once with the SVF. ------------------------- */
  function windExposure(cell){
    if(!cell) return 1;
    if(cell._expo!=null) return cell._expo;
    const housePt=cell.isHouse||cell.selfRole==='deck';
    const px=cell.xL, py=(cell.y||0)+(cell.isHouse?0:0.5), pz=cell.zL;   // ~leaf height for wind
    let sum=0;
    for(let k=0;k<SVF_N;k++){
      const az=(k+0.5)*360/SVF_N;
      const g=Math.max(0,geomHorizonElev(px,py,pz,az,cell.selfRole,housePt),horizonAt(realAz(az)));
      // an obstruction at elevation g shelters a fraction ~ g/90 of that bearing
      sum+=clamp01(g/90);
    }
    const obstruction=sum/SVF_N;
    const expo=clamp01(1-obstruction);
    cell._expo=+expo.toFixed(3);
    return cell._expo;
  }

  /* ---- §3 SHADOW MASK (ray-cast) — 0|1 for a cell at a date ----
     shadowMask=1 iff the sun is above the terrain horizon at its azimuth AND a
     ray from the cell toward Astro.sun().dir clears every analytic occluder
     box. Fast box-ray tests (no THREE.Raycaster) keep the bake <~1 s. -------- */
  // skipLowWalls: optional override. The SEASONAL sun-hours bake passes true so the
  // precomputed sun-hours stay on the VALIDATED zone_sun_hours.json baseline (a 2 m
  // boundary line standing at the edge of the "open to the desert" backyard must not
  // box it in); the LIVE per-frame heatmap leaves it undefined → walls ARE honoured
  // so their moving shade varies cells within a zone. (SVF/longwave/wind always
  // honour the walls statically, so near-wall cells still read cooler regardless.)
  function shadowMask(cell,date,skipLowWalls){
    const A=(typeof window!=='undefined')&&window.Astro;
    const sun=(A&&A.sun)?A.sun(date||new Date()):null;
    if(!sun||sun.altDeg<=0) return 0;
    if(sun.altDeg<=horizonAt(sun.azDeg)) return 0;       // behind his real ridge (WORLD az — terrain is real)
    const d=toPlanDir(sun.dir);                          // rotate the WORLD sun into the house PLAN frame for the occluder test
    // HOUSE-surface point: its xL/y/zL are already the outward-biased position
    // (surfaceTempAtPoint pushed them ~6 cm along the world normal), so its own
    // face won't self-shadow it, while OTHER house blocks / storage / neighbours /
    // boundary walls still do → real intra-surface sun/shade variation.
    if(cell.isHouse){
      const skipWalls=(cell.y||0)>2.0;  // an upper-storey point is above the low walls
      return blockedForHousePoint(cell.xL,cell.y||0,cell.zL,d.x,d.y,d.z,skipWalls)?0:1;
    }
    // ELEVATED DECK cell (terrace/balcony, y>1): use the same "skip the embedded
    // block" rule so a cell sitting inside the upper-room footprint isn't perma-
    // shaded by the block it rests in, while the upper rooms BESIDE it DO cast a
    // moving shade across the open part of the balcony (the user's exact case).
    // It is above the ~2 m boundary walls, so those are skipped.
    if(cell.selfRole==='deck'){
      return blockedForHousePoint(cell.xL,(cell.y||0)+0.05,cell.zL,d.x,d.y,d.z,true)?0:1;
    }
    const px=cell.xL, py=(cell.y||0)+0.05, pz=cell.zL;
    // HONOUR the low plot-edge garden walls (1.3–2.0 m) as direct-beam occluders:
    // their moving shade is exactly what makes cells differ WITHIN a zone through
    // the day (the user's "part was in shade for a while"). An ELEVATED deck cell
    // (y>1) sits above the low walls, so they can't reach it → skip walls there to
    // avoid a spurious clip; a ground cell (y≤1) honours them. (The validated
    // zone_sun_hours.json baseline is a separate precomputed file and is untouched;
    // including these walls shifts the LIVE/seasonal model toward more physical —
    // and more spatially varied — shading, per the spec.)
    const skipWalls=(skipLowWalls!=null?skipLowWalls:false)||(cell.y||0)>1.0;
    if(blockedByGeometry(px,py,pz,d.x,d.y,d.z,cell.selfRole,skipWalls)) return 0;
    return 1;
  }

  /* ---- §1a INCIDENT SOLAR on a cell (POA, Liu–Jordan isotropic) ----
     direct  = DNI·max(0,n·sunDir)·shadowMask
     diffuse = DHI·SVF
     reflect = GHI·albedo·(1−SVF)
     DNI/DHI split from GHI via a cloud+clearness diffuse fraction. GHI comes
     from live Weather.envAt('rad') when available, else a clear-sky model
     (the seasonal bake uses the latter for arbitrary representative dates). -- */
  function incidentSolar(cell,date,ctx){
    const A=(typeof window!=='undefined')&&window.Astro;
    const W=(typeof window!=='undefined')&&window.Weather;
    const d=date||new Date();
    const sun=(ctx&&ctx.sun)||((A&&A.sun)?A.sun(d):null);
    if(!sun||sun.altDeg<=0) return {direct:0,diffuse:0,reflected:0,total:0};
    const cloud=(ctx&&ctx.cloud!=null)?ctx.cloud
      :((W&&W.cur&&W.cur.cloud!=null)?W.cur.cloud:((W&&W.state&&W.state.cloud!=null)?W.state.cloud:0.1));
    let ghi=(ctx&&ctx.ghi!=null)?ctx.ghi:((W&&W.envAt)?W.envAt('rad',d):null);
    if(ghi==null) ghi=clearSkyGHI(sun.altDeg,cloud);
    ghi=Math.max(0,ghi);
    const sinB=Math.max(0.02,Math.sin(sun.altDeg*Math.PI/180));
    const df=diffuseFraction(sun.altDeg,cloud,ghi);
    const dhi=ghi*df;
    const dni=Math.max(0,(ghi-dhi)/sinB);
    const svf=skyViewFactor(cell);
    // direct beam on the cell face
    const n=cell.normal||{x:0,y:1,z:0};
    const sdP=toPlanDir(sun.dir);                        // sun dir in the house plan frame (cell normals are plan-frame)
    const cosInc=Math.max(0,n.x*sdP.x+n.y*sdP.y+n.z*sdP.z);
    const mask=(ctx&&ctx.mask!=null)?ctx.mask:shadowMask(cell,d);
    const direct=dni*cosInc*mask;
    // Liu–Jordan isotropic-sky tilt view factors (L12/L13): split the hemisphere
    // a tilted face sees into SKY and GROUND by the cell's tilt β (cosβ = the
    // normal's up-component), then attenuate the sky share by the obstruction SVF.
    // Old code used dhi·svf (tilt-blind) and ghi·albedo·(1−svf) (which wrongly read
    // WALL-blocked sky as REFLECTIVE GROUND — ~72 W/m² spurious gain on a shaded
    // courtyard cell). This now matches the already-correct _solveSurfaceTemp Fsky.
    const cosB=clamp(n.y,-1,1);                       // up-component = cos(tilt)
    const Fsky=clamp01(svf*(1+cosB)/2);               // sky view fraction (obstruction × tilt)
    const Fgnd=Math.max(0,(1-cosB)/2);                // ground view fraction (tilt only)
    const diffuse=dhi*Fsky;
    const reflected=ghi*ALBEDO_GROUND*Fgnd;
    const total=direct+diffuse+reflected;
    return { direct:+direct.toFixed(1), diffuse:+diffuse.toFixed(1),
             reflected:+reflected.toFixed(1), total:+total.toFixed(1) };
  }

  /* ====================================================================
     §1 SURFACE TEMPERATURE — closed-form steady-state energy balance.
     [SIGNATURE KEPT] surfaceTemp(normalWorld, date, opts) → °C.
     All four fluxes linearised in T_surf and solved closed-form:
       T_surf = (α·S + h_c·T_air + h_rs·T_sky + h_rg·T_gnd + h_cd·T_deep)
                / (h_c + h_rs + h_rg + h_cd)
     · S        net absorbed shortwave (POA; §1a)
     · h_c      McAdams convection 5.7+3.8·V_eff (§1c)
     · h_rs/h_rg linearised long-wave to sky / ground with SVF tilt view
                 factors (§1b); T_sky via Brunt clear-sky emissivity
     · h_cd     conduction to a deep reservoir (soil for ground, interior for
                 walls) (§1d)
     A one-pole diurnal lag (§1d) is applied as a small correction so masonry
     peaks/dips trail the instantaneous equilibrium. estimate — see fidelity.

     Back-compatible inputs: accepts a world normal {x,y,z}/Vector3 + opts
     {airC,rad,windKmh,cloud,material,sun,clampMin,clampMax}. NEW optional
     opts: {cell, svf, exposure, rh, soilT} let the cell path pass richer
     context; when absent we fall back to live Weather/Astro exactly as before.
     ==================================================================== */
  function _solveSurfaceTemp(p){
    // p: {nx,ny,nz, sun, airC, rh, cloud, windKmh, abs, ghi, svf, exposure,
    //     soilT, isWall, lit, cosInc}
    const TairK=p.airC+C2K;
    // ---- shortwave (POA) ----
    const sinB=Math.max(0.02,p.sun?Math.sin(p.sun.altDeg*Math.PI/180):0.02);
    let S=0;
    if(p.sun&&p.sun.altDeg>0){
      const df=diffuseFraction(p.sun.altDeg,p.cloud,p.ghi);
      const dhi=p.ghi*df, dni=Math.max(0,(p.ghi-dhi)/sinB);
      const direct=p.lit?dni*Math.max(0,p.cosInc):0;
      const diffuse=dhi*p.svf;
      const reflected=p.ghi*ALBEDO_GROUND*(1-p.svf);
      S=direct+diffuse+reflected;
    }
    const qSolar=p.abs*S;                         // absorbed shortwave W/m²
    // ---- convection (McAdams) ----
    const Veff=Math.max(0,p.windKmh/3.6)*(0.3+0.7*clamp01(p.exposure));  // km/h→m/s, exposure-scaled
    const hC=5.7+3.8*Veff;                        // W/m²K
    // ---- long-wave: linearise εσ(Ts⁴−Tx⁴) ≈ hr·(Ts−Tx), hr=4εσ·Tm³ ----
    // EnergyPlus tilt view factors: φ from the normal's up-component.
    const cosPhi=clamp(p.ny,-1,1);
    const Fsky=p.svf*(1+cosPhi)/2;                // fraction of hemisphere = sky
    const Fgnd=Math.max(0,1-Fsky);
    const TskyK=skyTempK(p.airC,p.rh,p.cloud);
    const TgndK=(p.soilT!=null?p.soilT:p.airC)+C2K;   // ground brightness ≈ soil/air
    // linearise about T_air (good for ±tens of K skin departures)
    const hRbase=4*EPS_SURF*SIGMA*Math.pow(TairK,3);
    const hRs=hRbase*Fsky*Math.pow(TskyK/TairK,0);    // keep coefficient at T_air ref
    const hRg=hRbase*Fgnd;
    // ---- conduction to deep reservoir ----
    // A thin transpiring LEAF is essentially decoupled from the deep soil reservoir
    // (its tiny heat capacity radiates/convects to air, it doesn't conduct to the
    // ground beneath it). Coupling it to warm deep soil with the ground hCond held
    // its modeled night skin ~several °C too warm. So: near-zero conduction for
    // 'leaf'; keep the firm ground coupling for gravel/paving/soil ground and the
    // softer wall coupling for walls. (M4)
    const isLeaf=(p.material==='leaf');
    const Tdeep=isLeaf
      ? p.airC                                    // leaf "reservoir" ≈ ambient air, not deep soil
      : (p.soilT!=null?p.soilT:(p.isWall?24:p.airC));   // °C
    const hCond=isLeaf?0.3:(p.isWall?2.5:6.0);    // W/m²K: leaf≈decoupled, walls insulated-ish, ground couples harder
    // ---- closed-form solve (all linear in Ts) ----
    // qSolar + hC(Tair−Ts) + hRs(Tsky−Ts) + hRg(Tgnd−Ts) + hCond(Tdeep−Ts) = 0
    const num=qSolar
      + hC*p.airC
      + hRs*(TskyK-C2K)
      + hRg*(TgndK-C2K)
      + hCond*Tdeep;
    const den=hC+hRs+hRg+hCond;
    return num/den;                                // °C
  }

  // estimate GHI at `date` (live envAt → clear-sky fallback) for the solver.
  function _ghiFor(date,sun,cloud){
    const W=(typeof window!=='undefined')&&window.Weather;
    let ghi=(W&&W.envAt)?W.envAt('rad',date):null;
    if(ghi==null) ghi=clearSkyGHI(sun?sun.altDeg:0,cloud);
    return Math.max(0,ghi);
  }

  /* ====================================================================
     §1e INDOOR AIR TEMPERATURE — damped, lagged response through mass.
     [NEW] Derive.indoorTemp(date) → {tempC, estimate, note_he}.

     His house is heavy desert masonry, largely UN-airconditioned. Indoor air
     is therefore a LOW-PASS (exponential-moving-average) of the recent OUTDOOR
     air temperature through the thermal mass of the walls/slabs: much smaller
     diurnal swing than outside, peaking HOURS later, centred near the daily
     mean. A clear desert day of 12→38 °C outside ⇒ inside maybe ~24→29 °C,
     trailing the outdoor peak by several hours. Plus a modest solar-gain bump
     on sunny days (the mass soaks up the day's radiation and re-radiates it
     inward). This is also a standalone derived fact: "inside your house now,
     without AC, ~X °C".

     DATA: weather.js exposes the live "now" outdoor temp (Weather.state.temp)
     and 31 days of HOURLY soil-temp + shortwave-radiation history (envAt), but
     NOT hourly air-temp history. So we reconstruct the recent OUTDOOR hourly
     air curve from the seasonal diurnal SHAPE (airTempAt: min ~05:30, max
     ~15:00) RE-ANCHORED to the live reading at the current hour, then EMA it.
     The measured hourly soil-temp (itself a damped-lagged signal of the same
     forcing) is blended in lightly as a real-data anchor when available, and
     recent radiation drives the solar-gain bump. Honest ESTIMATE (estimate:true).
     ==================================================================== */
  const INDOOR_TAU_H=10;        // EMA time constant (h): heavy masonry ~8–12 h
  const INDOOR_WINDOW_H=30;     // hours of recent history to integrate
  // climate season for a date (month-based), reused for the diurnal shape.
  function _seasonOf(date){
    const mo=(date||new Date()).getMonth();
    if(mo<=1||mo===11) return 'winter';
    if(mo<=4) return 'spring';
    if(mo<=8) return 'summer';
    return 'autumn';
  }
  // local wall-clock fractional hour for `date` (Weather tz if known).
  function _localHour(date){
    const W=(typeof window!=='undefined')&&window.Weather;
    const tz=(W&&W.env&&W.env.tz)||(W&&W.forecast&&W.forecast.tz)||undefined;
    try{
      const f=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false});
      const p={}; f.formatToParts(date).forEach(o=>{p[o.type]=o.value;});
      let hh=+p.hour; if(hh===24) hh=0;
      return hh+(+p.minute||0)/60;
    }catch(e){ return date.getHours()+date.getMinutes()/60; }
  }
  // MEAN-PRESERVING reconstruction of the OUTDOOR air temp (°C) at an arbitrary
  // time: the season's diurnal SHAPE (correct phase: dawn-min, mid-afternoon-max),
  // recentred so its DAILY MEAN equals an estimated current outdoor daily mean.
  // We back the daily mean OUT of the single live "now" reading using the known
  // shape: meanEst = liveTemp − (shape(now) − climMean). This keeps the live
  // magnitude WITHOUT lifting the whole curve when "now" happens to be the peak
  // (the earlier bug: anchoring the curve THROUGH the instantaneous reading moved
  // the mean and inflated the damped indoor temp at midday).
  function _diurnalMean(clim){ return (clim.Thigh+clim.Tlow)/2; }
  function _outdoorMeanEst(clim,liveTemp,anchorHour){
    const climMean=_diurnalMean(clim);
    if(liveTemp==null) return climMean;
    return liveTemp-(airTempAt(clim,anchorHour)-climMean);
  }
  function _outdoorAirAt(date,clim,meanEst){
    const climMean=_diurnalMean(clim);
    return meanEst+(airTempAt(clim,_localHour(date))-climMean);   // mean-preserving
  }
  // two Date instants on the same LOCAL civil day (site tz when Weather knows it)?
  function _sameCivilDay(a,b){
    const W=(typeof window!=='undefined')&&window.Weather;
    const tz=(W&&W.env&&W.env.tz)||(W&&W.forecast&&W.forecast.tz)||undefined;
    try{
      const f=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'});
      return f.format(a)===f.format(b);
    }catch(e){
      return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
    }
  }
  // MEASURED daily-mean proxy for `date`: average the measured 0 cm soil temp
  // (envAt('soilT')) across that civil day — a real-data anchor that tracks the
  // same forcing as outdoor air. Returns null when no measured soil covers `date`
  // (e.g. a far-future/older scrub) → caller falls back to climatology. Never throws.
  function _measuredDayMean(W,date){
    if(!W||!W.envAt) return null;
    try{
      let sum=0,cnt=0;
      const base=new Date(date.getTime());
      for(let h=0;h<24;h+=3){
        const t=new Date(base.getFullYear(),base.getMonth(),base.getDate(),h,0,0,0);
        const s=W.envAt('soilT',t);
        if(s!=null&&isFinite(s)){ sum+=s; cnt++; }
      }
      return cnt?sum/cnt:null;
    }catch(e){ return null; }
  }
  // INDOOR air temperature (°C) at `date` — the damped/lagged EMA described above.
  function indoorTemp(date){
    const W=(typeof window!=='undefined')&&window.Weather;
    const d=date||new Date();
    const season=_seasonOf(d);
    const clim=SEASON_CLIM[season];
    // ---- daily-MEAN anchor for the scrubbed/now date -----------------------
    // On the SAME civil day as "now", back the outdoor daily mean OUT of the
    // single live reading (correct "now" behaviour). When `d` is a DIFFERENT
    // day (time-scrubbed past/future), the live reading no longer describes that
    // day — so prefer a MEASURED proxy for that day's magnitude (the day-mean of
    // the measured 0 cm soil temp, which tracks the same forcing) and otherwise
    // fall back to the season's climatological mean. This makes scrubbing across
    // days shift the magnitude with the scrubbed date instead of re-using today's.
    const nowD=new Date();
    const liveTemp=(W&&W.state&&W.state.temp!=null)?W.state.temp:null;
    let meanEst;
    if(_sameCivilDay(d,nowD) && liveTemp!=null){
      const anchorHour=_localHour(nowD);
      meanEst=_outdoorMeanEst(clim,liveTemp,anchorHour);   // live "now" anchor
    } else {
      const soilMean=_measuredDayMean(W,d);                // measured proxy for `d`
      meanEst=(soilMean!=null)? soilMean : _diurnalMean(clim);
    }
    // EMA of the reconstructed outdoor hourly series over the last INDOOR_WINDOW_H
    // hours up to `d`. Exponential weights with time-constant τ (most recent hours
    // dominate) → a damped, lagged low-pass that settles near the daily mean with a
    // small phase-lagged residual. Walk OLD→NEW so weighting is causal.
    const dtH=1, N=INDOOR_WINDOW_H;
    let ema=null, emaSoil=null;
    const alpha=1-Math.exp(-dtH/INDOOR_TAU_H);     // per-step EMA gain
    for(let k=N;k>=0;k--){
      const t=new Date(d.getTime()-k*3600000);
      const out=_outdoorAirAt(t,clim,meanEst);
      ema=(ema==null)?out:ema+alpha*(out-ema);
      // run a PARALLEL EMA of the measured 0 cm soil temp (real-data anchor). Using
      // its SLOW (EMA'd) component avoids injecting soil's own diurnal swing.
      if(W&&W.envAt){ const s=W.envAt('soilT',t);
        if(s!=null&&isFinite(s)) emaSoil=(emaSoil==null)?s:emaSoil+alpha*(s-emaSoil); }
    }
    let indoor=ema;
    // ---- light real-data anchor: nudge 15 % toward the slow soil signal when
    // present. Soil 0 cm runs warmer than indoor air by day, so we damp its excess:
    // anchor toward soil only by a small weight to keep the EMA-of-air the backbone.
    if(emaSoil!=null && isFinite(emaSoil)) indoor=0.85*indoor+0.15*emaSoil;
    // ---- modest SOLAR-GAIN bump on sunny days: the mass soaks the day's radiation.
    // Mean recent shortwave (W/m²) over the window as a sunniness proxy; small + capped.
    let radSum=0, radN=0;
    if(W&&W.envAt){
      for(let k=0;k<=N;k+=3){
        const r=W.envAt('rad',new Date(d.getTime()-k*3600000));
        if(r!=null && isFinite(r)){ radSum+=r; radN++; }
      }
    }
    const meanRad=radN?radSum/radN:null;          // ~150–300 W/m² day-mean on clear days
    const solarBump=meanRad!=null?clamp(meanRad/300*1.5,0,1.5):0.5;
    indoor+=solarBump;
    indoor=Math.round(indoor*10)/10;
    const lagH=INDOOR_TAU_H;   // indicative phase lag ≈ τ
    const note_he=`about ${indoor}°C inside the house (no A/C) — a masked, delayed response of the heavy thermal mass to the outdoor temperature, lagging ~${Math.round(lagH)} h with a much smaller amplitude. model · estimate`;
    return { tempC:indoor, estimate:true, note_he, lagH };
  }

  function surfaceTemp(normalWorld,date,opts){
    const o=opts||{};
    const W=(typeof window!=='undefined')&&window.Weather;
    const A=(typeof window!=='undefined')&&window.Astro;
    const d=date||new Date();
    // --- normal (accept {x,y,z} or THREE.Vector3); normalise for the dot ---
    let nx=normalWorld&&(normalWorld.x), ny=normalWorld&&(normalWorld.y), nz=normalWorld&&(normalWorld.z);
    if(nx==null||ny==null||nz==null) return null;
    const nlen=Math.hypot(nx,ny,nz)||1; nx/=nlen; ny/=nlen; nz/=nlen;
    // --- sun ---
    const sun=o.sun||(A&&A.sun?A.sun(d):null);

    /* ---- §1f INTERIOR FACE PATH (NO direct sun, NO sky longwave, NO outdoor
       wind) — for a surface that looks IN to an enclosed room. The skin sits at
       the INDOOR AIR temperature plus a small CONDUCTION nudge:
         · pure interior partition / interior floor (both sides indoor): ≈ indoor
           air, uniform — heavy mass + stable indoor convection wash out gradients.
         · INNER face of an EXTERIOR wall: heat conducts in from a sun-baked OUTER
           face, so nudge toward that wall's exterior-face temperature by a small
           lagged factor k (most of the gradient is dropped ACROSS the wall, so k
           is small). The caller (building.js) computes the exterior-face temp by
           flipping the normal and passes it as opts.extFaceTempC.
       This is what fixes "interior and exterior walls got the same temperature":
       interior surfaces decouple from the sun entirely and cluster near indoor.
       NOT YET MODELLED: solar gain through windows (a sunbeam landing on an
       interior floor) — interior stays sun-INDEPENDENT for now (stated limit). */
    if(o.interior || o.indoor){
      const indoor=(o.indoorTempC!=null)?o.indoorTempC:indoorTemp(d).tempC;
      let T=indoor;
      if(o.extFaceTempC!=null && isFinite(o.extFaceTempC)){
        // conduction nudge from the baking outer face. k≈0.12–0.18 — across a
        // ~0.20 m masonry wall most of the ΔT is dropped in the wall, so the inner
        // face only leans a fraction of the way toward the outer-face temp.
        const k=(o.condK!=null)?clamp(o.condK,0,0.5):0.15;
        T=indoor+k*(o.extFaceTempC-indoor);
      }
      const loI=(o.clampMin!=null)?o.clampMin:-15;
      const hiI=(o.clampMax!=null)?o.clampMax:80;
      return Math.max(loI,Math.min(hiI,Math.round(T*10)/10));
    }

    // --- air temp °C ---
    const airC=(o.airC!=null)?o.airC:((W&&W.state&&W.state.temp!=null)?W.state.temp:18);
    // --- RH % (for Brunt sky temp) ---
    const rh=(o.rh!=null)?o.rh:((W&&W.state&&W.state.hum!=null)?W.state.hum:40);
    // --- cloud 0..1 ---
    const cloud=(o.cloud!=null)?o.cloud:((W&&W.cur&&W.cur.cloud!=null)?W.cur.cloud:((W&&W.state&&W.state.cloud!=null)?W.state.cloud:0.1));
    // --- wind km/h ---
    const windKmh=(o.windKmh!=null)?o.windKmh
      :((W&&W.state&&W.state.wind!=null)?W.state.wind
      :((W&&W.cur&&W.cur.wind!=null)?Math.max(0,(W.cur.wind-0.1)*40):8));
    // --- absorptivity ---
    const abs=(o.absorptivity!=null)?o.absorptivity
      :(ABSORPTIVITY[o.material]!=null?ABSORPTIVITY[o.material]:ABSORPTIVITY.default);
    // --- SVF + exposure: from a passed cell, explicit opts, or a tilt heuristic ---
    let svf, exposure;
    if(o.cell){ svf=skyViewFactor(o.cell); exposure=windExposure(o.cell); }
    if(o.svf!=null) svf=o.svf;
    if(o.exposure!=null) exposure=o.exposure;
    if(svf==null){
      // no spatial context (e.g. a house-mesh vertex from building.js): derive a
      // tilt-only SVF from the normal's up-component — a flat-up face sees ~all
      // sky, a vertical wall ~half. This keeps the per-vertex heatmap working
      // without the yard grid, matching the spec's "cap walls ~0.5 by tilt".
      svf=clamp01(0.5+0.5*ny);
    }
    if(exposure==null) exposure=clamp01(0.5+0.5*Math.max(0,ny)); // up-faces windier
    // --- soil/deep reservoir temp °C ---
    const soilT=(o.soilT!=null)?o.soilT:((W&&W.envAt)?W.envAt('soilT',d):null);
    const isWall=(ny<0.5);                         // mostly-vertical → "wall" conduction
    // --- direct-beam gating (terrain ridge + self-shadow; cell mask if given) ---
    let lit=false, cosInc=0;
    if(sun&&sun.altDeg>0&&sun.altDeg>horizonAt(sun.azDeg)){
      cosInc=Math.max(0,nx*sun.dir.x+ny*sun.dir.y+nz*sun.dir.z);
      if(cosInc>0){
        // if a cell is provided, honour its ray-cast occlusion; otherwise treat
        // a non-self-shadowed face as lit (house-mesh path, as before).
        const mask=(o.mask!=null)?o.mask:(o.cell?shadowMask(o.cell,d):1);
        lit=mask>0;
      }
    }
    const ghi=(o.rad!=null)?Math.max(0,o.rad):_ghiFor(d,sun,cloud);
    // ---- equilibrium skin temperature ----
    let T=_solveSurfaceTemp({ nx,ny,nz, sun, airC, rh, cloud, windKmh, abs,
      ghi, svf, exposure, soilT, isWall, lit, cosInc, material:o.material });
    // ---- §1d one-pole diurnal lag (approximate thermal mass) ----
    // T_filt = T_eq − τ·dT_eq/dt, τ≈1.5–2.5 h masonry. Evaluate dT_eq/dt with a
    // short central difference on the equilibrium (cheap; two extra solves).
    if(o.lag!==false && sun){
      const tau=o.tau!=null?o.tau:(isWall?2.2:1.6);  // hours
      const dtH=0.5;                                  // ±30 min finite difference
      const ev=(dd)=>{
        const s2=(A&&A.sun)?A.sun(dd):sun;
        let lit2=false,ci2=0;
        if(s2&&s2.altDeg>0&&s2.altDeg>horizonAt(s2.azDeg)){
          ci2=Math.max(0,nx*s2.dir.x+ny*s2.dir.y+nz*s2.dir.z);
          if(ci2>0){ const m2=o.cell?shadowMask(o.cell,dd):1; lit2=m2>0; }
        }
        const g2=_ghiFor(dd,s2,cloud);
        const st2=(o.soilT!=null)?o.soilT:((W&&W.envAt)?W.envAt('soilT',dd):soilT);
        return _solveSurfaceTemp({ nx,ny,nz, sun:s2, airC, rh, cloud, windKmh, abs,
          ghi:g2, svf, exposure, soilT:st2, isWall, lit:lit2, cosInc:ci2, material:o.material });
      };
      const tBack=ev(new Date(d.getTime()-dtH*3600000));
      const tFwd =ev(new Date(d.getTime()+dtH*3600000));
      const dTdt=(tFwd-tBack)/(2*dtH);                // °C per hour
      // BOUND the lag correction. The one-pole filter models thermal mass trailing
      // the equilibrium by a few °C; but a BINARY shadow EDGE crossing the ±30 min
      // finite-difference window makes dT_eq/dt explode (a cell going sun→shade in
      // that window) and would paint a single spurious cold/hot pixel at every
      // shade boundary. Clamp the offset so the heatmap stays smooth + physical at
      // shadow edges (well-behaved cases have small dTdt and are unaffected).
      const lagOff=clamp(tau*dTdt,-8,8);
      T=T-lagOff;
    }
    const lo=(o.clampMin!=null)?o.clampMin:-15;
    const hi=(o.clampMax!=null)?o.clampMax:80;
    return Math.max(lo,Math.min(hi,Math.round(T*10)/10));
  }

  /* ---- PER-POINT HOUSE-SURFACE CELL + TEMPERATURE -------------------------
     building.js needs each VERTEX of a wall/roof/deck to feel ITS OWN local
     sky-view + sun/shade, so a flat wall is no longer one uniform colour. The
     STATIC, geometry-only part (the outward-biased sky-view + wind exposure)
     is the expensive bit and is the SAME every frame — so we expose a cell
     builder the caller memoises ONCE per mesh (array on geo.userData), then a
     cheap per-frame surfaceTempAtPoint() that only re-runs the sun-dependent
     shadow + energy balance.
       · BIAS: a vertex sits ON the surface; we push the ray origin ~6 cm
         OUTWARD along the world normal so the face it sits on can't shadow its
         own sun (standard shadow bias), while other house blocks / storage /
         neighbours / boundary walls still do.
       · isHouse:true routes SVF / exposure / shadowMask through the house-point
         occlusion (skip the block the point is on, keep the rest).
     ------------------------------------------------------------------------ */
  const HOUSE_BIAS=0.06;   // m outward along the normal (shadow bias)
  function makeHouseCell(xL,yL,zL, worldNormal){
    let nx=worldNormal&&worldNormal.x, ny=worldNormal&&worldNormal.y, nz=worldNormal&&worldNormal.z;
    if(nx==null||ny==null||nz==null){ nx=0; ny=1; nz=0; }
    const nlen=Math.hypot(nx,ny,nz)||1; nx/=nlen; ny/=nlen; nz/=nlen;
    return {
      // outward-biased position used for the sky scan + shadow ray origin
      xL:+(xL+nx*HOUSE_BIAS).toFixed(3),
      y:+(yL+ny*HOUSE_BIAS).toFixed(3),
      zL:+(zL+nz*HOUSE_BIAS).toFixed(3),
      normal:{x:nx,y:ny,z:nz}, isHouse:true, zoneId:'house',
      _svf:null, _expo:null
    };
  }
  // Per-point house surface temperature. Pass a memoised cell via opts.cell to
  // reuse its cached SVF/exposure across frames; otherwise one is built (and its
  // SVF computed) on the spot. Defaults to lag:false — the house per-vertex path
  // does ONE shadow eval per vertex, not the 3 the diurnal-lag central-difference
  // would cost (the dominant per-vertex expense). Returns °C (surfaceTemp signature
  // is untouched and still works on its own).
  function surfaceTempAtPoint(xL,yL,zL, worldNormal, date, opts){
    const o=opts||{};
    const cell=o.cell||makeHouseCell(xL,yL,zL,worldNormal);
    const n=cell.normal||worldNormal||{x:0,y:1,z:0};
    return surfaceTemp(n, date, Object.assign({}, o, {
      cell, lag:(o.lag!=null?o.lag:false)
    }));
  }

  /* ====================================================================
     §2 PER-CELL SEASONAL MICROCLIMATE PROFILE.
     Day-march a representative day (15th of Jan/Apr/Jul/Oct) at 10-min steps
     accumulating sun-hours, DLI, peak/dawn surface temp, ETc, air-Δ. The four
     seasonal tables are precomputed + cached per cell on first use.
     PPFD ≈ 2.02 μmol·m⁻²·s⁻¹ per W/m² of incident solar; DLI = Σ PPFD·Δt /1e6.
     ==================================================================== */
  const SEASONS={ winter:0, spring:3, summer:6, autumn:9 };  // month index of the 15th
  const SEASON_YEAR=2026;
  const PPFD_PER_WM2=2.02;                 // μmol·m⁻²·s⁻¹ per W/m² (broadband→PAR)
  // representative daily climate per season (Larkmont ~300 m rim): mean
  // air temp, diurnal range, clear-night low (for frost), RH, soil temp, wind.
  // Values are climatological anchors for the bake (live "now" path uses real
  // Weather). Sources: weatherspark MR year-round + Wikipedia (night frost,
  // ~70 mm rain, windy rim). Flagged estimate downstream.
  const SEASON_CLIM={
    winter:{ Tmean:9,  Trange:11, Tlow:1,  Thigh:14, rh:55, soil:9,  wind:14, cloud:0.30 },
    spring:{ Tmean:18, Trange:13, Tlow:9,  Thigh:25, rh:40, soil:18, wind:16, cloud:0.20 },
    summer:{ Tmean:25, Trange:14, Tlow:17, Thigh:33, rh:32, soil:27, wind:15, cloud:0.08 },
    autumn:{ Tmean:18, Trange:12, Tlow:10, Thigh:25, rh:42, soil:19, wind:13, cloud:0.15 }
  };
  // diurnal air temp (°C) at fractional hour h (0..24) from a min-at-dawn,
  // max-mid-afternoon profile anchored to the season's low/high.
  // ASYMMETRIC (M4-companion / M2 fix): a single cosine peaked at 15:00 troughs
  // 12 h away at 03:00, ~2.5 h too early for the clear-desert dawn minimum. Real
  // sites cool slowly through the long night and warm quickly after sunrise, so
  // we use a PIECEWISE half-cosine: a slow cooling arm from the 15:00 max down to
  // the ~05:30 min, then a faster warming arm from the min back up to the max.
  // Each arm is a half-cosine over its own (unequal) span, so the curve is C0/C1
  // continuous at both turning points and exactly hits Tlow at 05:30 / Thigh at 15.
  const _T_MIN_H=5.5, _T_MAX_H=15.0;            // dawn minimum / afternoon maximum (local h)
  function airTempAt(clim,hour){
    const lo=clim.Tlow, hi=clim.Thigh;
    let h=((hour%24)+24)%24;
    // WARMING arm: min(05:30) → max(15:00), span 9.5 h.
    // COOLING arm: max(15:00) → next min(05:30), span 14.5 h (wraps midnight).
    if(h>=_T_MIN_H && h<=_T_MAX_H){
      const f=(h-_T_MIN_H)/(_T_MAX_H-_T_MIN_H);          // 0 at min → 1 at max
      return lo+(hi-lo)*(1-Math.cos(Math.PI*f))/2;       // rises lo→hi
    }
    // cooling arm (handle the pre-dawn wrap by mapping h<05:30 onto +24)
    const hh=(h<_T_MIN_H)?h+24:h;
    const span=(_T_MIN_H+24)-_T_MAX_H;                   // 14.5 h
    const f=(hh-_T_MAX_H)/span;                          // 0 at max → 1 at next min
    return hi-(hi-lo)*(1-Math.cos(Math.PI*f))/2;         // falls hi→lo
  }
  // ---- site lifecycle climate: winter CHILL HOURS (0–7.2 °C model) + growing-season
  //      GDD (base 10 °C), both from the diurnal curve over the season anchors. Rough
  //      climatological estimate for the rim (~300 m) — perennials at his spot compared
  //      against their chill_hours_req / gdd_to_fruit. Cached. ----
  let _siteHC=null;
  function siteHeatChill(){
    if(_siteHC) return _siteHC;
    const DAYS=91.3;                                  // ≈ days per season
    let chill=0, gddGrow=0;
    for(const s in SEASON_CLIM){
      const clim=SEASON_CLIM[s];
      let below=0;
      for(let i=0;i<96;i++){ const t=airTempAt(clim, i*0.25+0.125); if(t>=0 && t<=7.2) below++; }
      chill += (below/96*24)*DAYS;                    // chill-hours in band, per season
      const g=Math.max(0, Math.min(30,(clim.Thigh+clim.Tlow)/2) - 10);   // GDD/day, base 10 / cap 30 (matches recordDay + explain_content) (L6)
      if(s!=='winter') gddGrow += g*DAYS;             // growing season = spring+summer+autumn
    }
    _siteHC={ chillHours:Math.round(chill/10)*10, gddGrowing:Math.round(gddGrow/10)*10, estimate:true };
    return _siteHC;
  }
  // build (or fetch cached) the seasonal profile for a cell+season.
  function _bakeSeason(cell,season){
    const A=(typeof window!=='undefined')&&window.Astro;
    const mo=SEASONS[season]; if(mo==null) return null;
    const clim=SEASON_CLIM[season];
    const day=new Date(SEASON_YEAR,mo,15,0,0,0,0);
    const svf=skyViewFactor(cell), expo=windExposure(cell);
    const STEP=10;                                   // minutes
    const dtH=STEP/60;
    let sunMin=0, dliSum=0, Tpeak=-99, Tdawn=99, etcRef=0, ghiOpenSum=0, ghiCellSum=0;
    let leafPeak=-99, airPeak=-99, airDawn=99;
    // daytime air-Δ for this cell vs the open season air (sheltered corners run a
    // touch warmer; this is the leaf-canopy air the plant actually feels).
    const dayAirDelta=(1-expo)*1.0;
    for(let m=0;m<1440;m+=STEP){
      const dd=new Date(day.getTime()+m*60000);
      const hour=m/60;
      const sun=(A&&A.sun)?A.sun(dd):null;
      const airOpen=airTempAt(clim,hour);
      const airC=airOpen+(sun&&sun.altDeg>0?dayAirDelta:0);  // local canopy air
      const cloud=clim.cloud;
      if(airC>airPeak) airPeak=airC;
      if(hour>=2 && hour<=7 && airC<airDawn) airDawn=airC;
      // shadow + incident
      // PRECOMPUTED sun-hours stay on the validated baseline → skip the low
      // boundary walls here (the open east backyard must not be boxed in). The
      // house block + storage + neighbours + (for the balcony) the upper rooms are
      // still honoured, so the seasonal numbers shift toward more physical without
      // collapsing the open backyard. The LIVE heatmap path (no skip) shows the
      // wall-driven moving shade.
      const mask=(sun&&sun.altDeg>0&&sun.altDeg>horizonAt(sun.azDeg))?shadowMask(cell,dd,true):0;
      const ghiOpen=clearSkyGHI(sun?sun.altDeg:0,cloud);
      const inc=incidentSolar(cell,dd,{sun,cloud,ghi:ghiOpen,mask});
      if(mask>0 && sun && sun.altDeg>0) sunMin+=STEP;
      // DLI from total incident on the (horizontal) cell
      dliSum+=PPFD_PER_WM2*inc.total*dtH*3600;        // μmol·m⁻² over the step
      ghiOpenSum+=ghiOpen*dtH; ghiCellSum+=inc.total*dtH;
      // surface temp (no extra lag pass here — the day-march already resolves
      // the diurnal curve; lag would double-count, so request lag:false).
      // Tpeak/Tdawn use a GRAVEL/soil surface (the hot ground reading); a LEAF
      // surface (transpiring, high SVF) tracks much closer to air and is the
      // canopy-relevant temperature used for the plant heat ceiling.
      const T=surfaceTemp(cell.normal,dd,{ airC, rh:clim.rh, cloud,
        windKmh:clim.wind, material:'gravel', sun, cell, mask, svf, exposure:expo,
        soilT:clim.soil, lag:false });
      if(T!=null){ if(T>Tpeak)Tpeak=T; }
      const Tleaf=surfaceTemp(cell.normal,dd,{ airC, rh:clim.rh, cloud,
        windKmh:clim.wind, material:'leaf', sun, cell, mask, svf, exposure:expo,
        soilT:clim.soil, lag:false });
      if(Tleaf!=null && Tleaf>leafPeak) leafPeak=Tleaf;
      // dawn min: track the surface temp through the pre-dawn hours (02:00–07:00)
      if(hour>=2 && hour<=7 && T!=null && T<Tdawn) Tdawn=T;
    }
    const sunHours=+(sunMin/60).toFixed(2);
    const DLI=+(dliSum/1e6).toFixed(2);               // mol·m⁻²·d⁻¹
    // air-Δ vs open town for this cell (season mean), from the flux offset on a
    // representative midday + the radiative-cooling night signature.
    const dAir=_seasonAirDelta(cell,clim,svf,expo);
    // ETc reference: scale season ET0 by the cell's solar capture vs open sky.
    const solFrac=ghiOpenSum>0?clamp01(ghiCellSum/ghiOpenSum):0.5;
    const et0=_seasonET0(season);                     // mm/day open-field reference
    const etcCell=+(et0*clamp(0.3+0.7*solFrac,0.2,1.1)).toFixed(2);
    // ---- FROST-SCREEN dawn temperature (what frost-tender tissue actually sees
    // on a REPRESENTATIVE FROST NIGHT — clear + calm, NOT the seasonal-mean night,
    // which is windier and never frosts). Larkmont gets near-annual radiative
    // frost: on the worst clear calm winter night the open low ground reaches a
    // colder extreme than the mean winter low. We screen the season against THAT
    // night so siting reflects the binding constraint. Combines TWO physics:
    // (1) COLD-AIR DRAINAGE — cold dense air sinks on calm clear nights; an
    //     ELEVATED cell (terrace y>1) sits ABOVE the pooling layer and stays a
    //     few °C warmer, while a LOW cell collects the cold pool — exactly why the
    //     curated data sites frost-tender avocado UP on the balcony.
    // (2) RADIATIVE surface dip on a high-SVF leaf. Only meaningful in winter. -- */
    const elevated=(cell.y||0)>1.0;
    let frostTdawn=99, frost=false;
    if(season==='winter'){
      const frostNightLow = clim.Tlow-3;             // clear-calm radiative extreme (~ -2 °C)
      const drainage = elevated ? +3.2 : -1.8*svf;   // elevated warmer; low pools cold (SVF-weighted)
      const radDip   = -2.4*svf;                     // high-SVF leaf radiates further below air
      frostTdawn = frostNightLow + drainage + radDip;
      frost = frostTdawn<=0;
    }
    return {
      season, sunHours, DLI, Tpeak:+Tpeak.toFixed(1), Tdawn:+Tdawn.toFixed(1),
      // canopy-relevant temps for the plant scoring: peak local air, leaf-surface
      // peak (transpiring, tracks air), pre-dawn air, and the drainage+radiation
      // frost screen the tender tissue actually experiences.
      airPeak:+airPeak.toFixed(1), airDawn:+airDawn.toFixed(1), leafTpeak:+leafPeak.toFixed(1),
      frostTdawn:+frostTdawn.toFixed(1),
      dAir:+dAir.toFixed(1), frost, ETc:etcCell, exposure:expo, svf,
      solFrac:+solFrac.toFixed(2), estimate:true };
  }
  // open-field daily ET0 (mm/day) per season — climatological MR anchors
  // (high in dry windy summer, low in winter). Live path uses Weather ET0.
  function _seasonET0(season){
    return ({ winter:1.6, spring:4.2, summer:6.5, autumn:3.6 })[season]||4;
  }
  // season-mean air-Δ (°C) of a cell vs the open-town reading, derived from the
  // cell's exposure + SVF (cold-air drainage / radiative cooling are
  // parameterized, not simulated → indicative; flagged estimate upstream).
  function _seasonAirDelta(cell,clim,svf,expo){
    // elevated, open cells (balcony) sit a touch warmer at night (cold air
    // drains to lower ground) and run closer to town by day; sheltered
    // low/walled cells trap a little daytime warmth but also pool night cold.
    const elevated=(cell.y||0)>1.0;
    let night = elevated ? +0.8 : -0.6*svf;          // drainage vs pooling
    let day   = (1-expo)*0.8;                         // sheltered → slightly warm
    return 0.5*day+0.5*night;
  }
  function cellProfile(cell,season){
    if(!cell) return null;
    season=season||'summer';
    if(!cell._seasonal) cell._seasonal={};
    if(!cell._seasonal[season]) cell._seasonal[season]=_bakeSeason(cell,season);
    return cell._seasonal[season];
  }

  /* ---- §2 AIR-Δ vs town for a cell at an instant (flux-derived) ----
     Replaces the hand-constant houseTempDelta internals. Returns a signed °C
     offset for the cell vs the open-town reading from (a) the elevation lapse
     (~0 here, both on the rim), (b) a flux-derived day/night micro term using
     the cell's exposure + SVF + current sun state. estimate. ---------------- */
  const TOWN_ELEV_M=300, LAPSE_C_PER_M=0.0065;
  function airDelta(cell,date,ctx){
    const A=(typeof window!=='undefined')&&window.Astro;
    const W=(typeof window!=='undefined')&&window.Weather;
    const d=date||new Date();
    const sun=(ctx&&ctx.sun)||((A&&A.sun)?A.sun(d):null);
    const cloud=(ctx&&ctx.cloud!=null)?ctx.cloud:((W&&W.state&&W.state.cloud!=null)?W.state.cloud:0.1);
    const windKmh=(ctx&&ctx.wind!=null)?ctx.wind:((W&&W.state&&W.state.wind!=null)?W.state.wind:8);
    const svf=cell?skyViewFactor(cell):1;
    const expo=cell?windExposure(cell):1;
    const elevated=cell&&(cell.y||0)>1.0;
    const houseElev=(DATA.site&&DATA.site.coords&&DATA.site.coords.elevation_m)||300;
    const lapse=+(-(houseElev-TOWN_ELEV_M)*LAPSE_C_PER_M).toFixed(2);
    const alt=sun?sun.altDeg:-30;
    let micro=0,note='';
    if(alt<=-0.5){
      // NIGHT: high-SVF, low-exposure (calm) cells radiate to a cold sky and
      // pool cold air; elevated cells benefit from cold-air drainage.
      const clearF=clamp01((0.45-cloud)/0.45), calmF=clamp01((12-windKmh)/12);
      const radCool=-(0.4+1.6*svf)*clearF*(0.4+0.6*calmF);
      const drain=elevated?+1.2:0;                   // balcony warmer on calm nights
      micro=radCool+drain;
      note=elevated?'elevated — cold air drains downhill, higher minimum'
        :(clearF*calmF>0.45?'clear, calm night — radiative cooling to the open sky':'night — moderate cooling');
    } else {
      // DAY: a sheltered low corner traps a little warmth; an open one tracks town.
      const lit=(sun&&sun.altDeg>horizonAt(sun.azDeg)&&(cell?shadowMask(cell,d):1)>0);
      micro=(1-expo)*1.0 + (lit?0.6:-1.2);
      note=lit?'sun on the corner — local warming':'corner in shade — cooler than town';
    }
    const delta=+(lapse+micro).toFixed(1);
    return { delta, lapse, micro:+micro.toFixed(1), note, svf:+svf.toFixed(2),
             exposure:+expo.toFixed(2), estimate:true };
  }

  /* ---- DOWNSCALING: town reading → AT HIS HOUSE [houseTempDelta] -----------
     Kept as the public wrapper panels.js/app.js call. Now flux-derived: it
     builds a representative backyard ground cell and defers to airDelta(), but
     keeps the EXACT same {delta,lapse,micro,note,estimate} return shape and the
     same (town,backyard,alt,opts) signature. ------------------------------- */
  function _repCell(zoneId){
    const cells=cellGrid();
    const idx=_zoneCellIdx&&_zoneCellIdx[zoneId];
    if(idx&&idx.length) return cells[idx[Math.floor(idx.length/2)]];   // a central cell
    // FALLBACK rep cell (only if a zone has no surviving grid cells): a point in
    // the OPEN COURTYARD (z>BZ), which is real open ground after the L-shape (the
    // old CX+3.6,CZ point now sits inside the wide south-band living room).
    return { xL:CX, zL:BZ+(SITE_Z-BZ)/2, y:0, normal:{x:0,y:1,z:0}, zoneId:zoneId||'backyard',
             selfRole:null, _svf:null, _expo:null };
  }
  function houseTempDelta(town,backyard,alt,opts){
    if(town==null) return null;
    const o=opts||{};
    const cloud=(o.cloud!=null?o.cloud:0.1), windKmh=(o.wind!=null?o.wind:8);
    // synthesise a sun object carrying just the altitude the callers pass in;
    // azimuth isn't supplied here, so use the live Astro sun for the day/night
    // gating but override altitude with the caller's value for back-compat.
    const A=(typeof window!=='undefined')&&window.Astro;
    const liveSun=(A&&A.sun)?A.sun(new Date()):null;
    const sun=liveSun?Object.assign({},liveSun,{altDeg:alt}):{altDeg:alt,azDeg:90,dir:{x:0,y:Math.sin(alt*Math.PI/180),z:0}};
    const cell=_repCell('backyard');
    const ad=airDelta(cell,new Date(),{sun,cloud,wind:windKmh});
    // preserve the legacy phrasing the UI expects for the common cases
    let note=ad.note;
    if(alt>45 && (backyard&&backyard.sunlit)) note='full sun on the east yard';
    else if(alt>-0.5 && backyard && !backyard.sunlit) note='yard in the house shade (east exposure — afternoon shaded)';
    return { delta:ad.delta, lapse:ad.lapse, micro:ad.micro, note, estimate:true };
  }
  // back-compat wrapper: same {temp,delta,note,estimate} shape panels.js expects.
  function microclimate(town,backyard,alt,opts){
    const b=houseTempDelta(town,backyard,alt,opts);
    if(!b) return null;
    return {temp:Math.round((town+b.delta)*10)/10, delta:b.delta, note:b.note,
            lapse:b.lapse, micro:b.micro, estimate:true};
  }

  /* ---- DEW POINT (Magnus) from air temp °C + RH % ---- */
  function dewPoint(tempC,rh){
    if(tempC==null||rh==null||rh<=0) return null;
    const a=17.62,b=243.12;
    const g=Math.log(rh/100)+a*tempC/(b+tempC);
    return Math.round((b*g/(a-g))*10)/10;
  }
  /* ---- FEELS-LIKE / apparent temperature (Steadman AT) ---- */
  function feelsLike(tempC,rh,windKmh){
    if(tempC==null) return null;
    const RH=(rh!=null?rh:30), ws=(windKmh!=null?windKmh:0)/3.6;   // km/h → m/s
    const e=(RH/100)*6.105*Math.exp(17.27*tempC/(237.7+tempC));    // hPa
    return Math.round((tempC + 0.33*e - 0.70*ws - 4.00)*10)/10;
  }

  /* ---- §1b FROST RISK — Brunt sky-T + SVF driven [SIGNATURE KEPT] ----------
     Predicts the dawn SURFACE temperature of a horizontal leaf-height cell on a
     clear, calm night (the worst case for radiative frost), via the same energy
     balance: a high-SVF flat surface radiates to the cold Brunt sky and can dip
     well below air temp. Compared to 0 °C and the dew point. Returns the same
     {level, score, lowHouse, dewPoint, note, estimate} shape, daytime → null. */
  function frostRisk(opts){
    const o=opts||{}; const town=o.town;
    if(town==null) return null;
    const alt=(o.alt!=null?o.alt:-30);
    if(alt>0) return null;                                  // daytime — not a frost moment
    const cloud=(o.cloud!=null?o.cloud:0.1), wind=(o.wind!=null?o.wind:8);
    const rh=(o.hum!=null?o.hum:40);
    const baseLow=(o.nightLowTown!=null?o.nightLowTown:town);
    // a horizontal leaf-height cell in the open backyard (high SVF, exposed)
    const cell=o.cell||_repCell('backyard');
    const svf=skyViewFactor(cell), expo=windExposure(cell);
    // predicted dawn SURFACE temp via the energy balance on a horizontal leaf
    // (flat-up normal). Night → no shortwave; the Brunt sky term does the work.
    const soilT=(o.soilT!=null)?o.soilT:baseLow;            // soil ≈ night low if unknown
    const dawnDate=o.date||new Date();
    const Tsurf=surfaceTemp({x:0,y:1,z:0},dawnDate,{
      airC:baseLow, rh, cloud, windKmh:wind, material:'leaf',
      svf, exposure:expo, soilT, lag:false,
      sun:{altDeg:-20,azDeg:90,dir:{x:0,y:-0.34,z:0}}     // forced night (sun down)
    });
    const lowHouse=(Tsurf!=null)?Tsurf:baseLow;
    const dp=dewPoint(baseLow,rh);
    // radiative-frost favourability 0..1: clear sky + calm wind + high SVF
    const clearF=clamp01((0.4-cloud)/0.4), calmF=clamp01((10-wind)/10);
    const radF=clearF*calmF*(0.5+0.5*svf);
    // proximity of the predicted SURFACE temp to frost: warmer than +6 → safe
    const tempF=clamp01((6-lowHouse)/6);
    const dryF=dp!=null?clamp01((4-dp)/8):0.5;
    const score=Math.round((0.55*tempF+0.30*radF+0.15*dryF)*100);
    let level,note;
    if(lowHouse<=0.5 && radF>0.35){ level='high'; note='frost expected on your exposed patch — a horizontal surface radiating to the open sky and dropping below zero'; }
    else if(score>=55){ level='medium'; note='chance of ground frost on a clear, calm night (radiative cooling over open ground)'; }
    else if(score>=30){ level='low'; note='frost unlikely, but an exposed horizontal surface cools fast'; }
    else { level='none'; note='no frost risk'; }
    return {level, score, lowHouse:+lowHouse.toFixed(1), dewPoint:dp, note, estimate:true};
  }

  // stargazing verdict for HIS Bortle-3 site. Folds: cloud (the killer) + moon (washes
  // faint sky) + TRANSPARENCY — humidity & dust haze that dim the stars, real per-night
  // data (opts.hum %, opts.dust µg/m³). No light-pollution penalty: his sky is Bortle-3
  // dark, which is exactly why a clear, dry, moonless night here reaches "exceptional"
  // (the same night over a city would only rate "ok"). transparency defaults to a dry-
  // desert ~good when data is absent, so it never invents a penalty.
  function goOutScore(cloud,moonIllum,alt,nightCloud,opts){
    if(alt>-12) return null;
    const c=(nightCloud!=null?nightCloud:(cloud!=null?cloud:0.1));
    const o=opts||{};
    const rh=(o.hum!=null)?o.hum:30, dust=(o.dust!=null)?o.dust:15;
    const humPen=clamp((rh-40)/55,0,1)*0.6;        // 40%→none, ~95%→0.6 (haze/dew)
    const dustPen=clamp((dust-25)/120,0,1)*0.7;    // 25µg→none, ~145µg→0.7 (aerosol veil)
    const transparency=Math.max(0,1-humPen-dustPen);
    const score=Math.round((1-c)*60 + (1-(moonIllum||0))*28 + transparency*12);  // cloud stays the dominant killer
    return {score, cloud:c, transparency:+transparency.toFixed(2), bortle:3,
      verdict:score>=80?'excellent — go outside':score>=60?'good':score>=40?'fair':'not ideal'};
  }

  /* ---- today's per-zone sun window (scan the day) ---- */
  const hm=m=>m==null?'—':String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
  function shadeSchedule(z,date){
    if(!window.Astro) return null;
    const day=new Date(date); day.setHours(0,0,0,0); let f=null,l=null;
    for(let m=0;m<=1440;m+=10){const s=window.Astro.sun(new Date(day.getTime()+m*60000));
      if(zoneState(z,s.azDeg,s.altDeg).sunlit){if(f==null)f=m;l=m;}}
    return {firstSun:hm(f),lastSun:hm(l),sunHours:(f!=null&&l!=null)?Math.round((l-f)/6)/10:0};
  }

  /* ---- sun over HIS ridgeline (true rise/set) vs flat horizon ---- */
  function sunEvents(date){
    if(!window.Astro) return null;
    const day=new Date(date); day.setHours(0,0,0,0);
    let rR=null,sR=null,rF=null,sF=null,pr=null,pf=null;
    for(let m=0;m<=1440;m+=4){
      const s=window.Astro.sun(new Date(day.getTime()+m*60000));
      const overR=s.altDeg>horizonAt(s.azDeg), overF=s.altDeg>0;
      if(pr!=null){ if(!pr&&overR&&rR==null)rR=m; if(pr&&!overR)sR=m; }
      if(pf!=null){ if(!pf&&overF&&rF==null)rF=m; if(pf&&!overF)sF=m; }
      pr=overR; pf=overF;
    }
    return {riseRidge:hm(rR),setRidge:hm(sR),riseFlat:hm(rF),setFlat:hm(sF)};
  }

  /* ---- next meteor shower visible from his dark site (2026 peaks) ---- */
  const METEORS=[
    ['Quadrantids','2026-01-04',110],['Lyrids','2026-04-22',18],['Eta Aquariids','2026-05-06',50],
    ['Delta Aquariids','2026-07-30',25],['Perseids','2026-08-12',100],['Orionids','2026-10-21',20],
    ['Leonids','2026-11-17',15],['Geminids','2026-12-14',150],['Ursids','2026-12-22',10],
    ['Quadrantids','2027-01-04',110]];
  function nextMeteor(now){
    for(const [n,d,z] of METEORS){const dt=new Date(d+'T22:00:00');
      if(dt>now){return {name:n,date:dt,zhr:z,days:Math.ceil((dt-now)/864e5)};}}
    return null;
  }

  /* ---- the NEXT dark (new-moon) night — the most actionable stargazing planner.
     Moon illumination is pure ephemeris (certain) so we scan forward to the next
     new-moon trough; cloud is folded in ONLY if the night is inside Weather's 3-day
     forecast horizon (else null = "too far to forecast, but moonless"). ---- */
  function nextDarkNight(now){
    if(!window.Astro) return null;
    const A=window.Astro, base=new Date(now||Date.now());
    let best=null;
    for(let d=0; d<=30; d++){
      const night=new Date(base); night.setDate(night.getDate()+d); night.setHours(1,0,0,0); // ~01:00 deep night
      const illum=A.moon(night).illum;
      if(best==null || illum<best.illum) best={ date:new Date(night), illum, d };
    }
    if(!best) return null;
    let cloud=null;
    if(window.Weather&&Weather.tonightCloud){ const c=Weather.tonightCloud(best.date); if(c!=null) cloud=c; }
    return { date:best.date, illum:best.illum, cloud, daysAway:best.d };
  }

  /* ---- galactic CORE (Sagittarius, RA 17.76h / Dec −28.9°) visibility tonight: when
     it clears ~12° AND the sun is ≤ −15° (astro-ish dark). Returns the dark window +
     peak altitude/direction + the worst moon interference during it. inSeason=false in
     winter (core never up while dark). Pure ephemeris via Astro.eqToHorizon. ---- */
  function galacticCore(date){
    const A=window.Astro; if(!A||!A.eqToHorizon) return null;
    const RA=17.76, DEC=-28.9, MINALT=12, DARK=-15;
    const ev=new Date(date||Date.now()); ev.setHours(18,0,0,0);
    let from=null,to=null,peak=-90,peakAz=0,moonMax=0;
    for(let m=0;m<=12*60;m+=10){
      const t=new Date(ev.getTime()+m*60000);
      if(A.sun(t).altDeg>DARK) continue;
      const c=A.eqToHorizon(RA,DEC,t);
      if(c.altDeg>=MINALT){ if(!from)from=t; to=t;
        if(c.altDeg>peak){peak=c.altDeg;peakAz=c.azDeg;}
        const mo=A.moon(t); if(mo.altDeg>0&&mo.illum>moonMax) moonMax=mo.illum; }
    }
    if(!from) return { inSeason:false };
    return { inSeason:true, fromHM:hm(from.getHours()*60+from.getMinutes()), toHM:hm(to.getHours()*60+to.getMinutes()),
      peakAlt:Math.round(peak), peakAz:Math.round(peakAz), moonIllum:moonMax };
  }

  /* ---- golden-hour + twilight CLOCK TIMES (the sun-altitude bands): golden +6°,
     civil −6°, nautical −12°, astronomical −18° (full dark). morning = ascending
     crossing, evening = descending. Reuses the day-scan + hm() formatter. ---- */
  function twilightTimes(date){
    if(!window.Astro) return null;
    const day=new Date(date); day.setHours(0,0,0,0);
    const TH={golden:6,civil:-6,nautical:-12,astro:-18};
    const res={golden:{},civil:{},nautical:{},astro:{}};
    let prev=null;
    for(let m=0;m<=1440;m+=2){
      const a=window.Astro.sun(new Date(day.getTime()+m*60000)).altDeg;
      if(prev!=null){ for(const k in TH){ const th=TH[k];
        if(prev<th && a>=th && res[k].morn==null) res[k].morn=m;
        if(prev>=th && a<th) res[k].eve=m; } }
      prev=a;
    }
    const out={}; for(const k in res) out[k]={morn:hm(res[k].morn==null?null:res[k].morn), eve:hm(res[k].eve==null?null:res[k].eve)};
    return out;
  }

  /* ---- ZODIACAL LIGHT — the faint dust-cone along the ecliptic ("false dusk/dawn"),
     a Bortle-3-class phenomenon Alex can actually see. Best when the ecliptic stands
     STEEP at the horizon in fully dark, MOONLESS sky: evening cone in the WEST after
     astronomical dusk (best ~spring), morning cone in the EAST before astronomical dawn
     (best ~autumn). We sample a point ~30° up the ecliptic from the sun at the dusk/dawn
     moment; its altitude = how tall the cone reaches. Pure ephemeris (Astro.sun.eclLon +
     eqToHorizon); honest guidance, not a guarantee (needs a clear low horizon + his dark sky). */
  function _eclipticHorizon(lambdaRad, date){
    const eps=23.439*Math.PI/180, sl=Math.sin(lambdaRad), cl=Math.cos(lambdaRad);
    const ra=Math.atan2(Math.cos(eps)*sl, cl), dec=Math.asin(Math.sin(eps)*sl);
    return window.Astro.eqToHorizon(((ra*12/Math.PI)%24+24)%24, dec*180/Math.PI, date);
  }
  function zodiacalLight(date){
    const A=window.Astro; if(!A||!A.eqToHorizon) return null;
    const day=new Date(date); day.setHours(0,0,0,0);
    let duskMs=null, dawnMs=null, prev=null;          // astronomical (−18°) dusk/dawn moments
    for(let m=0;m<=1440;m+=3){ const t=day.getTime()+m*60000, a=A.sun(new Date(t)).altDeg;
      if(prev!=null){ if(prev>=-18&&a<-18) duskMs=t; if(prev<-18&&a>=-18&&dawnMs==null) dawnMs=t; } prev=a; }
    function cone(ms, sign){                           // +1 evening (W), −1 morning (E)
      if(ms==null) return null;
      const t=new Date(ms), ls=A.sun(t).eclLon, mo=A.moon(t);
      // ECLIPTIC-to-HORIZON ANGLE near the sun's set/rise point: rise/run between two
      // ecliptic points 10° apart. Steep (→90°) = the dust cone stands tall = good;
      // shallow (→0°) = it lies flat along the horizon, lost in the glow. Textbook
      // zodiacal-light criterion — independent of how far the sun has set.
      const dLam=10*Math.PI/180;
      const pA=_eclipticHorizon(ls, t), pB=_eclipticHorizon(ls+sign*dLam, t);
      let dAz=pB.azDeg-pA.azDeg; if(dAz>180)dAz-=360; if(dAz<-180)dAz+=360;
      const angle=Math.atan2(Math.abs(pB.altDeg-pA.altDeg), Math.abs(dAz))*180/Math.PI;
      const moonBad=mo.altDeg>0 && mo.illum>0.15;
      return { angleDeg:Math.round(angle), azDeg:Math.round(pB.azDeg), moonBad,
        good:angle>=50 && !moonBad, hm:hm(t.getHours()*60+t.getMinutes()) };
    }
    return { evening:cone(duskMs,+1), morning:cone(dawnMs,-1) };
  }

  /* ---- "what crossed over his house while he slept" — a BACKWARD scan (last ~14 h) of
     the tracked sats (real SGP4 via Satellites), listing passes that were genuinely
     NAKED-EYE VISIBLE (satellite sunlit + observer in the dark + above ~10°). Uses REAL
     now (not the scrubbed clock). Cached per 10-min bucket so the per-second sky panel
     never re-propagates. ---- */
  let _opCache=null, _opKey=null;
  function overnightPasses(){
    const S=window.Satellites, A=window.Astro;
    if(!S||!S.isReady||!S.isReady()||!A||!A.sunEciUnit) return [];
    const nowMs=Date.now(), key=Math.floor(nowMs/6e5);
    if(_opCache && _opKey===key) return _opCache;
    const start=nowMs-14*3600000, out=[];
    (S.list||[]).forEach(sat=>{
      if(!sat.ok||!sat.satrec) return;
      let inPass=false, peakAlt=-90, peakT=null, peakAz=0, sawVis=false;
      for(let t=start; t<=nowMs; t+=60000){
        const d=new Date(t), la=S.lookAngles(sat.satrec, d, A.sunEciUnit(d));
        if(!la) continue;
        const up=la.altDeg>10, vis=la.sunlit && A.sun(d).altDeg<-4 && la.altDeg>10;
        if(up){ if(!inPass){ inPass=true; peakAlt=-90; sawVis=false; }
          if(la.altDeg>peakAlt){ peakAlt=la.altDeg; peakT=d; peakAz=la.azDeg; }
          if(vis) sawVis=true;
        } else if(inPass){
          if(sawVis&&peakT) out.push({ he:sat.he, short:sat.short, peakAlt:Math.round(peakAlt),
            peakAzHe:S.dirHe(peakAz), hm:hm(peakT.getHours()*60+peakT.getMinutes()), ms:peakT.getTime() });
          inPass=false;
        }
      }
    });
    out.sort((a,b)=>a.ms-b.ms);
    _opKey=key; _opCache=out; return out;
  }

  /* ---- ZODIAC chart (tropical): each body's sign+degree from its geocentric ecliptic
     longitude. Sun/moon/planets are real ephemeris; the ASCENDANT (rising sign) needs a
     birth TIME + place, computed from local sidereal time. Astrology framed as poetry. ---- */
  const ZODIAC=['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
  function signOf(eclLonRad){ const d=((eclLonRad*180/Math.PI)%360+360)%360, i=Math.floor(d/30); return { sign:ZODIAC[i], idx:i, deg:Math.round(d-i*30) }; }
  function zodiacChart(date){
    const A=window.Astro; if(!A) return null;
    const out={ sun:signOf(A.sun(date).eclLon), moon:signOf(A.moon(date).eclLon), planets:[] };
    (A.planets(date)||[]).forEach(p=>{ if(p.eclLon!=null) out.planets.push(Object.assign({he:p.he, name:p.name}, signOf(p.eclLon))); });
    return out;
  }
  // rising sign (ascendant) ecliptic longitude → sign. Needs LST (from Astro.lstRad,
  // which uses the app's longitude — a fair proxy for a birth in his region). Estimate.
  function ascendant(date){
    const A=window.Astro; if(!A||!A.lstRad||!A.eqToHorizon) return null;
    const eps=23.439*Math.PI/180, lat=LAT*Math.PI/180, ramc=A.lstRad(date);
    const raw=Math.atan2(Math.cos(ramc), -(Math.sin(ramc)*Math.cos(eps)+Math.tan(lat)*Math.sin(eps)));
    const deg=((raw*180/Math.PI)%360+360)%360;
    // raw gives the asc/desc axis; pick the candidate that's actually on the EASTERN
    // horizon (azimuth 0–180°) at this instant — that's the rising point.
    const horiz=L=>{ const r=L*Math.PI/180, sl=Math.sin(r), cl=Math.cos(r);
      const ra=Math.atan2(Math.cos(eps)*sl,cl), dec=Math.asin(Math.sin(eps)*sl);
      return A.eqToHorizon(((ra*12/Math.PI)%24+24)%24, dec*180/Math.PI, date); };
    const chosen = (horiz(deg).azDeg<180) ? deg : (deg+180)%360;
    return signOf(chosen*Math.PI/180);
  }

  /* ====================================================================
     §4 PLANT-SUITABILITY MAPPING.
     Scores each plant × cell × season from the requirement schema in
     resident_plants.json (dli_min/max, sun_hours_min, t_max_tol, frost_hardy_c,
     chill_hours_req, gdd_to_fruit) against the cell's seasonal profile.
       score = w1·fit(DLI) + w2·fit(sunHours) − w3·heat − w4·frost
             + w5·fit(chill) + w6·water − w7·wind
     fit()=1 inside range, ramps to 0 outside. Hebrew reasons are generated
     from the dominant terms (style of zone_reason_he). estimate.
     ==================================================================== */
  // ramp helpers: fit a value to a [min,max] tolerance band (1 inside, →0 out).
  function fitRange(v,lo,hi){
    if(lo!=null && v<lo){ const w=Math.max(0.5,lo*0.4); return clamp01(1-(lo-v)/w); }
    if(hi!=null && v>hi){ const w=Math.max(0.5,hi*0.3); return clamp01(1-(v-hi)/w); }
    return 1;
  }
  function fitMin(v,lo){ if(lo==null) return 1; if(v>=lo) return 1; const w=Math.max(0.5,lo*0.5); return clamp01(1-(lo-v)/w); }
  // estimated winter chill hours (0–7.2 °C) at the cell from the season climate.
  function _chillHours(cell){
    // Larkmont winters give ample chill; count hours the winter air sits in
    // the 0–7.2 °C band over a representative cold spell. We approximate from the
    // winter climatology (Tlow=1, Thigh=14): the diurnal curve dips into the band
    // for ~9–11 h/night across the ~90-day winter → scale to a season total.
    const clim=SEASON_CLIM.winter;
    let hPerDay=0;
    for(let m=0;m<1440;m+=30){ const t=airTempAt(clim,m/60); if(t>=0&&t<=7.2) hPerDay+=0.5; }
    // elevated cells run ~1 °C warmer at night → a touch less chill
    const elevated=(cell&&(cell.y||0)>1.0);
    const days=90;
    return Math.round(hPerDay*days*(elevated?0.9:1.0));
  }
  // estimated growing-season GDD (base 10 °C) accumulated spring→autumn.
  function _gddSeason(cell){
    let gdd=0;
    ['spring','summer','autumn'].forEach(s=>{
      const c=SEASON_CLIM[s], days=90, base=10;
      const mean=(c.Thigh+c.Tlow)/2;
      gdd+=Math.max(0,mean-base)*days;
    });
    return Math.round(gdd);
  }
  // water-feasibility: how comfortably the season ETc demand fits the plant's
  // listed weekly water budget. >1 means the budget comfortably covers demand.
  function _waterFit(plant,prof,season){
    const wk=plant['water_'+season+'_l_week'];
    if(wk==null||!prof) return 1;
    const canopy=plant.canopy_m2||1.0;
    const demandMmDay=(prof.ETc||0)*((plant&&plant.kc!=null)?plant.kc:1.0);  // FAO-56: ETc = Kc·ET0_site — apply the per-species crop coefficient (audit H1)
    const demandLweek=demandMmDay*canopy*7;        // 1 mm over 1 m² = 1 L
    if(demandLweek<=0) return 1;
    return clamp01(wk/demandLweek);                // budget vs need
  }
  // SCORE one plant on one cell for one season → {score, terms}
  function _scorePlantCell(plant,cell,season){
    const prof=cellProfile(cell,season);
    const summer=cellProfile(cell,'summer');
    const winter=cellProfile(cell,'winter');
    if(!prof) return null;
    // weights. For a FROST-TENDER species (frost_hardy_c > −5 °C) in a near-annual
    // frost climate, avoiding frost is the BINDING siting constraint — so its
    // frost weight is boosted and its (open-air) wind penalty relaxed, matching
    // the horticultural reality that you site a tender evergreen in the warmest,
    // most frost-protected spot (here: the elevated terrace) and shelter it.
    const tender=(plant.frost_hardy_c!=null && plant.frost_hardy_c>-5);
    const w = tender
      ? { dli:0.18, sun:0.14, heat:0.14, frost:0.34, chill:0.06, water:0.08, wind:0.06 }
      : { dli:0.24, sun:0.18, heat:0.16, frost:0.18, chill:0.10, water:0.08, wind:0.06 };
    const fDli=fitRange(prof.DLI, plant.dli_min, plant.dli_max);
    const fSun=fitMin(prof.sunHours, plant.sun_hours_min);
    // heat penalty: summer peak CANOPY-AIR temp above the leaf-scorch ceiling.
    // t_max_tol is an ambient/air heat ceiling; the gravel Tpeak (50 °C) is the
    // hot GROUND skin and a bare-leaf energy balance overstates leaf temp because
    // it omits transpirational cooling — so the most defensible reference is the
    // local canopy-air peak (season air high + the cell's sheltered day-Δ),
    // nudged up a little by radiant load on the lowest-SVF, most-exposed corners.
    const radNudge=summer?clamp01((summer.solFrac-0.5))*3:0;   // 0..~1.5 °C extra on sun-baked cells
    const heatRef=summer?(summer.airPeak+radNudge):null;
    const heatOver=(plant.t_max_tol!=null && heatRef!=null)?Math.max(0,heatRef-plant.t_max_tol):0;
    const heatPen=clamp01(heatOver/6);             // 6 °C over the ceiling → full penalty
    // frost penalty: winter frost-screen dawn temp below the hardiness floor.
    // frostTdawn folds in cold-air DRAINAGE (elevated terrace warmer, low corners
    // pool cold) + the radiative leaf dip — so a frost-tender plant is correctly
    // pushed UP onto the balcony and OUT of low cold-pooling corners.
    const frostScreen=winter?(winter.frostTdawn!=null?winter.frostTdawn:winter.Tdawn):null;
    let frostPen=0;
    if(plant.frost_hardy_c!=null && frostScreen!=null){
      const below=Math.max(0,plant.frost_hardy_c-frostScreen);   // how far past the floor
      frostPen=clamp01(below/4) * (winter.frost?1:0.6);
    }
    const chillEst=_chillHours(cell);
    const fChill=(plant.chill_hours_req!=null)?fitMin(chillEst,plant.chill_hours_req):1;
    const fWater=_waterFit(plant,prof,season);
    const wind=prof.exposure;                      // 0..1
    // wind penalty only for fragile species (broad-leaf/heat-sensitive). For a
    // frost-tender plant we assume it is SHELTERED at its frost-safe spot (the
    // curated guidance literally says "sheltered from wind"), so its wind term is softened
    // — frost protection, not wind, governs where it goes.
    const fragile=(plant.id==='blueberries'||plant.id==='avocado'||plant.id==='mint');
    let windPen=fragile?clamp01((wind-0.6)/0.4):0;
    if(tender) windPen*=0.4;                       // tender plant is sheltered where sited
    let score=100*( w.dli*fDli + w.sun*fSun + w.chill*fChill + w.water*fWater )
              -100*( w.heat*heatPen + w.frost*frostPen + w.wind*windPen );
    score=Math.round(clamp(score,0,100));
    return { score, terms:{ fDli, fSun, heatPen, frostPen, fChill, fWater, windPen,
      DLI:prof.DLI, sunHours:prof.sunHours, heatRef:heatRef!=null?+heatRef.toFixed(1):null,
      frostTdawn:frostScreen!=null?+frostScreen.toFixed(1):null, frost:winter?winter.frost:false,
      elevated:(cell.y||0)>1.0, chillEst, exposure:wind, ETc:prof.ETc } };
  }
  // build a concise Hebrew reason from the dominant scoring terms.
  function _reasonHe(plant,cell,t,season){
    const zoneHe={ backyard:'Backyard', balcony:'Balcony', front:'Front of the house' }[cell.zoneId]||cell.zoneId;
    const bits=[];
    bits.push(`${zoneHe}: ~${t.sunHours} h sun/day, DLI ~${t.DLI}`);
    // dominant negative term?
    if(t.frostPen>0.3 && t.frostTdawn!=null) bits.push(`dawn minimum ~${t.frostTdawn}°C — frost risk for a sensitive plant${t.elevated?'':', a low corner that pools cold air'}`);
    else if(t.elevated && plant.frost_hardy_c!=null && plant.frost_hardy_c>-5) bits.push(`elevated — cold air drains downhill, dawn minimum ~${t.frostTdawn}°C protects the frost-sensitive plant`);
    else if(plant.frost_hardy_c!=null && t.frost) bits.push(`hardy to ${plant.frost_hardy_c}°C, withstands the night frost`);
    if(t.heatPen>0.3 && t.heatRef!=null) bits.push(`peak canopy heat ~${t.heatRef}°C — above its heat threshold`);
    else if(plant.t_max_tol!=null && t.heatRef!=null && t.heatRef<=plant.t_max_tol) bits.push(`summer heat (~${t.heatRef}°C) within its tolerance range`);
    if(plant.chill_hours_req!=null){ if(t.fChill>=0.95) bits.push(`enough chill hours (~${t.chillEst} h)`); else bits.push(`winter chill insufficient (~${t.chillEst}/${plant.chill_hours_req} h)`); }
    if(t.exposure>0.75) bits.push('wind-exposed corner');
    else if(t.exposure<0.45) bits.push('wind-sheltered corner');
    return bits.join('. ')+'.';
  }
  // RANK plants for a given cell (best-fit first).
  function rankPlantsForCell(cell,season){
    const plants=(DATA.plants||[]);
    season=season||'summer';
    const out=plants.map(p=>{
      const r=_scorePlantCell(p,cell,season);
      if(!r) return null;
      return { plant:p, plantId:p.id, name_he:p.name_he, score:r.score,
               reason_he:_reasonHe(p,cell,r.terms,season), terms:r.terms, estimate:true };
    }).filter(Boolean);
    out.sort((a,b)=>b.score-a.score);
    return out;
  }
  // BEST cell for a given plant (highest score across the whole grid).
  function bestCellForPlant(plantId,season){
    const plants=(DATA.plants||[]);
    const plant=plants.find(p=>p.id===plantId); if(!plant) return null;
    season=season||'summer';
    const cells=cellGrid();
    let best=null;
    for(const cell of cells){
      if(cell.ambient) continue;          // ambient ground is heat-map fill, not a planting target
      const r=_scorePlantCell(plant,cell,season);
      if(!r) continue;
      if(!best||r.score>best.score){ best={ cell, score:r.score, terms:r.terms,
        reason_he:_reasonHe(plant,cell,r.terms,season) }; }
    }
    if(best) best.estimate=true;
    return best;
  }

  /* ---- §4b CANDIDATE PLANTS (not yet in the garden) -------------------------
     The "worth adding to the garden" suggestions (garden.js) score plants Alex does NOT
     own against his real zones. Those candidate objects are NOT in DATA.plants,
     so rankPlantsForCell/bestCellForPlant (which iterate the owned set) can't see
     them — but _scorePlantCell + _reasonHe already operate on an ARBITRARY plant
     object carrying the requirement schema (dli_min/max, sun_hours_min, t_max_tol,
     frost_hardy_c, chill_hours_req, water_*_l_week, canopy_m2, kc). These thin
     wrappers feed the SAME physics with a passed-in plant, so a candidate is sited
     by the identical microclimate logic that ranks the curated plants. estimate. */
  // score a single candidate plant object on one cell → {score, reason_he, terms}.
  function scoreCandidateCell(plant,cell,season){
    if(!plant||!cell) return null;
    season=season||'summer';
    const r=_scorePlantCell(plant,cell,season);
    if(!r) return null;
    return { plant, plantId:plant.id, name_he:plant.name_he, score:r.score,
             reason_he:_reasonHe(plant,cell,r.terms,season), terms:r.terms, estimate:true };
  }
  // BEST cell across the whole grid for a candidate plant object (highest score).
  // Mirrors bestCellForPlant but takes the plant OBJECT (candidates aren't owned).
  function bestCellForCandidate(plant,season){
    if(!plant) return null;
    season=season||'summer';
    const cells=cellGrid();
    let best=null;
    for(const cell of cells){
      if(cell.ambient) continue;          // ambient ground is heat-map fill, not a planting target
      const r=_scorePlantCell(plant,cell,season);
      if(!r) continue;
      if(!best||r.score>best.score){ best={ cell, zoneId:cell.zoneId, score:r.score, terms:r.terms,
        reason_he:_reasonHe(plant,cell,r.terms,season) }; }
    }
    if(best) best.estimate=true;
    return best;
  }

  /* ---- temperature → colour ramp (blue→cyan→yellow→red) ---- */
  const _TEMP_STOPS=[
    [0.00, 0.13,0.20,0.62],   // deep blue   (coldest)
    [0.22, 0.16,0.55,0.85],   // blue-cyan
    [0.40, 0.20,0.80,0.78],   // cyan/teal
    [0.55, 0.45,0.82,0.40],   // green
    [0.70, 0.96,0.86,0.30],   // yellow
    [0.85, 0.95,0.55,0.20],   // orange
    [1.00, 0.90,0.18,0.14]];  // red        (hottest)
  function tempColor(tempC,range){
    const minC=(range&&range[0]!=null)?range[0]:5;
    const maxC=(range&&range[1]!=null)?range[1]:65;
    let t=(maxC>minC)?(tempC-minC)/(maxC-minC):0.5;
    t=Math.max(0,Math.min(1,t));
    let a=_TEMP_STOPS[0], b=_TEMP_STOPS[_TEMP_STOPS.length-1];
    for(let i=0;i<_TEMP_STOPS.length-1;i++){
      if(t>=_TEMP_STOPS[i][0] && t<=_TEMP_STOPS[i+1][0]){ a=_TEMP_STOPS[i]; b=_TEMP_STOPS[i+1]; break; }
    }
    const span=(b[0]-a[0])||1, k=(t-a[0])/span;
    return { r:a[1]+(b[1]-a[1])*k, g:a[2]+(b[2]-a[2])*k, b:a[3]+(b[3]-a[3])*k };
  }

  /* ---- energy / plants accessors ---- */
  function energyNow(date){
    const E=DATA.energy; if(!E) return null; const mo=(date||new Date()).getMonth();
    const nf=E.night_flush&&E.night_flush.rows&&E.night_flush.rows[mo];
    return { pv:E.pv, nightFlush:nf, hdd:E.degree_days&&E.degree_days.annual_hdd, cdd:E.degree_days&&E.degree_days.annual_cdd,
             shw:E.solar_hot_water };
  }

  /* ---- live biodiversity near his home (iNaturalist, CORS-ok) ---- */
  async function fetchSightings(radiusKm=15){
    try{
      const u=`https://api.inaturalist.org/v1/observations?lat=${LAT}&lng=${LON}&radius=${radiusKm}`+
        `&order=desc&order_by=observed_on&per_page=14&photos=true&quality_grade=research&locale=he`;
      const j=await fetch(u).then(r=>r.json());
      const coordsOf=o=>{
        const g=o.geojson&&o.geojson.coordinates;
        if(Array.isArray(g)&&g.length>=2&&isFinite(g[0])&&isFinite(g[1])) return {lat:+g[1],lng:+g[0]};
        if(typeof o.location==='string'){ const p=o.location.split(',');
          if(p.length>=2){ const la=+p[0],ln=+p[1]; if(isFinite(la)&&isFinite(ln)) return {lat:la,lng:ln}; } }
        return null;
      };
      return (j.results||[]).map(o=>{
        const c=coordsOf(o);
        return {
          name:(o.taxon&&(o.taxon.preferred_common_name||o.taxon.name))||'—',
          sci:o.taxon&&o.taxon.name, date:o.observed_on,
          photo:o.taxon&&o.taxon.default_photo&&o.taxon.default_photo.square_url,
          place:o.place_guess, iconic:o.taxon&&o.taxon.iconic_taxon_name,
          lat:c?c.lat:null, lng:c?c.lng:null, coords:c };
      });
    }catch(e){ return null; }
  }

  /* ---- live observations of ONE species near his home (iNaturalist, keyless, CORS-ok) ----
     Sibling of fetchSightings: constrains to an iconic taxon (default Plantae, so existing plant
     calls are unchanged) + a taxon (by name or id) and an optional seasonal month cut. Pass
     iconic_taxa:'Animalia' for wildlife. Same return shape as fetchSightings → sightHtml/obsRow
     render it directly. */
  async function fetchObservations({taxon_name, taxon_id, iconic_taxa='Plantae', radiusKm=15, season}={}){
    try{
      // Allow a taxon-LESS browse when an explicit non-default iconic group is given
      // (e.g. iconic_taxa:'Animalia' for the wildlife feed). Keep returning [] for the
      // default Plantae-with-no-taxon case (a plant card with no name → don't show randoms).
      if(taxon_id==null && !taxon_name && (iconic_taxa||'Plantae')==='Plantae') return [];
      let u=`https://api.inaturalist.org/v1/observations?lat=${LAT}&lng=${LON}&radius=${radiusKm}`+
        `&order=desc&order_by=observed_on&per_page=14&photos=true&quality_grade=research&locale=he`+
        `&iconic_taxa=${encodeURIComponent(iconic_taxa||'Plantae')}`;
      if(taxon_id!=null) u+=`&taxon_id=${encodeURIComponent(taxon_id)}`;
      else if(taxon_name) u+=`&taxon_name=${encodeURIComponent(taxon_name)}`;
      const mo = season!=null ? +season : new Date().getMonth()+1;
      if(isFinite(mo)&&mo>=1&&mo<=12) u+=`&month=${mo}`;
      const j=await fetch(u).then(r=>r.json());
      const coordsOf=o=>{
        const g=o.geojson&&o.geojson.coordinates;
        if(Array.isArray(g)&&g.length>=2&&isFinite(g[0])&&isFinite(g[1])) return {lat:+g[1],lng:+g[0]};
        if(typeof o.location==='string'){ const p=o.location.split(',');
          if(p.length>=2){ const la=+p[0],ln=+p[1]; if(isFinite(la)&&isFinite(ln)) return {lat:la,lng:ln}; } }
        return null;
      };
      return (j.results||[]).map(o=>{
        const c=coordsOf(o);
        return {
          name:(o.taxon&&(o.taxon.preferred_common_name||o.taxon.name))||'—',
          sci:o.taxon&&o.taxon.name, date:o.observed_on,
          photo:o.taxon&&o.taxon.default_photo&&o.taxon.default_photo.square_url,
          place:o.place_guess, iconic:o.taxon&&o.taxon.iconic_taxon_name,
          lat:c?c.lat:null, lng:c?c.lng:null, coords:c };
      });
    }catch(e){ return null; }
  }

  /* ====================================================================
     §7 ROOF + SOLAR POTENTIAL — a physically-grounded annual-kWh estimate
     and best panel tilt for Alex's REAL flat roof, computed from the SAME
     POA engine the seasonal microclimate uses (incidentSolar/shadowMask/
     skyViewFactor + Astro.sun + SEASON_CLIM clear-sky climatology). NOT
     Google Solar (no Larkmont mesh) — this is the honest, hyper-local
     alternative: its unique value is that shadowMask ray-casts against the
     real terrain horizon + the parapet + the ±14.5 m neighbours, so the
     figure reflects Alex's ACTUAL skyline, reported as horizon_loss_pct.

     The two roof slabs are transcribed from building.js (read-only there):
       north band : roofSlab(BX,0.16,GZ,     BX/2, yr+0.08, GZ/2)
       SW bedroom : roofSlab(GX,0.16,BZ-GZ,  GX/2, yr+0.08, GZ+(BZ-GZ)/2)
     with BX=8.41, BZ=7.20, GX=3.18, GZ=3.60, roof top y≈5.38 (GH+UH+0.08).
     Gross ≈ 8.41×3.60 + 3.18×3.60 ≈ 41.7 m². A south-tilted panel normal in
     this frame (+x=E,+y=up,+z=S) is {x:0,y:cos β,z:sin β}.
     Honest ESTIMATE (estimate:true) — clear-sky×climatology GHI, geometric
     usable area, PR-only soiling; ±10–15% on the annual figure.
     ==================================================================== */
  // verified building.js roof constants (transcribed; building.js is read-only).
  const _ROOF = {
    BX:8.41, BZ:7.20, GX:3.18, GZ:3.60, yTop:5.38,
    // each slab: centre x/z + plan dimensions (m). Gross area = w*d.
    slabs:[
      { x:8.41/2,        z:3.60/2,            w:8.41, d:3.60 },   // north band 30.28 m²
      { x:3.18/2,        z:3.60+(7.20-3.60)/2, w:3.18, d:7.20-3.60 } // SW bedroom 11.45 m²
    ]
  };
  let _roofSolarCache=null;
  // build one roof-plane "cell" at a slab centre with a south-tilted normal.
  // makeHouseCell gives it isHouse:true, so shadowMask uses the house-point
  // ray path that honours the parapet/neighbours/terrain horizon (the value-add)
  // and skyViewFactor bakes its diffuse sky fraction once.
  function _roofCell(slab, tiltDeg){
    const b=tiltDeg*Math.PI/180;
    // C1 fix: the cell normal lives in the HOUSE PLAN frame (incidentSolar tests it against
    // toPlanDir(sun.dir)). A raw +z ("South" in world/astro coords) points ~world-EAST here
    // because of the 95° house yaw, so the optimizer wrongly picked 0° flat. Rotate world-south
    // (+z) INTO the plan frame and tilt toward THAT.
    const ps=toPlanDir({x:0,y:0,z:1}), sb=Math.sin(b);
    const n={ x:ps.x*sb, y:Math.cos(b), z:ps.z*sb };
    // makeHouseCell biases the origin outward along n by HOUSE_BIAS (~6 cm) so the
    // slab it sits on doesn't self-shadow — exactly the per-vertex house path.
    return makeHouseCell(slab.x, _ROOF.yTop, slab.z, n);
  }
  // sum POA Wh/m²/yr for one tilt: day-march the 15th of each month at 20-min
  // steps, calling the EXISTING incidentSolar with clear-sky GHI driven by the
  // season's climatological cloud (SEASON_CLIM) so it works for arbitrary dates
  // with no live radiation. Returns {poa_kwh_m2, by_month:[{month,kwh_m2,ghi_kwh_m2}]}.
  function _poaYearForTilt(slab, tiltDeg){
    const A=(typeof window!=='undefined')&&window.Astro;
    const cell=_roofCell(slab,tiltDeg);
    const stepMin=20, dtH=stepMin/60;
    const by_month=[]; let poaWhYr=0;
    for(let mo=0;mo<12;mo++){
      const clim=SEASON_CLIM[_seasonOf(new Date(SEASON_YEAR,mo,15))];
      const cloud=clim?clim.cloud:0.12;
      const dim=new Date(SEASON_YEAR,mo+1,0).getDate();   // days in this month
      let dayWh=0, dayGhiWh=0;
      for(let min=0;min<1440;min+=stepMin){
        const d=new Date(SEASON_YEAR,mo,15,0,0,0); d.setMinutes(min);
        const sun=(A&&A.sun)?A.sun(d):null;
        if(!sun||sun.altDeg<=0) continue;
        const ghi=clearSkyGHI(sun.altDeg,cloud);
        if(ghi<=0) continue;
        const r=incidentSolar(cell,d,{ sun, cloud, ghi, mask:shadowMask(cell,d) });
        dayWh    += r.total*dtH;     // Wh/m² this step
        dayGhiWh += ghi*dtH;
      }
      const moKwh = dayWh*dim/1000;          // representative day → whole month, kWh/m²
      const moGhi = dayGhiWh*dim/1000;
      poaWhYr += dayWh*dim;
      by_month.push({ month:mo+1, kwh_m2:+moKwh.toFixed(2), ghi_kwh_m2:+moGhi.toFixed(2) });
    }
    return { poa_kwh_m2:+(poaWhYr/1000).toFixed(1), by_month };
  }
  // public: sweep tilt, pick the best, and return the system-level annual figure.
  function roofSolar(opts){
    if(_roofSolarCache && !(opts&&opts.fresh)) return _roofSolarCache;
    const E=DATA.energy||{}; const cfg=E.roof||{};
    const eff = (cfg.module_eff!=null)?cfg.module_eff:0.20;
    const pr  = (cfg.performance_ratio!=null)?cfg.performance_ratio:0.80;
    const tariff=(cfg.tariff_nis_per_kwh!=null)?cfg.tariff_nis_per_kwh:0.65;
    const co2k =(cfg.grid_co2_kg_per_kwh!=null)?cfg.grid_co2_kg_per_kwh:0.6;
    // clear-sky calibration (H6): with the M3 altitude/turbidity fix, clearSkyGHI
    // now integrates to ~2,150 kWh/m²/yr horizontal (Larkmont TMY band) on its own, so
    // the old ~1.30 fudge would OVER-predict. Default is now 1.0 (no fudge); the PV
    // POA is physically calibrated. Kept as a tunable knob (energy.json) for matching
    // a specific real installation. Horizon-loss is a ratio so it is unaffected.
    const cal = (cfg.ghi_calibration!=null)?cfg.ghi_calibration:1.0;
    const gross = _ROOF.slabs.reduce((s,sl)=>s+sl.w*sl.d,0);
    const usable = (cfg.usable_area_m2_override!=null)?cfg.usable_area_m2_override
                  : gross*((cfg.usable_fraction!=null)?cfg.usable_fraction:0.6);
    const tilts = (Array.isArray(cfg.tilt_sweep_deg)&&cfg.tilt_sweep_deg.length)?cfg.tilt_sweep_deg:[0,5,10,15,20];

    // POA for a slab+tilt is area-weighted across the two slabs (same skyline,
    // different SVF/shadow). We march each slab once per tilt and area-weight.
    let best=null;
    for(const t of tilts){
      let poaW=0, gross_t=0;
      const monthAcc=Array.from({length:12},(_,i)=>({month:i+1,kwh_m2:0,ghi_kwh_m2:0}));
      for(const sl of _ROOF.slabs){
        const r=_poaYearForTilt(sl,t); const a=sl.w*sl.d;
        poaW += r.poa_kwh_m2*a; gross_t+=a;
        r.by_month.forEach((m,i)=>{ monthAcc[i].kwh_m2+=m.kwh_m2*a; monthAcc[i].ghi_kwh_m2+=m.ghi_kwh_m2*a; });
      }
      const poa_kwh_m2 = poaW/gross_t;                       // area-weighted POA
      const by_month_m2 = monthAcc.map(m=>({ month:m.month,
        poa_kwh_m2:+(m.kwh_m2/gross_t).toFixed(2),
        ghi_kwh_m2:+(m.ghi_kwh_m2/gross_t).toFixed(2) }));
      if(!best || poa_kwh_m2>best.poa_kwh_m2) best={ tilt:t, poa_kwh_m2, by_month_m2 };
    }

    // flat-horizon reference (no terrain/parapet/neighbour shading) to report the
    // hyper-local penalty: rerun the BEST tilt with mask forced to 1 (sun-up only).
    let flatPoa=best.poa_kwh_m2;
    {
      const A=(typeof window!=='undefined')&&window.Astro;
      let poaW=0, gross_t=0;
      for(const sl of _ROOF.slabs){
        const cell=_roofCell(sl,best.tilt); const a=sl.w*sl.d; gross_t+=a;
        let whYr=0;
        for(let mo=0;mo<12;mo++){
          const clim=SEASON_CLIM[_seasonOf(new Date(SEASON_YEAR,mo,15))];
          const cloud=clim?clim.cloud:0.12;
          const dim=new Date(SEASON_YEAR,mo+1,0).getDate();
          let dayWh=0;
          for(let min=0;min<1440;min+=20){
            const d=new Date(SEASON_YEAR,mo,15,0,0,0); d.setMinutes(min);
            const sun=(A&&A.sun)?A.sun(d):null;
            if(!sun||sun.altDeg<=0) continue;
            const ghi=clearSkyGHI(sun.altDeg,cloud); if(ghi<=0) continue;
            const r=incidentSolar(cell,d,{ sun, cloud, ghi, mask:1 });   // no shading
            dayWh += r.total*(20/60);
          }
          whYr+=dayWh*dim;
        }
        poaW += (whYr/1000)*a;
      }
      flatPoa = poaW/gross_t;
    }
    const horizon_loss_pct = flatPoa>0 ? Math.max(0,+(100*(1-best.poa_kwh_m2/flatPoa)).toFixed(1)) : 0;

    const poaCal     = best.poa_kwh_m2 * cal;          // calibrated POA for the PV figure
    const annual_kwh = poaCal * usable * eff * pr;
    const peak_kw    = usable * eff * 1.0;     // STC 1 kW/m² → DC kWp
    const by_month   = best.by_month_m2.map(m=>({
      month:m.month, ghi_kwh_m2:m.ghi_kwh_m2,
      kwh:+(m.poa_kwh_m2*cal*usable*eff*pr).toFixed(0) }));

    _roofSolarCache = {
      annual_kwh:+annual_kwh.toFixed(0),
      peak_kw:+peak_kw.toFixed(2),
      usable_area_m2:+usable.toFixed(1),
      gross_area_m2:+gross.toFixed(1),
      best_tilt_deg:best.tilt,
      best_azimuth_deg:180, best_azimuth_he:'south',
      poa_kwh_m2_yr:+poaCal.toFixed(0),
      pr, module_eff:eff,
      by_month,
      co2_t_per_year:+((annual_kwh*co2k)/1000).toFixed(2),
      savings_nis_per_year:+(annual_kwh*tariff).toFixed(0),
      horizon_loss_pct,
      estimate:true,
      note_he:'physics-based estimate from the model — not a measurement, not Google Solar'
    };
    return _roofSolarCache;
  }

  /* ====================================================================
     §8 LIVING RECORD — Derive.recordDay(zone, dateISO, hourlyWxForDay)
     ----------------------------------------------------------------------
     The day-by-day LOGBOOK counterpart of _bakeSeason: instead of marching a
     representative climatological day, it marches the ACTUAL measured hourly
     weather for ONE real date (from RecordApi.fetchRange → splitByDay) through
     this zone's REAL shadow/incidence geometry, and accumulates that day's
     per-zone totals.

       measured (real, Open-Meteo)  : temp, rad(→DLI), et0, precip, cloud, wind, rh, soilT
       modeled  (his geometry)      : shadowMask, incidentSolar, surfaceTemp per the rep cell

     hourlyWxForDay = { times:[ISO…], temp:[], rad:[], et0:[], precip:[],
                        cloud:[], wind:[], rh:[], soilT:[] } — UTC hourly arrays
     (RecordApi requests timezone=GMT, so each time is "YYYY-MM-DDTHH:00"; we
     append "Z" to get the correct absolute instant for Astro.sun()).

     Returns the frozen dayRecord:
       { date, zoneId, tMin, tMax, tMean, frost, frostLow, dli, sunHours,
         gddInc, chillInc, et0, etc, rainMm, surfPeak, windMax, measured:true }

       · GDD     base 10 °C, capped at 30 °C: max(0, min(30,tMean)−10)
       · chill   hours with measured air temp in 0–7 °C
       · DLI     Σ PPFD·Δt /1e6, PPFD ≈ 2.02 μmol/W·s on the cell's INCIDENT
                 solar (measured GHI reshaped by shadowMask + POA geometry)
       · sunHours beam-lit minutes/60 (sun up, above his real ridge, cell unshaded)
       · etc     measured ET0 scaled by the cell's solar capture vs open sky
                 (kept on the same fraction _bakeSeason uses), fallback to ET0
       · surfPeak modeled peak surface (gravel) temp from the energy balance
     ==================================================================== */
  function _zid(zone){ return (zone&&typeof zone==='object') ? (zone.id||zone.zoneId) : zone; }
  function recordDay(zone, dateISO, wx){
    const A=(typeof window!=='undefined')&&window.Astro;
    const zoneId=_zid(zone)||'backyard';
    const date=String(dateISO||'').slice(0,10);
    const cell=_repCell(zoneId);
    const out={ date, zoneId, tMin:null, tMax:null, tMean:null, frost:false,
                frostLow:null, dli:0, sunHours:0, gddInc:0, chillInc:0,
                et0:0, etc:0, rainMm:0, surfPeak:null, windMax:null, measured:true };
    if(!wx || !Array.isArray(wx.times) || !wx.times.length || !cell) return out;

    const svf=skyViewFactor(cell), expo=windExposure(cell);
    const n=wx.times.length;
    let sumT=0,cntT=0, tMin=Infinity,tMax=-Infinity, frostLow=Infinity, frost=false;
    let dliSum=0, sunMin=0, chillH=0, et0Sum=0, etcSum=0, rainSum=0;
    let surfPeak=-Infinity, windMax=-Infinity;
    let ghiOpenSum=0, ghiCellSum=0;
    // the measured cadence: usually 1 h. derive the step from the first gap so
    // an unusual cadence (e.g. some endpoints' 3 h) still integrates correctly.
    let stepH=1;
    if(n>=2){
      const t0=new Date(String(wx.times[0])+'Z').getTime();
      const t1=new Date(String(wx.times[1])+'Z').getTime();
      const dh=(t1-t0)/3600000; if(isFinite(dh)&&dh>0&&dh<=6) stepH=dh;
    }
    for(let i=0;i<n;i++){
      const tISO=String(wx.times[i]);
      const dd=new Date(tISO.length<=16 ? tISO+'Z' : tISO);   // UTC instant
      if(isNaN(dd.getTime())) continue;
      const air=num(wx.temp,i), cloudPct=num(wx.cloud,i), windKmh=num(wx.wind,i);
      const rh=num(wx.rh,i), radWm2=num(wx.rad,i), soilT=num(wx.soilT,i);
      const et0h=num(wx.et0,i), pr=num(wx.precip,i);
      const cloud=(cloudPct!=null)?clamp01(cloudPct/100):0.1;
      // --- measured air temp accumulation ---
      if(air!=null){ sumT+=air; cntT++; if(air<tMin)tMin=air; if(air>tMax)tMax=air;
        // chill hours: measured air in the 0–7.2 °C Weinberger band (count fractional
        // steps). 7.2 °C matches the seasonal-climate model (siteHeatChill, line ~1031). (L5)
        if(air>=0 && air<=7.2) chillH+=stepH;
        // frost screen: lowest measured air; flag if it touched/dipped ≤0 °C
        if(air<frostLow) frostLow=air;
        if(air<=0) frost=true;
      }
      if(windKmh!=null && windKmh>windMax) windMax=windKmh;
      if(et0h!=null) et0Sum+=et0h;
      if(pr!=null) rainSum+=pr;
      // --- geometry-modeled solar reshaping (only meaningful when sun is up) ---
      const sun=(A&&A.sun)?A.sun(dd):null;
      if(sun && sun.altDeg>0 && sun.altDeg>horizonAt(sun.azDeg)){
        const mask=shadowMask(cell,dd,true);          // honour ridge+blocks; keep open backyard
        // drive incidentSolar with the MEASURED GHI (radWm2). When rad is missing
        // (archive gap on a cell), fall back to the clear-sky model for that hour.
        const ghi=(radWm2!=null)?Math.max(0,radWm2):clearSkyGHI(sun.altDeg,cloud);
        const inc=incidentSolar(cell,dd,{sun,cloud,ghi,mask});
        if(mask>0) sunMin+=stepH*60;
        // DLI: PAR photons on the cell over this step
        dliSum+=PPFD_PER_WM2*inc.total*stepH*3600;
        const ghiOpen=(radWm2!=null)?Math.max(0,radWm2):clearSkyGHI(sun.altDeg,cloud);
        ghiOpenSum+=ghiOpen*stepH; ghiCellSum+=inc.total*stepH;
        // modeled peak surface temp (hot gravel ground reading) driven by the
        // measured air/rh/cloud/wind/soil for this real hour. lag:false — the
        // hourly march already resolves the diurnal curve.
        const Ts=surfaceTemp(cell.normal,dd,{
          airC:(air!=null?air:undefined), rh:(rh!=null?rh:undefined), cloud,
          windKmh:(windKmh!=null?windKmh:undefined), material:'gravel',
          sun, cell, mask, svf, exposure:expo,
          soilT:(soilT!=null?soilT:undefined), rad:ghi, lag:false });
        if(Ts!=null && Ts>surfPeak) surfPeak=Ts;
      }
    }
    const tMean=cntT? (sumT/cntT) : null;
    // ETc: measured ET0 scaled by the cell's solar capture vs open sky (same
    // fraction shape _bakeSeason uses); if we never saw daytime, fall back to ET0.
    const solFrac=ghiOpenSum>0?clamp01(ghiCellSum/ghiOpenSum):null;
    if(et0Sum>0){
      etcSum=(solFrac!=null)? et0Sum*clamp(0.3+0.7*solFrac,0.2,1.1) : et0Sum;
    }
    // GDD base 10, cap 30 (from the day's MEASURED mean air temp)
    const gdd=(tMean!=null)? Math.max(0, Math.min(30,tMean)-10) : 0;

    out.tMin   = (tMin===Infinity)? null : +tMin.toFixed(1);
    out.tMax   = (tMax===-Infinity)? null : +tMax.toFixed(1);
    out.tMean  = (tMean!=null)? +tMean.toFixed(1) : null;
    out.frost  = frost;
    out.frostLow = (frostLow===Infinity)? null : +frostLow.toFixed(1);
    out.dli    = +(dliSum/1e6).toFixed(2);
    out.sunHours = +(sunMin/60).toFixed(2);
    out.gddInc = +gdd.toFixed(2);
    out.chillInc = +chillH.toFixed(1);
    out.et0    = +et0Sum.toFixed(2);
    out.etc    = +etcSum.toFixed(2);
    out.rainMm = +rainSum.toFixed(2);
    out.surfPeak = (surfPeak===-Infinity)? null : +surfPeak.toFixed(1);
    out.windMax  = (windMax===-Infinity)? null : +windMax.toFixed(1);
    return out;
  }
  // tiny null-safe array reader (NaN/undefined → null) shared by recordDay
  function num(a,i){ const v=a&&a[i]; return (v==null||(typeof v==='number'&&!isFinite(v)))?null:v; }

  /* ===================================================================
     SHARED ROOM-WARMTH MODEL (§C.3b) — ONE source for the lean a room has
     vs the whole-house base interior temp. Previously duplicated inside
     workbench.js (warmthScore + climateSummary); now room labels, the
     workbench climate card, AND the per-room history kernel all read these,
     so they can never drift apart.

       geom = { floor:'ground'|'upper', x0,x1,z0,z1, … }  (window.__enterMode.roomGeom)

     A room's warmth SCORE rises with: being on the upper floor (under the
     hot roof) and with each sun-exposed exterior wall (W hottest → N none).
     The interior-temp OFFSET (°C) is that room's score minus the house mean
     score, ×0.45 — exactly the constant the workbench card uses. This is a
     small geometric LEAN on top of the modeled whole-house base; honest as
     a model (no per-room sensor). =================================================== */
  const ROOM_ASPECT_HEAT={W:2.0,S:1.5,E:0.9,N:0.0};
  const ROOM_BX=8.41, ROOM_BXS=10.50, ROOM_BZ=7.20;   // L-shaped footprint bands
  function roomAspectDirs(g){
    if(!g) return []; const ext=[], e=0.06;
    if(g.z0<=e) ext.push('W');
    if(g.z1>=ROOM_BZ-e) ext.push('E');
    if(g.x0<=e) ext.push('S');
    const xmax=(g.z0>=3.6-e)?ROOM_BXS:ROOM_BX;
    if(g.x1>=xmax-e) ext.push('N');
    return ext;
  }
  // 0 = no solar/roof lean … higher = warmer-leaning room.
  function roomWarmth(g){
    if(!g) return 0;
    let s=(g.floor==='upper')?2.0:0;
    roomAspectDirs(g).forEach(d=>s+=ROOM_ASPECT_HEAT[d]||0);
    return s;
  }
  // interior-temp OFFSET (°C) of THIS room vs the whole-house base, given the set
  // of all room geoms (so "mean" is the house mean). allGeoms = [{id,geom}] or
  // [geom]; tolerant of either. Returns a small signed °C lean (±~1.5°).
  function roomTempOffset(g, allGeoms){
    if(!g) return 0;
    let sum=0, cnt=0;
    if(Array.isArray(allGeoms)){
      for(const e of allGeoms){ const gg=(e&&e.geom)?e.geom:e; if(gg){ sum+=roomWarmth(gg); cnt++; } }
    }
    const mean=cnt?sum/cnt:roomWarmth(g);
    return Math.round((roomWarmth(g)-mean)*0.45*10)/10;
  }

  /* ===================================================================
     roomDay(roomId, dateISO, wx, geom) — per-ROOM LOGBOOK kernel (§C.3b).
     The room-scale counterpart of recordDay: march the ACTUAL measured
     hourly OUTDOOR air (wx.temp[], same Open-Meteo arrays recordDay marches)
     through the SAME heavy-mass EMA used by indoorTemp (INDOOR_TAU_H), to
     reconstruct that room's MODELED indoor-air curve for the day, then apply
     the room's geometric warmth LEAN (roomTempOffset). Accumulate the day's
     comfort/risk stats from the modeled indoor curve.

       measured (real, Open-Meteo) : outdoor air temp (drives the model)
       modeled  (his geometry)     : heavy-mass damping + per-room warmth lean

     measured:true here means "MEASURED outdoor air, propagated through the
     modeled house mass + room geometry" — the SAME honesty contract recordDay
     uses (the indoor air itself is MODELED; never a room sensor).

     Returns the frozen room-day shape:
       { date, roomId, tMin, tMax, tMean, hoursAbove28, hoursBelow18,
         comfortHours, condensationRiskDays, measured:true }
       · comfort band 18–28 °C (modeled indoor air)
       · condensationRiskDays: 1 if the modeled indoor min dips below the
         winter indoor dew point (~9.3°, room of 20°/55%) on a cold day, else 0
     `geom` defaults to window.__enterMode.roomGeom(roomId) when omitted, and
     `allGeoms` for the house mean is derived from the same source. Never throws.
     =================================================================== */
  function _allRoomGeoms(){
    const out=[];
    try{
      const EM=(typeof window!=='undefined')&&window.__enterMode;
      const WB=(typeof window!=='undefined')&&window.__workbench;
      if(EM&&EM.roomGeom&&WB&&WB._doc){
        const doc=WB._doc(); const rooms=doc&&doc.rooms?Object.keys(doc.rooms):[];
        for(const id of rooms){ const g=EM.roomGeom(id); if(g) out.push(g); }
      }
    }catch(e){}
    return out;
  }
  function roomDay(roomId, dateISO, wx, geom){
    const date=String(dateISO||'').slice(0,10);
    let g=geom;
    if(!g){
      try{ const EM=(typeof window!=='undefined')&&window.__enterMode;
        if(EM&&EM.roomGeom) g=EM.roomGeom(roomId); }catch(e){}
    }
    const out={ date, roomId:roomId||null, tMin:null, tMax:null, tMean:null,
                hoursAbove28:0, hoursBelow18:0, comfortHours:0,
                condensationRiskDays:0, measured:true };
    if(!wx || !Array.isArray(wx.times) || !wx.times.length) return out;

    // derive the cadence from the first gap (usually 1 h; tolerate 3 h archive).
    const n=wx.times.length;
    let stepH=1;
    if(n>=2){
      const t0=new Date(String(wx.times[0])+'Z').getTime();
      const t1=new Date(String(wx.times[1])+'Z').getTime();
      const dh=(t1-t0)/3600000; if(isFinite(dh)&&dh>0&&dh<=6) stepH=dh;
    }
    // the heavy-mass EMA: same time-constant as indoorTemp. Walk OLD→NEW so the
    // weighting is causal. We have the day's measured outdoor air directly (no
    // need to reconstruct from climatology — recordDay's `wx.temp[]` is real).
    const alpha=1-Math.exp(-stepH/INDOOR_TAU_H);
    // the geometric room lean (one number for the whole day).
    const offset=roomTempOffset(g, _allRoomGeoms());
    // winter indoor dew point of a heated room (matches workbench's 20°/55°): a
    // surface/air fogging proxy. dewPoint() lives in this module.
    let indoorDew=10.7; try{ const dp=dewPoint(20,55); if(dp!=null&&isFinite(dp)) indoorDew=dp; }catch(e){}  // 10.7 = Magnus dewPoint(20,55) (L4)

    let ema=null;
    let sum=0,cnt=0, tMin=Infinity,tMax=-Infinity;
    let above=0,below=0,comfort=0;
    let coldDay=false, dipBelowDew=false;
    for(let i=0;i<n;i++){
      const air=num(wx.temp,i);
      if(air==null) continue;
      if(air<8) coldDay=true;                          // a genuinely cold (winter) day
      ema=(ema==null)?air:ema+alpha*(air-ema);         // modeled indoor (house base)
      const roomT=ema+offset;                          // + per-room geometric lean
      sum+=roomT; cnt++;
      if(roomT<tMin) tMin=roomT;
      if(roomT>tMax) tMax=roomT;
      if(roomT>28) above+=stepH;
      else if(roomT<18) below+=stepH;
      else comfort+=stepH;
      if(roomT<=indoorDew+0.5) dipBelowDew=true;
    }
    if(coldDay && dipBelowDew) out.condensationRiskDays=1;
    out.tMin   = (tMin===Infinity)? null : +tMin.toFixed(1);
    out.tMax   = (tMax===-Infinity)? null : +tMax.toFixed(1);
    out.tMean  = cnt? +(sum/cnt).toFixed(1) : null;
    out.hoursAbove28 = +above.toFixed(1);
    out.hoursBelow18 = +below.toFixed(1);
    out.comfortHours = +comfort.toFixed(1);
    return out;
  }

  return { ready, get data(){return DATA;}, LAT, LON, horizonAt, sunAboveRidge, zoneState, radiation,
           microclimate, houseTempDelta, dewPoint, feelsLike, frostRisk,
           goOutScore, shadeSchedule, sunEvents, nextMeteor, nextDarkNight, galacticCore, twilightTimes, zodiacalLight, overnightPasses, zodiacChart, ascendant, energyNow, fetchSightings, fetchObservations,
           surfaceTemp, surfaceTempAtPoint, makeHouseCell, classifyHouseFace, indoorTemp, tempColor,
           // ---- new microclimate → planting API (§6) ----
           cellGrid, skyViewFactor, windExposure, shadowMask, incidentSolar,
           cellProfile, airDelta, rankPlantsForCell, bestCellForPlant,
           scoreCandidateCell, bestCellForCandidate, siteHeatChill,
           // ---- roof + solar potential (§7) ----
           roofSolar,
           // ---- living record (§8): one real measured day → per-zone totals ----
           recordDay,
           // ---- shared room-warmth model + per-ROOM logbook kernel (§C.3b) ----
           roomWarmth, roomTempOffset, roomDay };
})();
window.Derive=Derive;
