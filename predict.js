/* ===================================================================
   predict.js — the PREDICTIVE layer of the Living Record.

   This is the bridge from the MEASURED PAST → a PREDICTED FUTURE. The
   microclimate pillar (Derive.cellProfile / _bakeSeason) is a *generic
   theoretical model* — a climatological average day. The Living Record
   (RecordStore) is a *logbook* of what HIS yard ACTUALLY experienced,
   day by day, via real Open-Meteo weather propagated through the house
   geometry. Predict consumes that real logbook to produce PERSONALIZED
   forecasts that — once enough real data exists — beat the generic model:

     · frost dates   first/last frost per year + multi-year avg + trend →
                     project THIS year (or fall back to the model + say so).
     · season forecast  GDD & chill-hour accumulation vs each plant's
                     requirement → when it should hit bloom/fruit.
     · best window   the calendar window the logged history says is right for
                     a plant (real-history) vs the curated months (fallback).
     · water forecast  ET-based liters/day per zone for the days ahead.
     · BIAS          how the measured site systematically deviates from the
                     generic model (temp bias °C, DLI bias %). This is the
                     whole point: it lets every future prediction be tuned to
                     the local microclimate, because logged data beats the average.

   HONESTY (CLAUDE.md, non-negotiable):
     · Every output carries a `basis` label: 'real'/'real-history' when it is
       grounded in his accumulated measurements, 'model'/'model-fallback'
       when there isn't yet ≥1 season of data and we fall back to the generic
       theoretical model — and we SAY so in note_he, with a confidence word.
     · Measurements are reanalysis (Open-Meteo) reshaped by a physics model —
       NEVER a physical soil/garden sensor. Predictions are predictions.
     · If data is thin we say it's thin; we never fabricate a frost date or a
       harvest week we can't support.

   Defensive by contract: never throws. Degrades gracefully if RecordStore /
   Derive / the plant data are not ready (returns a model-fallback or a
   clearly-labelled "not enough data" object). Code consumers against the
   FROZEN window.Predict surface:

     Predict.ready                       → Promise (resolves after a warm read)
     Predict.frostDates()                → {firstFrostEst,lastFrostEst,basis,confidence_he,n_years}
     Predict.seasonForecast(plantId)     → {gddToDate,gddExpected,chillToDate,chillExpected,seasonLenDays,basis,note_he}
     Predict.bestWindow(plantId)         → {plantId,windowStart,windowEnd,basis,reason_he}
     Predict.waterForecast(zoneId,days)  → {litersPerDay[],totalLiters,basis,note_he}
     Predict.bias()                      → {tempBiasC,dliBiasPct,note_he}
   =================================================================== */
(function(){
  'use strict';
  if (window.Predict) return;

  var DAY = 86400000;

  /* ---- tiny self-injected CSS (a `.predict-*` chip class for any consumer
     that wants to render a Predict result in the #inst gold-on-dark skin).
     Predict is primarily a DATA layer, so this is minimal + idempotent. ---- */
  function ensureCSS(){
    try{
      if (!window.document || document.getElementById('alex-predict-css')) return;
      var st = document.createElement('style');
      st.id = 'alex-predict-css';
      st.textContent =
        '.predict-basis{display:inline-block;font-size:11px;line-height:1.4;border-radius:6px;'+
        'padding:1px 7px;margin-inline-start:6px;vertical-align:middle;direction:ltr;'+
        'border:1px solid rgba(216,178,90,.35);color:#d8b25a;background:rgba(216,178,90,.08)}'+
        '.predict-basis.model{color:#9fb4c7;border-color:rgba(159,180,199,.35);background:rgba(159,180,199,.08)}';
      (document.head||document.documentElement).appendChild(st);
    }catch(e){ /* never throw on CSS */ }
  }

  /* ---------------- date helpers (UTC, matching RecordStore) ---------------- */
  function toISO(d){
    return d.getUTCFullYear()+'-'+
      String(d.getUTCMonth()+1).padStart(2,'0')+'-'+
      String(d.getUTCDate()).padStart(2,'0');
  }
  function parseDay(s){
    var p=String(s||'').slice(0,10).split('-');
    return new Date(Date.UTC(+p[0],(+p[1]||1)-1,+p[2]||1,0,0,0,0));
  }
  function todayISO(){ return toISO(new Date()); }
  function addDaysISO(iso, n){ return toISO(new Date(parseDay(iso).getTime()+n*DAY)); }
  function yearOf(iso){ return +String(iso||'').slice(0,4); }
  function monthOf(iso){ return +String(iso||'').slice(5,7); }       // 1..12
  function dayOfYear(iso){
    var d=parseDay(iso), s=Date.UTC(d.getUTCFullYear(),0,1);
    return Math.floor((d.getTime()-s)/DAY)+1;                        // 1..366
  }
  function seasonOfMonth(m){                                         // m: 1..12
    if(m===12||m<=2) return 'winter';
    if(m<=5) return 'spring';
    if(m<=8) return 'summer';
    return 'autumn';
  }
  // map a 1..366 day-of-year back to an ISO date in a target year (for projecting
  // "the average frost falls on day-of-year X" onto this/next year)
  function doyToISO(year, doy){
    var d=new Date(Date.UTC(year,0,1));
    d.setUTCDate(d.getUTCDate()+(Math.round(doy)-1));
    return toISO(d);
  }
  function r1(v){ return Math.round(v*10)/10; }
  function r0(v){ return Math.round(v); }

  /* ---------------- safe global accessors (never throw) ---------------- */
  function RS(){ return window.RecordStore || null; }
  function DRV(){ return window.Derive || null; }

  // his plant params: resident_plants.json is surfaced as Derive.data.plants and via
  // RecordStore.allPlants(); plant_care.json (Derive.data.plant_care?) keys by
  // latin name. We read whatever is present, defensively.
  function plantList(){
    try{
      var rs=RS();
      if(rs && rs.allPlants){ var a=rs.allPlants(); if(Array.isArray(a)&&a.length) return a; }
    }catch(e){}
    try{
      var d=DRV();
      var ps=d&&d.data&&d.data.plants;
      if(Array.isArray(ps)) return ps;
    }catch(e){}
    return [];
  }
  // the FULL param record for a plant id (dli_min/max, gdd_to_fruit, chill_hours_req,
  // frost_hardy_c, planting_months_he, best_zone_id, water_*_l_week …)
  function plantParams(plantId){
    try{
      var d=DRV(); var ps=(d&&d.data&&d.data.plants)||[];
      for(var i=0;i<ps.length;i++) if(ps[i].id===plantId) return ps[i];
    }catch(e){}
    return null;
  }
  function plantZone(plantId){
    var p=plantParams(plantId);
    if(p) return p.best_zone_id||p.zoneId||null;
    try{
      var rs=RS(); var a=(rs&&rs.allPlants&&rs.allPlants())||[];
      for(var i=0;i<a.length;i++) if(a[i].id===plantId) return a[i].zoneId;
    }catch(e){}
    return null;
  }
  function zoneList(){
    try{ var rs=RS(); if(rs&&rs.allZones){ var z=rs.allZones(); if(Array.isArray(z)) return z; } }catch(e){}
    return [{id:'backyard',name_he:'The backyard'},{id:'balcony',name_he:'First-floor balcony'},{id:'front',name_he:'House front'}];
  }

  /* ---------------- the rep cell for a zone (mirror zone_card / Derive._repCell) ----------------
     Used by the BIAS pass to ask the GENERIC model what it predicts for the same
     season the measured days fall in. Defensive: returns null if the grid isn't ready. */
  var _repCache={};
  function repCell(zoneId){
    if(_repCache[zoneId]) return _repCache[zoneId];
    try{
      var d=DRV(); if(!d||!d.cellGrid) return null;
      var cells=d.cellGrid()||[];
      var inZone=cells.filter(function(c){ return c.zoneId===zoneId; });
      if(!inZone.length) return null;
      var mx=0,mz=0; inZone.forEach(function(c){ mx+=c.xL; mz+=c.zL; }); mx/=inZone.length; mz/=inZone.length;
      var best=inZone[0], bd=Infinity;
      inZone.forEach(function(c){ var dd=(c.xL-mx)*(c.xL-mx)+(c.zL-mz)*(c.zL-mz); if(dd<bd){bd=dd;best=c;} });
      _repCache[zoneId]=best; return best;
    }catch(e){ return null; }
  }
  // generic-model seasonal profile for a zone (cellProfile). Carries the model's
  // expected airPeak/airDawn (→ a model daily-mean) and DLI for that season.
  function modelProfile(zoneId, season){
    try{
      var d=DRV(); var cell=repCell(zoneId);
      if(!d||!d.cellProfile||!cell) return null;
      return d.cellProfile(cell, season);
    }catch(e){ return null; }
  }
  // the generic model's expected daily-MEAN air temp for a season at a zone.
  // _bakeSeason exposes airPeak (daytime peak local air) + airDawn (pre-dawn min);
  // their midpoint is a fair model daily mean to compare HIS measured tMean against.
  function modelMeanTemp(zoneId, season){
    var p=modelProfile(zoneId, season);
    if(!p) return null;
    if(p.airPeak!=null && p.airDawn!=null) return (p.airPeak+p.airDawn)/2;
    if(p.Tpeak!=null && p.Tdawn!=null) return (p.Tpeak+p.Tdawn)/2;
    return null;
  }
  function modelDLI(zoneId, season){
    var p=modelProfile(zoneId, season);
    return (p&&p.DLI!=null)?p.DLI:null;
  }

  /* ===================================================================
     read his accumulated record. zoneDaily(zoneId, from, to) → [dayRecord]
     with {date,tMin,tMax,tMean,frost,frostLow,dli,sunHours,gddInc,chillInc,
           et0,etc,rainMm,...}. We never assume it is non-empty.
     =================================================================== */
  function zoneDaily(zoneId, fromISO, toISO){
    try{ var rs=RS(); return (rs&&rs.zoneDaily)?(rs.zoneDaily(zoneId, fromISO, toISO)||[]):[]; }
    catch(e){ return []; }
  }
  function status(){
    try{ var rs=RS(); return (rs&&rs.status)?rs.status():null; }catch(e){ return null; }
  }
  // how many DISTINCT calendar days of record exist across all zones (a coarse
  // "do we have ≥1 season" gauge). Uses status().days when available.
  function recordDays(){
    var s=status();
    if(s && typeof s.days==='number') return s.days;
    // fallback: count from a representative zone
    var z=zoneList(); if(!z.length) return 0;
    return zoneDaily(z[0].id, null, null).length;
  }
  function recordSpanDays(){
    var s=status();
    if(s && s.firstDate && s.lastDate){
      return Math.max(0, Math.round((parseDay(s.lastDate).getTime()-parseDay(s.firstDate).getTime())/DAY)+1);
    }
    return recordDays();
  }

  /* ===================================================================
     FROST DATES — per-year first/last frost + multi-year average + a simple
     linear trend, projected onto the current/next year. A "frost day" is a
     dayRecord with frost===true OR frostLow<=0 (measured min air ≤ 0 °C),
     using the most frost-prone zone we have (lowest tMin tends to be the
     open low ground; we scan ALL zones and take the union → earliest frost
     in autumn, latest frost in spring).
     =================================================================== */
  function frostDaysAcrossZones(){
    // collect every measured frost day (date → true) across all zones
    var set={};
    zoneList().forEach(function(z){
      zoneDaily(z.id, null, null).forEach(function(rec){
        if(rec && (rec.frost===true || (rec.frostLow!=null && rec.frostLow<=0) || (rec.tMin!=null && rec.tMin<=0))){
          set[rec.date]=true;
        }
      });
    });
    return Object.keys(set).sort();
  }
  // for a "frost season" we treat the WINTER straddling Jan as belonging to the
  // year of its Jan (the standard convention): autumn frosts of year Y-1 +
  // winter/spring frosts of year Y form one season keyed by Y. We split using a
  // pivot at day-of-year ~213 (Aug 1): frosts after Aug 1 belong to the NEXT
  // year's season (they are the autumn shoulder), frosts before belong to year Y.
  var FROST_PIVOT_DOY=213; // Aug 1 (leap-safe enough for a shoulder split)
  function frostSeasonYear(iso){
    var y=yearOf(iso), doy=dayOfYear(iso);
    return (doy>=FROST_PIVOT_DOY)? y+1 : y;
  }
  // "shifted day-of-year": measure days from Aug 1 so autumn(Dec) → spring(Mar)
  // is monotonic within one season (autumn small, spring large). first frost =
  // min shifted-doy in a season; last frost = max shifted-doy.
  function shiftedDoy(iso){
    var doy=dayOfYear(iso);
    return (doy>=FROST_PIVOT_DOY)? doy-FROST_PIVOT_DOY : doy + (366-FROST_PIVOT_DOY);
  }
  function isoFromShifted(seasonYear, shifted){
    // invert shiftedDoy → an absolute ISO date. shifted<(366-PIVOT) → autumn of
    // seasonYear-1; else spring of seasonYear.
    var autumnSpan=366-FROST_PIVOT_DOY;
    if(shifted < autumnSpan){
      var doyA=FROST_PIVOT_DOY+shifted;
      return doyToISO(seasonYear-1, doyA);
    } else {
      var doyS=shifted-autumnSpan;
      return doyToISO(seasonYear, doyS);
    }
  }
  function linTrendPerYear(years, vals){
    // simple OLS slope (units per year). Returns 0 if <2 points or degenerate.
    var n=years.length; if(n<2) return 0;
    var mx=0,my=0; for(var i=0;i<n;i++){ mx+=years[i]; my+=vals[i]; } mx/=n; my/=n;
    var num=0,den=0;
    for(var j=0;j<n;j++){ num+=(years[j]-mx)*(vals[j]-my); den+=(years[j]-mx)*(years[j]-mx); }
    return den>0? num/den : 0;
  }

  function frostDates(){
    var out={ firstFrostEst:null, lastFrostEst:null, basis:'model',
              confidence_he:'', n_years:0 };
    try{
      var frostISO=frostDaysAcrossZones();
      // group by frost-season year → {seasonYear:{first:shifted,last:shifted}}
      var byYear={};
      frostISO.forEach(function(iso){
        var sy=frostSeasonYear(iso), sh=shiftedDoy(iso);
        if(!byYear[sy]) byYear[sy]={first:sh,last:sh};
        else { if(sh<byYear[sy].first) byYear[sy].first=sh; if(sh>byYear[sy].last) byYear[sy].last=sh; }
      });
      var years=Object.keys(byYear).map(Number).sort(function(a,b){return a-b;});
      // require COMPLETE-ENOUGH seasons: drop a season we only partially observed
      // (record span doesn't cover its Aug→May window). Coarse guard: keep a season
      // only if we have any frost in BOTH its autumn-shoulder and its spring-shoulder,
      // OR if record clearly spans a full year (≥330 days) so its single edge is real.
      var span=recordSpanDays();
      var thisY=yearOf(todayISO());
      var nextSeasonYear=(monthOf(todayISO())>=8)? thisY+1 : thisY;  // the season we're heading into
      // H2 fix: actually USE `span` — don't claim N real seasons unless the record is long
      // enough to actually CONTAIN them (~one near-full season each). A short record whose
      // frost events straddle >1 calendar year would otherwise fold a partial fragment into
      // the average and falsely label it "N real seasons" (the old guard was dead code).
      var enoughSpan = span >= Math.max(1,years.length)*250;
      out.n_years=years.length;

      if(years.length>=2 && enoughSpan){
        // REAL multi-year average + trend.
        var fy=[], fv=[], ly=[], lv=[];
        years.forEach(function(y){ fy.push(y); fv.push(byYear[y].first); ly.push(y); lv.push(byYear[y].last); });
        var firstAvg=fv.reduce(function(a,b){return a+b;},0)/fv.length;
        var lastAvg =lv.reduce(function(a,b){return a+b;},0)/lv.length;
        var firstTrend=linTrendPerYear(fy,fv);   // shifted-doy per year
        var lastTrend =linTrendPerYear(ly,lv);
        // project to the upcoming season: avg + trend·(targetYear − meanYear)
        var meanYear=fy.reduce(function(a,b){return a+b;},0)/fy.length;
        var firstProj=firstAvg+firstTrend*(nextSeasonYear-meanYear);
        var lastProj =lastAvg +lastTrend *(nextSeasonYear-meanYear);
        out.firstFrostEst=isoFromShifted(nextSeasonYear, firstProj);
        out.lastFrostEst =isoFromShifted(nextSeasonYear, lastProj);
        out.basis='real';
        out.confidence_he='Based on '+years.length+' seasons of real measurements at your site'+
          (Math.abs(firstTrend)>2||Math.abs(lastTrend)>2 ? ' (including a multi-year trend)':'')+
          ' · medium confidence — few seasons, a ±two-week error is plausible';
        return out;
      }
      if(years.length===1 && span>=300){
        // ONE full season of real data → use it directly, low confidence.
        var y0=years[0];
        out.firstFrostEst=isoFromShifted(nextSeasonYear, byYear[y0].first);
        out.lastFrostEst =isoFromShifted(nextSeasonYear, byYear[y0].last);
        out.basis='real';
        out.n_years=1;
        out.confidence_he='Based on a single season of real measurements — low confidence; another year will sharpen it considerably';
        return out;
      }
    }catch(e){ /* fall through to model */ }

    // MODEL FALLBACK — not enough real frost seasons yet. Use the generic model:
    // Larkmont gets near-annual radiative frost; the curated climatology
    // (Derive _bakeSeason winter frost screen) places the frost window across
    // late autumn → early spring. We give the climatological window and SAY it's
    // the generic model, not his measured site.
    var ty=yearOf(todayISO());
    var nsy=(monthOf(todayISO())>=8)? ty+1 : ty;
    // climatological frost window for the the highlands highlands: ~mid-Nov → ~late-Mar.
    out.firstFrostEst = (nsy-1)+'-11-20';   // first autumn frost (model)
    out.lastFrostEst  = nsy+'-03-25';       // last spring frost (model)
    out.basis='model';
    out.confidence_he='Not enough real data yet — frost window per the generic climate model (Larkmont). It will sharpen as the logbook accumulates real seasons.';
    return out;
  }

  /* ===================================================================
     SEASON FORECAST per plant — GDD & chill accumulation so far this growth
     cycle vs the plant's requirement (resident_plants.json gdd_to_fruit /
     chill_hours_req), + growing-season length. Tells WHERE the plant is on
     its way to bloom/fruit. Real if we have his record; model fallback maps
     the generic seasonal totals.

     Accumulation windows (the highlands convention):
       · GDD cycle starts after winter dormancy break, ~Feb 1 of the current
         year (or last Feb 1 if we're before it). We sum measured gddInc from
         Feb 1 → today.
       · CHILL accrues over the dormant season ~Nov 1 → Feb 28 (the chill the
         deciduous tree banked to break dormancy). We sum the most-recent
         completed-or-in-progress chill window.
     =================================================================== */
  function gddCycleStart(){
    var t=todayISO(), y=yearOf(t), m=monthOf(t);
    // before Feb → cycle began last Feb 1; else this Feb 1
    return (m<2)? (y-1)+'-02-01' : y+'-02-01';
  }
  function chillWindow(){
    var t=todayISO(), y=yearOf(t);
    // the chill season that is current/most-recent: Nov(Y-1) → Feb(Y).
    // The chill banked by ~end of Feb is always keyed to THIS calendar year's
    // Feb, whether we're before or after it (before Feb → the in-progress
    // window still ends Feb(Y); after Feb → that same just-completed window is
    // the most-recent banked chill). So endY is unconditionally `y`.
    var endY = y;
    var startY = endY-1;
    return { from: startY+'-11-01', to: endY+'-02-28' };
  }
  function sumField(rows, field){
    var s=0; for(var i=0;i<rows.length;i++){ var v=rows[i]&&rows[i][field]; if(v!=null&&isFinite(v)) s+=v; } return s;
  }

  function seasonForecast(plantId){
    var p=plantParams(plantId);
    var zoneId=plantZone(plantId);
    var out={ plantId:plantId, gddToDate:null, gddExpected:null, chillToDate:null,
              chillExpected:null, seasonLenDays:null, basis:'model', note_he:'' };
    var gddReq=(p&&p.gdd_to_fruit!=null)?p.gdd_to_fruit:null;
    var chillReq=(p&&p.chill_hours_req!=null)?p.chill_hours_req:null;
    out.gddExpected=gddReq;
    out.chillExpected=chillReq;

    try{
      if(zoneId){
        var gw=gddCycleStart(), today=todayISO();
        var cw=chillWindow();
        var gddRows=zoneDaily(zoneId, gw, today);
        var chillRows=zoneDaily(zoneId, cw.from, cw.to);
        var haveGdd=gddRows.length>0, haveChill=chillRows.length>0;

        if(haveGdd || haveChill){
          out.gddToDate   = haveGdd? r0(sumField(gddRows,'gddInc')) : null;
          out.chillToDate = haveChill? r0(sumField(chillRows,'chillInc')) : null;
          // growing-season length: span of days from cycle start with measured data
          out.seasonLenDays = gddRows.length;
          out.basis='real';
          // a verdict line: how far along toward fruit / how much chill banked.
          var bits=[];
          if(out.gddToDate!=null && gddReq){
            var pctG=Math.min(999,Math.round(100*out.gddToDate/Math.max(1,gddReq)));
            bits.push('Accumulated ~'+out.gddToDate+' heat units of the ~'+gddReq+' required for fruit (~'+pctG+'%)');
          } else if(out.gddToDate!=null){
            bits.push('Accumulated ~'+out.gddToDate+' heat units since the cycle began');
          }
          if(out.chillToDate!=null && chillReq){
            var pctC=Math.min(999,Math.round(100*out.chillToDate/Math.max(1,chillReq)));
            var enough=out.chillToDate>=chillReq;
            bits.push('Chill hours: ~'+out.chillToDate+' of the ~'+chillReq+' required to break dormancy ('+(enough?'reached ✓':'~'+pctC+'%')+')');
          } else if(out.chillToDate!=null){
            bits.push('Chill hours accumulated: ~'+out.chillToDate);
          }
          bits.push('Based on real measurements through the house geometry — not a physical sensor');
          out.note_he=bits.join(' · ');
          return out;
        }
      }
    }catch(e){ /* fall through to model */ }

    // MODEL FALLBACK — no measured days yet for this plant's zone. We cannot
    // honestly report a measured to-date, so we leave *ToDate null and report the
    // REQUIREMENT only, clearly flagged as the curated model.
    out.basis='model';
    var fb=[];
    if(gddReq) fb.push('The plant requires ~'+gddReq+' heat units (GDD) for fruit');
    if(chillReq) fb.push('~'+chillReq+' chill hours to break dormancy');
    fb.push('No real data from your site for this season yet — figures are per the plant parameters (model). The logbook will start filling this in soon.');
    out.note_he=fb.join(' · ');
    return out;
  }

  /* ===================================================================
     BEST WINDOW — the planting/action window. With real history we read which
     window the record says is frost-safe & warm enough for THIS plant; without
     it we fall back to the curated planting_months_he from resident_plants.json.

     Real-history logic: for a FROST-TENDER plant (frost_hardy_c > −5) the window
     opens AFTER the measured last-spring-frost (+ a small buffer) and is bounded
     by the curated planting months; for a hardy/deciduous plant the curated
     dormant-season window stands, but we can confirm it sits in the logged chill
     window. We keep it conservative and HONEST about which basis we used.
     =================================================================== */
  var HEB_MONTHS={ 'january':1,'february':2,'march':3,'april':4,'may':5,'june':6,
    'july':7,'august':8,'september':9,'october':10,'november':11,'december':12 };
  function curatedMonths(p){
    var ms=(p&&p.planting_months_he)||[];
    var nums=ms.map(function(s){ return HEB_MONTHS[String(s).trim()]||null; }).filter(function(x){return x;});
    return nums;
  }
  function monthsToWindowISO(nums, year){
    // contiguous-ish month list → [windowStart, windowEnd] ISO in the given year,
    // handling a winter wrap (e.g. Nov,Dec,Jan,Feb). Returns nulls if empty.
    if(!nums||!nums.length) return [null,null];
    var sorted=nums.slice().sort(function(a,b){return a-b;});
    // detect winter-wrap: months span both Dec-ish (>=11) and Jan-ish (<=3)
    var hasLate=sorted.some(function(m){return m>=11;}), hasEarly=sorted.some(function(m){return m<=3;});
    var startM, endM, startY=year, endY=year;
    if(hasLate && hasEarly){
      // window is Nov(Y-1)→ early(Y): start at the earliest late month of prev year
      var lateMin=Math.min.apply(null, sorted.filter(function(m){return m>=11;}));
      var earlyMax=Math.max.apply(null, sorted.filter(function(m){return m<=3;}));
      startM=lateMin; startY=year-1; endM=earlyMax; endY=year;
    } else {
      startM=sorted[0]; endM=sorted[sorted.length-1];
    }
    var start=startY+'-'+String(startM).padStart(2,'0')+'-01';
    // end = last day of endM
    var endLast=new Date(Date.UTC(endY, endM, 0)).getUTCDate();
    var end=endY+'-'+String(endM).padStart(2,'0')+'-'+String(endLast).padStart(2,'0');
    return [start,end];
  }

  function bestWindow(plantId){
    var p=plantParams(plantId);
    var out={ plantId:plantId, windowStart:null, windowEnd:null,
              basis:'model-fallback', reason_he:'' };
    var curatedNums=curatedMonths(p);
    var t=todayISO(), y=yearOf(t);
    // the upcoming season-year to schedule the window in: if we're past the
    // curated window for this year, project to next year.
    var targetYear=y+1;   // default: schedule the NEXT cycle
    // if any curated month is still ahead this year, use this year
    if(curatedNums.length){
      var nowM=monthOf(t);
      var futureThisYear=curatedNums.some(function(m){ return m>=nowM; });
      if(futureThisYear) targetYear=y;
    }

    var curatedWin=monthsToWindowISO(curatedNums, targetYear);

    try{
      var tender=(p && p.frost_hardy_c!=null && p.frost_hardy_c>-5);
      var fr=frostDates();
      if(tender && fr.basis==='real' && fr.lastFrostEst){
        // window opens AFTER his measured last-spring frost (+7-day buffer),
        // clamped to within the curated months if we have them.
        var openISO=addDaysISO(fr.lastFrostEst, 7);
        var winStart=openISO, winEnd=curatedWin[1];
        // if curated end exists and is AFTER open, keep [open, curatedEnd];
        // else give a 6-week planting window from open.
        if(!winEnd || winEnd < winStart){ winEnd=addDaysISO(winStart, 42); }
        out.windowStart=winStart;
        out.windowEnd=winEnd;
        out.basis='real-history';
        out.reason_he='Frost-tender — based on the last frost actually measured at your site (~'+fr.lastFrostEst+'), the safe planting window opens after it (+one-week buffer). Based on real measurements.';
        return out;
      }
      if(!tender && p){
        // hardy/deciduous: curated dormant-season window stands; if we have a real
        // chill window we confirm it.
        if(curatedWin[0]){
          out.windowStart=curatedWin[0]; out.windowEnd=curatedWin[1];
          // do we have real chill data backing the dormant window?
          var zoneId=plantZone(plantId), cw=chillWindow();
          var chillRows=zoneId?zoneDaily(zoneId, cw.from, cw.to):[];
          if(chillRows.length>0){
            out.basis='real-history';
            out.reason_he='Deciduous/hardy tree — the planting window is in the leaf-fall season. Your logbook is already recording the chill-hour accumulation this winter, which confirms the window. Based on real measurements + the plant parameters.';
          } else {
            out.basis='model-fallback';
            out.reason_he='Deciduous/hardy tree — the planting window is in the leaf-fall season per the recommended planting months (model). No measured chill data for this season yet.';
          }
          return out;
        }
      }
    }catch(e){ /* fall through to curated */ }

    // MODEL FALLBACK — curated months only (or, if none, a generic note).
    if(curatedWin[0]){
      out.windowStart=curatedWin[0]; out.windowEnd=curatedWin[1];
      out.basis='model-fallback';
      out.reason_he='Window per the plant\'s recommended planting months (model, from the curated data). Not enough real history from the site yet to refine by your frost — the logbook will do that.';
    } else {
      out.basis='model-fallback';
      out.reason_he='No window data for this plant. Once the logbook accumulates a season, I can compute a window from the frost measured at the site.';
    }
    return out;
  }

  /* ===================================================================
     WATER FORECAST — liters/day for the next `days` for a zone, ET-based.
     Each plant's daily need ≈ ETc(zone, season) × Kc × canopy_m2 (mm/day ×
     m² = liters/day). We sum his plants in the zone. The ETc we use is, in
     order of preference:
       1) the RECENT REAL ETc his record measured for this zone (mean of the
          last ~21 days / 3 weeks of dayRecord.etc) — the personalized, measured value.
       2) the generic-model seasonal ETc (cellProfile.ETc) — fallback.
     Output is a flat liters/day across the horizon (we don't claim to forecast
     future weather day-by-day — that would be fabrication; we extend the
     recent measured demand). We SAY which basis was used.
     =================================================================== */
  function plantsInZone(zoneId){
    return plantList().filter(function(pl){
      var z=pl.zoneId||plantZone(pl.id); return z===zoneId;
    });
  }
  function recentMeanEtc(zoneId){
    var to=todayISO(), from=addDaysISO(to, -21);
    var rows=zoneDaily(zoneId, from, to);
    if(!rows.length) return null;
    var s=0,n=0;
    rows.forEach(function(r){ if(r&&r.etc!=null&&isFinite(r.etc)){ s+=r.etc; n++; } });
    return n? s/n : null;
  }
  function curSeasonKey(){
    return seasonOfMonth(monthOf(todayISO()));
  }
  function waterForecast(zoneId, days){
    var horizon=Math.max(1, Math.min(60, days||7));
    var out={ zoneId:zoneId, litersPerDay:[], totalLiters:0, basis:'model', note_he:'' };
    try{
      var plants=plantsInZone(zoneId);
      // ETc mm/day for this zone (measured recent → model fallback)
      var etcReal=recentMeanEtc(zoneId);
      var etc, basis, etcNote;
      if(etcReal!=null){
        etc=etcReal; basis='real';
        etcNote='ET per the last 3 weeks actually measured at the site (~'+r1(etc)+' mm/day)';
      } else {
        var prof=modelProfile(zoneId, curSeasonKey());
        etc=(prof&&prof.ETc!=null)?prof.ETc:null;
        basis='model';
        etcNote=(etc!=null)
          ? 'ET per the generic seasonal model (~'+r1(etc)+' mm/day) — no real data for this zone yet'
          : 'No ET data available for this zone';
      }
      out.basis=basis;

      // daily liters = Σ_plants ETc(mm/day) × Kc × canopy_m2  (mm·m² → liters)
      var perDay=0, nPlants=0;
      if(etc!=null){
        plants.forEach(function(pl){
          var pp=plantParams(pl.id)||pl;
          var kc=(pp&&pp.kc!=null)?pp.kc:1.0;
          var canopy=(pp&&pp.canopy_m2!=null)?pp.canopy_m2:1.0;
          perDay += etc*kc*canopy;
          nPlants++;
        });
        // if the zone has NO registered plants, give a bare-soil reference (1 m²)
        if(nPlants===0) perDay = etc*1.0;
      }
      perDay=r1(perDay);
      for(var d=0; d<horizon; d++) out.litersPerDay.push(perDay);
      out.totalLiters=r1(perDay*horizon);

      var who = nPlants? (nPlants+' plants in the zone') : 'bare soil (1 m² reference)';
      out.note_he='~'+perDay+' L/day for '+who+' · '+etcNote+
        ' · irrigation ≈ ETc×Kc×canopy-area · ' +
        (basis==='real'?'based on real measurements':'model · estimate')+
        ' · the forecast extends the most recent measured demand (not a day-by-day forecast of future weather)';
      return out;
    }catch(e){
      out.note_he='Cannot compute right now — missing data';
      return out;
    }
  }

  /* ===================================================================
     BIAS CORRECTION — the heart of the module. Compare HIS MEASURED daily
     values against what the GENERIC theoretical model predicts for the same
     days, learn the systematic deviation, expose it so future predictions are
     tuned to HIS microclimate. (Real data beats the generic average.)

       tempBiasC  = mean over measured days of (measured tMean − model meanTemp
                    for that day's season & zone). Positive → his site runs
                    WARMER than the generic model says.
       dliBiasPct = mean over measured days of (measured DLI − model DLI)/model
                    DLI × 100. Positive → his site gets MORE light than modelled.

     We aggregate across all zones with data, weighting each day equally. If
     there are no measured days OR no model profile, we return a null bias and
     SAY the model is still the only basis.
     =================================================================== */
  function bias(){
    var out={ tempBiasC:null, dliBiasPct:null, note_he:'' };
    try{
      var tDiffs=[], dliRatios=[], nDays=0;
      zoneList().forEach(function(z){
        var rows=zoneDaily(z.id, null, null);
        if(!rows.length) return;
        // cache model means per season for this zone
        var mMean={}, mDLI={};
        rows.forEach(function(r){
          if(!r||!r.date) return;
          var season=seasonOfMonth(monthOf(r.date));
          if(!(season in mMean)) mMean[season]=modelMeanTemp(z.id, season);
          if(!(season in mDLI))  mDLI[season]=modelDLI(z.id, season);
          var mm=mMean[season], md=mDLI[season];
          if(r.tMean!=null && mm!=null){ tDiffs.push(r.tMean - mm); nDays++; }
          if(r.dli!=null && md!=null && md>0){ dliRatios.push((r.dli - md)/md); }
        });
      });
      if(tDiffs.length){
        var tb=tDiffs.reduce(function(a,b){return a+b;},0)/tDiffs.length;
        out.tempBiasC=r1(tb);
      }
      if(dliRatios.length){
        var db=dliRatios.reduce(function(a,b){return a+b;},0)/dliRatios.length*100;
        out.dliBiasPct=r0(db);
      }
      if(out.tempBiasC!=null || out.dliBiasPct!=null){
        var parts=[];
        if(out.tempBiasC!=null){
          var dir=out.tempBiasC>0?'warmer':(out.tempBiasC<0?'colder':'identical');
          parts.push('Your site runs '+dir+' by '+Math.abs(out.tempBiasC)+'°C vs the generic model (daily mean)');
        }
        if(out.dliBiasPct!=null){
          var dirL=out.dliBiasPct>0?'more':(out.dliBiasPct<0?'less':'the same');
          parts.push('Receives '+Math.abs(out.dliBiasPct)+'% '+dirL+' light (DLI) than the model');
        }
        parts.push('Computed over ('+nDays+' measurement days) — a bias correction that tunes the forecasts to your microclimate. Based on real measurements against the model.');
        out.note_he=parts.join(' · ');
      } else {
        out.note_he='Not enough measurement days yet to learn the site\'s bias against the model. For now the forecasts rely on the generic model; the bias will be learned as the logbook accumulates days.';
      }
    }catch(e){
      out.note_he='Cannot compute bias right now';
    }
    return out;
  }

  /* ---------------- ready: resolve after RecordStore + Derive are warm ----------------
     We don't BLOCK on a full backfill (that runs idle for minutes); we resolve
     once both globals exist (or after a short timeout) so consumers can call and
     get the best-available (real or model-fallback) answer. */
  var _resolveReady;
  var readyP=new Promise(function(res){ _resolveReady=res; });
  function warm(){
    ensureCSS();
    var done=false;
    function finish(){ if(done) return; done=true; _resolveReady(true); }
    try{
      var rs=RS();
      var waiters=[];
      if(rs && rs.ready && typeof rs.ready.then==='function') waiters.push(rs.ready.catch(function(){}));
      var d=DRV();
      if(d && d.ready && typeof d.ready.then==='function') waiters.push(d.ready.catch(function(){}));
      if(waiters.length){
        Promise.all(waiters).then(finish).catch(finish);
        setTimeout(finish, 4000);   // never hang forever
      } else {
        finish();
      }
    }catch(e){ finish(); }
  }

  window.Predict={
    ready: readyP,
    frostDates: frostDates,
    seasonForecast: seasonForecast,
    bestWindow: bestWindow,
    waterForecast: waterForecast,
    bias: bias,
    // exposed for tests / debugging (documented as helpers, no hidden side effects)
    _modelMeanTemp: modelMeanTemp,
    _recordDays: recordDays
  };

  // warm after the current tick so Derive/RecordStore IIFEs have registered.
  if (window.requestAnimationFrame) window.requestAnimationFrame(warm);
  else setTimeout(warm, 0);
})();
