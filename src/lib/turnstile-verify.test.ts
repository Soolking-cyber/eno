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
    ['bad-request'],
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
  ])('rejects on %s — this one IS about the visitor', async (code) => {
    vi.stubGlobal('fetch', async () => fail(code))
    await expect(verifyTurnstile('tok')).resolves.toBe(false)
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
