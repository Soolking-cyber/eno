import { describe, expect, it } from 'vitest'
import { Prisma } from '../generated/prisma/client'
import { movePublicLinksToStaff, upsertPurchaseLinks } from './partner-purchase-link'

type Captured = { sql: string; values: unknown[] }
const fake = () => {
  const seen: Captured[] = []
  return {
    seen,
    dbc: {
      $queryRaw: async <T,>(q: { sql: string; values: unknown[] }) => { seen.push({ sql: q.sql.replace(/\s+/g, ' '), values: q.values }); return [{ id: 'L1' }] as T },
      $executeRaw: async (q: { sql: string; values: unknown[] }) => { seen.push({ sql: q.sql.replace(/\s+/g, ' '), values: q.values }); return 1 },
    },
  }
}

describe('movePublicLinksToStaff — one statement, a fresher staff link always kept (owner 2026-11-14; commit gate)', () => {
  it('locks the public rows, nulls them, and inserts a staff link ONLY where none exists', async () => {
    const f = fake()
    expect(await movePublicLinksToStaff(f.dbc as never, Prisma, 'S1')).toEqual(['L1'])
    const q = f.seen[0].sql
    expect(q).toContain('FOR UPDATE')
    expect(q).toContain('ON CONFLICT ("listingId") DO NOTHING')
    expect(q).toContain('SET "affiliateUrl" = NULL')
    // A live row's updatedAt moves (the 48-hour purge sweep finds it again); a hidden row's does not (its rollback holds).
    expect(q).toContain(`"updatedAt" = CASE WHEN l.status IN ('active', 'sold') THEN (now() AT TIME ZONE 'UTC') ELSE l."updatedAt" END`)
    expect(f.seen[0].values).toEqual(['S1'])
  })
  it('the move script\'s run moves only its journaled (id, url) snapshot', async () => {
    const f = fake()
    await movePublicLinksToStaff(f.dbc as never, Prisma, 'S1', { ids: ['L1'], urls: ['https://go.isclix.com/a'] })
    expect(f.seen[0].sql).toContain('AND (id, "affiliateUrl") IN (SELECT * FROM unnest(')
    expect(f.seen[0].values).toEqual(['S1', ['L1'], ['https://go.isclix.com/a']])
  })
})

describe('upsertPurchaseLinks — the nightly refresh of a staff link', () => {
  it('writes only a link that changed', async () => {
    const f = fake()
    await upsertPurchaseLinks(f.dbc as never, Prisma, [{ listingId: 'L1', url: 'https://go.isclix.com/b' }])
    expect(f.seen[0].sql).toContain('WHERE "PartnerPurchaseLink".url IS DISTINCT FROM EXCLUDED.url')
  })
})
