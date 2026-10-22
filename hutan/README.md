# JAGA HUTAN — Operasi Hujan Buatan

A second, smaller game built on the same three.js r128 engine and GLB pack as the
repo's main brawler. Same rules: no build step, no npm, no CDN — serve the repo root
and open the page.

```bash
cd tokusatsu-brawler
python3 -m http.server 8777
open http://localhost:8777/hutan/
```

`file://` will not work: models are loaded with `fetch()`.

---

## The pitch

An oil-palm estate is on fire. **Sang Bakar** walks from palm to palm setting it alight,
and every hectare that burns calls in the **sawit crew** — the plantation outfit that
replants the ashes while you are busy elsewhere. You are Ranger 01, an **orangutan** in a
ranger hat, with a water hose, a sledgehammer, and three radio calls to a water-bombing
Chinook.

Three stages — Taman Nasional, Hutan Gambut, Hutan Hujan — each with its own palm count,
wind, fire spread rate, fog and boss health. Lose when the plantation eats the forest
(or when the whole forest is gone); win by putting Sang Bakar down for good.

## Controls

| Key | Action |
|---|---|
| `W A S D` | Move |
| Arrow keys | Turn the camera — `←` `→` yaw, `↑` `↓` pitch |
| Mouse | Look (pointer lock; click-drag also works) |
| `Shift` | Sprint |
| `Space` | Jump |
| `Q` | Roll (dodge, brief invulnerability) |
| `J` | Use the tool in hand (hold to keep spraying / swinging) |
| `F` | God mode — invincible, endless tank, endless heli |
| `1` / `2` / `Tab` | Hose / hammer / swap |
| `G` | Call the water-bombing helicopter |
| `Esc` | Pause |
| `M` | Mute |

The tool wheel on the right is clickable, as are its `1` / `2` key badges. Every action is
on the keyboard: the mouse only aims the camera and grabs pointer lock, and the arrow keys
orbit it without touching the mouse at all.

## On a phone

The menu and the whole HUD adapt to touch. On a coarse pointer (phone, tablet) the keyboard
stays out of the way and a thumb layout appears over the game:

| Touch | Action |
|---|---|
| Left stick | Walk — push past ~90 % of the ring to sprint |
| Drag anywhere on the view | Look (no pointer lock on touch) |
| **AKSI** (hold) | Spray the hose / swing the hammer |
| **ALAT** | Swap hose ↔ hammer (the button shows the tool in hand) |
| **LOMPAT** / **GULING** | Jump / roll |
| **HELI** | Call the water-bombing drop |
| **II** | Pause |

The tool wheel is hidden there (the ALAT button replaces it), the radar moves under the
forest meters, the field chips sit above the stick and the control hints read for touch.
Portrait shows a `MIRINGKAN PERANGKAT` nudge for the first few seconds — landscape is the
intended way to play.

On the title screen the menu is a full-bleed poster: the list runs down the left with a
brush-stroke highlight on the selected item, and TAHAP / KESULITAN / CARA MAIN slide a panel
in from the right. Under 820 px of portrait width that panel becomes a bottom sheet with a
close button, so the artwork stays visible behind the list.

**God mode** (`F`) is for checking the fire, the crew waves and the boss without dying: the
health bar is pinned, the tank never empties and the radio always has three calls left. The
amber `∞ MODE DEWA` chip under the water bar shows it is on; `F` again turns it off.

## How the fight reads

- **Hose** — a cone of water. Puts trees out, shoots fireballs down, and fills Sang Bakar's
  soak meter. Water is finite: refill in the pond (fast) or at a drum (slower), or slowly
  from the tank's trickle.
- **Hammer** — one hit clears a planted palm or a sawit worker. Against Sang Bakar it does
  almost nothing until he is **doused**, when it does 2.4× combo damage.
- **Soak → douse** — 100% soak, decaying at 7%/s once you stop spraying. Fill it and he is
  doused for 7 seconds: that is your damage window.
- **Fire spread** — burning trees ignite neighbours inside their spread radius, on a timer,
  capped per tick. Wind pushes smoke and embers, and the boss's rage phases speed it up.
- **Sawit crew** — waves arrive as the burnt fraction crosses thresholds. They plant palms
  that convert burnt ground into plantation; clear the palms with the hammer.
- **Heli** — 3 charges per stage (4 on Santai). A blue ring marks the drop; everything
  inside is soaked and burning trees are put out.

## Difficulty

Picked in the menu, stored in `localStorage`:

| | Player HP | Damage taken | Boss HP | Fire spread | Crew size | Heli |
|---|---|---|---|---|---|---|
| Santai | 150 | 0.55× | 0.72× | 0.70× | 0.65× | 4 |
| Normal | 120 | 0.82× | 0.90× | 0.90× | 0.85× | 3 |
| Nekat | 105 | 1.00× | 1.05× | 1.15× | 1.00× | 3 |

Normal is tuned to lean toward the player: the hose soaks faster than the boss dries,
the hammer combo outruns his swipe, and the fire spreads slowly enough to fight on one
front at a time.

## HUD

Deliberately sparse, Horizon-style rather than boxy:

- segmented health + water bar (top left), with the current objective under it
- canvas **compass** (top centre) with bearing markers for the post, the pond, the boss
  and the heli drop
- forest / plantation meters and the score (top right)
- **tool wheel** (right) with the selected tool's key number, ammo and heli charges
  (hidden on touch, where the ALAT button carries the tool name)
- field chips (bottom left): fires burning, sawit alive, tank %
- boss bar with a soak line (bottom centre), circular radar (bottom right)

## Files

| File | What it owns |
|---|---|
| `js/game.js` | scene, camera + canopy occlusion, stages, difficulty, waves, screens, menu wiring |
| `js/forest.js` | terrain, the oil-palm estate, fire spread, pond/drums, scorch decals, radar stats |
| `js/fire.js` | pooled particles: fire, smoke, water, steam, embers + 4-light pool |
| `js/player.js` | movement, hose cone, hammer combo, tank, props on the rig, respawn |
| `js/orang.js` | loads `orang-utan.glb`, scales/grounds it, plays its idle clip, layers the stride |
| `js/boss.js` | Sang Bakar state machine, soak/douse, fireballs, eye glow, body flames |
| `js/planters.js` | sawit waves, planting, attacks, worker props |
| `js/heli.js` | Chinook summon, drop marker, water column |
| `js/hud.js` | HUD updates, compass, radar, tool wheel, screens |
| `js/touch.js` | virtual stick, action buttons, drag-to-look, HUD hand-off on touch devices |
| `js/wowok.js` | loads the two wowok scans and fakes a rig with a vertex-shader arm fold plus a walk swing |
| `css/style.css` | poster menu, HUD, screens, touch controls, breakpoints |
| `img/menu-bg.jpg` | menu artwork (upscaled from the supplied reference) |
| `img/brush.svg` | the painted stroke behind the selected menu item |

## The orangutan rig

The player is a rigged orangutan scan (`assets/models/orang-utan.glb`) with one 10 s idle
clip and no walk, jump or attack. `orang.js` therefore plays the clip for breathing and
mass, then multiplies a procedural layer into the bone quaternions **after** the mixer has
written the pose each frame:

- thigh/knee/arm swings driven by speed, plus a forward lean, a bob and a side sway
- a hammer chop on the right arm while a swing is running, a squash on landing, a tuck
  while jumping, a forward roll on `Q`, and a fall-and-roll on death
- the clip speeds up with the stride so the body keeps moving while the legs work

The scan's joints are named `Head_14`, `Spine1_23`, `RightHand_9`, `LeftHand_19`; empty
children named `Head`, `spine_03`, `hand_r` and `hand_l` are added so the engine's prop code
finds them unchanged. The hat is parented to the head bone with its world rotation cancelled
(so it sits level) and the tank is bolted to the body at `0.71 × height`, behind the shoulders.

## The palm estate

Every tree is an oil palm: a bare ringed trunk (12–20 units) and a crown of twelve arching,
folded fronds. All twelve fronds are merged into **one** buffer geometry (`palmCrownGeometry`)
built once and scaled per tree, so a palm is two draw calls (trunk, crown) plus one fruit
bunch — lighter than the old three-to-five-blob broadleaf canopy. Each crown keeps its own
`MeshLambertMaterial` so it can char, glow and burn exactly like the old canopy did; burnt
palms keep 82 % of their pole instead of being cut to a stump.

## The wowok rig

The wowok scans (`assets/models/wowok.glb` for the crew, `wowok-boss.glb` for the boss)
are unrigged photogrammetry. Instead of a skeleton, `wowok.js` clones the mesh per actor
and patches its material with a small vertex shader:

- `uDroop` rotates each arm about its shoulder, which turns the scan's T-pose into arms
  hanging by the sides (the crew uses `1.0`, the boss `0.62` so it keeps a wide,
  arms-out silhouette).
- `uSwing` / `uSwingB` add an extra angle to the right and left arm for a chop; `atk2`
  (the planting swing) drives both, `atk1` keeps the off hand as follow-through.
- `uGait` swings the hanging arms fore and aft, the two sides in opposite phase: a slow
  breath at rest, a full stride at a run, so the crew never walks like a mannequin.
- `uBob`, `uLean` and a lunge term are driven per actor every frame, so each unit
  walks, breathes and dies independently on one shared geometry.

The scans are modelled facing **+Z** — the same axis `yaw` is measured from — so the mesh
needs no flip, and `yaw = atan2(dx, dz)` walks a unit exactly where it looks. Height, tint,
glow and facing are per actor. If the GLBs are missing, the game falls back to
`kaiju_birdon` and then to primitives — it never blocks on a download.

## Dev hooks

```js
JagaHutan.debug.forest.ignite(tree, power, instant)
JagaHutan.debug.spawnBoss()
JagaHutan.debug.planters.spawnWave(4)
JagaHutan.debug.nextStage()
JagaHutan.debug.heli.reset(3)
JagaHutan.debug.frame()          // render + step one frame by hand
```

`frame()` exists because a backgrounded tab stops `requestAnimationFrame`: a loop that
calls it for N ms advances the sim by N seconds, which is how the captures were taken.

`/hutan/?shot=hud|fire|boss` auto-starts a stage and frames a scene; used for capturing
screenshots and for eyeballing balance without playing to the boss.

## Credits

- Engine, HUD, effects and the CC0 model pack: this repo (see the root `CREDITS.md`).
- The two `wowok` scans were supplied by the project owner and are **not** part of the
  repo's CC0 pack. Check their licence before redistributing.
- The orangutan (`assets/models/orang-utan.glb`) was also supplied by the project owner and
  is **not** covered by the pack's CC0 licence. Check its terms before redistributing.
- `img/menu-bg.jpg` is the menu artwork supplied by the project owner; it is bundled locally
  so the menu works offline. Check its terms before redistributing.
