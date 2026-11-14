/**
 * UI climb batch 94 (owner-approved 2026-11-14, decision 4): cards and rows print a sale price in millions; THE LISTING PAGE
 * KEEPS EVERY DIGIT. Source pins, like the other contracts in this folder (page.tsx is a server component too heavy to render
 * here): the sticky bar reads the per-unit `rateCompactAbove` — a rent "12M đ / month", a sale in full — never the cards'
 * `cardCompactAbove`, and the headline and the struck price pass no `compact` at all. What the bar renders is pinned in
 * price.native.test.tsx ("the sticky bar").
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')
/** Every `<Price …/>` element on the page, comments inside the tag included. */
const prices = () => [...PAGE.matchAll(/<Price\s[\s\S]*?\/>/g)].map((m) => m[0])

describe('batch 94 — the listing page keeps every digit of a sale price', () => {
  it('the sticky bar\'s Price is compact on the per-unit threshold only', () => {
    const bar = prices().filter((p) => /\bcompact\b/.test(p))
    expect(bar).toHaveLength(1)
    expect(bar[0]).toContain('compactAbove={rateCompactAbove(listing)}')
    expect(bar[0]).not.toMatch(/\bnative\b/) // so <Price>'s sr-only full figure never renders in the bar
  })
  it('the cards\' threshold is neither imported nor called on the page', () => {
    const vnd = PAGE.match(/import \{([^}]*)\} from '@\/lib\/vnd'/)
    expect(vnd, 'the vnd import').not.toBeNull()
    expect(vnd![1]).toMatch(/\brateCompactAbove\b/)
    expect(vnd![1]).not.toMatch(/\bcardCompactAbove\b/)
    expect(PAGE).not.toContain('cardCompactAbove(')
  })
  it('the headline and the struck was-price pass no `compact`', () => {
    const headline = prices().filter((p) => p.includes('className="text-3xl tracking-tight"'))
    expect(headline.length).toBeGreaterThanOrEqual(2) // the salary figure and the price
    for (const p of headline) expect(p).not.toMatch(/\bcompact/)
    const struck = prices().filter((p) => p.includes('price={listing.prevPrice}'))
    expect(struck).toHaveLength(1)
    expect(struck[0]).not.toMatch(/\bcompact/)
  })
})
