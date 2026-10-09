import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A SHARE HANDS OVER WHAT ITS TAP NAMED (gate review, 2026-10-09). The phone is optional since A3 (owner, 2026-10-08),
 * so a teacher with none shares "email & CV" — and this route read the CURRENT private row, so a phone added later (to
 * switch staff calls on) silently reached every school shared with before. The phone leaves only while the share's
 * `phoneShared` (TeacherContactShare) says its tap included it; the email and CV are served either way.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ phoneShared: true }))

vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => ({ id: 'school-1', accountType: 'business' }),
  getCurrentProfileId: async () => 'school-1',
  getAdmin: async () => null,
  isAdminEmail: () => false,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { set: async () => 'OK' } }))
vi.mock('@/lib/enforcement', () => ({ conversationGate: async () => null }))
vi.mock('@/lib/user-blocks', () => ({ isBlockedBetween: async () => false }))
vi.mock('@/lib/teachers/share', () => ({
  teacherThread: async () => ({
    convo: { listingId: 'L-teacher' }, teacherProfileId: 'tp-1', teacherUserId: 'teacher-1', recruiterUserId: 'school-1',
    shared: true, shareOn: true, profileLive: true, hasPhone: true, phoneShared: h.phoneShared,
  }),
}))
vi.mock('@/lib/db', () => ({
  db: {
    // The CURRENT private row — here with a phone the teacher added AFTER their share.
    teacherPrivate: { findUnique: async () => ({ phone: '+84 90 123 4567', email: 't@example.com', cvPath: 'cv/tp-1.pdf' }) },
    contactReveal: { createMany: async () => ({ count: 1 }) },
  },
}))

const { GET } = await import('./route')
const read = async () => {
  const res = await GET(new Request('https://eno.vn/api/teachers/contact?conversationId=c1') as never, {} as never)
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => { h.phoneShared = true })

describe('GET /api/teachers/contact — the phone only when the share included it', () => {
  it('⛔ an "email & CV" share withholds a phone added since — the email and CV are still served', async () => {
    h.phoneShared = false
    const { status, body } = await read()
    expect(status).toBe(200)
    expect(body).toEqual({ phone: null, email: 't@example.com', hasCv: true })
    expect(JSON.stringify(body)).not.toContain('123 4567')
  })

  it('a share whose tap included the phone serves it (every share made before 2026-10-09 is one)', async () => {
    const { status, body } = await read()
    expect(status).toBe(200)
    expect(body).toEqual({ phone: '+84 90 123 4567', email: 't@example.com', hasCv: true })
  })
})
