import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MARKETPLACE_GUIDES } from '@/lib/expat-guides'
import { canonicalDistrictSlug, isCuratedDistrict } from '@/lib/district-canonical'

/**
 * THE HAND-PICKED "KEEP READING" BLOCKS ON THE TWO BIG LANDING PAGES.
 *
 * ⚠️ WHY A SOURCE SCAN. Each page resolves its `RELATED_GUIDES` hrefs through the registry and DROPS a
 * miss rather than linking a 404 — the safe failure for a reader, and an invisible one for everybody
 * else: a typo'd slug just means one card fewer, forever. The pages import the Prisma client (via
 * SeoLanding), so they cannot be imported here; reading the literal array is the same trick
 * seo-landing-slugs.test.ts uses for category slugs.
 */
const PAGES: Record<string, string[]> = {
  'src/app/[lang]/housing-vietnam-expats/page.tsx': [
    '/renting-an-apartment-vietnam-foreigner',
    '/rental-deposit-vietnam',
    '/furnishing-a-home-in-vietnam',
  ],
  'src/app/[lang]/moving-sales-vietnam/page.tsx': [
    '/selling-up-before-you-leave-vietnam',
    '/secondhand-furniture-ho-chi-minh-city',
    '/furnishing-a-home-in-vietnam',
  ],
}

function relatedGuidesIn(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const m = src.match(/const RELATED_GUIDES = \[([^\]]*)\]/)
  if (!m) throw new Error(`${file}: no RELATED_GUIDES literal`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

describe('landing-page related guides', () => {
  for (const [file, expected] of Object.entries(PAGES)) {
    it(`${file} links the three guides the brief names, in order`, () => {
      expect(relatedGuidesIn(file)).toEqual(expected)
    })

    it(`${file}: every related guide is a registered ENGLISH marketplace guide with a page`, () => {
      for (const href of relatedGuidesIn(file)) {
        const slug = href.replace(/^\//, '')
        const g = MARKETPLACE_GUIDES.find((x) => x.slug === slug)
        expect(g, `${slug} is not in MARKETPLACE_GUIDES — the card would silently drop`).toBeDefined()
        // The landings are English; a Vietnamese card here would break the same-language rule.
        expect(g?.lang ?? 'en').toBe('en')
        expect(existsSync(`src/app/[lang]/${slug}/page.tsx`), `${slug} has no page.tsx`).toBe(true)
      }
    })
  }
})

describe('housing landing district links', () => {
  // The page says "each district has its own rentals page" and links five of them. A non-canonical
  // key would link a 308, a non-curated one a page the landing cannot vouch for.
  it('links only curated districts, by their canonical slug', () => {
    const src = readFileSync('src/app/[lang]/housing-vietnam-expats/page.tsx', 'utf8')
    const m = src.match(/const AREA_SLUGS = \[([^\]]*)\]/)
    expect(m, 'no AREA_SLUGS literal').toBeTruthy()
    const slugs = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    expect(slugs.length).toBeGreaterThan(0)
    for (const s of slugs) {
      expect(isCuratedDistrict(s), s).toBe(true)
      expect(canonicalDistrictSlug(s), s).toBe(s)
    }
  })
})
