import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { licenceHeldMark } from '@/lib/licence-stamp'

// ── THE PHOTO PASS (listing-photo-pass.ts): hold, strip, release, restore ────────────────────────────────────────────
//
// Run against an in-memory Listing table with the REAL publishListings (core/publish-listings.ts), the real licence
// pre-filter and guards, and the real releaseIdentityHolds — only the verdicts, the identity gate's decision, the audit
// chain, tombstones, kv and the cache purge are stand-ins. Pins the decision table, the compare-and-set writes, the
// self-release's conditions, and the interleavings the plan review named: a takedown landing during a photo hold is never
// republished by a photo release (A10), a release the identity gate parks is the gate's from then (A11), a photo that
// could not be decided never lets a release through (A9), and a restore keeps the seller's later edits (A13).

type Row = Record<string, any>
const BASE = 'https://proj.supabase.co/storage/v1/object/public/listings/'
const u = (k: string) => `${BASE}${k}.webp`

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  audits: [] as Row[],
  bells: [] as Row[],
  tombstones: [] as Row[],
  cancelled: [] as Row[],
  refreshed: [] as Array<{ ids: string[]; opts: Row }>,
  verdicts: {} as Record<string, unknown>,
  verdictCalls: [] as Row[],
  /** One-shot: runs inside the first verdict call — something commits while the pass is checking. */
  duringVerdict: null as null | (() => void),
  idHeld: [] as string[],
  pending: [] as string[],
  done: [] as string[],
  kv: new Map<string, unknown>(),
  shares: [] as unknown[][],
  errors: [] as unknown[],
  clock: 1000,
  auditSeq: 0,
  now: Date.now(),
}))

// ── the in-memory table: the where-operators these paths use, with SQL's NULL semantics ──
const OPS = ['in', 'notIn', 'not', 'equals', 'startsWith', 'none', 'gt', 'mode']
const lower = (x: unknown) => (typeof x === 'string' ? x.toLowerCase() : Array.isArray(x) ? x.map(lower) : x)
function cond(v: unknown, c: any): boolean {
  if (c === null) return v === null || v === undefined
  if (c instanceof Date) return v instanceof Date && v.getTime() === c.getTime()
  if (typeof c !== 'object') return v === c
  if (c.mode === 'insensitive') {
    const { mode: _mode, ...rest } = c
    return cond(lower(v), Object.fromEntries(Object.entries(rest).map(([op, x]) => [op, lower(x)])))
  }
  return Object.entries(c).every(([op, x]: [string, any]) => {
    if (op === 'in') return v != null && x.includes(v)
    if (op === 'notIn') return v != null && !x.includes(v)
    if (op === 'not') return x === null ? v != null : v != null && v !== x
    if (op === 'equals') return v === x
    if (op === 'startsWith') return typeof v === 'string' && v.startsWith(x)
    if (op === 'gt') return v instanceof Date && v.getTime() > x.getTime()
    throw new Error(`unexpected operator ${op}`)
  })
}
function matches(row: Row, where: Row | undefined): boolean {
  return Object.entries(where ?? {}).every(([k, c]: [string, any]) => {
    if (k === 'AND') return (c as Row[]).every((x) => matches(row, x))
    if (k === 'OR') return (c as Row[]).some((x) => matches(row, x))
    if (k === 'NOT') return !matches(row, c as Row)
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
    if (s === true) out[k] = row[k]
    else if (s && typeof s === 'object' && 'select' in s) out[k] = row[k] == null ? null : pick(row[k], s.select)
  }
  return out
}
const write = (a: Row) => {
  const hit = h.rows.filter((r) => matches(r, a.where))
  for (const r of hit) Object.assign(r, a.data, { updatedAt: new Date(++h.clock) })
  return hit
}

vi.mock('@/lib/db', () => {
  const db: Row = {
    listing: {
      findUnique: async (a: Row) => { const r = h.rows.find((x) => x.id === a.where.id); return r ? pick(r, a.select) : null },
      findFirst: async (a: Row) => { const r = h.rows.find((x) => matches(x, a.where)); return r ? pick(r, a.select) : null },
      findMany: async (a: Row) => h.rows.filter((r) => matches(r, a.where)).map((r) => pick(r, a.select)),
      updateMany: async (a: Row) => ({ count: write(a).length }),
      updateManyAndReturn: async (a: Row) => write(a).map((r) => pick(r, a.select)),
      count: async (a: Row) => h.rows.filter((r) => matches(r, a.where)).length,
    },
    seller: {
      findMany: async (a: Row) => [...new Map(h.rows.map((r) => [r.seller.id, r.seller])).values()].filter((s) => matches(s, a.where)).map((s) => pick(s, a.select)),
    },
    complianceAudit: {
      findMany: async (a: Row) => h.audits.filter((r) => matches(r, a.where)).sort((x, y) => y.id - x.id).map((r) => pick(r, a.select)),
      findFirst: async (a: Row) => { const r = h.audits.filter((x) => matches(x, a.where)).sort((x, y) => y.id - x.id)[0]; return r ? pick(r, a.select) : null },
    },
    notification: { create: async (a: Row) => { h.bells.push(a.data); return a.data } },
    storageTombstone: { deleteMany: async (a: Row) => { h.cancelled.push(a.where); return { count: 1 } } },
    $executeRaw: async () => 0,
    // The breaker's 7-day count (seller, since), and publishListings' FOR SHARE of the owners.
    $queryRaw: async (q: TemplateStringsArray, ...v: unknown[]) => {
      if (!q.join('?').includes('compliance_audit')) { h.shares.push(v); return [] }
      const [seller, since] = v as [string, Date]
      const ids = new Set(h.rows.filter((r) => r.sellerId === seller).map((r) => r.id))
      return [{ n: h.audits.filter((a) => ['listing.photo.held', 'listing.photo.stripped'].includes(a.action) && ids.has(a.subjectId) && a.occurredAt >= since).length }]
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  }
  return { db }
})
vi.mock('@/lib/compliance/audit', () => ({
  appendAudit: async (_tx: unknown, input: Row) => { h.audits.push({ id: ++h.auditSeq, occurredAt: new Date(h.now), ...input }) },
}))
vi.mock('@/lib/core/storage-tombstones', () => ({
  writeTombstones: async (_tx: unknown, refs: Row[], reason: string, now: Date, opts: Row) => { h.tombstones.push({ refs, reason, now, opts }); return refs.length },
}))
vi.mock('@/lib/listing-photo-verdict', () => ({
  listingPhotoVerdict: async (src: Row, o: Row) => {
    h.verdictCalls.push({ key: src.key, ...o })
    const during = h.duringVerdict
    h.duringVerdict = null
    during?.()
    return h.verdicts[src.key] ?? 'unavailable'
  },
}))
vi.mock('@/lib/listing-image', () => ({
  listingObjectKey: (url: string) => (typeof url === 'string' && url.startsWith(BASE) ? { bucket: 'listings', key: url.slice(BASE.length), url } : null),
}))
vi.mock('@/lib/edition-scope', () => ({ deskSellerIds: async () => ['desk'] }))
// eno's own e-Visa / trip desk (listing-photo-desk.test.ts resolves it): 'desk' here.
vi.mock('@/lib/listing-photo-desk', () => ({ isPhotoDeskSeller: async (id: string) => id === 'desk' }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({
  partitionByIdentityGate: async (ids: string[]) => ({ allowed: ids.filter((i) => !h.idHeld.includes(i)), held: ids.filter((i) => h.idHeld.includes(i)) }),
  settleHolds: async () => 0,
}))
vi.mock('@/lib/listing-surfaces', () => ({ refreshListingSurfaces: (ids: string[], _op: string, opts: Row = {}) => { h.refreshed.push({ ids, opts }) } }))
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    mset: async (entries: Array<[string, unknown]>) => { h.pending.push(...entries.map(([k]) => k.replace('listing-photo:pending:', ''))) },
    del: async (k: string) => { if (k.startsWith('listing-photo:pending:')) h.done.push(k.replace('listing-photo:pending:', '')); else h.kv.delete(k) },
    get: async (k: string) => h.kv.get(k) ?? null,
    set: async (k: string, v: unknown) => { h.kv.set(k, v); return 'OK' },
  },
}))
vi.mock('@/lib/log', () => ({ logError: (e: unknown) => { h.errors.push(e) } }))
vi.mock('next/server', () => ({ after: () => {} }))

const { photoPassById, planPhotoPass, restoreOrder, restoreStrippedPhotos, STRIPPED_KEEP_MS, PHOTO_BELLS } = await import('./listing-photo-pass')
const { releaseIdentityHolds } = await import('./compliance/identity-holds')

const OK = { rule: 'ok', sha: null }
const FLYER = { rule: 'flyer', confirmed: true, sha: null }
const CONTACT = { rule: 'contact', confirmed: true, sha: null }
const LONE = { rule: 'flyer', confirmed: false, sha: null }

function listing(id: string, photos: string[], o: Row = {}): Row {
  const { seller, ...rest } = o
  return {
    id, images: JSON.stringify(photos.map(u)), status: 'active', verified: true, identityHold: false, verificationNotes: null,
    sellerId: 's1', subcategorySlug: 'phones', attributes: null, verificationMethod: null, updatedAt: new Date(0),
    category: { slug: 'electronics' }, reports: [],
    seller: { id: 's1', ownerId: 'owner-1', trustTier: 'standard', handle: null, owner: { enforcementState: 'good_standing', email: 'seller@x.vn', locale: 'vi' }, ...seller },
    ...rest,
  }
}
const row = (id = 'L1') => h.rows.find((r) => r.id === id)!
const photos = (id = 'L1') => (JSON.parse(row(id).images) as string[]).map((x) => x.slice(BASE.length, -'.webp'.length))
const actions = () => h.audits.map((a) => a.action)
const HELD = { verified: false, identityHold: false, verificationNotes: 'photo:held' }

beforeEach(() => {
  vi.stubEnv('PHOTO_RULES_WRITE', '1')
  h.rows = []; h.audits = []; h.bells = []; h.tombstones = []; h.cancelled = []; h.refreshed = []; h.verdictCalls = []
  h.verdicts = { 'a.webp': OK, 'b.webp': OK, 'c.webp': OK, 'F1.webp': FLYER, 'F2.webp': CONTACT }
  h.duringVerdict = null; h.idHeld = []; h.pending = []; h.done = []; h.errors = []; h.now = Date.now(); h.kv.clear(); h.shares = []
})
afterEach(() => {
  expect(h.errors).toEqual([])
  vi.unstubAllEnvs()
})

describe('planPhotoPass — the decision table', () => {
  const ok = { kind: 'ok' } as const
  const bad = { kind: 'bad', rule: 'flyer' } as const
  const unk = { kind: 'unknown' } as const
  it.each<[string, Array<typeof ok | typeof bad | typeof unk>, boolean, object]>([
    ['all fine, live', [ok, ok], false, {}],
    ['all fine, held → release', [ok, ok], true, { release: true }],
    ['no photos at all, held → stays held', [], true, {}],
    ['every photo refused, live → hold', [bad, bad], false, { hold: true }],
    ['every photo refused, held → stays held', [bad], true, {}],
    ['mixed, live → strip the refused', [bad, ok, bad], false, { strip: [0, 2] }],
    ['mixed, held → strip, then release', [ok, bad], true, { strip: [1], release: true }],
    ['⛔ A9: fine + undecided, held → pending, NO release', [ok, unk], true, { pending: true }],
    ['refused + undecided, nothing fine → pending, no hold', [bad, unk], false, { pending: true }],
    ['refused + fine + undecided, held → strip, pending, no release', [bad, ok, unk], true, { strip: [0], pending: true }],
  ])('%s', (_name, v, held, plan) => {
    expect(planPhotoPass(v, held)).toEqual(plan)
  })
})

describe('the hold', () => {
  it('every photo refused (two reads): unpublished under the photo mark, status untouched, recorded, the seller told in their language', async () => {
    h.rows = [listing('L1', ['F1', 'F2'])]
    expect(await photoPassById('L1', 'pass')).toEqual({ plan: { hold: true }, dryRun: false, wrote: ['held'] })
    expect(row()).toMatchObject({ ...HELD, status: 'active' })
    expect(h.audits).toEqual([expect.objectContaining({
      action: 'listing.photo.held', actorType: 'system', subjectId: 'L1', legalBasis: 'ecommerceLaw',
      detail: { wasPublic: true, parked: false, photos: [{ i: 0, key: 'F1.webp', rule: 'flyer' }, { i: 1, key: 'F2.webp', rule: 'contact' }] },
    })])
    expect(h.bells).toEqual([{ recipientId: 'owner-1', type: 'system', title: 'Tin đăng tạm ẩn: hãy thêm ảnh thật', body: PHOTO_BELLS.held.body.vi, url: '/listings/L1/edit' }])
    expect(h.refreshed).toEqual([{ ids: ['L1'], opts: { home: true } }])
    // Two reads must agree: the pass asks for the confirmation.
    expect(h.verdictCalls[0]).toMatchObject({ lane: 'pass', flyerRule: true, listingId: 'L1', confirm: 'after' })
    expect(h.done).toEqual(['L1'])
  })

  it('an identity-parked row is held too, its park dropped (the photo mark owns it now)', async () => {
    h.rows = [listing('L1', ['F1'], { verified: false, identityHold: true })]
    await photoPassById('L1', 'pass')
    expect(row()).toMatchObject(HELD)
    expect(h.audits[0].detail).toMatchObject({ wasPublic: false, parked: true })
  })

  it('English owner → the English bell', async () => {
    h.rows = [listing('L1', ['F1'], { seller: { owner: { enforcementState: 'good_standing', email: 'x@y.z', locale: 'en' } } })]
    await photoPassById('L1', 'pass')
    expect(h.bells[0]).toMatchObject({ title: 'Listing held: add a real photo', body: PHOTO_BELLS.held.body.en })
  })

  it('⛔ a compare-and-set: a takedown or an edit landing during the check leaves the row as it is, unmarked', async () => {
    for (const change of [
      (r: Row) => Object.assign(r, { verified: false, identityHold: false, verificationNotes: null }), // admin Unverify
      (r: Row) => { r.images = JSON.stringify([u('a')]) }, // the seller's own edit
      (r: Row) => { r.status = 'removed' }, // a removal
    ]) {
      h.rows = [listing('L1', ['F1'])]; h.audits = []; h.bells = []
      h.duringVerdict = () => change(row())
      const res = await photoPassById('L1', 'pass')
      expect(res).toMatchObject({ wrote: [] })
      expect(row().verificationNotes).toBeNull()
      expect(h.audits).toEqual([])
      expect(h.bells).toEqual([])
    }
  })

  it('a lone refusal (the second read not there) or an unavailable photo never holds — pending', async () => {
    h.verdicts['F1.webp'] = LONE
    h.rows = [listing('L1', ['F1', 'zz'])]
    expect(await photoPassById('L1', 'pass')).toMatchObject({ plan: { pending: true }, wrote: [] })
    expect(row().verified).toBe(true)
    expect(h.pending).toEqual(['L1'])
  })

  it('an ownerless partner storefront is held like anyone (no bell — nobody to tell)', async () => {
    h.rows = [listing('L1', ['F1'], { seller: { ownerId: null, owner: null } })]
    await photoPassById('L1', 'sweep')
    expect(row()).toMatchObject(HELD)
    expect(h.bells).toEqual([])
  })

  it('one bell per listing: two of one owner\'s listings held → two bells, each naming its own listing', async () => {
    h.rows = [listing('L1', ['F1']), listing('L2', ['F2'])]
    await photoPassById('L1', 'sweep')
    await photoPassById('L2', 'sweep')
    expect(h.bells.map((b) => b.url)).toEqual(['/listings/L1/edit', '/listings/L2/edit'])
  })

  it('the cron\'s per-run cap (mayWrite) writes nothing and leaves the row pending', async () => {
    h.rows = [listing('L1', ['F1'])]
    expect(await photoPassById('L1', 'sweep', { mayWrite: async () => false })).toMatchObject({ plan: { hold: true }, wrote: [], breaker: 'run' })
    expect(row().verified).toBe(true)
    expect(h.pending).toEqual(['L1'])
  })

  it('⛔ A12, every caller: past max(10, a quarter) in 7 days the storefront TRIPS, stays tripped after the week, until ?allow', async () => {
    h.rows = Array.from({ length: 12 }, (_, i) => listing(`L${i}`, ['F1']))
    for (let i = 0; i < 10; i++) expect(await photoPassById(`L${i}`, 'pass')).toMatchObject({ wrote: ['held'] })
    expect(await photoPassById('L10', 'pass')).toMatchObject({ wrote: [], breaker: 'storefront' })
    expect(h.kv.has('listing-photo:tripped:s1')).toBe(true)
    // A week on, the old audits age out — the trip stands.
    for (const a of h.audits) a.occurredAt = new Date(Date.now() - 8 * 24 * 3600_000)
    expect(await photoPassById('L10', 'pass')).toMatchObject({ breaker: 'storefront' })
    expect(await photoPassById('L10', 'sweep', { allow: new Set(['s1']) })).toMatchObject({ wrote: ['held'] })
    expect(h.kv.has('listing-photo:tripped:s1')).toBe(false)
    expect(await photoPassById('L11', 'pass')).toMatchObject({ wrote: ['held'] })
  })

  it('a spent lane is reported (the sweep stops on it), the row stays pending', async () => {
    h.verdicts['zz.webp'] = 'budget'
    h.rows = [listing('L1', ['a', 'zz'])]
    expect(await photoPassById('L1', 'sweep')).toMatchObject({ plan: { pending: true }, budget: true })
    expect(h.pending).toEqual(['L1'])
  })

  it('⛔ A16: without PHOTO_RULES_WRITE=1 it is a dry run — checked and planned, nothing written, nothing queued', async () => {
    vi.unstubAllEnvs()
    h.rows = [listing('L1', ['F1'])]
    expect(await photoPassById('L1', 'pass')).toEqual({ plan: { hold: true }, dryRun: true, wrote: [] })
    expect(row().verified).toBe(true)
    expect(h.audits).toEqual([]); expect(h.pending).toEqual([]); expect(h.done).toEqual([])
  })
})

describe('who the pass never touches', () => {
  it.each<[string, Row]>([
    ['a teacher profile', { category: { slug: 'teachers' } }],
    ['SDC_store (the owner\'s protected store)', { sellerId: 'cmtckzkuc01wm01s7ub6f0xsi' }],
    ['VinWonders', { sellerId: 'cmt6v9x4o00004fq4v6qokman' }],
    ['ENO Trading, by handle', { seller: { handle: { handle: 'eno-trading' } } }],
    ['an eSIM carrier\'s storefront (ownerless)', { category: { slug: 'services' }, subcategorySlug: 'esim', seller: { ownerId: null, owner: null } }],
    ['O2: eno\'s own e-Visa / trip desk (pending the owner\'s call)', { sellerId: 'desk' }],
  ])('⛔ %s: exempt, never even checked', async (_name, o) => {
    h.rows = [listing('L1', ['F1'], o)]
    expect(await photoPassById('L1', 'pass')).toEqual({ skip: 'exempt' })
    expect(h.verdictCalls).toEqual([])
  })

  it('⛔ a member\'s listing in the eSIM aisle is checked like any other', async () => {
    h.rows = [listing('L1', ['F1'], { category: { slug: 'services' }, subcategorySlug: 'esim' })]
    expect(await photoPassById('L1', 'pass')).toMatchObject({ wrote: ['held'] })
  })

  it('⛔ O3: a VERIFIED row still carrying the photo mark is live — every photo refused holds it', async () => {
    h.rows = [listing('L1', ['F1'], { verificationNotes: 'photo:held' })]
    expect(await photoPassById('L1', 'pass')).toEqual({ plan: { hold: true }, dryRun: false, wrote: ['held'] })
    expect(row()).toMatchObject(HELD)
  })

  it('⛔ O3: …a mixed one is stripped as live (no release), the stale mark cleared in the same write', async () => {
    h.rows = [listing('L1', ['F1', 'a'], { verificationNotes: 'photo:held' })]
    expect(await photoPassById('L1', 'pass')).toEqual({ plan: { strip: [0] }, dryRun: false, wrote: ['stripped'] })
    expect(row()).toMatchObject({ verified: true, verificationNotes: null })
    expect(photos()).toEqual(['a'])
  })

  it('⛔ an exempt listing still carrying the photo mark is released, never read', async () => {
    h.rows = [listing('L1', ['F1'], { ...HELD, sellerId: 'cmtckzkuc01wm01s7ub6f0xsi' })]
    expect(await photoPassById('L1', 'pass')).toMatchObject({ plan: { release: true }, wrote: ['released'] })
    expect(row()).toMatchObject({ verified: true, verificationNotes: null })
    expect(h.verdictCalls).toEqual([])
  })

  it.each<[string, Row, string]>([
    ['a licence hold', { verified: false, verificationNotes: 'licence:held' }, 'marked'],
    ['a review seat\'s row', { verified: false, verificationNotes: 'review-seat:held' }, 'marked'],
    ['a row someone else took down', { verified: false }, 'not_public'],
    ['a tombstone', { status: 'removed' }, 'gone'],
  ])('%s is skipped', async (_name, o, skip) => {
    h.rows = [listing('L1', ['F1'], o)]
    expect(await photoPassById('L1', 'pass')).toEqual({ skip })
    expect(row()).toMatchObject({ verificationNotes: o.verificationNotes ?? null })
  })

  it('jobs: the flyer rule is off (a company logo is fine), contact still counts', async () => {
    h.rows = [listing('L1', ['a'], { category: { slug: 'jobs' } })]
    await photoPassById('L1', 'pass')
    expect(h.verdictCalls[0]).toMatchObject({ flyerRule: false })
  })

  it('a photo outside our bucket is never refused — it cannot be checked here', async () => {
    h.rows = [listing('L1', [])]
    row().images = JSON.stringify(['https://cdn.example/x.jpg'])
    expect(await photoPassById('L1', 'pass')).toMatchObject({ plan: { pending: true } })
    expect(h.verdictCalls).toEqual([])
  })
})

describe('the strip', () => {
  it('the refused photos leave, the rest keep their order (the next fine one is the cover), recorded and kept 180 days', async () => {
    h.rows = [listing('L1', ['F1', 'a', 'F2', 'b'])]
    expect(await photoPassById('L1', 'pass')).toMatchObject({ plan: { strip: [0, 2] }, wrote: ['stripped'] })
    expect(photos()).toEqual(['a', 'b'])
    expect(row()).toMatchObject({ verified: true, verificationNotes: null })
    expect(h.audits[0]).toMatchObject({
      action: 'listing.photo.stripped',
      detail: { before: ['F1', 'a', 'F2', 'b'].map(u), removed: [{ i: 0, url: u('F1'), key: 'F1.webp', rule: 'flyer' }, { i: 2, url: u('F2'), key: 'F2.webp', rule: 'contact' }] },
    })
    expect(h.tombstones).toEqual([{ refs: [{ bucket: 'listings', path: 'F1.webp' }, { bucket: 'listings', path: 'F2.webp' }], reason: 'listing_photo_stripped', now: expect.any(Date), opts: { graceMs: STRIPPED_KEEP_MS } }])
    expect(h.bells).toEqual([expect.objectContaining({ title: 'Một số ảnh đã bị gỡ', url: '/listings/L1/edit' })])
  })

  it('an edit during the check: no strip, no record, no tombstone', async () => {
    h.rows = [listing('L1', ['F1', 'a'])]
    h.duringVerdict = () => { row().images = JSON.stringify([u('b')]) }
    await photoPassById('L1', 'pass')
    expect(photos()).toEqual(['b'])
    expect(h.audits).toEqual([]); expect(h.tombstones).toEqual([])
  })
})

describe('the self-release', () => {
  it('a held row whose photos are all fine now goes live again, the mark dropped; recorded; "live again"', async () => {
    h.rows = [listing('L1', ['a', 'b'], HELD)]
    expect(await photoPassById('L1', 'pass')).toMatchObject({ plan: { release: true }, wrote: ['released'] })
    expect(row()).toMatchObject({ verified: true, identityHold: false, verificationNotes: null, status: 'active' })
    expect(actions()).toEqual(['listing.photo.released'])
    expect(h.bells).toEqual([expect.objectContaining({ title: 'Tin đăng đã hiển thị lại', url: '/listings/L1' })])
  })

  it('a held row the seller fixed but left a flyer on: the flyer goes, then it is released', async () => {
    h.rows = [listing('L1', ['F1', 'a'], HELD)]
    expect(await photoPassById('L1', 'pass')).toMatchObject({ wrote: ['stripped', 'released'] })
    expect(photos()).toEqual(['a'])
    expect(row().verified).toBe(true)
  })

  it('a listing its seller hid stays hidden: published, no "live again"', async () => {
    h.rows = [listing('L1', ['a'], { ...HELD, status: 'hidden' })]
    await photoPassById('L1', 'pass')
    expect(row()).toMatchObject({ verified: true, status: 'hidden' })
    expect(h.bells).toEqual([])
  })

  it('⛔ a photo that held the listing is asked of BOTH models again; a new photo the usual way', async () => {
    h.rows = [listing('L1', ['F1', 'a'], HELD)]
    h.audits = [{ id: 1, occurredAt: new Date(), action: 'listing.photo.held', subjectType: 'listing', subjectId: 'L1', detail: { photos: [{ i: 0, key: 'F1.webp', rule: 'flyer' }] } }]
    h.auditSeq = 1
    await photoPassById('L1', 'pass')
    expect(h.verdictCalls.map((c) => [c.key, c.confirm])).toEqual([['F1.webp', 'both'], ['a.webp', 'after']])
  })

  it('a release refused for now (an open report) stays queued, so it goes out once the report closes', async () => {
    h.rows = [listing('L1', ['a'], { ...HELD, reports: [{ status: 'open' }] })]
    expect(await photoPassById('L1', 'pass')).toMatchObject({ plan: { release: true }, wrote: [] })
    expect(h.pending).toEqual(['L1'])
    expect(h.done).toEqual([])
  })

  it('⛔ A9: one photo fine and one undecided never releases — the row waits in the pending set', async () => {
    h.rows = [listing('L1', ['a', 'zz'], HELD)]
    expect(await photoPassById('L1', 'pass')).toMatchObject({ plan: { pending: true }, wrote: [] })
    expect(row()).toMatchObject(HELD)
    expect(h.pending).toEqual(['L1'])
  })

  it('⛔ the photos released are the photos checked: an edit adding one during the check publishes nothing', async () => {
    h.rows = [listing('L1', ['a'], HELD)]
    h.duringVerdict = () => { row().images = JSON.stringify([u('a'), u('F1')]) }
    expect(await photoPassById('L1', 'pass')).toMatchObject({ wrote: [] })
    expect(row()).toMatchObject(HELD)
  })

  it('an uncleared licence-aisle row is not released (the licence check still owns going live)', async () => {
    h.rows = [listing('L1', ['a'], { ...HELD, category: { slug: 'services' }, subcategorySlug: 'visa-legal' })]
    await photoPassById('L1', 'pass')
    expect(row()).toMatchObject(HELD)
  })

  it('⛔ A11: an owner the identity gate refuses → parked, the photo mark dropped in the park; verifying publishes it', async () => {
    h.rows = [listing('L1', ['a'], HELD)]
    h.idHeld = ['L1']
    expect(await photoPassById('L1', 'pass')).toMatchObject({ wrote: ['released'] })
    expect(row()).toMatchObject({ verified: false, identityHold: true, verificationNotes: null })
    expect(h.audits[0]).toMatchObject({ action: 'listing.photo.released', detail: { parked: true } })
    expect(h.bells).toEqual([])
    // The owner verifies: the identity gate's own release publishes it (the photo guard lets it through — no mark).
    h.idHeld = []
    expect(await releaseIdentityHolds('owner-1')).toBe(1)
    expect(row()).toMatchObject({ verified: true, identityHold: false, verificationNotes: null })
  })

  it('…whereas a row still carrying the mark is never published by the identity release', async () => {
    h.rows = [listing('L1', ['a'], { ...HELD, identityHold: true })]
    expect(await releaseIdentityHolds('owner-1')).toBe(0)
    expect(row()).toMatchObject({ verified: false, verificationNotes: 'photo:held' })
  })
})

describe('⛔ A10 — a takedown during a photo hold is never republished by a photo release', () => {
  // The moderation and provenance holds hide the row, file an OPEN report and drop the photo mark in one transaction
  // (their own tests pin the drop); licence holds write licenceHeldMark, which is null for a photo-held row.
  const takedowns: Array<[string, (r: Row) => void]> = [
    ['the AI moderation hold', (r) => { Object.assign(r, { status: 'hidden', verified: false, identityHold: false, verificationNotes: null }); r.reports.push({ status: 'open' }) }],
    ['the image provenance hold', (r) => { Object.assign(r, { status: 'hidden', verified: false, identityHold: false, verificationNotes: null }); r.reports.push({ status: 'open' }) }],
    ['a licence hold', (r) => { Object.assign(r, { verified: false, identityHold: false, ...licenceHeldMark(r as never) }) }],
    ['moderation Unpublish / admin Unverify', (r) => { Object.assign(r, { verified: false, identityHold: false, verificationNotes: null }) }],
    ['admin Hide', (r) => { Object.assign(r, { status: 'hidden', verified: false, identityHold: false, verificationNotes: null }) }],
    ['a confirmed report (bulk-confirm, confirm-report — the mark kept)', (r) => { r.reports.push({ status: 'confirmed' }) }],
    ['the owner held by enforcement', (r) => { r.seller.owner.enforcementState = 'held' }],
    ['the owner suspended', (r) => { r.seller.owner.enforcementState = 'suspended' }],
    ['the storefront Restricted', (r) => { r.seller.trustTier = 'restricted' }],
  ]

  it.each(takedowns)('%s landing DURING the release\'s check', async (_name, takedown) => {
    h.rows = [listing('L1', ['a'], HELD)]
    h.duringVerdict = () => takedown(row())
    await photoPassById('L1', 'pass')
    expect(row().verified).toBe(false)
    expect(actions()).not.toContain('listing.photo.released')
    expect(h.bells).toEqual([])
  })

  it.each(takedowns)('%s landing BEFORE the seller fixes the photo', async (_name, takedown) => {
    h.rows = [listing('L1', ['a'], HELD)]
    takedown(row())
    await photoPassById('L1', 'pass')
    expect(row().verified).toBe(false)
    expect(actions()).not.toContain('listing.photo.released')
  })

  it('an open report alone (a takedown that forgot the mark) still refuses the release', async () => {
    h.rows = [listing('L1', ['a'], { ...HELD, reports: [{ status: 'open' }] })]
    await photoPassById('L1', 'pass')
    expect(row()).toMatchObject(HELD)
  })

  it('…and once the hold is lifted, the fixed photo releases it as usual', async () => {
    h.rows = [listing('L1', ['a'], HELD)]
    row().seller.owner.enforcementState = 'good_standing'
    await photoPassById('L1', 'pass')
    expect(row().verified).toBe(true)
  })
})

describe('restoreOrder (A13) — pure', () => {
  const strip = { before: ['a', 'F1', 'b', 'F2'], removed: [{ i: 1, url: 'F1', key: 'F1', rule: 'flyer' as const }, { i: 3, url: 'F2', key: 'F2', rule: 'contact' as const }] }
  it('nothing edited since: the original order', () => {
    expect(restoreOrder(['a', 'b'], [strip], ['F1', 'F2']).images).toEqual(['a', 'F1', 'b', 'F2'])
  })
  it('the seller edited since: each goes after the nearest photo before it that is still there, and their edits stay', () => {
    expect(restoreOrder(['b', 'c'], [strip], ['F1', 'F2']).images).toEqual(['F1', 'b', 'F2', 'c'])
  })
  it('only the keys asked for, and never twice', () => {
    expect(restoreOrder(['a', 'b'], [strip], ['F2']).images).toEqual(['a', 'b', 'F2'])
    expect(restoreOrder(['F1', 'a'], [strip], ['F1'])).toEqual({ images: ['F1', 'a'], restored: [] })
  })
})

describe('restoreStrippedPhotos (A13) — "Photo is fine"', () => {
  it('⛔ puts the photos back around the seller\'s later edits, cancels their tombstones, records the admin', async () => {
    h.rows = [listing('L1', ['a', 'F1', 'b', 'F2'])]
    await photoPassById('L1', 'pass')
    expect(photos()).toEqual(['a', 'b'])
    row().images = JSON.stringify([u('b'), u('c')]) // the seller's edit since: a removed, c added
    expect(await restoreStrippedPhotos('L1', ['F1.webp', 'F2.webp'], 'mod@eno.vn')).toEqual([u('F1'), u('F2')])
    expect(photos()).toEqual(['F1', 'b', 'F2', 'c'])
    expect(h.cancelled).toEqual([{ bucket: 'listings', path: { in: ['F1.webp', 'F2.webp'] }, reason: 'listing_photo_stripped' }])
    expect(h.audits.at(-1)).toMatchObject({ action: 'listing.photo.restored', actorType: 'admin', actorId: 'mod@eno.vn', detail: { restored: [{ i: 1, key: 'F1.webp' }, { i: 3, key: 'F2.webp' }] } })
    expect(h.refreshed.at(-1)).toEqual({ ids: ['L1'], opts: { home: true } })
  })

  it('past the keep window nothing comes back (the object may be gone)', async () => {
    h.rows = [listing('L1', ['a', 'F1'])]
    h.now = Date.now() - STRIPPED_KEEP_MS
    await photoPassById('L1', 'pass')
    expect(await restoreStrippedPhotos('L1', ['F1.webp'], 'mod@eno.vn')).toEqual([])
    expect(photos()).toEqual(['a'])
  })

  it('a tombstoned listing → null', async () => {
    h.rows = [listing('L1', ['a'], { status: 'removed' })]
    expect(await restoreStrippedPhotos('L1', ['F1.webp'], 'mod@eno.vn')).toBeNull()
  })

  it('⛔ the override is written with the restore: once on success, and not at all when the restore loses its race', async () => {
    h.rows = [listing('L1', ['a', 'F1'])]
    await photoPassById('L1', 'pass')
    const overrides = () => h.audits.filter((x) => x.action === 'listing.photo.override')
    // The compare-and-set loses (an edit between the read and the write).
    const listingDb = (await import('@/lib/db')).db.listing as Row
    const updateMany = listingDb.updateMany
    listingDb.updateMany = async () => ({ count: 0 })
    expect(await restoreStrippedPhotos('L1', ['F1.webp'], 'mod@eno.vn')).toBeNull()
    listingDb.updateMany = updateMany
    expect(overrides()).toEqual([])
    expect(await restoreStrippedPhotos('L1', ['F1.webp'], 'mod@eno.vn')).toEqual([u('F1')])
    expect(overrides()).toEqual([expect.objectContaining({ actorType: 'admin', actorId: 'mod@eno.vn', subjectId: 'L1', detail: { key: 'F1.webp' } })])
  })

  it('a held-only key (nothing to put back): the override alone', async () => {
    h.rows = [listing('L1', ['F1'])]
    expect(await restoreStrippedPhotos('L1', ['F1.webp'], 'mod@eno.vn')).toEqual([])
    expect(h.audits).toEqual([expect.objectContaining({ action: 'listing.photo.override', detail: { key: 'F1.webp' } })])
  })
})
