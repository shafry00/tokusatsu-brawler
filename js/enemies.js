/* ============================================================
   enemies.js — kaiju AI, attack patterns, bosses
   ============================================================ */
(function () {
  const E = {};
  const V = new THREE.Vector3();

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---------------- attack library ---------------- */
  const ATT = {
    swipe:  { range: 8.0, wind: 0.42, act: 0.16, rec: 0.52, dmg: 15, knock: 15, kind: "melee" },
    swipeH: { range: 9.5, wind: 0.50, act: 0.18, rec: 0.60, dmg: 24, knock: 20, kind: "melee" },
    slam:   { range: 13,  wind: 0.72, act: 0.24, rec: 0.85, dmg: 26, knock: 26, kind: "slam", aoe: 15 },
    charge: { range: 30,  wind: 0.55, act: 0.55, rec: 0.95, dmg: 22, knock: 30, kind: "charge" },
    bolt:   { range: 42,  wind: 0.50, act: 0.10, rec: 0.60, dmg: 14, kind: "proj", speed: 36, color: 0x6ad0ff },
    volley: { range: 50,  wind: 0.62, act: 0.55, rec: 0.85, dmg: 11, kind: "volley", count: 6, speed: 32, color: 0xff7a4a },
    beam:   { range: 60,  wind: 0.95, act: 0.75, rec: 1.05, dmg: 34, kind: "beam", color: 0xff5a6a },
    dive:   { range: 38,  wind: 0.45, act: 0.80, rec: 0.95, dmg: 22, knock: 24, kind: "dive" },
    clones: { range: 80,  wind: 0.85, act: 0.25, rec: 1.0, kind: "clones" },
    meteor: { range: 95,  wind: 1.10, act: 1.7, rec: 1.2, dmg: 24, kind: "meteor", count: 9 },
    whip:   { range: 34,  wind: 0.70, act: 0.45, rec: 0.80, dmg: 20, kind: "beam", color: 0x9fe0ff },
    shard:  { range: 46,  wind: 0.60, act: 0.45, rec: 0.8, dmg: 12, kind: "volley", count: 4, speed: 26, color: 0x8a5aff },
  };

  /* ---------------- species table ---------------- */
  const SPECIES = {
    kaiju_jamila:  { h: 3.0, hp: 78,  dmg: 1.0, speed: 6.2, radius: 1.5, attacks: ["swipe"], score: 120, weight: 1 },
    kaiju_bemular: { h: 3.2, hp: 140, dmg: 1.1, speed: 7.0, radius: 1.7, attacks: ["swipe", "charge"], score: 180, weight: 1.1 },
    kaiju_birdon:  { h: 3.4, hp: 106, dmg: 1.0, speed: 9.5, radius: 1.7, attacks: ["dive"], fly: true, score: 200, weight: 1 },
    kaiju_baltan:  { h: 3.3, hp: 92,  dmg: 1.0, speed: 6.4, radius: 1.6, attacks: ["bolt", "swipe"], ranged: true, score: 210, weight: 1 },
    kaiju_eleking: { h: 3.0, hp: 150, dmg: 1.1, speed: 5.4, radius: 1.8, attacks: ["whip", "swipe"], ranged: true, score: 240, weight: 1.1 },
    kaiju_golza:   { h: 3.4, hp: 250, dmg: 1.2, speed: 5.8, radius: 1.9, attacks: ["swipeH", "beam", "slam"], score: 300, weight: 1.3 },
    kaiju_kingjoe: { h: 3.4, hp: 280, dmg: 1.2, speed: 4.8, radius: 1.9, attacks: ["volley", "charge"], guard: true, ranged: true, score: 320, weight: 1.3 },
    kaiju_gomora:  { h: 3.4, hp: 300, dmg: 1.3, speed: 6.8, radius: 1.9, attacks: ["swipeH", "beam", "charge"], score: 340, weight: 1.4 },
    kaiju_redking: { h: 3.6, hp: 262, dmg: 1.25, speed: 5.6, radius: 2.0, attacks: ["swipeH", "slam", "charge"], score: 330, weight: 1.4 },
    kaiju_zetton:  { h: 3.8, hp: 420, dmg: 1.4, speed: 6.2, radius: 2.0, attacks: ["swipeH", "beam"], guard: true, score: 400, weight: 1.5 },
  };
  E.SPECIES = SPECIES;

  const BOSS_PATTERNS = {
    0: { attacks: ["swipe", "charge"], name: "BEMULAR", phases: 2 },
    1: { attacks: ["swipeH", "slam", "volley"], name: "RED KING", phases: 2 },
    2: { attacks: ["dive", "volley", "slam"], name: "BIRDON", phases: 2 },
    3: { attacks: ["clones", "volley", "swipe"], name: "ALIEN BALTAN", phases: 2 },
    4: { attacks: ["whip", "swipe", "bolt"], name: "ELEKING", phases: 3 },
    5: { attacks: ["beam", "swipeH", "slam"], name: "FIRE GOLZA", phases: 3 },
    6: { attacks: ["volley", "charge", "slam"], name: "KING JOE", phases: 3, guard: true },
    7: { attacks: ["beam", "charge", "slam", "shard"], name: "DARK GOMORA", phases: 3 },
    8: { attacks: ["meteor", "beam", "swipeH", "shard", "volley"], name: "ZETTON", phases: 3, guard: true, final: true },
  };

  /* ================= Enemy ================= */
  function Enemy(species, x, z, opts) {
    opts = opts || {};
    const sp = SPECIES[species] || SPECIES.kaiju_jamila;
    this.species = species;
    this.sp = sp;
    this.isBoss = !!opts.boss;
    this.bossStage = opts.bossStage !== undefined ? opts.bossStage : -1;

    let hpMul = opts.hpMul || 1;
    let h = sp.h * (this.isBoss ? (opts.scale || 2.3) : 1);
    this.h = h;
    this.radius = sp.radius * (this.isBoss ? 1.9 : 1);
    this.maxHp = sp.hp * hpMul * (this.isBoss ? 8.5 : 1);
    this.hp = this.maxHp;
    this.dmgMul = sp.dmg * (1 + Game.stageIndex * 0.11) * (this.isBoss ? 1.5 : 1);
    this.speed = sp.speed * (0.85 + Game.stageIndex * 0.035);
    this.scoreVal = sp.score * (this.isBoss ? 12 : 1);

    this.actor = (window.Models && Models.createKaiju(species, { height: h, turn: 13 })) ||
                 new Actor(species, { height: h });
    this.actor.setPos(x, 0, z);
    this.pos = this.actor.pos();
    this.vel = new THREE.Vector3();
    this.yaw = Math.atan2(-x, -z);

    this.state = "idle";
    this.stateT = 0;
    this.attackDef = null;
    this.attackName = null;
    this.cool = rnd(0.5, 1.6);
    this.dead = false;
    this.deadT = 0;
    this.staggered = false;
    this.finished = false;
    this.guard = !!sp.guard;
    this.guardT = 0;
    this.phase = 1;
    this.enraged = false;
    this.flying = !!sp.fly;
    this.baseY = 0;
    this.hoverY = sp.fly ? rnd(3, 7) : 0;
    this.sep = new THREE.Vector3();
    this.hitCd = 0;
    this.telegraphRing = null;
    this.contactT = 0;
    this.changeT = 0;
    this.texName = species;
    this.spawnT = 0.5;
    this.actor.hitFlash(0.6);

    if (this.isBoss) {
      const bp = BOSS_PATTERNS[this.bossStage] || BOSS_PATTERNS[0];
      this.patternAttacks = bp.attacks;
      this.bossName = bp.name;
      this.maxPhases = bp.phases;
      this.actor.setTint(0xffe8e8);
      this.emblem = true;
    }
  }

  Enemy.prototype.takeDamage = function (dmg, opts) {
    if (this.dead) return;
    if (this.staggered && this.isBoss) return;
    opts = opts || {};
    // guard
    if (this.guard && this.guardT <= 0 && !opts.guardBreak) {
      dmg *= 0.18;
      FX.burst(this.mid(), 0x9fd8ff, 5, { speed: 9, life: 0.3, grav: 6 });
      Audio2.sfx("block");
      const hp = this.mid();
      FX.damage(hp, dmg, "block");
      this.hp -= dmg;
      if (this.hp <= 0) { this.onZero(); if (this.hp <= 0 && (this.finished || !(this.staggered && this.isBoss))) this.kill(); }
      return;
    }
    if (opts.guardBreak) { this.guardT = 2.4; Audio2.sfx("hitCrit"); }

    const crit = opts.crit;
    this.hp -= dmg;
    this.actor.hitFlash(crit ? 1.3 : 0.9);
    if (!this.isBoss && (crit || Math.random() < 0.45)) this.animHit(!!crit);
    const hp = this.mid();
    FX.damage(hp, dmg, crit ? "crit" : "normal");

    // knockback
    if (opts.from && opts.knock) {
      const dx = this.pos.x - opts.from.x, dz = this.pos.z - opts.from.z;
      const l = Math.hypot(dx, dz) || 1;
      const k = opts.knock * (this.isBoss ? 0.16 : 1) / Math.max(1, this.maxHp / 140);
      this.vel.x += (dx / l) * k; this.vel.z += (dz / l) * k;
      this.actor.A.slide = k * 0.6;
      this.actor.A.tilt = -k * 0.02;
    }
    // stagger small enemies briefly
    if (!this.isBoss && !this.staggered && Math.random() < 0.14) {
      this.staggered = true; this.staggerT = 0.28;
    }
    if (this.hp <= 0) this.onZero();
    if (this.hp <= 0 && (this.finished || !(this.staggered && this.isBoss))) this.kill();
    Game.addScore(Math.round(dmg * 0.4 * (1 + Game.combo * 0.03)));
  };

  Enemy.prototype.mid = function () { return new THREE.Vector3(this.pos.x, this.pos.y + this.h * 0.55, this.pos.z); };

  Enemy.prototype.onZero = function () {
    if (this.hp > 0) { this.hp = 1; }
    if (this.isBoss && !this.finished) {
      // stagger + finisher window
      if (!this.staggerWait) {
        this.staggerWait = true;
        this.hp = 1;
        this.staggered = true; this.staggerT = 9.0;
        this.guard = false;
        this.animHit(true);
        Game.onBossStaggered(this);
        Audio2.sfx("roarBig");
        FX.slowmo(0.4, 0.9);
      }
      return;
    }
    this.hp = 0;
  };

  Enemy.prototype.kill = function () {
    if (this.dead) return;
    this.dead = true; this.deadT = 0;
    this.clearTelegraph();
    // play the model's death clip; game.js removes the corpse once deadT runs out
    if (this.actor.oneShot) this.actor.oneShot("death", 1.4);
    if (!this.actor.ok) this.actor.group.visible = false;
    this.actor.hitFlash(1.2);
    FX.explodeAt(this.mid(), this.isBoss ? 2.4 : 1);
    Game.addScore(this.scoreVal);
    Game.onEnemyKilled(this);
  };

  /* ---------------- AI ---------------- */
  Enemy.prototype.update = function (dt) {
    if (this.dead) {
      // let the death clip finish before game.js removes the corpse
      this.actor.A.tilt = lerp(this.actor.A.tilt, 0, 1 - Math.pow(0.1, dt));
      this.actor.update(dt, Game.camera);
      return;
    }
    const a = this.actor, p = Game.player;
    this.spawnT -= dt;
    if (this.spawnT > 0) { a.A.sy = 1.5; a.A.sx = 0.7; a.update(dt, Game.camera); return; }
    a.A.sy = lerp(a.A.sy, 1, 1 - Math.pow(0.01, dt));
    a.A.sx = lerp(a.A.sx, 1, 1 - Math.pow(0.01, dt));

    this.guardT = Math.max(0, this.guardT - dt);
    this.cool = Math.max(0, this.cool - dt);
    this.hitCd = Math.max(0, this.hitCd - dt);
    this.stateT += dt;

    if (this.staggered) {
      this.staggerT -= dt;
      this.clearTelegraph();
      a.A.tilt = lerp(a.A.tilt, -0.35, 0.2);
      a.A.sy = 0.9;
      if (this.isBoss && this.staggerWait) {
        // drain slowly; if player doesn't finish, boss recovers
        if (this.staggerT <= 0) {
          this.staggered = false; this.staggerWait = false;
          this.hp = this.maxHp * 0.18; this.guard = !!this.sp.guard && true;
          FX.shock(this.mid(), 0xff3a5a, 12, 0.6);
          Audio2.sfx("roar");
          Game.hideFinisher();
        }
      } else if (this.staggerT <= 0) {
        this.staggered = false;
      }
      a.update(dt, Game.camera);
      return;
    }
    a.A.tilt = lerp(a.A.tilt, 0, 1 - Math.pow(0.01, dt));

    if (p.dead) { this.idleAnim(dt); return; }

    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    // separation from other enemies
    this.sep.set(0, 0, 0);
    const list = Game.enemies;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === this || o.dead) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const od = Math.hypot(ox, oz);
      const minD = this.radius + o.radius + 1.2;
      if (od < minD && od > 0.01) {
        this.sep.x += (ox / od) * (minD - od);
        this.sep.z += (oz / od) * (minD - od);
      }
    }

    // face player
    this.yaw = Math.atan2(dx, dz);

    /* ---- state machine ---- */
    if (this.state === "idle" || this.state === "chase") {
      const wantRange = this.sp.ranged ? 22 : (this.radius + this.h * 0.9);
      const inRange = dist < (this.attackRange || 30) && this.cool <= 0;
      if (inRange && this.spawnT <= 0) {
        this.chooseAttack(dist);
      } else {
        this.state = "chase";
        // move toward (or strafe if ranged & too close)
        let mvx = dx / (dist || 1), mvz = dz / (dist || 1);
        if (this.sp.ranged && dist < wantRange * 0.7) { mvx = -mvx; mvz = -mvz; }
        else if (this.sp.ranged && dist < wantRange) { mvx = -mvz; mvz = mvx; }
        let sp = this.speed * (this.enraged ? 1.25 : 1);
        if (dist < wantRange) sp *= 0.35;
        const tvx = mvx * sp, tvz = mvz * sp;
        this.vel.x = lerp(this.vel.x, tvx, 1 - Math.pow(0.06, dt));
        this.vel.z = lerp(this.vel.z, tvz, 1 - Math.pow(0.06, dt));
        a.bobAmp = 0.12; a.bobRate = 5 + Math.hypot(this.vel.x, this.vel.z) * 0.4;
      }
    }

    if (this.state === "wind") {
      this.vel.x = lerp(this.vel.x, 0, 1 - Math.pow(0.05, dt));
      this.vel.z = lerp(this.vel.z, 0, 1 - Math.pow(0.05, dt));
      const wind = this.attackDef.wind || 0.5;
      const u = Math.min(1, this.stateT / wind);
      const k = 1 - u;
      // telegraph tint pulses
      const fl = (Math.sin(this.stateT * 26) > 0) ? 1 : 0.35;
      this.actor.setTint(new THREE.Color(1, 0.35 + 0.65 * k * fl, 0.3 + 0.7 * k * fl).getHex());
      if (this.telegraphRing) {
        this.telegraphRing.scale.setScalar(0.25 + 0.75 * (1 - Math.pow(1 - u, 2)));
        this.telegraphRing.material.opacity = 0.3 + 0.35 * fl;
      }
      if (this.telegraphFill) {
        this.telegraphFill.scale.setScalar(Math.max(0.02, 1 - u));
        this.telegraphFill.material.opacity = 0.05 + 0.22 * u;
      }
      if (this.telegraphWedge) this.telegraphWedge.material.opacity = 0.14 + 0.28 * u * fl;
      // spent energy rising off the monster while it charges
      this.telegraphEmberT -= dt;
      if (this.telegraphEmberT <= 0) {
        this.telegraphEmberT = 0.08;
        const rr = this.radius * (0.55 + Math.random() * 0.6);
        const aa = Math.random() * Math.PI * 2;
        FX.spark(new THREE.Vector3(this.pos.x + Math.cos(aa) * rr, 0.25, this.pos.z + Math.sin(aa) * rr), {
          color: this.attackDef.kind === "melee" || this.attackDef.kind === "slam" ? 0xff8a6a : 0xffd08a,
          grav: -5, life: 0.4 + Math.random() * 0.3, size: 0.14 + Math.random() * 0.1, drag: 1,
          vel: new THREE.Vector3(0, 3 + Math.random() * 4, 0),
        });
      }
      if (this.stateT >= wind) {
        this.actor.setTint(this.isBoss ? 0xffe8e8 : 0xffffff);
        FX.impact(new THREE.Vector3(this.pos.x, this.pos.y + this.h * 0.5, this.pos.z),
          this.attackDef.kind === "melee" ? 0xff8a6a : 0xffd08a, 0.9);
        this.clearTelegraph();
        this.state = "act"; this.stateT = 0; this.attackHit = false;
      }
      this.integrate(dt);
      this.idleAnim(dt);
      return;
    }

    if (this.state === "act") {
      this.executeAttack(dt, dx, dz, dist);
      this.integrate(dt);
      this.idleAnim(dt);
      return;
    }

    if (this.state === "rec") {
      this.vel.x = lerp(this.vel.x, 0, 1 - Math.pow(0.05, dt));
      this.vel.z = lerp(this.vel.z, 0, 1 - Math.pow(0.05, dt));
      if (this.stateT >= this.attackDef.rec) {
        this.state = "chase"; this.stateT = 0;
        this.cool = this.enraged ? rnd(0.25, 0.7) : rnd(0.6, 1.5);
      }
      this.integrate(dt);
      this.idleAnim(dt);
      return;
    }

    // flying hover
    if (this.flying) {
      this.pos.y = lerp(this.pos.y, this.hoverY + Math.sin(Game.time * 1.6 + this.pos.x) * 0.7, 1 - Math.pow(0.1, dt));
      a.bobAmp = 0; a.A.tilt = 0;
    }
    this.integrate(dt);
    this.idleAnim(dt);

    // contact damage while moving fast (charge)
    if (this.state === "chase" && this.isBoss) this.contactAttack(dist);
  };

  Enemy.prototype.contactAttack = function (dist) {
    if (dist < this.radius + Game.player.radius && this.hitCd <= 0) {
      this.hitCd = 1.0;
    }
  };

  Enemy.prototype.integrate = function (dt) {
    this.pos.x += (this.vel.x + this.sep.x * 6) * dt;
    this.pos.z += (this.vel.z + this.sep.z * 6) * dt;
    this.pos.y = Math.max(this.baseY, this.pos.y + this.vel.y * dt);
    this.vel.x *= Math.pow(0.4, dt); this.vel.z *= Math.pow(0.4, dt);
    // arena clamp
    const R = Game.stage.arenaRadius - this.radius - 1;
    const d = Math.hypot(this.pos.x, this.pos.z);
    if (d > R) { this.pos.x *= R / d; this.pos.z *= R / d; }
    this.actor.yaw = this.yaw;
  };

  Enemy.prototype.idleAnim = function (dt) {
    this.actor.update(dt, Game.camera);
    if (this.baseY === 0 && this.actor.groundY !== 0) this.actor.groundY = 0;
  };

  Enemy.prototype.chooseAttack = function (dist) {
    const pool = this.isBoss ? this.patternAttacks : this.sp.attacks;
    const usable = pool.filter(function (n) { return ATT[n] && dist <= ATT[n].range; });
    const n = usable.length ? usable[Math.floor(Math.random() * usable.length)] : (pool[0]);
    this.attackDef = ATT[n]; this.attackName = n;
    this.attackRange = this.attackDef.range;
    this.state = "wind"; this.stateT = 0;
    this.animAttack(n);
    /* ---- telegraph: a floor ring sized to the attack's real reach plus a
       wedge showing which way the blow is coming from ---- */
    const def = this.attackDef;
    const reach = def.aoe ? def.aoe
      : def.kind === "melee" ? def.range + this.radius
        : def.kind === "charge" ? 14
          : def.kind === "beam" ? 16 : 8;
    const col = (def.kind === "melee" || def.kind === "charge" || def.kind === "slam") ? 0xff4a4a : 0xffc24a;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(reach * 0.9, reach, 44),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(this.pos.x, 0.08, this.pos.z);
    ring.scale.setScalar(0.1);
    Game.stage.group.add(ring);
    this.telegraphRing = ring;
    this.telegraphReach = reach;
    // inner fill that tightens as the blow lands
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(reach, 40),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(this.pos.x, 0.07, this.pos.z);
    fill.scale.setScalar(0.1);
    Game.stage.group.add(fill);
    this.telegraphFill = fill;
    // swipe wedge (only where the blow actually sweeps)
    if (def.kind === "melee" || def.kind === "charge") {
      const span = def.kind === "charge" ? Math.PI * 0.5 : Math.PI * 0.8;
      const wedge = new THREE.Mesh(
        new THREE.RingGeometry(reach * 0.18, reach, 32, 1, this.yaw - Math.PI / 2 - span / 2, span),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      wedge.rotation.x = -Math.PI / 2;
      wedge.position.set(this.pos.x, 0.09, this.pos.z);
      Game.stage.group.add(wedge);
      this.telegraphWedge = wedge;
    }
    Audio2.sfx("warn");
  };

  /* tear down the floor telegraph (also when the wind-up is interrupted) */
  Enemy.prototype.clearTelegraph = function () {
    const g = Game.stage && Game.stage.group;
    const kill = function (m) {
      if (!m) return;
      if (g) g.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    };
    kill(this.telegraphRing); this.telegraphRing = null;
    kill(this.telegraphFill); this.telegraphFill = null;
    kill(this.telegraphWedge); this.telegraphWedge = null;
  };

  Enemy.prototype.executeAttack = function (dt, dx, dz, dist) {
    const d = this.attackDef, p = Game.player;
    const dm = this.dmgMul;
    const dirx = dx / (dist || 1), dirz = dz / (dist || 1);

    if (d.kind === "melee") {
      if (!this.attackHit) {
        this.attackHit = true;
        this.actor.A.slide = 6; this.actor.A.tilt = 0.25;
        const range = d.range + this.radius;
        /* the blow has to be visible: sweep + a burst of sparks at the tip */
        const chest = new THREE.Vector3(this.pos.x, this.pos.y + this.h * 0.5, this.pos.z);
        FX.arc(chest, this.yaw, range * 0.72, {
          color: 0xff8a6a, span: Math.PI * 1.1, rot: -0.3, life: 0.26,
          spin: -2.6, opacity: 0.8, vertical: true,
        });
        FX.arc(new THREE.Vector3(this.pos.x, 0.12, this.pos.z), this.yaw, range, {
          color: 0xff6a4a, span: Math.PI * 0.8, life: 0.24, opacity: 0.5,
        });
        const tip = new THREE.Vector3(this.pos.x + dirx * range * 0.72, this.pos.y + this.h * 0.45, this.pos.z + dirz * range * 0.72);
        FX.impact(tip, 0xffb08a, 0.9);
        if (dist < range && this.hitCd <= 0) {
          p.takeDamage(d.dmg * dm, this.pos);
          this.hitCd = 0.5;
          FX.impact(p.hitPoint(), 0xff6a4a, 1.4);
          FX.ring(p.hitPoint(), 0xff8a6a, 3.4, 0.3);
        }
        Audio2.sfx("punch");
      }
      if (this.stateT >= d.act) { this.state = "rec"; this.stateT = 0; }
    } else if (d.kind === "slam") {
      if (!this.attackHit) {
        this.attackHit = true;
        this.vel.y = 9;
        setTimeout(() => {
          if (this.dead) return;
          FX.shock(new THREE.Vector3(this.pos.x, 0.4, this.pos.z), 0xffb060, d.aoe, 0.55);
          FX.ring(new THREE.Vector3(this.pos.x, 0.1, this.pos.z), 0xff7a3a, d.aoe, 0.5);
          FX.ring(new THREE.Vector3(this.pos.x, 0.14, this.pos.z), 0xffd0a0, d.aoe * 0.6, 0.35);
          FX.burst(new THREE.Vector3(this.pos.x, 0.6, this.pos.z), 0xd0a070, 24, { speed: 20, life: 0.7, grav: 26, up: 1.2 });
          FX.debris(new THREE.Vector3(this.pos.x, 1.0, this.pos.z), 0x8a7a68, 12);
          FX.flash(0.16, "#ffb27a");
          FX.shake(0.8);
          Audio2.sfx("explode");
          const dd = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
          if (dd < d.aoe && p.pos.y < 6) p.takeDamage(d.dmg * dm, this.pos);
        }, 320);
      }
      if (this.stateT >= d.act + 0.35) { this.state = "rec"; this.stateT = 0; }
    } else if (d.kind === "charge") {
      if (!this.attackHit) {
        this.attackHit = true;
        this.actor.A.tilt = 0.3;
        this.vel.x = dirx * this.speed * 3.2;
        this.vel.z = dirz * this.speed * 3.2;
        Audio2.sfx("roar");
        FX.shake(0.4);
        FX.burst(new THREE.Vector3(this.pos.x - dirx * this.radius, 0.8, this.pos.z - dirz * this.radius),
          0xd0b090, 14, { speed: 12, life: 0.5, grav: 18 });
        FX.ring(new THREE.Vector3(this.pos.x, 0.1, this.pos.z), 0xff7a5a, 5, 0.3);
      }
      // trail while thundering forward
      if (Math.random() < 0.6) {
        FX.spark(new THREE.Vector3(this.pos.x - dirx * this.radius * 0.8, 0.35, this.pos.z - dirz * this.radius * 0.8), {
          color: 0xd8c0a0, grav: 12, life: 0.35, size: 0.42, drag: 0.9,
          vel: new THREE.Vector3(-dirx * 5, 3.5, -dirz * 5),
        });
      }
      // contact damage during charge
      if (dist < this.radius + p.radius + 1.2 && this.hitCd <= 0) {
        p.takeDamage(d.dmg * dm, this.pos); this.hitCd = 1.0;
        this.vel.x *= -0.3; this.vel.z *= -0.3;
      }
      if (this.stateT >= d.act) { this.state = "rec"; this.stateT = 0; }
    } else if (d.kind === "proj") {
      if (!this.attackHit) {
        this.attackHit = true;
        const from = new THREE.Vector3(this.pos.x, this.pos.y + this.h * 0.6, this.pos.z);
        const to = new THREE.Vector3(p.pos.x, p.pos.y + 1.6, p.pos.z);
        Game.spawnProjectile(from, to.clone().sub(from).normalize(), d.speed, d.dmg * dm, d.color, "enemy", 1.1);
        FX.impact(from, d.color !== undefined ? d.color : 0xff7a4a, 1.1);
        FX.ring(from, d.color !== undefined ? d.color : 0xff7a4a, 3.2, 0.28,
          { quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), to.clone().sub(from).normalize()) });
        Audio2.sfx("slash");
      }
      if (this.stateT >= d.act) { this.state = "rec"; this.stateT = 0; }
    } else if (d.kind === "volley") {
      if (!this.attackHit) {
        this.attackHit = true;
        this.volleyN = 0; this.volleyT = 0;
      }
      this.volleyT -= dt;
      if (this.volleyN < d.count && this.volleyT <= 0) {
        this.volleyN++; this.volleyT = 0.1;
        const from = new THREE.Vector3(this.pos.x, this.pos.y + this.h * 0.6, this.pos.z);
        const spread = (this.volleyN - d.count / 2) * 0.11;
        const to = new THREE.Vector3(p.pos.x + rnd(-3, 3), p.pos.y + 1.6, p.pos.z + rnd(-3, 3));
        const dir = to.clone().sub(from).normalize();
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
        Game.spawnProjectile(from, dir, d.speed, d.dmg * dm, d.color, "enemy", 1.0);
        FX.impact(from, d.color !== undefined ? d.color : 0xff7a4a, 0.85);
        Audio2.sfx("slash");
      }
      if (this.stateT >= d.act + 0.2) { this.state = "rec"; this.stateT = 0; }
    } else if (d.kind === "beam") {
      if (!this.attackHit) {
        this.attackHit = true;
        const from = new THREE.Vector3(this.pos.x, this.pos.y + this.h * 0.62, this.pos.z);
        this.myBeam = { from: from, dir: new THREE.Vector3(dirx, 0, dirz), t: 0 };
        Audio2.sfx("beam");
        FX.shake(0.5);
        FX.shock(from, d.color !== undefined ? d.color : 0xff5a6a, 4.5, 0.4);
        FX.flash(0.14, "#ff9a9a");
        FX.ring(from, d.color !== undefined ? d.color : 0xff5a6a, 6.5, 0.3,
          { quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dirx, 0, dirz)) });
      }
      if (this.myBeam) {
        const b = this.myBeam; b.t += dt;
        const len = d.range + 30;
        // visual: draw a beam
        Game.drawEnemyBeam(b.from, b.dir, len, d.color, dt);
        // hit check
        Game.checkBeamOnPlayer(b.from, b.dir, len, 2.6, d.dmg * dm * dt * 2.4);
      }
      if (this.stateT >= d.act) { this.myBeam = null; this.state = "rec"; this.stateT = 0; }
    } else if (d.kind === "dive") {
      if (!this.attackHit) {
        this.attackHit = true;
        this.diveT = 0;
        this.diveFrom = this.pos.clone();
        const to = new THREE.Vector3(p.pos.x, p.pos.y + 1.5, p.pos.z);
        this.diveDir = to.clone().sub(this.pos).normalize();
        Audio2.sfx("dash");
      }
      this.diveT += dt;
      const sp = 42;
      this.pos.addScaledVector(this.diveDir, sp * dt);
      if (dist < this.radius + p.radius + 1.4 && this.hitCd <= 0) { p.takeDamage(d.dmg * dm, this.pos); this.hitCd = 1.0; }
      if (this.diveT > 0.55) {
        this.pos.y = Math.max(0, this.pos.y - 30 * dt);
      }
      if (this.stateT >= d.act) { this.state = "rec"; this.stateT = 0; }
    } else if (d.kind === "clones") {
      if (!this.attackHit) {
        this.attackHit = true;
        Game.spawnClones(this, 3);
        Audio2.sfx("roar");
      }
      if (this.stateT >= d.act) { this.state = "rec"; this.stateT = 0; }
    } else if (d.kind === "meteor") {
      if (!this.attackHit) { this.attackHit = true; this.meteorN = 0; this.meteorT = 0; }
      this.meteorT -= dt;
      if (this.meteorN < d.count && this.meteorT <= 0) {
        this.meteorN++; this.meteorT = 0.16;
        const px = p.pos.x + rnd(-16, 16), pz = p.pos.z + rnd(-16, 16);
        Game.spawnMeteor(px, pz, d.dmg * dm);
      }
      if (this.stateT >= d.act + 0.4) { this.state = "rec"; this.stateT = 0; }
    }
  };

  /* pick and time an attack clip to fill the whole wind+act+rec window */
  Enemy.prototype.animAttack = function (name) {
    const a = this.actor, d = this.attackDef;
    if (!a || !a.oneShot) return;
    const total = d ? (d.wind + d.act + d.rec) : 1.0;
    const kind = d ? d.kind : "melee";
    let slot = "atk1";
    if (kind === "beam" || kind === "whip") slot = "beam";
    else if (kind === "slam" || kind === "charge" || kind === "dive" || kind === "meteor" || kind === "clones") slot = "atk2";
    else if (name === "swipeH") slot = "atk2";
    if (!a.oneShot(slot, Math.min(total, 1.7))) a.oneShot("atk1", Math.min(total, 1.7));
  };

  /* small physical reaction when the hit lands */
  Enemy.prototype.animHit = function (hard) {
    const a = this.actor;
    if (!a || !a.oneShot || this.dead) return;
    a.oneShot("hit", hard ? 0.5 : 0.3);
  };

  /* ---------------- phases ---------------- */
  Enemy.prototype.checkPhase = function () {
    if (!this.isBoss) return;
    const f = this.hp / this.maxHp;
    let want = 1;
    if (f <= 0.33) want = 3; else if (f <= 0.66) want = 2;
    want = Math.min(want, this.maxPhases);
    if (want > this.phase) {
      this.phase = want;
      this.enraged = true;
      this.speed *= 1.1;
      this.cool = 0.2;
      Audio2.sfx("roarBig");
      FX.shock(this.mid(), this.phase === 3 ? 0xff2a4a : 0xffa02a, 16, 0.7);
      FX.shake(1.0);
      Game.onBossPhase(this, want);
    }
  };

  E.Enemy = Enemy;
  E.ATT = ATT;
  window.Enemies = E;
})();
