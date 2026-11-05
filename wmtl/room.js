/* whomadethisline · the lobby room (three.js r149, shipped locally in vendor/) */
'use strict';
const World = (() => {
  const $ = (s, r = document) => r.querySelector(s); const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let CB = {};
  /* THE BOOK — a realistic sportsbook interior.
     Curved LED video wall + odds ticker, polished stone floor with real planar reflections, walnut slat walls,
     tiered leather seating, one game station per matchup (team holograms + its own live-watch panel),
     a Live Watch lounge, a Best Bets teller counter. HDR render -> bloom -> filmic tone map -> grain/vignette. */
  let ok = false, renderer, scene, camera, root, raf = 0, last = 0, visible = true, tween = null, T0 = performance.now();
  let post = null, refl = null, mobile = false, lowPower = false, intro = null;
  const nearPanels = [], stations = [], picks = [], billboards = [], holos = [], spinners = [], tickers = [], liveCards = [];
  let liveRing = null, wallMat = null, wallCanvasDraw = null, dust = null;
  const cam = {az: 0, el: 0.2, dist: 40, tx: 0, ty: 4.5, tz: -6};
  const label = document.getElementById('roomLabel') || document.createElement('div');
  const FD = (getComputedStyle(document.documentElement).getPropertyValue('--f-d') || 'sans-serif').trim();
  const ROW = {main: {z: -3}};
  let paused = false; const host = () => document.getElementById('roomCanvas'); const portrait = () => { const h = host(); return h ? h.clientWidth < h.clientHeight : false; };
  const LOUNGE = {x: 21.5, z: -2}, COUNTER = {x: -26.5, z: -1};
  const TEAMC = {ARI:['97233F','FFB612'],ATL:['A71930','A5ACAF'],BAL:['241773','9E7C0C'],BUF:['00338D','C60C30'],CAR:['0085CA','BFC0BF'],CHI:['C83803','0B162A'],CIN:['FB4F14','000000'],CLE:['FB4F14','22150C'],DAL:['003594','869397'],DEN:['FB4F14','002244'],DET:['0076B6','B0B7BC'],GB:['203731','FFB612'],HOU:['A71930','03202F'],IND:['002C5F','A5ACAF'],JAX:['006778','9F792C'],KC:['E31837','FFB612'],LV:['A5ACAF','000000'],LAC:['0080C6','FFC20E'],LA:['FFD100','003594'],MIA:['008E97','FC4C02'],MIN:['4F2683','FFC62F'],NE:['002244','C60C30'],NO:['9F8958','000000'],NYG:['0B2265','A71930'],NYJ:['125740','FFFFFF'],PHI:['004953','A5ACAF'],PIT:['FFB612','000000'],SF:['AA0000','B3995D'],SEA:['002244','69BE28'],TB:['D50A0A','FF7900'],TEN:['4495D1','002A5C'],WAS:['773141','FFB612']};
  // holograms need light: lift very dark brand colors toward a readable glow, keep the hue
  function holoHex(team){ const c = new THREE.Color('#' + (TEAMC[team] || ['8FA3B8'])[0]); const hsl = {}; c.getHSL(hsl); return new THREE.Color().setHSL(hsl.h, Math.max(hsl.s, .55), Math.max(hsl.l, .55)); }
  function holoHex2(team){ const c = new THREE.Color('#' + (TEAMC[team] || ['8FA3B8','DDE3EA'])[1]); const hsl = {}; c.getHSL(hsl); return new THREE.Color().setHSL(hsl.h, Math.max(hsl.s, .35), Math.max(hsl.l, .62)); }
  const css = c => '#' + c.getHexString();

  /* ---------------- textures */
  function canvasTex(w, h, draw, opts = {}){ const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h); const t = new THREE.CanvasTexture(c); t.encoding = opts.linear ? THREE.LinearEncoding : THREE.sRGBEncoding; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); if(opts.repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); } t.userData = {canvas: c, ctx: x}; return t; }
  function rr(x, X, Y, W, H, r){ x.beginPath(); x.moveTo(X+r, Y); x.arcTo(X+W, Y, X+W, Y+H, r); x.arcTo(X+W, Y+H, X, Y+H, r); x.arcTo(X, Y+H, X, Y, r); x.arcTo(X, Y, X+W, Y, r); x.closePath(); }
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  function fitText(c, t, maxW, size, weight = 800){ let fs = size; c.font = `${weight} ${fs}px ${FD}`; while(c.measureText(t).width > maxW && fs > 10){ fs -= 2; c.font = `${weight} ${fs}px ${FD}`; } return fs; }
  const tx = {};
  function makeTextures(){
    tx.wood = canvasTex(1024, 1024, (c, W, H) => { const g = c.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#3a2416'); g.addColorStop(.5, '#4a2e1b'); g.addColorStop(1, '#341f13'); c.fillStyle = g; c.fillRect(0, 0, W, H);
      for(let i = 0; i < 260; i++){ const x0 = rnd() * W, a = .03 + rnd() * .09; c.strokeStyle = `rgba(${rnd() < .5 ? '20,10,5' : '90,58,34'},${a})`; c.lineWidth = .6 + rnd() * 2.4; c.beginPath(); let x = x0; c.moveTo(x, 0); for(let y = 0; y <= H; y += 16){ x += Math.sin(y * .012 + x0) * 1.4 + (rnd() - .5) * .8; c.lineTo(x, y); } c.stroke(); }
      for(let k = 0; k < 6; k++){ const cx = rnd() * W, cy = rnd() * H; for(let r = 4; r < 40; r += 3){ c.strokeStyle = `rgba(25,12,6,${.07})`; c.beginPath(); c.ellipse(cx, cy, r * .5, r * 2.2, 0, 0, Math.PI * 2); c.stroke(); } } }, {repeat: [1, 1]});
    tx.stone = canvasTex(1024, 1024, (c, W, H) => { c.fillStyle = '#121418'; c.fillRect(0, 0, W, H); for(let i = 0; i < 9000; i++){ const s = rnd() * 2.6; const v = 30 + rnd() * 70 | 0; c.fillStyle = `rgba(${v},${v + 4},${v + 10},${.18 + rnd() * .3})`; c.fillRect(rnd() * W, rnd() * H, s, s); }
      for(let i = 0; i < 140; i++){ c.fillStyle = `rgba(${150 + rnd() * 80 | 0},${130 + rnd() * 60 | 0},${100 + rnd() * 40 | 0},${.25 + rnd() * .3})`; const s = 2 + rnd() * 5; c.beginPath(); c.arc(rnd() * W, rnd() * H, s, 0, 7); c.fill(); }
      c.strokeStyle = 'rgba(200,170,110,.20)'; c.lineWidth = 3; c.strokeRect(1.5, 1.5, W - 3, H - 3); }, {repeat: [14, 14]});
    tx.stoneRough = canvasTex(256, 256, (c, W, H) => { c.fillStyle = '#5a5a5a'; c.fillRect(0, 0, W, H); for(let i = 0; i < 1600; i++){ const v = 70 + rnd() * 90 | 0; c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3); } }, {repeat: [14, 14], linear: true});
    tx.carpet = canvasTex(512, 512, (c, W, H) => { c.fillStyle = '#0d1428'; c.fillRect(0, 0, W, H); c.strokeStyle = 'rgba(201,163,92,.55)'; c.lineWidth = 3;
      for(let y = 0; y <= H; y += 128) for(let x = 0; x <= W; x += 128){ c.beginPath(); c.moveTo(x, y - 52); c.lineTo(x + 52, y); c.lineTo(x, y + 52); c.lineTo(x - 52, y); c.closePath(); c.stroke(); c.fillStyle = 'rgba(40,120,128,.55)'; c.beginPath(); c.arc(x, y, 9, 0, 7); c.fill(); }
      c.strokeStyle = 'rgba(120,30,40,.45)'; c.lineWidth = 2; for(let y = 64; y <= H; y += 128) for(let x = 64; x <= W; x += 128){ c.strokeRect(x - 20, y - 20, 40, 40); }
      for(let i = 0; i < 9000; i++){ c.fillStyle = `rgba(255,255,255,${rnd() * .035})`; c.fillRect(rnd() * W, rnd() * H, 1, 1); } }, {repeat: [10, 4]});
    tx.leather = canvasTex(256, 256, (c, W, H) => { c.fillStyle = '#1b1210'; c.fillRect(0, 0, W, H); for(let i = 0; i < 3000; i++){ c.fillStyle = `rgba(${rnd() < .5 ? '0,0,0' : '80,50,40'},${rnd() * .18})`; c.beginPath(); c.arc(rnd() * W, rnd() * H, rnd() * 2.2, 0, 7); c.fill(); } }, {repeat: [2, 2]});
    tx.brushed = canvasTex(512, 64, (c, W, H) => { c.fillStyle = '#9a9ea4'; c.fillRect(0, 0, W, H); for(let i = 0; i < 900; i++){ const v = 110 + rnd() * 100 | 0; c.strokeStyle = `rgba(${v},${v},${v + 4},.35)`; c.beginPath(); const y = rnd() * H; c.moveTo(0, y); c.lineTo(W, y + (rnd() - .5) * 2); c.stroke(); } }, {repeat: [1, 1]});
    tx.panel = canvasTex(512, 512, (c, W, H) => { c.fillStyle = '#0d0f13'; c.fillRect(0, 0, W, H); c.fillStyle = '#14171c'; for(let y = 0; y < H; y += 32) for(let x = (y / 32 % 2) * 16; x < W; x += 32){ c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill(); } }, {repeat: [12, 3]});
    tx.glow = canvasTex(128, 128, (x, W, H) => { const g = x.createRadialGradient(W/2, H/2, 0, W/2, H/2, W/2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H); });
    tx.shadow = canvasTex(128, 128, (x, W, H) => { const g = x.createRadialGradient(W/2, H/2, 0, W/2, H/2, W/2); g.addColorStop(0, 'rgba(0,0,0,.85)'); g.addColorStop(.55, 'rgba(0,0,0,.35)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H); });
  }

  /* ---------------- materials */
  const M = {};
  function makeMaterials(){
    M.floor = new THREE.MeshStandardMaterial({map: tx.stone, roughnessMap: tx.stoneRough, roughness: .55, metalness: .0, envMapIntensity: .7});
    M.wood = new THREE.MeshPhysicalMaterial({map: tx.wood, roughness: .42, metalness: 0, clearcoat: .35, clearcoatRoughness: .4, envMapIntensity: .8});
    M.carpet = new THREE.MeshStandardMaterial({map: tx.carpet, roughness: .98, metalness: 0, envMapIntensity: .25});
    M.leather = new THREE.MeshPhysicalMaterial({map: tx.leather, color: 0x6b3a28, roughness: .48, clearcoat: .25, clearcoatRoughness: .55, envMapIntensity: .7});
    M.lacquer = new THREE.MeshPhysicalMaterial({color: 0x07080a, roughness: .18, metalness: .1, clearcoat: 1, clearcoatRoughness: .08, envMapIntensity: 1.1});
    M.brass = new THREE.MeshStandardMaterial({color: 0xc9a35c, roughness: .26, metalness: 1, envMapIntensity: 1.2});
    M.steel = new THREE.MeshStandardMaterial({map: tx.brushed, color: 0xb9bec6, roughness: .32, metalness: 1, envMapIntensity: 1});
    M.blackMetal = new THREE.MeshStandardMaterial({color: 0x15171b, roughness: .45, metalness: .8, envMapIntensity: .8});
    M.glass = new THREE.MeshPhysicalMaterial({color: 0x9fb4c8, roughness: .04, metalness: 0, transparent: true, opacity: .16, envMapIntensity: 1.6, clearcoat: 1, depthWrite: false});
    M.acoustic = new THREE.MeshStandardMaterial({map: tx.panel, roughness: .92, metalness: 0, envMapIntensity: .2});
    M.ceiling = new THREE.MeshStandardMaterial({color: 0x0b0c0f, roughness: .9, metalness: 0});
    M.plaster = new THREE.MeshStandardMaterial({color: 0x16181d, roughness: .85});
    M.stoneTop = new THREE.MeshPhysicalMaterial({color: 0x1d1f24, roughness: .22, metalness: 0, clearcoat: .6, envMapIntensity: 1});
    M.warmLED = new THREE.MeshBasicMaterial({color: new THREE.Color(0xffc98a).multiplyScalar(3.2), toneMapped: true});
    M.downlight = new THREE.MeshBasicMaterial({color: new THREE.Color(0xfff1dc).multiplyScalar(5.5)});
    M.bezel = new THREE.MeshStandardMaterial({color: 0x050506, roughness: .35, metalness: .6});
  }
  function roundedBox(w, h, d, r, seg = 4){ r = Math.min(r, w * .45, h * .45); const s = new THREE.Shape(); const x = -w/2, y = -h/2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(s, {depth: d - 2 * Math.min(r, d/3), bevelEnabled: true, bevelThickness: Math.min(r, d/3), bevelSize: Math.min(r, d/3) * .9, bevelSegments: seg, curveSegments: seg}); g.translate(0, 0, -(d - 2 * Math.min(r, d/3)) / 2); g.computeVertexNormals(); const nn = g.attributes.normal.array; for(let i = 0; i < nn.length; i += 3){ const L = Math.hypot(nn[i], nn[i+1], nn[i+2]); if(!(L > 1e-6)){ nn[i] = 0; nn[i+1] = 1; nn[i+2] = 0; } } return g; }
  function mesh(g, m, cast = true, recv = true){ const o = new THREE.Mesh(g, m); o.castShadow = cast && !lowPower; o.receiveShadow = recv; return o; }
  function shadowBlob(w, d, op = .8){ const o = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({map: tx.shadow, transparent: true, opacity: op, depthWrite: false})); o.rotation.x = -Math.PI/2; o.position.y = .012; o.renderOrder = 1; return o; }

  /* ---------------- hologram + screen shaders */
  const holoVert = `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position,1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`;
  const holoFrag = `uniform sampler2D map; uniform float time; uniform float gain; uniform float seed; uniform vec3 tint; uniform float fade; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    float h(float n){ return fract(sin(n)*43758.5453); }
    void main(){ vec2 uv = vUv; float band = step(.985, h(floor(time*7.+seed)))*.012*sin(uv.y*90.+time*40.); uv.x += band;
      vec4 c = texture2D(map, uv); float scan = .72 + .28*sin(uv.y*420. - time*9.); float fine = .9 + .1*sin(uv.y*1600.);
      float flick = .92 + .08*sin(time*31.+seed*7.) * step(.6, h(floor(time*13.+seed)));
      float edge = smoothstep(0.,.08,uv.y)*smoothstep(1.,.86,uv.y);
      vec3 col = c.rgb * scan * fine * flick * gain + tint * c.a * .08;
      gl_FragColor = vec4(col * edge * fade, c.a * edge * fade); }`;
  function holoMat(tex, tint, gain = 2.2){ return new THREE.ShaderMaterial({uniforms: {map: {value: tex}, time: {value: 0}, gain: {value: gain}, seed: {value: rnd() * 10}, tint: {value: tint.clone()}, fade: {value: 1}}, vertexShader: holoVert, fragmentShader: holoFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false}); }
  const beamFrag = `uniform vec3 color; uniform float time; varying vec2 vUv; void main(){ float a = pow(1.-vUv.y, 1.8) * .42 * (.95+.05*sin(vUv.y*40.-time*4.)); gl_FragColor = vec4(color*a*1.6, a); }`;
  function beamMat(color){ return new THREE.ShaderMaterial({uniforms: {color: {value: color.clone()}, time: {value: 0}}, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`, fragmentShader: beamFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false}); }
  const ledFrag = `uniform sampler2D map; uniform vec2 res; uniform float gain; uniform float time; varying vec2 vUv;
    void main(){ vec4 c = texture2D(map, vUv); vec2 q = vUv*res; vec2 p = fract(q); float px = smoothstep(.0,.18,p.x)*smoothstep(1.,.82,p.x)*smoothstep(.0,.18,p.y)*smoothstep(1.,.82,p.y); vec2 fw = fwidth(q); px = mix(px, .62, clamp(max(fw.x, fw.y)*1.6 - .4, 0., 1.));
      float sweep = .04*smoothstep(.0,.02, .02-abs(fract(vUv.x*.5 - time*.03)-.5));
      gl_FragColor = vec4(c.rgb*(.55+.45*px)*gain + sweep, 1.); }`;
  function ledMat(tex, res, gain = 1.6){ return new THREE.ShaderMaterial({uniforms: {map: {value: tex}, res: {value: new THREE.Vector2(res[0], res[1])}, gain: {value: gain}, time: {value: 0}}, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`, fragmentShader: ledFrag, side: THREE.DoubleSide, toneMapped: false, extensions: {derivatives: true}}); }
  function screenMat(tex, gain = 1.7){ const m = new THREE.MeshBasicMaterial({map: tex, toneMapped: false}); m.color.setScalar(gain); return m; }

  /* ---------------- init */
  function webgl(){ try{ const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); }catch(e){ return false; } }
  function init(cb){ CB = cb || {};
    if(!window.THREE || !webgl()) return false;
    mobile = matchMedia('(pointer: coarse)').matches; lowPower = mobile || (navigator.hardwareConcurrency || 8) <= 4;
    try{ renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: 'high-performance', stencil: false}); }catch(e){ return false; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2)); renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !lowPower; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host().appendChild(renderer.domElement); if(window.ResizeObserver) new ResizeObserver(() => resize()).observe(host());
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x050608); scene.fog = new THREE.FogExp2(0x07080b, .012);
    camera = new THREE.PerspectiveCamera(46, 1, .3, 200);
    makeTextures(); makeMaterials(); environment(); architecture(); lights(); atmosphere();
    root = new THREE.Group(); scene.add(root);
    reflection(); postFX(); resize(); bind(); ok = true;
    if(!RM){ const ph = portrait(); Object.assign(cam, {az: -.55, el: .06, dist: ph ? 30 : 22, tx: 0, ty: 3.2, tz: -12}); intro = true; }
    requestAnimationFrame(loop); return true;
  }

  /* ---------------- image-based lighting: a little light-box room baked into a PMREM */
  function environment(){
    const env = new THREE.Scene(); const box = new THREE.Mesh(new THREE.BoxGeometry(60, 14, 60), new THREE.MeshBasicMaterial({color: 0x0c0d10, side: THREE.BackSide})); box.position.y = 7; env.add(box);
    const lamp = (w, h, x, y, z, rx, ry, col, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide})); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m); };
    lamp(34, 7, 0, 6, -27, 0, 0, 0x7fa8ff, 3.2);            // the video wall
    for(let i = -2; i <= 2; i++) lamp(1.1, 40, i * 8, 13.8, 0, Math.PI/2, 0, 0xffe0b8, 9); // ceiling slots
    lamp(14, 2.5, -29.5, 4, 0, 0, Math.PI/2, 0xffb36b, 4);  // counter backlight
    lamp(10, 2.5, 29.5, 4, 0, 0, -Math.PI/2, 0x3fe0c8, 3.5); // lounge neon
    lamp(60, 1.4, 0, .3, 29.5, 0, Math.PI, 0xffc98a, 2);     // rear cove
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(env, .035).texture; pm.dispose();
  }

  /* ---------------- the room */
  function architecture(){
    const W = 66, Dp = 64, H = 12;
    const floor = mesh(new THREE.PlaneGeometry(W, Dp), M.floor, false, true); floor.rotation.x = -Math.PI/2; scene.add(floor);
    // brass inlay lines on the stone, framing the station floor
    [-18, 18].forEach(x => { const s = new THREE.Mesh(new THREE.BoxGeometry(.06, .01, 30), M.brass); s.position.set(x, .006, -5); scene.add(s); });
    [-20.5, 10].forEach(z => { const s = new THREE.Mesh(new THREE.BoxGeometry(36, .01, .06), M.brass); s.position.set(0, .006, z); scene.add(s); });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp), M.ceiling); ceil.rotation.x = Math.PI/2; ceil.position.y = H; scene.add(ceil);
    // coffers + linear light slots + recessed downlights
    for(let i = -3; i <= 3; i++){ if(i === 0) continue; const b = new THREE.Mesh(new THREE.BoxGeometry(.5, .7, Dp), M.plaster); b.position.set(i * 9.5, H - .35, 0); scene.add(b); }
    for(let i = -2; i <= 2; i++){ const s = new THREE.Mesh(new THREE.BoxGeometry(.22, .04, 46), M.warmLED); s.position.set(i * 9.5 + 4.75, H - .02, -2); scene.add(s); }
    const dl = new THREE.InstancedMesh(new THREE.CircleGeometry(.16, 24), M.downlight, 120); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2, 0, 0)); let k = 0;
    for(let x = -28; x <= 28; x += 4.75) for(let z = -22; z <= 26; z += 6){ if(k >= 120) break; m4.compose(new THREE.Vector3(x, H - .03, z), q, new THREE.Vector3(1, 1, 1)); dl.setMatrixAt(k++, m4); } dl.count = k; scene.add(dl);
    // side walls: walnut slats over dark acoustic panel, brass base line
    [-1, 1].forEach(sd => { const wall = new THREE.Mesh(new THREE.PlaneGeometry(Dp, H), M.acoustic); wall.position.set(sd * W/2, H/2, 0); wall.rotation.y = -sd * Math.PI/2; scene.add(wall);
      const n = 150; const sl = new THREE.InstancedMesh(new THREE.BoxGeometry(.09, H - .8, .06), M.wood, n); for(let i = 0; i < n; i++){ m4.makeTranslation(sd * (W/2 - .08), H/2 + .1, -Dp/2 + 1 + i * (Dp - 2) / n); sl.setMatrixAt(i, m4); } sl.receiveShadow = true; scene.add(sl);
      const base = new THREE.Mesh(new THREE.BoxGeometry(.04, .08, Dp), M.brass); base.position.set(sd * (W/2 - .2), .35, 0); scene.add(base); });
    // rear wall behind the seating with a warm cove
    const rear = new THREE.Mesh(new THREE.PlaneGeometry(W, H), M.acoustic); rear.position.set(0, H/2, Dp/2); rear.rotation.y = Math.PI; scene.add(rear);
    const cove = new THREE.Mesh(new THREE.BoxGeometry(W, .05, .05), M.warmLED); cove.position.set(0, H - .9, Dp/2 - .3); scene.add(cove);
    // front wall behind the LED wall
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), M.acoustic); front.position.set(0, H/2, -Dp/2); scene.add(front);
    // columns with brass collars
    [[-18, -20.5], [18, -20.5], [-18, 10], [18, 10]].forEach(([x, z]) => { const c = mesh(new THREE.CylinderGeometry(.55, .55, H, 40), M.lacquer); c.position.set(x, H/2, z); scene.add(c);
      [.6, H - .6].forEach(y => { const r = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, .14, 40), M.brass); r.position.set(x, y, z); scene.add(r); }); const sb = shadowBlob(2.6, 2.6, .7); sb.position.set(x, .012, z); scene.add(sb); });
    seating(); videoWall();
  }
  function seating(){
    // three carpeted tiers behind the station floor, desks with monitors and leather chairs facing the wall
    const tiers = [{z: 14, y: .45}, {z: 19, y: .9}, {z: 24, y: 1.35}];
    const chairG = chairGeometry(); const n = 3 * 14; const chairs = new THREE.InstancedMesh(chairG, M.leather, n); chairs.castShadow = !lowPower; chairs.receiveShadow = true;
    const monG = new THREE.BoxGeometry(.62, .38, .03); const monT = canvasTex(256, 160, (c, W, H) => { const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0f2440'); g.addColorStop(1, '#09121f'); c.fillStyle = g; c.fillRect(0, 0, W, H); c.fillStyle = '#E9C46A'; c.font = `800 26px ${FD}`; c.fillText('WMTL', 14, 34); c.fillStyle = '#9FB4CC'; c.font = `600 18px ${FD}`; for(let i = 0; i < 5; i++){ c.fillRect(14, 54 + i * 20, 80 + rnd() * 120, 8); } });
    const mons = new THREE.InstancedMesh(new THREE.PlaneGeometry(.58, .34), screenMat(monT, 1.25), n); const monBack = new THREE.InstancedMesh(monG, M.blackMetal, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qm = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.12, 0, 0)), qc = new THREE.Quaternion(); let k = 0;
    tiers.forEach((t, ti) => {
      const deck = mesh(new THREE.BoxGeometry(44, t.y, 5), M.carpet, false, true); deck.position.set(0, t.y/2, t.z + .5); scene.add(deck);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(44, .04, .04), M.warmLED); nose.position.set(0, t.y - .03, t.z - 2.02); scene.add(nose);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(44, .95, .02), M.glass); rail.position.set(0, t.y + .5, t.z - 2.05); scene.add(rail);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(44, .05, .07), M.brass); cap.position.set(0, t.y + .98, t.z - 2.05); scene.add(cap);
      const desk = mesh(new THREE.BoxGeometry(42, .06, .8), M.wood); desk.position.set(0, t.y + .74, t.z - .9); scene.add(desk);
      const apron = mesh(new THREE.BoxGeometry(42, .62, .04), M.wood); apron.position.set(0, t.y + .41, t.z - 1.28); scene.add(apron);
      for(let i = 0; i < 14; i++){ const x = -19.5 + i * 3; const yaw = Math.atan2(-x * .06, 1) * .6;
        qc.setFromEuler(new THREE.Euler(0, Math.PI + yaw + (rnd() - .5) * .35, 0)); m4.compose(new THREE.Vector3(x + (rnd() - .5) * .2, t.y, t.z + .35 + rnd() * .15), qc, new THREE.Vector3(1, 1, 1)); chairs.setMatrixAt(k, m4);
        q.copy(qm); m4.compose(new THREE.Vector3(x, t.y + .99, t.z - 1.1), q, new THREE.Vector3(1, 1, 1)); mons.setMatrixAt(k, m4);
        m4.compose(new THREE.Vector3(x, t.y + .99, t.z - 1.118), q, new THREE.Vector3(1, 1, 1)); monBack.setMatrixAt(k, m4); k++; }
    });
    scene.add(chairs, mons, monBack);
  }
  function chairGeometry(){
    const parts = []; const add = (g, x, y, z, rx = 0) => { g.rotateX(rx); g.translate(x, y, z); parts.push(g); };
    add(roundedBox(.62, .14, .6, .06), 0, .5, 0);                   // seat cushion
    add(roundedBox(.6, .66, .12, .05), 0, .92, .27, -.12);          // back
    add(roundedBox(.08, .08, .5, .03), -.33, .7, .02); add(roundedBox(.08, .08, .5, .03), .33, .7, .02); // arms
    add(new THREE.CylinderGeometry(.04, .04, .38, 12), 0, .25, 0);  // gas lift
    for(let i = 0; i < 5; i++){ const a = i / 5 * Math.PI * 2; const g = new THREE.BoxGeometry(.04, .03, .3); g.rotateY(a); g.translate(Math.sin(a) * .15, .05, Math.cos(a) * .15); parts.push(g); }
    return mergeGeos(parts);
  }
  function mergeGeos(list){ // minimal merge (position/normal/uv), all non-indexed
    const arrs = list.map(g => g.index ? g.toNonIndexed() : g); let n = 0; arrs.forEach(g => n += g.attributes.position.count);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2); let o = 0;
    arrs.forEach(g => { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); if(g.attributes.uv) uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g; }

  /* ---------------- LED video wall + ticker */
  const WALL = {R: 36, ang: 1.0, h: 7.4, y: 2.9, cz: 8};
  function videoWall(){
    const {R, ang, h, y, cz} = WALL;
    const wt = canvasTex(4096, 860, () => {}); wallCanvasDraw = (d) => drawWall(wt, d);
    wallMat = ledMat(wt, [1600, 300], 1.55);
    const g = new THREE.CylinderGeometry(R, R, h, 96, 1, true, Math.PI - ang/2, ang); g.scale(-1, 1, 1);
    const wall = new THREE.Mesh(g, wallMat); wall.position.set(0, y + h/2, cz); wall.userData = {kind: 'board'}; scene.add(wall); picks.push(wall);
    const frame = new THREE.Mesh(new THREE.CylinderGeometry(R + .9, R + .9, h + .7, 96, 1, true, Math.PI - ang/2 - .01, ang + .02), M.bezel); frame.material = M.bezel.clone(); frame.material.side = THREE.BackSide; frame.position.copy(wall.position); scene.add(frame);
    // ticker
    const tt = canvasTex(4096, 96, () => {}, {repeat: [1, 1]}); tt.wrapS = THREE.RepeatWrapping; tickers.push(tt); tt.userData.draw = (d) => drawTicker(tt, d);
    const tg = new THREE.CylinderGeometry(R - .05, R - .05, .62, 96, 1, true, Math.PI - ang/2, ang); tg.scale(-1, 1, 1);
    const tk = new THREE.Mesh(tg, ledMat(tt, [1800, 24], 1.8)); tk.position.set(0, y - .55, cz); scene.add(tk);
    // wall wash glow on the floor in front
    const wash = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), new THREE.MeshBasicMaterial({map: tx.glow, color: new THREE.Color(0x4a78c8).multiplyScalar(.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); wash.rotation.x = -Math.PI/2; wash.position.set(0, .02, -25); scene.add(wash);
  }
  /* ---------------- sport tables (lobby) */
  const SPORTC = {NFL: '5B8DEF', CFB: 'B08BE8', NBA: 'E8894A', NHL: '8FD0EE', MLB: '5FC2AE'};
  function sportCol(s){ const c = new THREE.Color('#' + (SPORTC[s] || '9FB2C8')); const hsl = {}; c.getHSL(hsl); return new THREE.Color().setHSL(hsl.h, Math.max(hsl.s, .5), Math.max(hsl.l, .6)); }
  function sportMono(s){ const c1 = sportCol(s), c2 = new THREE.Color(0xf3e3bd);
    return canvasTex(512, 512, (c, W, H) => { c.clearRect(0, 0, W, H); c.translate(W/2, H/2);
      const ring = (r, w, col, a) => { c.globalAlpha = a; c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1; };
      ring(232, 6, css(c1), .9); ring(212, 2, css(c2), .55);
      for(let i = 0; i < 60; i++){ const a = i / 60 * Math.PI * 2; c.globalAlpha = i % 5 ? .3 : .85; c.strokeStyle = css(c2); c.lineWidth = 3; c.beginPath(); c.moveTo(Math.cos(a) * 196, Math.sin(a) * 196); c.lineTo(Math.cos(a) * (i % 5 ? 186 : 172), Math.sin(a) * (i % 5 ? 186 : 172)); c.stroke(); } c.globalAlpha = 1;
      fitText(c, s, 330, 200, 800); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = css(c1); c.shadowBlur = 40; c.fillStyle = css(c1); c.fillText(s, 0, 10); c.shadowBlur = 0; c.lineWidth = 4; c.strokeStyle = css(c2); c.strokeText(s, 0, 10);
      const gr = c.createLinearGradient(0, -90, 0, 90); gr.addColorStop(0, 'rgba(255,255,255,.7)'); gr.addColorStop(.5, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillText(s, 0, 10); }); }
  function tableScreen(s){
    return canvasTex(1024, 420, (c, W, H) => { const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0d1116'); bg.addColorStop(1, '#07090c'); c.fillStyle = bg; c.fillRect(0, 0, W, H);
      c.fillStyle = '#' + (SPORTC[s.sport] || '9FB2C8'); c.fillRect(0, 0, W, 10);
      c.fillStyle = '#D9B266'; c.font = `800 46px ${FD}`; c.fillText(s.sport, 40, 76); c.textAlign = 'right'; c.fillStyle = '#8C939C'; c.font = `700 36px ${FD}`; c.fillText(String(s.when || '').toUpperCase(), W - 40, 72); c.textAlign = 'left';
      c.fillStyle = '#F2F1EC'; fitText(c, String(s.title || '').toUpperCase(), W - 80, 96); c.fillText(String(s.title || '').toUpperCase(), 40, 190);
      c.fillStyle = '#B4B6B8'; c.font = `700 40px ${FD}`; c.fillText(String(s.sub || '').toUpperCase(), 40, 252);
      if(s.built){ const chip = (x, t, col) => { c.font = `800 40px ${FD}`; const tw = c.measureText(t).width + 40; c.strokeStyle = col; c.lineWidth = 3; rr(c, x, 312, tw, 62, 31); c.stroke(); c.fillStyle = col; c.fillText(t, x + 20, 356); return x + tw + 18; };
        let x = 40; x = chip(x, `${s.bets} BET${s.bets === 1 ? '' : 'S'}`, s.bets ? '#3FD08F' : '#5E656E'); chip(x, `${s.watch} LIVE WATCH`, s.watch ? '#F2A93B' : '#5E656E'); }
      else { c.fillStyle = '#7C8188'; c.font = `700 40px ${FD}`; c.fillText('NOT BUILT YET', 40, 356); } }); }
  function buildTable(s, pos){
    const grp = new THREE.Group(); grp.position.copy(pos); root.add(grp);
    const acc = new THREE.Color(s.bets ? 0x3fd08f : s.watch ? 0xf2a93b : 0x5e656e);
    const body = mesh(roundedBox(2.1, 1.0, .95, .12), M.lacquer); body.position.y = .55; grp.add(body);
    const kick = mesh(roundedBox(2.16, .06, 1.0, .03), M.brass, false); kick.position.y = .07; grp.add(kick);
    const top = mesh(roundedBox(2.25, .07, 1.1, .03), M.stoneTop); top.position.y = 1.08; grp.add(top);
    const halo = new THREE.Mesh(roundedBox(2.2, .02, 1.05, .03), new THREE.MeshBasicMaterial({color: acc.clone().multiplyScalar(3.4)})); halo.position.y = 1.035; grp.add(halo);
    const under = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.0), new THREE.MeshBasicMaterial({map: tx.glow, color: acc.clone().multiplyScalar(.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); under.rotation.x = -Math.PI/2; under.position.y = .02; grp.add(under);
    grp.add(shadowBlob(3.0, 1.9, .75));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.9, .78), screenMat(tableScreen(s), 1.55)); scr.position.set(0, 1.13, .02); scr.rotation.x = -Math.PI/2 + .42; grp.add(scr);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(.16, .2, .05, 32), new THREE.MeshBasicMaterial({color: sportCol(s.sport).multiplyScalar(4)})); lens.position.set(0, 1.14, -.32); grp.add(lens);
    const tint = sportCol(s.sport);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.5, .16, 1.6, 48, 1, true), beamMat(tint.clone().lerp(new THREE.Color(0xffffff), .35))); beam.position.set(0, 1.95, -.32); grp.add(beam); holos.push(beam.material);
    const hg = new THREE.Group(); hg.position.set(0, 3.0, -.32); grp.add(hg); billboards.push(hg);
    const mono = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), holoMat(sportMono(s.sport), tint, s.built ? 2.2 : .9)); hg.add(mono); holos.push(mono.material);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.3, 96), new THREE.MeshBasicMaterial({color: tint.clone().multiplyScalar(2.2), transparent: true, opacity: .55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false})); ring.rotation.x = -Math.PI/2; ring.position.set(0, 1.2, -.32); grp.add(ring); spinners.push({o: ring, s: .3});
    const hit = new THREE.Mesh(new THREE.BoxGeometry(2.6, 5.2, 1.6), new THREE.MeshBasicMaterial({visible: false})); hit.position.y = 2.6; hit.userData = {kind: 'sport', id: s.key}; grp.add(hit); picks.push(hit);
    stations.push({s, grp, hit});
  }
  /* ---------------- build from the lobby list */
  let built = false;
  function clearRoot(){ while(root.children.length) root.remove(root.children[0]); stations.length = 0; nearPanels.length = 0; billboards.length = 0; holos.length = 0; spinners.length = 0; liveCards.length = 0; for(let i = picks.length - 1; i >= 0; i--) if(picks[i].userData && picks[i].userData.kind !== 'board') picks.splice(i, 1); }
  let LOBBY = [];
  function build(L){
    if(!ok) return; LOBBY = L; clearRoot(); seed = 11;
    if(wallCanvasDraw) wallCanvasDraw(L); tickers.forEach(t => t.userData.draw(L));
    const sp = 4.7; L.forEach((s, i) => { const x = (i - (L.length - 1) / 2) * sp; buildTable(s, new THREE.Vector3(x, 0, ROW.main.z - Math.abs(x) * .06)); });
    const lt = canvasTex(1024, 128, (c, W, H) => { c.textAlign = 'center'; c.fillStyle = 'rgba(217,178,102,.9)'; c.font = `800 84px ${FD}`; c.fillText('OVERLAY', W/2, 96); });
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.12), screenMat(lt, 1.3)); lab.material.transparent = true; lab.material.depthWrite = false; lab.rotation.x = -Math.PI/2; lab.position.set(0, .02, ROW.main.z + 1.9); root.add(lab);
    built = true;
  }
  function drawWall(t, L){
    const c = t.userData.ctx, W = t.userData.canvas.width, H = t.userData.canvas.height;
    const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0b0e13'); bg.addColorStop(1, '#05070a'); c.fillStyle = bg; c.fillRect(0, 0, W, H);
    c.fillStyle = '#12161c'; c.fillRect(0, 0, W, 92); c.fillStyle = '#D9B266'; c.fillRect(0, 92, W, 4);
    c.fillStyle = '#F2F1EC'; c.font = `800 62px ${FD}`; c.fillText('OVERLAY  ·  BY WHOMADETHISLINE', 40, 68);
    c.textAlign = 'right'; c.fillStyle = '#8C939C'; c.font = `700 34px ${FD}`; c.fillText('10,000 REPLAYS PER GAME · 25 QUESTIONS PER PROP', W - 40, 62); c.textAlign = 'left';
    const cols = [[60, 'SPORT'], [360, 'SLATE'], [1500, 'WHEN'], [2100, 'GAMES'], [2500, 'PRICED'], [2950, 'BETS'], [3350, 'LIVE WATCH']];
    const top = 170, rh = Math.min(120, (H - top - 30) / Math.max(L.length, 1));
    c.font = `700 30px ${FD}`; c.fillStyle = '#6D747D'; cols.forEach(([x, s]) => c.fillText(s, x, top - 24));
    L.forEach((s, i) => { const y = top + i * rh; if(i % 2){ c.fillStyle = 'rgba(40,46,56,.35)'; c.fillRect(30, y, W - 60, rh); }
      const fs = Math.round(rh * .5), yy = y + rh * .68; c.font = `800 ${fs}px ${FD}`;
      c.fillStyle = '#' + (SPORTC[s.sport] || '9FB2C8'); c.fillText(s.sport, 60, yy);
      c.fillStyle = '#F2F1EC'; c.fillText(String(s.title || '').toUpperCase(), 360, yy); c.font = `700 ${fs}px ${FD}`;
      c.fillStyle = '#B4B6B8'; c.fillText(String(s.when || '').toUpperCase(), 1500, yy);
      if(s.built){ c.fillText(String(s.games), 2100, yy); c.fillText(String(s.priced), 2500, yy);
        c.fillStyle = s.bets ? '#3FD08F' : '#7C8188'; c.fillText(String(s.bets), 2950, yy); c.fillStyle = s.watch ? '#F2A93B' : '#7C8188'; c.fillText(String(s.watch), 3350, yy); }
      else { c.fillStyle = '#7C8188'; c.fillText('NOT BUILT YET', 2100, yy); } });
    t.needsUpdate = true;
  }
  function drawTicker(t, L){
    const c = t.userData.ctx, W = t.userData.canvas.width, H = t.userData.canvas.height; c.fillStyle = '#0a0806'; c.fillRect(0, 0, W, H);
    const items = L.filter(s => s.built).map(s => `${s.sport}  ${String(s.title).toUpperCase()}  ·  ${s.bets} BET${s.bets === 1 ? '' : 'S'}  ·  ${s.watch} LIVE WATCH`);
    if(!items.length) items.push('OVERLAY');
    let x = 20; c.font = `800 56px ${FD}`; c.textBaseline = 'middle'; let i = 0;
    while(x < W){ const s = items[i % items.length] + '     ◆     '; c.fillStyle = i % 2 ? '#F2A93B' : '#F3DDB0'; c.fillText(s, x, H/2 + 2); x += c.measureText(s).width; i++; }
    t.needsUpdate = true;
  }

  /* ---------------- lights */
  const rowSpots = [];
  function lights(){
    scene.add(new THREE.HemisphereLight(0x9fb2c8, 0x0b0907, .28));
    const wallWash = new THREE.PointLight(0x5d8de0, 2.2, 42, 1.6); wallWash.position.set(0, 6.5, -21); scene.add(wallWash);
    Object.entries(ROW).forEach(([s, R], i) => { const sp = new THREE.SpotLight(0xffe2c4, 2.4, 34, .52, .75, 1.4); sp.position.set(0, 11.6, R.z + 2); sp.target.position.set(0, 0, R.z); sp.castShadow = !lowPower && (i === 1 || i === 2); sp.shadow.mapSize.set(1024, 1024); sp.shadow.bias = -.0004; sp.shadow.radius = 6; scene.add(sp, sp.target); rowSpots.push(sp); });
    const ctr = new THREE.SpotLight(0xffc48a, 2.0, 22, .6, .8, 1.3); ctr.position.set(COUNTER.x + 7, 11, COUNTER.z); ctr.target.position.set(COUNTER.x + 1, 0, COUNTER.z); scene.add(ctr, ctr.target);
    const lng = new THREE.SpotLight(0x8ff0e0, 1.6, 22, .7, .8, 1.3); lng.position.set(LOUNGE.x, 11, LOUNGE.z); lng.target.position.set(LOUNGE.x, 0, LOUNGE.z); scene.add(lng, lng.target);
    const seatWash = new THREE.PointLight(0xffc690, 1.2, 30, 1.5); seatWash.position.set(0, 9, 19); scene.add(seatWash);
  }
  /* ---------------- haze, dust in the light */
  function atmosphere(){
    const coneMat = new THREE.ShaderMaterial({uniforms: {color: {value: new THREE.Color(0xffdcb0)}}, vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y; vec4 wp = modelMatrix*vec4(position,1.); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition-wp.xyz); gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `uniform vec3 color; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float h = clamp((vY+5.5)/11.,0.,1.); float f = pow(abs(dot(normalize(vN),normalize(vV))),1.5); gl_FragColor = vec4(color*.045*h*f, 1.); }`, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide});
    Object.values(ROW).forEach(R => { const c = new THREE.Mesh(new THREE.CylinderGeometry(.35, 6.5, 11, 40, 1, true), coneMat); c.position.set(0, 6.1, R.z + 1); scene.add(c); });
    const n = lowPower ? 220 : 650; const g = new THREE.BufferGeometry(); const p = new Float32Array(n * 3); for(let i = 0; i < n; i++){ p[i*3] = (rnd() - .5) * 30; p[i*3+1] = .5 + rnd() * 10.5; p[i*3+2] = -18 + rnd() * 26; } g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    dust = new THREE.Points(g, new THREE.PointsMaterial({map: tx.glow, size: .06, color: new THREE.Color(0xffe6c8).multiplyScalar(1.4), transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true})); scene.add(dust);
  }

  /* ---------------- planar reflection for the stone floor (real, blurred) */
  function reflection(){
    const scale = lowPower ? .3 : .5; const rt = new THREE.WebGLRenderTarget(512, 512, {type: THREE.HalfFloatType}); const vcam = new THREE.PerspectiveCamera();
    const tm = new THREE.Matrix4(); const mat = new THREE.ShaderMaterial({uniforms: {tDiffuse: {value: rt.texture}, textureMatrix: {value: tm}, strength: {value: .5}, texel: {value: new THREE.Vector2(1/512, 1/512)}},
      vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW; void main(){ vUv = textureMatrix*vec4(position,1.); vec4 wp = modelMatrix*vec4(position,1.); vW = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `vec3 safe(vec3 c){ 
#if __VERSION__ >= 300
 if(any(isnan(c)) || any(isinf(c))) return vec3(0.);
#endif
 return clamp(c, 0., 64.); }
uniform sampler2D tDiffuse; uniform float strength; uniform vec2 texel; varying vec4 vUv; varying vec3 vW;
        void main(){ vec2 uv = vUv.xy / vUv.w; vec3 c = vec3(0.); float w = 0.; for(int i=-2;i<=2;i++){ for(int j=-2;j<=2;j++){ float k = exp(-float(i*i+j*j)*.35); c += safe(texture2D(tDiffuse, uv + vec2(float(i),float(j))*texel*2.2).rgb)*k; w += k; } } c /= w;
          vec3 v = normalize(cameraPosition - vW); float fres = .14 + .46*pow(1.-clamp(v.y,0.,1.), 4.); float fade = smoothstep(32.,18.,abs(vW.x))*smoothstep(31.,20.,abs(vW.z+2.));
          gl_FragColor = vec4(c*strength*fres*fade, 1.); }`, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending});
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(66, 64), mat); plane.rotation.x = -Math.PI/2; plane.position.y = .004; plane.renderOrder = 2; scene.add(plane);
    refl = {rt, vcam, tm, plane, scale, mat};
  }
  const _rp = new THREE.Vector3(), _cp = new THREE.Vector3(), _rm = new THREE.Matrix4(), _la = new THREE.Vector3(), _n = new THREE.Vector3(0, 1, 0), _tgt = new THREE.Vector3(), _vw = new THREE.Vector3(), _pl = new THREE.Plane(), _cl = new THREE.Vector4(), _q = new THREE.Vector4();
  function renderReflection(){
    const {rt, vcam, tm, plane} = refl; plane.updateMatrixWorld(); _rp.setFromMatrixPosition(plane.matrixWorld); _cp.setFromMatrixPosition(camera.matrixWorld); _rm.extractRotation(plane.matrixWorld); _n.set(0, 0, 1).applyMatrix4(_rm);
    _vw.subVectors(_rp, _cp); if(_vw.dot(_n) > 0) return; _vw.reflect(_n).negate(); _vw.add(_rp);
    _rm.extractRotation(camera.matrixWorld); _la.set(0, 0, -1).applyMatrix4(_rm).add(_cp); _tgt.subVectors(_rp, _la); _tgt.reflect(_n).negate(); _tgt.add(_rp);
    vcam.position.copy(_vw); vcam.up.set(0, 1, 0).applyMatrix4(_rm).reflect(_n); vcam.lookAt(_tgt); vcam.far = camera.far; vcam.updateMatrixWorld(); vcam.projectionMatrix.copy(camera.projectionMatrix);
    tm.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1); tm.multiply(vcam.projectionMatrix); tm.multiply(vcam.matrixWorldInverse); tm.multiply(plane.matrixWorld);
    _pl.setFromNormalAndCoplanarPoint(_n, _rp); _pl.applyMatrix4(vcam.matrixWorldInverse); _cl.set(_pl.normal.x, _pl.normal.y, _pl.normal.z, _pl.constant);
    const pm = vcam.projectionMatrix; _q.x = (Math.sign(_cl.x) + pm.elements[8]) / pm.elements[0]; _q.y = (Math.sign(_cl.y) + pm.elements[9]) / pm.elements[5]; _q.z = -1; _q.w = (1 + pm.elements[10]) / pm.elements[14];
    _cl.multiplyScalar(2 / _cl.dot(_q)); pm.elements[2] = _cl.x; pm.elements[6] = _cl.y; pm.elements[10] = _cl.z + 1 - .003; pm.elements[14] = _cl.w;
    plane.visible = false; const sh = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false; const fog = scene.fog; renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, vcam); renderer.setRenderTarget(null); renderer.shadowMap.autoUpdate = sh; plane.visible = true;
  }

  /* ---------------- post: HDR -> bloom -> ACES -> grain + vignette + soft chromatic fringe */
  function postFX(){
    const gl2 = renderer.capabilities.isWebGL2; const opts = {type: THREE.HalfFloatType};
    const rtMain = new THREE.WebGLRenderTarget(4, 4, Object.assign({samples: gl2 ? 4 : 0}, opts));
    const rtA = new THREE.WebGLRenderTarget(4, 4, opts), rtB = new THREE.WebGLRenderTarget(4, 4, opts), rtC = new THREE.WebGLRenderTarget(4, 4, opts), rtD = new THREE.WebGLRenderTarget(4, 4, opts);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); const qs = new THREE.Scene(); qs.add(quad); const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const SAFE = `vec3 safe(vec3 c){ 
#if __VERSION__ >= 300
 if(any(isnan(c)) || any(isinf(c))) return vec3(0.);
#endif
 return clamp(c, 0., 64.); }
`;
    const V = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
    const bright = new THREE.ShaderMaterial({uniforms: {t: {value: null}, th: {value: 1.0}}, vertexShader: V, fragmentShader: SAFE + `uniform sampler2D t; uniform float th; varying vec2 vUv; void main(){ vec3 c = safe(texture2D(t, vUv).rgb); float l = dot(c, vec3(.2126,.7152,.0722)); gl_FragColor = vec4(c * smoothstep(th, th + .9, l), 1.); }`, toneMapped: false});
    const blur = new THREE.ShaderMaterial({uniforms: {t: {value: null}, dir: {value: new THREE.Vector2()}}, vertexShader: V, fragmentShader: SAFE + `uniform sampler2D t; uniform vec2 dir; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb*.227; c += texture2D(t, vUv+dir*1.384).rgb*.316; c += texture2D(t, vUv-dir*1.384).rgb*.316; c += texture2D(t, vUv+dir*3.230).rgb*.070; c += texture2D(t, vUv-dir*3.230).rgb*.070; gl_FragColor = vec4(safe(c),1.); }`, toneMapped: false});
    const comp = new THREE.ShaderMaterial({uniforms: {t: {value: rtMain.texture}, b1: {value: rtB.texture}, b2: {value: rtD.texture}, time: {value: 0}, res: {value: new THREE.Vector2()}},
      vertexShader: V, fragmentShader: SAFE + `uniform sampler2D t; uniform sampler2D b1; uniform sampler2D b2; uniform float time; uniform vec2 res; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
        void main(){ vec2 d = vUv - .5; float r2 = dot(d,d); vec2 ca = d * r2 * .006;
          vec3 c = safe(vec3(texture2D(t, vUv + ca).r, texture2D(t, vUv).g, texture2D(t, vUv - ca).b));
          c += safe(texture2D(b1, vUv).rgb) * .55 + safe(texture2D(b2, vUv).rgb) * .75;
          c *= mix(1., .55, smoothstep(.12, .62, r2*1.8));
          gl_FragColor = vec4(c, 1.);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
          gl_FragColor.rgb += (h(vUv*res + fract(time)*91.) - .5) * .028; }`});
    post = {rtMain, rtA, rtB, rtC, rtD, quad, qs, qc, bright, blur, comp};
  }
  function sizePost(w, h){ const pr = renderer.getPixelRatio(); const W = Math.floor(w * pr), H = Math.floor(h * pr); post.rtMain.setSize(W, H); post.rtA.setSize(W >> 1, H >> 1); post.rtB.setSize(W >> 1, H >> 1); post.rtC.setSize(W >> 3, H >> 3); post.rtD.setSize(W >> 3, H >> 3); post.comp.uniforms.res.value.set(W, H);
    if(refl){ refl.rt.setSize(Math.max(64, W * refl.scale | 0), Math.max(64, H * refl.scale | 0)); refl.mat.uniforms.texel.value.set(1 / (W * refl.scale), 1 / (H * refl.scale)); } }
  function pass(mat, target){ post.quad.material = mat; renderer.setRenderTarget(target); renderer.render(post.qs, post.qc); }
  function renderFrame(time){
    if(refl) renderReflection();
    renderer.setRenderTarget(post.rtMain); renderer.render(scene, camera);
    const {bright, blur, rtA, rtB, rtC, rtD} = post;
    bright.uniforms.t.value = post.rtMain.texture; pass(bright, rtA);
    blur.uniforms.t.value = rtA.texture; blur.uniforms.dir.value.set(1 / rtA.width, 0); pass(blur, rtB); blur.uniforms.t.value = rtB.texture; blur.uniforms.dir.value.set(0, 1 / rtA.height); pass(blur, rtA);
    blur.uniforms.t.value = rtA.texture; blur.uniforms.dir.value.set(1 / rtA.width, 0); pass(blur, rtB); // rtB = half-res bloom
    blur.uniforms.t.value = rtB.texture; blur.uniforms.dir.value.set(1 / rtC.width, 0); pass(blur, rtC); blur.uniforms.t.value = rtC.texture; blur.uniforms.dir.value.set(0, 1 / rtC.height); pass(blur, rtD);
    blur.uniforms.t.value = rtD.texture; blur.uniforms.dir.value.set(2 / rtC.width, 0); pass(blur, rtC); blur.uniforms.t.value = rtC.texture; blur.uniforms.dir.value.set(0, 2 / rtC.height); pass(blur, rtD); // rtD = wide bloom
    post.comp.uniforms.time.value = time; pass(post.comp, null);
  }

  /* ---------------- camera */
  function resize(){ if(!renderer || !host()) return; const w = Math.max(1, host().clientWidth), h = Math.max(1, host().clientHeight); renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 62 : 46; camera.updateProjectionMatrix(); sizePost(w, h); }
  function place(){ const t = cam; const y = t.ty + Math.sin(t.el) * t.dist, r = Math.cos(t.el) * t.dist; camera.position.set(clamp(t.tx + Math.sin(t.az) * r, -31.5, 31.5), clamp(y, .6, 11.4), clamp(t.tz + Math.cos(t.az) * r, -27, 30.5)); camera.lookAt(t.tx, t.ty, t.tz); }
  function homeView(){ const ph = portrait(); return ph ? {az: 0, el: .17, dist: 19, tx: 0, ty: 2.6, tz: -3.2} : {az: 0, el: .24, dist: 20, tx: 0, ty: 2.8, tz: -3}; }
  function home(){ go(homeView(), 1.4); }

  function focus(id){ const s = stations.find(x => x.s.key === id); if(!s) return; const p = s.grp.position; go({az: 0, tx: p.x, ty: 2.4, tz: p.z, dist: portrait() ? 10 : 8, el: .14}); }

  function go(to, dur = 1.1){ const from = {...cam}; if(to.az != null){ let d = to.az - from.az; while(d > Math.PI) d -= Math.PI*2; while(d < -Math.PI) d += Math.PI*2; to.az = from.az + d; } intro = null; if(RM){ Object.assign(cam, to); return; } tween = {from, to: Object.assign({}, from, to), t: 0, dur}; }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function bind(){
    const el = renderer.domElement; el.tabIndex = -1; el.style.outline = 'none'; const pts = new Map(); let downAt = null, moved = 0, pinch0 = null;
    el.addEventListener('pointerdown', e => { try{ el.focus({preventScroll: true}); }catch(_){} el.setPointerCapture(e.pointerId); pts.set(e.pointerId, {x: e.clientX, y: e.clientY}); downAt = {x: e.clientX, y: e.clientY, t: performance.now()}; moved = 0; tween = null; intro = null; if(pts.size === 2){ const [a, b] = [...pts.values()]; pinch0 = {d: Math.hypot(a.x-b.x, a.y-b.y), dist: cam.dist}; } });
    el.addEventListener('pointermove', e => { const p = pts.get(e.pointerId); if(!p){ if(e.pointerType === 'mouse') hover(e); return; } const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if(pts.size === 2 && pinch0){ const [a, b] = [...pts.values()]; cam.dist = clamp(pinch0.dist * pinch0.d / Math.hypot(a.x-b.x, a.y-b.y), 4, 40); }
      else if(pts.size === 1){ if(e.shiftKey || e.buttons === 2){ cam.az -= dx * .005; } else { cam.az -= dx * .0035; cam.el = clamp(cam.el + dy * .003, .02, 1.05); } } });
    const up = e => { pts.delete(e.pointerId); if(pts.size < 2) pinch0 = null; if(downAt && moved < 10 && performance.now() - downAt.t < 600) tap(e); downAt = null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', e => { pts.delete(e.pointerId); downAt = null; });
    el.addEventListener('wheel', e => { if(!(e.ctrlKey || e.metaKey || document.activeElement === el)) return; e.preventDefault(); cam.dist = clamp(cam.dist * (1 + Math.sign(e.deltaY) * .08), 4, 40); }, {passive: false});
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerleave', () => { label.style.display = 'none'; });
    addEventListener('resize', resize); document.addEventListener('visibilitychange', () => { visible = !document.hidden; if(visible && !raf) raf = requestAnimationFrame(loop); });
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function hit(e){ const r = renderer.domElement.getBoundingClientRect(); ndc.set((e.clientX - r.left)/r.width*2 - 1, -(e.clientY - r.top)/r.height*2 + 1); ray.setFromCamera(ndc, camera); const h = ray.intersectObjects(picks, false)[0]; return h && h.object.userData; }
  function tap(e){ const u = hit(e); if(!u) return; if(u.kind === 'sport'){ focus(u.id); if(CB.onSport) setTimeout(() => CB.onSport(u.id), RM ? 0 : 650); } else if(u.kind === 'board'){ home(); } }
  function hover(e){ const u = hit(e); renderer.domElement.style.cursor = u ? 'pointer' : 'grab'; let t = '';
    if(u && u.kind === 'sport'){ const s = LOBBY.find(x => x.key === u.id); if(s) t = `${s.sport} · ${s.title}`; }
    if(t){ label.textContent = t; label.style.left = e.clientX + 'px'; label.style.top = e.clientY + 'px'; label.style.display = 'block'; } else label.style.display = 'none'; }

  /* ---------------- frame loop */
  const _wp = new THREE.Vector3();
  function loop(now){
    raf = 0; if(!visible || paused) return; const dt = Math.min(.05, (now - last) / 1000 || .016); last = now; const t = (now - T0) / 1000;
    if(intro){ const h = homeView(); const k = 1 - Math.pow(.0009, dt); ['az','el','dist','tx','ty','tz'].forEach(key => cam[key] += (h[key] - cam[key]) * k * .55); if(Math.abs(cam.az - h.az) < .002 && Math.abs(cam.dist - h.dist) < .05) intro = null; }
    if(tween){ tween.t = Math.min(1, tween.t + dt / tween.dur); const e = tween.t < .5 ? 4*tween.t**3 : 1 - Math.pow(-2*tween.t + 2, 3)/2; ['az','el','dist','tx','ty','tz'].forEach(k => cam[k] = tween.from[k] + (tween.to[k] - tween.from[k]) * e); if(tween.t >= 1) tween = null; }
    if(!RM && !tween && !intro){ cam.az += Math.sin(t * .05) * .00012; }
    place();
    holos.forEach(m => { if(m.uniforms && m.uniforms.time) m.uniforms.time.value = t; });
    if(wallMat) wallMat.uniforms.time.value = t;
    tickers.forEach(tk => { tk.offset.x = (t * .018) % 1; });
    if(!RM){ spinners.forEach(s => s.o.rotation.z = t * s.s); if(liveRing) liveRing.rotation.y = t * .06; stations.forEach((s, i) => { const hgp = s.grp.children.find(o => o.isGroup); if(hgp) hgp.position.y = 3.0 + Math.sin(t * 1.1 + i) * .05; });
      if(dust){ const a = dust.geometry.attributes.position; for(let i = 0; i < a.count; i++){ let y = a.getY(i) + dt * .05; if(y > 11) y = .5; a.setY(i, y); a.setX(i, a.getX(i) + Math.sin(t * .2 + i) * .0015); } a.needsUpdate = true; } }
    const cp = camera.position;
    billboards.forEach(o => { o.getWorldPosition(_wp); const parentRot = o.parent && o.parent.rotation ? o.parent.rotation.y : 0; o.rotation.y = Math.atan2(cp.x - _wp.x, cp.z - _wp.z) - (o.parent && o.parent !== root && o.parent.parent === root ? 0 : 0) - parentRot; });
    nearPanels.forEach(o => { o.getWorldPosition(_wp); const dd = Math.hypot(cp.x - _wp.x, cp.z - _wp.z); const f = clamp((15 - dd) / 4, 0, 1); o.material.uniforms.fade.value += (f - o.material.uniforms.fade.value) * .12; o.visible = o.material.uniforms.fade.value > .01; });
    liveCards.forEach(o => { o.getWorldPosition(_wp); o.rotation.y = Math.atan2(cp.x - _wp.x, cp.z - _wp.z) - (liveRing ? liveRing.rotation.y : 0); });
    renderFrame(t);
    raf = requestAnimationFrame(loop);
  }
  function pause(v){ paused = v; if(!v && !raf && ok){ last = performance.now(); raf = requestAnimationFrame(loop); } }
  return {init, build, home, focus, pause, resize, get ready(){ return ok; }};
})();
window.World = World;
