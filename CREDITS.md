# Third-party licences and attribution

Everything in this repository is either original code or an asset under a licence that
permits redistribution. Nothing here is taken from a commercial game.

## The example art pack — `assets/models/`

All of it is **CC0 1.0 (public domain)**: commercial use allowed, attribution not
required. Attribution is given anyway.

| File | In-game role | The model it is | From | Licence |
|---|---|---|---|---|
| `hero.glb` | player + 4 allies | `Mannequin`, the base character of the Universal Animation Library, 65-joint Universal Rig | [Quaternius](https://quaternius.com) | CC0 1.0 |
| `anim-ual.glb` | the hero's 15 clips | `Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop`, `Jump_Start`, `Punch_Jab`, `Spell_Simple_Shoot`, … | [Quaternius](https://quaternius.com) — Universal Animation Library | CC0 1.0 |
| `kaiju-frog.glb` | `kaiju_jamila` | `Frog` + the eight-clip reference set every other kaiju is retargeted from | [KayKit](https://kaylousberg.com) | CC0 1.0 |
| `kaiju-mushroom.glb` | `kaiju_bemular` | `MushroomKing` | KayKit / Quaternius character packs | CC0 1.0 |
| `kaiju-orc.glb` | `kaiju_redking` | `Orc` | KayKit / Quaternius character packs | CC0 1.0 |
| `kaiju-demon.glb` | `kaiju_birdon` | `Demon` (flying) | KayKit / Quaternius character packs | CC0 1.0 |
| `kaiju-bluedemon.glb` | `kaiju_baltan` | `BlueDemon` | KayKit / Quaternius character packs | CC0 1.0 |
| `kaiju-squid.glb` | `kaiju_eleking` | `Squidle` | Quaternius — Ultimate Monsters | CC0 1.0 |
| `kaiju-bull.glb` | `kaiju_golza` | `Cow` (quadruped, gallop + headbutt clips) | Quaternius — Animated Animals | CC0 1.0 |
| `kaiju-skeleton.glb` | `kaiju_kingjoe` | `Skeleton_Warrior` | [KayKit](https://kaylousberg.com) — Skeletons | CC0 1.0 |
| `kaiju-tribal.glb` | `kaiju_gomora` | `Tribal` | Quaternius — Ultimate Monsters | CC0 1.0 |
| `kaiju-dragon.glb` | `kaiju_zetton` | `Dragon` (flying) | Quaternius — Ultimate Monsters | CC0 1.0 |

The pack names above are best-effort: the models come from the free CC0 character
libraries both sites publish, and each one identifies itself by its internal mesh name
(`Frog`, `MushroomKing`, `Squidle`, `Skeleton_Warrior`, …) — run
`tools/inspect_glb.py <file> --materials` to read those back. CC0 does not require
attribution, so this table is a courtesy rather than an obligation.

Full CC0 text: [`assets/models/LICENSE-CC0.txt`](assets/models/LICENSE-CC0.txt).

The `.glb` files were repacked by this project's own tools (`tools/`) but the meshes,
skeletons, skin weights and clip data are the originals, unmodified apart from the
operations documented in `docs/ASSET-PIPELINE.md`.

## The Roblox build — `roblox/`

`roblox/src/shared/Rig.luau` and everything in `roblox/src/shared/clips/` are **generated
Luau**: they are the skeleton, rest pose and 15 clips of `assets/models/anim-ual.glb`
above, re-expressed as tables by `tools/glb_to_roblox.py`. No new art was added — the
same CC0 mannequin and its clips, baked so that Roblox can play them without a runtime
glTF loader. See [`docs/ROBLOX.md`](docs/ROBLOX.md).

The creatures the game spawns are built from Roblox `Part` primitives at runtime by
`Figure.luau`, so there is no third-party art in the Roblox build beyond that one CC0
source file. Nothing in it requires an uploaded asset id.

## Vendored libraries

| File | Source | Licence |
|---|---|---|
| `js/three.min.js` | [three.js r128](https://threejs.org) | MIT |
| `js/lib/GLTFLoader.js` | three.js r128 examples | MIT |
| `js/lib/SkeletonUtils.js` | three.js r128 examples | MIT |

## Generated at runtime

No third-party art went into the environments or the combat effects. Every biome in
`js/world.js` (roads, kerbs, towers, trees, cars, street furniture, stalactites, lava
falls, pipes, crates, obelisks, floating islands and their textures) and every effect in
`js/fx.js` (rays, crescents, rings, shocks, particles, debris) is built from three.js
primitives and canvas drawing calls when the game boots. Same for the stand-in character
silhouettes in `js/sprites.js`, and for the whole soundtrack in `js/audio.js`.

## Trademarks

ULTRAMAN and related characters are trademarks of Tsuburaya Productions Co., Ltd. The
example content in this repository reuses those names for a non-commercial fan project
and is not affiliated with, endorsed by or licensed by Tsuburaya Productions. The engine
itself contains no such content — see `docs/CONTENT.md` for how to replace it.

## Not included

The build this engine was originally written for pairs the Universal Rig with a hero
mesh built from a fan-made statue kit that is licensed for study and personal exchange
only. **That mesh is deliberately not in this repository.** The CC0 mannequin stands in
for it, and `docs/ASSET-PIPELINE.md` explains how to drop your own hero in instead.
