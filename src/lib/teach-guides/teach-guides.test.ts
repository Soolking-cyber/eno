import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { forEachInline, forEachPlain, teachGuideSchema, type TeachGuide } from './schema'
import { checkSourceUrl, inlineHrefs, inlineText, parseInline } from './inline'
import {
  TEACH_GUIDES,
  TEACH_HUB_UPDATED,
  TEACH_SITE_PATHS,
  TEACH_START_PATHS,
  guideDates,
  hubNewest,
  isLive,
  isLiveTeachHref,
  isReleased,
  releaseDate,
  TEACH_BASE,
  teachGuideDates,
  teachHubNewest,
} from './registry'
import { contentSlugs, renderIndex } from '../../../scripts/gen-teach-guides.mjs'
import { contentDigest } from './digest'
import { TEACH_CONTENT } from './content.generated'
import { isRetiredNavCategory } from '@/lib/retired-categories'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { canonicalDistrictSlug, isCuratedDistrict } from '@/lib/district-canonical'
import { EDITION_BANNED, visibleCodeText } from '@/test/edition-words'

/**
 * THE GUARDS ON THE TEACH-IN-VIETNAM LIBRARY. The guides are generated text checked against a fact base;
 * these are the properties no review should have to re-check by eye, on every guide, every time.
 */

const DIR = 'src/content/teach-in-vietnam'
const raw = (slug: string) => readFileSync(join(DIR, `${slug}.json`), 'utf8')
const guides: TeachGuide[] = contentSlugs().map((s: string) => teachGuideSchema.parse(JSON.parse(raw(s))))

/** Every inline string in a guide, with where it is — the same walk the schema validates (schema.ts). */
function inlineStrings(g: TeachGuide): { where: string; src: string }[] {
  const out: { where: string; src: string }[] = []
  forEachInline(g, (src, path) => out.push({ where: path.join('.'), src }))
  return out
}
/** Every reader-visible plain string (headings, FAQ, intro…). */
function plainStrings(g: TeachGuide): string[] {
  const out: string[] = []
  forEachPlain(g, (text) => out.push(text))
  return out
}
/** Every string value in a parsed JSON document — the vocabulary guard reads text, not escapes. */
const allStrings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(allStrings) : v && typeof v === 'object' ? Object.values(v).flatMap(allStrings) : []

describe('teach guides: the library is whole', () => {
  it('has guides (the guards below are not vacuous)', () => {
    expect(guides.length).toBeGreaterThan(0)
    expect(TEACH_GUIDES.length).toBe(guides.length)
  })

  it('content.generated.ts matches the content directory (run scripts/gen-teach-guides.mjs)', () => {
    expect(readFileSync('src/lib/teach-guides/content.generated.ts', 'utf8')).toBe(renderIndex(contentSlugs()))
  })

  it('registry and content are one-to-one', () => {
    const files = new Set<string>(contentSlugs())
    const reg = new Set(TEACH_GUIDES.map((e) => e.slug))
    expect([...reg].filter((s) => !files.has(s))).toEqual([])
    expect([...files].filter((s) => !reg.has(s))).toEqual([])
    expect(reg.size).toBe(TEACH_GUIDES.length)
  })

  it('every related slug is in the registry', () => {
    const reg = new Set(TEACH_GUIDES.map((e) => e.slug))
    for (const g of guides) expect(g.related.filter((s) => !reg.has(s)), g.slug).toEqual([])
  })

  it('titles, descriptions and h1s are unique across the library', () => {
    for (const key of ['title', 'description', 'h1'] as const) {
      const seen = new Map<string, string>()
      for (const g of guides) {
        const v = g[key].toLowerCase()
        expect(seen.get(v), `${key} of ${g.slug} repeats ${seen.get(v)}`).toBeUndefined()
        seen.set(v, g.slug)
      }
    }
  })

  it('no paragraph is copied between guides (boilerplate reads as scaled content)', () => {
    const seen = new Map<string, string>()
    for (const g of guides)
      for (const s of g.sections)
        for (const b of s.blocks)
          if (b.type === 'p' && b.text.length > 120) {
            const k = b.text.toLowerCase().replace(/\s+/g, ' ')
            const prev = seen.get(k)
            expect(prev === undefined || prev === g.slug, `paragraph in ${g.slug} repeats ${prev}: ${b.text.slice(0, 80)}…`).toBe(true)
            seen.set(k, g.slug)
          }
  })
})

describe('teach guides: the edition rule (no visa / itinerary / PayPal / permission-to-stay vocabulary)', () => {
  // Code files are read with the TypeScript parser (visibleCodeText): every string and JSX text is scanned, and the
  // comments that explain this rule — and so name the words — are not text at all.
  // ⛔ These pages compile on the licensed marketplace. See registry.ts and CLAUDE.md (the edition split).
  // Multi-word terms match across any run of whitespace (a wrapped JSX line, a double or non-breaking space).
  // The rule itself lives in src/test/edition-words.ts (EDITION_BANNED), one copy for every test that reads eno.vn copy.
  const BANNED = EDITION_BANNED
  it('registry.ts carries none of it — nor passport / VietKite / hộ chiếu (expat-guides.test.ts registry rule)', () => {
    const text = visibleCodeText('src/lib/teach-guides/registry.ts')
    expect(text.match(BANNED)).toBeNull()
    expect(text.match(/passport|VietKite|hộ chiếu/i)).toBeNull()
  })
  // The hub and the renderer are exempt from the i18n rule (eslint.config.mjs) and the route builds English chrome
  // too, so their own English prose is checked here as well.
  it.each(['src/app/[lang]/teach-in-vietnam/page.tsx', 'src/app/[lang]/teach-in-vietnam/[slug]/page.tsx', 'src/components/marketplace/teach-guide-body.tsx'])(
    '%s carries none of it',
    (file) => {
      expect(visibleCodeText(file).match(BANNED)).toBeNull()
    },
  )
  it.each(contentSlugs() as string[])('%s carries none of it', (slug) => {
    // The PARSED strings, not the file: "\u0074ạm trú" in the JSON is "tạm trú" on the page.
    expect(allStrings(JSON.parse(raw(slug))).filter((t) => BANNED.test(t))).toEqual([])
    expect(raw(slug).match(BANNED)).toBeNull()
  })
  it('the code reader sees strings and JSX text, never comments — whatever slashes they contain', () => {
    // A unique temp directory, never the source tree: a killed run leaves nothing behind in src/.
    const dir = mkdtempSync(join(tmpdir(), 'teach-visible-text-'))
    const tmp = join(dir, 'probe.tsx')
    writeFileSync(tmp, "// visa in a comment\n/* paypal */\nconst a = 'https://x.example//visa'\nconst b = 'glob/*'\nconst c = <p>see */ evisa and t&#7841;m&nbsp;trú</p>\nconst d = <PayPalButton />\n")
    try {
      const t = visibleCodeText(tmp)
      expect(t).toContain('https://x.example//visa')
      expect(t).toContain('evisa')
      expect(t).toContain('tạm trú')
      expect(t).toContain('PayPalButton')
      expect(t).not.toContain('in a comment')
      expect(t).not.toMatch(/^paypal$/m)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('registry labels and blurbs carry none of it', () => {
    expect(TEACH_GUIDES.flatMap((e) => [e.label, e.blurb]).filter((t) => BANNED.test(t))).toEqual([])
  })
})

describe('teach guides: the hub states the canonical positions (briefs/STYLE.md ⚖️)', () => {
  /**
   * The work permit's experience test is "at least 2 years" (Decree 219/2025 Art 3(3)(a)), with an alternative proof
   * to ask the employer about in writing — STYLE.md: never "normally". The hub's lead, the paragraph answer engines
   * quote, said "the permit rules normally also ask for two years" until 2026-10-18 (teacher visibility plan B1). The
   * hub is code, so this reads its visible text like the vocabulary rule above: a comment may name the word, a sentence
   * may not. (If the hub ever needs "normally" for something else, narrow this — do not delete it.)
   * hub-page.test.tsx renders the page and checks the lead and the short answers say it as the guides do.
   */
  it('the hub never hedges with "normally"', () => {
    expect(visibleCodeText('src/app/[lang]/teach-in-vietnam/page.tsx').match(/\bnormally\b/i)).toBeNull()
  })
})

describe('teach guides: money', () => {
  /**
   * A hand-typed đồng amount: digits (grouped or "25 million"/"500k") followed by a đồng word or mark,
   * "Vietnamese dong" included — or a mark BEFORE the digits ("VND 500,000", "₫25,000").
   */
  const HAND_TYPED_VND = /\d[\d.,]*\s*(?:k|m|million|mil|tr|triệu|nghìn|thousand)?\s*(?:vietnamese\s+)?(?:đ|₫|vnd|vnđ|dong|đồng)(?![a-z])|(?:\bvn[dđ]|₫)\s?\d/i
  it('the pattern catches every way an amount gets typed', () => {
    for (const t of ['25,000,000 đ', '500k VND', '25 million Vietnamese dong', 'VND 500,000', '₫25,000', '12.000.000đ'])
      expect(HAND_TYPED_VND.test(t), t).toBe(true)
    expect(HAND_TYPED_VND.test('{{vnd:25000000}}'.replace(/\{\{[^}]*\}\}/g, ''))).toBe(false)
  })
  it('registry labels and blurbs carry no hand-typed amount', () => {
    expect(TEACH_GUIDES.flatMap((e) => [e.label, e.blurb]).filter((t) => HAND_TYPED_VND.test(t))).toEqual([])
  })
  it.each(contentSlugs() as string[])('%s prints đồng only through {{vnd:…}} tokens', (slug) => {
    const g = guides.find((x) => x.slug === slug)!
    const texts = [...inlineStrings(g).map((x) => x.src.replace(/\{\{[^}]*\}\}/g, '')), ...plainStrings(g)]
    expect(texts.filter((t) => HAND_TYPED_VND.test(t))).toEqual([])
  })
  it.each(contentSlugs() as string[])('%s never converts đồng into another currency in the same sentence', (slug) => {
    const g = guides.find((x) => x.slug === slug)!
    const bad = inlineStrings(g)
      .flatMap((x) => x.src.split(/(?<=[.!?])\s+/))
      .filter((sentence) => /\{\{vnd:/.test(sentence) && /(?:US\$|\$\s?\d|\bUSD\b|€|£|\bAUD\b|\bGBP\b|\bEUR\b)/.test(sentence))
    expect(bad).toEqual([])
  })
})

describe('teach guides: links', () => {
  const APP = 'src/app/[lang]'
  const teachSlugs = new Set(TEACH_GUIDES.map((e) => e.slug))
  /** An EXACT page: a registry guide, or one of the site paths a guide may link (registry.ts). */
  const resolves = (href: string) => {
    const path = href.split('#')[0]
    if (path.startsWith(`${TEACH_BASE}/`)) return teachSlugs.has(path.slice(TEACH_BASE.length + 1))
    return TEACH_SITE_PATHS.includes(path)
  }
  /** `/c/<category>/<district>`: a category × district page (c/[category]/[district]/page.tsx). */
  const DISTRICT_PAGE = /^\/c\/[^/]+\/[^/]+$/
  /** Where a site path's page lives: route groups, the category route and its district route included. */
  const pageFile = (p: string) =>
    p === '/'
      ? join(APP, '(home)', 'page.tsx')
      : DISTRICT_PAGE.test(p)
        ? join(APP, 'c', '[category]', '[district]', 'page.tsx')
        : p.startsWith('/c/')
          ? join(APP, 'c', '[category]', '(index)', 'page.tsx')
          : join(APP, p, 'page.tsx')
  it('every site path a guide may link is a page on disk, and no category path is a retired one', () => {
    expect(TEACH_SITE_PATHS.filter((p) => !existsSync(pageFile(p)))).toEqual([])
    expect(TEACH_SITE_PATHS.filter((p) => p.startsWith('/c/') && isRetiredNavCategory(p.split('/')[2]))).toEqual([])
    expect(new Set(TEACH_SITE_PATHS).size).toBe(TEACH_SITE_PATHS.length)
  })
  /**
   * The district pages a guide may link (registry.ts TEACH_RENTALS_DISTRICT_PATHS): rentals only, every curated Ho Chi Minh
   * City place, each at the one URL the route answers for it — its own canonical, never a spelling it 308s.
   */
  it('the district pages a guide may link are the rentals pages of the curated places, each at its canonical URL', () => {
    const districtPaths = TEACH_SITE_PATHS.filter((p) => DISTRICT_PAGE.test(p))
    expect(districtPaths.filter((p) => !p.startsWith('/c/rentals/'))).toEqual([])
    const slugs = districtPaths.map((p) => p.slice('/c/rentals/'.length))
    expect(slugs.filter((s) => !isCuratedDistrict(s) || canonicalDistrictSlug(s) !== s)).toEqual([])
    expect([...slugs].sort()).toEqual(DISTRICTS.map((d) => d.slug).filter(isCuratedDistrict).sort())
  })
  it('a guide may link /teachers/cover and a district rentals page — never a spelling that redirects, nor another category', () => {
    for (const ok of ['/teachers/cover', '/c/rentals/d1', '/c/rentals/d2', '/c/rentals/d9', '/c/rentals/thu-duc', '/c/rentals/binh-thanh', '/c/rentals/nha-be'])
      expect(resolves(ok), ok).toBe(true)
    // `quan-2`, `thao-dien` and `district-2` are d2's spellings — a 308 to it, or a 404 with it while it is empty
    // ([district]/page.tsx `resolve`); `all` is the explorer's "every district".
    for (const bad of ['/c/rentals/quan-2', '/c/rentals/thao-dien', '/c/rentals/district-2', '/c/rentals/all', '/c/rentals/cau-giay', '/c/jobs/d1', '/c/teachers/d7'])
      expect(resolves(bad), bad).toBe(false)
  })
  /**
   * eno.vn pages a guide may cite as a SOURCE: the linkable site pages, plus the Rent Index data file — never a district
   * rentals page, which 404s while empty (checkSourceUrl; the Sources list does not go through district-links.ts).
   */
  const SOURCE_PATHS = new Set<string>([...TEACH_SITE_PATHS.filter((p) => !p.startsWith('/c/rentals/')), '/hcmc-rent-index.csv'])
  it('a district rentals page is never a source, though every other rentals page may be', () => {
    for (const bad of ['https://eno.vn/c/rentals/d1', 'https://www.eno.vn/c/rentals/thu-duc#rent'])
      expect(() => checkSourceUrl(bad), bad).toThrow(/district rentals page/)
    for (const ok of ['https://eno.vn/c/rentals', 'https://eno.vn/hcmc-rent-index', 'https://eno.vn/hcmc-rent-index.csv'])
      expect(() => checkSourceUrl(ok), ok).not.toThrow()
  })
  it('the Rent Index data file a guide may cite exists', () => {
    expect(existsSync('src/app/hcmc-rent-index.csv/route.ts')).toBe(true)
  })
  it.each(contentSlugs() as string[])('%s cites eno.vn only through its data pages, never a guide', (slug) => {
    const g = guides.find((x) => x.slug === slug)!
    const own = g.sources.map((s) => new URL(s.url)).filter((u) => /(^|\.)eno\.(vn|forum)$/.test(u.hostname) && !u.hostname.startsWith('teacher.'))
    expect(own.filter((u) => u.hostname.endsWith('eno.forum') || !SOURCE_PATHS.has(u.pathname)).map((u) => u.href)).toEqual([])
  })
  it.each(contentSlugs() as string[])('%s: every internal link resolves; every external one is https', (slug) => {
    const g = guides.find((x) => x.slug === slug)!
    const hrefs = inlineStrings(g).flatMap((x) => inlineHrefs(x.src))
    expect(hrefs.filter((h) => !h.external && !resolves(h.href)).map((h) => h.href)).toEqual([])
    expect(hrefs.filter((h) => h.external && !h.href.startsWith('https://')).map((h) => h.href)).toEqual([])
  })
  it.each(contentSlugs() as string[])('%s: every #anchor into a guide names one of its sections', (slug) => {
    const g = guides.find((x) => x.slug === slug)!
    const sectionIds = (s: string) => new Set([...(guides.find((x) => x.slug === s)?.sections.map((x) => x.id) ?? []), 'sources'])
    const bad = inlineStrings(g)
      .flatMap((x) => inlineHrefs(x.src))
      .filter((h) => !h.external && h.href.startsWith(`${TEACH_BASE}/`) && h.href.includes('#'))
      .filter((h) => {
        const [path, anchor] = h.href.split('#')
        return !sectionIds(path.slice(TEACH_BASE.length + 1)).has(anchor)
      })
      .map((h) => h.href)
    expect(bad).toEqual([])
  })
  it('a link to a guide that is not live is not live; every other site path is', () => {
    expect(isLiveTeachHref(`${TEACH_BASE}/no-such-guide`)).toBe(false)
    expect(isLiveTeachHref('/schools')).toBe(true)
  })
})

describe('teach guides: the release gate', () => {
  const at = (iso: string) => new Date(iso)
  it('opens at 00:00 in Vietnam (UTC+7), not at UTC midnight', () => {
    const e = { published: '2026-10-12', reviewed: '2026-10-10' }
    expect(isReleased(e, at('2026-10-11T16:59:59Z'))).toBe(false) // 23:59:59 on the 11th in Saigon
    expect(isReleased(e, at('2026-10-11T17:00:00Z'))).toBe(true) // 00:00 on the 12th
  })
  it('needs a person\'s review date, and waits for it', () => {
    expect(isReleased({ published: '2026-01-01' }, at('2030-01-01T00:00:00Z'))).toBe(false)
    expect(isReleased({ published: '2026-01-01', reviewed: '2026-11-01' }, at('2026-10-15T00:00:00Z'))).toBe(false)
    expect(isReleased({ published: '2026-01-01', reviewed: '2026-11-01' }, at('2026-11-01T00:00:00Z'))).toBe(true)
  })
  it('dates a guide by the day it actually went live (a late review moves it)', () => {
    expect(releaseDate({ published: '2026-10-12', reviewed: '2026-10-20' })).toBe('2026-10-20')
    expect(releaseDate({ published: '2026-10-12', reviewed: '2026-10-01' })).toBe('2026-10-12')
    for (const e of TEACH_GUIDES) expect(teachGuideDates(e.slug).published, e.slug).toBe(releaseDate(e))
  })
  it('a re-approval after release is an UPDATE: the first-live day stays the publication date (wave 1a, 2026-10-18)', () => {
    const reapproved = { published: '2026-10-11', reviewed: '2026-10-19', released: '2026-10-11' }
    expect(releaseDate(reapproved)).toBe('2026-10-11')
    expect(guideDates(reapproved)).toEqual({ published: '2026-10-11', updated: '2026-10-19' })
    // …and the later of an explicit edit date and the re-approval wins; a guide never re-approved is unchanged.
    expect(guideDates({ ...reapproved, updated: '2026-10-25' })).toEqual({ published: '2026-10-11', updated: '2026-10-25' })
    expect(guideDates({ published: '2026-10-11', reviewed: '2026-10-11' })).toEqual({ published: '2026-10-11' })
    // Without `released`, a late review still moves the publication date (the guide was not live before it).
    expect(guideDates({ published: '2026-10-12', reviewed: '2026-10-20' })).toEqual({ published: '2026-10-20' })
  })
  /**
   * The hub (code, not a registry entry) is dated by the later of its own copy's edit and its newest guide — page.tsx
   * dateModified and title year, pages.xml <lastmod>. On fixture dates, both ways round: in the registry of 2026-10-18
   * the two were the same day (wave 1a re-dated eight guides on the day of the hub's rewrite), and only fixtures can
   * tell max() from either side alone (hub-page.test.tsx and sitemap.test.ts prove the page and the sitemap ask it).
   */
  it('the hub is dated by its newest edit: its own copy or its newest guide, whichever is later (hubNewest)', () => {
    // The hub edited after every guide: its own date.
    expect(hubNewest(['2026-10-11', '2026-10-18'], '2026-11-02')).toBe('2026-11-02')
    // A guide updated after the hub's last edit: that guide's date — wherever it sits in the list.
    expect(hubNewest(['2026-11-20', '2026-10-11'], '2026-11-02')).toBe('2026-11-20')
    expect(hubNewest(['2026-10-11', '2026-11-20'], '2026-11-02')).toBe('2026-11-20')
    expect(hubNewest([], '2026-10-18')).toBe('2026-10-18')
  })
  it('teachHubNewest applies it to the guides as their own pages date them, against TEACH_HUB_UPDATED unless given a date', () => {
    const day = (e: { slug: string }) => {
      const d = teachGuideDates(e.slug)
      return d.updated ?? d.published
    }
    const live = TEACH_GUIDES.slice(0, 5)
    const newestGuide = live.map(day).sort().at(-1)!
    expect(teachHubNewest(live, '2000-01-01')).toBe(newestGuide)
    expect(teachHubNewest(live, '2099-12-31')).toBe('2099-12-31')
    // The default is the hub's own date: seen on the earliest-dated guide (on 2026-10-18, a week older than the hub's).
    const oldest = TEACH_GUIDES.reduce((a, b) => (day(b) < day(a) ? b : a))
    expect(teachHubNewest([oldest])).toBe(hubNewest([day(oldest)], TEACH_HUB_UPDATED))
  })
  it('a recorded first-live day sits between the wave date and the re-approval — never forward- or back-dating', () => {
    for (const e of TEACH_GUIDES.filter((x) => x.released)) {
      expect(e.reviewed, `${e.slug}: released without a review`).toBeDefined()
      expect(e.published <= e.released! && e.released! <= e.reviewed!, `${e.slug}: ${e.published} ≤ ${e.released} ≤ ${e.reviewed}`).toBe(true)
    }
  })
  it('a guide whose content is missing is never live, whatever its dates', () => {
    expect(isLive({ slug: 'no-such-guide', published: '2000-01-01', reviewed: '2000-01-01' })).toBe(false)
  })
  it('every registry date is a real YYYY-MM-DD date (a typo must not release a guide early)', () => {
    for (const e of TEACH_GUIDES)
      for (const d of [e.published, e.reviewed, e.updated, e.released].filter((x): x is string => !!x)) {
        expect(d, e.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10), `${e.slug}: ${d}`).toBe(d)
      }
  })
  it('the content digest is pinned to the value integrate.py computes (Python json.dumps, ensure_ascii=False, no spaces)', () => {
    expect(contentDigest({ title: 'Đà Nẵng’s pay', n: [1, 2], ok: true })).toBe('a02d1671356754be')
  })
  it('every reviewed guide carries the digest of its current content (an edit after review needs a new review)', () => {
    const stale = TEACH_GUIDES.filter((e) => e.reviewed && TEACH_CONTENT[e.slug] !== undefined && e.reviewedDigest !== contentDigest(TEACH_CONTENT[e.slug]))
    expect(stale.map((e) => e.slug)).toEqual([])
  })
  it('the hub\'s "Start here" names registry guides only', () => {
    const reg = new Set(TEACH_GUIDES.map((e) => e.slug))
    expect(TEACH_START_PATHS.flatMap((p) => p.slugs).filter((s) => !reg.has(s))).toEqual([])
  })
})

describe('teach guides: inline grammar', () => {
  it('parses bold, links and money', () => {
    expect(inlineText('Pay is **{{vnd:400000-600000}} an hour** at [centres](/schools).')).toBe('Pay is 400,000–600,000 đ an hour at centres.')
    expect(parseInline('[MOET](https://moet.gov.vn/x)')).toEqual([{ t: 'link', href: 'https://moet.gov.vn/x', label: 'MOET', external: true }])
  })
  it.each([
    '**open', '[text](not-a-url)', '{{usd:5}}', '{{vnd:5,000}}', 'a ] b', '{{vnd:9-3}}',
    // Hrefs a browser could resolve to another origin, or that would skip the release gate.
    '[x](//evil.example)', '[x](/\\evil.example)', '[x](/schools\\x)', '[x](/schools?a=1)', '[x](/Schools)', '[x](/schools/)',
    '[x](https://moet.gov.vn@evil.example)', '[x](https://moet.gov.vn:8443/x)', '[x](https://eno.vn/teach-in-vietnam/x)',
    '[x](https://www.eno.vn/schools)', '[x](https://eno.forum/x)', '[x](javascript:alert(1))', '[x](http://moet.gov.vn)',
    '[x](https://en.wikipedia.org/wiki/A_(b))', '[x](https://visa.eno.forum/x)', '[x](https://schools.eno.vn/teach-in-vietnam/x)',
  ])('throws on %j', (bad) => {
    expect(() => parseInline(bad)).toThrow()
  })
  it.each(['[x](/)', '[x](/teach-in-vietnam/some-guide#pay)', '[x](https://teacher.eno.vn)', '[x](https://moet.gov.vn/a/b?id=3#p)'])('accepts %j', (ok) => {
    expect(() => parseInline(ok)).not.toThrow()
  })
  it('the schema rejects a malformed token, a reserved section id and a duplicate source', () => {
    const base = {
      slug: 'a-guide', title: 'A title that is long enough', description: 'd'.repeat(120), h1: 'A heading here', eyebrow: 'Topic',
      intro: 'i'.repeat(90), keyPoints: ['one point', 'two points', 'three points'],
      sections: ['a', 'b', 'c'].map((id) => ({ id, title: `Section ${id}`, blocks: [{ type: 'p', text: 'Text.' }] })),
      faqs: [], sources: [{ title: 'Decree', publisher: 'Government', url: 'https://vanban.chinhphu.vn/x' }], related: [], lastChecked: '2026-10-11',
    }
    expect(teachGuideSchema.safeParse(base).success).toBe(true)
    expect(teachGuideSchema.safeParse({ ...base, keyPoints: ['ok one', 'ok two', 'bad {{usd:5}}'] }).success).toBe(false)
    expect(teachGuideSchema.safeParse({ ...base, sections: [...base.sections, { id: 'sources', title: 'Sources', blocks: [{ type: 'p', text: 'x.' }] }] }).success).toBe(false)
    expect(teachGuideSchema.safeParse({ ...base, sources: [...base.sources, ...base.sources] }).success).toBe(false)
    expect(teachGuideSchema.safeParse({ ...base, h1: 'A **bold** heading' }).success).toBe(false)
    const src = (url: string) => teachGuideSchema.safeParse({ ...base, sources: [{ title: 'A source', publisher: 'Publisher', url }] }).success
    expect(src('https://eno.vn/hcmc-rent-index')).toBe(true)
    expect(src('https://eno.vn/teach-in-vietnam/a-guide')).toBe(false)
    expect(src('https://www.eno.forum/x')).toBe(false)
    expect(src('https://moet.gov.vn:8443/x')).toBe(false)
    expect(src('https://moet.gov.vn@evil.example/x')).toBe(false)
    expect(src('https://visa.eno.forum/x')).toBe(false)
    expect(src('https://schools.eno.vn/x')).toBe(false)
    expect(src('https://teacher.eno.vn/')).toBe(true)
    expect(teachGuideSchema.safeParse({ ...base, lastChecked: '2026-99-99' }).success).toBe(false)
    expect(teachGuideSchema.safeParse({ ...base, lastChecked: '2026-02-30' }).success).toBe(false)
  })
})
