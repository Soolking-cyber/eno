import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * callPermit (eligibility.ts) — who may call whom, where — with every dependency faked, so the ORDER and the
 * fail-closed answers are pinned: no blocking → off; the switch must admit BOTH people; visa / trip storefront, visa /
 * itinerary, support and lost-listing threads never (eno's rental and jobs desk chats may call); suspended or blocked never; the caller verified (video and teacher threads: both); staff exempt from
 * the identity half only.
 */
const h = vi.hoisted(() => ({
  mode: 'all' as 'off' | 'staff' | 'beta' | 'all',
  cohort: [] as string[],
  video: true,
  blocking: true,
  staff: new Set<string>(),
  verified: new Set<string>(),
  minors: new Set<string>(),
  suspended: new Set<string>(),
  blocked: false,
  kind: 'listing' as string,
  evisa: false,
  desks: [] as string[],
  readFails: false,
  modeAfterReset: null as null | 'off' | 'staff' | 'beta' | 'all',
  resets: 0,
  thread: true,
  // Profile.email by id — a review seat's in its test (src/lib/review-seat-accounts.ts).
  emails: {} as Record<string, string>,
  // The profiles that own a TeacherProfile (live or hidden), and every TeacherProfile read made.
  teachers: [] as string[],
  teacherReads: [] as string[],
}))

vi.mock('@/lib/db', () => ({
  db: {
    conversation: {
      findUnique: async () => (h.thread
        ? { id: 'c1', buyerProfileId: 'buyer', sellerProfileId: 'seller', sellerId: 'shop', listingId: 'l1', visaApplicationId: null, listing: { listingType: null } }
        : null),
    },
    identityVerification: {
      findFirst: async ({ where }: { where: { profileId: string } }) => (h.minors.has(where.profileId) ? { id: 'v' } : null),
    },
    profile: { findUnique: async ({ where }: { where: { id: string } }) => ({ email: h.emails[where.id] ?? `${where.id}@example.com` }) },
    teacherProfile: {
      findUnique: async ({ where }: { where: { profileId: string } }) => {
        h.teacherReads.push(where.profileId)
        return h.teachers.includes(where.profileId) ? { id: `tp-${where.profileId}` } : null
      },
    },
  },
}))
vi.mock('./config', async (orig) => {
  const real = await orig<typeof import('./config')>()
  return {
    ...real,
    readCallsConfig: async () => (h.readFails ? { ...real.CALLS_OFF, readOk: false } : real.configFromRow({ mode: h.mode, cohort: h.cohort, video: h.video, relay: 'cloudflare' })),
    // The fresh read a live re-judge asks for: lets a test model another process's stale cache being dropped.
    resetCallsConfigCache: () => { h.resets++; if (h.modeAfterReset) { h.mode = h.modeAfterReset; h.modeAfterReset = null } },
  }
})
vi.mock('@/lib/user-blocks', () => ({
  blockingOn: () => h.blocking,
  isStaffProfile: async (id: string) => h.staff.has(id),
  isBlockedBetween: async () => h.blocked,
}))
vi.mock('@/lib/enforcement', () => ({ messagingGate: async (id: string) => (h.suspended.has(id) ? { error: 'suspended' } : null) }))
vi.mock('@/lib/kyc/identity', () => ({ verifiedIdentityFor: async (id: string) => (h.verified.has(id) ? { profileId: id } : null) }))
vi.mock('@/lib/edition-scope', () => ({ deskSellerIds: async () => h.desks }))
vi.mock('@/lib/ios-hide-visa-server', () => ({ isEVisaThread: async () => h.evisa }))
vi.mock('@/lib/thread-kind', () => ({ threadKind: async () => h.kind }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))

const { callPermit, liveCallRefusal, threadPermitRefusal } = await import('./eligibility')

const convo = (o: Record<string, unknown> = {}) => ({
  id: 'c1', buyerProfileId: 'buyer', sellerProfileId: 'seller', sellerId: 'shop', listingId: 'l1', visaApplicationId: null, listingType: null, ...o,
})

beforeEach(() => {
  h.mode = 'all'; h.cohort = []; h.video = true; h.blocking = true; h.staff = new Set(); h.verified = new Set(['buyer', 'seller'])
  h.minors = new Set(); h.suspended = new Set(); h.blocked = false; h.kind = 'listing'; h.evisa = false; h.desks = []
  h.readFails = false; h.modeAfterReset = null; h.resets = 0; h.thread = true; h.emails = {}; h.teachers = []; h.teacherReads = []
})

describe('callPermit', () => {
  it('a verified caller in an ordinary listing thread may call', async () => {
    expect(await callPermit(convo(), 'buyer', 'audio')).toMatchObject({ ok: true, calleeId: 'seller', teacherThread: false })
  })

  it('⛔ no blocking (ugc-safety off) → calls are off, whatever the switch says', async () => {
    h.blocking = false
    expect(await callPermit(convo(), 'buyer', 'audio')).toEqual({ ok: false, error: 'calls_unavailable', status: 403 })
  })

  it('the switch must admit BOTH people (a beta caller cannot ring someone outside the beta)', async () => {
    h.mode = 'beta'; h.cohort = ['buyer']
    expect((await callPermit(convo(), 'buyer', 'audio')).ok).toBe(false)
    h.cohort = ['buyer', 'seller']
    expect((await callPermit(convo(), 'buyer', 'audio')).ok).toBe(true)
    h.mode = 'staff'; h.staff = new Set(['buyer'])
    expect((await callPermit(convo(), 'buyer', 'audio')).ok).toBe(false)
    h.staff = new Set(['buyer', 'seller'])
    expect((await callPermit(convo(), 'buyer', 'audio')).ok).toBe(true)
  })

  it('video can be switched off on its own', async () => {
    h.video = false
    expect((await callPermit(convo(), 'buyer', 'video'))).toMatchObject({ ok: false, error: 'calls_unavailable' })
    expect((await callPermit(convo(), 'buyer', 'audio')).ok).toBe(true)
  })

  it('never a visa / itinerary / e-Visa thread, eno\'s visa / trip storefront or a lost-listing chat — a rental / jobs desk chat may call', async () => {
    for (const kind of ['visa', 'itinerary']) {
      h.kind = kind
      expect(await callPermit(convo(), 'buyer', 'audio')).toMatchObject({ ok: false, error: 'calls_thread_unavailable' })
    }
    h.kind = 'listing'; h.evisa = true
    expect(await callPermit(convo(), 'buyer', 'audio')).toMatchObject({ ok: false, error: 'calls_thread_unavailable' })
    h.evisa = false; h.desks = ['shop']
    expect(await callPermit(convo(), 'buyer', 'audio')).toMatchObject({ ok: false, error: 'calls_thread_unavailable' })
    expect(await callPermit(convo({ listingId: null }), 'buyer', 'audio')).toMatchObject({ ok: false, error: 'calls_thread_unavailable' })
    h.desks = []
    expect(await callPermit(convo({ listingId: null }), 'buyer', 'audio')).toMatchObject({ ok: false, error: 'calls_thread_unavailable' })
    expect((await callPermit(convo({ listingId: null, sellerId: 'eno-rental-desk' }), 'buyer', 'audio')).ok).toBe(true)
    expect(await callPermit(convo(), 'stranger', 'audio')).toMatchObject({ ok: false, error: 'not_participant' })
  })

  it('a suspended person on either side, or a block either way, ends it', async () => {
    h.suspended = new Set(['seller'])
    expect(await callPermit(convo(), 'buyer', 'audio')).toMatchObject({ ok: false, error: 'calls_unavailable' })
    h.suspended = new Set(); h.blocked = true
    expect(await callPermit(convo(), 'buyer', 'audio')).toMatchObject({ ok: false, error: 'blocked' })
  })

  it('the caller must be verified; video and teacher threads need the callee verified too', async () => {
    h.verified = new Set(['seller'])
    expect(await callPermit(convo(), 'buyer', 'audio')).toMatchObject({ ok: false, error: 'calls_not_verified' })
    h.verified = new Set(['buyer'])
    expect((await callPermit(convo(), 'buyer', 'audio')).ok).toBe(true)
    expect(await callPermit(convo(), 'buyer', 'video')).toMatchObject({ ok: false, error: 'calls_peer_not_verified' })
    expect(await callPermit(convo({ listingType: 'teacher' }), 'buyer', 'audio')).toMatchObject({ ok: false, error: 'calls_peer_not_verified' })
  })

  it('⛔ a review seat never rings a teacher (review-seat-accounts.ts) — both sides verified or not; elsewhere it is any caller', async () => {
    const teacher = convo({ listingType: 'teacher' })
    expect((await callPermit(teacher, 'buyer', 'audio')).ok).toBe(true) // the control: not a seat
    h.emails = { buyer: ' App-Review@eno.vn' }
    expect(await callPermit(teacher, 'buyer', 'audio')).toMatchObject({ ok: false, error: 'calls_thread_unavailable', status: 403 })
    expect(await callPermit(teacher, 'buyer', 'video')).toMatchObject({ ok: false, error: 'calls_thread_unavailable' })
    expect((await callPermit(convo(), 'buyer', 'audio')).ok).toBe(true)
  })

  /**
   * ⛔ ROUND 4 (codex P1, opus #2): a seat and a teacher never share a call — in ANY thread, either role, either way. The
   * old check asked only "a seat BUYER in a teacher-listing thread", so a seat SELLING a job to a teacher who wrote in still
   * rang them (a call request is a card, a bell and a push). Both sides verified, so only the seat rule can refuse.
   */
  it('⛔ a seat SELLING (a job post a teacher wrote to) never rings the teacher buyer — audio or video', async () => {
    h.emails = { seller: 'ai-review@eno.vn' }
    h.teachers = ['buyer']
    const job = convo({ listingType: 'job' })
    expect(await callPermit(job, 'seller', 'audio')).toEqual({ ok: false, error: 'calls_thread_unavailable', status: 403 })
    expect(await callPermit(job, 'seller', 'video')).toEqual({ ok: false, error: 'calls_thread_unavailable', status: 403 })
  })

  it('⛔ …nor rings a teacher it BUYS from on an ordinary listing, nor a teacher whose profile is hidden (the row is all it asks)', async () => {
    h.emails = { buyer: 'play-review@eno.forum' }
    h.teachers = ['seller']
    expect(await callPermit(convo({ listingType: 'sell' }), 'buyer', 'audio')).toMatchObject({ ok: false, error: 'calls_thread_unavailable' })
  })

  it('⛔ EITHER WAY: a teacher dialling a seat is refused too — the accept re-judges from the CALLER\'s side, so the seat never picks up', async () => {
    h.emails = { seller: 'app-review@eno.vn' }
    h.teachers = ['buyer']
    expect(await callPermit(convo({ listingType: 'service' }), 'buyer', 'audio')).toMatchObject({ ok: false, error: 'calls_thread_unavailable' })
    // …and in a teacher-listing thread the seller IS the teacher, with no read: a seat buyer is refused either way round
    h.emails = { buyer: 'app-review@eno.vn' }
    h.teachers = []
    h.teacherReads = []
    expect(await callPermit(convo({ listingType: 'teacher' }), 'seller', 'audio')).toMatchObject({ ok: false, error: 'calls_thread_unavailable' })
    expect(h.teacherReads).toEqual([])
  })

  it('CONTROL: an ordinary school selling a job rings the teacher who wrote in; a seat with a non-teacher is untouched; no seat, no TeacherProfile read', async () => {
    h.teachers = ['buyer']
    expect(await callPermit(convo({ listingType: 'job' }), 'seller', 'audio')).toMatchObject({ ok: true, calleeId: 'buyer' })
    expect(h.teacherReads).toEqual([])
    h.emails = { seller: 'ai-review@eno.vn' }
    h.teachers = []
    expect(await callPermit(convo({ listingType: 'job' }), 'seller', 'audio')).toMatchObject({ ok: true, calleeId: 'buyer' })
    expect(h.teacherReads).toEqual(['buyer'])
  })

  it('a known minor (a verified document\'s birth year) cannot call or be video-called', async () => {
    h.minors = new Set(['buyer'])
    expect(await callPermit(convo(), 'buyer', 'audio')).toMatchObject({ ok: false, error: 'calls_not_verified' })
    h.minors = new Set(['seller'])
    expect(await callPermit(convo(), 'buyer', 'video')).toMatchObject({ ok: false, error: 'calls_peer_not_verified' })
  })

  it('staff are exempt from the identity half only — not from blocks, suspensions or the thread rules', async () => {
    h.verified = new Set(); h.staff = new Set(['buyer', 'seller'])
    expect((await callPermit(convo(), 'buyer', 'video')).ok).toBe(true)
    h.blocked = true
    expect(await callPermit(convo(), 'buyer', 'audio')).toMatchObject({ ok: false, error: 'blocked' })
    h.blocked = false; h.kind = 'visa'
    expect(await callPermit(convo(), 'buyer', 'audio')).toMatchObject({ ok: false, error: 'calls_thread_unavailable' })
  })
})

describe('threadPermitRefusal — the consent route asks the SAME thread question a call does (round-5 review)', () => {
  it('visa, itinerary, e-Visa, visa / trip storefront, lost-listing and stranger threads are refused; a listing or desk chat is not', async () => {
    expect(await threadPermitRefusal(convo(), 'seller')).toBeNull()
    for (const kind of ['visa', 'itinerary']) {
      h.kind = kind
      expect(await threadPermitRefusal(convo(), 'seller')).toEqual({ error: 'calls_thread_unavailable', status: 403 })
    }
    h.kind = 'listing'; h.evisa = true
    expect(await threadPermitRefusal(convo(), 'seller')).toEqual({ error: 'calls_thread_unavailable', status: 403 })
    h.evisa = false; h.desks = ['shop']
    expect(await threadPermitRefusal(convo(), 'seller')).toEqual({ error: 'calls_thread_unavailable', status: 403 })
    expect(await threadPermitRefusal(convo({ listingId: null }), 'seller')).toEqual({ error: 'calls_thread_unavailable', status: 403 })
    h.desks = []
    expect(await threadPermitRefusal(convo({ listingId: null }), 'seller')).toEqual({ error: 'calls_thread_unavailable', status: 403 })
    expect(await threadPermitRefusal(convo({ listingId: null, sellerId: 'eno-jobs-desk' }), 'seller')).toBeNull()
    expect(await threadPermitRefusal(convo(), 'stranger')).toEqual({ error: 'not_participant', status: 403 })
  })
})

describe('liveCallRefusal — what a heartbeat asks of a live call (round-5 review: the switch must reach live calls)', () => {
  const live = (o: Record<string, unknown> = {}) => ({ caller_id: 'buyer', callee_id: 'seller', media: 'audio' as const, ...o })

  it('a call the start would still allow goes on', async () => {
    expect(await liveCallRefusal(live())).toBeNull()
    expect(h.resets).toBe(0)
  })

  it('⛔ the kill switch, a narrowed switch and video switched off end it as kill_switch', async () => {
    h.mode = 'off'
    expect(await liveCallRefusal(live())).toBe('kill_switch')
    h.mode = 'beta'; h.cohort = ['buyer']
    expect(await liveCallRefusal(live())).toBe('kill_switch')
    h.mode = 'all'; h.video = false
    expect(await liveCallRefusal(live({ media: 'video' }))).toBe('kill_switch')
    expect(await liveCallRefusal(live())).toBeNull()
  })

  it('⛔ a suspension ends it as kill_switch, a block as blocked', async () => {
    h.suspended = new Set(['buyer'])
    expect(await liveCallRefusal(live())).toBe('kill_switch')
    h.suspended = new Set(); h.blocked = true
    expect(await liveCallRefusal(live())).toBe('blocked')
  })

  it('the START-only rules never hang up a live call: a listing sold or gone, a thread turned desk, a lapsed ID (round-6 review)', async () => {
    h.thread = false
    expect(await liveCallRefusal(live())).toBeNull()
    h.thread = true; h.kind = 'visa'; h.evisa = true; h.desks = ['shop']
    expect(await liveCallRefusal(live())).toBeNull()
    h.kind = 'listing'; h.evisa = false; h.desks = []; h.verified = new Set()
    expect(await liveCallRefusal(live({ media: 'video' }))).toBeNull()
    expect(h.resets).toBe(0)
  })

  it('⚠️ another process\'s stale "off" is re-read before anything ends — the fresh row allows the call', async () => {
    h.mode = 'off'; h.modeAfterReset = 'all'
    expect(await liveCallRefusal(live())).toBeNull()
    expect(h.resets).toBe(1)
  })

  it('⛔ an UNREADABLE switch never ends a call (a database blip is not the owner\'s kill switch)', async () => {
    h.readFails = true
    expect(await liveCallRefusal(live())).toBeNull()
  })

  it('an erased participant: erasure already ended the call, nothing to judge', async () => {
    expect(await liveCallRefusal(live({ caller_id: null }))).toBeNull()
    expect(await liveCallRefusal(live({ callee_id: null }))).toBeNull()
  })
})
