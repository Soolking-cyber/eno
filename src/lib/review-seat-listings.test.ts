import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * review-seat-listings.ts — the database half of the review-seat rules, against a faked client:
 *   · reviewSeatMeetsTeacher — the one predicate every seat-side act in a thread asks (round 4): a seat and a teacher,
 *     in either role; `eitherWay` for a call; a teacher listing's seller counts with no read; an ordinary actor pays one
 *     Profile read (none when the route hands the row's address) and never a TeacherProfile one; a failed read throws;
 *   · reviewSeatListingIds — what an admin publish refuses by name, judged by isReviewSeatEmail (opus, round 3): a row the
 *     create hold kept back for an owner whose stored address differs in case or spacing is named, never published;
 *   · ⛔ the lawyer's seat is no store seat (round 4, review-seat-accounts.ts): it meets teachers and publishes as anyone.
 */
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  emails: {} as Record<string, string | null>,
  teachers: [] as string[],
  profileReads: [] as string[],
  teacherReads: [] as string[],
  down: false,
  listings: [] as Row[],
  listingArgs: [] as Row[],
}))
vi.mock('@/lib/db', () => ({
  db: {
    profile: {
      findUnique: async ({ where }: Row) => {
        h.profileReads.push(where.id)
        if (h.down) throw new Error('db down')
        return where.id in h.emails ? { email: h.emails[where.id] } : null
      },
    },
    teacherProfile: {
      findUnique: async ({ where }: Row) => { h.teacherReads.push(where.profileId); return h.teachers.includes(where.profileId) ? { id: `tp-${where.profileId}` } : null },
    },
    listing: {
      findMany: async (args: Row) => {
        h.listingArgs.push(args)
        return h.listings.filter((l) => args.where.id.in.includes(l.id))
      },
    },
  },
}))

const { reviewSeatMeetsTeacher, reviewSeatListingIds, ownerIsReviewSeat } = await import('./review-seat-listings')

beforeEach(() => {
  h.emails = { seat: ' AI-Review@eno.vn', school: 'office@school.example', teacher: 'jane@example.com', staff: 'review@eno.vn', nomail: null, lawyer: 'lawyer-review@eno.vn' }
  h.teachers = ['teacher']; h.profileReads = []; h.teacherReads = []; h.down = false; h.listings = []; h.listingArgs = []
})

describe('reviewSeatMeetsTeacher', () => {
  it('⛔ a seat acting toward a teacher — any address form of any store seat', async () => {
    expect(await reviewSeatMeetsTeacher('seat', 'teacher')).toBe(true)
    for (const email of ['app-review@eno.vn', 'APP-REVIEW@ENO.VN', '\tplay-review@eno.forum ']) {
      h.emails.seat = email
      expect(await reviewSeatMeetsTeacher('seat', 'teacher'), email).toBe(true)
    }
  })

  it('…the seller of the thread\'s teacher listing is a teacher with NO read (`teacherSeller`)', async () => {
    h.teachers = []
    expect(await reviewSeatMeetsTeacher('seat', 'teacher', { teacherSeller: 'teacher' })).toBe(true)
    expect(h.teacherReads).toEqual([])
  })

  it('`actorEmail`: the route\'s own Profile row — no read; null means "no address", not "read it"', async () => {
    expect(await reviewSeatMeetsTeacher('seat', 'teacher', { actorEmail: 'ai-review@eno.vn' })).toBe(true)
    expect(await reviewSeatMeetsTeacher('seat', 'teacher', { actorEmail: null })).toBe(false)
    expect(h.profileReads).toEqual([])
  })

  it('one way by default: a TEACHER acting toward a seat is not asked about (their message is their own)', async () => {
    expect(await reviewSeatMeetsTeacher('teacher', 'seat')).toBe(false)
    expect(h.profileReads).toEqual(['teacher'])
  })

  it('⛔ `eitherWay` (a call): a teacher dialling a seat is caught too — both addresses read', async () => {
    expect(await reviewSeatMeetsTeacher('teacher', 'seat', { eitherWay: true })).toBe(true)
    expect(h.profileReads.sort()).toEqual(['seat', 'teacher'])
    expect(await reviewSeatMeetsTeacher('school', 'teacher', { eitherWay: true })).toBe(false)
  })

  it('CONTROL: an ordinary actor, the staff\'s domain, or a no-email account pays one Profile read and never a TeacherProfile one', async () => {
    for (const actor of ['school', 'staff', 'nomail', 'unknown']) expect(await reviewSeatMeetsTeacher(actor, 'teacher'), actor).toBe(false)
    expect(h.profileReads).toEqual(['school', 'staff', 'nomail', 'unknown'])
    expect(h.teacherReads).toEqual([])
  })

  it('CONTROL: the LAWYER\'s seat (Luật Hoàng Phi\'s storefront) is no store seat — it answers a teacher, either way, with no TeacherProfile read', async () => {
    for (const email of ['lawyer-review@eno.vn', ' LAWYER-REVIEW@ENO.VN ']) {
      h.emails.lawyer = email
      expect(await reviewSeatMeetsTeacher('lawyer', 'teacher'), email).toBe(false)
      expect(await reviewSeatMeetsTeacher('teacher', 'lawyer', { eitherWay: true }), email).toBe(false)
      expect(await reviewSeatMeetsTeacher('lawyer', 'teacher', { actorEmail: email, teacherSeller: 'teacher' }), email).toBe(false)
    }
    expect(h.teacherReads).toEqual([])
  })

  it('CONTROL: a seat toward someone who is not a teacher is false — after one TeacherProfile read', async () => {
    expect(await reviewSeatMeetsTeacher('seat', 'school')).toBe(false)
    expect(h.teacherReads).toEqual(['school'])
  })

  it('nobody on the other side, or the actor on both, is no teacher — with no read', async () => {
    for (const other of [null, undefined, '', 'seat']) expect(await reviewSeatMeetsTeacher('seat', other)).toBe(false)
    expect(h.profileReads).toEqual([])
  })

  it('⛔ fails CLOSED: a read that fails throws — the caller refuses', async () => {
    h.down = true
    await expect(reviewSeatMeetsTeacher('seat', 'teacher')).rejects.toThrow('db down')
  })
})

describe('reviewSeatListingIds — judged by isReviewSeatEmail, the create hold\'s own test (opus, round 3)', () => {
  it('⛔ names a seat\'s row whatever the case or spacing of the owner\'s stored address — and nothing else', async () => {
    h.listings = [
      { id: 'L-seat', seller: { owner: { email: '\tAI-REVIEW@ENO.VN ' } } },
      { id: 'L-seat2', seller: { owner: { email: 'app-review@eno.vn' } } },
      { id: 'L-school', seller: { owner: { email: 'office@school.example' } } },
      { id: 'L-staff', seller: { owner: { email: 'review@eno.vn' } } },
      { id: 'L-nomail', seller: { owner: { email: null } } },
      { id: 'L-ownerless', seller: { owner: null } },
      { id: 'L-lawyer', seller: { owner: { email: 'Lawyer-Review@eno.vn' } } }, // Luật Hoàng Phi: no store seat (round 4)
    ]
    expect(await reviewSeatListingIds(['L-seat', 'L-seat2', 'L-school', 'L-staff', 'L-nomail', 'L-ownerless', 'L-lawyer'])).toEqual(['L-seat', 'L-seat2'])
    // The read is over the ids alone — no address filter in SQL that could disagree with isReviewSeatEmail.
    expect(h.listingArgs[0].where).toEqual({ id: { in: ['L-seat', 'L-seat2', 'L-school', 'L-staff', 'L-nomail', 'L-ownerless', 'L-lawyer'] } })
  })

  it('no ids, no read', async () => {
    expect(await reviewSeatListingIds([])).toEqual([])
    expect(h.listingArgs).toEqual([])
  })
})

describe('ownerIsReviewSeat — the create hold\'s owner test', () => {
  it('a store seat\'s storefront is held; the lawyer\'s (Luật Hoàng Phi), an ordinary owner\'s and no owner are not', async () => {
    expect(await ownerIsReviewSeat('seat')).toBe(true)
    for (const owner of ['lawyer', 'school', 'nomail', null]) expect(await ownerIsReviewSeat(owner), String(owner)).toBe(false)
  })
})
