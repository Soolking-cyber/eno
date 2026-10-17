import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreConfig } from './partner-fetch'
import type { FeedFacts, PageRead } from './secondhand-showcase'

/**
 * The weekly second-hand showcase run (owner, 2026-10-17: one listing per category; phones two) against an in-memory
 * database that applies the run's own statements — the same conditions (status, updatedAt as read, the shelf's live
 * count under its target) — so what is asserted is what the SQL would do: never past a shelf's target, never a
 * retirement without per-row evidence, nothing written by a dry run or a refused one, every write journaled.
 */

const h = vi.hoisted(() => ({ stores: [] as StoreConfig[] }))
vi.mock('./partner-stores', () => ({ get PARTNER_STORES() { return h.stores } }))

const { runShowcase, fetchPageHonest, shopAddress, fetchFeedFacts } = await import('./secondhand-showcase-run')

type L = {
  id: string; sellerId: string; status: string; listingType: string; price: number; title: string; titleVi: string | null
  externalId: string | null; affiliateUrl: string | null; upd: string; created: string; category: string | null; subcategory: string | null
  condition: string | null
}
let rows: L[] = []
let poolTable = new Set<string>()
let writes: string[] = []
let sellers: { id: string; name: string; ownerId: string | null }[] = []
let beforeRestore: (() => void) | null = null
/** hidden_at as the trims wrote it. */
const poolStamps = new Map<string, string>()
/** Listings with an open report (the restore's NOT EXISTS). */
let reported = new Set<string>()

const fakeDb = {
  async $queryRawUnsafe<T>(sql: string, ...v: unknown[]): Promise<T> {
    if (sql.includes('FROM "Seller"')) return sellers.filter((s) => s.name === v[0] && s.ownerId === null).map((s) => ({ id: s.id })) as T
    if (sql.includes('_hide_secondhand_20261016')) {
      return rows.filter((r) => r.sellerId === v[0] && poolTable.has(r.id) && r.status === 'hidden').sort((a, b) => b.created.localeCompare(a.created))
        .map((r) => ({ ...r, description: null, descriptionVi: null })) as T
    }
    if (sql.includes('"subcategorySlug" = $2')) { // the capped shelves' read
      return rows.filter((r) => (v[0] as string[]).includes(r.sellerId) && r.status === 'active' && r.subcategory === v[1]).sort((a, b) => a.created.localeCompare(b.created))
        .map((r) => ({ id: r.id, sellerId: r.sellerId, title: r.titleVi ?? r.title, upd: r.upd, created: r.created })) as T
    }
    if (sql.includes(`l.status = 'active' AND l."listingType" = 'sell'`)) {
      return rows.filter((r) => r.sellerId === v[0] && r.status === 'active' && r.listingType === 'sell').sort((a, b) => b.created.localeCompare(a.created)).map((r) => ({ ...r })) as T
    }
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`)
  },
  async $executeRawUnsafe(sql: string, ...v: unknown[]): Promise<number> {
    if (sql.includes('pg_advisory_xact_lock')) return 1
    if (sql.startsWith('INSERT INTO "_hide_secondhand_20261016"')) { poolTable.add(String(v[0])); poolStamps.set(String(v[0]), String(v[1])); return 1 }
    writes.push(sql)
    const r = rows.find((x) => x.id === v[0])
    // The storefront guard every write carries (OWNERLESS_SQL).
    if (r && sql.includes('so."ownerId" IS NULL') && sellers.find((x) => x.id === r.sellerId)?.ownerId !== null) return 0
    if (sql.includes(`SET status = 'sold'`)) {
      if (!r || r.status !== 'active' || r.upd !== v[2]) return 0
      r.status = 'sold'; r.upd = String(v[1]); return 1
    }
    if (sql.includes(`SET status = 'hidden'`)) {
      if (!r || r.status !== 'active' || r.upd !== v[2]) return 0
      r.status = 'hidden'; r.upd = String(v[1]); return 1
    }
    if (sql.includes('SET price = $2') && !sql.includes(`status = 'active', price`)) {
      if (!r || r.status !== 'active' || r.upd !== v[3]) return 0
      r.price = Number(v[1]); r.upd = String(v[2]); return 1
    }
    if (sql.includes(`SET status = 'active'`)) {
      beforeRestore?.()
      if (r && sql.includes('so."ownerId" IS NULL') && sellers.find((x) => x.id === r.sellerId)?.ownerId !== null) return 0
      const onShelf = rows.filter((x) => (v[4] as string[]).includes(x.sellerId) && x.status === 'active' && x.listingType === 'sell' && !!r && x.category === r.category && x.subcategory === r.subcategory).length
      if (!r || r.status !== 'hidden' || r.upd !== v[3] || onShelf >= Number(v[5])) return 0
      if (sql.includes('FROM "Report"') && reported.has(r.id)) return 0
      if (sql.includes('FROM "_hide_secondhand_20261016" h') && !poolTable.has(r.id)) return 0
      r.status = 'active'; r.price = Number(v[1]); r.upd = String(v[2]); return 1
    }
    throw new Error(`unexpected write: ${sql.slice(0, 80)}`)
  },
  async $transaction<T>(fn: (tx: typeof fakeDb) => Promise<T>): Promise<T> { return fn(fakeDb) },
}

const shopA = (over: Partial<StoreConfig> = {}): StoreConfig => ({ domain: 'a.example', name: 'Shop A', city: 'HCM', adapter: 'sitemap-jsonld', endpoint: '', condition: 'used', sitemaps: ['https://a.example/sitemap.xml'], urlMatch: '^https://a\\.example/p/', ...over })
const shopB = (over: Partial<StoreConfig> = {}): StoreConfig => ({ domain: 'b.example', name: 'Shop B', city: 'HCM', adapter: 'sitemap-jsonld', endpoint: '', condition: 'used', sitemaps: ['https://b.example/sitemap.xml'], urlMatch: '^https://b\\.example/p/', ...over })
const ld = (name: string, availability: string, price: number) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, offers: { availability: `https://schema.org/${availability}`, price } })}</script>`
let pages: Record<string, PageRead | ((n: number) => PageRead)> = {}
const hits: Record<string, number> = {}
const pageOf = (url: string, status: number, html: string): PageRead => ({ url, status, finalUrl: url, html })
const R = (id: string) => rows.find((r) => r.id === id)!
const urlOf = (id: string) => R(id).affiliateUrl!
const onSale = (id: string, price = R(id).price, name = R(id).titleVi ?? R(id).title) => (pages[urlOf(id)] = pageOf(urlOf(id), 200, ld(name, 'InStock', price)))
const gone = (id: string) => (pages[urlOf(id)] = pageOf(urlOf(id), 404, ''))
const blocked = (id: string) => (pages[urlOf(id)] = pageOf(urlOf(id), 403, '<title>Attention Required! | Cloudflare</title>'))

function deps(feed?: FeedFacts) {
  return {
    db: fakeDb,
    fetchPage: async (url: string) => { hits[url] = (hits[url] ?? 0) + 1; const p = pages[url]; return typeof p === 'function' ? p(hits[url]) : p ?? pageOf(url, 404, '') },
    fetchFeed: async () => { if (!feed) throw new Error('feed down'); return feed },
    fetchApi: async () => ({ status: 404 }),
    now: () => new Date('2026-10-19T00:00:00Z'),
    sleep: async () => {},
    log: () => {},
    onTouched: vi.fn(async () => {}),
  }
}

let n = 0
function listing(over: Partial<L> & { id: string; sellerId: string }): L {
  n++
  const host = over.sellerId === 'sb' ? 'b.example' : 'a.example'
  return {
    status: 'active', listingType: 'sell', price: 1000000, title: `Item ${over.id}`, titleVi: `Món ${over.id} cũ`, externalId: over.id,
    affiliateUrl: `https://${host}/p/${over.id}`, upd: '2026-10-16 04:51:29.644', created: `2026-09-10 00:00:${String(n).padStart(2, '0')}`,
    category: 'electronics', subcategory: 'laptops-pcs', condition: 'used', ...over,
  }
}
/**
 * Shop A: phones a1 a2 a3, laptop a4; pool: phone ap2, laptop ap1 (the newest row of all). Shop B: laptop b1 (the newest
 * live laptop), b2 on no subcategory shelf; pool laptop bp1. `created` grows in the order listed.
 */
function seed() {
  n = 0
  rows = [
    listing({ id: 'a1', sellerId: 'sa', subcategory: 'phones-tablets', titleVi: 'iPhone 16 128GB Xanh cũ' }),
    listing({ id: 'a2', sellerId: 'sa', subcategory: 'phones-tablets', titleVi: 'iPhone 16 Plus 128GB Hồng cũ' }),
    listing({ id: 'a3', sellerId: 'sa', subcategory: 'phones-tablets', titleVi: 'Samsung Galaxy A57 cũ' }),
    listing({ id: 'a4', sellerId: 'sa', titleVi: 'Dell Latitude 5490 cũ' }),
    listing({ id: 'b1', sellerId: 'sb', titleVi: 'ThinkPad T460 cũ' }),
    listing({ id: 'b2', sellerId: 'sb', subcategory: null, titleVi: 'Dàn lạnh Daikin cũ' }),
    listing({ id: 'ap2', sellerId: 'sa', status: 'hidden', subcategory: 'phones-tablets', titleVi: 'Xiaomi Redmi Note 15 cũ' }),
    listing({ id: 'bp1', sellerId: 'sb', status: 'hidden', titleVi: 'HP EliteBook 840 cũ' }),
    listing({ id: 'ap1', sellerId: 'sa', status: 'hidden', titleVi: 'MacBook Air M1 cũ' }),
  ]
  poolTable = new Set(['ap1', 'ap2', 'bp1'])
  for (const r of rows) onSale(r.id)
}
const liveIds = () => rows.filter((r) => r.status === 'active').map((r) => r.id).sort()
const opts = { apply: true, skipShelfCaps: true, allowMass: true }

beforeEach(() => {
  h.stores = [shopA(), shopB()]
  sellers = [{ id: 'sa', name: 'Shop A', ownerId: null }, { id: 'sb', name: 'Shop B', ownerId: null }]
  writes = []; pages = {}; beforeRestore = null; reported = new Set(); poolStamps.clear()
  for (const k of Object.keys(hits)) delete hits[k]
  seed()
})

describe('runShowcase — one per category, across shops', () => {
  it('each shelf keeps its newest on sale (phones two); the rest go hidden INTO the pool; a row on no shelf keeps none', async () => {
    const r = await runShowcase(deps(), opts)
    expect(r.ok).toBe(true)
    expect(liveIds()).toEqual(['a2', 'a3', 'b1']) // phones: the two newest; laptops: b1, the newest across shops
    expect(['a1', 'a4', 'b2'].map((id) => R(id).status)).toEqual(['hidden', 'hidden', 'hidden']) // hidden, never sold
    expect([...poolTable].sort()).toEqual(['a1', 'a4', 'ap1', 'ap2', 'b2', 'bp1'])
    expect(r.totals).toMatchObject({ retire: 0, trim: 3, restore: 0 })
  })

  it('--keep puts a pinned row first (the clip’s two iPhones), while it is on sale', async () => {
    await runShowcase(deps(), { ...opts, keep: ['a1', 'a2'] })
    expect(liveIds()).toEqual(['a1', 'a2', 'b1'])
  })

  it('a sold keeper is retired and its shelf refilled from the pool — any shop, newest first, checked at its own shop', async () => {
    gone('b1'); gone('a4')
    const r = await runShowcase(deps(), opts)
    expect([R('b1').status, R('a4').status]).toEqual(['sold', 'sold'])
    expect(r.shelves.find((s) => s.shelf === 'electronics/laptops-pcs')).toMatchObject({ target: 1, liveAfter: 1, short: 0, restore: [{ id: 'ap1', store: 'a.example' }] })
    expect(liveIds()).toContain('ap1')
  })

  it('⛔ two reads must agree: a 404 then a live page is unknown — the row is never sold on it', async () => {
    pages[urlOf('b1')] = (k) => (k === 1 ? pageOf(urlOf('b1'), 404, '') : pageOf(urlOf('b1'), 200, ld('ThinkPad T460 cũ', 'InStock', 1000000)))
    const r = await runShowcase(deps(), opts)
    expect(R('b1').status).not.toBe('sold')
    expect(r.shops.find((s) => s.store === 'b.example')!.unknown[0]).toMatchObject({ id: 'b1', reason: expect.stringMatching(/^unconfirmed: http-404/) })
  })

  it('⛔ a row nobody can vouch for (a Cloudflare wall) is replaced by a verified one from the pool — hidden, never sold', async () => {
    blocked('b1'); blocked('a4')
    await runShowcase(deps(), opts)
    expect([R('b1').status, R('a4').status]).toEqual(['hidden', 'hidden'])
    expect(R('ap1').status).toBe('active')
    expect(rows.filter((r) => r.status === 'sold')).toEqual([])
  })

  it('…and keeps its slot when the pool has nothing verified to offer', async () => {
    blocked('b1'); blocked('a4'); gone('ap1'); gone('bp1')
    await runShowcase(deps(), opts)
    expect(['b1', 'a4'].map((id) => R(id).status).sort()).toEqual(['active', 'hidden'])
    expect(rows.filter((r) => ['b1', 'a4'].includes(r.id) && r.status === 'sold')).toEqual([])
  })

  it('a PASSING failure (a timeout) keeps the incumbent’s slot over a replacement — one bad night never churns a shelf', async () => {
    R('a4').status = 'hidden' // the steady state: one live laptop (b1)
    pages[urlOf('b1')] = { url: urlOf('b1'), status: 0, finalUrl: urlOf('b1'), html: '', error: 'The operation was aborted due to timeout' }
    const r = await runShowcase(deps(), opts)
    expect(R('b1').status).toBe('active')
    expect(r.shelves.find((s) => s.shelf === 'electronics/laptops-pcs')).toMatchObject({ keep: ['b1'], restore: [], trim: [] })
  })

  it('⚠️ a computer filed on another shelf never refills it (a laptop as the one example of a monitor)', async () => {
    R('b1').subcategory = 'tv-monitors'; R('b1').titleVi = 'Màn hình Dell 24 inch cũ'; onSale('b1')
    R('bp1').subcategory = 'tv-monitors'; R('bp1').titleVi = 'MSI 14 B11M0 | CORE I5 THẾ HỆ 11 | RAM 8GB'; onSale('bp1')
    gone('b1')
    const r = await runShowcase(deps(), opts)
    expect(r.shelves.find((s) => s.shelf === 'electronics/tv-monitors')).toMatchObject({ restore: [], short: 1, candidateSkips: { 'misfiled-computer': 1 } })
  })

  it('⛔ never past a shelf’s target: a laptop someone made live between the read and the write keeps the restore out', async () => {
    gone('b1'); gone('a4')
    beforeRestore = () => { R('bp1').status = 'active' }
    const r = await runShowcase(deps(), opts)
    expect(rows.filter((x) => x.status === 'active' && x.subcategory === 'laptops-pcs').map((x) => x.id)).toEqual(['bp1'])
    expect(r.shelves.find((s) => s.shelf === 'electronics/laptops-pcs')!.notes.join(' ')).toMatch(/restore skipped/)
  })

  it('a candidate wildly repriced or another item at its URL is passed over; an empty pool leaves the shelf short, said', async () => {
    gone('b1'); gone('a4')
    onSale('ap1', 9_000_000) // +800%
    onSale('bp1', 1_000_000, 'Samsung Galaxy S24 Ultra') // a different unit at the URL
    const r = await runShowcase(deps(), opts)
    const laptops = r.shelves.find((s) => s.shelf === 'electronics/laptops-pcs')!
    expect(laptops).toMatchObject({ liveAfter: 0, short: 1 })
    expect(laptops.candidateSkips).toMatchObject({ 'price-swing': 1, 'different-item': 1 })
  })

  it('a moved shop price is written on a keeper; a restore carries the shop’s CURRENT price', async () => {
    onSale('b1', 900_000)
    await runShowcase(deps(), opts)
    expect(R('b1').price).toBe(900_000)
    gone('b1')
    onSale('ap1', 1_100_000)
    await runShowcase(deps(), opts)
    expect(R('ap1')).toMatchObject({ status: 'active', price: 1_100_000 })
  })
})

describe('runShowcase — the guards', () => {
  it('a dry run writes nothing and journals what --apply would do', async () => {
    gone('b1')
    const d = deps()
    const r = await runShowcase(d, { apply: false, skipShelfCaps: true })
    expect(writes).toEqual([])
    expect(d.onTouched).not.toHaveBeenCalled()
    expect(r.apply).toBe(false)
    expect(r.journal.map((j) => `${j.action}:${j.listingId}`).sort()).toEqual(['retire:b1', 'trim:a1', 'trim:b2'])
  })

  it('⛔ more than half the live rows (and more than five) retired at once is refused (500 mass_retire) unless allowMass', async () => {
    for (const id of ['a1', 'a2', 'a3', 'a4', 'b1', 'b2']) gone(id)
    const r = await runShowcase(deps(), { apply: true, skipShelfCaps: true })
    expect(r).toMatchObject({ ok: false, apply: false, refused: expect.stringMatching(/^mass_retire: 6 of 6/) })
    expect(writes).toEqual([])
    // A small week stays under the floor: three of six retire without a flag.
    for (const id of ['a2', 'a3', 'b2']) onSale(id)
    const small = await runShowcase(deps(), { apply: true, skipShelfCaps: true })
    expect(small.refused).toBeUndefined()
  })

  it('every write reaches onJournal before it is made — the record survives a run that dies later', async () => {
    gone('b1')
    const seen: string[] = []
    await runShowcase({ ...deps(), onJournal: (e) => seen.push(`${e.action}:${e.listingId}:${R(e.listingId).status}`) }, opts)
    // Each entry was handed over while its row still had its old status: write-AHEAD.
    expect(seen.sort()).toEqual(['retire:b1:active', 'trim:a1:active', 'trim:b2:active']) // a4 still on sale keeps its shelf
  })

  it('an entry whose write did not land is in the record (a rollback skips it) but not in the answer’s journal', async () => {
    gone('b1'); gone('a4')
    beforeRestore = () => { R('bp1').status = 'active' } // the shelf fills between the read and the write
    const seen: string[] = []
    const r = await runShowcase({ ...deps(), onJournal: (e) => seen.push(`${e.action}:${e.listingId}`) }, opts)
    expect(seen).toContain('restore:ap1')
    expect(r.journal.map((j) => `${j.action}:${j.listingId}`)).not.toContain('restore:ap1')
  })

  it('⛔ a storefront a person claims while the run reads the shops is never written to — the restore checks it as it publishes', async () => {
    gone('b1'); gone('a4')
    beforeRestore = () => { sellers.find((x) => x.id === 'sa')!.ownerId = 'someone' }
    await runShowcase(deps(), opts)
    expect(R('ap1').status).toBe('hidden')
    expect(writes.filter((w) => /^UPDATE "Listing"/.test(w)).every((w) => w.includes('so."ownerId" IS NULL'))).toBe(true)
  })

  it('⛔ a one-shop run’s retirements are measured against that shop’s rows, not diluted by the shops it did not check', async () => {
    for (let i = 5; i <= 16; i++) rows.push(listing({ id: `a${i}`, sellerId: 'sa', subcategory: `s${i}` }))
    for (let i = 3; i <= 6; i++) rows.push(listing({ id: `b${i}`, sellerId: 'sb', subcategory: `t${i}` }))
    for (const id of ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']) gone(id)
    const r = await runShowcase(deps(), { apply: true, skipShelfCaps: true, stores: ['b.example'] })
    expect(r.refused).toMatch(/^mass_retire: 6 of 6 live rows checked/) // 6 of 22 overall would have passed
  })

  it('⛔ more than ten rows and half the live ones HIDDEN at once is refused too (a target-0 shelf has no keeper)', async () => {
    for (let i = 5; i <= 16; i++) { rows.push(listing({ id: `a${i}`, sellerId: 'sa', subcategory: null })); onSale(`a${i}`) }
    const r = await runShowcase(deps(), { apply: true, skipShelfCaps: true })
    expect(r).toMatchObject({ ok: false, apply: false, refused: expect.stringMatching(/^mass_trim: 15 of 18/) })
    expect(writes).toEqual([])
  })

  it('⛔ a shop whose storefront is ambiguous (two ownerless sellers by its name) stops the run — its rows cannot be placed', async () => {
    sellers.push({ id: 'sa2', name: 'Shop A', ownerId: null })
    const r = await runShowcase(deps(), opts)
    expect(r.refused).toMatch(/^ambiguous_storefront: a\.example/)
    expect(writes).toEqual([])
  })

  it('⛔ a whole shop read gone at once (a site change, more likely than sales) is HIDDEN, never sold', async () => {
    gone('b1'); gone('b2') // every row of Shop B 404s twice, and none of its pages reads on sale
    const r = await runShowcase(deps(), opts)
    expect([R('b1').status, R('b2').status]).toEqual(['hidden', 'hidden'])
    expect(r.shops.find((s) => s.store === 'b.example')!.held).toMatch(/hidden, not sold/)
    gone('a4') // one row of Shop A gone while others read on sale: an ordinary sale, retired
    await runShowcase(deps(), opts)
    expect(R('a4').status).toBe('sold')
  })

  it('⛔ a row taken out of the cap’s pool while the run reads the shops is not published', async () => {
    gone('b1'); gone('a4')
    beforeRestore = () => { poolTable.delete('ap1') }
    await runShowcase(deps(), opts)
    expect(R('ap1').status).toBe('hidden')
  })

  it('⛔ a shop not checked this run holds its rows: its shelves are retired from only — no trim, no refill on top', async () => {
    gone('b1')
    const r = await runShowcase(deps(), { ...opts, stores: ['b.example'] })
    expect(R('b1').status).toBe('sold')
    expect(['a1', 'a2', 'a3', 'a4'].map((id) => R(id).status)).toEqual(['active', 'active', 'active', 'active'])
    expect(r.shelves.find((s) => s.shelf === 'electronics/laptops-pcs')).toMatchObject({ restore: [], trim: [] })
  })

  it('an emptied shelf of the curation is refilled from the pool (planned even with no live row)', async () => {
    R('b1').status = 'sold'; R('a4').status = 'sold'
    const r = await runShowcase(deps(), opts)
    expect(r.shelves.find((s) => s.shelf === 'electronics/laptops-pcs')).toMatchObject({ live: 0, liveAfter: 1, restore: [{ id: 'ap1' }] })
  })

  it('⚠️ a second-hand shelf shows second-hand goods: a row not labelled used yields to a used one from the pool', async () => {
    R('b1').condition = null; R('a4').condition = null
    await runShowcase(deps(), opts)
    expect(R('ap1').status).toBe('active')
    expect([R('b1').status, R('a4').status]).toEqual(['hidden', 'hidden'])
  })

  it('a stated retirement (--retire id=reason) is journaled with its reason; an id not live is reported', async () => {
    const r = await runShowcase(deps(), { ...opts, retire: [{ id: 'b1', reason: 'owner: gone' }, { id: 'zz', reason: 'x' }] })
    expect(R('b1').status).toBe('sold')
    expect(r.journal.find((j) => j.listingId === 'b1')).toMatchObject({ action: 'retire', reason: 'stated: owner: gone' })
    expect(r.unmatchedRetire).toEqual(['zz'])
  })

  it('⛔ an owned storefront of the same name is never read, so none of its rows is touched', async () => {
    sellers = [{ id: 'sa', name: 'Shop A', ownerId: 'someone' }, { id: 'sb', name: 'Shop B', ownerId: null }]
    const r = await runShowcase(deps(), opts)
    expect(r.shops.find((s) => s.store === 'a.example')!.skipped).toBe('no_storefront')
    expect(['a1', 'a2', 'a3', 'a4'].map((id) => R(id).status)).toEqual(['active', 'active', 'active', 'active'])
  })

  it('⛔ a rule-dependent retirement (a different item at the URL) waits for proof a page of that shop reads right', async () => {
    h.stores = [shopB()]
    sellers = [{ id: 'sb', name: 'Shop B', ownerId: null }]
    rows.push(listing({ id: 'b3', sellerId: 'sb', subcategory: 'phones-tablets', titleVi: 'Sony Xperia 1 IV cũ' }))
    onSale('b1', 1_000_000, 'Canon EOS R5 Mark II') // another item at the URL…
    blocked('b2'); blocked('b3'); gone('bp1') // …and no page of Shop B reads as its own item
    pages['https://b.example/sitemap.xml'] = pageOf('https://b.example/sitemap.xml', 200, '<loc>https://b.example/p/new1</loc>')
    pages['https://b.example/p/new1'] = pageOf('https://b.example/p/new1', 200, ld('Something cũ', 'InStock', 1)) // a canary reads right…
    const r = await runShowcase(deps(), opts)
    expect(R('b1').status).toBe('active') // …which proves the page structure, not the shop's names: held
    expect(r.shops[0].held).toMatch(/held/)
    onSale('b3') // a page of the same shop reads as ITS OWN item: the names parse, the other item at b1's URL is real
    await runShowcase(deps(), opts)
    expect(R('b1').status).toBe('sold')
  })

  it('⛔ that proof is the LIVE rows’ alone — a pool page read for an earlier shelf never decides a retirement', async () => {
    rows.push(listing({ id: 'ac', sellerId: 'sa', subcategory: 'cameras', titleVi: 'Canon EOS 80D cũ' }))
    rows.push(listing({ id: 'bpc', sellerId: 'sb', status: 'hidden', subcategory: 'cameras', titleVi: 'Sony A7 III cũ' }))
    poolTable.add('bpc'); onSale('ac'); onSale('bpc')
    gone('ac') // the cameras shelf (sorted before laptops) empties: its walk reads Shop B's bpc as its own item…
    onSale('b1', 1_000_000, 'Canon EOS R5 Mark II'); blocked('b2') // …while no LIVE page of Shop B reads as its own item
    const r = await runShowcase(deps(), opts)
    expect(R('bpc').status).toBe('active')
    expect(R('b1').status).toBe('hidden') // trimmed behind a4 (on sale), never sold
    expect(r.shops.find((s) => s.store === 'b.example')!.unknown).toContainEqual({ id: 'b1', reason: 'held: different-item' })
  })

  it('⛔ a report filed while the run reads the shops keeps the restore out — the publishing statement re-checks it', async () => {
    gone('b1'); gone('a4')
    beforeRestore = () => { reported.add('ap1') }
    const r = await runShowcase(deps(), opts)
    expect(R('ap1').status).toBe('hidden')
    expect(r.shelves.find((s) => s.shelf === 'electronics/laptops-pcs')!.notes.join(' ')).toMatch(/restore skipped/) // short this week
    const restore = writes.find((w) => w.includes(`SET status = 'active'`))!
    for (const c of ['verified', `"complianceStatus" = 'clear'`, `"verificationNotes" IS NULL`, `NOT "identityHold"`, `condition = 'used'`]) expect(restore).toContain(c)
  })

  it('⛔ ?store= naming no live shop is refused, writing nothing; a one-shop run leaves the capped shelves alone', async () => {
    const r = await runShowcase(deps(), { apply: true, stores: ['a.exmaple'] })
    expect(r).toMatchObject({ ok: false, apply: false, refused: expect.stringMatching(/^unknown_store: a\.exmaple/) })
    expect(writes).toEqual([])
    sellers.push({ id: 'it', name: 'iTel', ownerId: null })
    for (const [i, id] of ['e1', 'e2', 'e3'].entries()) rows.push(listing({ id, sellerId: 'it', category: 'services', subcategory: 'esim', created: `2026-10-0${i + 1} 00:00:00`, listingType: 'service' }))
    const one = await runShowcase(deps(), { apply: true, allowMass: true, stores: ['a.example'] })
    expect(one.caps).toEqual([])
    expect(R('e3').status).toBe('active')
  })

  it('⛔ a journal that stops taking writes stops the writes — none lands unrecorded, the first included', async () => {
    const r = await runShowcase({ ...deps(), onJournal: () => { throw new Error('ENOSPC: no space left on device') } }, opts)
    expect(writes).toEqual([])
    expect(r.ok).toBe(false)
    expect(r.writeErrors.join(' ')).toMatch(/journal: ENOSPC.*no further writes/)
    expect(r.journal).toEqual([])
  })

  it('PDPs are revalidated as each shelf lands, not once at the end', async () => {
    const d = deps()
    await runShowcase(d, opts)
    const calls = d.onTouched.mock.calls.map((c) => [...(c as unknown as [string[]])[0]].sort())
    expect(calls.length).toBeGreaterThan(1)
    expect(calls.flat().sort()).toEqual(['a1', 'a4', 'b2'])
  })

  it('⛔ a new-goods storefront is never this job’s: its rows are not read, so none is trimmed', async () => {
    h.stores = [shopA({ condition: 'new' }), shopB()]
    const r = await runShowcase(deps(), opts)
    expect(r.shops.map((s) => s.store)).toEqual(['b.example'])
    expect(['a1', 'a2', 'a3', 'a4'].map((id) => R(id).status)).toEqual(['active', 'active', 'active', 'active'])
  })

})

describe('runShowcase — the feed shops', () => {
  const feedOf = (inStock: Record<string, boolean>, complete = true): FeedFacts => ({
    complete,
    byId: new Map(Object.entries(inStock).map(([id, s]) => [id, { inStock: s, price: 1000000, name: R(id).titleVi! }])),
    seen: new Set(Object.keys(inStock)),
  })
  const wooA = () => shopA({ adapter: 'woocommerce', endpoint: 'https://a.example/wp-json/wc/store/v1/products?per_page=100&page={page}' })
  it('out of stock in the feed → retired; absent from the feed and the API 404s → retired', async () => {
    h.stores = [wooA()]
    sellers = [{ id: 'sa', name: 'Shop A', ownerId: null }]
    const r = await runShowcase(deps(feedOf({ a1: true, a2: false, a4: false, ap1: false })), opts)
    expect(R('a4').status).toBe('sold')
    expect(R('a3').status).toBe('sold') // absent → the API 404
    expect(r.shelves.find((s) => s.shelf === 'electronics/laptops-pcs')).toMatchObject({ retire: [{ id: 'a4', reason: 'feed-out-of-stock' }], liveAfter: 0, short: 1 })
  })
  it('⛔ an incomplete feed retires nothing on ABSENCE (what a successful chunk said about a row still counts)', async () => {
    h.stores = [shopA({ adapter: 'woocommerce', endpoint: 'x' })]
    sellers = [{ id: 'sa', name: 'Shop A', ownerId: null }]
    await runShowcase(deps(feedOf({ a1: true }, false)), opts)
    expect(rows.filter((r) => r.status === 'sold')).toEqual([])
  })
})

describe('runShowcase — the capped shelves (eSIM, car rentals): trim the newest extras, never top up', () => {
  it('a provider past two loses its newest; within the cap nothing moves', async () => {
    sellers.push({ id: 'it', name: 'iTel', ownerId: null }, { id: 'vt', name: 'Viettel', ownerId: null })
    for (const [i, id] of ['e1', 'e2', 'e3'].entries()) rows.push(listing({ id, sellerId: 'it', category: 'services', subcategory: 'esim', created: `2026-10-0${i + 1} 00:00:00`, listingType: 'service' }))
    rows.push(listing({ id: 'e4', sellerId: 'vt', category: 'services', subcategory: 'esim', created: '2026-10-04 00:00:00', listingType: 'service' }))
    h.stores = []
    const r = await runShowcase(deps(), { apply: true, allowMass: true })
    expect(rows.filter((x) => x.subcategory === 'esim' && x.status === 'active').map((x) => x.id)).toEqual(['e1', 'e2', 'e4'])
    expect(r.caps.find((c) => c.shelf === 'esim')).toMatchObject({ live: 4, trim: [{ id: 'e3', seller: 'iTel' }] })
    expect(r.caps.find((c) => c.shelf === 'car-rental')!.trim).toEqual([])
  })
})

describe('fetchPageHonest — the shop’s own hosts only', () => {
  it('⛔ never fetches an address off the shop, and stops at a redirect that leaves it — for another shop too', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(String(u))
      if (String(u).endsWith('/p/moved')) return new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
      if (String(u).endsWith('/p/hop')) return new Response(null, { status: 302, headers: { location: '/p/here' } })
      if (String(u).endsWith('/p/elsewhere')) return new Response(null, { status: 301, headers: { location: 'https://a.example/p/7' } })
      return new Response('<html>ok</html>', { status: 200 })
    }))
    try {
      expect(shopAddress('https://a.example/p/1', 'a.example')).toBe(true)
      expect(shopAddress('https://m.b.example/p/1', 'b.example')).toBe(true)
      for (const bad of ['https://b.example/p/1', 'http://127.0.0.1:3001/api/cron/x', 'http://169.254.169.254/', 'https://a.example.evil.com/', 'https://user:pw@a.example/', 'https://a.example:8443/', 'file:///etc/passwd', 'not a url']) {
        expect(shopAddress(bad, 'a.example'), bad).toBe(false)
      }
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
      expect(await fetchPageHonest('http://127.0.0.1:3001/x', 'a.example', sleep)).toMatchObject({ status: 0, error: 'off-site address' })
      expect(calls).toEqual([]) // never fetched
      expect(await fetchPageHonest('https://a.example/p/moved', 'a.example', sleep)).toMatchObject({ status: 0, error: 'off-site address', finalUrl: 'http://169.254.169.254/latest/meta-data/' })
      expect(calls).toEqual(['https://a.example/p/moved']) // the redirect's target never fetched
      // Another SHOP is off-site too: its page would vouch for this shop's listing.
      expect(await fetchPageHonest('https://b.example/p/elsewhere', 'b.example', sleep)).toMatchObject({ error: 'off-site address', finalUrl: 'https://a.example/p/7' })
      expect(await fetchPageHonest('https://b.example/p/hop', 'b.example', sleep)).toMatchObject({ status: 200, finalUrl: 'https://b.example/p/here', html: '<html>ok</html>' })
    } finally { vi.unstubAllGlobals() }
  }, 15_000)
})

describe('runShowcase — what the answer and the rows say', () => {
  it('⛔ a pool that cannot be read FAILS the run (a dropped table would drain every shelf, week after week)', async () => {
    const real = fakeDb.$queryRawUnsafe
    fakeDb.$queryRawUnsafe = (async (sql: string, ...v: unknown[]) => {
      if (sql.includes('_hide_secondhand_20261016')) throw new Error('relation "_hide_secondhand_20261016" does not exist')
      return real(sql, ...v)
    }) as typeof real
    try {
      gone('b1')
      const r = await runShowcase(deps(), opts)
      expect(r.ok).toBe(false)
      expect(R('b1').status).toBe('sold') // the retirements still land
      expect(r.shops.some((x) => x.poolError)).toBe(true)
    } finally { fakeDb.$queryRawUnsafe = real }
  })

  it('the stamp is taken as the writing starts — never dated back to the run’s start, minutes earlier', async () => {
    let t = Date.parse('2026-10-19T00:00:00Z')
    const d = { ...deps(), now: () => new Date((t += 60_000)) } // a minute passes at every look at the clock
    gone('b1')
    const r = await runShowcase(d, opts)
    expect(r.stamp > '2026-10-19 00:01:00.000').toBe(true)
    expect(R('b1').upd).toBe(r.stamp)
  })

  it('a shelf’s result names what LANDED when a write throws mid-shelf', async () => {
    const real = fakeDb.$executeRawUnsafe
    let n = 0
    fakeDb.$executeRawUnsafe = (async (sql: string, ...v: unknown[]) => {
      // Hides in shelf order: electronics/- (b2), then the phone shelf's two — the second of those throws.
      if (sql.includes(`SET status = 'hidden'`) && ++n === 3) throw new Error('connection lost')
      return real(sql, ...v)
    }) as typeof real
    try {
      R('b1').subcategory = 'phones-tablets' // the phone shelf now has a1 a2 a3 b1: two trims there
      const r = await runShowcase(deps(), opts)
      const phones = r.shelves.find((x) => x.shelf === 'electronics/phones-tablets')!
      expect(phones.trim.length).toBe(1) // the first trim landed and is reported; the second threw
      expect(r.writeErrors.join(' ')).toMatch(/connection lost/)
    } finally { fakeDb.$executeRawUnsafe = real }
  })
})

describe('fetchFeedFacts — a WooCommerce variable product', () => {
  it('⛔ a price RANGE writes no price (its `price` is the cheapest variation); one price is written', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { id: 11, name: 'Ghế A', is_in_stock: true, prices: { price: '900000', currency_minor_unit: 0, price_range: { min_amount: '900000', max_amount: '1500000' } } },
      { id: 12, name: 'Ghế B', is_in_stock: true, prices: { price: '700000', currency_minor_unit: 0, price_range: null } },
      { id: 13, name: 'Ghế C', is_in_stock: true, prices: { price: '500000', currency_minor_unit: 0, price_range: {} } },
    ]), { status: 200 })))
    try {
      const cfg = shopA({ adapter: 'woocommerce', endpoint: 'https://a.example/wp-json/wc/store/v1/products?per_page=100&page={page}' })
      const f = await fetchFeedFacts(cfg, ['11', '12', '13'], async () => {})
      expect(f.byId.get('11')).toMatchObject({ inStock: true, price: undefined })
      expect(f.byId.get('12')).toMatchObject({ inStock: true, price: 700000 })
      expect(f.byId.get('13')).toMatchObject({ inStock: true, price: undefined }) // an empty range proves nothing
    } finally { vi.unstubAllGlobals() }
  }, 15_000)
})

describe('runShowcase — a product on sale at several prices', () => {
  it('⛔ is kept on sale but never repriced, never restored without a price, never retired — and said', async () => {
    h.stores = [shopA({ adapter: 'woocommerce', endpoint: 'https://a.example/wp-json/wc/store/v1/products?per_page=100&page={page}' })]
    sellers = [{ id: 'sa', name: 'Shop A', ownerId: null }]
    const feed: FeedFacts = {
      complete: true,
      seen: new Set(['a1', 'a2', 'a3', 'a4', 'ap1', 'ap2']),
      byId: new Map(['a1', 'a2', 'a3', 'a4', 'ap1', 'ap2'].map((id) => [id, { inStock: true, price: undefined, name: R(id).titleVi! }])),
    }
    R('a4').status = 'sold' // the laptop shelf asks its pool: ap1 is on sale, priced by nothing
    const r = await runShowcase(deps(feed), opts)
    expect(R('a2')).toMatchObject({ status: 'active', price: 1000000 })
    expect(R('ap1').status).toBe('hidden')
    expect(rows.filter((x) => x.status === 'sold').map((x) => x.id)).toEqual(['a4'])
    expect(r.shops[0].priceRefused.map((x) => x.why)).toContain('on sale, but no one price read at the shop — none written')
  })

  it('a trim writes hidden_at from the run’s own stamp — one clock for the pool’s provenance test', async () => {
    const r = await runShowcase(deps(), opts)
    expect(poolStamps.get('a1')).toBe(r.stamp)
    expect(R('a1').upd).toBe(r.stamp)
  })
})
