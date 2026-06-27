import 'server-only'
import { lookup } from 'node:dns/promises'
import net from 'node:net'

// SSRF defense for server-side fetches of user-supplied URLs. Rejects non-https,
// IP-literal private hosts, and hostnames that resolve to ANY private/loopback/
// link-local/reserved address (so a public hostname can't 302 or DNS-point at an
// internal target like cloud metadata 169.254.169.254 or 127.0.0.1).

function isBlockedIp(ip: string): boolean {
  const t = net.isIP(ip)
  if (t === 4) {
    const o = ip.split('.').map(Number)
    if (o.length !== 4 || o.some((n) => Number.isNaN(n))) return true
    const [a, b] = o
    if (a === 0 || a === 10 || a === 127) return true            // 0/8, 10/8, 127/8 loopback
    if (a === 169 && b === 254) return true                      // 169.254/16 link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true             // 172.16/12
    if (a === 192 && b === 168) return true                      // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true            // 100.64/10 CGNAT
    if (a >= 224) return true                                    // multicast / reserved
    return false
  }
  if (t === 6) {
    const l = ip.toLowerCase().replace(/^\[|\]$/g, '')
    if (l === '::1' || l === '::') return true
    if (l.startsWith('::ffff:')) return isBlockedIp(l.slice(7))   // IPv4-mapped IPv6
    if (l.startsWith('fe80') || l.startsWith('fc') || l.startsWith('fd')) return true // link-local + ULA
    if (l.startsWith('fec0') || l.startsWith('ff')) return true   // site-local (deprecated) + multicast
    return false
  }
  return true // unparseable → block
}

/** Throws if the URL is not safe to server-fetch. Returns the parsed URL otherwise. */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let u: URL
  try { u = new URL(raw) } catch { throw new Error('ssrf:bad_url') }
  if (u.protocol !== 'https:') throw new Error('ssrf:scheme')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host) && isBlockedIp(host)) throw new Error('ssrf:private_host')
  let addrs: { address: string }[]
  try { addrs = await lookup(host, { all: true }) } catch { throw new Error('ssrf:dns') }
  if (addrs.length === 0) throw new Error('ssrf:dns')
  for (const a of addrs) if (isBlockedIp(a.address)) throw new Error('ssrf:private_ip')
  return u
}

/** Fetch a user-supplied URL safely: re-validates the host at EVERY redirect hop
 *  (redirect:'manual') so a public URL can't bounce to an internal address. */
export async function safeFetch(raw: string, opts: { timeoutMs: number; maxHops?: number } = { timeoutMs: 8000 }): Promise<Response> {
  const maxHops = opts.maxHops ?? 3
  let url = raw
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertSafeUrl(url)
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs) })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error('ssrf:redirect_no_location')
      url = new URL(loc, url).toString()
      continue
    }
    return res
  }
  throw new Error('ssrf:too_many_redirects')
}

const PUSH_HOST_RX = [
  /(^|\.)googleapis\.com$/, // FCM (fcm/android.googleapis.com)
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)wns\.windows\.com$/,
  /(^|\.)push\.apple\.com$/,
]

/** A Web-Push endpoint must belong to a known push service (it's fetched server-side
 *  by web-push, so an arbitrary stored endpoint is an SSRF sink). */
export function isAllowedPushEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && PUSH_HOST_RX.some((re) => re.test(u.hostname))
  } catch {
    return false
  }
}
