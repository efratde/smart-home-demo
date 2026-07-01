/* ===========================================================================
 * home.js · "Alex's Home" — the LIVING HOME landing (the cockpit)
 * ---------------------------------------------------------------------------
 * The first thing Alex sees. ONE beautiful living panel that pulls the app's
 * best gems together, in the dark gold-on-glass #inst language (RTL Hebrew):
 *
 *   • Now      — live temp (Weather.state.temp) + the geometry-modeled
 *               house-vs-town delta (Derive.microclimate), plus measured
 *               dust / PM10 / UV (Weather.air).
 *   • Tonight  — tonight's stargazing verdict (Derive.goOutScore) and the next
 *               truly dark (new-moon) night (Derive.nextDarkNight).
 *   • This month — what's alive in nature THIS month (Nature._data filtered),
 *               a few species with their photo.
 *   • Cosmos meter — the COSMIC ODOMETER (was hidden): full moons / perseids /
 *               orbital-km / days / hours since birth — computed LIVE off the
 *               birth date so the seconds tick.
 *   • 3 days   — the 3-day hazard forecast (was hidden): Weather.hazardForecast().
 *   • Alert    — the top alert that matters (Alerts.collect(date)[0]) or a calm
 *               all-clear message.
 *   • Season   — this-season REAL backyard totals over ~90 days from the
 *               RecordStore logbook (frost nights / DLI / rain), labeled
 *               "based on real measurements". Degrades gracefully before data exists.
 *
 * HONESTY (CLAUDE.md, non-negotiable): every surfaced number is labeled as
 * MEASURED ("based on real measurements") for real weather, or MODELED ("computed
 * from the house geometry" / "estimate") for geometry-derived. NEVER implies a physical
 * sensor. If a source isn't ready, the block says so instead of faking it.
 *
 * Self-contained: owns its own DOM + scoped #homeMain CSS (ensureCSS pattern,
 * mirrors nature.js / zone_card.js). Exposes window.__home.render(host, date).
 * Never touches index.html / panels.js / the WebGL scene / another module.
 * ======================================================================== */
(function () {
  'use strict';
  if (window.__home) return;

  var GOLD = '#caa15a';
  var SITE = { lat: 34.0000, lon: -40.0000 };
  var BACKYARD = 'backyard';

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function r1(v){ return Math.round(v*10)/10; }
  function isNum(v){ return typeof v==='number' && isFinite(v); }
  function intHe(n){ try{ return Number(n).toLocaleString('he-IL'); }catch(e){ return String(n); } }

  var MONTHS_HE = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DOW_HE = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var EMOJI = { bird:'🐦', mammal:'🦌', reptile:'🦎', insect:'🦗', plant:'🌿', fungi:'🍄', other:'•' };

  /* ---- state for the live-ticking odometer ---- */
  var _host = null, _date = null, _tick = null, _numbers = null;

  function curMonth(){ return (new Date()).getMonth() + 1; }   // 1..12

  /* ---- "tonight" date helpers — mirror panels.js tonightDate() so the Home
     stargazing verdict is computed for the actual DARK window (~21:00 local
     time), not the current daylight instant. goOutScore returns null when the
     sun is up (alt>-12), so without pinning to a dark hour the verdict block
     would silently vanish in the daytime. (M7 fix.) ---- */
  function localHour(date){
    try{ return +new Intl.DateTimeFormat('en-GB',{ timeZone:'Etc/GMT+3', hour:'2-digit', hour12:false }).formatToParts(date).find(function(p){ return p.type==='hour'; }).value % 24; }
    catch(e){ return date.getHours(); }
  }
  // UTC ms for HH:00 local time on the civil day of `ref` (computed via the
  // en-CA formatter reading the local offset at that moment).
  function localTimeMs(ref, hh){
    try{
      var f=new Intl.DateTimeFormat('en-CA',{ timeZone:'Etc/GMT+3', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
      var p={}; f.formatToParts(ref).forEach(function(o){ p[o.type]=o.value; });
      var asUTC=Date.UTC(+p.year,+p.month-1,+p.day,(+p.hour===24?0:+p.hour),+p.minute,+p.second);
      var offset=asUTC-ref.getTime();                       // local offset (ms) at `ref`
      var localMidnightUTC=Date.UTC(+p.year,+p.month-1,+p.day,0,0,0)-offset;
      return localMidnightUTC + hh*3600000;
    }catch(e){ return ref.getTime(); }
  }
  // the Date to evaluate "tonight" against: ~21:00 local. Before ~06:00
  // local, "tonight" is the evening that just passed (a 02:00 view still talks
  // about the active night), else tonight's coming evening.
  function tonightDate(date){
    var base=(localHour(date)<6) ? new Date(date.getTime()-12*3600000) : date;
    return new Date(localTimeMs(base,21));
  }

  /* ====================================================================
   * data readers — every one degrades to null/empty if a global is absent
   * ================================================================== */

  // live "now": measured air temp + geometry-modeled house delta + measured air.
  function liveNow(date){
    var W = window.Weather, D = window.Derive, A = window.Astro;
    var town = (W && W.state && isNum(W.state.temp)) ? W.state.temp : null;
    var live = !!(W && W.state && W.state.live);
    var desc = (W && W.state && W.state.desc) ? W.state.desc : null;
    var hum  = (W && W.state && isNum(W.state.hum)) ? W.state.hum : null;
    var wind = (W && W.state && isNum(W.state.wind)) ? Math.round(W.state.wind) : null;
    // geometry-modeled house-vs-town delta via the SAME path panels.js uses:
    // microclimate(town, backyard zoneState, sun altitude).
    var mc = null;
    if (D && D.microclimate && town != null) {
      var backyard = null;
      try {
        var s = A ? A.sun(date) : null;
        var zs = (D.data && D.data.site && D.data.site.zones) || [];
        var bz = zs.filter(function(z){ return z.id === BACKYARD; })[0];
        if (s && bz && D.zoneState) backyard = D.zoneState(bz, s.azDeg, s.altDeg);
        mc = D.microclimate(town, backyard || { sunlit:false }, s ? s.altDeg : 0);
      } catch(e){ mc = null; }
    }
    // measured air quality (keyless Open-Meteo): dust µg/m³, PM10, UV.
    var air = (W && W.air) || null;
    return { town:town, live:live, desc:desc, hum:hum, wind:wind, mc:mc, air:air };
  }

  // tonight's stargazing verdict + the next dark (new-moon) night.
  function tonight(date){
    var W = window.Weather, D = window.Derive, A = window.Astro;
    if (!A || !D || !D.goOutScore) return null;
    // Pin to tonight's DARK window (~21:00 local), matching panels.js
    // tonightDate(). Without this the sun is up at midday and goOutScore returns
    // null, so the verdict would compute for daylight instead of the night. (M7.)
    var T = tonightDate(date);
    var mo = A.moon(T), su = A.sun(T);
    var cloud = (W && W.cur && isNum(W.cur.cloud)) ? W.cur.cloud : 0.1;
    var nc = (W && W.tonightCloud) ? W.tonightCloud(T) : null;
    var opts = {
      hum: (W && W.state && isNum(W.state.hum)) ? W.state.hum : null,
      dust: (W && W.air && isNum(W.air.pm10)) ? W.air.pm10
           : ((W && W.state && isNum(W.state.dust)) ? W.state.dust*200 : null)
    };
    var go = D.goOutScore(cloud, mo.illum, su.altDeg, nc, opts);
    var dark = (D.nextDarkNight) ? D.nextDarkNight(date) : null;
    return { go:go, moon:mo, sunAlt:su.altDeg, nightCloud:nc, dark:dark };
  }

  // a few in-season species for THIS month (prefer iconic + photographed first).
  function monthSpecies(limit){
    var N = window.Nature;
    var data = (N && N._data) ? N._data() : null;
    if (!Array.isArray(data)) return null;     // null = not loaded yet (vs [] = none)
    var m = curMonth();
    var inSeason = data.filter(function(s){ return Array.isArray(s.months) && s.months.indexOf(m) !== -1; });
    inSeason.sort(function(a,b){
      var ap = (a.photo && a.photo.local) ? 1:0, bp = (b.photo && b.photo.local) ? 1:0;
      if (bp !== ap) return bp - ap;
      var ai = a.iconic?1:0, bi = b.iconic?1:0;
      return bi - ai;
    });
    return { total: inSeason.length, list: inSeason.slice(0, limit||6) };
  }

  // the cosmic odometer, computed LIVE off the birth date so it ticks. Falls
  // back to the baked snapshot fields if the birth date is missing.
  function odometer(){
    var D = window.Derive;
    var num = (D && D.data && D.data.numbers) ? D.data.numbers : (_numbers || null);
    if (!num) return null;
    var birth = num.birth_iso ? Date.parse(num.birth_iso) : NaN;
    if (!isFinite(birth)) {
      // no birth date → trust the static snapshot exactly (honest: not live).
      return {
        live:false,
        years: num.years, days: num.days, hours: num.hours, seconds: num.seconds,
        fullMoons: num.full_moons, perseids: num.perseids,
        orbitalKm: num.orbital_km, orbitalKmHe: num.orbital_km_he,
        footnote: num.footnote_he
      };
    }
    var now = Date.now();
    var ms = Math.max(0, now - birth);
    var sec = Math.floor(ms / 1000);
    var days = Math.floor(ms / 86400000);
    var hours = Math.floor(ms / 3600000);
    var years = days / 365.2422;
    // full moons ≈ one per synodic month (29.5306 days); perseids ≈ one Aug/year.
    var fullMoons = Math.floor(days / 29.530588);
    var perseids = Math.floor(years);                  // ~one birthday-Perseids per year lived
    // orbital distance: Earth travels ~29.78 km/s around the Sun.
    var orbitalKm = Math.round(sec * 29.78);
    return {
      live:true, birth:birth,
      years: Math.floor(years), days: days, hours: hours, seconds: sec,
      fullMoons: fullMoons, perseids: perseids,
      orbitalKm: orbitalKm, orbitalKmHe: num.orbital_km_he,
      footnote: num.footnote_he
    };
  }

  // the 3-day hazard forecast strip (was hidden) — measured forecast.
  function forecast3(){
    var W = window.Weather;
    if (!W || !W.hazardForecast) return null;
    var arr = W.hazardForecast(3);
    return (Array.isArray(arr) && arr.length) ? arr : null;
  }

  // the single top alert that matters right now (or null = all-clear).
  function topAlert(date){
    var Al = window.Alerts;
    if (!Al || !Al.collect) return undefined;          // undefined = engine absent
    try {
      var list = Al.collect(date) || [];
      // prefer an actionable (non-"good") alert if one exists, else the first.
      var actionable = list.filter(function(a){ return a && a.sev && a.sev !== 'good'; });
      return (actionable[0] || list[0] || null);
    } catch(e){ return null; }
  }

  // this-season REAL backyard totals from the RecordStore logbook (~90 days).
  function seasonTotals(date){
    var RS = window.RecordStore;
    if (!RS || !RS.zoneTotals) return { state:'absent' };
    function iso(d){ var z=function(n){return String(n).padStart(2,'0');};
      return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate()); }
    var to = new Date(date), from = new Date(date.getTime() - 90*86400000);
    var st = (RS.status) ? (function(){ try{ return RS.status(); }catch(e){ return null; } })() : null;
    var tot = null;
    try { tot = RS.zoneTotals(BACKYARD, iso(from), iso(to)); } catch(e){ tot = null; }
    if (!tot || !isNum(tot.days) || tot.days <= 0) {
      return { state: (st && st.building) ? 'building' : 'empty', status: st };
    }
    return { state:'ready', tot:tot, status:st };
  }

  /* ====================================================================
   * render
   * ================================================================== */

  function dustHe(d){
    if (d == null) return null;
    if (d < 40) return 'Clean';
    if (d < 90) return 'Light dust';
    if (d < 150) return 'Dusty';
    return 'Dust storm';
  }

  // time-of-day greeting off the SAME date the hero already uses (in-scope /
  // scrub date if present, else now), keyed to the local hour so a night
  // view never says "good morning" at night. Same greeting style as the rest of the hero.
  function greetHe(date){
    var h = localHour(date);
    if (h >= 5  && h < 11) return 'Good morning';
    if (h >= 11 && h < 16) return 'Good afternoon';
    if (h >= 16 && h < 21) return 'Good evening';
    return 'Good night';
  }

  function html(date){
    var d = date || new Date();
    var dow = DOW_HE[d.getDay()], mn = MONTHS_HE[d.getMonth()];
    var head = '<div class="ohHero"><div class="ohHi">' + greetHe(d) + ', Alex</div>' +
      '<div class="ohDate">' + dow + ' · ' + d.getDate() + ' ' + mn + '</div>' +
      '<div class="ohPlace">Your home · Larkmont</div></div>';

    return '<div class="ohWrap" dir="ltr">' + head +
      '<div class="ohGrid">' +
        nowCard(d) +
        energyNowCard(d) +
        tonightCard(d) +
        forecastCard() +
        alertCard(d) +
        seasonCard(d) +
        newspaperCard() +
      '</div>' +
      '<div class="ohFoot">🟢 Measured — accumulating real measurements (the logbook) · 🟡 Model / forecast — Open-Meteo regional + house geometry. No physical sensor on site.</div>' +
      '</div>';
  }

  /* ---- Now: live temp + house delta + measured air ---- */
  function nowCard(date){
    var n = liveNow(date);
    var measTag = '<span class="ohTag model">🟡 Regional · Model</span>';
    var body = '';
    if (n.town == null) {
      body = '<div class="ohEmpty">Weather loading…</div>';
    } else {
      var sub = n.live ? 'Live measurement' : 'Offline — default value';
      body += '<div class="ohBig">' + Math.round(n.town) + '°<span class="ohBigU">in town</span></div>';
      var extra = [];
      if (n.desc) extra.push(esc(n.desc));
      if (n.hum != null) extra.push('Humidity ' + n.hum + '%');
      if (n.wind != null) extra.push('Wind ' + n.wind + ' km/h');
      if (extra.length) body += '<div class="ohSub">' + extra.join(' · ') + '</div>';
      // geometry-modeled house delta
      if (n.mc && isNum(n.mc.delta) && Math.abs(n.mc.delta) >= 0.1) {
        var cooler = n.mc.delta < 0;
        body += '<div class="ohRow"><span>At your home <span class="ohTag model">🟡 Model</span><span data-xpl-mc></span></span>' +
          '<b style="color:' + (cooler ? '#9fc2e0' : '#e0b070') + '">' + n.mc.temp + '° · ' +
          (cooler ? 'cooler ' : 'warmer ') + r1(Math.abs(n.mc.delta)) + '° than town</b></div>';
      } else if (n.mc && isNum(n.mc.temp)) {
        body += '<div class="ohRow"><span>At your home <span class="ohTag model">🟡 Model</span><span data-xpl-mc></span></span><b>' + n.mc.temp + '°</b></div>';
      }
      // measured air quality
      if (n.air) {
        var dustV = isNum(n.air.dust) ? Math.round(n.air.dust) : null;
        var pm10 = isNum(n.air.pm10) ? Math.round(n.air.pm10) : null;
        var uv = isNum(n.air.uv) ? r1(n.air.uv) : null;
        if (dustV != null || pm10 != null) {
          var lbl = dustHe(dustV != null ? dustV : pm10);
          var val = (dustV != null ? (dustV + ' µg/m³ dust') : (pm10 + ' µg/m³ PM10'));
          body += '<div class="ohRow"><span>Air quality ' + measTag + '<span data-xpl-air></span></span><b>' + (lbl ? lbl + ' · ' : '') + val + '</b></div>';
        }
        if (uv != null) {
          var uvLbl = uv >= 8 ? 'Very high' : uv >= 6 ? 'High' : uv >= 3 ? 'Medium' : 'Low';
          body += '<div class="ohRow"><span>UV index ' + measTag + '<span data-xpl-uv></span></span><b>' + uv + ' · ' + uvLbl + '</b></div>';
        }
      } else {
        body += '<div class="ohHint">Air quality loading in the background…</div>';
      }
    }
    return card('☀️', 'Now', body, 'env');
  }

  /* ---- Tonight: stargazing verdict + next dark night ---- */
  function tonightCard(date){
    var t = tonight(date);
    var body = '';
    if (!t) {
      body = '<div class="ohEmpty">Sky engine loading…</div>';
    } else {
      var go = t.go;
      if (go) {
        var cls = go.score >= 80 ? 'hi' : go.score >= 60 ? 'mid' : go.score >= 40 ? 'mid' : 'lo';
        body += '<div class="ohVerdict ' + cls + '">' + esc(go.verdict) + '<span data-xpl-go></span></div>';
        body += '<div class="ohScore"><span class="ohScoreN">' + go.score + '</span><span class="ohScoreD">/100 · viewing score · Bortle-3</span></div>';
        body += '<div class="ohRow"><span>Sky transparency</span><b>' + Math.round((go.transparency != null ? go.transparency : 1) * 100) + '%</b></div>';
      } else {
        body += '<div class="ohHint">The score will appear after dusk (currently daytime).</div>';
      }
      var illum = Math.round(t.moon.illum * 100);
      body += '<div class="ohRow"><span>Moon</span><b>' + esc(t.moon.name) + ' · ' + illum + '% lit</b></div>';
      if (t.nightCloud != null)
        body += '<div class="ohRow"><span>Evening cloud cover</span><b>~' + Math.round(t.nightCloud*100) + '%</b></div>';
      if (t.dark) {
        var da = t.dark.daysAway;
        var when = (da === 0) ? 'Tonight' : (da === 1) ? 'Tomorrow night' : ('In ' + da + ' nights');
        body += '<div class="ohRow"><span>Next dark night<span data-xpl-dark></span></span><b>' + when + ' · Moon ' + Math.round(t.dark.illum*100) + '%</b></div>';
      }
      body += '<div class="ohHint">Ephemeris moon · forecast cloud cover (Open-Meteo)</div>';
    }
    return card('🌌', 'Tonight · Stars', body, 'sky');
  }

  /* ---- 3 days: hazard forecast strip ---- */
  function forecastCard(){
    var f = forecast3();
    var body = '';
    if (!f) {
      body = '<div class="ohHint">3-day forecast loading…</div>';
    } else {
      body = '<div class="ohFc">' + f.map(function(d, i){
        var dt = d.date ? new Date(d.date + 'T12:00:00') : null;
        var lbl = (i === 0) ? 'Today' : (dt ? DOW_HE[dt.getDay()] : '—');
        var icon = wxIcon(d.code, d.snowCm, d.rainMm);
        var bits = [];
        if (isNum(d.tmin)) bits.push('min ' + Math.round(d.tmin) + '°');
        if (isNum(d.rainMm) && d.rainMm > 0) bits.push('🌧️ ' + r1(d.rainMm) + ' mm');
        else if (isNum(d.rainProb) && d.rainProb > 0) bits.push(d.rainProb + '% rain');
        if (isNum(d.snowCm) && d.snowCm > 0) bits.push('❄️ ' + r1(d.snowCm) + ' cm');
        if (isNum(d.windMax)) bits.push('💨 ' + Math.round(d.windMax));
        return '<div class="ohFcD"><div class="ohFcDow">' + lbl + '</div>' +
          '<div class="ohFcIc">' + icon + '</div>' +
          '<div class="ohFcM">' + (bits.length ? bits.join('<br>') : '—') + '</div></div>';
      }).join('') + '</div>';
      body += '<div class="ohHint">Forecast (Open-Meteo) · wind in km/h</div>';
    }
    return card('📅', 'Three days ahead', body, 'env');
  }

  function wxIcon(code, snow, rain){
    if (isNum(snow) && snow > 0) return '❄️';
    if (isNum(code)) {
      if (code >= 95) return '⛈️';
      if (code >= 80 || (code >= 51 && code <= 67)) return '🌧️';
      if (code >= 71 && code <= 77) return '❄️';
      if (code >= 45 && code <= 48) return '🌫️';
      if (code >= 1 && code <= 3) return '⛅';
      if (code === 0) return '☀️';
    }
    if (isNum(rain) && rain > 0) return '🌧️';
    return '☀️';
  }

  /* ---- Alert: top alert (or all-clear) ---- */
  function alertCard(date){
    var a = topAlert(date);
    var body;
    if (a === undefined) {
      body = '<div class="ohHint">Alerts engine loading…</div>';
    } else if (!a) {
      body = '<div class="ohCalm"><span class="ohCalmIc">✓</span> All calm — no active alerts.</div>' +
        '<div class="ohHint">Alerts appear only when something truly needs your attention.</div>';
    } else {
      var sevCls = a.sev === 'cold' ? 'cold' : a.sev === 'warn' ? 'warn' : a.sev === 'good' ? 'good' : 'info';
      body = '<div class="ohAlert ' + sevCls + '"><span class="ohAlertIc">' + (a.icon || '⚠️') + '</span>' +
        '<span class="ohAlertTx">' + esc(a.he || '') + '</span></div>';
    }
    return card('🔔', 'What matters now', body);
  }

  /* ---- Cosmos meter: the COSMIC ODOMETER (live-ticking) ---- */
  function odometerCard(){
    var o = odometer();
    var body;
    if (!o) {
      body = '<div class="ohHint">Cosmic odometer loading…</div>';
    } else {
      body = '<div class="ohOdoGrid">' +
        odoCell('🌍', 'Days on Earth', intHe(o.days)) +
        odoCell('🕐', 'Hours', intHe(o.hours)) +
        odoCell('🌕', 'Full moons', intHe(o.fullMoons)) +
        odoCell('🌠', 'Perseid meteors', intHe(o.perseids)) +
        '</div>';
      // the live-ticking marquee: seconds + km traveled around the Sun
      body += '<div class="ohOdoBig"><span class="ohOdoLab">Seconds since you were born</span>' +
        '<span class="ohOdoSec" id="ohOdoSec">' + intHe(o.seconds) + '</span></div>';
      var km = o.orbitalKmHe || (isNum(o.orbitalKm) ? intHe(o.orbitalKm) + ' km' : null);
      if (km)
        body += '<div class="ohRow"><span>🛰️ Distance you have traveled around the Sun</span><b id="ohOdoKm">' +
          esc(o.orbitalKm != null ? intHe(o.orbitalKm) + ' km' : km) + '</b></div>';
      if (o.footnote) body += '<div class="ohHint">' + esc(o.footnote) + '</div>';
    }
    return card('🪐', 'Your cosmic odometer', body);
  }
  function odoCell(ic, lab, val){
    return '<div class="ohOdoCell"><div class="ohOdoIc">' + ic + '</div>' +
      '<div class="ohOdoVal">' + esc(val) + '</div>' +
      '<div class="ohOdoCap">' + esc(lab) + '</div></div>';
  }

  /* ---- This month: in-season species ---- */
  function natureCard(){
    var ms = monthSpecies(6);
    var body;
    if (ms == null) {
      body = '<div class="ohHint">Nature guide loading…</div>';
    } else if (!ms.list.length) {
      body = '<div class="ohHint">No species in season this month.</div>';
    } else {
      body = '<div class="ohSpecies">' + ms.list.map(function(s){
        var thumb = (s.photo && s.photo.local)
          ? '<span class="ohSpIm"><img src="' + esc(s.photo.local) + '" alt="" loading="lazy"></span>'
          : '<span class="ohSpIm emoji">' + (EMOJI[s.cat] || '•') + '</span>';
        return '<div class="ohSp">' + thumb +
          '<span class="ohSpN">' + esc(s.he) + '<span class="ohSpSci">' + esc(s.sci || '') + '</span></span></div>';
      }).join('') + '</div>';
      if (ms.total > ms.list.length)
        body += '<div class="ohHint">And ' + (ms.total - ms.list.length) + ' more species in season — in the "Nature" tab.</div>';
      else
        body += '<div class="ohHint">What is alive around you this month — data verified for the region.</div>';
    }
    return card('🦌', 'In the area · ' + MONTHS_HE[curMonth()-1], body, 'wild');
  }

  /* ---- Season: real backyard totals from RecordStore (~90 days) ---- */
  function seasonCard(date){
    var s = seasonTotals(date);
    var body;
    if (s.state === 'absent') {
      body = '<div class="ohHint">The climate logbook has not been enabled in this version yet.</div>';
    } else if (s.state === 'building') {
      var pct = (s.status && isNum(s.status.pct)) ? Math.round(s.status.pct) : null;
      body = '<div class="ohHint">Building the logbook from real weather data' +
        (pct != null ? (' · ' + pct + '%') : '') + '… totals will appear soon.</div>';
    } else if (s.state === 'empty') {
      body = '<div class="ohHint">No days recorded in the logbook yet.</div>';
    } else {
      var t = s.tot;
      body = '<div class="ohTag meas">🟢 Based on real measurements</div><span data-xpl-rec></span>';
      body += '<div class="ohSeas">';
      if (isNum(t.frostNights)) body += seasCell('❄️', 'Frost nights', intHe(t.frostNights));
      if (isNum(t.dliSum)) body += seasCell('☀️', 'Total DLI', intHe(Math.round(t.dliSum)) + ' mol/m²');
      if (isNum(t.rainSum)) body += seasCell('🌧️', 'Cumulative rain', r1(t.rainSum) + ' mm');
      if (isNum(t.sunHoursSum)) body += seasCell('🕐', 'Sun hours', intHe(Math.round(t.sunHoursSum)));
      body += '</div>';
      var range = [];
      if (isNum(t.tMinAbs)) range.push('low ' + r1(t.tMinAbs) + '°');
      if (isNum(t.tMaxAbs)) range.push('high ' + r1(t.tMaxAbs) + '°');
      if (range.length) body += '<div class="ohRow"><span>Temperature extremes</span><b>' + range.join(' · ') + '</b></div>';
      body += '<div class="ohHint">Measured weather, filtered through the shade and geometry of the yard · last ' +
        (isNum(t.days) ? t.days + ' days' : '~90 days') + '</div>';
    }
    return card('📓', 'The season in the yard · Real', body, 'yard');
  }
  function seasCell(ic, lab, val){
    return '<div class="ohSeasCell"><div class="ohSeasIc">' + ic + '</div>' +
      '<div class="ohSeasVal">' + esc(val) + '</div>' +
      '<div class="ohSeasCap">' + esc(lab) + '</div></div>';
  }

  /* ---- Energy now: live PV from measured irradiance (mirrors the energy-tab lead) ---- */
  function energyNowCard(date){
    var W = window.Weather, D = window.Derive;
    var rs = null; try { rs = (D && D.roofSolar) ? D.roofSolar() : null; } catch(e){ rs = null; }
    var kWp = rs ? rs.peak_kw : null;
    if (kWp == null) return '';
    var ghi = (W && W.envAt) ? W.envAt('rad', date) : null;
    var sun = window.Astro ? window.Astro.sun(date) : null;
    var DERATE = 0.80;
    var pvNow = (ghi != null && isFinite(ghi)) ? Math.max(0, kWp*(Math.max(0,ghi)/1000)*DERATE) : null;
    var todayKwh = null;
    if (W && W.envAt){
      var d0 = new Date(date); d0.setHours(0,0,0,0); var sum=0, any=false;
      for (var h=0; h<=date.getHours(); h++){ var r=W.envAt('rad', new Date(d0.getTime()+h*3600000)); if(r!=null&&isFinite(r)){ sum+=Math.max(0,r)/1000*kWp*DERATE; any=true; } }
      if (any) todayKwh = sum;
    }
    var isDay = !!(sun && sun.altDeg > 0);
    var body = '<div class="ohTag model">🟡 Based on modeled irradiance</div><span data-xpl-pv></span>';
    body += '<div class="ohBig">' + (pvNow!=null ? pvNow.toFixed(2) : '—') + '<span class="ohBigU">kW now</span></div>';
    body += '<div class="ohSub">' + (isDay ? ('Sun at altitude ' + Math.round(sun.altDeg) + '°') : 'Sun below the horizon') + '</div>';
    if (ghi != null && isFinite(ghi)) body += '<div class="ohRow"><span>☀️ Irradiance now</span><b>' + Math.round(Math.max(0,ghi)) + ' W/m²</b></div>';
    if (todayKwh != null) body += '<div class="ohRow"><span>📈 Generated so far today</span><b>~' + todayKwh.toFixed(1) + ' kWh</b></div>';
    body += '<div class="ohHint">Estimated from irradiance × ' + kWp.toFixed(1) + ' kWp × ~0.8 — not a production-meter reading.</div>';
    return card('⚡', 'Energy now', body, 'energy');
  }
  /* ---- Garden newspaper: opens the weekly garden magazine ---- */
  function newspaperCard(){
    var g = window.__garden;
    if (!g || !g.openMag) return '';
    var body = '<div class="ohSub">The garden\'s weekly story — harvest, tasks, irrigation, and plant of the week.</div>' +
      '<button class="ohBtn" data-oh-mag="1" style="margin-top:8px;width:100%;cursor:pointer">📰 Open the garden newspaper</button>';
    return card('📰', 'Garden newspaper', body);
  }

  /* ====================================================================
   * "?" explain chips — mount the universal Explain.chip() onto the cockpit's
   * significant computed values, AFTER the HTML string is painted. Mirrors the
   * panels.js pattern: a <span data-xpl-…> placeholder in the HTML is replaced
   * by a real chip. Each chip auto-fills from data/explain_content.json by its
   * metric_id (title/what/how/source/caveat), so the honesty "estimate" badge and
   * model/measured framing stay consistent with the rest of the app. Fully
   * defensive: no-ops if Explain is absent or a slot isn't found (e.g. the test
   * DOM stub), so it never breaks render or the home test.
   * ================================================================== */
  function mountChip(host, sel, metricId){
    try{
      if (!host || !host.querySelector || !window.Explain || !window.Explain.chip) return;
      var slot = host.querySelector(sel);
      if (!slot || !slot.replaceWith) return;
      slot.replaceWith(window.Explain.chip({ metric_id: metricId }));
    }catch(e){ /* never break render over a chip */ }
  }
  function mountChips(host){
    if (!host) return;
    mountChip(host, '[data-xpl-mc]',   'microclimate_temp'); // house-vs-town delta
    mountChip(host, '[data-xpl-air]',  'dust_aqi');          // air quality / dust
    mountChip(host, '[data-xpl-uv]',   'uv_index');          // UV index
    mountChip(host, '[data-xpl-go]',   'goOutScore');        // stargazing verdict
    mountChip(host, '[data-xpl-dark]', 'nextDarkNight');     // next dark night
    mountChip(host, '[data-xpl-pv]',   'roofSolar_annual_kwh'); // live PV / roof solar
    mountChip(host, '[data-xpl-rec]',  'record_zoneTotals'); // season real totals
  }

  /* ---- one glass card ---- · pass a `tab` key to make the whole card a jump
     into that tab (the delegated host.onclick emits Bus 'tab:open' on a
     genuine user click — never in render, so no emit-loop). ---- */
  function card(ic, title, body, tab){
    var jump = tab ? ' data-oh-tab="' + esc(tab) + '" role="link" tabindex="0"' : '';
    return '<section class="ohCard' + (tab ? ' ohCardLink' : '') + '"' + jump + '><div class="ohCardHd"><span class="ohCardIc">' + ic + '</span>' +
      '<span class="ohCardT">' + esc(title) + '</span></div>' +
      '<div class="ohCardBody">' + body + '</div></section>';
  }

  /* ====================================================================
   * live tick — re-paint only the fast-moving seconds + km, every second.
   * ================================================================== */
  function liveTickFrame(){
    try {
      var doc = window.document;
      if (!doc) return;
      var secEl = doc.getElementById && doc.getElementById('ohOdoSec');
      var kmEl = doc.getElementById && doc.getElementById('ohOdoKm');
      if (!secEl && !kmEl) return;
      var o = odometer();
      if (!o) return;
      if (secEl && o.seconds != null) secEl.textContent = intHe(o.seconds);
      if (kmEl && o.orbitalKm != null) kmEl.textContent = intHe(o.orbitalKm) + ' km';
    } catch(e){}
  }
  function startTick(){
    stopTick();
    try { _tick = setInterval(liveTickFrame, 1000); } catch(e){ _tick = null; }
  }
  function stopTick(){ if (_tick){ try{ clearInterval(_tick); }catch(e){} _tick = null; } }

  /* ====================================================================
   * public render — paint into the host, then start the live tick.
   * ================================================================== */
  function render(host, date){
    if (!host) return;
    ensureCSS();
    _host = host;
    _date = date || new Date();
    host.setAttribute && host.setAttribute('dir','ltr');
    host.innerHTML = html(_date);
    mountChips(host);
    host.onclick = function(e){
      var mb = e.target.closest && e.target.closest('[data-oh-mag]');
      if (mb){ if (window.__garden && window.__garden.openMag){ try{ window.__garden.openMag(); }catch(err){} } return; }
      // ONE-BRAIN: a card tagged with data-oh-tab jumps to its tab. emit
      // only here, on a genuine user click (never inside render), so no loop.
      var tb = e.target.closest && e.target.closest('[data-oh-tab]');
      if (tb){
        var tab = tb.getAttribute && tb.getAttribute('data-oh-tab');
        if (tab && window.Bus && window.Bus.emit){ try{ window.Bus.emit('tab:open', { tab: tab }); }catch(err){} }
      }
    };
    startTick();
    // ensure species/record data shows up when it finishes loading after first paint.
    try {
      if (window.Nature && window.Nature.onReady && (!window.Nature.isReady || !window.Nature.isReady()))
        window.Nature.onReady(function(){ if (_host === host) repaint(); });
      else if (window.Nature && window.Nature.load && (!window.Nature._data || !window.Nature._data()))
        window.Nature.load();
    } catch(e){}
  }
  function repaint(){
    if (!_host) return;
    try { _host.innerHTML = html(_date || new Date()); mountChips(_host); } catch(e){}
  }

  /* ====================================================================
   * scoped CSS — the dark gold-on-glass #inst language (mirrors zone_card /
   * nature). All selectors scoped under #homeMain / .ohWrap so nothing leaks.
   * ================================================================== */
  function ensureCSS(){
    var doc = window.document;
    if (!doc || !doc.getElementById) return;
    if (doc.getElementById('alex-home-css')) return;
    var s = doc.createElement('style');
    s.id = 'alex-home-css';
    s.textContent =
      '.ohWrap{font-family:Heebo,sans-serif;color:#efe6cf;direction:ltr;' +
        'text-shadow:0 1px 4px rgba(0,0,0,.5)}' +
      '.ohHero{margin:2px 0 16px}' +
      '.ohHero .ohHi{font-family:"Frank Ruhl Libre",serif;font-weight:500;font-size:26px;color:#fff7e6;line-height:1.1}' +
      '.ohHero .ohDate{font-family:Bellefair,serif;letter-spacing:.04em;font-size:15px;color:' + GOLD + ';margin-top:4px}' +
      '.ohHero .ohPlace{font-size:11.5px;color:#a99b78;margin-top:2px}' +
      '.ohGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:13px}' +
      '.ohCard{background:linear-gradient(160deg,rgba(12,14,26,.93),rgba(6,7,15,.95));' +
        'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
        'border:1px solid rgba(202,161,90,.22);border-radius:12px;padding:14px 15px;' +
        'box-shadow:0 14px 38px rgba(0,0,0,.42);display:flex;flex-direction:column}' +
      '.ohCardLink{cursor:pointer;transition:border-color .15s,box-shadow .15s}' +
      '.ohCardLink:hover{border-color:rgba(202,161,90,.45);box-shadow:0 16px 42px rgba(0,0,0,.5)}' +
      '.ohCardHd{display:flex;align-items:center;gap:8px;margin-bottom:9px;' +
        'border-bottom:1px solid rgba(202,161,90,.14);padding-bottom:8px}' +
      '.ohCardIc{font-size:17px}' +
      '.ohCardT{font-family:Bellefair,serif;letter-spacing:.04em;font-size:15px;color:' + GOLD + '}' +
      '.ohCardBody{font-size:12.5px;color:#d6ccb2;line-height:1.5}' +
      // shared bits
      '.ohBig{font-family:"Frank Ruhl Libre",serif;font-size:40px;color:#fff7e6;line-height:1;display:flex;align-items:baseline;gap:8px}' +
      '.ohBigU{font-size:13px;color:#a99b78;font-family:Heebo}' +
      '.ohSub{font-size:11.5px;color:#a99b78;margin:5px 0 3px}' +
      '.ohRow{display:flex;justify-content:space-between;align-items:center;gap:8px;' +
        'padding:6px 0;border-top:1px solid rgba(202,161,90,.1)}' +
      '.ohRow span{color:#bdb293} .ohRow b{color:#fff7e6;font-weight:600;text-align:left}' +
      '.ohHint{font-size:10.5px;color:#8b8062;line-height:1.5;margin-top:8px}' +
      '.ohEmpty{font-size:12px;color:#9b9075;padding:6px 0}' +
      '.ohTag{font-size:9px;padding:1px 7px;border-radius:20px;white-space:nowrap;margin-inline-start:5px}' +
      '.ohTag.meas{background:rgba(120,200,120,.16);color:#a7e0a7;border:1px solid rgba(120,200,120,.4)}' +
      '.ohTag.model{background:rgba(224,178,74,.16);color:#e8c474;border:1px solid rgba(224,178,74,.4)}' +
      // tonight
      '.ohVerdict{font-family:"Frank Ruhl Libre",serif;font-size:20px;line-height:1.15;margin-bottom:6px}' +
      '.ohVerdict.hi{color:#a7e0a7} .ohVerdict.mid{color:#e8c474} .ohVerdict.lo{color:#e0a8a8}' +
      '.ohScore{display:flex;align-items:baseline;gap:6px;margin-bottom:4px}' +
      '.ohScoreN{font-size:30px;font-family:"Frank Ruhl Libre",serif;color:#fff7e6;line-height:1}' +
      '.ohScoreD{font-size:11px;color:#a99b78}' +
      // forecast strip
      '.ohFc{display:flex;gap:7px}' +
      '.ohFcD{flex:1;text-align:center;background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.13);' +
        'border-radius:9px;padding:9px 5px}' +
      '.ohFcDow{font-size:11px;color:' + GOLD + ';font-family:Bellefair,serif}' +
      '.ohFcIc{font-size:22px;margin:5px 0}' +
      '.ohFcM{font-size:10px;color:#cdbf9b;line-height:1.5}' +
      // alert
      '.ohAlert{display:flex;gap:9px;align-items:flex-start;padding:9px 11px;border-radius:9px;' +
        'background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.2)}' +
      '.ohAlert .ohAlertIc{font-size:19px;line-height:1.2}' +
      '.ohAlert .ohAlertTx{font-size:12.5px;color:#f0e6cf;line-height:1.5}' +
      '.ohAlert.cold{border-color:rgba(120,150,235,.45);background:rgba(120,150,235,.1)}' +
      '.ohAlert.warn{border-color:rgba(224,178,74,.45);background:rgba(224,178,74,.1)}' +
      '.ohAlert.good{border-color:rgba(120,200,120,.4);background:rgba(120,200,120,.08)}' +
      '.ohCalm{display:flex;align-items:center;gap:8px;color:#a7e0a7;font-size:13px;' +
        'padding:8px 10px;border-radius:9px;background:rgba(120,200,120,.08);border:1px solid rgba(120,200,120,.3)}' +
      '.ohCalm .ohCalmIc{font-size:16px}' +
      // odometer
      '.ohOdoGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}' +
      '.ohOdoCell{text-align:center;background:rgba(255,255,255,.035);border:1px solid rgba(202,161,90,.12);' +
        'border-radius:9px;padding:8px 4px}' +
      '.ohOdoIc{font-size:17px}' +
      '.ohOdoVal{font-family:"Frank Ruhl Libre",serif;font-size:18px;color:#fff7e6;margin:2px 0;line-height:1.1}' +
      '.ohOdoCap{font-size:9.5px;color:#a99b78;line-height:1.3}' +
      '.ohOdoBig{background:linear-gradient(120deg,rgba(202,161,90,.14),rgba(202,161,90,.04));' +
        'border:1px solid rgba(202,161,90,.3);border-radius:10px;padding:10px 12px;text-align:center;margin-bottom:4px}' +
      '.ohOdoLab{display:block;font-size:10px;color:#cdbf9b;font-family:Bellefair,serif;letter-spacing:.05em}' +
      '.ohOdoSec{display:block;font-family:"Frank Ruhl Libre",serif;font-size:27px;color:#fff7e6;' +
        'letter-spacing:.02em;line-height:1.15;direction:ltr;unicode-bidi:plaintext}' +
      // species
      '.ohSpecies{display:flex;flex-direction:column;gap:4px}' +
      '.ohSp{display:flex;align-items:center;gap:9px;padding:4px 4px;border-radius:8px}' +
      '.ohSp:hover{background:rgba(202,161,90,.06)}' +
      '.ohSpIm{width:34px;height:34px;flex:0 0 34px;border-radius:7px;overflow:hidden;display:flex;' +
        'align-items:center;justify-content:center;background:rgba(255,255,255,.05);font-size:18px}' +
      '.ohSpIm img{width:100%;height:100%;object-fit:cover;display:block}' +
      '.ohSpN{flex:1;min-width:0;color:#ece6d8;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.ohSpSci{display:block;color:#857c66;font-size:10px;font-style:italic}' +
      // season totals
      '.ohSeas{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0 2px}' +
      '.ohSeasCell{text-align:center;background:rgba(255,255,255,.035);border:1px solid rgba(202,161,90,.12);' +
        'border-radius:9px;padding:8px 4px}' +
      '.ohSeasIc{font-size:16px}' +
      '.ohSeasVal{font-family:"Frank Ruhl Libre",serif;font-size:17px;color:#fff7e6;margin:2px 0;line-height:1.1}' +
      '.ohSeasCap{font-size:9.5px;color:#a99b78;line-height:1.3}' +
      '.ohFoot{margin-top:16px;padding-top:11px;border-top:1px solid rgba(202,161,90,.14);' +
        'font-size:10px;color:#7d7150;line-height:1.6}' +
      '.ohBtn{background:linear-gradient(160deg,rgba(202,161,90,.18),rgba(202,161,90,.06));border:1px solid rgba(202,161,90,.35);color:#f0e6cf;border-radius:9px;padding:9px 12px;font-family:Heebo,sans-serif;font-size:13px}' +
      '.ohBtn:hover{border-color:rgba(202,161,90,.6);color:#fff7e6;background:rgba(202,161,90,.16)}' +
      '@media(max-width:640px){.ohGrid{grid-template-columns:1fr}.ohHero .ohHi{font-size:23px}}' +
      // ---- phone pass (<=760px): single-column, no horizontal overflow, ----
      // ---- readable fonts, comfortable tap targets. Desktop untouched.  ----
      '@media(max-width:760px){' +
        '.ohWrap{max-width:100%}' +
        // collapse the auto-fill grid to one column so cards go full-width
        '.ohGrid{grid-template-columns:1fr;gap:11px}' +
        '.ohHero{margin:2px 0 13px}' +
        '.ohHero .ohHi{font-size:22px}' +
        '.ohHero .ohDate{font-size:14px}' +
        // trim heavy card padding a touch
        '.ohCard{padding:13px 13px;border-radius:11px}' +
        // shrink the oversized hero number so the unit stays on one line
        '.ohBig{font-size:34px}' +
        '.ohScoreN{font-size:26px}' +
        '.ohVerdict{font-size:18px}' +
        // give rows breathing room + a bigger touch zone
        '.ohRow{padding:8px 0}' +
        // forecast strip: let the 3 day-cards wrap instead of squashing
        '.ohFc{flex-wrap:wrap;gap:6px}' +
        '.ohFcD{flex:1 1 28%;min-width:84px;padding:8px 4px}' +
        '.ohFcIc{font-size:20px}' +
        // odometer + season grids stay 2-up but tighten
        '.ohOdoGrid,.ohSeas{gap:7px}' +
        '.ohOdoSec{font-size:23px}' +
        // species rows: a touch more vertical room for tapping/reading
        '.ohSp{padding:6px 4px}' +
        // full-width magazine button with a solid tap target on phones
        '.ohBtn{width:100%;padding:11px 12px;font-size:14px}' +
        // keep the smallest labels at the 11px readability floor
        '.ohHint{font-size:11px}.ohOdoCap,.ohSeasCap{font-size:11px}' +
        '.ohFcM{font-size:10.5px}' +
        '.ohFoot{font-size:10.5px;margin-top:14px}' +
      '}';
    doc.head.appendChild(s);
  }

  /* also fetch resident_numbers.json directly so the odometer works even before
     Derive.data.numbers is populated (degrade gracefully if fetch is absent). */
  function loadNumbers(){
    try {
      if (typeof fetch !== 'function') return;
      fetch('data/resident_numbers.json').then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){ if (j){ _numbers = j; } })
        .catch(function(){});
    } catch(e){}
  }

  window.__home = {
    render: render,
    _odometer: odometer,        // exposed for the load-test / QA
    _stop: stopTick
  };

  loadNumbers();
})();
