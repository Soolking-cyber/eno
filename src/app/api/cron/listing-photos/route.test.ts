import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// /api/cron/listing-photos — the photo sweep over listings already on the site (owner, 2026-11-15). Writes are OFF unless
// PHOTO_RULES_WRITE=1 (A16): a dry run checks, writes nothing and answers per outcome and per storefront. The walk goes
// home cards → in-app by rank → the rest, and resumes from its cursor; recent reads the queue (a third of the run at most),
// then what changed; a storefront the pass's breaker tripped answers 500 mass_hold (A12), and a spent lane stops the run.
// The pass itself is a stand-in here (listing-photo-pass.test.ts).
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  rows: [] as Row[],
  tripped: new Set<string>(),
  results: {} as Record<string, any>,
  calls: [] as Row[],
  done: [] as string[],
  pending: [] as string[],
  homeIds: [] as string[],
  kv: new Map<string, unknown>(),
  errors: [] as unknown[],
}))

const OPS = ['in', 'notIn', 'not', 'gt', 'gte', 'lt']
function cond(v: any, c: any): boolean {
  if (c === null) return v == null
  if (c instanceof Date) return v instanceof Date && v.getTime() === c.getTime()
  if (typeof c !== 'object') return v === c
  const n = (x: any) => (x instanceof Date ? x.getTime() : x)
  return Object.entries(c).every(([op, x]: [string, any]) => {
    if (op === 'in') return x.includes(v)
    if (op === 'notIn') return v != null && !x.includes(v)
    if (op === 'not') return x === null ? v != null : v != null && v !== x
    if (op === 'gt') return v != null && n(v) > n(x)
    if (op === 'gte') return v != null && n(v) >= n(x)
    if (op === 'lt') return v != null && n(v) < n(x)
    throw new Error(`unexpected operator ${op}`)
  })
}
function matches(row: Row, where: Row | undefined): boolean {
  return Object.entries(where ?? {}).every(([k, c]: [string, any]) => {
    if (k === 'AND') return (c as Row[]).every((x) => matches(row, x))
    if (k === 'OR') return (c as Row[]).some((x) => matches(row, x))
    if (k === 'NOT') return !matches(row, c)
    const v = row[k]
    if (c && typeof c === 'object' && !(c instanceof Date) && !Object.keys(c).some((op) => OPS.includes(op))) return v != null && matches(v, c)
    return cond(v, c)
  })
}
function sorted(rows: Row[], orderBy: Row[] = []): Row[] {
  const val = (x: any) => (x instanceof Date ? x.getTime() : x)
  return [...rows].sort((a, b) => {
    for (const o of orderBy) {
      const [[f, dir]] = Object.entries(o) as Array<[string, string]>
      if (val(a[f]) !== val(b[f])) return (val(a[f]) < val(b[f]) ? -1 : 1) * (dir === 'desc' ? -1 : 1)
    }
    return 0
  })
}

vi.mock('@/lib/api/handler', () => {
  class ApiError extends Error { constructor(public code: string, public status = 400) { super(code) } }
  const route = (_o: unknown, fn: (ctx: { req: Request }) => Promise<unknown>) => async (req: Request) => {
    try {
      const d = await fn({ req })
      return d instanceof Response ? d : Response.json(d ?? {})
    } catch (e) {
      if (e instanceof ApiError) return Response.json({ error: e.code }, { status: e.status })
      throw e
    }
  }
  return { ApiError, route }
})
vi.mock('@/lib/edition', () => ({ IS_MARKETPLACE: true }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: Row) => w }))
vi.mock('@/lib/feed-diversity', () => ({ HOME_FEED_SEATS: {} }))
vi.mock('@/lib/feed-window', () => ({ diverseFeedHead: async () => [] }))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {} }))
vi.mock('@/lib/core/category-rails', () => ({ homeCategoryRails: async () => [{ slug: 'rentals', listings: h.homeIds.map((id) => ({ id })) }] }))
vi.mock('@/lib/core/trending-rail', () => ({ trendingRailListings: async () => [] }))
vi.mock('@/lib/core/business-rail', () => ({ topBusinessListings: async () => { throw new Error('rail down') } }))
vi.mock('@/lib/listing-photo-check', () => ({ PHOTO_CHECK_EXEMPT: { categories: ['teachers'] } }))
vi.mock('@/lib/log', () => ({ logError: (e: unknown) => { h.errors.push(e) } }))
vi.mock('@/lib/listing-photo-hooks', () => ({
  photoRulesLive: () => process.env.PHOTO_RULES_WRITE === '1',
  photoCheckDone: async (id: string) => { h.done.push(id) },
}))
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    get: async (k: string) => (h.kv.has(k) ? JSON.parse(JSON.stringify(h.kv.get(k))) : null),
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => { if (o?.nx && h.kv.has(k)) return null; h.kv.set(k, v); return 'OK' },
    del: async (k: string) => { h.kv.delete(k) },
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: async (a: Row) => sorted(h.rows.filter((r) => matches(r, a.where)), a.orderBy).slice(0, a.take ?? Infinity),
      count: async (a: Row) => h.rows.filter((r) => matches(r, a.where)).length,
    },
    $queryRaw: async () => h.pending.map((id) => ({ key: `listing-photo:pending:${id}` })),
  },
}))
vi.mock('@/lib/listing-photo-pass', () => ({
  // The pass's own contract: a dry run plans only; a hold or strip asks the storefront breaker (tripped unless ?allow), then
  // the run's cap, and reports which refused.
  photoPassById: async (id: string, lane: string, o: Row) => {
    h.calls.push({ id, lane, dryRun: o.dryRun, mayWrite: !!o.mayWrite, allow: [...(o.allow ?? [])] })
    const v = h.results[id] ?? { plan: {} }
    if ('skip' in v) return v
    const p = v.plan
    const budget = v.budget ? { budget: true } : {}
    if (o.dryRun) return { plan: p, dryRun: true, wrote: [], ...budget }
    const acts = [...(p.hold ? ['held'] : []), ...(p.strip ? ['stripped'] : []), ...(p.release ? ['released'] : [])]
    const seller = h.rows.find((r) => r.id === id)!.sellerId
    if ((p.hold || p.strip) && h.tripped.has(seller) && !o.allow?.has(seller)) return { plan: p, dryRun: false, wrote: [], breaker: 'storefront' }
    if ((p.hold || p.strip) && !(await o.mayWrite({ id, sellerId: seller }, p))) return { plan: p, dryRun: false, wrote: [], breaker: 'run' }
    return { plan: p, dryRun: false, wrote: acts, ...budget }
  },
}))

const { GET } = await import('./route')
const call = async (q = '') => {
  const res = await (GET as unknown as (r: Request) => Promise<Response>)(new Request(`https://eno.vn/api/cron/listing-photos${q}`))
  return { status: res.status, body: (await res.json()) as Row }
}
const ids = () => h.calls.map((c) => c.id)

let t = 0
function listing(id: string, o: Row = {}): Row {
  return {
    id, sellerId: 's1', images: JSON.stringify(['a']), rankScore: 0, status: 'active', verified: true, identityHold: false,
    verificationNotes: null, affiliateUrl: null, category: { slug: 'electronics' }, updatedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, ++t)),
    createdAt: new Date(Date.UTC(2026, 9, 1)), ...o,
  }
}

beforeEach(() => {
  Object.assign(h, { rows: [], results: {}, calls: [], done: [], pending: [], homeIds: [], errors: [] })
  h.kv.clear(); h.tripped.clear()
})
afterEach(() => vi.unstubAllEnvs())

describe('/api/cron/listing-photos', () => {
  it('⛔ A16: writes are OFF by default — every pass is a dry run, nothing leaves the queue, and the answer counts per outcome and per storefront', async () => {
    h.rows = [listing('L1'), listing('L2'), listing('L3', { sellerId: 's2' }), listing('L4', { sellerId: 'sdc' })]
    h.results = { L1: { plan: { hold: true } }, L3: { plan: { strip: [1], release: true } }, L4: { skip: 'exempt' } }
    h.pending = ['L1', 'GONE']
    const { status, body } = await call('?scope=backfill')
    expect(status).toBe(200)
    expect(h.calls.every((c) => c.dryRun === true && !c.mayWrite && c.lane === 'sweep')).toBe(true)
    expect(body).toMatchObject({ ok: true, dryRun: true, scope: 'backfill', listings: 4, outcomes: { held: 1, clean: 1, stripped: 1, released: 1, exempt: 1 } })
    expect(body.storefronts).toEqual({
      s1: { listings: 2, held: 1, clean: 1, sample: ['L1'] },
      s2: { listings: 1, stripped: 1, released: 1, sample: ['L3'] },
      sdc: { listings: 1, exempt: 1 },
    })
    // A dry run keeps its own cursor: the real run after it starts from the top.
    expect(h.kv.has('listing-photo:walk:dry')).toBe(true)
    expect(h.kv.has('listing-photo:walk:write')).toBe(false)
    expect(h.done).toEqual([])
  })

  it('?dryRun=1 is a dry run even with PHOTO_RULES_WRITE=1', async () => {
    vi.stubEnv('PHOTO_RULES_WRITE', '1')
    h.rows = [listing('L1')]
    h.results = { L1: { plan: { hold: true } } }
    const { body } = await call('?scope=backfill&dryRun=1')
    expect(body).toMatchObject({ dryRun: true, outcomes: { held: 1 } })
    expect(h.calls[0]).toMatchObject({ dryRun: true, mayWrite: false })
  })

  it('the walk: home cards, then in-app listings by rank, then the rest — resumed from its cursor, stopped at the end, restarted by `full`', async () => {
    h.homeIds = ['H2', 'H1']
    h.rows = [
      listing('H1', { rankScore: 0 }), listing('H2', { rankScore: 0 }),
      listing('C', { rankScore: 1 }), listing('A', { rankScore: 9 }), listing('B', { rankScore: 5 }),
      listing('X', { affiliateUrl: 'https://partner.example/x', rankScore: 99 }),
      // ⛔ never read: a teacher (the teacher check owns them), a removed row, a row someone else unpublished
      listing('T', { category: { slug: 'teachers' } }), listing('R', { status: 'removed' }), listing('U', { verified: false }),
      // a photo-held row is read whatever its status: its release is the pass's
      listing('P', { verified: false, status: 'hidden', verificationNotes: 'photo:held', affiliateUrl: 'https://p.example' }),
    ]
    await call('?scope=backfill&limit=4')
    expect(ids()).toEqual(['H1', 'H2', 'A', 'B', 'C'])
    h.calls = []
    const second = await call('?scope=backfill&limit=4')
    expect(ids()).toEqual(['P', 'X'])
    expect(second.body.walk).toMatchObject({ phase: 'done', home: 2 })
    h.calls = []
    expect((await call('?scope=backfill')).body.walk).toMatchObject({ phase: 'done' })
    expect(ids()).toEqual([])
    await call('?scope=full&limit=4')
    expect(ids()).toEqual(['H1', 'H2', 'A', 'B', 'C'])
    // A rail that failed is logged, never a failed walk.
    expect(h.errors).toHaveLength(2)
  })

  it('the timer (no scope): recent first, then the walk while one is under way or a week after the last one ended', async () => {
    h.rows = [listing('A')]
    const done = { phase: 'done', home: [], after: null, startedAt: '2026-11-01T00:00:00.000Z', doneAt: new Date().toISOString() }
    h.kv.set('listing-photo:walk:dry', done)
    h.kv.set('listing-photo:recent:dry', { at: new Date().toISOString(), id: '' })
    expect((await call()).body).toMatchObject({ scope: 'timer', walk: { phase: 'done' }, recent: { caughtUp: true } })
    expect(ids()).toEqual([])
    h.kv.set('listing-photo:walk:dry', { ...done, doneAt: new Date(Date.now() - 8 * 24 * 3600_000).toISOString() })
    await call()
    expect(ids()).toEqual(['A'])
  })

  it('recent: the queue first, then rows changed since the mark — and in a real run a queued row the pass may not act on leaves the queue', async () => {
    vi.stubEnv('PHOTO_RULES_WRITE', '1')
    const mark = new Date(Date.UTC(2026, 10, 1, 0, 0, 30))
    h.rows = [
      listing('Q', { updatedAt: new Date(Date.UTC(2026, 9, 1)) }),
      listing('OLD', { updatedAt: new Date(Date.UTC(2026, 9, 2)) }),
      listing('NEW', { updatedAt: new Date(Date.UTC(2026, 10, 2)) }),
      listing('RAW', { updatedAt: new Date(Date.UTC(2026, 9, 3)), createdAt: new Date(Date.UTC(2026, 10, 3)) }),
      listing('TEACH', { category: { slug: 'teachers' } }),
      listing('EX', { updatedAt: new Date(Date.UTC(2026, 9, 4)) }),
    ]
    h.results = { EX: { skip: 'exempt' } }
    h.pending = ['Q', 'TEACH', 'EX']
    h.kv.set('listing-photo:recent:write', { at: mark.toISOString(), id: '' })
    const { body } = await call('?scope=recent')
    // The queue, then what was updated since the mark, then what was created since it (RAW: a raw insert, old updatedAt).
    expect(ids()).toEqual(['Q', 'EX', 'NEW', 'RAW'])
    expect(h.done.sort()).toEqual(['EX', 'TEACH'])
    expect(body).toMatchObject({ dryRun: false, recent: { queued: 3, caughtUp: true } })
    expect(body.walk).toBeUndefined()
    // Caught up: the next run reads from this one's start, less five minutes.
    expect(Date.parse((h.kv.get('listing-photo:recent:write') as Row).at)).toBeGreaterThan(Date.now() - 6 * 60_000)
    expect(h.calls.every((c) => c.dryRun === false && c.mayWrite)).toBe(true)
  })

  it('⛔ A12: a storefront the pass\'s breaker tripped → 500 mass_hold naming it; ?allow=<sellerId> goes to the pass', async () => {
    vi.stubEnv('PHOTO_RULES_WRITE', '1')
    h.rows = [listing('N1'), listing('N2'), listing('M1', { sellerId: 's2' })]
    h.results = { N1: { plan: { hold: true } }, N2: { plan: { strip: [0] } }, M1: { plan: { hold: true } } }
    h.tripped.add('s1')
    const tripped = await call('?scope=backfill')
    expect(tripped.status).toBe(500)
    expect(tripped.body).toMatchObject({ ok: false, refused: 'mass_hold', sellers: ['s1'], runCapped: false, outcomes: { held: 1, breaker: 2 } })

    h.kv.clear(); h.calls = []
    const allowed = await call('?scope=backfill&allow=s1')
    expect(allowed.status).toBe(200)
    expect(allowed.body).toMatchObject({ ok: true, outcomes: { held: 2, stripped: 1 } })
    expect(h.calls.every((c) => c.allow.join() === 's1')).toBe(true)
  })

  it('⛔ A12: past 100 holds and strips in one run, nothing more is written — 500, runCapped', async () => {
    vi.stubEnv('PHOTO_RULES_WRITE', '1')
    h.rows = Array.from({ length: 102 }, (_, i) => listing(`L${String(i).padStart(3, '0')}`, { sellerId: `s${i}` }))
    h.results = Object.fromEntries(h.rows.map((r) => [r.id, { plan: { hold: true } }]))
    const { status, body } = await call('?scope=backfill')
    expect(status).toBe(500)
    expect(body).toMatchObject({ refused: 'mass_hold', runCapped: true, outcomes: { held: 100, breaker: 2 } })
  })

  it('⛔ a spent lane stops the run where it is: no more passes, the walk\'s cursor before the rows it could not read', async () => {
    h.rows = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => listing(id))
    h.results = { B: { plan: { pending: true }, budget: true } }
    expect((await call('?scope=backfill')).body).toMatchObject({ ok: true, stopped: 'budget' })
    expect(ids()).toEqual(['A', 'B', 'C', 'D'])
    expect((h.kv.get('listing-photo:walk:dry') as Row).after).toBeNull()
    h.calls = []; h.results = {}
    await call('?scope=backfill')
    expect(ids()).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  it('⛔ the queue takes a third of the run at most: rows that never decide cannot starve what changed', async () => {
    vi.stubEnv('PHOTO_RULES_WRITE', '1')
    const old = new Date(Date.UTC(2026, 9, 1))
    h.rows = [...Array.from({ length: 40 }, (_, i) => listing(`Q${String(i).padStart(2, '0')}`, { updatedAt: old, createdAt: old })), listing('NEW', { updatedAt: new Date(Date.UTC(2026, 10, 2)) })]
    h.pending = h.rows.filter((r) => r.id !== 'NEW').map((r) => r.id)
    h.results = Object.fromEntries(h.pending.map((id) => [id, { plan: { pending: true } }]))
    h.kv.set('listing-photo:recent:write', { at: new Date(Date.UTC(2026, 10, 1)).toISOString(), id: '' })
    await call('?scope=recent&limit=30')
    expect(ids().filter((id) => id.startsWith('Q'))).toHaveLength(12)
    expect(ids()).toContain('NEW')
  })

  it('⛔ C1: the queue is read oldest-queued first — `id IN` answers in another order, and the third goes to the oldest', async () => {
    vi.stubEnv('PHOTO_RULES_WRITE', '1')
    const old = new Date(Date.UTC(2026, 9, 1))
    h.rows = Array.from({ length: 40 }, (_, i) => listing(`Q${String(i).padStart(2, '0')}`, { updatedAt: old, createdAt: old }))
    // Oldest-queued first is the reverse of the table's own order here.
    h.pending = h.rows.map((r) => r.id).reverse()
    h.results = Object.fromEntries(h.pending.map((id) => [id, { plan: { pending: true } }]))
    h.kv.set('listing-photo:recent:write', { at: new Date(Date.UTC(2026, 10, 1)).toISOString(), id: '' })
    await call('?scope=recent&limit=30')
    expect(ids()).toEqual(h.pending.slice(0, 12))
  })

  it('⛔ C2: a full page of rows created after the mark with an older updatedAt is read once, and the run gets past it', async () => {
    vi.stubEnv('PHOTO_RULES_WRITE', '1')
    const mark = new Date(Date.UTC(2026, 10, 1))
    h.rows = [
      ...Array.from({ length: 100 }, (_, i) => listing(`RAW${String(i).padStart(3, '0')}`, { updatedAt: new Date(Date.UTC(2026, 9, 1)), createdAt: new Date(Date.UTC(2026, 10, 2)) })),
      listing('RAWLAST', { updatedAt: new Date(Date.UTC(2026, 9, 1)), createdAt: new Date(Date.UTC(2026, 10, 3)) }),
      listing('NEW', { updatedAt: new Date(Date.UTC(2026, 10, 4)) }),
    ]
    h.kv.set('listing-photo:recent:write', { at: mark.toISOString(), id: '' })
    const first = await call('?scope=recent&limit=5000')
    expect(first.body.recent).toMatchObject({ caughtUp: true })
    expect(new Set(ids())).toEqual(new Set(h.rows.map((r) => r.id)))
    expect(ids()).toHaveLength(102)
    // The next run reads none of them again.
    h.calls = []
    await call('?scope=recent&limit=5000')
    expect(ids()).toEqual([])
  })

  it('refuses a bad scope, limit or allow; one run per mode at a time', async () => {
    for (const q of ['?scope=all', '?limit=0', '?limit=5001', '?limit=x', '?allow=a;b']) expect((await call(q)).status, q).toBe(400)
    h.kv.set('listing-photo:run:dry', 1)
    expect((await call('?scope=backfill')).body).toEqual({ ok: true, skipped: 'busy', dryRun: true })
    expect(h.calls).toEqual([])
  })
})
