/* ===================================================================
   zone_card.js — the OUTDOOR ZONE card (the yard twin of the indoor room
   workbench). The 3 yard zones (backyard / balcony / front) now get the
   SAME experience the indoor rooms already have: clicking a zone in the
   yard tab's zone list FLIES the camera to a top-down view of that zone AND
   opens a rich, tabbed floating card — mirroring workbench.js's chrome,
   tabs, gold-on-dark #inst language, and self-contained DOM overlay.

   Wiring (orchestrator, in panels.js): a zone row in renderYard / the
   energy per-zone readout calls window.__zoneCard.open(zoneId), zoneId ∈
   {'backyard','balcony','front'} (the ids in data/site.json). That is the
   ONLY hook; this file owns its own DOM + CSS and never touches #inst,
   panels.js, app.js or the WebGL scene's geometry/materials.

   CAMERA: open(zoneId) computes the zone's world-space centroid from its
   cell grid (Derive.cellGrid()), converts the garden-frame (xL,zL,y) into
   WORLD coords through the SAME transform app.js applies to houseWrap
   (yaw HOUSE_YAW=95° about +y, drop = Terrain.sampleHeight(0,0)−0.2, and
   the garden group's −HCX/−HCZ offset), then eases controls.target there
   and parks the camera straight ABOVE it looking DOWN (top-down) with our
   own rAF tween (easeInOutQuad, same feel as app.js's stepGroundFly). If
   the world transform can't resolve (no Terrain yet), it falls back to
   window.__flyToGround with the centroid converted to lon/lat.

   DATA: reuses Derive's per-cell seasonal microclimate (cellProfile) +
   the same "gems" panels.js surfaces (sun-hours / DLI / leaf-felt peak &
   dawn temp / Δ-from-town / frost gauge / sun-exposure % / ETc litres),
   today's per-zone sun window (zoneState + shadeSchedule + sunEvents), and
   the plants currently in the zone (window.__garden._doc().plants →
   window.__garden.open(id)). Everything modelled is flagged model · estimate.
   =================================================================== */
(function(){
  if(window.__zoneCard) return;
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
  const r1=v=>Math.round(v*10)/10;

  /* ---- house / garden frame constants (MUST mirror app.js + derive.js) ----
     app.js: houseWrap.rotation.y = 95°, houseWrap.position.y = sampleHeight(0,0)−0.2,
     garden group sits at (−HCX,0,−HCZ) inside houseWrap (HCX=4.2, HCZ=5.1).
     derive.js cells carry garden-frame xL/zL/y (same frame YardGrid/GardenPins use). */
  const HOUSE_YAW_DEG=95, HCX=4.2, HCZ=5.1;
  const LAT0=34.0000, LON0=-40.0000;
  const MPD_LAT=110540, MPD_LON=111320*Math.cos(LAT0*Math.PI/180);

  /* ---- zone meta: id → he name + facing/elevation flavour. The authoritative
     name_he comes from Derive.data.site.zones; this is a safe fallback before
     site.json has loaded (and for the facing/elevation sub-line). ---- */
  const ZMETA={
    backyard:{ name_he:'The Backyard', facing:'east',  emoji:'🌄', sub:'East · Morning sun' },
    balcony :{ name_he:'First-Floor Balcony', facing:'east', emoji:'☀️', sub:'Elevated · Most sun' },
    front   :{ name_he:'House Front', facing:'west', emoji:'🌅', sub:'West · Afternoon sun' }
  };
  const FACE_HE={ east:'East', west:'West', north:'North', south:'South' };
  const seasonKey=m=>(m===11||m<2)?'winter':m<5?'spring':m<8?'summer':'autumn';
  const SEASON_HE={ winter:'Winter', spring:'Spring', summer:'Summer', autumn:'Autumn' };

  // the live zone object from site.json (carries shades[] + name_he). Null until loaded.
  function siteZone(id){
    const D=window.Derive, zs=(D&&D.data&&D.data.site&&D.data.site.zones)||[];
    return zs.find(z=>z.id===id)||null;
  }
  function zoneName(id){ const z=siteZone(id); return (z&&z.name_he)||(ZMETA[id]&&ZMETA[id].name_he)||id; }

  /* ---------------- representative + centroid cells (mirror panels.repCell) ---------------- */
  const _repCache={};
  function zoneCells(id){
    const D=window.Derive, cells=(D&&D.cellGrid&&D.cellGrid())||[];
    return cells.filter(c=>c.zoneId===id);
  }
  function repCell(id){
    if(_repCache[id]) return _repCache[id];
    const inZone=zoneCells(id); if(!inZone.length) return null;
    let mx=0,mz=0; inZone.forEach(c=>{mx+=c.xL;mz+=c.zL;}); mx/=inZone.length; mz/=inZone.length;
    let best=inZone[0],bd=Infinity;
    inZone.forEach(c=>{const d=(c.xL-mx)**2+(c.zL-mz)**2; if(d<bd){bd=d;best=c;}});
    _repCache[id]=best; return best;
  }
  // centroid in garden-frame coords {xL,zL,y,elevated}
  function centroid(id){
    const inZone=zoneCells(id); if(!inZone.length) return null;
    let x=0,z=0,y=0; inZone.forEach(c=>{x+=c.xL;z+=c.zL;y+=(c.y||0);});
    const n=inZone.length, baseY=y/n;
    return { xL:x/n, zL:z/n, y:baseY, elevated:baseY>=1.0 };
  }

  /* ---------------- camera: fly TOP-DOWN to the zone ----------------
     Convert the garden-frame centroid into WORLD via the houseWrap transform,
     then tween controls.target there + camera straight above for a plan view. */
  function gardenToWorld(c){
    if(!c) return null;
    if(!(window.Terrain&&window.Terrain.sampleHeight)) return null;
    const dropY=window.Terrain.sampleHeight(0,0)-0.2;   // houseWrap.position.y (app.js)
    const lx=c.xL-HCX, lz=c.zL-HCZ, ly=(c.y||0);         // garden group local (−HCX,−HCZ)
    const th=HOUSE_YAW_DEG*Math.PI/180, cs=Math.cos(th), sn=Math.sin(th);
    // THREE Ry(θ): x' = x·cosθ + z·sinθ ; z' = −x·sinθ + z·cosθ
    const wx=lx*cs+lz*sn, wz=-lx*sn+lz*cs;
    return { x:wx, y:ly+dropY, z:wz };
  }
  // world → lon/lat (the inverse of app.js __flyToGround's mapping) for the fallback.
  function worldToLngLat(w){
    return { lng:LON0+w.x/MPD_LON, lat:LAT0-w.z/MPD_LAT };
  }
  let _tween=null;
  function flyTopDown(id){
    const cam=window.__camera, ctr=window.__controls;
    const c=centroid(id); if(!c) return;
    const w=gardenToWorld(c);
    if(!w || !cam || !ctr){
      // FALLBACK: no world transform / no camera handle → use the app's ground fly
      // (frames from an angle, not pure top-down, but lands on the zone).
      if(w && window.__flyToGround){ const ll=worldToLngLat(w); window.__flyToGround(ll.lng,ll.lat); }
      return;
    }
    // camera height above the centroid: scale with the zone's footprint so a big
    // zone is framed wider. clamp into a sane top-down band, and respect the
    // controls' own min/max distance so OrbitControls.update() won't fight us.
    const inZone=zoneCells(id);
    let spread=6;
    if(inZone.length){
      let mnx=Infinity,mxx=-Infinity,mnz=Infinity,mxz=-Infinity;
      inZone.forEach(cc=>{ if(cc.xL<mnx)mnx=cc.xL; if(cc.xL>mxx)mxx=cc.xL; if(cc.zL<mnz)mnz=cc.zL; if(cc.zL>mxz)mxz=cc.zL; });
      spread=Math.max(mxx-mnx, mxz-mnz, 3);
    }
    let up=Math.max(9, Math.min(26, spread*1.7+8));
    const minD=(ctr.minDistance!=null?ctr.minDistance:0)+1, maxD=(ctr.maxDistance!=null?ctr.maxDistance:1e6)-2;
    up=Math.max(minD, Math.min(maxD, up));
    const tgt=new THREE.Vector3(w.x, w.y+0.3, w.z);
    // a TRUE plan view is straight down (camera dx/dz=0); nudge a hair south so
    // OrbitControls' polar-angle clamp (φ<π/2) isn't hit exactly at the pole.
    const camDest=new THREE.Vector3(w.x, w.y+up, w.z+up*0.12);
    _tween={ tFrom:ctr.target.clone(), tDest:tgt,
             cFrom:cam.position.clone(), cDest:camDest,
             t0:(performance&&performance.now?performance.now():Date.now()), dur:700 };
    step();
  }
  function step(){
    if(!_tween) return;
    const cam=window.__camera, ctr=window.__controls;
    if(!cam||!ctr){ _tween=null; return; }
    const now=(performance&&performance.now?performance.now():Date.now());
    const k=Math.min(1,(now-_tween.t0)/_tween.dur);
    const e=k<0.5? 2*k*k : 1-Math.pow(-2*k+2,2)/2;       // easeInOutQuad (matches app.js)
    ctr.target.lerpVectors(_tween.tFrom,_tween.tDest,e);
    cam.position.lerpVectors(_tween.cFrom,_tween.cDest,e);
    if(k>=1){ _tween=null; return; }
    requestAnimationFrame(step);
  }

  /* ---------------- CSS (the #inst brass-on-glass language, scoped #zcPanel) ----------------
     Mirrors workbench.js's #wbPanel chrome so the zone card reads as the same
     instrument family; anchored top-right (the same slot, slightly inset so it
     doesn't collide if both ever coexist). Self-contained — no shared selectors. */
  const CSS=`
  #zcPanel{position:absolute;top:18px;right:22px;width:322px;max-height:calc(100vh - 40px);
    display:none;flex-direction:column;font-family:'Heebo',sans-serif;color:#efe6cf;z-index:11;
    text-shadow:0 1px 2px rgba(0,0,0,.5)}
  #zcPanel.on{display:flex}
  #zcPanel .ztabs{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:8px}
  #zcPanel .ztab{flex:1 0 auto;text-align:center;font-size:11.5px;padding:7px 8px;border-radius:7px 7px 0 0;cursor:pointer;
    background:rgba(8,9,18,.86);border:1px solid rgba(202,161,90,.28);border-bottom:none;color:#d7c290;user-select:none;
    backdrop-filter:blur(10px)}
  #zcPanel .ztab.on{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;font-weight:600;text-shadow:none}
  #zcPanel .zbody{overflow-y:auto;padding:14px 15px;border-radius:4px;
    background:linear-gradient(160deg,rgba(12,14,26,.93),rgba(6,7,15,.95));
    backdrop-filter:blur(12px);border:1px solid rgba(202,161,90,.22);box-shadow:0 18px 48px rgba(0,0,0,.55)}
  #zcPanel .zhd{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  #zcPanel h3{font-family:'Frank Ruhl Libre',serif;font-weight:500;font-size:19px;color:#fff7e6;line-height:1.15;
    display:flex;align-items:center;gap:7px}
  #zcPanel h3 .ze{font-size:18px}
  #zcPanel .zx{flex:0 0 auto;cursor:pointer;color:#a99b78;font-size:15px;line-height:1;padding:2px 4px;border-radius:6px;
    border:1px solid rgba(202,161,90,.22);background:rgba(255,255,255,.03);transition:.15s}
  #zcPanel .zx:hover{color:#fff7e6;border-color:rgba(202,161,90,.5)}
  #zcPanel .zsub{font-size:10px;color:#a99b78;margin:3px 0 11px;line-height:1.4}
  #zcPanel .zsub .face{font-family:'Bellefair',serif;letter-spacing:.1em;color:#caa15a}
  #zcPanel .zrow{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:12.5px;color:#d6ccb2;
    padding:7px 0;border-top:1px solid rgba(202,161,90,.13)}
  #zcPanel .zrow:first-of-type{border-top:none} #zcPanel .zrow b{color:#fff7e6;font-weight:600}
  #zcPanel .zit{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:#d6ccb2;
    padding:7px 0;border-top:1px solid rgba(202,161,90,.1);cursor:pointer;transition:.15s}
  #zcPanel .zit:first-child{border-top:none}
  #zcPanel .zit:hover{color:#fff7e6}
  #zcPanel .zit .ze{font-size:16px;margin-left:2px}
  #zcPanel .zit .go{color:#caa15a;font-size:11px}
  #zcPanel .zpill{font-size:9.5px;padding:1px 8px;border-radius:20px;white-space:nowrap}
  #zcPanel .zpill.amber{background:rgba(224,178,74,.18);color:#e8c474;border:1px solid rgba(224,178,74,.4)}
  #zcPanel .zpill.green{background:rgba(120,200,120,.16);color:#a7e0a7;border:1px solid rgba(120,200,120,.4)}
  #zcPanel .zpill.blue{background:rgba(120,150,210,.16);color:#bcd0f0;border:1px solid rgba(120,150,210,.4)}
  #zcPanel .zpill.frost-hi{background:rgba(120,150,235,.22);color:#bcd0f0;border:1px solid rgba(120,150,235,.5)}
  #zcPanel .zpill.frost-mid{background:rgba(120,180,210,.16);color:#bfe0ec;border:1px solid rgba(120,180,210,.4)}
  #zcPanel .zpill.real{background:rgba(120,200,120,.16);color:#a7e0a7;border:1px solid rgba(120,200,120,.42)}
  #zcPanel .zpill.model{background:rgba(224,178,74,.18);color:#e8c474;border:1px solid rgba(224,178,74,.42)}
  #zcPanel .ztag{font-size:10px;color:#a99b78}
  #zcPanel .znote{font-size:10.5px;color:#a99b78;line-height:1.5;margin-top:8px;
    border-right:2px solid rgba(202,161,90,.3);padding-right:8px}
  #zcPanel .zcard{background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.15);border-radius:8px;padding:9px 11px;margin-top:9px}
  #zcPanel .zcard:first-child{margin-top:0}
  #zcPanel .zct{font-family:'Bellefair',serif;letter-spacing:.05em;font-size:12px;color:#caa15a;
    margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;gap:6px}
  #zcPanel .zcard .zrow:first-of-type{border-top:none}
  #zcPanel .zgrid{display:grid;grid-template-columns:auto 1fr;gap:5px 10px;font-size:12px;color:#d6ccb2;margin-top:4px}
  #zcPanel .zgrid .k{color:#a99b78}
  #zcPanel .zgrid b{color:#fff7e6;font-weight:600;text-align:left}
  #zcPanel .zbar{height:7px;border-radius:20px;background:rgba(255,255,255,.07);overflow:hidden;margin-top:7px}
  #zcPanel .zbar i{display:block;height:100%;border-radius:20px}
  #zcPanel .rec{display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-top:1px solid rgba(202,161,90,.1)}
  #zcPanel .rec:first-child{border-top:none}
  #zcPanel .rec .re{font-size:16px;line-height:1.2}
  #zcPanel .rec .rn{color:#fff7e6;font-size:12.5px}
  #zcPanel .rec .rs{font-size:9.5px;padding:0 6px;border-radius:20px;background:rgba(120,200,120,.16);color:#a7e0a7;border:1px solid rgba(120,200,120,.4)}
  #zcPanel .rec .rs.mid{background:rgba(224,178,74,.18);color:#e8c474;border-color:rgba(224,178,74,.4)}
  #zcPanel .rec .rs.lo{background:rgba(210,120,120,.16);color:#e8b0b0;border-color:rgba(210,120,120,.4)}
  #zcPanel .rec .rr{font-size:10px;color:#a99b78;line-height:1.45;margin-top:2px}
  #zcPanel .zfoot{font-size:9.5px;color:#7d7150;margin-top:11px}
  @media(max-width:960px){#zcPanel{width:calc(100vw - 24px);max-width:none;right:12px;left:12px;top:10px;max-height:calc(100vh - 20px)}}
  @media(max-width:760px){
    #zcPanel{width:auto;max-width:none;right:8px;left:8px;top:8px;max-height:78vh}
    #zcPanel .ztabs{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;gap:4px}
    #zcPanel .ztab{flex:1 0 auto;min-width:64px;font-size:12px;padding:9px 9px;min-height:38px;display:flex;align-items:center;justify-content:center}
    #zcPanel .zbody{padding:12px 12px;-webkit-overflow-scrolling:touch}
    #zcPanel h3{font-size:18px}
    #zcPanel .zx{font-size:17px;min-width:34px;min-height:34px;display:flex;align-items:center;justify-content:center;padding:0}
    #zcPanel .zsub{font-size:11px}
    #zcPanel .zrow{font-size:12.5px}
    #zcPanel .zit{padding:10px 0;min-height:38px;font-size:12.5px}
    #zcPanel .zgrid{font-size:12px}
    #zcPanel .znote,#zcPanel .ztag,#zcPanel .zfoot{font-size:11px}
    #zcPanel .zct{font-size:12.5px}
    #zcPanel .rec .rn{font-size:12.5px}
    #zcPanel .rec .rr{font-size:11px}
  }
  `;

  /* ---------------- view ---------------- */
  let panel=null, bodyEl=null, tabsEl=null, cur=null, TAB='overview', _instPrev=null;
  const TABS=[['overview','Overview'],['climate','Climate'],['sun','Sun'],['plants','Plants']];

  /* ---- Explain "?" chips: a value-built-as-innerHTML can't hold a live chip
     element, so (mirroring garden.js) each chip is a placeholder <span data-xpl>
     written into the HTML and mounted as a real Explain.chip() child after the
     body innerHTML is set. metric_id auto-fills from data/explain_content.json;
     honesty labels (measured/estimate) come straight from that content's kind. Every
     id used here is present in explain_content.json. Fully defensive — if
     window.Explain isn't loaded the slots just stay empty (no throw). ---- */
  let _pendingChips=[];
  let _xplSeq=0;
  function chipSlot(model){
    const id='zc'+(++_xplSeq);
    _pendingChips.push({sel:`[data-xpl="${id}"]`,model});
    return `<span data-xpl="${id}"></span>`;
  }
  function flushChips(){
    const list=_pendingChips; _pendingChips=[];
    if(!list.length || !bodyEl) return;
    const X=window.Explain; if(!(X&&X.chip)) return;
    list.forEach(({sel,model})=>{
      const slot=bodyEl.querySelector&&bodyEl.querySelector(sel); if(!slot) return;
      try{ const c=X.chip(model); if(c) slot.appendChild(c); }catch(e){}
    });
  }

  function ensure(){
    if(panel) return;
    document.head.appendChild(el('style',null,CSS));
    panel=el('div'); panel.id='zcPanel'; panel.setAttribute('dir','ltr');
    tabsEl=el('div','ztabs'); bodyEl=el('div','zbody');
    panel.appendChild(tabsEl); panel.appendChild(bodyEl);
    document.body.appendChild(panel);
    tabsEl.addEventListener('click',e=>{ const t=e.target.closest('.ztab'); if(!t) return; TAB=t.dataset.t; render(); });
    bodyEl.addEventListener('click',onBodyClick);
  }
  // share the top-right slot with #inst like the workbench does: hide #inst while a
  // zone card is open, restore it on close (never break/hide it permanently).
  function hideInst(){ const i=document.querySelector('#inst:not(.inst-embed)'); if(i&&_instPrev===null){ _instPrev=i.style.display; i.style.display='none'; } }
  function restoreInst(){ const i=document.querySelector('#inst:not(.inst-embed)'); if(i&&_instPrev!==null){ i.style.display=_instPrev; } _instPrev=null; }

  function curSeason(){ return seasonKey((new Date()).getMonth()); }

  /* ---- frost gauge label (mirrors panels.frostLevel) ---- */
  function frostLevel(prof){
    if(!prof) return {txt:'—',cls:''};
    if(prof.frost) return {txt:'High',cls:'frost-hi'};
    const td=(prof.frostTdawn!=null)?prof.frostTdawn:prof.Tdawn;
    if(td!=null && td<=3) return {txt:'Medium',cls:'frost-mid'};
    if(td!=null && td<=6) return {txt:'Low',cls:''};
    return {txt:'None',cls:''};
  }

  /* ---- HONESTY SPINE: "how it really was this season" — the measured Living Record for the zone.
     The modeled cellProfile is already shown (labelled model · estimate); here we add the
     REAL accumulated record from RecordStore.zoneTotals when it covers days, labelled
     "based on real measurements". If status().days===0 (store absent / still building) we show the
     SAME model snapshot, labelled "model · estimate". Fully defensive — never throws. ---- */
  const _z0=v=>(v==null||!isFinite(v))?null:Math.round(v);
  const _z1=v=>(v==null||!isFinite(v))?null:Math.round(v*10)/10;
  function _zIsoUTC(d){ return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0'); }
  function _zIsoDaysAgo(n){ const d=new Date(); return _zIsoUTC(new Date(d.getTime()-n*864e5)); }
  function _zDdmm(iso){ const p=String(iso||'').slice(0,10).split('-'); return (p[2]&&p[1])?(p[2]+'/'+p[1]):(iso||'—'); }
  function realSeasonCard(id){
    const RS=window.RecordStore; if(!RS) return '';                 // not wired → no block (honest)
    let st={}; try{ st=(RS.status&&RS.status())||{}; }catch(e){ st={}; }
    const days=st.days||0;
    // MEASURED path — the record covers real days → show the accumulated totals, labelled real.
    if(days>0 && RS.zoneTotals){
      const from=st.firstDate||_zIsoDaysAgo(365), to=st.lastDate||_zIsoUTC(new Date());
      let tot=null; try{ tot=RS.zoneTotals(id,from,to); }catch(e){ tot=null; }
      if(tot && tot.days){
        return `<div class="zcard"><div class="zct">How it really was so far${chipSlot({metric_id:'record_zoneTotals'})} <span class="zpill real">Based on real measurements</span></div>`+
          `<div class="zgrid">`+
          `<span class="k">Recorded days</span><b>${tot.days}</b>`+
          `<span class="k">Frost nights</span><b>${tot.frostNights}</b>`+
          `<span class="k">Total DLI</span><b>${_z0(tot.dliSum)} mol/m²</b>`+
          `<span class="k">Sun hours</span><b>${_z0(tot.sunHoursSum)} h</b>`+
          `<span class="k">Cumulative GDD</span><b>${_z0(tot.gddSum)}</b>`+
          `<span class="k">Water (ETc)</span><b>${_z1(tot.etcSum)} mm</b>`+
          `<span class="k">Rain</span><b>${_z1(tot.rainSum)} mm</b>`+
          (tot.tMinAbs!=null?`<span class="k">Extreme cold</span><b>${_z1(tot.tMinAbs)}°</b>`:'')+
          `</div>`+
          `<div class="ztag" style="margin-top:5px">${esc(st.note_he||'Based on real measurements (Open-Meteo) via the house geometry — not a physical sensor')}`+
          (st.firstDate?` · ${_zDdmm(st.firstDate)}–${_zDdmm(st.lastDate)}`:'')+`</div></div>`;
      }
    }
    // FALLBACK — days===0: show the season's MODEL snapshot, labelled model (parallel honesty).
    const D=window.Derive, cell=repCell(id), seas=curSeason();
    const prof=(cell&&D&&D.cellProfile)?D.cellProfile(cell,seas):null;
    let h=`<div class="zcard"><div class="zct">How it really was so far${chipSlot({metric_id:'record_status'})} <span class="zpill model">Model · estimate</span></div>`;
    h+=`<div class="ztag">${st.building?('Building the log'+(st.pct!=null?(' · '+st.pct+'%'):'')+'… meanwhile — model estimate.'):'No recorded days yet — a model estimate is shown until real records accumulate.'}</div>`;
    if(prof){
      h+=`<div class="zgrid" style="margin-top:6px">`+
        `<span class="k">Daily DLI</span><b>~${prof.DLI} mol/m²</b>`+
        `<span class="k">Daily sun</span><b>~${prof.sunHours} h</b>`+
        `<span class="k">Water (ETc)</span><b>~${prof.ETc} mm/day</b>`+
        `</div>`;
    }
    h+=`<div class="ztag" style="margin-top:4px">Estimate from the physical per-cell model (not a measurement). Once records accumulate — it is replaced by the measured value.</div></div>`;
    return h;
  }

  /* ---- OVERVIEW: identity + a tight micro snapshot + today's sun window ---- */
  function overviewHtml(id){
    const D=window.Derive, z=siteZone(id), meta=ZMETA[id]||{};
    const seas=curSeason(), cell=repCell(id), prof=cell&&D&&D.cellProfile?D.cellProfile(cell,seas):null;
    const cells=zoneCells(id);
    let h='';
    h+=`<div class="zcard"><div class="zct">Identity <span class="ztag">${SEASON_HE[seas]}</span></div>`+
       `<div class="zrow"><span>Facing</span><span>${FACE_HE[(z&&z.facing)||meta.facing]||'—'}</span></div>`+
       `<div class="zrow"><span>Elevation</span><span>${(z&&(z.elevation_offset_m||0)>1)?'Raised above the yard':'Ground level'}</span></div>`+
       `<div class="zrow"><span>Sampled area</span><b>${cells.length} cells · ~0.5 m</b></div>`;
    if(z&&z.notes_he) h+=`<div class="znote">${esc(z.notes_he)}</div>`;
    h+=`</div>`;
    if(prof){
      const fr=frostLevel(prof);
      h+=`<div class="zcard"><div class="zct">Microclimate summary <span class="zpill amber">Model</span></div>`+
        `<div class="zgrid">`+
        `<span class="k">Direct sun${chipSlot({metric_id:'sunHours'})}</span><b>${prof.sunHours} h</b>`+
        `<span class="k">DLI${chipSlot({metric_id:'dli'})}</span><b>${prof.DLI} mol/m²</b>`+
        `<span class="k">Peak · Dawn${chipSlot({metric_id:'surfaceTemp'})}</span><b>${prof.Tpeak}° / ${prof.Tdawn}°</b>`+
        `<span class="k">Frost${chipSlot({metric_id:'frostRisk'})}</span><b class="${fr.cls?('zpill '+fr.cls):''}">${fr.txt}</b>`+
        `</div></div>`;
    } else {
      h+=`<div class="zcard"><div class="ztag">The model is loading…</div></div>`;
    }
    h+=`<div class="znote">Tap the tabs for the full climate model, today's sun window and the plants in the zone. The camera flew to a top-down view of the zone.</div>`;
    return h;
  }

  /* ---- CLIMATE: the full per-cell seasonal microclimate + the SAME gems
     panels.js surfaces (sun-hours/DLI/leaf-felt peak/Δ/frost/wind/ETc litres)
     plus the valley-rim sun-hour theft (ridge rise/set vs flat horizon). ---- */
  function climateHtml(id){
    const D=window.Derive, z=siteZone(id);
    const seas=curSeason(), cell=repCell(id);
    const prof=(cell&&D&&D.cellProfile)?D.cellProfile(cell,seas):null;
    if(!prof) return `<div class="zcard"><div class="ztag">The climate model is loading… (reopen in a moment)</div></div>`;
    const fr=frostLevel(prof);
    const litresWk=r1((prof.ETc||0)*7);
    const dAirStr=(prof.dAir>=0?'+':'')+prof.dAir;
    const expoPct=Math.round((prof.exposure||0)*100), svfPct=Math.round((prof.svf||0)*100);
    let h='';
    // headline gems grid
    h+=`<div class="zcard"><div class="zct">Zone reading · ${SEASON_HE[seas]} <span class="zpill amber">Model · estimate</span></div>`+
      `<div class="zgrid">`+
      `<span class="k">Direct sun${chipSlot({metric_id:'sunHours'})}</span><b>${prof.sunHours} h/day</b>`+
      `<span class="k">DLI${chipSlot({metric_id:'dli'})}</span><b>${prof.DLI} mol/m²/day</b>`+
      `<span class="k">Ground peak${chipSlot({metric_id:'surfaceTemp'})}</span><b>${prof.Tpeak}°</b>`+
      `<span class="k">Leaf peak (felt)</span><b>${prof.leafTpeak!=null?prof.leafTpeak+'°':'—'}</b>`+
      `<span class="k">Dawn (ground)</span><b>${prof.Tdawn}°</b>`+
      `<span class="k">Δ from town${chipSlot({metric_id:'airDelta'})}</span><b>${dAirStr}°</b>`+
      `</div></div>`;
    // HONESTY SPINE: the measured Living Record for this zone (or the model fallback, labelled)
    h+=realSeasonCard(id);
    // exposure + frost gauges
    h+=`<div class="zcard"><div class="zct">Exposure · Wind · Frost</div>`+
      `<div class="zrow"><span>Sun exposure (SVF)</span><b>${svfPct}%</b></div>`+
      `<div class="zbar"><i style="width:${svfPct}%;background:linear-gradient(90deg,#293866,#caa15a,#fff7cc)"></i></div>`+
      `<div class="zrow"><span>Wind exposure</span><b>${expoPct}%</b></div>`+
      `<div class="zbar"><i style="width:${expoPct}%;background:linear-gradient(90deg,#4da866,#e6bd4d,#db4d38)"></i></div>`+
      `<div class="zrow"><span>Frost risk${chipSlot({metric_id:'frostRisk'})}</span><b class="${fr.cls?('zpill '+fr.cls):''}">${fr.txt}</b></div>`+
      (prof.frostTdawn!=null?`<div class="ztag" style="margin-top:4px">Radiative frost night — soft tissue feels ~${prof.frostTdawn}°${chipSlot({metric_id:'frostTdawn'})} (cold-air drainage${(z&&(z.elevation_offset_m||0)>1)?' · raised = warmer':' · ground collects cold'})</div>`:'')+
      `</div>`;
    // water demand gem (ETc → weekly litres on ~1 m² canopy)
    h+=`<div class="zcard"><div class="zct">Water demand <span class="zpill blue">ETc</span></div>`+
      `<div class="zrow"><span>Daily evapotranspiration (ETc)${chipSlot({metric_id:'ETc'})}</span><b>${prof.ETc} mm</b></div>`+
      `<div class="zrow"><span>~Weekly litres</span><b>~${litresWk} L · 1 m²</b></div>`+
      `<div class="ztag" style="margin-top:4px">Per 1 m² of leaf canopy. 1 mm over 1 m² = 1 L.</div></div>`;
    // valley-rim sun-hour theft: HIS ridge eats sunrise/sunset vs a flat horizon
    if(D&&D.sunEvents){
      const ev=D.sunEvents(new Date());
      if(ev){
        h+=`<div class="zcard"><div class="zct">⛰️ Hours stolen by the ridge</div>`+
          `<div class="zrow"><span>Sunrise — flat horizon</span><span>${ev.riseFlat}</span></div>`+
          `<div class="zrow"><span>Sunrise — over its ridge</span><b>${ev.riseRidge}</b></div>`+
          `<div class="zrow"><span>Sunset — over the ridge</span><b>${ev.setRidge}</b></div>`+
          `<div class="zrow"><span>Sunset — flat horizon</span><span>${ev.setFlat}</span></div>`+
          `<div class="ztag" style="margin-top:4px">The Larkmont Valley ridge steals sun hours at the edges — derived from the real terrain horizon.</div></div>`;
      }
    }
    h+=`<div class="znote">All numbers are derived from a physical energy balance per ~0.5 m cell, over its real geometry and horizon. Model · estimate — not a measurement.</div>`;
    return h;
  }

  /* ---- SUN: today's live per-zone sun window + state, plus plant recs ---- */
  function sunHtml(id){
    const D=window.Derive, z=siteZone(id);
    let h='';
    if(D&&D.zoneState&&z&&window.Astro){
      const s=window.Astro.sun(new Date());
      const cloud=(window.Weather&&window.Weather.cur&&window.Weather.cur.cloud!=null)?window.Weather.cur.cloud:0.1;
      const st=D.zoneState(z,s.azDeg,s.altDeg);
      const rad=D.radiation?D.radiation(s.altDeg,st.sunlit,cloud):null;
      const sch=D.shadeSchedule?D.shadeSchedule(z,new Date()):null;
      h+=`<div class="zcard"><div class="zct">Now <span class="ztag">${st.sunlit?'In sun':esc(st.label||'In shade')}</span></div>`+
        `<div class="zrow"><span>Status</span><b>${esc(st.label||(st.sunlit?'In sun':'In shade'))}</b></div>`+
        (rad?`<div class="zrow"><span>Radiation (GHI)</span><b>${rad.ghi} W/m² · ${esc(rad.level)}</b></div>`+
             `<div class="zrow"><span>UV</span><b>${rad.uv}</b></div>`:'')+
        `</div>`;
      if(sch){
        h+=`<div class="zcard"><div class="zct">Sun window today</div>`+
          `<div class="zrow"><span>First sun</span><b>${sch.firstSun}</b></div>`+
          `<div class="zrow"><span>Last sun</span><b>${sch.lastSun}</b></div>`+
          `<div class="zrow"><span>Total sun hours</span><b>${sch.sunHours} h</b></div></div>`;
      }
    } else {
      h+=`<div class="zcard"><div class="ztag">Live sun data loading…</div></div>`;
    }
    // top plant recs for this zone (same physics panels.js uses)
    const seas=curSeason(), cell=repCell(id);
    if(cell&&D&&D.rankPlantsForCell){
      const ranked=(D.rankPlantsForCell(cell,seas)||[]).slice(0,3);
      if(ranked.length){
        h+=`<div class="zcard"><div class="zct">Fits the zone · ${SEASON_HE[seas]}${chipSlot({metric_id:'plantScore'})} <span class="zpill green">Derived</span></div>`+
          ranked.map(rk=>{
            const sc=rk.score, scCls=sc>=66?'':sc>=40?'mid':'lo';
            const emo=(rk.plant&&rk.plant.emoji)||'🌱';
            return `<div class="rec"><span class="re">${emo}</span><div style="flex:1">`+
              `<div><span class="rn">${esc(rk.name_he)}</span> <span class="rs ${scCls}">${sc}/100</span></div>`+
              `<div class="rr">${esc(rk.reason_he||'')}</div></div></div>`;
          }).join('')+`</div>`;
      }
    }
    return h;
  }

  /* ---- PLANTS: the plants CURRENTLY in this zone → each opens its garden card ---- */
  function plantsHtml(id){
    const G=window.__garden, doc=(G&&G._doc)?G._doc():null;
    const mine=(doc&&Array.isArray(doc.plants))?doc.plants.filter(p=>p.zoneId===id):[];
    let h=`<div class="zct" style="margin-bottom:6px">Plants in the zone <span class="ztag">${mine.length}</span></div>`;
    if(!mine.length){
      return h+`<div class="ztag">No plants assigned to this zone right now.</div>`+
        `<div class="znote">In the "Plant" tab you can assign a plant to the zone; it will appear here.</div>`;
    }
    h+=mine.map(p=>{
      const emo=p.emoji||'🌱', nm=p.name_he||p.id;
      const placed=(p.xL!=null&&p.zL!=null)?' <span class="zpill blue">📍 Pinned</span>':'';
      return `<div class="zit" data-act="plant" data-id="${esc(p.id)}">`+
        `<span><span class="ze">${emo}</span>${esc(nm)}${placed}</span>`+
        `<span class="go">Open ↗</span></div>`;
    }).join('');
    h+=`<div class="znote">Tapping a plant opens its full care card.</div>`;
    return h;
  }

  function render(){
    if(!cur) return;
    _pendingChips=[];   // drop any slots from a prior render before building this tab's HTML
    const meta=ZMETA[cur]||{}, z=siteZone(cur);
    const faceHe=FACE_HE[(z&&z.facing)||meta.facing]||'';
    const elevated=z&&(z.elevation_offset_m||0)>1;
    tabsEl.innerHTML=TABS.map(([k,l])=>`<div class="ztab${k===TAB?' on':''}" data-t="${k}">${l}</div>`).join('');
    let html='';
    if(TAB==='overview') html=overviewHtml(cur);
    else if(TAB==='climate') html=climateHtml(cur);
    else if(TAB==='sun') html=sunHtml(cur);
    else if(TAB==='plants') html=plantsHtml(cur);
    bodyEl.innerHTML=`<div class="zhd"><h3><span class="ze">${meta.emoji||'🌿'}</span>${esc(zoneName(cur))}</h3>`+
      `<span class="zx" data-act="close" title="Close">✕</span></div>`+
      `<div class="zsub"><span class="face">${faceHe}</span>${elevated?' · Elevated':''} · ${esc(meta.sub||'')}</div>`+
      html+
      `<div class="zfoot">Top-down view of the zone · same language as Room · Sky · Energy</div>`;
    flushChips();   // mount deferred Explain "?" chips now that the body HTML is in the DOM
  }

  function onBodyClick(e){
    const t=e.target.closest('[data-act]'); if(!t) return;
    const act=t.dataset.act;
    if(act==='close'){ close(); return; }
    if(act==='plant'){ const pid=t.dataset.id;
      if(window.__garden&&window.__garden.open) window.__garden.open(pid); return; }
  }

  /* ---------------- public API (wired from panels.js zone rows) ---------------- */
  function open(zoneId){
    if(!ZMETA[zoneId] && !siteZone(zoneId)){ return; }   // unknown id → no-op (honest)
    ensure(); cur=zoneId; TAB='overview';
    panel.classList.add('on'); hideInst();
    // one-brain: a user-initiated zone-card open brings the yard tab forward (deep-link
    // from home/alerts lands in the yard context). Safe no-op if nobody's subscribed /
    // already on yard. Never fired inside a per-render redraw, so no emit-loop.
    if(window.Bus&&window.Bus.emit) window.Bus.emit('tab:open',{tab:'yard'});
    render();
    flyTopDown(zoneId);
  }
  function close(){
    if(panel) panel.classList.remove('on');
    restoreInst(); cur=null; _tween=null;
  }
  function isOpen(){ return !!(panel&&panel.classList.contains('on')); }

  window.__zoneCard={ open, close, isOpen, current(){ return cur; } };
})();
