/* ===================================================================
   sky_extras.js — surfaces the harvested ASTRONOMY catalogs (bundled
   under data/sky/ + data/astro_events.json) that were sitting unshown.
   A set of cards in the existing #inst dark/gold RTL Hebrew skin, mounted
   into a host in the sky tab by the orchestrator (panels.js).

   PUBLIC API (the human wires this in):
     window.__skyExtras.render(host, date)
       host : an element to render INTO (its CSS is scoped to #sky-extras,
              so wrap content in a #sky-extras container — we do that for you).
       date : a Date for the live computations (alt/az "up now", which month,
              which events are still upcoming). Defaults to new Date().
     window.__skyExtras.isReady()   → true once all catalogs have loaded.
     window.__skyExtras.onReady(fn) → fn() when ready (and re-render).

   CARDS:
     🌟 Brightest now  — brightest naked-eye stars currently ABOVE the
        horizon for Alex's coords, via Astro.eqToHorizon(ra,dec,date). If that
        transform is absent we DEGRADE: list the brightest catalog stars with
        no live "up now" filter and SAY SO (honest).
     🪐 Objects up this month — Messier/Caldwell whose best_month_from_34N
        matches the current month (name_he, type_he, mag, visibility tier).
     ☄️ Comets — upcoming comets (perihelion ≥ date), brightest first.
     🌠 Meteor showers — the annual meteor-shower calendar (peak, ZHR).
     📅 Sky events calendar — the next ~8 events from astro_events.json.

   HONESTY: positions & magnitudes are MEASURED catalog values; best_month and
   the naked-eye/binoc/scope tier are MODELED/derived and labelled as such. No
   fabrication — every number traces to a bundled catalog or the Astro engine.

   SELF-CONTAINED: owns its own fetch + cache + CSS (scoped #sky-extras). Reads
   only window.Astro (for the horizon transform) — never edits panels.js,
   index.html, sky.js, or any other module.
   =================================================================== */
(function(){
  if (window.__skyExtras) return;

  var GOLD = '#caa15a';
  var esc = function(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };

  /* ---- catalog store (lazy fetch, one shot each) ---------------------------- */
  var DATA = { stars:null, messier:null, caldwell:null, comets:null,
               showers:null, events:null };
  var SRC = {
    stars:    'data/sky/bright_stars.json',
    messier:  'data/sky/messier.json',
    caldwell: 'data/sky/caldwell.json',
    comets:   'data/sky/comets.json',
    showers:  'data/sky/meteor_showers.json',
    events:   'data/astro_events.json'
  };
  var _loading = false, _readyCbs = [], _lastHost = null, _lastDate = null;

  function allLoaded(){
    return DATA.stars && DATA.messier && DATA.caldwell &&
           DATA.comets && DATA.showers && DATA.events;
  }
  // pull the array out of each file's known shape (top-level arrays differ per file).
  function arr(j, key){
    if (!j) return [];
    if (Array.isArray(j)) return j;
    if (key && Array.isArray(j[key])) return j[key];
    var v = Object.keys(j).map(function(k){ return j[k]; }).filter(Array.isArray);
    return v.length ? v[0] : [];
  }
  function load(){
    if (_loading || allLoaded()) return;
    _loading = true;
    var keyFor = { stars:'stars', messier:'objects', caldwell:'objects',
                   comets:'comets', showers:'showers', events:'events' };
    var names = Object.keys(SRC), pending = names.length;
    names.forEach(function(name){
      fetch(SRC[name]).then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){ DATA[name] = arr(j, keyFor[name]); })
        .catch(function(){ DATA[name] = []; })   // network/parse fail → empty (card says "—")
        .then(function(){
          if (--pending === 0){
            _loading = false;
            var cbs = _readyCbs.slice(); _readyCbs = [];
            cbs.forEach(function(fn){ try{ fn(); }catch(e){} });
            // auto re-render the last host once data arrives (mount-before-load safe)
            if (_lastHost) try{ render(_lastHost, _lastDate); }catch(e){}
          }
        });
    });
  }

  /* ---- small helpers -------------------------------------------------------- */
  // compass direction label (mirrors panels.js dirHe — kept local/self-contained)
  function dirHe(az){
    var d=['N','NE','E','SE','S','SW','W','NW'];
    return d[Math.round((((az%360)+360)%360)/45)%8];
  }
  function fmtMag(m){ return (m==null||!isFinite(m)) ? '—' : (m>=0?'+':'')+(Math.round(m*10)/10); }
  // visibility tier from integrated magnitude (deep-sky), for Alex's Bortle-3 sky.
  // DERIVED, not catalogued — labelled "estimated" wherever shown.
  function visTier(mag){
    if (mag==null || !isFinite(mag)) return { he:'—', cls:'' };
    if (mag <= 6.0) return { he:'Naked eye', cls:'green' };       // naked eye
    if (mag <= 9.5) return { he:'Binoculars', cls:'blue' };           // binoculars
    return { he:'Telescope', cls:'amber' };                          // telescope
  }
  var MONTH_HE = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  function ddmm(iso){ var p=String(iso||'').slice(0,10).split('-');
    return (p[2]&&p[1]) ? (p[2]+'/'+p[1]) : (iso||'—'); }
  function iso(d){ return d.getUTCFullYear()+'-'+
    String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0'); }

  /* ====================== CARD BUILDERS (return HTML) ====================== */

  // 🌟 brightest stars currently ABOVE the horizon (live), or graceful fallback.
  function starsCard(date){
    var stars = DATA.stars || [];
    if (!stars.length) return card('🌟','Brightest now','',
      '<div class="sx-tag">Star catalog loading…</div>');
    var hasTransform = !!(window.Astro && typeof window.Astro.eqToHorizon === 'function');
    var rows = '', subPill, note;
    if (hasTransform){
      var up = stars.map(function(s){
          var h = window.Astro.eqToHorizon(s.ra, s.dec, date);
          return { s:s, alt:h.altDeg, az:h.azDeg };
        })
        .filter(function(o){ return o.alt > 5; })                 // comfortably above the rim
        .sort(function(a,b){ return (a.s.mag||9) - (b.s.mag||9); })  // brightest first
        .slice(0, 12);
      if (!up.length){
        return card('🌟','Brightest now','<span class="sx-pill green">Live</span>',
          '<div class="sx-tag">No bright stars above the horizon right now (perhaps darkness hasn\'t fallen yet, or they\'re below the ridge).</div>');
      }
      subPill = '<span class="sx-pill green">Live · now</span>';
      rows = up.map(function(o){
        return '<div class="sx-clk" data-az="'+o.az.toFixed(2)+'" data-alt="'+o.alt.toFixed(2)+'">'+
          '<span class="sx-nm">'+esc(o.s.name)+'</span>'+
          '<span class="sx-rt">'+esc(o.s.constellation_he||o.s.constellation||'')+' · '+
            Math.round(o.alt)+'° · '+dirHe(o.az)+' · '+fmtMag(o.s.mag)+'</span></div>';
      }).join('');
      note = 'Altitude and azimuth are computed in real time for your coordinates (lat 34.0, lon -40.0) using local sidereal time. Clicking focuses the view.';
    } else {
      // DEGRADED: no horizon transform → show the brightest catalog stars, say so.
      var top = stars.slice().sort(function(a,b){ return (a.mag||9)-(b.mag||9); }).slice(0,12);
      subPill = '<span class="sx-pill amber">Catalog</span>';
      rows = top.map(function(s){
        return '<div class="sx-row">'+
          '<span class="sx-nm">'+esc(s.name)+'</span>'+
          '<span class="sx-rt">'+esc(s.constellation_he||s.constellation||'')+' · '+fmtMag(s.mag)+'</span></div>';
      }).join('');
      note = 'The horizon engine (Astro.eqToHorizon) is not available right now — showing the brightest stars in the catalog without the "above the horizon now" filter.';
    }
    return card('🌟','Brightest now', subPill,
      rows + '<div class="sx-note">'+note+'</div>');
  }

  // 🪐 deep-sky (Messier + Caldwell) whose best_month matches the current month.
  function deepSkyCard(date){
    var m = date.getMonth()+1;     // 1..12
    var pool = (DATA.messier||[]).concat(DATA.caldwell||[]);
    if (!pool.length) return card('🪐','Objects up this month','',
      '<div class="sx-tag">Object catalog loading…</div>');
    var hits = pool.filter(function(o){ return o.best_month_from_34N === m; })
      .sort(function(a,b){ return (a.mag==null?99:a.mag) - (b.mag==null?99:b.mag); });
    var sub = '<span class="sx-pill amber">'+esc(MONTH_HE[m-1])+'</span>';
    if (!hits.length){
      return card('🪐','Objects up this month', sub,
        '<div class="sx-tag">No objects peaking this month in the catalog.</div>');
    }
    var rows = hits.slice(0, 14).map(function(o){
      var label = o.name_he || o.name || (o.id+(o.ngc?(' · '+o.ngc):''));
      var v = visTier(o.mag);
      return '<div class="sx-it">'+
        '<span class="sx-nm">'+esc(o.id)+' · '+esc(label)+'</span>'+
        '<span class="sx-rt">'+esc(o.type_he||o.type||'')+' · '+fmtMag(o.mag)+
          ' <span class="sx-pill '+v.cls+'">'+v.he+'</span></span></div>';
    }).join('');
    var more = hits.length>14 ? '<div class="sx-tag">…and '+(hits.length-14)+' more in the catalog.</div>' : '';
    return card('🪐','Objects up this month', sub,
      rows + more +
      '<div class="sx-note">Position and brightness — measured catalog values. The "peak month" is modeled from the RA (culmination around midnight above 34°N); the viewing tier (naked eye/binoculars/telescope) is estimated from the brightness for Bortle-3 skies.</div>');
  }

  // ☄️ upcoming comets (perihelion on/after `date`), brightest first.
  function cometsCard(date){
    var comets = DATA.comets || [];
    if (!comets.length) return card('☄️','Comets','',
      '<div class="sx-tag">Comet catalog loading…</div>');
    var todayIso = iso(date);
    var up = comets
      .filter(function(c){ return (c.perihelion_date||'') >= todayIso; })
      .sort(function(a,b){
        var am=(a.est_peak_mag==null?99:a.est_peak_mag), bm=(b.est_peak_mag==null?99:b.est_peak_mag);
        if (am!==bm) return am-bm;                                  // brighter (smaller mag) first
        return (a.perihelion_date||'') < (b.perihelion_date||'') ? -1 : 1;
      });
    if (!up.length) return card('☄️','Comets','',
      '<div class="sx-tag">No comets with a future perihelion in the catalog.</div>');
    var rows = up.slice(0, 10).map(function(c){
      var vis = c.visibility_he || '';
      var pill = vis ? ('<span class="sx-pill '+(/naked eye/i.test(vis)?'green':/binocular/i.test(vis)?'blue':'amber')+'">'+esc(vis)+'</span>') : '';
      var magTxt = (c.est_peak_mag==null) ? 'Peak brightness unknown' : ('Peak ~'+fmtMag(c.est_peak_mag));
      return '<div class="sx-it">'+
        '<span class="sx-nm">'+esc(c.name||c.designation)+'</span>'+
        '<span class="sx-rt">'+ddmm(c.perihelion_date)+' · '+magTxt+' '+pill+'</span></div>';
    }).join('');
    return card('☄️','Comets', '<span class="sx-pill blue">Future perihelion</span>',
      rows +
      '<div class="sx-note">The perihelion date and orbit — real ephemeris. The peak brightness is an <b>estimate</b> (comets are unpredictable) — most entries are too faint to see with the naked eye. A brightness below 6 ≈ visible to the naked eye.</div>');
  }

  // 🌠 annual meteor-shower calendar.
  function showersCard(date){
    var sh = DATA.showers || [];
    if (!sh.length) return card('🌠','Meteor showers','',
      '<div class="sx-tag">Meteor shower calendar loading…</div>');
    var nowM = date.getMonth()+1, nowD = date.getDate();
    function key(o){ return (o.peak_month||13)*100 + (o.peak_day||0); }
    var nowKey = nowM*100 + nowD;
    // order from "next peak after today" wrapping round the year (a true upcoming calendar)
    var ordered = sh.slice().sort(function(a,b){
      var ka=key(a), kb=key(b);
      var ra = ka>=nowKey ? ka : ka+1300;     // wrap past peaks to next year's slot
      var rb = kb>=nowKey ? kb : kb+1300;
      return ra-rb;
    });
    var rows = ordered.map(function(o){
      var peak = o.peak_day && o.peak_month ? (o.peak_day+'/'+o.peak_month) : '—';
      var soon = (o.peak_month===nowM && Math.abs((o.peak_day||0)-nowD)<=3);
      var moon = o.moonless_best ? '<span class="sx-pill green">Moonless</span>' : '';
      return '<div class="sx-it">'+
        '<span class="sx-nm">'+esc(o.name_he||o.name)+(soon?' <span class="sx-pill amber">Soon</span>':'')+'</span>'+
        '<span class="sx-rt">Peak '+peak+' · ZHR ~'+ (o.zhr!=null?o.zhr:'—') +' '+moon+'</span></div>';
    }).join('');
    return card('🌠','Meteor showers', '<span class="sx-pill amber">Annual calendar</span>',
      rows +
      '<div class="sx-note">The peak dates and ZHR (meteors per hour under ideal conditions) — catalog values. Ordered from the next upcoming peak. The actual count depends on the Moon and on the radiant\'s altitude above Larkmont.</div>');
  }

  // 📅 the next ~8 sky events from astro_events.json.
  function eventsCard(date){
    var ev = DATA.events || [];
    if (!ev.length) return card('📅','Sky events calendar','',
      '<div class="sx-tag">Events calendar loading…</div>');
    var todayIso = iso(date);
    var next = ev.filter(function(e){ return (e.date||'') >= todayIso; })
      .sort(function(a,b){ return (a.date||'') < (b.date||'') ? -1 : 1; })
      .slice(0, 8);
    if (!next.length) return card('📅','Sky events calendar','',
      '<div class="sx-tag">No upcoming events in the calendar.</div>');
    var rows = next.map(function(e){
      var seen = e.visible_from_larkmont;
      var pill = seen ? '<span class="sx-pill green">Visible from Larkmont</span>'
                      : '<span class="sx-pill amber">Not visible from here</span>';
      var when = e.best_time && e.best_time!=='—' ? ('<div class="sx-sub2">'+esc(e.best_time)+'</div>') : '';
      return '<div class="sx-ev">'+
        '<div class="sx-evhd"><span class="sx-date">'+ddmm(e.date)+'</span>'+
          '<span class="sx-nm">'+esc(e.title_he||'')+'</span>'+pill+'</div>'+
        when + '</div>';
    }).join('');
    return card('📅','Sky events calendar', '<span class="sx-pill blue">Upcoming</span>',
      rows +
      '<div class="sx-note">The 8 upcoming events from a curated calendar (2026–2030). The "visible / not visible from here" marking is taken from the calendar itself.</div>');
  }

  /* ---- card shell (the #inst brass-on-glass language) ----------------------- */
  function card(emoji, title, subPill, inner){
    return '<div class="sx-card">'+
      '<div class="sx-ct"><span class="sx-e">'+emoji+'</span>'+esc(title)+
        (subPill?(' '+subPill):'')+'</div>'+
      inner + '</div>';
  }

  /* ====================== mount + render ====================== */
  function render(host, date){
    if (!host) return;
    ensureCSS();
    _lastHost = host; _lastDate = date || null;
    var d = date instanceof Date ? date : new Date();

    if (!allLoaded()){
      load();
      // show a light placeholder; auto re-renders when the fetch resolves.
      host.innerHTML = '<div id="sky-extras" dir="ltr">'+
        '<div class="sx-card"><div class="sx-ct"><span class="sx-e">🔭</span>Sky catalogs</div>'+
        '<div class="sx-tag">Loading stars, deep-sky objects, comets, showers and events…</div></div></div>';
      return;
    }

    var body =
      starsCard(d) +
      deepSkyCard(d) +
      cometsCard(d) +
      showersCard(d) +
      eventsCard(d) +
      '<div class="sx-foot">Curated catalogs: naked-eye stars (~5,070), Messier (110), Caldwell (109), comets, meteor showers, and an events calendar. Position and brightness — measured; "month" / "now" / viewing tier — computed or modeled, and marked as such.</div>';

    host.innerHTML = '<div id="sky-extras" dir="ltr">'+body+'</div>';

    // delegated click on a live star row → focus the 3D camera (same idiom as panels.js)
    if (!host.__sxWired){
      host.__sxWired = true;
      host.addEventListener('click', function(e){
        var t = e.target.closest && e.target.closest('.sx-clk');
        if (!t) return;
        var az = parseFloat(t.getAttribute('data-az')), alt = parseFloat(t.getAttribute('data-alt'));
        if (isFinite(az) && isFinite(alt) && window.__lookAtSky) window.__lookAtSky(az, alt);
      });
    }
  }

  /* ---- skin (scoped to #sky-extras — mirrors zone_card.js / nature.js) ------- */
  function ensureCSS(){
    if (document.getElementById('sky-extras-css')) return;
    var s = document.createElement('style');
    s.id = 'sky-extras-css';
    s.textContent =
      '#sky-extras{direction:ltr;font-family:Heebo,sans-serif;color:#efe6cf}' +
      '#sky-extras .sx-card{background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.15);' +
        'border-radius:8px;padding:11px 13px;margin-top:12px}' +
      '#sky-extras .sx-card:first-child{margin-top:6px}' +
      '#sky-extras .sx-ct{font-family:Bellefair,serif;letter-spacing:.04em;font-size:14px;color:'+GOLD+';' +
        'margin-bottom:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}' +
      '#sky-extras .sx-ct .sx-e{font-size:16px}' +
      '#sky-extras .sx-row,#sky-extras .sx-it,#sky-extras .sx-clk{display:flex;justify-content:space-between;' +
        'align-items:center;gap:10px;font-size:12.5px;color:#d6ccb2;padding:6px 0;' +
        'border-top:1px solid rgba(202,161,90,.1)}' +
      '#sky-extras .sx-row:first-of-type,#sky-extras .sx-it:first-of-type,#sky-extras .sx-clk:first-of-type{border-top:none}' +
      '#sky-extras .sx-clk{cursor:pointer;transition:color .12s,background .12s;border-radius:6px;padding-inline:4px}' +
      '#sky-extras .sx-clk:hover{color:#fff7e6;background:rgba(202,161,90,.08)}' +
      '#sky-extras .sx-nm{color:#fff7e6;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#sky-extras .sx-rt{color:#a99b78;font-size:11.5px;flex:0 0 auto;text-align:start;white-space:nowrap}' +
      '#sky-extras .sx-ev{padding:7px 0;border-top:1px solid rgba(202,161,90,.1)}' +
      '#sky-extras .sx-ev:first-of-type{border-top:none}' +
      '#sky-extras .sx-evhd{display:flex;align-items:center;gap:7px;flex-wrap:wrap}' +
      '#sky-extras .sx-date{font-family:Bellefair,serif;color:'+GOLD+';font-size:12px;flex:0 0 auto}' +
      '#sky-extras .sx-sub2{color:#a99b78;font-size:11px;margin-top:2px;line-height:1.4}' +
      '#sky-extras .sx-pill{font-size:9.5px;padding:1px 8px;border-radius:20px;white-space:nowrap;flex:0 0 auto}' +
      '#sky-extras .sx-pill.green{background:rgba(120,200,120,.16);color:#a7e0a7;border:1px solid rgba(120,200,120,.4)}' +
      '#sky-extras .sx-pill.blue{background:rgba(120,150,210,.16);color:#bcd0f0;border:1px solid rgba(120,150,210,.4)}' +
      '#sky-extras .sx-pill.amber{background:rgba(224,178,74,.18);color:#e8c474;border:1px solid rgba(224,178,74,.4)}' +
      '#sky-extras .sx-tag{font-size:11px;color:#a99b78;line-height:1.5}' +
      '#sky-extras .sx-note{font-size:10.5px;color:#a99b78;line-height:1.55;margin-top:8px;' +
        'border-inline-start:2px solid rgba(202,161,90,.3);padding-inline-start:8px}' +
      '#sky-extras .sx-foot{font-size:9.5px;color:#7d7150;margin-top:13px;line-height:1.55}';
    document.head.appendChild(s);
  }

  /* ---- public API ----------------------------------------------------------- */
  function isReady(){ return !!allLoaded(); }
  function onReady(fn){ if (typeof fn!=='function') return;
    if (allLoaded()) fn(); else { _readyCbs.push(fn); load(); } }

  window.__skyExtras = {
    render: render,
    isReady: isReady,
    onReady: onReady,
    _data: function(){ return DATA; }     // for tests / debugging
  };

  // kick off the fetch eagerly so data is usually ready by the time the tab opens.
  if (typeof fetch === 'function') load();
})();
