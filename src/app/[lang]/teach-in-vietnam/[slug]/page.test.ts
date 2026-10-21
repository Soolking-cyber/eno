import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEACH_GUIDES, isLive, teachPath } from '@/lib/teach-guides/registry'

/**
 * A guide page's robots meta (teacher visibility plan §3a item 16, Google Discover): every live guide allows a large image
 * preview, by the one directive that does (src/lib/teach-guides/robots.ts), and says nothing about index or follow — both
 * stay the default they were with no robots meta. A guide that is not live keeps its noindex 404. The page's chrome and
 * renderer are stand-ins; the registry and the guides are the real ones.
 */
const h = vi.hoisted(() => ({
  now: new Date('2026-10-18T05:00:00Z'),
  /** What districtLinksAsText answers, and the guides it was asked about. */
  empty: new Set<string>(),
  asked: [] as unknown[],
  /** The in-text link rule the page hands the guide body. */
  isLiveHref: null as ((href: string) => boolean) | null,
}))
vi.mock('@/lib/teach-guides/request-clock', () => ({ requestNow: () => h.now }))
vi.mock('@/lib/teach-guides/district-links', () => ({
  districtLinksAsText: async (g: unknown) => {
    h.asked.push(g)
    return h.empty
  },
}))
vi.mock('@/components/marketplace/seo-article', () => ({ SeoArticle: () => null }))
vi.mock('@/components/marketplace/teach-guide-body', () => ({
  TeachKeyPoints: () => null,
  TeachDataLink: () => null,
  TeachNextStep: () => null,
  teachGuideSections: (_g: unknown, isLiveHref: (href: string) => boolean) => {
    h.isLiveHref = isLiveHref
    return []
  },
}))

// The day every registered guide is live — the latest wave or re-approval day, as hub-page.test.tsx computes it.
const LIVE = new Date(`${TEACH_GUIDES.flatMap((e) => [e.published, e.reviewed ?? e.published]).sort().at(-1)}T05:00:00Z`)
// Before the first wave: no guide is live.
const BEFORE = new Date('2026-10-01T05:00:00Z')

// The first import pulls the registry and all 41 guides' content (parsed and digest-checked at load) — slow cold.
vi.setConfig({ testTimeout: 30_000 })

type Page = typeof import('./page')
let page: Page

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.resetModules()
  page = await import('./page')
})
// The edition is read once, at import; give the worker its environment back for the next file.
afterAll(() => {
  vi.unstubAllEnvs()
})

function metadata(slug: string, now: Date, lang = 'en') {
  h.now = now
  return page.generateMetadata({ params: Promise.resolve({ lang, slug }) })
}

describe('a guide page’s robots meta: max-image-preview:large, index and follow as they were', () => {
  it('every live guide allows a large image preview and states nothing else', async () => {
    const live = TEACH_GUIDES.filter((e) => isLive(e, LIVE))
    expect(live).toHaveLength(TEACH_GUIDES.length)
    for (const e of live) {
      const m = await metadata(e.slug, LIVE)
      expect(m.robots, e.slug).toEqual({ 'max-image-preview': 'large' })
      expect(m.alternates?.canonical, e.slug).toBe(teachPath(e.slug))
    }
  })

  it('the Vietnamese render carries the same metadata as the English one', async () => {
    const slug = TEACH_GUIDES[0].slug
    expect(await metadata(slug, LIVE, 'vi')).toEqual(await metadata(slug, LIVE, 'en'))
  })

  it('a guide before its release day, and a slug that is no guide, stay noindex 404s', async () => {
    expect((await metadata(TEACH_GUIDES[0].slug, BEFORE)).robots).toEqual({ index: false })
    expect((await metadata('no-such-guide', LIVE)).robots).toEqual({ index: false })
  })
})

describe('in-text district links: only while the district page is at the indexing floor', () => {
  it('a district it answers renders as text, fragment or not; another district, a site page and a live guide stay links', async () => {
    h.now = LIVE
    h.empty = new Set(['/c/rentals/d2'])
    h.asked = []
    const slug = TEACH_GUIDES[0].slug
    await page.default({ params: Promise.resolve({ lang: 'en', slug }) })
    expect(h.asked).toHaveLength(1)
    const live = h.isLiveHref!
    expect([live('/c/rentals/d2'), live('/c/rentals/d2#rent')]).toEqual([false, false])
    expect([live('/c/rentals/d1'), live('/schools'), live(teachPath(TEACH_GUIDES[1].slug))]).toEqual([true, true, true])
  })
})

/**
 * The "Data" line (2026-10-21): the two guides the HCMC Teacher Cost & Pay Index restates — the salary guide's take-home
 * table, the cost-of-living guide's rents — link it under their key points; no other guide does. Component code only: the
 * guides' JSON, and so their review digests, are untouched.
 */
describe('the "Data" line under the key points', () => {
  type Lede = { props: { content: { ledeRow: { props: { children: unknown } } } } }
  const dataLinks = async (slug: string) => {
    h.now = LIVE
    const el = (await page.default({ params: Promise.resolve({ lang: 'en', slug }) })) as unknown as Lede
    return ([el.props.content.ledeRow.props.children].flat(2) as ({ props?: { href?: string; label?: string } } | false)[])
      .filter((k): k is { props: { href: string; label: string } } => !!k && k.props?.href === '/hcmc-teacher-cost-pay-index')
      .map((k) => k.props.label)
  }
  const D1_GUIDES = ['english-teacher-salary-in-vietnam', 'cost-of-living-in-ho-chi-minh-city-for-teachers']

  it.each(D1_GUIDES)('%s links the index, by its own name', async (slug) => {
    expect(await dataLinks(slug)).toEqual(['HCMC Teacher Cost & Pay Index'])
  })

  it('no other guide carries it', async () => {
    for (const e of TEACH_GUIDES.filter((g) => !D1_GUIDES.includes(g.slug))) expect(await dataLinks(e.slug), e.slug).toEqual([])
  })
})

describe('no layout above these pages sets robots', () => {
  // Next REPLACES a parent segment's `robots` with the page's own (it does not merge them), so a sitewide robots value
  // added to a layout later — a noindex for a preview host, a googleBot block — would silently skip the hub and every
  // guide, which set TEACH_ROBOTS. Today no layout sets one; this fails first if one does (in any segment above these
  // pages, a layout added later included), so the two get merged. A robots value built in a helper the layout imports
  // is beyond a source check; the root layout's metadata is a literal object today.
  const app = fileURLToPath(new URL('../../../', import.meta.url))
  const layouts = ['', '[lang]/', '[lang]/teach-in-vietnam/', '[lang]/teach-in-vietnam/[slug]/']
    .flatMap((dir) => ['tsx', 'ts', 'jsx', 'js'].map((ext) => `${app}${dir}layout.${ext}`))
    .filter((f) => existsSync(f))
  it('the layouts above the hub and the guides are found', () => {
    expect(layouts.map((f) => f.slice(app.length))).toEqual(['[lang]/layout.tsx'])
  })
  it.each(layouts.map((f) => [f.slice(app.length), f]))('%s sets no robots', (_, file) => {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    expect(code).not.toMatch(/\brobots\b/)
  })
})
