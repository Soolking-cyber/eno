// @vitest-environment jsdom
/**
 * Teacher visibility plan §3a item 9, "mark the English guides English for every visitor": an article that declares its
 * language at a URL that is not language-pinned (lang-pinned.ts FIXED_LANG) — the teach-in-vietnam hub and guides —
 * renders under the VISITOR's `<html lang>`, so it marks its own text with its language (seo-article.tsx ArticleText).
 * The listing rail and CrossSitePromo, written in the visitor's language, stay outside; a pinned guide and an article
 * with no declared language render exactly as before.
 *
 * The chrome, the related-guides picker and the database-backed rail are stand-ins (as in seo-article.cta.test.tsx).
 * The last two tests hand SeoArticle what the REAL hub and a real guide page give it, with their data reads replaced.
 */
import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ArticleContent } from './seo-article'

const h = vi.hoisted(() => ({
  /** The teach pages' request clock — moved to the day every guide is live once the registry is loaded. */
  now: new Date('2026-10-18T05:00:00Z'),
  /** What the chrome, CrossSitePromo and the rail print on a Vietnamese render: the VISITOR's words, not the article's. */
  vi: { header: 'Đăng tin miễn phí', footer: 'Điều khoản', promo: 'Bạn đã ở Việt Nam?', price: 'Lương: xem chi tiết' },
}))
vi.mock('./header', () => ({ Header: () => <header>{h.vi.header}</header> }))
vi.mock('./footer', () => ({ Footer: () => <footer>{h.vi.footer}</footer> }))
vi.mock('@/components/marketplace/cross-site-promo', () => ({ CrossSitePromo: () => <aside data-promo="">{h.vi.promo}</aside> }))
vi.mock('./seo-article-related', () => ({ keepReading: (related?: unknown[]) => related ?? [] }))
// The real rail prints its prices in the visitor's language (price.tsx): a Vietnamese render's job card says this.
// Its heading and browse link are the article's words: the real grid marks them with the `lang` it is handed
// (seo-listing-rail.browse-link.test.tsx pins that markup), so the stand-in does the same.
vi.mock('./seo-listing-rail', () => ({
  SeoListingRail: ({ title, cta, lang }: { title: string; cta: string; lang?: 'en' | 'vi' }) => (
    <section data-rail="">
      <h2 lang={lang}>{title}</h2>
      <p>{h.vi.price}</p>
      <a href="/c/jobs" lang={lang}>{cta}</a>
    </section>
  ),
}))
// HereLink localises its href through the language context; a plain anchor here, as in hub-page.test.tsx.
vi.mock('./here-link', () => ({ HereLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }))
// The real pages' clock and data reads (hub-page.test.tsx replaces the same ones).
vi.mock('@/lib/teach-guides/request-clock', () => ({ requestNow: () => h.now }))
// The guide page counts the district pages a guide links (district-links.ts): no database here, every link kept.
vi.mock('@/lib/teach-guides/district-links', () => ({ districtLinksAsText: async () => new Set<string>() }))
vi.mock('@/components/marketplace/live-count', () => ({
  LiveCounts: ({ children }: { children: (f: Record<string, { n: number; count: string; allInside: boolean } | null>) => ReactNode }) =>
    children({ jobs: { n: 38, count: '38', allInside: false } }),
}))
vi.mock('@/lib/schools/queries', () => ({ listSchools: async () => [{ kind: 'language_centre' }, { kind: 'international_school' }] }))
vi.mock('@/app/[lang]/hcmc-rent-index/load-rent-index', () => ({ loadRentIndex: async () => ({ known: false }) }))

// The first import of a teach page pulls the registry and all 41 guides' content (parsed and digest-checked) — slow cold.
vi.setConfig({ testTimeout: 30_000 })

let SeoArticle: typeof import('./seo-article').SeoArticle
let hubPage: typeof import('@/app/[lang]/teach-in-vietnam/page')
let guidePage: typeof import('@/app/[lang]/teach-in-vietnam/[slug]/page')
let TEACH_GUIDES: typeof import('@/lib/teach-guides/registry').TEACH_GUIDES

beforeAll(async () => {
  // A marketplace page, as the teach library only is (eno.forum 308s it to eno.vn — next.config.ts).
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.resetModules()
  ;({ SeoArticle } = await import('./seo-article'))
  hubPage = await import('@/app/[lang]/teach-in-vietnam/page')
  guidePage = await import('@/app/[lang]/teach-in-vietnam/[slug]/page')
  ;({ TEACH_GUIDES } = await import('@/lib/teach-guides/registry'))
  // The day every registered guide is live (as hub-page.test.tsx computes it).
  h.now = new Date(`${TEACH_GUIDES.flatMap((e) => [e.published, e.reviewed ?? e.published]).sort().at(-1)}T05:00:00Z`)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
const render = async (content: ArticleContent) => parse(renderToStaticMarkup(await SeoArticle({ content })))
/**
 * The language a piece of visible text is marked with: its nearest `lang`, or null — the page's own `<html lang>`. The
 * JSON-LD repeats the headline, the lede and the FAQ, so a script's text is not the page's.
 */
function langOf(doc: Document, text: string): string | null {
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement!
    if (el.tagName !== 'SCRIPT' && n.textContent?.includes(text)) return el.closest('[lang]')?.getAttribute('lang') ?? null
  }
  throw new Error(`no text "${text}" on the page`)
}
/** Every element carrying a `lang`, as tag + value. */
const langs = (doc: Document) => [...doc.querySelectorAll('[lang]')].map((e) => `${e.tagName.toLowerCase()}:${e.getAttribute('lang')}`)

const LEDE_ROW = 'Key points box'
const NEXT_STEP = 'Your next step on eno.vn'
/** An English article with every part SeoArticle renders, at a teach guide's URL. */
const GUIDE: ArticleContent = {
  eyebrow: 'Teach in Vietnam',
  h1: 'A guide heading',
  intro: 'The lede paragraph.',
  canonical: '/teach-in-vietnam/a-guide',
  published: '2026-10-11',
  lang: 'en',
  breadcrumb: [
    { label: 'Home', href: '/' },
    { label: 'Teach in Vietnam', href: '/teach-in-vietnam' },
    { label: 'A guide', href: '/teach-in-vietnam/a-guide' },
  ],
  ledeRow: <section>{LEDE_ROW}</section>,
  cta: { href: 'https://teacher.eno.vn', label: 'Make a free teacher profile', repeatAtEnd: true },
  sections: ['one', 'two', 'three', 'four'].map((id) => ({ id, title: `Section ${id}`, body: createElement('p', null, `Body of ${id}`) })),
  rail: { target: { categorySlug: 'jobs', subcategoryIn: ['teaching'], order: 'recent' }, title: 'Teaching jobs now', cta: 'Browse jobs' },
  afterSections: <aside>{NEXT_STEP}</aside>,
  related: [{ href: '/teach-in-vietnam/another-guide', label: 'Another guide', blurb: 'What it answers.' }],
  faqs: [{ q: 'A question here?', a: 'An answer that is long enough.' }],
}
/** The article's own words: breadcrumb, eyebrow, H1, date line, lede, lede row, CTA, contents, sections, next step,
 * Keep reading, FAQ, affiliation line and "Published by". */
const OWN_TEXT = [
  'Home', 'Teach in Vietnam', 'A guide heading', 'Published', 'The lede paragraph.', LEDE_ROW, 'Make a free teacher profile',
  'On this page', 'Section one', 'Body of four', NEXT_STEP, 'Keep reading', 'Another guide', 'What it answers.',
  'Frequently asked questions', 'A question here?', 'An answer that is long enough.', 'eno.vn and eno.forum', 'Rules, fees and official processes change',
]

describe('an article whose URL negotiates its language marks its own text', () => {
  it('a teach guide: every word the article itself renders is marked English', async () => {
    const doc = await render(GUIDE)
    expect(OWN_TEXT.filter((t) => langOf(doc, t) !== 'en')).toEqual([])
  })

  it('the hub URL too', async () => {
    const doc = await render({ ...GUIDE, canonical: '/teach-in-vietnam', breadcrumb: GUIDE.breadcrumb!.slice(0, 2) })
    expect(OWN_TEXT.filter((t) => t !== 'A guide' && langOf(doc, t) !== 'en')).toEqual([])
  })

  it('the rail and CrossSitePromo stay outside, in the page’s language — their words are the visitor’s', async () => {
    const doc = await render({ ...GUIDE, crossSitePromo: true })
    expect(langOf(doc, h.vi.price)).toBeNull()
    expect(langOf(doc, h.vi.promo)).toBeNull()
    // …but the rail's heading and browse link are the article's English words, and are marked as such.
    expect([langOf(doc, 'Teaching jobs now'), langOf(doc, 'Browse jobs')]).toEqual(['en', 'en'])
    // …as are the header and footer, outside <main>.
    expect(langOf(doc, h.vi.header)).toBeNull()
    expect(langOf(doc, h.vi.footer)).toBeNull()
    // And the article around them is still marked, the published-by line after the promo included.
    expect(['Body of four', 'A question here?', 'Rules, fees and official processes change'].map((t) => langOf(doc, t))).toEqual(['en', 'en', 'en'])
  })

  it('a Vietnamese article at an unpinned URL is marked Vietnamese, the same way', async () => {
    const doc = await render({ ...GUIDE, canonical: '/mot-bai-viet-thu', lang: 'vi', h1: 'Một tiêu đề' })
    expect(langOf(doc, 'Một tiêu đề')).toBe('vi')
    expect(langOf(doc, 'Body of four')).toBe('vi')
  })

  it('the marks are plain wrappers and the only change: unwrapped, the markup is the article’s without a declared language', async () => {
    const marked = await render(GUIDE)
    const main = marked.querySelector('main')!
    const wrappers = [...main.children].filter((e) => e.hasAttribute('lang'))
    expect(wrappers.map((e) => [e.tagName, e.attributes.length])).toEqual([['DIV', 1], ['DIV', 1], ['DIV', 1]])
    for (const w of wrappers) w.replaceWith(...w.childNodes)
    // The rail's own heading and browse link carry the mark too, and nothing else in it does.
    const railMarks = [...main.querySelectorAll('[data-rail] [lang]')]
    expect(railMarks.map((e) => `${e.tagName}:${e.getAttribute('lang')}`)).toEqual(['H2:en', 'A:en'])
    for (const e of railMarks) e.removeAttribute('lang')
    // No declared language: articleLang is still 'en' (the default), so the chrome and the date line are the same.
    const plain = (await render({ ...GUIDE, lang: undefined })).querySelector('main')!
    expect(main.outerHTML).toBe(plain.outerHTML)
  })
})

describe('a pinned URL, or an article with no declared language, renders as before', () => {
  it.each([
    ['an English guide pinned to English', '/secondhand-furniture-ho-chi-minh-city', 'en'],
    ['a Vietnamese guide pinned to Vietnamese', '/thanh-ly-do-gia-dung-cu-tphcm', 'vi'],
    ['an article with no declared language', '/furnishing-a-home-in-vietnam', undefined],
  ] as const)('%s: only the date line carries a lang, as it always has', async (_, canonical, lang) => {
    const doc = await render({ ...GUIDE, canonical, lang })
    expect(langs(doc)).toEqual([`p:${lang ?? 'en'}`])
  })
})

describe('the real teach pages hand SeoArticle what it marks', () => {
  it('the hub: its lede, facts box, short answers, guide list and closing note are marked English', async () => {
    const el = (await hubPage.default()) as ReactElement<{ content: ArticleContent }>
    const doc = await render(el.props.content)
    const own = [
      'Teaching English in Vietnam: what you need', 'To teach English legally in Vietnam', 'Saigon for teachers, today', 'Who can teach English in Vietnam?',
      'Make a free teacher profile', TEACH_GUIDES[0].label, TEACH_GUIDES[0].blurb, 'How these guides are made',
    ]
    for (const t of own) expect(langOf(doc, t), t).toBe('en')
  })

  it('a guide with a jobs rail, on a Vietnamese render: key points, sections, sources, next step and FAQ are English; the rail is not marked', async () => {
    const slug = 'finding-a-teaching-job-in-vietnam'
    const entry = TEACH_GUIDES.find((e) => e.slug === slug)!
    expect(entry.rail).toBe('jobs')
    const el = (await guidePage.default({ params: Promise.resolve({ lang: 'vi', slug }) })) as ReactElement<{ content: ArticleContent }>
    const { content } = el.props
    expect(content.faqs.length).toBeGreaterThan(0)
    const doc = await render(content)
    for (const t of [content.h1, content.intro, 'Key points', content.sections[0].title, 'Sources', 'Your next step on eno.vn', content.faqs[0].q])
      expect(langOf(doc, t), t).toBe('en')
    expect(langOf(doc, h.vi.price)).toBeNull()
  })
})
