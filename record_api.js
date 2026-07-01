/* ===================================================================
   record_api.js — the MEASURED-WEATHER fetch layer for the Living Record.

   Pulls REAL hourly weather (Open-Meteo) for Alex's exact coordinates and
   hands it, gap-free, to the rest of the Living Record pipeline. This is the
   "based on real measurements" half of the record: temperature, shortwave radiation,
   ET0, precipitation, cloud, wind, humidity and soil temperature — actually
   measured / reanalysed, NOT a sensor in his garden and NOT our model.

   Two sources, merged by hour:
     · ARCHIVE  (https://archive-api.open-meteo.com/v1/archive) — ERA5
       reanalysis, covers history up to ~today−5 days. Carries the 7 air/soil
       fields EXCEPT soil_temperature (ERA5 archive returns null for it here),
       so soilT from the archive window is left null and the geometry engine
       derives a soil reservoir temperature from the diurnal curve instead.
     · FORECAST (https://api.open-meteo.com/v1/forecast) with past_days (≤92)
       — covers the recent window INCLUDING the ~5-day gap the archive lags by,
       and DOES carry soil_temperature_6cm.

   Timezone: we request timezone=GMT so every hourly timestamp is unambiguous
   UTC ("YYYY-MM-DDTHH:00"); callers append "Z" to get the correct absolute
   instant for Astro.sun(). This is host-timezone independent (works the same
   in the browser and under the node load-test).

   Defensive by contract: fetchRange() NEVER throws. On a failed/partial fetch
   it returns whatever it got plus a `gaps` list of [fromISO,toISO] windows it
   could not fill, so RecordStore can record an honest gap rather than fake data.
   =================================================================== */
(function(){
  'use strict';
  if (window.RecordApi) return;

  // Alex's exact plot (data/site.json). Hard-coded fallback; overridden by
  // site.json once Derive has loaded it (keeps a single source of truth).
  var LAT = 34.0000, LON = -40.0000;
  function coords(){
    try{
      var s = window.Derive && window.Derive.data && window.Derive.data.site;
      if (s && s.coords && s.coords.lat != null && s.coords.lon != null)
        return { lat: s.coords.lat, lon: s.coords.lon };
    }catch(e){}
    return { lat: LAT, lon: LON };
  }

  var ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
  var FORECAST = 'https://api.open-meteo.com/v1/forecast';
  // the 7 fields shared by both endpoints (+ soil temp, only real on forecast)
  var HOURLY = 'temperature_2m,shortwave_radiation,et0_fao_evapotranspiration,' +
               'precipitation,cloud_cover,wind_speed_10m,relative_humidity_2m,' +
               'soil_temperature_6cm';

  // Open-Meteo's archive lags real time by ~5 days; the forecast past_days
  // window (≤92 days) covers that gap and the recent past.
  var ARCHIVE_LAG_DAYS = 5;
  var FORECAST_PAST_MAX = 92;

  var DAY = 86400000;
  function toISODate(d){
    // YYYY-MM-DD in UTC (matches the timezone=GMT request)
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth()+1).padStart(2,'0') + '-' +
      String(d.getUTCDate()).padStart(2,'0');
  }
  function parseISODate(s){
    // accept "YYYY-MM-DD" (or a full ISO) → a UTC midnight Date
    var m = String(s||'').slice(0,10);
    var p = m.split('-');
    return new Date(Date.UTC(+p[0], (+p[1]||1)-1, +p[2]||1, 0,0,0,0));
  }

  // safe JSON fetch — resolves null on any failure (never throws upward)
  function getJSON(url){
    return fetch(url)
      .then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; });
  }

  // pull the 9 named hourly arrays out of an Open-Meteo response (any missing
  // field becomes a same-length array of nulls so the columns stay aligned).
  function extract(j){
    var h = (j && j.hourly) || {};
    var times = h.time || [];
    var n = times.length;
    function col(k){
      var a = h[k];
      if (Array.isArray(a) && a.length === n) return a.slice();
      // pad/truncate to keep every column the same length as `times`
      var out = new Array(n);
      for (var i=0;i<n;i++) out[i] = (Array.isArray(a) && a[i]!=null) ? a[i] : null;
      return out;
    }
    return {
      times: times.slice(),
      temp:  col('temperature_2m'),
      rad:   col('shortwave_radiation'),
      et0:   col('et0_fao_evapotranspiration'),
      precip:col('precipitation'),
      cloud: col('cloud_cover'),
      wind:  col('wind_speed_10m'),
      rh:    col('relative_humidity_2m'),
      soilT: col('soil_temperature_6cm')
    };
  }

  function emptyBundle(){
    return { times:[], temp:[], rad:[], et0:[], precip:[], cloud:[], wind:[], rh:[], soilT:[], gaps:[] };
  }

  // merge two bundles, deduping by hour-timestamp; LATER source wins on a tie
  // (we pass forecast as the "winner" so its real soilT overrides archive nulls
  // in the overlap window). Output sorted ascending by time.
  function merge(a, b){
    var idx = {};            // isoHour → merged row {temp,rad,...}
    var COLS = ['temp','rad','et0','precip','cloud','wind','rh','soilT'];
    function absorb(bundle){
      if (!bundle || !bundle.times) return;
      for (var i=0;i<bundle.times.length;i++){
        var t = bundle.times[i];
        var row = idx[t] || (idx[t] = {});
        for (var c=0;c<COLS.length;c++){
          var k = COLS[c], v = bundle[k] ? bundle[k][i] : null;
          // overwrite when the incoming value is non-null; keep a prior non-null
          // if the incoming is null (so we never blank out a good archive value
          // with a missing forecast cell, and vice-versa).
          if (v != null) row[k] = v;
          else if (!(k in row)) row[k] = null;
        }
      }
    }
    absorb(a); absorb(b);   // b (forecast) absorbed last → wins non-null ties
    var keys = Object.keys(idx).sort();   // ISO strings sort chronologically
    var out = emptyBundle();
    for (var j=0;j<keys.length;j++){
      var t2 = keys[j], r = idx[t2];
      out.times.push(t2);
      out.temp.push(r.temp ?? null);
      out.rad.push(r.rad ?? null);
      out.et0.push(r.et0 ?? null);
      out.precip.push(r.precip ?? null);
      out.cloud.push(r.cloud ?? null);
      out.wind.push(r.wind ?? null);
      out.rh.push(r.rh ?? null);
      out.soilT.push(r.soilT ?? null);
    }
    return out;
  }

  /* fetchRange(startISO, endISO) → Promise<bundle>
     bundle = {times[], temp[], rad[], et0[], precip[], cloud[], wind[], rh[],
               soilT[], gaps:[[fromISO,toISO],…]}
     - hourly UTC timestamps, archive+forecast merged/deduped.
     - NEVER throws. On failure returns whatever arrived + the unfilled gaps. */
  function fetchRange(startISO, endISO){
    var c = coords();
    var start = parseISODate(startISO);
    var endD  = parseISODate(endISO || toISODate(new Date()));
    if (isNaN(start.getTime())) start = new Date(Date.now() - 365*DAY);
    if (isNaN(endD.getTime()))  endD  = new Date();
    if (endD < start) { var t=endD; endD=start; start=t; }

    var today = new Date();
    var archiveEnd = new Date(today.getTime() - ARCHIVE_LAG_DAYS*DAY); // ~today−5
    // the forecast covers the most-recent FORECAST_PAST_MAX days (and 1 ahead)
    var fcStart = new Date(today.getTime() - FORECAST_PAST_MAX*DAY);

    var tasks = [];
    var plannedGaps = [];   // windows we attempt; pruned to real gaps after

    // ARCHIVE leg: [start, min(endD, archiveEnd)]
    var aEnd = (endD < archiveEnd) ? endD : archiveEnd;
    if (aEnd >= start){
      var aUrl = ARCHIVE + '?latitude=' + c.lat + '&longitude=' + c.lon +
        '&start_date=' + toISODate(start) + '&end_date=' + toISODate(aEnd) +
        '&hourly=' + HOURLY + '&timezone=GMT';
      tasks.push(getJSON(aUrl).then(function(j){
        if (!j){ plannedGaps.push([toISODate(start), toISODate(aEnd)]); return emptyBundle(); }
        return extract(j);
      }).catch(function(){ plannedGaps.push([toISODate(start), toISODate(aEnd)]); return emptyBundle(); }));
    }

    // FORECAST leg: the recent window. We request past_days big enough to cover
    // from max(start, fcStart) up to endD (clamped to the ≤92-day past limit).
    var fLegStart = (start > fcStart) ? start : fcStart;
    if (endD >= fLegStart){
      // past_days = whole days between today and fLegStart (capped)
      var pastDays = Math.ceil((today.getTime() - fLegStart.getTime())/DAY);
      pastDays = Math.max(0, Math.min(FORECAST_PAST_MAX, pastDays));
      var fcDays = Math.max(1, Math.min(7, Math.ceil((endD.getTime() - today.getTime())/DAY)+1));
      var fUrl = FORECAST + '?latitude=' + c.lat + '&longitude=' + c.lon +
        '&hourly=' + HOURLY + '&past_days=' + pastDays + '&forecast_days=' + fcDays +
        '&timezone=GMT';
      tasks.push(getJSON(fUrl).then(function(j){
        if (!j){ plannedGaps.push([toISODate(fLegStart), toISODate(endD)]); return emptyBundle(); }
        return extract(j);
      }).catch(function(){ plannedGaps.push([toISODate(fLegStart), toISODate(endD)]); return emptyBundle(); }));
    }

    if (!tasks.length){
      var eb = emptyBundle();
      eb.gaps = [[toISODate(start), toISODate(endD)]];
      return Promise.resolve(eb);
    }

    return Promise.all(tasks).then(function(parts){
      var merged = emptyBundle();
      for (var i=0;i<parts.length;i++) merged = merge(merged, parts[i]);
      // clip strictly to the requested [start, endD] inclusive day-window so a
      // generous past_days request doesn't leak hours before `start`.
      var lo = toISODate(start), hi = toISODate(endD);
      merged = clip(merged, lo, hi);
      // honest gaps: the failed-leg windows we recorded, plus an overall gap if
      // we ended up with NOTHING at all.
      merged.gaps = plannedGaps.slice();
      if (!merged.times.length && !merged.gaps.length) merged.gaps.push([lo, hi]);
      return merged;
    }).catch(function(){
      var fb = emptyBundle();
      fb.gaps = [[toISODate(start), toISODate(endD)]];
      return fb;
    });
  }

  // keep only rows whose date (YYYY-MM-DD prefix) is within [loDay, hiDay]
  function clip(b, loDay, hiDay){
    var out = emptyBundle();
    var COLS = ['temp','rad','et0','precip','cloud','wind','rh','soilT'];
    for (var i=0;i<b.times.length;i++){
      var day = String(b.times[i]).slice(0,10);
      if (day < loDay || day > hiDay) continue;
      out.times.push(b.times[i]);
      for (var c=0;c<COLS.length;c++) out[COLS[c]].push(b[COLS[c]][i]);
    }
    return out;
  }

  // group a flat bundle into per-day buckets keyed by YYYY-MM-DD (UTC). Each
  // bucket is itself a bundle (the 24 hourly rows for that day) ready to feed
  // Derive.recordDay(zone, dateISO, hourlyWxForDay). Exposed so RecordStore
  // can iterate day-by-day during the idle-chunked backfill.
  function splitByDay(b){
    var COLS = ['temp','rad','et0','precip','cloud','wind','rh','soilT'];
    var days = {};
    for (var i=0;i<b.times.length;i++){
      var day = String(b.times[i]).slice(0,10);
      var bk = days[day];
      if (!bk){ bk = days[day] = { date:day, times:[], temp:[], rad:[], et0:[],
        precip:[], cloud:[], wind:[], rh:[], soilT:[] }; }
      bk.times.push(b.times[i]);
      for (var c=0;c<COLS.length;c++) bk[COLS[c]].push(b[COLS[c]][i]);
    }
    return days;
  }

  window.RecordApi = {
    fetchRange: fetchRange,
    splitByDay: splitByDay,
    coords: coords,
    // exposed for the load-test / debugging — pure helpers, no I/O
    _merge: merge,
    _extract: extract,
    _toISODate: toISODate
  };
})();
