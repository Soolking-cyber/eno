import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXPAT_GUIDES, EXPAT_GUIDE_PATHS, expatGuidesExcept, marketplaceGuideAlternates, MARKETPLACE_GUIDES, marketplaceGuidesExcept } from './expat-guides'

/**
 * THE ARRIVAL GUIDES — two guarantees that nothing else in the toolchain can check.
 *
 * ⚠️ ONE: THE ROUTES MUST BE SERVICES-ONLY, AND "IS IT `.svc.`?" IS A FILENAME QUESTION. Both guides
 * name the e-visa, evisa.gov.vn and the licensed partner in their prose, so on eno.vn — a licensed
 * sàn TMĐT that may not mention the service — the route must not exist. `pageExtensions` in
 * next.config.ts delivers that from the FILENAME alone, which means a rename from `page.svc.tsx` to
 * `page.tsx` ships the vocabulary in the licensed image while looking like a tidy-up in the diff.
 * scripts/edition-lint.mjs Rule B catches it from the other direction (the tree is in its list); this
 * catches it from the registry's, so removing either guard still leaves one.
 *
 * ⚠️ TWO: THE REGISTRY'S VALUES MUST STAY VOCABULARY-FREE. src/app/sitemap.xml/route.ts imports
 * `EXPAT_GUIDE_PATHS` and compiles on BOTH editions, so every string in this module lands in
 * eno.vn's server bundle. That is fine precisely because none of them says "visa" — and it stops
 * being fine the first time somebody writes a more descriptive blurb. The module header states the
 * rule; this is what makes it hold.
 */

// Comments legitimately discuss the service; only the VALUES are constrained.
const decomment = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('expat guides registry', () => {
  it('holds at least two guides, so nothing below passes vacuously', () => {
    expect(EXPAT_GUIDES.length).toBeGreaterThanOrEqual(2)
    expect(EXPAT_GUIDE_PATHS.length).toBe(EXPAT_GUIDES.length)
  })

  it.each(EXPAT_GUIDES.map((g) => [g.slug]))('%s is a FORUM-ONLY route (page.forum.svc.tsx)', (slug) => {
    const dir = `src/app/[lang]/${slug}`
    expect(
      existsSync(`${dir}/page.forum.svc.tsx`),
      `${dir}/page.forum.svc.tsx does not exist — the guide is in the registry and in the sitemap, but there is no route`,
    ).toBe(true)
    expect(
      existsSync(`${dir}/page.tsx`),
      `${dir}/page.tsx exists — a MARKETPLACE build would compile it, putting e-visa and partner vocabulary in the licensed image`,
    ).toBe(false)
  })

  it.each(EXPAT_GUIDES.map((g) => [g.slug, g]))('%s carries link text and a blurb', (_slug, guide) => {
    const g = guide as (typeof EXPAT_GUIDES)[number]
    expect(g.label).toBeTruthy()
    expect(g.blurb).toBeTruthy()
    // Anchor text is the payload — a bare URL or "read more" passes no signal.
    expect(g.label).not.toMatch(/^https?:|read more|click here/i)
  })

  it('no value in the module mentions the service, because the sitemap imports it on both editions', () => {
    const values = decomment(readFileSync('src/lib/expat-guides.ts', 'utf8'))
    expect(values, 'src/lib/expat-guides.ts leaks services vocabulary outside its comments').not.toMatch(
      /visa|passport|VietKite|PayPal|itinerary|thị thực|hộ chiếu/i,
    )
  })

  it('the sitemap submits the guides, and only on the services edition', () => {
    const sitemap = readFileSync('src/app/sitemap.xml/route.ts', 'utf8')
    // ⚠️ IMPORTED, NOT RETYPED — the same failure this registry exists to prevent. A sitemap that
    // hard-coded these two paths would silently stop covering the third guide.
    expect(sitemap).toMatch(/EXPAT_GUIDE_PATHS/)
    // ⚠️ THE EMISSION HAS TO SIT INSIDE AN `IS_SERVICES` BRANCH. These are `.svc.` routes, so
    // submitting them from eno.vn would be asking Google to index two 404s — and the sitemap is not
    // a passive document, it is the site actively requesting indexation.
    //
    // Checked by looking at the text immediately BEFORE the `for … of EXPAT_GUIDE_PATHS` loop rather
    // than by parsing: a brace-matching regex over this file is more likely to be wrong than the
    // code it checks. The window is small enough that only the loop's own guard can satisfy it.
    const loopAt = sitemap.indexOf('of EXPAT_GUIDE_PATHS')
    expect(loopAt, 'the sitemap imports EXPAT_GUIDE_PATHS but never iterates it').toBeGreaterThan(0)
    expect(sitemap.slice(Math.max(0, loopAt - 200), loopAt)).toContain('if (IS_SERVICES)')
  })

  it('excludes the current guide from its own related list', () => {
    const first = EXPAT_GUIDES[0].slug
    expect(expatGuidesExcept(first).map((g) => g.href)).not.toContain(`/${first}`)
    expect(expatGuidesExcept().length).toBe(EXPAT_GUIDES.length)
  })
})

describe('marketplace guide hreflang', () => {
  it('every pair is RECIPROCAL — a one-way pair is ignored by Google outright', () => {
    for (const g of MARKETPLACE_GUIDES) {
      if (!g.pair) continue
      const other = MARKETPLACE_GUIDES.find((x) => x.slug === g.pair)
      expect(other, `${g.slug} names pair ${g.pair}, which is not in the registry`).toBeTruthy()
      expect(other!.pair, `${other!.slug} does not point back at ${g.slug}`).toBe(g.slug)
      expect(g.lang, `${g.slug} has a pair but no lang`).toBeTruthy()
      expect(other!.lang, `${other!.slug} has a pair but no lang`).toBeTruthy()
      expect(other!.lang, `${g.slug} and ${other!.slug} are both ${g.lang}`).not.toBe(g.lang)
    }
  })

  it('both sides of a pair emit the SAME languages map', () => {
    // ⛔ THE POINT OF READING BOTH SIDES FROM ONE FUNCTION. Hand-written `alternates` in two page
    // files drift, and the drift is invisible: each page looks correct on its own.
    for (const g of MARKETPLACE_GUIDES) {
      if (!g.pair) continue
      const a = marketplaceGuideAlternates(g.slug)
      const b = marketplaceGuideAlternates(g.pair)
      expect(a.languages).toEqual(b.languages)
      expect(a.canonical).not.toBe(b.canonical)
    }
  })

  it('x-default points at the ENGLISH article, never the Vietnamese one', () => {
    // On a .vn domain, omitting x-default lets Google serve the Vietnamese page to everyone —
    // including the English-speaking audience this marketplace exists for.
    for (const g of MARKETPLACE_GUIDES) {
      if (!g.pair) continue
      const alt = marketplaceGuideAlternates(g.slug)
      expect(alt.languages!['x-default']).toBe(alt.languages!.en)
    }
  })

  it('an unpaired guide gets a bare canonical and NO languages map', () => {
    // Pointing a language at a page that does not exist is worse than declaring nothing.
    const unpaired = MARKETPLACE_GUIDES.find((g) => !g.pair)
    if (!unpaired) return
    const alt = marketplaceGuideAlternates(unpaired.slug)
    expect(alt.canonical).toBe(`/${unpaired.slug}`)
    expect('languages' in alt).toBe(false)
  })

  it('"Keep reading" never crosses languages', () => {
    for (const g of MARKETPLACE_GUIDES) {
      const lang = g.lang ?? 'en'
      for (const rel of marketplaceGuidesExcept(g.slug)) {
        const target = MARKETPLACE_GUIDES.find((x) => `/${x.slug}` === rel.href)!
        expect(target.lang ?? 'en', `${g.slug} links to ${target.slug} across languages`).toBe(lang)
      }
    }
  })
})
