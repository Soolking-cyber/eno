import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET/POST /api/teachers/me/job-dms — the job-messages switch's OWN endpoint (owner, 2026-10-20). Pinned: only the
// signed-in account's own switch (auth 'profile' — never an id from the body); the body is validated (an OFF needs
// nothing and ignores anything else; an ON needs the notice it was shown); an OFF is NEVER rate-limited, an ON is (60 an
// hour, strict); an older notice is 409 notice_changed / 'job_dms', no teacher profile 404; the answer carries ONLY
// { on, noticeVersion, current, teacher }; anything else thrown is the generic 500. The rules themselves are pinned in
// src/lib/teachers/job-dms/consent.test.ts.
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  rl: [] as unknown[][],
  rlOk: true,
  rlThrows: false,
  me: { id: 'p-b' } as Row | null,
  sets: [] as Array<{ profileId: string; on: boolean; notice: unknown }>,
  reads: [] as string[],
  result: null as Row | null,
  throws: null as unknown,
}))
vi.mock('server-only', () => ({}))
// The marketplace edition (route.forum.test.ts is the forum's): the test env's default edition is not pinned.
vi.mock('@/lib/edition', async (orig) => ({ ...(await orig<Record<string, unknown>>()), IS_MARKETPLACE: true }))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => h.me?.id ?? null, getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (...a: unknown[]) => { h.rl.push(a); if (h.rlThrows) throw new Error('limiter down'); return { success: h.rlOk, resetSec: 0 } },
  kv: { set: async () => 'OK', get: async () => null },
}))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/teachers/job-dms/consent', () => {
  class JobDmNoticeChangedError extends Error { constructor() { super('notice_changed') } }
  class JobDmNoTeacherProfileError extends Error { constructor() { super('teacher_profile_missing') } }
  return {
    JobDmNoticeChangedError,
    JobDmNoTeacherProfileError,
    readJobDmState: async (profileId: string) => { h.reads.push(profileId); if (h.throws) throw h.throws; return h.result },
    setJobDmConsent: async (profileId: string, on: boolean, notice: unknown) => {
      h.sets.push({ profileId, on, notice })
      if (h.throws) throw h.throws
      return h.result
    },
  }
})

const { GET, POST } = await import('./route')
const { JobDmNoticeChangedError, JobDmNoTeacherProfileError } = await import('@/lib/teachers/job-dms/consent')
const URL_ = 'https://eno.vn/api/teachers/me/job-dms'
const post = async (body: unknown) => {
  const res = await POST(new Request(URL_, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }) as never, {} as never)
  return { status: res.status, body: (await res.json()) as Row }
}
const get = async () => {
  const res = await GET(new Request(URL_) as never, {} as never)
  return { status: res.status, body: (await res.json()) as Row }
}
const STATE = { on: true, noticeVersion: '2026-10-20', current: true, teacher: true, paused: false }
const ON = { on: true, notice: '2026-10-20' }

beforeEach(() => {
  h.me = { id: 'p-b' }; h.sets = []; h.reads = []; h.throws = null
  h.rl = []; h.rlOk = true; h.rlThrows = false
  h.result = { ...STATE }
})

describe('GET /api/teachers/me/job-dms', () => {
  it('needs a signed-in account', async () => {
    h.me = null
    expect((await get()).status).toBe(401)
    expect(h.reads).toEqual([])
  })
  it('answers the SESSION account’s state — exactly the five fields', async () => {
    h.result = { ...STATE, optInAt: '2026-10-20T03:00:00.000Z', invitedAt: null, profileId: 'p-b' }
    expect(await get()).toEqual({ status: 200, body: STATE })
    expect(h.reads).toEqual(['p-b'])
  })
})

describe('POST /api/teachers/me/job-dms', () => {
  it('needs a signed-in account — and never saves without one', async () => {
    h.me = null
    expect((await post({ on: false })).status).toBe(401)
    expect(h.sets).toEqual([])
  })

  it('an ON hands the shown notice through, for the SESSION’s account — never one named in the body', async () => {
    const r = await post({ ...ON, profileId: 'p-a' })
    expect(r).toEqual({ status: 200, body: STATE })
    expect(h.sets).toEqual([{ profileId: 'p-b', on: true, notice: '2026-10-20' }])
  })

  it('⛔ an OFF needs nothing else and ignores anything else — it always reaches the save, with no notice', async () => {
    h.result = { on: false, noticeVersion: '2026-10-20', current: false, teacher: true }
    for (const body of [{ on: false }, { on: false, notice: 'old', profileId: 'p-a' }, { on: false, notice: 42 }]) {
      h.sets = []
      const r = await post(body)
      expect(r.status, JSON.stringify(body)).toBe(200)
      expect(h.sets).toEqual([{ profileId: 'p-b', on: false, notice: null }])
    }
  })

  it('⛔ an OFF is NEVER rate-limited — it saves with the bucket spent and with the limiter down', async () => {
    h.rlOk = false
    expect((await post({ on: false })).status).toBe(200)
    h.rlThrows = true
    expect((await post({ on: false })).status).toBe(200)
    expect(h.rl).toEqual([])
    expect(h.sets).toHaveLength(2)
  })

  it('an ON is capped (60 an hour, strict, per account) — a spent bucket is 429 and saves nothing', async () => {
    h.rlOk = false
    expect((await post(ON)).status).toBe(429)
    expect(h.sets).toEqual([])
    expect(h.rl[0]).toEqual(['teacher-job-dms', 'p-b', 60, '1 h', { strict: true }])
  })

  it('⛔ a page that showed another notice → 409 notice_changed, naming this notice', async () => {
    h.throws = new JobDmNoticeChangedError()
    expect(await post({ on: true, notice: '2026-10-01' })).toEqual({ status: 409, body: { error: 'notice_changed', notice: 'job_dms' } })
  })

  it('an ON with no teacher profile → 404 teacher_profile_missing', async () => {
    h.throws = new JobDmNoTeacherProfileError()
    expect(await post(ON)).toEqual({ status: 404, body: { error: 'teacher_profile_missing' } })
  })

  it.each([
    ['not JSON', '{nope'],
    ['no switch', {}],
    ['a switch that is not a boolean', { on: 'true', notice: '2026-10-20' }],
    ['an ON with no notice', { on: true }],
    ['an ON whose notice is not text', { on: true, notice: 20261020 }],
    ['an ON with an absurd notice', { on: true, notice: 'x'.repeat(41) }],
  ])('%s → 400 bad_request, nothing saved', async (_name, body) => {
    expect(await post(body)).toEqual({ status: 400, body: { error: 'bad_request' } })
    expect(h.sets).toEqual([])
  })

  it('⛔ the answer carries ONLY { on, noticeVersion, current, teacher } — whatever else the save held', async () => {
    h.result = { ...STATE, optInAt: new Date(), withdrawnAt: null, invitedAt: null, profileId: 'p-b', fullName: 'Anna' }
    expect(await post(ON)).toEqual({ status: 200, body: STATE })
  })

  it('anything else thrown is the generic 500, never its text', async () => {
    h.throws = new Error('connection string postgres://secret@db')
    expect(await post({ on: false })).toEqual({ status: 500, body: { error: 'internal_error' } })
  })
})
