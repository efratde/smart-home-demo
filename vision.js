/* ===========================================================================
 * vision.js · "הבית של אלכס" — לוּחַ חֲזוֹן (vision / dream board)
 * ---------------------------------------------------------------------------
 * A personal, aspirational PINBOARD that lives inside the dashboard (NOT a
 * data grid). Each TILE is one of:
 *   · an IMAGE tile  — an uploaded photo (canvas-downscaled to a ≤280KB
 *                      dataURL, the same budget log_store.js uses) + caption
 *                      + category.
 *   · an INTENTION tile — text-only "quote / כַּוָּנָה": a short line of intent,
 *                      no image. Reads warmer, a little bigger, gold accent.
 * Categories (chips, RTL): גִּינָה / בַּיִת / מַסָּעוֹת / יְעָדִים / הַשְׁרָאָה.
 * Filter by category; add / edit / remove tiles; everything persists to
 * localStorage 'home_vision_v1'. Masonry (CSS columns) so it feels like a
 * pinboard, not a table. Dark "#inst" brass-on-glass skin, but a touch more
 * photographic — bigger imagery, softer cards.
 *
 * Self-contained: owns its DOM + a once-injected <style> (scoped to
 * #visionBoard), reads/writes ONLY its own localStorage key, and never
 * touches index.html / panels.js / another module's files. Exposes
 * window.__vision.render(host, date) — the integrator mounts it into a tab
 * host and (re)calls render() on each open. No <script> tag self-registers.
 * ======================================================================== */
(function () {
  'use strict';
  if (window.__vision) return;                       // idempotency (house pattern)

  var GOLD = '#caa15a';
  var LS_KEY = 'home_vision_v1';
  var PHOTO_CAP = 280000;                             // ≤280KB dataURL (log_store budget)
  var MAX_DIM = 1100;                                 // longest edge after downscale

  /* ---- categories (id → he label + emoji) -------------------------------- */
  var CATS = [
    { k: 'garden',  he: 'גִּינָה',    emoji: '🌿' },
    { k: 'home',    he: 'בַּיִת',     emoji: '🏠' },
    { k: 'travel',  he: 'מַסָּעוֹת',  emoji: '🧭' },
    { k: 'goals',   he: 'יְעָדִים',   emoji: '🎯' },
    { k: 'inspire', he: 'הַשְׁרָאָה', emoji: '✨' }
  ];
  var CAT_HE = {}, CAT_EMOJI = {};
  CATS.forEach(function (c) { CAT_HE[c.k] = c.he; CAT_EMOJI[c.k] = c.emoji; });
  function catHe(k)    { return CAT_HE[k] || 'הַשְׁרָאָה'; }
  function catEmoji(k) { return CAT_EMOJI[k] || '✨'; }

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function newId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function isoNow(){ return new Date().toISOString(); }

  /* ---- persistence (the panels.js / log_store.js LS idiom, verbatim) ------
     array store, []-default on parse error, fire-and-forget try/catch write. */
  function load(){ try { var a = JSON.parse(localStorage.getItem(LS_KEY)); return Array.isArray(a) ? a : []; } catch(e){ return []; } }
  function persist(a){ try { localStorage.setItem(LS_KEY, JSON.stringify(a)); return true; } catch(e){ return false; } }

  /* keep only a valid, capped image dataURL — otherwise drop it, so a stray
     oversized string can never break the whole store write (log_store pattern). */
  function sanitizePhoto(p){
    if (typeof p !== 'string' || !p) return null;
    if (!/^data:image\//.test(p)) return null;
    if (p.length > PHOTO_CAP) return null;
    return p;
  }

  /* ---- one-time seed: 2–3 warm, generic, EDITABLE starter intention tiles ---
     Guarded by a one-time flag ('home_vision_seeded_v1') so a delete sticks and
     it never re-seeds. Plain text "intention" tiles — fully editable / removable
     like any other. Only seeds when the board is genuinely empty on first run. */
  var SEED_FLAG = 'home_vision_seeded_v1';
  function seedStarters(arr){
    try { if (localStorage.getItem(SEED_FLAG)) return arr; } catch(e){ return arr; }
    if (Array.isArray(arr) && arr.length){ try { localStorage.setItem(SEED_FLAG, '1'); } catch(e){} return arr; }
    var starters = [
      { caption: 'חֲלוֹם לַגִּינָה',            cat: 'garden'  },
      { caption: 'לַיְלָה שֶׁל כּוֹכָבִים בלרקמונט', cat: 'inspire' },
      { caption: 'פְּרוֹיֶקְט לַבַּיִת',           cat: 'home'    }
    ];
    var seeded = starters.map(function(s){
      return { id: newId(), type: 'text', cat: s.cat, caption: s.caption, ts: isoNow() };
    });
    try { localStorage.setItem(LS_KEY, JSON.stringify(seeded)); localStorage.setItem(SEED_FLAG, '1'); }
    catch(e){ return arr; }
    return seeded;
  }

  var TILES = seedStarters(load());
  var _filter = 'all';                               // active category filter
  var _host = null, _wiredHost = null;
  var _editing = null;                               // tile id being edited (or '__new__'/'__newText__')
  var _quotaWarn = false;                             // surfaced honestly if a save was dropped

  /* ---- CRUD (pure data; the form layer calls these) ---------------------- */
  function addTile(rec){
    rec = rec || {};
    var t = {
      id: newId(),
      type: (rec.type === 'text') ? 'text' : 'image',
      cat: CAT_HE[rec.cat] ? rec.cat : 'inspire',
      caption: typeof rec.caption === 'string' ? rec.caption.slice(0, 600) : '',
      ts: isoNow()
    };
    if (t.type === 'image'){
      var ph = sanitizePhoto(rec.photo);
      if (!ph) return null;                            // image tile with no valid image → refuse (honest)
      t.photo = ph;
    }
    TILES.unshift(t);                                  // newest-first (house pattern)
    if (!persist(TILES)){ TILES.shift(); _quotaWarn = true; return null; }
    _quotaWarn = false;
    return t;
  }
  function updateTile(id, patch){
    for (var i=0;i<TILES.length;i++){
      if (TILES[i] && TILES[i].id === id){
        var p = {};
        if (typeof patch.caption === 'string') p.caption = patch.caption.slice(0, 600);
        if (patch.cat && CAT_HE[patch.cat]) p.cat = patch.cat;
        if ('photo' in patch){ var ph = sanitizePhoto(patch.photo); if (ph) p.photo = ph; }
        var before = TILES[i];
        TILES[i] = { id: before.id, type: before.type, ts: before.ts,
                     cat: p.cat || before.cat, caption: ('caption' in p) ? p.caption : before.caption,
                     photo: p.photo || before.photo };
        if (TILES[i].type === 'text') delete TILES[i].photo;
        if (!persist(TILES)){ TILES[i] = before; _quotaWarn = true; return null; }
        _quotaWarn = false;
        return TILES[i];
      }
    }
    return null;
  }
  function removeTile(id){
    var next = TILES.filter(function(t){ return !(t && t.id === id); });
    if (next.length === TILES.length) return false;
    TILES = next; persist(TILES); return true;
  }

  /* ---- canvas downscale: File → ≤280KB JPEG dataURL ----------------------
     Mirrors the log_store.js photo budget. Reads the file, draws onto a
     canvas capped at MAX_DIM on its long edge, then steps JPEG quality DOWN
     until the dataURL is within PHOTO_CAP (or gives the smallest it reached).
     Resolves null on any failure so the caller can surface an honest message. */
  function fileToDataURL(file, cb){
    if (!file || (file.type && file.type.indexOf('image/') !== 0)){ cb(null); return; }
    var reader = new FileReader();
    reader.onerror = function(){ cb(null); };
    reader.onload = function(){
      var img = new Image();
      img.onerror = function(){ cb(null); };
      img.onload = function(){
        try {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          if (!w || !h){ cb(null); return; }
          var scale = Math.min(1, MAX_DIM / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
          var ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, cw, ch);
          var q = 0.82, url = cv.toDataURL('image/jpeg', q);
          while (url.length > PHOTO_CAP && q > 0.4){ q -= 0.1; url = cv.toDataURL('image/jpeg', q); }
          // if still too big at low quality, shrink dimensions once more and retry.
          if (url.length > PHOTO_CAP){
            var cv2 = document.createElement('canvas'); cv2.width = Math.round(cw*0.75); cv2.height = Math.round(ch*0.75);
            cv2.getContext('2d').drawImage(img, 0, 0, cv2.width, cv2.height);
            url = cv2.toDataURL('image/jpeg', 0.6);
          }
          cb(url.length <= PHOTO_CAP ? url : null);
        } catch(e){ cb(null); }
      };
      img.src = reader.result;
    };
    try { reader.readAsDataURL(file); } catch(e){ cb(null); }
  }

  /* ===========================================================================
   * RENDER — the pinboard, scoped to #visionBoard (CSS in ensureCSS()).
   * ======================================================================== */
  function visibleTiles(){
    if (_filter === 'all') return TILES;
    return TILES.filter(function(t){ return t && t.cat === _filter; });
  }

  function chipsHtml(){
    var counts = { all: TILES.length };
    CATS.forEach(function(c){ counts[c.k] = TILES.filter(function(t){ return t && t.cat === c.k; }).length; });
    var h = '<div class="vchips">';
    h += '<span class="vchip' + (_filter==='all'?' on':'') + '" data-vfilter="all">הַכֹּל <i>' + counts.all + '</i></span>';
    CATS.forEach(function(c){
      h += '<span class="vchip' + (_filter===c.k?' on':'') + '" data-vfilter="' + c.k + '">' +
        c.emoji + ' ' + c.he + ' <i>' + (counts[c.k]||0) + '</i></span>';
    });
    h += '</div>';
    return h;
  }

  function tileHtml(t){
    var cap = t.caption ? esc(t.caption) : '';
    if (t.type === 'text'){
      return '<div class="vtile vtext" data-tile="' + esc(t.id) + '">' +
        '<div class="vquote-mark">”</div>' +
        '<div class="vquote">' + (cap || '<span class="vmuted">כַּוָּנָה רֵיקָה</span>') + '</div>' +
        '<div class="vtfoot"><span class="vcat">' + catEmoji(t.cat) + ' ' + catHe(t.cat) + '</span>' +
          '<span class="vacts"><span class="vact" data-vedit="' + esc(t.id) + '" title="עֲרֹךְ">✎</span>' +
          '<span class="vact" data-vdel="' + esc(t.id) + '" title="הָסֵר">✕</span></span></div>' +
        '</div>';
    }
    return '<div class="vtile vimg" data-tile="' + esc(t.id) + '">' +
      '<div class="vphoto"><img src="' + esc(t.photo||'') + '" alt="' + cap + '" loading="lazy">' +
        '<span class="vcatpill">' + catEmoji(t.cat) + ' ' + catHe(t.cat) + '</span></div>' +
      (cap ? '<div class="vcap">' + cap + '</div>' : '') +
      '<div class="vtfoot"><span class="vsp"></span>' +
        '<span class="vacts"><span class="vact" data-vedit="' + esc(t.id) + '" title="עֲרֹךְ">✎</span>' +
        '<span class="vact" data-vdel="' + esc(t.id) + '" title="הָסֵר">✕</span></span></div>' +
      '</div>';
  }

  /* ---- the add / edit form (inline panel, painted into #vision-form) ------ */
  function formHtml(){
    var t = (_editing && _editing !== '__new__' && _editing !== '__newText__')
      ? TILES.filter(function(x){ return x.id === _editing; })[0] : null;
    var isText = (_editing === '__newText__') || (t && t.type === 'text');
    var curCat = t ? t.cat : 'inspire';
    var curCap = t ? esc(t.caption||'') : '';
    var title = t ? 'עֲרִיכַת אָרִיחַ' : (isText ? 'כַּוָּנָה חֲדָשָׁה' : 'אָרִיחַ חָדָשׁ');

    var h = '<div class="vform" dir="rtl">';
    h += '<div class="vfhd"><span>' + title + '</span><span class="vfx" data-vcancel="1" title="בַּטֵּל">✕</span></div>';

    if (!isText){
      var hasImg = t && t.photo;
      h += '<label class="vdrop' + (hasImg?' has':'') + '" data-vdroplbl="1">' +
        (hasImg
          ? '<img src="' + esc(t.photo) + '" alt=""><span class="vdroptxt">לַחֲצוּ לְהַחְלָפַת הַתְּמוּנָה</span>'
          : '<span class="vdropicon">🖼️</span><span class="vdroptxt">בְּחַרוּ תְּמוּנָה מֵהַמַּכְשִׁיר</span>') +
        '<input type="file" accept="image/*" class="vfile" hidden></label>';
      h += '<div class="vpreviewslot"></div>';
    }

    h += '<textarea class="vcapin" rows="' + (isText?3:2) + '" maxlength="600" placeholder="' +
      (isText ? 'כִּתְבוּ אֶת הַכַּוָּנָה / הַמִּשְׁפָּט…' : 'כִּתּוּב לַתְּמוּנָה (אוֹפְצִיוֹנָלִי)…') + '">' + curCap + '</textarea>';

    h += '<div class="vcatpick">';
    CATS.forEach(function(c){
      h += '<span class="vcatopt' + (c.k===curCat?' on':'') + '" data-vcat="' + c.k + '">' + c.emoji + ' ' + c.he + '</span>';
    });
    h += '</div>';

    h += '<div class="vfmsg"></div>';
    h += '<div class="vfbtns"><button class="vbtn save" data-vsave="1">' + (t?'שְׁמֹר שִׁנּוּיִים':'הוֹסֵף לַלּוּחַ') + '</button>' +
      '<button class="vbtn ghost" data-vcancel="1">בַּטֵּל</button></div>';
    h += '</div>';
    return h;
  }

  function render(){
    if (!_host) return;
    ensureCSS();
    var vis = visibleTiles();
    var h = '<div id="visionBoard" dir="rtl">';
    h += '<div class="vhead"><h3>לוּחַ הַחֲזוֹן</h3>' +
      '<div class="vsub">הַתְּמוּנוֹת, הַמְּקוֹמוֹת וְהַכַּוָּנוֹת שֶׁמּוֹשְׁכוֹת אוֹתְךָ קָדִימָה. הוֹסֵף, סַדֵּר, חֲלֹם.</div></div>';

    // add buttons
    h += '<div class="vaddrow">' +
      '<button class="vbtn add" data-vadd="img">＋ אָרִיחַ תְּמוּנָה</button>' +
      '<button class="vbtn add ghost" data-vadd="text">＋ כַּוָּנָה / צִיטוּט</button></div>';

    // category filter chips
    h += chipsHtml();

    // the inline form slot (filled when _editing is set)
    h += '<div id="vision-form">' + (_editing ? formHtml() : '') + '</div>';

    if (_quotaWarn){
      h += '<div class="vwarn">⚠️ לֹא נִשְׁמַר — אֵין מַסְפִּיק מָקוֹם בְּאֵחְסוּן הַדַּפְדְּפָן. נַסּוּ לְהָסֵר אָרִיחַ אוֹ תְּמוּנָה קְטַנָּה יוֹתֵר.</div>';
    }

    // the board
    if (!TILES.length){
      h += '<div class="vempty">🌅<div>הַלּוּחַ עֲדַיִן רֵיק.<br>הוֹסֵף אֶת הַחֲלוֹם הָרִאשׁוֹן — תְּמוּנָה שֶׁל מָקוֹם, מַסָּע אוֹ כַּוָּנָה.</div></div>';
    } else if (!vis.length){
      h += '<div class="vempty">🔎<div>אֵין אֲרִיחִים בַּקָּטֵגוֹרְיָה הַזֹּאת עֲדַיִן.</div></div>';
    } else {
      h += '<div class="vmasonry">' + vis.map(tileHtml).join('') + '</div>';
    }

    h += '<div class="vfoot">לוּחַ אִישִׁי — נִשְׁמָר עַל הַמַּכְשִׁיר וּמְסֻנְכְרָן בֶּעָנָן. תְּמוּנוֹת מְכֻוָּצוֹת לַחְסֹךְ מָקוֹם.</div>';
    h += '</div>';
    _host.innerHTML = h;
  }

  /* ---- wiring (delegated, once per host) --------------------------------- */
  function setFormMsg(txt, cls){
    var slot = _host && _host.querySelector('.vfmsg');
    if (slot) slot.innerHTML = txt ? '<span class="' + (cls||'') + '">' + esc(txt) + '</span>' : '';
  }
  // staged image for a NEW image tile (downscaled dataURL waiting for save).
  var _pendingPhoto = null;

  function onClick(e){
    var t = e.target;
    var hit = function(attr){ var n = t.closest && t.closest('[' + attr + ']'); return n ? n.getAttribute(attr) : null; };

    var add = hit('data-vadd');
    if (add){ _editing = (add === 'text') ? '__newText__' : '__new__'; _pendingPhoto = null; render(); return; }

    var filt = hit('data-vfilter');
    if (filt){ _filter = filt; render(); return; }

    if (hit('data-vcancel')){ _editing = null; _pendingPhoto = null; render(); return; }

    var ed = hit('data-vedit');
    if (ed){ _editing = ed; _pendingPhoto = null; render(); return; }

    var del = hit('data-vdel');
    if (del){
      removeTile(del);
      if (_editing === del) _editing = null;
      render(); return;
    }

    var pickCat = hit('data-vcat');
    if (pickCat){
      var opts = _host.querySelectorAll('.vcatopt');
      for (var i=0;i<opts.length;i++) opts[i].classList.toggle('on', opts[i].getAttribute('data-vcat') === pickCat);
      _host._pickCat = pickCat;
      return;
    }

    if (hit('data-vsave')){ doSave(); return; }
  }

  function selectedCat(){
    var on = _host && _host.querySelector('.vcatopt.on');
    return (_host && _host._pickCat) || (on ? on.getAttribute('data-vcat') : 'inspire');
  }

  function doSave(){
    var capEl = _host.querySelector('.vcapin');
    var caption = capEl ? capEl.value : '';
    var cat = selectedCat();
    var isNewText = (_editing === '__newText__');
    var isNewImg = (_editing === '__new__');
    var isEdit = !isNewText && !isNewImg;

    if (isNewText){
      if (!caption.trim()){ setFormMsg('כִּתְבוּ אֶת הַכַּוָּנָה לִפְנֵי הַשְּׁמִירָה.', 'err'); return; }
      addTile({ type:'text', caption:caption, cat:cat });
      _editing = null; render(); return;
    }
    if (isNewImg){
      if (!_pendingPhoto){ setFormMsg('בְּחַרוּ תְּמוּנָה לִפְנֵי הַהוֹסָפָה.', 'err'); return; }
      var rec = addTile({ type:'image', photo:_pendingPhoto, caption:caption, cat:cat });
      if (!rec){ setFormMsg('לֹא נִשְׁמַר — אֵין מַסְפִּיק מָקוֹם בָּאֵחְסוּן.', 'err'); return; }
      _editing = null; _pendingPhoto = null; render(); return;
    }
    if (isEdit){
      var patch = { caption:caption, cat:cat };
      if (_pendingPhoto) patch.photo = _pendingPhoto;
      var res = updateTile(_editing, patch);
      if (!res){ setFormMsg('לֹא נִשְׁמַר — אֵין מַסְפִּיק מָקוֹם בָּאֵחְסוּן.', 'err'); return; }
      _editing = null; _pendingPhoto = null; render(); return;
    }
  }

  function onChange(e){
    var inp = e.target;
    if (!inp.classList || !inp.classList.contains('vfile')) return;
    var file = inp.files && inp.files[0];
    if (!file) return;
    setFormMsg('מְכַוֵּץ תְּמוּנָה…', 'busy');
    fileToDataURL(file, function(url){
      if (!url){ setFormMsg('לֹא הִצְלַחְתִּי לִקְרֹא אֶת הַתְּמוּנָה (אוֹ שֶׁהִיא גְּדוֹלָה מִדַּי).', 'err'); return; }
      _pendingPhoto = url;
      setFormMsg('הַתְּמוּנָה מוּכָנָה ✓', 'ok');
      // live preview in the form
      var slot = _host.querySelector('.vpreviewslot');
      if (slot) slot.innerHTML = '<div class="vpreview"><img src="' + esc(url) + '" alt=""></div>';
      var drop = _host.querySelector('.vdrop');
      if (drop){ drop.classList.add('has'); }
    });
  }

  function renderInto(host){
    if (!host) return;
    _host = host;
    if (_wiredHost !== host){
      _wiredHost = host;
      host.addEventListener('click', onClick);
      host.addEventListener('change', onChange);
    }
    render();
  }

  /* ---- skin (scoped to #visionBoard; a touch more photographic) ---------- */
  function ensureCSS(){
    if (document.getElementById('vision-css')) return;
    var s = document.createElement('style');
    s.id = 'vision-css';
    s.textContent =
      '#visionBoard{direction:rtl;font-family:Heebo,sans-serif;color:#efe6cf}' +
      '#visionBoard h3{font-family:"Frank Ruhl Libre",serif;font-weight:500;font-size:18px;color:#fff7e6;margin:0 0 2px}' +
      '#visionBoard .vsub{color:#a99b78;font-size:12px;line-height:1.5;margin-bottom:10px}' +
      // add buttons
      '#visionBoard .vaddrow{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 10px}' +
      '#visionBoard .vbtn{font-family:Heebo,sans-serif;font-size:12.5px;cursor:pointer;border-radius:9px;padding:8px 14px;' +
        'border:1px solid rgba(202,161,90,.4);background:linear-gradient(' + GOLD + ',#a07c38);color:#1a1606;font-weight:600}' +
      '#visionBoard .vbtn:hover{filter:brightness(1.06)}' +
      '#visionBoard .vbtn.ghost{background:rgba(202,161,90,.10);color:' + GOLD + ';font-weight:500}' +
      '#visionBoard .vbtn.ghost:hover{background:rgba(202,161,90,.2)}' +
      // category chips
      '#visionBoard .vchips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}' +
      '#visionBoard .vchip{font-size:11.5px;font-family:Heebo;padding:5px 11px;border-radius:20px;cursor:pointer;' +
        'border:1px solid rgba(202,161,90,.28);background:rgba(255,255,255,.04);color:#cdbf9b;transition:.13s;user-select:none}' +
      '#visionBoard .vchip:hover{border-color:rgba(202,161,90,.5);color:#ece6d8}' +
      '#visionBoard .vchip.on{background:linear-gradient(' + GOLD + ',#a07c38);color:#1a1606;font-weight:600;border-color:#e0c483}' +
      '#visionBoard .vchip i{font-style:normal;opacity:.7;font-size:10px;margin-inline-start:3px}' +
      '#visionBoard .vchip.on i{opacity:.85}' +
      // masonry pinboard (CSS columns)
      '#visionBoard .vmasonry{column-count:3;column-gap:12px}' +
      '@media(max-width:900px){#visionBoard .vmasonry{column-count:2}}' +
      '@media(max-width:560px){#visionBoard .vmasonry{column-count:1}}' +
      '#visionBoard .vtile{break-inside:avoid;-webkit-column-break-inside:avoid;margin:0 0 12px;border-radius:12px;overflow:hidden;' +
        'background:linear-gradient(160deg,rgba(20,22,36,.92),rgba(10,11,20,.95));border:1px solid rgba(202,161,90,.2);' +
        'box-shadow:0 10px 28px rgba(0,0,0,.4);position:relative}' +
      '#visionBoard .vtile:hover{border-color:rgba(202,161,90,.42)}' +
      // image tile
      '#visionBoard .vphoto{position:relative;line-height:0}' +
      '#visionBoard .vphoto img{width:100%;display:block;object-fit:cover}' +
      '#visionBoard .vcatpill{position:absolute;top:8px;inset-inline-start:8px;font-size:10px;font-family:Heebo;' +
        'padding:3px 9px;border-radius:20px;color:#fff7e6;background:rgba(8,9,16,.62);backdrop-filter:blur(4px);' +
        'border:1px solid rgba(202,161,90,.35)}' +
      '#visionBoard .vcap{padding:9px 12px 4px;font-size:13px;color:#ece6d8;line-height:1.5;font-family:Heebo}' +
      // text / intention tile
      '#visionBoard .vtext{padding:16px 16px 8px;background:linear-gradient(155deg,rgba(40,33,14,.55),rgba(14,12,8,.92));' +
        'border-color:rgba(202,161,90,.34)}' +
      '#visionBoard .vquote-mark{font-family:"Frank Ruhl Libre",serif;font-size:38px;line-height:.4;color:' + GOLD + ';opacity:.5;height:18px}' +
      '#visionBoard .vquote{font-family:"Frank Ruhl Libre",serif;font-size:17px;color:#fff7e6;line-height:1.55;margin:2px 0 6px}' +
      '#visionBoard .vmuted{color:#857c66;font-size:13px;font-family:Heebo}' +
      // tile footer (category + actions)
      '#visionBoard .vtfoot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 12px 9px}' +
      '#visionBoard .vcat{font-size:10.5px;color:#a99b78;font-family:Heebo}' +
      '#visionBoard .vsp{flex:1}' +
      '#visionBoard .vacts{display:flex;gap:5px}' +
      '#visionBoard .vact{cursor:pointer;font-size:12px;color:#a99b78;width:24px;height:24px;line-height:23px;text-align:center;' +
        'border-radius:7px;border:1px solid rgba(202,161,90,.22);background:rgba(255,255,255,.03);transition:.13s}' +
      '#visionBoard .vact:hover{color:#fff7e6;border-color:rgba(202,161,90,.55)}' +
      '#visionBoard .vimg .vtfoot{position:absolute;bottom:0;inset-inline-end:0;padding:6px 8px;background:none}' +
      '#visionBoard .vimg .vacts .vact{background:rgba(8,9,16,.6);backdrop-filter:blur(4px)}' +
      // empty / warn states
      '#visionBoard .vempty{text-align:center;color:#a99b78;font-size:13px;line-height:1.7;font-family:Heebo;' +
        'padding:34px 16px;border:1px dashed rgba(202,161,90,.25);border-radius:12px;margin-top:6px}' +
      '#visionBoard .vempty>div{margin-top:8px}' +
      '#visionBoard .vempty{font-size:30px}#visionBoard .vempty div{font-size:13px}' +
      '#visionBoard .vwarn{margin:6px 0 10px;padding:8px 12px;border-radius:9px;font-size:12px;color:#e8b0b0;' +
        'background:rgba(210,120,120,.12);border:1px solid rgba(210,120,120,.4)}' +
      // the inline form
      '#visionBoard .vform{margin:2px 0 14px;padding:14px 15px;border-radius:12px;' +
        'background:linear-gradient(160deg,rgba(16,18,30,.95),rgba(8,9,16,.97));border:1px solid rgba(202,161,90,.32);' +
        'box-shadow:0 14px 36px rgba(0,0,0,.5)}' +
      '#visionBoard .vfhd{display:flex;align-items:center;justify-content:space-between;font-family:Bellefair,serif;' +
        'letter-spacing:.04em;font-size:14px;color:' + GOLD + ';margin-bottom:10px}' +
      '#visionBoard .vfx{cursor:pointer;color:#a99b78;font-size:14px;padding:2px 6px;border-radius:6px;border:1px solid rgba(202,161,90,.22)}' +
      '#visionBoard .vfx:hover{color:#fff7e6}' +
      '#visionBoard .vdrop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;' +
        'min-height:96px;border-radius:10px;border:1.5px dashed rgba(202,161,90,.4);background:rgba(255,255,255,.03);' +
        'color:#cdbf9b;font-size:12.5px;font-family:Heebo;text-align:center;padding:12px;overflow:hidden}' +
      '#visionBoard .vdrop:hover{border-color:rgba(202,161,90,.65);background:rgba(202,161,90,.06)}' +
      '#visionBoard .vdrop.has{border-style:solid}' +
      '#visionBoard .vdrop img{max-width:100%;max-height:150px;border-radius:7px;display:block}' +
      '#visionBoard .vdropicon{font-size:26px}' +
      '#visionBoard .vpreview{margin:9px 0 0}#visionBoard .vpreview img{max-width:100%;max-height:160px;border-radius:8px;display:block}' +
      '#visionBoard .vcapin{width:100%;box-sizing:border-box;margin:10px 0 0;padding:9px 11px;border-radius:9px;resize:vertical;' +
        'background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.3);color:#ece6d8;font-family:Heebo;font-size:13px;direction:rtl}' +
      '#visionBoard .vcapin::placeholder{color:#7d7560}' +
      '#visionBoard .vcatpick{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 2px}' +
      '#visionBoard .vcatopt{font-size:11.5px;font-family:Heebo;padding:5px 11px;border-radius:20px;cursor:pointer;' +
        'border:1px solid rgba(202,161,90,.28);background:rgba(255,255,255,.04);color:#cdbf9b;user-select:none}' +
      '#visionBoard .vcatopt.on{background:linear-gradient(' + GOLD + ',#a07c38);color:#1a1606;font-weight:600;border-color:#e0c483}' +
      '#visionBoard .vfmsg{min-height:16px;margin:8px 0 0;font-size:11.5px;font-family:Heebo}' +
      '#visionBoard .vfmsg .err{color:#e8b0b0}#visionBoard .vfmsg .ok{color:#a7e0a7}#visionBoard .vfmsg .busy{color:#e8c474}' +
      '#visionBoard .vfbtns{display:flex;gap:8px;margin-top:11px}' +
      '#visionBoard .vfoot{margin-top:14px;padding-top:9px;border-top:1px solid rgba(202,161,90,.13);' +
        'font-size:10px;color:#8a7a52;font-family:Heebo;line-height:1.5}' +
      // ── mobile (phone) pass — keep everything on-screen, bigger tap targets ──
      '@media(max-width:760px){' +
        '#visionBoard .vmasonry{column-count:1}' +
        '#visionBoard h3{font-size:17px}' +
        // add buttons: full-width-ish, taller tap targets, stack to fill the row
        '#visionBoard .vaddrow{gap:8px}' +
        '#visionBoard .vaddrow .vbtn{flex:1 1 100%;min-height:42px;padding:11px 14px;font-size:13px}' +
        // filter chips & category-pick: roomier tap targets, still wrap
        '#visionBoard .vchips{gap:7px}' +
        '#visionBoard .vchip{font-size:12px;padding:8px 13px;min-height:34px;display:inline-flex;align-items:center}' +
        '#visionBoard .vcatpick{gap:7px}' +
        '#visionBoard .vcatopt{font-size:12px;padding:8px 13px;min-height:34px;display:inline-flex;align-items:center}' +
        // form: trim heavy padding, keep within the modal width
        '#visionBoard .vform{padding:12px 12px}' +
        '#visionBoard .vfx{font-size:16px;padding:6px 9px;min-width:34px;text-align:center}' +
        '#visionBoard .vcapin{font-size:13px;padding:10px 11px}' +
        '#visionBoard .vfbtns{flex-wrap:wrap}' +
        '#visionBoard .vfbtns .vbtn{flex:1 1 100%;min-height:42px}' +
        // tile actions (✎ / ✕): bigger hit area so they are tappable
        '#visionBoard .vacts{gap:6px}' +
        '#visionBoard .vact{width:34px;height:34px;line-height:33px;font-size:14px}' +
        // captions / quotes stay readable on a narrow column' +
        '#visionBoard .vcap{font-size:13px;padding:10px 12px 4px}' +
        '#visionBoard .vquote{font-size:16px}' +
      '}';
    document.head.appendChild(s);
  }

  /* ---- public API -------------------------------------------------------- */
  window.__vision = {
    render: function(host, date){ renderInto(host); },     // date unused (no time-series here)
    _tiles: function(){ return TILES.slice(); },
    _cats: function(){ return CATS.slice(); },
    _add: addTile, _update: updateTile, _remove: removeTile
  };
})();
