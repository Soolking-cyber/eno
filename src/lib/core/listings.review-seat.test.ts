import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A REVIEW SEAT'S NEW LISTINGS ARE NEVER PUBLIC (round 3, 2026-11-14 — src/lib/review-seat-accounts.ts
 * REVIEW_SEAT_HELD_NOTE). createListingCore is where the post wizard (api/listings), the partner REST API (api/v1/listings)
 * and the Partner MCP's create_listing end, so it is held here once:
 *   · a seat-owned storefront's create is written verified:false with the seat's mark — never identityHold, so
 *     releaseIdentityHolds has nothing to release — and answers `verified: false` without `held` (the licence check's);
 *   · a seat's JOB post is held the same way: it can never be public, so no teacher is ever drawn into its thread;
 *   · CONTROL: an ordinary owner, an ownerless storefront (no read), a no-email owner and the LAWYER's seat (Luật Hoàng
 *     Phi's storefront — no store seat, round 4) publish exactly as before;
 *   · the owner read is the real one (review-seat-listings.ts ownerIsReviewSeat), and a failed read creates nothing.
 * And the existing-row doors stay shut on such a row: an edit (updateListingCore) never writes `verified`, so it cannot
 * publish it — and answers `unpublished: true` (round 5), so the wizard goes to the dashboard, not to a 404; a licence
 * re-hold keeps the seat's mark (licence-stamp.ts licenceHeldMark).
 * ⛔ ROUND 5: NO SELLER REVIVE PUTS A SEAT'S ROW BACK ON, ANY TYPE — setStatusCore's relist and confirmCore's revive refuse
 * (403 review_seat_listing) every sold/hidden → active of a row a store seat owns: an OLDER verified sale or teacher profile
 * (from before the seat rules, which a status move alone would make public) and a held row alike. Hiding and marking sold
 * stay open; the lawyer's and an ordinary account's rows revive as before.
 * Same harness as listings.job-pay.test.ts: the real functions, a faked db, every payload inspected.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  updates: [] as Row[],
  statusWrites: [] as Row[],
  creates: [] as Row[],
  current: {} as Row,
  emails: {} as Record<string, string | null>,
  profileReads: [] as string[],
  profileDown: false,
}))

vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findUnique: async () => h.current,
      update: async ({ data }: Row) => { h.updates.push(data); return { id: 'listing-1' } },
      updateMany: async (a: Row) => { h.statusWrites.push(a); return { count: 1 } },
      create: async ({ data }: Row) => { h.creates.push(data); return { id: 'new-1', ...data } },
      count: async () => 0,
    },
    profile: {
      findUnique: async (a: Row) => {
        h.profileReads.push(a.where.id)
        if (h.profileDown) throw new Error('db down')
        return a.where.id in h.emails ? { email: h.emails[a.where.id] } : null
      },
    },
    seller: { findUnique: async () => null },
    // A teacher listing's relist keeps the TeacherProfile in step and purges its pages (setStatusCore).
    teacherProfile: { updateMany: async () => ({ count: 1 }), findUnique: async () => null },
    priceChange: { create: () => ({}) },
    $transaction: async (ops: unknown[]) => ops,
  },
}))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/trust', () => ({ recordEngagement: async () => {} }))
vi.mock('@/lib/stale', () => ({ canBump: () => false }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: () => true }))
vi.mock('@/lib/core/media', () => ({ isCanonicalVideoUrl: () => true, removeListingVideoByUrl: async () => {} }))
vi.mock('@/lib/brand', () => ({ categoryHasBrand: () => false, resolveBrand: async () => null, bumpBrandCount: async () => {}, enrichBrandLogoIfMissing: async () => {} }))
vi.mock('@/lib/syndicate', () => ({ syndicateListingIfPublic: async () => {} }))
vi.mock('@/lib/meta-capi', () => ({ sendMetaCapiEvent: async () => {}, metaUserDataFromHeaders: () => ({}) }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEvent: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0, recomputeRankScoreForListing: async () => {} }))
vi.mock('@/lib/compliance/account-state', () => ({ identityGateEnforced: () => false }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ assertSellerMayPublish: async () => {}, sellerPublishDecision: async () => ({ ok: true }) }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null }))
vi.mock('@/lib/publish-guard', () => ({
  assertPublishable: () => {},
  assertCleanTexts: () => {},
  assertCleanContactName: () => {},
  assertEnoughAngles: () => {},
  PublishBlockedError: class PublishBlockedError extends Error {},
}))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/price-drop', () => ({ priceChangeEffects: async () => ({ data: {}, audit: null, notify: null }) }))
// Not eno's desk, so a licence-aisle row is checked like anyone's (the seat's aisle edit below).
vi.mock('@/lib/edition-scope', async (orig) => ({ ...(await orig<Record<string, unknown>>()), deskSellerIds: async () => [] }))
vi.mock('@/lib/urgent', () => ({
  activateUrgentGate: async () => ({ ok: true, urgentUntil: new Date(Date.now() + 7 * 86_400_000) }),
  urgentQuotaFree: async () => true,
  URGENT: { DURATION_MS: 7 * 86_400_000 },
}))

const { createListingCore, setStatusCore, confirmCore, updateListingCore } = await import('@/lib/core/listings')
const { STORE_REVIEW_SEAT_EMAILS, REVIEW_SEAT_HELD_NOTE } = await import('@/lib/review-seat-accounts')
const { LICENCE_HELD_NOTE, licenceHeldMark } = await import('@/lib/licence-stamp')

const seller = (ownerId: string | null) => ({ id: 'seller-1', trustTier: 'standard', trustScore: 50, phone: null, ownerId })
const JOBS = { id: 'cat-jobs', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' }
const ELECTRONICS = { id: 'cat-el', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }
const create = (ownerId: string | null, category = ELECTRONICS, body: Row = {}) =>
  createListingCore({ seller: seller(ownerId), guestCreate: false, category, title: category === JOBS ? 'English teacher, full-time' : 'Oak writing desk', price: 1_500_000, body: { description: 'Solid oak, two drawers.', district: 'Bình Thạnh', ...body }, headers: new Headers() })
const HELD = { verified: false, verificationNotes: REVIEW_SEAT_HELD_NOTE }

/** The storefront's owner as the listing read selects it — by default a store seat. */
const owner = (email: string | null = 'app-review@eno.vn') => ({ trustTier: 'standard', ownerId: 'seat-owner', owner: { enforcementState: 'good_standing', email } })

/** A seat's listing as createListingCore stored it, later hidden by the seat — verified:false, the seat's mark. */
function seatRow(over: Row = {}): Row {
  return {
    title: 'Oak writing desk', description: 'Solid oak.', district: 'Bình Thạnh', location: 'Bình Thạnh', city: 'Ho Chi Minh City',
    brandSlug: null, model: null, subcategorySlug: null, images: [], video: null, condition: null, year: null, listingType: 'sell',
    titleVi: null, descriptionVi: null, price: 1_500_000, createdAt: new Date('2026-11-01'), sellerId: 'seller-1', attributes: null,
    previousPrice: null, priceDropAt: null, lowestNotifiedPrice: null, priceDropNotifiedAt: null, urgentUntil: null, negotiable: true,
    salaryM: null, affiliateUrl: null, priceUnit: 'VND', verificationMethod: null, identityHold: false,
    status: 'hidden', verified: false, verificationNotes: REVIEW_SEAT_HELD_NOTE,
    seller: owner(),
    category: { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' },
    // confirmCore's read (feed rank inputs).
    postedAt: new Date('2026-11-01'), sellerTrustScore: 50, featured: false, views: 0, contactCount: 0,
    ...over,
  }
}

beforeEach(() => {
  h.updates = []; h.statusWrites = []; h.creates = []; h.profileReads = []; h.profileDown = false
  h.emails = { 'seat-owner': 'app-review@eno.vn', 'shop-owner': 'shop@example.com', 'phone-owner': null, 'lawyer-owner': 'lawyer-review@eno.vn' }
  h.current = seatRow()
})

describe('createListingCore — a review seat\'s create is stored unpublished (wizard, /api/v1, MCP create_listing)', () => {
  it('⛔ verified:false with the seat\'s mark, never identityHold — and it answers `verified: false`, not the licence check\'s `held`', async () => {
    expect(await create('seat-owner')).toEqual({ id: 'new-1', verified: false })
    expect(h.creates[0]).toMatchObject(HELD)
    expect(h.creates[0].identityHold).toBeUndefined()
    expect(h.profileReads).toEqual(['seat-owner'])
  })

  it('⛔ every seat, whatever the case or stray whitespace its Profile holds', async () => {
    for (const email of STORE_REVIEW_SEAT_EMAILS) {
      h.creates = []
      h.emails['seat-owner'] = `\t${email.toUpperCase()} `
      expect(await create('seat-owner'), email).toEqual({ id: 'new-1', verified: false })
      expect(h.creates[0], email).toMatchObject(HELD)
    }
  })

  it('⛔ a seat\'s JOB post is held too — never public, so it can never draw a teacher into its thread', async () => {
    h.emails['seat-owner'] = 'ai-review@eno.vn'
    expect(await create('seat-owner', JOBS, { listingType: 'job', subcategorySlug: 'teaching', salaryM: 20 })).toEqual({ id: 'new-1', verified: false })
    expect(h.creates[0]).toMatchObject({ ...HELD, listingType: 'job', subcategorySlug: 'teaching' })
  })

  it('CONTROL: an ordinary owner, an ownerless storefront (no read), a no-email owner and the lawyer\'s seat publish exactly as before', async () => {
    expect(await create('shop-owner')).toEqual({ id: 'new-1', verified: true })
    expect(await create(null)).toEqual({ id: 'new-1', verified: true })
    expect(await create('phone-owner')).toEqual({ id: 'new-1', verified: true })
    // Luật Hoàng Phi's storefront (scripts/seed-hoangphi.ts): its listings publish normally (review-seat-accounts.ts).
    expect(await create('lawyer-owner')).toEqual({ id: 'new-1', verified: true })
    for (const d of h.creates) {
      expect(d.verified).toBe(true)
      expect(d.verificationNotes).toBeUndefined()
    }
    expect(h.profileReads).toEqual(['shop-owner', 'phone-owner', 'lawyer-owner'])
  })

  it('⛔ fails CLOSED: an owner read that fails creates nothing', async () => {
    h.profileDown = true
    await expect(create('seat-owner')).rejects.toThrow('db down')
    expect(h.creates).toEqual([])
  })
})

describe('the existing-row doors never publish a seat\'s held row', () => {
  it('⛔ a relist of the held row (setStatusCore hidden → active) is refused — nothing written', async () => {
    expect(await setStatusCore('listing-1', 'active')).toEqual({ ok: false, code: 403, error: 'review_seat_listing' })
    expect(h.statusWrites).toEqual([])
  })

  it('⛔ an edit (updateListingCore) never writes `verified` nor clears the seat\'s mark — and answers `unpublished`, never `held`', async () => {
    h.current = seatRow({ status: 'active' })
    expect(await updateListingCore('listing-1', { title: 'Oak writing desk, two drawers' })).toEqual({ ok: true, unpublished: true })
    expect(h.updates).toHaveLength(1)
    expect('verified' in h.updates[0]).toBe(false)
    expect('identityHold' in h.updates[0]).toBe(false)
    expect('verificationNotes' in h.updates[0]).toBe(false)
  })

  it('⛔ a licence re-hold keeps the SEAT\'s mark — never the licence mark licence-approve publishes by (licenceHeldMark)', () => {
    expect(licenceHeldMark({ verified: false, identityHold: false, verificationNotes: REVIEW_SEAT_HELD_NOTE })).toEqual({ verificationNotes: REVIEW_SEAT_HELD_NOTE })
    // CONTROL: every other row is marked as before.
    expect(licenceHeldMark({ verified: true, identityHold: false, verificationNotes: null })).toEqual({ verificationNotes: LICENCE_HELD_NOTE })
    expect(licenceHeldMark({ verified: false, identityHold: true, verificationNotes: null })).toEqual({ verificationNotes: LICENCE_HELD_NOTE })
    expect(licenceHeldMark({ verified: false, identityHold: false, verificationNotes: LICENCE_HELD_NOTE })).toEqual({ verificationNotes: LICENCE_HELD_NOTE })
    expect(licenceHeldMark({ verified: false, identityHold: false, verificationNotes: null })).toEqual({ verificationNotes: null })
  })
})

describe('⛔ round 5: no seller revive puts a store seat\'s row back on — ANY type (setStatusCore + confirmCore)', () => {
  // A seat's rows from BEFORE the seat rules: verified, live once, now sold or hidden — a status move alone would make
  // them public again. A sale and a teacher profile (a teacher row is never 'sold': only hidden).
  const older = (kind: 'sell' | 'teacher', email: string | null, over: Row = {}) => seatRow({
    verified: true, verificationNotes: null, seller: owner(email),
    ...(kind === 'teacher' ? { listingType: 'teacher', category: { slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên' } } : {}),
    ...over,
  })
  const CASES: Array<['sell' | 'teacher', 'hidden' | 'sold']> = [['sell', 'hidden'], ['sell', 'sold'], ['teacher', 'hidden']]

  it('⛔ setStatusCore → active is refused (403 review_seat_listing) for every store seat, in any case — nothing written, no extra read', async () => {
    for (const [kind, status] of CASES) {
      for (const email of [...STORE_REVIEW_SEAT_EMAILS, ' APP-REVIEW@ENO.VN ']) {
        h.current = older(kind, email, { status })
        expect(await setStatusCore('listing-1', 'active'), `${kind} ${status} ${email}`).toEqual({ ok: false, code: 403, error: 'review_seat_listing' })
      }
    }
    expect(h.statusWrites).toEqual([])
    expect(h.profileReads).toEqual([]) // read off the row the relist already loads
  })

  it('⛔ confirmCore ("still available") on such a row is refused the same — nothing written', async () => {
    for (const [kind, status] of CASES) {
      for (const email of [...STORE_REVIEW_SEAT_EMAILS, ' AI-Review@eno.vn']) {
        h.current = older(kind, email, { status })
        expect(await confirmCore('listing-1', 'seat-owner'), `${kind} ${status} ${email}`).toEqual({ ok: false, code: 403, error: 'review_seat_listing' })
      }
    }
    expect(h.statusWrites).toEqual([])
    expect(h.profileReads).toEqual([])
  })

  it('⛔ a seat\'s HELD row (verified:false, its mark) is refused through confirmCore too', async () => {
    expect(await confirmCore('listing-1', 'seat-owner')).toEqual({ ok: false, code: 403, error: 'review_seat_listing' })
    expect(h.statusWrites).toEqual([])
  })

  it('taking a seat\'s row DOWN stays open — hidden and sold are written as before; a confirm of a row already active is no revive', async () => {
    h.current = older('sell', 'app-review@eno.vn', { status: 'active' })
    expect(await setStatusCore('listing-1', 'hidden')).toEqual({ ok: true, status: 'hidden' })
    expect(await setStatusCore('listing-1', 'sold')).toEqual({ ok: true, status: 'sold' })
    h.current = older('teacher', 'play-review@eno.forum', { status: 'active' })
    expect(await setStatusCore('listing-1', 'hidden')).toEqual({ ok: true, status: 'hidden' })
    expect(h.statusWrites.map((w) => w.data.status)).toEqual(['hidden', 'sold', 'hidden'])
    h.current = older('sell', 'app-review@eno.vn', { status: 'active' })
    expect(await confirmCore('listing-1', 'seat-owner')).toEqual({ ok: true, bumped: false })
    expect(h.statusWrites).toHaveLength(4)
  })

  it('CONTROL: an ordinary account, a no-email owner and the LAWYER\'s seat revive their rows through both cores as before', async () => {
    for (const email of ['jane@example.com', null, 'lawyer-review@eno.vn']) {
      for (const [kind, status] of CASES) {
        h.statusWrites = []
        h.current = older(kind, email, { status })
        expect(await setStatusCore('listing-1', 'active'), `${kind} ${status} ${email}`).toEqual({ ok: true, status: 'active' })
        h.current = older(kind, email, { status })
        expect(await confirmCore('listing-1', 'owner-1'), `${kind} ${status} ${email}`).toEqual({ ok: true, bumped: false })
        expect(h.statusWrites.map((w) => w.data.status), `${kind} ${status} ${email}`).toEqual(['active', 'active'])
      }
    }
  })
})

describe('⛔ round 5: an edit of a store seat\'s row says when it is not public (`unpublished`) — and only a seat\'s', () => {
  const row = (email: string | null, over: Row = {}) => seatRow({ seller: owner(email), ...over })

  it('⛔ a seat\'s row that is not public after the save answers `unpublished: true` — held, hidden, or an older verified row it hid', async () => {
    for (const over of [{ status: 'active' }, { status: 'hidden' }, { status: 'sold', verified: false }, { status: 'hidden', verified: true, verificationNotes: null }]) {
      h.current = row('play-review@eno.forum', over)
      expect(await updateListingCore('listing-1', { title: 'Oak writing desk, two drawers' }), JSON.stringify(over)).toEqual({ ok: true, unpublished: true })
    }
  })

  it('⛔ a seat\'s save that writes nothing answers `unpublished` too', async () => {
    h.current = row('app-review@eno.vn', { status: 'active' })
    expect(await updateListingCore('listing-1', {})).toEqual({ ok: true, unpublished: true })
    expect(h.updates).toEqual([])
  })

  it('⛔ a seat\'s licence-aisle edit the check would hold answers `unpublished`, NEVER `held` — no approval publishes it', async () => {
    const VISA = { providerLegalName: 'CÔNG TY TNHH DỊCH VỤ VISA MẪU', providerLicenceNo: '79-123/2019/TCDL-GP LHQT' }
    const aisle = (email: string) => row(email, {
      status: 'active', verified: true, verificationNotes: null, listingType: 'service', subcategorySlug: 'visa-legal', attributes: JSON.stringify(VISA),
      title: 'e-Visa help', description: 'We prepare your e-visa application.', category: { slug: 'services', name: 'Services', nameVi: 'Dịch vụ' },
    })
    h.current = aisle('app-review@eno.vn')
    expect(await updateListingCore('listing-1', { title: 'e-Visa help in 3 days' })).toEqual({ ok: true, unpublished: true })
    expect(h.updates[0]).toMatchObject({ verified: false })
    // CONTROL: the same edit by an ordinary account answers `held`, exactly as before.
    h.updates = []
    h.current = aisle('shop@example.com')
    expect(await updateListingCore('listing-1', { title: 'e-Visa help in 3 days' })).toEqual({ ok: true, held: true })
  })

  it('a seat\'s OLDER row that is still public (verified, active or sold) answers the bare ack — its page is there', async () => {
    for (const status of ['active', 'sold']) {
      h.current = row('app-review@eno.vn', { status, verified: true, verificationNotes: null })
      expect(await updateListingCore('listing-1', { title: 'Oak writing desk, two drawers' }), status).toEqual({ ok: true })
    }
  })

  it('CONTROL: an ordinary account, a no-email owner and the LAWYER never get `unpublished` — a hidden or unverified row included', async () => {
    for (const email of ['jane@example.com', null, 'lawyer-review@eno.vn']) {
      for (const over of [{ status: 'hidden', verified: true, verificationNotes: null }, { status: 'active', verified: false, verificationNotes: null }]) {
        h.current = row(email, over)
        expect(await updateListingCore('listing-1', { title: 'Oak writing desk, two drawers' }), `${email} ${JSON.stringify(over)}`).toEqual({ ok: true })
      }
    }
  })
})
