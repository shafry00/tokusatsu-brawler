# Architecture

Nine plain scripts, no modules, no bundler. Each file attaches one global to `window`
and they talk to each other through it. That is deliberate: the whole game is readable
in `view-source`, and there is nothing between you and three.js.

```
index.html
  js/three.min.js      three.js r128 (UMD)
  js/lib/GLTFLoader.js vendored
  js/lib/SkeletonUtils.js vendored
  js/audio.js          window.Audio2   procedural WebAudio
  js/fx.js             window.FX       particles, beams, rings, shakes, damage numbers
  js/sprites.js        window.Sprites  + Actor        the 2.5D fallback
  js/models.js         window.Models   + RiggedActor  the GLB path
  js/world.js          window.World    9 stages, biomes, props, collision
  js/enemies.js        window.Enemies  species table, attacks, boss AI
  js/player.js         window.Player   movement, flight, combat
  js/game.js           window.Game     camera, input, waves, HUD, progression
```

## Who owns what

| Global | Owns | Never touches |
|---|---|---|
| `FX` | every transient visual + camera shake + hitstop + damage numbers | game state |
| `Sprites` | sprite textures, procedural stand-ins | skeletons |
| `Models` | GLB loading, `RiggedActor`, clip slot resolution | combat |
| `World` | stage config, geometry, props, `collide` | characters |
| `Enemies` | `SPECIES` stats, attack timings, boss patterns, AI | rendering setup |
| `Player` | the player's intent → motion, attack windows | other characters |
| `Game` | the frame loop, camera, waves, spawns, scoring, UI | per-frame character motion |
| `Audio2` | all sound, synthesised | everything else |

`Game` is the only orchestrator. It owns the clock and calls the others in a fixed
order; nothing calls back into `Game` except through explicit state checks
(`Game.state`, `Game.stage`).

## The frame loop

`js/game.js` → `loop()`, roughly:

```js
function loop() {
  requestAnimationFrame(loop);
  const dtReal = Math.min(Game.clock.getDelta(), 0.05);   // clamp: tab switches
  if (Game.state === "playing") {
    FX.update(dtReal);                                     // real time: shake, flash
    const dt = dtReal * FX.timeScale;                      // slow-mo affects the world
    Game.time += dt;
    updateMoveAxis();
    Game.player.update(dt, input, Game.camera);
    for (enemies) { e.update(dt); e.checkPhase(); }
    updateSpawns(dt); updateProjectiles(dt); updateRings(dt);
    updateMeteors(dt); updatePickups(dt); updateAllies(dt);
    updateCamera(dt); updateOccluders(); updateHud(dt); updateWaves(dt);
  }
  ...
}
```

Three things worth copying if you build on this:

1. **Two clocks.** Effects and screen shake run on `dtReal`, the world runs on
   `dtReal * FX.timeScale`. That is what lets `FX.slowmo(0.25, 900)` land a finisher in
   slow motion without the effects also crawling.
2. **`dt` is clamped to 50 ms.** Without it, returning to a backgrounded tab hands the
   game a multi-second step and everything teleports.
3. **`requestAnimationFrame` throttles to under 1 fps when the window is not visible.**
   If you script the game for a screenshot test, foreground the window or the game clock
   appears frozen.

## The actor abstraction

The single most useful idea in the codebase. `models.js` and `sprites.js` expose the
**same object surface**, so nothing downstream knows or cares which one it got:

```
group · yaw · A{sx, sy, slide, tilt} · bobAmp · groundY · dead
update(dt, camera) · setPos/pos · hitFlash · setTint
setState({speed, grounded}) · oneShot(slot, lock, rate)
```

`RiggedActor` implements it with a skinned mesh and an `AnimationMixer`; `Actor`
implements it with a camera-facing textured plane and hand-rolled squash-and-stretch.
`Models.create()` returns `null` if a model has not loaded yet, and the caller falls back
to the sprite. That is why the game never shows a hole where a character should be.

If you add a character type, implement those members and it plugs in.

## Slot-based animation

`RiggedActor` builds its action table at construction time by matching every available
clip name against a family's pattern list:

```js
const FAMILIES = { kaykit: { idle: [/Idle$/i], run: [/Run$/i, /Walk$/i], ... }, hero: {...} };
```

`FAMILIES[entry.family]` is walked once per actor, the first matching clip per slot is
compiled into an `AnimationAction`, and `ONCE` marks the slots that must not loop
(`atk1`, `atk2`, `beam`, `hit`, `death`, `jump`, `land`, `roll`).

Clips are then **retimed** to the gameplay window, not the reverse: a 0.8 s punch is
time-scaled so its active frame lands inside the 0.10 s strike window defined in
`player.js`. Locomotion is speed-matched so the feet do not skate. Crossfades are 0.09 s
for actions, 0.04 s for hits.

## Levels

`World.build(idx, scene, group)` reads `World.STAGES[idx]` and returns a stage object:

```js
{ cfg, group, arenaRadius: 78, hazards: [], destructibles: [], solids: [],
  spawns: [], animated: [], lights: [] }
```

Every prop is a scaled instance of one of the seven shared unit geometries, tagged with
its gameplay properties in `userData` (`kind`, `hp`, `destructible`, `solid`, `radius`,
`solidR`, `height`, `fade`, `size`). `World.collide(stage, pos, radius)` soft-pushes a
position out of solids over a couple of frames so the player slides along walls. Full
detail in [`LEVELS.md`](LEVELS.md).

## Combat bookkeeping

* `FX.hitstop(ms)` zeroes `FX.timeScale`, `FX.slowmo(scale, ms)` partially does; both
  are consumed in `FX.update`.
* Attacks are data, not code — `{ wind, act, rec, range, lunge, dmg }` in `player.js`,
  and the same shape inside `Enemies.SPECIES`.
* Enemies telegraph: `arena` markers and charge glows are spawned during the wind-up and
  cleared by `clearTelegraph()` so a cancelled attack leaves nothing behind.
* `Game.updateOccluders()` fades any prop between the camera and the player, using the
  `fade` flag from the prop system. Without it, a giant camera-relative character spends
  half its time inside a building.

## Progression

`localStorage["ultraman_nine_trials"]` holds `{ best: {stageIdx: score}, unlocked }`.
Rename that key when you reskin (see [`CONTENT.md`](CONTENT.md)) — and note that stage
unlocks gate the stage select, so wiping it is the fastest way to reset for testing.
