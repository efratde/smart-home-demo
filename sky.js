/* ===================================================================
   sky.js — the living sky. Drives Sun & Moon from real positions
   (astro.js), runs a day→dusk→night cycle, dense Bortle-3 stars, the
   Moon at its true phase, atmospheric fog, and warm interior light.
   =================================================================== */
const SkyRig = (function(){
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const smooth=(e0,e1,x)=>{ const t=clamp((x-e0)/(e1-e0),0,1); return t*t*(3-2*t); };
  const lerp=(a,b,t)=>a+(b-a)*t;
  function lerpCol(c1,c2,t){ const a=new THREE.Color(c1), b=new THREE.Color(c2); return a.lerp(b,t); }

  let scene,renderer,sky,sunLight,moonLight,hemi,ambient,stars,milky,moonMesh,moonMat,glass=[],ilights=[];
  let starGroup, moonTexCanvas, lastPhaseKey='', nightDome, domeMat;
  let nightViewOn=false;   // "darken sky / show stars" override (panels.js שמיים toggle) — a night look WITHOUT changing the clock
  let cloudGroup=null, _cloudPhase=0;   // soft drifting clouds — opacity tied to live weather.cloud, fade at night
  let sunMesh, sunMat, sunGlow;          // VISIBLE sun disc + halo
  let planetGroup, planetSprites=[];     // the five naked-eye planets (sprites on BODY_R)
  let sunPathLine, moonPathLine;         // daily arcs across the sky
  let summerArc, winterArc, summerLbl, winterLbl, lastSolKey=null;  // solstice sun-path reference arcs
  let analemmaLine, analemmaLbl;                                    // the sun's yearly figure-8 at a fixed clock time
  let lastPathKey='', lastMoonPathKey=''; // rebuild arcs only when the calendar day changes
  let satGroup, satObjs=[];              // ISS + bright sats: {sprite,glow,line,meta,pass,passKey}
  let satTipEl=null;                     // sky.js-owned cursor hover-tip on a sat dot
  let SAT_PASSES=[];                     // structured next-pass info, surfaced to panels.js (שמיים tab)
  const notable=[];                      // {kind,name,...,wpos,screen} — projected each frame for hover info
  const STAR_R = 9000;                   // radius the starfield (Points) sits on
  // THREE.Sprite fails to rasterize at very large camera distances (~9000), so
  // the Sun & Moon SPRITES ride a closer shell — still far beyond the house, in
  // front of the stars(9000)/dome(11000), and only shown above the horizon.
  const BODY_R = 2200;
  // ---- REALISTIC ANGULAR SIZE ------------------------------------------------
  // A body of true angular diameter `degAng`, painted on a shell of radius R,
  // spans world-width  W = R · degAng_rad  (small-angle — exact to <1e-4 here).
  // A Sprite's scale IS that world width, but the disc only fills part of the
  // texture quad, so divide by the disc's fill ratio. So the Sun & Moon now
  // subtend their REAL ~0.5° (Moon varies 0.49–0.55° with distance), instead of
  // the old fixed sizes. A soft glow halo (separate sprite) keeps them readable.
  const DEG = Math.PI/180;
  function angScale(degAng, R, fillRatio){ return (R * degAng * DEG) / fillRatio; }
  const SUN_ANG_DEG  = 0.533;            // Sun's mean apparent diameter
  const SUN_DISC_FILL  = 0.84;           // bright core ≈ r·0.42 → 0.84 of the quad (see sunDiscTex)
  const MOON_DISC_FILL = 0.88;           // moon disc r=0.44 → 0.88 of the quad (see moonTexture)
  // colour from B-V index (ci): blue-white hot stars → warm orange cool stars
  function ciColor(ci){
    // crude but pleasant B-V → RGB ramp
    let r,g,b;
    if(ci<0.0){ r=0.70+0.30*(ci+0.4)/0.4; g=0.80; b=1.0; }
    else if(ci<0.4){ r=0.85+0.15*ci/0.4; g=0.90; b=1.0-0.12*ci/0.4; }
    else if(ci<0.8){ r=1.0; g=0.95-0.12*(ci-0.4)/0.4; b=0.88-0.30*(ci-0.4)/0.4; }
    else if(ci<1.4){ r=1.0; g=0.83-0.20*(ci-0.8)/0.6; b=0.58-0.30*(ci-0.8)/0.6; }
    else { r=1.0; g=0.62-0.10*Math.min(1,(ci-1.4)/0.8); b=0.30-0.10*Math.min(1,(ci-1.4)/0.8); }
    return new THREE.Color(Math.min(1,r),Math.min(1,Math.max(0,g)),Math.min(1,Math.max(0,b)));
  }

  function gradientTex(c1,c2,c3){
    const c=document.createElement('canvas'); c.width=8; c.height=256; const x=c.getContext('2d');
    const g=x.createLinearGradient(0,0,0,256);
    g.addColorStop(0,c1); g.addColorStop(0.55,c2); g.addColorStop(1,c3);
    x.fillStyle=g; x.fillRect(0,0,8,256); return new THREE.CanvasTexture(c);
  }

  // Moon disc at its true phase. `illum` = lit fraction (0..1), `frac` = phase
  // angle 0..1 (0=new, 0.5=full) used only to decide which limb is lit. The
  // sprite is rotated in update() so the BRIGHT limb (+X here) points at the Sun.
  function moonTexture(illum, frac){
    const s=160, c=moonTexCanvas||(moonTexCanvas=document.createElement('canvas'));
    c.width=c.height=s; const x=c.getContext('2d'); x.clearRect(0,0,s,s);
    const cx=s/2,cy=s/2,r=s*0.44;
    x.save(); x.beginPath(); x.arc(cx,cy,r,0,7); x.clip();
    // lit lunar surface
    const g=x.createRadialGradient(cx-r*0.3,cy-r*0.3,r*0.1,cx,cy,r*1.25);
    g.addColorStop(0,'#fffdf3'); g.addColorStop(1,'#d8d0ba'); x.fillStyle=g; x.fillRect(0,0,s,s);
    x.globalAlpha=0.13; x.fillStyle='#7f7864';
    [[-.18,-.13,.15],[.17,.06,.11],[-.06,.26,.13],[.24,-.23,.08],[.02,-.05,.07]].forEach(([dx,dy,rr])=>{
      x.beginPath(); x.arc(cx+dx*s,cy+dy*s,rr*s,0,7); x.fill(); }); x.globalAlpha=1;
    // ---- shadow (the unlit part) ----
    // terminator is a half-ellipse; its semi-width k follows the lit fraction.
    // bright limb is on +X (right); shadow covers the left, shrinking as it waxes.
    const k = Math.cos(Math.PI*illum) * r;   // +r at new, 0 at quarter, -r at full
    const N=64;
    x.fillStyle='rgba(6,7,16,0.96)';
    x.beginPath();
    // outer arc of the DARK limb (left side, x<0)
    for(let i=0;i<=N;i++){ const a=Math.PI/2 + Math.PI*i/N; // from top, down the left
      x.lineTo(cx+r*Math.cos(a), cy+r*Math.sin(a)); }
    // terminator ellipse back up the middle
    for(let i=N;i>=0;i--){ const ny=-1+2*i/N, w=Math.sqrt(Math.max(0,1-ny*ny));
      x.lineTo(cx + k*w, cy + r*ny); }
    x.closePath(); x.fill();
    // soft penumbra along the terminator
    x.globalAlpha=0.5; x.fillStyle='rgba(6,7,16,0.5)';
    x.beginPath();
    for(let i=0;i<=N;i++){ const ny=-1+2*i/N, w=Math.sqrt(Math.max(0,1-ny*ny));
      const px=cx+k*w; i?x.lineTo(px,cy+r*ny):x.moveTo(px,cy+r*ny); }
    for(let i=N;i>=0;i--){ const ny=-1+2*i/N, w=Math.sqrt(Math.max(0,1-ny*ny));
      x.lineTo(cx+(k+ (k>=0?-1:1)*r*0.12)*w, cy+r*ny); }
    x.closePath(); x.fill(); x.globalAlpha=1;
    x.restore();
    const t=new THREE.CanvasTexture(c); t.needsUpdate=true; return t;
  }

  // round soft point sprite so stars are crisp discs, not squares.
  // A large solid bright core (so even small points read clearly) with a
  // short glow falloff and faint diffraction spikes for the brightest stars.
  function starSprite(){
    const s=64,c=document.createElement('canvas');c.width=c.height=s;const x=c.getContext('2d');
    // glow halo
    const g=x.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
    g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.18,'rgba(255,255,255,1)');
    g.addColorStop(0.45,'rgba(255,255,255,0.55)'); g.addColorStop(0.8,'rgba(255,255,255,0.12)');
    g.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=g; x.beginPath(); x.arc(s/2,s/2,s/2,0,7); x.fill();
    // subtle cross spikes
    x.globalAlpha=0.35; x.strokeStyle='rgba(255,255,255,0.9)'; x.lineWidth=1.2;
    x.beginPath(); x.moveTo(s/2,3); x.lineTo(s/2,s-3); x.moveTo(3,s/2); x.lineTo(s-3,s/2); x.stroke();
    x.globalAlpha=1;
    return new THREE.CanvasTexture(c);
  }

  // SOFT MILKY-WAY blob — deliberately NOT the crisp star sprite. A wide, very
  // diffuse gaussian with NO bright core, NO hard edge and NO diffraction spikes,
  // so that big overlapping copies of it MERGE into one continuous nebulous haze
  // (a glowing river) instead of a field of countable bright points. The alpha
  // peaks low (~0.5) and feathers all the way to the rim, so each point is a faint
  // smudge; only their heavy overlap builds up the band. Mip-mapping + linear
  // filtering keep it smooth when the sprite is scaled large on screen.
  let _milkySprite=null;
  function milkySprite(){
    if(_milkySprite) return _milkySprite;
    const s=128,c=document.createElement('canvas');c.width=c.height=s;const x=c.getContext('2d');
    const g=x.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
    // gentle, long falloff — soft top, no solid plateau, fully transparent by the rim
    g.addColorStop(0.0,'rgba(255,255,255,0.55)');
    g.addColorStop(0.25,'rgba(255,255,255,0.34)');
    g.addColorStop(0.55,'rgba(255,255,255,0.12)');
    g.addColorStop(0.80,'rgba(255,255,255,0.03)');
    g.addColorStop(1.0,'rgba(255,255,255,0.0)');
    x.fillStyle=g; x.beginPath(); x.arc(s/2,s/2,s/2,0,7); x.fill();
    const t=new THREE.CanvasTexture(c);
    t.minFilter=THREE.LinearMipmapLinearFilter; t.magFilter=THREE.LinearFilter; t.generateMipmaps=true;
    _milkySprite=t; return t;
  }

  // equatorial rectangular unit vector for (RA hours, Dec deg):
  //   q = (cosD cosRA, cosD sinRA, sinD)   — fixed per star (J2000)
  function eqVec(raH,decD){
    const RA=raH*Math.PI/12, D=decD*Math.PI/180, cD=Math.cos(D);
    return [cD*Math.cos(RA), cD*Math.sin(RA), Math.sin(D)];
  }

  // Build the starfield from the REAL HYG bright-star catalog (data/stars.json,
  // mag<=5.0) + a Milky Way band sampled along the galactic plane
  // (data/milkyway.json). Stars are stored in a fixed EQUATORIAL frame; the
  // whole group is rotated each frame by R(LST,lat) so the sky turns correctly
  // through the night and across the seasons (see update()).
  let _starSprite=null;
  function makeStars(){
    starGroup=new THREE.Group();
    starGroup.userData.layers=[];
    _starSprite=starSprite();

    function buildPoints(arr, opts){
      // arr: array of [qx,qy,qz, r,g,b, size]
      const n=arr.length;
      const geo=new THREE.BufferGeometry(), pos=new Float32Array(n*3), col=new Float32Array(n*3), sz=new Float32Array(n);
      for(let i=0;i<n;i++){ const a=arr[i];
        pos[i*3]=a[0]*STAR_R; pos[i*3+1]=a[1]*STAR_R; pos[i*3+2]=a[2]*STAR_R;
        col[i*3]=a[3]; col[i*3+1]=a[4]; col[i*3+2]=a[5]; sz[i]=a[6];
      }
      geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
      geo.setAttribute('color',new THREE.BufferAttribute(col,3));
      geo.setAttribute('asize',new THREE.BufferAttribute(sz,1));
      // ShaderMaterial: per-star size (magnitude) + round sprite + global opacity/twinkle
      const mat=new THREE.ShaderMaterial({
        uniforms:{ uTex:{value:_starSprite}, uOpacity:{value:0}, uScale:{value:1}, uPx:{value:(renderer.getPixelRatio?renderer.getPixelRatio():1)} },
        // depthTest:false + depthWrite:false + a fixed renderOrder per layer keeps
        // every dome element in a STABLE back-to-front paint order, so orbiting the
        // camera never re-sorts these huge co-located transparent shells (the old
        // depthTest:true let the dome/Sky z-kill stars inconsistently → flicker).
        // depthTest:TRUE so the opaque terrain/house occlude below-horizon stars
        // (depthTest:false made them paint over the dark night ground → house
        // looked like it floated). Distinct renderOrder (set per layer) keeps the
        // stable paint order that prevents the dome/stars sort-flicker; the dome is
        // depthWrite:false so it never z-kills the stars above the horizon.
        transparent:true, depthWrite:false, depthTest:true,
        blending:THREE.AdditiveBlending,
        vertexShader:`
          attribute float asize; attribute vec3 color; varying vec3 vCol;
          uniform float uScale; uniform float uPx;
          void main(){ vCol=color; vec4 mv=modelViewMatrix*vec4(position,1.0);
            gl_PointSize=asize*uScale*uPx;
            gl_Position=projectionMatrix*mv; }`,
        fragmentShader:`
          uniform sampler2D uTex; uniform float uOpacity; varying vec3 vCol;
          void main(){ float a=texture2D(uTex,gl_PointCoord).a;
            // a touch of extra punch so the field reads richly on the dark dome
            gl_FragColor=vec4(vCol*1.35,1.0)*a*uOpacity; }`
      });
      mat.toneMapped=false;
      const p=new THREE.Points(geo,mat);
      p.frustumCulled=false; p.renderOrder=opts&&opts.order||0;
      starGroup.add(p); starGroup.userData.layers.push(p); return p;
    }

    // ---- MILKY WAY band (its OWN soft-glow material, NOT the crisp star one) ---
    // The user reported the boosted band looked like "extra phosphorescent stars"
    // (bright bluish points) and asked for a conventional, soft, pinkish nebular
    // band like real Milky-Way photos. So the band gets a distinct render:
    //   • the big diffuse milkySprite() (no core/spikes) instead of the star disc,
    //     so its large overlapping points smear into ONE continuous haze;
    //   • a faint warm rose/cream tint (~rgb 216,196,205) baked into the shader,
    //     NOT the per-point bluish star colour;
    //   • NO ×1.35 punch and a low per-point alpha so it's a subtle glow, not a
    //     field that competes with the real stars.
    // It still shares the dome's transparency/blending discipline (additive,
    // depthTest:true so terrain occludes the below-horizon part, depthWrite:false,
    // renderOrder 0 — painted before constellation lines/stars). It is pushed into
    // starGroup.userData.layers and assigned to `milky` so update()'s per-layer
    // loop, applyLayerVis() and the `milkyway` toggle all keep working unchanged.
    // The same uOpacity/uScale uniforms are kept so that loop never trips on it.
    const MW_TINT=new THREE.Vector3(216/255, 196/255, 205/255); // warm pink-white
    function buildMilky(arr){
      const n=arr.length;
      const geo=new THREE.BufferGeometry(), pos=new Float32Array(n*3), wgt=new Float32Array(n), sz=new Float32Array(n);
      for(let i=0;i<n;i++){ const a=arr[i];
        pos[i*3]=a[0]*STAR_R; pos[i*3+1]=a[1]*STAR_R; pos[i*3+2]=a[2]*STAR_R;
        wgt[i]=a[3]; sz[i]=a[4];
      }
      geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
      geo.setAttribute('awgt',new THREE.BufferAttribute(wgt,1));   // per-point density 0..1
      geo.setAttribute('asize',new THREE.BufferAttribute(sz,1));
      const mat=new THREE.ShaderMaterial({
        uniforms:{ uTex:{value:milkySprite()}, uOpacity:{value:0}, uScale:{value:1},
                   uTint:{value:MW_TINT}, uPx:{value:(renderer.getPixelRatio?renderer.getPixelRatio():1)} },
        transparent:true, depthWrite:false, depthTest:true,
        blending:THREE.AdditiveBlending,
        vertexShader:`
          attribute float asize; attribute float awgt; varying float vW;
          uniform float uScale; uniform float uPx;
          void main(){ vW=awgt; vec4 mv=modelViewMatrix*vec4(position,1.0);
            gl_PointSize=asize*uScale*uPx;
            gl_Position=projectionMatrix*mv; }`,
        // faint warm-pink haze: tint × low per-point weight × soft texture alpha.
        // No brightness punch (unlike the stars' ×1.35) so it stays a subtle glow.
        fragmentShader:`
          uniform sampler2D uTex; uniform float uOpacity; uniform vec3 uTint; varying float vW;
          void main(){ float a=texture2D(uTex,gl_PointCoord).a;
            float b=0.30+0.45*vW;                       // dim per-point: dense regions a touch brighter
            gl_FragColor=vec4(uTint*b,1.0)*a*uOpacity; }`
      });
      mat.toneMapped=false;
      const p=new THREE.Points(geo,mat);
      p.frustumCulled=false; p.renderOrder=0;
      starGroup.add(p); starGroup.userData.layers.push(p); return p;
    }

    // start with a sparse procedural fallback so the sky is never empty before
    // the catalog loads; replaced when stars.json arrives.
    const fallback=[]; for(let i=0;i<400;i++){ const v=eqVec(Math.random()*24, (Math.random()*2-1)*80);
      fallback.push([v[0],v[1],v[2],1,1,1, 2.0]); }
    stars=buildPoints(fallback,{order:2});
    // placeholder (single faint blob), replaced when milkyway.json loads. Note the
    // MW now uses the soft buildMilky format: [qx,qy,qz, weight, sizePx].
    milky=buildMilky([[0,0,1, 0.5, 24]]);
    scene.add(starGroup);

    // ---- load real catalogs ----
    // brighter = bigger. Faintest (mag~5) ≈ 3px so it still reads; brightest
    // (Sirius, mag −1.4) ≈ 14px. Bortle-3: generous so the field feels rich.
    function magToSize(m){
      return Math.max(2.6, 12.5 - (m+1.5)*1.55);
    }
    fetch('data/stars.json').then(r=>r.json()).then(j=>{
      const list=(j&&j.stars)||[]; if(!list.length) return;
      const arr=list.map(s=>{ const v=eqVec(s[0],s[1]); const c=ciColor(s[3]||0);
        return [v[0],v[1],v[2], c.r,c.g,c.b, magToSize(s[2])]; });
      // remove fallback, add the real field
      starGroup.remove(stars); stars.geometry.dispose(); stars.material.dispose();
      stars=buildPoints(arr,{order:2});
      stars.userData.brightFlux = list.map(s=>Math.pow(10,-0.4*s[2])); // for twinkle weighting (unused but handy)
    }).catch(e=>console.warn('stars.json',e));

    fetch('data/milkyway.json').then(r=>r.json()).then(j=>{
      const pts=(j&&j.pts)||[]; if(!pts.length) return;
      // CONVENTIONAL soft nebular band along the galactic plane — a faint rose/cream
      // diffuse cloud, like real Milky-Way photos. (The previous "boost" rendered it
      // with the crisp star sprite + bluish tint and high opacity, which read as
      // "extra phosphorescent stars" — exactly what we're undoing here.) The look now
      // comes from buildMilky(): the wide soft blob smears overlapping points into a
      // continuous haze, the warm-pink tint lives in the shader, and brightness is
      // low. Here we only pass each point's DENSITY weight (w) and a big SIZE so the
      // sprites overlap heavily. Sizes ~22–46px (vs the old 7–18) make the points
      // un-countable; the density weight just lets the galactic core read a hair
      // brighter/larger than the thin outer arms.
      const arr=pts.map(p=>{ const v=eqVec(p[0],p[1]); const w=p[2];
        return [v[0],v[1],v[2], w, 22.0+24.0*w]; });
      starGroup.remove(milky); milky.geometry.dispose(); milky.material.dispose();
      milky=buildMilky(arr);
    }).catch(e=>console.warn('milkyway.json',e));
  }

  // ---- CONSTELLATION LINE-FIGURES ------------------------------------------
  // Faint, elegant line-figures joining the catalog stars, in the SAME fixed
  // EQUATORIAL frame as the starfield: the segments live INSIDE starGroup, so
  // R(LST,lat) rotates them with the sky exactly like the stars (no per-frame
  // math here). One THREE.LineSegments holds every segment of every figure
  // (additive, thin, low opacity). Names are baked as faint canvas-sprite
  // labels at each figure's centroid, and each centroid is also registered in
  // notable[] so the existing hover layer can name it.
  // Data: data/constellations.json — ofrohn/d3-celestial (IAU/Stellarium),
  // ranks 1–2 (most prominent), segs as [raH,decDeg, raH,decDeg].
  let conLines=null, conLineMat=null, conLabelGroup=null;
  const conLabels=[];   // {he,la,wpos(local,unrotated),alt,az,sprite}
  function labelSprite(he,la){
    const pad=8, fs=30, sub=17;
    const cv=document.createElement('canvas'); const x=cv.getContext('2d');
    x.font=`600 ${fs}px system-ui,Segoe UI,Arial`; const w1=x.measureText(he).width;
    x.font=`400 ${sub}px system-ui,Segoe UI,Arial`; const w2=x.measureText(la).width;
    const W=Math.ceil(Math.max(w1,w2))+pad*2, H=fs+sub+pad*2+4;
    cv.width=W; cv.height=H;
    x.textAlign='center'; x.textBaseline='middle';
    x.shadowColor='rgba(0,0,0,0.8)'; x.shadowBlur=4;
    x.fillStyle='rgba(196,214,255,0.92)'; x.font=`600 ${fs}px system-ui,Segoe UI,Arial`;
    x.fillText(he, W/2, pad+fs/2);
    x.fillStyle='rgba(150,170,210,0.7)'; x.font=`400 ${sub}px system-ui,Segoe UI,Arial`;
    x.fillText(la, W/2, pad+fs+4+sub/2);
    const t=new THREE.CanvasTexture(cv); t.needsUpdate=true;
    const m=new THREE.SpriteMaterial({map:t,transparent:true,opacity:0,depthWrite:false,depthTest:false,fog:false});
    m.toneMapped=false;
    const sp=new THREE.Sprite(m); sp.frustumCulled=false; sp.renderOrder=3;
    // keep on-screen size roughly constant: scale ∝ STAR_R so it reads at the dome
    const s=STAR_R*0.052; sp.scale.set(s*W/H, s, 1);
    sp.userData.aspect=W/H;
    return sp;
  }
  function makeConstellations(){
    conLineMat=new THREE.LineBasicMaterial({color:0x6f86c9,transparent:true,opacity:0,
      depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,fog:false});
    conLineMat.toneMapped=false;
    conLabelGroup=new THREE.Group(); conLabelGroup.frustumCulled=false;
    fetch('data/constellations.json').then(r=>r.json()).then(j=>{
      const list=(j&&j.constellations)||[]; if(!list.length) return;
      const verts=[];
      list.forEach(c=>{
        (c.segs||[]).forEach(s=>{
          const a=eqVec(s[0],s[1]), b=eqVec(s[2],s[3]);
          verts.push(a[0]*STAR_R,a[1]*STAR_R,a[2]*STAR_R, b[0]*STAR_R,b[1]*STAR_R,b[2]*STAR_R);
        });
        // label anchor (centroid direction) — store the UNROTATED equatorial
        // world point; update() rotates it by starGroup's matrix M like the field.
        if(c.label){
          const v=eqVec(c.label[0],c.label[1]);
          const sp=labelSprite(c.he||c.id, c.la||'');
          conLabelGroup.add(sp);
          conLabels.push({he:c.he||c.id, la:c.la||c.id, id:c.id,
            local:new THREE.Vector3(v[0]*STAR_R,v[1]*STAR_R,v[2]*STAR_R), sprite:sp});
        }
      });
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
      conLines=new THREE.LineSegments(geo, conLineMat);
      conLines.frustumCulled=false; conLines.renderOrder=1;
      // INSIDE starGroup → inherits the sidereal rotation automatically.
      if(starGroup) starGroup.add(conLines);
      else scene.add(conLines);
    }).catch(e=>console.warn('constellations.json',e));
    scene.add(conLabelGroup);
  }

  // ---- VISIBLE CLOUDS: soft camera-facing puffs on a mid-sky shell, drifting slowly.
  // Opacity is tied to the LIVE weather.cloud (honest) with a faint baseline so a clear
  // day still shows a wisp or two; they fade out at night (×dayF) so the starfield stays
  // clean. Sprites (camera-facing) at varied azimuth/elevation, anchored to the camera
  // like the sun/moon so they sit "at distance". renderOrder 2 (over the Sky shader,
  // under the sun/moon discs at 5/6).
  function cloudTex(){
    const c=document.createElement('canvas'); c.width=c.height=128; const x=c.getContext('2d');
    function blob(cx,cy,r,a){ const g=x.createRadialGradient(cx,cy,0,cx,cy,r);
      g.addColorStop(0,'rgba(255,255,255,'+a+')'); g.addColorStop(1,'rgba(255,255,255,0)');
      x.fillStyle=g; x.beginPath(); x.arc(cx,cy,r,0,7); x.fill(); }
    blob(64,70,42,0.92); blob(42,74,30,0.7); blob(86,74,32,0.7); blob(60,54,28,0.6); blob(80,60,22,0.5);
    const t=new THREE.CanvasTexture(c); t.needsUpdate=true; return t;
  }
  function makeClouds(){
    cloudGroup=new THREE.Group(); cloudGroup.frustumCulled=false; cloudGroup.renderOrder=2;
    const tex=cloudTex(), R=1500, N=16;
    for(let i=0;i<N;i++){
      const m=new THREE.SpriteMaterial({map:tex,transparent:true,opacity:0,depthWrite:false,depthTest:false,fog:false,color:0xffffff});
      m.toneMapped=false;
      const sp=new THREE.Sprite(m);
      const s=R*(0.26 + ((i*53)%100)/100*0.40);       // size variety
      sp.scale.set(s*1.7, s, 1);                       // wider than tall (cloud-ish)
      sp.renderOrder=2; sp.frustumCulled=false;
      sp.userData={ az:(i/N)*Math.PI*2 + (i%4)*0.5, el:(18 + (i*43)%58)*Math.PI/180, R:R, dim:0.55+((i*7)%10)/10*0.4 };
      cloudGroup.add(sp);
    }
    scene.add(cloudGroup);
  }

  function init(opts){
    scene=opts.scene; renderer=opts.renderer; glass=opts.glass||[]; ilights=opts.ilights||[];
    sky=new THREE.Sky(); sky.scale.setScalar(18000); scene.add(sky);
    // NOTE: THREE.Sky stays OPAQUE with its default depth flags. As an opaque mesh
    // it always renders in the opaque pass (before every transparent dome element),
    // and the opaque house/terrain still write depth over it — so it needs no
    // renderOrder/depth changes. The flicker fix lives entirely in the transparent
    // dome layers' renderOrder + depth flags below; Sky is left untouched on purpose.
    const u=sky.material.uniforms; u.turbidity.value=5; u.rayleigh.value=2.2;
    u.mieCoefficient.value=0.005; u.mieDirectionalG.value=0.8;

    sunLight=new THREE.DirectionalLight(0xfff1d6,2.6); sunLight.castShadow=true;
    sunLight.shadow.mapSize.set(2048,2048);
    const s=70; Object.assign(sunLight.shadow.camera,{left:-s,right:s,top:s,bottom:-s,near:1,far:400});
    sunLight.shadow.mapSize.set(4096,4096);
    sunLight.shadow.bias=-0.0004; sunLight.shadow.normalBias=0.02;
    sunLight.target.position.set(0,0,0); scene.add(sunLight.target); scene.add(sunLight);

    moonLight=new THREE.DirectionalLight(0x9fb4e0,0.0); moonLight.castShadow=true;
    moonLight.shadow.mapSize.set(1024,1024);
    Object.assign(moonLight.shadow.camera,{left:-s,right:s,top:s,bottom:-s,near:1,far:140});
    moonLight.shadow.bias=-0.0005; moonLight.target.position.set(0,0,0); scene.add(moonLight.target); scene.add(moonLight);

    hemi=new THREE.HemisphereLight(0xbcd2ff,0xb98a5a,0.6); scene.add(hemi);
    ambient=new THREE.AmbientLight(0x404a6b,0.0); scene.add(ambient);

    makeStars();
    makeConstellations();

    // deep-indigo night dome (hides the muddy Sky shader after dark).
    // Bortle-3 dark site: genuinely dark, with only a faint horizon lift so the
    // gradient doesn't ring at the zenith and the starfield always reads.
    // The dome is a near-opaque DARK backdrop sphere (NormalBlending), so it KEEPS
    // depthTest:true (depthWrite:false) — the opaque house/terrain must still occlude
    // it (depthTest:false would let the dark dome paint OVER the house at night).
    // The flicker it caused was a TRANSPARENT-SORT ambiguity, not z-fighting: it and
    // the additive starfield shared renderOrder 0 with near-identical (camera-centred)
    // distances, so their paint order flipped frame-to-frame and the dark dome
    // sometimes drew AFTER the stars, dimming them. Pinning it to renderOrder −5
    // (before milky/lines/stars at 0/1/2) makes the dark backdrop ALWAYS paint first.
    domeMat=new THREE.MeshBasicMaterial({ map:gradientTex('#04050e','#070b1b','#0a1024'),
      side:THREE.BackSide, transparent:true, opacity:0, depthWrite:false, depthTest:true, fog:false });
    domeMat.toneMapped=false;
    nightDome=new THREE.Mesh(new THREE.SphereGeometry(11000,32,16), domeMat);
    nightDome.renderOrder=-5; nightDome.frustumCulled=false; scene.add(nightDome);

    // Moon disc — sized to its REAL apparent diameter (~0.5°) on the BODY_R
    // shell; the exact value is set per-frame from Astro.moon().angDiamDeg (it
    // swings 0.49–0.55° with distance). depthTest off + high renderOrder so it
    // always paints over the dark dome; frustumCulled off (it sits far out).
    moonMat=new THREE.SpriteMaterial({map:moonTexture(0.55,0.3),transparent:true,depthWrite:false,depthTest:false,fog:false});
    moonMat.toneMapped=false;
    moonMesh=new THREE.Sprite(moonMat); moonMesh.scale.setScalar(angScale(0.52,BODY_R,MOON_DISC_FILL));
    moonMesh.frustumCulled=false; moonMesh.renderOrder=6; scene.add(moonMesh);
    // moon glow — a soft halo a few disc-widths across so the small real disc
    // still reads as a luminous body against the dark dome.
    const glowMat=new THREE.SpriteMaterial({map:glowTex(),transparent:true,opacity:0,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,color:0xcdd9ff,fog:false});
    moonMesh.userData.glow=new THREE.Sprite(glowMat); moonMesh.userData.glow.scale.setScalar(angScale(2.6,BODY_R,1));
    moonMesh.userData.glow.frustumCulled=false; moonMesh.userData.glow.renderOrder=5; scene.add(moonMesh.userData.glow);

    // ---- VISIBLE SUN: a bright disc + soft halo riding the real az/alt path ----
    // (the DirectionalLight stays as the scene light; this is the body you SEE).
    // Disc sized to the Sun's true ~0.533° apparent diameter on BODY_R.
    sunMat=new THREE.SpriteMaterial({map:sunDiscTex(),transparent:true,depthWrite:false,depthTest:false,
      blending:THREE.AdditiveBlending,fog:false,color:0xfff6e0});
    sunMat.toneMapped=false;
    sunMesh=new THREE.Sprite(sunMat); sunMesh.scale.setScalar(angScale(SUN_ANG_DEG,BODY_R,SUN_DISC_FILL));
    sunMesh.frustumCulled=false; sunMesh.renderOrder=6; scene.add(sunMesh);
    const sunGlowMat=new THREE.SpriteMaterial({map:glowTex(),transparent:true,opacity:0,depthWrite:false,depthTest:false,
      blending:THREE.AdditiveBlending,fog:false,color:0xffd9a0});
    sunGlow=new THREE.Sprite(sunGlowMat); sunGlow.scale.setScalar(angScale(4.0,BODY_R,1)); sunGlow.frustumCulled=false;
    sunGlow.renderOrder=5; scene.add(sunGlow);
    makeClouds();

    // planets, sun/moon daily arcs, and the notable-object registry
    makePlanets();
    makeSkyPaths();
    makeSatellites();

    scene.fog=new THREE.FogExp2(0xc9b890,0.00012);
  }
  function glowTex(){ const s=128,c=document.createElement('canvas');c.width=c.height=s;const x=c.getContext('2d');
    const g=x.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2); g.addColorStop(0,'rgba(220,228,255,0.9)');
    g.addColorStop(0.3,'rgba(180,200,255,0.25)'); g.addColorStop(1,'rgba(180,200,255,0)');
    x.fillStyle=g; x.fillRect(0,0,s,s); return new THREE.CanvasTexture(c); }
  // crisp bright solar disc with a tight bloom
  function sunDiscTex(){ const s=128,c=document.createElement('canvas');c.width=c.height=s;const x=c.getContext('2d');
    const g=x.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
    g.addColorStop(0,'rgba(255,255,250,1)'); g.addColorStop(0.30,'rgba(255,248,225,1)');
    g.addColorStop(0.42,'rgba(255,228,170,0.95)'); g.addColorStop(0.5,'rgba(255,210,140,0.35)');
    g.addColorStop(0.75,'rgba(255,200,120,0.08)'); g.addColorStop(1,'rgba(255,190,110,0)');
    x.fillStyle=g; x.beginPath(); x.arc(s/2,s/2,s/2,0,7); x.fill();
    return new THREE.CanvasTexture(c); }

  // ---- PLANETS --------------------------------------------------------------
  // Star-like white point with a tight bright core + soft halo (tinted per
  // planet via SpriteMaterial.color). Brightness & size come from the planet's
  // real apparent magnitude each frame (see makePlanets/update).
  let _planetTex=null;
  function planetTex(){
    if(_planetTex) return _planetTex;
    const s=64,c=document.createElement('canvas');c.width=c.height=s;const x=c.getContext('2d');
    const g=x.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
    g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.16,'rgba(255,255,255,1)');
    g.addColorStop(0.34,'rgba(255,255,255,0.6)'); g.addColorStop(0.7,'rgba(255,255,255,0.14)');
    g.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=g; x.beginPath(); x.arc(s/2,s/2,s/2,0,7); x.fill();
    _planetTex=new THREE.CanvasTexture(c); return _planetTex;
  }
  // a planet's screen presence: brighter (lower mag) → larger sprite. Mapped so
  // Venus (mag −4) reads clearly larger than Saturn (mag +1) but none balloon.
  function planetSize(mag){ return clamp(angScale(0.5,BODY_R,1)*(1.0 + (1.2-mag)*0.34), 9, 46); }
  function makePlanets(){
    planetGroup=new THREE.Group(); scene.add(planetGroup);
    planetSprites=[];
    ['Mercury','Venus','Mars','Jupiter','Saturn'].forEach(name=>{
      const m=new THREE.SpriteMaterial({map:planetTex(),transparent:true,opacity:0,depthWrite:false,depthTest:false,
        blending:THREE.AdditiveBlending,fog:false});
      m.toneMapped=false;
      const sp=new THREE.Sprite(m); sp.frustumCulled=false; sp.renderOrder=6; sp.scale.setScalar(16);
      sp.userData.name=name; planetGroup.add(sp); planetSprites.push(sp);
    });
  }

  // ---- SUN / MOON DAILY ARC -------------------------------------------------
  // A smooth line tracing the body's az/alt across the WHOLE calendar day, from
  // just below the eastern horizon to just below the western one. Rebuilt only
  // when the date changes (cached by Y-M-D). Drawn on a shell slightly inside
  // BODY_R so the disc rides on top. Winter days arc low, summer days arc high.
  function buildArcGeometry(){
    const N=240, geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N+1)*3), 3));
    geo.userData.N=N; return geo;
  }
  function makeSkyPaths(){
    const ARC_R=BODY_R*0.985;
    const sunMatL=new THREE.LineBasicMaterial({color:0xffd27a,transparent:true,opacity:0,depthWrite:false,depthTest:false,fog:false});
    sunMatL.toneMapped=false;
    sunPathLine=new THREE.Line(buildArcGeometry(), sunMatL);
    sunPathLine.frustumCulled=false; sunPathLine.renderOrder=4; sunPathLine.userData.R=ARC_R; scene.add(sunPathLine);
    const moonMatL=new THREE.LineBasicMaterial({color:0x9fb4e0,transparent:true,opacity:0,depthWrite:false,depthTest:false,fog:false});
    moonMatL.toneMapped=false;
    moonPathLine=new THREE.Line(buildArcGeometry(), moonMatL);
    // distinct renderOrder from the sun arc so the two translucent lines never
    // swap paint order (and flash) when they cross as the camera orbits.
    moonPathLine.frustumCulled=false; moonPathLine.renderOrder=3.5; moonPathLine.userData.R=ARC_R; scene.add(moonPathLine);
    // SOLSTICE reference arcs — the sun's highest (21 Jun) and lowest (21 Dec) daily
    // paths, faint, bracketing today's live arc. Show the whole seasonal swing of his sky.
    function solsticeArc(color){
      const m=new THREE.LineBasicMaterial({color,transparent:true,opacity:0,depthWrite:false,depthTest:false,fog:false}); m.toneMapped=false;
      const l=new THREE.Line(buildArcGeometry(), m); l.frustumCulled=false; l.renderOrder=3.2; l.userData.R=ARC_R; scene.add(l); return l;
    }
    summerArc=solsticeArc(0xe6b866); winterArc=solsticeArc(0x82a2d2);
    function arcLabel(sym,color){
      const cv=document.createElement('canvas'); cv.width=cv.height=64; const x=cv.getContext('2d');
      x.font='44px serif'; x.textAlign='center'; x.textBaseline='middle';
      x.lineWidth=5; x.strokeStyle='rgba(8,9,16,0.8)'; x.strokeText(sym,32,34); x.fillStyle=color; x.fillText(sym,32,34);
      const t=new THREE.CanvasTexture(cv); t.anisotropy=4;
      const sm=new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false,depthTest:false,fog:false}); sm.toneMapped=false;
      const sp=new THREE.Sprite(sm); sp.scale.set(BODY_R*0.04,BODY_R*0.04,1); sp.renderOrder=22; sp.frustumCulled=false; scene.add(sp); return sp;
    }
    summerLbl=arcLabel('☀','#f0c884'); winterLbl=arcLabel('❄','#a8c4ea');
    // ANALEMMA — the sun's figure-8 traced at the SAME clock time (08:30) across the
    // whole year: declination swing (tall axis) × equation-of-time wiggle. A signature
    // fixed-site artifact. Faint pale curve + a small ∞-ish label.
    const anaMat=new THREE.LineBasicMaterial({color:0xcfe0f0,transparent:true,opacity:0,depthWrite:false,depthTest:false,fog:false}); anaMat.toneMapped=false;
    analemmaLine=new THREE.Line(buildArcGeometry(), anaMat); analemmaLine.frustumCulled=false; analemmaLine.renderOrder=3.1; analemmaLine.userData.R=ARC_R; scene.add(analemmaLine);
    analemmaLbl=arcLabel('𝟾','#dbe8f6');
  }
  // fill `line`'s vertices with the body's path over [date 00:00 .. +24h], in
  // the camera-anchored dome frame. `fn` = (Date)->{dir:{x,y,z}} (Astro.sun/moon).
  function rebuildArc(line, fn, dayStartMs, camPos){
    const geo=line.geometry, N=geo.userData.N, R=line.userData.R, pos=geo.attributes.position.array;
    for(let i=0;i<=N;i++){
      const t=new Date(dayStartMs + (i/N)*86400000);
      const d=fn(t).dir;
      pos[i*3]  = d.x*R + camPos.x;
      pos[i*3+1]= d.y*R + camPos.y;
      pos[i*3+2]= d.z*R + camPos.z;
    }
    geo.attributes.position.needsUpdate=true;
    geo.computeBoundingSphere();
  }

  // ---- SATELLITES (ISS + bright LEO sats, SGP4 via Satellites/satellite.js) --
  // Each sat is a small bright point + soft glow on the BODY_R dome (same az/alt
  // → direction mapping the Moon/planets use), plus a thin polyline tracing its
  // current-or-next pass arc (horizon→peak→horizon). All anchored to the camera
  // so they sit at infinity. Visibility (sunlit sat + dark observer) brightens
  // genuinely-visible passes; otherwise we still render it while above horizon.
  let _satTex=null;
  function satTex(){
    if(_satTex) return _satTex;
    const s=64,c=document.createElement('canvas');c.width=c.height=s;const x=c.getContext('2d');
    const g=x.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
    g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.22,'rgba(255,255,255,1)');
    g.addColorStop(0.45,'rgba(255,255,255,0.5)'); g.addColorStop(0.8,'rgba(255,255,255,0.1)');
    g.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=g; x.beginPath(); x.arc(s/2,s/2,s/2,0,7); x.fill();
    _satTex=new THREE.CanvasTexture(c); return _satTex;
  }
  function makeSatellites(){
    satGroup=new THREE.Group(); scene.add(satGroup);
    satObjs=[];
    if(typeof Satellites==='undefined'){ return; }   // lib/module missing → skip gracefully
    Satellites.init();
    // Render objects (sprite/glow/arc) are attached lazily per satellite in
    // update() via ensureSatVisuals(), once Satellites.list is populated (it
    // seeds synchronously from the baked TLEs, then upgrades to live in place).
    // NOTE: the former floating bottom-left #satInfo panel (which overlapped and
    // hid the moon card) has been REMOVED. The satellite-pass info now lives in
    // the שמיים tab (panels.js), which reads SkyRig.satPasses() / window.__satPasses
    // — refreshed each frame in updateSatellites(). We keep only the lightweight
    // cursor hover-tip on the dot itself.
    // cursor-following hover tip for a satellite under the pointer (sky.js owns
    // this; app.js's hover reads notable[] which we deliberately do NOT pollute
    // with satellites — their tooltip template there would mis-render them).
    satTipEl=document.createElement('div');
    Object.assign(satTipEl.style,{position:'fixed',zIndex:'42',pointerEvents:'none',
      font:"500 12px/1.4 'Heebo',sans-serif",color:'#eaf2ff',direction:'rtl',
      background:'linear-gradient(rgba(14,20,40,0.96),rgba(10,14,30,0.96))',
      border:'1px solid rgba(150,180,235,0.4)',borderRadius:'9px',padding:'7px 10px',
      whiteSpace:'nowrap',opacity:'0',transition:'opacity .12s',transform:'translate(14px,14px)'});
    document.body.appendChild(satTipEl);
    if(renderer&&renderer.domElement){
      renderer.domElement.addEventListener('mousemove',onSatHover);
      renderer.domElement.addEventListener('mouseleave',()=>{ if(satTipEl) satTipEl.style.opacity='0'; });
    }
  }
  // lazily attach a sprite/glow/line to each satellite once SGP4 records exist
  function ensureSatVisuals(){
    const list=Satellites.list;
    if(satObjs.length>=list.length) return;
    for(let i=satObjs.length;i<list.length;i++){
      const meta=list[i];
      const m=new THREE.SpriteMaterial({map:satTex(),transparent:true,opacity:0,depthWrite:false,
        depthTest:false,blending:THREE.AdditiveBlending,fog:false,color:meta.color||0xffffff});
      m.toneMapped=false;
      const sp=new THREE.Sprite(m); sp.frustumCulled=false; sp.renderOrder=7; sp.scale.setScalar(13);
      const gm=new THREE.SpriteMaterial({map:glowTex(),transparent:true,opacity:0,depthWrite:false,
        depthTest:false,blending:THREE.AdditiveBlending,fog:false,color:meta.color||0xcdd9ff});
      const glow=new THREE.Sprite(gm); glow.frustumCulled=false; glow.renderOrder=6; glow.scale.setScalar(angScale(2.0,BODY_R,1));
      // trajectory polyline (its own buffer; sat pass arc)
      const lmat=new THREE.LineBasicMaterial({color:meta.color||0x9fd0ff,transparent:true,opacity:0,
        depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,fog:false});
      lmat.toneMapped=false;
      const N=64, lgeo=new THREE.BufferGeometry();
      lgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N+1)*3),3));
      lgeo.userData.N=N; lgeo.setDrawRange(0,0);
      const line=new THREE.Line(lgeo,lmat); line.frustumCulled=false; line.renderOrder=5;
      satGroup.add(sp); satGroup.add(glow); satGroup.add(line);
      satObjs.push({ meta, sprite:sp, glow, line, pass:null, passKey:'', screen:null, lastAlt:-90, vis:false });
    }
  }

  // ---- NOTABLE NAMED STARS (for hover info) ---------------------------------
  // The brightest stars visible from this latitude, with Hebrew name, magnitude,
  // constellation, and distance (light-years). RA/Dec match data/stars.json so
  // the hover marker lands exactly on the rendered star.
  const BRIGHT_STARS=[
    {he:'סיריוס',  en:'Sirius',     ra:6.7525, dec:-16.716, mag:-1.44, con:'הכלב הגדול', ly:8.6},
    {he:'קנופוס',  en:'Canopus',    ra:6.3992, dec:-52.696, mag:-0.62, con:'קרינה',      ly:310},
    {he:'ארקטורוס',en:'Arcturus',   ra:14.261, dec:19.182,  mag:-0.05, con:'רועה הדובים',ly:37},
    {he:'וגה',     en:'Vega',       ra:18.6156,dec:38.784,  mag:0.03,  con:'הנשר/הנבל',  ly:25},
    {he:'קאפלה',   en:'Capella',    ra:5.2782, dec:45.998,  mag:0.08,  con:'העגלון',     ly:43},
    {he:'ריגל',    en:'Rigel',      ra:5.2423, dec:-8.202,  mag:0.18,  con:'אוריון',     ly:860},
    {he:'פרוקיון', en:'Procyon',    ra:7.655,  dec:5.225,   mag:0.40,  con:'הכלב הקטן',  ly:11.5},
    {he:'בטלגז',   en:'Betelgeuse', ra:5.9195, dec:7.407,   mag:0.45,  con:'אוריון',     ly:640},
    {he:'אלטאיר',  en:'Altair',     ra:19.8464,dec:8.868,   mag:0.76,  con:'הנשר',       ly:17},
    {he:'אלדברן',  en:'Aldebaran',  ra:4.599,  dec:16.509,  mag:0.87,  con:'השור',       ly:65},
    {he:'אנטארס',  en:'Antares',    ra:16.490, dec:-26.432, mag:1.06,  con:'עקרב',       ly:550},
    {he:'ספיקה',   en:'Spica',      ra:13.420, dec:-11.161, mag:0.98,  con:'בתולה',      ly:250},
    {he:'דנב',     en:'Deneb',      ra:20.690, dec:45.280,  mag:1.25,  con:'הברבור',     ly:1400},
    {he:'פומלהאוט',en:'Fomalhaut',  ra:22.961, dec:-29.622, mag:1.16,  con:'הדג הדרומי', ly:25},
    {he:'רגולוס',  en:'Regulus',    ra:10.139, dec:11.967,  mag:1.35,  con:'אריה',       ly:79},
    {he:'פולוקס',  en:'Pollux',     ra:7.755,  dec:28.026,  mag:1.14,  con:'תאומים',     ly:34},
    {he:'פולאריס', en:'Polaris',    ra:2.530,  dec:89.264,  mag:1.98,  con:'הדוב הקטן',  ly:430}
  ];

  // project the `notable[]` world positions to screen pixels (CSS px). Sets each
  // entry's .screen = {x,y,vis}. Used by app.js for cursor-proximity hover info.
  const _projV=new THREE.Vector3();
  const _conV=new THREE.Vector3();   // scratch for rotating constellation label anchors
  function projectNotables(camera){
    const w=window.innerWidth, h=window.innerHeight;
    for(const o of notable){
      _projV.copy(o.wpos).project(camera);
      const inFront=_projV.z<1;
      o.screen={ x:(_projV.x*0.5+0.5)*w, y:(-_projV.y*0.5+0.5)*h, vis:inFront };
    }
  }
  // app.js hover layer reads this each mousemove
  function notables(){ return notable; }

  // ---- SATELLITE hover (sky.js-owned, separate from app.js's notable hover) --
  // Picks the nearest above-horizon satellite within a few px of the cursor and
  // shows its name + live alt/az + visibility. Kept out of notable[] so app.js's
  // star-shaped tooltip template can't mis-render a satellite.
  function fmtTime(ms){ const d=new Date(ms);
    return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0'); }
  function onSatHover(e){
    if(!satTipEl||!satObjs.length){ return; }
    const mx=e.clientX, my=e.clientY; let best=null, bestD=1e9;
    for(const s of satObjs){
      const sc=s.screen; if(!sc||!sc.vis||!s.sprite.visible) continue;
      const dx=sc.x-mx, dy=sc.y-my, d=Math.hypot(dx,dy);
      if(d<22 && d<bestD){ bestD=d; best=s; }
    }
    if(!best){ satTipEl.style.opacity='0'; return; }
    const m=best.meta, cur=best.cur;
    const visTxt = best.vis ? '<span style="color:#ffd27a">נראה לעין</span>' : 'בצל / יום';
    let h=`<div style="font-weight:700;color:#fff">${m.he} <span style="opacity:.6;font-weight:500">${m.short}</span></div>`;
    if(cur) h+=`<div style="opacity:.85">גובה ${Math.round(cur.altDeg)}° · ${Satellites.dirHe(cur.azDeg)} (${Math.round(cur.azDeg)}°)</div>`;
    h+=`<div style="opacity:.85">${visTxt}</div>`;
    satTipEl.innerHTML=h;
    const flipX=mx>window.innerWidth-220;
    satTipEl.style.left=mx+'px'; satTipEl.style.top=my+'px';
    satTipEl.style.transform=`translate(${flipX?'calc(-100% - 14px)':'14px'},14px)`;
    satTipEl.style.opacity='1';
  }

  // ---- SATELLITE per-frame driver -------------------------------------------
  // For the scrubbed `date`: propagate each sat, place its disc + glow on the
  // dome when above the horizon, (re)build its pass arc when the pass changes,
  // colour/brighten genuinely-visible passes, and refresh the on-screen label.
  const _satProjV=new THREE.Vector3();
  function passKeyFor(p){ return p? Math.round(p.rise/1000)+'_'+Math.round(p.set/1000) : ''; }
  function rebuildSatArc(s, camPos){
    const p=s.pass; if(!p||!p.samples.length){ s.line.geometry.setDrawRange(0,0); return; }
    const geo=s.line.geometry, N=geo.userData.N, pos=geo.attributes.position.array;
    const R=BODY_R*0.99, m=Math.min(p.samples.length, N+1);
    for(let i=0;i<m;i++){ const d=p.samples[i].dir;
      pos[i*3]=d.x*R+camPos.x; pos[i*3+1]=d.y*R+camPos.y; pos[i*3+2]=d.z*R+camPos.z; }
    geo.setDrawRange(0,m);
    geo.attributes.position.needsUpdate=true; geo.computeBoundingSphere();
  }
  function updateSatellites(date, camera, faintVis, sunAltDeg){
    if(typeof Satellites==='undefined' || !satGroup) return;
    ensureSatVisuals();
    // hard on/off from the layer toggle: a Group with .visible=false hides every
    // dot/glow/arc inside it regardless of their per-sat opacity logic below. We
    // still RUN the per-frame math (so pass info for the שמיים tab stays live even
    // when the dots are hidden), but the group flag keeps them off-screen.
    satGroup.visible = layerOn.satellites;
    if(!satObjs.length) return;
    const sunU=Astro.sunEciUnit?Astro.sunEciUnit(date):null;
    const observerDark = sunAltDeg < -4;     // civil-ish darkness for naked-eye sats
    // structured pass info for the שמיים tab (panels.js reads SkyRig.satPasses()).
    // One entry per sat with a known pass; updated with the scrubbed time.
    const passInfo=[];
    for(const s of satObjs){
      const rec=s.meta.satrec;
      const la = rec? Satellites.lookAngles(rec, date, sunU) : null;
      s.cur=la;
      // ----- recompute the current/next pass when ours has ended (or none yet) -----
      // A full search is ~2-3 ms (18h @ 30s SGP4 scan), so we DON'T redo it every
      // frame: only when the scrubbed time leaves the cached pass window AND has
      // moved ≥30 s since the last search (so continuous scrubbing or the live
      // clock's tiny dt steps don't rescan each frame). A null result is cached
      // the same way (sats with no pass in the window stay quiet, cheaply).
      const tMs=date.getTime();
      const outsideWindow = !s.pass || tMs > s.pass.set + 1000 || tMs < s.pass.rise - 1000;
      const movedEnough = s.lastSearchMs===undefined || Math.abs(tMs - s.lastSearchMs) > 30000;
      const camKey=Math.round(camera.position.x)+','+Math.round(camera.position.z);
      if(rec && (s.lastSearchMs===undefined || (outsideWindow && movedEnough))){
        s.pass=Satellites.nextPass(rec, date, sunU);
        s.passKey=passKeyFor(s.pass); s.lastSearchMs=tMs;
        rebuildSatArc(s, camera.position); s.arcCamKey=camKey;
      } else if(rec && s.pass && (s.arcCamKey!==camKey || s.arcKeyBuilt!==s.passKey)){
        // re-anchor the arc to the camera only when it actually moves (matches
        // the sun/moon daily-arc caching); the arc shape itself is pass-fixed.
        rebuildSatArc(s, camera.position); s.arcCamKey=camKey; s.arcKeyBuilt=s.passKey;
      }
      // ----- place the moving point on the dome (only while above horizon) -----
      const up = la && la.altDeg > 0;
      if(up){
        s.sprite.position.copy(new THREE.Vector3(la.dir.x,la.dir.y,la.dir.z)).multiplyScalar(BODY_R).add(camera.position);
        s.glow.position.copy(s.sprite.position);
        // genuinely naked-eye visible right now?  sunlit sat + dark observer + decently high
        const visNow = la.sunlit && observerDark && la.altDeg>5;
        s.vis=visNow;
        // brighter & larger when truly visible; otherwise a faint marker. Fade in
        // as the sat clears the horizon, and overall with the dark-sky factor so
        // it never blazes in daylight.
        const horiz=smooth(0,8,la.altDeg);
        const base = visNow ? 1.0 : 0.5;
        const op = base*horiz*clamp(faintVis+ (visNow?0.25:0), 0, 1);
        s.sprite.material.opacity=op;
        s.sprite.scale.setScalar(visNow?16:11);
        s.glow.material.opacity=op*(visNow?0.7:0.3);
        s.glow.scale.setScalar(angScale(visNow?2.6:1.6,BODY_R,1));
        s.sprite.visible=op>0.02; s.glow.visible=s.sprite.visible;
        // project to screen for sky.js's own hover
        _satProjV.copy(s.sprite.position).project(camera);
        s.screen={ x:(_satProjV.x*0.5+0.5)*window.innerWidth, y:(-_satProjV.y*0.5+0.5)*window.innerHeight, vis:_satProjV.z<1 };
      } else {
        s.sprite.visible=false; s.glow.visible=false; s.screen=null; s.vis=false;
      }
      // ----- trajectory arc opacity: show whenever a pass exists and sky is dark
      // enough; emphasise a genuinely-visible upcoming/current pass.
      if(s.line){
        const passVisible = s.pass && s.pass.anyVisible;
        const arcOp = clamp(faintVis,0,1) * (passVisible?0.55:0.22) * (s.pass?1:0);
        s.line.material.opacity=arcOp; s.line.visible=arcOp>0.02 && !!s.pass;
      }
      // ----- collect structured pass info for the שמיים tab (panels.js) -----
      if(s.pass){
        const m=s.meta, p=s.pass;
        passInfo.push({
          he:m.he, short:m.short,
          color:'#'+(m.color||0xffffff).toString(16).padStart(6,'0'),
          up,                                   // currently above the horizon?
          rise:p.rise, set:p.set,               // ms timestamps
          riseHM:fmtTime(p.rise),               // "HH:MM" (local time — date is local-aware)
          peakAz:p.peakAz, peakAzHe:Satellites.dirHe(p.peakAz),
          peakAlt:Math.round(p.peakAlt),
          visible:!!p.anyVisible,               // genuinely naked-eye at some point in the pass
          curAltDeg: s.cur? Math.round(s.cur.altDeg) : null,
          curAzDeg:  s.cur? Math.round(s.cur.azDeg)  : null,
          curAzHe:   s.cur? Satellites.dirHe(s.cur.azDeg) : null
        });
      }
    }
    // ----- publish pass info for panels.js (שמיים tab) -----
    // Sorted: currently-up first, then by soonest rise. Carries the TLE-source note.
    passInfo.sort((a,b)=> (b.up?1:0)-(a.up?1:0) || a.rise-b.rise);
    SAT_PASSES = passInfo;
    window.__satPasses = passInfo;
    window.__satEpochNote = (Satellites.epochNote?Satellites.epochNote():'');
  }

  let weather={cloud:0,rain:0,dust:0};
  function setWeather(w){ weather=w; }

  // ---- LAYER VISIBILITY (app.js toggle panel drives these) -------------------
  // Each key gates a family of sky objects via .visible. Because several objects
  // load asynchronously (conLines via fetch, milky is rebuilt after its fetch,
  // satellite sprites/arcs are created lazily in ensureSatVisuals), we keep the
  // DESIRED on/off state here and (a) apply it immediately to whatever exists,
  // and (b) re-apply it every frame in update() so late-loaded objects inherit it
  // and the per-frame opacity logic never silently re-shows a hidden layer.
  // (Opacity still controls fade with twilight; .visible is the hard on/off.)
  const layerOn={ constellations:true, milkyway:true, paths:true, satellites:true };
  function applyLayerVis(){
    // constellations: line figures + their labels
    if(conLines) conLines.visible = layerOn.constellations && conLineMat && conLineMat.opacity>0.02;
    if(conLabelGroup) conLabelGroup.visible = layerOn.constellations;
    // milky way band (a Points layer inside starGroup)
    if(milky) milky.visible = layerOn.milkyway;
    // sun & moon daily arcs
    if(sunPathLine) sunPathLine.visible = layerOn.paths && sunPathLine.material.opacity>0.02;
    if(moonPathLine) moonPathLine.visible = layerOn.paths && moonPathLine.material.opacity>0.02;
    // satellites: the whole group (dots, glows, pass arcs)
    if(satGroup) satGroup.visible = layerOn.satellites;
  }
  // public: SkyRig.setLayer('constellations'|'milkyway'|'paths'|'satellites', on)
  function setLayer(name, on){
    if(!(name in layerOn)) return;
    layerOn[name]=!!on;
    applyLayerVis();
  }

  function update(date, camera, dt){
    const S=Astro.sun(date), Mo=Astro.moon(date);
    const realAlt=S.altDeg;
    // night-view override: pretend the sun is well below the horizon so every downstream
    // day/night cue (sky shader, stars, ambient, sun/moon visibility) darkens and reveals
    // the stars — even in daytime. Does NOT change the clock or Astro positions.
    const altDeg = nightViewOn ? -15 : realAlt;
    const dayF=smooth(-6,6,altDeg);          // 0 night .. 1 day
    const nightF=1-dayF;
    const goldF=smooth(0,14,altDeg)*(1-smooth(14,30,altDeg)); // warm low-sun
    // how strongly faint sky objects (stars/planets/arcs) read right now: 0 in
    // daylight → 1 in deep night. Shared so everything fades together at dusk.
    const faintVis=smooth(2,-9,altDeg);
    notable.length=0;                        // rebuilt fresh each frame for hover info

    // ---- sun (light + VISIBLE disc) ----
    const sd=new THREE.Vector3(S.dir.x,S.dir.y,S.dir.z);
    sunLight.position.copy(sd).multiplyScalar(150);
    const sunUp=clamp(Math.sin(S.alt),0,1);
    const cloudCut=1-weather.cloud*0.7;
    sunLight.intensity=(0.2+3.0*sunUp)*dayF*cloudCut;
    sunLight.color.copy(lerpCol(0xffffff,0xffb066, goldF*0.9));
    sunLight.castShadow = dayF>0.15;
    // visible sun disc + halo on the dome, anchored to the camera so it sits at infinity
    if(sunMesh){
      sunMesh.position.copy(sd).multiplyScalar(BODY_R).add(camera.position);
      sunGlow.position.copy(sunMesh.position);
      // size to the Sun's REAL apparent diameter this instant (~0.524–0.542°,
      // breathing with the Earth–Sun distance over the year).
      const sunAng = (S.angDiamDeg||SUN_ANG_DEG);
      sunMesh.scale.setScalar(angScale(sunAng, BODY_R, SUN_DISC_FILL));
      // visible whenever the sun is up (or just below, for the afterglow); reddens low.
      const sunVis=smooth(-2.5, 1.5, altDeg);
      sunMat.opacity=sunVis; sunMesh.visible=sunVis>0.01;
      sunMat.color.copy(lerpCol(0xfff6e0, 0xff9a4e, goldF));     // warm/red near horizon
      // halo grows + reddens at low sun, dimmed by cloud/dust
      sunGlow.material.opacity=sunVis*lerp(0.35,0.8,goldF)*cloudCut;
      sunGlow.material.color.copy(lerpCol(0xffd9a0,0xff7e3c,goldF));
      sunGlow.scale.setScalar(angScale(lerp(3.0,6.0,goldF),BODY_R,1));
      sunGlow.visible=sunMesh.visible;
      if(sunMesh.visible) notable.push({kind:'sun',name:'השמש',wpos:sunMesh.position.clone(),
        alt:S.altDeg, az:S.azDeg, pick:Math.max(angScale(sunAng,BODY_R,1),14)});
    }

    // ---- sky shader ----
    const u=sky.material.uniforms;
    u.sunPosition.value.copy(sd);
    u.turbidity.value=lerp(3, 10, weather.cloud) + weather.dust*8;
    u.rayleigh.value=lerp(0.18, 3.0, dayF) * (1-weather.dust*0.4);  // very low at night → dark zenith for stars
    u.mieCoefficient.value=lerp(0.003,0.02, weather.cloud+weather.dust);
    // at deep night the dark dome takes over; hide the (still-luminous) Sky
    // shader so it can't wash out the starfield. Crossfades around twilight.
    sky.visible = altDeg > -8;

    // ---- moon (light + VISIBLE sphere at true phase) ----
    const md=new THREE.Vector3(Mo.dir.x,Mo.dir.y,Mo.dir.z);
    moonLight.position.copy(md).multiplyScalar(150);
    const moonUp=clamp(Math.sin(Mo.alt),0,1);
    moonLight.intensity=0.5*moonUp*nightF*Mo.illum*cloudCut;
    moonLight.castShadow = nightF>0.6 && moonUp>0.1;
    moonMesh.position.copy(md).multiplyScalar(BODY_R).add(camera.position);
    moonMesh.userData.glow.position.copy(moonMesh.position);
    // size to the Moon's REAL apparent diameter this instant (0.49–0.55°)
    moonMesh.scale.setScalar(angScale(Mo.angDiamDeg, BODY_R, MOON_DISC_FILL));
    // the Moon is visible day OR night when above the horizon; just brighter at night
    const moonVis=smooth(-1.5,2.5,Mo.altDeg)*lerp(0.35,1.0,nightF);
    moonMat.opacity=moonVis; moonMesh.userData.glow.material.opacity=moonVis*0.5*Mo.illum*nightF;
    moonMesh.visible=moonVis>0.01; moonMesh.userData.glow.visible=moonMesh.visible;
    if(moonMesh.visible) notable.push({kind:'moon',name:'הירח',wpos:moonMesh.position.clone(),
      phase:Mo.name, illum:Mo.illum, alt:Mo.altDeg, az:Mo.azDeg,
      pick:angScale(Math.max(Mo.angDiamDeg,1.0),BODY_R,1)});
    // orient the bright limb toward the Sun: position angle of the sun relative
    // to the moon, measured in the screen plane (atan2 of the sky-direction delta).
    const toSun=new THREE.Vector3(S.dir.x,S.dir.y,S.dir.z).sub(md);
    // project onto the local screen axes of the dome point (right=east-ish, up=+y)
    const right=new THREE.Vector3(md.z,0,-md.x); if(right.lengthSq()<1e-6) right.set(1,0,0); right.normalize();
    const up=new THREE.Vector3().crossVectors(md,right).normalize();
    const pa=Math.atan2(toSun.dot(right), toSun.dot(up)); // bright-limb angle in sprite plane
    moonMat.rotation = pa;
    const pk=Mo.frac.toFixed(3)+Mo.waxing;
    if(pk!==lastPhaseKey){ moonMat.map=moonTexture(Mo.illum,Mo.frac); moonMat.needsUpdate=true; lastPhaseKey=pk; }

    // ---- ambient / hemisphere ----
    hemi.intensity=lerp(0.12,0.7,dayF)*cloudCut + 0.02;
    hemi.color.copy(lerpCol(0x24345e, 0xbcd2ff, dayF));
    hemi.groundColor.copy(lerpCol(0x1a1408, 0xb98a5a, dayF));
    ambient.intensity=lerp(0.16,0.0,dayF) + moonUp*nightF*0.06;
    ambient.color.copy(lerpCol(0x2a3358,0x404a6b,dayF));

    // ---- stars (REAL catalog, rotated by local sidereal time) ----
    // Bortle-3: bright, crisp, and fully present once the sun is well down;
    // fade in through twilight, out at sunrise (tied to sun altitude).
    const starOp=smooth(2,-9,altDeg);   // 0 by day → 1 in deep night
    if(starGroup){
      starGroup.position.copy(camera.position);
      // R(LST,lat): world = M·Rz(LST)·q  (derived + verified against Astro.eqToHorizon)
      //   row0 (E)  = [-sin t,        cos t,        0   ]
      //   row1 (up) = [ cosφ·cos t,   cosφ·sin t,   sinφ]
      //   row2 (S)  = [ sinφ·cos t,   sinφ·sin t,  -cosφ]
      const t=Astro.lstRad(date), ct=Math.cos(t), st_=Math.sin(t);
      const phi=Astro.LAT*Math.PI/180, cph=Math.cos(phi), sph=Math.sin(phi);
      // THREE.Matrix4.set is ROW-major in args; we set the rotation 3x3.
      if(!starGroup.userData.M) starGroup.userData.M=new THREE.Matrix4();
      const M=starGroup.userData.M;
      M.set( -st_,      ct,      0,   0,
              cph*ct,   cph*st_, sph, 0,
              sph*ct,   sph*st_,-cph, 0,
              0,        0,       0,   1 );
      starGroup.setRotationFromMatrix(M);
      // twinkle (subtle scale shimmer) + per-layer brightness
      const tw=0.92+0.08*Math.sin(performance.now()*0.0016);
      starGroup.userData.layers.forEach((p,i)=>{
        const u=p.material.uniforms; if(!u) return;
        // Milky Way: a SUBTLE soft glow band, not a bright field. The boosted
        // 0.95·starOp version looked like extra phosphorescent stars; the band now
        // uses the soft pink buildMilky() material, so we also drop the global
        // multiplier to ~0.40·starOp — clearly present ("that's the Milky Way") yet
        // never competing with the real stars. No twinkle scale (uScale=1) so the
        // band stays a steady glow rather than shimmering like point stars; still
        // gated by starOp so it fades in/out with the stars at twilight.
        if(p===milky){ u.uOpacity.value=starOp*0.40; u.uScale.value=1; p.visible=layerOn.milkyway; }
        else { u.uOpacity.value=starOp; u.uScale.value=tw; }
      });

      // ---- CONSTELLATION FIGURES + LABELS ----------------------------------
      // The lines sit inside starGroup, so they already share the sidereal
      // rotation just applied to M. Fade them with the stars (a touch fainter)
      // and only when the sky is dark enough to read them. Labels are billboard
      // sprites positioned by rotating each baked centroid by M; only those
      // above the horizon show.
      if(conLineMat) conLineMat.opacity = starOp*0.42;
      // gate by the layer toggle (layerOn.constellations) as well as the twilight
      // fade, so the toggle panel can hard-hide the figures + labels.
      if(conLines) conLines.visible = layerOn.constellations && conLineMat.opacity>0.02;
      // keep the label group's hard on/off in lockstep with the toggle every frame
      // (a Group with .visible=false hides all children regardless of their own flag)
      if(conLabelGroup) conLabelGroup.visible = layerOn.constellations;
      if(conLabels.length && layerOn.constellations){
        const M=starGroup.userData.M, labOp=starOp*0.85;
        for(const L of conLabels){
          // rotate the equatorial centroid into the current world frame
          _conV.copy(L.local).applyMatrix4(M);
          // local-frame up component (after rotation) is the y axis → altitude sign
          const aboveHorizon = _conV.y > STAR_R*0.045;   // ~2.6° above the horizon
          L.sprite.visible = aboveHorizon && labOp>0.03;
          L.sprite.material.opacity = aboveHorizon ? labOp : 0;
          if(L.sprite.visible){
            L.sprite.position.copy(_conV).add(camera.position);
            // Register the figure for hover info. app.js now has a 'constellation'
            // case in its tooltip builder (Hebrew + Latin name, NO star-only .mag),
            // so hovering a figure names it like the bright stars already do.
            // alt/az from the rotated world vector (+x=E, +z=S, +y=up):
            //   alt = asin(y/R);  az from N clockwise = atan2(x, −z).
            const altR=Math.asin(clamp(_conV.y/STAR_R,-1,1));
            const azR=Math.atan2(_conV.x, -_conV.z);
            notable.push({ kind:'constellation', name:L.he, en:L.la,
              alt:altR*180/Math.PI, az:((azR*180/Math.PI)%360+360)%360,
              wpos:L.sprite.position.clone(), pick:48 });
          }
        }
      }
    } else if(conLines){ conLines.visible=false; }

    // ---- PLANETS (real geocentric positions, brightness from magnitude) ----
    // Fade in with the stars at dusk; size & opacity scale with apparent mag, so
    // Venus blazes and Saturn is a modest point. Each above-horizon planet is
    // also registered for hover info.
    if(planetGroup && Astro.planets){
      const P=Astro.planets(date);
      planetSprites.forEach(sp=>{
        const p=P.find(q=>q.name===sp.userData.name); if(!p){ sp.visible=false; return; }
        const pd=new THREE.Vector3(p.dir.x,p.dir.y,p.dir.z);
        sp.position.copy(pd).multiplyScalar(BODY_R).add(camera.position);
        // visible only above the horizon and once the sky is dark enough; bright
        // planets (Venus/Jupiter) survive a bit longer into twilight.
        const upF=smooth(-0.5,2.0,p.altDeg);
        const magBoost=clamp((1.5-p.mag)/6,0,1);             // 0 (faint) .. ~1 (Venus)
        const dusk=smooth(4,-7,altDeg) + magBoost*smooth(2,-2,altDeg)*0.4;
        const vis=clamp(upF*dusk,0,1)*cloudCut;
        sp.material.opacity=vis; sp.visible=vis>0.02;
        sp.scale.setScalar(planetSize(p.mag));
        sp.material.color.copy(new THREE.Color(p.color).multiplyScalar(lerp(0.9,1.25,magBoost)));
        if(sp.visible) notable.push({kind:'planet',name:p.he,en:p.name,fact:p.fact,
          mag:p.mag,alt:p.altDeg,az:p.azDeg,wpos:sp.position.clone(),
          pick:Math.max(planetSize(p.mag),14)});
      });
    }

    // ---- SUN & MOON DAILY ARCS ---------------------------------------------
    // Rebuild the polyline only when the calendar day changes (expensive: 240
    // Astro evals); reposition relative to the camera every frame so it stays
    // anchored at infinity. Fades with daylight like the rest of the sky marks.
    if(sunPathLine){
      const dayStart=new Date(date); dayStart.setHours(0,0,0,0);
      const key=dayStart.getFullYear()+'-'+dayStart.getMonth()+'-'+dayStart.getDate()+'|'+Math.round(camera.position.x)+','+Math.round(camera.position.z);
      // PERF: each rebuildArc is ~240 Astro evals. Skip it when the paths layer is OFF
      // (the arc is invisible anyway) OR while the time machine is actively PLAYING — the
      // reference arc can freeze; the sun + shadows keep animating smoothly. It rebuilds the
      // moment it next becomes visible / play stops (the key will differ → rebuild fires).
      const _skipArc = !layerOn.paths || (typeof document!=='undefined' && document.documentElement && document.documentElement.dataset.tplay==='1');
      if(!_skipArc && key!==lastPathKey){ rebuildArc(sunPathLine, Astro.sun, dayStart.getTime(), camera.position); lastPathKey=key; }
      // arc reads against a bright daytime sky AND the dark night — strongest at
      // twilight when it's both visible and meaningful; gentle the rest of the time.
      sunPathLine.material.opacity=lerp(0.16,0.5,goldF)+0.12*dayF;
      // gate by the layer toggle (layerOn.paths) on top of the day/twilight fade.
      sunPathLine.visible=layerOn.paths && sunPathLine.material.opacity>0.02;
      if(Astro.moon){
        const mkey=key+'m';
        if(!_skipArc && mkey!==lastMoonPathKey){ rebuildArc(moonPathLine, Astro.moon, dayStart.getTime(), camera.position); lastMoonPathKey=mkey; }
        moonPathLine.material.opacity=faintVis*0.28;
        moonPathLine.visible=layerOn.paths && moonPathLine.material.opacity>0.02;
      }
      // solstice reference arcs (fixed dates) — rebuild only when the camera moves.
      if(summerArc){
        const camKey=Math.round(camera.position.x)+','+Math.round(camera.position.z);
        if(camKey!==lastSolKey){
          const y=date.getFullYear();
          rebuildArc(summerArc, Astro.sun, new Date(y,5,21,0,0,0,0).getTime(), camera.position);
          rebuildArc(winterArc, Astro.sun, new Date(y,11,21,0,0,0,0).getTime(), camera.position);
          const place=(sp,mo)=>{ const d=Astro.sun(new Date(y,mo,21,12,0,0,0)).dir, R=summerArc.userData.R;
            sp.position.set(d.x*R+camera.position.x, d.y*R+camera.position.y, d.z*R+camera.position.z); };
          place(summerLbl,5); place(winterLbl,11);
          lastSolKey=camKey;
        }
        const sop=layerOn.paths ? lerp(0.34,0.18,dayF) : 0;     // visible reference, gentler by day
        summerArc.material.opacity=sop; winterArc.material.opacity=sop;
        const sv=layerOn.paths && sop>0.02;
        summerArc.visible=winterArc.visible=summerLbl.visible=winterLbl.visible=sv;
        // analemma — the sun's figure-8 at a fixed 08:30 across the year (rebuilt on camera move)
        if(analemmaLine){
          if(camKey!==lastSolKey || analemmaLine.userData._k==null){
            const y=date.getFullYear(), geo=analemmaLine.geometry, N=geo.userData.N, R=analemmaLine.userData.R, pos=geo.attributes.position.array;
            for(let i=0;i<=N;i++){ const t=new Date(y,0,1,8,30,0,0); t.setDate(t.getDate()+Math.round(i/N*365));
              const d=Astro.sun(t).dir; pos[i*3]=d.x*R+camera.position.x; pos[i*3+1]=d.y*R+camera.position.y; pos[i*3+2]=d.z*R+camera.position.z; }
            geo.attributes.position.needsUpdate=true; geo.computeBoundingSphere();
            const lt=new Date(y,5,21,8,30,0,0), ld=Astro.sun(lt).dir;       // label near the top of the loop
            analemmaLbl.position.set(ld.x*R+camera.position.x, ld.y*R+camera.position.y, ld.z*R+camera.position.z);
            analemmaLine.userData._k=camKey;
          }
          analemmaLine.material.opacity = layerOn.paths ? lerp(0.5,0.22,dayF) : 0;   // pale figure-8, brightest at night
          analemmaLine.visible=analemmaLbl.visible=sv;
        }
      }
    }

    // ---- SATELLITES (ISS + bright LEO, SGP4 from current TLEs) --------------
    // Propagated to the scrubbed date/time; placed on the dome above horizon,
    // with a pass-arc trajectory and naked-eye visibility emphasis.
    updateSatellites(date, camera, faintVis, altDeg);

    // ---- NOTABLE STARS (brightest named, currently above the horizon) -------
    // Registered for hover info; the field itself is the real starfield above.
    if(faintVis>0.05 && Astro.eqToHorizon){
      for(const st of BRIGHT_STARS){
        const h=Astro.eqToHorizon(st.ra, st.dec, date);
        if(h.altDeg<3) continue;
        const wp=new THREE.Vector3(h.dir.x,h.dir.y,h.dir.z).multiplyScalar(BODY_R).add(camera.position);
        notable.push({kind:'star',name:st.he,en:st.en,mag:st.mag,con:st.con,ly:st.ly,
          alt:h.altDeg,az:h.azDeg,wpos:wp,pick:14});
      }
    }

    // project every notable object to screen pixels for the hover tooltip (app.js
    // reads SkyRig.notables()). vis=false when behind the camera.
    projectNotables(camera);

    // ---- night dome + fog ----
    if(nightDome){ nightDome.position.copy(camera.position); domeMat.opacity=smooth(3,-7,altDeg); }
    // ---- drifting clouds: anchored to camera, opacity from live weather, fade at night ----
    if(cloudGroup){
      cloudGroup.position.copy(camera.position);
      _cloudPhase += (dt||0)*0.006;                              // slow drift across the sky
      const cov=Math.min(1, 0.12 + 0.95*(weather.cloud||0));     // faint baseline + live cover
      const op=cov*dayF*0.55;                                    // fade out at night; keep soft
      cloudGroup.children.forEach(sp=>{
        const u=sp.userData, az=u.az+_cloudPhase, ce=Math.cos(u.el);
        sp.position.set(Math.sin(az)*ce*u.R, Math.sin(u.el)*u.R, -Math.cos(az)*ce*u.R);
        sp.material.opacity=op*u.dim;
      });
    }
    const fogDay=lerpCol(0xcdbf9b,0xb9c6da,0.4), fogNight=new THREE.Color(0x0e1430);
    scene.fog.color.copy(fogDay.clone().lerp(fogNight,nightF));
    if(goldF>0.1) scene.fog.color.lerp(new THREE.Color(0xe0a070),goldF*0.5);
    if(weather.dust>0.05) scene.fog.color.lerp(new THREE.Color(0xc89a5e), weather.dust*0.75);
    scene.fog.density=0.00012 + weather.dust*0.0011 + weather.rain*0.0006 + nightF*0.00007;
    renderer.toneMappingExposure=lerp(0.42,0.52,nightF);

    // ---- interior warmth ----
    const warm=smooth(8,-6,altDeg);
    ilights.forEach(L=>L.intensity=warm*1.6*(0.8+0.2*Math.sin(performance.now()*0.003+L.position.x)));
    glass.forEach(p=>{ p.material.emissive=p.material.emissive||new THREE.Color();
      p.material.emissive.setHex(0xffb765); p.material.emissiveIntensity=warm*1.1;
      p.material.opacity=lerp(0.62,0.9,warm); });

    // report the REAL day/night to callers (clock UI, yard shade) — not the override
    return { S, Mo, dayF: smooth(-6,6,realAlt), altDeg: realAlt };
  }

  // satellite next-pass info for panels.js (שמיים tab); also on window.__satPasses
  function satPasses(){ return SAT_PASSES; }
  return { init, update, setWeather, notables, satPasses, setLayer,
    // "darken sky / show stars" override for the שמיים tab (reversible; no clock change)
    setNightView:function(b){ nightViewOn=!!b; }, isNightView:function(){ return nightViewOn; } };
})();
window.SkyRig = SkyRig;
