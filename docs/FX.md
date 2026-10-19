# Effects

`js/fx.js` is the whole visual feedback layer: particles, beams, crescents, rings,
shocks, damage numbers, plus camera shake, hitstop and slow-motion. It owns no game
state and knows nothing about characters — you hand it world positions and it draws.

```js
FX.init(scene, camera, renderer);   // once, after the renderer exists
FX.update(dtReal);                  // every frame, in real time (not scaled)
FX.reset();                         // between stages
```

## Why `dtReal`

`FX.update` is called with the **unscaled** frame delta, and the world runs on
`dtReal * FX.timeScale`. That is what makes `FX.slowmo(0.25, 900)` read as slow motion
rather than as lag: time inside the game stretches while the effects keep running at
display speed. Follow the same rule in anything you add to `FX`.

## Particles

One pool of **340** box meshes, one shared `MeshBasicMaterial`, no allocation per spark.
`getParticle()` returns `null` when the pool is exhausted, so every emitter is safe to
call in a loop.

```js
FX.spark(pos, {
  color, vel,          // THREE.Vector3; defaults to a random upward cone
  grav: 22,            // downward acceleration
  drag: 0.96,          // per-frame velocity retention
  life: 0.55,          // seconds
  size: 0.22, size1: 0.02,   // scale at birth / at death
});

FX.burst(pos, color, count, opts);   // opts: { color2, speed, up, grav, life, size, drag }
FX.debris(pos, color, count);        // heavy chunkier burst, gravity 34
FX.gather(pos, color, count, radius, life);   // particles fly *inward* — charge-ups
```

`FX.dir({ speed, up })` returns a random direction on a hemisphere; handy for your own
emitters.

## Shapes

```js
FX.ring(pos, color, maxR, life, opt);
//   opt.flat: false   stand it up (default lies flat on the ground)
//   opt.quat          orient it explicitly
//   opt.r0            starting radius

FX.shock(pos, color, radius, life);        // expanding additive shell — impacts
FX.beam(from, to, { color, glow, radius, taper, life });
//   radius  cylinder radius at `from`
//   taper   radius multiplier at `to`; < 1 converges, > 1 flares the muzzle
//           (a wide muzzle plus a narrow end reads as a ray leaving the hand)
//   glow     outer shell colour
//   life     default 0.32
//   scaleUp  false to keep the beam at full length for its whole life
FX.lightning(a, b, color);                 // jagged 7-segment line, 0.18 s
```

### The crescent — `FX.arc`

The most useful single effect in a melee game, and the one most often got wrong.

```js
FX.arc(pos, yaw, radius, {
  vertical: false,   // see below
  span: Math.PI * 1.15,
  inner: 0.6,        // inner radius as a fraction of `radius`
  rot: 0,            // rotate the sweep centre; 0 = straight ahead
  color: 0xdff4ff, opacity: 0.85,
});
```

* `vertical: false` lays the crescent **flat on the ground**. Correct for slams, stomps
  and area sweeps that the player sees from above.
* `vertical: true` stands it in the plane the fighter swings through. This is what a
  punch or a blade trail has to be: from a third-person camera, a flat ring seen
  edge-on is invisible.

`yaw` is the game's heading convention — forward is `(sin yaw, 0, cos yaw)` — so pass the
attacker's `yaw` unchanged.

### A struck point

```js
FX.impact(pos, color, scale);   // burst + shell, one call, most hits want this
```

## Damage numbers

```js
FX.damage(pos, amount, kind);   // kind: "crit" | "player" | "heal" | "block" | undefined
```

DOM elements in `#fxNums`, positioned by projecting the world point each frame, with a
pop-and-drift animation. Crits are gold and 30 px; player damage is red; heals are green
with a `+`.

## Camera feel

```js
FX.shake(0.2);            // additive, capped at 1.6
FX.hitstop(90);           // ms of full freeze — for the moment a heavy connects
FX.slowmo(0.25, 900);     // scale + ms
FX.flash(0.4, "#ff3b4d"); // full-screen tint
```

Used well, these matter more than the particles: `hitstop` on the heavy strike and
`slowmo` on a finisher are most of why the combat feels like it has weight. Hitstop is
applied through `FX.timeScale`, which the world clock multiplies by, so it freezes
characters and projectiles but not the shake you queued on the same frame.

## Recipes from the shipped game

The ones worth copying, with the numbers that worked.

```js
// Specium ray — a widening muzzle and a converging tail
FX.beam(hand, target, { color: 0xdff8ff, glow: 0x2f9bff, radius: 1.15, taper: 1.9, life: 0.34 });
FX.shock(hand, 0x9fe4ff, 3.2, 0.24);

// Heavy melee connect
FX.impact(hit, 0xffe6a8, 1.35);
FX.arc(chest, yaw, 7.2, { vertical: true, color: 0xfff0c0, opacity: 0.8 });
FX.hitstop(90); FX.shake(0.28);

// Finisher: gather, then release
FX.gather(chest, 0x8fe0ff, 46, 4.6, 0.5);
FX.burst(chest, 0xdff8ff, 60, { speed: 22, up: 1.2, life: 0.9, size: 0.34 });
FX.slowmo(0.3, 1200);

// Boss telegraph (wind-up): ground crescent in the danger zone
FX.arc(pos, yaw, reach, { color: 0xff5a4a, opacity: 0.45, span: Math.PI * 0.7 });
// ...and on the strike frame, swap it for the solid one
FX.arc(pos, yaw, reach, { vertical: true, color: 0xffd0a0, opacity: 0.9 });

// Beam vs. ground: the same ray plus the bounce
FX.beam(muzzle, hit, { radius: 0.8, taper: 1.4 });
FX.ring(hit, 0xffd07a, 6.5, 0.5);
FX.debris(hit, 0xffb060, 14);
```

## When an effect is hard to read

Almost always one of three things:

1. **A flat effect seen edge-on.** Ground rings disappear from a low camera. If the
   player has to see it, use `vertical: true` or a `shock`.
2. **Additive blending on a bright background.** Additive effects vanish against a pale
   sky. The void and fortress stages are dark; the sky stage is not — keep telegraph
   colours saturated there, or add a dark backing ring.
3. **Effects fired from a point that is inside the character.** Anchor them to
   `hitPoint()` / `muzzlePoint()`-style helpers on the character rather than to its
   origin, or the beam starts behind the body.

Firing a beam **directly at the camera** is the one case this project still handles
imperfectly: an additive cylinder pointed end-on is a bright disc with little perceived
length. `radius`/`glow` help; a perpendicular shock at the muzzle helps more.
