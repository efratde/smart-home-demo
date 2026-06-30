/* ===========================================================================
 * nature.js · "הבית של אלכס" — מדריך הטבע (field guide)
 * ---------------------------------------------------------------------------
 * The טבע tab, rebuilt as a CURATED, OFFLINE, seasonal field guide for the
 * Larkmont valley / highlands area (data/nature_species.json,
 * 58 verified species). Replaces the old live-iNaturalist feed, which for
 * this sparse highland area returned ~0–2 sightings.
 *
 * Layout (chosen with the user): "בסביבה עכשיו" for the current month FIRST,
 * then collapsible browse-by-category. A row's → opens the full species CARD as
 * a SELF-CONTAINED FLOATING OVERLAY (#natureCard), mirroring garden.js's
 * #gardenCard: a position-fixed brass-on-glass panel that temporarily hides the
 * #inst instrument while it's open. No external side panel / callback anymore —
 * renderGuideInto(host) fully self-wires.
 *
 * Media (Hybrid): 4 iconic species carry a bundled, free-license photo
 * (assets/nature/*.jpg, with credit); 14 birds carry a BUNDLED, free-license
 * (CC0/CC BY/CC BY-NC, iNaturalist) call recording — a 🔊 הקריאה PLAY button
 * (data-nat-play-call) that plays assets/nature/sounds/<id>.mp3 OFFLINE via
 * window.__amb (sounds.js); a species without a bundled clip keeps its external
 * sound link as a fallback. Every species has a "מידע נוסף" link. Self-contained
 * DOM layer — never touches the WebGL scene. Exposes isReady()/onReady() so
 * panels.js can mount promptly.
 * ======================================================================== */
(function () {
  'use strict';
  if (window.Nature) return;

  var GOLD = '#caa15a';
  var DATA = null, READY = false, _readyCbs = [];
  var _host = null, _wiredHost = null, _query = '', _expanded = {};

  var MONTHS_HE = ['יָנוּאָר','פֶבְּרוּאָר','מֵרְץ','אַפְּרִיל','מַאי','יוּנִי','יוּלִי','אוֹגוּסְט','סֶפְּטֶמְבֶּר','אוֹקְטוֹבֶּר','נוֹבֶמְבֶּר','דֶצֶמְבֶּר'];
  var MON_SHORT = ['ינ','פב','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'];
  var CATS = [
    { k:'plant',   he:'צְמָחִים',           emoji:'🌿' },
    { k:'bird',    he:'צִפּוֹרִים',         emoji:'🐦' },
    { k:'insect',  he:'חֲרָקִים וּמַאֲבִיקִים', emoji:'🦋' },
    { k:'reptile', he:'זוֹחֲלִים',          emoji:'🦎' },
    { k:'fungi',   he:'פִּטְרִיּוֹת',         emoji:'🍄' },
    { k:'mammal',  he:'יוֹנְקִים',          emoji:'🦌' }
  ];
  var EMOJI = { bird:'🐦', mammal:'🦌', reptile:'🦎', insect:'🦗', plant:'🌿', fungi:'🍄', other:'•' };
  var CAT_HE = {}; CATS.forEach(function (c) { CAT_HE[c.k] = c.he; });

  /* ---- RESIDENCY (birds) — מקומיות vs נודדות --------------------------------
     the developer's note: separate the birds you can always see (resident, year-round)
     from the ones that pass through only seasonally. Each value carries a short
     Hebrew label + a badge tone for the row tag and the detail card. */
  var RESID = {
    resident: { he:'מְקוֹמִית · כָּל הַשָּׁנָה', short:'מְקוֹמִית', cls:'res-local' },
    winter:   { he:'חוֹרֶפֶת · אוֹרַחַת חֹרֶף',  short:'חוֹרֶפֶת', cls:'res-move' },
    summer:   { he:'קַיְצִית · מְקַנֶּנֶת קַיִץ', short:'קַיְצִית', cls:'res-move' },
    passage:  { he:'נוֹדֶדֶת · בִּמְעֻף הַנְּדִידָה', short:'נוֹדֶדֶת', cls:'res-move' },
    migrant:  { he:'נוֹדֶדֶת', short:'נוֹדֶדֶת', cls:'res-move' }
  };
  function isResident(s){ return s.residency === 'resident'; }

  /* ---- LIFEFORM (plants) — חד-שנתיים/עונתיים first --------------------------
     the developer's note: lead with the annuals & geophytes that bloom after the rains,
     not the big year-round perennials. ORDER weights the seasonal bloomers up;
     LF supplies a short Hebrew label + badge tone. */
  var LF = {
    annual:    { he:'חַד-שְׁנָתִי · עוֹנָתִי', short:'חַד-שְׁנָתִי', cls:'lf-annual', ord:0 },
    geophyte:  { he:'גֵּאוֹפִיט · פּוֹרֵחַ עוֹנָתִי', short:'גֵּאוֹפִיט', cls:'lf-annual', ord:1 },
    perennial: { he:'רַב-שְׁנָתִי', short:'רַב-שְׁנָתִי', cls:'lf-peren', ord:2 },
    shrub:     { he:'שִׂיחַ · רַב-שְׁנָתִי', short:'שִׂיחַ', cls:'lf-peren', ord:3 },
    tree:      { he:'עֵץ · רַב-שְׁנָתִי', short:'עֵץ', cls:'lf-peren', ord:4 }
  };
  function lfOrd(s){ var f = LF[s.lifeform]; return f ? f.ord : 9; }
  function isSeasonalPlant(s){ return s.lifeform === 'annual' || s.lifeform === 'geophyte'; }

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function curMonth(){ return new Date().getMonth() + 1; }                 // 1..12
  function inSeasonNow(s){ return Array.isArray(s.months) && s.months.indexOf(curMonth()) !== -1; }
  function byId(id){ return DATA ? DATA.find(function(s){ return s.id===id; }) : null; }

  /* ---- readiness (mirrors garden.js so panels.js can mount the instant data lands) */
  function markReady(){ if (READY) return; READY = true; var cbs = _readyCbs.splice(0); cbs.forEach(function(fn){ try{ fn(); }catch(e){} }); }
  function onReady(fn){ if (typeof fn!=='function') return; if (READY){ try{ fn(); }catch(e){} } else _readyCbs.push(fn); }

  function load(){
    if (DATA) { markReady(); return; }
    fetch('data/nature_species.json').then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ DATA = (j && j.species) ? j.species : []; markReady(); })
      .catch(function(){ DATA = []; markReady(); });
  }

  /* ---- a short season label for a list row -------------------------------- */
  function seasonSpan(s){
    var m = s.months || [];
    if (m.length >= 11) return 'כָּל הַשָּׁנָה';
    if (!m.length) return '';
    var lo = Math.min.apply(null, m), hi = Math.max.apply(null, m);
    return lo === hi ? MON_SHORT[lo-1] : (MON_SHORT[lo-1] + '–' + MON_SHORT[hi-1]);
  }

  function thumb(s){
    if (s.photo && s.photo.local) return '<span class="natthumb"><img src="' + esc(s.photo.local) + '" alt="" loading="lazy"></span>';
    return '<span class="natthumb natemoji">' + (EMOJI[s.cat] || '•') + '</span>';
  }

  /* ---- a small residency/lifeform badge for a row (מקומית / נודדת / חד-שנתי) */
  function kindBadge(s){
    if (s.cat === 'bird' && s.residency && RESID[s.residency])
      return '<span class="natkind ' + RESID[s.residency].cls + '">' + esc(RESID[s.residency].short) + '</span>';
    if (s.cat === 'plant' && s.lifeform && LF[s.lifeform])
      return '<span class="natkind ' + LF[s.lifeform].cls + '">' + esc(LF[s.lifeform].short) + '</span>';
    return '';
  }

  /* ---- one compact species row (→ opens the floating card) ---------------- */
  function rowHtml(s, opts){
    opts = opts || {};
    var now = inSeasonNow(s);
    var tag = opts.now ? '' : (now ? '<span class="nattag on">🟢 בָּעוֹנָה</span>' : '<span class="nattag">' + esc(seasonSpan(s)) + '</span>');
    return '<div class="natrow' + (s.iconic ? ' iconic' : '') + '" data-species="' + esc(s.id) + '" role="button" tabindex="0" title="פְּתַח כַּרְטִיס">' +
      thumb(s) +
      '<span class="natn">' + esc(s.he) + ' <span class="natsci">' + esc(s.sci) + '</span></span>' +
      kindBadge(s) +
      tag +
      '<span class="natgo" aria-hidden="true">→</span></div>';
  }

  /* ---- the 12-month season strip for the detail card ---------------------- */
  function seasonStrip(s){
    var m = s.months || [], cells = '';
    for (var i = 1; i <= 12; i++)
      cells += '<i class="' + (m.indexOf(i) !== -1 ? 'on' : '') + '" title="' + MONTHS_HE[i-1] + '">' + MON_SHORT[i-1] + '</i>';
    return '<div class="natstrip">' + cells + '</div>';
  }

  /* ---- the FULL species card body (painted into the floating card) -------- */
  function speciesDetailHtml(id){
    var s = byId(id);
    if (!s) return '<div class="idt-foot">לֹא נִמְצָא.</div>';
    var h = '<div class="nat-card">';
    if (s.photo && s.photo.local){
      var pc = s.photo.credit ? esc(s.photo.credit) : '';
      if (s.photo.license) pc += (pc ? ' · ' : '') + esc(s.photo.license);
      var srcHost = /wik[ip]/i.test(s.photo.source || '') ? 'Wikimedia' : '';
      if (srcHost) pc += (pc ? ' · ' : '') + srcHost;
      h += '<div class="natphoto"><img src="' + esc(s.photo.local) + '" alt="' + esc(s.he) + '">' +
           (pc ? '<div class="natcred">📷 ' + pc + '</div>' : '') + '</div>';
    }
    h += '<div class="natd-sci">' + esc(s.sci) + (s.en ? ' · ' + esc(s.en) : '') + '</div>';
    // residency (birds) / lifeform (plants) — a clear "always around" vs "seasonal" pill
    var kind = '';
    if (s.cat === 'bird' && s.residency && RESID[s.residency])
      kind = '<span class="natd-kind ' + RESID[s.residency].cls + '">' + esc(RESID[s.residency].he) + '</span>';
    else if (s.cat === 'plant' && s.lifeform && LF[s.lifeform])
      kind = '<span class="natd-kind ' + LF[s.lifeform].cls + '">' + esc(LF[s.lifeform].he) + '</span>';
    h += '<div class="natd-meta"><span>' + (EMOJI[s.cat] || '•') + ' ' + esc(CAT_HE[s.cat] || s.cat) + '</span>' +
         (s.habitat ? '<span class="natd-hab">📍 ' + esc(s.habitat) + '</span>' : '') + '</div>';
    if (kind) h += '<div class="natd-kindrow">' + kind + '</div>';
    // lead paragraph (rich blurb) — the warm, story-like opening
    if (s.blurb_he) h += '<div class="natd-lead">' + esc(s.blurb_he) + '</div>';
    // season
    h += '<div class="natd-sec">מָתַי רוֹאִים' + (inSeasonNow(s) ? ' <span class="natnow-pill">🟢 בָּעוֹנָה עַכְשָׁו</span>' : '') + '</div>';
    h += seasonStrip(s);
    if (s.peak) h += '<div class="natpeak">' + esc(s.peak) + '</div>';
    if (s.where_when_he) h += '<div class="natd-rich">' + esc(s.where_when_he) + '</div>';
    // id marks
    if (Array.isArray(s.id_marks) && s.id_marks.length){
      h += '<div class="natd-sec">סִימָנֵי זִיהוּי</div><ul class="natmarks">';
      s.id_marks.forEach(function(m){ h += '<li>' + esc(m) + '</li>'; });
      h += '</ul>';
    }
    // behaviour — how it lives
    if (s.behavior_he){
      h += '<div class="natd-sec">הִתְנַהֲגוּת</div>';
      h += '<div class="natd-rich">' + esc(s.behavior_he) + '</div>';
    }
    if (s.info) h += '<div class="natd-info">' + esc(s.info) + '</div>';
    // folklore — myth, tradition, name-lore
    if (s.folklore_he){
      h += '<div class="natd-sec">מָסֹרֶת וְסִפּוּר</div>';
      h += '<div class="natd-rich">' + esc(s.folklore_he) + '</div>';
    }
    // 💡 fun fact — highlighted "did you know?" line
    if (s.fun_fact_he){
      h += '<div class="natfact"><span class="natfact-k">💡 יָדַעְתָּ?</span> ' + esc(s.fun_fact_he) + '</div>';
    }
    // actions
    var acts = '';
    // 🔊 הקריאה — if a BUNDLED, free-licensed clip ships for this species (audio.local),
    // render a PLAY button that plays it offline via window.__amb.playCall(id). Otherwise
    // keep the external link as an honest fallback (no fake "play" with nothing behind it).
    var hasLocal = !!(s.audio && s.audio.local);
    if (hasLocal) {
      acts += '<button type="button" class="natbtn snd" data-nat-play-call="' + esc(s.id) + '">🔊 הַקְּרִיאָה</button>';
    } else if (s.sound) {
      acts += '<a class="natbtn snd" href="' + esc(s.sound) + '" target="_blank" rel="noopener">🔊 הַקְּרִיאָה ↗</a>';
    }
    if (s.link)  acts += '<a class="natbtn" href="' + esc(s.link) + '" target="_blank" rel="noopener">מֵידָע נוֹסָף ↗</a>';
    if (acts) h += '<div class="natd-acts">' + acts + '</div>';
    // bundled-call credit (honest attribution for the offline recording)
    if (s.audio && s.audio.local) {
      h += '<div class="natsndcred">🎙️ הַקְלָטָה: ' + esc(s.audio.credit || '') +
           (s.audio.license ? ' · ' + esc(s.audio.license) : '') + ' · iNaturalist</div>';
    }
    h += '<div class="idt-foot">מַדְרִיךְ שָׂדֶה — נְתוּנִים מְאֻמָּתִים לְאֵזוֹר לרקמונט. תְּמוּנָה בְּרִשְׁיוֹן חָפְשִׁי (Wikimedia).</div>';
    h += '</div>';
    return h;
  }

  /* ===========================================================================
   * FLOATING CARD (#natureCard) — mirrors garden.js's #gardenCard overlay:
   * a position-fixed brass-on-glass panel with a ✕, that temporarily hides the
   * #inst instrument while it's open (hideInst/restoreInst).
   * ======================================================================== */
  var _card = null, _cardBody = null, _cur = null, _instPrev = null;

  function hideInst(){ var i = document.querySelector('#inst:not(.inst-embed)'); if (i && _instPrev===null){ _instPrev = i.style.display; i.style.display = 'none'; } }
  function restoreInst(){ var i = document.querySelector('#inst:not(.inst-embed)'); if (i && _instPrev!==null){ i.style.display = _instPrev; } _instPrev = null; }

  /* ---- 🔊 play the species' BUNDLED call via the offline audio engine ----
     Plays assets/nature/sounds/<id>.mp3 through window.__amb (sounds.js). A 2nd
     press toggles it off. Reflects playing/stopped on the button label; if the
     master mute is on, nudges the label honestly. Never throws if __amb is
     missing (button just no-ops). */
  function setPlayLabel(btn, on){ if (btn) btn.innerHTML = on ? '⏸ עוֹצֵר' : '🔊 הַקְּרִיאָה'; }
  function onPlayCall(btn){
    var id = btn.getAttribute('data-nat-play-call');
    var amb = window.__amb;
    if (!amb || typeof amb.playCall !== 'function') return;
    if (amb.isMuted && amb.isMuted()){ btn.innerHTML = '🔇 מֻשְׁתָּק'; setTimeout(function(){ setPlayLabel(btn, false); }, 1100); return; }
    var res = amb.playCall(id) || {};
    if (res.ok && res.playing){
      // reset every other play button in the card, mark this one playing
      if (_cardBody){ var all = _cardBody.querySelectorAll('[data-nat-play-call]'); for (var i=0;i<all.length;i++) setPlayLabel(all[i], false); }
      setPlayLabel(btn, true);
    } else {
      setPlayLabel(btn, false);   // stopped, no-local, or play blocked → resting label
    }
  }

  function ensureCard(){
    if (_card) return;
    ensureCSS();
    _card = document.createElement('div'); _card.id = 'natureCard'; _card.setAttribute('dir','rtl');
    _cardBody = document.createElement('div'); _cardBody.className = 'body';
    _card.appendChild(_cardBody); document.body.appendChild(_card);
    // close on ✕, on the backdrop margin, or Escape; play a bundled call on 🔊
    _card.addEventListener('click', function(e){
      if (e.target.closest && e.target.closest('[data-nat-close]')) { hideCard(); return; }
      var play = e.target.closest && e.target.closest('[data-nat-play-call]');
      if (play) { onPlayCall(play); return; }
    });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && _card && _card.classList.contains('on')) hideCard();
    });
  }

  function renderCard(){
    if (!_cardBody) return;
    var s = byId(_cur);
    var name = s ? s.he : '';
    var emoji = s ? (EMOJI[s.cat] || '•') : '•';
    _cardBody.innerHTML =
      '<div class="hd"><h3><span class="e">' + emoji + '</span>' + esc(name) + '</h3>' +
        '<span class="x" data-nat-close="1" title="סְגֹר">✕</span></div>' +
      speciesDetailHtml(_cur);
  }

  function openCard(id){
    if (!byId(id)) return;
    ensureCard();
    _cur = id;
    renderCard();
    _card.classList.add('on');
    hideInst();
    _cardBody.scrollTop = 0;
  }
  function hideCard(){
    // stop any sounding call when the card closes
    try { if (window.__amb && window.__amb.isPlaying && window.__amb.isPlaying()) window.__amb.playCall(window.__amb.currentCall()); } catch(e){}
    if (_card) _card.classList.remove('on'); restoreInst(); _cur = null;
  }

  /* ---- the rows for one category, with residency/lifeform grouping --------
     birds  → "מְקוֹמִיּוֹת · כָּל הַשָּׁנָה" group first, then "נוֹדְדוֹת / עוֹנָתִיּוֹת".
     plants → ordered annuals/geophytes first, then perennials, under a
              "חַד-שְׁנָתִיִּים / עוֹנָתִיִּים" → "רַב-שְׁנָתִיִּים" sub-split.
     others → flat, iconic-first (unchanged behaviour). */
  function iconicSort(a,b){ return (b.iconic?1:0) - (a.iconic?1:0); }
  function subGroup(title, list){
    if (!list.length) return '';
    return '<div class="natgrp">' + esc(title) + '</div>' +
           list.map(function(s){ return rowHtml(s, {}); }).join('');
  }
  function catBodyHtml(catKey){
    var inC = DATA.filter(function(s){ return s.cat === catKey; });
    if (!inC.length) return '';
    if (catKey === 'bird'){
      var local = inC.filter(isResident).sort(iconicSort);
      var moving = inC.filter(function(s){ return !isResident(s); }).sort(iconicSort);
      return subGroup('מְקוֹמִיּוֹת · כָּל הַשָּׁנָה', local) +
             subGroup('נוֹדְדוֹת / עוֹנָתִיּוֹת', moving);
    }
    if (catKey === 'plant'){
      var seasonal = inC.filter(isSeasonalPlant).sort(function(a,b){ return lfOrd(a)-lfOrd(b) || iconicSort(a,b); });
      var peren = inC.filter(function(s){ return !isSeasonalPlant(s); }).sort(function(a,b){ return lfOrd(a)-lfOrd(b) || iconicSort(a,b); });
      return subGroup('חַד-שְׁנָתִיִּים / עוֹנָתִיִּים', seasonal) +
             subGroup('רַב-שְׁנָתִיִּים', peren);
    }
    return inC.slice().sort(iconicSort).map(function(s){ return rowHtml(s, {}); }).join('');
  }

  /* ---- render the guide list into the host -------------------------------- */
  function render(){
    if (!_host) return;
    if (!DATA){ _host.innerHTML = '<div class="est">טוֹעֵן מַדְרִיךְ טֶבַע…</div>'; return; }
    var q = _query.trim();
    var html = '<h3>מַדְרִיךְ הַטֶּבַע · לרקמונט</h3>' +
      '<div class="sub">מָה חַי סְבִיבְךָ — לְפִי הָעוֹנָה. לְחַץ עַל מִין לְכַרְטִיס מָלֵא.</div>' +
      '<input class="natq" placeholder="חיפוש מין…" value="' + esc(_query) + '">';

    if (q){
      var ql = q.toLowerCase();
      var hits = DATA.filter(function(s){
        return (s.he && s.he.indexOf(q) !== -1) ||
               (s.sci && s.sci.toLowerCase().indexOf(ql) !== -1) ||
               (s.en && s.en.toLowerCase().indexOf(ql) !== -1) ||
               (s.info && s.info.indexOf(q) !== -1);
      });
      html += '<div class="nat-sec">תּוֹצָאוֹת · ' + hits.length + '</div>';
      html += hits.length ? hits.map(function(s){ return rowHtml(s, {}); }).join('')
                          : '<div class="est">אֵין תּוֹצָאוֹת</div>';
    } else {
      // ---- בסביבה עכשיו (grouped by category, scannable) ----
      var nowList = DATA.filter(inSeasonNow);
      html += '<div class="nat-now">🟢 בַּסְּבִיבָה עַכְשָׁו · ' + MONTHS_HE[curMonth()-1] + ' <span class="cnt">' + nowList.length + '</span></div>';
      CATS.forEach(function(c){
        var inC = nowList.filter(function(s){ return s.cat === c.k; });
        if (!inC.length) return;
        // birds: residents first; plants: annuals/geophytes first; then iconic
        inC.sort(function(a,b){
          if (c.k === 'bird'){ var r = (isResident(b)?1:0) - (isResident(a)?1:0); if (r) return r; }
          if (c.k === 'plant'){ var l = lfOrd(a) - lfOrd(b); if (l) return l; }
          return iconicSort(a,b);
        });
        html += '<div class="natcatsub">' + c.emoji + ' ' + c.he + '</div>';
        html += inC.map(function(s){ return rowHtml(s, {now:true}); }).join('');
      });
      // ---- עיון לפי קבוצה (collapsible; all species, in-season marked) ----
      //   birds split מקומיות/נודדות, plants lead with annuals/geophytes (catBodyHtml)
      html += '<div class="nat-sec nat-browse">עִיּוּן לְפִי קְבוּצָה</div>';
      CATS.forEach(function(c){
        var inC = DATA.filter(function(s){ return s.cat === c.k; });
        if (!inC.length) return;
        var open = !!_expanded[c.k];
        html += '<div class="natcathd' + (open ? ' open' : '') + '" data-cat-toggle="' + c.k + '" role="button" tabindex="0">' +
          '<span class="chev">' + (open ? '▾' : '▸') + '</span>' +
          '<span class="natcatn">' + c.emoji + ' ' + c.he + '</span>' +
          '<span class="cnt">' + inC.length + '</span></div>';
        if (open) html += '<div class="natcatbody">' + catBodyHtml(c.k) + '</div>';
      });
    }
    html += '<div class="foot">תְּמוּנוֹת: Wikimedia (רִשְׁיוֹן חָפְשִׁי) · קְרִיאוֹת מֻקְלָטוֹת: iNaturalist (CC) · נְתוּנִים מְאֻמָּתִים לָאֵזוֹר</div>';
    _host.innerHTML = html;
  }

  /* ---- mount: wire delegated handlers ONCE per host, then render ----------
     Fully self-wiring: a species-row click opens the INTERNAL floating card.
     No external onSpeciesOpen callback is required (the old side panel is gone). */
  function renderGuideInto(host, opts){
    if (!host) return;
    ensureCSS();
    _host = host;
    if (_wiredHost !== host){
      _wiredHost = host;
      host.addEventListener('click', function(e){
        var cat = e.target.closest && e.target.closest('[data-cat-toggle]');
        if (cat){ var k = cat.getAttribute('data-cat-toggle'); _expanded[k] = !_expanded[k]; render(); return; }
        var row = e.target.closest && e.target.closest('[data-species]');
        if (row){ openCard(row.getAttribute('data-species')); }
      });
      host.addEventListener('keydown', function(e){
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var row = e.target.closest && e.target.closest('[data-species]');
        var cat = e.target.closest && e.target.closest('[data-cat-toggle]');
        if (row){ e.preventDefault(); openCard(row.getAttribute('data-species')); }
        else if (cat){ e.preventDefault(); var k = cat.getAttribute('data-cat-toggle'); _expanded[k] = !_expanded[k]; render(); }
      });
      // search: rebuild list, then restore focus + caret (innerHTML replaces the input)
      host.addEventListener('input', function(e){
        if (!e.target.classList || !e.target.classList.contains('natq')) return;
        var caret = e.target.selectionStart; _query = e.target.value; render();
        var box = host.querySelector('.natq'); if (box){ box.focus(); try{ box.setSelectionRange(caret, caret); }catch(_){} }
      });
    }
    render();
  }

  /* ---- skin (list scoped to #wild-guide; card = floating #natureCard) ----- */
  function ensureCSS(){
    if (document.getElementById('nature-css')) return;
    var s = document.createElement('style');
    s.id = 'nature-css';
    s.textContent =
      '#wild-guide .natq{width:100%;margin:8px 0 4px;padding:7px 10px;background:rgba(255,255,255,.04);' +
        'border:1px solid rgba(202,161,90,.28);border-radius:8px;color:#e9e3d4;font-family:Heebo,sans-serif;font-size:13px;direction:rtl}' +
      '#wild-guide .natq::placeholder{color:#7d7560}' +
      '#wild-guide .nat-now{margin:12px 0 4px;color:' + GOLD + ';font-family:Bellefair,serif;font-size:14px;letter-spacing:.03em}' +
      '#wild-guide .nat-now .cnt,#wild-guide .natcathd .cnt{color:#a99b78;font-size:11px;font-family:Heebo;margin-inline-start:4px}' +
      '#wild-guide .nat-sec{margin:16px 0 4px;color:' + GOLD + ';font-family:Bellefair,serif;font-size:13px;opacity:.92;border-top:1px solid rgba(202,161,90,.15);padding-top:9px}' +
      '#wild-guide .natcatsub{margin:9px 0 2px;color:#cdbf9b;font-size:11.5px;font-family:Heebo;opacity:.85}' +
      '#wild-guide .natrow{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:8px;cursor:pointer;' +
        'border:1px solid transparent;transition:background .12s,border-color .12s}' +
      '#wild-guide .natrow:hover{background:rgba(202,161,90,.08);border-color:rgba(202,161,90,.25)}' +
      '#wild-guide .natthumb{width:30px;height:30px;flex:0 0 30px;border-radius:6px;overflow:hidden;display:flex;' +
        'align-items:center;justify-content:center;background:rgba(255,255,255,.05);font-size:16px}' +
      '#wild-guide .natthumb img{width:100%;height:100%;object-fit:cover;display:block}' +
      '#wild-guide .natn{flex:1;min-width:0;color:#ece6d8;font-size:13px;font-family:Heebo;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#wild-guide .natrow.iconic .natn{color:' + GOLD + '}' +
      '#wild-guide .natsci{color:#857c66;font-size:10px;font-style:italic}' +
      '#wild-guide .nattag{color:#857c66;font-size:10px;font-family:Heebo;flex:0 0 auto}' +
      '#wild-guide .nattag.on{color:#7fb88a}' +
      // ---- residency / lifeform badge on a row (מקומית · נודדת · חד-שנתי) ----
      '#wild-guide .natkind{flex:0 0 auto;font-size:9.5px;font-family:Heebo;padding:1.5px 6px;border-radius:999px;' +
        'line-height:1.35;white-space:nowrap;border:1px solid transparent}' +
      '#wild-guide .natkind.res-local{color:#8fd0a0;background:rgba(127,184,138,.13);border-color:rgba(127,184,138,.34)}' +
      '#wild-guide .natkind.res-move{color:#e3c489;background:rgba(202,161,90,.12);border-color:rgba(202,161,90,.32)}' +
      '#wild-guide .natkind.lf-annual{color:#8fd0a0;background:rgba(127,184,138,.13);border-color:rgba(127,184,138,.34)}' +
      '#wild-guide .natkind.lf-peren{color:#bdb08c;background:rgba(255,255,255,.05);border-color:rgba(202,161,90,.22)}' +
      // ---- a sub-group heading inside a category (מקומיות / נודדות · חד-שנתיים / רב-שנתיים) ----
      '#wild-guide .natgrp{margin:8px 0 3px;color:#cdbf9b;font-size:11px;font-family:Heebo;letter-spacing:.02em;opacity:.9;' +
        'padding-bottom:3px;border-bottom:1px dashed rgba(202,161,90,.18)}' +
      '#wild-guide .natgo{color:' + GOLD + ';font-size:14px;opacity:.65;flex:0 0 auto}' +
      '#wild-guide .natrow:hover .natgo{opacity:1}' +
      '#wild-guide .natcathd{display:flex;align-items:center;gap:7px;padding:7px 6px;cursor:pointer;border-radius:8px}' +
      '#wild-guide .natcathd:hover{background:rgba(202,161,90,.07)}' +
      '#wild-guide .natcathd .chev{color:' + GOLD + ';font-size:11px;width:12px}' +
      '#wild-guide .natcathd .natcatn{flex:1;color:#ece6d8;font-size:13px;font-family:Heebo}' +
      '#wild-guide .natcatbody{padding-inline-start:6px;margin-bottom:4px}' +
      // ---- the FLOATING species card (mirrors #gardenCard) ----
      '#natureCard{position:fixed;top:18px;right:22px;width:340px;max-height:calc(100vh - 40px);' +
        'display:none;flex-direction:column;font-family:Heebo,sans-serif;color:#efe6cf;z-index:60;' +
        'text-shadow:0 1px 6px rgba(0,0,0,.85),0 0 2px rgba(0,0,0,.7)}' +
      '#natureCard.on{display:flex}' +
      '#natureCard .body{overflow-y:auto;padding:14px 15px;border-radius:4px;' +
        'background:linear-gradient(160deg,rgba(12,14,26,.93),rgba(6,7,15,.95));' +
        'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
        'border:1px solid rgba(202,161,90,.22);box-shadow:0 18px 48px rgba(0,0,0,.55)}' +
      '#natureCard .hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}' +
      '#natureCard h3{font-family:"Frank Ruhl Libre",serif;font-weight:500;font-size:19px;color:#fff7e6;line-height:1.15}' +
      '#natureCard h3 .e{font-size:20px;margin-left:5px}' +
      '#natureCard .x{flex:0 0 auto;cursor:pointer;color:#a99b78;font-size:15px;line-height:1;padding:2px 6px;border-radius:6px;' +
        'border:1px solid rgba(202,161,90,.22);background:rgba(255,255,255,.03);transition:.15s}' +
      '#natureCard .x:hover{color:#fff7e6;border-color:rgba(202,161,90,.5)}' +
      // ---- the species-card inner content (was the side-panel card) ----
      '#natureCard .nat-card{direction:rtl}' +
      '#natureCard .natphoto{position:relative;border-radius:9px;overflow:hidden;margin-bottom:9px;border:1px solid rgba(202,161,90,.22)}' +
      '#natureCard .natphoto img{width:100%;max-height:210px;object-fit:cover;display:block}' +
      '#natureCard .natcred{position:absolute;left:0;right:0;bottom:0;padding:3px 7px;font-size:9px;color:#d8cfb8;' +
        'background:linear-gradient(0deg,rgba(0,0,0,.62),transparent);font-family:Heebo;text-align:start}' +
      '#natureCard .natd-sci{color:#9b927a;font-size:12px;font-style:italic;font-family:Heebo}' +
      '#natureCard .natd-meta{display:flex;flex-wrap:wrap;gap:4px 12px;margin:5px 0 2px;color:#cdbf9b;font-size:12px;font-family:Heebo}' +
      '#natureCard .natd-hab{color:#a99b78}' +
      // ---- residency / lifeform pill on the detail card ----
      '#natureCard .natd-kindrow{margin:4px 0 2px}' +
      '#natureCard .natd-kind{display:inline-block;font-size:11px;font-family:Heebo;padding:2px 9px;border-radius:999px;' +
        'line-height:1.4;border:1px solid transparent}' +
      '#natureCard .natd-kind.res-local,#natureCard .natd-kind.lf-annual{color:#9bd8ab;background:rgba(127,184,138,.14);border-color:rgba(127,184,138,.4)}' +
      '#natureCard .natd-kind.res-move{color:#e8cb93;background:rgba(202,161,90,.13);border-color:rgba(202,161,90,.4)}' +
      '#natureCard .natd-kind.lf-peren{color:#cabd9a;background:rgba(255,255,255,.05);border-color:rgba(202,161,90,.26)}' +
      '#natureCard .natd-sec{margin:11px 0 5px;color:' + GOLD + ';font-family:Bellefair,serif;font-size:13px;letter-spacing:.03em}' +
      '#natureCard .natnow-pill,#natureCard .natd-sec .natnow-pill{font-family:Heebo;font-size:10px;color:#7fb88a;margin-inline-start:6px}' +
      '#natureCard .natstrip{display:grid;grid-template-columns:repeat(12,1fr);gap:2px}' +
      '#natureCard .natstrip i{font-style:normal;text-align:center;font-size:8.5px;padding:4px 0;border-radius:4px;' +
        'background:rgba(255,255,255,.04);color:#6f6754;font-family:Heebo}' +
      '#natureCard .natstrip i.on{background:linear-gradient(180deg,rgba(202,161,90,.85),rgba(202,161,90,.5));color:#0c0b07;font-weight:600}' +
      '#natureCard .natpeak{margin-top:5px;color:#cdbf9b;font-size:11.5px;font-family:Heebo}' +
      '#natureCard .natmarks{margin:2px 14px 0;padding:0;color:#ddd5c3;font-size:12.5px;font-family:Heebo;line-height:1.55}' +
      '#natureCard .natmarks li{margin:2px 0}' +
      '#natureCard .natd-info{margin-top:9px;color:#cabd9a;font-size:12.5px;line-height:1.6;font-family:Heebo}' +
      // ---- rich enrichment prose (lead blurb, behaviour, folklore, where/when) ----
      '#natureCard .natd-lead{margin:9px 0 2px;color:#e7dcc0;font-size:13px;line-height:1.68;font-family:Heebo}' +
      '#natureCard .natd-rich{margin-top:5px;color:#cabd9a;font-size:12.5px;line-height:1.62;font-family:Heebo}' +
      // ---- 💡 fun fact — a softly highlighted "did you know?" line ----
      '#natureCard .natfact{margin-top:11px;padding:9px 11px;border-radius:8px;font-family:Heebo;font-size:12.5px;' +
        'line-height:1.6;color:#e9dcb6;background:rgba(202,161,90,.1);border:1px solid rgba(202,161,90,.26);' +
        'border-inline-start:3px solid rgba(202,161,90,.7)}' +
      '#natureCard .natfact-k{color:' + GOLD + ';font-weight:600;letter-spacing:.01em}' +
      '#natureCard .natd-acts{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}' +
      '#natureCard .natbtn{flex:1;min-width:120px;text-align:center;padding:8px 10px;border-radius:8px;' +
        'background:rgba(202,161,90,.12);border:1px solid rgba(202,161,90,.4);color:' + GOLD + ';' +
        'font-family:Heebo;font-size:12px;text-decoration:none;cursor:pointer;appearance:none;-webkit-appearance:none;line-height:1.2}' +
      '#natureCard button.natbtn{font:inherit;font-size:12px;font-family:Heebo}' +
      '#natureCard .natbtn:hover{background:rgba(202,161,90,.22)}' +
      '#natureCard .natbtn.snd{color:#cfe0d2;border-color:rgba(127,184,138,.4);background:rgba(127,184,138,.1)}' +
      '#natureCard .natbtn.snd:hover{background:rgba(127,184,138,.2)}' +
      '#natureCard .natsndcred{margin-top:7px;font-size:9px;color:#8a7a52;font-family:Heebo;text-align:start;line-height:1.5}' +
      '#natureCard .idt-foot{margin-top:11px;padding-top:8px;border-top:1px solid rgba(202,161,90,.13);' +
        'font-size:9.5px;color:#8a7a52;font-family:Heebo;line-height:1.5}' +
      // ---- mobile: full-width sheet (mirrors garden.js) ----
      '@media(max-width:960px){#natureCard{width:calc(100vw - 24px);max-width:none;right:12px;left:12px;top:10px;max-height:calc(100vh - 20px)}}' +
      // ---- phone pass (<=760px): roomier rows, bigger tap targets, capped card sheet ----
      '@media(max-width:760px){' +
        '#natureCard{right:8px;left:8px;top:8px;width:auto;max-height:calc(100vh - 16px)}' +
        '#natureCard .body{padding:12px 12px;max-height:calc(100vh - 16px)}' +
        '#natureCard h3{font-size:17px}' +
        '#natureCard .x{font-size:17px;padding:6px 11px;min-width:34px;min-height:34px;display:flex;align-items:center;justify-content:center}' +
        '#natureCard .natphoto img{max-height:180px}' +
        '#natureCard .natd-acts{gap:8px}' +
        '#natureCard .natbtn{flex:1 1 100%;min-width:0;padding:11px 12px;font-size:13px}' +
        '#natureCard button.natbtn{font-size:13px}' +
        '#natureCard .natstrip i{font-size:9px;padding:5px 0}' +
        '#natureCard .natmarks{font-size:13px}' +
        '#wild-guide .natq{font-size:13px;padding:10px 12px}' +
        '#wild-guide .natrow{padding:8px 8px;gap:9px;border-color:rgba(202,161,90,.12)}' +
        '#wild-guide .natthumb{width:34px;height:34px;flex:0 0 34px}' +
        '#wild-guide .natn{font-size:13px;white-space:normal}' +
        '#wild-guide .natsci{font-size:11px}' +
        '#wild-guide .nattag,#wild-guide .natkind{font-size:11px}' +
        '#wild-guide .natgo{font-size:16px;opacity:1}' +
        '#wild-guide .natcathd{padding:11px 8px}' +
        '#wild-guide .natcathd .natcatn{font-size:14px}' +
      '}';
    document.head.appendChild(s);
  }

  window.Nature = {
    load: load, isReady: function(){ return READY; }, onReady: onReady,
    renderGuideInto: renderGuideInto,
    _data: function(){ return DATA; }, _inSeasonNow: inSeasonNow
  };

  load();
})();
