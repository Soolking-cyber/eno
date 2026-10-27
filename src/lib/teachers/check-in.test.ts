import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * src/lib/teachers/check-in.ts — the weekly check-in's server half (owner, 2026-10-27). Pinned:
 *   · who is asked: live profile, live listing (active + verified, a teacher's, never the demo), a week old, no "yes" and
 *     no bell within a week, reminders not switched off — and the claim re-checks all of it under the teacher's lock;
 *   · one bell row, in-app only (no push), eno's own words;
 *   · "yes" stamps availabilityConfirmedAt (and coverConfirmedAt while cover is on) on a LIVE profile only, and never
 *     writes a status, postedAt or anything that moves the profile.
 */
type Row = Record<string, any>

const h = vi.hoisted(() => ({
  due: [] as Row[],
  /** what the claim's re-check (findFirst) answers */
  stillDue: true as boolean,
  tp: null as Row | null,
  stamped: 1,
  locks: [] as string[],
  notifications: [] as Row[],
  listingUpdates: [] as Row[],
  profileUpdates: [] as Row[],
  findMany: [] as Row[],
  findFirst: [] as Row[],
}))

vi.mock('@/lib/db', () => {
  const tx = {
    $executeRaw: async (_s: TemplateStringsArray, key: string) => { h.locks.push(key) },
    teacherProfile: {
      findFirst: async (a: Row) => { h.findFirst.push(a); return h.stillDue ? { jobTypes: ['fulltime'], coverOpen: true } : null },
      findUnique: async () => h.tp,
      update: async (a: Row) => { h.profileUpdates.push(a); return {} },
    },
    listing: { updateMany: async (a: Row) => { h.listingUpdates.push(a); return { count: h.stamped } } },
    notification: { create: async (a: Row) => { h.notifications.push(a.data); return {} } },
  }
  return {
    db: {
      ...tx,
      teacherProfile: { ...tx.teacherProfile, findMany: async (a: Row) => { h.findMany.push(a); return h.due } },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  }
})

const { checkInDue, claimAndAsk, confirmTeacherCheckIn, sendTeacherCheckIns } = await import('./check-in')
const NOW = new Date('2026-10-28T02:00:00Z')
// a week less 12 hours (check-in.ts weekAgo): next week's run at the same hour still finds this week's bell "old"
const WEEK_AGO = new Date('2026-10-21T14:00:00Z')

beforeEach(() => {
  Object.assign(h, { due: [], stillDue: true, tp: null, stamped: 1, locks: [], notifications: [], listingUpdates: [], profileUpdates: [], findMany: [], findFirst: [] })
})

describe('who is asked', () => {
  it('live profile + live teacher listing, a week old, no "yes" and no bell within a week, reminders on, never the demo', () => {
    const w = checkInDue(NOW).where
    expect(w.status).toBe('live')
    expect(w.createdAt).toEqual({ lt: WEEK_AGO })
    const l = (w.listing as Row).is
    expect(l).toMatchObject({ status: 'active', verified: true, listingType: 'teacher' })
    expect(l.id.notIn.length).toBeGreaterThan(0)
    expect(l.OR).toEqual([{ availabilityConfirmedAt: null }, { availabilityConfirmedAt: { lt: WEEK_AGO } }])
    expect(w.profile).toEqual({ dailyReminderOptIn: true, notifications: { none: { type: 'teacher_checkin', createdAt: { gt: WEEK_AGO } } } })
  })

  it('the claim re-checks the whole selection under the teacher\'s lock, then writes one in-app bell', async () => {
    expect(await claimAndAsk('p1', NOW)).toBe(true)
    expect(h.locks).toEqual(['teacher:p1'])
    expect(h.findFirst[0].where).toEqual({ profileId: 'p1', ...checkInDue(NOW).where })
    expect(h.notifications).toEqual([{
      recipientId: 'p1', type: 'teacher_checkin', url: '/teachers/check-in',
      title: 'Hồ sơ giáo viên: kiểm tra hằng tuần · Your teacher profile: weekly check-in',
      body: expect.stringContaining('Still looking for a teaching job — and free for cover lessons?'),
    }])
  })

  it('no longer due under the lock (answered, asked by a parallel run, hidden) → no bell', async () => {
    h.stillDue = false
    expect(await claimAndAsk('p1', NOW)).toBe(false)
    expect(h.notifications).toEqual([])
  })

  it('a run asks each due teacher once, oldest first, and sends no push', async () => {
    h.due = [{ profileId: 'a' }, { profileId: 'b' }]
    expect(await sendTeacherCheckIns(NOW)).toEqual({ notified: 2, pushed: 0 })
    expect(h.findMany[0].orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }])
    expect(h.notifications.map((n) => n.recipientId)).toEqual(['a', 'b'])
  })
})

describe('"Yes, I\'m still available"', () => {
  it('a live profile: the week\'s answer stamped — and the cover periods confirmed while cover is on', async () => {
    h.tp = { id: 'tp1', status: 'live', coverOpen: true, listingId: 'L1' }
    expect(await confirmTeacherCheckIn('p1', NOW)).toEqual({ ok: true, confirmedAt: NOW.toISOString(), cover: true })
    expect(h.locks).toEqual(['teacher:p1'])
    expect(h.listingUpdates).toEqual([{ where: { id: 'L1', listingType: 'teacher', status: 'active', verified: true }, data: { availabilityConfirmedAt: NOW } }])
    expect(h.profileUpdates).toEqual([{ where: { id: 'tp1' }, data: { coverConfirmedAt: NOW } }])
  })

  it('cover off: only the listing stamp', async () => {
    h.tp = { id: 'tp1', status: 'live', coverOpen: false, listingId: 'L1' }
    expect((await confirmTeacherCheckIn('p1', NOW)).ok).toBe(true)
    expect(h.profileUpdates).toEqual([])
  })

  it('never moves the profile: no status, no postedAt, no soldAt in any write', async () => {
    h.tp = { id: 'tp1', status: 'live', coverOpen: true, listingId: 'L1' }
    await confirmTeacherCheckIn('p1', NOW)
    for (const u of [...h.listingUpdates, ...h.profileUpdates]) expect(Object.keys(u.data)).not.toEqual(expect.arrayContaining(['status']))
    expect(h.listingUpdates.flatMap((u) => Object.keys(u.data))).toEqual(['availabilityConfirmedAt'])
  })

  it('a hidden profile, or a listing no longer live (held, under review, sold): refused, nothing written', async () => {
    h.tp = { id: 'tp1', status: 'hidden', coverOpen: true, listingId: 'L1' }
    expect(await confirmTeacherCheckIn('p1', NOW)).toEqual({ ok: false, error: 'teacher_profile_not_live' })
    expect(h.listingUpdates).toEqual([])
    h.tp = { id: 'tp1', status: 'live', coverOpen: true, listingId: 'L1' }
    h.stamped = 0
    expect(await confirmTeacherCheckIn('p1', NOW)).toEqual({ ok: false, error: 'teacher_profile_not_live' })
    expect(h.profileUpdates).toEqual([])
  })

  it('no profile: 404\'s code', async () => {
    expect(await confirmTeacherCheckIn('p1', NOW)).toEqual({ ok: false, error: 'teacher_profile_missing' })
  })
})
