/* ============================================================
   fire.js — pooled particle systems for the forest fire
   ------------------------------------------------------------
   Four GPU point systems, each a fixed ring buffer of particles:

     fire   additive, yellow→orange→red, rises fast, shrinks
     smoke  normal, warm grey, grows, drifts with the wind
     water  additive, blue-white droplets with gravity
     steam  normal, white-grey puffs when water meets fire

   Plus a tiny pool of four point lights so a burning forest
   still only ever costs four dynamic lights.

   Everything is buffer-based: no allocations per particle, no
   per-particle meshes, no texture loads (the sprite is drawn
   into a canvas at boot).
   ============================================================ */
(function () {
  "use strict";

  const FireFX = {
    _systems: [],
    _lights: [],
    _wind: new THREE.Vector3(1.2, 0, 0.4),
    time: 0
  };

  /* ---------------------------------------------------------- sprite */
  function makeSprite() {
    const s = 64;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0.00, "rgba(255,255,255,1)");
    grad.addColorStop(0.28, "rgba(255,255,255,0.82)");
    grad.addColorStop(0.62, "rgba(255,255,255,0.22)");
    grad.addColorStop(1.00, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  /* ---------------------------------------------------------- system */
  function Sys(scene, opt) {
    this.max = opt.max;
    this.additive = !!opt.additive;
    this.gravity = opt.gravity || 0;
    this.drag = opt.drag === undefined ? 0.98 : opt.drag;
    this.head = 0;
    this.live = 0;

    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.size = new Float32Array(this.max);
    this.alpha = new Float32Array(this.max);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.maxLife = new Float32Array(this.max);
    this.grow = new Float32Array(this.max);
    this.a0 = new Float32Array(this.max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: opt.texture } },
      vertexShader: [
        "attribute vec3 aColor;",
        "attribute float aSize;",
        "attribute float aAlpha;",
        "varying vec3 vColor;",
        "varying float vAlpha;",
        "void main() {",
        "  vColor = aColor; vAlpha = aAlpha;",
        "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
        "  gl_PointSize = max(1.0, aSize * (320.0 / max(1.0, -mv.z)));",
        "  gl_Position = projectionMatrix * mv;",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D uTex;",
        "varying vec3 vColor;",
        "varying float vAlpha;",
        "void main() {",
        "  float a = texture2D(uTex, gl_PointCoord).a * vAlpha;",
        "  if (a < 0.012) discard;",
        "  gl_FragColor = vec4(vColor, a);",
        "}"
      ].join("\n"),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: opt.additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = opt.renderOrder || 2;
    scene.add(this.points);
    this.geo = geo;
  }

  Sys.prototype.spawn = function (x, y, z, vx, vy, vz, r, g, b, size, life, grow, alpha) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = grow;
    this.a0[i] = alpha === undefined ? 1 : alpha;
    this.alpha[i] = this.a0[i];
    this.live = Math.min(this.max, this.live + 1);
  };

  Sys.prototype.step = function (dt) {
    if (this.live <= 0) return;
    const drag = Math.pow(this.drag, dt * 60);
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0; this.size[i] = 0;
        continue;
      }
      live++;
      this.vel[i3 + 1] += this.gravity * dt;
      this.vel[i3] *= drag;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = Math.max(0.001, this.size[i] + this.grow[i] * dt);
      /* ease: hold, then fade out in the last 45% of life */
      this.alpha[i] = this.a0[i] * (t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.45));
    }
    this.live = live;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  };

  /* ---------------------------------------------------------- init */
  FireFX.init = function (scene, camera) {
    FireFX.scene = scene;
    FireFX.camera = camera;
    const tex = makeSprite();

    FireFX.fire = new Sys(scene, { max: 720, additive: true, texture: tex, drag: 0.965, renderOrder: 3 });
    FireFX.smoke = new Sys(scene, { max: 420, additive: false, texture: tex, drag: 0.985, gravity: 1.2, renderOrder: 1 });
    FireFX.water = new Sys(scene, { max: 520, additive: true, texture: tex, drag: 0.995, gravity: -34, renderOrder: 4 });
    FireFX.steam = new Sys(scene, { max: 360, additive: false, texture: tex, drag: 0.97, gravity: 0.9, renderOrder: 2 });
    FireFX.embers = new Sys(scene, { max: 320, additive: true, texture: tex, drag: 0.988, gravity: 1.6, renderOrder: 5 });
    FireFX._systems = [FireFX.fire, FireFX.smoke, FireFX.water, FireFX.steam, FireFX.embers];

    /* four lights, reused by whichever fires matter most */
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xff7a2c, 0, 70, 2);
      l.position.set(0, 8, 0);
      l.visible = false;
      scene.add(l);
      FireFX._lights.push(l);
    }
  };

  FireFX.setWind = function (x, z) {
    FireFX._wind.set(x, 0, z);
  };

  /* ---------------------------------------------------------- emitters */
  const TMP = { r: 0, g: 0, b: 0 };

  /* one burning tree: called every frame while it burns */
  FireFX.treeFlame = function (x, y, z, power, dt) {
    let n = power * 34 * dt;
    const f = FireFX.fire;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2.8;
      const py = y + Math.random() * 3.2;
      /* colour: white-hot core cooling to red at the crown */
      const t = Math.random();
      f.spawn(
        x + Math.cos(a) * r, py, z + Math.sin(a) * r,
        (Math.random() - 0.5) * 3.2, 5 + Math.random() * 7, (Math.random() - 0.5) * 3.2,
        1.0, 0.45 + t * 0.35, 0.08 + t * 0.12,
        3.4 + Math.random() * 3.6, 0.7 + Math.random() * 0.9,
        -1.6, 0.95
      );
    }
    if (Math.random() < dt * 5 * power) {
      FireFX.ember(x, y + 2.4, z, 1, 3.2);
    }
  };

  FireFX.smokePuff = function (x, y, z, size, dt, wind) {
    if (Math.random() > Math.min(1, dt * 38)) return;
    const w = wind || FireFX._wind;
    FireFX.smoke.spawn(
      x + (Math.random() - 0.5) * 2.6, y + 1 + Math.random() * 2, z + (Math.random() - 0.5) * 2.6,
      w.x * (0.5 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.7,
      1.6 + Math.random() * 2.2,
      w.z * (0.5 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.7,
      0.2, 0.18, 0.16,
      size * (0.9 + Math.random() * 0.7), 3.4 + Math.random() * 3.2,
      size * 0.7, 0.5
    );
  };

  /* glowing sparks that ride the heat column and the wind */
  FireFX.ember = function (x, y, z, n, spread) {
    n = n || 1;
    spread = spread || 1.6;
    const w = FireFX._wind;
    for (let i = 0; i < n; i++) {
      FireFX.embers.spawn(
        x + (Math.random() - 0.5) * spread,
        y + (Math.random() - 0.5) * spread * 0.7,
        z + (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * 2.2 + w.x * 0.5,
        1.4 + Math.random() * 3.6,
        (Math.random() - 0.5) * 2.2 + w.z * 0.5,
        1.0, 0.5 + Math.random() * 0.42, 0.1 + Math.random() * 0.16,
        0.24 + Math.random() * 0.3, 1.1 + Math.random() * 1.7,
        0.02, 0.95
      );
    }
  };

  /* a big flame licking off a moving body: larger and denser than a tree */
  FireFX.bossFlame = function (x, y, z, n, dt) {
    let k = n * dt;
    const f = FireFX.fire;
    while (k > 0) {
      if (k < 1 && Math.random() > k) break;
      k -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.85;
      f.spawn(
        x + Math.cos(a) * r, y + Math.random() * 1.8, z + Math.sin(a) * r,
        (Math.random() - 0.5) * 2.2, 2.4 + Math.random() * 3.4, (Math.random() - 0.5) * 2.2,
        1.0, 0.42 + Math.random() * 0.3, 0.06,
        1.4 + Math.random() * 1.7, 0.45 + Math.random() * 0.6,
        -1.0, 0.9
      );
    }
  };

  /* a single water droplet from the hose / a splash */
  FireFX.drop = function (x, y, z, vx, vy, vz, size) {
    FireFX.water.spawn(
      x, y, z, vx, vy, vz,
      0.42, 0.78, 1.0,
      size || (0.5 + Math.random() * 0.55), 1.6, -0.15, 0.9
    );
  };

  /* hose cone: fast, narrow, with a little wobble */
  FireFX.jet = function (origin, dir, dt, power) {
    const n = 62 * dt * (power === undefined ? 1 : power);
    let count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    const w = FireFX.water;
    while (count-- > 0) {
      const jitter = 0.055;
      const vx = (dir.x + (Math.random() - 0.5) * jitter * 2) * 44;
      const vy = (dir.y + (Math.random() - 0.5) * jitter * 2 + 0.05) * 44;
      const vz = (dir.z + (Math.random() - 0.5) * jitter * 2) * 44;
      w.spawn(
        origin.x + (Math.random() - 0.5) * 0.35,
        origin.y + (Math.random() - 0.5) * 0.35,
        origin.z + (Math.random() - 0.5) * 0.35,
        vx, vy, vz,
        0.35 + Math.random() * 0.2, 0.72, 1.0,
        0.85 + Math.random() * 0.5, 0.65 + Math.random() * 0.25,
        -0.4, 0.85
      );
    }
  };

  FireFX.splash = function (pos, n, spread) {
    spread = spread || 5;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * spread;
      FireFX.water.spawn(
        pos.x, pos.y, pos.z,
        Math.cos(a) * s, 2 + Math.random() * 6, Math.sin(a) * s,
        0.55, 0.82, 1.0,
        0.6 + Math.random() * 0.6, 0.5 + Math.random() * 0.5, -0.3, 0.8
      );
    }
  };

  FireFX.steamPuff = function (pos, n, spread) {
    spread = spread || 2.2;
    for (let i = 0; i < n; i++) {
      FireFX.steam.spawn(
        pos.x + (Math.random() - 0.5) * spread,
        pos.y + Math.random() * spread,
        pos.z + (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * 3,
        2.2 + Math.random() * 3.4,
        (Math.random() - 0.5) * 3,
        0.82, 0.86, 0.85,
        2.6 + Math.random() * 2.4, 1.5 + Math.random() * 1.2,
        2.6, 0.42
      );
    }
  };

  /* a burning trunk / ground patch: low, wide, orange */
  FireFX.groundFlame = function (x, z, radius, dt) {
    let n = radius * 5 * dt;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      FireFX.fire.spawn(
        x + Math.cos(a) * r, 0.35, z + Math.sin(a) * r,
        (Math.random() - 0.5) * 1.4, 1.4 + Math.random() * 2.4, (Math.random() - 0.5) * 1.4,
        1.0, 0.42 + Math.random() * 0.3, 0.06,
        1.3 + Math.random() * 1.6, 0.45 + Math.random() * 0.45, -1.2, 0.9
      );
    }
    if (Math.random() < dt * 3) FireFX.ember(x, 0.8, z, 1, radius * 1.4);
  };

  /* ---------------------------------------------------------- lights */
  const _lampTargets = [];
  FireFX.updateLights = function (fires, camera) {
    _lampTargets.length = 0;
    for (let i = 0; i < fires.length; i++) {
      const f = fires[i];
      if (!f) continue;
      _lampTargets.push(f);
    }
    _lampTargets.sort(function (a, b) {
      return b.intensity - a.intensity;
    });
    const cam = camera.position;
    for (let i = 0; i < FireFX._lights.length; i++) {
      const l = FireFX._lights[i];
      const f = _lampTargets[i];
      if (!f) { l.visible = false; l.intensity = 0; continue; }
      const dx = f.x - cam.x, dz = f.z - cam.z;
      const d2 = dx * dx + dz * dz;
      const fade = Math.max(0, 1 - d2 / (240 * 240));
      if (fade <= 0.01) { l.visible = false; l.intensity = 0; continue; }
      l.visible = true;
      l.position.set(f.x, f.y, f.z);
      /* flicker keeps it alive */
      l.intensity = (0.9 + f.intensity * 2.4) * fade * (0.82 + Math.random() * 0.3);
    }
  };

  FireFX.update = function (dt) {
    for (let i = 0; i < FireFX._systems.length; i++) {
      FireFX._systems[i].step(dt);
    }
    FireFX.time += dt;
  };

  FireFX.reset = function () {
    FireFX._systems.forEach(function (s) {
      s.life.fill(0); s.alpha.fill(0); s.size.fill(0);
      s.live = 0;
      s.geo.attributes.aAlpha.needsUpdate = true;
      s.geo.attributes.aSize.needsUpdate = true;
    });
    FireFX._lights.forEach(function (l) { l.visible = false; l.intensity = 0; });
  };

  window.FireFX = FireFX;
})();
