/* ===================================================================
   panels.js — the derived "instrument": four tabs of hyper-local,
   otherwise-unobtainable knowledge for Alex's exact house, on his real
   data. Reads the SAME scrubbable time as app.js (documentElement.dataset)
   so the yard/sky tabs move with the scene. Pure overlay — no scene edits,
   so it merges cleanly with any Claude Design cinematic bundle.
   =================================================================== */
(function(){
  const $=id=>document.getElementById(id);
  const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  // ---- universal "?" explain-chip auto-mount (explain.js + explain_content.json) ----
  // Inline a slot anywhere a computed value is shown:  <span data-xpl="metricId"></span>
  // (xplSlot('metricId') builds the markup). After a render writes innerHTML, call
  // mountXplChips(scope): it finds every [data-xpl] placeholder still in the scope,
  // builds Explain.chip({metric_id}) — which AUTO-FILLS title/what/how/data/source/
  // caveat from data/explain_content.json — and swaps it in. Idempotent per render:
  // a real chip carries no [data-xpl], so re-scanning after the next tick's fresh
  // innerHTML only ever mounts the new placeholders (the per-second renderSky/renderYard
  // rewrite their body, so the slots — and thus the mount — come back each tick).
  function xplSlot(metricId){ return metricId?`<span data-xpl="${metricId}"></span>`:''; }
  function mountXplChips(scope){
    if(!scope||!window.Explain||typeof scope.querySelectorAll!=='function') return;
    let slots; try{ slots=scope.querySelectorAll('[data-xpl]'); }catch(e){ return; }
    if(!slots||!slots.length) return;
    Array.prototype.forEach.call(slots,slot=>{
      const id=slot.getAttribute&&slot.getAttribute('data-xpl'); if(!id) return;
      let chip; try{ chip=window.Explain.chip({metric_id:id}); }catch(e){ return; }
      if(chip&&slot.replaceWith) slot.replaceWith(chip);
    });
  }
  function nowDate(){const D=document.documentElement;if((D.dataset.tmode||'live')==='live')return new Date();const m=+D.dataset.tscrub;return isFinite(m)?new Date(m):new Date();}
  const LS=k=>{try{return JSON.parse(localStorage.getItem(k))||[]}catch(e){return[]}}, save=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
  const uvColor=uv=>uv>=8?'#e8804a':uv>=6?'#e0b24a':uv>=3?'#8fc99a':'#9fb0c9';
  const seasonKey=m=>(m===11||m<2)?'winter':m<5?'spring':m<8?'summer':'autumn';
  const seasonHe={winter:'Winter',spring:'Spring',summer:'Summer',autumn:'Autumn'};

  const css=`
  #inst{position:absolute;top:18px;right:22px;width:300px;max-height:calc(100vh - 40px);display:flex;flex-direction:column;
    font-family:'Heebo',sans-serif;color:#efe6cf;z-index:6;
    text-shadow:0 1px 2px rgba(0,0,0,.5)}
  #inst .tabs{display:flex;gap:4px;margin-bottom:8px}
  #inst .tab{flex:1;text-align:center;font-size:11.5px;padding:7px 4px;border-radius:7px 7px 0 0;cursor:pointer;
    background:rgba(8,9,18,.86);border:1px solid rgba(202,161,90,.28);border-bottom:none;color:#d7c290;user-select:none;
    backdrop-filter:blur(10px)}
  #inst .tab.on{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;font-weight:600;text-shadow:none}
  /* solid dark scrim behind the panel body so light text stays readable
     over ANY scene (bright desert terrain washed the old translucent bg
     out). High-opacity gradient + blur + a strong shadow for separation. */
  #inst .body{overflow-y:auto;padding:14px 15px;border-radius:4px;
    background:linear-gradient(160deg,rgba(12,14,26,.93),rgba(6,7,15,.95));
    backdrop-filter:blur(12px);border:1px solid rgba(202,161,90,.22);
    box-shadow:0 18px 48px rgba(0,0,0,.55)}
  #inst h3{font-family:'Frank Ruhl Libre',serif;font-weight:500;font-size:16px;color:#fff7e6;margin-bottom:2px}
  #inst .sub{font-size:10px;color:#a99b78;margin-bottom:11px;line-height:1.4}
  #inst .row{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;color:#d6ccb2;padding:7px 0;border-top:1px solid rgba(202,161,90,.13)}
  #inst .row:first-child{border-top:none} #inst .row b{color:#fff7e6}
  /* clickable sky-object rows → focus the 3D camera on that body (window.__lookAtSky) */
  #inst .row.clk{cursor:pointer;border-radius:6px;margin:0 -6px;padding-left:6px;padding-right:6px;
    transition:background .15s,box-shadow .15s}
  #inst .row.clk:hover{background:rgba(202,161,90,.12);box-shadow:inset 0 0 0 1px rgba(202,161,90,.3)}
  #inst .row.clk:hover b,#inst .row.clk:hover .nm{color:#fff7e6}
  #inst .row.clk .nm::before{content:'⌖ ';color:#caa15a;opacity:.55;font-size:11px}
  /* satellite pass cards in the sky tab (replaces the old floating #satInfo panel) */
  #inst .satrow{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;
    font-size:12px;color:#d6ccb2;padding:7px 0;border-top:1px solid rgba(202,161,90,.13);cursor:pointer;
    border-radius:6px;margin:0 -6px;padding-left:6px;padding-right:6px;transition:background .15s,box-shadow .15s}
  #inst .satrow:hover{background:rgba(120,150,210,.14);box-shadow:inset 0 0 0 1px rgba(120,150,210,.32)}
  #inst .satrow .sn{font-weight:600;color:#cfe0ff} #inst .satrow .ss{opacity:.55;font-size:10.5px}
  #inst .satrow .sm{font-size:10.5px;color:#a99b78;line-height:1.4;text-align:left}
  #inst .satvis{color:#ffd27a}
  #inst .chip{font-size:10.5px;padding:2px 8px;border-radius:20px}
  #inst .chip.sun{background:linear-gradient(#caa15a,#a07c38);color:#1a1606}
  #inst .chip.shade{background:rgba(120,140,170,.16);color:#bcd0e8;border:1px solid rgba(120,140,170,.3)}
  #inst .big{font-family:'Frank Ruhl Libre',serif;font-size:26px;color:#f3ead2;line-height:1}
  #inst .est{font-size:9px;color:#8a7a52;margin-top:3px}
  #inst .card{background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.15);border-radius:8px;padding:8px 10px;margin-top:8px}
  /* merged MOON block at the top of the sky tab (consolidates the old bottom-left
     moon card: phase name, illum %, above/below-horizon, the direction arrow +
     "below horizon · rise HH:MM", plus rise/set). Same dark/gold card aesthetic. */
  #inst .moonblk{background:rgba(255,255,255,.045);border:1px solid rgba(202,161,90,.18);
    border-radius:8px;padding:9px 11px;margin-top:8px}
  #inst .moonblk.clk{cursor:pointer;transition:background .15s,box-shadow .15s}
  #inst .moonblk.clk:hover{background:rgba(202,161,90,.12);box-shadow:inset 0 0 0 1px rgba(202,161,90,.3)}
  #inst .moonblk .top{display:flex;align-items:center;gap:10px}
  #inst .moonblk .gl{font-size:26px;line-height:1;flex:0 0 auto}
  #inst .moonblk .mn{font-family:'Frank Ruhl Libre',serif;font-size:16px;color:#fff7e6}
  #inst .moonblk .mi{font-size:11px;color:#a99b78;margin-top:1px}
  #inst .moonblk.clk:hover .mn{color:#fff}
  /* moon-direction row: arrow → "moon direction" → live state, like the old card. The
     arrow's SVG glyph points UP at rotate(0deg); CSS rotate is clockwise (same sense
     as the compass bearing), so up = straight ahead and it swings toward the moon. */
  #inst .moonblk .mdir{display:flex;align-items:center;gap:7px;margin-top:8px;
    padding-top:8px;border-top:1px solid rgba(202,161,90,.14)}
  #inst .moonblk .mdArrow{flex:0 0 auto;width:15px;height:15px;line-height:0;
    transform-origin:50% 50%;transition:transform .3s ease}
  #inst .moonblk .mdArrow svg path{fill:#fff7e6;stroke:rgba(20,24,40,.55);stroke-width:1.2;
    filter:drop-shadow(0 0 5px rgba(255,247,230,.7))}
  #inst .moonblk .mdArrow.down svg path{fill:#9fb0c9;filter:drop-shadow(0 0 4px rgba(160,176,201,.55))}
  #inst .moonblk .mdArrow.off svg path{fill:#e7dcc0;filter:drop-shadow(0 0 4px rgba(231,220,192,.6))}
  #inst .moonblk .mdLbl{font-family:'Bellefair',serif;letter-spacing:.1em;font-size:10.5px;color:#caa15a}
  #inst .moonblk .mdState{font-size:11px;color:#bcae8a;margin-right:auto}
  #inst .moonblk .mdState.down{color:#9fb0c9} #inst .moonblk .mdState.up{color:#e7dcc0}
  #inst .moonblk .mrs{display:flex;justify-content:space-between;gap:8px;font-size:11px;
    color:#a99b78;margin-top:7px;padding-top:7px;border-top:1px solid rgba(202,161,90,.14)}
  #inst .moonblk .mrs b{color:#d6ccb2;font-weight:600}
  /* consolidated "🔭 When to look up" summary at the top of the sky tab —
     one card, four rows (meteor / planets / ISS / moon+verdict), dark-gold skin. */
  #inst .lookup{background:linear-gradient(160deg,rgba(202,161,90,.10),rgba(255,255,255,.035));
    border:1px solid rgba(202,161,90,.28);border-radius:9px;padding:9px 11px;margin-top:8px}
  #inst .lookup .luHd{display:flex;align-items:baseline;justify-content:space-between;gap:8px;
    font-family:'Frank Ruhl Libre',serif;font-size:14px;color:#fff7e6;margin-bottom:4px}
  #inst .lookup .luWhen{font-family:'Bellefair',serif;letter-spacing:.06em;font-size:9.5px;color:#caa15a;white-space:nowrap}
  #inst .lookup .luRow{display:flex;gap:9px;align-items:flex-start;padding:6px 0;
    border-top:1px solid rgba(202,161,90,.13)}
  #inst .lookup .luRow:first-of-type{border-top:none}
  #inst .lookup .luIc{font-size:17px;line-height:1.25;flex:0 0 auto}
  #inst .lookup .luTx{flex:1;min-width:0}
  #inst .lookup .luT{font-size:12px;font-weight:600;color:#fff7e6;line-height:1.35}
  #inst .lookup .luS{font-size:10.5px;color:#a99b78;line-height:1.4;margin-top:1px}
  #inst .lookup .luTag{font-size:9.5px;color:#1a1606;background:linear-gradient(#caa15a,#a07c38);
    border-radius:20px;padding:1px 6px;font-weight:700}
  #inst .lookup .luV{font-size:10px;border-radius:20px;padding:1px 7px;margin-right:4px;white-space:nowrap}
  #inst .lookup .luV.hi{color:#1a2606;background:#a3e635}
  #inst .lookup .luV.mid{color:#2a2206;background:#e0b24a}
  #inst .lookup .luV.lo{color:#cfe0ff;background:rgba(120,150,210,.28);border:1px solid rgba(120,150,210,.4)}
  /* clickable rows (planets / ISS) → focus the 3D view, same affordance as .row.clk */
  #inst .lookup .luRow.clkable{cursor:pointer;border-radius:6px;margin:0 -6px;padding-left:6px;padding-right:6px;
    transition:background .15s,box-shadow .15s}
  #inst .lookup .luRow.clkable:hover{background:rgba(202,161,90,.14);box-shadow:inset 0 0 0 1px rgba(202,161,90,.32)}
  #inst .lookup .luRow.clkable:hover .luT{color:#fff}
  #inst .lookup .luRow.clkable .luT::after{content:' ⌖';color:#caa15a;opacity:.55;font-size:10px}
  #inst .lookup .luFoot{font-size:9px;color:#7d7150;margin-top:7px;padding-top:6px;
    border-top:1px solid rgba(202,161,90,.13);line-height:1.4}
  #inst .pl{display:flex;gap:8px;align-items:flex-start}
  #inst .pl .e{font-size:20px} #inst .pl .n{font-weight:600;color:#fff7e6;font-size:13px}
  #inst .pl .m{font-size:10.5px;color:#a99b78;line-height:1.4}
  #inst input{background:#0b1322;border:1px solid rgba(202,161,90,.3);color:#fff;border-radius:7px;padding:6px 8px;font-size:12px;width:100%;font-family:inherit}
  #inst .btn{background:#16223c;border:1px solid rgba(202,161,90,.35);color:#e7dcc0;border-radius:7px;padding:6px 10px;font-size:12px;cursor:pointer;white-space:nowrap}
  #inst .sight{display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid rgba(202,161,90,.1)}
  #inst .sight img{width:34px;height:34px;border-radius:6px;object-fit:cover;background:#16203a}
  /* clickable nature sighting rows → fly the 3D camera to the sighting's real
     location (window.__flyToGround). Same affordance as the clickable sky rows. */
  #inst .sight.clk{cursor:pointer;border-radius:6px;margin:0 -6px;padding-left:6px;padding-right:6px;
    transition:background .15s,box-shadow .15s}
  #inst .sight.clk:hover{background:rgba(120,180,130,.13);box-shadow:inset 0 0 0 1px rgba(120,180,130,.32)}
  #inst .sight.clk:hover .n{color:#fff7e6}
  #inst .sight.clk .n::before{content:'⌖ ';color:#8fce8f;opacity:.6;font-size:11px}
  #inst .sight.on{background:rgba(120,180,130,.16);box-shadow:inset 0 0 0 1px rgba(120,180,130,.4)}
  #inst .foot{font-size:9.5px;color:#7d7150;margin-top:10px}
  /* ---- consumption anomaly badge + IEC import box (energy tab) ---- */
  #inst .cz-badge{font-size:9px;padding:1px 6px;border-radius:20px;margin-right:5px;white-space:nowrap;font-weight:600}
  #inst .cz-badge.hi{background:rgba(232,128,74,.18);color:#e8a06a;border:1px solid rgba(232,128,74,.4)}
  #inst .cz-badge.lo{background:rgba(120,180,130,.16);color:#9fce9f;border:1px solid rgba(120,180,130,.4)}
  /* ---- 📖 home story timeline (brain tab) — a slim gold spine with dated nodes ---- */
  #inst .tl{margin-top:6px;padding-right:6px;border-right:2px solid rgba(202,161,90,.3)}
  #inst .tl .tle{position:relative;padding:5px 12px 5px 0;font-size:11.5px;color:#d6ccb2}
  #inst .tl .tle::before{content:'';position:absolute;right:-7px;top:9px;width:8px;height:8px;border-radius:50%;
    background:#caa15a;box-shadow:0 0 0 2px rgba(12,14,26,.9)}
  #inst .tl .tle .te{margin-left:5px} #inst .tl .tle b{color:#fff7e6}
  #inst .tl .tle .td{font-size:9.5px;color:#a99b78;margin-top:1px}
  /* photo thumbnail on a memory row + the 📷 attach button (brain tab) */
  #inst .brow{display:flex;gap:8px;align-items:center;padding:7px 0;border-top:1px solid rgba(202,161,90,.13)}
  #inst .brow:first-child{border-top:none}
  #inst .brow img{width:38px;height:38px;border-radius:6px;object-fit:cover;background:#16203a;flex:0 0 auto;cursor:pointer}
  #inst .brow .bt{flex:1;min-width:0;font-size:12.5px;color:#d6ccb2;word-break:break-word}
  #inst .brow .bw{font-size:10px;color:#a99b78;white-space:nowrap;flex:0 0 auto}
  #inst .photo-btn{background:#16223c;border:1px solid rgba(202,161,90,.35);color:#e7dcc0;border-radius:7px;
    padding:6px 9px;font-size:13px;cursor:pointer;flex:0 0 auto;line-height:1}
  #inst .photo-btn.set{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;border-color:#e0c483}
  #inst textarea{background:#0b1322;border:1px solid rgba(202,161,90,.3);color:#fff;border-radius:7px;
    padding:6px 8px;font-size:11px;width:100%;font-family:inherit;line-height:1.5;resize:vertical;min-height:64px}
  #inst .imp-hint{font-size:9px;color:#8a7a52;margin:4px 0 5px;line-height:1.45}
  #inst .imp-msg{font-size:10px;color:#9fce9f;margin-top:5px}
  #inst input[type=file]{padding:5px 4px;font-size:10.5px}
  #inst input[type=file]::file-selector-button{background:#16223c;border:1px solid rgba(202,161,90,.35);
    color:#e7dcc0;border-radius:6px;padding:3px 8px;font-size:10.5px;cursor:pointer;margin-left:6px;font-family:inherit}
  /* ---- MICROCLIMATE control + readout (energy tab) ---- */
  #inst .mc-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px;margin-bottom:6px}
  #inst .mc-hd .mt{font-family:'Bellefair',serif;letter-spacing:.1em;font-size:11px;color:#caa15a}
  #inst .mc-model{font-family:'Heebo';font-size:8.5px;color:#7e8aa6;border:1px solid rgba(126,138,166,.4);
    border-radius:20px;padding:1px 6px;white-space:nowrap}
  /* on/off pill switch (same dark/gold affordance as app.js layer toggles) */
  #inst .mc-sw{position:relative;width:42px;height:22px;flex:0 0 auto;border-radius:30px;cursor:pointer;
    background:rgba(255,255,255,.06);border:1px solid rgba(202,161,90,.3);transition:.25s}
  #inst .mc-sw::after{content:'';position:absolute;top:2px;right:2px;width:16px;height:16px;border-radius:50%;
    background:#cdbd92;transition:.25s;box-shadow:0 1px 4px rgba(0,0,0,.5)}
  #inst .mc-sw.on{background:linear-gradient(#caa15a,#a07c38);border-color:#e0c483}
  #inst .mc-sw.on::after{right:22px;background:#fff7e6}
  /* chip-row selectors (variable + season) */
  #inst .mc-chips{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
  #inst .mc-chip{font-size:10.5px;padding:3px 8px;border-radius:20px;cursor:pointer;user-select:none;
    background:rgba(255,255,255,.05);border:1px solid rgba(202,161,90,.25);color:#cdbd92;transition:.15s}
  #inst .mc-chip:hover{border-color:rgba(202,161,90,.55);color:#fff7e6}
  #inst .mc-chip.on{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;font-weight:600;border-color:#e0c483}
  #inst .mc-lbl{font-size:9px;color:#8a7a52;letter-spacing:.06em;margin-top:6px}
  #inst .mc-off{opacity:.42;pointer-events:none}
  /* legend for the active variable */
  #inst .mc-legend{margin:8px 0 4px;padding-top:8px;border-top:1px solid rgba(202,161,90,.13)}
  #inst .mc-legend .lh{font-size:10px;color:#caa15a;margin-bottom:4px}
  #inst .mc-legend .bar{height:9px;border-radius:30px;border:1px solid rgba(202,161,90,.25)}
  #inst .mc-legend .sc{display:flex;justify-content:space-between;margin-top:3px;font-size:10px;color:#cdbd92}
  /* per-zone microclimate card */
  #inst .zc{background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.15);border-radius:8px;
    padding:8px 10px;margin-top:8px}
  #inst .zc .zt{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px}
  #inst .zc .zn{font-family:'Frank Ruhl Libre',serif;font-size:13.5px;color:#fff7e6}
  #inst .zc .zf{font-size:9.5px;color:#a99b78}
  #inst .zc .zg{display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;font-size:11px;color:#d6ccb2}
  #inst .zc .zg .k{color:#a99b78}
  #inst .zc .zg b{color:#fff7e6;font-weight:600}
  #inst .zc .frost-hi{color:#7fb0ff} #inst .zc .frost-mid{color:#9fc2e0}
  #inst .zc .recs{margin-top:6px;padding-top:6px;border-top:1px solid rgba(202,161,90,.13)}
  #inst .zc .rec{display:flex;gap:7px;align-items:flex-start;padding:3px 0;font-size:11px}
  #inst .zc .rec .re{font-size:16px;flex:0 0 auto;line-height:1.2}
  #inst .zc .rec .rn{font-weight:600;color:#fff7e6}
  #inst .zc .rec .rs{color:#a3e635;font-size:10px} #inst .zc .rec .rs.mid{color:#e0b24a} #inst .zc .rec .rs.lo{color:#c98a8a}
  #inst .zc .rec .rr{color:#a99b78;font-size:9.5px;line-height:1.35}
  /* phone gate: hide ONLY the standalone floating panel (index.html). When the
     same #inst body is embedded inside a shell tab (#tabHost), tabs_data.js adds
     .inst-embed, which opts OUT of this gate so the tab is usable on the phone. */
  /* MOBILE: the old shell-era rule did display:none here, which left phones with NO main
     UI at all. Instead, reflow #inst into a full-width bottom sheet — the 3D shows above it
     and every tab/readout stays reachable (the .inst-embed shell path is untouched). */
  /* ANY phone (narrow portrait OR short landscape): hide the secondary floats so the
     desktop tile layout doesn't pile up, and pin the time scrubber to the bottom.
     transform:none!important beats any leftover V2Drag inline transform. */
  @media(max-width:760px), (max-height:540px){
    #bld, #compass, #tmPanel{display:none!important}
    #tbar{left:6px!important;right:6px!important;top:auto!important;bottom:6px!important;width:auto!important;transform:none!important;max-width:none!important}
    /* keep BOTH pills on ONE row (side by side), never wrapping — wrapping dropped the
       second pill onto the tab strip. nowrap text keeps each pill a single compact line. */
    #topPills{flex-wrap:nowrap;justify-content:center;max-width:96vw}
    #topPills .tpill{white-space:nowrap;font-size:12px;padding:6px 11px}
  }
  /* PORTRAIT phone: main panel becomes a full-width top sheet; tabs wrap to 2 rows. */
  @media(max-width:760px){
    #inst:not(.inst-embed){top:60px;bottom:auto;left:6px;right:6px;width:auto;max-height:60vh;transform:none!important}
    #inst:not(.inst-embed) .tabs{flex-wrap:wrap;gap:3px}
    #inst:not(.inst-embed) .tab{flex:1 0 21%;font-size:11px;padding:6px 3px}
    #inst:not(.inst-embed) .body{padding:11px 12px}
  }
  /* LANDSCAPE phone (wide but short): keep #inst a compact top-right panel (3D shows at
     left), just drop the stale V2Drag transform so it sits at the CSS spot. */
  @media(max-height:540px) and (min-width:761px){
    #inst:not(.inst-embed){transform:none!important;top:6px;right:6px;left:auto;width:300px;max-height:calc(100vh - 12px)}
  }
  /* embedded-in-shell skin: drop the fixed positioning so the panel flows inside
     the tab host instead of floating top-right over the canvas. Applies to BOTH
     the primary #inst host and the merged tab's secondary #inst2 host. */
  #inst.inst-embed, #inst2.inst-embed{position:static;top:auto;right:auto;width:auto;max-height:none;margin-bottom:14px}
  #inst.inst-embed .tabs, #inst2.inst-embed .tabs{display:none}   /* the shell's rail replaces the inner tab strip */
  `;
  /* ---- STAGE-2: #inst2 skin shim (merged nature & environment tab) ---------------------
     The whole stylesheet above is scoped under "#inst". The merged tab renders
     the env panel into a SECOND wrapper "#inst2" so wild AND env are BOTH visible
     and independently live. To reuse the identical dark/gold skin verbatim with
     zero redesign, we duplicate the stylesheet for the "#inst2" prefix by string-
     replacing the leading "#inst" of every selector. (Selectors here always start
     with "#inst", so a global "#inst " / "#inst." / "#inst{" replace is safe.) */
  const css2 = css
    .replace(/#inst:not\(\.inst-embed\)/g, '#inst2:not(.inst-embed)')
    .replace(/#inst\.inst-embed/g, '#inst2.inst-embed')
    .replace(/#inst /g, '#inst2 ')
    .replace(/#inst\./g, '#inst2.')
    .replace(/#inst\{/g, '#inst2{')
    .replace(/#inst,/g, '#inst2,');

  Derive.ready.then(()=>{
    const D=Derive.data, site=D.site||{}, zones=site.zones||[], plants=D.plants||[];
    document.head.appendChild(el('style',null,css));
    document.head.appendChild(el('style',null,css2));   // STAGE-2: secondary #inst2 skin for the merged tab
    const wrap=el('div'); wrap.id='inst';
    const TABS=[['home','Today'],['house','House'],['yard','Yard'],['sky','Sky'],['energy','Energy'],['wild','Nature'],['env','Environment'],['brain','Brain']];
    wrap.appendChild(el('div','tabs',TABS.map(([k,l],i)=>`<div class="tab${i===0?' on':''}" data-t="${k}">${l}</div>`).join('')));
    let body=el('div','body panel'); wrap.appendChild(body); document.body.appendChild(wrap);   // `let`: the STAGE-2 merged tab (nature & environment) retargets `body` per host
    // Delegated click → focus the 3D camera on a sky object (Task: clickable sky
    // objects). Any element carrying data-az/data-alt (sky-object rows + satellite
    // rows in the sky tab) calls window.__lookAtSky(azDeg,altDeg). Attached once;
    // survives the per-second innerHTML re-renders of renderSky.
    const _skyLayers={constellations:true,milkyway:true,paths:true,satellites:true};   // sky-layer ON/OFF switches — live ONLY in the sky tab now
    if(typeof document!=='undefined' && !document.getElementById('skysw-css')){ const _ss=document.createElement('style'); _ss.id='skysw-css'; _ss.textContent='.skylrow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 2px;border-top:1px solid rgba(202,161,90,.13);font-size:12.5px;color:#d6ccb2}.skysw{position:relative;width:40px;height:21px;border-radius:11px;cursor:pointer;flex:0 0 auto;background:rgba(255,255,255,.13);border:1px solid rgba(202,161,90,.4);transition:background .18s}.skysw.on{background:linear-gradient(90deg,#a07c38,#caa15a)}.skysw::after{content:"";position:absolute;top:2px;right:2px;width:15px;height:15px;border-radius:50%;background:#fff7e6;transition:right .18s;box-shadow:0 1px 3px rgba(0,0,0,.4)}.skysw.on::after{right:21px}'; (document.head||document.documentElement).appendChild(_ss); }
    body.addEventListener('click',e=>{
      const nb=e.target.closest('[data-natal]'); if(nb){ if(window.__natal) window.__natal.open(); return; }
      // 🌌 darken the sky to reveal stars even by day (reversible; no clock change)
      const nv=e.target.closest('[data-nightview]'); if(nv){ if(window.SkyRig&&window.SkyRig.setNightView){ window.SkyRig.setNightView(!(window.SkyRig.isNightView&&window.SkyRig.isNightView())); } if(active==='sky') renderSky(nowDate()); return; }
      const sk=e.target.closest('[data-skl]'); if(sk){ const k=sk.getAttribute('data-skl'); _skyLayers[k]=!_skyLayers[k]; if(window.SkyRig&&window.SkyRig.setLayer) window.SkyRig.setLayer(k,_skyLayers[k]); if(active==='sky') renderSky(nowDate()); return; }
      const t=e.target.closest('[data-az]'); if(!t) return;
      const az=parseFloat(t.dataset.az), alt=parseFloat(t.dataset.alt);
      if(window.__lookAtSky && isFinite(az) && isFinite(alt)) window.__lookAtSky(az,alt);
    });
    let active='home';
    let _openOverlay=null;   // captured below from the topPills IIFE so the WELCOME modal reuses the SAME big-centered overlay helper (no new overlay system)
    wrap.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{active=t.dataset.t;
      // on a phone, tapping a tab while the panel is minimized re-opens it (showing that tab)
      document.documentElement.classList.remove('inst-min'); var _imb=document.getElementById('instMin'); if(_imb)_imb.textContent='▾';
      wrap.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===t)); render(true);
      // house/yard → auto top-down "from above" overview of the house+yard
      if((active==='home'||active==='yard')&&window.__flyTopHome) window.__flyTopHome();});
    // cross-link foundation: modules emit bus events, the shell activates the target tab
    function openTab(k){ const tb=wrap.querySelector('.tab[data-t="'+k+'"]'); if(tb){ tb.click(); return true; } return false; }
    if(window.Bus&&window.Bus.on){
      window.Bus.on('tab:open',p=>{ if(p&&p.tab) openTab(p.tab); });
      window.Bus.on('alert:goto',p=>{ const m={frost:'env',dust:'env',heat:'env',watering:'yard',sky:'sky'}; if(p&&p.kind&&m[p.kind]) openTab(m[p.kind]); });
    }
    // vision + calendar promoted to prominent TOP pills (separate from the tab bar, away from the
    // crowded left column) — quick access, like the old enter-house pill sat apart from the tabs.
    (function(){
      const tp=el('div'); tp.id='topPills'; tp.setAttribute('dir','ltr');
      tp.innerHTML='<span class="tpill tpill-map" data-tp="map">🗺️ Map</span><span class="tpill" data-tp="cal">📅 Calendar</span><span class="tpill" data-tp="vision">✨ Vision Board</span>';
      document.head.appendChild(el('style',null,
        '#topPills{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:40;display:flex;gap:8px;direction:ltr}'+
        '#topPills .tpill{cursor:pointer;font-family:"Frank Ruhl Libre",serif;font-size:14px;color:#e9dcbb;background:linear-gradient(160deg,rgba(12,14,26,.92),rgba(6,7,15,.95));border:1px solid rgba(202,161,90,.4);border-radius:22px;padding:7px 16px;box-shadow:0 8px 24px rgba(0,0,0,.45);backdrop-filter:blur(8px)}'+
        '#topPills .tpill:hover{border-color:rgba(202,161,90,.7);color:#fff7e6;background:linear-gradient(160deg,rgba(202,161,90,.2),rgba(202,161,90,.06))}'+
        '#topPills .tpill.on{border-color:rgba(202,161,90,.95);color:#1a1606;background:linear-gradient(160deg,#caa15a,#a07c38);font-weight:600}'+
        '#mapbg{position:fixed;inset:0;z-index:2;display:none;background:#0b0d18}'+
        // full-screen map face: make #pmap a flex COLUMN so the Leaflet map flexes to fill and the
        // layer-toggle chips + timeline button (.pm-toggles) sit as an in-flow control bar at the BOTTOM.
        // (Before: a 100vh map shoved that row off-screen → "where are the layers?".)
        '#mapbg #pmap{height:100vh;display:flex;flex-direction:column;margin:0;padding:0}'+
        '#mapbg .pm-h,#mapbg .pm-intro,#mapbg .pm-foot{display:none}'+
        '#mapbg .pm-wrap{flex:1 1 auto!important;min-height:0!important;height:auto!important;border:none!important;border-radius:0!important;margin:0!important}'+
        '#mapbg .pm-map{height:100%!important;min-height:0!important}'+
        '#mapbg .pm-toggles{flex:0 0 auto;margin:0!important;justify-content:center;background:rgba(8,9,16,.93);border-top:1px solid rgba(202,161,90,.28);padding:11px 12px;box-shadow:0 -6px 22px rgba(0,0,0,.45)}'+
        '@media(max-width:760px),(max-height:540px){#mapbg .pm-toggles{padding:9px 8px;gap:6px;max-height:34vh;overflow-y:auto}}'+
        '#topPills .tpill-map.on{box-shadow:0 0 0 2px rgba(202,161,90,.55),0 8px 24px rgba(0,0,0,.5)}'));
      document.body.appendChild(tp);
      // MOBILE one-tap collapse: the main panel fills a phone screen, so give a way to shrink
      // it (hide its body) and see the 3D/map. Toggles .inst-min on <html>; hidden on desktop.
      (function(){
        if(document.getElementById('instMin')) return;
        var mb=el('button'); mb.id='instMin'; mb.type='button'; mb.textContent='▾'; mb.title='Hide / show the panel';
        document.head.appendChild(el('style',null,
          '#instMin{display:none}'+
          '@media(max-width:760px),(max-height:540px){'+
            '#instMin{display:flex;align-items:center;justify-content:center;position:fixed;z-index:9;top:13px;left:8px;width:40px;height:32px;'+
              'background:linear-gradient(160deg,#caa15a,#a07c38);color:#1a1606;border:none;border-radius:16px;font-size:15px;font-weight:700;'+
              'box-shadow:0 6px 18px rgba(0,0,0,.5);cursor:pointer;font-family:Heebo,sans-serif;line-height:1;padding:0}'+
            'html.inst-min #inst:not(.inst-embed){max-height:none!important}'+
            'html.inst-min #inst:not(.inst-embed) .body{display:none!important}'+
          '}'));
        mb.addEventListener('click',function(){ var m=document.documentElement.classList.toggle('inst-min'); mb.textContent=m?'▴':'▾'; });
        document.body.appendChild(mb);
      })();
      // 🗺️ MAP-AS-BACKGROUND: mount the 2D geology map (place_map) full-screen BEHIND the panels
      // (z-2, under #inst's z-6) so the WHOLE app sits on the map. Hides the 3D world while on.
      let _mbEl=null, _mbOn=false;
      function toggleMapBg(force){
        _mbOn=(typeof force==='boolean')?force:!_mbOn;
        const c=document.getElementById('c');
        if(!_mbEl){ _mbEl=el('div'); _mbEl.id='mapbg'; document.body.appendChild(_mbEl); }
        if(_mbOn){
          _mbEl.style.display='block'; if(c) c.style.display='none';
          window.__worldPaused=true;   // idle the 3D render loop while the map fully covers it (GPU saver)
          if(window.__placeMap&&window.__placeMap.render){ try{ window.__placeMap.render(_mbEl, nowDate()); }catch(e){}
            setTimeout(()=>{ try{ const m=window.__placeMap._state&&window.__placeMap._state.map; if(m) m.invalidateSize(); }catch(e){} }, 160); }
        } else {
          _mbEl.style.display='none'; if(c) c.style.display='block';
          window.__worldPaused=false;
          if(active==='env') render(true);   // re-render the environment card (its map launcher button)
        }
        // the lit map pill IS the exit: its label flips so it's obvious you tap it to return to the 3D home.
        const mp=tp.querySelector('[data-tp="map"]'); if(mp){ mp.classList.toggle('on',_mbOn); mp.textContent=_mbOn?'✕ Close map':'🗺️ Map'; }
      }
      window.__mapBg={ toggle:toggleMapBg, isOn:()=>_mbOn };
      // big CENTERED modal — the calendar + vision pills open here ("big and centered", NOT the
      // cramped right-side panel). One reusable element; renderFn fills the body.
      let _ovl=null;
      function openOverlay(titleHe, renderFn){
        if(!_ovl){
          _ovl=el('div'); _ovl.id='bigOverlay';
          document.head.appendChild(el('style',null,
            '#bigOverlay{position:fixed;inset:0;z-index:99998;display:none;align-items:center;justify-content:center;background:rgba(4,5,12,.72);backdrop-filter:blur(4px)}'+
            '#bigOverlay.on{display:flex}'+
            '#bigOverlay .ovl-card{position:relative;width:min(960px,92vw);height:min(88vh,900px);background:linear-gradient(160deg,#0c0e1a,#070810);border:1px solid rgba(202,161,90,.4);border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.6);overflow:hidden;display:flex;flex-direction:column}'+
            '#bigOverlay .ovl-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid rgba(202,161,90,.18);flex:0 0 auto}'+
            '#bigOverlay .ovl-t{font-family:"Frank Ruhl Libre",serif;font-size:19px;color:#fff7e6}'+
            '#bigOverlay .ovl-x{cursor:pointer;font-size:20px;color:#caa15a;background:none;border:none;line-height:1}'+
            '#bigOverlay .ovl-body{flex:1;overflow:auto;padding:16px 18px;direction:ltr}'));
          document.body.appendChild(_ovl);
          _ovl.addEventListener('click',ev=>{ if(ev.target===_ovl||(ev.target.closest&&ev.target.closest('.ovl-x'))) _ovl.classList.remove('on'); });
        }
        _ovl.innerHTML='<div class="ovl-card"><div class="ovl-hd"><span class="ovl-t">'+titleHe+'</span><button class="ovl-x" title="Close">✕</button></div><div class="ovl-body" id="ovl-body"></div></div>';
        _ovl.classList.add('on');
        const b2=_ovl.querySelector('#ovl-body'); try{ renderFn(b2); }catch(e){}
      }
      _openOverlay=openOverlay;   // hand the SAME modal helper to the outer closure (WELCOME modal reuses it)
      tp.addEventListener('click',e=>{ const p=e.target.closest&&e.target.closest('[data-tp]'); if(!p) return;
        const k=p.getAttribute('data-tp');
        if(k==='map'){ toggleMapBg(); }
        else if(k==='cal'){ openOverlay('Calendar', el2=>{ if(window.__calendar&&window.__calendar.render) window.__calendar.render(el2, nowDate()); }); }
        else if(k==='vision'){ openOverlay('Vision Board', el2=>{ if(window.__vision&&window.__vision.render) window.__vision.render(el2, nowDate()); }); }
      });
    })();

    /* ---------- ❤️ first-run WELCOME / DEDICATION modal (home_welcomed_v1) ----------
       On the very first open (the flag absent) we greet Alex with a warm dedication,
       the "cosmic odometer" from data/resident_numbers.json animating up, and live
       counters for the personal milestones from data/milestones.json. "Let's begin"
       sets the flag and closes. Reuses the SAME big-centered overlay helper
       (_openOverlay) as the calendar/vision pills — no new overlay system.
       Fully defensive: a missing/invalid file just hides that part; never throws. */
    // ⬇⬇ THE DEDICATION — edit this one warm line to change the gift's greeting ⬇⬇
    const WELCOME_DEDICATION_HE = 'Alex — your house, your sky, your numbers. A gift. ❤️';
    // ⬆⬆ ─────────────────────────────────────────────────────────────────── ⬆⬆
    let _welcomeShown=false;
    function maybeShowWelcome(){
      if(_welcomeShown) return;                          // once per page load
      let already=null; try{ already=localStorage.getItem('home_welcomed_v1'); }catch(e){ already='1'; }
      if(already) return;                                // already greeted on this device
      if(typeof _openOverlay!=='function') return;       // overlay helper not ready yet
      _welcomeShown=true;
      // one-time skin for the welcome contents (scoped under #welcome inside the overlay body)
      if(!document.getElementById('welcome-css')){
        document.head.appendChild(el('style',null,
          '#welcome{direction:ltr;text-align:center;font-family:Heebo,sans-serif;color:#efe6cf}'+
          '#welcome .wDed{font-family:"Frank Ruhl Libre",serif;font-size:23px;line-height:1.5;color:#fff7e6;margin:6px auto 18px;max-width:540px}'+
          '#welcome .wOdo{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin:0 auto 6px;max-width:620px}'+
          '#welcome .wo{flex:1 1 150px;min-width:130px;background:rgba(255,255,255,.045);border:1px solid rgba(202,161,90,.22);'+
            'border-radius:12px;padding:13px 10px}'+
          '#welcome .wo .wn{font-family:"Frank Ruhl Libre",serif;font-size:27px;color:#f3ead2;line-height:1.05}'+
          '#welcome .wo .wl{font-size:11px;color:#a99b78;margin-top:4px;line-height:1.4}'+
          '#welcome .wFoot{font-size:9.5px;color:#7d7150;margin:9px auto 0;max-width:560px;line-height:1.45}'+
          '#welcome .wMs{margin:20px auto 4px;max-width:560px}'+
          '#welcome .wMrow{display:flex;align-items:center;justify-content:space-between;gap:10px;'+
            'padding:8px 4px;border-top:1px solid rgba(202,161,90,.14);font-size:13.5px;color:#d6ccb2}'+
          '#welcome .wMrow:first-child{border-top:none} #welcome .wMrow b{color:#fff7e6;font-weight:600}'+
          '#welcome .wMrow .wMe{font-size:18px;flex:0 0 auto}'+
          '#welcome .wMrow .wMt{flex:1;text-align:left}'+
          '#welcome .wGo{margin:22px auto 4px;display:inline-block;cursor:pointer;font-family:"Frank Ruhl Libre",serif;'+
            'font-size:17px;color:#1a1606;background:linear-gradient(160deg,#caa15a,#a07c38);border:none;'+
            'border-radius:24px;padding:11px 34px;box-shadow:0 8px 22px rgba(0,0,0,.45)}'+
          '#welcome .wGo:hover{background:linear-gradient(160deg,#d8b265,#b1873d)}'+
          // PHONE: dedication + odometer wrap to full-width cards, comfy tap target
          '@media(max-width:760px),(max-height:540px){'+
            '#welcome .wDed{font-size:18px}'+
            '#welcome .wo{flex:1 1 100%;min-width:0;padding:11px 10px}'+
            '#welcome .wo .wn{font-size:23px} #welcome .wMrow{font-size:12px}'+
            '#welcome .wGo{font-size:15px;padding:12px 30px;min-height:34px}'+
          '}'));
      }
      // count-up animator: ~1.5s ease-out from 0 → target, formatted he-IL with commas.
      function countUp(node,target,suffix){
        if(!node) return;
        const T=(typeof target==='number'&&isFinite(target))?target:0, DUR=1500, t0=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
        function fmt(n){ try{ return Math.round(n).toLocaleString('he-IL'); }catch(e){ return String(Math.round(n)); } }
        function step(){
          const now=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
          let p=(now-t0)/DUR; if(p>1)p=1; const e=1-Math.pow(1-p,3);   // ease-out cubic
          node.textContent=fmt(T*e)+(suffix||'');
          if(p<1){ try{ requestAnimationFrame(step); }catch(_){ node.textContent=fmt(T)+(suffix||''); } }
        }
        try{ requestAnimationFrame(step); }catch(_){ node.textContent=fmt(T)+(suffix||''); }
      }
      const renderWelcome=(host,nums,ms)=>{
        host.innerHTML='<div id="welcome"></div>';
        const w=host.querySelector('#welcome');
        nums=nums||{}; ms=ms||{};
        // odometer cards: days · full moons · orbital km. The big NUMBER animates; the
        // unit/label stays. orbital uses the json's pre-formatted he string ("40.4 billion").
        const orbitHe=nums.orbital_km_he?esc(nums.orbital_km_he):'';
        const odo=
          `<div class="wo"><div class="wn" data-odo="days">0</div><div class="wl">Days since you were born</div></div>`+
          `<div class="wo"><div class="wn" data-odo="moons">0</div><div class="wl">Full moons</div></div>`+
          `<div class="wo"><div class="wn" data-odo="orbit">${orbitHe||'—'}</div><div class="wl">km around the sun</div></div>`;
        // milestone live counters: each event → "N years and M months" from its date to today.
        const now=nowDate();
        const evs=(Array.isArray(ms.events)?ms.events:[])
          .map(e=>({...e,_d:parseISO(e&&e.date)})).filter(e=>e._d).sort((a,b)=>a._d-b._d);
        const msRows=evs.map(e=>{ const elp=elapsedHe(e._d,now);
          return `<div class="wMrow"><span class="wMe">${esc(e.emoji||'•')}</span><span class="wMt">${esc(e.he||'')}</span><b>${elp?esc(elp):'—'}</b></div>`; }).join('');
        const foot=nums.footnote_he?`<div class="wFoot">${esc(nums.footnote_he)}</div>`:'';
        w.innerHTML=
          `<div class="wDed">${esc(WELCOME_DEDICATION_HE)}</div>`+
          `<div class="wOdo">${odo}</div>`+foot+
          (msRows?`<div class="wMs">${msRows}</div>`:'')+
          `<button type="button" class="wGo">Let's begin</button>`;
        // animate the two numeric odometer cells (orbital is shown as the pre-formatted he string)
        countUp(w.querySelector('[data-odo="days"]'), nums.days, '');
        countUp(w.querySelector('[data-odo="moons"]'), nums.full_moons, '');
        const go=w.querySelector('.wGo');
        if(go) go.addEventListener('click',()=>{
          try{ localStorage.setItem('home_welcomed_v1','1'); }catch(e){}
          const ov=document.getElementById('bigOverlay'); if(ov) ov.classList.remove('on');
        });
      };
      // open the overlay immediately (so it never feels laggy), then fill in once the
      // two static JSON files resolve. Both fetches are independently optional.
      _openOverlay('Welcome', host=>{
        renderWelcome(host,null,null);   // dedication + button paint instantly
        let _nums=null,_ms=null,_done=0;
        const tryFill=()=>{ if(_done>=2) renderWelcome(host,_nums,_ms); };
        fetch('data/resident_numbers.json').then(r=>r.ok?r.json():null).then(j=>{_nums=j;}).catch(()=>{}).then(()=>{_done++;tryFill();});
        fetch('data/milestones.json').then(r=>r.ok?r.json():null).then(j=>{_ms=j;}).catch(()=>{}).then(()=>{_done++;tryFill();});
      });
    }

    /* ---------- ☁️ cloud-sync STATUS chip (in the #inst header, above the tabs) ----------
       Driven by window.__cloudSync.status() → {state:'init'|'ok'|'disabled',…}. We map
       'ok' → "Synced to cloud ✓" (green dot); anything else (init / local-only / disabled)
       → "Local only" (grey dot). If __cloudSync is absent the chip stays hidden.
       Tiny + non-intrusive; refreshed opportunistically from render(). */
    if(!document.getElementById('csync-css')){
      document.head.appendChild(el('style',null,
        '#inst .csync{display:none;align-items:center;gap:6px;font-size:10px;color:#a99b78;margin:0 2px 6px;line-height:1}'+
        '#inst .csync.show{display:inline-flex}'+
        '#inst .csync .csdot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:#7e8aa6;box-shadow:0 0 5px rgba(126,138,166,.6)}'+
        '#inst .csync.ok{color:#9fce9f} #inst .csync.ok .csdot{background:#7fd07f;box-shadow:0 0 6px rgba(127,208,127,.7)}'+
        // PHONE: keep it readable + comfortably visible at the top of the sheet
        '@media(max-width:760px),(max-height:540px){#inst .csync{font-size:11px}}'));
    }
    const _csChip=el('div','csync'); _csChip.id='instCsync';
    _csChip.innerHTML='<span class="csdot"></span><span class="cst"></span>';
    wrap.insertBefore(_csChip, wrap.firstChild);   // sits above the tab strip in the #inst header
    function refreshCloudChip(){
      const cs=window.__cloudSync;
      if(!cs||typeof cs.status!=='function'){ _csChip.classList.remove('show'); return; }   // hide entirely when sync is absent
      let st=null; try{ st=cs.status(); }catch(e){ st=null; }
      const ok=!!(st&&st.state==='ok');
      _csChip.classList.add('show');
      _csChip.classList.toggle('ok',ok);
      const lbl=_csChip.querySelector('.cst');
      if(lbl) lbl.textContent=ok?'Synced to cloud ✓':'Local only';
    }
    refreshCloudChip();

    function render(force){
      refreshCloudChip();   // opportunistic refresh of the cloud-sync status chip
      const date=nowDate();
      if(active==='home'){ if(force) renderHome(date); }
      else if(active==='house'){ if(force) renderHouse(date); }
      else if(active==='yard') renderYard(date,force);
      else if(active==='sky') renderSky(date);
      else if(active==='energy'){ if(force) renderEnergy(date); }
      else if(active==='wild'){ renderWild(force); }
      else if(active==='env'){ if(force) renderEnv(date); }
      else if(active==='brain'){ if(force) renderBrain(date); }
    }
    // yard zone rows → open that zone's workbench-style card (zone_card.js): fly top-down
    // + a tabbed info card, like a room. Delegated ONCE on the persistent #inst body so it
    // survives the per-second #yard-mc re-render.
    body.addEventListener('click',e=>{ const z=e.target.closest('[data-zc]'); if(z&&window.__zoneCard) window.__zoneCard.open(z.getAttribute('data-zc')); });
    body.addEventListener('keydown',e=>{ if(e.key!=='Enter'&&e.key!==' ')return; const z=e.target.closest&&e.target.closest('[data-zc]'); if(z&&window.__zoneCard){ e.preventDefault(); window.__zoneCard.open(z.getAttribute('data-zc')); } });

    /* ---------- 📖 place stories (curated Hebrew, woven into the topic tabs) ---------- */
    const STORIES={
      geology:{file:'valley_geology', t:'The geology of the valley'},
      darksky:{file:'dark_sky', t:'The dark skies'},
      desert:{file:'desert_nature', t:'The local nature'},
      town:{file:'town_story', t:'The story of Larkmont'},
      trade:{file:'trade_road', t:'The old road'}
    };
    const _storyCache={}; let _storyEl=null;
    function ensureStoryEl(){
      if(_storyEl) return;
      _storyEl=el('div'); _storyEl.id='storyCard'; _storyEl.setAttribute('dir','ltr');
      _storyEl.appendChild(el('div','sc-body'));
      document.body.appendChild(_storyEl);
      document.head.appendChild(el('style',null,
        '#storyCard{position:fixed;inset:0;z-index:99999;display:none;align-items:flex-start;justify-content:center;background:rgba(4,5,12,.8);backdrop-filter:blur(6px);overflow-y:auto;padding:40px 16px}'+
        '#storyCard.on{display:flex} #storyCard .sc-inner{position:relative;max-width:620px;width:100%;background:linear-gradient(160deg,rgba(12,14,26,.97),rgba(6,7,15,.98));border:1px solid rgba(202,161,90,.3);border-radius:14px;padding:26px 30px;box-shadow:0 24px 70px rgba(0,0,0,.6);color:#e9e0c8}'+
        '#storyCard h2{font-family:"Frank Ruhl Libre",serif;font-weight:500;font-size:26px;color:#fff7e6;margin-bottom:4px;padding-left:28px}'+
        '#storyCard .sc-min{font-size:11px;color:#caa15a;font-family:Bellefair,serif;letter-spacing:.1em;margin-bottom:16px}'+
        '#storyCard h3{font-family:"Frank Ruhl Libre",serif;color:#e0c07a;font-size:18px;margin:18px 0 6px}'+
        '#storyCard p{font-size:14px;line-height:1.78;color:#d6ccb2;margin-bottom:8px}'+
        '#storyCard .sc-src{margin-top:18px;padding-top:12px;border-top:1px solid rgba(202,161,90,.16);font-size:11px;color:#8b8062} #storyCard .sc-src a{color:#caa15a}'+
        '#storyCard .sc-x{position:absolute;top:16px;left:20px;cursor:pointer;color:#a99b78;font-size:20px} #storyCard .sc-x:hover{color:#fff7e6}'+
        '.storyBtns{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 2px} .storyBtn{cursor:pointer;background:rgba(202,161,90,.1);border:1px solid rgba(202,161,90,.3);color:#e9dcbb;border-radius:20px;padding:5px 12px;font-size:12px} .storyBtn:hover{background:rgba(202,161,90,.18);color:#fff7e6}'));
      _storyEl.addEventListener('click',e=>{ if((e.target.closest&&e.target.closest('[data-sc-close]'))||e.target===_storyEl) hideStory(); });
      document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&_storyEl&&_storyEl.classList.contains('on')) hideStory(); });
    }
    function hideStory(){ if(_storyEl) _storyEl.classList.remove('on'); }
    function renderStory(s){
      ensureStoryEl();
      const secs=(s.sections||[]).map(x=>`<h3>${esc(x.h||'')}</h3><p>${esc(x.body_he||'').split('\n').join('<br>')}</p>`).join('');
      const src=(s.sources&&s.sources.length)?`<div class="sc-src">Sources: ${s.sources.map(o=>o.url?`<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.name||o.url)}</a>`:esc(o.name||'')).join(' · ')}</div>`:'';
      _storyEl.querySelector('.sc-body').innerHTML=`<div class="sc-inner"><span class="sc-x" data-sc-close="1">✕</span><h2>${esc(s.title_he||'')}</h2>`+(s.read_minutes?`<div class="sc-min">${s.read_minutes} min read</div>`:'')+secs+src+`</div>`;
      _storyEl.classList.add('on');
    }
    function openStory(key){
      const meta=STORIES[key]; if(!meta) return;
      if(_storyCache[key]){ renderStory(_storyCache[key]); return; }
      ensureStoryEl();
      fetch('content/stories/'+meta.file+'.json').then(r=>r.ok?r.json():null).then(j=>{ if(j){ _storyCache[key]=j; renderStory(j); } }).catch(()=>{});
    }
    function storyBtns(keys){ return `<div class="storyBtns">`+keys.map(k=>STORIES[k]?`<span class="storyBtn" data-story="${k}" role="button" tabindex="0">📖 ${STORIES[k].t}</span>`:'').join('')+`</div>`; }
    body.addEventListener('click',e=>{ const sb=e.target.closest&&e.target.closest('[data-story]'); if(sb) openStory(sb.getAttribute('data-story')); });

    /* ---------- yard ---------- */
    // The yard tab is now the ONE yard+garden hub: the live MICROCLIMATE (sun/shade/
    // UV/frost per zone + the "X° at your house" estimate) on TOP, and the full GARDEN
    // OVERVIEW (garden.js — plant table, 📖 magazine, search, "worth adding" recs)
    // below it. The old simple "🌿 your plants" cards are gone (replaced by the rich
    // table), and the floating "🌿 the garden" panel/button are retired.
    //
    // LIVENESS without wiping the search box: the microclimate re-renders every
    // second (render(false)→renderYard(date,false)), but that tick only rewrites the
    // #yard-mc sub-container. The garden overview lives in a SIBLING #yard-garden
    // container that the tick never touches, so its search input keeps focus/value.
    // The garden is mounted once via Garden.renderOverviewInto on tab-show (force) /
    // first build; a `_yardGardenMounted` guard + a tiny retry handle garden.js
    // loading AFTER panels.js (script order), without double-wiring.
    let _yardGardenMounted=false, _yardGardenRetry=0, _yardGardenOnReadyHooked=false;
    // DELAY FIX: mount the embedded garden as promptly as the DATA allows.
    // (1) __garden ready (isReady) → mount synchronously; (2) loaded but data not yet
    // parsed → mount on its onReady() signal (no poll lag); (3) only while garden.js
    // itself hasn't executed (script-order gap) do we poll, fast (40ms). The placeholder
    // shows only for that brief gap. NO side panel: the overview is mounted plainly
    // (no routing callback), so a plant row opens the floating card in place (as before).
    function mountYardGarden(){
      const host=$('yard-garden'); if(!host) return;
      const g=window.__garden;
      if(g&&g.renderOverviewInto&&(!g.isReady||g.isReady())){
        g.renderOverviewInto(host); _yardGardenMounted=true; _yardGardenRetry=0; return;
      }
      if(g&&g.onReady&&!_yardGardenOnReadyHooked){
        _yardGardenOnReadyHooked=true;
        host.innerHTML='<div class="sub" style="margin-top:2px">Loading the garden…</div>';
        g.onReady(()=>{ _yardGardenOnReadyHooked=false; if(active==='yard'&&!_yardGardenMounted) mountYardGarden(); });
        return;
      }
      if(!(g&&g.renderOverviewInto) && _yardGardenRetry<150){
        _yardGardenRetry++;
        if(_yardGardenRetry===1) host.innerHTML='<div class="sub" style="margin-top:2px">Loading the garden…</div>';
        setTimeout(()=>{ if(active==='yard') mountYardGarden(); },40);
      }
    }
    function yardMicroHtml(date){
      if(!window.Astro) return ''; const s=window.Astro.sun(date);
      const cloud=(window.Weather&&Weather.cur)?Weather.cur.cloud:0.1;
      let backyard=null, rows='';
      zones.forEach(z=>{const st=Derive.zoneState(z,s.azDeg,s.altDeg),rad=Derive.radiation(s.altDeg,st.sunlit,cloud);
        if(z.id==='backyard')backyard=st;
        const sch=Derive.shadeSchedule(z,date);
        rows+=`<div class="row zcrow" data-zc="${z.id}" role="button" tabindex="0" title="Open zone card" style="cursor:pointer"><span>${z.name_he}<div class="est" style="color:#8b97b4">${st.sunlit?('radiation '+rad.level+' · UV ')+'<span style="color:'+uvColor(rad.uv)+'">'+rad.uv+'</span>':'shaded'} · sun today ${sch?sch.firstSun+'–'+sch.lastSun:'—'}</div></span>`+
          `<span style="display:flex;align-items:center;gap:7px"><span class="chip ${st.sunlit?'sun':'shade'}">${st.sunlit?'☀':'◑'} ${st.label}</span><span class="zcgo" style="color:#caa15a;opacity:.55;font-size:14px">→</span></span></div>`;});
      const town=(window.Weather&&Weather.state)?Weather.state.temp:null, mc=Derive.microclimate(town,backyard||{sunlit:false},s.altDeg);
      return `<h3>Your yard · now</h3><div class="sub">Sun · shade · radiation — derived from the real geometry of the house and the ridge</div>${rows}`+
        (mc?`<div class="card"><div class="big">${mc.temp}°${xplSlot('microclimate_temp')}</div><div class="m" style="color:#a99b78">at your house${town!=null?' · in town '+town+'° ('+(mc.delta>=0?'+':'')+mc.delta+'°)':''} · ${mc.note}</div><div class="est">Calculated estimate (not a measurement)</div></div>`:'')+
        `<div class="foot">Changes over time — roll the slider and watch the shadow move</div>`+
        `<div class="sub" style="margin-top:14px">🌿 Your garden</div>`;
    }
    function renderYard(date,force){
      if(!window.Astro) return;
      const mcEl=$('yard-mc');
      // (Re)build the two-part shell on tab-show (force) or if it's missing; otherwise
      // the per-second tick only refreshes the microclimate, leaving the garden (and
      // its live search box) untouched.
      if(force || !mcEl){
        body.innerHTML=`<div id="yard-mc">${yardMicroHtml(date)}</div><div id="yard-model">${microclimateBlock(date)}</div><div id="yard-agro"></div><div id="yard-garden"></div>`;
        wireMicroclimate(date);
        mountXplChips(body);   // "?" chips on the yard temp card + per-zone microclimate readout
        const _ag=$('yard-agro'); if(_ag&&window.__agro&&window.__agro.render){ try{ window.__agro.render(_ag,date); }catch(e){} }
        _yardGardenMounted=false;
        mountYardGarden();
      } else {
        mcEl.innerHTML=yardMicroHtml(date);
        mountXplChips(mcEl);   // re-mount the microclimate_temp chip after the per-second tick rewrites #yard-mc
        if(!_yardGardenMounted) mountYardGarden();   // recover if garden.js arrived late
      }
    }

    /* ---------- home (dashboard / living cockpit — home.js) ---------- */
    function renderHome(date){
      if(window.__home&&window.__home.render){ try{ window.__home.render(body,date); }catch(e){ body.innerHTML='<h3>The living house</h3><div class="sub">Error loading the panel.</div>'; } return; }
      body.innerHTML='<h3>The living house</h3><div class="sub">Loading…</div>';
      setTimeout(()=>{ if(active==='home') renderHome(nowDate()); },140);
    }
    /* ---------- house (the physical house: enter 3D + rooms + zoning) ---------- */
    function renderHouse(date){
      const inside=!!(window.__enterMode&&window.__enterMode.on);
      const SEAS=[['live','Now'],['winter','Winter'],['spring','Spring'],['summer','Summer'],['autumn','Autumn']];
      body.innerHTML=
        `<h3>Your house</h3>`+
        `<div class="sub">Step inside in 3D — the rooms, the construction and the maintenance</div>`+
        `<div class="row" id="house-enter" role="button" tabindex="0" title="Reveal the rooms" style="cursor:pointer">`+
          `<span><span class="hg" style="color:#caa15a">🚪</span> ${inside?'Exit the house':'Enter the house · 3D'}</span>`+
          `<span class="zcgo" style="color:#caa15a;opacity:.6">→</span></div>`+
        `<div class="row" id="house-recenter" role="button" tabindex="0" title="Center the camera on the house" style="cursor:pointer">`+
          `<span><span class="hg" style="color:#caa15a">⌂</span> Center the house</span>`+
          `<span class="zcgo" style="color:#caa15a;opacity:.6">→</span></div>`+
        `<div class="foot">Clicking a room in the model opens the room card — construction, parts, maintenance and renovations.</div>`+
        `<div class="sub" style="margin-top:14px">🌡️ The thermal model · forecast by season</div>`+
        `<div id="house-it"></div>`+
        `<div class="sub" style="font-size:11px">Choose a season — the sun, the shadows and the room temperatures will update to its forecast</div>`+
        `<div class="mc-chips" id="house-seasons">`+SEAS.map(([k,he])=>`<span class="mc-chip" data-hs="${k}">${he}</span>`).join('')+`</div>`+
        `<div class="sub" style="margin-top:16px">🌡️ Room temperatures · now</div>`+
        `<div id="house-rooms"><div class="est">Loading…</div></div>`+
        `<div class="sub" style="margin-top:14px">🌿 Garden shading · now</div>`+
        `<div id="house-yardnow"></div>`+
        `<div class="sub" style="margin-top:14px">🌤️ Weather at your house · now</div>`+
        `<div id="house-weather"></div>`+
        `<div class="sub" style="margin-top:16px">🗺️ Heat map · microclimate model</div>`+
        `<div id="house-model">${microclimateBlock(date)}</div>`;
      mountXplChips(body);   // "?" chips on the #house-model microclimate per-zone readout (dli/sun/etc/frost)
      const eb=$('house-enter'); if(eb){ eb.onclick=()=>{ if(window.__enterMode) window.__enterMode.toggle(); renderHouse(nowDate()); }; eb.onkeydown=(ev)=>{ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); eb.onclick(); } }; }
      const rc=$('house-recenter'); if(rc){ rc.onclick=()=>{ if(window.__flyHome) window.__flyHome(); }; rc.onkeydown=(ev)=>{ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); rc.onclick(); } }; }
      const hs=$('house-seasons'); if(hs) hs.querySelectorAll('[data-hs]').forEach(c=>c.onclick=()=>{
        const k=c.getAttribute('data-hs');
        if(k==='live'){ if(window.__live) window.__live(); }
        else { const m={winter:15,spring:105,summer:196,autumn:288}[k]; if(m!=null&&window.__setDay) window.__setDay(m); }
        renderHouse(nowDate());
      });
      wireMicroclimate(date);   // heat-map model control (toggle + variable + season) now in house too
      // DEFER the heavy computes (indoor-temp EMA, per-room thermal) off the click so the tab
      // paints instantly, then fill the "house now" readouts in.
      setTimeout(()=>{
        if(active!=='house') return;
        const d=nowDate();
        // base interior temp
        let it=null; try{ it=(window.Derive&&Derive.indoorTemp)?Derive.indoorTemp(d):null; }catch(e){}
        const ih=$('house-it'); if(ih&&it){ const ins=!!(window.__enterMode&&window.__enterMode.on);
          ih.innerHTML=`<div class="card"><div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px"><div class="big">~${Math.round(it.tempC*10)/10}°${xplSlot('indoorTemp')}</div><span class="mc-model">Model</span></div><div class="m" style="color:#a99b78">Base temperature in the house${ins?'':' · Enter to see the rooms'}</div></div>`;
          mountXplChips(ih); }
        // per-room temperatures (modeled interior thermal per room)
        const rh=$('house-rooms');
        if(rh){
          // STATIC room table (the dollhouse rooms) so the readout works in the tab BEFORE
          // entering the house — __workbench.allRooms() is empty until EnterMode initialises,
          // but climateSummary(id,date) works off the static room geometry right away.
          const ROOMS_HE=[['kitchen','Kitchen'],['living','Living room'],['bedroomG','Bedroom'],['bathG','Bathroom'],['bedroomNE','Bedroom · North'],['bedroomSW','Bedroom · South'],['bathU','Bathroom · Upper'],['terrace','Terrace']];
          const WB=window.__workbench; let rows=[];
          if(WB&&WB.climateSummary){ rows=ROOMS_HE.map(([id,he])=>{ let cs=null; try{ cs=WB.climateSummary(id,d); }catch(e){}
            const t=(cs&&cs.tempC!=null)?('~'+(Math.round(cs.tempC*10)/10)+'°'):null;
            return t?`<div class="row"><span>${esc(he)}</span><b>${t}</b></div>`:''; }).filter(Boolean); }
          rh.innerHTML = rows.length
            ? rows.join('')+`<div class="est">Thermal model · derived from the outside through the mass and orientation of each room · 🟡 Model · "Enter the house" for a floor heat map</div>`
            : `<div class="est">The room model is loading…</div>`;
        }
        // yard shading right now (per-zone sun/shade)
        const yh=$('house-yardnow');
        if(yh&&window.Astro&&window.Derive&&Derive.zoneState){ const s=Astro.sun(d);
          yh.innerHTML=zones.map(z=>{ const st=Derive.zoneState(z,s.azDeg,s.altDeg);
            return `<div class="row"><span>${esc(z.name_he)}</span><span class="chip ${st.sunlit?'sun':'shade'}">${st.sunlit?'☀ ':'◑ '}${esc(st.label)}</span></div>`; }).join('');
        }
        // house weather right now — extrapolated to his coords + the modeled house delta
        const wh=$('house-weather');
        if(wh){ let html=''; try{ html=weatherBlockHTML(d); }catch(e){}
          const air=(window.Weather&&Weather.air)||null;
          if(air){ html+=`<div class="row"><span>🌫 Air quality <span class="mc-model" style="font-size:9px">Regional</span></span><b>AQI ${air.aqi!=null&&isFinite(air.aqi)?Math.round(air.aqi):'—'}${air.dust!=null&&isFinite(air.dust)?' · Dust '+Math.round(air.dust):''}${air.uv!=null&&isFinite(air.uv)?' · UV '+Math.round(air.uv):''}</b></div>`; }
          wh.innerHTML=html;
        }
      }, 0);
    }
    /* ---------- calendar (calendar.js) ---------- */
    function renderCal(date){
      if(window.__calendar&&window.__calendar.render){ try{ window.__calendar.render(body,date); }catch(e){ body.innerHTML='<h3>Calendar</h3><div class="sub">Error loading the panel.</div>'; } return; }
      body.innerHTML='<h3>Calendar</h3><div class="sub">Loading…</div>';
      setTimeout(()=>{ if(active==='cal') renderCal(nowDate()); },140);
    }

    /* ---------- sky ---------- */
    // marquee bright stars (RA hours, Dec deg) — used for a live "what's up now"
    // readout that matches the visible starfield (same Astro horizon transform).
    const SKY_MARQUEE=[
      ['Sirius',6.7525,-16.716],['Canopus',6.399,-52.696],['Arcturus',14.261,19.182],
      ['Vega',18.616,38.78],['Capella',5.278,45.998],['Rigel',5.242,-8.202],
      ['Procyon',7.655,5.225],['Betelgeuse',5.919,7.407],['Altair',19.846,8.868],
      ['Aldebaran',4.599,16.509],['Antares',16.490,-26.432],['Spica',13.420,-11.161],
      ['Deneb',20.690,45.280],['Fomalhaut',22.961,-29.622],['Regulus',10.139,11.967],
      ['Pollux',7.755,28.026],['Polaris',2.530,89.264]
    ];
    // moon rise/set for the civil day of `date` — scans Astro.moon altitude
    // (no derive helper exists), mirroring Astro.events() for the sun. Returns
    // {rise,set} as HH:MM strings (local time) or '—'.
    function moonRiseSet(date){
      const D=document.documentElement;
      const day=new Date(date); day.setHours(0,0,0,0);
      const fmt=t=>{ if(!t) return '—'; return t.toLocaleTimeString('he-IL',{timeZone:'Etc/GMT+3',hour:'2-digit',minute:'2-digit'}); };
      let rise=null,set=null,prev=null;
      for(let m=0;m<=1440;m+=10){
        const t=new Date(day.getTime()+m*60000), a=window.Astro.moon(t).altDeg;
        if(prev!==null){ if(prev<0&&a>=0&&rise===null) rise=t; if(prev>=0&&a<0&&set===null) set=t; }
        prev=a;
      }
      return {rise:fmt(rise),set:fmt(set)};
    }
    const dirHe=az=>{const d=['N','NE','E','SE','S','SW','W','NW'];return d[Math.round((((az%360)+360)%360)/45)%8];};
    // ---- moon helpers for the merged moon block (was the bottom-left moon card) --
    // forward scan for the NEXT moonrise from `date` (up to 48h, so it still finds a
    // rise after midnight) → "HH:MM" local time, or null. Mirrors the old card's
    // nextMoonrise; cached at ~10-min model-time resolution so the per-second tab
    // re-render is cheap.
    let _mrCache={key:'',val:null};
    function nextMoonriseHM(date){
      if(!window.Astro) return null;
      const key=Math.floor(date.getTime()/600000);
      if(_mrCache.key===key) return _mrCache.val;
      let prev=window.Astro.moon(date).altDeg, out=null;
      for(let m=10;m<=48*60;m+=10){
        const t=new Date(date.getTime()+m*60000), a=window.Astro.moon(t).altDeg;
        if(prev<0 && a>=0){ out=t.toLocaleTimeString('he-IL',{timeZone:'Etc/GMT+3',hour:'2-digit',minute:'2-digit'}); break; }
        prev=a;
      }
      _mrCache={key,val:out}; return out;
    }
    // current camera VIEW heading (bearing, deg from N clockwise) so the moon
    // direction arrow can point to the moon RELATIVE to where the user looks —
    // matching the old card. World frame (astro.js): +x=E, +z=S ⇒ N=−z; heading =
    // atan2(dir.x,−dir.z). Falls back to 0 (North-up) if the camera isn't ready.
    function viewHeadingDeg(){
      const cam=window.__camera, ctr=window.__controls;
      if(!cam||!ctr||!ctr.target) return 0;
      const dx=ctr.target.x-cam.position.x, dz=ctr.target.z-cam.position.z;
      if(dx*dx+dz*dz<1e-9) return 0;
      return ((Math.atan2(dx,-dz)*180/Math.PI)%360+360)%360;
    }
    // 8-step moon-phase emoji from the phase fraction (0=new..0.5=full..1=new) and
    // waxing flag — a crisp phase glyph for the panel (matches the tab's emoji style;
    // avoids embedding a re-rendered <canvas>). Order: new→waxing→full→waning.
    function moonGlyph(frac, waxing){
      const f=((frac%1)+1)%1;
      if(f<0.03||f>0.97) return '🌑';
      if(Math.abs(f-0.25)<0.06) return waxing?'🌓':'🌗';
      if(Math.abs(f-0.5)<0.04)  return '🌕';
      if(f<0.5) return waxing?'🌒':'🌘';
      return waxing?'🌔':'🌖';
    }
    // ---- "tonight" anchor for the consolidated "when to look up" summary ----
    // The summary describes the UPCOMING DARK WINDOW, not the scrubbed instant, so its
    // verdict/planets/ISS are computed at ~21:00 local of the relevant night.
    // Rule (mirrors Weather.tonightCloud): before ~06:00 local, "tonight" is the
    // evening that just passed (so a 02:00 view still talks about the active night),
    // otherwise it's tonight's coming evening. Returns a Date at 21:00 local time.
    function localHour(date){
      try{ return +new Intl.DateTimeFormat('en-GB',{timeZone:'Etc/GMT+3',hour:'2-digit',hour12:false}).formatToParts(date).find(p=>p.type==='hour').value % 24; }
      catch(e){ return date.getHours(); }
    }
    // UTC ms for HH:00 local time on the civil day of `ref` (computed by reading
    // the local offset at that moment via the en-CA formatter).
    function localTimeMs(ref, hh){
      const f=new Intl.DateTimeFormat('en-CA',{timeZone:'Etc/GMT+3',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
      const p={}; f.formatToParts(ref).forEach(o=>{p[o.type]=o.value;});
      const asUTC=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour===24?0:+p.hour,+p.minute,+p.second);
      const offset=asUTC-ref.getTime();                 // local offset (ms) at `ref`
      const localMidnightUTC=Date.UTC(+p.year,+p.month-1,+p.day,0,0,0)-offset;
      return localMidnightUTC + hh*3600000;
    }
    function tonightDate(date){
      const base=(localHour(date)<6) ? new Date(date.getTime()-12*3600000) : date;
      return new Date(localTimeMs(base,21));           // ~21:00 local
    }
    // ISS satrec (NORAD 25544) from the live/fallback Satellites set, or null.
    function issRec(){
      try{ const s=(window.Satellites&&Satellites.list||[]).find(x=>x.id===25544); return s?s.satrec:null; }
      catch(e){ return null; }
    }
    // ---- BUILD the consolidated "🔭 when to look up" block (top of sky) ----
    // Four tidy rows in the #inst skin, all for TONIGHT's dark window: next meteor
    // shower (+ moon-wash caveat), planets up after dark, next visible ISS pass, and
    // the moon-phase + stargazing verdict. Self-contained (uses real Astro/Satellites
    // engines), so it doesn't depend on the 3D sky.js update loop having run.
    function lookUpSummary(date){
      const T=tonightDate(date);
      const cloud=(window.Weather&&Weather.cur)?Weather.cur.cloud:0.1;   // fallback for goOutScore
      const fmtClock=t=>new Date(t).toLocaleTimeString('he-IL',{timeZone:'Etc/GMT+3',hour:'2-digit',minute:'2-digit'});
      const clkT=(az,alt)=>`data-az="${(+az).toFixed(2)}" data-alt="${(+alt).toFixed(2)}"`;
      let rows='';
      // (1) 🌠 next meteor shower — name + date + days-away + moon-wash check at peak.
      const met=Derive.nextMeteor?Derive.nextMeteor(T):null;
      if(met){
        let wash='';
        try{
          const moAtPeak=window.Astro.moon(met.date);
          if(moAtPeak && moAtPeak.illum>0.55) wash=` · Moon ${Math.round(moAtPeak.illum*100)}% brightens the background`;
          else wash=' · Faint moon — dark skies';
        }catch(e){}
        const soon=met.days<=1;
        rows+=`<div class="luRow"><span class="luIc">🌠</span><div class="luTx">`+
          `<div class="luT">${met.name}${xplSlot('nextMeteor')}${soon?' <span class="luTag">Tonight!</span>':''}</div>`+
          `<div class="luS">Peak in ${met.days} days · ${met.date.toLocaleDateString('he-IL')} · ZHR ~${met.zhr}${wash}</div>`+
          `</div></div>`;
      }
      // (planets up tonight live in the detailed "🪐 planets now" list below — not repeated in the digest)
      // (3) 🛰️ next visible ISS pass — only if genuinely naked-eye visible.
      const rec=issRec();
      if(rec && window.Astro.sunEciUnit && window.Satellites){
        try{
          const sunU=window.Astro.sunEciUnit(T);
          const pass=window.Satellites.nextPass(rec, T, sunU);
          if(pass && pass.anyVisible){
            const dir=window.Satellites.dirHe(pass.peakAz);
            rows+=`<div class="luRow clkable" ${clkT(pass.peakAz,pass.peakAlt)}><span class="luIc">🛰️</span><div class="luTx">`+
              `<div class="luT">Space Station (ISS) — visible pass</div>`+
              `<div class="luS">${fmtClock(pass.rise)} · Peak ${dir} at ${Math.round(pass.peakAlt)}° elevation</div>`+
              `</div></div>`;
          }
        }catch(e){}
      }
      // (4) 🌙 moon phase + tonight's stargazing verdict (clear/dark/full → Hebrew).
      const moT=window.Astro.moon(T), sT=window.Astro.sun(T);
      const nc=(window.Weather&&Weather.tonightCloud)?Weather.tonightCloud(T):null;
      const goT=Derive.goOutScore(cloud,moT.illum,sT.altDeg,nc,{hum:(window.Weather&&Weather.state)?Weather.state.hum:null, dust:(window.Weather&&Weather.air&&Weather.air.pm10!=null)?Weather.air.pm10:((window.Weather&&Weather.state&&Weather.state.dust!=null)?Weather.state.dust*200:null)});
      const illumPct=Math.round(moT.illum*100);
      let verdict, vCls;
      if(nc!=null && nc>0.5){ verdict='Cloudy — less good'; vCls='lo'; }
      else if(moT.illum>0.75){ verdict='Moon almost full — brightens the background'; vCls='mid'; }
      else if(goT && goT.score>=70){ verdict='Excellent night for stargazing'; vCls='hi'; }
      else if(goT && goT.score>=45){ verdict='Decent night for stargazing'; vCls='mid'; }
      else { verdict='Less recommended tonight'; vCls='lo'; }
      rows+=`<div class="luRow"><span class="luIc">${moonGlyph(moT.frac,moT.waxing)}</span><div class="luTx">`+
        `<div class="luT">${moT.name}${xplSlot('moonPhase')} · ${illumPct}% lit <span class="luV ${vCls}">${verdict}</span></div>`+
        `<div class="luS">${goT?('Viewing score '+goT.score+'/100'+xplSlot('goOutScore')+' · Bortle-3 · Transparency '+Math.round((goT.transparency!=null?goT.transparency:1)*100)+'%'+xplSlot('transparency')):'The score will appear after dusk'}${nc!=null?' · ~'+Math.round(nc*100)+'% cloud cover this evening':''}</div>`+
        `</div></div>`;
      if(!rows) return '';
      const when=fmtClock(T.getTime());
      return `<div class="lookup"><div class="luHd">🔭 When to look up <span class="luWhen">Tonight · ~${when}</span></div>${rows}`+
        `<div class="luFoot">Calculated for the upcoming dark window (not the time on the slider) · click a row to focus the view</div></div>`;
    }
    let _skyExtEl=null;   // persistent host for sky_extras (moved into body each tick, not re-rendered)
    function renderSky(date){
      if(!window.Astro) return; const s=window.Astro.sun(date), mo=window.Astro.moon(date);
      // the stargazing score/verdict + the meteor shower now live in the lookUpSummary
      // digest at the top (de-duplicated); renderSky keeps only the live detail below.
      const ev=Derive.sunEvents(date);
      const tw=Derive.twilightTimes?Derive.twilightTimes(date):null;       // golden/twilight clock times
      const gc=Derive.galacticCore?Derive.galacticCore(date):null;          // Milky-Way core tonight
      const dn=Derive.nextDarkNight?Derive.nextDarkNight(date):null;        // next new-moon dark night
      const zl=Derive.zodiacalLight?Derive.zodiacalLight(date):null;        // zodiacal-light cone tonight
      const op=(window.Derive&&Derive.overnightPasses)?Derive.overnightPasses():[];   // ISS 'while you slept'
      const moonUp=mo.altDeg>0, mrs=moonRiseSet(date);
      // clickable sky-object row: data-az/data-alt → window.__lookAtSky on click
      // (the delegated handler on `body` reads these). Use the body's CURRENT az/alt.
      const clk=(az,alt)=>`class="row clk" data-az="${az.toFixed(2)}" data-alt="${alt.toFixed(2)}"`;
      // PLANETS up now: real geocentric positions above the horizon, brightest first
      let planHtml='';
      if(window.Astro.planets){
        const up=window.Astro.planets(date).filter(p=>p.altDeg>2).sort((a,b)=>a.mag-b.mag);
        if(up.length){
          planHtml=`<div class="sub" style="margin-top:12px">🪐 Planets now</div>`+
            up.map(p=>`<div ${clk(p.azDeg,p.altDeg)}><span class="nm">${p.he}</span><span style="color:#a99b78">${Math.round(p.altDeg)}° · ${dirHe(p.azDeg)} · Magnitude ${p.mag.toFixed(1)}</span></div>`).join('');
        }
      }
      // what's up now: brightest marquee stars currently above the horizon (dark enough)
      let upHtml='';
      if(s.altDeg<0 && window.Astro.eqToHorizon){
        const up=SKY_MARQUEE.map(([nm,ra,dec])=>({nm,a:window.Astro.eqToHorizon(ra,dec,date)}))
          .filter(o=>o.a.altDeg>8).sort((x,y)=>y.a.altDeg-x.a.altDeg).slice(0,4);
        if(up.length){
          upHtml=`<div class="sub" style="margin-top:12px">✨ Bright stars overhead</div>`+
            up.map(o=>`<div ${clk(o.a.azDeg,o.a.altDeg)}><span class="nm">${o.nm}</span><span style="color:#a99b78">${Math.round(o.a.altDeg)}° · ${dirHe(o.a.azDeg)}</span></div>`).join('');
        }
      }
      // ☀️ SUN altitude — always shown (was on the old moon card: "sun altitude N°"),
      // so you can read how far below the horizon the sun is (how dark it is). When
      // the sun is actually up (via scrubbing) the row also becomes a clickable
      // focus target with its azimuth/direction.
      let sunHtml='';
      if(s.altDeg>0){
        sunHtml=`<div ${clk(s.azDeg,s.altDeg)}><span class="nm">☀️ Sun</span>`+
          `<span style="color:#a99b78">Altitude ${Math.round(s.altDeg)}° · ${dirHe(s.azDeg)}</span></div>`;
      } else {
        sunHtml=`<div class="row"><span>☀️ Sun altitude</span>`+
          `<span style="color:#a99b78">${Math.round(s.altDeg)}° (below horizon)</span></div>`;
      }
      // 🛰 SATELLITE PASSES — surfaced from sky.js (SkyRig.satPasses()), replacing
      // the old floating bottom-left #satInfo panel. Each sat: name, rise time,
      // peak direction (Hebrew) + max elevation, and a "visible to the eye" tag when the
      // pass is genuinely naked-eye visible. Rows are clickable → focus the camera
      // on the sat's CURRENT az/alt if it's up now, otherwise on its peak az/alt.
      // Updates with the scrubbed time (renderSky re-runs every second).
      let satHtml='';
      const passes=(window.SkyRig&&SkyRig.satPasses)?SkyRig.satPasses():(window.__satPasses||[]);
      if(passes&&passes.length){
        const note=window.__satEpochNote||'';
        satHtml=`<div class="sub" style="margin-top:12px">🛰 Satellites · passes</div>`+
          passes.map(p=>{
            const focAz=(p.up&&p.curAzDeg!=null)?p.curAzDeg:p.peakAz;
            const focAlt=(p.up&&p.curAltDeg!=null)?p.curAltDeg:p.peakAlt;
            const when = p.up ? 'Now above the horizon' : ('Rise '+p.riseHM);
            const visTag = p.visible ? ' · <span class="satvis">Visible to the eye</span>' : '';
            return `<div class="satrow" data-az="${(+focAz).toFixed(2)}" data-alt="${(+focAlt).toFixed(2)}">`+
              `<span><span style="color:${p.color}">●</span> <span class="sn">${p.he}</span> <span class="ss">${p.short}</span></span>`+
              `<span class="sm">${when}<br>${p.peakAzHe} · Peak ${p.peakAlt}°${visTag}</span></div>`;
          }).join('')+
          (note?`<div class="foot" style="margin-top:4px">${note}</div>`:'');
      }
      // ---- MERGED MOON BLOCK (consolidates the removed bottom-left moon card) ----
      // One clean block at the top of sky: phase glyph + name, illum % +
      // above/below-horizon, the direction arrow + live state ("below horizon · rise
      // HH:MM" when down, else cardinal · azimuth), and moon rise/set for the day.
      // Clickable (→ focus the 3D view on the moon) only when it's above the horizon
      // — focusing a below-horizon body would aim the camera into the ground.
      // Arrow rotation = moonAz − cameraHeading (world N=−z=0°, E=+x=90°); the SVG
      // points UP at 0deg and CSS rotate is clockwise, so up = straight ahead.
      const heading=viewHeadingDeg();
      const relAz=((mo.azDeg-heading)%360+360)%360;
      let mdState, mdCls;
      if(!moonUp){
        const r=nextMoonriseHM(date);
        mdState='Below horizon'+(r?' · Rise '+r:''); mdCls='down';
      } else {
        mdState=dirHe(mo.azDeg)+' · '+Math.round(mo.azDeg)+'°'; mdCls='up';
      }
      const moonGl=moonGlyph(mo.frac, mo.waxing);
      const moonBlk=
        `<div ${moonUp?`class="moonblk clk" data-az="${mo.azDeg.toFixed(2)}" data-alt="${mo.altDeg.toFixed(2)}"`:'class="moonblk"'}>`+
          `<div class="top"><span class="gl">${moonGl}</span>`+
            `<div><div class="mn">🌙 ${mo.name}</div>`+
            `<div class="mi">${Math.round(mo.illum*100)}% lit · ${moonUp?Math.round(mo.altDeg)+'° above the horizon':'below horizon'}</div></div></div>`+
          `<div class="mdir"><span class="mdArrow ${mdCls}" style="transform:rotate(${relAz.toFixed(0)}deg)">`+
            `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2 L18 17 L12 13 L6 17 Z"/></svg></span>`+
            `<span class="mdLbl">Moon direction</span><span class="mdState ${mdCls}">${mdState}</span></div>`+
          `<div class="mrs"><span>🌙 Rise <b>${mrs.rise}</b></span><span>Set <b>${mrs.set}</b></span></div>`+
        `</div>`;
      const _nv=!!(window.SkyRig&&window.SkyRig.isNightView&&window.SkyRig.isNightView());
      body.innerHTML=`<h3>Your sky · tonight</h3><div class="sub">Dark rural area · Bortle 3 · all for your coordinates and horizon</div>`+storyBtns(['darksky'])+
        `<div id="sky-layers" style="margin-top:4px">`+[['constellations','✦ Constellations'],['milkyway','🌌 Milky Way'],['paths','☀ Sun/Moon paths'],['satellites','🛰 Satellites']].map(([k,he])=>`<div class="skylrow"><span>${he}</span><span class="skysw${_skyLayers[k]?' on':''}" data-skl="${k}" role="switch" aria-checked="${_skyLayers[k]?'true':'false'}"></span></div>`).join('')+`</div>`+
        `<div style="display:flex;gap:8px;margin:8px 0 4px;flex-wrap:wrap">`+
          `<span data-nightview role="button" tabindex="0" style="padding:6px 12px;border-radius:9px;cursor:pointer;font-family:Heebo;font-size:12px;color:#caa15a;border:1px solid rgba(202,161,90,${_nv?'.7':'.4'});background:rgba(202,161,90,${_nv?'.26':'.10'})">${_nv?'🌙 Cancel darkening':'🌌 Darken to see stars'}</span>`+
        `</div>`+
        lookUpSummary(date)+
        moonBlk+
        `<div class="row"><span>🌅 Sunrise behind the ridge${xplSlot('sunEvents')}</span><b>${ev?ev.riseRidge:'—'}</b></div>`+
        `<div class="row"><span>🌇 Sunset behind the ridge</span><b>${ev?ev.setRidge:'—'}</b></div>`+
        `<div class="row"><span>Flat horizon (for comparison)</span><span style="color:#a99b78">${ev?ev.riseFlat+' / '+ev.setFlat:'—'}</span></div>`+
        (function(){ let na=null; try{ na=window.Astro&&Astro.noonAlt?Astro.noonAlt(date):null; }catch(e){} return na!=null&&isFinite(na)?`<div class="row"><span>☀️ Sun altitude at noon${xplSlot('noonAlt')}</span><b>${Math.round(na)}°</b></div>`:''; })()+
        (tw?`<div class="row"><span>🌇 Golden hour · twilight (evening)${xplSlot('twilightTimes')}</span><span style="color:#a99b78">Golden ${tw.golden.eve} · Civil ${tw.civil.eve} · Full dark ${tw.astro.eve}</span></div>`:'')+
        (gc?(gc.inSeason
          ?`<div class="row"><span>🌌 Milky Way core${xplSlot('galacticCore')}</span><span style="color:#a99b78">${gc.fromHM}–${gc.toHM} · Peak ${gc.peakAlt}° ${dirHe(gc.peakAz)}${gc.moonIllum>0.5?` · Moon ${Math.round(gc.moonIllum*100)}% interfering`:''}</span></div>`
          :`<div class="row"><span>🌌 Milky Way core${xplSlot('galacticCore')}</span><span style="color:#a99b78">Below the horizon at night · Peak season May–September</span></div>`):'')+
        (dn?`<div class="row clk-no"><span>🌑 Next dark night${xplSlot('nextDarkNight')}</span><span style="color:#a99b78">${dn.daysAway<=0?'Tonight':dn.date.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'})+` · in ${dn.daysAway} d`} · Moon ${Math.round(dn.illum*100)}%${dn.cloud!=null?` · Cloud cover ~${Math.round(dn.cloud*100)}%`:''}</span></div>`:'')+
        (zl?(()=>{ const e=zl.evening,m=zl.morning;
          if(e&&e.good) return `<div class="row"><span>🔺 Zodiacal light${xplSlot('zodiacalLight')}</span><span style="color:#a99b78">False sunset · West · after ${e.hm} · Ecliptic angle ~${e.angleDeg}°</span></div>`;
          if(m&&m.good) return `<div class="row"><span>🔺 Zodiacal light${xplSlot('zodiacalLight')}</span><span style="color:#a99b78">False sunrise · East · before ${m.hm} · Ecliptic angle ~${m.angleDeg}°</span></div>`;
          const mb=(e&&e.moonBad)||(m&&m.moonBad);
          return `<div class="row"><span>🔺 Zodiacal light${xplSlot('zodiacalLight')}</span><span style="color:#a99b78">Cone is flat right now · Peak: evening in spring · morning in autumn${mb?' · The moon interferes':''}</span></div>`;
        })():'')+
        sunHtml+
        planHtml+
        upHtml+
        satHtml+
        (op&&op.length?`<div class="sub" style="margin-top:12px">🛰 What passed over the house tonight${xplSlot('overnightPasses')}</div>`+
          op.map(x=>`<div class="row"><span>🛰 ${x.he}</span><span style="color:#a99b78">${x.hm} · Peak ${x.peakAlt}° ${x.peakAzHe} · Visible to the eye</span></div>`).join(''):'')+
        `<div data-natal style="margin-top:12px;padding:9px 12px;border-radius:8px;cursor:pointer;font-family:'Frank Ruhl Libre',serif;font-size:14px;color:#fff7e6;background:linear-gradient(150deg,rgba(202,161,90,.2),rgba(202,161,90,.06));border:1px solid rgba(202,161,90,.4)">✨ Your personal sky map</div>`+
        `<div class="foot">Live star map — stars, planets, moon and sun in real time by local sidereal time. Click a name to focus the view · hover over a celestial body for details</div>`;
      mountXplChips(body);   // "?" explain chips on every computed sky value (re-mounts each tick)
      // mount sky_extras (harvested catalogs — bright stars up now, Messier, comets, meteor
      // calendar, events almanac) into a PERSISTENT node moved into the freshly-rebuilt body
      // each tick, so the per-second sky re-render never re-filters the 5070-star catalog;
      // "up now" refreshes at most every 45 s.
      if(window.__skyExtras){
        if(!_skyExtEl){ _skyExtEl=el('div'); _skyExtEl.id='sky-extras'; }
        body.appendChild(_skyExtEl);
        const _t=Date.now();
        if(window.__skyExtras.render && (!_skyExtEl.dataset.t || _t-(+_skyExtEl.dataset.t)>45000)){ try{ window.__skyExtras.render(_skyExtEl,date); _skyExtEl.dataset.t=String(_t); }catch(e){} }
      }
    }

    /* ---------- energy ---------- */
    // ====== MICROCLIMATE control + per-zone readout + plant recs (spec §5b) ======
    // The microclimate ENGINE lives in derive.js; the 3-D heatmap + the
    // window.__microclimate API live in app.js. Here we render the CONTROL
    // (on/off + variable + season), a per-zone READOUT (sun-hours, DLI, peak/dawn
    // temp, Δ vs town, frost, ETc + weekly litres, wind), and the TOP PLANT
    // recommendations per zone, all for the selected season. Everything is an
    // estimate ("model · estimate").
    const MC=()=>window.__microclimate;
    // a representative central cell per zone (cached) — derive.js aggregates a
    // zone's cells onto one profile; the central cell is the fair representative.
    const _repCellCache={};
    function repCell(zoneId){
      if(_repCellCache[zoneId]) return _repCellCache[zoneId];
      const cells=(Derive.cellGrid&&Derive.cellGrid())||[];
      const inZone=cells.filter(c=>c.zoneId===zoneId);
      if(!inZone.length) return null;
      // pick the cell nearest the zone's centroid (so SVF/exposure are typical,
      // not an edge cell pinned against a wall).
      let mx=0,mz=0; inZone.forEach(c=>{mx+=c.xL;mz+=c.zL;}); mx/=inZone.length; mz/=inZone.length;
      let best=inZone[0],bd=Infinity;
      inZone.forEach(c=>{const d=(c.xL-mx)**2+(c.zL-mz)**2; if(d<bd){bd=d;best=c;}});
      _repCellCache[zoneId]=best; return best;
    }
    // map the __microclimate season to a cached-profile season ('live' → the
    // current calendar season, since DLI/sun-hours/frost are daily integrals).
    function profSeason(season,date){
      if(season&&season!=='live') return season;
      return seasonKey(date.getMonth());
    }
    function frostLevel(prof){
      if(!prof) return {txt:'—',cls:''};
      if(prof.frost) return {txt:'High',cls:'frost-hi'};
      const td=(prof.frostTdawn!=null)?prof.frostTdawn:prof.Tdawn;
      if(td!=null && td<=3) return {txt:'Medium',cls:'frost-mid'};
      if(td!=null && td<=6) return {txt:'Low',cls:''};
      return {txt:'None',cls:''};
    }
    // CSS gradient string for the legend bar of the active variable.
    function legendGradient(varKey){
      if(varKey==='surfaceTemp'||varKey==='airDelta')
        return 'linear-gradient(90deg,rgb(33,51,158) 0%,rgb(41,140,217) 22%,rgb(51,204,199) 40%,rgb(115,209,102) 55%,rgb(245,219,77) 70%,rgb(242,140,51) 85%,rgb(230,46,36) 100%)';
      if(varKey==='dli'||varKey==='sunHours')
        return 'linear-gradient(90deg,rgb(41,56,102) 0%,rgb(140,140,102) 40%,rgb(230,189,77) 70%,rgb(255,247,204) 100%)';
      if(varKey==='frost')
        return 'linear-gradient(90deg,rgb(77,184,107) 0%,rgb(77,199,217) 45%,rgb(51,115,235) 75%,rgb(26,41,189) 100%)';
      if(varKey==='etc')
        return 'linear-gradient(90deg,rgb(219,214,158) 0%,rgb(89,189,189) 50%,rgb(26,82,199) 100%)';
      if(varKey==='wind')
        return 'linear-gradient(90deg,rgb(77,168,102) 0%,rgb(230,189,77) 50%,rgb(219,77,56) 100%)';
      return 'linear-gradient(90deg,#2a5d8f,#e8b24a)';
    }
    // build the whole microclimate block HTML for the current __microclimate state.
    function microclimateBlock(date){
      const mc=MC(); if(!mc) return '';
      const on=mc.isOn(), curVar=mc.getVariable(), curSeason=mc.getSeason();
      const seas=profSeason(curSeason,date);
      // control header + on/off
      let html=`<div class="mc-hd"><span class="mt">Microclimate · heat map</span>`+
        `<span style="display:flex;align-items:center;gap:7px"><span class="mc-model">Model · estimate</span>`+
        `<span class="mc-sw${on?' on':''}" id="mc-onoff" role="switch" aria-checked="${on?'true':'false'}"></span></span></div>`+
        `<div class="sub" style="margin-top:0">3D heat map over the yard — derived from a physical energy balance for every ~0.5 m</div>`;
      // variable + season chip selectors (greyed when OFF)
      const dim=on?'':' mc-off';
      html+=`<div class="mc-lbl">Variable</div><div class="mc-chips${dim}" id="mc-vars">`+
        mc.VARIABLES.map(v=>`<span class="mc-chip${v.key===curVar?' on':''}" data-v="${v.key}">${v.label_he}</span>`).join('')+`</div>`;
      html+=`<div class="mc-lbl">Season</div><div class="mc-chips${dim}" id="mc-seasons">`+
        mc.SEASONS.map(s=>`<span class="mc-chip${s.key===curSeason?' on':''}" data-s="${s.key}">${s.label_he}</span>`).join('')+`</div>`;
      // legend for the active variable
      const lg=mc.legend();
      const isTemp=(curVar==='surfaceTemp'||curVar==='airDelta');
      // for live surface temp the colour range auto-scales in setThermal → show
      // the live °C span (filled by app.js __updateThermalLegend) when ON+temp+live.
      const liveTemp=isTemp&&curSeason==='live';
      const loTxt=liveTemp?`<span id="mc-tlMin">${lg.min}°</span>`:(lg.min+(isTemp?'°':''));
      const hiTxt=liveTemp?`<span id="mc-tlMax">${lg.max}°</span>`:(lg.max+(isTemp?'°':''));
      html+=`<div class="mc-legend${dim}"><div class="lh">${lg.label_he} · ${lg.unit}</div>`+
        `<div class="bar" style="background:${legendGradient(curVar)}"></div>`+
        `<div class="sc"><span>${loTxt}</span><span>${hiTxt}</span></div></div>`;
      // per-zone readout cards (all 3 zones) + top plant recs per zone
      const seasHe=seasonHe[seas]||seas;
      html+=`<div class="mc-lbl" style="margin-top:8px">Reading by zone · ${seasHe}</div>`;
      zones.forEach(z=>{
        const cell=repCell(z.id);
        const prof=cell?Derive.cellProfile(cell,seas):null;
        const fr=frostLevel(prof);
        const town=(window.Weather&&Weather.state)?Weather.state.temp:null;
        let grid='';
        if(prof){
          // ETc → weekly litres on a ~1 m² canopy (1 mm·m⁻² = 1 L); honest rough.
          const litresWk=Math.round((prof.ETc||0)*1.0*7*10)/10;
          const dAirStr=(prof.dAir>=0?'+':'')+prof.dAir;
          grid=`<div class="zg">`+
            `<span class="k">Direct sun${xplSlot('sunHours')}</span><b>${prof.sunHours} h</b>`+
            `<span class="k">DLI${xplSlot('dli')}</span><b>${prof.DLI} <span style="font-weight:400;color:#a99b78">mol/m²</span></b>`+
            `<span class="k">Peak · dawn${xplSlot('surfaceTemp')}</span><b>${prof.Tpeak}° / ${prof.Tdawn}°</b>`+
            `<span class="k">Δ from town${xplSlot('airDelta')}</span><b>${dAirStr}°</b>`+
            `<span class="k">Frost${xplSlot('frostRisk')}</span><b class="${fr.cls}">${fr.txt}</b>`+
            `<span class="k">Wind</span><b>${Math.round((prof.exposure||0)*100)}%</b>`+
            `<span class="k">Water (ETc)${xplSlot('ETc')}</span><b>${prof.ETc} mm · ~${litresWk} L/wk</b>`+
            `</div>`;
        } else {
          grid=`<div class="zf">The model is loading…</div>`;
        }
        // top plant recs for THIS zone/season (best-fit first, top 3)
        let recHtml='';
        if(cell && Derive.rankPlantsForCell){
          const ranked=(Derive.rankPlantsForCell(cell,seas)||[]).slice(0,3);
          if(ranked.length){
            recHtml=`<div class="recs">`+ranked.map((r,ri)=>{
              const sc=r.score, scCls=sc>=66?'':sc>=40?'mid':'lo';
              const emo=(r.plant&&r.plant.emoji)||'🌱';
              // one plantScore "?" chip per zone's recs (on the top-ranked plant's score)
              return `<div class="rec"><span class="re">${emo}</span><div>`+
                `<div><span class="rn">${r.name_he}</span> <span class="rs ${scCls}">${sc}/100</span>${ri===0?xplSlot('plantScore'):''}</div>`+
                `<div class="rr">${r.reason_he||''}</div></div></div>`;
            }).join('')+`</div>`;
          }
        }
        html+=`<div class="zc"><div class="zt"><span class="zn">${z.name_he}</span>`+
          `<span class="zf">${z.facing==='east'?'East':z.facing==='west'?'West':''}${(z.elevation_offset_m||0)>1?' · raised':''}</span></div>`+
          grid+recHtml+`</div>`;
      });
      return html;
    }
    // wire the control's interactive bits after innerHTML is (re)written.
    function wireMicroclimate(date){
      const mc=MC(); if(!mc) return;
      const onoff=$('mc-onoff');
      if(onoff) onoff.onclick=()=>{ mc.setOn(!mc.isOn()); render(true); };
      const vbox=$('mc-vars');
      if(vbox) vbox.querySelectorAll('.mc-chip').forEach(ch=>ch.onclick=()=>{
        if(!mc.isOn()) return; mc.setVariable(ch.dataset.v); render(true); });
      const sbox=$('mc-seasons');
      if(sbox) sbox.querySelectorAll('.mc-chip').forEach(ch=>ch.onclick=()=>{
        if(!mc.isOn()) return; mc.setSeason(ch.dataset.s); render(true); });
    }
    /* ---- consumption helpers (wishlist #7+#25) ----
       Readings are CUMULATIVE meter values stored as {k,v:'<num> kWh'|'<num> m³',
       d:'d.m.yyyy' he-IL, t?:<ms>}. We parse the number out of v and prefer the
       real timestamp t for diffing (legacy rows have only d → parse the he-IL
       'd.m.yyyy' dotted date, GUARDING bad parses). All math is a labeled estimate. */
    function readNum(r){ const m=String(r&&r.v||'').match(/-?\d+(?:[.,]\d+)?/); return m?parseFloat(m[0].replace(',','.')):NaN; }
    // legacy he-IL date 'd.m.yyyy' (dots) → ms; tolerate '/' and '-' too. NaN on junk.
    function parseHeDate(d){
      if(!d) return NaN;
      const m=String(d).trim().match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
      if(!m) return NaN;
      let[,dd,mm,yy]=m; dd=+dd; mm=+mm; yy=+yy; if(yy<100) yy+=2000;
      if(mm<1||mm>12||dd<1||dd>31) return NaN;
      const t=new Date(yy,mm-1,dd).getTime(); return isFinite(t)?t:NaN;
    }
    function readTime(r){ if(r&&isFinite(r.t)) return +r.t; return parseHeDate(r&&r.d); }
    const median=a=>{ if(!a.length) return NaN; const s=[...a].sort((x,y)=>x-y),m=s.length>>1;
      return s.length%2?s[m]:(s[m-1]+s[m])/2; };
    // tolerant import-line parser → {t,val} or null. Accepts a date token (d/m/yyyy,
    // dd.mm.yyyy, yyyy-mm-dd) plus a number, comma/tab/space/semicolon separated.
    function parseImportLine(line){
      // strip a thousands-separator comma so '1,250'→1250 WITHOUT corrupting a real
      // 'date,value' CSV: the negative lookbehind (?<![\d.\/-]) stops it firing inside a
      // date token (e.g. 2024-03-15,500 stays split into date+value, not merged).
      const raw=String(line||'').replace(/"/g,'').replace(/(?<![\d.\/-])(\d{1,3}),(?=\d{3}(?:,\d{3})*(?:\.\d+)?\b)/g,'$1').trim();
      if(!raw) return null;
      const toks=raw.split(/[\s,;\t]+/).filter(Boolean);
      if(toks.length<2) return null;
      let t=NaN, val=NaN;
      for(const tok of toks){
        if(!isFinite(t)){
          // yyyy-mm-dd
          let m=tok.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
          if(m){ const dt=new Date(+m[1],+m[2]-1,+m[3]).getTime(); if(isFinite(dt)){t=dt; continue;} }
          // d.m.yyyy / d/m/yyyy / d-m-yyyy
          const dt2=parseHeDate(tok); if(isFinite(dt2)){ t=dt2; continue; }
        }
        if(!isFinite(val)){
          const nm=tok.match(/^-?\d+(?:[.,]\d+)?$/);
          if(nm){ val=parseFloat(nm[0].replace(',','.')); continue; }
        }
      }
      if(!isFinite(t)||!isFinite(val)) return null;
      return {t, val};
    }
    // tariff defaults: prefer data/energy.json tariff:{} (labeled estimate); fall back to consts.
    function tariffs(){
      const T=(Derive.data&&Derive.data.energy&&Derive.data.energy.tariff)||{};
      return { elec:isFinite(T.elec_nis_kwh)?+T.elec_nis_kwh:0.62,
               water:isFinite(T.water_nis_m3)?+T.water_nis_m3:13 };
    }
    /* ---- OCCUPANCY (wishlist #25) ----
       Pull dated guest/Airbnb entries from LogStore ('visitors' + 'airbnb') so
       consumption can be correlated with how many people were in the house. Each
       LogStore record is {id,t:ISO,d:he-IL,text,due?}. We take the BEST-available
       date per entry: a user-chosen `due` ISO if present (airbnb entries carry
       one), otherwise the creation stamp (t/d). This is an ESTIMATE — one log
       entry ≈ one guest occasion, not a verified head-count — and is always
       labelled as such where it's shown. Pure read; degrades to [] with no logs
       or no LogStore (panels.js loads before log_store.js). */
    function occupancyEvents(){
      if(!window.LogStore || !LogStore.list) return [];
      const out=[];
      ['visitors','airbnb'].forEach(coll=>{
        let recs=[]; try{ recs=LogStore.list(coll)||[]; }catch(e){ recs=[]; }
        recs.forEach(r=>{
          if(!r) return;
          // prefer an explicit chosen date (due), else the creation time.
          let t=NaN;
          if(r.due!=null){ t=Date.parse(r.due); }
          if(!isFinite(t) && isFinite(r.t)) t=+r.t;
          if(!isFinite(t)) t=parseHeDate(r.d);
          if(isFinite(t)) out.push({t, coll, text:r.text||r.t||''});
        });
      });
      return out;
    }
    // count occupancy events whose date falls within [from,to] (ms, inclusive).
    function occupancyInWindow(events, from, to){
      if(!(from<=to)) return 0;
      let n=0; events.forEach(e=>{ if(e.t>=from && e.t<=to) n++; }); return n;
    }
    // Build the consumption analysis card for one kind from its readings.
    // Returns '' when there are <2 readings on DIFFERENT dates (honest hint shown
    // by the caller instead). assumes CUMULATIVE meter values; skips Δval<0 pairs.
    function consumptionCard(kind, reads){
      const tar=tariffs();
      const unit = kind==='elec' ? 'kWh' : 'm³';
      const perDay = kind==='elec' ? 'kWh/day' : 'm³/day';
      const price = kind==='elec' ? tar.elec : tar.water;
      const icon = kind==='elec' ? '⚡' : '💧';
      const title = kind==='elec' ? 'Electricity consumption' : 'Water consumption';
      // collect {t,val} with a valid time + number, sort ascending by time.
      let pts=reads.filter(r=>r&&r.k===kind).map(r=>({t:readTime(r),val:readNum(r)}))
        .filter(p=>isFinite(p.t)&&isFinite(p.val)).sort((a,b)=>a.t-b.t);
      // collapse exact-duplicate timestamps (keep the last reading for that instant)
      const seen={}; pts=pts.filter(p=>{ const k=p.t; if(seen[k])return false; seen[k]=1; return true; });
      // need ≥2 readings on DIFFERENT dates to derive any rate
      if(pts.length<2) return '';
      const DAY=864e5;
      // {rate, t:<end ms>, t0:<start ms>, days} per consecutive pair (cumulative → daily delta).
      // t0/days let us correlate each period with the occupancy log (#25).
      const rates=[];
      for(let i=0;i<pts.length-1;i++){
        const dv=pts[i+1].val-pts[i].val, dd=(pts[i+1].t-pts[i].t)/DAY;
        if(dd<0.5) continue;            // same-day pair: can't yield a daily rate
        if(dv<0) continue;              // meter reset / typo → skip
        rates.push({rate:dv/dd, t:pts[i+1].t, t0:pts[i].t, days:dd});   // dd≥0.5 → true daily rate
      }
      if(!rates.length) return '';      // all pairs same-day or invalid
      const latest=rates[rates.length-1].rate;
      const monthly=latest*30.4, cost=monthly*price;
      const fmt=n=>(n>=100?Math.round(n):Math.round(n*10)/10).toLocaleString('en-US');
      // ANOMALY: latest vs median of PRIOR rates (>25% deviation → badge)
      let badge='';
      if(rates.length>=3){
        const prior=rates.slice(0,-1).map(r=>r.rate), med=median(prior);
        if(isFinite(med)&&med>0){
          const dev=(latest-med)/med;
          if(dev>0.25) badge=`<span class="cz-badge hi">↑ Higher than usual</span>`;
          else if(dev<-0.25) badge=`<span class="cz-badge lo">↓ Lower than usual</span>`;
        }
      }
      // tiny inline sparkline of recent daily rates (last ≤8)
      const recent=rates.slice(-8).map(r=>r.rate);
      let spark='';
      if(recent.length>=2){
        const W=120,H=22,mn=Math.min(...recent),mx=Math.max(...recent),sp=(mx-mn)||1;
        const pp=recent.map((v,i)=>{ const x=(i/(recent.length-1))*(W-2)+1;
          const y=H-2-((v-mn)/sp)*(H-4); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ');
        spark=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block;margin-top:5px">`+
          `<polyline points="${pp}" fill="none" stroke="#caa15a" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.92"/></svg>`;
      }
      // 👥 CONSUMPTION × OCCUPANCY (#25): for the LATEST period (between the two
      // most recent readings) count overlapping guest/Airbnb log entries, and —
      // when there's enough history — softly flag whether usage runs higher in
      // periods that had guests. Labelled estimate; degrades to nothing with no
      // occupancy logs. Computed only for the electricity card (the one most
      // sensitive to extra people) to avoid repeating the same line twice.
      let occHtml='';
      if(kind==='elec'){
        const events=occupancyEvents();
        if(events.length){
          const last=rates[rates.length-1];
          const guestDays=occupancyInWindow(events, last.t0, last.t);
          occHtml=`<div class="row"><span>In this period</span>`+
            `<span style="color:#a99b78">~${guestDays} guest events · ${fmt(last.rate)} ${perDay}</span></div>`;
          // soft "higher with guests" note: compare the mean daily rate of periods
          // WITH ≥1 occupancy event vs periods WITHOUT, if there's enough of each.
          if(rates.length>=4){
            const withG=[], noG=[];
            rates.forEach(r=>{ (occupancyInWindow(events,r.t0,r.t)>0?withG:noG).push(r.rate); });
            if(withG.length>=2 && noG.length>=2){
              const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
              const mw=mean(withG), mn0=mean(noG);
              if(isFinite(mw)&&isFinite(mn0)&&mn0>0){
                const pct=Math.round((mw/mn0-1)*100);
                if(pct>=12) occHtml+=`<div class="est" style="color:#e8a06a">↑ Higher consumption in periods with guests (~+${pct}%, estimate)</div>`;
              }
            }
          }
        }
      }
      return `<div class="card">`+
        `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">`+
          `<div class="big">${fmt(latest)}<span style="font-size:12px;color:#a99b78"> ${perDay}</span></div>`+
          `<span class="mc-model">Estimate</span></div>`+
        `<div class="m" style="color:#a99b78;margin-top:2px">${icon} ${title} · latest daily rate from ${pts.length} readings</div>`+
        `<div class="row" style="margin-top:6px"><span>Monthly (×30.4)</span><b>~${fmt(monthly)} ${unit} ${badge}</b></div>`+
        `<div class="row"><span>Monthly cost</span><span style="color:#a99b78">~$${fmt(cost)}</span></div>`+
        occHtml+
        spark+
        `<div class="est">Estimate from cumulative meter readings · tariff ~$${price}/${unit} (estimate)</div></div>`;
    }
    function renderEnergy(date){
      const E=Derive.energyNow(date); const reads=LS('home_read');
      let pvHtml='', nfHtml='';
      // ☀️ ROOF + SOLAR — live, physically-grounded estimate from Derive.roofSolar()
      // (replaces the old hardcoded 9,618). Falls back to the static energy.json pv
      // card only if the model is unavailable (e.g. data not yet loaded).
      let rs=null; try{ rs=Derive.roofSolar&&Derive.roofSolar(); }catch(e){ rs=null; }
      if(rs){
        const fmt=n=>Math.round(n).toLocaleString('en-US');
        const shadeLine = rs.horizon_loss_pct>1.5
          ? `Shading loss ~${rs.horizon_loss_pct}% (horizon/railing/neighbors)`
          : `Open horizon · ~0% shading on the roof`;
        // ⚡ MONTHLY PV PRODUCTION CURVE — turn the single annual number into a shape:
        // a 12-bar chart of kWh/month from the live roofSolar() model. Sits inside the
        // PV card, right beside the annual headline.
        let pvMonthHtml='';
        const bm = Array.isArray(rs.by_month)?rs.by_month:[];
        if(bm.length===12){
          const vals = bm.map(m=>+m.kwh||0);
          const peakMo = vals.indexOf(Math.max(...vals));
          const lowMo  = vals.indexOf(Math.min(...vals));
          const MON_FULL=['January','February','March','April','May','June','July','August','September','October','November','December'];
          pvMonthHtml =
            `<div style="display:flex;justify-content:space-between;font-size:9.5px;color:#a99b78;margin:8px 2px 2px">`+
              `<span><span style="color:#caa15a">▮</span> Monthly production (kWh)<span data-xpl-pv></span></span>`+
              `<span>Peak ${MON_FULL[peakMo]} · Low ${MON_FULL[lowMo]}</span></div>`+
            monthBarsSVG(vals);
          if(rs.usable_area_m2!=null && rs.gross_area_m2!=null){
            pvMonthHtml += `<div class="est" style="margin-top:2px">~${Math.round(rs.usable_area_m2)} of ${Math.round(rs.gross_area_m2)} m² of roof usable for panels</div>`;
          }
        }
        pvHtml=`<div class="card">`+
          `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">`+
            `<div class="big">${fmt(rs.annual_kwh)}${xplSlot('roofSolar_annual_kwh')}</div>`+
            `<span class="mc-model">Model · estimate</span></div>`+
          `<div class="m" style="color:#a99b78">kWh/year from the roof · ~${rs.peak_kw.toFixed(1)} kWp on ~${rs.usable_area_m2} m² · savings ~$${fmt(rs.savings_nis_per_year)} · ${rs.co2_t_per_year} tons CO₂ saved</div>`+
          `<div class="row" style="margin-top:6px"><span>☀️ Optimal tilt</span><b>~${rs.best_tilt_deg}° facing ${rs.best_azimuth_he}</b></div>`+
          `<div class="row"><span>Irradiance on the plane</span><span style="color:#a99b78">${fmt(rs.poa_kwh_m2_yr)} kWh/m²/year</span></div>`+
          pvMonthHtml+
          `<div class="est">${shadeLine}${rs.horizon_loss_pct>1.5?xplSlot('roofSolar_horizon_loss'):''} · ${rs.note_he}</div></div>`;
      } else {
        // HONEST fallback: the live physical model isn't ready yet (house/horizon data
        // still loading). Do NOT surface the legacy static 9,618 — it was a placeholder,
        // not a measurement. Show an honest loading state instead.
        pvHtml=`<div class="card"><div class="m" style="color:#a99b78">☀️ Solar potential for the roof — loading from the model…</div><div class="est">The physical model isn't ready yet (house and horizon data required). Try again in a moment.</div></div>`;}
      if(E&&E.nightFlush){const nf=E.nightFlush;
        nfHtml=nf.needs_cooling&&nf.open_start?`<div class="row"><span>🪟 Night flush tonight<span data-xpl-nf></span></span><b>${nf.open_start}–${nf.open_end}</b></div><div class="sub">Open windows for passive cooling (~${nf.open_hours} hours)</div>`
          :`<div class="row"><span>🪟 Night flush<span data-xpl-nf></span></span><span style="color:#a99b78">${nf.note_he||'Not needed this month'}</span></div>`;}
      // ☀️ solar water heater (solar hot-water) — annual solar fraction, December electric-backup
      // callout, and a 12-month delivered-vs-demand mini bar chart, all from the
      // already-computed solar_hot_water table (Derive.energyNow().shw). The dashed
      // blue baseline marks daily demand; bars are daily delivered heat.
      let shwHtml='';
      const shw=(E&&E.shw)?E.shw:null;
      if(shw && Array.isArray(shw.rows) && shw.rows.length===12){
        const rows=shw.rows.slice().sort((a,b)=>a.month-b.month);
        // annual solar fraction = total delivered (capped at demand) ÷ total demand,
        // i.e. share of yearly hot-water heat covered by the sun.
        let cov=0, dem=0;
        rows.forEach(r=>{ cov+=Math.min(r.delivered_kwh_day,r.demand_kwh_day); dem+=r.demand_kwh_day; });
        const annualFrac = dem>0 ? cov/dem : 0;
        const fracPct = Math.round(annualFrac*100);
        const delivered = rows.map(r=>+r.delivered_kwh_day||0);
        const demandBase = rows[0] ? +rows[0].demand_kwh_day : null; // constant 4.19
        const backupHe = shw.backup_months_he || (Array.isArray(shw.backup_months)&&shw.backup_months.length
          ? shw.backup_months.map(m=>['','January','February','March','April','May','June','July','August','September','October','November','December'][m]).join(', ')
          : '');
        const backupLine = backupHe
          ? `<div class="row"><span>🔌 Electric backup</span><b style="color:#e8a06a">${backupHe}</b></div>`+
            `<div class="sub">In short winter days the solar input isn't enough — the heater tops up with electricity this month</div>`
          : `<div class="row"><span>🔌 Electric backup</span><span style="color:#a99b78">Not needed all year</span></div>`;
        shwHtml=`<div class="card">`+
          `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">`+
            `<div class="big">${fracPct}%<span data-xpl-shw></span></div>`+
            `<span class="mc-model">Model · estimate</span></div>`+
          `<div class="m" style="color:#a99b78">☀️ Solar water heater · annual share of water heating from the sun · tank ${shw.tank_l||150} L · collector ${shw.collector_area_m2||2.5} m² · demand ${shw.demand_l_day||120} L/day</div>`+
          backupLine+
          `<div style="display:flex;justify-content:space-between;font-size:9.5px;color:#a99b78;margin:8px 2px 2px">`+
            `<span><span style="color:#caa15a">▮</span> Delivered heat (kWh/day)</span>`+
            `<span><span style="color:#7fb0ff">┄</span> Daily demand</span></div>`+
          monthBarsSVG(delivered, demandBase)+
          `<div class="est">Solar heat vs demand — 12 months · physical estimate</div></div>`;
      }
      // 📊 CONSUMPTION ANALYSIS per kind (needs ≥2 dated, cumulative readings).
      // If neither kind has enough dated history, show one honest hint instead.
      const elecCard=consumptionCard('elec',reads), waterCard=consumptionCard('water',reads);
      let consHtml=elecCard+waterCard;
      if(!consHtml){
        consHtml=`<div class="est" style="margin-top:8px">Add another reading (on a different date) to see consumption — calculating the rate requires at least two meter readings on different days.</div>`;
      }
      // ☀️ LIVE NOW — real measured irradiance → estimated instantaneous PV. LEADS the tab;
      // the annual potential model (8,351 kWh) is demoted below. (the developer: live data > annual summaries.)
      let liveHtml='';
      try{
        const sunL=window.Astro?Astro.sun(date):null;
        const ghiNow=(window.Weather&&Weather.envAt)?Weather.envAt('rad',date):null; // W/m² shortwave (measured/forecast)
        const kWp=rs?rs.peak_kw:null, DERATE=0.80, isDay=!!(sunL&&sunL.altDeg>0);
        let pvNow=null;
        if(kWp!=null&&ghiNow!=null&&isFinite(ghiNow)) pvNow=Math.max(0,kWp*(Math.max(0,ghiNow)/1000)*DERATE);
        let todayKwh=null;
        if(kWp!=null&&window.Weather&&Weather.envAt){
          const day0=new Date(date); day0.setHours(0,0,0,0); let sum=0;
          for(let h=0;h<=date.getHours();h++){ const r=Weather.envAt('rad',new Date(day0.getTime()+h*3600000)); if(r!=null&&isFinite(r)) sum+=Math.max(0,r)/1000*kWp*DERATE; }
          todayKwh=sum;
        }
        liveHtml=`<div class="card">`+
          `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">`+
            `<div class="big">${pvNow!=null?pvNow.toFixed(2):'—'}<span style="font-size:13px;color:#a99b78"> kW</span></div>`+
            `<span class="mc-model">By modeled irradiance</span></div>`+
          `<div class="m" style="color:#a99b78">⚡ Estimated solar production now · ${isDay?('Sun at altitude '+Math.round(sunL.altDeg)+'°'):'Sun below the horizon'}</div>`+
          (ghiNow!=null?`<div class="row"><span>☀️ Irradiance now</span><b>${Math.round(Math.max(0,ghiNow))} W/m²</b></div>`:'')+
          (todayKwh!=null?`<div class="row"><span>📈 Produced today so far</span><b>~${todayKwh.toFixed(1)} kWh</b></div>`:'')+
          `<div class="est">Estimated from modeled horizontal irradiance (Open-Meteo, ~11 km) × ${kWp!=null?kWp.toFixed(1):'?'} kWp × performance ratio ~0.8 — not a production-meter measurement</div></div>`;
      }catch(e){ liveHtml=''; }
      body.innerHTML=`<h3>Energy · your house</h3><div class="sub">What's happening now — and the annual potential below</div>`+
        liveHtml+
        `<div class="sub" style="margin-top:14px">📅 The annual potential (model)</div>`+
        pvHtml+shwHtml+nfHtml+
        (E?`<div class="row"><span>Heating/cooling per year${xplSlot('degree_days')}</span><span>HDD ${Math.round(E.hdd||0)} · CDD ${Math.round(E.cdd||0)}</span></div>`:'')+
        microclimateBlock(date)+
        `<div class="sub" style="margin-top:14px">📊 Consumption — from your readings</div>`+
        consHtml+
        `<div class="sub" style="margin-top:14px">Meter readings (saved)</div>`+
        `<div style="display:flex;gap:6px;margin-bottom:6px"><input id="r-elec" placeholder="Electricity kWh"><button class="btn" id="add-elec">+</button></div>`+
        `<div style="display:flex;gap:6px"><input id="r-water" placeholder="Water m³"><button class="btn" id="add-water">+</button></div>`+
        `<div id="readlist">${reads.slice(0,5).map(r=>`<div class="row"><span>${r.k==='elec'?'⚡':'💧'} ${r.v}</span><span style="color:#a99b78">${r.d}</span></div>`).join('')||'<div class="est">No readings yet</div>'}</div>`+
        // 📥 IEC IMPORT (replaces the old footer TODO): reveal a paste box + file picker.
        `<button class="btn" id="imp-toggle" style="width:100%;margin-top:8px">📥 Import consumption from the utility</button>`+
        `<div id="imp-box" style="display:none;margin-top:6px">`+
          `<div class="imp-hint">Paste rows from your utility's consumption file (personal area → "My consumption data" → Excel) — each row: a date and a kWh number. Supports 31.05.2026, 31/5/2026, 2026-05-31.</div>`+
          `<textarea id="imp-text" placeholder="31.05.2026  142&#10;30.04.2026  118&#10;..."></textarea>`+
          `<div style="display:flex;gap:6px;margin-top:6px;align-items:center">`+
            `<input id="imp-file" type="file" accept=".csv,.txt" style="flex:1">`+
            `<button class="btn" id="imp-run">Import</button></div>`+
          `<div id="imp-msg" class="imp-msg"></div></div>`+
        `<div class="foot">Consumption calculated from your readings + import from a utility file — an estimate, not a direct connection to the utility.</div>`;
      // --- mount the universal "?" chip on the night-cooling window (explain.js) ---
      (function(){
        const slot=body.querySelector('[data-xpl-nf]'); if(!slot||!window.Explain) return;
        const nf=(E&&E.nightFlush)?E.nightFlush:null; if(!nf) return;
        const data=[];
        if(nf.needs_cooling&&nf.open_start){
          data.push({k:'Windows open',v:nf.open_start+'–'+nf.open_end});
          if(nf.open_hours!=null) data.push({k:'Recommended duration',v:'~'+nf.open_hours+' hours'});
        }
        data.push({k:'Cooling needed this month',v:nf.needs_cooling?'Yes':'No'});
        if(nf.note_he) data.push({k:'Note',v:nf.note_he});
        const chip=window.Explain.chip({
          title:'Night flush (passive cooling)',
          summary:'The nighttime window when it\'s worth opening windows to flush the day\'s heat from the house with cool outside air — a monthly model for your house.',
          estimate:true,
          gloss:'When to open windows at night to cool the house without an air conditioner',
          data:data,
          formula:'open_hours = hours when  T_out < T_in  within the window  open_start→open_end',
          assumptions:[
            'Monthly average model (not a forecast for a specific day)',
            'Assumes the outside night air is cooler than indoors and the house is well ventilated',
            'Based on the house\'s mass and city-house temperature differences — an estimate, not a measurement'
          ],
          sources:[{label:'energy.json · night_flush', url:'data/energy.json'}]
        });
        slot.replaceWith(chip);
      })();
      // --- "?" chip on the annual solar hot-water fraction (explain.js) ---
      (function(){
        const slot=body.querySelector('[data-xpl-shw]'); if(!slot||!window.Explain) return;
        const s=(E&&E.shw)?E.shw:null; if(!s||!Array.isArray(s.rows)) return;
        const rows=s.rows.slice().sort((a,b)=>a.month-b.month);
        let cov=0, dem=0; rows.forEach(r=>{ cov+=Math.min(r.delivered_kwh_day,r.demand_kwh_day); dem+=r.demand_kwh_day; });
        const fracPct=dem>0?Math.round(100*cov/dem):0;
        const chip=window.Explain.chip({
          title:'Solar water heater · annual solar share',
          summary:'What share of the house\'s water heating is supplied by the sun over the year, using a flat-plate collector on the roof — a monthly model for your house.',
          estimate:true,
          gloss:'What percentage of water heating is done for free by the sun',
          data:[
            {k:'Annual solar share', v:'~'+fracPct+'%'},
            {k:'Tank', v:(s.tank_l||150)+' liters'},
            {k:'Collector area', v:(s.collector_area_m2||2.5)+' m²'},
            {k:'Daily demand', v:(s.demand_l_day||120)+' L/day (~'+(rows[0]?rows[0].demand_kwh_day:'')+' kWh)'},
            {k:'Electric backup', v:(s.backup_months_he||'—')}
          ],
          formula:'solar share = Σ min(delivered heat, demand) ÷ Σ demand  (12 months)',
          assumptions:[
            'Flat-plate collector 2.5 m² with typical thermal efficiency, 150 L tank',
            'Constant demand 120 L/day (~4.19 kWh) throughout the year',
            'Based on monthly GHI in Larkmont — an estimate, not a measurement'
          ],
          sources:[{label:'energy.json · solar_hot_water', url:'data/energy.json'}]
        });
        slot.replaceWith(chip);
      })();
      // --- "?" chip on the monthly PV production curve (explain.js) ---
      (function(){
        const slot=body.querySelector('[data-xpl-pv]'); if(!slot||!window.Explain||!rs) return;
        const chip=window.Explain.chip({
          title:'Solar electricity production · monthly curve',
          summary:'How much electricity the roof would produce each month from a PV system at optimal tilt — a physical model based on your house\'s irradiance and horizon.',
          estimate:true,
          gloss:'Forecast of electricity production from the sun, month by month',
          data:[
            {k:'Annual production', v:'~'+Math.round(rs.annual_kwh).toLocaleString('en-US')+' kWh'},
            {k:'Peak power', v:'~'+rs.peak_kw.toFixed(1)+' kWp'},
            {k:'Usable area', v:'~'+Math.round(rs.usable_area_m2)+' of '+Math.round(rs.gross_area_m2)+' m²'},
            {k:'Module efficiency', v:Math.round(rs.module_eff*100)+'%'},
            {k:'Performance ratio (PR)', v:Math.round(rs.pr*100)+'%'},
            {k:'Optimal tilt', v:'~'+rs.best_tilt_deg+'° facing '+rs.best_azimuth_he}
          ],
          formula:'production_month = POA_month × usable_area × efficiency × PR',
          assumptions:[
            'Clear-sky irradiance model with seasonal cloud cover + horizon/railing shading',
            'Usable area = '+Math.round(100*(rs.usable_area_m2/rs.gross_area_m2))+'% of the roof (railing setback, row spacing, room for the solar water heater)',
            'A physical estimate — not a measurement and not Google Solar'
          ],
          sources:[{label:'energy.json · roof', url:'data/energy.json'}]
        });
        slot.replaceWith(chip);
      })();
      // "?" chips on the remaining computed energy + microclimate values (roof annual,
      // horizon loss, degree-days, and the per-zone DLI/sun/ETc/frost readout below)
      mountXplChips(body);
      wireMicroclimate(date);
      // manual entry — now ALSO stamps a real ms timestamp t alongside the he-IL d,
      // so consumption diffing is reliable (legacy rows fall back to parsing d).
      const addR=k=>{const inp=$('r-'+k),v=(inp.value||'').trim();if(!v)return;const a=LS('home_read');
        a.unshift({k,v:v+(k==='elec'?' kWh':' m³'),d:new Date().toLocaleDateString('he-IL'),t:Date.now()});
        save('home_read',a);renderEnergy(date);};
      $('add-elec').onclick=()=>addR('elec'); $('add-water').onclick=()=>addR('water');
      // import: parse pasted text and/or a chosen file, add each {t,val} as an elec
      // reading (with both t and a he-IL d), tolerant of header/garbage lines.
      const doImport=text=>{
        const lines=String(text||'').split(/\r?\n/);
        const parsed=lines.map(parseImportLine).filter(Boolean);
        const msg=$('imp-msg');
        if(!parsed.length){ if(msg) msg.textContent='No valid rows found (a date + a number in each row).'; return; }
        const a=LS('home_read');
        parsed.forEach(p=>a.unshift({k:'elec',v:p.val+' kWh',d:new Date(p.t).toLocaleDateString('he-IL'),t:p.t}));
        save('home_read',a);
        if(msg) msg.textContent=`Imported ${parsed.length} electricity readings ✓`;
        renderEnergy(date); // re-render so the new history feeds the consumption card
      };
      const tog=$('imp-toggle'); if(tog) tog.onclick=()=>{ const b=$('imp-box');
        if(b) b.style.display = b.style.display==='none' ? 'block' : 'none'; };
      const runB=$('imp-run'); if(runB) runB.onclick=()=>{
        const fEl=$('imp-file'), file=fEl&&fEl.files&&fEl.files[0];
        if(file){ const rd=new FileReader();
          rd.onload=()=>doImport((($('imp-text')&&$('imp-text').value)||'')+'\n'+rd.result);
          rd.readAsText(file); }
        else doImport($('imp-text')&&$('imp-text').value); };
    }

    /* ---------- nature (curated offline field guide — nature.js) ---------- */
    // The old live-iNaturalist feed was too sparse in the the highlands; the nature tab is now a
    // CURATED, OFFLINE guide (window.Nature, data/nature_species.json — 58 verified
    // species). Mounted into a #wild-guide host (its CSS is scoped to #wild-guide); a
    // species row opens its OWN floating card. Mount promptly via Nature.isReady/onReady.
    let _wildMounted=false, _wildRetry=0, _wildOnReadyHooked=false;
    function mountWildGuide(){
      const host=$('wild-guide'); if(!host) return;
      const N=window.Nature;
      if(N&&N.renderGuideInto&&(!N.isReady||N.isReady())){ N.renderGuideInto(host); _wildMounted=true; _wildRetry=0; return; }
      if(N&&N.onReady&&!_wildOnReadyHooked){ _wildOnReadyHooked=true;
        host.innerHTML='<div class="est">Loading nature guide…</div>';
        N.onReady(()=>{ _wildOnReadyHooked=false; if(active==='wild'&&!_wildMounted) mountWildGuide(); }); return; }
      if(!(N&&N.renderGuideInto) && _wildRetry<150){ _wildRetry++;
        if(_wildRetry===1) host.innerHTML='<div class="est">Loading nature guide…</div>';
        setTimeout(()=>{ if(active==='wild') mountWildGuide(); },40); }
    }
    function renderWild(force){
      const host=$('wild-guide');
      if(force || !host){ body.innerHTML=storyBtns(['desert'])+'<div id="wild-guide"></div>'; _wildMounted=false; mountWildGuide(); }
      else if(!_wildMounted){ mountWildGuide(); }
    }
    // a 3D iNaturalist sighting pin (if any still exist) just surfaces the nature tab.
    window.__onSightingPicked=function(s){
      if(!s) return;
      if(active!=='wild'){ const tabEl=wrap.querySelector('.tab[data-t="wild"]');
        if(tabEl){ active='wild'; wrap.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===tabEl)); render(true); } }
    };

    /* ---------- environment (Feature A: live air-quality + pollen) ---------- */
    // Reads Weather.air (keyless Open-Meteo: {pm25,pm10,aqi,dust,uv}) and
    // EnvAPI.pollen ({grass,tree,weed,olive,ragweed,mugwort,index,...}). Repaints
    // on tab-switch and when app.js calls window.__renderEnv after a ~12-min
    // refresh — NOT per-second (air/pollen are location facts, not a live mood).
    // Honest source label: 'Open-Meteo · no key' by default, flips to
    // 'Google · key' once a Google key is pasted (localStorage home_env_keys_v1).
    const ENVKEYS='home_env_keys_v1';
    function envKeys(){ try{ return JSON.parse(localStorage.getItem(ENVKEYS))||{}; }catch(e){ return {}; } }
    function hasGoogleKey(){ const k=envKeys(); return !!(k&&(k.googleKey||k.google||k.key)); }
    // numeric AQI → band label + colour (mirrors the app.js aqiBadge bands).
    function aqiTone(aqi){
      if(aqi==null||!isFinite(aqi)) return {he:'—',col:'#a99b78'};
      if(aqi<=20) return {he:'Excellent',col:'#a3e635'};
      if(aqi<=40) return {he:'Good',col:'#9fce8f'};
      if(aqi<=60) return {he:'Moderate',col:'#e0b24a'};
      if(aqi<=80) return {he:'Poor',col:'#e8804a'};
      if(aqi<=100) return {he:'Bad',col:'#e0653f'};
      return {he:'Hazardous',col:'#d8526a'};
    }
    // 0..(~4-5) pollen level → band label + colour for the per-type rows.
    function pollenTone(v){
      if(v==null||!isFinite(v)) return {he:'—',col:'#a99b78'};
      if(v<=0.2) return {he:'None',col:'#a99b78'};
      if(v<1.5) return {he:'Low',col:'#9fce8f'};
      if(v<3) return {he:'Moderate',col:'#e0b24a'};
      if(v<4) return {he:'High',col:'#e8804a'};
      return {he:'Very high',col:'#d8526a'};
    }
    // --- WEATHER block (consolidated from the retired floating #wx card) -------
    // Mirrors app.js updateWeatherUI's HEADLINE + "air now" grid, using the
    // SAME real source (window.Weather.state + Derive downscaling + Weather.air.uv),
    // rendered in the #inst dark/gold skin. Lives at the TOP of the environment tab (above
    // air-quality). It moves with the scrubbed time like the card did: the per-second
    // tick + app.js's updateWeatherUI both call updateEnvWeather, which rewrites ONLY
    // the #env-wx sub-container (so the Google-key input below is never disturbed).
    const _uvHe=u=>(u==null||!isFinite(u))?'—':u<3?'Low':u<6?'Moderate':u<8?'High':u<11?'Very high':'Extreme';
    const _windHe=az=>{const d=['N','NE','E','SE','S','SW','W','NW'];return d[Math.round((((az%360)+360)%360)/45)%8];};
    function weatherBlockHTML(date){
      const st=(window.Weather&&Weather.state)||null;
      if(!st) return `<div class="card"><div class="m">Weather data loading…</div></div>`;
      const air=(window.Weather&&Weather.air)||null;
      const sun=(window.Astro&&Astro.sun)?Astro.sun(date):null;
      const alt=sun?sun.altDeg:25, isNight=alt<0;
      const town=(st.temp!=null)?st.temp:null;
      const hum=(st.hum!=null)?st.hum:null;
      const windKmh=(st.wind!=null)?st.wind:null;
      const windDir=(st.windDir!=null)?st.windDir:0;
      const cloudPct=(st.cloud!=null)?Math.round(st.cloud*100):null;
      const cloudFrac=(st.cloud!=null)?st.cloud:0.1;
      // downscale town reading → his house (same math as the card)
      const bz=zones.find(z=>z.id==='backyard')||null;
      const byState=(Derive.zoneState&&bz&&sun)?Derive.zoneState(bz,sun.azDeg,sun.altDeg):{sunlit:!isNight};
      const mc=Derive.houseTempDelta?Derive.houseTempDelta(town,byState,alt,{cloud:cloudFrac,wind:windKmh}):null;
      const houseTemp=(town!=null&&mc)?Math.round((town+mc.delta)*10)/10:town;
      const feels=Derive.feelsLike?Derive.feelsLike(houseTemp,hum,windKmh):null;
      const dew=Derive.dewPoint?Derive.dewPoint(houseTemp,hum):null;
      const uvNow=(air&&air.uv!=null&&isFinite(air.uv))?air.uv:null;
      // headline temp + delta-from-town + feels-like + sky-condition
      let deltaLine='';
      if(mc&&town!=null&&Math.abs(mc.delta)>=0.1){
        const cooler=mc.delta<0;
        deltaLine=`<div class="m" style="color:${cooler?'#9fc2e0':'#e0b070'}">~${Math.abs(mc.delta).toFixed(1)}° ${cooler?'cooler':'warmer'} than town (${town}° in Larkmont) · estimate</div>`;
      } else if(town!=null){
        deltaLine=`<div class="m" style="color:#a99b78">Same as Larkmont (${town}°)</div>`;
      }
      const feelsLine=(feels!=null)?`<div class="est" style="color:#cdbd92">Feels like ${feels}° · estimate</div>`:'';
      const descLine=st.desc?`<div class="m" style="color:#e7dcc0;margin-top:3px">${String(st.desc)}</div>`:'';
      // mini stat-tile grid in the #inst skin (clouds / dew / humidity / wind / UV)
      const cell=(v,l)=>`<div style="background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.16);border-radius:6px;padding:7px 4px;text-align:center"><div style="font-size:14px;color:#f3ead2">${v}</div><div style="font-size:9.5px;color:#a99b78;letter-spacing:.04em;margin-top:2px">${l}</div></div>`;
      const grid3=`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-top:8px">`+
          cell(cloudPct!=null?cloudPct+'%':'—','Cloud cover')+
          cell(dew!=null?dew+'°':'—','Dew point')+
          cell(hum!=null?hum+'%':'—','Humidity')+
        `</div>`;
      const grid2=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px">`+
          cell(windKmh!=null?Math.round(windKmh)+'<small style="font-size:10px;color:#bcae8a"> km/h</small>':'—','Wind')+
          cell(uvNow!=null?uvNow+'<small style="font-size:10px;color:#bcae8a"> '+_uvHe(uvNow)+'</small>':'—','UV')+
        `</div>`;
      return `<div class="card" style="margin-top:0">`+
          `<div class="big">${houseTemp!=null?houseTemp+'°':(town!=null?town+'°':'—')}</div>`+
          deltaLine+feelsLine+descLine+
        `</div>`+
        `<div class="sub" style="margin-top:12px">Air now</div>`+
        grid3+grid2;
    }
    // repaint ONLY the weather sub-container (live, with the scrubbed time). Called
    // by the per-second tick and by app.js after a weather/scrub update — cheap, and
    // leaves the air-quality/pollen/key-input DOM below it untouched.
    function updateEnvWeather(date){
      const host=$('env-wx'); if(!host) return;
      host.innerHTML=weatherBlockHTML(date||nowDate());
    }
    window.__envWeatherTick=()=>{ if(active==='env') updateEnvWeather(nowDate()); };
    function renderEnv(date){
      const air=(window.Weather&&Weather.air)||null;
      const pol=(window.EnvAPI&&EnvAPI.pollen)||null;
      const goog=hasGoogleKey();
      const srcHe=goog?'Google · key':'Open-Meteo · no key';
      const num=(v,u)=>(v==null||!isFinite(v))?'—':(Math.round(v*10)/10)+(u||'');
      // --- air-quality block (real measured particulates) ---
      let airHtml;
      if(air){
        const aq=aqiTone(air.aqi);
        airHtml=`<div class="card"><div class="big" style="color:${aq.col}">${air.aqi!=null&&isFinite(air.aqi)?Math.round(air.aqi):'—'}`+
            `<span style="font-size:13px;color:#a99b78"> AQI</span>${xplSlot('dust_aqi')}</div>`+
          `<div class="m" style="color:#a99b78">${aq.he} · European</div></div>`+
          `<div class="row"><span>Particulates PM2.5</span><b>${num(air.pm25,' µg/m³')}</b></div>`+
          `<div class="row"><span>Particulates PM10</span><b>${num(air.pm10,' µg/m³')}</b></div>`+
          `<div class="row"><span>Suspended dust</span><b>${num(air.dust,' µg/m³')}</b></div>`+
          `<div class="row"><span>UV radiation${xplSlot('uv_index')}</span><b style="color:${uvColor(air.uv)}">${air.uv==null||!isFinite(air.uv)?'—':Math.round(air.uv)}</b></div>`;
      } else {
        airHtml=`<div class="card"><div class="m">Air-quality data loading…</div></div>`;
      }
      // --- rain block (#10): 30-day accumulated precip + next-day forecast ---
      // Weather.accumPrecip(30) returns mm over the last 30 days (or null until
      // the env forecast loads); guard the null case. Next-day precip via
      // Weather.dailyToday('dPrecip', tomorrow) — only surfaced when >0.
      let rainHtml='';
      const accum=(window.Weather&&Weather.accumPrecip)?Weather.accumPrecip(30):null;
      if(accum!=null){
        let fcHtml='';
        if(window.Weather&&Weather.dailyToday){
          const tmr=new Date((date||new Date()).getTime()+86400000);
          const nx=Weather.dailyToday('dPrecip',tmr);
          if(nx!=null&&isFinite(nx)&&nx>=0.1) fcHtml=` · tomorrow ~${Math.round(nx*10)/10} mm`;
        }
        rainHtml=`<div class="row"><span>🌧 Fell in 30 days${xplSlot('accumPrecip')}</span><b>~${accum} mm${fcHtml}</b></div>`;
      }
      // --- pollen / allergen block (per type) ---
      const POL=[['olive','Olive'],['grass','Grasses'],['tree','Trees'],['weed','Weeds'],['ragweed','Ragweed'],['mugwort','Mugwort']];
      let polRows='';
      if(pol){
        polRows=POL.map(([k,he])=>{ const v=pol[k]; const t=pollenTone(v);
          return `<div class="row"><span>${he}</span><b style="color:${t.col}">${t.he}${(v!=null&&isFinite(v))?' · '+(Math.round(v*10)/10):''}</b></div>`;
        }).join('');
      } else {
        polRows=`<div class="est">Pollen data loading…</div>`;
      }
      // --- optional Google-key upgrade input ---
      const keyHtml=`<div class="sub" style="margin-top:14px">Enhanced accuracy (optional)</div>`+
        `<div style="display:flex;gap:6px"><input id="env-gkey" placeholder="Paste a Google key (optional)" value="${goog?(envKeys().googleKey||envKeys().google||envKeys().key||''):''}"><button class="btn" id="env-gsave">Save</button></div>`;
      body.innerHTML=`<h3>Your environment · now</h3>`+
        `<div class="sub">Weather, air quality and pollen — at your house, measured regionally (${srcHe})</div>`+
        `<div id="env-wx">${weatherBlockHTML(date||nowDate())}</div>`+
        `<div class="sub" style="margin-top:14px">🌫 Air quality</div>`+
        airHtml+
        rainHtml+
        `<div class="sub" style="margin-top:14px">🤧 Pollen · allergens${xplSlot('pollen')}</div>`+
        polRows+
        keyHtml+
        `<div class="sub" style="margin-top:16px">🗺️ Local map · geology · springs · archaeology · trails</div>`+
        `<button id="env-map-open" style="width:100%;margin-top:6px;padding:14px;border-radius:10px;border:1px solid rgba(202,161,90,.5);background:linear-gradient(160deg,rgba(202,161,90,.2),rgba(202,161,90,.05));color:#f0e3c0;font-family:'Frank Ruhl Libre',serif;font-size:15px;cursor:pointer">🗺️ Open the full map — layers · zoom · timeline</button>`+
        `<div class="sub" style="margin-top:16px">📋 Details · geology · water · history</div>`+
        `<div id="env-extras"></div>`+
        `<div class="sub" style="margin-top:16px">📜 Climate history · ~65 years</div>`+storyBtns(['town','trade'])+
        `<div id="env-hist"></div>`+
        `<div class="foot">Values modeled for a regional grid cell (an estimate, not a sensor on the plot) · updates every ~12 min${pol&&pol.time?' · pollen '+pol.time:''}</div>`;
      mountXplChips(body);   // "?" chips on AQI/dust, UV, 30-day rain, and the pollen header
      // spatial place-map (Leaflet, self-loaded) LEADS the place section; the text extras are the detail
      const _mo=$('env-map-open'); if(_mo) _mo.onclick=()=>{ if(window.__mapBg&&window.__mapBg.toggle) window.__mapBg.toggle(true); };   // launcher → flips the whole background to the full map
      const _ex=$('env-extras'); if(_ex&&window.__envExtras&&window.__envExtras.render){ try{ window.__envExtras.render(_ex,date); }catch(e){} }
      const _eh=$('env-hist'); if(_eh) fillHist(_eh);   // climate history folded into environment (history tab merged in)
      // re-wire AFTER the destructive innerHTML= (the :524 wireMicroclimate pattern):
      const save_=$('env-gsave');
      if(save_) save_.onclick=()=>{
        const inp=$('env-gkey'), v=(inp&&inp.value||'').trim();
        const k=envKeys(); if(v) k.googleKey=v; else { delete k.googleKey; delete k.google; delete k.key; }
        try{ localStorage.setItem(ENVKEYS,JSON.stringify(k)); }catch(e){}
        if(window.EnvAPI&&EnvAPI.refresh){ try{ const r=EnvAPI.refresh(); if(r&&r.then) r.then(()=>renderEnv(nowDate())); }catch(e){} }
        renderEnv(nowDate());
      };
    }
    // app.js post-refresh hook: repaint the environment tab if it's the active one.
    window.__renderEnv=()=>{ if(active==='env') renderEnv(nowDate()); };

    /* ---------- history (climate-history of his exact grid cell) ---------- */
    // Static ERA5-reanalysis climate record for Alex's coordinates, baked into
    // data/history.json by the DATA agent. Shape (FIXED):
    //   { meta:{source,lat,lon,range,generated_note,frost_note_he},
    //     years:[{y, coldNights, rainMm, hotDays, meanTmax, meanTmin}],
    //     trend:{tmax_per_decade, total_warming_c} }
    // Fetched once and cached in a module var (history is static — never refetch
    // per render). Renders headline stats + an inline SVG mini-chart sized to the
    // #inst body width: per-year rain BARS (gold) + a cold-nights LINE (blue),
    // both auto-scaled. Honest footer: ERA5 = regional reanalysis, not a sensor,
    // and the cold-nights note (radiative ground-frost is MORE frequent locally).
    let _hist=null, _histLoading=false, _histErr=false;
    // build a 2-series SVG (rain bars + cold-nights polyline) from years[].
    function histChartSVG(years){
      const W=270, H=86, padL=4, padR=4, padT=8, padB=14;
      const n=years.length; if(!n) return '';
      const iw=W-padL-padR, ih=H-padT-padB;
      const maxRain=Math.max(1,...years.map(d=>d.rainMm||0));
      const maxCold=Math.max(1,...years.map(d=>d.coldNights||0));
      const bw=iw/n, bwInner=Math.max(1,bw*0.7);
      let bars='';
      years.forEach((d,i)=>{
        const h=ih*((d.rainMm||0)/maxRain);
        const x=padL+i*bw+(bw-bwInner)/2, y=padT+ih-h;
        bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bwInner.toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" fill="#caa15a" opacity="0.62" rx="0.6"/>`;
      });
      // cold-nights polyline (one point per year, centred on each bar slot)
      const pts=years.map((d,i)=>{
        const x=padL+i*bw+bw/2, y=padT+ih-ih*((d.coldNights||0)/maxCold);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      const line=`<polyline points="${pts}" fill="none" stroke="#7fb0ff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`;
      // baseline + first/last year labels
      const y0=years[0].y, y1=years[n-1].y;
      const axis=`<line x1="${padL}" y1="${(padT+ih).toFixed(1)}" x2="${(W-padR).toFixed(1)}" y2="${(padT+ih).toFixed(1)}" stroke="rgba(202,161,90,.2)" stroke-width="1"/>`;
      const lbls=`<text x="${padL}" y="${H-3}" fill="#7d7150" font-size="8.5" font-family="Heebo">${y0}</text>`+
                 `<text x="${W-padR}" y="${H-3}" fill="#7d7150" font-size="8.5" font-family="Heebo" text-anchor="end">${y1}</text>`;
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block">`+
        axis+bars+line+lbls+`</svg>`;
    }
    // 📊 generic 12-month gold bar chart (reused by the energy gems: solar-hot-water
    // delivered-vs-demand and monthly PV production). Same visual language as
    // histChartSVG — gold bars + faint baseline. `vals` = 12 numbers (Jan→Dec, left
    // to right, like the climate chart). Optional `baseline` = a single value drawn
    // as a dashed reference line (e.g. daily hot-water demand). Month initials are
    // drawn under every other bar to stay legible at this width.
    const MON_HE1 = ['J','F','M','A','M','J','J','A','S','O','N','D'];
    function monthBarsSVG(vals, baseline){
      const W=270, H=78, padL=4, padR=4, padT=8, padB=14;
      const n=vals.length; if(!n) return '';
      const iw=W-padL-padR, ih=H-padT-padB;
      const mx=Math.max(1, ...vals.map(v=>v||0), baseline!=null?baseline:0);
      const bw=iw/n, bwInner=Math.max(1,bw*0.66);
      let bars='';
      vals.forEach((v,i)=>{
        const h=ih*((v||0)/mx);
        const x=padL+i*bw+(bw-bwInner)/2, y=padT+ih-h;
        bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bwInner.toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" fill="#caa15a" opacity="0.62" rx="0.6"/>`;
      });
      const axis=`<line x1="${padL}" y1="${(padT+ih).toFixed(1)}" x2="${(W-padR).toFixed(1)}" y2="${(padT+ih).toFixed(1)}" stroke="rgba(202,161,90,.2)" stroke-width="1"/>`;
      let ref='';
      if(baseline!=null && isFinite(baseline) && baseline>0){
        const yb=padT+ih-ih*(baseline/mx);
        ref=`<line x1="${padL}" y1="${yb.toFixed(1)}" x2="${(W-padR).toFixed(1)}" y2="${yb.toFixed(1)}" stroke="#7fb0ff" stroke-width="1.3" stroke-dasharray="3 3" opacity="0.85"/>`;
      }
      let lbls='';
      for(let i=0;i<n;i+=2){
        const x=padL+i*bw+bw/2;
        lbls+=`<text x="${x.toFixed(1)}" y="${H-3}" fill="#7d7150" font-size="8" font-family="Heebo" text-anchor="middle">${MON_HE1[i]||''}</text>`;
      }
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block">`+
        axis+bars+ref+lbls+`</svg>`;
    }
    // climate history was its own history tab; it's now MERGED INTO environment (renderEnv fills
    // #env-hist via fillHist). histInnerHtml builds just the content (no h3/sub — environment owns
    // the section header); fillHist handles the one-time data/history.json load.
    function fillHist(el){
      if(!el) return;
      if(_hist){ el.innerHTML=histInnerHtml(_hist); return; }
      el.innerHTML = _histErr
        ? `<div class="card"><div class="m">Could not load the history data.</div></div>`
        : `<div class="card"><div class="m" style="color:#a99b78">Climate data loading…</div></div>`;
      if(!_histLoading && !_histErr){
        _histLoading=true;
        fetch('data/history.json').then(r=>{ if(!r.ok) throw 0; return r.json(); })
          .then(j=>{ _hist=j; _histLoading=false; const e2=$('env-hist'); if(e2&&active==='env') e2.innerHTML=histInnerHtml(_hist); })
          .catch(()=>{ _histErr=true; _histLoading=false; const e2=$('env-hist'); if(e2&&active==='env') e2.innerHTML=`<div class="card"><div class="m">Could not load the history data.</div></div>`; });
      }
    }
    function histInnerHtml(h){
      const meta=h.meta||{}, years=Array.isArray(h.years)?h.years:[], tr=h.trend||{};
      // headline averages across the record
      const n=years.length;
      const avg=key=>{ if(!n) return null; let s=0,c=0; years.forEach(d=>{const v=d[key]; if(v!=null&&isFinite(v)){s+=v;c++;}}); return c?s/c:null; };
      const avgCold=avg('coldNights'), avgRain=avg('rainMm'), avgHot=avg('hotDays');
      const warm=(tr.total_warming_c!=null&&isFinite(tr.total_warming_c))?tr.total_warming_c:null;
      const perDec=(tr.tmax_per_decade!=null&&isFinite(tr.tmax_per_decade))?tr.tmax_per_decade:null;
      const rng=meta.range||(n?(years[0].y+'–'+years[n-1].y):'—');
      const yrsSpan=n>1?(years[n-1].y-years[0].y):65;
      // warming headline card (the signal that matters): +X°C over the span
      const warmCard = warm!=null
        ? `<div class="card"><div class="big" style="color:${warm>=0?'#e8804a':'#7fb0ff'}">${warm>=0?'+':''}${(Math.round(warm*10)/10)}°<span style="font-size:13px;color:#a99b78">C</span></div>`+
            `<div class="m" style="color:#a99b78">Warming over ${yrsSpan} years${perDec!=null?' · ~'+(warm>=0?'+':'')+(Math.round(perDec*100)/100)+'° per decade':''}</div>`+
            `<div class="est">Annual maximum-temperature trend</div></div>`
        : '';
      // headline rows
      const rows=
        `<div class="row"><span>Record range</span><b>${rng}</b></div>`+
        `<div class="row"><span>Cold nights (≤ ~3°) per year</span><b>${avgCold!=null?Math.round(avgCold):'—'}</b></div>`+
        `<div class="row"><span>Average rain per year</span><b>${avgRain!=null?Math.round(avgRain)+' mm':'—'}</b></div>`+
        (avgHot!=null?`<div class="row"><span>Hot days (>35°) per year</span><b>${Math.round(avgHot)}</b></div>`:'');
      // mini-chart card with a tiny legend
      const chartCard = years.length
        ? `<div class="card" style="padding:8px 8px 4px">`+
            `<div style="display:flex;justify-content:space-between;font-size:9.5px;color:#a99b78;margin-bottom:2px;padding:0 2px">`+
              `<span><span style="color:#caa15a">▮</span> Rain (mm)</span>`+
              `<span><span style="color:#7fb0ff">▬</span> Cold nights</span></div>`+
            histChartSVG(years)+`</div>`
        : '';
      const frostNote = meta.frost_note_he ||
        'Cold nights = count of Tmin ≤ ~3° (air temp at 2 m). Radiative ground frost in Larkmont is more frequent than the grid measurement shows.';
      return warmCard+chartCard+rows+
        `<div class="foot">ERA5 reanalysis (Open-Meteo) · regional estimate (grid cell ~11 km), not a sensor on the plot · ${frostNote}</div>`;
    }

    /* ---------- 📖 The home story (home-story timeline, #36-38) ----------
       Reads data/milestones.json (Agent A) with shape {events:[{date,he,emoji}]}
       (date = ISO 'YYYY-MM-DD'). Renders the events as a small dated timeline and
       a LIVE "N years and M months in the house / in Larkmont" computed from today against the two
       anchor dates ('moved into the house' / 'moved to Larkmont'). Static data →
       fetched once and cached; degrades silently if the file is missing. */
    let _ms=null, _msLoading=false, _msErr=false;
    function parseISO(s){
      const m=String(s||'').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if(!m) return null;
      const d=new Date(+m[1],+m[2]-1,+m[3]); return isFinite(d.getTime())?d:null;
    }
    // whole years + remaining months between two dates → "N years and M months"
    // (gracefully drops a zero part; "less than a month" for <1 month). from must be ≤ to.
    function elapsedHe(from, to){
      if(!from||!to||to<from) return null;
      let months=(to.getFullYear()-from.getFullYear())*12 + (to.getMonth()-from.getMonth());
      if(to.getDate()<from.getDate()) months--;          // not a full month yet
      if(months<0) months=0;
      const y=Math.floor(months/12), mo=months%12;
      const yHe = y>0 ? (y===1?'1 year':y+' years') : '';
      const moHe = mo>0 ? (mo===1?'1 month':mo+' months') : '';
      if(!yHe && !moHe) return 'less than a month';
      return [yHe,moHe].filter(Boolean).join(' and ');
    }
    // map a milestone's Hebrew label / date to a "live counter" anchor. We key off
    // the well-known dates from the wishlist so the counters are robust even if the
    // label wording shifts: 2021-08-01 = into the house, 2020-03-05 = to Larkmont.
    function homeStoryCard(date){
      if(_msErr) return '';                               // file absent → show nothing
      if(!_ms){
        if(!_msLoading){
          _msLoading=true;
          fetch('data/milestones.json').then(r=>{ if(!r.ok) throw 0; return r.json(); })
            .then(j=>{ _ms=j||{}; _msLoading=false; if(active==='brain') renderBrain(nowDate()); })
            .catch(()=>{ _msErr=true; _msLoading=false; });   // missing/invalid → silent
        }
        return `<div class="card"><div class="m" style="color:#a99b78">📖 The home story is loading…</div></div>`;
      }
      const evs=(Array.isArray(_ms.events)?_ms.events:[])
        .map(e=>({...e, _d:parseISO(e&&e.date)}))
        .filter(e=>e._d)
        .sort((a,b)=>a._d-b._d);
      if(!evs.length) return '';
      const now=date||new Date();
      // live counters from the two anchor dates (match by ISO, robust to label text)
      const findBy=iso=>evs.find(e=>String(e.date||'').slice(0,10)===iso);
      const house=findBy('2021-08-01'), larkmont=findBy('2020-03-05');
      let counters='';
      if(house){ const el=elapsedHe(house._d,now); if(el) counters+=`<div class="row"><span>🏠 At home</span><b>${el}</b></div>`; }
      if(larkmont){ const el=elapsedHe(larkmont._d,now); if(el) counters+=`<div class="row"><span>🏜️ In Larkmont</span><b>${el}</b></div>`; }
      const fmtD=d=>d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric',year:'numeric'});
      const tl=evs.map(e=>`<div class="tle"><div><span class="te">${e.emoji||'•'}</span><b>${e.he||''}</b></div>`+
        `<div class="td">${fmtD(e._d)}</div></div>`).join('');
      return `<div class="card"><div class="m" style="color:#fff7e6;font-family:'Frank Ruhl Libre',serif;font-size:14px">📖 The home story</div>`+
        counters+
        `<div class="tl">${tl}</div>`+
        `<div class="est">Personal milestones · the count is calculated from today</div></div>`;
    }

    /* ---------- brain (Feature C: "second brain" memory store) ---------- */
    // A collection chip-picker + add-form + newest-first list backed by the FIXED
    // window.LogStore interface (list(coll)/add(coll,rec)). LogStore stamps each
    // record {id,t,d,...fields} and keeps the list newest-first, so we render
    // LogStore.list(coll) as-is. Force-guarded (forms, not per-second). All #inst
    // skin classes reused — no new visual style.
    const BRAIN_COLLS=[
      ['sightings','Sightings'],['plantcond','Plant condition'],['projects','Projects'],
      ['lending','Lending'],['visitors','Visitors'],
      ['neighbors','Neighbors'],['schedule','Reminders'],
      ['airbnb','Airbnb'],['work','Work'],['invoices','Invoices']
    ];
    // per-collection input hint + whether the entry carries a due-date field.
    const BRAIN_HINT={ sightings:'What did you see? Where?', plantcond:'Which plant? What\'s its condition?',
      projects:'Which project / room?', lending:'What did you lend? To whom?',
      visitors:'Who visited?', neighbors:'Neighbor\'s name / note', schedule:'Reminder (e.g. cat food)',
      airbnb:'Guest / dates / note', work:'Work task / meeting', invoices:'Invoice — amount / client' };
    const BRAIN_DUE={ schedule:true, lending:true, airbnb:true, invoices:true };
    let brainColl='sightings';
    let brainMode='lists';   // brain sub-nav: lists | community | inventory | vision
    function brainRow(r){
      const txt=(r&&(r.text||r.t||r.note||r.title||r.name))||'';
      const when=(r&&(r.d||r.due))||'';
      const dueTag=(r&&r.due)?` · due ${r.due.slice?r.due.slice(0,10):r.due}`:'';
      const whenHtml=`${when}${r.d&&dueTag?dueTag:''}`;
      // a memory entry can carry an attached `photo` dataURL (#19/#27) → small
      // thumbnail (click → open full-size in a new tab). Keeps the .brow flex row.
      const thumb=(r&&r.photo)?`<img src="${r.photo}" data-photo="1" alt="">`:'';
      return `<div class="brow">${thumb}<span class="bt">${txt}</span><span class="bw">${whenHtml}</span></div>`;
    }
    // pending photo dataURL staged by the 📷 button, attached to the NEXT add().
    // Module-scoped so it survives the add-form's own re-renders; cleared on add
    // or collection switch so a photo never leaks onto an unrelated entry.
    let _brainPhoto=null;
    // Downscale a chosen File → ~800px JPEG dataURL. Prefers the shared
    // GardenID.downscale (garden_id.js loads before panels.js); falls back to a
    // self-contained canvas downscale so this works even if GardenID is absent.
    function brainDownscale(file){
      if(window.GardenID && GardenID.downscale){
        return GardenID.downscale(file,800).then(r=>r&&r.dataUrl||null).catch(()=>null);
      }
      return new Promise(resolve=>{
        if(!file){ resolve(null); return; }
        let url=null; try{ url=URL.createObjectURL(file); }catch(_){ url=null; }
        if(!url){ resolve(null); return; }
        const img=new Image();
        img.onload=()=>{ try{
          const w0=img.naturalWidth||img.width, h0=img.naturalHeight||img.height;
          if(!w0||!h0){ URL.revokeObjectURL(url); resolve(null); return; }
          const sc=Math.min(1,800/Math.max(w0,h0));
          const cv=document.createElement('canvas');
          cv.width=Math.max(1,Math.round(w0*sc)); cv.height=Math.max(1,Math.round(h0*sc));
          cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
          URL.revokeObjectURL(url);
          resolve(cv.toDataURL('image/jpeg',0.82));
        }catch(_){ try{URL.revokeObjectURL(url);}catch(e){} resolve(null); } };
        img.onerror=()=>{ try{URL.revokeObjectURL(url);}catch(e){} resolve(null); };
        img.src=url;
      });
    }
    function renderBrain(date){
      // brain sub-nav: the personal cluster — lists (second brain) + people/community + inventory + vision board
      const MODES=[['lists','📋 Lists'],['community','👥 People'],['inventory','📦 Inventory'],['materials','🔩 Materials'],['feedback','💬 Suggestions'],['backup','💾 Backup']];
      const modeNav=`<div class="mc-chips" id="brain-modes" style="margin-bottom:8px">`+MODES.map(([k,he])=>`<span class="mc-chip${k===brainMode?' on':''}" data-m="${k}">${he}</span>`).join('')+`</div>`;
      const wireModes=()=>{ const mb=$('brain-modes'); if(mb) mb.querySelectorAll('.mc-chip').forEach(ch=>ch.onclick=()=>{ brainMode=ch.dataset.m; renderBrain(nowDate()); }); };
      if(brainMode!=='lists'){
        const mod = brainMode==='community'?window.__community : brainMode==='inventory'?window.__inventory : brainMode==='materials'?window.__materials : brainMode==='feedback'?window.__feedback : window.__backup;
        body.innerHTML=modeNav+`<div id="brain-mod"></div>`;
        wireModes();
        const mh=$('brain-mod');
        if(mod&&mod.render&&mh){ try{ mod.render(mh,date); }catch(e){ if(mh) mh.innerHTML='<div class="est">Error loading.</div>'; } }
        else if(mh){ mh.innerHTML='<div class="sub">Loading…</div>'; setTimeout(()=>{ if(active==='brain'&&brainMode!=='lists') renderBrain(nowDate()); },150); }
        return;
      }
      const has=!!window.LogStore;
      const chips=BRAIN_COLLS.map(([k,he])=>`<span class="mc-chip${k===brainColl?' on':''}" data-c="${k}">${he}</span>`).join('');
      const list = has ? (LogStore.list(brainColl)||[]) : [];
      const wantDue=!!BRAIN_DUE[brainColl];
      const listHtml = list.length
        ? list.map(brainRow).join('')
        : '<div class="est">No records yet</div>';
      const dueInput = wantDue ? `<input id="brain-due" type="date" style="width:auto;flex:0 0 auto">` : '';
      // 📷 photo-attach: a small button that fires a hidden capture-capable file
      // input; the chosen image is downscaled and staged in _brainPhoto, then
      // saved onto the next entry. Button flips to a "set" state when staged.
      const photoBtn=`<button class="photo-btn${_brainPhoto?' set':''}" id="brain-photo" title="Attach a photo">📷</button>`+
        `<input id="brain-file" type="file" accept="image/*" capture="environment" style="display:none">`;
      body.innerHTML=modeNav+`<h3>Your brain · memory</h3>`+
        `<div class="sub">The house's memory — sightings, plant condition, projects, lending, meters, visitors, neighbors and reminders. Saved locally only.</div>`+
        homeStoryCard(date)+
        `<div class="mc-chips" id="brain-chips">${chips}</div>`+
        (has
          ? `<div style="display:flex;gap:6px;margin-top:8px;align-items:center">`+
              `<input id="brain-in" placeholder="${BRAIN_HINT[brainColl]||'New record'}">`+dueInput+photoBtn+
              `<button class="btn" id="brain-add">Add</button></div>`+
            (_brainPhoto?`<div class="est" style="color:#9fce9f">Photo attached ✓ — it will be saved with the next record</div>`:'')+
            `<div id="brainlist" style="margin-top:6px">${listHtml}</div>`
          : `<div class="card"><div class="m">The memory store is loading…</div></div>`)+
        `<div class="foot">No server and no push — everything is saved on this device (localStorage)</div>`;
      // re-wire AFTER the destructive innerHTML= (the :524 wireMicroclimate pattern):
      const cbox=$('brain-chips');
      if(cbox) cbox.querySelectorAll('.mc-chip').forEach(ch=>ch.onclick=()=>{
        if(ch.dataset.c!==brainColl) _brainPhoto=null;   // don't carry a photo across collections
        brainColl=ch.dataset.c; renderBrain(nowDate()); });
      // 📷 button → open the file picker; on pick, downscale + stage, then re-render.
      const photoB=$('brain-photo'), fileIn=$('brain-file');
      if(photoB && fileIn){
        photoB.onclick=()=>fileIn.click();
        fileIn.onchange=()=>{
          const f=fileIn.files&&fileIn.files[0]; if(!f) return;
          brainDownscale(f).then(durl=>{
            // keep only what LogStore would actually persist (validate + cap).
            _brainPhoto=(window.LogStore&&LogStore.sanitizePhoto)?LogStore.sanitizePhoto(durl):durl;
            if(active==='brain') renderBrain(nowDate());
          });
        };
      }
      // clicking a thumbnail opens the full image in a new tab.
      const blist=$('brainlist');
      if(blist) blist.querySelectorAll('img[data-photo]').forEach(im=>im.onclick=()=>{
        try{ const w=window.open(); if(w) w.document.write(`<img src="${im.src}" style="max-width:100%">`); }catch(e){}
      });
      const addB=$('brain-add');
      if(addB) addB.onclick=()=>{
        const inp=$('brain-in'), v=(inp&&inp.value||'').trim();
        // allow a photo-only entry (e.g. a snapshot with no caption) too.
        if((!v && !_brainPhoto) || !window.LogStore) return;
        const rec={ text:v };
        const due=$('brain-due'); if(wantDue&&due&&due.value) rec.due=due.value;
        if(_brainPhoto) rec.photo=_brainPhoto;
        try{ LogStore.add(brainColl,rec); }catch(e){}
        _brainPhoto=null;                                 // consumed
        renderBrain(nowDate());
      };
      wireModes();
    }

    // ---- STAGE-2 SEAM: expose the data-tab renderers to the shell ----------------
    // The shell (tabs_data.js) mounts each migrated data tab into #tabHost. Rather
    // than duplicate any builder, we RE-HOST the SAME closure `body` into the shell's
    // container and re-run the existing render() for the requested PANEL KEY. The
    // builders are unchanged (re-host, not redesign): they still write `body.innerHTML`
    // and re-wire via the global-id `$` helper, which works in any container because
    // the ids (mc-onoff, r-elec, obs-add, env-gsave, brain-chips, …) are globally
    // unique. `renderInto` takes the ENGLISH PANEL KEY (energy/wild/env/hist/brain) —
    // the shell maps the Hebrew TAB id to the key in tabs_data.js.
    //
    // Important: a single `body` cannot live in two places at once, and render() does
    // body.innerHTML=… (REPLACE, not append). So for normal tabs we adopt #inst's
    // `body` into the active tab's container; the standalone #inst panel is hidden by
    // tabs_data.js (it sets #inst.style.display='none' on first mount), so there is
    // never a visible duplicate. When index.html runs WITHOUT the shell, Panels stays
    // dormant and the original #inst path below runs as before.
    window.Panels = window.Panels || {};
    // mount panel `key` (one of energy/wild/env/hist/brain) into `container`: move the
    // shared `body` under it, set the active panel, and force a fresh render.
    window.Panels.renderInto = function(key, container){
      if(!container) return;
      active = key;                                  // closure var the renderers read
      if(body.parentNode !== container) container.appendChild(body);  // adopt the body
      render(true);                                  // build that panel's content now
    };

    // ---- MERGED 'nature & environment' tab: wild + env BOTH visible & both live ------------
    // Because there is ONE shared `body` and render() REPLACES its content (verified:
    // every builder does body.innerHTML=…), two panels cannot share one body. So we
    // build TWO #inst-skinned hosts inside `container` — #inst (wild) and #inst2 (env,
    // styled by the css2 shim) — each with its OWN dedicated body element, and render
    // each panel into its own body. To keep BOTH fully interactive (each panel's $()
    // re-wiring AND its own re-renders, e.g. renderWild() after "log" / renderEnv()
    // after the Google-key "Save", plus the body-level delegated handlers attached at
    // line 987), we point the mutable closure `body`/`active` at the right host on EVERY
    // interaction via a CAPTURE-phase listener on each host: capture runs before the
    // inner .onclick/delegated handlers, so any subsequent renderX() writes back into
    // the SAME host it came from. The original shared `body` (line 207) is left
    // untouched/offscreen; the merged tab uses its own two bodies exclusively.
    let _mergedBuilt=null;            // {host1, host2, body1, body2} — built once
    window.Panels.renderMerged = function(container){
      if(!container) return;
      if(!_mergedBuilt){
        const host1=el('div'); host1.id='inst';  host1.className='inst-embed';
        const host2=el('div'); host2.id='inst2'; host2.className='inst-embed';
        const body1=el('div','body panel'); host1.appendChild(body1);
        const body2=el('div','body panel'); host2.appendChild(body2);
        container.appendChild(host1);
        container.appendChild(host2);
        // capture-phase re-targeting: before any handler in this host runs, make the
        // shared `body`/`active` point at this host so its renderX() re-renders here.
        host1.addEventListener('click', ()=>{ body=body1; active='wild'; }, true);
        host2.addEventListener('click', ()=>{ body=body2; active='env';  }, true);
        _mergedBuilt={host1,host2,body1,body2};
      } else {
        // re-attach the persistent hosts if the shell rebuilt the panel container.
        if(_mergedBuilt.host1.parentNode!==container) container.appendChild(_mergedBuilt.host1);
        if(_mergedBuilt.host2.parentNode!==container) container.appendChild(_mergedBuilt.host2);
      }
      // paint wild into host1's body, then env into host2's body. Each paint first
      // points the shared body/active at its own host so the builder + its inline
      // re-wiring target the correct element.
      body=_mergedBuilt.body1; active='wild'; render(true);
      body=_mergedBuilt.body2; active='env';  render(true);
    };

    // the live tabs (yard/sky tick every second); the shell calls this on onShow so a
    // re-shown data tab repaints with current data. data tabs are force-rendered only.
    window.Panels.refresh = function(key){
      if(key==='__merged'){ if(_mergedBuilt){ body=_mergedBuilt.body1; active='wild'; render(true); body=_mergedBuilt.body2; active='env'; render(true); } return; }
      if(key && key===active) render(true);
    };
    // panel KEYS this seam can render (english closure keys, NOT the Hebrew tab ids).
    window.Panels.tabIds = ['energy','wild','env','brain'];

    render(true);
    maybeShowWelcome();   // ❤️ greet Alex on the very first open (no-op once home_welcomed_v1 is set)
    // deep-link: opening the app with #map jumps straight to the full-screen environment map.
    try{ if(location.hash==='#map') setTimeout(()=>{ if(window.__mapBg&&window.__mapBg.toggle) window.__mapBg.toggle(true); }, 600); }catch(e){}
    // per-second tick: yard/sky fully re-render; the environment weather block moves with
    // the scrubbed time too (only its #env-wx sub-container repaints — air/pollen stay).
    setInterval(()=>{ if(active==='yard'||active==='sky') render(false); else if(active==='env') updateEnvWeather(nowDate()); },1000);
  }).catch(e=>console.error('panels',e));
})();
