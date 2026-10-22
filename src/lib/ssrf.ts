import 'server-only'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'
import { logError } from '@/lib/log'

// SSRF defense for server-side fetches of user-supplied URLs. Rejects non-https,
// IP-literal private hosts, and hostnames that resolve to ANY private/loopback/
// link-local/reserved address (so a public hostname can't 302 or DNS-point at an
// internal target like cloud metadata 169.254.169.254 or 127.0.0.1).

// Every IPv4 range that is not globally reachable (IANA special-purpose registry, RFC 6890 and successors).
const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8],        // "this network"
  ['10.0.0.0', 8],       // RFC1918
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local (cloud metadata)
  ['172.16.0.0', 12],    // RFC1918
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.88.99.0', 24],   // 6to4 relay anycast (deprecated)
  ['192.168.0.0', 16],   // RFC1918
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 3],      // 224/4 multicast + 240/4 reserved + broadcast
]

const BLOCKED = new net.BlockList()
for (const [addr, bits] of BLOCKED_V4) {
  BLOCKED.addSubnet(addr, bits, 'ipv4') // BlockList also matches IPv4-mapped ::ffff:a.b.c.d against these
  // The v6 transition prefixes EMBED an IPv4 that a gateway dials on our behalf (security review 2026-10-22, item 29):
  // block the same ranges inside them, so 64:ff9b::a9fe:a9fe (NAT64 of 169.254.169.254) is refused while a DNS64
  // answer for a public host still connects.
  const [a, b, c, d] = addr.split('.').map(Number)
  const hex = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  BLOCKED.addSubnet(`64:ff9b::${hex}`, 96 + bits, 'ipv6') // NAT64 well-known prefix (RFC 6052)
  BLOCKED.addSubnet(`2002:${hex}::`, 16 + bits, 'ipv6')   // 6to4 (RFC 3056)
}
for (const [addr, bits] of [
  ['::', 96],            // :: unspecified, ::1 loopback, deprecated IPv4-compatible ::a.b.c.d
  ['::ffff:0:0:0', 96],  // IPv4-translated (SIIT)
  ['64:ff9b:1::', 48],   // local-use NAT64 (RFC 8215)
  ['100::', 64],         // discard-only
  ['2001::', 32],        // Teredo (embeds an obfuscated IPv4)
  ['2001:2::', 48],      // benchmarking
  ['2001:db8::', 32],    // documentation
  ['3fff::', 20],        // documentation (RFC 9637)
  ['fc00::', 7],         // unique-local
  ['fe80::', 10],        // link-local, all of fe80–febf
  ['fec0::', 10],        // site-local (deprecated)
  ['ff00::', 8],         // multicast
] as const) BLOCKED.addSubnet(addr, bits, 'ipv6')

function isBlockedIp(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, '')
  const t = net.isIP(addr)
  if (t === 0) return true // unparseable → block
  return BLOCKED.check(addr, t === 4 ? 'ipv4' : 'ipv6')
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

/**
 * The DNS lookup the SOCKET uses (security review 2026-10-22, item 29). `assertSafeUrl` resolves a name, and the fetch
 * used to resolve it AGAIN to dial — two answers, and a name served with a zero TTL can give the check a public address
 * and the dial 127.0.0.1 or 169.254.169.254 (DNS rebinding). This runs inside `net.connect`, so the address it approves
 * is the one dialled. IP-literal hosts never reach it (net skips the lookup); `assertSafeUrl` refuses those first.
 */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }).then(
    (addrs) => {
      if (addrs.length === 0 || addrs.some((a) => isBlockedIp(a.address))) {
        callback(Object.assign(new Error('ssrf:private_ip'), { code: 'ESSRF' }), '')
      } else if (options.all) {
        callback(null, addrs)
      } else {
        callback(null, addrs[0].address, addrs[0].family)
      }
    },
    (err: NodeJS.ErrnoException) => callback(err, ''),
  )
}

const guardedAgent = new Agent({ connect: { lookup: guardedLookup } })

/** Fetch a user-supplied URL safely: re-validates the host at EVERY redirect hop
 *  (redirect:'manual') so a public URL can't bounce to an internal address, and checks
 *  the address the socket actually dials (guardedLookup) so a host that passed the check
 *  can't be rebound to an internal one before delivery (DNS-rebinding/TOCTOU).
 *  Accepts method/headers/body for signed POSTs. */
export async function safeFetch(
  raw: string,
  opts: { timeoutMs: number; maxHops?: number; method?: string; headers?: Record<string, string>; body?: string } = { timeoutMs: 8000 },
): Promise<Response> {
  const maxHops = opts.maxHops ?? 3
  let url = raw
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertSafeUrl(url)
    let res: Awaited<ReturnType<typeof undiciFetch>>
    try {
      res = await undiciFetch(url, {
        method: opts.method ?? 'GET',
        headers: opts.headers,
        body: opts.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(opts.timeoutMs),
        dispatcher: guardedAgent,
      })
    } catch (e) {
      // undici reports a refused dial as TypeError('fetch failed') carrying OUR error as its cause; surface ours.
      const cause = e instanceof Error ? e.cause : undefined
      throw cause instanceof Error && cause.message.startsWith('ssrf:') ? cause : e
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      // An unread undici body holds its socket; release this hop's before the next.
      await res.body?.cancel().catch((e) => logError(e, { op: 'ssrf.redirect.cancel' }))
      if (!loc) throw new Error('ssrf:redirect_no_location')
      url = new URL(loc, url).toString()
      continue
    }
    // Node's global fetch IS undici (its bundled copy): the same WHATWG Response, only the TS declarations differ.
    return res as unknown as Response
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
