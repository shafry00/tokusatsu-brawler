/* ============================================================
   planters.js — the sawit crew
   ------------------------------------------------------------
   Once enough land is black, the plantation crew walks in — a
   machete, a sack of seedlings, and absolutely no interest in
   what used to grow there. They pick burnt ground and plant.

   They are the loss condition with legs: every palm they get
   into the ground is land the forest does not get back. The
   hammer is how you convince them to leave.
   ============================================================ */
(function () {
  "use strict";

  const TUNE = {
    height: 4.0,
    speed: 5.4,
    runSpeed: 7.4,
    hp: 62,
    plantTime: 2.4,
    reach: 3.6,
    attackDamage: 8,
    attackEvery: 2.8,
    attackRange: 8.5,
    fadeTime: 1.8
  };

  const ROLES = ["zero", "seven", "mebius", "tiga"];
  const HATS = [0xc9a24a, 0xa8843c, 0xd9b968];

  function rand(a, b) { return a + Math.random() * (b - a); }

  function buildHat(color) {
    const hat = new THREE.Group();
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.66, 0.06, 14),
      new THREE.MeshLambertMaterial({ color: color, flatShading: true })
    );
    hat.add(brim);
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(0.46, 0.62, 12),
      new THREE.MeshLambertMaterial({ color: color, flatShading: true })
    );
    crown.position.y = 0.32;
    hat.add(crown);
    return hat;
  }

  function buildMachete() {
    const g = new THREE.Group();
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 1.35, 0.05),
      new THREE.MeshLambertMaterial({ color: 0xb9c2c4, flatShading: true })
    );
    blade.position.y = 0.95;
    g.add(blade);
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.17, 0.42, 0.12),
      new THREE.MeshLambertMaterial({ color: 0x4a3520, flatShading: true })
    );
    handle.position.y = 0.2;
    g.add(handle);
    return g;
  }

  function buildSack() {
    const sack = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 7, 6),
      new THREE.MeshLambertMaterial({ color: 0xa89568, flatShading: true })
    );
    sack.scale.set(0.9, 1.15, 0.7);
    return sack;
  }

  /* ---------------------------------------------------------- one planter */
  function Planter(scene, x, z, idx) {
    this.scene = scene;
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = Math.PI;
    this.hp = TUNE.hp;
    this.alive = true;
    this.height = TUNE.height;
    this.state = "seek";
    this.stateT = 0;
    this.target = null;
    this.plantT = 0;
    this.atkT = rand(0.5, 2);
    this.stagger = 0;
    this.deadT = 0;
    this.walkPhase = Math.random() * 6.28;
    this.role = ROLES[idx % ROLES.length];
    this.group = null;
    this.actor = null;
    this._build(idx);
  }

  Planter.prototype._build = function (idx) {
    let a = null;
    try {
      if (window.Wowok && Wowok.has("unit")) {
        a = Wowok.create({
          kind: "unit", height: TUNE.height,
          tint: HATS[idx % HATS.length].cloth || 0xe08a3a,
          glow: 0.34, droop: 1.0
        });
        a.isWowok = true;
      }
    } catch (e) { /* fallback below */ }
    if (!a) {
      try {
        if (window.Models && Models.cache && Models.cache.player) {
          a = Models.create(this.role, { height: TUNE.height });
        }
      } catch (e) { /* fallback below */ }
    }

    if (a) {
      this.actor = a;
      this.group = a.group;
      this.scene.add(this.group);

      const hat = buildHat(HATS[idx % HATS.length]);
      hat.position.set(0, this.height * 0.95, 0);
      a.inner.add(hat);

      const sack = buildSack();
      sack.position.set(0, this.height * 0.6, -0.42);
      a.inner.add(sack);

      if (a.isWowok) {
        /* the arm hangs at the hip, so the parang rides there too */
        const machete = buildMachete();
        machete.position.set(this.height * 0.19, this.height * 0.36, this.height * 0.02);
        machete.rotation.set(0.1, 0, 0.35);
        machete.scale.setScalar(this.height / 4.0);
        a.inner.add(machete);
      } else {
        const bone = a.root.getObjectByName("hand_r");
        if (bone) {
          const holder = new THREE.Group();
          holder.scale.setScalar(1 / (a.root.scale.x || 1));
          holder.rotation.set(0, 0, -Math.PI / 2);
          bone.add(holder);
          holder.add(buildMachete());
        }
      }
    } else {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.6, 2.6, 7),
        new THREE.MeshLambertMaterial({ color: 0x6b4a2a, flatShading: true })
      );
      body.position.y = 1.5;
      g.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 8, 6),
        new THREE.MeshLambertMaterial({ color: 0xc9a24a, flatShading: true })
      );
      head.position.y = 3.1;
      g.add(head);
      this.group = g;
      this.scene.add(g);
    }

    this.group.position.copy(this.pos);

    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1.25, 14), window.BlobShadow.mat(0.5));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(this.pos.x, 0.045, this.pos.z);
    this.scene.add(this.shadow);

    /* a small amber marker so a crew member is findable in the trees */
    this.marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.55, 0),
      new THREE.MeshBasicMaterial({ color: 0xe0a63a, transparent: true, opacity: 0.75 })
    );
    this.marker.position.y = this.height + 1.6;
    this.group.add(this.marker);

    this.sackMeshVisible = true;
  };

  Planter.prototype.damage = function (n, from) {
    if (!this.alive) return;
    this.hp -= n;
    if (this.actor) {
      this.actor.hitFlash(0.9);
      this.actor.oneShot("hit", 0.3);
    }
    FX.burst(new THREE.Vector3(this.pos.x, this.height * 0.7, this.pos.z), 0xe0a63a, 8,
      { speed: 7, life: 0.4, size: 0.7 });
    FX.damage(new THREE.Vector3(this.pos.x, this.height * 0.9, this.pos.z), n, "crit");
    if (from) {
      const dx = this.pos.x - from.x, dz = this.pos.z - from.z;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      this.pos.x += (dx / d) * 2.2;
      this.pos.z += (dz / d) * 2.2;
    }
    this.stagger = 0.32;
    this.plantT = 0;
    if (this.hp <= 0) this._die();
  };

  Planter.prototype._die = function () {
    this.alive = false;
    this.state = "dead";
    this.deadT = 0;
    if (this.actor) {
      this.actor.dead = true;
      this.actor.oneShot("death", 0.7);
    }
    if (this.marker) this.marker.visible = false;
    FX.burst(new THREE.Vector3(this.pos.x, this.height * 0.6, this.pos.z), 0xffd24a, 14,
      { speed: 9, life: 0.6, size: 1 });
    if (window.Audio2) { Audio2.sfx("bonk"); Audio2.sfx("hitFlesh"); }
  };

  Planter.prototype.update = function (dt, ctx) {
    if (this.state === "dead") {
      this.deadT += dt;
      if (this.actor) this.actor.update(dt, ctx.camera);
      if (this.deadT > TUNE.fadeTime) this.group.visible = false;
      return;
    }

    this.stateT += dt;
    this.atkT -= dt;
    if (this.marker) {
      this.marker.rotation.y += dt * 1.6;
      this.marker.position.y = this.height + 1.6 + Math.sin(this.stateT * 2.2) * 0.25;
    }

    if (this.stagger > 0) {
      this.stagger -= dt;
      this._faceAndStep(dt, ctx, 0);
      return;
    }

    const forest = ctx.forest;
    const player = ctx.player;

    /* whack the ranger if he gets between the crew and the dirt */
    if (player && !player.dead) {
      const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < TUNE.attackRange && this.atkT <= 0) {
        this.atkT = TUNE.attackEvery;
        this.yaw = Math.atan2(dx, dz);
        if (this.actor) this.actor.oneShot("slash", 0.4);
        if (window.Audio2) Audio2.sfx("swing");
        FX.arc(new THREE.Vector3(this.pos.x, 2, this.pos.z), this.yaw, 5.4,
          { vertical: true, color: 0xd8b070, life: 0.16, span: Math.PI * 0.9 });
        if (d < TUNE.attackRange - 1.2) player.damage(TUNE.attackDamage, this.pos);
        this.state = "fight";
        this.stateT = 0;
        this._faceAndStep(dt, ctx, 0);
        return;
      }
    }

    /* planting in progress */
    if (this.state === "plant") {
      this.plantT -= dt;
      if (this.target && this.target.state !== "burnt") {
        this.state = "seek";
        this.target = null;
      } else if (this.plantT <= 0) {
        if (this.target && forest) {
          forest.plantSawit(this.target);
          if (ctx.onPlant) ctx.onPlant(this.target, this);
          FX.burst(new THREE.Vector3(this.target.x, 1, this.target.z), 0x7d8f3a, 12,
            { speed: 5, life: 0.6, size: 1 });
        }
        this.target = null;
        this.state = "seek";
      } else {
        /* dust while they dig */
        if (Math.random() < dt * 8) {
          FX.burst(new THREE.Vector3(this.pos.x, 0.6, this.pos.z), 0x6a5a3c, 2,
            { speed: 2.4, life: 0.5, size: 0.5 });
        }
        this._faceAndStep(dt, ctx, 0);
        return;
      }
    }

    /* pick the closest burnt tile */
    if (!this.target || this.target.state !== "burnt") {
      this.target = forest ? forest.nearestBurnt(this.pos.x, this.pos.z) : null;
      if (this.target && forest) {
        /* someone may already be on it */
        const t = this.target;
        const taken = (ctx.planters || []).some(function (o) {
          return o !== this && o.alive && o.target === t;
        });
        if (taken) this.target = null;
      }
    }

    if (!this.target) {
      /* nothing burnt nearby: loiter toward the middle and wait for work */
      const a = Math.atan2(-this.pos.z, -this.pos.x);
      this.walkPhase += dt * 4;
      this.pos.x += Math.cos(a) * TUNE.speed * 0.35 * dt;
      this.pos.z += Math.sin(a) * TUNE.speed * 0.35 * dt;
      this.yaw = Math.atan2(Math.cos(a), Math.sin(a));
      this._animate(dt, ctx, TUNE.speed * 0.35);
      return;
    }

    const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > TUNE.reach) {
      this.state = "walk";
      const nx = dx / d, nz = dz / d;
      this.pos.x += nx * TUNE.speed * dt;
      this.pos.z += nz * TUNE.speed * dt;
      this.yaw = Math.atan2(nx, nz);
      this._animate(dt, ctx, TUNE.speed);
    } else {
      this.state = "plant";
      this.plantT = TUNE.plantTime;
      this.stateT = 0;
      if (this.actor) this.actor.oneShot("atk2", 0.9);
      if (window.Audio2) Audio2.sfx("thud");
      this._faceAndStep(dt, ctx, 0);
      this._animate(dt, ctx, 0);
    }
  };

  Planter.prototype._faceAndStep = function (dt, ctx, speed) {
    this._animate(dt, ctx, speed);
  };

  Planter.prototype._animate = function (dt, ctx, speed) {
    if (this.shadow) {
      this.shadow.visible = this.alive;
      this.shadow.position.set(this.pos.x, 0.045, this.pos.z);
    }
    if (this.actor) {
      this.actor.yaw = this.yaw;
      this.actor.setPos(this.pos.x, 0, this.pos.z);
      this.actor.setState({ speed: speed, grounded: true });
      this.actor.update(dt, ctx.camera);
    } else {
      this.group.position.set(this.pos.x, 0, this.pos.z);
      this.group.rotation.y = this.yaw;
    }
  };

  /* ---------------------------------------------------------- the crew */
  function Planters(scene) {
    this.scene = scene;
    this.list = [];
    this.wave = 0;
    this.onKill = null;
    this.onPlant = null;
    this.spawnT = 0;
  }

  Planters.prototype.spawnWave = function (n) {
    this.wave++;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(150, 162);
      const p = new Planter(this.scene, Math.cos(a) * r, Math.sin(a) * r, this.wave * 3 + i);
      this.list.push(p);
      FX.ring(new THREE.Vector3(p.pos.x, 0.4, p.pos.z), 0xe0a63a, 8, 0.6);
    }
    if (window.Audio2) Audio2.sfx("alarm");
    return this.list.length;
  };

  Planters.prototype.aliveCount = function () {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) if (this.list[i].alive) n++;
    return n;
  };

  Planters.prototype.update = function (dt, ctx) {
    ctx.planters = this.list;
    if (!ctx.onPlant) ctx.onPlant = this.onPlant;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const wasAlive = p.alive;
      p.update(dt, ctx);
      if (wasAlive && !p.alive && this.onKill) this.onKill(p);
      if (!p.alive && p.deadT > TUNE.fadeTime + 1.2) {
        this.scene.remove(p.group);
        if (p.shadow) this.scene.remove(p.shadow);
        if (p.actor && p.actor.mixer) p.actor.mixer.stopAllAction();
        this.list.splice(i, 1);
      }
    }
  };

  Planters.prototype.clear = function () {
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      this.scene.remove(p.group);
      if (p.shadow) this.scene.remove(p.shadow);
    }
    this.list.length = 0;
    this.wave = 0;
  };

  Planters.TUNE = TUNE;
  window.Planters = Planters;
})();
