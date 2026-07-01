/* ===================================================================
   alerts.js — Feature C: a STATELESS in-app rules engine + banner UI.
   window.Alerts. NO backend, NO push: banners appear ONLY while the
   page is open and the tick is running (a 4am frost / a dust storm with
   the tab closed raises nothing — Alex sees it next time he opens the app).

   Design contract (FIXED, parallel agents agree on these):
     • Reads the SAME scrubbable clock as panels.js nowDate()
       (document.documentElement.dataset.tmode / .tscrub) — never a private clock.
     • Runs evaluate() on its own setInterval(...,5000), gated by window.__gen
       (app.js:11 pattern) so a superseded run's loop dies.
     • Each rule → {id, sev, icon, he, key} | null.
       - frostTonight    : Derive.frostRisk + Weather.state.temp / Weather.envAt('soilT')
       - dustStorm       : Weather.air?.pm10>=100 (real) else Weather.state.dust>=~0.5 (GUESS),
                           reusing app.js dustHe() thresholds
       - clearSkyStargazing : Weather.tonightCloud(date)<=0.15 in the evening window
       - dateReminders   : LogStore.upcoming('schedule',2) + upcoming('lending',2)
     • ACTIONABLE banners (frost/dust/stargazing/date) are GATED to tmode==='live'
       so scrubbing only PREVIEWS them (a scrubbed future hour never raises a
       false "real now" alert).
     • Dismissed / snoozed persisted in single-doc 'home_alerts_state_v1'
       keyed by rule-key + civil-day, so a dismissed banner doesn't re-nag
       the same day (garden.js mergeDefaults / single-doc idiom).
     • Banner UI styled in the #inst dark-gold aesthetic, mounted to a SEPARATE
       #alertHost on document.body (NOT under #inst → not hidden by the
       @media(max-width:960px){#inst{display:none}} rule, so the banner can
       still reach a phone).
   =================================================================== */
const Alerts = (function(){
  // ---- idempotency guard (garden.js:13 style) ----
  if(window.Alerts) return window.Alerts;

  const MYGEN = window.__gen || 0;       // capture the run we belong to; loop dies when superseded
  const STATE_KEY = 'home_alerts_state_v1';
  const TICK_MS = 5000;

  const clamp01 = v=>Math.max(0,Math.min(1,v));
  const esc = s=>String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* ---------- the SAME scrubbable clock panels.js uses (panels.js:11) ---------- */
  function tmode(){ return (document.documentElement.dataset.tmode||'live'); }
  function isLive(){ return tmode()==='live'; }
  function nowDate(){
    const D=document.documentElement;
    if((D.dataset.tmode||'live')==='live') return new Date();
    const m=+D.dataset.tscrub; return isFinite(m)?new Date(m):new Date();
  }
  // civil-day stamp (YYYY-MM-DD) of a date — keys the dismissed/snoozed store so a
  // dismissal only suppresses for THAT day; tomorrow the banner may re-raise.
  function civilDay(date){
    const d=date||nowDate(), z=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
  }

  /* ---------- persistence: single doc, fire-and-forget (garden.js:75-76) ---------- */
  // shape: { dismissed:{ "<ruleKey>|<civilDay>": ms }, snoozed:{ "<ruleKey>|<civilDay>": untilMs } }
  function loadState(){
    let raw=null; try{ raw=JSON.parse(localStorage.getItem(STATE_KEY)); }catch(e){}
    raw = raw && typeof raw==='object' ? raw : {};
    if(!raw.dismissed || typeof raw.dismissed!=='object') raw.dismissed={};
    if(!raw.snoozed   || typeof raw.snoozed!=='object')   raw.snoozed={};
    return raw;
  }
  function saveState(st){ try{ localStorage.setItem(STATE_KEY, JSON.stringify(st)); }catch(e){} }

  // composite suppression key: rule-key + the civil day it pertains to.
  function dayKey(ruleKey,date){ return ruleKey+'|'+civilDay(date); }
  function isSuppressed(ruleKey,date){
    const st=loadState(), k=dayKey(ruleKey,date);
    if(st.dismissed[k]) return true;
    const until=st.snoozed[k];
    if(until && Date.now()<until) return true;
    return false;
  }
  function dismiss(ruleKey,date){
    const st=loadState(); st.dismissed[dayKey(ruleKey,date)]=Date.now(); saveState(st);
  }
  function snooze(ruleKey,date,hours){
    const st=loadState();
    st.snoozed[dayKey(ruleKey,date)]=Date.now()+(hours||3)*3600000; saveState(st);
  }
  // light housekeeping: drop entries older than ~3 days so the doc never grows.
  function prune(){
    const st=loadState(), cutoff=Date.now()-3*86400000; let dirty=false;
    ['dismissed','snoozed'].forEach(b=>{
      Object.keys(st[b]).forEach(k=>{ if((st[b][k]||0)<cutoff){ delete st[b][k]; dirty=true; } });
    });
    if(dirty) saveState(st);
  }

  /* ---------- shared scene/data reads (defensive — alerts.js loads last) ---------- */
  function sunAltDeg(date){
    try{ if(window.Astro && Astro.sun) return Astro.sun(date).altDeg; }catch(e){}
    return null;
  }
  // dustHe() thresholds, mirrored from app.js:1691 so the banner text matches the card:
  //   <20 negligible · <50 light · <100 moderate · <200 high · else heavy haze  (µg/m³ scale)
  function dustHe(d){
    if(d==null) return null;
    return d<20?'negligible':d<50?'light':d<100?'moderate':d<200?'high':'heavy haze';
  }

  /* =================================================================
     RULES — each returns {id, sev, icon, he, key} | null.
     id   : stable DOM id for the banner element (one per rule kind)
     sev  : 'warn' | 'cold' | 'good' | 'info'  (drives the accent colour)
     icon : a single glyph
     he   : English banner text
     key  : suppression key (rule-key, combined with civil-day in the store)
     ================================================================= */

  // FROST TONIGHT — radiative frost on his exposed plot at dawn.
  // Derive.frostRisk REQUIRES o.town (air temp) non-null and o.alt<=0 (night),
  // else it returns null. Feeds it Weather.state.temp + soil temp + tonight cloud.
  function frostTonight(date){
    const W=window.Weather, D=window.Derive;
    if(!W||!D||!D.frostRisk) return null;
    const st=W.state; if(!st || st.temp==null) return null;
    const alt=sunAltDeg(date);
    if(alt==null || alt>0) return null;                       // daytime → not a frost moment
    const soilT=(W.envAt)?W.envAt('soilT',date):null;
    const cloud=(W.tonightCloud)?W.tonightCloud(date):st.cloud;
    const fr=D.frostRisk({
      town: st.temp,
      alt,
      cloud: (cloud!=null?cloud:st.cloud),
      wind: st.wind,
      hum: st.hum,
      soilT: (soilT!=null?soilT:undefined),
      date
    });
    if(!fr || !fr.level || fr.level==='none' || fr.level==='low') return null;
    const lowTxt=(fr.lowHouse!=null)?` · est. min ~${fr.lowHouse}°`:'';
    return {
      id:'al-frost', sev:'cold', icon:'❄️', key:'frost',
      goto:{ alert:'frost' },          // → environment (env)
      he:`Frost risk on your exposed plot tonight (${fr.level})${lowTxt} — cover sensitive plants or move pots indoors`
    };
  }

  // DUST STORM — close the windows. Real PM10 when present (Feature A), else the
  // wind/humidity dust GUESS scaled to the same µg/m³ band as dustHe().
  function dustStorm(date){
    const W=window.Weather; if(!W) return null;
    const pm=(W.air && W.air.pm10!=null)?W.air.pm10:null;
    const real=(pm!=null);
    // GUESS path: Weather.state.dust is a 0..1 scene value; map to µg/m³ so the
    // dustHe() threshold logic is identical either way. dust>=~0.5 → ~100µg ('high').
    const guess=(W.state && W.state.dust!=null)? W.state.dust*200 : null;
    const dustLevel = real ? pm : guess;
    if(dustLevel==null || dustLevel<100) return null;          // fire at 'high' (PM10>=100 / dust>=~0.5)
    const lvl=dustHe(dustLevel);
    const src = real ? `PM10 ~${Math.round(pm)} µg/m³` : 'estimate from wind/humidity';
    return {
      id:'al-dust', sev:'warn', icon:'🌫️', key:'dust',
      goto:{ alert:'dust' },           // → environment (env)
      he:`Airborne dust ${lvl} (${src}) — close windows and bring in laundry`
    };
  }

  /* ---------- WEATHER HAZARD / MAINTENANCE (Feature #4, #11) ----------
     All four read Weather.hazardForecast() — the DAILY forecast (today + next
     ~2 days), NOT the scrubbed instant — so a clear "now" can still warn of
     tomorrow's storm, and scrubbing the clock never invents a false hazard.
     Thresholds are deliberately conservative (no false alarms): each rule only
     fires on a genuinely actionable day. Like the others they're gated to live
     mode and suppressible per rule-key+civil-day.
     The forecast covers ~today..+2d; we scan that window and report the FIRST
     day that crosses the threshold, with a human "today / tomorrow / in N days"
     label computed against nowDate() in the forecast's own civil days.        */
  function hazWindow(){
    const W=window.Weather; if(!W||!W.hazardForecast) return null;
    const arr=W.hazardForecast(); // today first; null if not loaded
    return (Array.isArray(arr)&&arr.length)? arr : null;
  }
  // "today / tomorrow / in N days" for a YYYY-MM-DD forecast day vs the civil now.
  function whenHe(ymd,date){
    const today=civilDay(date);
    if(!ymd) return '';
    if(ymd===today) return 'today';
    // days difference by parsing both as local midnights
    const p=s=>{ const a=String(s).split('-'); return new Date(+a[0],+a[1]-1,+a[2]).getTime(); };
    const diff=Math.round((p(ymd)-p(today))/86400000);
    if(diff===1) return 'tomorrow';
    if(diff>1) return 'in '+diff+' days';
    return ''; // past day (shouldn't happen — forecast starts today)
  }
  // is this a SNOW weather_code? WMO 71-77 (snow/grains) + 85/86 (snow showers).
  function isSnowCode(c){ return c!=null && ((c>=71&&c<=77)||c===85||c===86); }

  // RAIN INCOMING — gutters/drains housekeeping. Meaningful rain (>=5mm OR a high
  // probability >=70% with some accumulation) within the ~48h window. Distinct from
  // the heavier flashFlood rule below. Won't fire on a snow day (snowIce owns that).
  function rainIncoming(date){
    const days=hazWindow(); if(!days) return null;
    for(const d of days){
      if(isSnowCode(d.code)) continue;
      const mm=d.rainMm, prob=d.rainProb;
      const meaningful = (mm!=null && mm>=5) || (prob!=null && prob>=70 && mm!=null && mm>=1);
      if(meaningful && !(mm!=null && mm>=20)){   // >=20mm is flashFlood's territory, not this gentle nudge
        const when=whenHe(d.date,date);
        const mmTxt=(mm!=null)?`~${Math.round(mm)} mm`:'';
        const pTxt=(prob!=null)?`${Math.round(prob)}% chance`:'';
        const detail=[mmTxt,pTxt].filter(Boolean).join(' · ');
        return {
          id:'al-rain', sev:'info', icon:'🌧️', key:'rain-'+d.date,
          goto:{ tab:'env' },          // weather → environment
          he:`Rain expected ${when}${detail?` (${detail})`:''} — clear and open gutters and check for blockages`
        };
      }
    }
    return null;
  }

  // FLASH FLOOD — real risk in highland flood channels. Heavy daily rain (>=20mm) in the
  // window. Honest, separate severity ('warn') from the gentle gutters nudge.
  function flashFlood(date){
    const days=hazWindow(); if(!days) return null;
    for(const d of days){
      const mm=d.rainMm;
      if(mm!=null && mm>=20){
        const when=whenHe(d.date,date);
        return {
          id:'al-flood', sev:'warn', icon:'⚠️', key:'flood-'+d.date,
          goto:{ tab:'env' },          // weather → environment
          he:`Heavy rain expected ${when} (~${Math.round(mm)} mm) — flood/runoff danger in the streambed channels. Keep objects away from water paths and avoid driving through flooded channels`
        };
      }
    }
    return null;
  }

  // STRONG WIND — secure tiles/loose objects, close up. Fires on a high gust
  // (>=60 km/h) or a high sustained max (>=45 km/h) in the window.
  function strongWind(date){
    const days=hazWindow(); if(!days) return null;
    for(const d of days){
      const gust=d.gustMax, wmax=d.windMax;
      if((gust!=null && gust>=60) || (wmax!=null && wmax>=45)){
        const when=whenHe(d.date,date);
        const g=(gust!=null)?`gusts up to ~${Math.round(gust)} km/h`:(wmax!=null?`wind up to ~${Math.round(wmax)} km/h`:'');
        return {
          id:'al-wind', sev:'warn', icon:'💨', key:'wind-'+d.date,
          goto:{ tab:'env' },          // weather → environment
          he:`Strong wind expected ${when}${g?` (${g})`:''} — secure roof tiles and loose objects in the yard and close shutters/windows`
        };
      }
    }
    return null;
  }

  // SNOW / ICE — rare but real on the high highland plateau. Fires on a snow
  // weather_code or snowfall>0, OR a hard freeze (tmin well below 0, <=-2°C).
  function snowIce(date){
    const days=hazWindow(); if(!days) return null;
    for(const d of days){
      const snow=(isSnowCode(d.code)) || (d.snowCm!=null && d.snowCm>0);
      const hardFreeze=(d.tmin!=null && d.tmin<=-2);
      if(snow || hardFreeze){
        const when=whenHe(d.date,date);
        let txt;
        if(snow){
          const cm=(d.snowCm!=null && d.snowCm>0)?` (~${Math.round(d.snowCm)} cm)`:'';
          txt=`Snow expected ${when}${cm} — protect pipes and water meters, bring in sensitive plants and drive carefully`;
        } else {
          txt=`Hard frost expected ${when} (min ~${Math.round(d.tmin)}°) — risk of ice and frozen pipes. Wrap exposed faucets`;
        }
        return { id:'al-snow', sev:'cold', icon:'❄️', key:'snowice-'+d.date, goto:{ tab:'env' }, he:txt };
      }
    }
    return null;
  }

  /* ---------- ANNIVERSARY (Feature #3) ----------
     Reads data/milestones.json (shared with Agent B's timeline card). On the day
     (±1) of a milestone, fire a celebratory banner with the N-years count from the
     original date. Milestones are FIXED wishlist facts, so an inline fallback holds
     them even if the fetch fails (file:// CORS) — not fabricated data.            */
  // inline fallback === data/milestones.json (kept in sync; the wishlist dates).
  const MILESTONES_FALLBACK=[
    { date:'2020-03-05', he:'Moving day — the day you moved to Larkmont', emoji:'🏜️' },
    { date:'2021-08-01', he:'Home day — the day you moved into the house',       emoji:'🏡' },
    { date:'2022-06-30', he:'Mortgage day — the day you took the mortgage', emoji:'🔑' }
  ];
  let _milestones=null;            // resolved array once loaded
  (function loadMilestones(){
    try{
      fetch('data/milestones.json')
        .then(r=>r.ok?r.json():null)
        .then(j=>{ const ev=j&&Array.isArray(j.events)?j.events:null; _milestones = ev&&ev.length?ev:MILESTONES_FALLBACK; })
        .catch(()=>{ _milestones=MILESTONES_FALLBACK; });
    }catch(e){ _milestones=MILESTONES_FALLBACK; }
  })();
  // calendar-day distance (ignoring year) between a milestone month/day and `date`,
  // returning the smallest signed offset in days within a small window (handles
  // year wrap). +0 = today, +1 = tomorrow, -1 = yesterday.
  function dayOffsetThisYear(mon,day,date){
    const y=date.getFullYear();
    // candidate anniversaries this year and adjacent years (for Dec/Jan wrap)
    let best=null;
    [y-1,y,y+1].forEach(yy=>{
      const cand=new Date(yy,mon-1,day);
      const a=new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime();
      const diff=Math.round((cand.getTime()-a)/86400000);
      if(best==null || Math.abs(diff)<Math.abs(best)) best=diff;
    });
    return best;
  }
  function anniversaryToday(date){
    const list = _milestones || MILESTONES_FALLBACK;
    for(const m of list){
      if(!m||!m.date) continue;
      const parts=String(m.date).split('-'); if(parts.length<3) continue;
      const Y=+parts[0], MO=+parts[1], DAY=+parts[2];
      const off=dayOffsetThisYear(MO,DAY,date);
      if(off==null || Math.abs(off)>1) continue;           // only on the day (±1)
      // Anniversary count = the calendar year of THIS occurrence minus the origin
      // year. The occurrence's year is today's year shifted by the wrap offset:
      // e.g. on Dec 31 the next Jan-1 anniversary belongs to next year.
      const occYear=date.getFullYear() + (off>0 && (date.getMonth()+1)===12 && MO===1 ? 1 : 0)
                                       - (off<0 && (date.getMonth()+1)===1  && MO===12? 1 : 0);
      const n=occYear-Y;
      if(n<0) continue;
      const label=(m.he||'').split('—')[0].trim() || m.he || 'milestone';
      const dayWord = off===0?'today':(off>0?'tomorrow':'yesterday');
      const yearTxt = n>0? ` — ${n} years!` : '';
      return {
        id:'al-anniv-'+m.date, sev:'good', icon:m.emoji||'🎂', key:'anniv-'+m.date,
        goto:{ tab:'brain' },          // milestone/reminder → brain
        he:`${dayWord} ${label}${yearTxt}`
      };
    }
    return null;
  }

  // CLEAR-SKY STARGAZING — a clear, dark evening over his Bortle-3 site.
  // Fires only in the evening window (sun below the horizon) with tonight's
  // forecast cloud <=15%. Folds in moon brightness as an honest caveat.
  function clearSkyStargazing(date){
    const W=window.Weather; if(!W||!W.tonightCloud) return null;
    const alt=sunAltDeg(date);
    if(alt==null || alt>-6) return null;                       // need civil dusk onward = real evening
    const cloud=W.tonightCloud(date);
    if(cloud==null || cloud>0.15) return null;                 // <=15% cloud
    // moon caveat: a bright high moon washes the sky — note it, don't suppress.
    let moonTxt='';
    try{
      if(window.Astro && Astro.moon){
        const mo=Astro.moon(date);
        if(mo && mo.altDeg>0 && mo.illum>0.6)
          moonTxt=` · but the moon (${Math.round(mo.illum*100)}%) brightens the backdrop`;
      }
    }catch(e){}
    return {
      id:'al-stars', sev:'good', icon:'✨', key:'stars',
      goto:{ alert:'sky' },            // → sky (sky)
      he:`Clear skies tonight (~${Math.round(cloud*100)}% cloud) over your dark skies — an excellent evening for stargazing${moonTxt}`
    };
  }

  // SKY HEADS-UP — a "don't miss tonight" nudge, distinct from clearSkyStargazing's
  // generic clear-evening note. Fires when EITHER:
  //   (A) tonight is genuinely great — clear (tonight cloud <=20%) AND dark/low moon
  //       (illum <50%) AND a meteor-shower PEAK is within ~1 day (Derive.nextMeteor), or
  //   (B) a VISIBLE ISS pass is imminent — the next naked-eye pass rises within ~30 min.
  // All from the real Astro/Satellites/Derive engines; honest in-app banner only.
  // Anchored to the upcoming dark window (~21:00 local), like the sky summary.
  function localTimeMs(ref, hh){
    try{
      const f=new Intl.DateTimeFormat('en-CA',{timeZone:'Etc/GMT+3',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
      const p={}; f.formatToParts(ref).forEach(o=>{p[o.type]=o.value;});
      const asUTC=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour===24?0:+p.hour,+p.minute,+p.second);
      const offset=asUTC-ref.getTime();
      const localMidnightUTC=Date.UTC(+p.year,+p.month-1,+p.day,0,0,0)-offset;
      return localMidnightUTC + hh*3600000;
    }catch(e){ return ref.getTime(); }
  }
  function localHour(date){
    try{ return +new Intl.DateTimeFormat('en-GB',{timeZone:'Etc/GMT+3',hour:'2-digit',hour12:false}).formatToParts(date).find(p=>p.type==='hour').value % 24; }
    catch(e){ return date.getHours(); }
  }
  function tonightDate(date){
    const base=(localHour(date)<6)? new Date(date.getTime()-12*3600000) : date;
    return new Date(localTimeMs(base,21));
  }
  function issRec(){
    try{ const s=(window.Satellites&&Satellites.list||[]).find(x=>x.id===25544); return s?s.satrec:null; }
    catch(e){ return null; }
  }
  function skyHeadsUp(date){
    const W=window.Weather, A=window.Astro, D=window.Derive, S=window.Satellites;
    if(!A) return null;
    // (B) imminent VISIBLE ISS pass — checked from the actual (scrubbed/live) instant,
    // since "imminent" means soon from NOW, not from the abstract 21:00 anchor.
    try{
      const rec=issRec();
      if(rec && A.sunEciUnit && S && S.nextPass){
        const sunU=A.sunEciUnit(date);
        const pass=S.nextPass(rec, date, sunU);
        if(pass && pass.anyVisible){
          const minsToRise=(pass.rise - date.getTime())/60000;
          if(minsToRise>=-2 && minsToRise<=30){
            const dir=S.dirHe?S.dirHe(pass.peakAz):'';
            const when=new Date(pass.rise).toLocaleTimeString('he-IL',{timeZone:'Etc/GMT+3',hour:'2-digit',minute:'2-digit'});
            return {
              id:'al-iss', sev:'good', icon:'🛰️', key:'iss',
              goto:{ alert:'sky' },        // → sky (sky)
              he:`Naked-eye pass of the Space Station (ISS) at ${when} — peak ${dir} at ${Math.round(pass.peakAlt)}° altitude. Step outside and look up`
            };
          }
        }
      }
    }catch(e){}
    // (A) tonight is great + a meteor peak within ~1 day.
    try{
      if(!W||!W.tonightCloud||!D||!D.nextMeteor) return null;
      const T=tonightDate(date);
      const cloud=W.tonightCloud(T);
      if(cloud==null || cloud>0.20) return null;            // need clear (<=20% cloud)
      const mo=A.moon(T);
      if(!mo || mo.illum>0.50) return null;                 // need a dark/low moon
      const met=D.nextMeteor(T);
      if(!met || met.days>1) return null;                   // peak within ~1 day
      // honest moon caveat at the meteor peak itself.
      let moonTxt='';
      try{ const mp=A.moon(met.date); if(mp && mp.illum>0.45) moonTxt=` (moon ${Math.round(mp.illum*100)}% — watch after moonset)`; }catch(e){}
      return {
        id:'al-sky', sev:'good', icon:'🌠', key:'sky-tonight',
        goto:{ alert:'sky' },          // → sky (sky)
        he:`Excellent night for stars over your dark skies — ${met.name} meteor shower peak ${met.days<=0?'tonight':'in '+met.days+' days'}, clear skies (~${Math.round(cloud*100)}% cloud) and a faint moon${moonTxt}`
      };
    }catch(e){}
    return null;
  }

  // DATE REMINDERS — LogStore.upcoming('schedule',2) + upcoming('lending',2).
  // Maintenance / Mitzi pet-food / lending returns due within 2 days. Returns an
  // ARRAY of rule objects (zero or more), unlike the single-object rules above.
  function dateReminders(date){
    const LS=window.LogStore; if(!LS||!LS.upcoming) return [];
    let sched=[], lend=[], bnb=[], inv=[];
    try{ sched=LS.upcoming('schedule',2)||[]; }catch(e){}
    try{ lend =LS.upcoming('lending',2)||[]; }catch(e){}
    try{ bnb  =LS.upcoming('airbnb',2)||[]; }catch(e){}
    try{ inv  =LS.upcoming('invoices',2)||[]; }catch(e){}
    const out=[];
    (Array.isArray(sched)?sched:[]).forEach(r=>{
      if(!r) return;
      const what=r.t || r.title || r.name || r.label || 'reminder';
      const when=r.d || r.due || '';
      out.push({
        id:'al-sched-'+(r.id!=null?r.id:Math.abs(hashStr(String(what)))),
        sev:'info', icon:'🔔', key:'sched-'+(r.id!=null?r.id:String(what)),
        goto:{ tab:'brain' },          // maintenance reminder → brain
        he:`${esc(what)}${when?` · for ${esc(when)}`:''}`
      });
    });
    (Array.isArray(lend)?lend:[]).forEach(r=>{
      if(!r) return;
      const item=r.t || r.item || r.title || r.name || 'lent item';
      const who =r.who || r.to || r.borrower || '';
      const when=r.d || r.due || '';
      out.push({
        id:'al-lend-'+(r.id!=null?r.id:Math.abs(hashStr(String(item)))),
        sev:'info', icon:'↩️', key:'lend-'+(r.id!=null?r.id:String(item)),
        goto:{ tab:'brain' },          // lending → brain
        he:`Return/get back: ${esc(item)}${who?` · ${esc(who)}`:''}${when?` · by ${esc(when)}`:''}`
      });
    });
    (Array.isArray(bnb)?bnb:[]).forEach(r=>{
      if(!r) return;
      const what=r.text || r.t || r.title || r.name || 'Airbnb hosting';
      const when=r.due || r.d || '';
      out.push({
        id:'al-bnb-'+(r.id!=null?r.id:Math.abs(hashStr(String(what)))),
        sev:'info', icon:'🏠', key:'bnb-'+(r.id!=null?r.id:String(what)),
        goto:{ tab:'brain' },          // hosting → brain
        he:`Hosting: ${esc(what)}${when?` · ${esc((when.slice?when.slice(0,10):when))}`:''}`
      });
    });
    (Array.isArray(inv)?inv:[]).forEach(r=>{
      if(!r) return;
      const what=r.text || r.t || r.title || r.name || 'invoice';
      const when=r.due || r.d || '';
      out.push({
        id:'al-inv-'+(r.id!=null?r.id:Math.abs(hashStr(String(what)))),
        sev:'info', icon:'🧾', key:'inv-'+(r.id!=null?r.id:String(what)),
        goto:{ tab:'brain' },          // invoices → brain
        he:`Invoice to pay/collect: ${esc(what)}${when?` · by ${esc((when.slice?when.slice(0,10):when))}`:''}`
      });
    });
    return out;
  }
  function hashStr(s){ let h=0; for(let i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; } return h; }

  // The ordered rule set. Single-object rules first; dateReminders expands to many.
  // GARDEN WEEKLY — a gentle once-a-week nudge to read "the weekly paper"; all logic +
  // week-seen state live in garden.js, this is just the bridge. Returns {…, action, onDismiss}.
  function gardenWeekly(date){ try{ return (window.__garden&&window.__garden.weeklyNudge)?window.__garden.weeklyNudge(date):null; }catch(e){ return null; } }

  const SINGLE_RULES=[frostTonight, dustStorm, snowIce, flashFlood, strongWind, rainIncoming,
                      anniversaryToday, skyHeadsUp, clearSkyStargazing, gardenWeekly];

  /* =================================================================
     BANNER UI — #alertHost on document.body, #inst dark-gold skin.
     ================================================================= */
  let host=null, styleInjected=false;

  function injectStyle(){
    if(styleInjected) return; styleInjected=true;
    const css=`
    #alertHost{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);
      width:min(440px,calc(100vw - 28px));z-index:40;display:flex;flex-direction:column;gap:8px;
      font-family:'Heebo',sans-serif;pointer-events:none;direction:ltr}
    #alertHost .alert{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;
      background:linear-gradient(160deg,rgba(12,14,26,.95),rgba(6,7,15,.97));
      border:1px solid rgba(202,161,90,.32);border-right:3px solid #caa15a;
      border-radius:10px;padding:11px 13px;color:#efe6cf;
      box-shadow:0 14px 40px rgba(0,0,0,.55);backdrop-filter:blur(12px);
      text-shadow:0 1px 6px rgba(0,0,0,.85);animation:alIn .28s ease}
    @keyframes alIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    #alertHost .alert.warn{border-right-color:#e0a24a}
    #alertHost .alert.cold{border-right-color:#7fb0ff}
    #alertHost .alert.good{border-right-color:#a3e635}
    #alertHost .alert.info{border-right-color:#caa15a}
    #alertHost .alert .ic{font-size:19px;line-height:1.25;flex:0 0 auto}
    #alertHost .alert .tx{flex:1;font-size:12.5px;line-height:1.5;color:#f3ead2}
    #alertHost .alert .acts{display:flex;flex-direction:column;gap:5px;flex:0 0 auto}
    #alertHost .alert .x{cursor:pointer;user-select:none;font-size:11px;color:#cdbd92;
      border:1px solid rgba(202,161,90,.3);border-radius:6px;padding:2px 7px;
      background:rgba(255,255,255,.04);white-space:nowrap;transition:.15s}
    #alertHost .alert .x:hover{border-color:rgba(202,161,90,.6);color:#fff7e6}
    #alertHost .preview{font-family:'Bellefair',serif;letter-spacing:.08em;font-size:9px;
      color:#8a7a52;text-align:center;padding-bottom:2px}
    @media(max-width:520px){#alertHost{bottom:10px}}
    `;
    const s=document.createElement('style'); s.id='alertHostCss'; s.textContent=css;
    document.head.appendChild(s);
  }

  function ensureHost(){
    if(host && document.body.contains(host)) return host;
    injectStyle();
    host=document.getElementById('alertHost');
    if(!host){ host=document.createElement('div'); host.id='alertHost'; document.body.appendChild(host); }
    return host;
  }

  // ONE-BRAIN jump: on a genuine user click of a banner body, open the relevant
  // tab via the Bus (panels.js subscribes to tab:open + alert:goto). Emitted ONLY
  // from the click handler below — never during construction or the per-5s redraw,
  // so there is no emit-loop. Safe no-op when bus.js / a subscriber isn't present.
  function emitGoto(rule){
    const g=rule&&rule.goto; if(!g) return;
    try{
      if(window.Bus&&window.Bus.emit){
        if(g.alert) window.Bus.emit('alert:goto',{kind:g.alert});   // frost/dust/sky → env/sky
        else if(g.tab) window.Bus.emit('tab:open',{tab:g.tab});      // env/brain weather + reminders
      }
    }catch(e){}
  }

  // build a single banner element for a rule object (+ the date it pertains to).
  function bannerEl(rule, date, preview){
    const div=document.createElement('div');
    div.className='alert '+(rule.sev||'info');
    div.dataset.alid=rule.id;
    const acts = preview
      ? ''  // in preview (scrub) mode there is nothing to dismiss permanently
      : `<div class="acts">`+
          `<span class="x" data-act="dismiss">Close</span>`+
          `<span class="x" data-act="snooze">Snooze 3h</span>`+
        `</div>`;
    div.innerHTML =
      `<div class="ic">${rule.icon||'•'}</div>`+
      `<div class="tx">${rule.he||''}</div>`+
      acts;
    // optional click-to-act on the banner body (e.g. the garden weekly → open the magazine)
    if(typeof rule.action==='function'){
      const tx=div.querySelector('.tx');
      if(tx){ tx.style.cursor='pointer'; tx.title='Open';
        tx.onclick=()=>{ try{ rule.action(); }catch(e){} div.remove(); }; }
    } else if(rule.goto){
      // ONE-BRAIN: tap the banner body → jump to the relevant tab (not on dismiss/snooze).
      const tx=div.querySelector('.tx');
      if(tx){ tx.style.cursor='pointer'; tx.title='Open the relevant tab';
        tx.onclick=()=>{ emitGoto(rule); }; }   // keep the banner; user can still dismiss/snooze
    }
    if(!preview){
      div.querySelectorAll('.x').forEach(b=>{
        b.onclick=()=>{
          const act=b.dataset.act;
          if(act==='dismiss'){ dismiss(rule.key,date); if(typeof rule.onDismiss==='function'){ try{ rule.onDismiss(); }catch(e){} } }
          else if(act==='snooze') snooze(rule.key,date,3);
          div.remove();
        };
      });
    }
    return div;
  }

  /* =================================================================
     EVALUATE — collect non-null rules for nowDate(), apply suppression,
     reconcile the DOM (add new, remove gone). Gated to live mode for the
     ACTIONABLE banners; in scrub mode it only PREVIEWS them (no persistence).
     ================================================================= */
  function collect(date){
    const out=[];
    SINGLE_RULES.forEach(fn=>{ try{ const r=fn(date); if(r) out.push(r); }catch(e){} });
    try{ dateReminders(date).forEach(r=>out.push(r)); }catch(e){}
    return out;
  }

  function evaluate(){
    const date=nowDate();
    const preview=!isLive();                       // scrub → preview only (don't persist/suppress)
    const rules=collect(date);

    const h=ensureHost();

    // PREVIEW header (scrub mode): make clear these are not "real now" alerts.
    let hdr=h.querySelector('.preview');
    if(preview && rules.length){
      if(!hdr){ hdr=document.createElement('div'); hdr.className='preview'; h.insertBefore(hdr, h.firstChild); }
      hdr.textContent='Preview (scrubbed time) · real alerts appear in live mode';
    } else if(hdr){ hdr.remove(); }

    // filter by suppression ONLY in live mode (scrubbed previews always show).
    const live = rules.filter(r=> preview ? true : !isSuppressed(r.key,date));
    const wantIds = new Set(live.map(r=>r.id));

    // remove banners no longer wanted
    Array.from(h.querySelectorAll('.alert')).forEach(el=>{
      if(!wantIds.has(el.dataset.alid)) el.remove();
    });
    // add banners not yet present
    live.forEach(rule=>{
      if(h.querySelector(`.alert[data-alid="${cssEsc(rule.id)}"]`)) return;
      h.appendChild(bannerEl(rule,date,preview));
    });
  }
  function cssEsc(s){ return String(s).replace(/"/g,'\\"'); }

  /* ---------- boot: tick gated by __gen so a stale run's loop dies ---------- */
  let timer=null;
  function start(){
    if(timer) return;
    prune();
    // run once immediately, then every 5s; the loop self-terminates when a newer
    // run bumps window.__gen (app.js:11 / :1483 pattern).
    const tick=()=>{
      if((window.__gen||0)!==MYGEN){ clearInterval(timer); timer=null; return; }
      try{ evaluate(); }catch(e){ /* never throw out of the loop */ }
    };
    tick();
    timer=setInterval(tick, TICK_MS);
  }

  // Auto-banner: only in the STANDALONE app (index.html). In the Stage-2 shell
  // (home.html, where window.Shell exists by DOMContentLoaded) the same alerts are
  // surfaced by the persistent now-strip + the dashboard "needs attention" feed, so
  // the legacy bottom banner would be a duplicate — suppress it. Alerts.collect()
  // stays public for those consumers either way.
  function maybeStart(){ if(!window.Shell) start(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', maybeStart, {once:true});
  else maybeStart();

  // public surface (small, for QA + manual nudges; rules are stateless/pure).
  const api={
    evaluate, collect, nowDate, isLive,
    // expose individual rules so QA can assert their return objects directly
    rules:{ frostTonight, dustStorm, rainIncoming, flashFlood, strongWind, snowIce,
            anniversaryToday, skyHeadsUp, clearSkyStargazing, dateReminders },
    dismiss, snooze, isSuppressed,
    _host:()=>host
  };
  return api;
})();
window.Alerts = Alerts;
