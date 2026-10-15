import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LICENCE_GRANDFATHER, LICENCE_STAMP_PREFIX, licenceClearedWhere, licenceStampFor } from '@/lib/licence-stamp'

// ── /api/admin/listings and the LICENCE CHECK (owner, 2026-10-14 — src/lib/licence-stamp.ts) ────────────────────────
//
// An e-Visa or Legal & permits listing from anyone but eno's own desk goes live only once an admin has compared its
// provider's registered name and licence number with the copies the provider emailed. This file runs the route against
// an in-memory Listing table — with the REAL licenceBlockedIds, stamps and guards — and pins:
//   · Publish ("verify") leaves every uncleared aisle row out, says how many (`licenceCheck`), never parks one, and its
//     write carries the guard: an edit clearing a stamp between the pre-filter and the write publishes nothing. A batch
//     with no aisle row answers byte-for-byte what it always did;
//   · Activate does the same (R1, plan review 2026-10-14: a verified hidden row goes public on its status alone);
//   · 'licence-approve' stamps exactly the values the admin saw (stale / invalid otherwise), as a compare-and-set that a
//     concurrent revoke wins (R4), with one audit row each; publishes a pure hold, but never over an open or confirmed
//     report or a held / suspended owner — at the read or arriving later (R4); parks an identity-refused owner's; and a
//     second approval writes nothing at all;
//   · 'licence-revoke' clears the stamp and unpublishes (Quy chế Article 5), one audit row each, never the desk's;
//   · GET says where each non-desk aisle row stands, with its values as stored.

type Row = Record<string, any>
const DESK = 'desk-seller'
const SELLER = 'seller-anyone'
const V = { legalName: 'CÔNG TY TNHH DU LỊCH ABC', licenceNo: '79-123/2019/TCDL-GP LHQT' }
const LPV = { legalName: 'CÔNG TY LUẬT XYZ', licenceNo: '0312345678' }
const attrs = (v: { legalName: string; licenceNo: string } | null, extra: Row = {}) =>
  JSON.stringify({ ...extra, ...(v ? { providerLegalName: v.legalName, providerLicenceNo: v.licenceNo } : {}) })

const h = vi.hoisted(() => ({
  rows: [] as Record<string, any>[],
  clock: 1_000,
  desk: ['desk-seller'] as string[],
  deskCalls: 0,
  /** Owners' listing ids the seller identity gate refuses (parked instead of published). */
  idHeld: [] as string[],
  calls: [] as Array<{ m: string; args: any; inTx: boolean }>,
  audits: [] as Array<{ input: any; inTx: boolean }>,
  inTx: false,
  /** One-shot hooks, run right after the Nth listing.findMany (1-based) — a concurrent write between a read and a write. */
  afterRead: new Map<number, () => void>(),
  reads: 0,
  refreshed: [] as string[][],
}))

// ── the in-memory Listing table: the where-operators the route and licence-check use, with SQL's NULL semantics ──
const OPS = ['in', 'notIn', 'not', 'equals', 'startsWith', 'none']
function cond(v: unknown, c: any): boolean {
  if (c === null) return v === null || v === undefined
  if (c instanceof Date) return v instanceof Date && v.getTime() === c.getTime()
  if (typeof c !== 'object') return v === c
  return Object.entries(c).every(([op, x]: [string, any]) => {
    if (op === 'in') return v != null && x.includes(v)
    if (op === 'notIn') return v != null && !x.includes(v) // NULL NOT IN (…) is not true in SQL
    if (op === 'not') return x === null ? v != null : v != null && v !== x
    if (op === 'equals') return v === x
    if (op === 'startsWith') return typeof v === 'string' && v.startsWith(x)
    throw new Error(`unexpected operator ${op}`)
  })
}
function matches(row: Row, where: Row | undefined): boolean {
  return Object.entries(where ?? {}).every(([k, c]: [string, any]) => {
    if (k === 'AND') return (c as Row[]).every((x) => matches(row, x))
    if (k === 'OR') return (c as Row[]).some((x) => matches(row, x))
    const v = row[k]
    if (c && typeof c === 'object' && 'none' in c) return Array.isArray(v) && !v.some((x: Row) => matches(x, c.none))
    if (c && typeof c === 'object' && !(c instanceof Date) && !Object.keys(c).some((op) => OPS.includes(op))) return v != null && matches(v, c)
    return cond(v, c)
  })
}
function pick(row: Row, select: Row | undefined): Row {
  if (!select) return { ...row }
  const out: Row = {}
  for (const [k, s] of Object.entries(select) as Array<[string, any]>) {
    if (k === '_count') {
      out._count = Object.fromEntries(Object.entries(s.select).map(([rel, spec]: [string, any]) => [rel, (row[rel] as Row[]).filter((x) => matches(x, spec === true ? {} : spec.where)).length]))
    } else if (s === true) out[k] = row[k]
    else if (s && typeof s === 'object' && 'select' in s) out[k] = row[k] == null ? null : pick(row[k], s.select)
  }
  return out
}
const write = (a: Row) => {
  const hit = h.rows.filter((r) => matches(r, a.where))
  for (const r of hit) Object.assign(r, a.data, { updatedAt: new Date(++h.clock) }) // Prisma bumps @updatedAt
  return hit
}
const listing = {
  findMany: async (a: Row) => {
    h.calls.push({ m: 'findMany', args: a, inTx: h.inTx })
    const out = h.rows.filter((r) => matches(r, a.where)).map((r) => pick(r, a.select))
    const hook = h.afterRead.get(++h.reads)
    if (hook) { h.afterRead.delete(h.reads); hook() }
    return out
  },
  count: async (a: Row) => h.rows.filter((r) => matches(r, a.where)).length,
  updateMany: async (a: Row) => { h.calls.push({ m: 'updateMany', args: a, inTx: h.inTx }); return { count: write(a).length } },
  updateManyAndReturn: async (a: Row) => { h.calls.push({ m: 'updateManyAndReturn', args: a, inTx: h.inTx }); return write(a).map((r) => pick(r, a.select)) },
}
vi.mock('@/lib/db', () => ({
  db: {
    listing,
    notification: { deleteMany: async (a: Row) => { h.calls.push({ m: 'notification.deleteMany', args: a, inTx: h.inTx }); return { count: 0 } } },
    $transaction: async (fn: (tx: unknown) => unknown, opts?: Row) => {
      h.calls.push({ m: '$transaction', args: opts ?? {}, inTx: h.inTx })
      h.inTx = true
      try { return await fn({ listing }) } finally { h.inTx = false }
    },
  },
}))
vi.mock('@/lib/admin', () => ({
  getAdmin: async () => 'mod@eno.vn',
  getCurrentProfile: async () => { throw new Error('admin must not resolve a profile') },
  getCurrentProfileId: async () => { throw new Error('admin must not resolve a profile id') },
}))
vi.mock('@/lib/edition-scope', () => ({ deskSellerIds: async () => { h.deskCalls++; return h.desk } }))
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async (_tx: unknown, input: Row) => { h.audits.push({ input, inTx: h.inTx }) } }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({
  partitionByIdentityGate: async (ids: string[]) => ({ allowed: ids.filter((i) => !h.idHeld.includes(i)), held: ids.filter((i) => h.idHeld.includes(i)) }),
  settleHolds: async () => 0,
}))
vi.mock('@/lib/listing-surfaces', () => ({ refreshListingSurfaces: (ids: string[]) => { h.refreshed.push(ids) } }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/core/listing-tombstone', () => ({ tombstoneListingsTx: async () => [] }))
vi.mock('@/lib/dispute', () => ({ notifyDispute: async () => {} }))
vi.mock('@/lib/brand', () => ({ bumpBrandCount: async () => {} }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
// GET's card projection: only what this table needs (the real one is pinned in route.test.ts and serialize's tests).
vi.mock('@/lib/serialize', () => ({
  LISTING_CARD_SELECT: { id: true, sellerId: true, title: true, subcategorySlug: true, attributes: true, verified: true, category: { select: { slug: true, name: true } } },
  serializeListingCard: (r: Row) => ({ id: r.id, title: r.title, titleVi: null, price: 0, currency: 'VND', images: [], category: { name: r.category.name } }),
}))

const { GET, POST } = await import('./route')

/** A listing row as the table stores it. Default: a non-desk e-Visa row with valid values, waiting (no stamp, unpublished). */
function listingRow(id: string, over: Row = {}): Row {
  return {
    id, title: id, sellerId: SELLER, category: { slug: 'services', name: 'Services' }, subcategorySlug: 'visa-legal',
    // An unpublished fixture row is one the licence check itself holds (licence-stamp.ts LICENCE_HELD_NOTE) unless it says otherwise.
    attributes: attrs(V), verificationMethod: null, verifiedAt: null, verifiedBy: null, verificationNotes: over.verified ? null : 'licence:held',
    verified: false, identityHold: false, status: 'active', featured: false, createdAt: new Date(0), updatedAt: new Date(1_000),
    reports: [] as Row[], seller: { name: 'ABC', trustScore: 80, trustTier: 'trusted', officialPartner: false, ownerId: 'owner-1', owner: { enforcementState: 'good_standing', accountType: 'business' } },
    ...over,
  }
}
const plain = (id: string, over: Row = {}) => listingRow(id, { category: { slug: 'electronics', name: 'Electronics' }, subcategorySlug: 'phones', attributes: null, ...over })
/** The stamp of a row's own values — what the admin's screen shows, and what an approval writes. */
const stampOf = (r: Row, v = V) => licenceStampFor({ sellerId: r.sellerId, subcategorySlug: r.subcategorySlug }, v)
const byId = (id: string) => h.rows.find((r) => r.id === id)!

async function post(body: Row) {
  const res = await POST(new Request('https://eno.vn/api/admin/listings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never)
  return { status: res.status, text: await res.text() }
}
const json = async (body: Row) => JSON.parse((await post(body)).text)
const writes = () => h.calls.filter((c) => c.m === 'updateMany' || c.m === 'updateManyAndReturn')
const GUARD = licenceClearedWhere([DESK])

beforeEach(() => {
  h.rows = []
  h.clock = 1_000
  h.desk = [DESK]
  h.deskCalls = 0
  h.idHeld = []
  h.calls = []
  h.audits = []
  h.inTx = false
  h.afterRead = new Map()
  h.reads = 0
  h.refreshed = []
})

describe('verify ("Publish") — an unchecked e-Visa / Legal & permits row is never published from here', () => {
  it('⛔ leaves the uncleared aisle rows out, publishes the rest, and says how many it left (`licenceCheck`)', async () => {
    h.rows = [plain('p1'), listingRow('visa-1'), listingRow('lp-1', { subcategorySlug: 'legal-permits', attributes: attrs(LPV) })]
    const r = await post({ action: 'verify', ids: ['p1', 'visa-1', 'lp-1'] })
    expect(r.text).toBe('{"ok":true,"affected":1,"licenceCheck":2}')
    expect(byId('p1').verified).toBe(true)
    expect(byId('visa-1').verified).toBe(false)
    expect(byId('lp-1').verified).toBe(false)
    // The write names only the cleared id and carries the guard (for eno's desk, resolved once).
    expect(writes().map((c) => c.args.where)).toEqual([{ id: { in: ['p1'] }, status: { not: 'removed' }, AND: [GUARD] }])
    expect(h.deskCalls).toBe(1)
  })

  it('⛔ with no aisle row in the batch the body is byte-for-byte what it always was', async () => {
    h.rows = [plain('p1'), plain('p2')]
    expect((await post({ action: 'verify', ids: ['p1', 'p2'] })).text).toBe('{"ok":true,"affected":2}')
  })

  it('an APPROVED aisle row (stamped for its values) publishes like any other; so does eno’s desk', async () => {
    const ok = listingRow('visa-ok')
    ok.verificationMethod = stampOf(ok)
    h.rows = [ok, listingRow('desk-1', { sellerId: DESK, attributes: null })]
    expect((await post({ action: 'verify', ids: ['visa-ok', 'desk-1'] })).text).toBe('{"ok":true,"affected":2}')
    expect(byId('visa-ok').verified).toBe(true)
    expect(byId('desk-1').verified).toBe(true)
  })

  it('a stamp of OTHER values (changed since the approval) does not clear the row', async () => {
    const stale = listingRow('visa-stale')
    stale.verificationMethod = stampOf(stale, { ...V, licenceNo: '79-999/2019/TCDL-GP LHQT' })
    h.rows = [stale]
    expect((await post({ action: 'verify', ids: ['visa-stale'] })).text).toBe('{"ok":true,"affected":0,"licenceCheck":1}')
    expect(byId('visa-stale').verified).toBe(false)
  })

  it('⛔ an identity-refused owner’s unchecked aisle row is not PARKED either — releasing the hold would publish it', async () => {
    h.rows = [listingRow('visa-1')]
    h.idHeld = ['visa-1']
    const r = await post({ action: 'verify', ids: ['visa-1'] })
    expect(r.text).toBe('{"ok":true,"affected":0,"licenceCheck":1}')
    expect(byId('visa-1').identityHold).toBe(false)
    expect(writes()).toEqual([])
  })

  it('⛔ the guard is IN the write: an edit clearing the stamp between the pre-filter and the write publishes nothing', async () => {
    const ok = listingRow('visa-ok')
    ok.verificationMethod = stampOf(ok)
    h.rows = [ok]
    // Read 1 is the pre-filter (licenceBlockedIds): it sees the stamp. Then the seller changes the number.
    h.afterRead.set(1, () => Object.assign(byId('visa-ok'), { verificationMethod: null, attributes: attrs({ ...V, licenceNo: '79-555/2020/TCDL-GP LHQT' }) }))
    expect((await post({ action: 'verify', ids: ['visa-ok'] })).text).toBe('{"ok":true,"affected":0}')
    expect(byId('visa-ok').verified).toBe(false)
  })
})

describe('activate — a status change alone republishes a verified row (R1)', () => {
  it('⛔ a verified HIDDEN unchecked aisle row stays hidden — left out, counted, its sale questions untouched', async () => {
    // VietKite's grandfathered row, hidden by the seller: the grandfather is never consulted by a publisher.
    h.rows = [
      listingRow('vk-1', { sellerId: LICENCE_GRANDFATHER.sellerId, attributes: null, verified: true, status: 'hidden' }),
      plain('p1', { verified: true, status: 'hidden' }),
    ]
    const r = await post({ action: 'activate', ids: ['vk-1', 'p1'] })
    expect(r.text).toBe('{"ok":true,"affected":1,"licenceCheck":1}')
    expect(byId('vk-1').status).toBe('hidden')
    expect(byId('p1').status).toBe('active')
    expect(h.calls.find((c) => c.m === 'notification.deleteMany')!.args).toEqual({ where: { type: 'sale_confirm', listingId: 'p1' } })
  })

  it('a row HELD for its licence check stays unpublished and untouched — activate never writes verified:true', async () => {
    h.rows = [listingRow('visa-held', { status: 'hidden' }), plain('p1', { status: 'hidden', verified: false })]
    const r = await post({ action: 'activate', ids: ['visa-held', 'p1'] })
    expect(r.text).toBe('{"ok":true,"affected":1,"licenceCheck":1}')
    expect(byId('visa-held')).toMatchObject({ status: 'hidden', verified: false, identityHold: false })
    for (const w of writes()) expect(w.args.data.verified, JSON.stringify(w.args.data)).not.toBe(true)
  })

  it('every activate write carries the guard — the plain one, and both identity-gate writes', async () => {
    h.rows = [plain('p1', { status: 'hidden', verified: true }), plain('p2', { status: 'hidden', verified: true }), plain('p3', { status: 'sold', verified: false })]
    h.idHeld = ['p2', 'p3']
    await post({ action: 'activate', ids: ['p1', 'p2', 'p3'] })
    const ws = writes()
    expect(ws).toHaveLength(3)
    for (const w of ws) expect(w.args.where.AND).toEqual([GUARD])
  })

  it('⛔ with no aisle row the body is byte-for-byte what it always was', async () => {
    h.rows = [plain('p1', { status: 'hidden', verified: true })]
    expect((await post({ action: 'activate', ids: ['p1'] })).text).toBe('{"ok":true,"affected":1}')
  })
})

describe('licence-approve — the one stamp writer', () => {
  it('⛔ the happy path: a compare-and-set stamp of exactly what the admin saw, one audit row, then the publish', async () => {
    const w = listingRow('visa-1')
    h.rows = [w]
    const stamp = stampOf(w)
    const body = await json({ action: 'licence-approve', ids: ['visa-1'], seen: { 'visa-1': stamp } })
    expect(body).toEqual({ ok: true, affected: 1, approved: 1 })
    // The stamp write: inside the transaction, conditional on everything the decision read (R4).
    const cas = writes().find((c) => c.args.data.verificationMethod)!
    expect(cas.inTx).toBe(true)
    expect(cas.args.where).toEqual({
      id: 'visa-1', status: { not: 'removed' }, sellerId: SELLER, subcategorySlug: 'visa-legal', attributes: w.attributes,
      verificationMethod: null, verified: false, updatedAt: new Date(1_000), verificationNotes: 'licence:held',
    })
    // The mark is not touched by the stamp: the publish drops it, in the write that makes the row public (licence-stamp.ts).
    expect(cas.args.data).toEqual({ verificationMethod: stamp, verifiedAt: expect.any(Date), verifiedBy: null })
    const pub = writes().find((c) => c.args.data.verified === true)!
    expect(pub.args.data).toEqual({ verificationNotes: null, verified: true, identityHold: false })
    expect(h.audits).toEqual([{
      inTx: true,
      input: { actorType: 'admin', actorId: 'mod@eno.vn', action: 'listing.licence_approved', subjectType: 'listing', subjectId: 'visa-1', detail: { subcategory: 'visa-legal', sellerId: SELLER, stamp: stamp.slice(LICENCE_STAMP_PREFIX.length) }, legalBasis: 'ecommerceLaw' },
    }])
    // Published, the hold cleared — and the stamp left as written (verifiedBy / Notes stay null: the admin is in the audit).
    expect(byId('visa-1')).toMatchObject({ verified: true, identityHold: false, verificationMethod: stamp, verifiedBy: null, verificationNotes: null })
    expect(h.calls.find((c) => c.m === '$transaction')!.args).toEqual({ timeout: 60_000 })
  })

  it('works the same for Legal & permits, the bare enterprise code included', async () => {
    const w = listingRow('lp-1', { subcategorySlug: 'legal-permits', attributes: attrs(LPV) })
    h.rows = [w]
    expect(await json({ action: 'licence-approve', ids: ['lp-1'], seen: { 'lp-1': stampOf(w, LPV) } })).toEqual({ ok: true, affected: 1, approved: 1 })
  })

  it('⛔ stale — the screen showed other values (or none), the row is gone or removed: no write, no audit', async () => {
    const a = listingRow('visa-a')
    h.rows = [a, listingRow('visa-removed', { status: 'removed' })]
    const body = await json({ action: 'licence-approve', ids: ['visa-a', 'visa-removed', 'nope'], seen: { 'visa-a': stampOf(a, { ...V, legalName: 'OTHER CO' }), 'visa-removed': stampOf(a) } })
    expect(body).toEqual({ ok: true, affected: 0, approved: 0, stale: 3 })
    expect(writes()).toEqual([])
    expect(h.audits).toEqual([])
    // No `seen` at all reads as nothing seen — fail closed.
    expect(await json({ action: 'licence-approve', ids: ['visa-a'] })).toEqual({ ok: true, affected: 0, approved: 0, stale: 1 })
  })

  it('⛔ invalid — not an aisle row, eno’s desk, values missing or unacceptable: nothing to approve', async () => {
    h.rows = [
      plain('p1'),
      listingRow('desk-1', { sellerId: DESK }),
      listingRow('visa-none', { attributes: null }),
      listingRow('visa-half', { attributes: JSON.stringify({ providerLegalName: V.legalName }) }),
      listingRow('visa-bare', { attributes: attrs({ ...V, licenceNo: '0312345678' }) }), // a bare number is no e-Visa licence
    ]
    const seen = Object.fromEntries(h.rows.map((r) => [r.id, stampOf(r)]))
    expect(await json({ action: 'licence-approve', ids: h.rows.map((r) => r.id), seen })).toEqual({ ok: true, affected: 0, approved: 0, invalid: 5 })
    expect(writes()).toEqual([])
  })

  it('an unresolved desk fails closed: the desk’s own row reads as anyone’s and is judged on its values', async () => {
    h.desk = []
    h.rows = [listingRow('desk-1', { sellerId: DESK, attributes: null })]
    expect(await json({ action: 'licence-approve', ids: ['desk-1'], seen: {} })).toEqual({ ok: true, affected: 0, approved: 0, invalid: 1 })
  })

  it('⛔ approved but NOT published over an open or confirmed report, or a held / suspended owner — `stillHeld`', async () => {
    const rows = [
      listingRow('open-rep', { reports: [{ status: 'open' }] }),
      listingRow('conf-rep', { reports: [{ status: 'confirmed' }] }),
      listingRow('held-owner', { seller: { ownerId: 'o2', trustTier: 'standard', owner: { enforcementState: 'held' } } }),
      listingRow('susp-owner', { seller: { ownerId: 'o3', trustTier: 'standard', owner: { enforcementState: 'suspended' } } }),
      listingRow('restricted', { seller: { ownerId: 'o4', trustTier: 'restricted', owner: { enforcementState: 'good_standing' } } }),
      listingRow('dismissed', { reports: [{ status: 'dismissed' }] }),
      listingRow('ownerless', { seller: { ownerId: null, owner: null, trustTier: 'trusted' } }),
    ]
    h.rows = rows
    const seen = Object.fromEntries(rows.map((r) => [r.id, stampOf(r)]))
    // A Restricted storefront is approved but not published either (commit gate): the trust floor that bars its posting.
    expect(await json({ action: 'licence-approve', ids: rows.map((r) => r.id), seen })).toEqual({ ok: true, affected: 2, approved: 7, stillHeld: 5 })
    for (const id of ['open-rep', 'conf-rep', 'held-owner', 'susp-owner', 'restricted']) expect(byId(id), id).toMatchObject({ verified: false, verificationMethod: seen[id] })
    for (const id of ['dismissed', 'ownerless']) expect(byId(id).verified, id).toBe(true)
    expect(h.audits).toHaveLength(7)
  })

  it('⛔ a report filed AFTER the read is still honoured: the publish’s own WHERE excludes it (R4)', async () => {
    const w = listingRow('visa-1')
    h.rows = [w]
    // Reads: 1 = the approval's, 2 = publishListings' pre-filter. A buyer reports the listing in between.
    h.afterRead.set(2, () => { byId('visa-1').reports.push({ status: 'open' }) })
    expect(await json({ action: 'licence-approve', ids: ['visa-1'], seen: { 'visa-1': stampOf(w) } })).toEqual({ ok: true, affected: 0, approved: 1, stillHeld: 1 })
    expect(byId('visa-1').verified).toBe(false)
    const publishWrite = writes().find((c) => c.args.data.verified === true)!
    expect(publishWrite.args.where.AND).toEqual([GUARD, { reports: { none: { status: { in: ['open', 'confirmed'] } } }, seller: { OR: [{ ownerId: null }, { owner: { enforcementState: { notIn: ['held', 'suspended'] } } }], trustTier: { not: 'restricted' } }, verificationNotes: 'licence:held' }])
  })

  it('…and so is an owner held after the read', async () => {
    const w = listingRow('visa-1')
    h.rows = [w]
    h.afterRead.set(2, () => { byId('visa-1').seller.owner.enforcementState = 'held' })
    expect(await json({ action: 'licence-approve', ids: ['visa-1'], seen: { 'visa-1': stampOf(w) } })).toEqual({ ok: true, affected: 0, approved: 1, stillHeld: 1 })
  })

  it('an identity-refused owner’s approved row is PARKED (identityHold), to go live when they verify', async () => {
    const w = listingRow('visa-1')
    h.rows = [w]
    h.idHeld = ['visa-1']
    expect(await json({ action: 'licence-approve', ids: ['visa-1'], seen: { 'visa-1': stampOf(w) } })).toEqual({ ok: true, affected: 0, approved: 1, held: 1 })
    expect(byId('visa-1')).toMatchObject({ verified: false, identityHold: true, verificationMethod: stampOf(w) })
  })

  it('⛔ a concurrent REVOKE wins: a write landing between the read and the stamp makes it stale — no stamp, no audit (R4)', async () => {
    const w = listingRow('visa-1')
    h.rows = [w]
    // The revoke of a row still waiting changes neither its stamp nor its flag — only @updatedAt. That is enough.
    h.afterRead.set(1, () => { byId('visa-1').updatedAt = new Date(5_000) })
    expect(await json({ action: 'licence-approve', ids: ['visa-1'], seen: { 'visa-1': stampOf(w) } })).toEqual({ ok: true, affected: 0, approved: 0, stale: 1 })
    expect(byId('visa-1')).toMatchObject({ verificationMethod: null, verified: false })
    expect(h.audits).toEqual([])
  })

  it('⛔ re-approving is idempotent: an already-stamped row gets no write, no audit — and no publish, even if it is down', async () => {
    const live = listingRow('visa-live', { verified: true })
    live.verificationMethod = stampOf(live)
    // Taken down by moderation after its approval: that takedown dropped the licence hold's mark (Unverify / Unpublish).
    const down = listingRow('visa-down', { verified: false, verificationNotes: null })
    down.verificationMethod = stampOf(down)
    h.rows = [live, down]
    const seen = { 'visa-live': live.verificationMethod, 'visa-down': down.verificationMethod }
    expect(await json({ action: 'licence-approve', ids: ['visa-live', 'visa-down'], seen })).toEqual({ ok: true, affected: 0, approved: 2, stillHeld: 1 })
    expect(writes()).toEqual([])
    expect(h.audits).toEqual([])
    expect(h.calls.some((c) => c.m === '$transaction')).toBe(false)
    expect(byId('visa-down').verified).toBe(false)
  })

  // ⛔ Commit gate, 2026-10-14: the stamp and the publish are two steps. A row approved whose publish never happened (it
  // failed, or was refused for a report since dismissed) is still a pure licence hold — it kept the mark — so approving
  // again finishes the job: no second stamp, no second audit row, just the publish.
  it('⛔ re-approving an approved row that is STILL a pure licence hold (marked, no report) publishes it — no stamp, no audit', async () => {
    const pending = listingRow('visa-pending') // unpublished, marked
    pending.verificationMethod = stampOf(pending)
    h.rows = [pending]
    expect(await json({ action: 'licence-approve', ids: ['visa-pending'], seen: { 'visa-pending': pending.verificationMethod } })).toEqual({ ok: true, affected: 1, approved: 1 })
    expect(h.audits).toEqual([])
    expect(writes().filter((c) => c.args.data.verificationMethod)).toEqual([])
    expect(byId('visa-pending')).toMatchObject({ verified: true, verificationNotes: null })
  })

  it('a row already LIVE without a checked licence (VietKite’s, once it has values) is stamped and simply stays live', async () => {
    const vk = listingRow('vk-1', { sellerId: LICENCE_GRANDFATHER.sellerId, verified: true })
    h.rows = [vk]
    expect(await json({ action: 'licence-approve', ids: ['vk-1'], seen: { 'vk-1': stampOf(vk) } })).toEqual({ ok: true, affected: 0, approved: 1 })
    expect(byId('vk-1')).toMatchObject({ verified: true, verificationMethod: stampOf(vk) })
  })

  it('duplicate ids are approved once', async () => {
    const w = listingRow('visa-1')
    h.rows = [w]
    expect(await json({ action: 'licence-approve', ids: ['visa-1', 'visa-1'], seen: { 'visa-1': stampOf(w) } })).toEqual({ ok: true, affected: 1, approved: 1 })
    expect(h.audits).toHaveLength(1)
  })

  // ⛔ Commit gate, 2026-10-14: `verified: false` is also an admin Unverify or a moderation Unpublish — takedowns that leave
  // no report. A licence verdict must not undo them: only a row the licence check itself took down (its mark) publishes.
  it('⛔ an unpublished row WITHOUT the licence hold’s mark (an admin Unverify, a moderation Unpublish) is approved but stays down — `stillHeld`', async () => {
    const pulled = listingRow('visa-pulled', { verificationNotes: null })
    const held = listingRow('visa-held')
    h.rows = [pulled, held]
    const seen = { 'visa-pulled': stampOf(pulled), 'visa-held': stampOf(held) }
    expect(await json({ action: 'licence-approve', ids: ['visa-pulled', 'visa-held'], seen })).toEqual({ ok: true, affected: 1, approved: 2, stillHeld: 1 })
    expect(byId('visa-pulled')).toMatchObject({ verified: false, verificationMethod: seen['visa-pulled'], verificationNotes: null })
    expect(byId('visa-held')).toMatchObject({ verified: true, verificationMethod: seen['visa-held'], verificationNotes: null })
  })

  // Commit gate, 2026-10-14: a held row the seller had hidden (or marked sold) is cleared by the approval but on sale only
  // once relisted — the response counts it apart, so the console's "published" is what buyers can see.
  it('a cleared row the seller had hidden is counted as `notLive`, apart from the published count', async () => {
    const hidden = listingRow('visa-hidden', { status: 'hidden' })
    const shown = listingRow('visa-shown')
    h.rows = [hidden, shown]
    const seen = { 'visa-hidden': stampOf(hidden), 'visa-shown': stampOf(shown) }
    expect(await json({ action: 'licence-approve', ids: ['visa-hidden', 'visa-shown'], seen })).toEqual({ ok: true, affected: 2, approved: 2, notLive: 1 })
    expect(byId('visa-hidden')).toMatchObject({ verified: true, status: 'hidden', verificationNotes: null })
  })

  it('an ALREADY-approved row the identity gate parked is reported as waiting on its owner (alreadyHeld), not stillHeld', async () => {
    const parked = listingRow('visa-parked', { identityHold: true, verificationNotes: null })
    parked.verificationMethod = stampOf(parked)
    h.rows = [parked]
    expect(await json({ action: 'licence-approve', ids: ['visa-parked'], seen: { 'visa-parked': stampOf(parked) } })).toEqual({ ok: true, affected: 0, approved: 1, alreadyHeld: 1 })
    expect(h.audits).toEqual([])
  })

  it('⛔ Unverify drops the mark, so a later approval of that row publishes nothing', async () => {
    const w = listingRow('visa-1')
    h.rows = [w]
    await post({ action: 'unverify', ids: ['visa-1'] })
    expect(byId('visa-1')).toMatchObject({ verified: false, verificationNotes: null })
    expect(await json({ action: 'licence-approve', ids: ['visa-1'], seen: { 'visa-1': stampOf(w) } })).toEqual({ ok: true, affected: 0, approved: 1, stillHeld: 1 })
    expect(byId('visa-1').verified).toBe(false)
  })
})

describe('licence-revoke — an expired, revoked or changed licence (Quy chế Article 5)', () => {
  it('⛔ clears the stamp, unpublishes, drops any identity hold, one audit row each — never eno’s desk, never a non-aisle row', async () => {
    const live = listingRow('visa-live', { verified: true, verifiedAt: new Date(1), identityHold: false })
    live.verificationMethod = stampOf(live)
    // Approved, then parked by the identity gate (a publish waiting on the owner's identity).
    const parked = listingRow('visa-parked', { identityHold: true, status: 'hidden', verificationNotes: null })
    parked.verificationMethod = stampOf(parked)
    const desk = listingRow('desk-1', { sellerId: DESK, verified: true })
    const other = plain('p1', { verified: true })
    h.rows = [live, parked, desk, other]
    expect(await json({ action: 'licence-revoke', ids: ['visa-live', 'visa-parked', 'desk-1', 'p1'] })).toEqual({ ok: true, affected: 2 })
    for (const id of ['visa-live', 'visa-parked']) {
      expect(byId(id), id).toMatchObject({ verificationMethod: null, verifiedAt: null, verifiedBy: null, verified: false, identityHold: false })
    }
    // The licence hold's mark (licence-stamp.ts licenceHeldMark), decided by the write: the LIVE row and the PARKED one (a
    // publish waiting on identity) both went down for their licence, so approving corrected values puts them back.
    expect(byId('visa-live').verificationNotes).toBe('licence:held')
    expect(byId('visa-parked').verificationNotes).toBe('licence:held')
    expect(byId('desk-1').verified).toBe(true)
    expect(byId('p1').verified).toBe(true)
    expect(h.audits.map((a) => a.input)).toEqual([
      { actorType: 'admin', actorId: 'mod@eno.vn', action: 'listing.licence_revoked', subjectType: 'listing', subjectId: 'visa-live', detail: { subcategory: 'visa-legal', wasPublic: true }, legalBasis: 'ecommerceLaw' },
      { actorType: 'admin', actorId: 'mod@eno.vn', action: 'listing.licence_revoked', subjectType: 'listing', subjectId: 'visa-parked', detail: { subcategory: 'visa-legal', wasPublic: false }, legalBasis: 'ecommerceLaw' },
    ])
    expect(h.audits.every((a) => a.inTx)).toBe(true)
  })

  // ⛔ Commit gate, 2026-10-14: the mark is decided by the WRITE. A row already down for another reason (an Unverify landing
  // between the revoke's read and its write included) is revoked without it — an approval then leaves it down.
  it('⛔ a row already down and unmarked when the revoke writes is revoked WITHOUT the mark', async () => {
    const down = listingRow('visa-down', { verified: false, verificationNotes: null })
    down.verificationMethod = stampOf(down)
    h.rows = [down]
    expect(await json({ action: 'licence-revoke', ids: ['visa-down'] })).toEqual({ ok: true, affected: 1 })
    expect(byId('visa-down')).toMatchObject({ verificationMethod: null, verified: false, verificationNotes: null })
  })

  it('⛔ an Unverify landing between the revoke’s read and its write wins: no mark', async () => {
    const live = listingRow('visa-live', { verified: true })
    live.verificationMethod = stampOf(live)
    h.rows = [live]
    // Read 1 is the revoke's own; the takedown lands right after it.
    h.afterRead.set(1, () => { Object.assign(byId('visa-live'), { verified: false, identityHold: false, verificationNotes: null }) })
    expect(await json({ action: 'licence-revoke', ids: ['visa-live'] })).toEqual({ ok: true, affected: 1 })
    expect(byId('visa-live')).toMatchObject({ verificationMethod: null, verified: false, verificationNotes: null })
    // …and the record says what the write found, not what the read did: it was not public any more.
    expect(h.audits.map((a) => a.input.detail)).toEqual([{ subcategory: 'visa-legal', wasPublic: false }])
  })

  it('a revoked row is blocked again: Publish leaves it out until it is approved anew', async () => {
    const live = listingRow('visa-1', { verified: true })
    live.verificationMethod = stampOf(live)
    h.rows = [live]
    await post({ action: 'licence-revoke', ids: ['visa-1'] })
    expect((await post({ action: 'verify', ids: ['visa-1'] })).text).toBe('{"ok":true,"affected":0,"licenceCheck":1}')
  })
})

describe('GET — where each listing stands with the licence check', () => {
  it('every row carries `subcategory`; a non-desk aisle row also its state and its values as stored', async () => {
    const approved = listingRow('visa-ok', { verified: true })
    approved.verificationMethod = stampOf(approved)
    h.rows = [
      plain('p1'),
      listingRow('desk-1', { sellerId: DESK, attributes: null }),
      listingRow('visa-wait'),
      listingRow('lp-code', { subcategorySlug: 'legal-permits', attributes: attrs(LPV) }),
      listingRow('visa-half', { attributes: JSON.stringify({ providerLicenceNo: ' 79-123/2019/TCDL-GP  LHQT ' }) }),
      approved,
      listingRow('vk-1', { sellerId: LICENCE_GRANDFATHER.sellerId, attributes: null, verified: true }),
    ]
    const res = await GET(new Request('https://eno.vn/api/admin/listings') as never)
    const { listings, total } = (await res.json()) as { listings: Row[]; total: number }
    expect(total).toBe(7)
    const of = (id: string) => listings.find((l) => l.id === id)!
    expect(of('p1').subcategory).toBe('phones')
    expect(of('p1')).not.toHaveProperty('licence')
    expect(of('desk-1')).not.toHaveProperty('licence') // exempt
    expect(of('visa-wait').licence).toEqual({ state: 'pending', legalName: V.legalName, licenceNo: V.licenceNo, enterpriseCode: false })
    expect(of('lp-code').licence).toEqual({ state: 'pending', legalName: LPV.legalName, licenceNo: LPV.licenceNo, enterpriseCode: true })
    expect(of('visa-half').licence).toEqual({ state: 'missing', legalName: '', licenceNo: '79-123/2019/TCDL-GP LHQT', enterpriseCode: false })
    expect(of('visa-ok').licence.state).toBe('approved')
    const vkState = Date.now() < Date.parse(`${LICENCE_GRANDFATHER.until}T00:00:00+07:00`) ? 'grandfathered' : 'missing'
    expect(of('vk-1').licence.state).toBe(vkState)
    // The stamp itself never reaches the console.
    expect(JSON.stringify(listings)).not.toContain(LICENCE_STAMP_PREFIX)
    expect(h.deskCalls).toBe(1)
  })

  it('a page without an aisle row does not resolve the desk at all', async () => {
    h.rows = [plain('p1')]
    await GET(new Request('https://eno.vn/api/admin/listings') as never)
    expect(h.deskCalls).toBe(0)
  })
})
