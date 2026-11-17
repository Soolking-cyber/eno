import { afterEach, describe, expect, it, vi } from 'vitest'

// The suite runs as the services edition (vitest.config.ts); each test picks its edition and reloads the module.
const edition = vi.hoisted(() => ({ services: false }))
vi.mock('@/lib/edition', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/edition')>()
  return {
    ...real,
    get IS_SERVICES() { return edition.services },
    get IS_MARKETPLACE() { return !edition.services },
    get SITE_NAME() { return edition.services ? 'eno.forum' : 'eno.vn' },
  }
})
const load = async () => { vi.resetModules(); return import('./home-faq') }
afterEach(() => { edition.services = false })

describe('the home FAQ', () => {
  it('the FAQPage JSON-LD is exactly the pairs the page draws, in the variant\'s language, {site} filled', async () => {
    const { HOME_FAQ, homeFaqJsonLd, fillSite } = await load()
    for (const lang of ['en', 'vi'] as const) {
      const ld = homeFaqJsonLd(lang) as { '@type': string; inLanguage: string; mainEntity: { name: string; acceptedAnswer: { text: string } }[] }
      expect(ld['@type']).toBe('FAQPage')
      expect(ld.inLanguage).toBe(lang)
      expect(ld.mainEntity.map((q) => q.name)).toEqual(HOME_FAQ.map((p) => fillSite(p.q[lang])))
      expect(ld.mainEntity.map((q) => q.acceptedAnswer.text)).toEqual(HOME_FAQ.map((p) => fillSite(p.a[lang])))
      expect(JSON.stringify(ld)).not.toContain('{site}')
    }
  })

  it('every string stays under the 200-character harvest cap, and every pair is authored in both languages', async () => {
    const { HOME_FAQ, HOME_FAQ_HEADING } = await load()
    for (const t of [HOME_FAQ_HEADING, ...HOME_FAQ.flatMap((p) => [p.q, p.a])]) {
      expect(t.en.length).toBeLessThan(200)
      expect(t.vi.length).toBeLessThan(200)
      expect(t.vi).not.toBe(t.en)
    }
  })

  it('the AI-assistant answer is the marketplace\'s only; eno.forum names itself and never eno.vn', async () => {
    const mk = await load()
    expect(mk.HOME_FAQ.some((p) => p.q.en.includes('AI assistant'))).toBe(true)
    edition.services = true
    const sv = await load()
    expect(sv.HOME_FAQ.some((p) => p.q.en.includes('AI assistant'))).toBe(false)
    const text = JSON.stringify(sv.homeFaqJsonLd('en'))
    expect(text).toContain('eno.forum')
    expect(text).not.toContain('eno.vn')
  })

  it('⛔ the "paying us is a scam" sentence is the marketplace\'s only: the forum\'s own visa desk takes payment in its chat', async () => {
    const pay = (m: Awaited<ReturnType<typeof load>>) => m.HOME_FAQ.find((p) => p.q.en === 'How do payments work?')!.a
    expect(pay(await load()).en).toContain('scam')
    edition.services = true
    const sv = pay(await load())
    expect(sv.en).not.toContain('scam')
    expect(sv.vi).not.toContain('lừa đảo')
  })

  it('the home page renders it after the feed', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../app/[lang]/(home)/page.tsx', import.meta.url), 'utf8')
    expect(src.indexOf('<HomeFaq lang={lang} />')).toBeGreaterThan(src.indexOf('<ListingsExplorer'))
  })
})
