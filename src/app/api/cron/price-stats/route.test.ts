import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /api/cron/price-stats — the fallback step must never cost the brand+model bands or the card badges,
 * and must never fail silently. The SQL itself is executed in src/lib/price-stat.sql.test.ts; this file
 * holds the ORDER and the FAILURE contract of the nightly run with the database mocked.
 */

const h = vi.hoisted(() => ({
  calls: [] as string[],
  scope: (async () => ({ sellerId: { notIn: ['desk-1'] } })) as () => Promise<unknown>,
}))

vi.mock('@/lib/db', () => ({
  db: {
    $executeRaw: vi.fn(async (sql: { text?: string; sql?: string }) => {
      const text = String(sql?.text ?? sql?.sql ?? '')
      h.calls.push(
        text.includes('DELETE FROM "PriceStat"') ? 'prune'
          : text.includes('jsonb_to_recordset') ? 'fallback'
            : text.includes('INSERT INTO "PriceStat"') ? 'model'
              : text.includes('UPDATE "Listing"') ? 'positions'
                : 'other',
      )
      return 7
    }),
    $transaction: vi.fn(async (ops: Promise<number>[]) => {
      h.calls.push('transaction')
      return Promise.all(ops)
    }),
  },
}))
vi.mock('@/lib/edition-scope', () => ({ marketplaceListingScope: () => h.scope() }))

const { GET } = await import('./route')

const previousSecret = process.env.CRON_SECRET
afterAll(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = previousSecret
})

const call = () => GET(new Request('https://eno.vn/api/cron/price-stats', { headers: { authorization: 'Bearer sekret' } }) as never)

beforeEach(() => {
  process.env.CRON_SECRET = 'sekret'
  h.calls = []
  h.scope = async () => ({ sellerId: { notIn: ['desk-1'] } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('the nightly run', () => {
  it('writes the brand+model bands, then the fallback bands, then prunes and positions', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, segments: 7, fallback: 7, pruned: 7, positioned: 7 })
    expect(h.calls.slice(0, 3)).toEqual(['model', 'fallback', 'prune'])
    expect(h.calls).toContain('transaction')
  })

  it('⛔ a fallback failure still writes the model bands, prunes and positions — then fails the run loudly', async () => {
    h.scope = async () => {
      throw new Error('[edition] refusing to serve a marketplace listing query: no desk seller could be resolved')
    }
    const res = await call()
    expect(res.status).toBe(500)
    expect(h.calls).toContain('model')
    expect(h.calls).not.toContain('fallback')
    expect(h.calls).toContain('prune')
    expect(h.calls).toContain('transaction')
  })

  it('⛔ a scope shape the fallback SQL cannot translate fails the run instead of building unscoped bands', async () => {
    h.scope = async () => ({ sellerId: { notIn: ['desk-1'] }, categoryId: { not: 'teachers' } })
    const res = await call()
    expect(res.status).toBe(500)
    expect(h.calls).not.toContain('fallback')
    expect(h.calls).toContain('model')
    expect(h.calls).toContain('transaction')
  })

  it('a falsy throw still fails the run', async () => {
    h.scope = async () => {
      throw undefined
    }
    expect((await call()).status).toBe(500)
  })
})
