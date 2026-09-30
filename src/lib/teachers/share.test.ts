import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ row: null as unknown }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: { conversation: { findUnique: async () => h.row } } }))
const { teacherThread } = await import('./share')

const T = 'teacher-uuid'
const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1', buyerProfileId: 'recruiter-uuid', sellerProfileId: T, listingId: 'l1', sellerId: 's1',
  listing: { id: 'l1', listingType: 'teacher', status: 'active', verified: true, teacherProfile: { id: 'tp1', profileId: T, fullName: 'Jane', status: 'live' } },
  teacherContactShare: null,
  ...over,
})

beforeEach(() => { h.row = null })

describe('teacherThread — the share gate reads only the conversation row', () => {
  it('is null for a thread whose CURRENT listing is not a teacher (a retarget carries nothing)', async () => {
    h.row = row({ listing: { id: 'l2', listingType: 'sell', teacherProfile: null }, teacherContactShare: { sharedAt: new Date(), revokedAt: null } })
    expect(await teacherThread('c1')).toBeNull()
  })
  it('is null when the thread seller is not the teacher who owns the profile', async () => {
    h.row = row({ sellerProfileId: 'someone-else' })
    expect(await teacherThread('c1')).toBeNull()
  })
  it('is not shared until the teacher taps Share, and not after they revoke', async () => {
    h.row = row()
    expect((await teacherThread('c1'))?.shared).toBe(false)
    h.row = row({ teacherContactShare: { sharedAt: new Date(), revokedAt: null } })
    expect((await teacherThread('c1'))?.shared).toBe(true)
    h.row = row({ teacherContactShare: { sharedAt: new Date(), revokedAt: new Date() } })
    expect((await teacherThread('c1'))?.shared).toBe(false)
  })
  it('stops sharing the moment the profile is hidden, pulled or the listing is down', async () => {
    const shared = { teacherContactShare: { sharedAt: new Date(), revokedAt: null } }
    h.row = row({ ...shared, listing: { id: 'l1', listingType: 'teacher', status: 'hidden', verified: true, teacherProfile: { id: 'tp1', profileId: T, fullName: 'Jane', status: 'live' } } })
    expect((await teacherThread('c1'))?.shared).toBe(false)
    h.row = row({ ...shared, listing: { id: 'l1', listingType: 'teacher', status: 'active', verified: false, teacherProfile: { id: 'tp1', profileId: T, fullName: 'Jane', status: 'live' } } })
    expect((await teacherThread('c1'))?.shared).toBe(false)
    h.row = row({ ...shared, listing: { id: 'l1', listingType: 'teacher', status: 'active', verified: true, teacherProfile: { id: 'tp1', profileId: T, fullName: 'Jane', status: 'hidden' } } })
    expect((await teacherThread('c1'))?.shared).toBe(false)
    // …but the teacher's own choice is still ON, so Stop sharing can actually revoke it.
    expect((await teacherThread('c1'))?.shareOn).toBe(true)
  })
  it('names the recruiter as the buyer side', async () => {
    h.row = row()
    const t = await teacherThread('c1')
    expect(t?.recruiterUserId).toBe('recruiter-uuid')
    expect(t?.teacherUserId).toBe(T)
  })
})
