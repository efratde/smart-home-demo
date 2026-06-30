/* ===========================================================================
 * community.js · "הבית של אלכס" — אֲנָשִׁים, שְׁכֵנִים וְקֶשֶׁר (community hub)
 * ---------------------------------------------------------------------------
 * The קְהִילָה tab: a self-contained people / neighbors / connections /
 * community board, rendered INTO a host element (no floating card — the
 * integrator mounts this whole module as a dashboard tab).
 *
 *   window.__community.render(hostEl, date)
 *
 * Three sub-views (chip-switched, like panels.js's "second brain"):
 *   1) אֲנָשִׁים  — a people DIRECTORY (name · relation/role · phone · notes
 *                  · optional photo). Backed by LogStore collections
 *                  'contacts' + 'neighbors' (unified into one list; each row
 *                  remembers which collection it lives in so edit/delete hit
 *                  the right store). 'contacts' is a NEW collection key —
 *                  LogStore.add/list/update/remove create it on first use.
 *   2) פְּרוֹיֶקְטִים — social / community PROJECTS tracker (collection 'projects',
 *                  reused) with a status (רַעְיוֹן/פָּעִיל/הֻשְׁלַם/מֻשְׁהֶה) and a
 *                  free-text collaborators field ("מי איתי").
 *   3) קֶשֶׁר     — a simple relationship / notes view that connects people:
 *                  pick a person, jot a short note about who-knows-whom or a
 *                  shared thread; notes are tagged with the person's name so
 *                  the directory and the connection notes stay linked.
 *
 * All CRUD is self-contained (add newest-first / edit / delete) on top of the
 * FROZEN window.LogStore interface — this file NEVER edits log_store.js. Photo
 * attach reuses the canvas-downscale → ≤280KB dataURL pattern (LogStore caps &
 * sanitises on write). RTL Hebrew, the #inst brass-on-glass language, scoped to
 * #community-hub so it never touches shared selectors. Degrades gracefully:
 * empty collections show a friendly empty-state, and if LogStore is absent the
 * view says so instead of throwing.
 *
 * HONESTY: this is a personal, on-device address-book / board. Nothing here is
 * a sensor or a feed — it's only what Alex types in, stored in localStorage on
 * this device (no server, no push). Stated plainly in the footer.
 * ======================================================================== */
(function () {
  'use strict';
  if (window.__community) return;

  var GOLD = '#caa15a';

  /* ---- tiny helpers (house idioms) ------------------------------------- */
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function el(tag, cls, html){ var e=document.createElement(tag); if(cls)e.className=cls; if(html!=null)e.innerHTML=html; return e; }
  function LS(){ return window.LogStore || null; }

  /* the directory unifies these two collections. 'contacts' is created on
     first add(); 'neighbors' already exists (shared in the מוח tab). */
  var DIR_COLLS = ['contacts','neighbors'];
  var COLL_HE   = { contacts:'אִישׁ קֶשֶׁר', neighbors:'שָׁכֵן' };

  /* relation presets for the people add-form (free text still allowed). */
  var RELATIONS = ['שָׁכֵן','חָבֵר','מִשְׁפָּחָה','עֲבוֹדָה','שֵׁרוּת / בַּעַל מִקְצוֹעַ','קְהִילָה','אַחֵר'];

  /* project status vocabulary + pill colour class. */
  var STATUSES = [
    { k:'idea',   he:'רַעְיוֹן',  cls:'blue'  },
    { k:'active', he:'פָּעִיל',   cls:'green' },
    { k:'paused', he:'מֻשְׁהֶה',  cls:'amber' },
    { k:'done',   he:'הֻשְׁלַם',  cls:'gold'  }
  ];
  function statusMeta(k){ for(var i=0;i<STATUSES.length;i++) if(STATUSES[i].k===k) return STATUSES[i]; return STATUSES[0]; }

  /* module state */
  var _host = null, _wiredHost = null;
  var VIEW = 'people';                 // people | projects | links
  var _photo = null;                   // staged dataURL for the next person add
  var _editId = null, _editColl = null;// person currently being edited (inline)
  var _linksPerson = '';               // selected person name for the קשר note form

  /* =====================================================================
   * photo downscale → ~800px JPEG dataURL (self-contained canvas fallback;
   * prefers the shared GardenID.downscale if present, exactly like panels.js).
   * LogStore.sanitizePhoto then validates + caps it on write. ================ */
  function downscale(file){
    if (window.GardenID && window.GardenID.downscale){
      return window.GardenID.downscale(file, 800).then(function(r){ return r && r.dataUrl || null; }).catch(function(){ return null; });
    }
    return new Promise(function(resolve){
      if (!file){ resolve(null); return; }
      var url=null; try{ url=URL.createObjectURL(file); }catch(e){ url=null; }
      if (!url){ resolve(null); return; }
      var img=new Image();
      img.onload=function(){
        try{
          var w0=img.naturalWidth||img.width, h0=img.naturalHeight||img.height;
          if(!w0||!h0){ URL.revokeObjectURL(url); resolve(null); return; }
          var sc=Math.min(1,800/Math.max(w0,h0));
          var cv=document.createElement('canvas');
          cv.width=Math.max(1,Math.round(w0*sc)); cv.height=Math.max(1,Math.round(h0*sc));
          cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
          URL.revokeObjectURL(url);
          resolve(cv.toDataURL('image/jpeg',0.82));
        }catch(e){ try{URL.revokeObjectURL(url);}catch(_){ } resolve(null); }
      };
      img.onerror=function(){ try{URL.revokeObjectURL(url);}catch(_){ } resolve(null); };
      img.src=url;
    });
  }
  function capPhoto(durl){
    var s = LS();
    return (s && s.sanitizePhoto) ? s.sanitizePhoto(durl) : durl;
  }

  /* =====================================================================
   * DATA READS (defensive — never throw, degrade to []) =================== */
  function listDir(){
    var s = LS(); if(!s) return [];
    var out = [];
    DIR_COLLS.forEach(function(coll){
      var rows = [];
      try{ rows = s.list(coll) || []; }catch(e){ rows = []; }
      rows.forEach(function(r){ if(r) out.push(Object.assign({ _coll:coll }, r)); });
    });
    // newest-first across the merged set (each store is already newest-first;
    // merge by the ISO timestamp `t` LogStore stamps, falling back to id order).
    out.sort(function(a,b){ return String(b.t||'').localeCompare(String(a.t||'')); });
    return out;
  }
  function listProjects(){
    var s = LS(); if(!s) return [];
    try{ return s.list('projects') || []; }catch(e){ return []; }
  }
  // people the link-notes can reference: directory names (+ any name already
  // used on a project's collaborators, kept simple = directory only here).
  function peopleNames(){
    var seen={}, names=[];
    listDir().forEach(function(p){ var n=(p.name||p.text||'').trim(); if(n && !seen[n]){ seen[n]=1; names.push(n); } });
    return names;
  }

  /* =====================================================================
   * VIEW 1 — PEOPLE DIRECTORY ============================================ */
  function relationOptions(sel){
    return RELATIONS.map(function(r){ return '<option value="'+esc(r)+'"'+(r===sel?' selected':'')+'>'+esc(r)+'</option>'; }).join('');
  }
  function collOptions(sel){
    return DIR_COLLS.map(function(c){ return '<option value="'+esc(c)+'"'+(c===sel?' selected':'')+'>'+esc(COLL_HE[c])+'</option>'; }).join('');
  }

  function personRow(p){
    var name = esc(p.name || p.text || '—');
    var rel  = p.relation ? esc(p.relation) : esc(COLL_HE[p._coll] || '');
    var phone= (p.phone||'').trim();
    var notes= (p.notes||'').trim();
    var thumb = p.photo
      ? '<span class="cm-av"><img src="'+p.photo+'" alt=""></span>'
      : '<span class="cm-av cm-av-e">'+(p._coll==='neighbors'?'🏠':'👤')+'</span>';
    var phoneHtml = phone
      ? '<a class="cm-tel" href="tel:'+esc(phone.replace(/[^\d+]/g,''))+'" title="חִיּוּג">📞 '+esc(phone)+'</a>'
      : '';
    return '<div class="cm-card" data-pid="'+esc(p.id)+'" data-coll="'+esc(p._coll)+'">'+
        '<div class="cm-top">'+thumb+
          '<div class="cm-id"><div class="cm-name">'+name+'</div>'+
            '<div class="cm-rel"><span class="cm-pill '+(p._coll==='neighbors'?'green':'blue')+'">'+rel+'</span></div></div>'+
          '<div class="cm-acts">'+
            '<span class="cm-mini" data-act="edit-person" title="עֲרֹךְ">✎</span>'+
            '<span class="cm-mini danger" data-act="del-person" title="מְחַק">🗑</span>'+
          '</div>'+
        '</div>'+
        (phoneHtml||notes ? '<div class="cm-body">'+phoneHtml+(notes?'<div class="cm-notes">'+esc(notes)+'</div>':'')+'</div>' : '')+
      '</div>';
  }

  function peopleHtml(){
    var dir = listDir();
    var staged = _photo ? '<div class="cm-staged">תְּמוּנָה מְצֹרֶפֶת ✓ — תִּשָּׁמֵר עִם הָרְשׁוּמָה הַבָּאָה</div>' : '';
    var photoBtn = '<button class="cm-photo'+(_photo?' set':'')+'" data-act="pick-photo" title="צָרֵף תְּמוּנָה">📷</button>'+
                   '<input class="cm-file" type="file" accept="image/*" style="display:none">';
    var form =
      '<div class="cm-form">'+
        '<div class="cm-frow"><input class="cm-in" data-f="name" placeholder="שֵׁם"></div>'+
        '<div class="cm-frow">'+
          '<select class="cm-sel" data-f="relation">'+relationOptions('שָׁכֵן')+'</select>'+
          '<select class="cm-sel" data-f="coll">'+collOptions('neighbors')+'</select>'+
        '</div>'+
        '<div class="cm-frow"><input class="cm-in" data-f="phone" inputmode="tel" placeholder="מִסְפַּר טֵלֵפוֹן (לֹא חוֹבָה)"></div>'+
        '<div class="cm-frow"><input class="cm-in" data-f="notes" placeholder="הֶעָרָה (אֵיךְ מַכִּירִים, מָה חָשׁוּב)"></div>'+
        '<div class="cm-frow cm-frow-end">'+photoBtn+'<button class="cm-btn" data-act="add-person">הוֹסֵף אִישׁ</button></div>'+
        staged+
      '</div>';
    var listHtml = dir.length
      ? dir.map(personRow).join('')
      : '<div class="cm-empty">עֲדַיִן אֵין אֲנָשִׁים בַּסְּפַר. הוֹסִיפוּ שָׁכֵן, חָבֵר אוֹ בַּעַל מִקְצוֹעַ לְמַעְלָה.</div>';
    return '<div class="cm-sec">הוֹסָפַת אִישׁ</div>'+form+
           '<div class="cm-sec">סְפַר הָאֲנָשִׁים <span class="cm-cnt">'+dir.length+'</span></div>'+
           '<div class="cm-list">'+listHtml+'</div>';
  }

  /* ---- inline edit overlay for one person ----------------------------- */
  function personEditHtml(p){
    return '<div class="cm-card editing" data-pid="'+esc(p.id)+'" data-coll="'+esc(p._coll)+'">'+
        '<div class="cm-sec sm">עֲרִיכַת אִישׁ</div>'+
        '<div class="cm-frow"><input class="cm-in" data-e="name" value="'+esc(p.name||p.text||'')+'" placeholder="שֵׁם"></div>'+
        '<div class="cm-frow">'+
          '<select class="cm-sel" data-e="relation">'+relationOptions(p.relation||'שָׁכֵן')+'</select>'+
          '<select class="cm-sel" data-e="coll">'+collOptions(p._coll)+'</select>'+
        '</div>'+
        '<div class="cm-frow"><input class="cm-in" data-e="phone" value="'+esc(p.phone||'')+'" inputmode="tel" placeholder="טֵלֵפוֹן"></div>'+
        '<div class="cm-frow"><input class="cm-in" data-e="notes" value="'+esc(p.notes||'')+'" placeholder="הֶעָרָה"></div>'+
        '<div class="cm-frow cm-frow-end">'+
          '<button class="cm-btn ghost" data-act="cancel-edit">בַּטֵּל</button>'+
          '<button class="cm-btn" data-act="save-edit">שְׁמֹר</button></div>'+
      '</div>';
  }

  /* =====================================================================
   * VIEW 2 — COMMUNITY / SOCIAL PROJECTS ================================= */
  function projectRow(p){
    var title = esc(p.title || p.text || '—');
    var sm = statusMeta(p.status || 'idea');
    var who = (p.collaborators||'').trim();
    var notes = (p.notes||'').trim();
    return '<div class="cm-card" data-prid="'+esc(p.id)+'">'+
        '<div class="cm-top">'+
          '<div class="cm-id"><div class="cm-name">'+title+'</div>'+
            '<div class="cm-rel"><span class="cm-pill '+sm.cls+'">'+esc(sm.he)+'</span>'+
              (who?'<span class="cm-who">👥 '+esc(who)+'</span>':'')+'</div></div>'+
          '<div class="cm-acts">'+
            '<span class="cm-mini" data-act="cycle-status" title="קַדֵּם סְטָטוּס">⟳</span>'+
            '<span class="cm-mini danger" data-act="del-project" title="מְחַק">🗑</span>'+
          '</div>'+
        '</div>'+
        (notes?'<div class="cm-body"><div class="cm-notes">'+esc(notes)+'</div></div>':'')+
      '</div>';
  }
  function projectsHtml(){
    var prj = listProjects();
    var statusOpts = STATUSES.map(function(s){ return '<option value="'+s.k+'">'+esc(s.he)+'</option>'; }).join('');
    var form =
      '<div class="cm-form">'+
        '<div class="cm-frow"><input class="cm-in" data-p="title" placeholder="שֵׁם הַפְּרוֹיֶקְט / הַיֹּזְמָה"></div>'+
        '<div class="cm-frow">'+
          '<select class="cm-sel" data-p="status">'+statusOpts+'</select>'+
          '<input class="cm-in" data-p="collaborators" placeholder="מִי אִתִּי (שֻׁתָּפִים)">'+
        '</div>'+
        '<div class="cm-frow"><input class="cm-in" data-p="notes" placeholder="הֶעָרָה / מַטָּרָה"></div>'+
        '<div class="cm-frow cm-frow-end"><button class="cm-btn" data-act="add-project">הוֹסֵף פְּרוֹיֶקְט</button></div>'+
      '</div>';
    var listHtml = prj.length
      ? prj.map(projectRow).join('')
      : '<div class="cm-empty">אֵין עֲדַיִן פְּרוֹיֶקְטִים. רַעְיוֹן קְהִילָתִי? תּוֹסֶפֶת לַשְּׁכוּנָה? הוֹסִיפוּ לְמַעְלָה.</div>';
    return '<div class="cm-sec">פְּרוֹיֶקְט חָדָשׁ</div>'+form+
           '<div class="cm-sec">פְּרוֹיֶקְטִים קְהִילָתִיִּים <span class="cm-cnt">'+prj.length+'</span></div>'+
           '<div class="cm-list">'+listHtml+'</div>';
  }

  /* =====================================================================
   * VIEW 3 — CONNECTIONS / RELATIONSHIP NOTES ============================
   * Stored in a NEW collection 'connections'. Each note ties to a person's
   * NAME (datalist of directory names; free text allowed for someone not in
   * the book yet), so the directory and the relationship view stay linked. */
  function listConnections(){
    var s = LS(); if(!s) return [];
    try{ return s.list('connections') || []; }catch(e){ return []; }
  }
  function connRow(c){
    var who = esc(c.person || '—');
    var note = esc(c.note || c.text || '');
    return '<div class="cm-card" data-cnid="'+esc(c.id)+'">'+
        '<div class="cm-top">'+
          '<div class="cm-id"><div class="cm-name">🔗 '+who+'</div></div>'+
          '<div class="cm-acts"><span class="cm-mini danger" data-act="del-conn" title="מְחַק">🗑</span></div>'+
        '</div>'+
        (note?'<div class="cm-body"><div class="cm-notes">'+note+'</div></div>':'')+
      '</div>';
  }
  function linksHtml(){
    var names = peopleNames();
    var datalist = '<datalist id="cm-names">'+names.map(function(n){ return '<option value="'+esc(n)+'">'; }).join('')+'</datalist>';
    var conns = listConnections();
    var form =
      '<div class="cm-form">'+
        '<div class="cm-frow"><input class="cm-in" data-l="person" list="cm-names" value="'+esc(_linksPerson)+'" placeholder="עַל מִי? (שֵׁם מֵהַסְּפַר אוֹ חָדָשׁ)"></div>'+
        datalist+
        '<div class="cm-frow"><input class="cm-in" data-l="note" placeholder="קֶשֶׁר אוֹ הֶעָרָה — מִי מַכִּיר אֶת מִי, מָה מְשֻׁתָּף…"></div>'+
        '<div class="cm-frow cm-frow-end"><button class="cm-btn" data-act="add-conn">הוֹסֵף קֶשֶׁר</button></div>'+
      '</div>';
    var listHtml = conns.length
      ? conns.map(connRow).join('')
      : '<div class="cm-empty">אֵין עֲדַיִן הֶעָרוֹת קֶשֶׁר. כָּאן רוֹשְׁמִים מִי מַכִּיר אֶת מִי וּמָה מְקַשֵּׁר בֵּינֵיהֶם.</div>';
    var hint = names.length
      ? ''
      : '<div class="cm-hint">טִיפּ: הוֹסִיפוּ קֹדֶם אֲנָשִׁים בַּלָּשׁוֹנִית "אֲנָשִׁים" — הַשֵּׁמוֹת יוֹפִיעוּ כָּאן לְהַשְׁלָמָה אוֹטוֹמָטִית.</div>';
    return '<div class="cm-sec">הוֹסָפַת קֶשֶׁר</div>'+form+hint+
           '<div class="cm-sec">רֶשֶׁת הַקְּשָׁרִים <span class="cm-cnt">'+conns.length+'</span></div>'+
           '<div class="cm-list">'+listHtml+'</div>';
  }

  /* =====================================================================
   * RENDER ============================================================== */
  var CHIPS = [['people','אֲנָשִׁים'],['projects','פְּרוֹיֶקְטִים'],['links','קֶשֶׁר']];

  function render(){
    if (!_host) return;
    ensureCSS();
    var hasStore = !!LS();
    var chips = CHIPS.map(function(c){ return '<span class="cm-chip'+(c[0]===VIEW?' on':'')+'" data-view="'+c[0]+'">'+c[1]+'</span>'; }).join('');
    var bodyHtml;
    if (!hasStore){
      bodyHtml = '<div class="cm-empty">מַאֲגַר הַנְּתוּנִים נִטְעָן…</div>';
    } else if (VIEW==='people'){ bodyHtml = peopleHtml(); }
    else if (VIEW==='projects'){ bodyHtml = projectsHtml(); }
    else { bodyHtml = linksHtml(); }

    _host.innerHTML =
      '<div id="community-hub" dir="rtl">'+
        '<h3 class="cm-h">אֲנָשִׁים, שְׁכֵנִים וְקֶשֶׁר</h3>'+
        '<div class="cm-sub">הַסְּפַר הַחֶבְרָתִי שֶׁל הַבַּיִת — שְׁכֵנִים, חֲבֵרִים, בַּעֲלֵי מִקְצוֹעַ, יוֹזְמוֹת קְהִילָתִיּוֹת וְקִשְׁרֵי הֶכֵּרוּת. נִשְׁמָר רַק עַל הַמַּכְשִׁיר הַזֶּה.</div>'+
        '<div class="cm-chips">'+chips+'</div>'+
        '<div class="cm-view">'+bodyHtml+'</div>'+
        '<div class="cm-foot">סְפַר אֲנָשִׁים אִישִׁי — לֹא רֶשֶׁת חֶבְרָתִית וְלֹא שֵׁרוּת חִיצוֹנִי. רַק מָה שֶׁרָשַׁמְתָּ, נִשְׁמָר מְקוֹמִית (localStorage).</div>'+
      '</div>';
  }

  /* =====================================================================
   * EVENTS (delegated once per host) ===================================== */
  function wire(host){
    if (_wiredHost === host) return;
    _wiredHost = host;

    host.addEventListener('click', function(e){
      var t = e.target;
      var actEl = t.closest && t.closest('[data-act]');
      var chip  = t.closest && t.closest('[data-view]');

      // chip switch
      if (chip){ var v=chip.getAttribute('data-view'); if(v!==VIEW){ VIEW=v; _editId=null; _editColl=null; render(); } return; }
      if (!actEl) return;
      var act = actEl.getAttribute('data-act');
      var s = LS(); if(!s) return;

      /* ----- PEOPLE ----- */
      if (act==='pick-photo'){
        var fi = host.querySelector('.cm-file'); if(fi) fi.click(); return;
      }
      if (act==='add-person'){
        var form = actEl.closest('.cm-form'); if(!form) return;
        var name=(form.querySelector('[data-f="name"]')||{}).value||'';
        name=name.trim(); if(!name && !_photo) return;          // need at least a name or a photo
        var coll=(form.querySelector('[data-f="coll"]')||{}).value||'neighbors';
        if(DIR_COLLS.indexOf(coll)===-1) coll='neighbors';
        var rec={
          name: name,
          relation: ((form.querySelector('[data-f="relation"]')||{}).value||'').trim(),
          phone: ((form.querySelector('[data-f="phone"]')||{}).value||'').trim(),
          notes: ((form.querySelector('[data-f="notes"]')||{}).value||'').trim()
        };
        if(_photo) rec.photo=_photo;
        try{ s.add(coll, rec); }catch(err){}
        _photo=null; render(); return;
      }
      if (act==='edit-person'){
        var card=actEl.closest('[data-pid]'); if(!card) return;
        _editId=card.getAttribute('data-pid'); _editColl=card.getAttribute('data-coll');
        // replace just this card with the edit form
        var p=findPerson(_editId,_editColl); if(p){ card.outerHTML=personEditHtml(p); } return;
      }
      if (act==='cancel-edit'){ _editId=null; _editColl=null; render(); return; }
      if (act==='save-edit'){
        var ecard=actEl.closest('[data-pid]'); if(!ecard) return;
        var id=ecard.getAttribute('data-pid'), fromColl=ecard.getAttribute('data-coll');
        var patch={
          name: ((ecard.querySelector('[data-e="name"]')||{}).value||'').trim(),
          relation: ((ecard.querySelector('[data-e="relation"]')||{}).value||'').trim(),
          phone: ((ecard.querySelector('[data-e="phone"]')||{}).value||'').trim(),
          notes: ((ecard.querySelector('[data-e="notes"]')||{}).value||'').trim()
        };
        var toColl=((ecard.querySelector('[data-e="coll"]')||{}).value||fromColl);
        if(DIR_COLLS.indexOf(toColl)===-1) toColl=fromColl;
        if(toColl===fromColl){
          try{ s.update(fromColl, id, patch); }catch(err){}
        } else {
          // moved between contacts<->neighbors: re-create in the new store, drop the old.
          var old=findPerson(id,fromColl)||{};
          var moved=Object.assign({}, old, patch); delete moved._coll; delete moved.id; delete moved.t; delete moved.d;
          try{ s.add(toColl, moved); s.remove(fromColl, id); }catch(err){}
        }
        _editId=null; _editColl=null; render(); return;
      }
      if (act==='del-person'){
        var dcard=actEl.closest('[data-pid]'); if(!dcard) return;
        try{ s.remove(dcard.getAttribute('data-coll'), dcard.getAttribute('data-pid')); }catch(err){}
        render(); return;
      }

      /* ----- PROJECTS ----- */
      if (act==='add-project'){
        var pf=actEl.closest('.cm-form'); if(!pf) return;
        var title=((pf.querySelector('[data-p="title"]')||{}).value||'').trim();
        if(!title) return;
        var rec2={
          title: title,
          status: ((pf.querySelector('[data-p="status"]')||{}).value||'idea'),
          collaborators: ((pf.querySelector('[data-p="collaborators"]')||{}).value||'').trim(),
          notes: ((pf.querySelector('[data-p="notes"]')||{}).value||'').trim()
        };
        try{ s.add('projects', rec2); }catch(err){}
        render(); return;
      }
      if (act==='cycle-status'){
        var prcard=actEl.closest('[data-prid]'); if(!prcard) return;
        var prid=prcard.getAttribute('data-prid');
        var cur=findProject(prid); if(!cur) return;
        var idx=0; for(var i=0;i<STATUSES.length;i++) if(STATUSES[i].k===(cur.status||'idea')) idx=i;
        var next=STATUSES[(idx+1)%STATUSES.length].k;
        try{ s.update('projects', prid, { status: next }); }catch(err){}
        render(); return;
      }
      if (act==='del-project'){
        var dpr=actEl.closest('[data-prid]'); if(!dpr) return;
        try{ s.remove('projects', dpr.getAttribute('data-prid')); }catch(err){}
        render(); return;
      }

      /* ----- CONNECTIONS ----- */
      if (act==='add-conn'){
        var lf=actEl.closest('.cm-form'); if(!lf) return;
        var person=((lf.querySelector('[data-l="person"]')||{}).value||'').trim();
        var note=((lf.querySelector('[data-l="note"]')||{}).value||'').trim();
        if(!person && !note) return;
        try{ s.add('connections', { person:person, note:note }); }catch(err){}
        _linksPerson=''; render(); return;
      }
      if (act==='del-conn'){
        var dcn=actEl.closest('[data-cnid]'); if(!dcn) return;
        try{ s.remove('connections', dcn.getAttribute('data-cnid')); }catch(err){}
        render(); return;
      }
    });

    // photo file pick → downscale + stage, then re-render
    host.addEventListener('change', function(e){
      if (!e.target.classList || !e.target.classList.contains('cm-file')) return;
      var f=e.target.files && e.target.files[0]; if(!f) return;
      downscale(f).then(function(durl){ _photo=capPhoto(durl); if(VIEW==='people') render(); });
    });

    // keep the selected link-person across re-render (input is destroyed by innerHTML=)
    host.addEventListener('input', function(e){
      if (e.target.getAttribute && e.target.getAttribute('data-l')==='person'){ _linksPerson=e.target.value; }
    });
  }

  /* helpers used by the edit/cycle handlers (defensive lookups) */
  function findPerson(id, coll){
    var s=LS(); if(!s) return null; var rows=[];
    try{ rows=s.list(coll)||[]; }catch(e){ rows=[]; }
    for(var i=0;i<rows.length;i++) if(rows[i] && rows[i].id===id) return Object.assign({_coll:coll}, rows[i]);
    return null;
  }
  function findProject(id){
    var rows=listProjects();
    for(var i=0;i<rows.length;i++) if(rows[i] && rows[i].id===id) return rows[i];
    return null;
  }

  /* =====================================================================
   * CSS (scoped to #community-hub; the #inst brass-on-glass language) ===== */
  function ensureCSS(){
    if (document.getElementById('community-css')) return;
    var s=document.createElement('style');
    s.id='community-css';
    s.textContent =
      '#community-hub{direction:rtl;font-family:Heebo,sans-serif;color:#efe6cf}'+
      '#community-hub .cm-h{font-family:"Frank Ruhl Libre",serif;font-weight:500;font-size:20px;color:#fff7e6;margin:0 0 4px}'+
      '#community-hub .cm-sub{color:#a99b78;font-size:12px;line-height:1.5;margin-bottom:12px}'+
      // chips
      '#community-hub .cm-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}'+
      '#community-hub .cm-chip{padding:6px 14px;border-radius:20px;cursor:pointer;font-size:12.5px;font-family:Heebo;'+
        'background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.28);color:#d7c290;user-select:none;transition:.15s}'+
      '#community-hub .cm-chip:hover{border-color:rgba(202,161,90,.5);color:#fff7e6}'+
      '#community-hub .cm-chip.on{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;font-weight:600;border-color:transparent}'+
      // section headers
      '#community-hub .cm-sec{margin:16px 0 6px;color:'+GOLD+';font-family:Bellefair,serif;font-size:13px;letter-spacing:.03em;'+
        'border-top:1px solid rgba(202,161,90,.15);padding-top:9px;display:flex;align-items:center;gap:6px}'+
      '#community-hub .cm-sec:first-child{border-top:none;padding-top:0;margin-top:4px}'+
      '#community-hub .cm-sec.sm{font-size:12px;border-top:none;padding-top:0;margin:0 0 6px}'+
      '#community-hub .cm-cnt{color:#a99b78;font-size:11px;font-family:Heebo}'+
      // add-form
      '#community-hub .cm-form{background:rgba(255,255,255,.03);border:1px solid rgba(202,161,90,.18);border-radius:10px;'+
        'padding:10px 11px;display:flex;flex-direction:column;gap:7px}'+
      '#community-hub .cm-frow{display:flex;gap:7px;align-items:center}'+
      '#community-hub .cm-frow-end{justify-content:flex-end;margin-top:1px}'+
      '#community-hub .cm-in,#community-hub .cm-sel{flex:1;min-width:0;padding:8px 10px;background:rgba(255,255,255,.04);'+
        'border:1px solid rgba(202,161,90,.26);border-radius:8px;color:#ece6d8;font-family:Heebo;font-size:13px;direction:rtl}'+
      '#community-hub .cm-in::placeholder{color:#7d7560}'+
      '#community-hub .cm-in:focus,#community-hub .cm-sel:focus{outline:none;border-color:rgba(202,161,90,.6)}'+
      '#community-hub .cm-sel{flex:0 0 auto;cursor:pointer}'+
      '#community-hub .cm-btn{padding:8px 16px;border-radius:8px;cursor:pointer;font-family:Heebo;font-size:12.5px;font-weight:600;'+
        'background:linear-gradient(#caa15a,#a07c38);color:#1a1606;border:none;transition:.15s}'+
      '#community-hub .cm-btn:hover{filter:brightness(1.08)}'+
      '#community-hub .cm-btn.ghost{background:rgba(255,255,255,.05);border:1px solid rgba(202,161,90,.3);color:#d7c290;font-weight:500}'+
      '#community-hub .cm-photo{flex:0 0 auto;width:38px;height:38px;border-radius:8px;cursor:pointer;font-size:16px;'+
        'background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.3);color:#d7c290;margin-inline-end:auto}'+
      '#community-hub .cm-photo.set{background:rgba(127,184,138,.16);border-color:rgba(127,184,138,.5)}'+
      '#community-hub .cm-staged{color:#9fce9f;font-size:11px;font-family:Heebo;margin-top:2px}'+
      '#community-hub .cm-hint{color:#a99b78;font-size:11px;line-height:1.5;margin:6px 2px 0;'+
        'border-right:2px solid rgba(202,161,90,.3);padding-right:8px}'+
      // list + cards
      '#community-hub .cm-list{margin-top:8px;display:flex;flex-direction:column;gap:8px}'+
      '#community-hub .cm-card{background:linear-gradient(160deg,rgba(255,255,255,.045),rgba(255,255,255,.02));'+
        'border:1px solid rgba(202,161,90,.16);border-radius:10px;padding:10px 11px}'+
      '#community-hub .cm-card.editing{border-color:rgba(202,161,90,.45);background:rgba(202,161,90,.06)}'+
      '#community-hub .cm-top{display:flex;align-items:center;gap:10px}'+
      '#community-hub .cm-av{width:42px;height:42px;flex:0 0 42px;border-radius:50%;overflow:hidden;display:flex;'+
        'align-items:center;justify-content:center;background:rgba(255,255,255,.06);font-size:20px;border:1px solid rgba(202,161,90,.22)}'+
      '#community-hub .cm-av img{width:100%;height:100%;object-fit:cover;display:block}'+
      '#community-hub .cm-id{flex:1;min-width:0}'+
      '#community-hub .cm-name{color:#fff7e6;font-size:14.5px;font-family:Heebo;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
      '#community-hub .cm-rel{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:3px}'+
      '#community-hub .cm-pill{font-size:10px;padding:1px 9px;border-radius:20px;white-space:nowrap;font-family:Heebo}'+
      '#community-hub .cm-pill.green{background:rgba(120,200,120,.16);color:#a7e0a7;border:1px solid rgba(120,200,120,.4)}'+
      '#community-hub .cm-pill.blue{background:rgba(120,150,210,.16);color:#bcd0f0;border:1px solid rgba(120,150,210,.4)}'+
      '#community-hub .cm-pill.amber{background:rgba(224,178,74,.18);color:#e8c474;border:1px solid rgba(224,178,74,.4)}'+
      '#community-hub .cm-pill.gold{background:rgba(202,161,90,.22);color:#f0d9a8;border:1px solid rgba(202,161,90,.5)}'+
      '#community-hub .cm-who{font-size:10.5px;color:#a99b78;font-family:Heebo}'+
      '#community-hub .cm-acts{flex:0 0 auto;display:flex;gap:4px}'+
      '#community-hub .cm-mini{cursor:pointer;color:#a99b78;font-size:13px;line-height:1;padding:5px 7px;border-radius:7px;'+
        'border:1px solid rgba(202,161,90,.2);background:rgba(255,255,255,.03);transition:.15s}'+
      '#community-hub .cm-mini:hover{color:#fff7e6;border-color:rgba(202,161,90,.5)}'+
      '#community-hub .cm-mini.danger:hover{color:#e8b0b0;border-color:rgba(210,120,120,.5)}'+
      '#community-hub .cm-body{margin-top:8px;padding-top:8px;border-top:1px solid rgba(202,161,90,.1)}'+
      '#community-hub .cm-tel{display:inline-block;color:#bcd0f0;font-size:12px;font-family:Heebo;text-decoration:none;'+
        'padding:3px 9px;border-radius:7px;background:rgba(120,150,210,.1);border:1px solid rgba(120,150,210,.3)}'+
      '#community-hub .cm-tel:hover{background:rgba(120,150,210,.2)}'+
      '#community-hub .cm-notes{color:#cabd9a;font-size:12.5px;line-height:1.55;font-family:Heebo;margin-top:5px}'+
      '#community-hub .cm-empty{color:#a99b78;font-size:12.5px;line-height:1.6;font-family:Heebo;padding:14px 4px;text-align:center}'+
      '#community-hub .cm-foot{margin-top:14px;padding-top:9px;border-top:1px solid rgba(202,161,90,.13);'+
        'font-size:9.5px;color:#8a7a52;font-family:Heebo;line-height:1.5}'+
      '@media(max-width:760px){'+
        '#community-hub .cm-h{font-size:18px}'+
        '#community-hub .cm-sub{font-size:11.5px}'+
        // chip strip: keep wrapping, give bigger tap targets
        '#community-hub .cm-chips{gap:5px}'+
        '#community-hub .cm-chip{padding:8px 14px;font-size:12px}'+
        // forms: stack rows + make selects full-width so they never squash
        '#community-hub .cm-form{padding:10px}'+
        '#community-hub .cm-frow{flex-wrap:wrap}'+
        '#community-hub .cm-sel{flex:1 1 100%}'+
        '#community-hub .cm-in,#community-hub .cm-sel{font-size:13px;padding:9px 10px}'+
        // keep add/save buttons a comfortable tap size, span the end row
        '#community-hub .cm-frow-end{flex-wrap:wrap}'+
        '#community-hub .cm-btn{padding:10px 16px;font-size:12.5px}'+
        '#community-hub .cm-photo{width:40px;height:40px}'+
        // cards: roomier action buttons (✎/🗑/⟳) for fingers
        '#community-hub .cm-card{padding:10px}'+
        '#community-hub .cm-mini{padding:7px 9px;font-size:14px}'+
        '#community-hub .cm-tel{padding:6px 10px;font-size:12px}'+
        '#community-hub .cm-notes{font-size:12px}'+
        '#community-hub .cm-empty{font-size:12px;padding:14px 4px}'+
      '}';
    document.head.appendChild(s);
  }

  /* =====================================================================
   * PUBLIC API ========================================================== */
  function publicRender(host, date){
    if (!host) return;
    _host = host;
    ensureCSS();
    wire(host);
    render();
  }

  window.__community = {
    render: publicRender,
    // small introspection hooks (handy for the integrator's smoke test)
    _view: function(){ return VIEW; },
    _setView: function(v){ if(CHIPS.some(function(c){return c[0]===v;})){ VIEW=v; render(); } }
  };
})();
