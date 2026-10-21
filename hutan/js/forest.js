/* ============================================================
   forest.js — the battlefield
   ------------------------------------------------------------
   A forest is a list of trees on a disc, plus water (pond and
   drums), a ranger post and a helipad. Each tree walks a small
   state machine:

       alive ──ignite──▶ burning ──hp 0──▶ burnt ──planter──▶ sawit
         ▲                 │
         └──extinguish─────┘

   Only `alive` and `burning` trees count as forest. `burnt` land
   is where the sawit army plants, and `sawit` land is the loss
   condition — so water buys time, the hammer buys the land back.

   Fire spreads tree to tree, biased downwind, on a slow tick so
   a 130-tree forest costs almost nothing.
   ============================================================ */
(function () {
  "use strict";

  const PALM_FRONDS = 9;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---------------------------------------------------------- textures */
  function groundTexture() {
    const S = 512;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    g.fillStyle = "#28371f";
    g.fillRect(0, 0, S, S);

    /* mossy blotches */
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const r = 2 + Math.random() * 26;
      const shade = Math.random();
      if (shade < 0.42) g.fillStyle = "rgba(58, 82, 42, " + (0.05 + Math.random() * 0.16) + ")";
      else if (shade < 0.78) g.fillStyle = "rgba(34, 48, 26, " + (0.06 + Math.random() * 0.2) + ")";
      else g.fillStyle = "rgba(88, 72, 40, " + (0.04 + Math.random() * 0.12) + ")";
      g.beginPath();
      g.ellipse(x, y, r, r * (0.5 + Math.random() * 0.8), Math.random() * 3, 0, 6.2832);
      g.fill();
    }
    /* fine litter */
    for (let i = 0; i < 4200; i++) {
      g.fillStyle = Math.random() < 0.5 ? "rgba(120, 104, 62, .10)" : "rgba(20, 30, 16, .16)";
      g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(24, 24);
    t.anisotropy = 4;
    return t;
  }

  function barkTexture() {
    const S = 128;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    g.fillStyle = "#4a3a2a";
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 220; i++) {
      g.strokeStyle = Math.random() < 0.5 ? "rgba(28, 20, 14, .34)" : "rgba(112, 92, 66, .22)";
      g.lineWidth = 1 + Math.random() * 3;
      const x = Math.random() * S;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + 6, S * 0.3, x - 6, S * 0.7, x + 3, S);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 3);
    return t;
  }

  /* ---------------------------------------------------------- blob shadow */
  function blobTexture() {
    const S = 64;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, "rgba(0,0,0,.72)");
    grad.addColorStop(0.55, "rgba(0,0,0,.34)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    return new THREE.CanvasTexture(c);
  }
  const BLOB_TEX = blobTexture();
  window.BlobShadow = {
    texture: BLOB_TEX,
    mat: function (opacity) {
      return new THREE.MeshBasicMaterial({
        map: BLOB_TEX, transparent: true, depthWrite: false,
        opacity: opacity === undefined ? 0.55 : opacity
      });
    }
  };

  /* ---------------------------------------------------------- Forest */
  function Forest(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "forest";
    scene.add(this.group);

    this.trees = [];
    this.drums = [];
    this.palms = [];
    this.burningList = [];

    this.pond = { x: -72, z: 58, r: 25 };
    this.post = { x: 0, z: -12, r: 22 };
    this.hpad = { x: 22, z: -12, r: 11 };
    this.radius = 168;

    this._wind = new THREE.Vector2(1, 0.35).normalize();
    this.windAngle = 0;
    this.spreadT = 0;
    this._lamp = [];
    this.time = 0;

    this.buildShared();
  }

  /* geometries and materials that survive stage rebuilds */
  Forest.prototype.buildShared = function () {
    this.geoGround = new THREE.PlaneGeometry(520, 520, 1, 1);
    this.matGround = new THREE.MeshLambertMaterial({ map: groundTexture(), color: 0x8b9c74 });

    this.geoTrunk = new THREE.CylinderGeometry(0.34, 0.62, 1, 7, 1);
    this.geoTrunk.translate(0, 0.5, 0);
    this.barkTex = barkTexture();

    this.geoBlob = new THREE.IcosahedronGeometry(1, 1);
    this.geoBush = new THREE.IcosahedronGeometry(1, 0);
    this.matBush = new THREE.MeshLambertMaterial({ color: 0x2d4423, flatShading: true });

    this.geoRock = new THREE.DodecahedronGeometry(1, 0);
    this.matRock = new THREE.MeshLambertMaterial({ color: 0x5b5f57, flatShading: true });

    this.geoPalmTrunk = new THREE.CylinderGeometry(0.26, 0.52, 1, 6, 1);
    this.geoPalmTrunk.translate(0, 0.5, 0);
    this.matPalmTrunk = new THREE.MeshLambertMaterial({ color: 0x6a5a3c, flatShading: true });
    this.geoFrond = new THREE.BoxGeometry(1.15, 0.075, 5.4);
    this.matFrond = new THREE.MeshLambertMaterial({
      color: 0x35592c, flatShading: true, side: THREE.DoubleSide,
      emissive: 0x0a1206, emissiveIntensity: 1
    });
    this.geoFruit = new THREE.SphereGeometry(0.55, 6, 5);
    this.matFruit = new THREE.MeshLambertMaterial({ color: 0x9a5a1c, flatShading: true });

    this.geoDrum = new THREE.CylinderGeometry(1.05, 1.05, 2.6, 12, 1);
    this.matDrum = new THREE.MeshLambertMaterial({ color: 0x2f6f8e, flatShading: true });
    this.matDrumRim = new THREE.MeshLambertMaterial({ color: 0x9fb6bf, flatShading: true });

    this.palmGrp = new THREE.Group();
  };

  /* ---------------------------------------------------------- build */
  Forest.prototype.build = function (stage) {
    this.clear();
    if (this._scorches) {
      for (let i = 0; i < this._scorches.length; i++) this._scorches[i].visible = false;
    }
    this.stage = stage;
    this.time = 0;
    this.spreadT = 0;
    this.burningList.length = 0;

    const cfg = stage;
    this.windAngle = cfg.windAngle === undefined ? -0.6 : cfg.windAngle;
    this._wind.set(Math.cos(this.windAngle), Math.sin(this.windAngle));
    if (window.FireFX) FireFX.setWind(this._wind.x, this._wind.y);

    /* --- ground --- */
    const ground = new THREE.Mesh(this.geoGround, this.matGround);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = false;
    this.group.add(ground);
    this.groundMesh = ground;

    /* a darker skirt so the world does not end at a hard edge */
    const skirtGeo = new THREE.RingGeometry(this.radius - 2, 620, 48, 1);
    const skirtMat = new THREE.MeshBasicMaterial({ color: 0x10180e, transparent: true, opacity: 0.85 });
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.y = -0.05;
    this.group.add(skirt);

    /* --- pond --- */
    const pondGeo = new THREE.CircleGeometry(this.pond.r, 40);
    const pondMat = new THREE.MeshLambertMaterial({ color: 0x1c5260, emissive: 0x0a1e26 });
    const pond = new THREE.Mesh(pondGeo, pondMat);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(this.pond.x, 0.06, this.pond.z);
    this.group.add(pond);
    const pondRim = new THREE.Mesh(
      new THREE.RingGeometry(this.pond.r, this.pond.r + 1.6, 40, 1),
      new THREE.MeshLambertMaterial({ color: 0x6b6247 })
    );
    pondRim.rotation.x = -Math.PI / 2;
    pondRim.position.set(this.pond.x, 0.08, this.pond.z);
    this.group.add(pondRim);

    /* --- ranger post --- */
    this.buildPost();

    /* --- trees --- */
    this.placeTrees(cfg.trees || 128);

    /* --- scatter --- */
    this.scatter(cfg);

    /* --- drums --- */
    this.buildDrums();
  };

  Forest.prototype.buildPost = function () {
    const g = new THREE.Group();
    g.position.set(this.post.x, 0, this.post.z);

    const wallMat = new THREE.MeshLambertMaterial({ color: 0x6f5638, flatShading: true });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x7a2f1d, flatShading: true });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0xb89a6a });

    const walls = new THREE.Mesh(new THREE.BoxGeometry(9, 5.2, 7), wallMat);
    walls.position.y = 2.6;
    g.add(walls);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(7.4, 3.4, 4), roofMat);
    roof.position.y = 6.6;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);

    const deck = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 9.6), trimMat);
    deck.position.y = 0.25;
    g.add(deck);

    /* lit window */
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1.4),
      new THREE.MeshBasicMaterial({ color: 0xffc46b })
    );
    win.position.set(0, 3.1, 3.56);
    g.add(win);

    /* radio mast */
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 11, 5),
      new THREE.MeshLambertMaterial({ color: 0x8d9a9c })
    );
    mast.position.set(-4.1, 5.5, -2.6);
    g.add(mast);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6, 0, Math.PI), trimMat);
    dish.position.set(-4.1, 10.6, -2.6);
    dish.rotation.z = 1.2;
    g.add(dish);

    /* flag */
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 9, 5),
      new THREE.MeshLambertMaterial({ color: 0xcfd6cd })
    );
    pole.position.set(5.6, 4.5, 3.2);
    g.add(pole);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.5),
      new THREE.MeshLambertMaterial({ color: 0xc9302c, side: THREE.DoubleSide })
    );
    flag.position.set(6.95, 8.4, 3.2);
    g.add(flag);
    this.flag = flag;

    this.group.add(g);
    this.postMesh = g;

    /* helipad */
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(this.hpad.r, 32),
      new THREE.MeshLambertMaterial({ color: 0x2e332e })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(this.hpad.x, 0.07, this.hpad.z);
    this.group.add(pad);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.hpad.r - 0.9, this.hpad.r, 32, 1),
      new THREE.MeshBasicMaterial({ color: 0xd8a13a })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(this.hpad.x, 0.09, this.hpad.z);
    this.group.add(ring);

    const hm = new THREE.MeshBasicMaterial({ color: 0xd8a13a });
    const bar = new THREE.BoxGeometry(0.7, 0.02, 5.4);
    const a = new THREE.Mesh(bar, hm); a.position.set(this.hpad.x - 2, 0.1, this.hpad.z);
    const b = new THREE.Mesh(bar, hm); b.position.set(this.hpad.x + 2, 0.1, this.hpad.z);
    const c = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.02, 0.7), hm);
    c.position.set(this.hpad.x, 0.1, this.hpad.z);
    this.group.add(a, b, c);
  };

  /* clustered placement: a forest with clearings reads better than noise */
  Forest.prototype.placeTrees = function (target) {
    const clusters = [];
    const NC = this.stage.clusters || 11;
    for (let i = 0; i < NC; i++) {
      const a = (i / NC) * Math.PI * 2 + rand(-0.24, 0.24);
      const r = rand(52, this.radius - 30);
      clusters.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, r: rand(26, 44) });
    }
    /* keep the start clear: the ranger needs room to see and the
       camera needs room to swing behind him */
    const start = { x: 0, z: 4, r: 30 };
    this._start = start;
    /* a couple of inner clusters so the centre is not empty */
    clusters.push({ x: rand(-40, 40), z: rand(20, 70), r: 34 });
    clusters.push({ x: rand(-60, -10), z: rand(-70, -20), r: 30 });

    let guard = 0;
    while (this.trees.length < target && guard++ < 9000) {
      const cl = clusters[(Math.random() * clusters.length) | 0];
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * cl.r;
      const x = cl.x + Math.cos(a) * rr;
      const z = cl.z + Math.sin(a) * rr;

      if (Math.sqrt(x * x + z * z) > this.radius - 12) continue;
      if (Math.sqrt(dist2(x, z, this.pond.x, this.pond.z)) < this.pond.r + 5) continue;
      if (Math.sqrt(dist2(x, z, this.post.x, this.post.z)) < this.post.r) continue;
      if (Math.sqrt(dist2(x, z, this.hpad.x, this.hpad.z)) < this.hpad.r + 3) continue;
      if (Math.sqrt(dist2(x, z, start.x, start.z)) < start.r) continue;

      let ok = true;
      for (let i = 0; i < this.trees.length; i++) {
        const t = this.trees[i];
        if (dist2(x, z, t.x, t.z) < 11.5 * 11.5) { ok = false; break; }
      }
      if (!ok) continue;

      this.trees.push(this.makeTree(x, z));
    }

    /* anything the sampler could not fit gets one more pass at a
       smaller spacing, so the forest is never sparse */
    guard = 0;
    while (this.trees.length < target && guard++ < 4000) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * (this.radius - 16);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (Math.sqrt(dist2(x, z, this.pond.x, this.pond.z)) < this.pond.r + 5) continue;
      if (Math.sqrt(dist2(x, z, this.post.x, this.post.z)) < this.post.r) continue;
      if (Math.sqrt(dist2(x, z, this.hpad.x, this.hpad.z)) < this.hpad.r + 3) continue;
      if (Math.sqrt(dist2(x, z, start.x, start.z)) < start.r - 4) continue;
      let ok = true;
      for (let i = 0; i < this.trees.length; i++) {
        if (dist2(x, z, this.trees[i].x, this.trees[i].z) < 9 * 9) { ok = false; break; }
      }
      if (!ok) continue;
      this.trees.push(this.makeTree(x, z));
    }
  };

  Forest.prototype.makeTree = function (x, z) {
    const h = rand(11, 19);
    const r = rand(3.3, 5.6);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = Math.random() * Math.PI * 2;

    const hue = rand(0.24, 0.35);
    const base = new THREE.Color().setHSL(hue, rand(0.36, 0.54), rand(0.17, 0.27));
    const bark = new THREE.MeshLambertMaterial({ map: this.barkTex, color: new THREE.Color().setHSL(0.07, 0.34, rand(0.17, 0.26)) });
    const trunk = new THREE.Mesh(this.geoTrunk, bark);
    trunk.scale.set(r * 0.3, h * 0.72, r * 0.3);
    g.add(trunk);

    const canopyMat = new THREE.MeshLambertMaterial({
      color: base.clone(), flatShading: true,
      emissive: new THREE.Color(0x1a0b02), emissiveIntensity: 0.0
    });

    const canopy = new THREE.Group();
    const blobs = [];
    const nBlobs = 3 + ((Math.random() * 2) | 0);
    for (let i = 0; i < nBlobs; i++) {
      const blob = new THREE.Mesh(this.geoBlob, canopyMat);
      const s = r * rand(0.62, 0.95);
      blob.scale.set(s, s * rand(0.72, 0.94), s);
      blob.position.set(rand(-0.5, 0.5) * r, h * rand(0.62, 0.9), rand(-0.5, 0.5) * r);
      blob.rotation.set(Math.random(), Math.random(), Math.random());
      canopy.add(blob);
      blobs.push(blob);
    }
    g.add(canopy);

    this.group.add(g);

    const tree = {
      x: x, z: z, h: h, r: r,
      group: g, trunk: trunk, canopy: canopy, canopyMat: canopyMat, barkMat: bark,
      baseColor: base.clone(),
      hp: 100, fire: 0, state: "alive",
      palm: null, palmT: 0, palmTarget: 0,
      scorch: 0, seed: Math.random()
    };
    return tree;
  };

  /* ground cover: grass tufts, bushes, rocks and one soft shadow
     disc per tree. Every one of these is a single instanced draw,
     so a dense-looking floor stays cheap. */
  Forest.prototype.scatter = function (stage) {
    /* tree shadows first — they sit under everything */
    const shadowGeo = new THREE.CircleGeometry(1, 12);
    const shadows = new THREE.InstancedMesh(shadowGeo, window.BlobShadow.mat(0.5), this.trees.length);
    const sm = new THREE.Matrix4();
    const sq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const sp = new THREE.Vector3();
    const ss = new THREE.Vector3();
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      sp.set(t.x, 0.035, t.z);
      const r = t.r * 1.5;
      ss.set(r, r, 1);
      sm.compose(sp, sq, ss);
      shadows.setMatrixAt(i, sm);
    }
    shadows.count = this.trees.length;
    shadows.frustumCulled = false;
    shadows.renderOrder = 1;
    this.group.add(shadows);

    /* grass tufts */
    const NG = 1100;
    const tuftGeo = new THREE.ConeGeometry(0.085, 1, 3);
    const tuftMat = new THREE.MeshLambertMaterial({ color: 0x3d5a2c });
    const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, NG);
    const tm = new THREE.Matrix4();
    const tq = new THREE.Quaternion();
    const tp = new THREE.Vector3();
    const ts = new THREE.Vector3();
    const te = new THREE.Euler();
    let ti = 0, tguard = 0;
    while (ti < NG && tguard++ < NG * 6) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * (this.radius - 8);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (Math.sqrt(dist2(x, z, this.pond.x, this.pond.z)) < this.pond.r + 1) continue;
      const h = rand(0.4, 1.5);
      tp.set(x, h * 0.5 - 0.05, z);
      te.set(rand(-0.14, 0.14), Math.random() * 6.28, rand(-0.14, 0.14));
      tq.setFromEuler(te);
      ts.set(rand(0.7, 1.5), h, rand(0.7, 1.5));
      tm.compose(tp, tq, ts);
      tufts.setMatrixAt(ti++, tm);
    }
    tufts.count = ti;
    tufts.frustumCulled = false;
    this.group.add(tufts);

    const NB = 180, NR = 60;
    const bushGeo = this.geoBush;
    const bushes = new THREE.InstancedMesh(bushGeo, this.matBush, NB);
    const rocks = new THREE.InstancedMesh(this.geoRock, this.matRock, NR);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const e = new THREE.Euler();

    let i = 0, guard = 0;
    while (i < NB && guard++ < 3000) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * (this.radius - 14);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (Math.sqrt(dist2(x, z, this.pond.x, this.pond.z)) < this.pond.r + 1) continue;
      if (Math.sqrt(dist2(x, z, this.post.x, this.post.z)) < this.post.r - 3) continue;
      if (Math.sqrt(dist2(x, z, this.hpad.x, this.hpad.z)) < this.hpad.r + 1) continue;
      p.set(x, 0.5 - Math.random() * 0.2, z);
      e.set(0, Math.random() * 6.28, 0);
      q.setFromEuler(e);
      const base = rand(1.4, 3.4);
      s.set(base, base * rand(0.45, 0.8), base);
      m.compose(p, q, s);
      bushes.setMatrixAt(i++, m);
    }
    bushes.count = i;
    bushes.frustumCulled = false;
    this.group.add(bushes);

    i = 0; guard = 0;
    while (i < NR && guard++ < 2000) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * (this.radius - 10);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (Math.sqrt(dist2(x, z, this.post.x, this.post.z)) < this.post.r) continue;
      p.set(x, rand(0.2, 0.8), z);
      e.set(Math.random(), Math.random() * 6.28, Math.random());
      q.setFromEuler(e);
      const base = rand(1.1, 3.2);
      s.set(base, base * rand(0.5, 0.9), base);
      m.compose(p, q, s);
      rocks.setMatrixAt(i++, m);
    }
    rocks.count = i;
    rocks.frustumCulled = false;
    this.group.add(rocks);
  };

  Forest.prototype.buildDrums = function () {
    const spots = [
      { x: 46, z: 26 }, { x: -26, z: -58 }, { x: 34, z: -80 },
      { x: 92, z: -26 }, { x: -104, z: -18 }, { x: 6, z: 96 }
    ];
    for (let i = 0; i < spots.length; i++) {
      const p = spots[i];
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      const drum = new THREE.Mesh(this.geoDrum, this.matDrum);
      drum.position.y = 1.3;
      g.add(drum);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.1, 5, 12), this.matDrumRim);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 2.55;
      g.add(rim);
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.09, 5, 12), this.matDrumRim);
      band.rotation.x = Math.PI / 2;
      band.position.y = 1.5;
      g.add(band);
      /* a small stake light so drums read from far away */
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0x7fd9ff })
      );
      lamp.position.set(0, 3.1, 0);
      g.add(lamp);
      this.group.add(g);
      this.drums.push({ x: p.x, z: p.z, r: 5.5, group: g });
    }
  };

  /* ---------------------------------------------------------- fire */
  Forest.prototype.ignite = function (tree, power, silent) {
    if (!tree || tree.state !== "alive") return false;
    tree.state = "burning";
    tree.fire = clamp(power || 0.35, 0.18, 1);
    tree.burnT = 0;
    this.burningList.push(tree);
    if (!silent) {
      if (window.Audio2) Audio2.sfx("ignite");
      FX.burst(new THREE.Vector3(tree.x, tree.h * 0.55, tree.z), 0xff7a2c, 8, { speed: 9, life: 0.6, size: 1.4 });
      FX.shake(0.06);
    }
    return true;
  };

  Forest.prototype.extinguish = function (tree, amount) {
    if (!tree || tree.state !== "burning") return false;
    tree.fire -= amount;
    tree.hp = Math.min(100, tree.hp + amount * 4.5);
    FireFX.steamPuff({ x: tree.x, y: tree.h * 0.45, z: tree.z }, 3 + ((amount * 7) | 0), 2.6);
    if (tree.fire <= 0.04) {
      tree.fire = 0;
      tree.state = "alive";
      this._removeBurning(tree);
      /* the fire is out: stop glowing and let the leaves come back,
         but keep a scorch mark proportional to the damage taken */
      tree.canopyMat.emissive.setRGB(0.02, 0.01, 0.005);
      tree.canopyMat.emissiveIntensity = 0;
      const hp01 = Math.max(0, tree.hp) / 100;
      tree.canopyMat.color.copy(tree.baseColor).lerp(new THREE.Color(0x2a1c10), (1 - hp01) * 0.5);
      FireFX.smokePuff(tree.x, tree.h * 0.6, tree.z, 4, 1);
      if (window.Audio2) Audio2.sfx("steam");
      return true;
    }
    return false;
  };

  /* scorched earth: pooled decals so burnt land reads at a glance */
  Forest.prototype.addScorch = function (x, z, r) {
    if (!this._scorchGeo) {
      this._scorchGeo = new THREE.CircleGeometry(1, 16);
      this._scorchMat = new THREE.MeshBasicMaterial({
        color: 0x0b0906, transparent: true, opacity: 0.58, depthWrite: false
      });
      this._scorches = [];
      this._scorchIdx = 0;
    }
    let m;
    if (this._scorches.length < 80) {
      m = new THREE.Mesh(this._scorchGeo, this._scorchMat);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
      this.scene.add(m);
      this._scorches.push(m);
    } else {
      m = this._scorches[this._scorchIdx];
      this._scorchIdx = (this._scorchIdx + 1) % this._scorches.length;
    }
    m.position.set(x, 0.04, z);
    m.rotation.z = Math.random() * Math.PI;
    m.scale.set(r, r * (0.75 + Math.random() * 0.5), 1);
    m.visible = true;
  };

  Forest.prototype.burnDown = function (tree) {
    if (!tree || tree.state !== "burning") return;
    tree.state = "burnt";
    tree.fire = 0;
    tree.hp = 0;
    this._removeBurning(tree);
    tree.canopy.visible = false;
    tree.trunk.scale.y = tree.h * 0.34;
    tree.barkMat.color.setHex(0x241d18);
    tree.barkMat.emissive = new THREE.Color(0x000000);
    FireFX.smokePuff(tree.x, tree.h * 0.3, tree.z, 6, 1);
    FireFX.ember(tree.x, tree.h * 0.3, tree.z, 6, tree.canopyR || 2.6);
    this.addScorch(tree.x, tree.z, 2.2 + Math.random() * 1.8);
    FX.burst(new THREE.Vector3(tree.x, tree.h * 0.35, tree.z), 0x2a2520, 12, { speed: 6, life: 1.2, size: 1.2 });
    if (this.onBurnOut) this.onBurnOut(tree);
  };

  Forest.prototype._removeBurning = function (tree) {
    const i = this.burningList.indexOf(tree);
    if (i >= 0) this.burningList.splice(i, 1);
  };

  /* water in a radius: used by splashes, heli drops and the boss soak */
  Forest.prototype.waterAt = function (x, z, radius, amount) {
    let hits = 0;
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      if (t.state !== "burning") continue;
      const d = Math.sqrt(dist2(x, z, t.x, t.z));
      if (d > radius) continue;
      const fall = 1 - (d / radius) * 0.6;
      this.extinguish(t, amount * fall);
      hits++;
    }
    return hits;
  };

  Forest.prototype.igniteNear = function (x, z, radius, power, max) {
    const cand = [];
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      if (t.state !== "alive") continue;
      const d = Math.sqrt(dist2(x, z, t.x, t.z));
      if (d <= radius) cand.push({ t: t, d: d });
    }
    cand.sort(function (a, b) { return a.d - b.d; });
    let n = 0;
    for (let i = 0; i < cand.length && n < (max || 2); i++) {
      if (this.ignite(cand[i].t, power, true)) n++;
    }
    return n;
  };

  /* the slow tick: fire creeps tree to tree, downwind faster */
  Forest.prototype.spread = function (dt) {
    this.spreadT += dt;
    const every = this.stage.spreadEvery || 0.7;
    if (this.spreadT < every) return;
    this.spreadT = 0;

    const burners = this.burningList;
    const maxIgnite = this.stage.maxSpread || 2;
    let ignited = 0;
    for (let i = 0; i < burners.length; i++) {
      if (ignited >= maxIgnite) break;
      const t = burners[i];
      if (t.fire < 0.55) continue;
      if (Math.random() > (this.stage.spreadChance || 0.16)) continue;

      let best = null, bestScore = 0;
      for (let j = 0; j < this.trees.length; j++) {
        const o = this.trees[j];
        if (o.state !== "alive") continue;
        const dx = o.x - t.x, dz = o.z - t.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > (this.stage.spreadR || 21)) continue;
        if (d < 0.001) continue;
        const dot = (dx / d) * this._wind.x + (dz / d) * this._wind.y;
        const wind = 0.55 + Math.max(0, dot) * 1.1;
        const score = (1 - d / (this.stage.spreadR || 21)) * wind * (0.6 + Math.random());
        if (score > bestScore) { bestScore = score; best = o; }
      }
      if (best && bestScore > 0.2) {
        if (this.ignite(best, 0.28 + Math.random() * 0.2)) ignited++;
      }
    }
  };

  /* ---------------------------------------------------------- sawit */
  Forest.prototype.plantSawit = function (tree) {
    if (!tree || tree.state !== "burnt") return false;
    tree.state = "sawit";
    tree.palmT = 0;
    tree.palmTarget = 1;

    if (!tree.palm) {
      const palm = new THREE.Group();
      palm.position.set(tree.x, 0, tree.z);
      palm.rotation.y = Math.random() * Math.PI * 2;

      const trunkH = rand(10, 14);
      const trunk = new THREE.Mesh(this.geoPalmTrunk, this.matPalmTrunk);
      trunk.scale.set(1.1, trunkH, 1.1);
      palm.add(trunk);

      const crown = new THREE.Group();
      crown.position.y = trunkH;
      for (let i = 0; i < PALM_FRONDS; i++) {
        const pivot = new THREE.Group();
        pivot.rotation.y = (i / PALM_FRONDS) * Math.PI * 2 + rand(-0.1, 0.1);
        const frond = new THREE.Mesh(this.geoFrond, this.matFrond);
        frond.position.set(0, 0, 2.65);
        frond.rotation.x = 0.22 + Math.random() * 0.2;
        frond.rotation.z = rand(-0.1, 0.1);
        pivot.add(frond);
        crown.add(pivot);
      }
      const fruit = new THREE.Mesh(this.geoFruit, this.matFruit);
      fruit.position.set(0, -0.7, 0.9);
      crown.add(fruit);
      palm.add(crown);

      palm.scale.setScalar(0.001);
      this.group.add(palm);
      tree.palm = palm;
      tree.palmCrown = crown;
      this.palms.push(tree);
    }
    tree.palm.visible = true;
    tree.group.visible = false;
    FX.burst(new THREE.Vector3(tree.x, 1, tree.z), 0x6f8a3a, 8, { speed: 4, life: 0.8, size: 1 });
    return true;
  };

  /* hammer a palm back down to bare burnt ground */
  Forest.prototype.clearSawit = function (tree) {
    if (!tree || tree.state !== "sawit") return false;
    tree.state = "burnt";
    tree.palmTarget = 0;
    tree.palmT = 0;
    tree.group.visible = true;
    const i = this.palms.indexOf(tree);
    if (i >= 0) this.palms.splice(i, 1);
    FX.burst(new THREE.Vector3(tree.x, 5, tree.z), 0x8aa04a, 16, { speed: 8, life: 1.0, size: 1.4 });
    if (window.Audio2) Audio2.sfx("thud");
    return true;
  };

  Forest.prototype.sawitGrowth = function (dt) {
    for (let i = 0; i < this.palms.length; i++) {
      const t = this.palms[i];
      t.palmT = Math.min(1, t.palmT + dt / 4.5);
      const s = 0.12 + (1 - Math.pow(1 - t.palmT, 2)) * 0.88;
      if (t.palm) t.palm.scale.setScalar(s);
    }
    /* cleared palms shrink away then vanish */
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      if (t.state !== "burnt" || !t.palm || !t.palm.visible) continue;
      t.palmT = Math.max(0, t.palmT - dt / 1.2);
      if (t.palmT <= 0.01) t.palm.visible = false;
      else t.palm.scale.setScalar(0.12 + t.palmT * 0.88);
    }
  };

  /* ---------------------------------------------------------- queries */
  Forest.prototype.stats = function () {
    let alive = 0, burning = 0, burnt = 0, sawit = 0;
    for (let i = 0; i < this.trees.length; i++) {
      const s = this.trees[i].state;
      if (s === "alive") alive++;
      else if (s === "burning") burning++;
      else if (s === "burnt") burnt++;
      else if (s === "sawit") sawit++;
    }
    const total = this.trees.length || 1;
    return {
      total: total, alive: alive, burning: burning, burnt: burnt, sawit: sawit,
      forestPct: alive / total,
      burntPct: (burnt + sawit) / total,
      sawitPct: sawit / total
    };
  };

  Forest.prototype.nearestBurning = function (x, z, maxD) {
    let best = null, bd = maxD * maxD;
    for (let i = 0; i < this.burningList.length; i++) {
      const t = this.burningList[i];
      const d = dist2(x, z, t.x, t.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  };

  Forest.prototype.nearestTree = function (x, z, filter, maxD) {
    let best = null, bd = (maxD || 999) * (maxD || 999);
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      if (filter && !filter(t)) continue;
      const d = dist2(x, z, t.x, t.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  };

  Forest.prototype.nearestBurnt = function (x, z, maxD) {
    return this.nearestTree(x, z, function (t) { return t.state === "burnt"; }, maxD || 999);
  };

  Forest.prototype.randomAlive = function (nearX, nearZ) {
    const alive = [];
    for (let i = 0; i < this.trees.length; i++) if (this.trees[i].state === "alive") alive.push(this.trees[i]);
    if (!alive.length) return null;
    if (nearX === undefined) return alive[(Math.random() * alive.length) | 0];
    /* favour trees near the requested point but not right on top */
    let best = null, bs = -1;
    for (let i = 0; i < Math.min(24, alive.length); i++) {
      const t = alive[(Math.random() * alive.length) | 0];
      const d = Math.sqrt(dist2(nearX, nearZ, t.x, t.z));
      const s = 1 / (1 + Math.abs(d - 45));
      if (s > bs) { bs = s; best = t; }
    }
    return best;
  };

  Forest.prototype.isInWater = function (x, z) {
    return dist2(x, z, this.pond.x, this.pond.z) < (this.pond.r - 1.5) * (this.pond.r - 1.5);
  };

  Forest.prototype.isNearDrum = function (x, z) {
    for (let i = 0; i < this.drums.length; i++) {
      const d = this.drums[i];
      if (dist2(x, z, d.x, d.z) < d.r * d.r) return true;
    }
    return false;
  };

  Forest.prototype.waterSource = function (x, z) {
    if (this.isInWater(x, z)) return "pond";
    if (this.isNearDrum(x, z)) return "drum";
    return null;
  };

  /* ---------------------------------------------------------- update */
  Forest.prototype.update = function (dt, camera) {
    this.time += dt;
    const cam = camera ? camera.position : null;

    /* animate the flag and pond very cheaply */
    if (this.flag) this.flag.rotation.y = Math.sin(this.time * 1.6) * 0.24;

    const burnRate = (this.stage && this.stage.burnRate) || 6.4;

    for (let i = this.burningList.length - 1; i >= 0; i--) {
      const t = this.burningList[i];
      if (t.state !== "burning") { this.burningList.splice(i, 1); continue; }

      t.fire = Math.min(1, t.fire + dt * 0.2);
      t.hp -= dt * burnRate * (0.45 + t.fire * 0.75);
      t.burnT = (t.burnT || 0) + dt;

      /* canopy chars and glows */
      const hp01 = Math.max(0, t.hp) / 100;
      const scorch = 1 - hp01;
      t.canopyMat.color.copy(t.baseColor).lerp(new THREE.Color(0x2a1c10), scorch * 0.85);
      t.canopyMat.emissive.setRGB(
        Math.min(1, t.fire * 0.95),
        Math.min(1, t.fire * 0.26),
        0.012
      );
      t.canopyMat.emissiveIntensity = 0.85 + t.fire * 0.5;

      const d2cam = cam ? dist2(t.x, t.z, cam.x, cam.z) : 0;
      if (!cam || d2cam < 230 * 230) {
        FireFX.treeFlame(t.x, t.h * 0.74, t.z, t.fire, dt);
        FireFX.smokePuff(t.x, t.h * 0.66, t.z, 3.2 + t.fire * 2.4, dt);
        if (t.fire > 0.55) FireFX.groundFlame(t.x, t.z, 2.4, dt * 0.6);
      }

      if (t.hp <= 0) this.burnDown(t);
    }

    this.spread(dt);
    this.sawitGrowth(dt);

    /* hand the four lights to the biggest nearby fires */
    this._lamp.length = 0;
    for (let i = 0; i < this.burningList.length; i++) {
      const t = this.burningList[i];
      if (cam && dist2(t.x, t.z, cam.x, cam.z) > 260 * 260) continue;
      this._lamp.push({ x: t.x, y: t.h * 0.5, z: t.z, intensity: t.fire });
    }
    FireFX.updateLights(this._lamp, camera);
  };

  /* the boss wants a target: the healthiest clump of trees */
  Forest.prototype.healthySpot = function (fromX, fromZ) {
    let best = null, bs = -1;
    for (let i = 0; i < 26; i++) {
      const t = this.trees[(Math.random() * this.trees.length) | 0];
      if (!t || t.state !== "alive") continue;
      let n = 0;
      for (let j = 0; j < this.trees.length; j++) {
        const o = this.trees[j];
        if (o.state === "alive" && dist2(o.x, o.z, t.x, t.z) < 34 * 34) n++;
      }
      const d = fromX === undefined ? 0 : Math.sqrt(dist2(fromX, fromZ, t.x, t.z));
      const score = n * 1.2 - d * 0.06 + Math.random();
      if (score > bs) { bs = score; best = t; }
    }
    return best;
  };

  /* ---------------------------------------------------------- clear */
  Forest.prototype.clear = function () {
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const o = this.group.children[i];
      this.group.remove(o);
    }
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      if (t.canopyMat) t.canopyMat.dispose();
      if (t.barkMat) t.barkMat.dispose();
    }
    this.trees.length = 0;
    this.drums.length = 0;
    this.palms.length = 0;
    this.burningList.length = 0;
    this._lamp.length = 0;
    /* shared geometries/materials stay alive for the next stage */
  };

  Forest.prototype.dispose = function () {
    this.clear();
    this.scene.remove(this.group);
  };

  window.Forest = Forest;
  window.ForestUtil = { rand: rand, dist2: dist2, clamp: clamp };
})();
