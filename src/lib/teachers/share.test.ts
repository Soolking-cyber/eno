import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ row: null as unknown }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: { conversation: { findUnique: async () => h.row } } }))
const { teacherThread, teacherVideoState, ASK_AGAIN_MS } = await import('./share')

const T = 'teacher-uuid'
const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1', buyerProfileId: 'recruiter-uuid', sellerProfileId: T, listingId: 'l1', sellerId: 's1',
  listing: { id: 'l1', listingType: 'teacher', status: 'active', verified: true, teacherProfile: { id: 'tp1', profileId: T, fullName: 'Jane', status: 'live' } },
  teacherContactShare: null,
  buyer: { accountType: 'business' },
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

describe('teacherThread — the intro video sent on request (2026-10-07)', () => {
  const live = (over: Record<string, unknown> = {}) => ({ id: 'l1', listingType: 'teacher', status: 'active', verified: true, teacherProfile: { id: 'tp1', profileId: T, fullName: 'Jane', status: 'live', videoOnRequest: true, private: { videoPath: 'tp/v.mp4' }, ...over } })
  it('is available only while the teacher keeps a private video on request and the profile is live', async () => {
    h.row = row({ listing: live(), teacherVideoShare: null })
    const t = await teacherThread('c1')
    expect(t?.videoAvailable).toBe(true)
    // The path read WITH the grant — what the watch route signs (never a second lookup).
    expect(t?.privateVideoPath).toBe('tp/v.mp4')
    h.row = row({ listing: live({ private: { videoPath: null } }), teacherVideoShare: null })
    expect((await teacherThread('c1'))?.videoAvailable).toBe(false)
    h.row = row({ listing: live({ videoOnRequest: false }), teacherVideoShare: null })
    expect((await teacherThread('c1'))?.videoAvailable).toBe(false)
  })
  it('⛔ a school\'s request alone unlocks nothing — only the teacher\'s send does', async () => {
    h.row = row({ listing: live(), teacherVideoShare: { requestedAt: new Date(), sharedAt: null, revokedAt: null } })
    const asked = await teacherThread('c1')
    expect(asked?.videoRequested).toBe(true)
    expect(asked?.videoShared).toBe(false)
    h.row = row({ listing: live(), teacherVideoShare: { requestedAt: new Date(), sharedAt: new Date(), revokedAt: null } })
    expect((await teacherThread('c1'))?.videoShared).toBe(true)
  })
  it('never reads the CONTACT grant as a video grant, nor the reverse', async () => {
    h.row = row({ listing: live(), teacherContactShare: { sharedAt: new Date(), revokedAt: null }, teacherVideoShare: null })
    const t = await teacherThread('c1')
    expect(t?.shared).toBe(true)
    expect(t?.videoShared).toBe(false)
  })
  it('keeps the teacher\'s own grant visible on a hidden profile, so Stop can still revoke it', async () => {
    h.row = row({ listing: { ...live(), status: 'hidden' }, teacherVideoShare: { requestedAt: null, sharedAt: new Date(), revokedAt: null } })
    const t = await teacherThread('c1')
    expect(t?.videoShared).toBe(false)
    expect(t?.videoShareOn).toBe(true)
  })
  it('⛔ business-only: a personal buyer (a parent) is never shown a watchable video — but the teacher can still Stop', async () => {
    const sent = { requestedAt: null, sharedAt: new Date(), revokedAt: null }
    for (const accountType of ['individual', null]) {
      h.row = row({ listing: live(), teacherVideoShare: sent, buyer: { accountType } })
      const t = await teacherThread('c1')
      expect(t?.videoForBusiness).toBe(false)
      expect(t?.videoShared).toBe(false) // a grant sent before the rule watches nothing
      expect(t?.videoShareOn).toBe(true) // …and stays revocable
      expect(t?.videoAvailable).toBe(true) // `available` is the profile's state, not the buyer's: the teacher's copy stays true
    }
    h.row = row({ listing: live(), teacherVideoShare: sent })
    const t = await teacherThread('c1')
    expect(t?.videoForBusiness).toBe(true)
    expect(t?.videoShared).toBe(true)
  })
  it('an ask may be repeated a day later: askAgain comes on at ASK_AGAIN_MS', async () => {
    h.row = row({ listing: live(), teacherVideoShare: { requestedAt: new Date(Date.now() - 3600_000), sharedAt: null, revokedAt: null } })
    let t = await teacherThread('c1')
    expect(t?.videoRequested).toBe(true)
    expect(t?.videoAskAgain).toBe(false)
    h.row = row({ listing: live(), teacherVideoShare: { requestedAt: new Date(Date.now() - ASK_AGAIN_MS - 60_000), sharedAt: null, revokedAt: null } })
    t = await teacherThread('c1')
    expect(t?.videoRequested).toBe(true)
    expect(t?.videoAskAgain).toBe(true)
  })
})

describe('teacherVideoState — the one derivation behind the strip and the video routes', () => {
  const tp = { videoOnRequest: true, private: { videoPath: 'tp/v.mp4' } }
  const at = Date.UTC(2026, 9, 8, 12)
  it('asks again exactly ASK_AGAIN_MS (a day) after the last ask — never sooner', () => {
    expect(ASK_AGAIN_MS).toBe(24 * 3600 * 1000)
    const asked = { requestedAt: new Date(at - ASK_AGAIN_MS), sharedAt: null, revokedAt: null }
    expect(teacherVideoState(asked, tp, true, true, at).askAgain).toBe(true)
    expect(teacherVideoState(asked, tp, true, true, at - 1).askAgain).toBe(false)
  })
  it('no standing ask, no askAgain: never asked, or answered by a stop since (the school may simply ask)', () => {
    expect(teacherVideoState(null, tp, true, true, at)).toMatchObject({ requested: false, askAgain: false })
    const stopped = { requestedAt: new Date(at - 3 * ASK_AGAIN_MS), sharedAt: new Date(at - 2 * ASK_AGAIN_MS), revokedAt: new Date(at - ASK_AGAIN_MS) }
    expect(teacherVideoState(stopped, tp, true, true, at)).toMatchObject({ requested: false, askAgain: false })
  })
  it('shared needs the teacher\'s grant, a watchable video AND a business buyer', () => {
    const sent = { requestedAt: null, sharedAt: new Date(at), revokedAt: null }
    expect(teacherVideoState(sent, tp, true, true, at)).toMatchObject({ shared: true, forBusiness: true })
    expect(teacherVideoState(sent, tp, true, false, at)).toMatchObject({ shared: false, shareOn: true, available: true, forBusiness: false })
    expect(teacherVideoState(sent, tp, false, true, at)).toMatchObject({ shared: false, shareOn: true, available: false })
  })
})
