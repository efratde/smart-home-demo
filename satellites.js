/* ===================================================================
   satellites.js — real low-Earth-orbit satellites on the sky dome.

   Drives the ISS (and two more bright sats) from CURRENT TLEs via the
   satellite.js SGP4 propagator, for whatever date/time the scrubber is
   showing. For each sat we:
     • propagate the TLE → ECI position (km)        [satellite.propagate]
     • ECI → ECF using GMST                          [gstime + eciToEcf]
     • ECF → observer look-angles (az, el, range)    [ecfToLookAngles]
   giving azimuth (from north, clockwise) and elevation == altitude, in
   exactly the convention Astro.vec(az,alt) expects, so the dome mapping
   is identical to the Moon/planets in sky.js.

   We also sample the CURRENT-or-NEXT visible pass (horizon→peak→horizon)
   into an az/alt polyline for the trajectory arc, and compute genuine
   naked-eye visibility (satellite sunlit AND observer in darkness) so
   visible passes can be emphasised.

   ── ACCURACY / STALENESS ──────────────────────────────────────────────
   TLEs decay: SGP4 positions are good to ~1 km near the TLE epoch but
   the error grows roughly a few km/day, so PASS TIMES drift by ~tens of
   seconds within a day or two of the epoch and by minutes after a week.
   For best accuracy the TLEs should be refreshed (the live CelesTrak
   fetch does this automatically when CORS allows); the baked fallbacks
   below carry their epoch so staleness is honest and inspectable.
   =================================================================== */
const Satellites = (function(){
  const DEG = 180/Math.PI, RAD = Math.PI/180;

  // ---- BAKED FALLBACK TLEs --------------------------------------------------
  // Used only if the live CelesTrak fetch is CORS-blocked. Each TLE's epoch is
  // encoded in field 4 of line 1 (YYDDD.dddddd). These were captured fresh on
  // 2026-06-06 (epoch day ~157 of 2026); accuracy degrades over days/weeks —
  // see the staleness note at the top of this file. NORAD ids: ISS 25544,
  // CSS/Tiangong 48274, Starlink-1019 (a representative bright Starlink) 44724.
  const FALLBACK = [
    { id:25544, he:'תחנת החלל הבינלאומית', short:'ISS', color:0xffe9b0,
      l1:'1 25544U 98067A   26157.22459382  .00054840  00000+0  97346-3 0  9998',
      l2:'2 25544  51.6331 354.3683 0007056 137.0383 223.1158 15.49647679570604' },
    { id:48274, he:'תחנת החלל הסינית', short:'CSS', color:0xc8d8ff,
      l1:'1 48274U 21035A   26157.09777053  .00028689  00000+0  34274-3 0  9990',
      l2:'2 48274  41.4693  29.4663 0009357 351.5849   8.4832 15.60328974291432' },
    { id:44724, he:'סטארלינק', short:'Starlink', color:0xbfe0ff,
      l1:'1 44724U 19074M   26157.17801880  .00057912  00000+0  18898-2 0  9994',
      l2:'2 44724  53.0475 120.8383 0005187  32.7405 327.3915 15.31238234362499' }
  ];

  // observer geodetic position (RADIANS lat/lon, km height) — Alex's plot.
  // Pulled from Astro.LAT/LON (single source of truth, set at load).
  const OBS = { latitude:Astro.LAT*RAD, longitude:Astro.LON*RAD, height:0.30 };  // Larkmont ≈ 300 m
  const EARTH_R = 6371;                                   // km, for shadow test

  let sats = [];            // [{id,he,short,color,satrec,ok}]
  let ready = false;
  let source = 'pending';   // 'live' | 'fallback' | 'pending' | 'error'

  // az/alt (radians) → world dome direction, IDENTICAL to Astro's internal vec()
  // (+x=east, +y=up, +z=SOUTH), so satellites map onto the dome exactly like the
  // Moon/planets. Inlined (Astro.vec is private) to keep this module self-contained.
  function vec(az, alt){
    const ca = Math.cos(alt);
    return { x: Math.sin(az)*ca, y: Math.sin(alt), z: -Math.cos(az)*ca };
  }

  // build a satrec from a TLE pair; returns null on parse/init failure
  function makeRec(l1, l2){
    if(typeof satellite === 'undefined') return null;
    try {
      const rec = satellite.twoline2satrec(l1, l2);
      if(!rec || rec.error) return null;
      return rec;
    } catch(e){ return null; }
  }

  function loadFrom(list, src){
    sats = list.map(t=>{
      const rec = makeRec(t.l1, t.l2);
      return { id:t.id, he:t.he, short:t.short, color:t.color, satrec:rec, ok:!!rec };
    }).filter(s=>s.ok);
    source = src;
    ready = sats.length>0;
  }

  // ---- INIT: try live CelesTrak, fall back to baked TLEs --------------------
  // CelesTrak sends permissive CORS headers, so the browser fetch usually
  // succeeds; if it's blocked (network/policy) we silently use the fallbacks.
  function init(){
    // seed immediately with fallbacks so the sky is never empty, then upgrade
    loadFrom(FALLBACK, 'fallback');
    const ids = FALLBACK.map(f=>f.id);
    const urls = ids.map(id=>`https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`);
    Promise.all(urls.map(u=>fetch(u).then(r=>r.ok?r.text():Promise.reject(r.status)).catch(()=>null)))
      .then(texts=>{
        const live=[];
        texts.forEach((txt,i)=>{
          const meta=FALLBACK[i];
          if(!txt) return;
          const lines=txt.trim().split('\n').map(s=>s.replace(/\r/g,'').trim());
          // gp.php TLE format: [name, line1, line2]
          const l1=lines.find(s=>s.startsWith('1 '));
          const l2=lines.find(s=>s.startsWith('2 '));
          if(l1&&l2) live.push({ id:meta.id, he:meta.he, short:meta.short, color:meta.color, l1, l2 });
        });
        if(live.length){ loadFrom(live, 'live'); }
      })
      .catch(()=>{ /* keep fallbacks */ });
  }

  // ---- one satellite's look-angles at `date` --------------------------------
  // Returns { altDeg, azDeg, az, alt, dir, rangeKm, eci, sunlit } or null if the
  // SGP4 propagation fails (decayed/expired TLE).
  function lookAngles(rec, date, sunUnit){
    let pv;
    try { pv = satellite.propagate(rec, date); } catch(e){ return null; }
    if(!pv || !pv.position || isNaN(pv.position.x)) return null;
    const eci = pv.position;                       // km, ECI/TEME
    const gmst = satellite.gstime(date);
    const ecf = satellite.eciToEcf(eci, gmst);
    const la = satellite.ecfToLookAngles(OBS, ecf);  // az/el in RADIANS
    const az = la.azimuth, alt = la.elevation;       // az from N clockwise == Astro.vec()
    // sunlit test: satellite is in Earth's shadow if it is on the anti-sun side
    // AND its perpendicular distance from the Earth–Sun axis is < Earth radius.
    let sunlit = true;
    if(sunUnit){
      const dotS = eci.x*sunUnit.x + eci.y*sunUnit.y + eci.z*sunUnit.z;  // km along sun axis
      if(dotS < 0){
        const px = eci.x - dotS*sunUnit.x, py = eci.y - dotS*sunUnit.y, pz = eci.z - dotS*sunUnit.z;
        const perp = Math.sqrt(px*px+py*py+pz*pz);
        if(perp < EARTH_R) sunlit = false;   // inside the cylindrical umbra
      }
    }
    return {
      az, alt, altDeg: alt*DEG, azDeg: ((az*DEG)%360+360)%360,
      dir: vec(az, alt), rangeKm: la.rangeSat, eci, sunlit
    };
  }

  // ---- CURRENT-or-NEXT visible pass ----------------------------------------
  // Scan forward from `date` in coarse steps to find when the sat next clears
  // the horizon (or is already up), then sample the up→peak→down span finely.
  // Returns { samples:[{az,alt,dir,t}], rise, set, peakAlt, peakAz, peakT,
  //           anyVisible } or null if no pass within the search window.
  const MIN_EL = 0*RAD;            // horizon
  function nextPass(rec, date, sunUnit){
    const t0 = date.getTime();
    const stepCoarse = 30*1000;     // 30 s scan
    const horizonH = 18*3600*1000;  // search up to 18 h ahead
    // find a rise (alt crosses 0 upward) or detect we're already above horizon
    let tRise=null, prevAlt=null, prevT=null;
    let alreadyUp=false;
    for(let t=t0; t<=t0+horizonH; t+=stepCoarse){
      const la=lookAngles(rec, new Date(t), null);
      if(!la) return null;
      const a=la.alt;
      if(t===t0 && a>MIN_EL){ alreadyUp=true; tRise=t; break; }
      if(prevAlt!==null && prevAlt<MIN_EL && a>=MIN_EL){ tRise=prevT; break; }
      prevAlt=a; prevT=t;
    }
    if(tRise===null) return null;

    // if already up, walk BACK to the true rise so the arc starts at the horizon
    if(alreadyUp){
      let t=t0;
      while(t>t0-horizonH){
        const a=lookAngles(rec,new Date(t-stepCoarse),null);
        if(!a || a.alt<MIN_EL){ tRise=t-stepCoarse; break; }
        t-=stepCoarse;
      }
    }
    // refine rise to ~1 s with bisection between [tRise, tRise+stepCoarse]
    let lo=tRise, hi=tRise+stepCoarse;
    for(let i=0;i<8;i++){ const mid=(lo+hi)/2; const a=lookAngles(rec,new Date(mid),null).alt;
      if(a<MIN_EL) lo=mid; else hi=mid; }
    const riseT=hi;

    // find set (next downward crossing after rise) by coarse scan + bisection
    let tSet=null; prevAlt=null; prevT=null;
    for(let t=riseT; t<=riseT+horizonH; t+=stepCoarse){
      const a=lookAngles(rec,new Date(t),null).alt;
      if(prevAlt!==null && prevAlt>=MIN_EL && a<MIN_EL){ tSet=prevT; break; }
      prevAlt=a; prevT=t;
    }
    if(tSet===null) tSet=riseT+stepCoarse;   // degenerate, keep tiny arc
    lo=tSet; hi=tSet+stepCoarse;
    for(let i=0;i<8;i++){ const mid=(lo+hi)/2; const a=lookAngles(rec,new Date(mid),null).alt;
      if(a>=MIN_EL) lo=mid; else hi=mid; }
    const setT=lo;

    // sample the pass finely between rise and set
    const N=64, samples=[]; let peakAlt=-90, peakAz=0, peakT=riseT, anyVisible=false;
    for(let i=0;i<=N;i++){
      const t=riseT + (setT-riseT)*i/N;
      const la=lookAngles(rec,new Date(t), sunUnit);
      if(!la) continue;
      const obsAlt = Astro.sun(new Date(t)).altDeg;   // observer's sun altitude
      const vis = la.sunlit && obsAlt < -4 && la.altDeg > 5;  // genuine naked-eye pass point
      if(vis) anyVisible=true;
      samples.push({ az:la.azDeg, alt:la.altDeg, dir:la.dir, t, sunlit:la.sunlit, vis });
      if(la.altDeg>peakAlt){ peakAlt=la.altDeg; peakAz=la.azDeg; peakT=t; }
    }
    return { samples, rise:riseT, set:setT, peakAlt, peakAz, peakT, anyVisible };
  }

  // compass direction (Hebrew) from azimuth degrees
  const DIRS=['צפון','צ-מז','מזרח','ד-מז','דרום','ד-מע','מערב','צ-מע'];
  function dirHe(azDeg){ return DIRS[Math.round((azDeg%360)/45)%8]; }

  function isReady(){ return ready; }
  function getSource(){ return source; }
  function epochNote(){
    // human note for the active TLE set
    return source==='live' ? 'TLE חי (CelesTrak)' : 'TLE שמור (06/06/2026)';
  }

  return { init, isReady, getSource, epochNote, lookAngles, nextPass, dirHe,
           OBS, get list(){ return sats; } };
})();
window.Satellites = Satellites;
