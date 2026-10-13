import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A TEACHER'S HIDE / RELIST THROUGH A GENERIC DOOR PURGES EVERY PAGE THE PROFILE IS ON (review of the home shelf,
 * 2026-10-13). The dashboard row's Hide and Relist, /api/v1 and MCP reach setStatusCore, not the teacher routes, so it
 * used to purge only the listing's own page: the home page's "Find a teacher" shelf (6h ISR, no client fetch behind it),
 * /c/teachers and the profile's district page kept a hidden teacher — and kept a re-shown one away — for their windows.
 * Now every teacher status write that lands also purges /c/teachers, the district page and '/' (teachers/revalidate.ts),
 * after the write and never failing it — uncapped, and with no "did it change?" test on the pre-write read (a cap left a
 * takedown on the home shelf; the test raced a concurrent relist; teachers/revalidate.ts says why neither is needed).
 * deleteListingCore's half is in listings.delete.test.ts.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  row: null as Row | null,
  teacher: null as Row | null,
  /** Make the teacher-row read throw (a failed read must narrow the purge, never fail the status change). */
  teacherReadFails: false,
  purged: [] as string[],
  teacherSync: [] as Row[],
  logged: [] as Array<{ op?: string }>,
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findUnique: async () => (h.row ? { ...h.row } : null),
      updateMany: async (a: Row) => {
        if (!h.row || h.row.status === 'removed') return { count: 0 }
        Object.assign(h.row, a.data)
        return { count: 1 }
      },
    },
    teacherProfile: {
      updateMany: async (a: Row) => { h.teacherSync.push(a); return { count: h.teacher ? 1 : 0 } },
      findUnique: async (a: Row) => {
        if (h.teacherReadFails) throw new Error('db exploded')
        expect(a.where).toEqual({ listingId: 'L1' })
        return h.teacher
      },
    },
  },
}))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (p: string) => { h.purged.push(p) } }))
vi.mock('@/lib/log', () => ({ logError: (_e: unknown, ctx: { op?: string }) => { h.logged.push(ctx) }, logWarn: () => {} }))
vi.mock('@/lib/compliance/account-state', async (orig) => ({
  ...(await orig<typeof import('@/lib/compliance/account-state')>()),
  identityGateEnforced: () => false,
}))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }), assertSellerMayPublish: async () => {} }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null, releasedChargeStanding: async () => null, releasedChargeGateFor: async () => null }))
vi.mock('@/lib/core/sale-withdraw', () => ({ withdrawSaleQuestions: async () => {} }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/trust', () => ({ recordEngagement: async () => {} }))
vi.mock('@/lib/stale', () => ({ canBump: () => false }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: () => true, isListingVideoUrl: () => true, listingObjectKey: () => null }))
vi.mock('@/lib/core/media', () => ({ isCanonicalVideoUrl: () => true, removeListingVideoByUrl: async () => {} }))
vi.mock('@/lib/brand', () => ({ categoryHasBrand: () => false, resolveBrand: async () => null, bumpBrandCount: async () => {}, enrichBrandLogoIfMissing: async () => {} }))
vi.mock('@/lib/syndicate', () => ({ syndicateListingIfPublic: async () => {} }))
vi.mock('@/lib/meta-capi', () => ({ sendMetaCapiEvent: async () => {}, metaUserDataFromHeaders: () => ({}) }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEvent: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0, recomputeRankScoreForListing: async () => {} }))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/price-drop', () => ({ priceChangeEffects: async () => ({ data: {}, audit: null, notify: null }) }))
vi.mock('@/lib/urgent', () => ({ activateUrgentGate: async () => ({ ok: true }), urgentQuotaFree: () => true, URGENT: {} }))

const { setStatusCore } = await import('@/lib/core/listings')

/** A listing row as both of setStatusCore's reads see it. */
const listing = (status: string, listingType = 'teacher'): Row => ({
  id: 'L1', status, listingType, sellerId: 's1', soldAt: null, updatedAt: new Date('2026-10-01'),
  seller: { ownerId: 'p1', owner: { enforcementState: 'good_standing' } },
})

beforeEach(() => {
  h.row = null
  h.teacher = { currentDistrictKey: 'd7', currentDistrict: null }
  h.teacherReadFails = false
  h.purged = []
  h.teacherSync = []
  h.logged = []
})

describe('setStatusCore on a TEACHER\'s listing — the dashboard row, /api/v1, MCP', () => {
  it('Hide: the profile follows, and the listing page, /c/teachers, the district page and the HOME page are purged', async () => {
    h.row = listing('active')
    expect(await setStatusCore('L1', 'hidden')).toEqual({ ok: true, status: 'hidden' })
    expect(h.teacherSync).toEqual([{ where: { listingId: 'L1', status: { in: ['live', 'hidden'] } }, data: { status: 'hidden' } }])
    expect(h.purged).toEqual(['/listings/L1', '/c/teachers', '/c/teachers/d7', '/'])
  })

  it('a hide after any number of toggles still purges: no cap leaves a takedown on the home shelf', async () => {
    for (let i = 0; i < 70; i++) {
      h.row = listing(i % 2 ? 'hidden' : 'active')
      await setStatusCore('L1', i % 2 ? 'active' : 'hidden')
    }
    h.purged = []
    h.row = listing('active')
    expect(await setStatusCore('L1', 'hidden')).toEqual({ ok: true, status: 'hidden' })
    expect(h.purged).toEqual(['/listings/L1', '/c/teachers', '/c/teachers/d7', '/'])
  })

  it('Relist: the same pages, so a re-shown teacher is back on the home shelf without waiting out its six hours', async () => {
    h.row = listing('hidden')
    h.teacher = { currentDistrictKey: null, currentDistrict: 'Thủ Đức' } // a row the backfill has not migrated
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    expect(h.teacherSync[0].data).toEqual({ status: 'live' })
    expect(h.purged).toEqual(['/listings/L1', '/c/teachers', '/c/teachers/thu-duc', '/'])
  })

  it('a failed read of the teacher row narrows the purge to the pages that need no district — the hide still stands', async () => {
    h.row = listing('active')
    h.teacherReadFails = true
    expect(await setStatusCore('L1', 'hidden')).toEqual({ ok: true, status: 'hidden' })
    expect(h.row!.status).toBe('hidden')
    expect(h.purged).toEqual(['/listings/L1', '/c/teachers', '/'])
    expect(h.logged).toEqual([expect.objectContaining({ op: 'listings.status.teacherRow' })])
  })

  // No decision on the status read before the write: a re-send purges too — it may be repairing a row another door
  // desynced, and a concurrent relist may have landed between that read and this write.
  it.each([['hidden'], ['active']])('a re-sent "%s" on a row already in that status re-syncs the profile AND purges the teacher pages', async (st) => {
    h.row = listing(st)
    expect(await setStatusCore('L1', st)).toEqual({ ok: true, status: st })
    expect(h.teacherSync).toHaveLength(1)
    expect(h.purged).toEqual(['/listings/L1', '/c/teachers', '/c/teachers/d7', '/'])
  })

  it('"sold" is still refused for a person — and nothing is written or purged', async () => {
    h.row = listing('active')
    expect(await setStatusCore('L1', 'sold')).toEqual({ ok: false, code: 400, error: 'invalid_status' })
    expect(h.row!.status).toBe('active')
    expect(h.purged).toEqual([])
  })

  it('any other listing\'s hide purges its own page only — the teacher pages are a teacher\'s', async () => {
    h.row = listing('active', 'sell')
    expect(await setStatusCore('L1', 'hidden')).toEqual({ ok: true, status: 'hidden' })
    expect(h.teacherSync).toEqual([])
    expect(h.purged).toEqual(['/listings/L1'])
  })
})
