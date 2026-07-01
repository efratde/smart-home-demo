/* ===================================================================
   materials.js — procedural canvas textures + PBR materials so every
   surface reads as a real desert material, not flat color.
   =================================================================== */
const Mats = (function(){
  function cnv(s){ const c=document.createElement('canvas'); c.width=c.height=s; return c; }
  function tex(canvas, rep){ const t=new THREE.CanvasTexture(canvas);
    t.wrapS=t.wrapT=THREE.RepeatWrapping; if(rep) t.repeat.set(rep,rep);
    t.anisotropy=8; return t; }
  function noise(ctx,s,base,amp,density){
    ctx.fillStyle=base; ctx.fillRect(0,0,s,s);
    const img=ctx.getImageData(0,0,s,s), d=img.data;
    for(let i=0;i<d.length;i+=4){
      const n=(Math.random()-0.5)*amp;
      d[i]+=n; d[i+1]+=n; d[i+2]+=n;
    }
    ctx.putImageData(img,0,0);
    // speckles
    for(let i=0;i<s*s*density;i++){
      ctx.fillStyle=`rgba(${80+Math.random()*120|0},${60+Math.random()*90|0},${40+Math.random()*70|0},${Math.random()*0.18})`;
      ctx.fillRect(Math.random()*s,Math.random()*s,1,1);
    }
  }

  // ---- sandstone plaster ----
  function plaster(){ const s=256,c=cnv(s),x=c.getContext('2d');
    noise(x,s,'#e7d7bb',26,0.5);
    // faint trowel streaks
    for(let i=0;i<40;i++){ x.strokeStyle=`rgba(180,160,130,${Math.random()*0.05})`;
      x.lineWidth=1+Math.random()*3; x.beginPath();
      const y=Math.random()*s; x.moveTo(0,y); x.bezierCurveTo(s*0.3,y+Math.random()*20-10,s*0.6,y+Math.random()*20-10,s,y); x.stroke(); }
    return tex(c); }

  // ---- desert sand (ground) ----
  function sand(){ const s=512,c=cnv(s),x=c.getContext('2d');
    noise(x,s,'#cbab7c',34,1.2);
    // ripples
    for(let i=0;i<26;i++){ x.strokeStyle=`rgba(150,120,80,${0.04+Math.random()*0.05})`;
      x.lineWidth=2+Math.random()*4; x.beginPath();
      const y=Math.random()*s; x.moveTo(0,y);
      for(let xx=0;xx<=s;xx+=16) x.lineTo(xx, y+Math.sin(xx*0.05+i)*8); x.stroke(); }
    return tex(c,18); }

  // ---- courtyard paving (tiling) ----
  function paving(){ const s=256,c=cnv(s),x=c.getContext('2d');
    x.fillStyle='#cdb79a'; x.fillRect(0,0,s,s);
    const n=4, cell=s/n;
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      const shade=200+Math.random()*30|0;
      x.fillStyle=`rgb(${shade},${shade-22},${shade-58})`;
      x.fillRect(i*cell+2,j*cell+2,cell-4,cell-4);
    }
    x.strokeStyle='rgba(120,100,70,0.5)'; x.lineWidth=2;
    for(let i=0;i<=n;i++){ x.beginPath(); x.moveTo(i*cell,0); x.lineTo(i*cell,s); x.stroke();
      x.beginPath(); x.moveTo(0,i*cell); x.lineTo(s,i*cell); x.stroke(); }
    return tex(c,7); }

  // ---- terrace stone deck ----
  function deck(){ const s=256,c=cnv(s),x=c.getContext('2d');
    x.fillStyle='#c4b59a'; x.fillRect(0,0,s,s);
    for(let j=0;j<6;j++)for(let i=0;i<3;i++){ const sh=190+Math.random()*26|0;
      x.fillStyle=`rgb(${sh},${sh-12},${sh-40})`; x.fillRect(i*s/3+1,j*s/6+1,s/3-2,s/6-2); }
    return tex(c,5); }

  // ---- shingle roof ----
  function shingle(){ const s=128,c=cnv(s),x=c.getContext('2d');
    x.fillStyle='#7d4528'; x.fillRect(0,0,s,s);
    for(let row=0;row<8;row++)for(let col=0;col<6;col++){
      const sh=110+Math.random()*40|0;
      x.fillStyle=`rgb(${sh},${sh*0.55|0},${sh*0.35|0})`;
      x.fillRect(col*s/6+1,row*s/8+1,s/6-2,s/8-1);
    }
    return tex(c,4); }

  function build(){
    const wallTex=plaster();
    const M = {
      // The demo house is the HERO and must read SOLID/opaque. A synthetic
      // palette: warm sandy "light plaster" stucco, sand-toned flat
      // roof/parapet, light grey-tan concrete. (The translucency that lets you
      // see through the SURROUNDING blocks lives on meshes named 'homeblock'
      // in terrain.js — these house materials stay fully opaque.)
      wall: new THREE.MeshStandardMaterial({ map:wallTex, color:0xe0cda3, roughness:0.96, metalness:0 }),
      wallWarm: new THREE.MeshStandardMaterial({ map:plaster(), color:0xe6cd9f, roughness:0.95 }),
      concrete: new THREE.MeshStandardMaterial({ color:0xb7b0a2, roughness:0.9 }),
      roof: new THREE.MeshStandardMaterial({ color:0xc9bb98, roughness:0.85 }),
      shingle: new THREE.MeshStandardMaterial({ map:shingle(), roughness:0.8 }),
      sand: new THREE.MeshStandardMaterial({ map:sand(), color:0xd8be93, roughness:1 }),
      paving: new THREE.MeshStandardMaterial({ map:paving(), roughness:0.85 }),
      deck: new THREE.MeshStandardMaterial({ map:deck(), color:0xd09a6a, roughness:0.8 }),
      wood: new THREE.MeshStandardMaterial({ color:0x6b4a2c, roughness:0.6 }),
      brass: new THREE.MeshStandardMaterial({ color:0xb0894a, roughness:0.34, metalness:0.85 }),
      // the demo railing (terrace/courtyard railing) is GREEN-painted tubular
      // metal; weathered sage-olive green.
      railing: new THREE.MeshStandardMaterial({ color:0x68744a, roughness:0.45, metalness:0.55 }),
      // REAL glazing. No env map is wired in this scene (the Sky is a shader
      // sphere, not a usable cube map), so reflections come from the sky/sun:
      // the HemisphereLight (cool blue top, warm ground) + sun DirectionalLight
      // that sky.js drives. A light, cool blue-grey base + low roughness + a
      // touch of metalness and a clearcoat layer makes the panes catch those
      // lights as bright specular highlights — sky-tinted glass, not a black
      // hole. MeshPhysicalMaterial (available in r128) adds the clearcoat +
      // envMapIntensity so it stays reflective even without an explicit envMap.
      // NIGHT GLOW CONTRACT (sky.js, untouched): it mutates each pane's CLONED
      // material every frame — emissive=0xffb765, emissiveIntensity=warm*1.1,
      // opacity=lerp(0.62,0.9,warm). MeshPhysicalMaterial extends Standard so
      // all three properties exist and keep working; the warm emissive is
      // additive and overrides this cool base at night. Day opacity is pinned
      // to 0.62 by sky.js, so we match it here.
      glass: new THREE.MeshPhysicalMaterial({
        color:0x9fb6cc,          // light cool blue-grey — reads as sky-tinted glass
        roughness:0.05,          // crisp, mirror-like specular
        metalness:0.10,          // slight metallic punch to the reflection
        clearcoat:1.0,           // glossy outer coat → strong sky/sun highlight
        clearcoatRoughness:0.04,
        reflectivity:0.6,
        envMapIntensity:1.4,     // boosts reflections once any environment is set
        emissive:0x000000,       // dark by day; sky.js warms it at night
        transparent:true,
        opacity:0.62,            // matches sky.js day baseline (lerp(0.62,0.9,warm))
        side:THREE.DoubleSide,   // visible from in/outside the recessed reveal
        depthWrite:false,        // correct blend ordering against the wall reveal
      }),
      foliage: new THREE.MeshStandardMaterial({ color:0x6f7d49, roughness:0.9 }),
      foliageDark: new THREE.MeshStandardMaterial({ color:0x55663a, roughness:0.9 }),
      trunk: new THREE.MeshStandardMaterial({ color:0x6a5436, roughness:0.9 }),
      agave: new THREE.MeshStandardMaterial({ color:0x8a9a63, roughness:0.85 }),
      pot: new THREE.MeshStandardMaterial({ color:0xa55a35, roughness:0.8 }),
      rock: new THREE.MeshStandardMaterial({ color:0x9c8b6e, roughness:1 }),
      gravel: new THREE.MeshStandardMaterial({ map:sand(), color:0xbfae8c, roughness:1 }),
      rim: new THREE.MeshStandardMaterial({ color:0x8f7252, roughness:1 }),
      neighbour: new THREE.MeshStandardMaterial({ color:0xd9c8a8, roughness:0.95 }),
    };
    M._glassList = [M.glass];
    return M;
  }
  return { build };
})();
window.Mats = Mats;
