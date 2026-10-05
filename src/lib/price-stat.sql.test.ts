import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: { $queryRaw: vi.fn() } }))

import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { FALLBACK_BRAND_KEY, FALLBACK_MIN_SELLERS, fallbackBandKey } from './price-fallback'
import { percentileCont } from './price-guidance'
import { PRICE_STAT_MIN_SAMPLE, SEGMENT_SQL, fallbackStatsUpsertSql, getPriceBand, listingSegment } from './price-stat'

/**
 * ⛔ THE SQL TWINS, EXECUTED. SEGMENT_SQL and the fallback upsert run in a real Postgres (PGlite — Postgres
 * 17 compiled to WASM, in-process: no server, no port; production is 17.6) against fixture rows, and every
 * key they write is compared with what the READER computes for the same row (listingSegment(),
 * fallbackBandKey()). Until 2026-10-05 nothing in CI executed SEGMENT_SQL at all — the cron's comment said
 * so — and a band whose write key and read key disagree does not error: it silently never renders.
 *
 * The percentiles are checked against percentileCont() (price-guidance.ts), the JS twin of
 * percentile_cont. Fixture prices are multiples of 4,000 so every interpolated quartile is a whole đồng
 * and Postgres's round() on a double (ties to even) cannot differ from Math.round.
 *
 * ⚠️ PGlite is not a declared dependency — it arrives with Prisma's dev tooling (prisma → @prisma/dev), so
 * every `npm ci` installs it. Locally a missing PGlite SKIPS this suite (the describe title says so); in
 * CI (GitHub sets CI=true) it FAILS instead — a parity check that can quietly stop running is the
 * silent gap this file exists to close (Opus, diff review).
 */

type Pg = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
  exec: (sql: string) => Promise<unknown>
  close: () => Promise<void>
}

const pgliteModule = await (async (): Promise<{ PGlite: { create: () => Promise<Pg> } } | null> => {
  const specifier = '@electric-sql/pglite'
  try {
    return (await import(/* @vite-ignore */ specifier)) as { PGlite: { create: () => Promise<Pg> } }
  } catch {
    return null
  }
})()

type Fixture = {
  id: string
  category: string
  sub: string | null
  condition?: string | null
  price: number
  seller: string
  attributes?: string | null
  brandSlug?: string | null
  model?: string | null
  year?: number | null
  status?: string
  verified?: boolean
  listingType?: string
  currency?: string
}

const CATEGORIES = [
  'furniture-appliances', 'fashion-beauty', 'electronics', 'vehicles',
  'rentals', 'jobs', 'services', 'teachers', 'property', 'tickets-travel',
]

const wood = JSON.stringify({ condition: 'used', material: 'wood' })
let seq = 0
const row = (over: Partial<Fixture> & Pick<Fixture, 'category' | 'sub' | 'price' | 'seller'>): Fixture => ({ id: `L${++seq}`, condition: 'used', ...over })

const FIXTURES: Fixture[] = [
  // A — used wooden beds from three sellers: a band. One is branded (still a comparable), one carries a
  // tab in its subcategory and spaces round its condition (the trim parity), one carries extra keys.
  row({ category: 'furniture-appliances', sub: 'beds-mattresses', price: 1_904_000, seller: 's1', attributes: wood }),
  row({ category: 'furniture-appliances', sub: 'beds-mattresses', price: 2_004_000, seller: 's1', attributes: wood, brandSlug: 'ikea', model: 'Hemnes' }),
  row({ category: 'furniture-appliances', sub: '\tbeds-mattresses', condition: ' used ', price: 2_200_000, seller: 's2', attributes: wood }),
  row({ category: 'furniture-appliances', sub: 'beds-mattresses', price: 2_504_000, seller: 's2', attributes: JSON.stringify({ material: 'wood', size: 'x' }) }),
  row({ category: 'furniture-appliances', sub: 'beds-mattresses', price: 2_800_000, seller: 's3', attributes: wood }),
  row({ category: 'furniture-appliances', sub: 'beds-mattresses', price: 3_000_000, seller: 's3', attributes: wood }),
  // …and the same beds, NEW: another condition class, under the floor — no band, and no mixing into A.
  row({ category: 'furniture-appliances', sub: 'beds-mattresses', condition: 'new', price: 9_000_000, seller: 's1', attributes: wood }),
  // B — metal beds: four listings, under the floor.
  ...['s1', 's2', 's3', 's4'].map((seller, i) => row({ category: 'furniture-appliances', sub: 'beds-mattresses', price: 1_000_000 + i * 4_000, seller, attributes: '{"material":"metal"}' })),
  // C — fabric beds: six listings, ONE seller — a catalogue, not a market.
  ...[0, 1, 2, 3, 4, 5].map((i) => row({ category: 'furniture-appliances', sub: 'beds-mattresses', price: 1_500_000 + i * 4_000, seller: 's4', attributes: '{"material":"fabric"}' })),
  // D — beds with NO material, plenty of them: a facet shelf never gets a shelf-alone row.
  ...['s1', 's2', 's3', 's4', 's5', 's6'].map((seller, i) => row({ category: 'furniture-appliances', sub: 'beds-mattresses', price: 1_200_000 + i * 4_000, seller, attributes: null })),
  // E — an importer's free-typed material: not a taxonomy value, no key.
  ...['s1', 's2', 's3', 's1', 's2'].map((seller, i) => row({ category: 'furniture-appliances', sub: 'beds-mattresses', price: 800_000 + i * 4_000, seller, attributes: '{"material":"Gỗ sồi"}' })),
  // F — used womenswear, a shelf-alone shelf: a band from three sellers…
  ...['s5', 's6', 's7', 's5', 's6'].map((seller, i) => row({ category: 'fashion-beauty', sub: 'womens', price: 100_000 + i * 20_000, seller })),
  // …that rows which are NOT live sale listings in đồng must not join.
  row({ category: 'fashion-beauty', sub: 'womens', price: 9_000_000, seller: 's8', listingType: 'rent' }),
  row({ category: 'fashion-beauty', sub: 'womens', price: 9_000_000, seller: 's8', verified: false }),
  row({ category: 'fashion-beauty', sub: 'womens', price: 9_000_000, seller: 's8', status: 'sold' }),
  row({ category: 'fashion-beauty', sub: 'womens', price: 9_000_000, seller: 's8', currency: '$' }),
  row({ category: 'fashion-beauty', sub: 'womens', price: 0, seller: 's8' }),
  row({ category: 'fashion-beauty', sub: '   ', price: 9_000_000, seller: 's8' }),
  // G — new womenswear: its own condition class, its own band.
  ...['s5', 's6', 's7', 's8', 's9'].map((seller, i) => row({ category: 'fashion-beauty', sub: 'womens', condition: 'new', price: 200_000 + i * 40_000, seller })),
  // H — a facet shelf in electronics.
  ...['s1', 's2', 's3', 's4', 's5'].map((seller, i) => row({ category: 'electronics', sub: 'tv-monitors', price: 5_000_000 + i * 400_000, seller, attributes: '{"screenSize":"55"}' })),
  // I — shelves with no fallback, each with enough rows to form one if the map were wrong.
  ...['s1', 's2', 's3', 's4', 's5', 's6'].flatMap((seller, i) => [
    row({ category: 'furniture-appliances', sub: 'white-goods', price: 1_000_000 + i * 4_000, seller }),
    row({ category: 'electronics', sub: 'phones-tablets', price: 8_000_000 + i * 4_000, seller, attributes: '{"storage":"128"}' }),
    row({ category: 'rentals', sub: 'apartment-rental', price: 9_000_000 + i * 4_000, seller }),
    row({ category: 'jobs', sub: 'teaching', price: 20_000_000 + i * 4_000, seller }),
    row({ category: 'services', sub: 'cleaning', price: 300_000 + i * 4_000, seller }),
    row({ category: 'teachers', sub: 'english', price: 400_000 + i * 4_000, seller }),
    row({ category: 'property', sub: 'apartment', price: 3_000_000_000 + i * 4_000, seller }),
    row({ category: 'tickets-travel', sub: 'event-tickets', price: 500_000 + i * 4_000, seller }),
  ]),
]

/** Extra rows for the SEGMENT_SQL parity check only: years, empty conditions, whitespace. */
const SEGMENT_ONLY: Fixture[] = [
  ...[2014, 2015, 2019, 2020, null].map((year) => row({ category: 'vehicles', sub: 'motorbike', price: 10_000_000, seller: 's1', year })),
  ...[null, '', '  ', ' new ', '\tused\n'].map((condition) => row({ category: 'electronics', sub: ' phone-cases ', price: 100_000, seller: 's1', condition })),
]

/** The TS twin of SALE_ELIGIBLE_SQL — what the reader's side believes a comparable is. */
function eligible(f: Fixture): boolean {
  return (f.status ?? 'active') === 'active' && (f.verified ?? true) && (f.listingType ?? 'sell') === 'sell'
    && (f.currency ?? '₫') === '₫' && f.price > 0 && segmentOf(f) !== null
}
const segmentOf = (f: Fixture) => listingSegment({ categorySlug: f.category, subcategorySlug: f.sub, condition: f.condition ?? null, year: f.year ?? null })
const keyOf = (f: Fixture) => fallbackBandKey({ categorySlug: f.category, subcategorySlug: f.sub, attributes: f.attributes ?? null })

type StatRow = { brandSlug: string; model: string; segment: string; n: number; p25: number; median: number; p75: number }

/** What the fallback upsert MUST write, computed entirely from the reader's own functions. */
function expectedFallback(scope: { in?: string[]; notIn?: string[] } = {}): StatRow[] {
  const groups = new Map<string, Fixture[]>()
  for (const f of FIXTURES) {
    if (!eligible(f)) continue
    if (scope.in && !scope.in.includes(f.seller)) continue
    if (scope.notIn?.includes(f.seller)) continue
    const key = keyOf(f)
    if (!key) continue
    const g = `${segmentOf(f)}\u0000${key}`
    groups.set(g, [...(groups.get(g) ?? []), f])
  }
  const out: StatRow[] = []
  for (const [g, rows] of groups) {
    if (rows.length < PRICE_STAT_MIN_SAMPLE || new Set(rows.map((r) => r.seller)).size < FALLBACK_MIN_SELLERS) continue
    const [segment, model] = g.split('\u0000')
    const sorted = rows.map((r) => r.price).sort((a, b) => a - b)
    out.push({
      brandSlug: FALLBACK_BRAND_KEY, model, segment, n: rows.length,
      p25: Math.round(percentileCont(sorted, 0.25)), median: Math.round(percentileCont(sorted, 0.5)), p75: Math.round(percentileCont(sorted, 0.75)),
    })
  }
  return out.sort((a, b) => `${a.segment}${a.model}`.localeCompare(`${b.segment}${b.model}`))
}

// In CI the SQL MUST execute: a skipped parity suite reads as a green one.
describe.runIf(!pgliteModule && !!process.env.CI)('price-stat SQL parity in CI', () => {
  it('needs @electric-sql/pglite (installed with prisma\'s dev tooling) — it is missing from this install', () => {
    expect.fail('PGlite is missing, so SEGMENT_SQL and the fallback upsert were not executed. Restore it (npm ci) or declare it as a devDependency.')
  })
})

describe.skipIf(!pgliteModule)(`price-stat SQL, executed in Postgres${pgliteModule ? '' : ' (SKIPPED: @electric-sql/pglite is not installed)'}`, () => {
  let pg: Pg

  /** One multi-row INSERT — a statement per row cost seconds in WASM Postgres. */
  const insert = async (rows: Fixture[]) => {
    const values: unknown[] = []
    const tuples = rows.map((f) => {
      const cols = [f.id, `c-${f.category}`, f.sub, f.status ?? 'active', f.verified ?? true, f.listingType ?? 'sell', f.currency ?? '₫', f.price,
        f.condition ?? null, f.year ?? null, f.attributes ?? null, f.brandSlug ?? null, f.model ?? null, f.seller]
      const at = values.length
      values.push(...cols)
      return `(${cols.map((_, i) => `$${at + i + 1}`).join(',')})`
    })
    await pg.query(
      `INSERT INTO "Listing" (id, "categoryId", "subcategorySlug", status, verified, "listingType", currency, price, condition, year, attributes, "brandSlug", model, "sellerId")
       VALUES ${tuples.join(',')}`,
      values,
    )
  }
  const run = (sql: Prisma.Sql) => pg.query(sql.text, sql.values as unknown[])
  const written = async (): Promise<StatRow[]> =>
    (await pg.query(`SELECT "brandSlug", model, segment, n, p25, median, p75 FROM "PriceStat" ORDER BY segment || model`)).rows as StatRow[]

  beforeAll(async () => {
    pg = await pgliteModule!.PGlite.create()
    // The columns the statements read, and PriceStat exactly as scripts/image-hash-index.mjs creates it.
    await pg.exec(`
      CREATE TABLE "Category" (id text PRIMARY KEY, slug text NOT NULL);
      CREATE TABLE "Listing" (
        id text PRIMARY KEY, "categoryId" text NOT NULL REFERENCES "Category"(id), "subcategorySlug" text,
        status text NOT NULL, verified boolean NOT NULL, "listingType" text NOT NULL, currency text NOT NULL,
        price double precision NOT NULL, condition text, year integer, attributes text,
        "brandSlug" text, model text, "sellerId" text NOT NULL
      );
      CREATE TABLE "PriceStat" (
        "brandSlug" TEXT NOT NULL, model TEXT NOT NULL, segment TEXT NOT NULL,
        n INT NOT NULL, p25 INT NOT NULL, median INT NOT NULL, p75 INT NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY ("brandSlug", model, segment)
      );
    `)
    for (const slug of CATEGORIES) await pg.query(`INSERT INTO "Category" (id, slug) VALUES ($1, $2)`, [`c-${slug}`, slug])
    await insert([...FIXTURES, ...SEGMENT_ONLY])
  }, 120_000)

  afterAll(async () => {
    await pg?.close()
  })

  beforeEach(async () => {
    await pg.query(`DELETE FROM "PriceStat"`)
    // The reader runs its real statement against this database.
    vi.mocked(db.$queryRaw).mockImplementation((async (sql: Prisma.Sql) => (await run(sql)).rows) as never)
  })

  it('SEGMENT_SQL produces listingSegment() for every row with a shelf — years, empty conditions, whitespace', async () => {
    const { rows } = await run(Prisma.sql`SELECT l.id, ${SEGMENT_SQL} AS segment FROM "Listing" l JOIN "Category" c ON c.id = l."categoryId"`)
    const byId = new Map(rows.map((r) => [r.id as string, r.segment as string | null]))
    let compared = 0
    for (const f of [...FIXTURES, ...SEGMENT_ONLY]) {
      const ts = segmentOf(f)
      if (ts === null) continue // no shelf → the eligibility predicate keeps the row out of every band
      expect(byId.get(f.id), `${f.id} ${JSON.stringify(f.sub)} ${JSON.stringify(f.condition)} ${f.year}`).toBe(ts)
      compared++
    }
    expect(compared).toBeGreaterThan(80)
    expect(byId.get(SEGMENT_ONLY[1].id)).toBe('vehicles/motorbike|used:2014') // 2015 → the 2014–2015 band
    expect(byId.get(SEGMENT_ONLY[7].id)).toBe('electronics/phone-cases|any') // '  ' condition → any
  })

  it('writes exactly the fallback rows the reader\'s own key functions predict, with percentile_cont quartiles', async () => {
    await run(fallbackStatsUpsertSql({}))
    const want = expectedFallback()
    expect(await written()).toEqual(want)
    // The fixture was built to produce these four, and nothing else.
    expect(want.map((r) => `${r.segment} ${r.model}`)).toEqual([
      'electronics/tv-monitors|used screenSize=55',
      'fashion-beauty/womens|new *',
      'fashion-beauty/womens|used *',
      'furniture-appliances/beds-mattresses|used material=wood',
    ])
    expect(want.find((r) => r.model === 'material=wood')).toMatchObject({ n: 6, p25: 2_053_000, median: 2_352_000, p75: 2_726_000 })
  })

  it('⛔ writes nothing for a never-category, a catch-all shelf, a facet shelf without the facet, a single seller or a free-typed value', async () => {
    await run(fallbackStatsUpsertSql({}))
    const rows = await written()
    for (const r of rows) {
      expect(r.segment).not.toMatch(/^(rentals|jobs|services|teachers|property|tickets-travel)\//)
      expect(r.segment).not.toMatch(/white-goods|phones-tablets/)
      if (r.segment.startsWith('furniture-appliances/beds-mattresses')) expect(r.model).toBe('material=wood')
    }
  })

  it('applies the edition scope: a seller outside it is not a comparable', async () => {
    // s7 is one of womenswear's three sellers; without it the used band has two sellers and four rows.
    await run(fallbackStatsUpsertSql({ sellerId: { notIn: ['s7'] } }))
    expect(await written()).toEqual(expectedFallback({ notIn: ['s7'] }))
    expect((await written()).some((r) => r.segment === 'fashion-beauty/womens|used')).toBe(false)

    await pg.query(`DELETE FROM "PriceStat"`)
    await run(fallbackStatsUpsertSql({ sellerId: { in: ['s1', 's2', 's3'], notIn: [] } }))
    expect((await written()).map((r) => r.model)).toEqual(['material=wood'])

    await pg.query(`DELETE FROM "PriceStat"`)
    await run(fallbackStatsUpsertSql({ sellerId: { in: [] } }))
    expect(await written()).toEqual([])
  })

  it('⛔ refuses a scope shape it cannot translate instead of building bands without it', () => {
    expect(() => fallbackStatsUpsertSql({ categoryId: { not: 'x' } } as never)).toThrow(/does not translate/)
    expect(() => fallbackStatsUpsertSql({ sellerId: { notIn: [], equals: 'x' } } as never)).toThrow(/sellerId\.equals/)
  })

  it('is an upsert: a second run rewrites the same rows', async () => {
    await run(fallbackStatsUpsertSql({}))
    await run(fallbackStatsUpsertSql({}))
    expect(await written()).toEqual(expectedFallback())
  })

  it('the reader finds what the cron wrote — the write key and the read key are one key', async () => {
    await run(fallbackStatsUpsertSql({}))
    const bed = FIXTURES[2] // the tab-and-spaces row: the reader trims exactly as the SQL did
    expect(await getPriceBand({
      brandSlug: null, model: null, categorySlug: bed.category, subcategorySlug: bed.sub, listingType: 'sell',
      condition: bed.condition ?? null, year: null, attributes: bed.attributes,
    })).toEqual({ n: 6, p25: 2_053_000, median: 2_352_000, p75: 2_726_000, basis: 'similar' })

    // The branded bed has no brand+model band, so it gets the same fallback.
    const branded = FIXTURES[1]
    expect((await getPriceBand({
      brandSlug: 'ikea', model: 'Hemnes', categorySlug: branded.category, subcategorySlug: branded.sub, listingType: 'sell',
      condition: 'used', year: null, attributes: branded.attributes,
    }))?.basis).toBe('similar')

    // Womenswear, by the shelf alone.
    expect((await getPriceBand({
      brandSlug: null, model: null, categorySlug: 'fashion-beauty', subcategorySlug: 'womens', listingType: 'sell', condition: 'used', year: null,
    }))?.basis).toBe('similar')

    // A bed with no material: rows exist on its shelf, and still no band.
    expect(await getPriceBand({
      brandSlug: null, model: null, categorySlug: 'furniture-appliances', subcategorySlug: 'beds-mattresses', listingType: 'sell', condition: 'used', year: null, attributes: null,
    })).toBeNull()
  })

  it('a brand+model row wins over the fallback when it has data', async () => {
    await run(fallbackStatsUpsertSql({}))
    await pg.query(
      `INSERT INTO "PriceStat" ("brandSlug", model, segment, n, p25, median, p75) VALUES ('ikea', 'Hemnes', 'furniture-appliances/beds-mattresses|used', 5, 4000000, 4400000, 4800000)`,
    )
    expect(await getPriceBand({
      brandSlug: 'ikea', model: 'Hemnes', categorySlug: 'furniture-appliances', subcategorySlug: 'beds-mattresses', listingType: 'sell',
      condition: 'used', year: null, attributes: wood,
    })).toEqual({ n: 5, p25: 4_000_000, median: 4_400_000, p75: 4_800_000, basis: 'model' })
  })
})
