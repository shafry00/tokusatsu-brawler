# The 2.5D billboards, and running with no art at all

The engine has two character renderers behind one interface. `js/models.js` gives you a
rigged skinned mesh; `js/sprites.js` gives you a camera-facing textured plane with hand
rolled squash-and-stretch. Both answer the same calls (`update`, `setState`, `oneShot`,
`setTint`, `hitFlash`, `pos`, `groundY`, `dead`), so nothing downstream cares which one
it got.

`Models.create()` returns `null` while a model is still loading, and the caller falls
back to a billboard. That is why a character never leaves a hole in the scene.

## The sprite contract

```
assets/sprites/<name>.png
```

One PNG per character name, listed in `LIST` at the top of `js/sprites.js`:

```js
"hero_ultraman", "ally_zero", "ally_mebius", "ally_seven", "ally_tiga",
"kaiju_bemular", "kaiju_redking", "kaiju_gomora", "kaiju_eleking",
"kaiju_zetton", "kaiju_birdon", "kaiju_golza", "kaiju_kingjoe",
"kaiju_baltan", "kaiju_jamila",
```

To use your own, either drop files with those names in, or change `LIST` and the names
that reference them (`tex:` in the ally roster, and the per-species sprite name used by
`Enemies`).

Rules the renderer assumes:

* **Transparent background.** `alphaTest: 0.22` — anti-aliased edges survive, but a
  background that is only *nearly* transparent will show a box.
* **Character fills the frame, feet at the bottom edge.** The plane is sized
  `height × (width / height)` from the texture, so a wide image makes a wide character.
  2:1 or narrower (taller than wide) is the useful range.
* **Centred horizontally**, standing on the bottom edge — the mesh is offset up by half
  its height so `y = 0` is the feet, matching the models.
* Rendered `DoubleSide` with a radial ground shadow, and an additive white copy of the
  same texture on top for hit flashes. So a light character on a light background will
  flash nicely; a dark one flashes from black to white and reads as a hit either way.

Textures are loaded with `LinearFilter` and no mipmaps — crisp at any distance, and cheap
at these sizes.

## No sprites at all is a supported configuration

Every PNG that fails to load is replaced at runtime by a **procedurally drawn
silhouette** (`S.placeholder`), generated from the character's name hash so each one gets
its own bulk, head size, arm swing and stance:

```js
S.has(name)        // false while the real PNG is missing
S.placeholder(name)// THREE.CanvasTexture, white, transparent
S.dataURL(name)    // the same drawing as a data URL, for <img> tags
```

`Actor` tints the silhouette with its own colour, so once the game tints a character it
reads as deliberate placeholder art rather than as a missing asset. This is why the
repository ships **no** `assets/sprites/` directory and still looks finished:

* the HUD portrait falls back to `Sprites.dataURL("hero_ultraman")`;
* the title art is simply not set (the star field and grid carry the screen);
* the 404s in the console are expected and listed as such in the load log.

If you want a portrait without drawing one, the cheapest good source is a screenshot of
your own model on a transparent background.

## Mixing the two

The fallback exists per character, not per game. A common shape for a project is: rigged
3D for the player and the boss, billboards for the crowd in the background. Cost of a
billboard is one plane, one material and a shadow — a few hundred of them is nothing.

## Where the tint comes from

`Actor.setTint(hex)` multiplies the texture. `Models` uses the same role colour table
(`HERO` in `js/models.js`) for both renderers, so a character keeps its colour whichever
one it happens to be using.
