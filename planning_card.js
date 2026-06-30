/* ===================================================================
   planning_card.js — the "מה מותר בחלקה / תכנון" card (the HIDDEN gem).
   Surfaces the OFFICIAL planning that governs Alex's lot in Larkmont:
   WHICH plans (תכניות) rule the plot + their type/status + a deep link to
   each plan's official page on the plan registry, plus the land designation
   (יעוד קרקע) when the GIS carries a real one. Same #inst brass-on-glass
   RTL skin as zone_card.js / workbench.js — reads as the same instrument.

   DATA: a keyless, no-backend lookup served by a planning registry
   via window.Planning.load() (planning.js — we READ its API, never
   edit it). Planning.load() resolves a clean {plans,landUse,error,fetchedAt}
   and NEVER throws; we mirror that here — this card is defensive throughout
   and renders an honest state for every outcome (loading / loaded / empty /
   offline). The result is cached in localStorage with a ~30-day TTL inside
   planning.js, so opening the tab again is instant and works offline once
   seen. We surface that caveat honestly in the footer.

   HONESTY: the detailed build numbers — height / coverage / setbacks / FAR
   (גובה, כיסוי קרקע, מרווחי בנייה, יחס שטח בנוי) — live INSIDE the plan documents,
   NOT in the GIS attributes. So we do NOT fabricate any number; we name the
   governing plans accurately and link out to read the rules at the source.

   API exposed (the ONLY hook; the human wires the tab in panels.js):
     window.__planning.render(host, date)
       host : an Element to render into (cleared + filled). If missing/not an
              element, render() is a safe no-op and returns the host.
       date : optional Date (reserved; planning is date-independent today).
       → returns host. Kicks off Planning.load() and re-renders host in place
         when it resolves (only if host is still in the DOM / unchanged).
   Also: window.__planning.ensureCSS() (idempotent) and a passive
   window.__planning.refresh() are exposed for the wirer's convenience.
   =================================================================== */
(function(){
  if(window.__planning && window.__planning.render) return;   // re-injection safe
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  /* safeInline: escape a string but let our own authored <b>/<i> markup (from
     plot_rights.json — trusted, app-controlled) survive. Everything else,
     including any stray angle bracket, is escaped — no raw HTML from data.
     Done by escaping the whole string, then un-escaping only the four exact
     tags we allow (so &lt;b&gt; -> <b> but any other &lt;...&gt; stays escaped). */
  function safeInline(s){
    return esc(s).replace(/&lt;(\/?)(b|i)&gt;/g,'<$1$2>');
  }

  /* ---- the lot, for the human-readable header line (mirrors planning.js) ---- */
  const LON=-40.0000, LAT=34.0000;

  /* ---------------- CSS (the #inst brass-on-glass language, scoped #planCard) ----
     Mirrors zone_card.js's #zcPanel chrome so this reads as the same family,
     but it is an IN-FLOW card (renders into whatever host the tab gives it),
     not a floating overlay — so no fixed position / z-index. Self-contained:
     every selector is under #planCard, nothing leaks to #inst / panels. ---- */
  const CSS=`
  #planCard{font-family:'Heebo',sans-serif;color:#efe6cf;direction:rtl;text-align:right;
    text-shadow:0 1px 6px rgba(0,0,0,.6)}
  #planCard .pcwrap{display:flex;flex-direction:column;gap:11px;max-width:560px;margin:0 auto}
  #planCard .pchd{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
  #planCard h3{font-family:'Frank Ruhl Libre',serif;font-weight:500;font-size:20px;color:#fff7e6;
    line-height:1.15;margin:0;display:flex;align-items:center;gap:8px}
  #planCard h3 .pe{font-size:19px}
  #planCard .pcsub{font-size:10.5px;color:#a99b78;line-height:1.5;margin:2px 0 2px}
  #planCard .pcsub .lot{font-family:'Bellefair',serif;letter-spacing:.08em;color:#caa15a}
  #planCard .pcard{background:linear-gradient(160deg,rgba(12,14,26,.93),rgba(6,7,15,.95));
    border:1px solid rgba(202,161,90,.22);border-radius:10px;padding:13px 15px;
    box-shadow:0 12px 34px rgba(0,0,0,.45)}
  #planCard .pct{font-family:'Bellefair',serif;letter-spacing:.05em;font-size:13px;color:#caa15a;
    margin-bottom:9px;display:flex;align-items:center;justify-content:space-between;gap:8px}
  #planCard .pct .ptag{font-size:10px;color:#a99b78;letter-spacing:0}
  #planCard .plan{border-top:1px solid rgba(202,161,90,.14);padding:11px 0}
  #planCard .plan:first-of-type{border-top:none;padding-top:2px}
  #planCard .plan:last-of-type{padding-bottom:2px}
  #planCard .plan .pname{font-family:'Frank Ruhl Libre',serif;font-size:15.5px;color:#fff7e6;line-height:1.25}
  #planCard .plan .pmeta{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;align-items:center}
  #planCard .pnum{font-family:'Bellefair',serif;letter-spacing:.06em;font-size:11.5px;color:#d7c290;
    background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.18);border-radius:6px;padding:2px 8px}
  #planCard .ppill{font-size:9.5px;padding:2px 9px;border-radius:20px;white-space:nowrap;line-height:1.5}
  #planCard .ppill.amber{background:rgba(224,178,74,.18);color:#e8c474;border:1px solid rgba(224,178,74,.4)}
  #planCard .ppill.green{background:rgba(120,200,120,.16);color:#a7e0a7;border:1px solid rgba(120,200,120,.4)}
  #planCard .ppill.blue{background:rgba(120,150,210,.16);color:#bcd0f0;border:1px solid rgba(120,150,210,.4)}
  #planCard .ppill.grey{background:rgba(255,255,255,.05);color:#c9bd9c;border:1px solid rgba(202,161,90,.22)}
  #planCard a.pplanurl{display:inline-flex;align-items:center;gap:5px;font-size:11px;text-decoration:none;
    color:#1a1606;background:linear-gradient(#caa15a,#a07c38);border-radius:6px;padding:3px 11px;
    font-weight:600;text-shadow:none;margin-top:8px;transition:.15s}
  #planCard a.pplanurl:hover{filter:brightness(1.08)}
  #planCard a.pplanurl .ar{font-size:10px}
  #planCard .lurow{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13px;
    color:#d6ccb2;padding:7px 0;border-top:1px solid rgba(202,161,90,.12)}
  #planCard .lurow:first-of-type{border-top:none} #planCard .lurow b{color:#fff7e6;font-weight:600}
  #planCard .pnote{font-size:11px;color:#a99b78;line-height:1.55;border-right:2px solid rgba(202,161,90,.3);
    padding-right:9px;margin-top:4px}
  #planCard .prules{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:12.5px;
    color:#d6ccb2;margin-top:2px}
  #planCard .prules .k{color:#a99b78}
  #planCard .prules b{color:#fff7e6;font-weight:600}
  #planCard .pempty{font-size:12.5px;color:#c9bd9c;line-height:1.6;text-align:center;padding:6px 4px}
  #planCard .pload{display:flex;align-items:center;gap:9px;font-size:13px;color:#c9bd9c;justify-content:center;padding:8px 4px}
  #planCard .pspin{width:14px;height:14px;border-radius:50%;border:2px solid rgba(202,161,90,.3);
    border-top-color:#caa15a;display:inline-block;animation:pcspin 1s linear infinite}
  @keyframes pcspin{to{transform:rotate(360deg)}}
  #planCard .pfoot{font-size:9.5px;color:#7d7150;line-height:1.6;margin-top:2px}
  #planCard .pfoot a{color:#a99b78;text-decoration:underline}
  /* plan purpose line (plot-specific, straight from the GIS 'מטרות') */
  #planCard .ppurpose{font-size:11.5px;color:#cfc4a6;line-height:1.55;margin-top:7px;
    border-right:2px solid rgba(202,161,90,.28);padding-right:8px}
  /* scope chips: plot-specific (gold) vs generic (quiet) vs illustrative */
  #planCard .scope{font-size:8.5px;letter-spacing:.02em;padding:1px 7px;border-radius:20px;
    white-space:nowrap;vertical-align:middle;margin-inline-start:6px;line-height:1.6}
  #planCard .scope.plot{background:rgba(224,178,74,.16);color:#e8c474;border:1px solid rgba(224,178,74,.4)}
  #planCard .scope.gen{background:rgba(255,255,255,.045);color:#b7ac8c;border:1px solid rgba(202,161,90,.2)}
  #planCard .scope.ill{background:rgba(120,150,210,.14);color:#bcd0f0;border:1px solid rgba(120,150,210,.34)}
  /* possibility blocks (תוספת בנייה / חדר מָגֵן / קומה / חצר) */
  #planCard .poss{border-top:1px solid rgba(202,161,90,.14);padding:11px 0}
  #planCard .poss:first-of-type{border-top:none;padding-top:2px}
  #planCard .poss:last-of-type{padding-bottom:2px}
  #planCard .poss .ph{font-family:'Frank Ruhl Libre',serif;font-size:15px;color:#fff7e6;line-height:1.25;
    display:flex;align-items:center;gap:7px}
  #planCard .poss .ph .pi{font-size:16px}
  #planCard .poss .plead{font-size:11.5px;color:#bfb495;line-height:1.5;margin-top:3px}
  #planCard .poss ul{list-style:none;margin:7px 0 0;padding:0;display:flex;flex-direction:column;gap:5px}
  #planCard .poss li{font-size:12px;color:#d6ccb2;line-height:1.5;padding-right:14px;position:relative}
  #planCard .poss li::before{content:'•';position:absolute;right:2px;color:#caa15a}
  #planCard .poss li b{color:#fff7e6;font-weight:600}
  #planCard .pread{font-size:11px;color:#a99b78;line-height:1.5;margin-top:7px;
    background:rgba(255,255,255,.025);border:1px solid rgba(202,161,90,.16);border-radius:7px;padding:6px 9px}
  #planCard .pread .rk{color:#d7c290;font-weight:600}
  #planCard .pill-row{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 9px}
  #planCard .pill-row .ppill{cursor:default}
  #planCard .exlist{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:5px}
  #planCard .exlist li{font-size:12px;color:#d6ccb2;line-height:1.5;padding-right:16px;position:relative}
  #planCard .exlist li::before{content:'✓';position:absolute;right:0;color:#a7e0a7;font-size:11px}
  #planCard .links{display:flex;flex-direction:column;gap:6px;margin-top:3px}
  #planCard a.plink{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;text-decoration:none;
    color:#d7c290;background:rgba(255,255,255,.03);border:1px solid rgba(202,161,90,.2);border-radius:7px;
    padding:6px 10px;transition:.15s}
  #planCard a.plink:hover{background:rgba(202,161,90,.12);color:#fff7e6}
  #planCard a.plink .ar{font-size:10px;color:#a99b78}
  #planCard .perr{font-size:11.5px;color:#e0b0a0;line-height:1.6;
    background:rgba(120,40,30,.12);border:1px solid rgba(200,110,90,.3);border-radius:8px;padding:9px 11px}
  @media(max-width:560px){#planCard h3{font-size:18px}#planCard .pcwrap{gap:9px}}
  `;

  let cssDone=false;
  function ensureCSS(){
    if(cssDone) return;
    try{
      if(typeof document==='undefined'||!document.head) return;
      const st=document.createElement('style');
      st.id='planCardCSS'; st.textContent=CSS;
      document.head.appendChild(st); cssDone=true;
    }catch(e){}
  }

  /* ---- status → pill colour. A few well-known registry status descriptions get
     a meaningful colour; everything else stays neutral grey (honest, no guess). */
  function statusPill(status){
    const s=String(status||'');
    if(/מאוש|בתוקף|אישור/.test(s)) return 'green';          // approved / in force
    if(/הפקד|התנגד|השג/.test(s))   return 'amber';          // deposited / objections
    if(/בדיק|הכנ|דיון|תכנונית/.test(s)) return 'blue';      // in review / preparation
    return 'grey';
  }

  /* ---- a scope chip: marks each figure plot-specific (gold) vs generic-rule
     (quiet) vs illustrative-example (blue). The honesty contract made visible. */
  function scopeChip(scope){
    if(scope==='plot')          return `<span class="scope plot">לַמִּגְרָשׁ</span>`;
    if(scope==='illustrative')  return `<span class="scope ill">לְדֻגְמָה בִּלְבַד</span>`;
    if(scope==='generic')       return `<span class="scope gen">כְּלָל כְּלָלִי</span>`;
    return '';
  }

  /* ---- a single governing plan → its row. Now also shows the plan's stated
     PURPOSE (plot-specific, from the GIS) + approved dwelling-units when real. */
  function planHtml(p){
    if(!p) return '';
    const name=esc(p.name||'תכנית ללא שם');
    const num=p.number?`<span class="pnum">${esc(p.number)}</span>`:'';
    const sub=p.subtype?`<span class="ppill grey">${esc(p.subtype)}</span>`:'';
    const status=p.status?`<span class="ppill ${statusPill(p.status)}">${esc(p.status)}</span>`:'';
    // planUrl must be an http(s) URL to be a safe link; otherwise we omit it (no fake link).
    let link='';
    const mv=String(p.planUrl||'');
    if(/^https?:\/\//i.test(mv)){
      link=`<a class="pplanurl" href="${esc(mv)}" target="_blank" rel="noopener noreferrer">`+
           `קְרָא אֶת הַתָּכְנִית בְּמַאֲגַר הַתָּכְנִיּוֹת <span class="ar">↗</span></a>`;
    }
    // plot-specific PURPOSE line: what THIS plan actually regulates (e.g. a
    // local plan that increases coverage + allows storage sheds & pools).
    const purpose=(p.purpose && String(p.purpose).trim())
      ? `<div class="ppurpose">${esc(p.purpose)}${scopeChip('plot')}</div>` : '';
    // approved dwelling-units only when the GIS returned a real positive count.
    const homes=(p.homesApproved>0)
      ? `<span class="ppill grey">${esc(p.homesApproved)} יח"ד מאושרות</span>` : '';
    return `<div class="plan"><div class="pname">${name}</div>`+
      `<div class="pmeta">${num}${sub}${status}${homes}</div>${purpose}${link}</div>`;
  }

  /* ---- the land-designation block (only real designations; planning.js already
     suppresses the "אינה חלה" placeholder, so landUse[] here is real or empty). */
  function landUseHtml(landUse){
    const lu=Array.isArray(landUse)?landUse:[];
    if(!lu.length){
      return `<div class="pcard"><div class="pct">יִעוּד קַרְקַע <span class="ptag">מֵה‑GIS</span></div>`+
        `<div class="pempty">יִעוּד הַקַּרְקַע הַמְּדֻיָּק לֹא הֻחְזַר מֵהַשִּׁכְבָה הַגֵּאוֹגְרָפִית עֲבוּר הַנְּקֻדָּה הַזֹּאת — `+
        `הוּא מֻגְדָּר בְּתוֹךְ מִסְמְכֵי הַתָּכְנִיּוֹת לְמַעְלָה.</div></div>`;
    }
    return `<div class="pcard"><div class="pct">יִעוּד קַרְקַע <span class="ptag">מֵה‑GIS</span></div>`+
      lu.map(u=>`<div class="lurow"><span>יִעוּד</span><b>${esc(u)}</b></div>`).join('')+
      `</div>`;
  }

  /* ---- the "build rules" honest explainer — the FALLBACK used only when the
     rich plot_rights.json reference hasn't loaded. We deliberately DON'T
     fabricate numbers; we explain WHERE they live and link to the source. ---- */
  function rulesHtml(){
    return `<div class="pcard"><div class="pct">מָה מֻתָּר לִבְנוֹת? <span class="ptag">זְכוּיוֹת בְּנִיָּה</span></div>`+
      `<div class="pnote">הַמִּסְפָּרִים הַמְּדֻיָּקִים — גֹּבַהּ מֻתָּר, כִּסּוּי הַקַּרְקַע, יַחַס הַשֶּׁטַח הַבָּנוּי וּמֶרְחֲקֵי הַבְּנִיָּה `+
      `(הַמֶּרְחָק הַמִּזְעָרִי מִגְּבוּל הַמִּגְרָשׁ) — נִמְצָאִים בְּתוֹךְ <b>הוֹרְאוֹת הַתָּכְנִית</b> וְלֹא בַּשִּׁכְבָה `+
      `הַגֵּאוֹגְרָפִית. לְכֵן אֲנַחְנוּ לֹא מַמְצִיאִים מִסְפָּרִים כָּאן — לוֹחֲצִים עַל "קְרָא אֶת הַתָּכְנִית בְּמַאֲגַר הַתָּכְנִיּוֹת" `+
      `לְיַד כָּל תָּכְנִית כְּדֵי לִרְאוֹת אֶת הַזְּכוּיוֹת בַּמָּקוֹר הָרִשְׁמִי.</div></div>`;
  }

  /* ---- the CONCRETE possibilities block (plain Hebrew, NOT vocalised — this is
     planning prose the reader skims), driven by plot_rights.json. Each block is
     a renovation/extension pathway (תוספת בנייה / חדר מָגֵן / תוספת קומה / בנייה
     בחצר) with its points, a "how to read the real number" note, and scope chips
     so plot-specific vs generic is unambiguous. Returns '' if the data is
     absent, so the card degrades to the rulesHtml() fallback. ---- */
  function point(pt){
    if(!pt) return '';
    const he=(typeof pt==='string')?pt:(pt.he||'');
    if(!he) return '';
    // pt.he already contains trusted inline <b>…</b> markup we authored in the
    // JSON; allow only <b>/<i> through and escape everything else.
    return `<li>${safeInline(he)}${pt.scope?scopeChip(pt.scope):''}</li>`;
  }
  function possibilityHtml(p){
    if(!p) return '';
    const title=`<div class="ph"><span class="pi">${esc(p.icon||'•')}</span>${esc(p.title||'')}${p.scope?scopeChip(p.scope):''}</div>`;
    const lead=p.lead?`<div class="plead">${esc(p.lead)}</div>`:'';
    const pts=Array.isArray(p.points)?p.points.map(point).join(''):'';
    const ul=pts?`<ul>${pts}</ul>`:'';
    let read='';
    if(p.readNumber&&p.readNumber.he){
      read=`<div class="pread"><span class="rk">איך קוראים את המספר האמיתי:</span> ${safeInline(p.readNumber.he)}</div>`;
    }
    let est='';
    if(p.estimateNote&&p.estimateNote.he){
      est=`<div class="pread">${safeInline(p.estimateNote.he)}${scopeChip(p.estimateNote.scope||'illustrative')}</div>`;
    }
    return `<div class="poss">${title}${lead}${ul}${read}${est}</div>`;
  }
  function possibilitiesHtml(rights){
    const arr=(rights&&Array.isArray(rights.possibilities))?rights.possibilities:[];
    if(!arr.length) return '';
    const intro=(rights.intro&&rights.intro.he)
      ? `<div class="pnote">${esc(rights.intro.he)}${scopeChip(rights.intro.scope||'generic')}</div>` : '';
    return `<div class="pcard"><div class="pct">מָה אֶפְשָׁר לְהוֹסִיף? <span class="ptag">אֶפְשָׁרֻיּוֹת שִׁפּוּץ וְהַרְחָבָה</span></div>`+
      intro+arr.map(possibilityHtml).join('')+`</div>`;
  }

  /* ---- the פטור-מהיתר exemption list: the small works that DON'T need a permit. ---- */
  function exemptionsHtml(rights){
    const ex=rights&&rights.exemptions;
    if(!ex||!Array.isArray(ex.items)||!ex.items.length) return '';
    const intro=(ex.intro&&ex.intro.he)?`<div class="pnote">${esc(ex.intro.he)}${scopeChip(ex.intro.scope||'generic')}</div>`:'';
    const items=ex.items.map(it=>{
      const he=(typeof it==='string')?it:(it.he||''); return he?`<li>${safeInline(he)}</li>`:'';
    }).join('');
    const caveat=(ex.caveat&&ex.caveat.he)?`<div class="pread">${safeInline(ex.caveat.he)}${scopeChip(ex.caveat.scope||'generic')}</div>`:'';
    return `<div class="pcard"><div class="pct">${esc((ex.icon||'')+' '+(ex.title||''))} <span class="ptag">פְּטוֹר מֵהֶיתֵּר</span></div>`+
      intro+`<ul class="exlist">${items}</ul>`+caveat+`</div>`;
  }

  /* ---- official links (the permit exemptions, the safe-room standard, the planning authority). */
  function linksHtml(rights){
    const arr=(rights&&Array.isArray(rights.links))?rights.links:[];
    if(!arr.length) return '';
    const rows=arr.map(l=>{
      const url=String(l&&l.url||'');
      if(!/^https?:\/\//i.test(url)) return '';
      return `<a class="plink" href="${esc(url)}" target="_blank" rel="noopener noreferrer">`+
        `<span>${esc(l.label||url)}</span><span class="ar">↗</span></a>`;
    }).filter(Boolean).join('');
    if(!rows) return '';
    return `<div class="pcard"><div class="pct">קִשּׁוּרִים רִשְׁמִיִּים <span class="ptag">מָקוֹר</span></div>`+
      `<div class="links">${rows}</div></div>`;
  }

  /* ---- the rich rights section (possibilities + exemptions + links), or the
     thin fallback explainer when the data file isn't available. ---- */
  function rightsSection(rights){
    const blocks=possibilitiesHtml(rights)+exemptionsHtml(rights)+linksHtml(rights);
    return blocks || rulesHtml();
  }

  /* ---- the static plot-rights reference (plot_rights.json), surfaced by
     planning.js's Planning.getRights() (sync) / Planning.rights() (load). We
     read it defensively; if planning.js or the file is absent we just fall back
     to rulesHtml() inside rightsSection(). Never throws. ---- */
  function getRightsSync(){
    try{ const P=(typeof window!=='undefined')?window.Planning:null;
      return (P&&P.getRights)?P.getRights():null; }catch(e){ return null; }
  }

  /* ---------------- the renderers per outcome ---------------- */
  function headerHtml(){
    return `<div class="pchd"><h3><span class="pe">📐</span>מָה מֻתָּר בַּמִּגְרָשׁ</h3></div>`+
      `<div class="pcsub">הַתָּכְנוּן הָרִשְׁמִי שֶׁחָל עַל הַמִּגְרָשׁ · לרקמונט · `+
      `<span class="lot">${LAT.toFixed(5)}, ${LON.toFixed(5)}</span></div>`;
  }

  function footHtml(d){
    const live=`מְקוֹר: מִרְשַׁם הַתִּכְנוּן — נְתוּנֵי דֶּמוֹ סִינְתֶטִיִּים. `+
      `נִשְׁמָר בְּמַטְמוֹן לְ~30 יוֹם, אָז פְּתִיחָה חוֹזֶרֶת מִיָּדִית וְעוֹבֶדֶת גַּם בְּלִי רֶשֶׁת.`;
    let stamp='';
    if(d&&d.fetchedAt){
      try{
        const dt=new Date(d.fetchedAt);
        stamp=` · עֻדְכַּן: ${dt.toLocaleDateString('he-IL')}`;
      }catch(e){}
    }
    return `<div class="pfoot">${live}${stamp}</div>`;
  }

  function loadingBody(){
    return `<div class="pcwrap">${headerHtml()}`+
      `<div class="pcard"><div class="pload"><span class="pspin"></span>`+
      `<span>טוֹעֵן אֶת הַתָּכְנוּן הָרִשְׁמִי…</span></div></div></div>`;
  }

  function errorBody(d){
    // d may carry stale plans (planning.js keeps a fallback) — show them if present.
    const plans=(d&&Array.isArray(d.plans))?d.plans:[];
    const rights=getRightsSync();
    let inner='';
    if(plans.length){
      inner=`<div class="pcard"><div class="pct">הַתָּכְנִיּוֹת שֶׁחָלוֹת <span class="ptag">מִמַּטְמוֹן</span></div>`+
        plans.map(planHtml).join('')+`</div>`;
    }
    // the possibilities/exemptions are generic — show them even on a live-fetch
    // failure so the renovation guidance is useful offline too.
    inner+=rightsSection(rights);
    return `<div class="pcwrap">${headerHtml()}`+
      `<div class="perr">לֹא הִצְלַחְנוּ לְהִתְחַבֵּר כָּעֵת לְמִנְהַל הַתִּכְנוּן (בְּדִיקָה חַיָּה). `+
      `${plans.length?'לְמַטָּה מֻצֶּגֶת הַגִּרְסָה הַשְּׁמוּרָה הָאַחֲרוֹנָה.':'הַכְּלָלִים הַכְּלָלִיִּים לְמַטָּה זְמִינִים תָּמִיד; נַסּוּ שׁוּב לְנְּתוּנֵי הַחֶלְקָה כְּשֶׁיֵּשׁ רֶשֶׁת.'}</div>`+
      inner+footHtml(d)+`</div>`;
  }

  function dataBody(d){
    const plans=(d&&Array.isArray(d.plans))?d.plans:[];
    const rights=getRightsSync();
    let inner='';
    if(plans.length){
      inner+=`<div class="pcard"><div class="pct">הַתָּכְנִיּוֹת שֶׁחָלוֹת עַל הַמִּגְרָשׁ `+
        `<span class="ptag">${plans.length}</span></div>`+
        plans.map(planHtml).join('')+`</div>`;
      inner+=landUseHtml(d.landUse);
    } else {
      // resolved but nothing matched (error:'no-results'): honest empty state.
      inner+=`<div class="pcard"><div class="pct">הַתָּכְנִיּוֹת שֶׁחָלוֹת</div>`+
        `<div class="pempty">לֹא הֻחְזְרוּ תָּכְנִיּוֹת מֵהַשִּׁכְבָה הַגֵּאוֹגְרָפִית עֲבוּר הַנְּקֻדָּה הַזֹּאת. `+
        `יִתָּכֵן שֶׁהַשֵּׁרוּת לֹא זָמִין כָּעֵת — נַסּוּ שׁוּב מְאֻחָר יוֹתֵר.</div></div>`;
    }
    // the concrete possibilities + פטור list + official links (generic
    // rules from plot_rights.json), shown regardless of plan-match outcome.
    inner+=rightsSection(rights);
    return `<div class="pcwrap">${headerHtml()}${inner}${footHtml(d)}</div>`;
  }

  /* ---------------- public render(host, date) ----------------
     Renders the current best state immediately (cache or loading), then kicks
     off / awaits Planning.load() and re-renders the SAME host in place once it
     resolves — but only if host is still mounted and we still own its content
     (guarded by a per-host render token so a stale async result can't clobber a
     newer render). Defensive throughout: never throws. */
  let _token=0;
  function paint(host,d){
    try{
      let html;
      if(!d) html=loadingBody();
      else if(d.error && (!d.plans || !d.plans.length)) html=errorBody(d);
      else html=dataBody(d);
      host.innerHTML=html;
    }catch(e){ try{ host.innerHTML=errorBody(null); }catch(_){} }
  }

  function render(host,date){
    // host must be a real element with innerHTML; otherwise safe no-op.
    if(!host || typeof host!=='object' || !('innerHTML' in host)) return host;
    try{ ensureCSS(); }catch(e){}
    const myToken=++_token;
    host.__planToken=myToken;

    const P=(typeof window!=='undefined')?window.Planning:null;

    // 1) immediate paint from whatever is already known (sync cache or loading).
    let cached=null;
    try{ cached=(P&&P.get)?P.get():null; }catch(e){ cached=null; }
    paint(host, cached || null);

    // re-paint helper: paint the CURRENT best planning data (cache/in-memory),
    // but only if THIS render still owns the host. Used by both the registry load
    // and the rights load so a late rights file still surfaces the possibilities.
    const repaintCurrent=()=>{
      if(host.__planToken!==myToken) return;
      let d=null; try{ d=(P&&P.get)?P.get():null; }catch(e){ d=null; }
      paint(host, d || cached || null);
    };

    // 2) kick off the registry load and re-paint in place when it resolves.
    if(P && typeof P.load==='function'){
      let pr;
      try{ pr=P.load(); }catch(e){ pr=null; }
      if(pr && typeof pr.then==='function'){
        pr.then(d=>{
          // only re-paint if THIS render still owns the host (not superseded / unmounted)
          if(host.__planToken===myToken) paint(host, d || null);
        }).catch(()=>{
          if(host.__planToken===myToken){
            try{ paint(host, (P.get&&P.get())||{plans:[],landUse:[],error:'fetch-failed'}); }catch(_){}
          }
        });
      }
    } else if(!cached){
      // no Planning module at all → honest offline-ish error state.
      paint(host, { plans:[], landUse:[], error:'no-planning-module' });
    }

    // 3) kick off the static plot-rights reference (concrete possibilities +
    //    פטור list + links). When it resolves, re-paint so the section
    //    fills in (the first paint may have used the rulesHtml() fallback).
    if(P && typeof P.rights==='function' && !getRightsSync()){
      let rr; try{ rr=P.rights(); }catch(e){ rr=null; }
      if(rr && typeof rr.then==='function'){
        rr.then(()=>repaintCurrent()).catch(()=>{});
      }
    }
    return host;
  }

  // passive refresh: re-run load() (planning.js de-dupes / respects its TTL).
  // Also primes the static rights reference so a later render has it in-memory.
  function refresh(){
    try{ const P=window.Planning; if(P&&P.rights){ try{ P.rights(); }catch(e){} }
      if(P&&P.load) return P.load(); }catch(e){}
    return Promise.resolve(null);
  }

  window.__planning={ render, ensureCSS, refresh };
})();
