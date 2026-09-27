import { describe, expect, it } from 'vitest'
import { KEEP_READING_MAX, keepReading, relatedTokens, type RelatedLink } from './seo-article-related'
import { PHONE_GUIDES, phoneGuidesIn } from '@/lib/phone-guides'
import { MARKETPLACE_GUIDES, marketplaceGuidesExcept } from '@/lib/expat-guides'

const link = (slug: string, label = slug): RelatedLink => ({ href: `/${slug}`, label, blurb: '' })

describe('keepReading — the capped "Keep reading" block', () => {
  it('returns a list already at or under the cap untouched, in the author’s order', () => {
    const hand = [link('rental-deposit-vietnam'), link('furnishing-a-home-in-vietnam'), link('renting-an-apartment-vietnam-foreigner')]
    expect(keepReading(hand, { canonical: '/housing-vietnam-expats' })).toEqual(hand)
  })

  it('never links a page to itself', () => {
    const list = [link('a-guide'), link('b-guide')]
    expect(keepReading(list, { canonical: '/a-guide' }).map((r) => r.href)).toEqual(['/b-guide'])
  })

  it(`caps at ${KEEP_READING_MAX}`, () => {
    const many = Array.from({ length: 16 }, (_, i) => link(`guide-${String(i).padStart(2, '0')}`))
    expect(keepReading(many, { canonical: '/guide-99' })).toHaveLength(KEEP_READING_MAX)
  })

  it('puts the guides sharing this page’s distinctive words first', () => {
    const out = keepReading(
      phoneGuidesIn('en', 'iphone-battery-replacement-vietnam').map((g) => link(g.slug, g.label)),
      { canonical: '/iphone-battery-replacement-vietnam', h1: 'iPhone battery replacement in Vietnam' },
    )
    // The first card is another iPhone guide, not whatever happens to be first in the registry.
    expect(out[0].href).toMatch(/iphone/)
  })

  it('matches Vietnamese labels to unaccented slugs', () => {
    expect([...relatedTokens('Thay pin iPhone ở đâu')]).toEqual(expect.arrayContaining(['thay', 'pin', 'iphone']))
    expect(relatedTokens('thay-pin-iphone-o-dau')).toEqual(relatedTokens('Thay pin iPhone ở đâu'))
  })

  it('is deterministic', () => {
    const list = phoneGuidesIn('en', 'esim-vietnam-guide').map((g) => link(g.slug, g.label))
    const a = keepReading(list, { canonical: '/esim-vietnam-guide', h1: 'eSIM in Vietnam' })
    const b = keepReading([...list], { canonical: '/esim-vietnam-guide', h1: 'eSIM in Vietnam' })
    expect(a).toEqual(b)
  })
})

/**
 * ⛔ THE REASON THE TIE-BREAK IS NOT REGISTRY ORDER. A plain `.slice(0, 6)` gives every page the same
 * six cards and leaves the rest of the cluster with no inbound "Keep reading" link from any sibling.
 * This walks the real registries through the real cap and fails if any guide ends up orphaned.
 */
describe('after the cap, every guide is still linked from at least one sibling', () => {
  for (const lang of ['en', 'vi'] as const) {
    it(`phone guides (${lang})`, () => {
      const guides = PHONE_GUIDES.filter((g) => g.lang === lang)
      const inbound = new Map(guides.map((g) => [`/${g.slug}`, 0]))
      for (const g of guides) {
        const cards = keepReading(
          phoneGuidesIn(lang, g.slug).map((x) => link(x.slug, x.label)),
          { canonical: `/${g.slug}`, h1: g.label },
        )
        for (const c of cards) inbound.set(c.href, (inbound.get(c.href) ?? 0) + 1)
      }
      const orphans = [...inbound].filter(([, n]) => n === 0).map(([href]) => href)
      expect(orphans).toEqual([])
    })
  }

  it('marketplace guides are under the cap, so their blocks are unchanged', () => {
    for (const g of MARKETPLACE_GUIDES) {
      const passed = marketplaceGuidesExcept(g.slug)
      expect(keepReading(passed, { canonical: `/${g.slug}` })).toEqual(passed)
    }
  })
})
