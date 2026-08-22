import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'

/**
 * The first-party Google OAuth round-trip.
 *
 * ⚠️ EVERY INVARIANT HERE FAILS SILENTLY AND TOTALLY. There is no partial breakage: a nonce sent
 * the wrong way round, a redirect_uri that differs by one character, or a missing code_verifier
 * does not degrade sign-in — it stops it, for everyone, with an error only Google or GoTrue sees.
 * That is why these are pinned rather than left to a manual check nobody repeats.
 */
const load = async () => {
  vi.resetModules()
  return import('./google-oauth')
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '71068369681-test.apps.googleusercontent.com')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('the nonce pairing', () => {
  // The contract (supabase/auth internal/api/token_oidc.go):
  //     hash := fmt.Sprintf("%x", sha256.Sum256([]byte(params.Nonce)))
  //     if hash != idToken.Nonce { "Nonces mismatch" }
  // GoTrue hashes what WE pass and compares to the token's claim; Google copies the nonce it was
  // given into that claim verbatim. So Google must get the digest and Supabase the pre-image.
  it('⛔ GOOGLE GETS THE HEX DIGEST, SUPABASE GETS THE PRE-IMAGE', async () => {
    const { newTransaction } = await load()
    const tx = newTransaction()
    expect(tx.nonceHash).toBe(createHash('sha256').update(tx.nonceRaw).digest('hex'))
    expect(tx.nonceHash).not.toBe(tx.nonceRaw)
  })

  it('⚠️ THE DIGEST IS HEX, NOT base64url', async () => {
    // GoTrue formats with %x. A base64url digest is the same bytes and the wrong string, so every
    // sign-in would fail verification while looking correct in a debugger.
    const { newTransaction } = await load()
    expect(newTransaction().nonceHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('mints a fresh transaction every time', async () => {
    const { newTransaction } = await load()
    const a = newTransaction(); const b = newTransaction()
    expect(a.state).not.toBe(b.state)
    expect(a.nonceRaw).not.toBe(b.nonceRaw)
    expect(a.codeVerifier).not.toBe(b.codeVerifier)
  })
})

describe('the authorize URL', () => {
  it('carries PKCE, the hashed nonce, and our own redirect_uri', async () => {
    const { newTransaction, buildAuthorizeUrl } = await load()
    const tx = newTransaction()
    const u = new URL(buildAuthorizeUrl(tx, 'https://eno.vn')!)
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    // ⛔ THE POINT OF THE WHOLE EXERCISE. Google prints the redirect HOST on the consent screen;
    // this being eno.vn is why it no longer reads xihiryllwmjoouipkyhw.supabase.co.
    expect(u.searchParams.get('redirect_uri')).toBe('https://eno.vn/auth/google/callback')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('nonce')).toBe(tx.nonceHash)
    expect(u.searchParams.get('code_challenge')).toBe(tx.codeChallenge)
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    // Never sign someone into a remembered account behind their back.
    expect(u.searchParams.get('prompt')).toBe('select_account')
  })

  it('⚠️ SENDS THE CHALLENGE, NEVER THE VERIFIER', async () => {
    // The verifier is the secret half and only ever goes to the token endpoint. Leaking it into the
    // authorize URL — which lands in browser history and referrer logs — would defeat PKCE.
    const { newTransaction, buildAuthorizeUrl } = await load()
    const tx = newTransaction()
    expect(buildAuthorizeUrl(tx, 'https://eno.vn')).not.toContain(tx.codeVerifier)
  })

  it('is null with no client id, so the caller falls back instead of building a broken URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '')
    const { newTransaction, buildAuthorizeUrl } = await load()
    expect(buildAuthorizeUrl(newTransaction(), 'https://eno.vn')).toBeNull()
  })
})

describe('googleOauthConfigured', () => {
  it('⛔ REQUIRES THE SECRET, NOT JUST THE CLIENT ID', async () => {
    // The client id is public and inlined in the bundle; only the secret proves the exchange can
    // actually happen. Reporting configured without it sends visitors to Google and strands them
    // at the callback.
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    const { googleOauthConfigured } = await load()
    expect(googleOauthConfigured()).toBe(false)
  })

  it('is true with both', async () => {
    const { googleOauthConfigured } = await load()
    expect(googleOauthConfigured()).toBe(true)
  })
})

describe('stateMatches', () => {
  it('rejects empty, mismatched and differing-length values without throwing', async () => {
    const { stateMatches } = await load()
    expect(stateMatches('abc', 'abc')).toBe(true)
    expect(stateMatches('abc', 'abd')).toBe(false)
    // ⚠️ timingSafeEqual THROWS on a length mismatch. An attacker choosing the length of `state`
    // could otherwise turn the callback into a 500 rather than a clean fallback.
    expect(stateMatches('abc', 'abcdef')).toBe(false)
    expect(stateMatches('', 'abc')).toBe(false)
    expect(stateMatches(null, null)).toBe(false)
    expect(stateMatches(undefined, 'abc')).toBe(false)
  })
})

describe('txCookieName', () => {
  it('⛔ IS PER-TRANSACTION, so two sign-in tabs do not clobber each other', async () => {
    // A single fixed name means the second tab overwrites the first's nonce and verifier, and
    // whichever the visitor finishes second fails. Both external reviewers flagged the race.
    const { newTransaction, txCookieName } = await load()
    expect(txCookieName(newTransaction().state)).not.toBe(txCookieName(newTransaction().state))
  })

  it('is a valid cookie name — no characters that would silently drop the Set-Cookie', async () => {
    const { newTransaction, txCookieName } = await load()
    for (let i = 0; i < 40; i++) {
      expect(txCookieName(newTransaction().state)).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })
})

describe('exchangeCodeForIdToken', () => {
  it('⛔ SENDS THE PKCE VERIFIER — omitting it makes Google reject every login', async () => {
    // I shipped this without the verifier first: code_challenge went to /authorize and nothing
    // completed it at /token, which is invalid_grant on every single sign-in.
    let body: URLSearchParams | null = null
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      body = new URLSearchParams(init.body as string)
      return { ok: true, json: async () => ({ id_token: 'tok' }) } as unknown as Response
    }))
    const { exchangeCodeForIdToken } = await load()
    const r = await exchangeCodeForIdToken('the-code', 'https://eno.vn', 'the-verifier')
    expect(r).toEqual({ ok: true, idToken: 'tok' })
    expect(body!.get('code_verifier')).toBe('the-verifier')
    expect(body!.get('grant_type')).toBe('authorization_code')
    // ⛔ MUST BE BYTE-IDENTICAL to the authorize call, or Google returns redirect_uri_mismatch AFTER
    // the visitor has already chosen their account — the worst place to fail.
    expect(body!.get('redirect_uri')).toBe('https://eno.vn/auth/google/callback')
  })

  it('reports, never throws, on an HTTP error / bad JSON / network failure', async () => {
    const { exchangeCodeForIdToken } = await load()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as unknown as Response))
    expect(await exchangeCodeForIdToken('c', 'https://eno.vn', 'v')).toEqual({ ok: false, reason: 'http_error' })

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => { throw new Error('nope') } }) as unknown as Response))
    expect(await exchangeCodeForIdToken('c', 'https://eno.vn', 'v')).toEqual({ ok: false, reason: 'no_id_token' })

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response))
    expect(await exchangeCodeForIdToken('c', 'https://eno.vn', 'v')).toEqual({ ok: false, reason: 'no_id_token' })

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await exchangeCodeForIdToken('c', 'https://eno.vn', 'v')).toEqual({ ok: false, reason: 'network' })
  })

  it('⚠️ REFUSES WITHOUT A SECRET RATHER THAN CALLING GOOGLE UNAUTHENTICATED', async () => {
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const { exchangeCodeForIdToken } = await load()
    expect(await exchangeCodeForIdToken('c', 'https://eno.vn', 'v')).toEqual({ ok: false, reason: 'not_configured' })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('AUTH_EXTRA_HOSTS', () => {
  const req = (host: string) =>
    new Request('https://ignored/auth/google/start', { headers: { host } })

  it('⛔ IS INERT WHEN UNSET — production must behave exactly as before it existed', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_EXTRA_HOSTS', '')
    const { canonicalAuthOrigin } = await load()
    // An unlisted host falls back to NEXT_PUBLIC_APP_URL, which is the pre-existing behaviour.
    expect(canonicalAuthOrigin(req('vn-test.eno.vn'))).toBe('https://eno.vn')
    expect(canonicalAuthOrigin(req('eno.vn'))).toBe('https://eno.vn')
  })

  it('lets a named pre-cutover host own its own round-trip', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_EXTRA_HOSTS', 'vn-test.eno.vn')
    const { canonicalAuthOrigin } = await load()
    expect(canonicalAuthOrigin(req('vn-test.eno.vn'))).toBe('https://vn-test.eno.vn')
  })

  it('⚠️ MATCHES EXACTLY, NEVER BY SUFFIX — an allow-list that suffix-matches is an open door', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_EXTRA_HOSTS', 'vn-test.eno.vn')
    const { canonicalAuthOrigin } = await load()
    // The classic bypass: register a host that ENDS WITH the allowed value.
    expect(canonicalAuthOrigin(req('evil-vn-test.eno.vn'))).toBe('https://eno.vn')
    expect(canonicalAuthOrigin(req('vn-test.eno.vn.attacker.test'))).toBe('https://eno.vn')
  })

  it('tolerates whitespace and case, and ignores empty entries', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_EXTRA_HOSTS', ' VN-Test.eno.vn , , ')
    const { canonicalAuthOrigin } = await load()
    expect(canonicalAuthOrigin(req('vn-test.eno.vn'))).toBe('https://vn-test.eno.vn')
  })
})
