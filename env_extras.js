/* ===================================================================
   env_extras.js — the EXTRA environmental readout for the environment tab.

   Surfaces the HARVESTED-but-never-shown area data for Larkmont /
   Larkmont Vale / the the highlands highlands as a gift-grade, READABLE readout
   (NOT raw GIS/CSV dumps). Four sections, each built ONLY from real
   harvested data curated into data/env_extras.json:
     🪨 Geology  — the larkmont-vale's strata/ages +
                          notable sites (regional geo survey 1:200k map + curated summary)
     💧 Groundwater    — the the highlands aquifers + nearest boreholes + desert
                          springs (Water Authority + Hydrological Service)
     🗺️ History  — town timeline + Old Trade Road + 'Old Fort 3D + the two
                          honest map insets (CC0 + Public-Domain)
     🌿 Vegetation      — seasonal NDVI (Sentinel-2 via Earth Engine)

   HONESTY: every card carries a source/license; each section flags whether
   it is a curated summary or a filtered dataset, and surfaces the real gaps
   (detailed map gated, spring-flow series missing for the larkmont-vale springs,
   historical orthos 401-gated, maps not georeferenced). Nothing fabricated.

   PUBLIC API (the ONLY hook; wired from panels.renderEnv by the human):
     window.__envExtras.render(host, date)
       host : a DOM element to append the readout into (the env tab's body,
              or a sub-container the human creates). The module appends ONE
              child (#envx) and re-renders idempotently on repeat calls.
       date : optional Date (currently unused by the static readout; kept in
              the signature so the wiring matches renderEnv(date) and so a
              future season-aware default can use it).
     window.__envExtras.ready()  → bool: data loaded
     window.__envExtras.data()   → the parsed JSON (or null)

   This file OWNS its own DOM (#envx) + scoped CSS (.envx-*) and NEVER
   touches #inst, panels.js, app.js, or the WebGL scene. Data is fetched
   ONCE from data/env_extras.json (bundled offline) and cached.
   =================================================================== */
(function(){
  if(window.__envExtras) return;
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};

  /* ---------------- data (fetch once, cache) ---------------- */
  // _failed flags a load that finished with no data (fetch error / non-OK / null body)
  // so render() can show a "retry" state AND so the next render() actually re-fetches:
  // a failed load CLEARS _loading (the cached promise) — otherwise the settled-null
  // promise sticks forever and the section stays permanently empty.
  let DATA=null, _loading=null, _pendingHost=null, _failed=false;
  function load(){
    if(DATA) return Promise.resolve(DATA);
    if(_loading) return _loading;
    if(typeof fetch!=='function'){ _failed=true; return Promise.resolve(null); }
    _failed=false;
    _loading=fetch('data/env_extras.json')
      .then(r=>r&&r.ok?r.json():null)
      .then(j=>{ DATA=j||null; if(!DATA){ _failed=true; _loading=null; } return DATA; })
      .catch(()=>{ DATA=null; _failed=true; _loading=null; return null; });
    return _loading;
  }
  // kick the fetch as soon as the module loads (so the first render is instant).
  try{ load(); }catch(e){}

  /* ---------------- CSS (the #inst brass-on-glass language, scoped .envx-*) ----------------
     Matches the env tab's dark/gold RTL palette (gold #caa15a, ink #efe6cf on
     glass) so the readout reads as the same instrument family as the rest of
     the environment tab. Self-contained — no shared selectors with #inst. */
  const CSS=`
  #envx{font-family:'Heebo',sans-serif;color:#efe6cf;margin-top:18px}
  #envx .ex-h{font-family:'Frank Ruhl Libre',serif;font-weight:500;font-size:16.5px;color:#fff7e6;
    display:flex;align-items:center;gap:8px;margin:20px 0 4px}
  #envx .ex-h .ee{font-size:18px}
  #envx .ex-h .flag{font-size:9px;padding:1px 8px;border-radius:20px;white-space:nowrap;margin-inline-start:auto;font-family:'Heebo',sans-serif}
  #envx .flag.dataset{background:rgba(120,150,210,.16);color:#bcd0f0;border:1px solid rgba(120,150,210,.4)}
  #envx .flag.curated{background:rgba(224,178,74,.18);color:#e8c474;border:1px solid rgba(224,178,74,.42)}
  #envx .ex-intro{font-size:11.5px;color:#bdb091;line-height:1.6;margin:2px 0 9px}
  #envx .ex-card{background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.16);border-radius:9px;
    padding:11px 13px;margin-top:9px}
  #envx .ex-ct{font-family:'Bellefair',serif;letter-spacing:.04em;font-size:12.5px;color:#caa15a;
    margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:6px}
  #envx .ex-row{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;font-size:12px;color:#d6ccb2;
    padding:6px 0;border-top:1px solid rgba(202,161,90,.1)}
  #envx .ex-row:first-of-type{border-top:none}
  #envx .ex-row b{color:#fff7e6;font-weight:600;text-align:left}
  #envx .ex-row .sym{font-family:'Bellefair',serif;color:#caa15a;font-size:10.5px;letter-spacing:.04em;
    min-width:46px;text-align:left}
  #envx .ex-li{padding:7px 0;border-top:1px solid rgba(202,161,90,.1)}
  #envx .ex-li:first-child{border-top:none}
  #envx .ex-li .nm{color:#fff7e6;font-size:12.5px;font-weight:600}
  #envx .ex-li .meta{font-size:10px;color:#a99b78;margin-inline-start:6px}
  #envx .ex-li .ds{font-size:10.5px;color:#bdb091;line-height:1.5;margin-top:2px}
  #envx .ex-note{font-size:10.5px;color:#bdb091;line-height:1.6;margin-top:8px;
    border-inline-start:2px solid rgba(202,161,90,.3);padding-inline-start:9px}
  #envx .ex-gap{font-size:10px;color:#c9a98a;line-height:1.6;margin-top:7px;
    border-inline-start:2px solid rgba(200,130,90,.45);padding-inline-start:9px}
  #envx .ex-gap b{color:#e6b48a}
  #envx .ex-src{font-size:9.5px;color:#8f835f;line-height:1.6;margin-top:8px}
  #envx .ex-src a{color:#caa15a;text-decoration:none}
  #envx .ex-src a:hover{text-decoration:underline}
  #envx .ex-pill{font-size:9px;padding:1px 7px;border-radius:20px;white-space:nowrap}
  #envx .ex-pill.green{background:rgba(120,200,120,.16);color:#a7e0a7;border:1px solid rgba(120,200,120,.4)}
  #envx .ex-pill.amber{background:rgba(224,178,74,.18);color:#e8c474;border:1px solid rgba(224,178,74,.4)}
  #envx .ex-pill.blue{background:rgba(120,150,210,.16);color:#bcd0f0;border:1px solid rgba(120,150,210,.4)}
  #envx .ex-imgs{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  #envx .ex-img{flex:1 1 30%;min-width:90px;text-align:center}
  #envx .ex-img img{width:100%;border-radius:7px;border:1px solid rgba(202,161,90,.22);display:block;background:#0b0d18}
  #envx .ex-img .cap{font-size:9.5px;color:#bdb091;margin-top:3px;line-height:1.35}
  #envx .ex-img .ndvi{font-family:'Bellefair',serif;color:#caa15a;font-size:11px}
  #envx .ex-bar{height:7px;border-radius:20px;background:rgba(255,255,255,.07);overflow:hidden;margin:3px 0 2px}
  #envx .ex-bar i{display:block;height:100%;border-radius:20px;background:linear-gradient(90deg,#7a5a2a,#9bb04a,#4da866)}
  #envx .ex-empty{font-size:11px;color:#a99b78;padding:10px 2px}
  #envx .ex-foot{font-size:9px;color:#7d7150;margin-top:16px;line-height:1.6}
  @media(max-width:760px){
    #envx{margin-top:12px}
    #envx .ex-h{font-size:15px;margin:16px 0 4px;flex-wrap:wrap}
    #envx .ex-h .flag{font-size:9px}
    #envx .ex-intro{font-size:11.5px}
    #envx .ex-card{padding:10px 11px}
    /* clickable map-focus rows: comfortable tap area on touch */
    #envx .ex-li.clk,#envx .ex-row.clk{min-height:34px;padding-top:9px;padding-bottom:9px}
    /* image rows (history maps, NDVI seasons): 2-up so captions stay readable, never squashed to a sliver */
    #envx .ex-imgs{gap:7px}
    #envx .ex-img{flex:1 1 44%;min-width:120px}
    #envx .ex-img .cap{font-size:10px}
    #envx .ex-row{font-size:11.5px;gap:8px}
    /* let a long Hebrew label + value wrap instead of crushing each other */
    #envx .ex-row b{text-align:left}
    #envx .ex-li .nm{font-size:12px}
    #envx .ex-src{font-size:9.5px}
    #envx .ex-src a{word-break:break-word}
  }
  `;
  let _cssInjected=false;
  function ensureCSS(){
    if(_cssInjected) return;
    try{ document.head.appendChild(el('style',null,CSS)); _cssInjected=true; }catch(e){}
  }

  /* ---------------- helpers ---------------- */
  function sourcesHtml(arr){
    if(!Array.isArray(arr)||!arr.length) return '';
    const parts=arr.map(s=>{
      const label=esc((s.name_he||'')+(s.org?(' · '+s.org):''));
      const lic=s.license_he?` <span style="color:#7d7150">(${esc(s.license_he)})</span>`:'';
      return s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener">${label}</a>${lic}`:`${label}${lic}`;
    });
    return `<div class="ex-src">Source: ${parts.join(' · ')}</div>`;
  }
  function gapHtml(g){ return g?`<div class="ex-gap"><b>Gap:</b> ${esc(g)}</div>`:''; }
  function flagHtml(f){
    if(f==='dataset') return `<span class="flag dataset">Filtered dataset</span>`;
    if(f==='curated') return `<span class="flag curated">Curated summary</span>`;
    return '';
  }
  function header(emoji,title,flag){
    return `<div class="ex-h"><span class="ee">${emoji}</span>${esc(title)}${flagHtml(flag)}</div>`;
  }

  /* ---------------- 🪨 GEOLOGY ---------------- */
  function geologyHtml(G){
    if(!G) return '';
    let h=header('🪨', G.title_he||'Geology', G.flag);
    if(G.intro_he) h+=`<div class="ex-intro">${esc(G.intro_he)}</div>`;
    // mechanism + dimensions
    if(G.mechanism_he||G.dimensions){
      h+=`<div class="ex-card"><div class="ex-ct">How the valley formed</div>`;
      if(G.mechanism_he) h+=`<div class="ex-li"><div class="ds">${esc(G.mechanism_he)}</div></div>`;
      const d=G.dimensions;
      if(d){
        h+=`<div class="ex-row"><span>Length</span><b>${esc(d.length_km)} km</b></div>`+
           `<div class="ex-row"><span>Width</span><b>${esc(d.width_km)} km</b></div>`+
           `<div class="ex-row"><span>Depth</span><b>${esc(d.depth_m)} m</b></div>`;
        if(d.claim_he) h+=`<div class="ex-note">${esc(d.claim_he)}</div>`;
      }
      h+=`</div>`;
    }
    // stratigraphy table (oldest → youngest)
    if(Array.isArray(G.strata)&&G.strata.length){
      h+=`<div class="ex-card"><div class="ex-ct">Rock section · old ← new <span class="ex-pill amber">regional geo survey 1:200k</span></div>`;
      if(G.stratigraphy_note_he) h+=`<div class="ds" style="font-size:10.5px;color:#bdb091;line-height:1.55;margin-bottom:4px">${esc(G.stratigraphy_note_he)}</div>`;
      h+=G.strata.map(s=>
        `<div class="ex-li"><div><span class="nm">${esc(s.name_he)}</span> <span class="meta">${esc(s.symbol||'')} · ${esc(s.age_he||'')}</span></div>`+
        `<div class="ds">${esc(s.lithology_he||'')}</div></div>`
      ).join('');
      h+=`</div>`;
    }
    // fossils + no-active-faults
    if(G.fossils_he||G.no_active_faults_he){
      h+=`<div class="ex-card">`;
      if(G.fossils_he) h+=`<div class="ex-ct">🐚 Ammonites & fossils</div><div class="ds" style="font-size:11.5px;color:#d6ccb2;line-height:1.6">${esc(G.fossils_he)}</div>`;
      if(G.no_active_faults_he) h+=`<div class="ex-note" style="margin-top:9px">${esc(G.no_active_faults_he)}</div>`;
      h+=`</div>`;
    }
    // notable sites
    if(Array.isArray(G.sites)&&G.sites.length){
      h+=`<div class="ex-card"><div class="ex-ct">Notable sites</div>`+
        G.sites.map(s=>{
          const ap=s.coord_approx?` <span class="ex-pill amber">Approx. coords</span>`:'';
          const mf=mfAttrs(s);
          return `<div class="ex-li${mf?' clk':''}"${mf}><div>${mf?'<span class="ex-pin">📍</span> ':''}<span class="nm">${esc(s.name_he)}</span> <span class="meta">${esc(s.type_he||s.name_en||'')}</span>${ap}</div>`+
            `<div class="ds">${esc(s.desc_he||'')}</div></div>`;
        }).join('')+`</div>`;
    }
    if(G.datasets_note_he) h+=`<div class="ex-note">${esc(G.datasets_note_he)}</div>`;
    h+=gapHtml(G.gap_he);
    h+=sourcesHtml(G.sources);
    return h;
  }

  /* ---------------- 💧 GROUNDWATER ---------------- */
  function groundwaterHtml(W){
    if(!W) return '';
    let h=header('💧', W.title_he||'Groundwater', W.flag);
    if(W.intro_he) h+=`<div class="ex-intro">${esc(W.intro_he)}</div>`;
    // nearest boreholes
    if(Array.isArray(W.nearest_boreholes)&&W.nearest_boreholes.length){
      h+=`<div class="ex-card"><div class="ex-ct">Nearest boreholes · Larkmont <span class="ex-pill blue">Water Authority</span></div>`;
      if(W.nearest_boreholes_he) h+=`<div class="ds" style="font-size:10.5px;color:#bdb091;line-height:1.55;margin-bottom:4px">${esc(W.nearest_boreholes_he)}</div>`;
      h+=W.nearest_boreholes.map(b=>{
        const st=(b.status_he==='active')?`<span class="ex-pill green">active</span>`:`<span class="ex-pill amber">${esc(b.status_he||'')}</span>`;
        const mf=mfAttrs(b);
        const ap=mf?` <span class="ex-pill amber">Approx. coords</span>`:'';
        return `<div class="ex-row${mf?' clk':''}"${mf}><span>${mf?'<span class="ex-pin">📍</span> ':''}${esc(b.name_he)} <span class="meta">${esc(b.aquifer_he||'')}</span>${ap}</span><b>${st}</b></div>`;
      }).join('');
      if(W.region_stats_he) h+=`<div class="ex-note">${esc(W.region_stats_he)}</div>`;
      h+=`</div>`;
    }
    // aquifer legend
    if(Array.isArray(W.aquifers_legend)&&W.aquifers_legend.length){
      h+=`<div class="ex-card"><div class="ex-ct">Aquifers in the area</div>`+
        W.aquifers_legend.map(a=>`<div class="ex-row"><span class="sym">${esc(a.code)}</span><b style="text-align:left;flex:1">${esc(a.name_he)}</b></div>`).join('')+
        `</div>`;
    }
    // springs
    if(Array.isArray(W.springs)&&W.springs.length){
      h+=`<div class="ex-card"><div class="ex-ct">Springs in the area</div>`;
      if(W.springs_intro_he) h+=`<div class="ds" style="font-size:10.5px;color:#bdb091;line-height:1.55;margin-bottom:4px">${esc(W.springs_intro_he)}</div>`;
      h+=W.springs.map(s=>{
        const elev=(s.elev_m!=null)?` · elev. ${esc(s.elev_m)} m`:'';
        const mf=mfAttrs(s);
        return `<div class="ex-li${mf?' clk':''}"${mf}><div>${mf?'<span class="ex-pin">📍</span> ':''}<span class="nm">${esc(s.name_he)}</span> <span class="meta">${esc(s.aquifer_he||'')}${elev}</span></div>`+
          `<div class="ds">${esc(s.note_he||s.type_he||'')}</div></div>`;
      }).join('')+`</div>`;
    }
    if(W.datasets_note_he) h+=`<div class="ex-note">${esc(W.datasets_note_he)}</div>`;
    h+=gapHtml(W.gap_he);
    h+=sourcesHtml(W.sources);
    return h;
  }

  /* ---------------- 🗺️ HISTORY ---------------- */
  function historyHtml(H){
    if(!H) return '';
    let h=header('🗺️', H.title_he||'History', H.flag);
    if(H.town_intro_he) h+=`<div class="ex-intro">${esc(H.town_intro_he)}</div>`;
    // timeline
    if(Array.isArray(H.timeline)&&H.timeline.length){
      h+=`<div class="ex-card"><div class="ex-ct">Timeline · the town</div>`+
        H.timeline.map(t=>`<div class="ex-row"><span class="sym">${esc(t.year)}</span><span style="text-align:left;flex:1;color:#d6ccb2">${esc(t.event_he)}</span></div>`).join('');
      if(H.timeline_note_he) h+=`<div class="ex-note">${esc(H.timeline_note_he)}</div>`;
      h+=`</div>`;
    }
    // old road sites + landmark 3D
    if(Array.isArray(H.trade_sites)&&H.trade_sites.length){
      h+=`<div class="ex-card"><div class="ex-ct">🏛️ The old road <span class="ex-pill amber">Fictional</span></div>`;
      if(H.trade_road_intro_he) h+=`<div class="ds" style="font-size:11px;color:#d6ccb2;line-height:1.6;margin-bottom:4px">${esc(H.trade_road_intro_he)}</div>`;
      h+=H.trade_sites.map(s=>{
        const prec=(s.coord_quality==='precise')?` <span class="ex-pill green">Precise coords</span>`:` <span class="ex-pill amber">Approx. coords</span>`;
        const mf=mfAttrs(s);
        return `<div class="ex-li${mf?' clk':''}"${mf}><div>${mf?'<span class="ex-pin">📍</span> ':''}<span class="nm">${esc(s.name_he)}</span> <span class="meta">${esc(s.category_he||'')}</span>${prec}</div>`+
          `<div class="ds">${esc(s.note_he||'')}</div></div>`;
      }).join('')+`</div>`;
    }
    if(H.landmark_3d){
      const a=H.landmark_3d;
      h+=`<div class="ex-card"><div class="ex-ct">🏺 ${esc(a.name_he||'the fort')} <span class="ex-pill blue">3D</span></div>`+
        `<div class="ds" style="font-size:11.5px;color:#d6ccb2;line-height:1.6">${esc(a.desc_he||'')}</div>`+
        (a.credit_he?`<div class="ex-src">Credit: ${esc(a.credit_he)}${a.source_url?` · <a href="${esc(a.source_url)}" target="_blank" rel="noopener">Source</a>`:''}</div>`:'')+
        `</div>`;
    }
    // honest map insets
    if(Array.isArray(H.maps)&&H.maps.length){
      h+=`<div class="ex-card"><div class="ex-ct">Historical maps <span class="ex-pill amber">Inset</span></div>`+
        `<div class="ex-imgs">`+
        H.maps.map(m=>
          `<div class="ex-img"><img src="${esc(m.img)}" alt="${esc(m.title_he||'')}" loading="lazy">`+
          `<div class="cap"><b style="color:#efe6cf">${esc(m.title_he||'')}</b><br>${esc(m.license_he||'')}</div></div>`
        ).join('')+
        `</div>`+
        H.maps.filter(m=>m.note_he).map(m=>`<div class="ds" style="font-size:10px;color:#bdb091;line-height:1.5;margin-top:6px">${esc(m.title_he)}: ${esc(m.note_he)}</div>`).join('')+
        `</div>`;
    }
    h+=gapHtml(H.gap_he);
    h+=sourcesHtml(H.sources);
    return h;
  }

  /* ---------------- 🌿 VEGETATION (NDVI) ---------------- */
  function vegetationHtml(V){
    if(!V) return '';
    let h=header('🌿', V.title_he||'Vegetation', V.flag);
    if(V.intro_he) h+=`<div class="ex-intro">${esc(V.intro_he)}</div>`;
    if(Array.isArray(V.seasons)&&V.seasons.length){
      // scale NDVI bar fill: 0.04..0.12 → 0..100% (desert range), clamped.
      const pct=v=>{ if(v==null||!isFinite(v)) return 0; return Math.max(0,Math.min(100,Math.round((v-0.04)/0.08*100))); };
      h+=`<div class="ex-card"><div class="ex-ct">Seasonal NDVI <span class="ex-pill blue">Sentinel-2 · 10 m</span></div>`+
        `<div class="ex-imgs">`+
        V.seasons.map(s=>
          `<div class="ex-img"><img src="${esc(s.img)}" alt="${esc(s.name_he||'')}" loading="lazy">`+
          `<div class="cap"><b style="color:#efe6cf">${esc(s.name_he||'')}</b><br><span class="ndvi">NDVI ${esc(s.mean_ndvi)}</span></div></div>`
        ).join('')+
        `</div>`;
      // per-season bars + note
      h+=V.seasons.map(s=>
        `<div style="margin-top:8px"><div class="ex-row" style="border-top:none;padding-bottom:2px"><span>${esc(s.name_he)} <span class="meta">${esc(s.period||'')}</span></span><b>${esc(s.mean_ndvi)}</b></div>`+
        `<div class="ex-bar"><i style="width:${pct(s.mean_ndvi)}%"></i></div>`+
        (s.note_he?`<div class="ds" style="font-size:10px;color:#bdb091">${esc(s.note_he)}</div>`:'')+`</div>`
      ).join('');
      h+=`</div>`;
    }
    if(V.delta_he) h+=`<div class="ex-note">${esc(V.delta_he)}</div>`;
    if(V.datasets_note_he) h+=`<div class="ex-note">${esc(V.datasets_note_he)}</div>`;
    h+=gapHtml(V.gap_he);
    h+=sourcesHtml(V.sources);
    return h;
  }

  /* ---------------- render ---------------- */
  function paint(host){
    if(!host) return;
    ensureCSS();
    // reuse our own #envx node inside this host (idempotent re-render).
    let box=host.querySelector?host.querySelector('#envx'):null;
    if(!box){ box=el('div'); box.id='envx'; box.setAttribute('dir','ltr'); host.appendChild(box); }
    if(!DATA){
      // failed to load → a small honest "retry" state (not a frozen loading dots line).
      // tapping it clears the cache and re-fetches; the next render repaints when data lands.
      if(_failed){
        box.innerHTML=`<div class="ex-empty ex-retry" role="button" tabindex="0" style="cursor:pointer">Environment layers failed to load — retry 🔄</div>`;
      }else{
        box.innerHTML=`<div class="ex-empty">Loading additional environment layers…</div>`;
      }
      return;
    }
    const m=DATA.meta||{};
    let html='';
    if(m.title_he){
      html+=`<div class="ex-h" style="margin-top:6px"><span class="ee">🌍</span>${esc(m.title_he)}</div>`;
      if(m.what_he) html+=`<div class="ex-intro">${esc(m.what_he)}</div>`;
    }
    // sections — emit ONLY those with real data
    html+=geologyHtml(DATA.geology);
    html+=groundwaterHtml(DATA.groundwater);
    html+=historyHtml(DATA.history);
    html+=vegetationHtml(DATA.vegetation);
    // honesty footer (license + provenance spine)
    let foot=[];
    if(m.honesty_he) foot.push(esc(m.honesty_he));
    if(m.license_summary_he) foot.push('Licenses — '+esc(m.license_summary_he));
    if(m.compiled_date) foot.push('Compiled '+esc(m.compiled_date));
    html+=`<div class="ex-foot">${foot.join(' · ')}</div>`;
    box.innerHTML=html;
  }

  /* ---------------- public API ---------------- */
  // clickable-place attrs: a site/spring/trade row that carries lat/lon → tapping it flies
  // the Leaflet place-map to that exact spot (he's spatial — SEE it on the map, not a list).
  const mfAttrs=(s,label)=>(s&&s.lat!=null&&s.lon!=null)?` data-mapfocus="1" data-lat="${s.lat}" data-lon="${s.lon}" data-label="${esc(label||s.name_he||'')}"`:'';
  let _focusWired=null;
  function wireFocus(host){
    if(_focusWired===host) return; _focusWired=host;
    if(typeof document!=='undefined' && !document.getElementById('ee-clk-css')){
      const st=document.createElement('style'); st.id='ee-clk-css';
      st.textContent='.ex-li.clk,.ex-row.clk{cursor:pointer;border-radius:6px;transition:background .15s}.ex-li.clk:hover,.ex-row.clk:hover{background:rgba(202,161,90,.1)}.ex-pin{font-size:10px;opacity:.82;margin-inline-end:1px}';
      (document.head||document.documentElement).appendChild(st);
    }
    host.addEventListener('click',function(e){
      // retry: tapping the "failed to load — retry" state re-fetches and repaints.
      const rt=e.target.closest&&e.target.closest('.ex-retry');
      if(rt){ _failed=false; _pendingHost=host; paint(host); load().then(()=>{ if(_pendingHost) paint(_pendingHost); }); return; }
      const it=e.target.closest&&e.target.closest('[data-mapfocus]'); if(!it) return;
      const lat=parseFloat(it.getAttribute('data-lat')), lon=parseFloat(it.getAttribute('data-lon'));
      if(!isFinite(lat)||!isFinite(lon)) return;
      const label=it.getAttribute('data-label')||'';
      if(window.__placeMap&&window.__placeMap.focus){ try{ window.__placeMap.focus(lat,lon,label); }catch(e){} }
      else if(window.Bus&&window.Bus.emit){ try{ window.Bus.emit('map:focus',{lat:lat,lon:lon,label:label}); }catch(e){} }
      const mp=(typeof document!=='undefined')?document.getElementById('env-map'):null;
      if(mp&&mp.scrollIntoView){ try{ mp.scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){} }
    });
  }
  function render(host, date){
    if(!host) return;
    wireFocus(host);
    if(DATA){ paint(host); return; }
    // not loaded yet → paint the placeholder now, then repaint when data lands.
    _pendingHost=host;
    paint(host);
    load().then(()=>{ if(_pendingHost) paint(_pendingHost); });
  }

  window.__envExtras={
    render,
    ready(){ return !!DATA; },
    data(){ return DATA; },
    _load:load   // exposed for tests / preloading
  };
})();
