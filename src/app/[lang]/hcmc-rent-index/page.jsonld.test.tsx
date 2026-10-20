// @vitest-environment jsdom
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { APARTMENT_BANDS, RENT_INDEX_RULES_VERSION, RENT_TYPES, type RentIndex, type Stats } from '@/lib/rent-index'

/**
 * /hcmc-rent-index AS RENDERED — the JSON-LD nodes the page emits and the owner-decision-9 words it prints, read from
 * the page's own output rather than from its source text. The snapshot loader, the header, the footer and the teacher-
 * guide links are stand-ins; the JSON-LD, the FAQ, the methodology and the cite box are the real ones.
 * ⛔ WITHOUT FIGURES THERE IS NO FAQPage AND NO Dataset NODE: the first FAQ answer points at "the figures at the top of
 * this page", which a could-not-read render does not show, and a Dataset would describe data the page is not showing.
 * ⛔ NO `license` KEY IN ANY NODE (owner ruling R-f, restated by owner decision 9) — checked on the PARSED nodes, so no
 * spelling of the key in the source (a computed `['license']`, a spread) gets past it.
 * ⚠️ `language-context` IS IMPORTED AFTER `vi.resetModules()`, like the page: a provider from a module instance the
 * page does not share would hand its <Tr>s a context nobody provided.
 */
const h = vi.hoisted(() => ({ lookup: { known: false } as unknown, loads: 0 }))
vi.mock('./load-rent-index', () => ({ loadRentIndex: async () => { h.loads++; return h.lookup } }))
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))
vi.mock('@/lib/teach-guides/site-links', () => ({ teachGuideLinks: () => [] }))

const empty: Stats = { n: 0, median: null, p25: null, p75: null, nArea: 0, medianPerM2: null }
/** The shape of the live snapshot of 2026-10-20 10:59 UTC: apartments only, GoPlus plus one member's post. */
const index: RentIndex = {
  rulesVersion: RENT_INDEX_RULES_VERSION,
  computedAt: '2026-10-20T10:59:54.980Z',
  read: 2_717,
  used: 2_479,
  excluded: { notResidential: 238, notForRent: 0, currency: 0, unit: 0, belowBand: 0, aboveBand: 0, commercial: 0, crossPosted: 0 },
  cityWide: {
    ...Object.fromEntries(RENT_TYPES.map((t) => [t, empty])),
    apartment: { n: 2_479, median: 4_500_000, p25: 3_800_000, p75: 5_600_000, nArea: 2_465, medianPerM2: 220_000 },
  } as RentIndex['cityWide'],
  cityBands: Object.fromEntries(APARTMENT_BANDS.map((b) => [b, empty])) as RentIndex['cityBands'],
  districts: [],
  unassigned: 7,
  sources: [{ kind: 'partner', name: 'GoPlus' }, { kind: 'members' }],
}

type Page = typeof import('./page')
let page: Page
let LanguageProvider: typeof import('@/context/language-context').LanguageProvider

beforeAll(async () => {
  // A marketplace page (the services build 404s it): SITE_NAME and the origin are eno.vn's.
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.resetModules()
  page = await import('./page')
  ;({ LanguageProvider } = await import('@/context/language-context'))
})
// The edition is read once, at import; give the worker its environment back for the next file.
afterAll(() => { vi.unstubAllEnvs() })
beforeEach(() => { h.lookup = { known: true, index } })

async function render(lang: 'en' | 'vi') {
  const tree = await page.default({ params: Promise.resolve({ lang }) })
  const el = document.createElement('div')
  // The curated Vietnamese the app loads for a Vietnamese render, so <Tr> prints what a reader sees.
  el.innerHTML = renderToString(<LanguageProvider initialLang={lang} initialViDict={VI_OVERRIDES}>{tree}</LanguageProvider>)
  const nodes = [...el.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!) as Record<string, unknown>)
  return { el, nodes }
}

/** Every key of every object in a JSON value, at any depth. */
const keysDeep = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap(keysDeep)
    : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)])
      : []

describe('/hcmc-rent-index JSON-LD, as rendered', () => {
  it.each(['en', 'vi'] as const)('%s: with figures — the breadcrumb, the FAQ and the Dataset, and no licence key in any node', async (lang) => {
    const { nodes } = await render(lang)
    expect(nodes.map((n) => n['@type'])).toEqual(['BreadcrumbList', 'FAQPage', 'Dataset'])
    expect(keysDeep(nodes).filter((k) => /licen[cs]e/i.test(k))).toEqual([])
    const dataset = nodes.find((n) => n['@type'] === 'Dataset')!
    expect(dataset.usageInfo).toBe('https://eno.vn/hcmc-rent-index#cite')
    // Rules v5: the bands the page and the CSV publish, Studio among them.
    expect(dataset.description).toContain('for apartments (also for studios and by 1, 2 and 3+ bedrooms), houses and rooms')
  })

  it.each(['en', 'vi'] as const)('%s: without figures — the breadcrumb alone: no FAQPage, no Dataset', async (lang) => {
    h.lookup = { known: false }
    const { nodes } = await render(lang)
    expect(nodes.map((n) => n['@type'])).toEqual(['BreadcrumbList'])
  })

  it.each(['en', 'vi'] as const)('%s: every FAQPage question and answer is the text the page prints', async (lang) => {
    const { el, nodes } = await render(lang)
    const faq = nodes.find((n) => n['@type'] === 'FAQPage') as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] }
    const shown = [...el.querySelector('section[aria-labelledby="faq"]')!.querySelectorAll('h3')]
      .map((q) => ({ name: q.textContent, text: q.nextElementSibling!.textContent }))
    expect(faq.mainEntity.map((e) => ({ name: e.name, text: e.acceptedAnswer.text }))).toEqual(shown)
    expect(shown).toHaveLength(3)
    // The third answer is the decision-9 terms, in the page's language.
    expect(shown[2].text).toContain(lang === 'vi'
      ? 'Vui lòng ghi nguồn eno.vn; chúng tôi hoan nghênh liên kết đến https://eno.vn/hcmc-rent-index, kể cả liên kết nofollow.'
      : 'Please credit eno.vn; a link to https://eno.vn/hcmc-rent-index is welcome and may be nofollow.')
  })
})

describe('/hcmc-rent-index words, as rendered', () => {
  it.each(['en', 'vi'] as const)('%s: the cite box states the decision-9 terms and the method names the snapshot\'s sources', async (lang) => {
    const { el } = await render(lang)
    expect(el.querySelector('#cite p')!.textContent).toBe(lang === 'vi'
      ? 'Được tự do trích dẫn. Vui lòng ghi nguồn eno.vn; chúng tôi hoan nghênh liên kết, kể cả liên kết nofollow.'
      : 'Free to cite and quote. Please credit eno.vn; a link is welcome and may be nofollow.')
    const method = el.querySelector('section[aria-labelledby="method"]')!
    const line = [...method.querySelectorAll('p')].map((p) => p.textContent).find((t) => /Sources in this snapshot|Nguồn của số liệu lần này/.test(t!))
    expect(line).toBe(lang === 'vi'
      ? 'Nguồn của số liệu lần này: GoPlus (tin đăng của đối tác chính thức của eno.vn) · tin do thành viên eno.vn đăng. Số liệu luôn được gộp chung, không bao giờ tách theo nguồn.'
      : 'Sources in this snapshot: GoPlus (an official eno.vn partner\'s own listings) · listings posted by eno.vn members. The figures are always pooled and never broken down by source.')
    // The old fixed five-portal sentence is gone from the whole page, and no licensed-services word is printed on it.
    expect(el.textContent).not.toMatch(/Compiled from public listings|Tổng hợp từ các tin đăng công khai/)
    expect(el.textContent).not.toMatch(/\bvisas?\b|\bitinerar|lịch trình|paypal/i)
  })

  it('the services build still answers 404 before reading the snapshot — the page stays marketplace-only', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    vi.resetModules()
    try {
      const services = await import('./page')
      const before = h.loads
      await expect(services.default({ params: Promise.resolve({ lang: 'en' }) })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
      expect(h.loads).toBe(before)
    } finally {
      vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    }
  })
})
