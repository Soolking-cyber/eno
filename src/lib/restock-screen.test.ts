import { describe, expect, it } from 'vitest'
import { partitionRestock, restockReport, screenRestock, type RestockDb, type RestockRow } from './restock-screen'

// The restock screen runs the REAL import screen (banned words + the ad classifier) — nothing mocked,
// so these fixtures are decided by the same code that decides an import.

const row = (id: string, title: string, extra: Partial<RestockRow> = {}): RestockRow => ({
  id, title, titleVi: null, description: null, descriptionVi: null, subcategorySlug: null, category: { slug: 'home-living' }, ...extra,
})

describe('partitionRestock — what may go back to active', () => {
  const rows = [
    row('ok', 'Áo thun nam cotton'),
    row('spirit', 'Rượu Vodka Hà Nội 29.5%'),
    row('bottle', 'Bình sữa Pigeon 240ml'),
    row('vet', 'Bravecto cho chó 20-40kg'),
    row('soju', 'Soju Jinro vị đào'),
  ]

  it("'ban' and banned words are NOT restocked and are hidden; 'review' is restocked AND reported", () => {
    const d = partitionRestock(rows.map((r) => r.id), rows, 'Tiki')
    expect(d.restock).toEqual(['ok', 'soju'])
    expect(d.hide.map((f) => [f.id, f.reason, f.rule])).toEqual([
      ['spirit', 'ad_banned', 'spirits'],
      ['bottle', 'ad_banned', 'feeding_bottle'],
      ['vet', 'banned_word', 'banned_word'],
    ])
    expect(d.review.map((f) => [f.id, f.reason])).toEqual([['soju', 'ad_review']])
  })

  it('a candidate whose text was not read (gone, or no longer sold) is not restocked', () => {
    expect(partitionRestock(['ok', 'missing'], [row('ok', 'Áo thun nam cotton')], null)).toEqual({ restock: ['ok'], hide: [], review: [] })
  })

  it('the Vietnamese title counts: an English title over a banned Vietnamese one is still refused', () => {
    const d = partitionRestock(['x'], [row('x', 'Baby product 240ml', { titleVi: 'Bình sữa Pigeon 240ml' })], null)
    expect(d.restock).toEqual([])
    expect(d.hide[0]).toMatchObject({ id: 'x', rule: 'feeding_bottle' })
  })
})

/** A fake that keeps statuses and records every query, so the WHERE clauses can be asserted. */
function fakeDb(rows: Array<RestockRow & { status: string }>) {
  const calls: Array<{ m: string; args: any }> = []
  const db: RestockDb = {
    listing: {
      findMany: async (args) => {
        calls.push({ m: 'findMany', args })
        return rows.filter((r) => args.where.id.in.includes(r.id) && r.status === args.where.status)
      },
      updateMany: async (args) => {
        calls.push({ m: 'updateMany', args })
        const hit = rows.filter((r) => args.where.id.in.includes(r.id) && r.status === args.where.status)
        for (const r of hit) r.status = args.data.status
        return { count: hit.length }
      },
    },
  }
  return { db, calls, rows }
}

describe('screenRestock — reads still-sold rows, hides only still-sold banned rows', () => {
  it('a banned sold row is hidden; an ok one is left for the caller to restock', async () => {
    const f = fakeDb([{ ...row('a', 'Áo thun nam cotton'), status: 'sold' }, { ...row('b', 'Rượu Vodka Hà Nội 29.5%'), status: 'sold' }])
    const d = await screenRestock(f.db, ['a', 'b'], 'Tiki')
    expect(d.restock).toEqual(['a'])
    expect(d.hidden).toBe(1)
    expect(f.rows.map((r) => [r.id, r.status])).toEqual([['a', 'sold'], ['b', 'hidden']])
    // Both the read and the hide are pinned to status 'sold'.
    expect(f.calls.map((c) => c.args.where.status)).toEqual(['sold', 'sold'])
    expect(f.calls[1].args).toEqual({ where: { id: { in: ['b'] }, status: 'sold' }, data: { status: 'hidden' } })
  })

  it('⛔ a TOMBSTONE is never a candidate: not read, not restocked, not hidden', async () => {
    const f = fakeDb([{ ...row('r', 'Rượu Vodka Hà Nội 29.5%'), status: 'removed' }, { ...row('s', 'Áo thun nam cotton'), status: 'removed' }])
    const d = await screenRestock(f.db, ['r', 's'], null)
    expect(d).toMatchObject({ restock: [], hide: [], hidden: 0 })
    expect(f.rows.map((r) => r.status)).toEqual(['removed', 'removed'])
  })

  it('no banned rows → no write at all', async () => {
    const f = fakeDb([{ ...row('a', 'Áo thun nam cotton'), status: 'sold' }])
    await screenRestock(f.db, ['a'], null)
    expect(f.calls.filter((c) => c.m === 'updateMany')).toEqual([])
  })
})

describe('restockReport', () => {
  it('says nothing when nothing was flagged', () => {
    expect(restockReport({ restock: ['a'], hide: [], review: [], hidden: 0 })).toEqual({})
  })
  it('names the hidden and review rows for a human (and a rollback)', () => {
    const flag = { id: 'b', reason: 'ad_banned' as const, rule: 'spirits', matched: 'vodka 29.5%' }
    expect(restockReport({ restock: [], hide: [flag], review: [], hidden: 1 })).toEqual({ restockScreen: { hidden: 1, hiddenRows: [flag], review: 0, reviewRows: [] } })
  })
})
