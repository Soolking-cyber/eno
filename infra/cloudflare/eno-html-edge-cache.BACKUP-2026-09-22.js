// Verbatim copy of the deployed `eno-html-edge-cache` Worker as of 2026-09-20T11:04:18Z,
// taken before the stale-while-revalidate change on 2026-09-22. Restore target if that regresses.
const PASS = /^\/(_next|api|icons|assets|img)\//;
function langKeyInputs(request) {
  const cookie = request.headers.get("cookie") || "";
  const m = /(?:^|;\s*)lang=([A-Za-z-]{2,10})(?:;|$)/.exec(cookie);
  if (m) return "c=" + m[1].toLowerCase();
  return "a=" + (request.headers.get("accept-language") || "").toLowerCase().slice(0, 120);
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== "GET") return fetch(request);
    if (request.headers.get("rsc")) return fetch(request);
    if (PASS.test(url.pathname)) return fetch(request);
    const cookie = request.headers.get("cookie") || "";
    if (cookie.includes("-auth-token")) return fetch(request);
    const keyUrl = url.origin + url.pathname + (url.search ? url.search + "&" : "?") + "__k=" + encodeURIComponent(langKeyInputs(request));
    const key = new Request(keyUrl, { method: "GET" });
    const cache = caches.default;
    const hit = await cache.match(key);
    if (hit) { const r = new Response(hit.body, hit); r.headers.set("x-eno-cache", "HIT"); return r; }
    const res = await fetch(request);
    const ct = res.headers.get("content-type") || "";
    if (res.status !== 200 || !ct.includes("text/html")) return res;
    const store = new Response(res.body, res);
    store.headers.delete("cloudflare-cdn-cache-control");
    store.headers.delete("cdn-cache-control");
    store.headers.delete("set-cookie");
    store.headers.delete("vary");
    store.headers.set("cache-control", "public, max-age=300, s-maxage=300");
    store.headers.set("x-eno-cache", "MISS");
    let diag;
    try {
      await cache.put(key, store.clone());
      const back = await cache.match(key);
      diag = back ? "put-ok,readback-ok" : "put-ok,READBACK-MISSING";
    } catch (e) { diag = "put-threw:" + String(e && e.message).slice(0, 90); }
    store.headers.set("x-eno-diag", diag);
    return store;
  },
};
