/* ============================================================
   player.js — the ranger
   ------------------------------------------------------------
   Two weapons, one body:

     SELANG (hose)   cone of water. Puts fire out, soaks the boss,
                     shoots fireballs out of the air. Drinks the tank.
     PALU (hammer)   three-hit melee. Made for the sawit crew — and
                     for a boss who is too wet to stay made of fire.

   Water refills in the pond or at a drum. The tank is the real
   cooldown, so where you fight matters as much as what you swing.
   ============================================================ */
(function () {
  "use strict";

  const TUNE = {
    height: 4.4,
    walk: 9.2,
    sprint: 16.2,
    accel: 30,
    jump: 16.5,
    gravity: 44,
    rollSpeed: 26,
    rollTime: 0.46,
    rollCd: 0.85,
    maxHp: 120,
    maxWater: 110,
    sprayRate: 13.0,
    pondRate: 56,
    drumRate: 36,
    passiveRate: 2.2,
    hoseRange: 27,
    hoseDot: 0.985,
    hammerRange: 9.2,
    hammerDot: 0.32,
    combo: [44, 54, 74],
    regenAfter: 7,
    regenRate: 5.4,
    respawnTime: 5.0
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  /* ---------------------------------------------------------- props */
  /* parent a world-unit prop to a bone: bone space is rotated and
     scaled by the rig, so the offset is rotated back and divided out */
  function attachWorldProp(bone, worldOffset, prop, upright) {
    bone.updateWorldMatrix(true, false);
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    bone.matrixWorld.decompose(new THREE.Vector3(), q, s);
    const qInv = q.clone().invert();
    const slot = new THREE.Group();
    slot.scale.set(1 / (s.x || 1), 1 / (s.y || 1), 1 / (s.z || 1));
    slot.position.copy(worldOffset).applyQuaternion(qInv).divide(s);
    if (upright) slot.quaternion.copy(qInv);
    bone.add(slot);
    slot.add(prop);
    return slot;
  }

  function attachToBone(actor, boneName, rot) {
    const bone = actor.root.getObjectByName(boneName);
    if (!bone) return null;
    const holder = new THREE.Group();
    const sc = actor.root.scale.x || 1;
    holder.scale.setScalar(1 / sc);
    if (rot) holder.rotation.set(rot[0], rot[1], rot[2]);
    bone.add(holder);
    return holder;
  }

  function buildHammer() {
    const g = new THREE.Group();
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x8a6038, flatShading: true });
    const steel = new THREE.MeshLambertMaterial({ color: 0x6d757a, flatShading: true });
    const red = new THREE.MeshLambertMaterial({ color: 0xb83a24, flatShading: true });

    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.6, 7), woodMat);
    handle.position.y = 0.8;
    g.add(handle);

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.46, 7), red);
    grip.position.y = 0.2;
    g.add(grip);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.36, 0.36), steel);
    head.position.y = 1.54;
    g.add(head);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 0.42), red);
    face.position.set(0.29, 1.54, 0);
    g.add(face);

    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.2, 6), steel);
    collar.position.y = 1.3;
    g.add(collar);
    return g;
  }

  function buildNozzle() {
    const g = new THREE.Group();
    const metal = new THREE.MeshLambertMaterial({ color: 0x9aa6aa, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2c3436, flatShading: true });
    const accent = new THREE.MeshLambertMaterial({ color: 0x2f7fa8, flatShading: true });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.8, 8), metal);
    body.position.y = 0.4;
    g.add(body);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.34, 8), dark);
    grip.position.y = 0.12;
    g.add(grip);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.12, 8), accent);
    collar.position.y = 0.72;
    g.add(collar);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.07, 0.22, 8), dark);
    tip.position.y = 0.88;
    g.add(tip);

    const marker = new THREE.Object3D();
    marker.position.y = 1.02;
    g.add(marker);
    g.userData.marker = marker;
    return g;
  }

  function buildHelmet(worldH) {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshLambertMaterial({ color: 0xe0b32a, flatShading: true })
    );
    shell.position.y = 0.06;
    g.add(shell);
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.53, 0.06, 14),
      new THREE.MeshLambertMaterial({ color: 0xd8a71e, flatShading: true })
    );
    g.add(brim);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.04, 0.78),
      new THREE.MeshLambertMaterial({ color: 0x2a2a26 })
    );
    stripe.position.y = 0.19;
    g.add(stripe);
    return g;
  }

  function buildTank() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.95, 10),
      new THREE.MeshLambertMaterial({ color: 0xb8482c, flatShading: true })
    );
    body.position.y = 0.05;
    g.add(body);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.42, 0.22, 10),
      new THREE.MeshLambertMaterial({ color: 0xd9d4c4, flatShading: true })
    );
    cap.position.y = 0.62;
    g.add(cap);
    const strap = new THREE.Mesh(
      new THREE.TorusGeometry(0.43, 0.05, 5, 12),
      new THREE.MeshLambertMaterial({ color: 0x2a2a26 })
    );
    strap.rotation.x = Math.PI / 2;
    strap.position.y = 0.16;
    g.add(strap);
    return g;
  }

  /* ---------------------------------------------------------- Player */
  function Player(scene, opts) {
    opts = opts || {};
    this.scene = scene;
    this.T = TUNE;
    this.pos = new THREE.Vector3(opts.x || 0, 0, opts.z || 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.aimDir = new THREE.Vector3(0, 0, 1);
    this.spraying = false;
    this.weapon = "hose";
    this.maxHp = TUNE.maxHp;
    this.hp = this.maxHp;
    this.water = TUNE.maxWater;
    this.maxWater = TUNE.maxWater;
    this.grounded = true;
    this.god = false;
    this.dead = false;
    this.deadT = 0;
    this.hurtT = 0;
    this.invuln = 0;
    this.rollT = 0;
    this.rollCd = 0;
    this.rollDir = new THREE.Vector3(0, 0, 1);
    this.swingT = 0;
    this.swingCd = 0;
    this.swingHit = false;
    this.comboIdx = 0;
    this.comboT = 0;
    this.hoseSoundT = 0;
    this.hitStopT = 0;
    this.sprayTarget = new THREE.Vector3();
    this.sprayHit = false;
    this.stats = { doused: 0, bonked: 0, palms: 0 };
    this.bobT = 0;

    this.actor = null;
    this._build(opts);
  }

  Player.prototype._build = function (opts) {
    const scene = this.scene;
    let actor = null;
    /* the ranger is an orangutan: ranger hat, water tank, hose */
    try {
      if (window.Orang && Orang.ready) actor = Orang.create({ height: TUNE.height });
    } catch (e) {
      console.warn("[player] orangutan failed", e);
    }
    try {
      if (!actor && window.Models && Models.cache && Models.cache.player) {
        actor = Models.create("player", {
          height: TUNE.height,
          accent: 0xd6362c,
          eyes: 0xfff0a0,
          body: 0xffffff
        });
      }
    } catch (e) {
      console.warn("[player] rig failed", e);
    }

    if (actor) {
      this.actor = actor;
      this.group = actor.group;
      scene.add(this.group);
      this.height = TUNE.height;

      /* helmet and tank ride their bones, with a world-unit offset:
         the rig is scaled, so an offset has to be divided by that
         scale to land where it looks like it should */
      const sc = actor.root.scale.x || 1;
      const head = actor.root.getObjectByName("Head");
      this.helmet = buildHelmet(this.height);
      if (head && actor.isApe) {
        /* the ape's skull sits above the head joint of the scan, and the
           ranger hat is built for a much smaller head */
        this.helmet.scale.setScalar(0.66);
        attachWorldProp(head, new THREE.Vector3(0, 0.36, 0.1), this.helmet, true);
      } else if (head) {
        const slot = new THREE.Group();
        slot.scale.setScalar(1 / sc);
        slot.position.set(0, 0.6 / sc, 0.04 / sc);
        head.add(slot);
        slot.add(this.helmet);
      } else {
        this.helmet.position.set(0, this.height * 0.82, 0.02);
        actor.inner.add(this.helmet);
      }

      this.tank = buildTank();
      const spine = actor.root.getObjectByName("spine_03");
      if (actor.isApe) {
        /* the ape's back is a wide slope: keep the tank rigid to the body
           and out of the fur, not to a single spine joint */
        this.tank.position.set(0, this.height * 0.71, -this.height * 0.19);
        actor.inner.add(this.tank);
      } else if (spine) {
        const slot = new THREE.Group();
        slot.scale.setScalar(1 / sc);
        slot.position.set(0, 0.05 / sc, -0.5 / sc);
        spine.add(slot);
        slot.add(this.tank);
      } else {
        this.tank.position.set(0, this.height * 0.5, -0.5);
        actor.inner.add(this.tank);
      }


      /* The props are parented to the scene, not to the rig: every frame
         they are placed at the fist and given a world orientation that
         we control. Bone-local props inherit whatever the idle pose does
         with the wrist (a hammer that points sideways), so world space
         is the only way to keep the silhouette readable.               */
      this.handR = actor.root.getObjectByName("hand_r");
      this.handL = actor.root.getObjectByName("hand_l");

      this.hammerProp = buildHammer();
      scene.add(this.hammerProp);

      this.hoseProp = buildNozzle();
      scene.add(this.hoseProp);

      this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1.25, 18), window.BlobShadow.mat(0.78));
      this.shadow.rotation.x = -Math.PI / 2;
      this.shadow.position.y = 0.04;
      scene.add(this.shadow);

      this.hammerPos = new THREE.Vector3();
      this.hosePos = new THREE.Vector3();
      this.nozzleWorld = new THREE.Vector3();
    } else {
      /* primitive stand-in: better a tin can than a crash */
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.68, 2.4, 8),
        new THREE.MeshLambertMaterial({ color: 0x9b2f22, flatShading: true })
      );
      body.position.y = 1.6;
      g.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 10, 8),
        new THREE.MeshLambertMaterial({ color: 0xe0b32a, flatShading: true })
      );
      head.position.y = 3.25;
      g.add(head);
      this.group = g;
      this.actor = null;
      this.height = TUNE.height;
      scene.add(g);
    }

    this.group.position.copy(this.pos);
  };

  Player.prototype.setWeapon = function (w) {
    if (w === this.weapon) return false;
    this.weapon = w;
    this.spraying = false;
    if (window.Audio2) Audio2.sfx("ui");
    return true;
  };

  /* ---------------------------------------------------------- update */
  Player.prototype.update = function (dt, ctx) {
    const input = ctx.input;
    if (this.god) {
      /* mode dewa: the bar never drops and the tank never empties */
      this.hp = this.maxHp;
      this.water = this.maxWater;
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.rollCd = Math.max(0, this.rollCd - dt);
    this.swingCd = Math.max(0, this.swingCd - dt);
    this.hurtT += dt;

    if (this.dead) {
      this.deadT += dt;
      this.vel.multiplyScalar(0.9);
      this.pos.addScaledVector(this.vel, dt);
      if (this.group.visible && this.deadT > 1.4) this.group.visible = false;
      if (this.deadT >= TUNE.respawnTime) this.respawn(ctx);
      this._applyTransform(dt, ctx);
      return;
    }

    /* ---------- movement ---------- */
    const cam = ctx.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);

    let mx = 0, mz = 0;
    if (input.forward) mz += 1;
    if (input.back) mz -= 1;
    if (input.right) mx += 1;
    if (input.left) mx -= 1;

    const move = new THREE.Vector3();
    move.addScaledVector(fwd, mz).addScaledVector(right, mx);
    const moving = move.lengthSq() > 0.0001;
    if (moving) move.normalize();

    const sprinting = input.sprint && moving && this.grounded;
    const speedMax = sprinting ? TUNE.sprint : TUNE.walk;

    /* rolling overrides intent */
    if (this.rollT > 0) {
      this.rollT -= dt;
      this.vel.x = this.rollDir.x * TUNE.rollSpeed * (0.55 + this.rollT / TUNE.rollTime * 0.65);
      this.vel.z = this.rollDir.z * TUNE.rollSpeed * (0.55 + this.rollT / TUNE.rollTime * 0.65);
    } else {
      const wish = move.clone().multiplyScalar(speedMax);
      const k = 1 - Math.exp(-TUNE.accel * dt);
      this.vel.x += (wish.x - this.vel.x) * k;
      this.vel.z += (wish.z - this.vel.z) * k;
      if (!moving) {
        const damp = 1 - Math.exp(-16 * dt);
        this.vel.x -= this.vel.x * damp;
        this.vel.z -= this.vel.z * damp;
      }
    }

    /* face movement, or the aim while shooting */
    let wantYaw = this.yaw;
    if (this.spraying || this.swingT > 0 || input.fire) {
      wantYaw = Math.atan2(this.aimDir.x, this.aimDir.z);
    } else if (moving) {
      wantYaw = Math.atan2(move.x, move.z);
    }
    this.yaw = lerpAngle(this.yaw, wantYaw, Math.min(1, dt * 14));

    /* jump + gravity */
    if (input.jump && this.grounded && this.rollT <= 0) {
      this.vel.y = TUNE.jump;
      this.grounded = false;
      input.jump = false;
      if (window.Audio2) Audio2.sfx("jump");
      if (this.actor) this.actor.oneShot("jump", 0.3);
    }
    if (!this.grounded) {
      this.vel.y -= TUNE.gravity * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.vel.y = 0;
        this.grounded = true;
        if (window.Audio2) Audio2.sfx("land");
        if (this.actor) this.actor.oneShot("land", 0.3);
        FX.burst(this.pos.clone(), 0x8a7f62, 6, { speed: 4, life: 0.35, size: 0.5, grav: 6 });
      }
    }

    /* roll */
    if (input.roll && this.rollCd <= 0 && this.grounded) {
      input.roll = false;
      this.rollT = TUNE.rollTime;
      this.rollCd = TUNE.rollCd;
      this.invuln = TUNE.rollTime;
      if (moving) this.rollDir.copy(move); else this.rollDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.vel.x = this.rollDir.x * TUNE.rollSpeed;
      this.vel.z = this.rollDir.z * TUNE.rollSpeed;
      if (this.actor) this.actor.oneShot("roll", 0.5);
      if (window.Audio2) Audio2.sfx("dash");
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    /* keep the ranger inside the reserve */
    const R = (ctx.forest && ctx.forest.radius - 6) || 160;
    const d = Math.sqrt(this.pos.x * this.pos.x + this.pos.z * this.pos.z);
    if (d > R) {
      this.pos.x = (this.pos.x / d) * R;
      this.pos.z = (this.pos.z / d) * R;
      this.vel.x *= 0.4;
      this.vel.z *= 0.4;
    }

    /* ---------- aim ---------- */
    cam.getWorldDirection(this.aimDir);
    if (this.aimDir.lengthSq() < 1e-6) this.aimDir.set(0, 0, 1);
    this.aimDir.normalize();

    /* ---------- water refill ---------- */
    const src = ctx.forest ? ctx.forest.waterSource(this.pos.x, this.pos.z) : null;
    if (src) {
      this.water = Math.min(this.maxWater, this.water + (src === "pond" ? TUNE.pondRate : TUNE.drumRate) * dt);
    } else {
      this.water = Math.min(this.maxWater, this.water + TUNE.passiveRate * dt);
    }

    /* ---------- weapons ---------- */
    this.spraying = false;
    if (this.weapon === "hose") {
      if (input.fire && this.water > 0) {
        this.spraying = true;
        this.water = Math.max(0, this.water - TUNE.sprayRate * dt);
        this._spray(dt, ctx);
      }
    } else {
      if (input.fire && this.swingT <= 0 && this.swingCd <= 0) {
        this._startSwing(ctx);
        input.fire = false;
      }
    }
    /* keep a hammer swing running to completion */
    if (this.swingT > 0) {
      this.swingT -= dt;
      if (!this.swingHit && this.swingT <= this.swingDur * 0.55) {
        this.swingHit = true;
        this._resolveSwing(ctx);
      }
      if (this.swingT <= 0) this.swingT = 0;
    }

    this.comboT -= dt;
    if (this.comboT <= 0 && this.swingT <= 0) this.comboIdx = 0;

    /* ---------- health ---------- */
    if (this.hurtT > TUNE.regenAfter && this.hp > 0) {
      this.hp = Math.min(this.maxHp, this.hp + TUNE.regenRate * dt);
    }

    this._applyTransform(dt, ctx);
  };

  const _UP = new THREE.Vector3(0, 1, 0);
  const _euler = new THREE.Euler(0, 0, 0, "YXZ");
  const _q = new THREE.Quaternion();

  Player.prototype._placeProps = function () {
    if (!this.hammerProp) return;

    const visible = !this.dead && this.group && this.group.visible;
    this.hammerProp.visible = visible;
    this.hoseProp.visible = visible;

    if (!visible) return;

    /* hammer */
    if (this.handR) {
      this.handR.updateWorldMatrix(true, false);
      this.handR.getWorldPosition(this.hammerPos);
    } else {
      this.hammerPos.copy(this.pos).add(_v3r(0.7, this.height * 0.45, 0));
    }
    this.hammerProp.position.copy(this.hammerPos);

    let tilt = 0.3;
    if (this.swingT > 0 && this.swingDur) {
      const p = 1 - this.swingT / this.swingDur;
      tilt -= Math.sin(p * Math.PI) * 1.75;
    }
    _euler.set(tilt, this.yaw, -0.08, "YXZ");
    _q.setFromEuler(_euler);
    this.hammerProp.quaternion.copy(_q);

    /* hose */
    if (this.handL) {
      this.handL.updateWorldMatrix(true, false);
      this.handL.getWorldPosition(this.hosePos);
    } else {
      this.hosePos.copy(this.pos).add(_v3r(-0.7, this.height * 0.45, 0));
    }
    this.hoseProp.position.copy(this.hosePos);

    const dir = this.spraying ? this.aimDir : _v3r(Math.sin(this.yaw) * 0.4, -0.6, Math.cos(this.yaw) * 0.4).normalize();
    this.hoseProp.quaternion.setFromUnitVectors(_UP, dir);
    this.nozzleWorld.copy(this.hosePos).addScaledVector(dir, 1.0);
  };

  let _tmpv = new THREE.Vector3();
  function _v3r(x, y, z) { return _tmpv.set(x, y, z); }

  Player.prototype._applyTransform = function (dt, ctx) {
    if (this.actor) {
      this.actor.yaw = this.yaw;
      this.actor.setPos(this.pos.x, this.pos.y, this.pos.z);
      this.actor.setState({
        speed: Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z),
        grounded: this.grounded
      });
      if (this.dead) this.actor.dead = true;
      this.actor.update(dt, ctx.camera);
    } else if (this.group) {
      this.group.position.copy(this.pos);
      this.group.rotation.y = this.yaw;
    }
    this._placeProps();
    if (this.shadow) {
      const k = 1 - Math.min(0.62, this.pos.y * 0.1);
      this.shadow.visible = !this.dead;
      this.shadow.position.set(this.pos.x, 0.045, this.pos.z);
      this.shadow.scale.setScalar(k);
    }
  };

  /* ---------------------------------------------------------- hose */
  Player.prototype._spray = function (dt, ctx) {
    const origin = this.nozzleWorld && this.nozzleWorld.lengthSq() > 0
      ? this.nozzleWorld.clone()
      : this.pos.clone().add(new THREE.Vector3(0, this.height * 0.6, 0));
    const dir = this.aimDir;

    FireFX.jet(origin, dir, dt);

    /* sound: repeated short noise bursts read as a continuous jet */
    this.hoseSoundT -= dt;
    if (this.hoseSoundT <= 0) {
      this.hoseSoundT = 0.42;
      if (window.Audio2) Audio2.sfx("hose");
    }

    /* --- what does the jet hit? --- */
    const R = TUNE.hoseRange;
    const hitDot = TUNE.hoseDot;
    let best = null, bestT = R;

    const trees = ctx.forest ? ctx.forest.trees : [];
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      if (t.state !== "burning" && t.state !== "alive") continue;
      const dx = t.x - origin.x, dz = t.z - origin.z;
      const proj = dx * dir.x + dz * dir.z;
      if (proj < 1 || proj > R) continue;
      const px = origin.x + dir.x * proj - t.x;
      const pz = origin.z + dir.z * proj - t.z;
      const perp = Math.sqrt(px * px + pz * pz);
      /* only actively aimed water lands; loose spray just falls */
      const flat = Math.sqrt(dir.x * dir.x + dir.z * dir.z) || 1;
      if (perp > t.r * 0.85 + 2.2) continue;
      if (dir.x * dx / (Math.sqrt(dx * dx + dz * dz) || 1) + dir.z * dz / (Math.sqrt(dx * dx + dz * dz) || 1) < 0.55) continue;
      if (proj < bestT) { bestT = proj; best = t; }
      if (t.state === "burning") this._wetTree(t, dt, ctx);
    }

    /* ground splash a couple of metres past the target */
    const reach = best ? bestT : Math.min(R, 14);
    this.sprayTarget.set(
      origin.x + dir.x * reach,
      Math.max(0.6, origin.y + dir.y * reach),
      origin.z + dir.z * reach
    );
    if (Math.random() < 0.55) FireFX.splash(this.sprayTarget, 2, 3.4);
    if (Math.random() < 0.25) FireFX.steamPuff(this.sprayTarget, 1, 1.2);

    /* nearby trees get a splash too, which makes sweeping feel good */
    if (ctx.forest) {
      ctx.forest.waterAt(this.sprayTarget.x, this.sprayTarget.z, 5.0, 3.0 * dt);
    }

    /* fireballs are water-soluble */
    const balls = ctx.fireballs || [];
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.dead) continue;
      const dx = b.pos.x - origin.x, dz = b.pos.z - origin.z;
      const proj = dx * dir.x + dz * dir.z;
      if (proj < 1 || proj > R) continue;
      const px = origin.x + dir.x * proj - b.pos.x;
      const pz = origin.z + dir.z * proj - b.pos.z;
      if (px * px + pz * pz > (b.radius + 2.2) * (b.radius + 2.2)) continue;
      b.dead = true;
      FireFX.steamPuff(b.pos, 16, 2.2);
      FX.impact(b.pos.clone(), 0x9fe8ff, 1.1);
      if (window.Audio2) Audio2.sfx("steam");
      if (ctx.onEvent) ctx.onEvent("fireballDown", b);
    }

    /* --- and the boss gets soaked --- */
    const boss = ctx.boss;
    if (boss && !boss.gone && !boss.dying) {
      const dx = boss.pos.x - origin.x, dz = boss.pos.z - origin.z;
      const proj = dx * dir.x + dz * dir.z;
      if (proj > 0 && proj < R + 6) {
        const px = origin.x + dir.x * proj - boss.pos.x;
        const pz = origin.z + dir.z * proj - boss.pos.z;
        const perp = Math.sqrt(px * px + pz * pz);
        if (perp < boss.radius + 2.6) {
          boss.addSoak(22 * dt);
          this.sprayTarget.copy(boss.pos);
          this.sprayTarget.y += boss.height * 0.45;
          if (Math.random() < 0.7) FireFX.steamPuff(this.sprayTarget, 2, boss.radius * 0.9);
        }
      }
    }
  };

  Player.prototype._wetTree = function (tree, dt, ctx) {
    tree._wetAcc = (tree._wetAcc || 0) + dt;
    if (tree._wetAcc < 0.1) return;
    tree._wetAcc = 0;
    FireFX.steamPuff({ x: tree.x, y: tree.h * 0.45, z: tree.z }, 2, 2.4);
    if (window.Audio2 && Math.random() < 0.3) Audio2.sfx("steam");
    if (ctx.onEvent) ctx.onEvent("sprayTree", tree);
  };

  /* ---------------------------------------------------------- hammer */
  Player.prototype._startSwing = function (ctx) {
    this.swingDur = 0.44;
    this.swingT = this.swingDur;
    this.swingCd = 0.5;
    this.swingHit = false;
    this.comboT = 1.2;
    this.comboIdx = (this.comboIdx + 1) % 3;
    if (this.actor) this.actor.oneShot("slash", 0.42);
    if (window.Audio2) Audio2.sfx("swing");

    const p = this.pos.clone();
    p.y += this.height * 0.55;
    FX.arc(p, this.yaw, 7.4, {
      vertical: true, color: 0xffd7a0, life: 0.19,
      span: Math.PI * 1.05, rot: -Math.PI / 2, opacity: 0.7
    });
  };

  Player.prototype._resolveSwing = function (ctx) {
    const dmg = TUNE.combo[this.comboIdx] || TUNE.combo[0];
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let hit = false;
    let bestPos = null;

    /* sawit palms: one good hit and the seedling is firewood */
    if (ctx.forest) {
      const trees = ctx.forest.trees;
      for (let i = 0; i < trees.length; i++) {
        const t = trees[i];
        if (t.state !== "sawit") continue;
        const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > TUNE.hammerRange + 1.5) continue;
        if ((dx / (d || 1)) * fx + (dz / (d || 1)) * fz < TUNE.hammerDot) continue;
        ctx.forest.clearSawit(t);
        this.stats.palms++;
        hit = true;
        bestPos = new THREE.Vector3(t.x, 2.4, t.z);
        if (ctx.onEvent) ctx.onEvent("palmCleared", t);
        break;
      }
    }

    /* the sawit crew */
    const crew = ctx.planters || [];
    for (let i = 0; i < crew.length; i++) {
      const pl = crew[i];
      if (!pl || !pl.alive || pl.fleeing) continue;
      const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > TUNE.hammerRange + 1.2) continue;
      if ((dx / (d || 1)) * fx + (dz / (d || 1)) * fz < TUNE.hammerDot) continue;
      pl.damage(dmg, this.pos);
      hit = true;
      bestPos = new THREE.Vector3(pl.pos.x, pl.height * 0.75, pl.pos.z);
      if (pl.hp <= 0) this.stats.bonked++;
      if (ctx.onEvent) ctx.onEvent("bonk", pl);
    }

    /* the boss only really feels it when he is soaking wet */
    const boss = ctx.boss;
    if (boss && !boss.gone && !boss.dying) {
      const dx = boss.pos.x - this.pos.x, dz = boss.pos.z - this.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < TUNE.hammerRange + boss.radius && (dx / (d || 1)) * fx + (dz / (d || 1)) * fz > -0.1) {
        const wet = boss.doused;
        boss.hitByHammer(wet ? dmg * 2.4 : dmg * 0.16, wet);
        hit = true;
        bestPos = new THREE.Vector3(boss.pos.x, boss.height * 0.45, boss.pos.z);
        if (ctx.onEvent) ctx.onEvent(wet ? "bossSmash" : "bossClank", boss);
      }
    }

    if (hit && bestPos) {
      FX.impact(bestPos, 0xffdda0, 1.25);
      FX.shake(0.22);
      FX.hitstop(38);
      if (window.Audio2) Audio2.sfx("thud");
    }
  };

  /* ---------------------------------------------------------- damage */
  Player.prototype.damage = function (amount, from) {
    if (this.dead || this.invuln > 0 || this.god) return false;
    this.hp -= amount;
    this.hurtT = 0;
    this.invuln = 0.55;
    if (window.Audio2) Audio2.sfx("hurt");
    FX.shake(0.5);
    FX.flash(0.16, 0xff3b1f);
    if (from) {
      const dx = this.pos.x - from.x, dz = this.pos.z - from.z;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      this.vel.x += (dx / d) * 14;
      this.vel.z += (dz / d) * 14;
    }
    FX.damage(new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.8, this.pos.z), amount, "player");
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    }
    return true;
  };

  Player.prototype.heal = function (n) {
    this.hp = Math.min(this.maxHp, this.hp + n);
  };

  Player.prototype.die = function () {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
    this.spraying = false;
    if (this.actor) {
      this.actor.dead = true;
      this.actor.oneShot("death", 1.2);
    }
    FX.shake(0.7);
    FX.flash(0.3, 0xff2a00);
    if (window.Audio2) Audio2.sfx("lose");
  };

  Player.prototype.respawn = function (ctx) {
    const f = ctx.forest;
    this.dead = false;
    this.deadT = 0;
    this.hp = this.maxHp;
    this.water = this.maxWater;
    this.vel.set(0, 0, 0);
    this.pos.set(f ? f.post.x : 0, 0, f ? f.post.z + 8 : 0);
    this.grounded = true;
    this.invuln = 2.2;
    if (this.actor) {
      this.actor.dead = false;
      this.actor.group.visible = true;
      this.actor.setState({ speed: 0 });
      this.actor.oneShot("hit", 0.2);
    }
    if (this.group) this.group.visible = true;
    if (ctx.onEvent) ctx.onEvent("respawn");
  };

  Player.prototype.nozzlePos = function () {
    if (this.nozzleWorld && this.nozzleWorld.lengthSq() > 0) return this.nozzleWorld.clone();
    return this.pos.clone().add(new THREE.Vector3(0, this.height * 0.6, 0));
  };

  Player.TUNE = TUNE;
  window.Player = Player;
})();
