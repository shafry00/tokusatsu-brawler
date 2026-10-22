/* JAGA HUTAN — the only server-side code the game needs.
 *
 * The repository keeps the game in `hutan/` because it borrows the engine in
 * `../js/` and the model pack in `../assets/models/`. On karhutla.larutmalam.id
 * the game should open at the bare root, so `/` is answered with
 * `hutan/index.html` plus a `<base href="/hutan/">` tag. That base makes every
 * relative URL inside the page (css/, js/, ../js/, ../assets/) resolve exactly
 * as it does when the page is served from `/hutan/`, so nothing else has to be
 * rewritten. Everything else falls through to the static assets.
 */

const GAME_HTML = "/hutan/";
const BASE_TAG = '<base href="/hutan/">';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const wantsGame = url.pathname === "/" || url.pathname === "/index.html";

    if (!wantsGame) return env.ASSETS.fetch(request);

    // GET/HEAD only; a POST to the root is not a page view.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const res = await env.ASSETS.fetch(new Request(new URL(GAME_HTML, url), request));
    if (!res.ok) return res;

    let html = await res.text();
    if (!/<base\s/i.test(html)) {
      html = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${BASE_TAG}`)
        : BASE_TAG + html;
    }

    return new Response(request.method === "HEAD" ? null : html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // the entry point changes with every `?v=` bump — never let a proxy keep it
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      },
    });
  },
};
