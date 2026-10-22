/* ============================================================
   wowok.js — the scanned human, reused as boss and sawit crew
   ------------------------------------------------------------
   `wowok.glb` is a single static (unrigged) scan, so every bit of
   life has to be procedural:

     · the T-pose is folded down in the vertex shader, so a plain
       scan reads as a person with arms at their sides
     · the same hook lifts one arm for a swing
     · bob / lean / lunge / fall are driven from update()

   Because the fold lives in a uniform, each actor needs its own
   material clone — cheap, they share geometry and texture.
   ============================================================ */
(function () {
  "use strict";

  const NAT = 1.891719102859497;      // native height of the scan
  const BASE = window.MODEL_BASE || "assets/models/";
  const FILES = { unit: "wowok.glb", boss: "wowok-boss.glb" };

  const W = {
    ready: false,
    failed: false,
    progress: 0
  };

  const src = { unit: null, boss: null };

  function loadOne(file) {
    return new Promise(function (res) {
      new THREE.GLTFLoader().load(
        BASE + file,
        function (g) { res(g); },
        undefined,
        function (e) { console.warn("[wowok] could not load " + file, e); res(null); }
      );
    });
  }

  function extract(gltf) {
    if (!gltf) return null;
    let mesh = null;
    gltf.scene.traverse(function (o) { if (!mesh && o.isMesh) mesh = o; });
    if (!mesh) return null;
    const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const tex = m.emissiveMap || m.map || null;
    if (tex) {
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = 4;
    }
    mesh.geometry.computeBoundingBox();
    return { geo: mesh.geometry, tex: tex };
  }

  W.load = function (onProgress) {
    return Promise.all([loadOne(FILES.unit), loadOne(FILES.boss)]).then(function (gs) {
      src.unit = extract(gs[0]);
      src.boss = extract(gs[1]) || src.unit;
      W.progress = 1;
      W.ready = !!(src.unit || src.boss);
      W.failed = !W.ready;
      if (onProgress) onProgress(W.ready);
      return W.ready;
    });
  };

  W.has = function (kind) {
    return !!(src[kind] || src.unit);
  };

  /* ---------------------------------------------------------- actor */
  function Actor(opt) {
    opt = opt || {};
    const kind = opt.kind === "boss" ? "boss" : "unit";
    const pack = src[kind] || src.unit;

    this.kind = kind;
    this.height = opt.height || 4.0;
    this.scale = this.height / NAT;
    this.group = new THREE.Group();
    this.inner = new THREE.Group();
    this.group.add(this.inner);

    this.yaw = 0;
    this.dead = false;
    this.grounded = true;
    this.speed = 0;
    this.mixer = null;
    this.t = Math.random() * 6;
    this.flash = 0;
    this.baseTint = new THREE.Color(opt.tint === undefined ? 0xffffff : opt.tint);
    this.glowColor = new THREE.Color(opt.glowColor === undefined
      ? (opt.tint === undefined ? 0xffffff : opt.tint) : opt.glowColor);
    this.tintOn = !!opt.tint;

    this.uDroop = { value: opt.droop === undefined ? 1.0 : opt.droop };
    this.uSwing = { value: 0 };
    this.uSwingB = { value: 0 };
    this.uGait = { value: 0 };
    this.droopBase = this.uDroop.value;
    this.swingT = 0;
    this.swingDur = 0.5;
    this.swingBoth = false;
    this.lungeT = 0;
    this.deadT = 0;
    this.fade = 1;

    if (pack) {
      this.glow0 = opt.glow === undefined ? 0.3 : opt.glow;
      const mat = new THREE.MeshLambertMaterial({
        map: pack.tex,
        /* the scan bakes its own shading into the texture, so the
           colour here is what makes a planter read amber and the
           boss read like a burning man */
        color: this.baseTint.clone(),
        emissive: this.glowColor.clone(),
        emissiveMap: pack.tex,
        emissiveIntensity: this.glow0,
        side: THREE.DoubleSide
      });
      const self = this;
      mat.onBeforeCompile = function (sh) {
        sh.uniforms.uDroop = self.uDroop;
        sh.uniforms.uSwing = self.uSwing;
        sh.uniforms.uSwingB = self.uSwingB;
        sh.uniforms.uGait = self.uGait;
        sh.vertexShader = "uniform float uDroop;\nuniform float uSwing;\n" +
          "uniform float uSwingB;\nuniform float uGait;\n" + sh.vertexShader;
        sh.vertexShader = sh.vertexShader.replace(
          "#include <begin_vertex>",
          [
            "vec3 transformed = vec3(position);",
            "{",
            /* the shoulders are the two pivots the arms hang from */
            "  float sx = position.x < 0.0 ? -1.0 : 1.0;",
            "  float ax = abs(position.x);",
            "  float t = clamp((ax - 0.19) / 0.42, 0.0, 1.0);",
            "  float grip = smoothstep(0.92, 1.30, position.y);",
            "  float arm = t * grip;",
            /* fold the T-pose down, plus any swing on that arm */
            "  float extra = sx > 0.0 ? uSwing : uSwingB;",
            "  float ang = (uDroop * 1.52 + extra) * arm;",
            "  float th = -sx * ang;",
            "  float c = cos(th), s = sin(th);",
            "  float dx = position.x - sx * 0.19;",
            "  float dy = position.y - 1.42;",
            "  transformed.x = sx * 0.19 + dx * c - dy * s;",
            "  transformed.y = 1.42 + dx * s + dy * c;",
            /* once the arm hangs, swing it fore/aft from the shoulder,
               the two sides in opposite phase once uGait is driven */
            "  float ga = uGait * sx * arm;",
            "  float gc = cos(ga), gs = sin(ga);",
            "  float gy = transformed.y - 1.42;",
            "  float gz = transformed.z;",
            "  transformed.y = 1.42 + gy * gc - gz * gs;",
            "  transformed.z = gy * gs + gz * gc;",
            "}"
          ].join("\n")
        );
      };
      this.mat = mat;
      this.mesh = new THREE.Mesh(pack.geo, mat);
      this.mesh.scale.setScalar(this.scale);
      /* the scan faces +Z, the same axis yaw is measured from, so no flip */
      this.mesh.frustumCulled = false;
      this.inner.add(this.mesh);

      /* a warm rim glow that sits on the skin rather than a bubble */
      if (opt.aura) {
        this.aura = new THREE.PointLight(opt.aura, 1.6, 26, 2);
        this.aura.position.y = 0.9 * this.height;
        this.inner.add(this.aura);
      }
    } else {
      /* primitive stand-in so the game never blocks on a download */
      const g = new THREE.Mesh(
        new THREE.CylinderGeometry(this.height * 0.18, this.height * 0.2, this.height * 0.72, 10),
        new THREE.MeshLambertMaterial({ color: opt.tint || 0xd08040 })
      );
      g.position.y = this.height * 0.42;
      this.inner.add(g);
      this.mesh = g;
      this.mat = g.material;
    }

    this.headY = this.height * 0.90;
    this.handY = this.height * 0.42;
    this._flashBase = new THREE.Color(0xffffff);
    this._flash = new THREE.Color();
  }

  Actor.prototype.setTint = function (hex, glow) {
    this.tintOn = true;
    this.baseTint.setHex(hex);
    if (glow !== undefined) this.glowColor.setHex(glow);
    if (this.mat && this.mat.emissive) this.mat.emissive.copy(this.glowColor);
  };

  Actor.prototype.setPos = function (x, y, z) {
    this.group.position.set(x, y || 0, z);
  };

  Actor.prototype.setState = function (s) {
    if (!s) return;
    if (s.speed !== undefined) this.speed = s.speed;
    if (s.grounded !== undefined) this.grounded = s.grounded;
  };

  Actor.prototype.oneShot = function (slot) {
    if (slot === "death") { this.dead = true; return; }
    if (slot === "hit") { this.flash = Math.max(this.flash, 0.35); return; }
    if (slot === "slash" || slot === "atk1" || slot === "atk2") {
      this.swingT = 0.0001;
      this.swingDur = slot === "atk2" ? 0.7 : 0.48;
      this.swingBoth = slot === "atk2";   // planting is a two-handed chop
      this.lungeT = 0.0001;
      return;
    }
    /* roll / land / etc. — a little hop is enough */
    this.lungeT = Math.max(this.lungeT, 0.18);
  };

  Actor.prototype.hitFlash = function (t) {
    this.flash = Math.max(this.flash, t || 0.5);
  };

  Actor.prototype.update = function (dt) {
    const g = this.group;
    this.t += dt;
    const sp = Math.min(1.6, this.speed / 6);

    /* ---- yaw ---- */
    let d = this.yaw - g.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    g.rotation.y += d * Math.min(1, dt * 9);

    /* ---- walk: bob + lean + sway ---- */
    let bob = Math.sin(this.t * (3.0 + sp * 3.4)) * (0.02 + sp * 0.055) * this.height;
    const lean = -0.09 * sp;
    const sway = Math.sin(this.t * (1.4 + sp * 1.6)) * (0.012 + sp * 0.03);

    /* ---- attack swing ---- */
    let swing = 0;
    if (this.swingT > 0) {
      this.swingT += dt;
      const p = Math.min(1, this.swingT / this.swingDur);
      /* wind up, then snap down */
      swing = p < 0.34 ? -1.25 * (p / 0.34) : -1.25 + 2.5 * ((p - 0.34) / 0.66);
      if (p >= 1) { this.swingT = 0; swing = 0; }
      this.uSwing.value = swing;
    } else if (this.uSwing.value !== 0) {
      this.uSwing.value *= Math.max(0, 1 - dt * 9);
      if (Math.abs(this.uSwing.value) < 0.01) this.uSwing.value = 0;
    }
    /* the other arm follows a swipe, and joins a two-handed chop */
    this.uSwingB.value = this.uSwing.value * (this.swingBoth ? 0.9 : 0.22);

    /* ---- arms: a breath when still, a stride once walking ---- */
    const stride = 0.09 + sp * 0.42;
    this.uGait.value = Math.sin(this.t * (3.0 + sp * 3.4)) * stride;

    /* ---- lunge ---- */
    let lunge = 0;
    if (this.lungeT > 0) {
      this.lungeT += dt;
      const p = Math.min(1, this.lungeT / 0.42);
      lunge = Math.sin(p * Math.PI) * 0.22;
      if (p >= 1) this.lungeT = 0;
    }

    /* ---- death ---- */
    if (this.dead) {
      this.deadT += dt;
      const p = Math.min(1, this.deadT / 1.1);
      const e = 1 - Math.pow(1 - p, 3);
      this.inner.rotation.x = -1.45 * e;
      bob -= e * this.height * 0.12;
      this.fade = Math.max(0, 1 - Math.max(0, this.deadT - 0.7) / 1.4);
      if (this.mat) {
        this.mat.transparent = true;
        this.mat.opacity = this.fade;
      }
    }

    /* ---- flash ---- */
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 2.6);
      const k = this.flash;
      if (this.mat && this.mat.emissive) {
        this._flash.setRGB(1, 0.92, 0.82).lerp(this.baseTint, 1 - k);
        this.mat.emissive.copy(this._flash);
        this.mat.emissiveIntensity = this.glow0 + k * 1.7;
      }
    } else if (this.mat && this.mat.emissive && this.tintOn) {
      this.mat.emissive.copy(this.glowColor);
      this.mat.emissiveIntensity = this.glow0;
    }

    this.inner.position.set(0, bob, lunge * 0.6);
    this.inner.rotation.x = lean - lunge * 0.5;
    this.inner.rotation.z = sway + swing * 0.06;

    if (this.aura) {
      this.aura.intensity = 1.3 + 0.5 * Math.sin(this.t * 4.2);
    }
  };

  Actor.prototype.dispose = function () {
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this.mat) this.mat.dispose();
  };

  W.create = function (opt) { return new Actor(opt); };
  W.NAT = NAT;
  window.Wowok = W;
})();
