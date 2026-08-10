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

// ⚠️ THE ROUTE NO LONGER CALLS signInWithPassword(). It verifies Turnstile with OUR secret and
// then hits the token endpoint directly with the SERVICE-ROLE key, because Supabase's dashboard
// holds a Turnstile secret that does not match this project's widget — every real sign-in was
// logging `captcha_failed` in production. `signInWithPassword` is kept as the name of the spy
// that stands in for that upstream call so the existing assertions still read naturally.
const setSession = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { setSession } }),
}))
const verifyTurnstile = vi.fn()
vi.mock('@/lib/turnstile-verify', () => ({ verifyTurnstile: (...a: unknown[]) => verifyTurnstile(...a) }))
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

// The upstream grant is now a fetch. This adapter lets every existing test keep expressing its
// intent as "signInWithPassword resolves {data,error}" while the route does an HTTP call.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    const r = await signInWithPassword()
    if (r?.error) return new Response(JSON.stringify({ error_code: r.error.code, msg: r.error.message }), { status: 400 })
    // A confirmed, unbanned user by default — the route refuses anything else, so every
    // existing "success" case has to describe a usable account.
    if (r?.data?.session) return new Response(JSON.stringify({
      access_token: 'at', refresh_token: 'rt',
      user: { email_confirmed_at: '2026-01-01T00:00:00Z', banned_until: null },
    }), { status: 200 })
    return new Response(JSON.stringify({}), { status: 400 })
  }))
  verifyTurnstile.mockResolvedValue(true)
  setSession.mockResolvedValue({ error: null })
  vi.clearAllMocks()
  // Stand in for Cloudflare: a token present and non-empty passes, absent fails — which is
  // exactly verifyTurnstile's real contract once a secret is configured.
  // The route fails CLOSED without these, which is deliberate — see the guard it protects.
  process.env.SUPABASE_SECRET_KEY = 'test-service-key'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.TURNSTILE_SECRET_KEY = 'test-turnstile-secret'
  verifyTurnstile.mockImplementation(async (token?: string) => !!token)
  setSession.mockResolvedValue({ error: null })
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
    // Read from the request BODY now — the credentials go over HTTP rather than through the SDK.
    const body = (i = 0) => JSON.parse((globalThis.fetch as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[i][1].body)
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'x', message: 'x' } })
    await post({ identifier: 'a@b.com', password: 'x' })
    expect(body()).toHaveProperty('email')
    ;(globalThis.fetch as unknown as { mockClear: () => void }).mockClear()
    await post({ identifier: '+84 901 234 567', password: 'x' })
    expect(body()).toHaveProperty('phone')
    expect(body().phone).toBe('+84901234567') // punctuation stripped, digits and + kept
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

  it('verifies the captcha with OUR secret and does NOT forward it upstream', async () => {
    // ⚠️ THIS ASSERTION IS THE EXACT INVERSE OF THE ONE IT REPLACES, and the inversion is the
    // fix. Forwarding the token meant Supabase adjudicated it against a dashboard secret that
    // does not match this project's widget — production logged `captcha_failed` on every real
    // attempt. We now check it ourselves and authenticate as the service role, which GoTrue
    // does not captcha-gate. Sending the token onward as well would be pointless and would
    // reintroduce the failure the moment anyone stopped using service-role auth.
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'x', message: 'x' } })
    await post({ identifier: 'a@b.com', password: 'x', captchaToken: 'tok_abc' })
    expect(verifyTurnstile).toHaveBeenCalledWith('tok_abc', expect.anything())
    const sent = JSON.parse((globalThis.fetch as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0][1].body)
    expect(sent).not.toHaveProperty('captchaToken')
    expect(sent).not.toHaveProperty('gotrue_meta_security')
  })

  it('refuses password sign-in entirely when Turnstile is not configured', async () => {
    // ⚠️ NOT "presence is enough". verifyTurnstile returns true with no secret configured, so a
    // route trusting it alone has no captcha at all — and a check that the token is merely
    // non-empty is satisfied by "x". An unconfigured environment must lose the FEATURE, not the
    // protection; passwordless sign-in still works there.
    delete process.env.TURNSTILE_SECRET_KEY
    const res = await post({ identifier: 'a@b.com', password: 'x', captchaToken: 'x' })
    expect(res.status).toBe(403)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('requires the CREDENTIAL USED to be confirmed, not merely some identifier', async () => {
    // Email confirmed, phone never was → signing in BY PHONE must fail. Accepting "either one"
    // is the pre-hijacking shape wearing a different identifier.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'at', refresh_token: 'rt',
      user: { email_confirmed_at: '2026-01-01T00:00:00Z', phone_confirmed_at: null },
    }), { status: 200 })))
    expect((await post({ identifier: '+84901234567', password: 'correct' })).status).toBe(401)
    expect(setSession).not.toHaveBeenCalled()
    // ...and the same account signing in by EMAIL is fine.
    expect((await post({ identifier: 'a@b.com', password: 'correct' })).status).toBe(200)
  })

  it('fails CLOSED when the service key is missing, rather than sending "undefined"', async () => {
    // Without the guard, the headers interpolate the literal string "undefined", every sign-in
    // breaks, and the failure reads as a wrong password — an outage disguised as user error.
    delete process.env.SUPABASE_SECRET_KEY
    const res = await post({ identifier: 'a@b.com', password: 'correct' })
    expect(res.status).toBe(401)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('refuses an UNCONFIRMED account even when the password is right', async () => {
    // ⚠️ THE PRE-HIJACKING CASE, ASSERTED. An attacker plants a password on an address the real
    // owner has never confirmed. Using the service-role key to get past GoTrue's captcha may
    // also put the call on its admin path, where the confirmed/banned checks are reported to be
    // skipped — so the route enforces them itself and this pins that. If this ever goes green
    // by deletion, the route becomes the delivery mechanism for the attack it exists to narrow.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'at', refresh_token: 'rt',
      user: { email_confirmed_at: null, phone_confirmed_at: null, confirmed_at: null },
    }), { status: 200 })))
    const res = await post({ identifier: 'a@b.com', password: 'correct' })
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('{"error":"bad_credentials"}')
    expect(setSession).not.toHaveBeenCalled()
  })

  it('refuses a BANNED account even when the password is right', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'at', refresh_token: 'rt',
      user: { email_confirmed_at: '2026-01-01T00:00:00Z', banned_until: '2099-01-01T00:00:00Z' },
    }), { status: 200 })))
    expect((await post({ identifier: 'a@b.com', password: 'correct' })).status).toBe(401)
    expect(setSession).not.toHaveBeenCalled()
  })

  it('refuses a response missing the refresh token rather than minting a dying session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'at', user: { email_confirmed_at: '2026-01-01T00:00:00Z' },
    }), { status: 200 })))
    expect((await post({ identifier: 'a@b.com', password: 'correct' })).status).toBe(401)
    expect(setSession).not.toHaveBeenCalled()
  })

  it('authenticates with the SERVICE-ROLE key, which is what skips GoTrue\'s captcha', async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'x', message: 'x' } })
    await post({ identifier: 'a@b.com', password: 'x' })
    const [url, init] = (globalThis.fetch as unknown as { mock: { calls: [string, { headers: Record<string,string> }][] } }).mock.calls[0]
    expect(url).toContain('grant_type=password')
    // Anything other than the service key here silently reinstates the captcha gate.
    expect(init.headers.Authorization).toContain(process.env.SUPABASE_SECRET_KEY ?? 'undefined')
  })
})
