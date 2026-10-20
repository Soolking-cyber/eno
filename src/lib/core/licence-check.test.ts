import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LICENCE_GRANDFATHER, licenceGrandfatherEndsAt, licenceStampFor } from '@/lib/licence-stamp'

/**
 * THE LICENCE CHECK'S SERVER HALVES (src/lib/core/licence-check.ts, owner 2026-10-14). Pinned: licenceBlockedIds names
 * exactly the uncleared non-desk aisle rows; the daily sweep unpublishes verified, uncleared, non-desk aisle rows in ANY
 * status — never the desk's, a cleared one or (before its end) VietKite's grandfathered ones — with a compare-and-set on
 * the values it read and one audit row each; and it refuses an unresolved desk and a mass pull, writing nothing.
 * R7 (plan review, 2026-10-14): inside the window it also refuses, writing nothing, unless LICENCE_GRANDFATHER's id,
 * handle and owner name ONE storefront — a restore that changed the ids must not pull VietKite's live rows early.
 */

type Row = Record<string, any>
const DESK = 'desk-seller'
const VK = LICENCE_GRANDFATHER.sellerId
/** A storefront as the seller read sees it; `email: null` is a storefront with no owner account. */
type Storefront = { id: string; handle: string | null; email: string | null }
const VIETKITE: Storefront = { id: VK, handle: 'vietkite', email: 'info@vietkite.com.vn' }
const END = licenceGrandfatherEndsAt()
const V = { legalName: 'CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ DU LỊCH VIETKITE', licenceNo: '79-123/2019/TCDL-GP LHQT' }
const LP = { legalName: 'CÔNG TY LUẬT ABC', licenceNo: '0312345678' }
const attrs = (v: { legalName: string; licenceNo: string } | null) =>
  JSON.stringify({ visaSpeed: 'standard', ...(v ? { providerLegalName: v.legalName, providerLicenceNo: v.licenceNo } : {}) })

// The licence WHITELIST (src/lib/licence-whitelist.ts — owner, 2026-10-15) is switchable here: EMPTY by default, so the
// tests below pin the check as it runs for everyone else (VietKite's grandfather included); the whitelist's own tests
// turn it on.
const wl = vi.hoisted(() => ({ list: [] as Array<{ sellerId: string; name: string; aisles: string[] }> }))
vi.mock('@/lib/licence-whitelist', () => ({
  get LICENCE_WHITELIST() { return wl.list },
  isLicenceWhitelisted: (sellerId: string | null | undefined, sub: string | null | undefined) =>
    !!sellerId && !!sub && wl.list.some((w) => w.sellerId === sellerId && w.aisles.includes(sub)),
}))
const h = vi.hoisted(() => ({
  rows: [] as Row[],
  desk: [] as string[],
  deskCalls: 0,
  sellers: [] as Array<{ id: string; handle: string | null; email: string | null }>,
  sellerReads: [] as Row[],
  audits: [] as Row[],
  writes: [] as Row[],
  reads: [] as Row[],
  refreshed: [] as Array<{ ids: string[]; op: string; opts: Row }>,
  /** Runs once, right after the next findMany — a concurrent edit or approval between the read and the write. */
  afterRead: null as null | (() => void),
}))

/** The where-operators the module uses, over a row whose category is `categorySlug`. */
const eq = (v: unknown, c: unknown) => (c === null ? v === null : v === c)
const matches = (r: Row, w: Row): boolean => Object.entries(w).every(([k, c]) => {
  if (k === 'category') return r.categorySlug === c.slug
  const v = r[k]
  if (c && typeof c === 'object') {
    if ('in' in c) return c.in.includes(v)
    if ('not' in c) return v !== c.not
    throw new Error(`unexpected condition on ${k}`)
  }
  return eq(v, c)
})
const pick = (r: Row, select: Row): Row => Object.fromEntries(Object.keys(select).map((k) => [k, k === 'category' ? { slug: r.categorySlug } : r[k]]))

/** The three seller conditions licenceGrandfatherProblem ORs: id, handle, owner email (case-insensitive). */
const sellerHit = (s: Storefront, c: Row): boolean => {
  if ('id' in c) return s.id === c.id
  if ('handle' in c) return s.handle === c.handle.handle
  if ('owner' in c) {
    if (c.owner.email.mode !== 'insensitive') throw new Error('the owner email must compare case-insensitively')
    return s.email !== null && s.email.toLowerCase() === c.owner.email.equals.toLowerCase()
  }
  throw new Error(`unexpected seller condition ${JSON.stringify(c)}`)
}

vi.mock('@/lib/db', () => {
  const db: Row = {
    seller: {
      findMany: async (a: Row) => {
        h.sellerReads.push(a)
        return h.sellers
          .filter((s) => (a.where.OR as Row[]).some((c) => sellerHit(s, c)))
          .map((s) => ({ id: s.id, handle: s.handle === null ? null : { handle: s.handle }, owner: s.email === null ? null : { email: s.email } }))
      },
    },
    listing: {
      findMany: async (a: Row) => {
        h.reads.push(a)
        const out = h.rows.filter((r) => matches(r, a.where)).map((r) => pick(r, a.select))
        const after = h.afterRead
        h.afterRead = null
        after?.()
        return out
      },
      updateMany: async (a: Row) => {
        h.writes.push(a)
        const hit = h.rows.filter((r) => matches(r, a.where))
        for (const r of hit) Object.assign(r, a.data)
        return { count: hit.length }
      },
    },
  }
  db.$transaction = async (fn: (tx: Row) => unknown) => fn(db)
  return { db }
})
vi.mock('@/lib/edition-scope', () => ({ deskSellerIds: async () => { h.deskCalls++; return h.desk } }))
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async (_tx: unknown, input: Row) => { h.audits.push(input) } }))
vi.mock('@/lib/listing-surfaces', () => ({ refreshListingSurfaces: (ids: string[], op: string, opts: Row) => { h.refreshed.push({ ids, op, opts }) } }))

const { licenceBlockedIds, licenceGrandfatherProblem, sweepLicenceHolds, LICENCE_SWEEP_DESK_UNRESOLVED } = await import('./licence-check')

/** An aisle row; `stamp` writes the stamp of its own values (an admin approved them). */
function listing(id: string, over: Row = {}, opts: { stamp?: boolean } = {}): Row {
  const r: Row = {
    id, sellerId: 's-1', categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: attrs(V),
    verificationMethod: null, verified: true, status: 'active', identityHold: false, ...over,
  }
  if (opts.stamp) {
    const bag = JSON.parse(r.attributes)
    r.verificationMethod = licenceStampFor({ sellerId: r.sellerId, subcategorySlug: r.subcategorySlug }, { legalName: bag.providerLegalName, licenceNo: bag.providerLicenceNo })
  }
  return r
}
const ids = (rows: Row[]) => rows.map((r) => r.id).sort()
const row = (id: string) => h.rows.find((r) => r.id === id)!

beforeEach(() => {
  wl.list = []
  h.rows = []
  h.desk = [DESK]
  h.deskCalls = 0
  // VietKite resolves (its id, handle and owner name one storefront), beside a storefront none of the three names.
  h.sellers = [{ ...VIETKITE }, { id: DESK, handle: 'eno', email: 'support@eno.forum' }]
  h.sellerReads = []
  h.audits = []
  h.writes = []
  h.reads = []
  h.refreshed = []
  h.afterRead = null
})

describe('licenceBlockedIds', () => {
  beforeEach(() => {
    h.rows = [
      listing('cleaning', { subcategorySlug: 'cleaning', attributes: null }),
      listing('desk-no-values', { sellerId: DESK, attributes: null }),
      listing('stamped', {}, { stamp: true }),
      listing('lp-stamped', { subcategorySlug: 'legal-permits', attributes: attrs(LP) }, { stamp: true }),
      listing('no-values', { attributes: attrs(null) }),
      listing('values-no-stamp'),
      listing('stale-stamp', { verificationMethod: licenceStampFor({ sellerId: 's-1', subcategorySlug: 'visa-legal' }, { ...V, licenceNo: '79-999/2019/TCDL-GP LHQT' }) }),
      listing('moved', { subcategorySlug: 'legal-permits' }),
      listing('legacy', { verificationMethod: 'manual' }),
    ]
    // `moved` carries the stamp of its values in the OTHER aisle — a move invalidates it.
    row('moved').verificationMethod = licenceStampFor({ sellerId: 's-1', subcategorySlug: 'visa-legal' }, V)
  })

  it('returns only the uncleared non-desk aisle ids', async () => {
    const out = await licenceBlockedIds(h.rows.map((r) => r.id))
    expect([...out].sort()).toEqual(['legacy', 'moved', 'no-values', 'stale-stamp', 'values-no-stamp'])
  })

  it('one read, of the aisle rows among the ids, selecting what the check needs', async () => {
    await licenceBlockedIds(['cleaning', 'stamped'])
    expect(h.reads).toHaveLength(1)
    expect(h.reads[0].where).toEqual({ id: { in: ['cleaning', 'stamped'] }, subcategorySlug: { in: ['visa-legal', 'legal-permits'] } })
    expect(Object.keys(h.reads[0].select).sort()).toEqual(['attributes', 'category', 'id', 'sellerId', 'subcategorySlug', 'verificationMethod'])
  })

  it('an empty id list reads nothing; a passed desk list is used as given', async () => {
    expect(await licenceBlockedIds([])).toEqual(new Set())
    expect(h.reads).toHaveLength(0)
    expect(h.deskCalls).toBe(0)
    // With no desk, the desk's unstamped row is held like anyone's (fail closed).
    expect([...(await licenceBlockedIds(['desk-no-values'], []))]).toEqual(['desk-no-values'])
    expect(h.deskCalls).toBe(0)
    expect([...(await licenceBlockedIds(['desk-no-values']))]).toEqual([])
    expect(h.deskCalls).toBe(1)
  })
})

describe('sweepLicenceHolds', () => {
  const before = new Date(END - 60_000)
  const after = new Date(END + 60_000)

  beforeEach(() => {
    h.rows = [
      listing('active', { attributes: attrs(null) }),
      listing('hidden', { status: 'hidden' }),
      listing('sold', { status: 'sold', subcategorySlug: 'legal-permits', attributes: attrs(LP) }),
      listing('desk', { sellerId: DESK, attributes: null }),
      listing('cleared', {}, { stamp: true }),
      listing('vk-1', { sellerId: VK, attributes: attrs(null) }),
      listing('vk-2', { sellerId: VK, attributes: attrs(null), status: 'hidden' }),
      listing('vk-values', { sellerId: VK }),
      listing('unpublished', { verified: false, attributes: attrs(null) }),
      listing('tombstone', { status: 'removed', verified: true, attributes: attrs(null) }),
      listing('cleaning', { subcategorySlug: 'cleaning', attributes: null }),
    ]
  })

  it('pulls verified, uncleared, non-desk aisle rows whatever their status; skips the desk, cleared and grandfathered rows', async () => {
    const r = await sweepLicenceHolds({ now: before })
    expect(r.pulledIds.sort()).toEqual(['active', 'hidden', 'sold', 'vk-values'])
    expect(r).toMatchObject({ checked: 8, deskExempt: 1, grandfathered: 2, pulled: 4, grandfatherUntil: LICENCE_GRANDFATHER.until })
    for (const id of ['active', 'hidden', 'sold', 'vk-values']) expect(row(id), id).toMatchObject({ verified: false, identityHold: false })
    for (const id of ['desk', 'cleared', 'vk-1', 'vk-2', 'tombstone']) expect(row(id).verified, id).toBe(true)
    // Statuses are untouched: a pull is a hold, not a status change.
    expect(row('hidden').status).toBe('hidden')
    expect(row('sold').status).toBe('sold')
  })

  it('reads only live rows in the two aisles of services, never a tombstone', async () => {
    await sweepLicenceHolds({ now: before })
    expect(h.reads[0].where).toEqual({ verified: true, status: { not: 'removed' }, category: { slug: 'services' }, subcategorySlug: { in: ['visa-legal', 'legal-permits'] } })
  })

  it('pulls VietKite’s rows once the grandfather has ended', async () => {
    const r = await sweepLicenceHolds({ now: after })
    expect(r.pulledIds.sort()).toEqual(['active', 'hidden', 'sold', 'vk-1', 'vk-2', 'vk-values'])
    expect(r.grandfathered).toBe(0)
  })

  it('throws when the desk does not resolve, before reading or writing anything', async () => {
    h.desk = []
    await expect(sweepLicenceHolds({ now: before })).rejects.toThrow(LICENCE_SWEEP_DESK_UNRESOLVED)
    expect(LICENCE_SWEEP_DESK_UNRESOLVED).toBe('licence sweep: desk unresolved')
    expect(h.reads).toHaveLength(0)
    expect(h.writes).toHaveLength(0)
    expect(row('desk').verified).toBe(true)
  })

  it('each write is an updateMany compare-and-set on the stamp, the aisle and the attributes it read', async () => {
    await sweepLicenceHolds({ now: before })
    expect(h.writes).toHaveLength(4)
    const w = h.writes.find((x) => x.where.id === 'sold')!
    expect(w).toEqual({
      where: { id: 'sold', verified: true, status: { not: 'removed' }, verificationMethod: null, subcategorySlug: 'legal-permits', attributes: attrs(LP) },
      // …marked as the licence check's own hold (licence-stamp.ts LICENCE_HELD_NOTE): approving its values puts it back.
      data: { verified: false, identityHold: false, verificationNotes: 'licence:held' },
    })
  })

  it('appends one listing.licence_unpublished audit row per pulled row, as the system', async () => {
    await sweepLicenceHolds({ now: before })
    expect(h.audits.map((a) => a.subjectId).sort()).toEqual(['active', 'hidden', 'sold', 'vk-values'])
    expect(h.audits.find((a) => a.subjectId === 'sold')).toEqual({
      actorType: 'system', action: 'listing.licence_unpublished', subjectType: 'listing', subjectId: 'sold',
      detail: { subcategory: 'legal-permits', reason: 'no_checked_licence' }, legalBasis: 'ecommerceLaw',
    })
  })

  it('refreshes the pulled listings’ surfaces, home included', async () => {
    const r = await sweepLicenceHolds({ now: before })
    expect(h.refreshed).toHaveLength(1)
    expect(h.refreshed[0]).toEqual({ ids: r.pulledIds, op: 'licence.sweep', opts: { home: true } })
  })

  /**
   * ⛔ WHY THE SWEEP NEEDS NO /c/teachers PURGE (2026-10-20). Every other takedown of a teacher profile purges /c/teachers,
   * whose 6h-ISR HTML names every live profile (its grid and the "More teachers" list); this one cannot pull a profile
   * at all — its read is the services category's two licence aisles (pinned above), and a teacher profile lives in its
   * own category. A live teacher row, even one whose subcategory slug were an aisle's, is never read or pulled.
   */
  it('never reads or pulls a teacher profile, so it has no /c/teachers to purge', async () => {
    h.rows.push(
      listing('teacher', { categorySlug: 'teachers', subcategorySlug: 'ielts-exam', listingType: 'teacher', attributes: null }),
      listing('teacher-odd-slug', { categorySlug: 'teachers', listingType: 'teacher', attributes: attrs(null) }),
    )
    const r = await sweepLicenceHolds({ now: before })
    expect(r.pulledIds).not.toContain('teacher')
    expect(r.pulledIds).not.toContain('teacher-odd-slug')
    expect(row('teacher').verified).toBe(true)
    expect(row('teacher-odd-slug').verified).toBe(true)
    expect(h.refreshed.map((c) => c.opts)).toEqual([{ home: true }])
  })

  it('a row approved or edited since the read is not pulled, and gets no audit row', async () => {
    h.afterRead = () => {
      // An admin approves `hidden` (its stamp is written); the seller edits `active`'s values.
      const hidden = row('hidden')
      hidden.verificationMethod = licenceStampFor({ sellerId: hidden.sellerId, subcategorySlug: hidden.subcategorySlug }, V)
      row('active').attributes = attrs(V)
    }
    const r = await sweepLicenceHolds({ now: before })
    expect(r.pulledIds.sort()).toEqual(['sold', 'vk-values'])
    expect(row('hidden').verified).toBe(true)
    expect(row('active').verified).toBe(true)
    expect(h.audits.map((a) => a.subjectId).sort()).toEqual(['sold', 'vk-values'])
  })

  it('dryRun reports what it would pull and writes nothing', async () => {
    const r = await sweepLicenceHolds({ now: before, dryRun: true })
    expect(r).toMatchObject({ dryRun: true, checked: 8, deskExempt: 1, grandfathered: 2, pulled: 4 })
    expect(r.pulledIds.sort()).toEqual(['active', 'hidden', 'sold', 'vk-values'])
    expect(h.writes).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
    expect(h.refreshed).toHaveLength(0)
    expect(row('active').verified).toBe(true)
  })

  // ⛔ The cap is only the suspicious case — a STALE stamp (commit gate, 2026-10-14). A row that never carried a stamp was
  // never approved, so it is pulled whatever the count: an all-or-nothing cap kept unchecked listings live past the
  // in-force date as soon as anything else in the aisles broke.
  it('rows that never carried a stamp are pulled whatever the count — the cap does not apply to them', async () => {
    const r = await sweepLicenceHolds({ now: before, maxPull: 3 })
    expect(r.refused).toBeUndefined()
    expect(r).toMatchObject({ pulled: 4, checked: 8 })
    expect(r.pulledIds.sort()).toEqual(['active', 'hidden', 'sold', 'vk-values'])
    // The default cap is 50 — 51 more never-stamped rows are pulled too.
    for (let i = 0; i < 51; i++) h.rows.push(listing(`bulk-${i}`, { attributes: attrs(null) }))
    const all = await sweepLicenceHolds({ now: before })
    expect(all.refused).toBeUndefined()
    expect(all.pulled).toBe(51)
  })

  it('more than maxPull STALE stamps refuses as a mass pull: those stay live, the never-stamped rows are still pulled', async () => {
    // Stamps of other values than the rows carry — what a broken stamp recipe would make of approved rows.
    const staleStamp = licenceStampFor({ sellerId: 's-1', subcategorySlug: 'visa-legal' }, { ...V, licenceNo: '79-555/2019/TCDL-GP LHQT' })
    for (let i = 0; i < 4; i++) h.rows.push(listing(`stale-${i}`, { verificationMethod: staleStamp }))
    const r = await sweepLicenceHolds({ now: before, maxPull: 3 })
    expect(r).toMatchObject({ refused: 'mass_pull', wouldPull: 4 })
    expect(r.pulledIds.sort()).toEqual(['active', 'hidden', 'sold', 'vk-values'])
    for (let i = 0; i < 4; i++) expect(row(`stale-${i}`).verified, `stale-${i}`).toBe(true)
    expect(h.audits.map((a) => a.subjectId).sort()).toEqual(['active', 'hidden', 'sold', 'vk-values'])
    // Within the cap, stale stamps are pulled like any other uncleared row.
    for (let i = 0; i < 4; i++) row(`stale-${i}`).verified = true
    const within = await sweepLicenceHolds({ now: before, maxPull: 10 })
    expect(within.refused).toBeUndefined()
    for (let i = 0; i < 4; i++) expect(row(`stale-${i}`).verified, `stale-${i}`).toBe(false)
  })

  it('a second run finds nothing left to pull (idempotent)', async () => {
    await sweepLicenceHolds({ now: before })
    h.writes = []
    const r = await sweepLicenceHolds({ now: before })
    expect(r.pulled).toBe(0)
    expect(h.writes).toHaveLength(0)
    expect(ids(h.rows.filter((x) => x.verified))).toEqual(['cleaning', 'cleared', 'desk', 'tombstone', 'vk-1', 'vk-2'])
  })
})

// ⛔ Owner, 2026-10-15: "whitelist vietkite" (src/lib/licence-whitelist.ts) — VietKite's e-Visa rows are exempt before and
// after the grandfather's end (which no longer decides anything for them).
describe('sweepLicenceHolds — the licence whitelist', () => {
  const before = new Date(END - 60_000)
  const after = new Date(END + 60_000)

  beforeEach(() => {
    wl.list = [{ sellerId: VK, name: 'vietkite', aisles: ['visa-legal'] }]
    h.rows = [
      listing('active', { attributes: attrs(null) }),
      listing('desk', { sellerId: DESK, attributes: null }),
      listing('vk-1', { sellerId: VK, attributes: attrs(null) }),
      listing('vk-values', { sellerId: VK }),
      listing('vk-lp', { sellerId: VK, subcategorySlug: 'legal-permits', attributes: attrs(null) }),
    ]
  })

  it.each([['before', before], ['after', after]] as const)('%s the grandfather’s end: VietKite’s e-Visa rows are exempt and counted; its Legal & permits row is pulled like anyone’s', async (_label, now) => {
    const r = await sweepLicenceHolds({ now })
    expect(r.refused).toBeUndefined()
    expect(r).toMatchObject({ deskExempt: 1, whitelisted: 2, grandfathered: 0 })
    expect(r.pulledIds.sort()).toEqual(['active', 'vk-lp'])
    for (const id of ['vk-1', 'vk-values', 'desk']) expect(row(id).verified, id).toBe(true)
  })

  it('reads no storefront: the id is the identity (claim-once ownership) — and the moot grandfather is never read', async () => {
    await sweepLicenceHolds({ now: before })
    await sweepLicenceHolds({ now: after })
    expect(h.sellerReads).toEqual([])
  })

  // Commit gate, 2026-10-15: a vanished id (a restore that re-created the storefront) exempts NOBODY — VietKite is then
  // checked like anyone, fail closed by construction.
  it('⛔ a restore that gave VietKite a new id: the whitelist matches nothing — its unchecked rows are swept like anyone’s', async () => {
    for (const id of ['vk-1', 'vk-values', 'vk-lp']) row(id).sellerId = 'vk-restored'
    const r = await sweepLicenceHolds({ now: after })
    expect(r).toMatchObject({ whitelisted: 0 })
    expect(r.refused).toBeUndefined()
    expect(r.pulledIds.sort()).toEqual(['active', 'vk-1', 'vk-lp', 'vk-values'])
  })

  it('an empty whitelist exempts nothing', async () => {
    wl.list = []
    const r = await sweepLicenceHolds({ now: after })
    expect(r.whitelisted).toBe(0)
    expect(r.pulledIds.sort()).toEqual(['active', 'vk-1', 'vk-lp', 'vk-values'])
  })
})

describe('sweepLicenceHolds — the grandfather is honoured only while its id still names VietKite (R7)', () => {
  const before = new Date(END - 60_000)
  const after = new Date(END + 60_000)

  beforeEach(() => {
    h.rows = [
      listing('active', { attributes: attrs(null) }),
      listing('desk', { sellerId: DESK, attributes: null }),
      listing('vk-1', { sellerId: VK, attributes: attrs(null) }),
      listing('vk-2', { sellerId: VK, attributes: attrs(null), status: 'hidden' }),
    ]
  })

  /**
   * A grandfather refusal holds back the rows of every storefront its id, handle or owner names (VietKite's here) — they
   * stay live — and still pulls every OTHER unchecked row: 'active' (commit gate, 2026-10-14).
   */
  const heldBackVietKite = () => {
    for (const id of ['vk-1', 'vk-2', 'desk']) expect(row(id).verified, id).toBe(true)
    expect(h.audits.map((a) => a.subjectId)).toEqual(['active'])
  }

  it('reads the storefront once, by id, handle and owner — and sweeps as usual when all three name VietKite', async () => {
    const r = await sweepLicenceHolds({ now: before })
    expect(h.sellerReads).toHaveLength(1)
    expect(h.sellerReads[0]).toEqual({
      where: { OR: [{ id: VK }, { handle: { handle: 'vietkite' } }, { owner: { email: { equals: 'info@vietkite.com.vn', mode: 'insensitive' } } }] },
      select: { id: true, handle: { select: { handle: true } }, owner: { select: { email: true } } },
    })
    expect(r.refused).toBeUndefined()
    expect(r).toMatchObject({ grandfathered: 2, pulled: 1, pulledIds: ['active'] })
  })

  it('a restore that changed the ids: refused, no row grandfathered, nothing written — the real run and the dry run', async () => {
    h.sellers = [{ ...VIETKITE, id: 'vk-restored' }]
    for (const id of ['vk-1', 'vk-2']) row(id).sellerId = 'vk-restored'
    // The dry run first (it writes nothing), then the real run: both report the same.
    for (const dryRun of [true, false]) {
      const r = await sweepLicenceHolds({ now: before, dryRun })
      expect(r, `dryRun ${dryRun}`).toMatchObject({
        refused: 'grandfather_unresolved', grandfathered: 0, pulled: 1, pulledIds: ['active'], wouldPull: 2, checked: 4, deskExempt: 1,
        grandfatherProblem: `storefront vk-restored: its id is not ${VK}`,
      })
    }
    heldBackVietKite()
  })

  it('the id names a storefront whose handle and owner are not VietKite’s: refused, and VietKite’s rows count as to pull', async () => {
    h.sellers = [{ id: VK, handle: 'someone-else', email: 'owner@example.com' }]
    const r = await sweepLicenceHolds({ now: before })
    expect(r).toMatchObject({ refused: 'grandfather_unresolved', grandfathered: 0, wouldPull: 2, pulledIds: ['active'] })
    expect(r.grandfatherProblem).toBe(`storefront ${VK}: its handle is not "vietkite"; its owner is not info@vietkite.com.vn`)
    expect(r.grandfatherProblem).not.toContain('owner@example.com') // another account's email is never echoed
    heldBackVietKite()
  })

  it('the id, the handle and the owner name different storefronts: refused', async () => {
    h.sellers = [{ id: VK, handle: null, email: null }, { id: 'other', handle: 'vietkite', email: 'info@vietkite.com.vn' }]
    const r = await sweepLicenceHolds({ now: before })
    expect(r).toMatchObject({ refused: 'grandfather_unresolved', grandfatherProblem: expect.stringContaining('name different storefronts') })
    heldBackVietKite()
  })

  it('no storefront at all: refused while the window is open', async () => {
    h.sellers = []
    expect(await licenceGrandfatherProblem()).toBe(`no storefront has the seller id ${VK}, the handle "vietkite" or the owner info@vietkite.com.vn`)
    expect((await sweepLicenceHolds({ now: before })).refused).toBe('grandfather_unresolved')
    heldBackVietKite() // no storefront named: the rows under the grandfather's own seller id are held back
  })

  it('the owner email compares case-insensitively', async () => {
    h.sellers = [{ ...VIETKITE, email: 'Info@VietKite.com.vn' }]
    expect(await licenceGrandfatherProblem()).toBeNull()
    expect((await sweepLicenceHolds({ now: before })).grandfathered).toBe(2)
  })

  it('refused before the mass-pull cap: the cause to report is the id', async () => {
    h.sellers = []
    expect((await sweepLicenceHolds({ now: before, maxPull: 1 })).refused).toBe('grandfather_unresolved')
    heldBackVietKite()
  })

  it('after the end nothing is checked: a vanished storefront cannot stall the backstop', async () => {
    h.sellers = []
    const r = await sweepLicenceHolds({ now: after })
    expect(h.sellerReads).toHaveLength(0)
    expect(r.refused).toBeUndefined()
    expect(r.pulledIds.sort()).toEqual(['active', 'vk-1', 'vk-2'])
  })

  it('the desk check still comes first', async () => {
    h.desk = []
    h.sellers = []
    await expect(sweepLicenceHolds({ now: before })).rejects.toThrow(LICENCE_SWEEP_DESK_UNRESOLVED)
    expect(h.sellerReads).toHaveLength(0)
  })
})
