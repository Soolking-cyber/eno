import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { isNoindex, langAlternatesFor } from './lang-alternates'
import { hasViTwin, langAlternates, VI_PILOT_MARKETPLACE, type ViPilot } from './lang-pinned'

// vitest runs as the services edition (vitest.config.ts), where VI_PILOT is empty: pass the marketplace's lists.
const MARKET = VI_PILOT_MARKETPLACE
const OFF: ViPilot = { live: [], retired: [], families: [], retiredFamilies: [] }
const NOINDEX = { index: false, follow: true }

describe('langAlternatesFor — the head of a page with a /vi twin', () => {
  it('a family path: plain for en and x-default, /vi for vi-VN; the canonical follows the language rendered', () => {
    const triple = { en: '/c/rentals', 'vi-VN': '/vi/c/rentals', 'x-default': '/c/rentals' }
    expect(langAlternatesFor('/c/rentals', 'en', undefined, '', MARKET)).toEqual({ canonical: '/c/rentals', languages: triple })
    expect(langAlternatesFor('/c/rentals', 'vi', undefined, '', MARKET)).toEqual({ canonical: '/vi/c/rentals', languages: triple })
    // anything but 'vi' is the English render (the nine MT languages get the en variant)
    expect(langAlternatesFor('/c/rentals', 'ko', undefined, '', MARKET)?.canonical).toBe('/c/rentals')
  })

  it('every phase-1 family, absolute with an origin (a trailing slash on it is dropped)', () => {
    for (const p of ['/c/rentals/thao-dien', '/help', '/help/cm1abc2def', '/schools', '/schools/ila-vietnam', '/schools/awards', '/schools/awards/2026']) {
      expect(langAlternatesFor(p, 'vi', null, 'https://eno.vn/', MARKET), p).toEqual({
        canonical: `https://eno.vn/vi${p}`,
        languages: { en: `https://eno.vn${p}`, 'vi-VN': `https://eno.vn/vi${p}`, 'x-default': `https://eno.vn${p}` },
      })
    }
  })

  it('⛔ the two pilot pages keep exactly the head they had (lang-pinned langAlternates), on both variants', () => {
    for (const p of ['/', '/c/furniture-appliances']) {
      for (const lang of ['en', 'vi']) {
        expect(langAlternatesFor(p, lang, undefined, 'https://eno.vn', MARKET), `${p} ${lang}`).toEqual(langAlternates(p, lang, 'https://eno.vn', MARKET))
      }
    }
    expect(langAlternatesFor('/', 'vi', undefined, 'https://eno.vn', MARKET)).toEqual({
      canonical: 'https://eno.vn/vi',
      languages: { en: 'https://eno.vn/', 'vi-VN': 'https://eno.vn/vi', 'x-default': 'https://eno.vn/' },
    })
  })

  it('⛔ a noindex page advertises no twin (critic #3), in any spelling of noindex', () => {
    for (const robots of [NOINDEX, { index: false }, 'noindex, follow', 'NOINDEX', 'none']) {
      expect(langAlternatesFor('/c/rentals', 'vi', robots, 'https://eno.vn', MARKET), String(robots)).toBeNull()
      expect(langAlternatesFor('/c/furniture-appliances', 'en', robots, 'https://eno.vn', MARKET), String(robots)).toBeNull()
    }
    // index: true, follow-only strings and no robots at all are indexable
    for (const robots of [undefined, null, { index: true }, { follow: false }, 'index, follow', 'nofollow']) {
      expect(langAlternatesFor('/c/rentals', 'vi', robots, '', MARKET), String(robots)).not.toBeNull()
    }
  })

  it('a path without a twin gets nothing: app and form pages, listings, sellers, guides, a /vi path, a query', () => {
    for (const p of ['/c', '/c/rentals/thao-dien/x', '/schools/suggest', '/schools/ila/review', '/help/x/y', '/listings/abc', '/sellers/abc',
      '/post', '/dashboard', '/thue-xe-may-tphcm', '/guides', '/vi/c/rentals', '/vi', '/c/rentals?page=2', '/c/Rentals', '/schools/awards/26']) {
      expect(langAlternatesFor(p, 'vi', undefined, 'https://eno.vn', MARKET), p).toBeNull()
    }
  })

  it('eno.forum (empty lists) and this build\'s default lists in the suite (services): nothing', () => {
    expect(langAlternatesFor('/c/rentals', 'vi', undefined, 'https://eno.vn', OFF)).toBeNull()
    expect(langAlternatesFor('/', 'vi', undefined, 'https://eno.vn', OFF)).toBeNull()
    expect(langAlternatesFor('/c/rentals', 'vi', undefined, 'https://eno.vn')).toBeNull()
  })

  it('isNoindex reads the page\'s own robots value', () => {
    expect(isNoindex(undefined)).toBe(false)
    expect(isNoindex(null)).toBe(false)
    expect(isNoindex({ index: false, follow: true })).toBe(true)
    expect(isNoindex({ index: true })).toBe(false)
    expect(isNoindex('noindex,follow')).toBe(true)
    expect(isNoindex('index, nofollow')).toBe(false)
  })
})

/**
 * ⛔ EVERY PAGE IN A `/vi` FAMILY BUILDS ITS HEAD WITH langAlternatesFor, AND NO OTHER PAGE IN THOSE TREES DOES. Walks
 * the real route tree (src/app/[lang]/c, help, schools): each `page.tsx` is turned into a sample public path (route
 * groups dropped, `[year]` → a year, any other `[param]` → a slug) and asked `hasViTwin` with the marketplace's lists.
 * A twin page must call the helper with the robots it emits (`meta.robots` / `METADATA.robots`) — or be a redirect
 * with no head, listed below; a page with no twin (the suggest form, a review form) must never call it.
 */
const APP = join(process.cwd(), 'src/app/[lang]')
const pages = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const f = join(dir, n)
    return statSync(f).isDirectory() ? pages(f) : /^page(?:\.[a-z.]+)?\.tsx$/.test(n) ? [f] : []
  })
const samplePath = (file: string) =>
  '/' + relative(APP, file).split('/').slice(0, -1).filter((s) => !/^\(.*\)$/.test(s))
    .map((s) => (s === '[year]' ? '2026' : /^\[.+\]$/.test(s) ? 'sample-1' : s)).join('/')

/** Twin routes that render no head of their own: they redirect, in the reader's language (vi-family-redirects.test.ts). */
const REDIRECT_ONLY: Record<string, string> = {
  'schools/awards/page.tsx': "redirects to the open year's page through localizedHref; no metadata",
}

describe('the /vi families: every page calls langAlternatesFor (route-tree guard)', () => {
  const files = ['c', 'help', 'schools'].flatMap((d) => pages(join(APP, d)))
  const rel = (f: string) => relative(APP, f)
  const twins = files.filter((f) => hasViTwin(samplePath(f), MARKET))

  it('the route tree has the twin pages phase 1 names, and the app/form pages are not among them', () => {
    expect(twins.map(rel).sort()).toEqual([
      'c/[category]/(index)/page.tsx',
      'c/[category]/[district]/page.tsx',
      'help/[id]/page.tsx',
      'help/page.tsx',
      'schools/[slug]/page.tsx',
      'schools/awards/[year]/page.tsx',
      'schools/awards/page.tsx',
      'schools/page.tsx',
    ])
    expect(files.filter((f) => !twins.includes(f)).map(rel).sort()).toEqual(['schools/[slug]/review/page.tsx', 'schools/suggest/page.tsx'])
  })

  it.each(twins.map(rel))('%s builds its head with langAlternatesFor and the robots it emits', (file) => {
    const s = readFileSync(join(APP, file), 'utf8')
    if (REDIRECT_ONLY[file]) {
      expect(s, file).not.toMatch(/export (?:const metadata|async function generateMetadata)\b/)
      expect(s, file).not.toMatch(/langAlternatesFor\(/)
      return
    }
    expect(s, file).toMatch(/import \{ langAlternatesFor \} from '@\/lib\/lang-alternates'/)
    const calls = [...s.matchAll(/langAlternatesFor\(([^\n]*)\)/g)].map((m) => m[1])
    expect(calls, file).toHaveLength(1)
    expect(calls[0], file).toMatch(/,\s*(?:meta|METADATA)\.robots\b/)
    // hreflang comes from the helper only: no hand-written `languages:` beside it
    expect(s, file).not.toMatch(/\blanguages:/)
  })

  it('the pages with no twin never call it', () => {
    for (const f of files.filter((x) => !twins.includes(x))) expect(readFileSync(f, 'utf8'), rel(f)).not.toMatch(/langAlternatesFor\(/)
  })

  it('both pilot paths go through it too: `/` (home-metadata.ts) and `/c/furniture-appliances` (the category page)', () => {
    expect([...MARKET.live].sort()).toEqual(['/', '/c/furniture-appliances'])
    const home = readFileSync(join(APP, '(home)/home-metadata.ts'), 'utf8')
    expect(home).not.toMatch(/\blangAlternates\(/)
    expect(home.match(/langAlternatesFor\('\/', lang, undefined, /g)).toHaveLength(2) // the head and the WebPage JSON-LD url
    expect(hasViTwin(samplePath(join(APP, 'c/[category]/(index)/page.tsx')), MARKET)).toBe(true)
  })
})
