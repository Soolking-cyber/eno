import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
vi.mock('@/lib/db', () => ({ db: { listing: { findMany: (...a: unknown[]) => findMany(...a) } } }))
// The edition scope passes the predicate through here; its own tests cover what it adds.
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
const { isDuplicateImport, DUPLICATE_IMPORT_SQL } = await import('./duplicate-import')

const row = {
  id: 'cm2', sellerId: 's1', externalId: 'partner:42', title: '2-bedroom villa · Victoria Village',
  price: 19_340_000, description: 'A villa with a garden.', createdAt: new Date('2026-11-20T00:00:00Z'),
}

beforeEach(() => findMany.mockReset())
const LONG = { externalId: 'partner:41', description: 'x'.repeat(400) }

describe('isDuplicateImport', () => {
  it('a member post is never a repeat, and is not even looked up', async () => {
    expect(await isDuplicateImport({ ...row, externalId: null })).toBe(false)
    expect(await isDuplicateImport({ ...row, externalId: 'fb:123' })).toBe(false)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('an import is a repeat when an older live listing of its seller has its title at its price, or its description', async () => {
    findMany.mockResolvedValueOnce([LONG])
    expect(await isDuplicateImport(row)).toBe(true)
    const where = findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ sellerId: 's1', id: { not: 'cm2' }, verified: true, status: 'active', affiliateUrl: null })
    expect(where.AND[0]).toEqual({ OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: 'cm2' } }] })
    expect(where.AND[1]).toEqual({ OR: [{ title: row.title, price: row.price }, { description: row.description }] })
  })

  it('the oldest copy is not a repeat', async () => {
    findMany.mockResolvedValueOnce([])
    expect(await isDuplicateImport(row)).toBe(false)
  })

  it('⛔ an older copy that is thin (noindex itself) does not push this one out: the group keeps an indexed page', async () => {
    findMany.mockResolvedValueOnce([{ externalId: 'partner:40', description: 'short' }])
    expect(await isDuplicateImport(row)).toBe(false)
  })

  it('an empty description is never matched as the same description', async () => {
    findMany.mockResolvedValueOnce([])
    await isDuplicateImport({ ...row, description: '' })
    expect(findMany.mock.calls[0][0].where.AND[1]).toEqual({ OR: [{ title: row.title, price: row.price }] })
  })

  it('the sitemap SQL states the same rule', () => {
    const sql = DUPLICATE_IMPORT_SQL.sql.replace(/\s+/g, ' ')
    expect(sql).toContain('o."sellerId" = l."sellerId"')
    expect(sql).toContain('o.verified AND o.status = \'active\'')
    expect(sql).toContain('o."affiliateUrl" IS NULL AND o."externalId" IS NOT NULL AND o."externalId" NOT LIKE \'fb:%\'')
    expect(sql).toContain('length(o.description) >=')
    expect(sql).toContain('(o.title = l.title AND o.price = l.price) OR (l.description <> \'\' AND o.description = l.description)')
  })
})
