/* ===================================================================
   agro.js — "אֲגְרוֹנוֹמְיָה לֶחָצֵר" — surfaces the harvested AGRICULTURE /
   agronomy data that the gift had gathered but never showed. Four
   curated cards, tailored to HIS five fruit crops at Larkmont
   (~300 m, dry highland), in the existing #inst dark/gold RTL Hebrew
   skin (the same brass-on-glass language as zone_card.js / workbench.js):

     🪨 הַקַּרְקַע שֶׁלְּךָ      — his exact site soil (group X1 / USDA
                               Aridisols-Cambids, shallow calcareous
                               loessial serozem over rock; ~1700–1800 mm/yr
                               evaporation; aridic regime) + what it means
                               for planting (deep holes, organic amendment,
                               mulch, frequent metered drip).
     💧 הַשְׁקָיָה אֲמִתִּית (Kc) — FAO-56 crop coefficients → readable
                               per-crop irrigation guidance; if the app's
                               live ET₀ is up (window.Weather.envAt('et0') or
                               dailyToday('dEt0')) it turns Kc into a real
                               ETc mm/day figure for today.
     🌳 שָׁעוֹת קֹר וּ-GDD      — his dry-highland winter gives real chill
                               (rare for this climate); compares site chill/GDD vs
                               each fruit tree's requirement and flags fit
                               (fig/pomegranate/olive excellent; almond/grape
                               good with care; citrus/date marginal).
     🐛 מַזִּיקִים וּמַחֲלוֹת    — quick reference of each crop's key pests +
                               an organic-allowed option (e.g. fig → black
                               fig fly → neem), curated from the ~1813-row
                               ministry-of-agriculture pesticide DB (NOT dumped).

   DATA: data/agro.json (bundled offline; curated SMALL bits out of
   harvest/agriculture/). All figures are model / reference values
   (FAO-56, orchard literature, agricultural GIS) — labelled honestly, never a
   sensor reading. Sources cited (agri-ministry / pomology research / FAO).

   PUBLIC API (the human wires this in — adds the <script> + calls render
   from the חצר/garden area): window.__agro.render(host, date) renders the
   cards into `host` (an element or an id string). Also: isReady(),
   onReady(fn), load(). Fully self-contained: owns its own CSS, never
   touches panels.js / garden.js / index.html or the WebGL scene.
   =================================================================== */
(function(){
  'use strict';
  if(window.__agro) return;

  var DATA=null, READY=false, _cbs=[], _loading=false;
  var _hosts=[];   // hosts we've rendered into → re-render when data lands

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function r1(v){ return (v==null||!isFinite(v))?null:Math.round(v*10)/10; }
  function r0(v){ return (v==null||!isFinite(v))?null:Math.round(v); }

  /* ---------- data load (offline bundle) ---------- */
  function markReady(){ if(READY) return; READY=true; var cbs=_cbs.splice(0);
    cbs.forEach(function(fn){ try{ fn(); }catch(e){} }); }
  function onReady(fn){ if(typeof fn!=='function') return;
    if(READY){ try{ fn(); }catch(e){} } else _cbs.push(fn); }
  function isReady(){ return READY; }

  function load(){
    if(DATA||_loading) return;
    _loading=true;
    if(typeof fetch!=='function'){ _loading=false; return; }
    try{
      fetch('data/agro.json').then(function(r){ return r&&r.ok? r.json():null; })
        .then(function(j){ DATA=j||{}; _loading=false; markReady(); reflowHosts(); })
        .catch(function(){ DATA=DATA||{}; _loading=false; markReady(); reflowHosts(); });
    }catch(e){ _loading=false; }
  }

  /* allow a test / the wiring to inject the JSON directly (no fetch). */
  function _setData(j){ DATA=j||{}; _loading=false; markReady(); reflowHosts(); }

  function reflowHosts(){
    _hosts.slice().forEach(function(h){ try{ if(h&&h.isConnected!==false) paint(h); }catch(e){} });
  }

  /* ---------- CSS (the #inst brass-on-glass language, scoped #agro) ----------
     Mirrors zone_card.js / workbench.js so the agronomy cards read as the same
     instrument family. Self-contained: no shared selectors, injected once. */
  var CSS=''+
  '#agroWrap{font-family:\'Heebo\',sans-serif;color:#efe6cf;direction:rtl;text-align:right}'+
  '#agroWrap .agcard{background:linear-gradient(160deg,rgba(12,14,26,.93),rgba(6,7,15,.95));'+
    'border:1px solid rgba(202,161,90,.22);border-radius:12px;padding:14px 15px;margin-bottom:13px;'+
    'box-shadow:0 12px 34px rgba(0,0,0,.4)}'+
  '#agroWrap .aghd{font-family:\'Frank Ruhl Libre\',serif;font-weight:500;font-size:18px;color:#fff7e6;'+
    'display:flex;align-items:center;gap:8px;line-height:1.15;margin-bottom:3px}'+
  '#agroWrap .aghd .age{font-size:19px}'+
  '#agroWrap .agsub{font-size:10.5px;color:#a99b78;line-height:1.45;margin-bottom:10px}'+
  '#agroWrap .agrow{display:flex;justify-content:space-between;gap:10px;align-items:center;font-size:12.5px;'+
    'color:#d6ccb2;padding:7px 0;border-top:1px solid rgba(202,161,90,.13)}'+
  '#agroWrap .agrow:first-of-type{border-top:none}'+
  '#agroWrap .agrow b{color:#fff7e6;font-weight:600}'+
  '#agroWrap .agrow .k{color:#a99b78}'+
  '#agroWrap .agnote{font-size:10.5px;color:#a99b78;line-height:1.55;margin-top:9px;'+
    'border-right:2px solid rgba(202,161,90,.3);padding-right:9px}'+
  '#agroWrap .aglist{margin:6px 0 0;padding:0;list-style:none}'+
  '#agroWrap .aglist li{font-size:11.5px;color:#d6ccb2;line-height:1.5;padding:3px 0 3px 0;'+
    'display:flex;gap:7px;align-items:flex-start}'+
  '#agroWrap .aglist li:before{content:\'•\';color:#caa15a;flex:0 0 auto}'+
  '#agroWrap .agct{font-family:\'Bellefair\',serif;letter-spacing:.05em;font-size:12px;color:#caa15a;'+
    'margin:11px 0 4px;display:flex;align-items:center;justify-content:space-between;gap:6px}'+
  '#agroWrap .agct:first-child{margin-top:2px}'+
  '#agroWrap .agpill{font-size:9.5px;padding:1px 8px;border-radius:20px;white-space:nowrap}'+
  '#agroWrap .agpill.amber{background:rgba(224,178,74,.18);color:#e8c474;border:1px solid rgba(224,178,74,.42)}'+
  '#agroWrap .agpill.green{background:rgba(120,200,120,.16);color:#a7e0a7;border:1px solid rgba(120,200,120,.42)}'+
  '#agroWrap .agpill.blue{background:rgba(120,150,210,.16);color:#bcd0f0;border:1px solid rgba(120,150,210,.42)}'+
  '#agroWrap .agpill.gray{background:rgba(255,255,255,.06);color:#bdb595;border:1px solid rgba(202,161,90,.25)}'+
  '#agroWrap .agpill.warm{background:rgba(210,120,120,.16);color:#e8b0b0;border:1px solid rgba(210,120,120,.42)}'+
  '#agroWrap .agtag{font-size:10px;color:#a99b78}'+
  '#agroWrap .agtable{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}'+
  '#agroWrap .agtable th{font-size:10px;color:#a99b78;font-weight:500;text-align:right;padding:4px 6px;'+
    'border-bottom:1px solid rgba(202,161,90,.22)}'+
  '#agroWrap .agtable td{padding:6px 6px;border-top:1px solid rgba(202,161,90,.1);color:#d6ccb2;vertical-align:top}'+
  '#agroWrap .agtable td b{color:#fff7e6;font-weight:600}'+
  '#agroWrap .agtable .crop{white-space:nowrap}'+
  '#agroWrap .agtable .crop .age{font-size:15px;margin-left:3px}'+
  '#agroWrap .agcrop{background:rgba(255,255,255,.035);border:1px solid rgba(202,161,90,.14);'+
    'border-radius:9px;padding:9px 11px;margin-top:9px}'+
  '#agroWrap .agcrop:first-of-type{margin-top:0}'+
  '#agroWrap .agcrop .ch{font-size:13px;color:#fff7e6;font-weight:600;margin-bottom:5px;'+
    'display:flex;align-items:center;gap:6px}'+
  '#agroWrap .agcrop .ch .age{font-size:16px}'+
  '#agroWrap .pest{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;'+
    'font-size:11.5px;color:#d6ccb2;padding:5px 0;border-top:1px solid rgba(202,161,90,.1)}'+
  '#agroWrap .pest:first-of-type{border-top:none}'+
  '#agroWrap .pest .pn{color:#fff7e6}'+
  '#agroWrap .pest .pl{font-size:9.5px;color:#8e835f;font-style:italic}'+
  '#agroWrap .pest .po{font-size:9.5px;color:#a7e0a7;text-align:left;white-space:nowrap;flex:0 0 auto}'+
  '#agroWrap .agfoot{font-size:9.5px;color:#7d7150;margin-top:4px;line-height:1.5}'+
  '#agroWrap .agempty{font-size:12px;color:#a99b78;padding:18px 4px;text-align:center}';

  var _cssDone=false;
  function ensureCss(){
    if(_cssDone) return; _cssDone=true;
    try{
      var st=document.createElement('style'); st.setAttribute('data-agro','1');
      st.innerHTML=CSS;
      (document.head||document.documentElement).appendChild(st);
    }catch(e){}
  }

  /* ---------- live ET₀ today (mm/day) from the app's Weather, if up ----------
     Open-Meteo daily FAO ET₀ is the cleanest source (Weather.dailyToday('dEt0')).
     Fall back to the hourly envAt('et0') × ~24 only if daily isn't there.
     Returns null when Weather isn't wired — the card then shows Kc alone. */
  function et0Today(date){
    var W=window.Weather; if(!W) return null;
    try{
      if(W.dailyToday){ var de=W.dailyToday('dEt0',date); if(de!=null&&isFinite(de)) return r1(de); }
    }catch(e){}
    try{
      if(W.envAt){ var h=W.envAt('et0',date); if(h==null) h=W.envAt('et0_fao_evapotranspiration',date);
        if(h!=null&&isFinite(h)) return r1(h*24); }
    }catch(e){}
    return null;
  }

  /* ============================== CARD: SOIL ============================== */
  function soilCard(){
    var s=(DATA&&DATA.site)||{};
    var sg=s.soil_group_DanRaz||{}, tx=s.soil_taxonomy_USDA||{};
    var traits=s.soil_traits_he||[], impl=s.planting_implications_he||[];
    var h='<div class="agcard"><div class="aghd"><span class="age">🪨</span>הַקַּרְקַע שֶׁלְּךָ</div>'+
      '<div class="agsub">'+esc(s.name_he||'לרקמונט')+' · ~'+esc(s.elev_m||300)+' מ׳ · '+
        esc(s.climate_he||'')+'</div>';
    h+='<div class="agct">זֶהוּת הַקַּרְקַע <span class="agpill amber">MoAG · GIS</span></div>';
    h+='<div class="agrow"><span class="k">קְבוּצַת קַרְקַע (דן ורז)</span>'+
        '<b>'+esc(sg.type||'X1')+' · '+esc(sg.desc_he||'')+'</b></div>';
    h+='<div class="agrow"><span class="k">טַקְסוֹנוֹמְיָה (USDA)</span>'+
        '<b>'+esc(tx.order_he||'')+(tx.suborder?(' / '+esc(tx.suborder)):'')+'</b></div>';
    if(tx.association_he) h+='<div class="agrow"><span class="k">שִׁיּוּךְ קַרְקָעִי</span><b>'+esc(tx.association_he)+'</b></div>';
    if(traits.length){
      h+='<ul class="aglist">'+traits.map(function(t){ return '<li>'+esc(t)+'</li>'; }).join('')+'</ul>';
    }
    h+='<div class="agct">אִיּוּד וּמַיִם <span class="agpill blue">דְּרִישַׁת הַשְׁקָיָה</span></div>';
    if(s.annual_evaporation_mm!=null) h+='<div class="agrow"><span class="k">אִיּוּד שְׁנָתִי</span><b>~'+esc(s.annual_evaporation_mm)+' מ״מ/שָׁנָה</b></div>';
    if(s.moisture_regime_he) h+='<div class="agrow"><span class="k">מִשְׁטַר רְטִיבוּת</span><b>'+esc(s.moisture_regime_he)+'</b></div>';
    if(impl.length){
      h+='<div class="agct">מַשְׁמָעוּת לִנְטִיעָה</div>';
      h+='<ul class="aglist">'+impl.map(function(t){ return '<li>'+esc(t)+'</li>'; }).join('')+'</ul>';
    }
    h+='<div class="agfoot">מָקוֹר: שִׁכְבוֹת GIS שֶׁל מִשְׂרַד הַחַקְלָאוּת (קְבוּצוֹת קַרְקַע דן ורז 1970, טקסונומיית USDA, אִיּוּד, מִשְׁטָרֵי קַרְקַע). נֻקְדַּת אֲחִיזָה: לרקמונט. עֶרֶךְ מַפָּה — לֹא דְּגִימָה בַּחָצֵר.</div>';
    h+='</div>';
    return h;
  }

  /* ============================== CARD: Kc / IRRIGATION ============================== */
  function kcCard(date){
    var k=(DATA&&DATA.kc)||{}, crops=k.crops||[];
    var et0=et0Today(date);
    var h='<div class="agcard"><div class="aghd"><span class="age">💧</span>הַשְׁקָיָה אֲמִתִּית (Kc)</div>'+
      '<div class="agsub">'+esc(k.note_he||'')+'</div>';
    if(et0!=null){
      h+='<div class="agct">ET₀ הַיּוֹם <span class="agpill green">חַי · Open-Meteo</span></div>'+
        '<div class="agrow"><span class="k">אִדּוּי יִחוּסִי (ET₀)</span><b>'+esc(et0)+' מ״מ/יוֹם</b></div>'+
        '<div class="agtag" style="margin:3px 0 6px">ETc = Kc × ET₀ (לְכָל 1 מ״ר חוֹפָה · 1 מ״מ = 1 לִיטֶר).</div>';
    } else {
      h+='<div class="agtag" style="margin:6px 0">ET₀ חַי לֹא זָמִין כָּעֵת — מֻצָּג Kc בִּלְבַד; כְּשֶׁהַמֶּזֶג מִתְעַדְכֵּן ETc יְחֻשַּׁב.</div>';
    }
    h+='<table class="agtable"><thead><tr>'+
      '<th>גִּדּוּל</th><th>Kc תְּחִלָּה</th><th>Kc שִׂיא</th><th>Kc סוֹף</th>'+
      (et0!=null?'<th>ETc הַיּוֹם*</th>':'')+
      '</tr></thead><tbody>';
    crops.forEach(function(c){
      var etcMid=(et0!=null&&c.kc_mid!=null)?r1(c.kc_mid*et0):null;
      h+='<tr><td class="crop"><span class="age">'+esc(c.emoji||'🌱')+'</span><b>'+esc(c.crop_he||c.crop)+'</b></td>'+
        '<td>'+esc(c.kc_ini!=null?c.kc_ini:'—')+'</td>'+
        '<td><b>'+esc(c.kc_mid!=null?c.kc_mid:'—')+'</b></td>'+
        '<td>'+esc(c.kc_end!=null?c.kc_end:'—')+'</td>'+
        (et0!=null?('<td>'+(etcMid!=null?('~'+etcMid+' מ״מ'):'—')+'</td>'):'')+
        '</tr>';
    });
    h+='</tbody></table>';
    if(et0!=null) h+='<div class="agtag" style="margin-top:5px">* ETc בִּשְׁלַב הַשִּׂיא (Kc_mid × ET₀ הַיּוֹם). לְעֵץ צָעִיר/קָטָן — לְהַקְטִין לְפִי אֲחוּז כִּסּוּי. נְשִׁירִים בַּחֹרֶף ≈ 0.</div>';
    h+='<div class="agnote">'+esc(k.stages_he?('שְׁלָבִים: '+k.stages_he.ini+' · '+k.stages_he.mid+' · '+k.stages_he.end+'.'):'')+'</div>';
    h+='<div class="agfoot">מָקוֹר: FAO-56 (טַבְלָה 12) + סִפְרוּת מַטָּעִים (Pereira 2024 לִתְאֵנָה/רִמּוֹן). עֶרְכֵי יִחוּס — לֹא מְדִידָה בַּחָצֵר.</div>';
    h+='</div>';
    return h;
  }

  /* ============================== CARD: CHILL / GDD ============================== */
  var FIT_PILL={ excellent:'green', good:'green', good_care:'amber', marginal:'warm' };
  var FIT_TXT={ excellent:'מְצֻיָּן', good:'טוֹב', good_care:'טוֹב בִּזְהִירוּת', marginal:'שׁוּלִי' };
  function chillCard(){
    var c=(DATA&&DATA.chill_gdd)||{}, trees=c.trees||[];
    var h='<div class="agcard"><div class="aghd"><span class="age">🌳</span>שָׁעוֹת קֹר וּ-GDD</div>'+
      '<div class="agsub">'+esc(c.context_he||'')+'</div>';
    h+='<table class="agtable"><thead><tr>'+
      '<th>עֵץ</th><th>שְׁעוֹת קֹר</th><th>Tbase</th><th>הַתְאָמָה</th>'+
      '</tr></thead><tbody>';
    trees.forEach(function(t){
      var fit=t.fit||'good', pill=FIT_PILL[fit]||'gray', ft=FIT_TXT[fit]||(t.chill_class_he||'');
      var chillRange=(t.chill_low!=null&&t.chill_high!=null)?
        ((t.chill_low===0&&t.chill_high===0)?'אֵין':(t.chill_low+'–'+t.chill_high)):'—';
      h+='<tr><td class="crop"><span class="age">'+esc(t.emoji||'🌳')+'</span><b>'+esc(t.tree_he||t.tree)+'</b></td>'+
        '<td>'+esc(chillRange)+'</td>'+
        '<td>'+esc(t.gdd_base_c!=null?(t.gdd_base_c+'°'):'—')+'</td>'+
        '<td><span class="agpill '+pill+'">'+esc(ft)+'</span></td>'+
        '</tr>';
    });
    h+='</tbody></table>';
    // a couple of plain-language fit lines for HIS crops (excellent/good_care first)
    var hisFits=trees.filter(function(t){ return t.his_plant!==false && t.fit_he; });
    if(hisFits.length){
      h+='<div class="agct">לַגִּדּוּלִים שֶׁלְּךָ</div><ul class="aglist">'+
        hisFits.map(function(t){ return '<li><b style="color:#fff7e6">'+esc(t.tree_he||t.tree)+':</b> '+esc(t.fit_he)+'</li>'; }).join('')+
        '</ul>';
    }
    h+='<div class="agfoot">מָקוֹר: מֶחְקָר חַקְלָאִי (שְׁבִירַת תַּרְדֵּמָה בְּקֹר-חֹרֶף לָקוּי) + טַבְלוֹת קֹר/GDD מְקֻבָּצוֹת. הַיִּתְרוֹן הַנָּדִיר שֶׁל לרקמונט: קֹר-חֹרֶף אֲמִתִּי. עֶרְכֵי דְּרִישָׁה — קֶצֶב הַצְּבִירָה בְּפֹעַל תָּלוּי-שָׁנָה.</div>';
    h+='</div>';
    return h;
  }

  /* ============================== CARD: PESTS ============================== */
  function pestCard(){
    var p=(DATA&&DATA.pests)||{}, crops=p.crops||[];
    var h='<div class="agcard"><div class="aghd"><span class="age">🐛</span>מַזִּיקִים וּמַחֲלוֹת</div>'+
      '<div class="agsub">'+esc(p.note_he||'')+'</div>';
    crops.forEach(function(c){
      h+='<div class="agcrop"><div class="ch"><span class="age">'+esc(c.emoji||'🌱')+'</span>'+esc(c.crop_he||c.crop)+'</div>';
      (c.items||[]).forEach(function(it){
        h+='<div class="pest"><div style="flex:1 1 auto">'+
          '<span class="pn">'+esc(it.pest_he||it.pest_en||'')+'</span>'+
          (it.pest_en?(' <span class="agtag">· '+esc(it.pest_en)+'</span>'):'')+
          (it.pest_lat?('<div class="pl">'+esc(it.pest_lat)+'</div>'):'')+
          '</div>'+
          (it.organic_he?('<div class="po">🌿 '+esc(it.organic_he)+'</div>'):'')+
          '</div>';
      });
      h+='</div>';
    });
    h+='<div class="agfoot">מָקוֹר: מָאֲגָר תַּכְשִׁירֵי הַגֲנַת הַצֹּמַח שֶׁל מִשְׂרַד הַחַקְלָאוּת (~1813 שׁוּרוֹת לַגִּדּוּלִים שֶׁלּוֹ — מְזֻקָּקוֹת לַמֶּרְכָּזִיּוֹת). תָּמִיד לַעֲבֹר עַל הַתָּוִית הָרִשְׁמִית: מִינוּן, תְּקוּפַת הַמְתָּנָה לִפְנֵי קָטִיף וּכְנִיסָה מֵחָדָשׁ.</div>';
    h+='</div>';
    return h;
  }

  /* ---------- paint into a host ---------- */
  function resolveHost(host){
    if(!host) return null;
    if(typeof host==='string'){
      try{ return document.getElementById(host)||document.querySelector(host); }catch(e){ return null; }
    }
    return host;   // assume an element
  }
  function paint(host){
    ensureCss();
    if(!DATA){
      host.innerHTML='<div id="agroWrap"><div class="agcard"><div class="agempty">טוֹעֵן נְתוּנֵי אֲגְרוֹנוֹמְיָה…</div></div></div>';
      return;
    }
    var meta=(DATA._meta)||{};
    var date=host.__agroDate||new Date();
    var inner=''+
      soilCard()+
      kcCard(date)+
      chillCard()+
      pestCard()+
      '<div class="agfoot" style="margin-top:2px">'+esc(meta.honesty_he||'כל המספרים הם ערכי מודל/ייחוס — לא מדידה באתר.')+'</div>';
    host.innerHTML='<div id="agroWrap" dir="rtl">'+inner+'</div>';
  }

  /* ---------- public render ---------- */
  function render(host, date){
    var el=resolveHost(host);
    if(!el) return;
    el.__agroDate=date||new Date();
    if(_hosts.indexOf(el)<0) _hosts.push(el);
    // keep the host list from growing without bound (drop detached ones)
    if(_hosts.length>8) _hosts=_hosts.filter(function(h){ return h&&h.isConnected!==false; });
    if(!DATA){ load(); }
    paint(el);
  }

  window.__agro={ render:render, load:load, isReady:isReady, onReady:onReady,
                  _setData:_setData, _data:function(){ return DATA; } };

  // kick off the data load eagerly so it's usually ready by the time the human
  // mounts the חצר tab and calls render().
  try{ load(); }catch(e){}
})();
