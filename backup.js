/* ===================================================================
   backup.js — window.__backup: data portability for the LIVING GIFT.

   Alex's gift accumulates real data over YEARS — the living weather
   record (home_record_v1), his garden + plant cards, his vision board,
   his inventory ("where did I put X"), his people/neighbours directory,
   his natal chart, planning caches, dismissed alerts, ambient prefs, …
   ALL of it lives only in this browser's localStorage. One cleared
   cache, one new device, and it's gone. This module makes that data
   SAFE and MOVABLE:

     window.__backup.export()        → gathers every home_* namespace
                                       into one dated JSON file + triggers
                                       a download (גיבוי-אלכס-YYYY-MM-DD.json).
     window.__backup.import(fileOrJson, {mode}) → restores them, with a
                                       confirm + a merge-or-replace choice.
     window.__backup.render(host)    → a small RTL #inst card: how much
                                       data is stored + Export / Import
                                       buttons + the merge/replace toggle.

   HOW IT FINDS THE DATA (no maintenance as the app grows):
   every persistent key in this app is 'home_*'-prefixed (verified by a
   full grep of the app: home_record_v1, home_garden_v1, home_vision_v1,
   home_inventory_v1, home_natal_v1, home_workbench_v1, home_planning_v1,
   home_alerts_state_v1, home_amb_v1, home_env_*_v1, home_read, home_obs,
   home_plantnet_key, home_mag_week, the dynamic LogStore collections
   home_log_<coll>_v1, and the dynamic home_v2_drag.<id> keys). So we
   SCAN localStorage for the 'home_' prefix — this auto-captures present
   AND future namespaces. A curated CATALOG (below) only supplies the
   nice Hebrew labels for the summary; an unlabeled future key still gets
   backed up (shown under its raw key). No data is ever silently skipped.

   DESIGN RULES (honesty + safety):
   • NEVER throws — every entry point is wrapped; failures return a
     {ok:false, error} result and surface a gentle Hebrew message.
   • DESTRUCTIVE-CLEAR ("replace") and overwrite-on-conflict ALWAYS ask
     for an explicit confirm first, naming exactly what's at stake.
   • A restore is NOT a guess: we only accept files we wrote (a signed
     envelope {app:'alex-gift', kind:'backup', v, data}); a foreign /
     corrupt file is rejected with a clear reason, the store untouched.
   • Self-injects its own CSS once; RTL Hebrew; the gold-on-glass #inst
     instrument language (mirrors zone_card.js / workbench.js).
   • No network. Pure browser + a Blob download + a hidden file <input>.
   =================================================================== */
(function(){
  if(window.__backup) return;                       // idempotency (house pattern)

  /* ---- the panels.js helpers, verbatim feel ---- */
  var esc = function(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
  var el = function(t,c,h){ var e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };

  var PREFIX   = 'home_';                            // every app namespace is home_*
  var ENVELOPE = { app:'alex-gift', kind:'backup', v:1 };

  /* ---- curated catalog: key → Hebrew label + family (for the summary only).
     Dynamic families (LogStore collections, the per-id drag keys) are matched
     by prefix so we don't have to enumerate every collection. Anything not
     matched here is still exported — it just shows under its raw key. ---- */
  var CATALOG = [
    { key:'home_record_v1',        he:'יוֹמַן הָאַקְלִים הַחַי',        fam:'אַקְלִים' },
    { key:'home_garden_v1',        he:'הַגִּינָּה וְכַרְטִיסֵי הַצְּמָחִים', fam:'גִּינָּה' },
    { key:'home_workbench_v1',     he:'שֻׁלְחַן הָעֲבוֹדָה (חֲדָרִים)',  fam:'בַּיִת' },
    { key:'home_vision_v1',        he:'לוּחַ הַחֲזוֹן',                 fam:'חֲזוֹן' },
    { key:'home_inventory_v1',     he:'מְלַאי · אֵיפֹה שַׂמְתִּי',       fam:'בַּיִת' },
    { key:'home_natal_v1',         he:'מַפַּת הַלֵּדָה',                fam:'שָׁמַיִם' },
    { key:'home_planning_v1',      he:'מִטְמוֹן תִּכְנוּן',             fam:'מַעֲרֶכֶת' },
    { key:'home_alerts_state_v1',  he:'הִתְרָאוֹת שֶׁנֻּקּוּ',          fam:'מַעֲרֶכֶת' },
    { key:'home_amb_v1',           he:'הַעֲדָפוֹת צְלִיל',              fam:'מַעֲרֶכֶת' },
    { key:'home_env_cache_v1',     he:'מִטְמוֹן סְבִיבָה',             fam:'מַעֲרֶכֶת' },
    { key:'home_env_keys_v1',      he:'מַפְתְּחוֹת סְבִיבָה',           fam:'מַעֲרֶכֶת' },
    { key:'home_plantnet_key',     he:'מַפְתֵּחַ זִהוּי צְמָחִים',      fam:'מַעֲרֶכֶת' },
    { key:'home_mag_week',         he:'סִמּוּן מָגְנִיטוֹמֶטֶר שָׁבוּעַ', fam:'מַעֲרֶכֶת' },
    { key:'home_read',             he:'קְרִיאוֹת מוֹנֶה (אֵנֶרְגְּיָה)',  fam:'בַּיִת' },
    { key:'home_obs',              he:'תַּצְפִּיּוֹת טֶבַע',            fam:'טֶבַע' }
  ];
  /* prefix-matched families for the dynamic keys */
  var PREFIX_FAMS = [
    { pre:'home_log_', he:'אוֹסֶף יוֹמָן', fam:'מוֹחַ' },           // LogStore collections
    { pre:'home_v2_drag.', he:'מִקּוּם רָהִיט', fam:'בַּיִת' }      // per-id drag positions
  ];
  function labelFor(key){
    for(var i=0;i<CATALOG.length;i++) if(CATALOG[i].key===key) return CATALOG[i];
    for(var j=0;j<PREFIX_FAMS.length;j++) if(key.indexOf(PREFIX_FAMS[j].pre)===0){
      var rest=key.slice(PREFIX_FAMS[j].pre.length).replace(/_v1$/,'');
      return { key:key, he:PREFIX_FAMS[j].he+(rest?' · '+rest:''), fam:PREFIX_FAMS[j].fam };
    }
    return { key:key, he:key, fam:'אַחֵר' };
  }

  /* ---- localStorage scan (defensive everywhere) ---- */
  function lsLength(){ try{ return localStorage.length||0; }catch(e){ return 0; } }
  function lsKeyAt(i){ try{ return localStorage.key(i); }catch(e){ return null; } }
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k,v){ try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } }

  // every home_* key currently present
  function appKeys(){
    var out=[], n=lsLength();
    for(var i=0;i<n;i++){ var k=lsKeyAt(i); if(typeof k==='string' && k.indexOf(PREFIX)===0) out.push(k); }
    out.sort();
    return out;
  }

  function fmtBytes(b){
    if(!isFinite(b)||b<=0) return '0 ב׳';
    if(b<1024) return b+' ב׳';
    if(b<1024*1024) return (Math.round(b/102.4)/10)+' ק״ב';
    return (Math.round(b/104857.6)/10)+' מ״ב';
  }
  // rough byte size of a stored string (UTF-16 chars; a stable RELATIVE measure)
  function strBytes(s){ return s? s.length*2 : 0; }
  // try to count "records" in a value so the summary can say "12 פריטים"
  function countItems(raw){
    if(raw==null) return null;
    try{
      var v=JSON.parse(raw);
      if(Array.isArray(v)) return v.length;
      if(v && typeof v==='object'){
        // common shapes: {plants:[...]}, {items:[...]}, a map of arrays, or a single doc
        if(Array.isArray(v.plants)) return v.plants.length;
        if(Array.isArray(v.items))  return v.items.length;
        if(Array.isArray(v.tiles))  return v.tiles.length;
        // a record-store-style map of {date:{...}} → count dates
        var ks=Object.keys(v);
        if(ks.length && ks.every(function(k){ return v[k] && typeof v[k]==='object'; })) return ks.length;
        return 1; // a single config doc
      }
      return 1;
    }catch(e){ return null; }   // not JSON (e.g. a raw key string) → unknown count
  }

  /* ===================== SUMMARY ===================== */
  // a per-key + per-family snapshot of what's stored right now.
  function summary(){
    var keys=appKeys(), rows=[], totalBytes=0, fams={};
    keys.forEach(function(k){
      var raw=lsGet(k), b=strBytes(raw)+strBytes(k), lab=labelFor(k), cnt=countItems(raw);
      totalBytes+=b;
      fams[lab.fam]=(fams[lab.fam]||0)+b;
      rows.push({ key:k, he:lab.he, fam:lab.fam, bytes:b, items:cnt });
    });
    rows.sort(function(a,b){ return b.bytes-a.bytes; });
    var famList=Object.keys(fams).map(function(f){ return { fam:f, bytes:fams[f] }; })
                     .sort(function(a,b){ return b.bytes-a.bytes; });
    return { keys:keys.length, totalBytes:totalBytes, rows:rows, families:famList };
  }

  /* ===================== EXPORT ===================== */
  function dateStamp(){
    var d=new Date(), p=function(n){ return (n<10?'0':'')+n; };
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
  }
  // build the signed envelope object (no download) — used by export() and tests.
  function buildPayload(){
    var keys=appKeys(), data={}, skipped=[];
    keys.forEach(function(k){
      var raw=lsGet(k);
      if(raw==null){ skipped.push(k); return; }   // unreadable → note it, never crash
      data[k]=raw;                                  // store the RAW string (lossless)
    });
    return {
      app:ENVELOPE.app, kind:ENVELOPE.kind, v:ENVELOPE.v,
      exported:new Date().toISOString(),
      origin:(function(){ try{ return location.host||''; }catch(e){ return ''; } })(),
      count:keys.length,
      skipped:skipped,
      data:data
    };
  }
  // trigger a browser download of a Blob (defensive; returns ok flag)
  function download(filename, text){
    try{
      var blob=new Blob([text],{type:'application/json'});
      var url=URL.createObjectURL(blob);
      var a=document.createElement('a');
      a.href=url; a.download=filename;
      a.style.display='none';
      (document.body||document.documentElement).appendChild(a);
      a.click();
      // revoke + remove a tick later so the click is processed first
      setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(e){} try{ a.remove(); }catch(e){} }, 800);
      return true;
    }catch(e){ return false; }
  }
  // public: gather + download. Returns {ok, filename, count, bytes, payload, error}.
  function exportData(opts){
    opts=opts||{};
    try{
      var payload=buildPayload();
      var text=JSON.stringify(payload, null, opts.pretty===false?0:2);
      var filename='גיבוי-אלכס-'+dateStamp()+'.json';
      var did = opts.noDownload ? true : download(filename, text);
      return { ok:did, filename:filename, count:payload.count, bytes:strBytes(text),
               skipped:payload.skipped, payload:payload, text:text,
               error: did?null:'הַהוֹרָדָה נֶחְסְמָה עַל יְדֵי הַדַּפְדְּפָן' };
    }catch(e){
      return { ok:false, error:(e&&e.message)||'שְׁגִיאָה בִּיצִירַת הַגִּבּוּי' };
    }
  }

  /* ===================== IMPORT / RESTORE ===================== */
  // validate a parsed object is one of OUR backups. Returns {ok, reason, payload}.
  function validate(obj){
    if(!obj || typeof obj!=='object')        return { ok:false, reason:'הַקֹּבֶץ אֵינוֹ JSON תָּקִין' };
    if(obj.app!==ENVELOPE.app || obj.kind!==ENVELOPE.kind)
                                             return { ok:false, reason:'זֶה אֵינוֹ קֹבֶץ גִּבּוּי שֶׁל הַמַּתָּנָה' };
    if(!obj.data || typeof obj.data!=='object')
                                             return { ok:false, reason:'הַגִּבּוּי רֵיק אוֹ פָּגוּם (אֵין נְתוּנִים)' };
    // accept only home_* string values (anything else is foreign/unsafe → drop it)
    var clean={}, dropped=[];
    Object.keys(obj.data).forEach(function(k){
      if(typeof k==='string' && k.indexOf(PREFIX)===0 && typeof obj.data[k]==='string') clean[k]=obj.data[k];
      else dropped.push(k);
    });
    if(!Object.keys(clean).length) return { ok:false, reason:'אֵין בַּקֹּבֶץ אַף מַפְתֵּחַ תָּקִין שֶׁל הָאַפְּלִיקַצְיָה' };
    return { ok:true, payload:Object.assign({}, obj, { data:clean }), dropped:dropped };
  }

  // parse text → object (defensive)
  function parseText(text){
    try{ return { ok:true, obj:JSON.parse(text) }; }
    catch(e){ return { ok:false, reason:'לֹא נִתָּן לִקְרֹא אֶת הַקֹּבֶץ כְּ-JSON' }; }
  }

  /* apply a validated payload to localStorage.
     mode 'merge'   → write the backup's keys OVER the current ones (per-key
                      replace; keys NOT in the backup are LEFT as-is).
     mode 'replace' → first remove EVERY current home_* key, then write the
                      backup's keys (a clean restore to exactly the backup).
     Returns {ok, written, removed, failed[]}. Never throws. */
  function applyPayload(payload, mode){
    var written=0, removed=0, failed=[];
    try{
      if(mode==='replace'){
        appKeys().forEach(function(k){ try{ localStorage.removeItem(k); removed++; }catch(e){} });
      }
      Object.keys(payload.data).forEach(function(k){
        if(lsSet(k, payload.data[k])) written++; else failed.push(k);
      });
      return { ok:failed.length===0, written:written, removed:removed, failed:failed };
    }catch(e){
      return { ok:false, written:written, removed:removed, failed:failed, error:(e&&e.message)||'שְׁגִיאָה בַּשִּׁחְזוּר' };
    }
  }

  /* public import. Accepts a File, a raw JSON string, or an already-parsed
     object. opts.mode ∈ {'merge','replace'} (default 'merge'). opts.confirm
     defaults to the global confirm() so a destructive restore is gated; pass
     opts.confirm=false ONLY from tests / when the UI already confirmed.
     Returns a Promise<{ok, ...}> (always resolves, never rejects). */
  function importData(input, opts){
    opts=opts||{};
    var mode=(opts.mode==='replace')?'replace':'merge';
    return new Promise(function(resolve){
      function fromText(text){
        var p=parseText(text);
        if(!p.ok){ resolve({ ok:false, error:p.reason }); return; }
        var v=validate(p.obj);
        if(!v.ok){ resolve({ ok:false, error:v.reason }); return; }
        var nKeys=Object.keys(v.payload.data).length;
        // CONFIRM before touching the store. Name exactly what's at stake.
        var doConfirm = (opts.confirm===false) ? function(){ return true; }
                       : (typeof opts.confirm==='function' ? opts.confirm
                       : (typeof confirm==='function' ? confirm : function(){ return true; }));
        var msg = mode==='replace'
          ? ('שִׁחְזוּר בְּהַחְלָפָה: כָּל הַנְּתוּנִים הַנּוֹכְחִיִּים בַּדַּפְדְּפָן הַזֶּה יִמָּחֲקוּ וְיוּחְלְפוּ בְּ-'+nKeys+' מַפְתְּחוֹת מֵהַגִּבּוּי. לְהַמְשִׁיךְ?')
          : ('שִׁחְזוּר בְּמִזּוּג: '+nKeys+' מַפְתְּחוֹת מֵהַגִּבּוּי יִדְרְסוּ אֶת הַנּוֹכְחִיּוֹת בְּאוֹתוֹ שֵׁם (הַשְּׁאָר יִשָּׁמֵר). לְהַמְשִׁיךְ?');
        var go=false; try{ go=!!doConfirm(msg); }catch(e){ go=false; }
        if(!go){ resolve({ ok:false, cancelled:true }); return; }
        var res=applyPayload(v.payload, mode);
        resolve(Object.assign({ ok:res.ok, mode:mode, keys:nKeys, dropped:v.dropped||[] }, res));
      }
      try{
        if(input && typeof input==='object' && typeof input.text==='function' && typeof input.name==='string'){
          // a File (or Blob): read it then restore
          if(typeof input.text==='function'){
            input.text().then(fromText, function(){ resolve({ ok:false, error:'לֹא נִתָּן לִקְרֹא אֶת הַקֹּבֶץ' }); });
          }
          return;
        }
        if(typeof FileReader!=='undefined' && input && input.name && input.size!=null){
          var fr=new FileReader();
          fr.onload=function(){ fromText(String(fr.result||'')); };
          fr.onerror=function(){ resolve({ ok:false, error:'לֹא נִתָּן לִקְרֹא אֶת הַקֹּבֶץ' }); };
          fr.readAsText(input);
          return;
        }
        if(typeof input==='string'){ fromText(input); return; }
        if(input && typeof input==='object'){
          // an already-parsed envelope
          var v2=validate(input);
          if(!v2.ok){ resolve({ ok:false, error:v2.reason }); return; }
          fromText(JSON.stringify(input)); return;
        }
        resolve({ ok:false, error:'לֹא הִתְקַבֵּל קֹבֶץ לְשִׁחְזוּר' });
      }catch(e){
        resolve({ ok:false, error:(e&&e.message)||'שְׁגִיאָה בִּקְרִיאַת הַקֹּבֶץ' });
      }
    });
  }

  /* ===================== CSS (the #inst gold-on-glass language) ===================== */
  var CSS = ''
  + '#bk-host{font-family:"Heebo",sans-serif;color:#efe6cf;direction:rtl}'
  + '#bk-host .bk-intro{font-size:12px;color:#a99b78;line-height:1.6;margin:0 0 12px;'
  +   'border-right:2px solid rgba(202,161,90,.3);padding-right:9px}'
  + '#bk-host .bk-card{background:linear-gradient(160deg,rgba(12,14,26,.93),rgba(6,7,15,.95));'
  +   'border:1px solid rgba(202,161,90,.22);border-radius:10px;padding:13px 15px;margin-bottom:12px;'
  +   'box-shadow:0 14px 40px rgba(0,0,0,.5)}'
  + '#bk-host .bk-ct{font-family:"Bellefair",serif;letter-spacing:.05em;font-size:13px;color:#caa15a;'
  +   'margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px}'
  + '#bk-host .bk-big{font-family:"Frank Ruhl Libre",serif;font-size:26px;color:#fff7e6;font-weight:500;line-height:1}'
  + '#bk-host .bk-sub{font-size:10.5px;color:#a99b78;margin-top:3px}'
  + '#bk-host .bk-stat{display:flex;gap:20px;align-items:flex-end;flex-wrap:wrap;margin-bottom:4px}'
  + '#bk-host .bk-fam{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}'
  + '#bk-host .bk-pill{font-size:10px;padding:3px 9px;border-radius:20px;background:rgba(202,161,90,.13);'
  +   'color:#e8c474;border:1px solid rgba(202,161,90,.32);white-space:nowrap}'
  + '#bk-host .bk-row{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;'
  +   'color:#d6ccb2;padding:6px 0;border-top:1px solid rgba(202,161,90,.1)}'
  + '#bk-host .bk-row:first-of-type{border-top:none}'
  + '#bk-host .bk-row b{color:#fff7e6;font-weight:600}'
  + '#bk-host .bk-row .bk-meta{font-size:10px;color:#7d7150}'
  + '#bk-host .bk-btns{display:flex;gap:9px;flex-wrap:wrap;margin-top:4px}'
  + '#bk-host .bk-btn{flex:1 1 auto;text-align:center;cursor:pointer;user-select:none;font-size:13px;'
  +   'padding:11px 14px;border-radius:9px;border:1px solid rgba(202,161,90,.4);transition:.15s;min-width:120px}'
  + '#bk-host .bk-btn.primary{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;font-weight:600;border-color:transparent}'
  + '#bk-host .bk-btn.primary:hover{filter:brightness(1.08)}'
  + '#bk-host .bk-btn.ghost{background:rgba(255,255,255,.04);color:#e8c474}'
  + '#bk-host .bk-btn.ghost:hover{border-color:rgba(202,161,90,.7);color:#fff7e6}'
  + '#bk-host .bk-mode{display:flex;gap:7px;margin:10px 0 2px}'
  + '#bk-host .bk-mode label{flex:1;display:flex;flex-direction:column;gap:2px;cursor:pointer;font-size:11.5px;'
  +   'padding:8px 10px;border-radius:8px;border:1px solid rgba(202,161,90,.2);background:rgba(255,255,255,.03);transition:.15s}'
  + '#bk-host .bk-mode label.on{border-color:#caa15a;background:rgba(202,161,90,.12);color:#fff7e6}'
  + '#bk-host .bk-mode .bk-mh{color:#caa15a;font-weight:600}'
  + '#bk-host .bk-mode .bk-md{font-size:9.5px;color:#a99b78;line-height:1.4}'
  + '#bk-host .bk-mode input{display:none}'
  + '#bk-host .bk-warn{font-size:10px;color:#e8b0b0;margin-top:8px;line-height:1.5}'
  + '#bk-host .bk-msg{font-size:11.5px;margin-top:10px;padding:8px 11px;border-radius:8px;line-height:1.5;display:none}'
  + '#bk-host .bk-msg.show{display:block}'
  + '#bk-host .bk-msg.ok{background:rgba(120,200,120,.12);color:#a7e0a7;border:1px solid rgba(120,200,120,.35)}'
  + '#bk-host .bk-msg.err{background:rgba(210,120,120,.12);color:#e8b0b0;border:1px solid rgba(210,120,120,.35)}'
  + '#bk-host .bk-foot{font-size:9.5px;color:#7d7150;margin-top:12px;line-height:1.5}';

  var _cssDone=false;
  function ensureCSS(){
    if(_cssDone) return;
    try{
      if(document.getElementById('backup-css')){ _cssDone=true; return; }
      var s=el('style'); s.id='backup-css'; s.textContent=CSS;
      (document.head||document.documentElement).appendChild(s);
      _cssDone=true;
    }catch(e){ /* CSS is cosmetic; never block functionality */ }
  }

  /* ===================== RENDER ===================== */
  var _mode='merge';                                  // UI-selected restore mode

  function summaryHtml(){
    var s=summary();
    var pills = s.families.length
      ? s.families.map(function(f){ return '<span class="bk-pill">'+esc(f.fam)+' · '+esc(fmtBytes(f.bytes))+'</span>'; }).join('')
      : '<span class="bk-pill">אֵין עֲדַיִן נְתוּנִים</span>';
    var rows = s.rows.length
      ? s.rows.map(function(r){
          var cnt = (r.items!=null) ? (r.items+' פְּרִיטִים') : '—';
          return '<div class="bk-row"><span>'+esc(r.he)+'</span>'
               + '<b>'+esc(fmtBytes(r.bytes))+'</b>'
               + '<span class="bk-meta">'+esc(cnt)+'</span></div>';
        }).join('')
      : '<div class="bk-row"><span>הַגִּינָּה רֵיקָה עֲדַיִן — שׁוּם דָּבָר לְגַבּוֹת.</span></div>';
    return ''
      + '<div class="bk-card">'
      +   '<div class="bk-ct">כַּמָּה נֶאֱסַף עַד כֹּה</div>'
      +   '<div class="bk-stat">'
      +     '<div><div class="bk-big">'+s.keys+'</div><div class="bk-sub">מַפְתְּחוֹת נְתוּנִים</div></div>'
      +     '<div><div class="bk-big">'+esc(fmtBytes(s.totalBytes))+'</div><div class="bk-sub">סַךְ הַכֹּל בַּדַּפְדְּפָן</div></div>'
      +   '</div>'
      +   '<div class="bk-fam">'+pills+'</div>'
      + '</div>'
      + '<div class="bk-card">'
      +   '<div class="bk-ct">פֵּרוּט <span class="bk-meta" style="font-size:9.5px;color:#7d7150">לְפִי גֹּדֶל</span></div>'
      +   rows
      + '</div>';
  }

  function setMsg(host, kind, text){
    try{
      var m=host.querySelector('.bk-msg'); if(!m) return;
      m.className='bk-msg show '+(kind||'ok');
      m.innerHTML=esc(text);
    }catch(e){}
  }

  function render(host, date){
    if(!host) return;
    try{
      ensureCSS();
      host.id='bk-host'; host.setAttribute('dir','rtl');
      host.innerHTML = ''
        + '<div class="bk-intro">הַמַּתָּנָה צוֹבֶרֶת נְתוּנִים אֲמִתִּיִּים לְאֹרֶךְ שָׁנִים — יוֹמַן הָאַקְלִים, הַגִּינָּה, '
        +   'לוּחַ הַחֲזוֹן, הַמְּלַאי, הָאֲנָשִׁים וְעוֹד — וְכֻלָּם חַיִּים רַק בַּדַּפְדְּפָן הַזֶּה. '
        +   'גַּבּוּ אוֹתָם לְקֹבֶץ אֶחָד, שִׁמְרוּ בְּמָקוֹם בָּטוּחַ, וְשַׁחְזְרוּ בְּכָל מַכְשִׁיר חָדָשׁ.</div>'
        + summaryHtml()
        + '<div class="bk-card">'
        +   '<div class="bk-ct">גִּבּוּי</div>'
        +   '<div class="bk-btns">'
        +     '<div class="bk-btn primary" data-act="export">⬇ הוֹרֵד גִּבּוּי (JSON)</div>'
        +   '</div>'
        +   '<div class="bk-foot">קֹבֶץ מְתֻאָרָךְ נִשְׁמָר לַהוֹרָדוֹת. שְׁמֹר אוֹתוֹ בְּעֲנָן / כּוֹנֵן חִיצוֹנִי — הוּא כָּל הַזִּכָּרוֹן שֶׁל הַמַּתָּנָה.</div>'
        + '</div>'
        + '<div class="bk-card">'
        +   '<div class="bk-ct">שִׁחְזוּר מִקֹּבֶץ</div>'
        +   '<div class="bk-mode">'
        +     '<label class="'+(_mode==='merge'?'on':'')+'" data-mode="merge"><span class="bk-mh">מִזּוּג</span>'
        +       '<span class="bk-md">מְעַדְכֵּן מַפְתְּחוֹת מֵהַגִּבּוּי, מַשְׁאִיר אֶת הַשְּׁאָר. בָּטוּחַ.</span>'
        +       '<input type="radio" name="bk-mode" '+(_mode==='merge'?'checked':'')+'></label>'
        +     '<label class="'+(_mode==='replace'?'on':'')+'" data-mode="replace"><span class="bk-mh">הַחְלָפָה מְלֵאָה</span>'
        +       '<span class="bk-md">מוֹחֵק הַכֹּל וּמַחֲזִיר בְּדִיּוּק אֶת הַגִּבּוּי. זָהִיר.</span>'
        +       '<input type="radio" name="bk-mode" '+(_mode==='replace'?'checked':'')+'></label>'
        +   '</div>'
        +   (_mode==='replace'
              ? '<div class="bk-warn">⚠ הַחְלָפָה מְלֵאָה תִּמְחַק אֶת כָּל הַנְּתוּנִים הַנּוֹכְחִיִּים בַּדַּפְדְּפָן הַזֶּה. תִּתְבַּקֵּשׁ לְאַשֵּׁר.</div>'
              : '')
        +   '<div class="bk-btns" style="margin-top:10px">'
        +     '<div class="bk-btn ghost" data-act="import">⬆ בְּחַר קֹבֶץ גִּבּוּי…</div>'
        +   '</div>'
        +   '<input type="file" accept="application/json,.json" data-role="file" style="display:none">'
        + '</div>'
        + '<div class="bk-msg"></div>';

      wire(host, date);
    }catch(e){
      try{ host.innerHTML='<div class="bk-msg show err" style="font-family:Heebo,sans-serif;direction:rtl">לֹא נִתָּן לְהַצִּיג אֶת מָסַךְ הַגִּבּוּי כָּעֵת.</div>'; }catch(_){}
    }
  }

  function wire(host, date){
    if(!host || host.__bkWired) return;
    host.__bkWired=true;
    host.addEventListener('click', function(e){
      var modeLbl=e.target && e.target.closest ? e.target.closest('[data-mode]') : null;
      if(modeLbl){ _mode=modeLbl.getAttribute('data-mode')==='replace'?'replace':'merge'; render(host, date); return; }
      var btn=e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if(!btn) return;
      var act=btn.getAttribute('data-act');
      if(act==='export'){
        var r=exportData();
        if(r.ok) setMsg(host,'ok','✓ הַגִּבּוּי יָרַד: '+esc(r.filename)+' · '+r.count+' מַפְתְּחוֹת · '+esc(fmtBytes(r.bytes)));
        else setMsg(host,'err','✗ '+esc(r.error||'הַגִּבּוּי נִכְשַׁל'));
      } else if(act==='import'){
        var inp=host.querySelector('[data-role="file"]');
        if(inp){ try{ inp.value=''; }catch(_){}; inp.click(); }
      }
    });
    var inp=host.querySelector('[data-role="file"]');
    if(inp){
      inp.addEventListener('change', function(){
        var f=inp.files && inp.files[0];
        if(!f){ return; }
        setMsg(host,'ok','קוֹרֵא אֶת הַקֹּבֶץ…');
        importData(f, { mode:_mode }).then(function(res){
          if(res.cancelled){ setMsg(host,'err','בֻּטַּל — שׁוּם דָּבָר לֹא הִשְׁתַּנָּה.'); return; }
          if(res.ok){
            setMsg(host,'ok','✓ שֻׁחְזַר בְּהַצְלָחָה · '+res.written+' מַפְתְּחוֹת נִכְתְּבוּ'+(res.removed?(' · '+res.removed+' נִמְחֲקוּ'):'')+'. רַעֲנֵן אֶת הַדַּף כְּדֵי לִרְאוֹת הַכֹּל.');
            try{ var top=host.querySelector('.bk-card'); if(top){ render(host, date); setMsg(host,'ok','✓ שֻׁחְזַר בְּהַצְלָחָה · '+res.written+' מַפְתְּחוֹת. רַעֲנֵן אֶת הַדַּף.'); } }catch(_){}
          } else {
            setMsg(host,'err','✗ '+esc(res.error||'הַשִּׁחְזוּר נִכְשַׁל'));
          }
        });
      });
    }
  }

  /* ===================== public API ===================== */
  window.__backup = {
    render: render,
    export: exportData,            // export() — gather + download
    import: importData,            // import(fileOrJsonOrObj, {mode,confirm}) → Promise
    summary: summary,              // {keys,totalBytes,rows,families}
    // internals exposed for the integrator + tests (honest, inspectable)
    _buildPayload: buildPayload,
    _validate: validate,
    _applyPayload: applyPayload,
    _appKeys: appKeys,
    _labelFor: labelFor,
    _ensureCSS: ensureCSS,
    PREFIX: PREFIX,
    ENVELOPE: ENVELOPE
  };
})();
