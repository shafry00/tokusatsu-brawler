# The asset pipeline — from a downloaded `.glb` to a character in the game

This is the flow the project was built around. It assumes you found a rigged model
somewhere (Sketchfab, Quaternius, a colleague) and you want it in the game.

There are two routes. Check which one you are on **before** doing anything else:

```bash
tools/inspect_glb.py my-model.glb --clips
```

* **Route A — the model already animates.** It has its own clips and they suit the game.
  You are done in five minutes: add it to the model table and go. This is how the whole
  CC0 pack in `assets/models/` works.
* **Route B — the model is rigged but has no usable clips** (a static sculpture, a
  T-posed character, animation authored for a different skeleton). You retarget this
  project's clip set onto it. This is where the time goes, and where this document is
  mostly about.

---

## Route A — use the model's own clips

1. `tools/inspect_glb.py my-model.glb` and confirm `skinned yes`.
2. Read the clip names. Either rename them to match an existing family, or add a family.
3. Drop the file in `assets/models/` and add one line to the `KAIJU` table in
   `js/models.js`:

```js
kaiju_redking: { file: "kaiju-orc", family: "kaykit", tint: 0xffffff },
```

`file` is the filename without `.glb`, `family` selects the clip-name patterns, `tint`
multiplies the model's colours (`0xffffff` = leave them alone).

4. Reload. The character is in. Repeat `inspect_glb.py --clips` for the next one and
   reuse an existing family if the names line up — the four `CharacterArmature|…` packs
   here all share the `kaykit` family, and the four flyers share `wyvern`.

Naming a new family, in `js/models.js`:

```js
FAMILIES.mymonster = {
  idle: [/^Idle$/], walk: [/^Walk$/], run: [/^Run$/],
  atk1: [/^Attack_/], hit: [/^Hit/], death: [/^Death$/],
};
```

Patterns are tried in order, first match wins, and slots you leave out simply are not
built — the character plays what it has. A rig with only `idle` and `walk` is a valid
character.

---

## Route B — retarget the game's clip set onto it

### What is transferred, and what is not

The downloaded model keeps **its own mesh, its own skeleton and its own skin weights**.
Nothing about its geometry is touched. What moves across is *rotation*, bone by bone:

```
A_s(b,t)   world rotation of source bone b at time t          (from the game's clip)
R_s(b)     world rest rotation of source bone b               (source file, rest pose)
R_m(b)     world rest rotation of the matching model bone

A_m(b,t)     = R_m(b) · ( R_s(b)⁻¹ · A_s(b,t) )     ← carry the world-space motion
local_m(b,t) = A_m(parent,t)⁻¹ · A_m(b,t)            ← back into the bone's local frame
```

In words: measure how far each source bone has rotated *away from its own rest pose*,
then apply that same rotation to the model bone, on top of *its* rest pose. That is what
makes it work across rigs whose rest poses disagree.

Deliberately **not** transferred: the root bone's translation. Game characters are moved
by the game, so a clip's root motion would slide the character across the arena. Foot
planting is preserved instead by matching the animation's speed to the movement speed at
runtime (`RiggedActor` speed-matches locomotion).

And the model's **own clips are kept**. `retarget.py` appends the game's nine slots to
what was already in the file, so nothing is lost if you change your mind.

### 1. Write the bone map

The pipeline needs to know which of your model's bones correspond to the game's
seventeen slots:

```
hips  spine  chest  neck  head
shL uaL laL   shR uaR laR        (shoulders are optional)
ulL llL ftL   ulR llR ftR        (feet are optional)
```

Get both sides by reading the two skeletons:

```bash
tools/inspect_glb.py my-model.glb --bones      # note the names and rest positions
tools/inspect_glb.py assets/models/kaiju-frog.glb --bones   # the source rig
```

Then write `my-bones.json`:

```json
{
  "hips":  ["Hips",       "mixamorig:Hips"],
  "spine": ["Abdomen",    "mixamorig:Spine"],
  "chest": ["Torso",      "mixamorig:Spine1"],
  "neck":  ["Neck",       "mixamorig:Neck"],
  "head":  ["Head",       "mixamorig:Head"],
  "uaL":   ["UpperArm.L", "mixamorig:LeftArm"],
  "laL":   ["LowerArm.L", "mixamorig:LeftForeArm"],
  "uaR":   ["UpperArm.R", "mixamorig:RightArm"],
  "laR":   ["LowerArm.R", "mixamorig:RightForeArm"],
  "ulL":   ["UpperLeg.L", "mixamorig:LeftUpLeg"],
  "llL":   ["LowerLeg.L", "mixamorig:LeftLeg"],
  "ulR":   ["UpperLeg.R", "mixamorig:RightUpLeg"],
  "llR":   ["LowerLeg.R", "mixamorig:RightLeg"]
}
```

Left is `["source", "your model"]`. If a rig has unusable bone names — many MMD and
sculpt exports have bones called `#12` or `Object_7` — pin the slot to a node index by
walking the hierarchy output, `"uaL": ["UpperArm.L", "#38"]`. `tools/retarget.py` ships
one map that does exactly that (`jamila`) and it also asserts the pinned node's rest
position, so a silent mis-pin fails loudly instead of producing a bent monster.

The ten maps in `MAPS` at the top of `tools/retarget.py` are working examples covering
clean humanoids, MMO-style `bip_*` chains and index-pinned unknown rigs. Copy the one
that looks most like yours.

### 2. Run it

```bash
tools/retarget.py --model my-model.glb --map my-bones.json --out out/ --install
```

```
my-model    18422 tris  17 bones   9 clips   1.4 MB  k=1.02  OK
       clips: Idle, Walk, Run, Jump, Punch, ...
       installed -> assets/models/kaiju-my-model.glb
```

What the summary tells you:

| field | means |
|---|---|
| `17 bones` | how many of the seventeen slots were resolved. Fewer than 13 and the rig will look wrong. |
| `k=1.02` | the scale the tool applied so the model stands at the same height as the source. Far from 1 means the model was authored at a very different scale — fine, but check the result. |
| `OK` / `!!` | `!!` lists problems: an unmapped slot, a bone that does not exist, a clip with no channels |
| *(no skinned bounds fit)* | the tool could not find skinned geometry to measure. Almost always a model with no skin. |

### 3. Look at it

Numbers pass while the *pose* is wrong, so open the game and watch a wave. The two
failures that survive a clean summary, and what they look like:

* **Arms buried in the chest, or raised too high.** The model's rest pose disagrees with
  the source rig's by a fixed angle. Fix in §4.
* **The monster is a different size than its neighbours.** Run
  `tools/inspect_glb.py out/kaiju-my-model.glb` and compare the triangle count; if the
  mesh is fine, adjust `mobH` / `bossH` for its stage in `World.STAGES` — the spawner
  scales the loaded model to the requested height, so this is a one-number fix.

### 4. Rest-pose mismatch (`tools/hero_align.py`)

The classic. Your model is a T-pose; the game's clips were authored for a rig with the
arms hanging. Every arm rotation then lands ~75° away from where it was authored for and
the arms end up inside the chest.

`retarget.py` handles this **per bone, automatically**, by re-expressing each bone's
motion relative to the *target's* rest direction as well as its own. If for some reason
you need the correction applied to the clips themselves — which is what a hero needs,
because the clips are shared by five characters — use `hero_align.py`:

```bash
tools/hero_align.py --dry                                  # measure, write nothing
tools/hero_align.py --rig source-rig.glb --target hero.glb \
                    --clips anim-ual.glb --out out/aligned.glb
tools/hero_align.py --target hero.glb --clips anim-ual.glb --install
```

It reports the worst bones and the residual error:

```
== alignment: worst bones clavicle_l 12.7deg, upperarm_l 75.1deg, upperarm_r 75.0deg
   Idle_Loop     76 keys   bone-direction error 0.0300 deg
```

A residual near 0° means the clips now match the target rig. `--install` keeps a
`.orig` backup beside the file it replaces.

**This is the operation this project exists because of.** The shipped `hero.glb`
(CC0 mannequin) and `anim-ual.glb` are already consistent, so `--dry` reports a 0.0°
alignment — the tool is here for when you swap the mesh.

### 5. Split mesh from clips (`tools/strip_animations.py`)

Animation payload is most of an animation library's bytes. The hero is therefore two
files: `hero.glb` carries the mesh, skeleton and skin weights, and `anim-ual.glb`
carries the clips. That way the mesh request is small and the clip library can be cached
separately.

```bash
tools/strip_animations.py big-library.glb -o hero.glb         # mesh + skin only
tools/strip_animations.py big-library.glb --report            # what is in here?
tools/strip_animations.py big-library.glb -o out.glb --keep Idle_Loop,Walk_Loop
```

It deletes `animations` and then repacks the buffer: every accessor still reachable from
a mesh, index buffer, skin or embedded image is copied, the rest is dropped. 7.27 MB →
0.59 MB on the shipped hero. It will warn if the file uses glTF extensions it does not
understand, because those can hide buffer references.

---

## Route C — Roblox: bake the rig into Luau

Roblox has no runtime glTF loader, so none of the above applies to the Roblox build.
Instead, `tools/glb_to_roblox.py` runs **once, offline** and turns a `.glb` into Luau: a
skeleton module and one module per clip. The creature is then drawn by placing anchored
parts, not by skinning a mesh, so the whole skinned-bounds / rest-pose-mismatch class of
bug disappears.

```bash
tools/glb_to_roblox.py kaiju.glb --report                        # audit, writes nothing
tools/glb_to_roblox.py kaiju.glb --out ../roblox/src/shared      # bake it
```

It does five things, in this order:

1. **Reads the skeleton in rest pose** — each joint's local position and quaternion.
2. **Accumulates node scale** down the hierarchy, because glTF translations are in parent
   units and a rig exported at 1/100 scale would otherwise collapse to a dot.
3. **Thins leaf joints** — ranked by skin-influence mass and depth, so fingers go before
   anything that holds a limb together. Only leaves are ever removed, which guarantees a
   kept bone's parent is kept and no motion is lost. `--max-joints`, `--prune`.
4. **Strips the root joint's travelling translation** in world axes, so the clips do not
   fight the game's movement. `--root-motion strip|keep|none`.
5. **Works out which way the model walks** and records it as `forward`, in model space.
   `--yaw 180` when the guess is wrong — the single most common fix on a new rig.

Then it decimates to `--fps` and writes the modules. Playback is
`frames[joint] = frames[parent] * rest[joint] * delta[joint]`, which is the inverse of
what the tool divides out, so the two cannot drift — and because the rest pose and the
clips come from the same file, **Route C never needs the retargeting in Route B**.

What you keep from the contract above: feet at `y = 0`, and clips that answer to slot
names (`Content.clips` in the Roblox build is the `FAMILIES` equivalent). What you lose:
the mesh. See [`ROBLOX.md`](ROBLOX.md) for the budgets, and for the route back to a real
skinned mesh if you want one.

---

## The whole route, end to end

```bash
# 0. what have I got?
tools/inspect_glb.py ~/Downloads/kaiju.glb --bones --clips --materials

# 1. if it needs the game's animations:
$EDITOR my-bones.json
tools/retarget.py --model ~/Downloads/kaiju.glb --map my-bones.json --out out/ --install

# 2. if it is a hero mesh with no clips of its own:
tools/strip_animations.py ~/Downloads/hero-mesh.glb -o assets/models/hero.glb
tools/hero_align.py --target assets/models/hero.glb --clips assets/models/anim-ual.glb --dry

# 3. wire it up
$EDITOR js/models.js        # one line in KAIJU, or swap the hero file
# 4. look at it
python3 -m http.server 8777

# and, for the Roblox build, the same model without any of the above:
tools/glb_to_roblox.py ~/Downloads/kaiju.glb --report
tools/glb_to_roblox.py ~/Downloads/kaiju.glb --out roblox/src/shared
```

## Troubleshooting

| symptom | cause | fix |
|---|---|---|
| character stands in a T-pose forever | no clips matched any slot | `inspect_glb.py --clips`, then add/extend a family in `FAMILIES` |
| character slides without moving its legs | clips matched but the locomotion slot is idle | check `walk`/`run` patterns |
| arms swing from the hips | wrong bone in the map, usually `uaL` ↔ `laL` | `--bones` both rigs and compare rest positions |
| model is a giant / tiny | `mobH`/`bossH` in the stage config | adjust the number, the loader scales to it |
| model is buried to the knees | mesh origin is not at the feet | the loader drops the lowest point of the bounding box to 0; check the model has no stray helper object far below the feet |
| one limb does not move | that slot's clip has no channel for that bone | expected: mixed clip sets are partial by design |
| everything is dark | model needs an environment map for its metalness | `Models.buildEnv` already provides one; check the material's `metalness` is not 1 with `roughness` 0 |
| the game shows a billboard instead of the model | the GLB failed to load | read the browser console; malformed GLB is the usual cause |

## Requirements

The tools need Python 3 and **numpy** (they parse and write `.glb` themselves — there is
no glTF library dependency):

```bash
python3 -m pip install numpy
```
