# TOKUSATSU BRAWLER — Roblox

The same game as the [three.js build](../README.md), rebuilt for Roblox: nine waves of
generated monsters, a stock R15 avatar as the player, combos, a piercing beam, a roll,
score, stages.

The interesting part is that **nothing here needs a `.glb` at runtime**. Roblox cannot
load glTF at runtime, so the tool in [`../tools/glb_to_roblox.py`](../tools/glb_to_roblox.py)
runs *once*, offline, and bakes a downloaded `.glb` into Luau: one `Rig.luau` for the
skeleton, one module per clip. `Figure.luau` then plays those clips by placing anchored
parts, and the result is identical on every machine because there is no engine animation
system involved.

That means this folder is a **template**, like the web build: clone it, run it, and you
get a playable game made of Roblox primitives. Swap in your own rig when you have one.

```
┌────────────────────────────────────────────────────────────────┐
│  your .glb ──► tools/glb_to_roblox.py ──► Rig.luau + clips/*    │
│                        (offline, once)          │               │
│                                                 ▼               │
│  Content.luau ──► Figure.luau ──► anchored parts   (server)     │
│       (data)          ▲                          │              │
│                       └── State/Feedback remotes ▼              │
│                                            Hud.luau  (client)   │
└────────────────────────────────────────────────────────────────┘
```

## Quickstart

You need [Rojo](https://rojo.space) (`aftman install` / `cargo install rojo`) or about
five minutes of dragging files around in Studio.

**With Rojo:**

```bash
cd roblox
rojo serve                 # then connect from the Rojo plugin inside Studio
```

`default.project.json` builds this tree:

```
ReplicatedStorage.Battle      ← src/shared   (Content, Figure, Effects, Net, Stage, Rig, clips)
ServerScriptService.Battle    ← src/server   (Game — a Script)
StarterPlayerScripts.Battle   ← src/client   (Controller — a LocalScript, Hud — a ModuleScript)
```

**Without Rojo**, make those folders by hand and paste the files in. Two things to get
right:

* `ReplicatedStorage.Battle.clips` must be a **ModuleScript** whose *source is*
  `src/shared/clips/init.luau`, with the other clip files as its **children**, each
  ModuleScript named exactly like the clip (`Idle_Loop`, `Punch_Jab`, …). That is how
  Roblox maps a folder with an `init.luau` in it, and `Figure.luau` looks clips up by
  child name.
* `Rig`, `Content`, `Figure`, `Effects`, `Net` and `Stage` are siblings of `clips`.

Then press Play. There is no baseplate to add and no model to upload — `Stage.luau`
builds the arena on the first frame, and the monsters are parts.

## Controls

| Input | Action |
|---|---|
| `W A S D` / stick | Move — Roblox's own controller, sprinting included |
| `Space` / `A` | Jump |
| Left click / `F` / `R2` | Swing — chains into a 3-hit combo if you keep hitting |
| `Q` / `R1` | Beam — pierces everything in a line, 7 s cooldown |
| `R` / `B` | Roll — a short dash with invincibility frames |
| `Shift` / `L3` | Sprint |

Everything except sprint goes through a remote and is re-validated on the server; sprint
only changes your own `WalkSpeed`, which the server has no reason to care about.

## What's in the folder

| File | Role |
|---|---|
| `default.project.json` | Rojo tree |
| `.luaurc` | Non-strict analysis for editors, with the noisy lints (unused locals) off |
| `src/shared/Content.luau` | **Edit this one.** Player stats, 5 body plans, 10 species, 4 stages |
| `src/shared/Figure.luau` | Builds a creature out of the rig and plays clips on it |
| `src/shared/Rig.luau` | **Generated.** The skeleton and every joint's rest frame and shape |
| `src/shared/clips/` | **Generated.** One ModuleScript per clip, lazily required |
| `src/shared/Stage.luau` | Builds an arena from `Content.stages` |
| `src/shared/Effects.luau` | Hits, shocks, beams, damage numbers — all self-cleaning |
| `src/shared/Net.luau` | The remote contract (5 RemoteEvents, created on demand) |
| `src/server/Game.server.luau` | Arena, waves, monster AI, combat resolution, scoring |
| `src/client/Controller.client.luau` | Input, camera shake, HUD wiring |
| `src/client/Hud.luau` | The HUD, built in code |

The generated files carry a `do not edit` header because regenerating overwrites them.
Everything interesting you would want to change is in `Content.luau`:

```lua
Content.profiles.skirmisher = { girth = 0.85, height = 0.86, extras = { ... } }
Content.species.jamila      = { profile = "skirmisher", health = 42, speed = 16, ... }
Content.stages[1]           = { name = "Landing Zone", radius = 150, waves = { ... } }
```

Add a species by adding a table. Add a body plan by describing decorations — horns,
spikes, wings, a tail — declaratively; they get bolted to named joints at build time.
Ten monsters out of one 23-joint skeleton is the whole trick.

## Bring your own rig

```bash
# what will this cost on Roblox? (triangles, joints, bone influences, textures)
tools/glb_to_roblox.py ~/dl/my-kaiju.glb --report

# bake it
tools/glb_to_roblox.py ~/dl/my-kaiju.glb --out roblox/src/shared --max-joints 40
```

The tool prints exactly what it wrote — how many joints survived, which clips, how tall
the rig is, and which way it walks. Paste those numbers into `Content.clips` if your clip
names differ from the shipped ones.

Two things worth knowing before you pick a rig:

* **The generated rig needs no retargeting.** The rest pose and the clips come out of the
  same file, so they match by construction. `Figure.luau` builds parts that are *posed by*
  the clips, not skinned by them, which sidesteps the whole retargeting problem.
* **Clip coverage matters more than joint count.** The shipped rig has 15 clips
  (`idle walk run atk1 hit death …`). A rig with two clips still runs — the creature just
  repeats idle when it should be attacking.

## Being honest about what is verified

This folder is **type-checked, not Studio-tested.** There was no Roblox Studio available
when it was written, so:

* every `.luau` file parses and passes `luau-lsp analyze` against the real Roblox API
  definitions (`luau-lsp analyze --definitions=globalTypes.d.luau src/**/*.luau`),
* the generated Luau is produced by a tool that was verified against three different
  rigs and prints what it did,
* the *runtime* behaviour — did the monster actually walk at the player, is the arena
  the right size, does the beam look right — has not been watched in a real client.

Treat the first run as a first run: press Play, look at it, and expect to nudge a number
in `Content.luau`. [`../docs/ROBLOX.md`](../docs/ROBLOX.md) has a troubleshooting table
for the failures that are likely, each with the knob that fixes it.

## Avatars, UGC and the player

The player is a **stock Roblox avatar** — R15, Roblox's own controls, Roblox's own
animations — so anyone can join with anything they own and nothing here has to know what
they look like. The game never touches the player's rig, only their `Humanoid` (health,
speed, jump) and their `HumanoidRootPart` (aim, hit detection).

That is the UGC-shaped choice, and it is deliberate: monsters are primitives you author,
players are avatars you don't. If you later want the *monsters* to be uploadable
Marketplace items or UGC accessories, [`../docs/ROBLOX.md`](../docs/ROBLOX.md) covers the
import route (`File → Import 3D`, `.fbx`/`.gltf`/`.obj`, rigging and animation support)
and the budgets Roblox enforces: 20,000 triangles per mesh, 4 bone influences per vertex,
1024×1024 textures, and the R15 body split that add up to 10,742 triangles.

## Licence

Same as the rest of the repo: **code MIT**, the CC0 example art pack **CC0**. The
generated `Rig.luau` and `clips/` are baked from `assets/models/anim-ual.glb` (Quaternius,
CC0) — see [`../CREDITS.md`](../CREDITS.md). Ultraman and related characters are
trademarks of Tsuburaya Productions; this is an unofficial fan project, so replace the
example names before you ship anything.
