import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE WIRE CONTRACT FOR THE FIRST ROUTE MIGRATED TO `route()`.
 *
 * ⚠️ THIS IS A SNAPSHOT OF BEHAVIOUR THAT EXISTED BEFORE THE WRAPPER, NOT A DESCRIPTION OF WHAT IS
 * IDEAL. Every expectation below was captured by running the ORIGINAL hand-written handler and
 * recording status + body for each branch; the migrated version then had to reproduce them exactly.
 * That is the contract for all 167 handlers: adopting `route()` deletes the retyped preamble and
 * changes nothing a client can observe.
 *
 * ⚠️ ONE EXPECTATION HERE IS DELIBERATELY "WRONG", AND CHANGING IT IS A WIRE CHANGE.
 * A MISSING `locale` returns `invalid_locale`, not `bad_request` — because the old code coerced
 * with `String(body.locale || '')` and then failed the membership test. `bad_request` would be the
 * better answer, and giving it now would silently alter what a client sees. That belongs in the
 * consolidation step, with the caller updated in the same commit.
 */

const h = vi.hoisted(() => ({
  userId: null as string | null,
  current: { locale: 'en' } as { locale: string | null } | null,
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: async () => h.userId,
  getCurrentProfile: async () => null,
  getAdmin: async () => null,
}))
vi.mock('@/lib/db', () => ({
  db: {
    profile: {
      findUnique: async () => h.current,
      update: async ({ data }: { data: Record<string, unknown> }) => { h.updates.push(data); return {} },
    },
  },
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, remaining: 9 }) }))

const { POST } = await import('@/app/api/profile/locale/route')

const call = (body: unknown, raw = false) =>
  POST(
    new Request('https://eno.vn/api/profile/locale', {
      method: 'POST',
      body: raw ? (body as string) : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  )

const snap = async (r: Response) => `${r.status} ${await r.text()}`

beforeEach(() => {
  h.userId = 'user-1'
  h.current = { locale: 'en' }
  h.updates = []
})

describe('POST /api/profile/locale — wire snapshot', () => {
  it('a guest gets 401 auth_required', async () => {
    h.userId = null
    expect(await snap(await call({ locale: 'vi' }))).toBe('401 {"error":"auth_required"}')
  })

  it('malformed JSON gets 400 bad_request', async () => {
    expect(await snap(await call('{not json', true))).toBe('400 {"error":"bad_request"}')
  })

  it('an unknown locale gets 400 invalid_locale', async () => {
    expect(await snap(await call({ locale: 'zz' }))).toBe('400 {"error":"invalid_locale"}')
  })

  it('a MISSING locale also gets invalid_locale — preserved from the original', async () => {
    // See the header. `bad_request` would be better and would be a wire change.
    expect(await snap(await call({}))).toBe('400 {"error":"invalid_locale"}')
  })

  it('a changed locale is written and returns ok', async () => {
    h.current = { locale: 'en' }
    expect(await snap(await call({ locale: 'vi' }))).toBe('200 {"ok":true}')
    expect(h.updates).toEqual([{ locale: 'vi' }])
  })

  it('an unchanged locale returns ok WITHOUT writing', async () => {
    // The cheap-read-first optimisation. Losing it would add a write to every language toggle.
    h.current = { locale: 'vi' }
    expect(await snap(await call({ locale: 'vi' }))).toBe('200 {"ok":true}')
    expect(h.updates).toEqual([])
  })
})

describe('the wrapper resolves the caller the CHEAP way', () => {
  it('uses getCurrentProfileId, never getCurrentProfile', async () => {
    // ⚠️ THE REGRESSION THIS GUARDS. `auth: 'profile'` is the wrapper's obvious mode and would work
    // — while silently adding an auth-server round trip, a Profile read and lazy provisioning to a
    // fire-and-forget call the language context makes on every switch. src/lib/admin.ts warns
    // against exactly that. The mock above makes getCurrentProfile return null, so if the route ever
    // switches modes this test fails with a 401 instead of a 200.
    h.userId = 'user-1'
    expect((await call({ locale: 'vi' })).status).toBe(200)
  })
})
