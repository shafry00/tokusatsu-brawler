# Deploying it

It is a static site: HTML, CSS, JS and `.glb` files. There is no server component, no API
key and no build step. Anything that serves files over HTTP works.

Two things to get right, both boring and both fatal if missed:

1. **`Content-Type` for `.glb`.** Most hosts return `application/octet-stream` and
   `GLTFLoader` accepts that, because it reads the file as an `ArrayBuffer`. If your host
   insists on `text/plain` or gzips it, the loader will fail with a parse error.
2. **Cache-busting.** The JS files are plain `<script>` tags, so an aggressive cache will
   serve yesterday's code against today's `index.html`. `index.html` therefore versions
   them: `js/game.js?v=3`. **Bump the number after every edit.** (This is the single most
   common "my change did nothing" in this project.)

## Any static host

```bash
# 1. make a clean copy — the CC0 pack is all you need to ship
rsync -a --exclude '.DS_Store' --exclude 'tools/out' ./ dist/

# 2. serve it
python3 -m http.server 8777        # local
```

Then drag `dist/` into Netlify Drop, push it to GitHub Pages, or use anything else. Set
the cache headers for `assets/` to something long (a year) and for `index.html` to
`no-cache` — the assets never change under the same name, the entry point does.

## Cloudflare Pages

```bash
npm i -g wrangler
wrangler login

wrangler pages project create my-game --production-branch main
wrangler pages deploy dist --project-name=my-game --branch main
```

Ends up at `https://my-game.pages.dev`, with a per-deploy URL like
`https://a1b2c3d4.my-game.pages.dev` for the build you just pushed.

Non-interactively (CI, or a shell where wrangler cannot prompt) you **must** pass the
account explicitly, because an OAuth token can be authorised for several accounts and
wrangler will not guess:

```bash
CLOUDFLARE_ACCOUNT_ID=<your account id> \
  wrangler pages deploy dist --project-name=my-game --branch main
```

`wrangler whoami` lists the account IDs available to the current token; `wrangler pages
project list` shows which account a project already lives in. Run wrangler from **inside
the project directory** — from elsewhere it tries to create `/.wrangler/cache` and fails
with `Missing file or directory`.

### What not to ship

If your working tree carries anything you cannot redistribute, exclude it by path rather
than by remembering:

```bash
rsync -a --exclude '_orig' --exclude 'notes' --exclude 'tools/out' ./ dist/
```

`.gitignore` is not a deploy filter. Anything in the directory you point wrangler at gets
uploaded.

## The forest game: karhutla.larutmalam.id

`hutan/` is deployed separately from the brawler, at the root of its own domain, as a
**Worker with static assets** (not the `tokusatsu-brawler` Pages project). Its configs:

| File | Role |
|---|---|
| `wrangler.hutan.toml` | worker `karhutla-hutan`, `[assets] directory = ./dist-hutan`, `run_worker_first = true`, `[[routes]] karhutla.larutmalam.id` with `custom_domain = true` |
| `tools/build-hutan.sh` | builds `dist-hutan/` (game + the six engine files + the model pack; gitignored) |
| `tools/hutan-worker.js` | serves `/` from `hutan/` with an injected `<base href="/hutan/">` |

The base tag is why the game can open at the bare domain while its relative URLs
(`../js/three.min.js`, `../assets/models/…`) keep working — it is the same URL resolution
as serving from `/hutan/`, minus any file rewriting.

```bash
./tools/build-hutan.sh
CLOUDFLARE_ACCOUNT_ID=76e11d83a072dcd071384dede680a143 wrangler deploy -c wrangler.hutan.toml
```

Notes that cost time to rediscover:

- `compatibility_date` must be ≤ the newest date the local workerd supports; wrangler
  refuses to boot and names the ceiling in the error.
- Without `run_worker_first = true` the asset layer answers `/` with a `307` to `/hutan/`
  before the worker is ever invoked.
- `/hutan/index.html` also `307`s to `/hutan/` (Cloudflare's `auto-trailing-slash`), so the
  worker fetches `/hutan/`, not the file path.
- `.glb` ships as `model/gltf-binary`; `GLTFLoader` only needs the bytes, so that is fine.
  `index.html` is returned `no-cache` and the `?v=` query does the rest.

## Size notes

For reference, the whole game with the CC0 pack is ~12 MB:

| | |
|---|---|
| the CC0 character pack | ~9.5 MB |
| the hero's clip library (`anim-ual.glb`) | ~6.8 MB |
| the hero mesh, clips stripped | ~0.6 MB |
| code + CSS | ~0.5 MB (three.js is most of it) |

The character pack streams in while the title screen is up, so the time to play is
dominated by the hero and its clip library. If you need it faster: strip clips you do not
use with `tools/strip_animations.py --keep`, and downsample textures with gltf-transform.

## Hosting the models somewhere else

`Models` loads from `assets/models/` by a fixed prefix. To serve the models from a CDN,
change the base path at the top of `js/models.js` and add the CDN origin to your CORS
configuration — `GLTFLoader` uses `fetch`, so cross-origin needs `Access-Control-
Allow-Origin`. Same-origin, as shipped, needs no configuration at all.
