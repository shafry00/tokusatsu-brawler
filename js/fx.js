/* ============================================================
   fx.js — particles, impact rings, damage numbers, hitstop,
            screen shake, shockwaves, flashes, beam VFX
   ============================================================ */
(function () {
  const FX = {
    scene: null, camera: null, renderer: null,
    timeScale: 1, freeze: 0, slow: 0, slowScale: 1,
    shakeAmt: 0, shakeDecay: 6, shakeOffset: new THREE.Vector3(),
    _parts: [], _rings: [], _nums: [], _beams: [], _shocks: [], _arcs: [],
  };

  const MAX_PARTS = 340;
  let pGeo, pMat;

  FX.init = function (scene, camera, renderer) {
    FX.scene = scene; FX.camera = camera; FX.renderer = renderer;
    pGeo = new THREE.BoxGeometry(1, 1, 1);
    pMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
    const wrap = document.getElementById("flash");
    FX._flashEl = wrap;
    FX._numLayer = document.createElement("div");
    FX._numLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:22;overflow:hidden";
    document.getElementById("app").appendChild(FX._numLayer);
  };

  /* ---------------- particles ---------------- */
  function getParticle() {
    for (let i = 0; i < FX._parts.length; i++) if (!FX._parts[i].alive) return FX._parts[i];
    if (FX._parts.length >= MAX_PARTS) return null;
    const m = new THREE.Mesh(pGeo, pMat.clone());
    m.visible = false; m.frustumCulled = false;
    FX.scene.add(m);
    const p = { mesh: m, alive: false, vel: new THREE.Vector3(), spin: new THREE.Vector3(),
      life: 0, max: 1, grav: 12, drag: 0.98, s0: 1, s1: 0.1, glow: false };
    FX._parts.push(p);
    return p;
  }

  FX.dir = function (opts) {
    const t = Math.random() * Math.PI * 2;
    const z = Math.random() * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return new THREE.Vector3(Math.cos(t) * r, Math.abs(z) * (opts && opts.up || 1), Math.sin(t) * r).multiplyScalar(opts && opts.speed || 1);
  };

  FX.spark = function (pos, opts) {
    opts = opts || {};
    const p = getParticle(); if (!p) return;
    const m = p.mesh;
    m.visible = true;
    m.position.copy(pos);
    m.material.color.set(opts.color !== undefined ? opts.color : 0xffcf66);
    m.material.opacity = 1;
    p.vel.copy(opts.vel || FX.dir({ speed: 9 }));
    p.grav = opts.grav !== undefined ? opts.grav : 22;
    p.drag = opts.drag || 0.96;
    p.spin.set((Math.random() - .5) * 12, (Math.random() - .5) * 12, (Math.random() - .5) * 12);
    p.life = 0; p.max = opts.life || (0.4 + Math.random() * 0.5);
    p.s0 = opts.size || (0.12 + Math.random() * 0.22);
    p.s1 = opts.size1 !== undefined ? opts.size1 : p.s0 * 0.1;
    m.scale.setScalar(p.s0);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    p.alive = true;
  };

  FX.burst = function (pos, color, count, opts) {
    opts = opts || {};
    for (let i = 0; i < count; i++) {
      FX.spark(pos, {
        color: opts.color2 && Math.random() < .35 ? opts.color2 : color,
        vel: FX.dir({ speed: (opts.speed || 9) * (0.4 + Math.random() * 0.9), up: opts.up || 1 }),
        grav: opts.grav !== undefined ? opts.grav : 20,
        life: (opts.life || 0.55) * (0.6 + Math.random() * 0.8),
        size: (opts.size || 0.22) * (0.6 + Math.random() * 0.9),
        drag: opts.drag || 0.955,
      });
    }
  };

  FX.debris = function (pos, color, count) {
    for (let i = 0; i < count; i++) {
      FX.spark(pos, {
        color: color, vel: FX.dir({ speed: 14 * (0.5 + Math.random()), up: 1.4 }),
        grav: 34, life: 1.1 + Math.random(), size: 0.3 + Math.random() * 0.5, drag: 0.985,
        vel: new THREE.Vector3((Math.random() - .5) * 18, 8 + Math.random() * 14, (Math.random() - .5) * 18),
      });
    }
  };

  /* ---------------- impact ring ---------------- */
  FX.ring = function (pos, color, maxR, life, opt) {
    opt = opt || {};
    const g = new THREE.RingGeometry(0.35, 0.5, 40);
    const m = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(pos);
    if (opt.flat !== false) mesh.rotation.x = -Math.PI / 2;
    if (opt.quat) mesh.quaternion.copy(opt.quat);
    FX.scene.add(mesh);
    FX._rings.push({ mesh: mesh, t: 0, max: life || 0.45, r0: opt.r0 || 0.5, r1: maxR || 4, base: m.opacity });
    return mesh;
  };

  FX.shock = function (pos, color, r, life) {
    const g = new THREE.SphereGeometry(1, 18, 14);
    const m = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(pos); mesh.scale.setScalar(0.4);
    FX.scene.add(mesh);
    FX._shocks.push({ mesh: mesh, t: 0, max: life || 0.4, r: r || 5 });
  };

  /* ---------------- composite explosion ---------------- */
  FX.explodeAt = function (pos, scale) {
    scale = scale || 1;
    FX.burst(pos, 0xffd24a, Math.round(24 * scale), { speed: 15 * scale, life: 0.85, grav: 18, size: 0.3 * scale, color2: 0xff7a2a });
    FX.burst(pos, 0xffffff, Math.round(9 * scale), { speed: 22 * scale, life: 0.42, grav: 6, size: 0.22 * scale });
    FX.shock(pos, 0xffb060, 7 * scale, 0.5);
    FX.ring(pos, 0xffe0a0, 9 * scale, 0.55);
    FX.shake(0.45 * scale);
    Audio2.sfx("explode");
  };

  /* ---------------- damage numbers ---------------- */
  FX.damage = function (pos, amount, kind) {
    const el = document.createElement("div");
    const color = kind === "crit" ? "#ffd24a" : kind === "player" ? "#ff5b6b"
      : kind === "heal" ? "#63f0a0" : kind === "block" ? "#9fd8ff" : "#ffffff";
    const size = kind === "crit" ? 30 : kind === "player" ? 24 : kind === "block" ? 15 : 20;
    el.style.cssText = "position:absolute;font-family:var(--mono);font-weight:800;pointer-events:none;" +
      "color:" + color + ";font-size:" + size + "px;text-shadow:0 2px 10px #000,0 0 18px " + color + ";transform:translate(-50%,-50%)";
    el.textContent = (kind === "heal" ? "+" : "") + Math.round(amount);
    FX._numLayer.appendChild(el);
    FX._nums.push({ el: el, pos: pos.clone(), t: 0, max: 0.9, vy: 3.4 + Math.random() * 1.4, vx: (Math.random() - .5) * 2 });
  };

  /* ---------------- camera feel ---------------- */
  FX.shake = function (a) { FX.shakeAmt = Math.min(1.6, FX.shakeAmt + a); };
  FX.hitstop = function (ms) { FX.freeze = Math.max(FX.freeze, ms / 1000); };
  FX.slowmo = function (scale, ms) { FX.slowScale = scale; FX.slow = Math.max(FX.slow, ms / 1000); };
  FX.flash = function (alpha, color) {
    if (!FX._flashEl) return;
    FX._flashEl.style.background = color || "#fff";
    FX._flashEl.style.opacity = String(alpha);
    setTimeout(function () { FX._flashEl.style.opacity = "0"; }, 60);
  };

  const _v = new THREE.Vector3();
  function project(p) {
    _v.copy(p).project(FX.camera);
    const w = FX.renderer.domElement.clientWidth, h = FX.renderer.domElement.clientHeight;
    return { x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * h, z: _v.z };
  }

  /* ---------------- beam ---------------- */
  FX.beam = function (from, to, opts) {
    opts = opts || {};
    const len = from.distanceTo(to);
    const rad = opts.radius || 0.9;
    const g = new THREE.CylinderGeometry(rad, rad * (opts.taper || 0.7), 1, 12, 1, true);
    const core = new THREE.MeshBasicMaterial({ color: opts.color || 0xbff6ff, transparent: true, opacity: 0.92,
      blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.MeshBasicMaterial({ color: opts.glow || 0x39c8ff, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const grp = new THREE.Group();
    const m1 = new THREE.Mesh(g, core); m1.scale.set(1, len, 1);
    const g2 = new THREE.CylinderGeometry(rad * 1.9, rad * 1.5, 1, 12, 1, true);
    const m2 = new THREE.Mesh(g2, glow); m2.scale.set(1, len, 1);
    grp.add(m2); grp.add(m1);
    grp.position.copy(from).add(to).multiplyScalar(0.5);
    grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    grp.lookAt && 0;
    FX.scene.add(grp);
    FX._beams.push({ g: grp, t: 0, max: opts.life || 0.32, m1: m1, m2: m2, scaleUp: opts.scaleUp !== false });
  };

  FX.lightning = function (a, b, color) {
    const seg = 7, pts = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const p = a.clone().lerp(b, t);
      if (i > 0 && i < seg) p.add(new THREE.Vector3((Math.random() - .5) * 2.2, (Math.random() - .5) * 2.2, (Math.random() - .5) * 2.2));
      pts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: color || 0xbff6ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending });
    const line = new THREE.Line(geo, mat);
    FX.scene.add(line);
    FX._beams.push({ g: line, t: 0, max: 0.18, line: true, mat: mat });
  };

  /* ---------------- slash arc ----------------
     A crescent that sweeps in front of a fighter.

     `vertical: false` (default) lays it flat on the ground — good for slams,
     stomps and "danger zone" sweeps seen from above.  `vertical: true` stands
     it up in the plane the fighter swings through (forward × up), which is
     what a punch or a blade trail has to look like from a third-person
     camera; a flat ring seen edge-on is invisible.

     `yaw` is the game's heading: forward = (sin yaw, 0, cos yaw).
     `rot` rotates the sweep centre (0 = straight ahead).               */
  const _arcFwd = new THREE.Vector3(), _arcUp = new THREE.Vector3(0, 1, 0),
    _arcRight = new THREE.Vector3(), _arcBasis = new THREE.Matrix4();
  FX.arc = function (pos, yaw, radius, opt) {
    opt = opt || {};
    const span = opt.span || Math.PI * 1.15;
    const r0 = radius * (opt.inner || 0.6);
    const rot = opt.rot || 0;
    const g = new THREE.RingGeometry(r0, radius, 30, 1, rot - span / 2, span);
    const m = new THREE.MeshBasicMaterial({
      color: opt.color !== undefined ? opt.color : 0xdff4ff,
      transparent: true, opacity: opt.opacity !== undefined ? opt.opacity : 0.85,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(pos);
    if (opt.vertical) {
      // local +X -> forward, local +Y -> up, so theta 0 aims the arc ahead
      _arcFwd.set(Math.sin(yaw), 0, Math.cos(yaw));
      _arcRight.crossVectors(_arcFwd, _arcUp);
      _arcBasis.makeBasis(_arcFwd, _arcUp, _arcRight);
      mesh.quaternion.setFromRotationMatrix(_arcBasis);
    } else {
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = yaw - Math.PI / 2 - rot;
    }
    FX.scene.add(mesh);
    FX._arcs.push({ mesh: mesh, t: 0, max: opt.life || 0.22, s0: 0.8, s1: 1.16,
      base: m.opacity, spin: opt.spin || 0 });
  };

  /* energy pulled into a point (charge-ups) */
  FX.gather = function (pos, color, count, radius, life) {
    radius = radius || 3.4;
    life = life || 0.34;
    for (let i = 0; i < count; i++) {
      const d = FX.dir({ speed: 0 });
      d.setLength(radius * (0.55 + Math.random() * 0.75));
      FX.spark(pos.clone().add(d), {
        color: color, vel: d.clone().multiplyScalar(-radius / (life * 0.85)),
        grav: 0, drag: 1, life: life * (0.7 + Math.random() * 0.5),
        size: 0.11 + Math.random() * 0.12,
      });
    }
  };

  /* a struck point: flash, sparks and a soft shell */
  FX.impact = function (pos, color, scale) {
    scale = scale || 1;
    FX.burst(pos, color, Math.round(10 * scale), { speed: 14 * scale, life: 0.4, grav: 8, size: 0.22 * scale, color2: 0xffffff });
    FX.shock(pos, color, 2.4 * scale, 0.2);
  };

  /* ---------------- update ---------------- */
  FX.update = function (dtReal) {
    if (FX.freeze > 0) { FX.freeze -= dtReal; FX.timeScale = 0.02; }
    else if (FX.slow > 0) { FX.slow -= dtReal; FX.timeScale = FX.slowScale; }
    else FX.timeScale = 1;

    const dt = dtReal * FX.timeScale;

    // particles
    for (let i = 0; i < FX._parts.length; i++) {
      const p = FX._parts[i]; if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) { p.alive = false; p.mesh.visible = false; continue; }
      const u = p.life / p.max;
      p.vel.y -= p.grav * dt;
      p.vel.multiplyScalar(Math.pow(p.drag, dt * 60));
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt; p.mesh.rotation.z += p.spin.z * dt;
      p.mesh.scale.setScalar(p.s0 + (p.s1 - p.s0) * u);
      p.mesh.material.opacity = 1 - u * u;
    }

    // rings
    for (let i = FX._rings.length - 1; i >= 0; i--) {
      const r = FX._rings[i]; r.t += dt;
      const u = Math.min(1, r.t / r.max);
      const s = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - u, 2.2));
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = r.base * (1 - u);
      if (u >= 1) { FX.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); FX._rings.splice(i, 1); }
    }

    // slash arcs
    for (let i = FX._arcs.length - 1; i >= 0; i--) {
      const a = FX._arcs[i]; a.t += dt;
      const u = Math.min(1, a.t / a.max);
      a.mesh.scale.setScalar(a.s0 + (a.s1 - a.s0) * (1 - Math.pow(1 - u, 2)));
      a.mesh.material.opacity = a.base * (1 - u) * (1 - u);
      if (a.spin) a.mesh.rotateZ(a.spin * dt);
      if (u >= 1) {
        FX.scene.remove(a.mesh);
        a.mesh.geometry.dispose(); a.mesh.material.dispose();
        FX._arcs.splice(i, 1);
      }
    }

    // shocks
    for (let i = FX._shocks.length - 1; i >= 0; i--) {
      const s = FX._shocks[i]; s.t += dt; const u = Math.min(1, s.t / s.max);
      s.mesh.scale.setScalar(0.3 + s.r * (1 - Math.pow(1 - u, 2)));
      s.mesh.material.opacity = 0.75 * (1 - u);
      if (u >= 1) { FX.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); FX._shocks.splice(i, 1); }
    }

    // beams
    for (let i = FX._beams.length - 1; i >= 0; i--) {
      const b = FX._beams[i]; b.t += dtReal; const u = Math.min(1, b.t / b.max);
      if (b.line) { b.mat.opacity = 1 - u; }
      else {
        const k = b.scaleUp ? (u < 0.3 ? u / 0.3 : 1) : 1;
        b.m1.scale.x = b.m1.scale.z = k * (1 - u * 0.6) + 0.001;
        b.m2.scale.x = b.m2.scale.z = k * (1 - u * 0.4) + 0.001;
        b.m1.material.opacity = 1 - u; b.m2.material.opacity = (1 - u) * 0.55;
      }
      if (u >= 1) {
        if (b.line) { if (b.g.geometry) b.g.geometry.dispose(); if (b.mat) b.mat.dispose(); }
        else {
          if (b.m1) { b.m1.geometry.dispose(); b.m1.material.dispose(); }
          if (b.m2) { b.m2.geometry.dispose(); b.m2.material.dispose(); }
        }
        FX.scene.remove(b.g); FX._beams.splice(i, 1);
      }
    }

    // damage numbers
    for (let i = FX._nums.length - 1; i >= 0; i--) {
      const n = FX._nums[i]; n.t += dtReal; const u = n.t / n.max;
      if (u >= 1) { n.el.remove(); FX._nums.splice(i, 1); continue; }
      n.pos.y += n.vy * dtReal; n.pos.x += n.vx * dtReal; n.vy *= 0.94;
      const s = project(n.pos);
      n.el.style.left = s.x + "px"; n.el.style.top = s.y + "px";
      n.el.style.opacity = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
      n.el.style.transform = "translate(-50%,-50%) scale(" + (1 + (1 - Math.min(1, n.t * 6)) * 0.5) + ")";
    }

    // shake
    if (FX.shakeAmt > 0.001) {
      FX.shakeAmt = Math.max(0, FX.shakeAmt - FX.shakeDecay * dtReal * (0.5 + FX.shakeAmt));
      FX.shakeOffset.set((Math.random() - .5) * FX.shakeAmt, (Math.random() - .5) * FX.shakeAmt, (Math.random() - .5) * FX.shakeAmt * 0.5);
    } else { FX.shakeAmt = 0; FX.shakeOffset.set(0, 0, 0); }
  };

  FX.reset = function () {
    for (let i = 0; i < FX._parts.length; i++) { FX._parts[i].alive = false; FX._parts[i].mesh.visible = false; }
    for (let i = FX._rings.length - 1; i >= 0; i--) { FX.scene.remove(FX._rings[i].mesh); }
    FX._rings.length = 0;
    for (let i = FX._shocks.length - 1; i >= 0; i--) { FX.scene.remove(FX._shocks[i].mesh); }
    FX._shocks.length = 0;
    for (let i = FX._arcs.length - 1; i >= 0; i--) { FX.scene.remove(FX._arcs[i].mesh); }
    FX._arcs.length = 0;
    for (let i = FX._beams.length - 1; i >= 0; i--) {
      const b = FX._beams[i];
      if (b.line) { if (b.g.geometry) b.g.geometry.dispose(); if (b.mat) b.mat.dispose(); }
      else {
        if (b.m1) { b.m1.geometry.dispose(); b.m1.material.dispose(); }
        if (b.m2) { b.m2.geometry.dispose(); b.m2.material.dispose(); }
      }
      FX.scene.remove(b.g);
    }
    FX._beams.length = 0;
    if (FX._nums) { for (let i = 0; i < FX._nums.length; i++) FX._nums[i].el.remove(); FX._nums.length = 0; }
    FX.shakeAmt = 0; FX.freeze = 0; FX.slow = 0; FX.timeScale = 1;
  };

  window.FX = FX;
})();
