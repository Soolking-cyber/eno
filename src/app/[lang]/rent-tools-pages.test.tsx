// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import type { Metadata } from 'next'
import { renderToString } from 'react-dom/server'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { EDITION_BANNED, visibleCodeText } from '@/test/edition-words'
import { RENT_TOOLS, RENT_TOOL_SLUGS, type RentToolSlug } from '@/lib/rent-tools/registry'

/**
 * THE FOUR RENT TOOL PAGES, AS RENDERED (the /hcmc-rent-index page test's harness): the h1, the FAQPage node against the
 * FAQ the page prints, a real <label> for every control, the worked example's figures in each language's grouping, the
 * links to the other tools and to the rent index / rentals in the page's language, and no licensed-services word.
 * The header and the footer are stand-ins; everything else is the real page.
 * ⚠️ `language-context` IS IMPORTED AFTER `vi.resetModules()`, like the pages (the Rent Index page test explains why).
 */
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))

type PageModule = { default: (p: { params: Promise<{ lang: string }> }) => Promise<React.ReactNode>; generateMetadata: (p: { params: Promise<{ lang: string }> }) => Promise<Metadata> }
const pages = {} as Record<RentToolSlug, PageModule>
let LanguageProvider: typeof import('@/context/language-context').LanguageProvider

const load: Record<RentToolSlug, () => Promise<PageModule>> = {
  'rent-affordability-calculator': () => import('./rent-affordability-calculator/page'),
  'move-in-cost-calculator': () => import('./move-in-cost-calculator/page'),
  'rental-cost-comparison': () => import('./rental-cost-comparison/page'),
  'vietnamese-price-converter': () => import('./vietnamese-price-converter/page'),
}

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.resetModules()
  for (const s of RENT_TOOL_SLUGS) pages[s] = await load[s]()
  ;({ LanguageProvider } = await import('@/context/language-context'))
})
afterAll(() => { vi.unstubAllEnvs() })

async function render(slug: RentToolSlug, lang: 'en' | 'vi') {
  const tree = await pages[slug].default({ params: Promise.resolve({ lang }) })
  const el = document.createElement('div')
  el.innerHTML = renderToString(<LanguageProvider initialLang={lang} initialViDict={VI_OVERRIDES}>{tree}</LanguageProvider>)
  const nodes = [...el.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!) as Record<string, unknown>)
  return { el, nodes, text: el.textContent ?? '' }
}
const squash = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim()
const CASES = RENT_TOOL_SLUGS.flatMap((s) => (['en', 'vi'] as const).map((l) => [s, l] as const))

describe('every rent tool page, in both languages', () => {
  it.each(CASES)('%s (%s): one h1, the tool’s name, and the answer before the calculator', async (slug, lang) => {
    const { el } = await render(slug, lang)
    const h1s = el.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(squash(h1s[0].textContent)).toBe(RENT_TOOLS[slug].label[lang])
    const intro = h1s[0].nextElementSibling!
    expect(intro.tagName).toBe('P')
    expect(squash(intro.textContent).length).toBeGreaterThan(120)
    expect(intro.compareDocumentPosition(el.querySelector('form')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each(CASES)('%s (%s): the FAQPage node is the FAQ the page prints, word for word', async (slug, lang) => {
    const { el, nodes } = await render(slug, lang)
    expect(nodes.map((n) => n['@type'])).toEqual(['FAQPage'])
    const faq = nodes[0] as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] }
    const shown = [...el.querySelector('section[aria-labelledby="faq"]')!.querySelectorAll('h3')].map((q) => ({ name: squash(q.textContent), text: squash(q.nextElementSibling!.textContent) }))
    expect(faq.mainEntity.map((e) => ({ name: e.name, text: e.acceptedAnswer.text }))).toEqual(shown)
    expect(shown.length).toBeGreaterThanOrEqual(3)
    expect(shown.length).toBeLessThanOrEqual(5)
    for (const s of shown) expect(s.text.length, s.name).toBeGreaterThan(40)
  })

  it.each(CASES)('%s (%s): every control has a real <label>, and none relies on a placeholder', async (slug, lang) => {
    const { el } = await render(slug, lang)
    const controls = [...el.querySelectorAll('input, select, textarea')]
    expect(controls.length).toBeGreaterThan(0)
    for (const c of controls) {
      const id = c.getAttribute('id')
      expect(id, c.outerHTML).toBeTruthy()
      const label = el.querySelector(`label[for="${id}"]`)
      expect(label, `no <label for="${id}">`).not.toBeNull()
      expect(squash(label!.textContent).length, id!).toBeGreaterThan(2)
      expect(c.hasAttribute('placeholder'), id!).toBe(false)
    }
    const ids = controls.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(CASES)('%s (%s): how it works, a worked example, the JavaScript line; no NaN, no stray placeholder, no services word', async (slug, lang) => {
    const { el, text } = await render(slug, lang)
    expect(el.querySelector('section[aria-labelledby="how"]')).not.toBeNull()
    expect(el.querySelector('section[aria-labelledby="example"]')).not.toBeNull()
    expect(text).toContain(lang === 'vi' ? 'cần bật JavaScript' : 'needs JavaScript')
    expect(text).toContain(lang === 'vi' ? 'không được lưu hay gửi đi' : 'Nothing you type is stored or sent')
    expect(text).not.toMatch(/NaN|Infinity|undefined|\{[a-zA-Z0-9_]+\}/)
    expect(text).not.toMatch(EDITION_BANNED)
  })

  it.each(CASES)('%s (%s): links the other three tools and the right pages, at the page’s own language', async (slug, lang) => {
    const { el } = await render(slug, lang)
    const more = el.querySelector('section[aria-labelledby="more"]')!
    const hrefs = [...more.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    const v = lang === 'vi' ? '/vi' : ''
    for (const other of RENT_TOOL_SLUGS.filter((s) => s !== slug)) expect(hrefs).toContain(`${v}/${other}`)
    expect(hrefs).not.toContain(`${v}/${slug}`)
    expect(hrefs).toContain(`${v}/c/rentals`)
    if (slug !== 'vietnamese-price-converter') expect(hrefs).toContain(`${v}/hcmc-rent-index`)
  })

  it.each(CASES)('%s (%s): the head names this variant’s URL, with reciprocal hreflang', async (slug, lang) => {
    const m = await pages[slug].generateMetadata({ params: Promise.resolve({ lang }) })
    expect(m.alternates).toEqual({
      canonical: lang === 'vi' ? `/vi/${slug}` : `/${slug}`,
      languages: { en: `/${slug}`, 'vi-VN': `/vi/${slug}`, 'x-default': `/${slug}` },
    })
    expect(String(m.title)).toMatch(/\| eno\.vn$/)
    expect(String(m.description).length).toBeGreaterThanOrEqual(100)
    expect(String(m.description).length).toBeLessThanOrEqual(160)
    expect((m.openGraph as { url?: string }).url).toBe(lang === 'vi' ? `/vi/${slug}` : `/${slug}`)
  })

  it.each(RENT_TOOL_SLUGS)('%s: the Vietnamese render is Vietnamese — none of the English FAQ is left in it', async (slug) => {
    const en = await render(slug, 'en')
    const vi = await render(slug, 'vi')
    const qs = [...en.el.querySelectorAll('h3')].map((q) => squash(q.textContent))
    for (const q of qs) expect(vi.text, q).not.toContain(q)
  })

  it.each(RENT_TOOL_SLUGS)('%s: every Vietnamese FAQ answer is its own words, not an English fallback', async (slug) => {
    const answers = async (lang: 'en' | 'vi') => [...(await render(slug, lang)).el.querySelector('section[aria-labelledby="faq"]')!.querySelectorAll('h3 + p')].map((p) => squash(p.textContent))
    const [en, vi] = [await answers('en'), await answers('vi')]
    en.forEach((a, i) => expect(vi[i], a).not.toBe(a))
  })

  /**
   * ⛔ A PAIR WHOSE TWO HALVES NAME DIFFERENT `{placeholders}` PRINTS ITS ENGLISH ON THE VIETNAMESE PAGE: fillTemplate
   * falls back to the English template when the sets differ (src/lib/i18n/placeholders.ts) — which is exactly how one FAQ
   * answer of the converter shipped in English to /vi in the first draft. Every authored pair in these files, as an
   * `{ en, vi }` object or a `tr(en, vi)` / `t(en, vi)` call, is read with the TypeScript parser and compared.
   */
  it('every authored pair in the tool files names the same placeholders in both languages', () => {
    const files = [
      ...RENT_TOOL_SLUGS.flatMap((s) => ['page.tsx', 'copy.ts', 'calculator.tsx'].map((f) => `src/app/[lang]/${s}/${f}`)),
      'src/components/marketplace/rent-tool-page.tsx', 'src/components/marketplace/rent-tool-fields.tsx', 'src/lib/rent-tools/registry.ts',
    ]
    const holes = (t: string) => [...t.matchAll(/\{([A-Za-z_]\w*)\}/g)].map((m) => m[1]).sort().join(',')
    const strOf = (n: ts.Node | undefined) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null)
    let pairs = 0
    const bad: string[] = []
    for (const file of files) {
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const check = (en: string | null, vi: string | null) => {
        if (en == null || vi == null) return
        pairs++
        if (holes(en) !== holes(vi)) bad.push(`${file}: "${en}" / "${vi}"`)
      }
      const visit = (n: ts.Node) => {
        if (ts.isObjectLiteralExpression(n)) {
          const prop = (k: string) => n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === k)?.initializer
          check(strOf(prop('en')), strOf(prop('vi')))
        }
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ['tr', 't'].includes(n.expression.text)) check(strOf(n.arguments[0]), strOf(n.arguments[1]))
        n.forEachChild(visit)
      }
      visit(sf)
    }
    expect(pairs).toBeGreaterThan(150)
    expect(bad).toEqual([])
  })

  it('no source file of the four pages names a licensed-services surface', () => {
    for (const s of RENT_TOOL_SLUGS) {
      for (const f of ['page.tsx', 'copy.ts', 'calculator.tsx']) {
        expect(visibleCodeText(`src/app/[lang]/${s}/${f}`), `${s}/${f}`).not.toMatch(EDITION_BANNED)
      }
    }
    expect(visibleCodeText('src/components/marketplace/rent-tool-page.tsx')).not.toMatch(EDITION_BANNED)
    expect(visibleCodeText('src/components/marketplace/rent-tool-fields.tsx')).not.toMatch(EDITION_BANNED)
  })

  it('the services build answers 404 on every tool — they are marketplace pages', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    vi.resetModules()
    try {
      for (const s of RENT_TOOL_SLUGS) {
        const services = await load[s]()
        await expect(services.default({ params: Promise.resolve({ lang: 'en' }) }), s).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
      }
    } finally {
      vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    }
  })
})

/** Each page's worked example: the figures the server prints, in each language's grouping. */
const exampleText = async (slug: RentToolSlug, lang: 'en' | 'vi') => squash((await render(slug, lang)).el.querySelector('section[aria-labelledby="example"]')!.textContent)

describe('/rent-affordability-calculator', () => {
  it('the example: 25,000,000 đ pay and 8,500,000 đ rent → 34%, 16,500,000 đ left, between the two marks', async () => {
    const en = await exampleText('rent-affordability-calculator', 'en')
    for (const s of ['25,000,000 đ', '8,500,000 đ', '34%', '16,500,000 đ', '7,500,000 đ', '10,000,000 đ', 'above the 30% mark and within the 40% mark']) expect(en).toContain(s)
    const vi = await exampleText('rent-affordability-calculator', 'vi')
    for (const s of ['25.000.000 đ', '8.500.000 đ', '34%', '16.500.000 đ']) expect(vi).toContain(s)
  })
  it('names 30% and 40% as rules of thumb, never as a Vietnamese standard', async () => {
    const { text } = await render('rent-affordability-calculator', 'en')
    expect(text).toContain('rules of thumb, not a Vietnamese standard or rule')
    expect(text).not.toMatch(/recommended|you should spend|the standard is/i)
    const vi = await render('rent-affordability-calculator', 'vi')
    expect(vi.text).toContain('không phải tiêu chuẩn hay quy định ở Việt Nam')
  })
  it('the copy that types the example’s band agrees with the arithmetic', async () => {
    const { affordability } = await import('@/lib/rent-tools/calc')
    const { EXAMPLE } = await import('./rent-affordability-calculator/copy')
    expect(affordability(EXAMPLE.pay, EXAMPLE.rent).band).toBe('upTo40')
  })
})

describe('/move-in-cost-calculator', () => {
  it('the example: 24 + 12 + 2 + 5 million at signing, then 12 million a month from month 2', async () => {
    const en = await exampleText('move-in-cost-calculator', 'en')
    for (const s of ['24,000,000 đ', '12,000,000 đ', '2,000,000 đ', '5,000,000 đ', '43,000,000 đ', 'Each month from month 2']) expect(en).toContain(s)
    const vi = await exampleText('move-in-cost-calculator', 'vi')
    for (const s of ['24.000.000 đ', '43.000.000 đ', 'từ tháng thứ 2']) expect(vi).toContain(s)
  })
  it('the month counts typed into the copy are the example’s', async () => {
    const { EXAMPLE, INTRO } = await import('./move-in-cost-calculator/copy')
    expect(EXAMPLE.depositMonths).toBe(2)
    expect(EXAMPLE.advanceMonths).toBe(1)
    expect(INTRO.en).toContain('2 months’ deposit, 1 month paid in advance')
    expect(INTRO.vi).toContain('cọc 2 tháng, trả trước 1 tháng')
  })
  it('makes no claim about what is typical, and says to use the contract', async () => {
    const { text } = await render('move-in-cost-calculator', 'en')
    expect(text).not.toMatch(/\btypical(ly)?\b|\bnormally\b|\busually\b|\bstandard\b|\bcommon(ly)?\b/i)
    expect(text).toContain('Use the figures your contract states')
  })
})

describe('/rental-cost-comparison', () => {
  it('the example ranks B, A, C — the lowest rent is the dearest — and keeps the deposit out of the totals', async () => {
    const en = await exampleText('rental-cost-comparison', 'en')
    expect(en).toContain('Cheapest first: Home B at 141,600,000 đ, then Home A (2,400,000 đ more) and Home C (8,400,000 đ more)')
    expect(en).toContain('The deposits are not in these totals')
    const vi = await exampleText('rental-cost-comparison', 'vi')
    expect(vi).toContain('Từ rẻ nhất: Căn B với 141.600.000 đ')
  })
  it('calls the deposit’s return an assumption, not a promise', async () => {
    const { text } = await render('rental-cost-comparison', 'en')
    expect(text).toContain('That is an assumption, not a promise')
    const vi = await render('rental-cost-comparison', 'vi')
    expect(vi.text).toContain('Đây chỉ là giả định, không phải cam kết')
  })
  it('the example table says 12 months because the example is 12 months', async () => {
    const { EXAMPLE } = await import('./rental-cost-comparison/copy')
    expect(EXAMPLE.months).toBe(12)
    expect(readFileSync('src/app/[lang]/rental-cost-comparison/page.tsx', 'utf8')).toContain("'Total over 12 months'")
  })
})

describe('/vietnamese-price-converter', () => {
  it('the examples are the parser’s own readings, refusals included', async () => {
    const en = await exampleText('vietnamese-price-converter', 'en')
    for (const s of ['15,000,000 đ', '1,500,000,000 đ', '800,000 đ', '15,500,000 đ', '2,300,000,000 đ', 'mười lăm triệu năm trăm nghìn đồng', 'hai tỷ ba trăm triệu đồng']) expect(en).toContain(s)
    expect(en).toContain('Two readings: 15,500,000 đ if the digits continue the unit, or 15,050,000 đ if they are the next unit')
    expect(en).toContain('Two readings: 1,500,000,000 đ if the separator groups thousands, or 1,500,000 đ if it is a decimal point')
    const vi = await exampleText('vietnamese-price-converter', 'vi')
    for (const s of ['15.000.000 đ', '1.500.000.000 đ', '15.500.000 đ', 'Có hai cách hiểu: 15.500.000 đ']) expect(vi).toContain(s)
  })
})
