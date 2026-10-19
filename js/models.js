/* ============================================================
   models.js — rigged 3D characters
   ------------------------------------------------------------
   Loads skeletal GLB characters and drives them with
   THREE.AnimationMixer. The exposed surface is a superset of the
   2.5D sprite Actor in sprites.js, so the rest of the game does
   not care which one it got:

     group · yaw · A{sx,sy,slide,tilt} · bobAmp · groundY · dead
     update(dt, camera) · setPos/pos · hitFlash · setTint
     setState({speed, grounded}) · oneShot(slot, lock, rate)

   Heroes share one 65-joint "Universal Rig" mesh and are animated
   by the Universal Animation Library, whose clips address the rig
   by bone name — so no retargeting is needed, the clips simply
   bind to whichever hero clone plays them.

   Assets:
     hero.glb / anim-ual.glb             · the hero mesh is built from the
       local Ultraman Tiga statue kit, reskinned onto the 65-joint
       Universal Rig and painted per-vertex; the clips are the Universal
       Animation Library retargeted onto that rig. The statue kit is
       fan-made and marked study/exchange only — no commercial use.
     "Universal Animation Library"       · Quaternius (CC0 1.0)
     "Ultimate Monsters" / "Animated Animals" · Quaternius (CC0 1.0)
     "Skeleton Character Pack"          · KayKit (Kay Lousberg) (CC0 1.0)
     mirror: https://github.com/Dallolz/moorfall-assets

   Kaiju:
     The ten kaiju are Ultraman-universe models downloaded from Sketchfab
     (all CC-BY: credit required, commercial use allowed — see CREDITS.md)
     and animated by retargeting the KayKit clip set onto each model's own
     skeleton, so every kaiju answers to the same nine slot patterns. Each
     keeps its own authored skin weights and textures, hence tint 0xffffff.
   Originals that shipped before the reskin are kept in assets/_orig/.
   ============================================================ */
(function () {
  const M = { ready: false, cache: {}, failed: {}, anims: null };
  const BASE = "assets/models/";

  /* -------- hero roles: one mesh, tinted/recoloured per character ------- */
  /* accent  = the red/blue/violet plates of the classic Ultra suits
     eyes    = the glowing eye colour
     build   = small height variation so the five read as different people */
  const HERO = {
    player: { accent: 0xd6362c, eyes: 0xfff0a0, build: 1.00, body: 0xffffff },
    zero:   { accent: 0x2f7fd8, eyes: 0xbfeaff, build: 0.99, body: 0xcfe2ff },
    seven:  { accent: 0xd9a12c, eyes: 0xffeaa0, build: 1.02, body: 0xffe9cc },
    mebius: { accent: 0xef6a2a, eyes: 0xffd8a0, build: 0.97, body: 0xffdcc6 },
    tiga:   { accent: 0x7b52d9, eyes: 0xe2ccff, build: 1.03, body: 0xdccdff },
  };

  /* -------- kaiju: one downloaded model per role, all driven by the
     KayKit clip set (family "kaykit"), each showing its own textures ------
     species → model, with the stand-ins used where the exact species was
     not available as a downloadable rigged model:
       jamila  → Jamila          bemular → Bemular
       redking → Red King        birdon  → Birdon
       baltan  → Alien Baltan    kingjoe → King Joe
       gomora  → Gomora          zetton  → Zetton
       eleking → Tyrant          (no Eleking model; both Showa-era kaiju)
       golza   → Silvergon       (no Golza model; both Tiga-era kaiju) */
  const KAIJU = {
    kaiju_jamila:  { file: "kaiju-frog",     family: "kaykit", tint: 0xffffff },
    kaiju_bemular: { file: "kaiju-mushroom", family: "kaykit", tint: 0xffffff },
    kaiju_redking: { file: "kaiju-orc",      family: "kaykit", tint: 0xffffff },
    kaiju_birdon:  { file: "kaiju-demon",    family: "kaykit", tint: 0xffffff },
    kaiju_baltan:  { file: "kaiju-bluedemon",family: "kaykit", tint: 0xffffff },
    kaiju_eleking: { file: "kaiju-squid",    family: "kaykit", tint: 0xffffff },
    kaiju_golza:   { file: "kaiju-bull",     family: "kaykit", tint: 0xffffff },
    kaiju_kingjoe: { file: "kaiju-skeleton", family: "kaykit", tint: 0xffffff },
    kaiju_gomora:  { file: "kaiju-tribal",   family: "kaykit", tint: 0xffffff },
    kaiju_zetton:  { file: "kaiju-dragon",   family: "kaykit", tint: 0xffffff },
  };

  /* -------- clip-name patterns per rig family --------------------------
     First pattern that matches a clip name wins, so a rig that lacks a
     slot falls through to a close relative instead of breaking.        */
  const FAMILIES = {
    kaykit: {
      idle:  [/Idle$/i],
      walk:  [/Walk$/i],
      run:   [/Run$/i, /Walk$/i],
      jump:  [/Jump$/i],
      air:   [/Jump$/i],
      atk1:  [/Punch$/i, /Weapon$/i],
      atk2:  [/Weapon$/i, /Punch$/i],
      hit:   [/HitReact$/i, /HitRecieve$/i],
      death: [/Death$/i],
    },
    beast: {
      idle:  [/^Idle$/i, /^Idle_2$/i],
      walk:  [/^Walk$/i],
      run:   [/^Gallop$/i, /^Walk$/i],
      jump:  [/^Gallop$/i],
      air:   [/^Gallop$/i],
      atk1:  [/^Attack_Headbutt$/i, /^Attack$/i],
      atk2:  [/^Attack_Kick$/i, /^Attack$/i],
      hit:   [/Idle_HitReact/i],
      death: [/^Death$/i],
    },
    wyvern: {
      idle:  [/Flying_Idle$/i, /Idle$/i],
      walk:  [/Fast_Flying$/i, /Flying_Idle$/i],
      run:   [/Fast_Flying$/i, /Flying_Idle$/i],
      jump:  [/Fast_Flying$/i],
      air:   [/Fast_Flying$/i],
      atk1:  [/Punch$/i, /Headbutt$/i],
      atk2:  [/Headbutt$/i, /Punch$/i],
      hit:   [/HitReact$/i],
      death: [/Death$/i],
    },
    skeleton: {
      idle:  [/^Idle_Combat$/i, /^Idle$/i],
      walk:  [/^Walking_A$/i, /^Walking_B$/i],
      run:   [/^Running_A$/i, /^Running_B$/i],
      jump:  [/^Running_A$/i],
      air:   [/^Running_A$/i],
      atk1:  [/1H_Melee_Attack_Chop/i, /1H_Melee_Attack_/i],
      atk2:  [/2H_Melee_Attack_/i, /1H_Melee_Attack_Slice/i, /1H_Melee_Attack_/i],
      beam:  [/Spellcast_Shoot/i, /Spellcast_Raise/i],
      hit:   [/^Hit_A$/i, /^Hit_B$/i],
      death: [/^Death_A$/i, /^Death_B$/i],
    },
    /* the hero's own library (Universal Animation Library) */
    hero: {
      idle:  [/^Idle_Loop$/],
      walk:  [/^Walk_Loop$/],
      run:   [/^Jog_Fwd_Loop$/, /^Sprint_Loop$/],
      jump:  [/^Jump_Start$/],
      air:   [/^Jump_Loop$/],
      land:  [/^Jump_Land$/],
      atk1:  [/^Punch_Jab$/],
      atk2:  [/^Punch_Cross$/],
      slash: [/^Sword_Attack$/],
      beam:  [/^Spell_Simple_Shoot$/],
      hit:   [/^Hit_Chest$/, /^Hit_Head$/],
      death: [/^Death01$/],
      roll:  [/^Roll$/],
    },
  };

  /* clips that must not loop */
  const ONCE = { jump: 1, land: 1, atk1: 1, atk2: 1, slash: 1, beam: 1, hit: 1, death: 1, roll: 1 };

  const clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

  /* ---------------- environment map ----------------
     A tiny procedural equirect sky + sun blob run through PMREM.
     Metal without an environment map reads as flat black, and the
     silver hero body is metallic.                               */
  M.buildEnv = function (renderer) {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 32;
    const g = c.getContext("2d");
    const sky = g.createLinearGradient(0, 0, 0, 32);
    sky.addColorStop(0.00, "#8fb6ff");
    sky.addColorStop(0.42, "#e8f1ff");
    sky.addColorStop(0.52, "#7c8698");
    sky.addColorStop(1.00, "#252a33");
    g.fillStyle = sky; g.fillRect(0, 0, 64, 32);
    const sun = g.createRadialGradient(14, 5, 0, 14, 5, 13);
    sun.addColorStop(0, "rgba(255,255,255,1)");
    sun.addColorStop(0.4, "rgba(255,244,214,0.55)");
    sun.addColorStop(1, "rgba(255,244,214,0)");
    g.fillStyle = sun; g.beginPath(); g.arc(14, 5, 13, 0, 7); g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromEquirectangular(tex);
    pmrem.dispose();
    tex.dispose();
    return rt.texture;
  };

  /* ---------------- hero suit recolour ----------------
     The base character is a bare-chested human. Ultraman is a
     silver giant with a single accent colour, so warm skin tones
     are folded to a cool silver (luminance preserved, so the
     sculpted muscle shading survives) and the dark trunks/gear
     take the character's accent colour.                          */
  function rgbFromHex(hex) {
    return { r: (hex >> 16 & 255) / 255, g: (hex >> 8 & 255) / 255, b: (hex & 255) / 255 };
  }

  const _skinCache = new Map();     // source texture -> { "accent:body": CanvasTexture }
  function heroSuit(tex, accent, body) {
    const img = tex && tex.image;
    if (!img || !img.width) return null;
    const ck = accent + ":" + body;
    let byKey = _skinCache.get(tex);
    if (byKey && byKey[ck]) return byKey[ck];
    try {
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const id = g.getImageData(0, 0, c.width, c.height);
      const p = id.data;
      const ac = rgbFromHex(accent);
      const bd = rgbFromHex(body);
      for (let i = 0; i < p.length; i += 4) {
        const r = p[i], gr = p[i + 1], b = p[i + 2];
        const mx = Math.max(r, gr, b), mn = Math.min(r, gr, b);
        const l = (0.299 * r + 0.587 * gr + 0.114 * b) / 255;
        const sat = mx > 0 ? (mx - mn) / mx : 0;
        if (l < 0.34 && sat < 0.55) {
          // trunks, boots and belt gear -> the character's accent colour
          const k = 0.55 + l * 1.5;
          p[i] = clamp(ac.r * k, 0, 1) * 255;
          p[i + 1] = clamp(ac.g * k, 0, 1) * 255;
          p[i + 2] = clamp(ac.b * k, 0, 1) * 255;
        } else {
          // skin (and the sculpted highlights) -> brushed silver, with a
          // whisper of the character's own tone so the five are told apart
          const v = clamp(0.10 + l * 1.22, 0, 1);
          p[i] = clamp(v * 0.94 * bd.r, 0, 1) * 255;
          p[i + 1] = clamp(v * 0.975 * bd.g, 0, 1) * 255;
          p[i + 2] = clamp(v * 1.04 * bd.b, 0, 1) * 255;
        }
      }
      g.putImageData(id, 0, 0);
      const nt = new THREE.CanvasTexture(c);
      nt.flipY = tex.flipY;                 // glTF textures are not flipped
      nt.wrapS = tex.wrapS; nt.wrapT = tex.wrapT;
      nt.encoding = tex.encoding;
      nt.anisotropy = tex.anisotropy;
      nt.needsUpdate = true;
      if (!byKey) { byKey = {}; _skinCache.set(tex, byKey); }
      byKey[ck] = nt;
      return nt;
    } catch (e) {
      console.warn("[models] suit recolour skipped", e);
      return null;
    }
  }

  /* ---------------- prep ---------------- */
  function prep(root, kind) {
    root.traverse(function (o) {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      o.frustumCulled = false;             // skinned bounds are unreliable
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (!m) continue;
        m.envMapIntensity = kind === "hero" ? 1.25 : 0.7;
        if (m.side === THREE.DoubleSide) m.shadowSide = THREE.DoubleSide;
      }
    });
  }

  /* ---------------- loading ---------------- */
  let _loader = null;
  const _pending = {};
  function getLoader() { if (!_loader) _loader = new THREE.GLTFLoader(); return _loader; }

  function loadGLB(file) {
    if (_pending[file]) return _pending[file];
    _pending[file] = new Promise(function (res) {
      getLoader().load(BASE + file, function (g) { res(g); },
        undefined,
        function (err) {
          console.warn("[models] failed to load " + file, err);
          M.failed[file] = true;
          res(null);
        });
    });
    return _pending[file];
  }

  /* hero = mesh + the animation library that drives it */
  M.load = function (onProgress) {
    let done = 0, total = 2;
    const tick = function () { done++; if (onProgress) onProgress(done, total); };
    return loadGLB("hero.glb").then(function (g) {
      if (g) {
        prep(g.scene, "hero");
        M.cache.player = { src: g, clips: [], family: "hero", kind: "hero" };
      }
      tick();
      return loadGLB("anim-ual.glb");
    }).then(function (g) {
      M.anims = (g && g.animations) ? g.animations : [];
      if (M.cache.player) M.cache.player.clips = M.anims;
      tick();
      M.ready = !!M.cache.player;
      if (M.cache.player && !M.anims.length) {
        console.warn("[models] hero animation library missing — hero would stand still");
      }
    });
  };

  /* everything except the player, fetched while the title screen shows */
  M.loadRest = function (onProgress) {
    const keys = Object.keys(KAIJU);
    let done = 0;
    return Promise.all(keys.map(function (k) {
      const file = KAIJU[k].file + ".glb";
      return loadGLB(file).then(function (g) {
        if (g) {
          prep(g.scene, "kaiju");
          M.cache[k] = { src: g, clips: g.animations, family: KAIJU[k].family, kind: "kaiju", tint: KAIJU[k].tint };
        }
        done++;
        if (onProgress) onProgress(done, keys.length, k);
      });
    }));
  };

  M.has = function (role) { return !!M.cache[role]; };
  M.roleFor = function (role) { return HERO[role] ? "hero" : (KAIJU[role] ? KAIJU[role].file : null); };

  /* ---------------- clip lookup ---------------- */
  function pick(clips, patterns) {
    if (!clips || !clips.length) return null;
    for (let p = 0; p < patterns.length; p++) {
      for (let i = 0; i < clips.length; i++) {
        if (patterns[p].test(clips[i].name)) return clips[i];
      }
    }
    return null;
  }

  /* ================= RiggedActor ================= */
  function RiggedActor(key, opt) {
    opt = opt || {};
    const entry = M.cache[key];
    this.key = key;
    this.ok = !!(entry && entry.src && entry.src.scene);
    this.kind = entry ? entry.kind : "kaiju";
    this.group = new THREE.Group();

    /* sprite-Actor compatible surface */
    this.yaw = 0;
    this.A = { sx: 1, sy: 1, slide: 0, tilt: 0 };
    this.bobAmp = 0;
    this.bobRate = 6;
    this.groundY = 0;
    this.dead = false;
    this.grounded = true;
    this.height = opt.height || 4.4;
    this.w = 1.6;
    this.radius = 1.4;
    this.turnRate = opt.turn || 22;

    this._flash = 0;
    this._flashOn = false;
    this._speed = 0;
    this._lockT = 0;
    this._baseTint = new THREE.Color(0xffffff);
    this.state = "idle";
    this._ts = {};
    this._mats = [];

    if (!this.ok) return;

    const src = entry.src;
    const root = THREE.SkeletonUtils.clone(src.scene);
    this.root = root;

    /* SkeletonUtils.clone shares materials between clones; give this
       actor its own so per-character tinting cannot leak sideways.   */
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      o.material = Array.isArray(o.material) ? o.material.map(function (m) { return m.clone(); }) : o.material.clone();
    });

    /* normalise to the requested height with the feet on y = 0 */
    const box = new THREE.Box3().setFromObject(src.scene);
    const nat = Math.max(0.001, box.max.y - box.min.y);
    const size = box.getSize(new THREE.Vector3());
    const sc = this.height / nat;
    root.scale.setScalar(sc);
    root.position.y = -box.min.y * sc;

    this.w = Math.max(1.0, size.x * sc);
    const cap = this.kind === "hero" ? this.height * 0.36 : this.height * 0.5;
    this.radius = Math.max(0.9, Math.min(size.x * 0.5 * sc, cap));

    /* group -> holder (yaw + tilt + squash) -> inner (lunge) -> root */
    const inner = new THREE.Group();
    inner.add(root);
    const holder = new THREE.Group();
    holder.add(inner);
    holder.rotation.order = "YXZ";
    this.group.add(holder);
    this.holder = holder;
    this.inner = inner;

    /* materials: remember their base colour so setTint can multiply */
    const self = this;
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (!m || m.userData.__rig) continue;
        m.userData.__rig = true;
        m.userData.__base = m.color ? m.color.clone() : null;
        if (m.emissive) m.userData.em = m.emissive.clone();
        self._mats.push(m);
      }
    });

    if (this.kind === "hero") this._dressHero(opt.role || key, opt);
    else if (entry.tint !== undefined) this._applyTint(entry.tint);

    /* animations */
    this._clips = entry.clips || [];
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    const fam = FAMILIES[entry.family] || {};
    const that = this;
    Object.keys(fam).forEach(function (slot) {
      const clip = pick(that._clips, fam[slot]);
      if (!clip) return;
      const act = that.mixer.clipAction(clip);
      if (ONCE[slot]) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
      else act.setLoop(THREE.LoopRepeat, Infinity);
      act.enabled = true;
      act.setEffectiveWeight(0);
      that.actions[slot] = act;
    });

    this.built = true;
    this._play("idle", 0.01, true);
  }

  /* --- hero look: silver body, accent trunks, glowing eyes --- */
  RiggedActor.prototype._dressHero = function (role, opt) {
    const conf = HERO[role] || HERO.player;
    const accent = opt.accent !== undefined ? opt.accent : conf.accent;
    const eyes = opt.eyes !== undefined ? opt.eyes : conf.eyes;
    const body = conf.body !== undefined ? conf.body : 0xffffff;
    for (let i = 0; i < this._mats.length; i++) {
      const m = this._mats[i];
      const nm = (m.name || "").toLowerCase();
      if (nm.indexOf("eye") >= 0) {
        if (m.color) m.color.setRGB(1, 1, 1);
        if (m.emissive) {
          m.emissive.setHex(eyes);
          m.emissiveIntensity = 1.6;
          if (m.emissiveMap === null && m.map) m.emissiveMap = m.map;
          if (m.emissiveMap) m.emissiveMap.needsUpdate = true;
          m.userData.em = m.emissive.clone();   // so the hit flash restores this
        }
        if (m.map) m.userData.__base = m.color ? m.color.clone() : null;
      } else if (m.vertexColors) {
        /* the hero mesh carries its paint in COLOR_0 (silver suit, red
           plates, yellow visor), so the base-colour multiply has to stay
           neutral — only the role's body tint rides on top.             */
        if (m.color) {
          m.color.setRGB(1, 1, 1);
          if (body !== 0xffffff) m.color.multiply(new THREE.Color(body));
        }
        if (m.metalness !== undefined) { m.metalness = 0.55; m.roughness = 0.32; }
        m.userData.__base = m.color ? m.color.clone() : null;
      } else if (m.map) {
        const nt = heroSuit(m.map, accent, body);
        if (nt) m.map = nt;
        if (m.color) m.color.setRGB(1, 1, 1);
        if (m.metalness !== undefined) { m.metalness = 0.62; m.roughness = 0.30; }
        m.userData.__base = m.color ? m.color.clone() : null;
      } else if (m.color) {
        /* no texture and no per-vertex paint — the bare "bring your own
           hero" case (the Universal Rig mannequin ships like this).  A flat
           mid grey under a bright key light reads as a white blob, so give
           the body a neutral suit tone, the joint shells a darker one, and
           let a little of the role's accent through so the player and the
           four allies stay tellable apart at a glance.                   */
        const joint = /joint|dark|black|metal/i.test(nm);
        m.color.setHex(joint ? 0x46505f : 0x8d97a6);
        if (accent !== undefined) m.color.lerp(new THREE.Color(accent), joint ? 0.10 : 0.22);
        if (m.metalness !== undefined) { m.metalness = joint ? 0.42 : 0.18; m.roughness = joint ? 0.38 : 0.62; }
        m.userData.__base = m.color.clone();
      }
    }
  };

  /* --- tint every material by a colour (multiplied onto its base) --- */
  RiggedActor.prototype._applyTint = function (hex) {
    const c = new THREE.Color(hex);
    for (let i = 0; i < this._mats.length; i++) {
      const m = this._mats[i];
      if (!m.color || !m.userData.__base) continue;
      m.color.copy(m.userData.__base).multiply(c);
    }
  };

  RiggedActor.prototype.pos = function () { return this.group.position; };
  RiggedActor.prototype.setPos = function (x, y, z) { this.group.position.set(x, y, z); };
  RiggedActor.prototype.hitFlash = function (s) { this._flash = Math.max(this._flash, s === undefined ? 1 : s); };

  /* enemies pulse their tint while winding up an attack */
  RiggedActor.prototype.setTint = function (hex) {
    if (this.kind === "hero") return;      // the hero keeps its painted suit
    this._applyTint(hex);
  };

  RiggedActor.prototype.setState = function (s) {
    if (s.speed !== undefined) this._speed = s.speed;
    if (s.grounded !== undefined) this.grounded = s.grounded;
  };

  /* internal: cross-fade to a looping slot */
  RiggedActor.prototype._play = function (slot, fade, restart) {
    const next = this.actions[slot];
    if (!next) return false;
    const prev = this.actions[this.state];
    if (prev === next && !restart) return true;
    const f = fade === undefined ? 0.2 : fade;
    next.reset();
    next.setEffectiveTimeScale(this._ts[slot] || 1);
    next.setEffectiveWeight(1);
    next.fadeIn(f);
    if (prev && prev !== next) prev.fadeOut(f);
    next.play();
    this.state = slot;
    return true;
  };

  /* public one-shot (punch, beam, flinch, jump, death) */
  RiggedActor.prototype.oneShot = function (slot, lock, rate) {
    const act = this.actions[slot];
    if (!act) return false;
    const dur = act.getClip().duration || 0.5;
    /* With no explicit rate the clip is retimed to fill the game's
       window, but only within sane bounds — a punch that plays at 4x
       reads as a glitch, not as speed.                              */
    let ts = rate;
    if (!ts) {
      const want = lock || dur;
      ts = clamp(dur / want, 0.7, 2.0);
    }
    this._ts[slot] = ts;
    this._lockSlot = slot;
    this._lockT = Math.max(lock || 0, dur / ts);
    this._play(slot, slot === "hit" ? 0.04 : 0.09, true);
    return true;
  };

  /* blend a looping slot in only while the actor owns the animation */
  RiggedActor.prototype.update = function (dt, camera) {
    if (!this.ok) return;
    this.mixer.update(dt);
    if (this._lockT > 0) this._lockT -= dt;

    /* heading: chase the game's yaw, fast enough that what you see
       matches where the attack cone points                            */
    const holder = this.holder;
    let d = this.yaw - holder.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    holder.rotation.y += d * Math.min(1, dt * this.turnRate);

    /* squash / stretch / lean / lunge hooks shared with the sprite Actor */
    const A = this.A;
    holder.rotation.x = A.tilt || 0;
    holder.scale.set(A.sx || 1, A.sy || 1, 1);
    this.inner.position.z = (A.slide || 0) * 0.14;

    if (this._lockT <= 0) {
      let slot = "idle";
      if (this.dead) slot = "death";
      else if (!this.grounded) slot = this._speed > 12 ? "run" : (this._speed > 0.7 ? "walk" : "air");
      else if (this._speed > 12) slot = "run";
      else if (this._speed > 0.7) slot = "walk";
      this._play(slot, 0.24, false);

      /* match stride to real speed so the feet do not skate */
      if (slot === "walk" || slot === "run") {
        const act = this.actions[slot];
        if (act) act.setEffectiveTimeScale(clamp(this._speed / (slot === "run" ? 15 : 6.5), 0.65, 1.9));
      }
    }

    /* impact flash on the emissive channel */
    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt * 4.2);
      const v = this._flash;
      this._flashOn = true;
      for (let i = 0; i < this._mats.length; i++) {
        const m = this._mats[i];
        if (m.emissive) m.emissive.setRGB(v * 0.9, v * 0.92, v);
      }
    } else if (this._flashOn) {
      this._flashOn = false;
      for (let i = 0; i < this._mats.length; i++) {
        const m = this._mats[i];
        if (m.emissive) m.emissive.copy(m.userData.em || new THREE.Color(0));
      }
    }
  };

  M.RiggedActor = RiggedActor;

  /* factory: rigged model when available, otherwise null so the
     caller can fall back to the 2.5D sprite Actor.               */
  M.create = function (role, opt) {
    if (!M.cache.player) return null;
    const conf = HERO[role] || HERO.player;
    const o = Object.assign({}, opt || {});
    o.role = role;
    o.height = (o.height || 4.4) * conf.build;
    const a = new RiggedActor("player", o);
    a.role = role;
    return a.ok ? a : null;
  };

  M.createKaiju = function (species, opt) {
    if (!M.cache[species]) return null;
    const a = new RiggedActor(species, opt);
    return a.ok ? a : null;
  };

  window.Models = M;
})();
