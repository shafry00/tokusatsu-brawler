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

A forest is on fire. **Sang Bakar** walks from tree to tree setting it alight, and every
hectare that burns calls in the **sawit crew** — a plantation outfit that plants oil palms
on the ashes while you are busy elsewhere. You are Ranger 01, with a water hose, a
sledgehammer, and three radio calls to a water-bombing Chinook.

Three stages — Taman Nasional, Hutan Gambut, Hutan Hujan — each with its own tree count,
wind, fire spread rate, fog and boss health. Lose when the plantation eats the forest
(or when the whole forest is gone); win by putting Sang Bakar down for good.

## Controls

| Key | Action |
|---|---|
| `W A S D` | Move |
| Mouse | Look (pointer lock; click-drag also works) |
| `Shift` | Sprint |
| `Space` | Jump |
| `Q` | Roll (dodge, brief invulnerability) |
| Left click | Use the tool in hand |
| `1` / `2` / `Tab` | Hose / hammer / swap |
| `G` | Call the water-bombing helicopter |
| `Esc` | Pause |
| `M` | Mute |

The tool wheel on the right is clickable, as are its `1` / `2` key badges.

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
- field chips (bottom left): fires burning, sawit alive, tank %
- boss bar with a soak line (bottom centre), circular radar (bottom right)

## Files

| File | What it owns |
|---|---|
| `js/game.js` | scene, camera + canopy occlusion, stages, difficulty, waves, screens, menu wiring |
| `js/forest.js` | terrain, trees, fire spread, pond/drums, scorch decals, radar stats |
| `js/fire.js` | pooled particles: fire, smoke, water, steam, embers + 4-light pool |
| `js/player.js` | movement, hose cone, hammer combo, tank, props on the rig, respawn |
| `js/boss.js` | Sang Bakar state machine, soak/douse, fireballs, eye glow, body flames |
| `js/planters.js` | sawit waves, planting, attacks, worker props |
| `js/heli.js` | Chinook summon, drop marker, water column |
| `js/hud.js` | HUD updates, compass, radar, tool wheel, screens |
| `js/wowok.js` | loads the two wowok scans and fakes a rig with a vertex-shader arm droop |
| `css/style.css` | HUD, arc menu, screens |

## The wowok rig

The wowok scans (`assets/models/wowok.glb` for the crew, `wowok-boss.glb` for the boss)
are unrigged photogrammetry. Instead of a skeleton, `wowok.js` clones the mesh per actor
and patches its material with a small vertex shader:

- `uDroop` pulls vertices below the shoulders down toward the hips, which turns the scan's
  T-pose into arms hanging by the sides (the crew uses `1.0`, the boss `0.46` so he keeps
  a wide, arms-out silhouette).
- `uSwing`, `uBob`, `uLean` and a lunge term are driven per actor every frame, so each unit
  walks, breathes and dies independently on one shared geometry.

Height, tint, glow and facing are per actor. If the GLBs are missing, the game falls back
to `kaiju_birdon` and then to primitives — it never blocks on a download.

## Dev hooks

```js
JagaHutan.debug.forest.ignite(tree, power, instant)
JagaHutan.debug.spawnBoss()
JagaHutan.debug.planters.spawnWave(4)
JagaHutan.debug.nextStage()
JagaHutan.debug.heli.reset(3)
```

`/hutan/?shot=hud|fire|boss` auto-starts a stage and frames a scene; used for capturing
screenshots and for eyeballing balance without playing to the boss.

## Credits

- Engine, HUD, effects and the CC0 model pack: this repo (see the root `CREDITS.md`).
- The two `wowok` scans were supplied by the project owner and are **not** part of the
  repo's CC0 pack. Check their licence before redistributing.
