# The asset pipeline

Five small Python tools. They parse and write `.glb` themselves — **numpy is the only
dependency**, and only the retargeting pair needs even that; `glb_to_roblox.py` is
standard library only:

```bash
python3 -m pip install numpy
```

| tool | what it is for |
|---|---|
| `inspect_glb.py` | look inside a file before committing to a pipeline: triangles, skin, bones in the rest pose, clips, materials |
| `retarget.py` | move the game's clip set onto a different model's own skeleton |
| `hero_align.py` | re-express a clip library through the rest-pose difference between two rigs |
| `glb_to_roblox.py` | audit a model against Roblox's limits, then bake its rig and clips into Luau |
| `strip_animations.py` | split the mesh from the clips, and repack the buffer |
| `fetch-cc0-assets.sh` | pull a pack in and report what is in it |

Full walkthrough with the reasoning: [`../docs/ASSET-PIPELINE.md`](../docs/ASSET-PIPELINE.md).

## Quick tour

```bash
# what have I got?
tools/inspect_glb.py model.glb                     # summary
tools/inspect_glb.py model.glb --bones             # skeleton + rest positions
tools/inspect_glb.py model.glb --clips             # clip names and durations
tools/inspect_glb.py model.glb --materials         # what each material references

# put the game's animations on it
tools/retarget.py --list                           # the ten bone maps that ship here
tools/retarget.py --model model.glb --map bones.json --install

# the hero's two-file split
tools/strip_animations.py lib.glb -o hero.glb                 # mesh + skin, no clips
tools/strip_animations.py lib.glb -o out.glb --keep Idle_Loop # or a subset

# rest-pose mismatch
tools/hero_align.py --dry
tools/hero_align.py --target hero.glb --clips anim-ual.glb --install

# the Roblox build: audit, then bake the rig and its clips into Luau
tools/glb_to_roblox.py model.glb --report
tools/glb_to_roblox.py model.glb --out ../roblox/src/shared
```

## `inspect_glb.py`

Reads only the JSON chunk for everything except the summary, so it stays fast on files
with a large animation payload. `--bones` walks the node hierarchy in rest pose and
marks skin joints with `*`, printing each bone's world position — which is how you write
a bone map without guessing which of `bn_clav_L_45` and `bn_upperarm_L_44` is which.

```bash
tools/inspect_glb.py assets/models/hero.glb --json | python3 -m json.tool
```

## `retarget.py`

World-delta retargeting: each bone's *rotation away from its own rest pose* is measured
in world space and re-applied to the matching bone of the target rig, on top of that
bone's rest pose. Root translation is deliberately not transferred; game characters are
moved by the game.

```bash
tools/retarget.py <key>                                  # tools/models/<key>.glb -> tools/out/
tools/retarget.py --model x.glb --map bones.json         # any model, explicit map
tools/retarget.py --model x.glb --map bones.json --install   # also copy into assets/models/
tools/retarget.py <key> --no-align                        # keep the target's rest pose
tools/retarget.py --out /tmp/whatever                    # where to write
```

A bone map is 13–17 slots — `hips spine chest neck head`, the six arm bones, the six leg
bones — mapping `["source bone", "target bone"]`:

```json
{ "hips": ["Hips", "mixamorig:Hips"],
  "uaL":  ["UpperArm.L", "mixamorig:LeftArm"] }
```

Targets may be a node index instead of a name (`"#38"`) for rigs with unusable names;
the map that ships as `jamila` does this and asserts the pinned node's rest position, so
a bad pin fails loudly instead of quietly bending the model.

The ten maps in `MAPS` are real, working examples covering a clean named humanoid, an
MMO-style `bip_*` chain, and an index-pinned unknown rig. Copy the closest one.

The summary line is the review:

```
kaiju-zetton  22140 tris  17 bones   9 clips   2.1 MB  k=1.04  OK
```

`17 bones` is how many slots resolved (under 13 and the result will look wrong), `k` is
the scale applied to match the source's height, and anything after `OK`/`!!` is a
warning worth reading. The model's **own clips are kept** — the retargeted set is
appended.

## `hero_align.py`

When a clip library and the mesh it drives share bone names but not rest poses, every
limb gets a constant angular offset. This tool bakes the correction into the clips:
each bone's rest direction in the source rig is mapped onto its rest direction in the
target rig, and each keyed quaternion is rotated by that shortest arc.

```bash
tools/hero_align.py --dry
# == alignment: worst bones clavicle_l 12.7deg, upperarm_l 75.1deg, upperarm_r 75.0deg
#    Idle_Loop  76 keys  bone-direction error 0.0300 deg
```

`--dry` measures and writes nothing. The residual error line is the proof it worked: on
this project's own hero it reports 0.03°.

## `glb_to_roblox.py`

Two jobs, and the first one is worth running on any model you are thinking about using,
even for the web build, because Roblox's limits are a decent proxy for "is this mesh
sane": 20,000 triangles per mesh and at most 4 bone influences per vertex.

```bash
tools/glb_to_roblox.py model.glb --report          # audit only, writes nothing
tools/glb_to_roblox.py model.glb --out dir         # bake Rig.luau + clips/
tools/glb_to_roblox.py model.glb --out dir --quiet # just the summary line
```

The bake is the interesting half. In order: read the skeleton in rest pose; accumulate
node scale down the hierarchy (glTF translations are in parent units, so a rig exported
at 1/100 scale would otherwise collapse); thin **leaf-only** joints — rank candidates by
skin-influence mass and depth, honouring `--max-joints` and `--prune` — so a kept bone's
parent is always kept and no motion is lost; strip the root joint's travelling
translation in world axes (`--root-motion strip|keep|none`); work out which way the model
walks, from the clip that travels furthest, and record it as `forward` in model space
(`--yaw 180` if the guess is wrong); then decimate to `--fps` and write one ModuleScript
per clip plus an `init.luau` index of thunks.

Playback in Luau is `frames[joint] = frames[parent] * rest[joint] * delta[joint]`, which is
exactly what this tool divides out when it bakes `delta` — so the two cannot drift. The
generated rig needs no retargeting for the same reason: the rest pose and the clips come
from the same file. Full write-up: [`../docs/ROBLOX.md`](../docs/ROBLOX.md).

Verified on three rigs with different shapes — `anim-ual.glb` (65 → 23 joints, 15 clips,
5.6 studs), `kaiju-frog.glb` (43 → 21, 8 clips, 6.7 studs) and `kaiju-dragon.glb`
(21 joints, keeping its four-segment wings, 6 clips, 8.0 studs).

## `strip_animations.py`

Deletes `animations`, then repacks: it walks every accessor still reachable from a mesh,
an index buffer, a skin or an embedded image, copies only those bytes into a fresh
buffer, and rewrites the accessor and bufferView tables. Unused payload is dropped
(7.27 MB → 0.59 MB here). It warns about glTF extensions it does not understand, because
those can hide buffer references.

```bash
tools/strip_animations.py big.glb -o mesh-only.glb
tools/strip_animations.py big.glb --report
tools/strip_animations.py big.glb -o subset.glb --keep Idle_Loop,Walk_Loop,Run_Loop
```

## Layout

```
tools/
  models/     drop downloaded models here (<key>.glb for a built-in bone map)
  out/        build output; git-ignored
```

Both are git-ignored, so nothing you download by accident ends up in a commit. If you do
want to ship a model, put it in `assets/models/` — that is what `--install` is for.
