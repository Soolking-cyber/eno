// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { editionMonth, planEdition, teacherCostIndexCsv, type Edition } from '@/lib/teacher-cost-index'
import { EDITION_BANNED } from '@/test/edition-words'

/**
 * /hcmc-teacher-cost-pay-index AND ITS EDITIONS, AS RENDERED — the JSON-LD, the canonical, the words, the cite box and
 * the edition boundary, read from the pages' own output. The header, the footer and the teach-guide links are stand-ins;
 * the editions are the real frozen files unless a test swaps in a newer one (to see the 2026-10 edition superseded).
 * ⚠️ THE FIGURES ARE CHECKED ON THE 2026-10 EDITION PAGE, which is frozen: the series page moves to each new edition, so
 * it is checked for its shape, never for October's numbers.
 * ⚠️ `language-context` IS IMPORTED AFTER `vi.resetModules()`, like the pages (the Rent Index page test explains why).
 */
const h = vi.hoisted(() => ({ editions: null as Edition[] | null }))
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))
vi.mock('@/lib/teach-guides/site-links', () => ({
  teachGuideLinks: (slugs: readonly string[]) => slugs.map((s) => ({ href: `/teach-in-vietnam/${s}`, label: `Guide: ${s}`, blurb: '' })),
  teachHubLink: () => ({ href: '/teach-in-vietnam', label: 'Teach English in Vietnam', blurb: '' }),
}))
// The real editions, or a test's own list (newest first) — read on every access, as the pages read them per call.
vi.mock('@/lib/teacher-cost-index-editions', async (orig) => {
  const real = await orig<typeof import('@/lib/teacher-cost-index-editions')>()
  const list = () => h.editions ?? real.EDITIONS
  return { ...real, get EDITIONS() { return list() }, editionById: (id: string) => list().find((e) => e.edition === id) }
})

type Series = typeof import('./page')
type One = typeof import('./[edition]/page')
type Csv = typeof import('@/app/hcmc-teacher-cost-pay-index.csv/route')
let series: Series
let one: One
let csv: Csv
let LanguageProvider: typeof import('@/context/language-context').LanguageProvider
let real: readonly Edition[]

const ORIGIN = 'https://eno.vn'
const OCT_URL = `${ORIGIN}/hcmc-teacher-cost-pay-index/2026-10`

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN)
  vi.resetModules()
  series = await import('./page')
  one = await import('./[edition]/page')
  csv = await import('@/app/hcmc-teacher-cost-pay-index.csv/route')
  ;({ LanguageProvider } = await import('@/context/language-context'))
  real = (await import('@/lib/teacher-cost-index-editions')).EDITIONS
})
afterAll(() => { vi.unstubAllEnvs() })
beforeEach(() => { h.editions = null })

/**
 * An edition for the month after the newest real one, frozen from the October fixture on its 1st — enough to supersede
 * every real edition, whichever month the suite runs in (a fixed "November" would collide with the real one).
 */
function nextEdition(): Edition {
  const [y, m] = real[0].edition.split('-').map(Number)
  const id = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  const text = readFileSync('src/lib/__fixtures__/rent-index-2026-10-21.csv', 'utf8').split('2026-10-21T05:07:42.038Z').join(`${id}-01T00:30:00.000Z`)
  return planEdition({ csvText: text, csvSha256: 'c'.repeat(64), now: new Date(`${id}-01T01:00:00Z`), editions: real.filter((e) => e.edition === '2026-10'), sources: NEXT_SOURCES })
}
const NEXT_SOURCES = "GoPlus (an official eno.vn partner's own listings) · listings posted by eno.vn members"


async function render(tree: Promise<React.ReactNode> | React.ReactNode, lang: 'en' | 'vi') {
  const el = document.createElement('div')
  el.innerHTML = renderToString(<LanguageProvider initialLang={lang} initialViDict={VI_OVERRIDES}>{await tree}</LanguageProvider>)
  const nodes = [...el.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!) as Record<string, unknown>)
  return { el, nodes, main: el.querySelector('main')! }
}
const renderSeries = (lang: 'en' | 'vi') => render(series.default(), lang)
const renderEdition = (edition: string, lang: 'en' | 'vi') => render(one.default({ params: Promise.resolve({ lang, edition }) }), lang)
const keysDeep = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap(keysDeep) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]) : []
const squash = (t: string | null) => (t ?? '').replace(/\s+/g, ' ').trim()
/** A figure or a cell as read aloud: its block children's text, one space between them (the markup puts none). */
const blocks = (el: Element) => squash([...el.children].map((c) => c.textContent).join(' '))

describe('the series page', () => {
  it.each(['en', 'vi'] as const)('%s: the breadcrumb and the ONE Dataset, with no licence key in any node', async (lang) => {
    const { nodes } = await renderSeries(lang)
    expect(nodes.map((n) => n['@type'])).toEqual(['BreadcrumbList', 'Dataset'])
    expect(keysDeep(nodes).filter((k) => /licen[cs]e/i.test(k))).toEqual([])
    const ds = nodes[1]
    expect(ds.usageInfo).toBe(`${ORIGIN}/hcmc-teacher-cost-pay-index#cite`)
    expect(ds.version).toBe(real[0].edition)
    expect((ds.distribution as Record<string, string>).contentUrl).toBe(`${ORIGIN}/hcmc-teacher-cost-pay-index.csv`)
  })

  it('is self-canonical, with an English title of at most 60 characters', () => {
    const m = series.generateMetadata()
    expect(m.alternates?.canonical).toBe('/hcmc-teacher-cost-pay-index')
    expect(m.title).toBe('HCMC Teacher Cost & Pay Index: rent vs take-home | eno.vn')
    expect((m.title as string).length).toBeLessThanOrEqual(60)
    expect((m.description as string).length).toBeLessThanOrEqual(160)
    expect(m.robots).toBeUndefined()
  })

  it('shows the newest edition, and its citation names that edition’s own address', async () => {
    const { main } = await renderSeries('en')
    expect(main.querySelector('h1')!.textContent).toBe('Ho Chi Minh City Teacher Cost & Pay Index')
    expect(squash(main.querySelector('h1 + p')!.textContent)).toMatch(/^In the \w+ \d{4} edition, /)
    expect(main.querySelector('#cite')!.textContent).toContain(`${ORIGIN}/hcmc-teacher-cost-pay-index/${real[0].edition}`)
  })
})

describe('the 2026-10 edition page (frozen: its words and figures never move)', () => {
  it('the lede answers first: the one-bedroom, then the studio, against the modelled take-home pay', async () => {
    const { main } = await renderEdition('2026-10', 'en')
    expect(main.querySelector('h1')!.textContent).toBe('Ho Chi Minh City Teacher Cost & Pay Index, October 2026')
    expect(squash(main.querySelector('h1 + p')!.textContent)).toBe(
      'In the October 2026 edition, a median one-bedroom apartment in Ho Chi Minh City asks 6,600,000 đ a month (139 listings): 17–19% of a full-time language-centre teacher\'s modelled take-home pay of 34,630,000–38,702,500 đ a month. A studio asks 4,500,000 đ a month (2,377 listings): 12–13% of that pay.',
    )
  })

  it('city-wide: Studio first, then 1, 2 and 3+ bedrooms — a share, the median, what is left, the count; 3+ is a dash', async () => {
    const { main } = await renderEdition('2026-10', 'en')
    const figures = [...main.querySelectorAll('section[aria-labelledby="city-wide"] .grid > div')].map(blocks)
    expect(figures).toEqual([
      'Studio 12–13% of take-home pay Median rent 4,500,000 đ a month Left after rent: 30,100,000–34,200,000 đ 2,377 listings',
      '1 bedroom 17–19% of take-home pay Median rent 6,600,000 đ a month Left after rent: 28,000,000–32,100,000 đ 139 listings',
      '2 bedrooms 23–25% of take-home pay Median rent 8,800,000 đ a month Left after rent: 25,800,000–29,900,000 đ 75 listings',
      '3 or more bedrooms — 5 listings',
    ])
  })

  it('by district: a share, the median and the count per cell, or a dash and the count; Thu Duc says what it holds', async () => {
    const { main } = await renderEdition('2026-10', 'en')
    const rows = [...main.querySelectorAll('section[aria-labelledby="by-district"] tbody tr')]
    expect(rows).toHaveLength(20)
    const row = (name: string) => rows.find((r) => r.querySelector('th')!.textContent!.startsWith(name))!
    const cells = (name: string) => [...row(name).querySelectorAll('td')].map(blocks)
    expect(cells('Go Vap District')).toEqual([
      'Studio 12–14% 4,800,000 đ 686 listings', '1 bedroom 17–19% 6,700,000 đ 58 listings', '2 bedrooms 20–23% 7,900,000 đ 33 listings',
    ])
    expect(cells('District 1')).toEqual(['Studio 17–19% 6,500,000 đ 39 listings', '1 bedroom — 7 listings', '2 bedrooms — 2 listings'])
    // One listing is one listing (verifier round): never "1 listings".
    expect(cells('District 3')).toEqual(['Studio 16–18% 6,300,000 đ 12 listings', '1 bedroom — 1 listing', '2 bedrooms — 1 listing'])
    expect(main.textContent).not.toMatch(/\b1 listings/)
    expect(row('Thu Duc City').textContent).toContain('All of Thu Duc City, including listings still labelled District 2 or 9')
  })

  it('the method prints the pay model’s arithmetic from the edition: insurance, taxable income, tax, take-home', async () => {
    const { main } = await renderEdition('2026-10', 'en')
    const method = main.querySelector('section[aria-labelledby="method"]')!
    const table = [...method.querySelectorAll('tbody tr')].map((r) => [...r.children].map((c) => squash(c.textContent)))
    expect(table).toEqual([
      ['Social insurance, 9.5%', '3,800,000 đ', '4,275,000 đ'],
      ['Taxable income', '20,700,000 đ', '25,225,000 đ'],
      ['Income tax', '1,570,000 đ', '2,022,500 đ'],
      ['Take-home pay', '34,630,000 đ', '38,702,500 đ'],
    ])
    expect(squash(method.textContent)).toContain(
      'after the personal deduction of 15,500,000 đ a month, 5% up to 10,000,000 đ, 10% to 30,000,000 đ, 20% to 60,000,000 đ, 30% to 100,000,000 đ, 35% above.',
    )
    expect(squash(method.textContent)).toContain('about 80–90 teaching hours a month at 500,000 đ an hour')
    expect(squash(method.textContent)).toContain('HCMC Rent Index snapshot of 21 October 2026 (its rules version 5)')
  })

  it('the edition’s note (the series starts on rules v5) is printed with it; the editions list and the CSV link follow', async () => {
    const { main } = await renderEdition('2026-10', 'en')
    expect(main.textContent).toContain('The series starts with this edition, on Rent Index rules version 5')
    const editions = main.querySelector('section[aria-labelledby="editions"]')!
    // A monthly cadence, never a day (the 1st is not enforced), and never "that day's" Rent Index: the freeze reads its
    // latest snapshot, which may be the day before's. Each edition names its rents' day instead.
    expect(squash(editions.querySelector('p')!.textContent)).toMatch(/^A new edition is frozen once a month from the Rent Index's latest snapshot, and each one below names the day its rents are from\./)
    expect(editions.textContent).not.toMatch(/on the 1st|that day/)
    const list = [...editions.querySelectorAll('li')].map((li) => squash(li.textContent))
    expect(list.at(-1)).toMatch(/^October 2026 · rents of 21 October 2026 · Rent Index rules version 5 · pay model version 1/)
    expect(main.querySelector('a[href="/hcmc-teacher-cost-pay-index.csv"]')!.hasAttribute('download')).toBe(true)
  })

  /**
   * ⛔ IT SAYS WHAT ITS RENTS ARE (d1-spec §2.1, §16.2; verifier round), by the headline: the Rent Index's names for its
   * snapshot's sources, stored with the edition — and no erratum on the first edition's first day.
   */
  it('names the sources of its rents beside it, from the edition itself', async () => {
    const { main } = await renderEdition('2026-10', 'en')
    const notes = [...main.querySelectorAll('h1 ~ div p')].map((p) => squash(p.textContent))
    expect(notes).toContain(
      "Sources in the Rent Index snapshot these rents are from: GoPlus (an official eno.vn partner's own listings) · listings posted by eno.vn members. The figures are always pooled and never broken down by source.",
    )
    expect(squash(main.textContent)).not.toMatch(/Erratum/)
  })

  it('carries the breadcrumb only — the Dataset is the series page’s', async () => {
    const { nodes } = await renderEdition('2026-10', 'en')
    expect(nodes.map((n) => n['@type'])).toEqual(['BreadcrumbList'])
  })
})

/**
 * ⛔ THE CITATION TERMS (owner decision 9), IN THE RENT INDEX'S ONE WORDING — the same box (cite-box.tsx) — and a BRAND
 * anchor in the snippet, never a keyword one. English on both language variants, like everything on these pages.
 */
describe('the cite box', () => {
  it.each(['en', 'vi'] as const)('%s: the exact terms sentence, the edition’s address, and the snippet’s anchor is "eno.vn"', async (lang) => {
    const { el } = await renderEdition('2026-10', lang)
    const box = el.querySelector('#cite')!
    expect(box.querySelector('h2')!.textContent).toBe('Cite this data')
    expect(box.querySelector('p')!.textContent).toBe('Free to cite and quote. Please credit eno.vn; a link is welcome and may be nofollow.')
    expect([...box.querySelectorAll('p a')].map((a) => [a.getAttribute('href'), a.textContent])).toEqual([[OCT_URL, OCT_URL]])
    const snippet = box.querySelector('pre code')!.textContent!
    expect(snippet).toBe(`HCMC Teacher Cost &amp; Pay Index, October 2026 (<a href="${OCT_URL}">eno.vn</a>)`)
    const parsed = document.createElement('div')
    parsed.innerHTML = snippet
    expect([...parsed.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['eno.vn', OCT_URL]])
    expect(parsed.textContent).toBe('HCMC Teacher Cost & Pay Index, October 2026 (eno.vn)')
    expect(box.textContent).toContain(`eno.vn (2026). HCMC Teacher Cost & Pay Index, October 2026 edition. ${OCT_URL}`)
  })
})

describe('⛔ English on both language variants (no Vietnamese teacher-pay copy before counsel)', () => {
  it('the en and vi renders of <main> carry the same text, and both say it is English', async () => {
    for (const page of [renderSeries, (lang: 'en' | 'vi') => renderEdition('2026-10', lang)]) {
      const [en, vi] = [await page('en'), await page('vi')]
      expect(vi.main.textContent).toBe(en.main.textContent)
      // On EVERY render: the client sets <html lang> to the visitor's language, the nine machine-translated ones too.
      expect([en.main.getAttribute('lang'), vi.main.getAttribute('lang')]).toEqual(['en', 'en'])
    }
  })

  it('no <Tr>, tr() or <Bilingual> in the D1 copy — the source, read with the TypeScript parser', () => {
    for (const file of ['src/app/[lang]/hcmc-teacher-cost-pay-index/page.tsx', 'src/app/[lang]/hcmc-teacher-cost-pay-index/[edition]/page.tsx', 'src/app/[lang]/hcmc-teacher-cost-pay-index/sections.tsx']) {
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const hits: string[] = []
      const visit = (n: ts.Node) => {
        if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && /^(Tr|Bilingual|LocalizedDate)$/.test(n.tagName.getText(sf))) hits.push(n.tagName.getText(sf))
        if (ts.isCallExpression(n) && /^(tr|useLanguage)$/.test(n.expression.getText(sf))) hits.push(n.expression.getText(sf))
        ts.forEachChild(n, visit)
      }
      visit(sf)
      expect(hits, file).toEqual([])
    }
  })

  it('⛔ no licensed-services word on either page, in either language', async () => {
    for (const r of [await renderSeries('en'), await renderSeries('vi'), await renderEdition('2026-10', 'vi')]) {
      expect(r.el.textContent!.match(EDITION_BANNED)).toBeNull()
      expect(JSON.stringify(r.nodes).match(EDITION_BANNED)).toBeNull()
    }
  })
})

/**
 * ⛔ THE INBOUND LINKS ON THE TEACH HUB AND THE TWO GUIDES NEVER REACH eno.forum, where every one of these routes 404s: the
 * services edition 308s the whole library to eno.vn before anything renders (next.config.ts, 2026-10-10), so those pages —
 * and their links here — exist on eno.vn alone. Pinned because the links rely on it (opus, gate review).
 */
describe('the links into it live on eno.vn only', () => {
  it('the services edition 308s /teach-in-vietnam and every guide to eno.vn', () => {
    const cfg = readFileSync('next.config.ts', 'utf8')
    expect(cfg).toMatch(
      /EDITION_ENV === "services"\s*\?\s*\[\s*\{ source: '\/teach-in-vietnam', destination: 'https:\/\/eno\.vn\/teach-in-vietnam', permanent: true \},\s*\{ source: '\/teach-in-vietnam\/:slug', destination: 'https:\/\/eno\.vn\/teach-in-vietnam\/:slug', permanent: true \},\s*\]/,
    )
  })
})

describe('canonical, superseded editions and the 404s', () => {
  it('the current edition’s canonical is the series page', async () => {
    const m = await one.generateMetadata({ params: Promise.resolve({ lang: 'en', edition: real[0].edition }) })
    expect(m.alternates?.canonical).toBe('/hcmc-teacher-cost-pay-index')
    expect(m.robots).toBeUndefined()
  })

  it('once a newer edition is frozen, 2026-10 is self-canonical, indexable, and points at the newest; the series shows it', async () => {
    const next = nextEdition()
    h.editions = [next, ...real]
    const m = await one.generateMetadata({ params: Promise.resolve({ lang: 'en', edition: '2026-10' }) })
    expect(m.alternates?.canonical).toBe('/hcmc-teacher-cost-pay-index/2026-10')
    expect(m.title).toBe('HCMC Teacher Cost & Pay Index, October 2026 | eno.vn')
    expect(m.robots).toBeUndefined()
    const oct = await renderEdition('2026-10', 'en')
    expect(squash(oct.main.textContent)).toContain(`This is the October 2026 edition. The newest is the ${editionMonth(next.edition)} edition.`)
    expect(oct.main.querySelector('a[href="/hcmc-teacher-cost-pay-index"]')).not.toBeNull()
    const s = await renderSeries('en')
    expect((s.nodes[1] as { version: string }).version).toBe(next.edition)
    expect(s.main.querySelector('#cite')!.textContent).toContain(`${ORIGIN}/hcmc-teacher-cost-pay-index/${next.edition}`)
    // An edition frozen with its sources prints them by the headline, with no erratum needed.
    expect(squash(s.main.textContent)).toContain(`Sources in the Rent Index snapshot these rents are from: ${NEXT_SOURCES}. The figures are always pooled`)
  })

  it('an id that is not a frozen edition is a 404 by status: dynamicParams is off and the params list only frozen ids', async () => {
    expect(one.dynamicParams).toBe(false)
    expect(one.generateStaticParams()).toEqual(real.map((e) => ({ edition: e.edition })))
    await expect(one.default({ params: Promise.resolve({ lang: 'en', edition: '2026-13' }) })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
    expect((await one.generateMetadata({ params: Promise.resolve({ lang: 'en', edition: '2025-01' }) })).robots).toEqual({ index: false })
  })

  it('the CSV route serves every edition, on the page’s terms', async () => {
    const res = csv.GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(res.headers.get('link')).toBe(`<${ORIGIN}/hcmc-teacher-cost-pay-index#cite>; rel="describedby"`)
    expect(res.headers.get('content-disposition')).toBe('inline; filename="hcmc-teacher-cost-pay-index.csv"')
    const { ERRATA } = await import('@/lib/teacher-cost-index-editions')
    expect(await res.text()).toBe(teacherCostIndexCsv(real, ERRATA))
  })

  it('⛔ the services build answers 404 for the series page, every edition and the CSV — marketplace only', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    vi.resetModules()
    try {
      const s = await import('./page')
      const e = await import('./[edition]/page')
      const c = await import('@/app/hcmc-teacher-cost-pay-index.csv/route')
      expect(() => s.default()).toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
      expect(s.generateMetadata().robots).toEqual({ index: false })
      await expect(e.default({ params: Promise.resolve({ lang: 'en', edition: '2026-10' }) })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
      expect((await e.generateMetadata({ params: Promise.resolve({ lang: 'en', edition: '2026-10' }) })).robots).toEqual({ index: false })
      expect(c.GET().status).toBe(404)
    } finally {
      vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    }
  })
})
