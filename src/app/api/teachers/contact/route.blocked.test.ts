import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A block also closes a teacher share made BEFORE it (App Store gate `ugc-safety`).
 * /api/teachers/share already refuses a NEW share across a block; these two reads served the phone,
 * email and CV of a share that predated the block, so a teacher who blocked a recruiter kept handing
 * them over. Gate off: nothing changes and no block is looked up.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ blocked: false, lookups: 0 }))

vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => ({ id: 'recruiter-1', accountType: 'business' }),
  getCurrentProfileId: async () => 'recruiter-1',
  getAdmin: async () => null,
  isAdminEmail: () => false,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { set: async () => 'OK' } }))
vi.mock('@/lib/enforcement', () => ({ conversationGate: async () => null }))
vi.mock('@/lib/teachers/share', () => ({
  teacherThread: async () => ({
    convo: { listingId: 'L-teacher' }, teacherProfileId: 'tp-1', teacherUserId: 'teacher-1', recruiterUserId: 'recruiter-1', shared: true, shareOn: true, profileLive: true,
    // A share whose tap included the phone (route.phone.test.ts covers one that did not — gate review, 2026-10-09).
    hasPhone: true, phoneShared: true,
  }),
}))
vi.mock('@/lib/teachers/cv-store', () => ({ signTeacherCv: async () => 'https://storage.example/cv.pdf?sig=1' }))
vi.mock('@/lib/db', () => ({
  db: {
    teacherPrivate: { findUnique: async () => ({ phone: '+84900000000', email: 't@example.com', cvPath: 'cv/tp-1.pdf', cvFileName: 'cv.pdf' }) },
    contactReveal: { createMany: async () => ({ count: 1 }) },
    forumUserBlock: { findFirst: async () => { h.lookups++; return h.blocked ? { blockerProfileId: 'teacher-1' } : null } },
    profile: { findUnique: async () => ({ email: 'someone@example.com' }) },
  },
}))

const contact = await import('./route')
const cv = await import('../cv/route')

const req = (path: string) => new Request(`https://www.eno.forum${path}?conversationId=c1`) as never

beforeEach(() => { h.blocked = false; h.lookups = 0 })
afterEach(() => vi.unstubAllEnvs())

describe('teacher contact + CV across a block', () => {
  it('gate OFF: a stored block changes nothing and is never looked up', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    h.blocked = true
    expect((await contact.GET(req('/api/teachers/contact'), {} as never)).status).toBe(200)
    expect((await cv.GET(req('/api/teachers/cv'), {} as never)).status).toBe(302)
    expect(h.lookups).toBe(0)
  })

  it('gate ON, no block: the share is served as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    const res = await contact.GET(req('/api/teachers/contact'), {} as never)
    expect(res.status).toBe(200)
    expect(((await res.json()) as Row).phone).toBe('+84900000000')
  })

  it('gate ON, blocked (either way): 403 blocked, nothing of the share leaves the server', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.blocked = true
    const res = await contact.GET(req('/api/teachers/contact'), {} as never)
    expect(res.status).toBe(403)
    const body = (await res.json()) as Row
    expect(body).toEqual({ error: 'blocked' })
    const file = await cv.GET(req('/api/teachers/cv'), {} as never)
    expect(file.status).toBe(403)
    expect(file.headers.get('location')).toBeNull()
  })
})
