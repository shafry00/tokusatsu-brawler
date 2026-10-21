/* ============================================================
   boss.js — SANG BAKAR
   ------------------------------------------------------------
   A fire demon with one job: turn the reserve into ash. He walks
   the healthiest clump of trees he can find, torches it, lobs
   fireballs at anything he cannot reach, and roars the forest
   alight when he gets hurt.

   He is made of fire, so the hammer barely touches him — until
   the hose has soaked him to the bone. Fill the soak meter, wait
   for the steam, then swing.
   ============================================================ */
(function () {
  "use strict";

  const TUNE = {
    height: 13.4,
    speed: 7.2,
    speedRage: 1.18,
    hpBase: 2400,
    radius: 4.3,
    soakMax: 100,
    soakDecay: 7,
    soakHold: 0.55,
    douseTime: 7.0,
    igniteEvery: 2.3,
    igniteRadius: 15,
    throwEvery: 6.2,
    swipeEvery: 3.0,
    swipeRange: 15,
    swipeDamage: 13,
    fireballDamage: 10
  };

  function glowTexture() {
    const s = 64;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.3, "rgba(255,236,186,.85)");
    gr.addColorStop(1, "rgba(255,120,40,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function Boss(scene, opts) {
    this.scene = scene;
    this.pos = new THREE.Vector3(opts.x || 0, 0, opts.z || 140);
    this.home = this.pos.clone();
    this.height = TUNE.height;
    this.radius = TUNE.radius;
    this.maxHp = opts.hp || TUNE.hpBase;
    this.hp = this.maxHp;
    this.soak = 0;
    this.doused = false;
    this.douseT = 0;
    this.soakCool = 0;
    this.state = "enter";
    this.stateT = 0;
    this.phase = 1;
    this.gone = false;
    this.dying = false;
    this.deathT = 0;
    this.yaw = 0;
    this.speed = TUNE.speed;
    this.target = null;
    this.targetT = 0;
    this.igniteT = 0;
    this.throwT = 2.5;
    this.swipeT = 1.5;
    this.wind = 0;
    this.windKind = null;
    this.actor = null;
    this.fireballs = [];
    this.entered = false;
    this.rage = 0;
    this._tmp = new THREE.Vector3();
    this._build();
  }

  Boss.prototype._build = function () {
    let a = null;
    try {
      if (window.Wowok && Wowok.has("boss")) {
        a = Wowok.create({
          kind: "boss", height: this.height,
          tint: 0xc2471c, glow: 0.42,
          droop: 0.46, aura: 0xff5210
        });
        a.isWowok = true;
      }
    } catch (e) { /* fall through */ }
    if (!a) {
      try {
        if (window.Models) a = Models.createKaiju("kaiju_birdon", { height: this.height });
      } catch (e) { /* fall through to the primitive */ }
    }

    if (a) {
      this.actor = a;
      this.group = a.group;
      if (!a.isWowok) a.setTint(0xffc79a);
      a.turn = 6;
    } else {
      /* stand-in: a burning hulk so the fight still works */
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.IcosahedronGeometry(4, 1),
        new THREE.MeshLambertMaterial({ color: 0x6a2416, flatShading: true, emissive: 0x812508, emissiveIntensity: 1 })
      );
      body.position.y = 7;
      g.add(body);
      const head = new THREE.Mesh(
        new THREE.IcosahedronGeometry(2.2, 0),
        new THREE.MeshLambertMaterial({ color: 0x8c2f14, flatShading: true, emissive: 0xff6a22, emissiveIntensity: 1.2 })
      );
      head.position.set(0, 12, 1);
      g.add(head);
      this.group = g;
    }

    this.scene.add(this.group);
    this.group.position.copy(this.pos);

    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(this.radius * 1.5, 20), window.BlobShadow.mat(0.55));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(this.pos.x, 0.05, this.pos.z);
    this.scene.add(this.shadow);
    this.height = this.actor ? this.height : 14;

    this.light = new THREE.PointLight(0xff5a18, 2.4, 90, 2);
    this.light.position.set(this.pos.x, this.height * 0.6, this.pos.z);
    this.scene.add(this.light);

    /* a personal smog cloud */
    this.smog = new THREE.Mesh(
      new THREE.SphereGeometry(this.height * 0.55, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x2a0d04, transparent: true, opacity: 0.1, depthWrite: false })
    );
    this.smog.position.y = this.height * 0.5;
    this.group.add(this.smog);

    /* two hot points where the face is — the scan has no rig, so the
       "gaze" is a pair of additive sprites that track the head */
    const tex = glowTexture();
    this.eyes = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: 0xffc46a, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0.95
      }));
      sp.userData.ph = i * 1.7;
      sp.scale.setScalar(this.height * 0.05);
      this.eyes.add(sp);
    }
    this.scene.add(this.eyes);

    /* fireball pool */
    const geo = new THREE.SphereGeometry(1.25, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false;
      this.scene.add(m);
      this.fireballs.push({ mesh: m, pos: new THREE.Vector3(), vel: new THREE.Vector3(), radius: 2.4, life: 0, dead: true });
    }
  };

  /* ---------------------------------------------------------- soak */
  Boss.prototype.addSoak = function (n) {
    if (this.dying || this.gone) return;
    this.soakCool = 0;
    if (this.doused) return;
    this.soak = clamp(this.soak + n, 0, TUNE.soakMax);
    if (this.soak >= TUNE.soakMax) this._douse();
  };

  Boss.prototype._douse = function () {
    this.doused = true;
    this.douseT = TUNE.douseTime;
    this.soak = TUNE.soakMax;
    this.state = "doused";
    this.windKind = null;
    if (this.actor) this.actor.oneShot("hit", 0.5);
    if (window.Audio2) { Audio2.sfx("steam"); Audio2.sfx("roar"); }
    FX.shake(0.5);
    FireFX.steamPuff({ x: this.pos.x, y: this.height * 0.4, z: this.pos.z }, 60, this.radius * 2.2);
    FX.shock(this.pos.clone().setY(4), 0x9fe8ff, 20, 0.6);
    if (this.onEvent) this.onEvent("doused", this);
  };

  /* ---------------------------------------------------------- hits */
  Boss.prototype.hitByHammer = function (amount, wet) {
    if (this.dying || this.gone) return;
    this.hp -= amount;
    if (this.actor) {
      this.actor.hitFlash(0.7);
      this.actor.oneShot("hit", 0.35);
    }
    const p = new THREE.Vector3(this.pos.x, this.height * (wet ? 0.45 : 0.6), this.pos.z);
    FX.damage(p, amount, wet ? "crit" : "block");
    if (wet) {
      FireFX.steamPuff(p, 14, 3.4);
      if (window.Audio2) Audio2.sfx("hitCrit");
      FX.shake(0.34);
    } else {
      FX.burst(p, 0xbfbfb0, 8, { speed: 7, life: 0.4, size: 0.8 });
      if (window.Audio2) Audio2.sfx("block");
    }
    if (this.hp <= 0) this._die();
  };

  Boss.prototype.hitByHeli = function (n) {
    if (this.dying || this.gone) return;
    this.addSoak(n * 2);
    this.hp -= n * 0.5;
    if (this.hp <= 0) this._die();
  };

  Boss.prototype._die = function () {
    if (this.dying) return;
    this.dying = true;
    this.deathT = 0;
    this.hp = 0;
    this.doused = false;
    this.state = "dying";
    if (this.actor) {
      this.actor.oneShot("death", 2.2);
      this.actor.dead = true;
    }
    if (window.Audio2) { Audio2.sfx("roar"); Audio2.sfx("explode"); }
    FX.shake(1.1);
    FX.flash(0.35, 0xffa040);
    FX.slowmo(0.35, 900);
    FireFX.steamPuff({ x: this.pos.x, y: this.height * 0.4, z: this.pos.z }, 90, this.radius * 2.6);
    if (this.onEvent) this.onEvent("bossDown", this);
  };

  /* ---------------------------------------------------------- fireballs */
  Boss.prototype._throwAt = function (target, kind) {
    const fb = this.fireballs.find(function (f) { return f.dead; });
    if (!fb) return;
    const from = new THREE.Vector3(this.pos.x, this.height * 0.72, this.pos.z);
    const to = target.clone();
    to.y = Math.max(1.5, to.y || 1.5);
    const flat = Math.sqrt((to.x - from.x) * (to.x - from.x) + (to.z - from.z) * (to.z - from.z)) || 1;
    const speed = kind === "player" ? 42 : 34;
    const time = flat / speed;
    fb.pos.copy(from);
    fb.vel.set((to.x - from.x) / time, (to.y - from.y) / time + 0.5 * 22 * time, (to.z - from.z) / time);
    fb.life = 4.2;
    fb.dead = false;
    fb.kind = kind;
    fb.mesh.visible = true;
    fb.mesh.position.copy(fb.pos);
    if (this.actor) this.actor.oneShot("atk1", 0.6);
    if (window.Audio2) Audio2.sfx("beam");
    FireFX.steamPuff(from, 4, 1.4);
  };

  Boss.prototype._updateEyes = function () {
    if (!this.eyes) return;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const y = this.height * 0.9;
    const cx = this.pos.x + fx * this.height * 0.028;
    const cz = this.pos.z + fz * this.height * 0.028;
    const gap = this.height * 0.026;
    const eyes = this.eyes.children;
    const now = performance.now() * 0.012;
    for (let i = 0; i < eyes.length; i++) {
      const e = eyes[i];
      const s = i === 0 ? -1 : 1;
      e.position.set(cx + rx * gap * s, y, cz + rz * gap * s);
      e.material.color.setHex(this.doused ? 0x9fe8ff : this.dying ? 0xffe3b0 : 0xffb457);
      e.material.opacity = this.dying ? Math.max(0, 1 - this.deathT / 2.4) : (this.doused ? 0.5 : 0.95);
      e.scale.setScalar(this.height * 0.05 * (0.85 + Math.sin(now + e.userData.ph) * 0.16));
    }
  };

  /* ---------------------------------------------------------- update */
  Boss.prototype.update = function (dt, ctx) {
    if (this.gone) return;
    this.stateT += dt;
    this.light.position.set(this.pos.x, this.height * 0.6, this.pos.z);
    this.light.intensity = 2.0 + Math.sin(performance.now() * 0.008) * 0.5;

    this._updateEyes();

    /* he is literally on fire: flames climb the silhouette, not the middle
       of the mesh (particles spawned inside the body are depth-culled) */
    if (!this.doused && !this.dying) {
      const h = this.height;
      const rr = h * 0.11;
      for (let i = 0; i < 3; i++) {
        if (Math.random() > dt * 20) continue;
        const a = Math.random() * Math.PI * 2;
        FireFX.treeFlame(
          this.pos.x + Math.cos(a) * rr,
          h * (0.22 + Math.random() * 0.62),
          this.pos.z + Math.sin(a) * rr,
          0.34, dt
        );
      }
      if (Math.random() < dt * 7) {
        FireFX.groundFlame(this.pos.x, this.pos.z, this.radius * 0.85, dt);
      }
    }

    if (!this.doused && Math.random() < dt * 26) {
      FireFX.ember(
        this.pos.x + rand(-this.radius, this.radius) * 0.8,
        rand(1.5, this.height * 0.85),
        this.pos.z + rand(-this.radius, this.radius) * 0.8,
        1, 1.4
      );
    }

    /* fireballs already in the air keep flying, even as he goes */
    this._updateFireballs(dt, ctx);

    if (this.dying) {
      this.deathT += dt;
      this.light.intensity = Math.max(0, 2 - this.deathT) * 0.6;
      FireFX.steamPuff({ x: this.pos.x, y: this.height * 0.3, z: this.pos.z }, 3, this.radius * 1.6);
      if (this.deathT > 0.4 && this.deathT < 2.6) {
        this.group.position.y = -this.deathT * 1.6;
        this.group.rotation.z = Math.min(0.5, this.deathT * 0.22);
      }
      if (this.deathT > 3.4) {
        this.gone = true;
        this.group.visible = false;
        this.light.visible = false;
        if (this.onEvent) this.onEvent("bossGone", this);
      }
      if (this.actor) this.actor.update(dt, ctx.camera);
      return;
    }

    /* soak evaporates */
    this.soakCool += dt;
    if (!this.doused && this.soakCool > TUNE.soakHold && this.soak > 0) {
      this.soak = Math.max(0, this.soak - TUNE.soakDecay * dt);
    }

    if (this.doused) {
      this.douseT -= dt;
      this.state = "doused";
      if (Math.random() < dt * 26) {
        FireFX.steamPuff({
          x: this.pos.x + rand(-3, 3), y: rand(2, this.height), z: this.pos.z + rand(-3, 3)
        }, 3, 2.4);
      }
      if (this.douseT <= 0) {
        this.doused = false;
        this.soak = 0;
        this.soakCool = 0;
        this.rage++;
        this.speed = TUNE.speed * (1 + this.rage * 0.08);
        this.state = "stalk";
        if (window.Audio2) Audio2.sfx("roar");
        FX.shock(this.pos.clone().setY(5), 0xff6a2b, 16, 0.5);
        FX.shake(0.35);
        if (this.onEvent) this.onEvent("bossRage", this);
      }
      this._faceAndStep(dt, ctx, 0);
      this._animate(dt, ctx, 0);
      return;
    }

    /* phase roars */
    const hpFrac = this.hp / this.maxHp;
    if (this.phase === 1 && hpFrac < 0.68) this._roar(2, ctx);
    else if (this.phase === 2 && hpFrac < 0.34) this._roar(3, ctx);

    if (this.state === "enter") {
      this.entered = true;
      this.state = "stalk";
      this.target = null;
    }

    if (this.state === "roar") {
      if (this.stateT > 1.15) {
        this.state = "stalk";
        this.stateT = 0;
      }
      this._animate(dt, ctx, 0);
      this._aura(dt);
      if (this.actor) this.actor.update(dt, ctx.camera);
      return;
    }

    /* ------------------------------------------------ attack picks */
    const player = ctx.player;
    const pd = player ? Math.sqrt(
      (player.pos.x - this.pos.x) * (player.pos.x - this.pos.x) +
      (player.pos.z - this.pos.z) * (player.pos.z - this.pos.z)
    ) : 999;

    this.throwT -= dt;
    this.swipeT -= dt;

    if (pd < TUNE.swipeRange && this.swipeT <= 0 && !this.windKind) {
      this.windKind = "swipe";
      this.wind = 0.45;
      this.swipeT = TUNE.swipeEvery;
      if (this.actor) this.actor.oneShot("atk2", 0.5);
      if (window.Audio2) Audio2.sfx("swing");
    } else if (this.throwT <= 0 && !this.windKind) {
      this.windKind = "throw";
      this.wind = 0.7;
      this.throwT = TUNE.throwEvery;
    }

    /* wind-up: the demon telegraphs everything */
    if (this.windKind) {
      this.wind -= dt;
      const chest = new THREE.Vector3(this.pos.x, this.height * 0.7, this.pos.z);
      if (this.windKind === "throw") {
        FireFX.treeFlame(this.pos.x, this.height * 0.55, this.pos.z, 1.6, dt);
        if (Math.random() < dt * 20) FireFX.splash(chest, 2, 4);
      }
      if (this.wind <= 0) {
        if (this.windKind === "swipe") this._doSwipe(ctx);
        else this._doThrow(ctx);
        this.windKind = null;
      }
    }

    /* ------------------------------------------------ movement */
    this._pickTarget(dt, ctx, pd);
    const walking = !this.windKind;
    this._faceAndStep(dt, ctx, walking ? this.speed : 0);

    /* ------------------------------------------------ ignite */
    this.igniteT -= dt;
    const rate = TUNE.igniteEvery / (this.phase === 3 ? 1.7 : this.phase === 2 ? 1.3 : 1);
    if (this.igniteT <= 0) {
      this.igniteT = rate;
      const forest = ctx.forest;
      if (forest) {
        const near = forest.igniteNear(this.pos.x, this.pos.z, TUNE.igniteRadius, 0.4, 2);
        if (!near) {
          /* nothing left underfoot — torch the nearest healthy patch instead */
          const t = forest.healthySpot(this.pos.x, this.pos.z);
          if (t) {
            forest.ignite(t, 0.5);
            FireFX.burst(new THREE.Vector3(t.x, t.h * 0.6, t.z), 0xff8a2c, 10, { speed: 9, life: 0.7, size: 1.6 });
          }
        }
      }
    }

    this._aura(dt);
    this._animate(dt, ctx, walking ? this.speed : 0);
  };

  Boss.prototype._pickTarget = function (dt, ctx, pd) {
    this.targetT -= dt;
    if (this.target && this.target.state !== "alive") this.target = null;
    if (this.targetT > 0 && this.target) return;

    const forest = ctx.forest;
    if (pd < 26) {
      this.targetT = 2.2;
      return; /* stay on the player, no need to wander */
    }
    if (!forest) return;
    this.target = forest.healthySpot(this.pos.x, this.pos.z);
    this.targetT = rand(2.6, 4.2);
  };

  Boss.prototype._faceAndStep = function (dt, ctx, speed) {
    let tx = null, tz = null;
    if (this.target) { tx = this.target.x; tz = this.target.z; }
    else if (ctx.player) { tx = ctx.player.pos.x; tz = ctx.player.pos.z; }

    if (speed > 0 && tx !== null) {
      const dx = tx - this.pos.x, dz = tz - this.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 4) {
        const nx = dx / d, nz = dz / d;
        this.pos.x += nx * speed * dt;
        this.pos.z += nz * speed * dt;
        this.yaw = Math.atan2(nx, nz);
      }
    }
    /* always look at the player when he is in reach */
    if (ctx.player) {
      const dx = ctx.player.pos.x - this.pos.x, dz = ctx.player.pos.z - this.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 24) this.yaw = Math.atan2(dx, dz);
    }
    this.group.position.set(this.pos.x, this.group.position.y, this.pos.z);
    if (this.shadow) this.shadow.position.set(this.pos.x, 0.05, this.pos.z);

    /* shove the player out of the furnace */
    const p = ctx.player;
    if (p && !p.dead) {
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const minD = this.radius + 1.8;
      if (d < minD && d > 0.001) {
        p.pos.x = this.pos.x + (dx / d) * minD;
        p.pos.z = this.pos.z + (dz / d) * minD;
      }
    }
  };

  Boss.prototype._animate = function (dt, ctx, speed) {
    if (!this.actor) {
      this.group.rotation.y = this.yaw;
      return;
    }
    this.actor.yaw = this.yaw;
    this.actor.group.position.set(this.pos.x, this.actor.group.position.y, this.pos.z);
    this.actor.setState({ speed: speed * 1.4, grounded: true });
    this.actor.update(dt, ctx.camera);
  };

  Boss.prototype._doSwipe = function (ctx) {
    const p = ctx.player;
    const hitPos = new THREE.Vector3(this.pos.x, 4, this.pos.z);
    FX.arc(hitPos, this.yaw, 15, {
      vertical: true, color: 0xff8a3a, life: 0.26, span: Math.PI * 1.2, rot: -Math.PI / 2
    });
    FX.shock(new THREE.Vector3(this.pos.x, 1, this.pos.z), 0xff6a2b, 13, 0.3);
    FX.shake(0.22);
    if (window.Audio2) Audio2.sfx("heavy");
    if (p && !p.dead) {
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < TUNE.swipeRange + 4) {
        const dot = (dx / (d || 1)) * Math.sin(this.yaw) + (dz / (d || 1)) * Math.cos(this.yaw);
        if (dot > 0.1) p.damage(TUNE.swipeDamage, this.pos);
      }
    }
    /* the swipe also throws sparks into the nearest tree */
    if (ctx.forest) {
      const t = ctx.forest.nearestTree(this.pos.x + Math.sin(this.yaw) * 9, this.pos.z + Math.cos(this.yaw) * 9,
        function (o) { return o.state === "alive"; }, 12);
      if (t && Math.random() < 0.7) ctx.forest.ignite(t, 0.42);
    }
  };

  Boss.prototype._doThrow = function (ctx) {
    const p = ctx.player;
    if (p && !p.dead) {
      /* lead the target a little so strafing is not a free dodge */
      const spot = p.pos.clone();
      spot.x += p.vel.x * 0.35;
      spot.z += p.vel.z * 0.35;
      this._throwAt(spot, "player");
      return;
    }
    const forest = ctx.forest;
    const t = forest && forest.healthySpot(this.pos.x, this.pos.z);
    if (t) this._throwAt(new THREE.Vector3(t.x, t.h * 0.5, t.z), "tree");
  };

  Boss.prototype._updateFireballs = function (dt, ctx) {
    for (let i = 0; i < this.fireballs.length; i++) {
      const f = this.fireballs[i];
      if (f.dead) continue;
      f.life -= dt;
      f.vel.y -= 22 * dt;
      f.pos.addScaledVector(f.vel, dt);
      f.mesh.position.copy(f.pos);
      f.mesh.rotation.x += dt * 8;
      f.mesh.rotation.y += dt * 6;
      FireFX.treeFlame(f.pos.x, f.pos.y, f.pos.z, 0.75, dt);
      FireFX.smokePuff(f.pos.x, f.pos.y, f.pos.z, 1.6, dt);

      /* player hit */
      const p = ctx.player;
      if (p && !p.dead) {
        const dx = p.pos.x - f.pos.x, dz = p.pos.z - f.pos.z;
        const dy = p.pos.y + p.height * 0.45 - f.pos.y;
        if (dx * dx + dz * dz < (f.radius + 2.2) * (f.radius + 2.2) && Math.abs(dy) < p.height) {
          p.damage(TUNE.fireballDamage, f.pos);
          this._explodeBall(f, ctx);
          continue;
        }
      }
      if (f.pos.y <= 1.2 || f.life <= 0) {
        this._explodeBall(f, ctx);
      }
    }
  };

  Boss.prototype._explodeBall = function (f, ctx) {
    f.dead = true;
    f.mesh.visible = false;
    const at = f.pos.clone();
    at.y = Math.max(1, at.y);
    FX.explodeAt(at, 1.5);
    FX.shake(0.3);
    FX.ring(new THREE.Vector3(at.x, 0.4, at.z), 0xff6a2b, 9, 0.4);
    if (ctx.forest) {
      ctx.forest.igniteNear(at.x, at.z, 10, 0.5, 2);
    }
    if (window.Audio2) Audio2.sfx("explode");
  };

  Boss.prototype._roar = function (phase, ctx) {
    this.phase = phase;
    this.state = "roar";
    this.stateT = 0;
    this.windKind = null;
    if (this.actor) this.actor.oneShot("atk1", 1.0);
    if (window.Audio2) Audio2.sfx("roar");
    FX.shake(0.9);
    FX.flash(0.18, 0xff6a1f);
    FX.shock(new THREE.Vector3(this.pos.x, 2, this.pos.z), 0xff7a2c, 26, 0.7);
    if (ctx.forest) {
      ctx.forest.igniteNear(this.pos.x, this.pos.z, 26, 0.55, phase === 3 ? 4 : 3);
      const t = ctx.forest.healthySpot(this.pos.x, this.pos.z);
      if (t) ctx.forest.ignite(t, 0.4);
    }
    if (this.onEvent) this.onEvent("bossPhase", phase);
    this.throwT = 1.4;
    this.swipeT = 1.8;
  };

  Boss.prototype._aura = function (dt) {
    const p = this.pos;
    FireFX.treeFlame(p.x, 2.2, p.z, 0.9, dt * 0.8);
    FireFX.groundFlame(p.x, p.z, this.radius * 0.8, dt * 0.7);
    if (Math.random() < dt * 16) {
      FireFX.smokePuff(p.x + rand(-3, 3), 4, p.z + rand(-3, 3), 7, 1);
    }
  };

  Boss.prototype.dispose = function () {
    this.cleanup();
    this.gone = true;
    if (this.shadow) this.scene.remove(this.shadow);
    if (this.group) this.scene.remove(this.group);
    if (this.light) this.scene.remove(this.light);
    if (this.eyes) this.scene.remove(this.eyes);
    if (this.smog) this.smog.visible = false;
  };

  Boss.prototype.cleanup = function () {
    this.fireballs.forEach(function (f) {
      f.dead = true;
      f.mesh.visible = false;
    });
  };

  Boss.TUNE = TUNE;
  window.Boss = Boss;
})();
