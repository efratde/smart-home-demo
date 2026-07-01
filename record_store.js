/* ===================================================================
   record_store.js — the LIVING RECORD accumulator + persistence layer.

   Builds and keeps a day-by-day LOGBOOK of what each yard zone (and, by
   zone resolution, each of Alex's plants) ACTUALLY experienced: real measured
   weather (RecordApi → Open-Meteo) propagated through the house's real
   shadow/incidence geometry (Derive.recordDay) and accumulated per day.

     measured (real) : temp/rad/et0/precip/cloud/wind/rh/soilT — Open-Meteo.
     modeled (his geometry) : how that town weather is reshaped by HIS terrain
       + building shadow mask and per-cell incident solar.
     NEVER a physical soil/garden sensor — this is reanalysis + a physics model.

   Persistence: localStorage key `home_record_v1`
     { v, cursorFrom, cursorTo, gaps:[[from,to]…], zones:{ zoneId:{ dateISO:dayRecord } },
       rooms:{ roomId:{ dateISO:roomDayRecord } },
       town:{ dateISO:{tMin,tMax,rainMm} } }
   Per-day-per-zone records are tiny; 12 mo × 3 zones ≈ 90 KB — well within budget.

   INTERIOR ROOMS (the `rooms` sub-key) extend the logbook indoors: for each
   backfilled day we run the contract's per-room daily kernel
   (Derive.roomDay(roomId,dateISO,wx,geom)) — the SAME measured Open-Meteo hourly
   air, marched through this room's mass/exposure geometry — to log the modeled
   indoor curve (tMin/tMax/tMean + comfort/heat/cold/condensation tallies). The
   indoor temperature is a MODELED damped response to the measured outdoor weather
   through HIS room geometry — NEVER a physical indoor thermostat or sensor.

   Backfill is IDLE-CHUNKED (mirrors derive.js _warmSeasons: requestIdleCallback
   with ~8 ms time-budgeted slices, setTimeout fallback) so building the record
   never blocks a frame. On first open it bootstraps the LAST 12 MONTHS; on
   later opens it only fetches the gap from the stored cursor to today.

   Defensive by contract: never throws on load; catches every fetch failure and
   records an honest gap rather than fabricating a day.
   =================================================================== */
(function(){
  'use strict';
  if (window.RecordStore) return;

  var LS_KEY = 'home_record_v1';
  var STORE_V = 1;
  var DAY = 86400000;
  var BOOTSTRAP_MONTHS = 12;

  // ---- in-memory model (mirrors what we persist) ----
  var DB = { v:STORE_V, cursorFrom:null, cursorTo:null, gaps:[], zones:{}, rooms:{}, town:{} };
  var BUILDING = false;          // a backfill pass is in flight
  var TOTAL_DAYS = 0, DONE_DAYS = 0;   // progress for status().pct

  // ---- date helpers (UTC, matching RecordApi's timezone=GMT timestamps) ----
  function toISODate(d){
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth()+1).padStart(2,'0') + '-' +
      String(d.getUTCDate()).padStart(2,'0');
  }
  function parseDay(s){
    var p = String(s||'').slice(0,10).split('-');
    return new Date(Date.UTC(+p[0], (+p[1]||1)-1, +p[2]||1, 0,0,0,0));
  }
  function todayISO(){ return toISODate(new Date()); }

  // ---- persistence (never throws) ----
  function loadDB(){
    try{
      var raw = window.localStorage && window.localStorage.getItem(LS_KEY);
      if (!raw) return;
      var j = JSON.parse(raw);
      if (j && j.v === STORE_V){
        DB = Object.assign({ v:STORE_V, cursorFrom:null, cursorTo:null, gaps:[], zones:{}, rooms:{}, town:{} }, j);
        if (!DB.zones) DB.zones = {};
        if (!DB.rooms) DB.rooms = {};   // older stores predate interior rooms
        if (!DB.town) DB.town = {};
        if (!Array.isArray(DB.gaps)) DB.gaps = [];
      }
    }catch(e){ /* corrupt store → start fresh, never throw */ }
  }
  var _saveTimer = null;
  function saveDB(){
    // debounce writes during a backfill burst (one stringify per ~600 ms)
    if (_saveTimer) return;
    _saveTimer = setTimeout(function(){
      _saveTimer = null;
      try{ window.localStorage && window.localStorage.setItem(LS_KEY, JSON.stringify(DB)); }
      catch(e){ /* quota / private mode → keep the in-memory record working */ }
    }, 600);
  }
  function saveNow(){
    if (_saveTimer){ clearTimeout(_saveTimer); _saveTimer = null; }
    try{ window.localStorage && window.localStorage.setItem(LS_KEY, JSON.stringify(DB)); }catch(e){}
  }

  // ---- which zones to record (from Derive's loaded site.json; fallback list) ----
  function zoneList(){
    try{
      var zs = window.Derive && window.Derive.data && window.Derive.data.site &&
               window.Derive.data.site.zones;
      if (Array.isArray(zs) && zs.length)
        return zs.map(function(z){ return { id:z.id, name_he:z.name_he||z.id }; });
    }catch(e){}
    return [
      { id:'backyard', name_he:'Backyard' },
      { id:'balcony',  name_he:'First-floor balcony' },
      { id:'front',    name_he:'House front' }
    ];
  }
  function plantList(){
    try{
      var ps = window.Derive && window.Derive.data && window.Derive.data.plants;
      if (Array.isArray(ps) && ps.length)
        return ps.map(function(p){
          return { id:p.id, name_he:p.name_he||p.id, name_latin:p.name_latin||'',
                   zoneId:p.best_zone_id||p.zoneId||null };
        });
    }catch(e){}
    return [];
  }
  function plantZone(plantId){
    var ps = plantList();
    for (var i=0;i<ps.length;i++) if (ps[i].id===plantId) return ps[i].zoneId;
    return null;
  }

  // ---- which INTERIOR ROOMS to record. The authoritative room rects live in
  //   app.js (EnterMode.ROOMS) and surface as window.__enterMode.roomGeom(id);
  //   we keep a name/id fallback so allRooms()/queries work even before the 3D
  //   scene mounts (e.g. headless load-test). Geometry (roomGeomOf) supplies the
  //   per-room warmth LEAN; it is only available once __enterMode exists. The
  //   kernel (Derive.roomDay) is geometry-aware and degrades to lean 0 without it,
  //   so a backfill that runs pre-mount still logs the modeled base-house indoor
  //   curve and the lean refines on a later pass. ----
  var ROOM_FALLBACK = [
    { id:'kitchen',   name_he:'Kitchen' },
    { id:'living',    name_he:'Living room' },
    { id:'bedroomG',  name_he:'Bedroom (ground)' },
    { id:'bathG',     name_he:'Bathroom (ground)' },
    { id:'pantry',    name_he:'Pantry' },
    { id:'stairsG',   name_he:'Stairs (ground)' },
    { id:'bedroomNE', name_he:'Bedroom (north)' },
    { id:'bedroomSW', name_he:'Bedroom (south)' },
    { id:'bathU',     name_he:'Bathroom (upper)' },
    { id:'terrace',   name_he:'Terrace' },
    { id:'landing',   name_he:'Staircase' }
  ];
  function roomList(){
    // prefer the workbench's room doc (carries the user's own Hebrew names) when present
    try{
      var wb = window.__workbench;
      if (wb && typeof wb.allRooms === 'function'){
        var rs = wb.allRooms();
        if (Array.isArray(rs) && rs.length)
          return rs.map(function(r){ return { id:r.id, name_he:r.name_he||r.he||r.id }; });
      }
    }catch(e){}
    return ROOM_FALLBACK.slice();
  }
  // the room's plan-frame geometry (floor/aspect/rect) — only available once the
  // 3D EnterMode has mounted. Defensive: returns null if not ready (no throw).
  function roomGeomOf(id){
    try{
      var em = window.__enterMode;
      if (em && typeof em.roomGeom === 'function') return em.roomGeom(id);
    }catch(e){}
    return null;
  }

  // ---- idle scheduler (mirrors derive.js _warmSeasons) ----
  var _ric = (window.requestIdleCallback) ? window.requestIdleCallback.bind(window) : null;
  function schedule(cb){
    if (_ric) _ric(function(dl){ cb(dl); }, { timeout:1500 });
    else setTimeout(function(){ cb(null); }, 16);
  }

  /* ---- the backfill engine: fetch a range, split by day, and run
     Derive.recordDay per zone for each day in idle slices. ---- */
  function ingestBundle(bundle){
    if (!bundle) return;
    // record any honest gaps the API reported
    if (Array.isArray(bundle.gaps) && bundle.gaps.length){
      bundle.gaps.forEach(function(g){ DB.gaps.push(g); });
    }
    var byDay = (window.RecordApi && window.RecordApi.splitByDay)
      ? window.RecordApi.splitByDay(bundle) : {};
    var days = Object.keys(byDay).sort();
    var zones = zoneList();
    var rooms = roomList();
    // queue typed units exactly like _warmSeasons queues (cell, season): for each
    // day, first the zones (outdoor) then the interior rooms. Each unit is
    // ['z'|'r', day, id]; rooms run through the contract's Derive.roomDay kernel
    // with the SAME measured day weather + that room's geometry.
    var queue = [];
    days.forEach(function(day){
      zones.forEach(function(z){ queue.push(['z', day, z.id]); });
      rooms.forEach(function(rm){ queue.push(['r', day, rm.id]); });
    });
    TOTAL_DAYS += days.length;
    var perDay = zones.length + rooms.length;   // units that make up one finished day
    var doneUnits = 0;
    var i = 0;
    function slice(deadline){
      var t0 = Date.now();
      while (i < queue.length){
        var kind = queue[i][0], day = queue[i][1], id = queue[i][2];
        i++; doneUnits++;
        try{
          if (kind === 'z'){
            var rec = window.Derive && window.Derive.recordDay
              ? window.Derive.recordDay(id, day, byDay[day]) : null;
            if (rec){
              if (!DB.zones[id]) DB.zones[id] = {};
              DB.zones[id][day] = rec;
              // town-level climate layer: tMin/tMax/rain from the measured arrays
              if (!DB.town[day]){
                var wx = byDay[day];
                DB.town[day] = townDay(day, wx);
              }
            }
          } else { // kind === 'r' — interior room (modeled indoor from measured outdoor)
            // geom (the per-room warmth LEAN) is only available once the 3D
            // EnterMode has mounted; pass it when we have it. Derive.roomDay is
            // geometry-aware and degrades gracefully (lean 0) when geom is null,
            // so the room still logs the MODELED base-house indoor curve from the
            // measured outdoor air — the lean refines once geometry is present.
            var geom = roomGeomOf(id);
            var rrec = (window.Derive && window.Derive.roomDay)
              ? window.Derive.roomDay(id, day, byDay[day], geom) : null;
            if (rrec){
              if (!DB.rooms[id]) DB.rooms[id] = {};
              DB.rooms[id][day] = rrec;
            }
          }
        }catch(e){ /* one bad day/room must not stall the whole backfill */ }
        // count a finished DAY (after its last unit) for the progress pct
        if (doneUnits % perDay === 0) DONE_DAYS++;
        var over = (deadline && deadline.timeRemaining) ? deadline.timeRemaining() < 6 : (Date.now()-t0) >= 8;
        if (over) break;
      }
      if (i < queue.length){ saveDB(); schedule(slice); }
      else { finishBackfill(); }
    }
    schedule(slice);
  }

  function townDay(day, wx){
    var tMin=Infinity, tMax=-Infinity, rain=0, seen=false;
    if (wx && wx.temp){
      for (var i=0;i<wx.temp.length;i++){
        var t=wx.temp[i]; if (t!=null){ seen=true; if (t<tMin)tMin=t; if (t>tMax)tMax=t; }
        var p=wx.precip&&wx.precip[i]; if (p!=null) rain+=p;
      }
    }
    return { date:day,
      tMin: seen?+tMin.toFixed(1):null, tMax: seen?+tMax.toFixed(1):null,
      rainMm:+rain.toFixed(2) };
  }

  // recompute the persisted cursor span from what we actually hold
  function recomputeCursor(){
    var all = Object.keys(DB.town);
    // also fold in any zone-only days (defensive)
    zoneList().forEach(function(z){
      var m = DB.zones[z.id]; if (m) Object.keys(m).forEach(function(d){ all.push(d); });
    });
    if (!all.length){ DB.cursorFrom = DB.cursorTo = null; return; }
    all.sort();
    DB.cursorFrom = all[0];
    DB.cursorTo   = all[all.length-1];
  }

  function finishBackfill(){
    recomputeCursor();
    BUILDING = false;
    saveNow();
  }

  // fetch [fromISO, toISO] then ingest. Returns a promise that resolves when the
  // FETCH lands (the idle ingest then runs in the background).
  function backfillRange(fromISO, toISO){
    if (!window.RecordApi || !window.RecordApi.fetchRange){
      DB.gaps.push([fromISO, toISO]); return Promise.resolve();
    }
    BUILDING = true;
    return window.RecordApi.fetchRange(fromISO, toISO)
      .then(function(bundle){ ingestBundle(bundle); })
      .catch(function(){ DB.gaps.push([fromISO, toISO]); BUILDING = false; saveNow(); });
  }

  /* ---- boot: load the cursor, then bootstrap (12 mo) or top-up the gap ---- */
  var _resolveReady;
  var readyP = new Promise(function(res){ _resolveReady = res; });

  function boot(){
    loadDB();
    var today = new Date();
    var tISO = toISODate(today);

    function startBackfill(){
      var have = DB.cursorTo && DB.cursorFrom;
      var wanted12 = toISODate(new Date(today.getTime() - BOOTSTRAP_MONTHS*30.44*DAY));
      if (!have){
        // first open → bootstrap the last 12 months
        backfillRange(wanted12, tISO);
      } else {
        // incremental top-up: fetch from the day AFTER the cursor to today, and,
        // if the store doesn't yet reach back 12 mo, extend the back edge too.
        if (DB.cursorTo < tISO){
          var nextDay = toISODate(new Date(parseDay(DB.cursorTo).getTime() + DAY));
          backfillRange(nextDay, tISO);
        }
        if (DB.cursorFrom > wanted12){
          var prevDay = toISODate(new Date(parseDay(DB.cursorFrom).getTime() - DAY));
          backfillRange(wanted12, prevDay);
        }
      }
      _resolveReady(true);
    }

    // wait for Derive's site.json (zones) to be ready so recordDay has geometry.
    // never block forever: if Derive.ready hangs, proceed with the fallback zones.
    var proceeded = false;
    function go(){ if (proceeded) return; proceeded = true; startBackfill(); }
    try{
      if (window.Derive && window.Derive.ready && typeof window.Derive.ready.then==='function'){
        window.Derive.ready.then(go).catch(go);
        setTimeout(go, 4000);   // safety net
      } else { go(); }
    }catch(e){ go(); }
  }

  // ---- query helpers ----
  function inRange(d, fromISO, toISO){
    if (fromISO && d < fromISO) return false;
    if (toISO && d > toISO) return false;
    return true;
  }
  function zoneDaily(zoneId, fromISO, toISO){
    var m = DB.zones[zoneId]; if (!m) return [];
    return Object.keys(m).filter(function(d){ return inRange(d, fromISO, toISO); })
      .sort().map(function(d){ return m[d]; });
  }
  function zoneTotals(zoneId, fromISO, toISO){
    var rows = zoneDaily(zoneId, fromISO, toISO);
    var t = { days:0, frostNights:0, dliSum:0, sunHoursSum:0, gddSum:0, chillSum:0,
              etcSum:0, rainSum:0, tMinAbs:null, tMaxAbs:null, measured:true };
    rows.forEach(function(r){
      t.days++;
      if (r.frost) t.frostNights++;
      t.dliSum += r.dli||0;
      t.sunHoursSum += r.sunHours||0;
      t.gddSum += r.gddInc||0;
      t.chillSum += r.chillInc||0;
      t.etcSum += r.etc||0;
      t.rainSum += r.rainMm||0;
      if (r.tMin!=null && (t.tMinAbs==null || r.tMin<t.tMinAbs)) t.tMinAbs = r.tMin;
      if (r.tMax!=null && (t.tMaxAbs==null || r.tMax>t.tMaxAbs)) t.tMaxAbs = r.tMax;
    });
    // round the sums for display
    t.dliSum=+t.dliSum.toFixed(1); t.sunHoursSum=+t.sunHoursSum.toFixed(1);
    t.gddSum=+t.gddSum.toFixed(0); t.chillSum=+t.chillSum.toFixed(0);
    t.etcSum=+t.etcSum.toFixed(1); t.rainSum=+t.rainSum.toFixed(1);
    return t;
  }
  function plantDaily(plantId, fromISO, toISO){
    var z = plantZone(plantId); if (!z) return [];
    return zoneDaily(z, fromISO, toISO);
  }
  function plantTotals(plantId, fromISO, toISO){
    var z = plantZone(plantId);
    if (!z) return { days:0, frostNights:0, dliSum:0, sunHoursSum:0, gddSum:0,
                     chillSum:0, etcSum:0, rainSum:0, tMinAbs:null, tMaxAbs:null, measured:true };
    return zoneTotals(z, fromISO, toISO);
  }

  // ---- INTERIOR ROOMS (mirror of zoneDaily/zoneTotals) ----
  //   The per-day rows are Derive.roomDay records: this room's MODELED indoor
  //   temperature curve (damped response to the measured outdoor weather through
  //   the room's geometry) — honest measured:true means "real outdoor measurements
  //   through his geometry", not a physical indoor sensor.
  function roomDaily(roomId, fromISO, toISO){
    var m = DB.rooms[roomId]; if (!m) return [];
    return Object.keys(m).filter(function(d){ return inRange(d, fromISO, toISO); })
      .sort().map(function(d){ return m[d]; });
  }
  function roomTotals(roomId, fromISO, toISO){
    var rows = roomDaily(roomId, fromISO, toISO);
    var t = { roomId:roomId, days:0, hoursAbove28:0, hoursBelow18:0, comfortHours:0,
              condensationRiskDays:0, tMinAbs:null, tMaxAbs:null, tMeanAvg:null,
              measured:true };
    var meanSum=0, meanCnt=0;
    rows.forEach(function(r){
      if (!r) return;
      t.days++;
      t.hoursAbove28 += r.hoursAbove28||0;
      t.hoursBelow18 += r.hoursBelow18||0;
      t.comfortHours += r.comfortHours||0;
      if (r.condensationRiskDays) t.condensationRiskDays += r.condensationRiskDays;
      if (r.tMin!=null && (t.tMinAbs==null || r.tMin<t.tMinAbs)) t.tMinAbs = r.tMin;
      if (r.tMax!=null && (t.tMaxAbs==null || r.tMax>t.tMaxAbs)) t.tMaxAbs = r.tMax;
      if (r.tMean!=null){ meanSum+=r.tMean; meanCnt++; }
    });
    t.hoursAbove28=+t.hoursAbove28.toFixed(1); t.hoursBelow18=+t.hoursBelow18.toFixed(1);
    t.comfortHours=+t.comfortHours.toFixed(1);
    t.tMeanAvg = meanCnt? +(meanSum/meanCnt).toFixed(1) : null;
    return t;
  }
  function dayRecord(dateISO){
    var d = String(dateISO||'').slice(0,10);
    var zones = {};
    zoneList().forEach(function(z){
      var m = DB.zones[z.id];
      if (m && m[d]) zones[z.id] = m[d];
    });
    var town = DB.town[d] || { date:d, tMin:null, tMax:null, rainMm:null };
    return { date:d, zones:zones, townTmin:town.tMin, townTmax:town.tMax, rainMm:town.rainMm };
  }
  function status(){
    var days = Object.keys(DB.town).length;
    var pct = TOTAL_DAYS>0 ? Math.min(100, Math.round(100*DONE_DAYS/TOTAL_DAYS)) : (days>0?100:0);
    return {
      firstDate: DB.cursorFrom,
      lastDate:  DB.cursorTo,
      days: days,
      building: BUILDING,
      pct: pct,
      gaps: DB.gaps.slice(),
      measured: true,
      note_he: 'Based on real measurements (Open-Meteo) through the house geometry — not a physical sensor'
    };
  }

  window.RecordStore = {
    ready: readyP,
    status: status,
    zoneDaily: zoneDaily,
    zoneTotals: zoneTotals,
    plantDaily: plantDaily,
    plantTotals: plantTotals,
    roomDaily: roomDaily,
    roomTotals: roomTotals,
    dayRecord: dayRecord,
    allZones: zoneList,
    allPlants: plantList,
    allRooms: roomList,
    // exposed for tests / the integrator (no side effects beyond what's documented)
    _ingest: ingestBundle,
    _db: function(){ return DB; }
  };

  // kick off after the current tick so Derive/RecordApi IIFEs have registered.
  if (window.requestAnimationFrame) window.requestAnimationFrame(boot);
  else setTimeout(boot, 0);
})();
