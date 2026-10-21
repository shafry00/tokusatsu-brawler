/* ============================================================
   orang.js — the ranger is an orangutan
   ------------------------------------------------------------
   `orang-utan.glb` ships one long idle clip and a full skeleton,
   but no walk, no jump and no attack. So the mixer plays the idle
   and a thin procedural layer sits on top of it: thigh/knee/arm
   swings are multiplied into the bone quaternions after the mixer
   has written the pose, plus a lean, a bob and a lumbering yaw.

   The engine's Player expects a bone named "Head", "spine_03",
   "hand_r" and "hand_l"; the scan calls them Head_14, Spine1_23,
   RightHand_9, LeftHand_19. Aliases are added as empty children so
   the props ride the real bones without touching the clip bindings.
   ============================================================ */
(function () {
  "use strict";

  const BASE = window.MODEL_BASE || "assets/models/";
  const FILE = "orang-utan.glb";

  const O = { ready: false, failed: false, progress: 0 };

  let gltf = null;
  let spawned = false;

  O.load = function (cb) {
    return new Promise(function (res) {
      if (!window.THREE || !THREE.GLTFLoader) { O.failed = true; return res(false); }
      new THREE.GLTFLoader().load(
        BASE + FILE,
        function (g) {
          gltf = g;
          O.ready = !!(g && g.scene);
          O.progress = 1;
          if (cb) cb(O.ready);
          res(O.ready);
        },
        function (p) { if (p && p.total) O.progress = p.loaded / p.total; },
        function (e) {
          console.warn("[orang] load failed", e);
          O.failed = true;
          if (cb) cb(false);
          res(false);
        }
      );
    });
  };

  /* an empty child that carries an engine-familiar name */
  function alias(bone, name) {
    if (!bone) return null;
    const o = new THREE.Object3D();
    o.name = name;
    bone.add(o);
    return o;
  }

  const AX = new THREE.Vector3(1, 0, 0);
  const _q = new THREE.Quaternion();

  function build(height) {
    const root = gltf.scene;
    root.traverse(function (o) {
      if (o.isMesh) {
        /* skinned bounds are the bind pose; culling them pops the ape
           out of frame mid-stride */
        o.frustumCulled = false;
      }
    });

    /* --- scale so the ape is exactly `height` tall, feet on zero --- */
    let box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const s = height / (size.y || 1);
    root.scale.setScalar(s);
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    root.position.y -= box.min.y;

    const inner = new THREE.Group();
    inner.add(root);
    const group = new THREE.Group();
    group.add(inner);

    /* --- clip --- */
    const mixer = new THREE.AnimationMixer(root);
    const clip = gltf.animations && gltf.animations[0];
    let action = null;
    if (clip) {
      action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
    }

    /* --- bones --- */
    const head = root.getObjectByName("Head_14");
    alias(head, "Head");
    alias(root.getObjectByName("Spine1_23"), "spine_03");
    alias(root.getObjectByName("RightHand_9"), "hand_r");
    alias(root.getObjectByName("LeftHand_19"), "hand_l");

    const legs = [];
    [["LeftUpLeg_2", "LeftLeg_1", 0], ["RightUpLeg_5", "RightLeg_4", Math.PI]].forEach(function (d) {
      const up = root.getObjectByName(d[0]);
      const lo = root.getObjectByName(d[1]);
      if (up && lo) legs.push({ up: up, lo: lo, ph: d[2] });
    });
    const arms = [];
    [["LeftArm_21", Math.PI], ["RightArm_11", 0]].forEach(function (d) {
      const a = root.getObjectByName(d[0]);
      if (a) arms.push({ b: a, ph: d[1] });
    });

    const A = {
      group: group,
      inner: inner,
      root: root,
      mixer: mixer,
      action: action,
      isApe: true,
      yaw: 0,
      dead: false,
      turnRate: 9,

      _speed: 0,
      _grounded: true,
      _phase: Math.random() * 6.28,
      _t: 0,
      _slot: null,
      _slotT: 0,
      _slotDur: 0,
      _deadT: 0,
      _height: height,

      setPos: function (x, y, z) { group.position.set(x, y, z); },

      setState: function (st) {
        if (!st) return;
        if (st.speed !== undefined) this._speed = st.speed;
        if (st.grounded !== undefined) this._grounded = st.grounded;
      },

      oneShot: function (slot, lock) {
        if (this.dead) return false;
        if (slot === "slash") { this._slot = "slash"; this._slotT = 0.42; this._slotDur = 0.42; }
        else if (slot === "jump") { this._slot = "jump"; this._slotT = 0.3; this._slotDur = 0.3; }
        else if (slot === "land") { this._slot = "land"; this._slotT = 0.28; this._slotDur = 0.28; }
        else if (slot === "roll") { this._slot = "roll"; this._slotT = 0.5; this._slotDur = 0.5; }
        return true;
      },

      update: function (dt) {
        this._t += dt;
        if (this._slotT > 0) this._slotT = Math.max(0, this._slotT - dt);
        if (this.dead) this._deadT += dt;

        /* the idle clip speeds up with the stride so the mass keeps
           moving while the legs are doing the real work below */
        const sp = this._speed;
        if (this.action) {
          let ts = 1;
          if (sp > 0.5 && this._grounded) ts = 1.2 + Math.min(1.2, sp / 8);
          this.action.setEffectiveTimeScale(ts);
        }
        if (this.mixer) this.mixer.update(dt);

        /* --- procedural stride, layered on the clip --- */
        const moving = sp > 0.45 && this._grounded && !this.dead;
        const amp = moving ? Math.min(1, 0.35 + sp / 10) : 0;
        if (moving) this._phase += dt * (2.4 + sp * 0.62);

        if (amp > 0.001) {
          for (let i = 0; i < legs.length; i++) {
            const L = legs[i];
            const sw = Math.sin(this._phase + L.ph) * 0.5 * amp;
            _q.setFromAxisAngle(AX, sw);
            L.up.quaternion.multiply(_q);
            const kn = Math.max(0, -Math.sin(this._phase + L.ph + 0.55)) * 0.75 * amp;
            _q.setFromAxisAngle(AX, kn);
            L.lo.quaternion.multiply(_q);
          }
          for (let i = 0; i < arms.length; i++) {
            const m = arms[i];
            const sw = Math.sin(this._phase + m.ph) * 0.42 * amp;
            _q.setFromAxisAngle(AX, sw);
            m.b.quaternion.multiply(_q);
          }
        }

        /* --- hammer: the whole right arm winds up and chops --- */
        if (this._slot === "slash" && this._slotT > 0 && arms.length) {
          const p = 1 - this._slotT / this._slotDur;
          const swing = Math.sin(Math.min(1, p * 1.15) * Math.PI);
          _q.setFromAxisAngle(AX, -1.5 * swing);
          const right = arms[1] ? arms[1].b : null;
          if (right) right.quaternion.multiply(_q);
        }

        /* --- body --- */
        let bob = 0, lean = 0, roll = 0, squash = 1;
        if (this.dead) {
          roll = Math.min(1, this._deadT * 2.2) * -Math.PI * 0.5;
          bob = -Math.min(1, this._deadT * 2.2) * 0.12;
        } else if (moving) {
          bob = Math.abs(Math.sin(this._phase)) * 0.055 * amp;
          lean = 0.05 + Math.min(0.12, sp * 0.012);
          roll = Math.sin(this._phase) * 0.035 * amp;
        } else {
          bob = Math.sin(this._t * 1.5) * 0.008;
        }
        if (this._slotT > 0) {
          const p = 1 - this._slotT / this._slotDur;
          if (this._slot === "jump") bob += Math.sin(p * Math.PI) * 0.16;
          else if (this._slot === "land") squash = 1 - Math.sin(p * Math.PI) * 0.12;
          else if (this._slot === "roll") lean += p * Math.PI * 2;
        }

        this.inner.position.y = bob * height;
        this.inner.rotation.x = lean;
        this.inner.rotation.z = roll;
        this.inner.scale.y = squash;

        /* heading */
        let d = this.yaw - group.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        group.rotation.y += d * Math.min(1, dt * this.turnRate);
      }
    };

    return A;
  }

  O.create = function (opt) {
    opt = opt || {};
    if (!O.ready || spawned) return null;
    spawned = true;
    try {
      return build(opt.height || 4.4);
    } catch (e) {
      console.warn("[orang] actor failed", e);
      return null;
    }
  };

  window.Orang = O;
})();
