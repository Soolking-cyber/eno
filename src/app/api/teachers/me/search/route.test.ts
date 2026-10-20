import { beforeEach, describe, expect, it, vi } from 'vitest'

// PUT /api/teachers/me/search — "Hide my profile from search engines" (owner decision 14, 2026-10-20), the switch's OWN
// endpoint. Pinned: only the signed-in account's own row (auth 'profile' — the profile comes from the session, never the
// body); the body is `{ hidden: boolean }` and nothing else is handed on; a HIDE is never rate-limited (a privacy request
// always goes through, with the bucket spent or the limiter down), showing it again is; no profile is 404.
type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  rl: [] as unknown[][],
  rlOk: true,
  rlThrows: false,
  me: { id: 'p-b' } as Row | null,
  calls: [] as Array<[string, boolean]>,
  result: { hidden: true } as { hidden: boolean } | null,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => h.me?.id ?? null, getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (...a: unknown[]) => { h.rl.push(a); if (h.rlThrows) throw new Error('limiter down'); return { success: h.rlOk, resetSec: 0 } },
  kv: { set: async () => 'OK', get: async () => null },
}))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/teachers/search-visibility', () => ({
  setTeacherSearchHidden: async (profileId: string, hidden: boolean) => {
    h.calls.push([profileId, hidden])
    return h.result && { hidden }
  },
}))

const { PUT } = await import('./route')
const put = async (body: unknown) => {
  const res = await PUT(new Request('https://eno.vn/api/teachers/me/search', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }) as never, {} as never)
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => {
  h.me = { id: 'p-b' }; h.calls = []; h.result = { hidden: true }
  h.rl = []; h.rlOk = true; h.rlThrows = false
})

describe('PUT /api/teachers/me/search', () => {
  it('needs a signed-in account — and never saves without one', async () => {
    h.me = null
    expect((await put({ hidden: true })).status).toBe(401)
    expect(h.calls).toEqual([])
  })

  it('saves the SESSION\'s own switch — never a profile named in the body — and answers what was saved', async () => {
    expect(await put({ hidden: true, profileId: 'p-a', listingId: 'L9' })).toEqual({ status: 200, body: { hidden: true } })
    expect(await put({ hidden: false })).toEqual({ status: 200, body: { hidden: false } })
    expect(h.calls).toEqual([['p-b', true], ['p-b', false]])
  })

  it('⛔ a HIDE is never rate-limited — it saves with the bucket spent and with the limiter down', async () => {
    h.rlOk = false
    expect((await put({ hidden: true })).status).toBe(200)
    h.rlThrows = true
    expect((await put({ hidden: true })).status).toBe(200)
    expect(h.rl).toEqual([])
    expect(h.calls).toHaveLength(2)
  })

  it('showing it to search engines again is capped (60 an hour, strict, per account) — a spent bucket is 429 and saves nothing', async () => {
    h.rlOk = false
    expect(await put({ hidden: false })).toEqual({ status: 429, body: { error: 'rate_limited' } })
    expect(h.calls).toEqual([])
    expect(h.rl[0]).toEqual(['teacher-search-visibility', 'p-b', 60, '1 h', { strict: true }])
  })

  it('no teacher profile → 404 teacher_profile_missing', async () => {
    h.result = null
    expect(await put({ hidden: true })).toEqual({ status: 404, body: { error: 'teacher_profile_missing' } })
  })

  it.each([
    ['not JSON', '{nope'],
    ['no switch', {}],
    ['a switch that is not a boolean', { hidden: 'true' }],
    ['a number', { hidden: 1 }],
    ['null', { hidden: null }],
  ])('%s → 400 bad_request, nothing saved', async (_name, body) => {
    expect(await put(body)).toEqual({ status: 400, body: { error: 'bad_request' } })
    expect(h.calls).toEqual([])
  })
})
