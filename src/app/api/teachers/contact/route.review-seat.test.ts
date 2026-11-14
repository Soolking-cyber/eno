import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A STORE-REVIEW SEAT NEVER READS A TEACHER'S CONTACT OR CV (round 5, 2026-11-14 — codex, round 4;
 * src/lib/review-seat-accounts.ts). A share a teacher made before the seat rules still stands, and these two reads served
 * it: a store seat in that thread got the teacher's phone and email, wrote the reveal ledger, and got a signed CV link.
 * Now both refuse a seat with 403 `forbidden` before anything private is read, signed or written — any seat, in any case,
 * by the Profile row's address. CONTROL: the lawyer's seat (Luật Hoàng Phi — no store seat) and an ordinary school are
 * served exactly as before, with the same existing share.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  email: 'school@example.com' as string | null,
  privateReads: 0,
  reveals: [] as Row[],
  signed: 0,
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => ({ id: 'recruiter-1', accountType: 'business', email: h.email }),
  getCurrentProfileId: async () => 'recruiter-1',
  getAdmin: async () => null,
  isAdminEmail: () => false,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { set: async () => 'OK' } }))
vi.mock('@/lib/enforcement', () => ({ conversationGate: async () => null }))
vi.mock('@/lib/user-blocks', () => ({ isBlockedBetween: async () => false }))
// An EXISTING share: the teacher shared phone, email and CV with this recruiter's thread.
vi.mock('@/lib/teachers/share', () => ({
  teacherThread: async () => ({
    convo: { listingId: 'L-teacher' }, teacherProfileId: 'tp-1', teacherUserId: 'teacher-1', recruiterUserId: 'recruiter-1',
    shared: true, shareOn: true, profileLive: true, hasPhone: true, phoneShared: true,
  }),
}))
vi.mock('@/lib/teachers/cv-store', () => ({ signTeacherCv: async () => { h.signed++; return 'https://storage.example/cv.pdf?sig=1' } }))
vi.mock('@/lib/db', () => ({
  db: {
    teacherPrivate: { findUnique: async () => { h.privateReads++; return { phone: '+84900000000', email: 't@example.com', cvPath: 'cv/tp-1.pdf', cvFileName: 'cv.pdf' } } },
    contactReveal: { createMany: async ({ data }: Row) => { h.reveals.push(...data); return { count: data.length } } },
  },
}))

const contact = await import('./route')
const cv = await import('../cv/route')
const { STORE_REVIEW_SEAT_EMAILS } = await import('@/lib/review-seat-accounts')

const req = (path: string, q = '') => new Request(`https://eno.vn${path}?conversationId=c1${q}`) as never

beforeEach(() => { h.email = 'school@example.com'; h.privateReads = 0; h.reveals = []; h.signed = 0 })

describe('GET /api/teachers/contact and /api/teachers/cv — a store seat with an existing share', () => {
  it('⛔ every store seat, in any case: 403 forbidden — no private row read, no ledger row, no CV link signed', async () => {
    for (const email of [...STORE_REVIEW_SEAT_EMAILS, ' App-Review@ENO.vn ']) {
      h.email = email
      const c = await contact.GET(req('/api/teachers/contact'), {} as never)
      expect(c.status, email).toBe(403)
      expect(await c.json(), email).toEqual({ error: 'forbidden' })
      for (const q of ['', '&format=json']) {
        const f = await cv.GET(req('/api/teachers/cv', q), {} as never)
        expect(f.status, `${email}${q}`).toBe(403)
        expect(f.headers.get('location'), `${email}${q}`).toBeNull()
      }
    }
    expect(h.privateReads).toBe(0)
    expect(h.reveals).toEqual([])
    expect(h.signed).toBe(0)
  })

  it('CONTROL: an ordinary school and the LAWYER\'s seat are served as before — contact, ledger row and CV', async () => {
    for (const email of ['school@example.com', 'lawyer-review@eno.vn', null]) {
      h.email = email
      const c = await contact.GET(req('/api/teachers/contact'), {} as never)
      expect(c.status, String(email)).toBe(200)
      expect(await c.json(), String(email)).toEqual({ phone: '+84900000000', email: 't@example.com', hasCv: true })
      const f = await cv.GET(req('/api/teachers/cv'), {} as never)
      expect(f.status, String(email)).toBe(302)
      expect(f.headers.get('location'), String(email)).toBe('https://storage.example/cv.pdf?sig=1')
    }
    expect(h.reveals).toEqual([
      { listingId: 'L-teacher', viewerId: 'recruiter-1' },
      { listingId: 'L-teacher', viewerId: 'recruiter-1' },
      { listingId: 'L-teacher', viewerId: 'recruiter-1' },
    ])
    expect(h.signed).toBe(3)
  })
})
