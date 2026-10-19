/* ============================================================
   sprites.js — texture atlas loading + billboard Actor (2.5D)
   Characters are camera-facing sprite planes with procedural
   squash/stretch/lean animation + additive hit-flash + shadow.

   The 2.5D Actor is the engine's fallback path: if a rigged GLB
   has not arrived yet (or the project ships no GLTF art at all)
   the game still plays, using these billboards.

   Art is optional. Any sprite PNG that 404s is replaced by a
   procedurally drawn silhouette, tinted per character by the
   caller — so a fresh clone with an empty assets/sprites/ runs
   and reads as intentional placeholder art rather than as an
   invisible bug. See docs/SPRITES.md.
   ============================================================ */
(function () {
  const S = { cache: {}, masks: {}, missing: {} };

  const DIR = "assets/sprites/";
  const LIST = [
    "hero_ultraman", "ally_zero", "ally_mebius", "ally_seven", "ally_tiga",
    "kaiju_bemular", "kaiju_redking", "kaiju_gomora", "kaiju_eleking",
    "kaiju_zetton", "kaiju_birdon", "kaiju_golza", "kaiju_kingjoe",
    "kaiju_baltan", "kaiju_jamila",
  ];

  S.ready = false;

  /* ---------------- procedural stand-in silhouettes ---------------- */

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* one flat white humanoid, drawn from the name's hash so every
     character gets its own bulk, head size and arm swing.  White
     because the Actor multiplies its own tint on top.              */
  function silhouette(name) {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 256;
    const g = c.getContext("2d");
    const h = hash(name);
    const bulk = 0.82 + ((h >> 3) & 31) / 31 * 0.36;
    const head = 1 + ((h >> 9) & 15) / 15 * 0.34;
    const swing = ((h >> 13) & 31) / 31 * 10 - 5;
    const stance = ((h >> 19) & 15) / 15 * 8;
    const cx = 64;
    g.fillStyle = "#fff"; g.strokeStyle = "#fff";
    g.lineCap = "round"; g.lineJoin = "round";
    // legs
    g.lineWidth = 15 * bulk;
    g.beginPath(); g.moveTo(cx - 6, 148); g.lineTo(cx - 9 - stance, 240); g.stroke();
    g.beginPath(); g.moveTo(cx + 6, 148); g.lineTo(cx + 9 + stance, 240); g.stroke();
    // arms
    g.lineWidth = 12 * bulk;
    g.beginPath(); g.moveTo(cx - 15, 88); g.lineTo(cx - 25 - swing, 146); g.stroke();
    g.beginPath(); g.moveTo(cx + 15, 88); g.lineTo(cx + 25 + swing, 146); g.stroke();
    // torso
    g.beginPath();
    g.moveTo(cx - 17 * bulk, 80);
    g.lineTo(cx + 17 * bulk, 80);
    g.lineTo(cx + 13 * bulk, 156);
    g.lineTo(cx - 13 * bulk, 156);
    g.closePath(); g.fill();
    // head
    g.beginPath(); g.ellipse(cx, 58, 13 * head, 16 * head, 0, 0, 7); g.fill();
    return c;
  }

  const _ph = {};
  S.placeholder = function (name) {
    if (_ph[name]) return _ph[name];
    const t = new THREE.CanvasTexture(silhouette(name));
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.encoding = THREE.sRGBEncoding;
    _ph[name] = t;
    return t;
  };
  /* data URL version, for plain <img> tags (HUD portrait, title art) */
  S.dataURL = function (name) { return silhouette(name).toDataURL("image/png"); };

  /* true when the real PNG loaded; false while it is missing */
  S.has = function (n) { return !!S.cache[n] && !S.missing[n]; };

  S.load = function (onProgress) {
    const mgr = new THREE.LoadingManager();
    const loader = new THREE.TextureLoader(mgr);
    mgr.onProgress = function (u, l) { if (onProgress) onProgress(u, l); };
    const done = new Promise(function (res) { mgr.onLoad = function () { res(); }; });
    LIST.forEach(function (n) {
      const t = loader.load(DIR + n + ".png", undefined, undefined, function () {
        // no art for this slot: swap in the silhouette so every actor
        // that gets built from here on is visible
        S.missing[n] = true;
        S.cache[n] = S.placeholder(n);
      });
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.encoding = THREE.sRGBEncoding;
      S.cache[n] = t;
    });
    return done;
  };

  S.get = function (n) { return S.cache[n]; };

  /* ---- radial shadow texture (procedural) ---- */
  let shadowTex = null;
  function getShadowTex() {
    if (shadowTex) return shadowTex;
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, "rgba(0,0,0,0.62)");
    grd.addColorStop(0.55, "rgba(0,0,0,0.32)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
    shadowTex = new THREE.CanvasTexture(c);
    return shadowTex;
  }

  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
  const _qtmp = new THREE.Quaternion(), _zAxis = new THREE.Vector3(0, 0, 1);

  /* ==================== Actor ==================== */
  function Actor(texName, opt) {
    opt = opt || {};
    this.texName = texName;
    this.height = opt.height || 3.6;
    this.group = new THREE.Group();
    this.pivot = new THREE.Group();
    this.group.add(this.pivot);

    const tex = S.get(texName);
    const img = tex && tex.image;
    const aspect = img && img.height ? (img.width / img.height) : 0.55;
    this.w = this.height * aspect;

    this.geo = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.22, depthWrite: true,
      side: THREE.DoubleSide, color: opt.color !== undefined ? opt.color : 0xffffff,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.scale.set(this.w, this.height, 1);
    this.mesh.position.y = this.height * 0.5;
    this.mesh.renderOrder = 2;
    this.pivot.add(this.mesh);

    // additive white flash overlay (impact feedback)
    this.flashMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, color: 0xffffff,
    });
    this.flashMesh = new THREE.Mesh(this.geo, this.flashMat);
    this.flashMesh.scale.copy(this.mesh.scale);
    this.flashMesh.position.copy(this.mesh.position);
    this.flashMesh.renderOrder = 3;
    this.pivot.add(this.flashMesh);

    // ground shadow
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: getShadowTex(), transparent: true, depthWrite: false, opacity: 1 })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.scale.setScalar(Math.max(this.w, 1.1) * 1.5);
    this.shadow.position.y = 0.02;
    this.group.add(this.shadow);

    // anim state
    this.yaw = 0; this.flip = 1;
    this.bobY = 0; this.tilt = 0; this.sx = 1; this.sy = 1; this.slide = 0;
    this.animT = Math.random() * 10;
    this.bobAmp = 0; this.bobRate = 6;
    this._flash = 0;
    this.groundY = 0;
    this.dead = false;
    this.A = {}; // per-entity anim hook
  }

  Actor.prototype.setTint = function (hex) { this.mat.color.setHex(hex); };

  Actor.prototype.hitFlash = function (strength) {
    this._flash = Math.max(this._flash, strength !== undefined ? strength : 1);
  };

  Actor.prototype.update = function (dt, camera) {
    // billboard: face the camera in world space (group has no rotation)
    this.pivot.quaternion.copy(camera.quaternion);

    // flip toward camera-right so the sprite "faces" its yaw
    _v2.setFromMatrixColumn(camera.matrixWorld, 0);
    _v1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.flip = _v1.dot(_v2) < 0 ? -1 : 1;

    // idle/run bob
    this.animT += dt * this.bobRate;
    const bob = Math.sin(this.animT) * this.bobAmp;
    const breathe = 1 + Math.sin(this.animT * 0.7) * 0.012;

    const s = this.A;
    this.mesh.scale.set(this.w * this.flip * this.sx * (s.sx || 1),
      this.height * this.sy * breathe * (s.sy || 1), 1);
    this.mesh.position.y = this.height * 0.5 * this.sy * (s.sy || 1) + bob + this.bobY;
    // screen-space roll (lean) applied on top of the camera orientation
    const tilt = this.tilt + (s.tilt || 0);
    if (tilt) this.pivot.quaternion.multiply(_qtmp.setFromAxisAngle(_zAxis, tilt));
    // screen-space slide (lunge)
    this.mesh.position.x = (this.slide + (s.slide || 0)) * this.flip;

    this.flashMesh.scale.copy(this.mesh.scale);
    this.flashMesh.position.copy(this.mesh.position);
    this.flashMesh.rotation.z = this.mesh.rotation.z;

    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt * 4.2);
      this.flashMat.opacity = this._flash * 0.85;
    } else if (this.flashMat.opacity !== 0) this.flashMat.opacity = 0;

    // shadow follows ground, fades with altitude
    const alt = Math.max(0, this.group.position.y - this.groundY);
    this.shadow.position.set(this.group.position.x, this.groundY + 0.02, this.group.position.z);
    const k = Math.max(0.25, 1 - alt / (this.height * 2.2));
    this.shadow.scale.setScalar(Math.max(this.w, 1.1) * 1.5 * (0.6 + 0.4 * k));
    this.shadow.material.opacity = 0.85 * k;
  };

  Actor.prototype.setPos = function (x, y, z) { this.group.position.set(x, y, z); };
  Actor.prototype.pos = function () { return this.group.position; };

  /* no-op hooks so sprite actors and rigged 3D models share one interface */
  Actor.prototype.oneShot = function () { return false; };
  Actor.prototype.setState = function () { };

  /* --- helper: build an Actor standing on ground at x,z --- */
  S.actor = function (texName, height, x, z) {
    const a = new Actor(texName, { height: height });
    a.setPos(x || 0, 0, z || 0);
    return a;
  };

  S.list = LIST;
  window.Sprites = S;
  window.Actor = Actor;
})();
