import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE SSRF DENYLIST — 12 hand-encoded CIDR rules that had no test at all.
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
  addrs: [{ address: '93.184.216.34' }] as { address: string }[],
  shouldThrow: false,
}))

vi.mock('node:dns/promises', () => ({
  lookup: async () => {
    if (h.shouldThrow) throw new Error('ENOTFOUND')
    return h.addrs
  },
}))

const { assertSafeUrl, isAllowedPushEndpoint } = await import('@/lib/ssrf')

/** Assert the URL is rejected, and with WHICH reason — the reason is the test's real subject. */
async function rejects(url: string, reason: string) {
  await expect(assertSafeUrl(url), `${url} must be rejected as ${reason}`).rejects.toThrow(reason)
}

beforeEach(() => {
  h.addrs = [{ address: '93.184.216.34' }]
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
