/* ===========================================================================
 * timemachine.js · "הבית של אלכס" — מכונת הזמן (Time Machine)
 * ---------------------------------------------------------------------------
 * A SELF-MOUNTED floating control that drives the EXISTING time-scrub engine
 * (app.js ~1549-1583). The render loop reads currentDate(dt) every frame from
 * documentElement.dataset.{tmode,tscrub,tplay}; by WRITING dataset.tscrub each
 * animation frame ourselves — with tmode='scrub' and tplay='0' so the loop
 * reads our value VERBATIM (not its built-in 900× auto-advance) — we animate
 * the sun, shadows, sky and (optionally) the microclimate heatmap with full
 * easing control.
 *
 * Three plays:
 *   ▶ יום   — sunrise→sunset over ~8 s wall-clock (easeInOutQuad). Watch HIS
 *             house cast a shadow that sweeps across the yard.
 *   ▶ שנה   — Jan 1 → Dec 31 over ~20 s. The noon sun arc climbs then falls,
 *             days lengthen then shorten; as the date crosses a season boundary
 *             we call window.__microclimate.setSeason(season) so the heatmap
 *             shifts with the year (only if the heatmap is already ON).
 *   ▶ השנה שלי — steps through his ACTUALLY-RECORDED days from RecordStore
 *             (real measured weather, real local geometry). Before any data
 *             exists it falls back to the model year-sweep and SAYS SO.
 *
 * HONEST (CLAUDE.md): the 3D vegetation is disabled — nothing here implies that
 * plants visibly grow. The payoff is the sun arc / shadow sweep / daylight
 * length / heatmap. "השנה שלי" is labelled "מדידות אמת" only when RecordStore
 * actually has days; otherwise it is labelled "מודל" honestly. On finish we
 * restore window.__live() so the world returns to the real present.
 *
 * Owns ONLY this file + its own #tmPanel DOM + #tm-css <style>. Never edits
 * panels.js / app.js / index.html, registers no tab, adds no <script> tag.
 * ======================================================================== */
(function () {
  'use strict';
  if (window.__timeMachine) return;

  var GOLD = '#caa15a';
  var D = (document.documentElement || {});
  // mirror app.js's local civil-time anchoring so our scrub timestamps
  // land on the correct wall-clock, exactly like localDateMs().
  var TZ = 'Etc/GMT+3', DAYMS = 86400000;

  function localOffset(d){
    try{
      var s = new Date(d.toLocaleString('en-US', { timeZone: TZ }));
      var u = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
      return (s - u) / 3600000;
    }catch(e){ return -3; }   // local ~UTC-3 fallback; only used if Intl TZ unavailable
  }
  function localYMD(d){
    try{
      var f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit' });
      var p = f.format(d).split('-').map(Number);
      return { Y:p[0], Mo:p[1], D:p[2] };
    }catch(e){
      return { Y:d.getFullYear(), Mo:d.getMonth()+1, D:d.getDate() };
    }
  }
  // build the UTC ms whose local wall-clock reads (Y,Mo,D) at todMin minutes
  // past local midnight, using that civil day's own DST offset (== app.js).
  function localDateMs(Y, Mo, Dd, todMin){
    var guess = Date.UTC(Y, Mo-1, Dd, 0, 0, 0);
    var off = localOffset(new Date(guess + 12*3600000));
    return guess + (todMin - off*60) * 60000;
  }
  function daysInYear(Y){ return Math.round((Date.UTC(Y+1,0,1) - Date.UTC(Y,0,1)) / DAYMS); }
  function ymdFromDoy(Y, doy){ var t = new Date(Date.UTC(Y,0,1) + Math.round(doy)*DAYMS); return { Mo:t.getUTCMonth()+1, D:t.getUTCDate() }; }
  function dayOfYear(Y, Mo, Dd){ return Math.round((Date.UTC(Y,Mo-1,Dd) - Date.UTC(Y,0,1)) / DAYMS); }

  // the date the world is currently "on" (scrubbed, or now if live)
  function refDate(){
    if ((D.dataset && D.dataset.tmode) !== 'scrub') return new Date();
    var ms = +D.dataset.tscrub;
    return isFinite(ms) ? new Date(ms) : new Date();
  }
  function refYear(){ return localYMD(refDate()).Y; }

  // ---- the ONE write the whole loop shares: park the engine on a timestamp ----
  // tplay='0' so currentDate(dt) returns our scrub verbatim (no 900× drift); the
  // render loop then re-derives sun/shadows/sky/heatmap from it on the next frame.
  function park(ms){
    if (!D.dataset) return;
    D.dataset.tmode = 'scrub';
    D.dataset.tplay = '0';
    D.dataset.tscrub = String(ms);
  }

  /* ---- season helpers (match zone_card.js / derive.js month banding) ------- */
  function seasonOfMonth(m){ return (m===12 || m<=2) ? 'winter' : m<=5 ? 'spring' : m<=8 ? 'summer' : 'autumn'; }
  var SEASON_HE = { winter:'חֹרֶף', spring:'אָבִיב', summer:'קַיִץ', autumn:'סְתָו', live:'חַי' };

  // only nudge the heatmap if it's already ON (don't surprise-toggle it). Returns
  // the season we set (or null). Honest: this shifts the MODELLED seasonal heatmap.
  var _lastSetSeason = null;
  function maybeSetSeason(season){
    var mc = window.__microclimate;
    if (!mc || !mc.isOn || !mc.isOn()) return;
    if (season === _lastSetSeason) return;
    _lastSetSeason = season;
    try { if (mc.setSeason) mc.setSeason(season); } catch (e) {}
  }

  /* ---- easing ---- */
  function easeInOutQuad(k){ return k < 0.5 ? 2*k*k : 1 - Math.pow(-2*k+2, 2)/2; }

  /* =========================================================================
   * animation core — a single rAF driver. Modes: 'day' | 'year' | 'myyear'.
   * Speed multiplier scales wall-clock duration. Pause freezes the clock.
   * ====================================================================== */
  var _raf = 0, _running = null, _paused = false, _speed = 1;
  // running = { mode, t0, elapsed (accumulated while running), durBase, last, year,
  //             days(for myyear), idx }

  function now(){ return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function cancelRaf(){ if (_raf){ try{ (window.cancelAnimationFrame||function(){})(_raf); }catch(e){} _raf = 0; } }

  function tick(){
    _raf = 0;
    if (!_running) return;
    var r = _running, tNow = now();
    if (!_paused){
      var d = tNow - r.last;
      // clamp a stutter (tab refocus) so we don't leap
      if (d > 250) d = 250;
      r.elapsed += d * _speed;
    }
    r.last = tNow;
    var dur = r.durBase;
    var k = dur > 0 ? Math.min(1, r.elapsed / dur) : 1;

    if (r.mode === 'day'){
      // sweep minutes-of-day across a sunrise→sunset-ish band (04:30 → 19:30),
      // wide enough to show the shadow enter and leave the yard at both ends.
      var e = easeInOutQuad(k);
      var startMin = 4*60 + 30, endMin = 19*60 + 30;
      var min = startMin + (endMin - startMin) * e;
      var ymd = localYMD(refDate());   // keep whatever calendar day we're on
      park(localDateMs(ymd.Y, ymd.Mo, ymd.D, min));
    }
    else if (r.mode === 'year'){
      var ey = easeInOutQuad(k);
      var dn = daysInYear(r.year);
      var doy = (dn - 1) * ey;
      var md = ymdFromDoy(r.year, doy);
      // keep solar NOON so the arc-height change reads cleanly across the year
      park(localDateMs(r.year, md.Mo, md.D, 12*60));
      maybeSetSeason(seasonOfMonth(md.Mo));
    }
    else if (r.mode === 'myyear'){
      // step through the ACTUAL recorded days (already sorted). Linear in time
      // across the list; each day shown at solar noon so shadows differ per day.
      var n = r.days.length;
      if (!n){ finish(); return; }
      var idx = Math.min(n - 1, Math.floor(k * n));
      r.idx = idx;
      var rec = r.days[idx];                // ISO 'YYYY-MM-DD'
      var p = rec.split('-').map(Number);
      park(localDateMs(p[0], p[1], p[2], 12*60));
      maybeSetSeason(seasonOfMonth(p[1]));
      updateMyYearLabel(rec, idx, n);
    }

    syncReadout(k);
    if (k >= 1){ finish(); return; }
    _raf = (window.requestAnimationFrame || function(cb){ return setTimeout(function(){ cb(now()); }, 16); })(tick);
  }

  function startMode(mode, opts){
    stopRaf(/*restoreLive=*/false);        // cancel any in-flight play, keep scrub
    opts = opts || {};
    _paused = false;
    var r = { mode: mode, elapsed: 0, last: now() };
    if (mode === 'day'){ r.durBase = 8000; }
    else if (mode === 'year'){ r.durBase = 20000; r.year = refYear(); }
    else if (mode === 'myyear'){
      r.days = opts.days || [];
      r.real = !!opts.real;
      // ~18 s across the whole recorded span, min ~60 ms/day so single days are visible
      r.durBase = Math.max(4000, Math.min(22000, r.days.length * 90));
      r.idx = 0;
    }
    _running = r;
    _lastSetSeason = null;
    park(refDate().getTime());             // ensure we're in scrub mode before the first tick
    paint();
    _raf = (window.requestAnimationFrame || function(cb){ return setTimeout(function(){ cb(now()); }, 16); })(tick);
  }

  function stopRaf(restoreLive){
    cancelRaf();
    _running = null; _paused = false;
    if (restoreLive){
      if (typeof window.__live === 'function') window.__live();
      else { if (D.dataset){ D.dataset.tmode = 'live'; D.dataset.tplay = '0'; } }
    }
    paint();
  }

  function finish(){
    // play completed: leave the world on the LAST frame's scrub for a beat is
    // jarring (it'd be stuck in the past) → restore the live present, honestly.
    stopRaf(/*restoreLive=*/true);
  }

  function pauseResume(){
    if (!_running) return;
    _paused = !_paused;
    if (!_paused) _running.last = now();   // don't count paused time
    paint();
  }

  /* =========================================================================
   * "השנה שלי" — read the ACTUAL recorded days from RecordStore if present.
   * Defensive: RecordStore is built by a parallel agent and may be absent or
   * still backfilling; we never throw, and we label the result honestly.
   * ====================================================================== */
  function gatherMyYear(){
    var RS = window.RecordStore;
    // no store yet → honest model fallback
    if (!RS || typeof RS.status !== 'function' || typeof RS.dayRecord !== 'function'){
      return { days: [], real: false, reason: 'no-store' };
    }
    var st = null;
    try { st = RS.status(); } catch (e) { st = null; }
    if (!st || !st.firstDate || !st.lastDate || !(st.days > 0)){
      return { days: [], real: false, reason: 'no-data' };
    }
    // enumerate the calendar days [firstDate, lastDate] that the store actually
    // has a record for. Cheap: we ask dayRecord per day (it reads localStorage).
    var days = [];
    var a = isoToUTC(st.firstDate), b = isoToUTC(st.lastDate);
    if (a == null || b == null) return { days: [], real: false, reason: 'bad-dates' };
    // cap the walk so a corrupt store can't spin forever
    var guard = 0;
    for (var t = a; t <= b && guard < 800; t += DAYMS, guard++){
      var iso = utcToIso(t);
      var rec = null;
      try { rec = RS.dayRecord(iso); } catch (e) { rec = null; }
      if (rec) days.push(iso);
    }
    if (!days.length) return { days: [], real: false, reason: 'empty' };
    return { days: days, real: true, reason: 'ok', st: st };
  }
  function isoToUTC(iso){ var p = String(iso).split('-').map(Number); if (p.length<3 || !p[0]) return null; return Date.UTC(p[0], p[1]-1, p[2]); }
  function utcToIso(t){ var d = new Date(t); var mo = String(d.getUTCMonth()+1).padStart(2,'0'), da = String(d.getUTCDate()).padStart(2,'0'); return d.getUTCFullYear()+'-'+mo+'-'+da; }

  function playMyYear(){
    var got = gatherMyYear();
    if (got.real && got.days.length){
      setNote('▶ מריץ אֶת הַשָּׁנָה שֶׁלְּךָ — ' + got.days.length + ' יָמִים שֶׁנִּמְדְּדוּ בֶּאֱמֶת.', 'real');
      startMode('myyear', { days: got.days, real: true });
    } else {
      // honest fallback: no recorded days yet → run the MODEL year, say so plainly
      var why = got.reason === 'no-store' ? 'הַיּוֹמָן עֲדַיִן נִטְעָן' :
                got.reason === 'no-data'  ? 'הַיּוֹמָן עֲדַיִן רֵיק (נֶאֱסָף בָּרֶקַע)' :
                                            'אֵין עֲדַיִן יָמִים שֶׁנִּשְׁמְרוּ';
      setNote('עֲדַיִן אֵין מְדִידוֹת אֲמִתִּיּוֹת (' + why + ') — מַרִיץ אֶת מוֹדֵל הַשָּׁנָה בִּמְקוֹם זֶה.', 'model');
      startMode('year');
    }
  }

  /* =========================================================================
   * UI — a small floating control, gold-on-dark glass, RTL, anchored bottom-
   * left so it doesn't fight the top-right #inst instrument or the bottom-
   * centre time bar. Self-contained DOM + CSS.
   * ====================================================================== */
  var panel = null, noteEl = null, barEl = null, ppBtn = null, _myYearLabel = null;

  function ensureCSS(){
    if (document.getElementById('tm-css')) return;
    var s = document.createElement('style');
    s.id = 'tm-css';
    s.textContent =
      '#tmPanel{position:absolute;left:18px;bottom:78px;width:212px;z-index:11;display:flex;flex-direction:column;gap:7px;' +
        'font-family:Heebo,sans-serif;color:#efe6cf;direction:rtl;' +
        'padding:12px 13px 11px;border-radius:12px;' +
        'background:linear-gradient(160deg,rgba(12,14,26,.93),rgba(6,7,15,.95));' +
        'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
        'border:1px solid rgba(202,161,90,.22);box-shadow:0 18px 48px rgba(0,0,0,.55);' +
        'text-shadow:0 1px 5px rgba(0,0,0,.7)}' +
      '#tmPanel .tmtitle{font-family:Bellefair,serif;letter-spacing:.05em;font-size:13px;color:' + GOLD + ';' +
        'display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:1px}' +
      '#tmPanel .tmtitle .tme{font-size:14px}' +
      '#tmPanel .tmrow{display:flex;gap:6px}' +
      '#tmPanel .tmbtn{flex:1;text-align:center;cursor:pointer;user-select:none;font-family:Heebo;font-size:12px;' +
        'padding:7px 6px;border-radius:8px;color:#e7d9b4;background:rgba(255,255,255,.04);' +
        'border:1px solid rgba(202,161,90,.3);transition:.14s;line-height:1.2}' +
      '#tmPanel .tmbtn:hover{background:rgba(202,161,90,.16);border-color:rgba(202,161,90,.55);color:#fff7e6}' +
      '#tmPanel .tmbtn.wide{width:100%}' +
      '#tmPanel .tmbtn.my{color:#cfe0d2;border-color:rgba(127,184,138,.42);background:rgba(127,184,138,.1)}' +
      '#tmPanel .tmbtn.my:hover{background:rgba(127,184,138,.2)}' +
      '#tmPanel .tmctl{display:flex;align-items:center;gap:6px}' +
      '#tmPanel .tmpp{flex:0 0 auto;min-width:62px;text-align:center;cursor:pointer;user-select:none;font-size:12px;' +
        'padding:6px 8px;border-radius:8px;color:#e7d9b4;background:rgba(255,255,255,.04);' +
        'border:1px solid rgba(202,161,90,.3);transition:.14s}' +
      '#tmPanel .tmpp:hover{background:rgba(202,161,90,.16);color:#fff7e6}' +
      '#tmPanel .tmpp.live{color:#a99b78}' +
      '#tmPanel .tmspeed{flex:1;display:flex;gap:3px;justify-content:flex-end}' +
      '#tmPanel .tmsp{cursor:pointer;user-select:none;font-size:10.5px;font-family:Heebo;padding:4px 7px;border-radius:7px;' +
        'color:#a99b78;background:rgba(255,255,255,.03);border:1px solid rgba(202,161,90,.18);transition:.12s}' +
      '#tmPanel .tmsp:hover{color:#e7d9b4}' +
      '#tmPanel .tmsp.on{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;border-color:transparent;font-weight:600;text-shadow:none}' +
      '#tmPanel .tmbar{height:5px;border-radius:20px;background:rgba(255,255,255,.07);overflow:hidden;margin-top:1px}' +
      '#tmPanel .tmbar i{display:block;height:100%;width:0;border-radius:20px;' +
        'background:linear-gradient(90deg,#293866,#caa15a,#fff7cc);transition:width .08s linear}' +
      '#tmPanel .tmnote{font-size:10px;line-height:1.5;color:#a99b78;min-height:14px}' +
      '#tmPanel .tmnote.real{color:#9ccfa6}' +
      '#tmPanel .tmnote.model{color:#e2c98a}' +
      '#tmPanel .tmfoot{font-size:9px;color:#7d7150;line-height:1.45;border-top:1px solid rgba(202,161,90,.13);padding-top:6px;margin-top:1px}' +
      '@media(max-width:960px){#tmPanel{left:10px;bottom:96px;width:188px}}';
    document.head.appendChild(s);
  }

  function el(tag, cls, html){ var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function ensurePanel(){
    if (panel) return;
    ensureCSS();
    panel = el('div'); panel.id = 'tmPanel'; panel.setAttribute('dir', 'rtl');
    panel.appendChild(el('div', 'tmtitle', '<span><span class="tme">⏳</span> מְכוֹנַת זְמַן</span>'));

    var row1 = el('div', 'tmrow');
    var bDay  = el('div', 'tmbtn', '▶ יוֹם');   bDay.dataset.act  = 'day';
    var bYear = el('div', 'tmbtn', '▶ שָׁנָה');  bYear.dataset.act = 'year';
    row1.appendChild(bDay); row1.appendChild(bYear);
    panel.appendChild(row1);

    var bMy = el('div', 'tmbtn wide my', '▶ הַשָּׁנָה שֶׁלִּי');  bMy.dataset.act = 'myyear';
    panel.appendChild(bMy);

    var ctl = el('div', 'tmctl');
    ppBtn = el('div', 'tmpp live', 'חַי'); ppBtn.dataset.act = 'pp';
    var speed = el('div', 'tmspeed');
    [['0.5','½'],['1','×1'],['2','×2'],['4','×4']].forEach(function(sp){
      var b = el('div', 'tmsp' + (sp[0] === '1' ? ' on' : ''), sp[1]);
      b.dataset.act = 'speed'; b.dataset.speed = sp[0];
      speed.appendChild(b);
    });
    ctl.appendChild(ppBtn); ctl.appendChild(speed);
    panel.appendChild(ctl);

    barEl = el('div', 'tmbar', '<i></i>');
    panel.appendChild(barEl);

    noteEl = el('div', 'tmnote', '');
    panel.appendChild(noteEl);

    panel.appendChild(el('div', 'tmfoot',
      'הַשֶּׁמֶשׁ, הַצְּלָלִים וְאֹרֶךְ הַיּוֹם נָעִים בֶּאֱמֶת. הַצְּמָחִים אֵינָם גְּדֵלִים בָּתְּלַת־מֵמַד.'));

    panel.addEventListener('click', onClick);
    document.body.appendChild(panel);
  }

  function onClick(e){
    var t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t) return;
    var act = t.dataset.act;
    if (act === 'day')      { setNote('▶ יוֹם — הַצֵּל מְטַאֲטֵא אֶת הֶחָצֵר מִזְּרִיחָה לִשְׁקִיעָה.', ''); startMode('day'); }
    else if (act === 'year'){ setNote('▶ שָׁנָה — קֶשֶׁת הַשֶּׁמֶשׁ עוֹלָה וְיוֹרֶדֶת; הַיָּמִים מִתְאָרְכִים.', ''); startMode('year'); }
    else if (act === 'myyear'){ playMyYear(); }
    else if (act === 'pp'){
      if (_running) pauseResume();
      else stopRaf(/*restoreLive=*/true);   // not playing → "חי": ensure live
    }
    else if (act === 'speed'){
      _speed = parseFloat(t.dataset.speed) || 1;
      paintSpeed();
    }
  }

  /* ---- paint / readout ---- */
  function setNote(txt, cls){ if (!noteEl) return; noteEl.className = 'tmnote' + (cls ? ' ' + cls : ''); noteEl.textContent = txt || ''; }
  function updateMyYearLabel(iso, idx, n){ _myYearLabel = iso; }

  function syncReadout(k){
    if (barEl){ var i = barEl.firstChild; if (i) i.style.width = Math.round((k || 0) * 100) + '%'; }
    if (_running && _running.mode === 'myyear' && _myYearLabel){
      setNote('▶ הַשָּׁנָה שֶׁלִּי · ' + _myYearLabel + ' · יוֹם ' + ((_running.idx|0)+1) + '/' + _running.days.length +
              ' (מְדִידוֹת אֲמֶת)', 'real');
    }
  }
  function paintSpeed(){
    if (!panel) return;
    panel.querySelectorAll('.tmsp').forEach(function(b){
      b.classList.toggle('on', (parseFloat(b.dataset.speed) || 1) === _speed);
    });
  }
  function paint(){
    if (!ppBtn) return;
    if (_running){
      ppBtn.textContent = _paused ? '▶ הַמְשֵׁךְ' : '⏸ הַשְׁהֵה';
      ppBtn.classList.remove('live');
    } else {
      ppBtn.textContent = 'חַי';
      ppBtn.classList.add('live');
      if (barEl){ var i = barEl.firstChild; if (i) i.style.width = '0%'; }
    }
    paintSpeed();
  }

  /* ---- mount (auto, defensive — DOM may not be ready at script eval) ---- */
  function mount(){
    if (!document.body){
      // body not parsed yet → defer once
      if (document.addEventListener) document.addEventListener('DOMContentLoaded', ensurePanel, { once: true });
      return;
    }
    ensurePanel();
  }

  /* ---- public API ---- */
  window.__timeMachine = {
    mount: mount,
    playDay:    function(){ startMode('day'); },
    playYear:   function(){ startMode('year'); },
    playMyYear: playMyYear,
    pause:  function(){ if (_running && !_paused) pauseResume(); },
    resume: function(){ if (_running && _paused) pauseResume(); },
    stop:   function(){ stopRaf(true); },          // stop + restore live present
    live:   function(){ stopRaf(true); },
    setSpeed: function(s){ _speed = (typeof s === 'number' && s > 0) ? s : 1; paintSpeed(); },
    isPlaying: function(){ return !!_running && !_paused; },
    mode:    function(){ return _running ? _running.mode : null; },
    // for tests/inspection: did we have real recorded days available?
    _hasRealYear: function(){ var g = gatherMyYear(); return g.real && g.days.length > 0; }
  };

  // self-mount when the document is interactive enough.
  if (document.body) ensurePanel();
  else mount();
})();
