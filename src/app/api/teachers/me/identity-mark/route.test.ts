import { beforeEach, describe, expect, it, vi } from 'vitest'

// PUT /api/teachers/me/identity-mark — the "Identity verified" switch's OWN endpoint (owner, 2026-10-15; plan review R2).
// Pinned: only the signed-in account's own switch (auth 'profile' — the profile comes from the session, never the body);
// the body is validated (OFF needs nothing and ignores anything else; ON needs a base — the notice may be missing, which is
// the save's "reload" answer); the two 409s map (notice_changed with notice 'identity', identity_mark_changed); no profile
// is 404; and the answer carries ONLY `{ identityMark: { shown, reason }, stamps: { at, withdrawnAt } }`.
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  /** The limiter: its calls, its answer, and whether it is down. */
  rl: [] as unknown[][],
  rlOk: true,
  rlThrows: false,
  me: { id: 'p-b' } as Row | null,
  calls: [] as Array<{ profileId: string; req: Row }>,
  result: null as Row | null,
  throws: null as unknown,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => h.me?.id ?? null, getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (...a: unknown[]) => { h.rl.push(a); if (h.rlThrows) throw new Error('limiter down'); return { success: h.rlOk, resetSec: 0 } },
  kv: { set: async () => 'OK', get: async () => null },
}))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/teachers/publish', () => {
  class TeacherNoticeChangedError extends Error { constructor(public notice: string) { super('notice_changed') } }
  class TeacherIdentityMarkConflictError extends Error { constructor() { super('identity_mark_changed') } }
  return {
    TeacherNoticeChangedError, TeacherIdentityMarkConflictError,
    saveTeacherIdentityMark: async (profileId: string, req: Row) => {
      h.calls.push({ profileId, req })
      if (h.throws) throw h.throws
      return h.result
    },
  }
})

const { PUT } = await import('./route')
const { TeacherNoticeChangedError, TeacherIdentityMarkConflictError } = await import('@/lib/teachers/publish')
const put = async (body: unknown) => {
  const res = await PUT(new Request('https://eno.vn/api/teachers/me/identity-mark', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }) as never, {} as never)
  return { status: res.status, body: (await res.json()) as Row }
}
const STAMPS = { at: '2026-10-16T01:00:00.000Z', withdrawnAt: null }
const ON = { on: true, notice: '2026-10-16', base: { at: null, withdrawnAt: null } }

beforeEach(() => {
  h.me = { id: 'p-b' }; h.calls = []; h.throws = null
  h.rl = []; h.rlOk = true; h.rlThrows = false
  h.result = { identityMark: { shown: true, reason: null }, stamps: STAMPS }
})

describe('PUT /api/teachers/me/identity-mark', () => {
  it('needs a signed-in account — and never saves without one', async () => {
    h.me = null
    expect((await put({ on: false })).status).toBe(401)
    expect(h.calls).toEqual([])
  })

  it('⛔ OFF needs nothing else and ignores anything else — the switch-off always reaches the save', async () => {
    for (const body of [{ on: false }, { on: false, notice: 'old', base: 'junk', profileId: 'p-a' }]) {
      h.calls = []
      const r = await put(body)
      expect(r.status).toBe(200)
      expect(h.calls).toEqual([{ profileId: 'p-b', req: { on: false } }])
    }
  })

  // Commit gate, 2026-10-16: OFF shared a strict 60/h bucket with ON — a spent bucket, or a limiter that errors, would
  // have answered 429/500 to a withdrawal and left the public claim up.
  it('⛔ a withdrawal is NEVER rate-limited — it saves with the bucket spent and with the limiter down', async () => {
    h.rlOk = false
    expect((await put({ on: false })).status).toBe(200)
    h.rlThrows = true
    expect((await put({ on: false })).status).toBe(200)
    expect(h.rl).toEqual([])
    expect(h.calls).toHaveLength(2)
  })

  it('switching ON is capped (60 an hour, strict, per account) — a spent bucket is 429 and saves nothing', async () => {
    h.rlOk = false
    expect((await put(ON)).status).toBe(429)
    expect(h.calls).toEqual([])
    expect(h.rl[0]).toEqual(['teacher-identity-mark', 'p-b', 60, '1 h', { strict: true }])
  })

  it('ON hands the notice and the base through, for the SESSION\'s account — never one named in the body', async () => {
    const r = await put({ ...ON, profileId: 'p-a' })
    expect(r.status).toBe(200)
    expect(h.calls).toEqual([{ profileId: 'p-b', req: { on: true, notice: '2026-10-16', base: { at: null, withdrawnAt: null } } }])
  })

  it('ON with no notice still reaches the save — whose answer is the "reload" one, 409 notice_changed naming the identity notice', async () => {
    h.throws = new TeacherNoticeChangedError('identity')
    const r = await put({ on: true, base: { at: null, withdrawnAt: null } })
    expect(h.calls[0].req).toEqual({ on: true, notice: null, base: { at: null, withdrawnAt: null } })
    expect(r).toEqual({ status: 409, body: { error: 'notice_changed', notice: 'identity' } })
  })

  it('⛔ a stale base → 409 identity_mark_changed', async () => {
    h.throws = new TeacherIdentityMarkConflictError()
    expect(await put(ON)).toEqual({ status: 409, body: { error: 'identity_mark_changed' } })
  })

  it('no teacher profile → 404 teacher_profile_missing', async () => {
    h.result = null
    expect(await put({ on: false })).toEqual({ status: 404, body: { error: 'teacher_profile_missing' } })
  })

  it.each([
    ['not JSON', '{nope'],
    ['no switch', {}],
    ['a switch that is not a boolean', { on: 'true', notice: '2026-10-16', base: { at: null, withdrawnAt: null } }],
    ['ON with no base', { on: true, notice: '2026-10-16' }],
    ['ON with a base that is not a pair of stamps', { on: true, notice: '2026-10-16', base: { at: 'yesterday', withdrawnAt: null } }],
    ['ON with half a base', { on: true, notice: '2026-10-16', base: { at: null } }],
    ['a notice that is not text', { on: true, notice: 20261016, base: { at: null, withdrawnAt: null } }],
  ])('%s → 400 bad_request, nothing saved', async (_name, body) => {
    expect(await put(body)).toEqual({ status: 400, body: { error: 'bad_request' } })
    expect(h.calls).toEqual([])
  })

  it('⛔ the answer carries ONLY { identityMark: { shown, reason }, stamps: { at, withdrawnAt } } — whatever else the save held', async () => {
    h.result = {
      identityMark: { shown: false, reason: 'name_mismatch', name: 'ERIKSSON' }, stamps: { ...STAMPS, version: '2026-10-16' },
      listingId: 'L1', districts: ['d7'], fullName: 'Anna Eriksson',
    }
    const r = await put(ON)
    expect(r).toEqual({ status: 200, body: { identityMark: { shown: false, reason: 'name_mismatch' }, stamps: STAMPS } })
  })

  it('anything else thrown is the generic 500, never its text', async () => {
    h.throws = new Error('connection string postgres://secret@db')
    expect(await put({ on: false })).toEqual({ status: 500, body: { error: 'internal_error' } })
  })
})
