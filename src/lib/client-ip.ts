/**
 * The real visitor IP for rate-limit keying and analytics.
 *
 * eno.vn and eno.forum sit behind Cloudflare, which terminates TLS and forwards to nginx on the
 * VN box. `x-forwarded-for`'s first hop is therefore a Cloudflare EDGE IP, not the client — keying
 * limits on it buckets every visitor by edge node (one attacker hops edges to evade; a busy edge
 * false-trips real users). Cloudflare sets `cf-connecting-ip` to the true client IP, so prefer it.
 *
 * ⛔ BUT A HEADER IS ONLY AS TRUSTWORTHY AS THE PROOF IT CAME FROM OUR EDGE, AND IT USED TO BE
 * TAKEN ON FAITH. Anyone who reaches the origin directly can send `cf-connecting-ip: <anything>`
 * and mint a FRESH rate-limit bucket per request — every IP-keyed limit in the app (OTP sends,
 * contact reveals, publish attempts, the paid AI/translate/geocode routes) becomes decorative.
 * Flagged in a security audit as a landmine, and the two things standing in front of it were both
 * infrastructure: the origin is firewalled to Cloudflare, and `proxy.ts` pins `/api/*` to a secret
 * header. Measured 2026-08-28 — the origin is unreachable off-Cloudflare (connect times out on 80
 * and 443) and EDGE_SECRET is present in both editions' env — so the hole is not open today. It
 * was one iptables lapse from being open, and this repo has HAD that exact lapse before
 * (docs claimed ufw was installed; it was not).
 *
 * ⛔ SO THE TRUST IS NOW DERIVED, NOT ASSUMED. When `EDGE_SECRET` is set, a client IP is believed
 * only if the request carries the matching `x-eno-edge` header that Cloudflare's Transform Rule
 * injects — the same proof `proxy.ts` already gates `/api/*` on, checked here so it also covers
 * pages, server actions and the lib call sites that run outside that middleware's matcher.
 * Anything without the proof shares ONE bucket, so bypassing the edge stops being a way to get
 * unlimited attempts and starts being the most rate-limited path into the app.
 * ⚠️ `off-edge` IS A SENTINEL, NOT AN ADDRESS, and this helper also feeds analytics and the
 * compliance audit trail. In production nothing should ever record it — every request to either
 * zone carries the header — so seeing it in stored data is the signal that something reached the
 * app without going through Cloudflare, which is worth investigating rather than ignoring.
 *
 * ⛔ THIS DEPENDS ON THE TRANSFORM RULE BEING HOST-SCOPED, AND IT IS — CHECKED, NOT ASSUMED.
 * Queried via the Cloudflare API on 2026-08-28: both zones inject `x-eno-edge` on
 * `http.host in {...}` with NO URI condition, so EVERY request to eno.vn and eno.forum carries it —
 * pages, server actions, `/md/*`, the partner API and `/api/mcp` alike, not just the `/api/*` that
 * proxy.ts pins. That is what makes a single verifying helper correct everywhere; an earlier
 * version of this change added a second `clientIpOffEdge` for the routes proxy.ts exempts from the
 * pin, on the assumption they arrive without the header. They do not: Cloudflare adds it for them,
 * and the origin is firewalled to Cloudflare so they cannot arrive any other way. The extra helper
 * was deleted rather than kept as a harmless spare, because a spare that quietly opts a route out
 * of a security control is not harmless.
 * ⛔ IF THAT RULE IS EVER NARROWED TO A PATH, every page-level caller starts landing in the shared
 * bucket — a quiet, site-wide rate-limit outage rather than a loud one. proxy.ts already 403s
 * `/api/*` without the header, so the coupling exists either way; this widens it to pages. Re-check
 * the rule's expression before changing its scope.
 *
 * ⚠️ WHEN `EDGE_SECRET` IS UNSET THE OLD BEHAVIOUR IS KEPT, DELIBERATELY. The alternative — no
 * secret, so nothing is ever verified — would put every visitor in that single bucket and
 * rate-limit the whole site into the ground. Failing closed on a *missing config* would be a
 * self-inflicted outage, which is a worse failure than the one being prevented. The consequence is
 * that this protection is only as live as the secret — keep EDGE_SECRET set on BOTH editions.
 */

/** One shared key for every request that could not prove it came through our edge. */
const OFF_EDGE_BUCKET = 'off-edge'

const headersOf = (r: { headers: Headers } | Headers): Headers => (r instanceof Headers ? r : r.headers)

/**
 * ⚠️ NOT `timingSafeEqual`. This compares a secret, so the instinct is right — but the comparison
 * runs in the Node runtime on a value the caller already had to guess in full, and a timing oracle
 * here would leak at most whether a guess shares a prefix with EDGE_SECRET, over a network path
 * that is orders of magnitude noisier than the difference. `proxy.ts` compares the same header the
 * same way. Worth revisiting together, not diverging here.
 */
function cameThroughEdge(h: Headers): boolean {
  const secret = process.env.EDGE_SECRET
  if (!secret) return true   // see the note above: unverifiable, and a shared bucket would be worse
  return h.get('x-eno-edge') === secret
}

function readForwardedIp(h: Headers): string {
  const cf = h.get('cf-connecting-ip')
  if (cf) return cf.trim()
  const real = h.get('x-real-ip')
  if (real) return real.trim()
  const xff = h.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim() || 'anon'
  return 'anon'
}

export function clientIp(reqOrHeaders: { headers: Headers } | Headers): string {
  const h = headersOf(reqOrHeaders)
  return cameThroughEdge(h) ? readForwardedIp(h) : OFF_EDGE_BUCKET
}
