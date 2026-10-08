import { beforeEach, describe, expect, it, vi } from 'vitest'

// PUT /api/teachers/me — the profile the form was loaded for (2026-10-07). A form opened as one account and still open when
// the session became another (a sign-in in another tab) must never write that account's profile: its cover and video bases
// could coincide. ⛔ A save names the profile it edits, or claims there is none — never neither (gate review, 2026-10-08):
// edit mode sends the TeacherProfile id it loaded; a body with none (the join form's null, a tab from before the field) may
// only create.
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  me: { id: 'p-b', accountType: 'individual', email: 'b@example.com' } as Row,
  mine: { id: 'tp-b' } as Row | null,
  saved: [] as Row[],
  opts: [] as unknown[],
  changedUnderLock: false, // the save's own check under the account lock refuses (publish.ts TeacherProfileChangedError)
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => h.me.id, getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { set: async () => 'OK', get: async () => null } }))
vi.mock('@/lib/db', () => ({ db: { teacherProfile: { findUnique: async () => h.mine } } }))
vi.mock('@/lib/publish-guard', () => ({ PublishBlockedError: class extends Error {} }))
vi.mock('@/lib/teachers/publish', () => {
  class E extends Error {}
  // Its own class: the route tests the other errors first, and a shared one would be caught as a validation error.
  class TeacherProfileChangedError extends Error {}
  return {
    TeacherCoverConflictError: E, TeacherValidationError: E, TeacherVideoConflictError: E, TeacherVideoStoreError: E, TeacherProfileChangedError,
    deleteTeacherProfile: async () => true,
    saveTeacherProfile: async (_p: Row, body: Row, opts?: unknown) => {
      h.opts.push(opts)
      if (h.changedUnderLock) throw new TeacherProfileChangedError()
      h.saved.push(body)
      return { listingId: 'L1', created: false, live: true, cover: null, video: null }
    },
  }
})

const { GET, PUT } = await import('./route')
const put = (body: Row) => PUT(new Request('https://eno.vn/api/teachers/me', { method: 'PUT', body: JSON.stringify(body) }) as never, {} as never)

beforeEach(() => { h.mine = { id: 'tp-b' }; h.saved = []; h.opts = []; h.changedUnderLock = false })

describe('PUT /api/teachers/me — the profile the form was loaded for', () => {
  it('saves when the form names this account\'s profile', async () => {
    expect((await put({ fullName: 'B', teacherProfileId: 'tp-b' })).status).toBe(200)
    expect(h.saved).toHaveLength(1)
  })
  it('⛔ refuses a form loaded for ANOTHER profile — nothing is written', async () => {
    const res = await put({ fullName: 'A', teacherProfileId: 'tp-a' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'profile_changed' })
    expect(h.saved).toEqual([])
  })
  it('refuses a named profile when this account has none (deleted elsewhere)', async () => {
    h.mine = null
    expect((await put({ fullName: 'A', teacherProfileId: 'tp-a' })).status).toBe(409)
    expect(h.saved).toEqual([])
  })
  it('⛔ a body with NO id never writes an existing profile — an edit tab from before the field, opened as A, saving as B', async () => {
    const res = await put({ fullName: 'A' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'profile_changed' })
    expect(h.opts).toEqual([]) // the save is never called
  })
  it('the join form\'s null claims there is none: refused over an existing profile, like no id at all', async () => {
    for (const teacherProfileId of [null, 42]) { // a non-string id is no claim to a profile either
      expect((await put({ fullName: 'B', teacherProfileId })).status).toBe(409)
    }
    expect(h.opts).toEqual([])
  })
  it('no profile yet: a body with no id, or null, may CREATE — and the save re-checks "none" under the lock', async () => {
    h.mine = null
    expect((await put({ fullName: 'B' })).status).toBe(200)
    expect((await put({ fullName: 'B', teacherProfileId: null })).status).toBe(200)
    expect(h.saved).toHaveLength(2)
    expect(h.opts).toEqual([{ expectTeacherProfileId: null }, { expectTeacherProfileId: null }])
  })
  it('⛔ hands the loaded profile to the save, which re-checks it UNDER THE LOCK — the read above is only the fast path', async () => {
    await put({ fullName: 'B', teacherProfileId: 'tp-b' })
    expect(h.opts).toEqual([{ expectTeacherProfileId: 'tp-b' }])
  })
  it('a change the fast path missed (deleted, made or re-made before the lock) is the same 409 profile_changed', async () => {
    h.changedUnderLock = true
    const res = await put({ fullName: 'B', teacherProfileId: 'tp-b' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'profile_changed' })
    // …and for a "none" claim, when another window made a profile in between.
    h.mine = null
    expect((await put({ fullName: 'B', teacherProfileId: null })).status).toBe(409)
    expect(h.saved).toEqual([])
  })
})

// What the edit form reads on load (teacher-form): the TeacherProfile id it then names on every save and Remove, the video
// base, the visibility choice, the public URL — and only WHETHER a private video exists, never its path (gate review,
// 2026-10-08: "if GET does not return the id, every edit save is refused" — it does, and this pins it).
describe('GET /api/teachers/me — what the edit form loads', () => {
  it('returns the id and the video state the form saves against — never the private path', async () => {
    h.mine = {
      id: 'tp-b', videoUrl: null, videoOnRequest: true, videoVersion: 7, status: 'live', fullName: 'B',
      private: { phone: '+84901234567', cvFileName: null, videoPath: 'p-b/intro.mp4' }, listing: { status: 'active', verified: true },
    }
    const res = await GET(new Request('https://eno.vn/api/teachers/me') as never, {} as never)
    const body = await res.json()
    expect(body.teacher).toMatchObject({ id: 'tp-b', videoVersion: 7, videoOnRequest: true, videoUrl: null, hasPrivateVideo: true, listingLive: true })
    expect(JSON.stringify(body)).not.toContain('intro.mp4')
  })
})
