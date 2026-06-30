/* ===========================================================================
 * calendar.js · "הבית של אלכס" — לוּחַ הַשָּׁנָה בַּגִּינָה (the garden year-calendar)
 * ---------------------------------------------------------------------------
 * A classic month-grid calendar for Larkmont, painted in the #inst
 * dark/gold RTL skin, with TWO toggleable overlay LAYERS over the day cells:
 *
 *   🌌  STARS (astronomical) — per-day interesting sky events, all from the
 *       app's REAL ephemeris engines (no fabricated data):
 *         • moon-phase glyph + illum% per day  (Astro.moon)
 *         • meteor-shower peaks                 (Derive.nextMeteor, walked)
 *         • the galactic-core "season"          (Derive.galacticCore)
 *         • the next DARK (new-moon) night       (Derive.nextDarkNight)
 *         • notable ISS passes (this month, near today)  (Satellites.nextPass)
 *       Twilight times (Derive.twilightTimes) appear in the day detail.
 *
 *   🌡️  CLIMATE (real measurements of HIS house) — for PAST days only, the
 *       ACTUAL measured conditions from RecordStore.dayRecord(dateISO):
 *       the cell is tinted by the day's town Tmax, and frost-nights / rain
 *       get a small marker. This is "the climate layer of his actual house".
 *
 * Clicking a day opens a small in-grid detail card: that day's sky events +,
 * for past days, its real measured climate. Every surfaced number is labeled
 * honestly — מבוסס מדידות אמת (measured weather) vs מחושב לפי הגיאומטריה
 * (geometry-modeled). NEVER implies a physical sensor.
 *
 * Self-contained: owns its own DOM + CSS (ensureCSS, scoped #homeCal). Reads
 * only documented globals (Astro, Derive, Satellites, RecordStore); degrades
 * gracefully when any is missing / not yet ready / a day has no record.
 * No <script> tags, no tab registration — the integrator wires panels.js.
 *
 * Public API:  window.__calendar.render(hostEl, date)
 * ======================================================================== */
(function () {
  'use strict';
  if (window.__calendar) return;

  var GOLD = '#caa15a';
  var MONTHS_HE = ['יָנוּאָר','פֶבְּרוּאָר','מֵרְץ','אַפְּרִיל','מַאי','יוּנִי','יוּלִי','אוֹגוּסְט','סֶפְּטֶמְבֶּר','אוֹקְטוֹבֶּר','נוֹבֶמְבֶּר','דֶצֶמְבֶּר'];
  // Sunday-first week (regional convention); ש = שבת
  var DOW_HE = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','שׁ'];

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function isoOf(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function r1(v){ return Math.round(v*10)/10; }
  function startOfDay(d){ var x=new Date(d); x.setHours(0,0,0,0); return x; }
  function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }

  /* ---- moon-phase glyph (mirrors panels.js moonGlyph exactly) ------------- */
  function moonGlyph(frac, waxing){
    var f=((frac%1)+1)%1;
    if(f<0.03||f>0.97) return '🌑';
    if(Math.abs(f-0.25)<0.06) return waxing?'🌓':'🌗';
    if(Math.abs(f-0.5)<0.04)  return '🌕';
    if(f<0.5) return waxing?'🌒':'🌘';
    return waxing?'🌔':'🌖';
  }

  /* ---- the live engines (all optional; we degrade if absent) -------------- */
  function ASTRO(){ return window.Astro || null; }
  function DERIVE(){ return window.Derive || null; }
  function STORE(){ return window.RecordStore || null; }
  function SATS(){ return window.Satellites || null; }

  /* ---- moon snapshot for a day (deep-night ~01:00 so the phase is stable) - */
  function moonForDay(d){
    var A=ASTRO(); if(!A||!A.moon) return null;
    var t=new Date(d); t.setHours(1,0,0,0);
    var m=A.moon(t);
    return { glyph:moonGlyph(m.frac, m.waxing), illum:m.illum, name:m.name,
             newMoon:(((m.frac%1)+1)%1)<0.03||(((m.frac%1)+1)%1)>0.97,
             full:Math.abs((((m.frac%1)+1)%1)-0.5)<0.025 };
  }

  /* ---- meteor peaks that fall in [from,to] — walk Derive.nextMeteor forward.
     nextMeteor(now) returns {name,date,zhr,days} of the NEXT peak after `now`;
     we step `now` just past each found peak to enumerate them. ------------- */
  function meteorPeaksIn(from, to){
    var D=DERIVE(); if(!D||!D.nextMeteor) return [];
    var out=[], cursor=new Date(from.getTime()-1), guard=0;
    while(guard++<40){
      var nx=D.nextMeteor(cursor);
      if(!nx||!nx.date) break;
      if(nx.date>to) break;
      out.push({ date:new Date(nx.date), name:nx.name, zhr:nx.zhr });
      cursor=new Date(nx.date.getTime()+1);
    }
    return out;
  }

  /* ---- the next dark (new-moon) night, if it lands in the shown month ----- */
  function darkNightIn(from, to, viewToday){
    var D=DERIVE(); if(!D||!D.nextDarkNight) return null;
    var dn=D.nextDarkNight(viewToday||new Date());
    if(!dn||!dn.date) return null;
    var dd=startOfDay(dn.date);
    if(dd<from || dd>to) return null;
    return { date:dd, illum:dn.illum, cloud:dn.cloud };
  }

  /* ---- notable ISS passes within the shown month, near `anchor` (real now).
     Satellites.nextPass walks ~18h ahead from a moment; we hop day-by-day to
     gather genuinely-VISIBLE passes (anyVisible). Capped so a far-future month
     (out of TLE accuracy) doesn't burn cycles — and SGP4 drift is honest. -- */
  function issPassesIn(from, to, anchor){
    var S=SATS();
    if(!S||!S.isReady||!S.isReady()||!S.list||!S.nextPass) return [];
    var A=ASTRO(); var sunUnit=(A&&A.sunEciUnit)?A.sunEciUnit:null;
    // find the ISS satrec (name match), else first ready sat
    var iss=null;
    (S.list||[]).forEach(function(sat){
      if(iss) return;
      var nm=(sat.name||sat.id||'').toString().toUpperCase();
      if(sat.ok && sat.satrec && (nm.indexOf('ISS')!==-1 || nm.indexOf('ZARYA')!==-1)) iss=sat;
    });
    if(!iss){ (S.list||[]).forEach(function(sat){ if(!iss && sat.ok && sat.satrec) iss=sat; }); }
    if(!iss) return [];
    // only scan a bounded window around real-now (TLE accuracy ~days, not months)
    var realNow=anchor||new Date();
    var scanFrom=new Date(Math.max(from.getTime(), realNow.getTime()-2*864e5));
    var scanTo=new Date(Math.min(to.getTime()+864e5, realNow.getTime()+8*864e5));
    if(scanTo<=scanFrom) return [];
    var out=[], cursor=new Date(scanFrom), guard=0;
    while(cursor<scanTo && guard++<16){
      var p=null;
      try{ p=S.nextPass(iss.satrec, cursor, sunUnit && new Date()? sunUnit:null); }catch(e){ p=null; }
      if(!p || !p.set){ cursor=new Date(cursor.getTime()+12*3600*1000); continue; }
      var peakDate=new Date(p.peakT||p.rise);
      if(peakDate>=from && peakDate<=to && p.anyVisible)
        out.push({ date:startOfDay(peakDate), peakT:peakDate, peakAlt:Math.round(p.peakAlt||0) });
      cursor=new Date((p.set||cursor.getTime())+10*60*1000);
    }
    // de-dupe to one marker per day (the highest pass)
    var byDay={};
    out.forEach(function(o){ var k=isoOf(o.date); if(!byDay[k]||o.peakAlt>byDay[k].peakAlt) byDay[k]=o; });
    return Object.keys(byDay).map(function(k){ return byDay[k]; });
  }

  /* ---- climate tint: town Tmax → a warm/cool wash. Pure styling of REAL
     measured numbers; honest, not a fabricated gradient meaning. ----------- */
  function tmaxColor(tmax){
    if(tmax==null) return null;
    // clamp into a the highlands-plausible band and map blue(cold)→amber→red(hot)
    var t=Math.max(0, Math.min(42, tmax));
    var stops=[
      [0 ,[60,90,150]],   // cold
      [12,[80,130,170]],
      [20,[120,160,120]], // mild green
      [28,[210,170,80]],  // warm gold
      [36,[210,110,70]],  // hot
      [42,[200,70,60]]
    ];
    var a=stops[0], b=stops[stops.length-1];
    for(var i=0;i<stops.length-1;i++){ if(t>=stops[i][0] && t<=stops[i+1][0]){ a=stops[i]; b=stops[i+1]; break; } }
    var f=(b[0]===a[0])?0:(t-a[0])/(b[0]-a[0]);
    var c=[0,1,2].map(function(j){ return Math.round(a[1][j]+(b[1][j]-a[1][j])*f); });
    return 'rgba('+c[0]+','+c[1]+','+c[2]+',0.30)';
  }

  /* ---- per-day climate record (PAST days only; RecordStore is the source).
     Returns null when no store / not ready / no record for that day. ------- */
  function climateForDay(iso){
    var S=STORE(); if(!S||!S.dayRecord) return null;
    var rec=null; try{ rec=S.dayRecord(iso); }catch(e){ rec=null; }
    if(!rec) return null;
    // pick a representative tMin (any zone with a frost night) for the marker
    var frost=false, tMin=rec.townTmin;
    if(rec.zones){ Object.keys(rec.zones).forEach(function(z){ var zr=rec.zones[z]; if(zr&&zr.frost) frost=true; if(zr&&zr.tMin!=null&&(tMin==null||zr.tMin<tMin)) tMin=zr.tMin; }); }
    return { tMax:rec.townTmax, tMin:rec.townTmin, frost:frost, rainMm:rec.rainMm, zonesRec:rec.zones, low:tMin };
  }

  /* ---- astro-events almanac (data/astro_events.json) — dated sky events so the
     same events shown in the שמיים almanac also land on their calendar days ---- */
  var _astro=null, _astroTried=false;
  function loadAstro(){
    if(_astroTried) return; _astroTried=true;
    try{ fetch('data/astro_events.json').then(function(r){ return r.ok?r.json():null; }).then(function(j){
      var a=(j&&(j.events||j))||[]; _astro=Array.isArray(a)?a:[]; if(_host) paint();
    }).catch(function(){ _astro=[]; }); }catch(e){ _astro=[]; }
  }
  function astroEventsIn(from,to){
    if(!_astro||!_astro.length) return [];
    var f=isoOf(from), t=isoOf(to);
    return _astro.filter(function(e){ return e && e.date && e.date>=f && e.date<=t; });
  }
  /* ---- HIS own dated entries from the second-brain (LogStore due/date) — so
     things he adds in מוח (משימות/השאלות/אירוח/חשבוניות) appear on the calendar ---- */
  var COLL_HE={ schedule:'מְשִׁימָה', lending:'הַשְׁאָלָה', airbnb:'אֵירוּחַ', invoices:'חֶשְׁבּוֹנִית' };
  var COLL_GLYPH={ schedule:'📌', lending:'↩️', airbnb:'🏠', invoices:'🧾' };
  function logLabel(le){ var r=le.rec||{}; return r.title||r.name||r.note||r.text||r.item||COLL_HE[le.coll]||le.coll; }
  function collNameHe(coll){ return COLL_HE[coll]||coll; }
  function logEntriesIn(from,to){
    var L=window.LogStore; if(!L||!L.list) return [];
    var f=isoOf(from), t=isoOf(to), out=[];
    Object.keys(COLL_HE).forEach(function(coll){
      var arr=null; try{ arr=L.list(coll); }catch(e){ arr=null; }
      (arr||[]).forEach(function(rec){ var d=rec&&(rec.due||rec.date); if(d){ d=String(d).slice(0,10); if(d>=f&&d<=t) out.push({ coll:coll, glyph:COLL_GLYPH[coll]||'•', rec:rec, iso:d }); } });
    });
    return out;
  }

  /* ---- 🌿 גִּינָה: the month's GARDEN-CARE tasks for HIS owned plants.
     Owned plants come from data/resident_plants.json (the same set garden.js
     loadCurated() reads); their per-month tasks come from the keyless
     PlantCare engine (care.js / data/plant_care.json), joined by name_latin.
     Care content is MONTHLY (not per-day), so we seat the whole month's
     task list on day-1 of the viewed month as a single "this-month" marker —
     keeping the per-day cell shape the other layers use. Degrades to []
     whenever resident_plants.json hasn't loaded or PlantCare is absent. -------- */
  var _ownPlants=null, _ownTried=false;
  function loadOwnPlants(){
    if(_ownTried) return; _ownTried=true;
    try{ fetch('data/resident_plants.json').then(function(r){ return r.ok?r.json():null; }).then(function(j){
      _ownPlants=Array.isArray(j)?j:[]; if(_host) paint();
    }).catch(function(){ _ownPlants=[]; }); }catch(e){ _ownPlants=[]; }
  }
  function gardenTasksForMonth(monthIdx){
    var C=window.PlantCare;
    if(!_ownPlants||!_ownPlants.length||!C||!C.tasksFor) return [];
    var out=[];
    _ownPlants.forEach(function(pl){
      var lat=pl&&pl.name_latin; if(!lat) return;
      var ts=null; try{ ts=C.tasksFor(lat, monthIdx); }catch(e){ ts=null; }
      (ts||[]).forEach(function(task){
        if(!task||!task.task_he) return;
        var km=null; try{ km=C.kindMeta?C.kindMeta(task.kind):null; }catch(e){ km=null; }
        out.push({ name_he:pl.name_he||C.nameHe&&C.nameHe(lat)||lat, emoji:pl.emoji||'🌿',
                   task_he:task.task_he, kind:task.kind,
                   kindHe:(km&&km.he)||'', kindEmoji:(km&&km.emoji)||'🌿' });
      });
    });
    return out;
  }

  /* ---- 🛠️ שִׁפּוּץ: renovation DUE-DATES from the LogStore 'projects'
     collection — only entries that actually carry a due date (rec.due /
     rec.date), placed on that day. Same per-day shape + defensive read as
     logEntriesIn(); omitted entirely if LogStore is missing. -------------- */
  function renoEntriesIn(from,to){
    var L=window.LogStore; if(!L||!L.list) return [];
    var f=isoOf(from), t=isoOf(to), out=[], arr=null;
    try{ arr=L.list('projects'); }catch(e){ arr=null; }
    (arr||[]).forEach(function(rec){
      var d=rec&&(rec.due||rec.date); if(!d) return;
      d=String(d).slice(0,10); if(d<f||d>t) return;
      out.push({ rec:rec, iso:d });
    });
    return out;
  }
  function renoLabel(re){ var r=re.rec||{}; return r.title||r.t||r.name||r.roomHe||r.note||'שִׁפּוּץ'; }

  /* ---------------- state ---------------- */
  var _host=null, _wired=false;
  var _viewYear=null, _viewMonth=null;   // the displayed month
  var _today=null;                        // "today" anchor passed to render()
  var _selISO=null;                       // selected day (detail open)
  var _layers={ stars:true, climate:true, mine:true, garden:true, reno:true };

  /* ---------------- build one month's day-event index ---------------- */
  function buildMonthIndex(){
    var first=new Date(_viewYear,_viewMonth,1); first.setHours(0,0,0,0);
    var last=new Date(_viewYear,_viewMonth+1,0); last.setHours(23,59,59,999);
    var idx={};   // iso → {meteors:[], dark:bool, iss:bool, darkIllum}
    function slot(iso){ return idx[iso]||(idx[iso]={ meteors:[], dark:false, iss:null, astroEv:[], logEv:[], gardenEv:[], renoEv:[] }); }
    if(_layers.stars){
      meteorPeaksIn(first,last).forEach(function(m){ slot(isoOf(m.date)).meteors.push(m); });
      var dn=darkNightIn(first,last,_today);
      if(dn){ var s=slot(isoOf(dn.date)); s.dark=true; s.darkIllum=dn.illum; s.darkCloud=dn.cloud; }
      issPassesIn(first,last,_today).forEach(function(p){ slot(isoOf(p.date)).iss=p; });
      astroEventsIn(first,last).forEach(function(e){ slot(e.date).astroEv.push(e); });
    }
    if(_layers.mine){
      logEntriesIn(first,last).forEach(function(le){ slot(le.iso).logEv.push(le); });
    }
    // 🌿 garden-care: the whole month's tasks seated on day-1 of this month.
    if(_layers.garden){
      var gt=gardenTasksForMonth(_viewMonth);
      if(gt.length){ var gs=slot(isoOf(first)); gs.gardenEv=gt; }
    }
    // 🛠️ renovation due-dates from LogStore 'projects'.
    if(_layers.reno){
      renoEntriesIn(first,last).forEach(function(re){ slot(re.iso).renoEv.push(re); });
    }
    return { first:first, last:last, idx:idx };
  }

  /* ---------------- galactic-core season note for the header ------------- */
  function galacticNote(){
    var D=DERIVE(); if(!_layers.stars || !D || !D.galacticCore) return '';
    var mid=new Date(_viewYear,_viewMonth,15,20,0,0);
    var gc=D.galacticCore(mid);
    if(!gc) return '';
    if(gc.inSeason)
      return '🌌 לֵב שְׁבִיל הֶחָלָב גָּלוּי הַחֹדֶשׁ — שִׂיא ' + gc.peakAlt + '° בָּאֲזִימוּט ' + gc.peakAz + '° (' + esc(gc.fromHM||'') + '–' + esc(gc.toHM||'') + ')';
    return '🌌 לֵב שְׁבִיל הֶחָלָב לֹא גָּלוּי הַחֹדֶשׁ בַּחֲשֵׁכָה';
  }

  /* ---------------- render the month grid ---------------- */
  function render(host, date){
    if(host){ _host=host; }
    if(!_host) return;
    ensureCSS();
    // first call sets the view to the passed date's month + the "today" anchor
    if(date){ _today=startOfDay(date); }
    if(_viewYear==null){
      var base=_today||startOfDay(new Date());
      _viewYear=base.getFullYear(); _viewMonth=base.getMonth();
    }
    if(!_today) _today=startOfDay(new Date());
    loadAstro();
    loadOwnPlants();
    wire();
    paint();
  }

  function wire(){
    if(_wired===_host) return;
    _wired=_host;
    _host.addEventListener('click', function(e){
      var t=e.target;
      var nav=t.closest && t.closest('[data-cal-nav]');
      if(nav){ stepMonth(+nav.getAttribute('data-cal-nav')); return; }
      var lay=t.closest && t.closest('[data-cal-layer]');
      if(lay){ var k=lay.getAttribute('data-cal-layer'); _layers[k]=!_layers[k]; paint(); return; }
      var tod=t.closest && t.closest('[data-cal-today]');
      if(tod){ var nd=_today||startOfDay(new Date()); _viewYear=nd.getFullYear(); _viewMonth=nd.getMonth(); _selISO=isoOf(nd); paint(); return; }
      var dc=t.closest && t.closest('[data-cal-day]');
      if(dc){ var iso=dc.getAttribute('data-cal-day'); _selISO=(_selISO===iso)?null:iso; paint(); return; }
      var cl=t.closest && t.closest('[data-cal-detail-close]');
      if(cl){ _selISO=null; paint(); return; }
    });
  }

  function stepMonth(delta){
    var m=_viewMonth+delta, y=_viewYear;
    while(m<0){ m+=12; y--; } while(m>11){ m-=12; y++; }
    _viewYear=y; _viewMonth=m; _selISO=null; paint();
  }

  function paint(){
    if(!_host) return;
    var built=buildMonthIndex();
    var first=built.first, idx=built.idx;
    var daysInMonth=new Date(_viewYear,_viewMonth+1,0).getDate();
    var leading=first.getDay();   // 0=Sun … 6=Sat (Sunday-first grid)

    var h='';
    h+='<div class="cal-wrap" dir="rtl">';
    // ---- header: title + month nav + layer toggles ----
    h+='<div class="cal-head">'+
         '<h3>לוּחַ הַשָּׁנָה בַּגִּינָה</h3>'+
         '<div class="cal-nav">'+
           '<span class="cnav" data-cal-nav="-1" role="button" tabindex="0" title="חֹדֶשׁ קוֹדֵם">‹</span>'+
           '<span class="cmon">'+MONTHS_HE[_viewMonth]+' '+_viewYear+'</span>'+
           '<span class="cnav" data-cal-nav="1" role="button" tabindex="0" title="חֹדֶשׁ הַבָּא">›</span>'+
         '</div>'+
       '</div>';
    h+='<div class="cal-sub">לוּחַ שָׁנָה לְלרקמונט · שְׁתֵּי שְׁכָבוֹת נִתָּנוֹת לְכִבּוּי</div>';
    h+='<div class="cal-layers">'+
         '<span class="clay'+(_layers.stars?' on':'')+'" data-cal-layer="stars" role="button" tabindex="0">🌌 שָׁמַיִם</span>'+
         '<span class="clay'+(_layers.climate?' on':'')+'" data-cal-layer="climate" role="button" tabindex="0">🌡️ אַקְלִים אֲמִתִּי</span>'+
         '<span class="clay'+(_layers.mine?' on':'')+'" data-cal-layer="mine" role="button" tabindex="0">📌 שֶׁלִּי</span>'+
         '<span class="clay'+(_layers.garden?' on':'')+'" data-cal-layer="garden" role="button" tabindex="0">🌿 גִּינָה</span>'+
         '<span class="clay'+(_layers.reno?' on':'')+'" data-cal-layer="reno" role="button" tabindex="0">🛠️ שִׁפּוּץ</span>'+
         '<span class="clay ctoday" data-cal-today="1" role="button" tabindex="0">הַיּוֹם</span>'+
       '</div>';
    var gn=galacticNote();
    if(gn) h+='<div class="cal-gc">'+gn+'</div>';

    // ---- weekday header row ----
    h+='<div class="cal-grid cal-dow">';
    for(var w=0;w<7;w++) h+='<div class="cal-dowc">'+DOW_HE[w]+'</div>';
    h+='</div>';

    // ---- day grid ----
    h+='<div class="cal-grid cal-days">';
    for(var b=0;b<leading;b++) h+='<div class="cal-cell empty"></div>';
    var storeReady = !!(STORE() && STORE().dayRecord);
    for(var dnum=1; dnum<=daysInMonth; dnum++){
      var cellDate=new Date(_viewYear,_viewMonth,dnum);
      var iso=isoOf(cellDate);
      var isToday=_today && sameDay(cellDate, _today);
      var isPast=_today && cellDate < _today;
      var isFuture=_today && cellDate > _today;
      var dayEv=idx[iso]||{ meteors:[], dark:false, iss:null, gardenEv:[], renoEv:[] };

      // climate layer (past days only)
      var clim=null, tint=null;
      if(_layers.climate && isPast){ clim=climateForDay(iso); if(clim) tint=tmaxColor(clim.tMax); }

      // stars layer overlays
      var moon=_layers.stars?moonForDay(cellDate):null;

      var cls='cal-cell';
      if(isToday) cls+=' today';
      if(_selISO===iso) cls+=' sel';
      if(isFuture) cls+=' future';
      var styleAttr=tint?(' style="background:'+tint+'"'):'';

      var marks='';
      if(moon){ marks+='<span class="cmoon" title="'+esc(moon.name)+' · '+Math.round(moon.illum*100)+'%">'+moon.glyph+'</span>'; }
      var badges='';
      if(_layers.stars){
        if(dayEv.meteors && dayEv.meteors.length) badges+='<span class="cbadge meteor" title="שִׂיא מֶטֵאוֹרִים">☄️</span>';
        if(dayEv.dark) badges+='<span class="cbadge dark" title="לַיְלָה חָשׁוּךְ (מוֹלָד)">🌑</span>';
        if(dayEv.iss) badges+='<span class="cbadge iss" title="מַעֲבָר תַּחֲנַת חָלָל גָּלוּי">🛰️</span>';
        if(dayEv.astroEv && dayEv.astroEv.length) badges+='<span class="cbadge astev" title="'+esc(dayEv.astroEv.map(function(e){return e.title_he;}).join(' · '))+'">✦</span>';
      }
      if(_layers.mine && dayEv.logEv && dayEv.logEv.length) badges+='<span class="cbadge mine" title="'+esc(dayEv.logEv.map(function(le){return logLabel(le);}).join(' · '))+'">📌</span>';
      if(_layers.garden && dayEv.gardenEv && dayEv.gardenEv.length) badges+='<span class="cbadge garden" title="'+esc('טִפּוּל בַּגִּינָה הַחֹדֶשׁ · '+dayEv.gardenEv.map(function(g){return g.name_he+': '+g.task_he;}).join(' · '))+'">🌿</span>';
      if(_layers.reno && dayEv.renoEv && dayEv.renoEv.length) badges+='<span class="cbadge reno" title="'+esc(dayEv.renoEv.map(function(re){return renoLabel(re);}).join(' · '))+'">🛠️</span>';
      if(_layers.climate && clim){
        if(clim.frost) badges+='<span class="cbadge frost" title="לֵיל כְּפוֹר (מָדוּד)">❄️</span>';
        if(clim.rainMm!=null && clim.rainMm>=0.2) badges+='<span class="cbadge rain" title="גֶּשֶׁם '+r1(clim.rainMm)+' מ״מ (מָדוּד)">🌧️</span>';
      }

      var climTmax=(clim&&clim.tMax!=null)?('<span class="ctmax">'+Math.round(clim.tMax)+'°</span>'):'';

      h+='<div class="'+cls+'" data-cal-day="'+iso+'" role="button" tabindex="0"'+styleAttr+'>'+
           '<div class="cnum">'+dnum+marks+'</div>'+
           '<div class="cbadges">'+badges+'</div>'+
           climTmax+
         '</div>';
    }
    h+='</div>';

    // ---- detail card for the selected day ----
    if(_selISO){ h+=dayDetailHtml(_selISO); }

    // ---- legend + honesty footer ----
    h+='<div class="cal-legend">'+
         (_layers.stars?'<span>🌑 מוֹלָד</span><span>🌕 מָלֵא</span><span>☄️ מֶטֵאוֹרִים</span><span>🛰️ תַּחֲנַת חָלָל</span>':'')+
         (_layers.climate?'<span>❄️ כְּפוֹר</span><span>🌧️ גֶּשֶׁם</span><span class="ctint">צֶבַע = שִׂיא חֹם מָדוּד</span>':'')+
         (_layers.garden?'<span>🌿 טִפּוּל בַּגִּינָה</span>':'')+
         (_layers.reno?'<span>🛠️ יַעַד שִׁפּוּץ</span>':'')+
       '</div>';
    var foot='שְׁכָבַת הַשָּׁמַיִם: אֶפֵמֶרִיס אֲמִתִּי (יָרֵחַ · מֶטֵאוֹרִים · שְׁבִיל הֶחָלָב · תַּחֲנַת חָלָל). ';
    if(_layers.climate){
      foot += storeReady
        ? 'שְׁכָבַת הָאַקְלִים: מְדִידוֹת אֲמֶת שֶׁל מֶזֶג הָאֲוִיר בַּבַּיִת שֶׁלּוֹ (יָמִים שֶׁעָבְרוּ). '
        : 'שְׁכָבַת הָאַקְלִים תִּתְמַלֵּא כְּשֶׁיֹּמְצַם רֵקוֹרְד הַמְּדִידוֹת (נִטְעָן בָּרֶקַע). ';
    }
    foot += 'אֵין חַיְשָׁן פִיזִי — מֶזֶג אֲוִיר מָדוּד, גֵּאוֹמֶטְרְיָה מְחֻשֶּׁבֶת.';
    h+='<div class="cal-foot">'+foot+'</div>';
    h+='</div>';

    _host.innerHTML=h;
  }

  /* ---------------- the per-day detail card ---------------- */
  function dayDetailHtml(iso){
    var parts=iso.split('-').map(Number);
    var d=new Date(parts[0],parts[1]-1,parts[2]);
    var isPast=_today && startOfDay(d) < _today;
    var title=parts[2]+' '+MONTHS_HE[parts[1]-1]+' '+parts[0];

    var h='<div class="cal-detail">';
    h+='<div class="cdhd"><span class="cdt">'+title+'</span><span class="cdx" data-cal-detail-close="1" title="סְגֹר">✕</span></div>';

    // ---- 🌌 sky for that day (always available — pure ephemeris) ----
    var A=ASTRO(), D=DERIVE();
    h+='<div class="cd-sec">🌌 שָׁמַיִם <span class="cd-lab modeled">אֶפֵמֶרִיס</span></div>';
    var moon=moonForDay(d);
    if(moon){
      h+='<div class="cd-row"><span>יָרֵחַ</span><b>'+moon.glyph+' '+esc(moon.name)+' · '+Math.round(moon.illum*100)+'%</b></div>';
    }
    // twilight clock-times for the day
    if(D && D.twilightTimes){
      var tw=null; try{ tw=D.twilightTimes(d); }catch(e){ tw=null; }
      if(tw){
        if(tw.golden) h+='<div class="cd-row"><span>שָׁעָה זְהֻבָּה</span><b>'+esc(tw.golden.morn||'—')+' · '+esc(tw.golden.eve||'—')+'</b></div>';
        if(tw.astro)  h+='<div class="cd-row"><span>חֲשֵׁכָה מְלֵאָה (אַסְטְרוֹ׳)</span><b>'+esc(tw.astro.eve||'—')+'</b></div>';
      }
    }
    // any meteor peak / dark night / ISS marked on this day
    var built=buildMonthIndex(), ev=built.idx[iso]||{};
    if(ev.meteors && ev.meteors.length){
      ev.meteors.forEach(function(m){
        h+='<div class="cd-row"><span>☄️ מֶטֵאוֹרִים</span><b>'+esc(m.name)+' · ~'+m.zhr+'/ש׳ בַּשִּׂיא</b></div>';
      });
    }
    if(ev.dark){
      var cl=(ev.darkCloud!=null)?(' · ~'+Math.round(ev.darkCloud*100)+'% עֲנָנִים'):'';
      h+='<div class="cd-row"><span>🌑 לַיְלָה חָשׁוּךְ</span><b>מוֹלָד · '+Math.round((ev.darkIllum||0)*100)+'% מוּאָר'+cl+'</b></div>';
    }
    if(ev.iss){
      h+='<div class="cd-row"><span>🛰️ תַּחֲנַת הֶחָלָל</span><b>מַעֲבָר גָּלוּי · שִׂיא ~'+ev.iss.peakAlt+'°</b></div>';
    }
    if(ev.astroEv && ev.astroEv.length){
      ev.astroEv.forEach(function(e){
        h+='<div class="cd-row"><span>✦ '+esc(e.title_he||'אֵרוּעַ שָׁמַיִם')+'</span><b>'+esc(e.best_time||'')+'</b></div>';
        if(e.detail_he) h+='<div class="cd-row sm"><span></span><b style="font-weight:400;opacity:.82">'+esc(e.detail_he)+'</b></div>';
      });
    }

    // ---- 📌 his own dated entries (LogStore) for that day ----
    if(ev.logEv && ev.logEv.length){
      h+='<div class="cd-sec">📌 שֶׁלִּי <span class="cd-lab measured">יוֹמָן</span></div>';
      ev.logEv.forEach(function(le){
        h+='<div class="cd-row"><span>'+esc(le.glyph||'•')+' '+esc(collNameHe(le.coll))+'</span><b>'+esc(logLabel(le))+'</b></div>';
      });
    }

    // ---- 🌿 the month's garden-care tasks for his owned plants ----
    if(ev.gardenEv && ev.gardenEv.length){
      h+='<div class="cd-sec">🌿 טִפּוּל בַּגִּינָה <span class="cd-lab modeled">הֶחֹדֶשׁ</span></div>';
      ev.gardenEv.forEach(function(g){
        h+='<div class="cd-row"><span>'+esc((g.emoji||'🌿')+' '+(g.name_he||''))+'</span><b>'+esc((g.kindEmoji||'')+' '+g.task_he)+'</b></div>';
      });
    }

    // ---- 🛠️ renovation due-dates (LogStore 'projects') for that day ----
    if(ev.renoEv && ev.renoEv.length){
      h+='<div class="cd-sec">🛠️ שִׁפּוּץ <span class="cd-lab measured">יַעַד</span></div>';
      ev.renoEv.forEach(function(re){
        var r=re.rec||{}; var meta=[]; if(r.roomHe) meta.push(r.roomHe); if(r.status) meta.push(r.status);
        h+='<div class="cd-row"><span>'+esc(renoLabel(re))+'</span><b>'+esc(meta.join(' · ')||'יַעַד')+'</b></div>';
      });
    }

    // ---- 🌡️ real climate (past days, from RecordStore) ----
    if(isPast){
      var clim=climateForDay(iso);
      h+='<div class="cd-sec">🌡️ אַקְלִים <span class="cd-lab measured">מְדִידוֹת אֲמֶת</span></div>';
      if(clim){
        if(clim.tMax!=null||clim.tMin!=null)
          h+='<div class="cd-row"><span>טֶמְפֶּרָטוּרָה (עִיר)</span><b>'+(clim.tMax!=null?Math.round(clim.tMax)+'°':'—')+' / '+(clim.tMin!=null?Math.round(clim.tMin)+'°':'—')+'</b></div>';
        if(clim.rainMm!=null)
          h+='<div class="cd-row"><span>מִשְׁקָעִים</span><b>'+r1(clim.rainMm)+' מ״מ</b></div>';
        if(clim.frost)
          h+='<div class="cd-row"><span>כְּפוֹר</span><b class="cd-frost">❄️ לֵיל כְּפוֹר</b></div>';
        // per-zone modeled lows (geometry), if present — labeled modeled
        if(clim.zonesRec){
          var zids=Object.keys(clim.zonesRec);
          if(zids.length){
            h+='<div class="cd-zsec">לְפִי אֵזוֹר <span class="cd-lab modeled">מְחֻשָּׁב לְפִי הַגֵּאוֹמֶטְרְיָה</span></div>';
            zids.forEach(function(zid){
              var zr=clim.zonesRec[zid]; if(!zr) return;
              var bits=[];
              if(zr.tMin!=null) bits.push('שַׁחַר '+Math.round(zr.tMin)+'°');
              if(zr.sunHours!=null) bits.push(Math.round(zr.sunHours*10)/10+' ש׳ שֶׁמֶשׁ');
              if(zr.frost) bits.push('כְּפוֹר');
              h+='<div class="cd-row sm"><span>'+esc(zoneNameHe(zid))+'</span><b>'+(bits.join(' · ')||'—')+'</b></div>';
            });
          }
        }
      } else {
        var sr = !!(STORE() && STORE().dayRecord);
        h+='<div class="cd-empty">'+(sr?'אֵין עֲדַיִן רֵקוֹרְד מָדוּד לַיּוֹם הַזֶּה.':'רֵקוֹרְד הַמְּדִידוֹת נִטְעָן בָּרֶקַע…')+'</div>';
      }
    } else {
      h+='<div class="cd-sec">🌡️ אַקְלִים</div>';
      h+='<div class="cd-empty">שְׁכָבַת הָאַקְלִים מַרְאָה מְדִידוֹת אֲמֶת — רַק לְיָמִים שֶׁעָבְרוּ.</div>';
    }
    h+='</div>';
    return h;
  }

  function zoneNameHe(zid){
    var D=DERIVE();
    var zs=(D&&D.data&&D.data.site&&D.data.site.zones)||[];
    var z=zs.find(function(x){ return x.id===zid; });
    if(z&&z.name_he) return z.name_he;
    var fb={ backyard:'חָצֵר אֲחוֹרִית', balcony:'מִרְפֶּסֶת', front:'חֲזִית' };
    return fb[zid]||zid;
  }

  /* ---------------- CSS (scoped #homeCal host class; #inst dark/gold) ----- */
  function ensureCSS(){
    if(document.getElementById('alex-cal-css')) return;
    var s=document.createElement('style'); s.id='alex-cal-css';
    s.textContent=
      '.cal-wrap{font-family:Heebo,sans-serif;color:#efe6cf;direction:rtl}'+
      '.cal-head{display:flex;align-items:center;justify-content:space-between;gap:8px}'+
      '.cal-head h3{font-family:"Frank Ruhl Libre",serif;font-weight:500;font-size:17px;color:#fff7e6;margin:0}'+
      '.cal-nav{display:flex;align-items:center;gap:8px}'+
      '.cal-nav .cnav{cursor:pointer;color:'+GOLD+';font-size:20px;line-height:1;width:26px;height:26px;'+
        'display:flex;align-items:center;justify-content:center;border-radius:7px;border:1px solid rgba(202,161,90,.28);'+
        'background:rgba(255,255,255,.03);user-select:none;transition:.15s}'+
      '.cal-nav .cnav:hover{color:#fff7e6;border-color:rgba(202,161,90,.5);background:rgba(202,161,90,.12)}'+
      '.cal-nav .cmon{font-family:Bellefair,serif;letter-spacing:.04em;font-size:14px;color:#e7dcc0;min-width:118px;text-align:center}'+
      '.cal-sub{font-size:10px;color:#a99b78;margin:3px 0 8px;line-height:1.4}'+
      '.cal-layers{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}'+
      '.cal-layers .clay{font-size:11px;padding:4px 9px;border-radius:20px;cursor:pointer;user-select:none;'+
        'background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.25);color:#bcae8a;transition:.15s}'+
      '.cal-layers .clay:hover{border-color:rgba(202,161,90,.5);color:#efe6cf}'+
      '.cal-layers .clay.on{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;border-color:transparent;font-weight:600}'+
      '.cal-layers .ctoday{margin-inline-start:auto;color:'+GOLD+'}'+
      '.cal-gc{font-size:10.5px;color:#bcd0f0;background:rgba(120,150,210,.10);border:1px solid rgba(120,150,210,.22);'+
        'border-radius:8px;padding:6px 9px;margin-bottom:8px;line-height:1.45}'+
      '.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}'+
      '.cal-dow{margin-bottom:3px}'+
      '.cal-dowc{text-align:center;font-size:10px;color:#a99b78;font-family:Bellefair,serif;letter-spacing:.04em;padding:2px 0}'+
      '.cal-cell{position:relative;min-height:46px;border-radius:7px;padding:3px 4px;'+
        'background:rgba(255,255,255,.035);border:1px solid rgba(202,161,90,.12);cursor:pointer;'+
        'transition:border-color .12s,box-shadow .12s;overflow:hidden}'+
      '.cal-cell.empty{background:none;border:none;cursor:default}'+
      '.cal-cell:not(.empty):hover{border-color:rgba(202,161,90,.45);box-shadow:inset 0 0 0 1px rgba(202,161,90,.2)}'+
      '.cal-cell.today{border-color:rgba(202,161,90,.7);box-shadow:inset 0 0 0 1px rgba(202,161,90,.45)}'+
      '.cal-cell.sel{border-color:'+GOLD+';box-shadow:0 0 0 1px '+GOLD+',inset 0 0 0 1px rgba(202,161,90,.35)}'+
      '.cal-cell.future{opacity:.92}'+
      '.cal-cell .cnum{display:flex;align-items:center;gap:3px;font-size:12px;color:#e7dcc0;font-weight:600;line-height:1.1}'+
      '.cal-cell.today .cnum{color:#fff7e6}'+
      '.cal-cell .cmoon{font-size:11px;line-height:1;margin-inline-start:auto;opacity:.95}'+
      '.cal-cell .cbadges{display:flex;flex-wrap:wrap;gap:1px;margin-top:2px;line-height:1}'+
      '.cal-cell .cbadge{font-size:10px;line-height:1}'+
      '.cal-cell .ctmax{position:absolute;left:4px;bottom:3px;font-size:9.5px;color:#fff7e6;font-weight:600;'+
        'text-shadow:0 1px 3px rgba(0,0,0,.7)}'+
      // ---- day detail ----
      '.cal-detail{margin-top:10px;background:rgba(255,255,255,.045);border:1px solid rgba(202,161,90,.25);'+
        'border-radius:9px;padding:10px 12px}'+
      '.cal-detail .cdhd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px}'+
      '.cal-detail .cdt{font-family:"Frank Ruhl Libre",serif;font-size:15px;color:#fff7e6}'+
      '.cal-detail .cdx{cursor:pointer;color:#a99b78;font-size:13px;padding:2px 6px;border-radius:6px;'+
        'border:1px solid rgba(202,161,90,.22);background:rgba(255,255,255,.03);transition:.15s}'+
      '.cal-detail .cdx:hover{color:#fff7e6;border-color:rgba(202,161,90,.5)}'+
      '.cal-detail .cd-sec{margin:9px 0 3px;color:'+GOLD+';font-family:Bellefair,serif;font-size:12.5px;letter-spacing:.03em;'+
        'display:flex;align-items:center;gap:7px}'+
      '.cal-detail .cd-zsec{margin:8px 0 2px;color:#bcae8a;font-size:11px;font-family:Heebo;'+
        'display:flex;align-items:center;gap:6px;flex-wrap:wrap}'+
      '.cal-detail .cd-lab{font-family:Heebo;font-size:9px;padding:1px 6px;border-radius:20px;font-weight:600}'+
      '.cal-detail .cd-lab.measured{color:#a7e0a7;background:rgba(120,200,120,.16);border:1px solid rgba(120,200,120,.4)}'+
      '.cal-detail .cd-lab.modeled{color:#e8c474;background:rgba(224,178,74,.16);border:1px solid rgba(224,178,74,.4)}'+
      '.cal-detail .cd-row{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#d6ccb2;'+
        'padding:5px 0;border-top:1px solid rgba(202,161,90,.1)}'+
      '.cal-detail .cd-row:first-of-type{border-top:none}'+
      '.cal-detail .cd-row.sm{font-size:11px}'+
      '.cal-detail .cd-row b{color:#fff7e6;font-weight:600;text-align:left}'+
      '.cal-detail .cd-row b.cd-frost{color:#bcd0f0}'+
      '.cal-detail .cd-empty{font-size:11px;color:#a99b78;padding:5px 0;line-height:1.5}'+
      // ---- legend + footer ----
      '.cal-legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:10px;font-size:10px;color:#a99b78}'+
      '.cal-legend .ctint{color:#cdbf9b}'+
      '.cal-foot{margin-top:9px;padding-top:8px;border-top:1px solid rgba(202,161,90,.13);'+
        'font-size:9.5px;color:#8a7a52;line-height:1.55}'+
      // ---- mobile ----
      '@media(max-width:760px){'+
        '.cal-head{flex-wrap:wrap;gap:6px}'+
        '.cal-head h3{font-size:16px}'+
        '.cal-nav .cmon{min-width:0;font-size:13px}'+
        '.cal-nav .cnav{width:34px;height:34px;font-size:20px}'+
        '.cal-sub{font-size:10px;margin:3px 0 7px}'+
        '.cal-layers{gap:6px;margin-bottom:7px}'+
        '.cal-layers .clay{font-size:11px;padding:7px 11px;line-height:1.1}'+
        '.cal-layers .ctoday{margin-inline-start:auto}'+
        '.cal-gc{font-size:10.5px;padding:6px 8px}'+
        '.cal-grid{gap:2px}'+
        '.cal-dowc{font-size:10px}'+
        '.cal-cell{min-height:42px;padding:3px 3px;border-radius:6px}'+
        '.cal-cell .cnum{font-size:11px}'+
        '.cal-cell .cmoon{font-size:11px}'+
        '.cal-cell .cbadge{font-size:11px}'+
        '.cal-cell .ctmax{font-size:9.5px;left:3px;bottom:2px}'+
        '.cal-detail{padding:10px 11px}'+
        '.cal-detail .cdt{font-size:14px}'+
        '.cal-detail .cdx{padding:6px 9px;font-size:13px}'+
        '.cal-detail .cd-sec{font-size:12.5px}'+
        '.cal-detail .cd-row{font-size:12px;padding:6px 0}'+
        '.cal-detail .cd-row.sm{font-size:11px}'+
        '.cal-legend{gap:4px 10px;font-size:11px}'+
        '.cal-foot{font-size:11px;line-height:1.55}'+
      '}'+
      '@media(max-width:380px){'+
        '.cal-grid{gap:2px}'+
        '.cal-cell{min-height:38px;padding:2px 2px}'+
        '.cal-cell .cnum{font-size:11px;gap:2px}'+
        '.cal-cell .cmoon{font-size:10px}'+
        '.cal-cell .cbadge{font-size:10px}'+
      '}';
    document.head.appendChild(s);
  }

  window.__calendar={
    render: render,
    // small inspectables for tests/integrator (do not imply UI)
    _layers: function(){ return Object.assign({}, _layers); },
    _setView: function(y,m){ _viewYear=y; _viewMonth=m; }
  };
})();
