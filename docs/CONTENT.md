# Reskinning the example

The engine is content-agnostic; the *example* that ships here is a fan game about a
silver giant and nine monsters. Everything specific to it lives in a handful of tables,
and this is the list. Nothing else needs to change to turn it into your own game.

Roughly in order of how much it matters.

---

## 1. The model tables — `js/models.js`

The single most important table. It maps game roles to files.

```js
const KAIJU = {
  kaiju_jamila:  { file: "kaiju-frog",     family: "kaykit", tint: 0xffffff },
  kaiju_bemular: { file: "kaiju-mushroom", family: "kaykit", tint: 0xffffff },
  ...
};
```

The **key** (`kaiju_jamila`) is the role id used by `Enemies.SPECIES` and by the stage
configs. If you keep the keys and change only `file`, you can swap the entire cast
without touching anything else — which is exactly how the CC0 pack in this repo works.

Above it, the hero:

```js
const HERO = {
  player: { accent: 0xd6362c, eyes: 0xfff0a0, build: 1.00, body: 0xffffff },
  zero:   { accent: 0x2f7fd8, ... },
  ...
};
```

One entry per playable character: the player plus the four summonable allies. `accent`
and `eyes` tint an untextured mesh's plates and eye materials; `build` scales the
character very slightly so the five are not identical silhouettes.

Files: `hero.glb` (mesh) and `anim-ual.glb` (clips), both named in the loader near the
top of `models.js`. See [`../assets/README.md`](../assets/README.md) for the contract.

## 2. The enemy table — `js/enemies.js`

```js
const SPECIES = {
  kaiju_jamila: { h: 3.0, hp: 78, dmg: 1.0, speed: 6.2, radius: 1.5,
                  attacks: ["swipe"], score: 120, weight: 1 },
  ...
};
```

* `h` — spawn height in world units (the loader scales the model to it).
* `attacks` — which behaviours this species can use. Available: `swipe`, `swipeH`
  (wide), `charge`, `slam`, `dive`, `bolt`, `whip`, `volley`, `beam`.
* `fly`, `ranged`, `guard` — capability flags the AI and the boss phases read.
* `weight` — spawn weighting when a stage rolls a random mob.

The attack timings themselves live in the attack library in the same file, as
`{ wind, act, rec, range, dmg }`. The boss patterns (`BOSS_PATTERNS`) sequence those
attacks into phases.

## 3. The stages — `js/world.js`

`World.STAGES` is an array of nine configs. Each is one line of identity plus the
environment:

```js
{
  name: "TOKYO RAMPAGE", sub: "A kaiju makes landfall downtown.",
  sky: ["#1b3a6b", "#5b8fd0", "#bcd8f0"],  fog: ["#9fc2e0", 60, 260],
  ground: "asphalt", groundColor: 0xffffff,
  ambient: ["#8fb4e0", 0.75], sun: ["#ffe9c4", 1.05, [60, 90, 40]],
  biome: "city", mood: "day",
  mobs: ["kaiju_jamila"], boss: "kaiju_bemular", mobH: 3.0, bossH: 7.2,
}
```

`name`/`sub` are what the HUD and the stage toast show. `mobs` and `boss` are the role
ids from §1. Everything else is documented in [`LEVELS.md`](LEVELS.md).

Boss *display* names are a separate array, in `js/game.js`:

```js
// bossLabel(), around line 240
const names = ["BEMULAR", "RED KING", "BIRDON", ...];
```

Nine entries, in stage order.

## 4. The ally roster — `js/game.js`

Around line 927, the four summonable characters:

```js
const roster = [
  { tex: "ally_zero",  model: "zero",  name: "ULTRAMAN ZERO" },
  ...
];
```

`model` keys into `HERO` (§1), `tex` into `assets/sprites/` (optional, see
[`SPRITES.md`](SPRITES.md)), `name` is what the toast says.

## 5. Upgrades — `js/game.js`

Around line 578, the ten cards offered after each stage:

```js
const UPGRADES = [
  { id: "dmg",   name: "ULTRA POWER",  desc: "+15% attack damage" },
  ...
];
```

`id` is read by the stat code — keep the ids and you can rewrite every name and
description freely. Add a new one and you must also handle its `id` where the player's
stats are computed.

## 6. Prerendered text — `index.html`

Screens are markup, so the static strings are here:

| What | Where |
|---|---|
| Page title | `<title>` |
| HUD character name | `.hero-name` (line ~21) |
| Ultra timer label | `.uc-label` (line ~37) |
| Objective line | `#objective` (line ~46) |
| Boss bar default | `#bossName` (line ~65) |
| Action bar labels | `.act[data-k]` (lines ~78-83) |
| Title logo | `h1` with the two-tone span (line ~96) |
| Menu buttons, hints, disclaimer | lines ~100-145 |
| The controls screen | lines ~127-146 |

The action bar's key letters are inside `<b>` and are read by the CSS via
`.act[data-k="J"]`, so change the letter in *both* places if you rebind a key.

## 7. The palette — `css/style.css`

The whole skin is driven by custom properties at the top of the file:

```css
:root{
  --bg-0:#03060d;  --bg-1:#070f1c;
  --steel-0:#31465f; --steel-1:#1d2c41; --steel-2:#111d2e; --steel-3:#070d17;
  --cyan:#3fd0ff;  --blue:#2f6fe0;  --green:#39e07a;
  --amber:#ffc63d; --red:#ff3a4d;  --violet:#9a6cff;
  --text:#e2ecfa;  --muted:#7f95b5;
  --ch:16px;       /* chamfer size on panels */
  --ch-s:9px;      /* chamfer size on buttons */
}
```

Change `--cyan` and `--steel-*` and the entire console look re-themes. `--ch` controls
how aggressive the cut corners are; set it to `0px` for square panels.

## 8. Saved progress — `js/game.js`

```js
localStorage.getItem("ultraman_nine_trials")   // lines ~181 and ~186
```

Rename it. Old saves under the same key would otherwise leak between your game and this
one. The value is `{ best: { stageIndex: score }, unlocked }`.

## 9. Loading copy — `js/game.js`

`"ULTRA HERO 42%"` around line 155 — the only other hard-coded string that shows up
while the game boots.

## 10. The audio — `js/audio.js`

Fully synthesised, so there are no files to swap. If you want to change the character,
the instrument definitions are the oscillator setups inside `Audio2` — search for
`Audio2.sfx =` and the instrument table beside it. Every call site names a sound by
string (`Audio2.sfx("beam")`), so retuning a sound is one entry.

---

## Checklist

```
[ ] index.html          title, logo, disclaimer, controls copy, action labels
[ ] css/style.css       --cyan, --steel-*, --ch
[ ] js/models.js        HERO roles, KAIJU file table, FAMILIES patterns
[ ] js/enemies.js       SPECIES stats, attacks, boss patterns
[ ] js/world.js         STAGES names, biomes, mobs, bosses
[ ] js/game.js          bossLabel[], ally roster, UPGRADES, localStorage key
[ ] assets/models/      your models, following assets/README.md
[ ] README.md           it is your repo now
```

If you are building something that is not a fan project, do this **before** you publish
anything: the names in these tables and the trademark note in the footer are the only
parts of this repository that are not yours to ship.
