// @vitest-environment jsdom
import * as React from 'react'
import type { Metadata } from 'next'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { EDITION_BANNED } from '@/test/edition-words'
import { RENT_TOOL_SLUGS } from '@/lib/rent-tools/registry'
import { toolDigest } from '@/lib/tools/canonical'
import vectors from '@/lib/tools/test-vectors.json'

/**
 * THE GENERATED TOOL PAGE AND THE TOOLS HUB, AS RENDERED (the rent tool pages' harness): the spec's words as text, the FAQPage
 * node against the FAQ the page prints, a real <label> for every control, the worked example computed on the server in each
 * language's grouping, and the gate — an unregistered slug and the services build are 404s. A stand-in registry holds the
 * shared vector spec, since eno.vn ships with no generated tool; `state.none` empties it for the hub.
 */
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))
const state = vi.hoisted(() => ({ none: false, services: false, spec: null as null | Record<string, unknown> }))
vi.mock('@/lib/tools/content.generated', () => ({ get TOOL_CONTENT() { return state.none ? {} : { [vectors.spec.slug]: state.spec ?? vectors.spec } } }))
vi.mock('@/lib/tools/registry', async () => {
  const { toolDigest: digest } = await import('@/lib/tools/canonical')
  const v = (await import('@/lib/tools/test-vectors.json')).default
  return { get TOOLS() { return state.none ? [] : [{ slug: v.spec.slug, published: '2026-11-23', reviewed: '2026-11-23', reviewedDigest: digest(state.spec ?? v.spec) }] } }
})
vi.mock('@/lib/edition', async (orig) => ({ ...(await orig<object>()), get IS_SERVICES() { return state.services } }))
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), notFound: () => { throw new Error('NOT_FOUND') } }))

type ToolModule = { default: (p: { params: Promise<{ lang: string; slug: string }> }) => Promise<React.ReactNode>; generateMetadata: (p: { params: Promise<{ lang: string; slug: string }> }) => Promise<Metadata> }
type HubModule = { default: (p: { params: Promise<{ lang: string }> }) => Promise<React.ReactNode> }
let tool: ToolModule
let hub: HubModule
let LanguageProvider: typeof import('@/context/language-context').LanguageProvider
const SLUG = vectors.spec.slug

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.resetModules()
  tool = (await import('./[slug]/page')) as unknown as ToolModule
  hub = (await import('./page')) as unknown as HubModule
  ;({ LanguageProvider } = await import('@/context/language-context'))
})
afterAll(() => { vi.unstubAllEnvs() })

async function html(tree: React.ReactNode, lang: 'en' | 'vi') {
  const el = document.createElement('div')
  const raw = renderToString(<LanguageProvider initialLang={lang} initialViDict={VI_OVERRIDES}>{tree}</LanguageProvider>)
  el.innerHTML = raw
  const nodes = [...el.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!) as Record<string, unknown>)
  return { el, raw, nodes, text: el.textContent ?? '' }
}
const render = async (lang: 'en' | 'vi', slug = SLUG) => html(await tool.default({ params: Promise.resolve({ lang, slug }) }), lang)
const squash = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim()

describe('a generated tool page, in both languages', () => {
  it.each(['en', 'vi'] as const)('%s: one h1 (the spec’s title), the answer before the calculator', async (lang) => {
    const { el } = await render(lang)
    const h1s = el.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(squash(h1s[0].textContent)).toBe(vectors.spec.title[lang])
    expect(squash(h1s[0].nextElementSibling!.textContent)).toBe(vectors.spec.intro[lang])
    expect(h1s[0].compareDocumentPosition(el.querySelector('form')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each(['en', 'vi'] as const)('%s: the FAQPage node is the FAQ the page prints, and its JSON escapes "<"', async (lang) => {
    const { el, nodes, raw } = await render(lang)
    expect(nodes.map((n) => n['@type'])).toEqual(['FAQPage'])
    const faq = nodes[0] as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] }
    const shown = [...el.querySelector('section[aria-labelledby="faq"]')!.querySelectorAll('h3')].map((q) => ({ name: squash(q.textContent), text: squash(q.nextElementSibling!.textContent) }))
    expect(faq.mainEntity.map((e) => ({ name: e.name, text: e.acceptedAnswer.text }))).toEqual(shown)
    expect(shown.map((s) => s.name)).toEqual(vectors.spec.faqs.map((f) => f.q[lang]))
    const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(raw)![1]
    expect(script).not.toContain('<')
  })

  it.each(['en', 'vi'] as const)('%s: every control has a real <label>; money takes shorthand (inputMode text)', async (lang) => {
    const { el } = await render(lang)
    const form = el.querySelector('form')!
    for (const input of form.querySelectorAll('input:not([type="radio"]):not([aria-hidden="true"])')) {
      const label = el.querySelector(`label[for="${input.id}"]`)
      expect(label, input.outerHTML).not.toBeNull()
      expect(squash(label!.textContent).length).toBeGreaterThan(1)
    }
    const money = el.querySelector<HTMLInputElement>('#tool-rent')!
    expect(money.getAttribute('inputmode')).toBe('text')
    // The choice is a radio group named by a <label>.
    const group = form.querySelector('[role="radiogroup"]')!
    const named = el.querySelector(`#${group.getAttribute('aria-labelledby')}`)!
    expect(named.tagName).toBe('LABEL')
    expect(squash(named.textContent)).toBe(vectors.spec.inputs[2].label[lang])
  })

  it('the worked example is computed on the server, in each language’s grouping', async () => {
    const en = squash((await render('en')).el.querySelector('section[aria-labelledby="example"]')!.textContent)
    for (const s of ['12,000,000 đ', '1,500,000 đ', '2 people', '6,750,000 đ', '13,500,000 đ', '81,000,000 đ']) expect(en).toContain(s)
    const vi = squash((await render('vi')).el.querySelector('section[aria-labelledby="example"]')!.textContent)
    for (const s of ['12.000.000 đ', '2 người', '6.750.000 đ', '81.000.000 đ']) expect(vi).toContain(s)
  })

  it('how it works: each paragraph, each input and each limitation, as text', async () => {
    const how = (await render('en')).el.querySelector('section[aria-labelledby="how"]')!
    expect([...how.querySelectorAll('p')].map((p) => squash(p.textContent)).slice(0, 2)).toEqual(vectors.spec.howItWorks.en.split('\n\n'))
    expect([...how.querySelectorAll('li')].map((li) => squash(li.textContent))).toEqual(vectors.spec.limitations.en.split('\n'))
    expect([...how.querySelectorAll('dt')].map((d) => squash(d.textContent))).toEqual(vectors.spec.inputs.map((i) => i.label.en))
  })

  it('links on: its related pages in the page’s language, the rent tools and the hub', async () => {
    const hrefs = (lang: 'en' | 'vi') => render(lang).then(({ el }) => [...el.querySelector('section[aria-labelledby="more"]')!.querySelectorAll('a')].map((a) => a.getAttribute('href')))
    const en = await hrefs('en')
    expect(en.slice(0, 2)).toEqual(['/c/rentals', '/move-in-cost-calculator'])
    for (const s of RENT_TOOL_SLUGS) expect(en, s).toContain(`/${s}`)
    expect(en).toContain('/tools')
    const vi = await hrefs('vi')
    expect(vi.slice(0, 2)).toEqual(['/vi/c/rentals', '/vi/move-in-cost-calculator'])
    expect(vi).toContain('/vi/tools')
  })

  it('metadata: its own title and description, canonical per language with reciprocal /vi alternates', async () => {
    const en = await tool.generateMetadata({ params: Promise.resolve({ lang: 'en', slug: SLUG }) })
    expect(String(en.title)).toContain(vectors.spec.title.en)
    expect(en.description).toBe(vectors.spec.description.en)
    expect(en.alternates).toEqual({ canonical: `/tools/${SLUG}`, languages: { en: `/tools/${SLUG}`, 'vi-VN': `/vi/tools/${SLUG}`, 'x-default': `/tools/${SLUG}` } })
    const vi = await tool.generateMetadata({ params: Promise.resolve({ lang: 'vi', slug: SLUG }) })
    expect((vi.alternates as { canonical: string }).canonical).toBe(`/vi/tools/${SLUG}`)
  })

  it('⛔ an unregistered slug is a 404, and so is every tool on the services build', async () => {
    await expect(render('en', 'no-such-tool')).rejects.toThrow('NOT_FOUND')
    expect(await tool.generateMetadata({ params: Promise.resolve({ lang: 'en', slug: 'no-such-tool' }) })).toEqual({})
    state.services = true
    try {
      await expect(render('en')).rejects.toThrow('NOT_FOUND')
      await expect(hub.default({ params: Promise.resolve({ lang: 'en' }) })).rejects.toThrow('NOT_FOUND')
    } finally {
      state.services = false
    }
  })

  it('no licensed-services word on either page', async () => {
    for (const lang of ['en', 'vi'] as const) {
      expect((await render(lang)).text).not.toMatch(EDITION_BANNED)
      expect((await html(await hub.default({ params: Promise.resolve({ lang }) }), lang)).text).not.toMatch(EDITION_BANNED)
    }
  })
})

describe('the tools hub', () => {
  it('lists the four rent tools, then the generated ones, at each language’s address', async () => {
    const en = await html(await hub.default({ params: Promise.resolve({ lang: 'en' }) }), 'en')
    const hrefs = [...en.el.querySelectorAll('main a:not([hreflang])')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual([...RENT_TOOL_SLUGS.map((s) => `/${s}`), `/tools/${SLUG}`])
    expect(en.text).toContain(vectors.spec.title.en)
    // The English hub links its /vi twin once (vi-twin-link.tsx; owner 2026-11-24), and the Vietnamese hub links no twin back.
    expect([...en.el.querySelectorAll('main a[hreflang]')].map((a) => a.getAttribute('href'))).toEqual(['/vi/tools'])
    const vi = await html(await hub.default({ params: Promise.resolve({ lang: 'vi' }) }), 'vi')
    expect([...vi.el.querySelectorAll('main a:not([hreflang])')].map((a) => a.getAttribute('href'))).toEqual([...RENT_TOOL_SLUGS.map((s) => `/vi/${s}`), `/vi/tools/${SLUG}`])
    expect(vi.el.querySelectorAll('h1')).toHaveLength(1)
    expect(vi.el.querySelectorAll('main a[hreflang]')).toHaveLength(0)
  })

  it('renders with no generated tool at all: the four, and nothing broken', async () => {
    state.none = true
    vi.resetModules()
    try {
      const fresh = (await import('./page')) as unknown as HubModule
      const { LanguageProvider: LP } = await import('@/context/language-context')
      const el = document.createElement('div')
      el.innerHTML = renderToString(<LP initialLang="en" initialViDict={VI_OVERRIDES}>{await fresh.default({ params: Promise.resolve({ lang: 'en' }) })}</LP>)
      expect([...el.querySelectorAll('main a:not([hreflang])')].map((a) => a.getAttribute('href'))).toEqual(RENT_TOOL_SLUGS.map((s) => `/${s}`))
    } finally {
      state.none = false
    }
  })

  it('the stand-in registry carries the vector spec’s real digest', () => expect(toolDigest(vectors.spec)).toBe(vectors.digest))
})

describe('input values at the input’s precision', () => {
  it('the worked example prints a 7.25% input as 7.25%, not an output’s 7.3%', async () => {
    const spec = JSON.parse(JSON.stringify(vectors.spec))
    spec.inputs.push({ id: 'rate', kind: 'percent', label: { en: 'Yearly increase', vi: 'Mức tăng mỗi năm' }, help: { en: 'What the contract says.', vi: 'Theo hợp đồng.' }, default: 7.25, min: 0.25, max: 50 })
    spec.outputs.push({ id: 'nextRent', label: { en: 'Rent next year', vi: 'Tiền thuê năm sau' }, formula: 'rent * (100 + rate) / 100', format: 'money' })
    spec.example.inputs.rate = 7.25
    for (const t of spec.tests) t.inputs.rate = 7.25
    spec.tests[0].expect.nextRent = 12870000
    state.spec = spec
    vi.resetModules()
    try {
      const fresh = (await import('./[slug]/page')) as unknown as ToolModule
      const { LanguageProvider: LP } = await import('@/context/language-context')
      for (const [lang, figure] of [['en', '7.25%'], ['vi', '7,25%']] as const) {
        const el = document.createElement('div')
        el.innerHTML = renderToString(<LP initialLang={lang} initialViDict={VI_OVERRIDES}>{await fresh.default({ params: Promise.resolve({ lang, slug: SLUG }) })}</LP>)
        const example = squash(el.querySelector('section[aria-labelledby="example"]')!.textContent)
        expect(example, lang).toContain(figure)
        expect(example, lang).not.toContain(lang === 'en' ? '7.3%' : '7,3%')
      }
    } finally {
      state.spec = null
    }
  })
})
