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
  noticeChanged: null as string | null, // the save refuses an older notice (publish.ts TeacherNoticeChangedError)
  decision: { ok: true } as Row,
  decisionFails: false, // the identity-gate read throws (a failed query)
  logged: [] as unknown[],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/log', () => ({ logError: (e: unknown) => { h.logged.push(e) } }))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => h.me.id, getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { set: async () => 'OK', get: async () => null } }))
vi.mock('@/lib/db', () => ({ db: { teacherProfile: { findUnique: async () => h.mine } } }))
vi.mock('@/lib/publish-guard', () => ({ PublishBlockedError: class extends Error {} }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({
  sellerPublishDecision: async () => { if (h.decisionFails) throw new Error('identity_verifications: connection reset'); return h.decision },
}))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: (u: unknown) => typeof u === 'string' && u.startsWith('https://sb.eno.vn/storage/v1/object/public/listings/') }))
vi.mock('@/lib/teachers/publish', () => {
  class E extends Error {}
  // Its own class: the route tests the other errors first, and a shared one would be caught as a validation error.
  class TeacherProfileChangedError extends Error {}
  class TeacherNoticeChangedError extends Error { constructor(public notice: string) { super('notice_changed') } }
  return {
    TeacherCoverConflictError: E, TeacherValidationError: E, TeacherVideoConflictError: E, TeacherVideoStoreError: E, TeacherProfileChangedError,
    TeacherNoticeChangedError,
    deleteTeacherProfile: async () => true,
    saveTeacherProfile: async (_p: Row, body: Row, opts?: unknown) => {
      h.opts.push(opts)
      if (h.changedUnderLock) throw new TeacherProfileChangedError()
      if (h.noticeChanged) throw new TeacherNoticeChangedError(h.noticeChanged)
      h.saved.push(body)
      return { listingId: 'L1', created: false, live: true, noGoal: false, cover: null, video: null }
    },
  }
})

const { GET, PUT } = await import('./route')
/** Every save of this release carries the teach-area list (the v2 shape) — `old: true` sends one without it. */
const put = (body: Row, { old = false } = {}) =>
  PUT(new Request('https://eno.vn/api/teachers/me', { method: 'PUT', body: JSON.stringify(old ? body : { teachAreas: ['online'], ...body }) }) as never, {} as never)
const get = async () => (await GET(new Request('https://eno.vn/api/teachers/me') as never, {} as never)).json()

beforeEach(() => {
  h.mine = { id: 'tp-b' }; h.saved = []; h.opts = []; h.changedUnderLock = false; h.noticeChanged = null; h.decision = { ok: true }
  h.decisionFails = false; h.logged = []
  h.me = { id: 'p-b', accountType: 'individual', email: 'b@example.com' }
})

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
  it('⛔ ONE SHAPE: a body with no teach-area list (a tab from before the redesign) is 409 profile_changed — never saved, edit or create', async () => {
    let res = await put({ fullName: 'B', teacherProfileId: 'tp-b', preferredCities: ['ha-noi'] }, { old: true })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'profile_changed' })
    h.mine = null
    res = await put({ fullName: 'B', teacherProfileId: null, preferredCities: ['ha-noi'] }, { old: true })
    expect(res.status).toBe(409)
    expect(h.opts).toEqual([]) // the save is never called
  })
  it('maps an older Publish / cover / AI notice to 409 notice_changed, naming which', async () => {
    h.noticeChanged = 'publish'
    const res = await put({ fullName: 'B', teacherProfileId: 'tp-b' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'notice_changed', notice: 'publish' })
    expect(h.saved).toEqual([])
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
    const body = await get()
    expect(body.teacher).toMatchObject({ id: 'tp-b', videoVersion: 7, videoOnRequest: true, videoUrl: null, hasPrivateVideo: true, listingLive: true })
    expect(JSON.stringify(body)).not.toContain('intro.mp4')
  })
  it('⛔ returns a not-yet-migrated row AS STORED — no runtime adapter re-reads the old columns (D1)', async () => {
    h.mine = { id: 'tp-b', situationVersion: null, teachAreas: [], preferredCities: ['ha-noi'], private: null, listing: null }
    const body = await get()
    expect(body.teacher).toMatchObject({ situationVersion: null, teachAreas: [], preferredCities: ['ha-noi'] })
  })
  it('says whether the account may publish — the identity check shows at the top of the last step, not as a refusal at the tap', async () => {
    h.decision = { ok: false, code: 'identity_unverified' }
    expect((await get()).publishGate).toEqual({ ok: false, code: 'identity_unverified' })
    h.mine = null
    expect((await get()).publishGate).toEqual({ ok: false, code: 'identity_unverified' })
    h.decision = { ok: true }
    expect((await get()).publishGate).toEqual({ ok: true, code: null })
  })
  it('⛔ a failed identity-gate read never takes the edit page down — `publishGate: null` (not known), logged (gate review, 2026-10-09)', async () => {
    h.decisionFails = true
    h.mine = { id: 'tp-b', fullName: 'B', private: null, listing: { status: 'active', verified: true } }
    const body = await get()
    expect(body.teacher).toMatchObject({ id: 'tp-b', fullName: 'B' })
    expect(body.publishGate).toBeNull()
    expect(h.logged).toHaveLength(1)
    h.mine = null // the join form's read too
    expect(await get()).toMatchObject({ teacher: null, publishGate: null })
  })
})

describe('GET /api/teachers/me — no profile yet: what the new form may start from', () => {
  it('offers the account name, its photo only when stored on eno.vn, and its (auth-verified) phone', async () => {
    h.mine = null
    h.me = { ...h.me, displayName: 'Bea', avatarUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp', phone: '+84901234567' }
    expect(await get()).toMatchObject({ teacher: null, prefill: { displayName: 'Bea', avatarUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp', phone: '+84901234567' } })
    h.me = { ...h.me, avatarUrl: 'https://lh3.googleusercontent.com/a/photo' } // a Google photo is not a listing photo
    expect((await get()).prefill.avatarUrl).toBeNull()
  })
  it('never prefills over an existing profile', async () => {
    h.mine = { id: 'tp-b', private: null, listing: null }
    expect(await get()).not.toHaveProperty('prefill')
  })
})
