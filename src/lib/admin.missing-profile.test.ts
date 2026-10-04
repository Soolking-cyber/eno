import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js'

/**
 * missingProfileReason — WHY getCurrentProfile() came back null (inbox-10). A 401 from /api/dashboard makes
 * the page say "your session has expired" and sign the person out, so 'none' must mean exactly that: no
 * session, or one the auth server REFUSED. Anything the server could not answer is 'unavailable' (503 →
 * Retry). Real auth-js error instances, so the type guards are exercised as shipped.
 */

const h = vi.hoisted(() => ({
  result: { data: { user: null }, error: null } as { data: { user: unknown }; error: unknown },
  throws: false,
  bearer: undefined as string | undefined,
  getUserArgs: [] as unknown[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: {
      getUser: async (jwt?: string) => {
        h.getUserArgs.push(jwt)
        if (h.throws) throw new Error('boom')
        return h.result
      },
    },
  }),
}))
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => (k === 'authorization' && h.bearer ? `Bearer ${h.bearer}` : null) }),
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/profile', () => ({ ensureProfile: async () => null }))
vi.mock('@/lib/trust', () => ({ recordPhoneVerified: async () => {}, BASE_SCORE: 60, PHONE_VERIFIED_BONUS: 10 }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { missingProfileReason } = await import('./admin')

beforeEach(() => {
  h.result = { data: { user: null }, error: null }
  h.throws = false
  h.bearer = undefined
  h.getUserArgs = []
})

describe("'none' — there is no session to resolve (→ 401, sign in again)", () => {
  it('no cookie, no bearer: the session is missing', async () => {
    h.result = { data: { user: null }, error: new AuthSessionMissingError() }
    expect(await missingProfileReason()).toBe('none')
  })

  it('no user and no error at all', async () => {
    expect(await missingProfileReason()).toBe('none')
  })

  it('the auth server REFUSED the token: a 401 or 403, whatever its code', async () => {
    for (const [status, code] of [[401, 'bad_jwt'], [401, undefined], [403, 'session_not_found'], [403, undefined]] as const) {
      h.result = { data: { user: null }, error: new AuthApiError('refused', status, code) }
      expect(await missingProfileReason()).toBe('none')
    }
  })

  it('an explicit session-gone code, whatever status carries it', async () => {
    for (const [status, code] of [[400, 'refresh_token_not_found'], [404, 'user_not_found'], [400, 'session_expired'], [400, 'session_not_found'], [400, 'bad_jwt']] as const) {
      h.result = { data: { user: null }, error: new AuthApiError('gone', status, code) }
      expect(await missingProfileReason()).toBe('none')
    }
  })
})

describe("'unavailable' — the auth server could not be asked (→ 503, Retry)", () => {
  it('⛔ a network failure is never "your session expired"', async () => {
    h.result = { data: { user: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) }
    expect(await missingProfileReason()).toBe('unavailable')
  })

  it('⛔ a 4xx that only says "not now" — rate-limited (429), timed out (408), or anything not a token refusal', async () => {
    for (const status of [408, 429, 409, 422, 400, 404]) {
      h.result = { data: { user: null }, error: new AuthApiError('not now', status, undefined) }
      expect(await missingProfileReason()).toBe('unavailable')
    }
  })

  it('⛔ the refresh-rotation race (400 refresh_token_already_used) — the session may be fine, so never "expired"', async () => {
    h.result = { data: { user: null }, error: new AuthApiError('Invalid Refresh Token: Already Used', 400, 'refresh_token_already_used') }
    expect(await missingProfileReason()).toBe('unavailable')
  })

  it('a 5xx from the auth server', async () => {
    h.result = { data: { user: null }, error: new AuthApiError('upstream', 500, undefined) }
    expect(await missingProfileReason()).toBe('unavailable')
    h.result = { data: { user: null }, error: new AuthRetryableFetchError('Bad gateway', 502) }
    expect(await missingProfileReason()).toBe('unavailable')
  })

  it('a second look finds the session after all — the first miss was transient', async () => {
    h.result = { data: { user: { id: 'u1' } }, error: null }
    expect(await missingProfileReason()).toBe('unavailable')
  })

  it('the client itself throwing', async () => {
    h.throws = true
    expect(await missingProfileReason()).toBe('unavailable')
  })
})

it('asks with the same identity getCurrentProfile() used — the bearer token when one is sent', async () => {
  h.bearer = 'jwt-1'
  await missingProfileReason()
  expect(h.getUserArgs).toEqual(['jwt-1'])
})
