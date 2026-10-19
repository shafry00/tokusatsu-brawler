/* ============================================================
   audio.js — procedural WebAudio SFX + music (no external files)
   ============================================================ */
(function () {
  const A = {};
  let ctx = null, master = null, musicGain = null, sfxGain = null;
  let musicOn = false, musicTimer = null, step = 0;
  let muted = false;

  A.init = function () {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.85; master.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.55; sfxGain.connect(master);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.0; musicGain.connect(master);
  };

  A.resume = function () { if (ctx && ctx.state === "suspended") ctx.resume(); };
  A.setMuted = function (m) { muted = m; if (master) master.gain.value = m ? 0 : 0.85; };
  A.isMuted = function () { return muted; };

  function now() { return ctx.currentTime; }

  function noiseBuffer(dur) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function env(node, t0, a, d, peak, sustain) {
    const g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.linearRampToValueAtTime(peak, t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  function osc(type, f0, f1, dur, peak, detune) {
    if (!ctx) return;
    const t0 = now();
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    if (detune) o.detune.value = detune;
    const g = ctx.createGain();
    env(g, t0, Math.min(0.02, dur * 0.15), dur, peak);
    o.connect(g); g.connect(sfxGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noise(dur, peak, f0, f1, q, type) {
    if (!ctx) return;
    const t0 = now();
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer(dur + 0.05);
    const bp = ctx.createBiquadFilter(); bp.type = type || "bandpass";
    bp.frequency.setValueAtTime(f0, t0);
    if (f1) bp.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
    bp.Q.value = q || 1;
    const g = ctx.createGain(); env(g, t0, 0.006, dur, peak);
    s.connect(bp); bp.connect(g); g.connect(sfxGain);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }

  const SFX = {
    punch()      { noise(0.11, 0.5, 900, 260, 1.1); osc("sine", 190, 90, 0.1, 0.28); },
    punch2()     { noise(0.10, 0.5, 1200, 340, 1.2); osc("sine", 230, 110, 0.09, 0.26); },
    heavy()      { noise(0.20, 0.6, 700, 130, 1.0); osc("sine", 130, 55, 0.22, 0.4); osc("triangle", 90, 40, 0.24, 0.2); },
    hitFlesh()   { noise(0.07, 0.35, 500, 200, 2); },
    hitCrit()    { noise(0.14, 0.6, 1600, 500, 3); osc("square", 780, 300, 0.09, 0.16); },
    block()      { noise(0.12, 0.4, 3000, 1200, 4, "highpass"); osc("square", 420, 300, 0.08, 0.1); },
    swing()      { noise(0.16, 0.24, 1800, 500, 1.4); },
    dash()       { noise(0.22, 0.34, 400, 2400, 1.0); },
    jump()       { osc("sine", 320, 720, 0.16, 0.2); },
    land()       { noise(0.14, 0.4, 260, 90, 1); osc("sine", 110, 60, 0.12, 0.22); },
    hurt()       { osc("sawtooth", 420, 120, 0.26, 0.3); noise(0.2, 0.3, 900, 200, 1.5); },
    explode()    { noise(0.7, 0.85, 900, 60, 0.7, "lowpass"); osc("sine", 90, 30, 0.6, 0.5); },
    beam()       { osc("sawtooth", 220, 1400, 0.5, 0.34); osc("square", 700, 1900, 0.45, 0.14, 12);
                   noise(0.55, 0.3, 1200, 4200, 0.8, "highpass"); },
    beamHit()    { noise(0.45, 0.6, 2200, 500, 1.2); osc("sine", 200, 60, 0.4, 0.3); },
    slash()      { osc("triangle", 1500, 400, 0.3, 0.26); noise(0.3, 0.2, 3000, 800, 2, "highpass"); },
    ring()       { osc("sine", 900, 1500, 0.25, 0.2); },
    pickup()     { osc("sine", 700, 1400, 0.14, 0.24); setTimeout(() => osc("sine", 1200, 2000, 0.12, 0.18), 70); },
    heart()      { osc("sine", 600, 1000, 0.16, 0.24); setTimeout(() => osc("sine", 1000, 1500, 0.2, 0.2), 90); },
    ui()         { osc("square", 660, 880, 0.06, 0.08); },
    uiBig()      { osc("square", 330, 660, 0.12, 0.12); setTimeout(() => osc("square", 660, 990, 0.14, 0.1), 90); },
    roar()       { osc("sawtooth", 150, 70, 0.6, 0.4, -6); osc("sawtooth", 220, 90, 0.62, 0.3, 8);
                   noise(0.6, 0.3, 500, 120, 1.2); },
    roarBig()    { osc("sawtooth", 90, 45, 1.1, 0.5, -8); osc("sawtooth", 140, 60, 1.15, 0.4, 10);
                   noise(1.0, 0.4, 380, 80, 1.0); },
    alarm()      { osc("square", 880, 880, 0.12, 0.2); setTimeout(() => osc("square", 660, 660, 0.12, 0.2), 150); },
    warn()       { osc("square", 520, 780, 0.14, 0.2); },
    charge()     { osc("sawtooth", 180, 900, 0.7, 0.22); noise(0.7, 0.18, 300, 2600, 0.7, "highpass"); },
    levelup()    { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => osc("triangle", f, f, 0.22, 0.2), i * 110)); },
    lose()       { [440, 349, 261, 174].forEach((f, i) => setTimeout(() => osc("sawtooth", f, f * 0.9, 0.5, 0.22), i * 190)); },
    transform()  { osc("sine", 120, 1800, 1.1, 0.3); noise(1.1, 0.25, 400, 5000, 0.6, "highpass"); },
  };

  A.sfx = function (name) {
    if (!ctx || muted) return;
    A.resume();
    const f = SFX[name];
    if (f) { try { f(); } catch (e) {} }
  };

  /* ---- simple looping music: minor-key driving arpeggio ---- */
  const BASS = [55, 55, 82.4, 55, 61.7, 61.7, 92.5, 61.7];
  const ARP  = [440, 523.25, 659.25, 523.25, 587.33, 698.46, 880, 698.46];
  const MELY = [880, 0, 1046.5, 0, 987.77, 880, 0, 659.25];

  function musicStep() {
    if (!ctx || muted) return;
    const t0 = now(), i = step % 8;
    // bass
    const ob = ctx.createOscillator(); ob.type = "triangle"; ob.frequency.value = BASS[i];
    const gb = ctx.createGain();
    gb.gain.setValueAtTime(0.0001, t0); gb.gain.linearRampToValueAtTime(0.5, t0 + 0.02);
    gb.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
    ob.connect(gb); gb.connect(musicGain); ob.start(t0); ob.stop(t0 + 0.5);
    // arp
    const oa = ctx.createOscillator(); oa.type = "square"; oa.frequency.value = ARP[i];
    const ga = ctx.createGain();
    ga.gain.setValueAtTime(0.0001, t0); ga.gain.linearRampToValueAtTime(0.11, t0 + 0.01);
    ga.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.20);
    oa.connect(ga); ga.connect(musicGain); oa.start(t0); oa.stop(t0 + 0.25);
    // melody every other bar
    if (step % 16 < 8) {
      const f = MELY[i];
      if (f) {
        const om = ctx.createOscillator(); om.type = "sawtooth"; om.frequency.value = f;
        const gm = ctx.createGain();
        gm.gain.setValueAtTime(0.0001, t0); gm.gain.linearRampToValueAtTime(0.08, t0 + 0.03);
        gm.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
        om.connect(gm); gm.connect(musicGain); om.start(t0); om.stop(t0 + 0.55);
      }
    }
    // hat
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.05);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 6000;
    const gh = ctx.createGain(); env(gh, t0, 0.002, 0.05, 0.07);
    s.connect(hp); hp.connect(gh); gh.connect(musicGain); s.start(t0); s.stop(t0 + 0.08);
    step++;
  }

  A.music = function (on, intensity) {
    if (!ctx) return;
    musicOn = on;
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    musicGain.gain.cancelScheduledValues(now());
    musicGain.gain.linearRampToValueAtTime(on ? (intensity === 2 ? 0.34 : 0.22) : 0, now() + 0.6);
    if (on) { step = 0; musicTimer = setInterval(musicStep, 250); }
  };
  A.musicIntensity = function (v) {
    if (ctx) musicGain.gain.linearRampToValueAtTime(v === 2 ? 0.34 : 0.22, now() + 0.4);
  };

  window.Audio2 = A;
})();
