import { describe, expect, it, vi } from 'vitest'

/**
 * logSearch writes through trend_log(), which `returns void`. $queryRaw deserializes the result column and Postgres
 * `void` has no Prisma type, so it threw — after the row was written — on every search, and Prisma logged a
 * prisma:error each time. $executeRaw deserializes nothing (the kv_del trap in ratelimit.ts).
 */
const h = vi.hoisted(() => ({ executeRaw: vi.fn(async () => 1), queryRaw: vi.fn(async () => []) }))
vi.mock('@/lib/db', () => ({ db: { $executeRaw: h.executeRaw, $queryRaw: h.queryRaw } }))

const { logSearch } = await import('./trending')

describe('logSearch', () => {
  it('writes the term through $executeRaw — never $queryRaw, which cannot read a void column', async () => {
    await logSearch('Apartment District 2', 'actor-1')
    expect(h.executeRaw).toHaveBeenCalledTimes(1)
    expect(h.queryRaw).not.toHaveBeenCalled()
    const [strings, ...values] = h.executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]]
    expect(strings.join('?')).toContain('trend_log(')
    expect(values).toEqual(['apartment district 2', 'actor-1'])
  })

  it('a denylisted or too-short term writes nothing', async () => {
    h.executeRaw.mockClear()
    await logSearch('a')
    await logSearch('test')
    expect(h.executeRaw).not.toHaveBeenCalled()
  })
})
