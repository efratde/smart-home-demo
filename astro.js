/* ===================================================================
   astro.js — real Sun & Moon position for a given date/place.
   Larkmont — Alex's exact plot: lat 34.0°N, lon -40.0°E.
   Returns horizon coordinates (altitude, azimuth) and a direction
   vector in our world frame: +x = east, +y = up, +z = SOUTH.

   The Sun model is the NOAA "low-precision" solar algorithm: it carries
   the full seasonal terms — solar declination (via the ecliptic longitude
   L, which sweeps ±23.44° over the year) AND the equation of time (baked
   into the hour angle H = local-sidereal-time − right-ascension, where RA
   already contains the obliquity + eccentricity corrections). So azimuth
   and altitude are correct for ANY date and time, not just intra-day.
   Verified noon altitudes at this latitude (see astro.test below):
     summer solstice ≈ 79.4°, equinox ≈ 56.0°, winter solstice ≈ 32.6°.
   =================================================================== */
const Astro = (function(){
  const rad = Math.PI/180, deg = 180/Math.PI;
  const LAT = 34.0, LON = -40.0;

  function julian(date){ return date.getTime()/86400000 + 2440587.5; }
  function days2000(date){ return julian(date) - 2451545.0; }

  // ---- horizon vector in world frame ----
  function vec(az, alt){
    const ca = Math.cos(alt);
    return { x: Math.sin(az)*ca, y: Math.sin(alt), z: -Math.cos(az)*ca };
  }

  // ---- SUN (NOAA simplified) ----
  function sun(date){
    const d = days2000(date);
    const g = (357.529 + 0.98560028*d) * rad;           // mean anomaly
    const q = (280.459 + 0.98564736*d) * rad;           // mean longitude
    const L = q + (1.915*Math.sin(g) + 0.020*Math.sin(2*g)) * rad; // ecliptic lon
    const e = (23.439 - 0.00000036*d) * rad;            // obliquity
    const RA = Math.atan2(Math.cos(e)*Math.sin(L), Math.cos(L));
    const Dec = Math.asin(Math.sin(e)*Math.sin(L));
    // sidereal
    const GMST = (280.46061837 + 360.98564736629*d) % 360;
    const LST = ((GMST + LON) % 360) * rad;
    const H = LST - RA;
    const lat = LAT*rad;
    const alt = Math.asin(Math.sin(lat)*Math.sin(Dec) + Math.cos(lat)*Math.cos(Dec)*Math.cos(H));
    let az = Math.atan2(Math.sin(H), Math.cos(H)*Math.sin(lat) - Math.tan(Dec)*Math.cos(lat));
    az = az + Math.PI; // from north, clockwise
    // apparent diameter: 0.533° at mean distance, scaled by 1/r where the
    // Earth–Sun distance r = 1 − e·cos(E) ≈ 1 − 0.0167·cos(g) AU. So the disc
    // grows to ~0.542° near perihelion (early Jan) and shrinks to ~0.524° near
    // aphelion (early Jul) — a subtle but real seasonal breathing.
    const rAU = 1 - 0.016709*Math.cos(g);
    const angDiamDeg = 0.533128 / rAU;   // 0.533128 = mean apparent diameter (°)
    return { az, alt, altDeg: alt*deg, azDeg: ((az*deg)%360+360)%360,
             dec: Dec, decDeg: Dec*deg, dir: vec(az,alt), eclLon: L,
             distAU: rAU, angDiamDeg };
  }

  // peak (solar-noon) altitude on the calendar day of `date` — the clearest
  // single readout of the SEASON (declination), independent of the clock.
  function noonAlt(date){
    const day=new Date(date); day.setHours(0,0,0,0);
    let best=-90;
    for(let m=0;m<1440;m+=2){ const a=sun(new Date(day.getTime()+m*60000)).altDeg; if(a>best) best=a; }
    return best;
  }

  // ---- MOON (low precision Meeus) ----
  function moon(date){
    const d = days2000(date);
    const T = d/36525;
    const L0 = (218.316 + 13.176396*d) * rad;  // mean longitude
    const M  = (134.963 + 13.064993*d) * rad;  // mean anomaly (Moon)
    const F  = (93.272  + 13.229350*d) * rad;  // argument of latitude
    const D  = (297.8502 + 12.19074912*d) * rad;  // mean elongation (Moon−Sun)
    const Ms = (357.529 + 0.98560028*d)  * rad;  // mean anomaly (Sun) — for solar-coupled terms
    // Ecliptic longitude: the dominant equation-of-centre term (6.289°) PLUS
    // the three next-largest Meeus perturbations — evection (1.274°),
    // variation (0.658°) and the annual equation (0.186°) — and a few smaller
    // terms. A single term alone leaves the longitude off ~1–2°, which at the
    // sky throws the altitude of a high near-zenith Moon off by ~10°. With these
    // terms the live model matches Skyfield-grade ephemerides to ~0.2° (verified
    // against the 2029-12-20 total-lunar-eclipse opposition: Moon ecliptic lon
    // 89.1° vs Sun 269.3° → 0.3° from exact opposition, as a total eclipse demands).
    const lon = L0
      + 6.289*rad*Math.sin(M)            // equation of centre
      + 1.274*rad*Math.sin(2*D - M)      // evection
      + 0.658*rad*Math.sin(2*D)          // variation
      - 0.186*rad*Math.sin(Ms)           // annual equation
      - 0.059*rad*Math.sin(2*M - 2*D)
      - 0.057*rad*Math.sin(2*D - Ms - M)
      + 0.053*rad*Math.sin(2*D + M)
      + 0.046*rad*Math.sin(2*D - Ms)
      + 0.041*rad*Math.sin(M - Ms)
      - 0.035*rad*Math.sin(D)            // parallactic
      - 0.031*rad*Math.sin(M + Ms);
    // Ecliptic latitude: leading 5.128° term plus the next three Meeus terms,
    // which matter for the declination (and thus altitude) of a high Moon.
    const lat = 5.128*rad*Math.sin(F)
      + 0.281*rad*Math.sin(M + F)
      - 0.278*rad*Math.sin(F - M)
      - 0.173*rad*Math.sin(F - 2*D);
    // distance (km) — standard ELP/Meeus series, dominant terms. Reaches true
    // perigee (~356500 km) and apogee (~406700 km), so the apparent diameter
    // swings the real ~0.49° (apogee) … ~0.56° (perigee). One term alone tops
    // out near 0.547° and never shows a proper "supermoon"; these five do.
    const distKm = 385000.5
      - 20905.355*Math.cos(M)
      -  3699.111*Math.cos(2*D - M)
      -  2955.968*Math.cos(2*D)
      -   569.925*Math.cos(2*M)
      +   246.158*Math.cos(2*D - 2*M);
    const angDiamDeg = 2*Math.atan(1737.4/distKm)*deg;   // ~0.49–0.56°
    const e = (23.439 - 0.00000036*d) * rad;
    // ecliptic -> equatorial
    const sl=Math.sin(lon), cl=Math.cos(lon), sb=Math.sin(lat), cb=Math.cos(lat);
    const RA = Math.atan2(sl*Math.cos(e) - Math.tan(lat)*Math.sin(e), cl);
    const Dec = Math.asin(sb*Math.cos(e) + cb*Math.sin(e)*sl);
    const GMST = (280.46061837 + 360.98564736629*d) % 360;
    const LST = ((GMST + LON) % 360) * rad;
    const H = LST - RA;
    const latr = LAT*rad;
    const alt = Math.asin(Math.sin(latr)*Math.sin(Dec) + Math.cos(latr)*Math.cos(Dec)*Math.cos(H));
    let az = Math.atan2(Math.sin(H), Math.cos(H)*Math.sin(latr) - Math.tan(Dec)*Math.cos(latr));
    az = az + Math.PI;
    // phase from elongation to sun
    const s = sun(date);
    let elong = lon - s.eclLon;
    const illum = (1 - Math.cos(elong)) / 2;
    let frac = (elong/(2*Math.PI)) % 1; if (frac<0) frac+=1;
    const names = ['New Moon','Waxing Crescent','First Quarter','Waxing Gibbous','Full Moon','Waning Gibbous','Last Quarter','Waning Crescent'];
    return { az, alt, altDeg: alt*deg, azDeg:((az*deg)%360+360)%360, dir: vec(az,alt),
             illum, frac, waxing: frac<0.5, name: names[Math.round(frac*8)%8],
             eclLon: lon, distKm, angDiamDeg };
  }

  // ---- LOCAL SIDEREAL TIME (radians) for Alex's longitude ----
  // Same GMST series the sun/moon use; exposed so the starfield can map
  // catalog RA/Dec → local alt/az and rotate correctly through the night
  // and across the seasons.
  function lstRad(date){
    const d = days2000(date);
    const GMST = (280.46061837 + 360.98564736629*d) % 360;
    return ((((GMST + LON) % 360) + 360) % 360) * rad;
  }
  function lstHours(date){ return ((lstRad(date)*deg/15)%24+24)%24; }

  // ---- PLANETS (naked-eye: Mercury..Saturn) -----------------------------
  // Low-precision heliocentric Kepler elements (Standish / JPL "Keplerian
  // Elements for Approximate Positions", J2000 epoch; a in AU, angles in deg,
  // rates per Julian century). We compute each planet's + Earth's heliocentric
  // ecliptic xyz, difference to get the GEOCENTRIC ecliptic vector, rotate by
  // the obliquity to equatorial, then run the SAME hour-angle/lat transform the
  // stars use → identical sky frame. Apparent magnitude from the standard
  // phase-angle photometric formulas. Verified vs JPL Horizons (2026-06-06):
  //   Mars RA 2.721h/Dec15.21° (JPL 2.721h/15.22°), Jupiter 7.778h/21.59°,
  //   Venus mag −3.99 (JPL −3.97), Saturn mag 0.98 (JPL 0.86) — arcmin-level.
  //   a,        e,         i,          L(meanLon), ϖ(lonPeri), Ω(lonNode)  + per-century rates
  const PLAN_EL = {
    Mercury:[0.38709927,0.20563593,7.00497902,252.25032350,77.45779628,48.33076593,
             0.00000037,0.00001906,-0.00594749,149472.67411175,0.16047689,-0.12534081],
    Venus:  [0.72333566,0.00677672,3.39467605,181.97909950,131.60246718,76.67984255,
             0.00000390,-0.00004107,-0.00078890,58517.81538729,0.00268329,-0.27769418],
    Earth:  [1.00000261,0.01671123,-0.00001531,100.46457166,102.93768193,0.0,
             0.00000562,-0.00004392,-0.01294668,35999.37244981,0.32327364,0.0],
    Mars:   [1.52371034,0.09339410,1.84969142,-4.55343205,-23.94362959,49.55953891,
             0.00001847,0.00007882,-0.00813131,19140.30268499,0.44441088,-0.29257343],
    Jupiter:[5.20288700,0.04838624,1.30439695,34.39644051,14.72847983,100.47390909,
             -0.00011607,-0.00013253,-0.00183714,3034.74612775,0.21252668,0.20469106],
    Saturn: [9.53667594,0.05386179,2.48599187,49.95424423,92.59887831,113.66242448,
             -0.00125060,-0.00050991,0.00193609,1222.49362201,-0.41897216,-0.28867794]
  };
  // planet display metadata (Hebrew name + colour hint + one fact)
  const PLAN_META = {
    Mercury:{he:'Mercury',color:0xc9b48f,fact:'Closest to the Sun — hard to catch, only near sunrise/sunset.'},
    Venus:  {he:'Venus',    color:0xfff0c8,fact:'The brightest body in the sky after the Sun and Moon — the "Evening/Morning Star".'},
    Mars:   {he:'Mars',     color:0xff7043,fact:'The Red Planet — its colour comes from iron-oxide dust.'},
    Jupiter:{he:'Jupiter',  color:0xf3e0c0,fact:'The gas giant — binoculars reveal the four Galilean moons.'},
    Saturn: {he:'Saturn',   color:0xead7a0,fact:'Its rings are visible even in a small telescope.'}
  };
  function kepler(M, e){
    M = ((M % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI); if(M>Math.PI) M-=2*Math.PI;
    let E = M + e*Math.sin(M);
    for(let i=0;i<10;i++){ const dE=(E - e*Math.sin(E) - M)/(1 - e*Math.cos(E)); E-=dE; if(Math.abs(dE)<1e-9) break; }
    return E;
  }
  // heliocentric ecliptic xyz (AU) of a planet at centuries-since-J2000 T
  function helioXYZ(name, T){
    const el=PLAN_EL[name];
    const a=el[0]+el[6]*T, e=el[1]+el[7]*T, I=(el[2]+el[8]*T)*rad,
          L=(el[3]+el[9]*T)*rad, wbar=(el[4]+el[10]*T)*rad, Om=(el[5]+el[11]*T)*rad;
    const w=wbar-Om, M=L-wbar, E=kepler(M,e);
    const xp=a*(Math.cos(E)-e), yp=a*Math.sqrt(1-e*e)*Math.sin(E);     // in orbital plane
    const cw=Math.cos(w),sw=Math.sin(w),cO=Math.cos(Om),sO=Math.sin(Om),cI=Math.cos(I),sI=Math.sin(I);
    return {
      x:(cw*cO-sw*sO*cI)*xp + (-sw*cO-cw*sO*cI)*yp,
      y:(cw*sO+sw*cO*cI)*xp + (-sw*sO+cw*cO*cI)*yp,
      z:(sw*sI)*xp + (cw*sI)*yp
    };
  }
  function planetMag(name, r, dist, R){
    // r=planet-sun, dist=planet-earth, R=earth-sun (AU); phase angle i (deg)
    const cosi=(r*r+dist*dist-R*R)/(2*r*dist);
    const i=Math.acos(Math.max(-1,Math.min(1,cosi)))*deg;
    const base=5*Math.log10(r*dist);
    let m;
    switch(name){
      case 'Mercury': m=-0.42+base+0.0380*i-0.000273*i*i+0.000002*i*i*i; break;
      case 'Venus':   m=(i<163.6)?(-4.40+base+0.0009*i+0.000239*i*i-0.00000065*i*i*i):(-4.40+base+0.09); break;
      case 'Mars':    m=-1.52+base+0.016*i; break;
      case 'Jupiter': m=-9.40+base+0.005*i; break;
      case 'Saturn':  m=-8.88+base; break;   // ring brightening ignored (small for our use)
      default: m=base;
    }
    return { m, phase:i };
  }
  function onePlanet(name, date){
    const dd=days2000(date), T=dd/36525;
    const p=helioXYZ(name,T), earth=helioXYZ('Earth',T);
    const gx=p.x-earth.x, gy=p.y-earth.y, gz=p.z-earth.z;     // geocentric ecliptic
    const dist=Math.sqrt(gx*gx+gy*gy+gz*gz);                  // planet-earth
    const r=Math.sqrt(p.x*p.x+p.y*p.y+p.z*p.z);               // planet-sun
    const R=Math.sqrt(earth.x*earth.x+earth.y*earth.y+earth.z*earth.z); // earth-sun
    const eps=(23.439-0.00000036*dd)*rad;
    const xe=gx, ye=gy*Math.cos(eps)-gz*Math.sin(eps), ze=gy*Math.sin(eps)+gz*Math.cos(eps);
    const RA=Math.atan2(ye,xe), Dec=Math.atan2(ze,Math.sqrt(xe*xe+ye*ye));
    const H=lstRad(date)-RA, lat=LAT*rad;
    const alt=Math.asin(Math.sin(lat)*Math.sin(Dec)+Math.cos(lat)*Math.cos(Dec)*Math.cos(H));
    let az=Math.atan2(Math.sin(H), Math.cos(H)*Math.sin(lat)-Math.tan(Dec)*Math.cos(lat)); az+=Math.PI;
    const ph=planetMag(name,r,dist,R), meta=PLAN_META[name];
    return { name, he:meta.he, color:meta.color, fact:meta.fact,
             raHours:((RA*deg/15)%24+24)%24, decDeg:Dec*deg,
             eclLon:Math.atan2(gy,gx),                       // geocentric ecliptic longitude (rad) → zodiac sign
             az, alt, altDeg:alt*deg, azDeg:((az*deg)%360+360)%360, dir:vec(az,alt),
             mag:ph.m, phase:ph.phase, distAU:dist };
  }
  // all five naked-eye planets at `date` (geocentric → local horizon)
  function planets(date){
    return ['Mercury','Venus','Mars','Jupiter','Saturn'].map(n=>onePlanet(n,date));
  }

  // ---- equatorial (RA hours, Dec deg) → local horizon (alt/az + world dir) ----
  // For fixed stars: no parallax, no proper motion at this scale. Uses the
  // SAME hour-angle / lat formulas as sun()/moon() so everything shares one
  // sky frame (+x=E, +y=up, +z=SOUTH).
  function eqToHorizon(raHours, decDeg, date){
    const RA = raHours*15*rad, Dec = decDeg*rad, lat = LAT*rad;
    const H = lstRad(date) - RA;
    const alt = Math.asin(Math.sin(lat)*Math.sin(Dec) + Math.cos(lat)*Math.cos(Dec)*Math.cos(H));
    let az = Math.atan2(Math.sin(H), Math.cos(H)*Math.sin(lat) - Math.tan(Dec)*Math.cos(lat));
    az = az + Math.PI;
    return { az, alt, altDeg: alt*deg, azDeg: ((az*deg)%360+360)%360, dir: vec(az,alt) };
  }
  // convenience alias used by sky.js
  const star = eqToHorizon;

  // ---- SUN as a geocentric EQUATORIAL UNIT VECTOR ----------------------------
  // Used by the satellite layer to decide whether a satellite is sunlit (and
  // hence naked-eye visible while the observer is in darkness). Same NOAA solar
  // model as sun(): ecliptic longitude L (already seasonally correct) → rotate
  // by the obliquity ε to the geocentric EQUATORIAL frame. The result is the
  // INERTIAL (Earth-centred, equator-aligned) unit vector pointing at the Sun:
  //   x = cosL, y = sinL·cosε, z = sinL·sinε    (Sun's ecliptic latitude ≈ 0)
  // This is the standard TEME/ECI-aligned axis the SGP4 ECI positions live in
  // (the small TEME↔true-equator offset is far below naked-eye relevance here).
  function sunEciUnit(date){
    const d = days2000(date);
    const g = (357.529 + 0.98560028*d) * rad;
    const q = (280.459 + 0.98564736*d) * rad;
    const L = q + (1.915*Math.sin(g) + 0.020*Math.sin(2*g)) * rad;
    const e = (23.439 - 0.00000036*d) * rad;
    const sL = Math.sin(L), cL = Math.cos(L);
    return { x: cL, y: sL*Math.cos(e), z: sL*Math.sin(e) };
  }

  // sunrise/sunset hour (approx, for UI) — scan the day.
  // Sunrise/sunset are defined when the Sun's UPPER LIMB touches the horizon,
  // i.e. the geometric centre is 0.833° below it (0.267° solar semidiameter +
  // ~0.566° mean atmospheric refraction). Using the geometric horizon (0°)
  // instead reports the event ~4 min late at sunrise / early at sunset.
  const SUN_HORIZON_DEG = -0.833;
  function events(date){
    const day = new Date(date); day.setHours(0,0,0,0);
    let rise=null, set=null, prev=null;
    for(let m=0;m<=1440;m+=10){
      const t=new Date(day.getTime()+m*60000);
      const a=sun(t).altDeg;
      if(prev!==null && prev<SUN_HORIZON_DEG && a>=SUN_HORIZON_DEG && rise===null) rise=t;
      if(prev!==null && prev>=SUN_HORIZON_DEG && a<SUN_HORIZON_DEG && set===null) set=t;
      prev=a;
    }
    return { rise, set };
  }

  // ---- seasonal self-test (call Astro.selfTest() in the console) ----
  // Confirms the date+time model reproduces the known noon altitudes for
  // this latitude across the year — i.e. full seasonal variation, not just
  // intra-day. Returns the measured peaks so the numbers can be inspected.
  function selfTest(year){
    const Y=year||new Date().getFullYear();
    const summer=noonAlt(new Date(Date.UTC(Y,5,21,9,0,0)));
    const winter=noonAlt(new Date(Date.UTC(Y,11,21,9,0,0)));
    const equinox=noonAlt(new Date(Date.UTC(Y,2,20,9,0,0)));
    const r={ summer:+summer.toFixed(2), winter:+winter.toFixed(2), equinox:+equinox.toFixed(2) };
    const ok = Math.abs(r.summer-79.44)<0.6 && Math.abs(r.winter-32.56)<0.6 && Math.abs(r.equinox-56.0)<0.6;
    console.log('Astro.selfTest @ lat'+LAT+': noon alt — summer',r.summer+'° (≈79.4), equinox',r.equinox+'° (≈56.0), winter',r.winter+'° (≈32.6) →', ok?'PASS':'CHECK');
    return Object.assign(r,{pass:ok});
  }

  return { sun, moon, planets, events, noonAlt, selfTest, lstRad, lstHours, eqToHorizon, star, sunEciUnit, LAT, LON };
})();
window.Astro = Astro;
