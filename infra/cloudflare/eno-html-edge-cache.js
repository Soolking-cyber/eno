/**
 * eno-html-edge-cache — per-LANGUAGE HTML cache at the edge, for both zones.
 *
 * ⛔ THIS FILE IS THE SOURCE OF TRUTH AND IT DID NOT USED TO EXIST. The Worker lived only in
 * Cloudflare, so nothing here could review it, diff it or restore it. The version deployed before
 * 2026-09-22 is kept verbatim beside this one as `.BACKUP-2026-09-22.js`.
 * Deploy with `deploy-worker.sh` beside this file; it is the only supported path and its header
 * carries the traps (a PUT drops unsent bindings; routes are zone-level and survive).
 * ⚠️ NO CREDENTIAL HERE CAN BOTH DEPLOY AND READ BACK, so "is the deployed copy this file?" is
 * currently UNANSWERABLE and the two can drift silently. Measured 2026-09-22:
 *   · the box's `/opt/eno/secrets/cf-token` is purge-scoped — a Workers PUT answers
 *     `No access to the specified resource.`, which reads like a wrong account id and is not;
 *   · the Cloudflare MCP credential CAN PUT but is refused on `GET .../scripts/<name>/content`
 *     with `10405 Method not allowed for this authentication scheme`.
 * ✅ THE FIX IS ONE TOKEN WITH Workers Scripts:Edit + Read, put in `$CF_TOKEN_FILE`; then
 * `deploy-worker.sh` works from the box and a sha diff against this file becomes a real check.
 *
 * ⛔ WHY IT EXISTS AT ALL: one public URL serves TWO server-rendered languages (`/` is ~39 KB br in
 * `en` and a different document in `vi`), and the Cloudflare cache cannot key on language. So the
 * app sets `Cloudflare-CDN-Cache-Control: no-store` (src/proxy.ts) and this Worker supplies the
 * missing key itself: the RESOLVED variant, `__k=en` or `__k=vi`.
 *
 * ⛔ IT USED TO KEY ON THE RAW INPUTS, AND THEY DRIFTED (audit #127). The claim was that keying on
 * "the `lang` cookie, else the raw Accept-Language" could not disagree with the origin. It could:
 * this file took the FIRST `lang=` and lowercased it without decoding, while Next's parser takes the
 * LAST duplicate, percent-decodes it and matches case-sensitively. `lang=EN` + `Accept-Language: vi`,
 * `lang=%76%69`, and `lang=en; lang=vi` were each keyed one language and rendered the other — so
 * one request could plant Vietnamese HTML under the key every returning English reader uses.
 * Now two independent guards:
 *   1. variantFor() below is the origin's rule — Next's cookie parsing (last wins, decodeURIComponent,
 *      case kept) + src/lib/lang-variant.ts — and src/lib/edge-worker.test.ts runs THIS file against
 *      Next's real parser and the app's real `langVariantFor` over a matrix, so a copy that drifts
 *      fails the build instead of the cache;
 *   2. nothing is stored unless the origin's own `Content-Language` (set by src/proxy.ts) equals the
 *      key's variant — so even a drift the matrix misses cannot PLANT the wrong language under a key.
 *      ⚠️ It guards storing, not serving: a reader whose headers the Worker misjudges still gets the
 *      copy for the variant it computed. Guard 1 is what keeps that from happening.
 *
 * ROUTES (zone-level, NOT part of this script — `deploy-worker.sh` leaves them alone).
 * ⛔ SINCE 2026-10-17 (speed plan item 10) THE CANONICAL HOSTS CARRY A CATCH-ALL — `eno.vn/*` and `www.eno.forum/*` —
 * plus NO-SCRIPT routes for `/_next/*`, `/api/*`, `/icons/*` and `/listings/*` on the same hosts (more specific, so they
 * win: those requests never invoke the Worker). Cloudflare matches a route against the WHOLE URL, query string
 * included, and only a pattern that ends in `*` can match a query (developers.cloudflare.com/workers/configuration/
 * routing/routes/) — so the home page's own route, `eno.vn/`, never saw `/?fbclid=…`, `/?utm_…`, `/?zarsrc=…`,
 * `/?category=…` or `/?q=…`: every one went to the origin (measured at cacheablePath below). With the catch-all this
 * Worker RECEIVES paths it must not touch, and cacheablePath() is what hands them back untouched.
 * The OTHER host of each zone gets no catch-all, because it is one hop from the canonical one: www.eno.vn has a Single
 * Redirect to the apex at the edge (every path, query kept — next.config.ts redirects() is the same rule at the
 * origin), and the forum apex 308s its pages to www at the origin (that rule keeps api/, _next/, .well-known/, feeds/,
 * listing-images/ and sw.js on the apex on purpose, so it is not copied into a zone rule).
 * The routes from before it — read from the API 2026-10-17, identical on both zones, apex AND www:
 *   /   /c/*   /privacy*   /safety*   /sellers/*   /terms*   (+ /vi and /vi/* on eno.vn, the pilot below)
 * stay in place (more specific than the catch-all, same script) and are exactly what cacheablePath() mirrors.
 * `/sellers/*` is force-dynamic at the origin (`private, no-store`), so it is passed through
 * uncached — see storable(); the others send `s-maxage` and cache.
 * ⚠️ THE `/vi` PILOT (SEO wave B, V4/V5) ADDS `/vi` AND `/vi/*` ON THE eno.vn ZONE ONLY, apex and www,
 * when it is switched on. ⛔ NEVER `/vi*`: that pattern also matches `/vietnam-evisa`. The forum zone
 * needs neither, because its `/vi` answers 404 (eno.forum never pilots).
 *
 * ⛔ STALE-WHILE-REVALIDATE IS THE POINT OF THE 2026-09-22 REVISION. Measured that day:
 *   eno.vn      HIT ×5, TTFB 0.18 s, age 115
 *   eno.forum   BYPASS then HIT, TTFB 2.39 s, age ALWAYS 0
 * The forum's age never accumulates because it has too little traffic to keep an entry warm: with a
 * flat 300 s TTL the entry expires between visitors, and the NEXT visitor — usually the Android app,
 * which loads www.eno.forum — pays a full trans-Pacific origin fetch. That is the 6 s average in the
 * app's network report, and no amount of tuning `s-maxage` fixes it, because the cost is paid by
 * whoever arrives first after expiry.
 *
 * The fix is to stop making that visitor wait: keep entries for SWR_TTL, treat them as fresh for
 * FRESH_TTL, and once past that serve the stale copy IMMEDIATELY while refreshing in the
 * background via `ctx.waitUntil`. A reader after expiry now gets ~0.2 s instead of ~2.4 s, and the
 * refresh lands before the next one arrives.
 * ⚠️ THIS NEEDS THE PAID WORKERS PLAN, which is why it could not ship earlier: `waitUntil` work
 * counts against CPU/duration, and the free tier's 100k req/day also capped how many routes this
 * could cover.
 *
 * ⚠️ TWO DIFFERENT cache-control VALUES, DELIBERATELY. What we STORE must outlive freshness or
 * there is nothing to serve stale (`s-maxage=SWR_TTL`); what we SEND must not let a browser hold a
 * stale document for a day (`max-age=FRESH_TTL`). Setting one header for both is the bug this
 * comment exists to prevent.
 *
 * ⚠️ FRESHNESS IS TRACKED BY OUR OWN STAMP, not by `Age`. The Workers Cache API does not surface a
 * reliable Age for `caches.default`, so the stored response carries `x-eno-stored` (epoch ms) and
 * freshness is computed from it. A missing stamp is treated as stale — fail toward a refresh.
 */

/**
 * ⛔ THE ONLY PATHS THIS WORKER MAY CACHE — ANY OTHER IS HANDED TO THE ORIGIN EXACTLY AS IT CAME (speed plan item 10).
 * Measured 2026-10-17, before the catch-all route (ROUTES above): `/?fbclid=…`, `/?utm_…` and `/?zarsrc=…` answered
 * BYPASS from the origin every time (300–700 ms to the first byte from Vietnam, against 100–150 ms for an edge HIT),
 * and the page-speed totals (rum_daily, 10-16/17) put at most ~15% of real home views on the edge — about half arrived
 * with a query string, a third signed in. The catch-all fixes the first half, and it also sends this Worker every
 * page it never used to see (/dashboard, /messages, /teachers/…), so this allowlist is the safety property: it is the
 * old route list, with each pattern's meaning — `/safety*` is any path that STARTS with `/safety` (`/safety-tips`
 * too), and the home page is `/` with ANY query, which is the point. ⛔ `/vi` exact or `/vi/…`, NEVER a `/vi` prefix:
 * that would take `/vietnam-evisa` (see the pilot note above). Assets, APIs and listing pages never get here at all
 * (no-script routes), and RSC payloads are per-navigation (passed through below).
 */
function cacheablePath(p) {
  return (
    p === "/" ||
    p.startsWith("/c/") ||
    p.startsWith("/privacy") ||
    p.startsWith("/safety") ||
    p.startsWith("/terms") ||
    p.startsWith("/sellers/") ||
    p === "/vi" ||
    p.startsWith("/vi/")
  );
}

/**
 * ⛔ CLICK IDS AND CAMPAIGN TAGS DESCRIBE THE VISIT, NOT THE DOCUMENT, SO THE KEY DROPS THEM (speed plan item 10).
 * Every Facebook click carries a fresh `fbclid`, every Zalo share `zarsrc`/`gidzl`, every campaign `utm_*` — and the
 * key held the whole query string, so each of those first visits was a MISS (measured 2026-10-17: `/c/rentals?fbclid=…`
 * MISS on every request). Nothing at the origin reads them for a page this Worker may store: that page is ISR, which
 * cannot read its query at all, and the readers are in the browser (src/lib/attribution.ts and src/lib/reco-signals.ts
 * read `location.search`). ONLY THE KEY changes: the request reaches the origin exactly as it came, and the reader's
 * address bar keeps every parameter. Exact names (any case) plus the `utm_` prefix; a name not on the list stays in the
 * key — an unknown parameter is assumed to change the page.
 */
const TRACKING_PARAMS = new Set([
  "fbclid", "fb_action_ids", "fb_action_types", "fb_source", "fb_ref", // Meta
  "gclid", "gbraid", "wbraid", "dclid", "srsltid", "_gl", "_ga", // Google: ads, Merchant listings, cross-domain linker
  "msclkid", "ttclid", "twclid", "li_fat_id", "rdt_cid", "yclid", // Microsoft, TikTok, X, LinkedIn, Reddit, Yandex
  "igshid", "igsh", // Instagram shares
  "zarsrc", "gidzl", // Zalo shares
  "mc_cid", "mc_eid", // Mailchimp
]);

/**
 * The query the KEY carries: the reader's, minus tracking, in the reader's order. Serialised through URLSearchParams
 * whenever there is a query, so `?q=a%20b` and `?q=a+b&fbclid=x` (the same parameters to Next, which parses the query
 * the same way) share one entry; the serialisation is one-to-one, so two queries the origin reads differently never do.
 */
function keySearch(url) {
  if (!url.search) return "";
  const params = new URLSearchParams(url.search);
  for (const name of [...new Set(params.keys())]) {
    const n = name.toLowerCase();
    if (n.startsWith("utm_") || TRACKING_PARAMS.has(n)) params.delete(name);
  }
  const s = params.toString();
  return s ? "?" + s : "";
}
/** Serve from cache without revalidating for this long (seconds). Matches the app's ISR window. */
const FRESH_TTL = 300;
/**
 * Keep an entry this long so there is something to serve stale from (seconds).
 * ⚠️ THIS IS THE WORST-CASE AGE OF ANYTHING THE EDGE CAN SERVE, so it is a risk budget, not a
 * performance dial. It was 86400 for one day and a reviewer was right that turning a 5-minute
 * worst case into a 24-hour one is a real change. A document that outlives a deploy references the
 * old build's `/_next/static` chunks; since 2026-10-16 nginx keeps every recent build's files on disk
 * (infra/vn-node/eno-static-sync.sh, ≥30 days), so such a page still hydrates — but it is still the
 * OLD page. `eno-deploy.sh` evicts every stored document at once by purging HTML_TAG (purge-by-URL
 * cannot match a `__k=` key; tag, host and everything purges do reach Cache API entries); six hours is
 * the backstop for when that purge is skipped or fails.
 */
const SWR_TTL = 21600;

/**
 * ⛔ EVERY STORED DOCUMENT CARRIES THIS Cache-Tag, AND THE DEPLOY PURGES IT (speed plan item 2,
 * 2026-10-16). It replaced purge_everything, which also evicted every content-hashed chunk, font and
 * image variant several times a day. Cloudflare strips an ORIGIN's Cache-Tag before a Worker sees the
 * response, so this file must set its own; `cache.put()` honours it. Stripped again before a reader
 * sees the response (forClient). Renaming it breaks the deploy's purge — grep eno-deploy.sh first.
 */
const HTML_TAG = "eno-html";

/** Mirror of src/lib/i18n/langs.ts LANGS — the drift test fails if they differ. */
const LANGS = ["en", "vi", "zh-Hans", "ko", "ja", "ru", "km", "ms", "th", "fr", "hi"];

/**
 * ⛔ THE `/vi` PILOT'S PLAIN PATHS, PINNED TO `en` (SEO wave B, V4; decision V-a). Mirror of
 * src/lib/lang-pinned.ts `VI_PREFIX_PATHS` — src/lib/edge-worker.test.ts fails if the two differ.
 * On a piloted path the ORIGIN renders English for everyone (its plain URL is always English, and
 * `/vi` + the path is the Vietnamese twin), so the key must be `en` whatever the visitor's cookie
 * or Accept-Language says. Keyed by variantFor() instead, a Vietnamese browser would key `vi`, the
 * origin would answer `content-language: en`, storable() would refuse it, and every Vietnamese
 * visitor to `/` would pay an uncached origin fetch — correct, only slow. Filled by V5 (switch-on).
 * ⚠️ eno.vn ONLY: the forum never pilots, and a storefront host (`apple.eno.vn`) is not routed here.
 */
const PINNED_EN_PATHS = ["/", "/c/furniture-appliances"];
const PINNED_HOSTS = ["eno.vn", "www.eno.vn"];

/** Next's cookie parser, byte for byte (next/dist/compiled/@edge-runtime/cookies parseCookie):
 *  split on `; *`, decodeURIComponent each value, the LAST duplicate wins, case is kept. */
function cookieValue(header, name) {
  let found = null;
  for (const pair of (header || "").split(/; */)) {
    if (!pair) continue;
    const at = pair.indexOf("=");
    if (at === -1) { if (pair === name) found = "true"; continue; }
    if (pair.slice(0, at) !== name) continue;
    try { found = decodeURIComponent(pair.slice(at + 1)); } catch { /* Next skips undecodable pairs */ }
  }
  return found;
}

/** src/lib/lang-variant.ts matchSupportedLanguage / acceptLanguageOrder / langVariantFor, verbatim. */
function matchSupported(raw) {
  const lc = raw.trim().toLowerCase();
  if (!lc) return null;
  if (lc.startsWith("zh")) return "zh-Hans";
  const primary = lc.split("-")[0];
  return LANGS.includes(primary) ? primary : null;
}
function acceptOrder(header) {
  if (!header) return [];
  return header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const qv = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(qv) ? qv : 0, i };
    })
    .filter((x) => x.tag && x.tag !== "*" && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag);
}
function variantFor(request) {
  const cookie = cookieValue(request.headers.get("cookie"), "lang");
  if (cookie && LANGS.includes(cookie)) return cookie === "vi" ? "vi" : "en";
  for (const tag of acceptOrder(request.headers.get("accept-language"))) {
    const hit = matchSupported(tag);
    if (hit) return hit === "vi" ? "vi" : "en";
  }
  return "en";
}

/**
 * The variant the ORIGIN renders for this request: `/vi…` is Vietnamese for everyone (a `/vi` path
 * the pilot does not serve 404s at the origin and is never stored), a piloted plain path on eno.vn is
 * English for everyone, and every other path negotiates (src/lib/lang-pinned.ts pinnedRoute).
 */
function variantOf(url, request) {
  if (/^\/vi(\/|$)/.test(url.pathname)) return "vi";
  // A fully-qualified `eno.vn.` is the same site (review): without the strip its pinned path would key
  // by the visitor, the origin would answer `en`, and storable() would refuse every such response.
  if (PINNED_HOSTS.includes(url.hostname.replace(/\.$/, "")) && PINNED_EN_PATHS.includes(url.pathname)) return "en";
  return variantFor(request);
}

/**
 * Does the ORIGIN allow a shared cache to hold this document? If not, a copy we already hold is wrong
 * too — the refresh evicts it.
 *   · 200 text/html — nothing else is a document;
 *   · the origin OPTS IN: `s-maxage` > 0, and no `private` / `no-store` / `no-cache`. A force-dynamic
 *     page (/sellers/*: profile edits, the enforcement caution line) was being stored anyway and
 *     served for up to SWR_TTL, out of reach of revalidatePublicPath (audit #402). Every other routed
 *     page sends `s-maxage` (measured on both zones, 2026-09-23), so requiring it costs nothing and
 *     means a page can only enter the edge cache because the origin said so.
 */
function originShareable(res) {
  const ct = res.headers.get("content-type") || "";
  const cc = res.headers.get("cache-control") || "";
  return (
    res.status === 200 &&
    ct.includes("text/html") &&
    /\bs-maxage=[1-9]/i.test(cc) &&
    !/\b(private|no-store|no-cache)\b/i.test(cc)
  );
}

/**
 * …and may THIS response be the copy stored under `variant`? Two more conditions, and neither is a
 * reason to EVICT — both describe the request, not the document, and evicting on them would hand any
 * visitor a lever to empty the entry for everyone:
 *   · `Content-Language` equals the key's variant — guard 2 above. A mismatch means this visitor's
 *     headers resolve differently here than at the origin; the copy we hold was checked against its
 *     key when it was stored, so it stays. src/proxy.test.ts pins that the origin sends exactly
 *     `en` / `vi`; the live origin was measured doing exactly that on every route, both zones.
 *   · no `Set-Cookie` — a response that sets a cookie was rendered for ONE visitor (a sign-in
 *     landing, say): stripping the header on store kept the cookie out of the shared entry but not
 *     whatever the document said about that visitor. No routed page sets one today (24 origin
 *     responses, both zones, both variants, 2026-09-23; src/proxy.test.ts pins the proxy side).
 */
function storable(res, variant) {
  return (
    originShareable(res) &&
    (res.headers.get("content-language") || "").toLowerCase() === variant &&
    !res.headers.has("set-cookie")
  );
}

/**
 * Headers for the background refresh.
 * ⛔ THE READER'S CONDITIONAL HEADERS MUST NOT GO WITH IT. Forwarding `request.headers` wholesale
 * carries `If-None-Match` / `If-Modified-Since`, the origin answers 304, the refresh stores
 * nothing because 304 is not 200 — and the entry stays stale until SWR_TTL runs out, refusing to
 * update however many people ask for it. Both reviewers caught this independently.
 * ⚠️ What the refresh DOES need is whatever `variantFor` reads, or it would fetch the wrong
 * language — and storable() would then refuse it, so the entry would just go on ageing. Accept-Language and the cookie carry that, and the cookie
 * is safe here because a signed-in reader never reaches this code (see the -auth-token bypass).
 */
function refreshHeaders(request) {
  const h = new Headers(request.headers);
  h.delete("if-none-match");
  h.delete("if-modified-since");
  h.delete("range");
  h.delete("authorization");
  return h;
}

function cacheKeyFor(url, variant) {
  const search = keySearch(url);
  const keyUrl = url.origin + url.pathname + (search ? search + "&" : "?") + "__k=" + variant;
  return new Request(keyUrl, { method: "GET" });
}

/**
 * Normalise an origin response into the thing we store.
 * ⚠️ `vary` is DELETED, and that is load-bearing: `cache.put()` returns OK while every later read
 * misses if the stored response carries `Vary: Accept-Encoding` — three hours went into finding
 * that once. The language key is already in the cache key, so Vary has no job here.
 */
function toStored(res, now) {
  const store = new Response(res.body, res);
  store.headers.delete("cloudflare-cdn-cache-control");
  store.headers.delete("cdn-cache-control");
  store.headers.delete("set-cookie");
  store.headers.delete("vary");
  // Speed plan item 5: the origin's Server-Timing describes the request that FILLED this entry — a HIT must never
  // replay it (timingFor below writes the reader's own).
  store.headers.delete("server-timing");
  store.headers.set("cache-control", `public, s-maxage=${SWR_TTL}`);
  store.headers.set("cache-tag", HTML_TAG);
  store.headers.set("x-eno-stored", String(now));
  return store;
}

/** What the reader gets: the app's own freshness window, never the SWR window. */
function forClient(body, init, state, storedAt, timing) {
  const r = new Response(body, init);
  r.headers.delete("cache-tag");   // ours, for the deploy's purge — not the reader's business
  r.headers.set("cache-control", `public, max-age=${FRESH_TTL}, s-maxage=${FRESH_TTL}`);
  r.headers.set("x-eno-cache", state);
  if (storedAt) r.headers.set("x-eno-age", String(Math.round((Date.now() - storedAt) / 1000)));
  if (timing) r.headers.set("server-timing", timing);
  return r;
}

/**
 * SERVER-TIMING FOR THE PAGE-SPEED TOTALS (speed plan item 5, 2026-10-16) — read in the visitor's browser by
 * src/lib/rum/early.ts, which turns it into anonymous bucket totals (nothing per visitor is kept).
 *   edge;desc="HKG"      the data centre (unless the origin's nginx already named it, from CF-Ray)
 *   ecache;desc="HIT"    what answered: HIT · STALE · MISS (fetched, stored) · DYN (fetched, not storable) · PASS
 *                        (a signed-in reader, never cached)
 *   origin;dur=123       ONLY when THIS request waited for the origin: the Worker's wall time around fetch() — edge →
 *                        box → first byte. (Workers' Date.now() advances across I/O, which is exactly what is timed.)
 * …plus, on those same waits, the origin's own entries (nginx: `edge`, `app;dur` = the app's time at the box, `ncache`).
 * Nothing new is disclosed: x-eno-cache, x-nextjs-cache and cf-ray (with its colo) are already on every response.
 */
function timingFor(request, state, upstream, originMs) {
  const parts = [];
  const up = upstream ? upstream.headers.get("server-timing") || "" : "";
  if (up) parts.push(up);
  const colo = request.cf && typeof request.cf.colo === "string" ? request.cf.colo : "";
  if (/^[A-Z]{3}$/.test(colo) && !/(^|,)\s*edge\s*(;|,|$)/.test(up)) parts.push(`edge;desc="${colo}"`);
  parts.push(`ecache;desc="${state}"`);
  if (typeof originMs === "number") parts.push(`origin;dur=${Math.max(0, Math.round(originMs))}`);
  return parts.join(", ");
}

/**
 * ⛔ A fetch() RESPONSE'S HEADERS ARE IMMUTABLE IN WORKERS — setting one on it throws, and the visitor gets a Worker
 * error page instead of the document. So copy first (the body streams through untouched); if even the copy fails,
 * the untimed original beats an error.
 */
function withTiming(res, timing) {
  try {
    const out = new Response(res.body, res);
    out.headers.set("server-timing", timing);
    return out;
  } catch {
    return res;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!cacheablePath(url.pathname)) return fetch(request);
    if (request.method !== "GET") return fetch(request);
    if (request.headers.get("rsc")) return fetch(request);
    /**
     * ⛔ FAIL OPEN, BUT ONLY FOR THE READS THIS WORKER CACHES (speed plan item 10). An exception in the cache logic
     * below hands the request to the origin instead of a Cloudflare error page. ⚠️ Not set before the returns above:
     * passing through RE-SENDS the request, and the catch-all routes server-action POSTs and every other write through
     * here — a pass-through fetch that throws after the origin acted would repeat the write (gate review). A GET
     * replayed costs one more render; the early returns hold no logic that could throw.
     */
    if (typeof ctx.passThroughOnException === "function") ctx.passThroughOnException();
    /** ⚠️ Signed-in readers bypass entirely — a personalised document must never enter a shared key. */
    const cookie = request.headers.get("cookie") || "";
    if (cookie.includes("-auth-token")) {
      const t0 = Date.now();
      const passed = await fetch(request);
      return withTiming(passed, timingFor(request, "PASS", passed, Date.now() - t0));
    }
    /**
     * ⛔ AN AGENT ASKING FOR MARKDOWN MUST REACH THE ORIGIN (audit #88). `/`, `/terms` and `/privacy`
     * negotiate on Accept (next.config.ts rewrites them to /md/*), and the key does not carry Accept,
     * so a HIT answered text/markdown requests with the stored HTML — the zone Cache Rule's markdown
     * exclusion never ran, because this Worker answers first. Case-insensitive, unlike that rule; at
     * worst an Accept that merely MENTIONS markdown loses edge caching, which is harmless.
     */
    if (/markdown/i.test(request.headers.get("accept") || "")) return fetch(request);

    const variant = variantOf(url, request);
    const key = cacheKeyFor(url, variant);
    const cache = caches.default;
    const hit = await cache.match(key);

    if (hit) {
      const storedAt = Number(hit.headers.get("x-eno-stored") || 0);
      const ageSec = storedAt ? (Date.now() - storedAt) / 1000 : Infinity;
      if (ageSec <= FRESH_TTL) return forClient(hit.body, hit, "HIT", storedAt, timingFor(request, "HIT", null, null));

      /**
       * ⛔ STALE, SO ANSWER NOW AND REFRESH BEHIND THE READER. Returning before the origin fetch
       * is the entire win; awaiting it here would reproduce exactly the 2.4 s this replaces.
       * ⚠️ The refresh must not reuse `request` after we have returned — build a fresh one.
       */
      ctx.waitUntil(
        (async () => {
          try {
            const fresh = await fetch(new Request(url.toString(), {
              method: "GET",
              headers: refreshHeaders(request),
              redirect: "manual",
            }));
            if (storable(fresh, variant)) {
              await cache.put(key, toStored(fresh, Date.now()));
            } else if (
              fresh.status === 404 || fresh.status === 410 ||
              // 304 is "unchanged", not "moved" — never a reason to drop the copy we hold.
              (fresh.status >= 300 && fresh.status < 400 && fresh.status !== 304) ||
              /**
               * A 200 the origin no longer lets a shared cache hold (the page went force-dynamic)
               * must leave the cache too: keeping the old copy would go on serving what
               * originShareable() just refused. A 200 refused only for its language or its
               * Set-Cookie keeps the copy (see storable()).
               */
              (fresh.status === 200 && !originShareable(fresh))
            ) {
              /**
               * ⛔ A GONE PAGE MUST LEAVE THE CACHE, NOT JUST FAIL TO UPDATE. Storing only 200s
               * looks safe and is the opposite: when a listing is moderated, deleted (404/410) or
               * its slug moves (308), the refresh simply does not overwrite, so the stale 200
               * keeps being served to every anonymous visitor for the rest of SWR_TTL. On this
               * site that is a trust and edition-boundary problem, not stale copy — a visa page
               * pulled from eno.vn would go on being served. `revalidatePublicPath()` cannot save
               * us either, because this key carries `__k=` and purge-by-URL never matches it;
               * only a purge of HTML_TAG (every document, every data centre) would. So delete it
               * here and let the next reader take a normal MISS.
               * ⚠️ ONLY "GONE OR MOVED" EVICTS — 404, 410 and 3xx. 5xx must not empty the cache,
               * because an origin blip is exactly when serving stale matters most; and the other
               * 4xx are excluded for the same reason, since a 403 from a WAF challenge or a 429
               * says something about THIS request, not about the document.
               */
              await cache.delete(key);
            }
          } catch {
            /* A failed refresh leaves the stale entry in place — strictly better than evicting it. */
          }
        })(),
      );
      return forClient(hit.body, hit, "STALE", storedAt, timingFor(request, "STALE", null, null));
    }

    const t0 = Date.now();
    const res = await fetch(request);
    const originMs = Date.now() - t0;
    if (!storable(res, variant)) return withTiming(res, timingFor(request, "DYN", res, originMs));

    const now = Date.now();
    const store = toStored(res, now);
    /**
     * ⛔ THE READER DOES NOT WAIT FOR THE STORE (speed plan item 10, 2026-10-17). `await cache.put()` drained the WHOLE
     * body into the cache before the first byte went out, and a read-back after it (`x-eno-diag`, the 2026-09-20 Vary
     * trap's probe — see toStored) cost one more cache round trip: measured, a MISS reached the reader 30–140 ms after
     * the origin's own first byte. Now the store runs behind the reader and the body streams to both; a failed put
     * costs what a skipped one does — the next reader MISSes again. ⚠️ So a put that ALWAYS fails would look like a
     * cold cache: the signal is x-eno-cache / the page-speed `ecache` totals never reaching HIT, and this warning in
     * the Worker's logs (`wrangler tail eno-html-edge-cache`).
     */
    ctx.waitUntil(cache.put(key, store.clone()).catch((e) => console.warn("eno-html-edge-cache: cache.put failed:", String(e && e.message).slice(0, 120))));
    const out = forClient(store.body, store, "MISS", now, timingFor(request, "MISS", res, originMs));
    /**
     * ⛔ THE READER STILL GETS THEIR Set-Cookie. `toStored` strips it so a per-visitor cookie can
     * never be written into a SHARED entry and handed to the next person — that part is not
     * negotiable. But `out` is built from the stored copy, so without this the MISS visitor (only
     * ever the first one) silently loses a cookie the origin meant for them, while every later
     * HIT is unaffected — a bug that would surface as "it works for everyone except the first
     * person, sometimes". Measured 2026-09-22: eno HTML sets no cookie today, so this is a trap
     * being closed rather than a break being fixed. A reviewer raised it; it is worth the three
     * lines precisely because nothing would fail loudly the day it starts mattering.
     */
    /** ⚠️ `getSetCookie()`, NOT header iteration — iterating JOINS multiple Set-Cookie values into
     *  one comma-separated string, which is not a valid cookie and silently corrupts all but the
     *  simplest case. This is the one header the Headers iterator cannot represent. */
    const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const c of setCookies) out.headers.append("set-cookie", c);
    return out;
  },
};
