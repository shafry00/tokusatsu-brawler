# Building this game for Roblox

The [main README](../README.md) covers the three.js build. This is the Roblox half: how
a downloaded `.glb` becomes Luau, why the animation system is anchored parts instead of
`Animator` and `Motor6D`, what Roblox's import budgets actually are, and what is and is
not verified in [`../roblox/`](../roblox).

Read [`../roblox/README.md`](../roblox/README.md) first if you have not — it is the
practical guide. This file is the reasoning.

---

## 1. Three ways to get a character into Roblox

| Route | What it costs you | When it is right |
|---|---|---|
| **Import the mesh in Studio** (`File → Import 3D`) | A manual step per character, a `.rbxm` in the place file, and a skinned `MeshPart` per creature. Roblox's `Animator` then needs a `KeyframeSequence` per clip, which you get from the Animation Clip Editor. | You want the real mesh, and you are shipping a fixed roster. |
| **Bake the rig into Luau** (what this repo does) | No mesh at all — creatures are assembled from primitives. Loses surface detail. | You want the repo to run on clone with no uploads, and you want a template someone can retune. |
| **Upload clips as Roblox animations** (`Animation` assets) | Requires a published place and an asset id per clip; clips belong to a group or user. | You already own the meshes and want the stock animation pipeline. |

Roblox cannot read a `.glb` at runtime. There is no loader, no `GLTFLoader`, nothing to
vendor. So the repo takes route two: the tool runs offline, and what ships is data.

The advantages turned out to matter more than "it is the only thing that works on
clone":

* **Playback is deterministic.** `Figure.luau` computes every part's `CFrame` from the
  clip tables by hand, so the same clip at the same phase gives the same pose on a
  phone and on a PC, with no floating-point divergence between an engine's animation
  solver and yours.
* **Nothing is physics.** No `Motor6D`, no joint chains to settle, no ragdoll that
  explodes when a creature spawns inside a wall. Thirty anchored parts cannot misbehave.
* **The rig is cheap to retune.** A monster is `girth`, `height`, two colours and a list
  of decorations. Ten species, one skeleton.
* **It scales down.** A creature costs ~30 parts and ~30 `CFrame` writes per frame. A
  dozen of them on the server is a rounding error next to a single skinned mesh.

---

## 2. What the tool does

```bash
tools/glb_to_roblox.py assets/models/anim-ual.glb --out roblox/src/shared
```

`tools/glb_to_roblox.py` is standard-library-only Python that parses the GLB container
itself. In order:

**a. Reads the skeleton in rest pose.** Every node with a skin is a joint. Each joint's
local frame becomes `rest = {x, y, z, qx, qy, qz, qw}` — position and quaternion in its
parent's space — which is exactly what `Figure.luau` needs, because its playback is
`frames[j] = frames[parent] * rest[j] * delta[j]`.

**b. Accumulates node scale onto the joints.** glTF translations are in parent units, so
a rig exported at 1/100 scale (the KayKit rigs are) would put every joint a hundredth of
a stud from its parent. The tool multiplies each node's scale down the hierarchy and
folds it into the joint's translation and size. The `scale` field in `Rig.luau` is then
metres → studs (3.57143 for the shipped rig), and `height` is a sanity number printed so
you can see whether 1.8 m actually came out as 5.6 studs. A non-uniform scale anywhere in
the chain is warned about rather than silently mangled.

**c. Thins the skeleton.** A 65-joint humanoid has 40 finger bones that a game made of
blocks cannot show and does not want to pay for. Thinning only ever removes **leaf**
joints — a joint with no children — so a kept bone's parent is always kept, and no rest
composition or lost motion can happen. Candidates are ranked by how much skin influence
their subtree carries and by depth, so fingers and nubs go before anything that holds a
limb together. Override the target with `--max-joints`; the shipped rig lands on 23.

```
--prune   default: (finger|thumb|index|middle|ring|pinky|_leaf|-leaf|_nub|_tip|pole|_ik$|^ik_)
```

**d. Strips root motion.** The root joint's translation is what makes a walk cycle
travel. In a game where the code moves the creature, that translation fights you. The
tool measures the root's total displacement per clip in world axes, removes it from the
root channel (`--root-motion strip`, which is also `keep` or `none`), and records what it
removed. This is the same rule the web pipeline enforces by not transferring root
translation when retargeting.

**e. Works out which way the model faces.** The clip that travels furthest has a known
direction of travel, in the rig's own coordinates. The tool converts that to model space
and writes it as `forward` in `Rig.luau` — so a creature authored facing `+X`, which is
most of the monsters in the CC0 pack, does not moonwalk. `--yaw` overrides it if the
heuristic picks wrong; see §5.

**f. Reduces and writes.** Keyframes are decimated (24 fps by default, `--fps`), split
per joint into a flat `t` array and a flat `q` array, and each clip is written as one
ModuleScript. Fifteen clips for the shipped rig is ~105 KB of Luau; the rig itself is
~4 KB.

---

## 3. The playback formula, and why it is safe

```lua
frames[joint] = frames[parent] * rest[joint] * delta[joint]   -- posed
part.CFrame   = frames[joint] * offset[joint]                 -- drawn
```

* `rest` comes from the GLB's bind pose, scaled by the profile.
* `delta` is the clip, sampled with a binary search and `CFrame:Lerp` between the two
  neighbouring keys. Roblox's `CFrame:Lerp` interpolates rotation properly, so no
  quaternion slerp is needed in Luau.
* `offset` is the little `CFrame` that hangs a block off a joint so it points at the
  child bone — that is what turns a cloud of cubes into limbs.

The formula is the *inverse* of what the tool bakes, which is the correctness argument:
the tool derives `delta` by dividing out `rest`, so playback cannot drift. It also means:

* No retargeting is required for the generated rig. Retargeting exists to move clips
  between rigs that disagree about their rest pose; here the rig and the clips come from
  the same file, so they agree by construction.
* `tools/retarget.py` is still there for the case it is actually for — putting the game's
  clip set on a rig that has its own rest pose (the web build's monsters do exactly this).

---

## 4. The budget audit

Roblox enforces hard limits at import. The tool checks them before you find out the hard
way:

```bash
tools/glb_to_roblox.py ~/dl/my-kaiju.glb --report
```

```
== my-kaiju.glb
   1 mesh(es), 7344 triangles (biggest mesh 7344)
   43 joints
   8 clip(s)
   -- Roblox budgets ------------------------------------
   ok   triangles: every mesh is at or under 20000
   ok   skin weights: at most 4 bone(s) per vertex
   docs: create.roblox.com/docs/art/modeling/specifications
```

| Limit | Value | Where it comes from |
|---|---|---|
| Triangles per mesh | 20,000 | Roblox modelling specifications |
| Bone influences per vertex | 4 | Roblox modelling specifications |
| Texture resolution | 1024 × 1024 | Roblox texture specifications |
| Rigid accessory budget | 4,000 triangles | Roblox rigid accessory specifications |
| R15 body, all parts | 10,742 triangles | Head 4,000 · Torso 1,750 · each limb 1,248 |

Every model in the CC0 pack passes, and the largest of them — `anim-ual.glb` and
`hero.glb`, the same mannequin — is 13,744 triangles:

| Model | Triangles | Joints | Clips |
|---|---|---|---|
| `anim-ual.glb` (the shipped rig) | 13,744 | 65 | 15 |
| `kaiju-dragon.glb` | 7,438 | 46 | 6 |
| `kaiju-orc.glb` | 7,344 | 43 | 8 |
| `kaiju-mushroom.glb` | 6,044 | 43 | 8 |
| `kaiju-skeleton.glb` | 5,934 | 41 | 20 |
| `kaiju-bluedemon.glb` | 5,800 | 43 | 8 |
| `kaiju-tribal.glb` | 5,252 | 38 | 6 |
| `kaiju-frog.glb` | 5,016 | 43 | 8 |
| `kaiju-squid.glb` | 4,880 | 43 | 6 |
| `kaiju-demon.glb` | 4,784 | 43 | 6 |
| `kaiju-bull.glb` | 2,418 | 42 | 9 |

Note what those joint counts are: the **source** rigs. Baking thins them (65 → 23 for the
shipped one, because a block creature has no fingers), which costs you nothing visually
and is where most of the size win comes from.

---

## 5. Facing: the one thing that goes wrong

A `.glb` has no opinion about which way it looks. The tool guesses, from the clip that
travels furthest: whatever direction that clip moves the root in, in model space, is
declared `forward`.

`Figure.luau` then builds a frame from it, and everything else is expressed against that
frame:

```lua
FWD   = normalise(forward)          -- model space; (0,0,-1) for the shipped rig
RIGHT = FWD:Cross(UP)
FACING = CFrame.fromMatrix(Vector3.zero, RIGHT, UP, -FWD)
```

`FACING` is what puts horns on heads and tails behind creatures, so a rig facing `+X`
still gets its horn pointing forward. **Decorations are authored in model space** — Y up,
−Z forward, +X to the creature's right — and rotated into place at runtime. That is why
`Content.profiles` can describe a body without knowing which `.glb` it came from.

To walk a creature at a player, the server needs the yaw that maps the model's forward
onto Roblox's `-Z`:

```lua
FORWARD_YAW = math.atan2(Figure.forward:Cross(Vector3.new(0,0,-1)).Y,
                         Figure.forward:Dot(Vector3.new(0,0,-1)))
```

and a creature is then faced with

```lua
CFrame.lookAt(pos, pos + direction) * CFrame.fromAxisAngle(Vector3.yAxis, FORWARD_YAW)
```

**If creatures moonwalk**, the guess was wrong: bake again with `--yaw 180` (or `--yaw 90`
/ `270`), which rotates the recorded forward and nothing else. It is a one-line fix and it
is the single most common thing to get wrong on a new rig.

---

## 6. Clips and slots

The game logic never names a clip. It names a **slot**, and `Content.clips` is the only
file that knows which clip answers it — so re-baking from a different rig means editing
one table:

| Slot | Villain rig plays | Shipped clip |
|---|---|---|
| `idle` | standing, waiting | `Idle_Loop` |
| `walk` | chasing, over 26 studs away | `Walk_Loop` |
| `run` | chasing, closer | `Jog_Fwd_Loop` |
| `atk1` | the wind-up for a normal strike | `Punch_Jab` |
| `slash` | the wind-up for a boss strike | `Sword_Attack` |
| `hit` | staggered by a player hit | `Hit_Chest` |
| `death` | dying | `Death01` |
| `beam` `jump` `air` `land` `roll` `sprint` | provided for your own use | `Spell_Simple_Shoot`, … |

Locomotion clips are time-scaled per creature (`fig:play("walk", { speed = 0.8 })`), so a
slow brute's walk cycle does not break into a sprint. `Figure:play` returns early when the
clip is already current, which is what makes it safe to call every frame.

Unknown slots are not an error: `Figure:has(name)` and the lazily-decoded clip table mean
a rig with two clips still runs, just with less to say.

---

## 7. What runs where

Everything is authoritative on the server, because a starter should have exactly one
place where the truth lives:

| Remote | Direction | Carries |
|---|---|---|
| `Attack` | client → server | the aim vector; the server decides the hit |
| `Beam` | client → server | the aim vector |
| `Roll` | client → server | the aim vector |
| `State` | server → all | stage, wave, enemy count, boss hp, scores (4 Hz) |
| `Feedback` | server → one | `swing`/`hit`/`kill`/`hurt`/`banner`, for the HUD and shake |

The client's only privileges are optimistic feel: cooldowns a hair shorter than the
server's (so the server is always the one that says no), sprint, and camera shake. A
hacked client can fire `Attack` in a loop and it will still only swing once per recovery
window, because the cooldown that matters is the server's.

**Costs, so you know where the ceiling is.** Each creature is ~30 anchored parts,
~30 `CFrame` writes per frame, one small state machine, and no physics. The expensive
parts are replication of those `CFrame` writes and the per-frame `Heartbeat` loop. A
dozen creatures is comfortable; the interesting crossover is when replication, not CPU,
starts to bite.

**Moving monsters to the clients** is the documented upgrade and it is not a rewrite:

1. Each client creates the `Figure` locally from a `spawn` message (species + position),
   reusing `Figure.luau` unchanged — it is pure CFrame maths on parts it owns.
2. The server keeps the state machine and sends a snapshot at ~10 Hz; clients
   interpolate between snapshots instead of stepping the AI.
3. Hits stay server-decided; the client's figure is only a view.
4. `Effects.luau` moves with it — the file's header says so, and the same remote that
   carries a hit can carry the effect.

---

## 8. Monsters out of decorations

A species is a body plan plus numbers, and a body plan is a list of things bolted to
named joints:

```lua
{ joint = "Head", kind = "cone", at = Vector3.new(0.3, 0.42, -0.05),
  size = Vector3.new(0.85, 0.20, 0.20), shade = "trim",
  tilt = CFrame.fromEulerAnglesXYZ(math.rad(-16), 0, math.rad(-20)) }
```

| Field | Meaning |
|---|---|
| `joint` | which joint to bolt it to, by rig joint name (`Head`, `spine_03`, `thigh_l`, …) |
| `kind` | `cone` (a `Cylinder` laid along the joint's up), `ball`, or anything else → `Block` |
| `at` | offset in model space: Y up, −Z forward, +X right |
| `size` | in studs; a `cone`'s length runs along its first axis |
| `tilt` | extra rotation |
| `shade` | which palette colour: `hull`, `trim`, `glow` |
| `material` | `Neon` for eyes and crests, `Metal` for armour, default smooth plastic |
| `count`, `spacing` | for `kind = "spikes"` — a ridge stepping back along the body |
| `step`, `shrink` | for `kind = "tail"` — segments that taper |
| `side` | for `kind = "wing"` — mirrored across X |

Decorations ride the joint they were bolted to but keep the **model's** orientation, so a
horn never spins with the bone it happens to sit on.

---

## 9. Adding a monster, end to end

1. `Content.profiles.tank = { girth = 1.6, height = 1.25, extras = { ... } }` — a body.
2. `Content.species.mymon = { name = "My Mon", profile = "tank", hull = ..., trim = ...,
   health = 180, speed = 11, damage = 17, windup = 0.5, reach = 9, cooldown = 1.4,
   bounty = 4 }` — numbers. `windup` is the tell before a hit lands; under a quarter
   second reads as unfair, which is why the fast species hit softly.
3. Add `{ species = "mymon", count = 2, from = "north" }` to a stage's `waves`, or point a
   stage's `boss` at it and set `boss = true` on the species (it spawns at 1.4× scale with
   a shorter stagger).
4. Press Play. Nothing else needs to know it exists.

The tuning rules that survived contact: windup ∝ damage, `keepOut` is derived from reach so
creatures do not stand inside each other, and a hit always interrupts the state machine
(`stagger`), because a combo the enemy can ignore is not a combo.

---

## 10. If you would rather import the mesh

`File → Import 3D` in Studio takes `.fbx`, `.gltf` and `.obj`, and for `.fbx`/`.gltf` it
brings across mesh hierarchies, PBR textures, **rigs, skinning and animation data**, and
vertex colours. The Animation Clip Editor can import glTF clips directly (they land under
`AnimSaves` as `KeyframeSequence`s).

The trade is:

| | Generated rig (this repo) | Imported skinned mesh |
|---|---|---|
| Art | primitives, retunable forever | the real mesh |
| Cost | ~30 parts, no physics | one `MeshPart`, skinning, `Motor6D` chains |
| Animation | baked tables, `Figure.luau` | `Animator` + `KeyframeSequence` |
| Adds | nothing | a `.rbxm` per character, and uploads if you publish clips |
| Effort | zero | a manual import pass per creature, plus rig-type and scale checks |

If you take that route, keep everything else: `Content.luau` is pure data, the server's
state machine only needs `position`, `play(slot)`, `flash`, `jointPosition` — swap
`Figure.luau` for a module with the same five methods and the game does not notice.

---

## 11. Uploading things: avatars, UGC, Marketplace

Nothing in this repo needs uploading, and that is deliberate — the whole point of the
generated rig is that a clone runs without an asset id. If you do want the creatures to be
real assets:

* **R15 bodies** split into six assets (`DynamicHead`, `Torso`, `LeftArm`, `RightArm`,
  `LeftLeg`, `RightLeg`) with the per-part budgets in §4 — 10,742 triangles in total.
  Geometry must be watertight, quads where possible, transforms frozen and pivots at
  `(0,0,0)`.
* **Rigid accessories** have their own budget: 4,000 triangles, and a bounding-box table
  per body scale. Studio's Importer can apply the scale for you.
* **Textures** cap at 1024×1024 — which is what a character-sized model actually needs
  (Roblox shows a 1024² map on an 8×8 stud face).
* **Players stay stock.** The game touches the player's `Humanoid` and `HumanoidRootPart`
  and nothing else, so any avatar works, including layered clothing and UGC the player
  owns. That is also why the R15 default animations are left alone — a custom animation
  pack would fight whatever the player brought.

---

## 12. What is verified, and how

| Check | Status |
|---|---|
| Every `.luau` file parses | ✅ `luau-compile --binary` |
| Every `.luau` file type-checks against the real Roblox API | ✅ `luau-lsp analyze --definitions=globalTypes.d.luau` |
| The generated rig/clips are self-consistent | ✅ verified on three different rigs (`anim-ual`, `kaiju-frog`, `kaiju-dragon`) with the tool's own round-trip |
| Cross-module signatures (every `Effects.hit`, `Hud:setStage`, `fig:play` call site) | ✅ checked by hand — the analyzer cannot see them without a Rojo sourcemap |
| **The game running in a real client** | ❌ **never done.** No Studio was available. |

`luau-lsp analyze` reports exactly 14 diagnostics on a clean checkout, and all 14 are the
same thing: it cannot resolve `script.Parent.Foo` without a sourcemap, so `require` of a
sibling module is an "Unknown require" plus a "could be nil". Generate a sourcemap
(`rojo sourcemap default.project.json -o sourcemap.json`) and they disappear. Everything
else is clean.

```bash
luau-lsp analyze --definitions=globalTypes.d.luau \
  roblox/src/shared/*.luau roblox/src/server/*.luau roblox/src/client/*.luau
```

---

## 13. Troubleshooting the first run

| What you see | What it is | The knob |
|---|---|---|
| Creatures walk backwards | the facing guess | re-bake with `--yaw 180` |
| Creatures float or sink | the source rig's feet were not at the origin | check the tool's printed rig extent; nudge `Figure`'s root or re-export |
| A creature slides while walking | clip speed vs move speed | `fig:play("walk", { speed = ... })` in `Game.server.luau` |
| Nothing attacks | `Content.clips` names do not match the generated clip module names | the tool prints the names it wrote; the rig name must match too |
| "Unknown require" everywhere | no Rojo sourcemap | expected; see §12 |
| The player falls forever | the stage never built — check for an error in `Stage.luau`, and that `Content.stages` has entries | — |
| Attacks pass through | `reach` and `arc` are measured from the torso, and the overlap query only sees the hitbox | raise `Content.player.combo.reach` |
| It stutters with many creatures | server-side `CFrame` replication | §7, move the views to the clients |
| Everything is the same colour | the species palette is `hull`/`trim`, and profiles default to grey | set `hull` and `trim` on the species |
