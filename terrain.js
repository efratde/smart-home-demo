/* ===================================================================
   terrain.js — the REAL ground of Larkmont, built from geodata.
   heightmap.png  → vertex displacement (white 913 m … black 537 m)
   satellite.png  → draped colour texture (1:1, north = up)
   buildings.png  → ~620 real footprints extruded as town massing
   World frame: +x = east, +y = up, +z = SOUTH. Extent 4.0 km × 3.9 km.
   =================================================================== */
const Terrain = (function(){
  const EX=4000, EZ=3900;        // metres E–W, N–S
  const EXAG=1.15;               // gentle legibility exaggeration (≤1.25)
  const MINEL=537, REL=376;      // black→537 m, relief 376 m
  let hm,hmW,hmH,centerElev=0;

  function grayAt(px,py){ px=px<0?0:px>hmW-1?hmW-1:px|0; py=py<0?0:py>hmH-1?hmH-1:py|0;
    return hm[(py*hmW+px)*4]; }
  function elev(px,py){ return MINEL + grayAt(px,py)/255*REL; }
  // bilinear sample in world space (north = -z → image top)
  function sampleHeight(x,z){
    const u=x/EX+0.5, v=z/EZ+0.5;
    const fx=Math.max(0,Math.min(hmW-1,u*hmW)), fy=Math.max(0,Math.min(hmH-1,v*hmH));
    const x0=fx|0,y0=fy|0,x1=Math.min(hmW-1,x0+1),y1=Math.min(hmH-1,y0+1),tx=fx-x0,ty=fy-y0;
    const e=(elev(x0,y0)*(1-tx)+elev(x1,y0)*tx)*(1-ty)+(elev(x0,y1)*(1-tx)+elev(x1,y1)*tx)*ty;
    return (e-centerElev)*EXAG;
  }

  // sample the REAL roof colour from the aerials so buildings read as themselves, not white boxes
  let cenD,cenW,cenH,satD,satW,satH; const CEN=526, SAT=4000;
  function imgData(src){ return new Promise(res=>{ const im=new Image(); im.crossOrigin='anonymous';
    im.onload=()=>{ const c=document.createElement('canvas'); c.width=im.width;c.height=im.height; const x=c.getContext('2d'); x.drawImage(im,0,0);
      res({d:x.getImageData(0,0,im.width,im.height).data,w:im.width,h:im.height}); }; im.onerror=()=>res(null); im.src=src; }); }
  function sampleColor(wx,wz,col){
    let d,w,h,u,v;
    if(cenD && Math.abs(wx)<=CEN/2 && Math.abs(wz)<=CEN/2){ d=cenD;w=cenW;h=cenH; u=(wx+CEN/2)/CEN; v=(wz+CEN/2)/CEN; }
    else if(satD){ d=satD;w=satW;h=satH; u=(wx+SAT/2)/SAT; v=(wz+SAT/2)/SAT; }
    else { col.setRGB(0.62,0.56,0.46); return col; }
    const px=Math.max(0,Math.min(w-1,u*w|0)), py=Math.max(0,Math.min(h-1,v*h|0)), i=(py*w+px)*4;
    const g=x=>Math.min(1,Math.pow(x/255,2.2)*1.25);          // sRGB→linear, lifted a touch
    col.setRGB(g(d[i]),g(d[i+1]),g(d[i+2])); return col;
  }
  function load(scene,M,onReady){
    const img=new Image();
    img.onload=async ()=>{
      const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
      const x=c.getContext('2d'); x.drawImage(img,0,0);
      hm=x.getImageData(0,0,img.width,img.height).data; hmW=img.width; hmH=img.height;
      centerElev=elev(hmW/2,hmH/2);
      const a=await imgData('geo/central.png'); if(a){cenD=a.d;cenW=a.w;cenH=a.h;}
      const b=await imgData('geo/satellite.png'); if(b){satD=b.d;satW=b.w;satH=b.h;}
      buildTerrain(scene,M);
      buildCentralPatch(scene,M);
      // buildHomeBlock removed per the developer's cleanup — it was a STOPGAP semi-transparent
      // "5-unit block" massing that read as translucent panels floating around the house.
      // The neighbourhood is conveyed by the high-res aerial drape (central patch) instead.
      buildTown(scene,M,()=>{ onReady(sampleHeight); });
    };
    img.onerror=()=>{ console.error('heightmap load failed'); onReady(sampleHeight); };
    img.src='geo/heightmap.png';
  }

  function buildTerrain(scene,M){
    const seg=250;
    const g=new THREE.PlaneGeometry(EX,EZ,seg,seg);
    g.rotateX(-Math.PI/2);                 // lie flat; +z = south
    const pos=g.attributes.position;
    for(let i=0;i<pos.count;i++) pos.setY(i, sampleHeight(pos.getX(i),pos.getZ(i)));
    g.computeVertexNormals();
    const tex=new THREE.TextureLoader().load('geo/satellite.png');
    tex.anisotropy=8; tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;
    if('SRGBColorSpace' in THREE) tex.colorSpace=THREE.SRGBColorSpace; else tex.encoding=THREE.sRGBEncoding;
    const mat=new THREE.MeshStandardMaterial({ map:tex, roughness:1, metalness:0 });
    const mesh=new THREE.Mesh(g,mat); mesh.receiveShadow=true; mesh.name='terrain';
    scene.add(mesh);
    return mesh;
  }

  function buildTown(scene,M,done){
    const img=new Image();
    img.onload=()=>{
      const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
      const ctx=c.getContext('2d'); ctx.drawImage(img,0,0);
      const W=img.width,H=img.height,d=ctx.getImageData(0,0,W,H).data;
      const mask=new Uint8Array(W*H);
      for(let p=0;p<W*H;p++){ if(d[p*4+3]>60 && d[p*4+2]<195) mask[p]=1; }   // footprint = opaque, low-blue
      // connected components (8-connectivity)
      const seen=new Uint8Array(W*H), st=[], blobs=[];
      for(let p0=0;p0<W*H;p0++){
        if(!mask[p0]||seen[p0]) continue;
        st.length=0; st.push(p0); seen[p0]=1;
        let minx=W,maxx=0,miny=H,maxy=0,sx=0,sy=0,cnt=0;
        while(st.length){
          const p=st.pop(), px=p%W, py=(p/W)|0;
          if(px<minx)minx=px; if(px>maxx)maxx=px; if(py<miny)miny=py; if(py>maxy)maxy=py;
          sx+=px; sy+=py; cnt++;
          for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
            if(!dx&&!dy)continue; const nx=px+dx,ny=py+dy;
            if(nx<0||ny<0||nx>=W||ny>=H)continue; const np=ny*W+nx;
            if(mask[np]&&!seen[np]){ seen[np]=1; st.push(np); }
          }
        }
        if(cnt>=4) blobs.push({minx,maxx,miny,maxy,cx:sx/cnt,cy:sy/cnt});
      }
      const geo=new THREE.BoxGeometry(1,1,1);
      const mat=new THREE.MeshStandardMaterial({ roughness:0.96, metalness:0 });   // opaque, real roof colours per-instance
      const inst=new THREE.InstancedMesh(geo,mat,blobs.length);
      inst.castShadow=true; inst.receiveShadow=true; inst.name='town';
      const m4=new THREE.Matrix4(), col=new THREE.Color(); let k=0;
      for(const b of blobs){
        const wx=(b.cx/W-0.5)*EX, wz=(b.cy/H-0.5)*EZ;
        // skip ONLY the footprint the detailed house stands on (his own building); render every real neighbour so he's embedded, not isolated
        const bxn=(b.minx/W-0.5)*EX, bxx=(b.maxx/W-0.5)*EX, bzn=(b.miny/H-0.5)*EZ, bzx=(b.maxy/H-0.5)*EZ;
        if(bxn<=7 && bxx>=-7 && bzn<=7 && bzx>=-7) continue;
        let ww=Math.min(70,Math.max(4,(b.maxx-b.minx+1)/W*EX));
        let dd=Math.min(70,Math.max(4,(b.maxy-b.miny+1)/H*EZ));
        const hh=5.5+Math.random()*2.6;
        const base=sampleHeight(wx,wz);
        m4.makeScale(ww,hh,dd); m4.setPosition(wx, base+hh/2-1.2, wz);
        inst.setMatrixAt(k,m4);
        sampleColor(wx,wz,col); inst.setColorAt(k,col);   // real colour from the aerial
        k++;
      }
      inst.count=k; inst.instanceMatrix.needsUpdate=true;
      if(inst.instanceColor) inst.instanceColor.needsUpdate=true;
      /* generic extruded boxes read as 'Sims/Roblox' and OSM misses most houses —
         show the whole real neighbourhood via the high-res aerial drape instead, not boxes */
      // scene.add(inst);
      done&&done();
    };
    img.onerror=()=>{ console.error('buildings load failed'); done&&done(); };
    img.src='geo/buildings.png';
  }

  // crisp sub-metre aerial (0.5 m/px, 526 m centred on the house) draped just over the
  // central area, blending into the coarse 4 km terrain beyond.
  function buildCentralPatch(scene,M){
    const SZ=1050, seg=220;
    const g=new THREE.PlaneGeometry(SZ,SZ,seg,seg); g.rotateX(-Math.PI/2);
    const pos=g.attributes.position;
    for(let i=0;i<pos.count;i++) pos.setY(i, sampleHeight(pos.getX(i),pos.getZ(i))+0.2);
    g.computeVertexNormals();
    const tex=new THREE.TextureLoader().load('geo/central_wide.png');
    tex.anisotropy=16; tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;
    if('SRGBColorSpace' in THREE) tex.colorSpace=THREE.SRGBColorSpace; else tex.encoding=THREE.sRGBEncoding;
    const mat=new THREE.MeshStandardMaterial({ map:tex, roughness:1, metalness:0,
      polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2 });
    const mesh=new THREE.Mesh(g,mat); mesh.receiveShadow=true; mesh.name='central'; scene.add(mesh);
  }

  // his real building = the OSM footprint that contains the house point — render the
  // WHOLE thing as attached massing (the 5-unit row) so the detailed unit sits inside it,
  // not alone. (uses the precise geojson, not the rasterised town image.)
  function buildHomeBlock(scene,M){
    fetch('data/terrain/buildings.geojson').then(r=>r.json()).then(gj=>{
      const LAT0=34.0000, LON0=-40.0000, MLON=111320*Math.cos(LAT0*Math.PI/180), MLAT=110540;
      let best=null, bestArea=1e18;
      for(const f of (gj.features||[])){
        const ring=f.geometry&&f.geometry.coordinates&&f.geometry.coordinates[0]; if(!ring||ring.length<3) continue;
        let mnx=1e9,mxx=-1e9,mnz=1e9,mxz=-1e9; const pts=[];
        for(const [lo,la] of ring){ const x=(lo-LON0)*MLON, z=-(la-LAT0)*MLAT; pts.push([x,z]); mnx=Math.min(mnx,x);mxx=Math.max(mxx,x);mnz=Math.min(mnz,z);mxz=Math.max(mxz,z); }
        if(mnx<=2&&mxx>=-2&&mnz<=2&&mxz>=-2){ const a=(mxx-mnx)*(mxz-mnz); if(a<bestArea){ bestArea=a; best={pts,cx:(mnx+mxx)/2,cz:(mnz+mxz)/2}; } }
      }
      if(!best){ console.warn('home block: no footprint over the house'); return; }
      const sh=new THREE.Shape();
      best.pts.forEach(([x,z],i)=>{ const e=x,n=-z; i?sh.lineTo(e,n):sh.moveTo(e,n); });
      // notch where his detailed unit stands → the massing FLANKS it, not buries it
      const hole=new THREE.Path(); const hw=6.5, hd=7.5;
      hole.moveTo(hw,hd); hole.lineTo(hw,-hd); hole.lineTo(-hw,-hd); hole.lineTo(-hw,hd); hole.closePath();
      sh.holes.push(hole);
      const eg=new THREE.ExtrudeGeometry(sh,{depth:6.0,bevelEnabled:false}); eg.rotateX(-Math.PI/2);
      eg.translate(0, sampleHeight(best.cx,best.cz)-0.2, 0);
      const col=new THREE.Color(); sampleColor(best.cx,best.cz,col);
      // STOPGAP: the 5-unit block was an opaque tan mass that buried the
      // detailed house. Make it semi-transparent + non-occluding so the
      // house reads through it. (depthWrite:false → it won't write the
      // depth buffer and hide the cottage behind it.)
      const mat=new THREE.MeshStandardMaterial({color:col, roughness:0.95, metalness:0,
        transparent:true, opacity:0.45, depthWrite:false});
      const m=new THREE.Mesh(eg,mat); m.receiveShadow=true; m.castShadow=true; m.name='homeblock';
      scene.add(m);
    }).catch(e=>console.error('homeblock',e));
  }

  return { load, sampleHeight, EX, EZ };
})();
window.Terrain = Terrain;
