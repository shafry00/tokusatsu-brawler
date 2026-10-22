/* ============================================================
   JAGA HUTAN — touch layer
   Left stick walks, right thumb acts, drag the view to look.
   Only wired on coarse pointers, so desktop stays keyboard-only.
   ============================================================ */
(function () {
  const coarse = window.matchMedia
    ? window.matchMedia("(hover: none) and (pointer: coarse)").matches
    : "ontouchstart" in window;
  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (!coarse || !hasTouch) return;

  const el = {
    root: document.getElementById("touch"),
    stick: document.getElementById("stick"),
    knob: document.getElementById("stickKnob"),
    fire: document.getElementById("tFire"),
    rotate: document.getElementById("rotate")
  };
  if (!el.root || !el.stick || !el.fire) return;

  const canvas = document.getElementById("gl");
  const swapBtn = document.querySelector('#touch .tbtn[data-act="swap"]');

  const T = {
    on: true,
    move: { x: 0, y: 0 },
    fire: false,
    sync: sync
  };
  window.TouchPad = T;

  const STICK_R = 44;      /* how far the knob travels, px */
  const LOOK_X = 0.0058;   /* radians per px of drag */
  const LOOK_Y = 0.0042;

  let stickId = null, cx = 0, cy = 0;
  let lookId = null, lx = 0, ly = 0;
  let shown = null;
  let playStart = 0;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function buzz(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
  }

  /* ---------------- walking stick ---------------- */
  function stickAt(e) {
    const r = el.stick.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
  }

  function setKnob(x, y) {
    el.knob.style.transform = "translate(" + (x * STICK_R).toFixed(1) + "px," + (y * STICK_R).toFixed(1) + "px)";
  }

  function resetKnob() {
    T.move.x = 0; T.move.y = 0;
    setKnob(0, 0);
  }

  el.stick.addEventListener("pointerdown", function (e) {
    if (stickId !== null) return;
    stickId = e.pointerId;
    stickAt(e);
    try { el.stick.setPointerCapture(e.pointerId); } catch (err) {}
    moveStick(e);
    e.preventDefault();
  });

  el.stick.addEventListener("pointermove", function (e) {
    if (e.pointerId !== stickId) return;
    moveStick(e);
    e.preventDefault();
  });

  function moveStick(e) {
    let dx = (e.clientX - cx) / STICK_R;
    let dy = (e.clientY - cy) / STICK_R;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    /* a small deadzone keeps the walk from twitching under a resting thumb */
    if (m < 0.16) { dx = 0; dy = 0; }
    T.move.x = dx;
    T.move.y = dy;
    setKnob(dx, dy);
  }

  function endStick(e) {
    if (e.pointerId !== stickId) return;
    stickId = null;
    resetKnob();
  }

  el.stick.addEventListener("pointerup", endStick);
  el.stick.addEventListener("pointercancel", endStick);
  el.stick.addEventListener("lostpointercapture", function (e) {
    if (e.pointerId === stickId) { stickId = null; resetKnob(); }
  });

  /* ---------------- action button (hold) ---------------- */
  function fireOn(e) {
    T.fire = true;
    el.fire.classList.add("on");
    try { el.fire.setPointerCapture(e.pointerId); } catch (err) {}
    buzz(8);
    e.preventDefault();
  }
  function fireOff() {
    T.fire = false;
    el.fire.classList.remove("on");
  }

  el.fire.addEventListener("pointerdown", fireOn);
  el.fire.addEventListener("pointerup", fireOff);
  el.fire.addEventListener("pointercancel", fireOff);
  el.fire.addEventListener("lostpointercapture", fireOff);
  el.fire.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  /* ---------------- pause ---------------- */
  const pauseBtn = document.getElementById("tPause");
  if (pauseBtn) {
    pauseBtn.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      if (window.JagaHutan && JagaHutan.state === "playing" && JagaHutan.pause) JagaHutan.pause();
    });
  }

  /* ---------------- one-shot buttons ---------------- */
  document.querySelectorAll("#touch .tbtn[data-act]").forEach(function (b) {
    const act = b.getAttribute("data-act");
    b.addEventListener("pointerdown", function (e) {
      b.classList.add("on");
      buzz(10);
      if (window.JagaHutan && JagaHutan.action) JagaHutan.action(act);
      e.preventDefault();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
      b.addEventListener(ev, function () { b.classList.remove("on"); });
    });
  });

  /* ---------------- look by dragging the view ---------------- */
  if (canvas) {
    canvas.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "touch") return;
      if (!window.JagaHutan || JagaHutan.state !== "playing") return;
      lookId = e.pointerId;
      lx = e.clientX; ly = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    });

    canvas.addEventListener("pointermove", function (e) {
      if (e.pointerId !== lookId) return;
      const d = window.JagaHutan && JagaHutan.debug;
      if (!d) return;
      d.cam.yaw -= (e.clientX - lx) * LOOK_X;
      d.cam.pitch = clamp(d.cam.pitch - (e.clientY - ly) * LOOK_Y, -0.95, 0.16);
      lx = e.clientX; ly = e.clientY;
    });

    function endLook(e) {
      if (e.pointerId === lookId) lookId = null;
    }
    canvas.addEventListener("pointerup", endLook);
    canvas.addEventListener("pointercancel", endLook);
    canvas.addEventListener("lostpointercapture", endLook);
  }

  /* ---------------- show / hide with the game state ---------------- */
  function sync(state) {
    const playing = state === "playing";

    if (playing !== shown) {
      shown = playing;
      if (playing) playStart = Date.now();
      el.root.classList.toggle("hidden", !playing);
      if (!playing) {
        T.fire = false;
        el.fire.classList.remove("on");
        stickId = null;
        lookId = null;
        resetKnob();
      }
    }

    /* the tool button doubles as the weapon readout, since the wheel is hidden */
    if (playing && swapBtn) {
      const p = window.JagaHutan && JagaHutan.debug && JagaHutan.debug.player;
      if (p) {
        const label = p.weapon === "hammer" ? "PALU" : "SELANG";
        if (swapBtn.textContent !== label) swapBtn.textContent = label;
      }
    }

    if (el.rotate) {
      const portrait = window.innerHeight > window.innerWidth;
      const fresh = playing && playStart && Date.now() - playStart < 9000;
      el.rotate.classList.toggle("hidden", !(portrait && fresh));
    }
  }

  sync("boot");
  window.addEventListener("orientationchange", function () { shown = null; sync(window.JagaHutan ? JagaHutan.state : "boot"); });
})();
