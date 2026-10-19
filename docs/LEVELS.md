# Levels and props

All nine stages are generated at runtime from a config object. There are no level files
and no textures on disk — every texture is drawn to a `<canvas>` at boot.

## The stage config

`World.STAGES` in `js/world.js`. Every key, and what it does:

| key | type | what it does |
|---|---|---|
| `name` | string | HUD stage name, results header, stage toast |
| `sub` | string | the sub-line under the stage toast |
| `sky` | `[top, mid, bottom]` | three CSS colours baked into the sky-dome gradient |
| `stars` | bool | adds a starfield, a planet and a ringed moon (`void`) |
| `fog` | `[color, near, far]` | `THREE.Fog` |
| `ground` | string | ground material preset: `asphalt`, `rock`, `metal`, … |
| `groundColor` | hex | tint over that preset |
| `ambient` | `[color, intensity]` | `THREE.AmbientLight` |
| `sun` | `[color, intensity, [x, y, z]]` | `DirectionalLight` + shadow camera |
| `biome` | string | which prop builder runs: `city`, `ruins`, `aliencity`, `sky`, `cave`, `volcano`, `fortress`, `void` |
| `mood` | string | HUD tone and the palette the builder leans on |
| `fly` | bool | stage expects flight (sky stage); the spawner and arena adapt |
| `hazard` | string | stage-wide hazard tag (`lava` on the final stage) |
| `mobs` | `[roleId]` | random-wave pool |
| `boss` | roleId | the stage boss |
| `mobH` / `bossH` | number | spawn height in world units — **the loader scales the model to this** |
| `final` | bool | last stage: no upgrade screen, victory screen instead |

The `roleId` values are the keys of the `KAIJU` table in `js/models.js`. See
[`CONTENT.md`](CONTENT.md).

## The stage object

`World.build(idx, scene, group)` returns:

```js
{
  cfg,                                // the config above
  group,                              // everything for this stage; removed on exit
  arenaRadius: 78,                    // how far the player may wander
  hazards:      [{ x, z, radius, dps, type }],
  destructibles:[mesh, ...],          // breakable, and hit by attacks
  solids:       [mesh, ...],          // block movement
  spawns:       [Vector3, ...],       // where the mobs come from
  animated:     [{ mesh, fn }],       // per-frame dressing
  lights:       [light, ...],         // cap-limited: builders stop adding at 18
  update(dt, t)                       // runs every `animated` fn
}
```

`Game` calls `stage.update(dt, Game.time)` while playing and a slow tenth of it while a
menu covers the screen, so the world keeps breathing behind the pause panel.

## Props

Everything in a stage except the ground and the sky is a **prop**: a scaled instance of
one of seven shared unit geometries, tagged with its gameplay properties.

```js
addProp(group, stage, mesh, {
  kind: "building",     // for fx colour and stats
  hp: 60,
  destructible: true,   // pushed into stage.destructibles -> hitProp
  solid: true,          // pushed into stage.solids       -> W.collide
  radius: 4,            // attack and beam hit radius (XZ)
  solidR: 3,            // collision radius; defaults to `radius`
  height: 20,           // vertical extent, for fx anchors
  fade: true,           // fades out when it blocks the camera
  size: [6, 20, 6],     // what it becomes when smashed into rubble
});
```

The shared geometries are `GEO.box`, `.cyl`, `.cyl6`, `.cone`, `.sph`, `.ring`,
`.plane`, and `gm(geo, mat, sx, sy, sz)` instantiates one with a scale. Materials come
from a cache (`pm("trunk", 0x6a4a32)`) so a few hundred props cost a few materials. This
is what keeps a stage at a few hundred draw calls instead of a few thousand.

Writing your own prop:

```js
function mkWaterTower() {
  const g = new THREE.Group();
  const legs = gm(GEO.cyl6, pm("steel", 0x8a9099), 0.2, 6); legs.position.y = 3;
  const tank = gm(GEO.cyl,  pm("steel", 0x8a9099), 2.2, 3.4); tank.position.y = 7.4;
  g.add(legs, tank);
  return g;
}
// ...in a builder
addProp(group, stage, mkWaterTower(), {
  kind: "tower", hp: 90, destructible: true, solid: true,
  radius: 3.2, height: 9.4, fade: true, size: [4, 9, 4],
});
```

Props must be authored **standing on the origin** (`y = 0` is the base); the builders
place them, and `addProp` handles registration.

## Collision

`World.collide(stage, pos, radius)` pushes `pos` out of every solid prop it overlaps,
using `solidR + radius`. It is called from the player's update (`js/player.js`) and it
resolves softly over a couple of frames so the player **slides along** a wall rather
than being wedged into it or snapped sideways.

Only the player collides with solids. Enemies walk through buildings on purpose: it
keeps the AI readable and stops bosses getting stuck in geometry. If you want enemies to
collide, call the same function from `js/enemies.js` — it is a pure function of
`(stage, pos, radius)`.

## Hazards

```js
stage.hazards.push({ x, z, radius: 3.4, dps: 14, type: "lava" });
```

Consumed in `js/player.js`: when the player is below `y = 1.2` and inside the radius, it
takes `dps` damage per second with sparks. `type` is cosmetic. The volcano and cave
builders add these; nothing stops a hazard damaging enemies too, if you extend the loop.

## Camera occlusion

`Game.updateOccluders()` walks `stage.destructibles` and, for any prop flagged `fade`,
measures its distance from the camera→player line. Close to the line → fade the material
out; clear → fade back in. Anything the camera itself is jammed against fades too.

This is why tall props in a third-person giant-monster game are playable at all: the
camera spends most of its time behind a building. `js/world.js` sets `fade: true` on
roughly every prop taller than the player.

Two things to know if you tune it: the fade is applied to `m.material` or the first
child's material, so a prop made of *several* differently-coloured meshes only fades its
first one; and props with `transparent: false` materials will pop rather than cross-fade.
Build tall multi-part props as a single material if you want a clean fade.

## Adding a biome

1. Write `function myBiomeProps(group, stage, AR, cfg) { … }`.
2. Dispatch it in `W.build` next to the others:

```js
} else if (B === "mybiome") { myBiomeProps(group, stage, AR, cfg); }
```

`AR` is the arena radius (78) — keep props outside it or the player can hide inside them.

3. Add a stage config with `biome: "mybiome"`, or point an existing stage at it.

Builders are called with the ground already laid and the sky already up; they only add
props, hazards and dressed spawn points.

## A wart worth fixing in your own levels

`stage.update(dt, t)` runs each animation callback as `fn(mesh, t)` — **`dt` is not
passed to the callbacks**. Most shipped callbacks are functions of the absolute time `t`
(`Math.sin(t * 2)`), which is frame-rate independent and correct. A few use per-frame
increments (`m.rotation.y += 0.004`), which spin faster on a 144 Hz display than on a
60 Hz one. Prefer the `t` form in anything you write, or change `world.js` line ~567 to
`fn(mesh, t, dt)` and accumulate against `dt`.
