/**
 * The real visitor IP for rate-limit keying and analytics.
 *
 * eno.vn sits behind Cloudflare → Vercel, so `x-forwarded-for`'s first hop is a
 * Cloudflare EDGE IP, not the client — keying limits on it buckets every visitor by
 * edge node (a single attacker hops edges to evade; busy edges false-trip real users).
 * Cloudflare always sets `cf-connecting-ip` to the true client IP for proxied traffic,
 * so prefer it, then fall back to the standard headers for any non-Cloudflare path.
 */
export function clientIp(reqOrHeaders: { headers: Headers } | Headers): string {
  const h = reqOrHeaders instanceof Headers ? reqOrHeaders : reqOrHeaders.headers
  const cf = h.get('cf-connecting-ip')
  if (cf) return cf.trim()
  const real = h.get('x-real-ip')
  if (real) return real.trim()
  const xff = h.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim() || 'anon'
  return 'anon'
}
