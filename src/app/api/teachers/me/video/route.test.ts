import { beforeEach, describe, expect, it, vi } from 'vitest'

// The teacher's OWN private intro video (2026-10-07): watch it (GET, a 10-minute signed link, never cached) and remove it
// (DELETE, under the version the form loaded).
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  me: { id: 'teacher-1', accountType: 'individual', email: 't@example.com' } as Row,
  videoPath: 'teacher-1/aaaa.mp4' as string | null,
  signed: 'https://sb.eno.vn/storage/v1/object/sign/teacher-videos/teacher-1/aaaa.mp4?token=x' as string | null,
  signedPaths: [] as string[],
  deleted: [] as Row[],
  conflict: false,
  deleteAnswer: { onRequest: true, version: 4, hasPrivate: false, url: null } as Row | null,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => h.me.id, getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { set: async () => 'OK', get: async () => null } }))
vi.mock('@/lib/db', () => ({
  db: { teacherProfile: { findUnique: async ({ where }: Row) => (where.profileId === h.me.id ? { id: 'tp-teacher-1', private: h.videoPath ? { videoPath: h.videoPath } : { videoPath: null } } : null) } },
}))
vi.mock('@/lib/teachers/video-store', () => ({ signTeacherVideo: async (p: string) => { h.signedPaths.push(p); return h.signed } }))
vi.mock('@/lib/teachers/publish', () => {
  class TeacherVideoConflictError extends Error {}
  return {
    TeacherVideoConflictError,
    deleteTeacherVideo: async (profileId: string, base: number | null, tp: string) => {
      h.deleted.push({ profileId, base, tp })
      if (h.conflict) throw new TeacherVideoConflictError()
      return h.deleteAnswer
    },
  }
})

const { GET, DELETE } = await import('./route')
const get = () => GET(new Request('https://eno.vn/api/teachers/me/video') as never, {} as never)
const del = (qs: string) => DELETE(new Request(`https://eno.vn/api/teachers/me/video${qs}`, { method: 'DELETE' }) as never, {} as never)

beforeEach(() => {
  h.videoPath = 'teacher-1/aaaa.mp4'; h.signed = 'https://sb.eno.vn/storage/v1/object/sign/teacher-videos/teacher-1/aaaa.mp4?token=x'
  h.signedPaths = []; h.deleted = []; h.conflict = false; h.deleteAnswer = { onRequest: true, version: 4, hasPrivate: false, url: null }
})

describe('the teacher watches their own private video', () => {
  it('gets a 10-minute link to THEIR video, never cached', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ url: h.signed, expiresIn: 600 })
    expect(h.signedPaths).toEqual(['teacher-1/aaaa.mp4'])
  })
  it('no private video: 404; the store failing: 502, never an empty link', async () => {
    h.videoPath = null
    expect((await get()).status).toBe(404)
    h.videoPath = 'teacher-1/aaaa.mp4'; h.signed = null
    expect((await get()).status).toBe(502)
  })
})

describe('the teacher removes it', () => {
  it('passes the loaded version AND profile through (re-checked under the lock), and answers the video as it now is', async () => {
    const res = await del('?base=3&tp=tp-teacher-1')
    expect(res.status).toBe(200)
    expect(h.deleted).toEqual([{ profileId: 'teacher-1', base: 3, tp: 'tp-teacher-1' }])
    expect(((await res.json()) as Row).video).toEqual({ onRequest: true, version: 4, hasPrivate: false, url: null })
  })
  it('a missing or malformed base is no base (the server then refuses any change); a stale one is 409; nothing to remove is 404', async () => {
    await del('?base=abc&tp=tp-teacher-1'); await del('?tp=tp-teacher-1')
    expect(h.deleted.map((d) => d.base)).toEqual([null, null])
    h.conflict = true
    expect((await del('?base=2&tp=tp-teacher-1')).status).toBe(409)
    h.conflict = false; h.deleteAnswer = null
    expect((await del('?base=3&tp=tp-teacher-1')).status).toBe(404)
  })
  it('⛔ never removes ANOTHER account\'s video: a form loaded as someone else (a session switched in another tab) is refused', async () => {
    expect((await del('?base=3&tp=tp-someone-else')).status).toBe(409)
    expect((await del('?base=3')).status).toBe(400) // the profile it was loaded for is required
    expect(h.deleted).toEqual([])
  })
  it('a profile change the fast path missed is refused under the lock: the same 409 video_changed', async () => {
    h.conflict = true // deleteTeacherVideo: another profile under the lock (publish.ts)
    const res = await del('?base=3&tp=tp-teacher-1')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'video_changed' })
  })
})
