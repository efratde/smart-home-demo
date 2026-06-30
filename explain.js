/* ===================================================================
   explain.js — the universal "?" affordance (window.Explain).
   ONE reusable component for every numeric value across the app.
   Hover  -> one-line gloss tooltip.
   Click  -> popover: הסבר (summary + "הערכה" flag) / הנתונים (rows) /
             מקור (source links) + a "פירוט מלא ←" button.
   Button -> method DRAWER (slides in, instrument skin): formula +
             data table + assumptions + reading links.
   model = { title, summary, estimate?, gloss?, data:[{k,v}],
             formula?, assumptions?:[string], sources:[{label,url}] }
   Skin per spec: bg #05060f, gold #caa15a, Frank Ruhl Libre / Heebo /
   Bellefair. Honesty discipline: estimate -> first-class "הערכה" badge;
   assumptions + source links are surfaced in the drawer.
   =================================================================== */
(function(){
  if(window.Explain) return;                       // idempotent (project pattern)
  // build an element; set classes via classList.add (keeps classList.contains
  // truthful in real DOM and in DOM stubs that back contains() with a Set),
  // falling back to .className where classList is unavailable.
  const el=(t,c,h)=>{
    const e=document.createElement(t);
    if(c){ if(e.classList&&typeof e.classList.add==='function') e.classList.add(...c.split(/\s+/)); else e.className=c; }
    if(h!=null) e.innerHTML=h;
    return e;
  };
  // defer a callback after `ms`; degrade to a synchronous call where no timer
  // exists (DOM-less hosts / test sandboxes) so nothing throws on a missing setTimeout.
  const defer=(fn,ms)=>{ if(typeof setTimeout==='function') return setTimeout(fn,ms||0); try{ fn(); }catch(_){} };
  // run a callback next frame; fall back to a deferred (or sync) call.
  const nextFrame=fn=>{ if(typeof window!=='undefined' && typeof window.requestAnimationFrame==='function') return window.requestAnimationFrame(fn); return defer(fn,16); };

  // ===================================================================
  // CONTENT REGISTRY — auto-fill a chip from data/explain_content.json by
  // its metric_id. A chip that only passes { metric_id } (or passes one
  // alongside a few explicit fields) gets title/what/how/data/source/caveat
  // filled from the generated content; EXPLICIT args always win (the JSON is
  // only a fallback/source). Fully defensive: if the file is missing or the
  // fetch fails, every chip degrades to exactly the old explicit-model behavior.
  // ===================================================================
  // 'measured'/'ephemeris' are real readings → no "הערכה" badge; everything
  // else (modeled|hybrid|static) is shown as an estimate (CLAUDE.md honesty).
  function isEstimateKind(kind){ return !(kind==='measured' || kind==='ephemeris'); }

  // split a "label: value" data_he row into the {k,v} the model wants. Rows
  // here are free Hebrew strings; we split on the FIRST ':' only when it looks
  // like a real "key: rest" (something before it), else keep the whole row as k.
  function splitRow(s){
    s=String(s==null?'':s);
    const ix=s.indexOf(':');
    return (ix>0) ? { k:s.slice(0,ix).trim(), v:s.slice(ix+1).trim() }
                  : { k:s, v:'' };
  }

  // map one explain_content.json entry → the explain.js model shape. Mirrors the
  // reference adapter the content test (explain_content.test.cjs) guarantees, so
  // every documented entry maps with no throw.
  function contentToModel(e){
    if(!e || typeof e!=='object') return null;
    const what=(e.what_he!=null?String(e.what_he):'');
    const how =(e.how_he!=null?String(e.how_he):'');
    const src = (e.source && e.source.name)
      ? [{ label:String(e.source.name), url:(e.source.url!=null?String(e.source.url):'') }]
      : [];
    return {
      title:    (e.title_he!=null?String(e.title_he):''),
      // popover summary leads with the plain "what"; the full method ("how")
      // lives in the drawer formula + is appended so the summary still reads well.
      summary:  what + (how ? ' — ' + how : ''),
      gloss:    what,                         // hover one-liner = the plain "what"
      estimate: isEstimateKind(e.kind),
      formula:  how,
      data:     Array.isArray(e.data_he) ? e.data_he.map(splitRow) : [],
      assumptions: (e.caveat_he!=null && String(e.caveat_he)) ? [String(e.caveat_he)] : [],
      sources:  src
    };
  }

  // ---- explain_content.json: fetch once, cache the parsed map (id → entry) ----
  let CONTENT=null;            // parsed JSON map once loaded (null until then)
  let contentPromise=null;     // in-flight fetch (so we load at most once)
  function loadContent(){
    if(CONTENT) return Promise.resolve(CONTENT);
    if(contentPromise) return contentPromise;
    if(typeof fetch!=='function'){ contentPromise=Promise.resolve(null); return contentPromise; }
    contentPromise=Promise.resolve()
      .then(()=>fetch('data/explain_content.json'))
      .then(r=>(r&&r.ok)?r.json():null)
      .then(j=>{ if(j&&typeof j==='object') CONTENT=j; return CONTENT; })
      .catch(()=>null);        // missing/blocked file → degrade silently
    return contentPromise;
  }
  // look up a metric's mapped model from already-loaded content (sync; null if
  // not loaded yet or unknown id). Skips the _meta block.
  function contentModel(metricId){
    if(!metricId || !CONTENT) return null;
    if(metricId==='_meta') return null;
    return contentToModel(CONTENT[metricId]);
  }

  // merge an auto-filled (content) model UNDER an explicit one — explicit wins.
  // Scalars: explicit value used when it's non-empty/truthy; arrays: explicit
  // used when it's a non-empty array; otherwise fall back to the content model.
  function mergeModels(base, over){
    if(!base) return over||{};
    if(!over) return base;
    const out=Object.assign({}, base);
    const has=v=>(v!=null && v!=='' && !(Array.isArray(v)&&v.length===0));
    Object.keys(over).forEach(k=>{
      if(k==='metric_id') return;
      if(k==='estimate'){ if('estimate' in over) out.estimate=!!over.estimate; return; }
      if(has(over[k])) out[k]=over[k];
    });
    return out;
  }

  // ---- sources.json: optional "מקורות / למד עוד" helper (domain → links) ----
  let SOURCES=null, sourcesPromise=null;
  function loadSources(){
    if(SOURCES) return Promise.resolve(SOURCES);
    if(sourcesPromise) return sourcesPromise;
    if(typeof fetch!=='function'){ sourcesPromise=Promise.resolve(null); return sourcesPromise; }
    sourcesPromise=Promise.resolve()
      .then(()=>fetch('data/sources.json'))
      .then(r=>(r&&r.ok)?r.json():null)
      .then(j=>{ if(j&&typeof j==='object') SOURCES=j; return SOURCES; })
      .catch(()=>null);
    return sourcesPromise;
  }
  // pull a domain group's curated links as explain.js {label,url} (sync; [] if
  // not loaded / unknown domain). label = name_he · org, per sources.json meta.
  function domainLinks(domain){
    if(!domain || !SOURCES || !Array.isArray(SOURCES[domain])) return [];
    return SOURCES[domain]
      .filter(s=>s && s.url)
      .map(s=>({ label:[s.name_he, s.org].filter(Boolean).join(' · '), url:String(s.url) }));
  }

  // ---- normalize a (possibly partial) model so nothing downstream throws ----
  function norm(m){
    m=m||{};
    return {
      title:      (m.title!=null?String(m.title):''),
      summary:    (m.summary!=null?String(m.summary):''),
      estimate:   !!m.estimate,
      gloss:      (m.gloss!=null?String(m.gloss):(m.summary!=null?String(m.summary):'')),
      data:       Array.isArray(m.data)?m.data.filter(r=>r&&r.k!=null):[],
      formula:    (m.formula!=null?String(m.formula):''),
      assumptions:Array.isArray(m.assumptions)?m.assumptions.filter(a=>a!=null).map(String):[],
      sources:    Array.isArray(m.sources)?m.sources.filter(s=>s&&s.label!=null):[]
    };
  }
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  // ---- one-time skin ----
  const css=`
  .xpl-chip{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;
    margin:0 5px;border-radius:50%;font-family:'Bellefair',serif;font-size:11px;line-height:1;
    color:#caa15a;background:rgba(202,161,90,.12);border:1px solid rgba(202,161,90,.45);
    cursor:pointer;vertical-align:middle;user-select:none;transition:background .15s,box-shadow .15s}
  .xpl-chip:hover{background:rgba(202,161,90,.28);color:#fff7e6;box-shadow:0 0 0 2px rgba(202,161,90,.2)}
  .xpl-gloss{position:fixed;z-index:60;max-width:240px;padding:6px 9px;border-radius:7px;
    font-family:'Heebo',sans-serif;font-size:11px;line-height:1.45;color:#efe6cf;direction:rtl;text-align:right;
    background:linear-gradient(160deg,rgba(12,14,26,.97),rgba(5,6,15,.98));border:1px solid rgba(202,161,90,.3);
    box-shadow:0 10px 30px rgba(0,0,0,.6);pointer-events:none}
  .xpl-pop{position:fixed;z-index:62;width:280px;max-width:calc(100vw - 24px);direction:rtl;text-align:right;
    font-family:'Heebo',sans-serif;color:#efe6cf;border-radius:10px;overflow:hidden;
    background:linear-gradient(160deg,rgba(12,14,26,.97),rgba(5,6,15,.98));
    border:1px solid rgba(202,161,90,.3);box-shadow:0 22px 56px rgba(0,0,0,.62);backdrop-filter:blur(12px)}
  .xpl-pop .xpl-hd{display:flex;align-items:baseline;justify-content:space-between;gap:8px;
    padding:11px 13px 7px;border-bottom:1px solid rgba(202,161,90,.16)}
  .xpl-pop .xpl-ttl{font-family:'Frank Ruhl Libre',serif;font-size:15px;color:#fff7e6}
  .xpl-estimate{font-size:9px;font-weight:700;color:#1a1606;background:linear-gradient(#caa15a,#a07c38);
    border-radius:20px;padding:2px 7px;white-space:nowrap}
  .xpl-pop .xpl-sec{padding:9px 13px;border-top:1px solid rgba(202,161,90,.12)}
  .xpl-pop .xpl-sec:first-of-type{border-top:none}
  .xpl-pop .xpl-lbl{font-family:'Bellefair',serif;letter-spacing:.1em;font-size:10px;color:#caa15a;margin-bottom:4px}
  .xpl-pop .xpl-sum{font-size:12.5px;line-height:1.5;color:#d6ccb2}
  .xpl-pop .xpl-data .xpl-r{display:flex;justify-content:space-between;gap:8px;font-size:12px;
    color:#d6ccb2;padding:3px 0}
  .xpl-pop .xpl-data .xpl-r b{color:#fff7e6;font-family:'Bellefair',serif}
  .xpl-pop .xpl-src a{display:block;font-size:11.5px;color:#9fb6e0;text-decoration:none;padding:2px 0}
  .xpl-pop .xpl-src a:hover{color:#cfe0ff;text-decoration:underline}
  .xpl-pop .xpl-ft{padding:9px 13px;border-top:1px solid rgba(202,161,90,.16);text-align:left}
  .xpl-more{font-family:'Heebo',sans-serif;font-size:11.5px;color:#e7dcc0;cursor:pointer;
    background:#16223c;border:1px solid rgba(202,161,90,.4);border-radius:7px;padding:6px 11px}
  .xpl-more:hover{background:#1d2c4c;color:#fff7e6}
  /* method DRAWER — slides in from the right (RTL), instrument skin */
  .xpl-scrim{position:fixed;inset:0;z-index:70;background:rgba(3,4,10,.55);backdrop-filter:blur(2px);opacity:0;
    transition:opacity .25s}
  .xpl-scrim.on{opacity:1}
  .xpl-drawer{position:fixed;top:0;right:0;bottom:0;z-index:71;width:380px;max-width:92vw;direction:rtl;text-align:right;
    font-family:'Heebo',sans-serif;color:#efe6cf;overflow-y:auto;transform:translateX(100%);transition:transform .28s ease;
    background:linear-gradient(160deg,rgba(10,12,22,.99),rgba(5,6,15,1));border-left:1px solid rgba(202,161,90,.3);
    box-shadow:-26px 0 70px rgba(0,0,0,.7)}
  .xpl-drawer.on{transform:translateX(0)}
  .xpl-drawer .dh{display:flex;align-items:baseline;justify-content:space-between;gap:8px;
    padding:18px 18px 12px;border-bottom:1px solid rgba(202,161,90,.18)}
  .xpl-drawer .dttl{font-family:'Frank Ruhl Libre',serif;font-size:20px;color:#fff7e6}
  .xpl-drawer .dx{cursor:pointer;font-size:18px;color:#a99b78;line-height:1;padding:2px 6px;border-radius:6px}
  .xpl-drawer .dx:hover{color:#fff7e6;background:rgba(202,161,90,.14)}
  .xpl-drawer .dsec{padding:14px 18px;border-top:1px solid rgba(202,161,90,.12)}
  .xpl-drawer .dlbl{font-family:'Bellefair',serif;letter-spacing:.12em;font-size:11px;color:#caa15a;margin-bottom:7px}
  .xpl-drawer .xpl-sum{font-size:13px;line-height:1.6;color:#d6ccb2}
  .xpl-formula{font-family:'Bellefair',serif;font-size:14px;color:#f3ead2;line-height:1.6;direction:ltr;text-align:left;
    background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.18);border-radius:8px;padding:9px 11px}
  .xpl-dtable{width:100%;border-collapse:collapse;font-size:12.5px}
  .xpl-dtable td{padding:6px 4px;border-top:1px solid rgba(202,161,90,.12);color:#d6ccb2}
  .xpl-dtable tr:first-child td{border-top:none}
  .xpl-dtable td.k{color:#a99b78} .xpl-dtable td.v{text-align:left;color:#fff7e6;font-family:'Bellefair',serif}
  .xpl-assume{margin:0;padding:0 16px 0 0;font-size:12.5px;line-height:1.65;color:#d6ccb2}
  .xpl-assume li{margin:3px 0}
  .xpl-srclink{display:block;font-size:12.5px;color:#9fb6e0;text-decoration:none;padding:4px 0}
  .xpl-srclink:hover{color:#cfe0ff;text-decoration:underline}
  .xpl-drawer .dnote{font-size:9.5px;color:#7d7150;padding:12px 18px;line-height:1.5}
  `;
  let cssInjected=false;
  function ensureCss(){ if(cssInjected) return; cssInjected=true; document.head.appendChild(el('style',null,css)); }

  // ---- singletons (no per-call DOM duplication) ----
  let popEl=null, popAnchor=null, glossEl=null, drawerEl=null, scrimEl=null, outsideHandler=null;

  function closePopover(){
    if(popEl){ popEl.remove(); popEl=null; }
    popAnchor=null;
    if(outsideHandler){ document.removeEventListener('click',outsideHandler,true); outsideHandler=null; }
  }
  function closeDrawer(){
    if(drawerEl){ drawerEl.classList.remove('on'); const d=drawerEl; defer(()=>{ if(d) d.remove(); },300); drawerEl=null; }
    if(scrimEl){ scrimEl.classList.remove('on'); const s=scrimEl; defer(()=>{ if(s) s.remove(); },300); scrimEl=null; }
  }
  function hideGloss(){ if(glossEl){ glossEl.remove(); glossEl=null; } }

  // ---- popover ----
  // NB: every element a consumer (or the test harness) needs to find via a CSS
  // selector is built as a REAL appended child with its class set through the
  // `el` helper — not buried inside an innerHTML string — so querySelector finds
  // it in real DOM and in DOM stubs that only walk the built child tree.
  function openPopover(anchor, m){
    closePopover();
    ensureCss();
    const pop=el('div','xpl-pop');
    // header: title + (optional) "הערכה" estimate badge — both real children
    const hd=el('div','xpl-hd');
    hd.appendChild(el('span','xpl-ttl',esc(m.title)));
    if(m.estimate) hd.appendChild(el('span','xpl-estimate','הערכה'));
    pop.appendChild(hd);
    // הסבר (summary)
    if(m.summary){
      pop.appendChild(el('div','xpl-sec',`<div class="xpl-lbl">הֶסְבֵּר</div><div class="xpl-sum">${esc(m.summary)}</div>`));
    }
    // הנתונים (data rows) — only if present
    if(m.data.length){
      const rows=m.data.map(r=>`<div class="xpl-r"><span>${esc(r.k)}</span><b>${esc(r.v)}</b></div>`).join('');
      pop.appendChild(el('div','xpl-sec xpl-data',`<div class="xpl-lbl">הַנְּתוּנִים</div>${rows}`));
    }
    // מקור (source links) — only if present
    if(m.sources.length){
      const links=m.sources.map(s=>`<a href="${esc(s.url||'#')}" target="_blank" rel="noopener">${esc(s.label)} ↗</a>`).join('');
      pop.appendChild(el('div','xpl-sec xpl-src',`<div class="xpl-lbl">מָקוֹר</div>${links}`));
    }
    // footer: "פירוט מלא ←" → drawer
    const ft=el('div','xpl-ft');
    const more=el('button','xpl-more','פֵּרוּט מָלֵא ←');
    more.addEventListener('click',e=>{ e.stopPropagation(); closePopover(); openDrawer(m); });
    ft.appendChild(more); pop.appendChild(ft);
    document.body.appendChild(pop);
    position(pop, anchor);
    // dismiss on outside click (capture; skip clicks inside the popover)
    outsideHandler=ev=>{ if(popEl && !popEl.contains(ev.target) && ev.target!==anchor) closePopover(); };
    document.addEventListener('click',outsideHandler,true);
    popEl=pop; popAnchor=anchor;
    return pop;
  }

  // ---- method drawer ----
  function openDrawer(m){
    closeDrawer();
    ensureCss();
    const scrim=el('div','xpl-scrim');
    scrim.addEventListener('click',closeDrawer);
    const d=el('div','xpl-drawer');
    // header: title + close ✕ — both real children so the ✕ listener can wire
    const dh=el('div','dh');
    dh.appendChild(el('span','dttl',esc(m.title)));
    const x=el('span','dx','✕');
    x.addEventListener('click',closeDrawer);
    dh.appendChild(x);
    d.appendChild(dh);
    // small helper: a labelled section whose body holds a real classed leaf el
    const sec=(labelHtml,leaf)=>{ const s=el('div','dsec'); s.appendChild(el('div','dlbl',labelHtml)); s.appendChild(leaf); d.appendChild(s); };
    // הסבר
    if(m.summary || m.estimate){
      sec('הֶסְבֵּר'+(m.estimate?' · הַעֲרָכָה':''), el('div','xpl-sum',esc(m.summary)));
    }
    // נוסחה (formula)
    if(m.formula){
      sec('נֻסְחָה', el('div','xpl-formula',esc(m.formula)));
    }
    // נתונים (data table)
    if(m.data.length){
      const rows=m.data.map(r=>`<tr><td class="k">${esc(r.k)}</td><td class="v">${esc(r.v)}</td></tr>`).join('');
      sec('נְתוּנִים', el('table','xpl-dtable',`<tbody>${rows}</tbody>`));
    }
    // הנחות (assumptions)
    if(m.assumptions.length){
      const lis=m.assumptions.map(a=>`<li>${esc(a)}</li>`).join('');
      sec('הַנָּחוֹת', el('ul','xpl-assume',lis));
    }
    // לקריאה נוספת (source links) — each link is a real .xpl-srclink child
    if(m.sources.length){
      const s=el('div','dsec'); s.appendChild(el('div','dlbl','לְקִרְיאָה נוֹסֶפֶת'));
      m.sources.forEach(src=>{
        const a=el('a','xpl-srclink',`${esc(src.label)} ↗`);
        a.href=src.url||'#'; a.target='_blank';
        if(typeof a.setAttribute==='function') a.setAttribute('rel','noopener');
        s.appendChild(a);
      });
      d.appendChild(s);
    }
    d.appendChild(el('div','dnote','שיטה ומקורות גלויים בכוונה — מספרים מסומנים "הערכה" אינם מדידה.'));
    document.body.appendChild(scrim); document.body.appendChild(d);
    // next-frame to trigger the slide-in transition (sync fallback in DOM-less hosts)
    nextFrame(()=>{ scrim.classList.add('on'); d.classList.add('on'); });
    scrimEl=scrim; drawerEl=d;
    return d;
  }

  // ---- viewport-aware positioning for the popover under/over the anchor ----
  function position(pop, anchor){
    if(!anchor || !anchor.getBoundingClientRect) return;
    const r=anchor.getBoundingClientRect();
    const vw=window.innerWidth||1024, vh=window.innerHeight||768, pw=288, gap=8;
    let left=Math.min(Math.max(8, r.left - pw + r.width), vw - pw - 8);
    let top=r.bottom + gap;
    if(top + 220 > vh) top=Math.max(8, r.top - 220);
    pop.style.left=left+'px'; pop.style.top=top+'px';
  }

  // ---- gloss tooltip (hover) ----
  function showGloss(anchor, text){
    if(!text) return;
    hideGloss();
    ensureCss();
    const g=el('div','xpl-gloss',esc(text));
    document.body.appendChild(g);
    if(anchor && anchor.getBoundingClientRect){
      const r=anchor.getBoundingClientRect(), vw=window.innerWidth||1024;
      g.style.left=Math.min(Math.max(8, r.left-200), vw-250)+'px';
      g.style.top=(r.bottom+6)+'px';
    }
    glossEl=g;
  }

  // resolve the live model for an anchor at INTERACTION time. If the caller gave
  // a metric_id, we merge the generated content (data/explain_content.json) UNDER
  // the explicit args — explicit always wins; the JSON fills the gaps. Resolving
  // lazily (not at build time) means a chip works whether the content arrives
  // before OR after it was created. No metric_id (or content not loaded) → the
  // explicit model verbatim, i.e. exactly the old behavior.
  function resolveModel(rawModel){
    const raw=rawModel||{};
    const mid=raw.metric_id;
    if(mid){
      const auto=contentModel(mid);
      if(auto) return norm(mergeModels(auto, raw));
    }
    return norm(raw);
  }

  // ---- public: attach to an existing element ----
  function attach(anchorEl, model){
    if(!anchorEl) return anchorEl;
    // if a metric_id was given, eagerly warm the content cache so the popover is
    // already filled by the time the user interacts (harmless no-op if no fetch).
    if(model && model.metric_id) loadContent();
    anchorEl.addEventListener('mouseenter',()=>showGloss(anchorEl,resolveModel(model).gloss));
    anchorEl.addEventListener('mouseleave',hideGloss);
    anchorEl.addEventListener('click',e=>{ e.stopPropagation(); hideGloss();
      // toggle off only if THIS chip's popover is the one open; clicking a
      // different chip switches to its popover (openPopover closes the prior one).
      if(popEl && popAnchor===anchorEl){ closePopover(); return; }
      openPopover(anchorEl,resolveModel(model)); });
    return anchorEl;
  }

  // ---- public: build a ready "?" chip ----
  // Pass an explicit model, a metric_id (auto-filled from explain_content.json),
  // or both (explicit fields win). e.g. Explain.chip({metric_id:'goOutScore'}).
  function chip(model){
    ensureCss();
    if(model && model.metric_id) loadContent();   // warm the cache early
    const c=el('span','xpl-chip','?');
    if(typeof c.setAttribute==='function'){       // guard: degrade gracefully in stub/DOM-less hosts
      c.setAttribute('role','button');
      c.setAttribute('aria-label','הסבר');
      // suppress the native tooltip once we have (or will have) a title to draw ourselves
      if(model && (model.title || model.metric_id)) c.setAttribute('title','');
    }
    return attach(c, model);
  }

  // ---- public helper: resolve a metric_id → mapped model (or null) ----
  // Lets callers build a chip from a pure id, or inspect what a metric maps to.
  // Returns the merged/normalized model (content fallback + any overrides).
  function model(metricId, overrides){
    const raw=Object.assign({ metric_id:metricId }, overrides||{});
    return resolveModel(raw);
  }

  window.Explain={
    chip, attach, model,
    // content registry
    loadContent, contentModel,
    // optional "מקורות / למד עוד" affordance
    loadSources, domainLinks,
    _closePopover:closePopover, _closeDrawer:closeDrawer
  };
})();
