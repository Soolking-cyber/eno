import { describe, expect, it, vi, beforeEach } from 'vitest'

// Tests for the password sign-in route's SECURITY CONTRACT, which is the part of it that is
// easy to regress silently: every one of these properties is invisible in a click-through
// (sign-in works either way) and expensive to lose.
//
// ⚠️ WHAT IS ASSERTED HERE IS THE INDISTINGUISHABILITY, not "does the password check work".
// Supabase checks the password; we cannot and should not re-test GoTrue. What only we can
// get wrong is leaking WHICH of the many failure causes occurred, and that is what a future
// edit — adding a helpful `reason` field, or an early return that skips the timing floor —
// would break without failing anything else.

const signInWithPassword = vi.fn()
const rateLimit = vi.fn()
const kvGet = vi.fn()
const kvSet = vi.fn()
const kvDel = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { signInWithPassword } }),
}))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: (...a: unknown[]) => rateLimit(...a),
  kv: { get: (...a: unknown[]) => kvGet(...a), set: (...a: unknown[]) => kvSet(...a), del: (...a: unknown[]) => kvDel(...a) },
}))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
const profileFindFirst = vi.fn()
vi.mock('@/lib/db', () => ({ db: { profile: { findFirst: (...a: unknown[]) => profileFindFirst(...a) } } }))
vi.mock('@/lib/email-alias', () => ({ canonicalEmail: (e: string) => e.replace('@eno.vn', '@eno.forum') }))
vi.mock('@/lib/api/handler', () => ({
  // The wrapper is not under test; call the handler directly.
  route: (_opts: unknown, fn: (ctx: { req: Request }) => unknown) => (req: Request) => fn({ req }),
}))

const { POST } = await import('./route')

// ⚠️ EVERY CALL CARRIES A captchaToken BY DEFAULT. The route now rejects a token-less request
// with 403 before it does anything else, so without this the whole suite would exercise that one
// early return and assert nothing. Tests that care about the token pass their own.
const post = (body: Record<string, unknown>) =>
  (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('https://eno.vn/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ captchaToken: 'tok_test', ...body }),
    }),
  )

beforeEach(() => {
  vi.clearAllMocks()
  rateLimit.mockResolvedValue({ success: true, remaining: 10 })
  kvGet.mockResolvedValue(null)
  kvSet.mockResolvedValue('OK')
  kvDel.mockResolvedValue(undefined)
  // Default: the caller IS an official partner, so the existing suite exercises the
  // authenticated path. The gate itself is covered in its own block below.
  profileFindFirst.mockResolvedValue({ seller: { officialPartner: true } })
})

describe('POST /api/auth/password — official-partner gate', () => {
  // ⚠️ WHAT THIS GATE IS AND IS NOT. It restricts what OUR route will do; it cannot restrict
  // what Supabase will do, because /auth/v1/token?grant_type=password is reachable with the
  // public anon key and never sees `officialPartner`. One reviewer asserted the gate closes
  // account pre-hijacking outright — it does not, and these tests deliberately do not claim it.
  const nonPartners = [
    ['no profile at all', null],
    ['a profile with no seller', { seller: null }],
    ['a seller that is not a partner', { seller: { officialPartner: false } }],
  ] as const

  it('refuses every non-partner with the SAME response a wrong password gets', async () => {
    const seen = new Set<string>()
    for (const [, row] of nonPartners) {
      profileFindFirst.mockResolvedValueOnce(row)
      const res = await post({ identifier: 'a@b.com', password: 'x' })
      seen.add(`${res.status}:${await res.text()}`)
    }
    signInWithPassword.mockResolvedValueOnce({ data: {}, error: { code: 'invalid_credentials', message: 'x' } })
    const wrongPw = await post({ identifier: 'a@b.com', password: 'x' })
    seen.add(`${wrongPw.status}:${await wrongPw.text()}`)
    // One distinct answer across "not a partner" and "wrong password", or partner status
    // becomes discoverable for any address.
    expect(seen.size).toBe(1)
    expect([...seen][0]).toBe('401:{"error":"bad_credentials"}')
  })

  it('never verifies a non-partner password upstream', async () => {
    profileFindFirst.mockResolvedValue({ seller: { officialPartner: false } })
    await post({ identifier: 'a@b.com', password: 'x' })
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('does not spend a non-partner\'s lockout budget', async () => {
    // Counting these would let anyone lock an ordinary user out by merely naming them.
    profileFindFirst.mockResolvedValue({ seller: { officialPartner: false } })
    await post({ identifier: 'a@b.com', password: 'x' })
    expect(kvSet).not.toHaveBeenCalled()
  })

  it('pads the non-partner rejection to the same floor as a real attempt', async () => {
    // Without this the gate is a latency oracle: one local read vs a network round trip.
    profileFindFirst.mockResolvedValue({ seller: { officialPartner: false } })
    const started = Date.now()
    await post({ identifier: 'a@b.com', password: 'x' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(850)
  })

  it('answers 403 for a token-less request, whoever the caller is', async () => {
    // Found by live-testing against the real database, not by reading the code: without this,
    // a caller sending no token got 401 for a non-partner and 403 for a partner — a free
    // "is this an official partner?" enumerator.
    // ⚠️ NO mockResolvedValueOnce QUEUE HERE. An earlier version primed one per iteration, but
    // the route returns BEFORE the lookup, so none were consumed — and vitest's `Once` queue
    // survives clearAllMocks(), so all three leaked into the next test and made a fail-closed
    // assertion silently exercise the happy path instead. That the lookup is never called is
    // itself the thing worth asserting.
    const seen = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const res = await (POST as unknown as (r: Request) => Promise<Response>)(
        new Request('https://eno.vn/api/auth/password', {
          method: 'POST',
          body: JSON.stringify({ identifier: 'a@b.com', password: 'x' }),
        }),
      )
      seen.add(`${res.status}:${await res.text()}`)
    }
    expect(seen.size).toBe(1)
    expect([...seen][0]).toBe('403:{"error":"captcha_failed"}')
    expect(profileFindFirst).not.toHaveBeenCalled()
  })

  it('fails CLOSED when the partner lookup throws', async () => {
    profileFindFirst.mockRejectedValue(new Error('db down'))
    const res = await post({ identifier: 'a@b.com', password: 'x' })
    expect(res.status).toBe(401)
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('looks the partner up by the CANONICAL identifier, not the typed one', async () => {
    // ⚠️ THE VALUE, NOT JUST THE KEY. Prisma does an exact match, so if we look up the string
    // the user typed rather than the one Profile stores, a real partner is silently classed as
    // a non-partner and denied — measured in prod: all 10 phone-bearing profiles store a
    // leading '+', and no profile has a non-lowercase email, so these are the formats to match.
    profileFindFirst.mockResolvedValue({ seller: { officialPartner: true } })
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'x', message: 'x' } })

    await post({ identifier: '0987 654 321', password: 'x' })
    expect(profileFindFirst.mock.calls[0][0].where).toEqual({ phone: '+84987654321' })

    profileFindFirst.mockClear()
    await post({ identifier: '  Info@VietKite.com.vn ', password: 'x' })
    expect(profileFindFirst.mock.calls[0][0].where).toEqual({ email: 'info@vietkite.com.vn' })
  })
})

describe('POST /api/auth/password — failure indistinguishability', () => {
  // The four causes GoTrue tells apart and we must not.
  const causes: [string, unknown][] = [
    ['no such user', { data: {}, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } }],
    ['wrong password', { data: {}, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } }],
    ['account has no password', { data: {}, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } }],
    ['phone provider disabled', { data: {}, error: { code: 'phone_provider_disabled', message: 'Phone logins are disabled' } }],
  ]

  it('returns a byte-identical body and status for every failure cause', async () => {
    const seen = new Set<string>()
    for (const [, upstream] of causes) {
      signInWithPassword.mockResolvedValueOnce(upstream)
      const res = await post({ identifier: 'a@b.com', password: 'x' })
      seen.add(`${res.status}:${await res.text()}`)
    }
    // ⚠️ ONE distinct response across all four, or the endpoint is an oracle.
    expect(seen.size).toBe(1)
    expect([...seen][0]).toBe('401:{"error":"bad_credentials"}')
  })

  it('never echoes the upstream message or code', async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'phone_provider_disabled', message: 'Phone logins are disabled' } })
    const body = await (await post({ identifier: 'a@b.com', password: 'x' })).text()
    // ⚠️ EXACT EQUALITY, not a keyword regex. The first version of this test asserted the
    // body did not match /…|credentials/i and failed on our OWN constant `bad_credentials`,
    // which was the test being wrong rather than the route. Pinning the whole string is
    // stricter anyway: any added field — a `reason`, a `code`, a retry hint — fails here,
    // which is precisely the drift that would turn this back into an oracle.
    expect(body).toBe('{"error":"bad_credentials"}')
    expect(body).not.toMatch(/phone|disabled|provider|invalid login/i)
  })

  it('applies a timing floor so a fast failure cannot be told from a slow one', async () => {
    // A "no such user" upstream returns instantly; without the floor it would be
    // measurably faster than a real bcrypt comparison.
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'invalid_credentials', message: 'x' } })
    const started = Date.now()
    await post({ identifier: 'a@b.com', password: 'x' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(850)
  })

  it('treats a session-less success as a failure rather than signing anyone in', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: null })
    const res = await post({ identifier: 'a@b.com', password: 'x' })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/password — lockout', () => {
  it('counts FAILURES, and clears them on success', async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'invalid_credentials', message: 'x' } })
    await post({ identifier: 'a@b.com', password: 'x' })
    expect(kvSet).toHaveBeenCalledTimes(1)
    expect(kvDel).not.toHaveBeenCalled()

    vi.clearAllMocks()
    rateLimit.mockResolvedValue({ success: true, remaining: 10 })
    kvGet.mockResolvedValue({ n: 3, until: 0, startedAt: Date.now() - 1000 })
    signInWithPassword.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    const ok = await post({ identifier: 'a@b.com', password: 'right' })
    expect(ok.status).toBe(200)
    // ⚠️ THE REGRESSION THIS EXISTS FOR: the first implementation used escalatingCooldown(),
    // which claims a step on EVERY call, so five successful sign-ins locked the account out.
    // A success must consume nothing and must wipe the run.
    expect(kvDel).toHaveBeenCalledTimes(1)
    expect(kvSet).not.toHaveBeenCalled()
  })

  it('locks out once the failure threshold is passed, and says how long', async () => {
    // ⚠️ `startedAt` IS REQUIRED ON THE RECORD NOW. The lockout was an escalating ladder and
    // is a fixed window — round 3 of review proved the ladder was unreachable dead code (a
    // lock always landed at n=5, and waiting it out reset n to 1, so the 300/900/1800 steps
    // could never occur while an attacker got five fresh guesses a minute). A record without
    // `startedAt` is now treated as belonging to an expired window and cleared, which is
    // exactly what this test was silently exercising when it failed.
    kvGet.mockResolvedValue({ n: 6, until: Date.now() + 300_000, startedAt: Date.now() - 60_000 })
    const res = await post({ identifier: 'a@b.com', password: 'x' })
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBe('rate_limited')
    expect(body.retryAfterSec).toBeGreaterThan(250)
    expect(res.headers.get('retry-after')).toBeTruthy()
    // Locked out means NOT forwarded upstream — the point is to stop the guessing.
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('lets an expired lock through instead of stranding the account', async () => {
    kvGet.mockResolvedValue({ n: 9, until: Date.now() - 1000, startedAt: Date.now() - 1_000_000 })
    signInWithPassword.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    expect((await post({ identifier: 'a@b.com', password: 'right' })).status).toBe(200)
  })

  it('fails CLOSED when the lockout store is unavailable', async () => {
    kvGet.mockRejectedValue(new Error('backend down'))
    const res = await post({ identifier: 'a@b.com', password: 'x' })
    expect(res.status).toBe(429)
    expect(signInWithPassword).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/password — round-3 review fixes', () => {
  it('does NOT count a captcha rejection toward the lockout, and says so plainly', async () => {
    // ⚠️ THE WORST BUG THIS ROUTE HAD. Supabase validates the Turnstile token BEFORE it looks
    // at any credential, so counting a captcha rejection as a failed password let anyone curl
    // this endpoint five times with a junk password and NO captcha and lock a victim out of
    // password sign-in without ever guessing anything.
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'captcha_failed', message: 'captcha protection: request disallowed' } })
    const res = await post({ identifier: 'a@b.com', password: 'x' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'captcha_failed' })
    // The lockout must not have moved.
    expect(kvSet).not.toHaveBeenCalled()
  })

  it('never lets an email-shaped string spend a PHONE account\'s lockout budget', async () => {
    // `84901234567@gmail` fails the strict email test; before the fix it fell to the phone
    // branch, normalised to +84901234567, and burned a stranger's budget.
    const res = await post({ identifier: '84901234567@gmail', password: 'x' })
    expect(res.status).toBe(400)
    expect(kvGet).not.toHaveBeenCalled()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('answers 400 for the valid JSON body `null` rather than throwing a 500', async () => {
    const res = await (POST as unknown as (r: Request) => Promise<Response>)(
      new Request('https://eno.vn/api/auth/password', { method: 'POST', body: 'null' }),
    )
    expect(res.status).toBe(400)
  })

  it('caps a lock at ONE window — an old run cannot hold an account shut forever', async () => {
    // The escalating ladder allowed a slow drip to pin an address at the top step
    // indefinitely. A record whose window has elapsed is cleared, not extended.
    kvGet.mockResolvedValue({ n: 99, until: Date.now() + 60_000, startedAt: Date.now() - 3_600_000 })
    signInWithPassword.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    expect((await post({ identifier: 'a@b.com', password: 'right' })).status).toBe(200)
  })
})

describe('POST /api/auth/password — keys and inputs', () => {
  it('locks on the CANONICAL address, so an alias cannot get its own budget', async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'invalid_credentials', message: 'x' } })
    await post({ identifier: 'Support@ENO.vn', password: 'x' })
    expect(kvGet).toHaveBeenCalledWith('pwfail:support@eno.forum')
  })

  it('checks the per-IP ceiling BEFORE the per-identifier lockout', async () => {
    // Otherwise a spray across many addresses gets a fresh lockout budget for each one.
    rateLimit.mockResolvedValue({ success: false, remaining: 0 })
    const res = await post({ identifier: 'a@b.com', password: 'x' })
    expect(res.status).toBe(429)
    expect(kvGet).not.toHaveBeenCalled()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('routes an email to email and anything else to phone', async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'x', message: 'x' } })
    await post({ identifier: 'a@b.com', password: 'x' })
    expect(signInWithPassword.mock.calls[0][0]).toHaveProperty('email')
    signInWithPassword.mockClear()
    await post({ identifier: '+84 901 234 567', password: 'x' })
    const arg = signInWithPassword.mock.calls[0][0] as { phone?: string }
    expect(arg).toHaveProperty('phone')
    expect(arg.phone).toBe('+84901234567') // punctuation stripped, digits and + kept
  })

  it('rejects oversized input before it can reach bcrypt', async () => {
    const res = await post({ identifier: 'a@b.com', password: 'x'.repeat(5000) })
    expect(res.status).toBe(400)
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('rejects an empty identifier or password without calling upstream', async () => {
    for (const body of [{ identifier: '', password: 'x' }, { identifier: 'a@b.com', password: '' }]) {
      expect((await post(body)).status).toBe(400)
    }
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('forwards the captcha token upstream rather than consuming it here', async () => {
    // A Turnstile token is single-use and Supabase enforces the captcha on this grant, so
    // verifying it locally would spend it and guarantee an upstream rejection.
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'x', message: 'x' } })
    await post({ identifier: 'a@b.com', password: 'x', captchaToken: 'tok_abc' })
    expect(signInWithPassword.mock.calls[0][0]).toMatchObject({ options: { captchaToken: 'tok_abc' } })
  })
})
