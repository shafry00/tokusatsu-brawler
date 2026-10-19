# The asset contract

Everything in this folder is a **CC0 stand-in pack** so the repo runs the moment you
clone it. Replace any of it with your own models — the engine only asks three things of
a character, and this file is the whole specification.

```
assets/models/
  hero.glb            the player's mesh        (65-joint rig, no clips)
  anim-ual.glb        the player's clip library (no mesh needed)
  kaiju-<name>.glb    one file per monster      (mesh + clips in one file)
  LICENSE-CC0.txt
```

To play the example content exactly as shipped you need no changes at all. To put your
own character in, you need the three rules below.

---

## 1. A skeleton the game can address

The engine never hard-codes bone names for the kaiju. It plays clips **by pattern**
(see rule 3), and it moves a character by driving an `AnimationMixer` on whatever
skeleton the file contains. So any rigged humanoid or creature works, as long as it has
a normal spine limb structure.

The hero is the one exception, because the shipped `anim-ual.glb` keys clips **by bone
name**. If you keep the Universal Rig skeleton, everything binds with no work:

```
root  pelvis  spine_01  spine_02  spine_03  neck_01  Head
clavicle_l  upperarm_l  lowerarm_l  hand_l
  index_01_l index_02_l index_03_l index_04_leaf_l
  middle_01_l …  pinky_01_l …  ring_01_l …  thumb_01_l …
clavicle_r  upperarm_r  lowerarm_r  hand_r    (+ the same 20 finger bones)
thigh_l  calf_l  foot_l  ball_l  ball_leaf_l
thigh_r  calf_r  foot_r  ball_r  ball_leaf_r
```

65 joints. `hand_l`/`hand_r` are what the melee and beam code aim from, so keep those
names if you want the effects to leave the right place.

If your hero has a different skeleton, you have two options:

* **Retarget the clips onto it** — `tools/retarget.py` maps your bone names to the
  source rig's, slot by slot. This is the supported route.
* **Skip the shipped clips** — point `hero.glb` at a model that carries its own clips,
  then add a `hero` family entry in `js/models.js` with your clip-name patterns.

Check what you have before you start:

```bash
tools/inspect_glb.py my-model.glb --bones
```

## 2. Feet at `y = 0`, and don't worry about the scale

The loader measures the model's bounding box on load and normalises it:

* horizontal centre is moved to the origin,
* the **lowest** point is dropped to `y = 0` (`groundY`),
* the mesh is scaled so the character is the height the spawner asked for.

So a model authored in centimetres, or a 40-metre monster, both land correctly. The
scale factor is reported in the load log if you want to sanity-check it.

**Facing:** models are assumed to look down `+Z` (three.js default). If yours faces
the camera, add `rotateY(Math.PI)` to `r.root` right after the loader returns in
`js/models.js`; the world `yaw` is applied to that root afterwards.

**Root motion:** the top-level node's translation is **not** transferred when
retargeting, on purpose. Game characters are moved by the game, not by their clips —
otherwise every attack would slide the character across the arena.

## 3. Clip slots

The engine asks for a character state by *slot name* and resolves it against the clip
names in the file. First matching pattern wins, so a rig missing a slot degrades to a
close relative instead of breaking:

| slot | when it plays | loops |
|---|---|---|
| `idle` | standing still | yes |
| `walk` | moving, under 12 u/s | yes |
| `run` | moving, over 12 u/s | yes |
| `jump` | take-off | no |
| `air` | airborne, in flight | yes |
| `land` | touching down | no |
| `atk1` / `atk2` | light attack, heavy attack | no |
| `slash` | the piercing ring | no |
| `beam` | the ranged attack | no |
| `hit` | taking damage | no |
| `death` | dying | no |
| `roll` | dash | no |

The patterns live in the `FAMILIES` table in `js/models.js`. The `kaykit` family that
the CC0 kaiju use is:

```js
idle: [/Idle$/i],   walk: [/Walk$/i],     run: [/Run$/i, /Walk$/i],
jump: [/Jump$/i],   atk1: [/Punch$/i, /Weapon$/i],
hit:  [/HitReact$/i],  death: [/Death$/i]
```

Add a family for your rig, or rename your clips to match an existing one. A character
with **only** `idle` and `walk` still plays — it just never attacks with its own
animation.

The hero's `hero` family expects the Universal Animation Library names
(`Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop`, `Jump_Start`, `Jump_Loop`, `Jump_Land`,
`Punch_Jab`, `Punch_Cross`, `Sword_Attack`, `Spell_Simple_Shoot`, `Hit_Chest`,
`Hit_Head`, `Death01`, `Roll`).

**Timing:** clips are retimed to the game's attack windows rather than the other way
round. A 0.8 s punch animation will be time-scaled to fit a 0.09 + 0.10 + 0.13 s
light-attack window, so a slow or fast clip stays in sync with the hitboxes.

---

## Colours and tinting

Textured models are used as authored — the CC0 pack renders with its own base colours.

Untextured models (no `map`, no `COLOR_0`) are given a neutral suit grey, a darker tone
for materials whose name contains `joint` / `dark` / `black` / `metal`, and a hint of
the role's accent colour so the player and the four allies stay distinguishable. That is
the rule that makes the shipped mannequin look deliberate. See `_dressHero` in
`js/models.js`.

Materials whose name contains `eye` are turned emissive. Name an eye material `Eye` and
it will glow.

## Billboards (optional)

The 2.5D sprite path in `assets/sprites/` is a fallback, not a requirement. Any PNG that
is not there is replaced at runtime by a procedurally drawn silhouette, so deleting the
folder is a supported configuration. See [`../docs/SPRITES.md`](../docs/SPRITES.md).

## Where to get models

* [Quaternius](https://quaternius.com) — CC0 characters, monsters, animals *(the mannequin
  and several kaiju here come from here)*
* [KayKit](https://kaylousberg.com) — CC0 character and creature packs *(the frog/orc
  skeletons here come from here)*
* [Kenney](https://kenney.nl) — CC0, blocky, good for prototyping
* [Mixamo](https://mixamo.com) — free rigs and a huge clip library (check the terms)
* [Sketchfab](https://sketchfab.com) — filter by **CC0** or **CC-BY**; CC-BY requires
  attribution, CC0 does not

Whatever you download, run it through `tools/inspect_glb.py` first, and read
[`../docs/ASSET-PIPELINE.md`](../docs/ASSET-PIPELINE.md).
