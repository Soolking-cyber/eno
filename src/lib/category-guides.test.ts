import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATEGORY_GUIDE_LIMIT, guidesForCategory } from './category-guides'
import { MARKETPLACE_GUIDES } from './expat-guides'
import { PHONE_GUIDES } from './phone-guides'
import { TEACH_BASE, TEACH_GUIDES, guideEntry, isLiveTeachHref, teachPath } from './teach-guides/registry'

const slugs = (category: string, lang: 'en' | 'vi') => guidesForCategory(category, lang).map((g) => g.href.slice(1))

describe('guidesForCategory', () => {
  it('puts the guides written FOR rentals first, and falls back to English on a Vietnamese page', () => {
    expect(slugs('rentals', 'en')).toEqual([
      'renting-an-apartment-vietnam-foreigner',
      'rental-deposit-vietnam',
      'furnishing-a-home-in-vietnam',
    ])
    // No Vietnamese rentals guide exists yet — English, not an empty block and not a mix.
    expect(slugs('rentals', 'vi')).toEqual(slugs('rentals', 'en'))
    expect(guidesForCategory('rentals', 'vi').every((g) => g.lang === 'en')).toBe(true)
  })

  it('serves a Vietnamese page its own Vietnamese guides when they exist', () => {
    expect(slugs('furniture-appliances', 'vi')).toEqual(['thanh-ly-do-gia-dung-cu-tphcm', 'ban-do-cu-o-dau-duoc-gia'])
    expect(guidesForCategory('furniture-appliances', 'vi').every((g) => g.lang === 'vi')).toBe(true)
    expect(slugs('furniture-appliances', 'en')).toEqual([
      'furnishing-a-home-in-vietnam',
      'selling-up-before-you-leave-vietnam',
      'secondhand-furniture-ho-chi-minh-city',
    ])
  })

  /** Used furniture here is dealer-supplied; a guide about foreigners' moving sales must not sit on it. */
  it('never links the moving-sales framing from the furniture category', () => {
    for (const lang of ['en', 'vi'] as const) expect(slugs('furniture-appliances', lang)).not.toContain('do-cu-cua-nguoi-nuoc-ngoai')
  })

  it('caps electronics at four phone guides, each in the page language', () => {
    for (const lang of ['en', 'vi'] as const) {
      const g = guidesForCategory('electronics', lang)
      expect(g).toHaveLength(CATEGORY_GUIDE_LIMIT)
      expect(g.every((x) => x.lang === lang)).toBe(true)
    }
    expect(slugs('electronics', 'en')[0]).toBe('best-place-to-buy-iphone-vietnam')
    expect(slugs('electronics', 'vi')[0]).toBe('mua-iphone-o-dau-uy-tin')
  })

  it('links the eSIM guide from services, where the eSIM plans are listed', () => {
    expect(slugs('services', 'en')).toEqual(['esim-vietnam-guide'])
    expect(slugs('services', 'vi')).toEqual(['esim-viettel-vinaphone-mobifone'])
  })

  it('returns nothing for a category no guide is written for', () => {
    expect(guidesForCategory('vehicles', 'en')).toEqual([])
    expect(guidesForCategory('property', 'vi')).toEqual([])
    expect(guidesForCategory('rentals', 'en', 0)).toEqual([])
  })

  /**
   * ⛔ THE TEACH-IN-VIETNAM LIBRARY ON /c/jobs AND /c/teachers (teacher visibility plan, 2026-10-18): neither linked it.
   * The guides for that page's question — never the hub, which the line under the lede links (TeachGuideLink) — English
   * on both renders (the library is English-only).
   */
  describe('the teacher library on the two teaching categories', () => {
    // The day every registered guide is live (its latest wave or re-approval day): a guide is released only once its
    // review day has come (registry.ts isReleased), so a fixed date broke on the next re-approval (wave 1b, 2026-10-19).
    const LIVE = new Date(`${TEACH_GUIDES.flatMap((e) => [e.published, e.reviewed ?? e.published]).sort().at(-1)}T05:00:00Z`)
    const hrefs = (category: string, lang: 'en' | 'vi', now = LIVE) => guidesForCategory(category, lang, CATEGORY_GUIDE_LIMIT, now).map((g) => g.href)

    it('/c/jobs: finding a job, the requirements, the salary and the work-permit guide', () => {
      expect(hrefs('jobs', 'en')).toEqual([
        teachPath('finding-a-teaching-job-in-vietnam'),
        teachPath('requirements-to-teach-english-in-vietnam'),
        teachPath('english-teacher-salary-in-vietnam'),
        teachPath('vietnam-work-permit-for-english-teachers'),
      ])
    })

    it('/c/teachers: cover lessons, the CV guide, international schools and private tutoring', () => {
      expect(hrefs('teachers', 'en')).toEqual([
        teachPath('cover-lessons-and-substitute-teaching-in-ho-chi-minh-city'),
        teachPath('english-teacher-cv-and-demo-lesson-in-vietnam'),
        teachPath('international-school-jobs-in-vietnam'),
        teachPath('private-tutoring-and-online-teaching-in-vietnam'),
      ])
    })

    it('never the hub — the line under the lede already links it', () => {
      for (const category of ['jobs', 'teachers']) expect(hrefs(category, 'en')).not.toContain(TEACH_BASE)
    })

    it('a Vietnamese page gets the same English guides, marked English', () => {
      for (const category of ['jobs', 'teachers']) {
        expect(hrefs(category, 'vi')).toEqual(hrefs(category, 'en'))
        expect(guidesForCategory(category, 'vi', CATEGORY_GUIDE_LIMIT, LIVE).every((g) => g.lang === 'en')).toBe(true)
      }
    })

    it('each guide carries its registry label and blurb', () => {
      for (const category of ['jobs', 'teachers']) {
        for (const g of guidesForCategory(category, 'en', CATEGORY_GUIDE_LIMIT, LIVE)) {
          const entry = guideEntry(g.href.slice(TEACH_BASE.length + 1))!
          expect([g.label, g.blurb]).toEqual([entry.label, entry.blurb])
        }
      }
    })

    it('links nothing before the library is released', () => {
      expect(hrefs('jobs', 'en', new Date('2026-10-01T05:00:00Z'))).toEqual([])
      expect(hrefs('teachers', 'vi', new Date('2026-10-01T05:00:00Z'))).toEqual([])
    })

    it('every link is a released guide with content, on the guide route', () => {
      expect(existsSync('src/app/[lang]/teach-in-vietnam/[slug]/page.tsx')).toBe(true)
      for (const category of ['jobs', 'teachers']) {
        for (const href of hrefs(category, 'en')) expect(isLiveTeachHref(href, LIVE), href).toBe(true)
      }
    })
  })

  it('carries the guide\'s own label and blurb — link text in the guide\'s language', () => {
    const all = [...MARKETPLACE_GUIDES, ...PHONE_GUIDES]
    for (const cat of ['rentals', 'furniture-appliances', 'electronics', 'services']) {
      for (const lang of ['en', 'vi'] as const) {
        for (const g of guidesForCategory(cat, lang)) {
          const entry = all.find((x) => `/${x.slug}` === g.href)!
          expect(g.label).toBe(entry.label)
          expect(g.blurb).toBe(entry.blurb)
          expect(g.lang).toBe(entry.lang ?? 'en')
        }
      }
    }
  })

  /**
   * ⛔ EVERY LINK MUST BE A MARKETPLACE ROUTE. The block renders on eno.vn; a guide that only exists
   * as a forum `.svc.` page would be a 404 linked from a category hub.
   */
  it('links only guides that exist as a page.tsx on both editions', () => {
    for (const cat of ['rentals', 'furniture-appliances', 'electronics', 'services']) {
      for (const lang of ['en', 'vi'] as const) {
        for (const g of guidesForCategory(cat, lang)) {
          expect(existsSync(`src/app/[lang]${g.href}/page.tsx`), `${g.href} has no page.tsx`).toBe(true)
        }
      }
    }
  })
})
