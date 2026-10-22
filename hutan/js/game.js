/* ============================================================
   game.js — JAGA HUTAN / Operasi Hujan Buatan
   ------------------------------------------------------------
   Three stages. One forest per stage. The loop is:

     find the fire → put it out → get soaked → refuse to let
     the sawit crew plant → douse the demon → hammer the demon

   This file owns the scene, the camera, the stage data and the
   screens. Everything else is a system with an update(dt).
   ============================================================ */
(function () {
  "use strict";

  const STAGES = [
    {
      name: "TAMAN NASIONAL",
      sub: "BUKIT TIGAPULUH · RIAU",
      trees: 112, clusters: 10,
      spreadR: 20, spreadEvery: 0.82, burnRate: 5.1, spreadChance: 0.14, maxSpread: 1,
      windAngle: -0.7,
      bossHp: 2200,
      waves: [0.16, 0.30, 0.44], waveSize: [3, 4, 4],
      sawitLoss: 0.36, heli: 2,
      fog: 0x1b2a1f, fogNear: 90, fogFar: 430,
      sky: [0x0d1a20, 0x27392a, 0x7d5531]
    },
    {
      name: "HUTAN GAMBUT",
      sub: "KALIMANTAN TENGAH",
      trees: 126, clusters: 12,
      spreadR: 22, spreadEvery: 0.64, burnRate: 6.3, spreadChance: 0.17, maxSpread: 2,
      windAngle: 1.1,
      bossHp: 2600,
      waves: [0.13, 0.26, 0.38], waveSize: [4, 4, 5],
      sawitLoss: 0.34, heli: 2,
      fog: 0x241f18, fogNear: 70, fogFar: 360,
      sky: [0x141712, 0x33301f, 0x8a5a2a]
    },
    {
      name: "HUTAN HUJAN",
      sub: "PEGUNUNGAN PAPUA",
      trees: 140, clusters: 13,
      spreadR: 24, spreadEvery: 0.54, burnRate: 7.1, spreadChance: 0.2, maxSpread: 2,
      windAngle: 2.3,
      bossHp: 3000,
      waves: [0.10, 0.22, 0.34], waveSize: [4, 5, 5],
      sawitLoss: 0.32, heli: 3,
      fog: 0x1a2226, fogNear: 60, fogFar: 330,
      sky: [0x0b1820, 0x203232, 0x6b5a3a]
    }
  ];

  /* difficulty leans the whole fight toward the ranger:
     fewer flames per tick, softer hits, a shorter boss. */
  const DIFF = {
    santai: { playerHp: 150, dmg: 0.55, boss: 0.72, spread: 0.7, crew: 0.65, heli: 4 },
    normal: { playerHp: 120, dmg: 0.82, boss: 0.9, spread: 0.9, crew: 0.85, heli: 3 },
    nekat:  { playerHp: 105, dmg: 1.0, boss: 1.05, spread: 1.15, crew: 1.0, heli: 3 }
  };

  const G = {
    state: "boot",
    stageIdx: 0,
    score: 0,
    best: 0,
    stageTime: 0,
    waveIdx: 0,
    bossSpawnT: 8,
    bossSpawned: false,
    clearT: 0,
    overT: 0,
    muted: false,
    god: false,
    difficulty: "normal",
    startStageIdx: 0,
    dmgMul: 0.82,
    cfg: null
  };

  let scene, camera, renderer, clock;
  let forest, player, boss, planters, heli;
  let sky, sun;

  const cam = {
    yaw: 0, pitch: -0.4, dist: 20,
    pos: new THREE.Vector3(),
    look: new THREE.Vector3(),
    init: false
  };

  const input = {
    forward: false, back: false, left: false, right: false,
    sprint: false, jump: false, roll: false, fire: false
  };
  const keys = {};

  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function stageCfg() { return G.cfg || STAGES[G.stageIdx]; }

  /* ---------------------------------------------------------- boot */
  function boot() {
    Hud.init();

    const canvas = document.getElementById("gl");
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setClearColor(0x0b1410, 1);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.5, 1200);
    camera.position.set(0, 40, 70);

    scene.add(new THREE.HemisphereLight(0x8fb09c, 0x1e150e, 0.48));
    const dir = new THREE.DirectionalLight(0xffd2a0, 0.95);
    dir.position.set(-90, 140, 60);
    scene.add(dir);

    buildSky(STAGES[0]);

    FX.init(scene, camera, renderer);
    FireFX.init(scene, camera);

    forest = new Forest(scene);
    planters = new Planters(scene);
    heli = new Heli(scene);

    planters.onKill = function (p) {
      addScore(60);
      Hud.toast("PASUKAN SAWIT DIPUKUL · +60", "ember", 1400);
      FireFX.steamPuff({ x: p.pos.x, y: 1.5, z: p.pos.z }, 2, 1.5);
    };
    planters.onPlant = function (tree) {
      Hud.toast("SAWIT DITANAM — CABUT DENGAN PALU", "ember", 1600);
    };

    heli.onEvent = function (kind, data) {
      if (kind === "called") {
        Hud.banner("HELI JGSDF DIPANGGIL", "TIBA DALAM 4 DETIK · TANDA BIRU DI TANAH", 2600);
        Hud.toast("HUJAN BUATAN DALAM PERJALANAN", "water", 2400);
      } else if (kind === "arrived") {
        Hud.banner("HELI DI ATAS", "AIR SEGERA DITUMPAHKAN", 1600);
      } else if (kind === "drop") {
        addScore(20 + (data.hits || 0) * 15);
        Hud.toast("AIR DITUMPAHKAN · " + (data.hits || 0) + " TITIK API PADAM", "water", 2400);
      }
    };

    clock = new THREE.Clock();

    /* the title needs a world behind it */
    Hud.showScreen("loading");
    Hud.loading(0.02, "menyiapkan perlengkapan…");

    let progress = 0;
    Models.load(function (done, total) {
      progress = done / total;
      Hud.loading(0.05 + progress * 0.8, done < total ? "memuat orangutan…" : "menyiapkan hutan…");
    }).then(function () {
      /* the ranger himself */
      if (window.Orang) {
        Hud.loading(0.86, "memuat orangutan…");
        return Orang.load(function () {});
      }
      return false;
    }).then(function (ok) {
      if (window.Orang && !ok) {
        console.warn("[jaga hutan] orangutan unavailable, using the old rig");
      }
      /* the boss + crew models are fetched after the title is up */
      try { Models.loadRest(function () {}); } catch (e) {}
      try {
        if (window.Wowok) Wowok.load(function (ok) {
          if (!ok) console.warn("[jaga hutan] wowok unavailable, using stand-ins");
        });
      } catch (e) {}

      player = new Player(scene, {});
      player.god = G.god;
      bindPlayerEvents();

      forest.build(STAGES[0]);
      /* a couple of fires for the title backdrop */
      for (let i = 0; i < 3; i++) {
        const t = forest.randomAlive();
        if (t) forest.ignite(t, 0.5, true);
      }
      player.pos.set(forest.post.x, 0, forest.post.z + 10);

      Hud.loading(1, "siap.");
      setTimeout(function () {
        G.state = "title";
        Hud.showScreen("title");
        G.best = Number(localStorage.getItem("jaga-hutan-best") || 0);
        if (Hud.el.saveNote) {
          Hud.el.saveNote.textContent = G.best > 0 ? "SKOR TERBAIK " + G.best : "";
        }

        /* dev handle: /hutan/?shot=boss|fire|hud drives a capture scene */
        const shot = (location.search.match(/[?&]shot=([a-z]+)/) || [])[1];
        if (shot) {
          startGame();
          if (shot === "boss") {
            setTimeout(function () {
              spawnBoss();
              setTimeout(function () {
                if (!boss) return;
                player.pos.set(boss.pos.x + 20, 0, boss.pos.z + 20);
                cam.yaw = Math.atan2(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z);
                cam.pitch = -0.2;
                cam.dist = 27;
                cam.init = false;
              }, 700);
            }, 900);
          } else if (shot === "fire") {
            for (let i = 0; i < 5; i++) {
              const t = forest.trees[26 + i * 3];
              if (t) forest.ignite(t, 0.9, true);
            }
            setTimeout(function () {
              const t = (forest.burningList && forest.burningList[0]) || forest.trees[0];
              if (!t) return;
              player.pos.set(t.x + 20, 0, t.z + 20);
              cam.yaw = Math.atan2(t.x - player.pos.x, t.z - player.pos.z);
              cam.pitch = -0.16;
              cam.dist = 24;
              cam.init = false;
            }, 600);
          }
        }
      }, 320);

      requestAnimationFrame(frame);
    });
  }

  function buildSky(cfg) {
    if (sky) {
      scene.remove(sky);
      sky.geometry.dispose();
      sky.material.dispose();
    }
    const geo = new THREE.SphereGeometry(680, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        cTop: { value: new THREE.Color(cfg.sky[0]) },
        cMid: { value: new THREE.Color(cfg.sky[1]) },
        cBot: { value: new THREE.Color(cfg.sky[2]) }
      },
      vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: [
        "uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot;",
        "varying vec3 vP;",
        "void main(){",
        "  float h = normalize(vP).y;",
        "  vec3 c = h >= 0.0 ? mix(cMid, cTop, pow(h, 0.55)) : mix(cMid, cBot, pow(-h, 0.7));",
        "  gl_FragColor = vec4(c, 1.0);",
        "}"
      ].join("\n")
    });
    sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    scene.add(sky);

    /* a low sun behind the smoke */
    if (sun) { scene.remove(sun); }
    sun = new THREE.Mesh(
      new THREE.CircleGeometry(46, 32),
      new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.55, depthWrite: false })
    );
    sun.position.set(-330, 70, 470);
    sun.lookAt(0, 30, 0);
    scene.add(sun);

    /* horizon silhouettes */
    if (G.ridges) {
      G.ridges.forEach(function (m) { scene.remove(m); });
    }
    G.ridges = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.2;
      const r = 430 + Math.random() * 60;
      const h = 40 + Math.random() * 80;
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(60 + Math.random() * 50, h, 5),
        new THREE.MeshBasicMaterial({ color: 0x0e1714, transparent: true, opacity: 0.85 })
      );
      m.position.set(Math.cos(a) * r, h * 0.42 - 4, Math.sin(a) * r);
      m.rotation.y = Math.random() * 3;
      scene.add(m);
      G.ridges.push(m);
    }

    scene.fog = new THREE.Fog(cfg.fog, cfg.fogNear, cfg.fogFar);
    if (renderer) renderer.setClearColor(cfg.fog, 1);
  }

  function bindPlayerEvents() {
    /* the player talks to the world through this */
  }

  /* ---------------------------------------------------------- stages */
  function startGame() {
    G.stageIdx = G.startStageIdx || 0;
    G.score = 0;
    Hud._scoreShown = 0;
    startStage(G.stageIdx);
  }

  function startStage(idx) {
    G.stageIdx = idx;
    const base = STAGES[idx];
    const d = DIFF[G.difficulty] || DIFF.normal;
    G.dmgMul = d.dmg;

    /* scaled copy so the menu's difficulty actually reshapes the stage */
    const st = Object.assign({}, base, {
      bossHp: Math.round(base.bossHp * d.boss),
      spreadEvery: base.spreadEvery / d.spread,
      spreadChance: Math.min(0.34, base.spreadChance * d.spread),
      waveSize: base.waveSize.map(function (n) { return Math.max(1, Math.round(n * d.crew)); }),
      heli: Math.max(base.heli, d.heli)
    });
    G.cfg = st;

    buildSky(st);

    G.state = "playing";
    G.stageTime = 0;
    G.waveIdx = 0;
    G.bossSpawned = false;
    G.bossSpawnT = 8;
    G.clearT = 0;
    G.overT = 0;

    if (boss) { boss.dispose(); boss = null; }
    planters.clear();
    FireFX.reset();
    if (window.FX) FX.reset();

    forest.build(st);
    forest.onBurnOut = function () {};
    heli.reset(st.heli);

    player.maxHp = d.playerHp;
    player.dead = false;
    player.deadT = 0;
    player.hp = player.maxHp;
    player.water = player.maxWater;
    player.invuln = 2;
    player.vel.set(0, 0, 0);
    player.pos.set(forest.post.x, 0, forest.post.z + 11);
    player.grounded = true;
    player.group.visible = true;
    if (player.actor) {
      player.actor.dead = false;
      player.actor.group.visible = true;
      player.actor.setState({ speed: 0 });
    }
    player.setWeapon("hose");
    /* spawn facing the treeline, outpost over the left shoulder */
    player.yaw = Math.PI * 0.58;
    cam.yaw = Math.PI * 0.58;
    cam.pitch = -0.42;
    cam.init = false;

    /* the reserve is already smoking when the ranger arrives */
    for (let i = 0; i < 2; i++) {
      const t = forest.randomAlive();
      if (t && Math.abs(t.x) + Math.abs(t.z) > 40) forest.ignite(t, 0.45, true);
    }

    Hud.hideScreens();
    Hud.banner("TAHAP " + (idx + 1) + " — " + st.name, st.sub + " · SELAMATKAN HUTAN", 3200);
    if (window.TouchPad && TouchPad.on) {
      Hud.toast("GESER KIRI: JALAN · GESER LAYAR: LIRIK · AKSI: SEMPROT/PALU", "", 4000);
    } else {
      Hud.toast("1 SELANG · 2 PALU · G PANGGIL HELI", "", 3400);
    }

    if (window.TouchPad && TouchPad.on) return;
    if (!document.pointerLockElement) {
      try { renderer.domElement.requestPointerLock(); } catch (e) {}
    }
  }

  function restartStage() {
    if (G.state === "clear" && G.stageIdx + 1 < STAGES.length) {
      startStage(G.stageIdx + 1);
    } else {
      startStage(G.stageIdx);
    }
  }

  function stageClear() {
    if (G.state !== "playing") return;
    G.state = "clear";
    document.exitPointerLock && document.exitPointerLock();

    const st = forest.stats();
    const bonus = Math.round(st.forestPct * 620) + 350;
    G.score += bonus;

    const rows = [
      ["HUTAN TERSISA", Math.round(st.forestPct * 100) + "%", "g"],
      ["SAWIT DICEGAH", Math.round(st.sawitPct * 100) + "%", "w"],
      ["PASUKAN DIPUKUL", player.stats.bonked, "e"],
      ["WAKTU", fmtTime(G.stageTime), ""],
      ["BONUS HUTAN", "+" + bonus, "g"],
      ["SKOR", G.score, ""]
    ];
    Hud.el.clearStats.innerHTML = rows.map(function (r) {
      return '<div class="st"><span>' + r[0] + "</span><b class=\"" + r[2] + "\">" + r[1] + "</b></div>";
    }).join("");

    const last = G.stageIdx >= STAGES.length - 1;
    const btn = document.getElementById("nextBtn");
    if (btn) btn.textContent = last ? "MAIN LAGI" : "TAHAP BERIKUTNYA";

    saveBest();
    Hud.showScreen("clear");
    if (window.Audio2) Audio2.sfx(last ? "levelup" : "uiBig");
  }

  function gameOver(reason) {
    if (G.state !== "playing") return;
    G.state = "over";
    document.exitPointerLock && document.exitPointerLock();
    const st = forest.stats();
    const rows = [
      ["HUTAN TERSISA", Math.round(st.forestPct * 100) + "%", ""],
      ["JADI SAWIT", Math.round(st.sawitPct * 100) + "%", "w"],
      ["PASUKAN DIPUKUL", player.stats.bonked, "e"],
      ["WAKTU", fmtTime(G.stageTime), ""],
      ["SKOR", G.score, ""],
      ["TAHAP", G.stageIdx + 1, ""]
    ];
    Hud.el.overStats.innerHTML = rows.map(function (r) {
      return '<div class="st"><span>' + r[0] + "</span><b class=\"" + r[2] + "\">" + r[1] + "</b></div>";
    }).join("");

    if (Hud.el.overText) {
      Hud.el.overText.textContent = reason === "sawit"
        ? "Terlalu banyak tanah hangus. Pasukan sawit masuk dan menanam baris demi baris — hutan ini sekarang kebun."
        : "Sang Bakar menang. Tidak ada yang tersisa untuk dijaga.";
    }
    saveBest();
    Hud.showScreen("gameover");
    if (window.Audio2) Audio2.sfx("lose");
  }

  function saveBest() {
    if (G.score > G.best) {
      G.best = Math.round(G.score);
      try { localStorage.setItem("jaga-hutan-best", String(G.best)); } catch (e) {}
    }
  }

  function addScore(n) {
    G.score += n;
  }

  function fmtTime(t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  /* ---------------------------------------------------------- input */

  /* keyboard and the touch pad share one action table */
  function doAction(name) {
    if (G.state !== "playing" || !player) return;
    if (name === "hose") player.setWeapon("hose");
    else if (name === "hammer") player.setWeapon("hammer");
    else if (name === "swap") player.setWeapon(player.weapon === "hose" ? "hammer" : "hose");
    else if (name === "heli") callHeli();
    else if (name === "roll") input.roll = true;
    else if (name === "jump") input.jump = true;
    else if (name === "god") {
      G.god = !G.god;
      if (player) player.god = G.god;
      if (window.Hud && Hud.god) Hud.god(G.god);
      Hud.toast(G.god ? "MODE DEWA · TAK TERKALAHKAN" : "MODE DEWA MATI",
        G.god ? "ember" : "", 1600);
    }
  }

  function bindInput() {
    window.addEventListener("keydown", function (e) {
      if (e.repeat) {
        if (e.code === "Space" || e.code.indexOf("Arrow") === 0) e.preventDefault();
        return;
      }
      keys[e.code] = true;

      if (e.code === "Space" || e.code.indexOf("Arrow") === 0) e.preventDefault();

      if (e.code === "Escape") {
        if (G.state === "playing") pauseGame();
        else if (G.state === "paused") resumeGame();
        return;
      }
      if (e.code === "KeyM") {
        G.muted = !G.muted;
        if (window.Audio2) Audio2.setMuted(G.muted);
        Hud.toast(G.muted ? "SUARA DIMATIKAN" : "SUARA DINYALAKAN", "", 1200);
        return;
      }
      if (e.code === "KeyF") { doAction("god"); return; }

      if (G.state !== "playing") return;

      if (e.code === "Digit1") doAction("hose");
      else if (e.code === "Digit2") doAction("hammer");
      else if (e.code === "Tab") {
        e.preventDefault();
        doAction("swap");
      } else if (e.code === "KeyG") {
        doAction("heli");
      } else if (e.code === "KeyQ") {
        doAction("roll");
      } else if (e.code === "Space") {
        doAction("jump");
      }
    });

    window.addEventListener("keyup", function (e) {
      keys[e.code] = false;
    });

    const canvas = renderer.domElement;

    /* the mouse is for looking only: every action is on the keyboard */
    canvas.addEventListener("mousedown", function (e) {
      if (window.TouchPad && TouchPad.on) return;
      if (G.state === "playing" && !document.pointerLockElement) {
        try { canvas.requestPointerLock(); } catch (err) {}
      }
    });

    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    document.addEventListener("mousemove", function (e) {
      if (document.pointerLockElement !== canvas) return;
      cam.yaw -= e.movementX * 0.0023;
      cam.pitch = clamp(cam.pitch - e.movementY * 0.0017, -0.95, 0.16);
    });

    canvas.addEventListener("wheel", function (e) {
      if (G.state !== "playing") return;
      cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 2.2, 13, 42);
    }, { passive: true });

    /* dragging also turns the camera, for when pointer lock is blocked */
    let dragging = false, lx = 0, ly = 0;
    canvas.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "touch" || e.pointerType === "pen") return;
      if (document.pointerLockElement === canvas) return;
      dragging = true; lx = e.clientX; ly = e.clientY;
    });
    window.addEventListener("pointerup", function (e) {
      if (e.pointerType === "touch" || e.pointerType === "pen") return;
      dragging = false;
    });
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch" || e.pointerType === "pen") return;
      if (!dragging || document.pointerLockElement === canvas) return;
      cam.yaw -= (e.clientX - lx) * 0.006;
      cam.pitch = clamp(cam.pitch - (e.clientY - ly) * 0.004, -0.95, 0.16);
      lx = e.clientX; ly = e.clientY;
    });

    window.addEventListener("resize", function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener("blur", function () {
      input.fire = false;
      if (G.state === "playing") pauseGame();
    });

    /* ---------------- title menu ---------------- */
    const diffKey = "jaga-hutan-diff";
    try {
      const savedDiff = localStorage.getItem(diffKey);
      if (savedDiff && DIFF[savedDiff]) G.difficulty = savedDiff;
    } catch (e) {}

    function markOpts(sel, attr, value) {
      document.querySelectorAll(sel).forEach(function (b) {
        b.classList.toggle("on", b.getAttribute(attr) === String(value));
      });
    }

    if (Hud.setTab) Hud.setTab("mulai");
    markOpts("#stageOpts .opt", "data-stage", G.startStageIdx);
    markOpts("#diffOpts .opt", "data-diff", G.difficulty);

    document.querySelectorAll("#title .arc-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        const tab = b.getAttribute("data-tab");
        if (tab === "mulai") {
          if (window.Audio2) Audio2.init();
          G.startStageIdx = Number(document.querySelector("#stageOpts .opt.on") ?
            document.querySelector("#stageOpts .opt.on").getAttribute("data-stage") : 0) || 0;
          startGame();
          return;
        }
        Hud.setTab(tab);
      });
    });

    const sheetClose = document.getElementById("sheetClose");
    if (sheetClose) {
      sheetClose.addEventListener("click", function () {
        if (Hud.closeSheet) Hud.closeSheet();
        if (window.Audio2) Audio2.sfx("ui");
      });
    }

    document.querySelectorAll("#stageOpts .opt").forEach(function (b) {
      b.addEventListener("click", function () {
        G.startStageIdx = Number(b.getAttribute("data-stage")) || 0;
        markOpts("#stageOpts .opt", "data-stage", G.startStageIdx);
      });
    });

    document.querySelectorAll("#diffOpts .opt").forEach(function (b) {
      b.addEventListener("click", function () {
        G.difficulty = b.getAttribute("data-diff");
        markOpts("#diffOpts .opt", "data-diff", G.difficulty);
        try { localStorage.setItem(diffKey, G.difficulty); } catch (e) {}
        if (window.Audio2) Audio2.sfx("ui");
      });
    });

    const reload = document.getElementById("reloadBtn");
    if (reload) reload.addEventListener("click", function () { location.reload(); });

    window.addEventListener("keydown", function (e) {
      if (G.state !== "title") return;
      if (e.key === "Enter") {
        if (window.Audio2) Audio2.init();
        startGame();
      } else if (e.key === "Escape") {
        Hud.setTab("mulai");
      }
    });

    /* difficulty softly scales incoming damage (installed on the prototype
       so it is live before the player finishes loading) */
    if (window.Player && !Player.prototype._dmgScaled) {
      const rawDamage = Player.prototype.damage;
      Player.prototype.damage = function (amount, from) {
        return rawDamage.call(this, amount * (G.dmgMul || 1), from);
      };
      Player.prototype._dmgScaled = true;
    }

    /* buttons */
    const start = document.getElementById("startBtn");
    if (start) start.addEventListener("click", function () {
      if (window.Audio2) Audio2.init();
      startGame();
    });

    const resume = document.getElementById("resumeBtn");
    if (resume) resume.addEventListener("click", resumeGame);
    const quit = document.getElementById("quitBtn");
    if (quit) quit.addEventListener("click", function () { startStage(G.stageIdx); });
    const next = document.getElementById("nextBtn");
    if (next) next.addEventListener("click", function () {
      if (G.stageIdx + 1 < STAGES.length) startStage(G.stageIdx + 1);
      else { G.state = "title"; Hud.showScreen("title"); }
    });
    const retry = document.getElementById("retryBtn");
    if (retry) retry.addEventListener("click", function () { startStage(G.stageIdx); });

    Hud.onWeapon = function (w) {
      if (G.state === "playing") player.setWeapon(w);
    };
  }

  function callHeli() {
    if (!heli.canCall()) {
      Hud.toast(heli.charges <= 0 ? "TIDAK ADA HELI LAGI TAHAP INI" : "HELI MASIH DI JALAN", "ember", 1600);
      return;
    }
    const tx = player.pos.x + Math.sin(cam.yaw) * 34;
    const tz = player.pos.z + Math.cos(cam.yaw) * 34;
    const r = Math.sqrt(tx * tx + tz * tz);
    const maxR = forest.radius - 10;
    const x = r > maxR ? (tx / r) * maxR : tx;
    const z = r > maxR ? (tz / r) * maxR : tz;
    if (!heli.call(x, z)) return;
    G.heliAim = new THREE.Vector3(x, 0, z);
  }

  function pauseGame() {
    if (G.state !== "playing") return;
    G.state = "paused";
    input.fire = false;
    if (document.pointerLockElement) document.exitPointerLock();
    if (Hud.el.pauseStage) Hud.el.pauseStage.textContent = STAGES[G.stageIdx].name + " · " + fmtTime(G.stageTime);
    Hud.showScreen("pause");
  }

  function resumeGame() {
    if (G.state !== "paused") return;
    G.state = "playing";
    Hud.hideScreens();
    if (window.TouchPad && TouchPad.on) return;
    try { renderer.domElement.requestPointerLock(); } catch (e) {}
  }

  /* ---------------------------------------------------------- update */
  function update(dt, raw) {
    G.stageTime += dt;

    /* the touch stick is analog: it feeds the same booleans, with a deadzone */
    const touch = window.TouchPad && TouchPad.on ? TouchPad : null;
    let ax = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    let az = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    if (touch) { ax += touch.move.x; az -= touch.move.y; }
    const dead = 0.24;
    input.forward = az > dead;
    input.back = az < -dead;
    input.right = ax > dead;
    input.left = ax < -dead;
    input.sprint = !!(keys.ShiftLeft || keys.ShiftRight) ||
      (!!touch && Math.hypot(ax, az) > 0.92);
    /* J is the action button: hold to spray, hold to keep swinging */
    input.fire = !!keys.KeyJ || (!!touch && touch.fire);

    /* the arrow keys turn the camera, in the same directions as the mouse */
    const lookX = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0);
    const lookY = (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0);
    if (lookX) cam.yaw += lookX * 1.9 * dt;
    if (lookY) cam.pitch = clamp(cam.pitch + lookY * 1.05 * dt, -0.95, 0.16);

    const ctx = {
      camera: camera,
      input: input,
      forest: forest,
      player: player,
      boss: boss,
      planters: planters.list,
      fireballs: boss ? boss.fireballs : [],
      heliAim: G.heliAim,
      onEvent: onPlayerEvent
    };

    /* the boss arrives a little after the stage starts */
    if (!G.bossSpawned && G.stageTime > G.bossSpawnT) {
      G.bossSpawned = true;
      spawnBoss();
    }

    player.update(dt, ctx);

    if (G.god) {
      /* unlimited: water and heli calls never run out */
      if (heli.charges < 3) heli.charges = 3;
    }

    if (boss) boss.update(dt, ctx);
    planters.update(dt, ctx);
    heli.update(dt, ctx);

    forest.update(dt, camera);
    FireFX.update(dt);

    checkWaves();
    checkEnd();

    updateCamera(dt, raw);

    Hud.update({
      hp: player.hp, maxHp: player.maxHp,
      water: player.water, maxWater: player.maxWater,
      weapon: player.weapon, spraying: player.spraying,
      heliCharges: heli.charges, heliMax: stageCfg().heli,
      plantersAlive: planters.list.filter(function (p) { return p.alive; }).length,
      stage: G.stageIdx + 1, stageTotal: STAGES.length,
      stageName: stageCfg().name,
      stats: forest.stats(), score: Math.round(G.score), time: G.stageTime, dt: dt,
      boss: boss && !boss.gone
        ? { active: true, hp: boss.hp, maxHp: boss.maxHp, soak: boss.soak, doused: boss.doused }
        : { active: false },
      hint: hintText()
    });

    Hud.minimap(dt, {
      forest: forest, player: player, boss: boss,
      planters: planters.list, radius: forest.radius,
      camYaw: cam.yaw,
      heliTarget: heli.state !== "idle" ? heli.target : null
    });
  }

  function hintText() {
    if (player.dead) return "RANGER DIEVAKUASI — KEMBALI DALAM BEBERAPA DETIK";
    if (player.water <= 1) return "TANGKI KOSONG — ISI DI KOLAM ATAU DRUM";
    if (forest.waterSource(player.pos.x, player.pos.z)) return "MENGISI AIR…";
    if (heli.canCall()) return "G: PANGGIL HELI (" + heli.charges + ")";
    if (boss && boss.doused) return "SANG BAKAR PADAM — PALU SEKARANG!";
    const burn = forest.stats().burning;
    if (burn > 0) return burn + " POHON TERBAKAR — SEMPROT DENGAN SELANG";
    return "TIDAK ADA API · JAGA TANAH DARI SAWIT";
  }

  function onPlayerEvent(kind, data) {
    if (kind === "respawn") {
      Hud.banner("RANGER KEMBALI", "POS JAGA · TANGKI PENUH", 1800);
    } else if (kind === "palmCleared") {
      addScore(30);
      Hud.toast("SAWIT DICABUT · +30", "ember", 1200);
    } else if (kind === "bonk") {
      addScore(10);
    } else if (kind === "bossSmash") {
      addScore(8);
    } else if (kind === "fireballDown") {
      addScore(15);
      Hud.toast("BOLA API DITEMBAK AIR", "water", 1200);
    }
  }

  function spawnBoss() {
    const a = Math.atan2(player.pos.z, player.pos.x) + Math.PI + (Math.random() - 0.5) * 0.7;
    const r = forest.radius - 18;
    boss = new Boss(scene, {
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      hp: stageCfg().bossHp
    });
    boss.onEvent = function (kind, b) {
      if (kind === "doused") {
        addScore(120);
        Hud.banner("SANG BAKAR PADAM", "HANTAM DENGAN PALU — SEKARANG", 2400);
        FX.flash(0.12, 0x9fe8ff);
      } else if (kind === "bossPhase") {
        Hud.banner("SANG BAKAR MARAH", "API MENYEBAR LEBIH CEPAT", 2200);
        FireFX.setWind(Math.cos(forest.windAngle + 0.4), Math.sin(forest.windAngle + 0.4));
      } else if (kind === "bossRage") {
        Hud.toast("SANG BAKAR BANGKIT — LEBIH CEPAT", "ember", 2000);
      } else if (kind === "bossDown") {
        addScore(500);
        Hud.banner("SANG BAKAR PADAM PERMANEN", "HUTAN BERNAFAS LAGI", 3000);
      } else if (kind === "bossGone") {
        setTimeout(function () {
          if (G.state === "playing") stageClear();
        }, 600);
      }
    };
    Hud.banner("SANG BAKAR DATANG", "JANGAN BIARKAN DIA MENYENTUH POHON", 2800);
    if (window.Audio2) Audio2.sfx("roarBig");
    FX.shake(0.6);
  }

  function checkWaves() {
    const st = stageCfg();
    const stats = forest.stats();
    if (G.waveIdx >= st.waves.length) return;
    if (stats.burntPct < st.waves[G.waveIdx]) return;
    const n = st.waveSize[G.waveIdx];
    G.waveIdx++;
    planters.spawnWave(n);
    Hud.banner("PASUKAN SAWIT DATANG", n + " ORANG MENUJU TANAH HANGUS · PALU MEREKA", 3000);
    Hud.toast("TANAH HANGUS = LAHAN SAWIT", "ember", 2600);
  }

  function checkEnd() {
    if (G.state !== "playing") return;
    const stats = forest.stats();
    if (stats.sawitPct >= stageCfg().sawitLoss) {
      gameOver("sawit");
    } else if (stats.alive === 0 && stats.burning === 0) {
      gameOver("burn");
    }
  }

  /* ---------------------------------------------------------- camera */
  function updateCamera(dt, raw) {
    const focus = _v.copy(player.pos);
    focus.y += player.height * 0.72;

    const cp = Math.cos(cam.pitch);
    const fwd = _v2.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);

    const desired = new THREE.Vector3(
      focus.x - fwd.x * cam.dist,
      focus.y - fwd.y * cam.dist + 2.2,
      focus.z - fwd.z * cam.dist
    );
    /* never dip under the canopy floor */
    desired.y = Math.max(3.2, desired.y);

    /* pull the camera in if a canopy would swallow it: each tree is
       one sphere, so this is a handful of quadratic roots per frame */
    if (forest) {
      const trees = forest.trees;
      const dx = desired.x - focus.x;
      const dy = desired.y - focus.y;
      const dz = desired.z - focus.z;
      const a = dx * dx + dy * dy + dz * dz;
      let tt = 1;
      for (let i = 0; i < trees.length; i++) {
        const tr = trees[i];
        const cy = tr.h * 0.76;
        const rr = tr.r * 0.95;
        const ox = focus.x - tr.x;
        const oy = focus.y - cy;
        const oz = focus.z - tr.z;
        const b = 2 * (ox * dx + oy * dy + oz * dz);
        const c = ox * ox + oy * oy + oz * oz - rr * rr;
        const disc = b * b - 4 * a * c;
        if (disc <= 0) continue;
        const t0 = (-b - Math.sqrt(disc)) / (2 * a);
        if (t0 > 0.04 && t0 < tt) tt = Math.max(0.24, t0 - 0.03);
      }
      if (tt < 1) {
        desired.set(focus.x + dx * tt, Math.max(2.4, focus.y + dy * tt), focus.z + dz * tt);
      }
    }

    if (!cam.init) {
      cam.pos.copy(desired);
      cam.look.copy(focus);
      cam.init = true;
    } else {
      const k = 1 - Math.exp(-9 * dt);
      cam.pos.lerp(desired, k);
    }
    const lookK = 1 - Math.exp(-13 * dt);
    cam.look.lerp(focus, lookK);

    camera.position.copy(cam.pos).add(FX.shakeOffset);
    camera.lookAt(cam.look);
  }

  function updateTitle(dt) {
    if (!forest) return;
    const t = performance.now() * 0.00004;
    const r = 112;
    camera.position.set(Math.cos(t) * r, 48 + Math.sin(t * 1.7) * 6, Math.sin(t) * r);
    camera.lookAt(forest.post.x, 7, forest.post.z);
    forest.update(dt, camera);
    FireFX.update(dt);
    if (player) {
      player.pos.set(forest.post.x, 0, forest.post.z + 11);
      player._applyTransform(dt, { camera: camera });
    }
    Hud.minimap(dt, {
      forest: forest, player: player, boss: null, planters: [], radius: forest.radius
    });
  }

  /* ---------------------------------------------------------- frame */
  function frame() {
    requestAnimationFrame(frame);
    const raw = Math.min(0.05, clock.getDelta());
    if (window.TouchPad) TouchPad.sync(G.state);

    if (G.state === "playing") {
      FX.update(raw);
      const dt = raw * FX.timeScale;
      update(dt, raw);
    } else if (G.state === "title") {
      FX.update(raw);
      updateTitle(raw);
    } else if (G.state === "clear" || G.state === "over") {
      FX.update(raw);
      FireFX.update(raw);
      if (forest) forest.update(raw * 0.6, camera);
      if (player) player._applyTransform(raw, { camera: camera });
      if (boss) boss.update(raw * 0.4, { camera: camera, player: player, forest: forest });
      if (G.stageIdx >= 0) {
        camera.position.copy(cam.pos).add(FX.shakeOffset);
        camera.lookAt(cam.look);
      }
    }

    renderer.render(scene, camera);
  }

  /* ---------------------------------------------------------- go */
  window.addEventListener("load", function () {
    boot();
    bindInput();
  });

  window.JagaHutan = {
    startGame: startGame,
    action: doAction,
    pause: pauseGame,
    resume: resumeGame,
    /* dev handles: used to drive the game from the console while tuning */
    debug: {
      cam: cam, input: input, stages: STAGES,
      get forest() { return forest; },
      get player() { return player; },
      get boss() { return boss; },
      get planters() { return planters; },
      get heli() { return heli; },
      spawnBoss: function () { if (!boss) spawnBoss(); },
      nextStage: function () { startStage(Math.min(STAGES.length - 1, G.stageIdx + 1)); },
      addScore: addScore,
      /* drive one frame by hand: useful when the tab is backgrounded
         (rAF stops) and for offline captures */
      frame: frame,
      clear: stageClear,
      hurt: function (n) { player.damage(n, null); }
    },
    stages: STAGES,
    get state() { return G.state; },
    get player() { return player; },
    get forest() { return forest; },
    get boss() { return boss; },
    get heli() { return heli; },
    get score() { return G.score; }
  };
})();
