import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ capOk: true, pairOk: true, listingStatus: 'live', rows: [] as Record<string, unknown>[], pushes: [] as Record<string, unknown>[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async (bucket: string) => ({ success: bucket === 'teacher-notify-pair' ? h.pairOk : h.capOk }) }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async (_id: string, p: Record<string, unknown>) => { h.pushes.push(p); return 1 } }))
vi.mock('@/lib/db', () => ({ db: {
  notification: { create: async ({ data }: { data: Record<string, unknown> }) => { h.rows.push(data); return data } },
  teacherProfile: { findUnique: async () => ({ status: h.listingStatus }) },
} }))

const { isQuietGap, notifyTeacherOfSchoolMessage, TEACHER_QUIET_HOURS } = await import('./notify')

beforeEach(() => { h.capOk = true; h.pairOk = true; h.listingStatus = 'live'; h.rows = []; h.pushes = [] })

describe('isQuietGap', () => {
  const now = new Date('2026-10-07T12:00:00Z')
  it('is quiet after the gap, or when there was no message yet', () => {
    expect(isQuietGap(null, now)).toBe(true)
    expect(isQuietGap(new Date(now.getTime() - TEACHER_QUIET_HOURS * 3_600_000), now)).toBe(true)
    expect(isQuietGap(new Date(now.getTime() - 3_600_000), now)).toBe(false)
  })
})

describe('notifyTeacherOfSchoolMessage', () => {
  it('writes one bell row and one push to the thread, with no sender name in either', async () => {
    await notifyTeacherOfSchoolMessage({ teacherProfileId: 't1', conversationId: 'c1', listingId: 'L1' })
    expect(h.rows).toEqual([expect.objectContaining({ recipientId: 't1', type: 'teacher_message', conversationId: 'c1', listingId: 'L1' })])
    expect(h.pushes).toEqual([expect.objectContaining({ url: '/messages/c1' })])
    expect(String(h.rows[0].title)).toMatch(/A school or company messaged you/)
    expect(h.rows[0].actorName).toBeUndefined()
  })
  it('rings a thread once per quiet gap, even when two messages race past it', async () => {
    h.pairOk = false
    await notifyTeacherOfSchoolMessage({ teacherProfileId: 't1', conversationId: 'c1', listingId: 'L1' })
    expect(h.rows).toEqual([])
  })
  it('does not ring a teacher who hid the profile since the message was sent', async () => {
    h.listingStatus = 'hidden'
    await notifyTeacherOfSchoolMessage({ teacherProfileId: 't1', conversationId: 'c1', listingId: 'L1' })
    expect(h.rows).toEqual([])
  })
  it('stops at the daily cap per teacher', async () => {
    h.capOk = false
    await notifyTeacherOfSchoolMessage({ teacherProfileId: 't1', conversationId: 'c1', listingId: 'L1' })
    expect(h.rows).toEqual([])
    expect(h.pushes).toEqual([])
  })
})
