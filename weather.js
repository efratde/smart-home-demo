/* ===================================================================
   weather.js — the mood. Pulls live conditions over Larkmont from
   Open-Meteo (no key, CORS-ok), maps them to the scene: cloud cover,
   drifting desert dust, rain, wind. Falls back to clear if offline.
   =================================================================== */
const Weather = (function(){
  const LAT=34.00, LON=-40.00;
  let scene, rain, dust, clouds=[], state, target={cloud:0,rain:0,dust:0,wind:0.3,windDir:0};
  let cur={cloud:0,rain:0,dust:0,wind:0.3,windDir:0};
  // hourly cloud forecast (Open-Meteo). times[] are local ISO strings (timezone=auto);
  // total/low/mid/high are 0..100 % arrays aligned to times[]. tz=IANA name from the API.
  let forecast=null; // {times:[], total:[], low:[], mid:[], high:[], tz}
  // DAILY hazard/maintenance forecast (next ~3 days), pulled on the SAME Open-Meteo
  // call as the hourly clouds so there's one network hit. dTimes[] are YYYY-MM-DD
  // local civil days; the parallel arrays are aligned to it. Feeds the hazard rules
  // in alerts.js (rainIncoming / flashFlood / strongWind / snowIce) — those read the
  // FORECAST, never the scrubbed instant, so a clear "now" can still warn of tomorrow.
  let hazard=null; // {days:[{date,rainMm,rainProb,windMax,gustMax,snowCm,code,tmin}], tz}

  function wmo(code){
    const m={0:'Clear sky',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',
      45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',
      61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',
      71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',
      80:'Light showers',81:'Showers',82:'Violent showers',95:'Thunderstorm',96:'Thunderstorm',99:'Thunderstorm'};
    return m[code]||'—';
  }

  async function fetchLive(){
    try{
      const url=`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`+
        `&current=temperature_2m,relative_humidity_2m,is_day,precipitation,rain,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m`+
        `&timezone=auto`;
      const r=await fetch(url); if(!r.ok) throw 0;
      const j=await r.json(), c=j.current;
      const cloud=clamp01(c.cloud_cover/100), wind=c.wind_speed_10m||6, hum=c.relative_humidity_2m||30;
      const code=c.weather_code, rainAmt=clamp01((c.rain||c.precipitation||0)/4);
      let dust=0;
      if(cloud<0.4 && wind>18 && hum<38) dust=clamp01((wind-16)/30);
      const isRain=(code>=51&&code<=67)||(code>=80&&code<=82)||(code>=95);
      state={ temp:Math.round(c.temperature_2m), code, desc:wmo(code), cloud, rain:isRain?Math.max(0.35,rainAmt):rainAmt,
        dust, wind, windDir:(c.wind_direction_10m||0), hum:Math.round(hum), isDay:c.is_day===1, live:true,
        tz:j.timezone, time:c.time };
      return state;
    }catch(e){
      state={ temp:24, code:0, desc:'Clear sky (offline)', cloud:0.05, rain:0, dust:0.04,
        wind:8, windDir:300, hum:28, isDay:true, live:false };
      return state;
    }
  }
  const clamp01=v=>Math.max(0,Math.min(1,v));

  // ---- hourly cloud forecast (for tonight's stargazing verdict) ----
  // Open-Meteo HOURLY cloud_cover + low/mid/high layers, a couple days out.
  // timezone=auto means the returned hourly.time[] strings are LOCAL wall-clock
  // ISO (e.g. "2026-06-06T21:00"), so we can pick "tonight 21:00–23:00" directly.
  async function fetchForecast(){
    try{
      const url=`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`+
        `&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high`+
        // DAILY hazard fields for the maintenance/hazard alerts (same call, no extra key).
        `&daily=weather_code,precipitation_sum,precipitation_probability_max,`+
          `wind_speed_10m_max,wind_gusts_10m_max,snowfall_sum,temperature_2m_min`+
        `&forecast_days=3&timezone=auto`;
      const r=await fetch(url); if(!r.ok) throw 0;
      const j=await r.json(), h=j.hourly||{}, d=j.daily||{};
      forecast={ times:h.time||[], total:h.cloud_cover||[], low:h.cloud_cover_low||[],
        mid:h.cloud_cover_mid||[], high:h.cloud_cover_high||[], tz:j.timezone };
      // assemble the daily hazard array (one row per civil day the API returned).
      const dt=d.time||[];
      const days=dt.map((date,i)=>({
        date,
        rainMm: num(d.precipitation_sum,i),
        rainProb: num(d.precipitation_probability_max,i),
        windMax: num(d.wind_speed_10m_max,i),
        gustMax: num(d.wind_gusts_10m_max,i),
        snowCm:  num(d.snowfall_sum,i),   // Open-Meteo snowfall_sum is in cm
        code:    num(d.weather_code,i),
        tmin:    num(d.temperature_2m_min,i)
      }));
      hazard={ days, tz:j.timezone };
      return forecast;
    }catch(e){ forecast=null; hazard=null; return null; }
  }
  // safe array read → number or null (never undefined/NaN leaking into the rules).
  function num(arr,i){ const v=arr&&arr[i]; return (v==null||isNaN(v))?null:v; }

  // DAILY hazard/maintenance forecast → array of {date,rainMm,rainProb,windMax,
  // gustMax,snowCm,code,tmin} for the next ~3 days (today first). null if not loaded.
  // Read by the alerts.js hazard rules. `days` optionally caps how many rows back.
  function hazardForecast(days){
    if(!hazard||!hazard.days||!hazard.days.length) return null;
    const arr=hazard.days;
    return (days&&days>0)? arr.slice(0,days) : arr.slice();
  }

  // ---- live AIR QUALITY (Open-Meteo air-quality API; no key, CORS) ----
  // PM2.5/PM10, European AQI, airborne DUST mass, UV — relevant for a dry/dusty plot.
  let air=null; // {pm25,pm10,aqi,dust,uv,uvClear,time}
  // REAL measured dust → 0..1 scene intensity, REPLACING the wind/humidity GUESS
  // (line 32-33) whenever air-quality data is present. Prefer airborne dust mass;
  // else derive from PM10. Tuned to agree with the dustHe() badge thresholds in
  // app.js (≈0 at ~20µg → ≈0.9 at ~200µg) so the badge text and the 3D haze match.
  function realDust(){
    const a=air; if(!a) return null;
    return a.dust!=null ? clamp01(a.dust/250)
         : (a.pm10!=null ? clamp01((a.pm10-20)/180) : null);
  }
  async function fetchAir(){
    try{
      const url=`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}`+
        `&current=pm2_5,pm10,european_aqi,dust,uv_index,uv_index_clear_sky&timezone=auto`;
      const r=await fetch(url); if(!r.ok) throw 0;
      const c=(await r.json()).current||{};
      air={ pm25:c.pm2_5, pm10:c.pm10, aqi:c.european_aqi, dust:c.dust,
            uv:c.uv_index, uvClear:c.uv_index_clear_sky, time:c.time };
      // Drive the SCENE off the MEASURED value: target.dust is what update() eases
      // cur.dust toward and feeds SkyRig.setWeather — writing air.dust alone does
      // NOTHING visual. state.dust keeps the card/state in sync. The guess at
      // line 32-33 remains the OFFLINE fallback only (fetchAir failed → catch).
      const d=realDust();
      if(d!=null){ if(state) state.dust=d; target.dust=d; }
      return air;
    }catch(e){ return null; }
  }

  // ---- garden + water ENV (Open-Meteo): soil temp/moisture, ET0, radiation, UV
  // (hourly), daily precip + probability + ET0 sum, and 30-day accumulated precip. ----
  let env=null; // {times[],soilT[],soilM[],et0[],rad[],uv[], dTimes[],dPrecip[],dProb[],dEt0[], tz}
  async function fetchEnv(){
    try{
      const url=`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`+
        `&hourly=soil_temperature_0cm,soil_moisture_0_1cm,et0_fao_evapotranspiration,shortwave_radiation,uv_index`+
        `&daily=precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration_sum`+
        `&past_days=31&forecast_days=2&timezone=auto`;
      const r=await fetch(url); if(!r.ok) throw 0;
      const j=await r.json(), h=j.hourly||{}, d=j.daily||{};
      env={ times:h.time||[], soilT:h.soil_temperature_0cm||[], soilM:h.soil_moisture_0_1cm||[],
            et0:h.et0_fao_evapotranspiration||[], rad:h.shortwave_radiation||[], uv:h.uv_index||[],
            dTimes:d.time||[], dPrecip:d.precipitation_sum||[], dProb:d.precipitation_probability_max||[],
            dEt0:d.et0_fao_evapotranspiration_sum||[], tz:j.timezone };
      return env;
    }catch(e){ return null; }
  }

  // hourly env value for the hour containing `date` (nearest-hour fallback).
  function envAt(key,date){
    if(!env||!env.times.length) return null;
    const arr=env[key]; if(!arr||!arr.length) return null;
    const {ymd,hour}=localParts(date||new Date(),env.tz);
    let i=env.times.indexOf(`${ymd}T${String(hour).padStart(2,'0')}:00`);
    if(i<0){ const tgt=(date||new Date()).getTime(); let best=1e15;
      for(let k=0;k<env.times.length;k++){ const t=Date.parse(env.times[k]); if(isNaN(t))continue;
        const dd=Math.abs(t-tgt); if(dd<best){best=dd;i=k;} } }
    return i>=0? arr[i] : null;
  }
  // accumulated precip (mm) over the last `days` (default 30) up to today.
  function accumPrecip(days){
    if(!env||!env.dPrecip||!env.dPrecip.length) return null;
    const n=Math.min(days||30, env.dPrecip.length); let s=0,c=0;
    for(let k=env.dPrecip.length-n;k<env.dPrecip.length;k++){ const v=env.dPrecip[k]; if(v!=null){s+=v;c++;} }
    return c? Math.round(s*10)/10 : null;
  }
  // today's daily value (e.g. dProb, dEt0) for the civil day of `date`.
  function dailyToday(key,date){
    if(!env||!env.dTimes||!env.dTimes.length) return null;
    const {ymd}=localParts(date||new Date(),env.tz);
    const i=env.dTimes.indexOf(ymd); if(i<0) return null;
    const arr=env[key]; return arr&&arr[i]!=null? arr[i] : null;
  }

  // local wall-clock components of a Date in the forecast's timezone (DST-aware).
  // Falls back to the device-local clock if no tz is known yet.
  function localParts(date,tz){
    try{
      const f=new Intl.DateTimeFormat('en-CA',{timeZone:tz||undefined,year:'numeric',
        month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false});
      const p={}; f.formatToParts(date).forEach(o=>{p[o.type]=o.value;});
      let hh=+p.hour; if(hh===24) hh=0;   // some engines emit 24 for midnight
      return { ymd:`${p.year}-${p.month}-${p.day}`, hour:hh };
    }catch(e){
      const z=n=>String(n).padStart(2,'0');
      return { ymd:`${date.getFullYear()}-${z(date.getMonth()+1)}-${z(date.getDate())}`, hour:date.getHours() };
    }
  }

  // cloud fraction (0..1) forecast for the hour containing `date`.
  // `layer` ∈ 'total'|'low'|'mid'|'high' (default 'total'). null if no forecast/match.
  function cloudForecast(date,layer){
    if(!forecast||!forecast.times.length) return null;
    const arr=forecast[layer||'total']; if(!arr||!arr.length) return null;
    const {ymd,hour}=localParts(date||new Date(),forecast.tz);
    const stamp=`${ymd}T${String(hour).padStart(2,'0')}:00`;
    let i=forecast.times.indexOf(stamp);
    if(i<0){ // fall back to nearest hour by absolute ms distance
      const tgt=(date||new Date()).getTime(); let best=1e15;
      for(let k=0;k<forecast.times.length;k++){
        const t=Date.parse(forecast.times[k]); if(isNaN(t)) continue;
        const d=Math.abs(t-tgt); if(d<best){best=d;i=k;}
      }
    }
    const v=(i>=0)?arr[i]:null; return v==null?null:clamp01(v/100);
  }

  // representative cloud (0..1) for TONIGHT's stargazing window (~21:00–23:00
  // local on the civil evening of `date`). Averages the hours that exist in the
  // forecast. Returns null if the forecast hasn't loaded / no hours match.
  function tonightCloud(date,layer){
    if(!forecast||!forecast.times.length) return null;
    const arr=forecast[layer||'total']; if(!arr||!arr.length) return null;
    const ref=date||new Date();
    // if it's already past midnight (before ~6am), "tonight" was the previous evening
    const refHour=localParts(ref,forecast.tz).hour;
    const base=refHour<6 ? new Date(ref.getTime()-12*3600000) : ref;
    const {ymd}=localParts(base,forecast.tz);
    const HOURS=[21,22,23]; let sum=0,n=0;
    HOURS.forEach(hh=>{
      const i=forecast.times.indexOf(`${ymd}T${String(hh).padStart(2,'0')}:00`);
      if(i>=0 && arr[i]!=null){ sum+=arr[i]; n++; }
    });
    return n? clamp01((sum/n)/100) : null;
  }

  // Puffy desert cumulus on a transparent canvas. Built from many overlapping
  // soft radial "puffs" packed into a rounded blob with a flattish base, so the
  // edge reads SOFT but the body reads SOLID (high alpha core) — not a faint
  // smudge. White RGB; daylight/night tint is applied via SpriteMaterial.color.
  // A subtle vertical alpha bias (denser toward the bottom) gives it weight.
  function cloudTex(){
    const s=256, c=document.createElement('canvas'); c.width=c.height=s; const x=c.getContext('2d');
    const cx=s/2, cy=s*0.56;                       // body centred a touch low (flat-ish base)
    // 1) build a dense alpha mass from ~60 overlapping puffs in an ellipse
    x.globalCompositeOperation='source-over';
    const N=64;
    for(let i=0;i<N;i++){
      // distribute puffs across a wide, low ellipse; bias radius bigger near centre
      const ang=Math.random()*Math.PI*2, rad=Math.pow(Math.random(),0.6);
      const px=cx + Math.cos(ang)*rad*s*0.40;
      const py=cy + Math.sin(ang)*rad*s*0.20 - Math.random()*s*0.06; // lift tops, keep base flat
      const r=s*(0.10+0.13*(1-rad)+Math.random()*0.05);
      const a=0.22+0.30*(1-rad);                   // denser puffs toward the middle
      const g=x.createRadialGradient(px,py,0,px,py,r);
      g.addColorStop(0,`rgba(255,255,255,${a})`);
      g.addColorStop(0.55,`rgba(255,255,255,${a*0.5})`);
      g.addColorStop(1,'rgba(255,255,255,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    }
    // 2) a broad soft core to fill gaps so overlaps read as one solid mass
    const core=x.createRadialGradient(cx,cy,0,cx,cy,s*0.46);
    core.addColorStop(0,'rgba(255,255,255,0.42)');
    core.addColorStop(0.6,'rgba(255,255,255,0.18)');
    core.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=core; x.beginPath(); x.arc(cx,cy,s*0.46,0,7); x.fill();
    const t=new THREE.CanvasTexture(c); t.needsUpdate=true; return t; }

  // sun altitude (deg) from the SAME scrubbable clock the rest of the app reads
  // (documentElement.dataset.tmode/tscrub — see panels.js/app.js). Used only to
  // shade clouds day(bright/white) vs night(dark grey). Robust fallback to the
  // device clock / "daytime" if Astro or the dataset isn't available yet.
  function sunAltDeg(){
    try{
      const D=document.documentElement, live=(D.dataset.tmode||'live')==='live';
      const ms=live?Date.now():+D.dataset.tscrub;
      const date=isFinite(ms)?new Date(ms):new Date();
      if(window.Astro && Astro.sun) return Astro.sun(date).altDeg;
    }catch(e){}
    return 25;   // assume daytime if we can't tell
  }

  function init(s){
    scene=s;
    // rain
    const N=5000, geo=new THREE.BufferGeometry(), p=new Float32Array(N*3);
    for(let i=0;i<N;i++){ p[i*3]=(Math.random()-0.5)*60; p[i*3+1]=Math.random()*40; p[i*3+2]=(Math.random()-0.5)*60; }
    geo.setAttribute('position',new THREE.BufferAttribute(p,3));
    rain=new THREE.Points(geo,new THREE.PointsMaterial({color:0xbcd0e8,size:0.07,transparent:true,opacity:0,depthWrite:false}));
    rain.userData.v=new Float32Array(N).map(()=>18+Math.random()*10); scene.add(rain);
    // dust
    const DN=1600, dgeo=new THREE.BufferGeometry(), dp=new Float32Array(DN*3);
    for(let i=0;i<DN;i++){ dp[i*3]=(Math.random()-0.5)*80; dp[i*3+1]=Math.random()*18; dp[i*3+2]=(Math.random()-0.5)*80; }
    dgeo.setAttribute('position',new THREE.BufferAttribute(dp,3));
    dust=new THREE.Points(dgeo,new THREE.PointsMaterial({color:0xcaa676,size:0.24,transparent:true,opacity:0,depthWrite:false,fog:false,
      blending:THREE.NormalBlending})); scene.add(dust);
    // clouds — FEWER but BIGGER & PUFFIER sprites (12) on a STABLE paint order.
    // FLICKER FIX: every other transparent sky shell in sky.js (Sky shader, night
    // dome, stars, moon, sun, planets, arcs) runs depthTest:false + an explicit
    // renderOrder so the back-to-front order never re-sorts as the camera orbits.
    // The clouds were the lone outlier — default renderOrder(0) + default
    // depthTest(true) for sprites — so three.js re-sorted them by camera distance
    // every frame and they z-fought the other shells → flashing. We now give them
    //   depthTest:false  (don't z-test against the dome/sun/Sky that write no depth)
    //   a FIXED renderOrder per sprite (stable, deterministic paint order)
    // keeping depthWrite:false. They sit between the Sky shader/dome (≤ -5) and the
    // sun/moon/stars (≥ 3): renderOrder ≈ -3..-2, so clouds are always drawn in
    // front of the sky backdrop and behind the celestial bodies, every frame.
    const ct=cloudTex();
    const CN=12;
    for(let i=0;i<CN;i++){
      const m=new THREE.Sprite(new THREE.SpriteMaterial({
        map:ct, transparent:true, opacity:0, depthWrite:false, depthTest:false,
        color:0xffffff, fog:false }));
      m.material.toneMapped=false;
      // bigger, low-aspect puffs (wide, flattish) so each reads as a real cloud
      const w=120+Math.random()*120;
      m.scale.set(w, w*(0.5+Math.random()*0.12), 1);
      m.position.set((Math.random()-0.5)*440, 70+Math.random()*45, (Math.random()-0.5)*440);
      m.userData.sp=0.6+Math.random()*0.5;
      m.userData.k=Math.random();              // stable per-cloud size/opacity jitter
      // FIXED, distinct paint order: lower clouds drawn first. Spread across a
      // small band so no two share an order (no sort ambiguity) but all stay
      // between the sky backdrop (≤ -5) and the bodies (≥ 3).
      m.renderOrder=-3 + i*(1/CN);             // -3.000 .. ~-2.083, all unique
      scene.add(m); clouds.push(m);
    }
  }

  function apply(st){
    target.cloud=st.cloud; target.rain=st.rain;
    // Only let the wind/humidity GUESS drive the scene dust when we have NO real
    // measurement — otherwise apply() (mood path) would race fetchAir() and clobber
    // a real desert-dust reading back to ~0 on exactly the calm day we want to catch.
    if(!air||realDust()==null) target.dust=st.dust;
    target.wind=clamp01(st.wind/40)+0.1; target.windDir=st.windDir*Math.PI/180;
  }
  function override(mood){
    if(mood==='clear'){ target.cloud=0.04; target.rain=0; target.dust=0.03; }
    if(mood==='dust'){  target.cloud=0.1; target.rain=0; target.dust=0.8; }
    if(mood==='clouds'){target.cloud=0.85; target.rain=0; target.dust=0; }
    if(mood==='rain'){  target.cloud=0.9; target.rain=0.7; target.dust=0; }
  }

  function update(dt,camera){
    // ease
    ['cloud','rain','dust','wind','windDir'].forEach(k=> cur[k]+=(target[k]-cur[k])*Math.min(1,dt*0.6));
    const wx=Math.sin(cur.windDir)*cur.wind, wz=-Math.cos(cur.windDir)*cur.wind;
    SkyRig.setWeather({cloud:cur.cloud,rain:cur.rain,dust:cur.dust});

    // rain
    rain.material.opacity=cur.rain*0.9;
    if(cur.rain>0.01){ const a=rain.geometry.attributes.position.array, v=rain.userData.v;
      rain.position.set(camera.position.x,0,camera.position.z);
      for(let i=0;i<a.length;i+=3){ a[i+1]-=v[i/3]*dt; a[i]+=wx*dt*2; a[i+2]+=wz*dt*2;
        if(a[i+1]<-2){ a[i+1]=38; a[i]=(Math.random()-0.5)*60; a[i+2]=(Math.random()-0.5)*60; } }
      rain.geometry.attributes.position.needsUpdate=true; }

    // dust
    dust.material.opacity=cur.dust*0.85;
    if(cur.dust>0.01){ const a=dust.geometry.attributes.position.array;
      dust.position.set(camera.position.x,0,camera.position.z);
      for(let i=0;i<a.length;i+=3){ a[i]+=wx*dt*3+0.4*dt; a[i+2]+=wz*dt*3;
        a[i+1]+=Math.sin(performance.now()*0.001+i)*0.01;
        if(a[i]>40)a[i]=-40; if(a[i]<-40)a[i]=40; if(a[i+2]>40)a[i+2]=-40; if(a[i+2]<-40)a[i+2]=40; }
      dust.geometry.attributes.position.needsUpdate=true; }

    // clouds — VISIBILITY + DAY/NIGHT SHADE
    // Coverage→presence: at ~20% cloud a few clouds should read CLEARLY (not faint
    // smudges); high % → substantial cover. We (1) raise overall opacity, (2) gate
    // each cloud in by a stable per-cloud threshold so low coverage shows a FEW
    // distinct puffs (rather than all 12 uniformly faint), and ramp them to near-
    // opaque as coverage climbs. Tint bright white-ish by day → dark grey at night
    // from the real sun altitude. depthTest:false + fixed renderOrder (set in init)
    // keep the paint order steady, so opacity changes here never flash.
    const alt=sunAltDeg();
    const dayF=Math.max(0,Math.min(1,(alt+6)/12));        // 0 night .. 1 day (twilight band)
    // lit clouds: bright (slightly warm) white by day → cool dark grey at night.
    // day  ≈ rgb(255,252,240); night ≈ rgb(120,126,132).
    const cr=Math.round(120+135*dayF), cg=Math.round(126+126*dayF), cb=Math.round(132+108*dayF);
    const cov=cur.cloud;
    clouds.forEach((m,i)=>{
      // stable spread of thresholds 0..~0.9 so clouds appear progressively; the
      // first few are visible already at low coverage.
      const thr=(i/clouds.length)*0.9;
      // how far coverage is past this cloud's threshold, softened to 0..1
      const f=Math.max(0,Math.min(1,(cov-thr)/0.28));
      // strong max opacity (0.92) so present clouds are CLEARLY visible, with a
      // gentle per-cloud variation (stable k) — no i%3 stepping that popped.
      const op=f*f*(3-2*f) * (0.78+0.18*m.userData.k) * 0.96;
      m.material.opacity=op;
      m.visible=op>0.012;
      m.material.color.setRGB(cr/255, cg/255, cb/255);
      // drift with the real wind (slightly varied per cloud) + a gentle base drift
      const sp=m.userData.sp;
      m.position.x+=wx*dt*2.0*sp+0.25*dt; m.position.z+=wz*dt*2.0*sp;
      if(m.position.x>240)m.position.x=-240; if(m.position.z>240)m.position.z=-240;
      if(m.position.x<-240)m.position.x=240; if(m.position.z<-240)m.position.z=240;
    });
  }

  return { init, fetchLive, fetchForecast, fetchAir, fetchEnv, cloudForecast, tonightCloud,
           hazardForecast, envAt, accumPrecip, dailyToday, apply, override, update,
           get state(){return state;}, get cur(){return cur;}, get forecast(){return forecast;},
           get air(){return air;}, get env(){return env;}, get hazard(){return hazard;} };
})();
window.Weather = Weather;
