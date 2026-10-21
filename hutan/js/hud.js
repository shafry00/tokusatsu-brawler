/* ============================================================
   hud.js — the ops board
   ------------------------------------------------------------
   Glanceable, minimal, diegetic-ish: vitals on the left, a
   bearing strip on top, the tool wheel on the right, and the
   forest/plantation meters tucked into the top corner.

   The compass + radar matter most: fire hides behind the
   canopy, so bearings are how you find it before it spreads.
   ============================================================ */
(function () {
  "use strict";

  const Hud = {
    el: {},
    _bannerT: 0,
    _toastT: 0,
    _hurtT: 0,
    _mapT: 0,
    _compT: 0,
    _scoreShown: 0,
    _heliMax: -1,
    _tab: "mulai"
  };

  function $(id) { return document.getElementById(id); }
  function wrapPi(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  Hud.init = function () {
    ["hud", "hpFill", "hpText", "hpMax", "waterFill", "waterText",
      "hint", "stageNum", "stageTotal", "stageName", "forestFill", "forestPct",
      "sawitFill", "sawitPct", "score", "clock", "boss", "bossName", "bossSub",
      "bossFill", "bossSoak", "banner", "toast", "hurt", "minimap", "crosshair",
      "compass", "wheel", "wheelName", "wheelAmmo", "segHose", "segHammer",
      "labHose", "labHammer", "heliRow", "heliText", "fireCount", "sawitCount",
      "tankPct",
      "loading", "loadFill", "loadText", "title", "pause", "clear", "gameover",
      "clearStats", "overStats", "startBtn", "resumeBtn", "quitBtn", "nextBtn",
      "retryBtn", "saveNote", "pauseStage", "overText", "reloadBtn"].forEach(function (id) {
        Hud.el[id] = $(id);
      });

    Hud.ctx = Hud.el.minimap ? Hud.el.minimap.getContext("2d") : null;
    Hud.cctx = Hud.el.compass ? Hud.el.compass.getContext("2d") : null;

    /* the wheel segments and their labels both switch tools */
    [Hud.el.segHose, Hud.el.segHammer, Hud.el.labHose, Hud.el.labHammer].forEach(function (node) {
      if (!node) return;
      node.style.pointerEvents = "auto";
      node.addEventListener("pointerdown", function (e) {
        e.stopPropagation();
        e.preventDefault();
        if (Hud.onWeapon) Hud.onWeapon(node.getAttribute("data-w"));
      });
    });
  };

  /* ---------------------------------------------------------- screens */
  Hud.showScreen = function (id) {
    ["loading", "title", "pause", "clear", "gameover"].forEach(function (k) {
      const e = Hud.el[k];
      if (!e) return;
      e.classList.toggle("hidden", k !== id);
    });
    Hud.el.hud.classList.toggle("hidden", !!id);
  };

  Hud.hideScreens = function () {
    ["loading", "title", "pause", "clear", "gameover"].forEach(function (k) {
      if (Hud.el[k]) Hud.el[k].classList.add("hidden");
    });
    Hud.el.hud.classList.remove("hidden");
  };

  Hud.loading = function (frac, text) {
    if (Hud.el.loadFill) Hud.el.loadFill.style.width = Math.round(frac * 100) + "%";
    if (text && Hud.el.loadText) Hud.el.loadText.textContent = text;
  };

  /* ---------------------------------------------------------- title tabs */
  Hud.setTab = function (tab) {
    Hud._tab = tab;
    document.querySelectorAll("#title .arc-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === tab);
    });
    document.querySelectorAll("#menuPanel .pane").forEach(function (p) {
      p.classList.toggle("active", p.getAttribute("data-pane") === tab);
    });
  };

  /* ---------------------------------------------------------- banner */
  Hud.banner = function (text, sub, ms) {
    const b = Hud.el.banner;
    if (!b) return;
    b.innerHTML = text + (sub ? "<small>" + sub + "</small>" : "");
    b.classList.add("show");
    Hud._bannerT = (ms || 2200) / 1000;
  };

  Hud.toast = function (text, kind, ms) {
    const t = Hud.el.toast;
    if (!t) return;
    t.textContent = text;
    t.className = "toast show" + (kind ? " " + kind : "");
    Hud._toastT = (ms || 1800) / 1000;
  };

  Hud.hurt = function () {
    if (Hud.el.hurt) {
      Hud.el.hurt.style.opacity = "1";
      Hud._hurtT = 0.26;
    }
  };

  /* ---------------------------------------------------------- update */
  Hud.update = function (s) {
    const e = Hud.el;
    const hr = Math.max(0, s.hp / s.maxHp);

    e.hpFill.style.width = (hr * 100) + "%";
    e.hpText.textContent = Math.ceil(s.hp);
    e.hpMax.textContent = s.maxHp;
    e.hpFill.parentNode.classList.toggle("low", hr < 0.34);

    const wf = s.water / s.maxWater;
    e.waterFill.style.width = (wf * 100) + "%";
    e.waterText.textContent = wf <= 0 ? "TANGKI KOSONG" : "AIR " + Math.ceil(s.water);
    e.waterFill.parentNode.parentNode.classList.toggle("empty", wf <= 0.001);
    e.tankPct.textContent = Math.ceil(wf * 100);

    /* tool wheel */
    const hose = s.weapon === "hose";
    if (e.segHose) e.segHose.classList.toggle("on", hose);
    if (e.segHammer) e.segHammer.classList.toggle("on", !hose);
    if (e.labHose) e.labHose.classList.toggle("on", hose);
    if (e.labHammer) e.labHammer.classList.toggle("on", !hose);
    e.wheelName.textContent = hose ? "SELANG" : "PALU";
    e.wheelAmmo.textContent = hose ? Math.ceil(s.water) : "×2.4";
    if (e.wheel) {
      const unit = e.wheel.querySelector(".wunit");
      if (unit) unit.textContent = hose ? "AIR" : "PUKUL";
    }

    /* heli charges */
    if (Hud._heliMax !== s.heliMax) {
      Hud._heliMax = s.heliMax;
      e.heliRow.innerHTML = "";
      for (let i = 0; i < s.heliMax; i++) {
        const p = document.createElement("i");
        e.heliRow.appendChild(p);
      }
    }
    const pips = e.heliRow.children;
    for (let i = 0; i < pips.length; i++) pips[i].classList.toggle("on", i < s.heliCharges);
    e.heliText.textContent = s.heliCharges;

    /* stage + forest */
    e.stageNum.textContent = s.stage;
    e.stageTotal.textContent = s.stageTotal;
    e.stageName.textContent = s.stageName;

    const fp = Math.round(s.stats.forestPct * 100);
    const sp = Math.round(s.stats.sawitPct * 100);
    e.forestFill.style.width = fp + "%";
    e.forestPct.textContent = fp + "%";
    e.sawitFill.style.width = Math.min(100, sp * 2.2) + "%";
    e.sawitPct.textContent = sp + "%";

    /* field chips */
    e.fireCount.textContent = s.stats.burning;
    e.sawitCount.textContent = s.plantersAlive || 0;
    e.fireCount.parentNode.classList.toggle("hot", s.stats.burning > 5);

    /* score rolls up so a big hit reads as a big hit */
    Hud._scoreShown += (s.score - Hud._scoreShown) * 0.18;
    if (Math.abs(s.score - Hud._scoreShown) < 1) Hud._scoreShown = s.score;
    e.score.textContent = Math.round(Hud._scoreShown);

    const mm = Math.floor(s.time / 60);
    const ss = Math.floor(s.time % 60);
    e.clock.textContent = mm + ":" + (ss < 10 ? "0" : "") + ss;

    if (s.hint && e.hint.textContent !== s.hint) e.hint.textContent = s.hint;

    /* boss */
    if (s.boss && s.boss.active) {
      e.boss.classList.remove("hidden");
      e.boss.classList.toggle("doused", !!s.boss.doused);
      e.bossFill.style.width = Math.max(0, s.boss.hp / s.boss.maxHp * 100) + "%";
      e.bossSoak.style.width = Math.max(0, Math.min(100, s.boss.soak)) + "%";
      if (s.boss.doused) {
        e.bossSub.textContent = "PADAM — HANTAM DENGAN PALU!";
      } else if (s.boss.soak > 72) {
        e.bossSub.textContent = "HAMPIR PADAM — TERUS SIRAM";
      } else if (s.boss.soak > 35) {
        e.bossSub.textContent = "BASAH " + Math.round(s.boss.soak) + "%";
      } else {
        e.bossSub.textContent = "SIRAM HINGGA PADAM, LALU HANTAM DENGAN PALU";
      }
    } else {
      e.boss.classList.add("hidden");
    }

    /* crosshair reflects what is in hand */
    e.crosshair.classList.toggle("hot", hose && s.spraying);

    /* timers */
    const dt = s.dt || 0.016;
    if (Hud._bannerT > 0) {
      Hud._bannerT -= dt;
      if (Hud._bannerT <= 0) e.banner.classList.remove("show");
    }
    if (Hud._toastT > 0) {
      Hud._toastT -= dt;
      if (Hud._toastT <= 0) e.toast.classList.remove("show");
    }
    if (Hud._hurtT > 0) {
      Hud._hurtT -= dt;
      if (Hud._hurtT <= 0) e.hurt.style.opacity = "0";
    }
  };

  /* ---------------------------------------------------------- compass */
  const DIRS = ["U", "TL", "T", "TG", "S", "BD", "B", "BL"];

  Hud.compass = function (dt, world) {
    if (!Hud.cctx) return;
    Hud._compT += dt;
    if (Hud._compT < 0.033) return;
    Hud._compT = 0;

    const c = Hud.cctx;
    const W = 800, H = 64;
    const cx = W / 2;
    const px = 5.2;              /* canvas pixels per degree */
    const half = 74;             /* degrees visible each side */
    const yaw = world.camYaw || 0;
    const yawDeg = yaw * 180 / Math.PI;

    c.clearRect(0, 0, W, H);

    c.save();

    /* soft glass band so the strip reads over bright canopy */
    const bg = c.createLinearGradient(0, 0, W, 0);
    bg.addColorStop(0, "rgba(3,7,8,0)");
    bg.addColorStop(0.16, "rgba(3,7,8,.55)");
    bg.addColorStop(0.5, "rgba(3,7,8,.66)");
    bg.addColorStop(0.84, "rgba(3,7,8,.55)");
    bg.addColorStop(1, "rgba(3,7,8,0)");
    c.fillStyle = bg;
    c.fillRect(0, 4, W, 46);

    c.strokeStyle = "rgba(242,236,224,.16)";
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(cx - half * px, 40);
    c.lineTo(cx + half * px, 40);
    c.stroke();

    /* ticks */
    for (let b = 0; b < 360; b += 5) {
      let rel = b - yawDeg;
      rel = ((rel + 540) % 360) - 180;
      if (Math.abs(rel) > half) continue;

      const x = cx + rel * px;
      const fade = 1 - Math.pow(Math.abs(rel) / half, 2.2);
      const major = b % 90 === 0;
      const mid = b % 30 === 0;

      c.globalAlpha = 0.16 + fade * 0.5;
      c.strokeStyle = major ? "rgba(240,215,155,.95)" : "rgba(242,236,224,.62)";
      c.lineWidth = major ? 2 : 1.4;
      c.beginPath();
      c.moveTo(x, major ? 22 : mid ? 28 : 32);
      c.lineTo(x, 40);
      c.stroke();

      if (major) {
        c.globalAlpha = 0.4 + fade * 0.6;
        c.fillStyle = b === 0 ? "#f0d79b" : "rgba(242,236,224,.9)";
        c.font = "600 16px ui-monospace, Menlo, monospace";
        c.textAlign = "center";
        c.fillText(DIRS[b / 45], x, 16);
      }
    }
    c.globalAlpha = 1;

    /* markers */
    const p = world.player;
    if (p) {
      const marks = [];
      const f = world.forest;
      if (f && f.post) marks.push({ x: f.post.x, z: f.post.z, t: "POS", col: "#e8dfc6" });
      if (f && f.pond) marks.push({ x: f.pond.x, z: f.pond.z, t: "AIR", col: "#7fd8f2" });
      if (world.boss && !world.boss.gone) {
        marks.push({ x: world.boss.pos.x, z: world.boss.pos.z, t: "BAKAR",
          col: world.boss.doused ? "#7fd8f2" : "#ff6a2b" });
      }
      if (world.heliTarget) {
        marks.push({ x: world.heliTarget.x, z: world.heliTarget.z, t: "HELI", col: "#7fd8f2" });
      }

      for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        const ang = Math.atan2(m.x - p.pos.x, m.z - p.pos.z);
        let rel = wrapPi(ang - yaw) * 180 / Math.PI;
        const clamped = Math.abs(rel) > half - 4;
        rel = Math.max(-half + 4, Math.min(half - 4, rel));
        const x = cx + rel * px;

        c.globalAlpha = clamped ? 0.4 : 0.95;
        c.fillStyle = m.col;
        c.beginPath();
        c.moveTo(x, 43);
        c.lineTo(x + 5, 50);
        c.lineTo(x, 57);
        c.lineTo(x - 5, 50);
        c.closePath();
        c.fill();

        if (!clamped) {
          c.globalAlpha = 0.85;
          c.font = "500 11px ui-monospace, Menlo, monospace";
          c.textAlign = "center";
          c.fillText(m.t, x, 66);
        }
      }

      /* looking-at caret */
      c.globalAlpha = 0.95;
      c.fillStyle = "rgba(240,215,155,.95)";
      c.beginPath();
      c.moveTo(cx, 41);
      c.lineTo(cx - 4, 47);
      c.lineTo(cx + 4, 47);
      c.closePath();
      c.fill();
    }
    c.restore();
  };

  /* ---------------------------------------------------------- minimap */
  Hud.minimap = function (dt, world) {
    Hud.compass(dt, world);

    if (!Hud.ctx) return;
    Hud._mapT += dt;
    if (Hud._mapT < 0.1) return;
    Hud._mapT = 0;

    const c = Hud.ctx;
    const W = 220, H = 220;
    const cx = W / 2, cy = H / 2;
    const R = world.radius || 168;
    const k = (W / 2 - 12) / R;

    c.clearRect(0, 0, W, H);

    /* dial face */
    const g = c.createRadialGradient(cx, cy, 10, cx, cy, W / 2);
    g.addColorStop(0, "rgba(9,20,16,.95)");
    g.addColorStop(1, "rgba(3,8,7,.98)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cy, W / 2, 0, Math.PI * 2);
    c.fill();

    /* rings */
    c.strokeStyle = "rgba(216,180,106,.14)";
    c.lineWidth = 1;
    for (let r = 0.33; r < 1; r += 0.33) {
      c.beginPath();
      c.arc(cx, cy, R * k * r, 0, Math.PI * 2);
      c.stroke();
    }
    c.strokeStyle = "rgba(216,180,106,.35)";
    c.beginPath();
    c.arc(cx, cy, R * k, 0, Math.PI * 2);
    c.stroke();

    const f = world.forest;

    /* pond */
    if (f && f.pond) {
      c.fillStyle = "rgba(43,143,179,.45)";
      c.strokeStyle = "rgba(127,216,242,.55)";
      c.beginPath();
      c.arc(cx + f.pond.x * k, cy + f.pond.z * k, f.pond.r * k, 0, Math.PI * 2);
      c.fill();
      c.stroke();

      c.fillStyle = "rgba(127,216,242,.9)";
      for (let i = 0; i < f.drums.length; i++) {
        const d = f.drums[i];
        c.fillRect(cx + d.x * k - 1.4, cy + d.z * k - 1.4, 2.8, 2.8);
      }
    }
    /* post */
    if (f && f.post) {
      c.fillStyle = "rgba(232,223,198,.9)";
      c.fillRect(cx + f.post.x * k - 2.2, cy + f.post.z * k - 2.2, 4.4, 4.4);
    }

    /* trees */
    if (f) {
      for (let i = 0; i < f.trees.length; i++) {
        const t = f.trees[i];
        let col, s = 2.1;
        if (t.state === "burning") { col = t.fire > 0.6 ? "#ffc061" : "#ff7a2c"; s = 3.2; }
        else if (t.state === "burnt") col = "rgba(96,88,72,.6)";
        else if (t.state === "sawit") col = "rgba(224,166,58,.9)";
        else col = "rgba(88,158,104,.55)";
        c.fillStyle = col;
        c.fillRect(cx + t.x * k - s / 2, cy + t.z * k - s / 2, s, s);
      }
    }

    /* planters */
    if (world.planters) {
      for (let i = 0; i < world.planters.length; i++) {
        const p = world.planters[i];
        if (!p.alive) continue;
        c.fillStyle = "#ffd24a";
        c.beginPath();
        c.arc(cx + p.pos.x * k, cy + p.pos.z * k, 2.6, 0, Math.PI * 2);
        c.fill();
      }
    }

    /* boss */
    if (world.boss && !world.boss.gone) {
      const b = world.boss;
      c.strokeStyle = b.doused ? "rgba(127,216,242,.95)" : "rgba(255,106,43,.95)";
      c.lineWidth = 1.8;
      c.beginPath();
      c.arc(cx + b.pos.x * k, cy + b.pos.z * k, 6, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = b.doused ? "rgba(127,216,242,.35)" : "rgba(255,106,43,.35)";
      c.fill();
    }

    /* helicopter drop */
    if (world.heliTarget) {
      c.strokeStyle = "rgba(127,216,242,.85)";
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(cx + world.heliTarget.x * k, cy + world.heliTarget.z * k, 8, 0, Math.PI * 2);
      c.stroke();
    }

    /* view cone */
    const p = world.player;
    if (p) {
      c.save();
      c.translate(cx + p.pos.x * k, cy + p.pos.z * k);
      c.rotate(Math.PI - p.yaw);
      const cone = c.createLinearGradient(0, 0, 0, -34);
      cone.addColorStop(0, "rgba(240,215,155,.22)");
      cone.addColorStop(1, "rgba(240,215,155,0)");
      c.fillStyle = cone;
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, 34, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42);
      c.closePath();
      c.fill();

      c.fillStyle = "#fff8e8";
      c.beginPath();
      c.moveTo(0, -6);
      c.lineTo(4, 4.4);
      c.lineTo(0, 2.2);
      c.lineTo(-4, 4.4);
      c.closePath();
      c.fill();
      c.restore();
    }
  };

  window.Hud = Hud;
})();
