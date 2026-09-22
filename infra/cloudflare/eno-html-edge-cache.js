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
 * missing key itself, keying on the INPUTS `lang-variant.ts` reads — the `lang` cookie, else the
 * raw Accept-Language — rather than re-implementing the rule, so the two cannot drift.
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

/** Never cached: assets and APIs have their own headers, and RSC payloads are per-navigation. */
const PASS = /^\/(_next|api|icons|assets|img)\//;
/** Serve from cache without revalidating for this long (seconds). Matches the app's ISR window. */
const FRESH_TTL = 300;
/**
 * Keep an entry this long so there is something to serve stale from (seconds).
 * ⚠️ THIS IS THE WORST-CASE AGE OF ANYTHING THE EDGE CAN SERVE, so it is a risk budget, not a
 * performance dial. It was 86400 for one day and a reviewer was right that turning a 5-minute
 * worst case into a 24-hour one is a real change: a reader arriving after a deploy gets one stale
 * document referencing `/_next/static` chunks the new container no longer has, and that page will
 * not hydrate. `eno-deploy.sh` purges both zones with `purge_everything` (purge-by-URL cannot
 * match a `__k=` key), which is the actual mitigation; six hours is the backstop for when that
 * purge is skipped or fails. Raising it again means accepting a longer un-hydratable window.
 */
const SWR_TTL = 21600;

function langKeyInputs(request) {
  const cookie = request.headers.get("cookie") || "";
  const m = /(?:^|;\s*)lang=([A-Za-z-]{2,10})(?:;|$)/.exec(cookie);
  if (m) return "c=" + m[1].toLowerCase();
  return "a=" + (request.headers.get("accept-language") || "").toLowerCase().slice(0, 120);
}

/**
 * Headers for the background refresh.
 * ⛔ THE READER'S CONDITIONAL HEADERS MUST NOT GO WITH IT. Forwarding `request.headers` wholesale
 * carries `If-None-Match` / `If-Modified-Since`, the origin answers 304, the refresh stores
 * nothing because 304 is not 200 — and the entry stays stale until SWR_TTL runs out, refusing to
 * update however many people ask for it. Both reviewers caught this independently.
 * ⚠️ What the refresh DOES need is whatever `langKeyInputs` keys on, or it would fetch the wrong
 * language and store it under this key. Accept-Language and the cookie carry that, and the cookie
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

function cacheKeyFor(url, request) {
  const keyUrl =
    url.origin + url.pathname + (url.search ? url.search + "&" : "?") +
    "__k=" + encodeURIComponent(langKeyInputs(request));
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
  store.headers.set("cache-control", `public, s-maxage=${SWR_TTL}`);
  store.headers.set("x-eno-stored", String(now));
  return store;
}

/** What the reader gets: the app's own freshness window, never the SWR window. */
function forClient(body, init, state, storedAt) {
  const r = new Response(body, init);
  r.headers.set("cache-control", `public, max-age=${FRESH_TTL}, s-maxage=${FRESH_TTL}`);
  r.headers.set("x-eno-cache", state);
  if (storedAt) r.headers.set("x-eno-age", String(Math.round((Date.now() - storedAt) / 1000)));
  return r;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== "GET") return fetch(request);
    if (request.headers.get("rsc")) return fetch(request);
    if (PASS.test(url.pathname)) return fetch(request);
    /** ⚠️ Signed-in readers bypass entirely — a personalised document must never enter a shared key. */
    const cookie = request.headers.get("cookie") || "";
    if (cookie.includes("-auth-token")) return fetch(request);

    const key = cacheKeyFor(url, request);
    const cache = caches.default;
    const hit = await cache.match(key);

    if (hit) {
      const storedAt = Number(hit.headers.get("x-eno-stored") || 0);
      const ageSec = storedAt ? (Date.now() - storedAt) / 1000 : Infinity;
      if (ageSec <= FRESH_TTL) return forClient(hit.body, hit, "HIT", storedAt);

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
            const ct = fresh.headers.get("content-type") || "";
            if (fresh.status === 200 && ct.includes("text/html")) {
              await cache.put(key, toStored(fresh, Date.now()));
            } else if (fresh.status === 404 || fresh.status === 410 || (fresh.status >= 300 && fresh.status < 400)) {
              /**
               * ⛔ A GONE PAGE MUST LEAVE THE CACHE, NOT JUST FAIL TO UPDATE. Storing only 200s
               * looks safe and is the opposite: when a listing is moderated, deleted (404/410) or
               * its slug moves (308), the refresh simply does not overwrite, so the stale 200
               * keeps being served to every anonymous visitor for the rest of SWR_TTL. On this
               * site that is a trust and edition-boundary problem, not stale copy — a visa page
               * pulled from eno.vn would go on being served. `revalidatePublicPath()` cannot save
               * us either, because this key carries `__k=` and purge-by-URL never matches it;
               * only a zone-wide purge_everything would. So delete it here and let the next
               * reader take a normal MISS.
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
      return forClient(hit.body, hit, "STALE", storedAt);
    }

    const res = await fetch(request);
    const ct = res.headers.get("content-type") || "";
    if (res.status !== 200 || !ct.includes("text/html")) return res;

    const now = Date.now();
    const store = toStored(res, now);
    let diag;
    try {
      await cache.put(key, store.clone());
      /** Read straight back: separates "put silently refused" from "put fine, later read misses". */
      diag = (await cache.match(key)) ? "put-ok,readback-ok" : "put-ok,READBACK-MISSING";
    } catch (e) {
      diag = "put-threw:" + String(e && e.message).slice(0, 90);
    }
    const out = forClient(store.body, store, "MISS", now);
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
    out.headers.set("x-eno-diag", diag);
    return out;
  },
};
