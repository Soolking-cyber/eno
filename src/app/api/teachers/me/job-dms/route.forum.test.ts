import { beforeEach, describe, expect, it, vi } from 'vitest'

// THE SAME ENDPOINT ON eno.forum (codex, gate 5c): the jobs desk runs on eno.vn only, so the forum reads no switch and
// takes no ON — but an OFF always goes through. (The marketplace contract is route.test.ts.)
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
vi.mock('@/lib/edition', async (orig) => ({ ...(await orig<Record<string, unknown>>()), IS_MARKETPLACE: false }))
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
  h.result = { ...STATE, on: false, current: false }
})

describe('/api/teachers/me/job-dms on eno.forum', () => {
  it('reads no switch', async () => {
    expect((await get()).status).toBe(404)
    expect(h.reads).toEqual([])
  })
  it('takes no ON', async () => {
    expect((await post(ON)).status).toBe(404)
    expect(h.sets).toEqual([])
  })
  it('always takes an OFF', async () => {
    expect((await post({ on: false })).status).toBe(200)
    expect(h.sets).toEqual([{ profileId: 'p-b', on: false, notice: null }])
  })
})
