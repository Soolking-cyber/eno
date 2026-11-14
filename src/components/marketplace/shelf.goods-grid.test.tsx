import { describe, expect, it } from 'vitest'
import { GOODS_PHONE_GRID, PHONE_GRID } from './shelf'

/**
 * ⛔ Shelf `phoneGrid="goods"` (owner-approved 2026-11-14, cook r06 goods: a thin search's "More in …" / Trending under the goods
 * results): the feed's two columns (the 4px gap and the rail's bleed, so a card is a feed column — 189px at 390, never smaller),
 * rows 40px apart like the results above (owner-approved 2026-11-15 (build 8), cook r08 goods; 20 in build 7, 32 in r06), every card drawn (no "See all" holds an odd one), all `max-sm:`.
 */
describe('GOODS_PHONE_GRID', () => {
  it('two columns, the 4px gap, 40px between rows, overflow visible, the cards a column wide — phones only', () => {
    for (const c of GOODS_PHONE_GRID.split(' ')) expect(c).toMatch(/^max-sm:/)
    for (const c of ['max-sm:grid', 'max-sm:grid-cols-2', 'max-sm:gap-x-1', 'max-sm:gap-y-10', 'max-sm:overflow-visible', 'max-sm:snap-none', 'max-sm:[&>*]:w-auto']) {
      expect(GOODS_PHONE_GRID.split(' ')).toContain(c)
    }
  })

  it('keeps an odd last card (the listing-page grid hides it; this one has no "See all")', () => {
    expect(GOODS_PHONE_GRID).not.toContain('nth-child(odd)')
    expect(PHONE_GRID).toContain('nth-child(odd)')
  })
})
