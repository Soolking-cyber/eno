import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A BROKEN CAPTCHA SECRET MUST NOT BE AN AUTH OUTAGE.
 *
 * ⚠️ THIS HAS TAKEN EMAIL SIGN-IN DOWN FOR EVERY VISITOR TWICE — 2026-07-19, and again 2026-07-27,
 * where production logged 9 × `invalid-input-secret` and 15 × HTTP 403 on /api/auth/email-link in a
 * single day. Both times the cause was configuration and both times the code answered by refusing
 * real people.
 *
 * The reasoning that decides it: when Cloudflare reports the SECRET is invalid, it has not looked at
 * the visitor at all. The bot protection is already absent. Failing closed therefore buys no
 * security whatsoever — it just adds an outage on top of a gap that exists either way. The module
 * already reasoned exactly this way for an unreachable Cloudflare ("the alternative is that a
 * Cloudflare blip locks everyone out of their account"); this branch was simply missed.
 *
 * A REAL captcha failure — an invalid or replayed token — still fails closed. That distinction is
 * the whole point, so it is pinned in both directions below.
 */

const OK = { ok: true, json: async () => ({ success: true }) }
const fail = (...codes: string[]) => ({ ok: true, json: async () => ({ success: false, 'error-codes': codes }) })

let verifyTurnstile: typeof import('./turnstile-verify')['verifyTurnstile']

beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'a-secret')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  ;({ verifyTurnstile } = await import('./turnstile-verify'))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('a misconfiguration on OUR side allows the visitor through', () => {
  it.each([
    ['invalid-input-secret'],
    ['missing-input-secret'],
    ['internal-error'],
  ])('allows on %s — the captcha never examined the visitor', async (code) => {
    vi.stubGlobal('fetch', async () => fail(code))
    await expect(verifyTurnstile('tok', '1.2.3.4')).resolves.toBe(true)
  })

  it('THE REGRESSION: the exact production failure of 2026-07-27 no longer 403s', async () => {
    vi.stubGlobal('fetch', async () => fail('invalid-input-secret'))
    await expect(verifyTurnstile('a-real-widget-token')).resolves.toBe(true)
  })

  it('says so at ERROR level — a silently disabled captcha is the dangerous half', async () => {
    vi.stubGlobal('fetch', async () => fail('invalid-input-secret'))
    await verifyTurnstile('tok')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('MISCONFIGURED'), ['invalid-input-secret'])
  })
})

describe('a genuine captcha failure still fails closed', () => {
  it.each([
    ['invalid-input-response'],
    ['timeout-or-duplicate'],
    ['missing-input-response'],
    // security review 2026-10-22, item 17: `bad-request` can be provoked by a malformed `response` the
    // client controls, so it must NOT be in the allow-through set. The shape guard below rejects a
    // malformed token before we even ask Cloudflare, so with a secret set this code means the ANSWER failed.
    ['bad-request'],
  ])('rejects on %s — this one IS about the visitor', async (code) => {
    vi.stubGlobal('fetch', async () => fail(code))
    await expect(verifyTurnstile('tok')).resolves.toBe(false)
  })

  it('rejects a token that is not a well-formed string, before calling Cloudflare (item 17)', async () => {
    const fetchSpy = vi.fn(async () => OK)
    vi.stubGlobal('fetch', fetchSpy)
    // oversized: a real Turnstile token is bounded (~2048 chars). An attacker could send a huge one to
    // provoke `bad-request` and ride the old allow-through.
    await expect(verifyTurnstile('x'.repeat(5000))).resolves.toBe(false)
    // non-string reaching us through an untyped boundary.
    await expect(verifyTurnstile(123 as unknown as string)).resolves.toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a mixed verdict is treated as a real failure, not a misconfiguration', async () => {
    // Conservative on purpose: "every code is ours" is the allow condition, so one visitor-side
    // code in the list is enough to keep the gate shut.
    vi.stubGlobal('fetch', async () => fail('invalid-input-secret', 'invalid-input-response'))
    await expect(verifyTurnstile('tok')).resolves.toBe(false)
  })

  it('an empty code list stays closed rather than guessing', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ success: false }) }))
    await expect(verifyTurnstile('tok')).resolves.toBe(false)
  })

  it('no token at all is still a refusal', async () => {
    vi.stubGlobal('fetch', async () => OK)
    await expect(verifyTurnstile(undefined)).resolves.toBe(false)
  })
})

describe('the two pre-existing fail-open paths are unchanged', () => {
  it('allows when the secret is not configured at all', async () => {
    vi.resetModules()
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    const mod = await import('./turnstile-verify')
    await expect(mod.verifyTurnstile(undefined)).resolves.toBe(true)
  })

  it('allows when Cloudflare is unreachable', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network') })
    await expect(verifyTurnstile('tok')).resolves.toBe(true)
  })

  it('a genuine success is still a success', async () => {
    vi.stubGlobal('fetch', async () => OK)
    await expect(verifyTurnstile('tok')).resolves.toBe(true)
  })
})

/**
 * WHERE THE TOKEN WAS MINTED (Cloudflare: "Validate the action and hostname"). Both editions share one site key whose
 * hostname allow-list also holds `localhost`, so anyone can render the widget on their own machine and farm tokens
 * siteverify calls valid. A request that reached a live eno site now needs a token minted on one.
 */
describe('a token spent on a live site was minted on a live site', () => {
  const minted = (hostname?: string) => async () => ({ ok: true, json: async () => ({ success: true, ...(hostname ? { hostname } : {}) }) })

  it.each([
    ['eno.vn', 'eno.vn'],
    ['www.eno.forum', 'www.eno.forum'],
    ['eno.vn', 'eno.forum'], // one company, one site key: either edition's token is ours
    ['apple.eno.vn', 'apple.eno.vn'], // a storefront subdomain
    ['eno.vn:443', 'eno.vn'], // a Host header may carry its port
  ])('request on %s, token from %s → accepted', async (host, hostname) => {
    vi.stubGlobal('fetch', minted(hostname))
    await expect(verifyTurnstile('tok', '1.2.3.4', host)).resolves.toBe(true)
  })

  it.each([
    ['localhost', 'the site key also allows localhost — the farming vector this closes'],
    ['evil.example', 'any other site'],
    ['eno.vn.evil.example', 'a suffix trick'],
  ])('⛔ request on eno.vn, token minted on %s → refused (%s)', async (hostname) => {
    vi.stubGlobal('fetch', minted(hostname))
    await expect(verifyTurnstile('tok', '1.2.3.4', 'eno.vn')).resolves.toBe(false)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('another site'), hostname)
  })

  it('a local run keeps accepting its own localhost tokens', async () => {
    vi.stubGlobal('fetch', minted('localhost'))
    await expect(verifyTurnstile('tok', '127.0.0.1', 'localhost:3000')).resolves.toBe(true)
  })

  it('a success with no hostname is Cloudflare\'s side, not the visitor\'s: allowed, at ERROR level', async () => {
    vi.stubGlobal('fetch', minted())
    await expect(verifyTurnstile('tok', '1.2.3.4', 'eno.vn')).resolves.toBe(true)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('without a hostname'))
  })

  it('a caller that passes no Host is unchanged (no check)', async () => {
    vi.stubGlobal('fetch', minted('localhost'))
    await expect(verifyTurnstile('tok', '1.2.3.4')).resolves.toBe(true)
  })
})
