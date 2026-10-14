import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── A STATUS CHANGE BACK TO ACTIVE IS A PUBLISH FOR A LICENCE-AISLE ROW (R1, plan review 2026-10-14) ─────────────────
//
// A listing is public iff verified AND active, so a verified e-Visa or Legal & permits row that is hidden or sold goes
// public by its status alone. setStatusCore's relist and confirmCore's revive therefore refuse a non-desk aisle row eno's
// licence check has not cleared (`licence_check_required`, 409, no write), and AND licenceClearedWhere(desk) into their
// write — so a stamp cleared between the read and the write (an edit of a value, a revoke) makes the write miss.
// An active → active re-send, a hide and a mark-sold are never gated: nothing becomes public there.
//
// The fake below holds two rows: `read` is what the core's findUnique sees, `row` is what the database holds when the
// write arrives (the race); updateMany evaluates the WHERE it is handed against `row`, guard and all.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  read: null as Row | null,
  row: null as Row | null,
  writes: [] as Row[],
  /** deskSellerIds(): eno's own desk storefronts, and how often it was resolved. */
  desk: ['desk-seller'] as string[],
  deskReads: 0,
}))

/** Prisma's where semantics for the operators these writes use — enough to run the licence guard for real. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return (v as Row[]).every((w) => matches(row, w))
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w))
    const cell = row[k]
    if (v === null) return cell == null
    if (v && typeof v === 'object') {
      const f = v as Row
      if ('equals' in f && cell !== f.equals) return false
      if ('not' in f && cell === f.not) return false
      if ('in' in f && !(f.in as unknown[]).includes(cell)) return false
      // SQL: NULL NOT IN (…) is not true — which is why the guard carries its own `subcategorySlug: null` branch.
      if ('notIn' in f && (cell == null || (f.notIn as unknown[]).includes(cell))) return false
      if ('startsWith' in f && !(typeof cell === 'string' && cell.startsWith(f.startsWith as string))) return false
      return true
    }
    return cell === v
  })
}

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findUnique: async () => (h.read ? { ...h.read } : null),
      updateMany: async (a: Row) => {
        h.writes.push(a)
        if (!h.row || h.row.id !== a.where.id || !matches(h.row, a.where)) return { count: 0 }
        Object.assign(h.row, a.data)
        return { count: 1 }
      },
      count: async () => 0,
    },
    teacherProfile: { updateMany: async () => ({ count: 0 }) },
  },
}))
vi.mock('@/lib/edition-scope', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  deskSellerIds: async () => { h.deskReads++; return h.desk },
}))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/compliance/account-state', async (orig) => ({
  ...(await orig<typeof import('@/lib/compliance/account-state')>()),
  identityGateEnforced: () => false,
}))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }), assertSellerMayPublish: async () => {} }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null, releasedChargeStanding: async () => null, releasedChargeGateFor: async () => null }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/trust', () => ({ recordEngagement: async () => {} }))
vi.mock('@/lib/stale', () => ({ canBump: () => false }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEvent: async () => {}, dispatchListingEventsBatch: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0, recomputeRankScoreForListing: async () => {} }))

const { setStatusCore, confirmCore } = await import('@/lib/core/listings')
const { licenceClearedWhere, licenceStampFor } = await import('@/lib/licence-stamp')

const VALUES = { legalName: 'CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ DU LỊCH VIETKITE', licenceNo: '79-123/2019/TCDL-GP LHQT' }
const ATTRS = JSON.stringify({ providerLegalName: VALUES.legalName, providerLicenceNo: VALUES.licenceNo })

/** A listing as both reads select it — an ordinary seller's e-Visa row by default, verified, in `status`. */
function listing(status: string, overrides: Row = {}): Row {
  return {
    id: 'L1', status, sellerId: 'seller-1', listingType: 'service', verified: true,
    postedAt: new Date('2026-09-01'), sellerTrustScore: 100, featured: false, views: 0, contactCount: 0,
    soldAt: null, updatedAt: new Date('2026-09-01'),
    seller: { ownerId: 'owner-1', owner: { enforcementState: 'good_standing' } },
    category: { slug: 'services' }, subcategorySlug: 'visa-legal', attributes: ATTRS, verificationMethod: null,
    ...overrides,
  }
}
const stamp = (sellerId = 'seller-1', subcategorySlug = 'visa-legal') => licenceStampFor({ sellerId, subcategorySlug }, VALUES)
/** The same row read and written — no race. */
function given(r: Row) { h.read = r; h.row = { ...r } }

const WAITING = { ok: false, code: 409, error: 'licence_check_required' }
const NOT_FOUND = { ok: false, code: 404, error: 'not_found' }

beforeEach(() => {
  h.read = null
  h.row = null
  h.writes = []
  h.desk = ['desk-seller']
  h.deskReads = 0
})

describe('setStatusCore — a relist of a licence-aisle row eno has not checked is refused, never written', () => {
  it.each([
    ['no values (a legacy row, or VietKite’s after its grandfather)', { attributes: null }],
    ['values, never approved', {}],
    ['an approval of OTHER values (the number changed while it was hidden)', { verificationMethod: licenceStampFor({ sellerId: 'seller-1', subcategorySlug: 'visa-legal' }, { ...VALUES, licenceNo: '79-999/2019/TCDL-GP LHQT' }) }],
    ['an approval in the OTHER aisle (moved since)', { subcategorySlug: 'legal-permits', verificationMethod: stamp('seller-1', 'visa-legal') }],
    ['a legacy verificationMethod value', { verificationMethod: 'manual' }],
  ])('⛔ hidden → active, %s: 409 licence_check_required, no write', async (_label, overrides) => {
    given(listing('hidden', overrides))
    expect(await setStatusCore('L1', 'active')).toEqual(WAITING)
    expect(h.writes).toEqual([])
    expect(h.row!.status).toBe('hidden')
  })

  it('sold → active of an unchecked Legal & permits row: the same', async () => {
    given(listing('sold', { subcategorySlug: 'legal-permits' }))
    expect(await setStatusCore('L1', 'active')).toEqual(WAITING)
    expect(h.writes).toEqual([])
  })

  it('an APPROVED row relists — and its write carries the licence guard, with the desk it resolved', async () => {
    given(listing('hidden', { verificationMethod: stamp() }))
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    expect(h.writes[0].where).toEqual({ id: 'L1', status: { not: 'removed', equals: 'hidden' }, AND: [licenceClearedWhere(['desk-seller'])] })
    expect(h.row!.status).toBe('active')
  })

  it('eno’s desk relists its own e-Visa row with no values — and an UNRESOLVED desk fails closed', async () => {
    given(listing('hidden', { sellerId: 'desk-seller', attributes: null }))
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    given(listing('hidden', { sellerId: 'desk-seller', attributes: null }))
    h.desk = []
    expect(await setStatusCore('L1', 'active')).toEqual(WAITING)
  })

  it('⛔ the race: approved at the read, the stamp cleared before the write (a changed value, a revoke) → the write misses, 404', async () => {
    h.read = listing('hidden', { verificationMethod: stamp() })
    h.row = { ...h.read, verificationMethod: null }
    expect(await setStatusCore('L1', 'active')).toEqual(NOT_FOUND)
    expect(h.row!.status).toBe('hidden')
  })

  it('outside the two aisles nothing more is read — the write carries the guard, whose subcategory branches match', async () => {
    given(listing('hidden', { subcategorySlug: 'cleaning', attributes: null }))
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    expect(h.deskReads).toBe(0)
    expect(h.writes[0].where.AND).toEqual([licenceClearedWhere([])])
    given(listing('sold', { category: { slug: 'vehicles' }, subcategorySlug: null, attributes: null }))
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    expect(h.deskReads).toBe(0)
  })

  // ⛔ Commit gate, 2026-10-14: a listing still WAITING for the check (verified=false) does not become public by going
  // active, so its seller may un-hide it like any held listing — it stays held, and its write carries no licence guard.
  it('a hidden row still WAITING for the check (unverified) is un-hidden like any held listing: no 409, no guard, still unverified', async () => {
    given(listing('hidden', { verified: false }))
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    expect(h.writes[0].where).toEqual({ id: 'L1', status: { not: 'removed', equals: 'hidden' } })
    expect(h.row).toMatchObject({ status: 'active', verified: false })
    expect(h.deskReads).toBe(0)
  })

  it('an active → active re-send of an unchecked row (the sync’s every-row "active") is no transition: not refused, no guard', async () => {
    given(listing('active', { attributes: null }))
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    expect(h.writes[0].where).toEqual({ id: 'L1', status: { not: 'removed', equals: 'active' } })
    expect(h.deskReads).toBe(0)
  })

  it('taking an unchecked row DOWN is never gated — hide and mark sold', async () => {
    given(listing('active', { attributes: null }))
    expect(await setStatusCore('L1', 'hidden')).toEqual({ ok: true, status: 'hidden' })
    given(listing('active', { attributes: null }))
    expect(await setStatusCore('L1', 'sold')).toEqual({ ok: true, status: 'sold' })
    expect(h.deskReads).toBe(0)
  })
})

describe('confirmCore — a "still available" that would REVIVE an unchecked aisle row is refused the same way', () => {
  it('⛔ sold → active, no approval: 409 licence_check_required, no write', async () => {
    given(listing('sold'))
    expect(await confirmCore('L1', 'owner-1')).toEqual(WAITING)
    expect(h.writes).toEqual([])
  })

  it('an approved row revives — through the guarded write', async () => {
    given(listing('hidden', { verificationMethod: stamp() }))
    expect(await confirmCore('L1', 'owner-1')).toEqual({ ok: true, bumped: false })
    expect(h.writes[0].where).toEqual({ id: 'L1', status: { not: 'removed', equals: 'hidden' }, AND: [licenceClearedWhere(['desk-seller'])] })
    expect(h.row!.status).toBe('active')
  })

  it('⛔ the race on a revive: the stamp cleared before the write → 404, still hidden', async () => {
    h.read = listing('hidden', { verificationMethod: stamp() })
    h.row = { ...h.read, verificationMethod: null }
    expect(await confirmCore('L1', 'owner-1')).toEqual(NOT_FOUND)
    expect(h.row!.status).toBe('hidden')
  })

  it('an ordinary confirm of a row that is ALREADY active is not a revive — not refused, no guard, nothing read', async () => {
    given(listing('active', { attributes: null }))
    expect(await confirmCore('L1', 'owner-1')).toEqual({ ok: true, bumped: false })
    expect(h.writes[0].where).toEqual({ id: 'L1', status: { not: 'removed', equals: 'active' } })
    expect(h.deskReads).toBe(0)
  })
})
