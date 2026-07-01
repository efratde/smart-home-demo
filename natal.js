/* ===================================================================
   natal.js — "The Personal Sky Map" (Alex's natal sky + tonight's transits).
   A self-contained panel in the #inst brass-on-glass language (NOT inside the
   per-second renderSky, so its date/time inputs keep focus). Astrology as POETIC
   FRAMING, never prediction — but the positions are REAL: geocentric tropical
   ecliptic longitudes of the sun/moon/planets at his birth (Derive.zodiacChart) +
   the rising sign (Derive.ascendant, needs birth time) vs where they are TONIGHT.
   Persists birth data in localStorage `home_natal_v1`. window.__natal.open/close.
   =================================================================== */
(function(){
  if(window.__natal) return;
  const $=id=>document.getElementById(id);
  const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const KEY='home_natal_v1';
  function load(){ try{ return JSON.parse(localStorage.getItem(KEY))||{}; }catch(e){ return {}; } }
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(DOC)); }catch(e){} }
  let DOC=load();                                   // { date:'YYYY-MM-DD', time:'HH:MM' }

  // If no date is saved — assume a birth date from resident_numbers.json (editable).
  // Never overrides a value the user has already saved.
  let _seeded=false;
  function seedBirthDate(){
    if(_seeded||DOC.date) return; _seeded=true;
    try{
      fetch('data/resident_numbers.json').then(r=>r.ok?r.json():null).then(j=>{
        if(!j||DOC.date) return;                    // saved in the meantime — don't override
        const m=String(j.birth_iso||'').match(/^(\d{4}-\d{2}-\d{2})/);
        if(m){ DOC.date=m[1]; save(); if(body) render(); }
      }).catch(()=>{});
    }catch(e){}
  }

  const PSYM={ Sun:'☀️', Moon:'🌙', Mercury:'☿', Venus:'♀', Mars:'♂', Jupiter:'♃', Saturn:'♄' };

  const CSS=`
  #natalPanel{position:absolute;top:18px;right:22px;width:362px;max-height:calc(100vh - 40px);
    display:none;flex-direction:column;font-family:'Heebo',sans-serif;color:#efe6cf;z-index:11;
    text-shadow:0 1px 2px rgba(0,0,0,.5)}
  #natalPanel.on{display:flex}
  #natalPanel .body{overflow-y:auto;padding:15px 16px;border-radius:5px;
    background:linear-gradient(165deg,rgba(13,15,30,.95),rgba(7,8,18,.97));
    backdrop-filter:blur(13px);border:1px solid rgba(202,161,90,.28);box-shadow:0 20px 56px rgba(0,0,0,.62)}
  #natalPanel .hd{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  #natalPanel h3{font-family:'Frank Ruhl Libre',serif;font-weight:500;font-size:20px;color:#fff7e6;line-height:1.15}
  #natalPanel .x{flex:0 0 auto;cursor:pointer;color:#a99b78;font-size:15px;border:1px solid rgba(202,161,90,.22);
    border-radius:6px;padding:2px 6px;background:rgba(255,255,255,.03)} #natalPanel .x:hover{color:#fff7e6}
  #natalPanel .sub{font-size:10px;color:#a99b78;margin:3px 0 11px;line-height:1.45}
  #natalPanel .bd{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
  #natalPanel .bd label{font-size:11px;color:#a99b78}
  #natalPanel input{background:#0b1322;border:1px solid rgba(202,161,90,.3);color:#efe6cf;border-radius:7px;
    padding:5px 8px;font-size:12px;font-family:inherit;color-scheme:dark}
  #natalPanel .cols{display:flex;font-size:9.5px;color:#8a7a52;letter-spacing:.04em;padding:0 2px 5px;border-bottom:1px solid rgba(202,161,90,.14)}
  #natalPanel .cols .b{flex:1} #natalPanel .cols .n,#natalPanel .cols .tr{flex:0 0 96px;text-align:center}
  #natalPanel .prow{display:flex;align-items:center;padding:7px 2px;border-top:1px solid rgba(202,161,90,.09);font-size:12.5px}
  #natalPanel .prow:first-of-type{border-top:none}
  #natalPanel .prow .b{flex:1;color:#d6ccb2}#natalPanel .prow .b .sym{color:#caa15a;margin-left:5px}
  #natalPanel .prow .n{flex:0 0 96px;text-align:center;color:#fff7e6;font-weight:600}
  #natalPanel .prow .n small,#natalPanel .prow .tr small{color:#8a7a52;font-weight:400;font-size:9.5px}
  #natalPanel .prow .tr{flex:0 0 96px;text-align:center;color:#bcd0e8}
  #natalPanel .asc{margin-top:10px;padding:9px 11px;border-radius:8px;background:rgba(202,161,90,.1);
    border:1px solid rgba(202,161,90,.28);font-size:12.5px}
  #natalPanel .asc b{color:#fff7e6} #natalPanel .asc .hint{font-size:10px;color:#a99b78;margin-top:3px;line-height:1.4}
  #natalPanel .sect{font-family:'Bellefair',serif;letter-spacing:.06em;font-size:12px;color:#caa15a;margin:14px 0 4px}
  #natalPanel .foot{font-size:9.5px;color:#7d7150;margin-top:12px;line-height:1.5;
    border-right:2px solid rgba(202,161,90,.3);padding-right:8px}
  @media(max-width:960px){#natalPanel{width:calc(100vw - 24px);max-width:none;right:12px;left:12px;top:10px;max-height:calc(100vh - 20px)}}
  @media(max-width:760px){
    #natalPanel{width:auto;max-width:none;right:8px;left:8px;top:8px;max-height:calc(100vh - 16px)}
    #natalPanel .body{padding:12px 12px;max-height:calc(100vh - 16px);-webkit-overflow-scrolling:touch}
    #natalPanel h3{font-size:18px}
    #natalPanel .x{font-size:16px;padding:5px 9px;min-width:34px;min-height:34px;display:flex;align-items:center;justify-content:center}
    #natalPanel .bd{gap:6px}
    #natalPanel .bd input[type="date"]{flex:1 1 140px;min-height:34px}
    #natalPanel .bd input[type="time"]{flex:0 0 auto;min-height:34px}
    #natalPanel input{font-size:12px;padding:7px 8px}
    #natalPanel .cols .n,#natalPanel .cols .tr{flex:0 0 78px}
    #natalPanel .prow{font-size:12px}
    #natalPanel .prow .n,#natalPanel .prow .tr{flex:0 0 78px}
    #natalPanel .prow .n small,#natalPanel .prow .tr small,#natalPanel .cols{font-size:9.5px}
    #natalPanel .asc{padding:9px 10px;font-size:12px}
    #natalPanel .foot{font-size:9.5px}
  }
  `;
  let panel=null, body=null, _instPrev=null, _css=false;
  function ensureCSS(){ if(_css) return; _css=true; document.head.appendChild(el('style',null,CSS)); }
  function hideInst(){ const i=document.querySelector('#inst:not(.inst-embed)'); if(i&&_instPrev===null){ _instPrev=i.style.display; i.style.display='none'; } }
  function restoreInst(){ const i=document.querySelector('#inst:not(.inst-embed)'); if(i&&_instPrev!==null){ i.style.display=_instPrev; } _instPrev=null; }

  function birthDate(){
    if(!DOC.date) return null;
    const d=new Date(DOC.date+'T'+((DOC.time&&/^\d\d:\d\d$/.test(DOC.time))?DOC.time:'12:00')+':00');
    return isNaN(d.getTime())?null:d;
  }
  function fmt(s){ return s?`${s.sign} <small>${s.deg}°</small>`:'—'; }

  function render(){
    if(!body) return;
    const D=window.Derive; const bd=birthDate();
    let html=`<div class="hd"><h3>✨ The Personal Sky Map</h3><span class="x" data-act="close" title="Close">✕</span></div>`+
      `<div class="sub">The sky at the moment of your birth — and where those same bodies are tonight. Real positions (geocentric · tropical).</div>`+
      `<div class="bd"><label>Birth date</label><input type="date" data-act="bdate" value="${esc(DOC.date||'')}" max="2026-12-31">`+
      `<label>Time</label><input type="time" data-act="btime" value="${esc(DOC.time||'')}" style="width:96px"></div>`;
    if(!bd){
      html+=`<div class="foot">Enter a birth date to see the sun sign, the moon and the planets at the moment of your birth — and add a time to also compute the rising sign.</div>`;
      body.innerHTML=html; return;
    }
    const natal=D&&D.zodiacChart?D.zodiacChart(bd):null;
    const now=D&&D.zodiacChart?D.zodiacChart(new Date()):null;
    const asc=(DOC.time&&D&&D.ascendant)?D.ascendant(bd):null;
    if(natal){
      const order=[['Sun','☀️ Sun',natal.sun],['Moon','🌙 Moon',natal.moon]];
      const nowMap={}; if(now){ nowMap.Sun=now.sun; nowMap.Moon=now.moon; (now.planets||[]).forEach(p=>nowMap[p.name]=p); }
      html+=`<div class="cols"><span class="b">Body</span><span class="n">At birth</span><span class="tr">Tonight</span></div>`;
      const row=(label,nat,tr)=>`<div class="prow"><span class="b">${label}</span><span class="n">${fmt(nat)}</span><span class="tr">${fmt(tr)}</span></div>`;
      html+=row('☀️ Sun', natal.sun, nowMap.Sun);
      html+=row('🌙 Moon', natal.moon, nowMap.Moon)+
        (!DOC.time?`<div class="prow" style="border:none;padding-top:0"><span class="b" style="font-size:9.5px;color:#8a7a52">↳ The moon moves fast — enter a time for accuracy</span></div>`:'');
      (natal.planets||[]).forEach(p=>{ html+=row(`${PSYM[p.name]||'•'} ${p.he}`, p, nowMap[p.name]); });
      html+=`<div class="asc">↑ The rising sign (Ascendant): `+
        (asc?`<b>${asc.sign} ${asc.deg}°</b><div class="hint">Estimated — assumes a birth in his region. Highly dependent on an exact time and place.</div>`
            :`<b>—</b><div class="hint">Requires a birth time. Add it above and the rising sign will be computed.</div>`)+`</div>`;
    }
    html+=`<div class="foot">Astrology here is a poetic framing — not prediction. The positions are real, computed from an ephemeris. "Tonight" = where the bodies actually are right now.</div>`;
    body.innerHTML=html;
  }
  function onChange(e){ const t=e.target.closest('[data-act]'); if(!t) return;
    if(t.dataset.act==='bdate'){ DOC.date=t.value||''; save(); render(); }
    else if(t.dataset.act==='btime'){ DOC.time=t.value||''; save(); render(); } }
  function onClick(e){ const t=e.target.closest('[data-act]'); if(t&&t.dataset.act==='close') close(); }
  function ensure(){
    if(panel) return; ensureCSS();
    panel=el('div'); panel.id='natalPanel'; panel.setAttribute('dir','ltr');
    body=el('div','body'); panel.appendChild(body); document.body.appendChild(panel);
    body.addEventListener('change',onChange); body.addEventListener('click',onClick);
  }
  function open(){ ensure(); panel.classList.add('on'); hideInst(); seedBirthDate(); render(); }
  function close(){ if(panel) panel.classList.remove('on'); restoreInst(); }
  window.__natal={ open, close, isOpen:()=>!!(panel&&panel.classList.contains('on')) };
})();
