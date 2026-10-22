// Keys for IP-scoped rate limits. Pure string transforms of an address ALREADY obtained through clientIp() —
// deliberately NOT in client-ip.ts, which pins "exactly one way to get a client IP" (its test enumerates the exports).
/**
 * The first four hextets of an IPv6 address, '::' expanded — `2405:4803:c7fd:1::9` → `2405:4803:c7fd:1`.
 * (Moved from teachers/dm-quota.ts so a public rate limit can use it without importing the database layer;
 * dm-quota re-exports it.)
 */
export function ipv6Prefix64(a: string): string {
  const addr = a.replace(/^\[|\]$/g, '').split('%')[0]
  const [head, tail = ''] = addr.split('::')
  const h = head ? head.split(':') : []
  const t = addr.includes('::') ? (tail ? tail.split(':') : []) : []
  const full = addr.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '') || '0').join(':')
}

/**
 * The key an IP-scoped rate limit should use: an IPv4 address as is, an IPv6 address by its /64 (security review
 * 2026-10-22, item 14). One subscriber is routinely handed a whole /64, so keying on the full IPv6 address gave a
 * caller ~2⁶⁴ fresh buckets — rotating addresses inside their own prefix sidestepped every IP-keyed limit.
 */
export function rateKeyForIp(ip: string): string {
  return ip.includes(':') ? `v6:${ipv6Prefix64(ip)}` : ip
}
