import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * <LiveCounts> against a fake database — the component's contract is what the PAGE gets to say, so
 * that is what is asserted: the number, the "all in one province" flag, and the fallback on failure.
 */
const h = vi.hoisted(() => ({
  count: vi.fn<(args: { where: unknown }) => Promise<number>>(),
}))
vi.mock('@/lib/db', () => ({ db: { listing: { count: h.count } } }))
// The scope wrapper is edition-lint's business; here it only has to pass the predicate through.
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async <T,>(w: T) => w }))

import { LiveCounts } from './live-count'
import type { LiveCountFacts } from './live-count-facts'

/** Resolve the async server component the way the RSC renderer would, then render its output. */
async function run(
  props: Omit<React.ComponentProps<typeof LiveCounts<'rentals'>>, 'children'>,
): Promise<Record<'rentals', LiveCountFacts | null>> {
  let seen: Record<'rentals', LiveCountFacts | null> | null = null
  const out = await LiveCounts({ ...props, children: (live) => ((seen = live), null) })
  renderToStaticMarkup(out as React.ReactElement)
  return seen!
}

/** A province-scoped count carries the province predicate as its own AND element. */
const isProvinceQuery = (args: { where: unknown }) => JSON.stringify(args.where).includes('Ho Chi Minh')

beforeEach(() => {
  h.count.mockReset()
})

describe('LiveCounts', () => {
  it('hands the page a formatted count and the all-in-province flag when every row is inside', async () => {
    h.count.mockImplementation(async () => 25502)
    const live = await run({ targets: { rentals: { categorySlug: 'rentals', allIn: 'Ho Chi Minh' } }, lang: 'en' })
    expect(live.rentals).toEqual({ n: 25502, count: '25,502', allInside: true })
  })

  it('drops the province claim the moment one row is elsewhere', async () => {
    h.count.mockImplementation(async (args) => (isProvinceQuery(args) ? 25501 : 25502))
    const live = await run({ targets: { rentals: { categorySlug: 'rentals', allIn: 'Ho Chi Minh' } }, lang: 'vi' })
    expect(live.rentals).toEqual({ n: 25502, count: '25.502', allInside: false })
  })

  it('does not ask the province question when the page did not', async () => {
    h.count.mockImplementation(async () => 42)
    await run({ targets: { rentals: { categorySlug: 'rentals' } }, lang: 'en' })
    expect(h.count).toHaveBeenCalledTimes(1)
    expect(isProvinceQuery(h.count.mock.calls[0][0])).toBe(false)
  })

  it('⛔ a failed read is "could not count" (null), never zero and never a remembered figure', async () => {
    h.count.mockImplementation(async () => {
      throw new Error('database unreachable at build')
    })
    const live = await run({ targets: { rentals: { categorySlug: 'rentals', allIn: 'Ho Chi Minh' } }, lang: 'en' })
    expect(live.rentals).toBeNull()
  })

  it('a failed PROVINCE read keeps the count and removes only the claim', async () => {
    h.count.mockImplementation(async (args) => {
      if (isProvinceQuery(args)) throw new Error('timeout')
      return 25502
    })
    const live = await run({ targets: { rentals: { categorySlug: 'rentals', allIn: 'Ho Chi Minh' } }, lang: 'en' })
    expect(live.rentals).toEqual({ n: 25502, count: '25,502', allInside: false })
  })

  it('counts the used-condition slice with the landing predicate (verified, active, category, condition)', async () => {
    h.count.mockImplementation(async () => 3201)
    const out = await LiveCounts({
      targets: { used: { categorySlug: 'furniture-appliances', condition: 'used' } },
      lang: 'vi',
      children: ({ used }) => <span>{used?.count}</span>,
    })
    expect(renderToStaticMarkup(out as React.ReactElement)).toBe('<span>3.201</span>')
    const where = JSON.stringify(h.count.mock.calls[0][0].where)
    expect(where).toContain('"verified":true')
    expect(where).toContain('"status":"active"')
    expect(where).toContain('furniture-appliances')
  })
})
