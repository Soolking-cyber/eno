import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE SSRF DENYLIST — hand-encoded CIDR rules that had no test at all until 2026-08-05.
 *
 * ⚠️ WHY THIS IS WORTH TESTING RATHER THAN TRUSTING. `src/lib/ssrf.ts` sits behind every
 * server-side fetch of a URL a user supplied: partner webhook delivery (`lib/webhooks.ts`) and
 * Web-Push endpoints. Its whole job is arithmetic on address ranges written out by hand — the kind
 * of code that is either exactly right or silently wrong, where "silently wrong" means an attacker
 * registers a webhook pointing at `169.254.169.254` and reads the Cloud Run instance's metadata
 * (service-account tokens included). It carried zero assertions until 2026-08-05.
 *
 * ⚠️ DNS IS MOCKED, AND IT HAS TO BE. `assertSafeUrl` calls `lookup()` on every host. A test suite
 * that hit real DNS would be non-hermetic (the thing WS0 just finished fixing elsewhere), would
 * fail in a sandboxed CI runner with no network, and would make the private-IP cases depend on
 * whoever currently owns a domain. The mock also lets us test the case that matters most and cannot
 * be produced otherwise: a PUBLIC hostname that resolves to a PRIVATE address.
 */

const h = vi.hoisted(() => ({
  /** What `lookup()` answers. Default: an ordinary public address. */
  addrs: [{ address: '93.184.216.34' }] as { address: string; family?: number }[],
  /** Answers handed out ONE PER CALL before falling back to `addrs` — a name whose answer changes between lookups. */
  sequence: [] as { address: string; family?: number }[][],
  calls: 0,
  shouldThrow: false,
}))

vi.mock('node:dns/promises', () => ({
  lookup: async () => {
    h.calls++
    if (h.shouldThrow) throw new Error('ENOTFOUND')
    return h.sequence.shift() ?? h.addrs
  },
}))

const { assertSafeUrl, safeFetch, isAllowedPushEndpoint } = await import('@/lib/ssrf')

/** Assert the URL is rejected, and with WHICH reason — the reason is the test's real subject. */
async function rejects(url: string, reason: string) {
  await expect(assertSafeUrl(url), `${url} must be rejected as ${reason}`).rejects.toThrow(reason)
}

beforeEach(() => {
  h.addrs = [{ address: '93.184.216.34' }]
  h.sequence = []
  h.calls = 0
  h.shouldThrow = false
})

describe('IP-literal hosts are blocked before DNS is ever consulted', () => {
  // Each case is one line of the denylist. Named by what an attacker would be reaching for, because
  // that is what makes a future edit think twice about "simplifying" the range.
  it.each([
    ['https://169.254.169.254/latest/meta-data/', 'cloud instance metadata — the crown jewels'],
    ['https://127.0.0.1/', 'loopback'],
    ['https://127.1.2.3/', 'loopback, and not just .0.1 — the whole 127/8'],
    ['https://10.0.0.5/', 'RFC1918 10/8'],
    ['https://172.16.0.1/', 'RFC1918 172.16/12 lower bound'],
    ['https://172.31.255.254/', 'RFC1918 172.16/12 upper bound'],
    ['https://192.168.1.1/', 'RFC1918 192.168/16 — the home router'],
    ['https://100.64.0.1/', 'CGNAT 100.64/10'],
    ['https://0.0.0.0/', '0/8'],
    ['https://224.0.0.1/', 'multicast'],
    ['https://255.255.255.255/', 'reserved/broadcast'],
  ])('%s → %s', async (url) => {
    await rejects(url, 'ssrf:private_host')
  })

  it.each([
    ['https://[::1]/', 'IPv6 loopback'],
    ['https://[::]/', 'IPv6 unspecified'],
    ['https://[fe80::1]/', 'IPv6 link-local'],
    ['https://[fc00::1]/', 'IPv6 unique-local (fc)'],
    ['https://[fd12:3456::1]/', 'IPv6 unique-local (fd)'],
    ['https://[ff02::1]/', 'IPv6 multicast'],
  ])('%s → %s', async (url) => {
    await rejects(url, 'ssrf:private_host')
  })

  it('IPv4-mapped IPv6 does not smuggle a loopback past the v4 rules', async () => {
    // ::ffff:127.0.0.1 is 127.0.0.1 wearing a hat. The implementation recurses on the suffix; this
    // pins that it still does, because a reader "tidying" the v6 branch would plausibly drop it.
    await rejects('https://[::ffff:127.0.0.1]/', 'ssrf:private_host')
    await rejects('https://[::ffff:169.254.169.254]/', 'ssrf:private_host')
  })

  it('the 172.16/12 boundaries are exact, not "anything starting 172"', async () => {
    // 172.15 and 172.32 are ORDINARY PUBLIC space. Blocking them would be a silent availability bug
    // for a legitimate partner; the boundary is the only part of this rule that can be got wrong.
    await expect(assertSafeUrl('https://172.15.0.1/')).resolves.toBeInstanceOf(URL)
    await expect(assertSafeUrl('https://172.32.0.1/')).resolves.toBeInstanceOf(URL)
  })

  it('the 100.64/10 CGNAT boundaries are exact too', async () => {
    await expect(assertSafeUrl('https://100.63.0.1/')).resolves.toBeInstanceOf(URL)
    await expect(assertSafeUrl('https://100.128.0.1/')).resolves.toBeInstanceOf(URL)
  })

  it('an ordinary public address is allowed — or every assertion above is vacuous', async () => {
    await expect(assertSafeUrl('https://93.184.216.34/')).resolves.toBeInstanceOf(URL)
  })
})

describe('the ranges added by the 2026-10-22 review (item 29)', () => {
  it.each([
    ['https://198.18.0.1/', 'benchmarking 198.18/15 lower half'],
    ['https://198.19.255.254/', 'benchmarking 198.18/15 upper half'],
    ['https://192.0.0.8/', 'IETF protocol assignments 192.0.0/24'],
    ['https://192.0.2.1/', 'TEST-NET-1'],
    ['https://198.51.100.1/', 'TEST-NET-2'],
    ['https://203.0.113.1/', 'TEST-NET-3'],
    ['https://192.88.99.1/', '6to4 relay anycast'],
    ['https://240.0.0.1/', 'reserved 240/4'],
  ])('%s → %s', async (url) => {
    await rejects(url, 'ssrf:private_host')
  })

  it('the 198.18/15 boundaries are exact', async () => {
    await expect(assertSafeUrl('https://198.17.255.255/')).resolves.toBeInstanceOf(URL)
    await expect(assertSafeUrl('https://198.20.0.1/')).resolves.toBeInstanceOf(URL)
  })

  it.each([
    ['https://[fe90::1]/', 'link-local is fe80::/10 — fe80 through febf, not only addresses spelled fe80'],
    ['https://[febf:ffff::1]/', 'link-local, the top of the /10'],
    ['https://[fef0::1]/', 'site-local fec0::/10 beyond the fec0 spelling'],
    ['https://[::127.0.0.1]/', 'IPv4-compatible loopback (the URL parser turns it into ::7f00:1)'],
    ['https://[::ffff:7f00:1]/', 'IPv4-mapped loopback written in hex'],
    ['https://[64:ff9b::169.254.169.254]/', 'NAT64 of the metadata service — a NAT64 gateway dials 169.254.169.254'],
    ['https://[64:ff9b::7f00:1]/', 'NAT64 of loopback'],
    ['https://[64:ff9b:1::1]/', 'local-use NAT64'],
    ['https://[2002:a9fe:a9fe::1]/', '6to4 wrapping the metadata service'],
    ['https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/', 'Teredo'],
    ['https://[2001:db8::1]/', 'documentation'],
    ['https://[100::1]/', 'discard-only'],
  ])('%s → %s', async (url) => {
    await rejects(url, 'ssrf:private_host')
  })

  it.each([
    ['https://[64:ff9b::5db8:d822]/', 'NAT64 of a PUBLIC address — what a DNS64 resolver answers for any v4-only host'],
    ['https://[::ffff:93.184.216.34]/', 'IPv4-mapped public address'],
    ['https://[2606:4700:4700::1111]/', 'an ordinary global IPv6 address'],
  ])('%s is allowed (%s)', async (url) => {
    await expect(assertSafeUrl(url)).resolves.toBeInstanceOf(URL)
  })

  it('a hostname whose AAAA record is outside global unicast (SRv6 SID space) is rejected', async () => {
    h.addrs = [{ address: '5f00::1' }]
    await rejects('https://srv6.example/', 'ssrf:private_ip')
  })

  it('a hostname whose AAAA record is a NAT64 wrapping of the metadata service is rejected', async () => {
    h.addrs = [{ address: '64:ff9b::a9fe:a9fe' }]
    await rejects('https://attacker.example/', 'ssrf:private_ip')
  })
})

// Refute review 2026-10-23: the v6 deny list had missed blocks IANA assigned after it was written. IPv6 is now
// allow-first — global unicast 2000::/3, NAT64's well-known prefix and IPv4-mapped only — so these need no list entry.
describe('IPv6 is allow-first: only global unicast (2000::/3) is dialled', () => {
  it.each([
    ['https://[5f00::1]/', 'SRv6 SIDs (RFC 9602) — outside 2000::/3, on no list'],
    ['https://[100:0:0:1::1]/', 'the dummy prefix (RFC 9780) — not inside 100::/64'],
    ['https://[4000::1]/', 'IETF-reserved space'],
    ['https://[2001:10::1]/', 'ORCHID — the rest of 2001::/23, past Teredo\'s /32'],
    ['https://[2001:20::1]/', 'ORCHIDv2 — 2001::/23 is blocked whole'],
    ['https://[2002:5db8:d822::1]/', '6to4, even wrapping a public address — deprecated (RFC 7526)'],
    ['https://[2002:a9fe:a9fe::1]/', '6to4 wrapping the metadata service'],
  ])('%s → %s', async (url) => {
    await rejects(url, 'ssrf:private_host')
  })

  it('global unicast just inside the boundaries still passes', async () => {
    for (const url of ['https://[2000::1]/', 'https://[3ffe:ffff::1]/', 'https://[2001:200::1]/']) {
      await expect(assertSafeUrl(url), url).resolves.toBeInstanceOf(URL)
    }
  })
})

describe('the address the socket dials is checked, not only the one the pre-check saw (DNS rebinding)', () => {
  it('a name that answers public to the check and loopback to the dial is refused at connect time', async () => {
    // The attack the pre-check alone cannot stop: a zero-TTL name answers 93.184.216.34 to assertSafeUrl, then
    // 127.0.0.1 to the lookup the socket makes a moment later. The refusal must come from that second lookup.
    h.sequence = [[{ address: '93.184.216.34', family: 4 }], [{ address: '127.0.0.1', family: 4 }]]
    await expect(safeFetch('https://rebind.example/hook', { timeoutMs: 5000 })).rejects.toThrow('ssrf:private_ip')
    expect(h.calls, 'the second answer must have come from the socket\'s own lookup').toBe(2)
  })

  it('a dial that resolves to ANY private address among several is refused', async () => {
    h.sequence = [[{ address: '93.184.216.34', family: 4 }], [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }]]
    await expect(safeFetch('https://multi-rebind.example/', { timeoutMs: 5000 })).rejects.toThrow('ssrf:private_ip')
  })

  it('a dial whose lookup comes back empty is refused, not attempted', async () => {
    h.sequence = [[{ address: '93.184.216.34', family: 4 }], []]
    await expect(safeFetch('https://vanishing.example/', { timeoutMs: 5000 })).rejects.toThrow('ssrf:private_ip')
  })
})

describe('the scheme gate', () => {
  it.each([
    ['http://example.com/', 'plaintext http'],
    ['file:///etc/passwd', 'file'],
    ['gopher://example.com/', 'gopher — the classic SSRF protocol-smuggling vector'],
    ['ftp://example.com/', 'ftp'],
  ])('%s is rejected (%s)', async (url) => {
    await rejects(url, 'ssrf:scheme')
  })

  it('a malformed URL is rejected before anything else touches it', async () => {
    await rejects('not-a-url', 'ssrf:bad_url')
  })
})

describe('DNS results are checked, not just the literal host', () => {
  it('a PUBLIC hostname that resolves to a private address is rejected', async () => {
    // The attack the IP-literal rules alone cannot stop, and the reason `lookup()` is called at all:
    // attacker.example is a perfectly ordinary name whose A record points at the metadata service.
    h.addrs = [{ address: '169.254.169.254' }]
    await rejects('https://attacker.example/', 'ssrf:private_ip')
  })

  it('EVERY resolved address must be safe, not merely the first', async () => {
    // A host with several A records where only one is internal. Short-circuiting on the first
    // public answer is the natural way to write this loop and it would be wrong.
    h.addrs = [{ address: '93.184.216.34' }, { address: '10.0.0.5' }]
    await rejects('https://multi.example/', 'ssrf:private_ip')
  })

  it('a host that does not resolve is rejected rather than fetched', async () => {
    h.shouldThrow = true
    await rejects('https://nxdomain.example/', 'ssrf:dns')
  })

  it('an empty answer is rejected — fail closed, not "no addresses, no problem"', async () => {
    h.addrs = []
    await rejects('https://empty.example/', 'ssrf:dns')
  })
})

describe('the Web-Push endpoint allowlist', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://android.googleapis.com/gcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://xyz.notify.windows.com/w/?token=abc',
    'https://api.push.apple.com/3/device/abc',
  ])('allows the real push service %s', (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true)
  })

  it.each([
    ['https://evilgoogleapis.com/fcm/send/abc', 'suffix-glued lookalike — the `(^|\\.)` anchor is what stops it'],
    ['https://googleapis.com.attacker.test/x', 'the real name as a SUBDOMAIN of an attacker domain'],
    ['https://push.apple.com.attacker.test/x', 'same trick on the APNs name'],
    ['http://fcm.googleapis.com/fcm/send/abc', 'right host, but plaintext http'],
    ['https://169.254.169.254/', 'metadata service'],
    ['not-a-url', 'unparseable'],
  ])('rejects %s (%s)', (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false)
  })
})
