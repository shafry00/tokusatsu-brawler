/* ============================================================
   game.js — orchestration: camera, input, waves, bosses, HUD
   ============================================================ */
(function () {
  const Game = {
    state: "boot",         // boot | title | playing | paused | clear | dead | victory
    time: 0, combo: 0, score: 0, stageIndex: 0,
    enemies: [], projectiles: [], pickups: [], meteors: [], rings: [], allies: [],
    ultraExpired: false, camYaw: Math.PI,
    camOrbit: { yaw: Math.PI, pitch: 0.50, dist: 21 },
  };
  window.Game = Game;

  const $ = function (id) { return document.getElementById(id); };
  const V1 = new THREE.Vector3(), V2 = new THREE.Vector3();
  function lerp(a, b, t) { return a + (b - a) * t; }
  function angLerp(a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ================= input ================= */
  const input = { mx: 0, mz: 0, run: false, jump: false, jumpPressed: false, jumpReleased: false, fly: false, descend: false, keys: {} };
  const keyMap = {};
  let mouseDX = 0, mouseDY = 0, dragging = false;
  const SENS = 0.0032;

  function isDown(code) { return !!input.keys[code]; }

  function updateMoveAxis() {
    let x = 0, z = 0;
    if (isDown("KeyW") || isDown("ArrowUp")) z += 1;
    if (isDown("KeyS") || isDown("ArrowDown")) z -= 1;
    if (isDown("KeyA") || isDown("ArrowLeft")) x -= 1;
    if (isDown("KeyD") || isDown("ArrowRight")) x += 1;
    input.mx = x; input.mz = z;
    input.run = isDown("ShiftLeft") || isDown("ShiftRight");
    const j = isDown("Space");
    if (j && !input.jump) input.jumpPressed = true;
    if (!j && input.jump) input.jumpReleased = true;
    input.jump = j;
    input.fly = j;
    // while airborne, Shift / Ctrl dive; on the ground Shift is run
    input.descend = isDown("ShiftLeft") || isDown("ShiftRight") ||
                    isDown("ControlLeft") || isDown("ControlRight");
  }

  function setupInput(canvas) {
    window.addEventListener("keydown", function (e) {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.code) >= 0) e.preventDefault();
      if (e.repeat) return;
      input.keys[e.code] = true;
      onKey(e.code);
    });
    window.addEventListener("keyup", function (e) { input.keys[e.code] = false; });
    window.addEventListener("blur", function () { input.keys = {}; updateMoveAxis(); });

    canvas.addEventListener("mousedown", function (e) {
      if (Game.state !== "playing") return;
      if (e.button === 0) { playerStartLight(); }
      if (e.button === 2) { playerStartHeavy(); }
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock && canvas.requestPointerLock();
      dragging = true;
    });
    window.addEventListener("mouseup", function () { dragging = false; });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    window.addEventListener("mousemove", function (e) {
      if (document.pointerLockElement) { mouseDX += e.movementX || 0; mouseDY += e.movementY || 0; }
      else if (dragging) { mouseDX += e.movementX || 0; mouseDY += e.movementY || 0; }
    });
    document.addEventListener("pointerlockchange", function () {
      if (!document.pointerLockElement && Game.state === "playing" && !Game._suppressPause) Game.pause();
    });
    // touch: simple virtual stick
    setupTouch(canvas);
  }

  function setupTouch(canvas) {
    if (!("ontouchstart" in window)) return;
    let touching = false, sx = 0, sy = 0, id = null;
    canvas.addEventListener("touchstart", function (e) {
      const t = e.changedTouches[0]; id = t.identifier; sx = t.clientX; sy = t.clientY; touching = true;
      playerStartLight();
    }, { passive: true });
    canvas.addEventListener("touchmove", function (e) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === id) {
          const dx = t.clientX - sx, dy = t.clientY - sy;
          input.mx = clamp(dx / 60, -1, 1); input.mz = clamp(-dy / 60, -1, 1);
          input.run = Math.abs(dx) > 30;
        }
      }
    }, { passive: true });
    canvas.addEventListener("touchend", function () { input.mx = 0; input.mz = 0; touching = false; }, { passive: true });
  }

  function onKey(code) {
    if (Game.state === "playing") {
      if (code === "KeyJ") playerStartLight();
      else if (code === "KeyK") playerStartHeavy();
      else if (code === "KeyU") Game.player.startBeam();
      else if (code === "KeyI") Game.player.startSlash();
      else if (code === "KeyQ") Game.player.dash(input.mx, input.mz);
      else if (code === "KeyF") tryFinisher();
      else if (code === "KeyC") toggleLock();
      else if (code === "KeyG") summonAlly();
      else if (code === "Escape") Game.pause();
      else if (code === "KeyM") Audio2.setMuted(!Audio2.isMuted());
    } else if (Game.state === "paused" && code === "Escape") Game.resume();
  }
  function playerStartLight() { if (Game.player && !Game.player.finisher) Game.player.startLight(); }
  function playerStartHeavy() { if (Game.player && !Game.player.finisher) Game.player.startHeavy(); }

  /* ================= boot ================= */
  Game.init = function () {
    const canvas = $("gl");
    Game.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
    Game.renderer.setPixelRatio(DPR_MAX);
    Game.renderer.setSize(window.innerWidth, window.innerHeight);
    Game.renderer.shadowMap.enabled = true;
    Game.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    Game.renderer.outputEncoding = THREE.sRGBEncoding;

    Game.scene = new THREE.Scene();
    Game.camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.1, 2400);
    Game.camera.position.set(0, 12, 22);
    Game.clock = new THREE.Clock();

    FX.init(Game.scene, Game.camera, Game.renderer);
    // image-based lighting for the PBR mecha (metal needs reflections)
    if (window.Models && Models.buildEnv) {
      try { Game.scene.environment = Models.buildEnv(Game.renderer); } catch (e) { /* non-fatal */ }
    }
    // fill light that always shines from the camera toward the hero
    Game.fillLight = new THREE.DirectionalLight(0xd8e8ff, 0.55);
    Game.scene.add(Game.fillLight);
    Game.scene.add(Game.fillLight.target);
    window.addEventListener("resize", onResize);
    setupInput(canvas);
    wireUI();

    Sprites.load(function (url, loaded, total) {
      const t = document.querySelector(".load-text");
      if (t && total) t.textContent = "SPRITES " + Math.round(loaded / total * 100) + "%";
    }).then(function () {
      // Stream the kaiju in while the hero and its animation library load,
      // so the very first wave already has real 3D models instead of the
      // 2.5D fallback billboards.
      if (window.Models && Models.loadRest) Models.loadRest();
      return (window.Models ? Models.load(function (done, total) {
        const t = document.querySelector(".load-text");
        if (t) t.textContent = "ULTRA HERO " + Math.round(done / total * 100) + "%";
      }) : Promise.resolve());
    }).then(function () {
      $("loading").classList.add("hidden");
      Game.state = "title";
      // the title art is optional: without sprites the star field and the
      // wireframe grid behind the logo carry the screen on their own
      if (window.Sprites && Sprites.has("hero_ultraman")) {
        $("titleArt").style.backgroundImage = "url('assets/sprites/hero_ultraman.png')";
      }
      loadProgress();
      renderStageGrid();
      requestAnimationFrame(loop);
    });
    Audio2.init();
  };

  function onResize() {
    Game.camera.aspect = window.innerWidth / window.innerHeight;
    Game.camera.updateProjectionMatrix();
    Game.renderer.setSize(window.innerWidth, window.innerHeight);
  }
  /* ================= progress ================= */
  let progress = { unlocked: 1, best: {}, upgrades: {} };
  function loadProgress() {
    try {
      const s = localStorage.getItem("ultraman_nine_trials");
      if (s) progress = JSON.parse(s);
    } catch (e) {}
  }
  function saveProgress() {
    try { localStorage.setItem("ultraman_nine_trials", JSON.stringify(progress)); } catch (e) {}
  }

  /* ================= UI wiring ================= */
  function wireUI() {
    $("btnStart").onclick = function () { Audio2.sfx("uiBig"); Game.startAdventure(); };
    $("btnLevels").onclick = function () { Audio2.sfx("ui"); show("levelselect"); renderStageGrid(); };
    $("btnControls").onclick = function () { Audio2.sfx("ui"); show("controls"); };
    $("btnCtrlBack").onclick = function () { Audio2.sfx("ui"); show("title"); };
    $("btnLsBack").onclick = function () { Audio2.sfx("ui"); show("title"); };
    $("btnResume").onclick = function () { Audio2.sfx("ui"); Game.resume(); };
    $("btnRestart").onclick = function () { Audio2.sfx("ui"); Game.startStage(Game.stageIndex); };
    $("btnQuit").onclick = function () { Audio2.sfx("ui"); Game.toTitle(); };
    $("btnNext").onclick = function () { Audio2.sfx("uiBig"); Game.nextStage(); };
    $("btnRetry").onclick = function () { Audio2.sfx("ui"); Game.startStage(Game.stageIndex); };
    $("btnGoTitle").onclick = function () { Audio2.sfx("ui"); Game.toTitle(); };
    $("btnVicLevels").onclick = function () { Audio2.sfx("ui"); show("levelselect"); renderStageGrid(); };
    $("btnVicTitle").onclick = function () { Audio2.sfx("ui"); Game.toTitle(); };
  }

  function show(id) {
    ["title", "levelselect", "controls", "pause", "clear", "gameover", "victory"].forEach(function (s) {
      const el = $(s); if (el) el.classList.toggle("hidden", s !== id);
    });
    $("hud").classList.add("hidden");
  }
  function showHud() {
    ["title", "levelselect", "controls", "pause", "clear", "gameover", "victory"].forEach(function (s) {
      const el = $(s); if (el) el.classList.add("hidden");
    });
    $("hud").classList.remove("hidden");
  }

  function renderStageGrid() {
    const grid = $("stageGrid");
    grid.innerHTML = "";
    World.STAGES.forEach(function (st, i) {
      const locked = i >= progress.unlocked;
      const d = document.createElement("button");
      d.className = "stage-card" + (locked ? " locked" : "");
      const best = progress.best[i] || 0;
      const diff = i < 3 ? "EASY" : (i < 6 ? "NORMAL" : (i < 8 ? "HARD" : "EXTREME"));
      const dcls = i < 6 ? "" : (i < 8 ? " hard" : " extreme");
      d.innerHTML = '<div class="sc-diff' + dcls + '">' + diff + '</div>' +
        '<div class="sc-n">STAGE ' + (i + 1) + '</div>' +
        '<div class="sc-t">' + st.name + '</div>' +
        '<div class="sc-d">' + st.sub + '</div>' +
        '<div class="sc-b">BOSS: ' + bossLabel(i) + '</div>' +
        (best ? '<div class="sc-star">★ ' + best + '</div>' : "");
      if (!locked) d.onclick = function () { Audio2.sfx("uiBig"); Game.startStage(i); };
      grid.appendChild(d);
    });
  }
  function bossLabel(i) {
    const names = ["BEMULAR", "RED KING", "BIRDON", "ALIEN BALTAN", "ELEKING", "FIRE GOLZA", "KING JOE", "DARK GOMORA", "ZETTON"];
    return names[i] || "?";
  }

  /* ================= stage lifecycle ================= */
  Game.startAdventure = function () {
    Game.upgrades = {};
    Game.startStage(0);
  };

  Game.startStage = function (idx) {
    if (!Game.upgrades) Game.upgrades = {};
    Game.stageIndex = idx;
    Game.stageToken = (Game.stageToken || 0) + 1;
    Game.state = "playing";
    Game._suppressPause = true;
    setTimeout(function () { Game._suppressPause = false; }, 300);
    Audio2.init(); Audio2.resume();
    Audio2.music(true, idx >= 6 ? 2 : 1);

    // teardown old — stage.group carries projectiles/rings/pickups/meteors,
    // but actors & lights live directly on the scene and must be detached.
    if (Game.stage && Game.stage.group) Game.scene.remove(Game.stage.group);
    Game.scene.fog = null;
    Game.enemies.forEach(function (e) { if (e.actor) Game.scene.remove(e.actor.group); });
    Game.allies.forEach(function (a) { if (a.actor) Game.scene.remove(a.actor.group); });
    if (Game.player && Game.player.actor) Game.scene.remove(Game.player.actor.group);
    if (Game.playerLight) Game.scene.remove(Game.playerLight);
    Game.enemies = []; Game.projectiles = []; Game.pickups = []; Game.meteors = []; Game.rings = []; Game.allies = [];
    Game.player = null; Game.playerLight = null; Game.boss = null; Game.finisherTarget = null;
    FX.reset();
    Game.score = 0; Game.combo = 0; Game.time = 0;
    Game.ultraExpired = false; Game.finisherTarget = null;
    Game.waveIndex = 0; Game.spawnQueue = []; Game.bossSpawned = false; Game.stageCleared = false;
    Game.ultraTime = 180 + (Game.ultraTimeBonus || 0); Game.allyUsed = false;
    Game.hintT = 0; Game.bossAddT = 0; Game.boss = null;

    const cfg = World.STAGES[idx];
    Game.stage = World.build(idx, Game.scene, new THREE.Group());
    Game.scene.add(Game.stage.group);
    Game.scene.fog = new THREE.Fog(new THREE.Color(cfg.fog[0]), cfg.fog[1], cfg.fog[2]);
    Game.scene.background = null;

    // player
    Game.player = new Player(new THREE.Vector3(0, 0, 22));
    Game.player.maxHp = 200 + (Game.upgrades.hp || 0) * 25;
    Game.player.hp = Game.player.maxHp;
    Game.player.upgrades = Object.assign({ dmg: 0, speed: 0, energy: 0, hp: 0, regen: 0 }, Game.upgrades);
    Game.scene.add(Game.player.actor.group);
    Game.playerLight = null;
    if (cfg.darkness) {
      Game.playerLight = new THREE.PointLight(0xbfe0ff, 2.2, 46);
      Game.scene.add(Game.playerLight);
    }

    // camera reset
    Game.camOrbit.yaw = Math.PI; Game.camOrbit.pitch = 0.50; Game.camOrbit.dist = 21;
    Game.camYaw = Game.camOrbit.yaw;
    Game.lockOn = null;

    // wave plan
    buildWavePlan(idx);

    showHud();
    $("stageNum").textContent = String(idx + 1);
    $("stageName").textContent = cfg.name;
    $("heroPortrait").src = (window.Sprites && !Sprites.has("hero_ultraman"))
      ? Sprites.dataURL("hero_ultraman")
      : "assets/sprites/hero_ultraman.png";
    $("bossbar").classList.add("hidden");
    $("finisher").classList.add("hidden");
    $("hint").classList.remove("show");
    updateHud();
    updateWaves();

    // toast
    const toast = $("toast");
    $("toastStage").textContent = "STAGE " + (idx + 1) + (cfg.final ? " · FINAL" : "");
    $("toastName").textContent = cfg.name;
    $("toastSub").textContent = cfg.sub;
    toast.classList.remove("hidden");
    toast.style.animation = "none"; void toast.offsetWidth; toast.style.animation = "";
    setTimeout(function () { toast.classList.add("hidden"); }, 2900);

    Audio2.sfx("transform");
    FX.flash(0.6, "#ffffff");
    // spawn intro
    FX.ring(new THREE.Vector3(0, 0.1, 30), 0x9fe8ff, 22, 0.9);
    FX.burst(new THREE.Vector3(0, 2, 30), 0xbfeaff, 40, { speed: 18, life: 1.0, grav: 8 });
    setHint("WASD move · J attack · Space jump");
    setTimeout(function () { if (Game.state === "playing") setHint(""); }, 5000);
  };

  function buildWavePlan(idx) {
    const cfg = World.STAGES[idx];
    const plan = [];
    if (!cfg.final) {
      const nWaves = 3;
      for (let w = 0; w < nWaves; w++) {
        const count = Math.round(3 + idx * 0.45 + w * 1.7);
        const list = [];
        for (let i = 0; i < count; i++) list.push(cfg.mobs[Math.floor(Math.random() * cfg.mobs.length)]);
        plan.push({ species: list, hpMul: 1 + idx * 0.10 + w * 0.05 });
      }
    }
    Game.spawnPlan = plan;
    Game.waveIndex = 0;
    Game.aliveFromWave = 0;
    Game.waveActive = false;
  }

  Game.nextStage = function () {
    if (Game.stageIndex >= 8) { Game.toTitle(); return; }
    Game.startStage(Game.stageIndex + 1);
  };

  Game.toTitle = function () {
    Game.state = "title";
    Audio2.music(false);
    if (Game.stage && Game.stage.group) Game.scene.remove(Game.stage.group);
    Game.enemies.forEach(function (e) { if (e.actor) Game.scene.remove(e.actor.group); });
    Game.allies.forEach(function (a) { if (a.actor) Game.scene.remove(a.actor.group); });
    Game.allies = [];
    Game.enemies = []; Game.projectiles = []; Game.pickups = [];
    if (Game.player && Game.player.actor) Game.scene.remove(Game.player.actor.group);
    if (Game.playerLight) Game.scene.remove(Game.playerLight);
    Game.player = null; Game.playerLight = null; Game.boss = null; Game.finisherTarget = null;
    Game.stage = null;
    FX.reset();
    show("title");
  };

  Game.pause = function () {
    if (Game.state !== "playing") return;
    Game.state = "paused";
    if (document.pointerLockElement) document.exitPointerLock();
    Audio2.music(false);
    $("pauseStats").textContent = "SCORE " + Game.score + "  ·  COMBO x" + Game.player.stats.maxCombo;
    show("pause");
  };
  Game.resume = function () {
    Game.state = "playing";
    Game._suppressPause = true;
    setTimeout(function () { Game._suppressPause = false; }, 200);
    if (Game.renderer.domElement.requestPointerLock) Game.renderer.domElement.requestPointerLock();
    Audio2.music(true, Game.stageIndex >= 6 ? 2 : 1);
    showHud();
  };

  /* ================= spawning ================= */
  function spawnPoint() {
    const sp = Game.stage.spawns;
    const p = sp[Math.floor(Math.random() * sp.length)];
    const jitter = 8;
    return new THREE.Vector3(p.x + (Math.random() - .5) * jitter, 0, p.z + (Math.random() - .5) * jitter);
  }

  Game.spawnEnemy = function (species, opts) {
    opts = opts || {};
    const p = opts.pos || spawnPoint();
    const e = new Enemies.Enemy(species, p.x, p.z, opts);
    e.baseY = opts.y || 0;
    if (e.flying) e.pos.y = e.hoverY;
    Game.enemies.push(e);
    Game.scene.add(e.actor.group);
    FX.ring(new THREE.Vector3(p.x, 0.1, p.z), e.isBoss ? 0xff3a5a : 0x9fe8ff, e.isBoss ? 20 : 8, 0.6);
    FX.burst(new THREE.Vector3(p.x, 1.5, p.z), e.isBoss ? 0xff6a4a : 0x9fe8ff, e.isBoss ? 30 : 10, { speed: 12, life: 0.6, grav: 8 });
    if (e.isBoss) {
      Audio2.sfx("roarBig");
      Game.boss = e;
      showBossBar(e);
      const bp = e.bossName;
      setHint("BOSS · " + bp + " — watch the red telegraphs");
      setTimeout(function () { if (Game.state === "playing") setHint(""); }, 4200);
    } else {
      Audio2.sfx("roar");
    }
    return e;
  };

  function spawnWave() {
    const wave = Game.spawnPlan[Game.waveIndex];
    Game.currentWaveSpecies = wave.species.slice();
    Game.currentHpMul = wave.hpMul;
    Game.waveActive = true;
    Game.aliveFromWave = 0;
    Game.maxAlive = Math.min(6, 3 + Math.floor(Game.stageIndex / 2));
    updateWaves();
    setHint("Wave " + (Game.waveIndex + 1) + " / " + Game.spawnPlan.length);
    setTimeout(function () { if (Game.state === "playing") setHint(""); }, 2200);
  }

  function updateSpawns(dt) {
    const alive = Game.enemies.length;
    if (!Game.waveActive) {
      if (Game.spawnPlan && Game.waveIndex < Game.spawnPlan.length) {
        spawnWave();
      } else if (!Game.bossSpawned) {
        spawnBoss();
      }
      return;
    }
    // spawn from current wave up to maxAlive
    if (Game.currentWaveSpecies.length > 0 && alive < Game.maxAlive) {
      Game.spawnT = (Game.spawnT || 0) - dt;
      if (Game.spawnT <= 0) {
        Game.spawnT = 0.6;
        const sp = Game.currentWaveSpecies.shift();
        Game.spawnEnemy(sp, { hpMul: Game.currentHpMul });
      }
    }
    if (Game.currentWaveSpecies.length === 0 && alive === 0) {
      Game.waveActive = false;
      Game.waveIndex++;
      if (Game.waveIndex >= Game.spawnPlan.length) {
        setHint("All waves cleared — boss incoming!");
        setTimeout(function () { if (Game.state === "playing") setHint(""); }, 2500);
      }
    }
  }

  function spawnBoss() {
    const cfg = World.STAGES[Game.stageIndex];
    const p = spawnPoint();
    const e = Game.spawnEnemy(cfg.boss, { boss: true, bossStage: Game.stageIndex, hpMul: 1, scale: cfg.bossH / (Enemies.SPECIES[cfg.boss] ? Enemies.SPECIES[cfg.boss].h : 3.4) });
    e.h = cfg.bossH;
    Game.bossSpawned = true;
    Game.boss = e;
    Audio2.musicIntensity(2);
  }

  /* ================= enemy helpers ================= */
  Game.onEnemyKilled = function (e) {
    Game.player.stats.kills++;
    Game.player.gainEnergy(10);
    Game.addScore(50);
    // drops
    const r = Math.random();
    if (r < 0.28) spawnPickup(e.pos, "en");
    else if (r < 0.46) spawnPickup(e.pos, "hp");
    else if (r < 0.51) spawnPickup(e.pos, "time");
    if (e.isBoss) {
      FX.flash(0.9, "#ffffff");
      FX.slowmo(0.25, 1.4);
      onStageCleared();
    }
  };

  Game.onBossStaggered = function (b) {
    Game.finisherTarget = b;
    $("finisher").classList.remove("hidden");
    setHint("Press F to finish!");
  };
  Game.hideFinisher = function () {
    Game.finisherTarget = null;
    $("finisher").classList.add("hidden");
  };
  function tryFinisher() {
    if (Game.finisherTarget && Game.player && !Game.player.finisher) {
      const t = Game.finisherTarget;
      Game.hideFinisher();
      t.finished = true;
      Game.player.startFinisher(t);
      FX.slowmo(0.35, 1.0);
    }
  }
  Game.onBossPhase = function (b, phase) {
    $("bossPhase").textContent = "PHASE " + phase + " / " + b.maxPhases + (b.patternAttacks.indexOf("meteor") >= 0 ? "" : "");
    setHint("BOSS ENRAGED — PHASE " + phase);
    setTimeout(function () { if (Game.state === "playing") setHint(""); }, 2500);
  };

  Game.onPlayerDead = function () {
    Game.state = "dead";
    Audio2.music(false);
    if (document.pointerLockElement) document.exitPointerLock();
    const tok = Game.stageToken;
    if (Game.ultraExpired) {
      $("goTitle").textContent = "COLOR TIMER — OUT";
      $("goNote").textContent = "The light fades… but Ultraman never truly falls.";
    } else {
      $("goTitle").textContent = "DEFEAT — THE LIGHT FADES";
      $("goNote").textContent = "The kaiju holds the field. Rise again, Ultraman.";
    }
    const s = Game.player.stats;
    $("goStats").innerHTML = statRows([
      ["Score", Game.score], ["Kaiju defeated", s.kills], ["Best combo", "x" + s.maxCombo],
      ["Damage dealt", Math.round(s.hits * 30)], ["Time", fmt(s.time)],
    ]);
    setTimeout(function () { if (Game.stageToken === tok) show("gameover"); }, 1400);
  };

  function onStageCleared() {
    Game.stageCleared = true;
    Audio2.music(false);
    const tok = Game.stageToken;
    setTimeout(function () {
      if (Game.stageToken !== tok) return;   // a new stage started meanwhile
      if (Game.stageIndex >= 8) { onVictory(); return; }
      if (document.pointerLockElement) document.exitPointerLock();
      Game.state = "clear";
      // the boss fell a moment ago; drop its corpse so it does not stand
      // there behind the results panel
      Game.enemies.forEach(function (e) { if (e.dead && e.actor) e.actor.group.visible = false; });
      Audio2.sfx("levelup");
      progress.unlocked = Math.max(progress.unlocked, Math.min(9, Game.stageIndex + 2));
      progress.best[Game.stageIndex] = Math.max(progress.best[Game.stageIndex] || 0, Game.score);
      saveProgress();
      const s = Game.player.stats;
      $("clearTitle").textContent = World.STAGES[Game.stageIndex].name;
      $("clearStats").innerHTML = statRows([
        ["Score", Game.score], ["Kaiju defeated", s.kills], ["Best combo", "x" + s.maxCombo],
        ["Damage taken", Math.round(s.dmgTaken)], ["Time", fmt(s.time)],
      ]);
      offerUpgrades();
      show("clear");
    }, 2200);
  }

  function onVictory() {
    if (document.pointerLockElement) document.exitPointerLock();
    Game.state = "victory";
    // Zetton fell a moment ago; drop its corpse
    Game.enemies.forEach(function (e) { if (e.dead && e.actor) e.actor.group.visible = false; });
    progress.unlocked = 9; saveProgress();
    $("vicStats").innerHTML = statRows([["Final score", Game.score], ["Stages cleared", "9 / 9"], ["Stage 9 score", Game.score]]);
    show("victory");
    Audio2.sfx("levelup");
  }

  function statRows(pairs) {
    return pairs.map(function (p) {
      return '<div class="k">' + p[0] + '</div><div class="v">' + p[1] + '</div>';
    }).join("");
  }
  function fmt(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ":" + (s < 10 ? "0" : "") + s; }

  /* ---------------- upgrades ---------------- */
  const UPGRADES = [
    { id: "dmg", name: "ULTRA POWER", desc: "+15% attack damage" },
    { id: "speed", name: "LIGHT SPEED", desc: "+8% movement speed" },
    { id: "energy", name: "ENERGY CORE", desc: "Faster energy regeneration" },
    { id: "hp", name: "VITALITY", desc: "+25 max HP and heal to full" },
    { id: "regen", name: "RECOVERY", desc: "Slowly regenerate HP in battle" },
    { id: "timer", name: "TIME EXTENDER", desc: "+30s Ultra Time next stages" },
  ];
  function offerUpgrades() {
    const pool = UPGRADES.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 3);
    const grid = $("upGrid"); grid.innerHTML = "";
    let selected = null;
    pool.forEach(function (u, ui) {
      const b = document.createElement("button");
      b.className = "up-card";
      b.setAttribute("data-i", String(ui + 1));
      b.innerHTML = "<b>" + u.name + "</b><span>" + u.desc + "</span>";
      b.onclick = function () {
        selected = u;
        Array.prototype.forEach.call(grid.children, function (c) { c.classList.remove("sel"); });
        b.classList.add("sel");
        Audio2.sfx("ui");
        $("btnNext").textContent = "NEXT STAGE (with " + u.name + ")";
      };
      grid.appendChild(b);
    });
    Game.pendingUpgrade = function () {
      if (selected) {
        Game.upgrades[selected.id] = (Game.upgrades[selected.id] || 0) + 1;
        if (selected.id === "timer") Game.ultraTimeBonus = (Game.ultraTimeBonus || 0) + 30;
      }
    };
    $("btnNext").textContent = "NEXT STAGE";
    $("btnNext").onclick = function () {
      Audio2.sfx("uiBig");
      if (Game.pendingUpgrade) Game.pendingUpgrade();
      Game.nextStage();
    };
  }

  /* ================= score / combo ================= */
  Game.addScore = function (v) {
    Game.score += Math.round(v * (1 + Game.combo * 0.02));
    $("score").textContent = Game.score;
  };
  Game.updateCombo = function () {
    const c = $("combo");
    if (Game.combo < 2) { c.classList.add("hidden"); return; }
    c.classList.remove("hidden");
    $("comboNum").textContent = Game.combo;
    const rank = Game.combo >= 40 ? "GOD TIER" : Game.combo >= 25 ? "ULTRA" : Game.combo >= 15 ? "GREAT" : Game.combo >= 8 ? "GOOD" : "";
    $("comboRank").textContent = rank;
    c.classList.remove("pop"); void c.offsetWidth; c.classList.add("pop");
  };
  Game.breakCombo = function () { Game.combo = 0; Game.updateCombo(); };

  /* ================= hints ================= */
  Game.setHint = function (t) {
    const h = $("hint");
    if (!t) { h.classList.remove("show"); return; }
    h.textContent = t; h.classList.add("show");
  };
  Game.toastHint = function (t) {
    setHint(t);
    setTimeout(function () { if (Game.state === "playing") setHint(""); }, 1600);
  };
  function setHint(t) { Game.setHint(t); }

  /* ================= lock-on ================= */
  function toggleLock() {
    if (Game.lockOn) { Game.lockOn = null; Game.toastHint("Camera released"); return; }
    let best = null, bd = 1e9;
    Game.enemies.forEach(function (e) {
      if (e.dead) return;
      const d = Math.hypot(e.pos.x - Game.player.pos.x, e.pos.z - Game.player.pos.z);
      if (d < 70 && d < bd) { bd = d; best = e; }
    });
    Game.lockOn = best;
    if (best) Game.toastHint("LOCKED ON: " + (best.isBoss ? best.bossName : best.species.replace("kaiju_", "").toUpperCase()));
    else Game.toastHint("No target");
  }

  /* ================= projectiles ================= */
  Game.spawnProjectile = function (from, dir, speed, dmg, color, owner, radius) {
    const geo = new THREE.SphereGeometry(radius || 0.9, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color: color || 0xff7a4a });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(from);
    const halo = new THREE.Mesh(new THREE.SphereGeometry((radius || 0.9) * 2, 10, 8),
      new THREE.MeshBasicMaterial({ color: color || 0xff7a4a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.add(halo);
    Game.stage.group.add(m);
    Game.projectiles.push({ mesh: m, dir: dir.clone().normalize(), speed: speed, dmg: dmg, owner: owner, life: 3.5, radius: radius || 0.9, color: color });
  };

  function updateProjectiles(dt) {
    for (let i = Game.projectiles.length - 1; i >= 0; i--) {
      const p = Game.projectiles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.dir, p.speed * dt);
      p.mesh.position.y = Math.max(0.4, p.mesh.position.y);
      if (Math.random() < 0.6) FX.spark(p.mesh.position, { color: p.color, grav: 0, life: 0.25, size: 0.18, vel: new THREE.Vector3(0, 0, 0) });
      let hit = false;
      if (p.owner === "enemy") {
        const pl = Game.player;
        if (Math.hypot(p.mesh.position.x - pl.pos.x, p.mesh.position.z - pl.pos.z) < pl.radius + p.radius &&
            Math.abs(p.mesh.position.y - (pl.pos.y + 1.8)) < 3.4) {
          pl.takeDamage(p.dmg, p.mesh.position);
          FX.burst(p.mesh.position, p.color, 12, { speed: 10, life: 0.4 });
          hit = true;
        }
      } else {
        for (let j = 0; j < Game.enemies.length; j++) {
          const e = Game.enemies[j]; if (e.dead) continue;
          if (Math.hypot(p.mesh.position.x - e.pos.x, p.mesh.position.z - e.pos.z) < e.radius + p.radius &&
              Math.abs(p.mesh.position.y - (e.pos.y + e.h * 0.5)) < e.h * 0.6) {
            e.takeDamage(p.dmg, { knock: 4, from: p.mesh.position });
            FX.burst(p.mesh.position, p.color, 10, { speed: 10, life: 0.4 });
            hit = true; break;
          }
        }
      }
      if (hit || p.life <= 0 || Math.hypot(p.mesh.position.x, p.mesh.position.z) > Game.stage.arenaRadius + 30) {
        Game.stage.group.remove(p.mesh);
        Game.projectiles.splice(i, 1);
      }
    }
  }

  /* --------- Ultra Slash ring --------- */
  Game.spawnRing = function (from, dir, yaw) {
    const geo = new THREE.TorusGeometry(2.0, 0.3, 8, 28);
    const mat = new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(from);
    m.rotation.x = Math.PI / 2;
    // additive halo so the blade reads against any backdrop
    const halo = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.9, 6, 22),
      new THREE.MeshBasicMaterial({ color: 0x49c9ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.add(halo);
    Game.stage.group.add(m);
    // launch flash
    FX.shock(from, 0xbff6ff, 4.5, 0.3);
    FX.ring(from, 0x9fe8ff, 6, 0.3, { quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir) });
    FX.burst(from, 0xbff6ff, 16, { speed: 14, life: 0.45, grav: 2 });
    const dmgMul = 1 + ((Game.player.upgrades && Game.player.upgrades.dmg) || 0) * 0.12;
    Game.rings.push({ mesh: m, halo: halo, dir: dir.clone().normalize(), speed: 44, life: 1.6, hitSet: {}, dmg: 55 * dmgMul, spin: 0 });
  };

  function updateRings(dt) {
    for (let i = Game.rings.length - 1; i >= 0; i--) {
      const r = Game.rings[i];
      r.life -= dt;
      r.mesh.position.addScaledVector(r.dir, r.speed * dt);
      r.mesh.position.y = Math.max(2.2, r.mesh.position.y);
      r.spin += dt * 30;
      r.mesh.rotation.z = r.spin;
      if (Math.random() < 0.8) FX.spark(r.mesh.position, { color: 0x9fe8ff, grav: 0, life: 0.28, size: 0.2, vel: new THREE.Vector3(0, 0, 0) });
      for (let j = 0; j < Game.enemies.length; j++) {
        const e = Game.enemies[j];
        if (e.dead || r.hitSet[j]) continue;
        if (Math.hypot(r.mesh.position.x - e.pos.x, r.mesh.position.z - e.pos.z) < e.radius + 2.2 &&
            Math.abs(r.mesh.position.y - (e.pos.y + e.h * 0.5)) < e.h * 0.7) {
          r.hitSet[j] = true;
          const crit = Math.random() < 0.3;
          e.takeDamage(crit ? r.dmg * 1.6 : r.dmg, { knock: 10, from: r.mesh.position, guardBreak: true, crit: crit });
          const hp = new THREE.Vector3(e.pos.x, e.pos.y + e.h * 0.5, e.pos.z);
          FX.impact(hp, 0xbff6ff, 1.3);
          FX.ring(hp, 0x9fe8ff, 5, 0.32);
          FX.hitstop(crit ? 80 : 50); FX.shake(crit ? 0.55 : 0.3);
          Game.player.registerHit(crit ? "crit" : "normal");
        }
      }
      if (r.halo) r.halo.material.opacity = 0.28 + Math.random() * 0.28;
      if (r.life <= 0) {
        Game.stage.group.remove(r.mesh);
        r.mesh.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        Game.rings.splice(i, 1);
      }
    }
  }

  /* --------- meteors (Zetton) --------- */
  Game.spawnMeteor = function (x, z, dmg) {
    const g = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.0, 30),
      new THREE.MeshBasicMaterial({ color: 0xff3a4a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    g.rotation.x = -Math.PI / 2; g.position.set(x, 0.08, z);
    Game.stage.group.add(g);
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 0),
      new THREE.MeshBasicMaterial({ color: 0xff8a3a }));
    rock.position.set(x, 130, z);
    Game.stage.group.add(rock);
    Game.meteors.push({ ring: g, rock: rock, x: x, z: z, dmg: dmg, t: 0, delay: 1.5, hit: false });
  };

  function updateMeteors(dt) {
    for (let i = Game.meteors.length - 1; i >= 0; i--) {
      const m = Game.meteors[i];
      m.t += dt;
      const k = clamp(m.t / m.delay, 0, 1);
      m.ring.scale.setScalar(0.2 + k * 1.2);
      if (m.t >= m.delay) {
        m.rock.position.y = Math.max(0, m.rock.position.y - 150 * dt);
        m.rock.rotation.x += dt * 6; m.rock.rotation.z += dt * 4;
        if (m.rock.position.y <= 0 && !m.hit) {
          m.hit = true;
          FX.explodeAt(new THREE.Vector3(m.x, 1, m.z), 1.6);
          const pl = Game.player;
          if (Math.hypot(pl.pos.x - m.x, pl.pos.z - m.z) < 8 && pl.pos.y < 8) pl.takeDamage(m.dmg, new THREE.Vector3(m.x, 0, m.z));
        }
      }
      if (m.hit && m.t > m.delay + 1.0) {
        Game.stage.group.remove(m.ring); Game.stage.group.remove(m.rock);
        Game.meteors.splice(i, 1);
      }
    }
  }

  /* --------- clones (Baltan) --------- */
  Game.spawnClones = function (boss, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 14;
      const e = Game.spawnEnemy(boss.species, {
        pos: new THREE.Vector3(boss.pos.x + Math.cos(a) * r, 0, boss.pos.z + Math.sin(a) * r),
        hpMul: 0.02,
      });
      e.isClone = true;
      e.speed *= 1.15;
      e.actor.setTint(0xbfd0ff);
      e.actor.mat.opacity = 0.85;
      e.actor.mat.transparent = true;
    }
    setHint("Illusions! Find the real Baltan");
    setTimeout(function () { if (Game.state === "playing") setHint(""); }, 2500);
  };

  /* --------- beams --------- */
  let beamVisT = 0;
  Game.drawEnemyBeam = function (from, dir, len, color, dt) {
    beamVisT -= dt;
    if (beamVisT <= 0) {
      beamVisT = 0.07;
      FX.beam(from, from.clone().addScaledVector(dir, len), { color: color || 0xff5a6a, glow: color || 0xff2a3a, radius: 2.0, life: 0.28 });
      FX.flash(0.08, "#ff8a8a");
    }
  };
  Game.checkBeamOnPlayer = function (from, dir, len, radius, dmg) {
    const pl = Game.player;
    const proj = V1.set(pl.pos.x - from.x, (pl.pos.y + pl.h * 0.5) - from.y, pl.pos.z - from.z);
    const along = proj.dot(dir);
    if (along < 0 || along > len) return;
    const closest = V2.copy(from).addScaledVector(dir, along);
    const dist = closest.distanceTo(new THREE.Vector3(pl.pos.x, pl.pos.y + pl.h * 0.5, pl.pos.z));
    if (dist < radius + pl.radius) pl.takeDamage(dmg, null);
  };

  Game.beamProps = function (from, dir, len, dmg, radius) {
    const list = Game.stage.destructibles;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      const proj = V1.set(m.position.x - from.x, m.position.y - from.y, m.position.z - from.z);
      const along = proj.dot(dir);
      if (along < 0 || along > len) continue;
      const closest = V2.copy(from).addScaledVector(dir, along);
      const dist = closest.distanceTo(new THREE.Vector3(m.position.x, m.position.y, m.position.z));
      if (dist < radius + 5) {
        if (World.hitProp(Game.stage, m, dmg, destroyProp)) {
          // destroyed
        }
      }
    }
  };

  function destroyProp(m) {
    const size = m.userData.size || [4, 6, 4];
    const p = m.position.clone();
    FX.explodeAt(p, m.userData.car ? 0.7 : 1.6);
    FX.debris(p, 0x8a8f98, 14);
    Audio2.sfx("explode");
    // rubble (capped so long stages don't accumulate meshes)
    Game.stage.rubble = Game.stage.rubble || [];
    for (let i = 0; i < 4; i++) {
      const rb = new THREE.Mesh(new THREE.BoxGeometry(size[0] * 0.3, size[1] * 0.15, size[2] * 0.3),
        new THREE.MeshLambertMaterial({ color: 0x5a5a62 }));
      rb.position.set(p.x + (Math.random() - .5) * size[0], size[1] * 0.08, p.z + (Math.random() - .5) * size[2]);
      rb.rotation.y = Math.random() * 3;
      Game.stage.group.add(rb);
      Game.stage.rubble.push(rb);
    }
    while (Game.stage.rubble.length > 48) {
      const old = Game.stage.rubble.shift();
      if (old.parent) old.parent.remove(old);
      if (old.geometry) old.geometry.dispose();
      if (old.material) old.material.dispose();
    }
    World.removeProp(Game.stage, m);
    Game.addScore(60);
    // collateral damage to nearby enemies
    Game.enemies.forEach(function (e) {
      if (e.dead) return;
      if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < 12) e.takeDamage(80, { knock: 8, from: p, guardBreak: false });
    });
  }

  /* ================= pickups ================= */
  function spawnPickup(pos, kind) {
    const color = kind === "en" ? 0x4fd6ff : kind === "hp" ? 0x63f0a0 : 0xffd24a;
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(1.0, 0),
      new THREE.MeshBasicMaterial({ color: color }));
    m.position.set(pos.x, 1.6, pos.z);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.8, 10, 8),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.add(halo);
    Game.stage.group.add(m);
    Game.pickups.push({ mesh: m, kind: kind, t: 0, life: 22 });
  }

  function updatePickups(dt) {
    const pl = Game.player;
    for (let i = Game.pickups.length - 1; i >= 0; i--) {
      const pk = Game.pickups[i];
      pk.t += dt; pk.life -= dt;
      pk.mesh.rotation.y += dt * 2; pk.mesh.rotation.x += dt * 1.2;
      pk.mesh.position.y = 1.6 + Math.sin(pk.t * 3) * 0.4;
      const d = Math.hypot(pk.mesh.position.x - pl.pos.x, pk.mesh.position.z - pl.pos.z);
      if (d < 8 && pl.pos.y < 6) {
        const k = 1 - d / 8;
        pk.mesh.position.x = lerp(pk.mesh.position.x, pl.pos.x, k * dt * 5);
        pk.mesh.position.z = lerp(pk.mesh.position.z, pl.pos.z, k * dt * 5);
      }
      if (d < 3.2 && Math.abs(pk.mesh.position.y - (pl.pos.y + 1.8)) < 4) {
        if (pk.kind === "en") { pl.gainEnergy(30); Game.toastHint("+30 ENERGY"); }
        else if (pk.kind === "hp") { pl.heal(35); Game.toastHint("+35 HP"); }
        else { Game.ultraTime += 25; Game.ultraExpired = false; Game.toastHint("+25s ULTRA TIME"); }
        FX.burst(pk.mesh.position, pk.mesh.material.color.getHex(), 14, { speed: 9, life: 0.5, grav: 4 });
        Audio2.sfx("pickup");
        Game.stage.group.remove(pk.mesh);
        Game.pickups.splice(i, 1);
        continue;
      }
      if (pk.life <= 0) { Game.stage.group.remove(pk.mesh); Game.pickups.splice(i, 1); }
    }
  }

  /* ================= ally summons ================= */
  const ALLIES = [
    { tex: "ally_zero", model: "zero", name: "ULTRAMAN ZERO" },
    { tex: "ally_seven", model: "seven", name: "ULTRASEVEN" },
    { tex: "ally_mebius", model: "mebius", name: "ULTRAMAN MEBIUS" },
    { tex: "ally_tiga", model: "tiga", name: "ULTRAMAN TIGA" },
  ];
  let allyIdx = 0;
  function summonAlly() {
    if (Game.allyUsed) { Game.toastHint("Ally already used this stage"); return; }
    Game.allyUsed = true;
    const a = ALLIES[allyIdx % ALLIES.length]; allyIdx++;
    const pl = Game.player;
    const off = new THREE.Vector3(Math.sin(Game.camYaw + Math.PI / 2) * 9, 0, Math.cos(Game.camYaw + Math.PI / 2) * 9);
    const actor = (window.Models && Models.create(a.model, { height: 4.4 })) ||
                  new Actor(a.tex, { height: 4.4 });
    actor.setPos(pl.pos.x + off.x, 0, pl.pos.z + off.z);
    // face the nearest live enemy so the beam sweeps the field
    let ax = 0, az = 0, best = Infinity;
    Game.enemies.forEach(function (e) {
      if (e.dead) return;
      const d = Math.hypot(e.pos.x - actor.pos().x, e.pos.z - actor.pos().z);
      if (d < best) { best = d; ax = e.pos.x; az = e.pos.z; }
    });
    actor.yaw = (best < Infinity) ? Math.atan2(ax - actor.pos().x, az - actor.pos().z) : Game.camYaw + Math.PI;
    Game.scene.add(actor.group);
    Game.allies.push({ actor: actor, t: 0, fired: false, name: a.name, dir: null });
    Game.toastHint(a.name + " ARRIVES!");
    Audio2.sfx("transform");
    FX.flash(0.5, "#bfeaff");
    FX.ring(actor.pos(), 0x9fe8ff, 16, 0.8);
  }

  function updateAllies(dt) {
    for (let i = Game.allies.length - 1; i >= 0; i--) {
      const al = Game.allies[i];
      al.t += dt;
      if (al.actor.ok) {
        // rigged ally: materialise in, then fade out by scaling
        let s = 1;
        if (al.t < 0.7) s = 0.25 + 0.75 * (al.t / 0.7);
        else if (al.t > 2.5) s = Math.max(0.02, 1 - (al.t - 2.5) / 0.6);
        al.actor.group.scale.setScalar(s);
      }
      if (al.t < 0.7) {
        al.actor.A.sy = 1.3 - al.t * 0.4;
      } else if (!al.fired) {
        al.fired = true;
        al.actor.oneShot("beam", 2.0, 1.0);
        // beam sweep across the field
        const pl = Game.player;
        const dir = new THREE.Vector3(Math.sin(al.actor.yaw), 0.02, Math.cos(al.actor.yaw));
        al.dir = dir;
        al.beamFrom = new THREE.Vector3(al.actor.pos().x, 3, al.actor.pos().z);
        Audio2.sfx("beam");
        FX.flash(0.6, "#bfeaff");
        FX.shake(0.8);
      } else if (al.t < 2.4) {
        al.actor.A.slide = 3; al.actor.A.tilt = 0.2;
        const len = 110;
        FX.beam(al.beamFrom, al.beamFrom.clone().addScaledVector(al.dir, len),
          { color: 0xbfeaff, glow: 0x39c8ff, radius: 2.6, life: 0.12 });
        Game.enemies.forEach(function (e) {
          if (e.dead) return;
          const proj = V1.set(e.pos.x - al.beamFrom.x, (e.pos.y + e.h * 0.5) - al.beamFrom.y, e.pos.z - al.beamFrom.z);
          const along = proj.dot(al.dir);
          if (along < 0 || along > len) return;
          const closest = V2.copy(al.beamFrom).addScaledVector(al.dir, along);
          const dist = closest.distanceTo(new THREE.Vector3(e.pos.x, e.pos.y + e.h * 0.5, e.pos.z));
          if (dist < e.radius + 3.5) {
            e.takeDamage(90 * dt * 2.4, { knock: 0.1 });
            if (Math.random() < 0.4) FX.burst(closest, 0xbfeaff, 3, { speed: 12, life: 0.4, grav: 0 });
          }
        });
        Game.beamProps(al.beamFrom, al.dir, len, 260 * dt, 1.8);
      } else {
        al.actor.A.sy = lerp(al.actor.A.sy, 0.4, 0.1);
        al.actor.A.slide = 0;
        if (al.t > 3.1) {
          Game.scene.remove(al.actor.group);
          Game.allies.splice(i, 1);
          continue;
        }
      }
      al.actor.update(dt, Game.camera);
    }
  }

  /* ================= HUD ================= */
  let hpGhostVal = 1;
  function updateHud() {
    const pl = Game.player;
    const f = clamp(pl.hp / pl.maxHp, 0, 1);
    $("hpFill").style.transform = "scaleX(" + f + ")";
    $("hpText").textContent = Math.ceil(pl.hp) + " / " + pl.maxHp;
    $("hpFill").parentNode.classList.toggle("low", f < 0.3);
    hpGhostVal = lerp(hpGhostVal, f, 0.06);
    $("hpGhost").style.transform = "scaleX(" + hpGhostVal + ")";

    const ef = clamp(pl.en / pl.maxEn, 0, 1);
    $("enFill").style.transform = "scaleX(" + ef + ")";
    $("enText").textContent = "ENERGY " + Math.round(ef * 100) + "%";

    const t = Math.max(0, Math.ceil(Game.ultraTime));
    $("ultraTime").textContent = Math.floor(t / 60) + ":" + (t % 60 < 10 ? "0" : "") + (t % 60);
    $("ultraTime").parentNode.classList.toggle("danger", Game.ultraExpired);

    const ct = $("colorTimer");
    ct.classList.toggle("warn", f < 0.55 && f >= 0.3);
    ct.classList.toggle("crit", f < 0.3);

    // action cooldowns
    Array.prototype.forEach.call(document.querySelectorAll(".actionbar .act"), function (el) {
      const k = el.getAttribute("data-k");
      let cool = false;
      if (k === "Q") cool = pl.dashCd > 0;
      if (k === "U") cool = pl.en < 40;
      if (k === "I") cool = pl.en < 25 || pl.slashCd > 0;
      el.classList.toggle("cool", cool);
    });

    if (Game.boss && !Game.boss.dead) {
      $("bossFill").style.transform = "scaleX(" + clamp(Game.boss.hp / Game.boss.maxHp, 0, 1) + ")";
    }
  }

  function showBossBar(e) {
    $("bossbar").classList.remove("hidden");
    $("bossName").textContent = e.bossName;
    $("bossPhase").textContent = "PHASE 1 / " + e.maxPhases;
    $("bossFill").style.transform = "scaleX(1)";
    $("objective").textContent = "Defeat " + e.bossName;
  }

  function updateWaves() {
    const row = $("waveRow");
    row.innerHTML = "";
    const n = (Game.spawnPlan ? Game.spawnPlan.length : 0) + 1;
    for (let i = 0; i < n; i++) {
      const d = document.createElement("div");
      d.className = "wave-pip" + (i < Game.waveIndex ? " done" : (i === Game.waveIndex ? " on" : ""));
      row.appendChild(d);
    }
    if (!Game.bossSpawned) {
      $("objective").textContent = "Clear wave " + Math.min(Game.waveIndex + 1, n) + " / " + n;
    }
  }

  /* ================= camera occluder fade ================= */
  function updateOccluders(dt) {
    const list = Game.stage.destructibles;
    if (!list.length) return;
    const cam = Game.camera, pl = Game.player;
    const ax = cam.position.x, ay = cam.position.y, az = cam.position.z;
    const abx = (pl.pos.x - ax), aby = (pl.pos.y + 2.2 - ay), abz = (pl.pos.z - az);
    const abLen2 = (abx * abx + aby * aby + abz * abz) || 1;
    const k = 1 - Math.pow(0.004, dt);
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m.userData.fade) continue;
      const mat = m.material || (m.children[0] && m.children[0].material);
      if (!mat) continue;
      let t = ((m.position.x - ax) * abx + (m.position.y - ay) * aby + (m.position.z - az) * abz) / abLen2;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const cx = ax + abx * t, cy = ay + aby * t, cz = az + abz * t;
      const dx = m.position.x - cx, dy = m.position.y - cy, dz = m.position.z - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // also fade anything the camera itself is jammed against, even when it
      // sits outside the camera→player segment
      const ddx = m.position.x - ax, ddy = m.position.y - ay, ddz = m.position.z - az;
      const dc = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      const nearCam = dc < (m.userData.radius || 4) + 10;
      const blocked = nearCam || (t > 0.04 && t < 0.96 && d < m.userData.radius);
      const target = blocked ? 0.05 : 1;
      const cur = mat.opacity;
      const next = cur + (target - cur) * k;
      mat.opacity = next;
      // faded geometry must NOT write depth or cast shadows,
      // otherwise it hides/darkens characters behind it
      const solid = next > 0.85;
      if (mat.depthWrite !== solid) mat.depthWrite = solid;
      if (m.castShadow !== solid) m.castShadow = solid;
      if (m.children && m.children.length && m.children[0].material) {
        m.children[0].material.opacity = next;
        if (m.children[0].material.depthWrite !== solid) m.children[0].material.depthWrite = solid;
      }
    }
  }

  /* ================= main loop ================= */
  function updateCamera(dt) {
    const pl = Game.player;
    // mouse look
    if (mouseDX || mouseDY) {
      Game.camOrbit.yaw -= mouseDX * SENS;
      Game.camOrbit.pitch = clamp(Game.camOrbit.pitch + mouseDY * SENS * 0.8, 0.08, 1.15);
      mouseDX = 0; mouseDY = 0;
    }
    // lock-on eases yaw toward target
    if (Game.lockOn && !Game.lockOn.dead) {
      const e = Game.lockOn;
      const want = Math.atan2(e.pos.x - pl.pos.x, e.pos.z - pl.pos.z);
      Game.camOrbit.yaw = angLerp(Game.camOrbit.yaw, want, 1 - Math.pow(0.02, dt));
      const d = Math.hypot(e.pos.x - pl.pos.x, e.pos.z - pl.pos.z);
      Game.camOrbit.dist = lerp(Game.camOrbit.dist, clamp(14 + d * 0.5, 18, 40), 1 - Math.pow(0.1, dt));
      Game.camOrbit.pitch = lerp(Game.camOrbit.pitch, 0.30, 1 - Math.pow(0.1, dt));
    } else {
      Game.camOrbit.dist = lerp(Game.camOrbit.dist, 21, 1 - Math.pow(0.2, dt));
      Game.camOrbit.pitch = clamp(Game.camOrbit.pitch, 0.08, 1.15);
    }
    Game.camYaw = Game.camOrbit.yaw;

    // target point
    const tgt = V1.set(pl.pos.x, pl.pos.y + 3.2, pl.pos.z);
    // slight look-ahead
    tgt.x += pl.vel.x * 0.10; tgt.z += pl.vel.z * 0.10;

    const yaw = Game.camOrbit.yaw, pitch = Game.camOrbit.pitch, dist = Game.camOrbit.dist;
    const horiz = Math.cos(pitch) * dist, height = Math.sin(pitch) * dist + 2;
    const des = V2.set(tgt.x - Math.sin(yaw) * horiz, tgt.y + height, tgt.z - Math.cos(yaw) * horiz);
    if (des.y < 3) des.y = 3;

    // smooth follow (snappier when target far)
    const k = 1 - Math.pow(0.0004, dt);
    Game.camera.position.lerp(des, k);
    Game.camera.lookAt(tgt.x, tgt.y - 0.9, tgt.z);
    // shake
    Game.camera.position.add(FX.shakeOffset);
  }

  function updateUltraTimer(dt) {
    if (Game.ultraTime > 0) {
      Game.ultraTime -= dt;
      if (Game.ultraTime <= 0) {
        Game.ultraTime = 0;
        Game.ultraExpired = true;
        Audio2.sfx("alarm");
        FX.flash(0.4, "#ff3b4d");
        setHint("POWER DEPLETED — damage taken doubled!");
        setTimeout(function () { if (Game.state === "playing") setHint(""); }, 3200);
      }
      if (Game.ultraTime < 10 && Math.random() < 0.02) Audio2.sfx("alarm");
    } else {
      // drain
      Game.player.hp -= dt * 2.5;
      if (Math.random() < 0.04) FX.spark(Game.player.hitPoint(), { color: 0xff2a3c, grav: -4, life: 0.5, size: 0.25 });
      if (Game.player.hp <= 0) { Game.player.hp = 0; Game.player.die(); }
      if (Math.random() < 0.01) Audio2.sfx("alarm");
    }
  }

  function loop() {
    requestAnimationFrame(loop);
    const dtReal = Math.min(Game.clock.getDelta(), 0.05);

    if (Game.state === "playing") {
      FX.update(dtReal);
      const dt = dtReal * FX.timeScale;
      Game.time += dt;

      updateMoveAxis();
      Game.player.update(dt, input, Game.camera);
      input.jumpPressed = false; input.jumpReleased = false;

      // enemies
      for (let i = Game.enemies.length - 1; i >= 0; i--) {
        const e = Game.enemies[i];
        e.update(dt);
        e.checkPhase();
        if (e.dead) {
          e.deadT += dt;
          // give the death animation time to play before the corpse goes
          if (e.deadT > 1.15) {
            Game.scene.remove(e.actor.group);
            Game.enemies.splice(i, 1);
          }
        }
      }

      updateSpawns(dt);
      updateProjectiles(dt);
      updateRings(dt);
      updateMeteors(dt);
      updatePickups(dt);
      updateAllies(dt);
      updateUltraTimer(dt);
      updateOccluders(dt);
      if (Game.stage) Game.stage.update(dt, Game.time);
      updateCamera(dtReal);

      if (Game.playerLight) Game.playerLight.position.set(Game.player.pos.x, Game.player.pos.y + 4, Game.player.pos.z);
      // viewer-side key light so the 3D characters stay readable when backlit
      if (Game.fillLight && Game.player) {
        Game.fillLight.position.copy(Game.camera.position);
        Game.fillLight.target.position.set(Game.player.pos.x, Game.player.pos.y + 2.2, Game.player.pos.z);
        Game.fillLight.target.updateMatrixWorld();
      }

      // boss add spawns in later stages
      if (Game.boss && !Game.boss.dead && Game.stageIndex >= 5) {
        Game.bossAddT -= dt;
        if (Game.bossAddT <= 0) {
          Game.bossAddT = 22;
          const cfg = World.STAGES[Game.stageIndex];
          for (let i = 0; i < 2; i++) Game.spawnEnemy(cfg.mobs[Math.floor(Math.random() * cfg.mobs.length)], { hpMul: 0.7 });
        }
      }

      // remove lock-on if dead
      if (Game.lockOn && Game.lockOn.dead) { Game.lockOn = null; }

      updateHud();
      $("dbg").textContent = "";
    } else if (Game.state === "paused" || Game.state === "clear" || Game.state === "dead" || Game.state === "victory") {
      FX.update(dtReal * 0.2);
      if (Game.stage) Game.stage.update(dtReal * 0.2, Game.time);
      // keep billboards facing camera
      if (Game.player) Game.player.actor.update(dtReal * 0.2, Game.camera);
      Game.enemies.forEach(function (e) {
        e.actor.update(dtReal * 0.2, Game.camera);
        if (e.dead) { e.deadT += dtReal * 0.2; if (e.deadT > 1.15) e.actor.group.visible = false; }
      });
      updateCamera(dtReal * 0.2);
    } else if (Game.state === "title") {
      Game.camera.position.set(Math.sin(Game.time * 0.2) * 26, 12, Math.cos(Game.time * 0.2) * 26);
      Game.camera.lookAt(0, 5, 0);
      Game.time += dtReal;
      FX.update(dtReal);
    }

    Game.renderer.render(Game.scene, Game.camera);
    adaptQuality(dtReal);
  }

  /* ================= adaptive resolution =================
     A safety net for weak GPUs only. The scene is light (≈45 draw
     calls, ≈45k triangles, ~2 ms of GPU submit), so the ratio is held
     at native up to 1.75 and only steps down if frames are badly long
     for a sustained stretch — and never below 1.0, because past that
     the picture blurs for no measurable gain.                     */
  const DPR_MAX = Math.min(window.devicePixelRatio || 1, 1.75);
  const DPR_MIN = 1.0;
  let dpr = Math.max(DPR_MIN, DPR_MAX), qAcc = 0, qN = 0;
  function adaptQuality(dt) {
    qAcc += dt; qN++;
    if (qN < 90) return;
    const avg = qAcc / qN; qAcc = 0; qN = 0;
    let next = dpr;
    if (avg > 0.030) next = Math.max(DPR_MIN, dpr - 0.15);        // < 33 fps
    else if (avg < 0.0140 && dpr < DPR_MAX) next = Math.min(DPR_MAX, dpr + 0.1);
    if (Math.abs(next - dpr) > 0.01) {
      dpr = next;
      Game.renderer.setPixelRatio(dpr);
      Game.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    Game.pixelRatio = Math.round(dpr * 100) / 100;
  }

  /* ================= boot ================= */
  window.addEventListener("load", function () {
    try { Game.init(); }
    catch (err) {
      console.error(err);
      const l = document.querySelector(".load-text");
      if (l) l.textContent = "ERROR: " + err.message;
    }
  });
})();
