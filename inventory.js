/* ===========================================================================
 * inventory.js · "הבית של אלכס" — מַחְסָן: where-do-I-store-stuff
 * ---------------------------------------------------------------------------
 * A personal STORAGE INVENTORY for Alex: "where is X?". The point is FAST
 * SEARCH — type a name (or part of one) and the item + its LOCATION jump out
 * prominently ("📍 בְּ…"). Beyond search there are two browse modes —
 * by-location (every item grouped under its room/zone/box) and by-category —
 * plus add / edit / delete with an optional downscaled photo.
 *
 * Each ITEM = { name, location, room (optional canonical house room/zone id),
 *   quantity, category, notes, photo }. The optional `room` ties an item to a
 *   real room of the 3D house (workbench rooms) or a yard zone (site.json) so
 *   the inventory reads in the same vocabulary as the rest of the gift —
 *   purely conceptual/text, it never touches the WebGL scene.
 *
 * Persistence: window.LogStore collection 'inventory' when present (shares the
 *   app's one CRUD + photo-cap layer); else a private 'home_inventory_v1'
 *   localStorage store with the SAME record shape. Photos are canvas-downscaled
 *   to ≤~280 KB before storing (the log_store.js cap), mirroring the מוח/garden
 *   add-form pattern.
 *
 * Self-contained: exposes window.__inventory.render(hostEl, date); injects its
 *   own CSS once (#inv-* scope, like nature.js / zone_card.js). RTL Hebrew,
 *   dark glass cards, warm gold accents — the #inst instrument family. No
 *   <script> tags, no tab registration (the integrator wires those).
 * ======================================================================== */
(function () {
  'use strict';
  if (window.__inventory) return;

  var GOLD = '#caa15a';
  var COLL = 'inventory';                 // LogStore collection (or own LS key below)
  var LS_KEY = 'home_inventory_v1';       // fallback store when LogStore is absent
  var PHOTO_CAP = 280000;                 // ≈ log_store.js PHOTO_CAP

  /* ---- categories (free-text category is allowed; this is the quick-pick set) */
  var CATS = [
    { k:'tools',     he:'כֵּלִים וְעֲבוֹדָה',      emoji:'🛠️' },
    { k:'kitchen',   he:'מִטְבָּח',               emoji:'🍳' },
    { k:'docs',      he:'מִסְמָכִים',              emoji:'📄' },
    { k:'electronics', he:'אֶלֶקְטְרוֹנִיקָה',     emoji:'🔌' },
    { k:'garden',    he:'גִּנָּה',                 emoji:'🌿' },
    { k:'clothes',   he:'בְּגָדִים',               emoji:'👕' },
    { k:'sport',     he:'סְפּוֹרְט וּפְנַאי',       emoji:'🎒' },
    { k:'seasonal',  he:'עוֹנָתִי / חַגִּים',       emoji:'🎁' },
    { k:'cleaning',  he:'נִקָּיוֹן',               emoji:'🧴' },
    { k:'other',     he:'אַחֵר',                   emoji:'📦' }
  ];
  var CAT_HE = {}, CAT_EMOJI = {};
  CATS.forEach(function (c) { CAT_HE[c.k] = c.he; CAT_EMOJI[c.k] = c.emoji; });
  function catHe(k){ return CAT_HE[k] || k || 'אַחֵר'; }
  function catEmoji(k){ return CAT_EMOJI[k] || '📦'; }

  /* ---- canonical house locations (for the optional location pick).
     Rooms mirror the workbench.js SEED ids/names; yard zones come from
     site.json (Derive.data.site.zones) at runtime, with a static fallback so
     the picker works even before site.json loads. All free text is still
     accepted — this just lets the location tie to a real room/zone by name. */
  var ROOMS = [
    { id:'bathG',    he:'חֲדַר רַחְצָה (קוֹמַת קַרְקַע)', floor:'קַרְקַע' },
    { id:'kitchen',  he:'מִטְבָּח',                       floor:'קַרְקַע' },
    { id:'living',   he:'סָלוֹן',                          floor:'קַרְקַע' },
    { id:'bedroomG', he:'חֲדַר שֵׁנָה (קַרְקַע)',          floor:'קַרְקַע' },
    { id:'pantry',   he:'מַזְוֶה',                         floor:'קַרְקַע' },
    { id:'stairsG',  he:'מַדְרֵגוֹת',                      floor:'קַרְקַע' },
    { id:'bedroomSW',he:'חֲדַר שֵׁנָה (דָּרוֹם)',          floor:'עֶלְיוֹנָה' },
    { id:'bedroomNE',he:'חֲדַר שֵׁנָה (צָפוֹן)',           floor:'עֶלְיוֹנָה' },
    { id:'terrace',  he:'מִרְפֶּסֶת',                      floor:'עֶלְיוֹנָה' },
    { id:'bathU',    he:'חֲדַר רַחְצָה (עֶלְיוֹנָה)',      floor:'עֶלְיוֹנָה' },
    { id:'landing',  he:'גֶּרֶם הַמַּדְרֵגוֹת',            floor:'עֶלְיוֹנָה' }
  ];
  var ZONE_FALLBACK = [
    { id:'backyard', he:'הֶחָצֵר הָאֲחוֹרִית' },
    { id:'balcony',  he:'מִרְפֶּסֶת קוֹמָה רִאשׁוֹנָה' },
    { id:'front',    he:'חֲזִית הַבַּיִת' }
  ];
  function zones(){
    var D = window.Derive, zs = (D && D.data && D.data.site && D.data.site.zones) || null;
    if (zs && zs.length) return zs.map(function(z){ return { id:z.id, he:z.name_he || z.id }; });
    return ZONE_FALLBACK;
  }
  // place id (room or zone) → its Hebrew name, for showing alongside a free-text location.
  function placeHe(id){
    if (!id) return '';
    var r = ROOMS.find(function(x){ return x.id===id; });
    if (r) return r.he;
    var z = zones().find(function(x){ return x.id===id; });
    return z ? z.he : '';
  }

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  /* ===========================================================================
   * STORE — prefer window.LogStore('inventory'); else a private LS store with
   * the SAME record shape. Both go through sanitizePhoto so an oversized photo
   * is dropped (never throws / never blows the localStorage quota).
   * ======================================================================== */
  var LS  = function(k){ try { return JSON.parse(localStorage.getItem(k)) || []; } catch(e){ return []; } };
  var save = function(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} };
  function newId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function sanitizePhoto(p){
    if (window.LogStore && window.LogStore.sanitizePhoto) return window.LogStore.sanitizePhoto(p);
    if (typeof p !== 'string' || !p) return null;
    if (!/^data:image\//.test(p)) return null;
    if (p.length > PHOTO_CAP) return null;
    return p;
  }
  function hasLogStore(){ return !!(window.LogStore && window.LogStore.add && window.LogStore.list); }

  function listItems(){
    if (hasLogStore()) return window.LogStore.list(COLL) || [];
    return LS(LS_KEY);
  }
  function addItem(rec){
    if (hasLogStore()) return window.LogStore.add(COLL, rec);
    var a = LS(LS_KEY);
    var out = { id:newId(), t:new Date().toISOString(), d:new Date().toLocaleDateString('he-IL') };
    Object.keys(rec||{}).forEach(function(k){ out[k] = rec[k]; });
    if (out.photo != null){ var ph = sanitizePhoto(out.photo); if (ph) out.photo = ph; else delete out.photo; }
    a.unshift(out); save(LS_KEY, a); return out;
  }
  function updateItem(id, patch){
    if (hasLogStore()) return window.LogStore.update(COLL, id, patch);
    var a = LS(LS_KEY), hit = null;
    for (var i=0;i<a.length;i++){
      if (a[i] && a[i].id === id){
        var p = {}; Object.keys(patch||{}).forEach(function(k){ p[k] = patch[k]; });
        if ('photo' in p){ var ph = sanitizePhoto(p.photo); if (ph) p.photo = ph; else delete p.photo; }
        a[i] = Object.assign({}, a[i], p, { id:a[i].id }); hit = a[i]; break;
      }
    }
    if (hit) save(LS_KEY, a);
    return hit;
  }
  function removeItem(id){
    if (hasLogStore()) return window.LogStore.remove(COLL, id);
    var a = LS(LS_KEY), next = a.filter(function(r){ return !(r && r.id === id); });
    var changed = next.length !== a.length;
    if (changed) save(LS_KEY, next);
    return changed;
  }

  /* the human-readable location string for an item: prefer free-text `location`,
     fall back to the canonical room/zone name. Both may be present (free text =
     the precise box/shelf, room = the containing space). */
  function itemPlace(it){
    var loc = (it.location || '').trim();
    var rm  = placeHe(it.room);
    if (loc && rm && loc !== rm) return loc + ' · ' + rm;
    return loc || rm || 'לֹא צֻיַּן';
  }
  // a single grouping key for browse-by-location (so "מחסן" items cluster even
  // when one also tagged a room): prefer the canonical room name, else free text.
  function groupKey(it){
    var rm = placeHe(it.room);
    if (rm) return rm;
    var loc = (it.location || '').trim();
    return loc || 'לְלֹא מִקּוּם';
  }

  /* ===========================================================================
   * PHOTO — canvas downscale to ≤~maxPx then JPEG, shrinking quality until the
   * dataURL fits PHOTO_CAP (mirrors the מוח/garden add-form pattern).
   * ======================================================================== */
  function downscalePhoto(file, cb){
    if (!file || !/^image\//.test(file.type)) { cb(null); return; }
    var reader = new FileReader();
    reader.onload = function(){
      var img = new Image();
      img.onload = function(){
        try {
          var maxPx = 900;
          var w = img.width, h = img.height;
          if (w > h && w > maxPx){ h = Math.round(h * maxPx / w); w = maxPx; }
          else if (h >= w && h > maxPx){ w = Math.round(w * maxPx / h); h = maxPx; }
          var c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          var q = 0.82, url = c.toDataURL('image/jpeg', q);
          while (url.length > PHOTO_CAP && q > 0.3){ q -= 0.12; url = c.toDataURL('image/jpeg', q); }
          cb(url.length <= PHOTO_CAP ? url : null);
        } catch (e){ cb(null); }
      };
      img.onerror = function(){ cb(null); };
      img.src = reader.result;
    };
    reader.onerror = function(){ cb(null); };
    reader.readAsDataURL(file);
  }

  /* ===========================================================================
   * VIEW
   * ======================================================================== */
  var _host = null, _wired = false, _query = '', _mode = 'loc', _editId = null;
  var _draftPhoto = null;            // pending downscaled photo dataURL for the add/edit form
  var _formOpen = false;

  function thumb(it){
    if (it.photo) return '<span class="inv-th"><img src="' + esc(it.photo) + '" alt="" loading="lazy"></span>';
    return '<span class="inv-th inv-emoji">' + catEmoji(it.category) + '</span>';
  }

  // one compact item row (browse lists). Shows name + qty + location chip.
  function itemRow(it){
    var qty = (it.quantity != null && it.quantity !== '' && +it.quantity !== 1)
      ? '<span class="inv-qty">×' + esc(it.quantity) + '</span>' : '';
    return '<div class="inv-row" data-item="' + esc(it.id) + '" role="button" tabindex="0" title="פְּרָטִים / עֲרִיכָה">' +
      thumb(it) +
      '<span class="inv-n">' + esc(it.name || '(לְלֹא שֵׁם)') + qty + '</span>' +
      '<span class="inv-loc">📍 ' + esc(itemPlace(it)) + '</span>' +
      '<span class="inv-go" aria-hidden="true">→</span></div>';
  }

  // the BIG search result — location front-and-center ("where is X").
  function searchHit(it){
    var qty = (it.quantity != null && it.quantity !== '' && +it.quantity !== 1)
      ? ' <span class="inv-qty">×' + esc(it.quantity) + '</span>' : '';
    return '<div class="inv-hit" data-item="' + esc(it.id) + '" role="button" tabindex="0">' +
      thumb(it) +
      '<div class="inv-hitmain">' +
        '<div class="inv-hitname">' + esc(it.name || '(לְלֹא שֵׁם)') + qty + '</div>' +
        '<div class="inv-hitloc">📍 ' + esc(itemPlace(it)) + '</div>' +
        (it.category ? '<div class="inv-hitcat">' + catEmoji(it.category) + ' ' + esc(catHe(it.category)) + '</div>' : '') +
        (it.notes ? '<div class="inv-hitnotes">' + esc(it.notes) + '</div>' : '') +
      '</div>' +
      '<span class="inv-go" aria-hidden="true">↗</span></div>';
  }

  function matches(it, q){
    var ql = q.toLowerCase();
    return (it.name && it.name.toLowerCase().indexOf(ql) !== -1) ||
           (it.location && it.location.toLowerCase().indexOf(ql) !== -1) ||
           (placeHe(it.room) && placeHe(it.room).indexOf(q) !== -1) ||
           (it.notes && it.notes.toLowerCase().indexOf(ql) !== -1) ||
           (it.category && catHe(it.category).indexOf(q) !== -1);
  }

  /* ---- the add / edit FORM (inline panel) -------------------------------- */
  function formHtml(){
    var it = _editId ? listItems().find(function(x){ return x.id === _editId; }) : null;
    it = it || {};
    var ph = _draftPhoto || it.photo || '';
    var roomOpts = '<option value="">— בְּחַר חֶדֶר / אֵזוֹר (לֹא חוֹבָה) —</option>';
    roomOpts += '<optgroup label="חֲדָרִים — קוֹמַת קַרְקַע">';
    ROOMS.filter(function(r){ return r.floor==='קַרְקַע'; }).forEach(function(r){
      roomOpts += '<option value="' + esc(r.id) + '"' + (it.room===r.id?' selected':'') + '>' + esc(r.he) + '</option>'; });
    roomOpts += '</optgroup><optgroup label="חֲדָרִים — קוֹמָה עֶלְיוֹנָה">';
    ROOMS.filter(function(r){ return r.floor==='עֶלְיוֹנָה'; }).forEach(function(r){
      roomOpts += '<option value="' + esc(r.id) + '"' + (it.room===r.id?' selected':'') + '>' + esc(r.he) + '</option>'; });
    roomOpts += '</optgroup><optgroup label="חָצֵר">';
    zones().forEach(function(z){
      roomOpts += '<option value="' + esc(z.id) + '"' + (it.room===z.id?' selected':'') + '>' + esc(z.he) + '</option>'; });
    roomOpts += '</optgroup>';
    var catOpts = CATS.map(function(c){
      return '<option value="' + c.k + '"' + (it.category===c.k?' selected':'') + '>' + c.emoji + ' ' + c.he + '</option>';
    }).join('');

    return '<div class="inv-form" data-form="1">' +
      '<div class="inv-formhd">' + (_editId ? '✏️ עֲרִיכַת פָּרִיט' : '➕ פָּרִיט חָדָשׁ') + '</div>' +
      '<label class="inv-lbl">שֵׁם <span class="req">*</span></label>' +
      '<input class="inv-in" data-f="name" value="' + esc(it.name||'') + '" placeholder="מָה אֲנִי מְאַחְסֵן? (לְמָשָׁל: מַקְדֵּחָה)">' +
      '<div class="inv-frow">' +
        '<div class="inv-fcol"><label class="inv-lbl">מִקּוּם (תֵּבָה / מַדָּף / חֶדֶר)</label>' +
          '<input class="inv-in" data-f="location" value="' + esc(it.location||'') + '" placeholder="לְמָשָׁל: מַחְסָן · תֵּבָה 3 · מַדָּף עֶלְיוֹן"></div>' +
        '<div class="inv-fcol inv-qtycol"><label class="inv-lbl">כַּמּוּת</label>' +
          '<input class="inv-in" data-f="quantity" type="number" min="0" step="1" value="' + esc(it.quantity!=null?it.quantity:'') + '" placeholder="1"></div>' +
      '</div>' +
      '<label class="inv-lbl">קַשֵּׁר לְחֶדֶר / אֵזוֹר בַּבַּיִת (לֹא חוֹבָה)</label>' +
      '<select class="inv-in inv-sel" data-f="room">' + roomOpts + '</select>' +
      '<label class="inv-lbl">קָטֶגוֹרְיָה</label>' +
      '<select class="inv-in inv-sel" data-f="category">' + catOpts + '</select>' +
      '<label class="inv-lbl">הֶעָרוֹת</label>' +
      '<textarea class="inv-in inv-ta" data-f="notes" rows="2" placeholder="פְּרָטִים, מַצָּב, הִשְׁאַלְתִּי לְמִישֶׁהוּ…">' + esc(it.notes||'') + '</textarea>' +
      '<label class="inv-lbl">תְּמוּנָה (לֹא חוֹבָה)</label>' +
      '<div class="inv-photorow">' +
        (ph ? '<span class="inv-thumb-lg"><img src="' + esc(ph) + '" alt=""></span>' : '<span class="inv-thumb-lg inv-emoji">📷</span>') +
        '<label class="inv-btn inv-photobtn">בְּחַר תְּמוּנָה<input type="file" accept="image/*" data-photo="1" hidden></label>' +
        (ph ? '<button class="inv-btn inv-del" data-photo-clear="1">הָסֵר</button>' : '') +
      '</div>' +
      '<div class="inv-formacts">' +
        '<button class="inv-btn inv-primary" data-save="1">' + (_editId ? 'שְׁמֹר שִׁנּוּיִים' : 'הוֹסֵף לַמַּחְסָן') + '</button>' +
        '<button class="inv-btn" data-cancel="1">בִּטּוּל</button>' +
        (_editId ? '<button class="inv-btn inv-del" data-delete="' + esc(_editId) + '">מְחַק</button>' : '') +
      '</div>' +
      '<div class="inv-formfoot">הַתְּמוּנָה נִשְׁמֶרֶת מְכֻוֶּצֶת (≤~280KB) בָּאַחְסוּן הַמְּקוֹמִי שֶׁל הַמַּכְשִׁיר בִּלְבָד.</div>' +
    '</div>';
  }

  function render(){
    if (!_host) return;
    ensureCSS();
    var items = listItems();
    var q = _query.trim();

    var html = '<h3>הַמַּחְסָן · אֵיפֹה שַׂמְתִּי אֶת זֶה</h3>' +
      '<div class="sub">חַפֵּשׂ פָּרִיט — וְהַמִּקּוּם שֶׁלּוֹ יִקְפֹּץ. אוֹ עַיֵּן לְפִי מָקוֹם / קָטֶגוֹרְיָה.</div>' +
      '<input class="inv-q" placeholder="🔍 אֵיפֹה ה… (שֵׁם פָּרִיט / מָקוֹם)" value="' + esc(_query) + '">';

    // ---- SEARCH (the core feature): location is the headline of each hit ----
    if (q){
      var hits = items.filter(function(it){ return matches(it, q); });
      html += '<div class="inv-sec">תּוֹצָאוֹת · ' + hits.length + '</div>';
      html += hits.length ? hits.map(searchHit).join('')
                          : '<div class="inv-empty">אֵין פָּרִיט תּוֹאֵם. אוּלַי עוֹד לֹא הוֹסַפְתָּ אוֹתוֹ?</div>';
      html += '<div class="inv-foot">' + items.length + ' פְּרִיטִים בַּמַּחְסָן · מְאֻחְסָן עַל הַמַּכְשִׁיר (localStorage)</div>';
      _host.innerHTML = html;
      return;
    }

    // ---- add button + the inline form (when open) ----
    html += '<div class="inv-toolbar">' +
      '<button class="inv-btn inv-primary inv-add" data-addopen="1">➕ הוֹסֵף פָּרִיט</button>' +
      '<div class="inv-modes">' +
        '<button class="inv-mode' + (_mode==='loc'?' on':'') + '" data-mode="loc">לְפִי מָקוֹם</button>' +
        '<button class="inv-mode' + (_mode==='cat'?' on':'') + '" data-mode="cat">לְפִי קָטֶגוֹרְיָה</button>' +
      '</div></div>';
    if (_formOpen) html += formHtml();

    if (!items.length){
      html += '<div class="inv-empty inv-empty-big">📦 הַמַּחְסָן רֵיק עֲדַיִן.<br>הוֹסֵף פָּרִיט רִאשׁוֹן — וְתָמִיד תֵּדַע אֵיפֹה שַׂמְתָּ אוֹתוֹ.</div>';
      html += '<div class="inv-foot">מְאֻחְסָן עַל הַמַּכְשִׁיר (localStorage)</div>';
      _host.innerHTML = html;
      return;
    }

    if (_mode === 'loc'){
      // group by location (canonical room name, else free text)
      var groups = {};
      items.forEach(function(it){ var k = groupKey(it); (groups[k] = groups[k] || []).push(it); });
      var keys = Object.keys(groups).sort(function(a,b){ return b==='לְלֹא מִקּוּם' ? -1 : (groups[b].length - groups[a].length); });
      html += '<div class="inv-sec">עִיּוּן לְפִי מָקוֹם · ' + keys.length + ' מְקוֹמוֹת</div>';
      keys.forEach(function(k){
        html += '<div class="inv-grp">📍 ' + esc(k) + ' <span class="cnt">' + groups[k].length + '</span></div>';
        html += groups[k].map(itemRow).join('');
      });
    } else {
      // group by category, in the CATS order, with an "other" bucket last
      html += '<div class="inv-sec">עִיּוּן לְפִי קָטֶגוֹרְיָה</div>';
      var seen = {};
      CATS.forEach(function(c){
        var inC = items.filter(function(it){ return (it.category||'other') === c.k; });
        if (!inC.length) return;
        inC.forEach(function(it){ seen[it.id] = 1; });
        html += '<div class="inv-grp">' + c.emoji + ' ' + c.he + ' <span class="cnt">' + inC.length + '</span></div>';
        html += inC.map(itemRow).join('');
      });
      var rest = items.filter(function(it){ return !seen[it.id]; });
      if (rest.length){
        html += '<div class="inv-grp">📦 ' + catHe('other') + ' <span class="cnt">' + rest.length + '</span></div>';
        html += rest.map(itemRow).join('');
      }
    }

    html += '<div class="inv-foot">' + items.length + ' פְּרִיטִים · מְאֻחְסָן עַל הַמַּכְשִׁיר (localStorage). תְּמוּנוֹת מְכֻוָּצוֹת.</div>';
    _host.innerHTML = html;
  }

  /* ---- read the form fields into a record ---- */
  function readForm(){
    var form = _host.querySelector('[data-form]'); if (!form) return null;
    function v(f){ var e = form.querySelector('[data-f="'+f+'"]'); return e ? e.value : ''; }
    var rec = {
      name: (v('name')||'').trim(),
      location: (v('location')||'').trim(),
      room: v('room')||'',
      quantity: (v('quantity')||'').trim(),
      category: v('category')||'other',
      notes: (v('notes')||'').trim()
    };
    var ph = _draftPhoto;
    if (ph != null) rec.photo = ph;     // new/changed photo
    return rec;
  }

  function onClick(e){
    var t = e.target;
    // open the add form
    if (t.closest && t.closest('[data-addopen]')){ _formOpen = true; _editId = null; _draftPhoto = null; render(); return; }
    if (t.closest && t.closest('[data-cancel]')){ _formOpen = false; _editId = null; _draftPhoto = null; render(); return; }
    // mode switch
    var md = t.closest && t.closest('[data-mode]');
    if (md){ _mode = md.getAttribute('data-mode'); render(); return; }
    // clear pending photo
    if (t.closest && t.closest('[data-photo-clear]')){ _draftPhoto = ''; render(); return; }
    // save
    if (t.closest && t.closest('[data-save]')){
      var rec = readForm();
      if (!rec || !rec.name){ var box = _host.querySelector('[data-f="name"]'); if (box){ box.focus(); box.classList.add('inv-err'); } return; }
      // when editing, only send photo if it changed (_draftPhoto !== null)
      if (_editId){
        var patch = { name:rec.name, location:rec.location, room:rec.room, quantity:rec.quantity, category:rec.category, notes:rec.notes };
        if (_draftPhoto !== null) patch.photo = _draftPhoto;   // '' clears, dataURL sets
        updateItem(_editId, patch);
      } else {
        addItem(rec);
      }
      _formOpen = false; _editId = null; _draftPhoto = null; render(); return;
    }
    // delete from form
    var del = t.closest && t.closest('[data-delete]');
    if (del){ removeItem(del.getAttribute('data-delete')); _formOpen = false; _editId = null; _draftPhoto = null; render(); return; }
    // open an item → edit form
    var row = t.closest && (t.closest('[data-item]'));
    if (row){ _editId = row.getAttribute('data-item'); _formOpen = true; _draftPhoto = null; render(); return; }
  }

  function onChange(e){
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-photo') === '1'){
      var file = t.files && t.files[0];
      downscalePhoto(file, function(url){
        _draftPhoto = url || null;
        if (url == null){ /* unusable image — leave any existing photo untouched */ _draftPhoto = null; }
        render();
      });
    }
  }

  function render2(host, date){     // public render(hostEl, date)
    if (!host) return;
    ensureCSS();
    _host = host;
    // the CSS is scoped to #inv-host; claim that id on our host so the skin
    // applies (the integrator just hands us an empty container). If the page
    // somehow already has a #inv-host elsewhere we still set it on ours — we
    // own this host for the lifetime of the tab.
    if (host.id !== 'inv-host') host.id = 'inv-host';
    if (!_wired || host.__invWired !== true){
      host.__invWired = true; _wired = true;
      host.addEventListener('click', onClick);
      host.addEventListener('change', onChange);
      // search: rebuild + restore caret/focus (innerHTML replaces the input)
      host.addEventListener('input', function(e){
        if (!e.target.classList || !e.target.classList.contains('inv-q')) return;
        var caret = e.target.selectionStart; _query = e.target.value; render();
        var box = host.querySelector('.inv-q'); if (box){ box.focus(); try{ box.setSelectionRange(caret, caret); }catch(_){} }
      });
      // keyboard: Enter/Space on a row opens it
      host.addEventListener('keydown', function(e){
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var row = e.target.closest && e.target.closest('[data-item]');
        if (row){ e.preventDefault(); _editId = row.getAttribute('data-item'); _formOpen = true; _draftPhoto = null; render(); }
      });
    }
    render();
  }

  /* ===========================================================================
   * CSS — scoped #inv-host, the #inst brass-on-glass language.
   * ======================================================================== */
  function ensureCSS(){
    if (document.getElementById('inventory-css')) return;
    var s = document.createElement('style');
    s.id = 'inventory-css';
    s.textContent =
      '#inv-host{direction:rtl;font-family:Heebo,sans-serif;color:#efe6cf}' +
      '#inv-host h3{font-family:"Frank Ruhl Libre",serif;font-weight:500;font-size:19px;color:#fff7e6;margin:0 0 2px}' +
      '#inv-host .sub{color:#a99b78;font-size:12px;margin-bottom:8px;line-height:1.5}' +
      '#inv-host .inv-q{width:100%;margin:4px 0 8px;padding:9px 12px;background:rgba(255,255,255,.05);' +
        'border:1px solid rgba(202,161,90,.34);border-radius:9px;color:#f4eddc;font-family:Heebo;font-size:14px;direction:rtl}' +
      '#inv-host .inv-q::placeholder{color:#8a8068}' +
      '#inv-host .inv-q:focus{outline:none;border-color:rgba(202,161,90,.65);background:rgba(255,255,255,.07)}' +
      // toolbar
      '#inv-host .inv-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0 4px;flex-wrap:wrap}' +
      '#inv-host .inv-modes{display:flex;gap:4px}' +
      '#inv-host .inv-mode{padding:5px 11px;border-radius:20px;font-size:11.5px;font-family:Heebo;cursor:pointer;' +
        'background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.22);color:#cdbf9b}' +
      '#inv-host .inv-mode.on{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;font-weight:600;border-color:transparent}' +
      // section headers + groups
      '#inv-host .inv-sec{margin:14px 0 4px;color:' + GOLD + ';font-family:Bellefair,serif;font-size:13px;' +
        'letter-spacing:.03em;border-top:1px solid rgba(202,161,90,.15);padding-top:9px}' +
      '#inv-host .inv-grp{margin:11px 0 3px;color:#ddd0ab;font-size:12.5px;font-family:Heebo;font-weight:600}' +
      '#inv-host .inv-grp .cnt{color:#a99b78;font-size:11px;font-weight:400;margin-inline-start:4px}' +
      // item rows
      '#inv-host .inv-row{display:flex;align-items:center;gap:8px;padding:6px 7px;border-radius:8px;cursor:pointer;' +
        'border:1px solid transparent;transition:background .12s,border-color .12s}' +
      '#inv-host .inv-row:hover{background:rgba(202,161,90,.08);border-color:rgba(202,161,90,.25)}' +
      '#inv-host .inv-th{width:32px;height:32px;flex:0 0 32px;border-radius:7px;overflow:hidden;display:flex;' +
        'align-items:center;justify-content:center;background:rgba(255,255,255,.05);font-size:17px}' +
      '#inv-host .inv-th img{width:100%;height:100%;object-fit:cover;display:block}' +
      '#inv-host .inv-n{flex:1;min-width:0;color:#ece6d8;font-size:13px;font-family:Heebo;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#inv-host .inv-qty{color:#a99b78;font-size:11px;margin-inline-start:5px}' +
      '#inv-host .inv-loc{color:#9b927a;font-size:10.5px;font-family:Heebo;flex:0 0 auto;max-width:42%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#inv-host .inv-go{color:' + GOLD + ';font-size:14px;opacity:.6;flex:0 0 auto}' +
      '#inv-host .inv-row:hover .inv-go{opacity:1}' +
      // BIG search hit
      '#inv-host .inv-hit{display:flex;align-items:flex-start;gap:11px;padding:11px;margin:7px 0;border-radius:11px;cursor:pointer;' +
        'background:linear-gradient(160deg,rgba(202,161,90,.1),rgba(255,255,255,.03));' +
        'border:1px solid rgba(202,161,90,.32);transition:.14s}' +
      '#inv-host .inv-hit:hover{border-color:rgba(202,161,90,.6);background:linear-gradient(160deg,rgba(202,161,90,.16),rgba(255,255,255,.05))}' +
      '#inv-host .inv-hit .inv-th{width:46px;height:46px;flex:0 0 46px;font-size:22px}' +
      '#inv-host .inv-hitmain{flex:1;min-width:0}' +
      '#inv-host .inv-hitname{color:#fff7e6;font-size:15px;font-weight:600;font-family:Heebo}' +
      '#inv-host .inv-hitloc{color:' + GOLD + ';font-size:14px;font-family:Heebo;margin-top:3px;font-weight:500}' +
      '#inv-host .inv-hitcat{color:#a99b78;font-size:11px;font-family:Heebo;margin-top:2px}' +
      '#inv-host .inv-hitnotes{color:#cabd9a;font-size:11.5px;font-family:Heebo;margin-top:4px;line-height:1.5}' +
      // empty / states
      '#inv-host .inv-empty{color:#9b927a;font-size:12.5px;font-family:Heebo;padding:10px 4px}' +
      '#inv-host .inv-empty-big{text-align:center;padding:26px 12px;line-height:1.8;color:#cdbf9b;' +
        'border:1px dashed rgba(202,161,90,.28);border-radius:12px;margin:12px 0;background:rgba(255,255,255,.02)}' +
      // buttons
      '#inv-host .inv-btn{padding:8px 13px;border-radius:9px;font-family:Heebo;font-size:12.5px;cursor:pointer;' +
        'background:rgba(255,255,255,.05);border:1px solid rgba(202,161,90,.3);color:#e7dcc0;transition:.14s}' +
      '#inv-host .inv-btn:hover{background:rgba(202,161,90,.16);border-color:rgba(202,161,90,.55)}' +
      '#inv-host .inv-primary{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;font-weight:600;border-color:transparent}' +
      '#inv-host .inv-primary:hover{background:linear-gradient(#d8b25a,#b08a3e)}' +
      '#inv-host .inv-del{color:#e8b0b0;border-color:rgba(210,120,120,.4);background:rgba(210,120,120,.1)}' +
      '#inv-host .inv-del:hover{background:rgba(210,120,120,.2)}' +
      // FORM
      '#inv-host .inv-form{margin:8px 0 12px;padding:13px 14px;border-radius:12px;' +
        'background:linear-gradient(160deg,rgba(12,14,26,.7),rgba(6,7,15,.78));border:1px solid rgba(202,161,90,.26)}' +
      '#inv-host .inv-formhd{font-family:Bellefair,serif;font-size:14px;color:' + GOLD + ';margin-bottom:8px}' +
      '#inv-host .inv-lbl{display:block;color:#bdb091;font-size:11px;font-family:Heebo;margin:9px 0 3px}' +
      '#inv-host .inv-lbl .req{color:#e0b24a}' +
      '#inv-host .inv-in{width:100%;padding:7px 10px;background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.26);' +
        'border-radius:8px;color:#f2ead8;font-family:Heebo;font-size:13px;direction:rtl;box-sizing:border-box}' +
      '#inv-host .inv-in:focus{outline:none;border-color:rgba(202,161,90,.6)}' +
      '#inv-host .inv-in.inv-err{border-color:rgba(224,120,120,.7)}' +
      '#inv-host .inv-sel{appearance:none;-webkit-appearance:none;cursor:pointer}' +
      '#inv-host .inv-ta{resize:vertical;min-height:42px}' +
      '#inv-host .inv-frow{display:flex;gap:9px}' +
      '#inv-host .inv-fcol{flex:1;min-width:0}' +
      '#inv-host .inv-qtycol{flex:0 0 86px}' +
      '#inv-host .inv-photorow{display:flex;align-items:center;gap:10px;margin-top:3px}' +
      '#inv-host .inv-thumb-lg{width:54px;height:54px;flex:0 0 54px;border-radius:9px;overflow:hidden;display:flex;' +
        'align-items:center;justify-content:center;background:rgba(255,255,255,.05);font-size:24px;border:1px solid rgba(202,161,90,.2)}' +
      '#inv-host .inv-thumb-lg img{width:100%;height:100%;object-fit:cover;display:block}' +
      '#inv-host .inv-photobtn{position:relative;overflow:hidden}' +
      '#inv-host .inv-formacts{display:flex;gap:8px;margin-top:13px;flex-wrap:wrap}' +
      '#inv-host .inv-formfoot{margin-top:9px;font-size:9.5px;color:#8a7a52;font-family:Heebo;line-height:1.5}' +
      // footer
      '#inv-host .inv-foot{margin-top:14px;padding-top:9px;border-top:1px solid rgba(202,161,90,.13);' +
        'font-size:9.5px;color:#8a7a52;font-family:Heebo;line-height:1.5}' +
      '#inv-host .inv-emoji{filter:grayscale(.1)}' +
      // select dropdown readability on dark
      '#inv-host .inv-sel option,#inv-host .inv-sel optgroup{background:#14131f;color:#efe6cf}' +
      // ---- MOBILE (phone) — keep everything on-screen, comfy tap targets ----
      '@media(max-width:760px){' +
        '#inv-host h3{font-size:18px}' +
        '#inv-host .sub{font-size:11.5px}' +
        '#inv-host .inv-q{font-size:16px;padding:11px 12px}' +    // 16px avoids iOS zoom-on-focus
        // toolbar: add button full-width, modes strip wraps below
        '#inv-host .inv-toolbar{gap:6px}' +
        '#inv-host .inv-add{flex:1 1 100%;text-align:center;padding:11px 13px}' +
        '#inv-host .inv-modes{flex:1 1 100%;justify-content:center}' +
        '#inv-host .inv-mode{flex:1 1 0;text-align:center;padding:9px 10px;font-size:12px;min-height:34px}' +
        // item rows: a touch more padding, give the location chip more room
        '#inv-host .inv-row{padding:8px 7px;gap:7px}' +
        '#inv-host .inv-loc{max-width:46%;font-size:11px}' +
        '#inv-host .inv-go{font-size:16px;opacity:.85}' +
        // BIG search hit
        '#inv-host .inv-hit{padding:12px;gap:10px}' +
        '#inv-host .inv-hitname{font-size:15px}' +
        // FORM: trim padding, stack the location/qty row, full-width tap-friendly inputs
        '#inv-host .inv-form{padding:12px 11px}' +
        '#inv-host .inv-frow{flex-wrap:wrap;gap:8px}' +
        '#inv-host .inv-fcol{flex:1 1 100%}' +
        '#inv-host .inv-qtycol{flex:1 1 100%}' +
        '#inv-host .inv-in{font-size:16px;padding:9px 10px}' +    // 16px avoids iOS zoom-on-focus
        '#inv-host .inv-photorow{flex-wrap:wrap}' +
        // form action buttons: comfortable, full-width-ish hit areas
        '#inv-host .inv-formacts{gap:7px}' +
        '#inv-host .inv-btn{padding:10px 13px;font-size:13px;min-height:38px}' +
        '#inv-host .inv-primary{flex:1 1 100%;text-align:center}' +
      '}';
    document.head.appendChild(s);
  }

  window.__inventory = {
    render: render2,
    // small surface for tests / integration
    _items: listItems,
    _placeHe: placeHe,
    _coll: COLL
  };
})();
