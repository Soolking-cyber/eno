import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArticleContent } from '@/components/marketplace/seo-article'
import { teachGuideContent } from '@/lib/teach-guides/content'
import { inlineText, moneyText } from '@/lib/teach-guides/inline'
import {
  TEACH_BASE,
  TEACH_GUIDES,
  TEACH_HUB_UPDATED,
  TEACH_SITE_PATHS,
  releasedGuides,
  teachHubNewest,
  vnToday,
} from '@/lib/teach-guides/registry'
import { forEachInline, forEachPlain } from '@/lib/teach-guides/schema'
import { teachHubLink } from '@/lib/teach-guides/site-links'
import { formatArticleDate } from '@/lib/dates'

/**
 * /teach-in-vietnam, THE HUB (teacher visibility plan B1, 2026-10-18): one national page that answers first.
 *
 * These tests render the page and read what it SAYS: the national title, description and H1, the lead's 2-year rule
 * as the library states it (STYLE.md), the hub's own edit date, the facts box, and the six short answers — each dated,
 * each linking the guide it restates, every figure in one a cited guide prints, each canonical position stated
 * whole, no dollar amount beside a đồng one, and nothing on the first screen said twice. The hub is code that no review
 * digest covers (registry.ts, content.ts), so this is what stops a restated figure drifting from the fact-checked
 * guide it came from.
 *
 * The page's chrome and its data are stand-ins: SeoArticle is replaced (the test reads the `content` it is handed),
 * HereLink renders a plain <a>, and the database reads (the school directory, the Rent Index, the live job count)
 * return fixed values. The registry and the guides themselves are the real ones, except that the hub-date rule
 * (registry.ts `teachHubNewest`) can be made to answer a sentinel, to prove the page reads it (the rule itself is
 * unit-tested on fixture dates in teach-guides.test.ts).
 */
const h = vi.hoisted(() => ({
  now: new Date('2026-10-18T05:00:00Z'),
  rent: { known: false } as unknown,
  /** What the hub-date rule answers instead of computing (null = the real rule), and the guides it was last handed. */
  hubNewest: null as string | null,
  hubNewestLive: null as readonly { slug: string }[] | null,
}))

// The real registry, with `teachHubNewest` passing through to the real rule unless `h.hubNewest` is set, and noting the
// guides the page hands it.
vi.mock('@/lib/teach-guides/registry', async (orig) => {
  const real = await orig<typeof import('@/lib/teach-guides/registry')>()
  return {
    ...real,
    teachHubNewest: (live: readonly { slug: string }[], own?: string) => {
      h.hubNewestLive = live
      return h.hubNewest ?? real.teachHubNewest(live, own)
    },
  }
})

vi.mock('@/lib/teach-guides/request-clock', () => ({ requestNow: () => h.now }))
vi.mock('@/components/marketplace/seo-article', () => ({
  SeoArticle: () => null,
  HereLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  P: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}))
vi.mock('@/components/marketplace/live-count', () => ({
  LiveCounts: ({ children }: { children: (f: Record<string, { n: number; count: string; allInside: boolean } | null>) => ReactNode }) =>
    children({ jobs: { n: 38, count: '38', allInside: false } }),
}))
vi.mock('@/lib/schools/queries', () => ({
  listSchools: async () => [{ kind: 'language_centre' }, { kind: 'language_centre' }, { kind: 'international_school' }],
}))
vi.mock('@/app/[lang]/hcmc-rent-index/load-rent-index', () => ({ loadRentIndex: async () => h.rent }))

/**
 * The request clock: the day every registered guide is live — the latest wave or re-approval day in the registry — so a
 * guide re-approved on a later day (wave 1b, 2026-10-19) never fails these tests for the wrong reason, as a fixed date did:
 * a guide is released only once its review day has come (registry.ts isReleased).
 */
h.now = new Date(`${TEACH_GUIDES.flatMap((e) => [e.published, e.reviewed ?? e.published]).sort().at(-1)}T05:00:00Z`)

const RENT = { median: 7_123_456, n: 4_321, computedAt: '2026-10-17T19:00:00.000Z' }
const knownRent = () => ({ known: true, index: { computedAt: RENT.computedAt, cityBands: { br1: { median: RENT.median, n: RENT.n } } } })

// The first import pulls the registry and all 41 guides' content (parsed and digest-checked at load) — slow cold.
vi.setConfig({ testTimeout: 30_000 })

type Page = typeof import('./page')
let page: Page

beforeAll(async () => {
  // A marketplace page: SITE_NAME is "eno.vn" there (eno.forum 308s the whole library to eno.vn — next.config.ts).
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.resetModules()
  page = await import('./page')
})
// The edition is read once, at import; give the worker its environment back for the next file.
afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  h.rent = knownRent()
  h.hubNewest = null
})

/** The shape of one short answer, as the page hands it to its renderer. */
type Answer = { id: string; q: string; a: ReactNode; guides: readonly string[]; checked: string }

async function render() {
  const el = (await page.default()) as ReactElement<{ content: ArticleContent }>
  const content = el.props.content
  const first = content.sections[0]
  const body = first.body as ReactElement<{ answers: Answer[] }>
  return { content, first, answers: body.props.answers, html: renderToStaticMarkup(first.body as ReactElement) }
}
const answerText = (answers: Answer[], id: string) => text(answers.find((a) => a.id === id)!.a)

/** The text a reader sees in rendered markup, and in a piece of the page. */
const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const text = (node: ReactNode) => plain(renderToStaticMarkup(<>{node}</>))
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))

/** Every figure in a text, ranges kept whole: "390,000–600,000", "78–95", "1,961", "219", "2025". */
const figures = (t: string) => [...t.matchAll(/\d[\d,.]*(?:–\d[\d,.]*)?/g)].map((m) => m[0].replace(/[.,]+$/, ''))
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The figure as a figure of its own: not the tail of a longer number ("2" in "2025"), not the head of one. */
const hasFigure = (corpus: string, f: string) => new RegExp(`(?<![\\d,.])${escape(f)}(?![\\d]|[,.]\\d)`).test(corpus)

/** Every word a reader sees in a guide — headings, lede, key points, sections, tables, FAQ — with money as printed. */
function guideText(slug: string): string {
  const g = teachGuideContent(slug)
  if (!g) throw new Error(`no guide content for ${slug}`)
  const out: string[] = []
  forEachPlain(g, (t) => out.push(t))
  forEachInline(g, (src) => out.push(inlineText(src)))
  return out.join('\n')
}

/** Sentences, split as teach-guides.test.ts splits a guide's for the same money rule. */
const sentences = (t: string) => t.split(/(?<=[.!?])\s+/)
const USD = /US\$|\$\s?\d|\bUSD\b/
const VND = /\d\s?đ(?![\p{L}\p{N}])/u
/** The sentences holding both a US dollar and a đồng amount (STYLE.md: never in one sentence). */
const mixedCurrency = (t: string) => sentences(t).filter((s) => USD.test(s) && VND.test(s))
/**
 * Every amount — đồng or US dollar — not followed by "an hour" or "a month" ("gross" may sit between). The
 * `(?![\d,–+])` keeps a match from backtracking into a shorter number whose next character is not the unit.
 */
const unitless = (t: string) =>
  [...t.matchAll(/(?:US\$\d[\d,]*(?:–\d[\d,]*)?\+?|\d[\d,]*(?:–\d[\d,]*)? đ)(?![\d,–+])(?! (?:gross )?(?:an hour|a month))/g)].map((m) => m[0])
/** Runs of ten words, lowercased, punctuation dropped: how a repeated sentence shows, whatever its markup. */
function runs(t: string, n = 10): Set<string> {
  const w = t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return new Set(w.slice(0, Math.max(0, w.length - n + 1)).map((_, i) => w.slice(i, i + n).join(' ')))
}

describe('the hub is one national page (plan B1)', () => {
  it('title: "Teach English in Vietnam" first, the year from the content, ≤ 60 characters with the site name, no count', async () => {
    const meta = await page.generateMetadata()
    // The year of the newest edit, the hub's own or a guide's (registry.ts `teachHubNewest`) — never the clock's.
    const year = teachHubNewest(releasedGuides(h.now)).slice(0, 4)
    const title = meta.title as string
    expect(title).toBe(`Teach English in Vietnam (${year}): rules, pay & jobs | eno.vn`)
    expect(title.length).toBeLessThanOrEqual(60)
    // ⛔ No live count in a <title>: the year is the only number in it.
    expect(title.replace(year, '')).not.toMatch(/\d/)
    expect(title).not.toMatch(/saigon|ho chi minh/i)
  })

  it('description: the H1’s three promises, national, Ho Chi Minh City named as the first city, within 120–160 characters', async () => {
    const description = (await page.generateMetadata()).description as string
    expect(description).toMatch(/^Teaching English in Vietnam: what you need, what you earn and where the jobs are, Ho Chi Minh City first, /)
    expect(description.length).toBeGreaterThanOrEqual(120)
    expect(description.length).toBeLessThanOrEqual(160)
  })

  it('the hub link’s blurb on other pages restates the description word for word, minus the subject (site-links.ts)', async () => {
    const description = (await page.generateMetadata()).description as string
    const { label, blurb } = teachHubLink(h.now)!
    expect(label).toBe('Teach English in Vietnam')
    expect(description.toLowerCase()).toContain(blurb.replace(/\.$/, '').toLowerCase())
  })

  it('H1: national, and the page’s three promises', async () => {
    const { content } = await render()
    expect(content.h1).toBe('Teaching English in Vietnam: what you need, what you earn, where the jobs are')
  })

  it('the hub’s title and H1 repeat no guide’s (the hub owns "teach English in Vietnam", the guides their own queries — plan B6)', async () => {
    const { content } = await render()
    const own = [((await page.generateMetadata()).title as string).replace(/ \| eno\.vn$/, ''), content.h1].map((s) => s.toLowerCase())
    for (const e of TEACH_GUIDES) {
      const g = teachGuideContent(e.slug)!
      for (const s of [g.title, g.h1]) expect(own, e.slug).not.toContain(s.toLowerCase())
    }
  })

  it('the lead states the 2-year rule in full, as the library does: at least 2 years, then the condition, the alternative proof, ask in writing — never "normally"', async () => {
    const { content, answers } = await render()
    expect(content.intro).toContain(
      'at least 2 years of relevant experience (Decree 219/2025); if you have less, an alternative proof exists, so ask your employer in writing which one they will file',
    )
    expect(content.intro).not.toMatch(/\bnormally\b/i)
    // Said in full ONCE: the first answer keeps the rule and a short caveat, and no answer repeats the alternative proof.
    for (const a of answers) expect(text(a.a), a.id).not.toContain('alternative proof exists')
  })
})

/**
 * Google Discover (plan §3a item 16): a large image preview, by the one robots directive that allows it — and nothing
 * else, so the hub stays as indexable and followed as it was with no robots meta (src/lib/teach-guides/robots.ts).
 */
describe('robots: max-image-preview:large, index and follow as they were', () => {
  it('the live hub allows a large image preview and states nothing else', async () => {
    expect((await page.generateMetadata()).robots).toEqual({ 'max-image-preview': 'large' })
  })

  it('before its first guide the hub is a 404, and stays noindex', async () => {
    const live = h.now
    h.now = new Date('2026-10-01T05:00:00Z')
    try {
      expect(releasedGuides(h.now)).toEqual([])
      expect((await page.generateMetadata()).robots).toEqual({ index: false })
    } finally {
      h.now = live
    }
  })
})

describe('the hub is dated by its own edits too (registry.ts TEACH_HUB_UPDATED)', () => {
  it('TEACH_HUB_UPDATED is a real day, not in the future, and no older than any short answer’s check', async () => {
    expect(new Date(`${TEACH_HUB_UPDATED}T00:00:00Z`).toISOString().slice(0, 10)).toBe(TEACH_HUB_UPDATED)
    // The real clock, as the live page and the sitemap read it: a date ahead of today claims an edit not yet live.
    expect(TEACH_HUB_UPDATED <= vnToday(new Date())).toBe(true)
    for (const a of (await render()).answers) expect(TEACH_HUB_UPDATED >= a.checked, `${a.id} was checked after the hub's last edit`).toBe(true)
  })

  it('updated (dateModified, the date line) and the title year are the one rule’s answer for the live guides (teachHubNewest)', async () => {
    // A sentinel no guide and no hub edit carries: it shows only if the page asks the rule, whatever today's dates are.
    // (The sitemap's <lastmod> reads the same rule — sitemap.test.ts proves it the same way.)
    h.hubNewest = '2031-02-03'
    const { content } = await render()
    expect(content.updated).toBe('2031-02-03')
    expect(h.hubNewestLive?.map((e) => e.slug)).toEqual(releasedGuides(h.now).map((e) => e.slug))
    expect((await page.generateMetadata()).title).toBe('Teach English in Vietnam (2031): rules, pay & jobs | eno.vn')
    // …and when its answer is the publication day itself, there is no "updated" that only repeats it.
    h.hubNewest = content.published
    expect((await render()).content.updated).toBeUndefined()
  })
})

describe('the facts box (plan B1)', () => {
  it('says its job count is national, and makes no link claim (the short answer "How does eno.vn help?" makes it once)', async () => {
    const { content } = await render()
    const box = text(content.ledeRow)
    // The whole jobs line, so no "each" or "most linked" can creep back into it.
    const lines = (renderToStaticMarkup(<>{content.ledeRow}</>).match(/<li>[\s\S]*?<\/li>/g) ?? []).map(plain)
    expect(lines).toContain('38 teaching jobs in Vietnam listed now — browse them.')
    expect(box).toContain(
      `A one-bedroom apartment in Ho Chi Minh City has a median asking rent of ${moneyText(RENT.median)} a month (${RENT.n.toLocaleString('en-US')} listings, eno.vn Rent Index, ${formatArticleDate('2026-10-17', 'en')}).`,
    )
  })
})

describe('the short answers come first (plan B1, "answer first")', () => {
  const IDS = ['who-can-teach', 'pay', 'work-permit', 'where-the-jobs-are', 'cost-of-living', 'how-eno-helps']

  it('are the first section: six questions, in this order, each with its own anchor', async () => {
    const { content, first, answers } = await render()
    expect(first.id).toBe('short-answers')
    expect(answers.map((a) => a.id)).toEqual(IDS)
    for (const a of answers) expect(a.q, a.id).toMatch(/\?$/)
    // An answer's anchor never collides with a section's (the sections are "On this page" targets too).
    expect(content.sections.map((s) => s.id).filter((id) => IDS.includes(id))).toEqual([])
  })

  it('every answer is dated: a real date, not in the future, and never older than the facts of any guide it cites', async () => {
    const { answers, html } = await render()
    expect([...html.matchAll(/<time [^>]*datetime="(\d{4}-\d{2}-\d{2})"/gi)].map((m) => m[1])).toEqual(answers.map((a) => a.checked))
    for (const a of answers) {
      expect(new Date(`${a.checked}T00:00:00Z`).toISOString().slice(0, 10), a.id).toBe(a.checked)
      // The REAL clock, not the fixture's: re-dating an answer after the fixture day must not fail this check.
      expect(a.checked <= vnToday(new Date()), a.id).toBe(true)
      expect(html).toContain(formatArticleDate(a.checked, 'en'))
      // ⚠️ When a cited guide's facts are re-checked, this fails ON PURPOSE (page.tsx `shortAnswers`): re-read the answer
      // against the guide, fix what moved, then move `checked`.
      for (const slug of a.guides) expect(teachGuideContent(slug)!.lastChecked <= a.checked, `${a.id}: ${slug} was re-checked after this answer`).toBe(true)
    }
  })

  it('every answer links the guide it restates, and every guide it links is released', async () => {
    const { answers, html } = await render()
    const live = new Set(releasedGuides(h.now).map((e) => e.slug))
    for (const a of answers) {
      expect(a.guides.length, a.id).toBeGreaterThan(0)
      for (const slug of a.guides) {
        expect(live.has(slug), `${a.id}: ${slug} is not a released guide`).toBe(true)
        expect(html).toContain(`href="${TEACH_BASE}/${slug}"`)
      }
    }
    // Every link in the block: a released guide, or a page a guide may link (registry.ts TEACH_SITE_PATHS), or the
    // teacher app — nothing that could 404 or leave the site's own family.
    for (const href of hrefs(html)) {
      if (href.startsWith(`${TEACH_BASE}/`)) expect(live.has(href.slice(TEACH_BASE.length + 1)), href).toBe(true)
      else expect(TEACH_SITE_PATHS.includes(href) || href === 'https://teacher.eno.vn', href).toBe(true)
    }
  })

  it('every figure in an answer is one its guides print (the hub restates; it never adds a fact)', async () => {
    const { answers } = await render()
    // The live Rent Index median is this page's own data (the facts box prints it), not a guide's.
    const live = [moneyText(RENT.median), RENT.n.toLocaleString('en-US'), formatArticleDate(RENT.computedAt.slice(0, 10), 'en')]
    for (const a of answers) {
      const said = live.reduce((t, s) => t.split(s).join(' '), text(a.a))
      if (!a.guides.length) {
        // An answer that cites no guide states no figure.
        expect(figures(said), a.id).toEqual([])
        continue
      }
      const corpus = a.guides.map(guideText).join('\n')
      expect(figures(said).filter((f) => !hasFigure(corpus, f)), a.id).toEqual([])
    }
  })

  it('the figure check bites: a figure no guide prints is caught', () => {
    const corpus = guideText('english-teacher-salary-in-vietnam')
    expect(hasFigure(corpus, '390,000–600,000')).toBe(true)
    expect(hasFigure(corpus, '390,000–650,000')).toBe(false)
    expect(hasFigure(corpus, '38,700,000')).toBe(true)
    expect(hasFigure(corpus, '38,800,000')).toBe(false)
    expect(figures('Decree 219/2025, 78–95 hours, US$2,500–4,000+, 1,961.')).toEqual(['219', '2025', '78–95', '2,500–4,000', '1,961'])
  })

  /**
   * ⚖️ THE CANONICAL POSITIONS, WORD FOR WORD WHERE A NUMBER HANGS ON THEM. The figure check reads the whole guide, so it
   * cannot tell "at least 2 years" from "3 years" (the requirements guide prints "the old rule was 3 years"), or a pay
   * range shown without the new-teacher range that STYLE.md pairs with it. These pin what each answer must say.
   */
  it('each answer states its canonical positions whole (STYLE.md ⚖️)', async () => {
    const { answers } = await render()
    const CANON: Record<string, (string | RegExp)[]> = {
      'who-can-teach': [
        'a bachelor’s degree plus at least 2 years of relevant experience (with less, ask your employer which proof they will file)',
        'Language centres must also see a suitable teaching certificate',
        'There is no legal maximum age',
        'non-native speakers are not barred',
        'There is no established legal route without a degree',
      ],
      pay: [
        `language centres offered ${moneyText(390_000, 600_000)} an hour (most new-teacher offers ${moneyText(430_000, 560_000)} an hour)`,
        `public-school agencies ${moneyText(430_000, 600_000)} an hour`,
        // The gross comes from the hours × the full-time rate, not from the whole 390,000–600,000 đ span.
        `78–95 teaching hours a month, at ${moneyText(450_000, 550_000)} an hour, comes to roughly ${moneyText(35_000_000, 52_000_000)} gross a month`,
        `A tax resident with no dependants on a 12-month contract earning ${moneyText(45_000_000)} gross a month keeps about ${moneyText(38_700_000)} a month`,
      ],
      'work-permit': [
        'Your school applies for it, not you',
        'files 60 to 10 days before your start date',
        '5 working days published for a decision (the decree allows up to 10)',
        '1 to 6 months',
        'A permit lasts up to 2 years and covers one employer and one position',
        'you may not teach a paid class before it is issued',
      ],
      'where-the-jobs-are': [
        // The guide's own claim: most jobs are in the TWO big cities (hanoi-vs-ho-chi-minh-city, "Why most teaching jobs
        // are in Ho Chi Minh City and Hanoi"), never in Ho Chi Minh City alone.
        /^Most are in Ho Chi Minh City and Hanoi\. /,
        'biggest market for English teachers by a wide margin (1,961 licensed language and IT centres in August 2025)',
        'Hanoi is the clear second, and its 2026 job ads pay the same per hour as Saigon or slightly more',
      ],
      'cost-of-living': [
        `about ${moneyText(14_000_000, 17_000_000)} a month`,
        `about ${moneyText(25_000_000, 35_000_000)} a month`,
        `full-time take-home pay of about ${moneyText(30_500_000, 44_300_000)} a month`,
      ],
      'how-eno-helps': ['schools and others looking for a teacher can message you', 'Linked teaching jobs on eno.vn open the original advert, where you apply'],
    }
    expect(Object.keys(CANON)).toEqual(IDS)
    for (const a of answers) {
      const t = text(a.a)
      for (const c of CANON[a.id]) {
        if (typeof c === 'string') expect(t, a.id).toContain(c)
        else expect(t, a.id).toMatch(c)
      }
      // STYLE.md's pay position is two ranges, always together.
      if (t.includes(moneyText(390_000, 600_000))) expect(t, a.id).toContain(`most new-teacher offers ${moneyText(430_000, 560_000)}`)
    }
    expect(answerText(answers, 'where-the-jobs-are')).not.toMatch(/^Most are in Ho Chi Minh City[,.]/)
    // ⛔ An employer's own job is not linked (taxonomy.ts): "each" would be false the day a school posts directly.
    expect(answerText(answers, 'how-eno-helps')).not.toMatch(/\beach\b/i)
  })

  it('no sentence holds both a US dollar and a đồng amount, and every pay, budget and rent amount says "an hour" or "a month" (STYLE.md money)', async () => {
    const { answers } = await render()
    for (const a of answers) expect(mixedCurrency(text(a.a)), a.id).toEqual([])
    for (const id of ['pay', 'cost-of-living']) expect(unitless(answerText(answers, id)), id).toEqual([])
  })

  it('the money checks bite', () => {
    expect(mixedCurrency('Centres pay 390,000 đ an hour, about US$15. Online pays US$10 an hour.')).toEqual(['Centres pay 390,000 đ an hour, about US$15.'])
    expect(mixedCurrency(`Centres pay ${moneyText(390_000, 600_000)} an hour. Bilingual schools pay US$1,700–3,000 a month.`)).toEqual([])
    expect(unitless(`They offered ${moneyText(430_000, 600_000)}; take-home is ${moneyText(38_700_000)} a month, US$2,500–4,000+ a month, US$1,700–3,000.`)).toEqual([
      moneyText(430_000, 600_000),
      'US$1,700–3,000',
    ])
    expect(unitless(`roughly ${moneyText(35_000_000, 52_000_000)} gross a month at ${moneyText(450_000, 550_000)} an hour`)).toEqual([])
  })

  it('the first screen says each thing once: no answer repeats ten words in a row from the lead or the facts box', async () => {
    const { content, answers } = await render()
    const above = runs(`${content.intro}\n${text(content.ledeRow)}`)
    for (const a of answers) expect([...runs(text(a.a))].filter((r) => above.has(r)), a.id).toEqual([])
    // It bites: the first draft's cost answer repeated the facts box's rent sentence, and its first answer the lead's decree.
    const copies = [
      `A one-bedroom apartment has a median asking rent of ${moneyText(RENT.median)} a month (${RENT.n.toLocaleString('en-US')} listings, eno.vn Rent Index, ${formatArticleDate('2026-10-17', 'en')}).`,
      'The work permit is the gate: a bachelor’s degree plus at least 2 years of relevant experience (Decree 219/2025), a police check.',
    ]
    for (const c of copies) expect([...runs(c)].some((r) => above.has(r)), c).toBe(true)
  })

  it('what Ho Chi Minh City costs points at the Rent Index median the facts box prints, without repeating its sentence — and still answers without it', async () => {
    const r = await render()
    const a = r.answers.find((x) => x.id === 'cost-of-living')!
    const withRent = text(a.a)
    expect(withRent).toContain(`Rent decides the gap: the median one-bedroom asks ${moneyText(RENT.median)} a month (Rent Index, above).`)
    expect(hrefs(renderToStaticMarkup(<>{a.a}</>))).toContain('/hcmc-rent-index')
    // The listing count and the date are the facts box's (tested above); the answer only points at them.
    expect(withRent).not.toContain(RENT.n.toLocaleString('en-US'))
    expect(withRent).not.toContain(formatArticleDate('2026-10-17', 'en'))
    h.rent = { known: false }
    const without = await render()
    const t = answerText(without.answers, 'cost-of-living')
    expect(t).not.toMatch(/Rent Index|median|above/)
    expect(t).toMatch(/^On eno\.vn’s budgets a frugal single teacher/)
  })

  it('how eno.vn helps: the free teacher profile, the jobs and the school directory, each linked', async () => {
    const a = (await render()).answers.find((x) => x.id === 'how-eno-helps')!
    const html = renderToStaticMarkup(<>{a.a}</>)
    expect(hrefs(html)).toEqual(['https://teacher.eno.vn', '/jobs-vietnam-expats', '/schools'])
    // ⛔ The site's own messaging promise — never "only schools/business accounts can message you" (any signed-in account
    // may, within a daily limit, since 2026-10-13: teachers/dm-quota.ts).
    expect(text(a.a)).toContain('schools and others looking for a teacher can message you')
    expect(text(a.a)).not.toMatch(/only (?:schools|business)/i)
  })

  it('how eno.vn helps restates its guide: the finding-a-job guide still says each thing the answer says', async () => {
    const a = (await render()).answers.find((x) => x.id === 'how-eno-helps')!
    expect(a.guides).toEqual(['finding-a-teaching-job-in-vietnam'])
    // Its eno.vn paragraph as re-approved in wave 1a (2026-10-18). ⚠️ If a later wave rewrites it, this fails on
    // purpose: re-read the answer against the guide before changing either line here.
    const guide = guideText('finding-a-teaching-job-in-vietnam')
    for (const said of [
      'A free teacher profile',
      'anyone signed in to eno.vn can message you',
      'your phone number, email and CV stay hidden until you choose to share them',
      'opens the original ad, where you apply',
      'The school directory lists Ho Chi Minh City employers',
    ])
      expect(guide, said).toContain(said)
  })

  it('no answer says "normally" — the canonical positions are stated, not hedged (STYLE.md)', async () => {
    for (const a of (await render()).answers) expect(text(a.a), a.id).not.toMatch(/\bnormally\b/i)
  })
})
