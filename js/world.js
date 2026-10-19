/* ============================================================
   world.js — procedural 3D environments for the 9 stages
   ============================================================ */
(function () {
  const W = {};

  /* ---------------- procedural canvas textures ---------------- */
  function cvs(size) {
    const c = document.createElement("canvas");
    c.width = c.height = size; return c;
  }
  function noiseFill(g, size, base, variance, alpha) {
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    const img = g.getImageData(0, 0, size, size), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * variance;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
      if (alpha !== undefined) d[i + 3] = alpha;
    }
    g.putImageData(img, 0, 0);
  }
  function toTex(c, rx, ry) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx || 1, ry || 1);
    t.anisotropy = 4;
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  const texCache = {};
  let dotTexCache = null;
  function dotTex() {
    if (dotTexCache) return dotTexCache;
    const c = cvs(64), g = c.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.35, "rgba(255,255,255,0.6)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.beginPath(); g.arc(32, 32, 32, 0, 7); g.fill();
    dotTexCache = new THREE.CanvasTexture(c);
    dotTexCache.encoding = THREE.sRGBEncoding;
    return dotTexCache;
  }
  function groundTex(kind, repeat) {
    const key = kind + "|" + repeat;
    if (texCache[key]) return texCache[key];
    const size = 256, c = cvs(size), g = c.getContext("2d");
    if (kind === "asphalt") {
      noiseFill(g, size, "#2b2f38", 34);
      g.strokeStyle = "rgba(230,230,180,0.16)"; g.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const y = Math.random() * size;
        g.beginPath(); g.moveTo(0, y); g.lineTo(size, y + (Math.random() - .5) * 20); g.stroke();
      }
    } else if (kind === "tile") {
      noiseFill(g, size, "#242a36", 22);
      g.strokeStyle = "rgba(160,190,240,0.16)"; g.lineWidth = 3;
      for (let i = 0; i <= 4; i++) {
        const p = i * size / 4;
        g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.stroke();
        g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
      }
    } else if (kind === "grass") {
      noiseFill(g, size, "#2f5d33", 46);
      for (let i = 0; i < 400; i++) {
        g.fillStyle = "rgba(" + (40 + Math.random() * 60 | 0) + "," + (90 + Math.random() * 80 | 0) + ",60,0.5)";
        g.fillRect(Math.random() * size, Math.random() * size, 2, 4);
      }
    } else if (kind === "sand") {
      noiseFill(g, size, "#b09a6e", 38);
      for (let i = 0; i < 300; i++) {
        g.fillStyle = "rgba(200,180,140,0.25)";
        g.fillRect(Math.random() * size, Math.random() * size, 3, 2);
      }
    } else if (kind === "rock") {
      noiseFill(g, size, "#4a4038", 52);
      g.strokeStyle = "rgba(20,16,12,0.55)"; g.lineWidth = 2;
      for (let i = 0; i < 22; i++) {
        g.beginPath();
        let x = Math.random() * size, y = Math.random() * size;
        g.moveTo(x, y);
        for (let j = 0; j < 4; j++) { x += (Math.random() - .5) * 70; y += (Math.random() - .5) * 70; g.lineTo(x, y); }
        g.stroke();
      }
    } else if (kind === "metal") {
      noiseFill(g, size, "#3a4150", 18);
      g.strokeStyle = "rgba(150,180,230,0.2)"; g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) { const p = i * size / 4; g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke(); }
      g.fillStyle = "rgba(190,210,240,0.25)";
      for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(Math.random() * size, Math.random() * size, 2, 0, 7); g.fill(); }
    } else if (kind === "lava") {
      noiseFill(g, size, "#2b1008", 40);
      // dark basalt plates
      g.strokeStyle = "rgba(10,5,3,0.8)"; g.lineWidth = 3;
      for (let i = 0; i < 26; i++) {
        g.beginPath();
        let x = Math.random() * size, y = Math.random() * size; g.moveTo(x, y);
        for (let j = 0; j < 5; j++) { x += (Math.random() - .5) * 84; y += (Math.random() - .5) * 84; g.lineTo(x, y); }
        g.stroke();
      }
      // glowing fissures
      for (let i = 0; i < 22; i++) {
        g.strokeStyle = "rgba(255," + (110 + Math.random() * 90 | 0) + ",30," + (0.35 + Math.random() * 0.35).toFixed(2) + ")";
        g.lineWidth = 1.2 + Math.random() * 3;
        g.beginPath();
        let x = Math.random() * size, y = Math.random() * size; g.moveTo(x, y);
        for (let j = 0; j < 4; j++) { x += (Math.random() - .5) * 90; y += (Math.random() - .5) * 90; g.lineTo(x, y); }
        g.stroke();
      }
      // a few hot pools
      for (let i = 0; i < 14; i++) {
        const x = Math.random() * size, y = Math.random() * size, r = 10 + Math.random() * 22;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, "rgba(255,214,120,0.7)");
        grd.addColorStop(0.5, "rgba(255,116,20,0.4)");
        grd.addColorStop(1, "rgba(120,16,4,0)");
        g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      }
    } else if (kind === "void") {
      noiseFill(g, size, "#0a0e1e", 12);
      for (let i = 0; i < 160; i++) {
        g.fillStyle = "rgba(160,200,255," + (0.25 + Math.random() * 0.6) + ")";
        const s = Math.random() < .85 ? 1 : 2;
        g.fillRect(Math.random() * size, Math.random() * size, s, s);
      }
    } else if (kind === "snow") {
      noiseFill(g, size, "#c8d6e6", 16);
      for (let i = 0; i < 60; i++) {
        g.fillStyle = "rgba(255,255,255,0.5)";
        g.beginPath(); g.arc(Math.random() * size, Math.random() * size, 3 + Math.random() * 8, 0, 7); g.fill();
      }
    } else { noiseFill(g, size, "#333", 30); }
    const t = toTex(c, repeat || 24, repeat || 24);
    texCache[key] = t;
    return t;
  }

  function windowTex(litA, litB, base) {
    const key = "win" + litA + litB + base;
    if (texCache[key]) return texCache[key];
    const size = 256, c = cvs(size), g = c.getContext("2d");
    g.fillStyle = base || "#151a26"; g.fillRect(0, 0, size, size);
    const cols = 10, rows = 14, pad = 3;
    const w = size / cols, h = size / rows;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const r = Math.random();
      if (r < 0.42) continue;
      g.fillStyle = r < 0.72 ? litA : litB;
      g.fillRect(x * w + pad, y * h + pad, w - pad * 2, h - pad * 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    texCache[key] = t;
    return t;
  }

  function skyTex(top, mid, bottom) {
    const key = "sky" + top + mid + bottom;
    if (texCache[key]) return texCache[key];
    const c = document.createElement("canvas"); c.width = 16; c.height = 256;
    const g = c.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, top); grd.addColorStop(0.5, mid); grd.addColorStop(1, bottom);
    g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 2;
    t.encoding = THREE.sRGBEncoding;
    texCache[key] = t;
    return t;
  }

  /* asphalt with lane markings — one canvas that repeats along a street so a
     whole road network costs a handful of meshes */
  function roadTex() {
    if (texCache.road) return texCache.road;
    const size = 256, c = cvs(size), g = c.getContext("2d");
    noiseFill(g, size, "#23262c", 24);
    g.fillStyle = "rgba(0,0,0,0.18)";
    for (let i = 0; i < 18; i++) g.fillRect(Math.random() * size, Math.random() * size, 12 + Math.random() * 44, 5 + Math.random() * 14);
    g.fillStyle = "rgba(236,228,170,0.8)";
    for (let y = 4; y < size; y += 40) g.fillRect(size / 2 - 3, y, 6, 20);   // centre dashes
    g.fillStyle = "rgba(226,226,226,0.5)";
    g.fillRect(8, 0, 4, size); g.fillRect(size - 12, 0, 4, size);            // edge lines
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.encoding = THREE.sRGBEncoding;
    texCache.road = t;
    return t;
  }

  function walkTex() {
    if (texCache.walk) return texCache.walk;
    const size = 128, c = cvs(size), g = c.getContext("2d");
    noiseFill(g, size, "#7d818a", 18);
    g.strokeStyle = "rgba(40,42,48,0.5)"; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * size / 4, 0); g.lineTo(i * size / 4, size); g.stroke();
      g.beginPath(); g.moveTo(0, i * size / 4); g.lineTo(size, i * size / 4); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    texCache.walk = t;
    return t;
  }

  function stripeTex(a, b) {
    const key = "stripe" + a + b;
    if (texCache[key]) return texCache[key];
    const size = 128, c = cvs(size), g = c.getContext("2d");
    g.fillStyle = a; g.fillRect(0, 0, size, size);
    g.fillStyle = b;
    for (let i = -size; i < size * 2; i += 32) {
      g.save(); g.translate(i, 0); g.rotate(0.5); g.fillRect(0, -size, 16, size * 3); g.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    texCache[key] = t;
    return t;
  }

  const SIGN_WORDS = ["ULTRA", "KAJU", "RAMEN", "GOLD", "TOKYO", "SODA", "OSAKA", "MEGA", "ZONE", "NEO"];
  function signTex(shift) {
    const key = "sign" + (shift | 0);
    if (texCache[key]) return texCache[key];
    const w = 128, h = 64, c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    const hue = (shift * 47) % 360;
    g.fillStyle = "hsl(" + hue + ",70%,28%)"; g.fillRect(0, 0, w, h);
    g.fillStyle = "hsl(" + ((hue + 180) % 360) + ",85%,62%)";
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) g.fillRect(6 + Math.random() * (w - 40), 6 + Math.random() * (h - 24), 16 + Math.random() * 30, 10 + Math.random() * 14);
    g.fillStyle = "#fff";
    g.font = "bold 17px sans-serif";
    g.fillText(SIGN_WORDS[shift % SIGN_WORDS.length], 7, h - 9);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    texCache[key] = t;
    return t;
  }

  /* vertical gradient used for lava falls and energy spills */
  function fallTex() {
    if (texCache.fall) return texCache.fall;
    const w = 64, h = 128, c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, "rgba(255,246,196,0.95)");
    grd.addColorStop(0.35, "rgba(255,170,60,0.8)");
    grd.addColorStop(0.78, "rgba(255,92,20,0.45)");
    grd.addColorStop(1, "rgba(120,30,0,0.1)");
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 12; i++) {
      g.fillStyle = "rgba(255,224,130," + (0.05 + Math.random() * 0.2).toFixed(2) + ")";
      g.fillRect(Math.random() * w, 0, 1 + Math.random() * 3, h);
    }
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    texCache.fall = t;
    return t;
  }

  function cloudTex() {
    if (texCache.cloud) return texCache.cloud;
    const size = 128, c = cvs(size), g = c.getContext("2d");
    g.clearRect(0, 0, size, size);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * size, y = Math.random() * size, r = 10 + Math.random() * 26;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, "rgba(255,255,255,0.55)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    texCache.cloud = t;
    return t;
  }

  /* ---------------- helpers ---------------- */
  const RNG = (function () { let s = 1; return function (a) { s = (s * 9301 + 49297) % 233280; return a === undefined ? s / 233280 : (s / 233280) * a; }; })();
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  function lmat(color, opts) {
    const o = Object.assign({}, opts || {});
    o.color = lin(color);
    return new THREE.MeshLambertMaterial(o);
  }
  // three.js treats material colours as linear; our hex values are authored in sRGB
  function lin(hex) {
    const c = new THREE.Color(hex);
    c.convertSRGBToLinear();
    return c;
  }

  /* ---------------- prop system ----------------
     Level dressing used to be raw meshes, which meant nothing in the game
     could reason about it.  Every prop now carries its properties in
     `userData` so the rest of the engine treats them uniformly:

       kind         "building" | "tree" | "lamp" | …  (fx colour, stats)
       hp           hit points
       destructible pushed into stage.destructibles  -> hitProp / destroyProp
       fade         fades out when it blocks the camera (see updateOccluders)
       radius       attack / beam hit radius (XZ)
       solid        pushes fighters out of it (see W.collide)
       solidR       collision radius, defaults to `radius`
       height       vertical extent, used for fx anchors
       size         [w,h,d] used when it is smashed into rubble

     Shared unit geometries + a material cache keep a few hundred extra props
     cheap: everything below is a scaled instance of one of these.        */
  const GEO = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
    cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
    cone: new THREE.ConeGeometry(1, 1, 8),
    sph: new THREE.SphereGeometry(1, 10, 8),
    ring: new THREE.TorusGeometry(1, 0.14, 6, 16),
    plane: new THREE.PlaneGeometry(1, 1),
  };
  const PMAT = {};
  function pm(key, color, opts) {
    if (!PMAT[key]) PMAT[key] = lmat(color, opts);
    return PMAT[key];
  }
  // scaled instance of a shared unit geometry
  function gm(geo, mat, sx, sy, sz) {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz === undefined ? sx : sz);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  function addProp(group, stage, mesh, meta) {
    const ud = Object.assign({
      kind: "prop", hp: 60, destructible: false, solid: false, fade: false,
      radius: 2, height: 3,
    }, meta || {});
    if (ud.solidR === undefined) ud.solidR = ud.radius;
    if (ud.size === undefined) ud.size = [ud.radius * 1.5, ud.height, ud.radius * 1.5];
    mesh.userData = ud;
    group.add(mesh);
    if (ud.destructible) stage.destructibles.push(mesh);
    if (ud.solid) stage.solids.push(mesh);
    return mesh;
  }

  /* soft push out of solid props — resolved over a couple of frames so the
     player slides along a wall instead of being wedged into it */
  W.collide = function (stage, pos, radius) {
    const solids = stage.solids;
    if (!solids || !solids.length) return false;
    let hit = false;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      const ud = s.userData;
      if (!ud || ud.broken) continue;
      const dx = pos.x - s.position.x, dz = pos.z - s.position.z;
      const rr = (ud.solidR || 2) + radius;
      const dd = dx * dx + dz * dz;
      if (dd >= rr * rr) continue;
      const dist = Math.sqrt(dd) || 0.0001;
      let nx, nz;
      if (dist < 0.001) { nx = 1; nz = 0; }        // dead centre: shove it out sideways
      else { nx = dx / dist; nz = dz / dist; }
      const push = Math.min(rr - dist, 2.6);
      pos.x += nx * push;
      pos.z += nz * push;
      hit = true;
    }
    return hit;
  };

  /* ---------------- stage definitions ---------------- */
  const STAGES = [
    {
      name: "TOKYO RAMPAGE", sub: "A kaiju makes landfall downtown.",
      sky: ["#1b3a6b", "#5b8fd0", "#bcd8f0"], fog: ["#9fc2e0", 60, 260],
      ground: "asphalt", groundColor: 0xffffff,
      ambient: ["#8fb4e0", 0.75], sun: ["#ffe9c4", 1.05, [60, 90, 40]],
      biome: "city", mood: "day",
      mobs: ["kaiju_jamila"], boss: "kaiju_bemular", mobH: 3.0, bossH: 7.2,
    },
    {
      name: "RED KING'S RAMPAGE", sub: "The ruins burn. Red King is loose.",
      sky: ["#3a1330", "#a33a26", "#e9a13f"], fog: ["#8a4a2a", 50, 230],
      ground: "asphalt", groundColor: 0xbfae9c,
      ambient: ["#e0a070", 0.7], sun: ["#ffb066", 1.1, [-70, 70, 30]],
      biome: "ruins", mood: "sunset",
      mobs: ["kaiju_bemular"], boss: "kaiju_redking", mobH: 3.2, bossH: 8.2,
    },
    {
      name: "SKY SIEGE", sub: "Air battle above the cloud sea. Take flight.",
      sky: ["#0d3f7a", "#3f9ae0", "#e6f4ff"], fog: ["#cfe6ff", 45, 190],
      ground: "rock", groundColor: 0xb0bcc8,
      ambient: ["#cfe6ff", 0.62], sun: ["#ffffff", 0.72, [30, 120, -40]],
      biome: "sky", mood: "sky", fly: true,
      mobs: ["kaiju_birdon"], boss: "kaiju_birdon", mobH: 3.4, bossH: 8.0,
    },
    {
      name: "BALTAN'S TRAP", sub: "Clones everywhere. Find the real alien.",
      sky: ["#070a1c", "#1a2470", "#3a2a80"], fog: ["#241a4a", 40, 200],
      ground: "tile", groundColor: 0x9fa8d0,
      ambient: ["#8f7fe0", 0.6], sun: ["#b090ff", 0.9, [40, 80, -60]],
      biome: "aliencity", mood: "night",
      mobs: ["kaiju_baltan"], boss: "kaiju_baltan", mobH: 3.3, bossH: 7.6,
    },
    {
      name: "UNDERGROUND LAIR", sub: "Lightless tunnels. Eleking waits below.",
      sky: ["#02040a", "#0a1520", "#122430"], fog: ["#0a1620", 18, 130],
      ground: "rock", groundColor: 0x8a8a8a,
      ambient: ["#4a6a80", 0.34], sun: ["#88c8ff", 0.35, [0, 60, 0]],
      biome: "cave", mood: "dark", darkness: true,
      mobs: ["kaiju_eleking"], boss: "kaiju_eleking", mobH: 3.0, bossH: 8.4,
    },
    {
      name: "MAGMA CALDERA", sub: "The volcano has woken. Fire Golza rises.",
      sky: ["#2a0806", "#7a1a08", "#e0601a"], fog: ["#5a1a0a", 45, 200],
      ground: "lava", groundColor: 0xd8c4b8,
      ambient: ["#ff7a3a", 0.55], sun: ["#ff9040", 1.0, [0, 80, 0]],
      biome: "volcano", mood: "inferno", hazard: "lava",
      mobs: ["kaiju_golza"], boss: "kaiju_golza", mobH: 3.4, bossH: 8.4,
    },
    {
      name: "STEEL FORTRESS", sub: "Alien war machines deployed.",
      sky: ["#0a1420", "#1a3a58", "#3a6a8a"], fog: ["#14283a", 45, 230],
      ground: "metal", groundColor: 0xffffff,
      ambient: ["#88b8d8", 0.7], sun: ["#cfe8ff", 1.0, [50, 90, 20]],
      biome: "fortress", mood: "industrial",
      mobs: ["kaiju_kingjoe"], boss: "kaiju_kingjoe", mobH: 3.4, bossH: 8.6,
    },
    {
      name: "THE VOID", sub: "Beyond the nebula. Something ancient stirs.",
      sky: ["#000208", "#0a1440", "#241a60"], fog: ["#0a1030", 55, 280],
      ground: "tile", groundColor: 0x8fa4ff,
      ambient: ["#6a7ad0", 0.62], sun: ["#a0b8ff", 0.85, [80, 60, -60]],
      biome: "void", mood: "space", stars: true,
      mobs: ["kaiju_gomora", "kaiju_golza"], boss: "kaiju_gomora", mobH: 3.4, bossH: 9.0,
    },
    {
      name: "ZETTON", sub: "The final threat. Everything ends here.",
      sky: ["#050002", "#3a0010", "#7a0a1a"], fog: ["#1a0208", 40, 250],
      ground: "metal", groundColor: 0x8a7a86,
      ambient: ["#ff6a7a", 0.5], sun: ["#ffd0a0", 1.0, [0, 90, 0]],
      biome: "fortress", mood: "final", hazard: "lava",
      mobs: ["kaiju_zetton"], boss: "kaiju_zetton", mobH: 3.8, bossH: 10.0, final: true,
    },
  ];
  W.STAGES = STAGES;

  /* ---------------- world builder ---------------- */
  W.build = function (idx, scene, group) {
    const cfg = STAGES[idx];
    const AR = 78;               // arena radius
    const stage = {
      cfg: cfg, group: group, arenaRadius: AR,
      hazards: [], destructibles: [], solids: [], spawns: [], animated: [], lights: [],
    };

    // ---- sky dome ----
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(600, 32, 20),
      new THREE.MeshBasicMaterial({ map: skyTex(cfg.sky[0], cfg.sky[1], cfg.sky[2]), side: THREE.BackSide, depthWrite: false, fog: false })
    );
    group.add(sky);

    // ---- stars ----
    if (cfg.stars) {
      const n = 1400, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3(rnd(-1, 1), rnd(-0.1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(320, 560));
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe9ff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0.9, fog: false }));
      group.add(stars);
      stage.animated.push({ mesh: stars, fn: function (m, t) { m.rotation.y = t * 0.006; } });
      // planet
      const pl = new THREE.Mesh(new THREE.SphereGeometry(70, 32, 24),
        new THREE.MeshBasicMaterial({ color: 0x5a4ad0, fog: false }));
      pl.position.set(-260, 190, -420); group.add(pl);
      const pl2 = new THREE.Mesh(new THREE.SphereGeometry(34, 24, 18),
        new THREE.MeshBasicMaterial({ color: 0xd08a5a, fog: false }));
      pl2.position.set(280, 140, -380); group.add(pl2);
      const pl2r = new THREE.Mesh(new THREE.RingGeometry(46, 76, 56),
        new THREE.MeshBasicMaterial({ color: 0xa08ad0, transparent: true, opacity: 0.34, side: THREE.DoubleSide, fog: false }));
      pl2r.position.copy(pl2.position); pl2r.rotation.set(1.08, 0.4, 0);
      group.add(pl2r);
    }

    // ---- ground ----
    const gy = new THREE.Mesh(
      new THREE.CircleGeometry(AR + 60, 72),
      lmat(0xffffff, { map: groundTex(cfg.ground, 26), color: cfg.groundColor })
    );
    gy.rotation.x = -Math.PI / 2;
    gy.receiveShadow = true;
    group.add(gy);

    // outer darker ring so the arena edge reads
    const ring = new THREE.Mesh(new THREE.RingGeometry(AR - 1.5, AR + 60, 72),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; group.add(ring);

    // arena border glow
    const border = new THREE.Mesh(new THREE.RingGeometry(AR - 2.2, AR - 1.2, 96),
      new THREE.MeshBasicMaterial({ color: cfg.hazard === "lava" ? 0xff6a2a : 0x4fd6ff, transparent: true, opacity: 0.55, depthWrite: false }));
    border.rotation.x = -Math.PI / 2; border.position.y = 0.05; group.add(border);
    stage.animated.push({ mesh: border, fn: function (m, t) { m.material.opacity = 0.35 + Math.sin(t * 2) * 0.18; } });

    // ---- biome props ----
    const B = cfg.biome;
    if (B === "city" || B === "ruins" || B === "aliencity") {
      cityProps(group, stage, AR, cfg, B === "ruins", B === "aliencity");
    } else if (B === "sky") {
      skyProps(group, stage, AR, cfg);
    } else if (B === "cave") {
      caveProps(group, stage, AR, cfg);
    } else if (B === "volcano") {
      volcanoProps(group, stage, AR, cfg);
    } else if (B === "fortress") {
      fortressProps(group, stage, AR, cfg);
    } else if (B === "void") {
      voidProps(group, stage, AR, cfg);
    }

    // ---- spawn points (ring) ----
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 44;                       // mid-ring so waves reach the player quickly
      stage.spawns.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }

    // ---- lights ----
    const amb = new THREE.AmbientLight(new THREE.Color(cfg.ambient[0]), cfg.ambient[1]);
    group.add(amb); stage.lights.push(amb);
    const sun = new THREE.DirectionalLight(new THREE.Color(cfg.sun[0]), cfg.sun[1]);
    sun.position.set(cfg.sun[2][0], cfg.sun[2][1], cfg.sun[2][2]);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = 110;
    sun.shadow.camera.left = -sc; sun.shadow.camera.right = sc;
    sun.shadow.camera.top = sc; sun.shadow.camera.bottom = -sc;
    sun.shadow.camera.far = 400; sun.shadow.bias = -0.0016;
    group.add(sun); group.add(sun.target); stage.lights.push(sun);
    stage.sun = sun;

    const rim = new THREE.HemisphereLight(new THREE.Color(cfg.sky[1]), new THREE.Color(0x101010), 0.35);
    group.add(rim); stage.lights.push(rim);

    stage.update = function (dt, t) {
      for (let i = 0; i < stage.animated.length; i++) stage.animated[i].fn(stage.animated[i].mesh, t);
    };
    return stage;
  };

  /* ---------------- prop factories ----------------
     Each returns a mesh/group standing at the origin (feet on y=0); the
     builders below place and register them with addProp().              */
  function mkTree(h) {
    const g = new THREE.Group();
    const trunk = gm(GEO.cyl6, pm("trunk", 0x6a4a32), 0.26, h * 0.44);
    trunk.position.y = h * 0.22; g.add(trunk);
    const c1 = gm(GEO.cone, pm("leaf", 0x2f7a3f), h * 0.46, h * 0.56);
    c1.position.y = h * 0.58; g.add(c1);
    const c2 = gm(GEO.cone, pm("leaf2", 0x3f9a4a), h * 0.32, h * 0.44);
    c2.position.y = h * 0.82; g.add(c2);
    return g;
  }

  const VEND_COLS = [0xd23a3a, 0x2e6ad2, 0x30a060, 0xe0a020];
  function mkVending(i) {
    const g = new THREE.Group();
    const bodyM = gm(GEO.box, pm("vend" + (i % 4), VEND_COLS[i % 4]), 1.5, 2.4, 1.0);
    bodyM.position.y = 1.2; g.add(bodyM);
    const face = new THREE.Mesh(GEO.plane, new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.75 }));
    face.scale.set(1.05, 1.5, 1); face.position.set(0, 1.4, 0.505); g.add(face);
    return g;
  }

  function mkBin() {
    const g = new THREE.Group();
    const b = gm(GEO.cyl, pm("dark", 0x3a4148), 0.42, 1.1); b.position.y = 0.55; g.add(b);
    const lid = gm(GEO.cyl, pm("metal", 0x8a929c), 0.47, 0.1); lid.position.y = 1.12; g.add(lid);
    return g;
  }

  function mkBench() {
    const g = new THREE.Group();
    const seat = gm(GEO.box, pm("wood", 0x8a5a32), 2.6, 0.16, 0.8); seat.position.y = 0.55; g.add(seat);
    const back = gm(GEO.box, pm("wood", 0x8a5a32), 2.6, 0.55, 0.14); back.position.set(0, 0.88, -0.33); g.add(back);
    for (let s = -1; s <= 1; s += 2) {
      const leg = gm(GEO.box, pm("dark", 0x3a4148), 0.14, 0.55, 0.7);
      leg.position.set(s * 1.1, 0.28, 0); g.add(leg);
    }
    return g;
  }

  function mkBarrier() {
    const g = new THREE.Group();
    const b = new THREE.Mesh(GEO.box, pm("barrier", 0xffffff, { map: stripeTex("#d8d8d8", "#c03030") }));
    b.scale.set(3.0, 1.0, 0.28); b.position.y = 0.62; b.castShadow = true; g.add(b);
    for (let s = -1; s <= 1; s += 2) {
      const leg = gm(GEO.box, pm("dark", 0x3a4148), 0.16, 0.62, 0.5);
      leg.position.set(s * 1.2, 0.31, 0); g.add(leg);
    }
    return g;
  }

  function mkCone() {
    const g = new THREE.Group();
    const c = gm(GEO.cone, pm("cone", 0xe06020), 0.34, 0.8); c.position.y = 0.4; g.add(c);
    const b = gm(GEO.box, pm("cone", 0xe06020), 0.7, 0.07, 0.7); b.position.y = 0.04; g.add(b);
    return g;
  }

  function mkTrafficLight() {
    const g = new THREE.Group();
    const pole = gm(GEO.cyl6, pm("dark", 0x3a4148), 0.16, 5.2); pole.position.y = 2.6; g.add(pole);
    const arm = gm(GEO.box, pm("dark", 0x3a4148), 2.6, 0.16, 0.16); arm.position.set(1.2, 5.1, 0); g.add(arm);
    const boxM = gm(GEO.box, pm("darker", 0x22262c), 0.5, 1.2, 0.4); boxM.position.set(2.3, 4.6, 0); g.add(boxM);
    const cols = [0xff3a3a, 0xffc24a, 0x4aff8a];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.Mesh(GEO.sph, new THREE.MeshBasicMaterial({ color: cols[i] }));
      l.scale.setScalar(0.1); l.position.set(2.3, 4.98 - i * 0.34, 0.21); g.add(l);
    }
    return g;
  }

  function mkPowerPole() {
    const g = new THREE.Group();
    const pole = gm(GEO.cyl6, pm("concrete", 0x8a8f98), 0.24, 9); pole.position.y = 4.5; g.add(pole);
    const cross = gm(GEO.box, pm("dark", 0x3a4148), 3.2, 0.16, 0.16); cross.position.y = 8.3; g.add(cross);
    for (let s = -1; s <= 1; s++) {
      const ins = gm(GEO.cyl, pm("white", 0xe0e0e0), 0.1, 0.28);
      ins.position.set(s * 1.4, 8.55, 0); g.add(ins);
    }
    return g;
  }

  function mkAntenna(h) {
    const g = new THREE.Group();
    const m = gm(GEO.cyl, pm("metal", 0x8a929c), 0.1, h); m.position.y = h / 2; g.add(m);
    const tip = new THREE.Mesh(GEO.sph, new THREE.MeshBasicMaterial({ color: 0xff3a3a }));
    tip.scale.setScalar(0.2); tip.position.y = h; g.add(tip);
    return g;
  }

  function mkWaterTower() {
    const g = new THREE.Group();
    const tank = gm(GEO.cyl, pm("tank", 0x8a7a6a), 1.5, 2.4); tank.position.y = 3.6; g.add(tank);
    const cap = gm(GEO.cone, pm("dark", 0x3a4148), 1.7, 1.0); cap.position.y = 5.3; g.add(cap);
    for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
      const leg = gm(GEO.box, pm("dark", 0x3a4148), 0.16, 2.5, 0.16);
      leg.position.set(sx * 1.05, 1.25, sz * 1.05); g.add(leg);
    }
    return g;
  }

  function mkCrate(s) {
    const m = gm(GEO.box, pm("crate", 0x9a7a4a), s, s, s);
    m.position.y = s / 2;
    return m;
  }

  function mkBarrel() {
    const g = new THREE.Group();
    const b = gm(GEO.cyl, pm("barrel", 0xb0462a), 0.55, 1.3); b.position.y = 0.65; g.add(b);
    const cap = gm(GEO.cyl, pm("dark", 0x3a4148), 0.58, 0.1); cap.position.y = 1.32; g.add(cap);
    return g;
  }

  function mkRubblePile(n) {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const s = 0.5 + Math.random() * 1.5;
      const m = gm(GEO.box, pm("rubble", 0x6a6058), s, s * (0.5 + Math.random()), s);
      m.position.set((Math.random() - 0.5) * 3.2, s * 0.28, (Math.random() - 0.5) * 3.2);
      m.rotation.set(Math.random(), Math.random(), Math.random());
      g.add(m);
    }
    return g;
  }

  function mkCrystal(h, color) {
    const g = new THREE.Group();
    const c = new THREE.Mesh(GEO.cone, new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.9 }));
    c.scale.set(h * 0.22, h, h * 0.22); c.position.y = h / 2; g.add(c);
    const c2 = new THREE.Mesh(GEO.cone, new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.55 }));
    c2.scale.set(h * 0.13, h * 0.7, h * 0.13); c2.position.set(h * 0.16, h * 0.28, h * 0.07); g.add(c2);
    return g;
  }

  /* ---------------- biome prop builders ---------------- */
  function cityProps(group, stage, AR, cfg, ruined, alien) {
    const base = alien ? windowTex("#7affd0", "#c07aff", "#0d1424") : windowTex("#ffe38a", "#9fd8ff", "#131a28");
    const body = alien ? lmat(0x2a2450) : lmat(ruined ? 0x4a4048 : 0x8a909c);

    /* ---- street grid ----
       Three lanes each way. Roads are single scaled planes with a repeating
       asphalt texture (lane dashes included), so the whole network is 6
       meshes instead of hundreds of quads.                              */
    const lanes = [-40, 0, 40];
    const roadMat = new THREE.MeshLambertMaterial({ map: roadTex().clone(), color: lin(0xffffff) });
    roadMat.map.repeat.set(2, 26);
    const walkMat = new THREE.MeshLambertMaterial({ map: walkTex().clone(), color: lin(0x8f959c) });
    walkMat.map.repeat.set(2, 44);
    const roadLen = AR * 2 - 10, roadW = 12;

    for (let li = 0; li < lanes.length; li++) {
      const L = lanes[li];
      for (let axis = 0; axis < 2; axis++) {
        const road = new THREE.Mesh(GEO.plane, roadMat);
        road.scale.set(roadLen, roadW, 1);
        road.rotation.set(-Math.PI / 2, 0, axis ? Math.PI / 2 : 0);
        road.position.set(axis ? L : 0, 0.02, axis ? 0 : L);
        road.receiveShadow = true;
        group.add(road);
        // kerbs either side
        for (let s = -1; s <= 1; s += 2) {
          const off = s * (roadW / 2 + 1.7);
          const kerb = gm(GEO.box, walkMat, axis ? 3.0 : roadLen, 0.18, axis ? roadLen : 3.0);
          kerb.position.set(axis ? L + off : 0, 0.09, axis ? 0 : L + off);
          kerb.receiveShadow = true;
          group.add(kerb);
        }
      }
    }

    // intersections get a painted crossing on each approach
    const crossMat = new THREE.MeshLambertMaterial({ map: stripeTex("#2a2d34", "#e6e2c0"), transparent: true, opacity: 0.9 });
    crossMat.map.repeat.set(1, 3);
    for (let a = 0; a < lanes.length; a++) for (let b = 0; b < lanes.length; b++) {
      for (let axis = 0; axis < 2; axis++) for (let s = -1; s <= 1; s += 2) {
        const cw = new THREE.Mesh(GEO.plane, crossMat);
        // axis 0: a band lying along X that crosses the Z-running road
        cw.scale.set(roadW - 1, 5, 1);
        cw.rotation.set(-Math.PI / 2, 0, axis ? Math.PI / 2 : 0);
        const off = s * (roadW / 2 + 5);
        cw.position.set(lanes[a] + (axis ? 0 : off), 0.03, lanes[b] + (axis ? off : 0));
        group.add(cw);
      }
    }

    const onRoad = function (x, z) {
      for (let i = 0; i < lanes.length; i++) {
        if (Math.abs(x - lanes[i]) < 9.5) return true;
        if (Math.abs(z - lanes[i]) < 9.5) return true;
      }
      return false;
    };

    /* ---- towers ---- */
    const n = 30;
    for (let i = 0; i < n; i++) {
      let x = 0, z = 0, tries = 0;
      do {
        const a = Math.random() * Math.PI * 2;
        const r = 30 + Math.random() * (AR - 38);
        x = Math.cos(a) * r; z = Math.sin(a) * r;
        tries++;
      } while ((onRoad(x, z) || Math.hypot(x, z - 22) < 15) && tries < 12);
      if (onRoad(x, z)) continue;
      const w = rnd(7, 13), d = rnd(7, 13);
      const h = rnd(9, ruined ? 16 : 26) * (alien ? 1.25 : 1);
      const bm = new THREE.MeshLambertMaterial({ color: lin(body.color), map: base.clone(), transparent: true, opacity: 1 });
      bm.map.repeat.set(Math.max(1, Math.round(w / 5)), Math.max(1, Math.round(h / 5)));
      const m = box(w, h, d, bm, x, h / 2, z);
      m.rotation.y = Math.random() * Math.PI;
      addProp(group, stage, m, {
        kind: "building", hp: 100 + h * 8, destructible: true, fade: true, solid: true,
        radius: Math.max(w, d) * 0.78, solidR: Math.min(w, d) * 0.54, height: h, size: [w, h, d],
      });
      if (ruined) { m.rotation.z = rnd(-0.05, 0.05); m.userData.broken = true; }

      // ---- rooftop detail: a stepped tier, antenna, water tank or AC bank ----
      if (Math.random() < 0.5) {
        const w2 = w * rnd(0.5, 0.72), d2 = d * rnd(0.5, 0.72), h2 = rnd(3, 9);
        const bm2 = new THREE.MeshLambertMaterial({ color: lin(body.color), map: base.clone() });
        bm2.map.repeat.set(Math.max(1, Math.round(w2 / 5)), Math.max(1, Math.round(h2 / 5)));
        const m2 = box(w2, h2, d2, bm2, 0, h / 2 + h2 / 2, 0);
        m.add(m2);
      }
      const roll = Math.random();
      if (roll < 0.3) {
        const ant = mkAntenna(rnd(3, 8)); ant.position.y = h / 2; m.add(ant);
        const tip = ant.children[1];
        tip.userData.ph = Math.random() * 6;
        stage.animated.push({ mesh: tip, fn: function (mm, t) {
          const k = 0.45 + Math.sin(t * 2.1 + mm.userData.ph) * 0.45;
          mm.material.color.setRGB(k, 0.07, 0.07);
        } });
      } else if (roll < 0.5) {
        const wt = mkWaterTower(); wt.position.y = h / 2; wt.scale.setScalar(0.8); m.add(wt);
      } else if (roll < 0.62) {
        const ac = gm(GEO.box, pm("metal", 0x8a929c), w * 0.5, 0.8, d * 0.4);
        ac.position.y = h / 2 + 0.4; m.add(ac);
      }
      // ---- lit shop sign on the street face ----
      if (Math.random() < 0.45 && !ruined) {
        const sw = Math.min(w * 0.7, 6.4), sh = sw * 0.45;
        const sign = new THREE.Mesh(GEO.plane, new THREE.MeshBasicMaterial({ map: signTex(i), transparent: true, side: THREE.DoubleSide }));
        sign.scale.set(sw, sh, 1);
        sign.position.set(0, -h / 2 + h * rnd(0.55, 0.85), d / 2 + 0.12);
        m.add(sign);
      }
    }

    /* ---- street furniture along the lanes ---- */
    const FURN = [
      function (i) { return { m: mkTree(rnd(4.4, 8)), meta: { kind: "tree", hp: 34, radius: 1.6, solid: true, solidR: 0.9, height: 7, destructible: true, fade: true, size: [2.4, 7, 2.4] } }; },
      function (i) { return { m: mkVending(i), meta: { kind: "vending", hp: 24, radius: 1.1, solid: true, height: 2.4, destructible: true, fade: true, size: [1.6, 2.4, 1.1] } }; },
      function (i) { return { m: mkBin(), meta: { kind: "bin", hp: 12, radius: 0.6, height: 1.2, destructible: true, size: [1, 1.2, 1] } }; },
      function (i) { return { m: mkBench(), meta: { kind: "bench", hp: 16, radius: 1.5, height: 1.0, destructible: true, size: [2.6, 1, 0.9] } }; },
      function (i) { return { m: mkBarrier(), meta: { kind: "barrier", hp: 30, radius: 1.7, solid: true, height: 1.1, destructible: true, size: [3, 1.1, 0.6] } }; },
      function (i) { return { m: mkCone(), meta: { kind: "cone", hp: 6, radius: 0.45, height: 0.8, destructible: true, size: [0.7, 0.8, 0.7] } }; },
      function (i) { return { m: mkTrafficLight(), meta: { kind: "trafficlight", hp: 40, radius: 1.3, solid: true, solidR: 0.5, height: 5.6, destructible: true, fade: true, size: [1.6, 5.6, 1.6] } }; },
      function (i) { return { m: mkPowerPole(), meta: { kind: "pole", hp: 50, radius: 1.3, solid: true, solidR: 0.55, height: 9, destructible: true, fade: true, size: [1.6, 9, 1.6] } }; },
    ];
    const polePts = [];
    for (let li = 0; li < lanes.length; li++) {
      const L = lanes[li];
      for (let side = -1; side <= 1; side += 2) {
        const slots = 4 + (ruined ? 1 : 2);
        for (let k = 0; k < slots; k++) {
          const along = -AR + 16 + k * ((AR * 2 - 32) / (slots - 1)) + rnd(-3, 3);
          const off = L + side * (roadW / 2 + 3.4);
          const x = off, z = along;
          if (Math.hypot(x, z - 22) < 12) continue;
          const fi = Math.floor(Math.random() * FURN.length);
          const spec = FURN[fi](k + li);
          spec.m.position.set(x, 0, z);
          spec.m.rotation.y = Math.random() * Math.PI * 2;
          addProp(group, stage, spec.m, spec.meta);
          if (spec.meta.kind === "pole") polePts.push(new THREE.Vector3(x, 0, z));
        }
      }
    }
    // sagging wires between the poles on each lane
    if (polePts.length > 1) {
      polePts.sort(function (a, b) { return a.z - b.z; });
      const wireMat = new THREE.LineBasicMaterial({ color: 0x1a1d22, transparent: true, opacity: 0.8 });
      for (let i = 0; i < polePts.length - 1; i++) {
        const a = polePts[i], b = polePts[i + 1];
        if (Math.abs(a.x - b.x) > 6) continue;
        const pts = [];
        for (let s = 0; s <= 6; s++) {
          const t = s / 6;
          pts.push(new THREE.Vector3(
            a.x + (b.x - a.x) * t,
            8.5 - Math.sin(t * Math.PI) * 1.5,
            a.z + (b.z - a.z) * t));
        }
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
      }
    }

    /* ---- cars ---- */
    for (let i = 0; i < 26; i++) {
      let x = 0, z = 0, tries = 0;
      do {
        const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * (AR - 26);
        x = Math.cos(a) * r; z = Math.sin(a) * r;
        tries++;
      } while (Math.hypot(x, z - 22) < 13 && tries < 10);
      const col = pick([0xd03030, 0x3050d0, 0xe0e0e0, 0x30a060, 0xe0a020, 0x202020]);
      const c = new THREE.Group();
      const bodyM = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.8, 1.4), lmat(col, { transparent: true }));
      bodyM.position.y = 0.4; bodyM.castShadow = true;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 1.2), lmat(0x1a1e26, { transparent: true }));
      cab.position.y = 1.0; cab.castShadow = true;
      c.add(bodyM); c.add(cab);
      c.position.set(x, 0, z);
      c.rotation.y = Math.random() * Math.PI * 2;
      addProp(group, stage, c, {
        kind: "car", hp: 30, destructible: true, car: true, fade: true, solid: true,
        radius: 2.2, solidR: 1.5, height: 1.2, size: [2.6, 1.2, 1.4],
      });
    }

    /* ---- ruins dressing ---- */
    if (ruined) {
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * (AR - 26);
        const p = mkRubblePile(5 + Math.floor(Math.random() * 4));
        p.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        p.rotation.y = Math.random() * 3;
        addProp(group, stage, p, { kind: "rubble", hp: 40, radius: 2.4, height: 1.4, destructible: true, size: [3.4, 1.4, 3.4] });
      }
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * (AR - 24);
        const fire = new THREE.Group();
        for (let k = 0; k < 4; k++) {
          const f = new THREE.Mesh(GEO.cone, new THREE.MeshBasicMaterial({
            color: [0xffca4a, 0xff8a2a, 0xff5a1a, 0xffe08a][k], transparent: true,
            opacity: 0.5 - k * 0.08, blending: THREE.AdditiveBlending, depthWrite: false,
          }));
          f.scale.set(1.4 - k * 0.22, 2.6 - k * 0.4, 1.4 - k * 0.22);
          f.position.y = 1.0 + k * 0.3;
          fire.add(f);
        }
        fire.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        fire.userData.ph = Math.random() * 6;
        group.add(fire);
        const pl = new THREE.PointLight(0xff8a3a, 1.4, 26);
        pl.position.copy(fire.position); pl.position.y = 2;
        group.add(pl);
        if (stage.lights.length < 18) stage.lights.push(pl);
        stage.animated.push({ mesh: fire, ph: Math.random() * 6, fn: function (m, t) {
          m.children.forEach(function (c, k) {
            const s = 1 + Math.sin(t * 7 + k * 1.7 + m.userData.ph) * 0.16;
            c.scale.y = (2.6 - k * 0.4) * s;
            c.material.opacity = (0.5 - k * 0.08) * (0.7 + Math.sin(t * 9 + k * 2.1) * 0.3);
          });
        } });
      }
    }

    /* ---- street lights around the arena edge ---- */
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, r = AR - 8;
      const pole = box(0.4, 7, 0.4, lmat(0x30363e), Math.cos(a) * r, 3.5, Math.sin(a) * r);
      addProp(group, stage, pole, { kind: "lamp", hp: 40, radius: 0.7, solid: true, solidR: 0.4, height: 7, destructible: true, fade: true, size: [0.6, 7, 0.6] });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff0c0 }));
      lamp.position.set(Math.cos(a) * r, 7.2, Math.sin(a) * r); group.add(lamp);
      const pl = new THREE.PointLight(0xffe0a0, 0.7, 34); pl.position.copy(lamp.position); group.add(pl);
      if (stage.lights.length < 16) stage.lights.push(pl);
    }
  }


  function skyProps(group, stage, AR, cfg) {
    // cloud deck below (you fight above a sea of clouds)
    const deck = new THREE.Mesh(new THREE.CircleGeometry(AR + 70, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, map: cloudTex(), depthWrite: false }));
    deck.rotation.x = -Math.PI / 2; deck.position.y = -14; group.add(deck);
    stage.animated.push({ mesh: deck, fn: function (m, t) { m.material.map.offset.x = t * 0.008; m.material.map.offset.y = t * 0.004; } });
    // floating rock platforms
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * (AR - 30);
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(rnd(7, 14), rnd(5, 9), rnd(3, 6), 12),
        lmat(0x9aa4b0, { map: groundTex("rock", 3) }));
      top.position.y = 0; g.add(top);
      const under = new THREE.Mesh(new THREE.ConeGeometry(rnd(5, 9), rnd(8, 16), 9), lmat(0x6a7078));
      under.position.y = -rnd(6, 10); under.rotation.x = Math.PI; g.add(under);
      g.position.set(Math.cos(a) * r, rnd(-2, 6), Math.sin(a) * r);
      g.userData.baseY = g.position.y; g.userData.ph = Math.random() * 6;
      group.add(g);
      stage.animated.push({ mesh: g, fn: function (m, t) { m.position.y = m.userData.baseY + Math.sin(t * 0.6 + m.userData.ph) * 1.6; m.rotation.y += 0.0006; } });
    }
    // smaller islands that drift past, carrying debris and a lone tree
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * (AR - 24);
      const g = new THREE.Group();
      const tr = rnd(3, 6.5);
      const top = new THREE.Mesh(GEO.cyl, lmat(0x9aa4b0, { map: groundTex("rock", 3) }));
      top.scale.set(tr, rnd(1.6, 3), tr); g.add(top);
      const under = new THREE.Mesh(GEO.cone, lmat(0x6a7078));
      under.scale.set(tr * 0.7, rnd(4, 9), tr * 0.7);
      under.position.y = -rnd(3, 5); under.rotation.x = Math.PI; g.add(under);
      const tree = mkTree(rnd(3.5, 6.5));
      tree.position.set(rnd(-tr * 0.4, tr * 0.4), 0.9, rnd(-tr * 0.4, tr * 0.4));
      g.add(tree);
      for (let k = 0; k < 4; k++) {
        const rk = gm(GEO.cone, lmat(0x7a828c), rnd(0.5, 1.2), rnd(0.8, 1.8));
        rk.position.set(rnd(-tr * 0.7, tr * 0.7), 0.4, rnd(-tr * 0.7, tr * 0.7));
        rk.rotation.z = rnd(-0.3, 0.3);
        g.add(rk);
      }
      g.position.set(Math.cos(a) * r, rnd(-3, 7), Math.sin(a) * r);
      g.userData.baseY = g.position.y;
      g.userData.ph = Math.random() * 6;
      group.add(g);
      stage.animated.push({ mesh: g, fn: function (m, t) { m.position.y = m.userData.baseY + Math.sin(t * 0.5 + m.userData.ph) * 2.2; m.rotation.y += 0.0009; } });
    }
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(rnd(30, 80), rnd(14, 34)),
        new THREE.MeshBasicMaterial({ map: cloudTex(), transparent: true, opacity: rnd(0.25, 0.6), depthWrite: false, fog: false }));
      c.position.set(rnd(-1, 1) * 220, rnd(-20, 90), rnd(-1, 1) * 220);
      c.lookAt(0, c.position.y, 0);
      group.add(c);
      stage.animated.push({ mesh: c, fn: function (m, t) { m.position.x += 0.06; if (m.position.x > 240) m.position.x = -240; } });
    }
  }

  function caveProps(group, stage, AR, cfg) {
    // tunnel walls
    const wallMat = lmat(0x5a524a, { map: groundTex("rock", 5) });
    const N = 26;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.random() * 0.1;
      const r = AR + rnd(2, 12);
      const h = rnd(30, 70);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rnd(10, 22), rnd(12, 24), h, 7, 1, true), wallMat);
      m.position.set(Math.cos(a) * r, h / 2 - 6, Math.sin(a) * r);
      m.rotation.y = Math.random(); m.material.side = THREE.DoubleSide;
      group.add(m);
    }
    // ceiling
    const ceil = new THREE.Mesh(new THREE.CircleGeometry(AR + 40, 40),
      new THREE.MeshLambertMaterial({ color: 0x2a2620, side: THREE.DoubleSide }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = 62; group.add(ceil);
    // stalagmites + glowing crystals
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, r = 16 + Math.random() * (AR - 20);
      if (Math.random() < 0.55) {
        const h = rnd(3, 11);
        const st = new THREE.Mesh(new THREE.ConeGeometry(rnd(1.2, 3), h, 6), lmat(0x4a4238));
        st.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); group.add(st);
      } else {
        const ch = rnd(2, 6);
        const cr = new THREE.Mesh(new THREE.OctahedronGeometry(ch * 0.4, 0),
          new THREE.MeshBasicMaterial({ color: 0x4fd6ff, transparent: true, opacity: 0.85 }));
        cr.position.set(Math.cos(a) * r, ch * 0.5, Math.sin(a) * r); group.add(cr);
        const pl = new THREE.PointLight(0x4fd6ff, 1.1, 26); pl.position.copy(cr.position); pl.position.y += 1.5; group.add(pl);
        if (stage.lights.length < 14) stage.lights.push(pl);
        stage.animated.push({ mesh: cr, ph: Math.random() * 6, fn: function (m, t) { m.rotation.y += 0.01; m.material.opacity = 0.55 + Math.sin(t * 2 + m.position.x) * 0.3; } });
      }
    }
    // stalactites hanging from the ceiling
    const stMat = lmat(0x453e36);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * (AR - 6);
      const h = rnd(4, 15);
      const st = new THREE.Mesh(GEO.cone, stMat);
      st.scale.set(rnd(0.9, 2.6), h, rnd(0.9, 2.6));
      st.position.set(Math.cos(a) * r, 62 - h / 2, Math.sin(a) * r);
      st.rotation.x = Math.PI;                 // tip down
      st.castShadow = true;
      group.add(st);
    }
    // glowing mushrooms + damp pools
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * (AR - 16);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (i % 3 === 0) {
        const pr = rnd(3, 7);
        const pool = new THREE.Mesh(new THREE.CircleGeometry(pr, 22),
          new THREE.MeshBasicMaterial({ color: 0x0d2634, transparent: true, opacity: 0.85 }));
        pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.05, z);
        group.add(pool);
        stage.animated.push({ mesh: pool, ph: Math.random() * 6, fn: function (m, t) { m.material.opacity = 0.7 + Math.sin(t * 0.9 + m.position.x) * 0.15; } });
        stage.hazards.push({ x: x, z: z, radius: pr * 0.8, dps: 2, type: "water" });
      } else {
        const cap = new THREE.Mesh(GEO.sph, new THREE.MeshBasicMaterial({ color: i % 2 ? 0x6affc0 : 0x7ac8ff, transparent: true, opacity: 0.85 }));
        const cr = rnd(0.6, 1.3);
        cap.scale.set(cr, cr * 0.55, cr);
        cap.position.set(x, rnd(0.5, 1.6), z);
        group.add(cap);
        const stem = new THREE.Mesh(GEO.cyl, stMat);
        stem.scale.set(cr * 0.3, cap.position.y, cr * 0.3);
        stem.position.set(x, cap.position.y / 2, z);
        group.add(stem);
        stage.animated.push({ mesh: cap, ph: Math.random() * 6, fn: function (m, t) { m.material.opacity = 0.6 + Math.sin(t * 1.6 + m.position.z) * 0.25; } });
      }
    }
    // spelunker crates the miners left behind
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, r = 16 + Math.random() * (AR - 22);
      const s = rnd(1.1, 1.9);
      const cr = mkCrate(s);
      cr.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      cr.rotation.y = Math.random() * 3;
      addProp(group, stage, cr, { kind: "crate", hp: 20, radius: s, solid: true, height: s, destructible: true, size: [s, s, s] });
    }
    // Player needs a light to see — a big soft point light near the player is added by game.js
    stage.needsPlayerLight = true;
  }

  function volcanoProps(group, stage, AR, cfg) {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * (AR - 34);
      const h = rnd(14, 34);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(rnd(8, 18), h, 8), lmat(0x3a2018, { map: groundTex("rock", 4) }));
      cone.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); group.add(cone);
      if (Math.random() < 0.6) {
        const lavaTop = new THREE.Mesh(new THREE.ConeGeometry(rnd(3, 6), h * 0.5, 8),
          new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.9 }));
        lavaTop.position.set(cone.position.x, h * 0.78, cone.position.z); group.add(lavaTop);
        stage.animated.push({ mesh: lavaTop, fn: function (m, t) { m.material.opacity = 0.6 + Math.sin(t * 3 + m.position.x) * 0.3; } });
      }
    }
    // lava pools = hazards
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2, r = rnd(18, AR - 18);
      const rad = rnd(7, 14);
      const poolMat = new THREE.MeshBasicMaterial({ color: 0xff5a12, transparent: true, opacity: 0.95 });
      poolMat.color.convertSRGBToLinear();
      const pool = new THREE.Mesh(new THREE.CircleGeometry(rad, 32), poolMat);
      pool.rotation.x = -Math.PI / 2; pool.position.set(Math.cos(a) * r, 0.06, Math.sin(a) * r);
      group.add(pool);
      const glow = new THREE.PointLight(0xff5a20, 1.6, rad * 4); glow.position.set(pool.position.x, 3, pool.position.z); group.add(glow);
      stage.hazards.push({ x: pool.position.x, z: pool.position.z, radius: rad, dps: 16, type: "lava" });
      stage.animated.push({ mesh: pool, fn: function (m, t) { m.material.opacity = 0.75 + Math.sin(t * 2.4 + m.position.z) * 0.18; } });
    }
    // basalt columns — solid cover to fight around
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * (AR - 30);
      const h = rnd(3.5, 9);
      const col = gm(GEO.cyl6, pm("basalt", 0x2a2320), rnd(1.1, 2.2), h);
      col.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      col.rotation.y = Math.random();
      addProp(group, stage, col, {
        kind: "column", hp: 70, radius: 1.9, solid: true, solidR: 1.4, height: h,
        destructible: true, fade: true, size: [3, h, 3],
      });
    }
    // lava falls pouring off the ridge, pooling at the bottom
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2, r = 34 + Math.random() * (AR - 42);
      const fh = rnd(9, 22);
      const fm = new THREE.MeshBasicMaterial({
        map: fallTex(), transparent: true, opacity: 0.95,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const fall = new THREE.Mesh(GEO.plane, fm);
      fall.scale.set(rnd(1.6, 3.4), fh, 1);
      fall.position.set(Math.cos(a) * r, fh / 2, Math.sin(a) * r);
      fall.lookAt(0, fh / 2, 0);
      group.add(fall);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(rnd(2.6, 4.8), 20), fm);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(Math.cos(a) * r, 0.08, Math.sin(a) * r);
      group.add(pool);
      stage.hazards.push({ x: pool.position.x, z: pool.position.z, radius: 3.4, dps: 14, type: "lava" });
      const gl = new THREE.PointLight(0xff6a20, 1.2, 30); gl.position.copy(fall.position); group.add(gl);
      if (stage.lights.length < 18) stage.lights.push(gl);
      stage.animated.push({ mesh: fall, fn: function (m, t) { m.material.opacity = 0.6 + Math.sin(t * 3 + m.position.x) * 0.25; } });
    }
    // obsidian shards jutting out of the ground
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, r = 16 + Math.random() * (AR - 20);
      const h = rnd(1.5, 4.5);
      const sh = new THREE.Mesh(GEO.cone, pm("obsidian", 0x1a1620));
      sh.scale.set(rnd(0.5, 1.3), h, rnd(0.5, 1.3));
      sh.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      sh.rotation.z = rnd(-0.25, 0.25);
      sh.castShadow = true;
      group.add(sh);
    }
    // embers / ash motes
    const n = 260, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = rnd(-AR, AR); pos[i * 3 + 1] = rnd(1, 60); pos[i * 3 + 2] = rnd(-AR, AR); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const ash = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xffb27a, size: 1.7, map: dotTex(), transparent: true,
      opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    }));
    group.add(ash);
    stage.animated.push({ mesh: ash, fn: function (m, t) { m.rotation.y = t * 0.018; m.position.y = Math.sin(t * 0.35) * 2.5; } });
  }

  function fortressProps(group, stage, AR, cfg) {
    const isFinal = cfg.final;
    const wallMat = new THREE.MeshLambertMaterial({ color: lin(isFinal ? 0x3a2a34 : 0x46505e), map: groundTex(isFinal ? "lava" : "metal", 4), transparent: true, opacity: 1 });
    // ring wall
    const N = 22;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const h = rnd(9, 22);
      const w = rnd(12, 20);
      const m = box(w, h, 6, wallMat, Math.cos(a) * (AR + 1), h / 2, Math.sin(a) * (AR + 1));
      m.rotation.y = -a; group.add(m); stage.destructibles.push(m);
      m.userData = { hp: 200, destructible: true, fade: true, radius: Math.max(w, 6) * 0.7 };
    }
    // machinery — kept out of the spawn zone so the camera never starts inside a column
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, r = 26 + Math.random() * (AR - 32);
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      if (Math.hypot(cx, cz - 22) < 16) continue;   // player spawns at (0,0,22)
      const h = rnd(5, 16);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(rnd(1.6, 3.4), rnd(2, 4), h, 10),
        new THREE.MeshLambertMaterial({ color: lin(isFinal ? 0x6a3040 : 0x5a6a7a), transparent: true, opacity: 1 }));
      col.position.set(cx, h / 2, cz); group.add(col); stage.destructibles.push(col);
      col.userData = { hp: 80, destructible: true, fade: true, radius: Math.max(4, h * 0.35) };
      if (Math.random() < 0.7) {
        const neon = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.24, 8, 20),
          new THREE.MeshBasicMaterial({ color: isFinal ? 0xff3a5a : 0x4fd6ff }));
        neon.position.set(col.position.x, h * 0.8, col.position.z); neon.rotation.x = Math.PI / 2;
        group.add(neon);
        stage.animated.push({ mesh: neon, fn: function (mm, t) { mm.rotation.z += 0.03; } });
      }
    }
    // pipe runs threading between the machinery
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rnd(-0.12, 0.12);
      const r = 38 + Math.random() * 12;
      const len = rnd(16, 30);
      const dir = new THREE.Vector3(Math.cos(a + Math.PI / 2), 0, Math.sin(a + Math.PI / 2));
      const pipe = gm(GEO.cyl, pm("pipe", 0x59626f), 0.42, len);
      pipe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      pipe.position.set(Math.cos(a) * r, 3.0, Math.sin(a) * r);
      group.add(pipe);
      for (let s = -1; s <= 1; s += 2) {
        const leg = gm(GEO.box, pm("dark", 0x3a4148), 0.3, 3.0, 0.3);
        leg.position.set(pipe.position.x + dir.x * s * len * 0.3, 1.5, pipe.position.z + dir.z * s * len * 0.3);
        group.add(leg);
      }
    }
    // supply crates and fuel drums (cover that can be smashed)
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * (AR - 32);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.hypot(x, z - 22) < 14) continue;
      if (Math.random() < 0.55) {
        const s = rnd(1.2, 2.1);
        const cr = mkCrate(s);
        cr.position.set(x, 0, z); cr.rotation.y = Math.random() * 3;
        addProp(group, stage, cr, { kind: "crate", hp: 22, radius: s * 0.92, solid: true, height: s, destructible: true, size: [s, s, s] });
      } else {
        const bl = mkBarrel();
        bl.position.set(x, 0, z); bl.rotation.y = Math.random() * 3;
        addProp(group, stage, bl, { kind: "barrel", hp: 18, radius: 0.72, solid: true, height: 1.4, destructible: true, size: [1.2, 1.4, 1.2] });
      }
    }
    // rotating radar dishes
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const r = AR - 20 + Math.random() * 8;
      const g = new THREE.Group();
      const mast = gm(GEO.cyl, pm("metal", 0x8a929c), 0.4, 8); mast.position.y = 4; g.add(mast);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.4),
        pm("dish", 0xc8d0d8, { side: THREE.DoubleSide }));
      dish.position.y = 8.4; dish.rotation.x = -0.9; g.add(dish);
      g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      g.userData.spin = 0.25 + Math.random() * 0.45;
      addProp(group, stage, g, { kind: "radar", hp: 60, radius: 1.6, solid: true, solidR: 0.6, height: 9, destructible: true, fade: true, size: [2, 9, 2] });
      stage.animated.push({ mesh: g, fn: function (m, t) { if (m.children[1]) m.children[1].rotation.z = t * m.userData.spin; } });
    }
    // glowing conduits running along the base of the wall
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const t2 = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: isFinal ? 0xff3a5a : 0x4fd6ff, transparent: true, opacity: 0.7 }));
      t2.scale.set(1.8, 0.3, 0.3);
      t2.position.set(Math.cos(a) * (AR - 4), 0.3, Math.sin(a) * (AR - 4));
      t2.rotation.y = a + Math.PI / 2;
      group.add(t2);
    }
    // glowing grid floor markers
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, r = AR - 14;
      const pad = new THREE.Mesh(new THREE.RingGeometry(3, 3.6, 24),
        new THREE.MeshBasicMaterial({ color: isFinal ? 0xff3a5a : 0x39c8ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      pad.rotation.x = -Math.PI / 2; pad.position.set(Math.cos(a) * r, 0.07, Math.sin(a) * r); group.add(pad);
    }
    if (isFinal) {
      const core = new THREE.Mesh(new THREE.SphereGeometry(16, 24, 18),
        new THREE.MeshBasicMaterial({ color: 0xff2a4a, transparent: true, opacity: 0.35 }));
      core.position.set(0, 40, -AR - 30); group.add(core);
      stage.animated.push({ mesh: core, fn: function (m, t) { m.scale.setScalar(1 + Math.sin(t * 1.6) * 0.08); } });
    }
  }

  function voidProps(group, stage, AR, cfg) {
    // floating shards
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * (AR - 18);
      const s = rnd(2, 7);
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0),
        lmat(0x2a2246, { map: groundTex("void", 2) }));
      m.position.set(Math.cos(a) * r, rnd(-3, 22), Math.sin(a) * r);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      m.userData.ph = Math.random() * 6;
      m.userData.baseY = m.position.y;
      group.add(m);
      stage.animated.push({ mesh: m, ph: Math.random() * 6, fn: function (mm, t) { mm.rotation.y += 0.004; mm.position.y = mm.userData.baseY + Math.sin(t * 0.8 + mm.userData.ph) * 1.2; } });
    }
    // floating obelisks (solid — they hover low enough to fight around)
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * (AR - 28);
      const h = rnd(9, 22);
      const y = rnd(2, 12);
      const ob = new THREE.Mesh(GEO.box, pm("obelisk", 0x2e2a4a));
      ob.scale.set(rnd(1.4, 2.6), h, rnd(1.4, 2.6));
      ob.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      ob.rotation.set(rnd(-0.16, 0.16), Math.random() * 3, rnd(-0.16, 0.16));
      addProp(group, stage, ob, {
        kind: "obelisk", hp: 90, radius: 2.3, solid: true, solidR: 1.5, height: h,
        destructible: true, fade: true, size: [3, h, 3], baseY: y, ph: Math.random() * 6,
      });
      stage.animated.push({ mesh: ob, fn: function (m, t) { m.position.y = m.userData.baseY + Math.sin(t * 0.7 + m.userData.ph) * 0.9; } });
    }
    // crystal clusters
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, r = 16 + Math.random() * (AR - 22);
      const g = new THREE.Group();
      const n2 = 2 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n2; k++) {
        const c = mkCrystal(rnd(2, 6), i % 2 ? 0x9a6aff : 0x4ad0ff);
        c.position.set(rnd(-1.4, 1.4), 0, rnd(-1.4, 1.4));
        c.rotation.z = rnd(-0.3, 0.3);
        g.add(c);
      }
      const gy = rnd(-1, 6);
      g.position.set(Math.cos(a) * r, gy, Math.sin(a) * r);
      g.userData.baseY = gy;
      g.userData.ph = Math.random() * 6;
      group.add(g);
      stage.animated.push({ mesh: g, fn: function (m, t) { m.position.y = m.userData.baseY + Math.sin(t * 0.8 + m.userData.ph) * 0.5; m.rotation.y += 0.002; } });
    }
    // nebula glow planes
    for (let i = 0; i < 10; i++) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(rnd(60, 160), rnd(40, 110)),
        new THREE.MeshBasicMaterial({ map: cloudTex(), color: pick([0x6a4ad0, 0xd04a8a, 0x4a8ad0]), transparent: true, opacity: rnd(0.12, 0.28), depthWrite: false, fog: false }));
      c.position.set(rnd(-1, 1) * 260, rnd(-30, 140), rnd(-1, 1) * 260);
      c.lookAt(0, 40, 0); group.add(c);
      stage.animated.push({ mesh: c, fn: function (m, t) { m.position.x += 0.03; if (m.position.x > 280) m.position.x = -280; } });
    }
  }

  /* ---------------- destructible handling ---------------- */
  W.hitProp = function (stage, mesh, dmg, onDestroy) {
    if (!mesh.userData || !mesh.userData.destructible) return false;
    mesh.userData.hp -= dmg;
    // props may be Groups (cars) without their own material
    if (mesh.material && mesh.material.color) mesh.material.color.multiplyScalar(0.82);
    else if (mesh.children && mesh.children[0] && mesh.children[0].material && mesh.children[0].material.color)
      mesh.children[0].material.color.multiplyScalar(0.82);
    if (mesh.userData.hp <= 0) {
      onDestroy(mesh);
      return true;
    }
    return false;
  };

  W.removeProp = function (stage, mesh) {
    const i = stage.destructibles.indexOf(mesh);
    if (i >= 0) stage.destructibles.splice(i, 1);
    if (stage.solids) {
      const j = stage.solids.indexOf(mesh);
      if (j >= 0) stage.solids.splice(j, 1);
    }
    if (mesh.parent) mesh.parent.remove(mesh);
  };

  window.World = W;
})();
