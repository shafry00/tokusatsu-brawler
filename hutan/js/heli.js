/* ============================================================
   heli.js — "BALA BANTUAN": the Japanese water bomber
   ------------------------------------------------------------
   One radio call brings a tandem-rotor Chinook over the canopy
   with a Bambi bucket on a cable. It hovers, drops a column of
   water the width of a football field, and leaves.

   Two charges per stage. It is the panic button: it puts out a
   whole fire front and soaks the boss in one go — but it takes
   four seconds to arrive, and the fire does not wait.
   ============================================================ */
(function () {
  "use strict";

  const TUNE = {
    arrive: 4.4,
    hover: 7.0,
    dropAt: 1.3,
    dropTime: 1.5,
    radius: 27,
    water: 5.2,
    charges: 2,
    altitude: 42
  };

  function buildBody() {
    const g = new THREE.Group();
    const olive = new THREE.MeshLambertMaterial({ color: 0x4d5a44, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2c3530, flatShading: true });
    const glass = new THREE.MeshLambertMaterial({ color: 0x1b2b30, emissive: 0x0a1a20, flatShading: true });
    const metal = new THREE.MeshLambertMaterial({ color: 0x8d968c, flatShading: true });
    const red = new THREE.MeshBasicMaterial({ color: 0xc0202a });

    /* fuselage along +Z */
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.7, 12, 10), olive);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0;
    g.add(body);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(1.82, 10, 8), olive);
    nose.position.z = 6;
    nose.scale.z = 1.15;
    g.add(nose);

    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.5, 9, 7), glass);
    cockpit.position.set(0, 0.55, 5.9);
    cockpit.scale.set(1.02, 0.62, 0.7);
    g.add(cockpit);

    /* rear ramp / tail */
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 4), olive);
    tail.position.set(0, 0.15, -7.6);
    g.add(tail);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.6, 1.8), olive);
    fin.position.set(0, 1.5, -8.6);
    g.add(fin);

    /* engine housings + masts */
    [[-1.9, 0], [1.9, 0]].forEach(function (o) {});
    [3.4, -2.6].forEach(function (z) {
      const housing = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 2.4), dark);
      housing.position.set(0, 1.55, z);
      g.add(housing);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.9, 6), metal);
      mast.position.set(0, 2.4, z);
      g.add(mast);
    });

    /* skids */
    [-1.5, 1.5].forEach(function (x) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 7.6), metal);
      skid.position.set(x, -2.2, 0.4);
      g.add(skid);
      const strut1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.1, 5), metal);
      strut1.position.set(x, -1.6, 2);
      strut1.rotation.z = 0.18;
      g.add(strut1);
      const strut2 = strut1.clone();
      strut2.position.z = -1.4;
      g.add(strut2);
    });

    /* hinomaru on both sides */
    [1.86, -1.86].forEach(function (x) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.62, 16), red);
      disc.position.set(x, 0.1, 1.6);
      disc.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(disc);
    });

    /* rescue band */
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(1.88, 1.88, 0.7, 10, 1, true),
      new THREE.MeshLambertMaterial({ color: 0xd9c34a, side: THREE.DoubleSide })
    );
    band.rotation.x = Math.PI / 2;
    band.position.z = 3.1;
    g.add(band);

    /* rotors */
    const rotors = [];
    [3.4, -2.6].forEach(function (z) {
      const rotor = new THREE.Group();
      rotor.position.set(0, 2.9, z);
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.12, 0.85), dark);
        blade.rotation.y = (i / 3) * Math.PI * 2;
        rotor.add(blade);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.34, 8), metal);
      rotor.add(hub);
      g.add(rotor);
      rotors.push(rotor);
    });
    g.userData.rotors = rotors;

    /* bucket + cable */
    const bucketGrp = new THREE.Group();
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5, 4), dark);
    cable.position.y = -2.5;
    bucketGrp.add(cable);
    const bucket = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 1.5, 2.6, 12, 1, true),
      new THREE.MeshLambertMaterial({ color: 0xc4732a, side: THREE.DoubleSide, flatShading: true })
    );
    bucket.position.y = -6.2;
    bucketGrp.add(bucket);
    g.add(bucketGrp);
    g.userData.bucket = bucketGrp;
    g.userData.cable = cable;

    return g;
  }

  function Heli(scene) {
    this.scene = scene;
    this.state = "idle";
    this.charges = TUNE.charges;
    this.t = 0;
    this.hoverT = 0;
    this.dropDone = false;
    this.target = new THREE.Vector3();
    this.start = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.rotorSoundT = 0;
    this.onEvent = null;

    this.group = buildBody();
    this.group.scale.setScalar(2.1);
    this.group.visible = false;
    scene.add(this.group);

    /* the falling column of water */
    this.sheet = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x8fdcff, transparent: true, opacity: 0.32,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
      })
    );
    this.sheet.visible = false;
    scene.add(this.sheet);

    /* a blue ring on the ground shows exactly where the water will land */
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(TUNE.radius - 1.3, TUNE.radius, 40),
      new THREE.MeshBasicMaterial({
        color: 0x8fdcff, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.35;
    this.marker.visible = false;
    scene.add(this.marker);
  }

  Heli.prototype.reset = function (charges) {
    this.charges = charges === undefined ? TUNE.charges : charges;
    this.state = "idle";
    this.group.visible = false;
    this.sheet.visible = false;
    this.marker.visible = false;
    this.dropDone = false;
    this._applied = false;
  };

  Heli.prototype.canCall = function () {
    return this.state === "idle" && this.charges > 0;
  };

  Heli.prototype.call = function (x, z) {
    if (!this.canCall()) return false;
    this.charges--;
    this.target.set(x, 0, z);

    const a = Math.random() * Math.PI * 2;
    this.start.set(x + Math.cos(a) * 300, TUNE.altitude + 22, z + Math.sin(a) * 300);
    this.pos.copy(this.start);
    this.state = "inbound";
    this.t = 0;
    this.hoverT = 0;
    this.dropDone = false;
    this._applied = false;
    this.group.visible = true;
    this.marker.position.set(x, 0.35, z);
    this.marker.visible = true;
    this.group.position.copy(this.pos);
    this.group.rotation.y = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);

    if (window.Audio2) { Audio2.sfx("radio"); Audio2.sfx("rotor"); }
    if (this.onEvent) this.onEvent("called", this.target.clone());
    return true;
  };

  Heli.prototype.update = function (dt, ctx) {
    if (this.state === "idle") return;

    /* rotors spin always while visible */
    const rotors = this.group.userData.rotors;
    for (let i = 0; i < rotors.length; i++) rotors[i].rotation.y += dt * 26;

    this.rotorSoundT -= dt;
    if (this.rotorSoundT <= 0) {
      this.rotorSoundT = 1.15;
      if (window.Audio2) Audio2.sfx("rotor");
    }

    if (this.marker.visible) {
      this.marker.material.opacity = 0.32 + 0.22 * Math.sin(performance.now() * 0.006);
      const k = 0.9 + 0.1 * Math.sin(performance.now() * 0.006);
      this.marker.scale.set(k, k, k);
    }

    if (this.state === "inbound") {
      this.t += dt;
      const k = Math.min(1, this.t / TUNE.arrive);
      const e = k * k * (3 - 2 * k);
      const hoverY = 0;
      /* arc in from the edge, descending to hover height */
      this.pos.lerpVectors(this.start, new THREE.Vector3(this.target.x, TUNE.altitude, this.target.z), e);
      this.pos.y = this.start.y + (TUNE.altitude - this.start.y) * e + Math.sin(k * Math.PI) * 8;
      this.group.position.copy(this.pos);
      this.yaw = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
      this.group.rotation.y = this.yaw;
      this.group.rotation.z = Math.sin(k * Math.PI) * 0.08;

      if (k >= 1) {
        this.state = "hover";
        this.hoverT = 0;
        if (this.onEvent) this.onEvent("arrived", this.target.clone());
      }
    } else if (this.state === "hover") {
      this.hoverT += dt;
      this.group.position.set(
        this.target.x,
        TUNE.altitude + Math.sin(this.hoverT * 1.6) * 0.8,
        this.target.z
      );
      this.group.rotation.z = Math.sin(this.hoverT * 1.2) * 0.03;

      /* lower the bucket, then let it go */
      const bucket = this.group.userData.bucket;
      const cable = this.group.userData.cable;
      const dropK = Math.max(0, Math.min(1, (this.hoverT - TUNE.dropAt) / 0.8));
      bucket.position.y = -dropK * 4.5;
      cable.scale.y = 1 + dropK * 0.9;

      if (this.hoverT > TUNE.dropAt && !this.dropDone) {
        this._drop(dt, ctx);
      }
      if (this.hoverT > TUNE.hover) {
        this.state = "leave";
        this.t = 0;
        this.sheet.visible = false;
        this.marker.visible = false;
        bucket.position.y = 0;
      }
    } else if (this.state === "leave") {
      this.t += dt;
      this.pos.y += dt * 16;
      this.pos.x += Math.sin(this.yaw) * dt * 26;
      this.pos.z += Math.cos(this.yaw) * dt * 26;
      this.group.position.copy(this.pos);
      this.group.rotation.z *= 0.95;
      if (this.t > 3.2) {
        this.state = "idle";
        this.group.visible = false;
      }
    }
  };

  Heli.prototype._drop = function (dt, ctx) {
    const t = this.hoverT - TUNE.dropAt;
    const groundY = 0.6;
    const topY = TUNE.altitude * 2.1 - 30; /* under the bucket, roughly */
    const k = Math.min(1, t / TUNE.dropTime);

    this.sheet.visible = true;
    this.sheet.material.opacity = 0.34 * Math.sin(Math.min(1, k * 1.2) * Math.PI * 0.9);
    this.sheet.scale.set(TUNE.radius * (0.35 + k * 0.65), this.group.position.y - groundY, TUNE.radius * (0.35 + k * 0.65));
    this.sheet.position.set(this.target.x, (this.group.position.y + groundY) * 0.5, this.target.z);

    /* splash + steam at the ground */
    if (Math.random() < 0.9) {
      FireFX.splash({ x: this.target.x + (Math.random() - 0.5) * TUNE.radius, y: 1.2, z: this.target.z + (Math.random() - 0.5) * TUNE.radius }, 4, 12);
    }
    if (Math.random() < 0.7) {
      FireFX.steamPuff({
        x: this.target.x + (Math.random() - 0.5) * TUNE.radius,
        y: 2 + Math.random() * 4,
        z: this.target.z + (Math.random() - 0.5) * TUNE.radius
      }, 2, 3);
    }

    if (t >= TUNE.dropTime * 0.55 && !this._applied) {
      this._applied = true;
      if (ctx && ctx.forest) {
        const hits = ctx.forest.waterAt(this.target.x, this.target.z, TUNE.radius, TUNE.water);
        FX.ring(new THREE.Vector3(this.target.x, 0.5, this.target.z), 0x9fe8ff, TUNE.radius, 0.7);
        FX.shock(new THREE.Vector3(this.target.x, 2, this.target.z), 0x9fe8ff, TUNE.radius * 0.8, 0.5);
        FX.shake(0.35);
        if (window.Audio2) Audio2.sfx("splash");
        if (this.onEvent) this.onEvent("drop", { x: this.target.x, z: this.target.z, hits: hits });
      }
      if (ctx && ctx.boss && !ctx.boss.gone) {
        const dx = ctx.boss.pos.x - this.target.x, dz = ctx.boss.pos.z - this.target.z;
        if (Math.sqrt(dx * dx + dz * dz) < TUNE.radius + 8) {
          ctx.boss.hitByHeli(45);
          FireFX.steamPuff({ x: ctx.boss.pos.x, y: ctx.boss.height * 0.5, z: ctx.boss.pos.z }, 40, 8);
        }
      }
    }
  };

  Heli.TUNE = TUNE;
  window.Heli = Heli;
})();
