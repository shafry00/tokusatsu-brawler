/* ============================================================
   player.js — Ultraman player controller
   ============================================================ */
(function () {
  const SPEED = 10.5, RUN = 16.5, FLY_SPEED = 22;
  const GRAV = 40, JUMP_V = 16.5, DBL_V = 14;
  const P = new THREE.Vector3();

  function lerp(a, b, t) { return a + (b - a) * t; }

  function Player(spawn) {
    this.h = 4.4;
    // rigged 3D model when available, otherwise the 2.5D sprite billboard
    this.actor = (window.Models && Models.create("player", { height: this.h, turn: 30 })) ||
                 new Actor("hero_ultraman", { height: this.h });
    this.actor.setPos(spawn.x, 0, spawn.z);
    // hitbox comes from the model actually standing there, not a guess
    this.radius = this.actor.radius || 1.65;
    this.headY = this.h * 0.72;

    this.pos = this.actor.pos();
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.grounded = true;
    this.flying = false;
    this.jumps = 0;

    this.maxHp = 200; this.hp = 200;
    this.maxEn = 100; this.en = 100;

    this.dashCd = 0; this.dashT = 0;
    this.attack = null;
    this.combo = 0; this.comboTimer = 0; this.chainStep = 0; this.chainTimer = 0;
    this.invuln = 0;
    this.hurtT = 0;
    this.dead = false;

    this.lockOn = null;
    this.beamCd = 0; this.slashCd = 0;
    this.beam = null;      // active beam {t, to}
    this.chargeT = 0;

    this.finisher = null;  // {t, target}
    this.A = { sx: 1, sy: 1, slide: 0, tilt: 0 };   // smoothed anim
    this.imp = { slide: 0, sy: 0, tilt: 0 };        // impulses
    this.footT = 0;

    this.upgrades = { dmg: 0, speed: 0, energy: 0, hp: 0, regen: 0 };
    this.stats = { hits: 0, maxCombo: 0, kills: 0, dmgTaken: 0, time: 0 };
  }

  Player.prototype.worldPos = function () { return this.pos; };

  Player.prototype.hitPoint = function () {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.h * 0.6, this.pos.z);
  };

  /* Where an attack should point.
     Lock-on wins. Otherwise a nearby enemy we are roughly facing —
     within reach of the punch — is picked so attacks do not sail past
     the target we are visually squared up against. Standing still with
     nothing in range means "straight ahead of the camera".
     Returns null when the player is running with nothing worth aiming
     at, so the movement heading is kept.                                */
  Player.prototype.aimYaw = function () {
    if (this.lockOn && !this.lockOn.dead) {
      return Math.atan2(this.lockOn.pos.x - this.pos.x, this.lockOn.pos.z - this.pos.z);
    }
    const cam = Game.camYaw;
    const list = Game.enemies;
    let best = null, bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 12 + e.radius * 2 || d < 0.001) continue;
      const dot = (dx / d) * Math.sin(cam) + (dz / d) * Math.cos(cam);
      if (dot < 0.30) continue;                 // not in front of the camera
      if (d < bestD) { bestD = d; best = Math.atan2(dx, dz); }
    }
    if (best !== null) return best;
    if (Math.hypot(this.vel.x, this.vel.z) < 3.0) return cam;
    return null;
  };

  Player.prototype.faceAim = function () {
    const y = this.aimYaw();
    if (y !== null && y !== undefined) this.yaw = y;
  };

  /* ---------- damage intake ---------- */
  Player.prototype.takeDamage = function (dmg, from) {
    if (this.dead) return;
    if (this.invuln > 0 || this.dashT > 0) { return; }
    let d = dmg;
    if (Game.ultraExpired) d *= 2;
    this.hp -= d;
    this.stats.dmgTaken += d;
    this.invuln = 0.55;
    this.hurtT = 0.28;
    FX.damage(this.hitPoint(), d, "player");
    FX.flash(0.22, "#ff3b4d");
    FX.shake(0.55);
    FX.hitstop(60);
    Audio2.sfx("hurt");
    this.imp.tilt = -0.28; this.imp.sy = -0.14;
    // knockback
    if (from) {
      const dx = this.pos.x - from.x, dz = this.pos.z - from.z;
      const l = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / l) * 12; this.vel.z += (dz / l) * 12;
    }
    this.actor.hitFlash(1);
    if (this.actor.oneShot) this.actor.oneShot("hit", 0.45);
    Game.breakCombo();
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  };

  Player.prototype.heal = function (v) {
    this.hp = Math.min(this.maxHp, this.hp + v);
    FX.damage(this.hitPoint(), v, "heal");
    Audio2.sfx("heart");
  };
  Player.prototype.gainEnergy = function (v) {
    this.en = Math.min(this.maxEn, this.en + v);
  };

  Player.prototype.die = function () {
    this.dead = true;
    this.actor.dead = true;
    if (this.actor.oneShot) this.actor.oneShot("death", 2.6);
    this.vel.set(0, 0, 0);
    FX.burst(this.hitPoint(), 0xffd24a, 40, { speed: 16, life: 1.2 });
    Audio2.sfx("lose");
    Game.onPlayerDead();
  };

  /* ---------- attack helpers ---------- */
  function coneHit(origin, yaw, range, arcCos, cb) {
    const list = Game.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead) continue;
      const dx = e.pos.x - origin.x, dz = e.pos.z - origin.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range + e.radius) continue;
      if (Math.abs(e.pos.y - origin.y) > 8) continue;
      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      const dot = nx * Math.sin(yaw) + nz * Math.cos(yaw);
      if (dot < arcCos && dist > e.radius) continue;
      cb(e, dist);
    }
  }
  Player.prototype.coneHit = coneHit;

  const LIGHT = [
    { dmg: 26, wind: 0.09, act: 0.10, rec: 0.13, range: 6.6, arc: 0.15, lunge: 9, kb: 5 },
    { dmg: 30, wind: 0.08, act: 0.10, rec: 0.13, range: 6.8, arc: 0.10, lunge: 10, kb: 6 },
    { dmg: 44, wind: 0.12, act: 0.13, rec: 0.30, range: 7.6, arc: 0.0, lunge: 13, kb: 15, heavyKb: true },
  ];
  const HEAVY = { dmg: 88, wind: 0.30, act: 0.16, rec: 0.36, range: 8.2, arc: 0.0, lunge: 14, kb: 26, heavyKb: true, guardBreak: true };

  Player.prototype.startLight = function () {
    if (this.attack && this.attack.type === "light" && this.attack.phase !== "rec") return;
    const step = this.chainTimer > 0 ? Math.min(2, this.chainStep) : 0;
    const d = LIGHT[step];
    this.faceAim();
    this.attack = { type: "light", step: step, d: d, t: 0, phase: "wind", hit: false };
    this.chainStep = (step + 1) % 3;
    this.chainTimer = 0.75;
    this.actor.oneShot("atk1", d.wind + d.act + d.rec + 0.10);
    Audio2.sfx("swing");
  };
  Player.prototype.startHeavy = function () {
    if (this.attack) return;
    this.faceAim();
    this.attack = { type: "heavy", d: HEAVY, t: 0, phase: "wind", hit: false };
    this.actor.oneShot("atk2", HEAVY.wind + HEAVY.act + HEAVY.rec);
    Audio2.sfx("charge");
  };

  Player.prototype.startBeam = function () {
    if (this.beam || this.attack || this.en < 40 || this.beamCd > 0) { if (this.en < 40) Game.toastHint("Not enough energy"); return; }
    this.en -= 40;
    this.faceAim();
    this.attack = { type: "beam", t: 0, phase: "wind", dur: 0.34 };
    this.actor.oneShot("beam", 0.9);
    Audio2.sfx("charge");
  };

  Player.prototype.startSlash = function () {
    if (this.en < 25 || this.slashCd > 0 || this.attack) return;
    this.en -= 25; this.slashCd = 1.1;
    this.faceAim();
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const from = this.hitPoint().add(dir.clone().multiplyScalar(2));
    Game.spawnRing(from, dir, this.yaw);
    this.actor.oneShot("atk2", 0.8);
    Audio2.sfx("slash");
    this.imp.slide = 5;
  };

  Player.prototype.dash = function (dirX, dirZ) {
    if (this.dashCd > 0) return;
    this.dashCd = 1.0; this.dashT = 0.22;
    let dx = dirX, dz = dirZ;
    if (dx || dz) {
      // the stick is camera-relative, exactly like walking (right = (-fz, fx))
      const camYaw = Game.camYaw, fx = Math.sin(camYaw), fz = Math.cos(camYaw);
      const wx = fx * dz - fz * dx, wz = fz * dz + fx * dx;
      const l2 = Math.hypot(wx, wz) || 1;
      dx = wx / l2; dz = wz / l2;
    } else {
      const y = this.aimYaw();
      const yaw = (y === null || y === undefined) ? this.yaw : y;
      dx = Math.sin(yaw); dz = Math.cos(yaw);
    }
    const l = Math.hypot(dx, dz) || 1;
    this.vel.x = (dx / l) * 38; this.vel.z = (dz / l) * 38;
    this.yaw = Math.atan2(dx / l, dz / l);
    Audio2.sfx("dash");
    FX.burst(new THREE.Vector3(this.pos.x, this.pos.y + 1, this.pos.z), 0x9fe8ff, 14, { speed: 8, life: 0.4, grav: 6 });
    Game.setHint("");
  };

  /* ---------- main update ---------- */
  Player.prototype.update = function (dt, input, camera) {
    dt = Math.min(dt, 0.05);
    const a = this.actor;
    this.stats.time += dt;

    if (this.dead) { a.update(dt, camera); return; }

    this.invuln = Math.max(0, this.invuln - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.dashT = Math.max(0, this.dashT - dt);
    this.beamCd = Math.max(0, this.beamCd - dt);
    this.slashCd = Math.max(0, this.slashCd - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.chainTimer = Math.max(0, this.chainTimer - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer <= 0 && this.combo > 0) { this.combo = 0; Game.updateCombo(); }

    // passive energy + regen upgrade
    this.en = Math.min(this.maxEn, this.en + dt * (2.5 + this.upgrades.energy * 1.6));
    if (this.upgrades.regen) this.hp = Math.min(this.maxHp, this.hp + dt * this.upgrades.regen);

    /* ---------- finisher cinematic ---------- */
    if (this.finisher) {
      this.updateFinisher(dt);
      a.update(dt, camera);
      return;
    }

    /* ---------- attack state machine ---------- */
    const busy = !!this.attack;
    if (this.attack) this.updateAttack(dt, input);

    /* ---------- movement ---------- */
    const mx = input.mx, mz = input.mz;
    const moving = (mx !== 0 || mz !== 0);
    let speed = (input.run ? RUN : SPEED) + this.upgrades.speed * 1.6;

    if (!busy && this.dashT <= 0) {
      // camera-relative movement.  The camera sits at
      // target - (sin yaw, cos yaw) * horiz and looks back at the target, so
      // its forward is (fx, fz) = (sin yaw, cos yaw) and its RIGHT is
      // forward x up = (-fz, fx).  World heading = forward*mz + right*mx;
      // using (fz, -fx) here instead would silently swap A and D.
      const camYaw = Game.camYaw;
      const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
      let wx = fx * mz - fz * mx;
      let wz = fz * mz + fx * mx;
      const l = Math.hypot(wx, wz);
      if (l > 0.001) {
        wx /= l; wz /= l;
        this.vel.x = lerp(this.vel.x, wx * speed, 1 - Math.pow(0.0015, dt));
        this.vel.z = lerp(this.vel.z, wz * speed, 1 - Math.pow(0.0015, dt));
        if (!this.lockOn) this.yaw = Math.atan2(wx, wz);
      } else {
        this.vel.x = lerp(this.vel.x, 0, 1 - Math.pow(0.00002, dt));
        this.vel.z = lerp(this.vel.z, 0, 1 - Math.pow(0.00002, dt));
      }
    } else if (this.dashT > 0) {
      this.vel.x *= Math.pow(0.02, dt); this.vel.z *= Math.pow(0.02, dt);
    } else {
      this.vel.x *= Math.pow(0.05, dt); this.vel.z *= Math.pow(0.05, dt);
    }

    // face lock-on target
    if (this.lockOn && !this.lockOn.dead) {
      const dx = this.lockOn.pos.x - this.pos.x, dz = this.lockOn.pos.z - this.pos.z;
      this.yaw = Math.atan2(dx, dz);
    }

    /* ---------- vertical ---------- */
    if (input.fly && !this.grounded && this.en > 2 && !busy) {
      this.flying = true;
    }
    if (this.grounded) this.flying = false;

    if (this.flying) {
      /* Hold Space to climb, hold Shift/Ctrl to dive, let go and the
         giant sinks on its own — so releasing the key actually brings
         you down instead of drifting upward forever.                  */
      const targetY = input.descend ? -13 : (input.jump ? 9 : -5.0);
      this.vel.y = lerp(this.vel.y, targetY, 1 - Math.pow(0.006, dt));
      this.en -= dt * (7 - this.upgrades.energy * 0.8);
      if (this.en <= 0) { this.en = 0; this.flying = false; }
    } else {
      this.vel.y -= GRAV * dt;
    }

    if (input.jumpPressed && !busy) {
      if (this.grounded) { this.vel.y = JUMP_V; this.grounded = false; this.jumps = 1; a.oneShot("jump", 0.7); Audio2.sfx("jump"); }
      else if (this.jumps === 1) { this.vel.y = DBL_V; this.jumps = 2; this.flying = false; Audio2.sfx("jump");
        FX.ring(new THREE.Vector3(this.pos.x, this.pos.y + 0.1, this.pos.z), 0x9fe8ff, 5, 0.4); }
      else if (this.en > 12) { this.vel.y = 13; this.en -= 12; this.flying = true; Audio2.sfx("dash"); }
    }
    if (input.jumpReleased && this.flying) { /* glide */ }

    // integrate
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    // ground collide
    if (this.pos.y <= 0) {
      if (!this.grounded && this.vel.y < -6) {
        Audio2.sfx("land");
        FX.ring(new THREE.Vector3(this.pos.x, 0.06, this.pos.z), 0xdff0ff, 6 + Math.abs(this.vel.y) * 0.2, 0.4);
        FX.burst(new THREE.Vector3(this.pos.x, 0.4, this.pos.z), 0xcfd8e6, 8, { speed: 7, life: 0.4, grav: 30 });
        FX.shake(Math.min(0.4, Math.abs(this.vel.y) * 0.012));
      }
      this.pos.y = 0; this.vel.y = 0; this.grounded = true; this.jumps = 0;
    } else this.grounded = false;

    // arena bounds
    const R = Game.stage.arenaRadius - 2;
    const d = Math.hypot(this.pos.x, this.pos.z);
    if (d > R) { this.pos.x *= R / d; this.pos.z *= R / d; }

    // solid props (towers, pillars, walls) push the player out
    if (Game.stage.solids && Game.stage.solids.length) World.collide(Game.stage, this.pos, this.radius);

    // hazards
    for (let i = 0; i < Game.stage.hazards.length; i++) {
      const hz = Game.stage.hazards[i];
      if (this.pos.y < 1.2 && Math.hypot(this.pos.x - hz.x, this.pos.z - hz.z) < hz.radius) {
        this.takeDamage(hz.dps * dt, null);
        if (Math.random() < 0.25) FX.spark(new THREE.Vector3(this.pos.x, 0.5, this.pos.z), { color: 0xff7a2a, grav: -6, life: 0.6, size: 0.3 });
      }
    }

    /* ---------- animation ---------- */
    const sp = Math.hypot(this.vel.x, this.vel.z);
    a.setState({ speed: sp, grounded: this.grounded });
    const A = this.A;
    let t = { sx: 1, sy: 1, slide: 0, tilt: 0 };
    if (!this.grounded && !this.flying) { t.sy = 1.10; t.sx = 0.94; t.tilt = Math.max(-0.25, Math.min(0.25, -this.vel.y * 0.012)); }
    else if (this.flying) { t.sy = 1.06; t.tilt = 0.30; }
    else if (sp > 1) { t.tilt = 0.10 + Math.min(0.14, sp * 0.006); t.sy = 1; }
    else { t.sy = 1 + Math.sin(this.stats.time * 1.6) * 0.012; }
    if (this.hurtT > 0) { t.tilt = -0.35; t.sy = 0.9; }
    A.sx = lerp(A.sx, t.sx, 1 - Math.pow(0.001, dt));
    A.sy = lerp(A.sy, t.sy, 1 - Math.pow(0.001, dt));
    A.tilt = lerp(A.tilt, t.tilt, 1 - Math.pow(0.002, dt));
    A.slide = lerp(A.slide, t.slide + this.imp.slide, 1 - Math.pow(0.001, dt));
    // impulses decay
    this.imp.slide *= Math.pow(0.001, dt);
    this.imp.sy *= Math.pow(0.0005, dt);
    this.imp.tilt *= Math.pow(0.0005, dt);

    a.bobAmp = this.grounded ? Math.min(0.16, sp * 0.012) : 0;
    a.bobRate = 5 + sp * 0.55;
    a.yaw = this.yaw;
    a.A.sx = A.sx; a.A.sy = A.sy; a.A.slide = A.slide; a.A.tilt = A.tilt;

    // footsteps
    if (this.grounded && sp > 4) {
      this.footT -= dt * sp;
      if (this.footT <= 0) {
        this.footT = 14;
        FX.spark(new THREE.Vector3(this.pos.x, 0.15, this.pos.z), { color: 0xc8d4e0, grav: 10, life: 0.3, size: 0.16, vel: new THREE.Vector3(rnd(-2, 2), 2, rnd(-2, 2)) });
      }
    }

    a.update(dt, camera);
  };

  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* ---------- attack state machine ---------- */
  Player.prototype.updateAttack = function (dt, input) {
    const at = this.attack;
    at.t += dt;
    const d = at.d;

    if (at.type === "beam") {
      const muzzle = () => this.hitPoint().add(
        new THREE.Vector3(Math.sin(this.yaw) * 1.5, 0.45, Math.cos(this.yaw) * 1.5));

      if (at.phase === "wind") {
        // the ray is gathering: pull energy into the crossed arms
        this.chargeT += dt;
        if (this.chargeT > 0.05) {
          this.chargeT = 0;
          const c = muzzle();
          FX.gather(c, 0x9fe8ff, 6, 3.4, 0.3);
          FX.spark(c, { color: 0xeaffff, grav: 0, life: 0.22, size: 0.55, vel: new THREE.Vector3() });
        }
        if (at.t >= at.dur) {
          at.phase = "fire"; at.t = 0;
          const dir = new THREE.Vector3(Math.sin(this.yaw), 0.02, Math.cos(this.yaw));
          if (this.lockOn && !this.lockOn.dead) {
            dir.set(this.lockOn.pos.x - this.pos.x, (this.lockOn.pos.y + this.lockOn.h * 0.6) - this.hitPoint().y, this.lockOn.pos.z - this.pos.z).normalize();
          }
          const from = this.hitPoint().add(dir.clone().multiplyScalar(2.2));
          this.beam = { t: 0, dur: 0.55, dir: dir, from: from, tick: 0 };
          this.beamVisT = 0;
          Audio2.sfx("beam");
          FX.flash(0.3, "#bfeaff");
          FX.shake(0.6);
          FX.shock(from, 0x9fe8ff, 6, 0.4);
          FX.ring(from, 0xdff4ff, 7, 0.32, { quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir) });
          FX.arc(new THREE.Vector3(this.pos.x, this.pos.y + 0.15, this.pos.z), this.yaw, 7, { color: 0x9fe8ff, span: Math.PI * 2, life: 0.35 });
        }
      } else if (at.phase === "fire") {
        this.imp.slide = 4; this.imp.tilt = 0.1;
        const b = this.beam;
        b.t += dt;
        // damage along ray
        const maxLen = 95;

        /* ---- the visible Specium ray ---- */
        this.beamVisT = (this.beamVisT || 0) - dt;
        if (this.beamVisT <= 0) {
          this.beamVisT = 0.055;
          const end = b.from.clone().addScaledVector(b.dir, maxLen);
          const fade = Math.min(1, b.t / 0.08) * Math.min(1, (b.dur - b.t) / 0.12 + 0.25);
          FX.beam(b.from, end, {
            color: 0xf2ffff, glow: 0x35c8ff, radius: 2.1 * fade, taper: 1.5, life: 0.17,
          });
          FX.spark(b.from, { color: 0xdff4ff, grav: 0, life: 0.18, size: 1.5, vel: new THREE.Vector3() });
        }
        if (Math.random() < 0.5) {
          FX.spark(b.from.clone().addScaledVector(b.dir, 1.2), {
            color: 0x9fe8ff, grav: 0, drag: 0.9, life: 0.3, size: 0.3,
            vel: b.dir.clone().multiplyScalar(12 + Math.random() * 8),
          });
        }

        const list = Game.enemies;
        for (let i = 0; i < list.length; i++) {
          const e = list[i]; if (e.dead) continue;
          const proj = P.copy(e.pos).sub(b.from);
          const along = proj.dot(b.dir);
          if (along < 0 || along > maxLen) continue;
          const closest = b.from.clone().add(b.dir.clone().multiplyScalar(along));
          const dist = closest.distanceTo(new THREE.Vector3(e.pos.x, e.pos.y + e.h * 0.5, e.pos.z));
          if (dist < e.radius + 2.4) {
            e.takeDamage(140 * dt, { knock: 0.2 });
            if (Math.random() < 0.5) FX.impact(closest, 0xbfeaff, 0.8 + Math.random() * 0.4);
          }
        }
        // beam vs props
        Game.beamProps(b.from, b.dir, maxLen, 300 * dt, 1.6);
        if (b.t >= b.dur) { this.attack = null; this.beam = null; this.beamCd = 0.55; }
      }
      return;
    }

    if (at.phase === "wind") {
      this.imp.slide = -2.5;
      if (at.t >= d.wind) { at.phase = "act"; at.t = 0; at.hit = false;
        if (at.type === "heavy") { Audio2.sfx("heavy"); FX.shock(new THREE.Vector3(this.pos.x, this.pos.y + 1.6, this.pos.z), 0xffd24a, 3.5, 0.3); }
      }
      return;
    }
    if (at.phase === "act") {
      if (!at.hit) {
        at.hit = true;
        this.imp.slide = d.lunge; this.imp.tilt = 0.22;
        const origin = new THREE.Vector3(this.pos.x, this.pos.y, this.pos.z);
        /* visible swipe even when nothing is in reach */
        const heavy = at.type === "heavy";
        const chest = new THREE.Vector3(this.pos.x, this.pos.y + this.h * 0.55, this.pos.z);
        FX.arc(chest, this.yaw, heavy ? 6.8 : 5.4, {
          color: heavy ? 0xffd24a : 0xdff4ff,
          span: heavy ? Math.PI * 1.05 : Math.PI * 0.95,
          inner: 0.72,
          rot: -0.3,
          life: heavy ? 0.32 : 0.2,
          spin: heavy ? -2.0 : -3.4,
          opacity: heavy ? 0.9 : 0.75,
          vertical: true,
        });
        const tip = chest.clone().add(new THREE.Vector3(
          Math.sin(this.yaw) * d.range * 0.6, -0.2, Math.cos(this.yaw) * d.range * 0.6));
        FX.impact(tip, heavy ? 0xffd24a : 0xbfeaff, heavy ? 1.1 : 0.55);
        let hits = 0;
        const self = this;
        coneHit(origin, this.yaw, d.range, Math.cos(1.5 - d.arc), function (e, dist) {
          hits++;
          const dmg = d.dmg * (1 + self.upgrades.dmg * 0.12) * (1 + Math.min(0.5, self.combo * 0.02));
          const crit = Math.random() < 0.16;
          e.takeDamage(crit ? dmg * 1.7 : dmg, { knock: d.kb, from: self.pos, heavy: !!d.heavyKb, guardBreak: d.guardBreak });
          const hp = new THREE.Vector3(e.pos.x, e.pos.y + e.h * 0.55, e.pos.z);
          FX.burst(hp, 0xffffff, 8, { speed: 11, life: 0.4, grav: 14, color2: 0xffe08a });
          const dirv = new THREE.Vector3(e.pos.x - self.pos.x, 0, e.pos.z - self.pos.z).normalize();
          FX.ring(hp, 0xffffff, 2.4, 0.3, { quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirv) });
          self.registerHit(crit ? "crit" : "normal");
        });
        if (hits > 0) {
          FX.hitstop(at.type === "heavy" ? 130 : 70);
          FX.shake(at.type === "heavy" ? 0.9 : 0.35);
          Audio2.sfx(hits > 1 ? "hitCrit" : (at.type === "heavy" ? "heavy" : "punch"));
        } else {
          Audio2.sfx("swing");
        }
      }
      if (at.t >= d.act) { at.phase = "rec"; at.t = 0; }
      return;
    }
    // recovery
    if (at.t >= d.rec) this.attack = null;
  };

  Player.prototype.registerHit = function (kind) {
    this.combo++; this.comboTimer = 1.7;
    if (this.combo > this.stats.maxCombo) this.stats.maxCombo = this.combo;
    this.stats.hits++;
    this.gainEnergy(6 + (kind === "crit" ? 4 : 0));
    Game.updateCombo();
  };

  /* ---------- finisher ---------- */
  Player.prototype.startFinisher = function (target) {
    this.finisher = { t: 0, dur: 3.4, target: target, fired: false };
    Audio2.sfx("charge");
    FX.slowmo(0.35, 1.2);
    FX.flash(0.5, "#bfeaff");
    Game.setHint("");
  };

  Player.prototype.updateFinisher = function (dt) {
    const f = this.finisher; f.t += dt;
    const a = this.actor, tg = f.target;
    // face target, rise
    if (tg && !tg.dead) {
      const dx = tg.pos.x - this.pos.x, dz = tg.pos.z - this.pos.z;
      this.yaw = Math.atan2(dx, dz);
      this.vel.set(0, 0, 0);
      const wantY = Math.min(14, tg.pos.y + tg.h * 0.5);
      this.pos.y = lerp(this.pos.y, wantY, 1 - Math.pow(0.15, dt));
      const wantX = tg.pos.x - Math.sin(this.yaw) * 26, wantZ = tg.pos.z - Math.cos(this.yaw) * 26;
      this.pos.x = lerp(this.pos.x, wantX, 1 - Math.pow(0.2, dt));
      this.pos.z = lerp(this.pos.z, wantZ, 1 - Math.pow(0.2, dt));
    }
    a.yaw = this.yaw;
    a.bobAmp = 0;
    a._lockT = Math.max(a._lockT || 0, 0.25);   // hold the charge pose
    if (f.t < 1.5) { this.imp.tilt = 0.05; a.A.sy = 1 + Math.sin(f.t * 20) * 0.03; }
    else if (f.t < 1.85) {
      // thrust
      if (!f.fired) {
        f.fired = true;
        a.A.sx = 1.25; a.A.sy = 0.85; a.A.slide = 14;
        a.oneShot("beam", 3.0, 0.9);
        const dir = new THREE.Vector3(Math.sin(this.yaw), 0.02, Math.cos(this.yaw));
        if (tg) dir.set(tg.pos.x - this.pos.x, (tg.pos.y + tg.h * 0.5) - this.hitPoint().y, tg.pos.z - this.pos.z).normalize();
        const from = this.hitPoint().add(dir.clone().multiplyScalar(2.6));
        this.finBeam = { from: from, dir: dir, t: 0, dur: 1.5 };
        Audio2.sfx("beam");
        FX.flash(0.85, "#dff4ff");
        FX.shake(1.3);
        Game.setHint("");
      }
    } else if (f.t < 3.0) {
      const b = this.finBeam;
      if (b) {
        b.t += dt;
        const len = 100;
        /* the finisher ray needs to be seen, not just felt */
        this.finVisT = (this.finVisT || 0) - dt;
        if (this.finVisT <= 0) {
          this.finVisT = 0.05;
          FX.beam(b.from, b.from.clone().addScaledVector(b.dir, len), {
            color: 0xffffff, glow: 0x8fd8ff, radius: 2.3, taper: 1.4, life: 0.16,
          });
          FX.spark(b.from, { color: 0xdff4ff, grav: 0, life: 0.2, size: 2.4, vel: new THREE.Vector3() });
          FX.ring(b.from, 0xdff4ff, 9, 0.3, { quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.dir) });
        }
        const list = Game.enemies;
        for (let i = 0; i < list.length; i++) {
          const e = list[i]; if (e.dead) continue;
          if (e === f.target) continue;   // finisher target dies on the final beat
          const proj = P.copy(e.pos).sub(b.from);
          const along = proj.dot(b.dir);
          if (along < 0 || along > len) continue;
          const closest = b.from.clone().add(b.dir.clone().multiplyScalar(along));
          const dist = closest.distanceTo(new THREE.Vector3(e.pos.x, e.pos.y + e.h * 0.5, e.pos.z));
          if (dist < e.radius + 4.5) { e.takeDamage(420 * dt, { knock: 0.05 }); if (Math.random() < 0.6) FX.burst(closest, 0xdff4ff, 4, { speed: 16, life: 0.5, grav: 0 }); }
        }
        Game.beamProps(b.from, b.dir, len, 400 * dt, 2);
        // final beat: obliterate the target
        if (b.t >= 1.05 && !f.killed) {
          f.killed = true;
          if (tg && !tg.dead) {
            FX.flash(1.0, "#ffffff");
            FX.explodeAt(tg.mid(), 3.4);
            FX.slowmo(0.25, 1.6);
            tg.hp = 0; tg.finished = true; tg.staggered = false;
            tg.kill();
          }
        }
      }
    } else {
      this.finisher = null; this.finBeam = null; f.killed = false;
      this.imp.slide = 0;
      a.A.sx = 1; a.A.sy = 1; a.A.slide = 0;
      this.invuln = 1.0;
    }
  };

  window.Player = Player;
})();
