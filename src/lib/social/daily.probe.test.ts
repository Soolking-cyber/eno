// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// ⚠️ Prisma 7 has no Rust engine — a driver adapter is REQUIRED or the client throws on
// construction. Built the same way src/lib/db.ts does, against the pooled URL.
const client = () => new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

/**
 * ⚠️ THIS TALKS TO THE REAL DATABASE, ON PURPOSE, AND IT IS THE ONLY TEST HERE THAT DOES.
 *
 * It exists because the first version of the daily selection was hand-written SQL that was wrong in
 * three ways at once — `l.category` (the column is `categoryId`), `array_length(images,1)` and
 * `images[1]` (the column is TEXT holding JSON) — and NOTHING caught it: tsc does not read template
 * literals, and the unit tests mock fetch rather than the database. It would have failed on the
 * first scheduled run at 02:00 with nobody watching.
 *
 * ⚠️ IT IS READ-ONLY AND ASSERTS THE SHAPE the query returns, never a specific listing — the
 * catalogue changes daily and an assertion about its contents would be a flake generator.
 *
 * ⛔ IT OPTS IN ON `LIVE_DB_TESTS=1`, AND *NOT* ON THE PRESENCE OF `DATABASE_URL` — that was the
 * first version and CI failed on it twice. .github/workflows/ci.yml sets
 * `DATABASE_URL: postgresql://user:pass@localhost:5432/db`, a DUMMY that exists only so Prisma can
 * generate, so "the variable is set" is true in exactly the environment that has no database. The
 * guard has to key on something nothing else sets by accident.
 *
 * Run it locally with:  set -a; . ./.env; set +a; LIVE_DB_TESTS=1 npx vitest run src/lib/social
 */
const live = process.env.LIVE_DB_TESTS === '1'
describe.skipIf(!live)('daily selection (live schema)', () => {
  it('selects a postable listing with every field the caption needs', async () => {
    const db = client()
    try {
      const row = await db.listing.findFirst({
        where: { status: 'active' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, title: true, price: true, currency: true, location: true,
          district: true, images: true, category: { select: { name: true } },
        },
      })
      if (!row) return // empty catalogue is a valid state, not a failure
      expect(typeof row.id).toBe('string')
      expect(typeof row.title).toBe('string')
      expect(typeof row.price).toBe('number')
      expect(typeof row.category?.name).toBe('string')
      // The field that broke it: TEXT holding a JSON array, never a Postgres array.
      expect(typeof row.images).toBe('string')
      const parsed: unknown = JSON.parse(row.images || '[]')
      expect(Array.isArray(parsed)).toBe(true)
    } finally { await db.$disconnect() }
  })

  it('the social_posts table exists with the dedup index the job depends on', async () => {
    const db = client()
    try {
      const idx = await db.$queryRaw<Array<{ indexname: string }>>`
        select indexname from pg_indexes where tablename = 'social_posts'
      `
      expect(idx.map((r) => r.indexname)).toContain('social_posts_listing_channel_uniq')
    } finally { await db.$disconnect() }
  })
})
