import { describe, expect, it, vi } from 'vitest'

const q = vi.hoisted(() => ({ impl: (() => Promise.resolve([{ phone: 12, other: 30 }])) as () => unknown }))
vi.mock('@/lib/db', () => ({ db: { $queryRaw: () => q.impl() } }))
const { pageLoadsLastDays } = await import('./page-loads')

describe('pageLoadsLastDays — the admin overview\'s real page loads', () => {
  it('phones and the rest, as the query sums them', async () => {
    expect(await pageLoadsLastDays(7)).toEqual({ phone: 12, other: 30 })
  })
  it('⛔ never throws — a failed query, or a client without $queryRaw, is null and the overview stays up', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    q.impl = () => Promise.reject(new Error('relation "rum_daily" does not exist'))
    expect(await pageLoadsLastDays(7)).toBeNull()
    q.impl = () => { throw new TypeError('db.$queryRaw is not a function') }
    expect(await pageLoadsLastDays(7)).toBeNull()
    err.mockRestore()
  })
})
