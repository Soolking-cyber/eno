// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { NAV_CATEGORIES } from '@/lib/taxonomy-nav'

/**
 * THE FOOTER IS THE MOST-REPEATED SET OF INTERNAL LINKS ON BOTH EDITIONS (~250 prerendered routes), so
 * what it points at is checked here rather than trusted.
 *
 * ⚠️ THE EDITION IS A MODULE-LEVEL CONSTANT (src/lib/edition.ts reads NEXT_PUBLIC_ENO_EDITION once, at
 * import), and vitest pins it to 'services'. So each render re-imports the footer AND the language
 * context after stubbing the env — the context has to come from the same module instance as the
 * footer's `useLanguage`, or the provider and the consumer would be two different contexts.
 */
type Edition = 'marketplace' | 'services'

async function renderFooter(edition: Edition, lang: 'en' | 'vi') {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  // A stored choice, so the provider's mount-time reconcile keeps `lang` instead of swapping to the
  // test runner's device language (jsdom reports en-US) — see language-context.tsx.
  const store = new Map<string, string>([['lang', lang]])
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  })
  const { LanguageProvider } = await import('@/context/language-context')
  // The footer's language + currency control (footer-preferences.tsx) reads the currency context, as
  // it does under the app's providers.tsx.
  const { CurrencyProvider } = await import('@/context/currency-context')
  const { Footer } = await import('./footer')
  // `initialViDict` so a Vietnamese render does not suspend on the dictionary fetch.
  const { container } = render(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      <CurrencyProvider>
        <Footer />
      </CurrencyProvider>
    </LanguageProvider>,
  )
  return { container, hrefs: [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '') }
}

// FooterStats heartbeats /api/site-stats on mount; nothing here is about that.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const EDITIONS: Edition[] = ['marketplace', 'services']
// + the shelves the second-hand focus emptied (2026-10-03) and sports (0 live since 2026-10-02).
const DEAD = [
  '/motorbikes-for-sale-vietnam', '/c/property', '/c/moving-sale', '/c/community-events',
  '/c/vehicles', '/c/pets', '/c/books-stationery', '/c/hobbies-sports', '/c/sports',
]

describe('Footer links', () => {
  for (const edition of EDITIONS) {
    for (const lang of ['en', 'vi'] as const) {
      it(`${edition}/${lang}: links none of the empty, noindexed destinations measured on 2026-09-27`, async () => {
        const { hrefs } = await renderFooter(edition, lang)
        for (const dead of DEAD) expect(hrefs, dead).not.toContain(dead)
      })

    }
  }

  for (const lang of ['en', 'vi'] as const) {
    it(`marketplace/${lang}: links the rentals category and the guides that replaced them`, async () => {
      const { hrefs, container } = await renderFooter('marketplace', lang)
      expect(hrefs).toContain('/c/rentals')
      expect(container.textContent).toContain(lang === 'vi' ? 'Căn hộ cho thuê tại TP.HCM' : 'Apartments for rent in Ho Chi Minh City')
      expect(hrefs).toContain('/renting-an-apartment-vietnam-foreigner')
      expect(hrefs).toContain('/hcmc-rent-index')
      expect(container.textContent).toContain(lang === 'vi' ? 'Chỉ số giá thuê nhà TP.HCM' : 'HCMC Rent Index')
      // A bilingual pair: the href follows the language. The used-iPhone guide since 2026-10-03.
      expect(hrefs).toContain(lang === 'vi' ? '/kinh-nghiem-mua-iphone-cu' : '/buying-a-used-iphone-vietnam')
      expect(hrefs).not.toContain(lang === 'vi' ? '/buying-a-used-iphone-vietnam' : '/kinh-nghiem-mua-iphone-cu')
      expect(container.textContent).toContain(lang === 'vi' ? 'Kinh nghiệm mua iPhone cũ' : 'Buying a used iPhone in Vietnam')
      for (const href of ['/best-place-to-buy-iphone-vietnam', '/mua-iphone-o-dau-uy-tin']) expect(hrefs).not.toContain(href)
      // The teacher-ranked school directory (2026-10-04).
      expect(hrefs).toContain('/schools')
      expect(container.textContent).toContain(lang === 'vi' ? 'Trường ở Sài Gòn do giáo viên xếp hạng' : 'Saigon schools ranked by teachers')
    })

    // ⚠️ Not on eno.forum: there they would promote eno.forum's duplicate copies of eno.vn's pages
    // (self-canonical, indexable) before the owner decides the cross-host canonicals.
    it(`services/${lang}: does not promote the forum's copies of the rentals page or the guides`, async () => {
      const { hrefs, container } = await renderFooter('services', lang)
      expect(container.textContent).not.toContain(lang === 'vi' ? 'Căn hộ cho thuê tại TP.HCM' : 'Apartments for rent in Ho Chi Minh City')
      for (const href of ['/renting-an-apartment-vietnam-foreigner', '/buying-a-used-iphone-vietnam', '/kinh-nghiem-mua-iphone-cu', '/schools']) {
        expect(hrefs).not.toContain(href)
      }
    })

    // ⛔ Harder than the copies above: /hcmc-rent-index is notFound() on eno.forum, so this would be a 404.
    it(`services/${lang}: never links the rent index, which 404s on eno.forum`, async () => {
      const { hrefs } = await renderFooter('services', lang)
      expect(hrefs.filter((h) => h.startsWith('/hcmc-rent-index'))).toEqual([])
    })
  }

  it('renders the new labels in Vietnamese on a Vietnamese page', async () => {
    const { container } = await renderFooter('marketplace', 'vi')
    expect(container.textContent).toContain('Căn hộ cho thuê tại TP.HCM')
    expect(container.textContent).toContain('Kinh nghiệm thuê căn hộ cho người nước ngoài')
  })

  it('still links every category that is not deliberately hidden', async () => {
    const { FOOTER_HIDDEN_CATEGORIES } = await import('./footer')
    const { hrefs } = await renderFooter('marketplace', 'en')
    for (const c of NAV_CATEGORIES) {
      if (FOOTER_HIDDEN_CATEGORIES.has(c.slug)) continue
      expect(hrefs).toContain(`/c/${c.slug}`)
    }
  })

  it('every hidden slug is a real category — a rename cannot leave a dead entry behind', async () => {
    const { FOOTER_HIDDEN_CATEGORIES } = await import('./footer')
    const slugs = new Set(NAV_CATEGORIES.map((c) => c.slug))
    for (const s of FOOTER_HIDDEN_CATEGORIES) expect(slugs.has(s), s).toBe(true)
  })

  // One anchor per SOCIALS entry, each with a mark and its own label — so a channel added to the list
  // without a SOCIAL_ICON / socialAria entry fails here and not on a live page.
  it('links every channel, rel="me" exactly where socials.ts claims the identity', async () => {
    const { SOCIALS } = await import('@/lib/socials')
    const { container } = await renderFooter('marketplace', 'en')
    for (const s of SOCIALS) {
      const a = container.querySelector(`a[href="${s.href}"]`)
      expect(a, s.key).not.toBeNull()
      expect(a?.querySelector('svg'), s.key).not.toBeNull()
      expect(a?.getAttribute('aria-label'), s.key).toMatch(/^ENO on /)
      expect(a?.getAttribute('rel')?.split(' ').includes('me'), s.key).toBe(s.me === true)
    }
    expect(container.querySelector('a[href="https://www.linkedin.com/company/eno-vn/"]')?.getAttribute('aria-label')).toBe('ENO on LinkedIn')
  })

  it('labels the LinkedIn mark in Vietnamese on a Vietnamese page', async () => {
    const { container } = await renderFooter('marketplace', 'vi')
    expect(container.querySelector('a[href="https://www.linkedin.com/company/eno-vn/"]')?.getAttribute('aria-label')).toBe('ENO trên LinkedIn')
  })

  it('⛔ carries no services vocabulary on the marketplace edition, in either language', async () => {
    for (const lang of ['en', 'vi'] as const) {
      const { container, hrefs } = await renderFooter('marketplace', lang)
      const text = `${container.textContent} ${hrefs.join(' ')}`
      expect(text).not.toMatch(/visa|passport|VietKite|PayPal|itinerar|thị thực|hộ chiếu|lịch trình|xuất nhập cảnh/i)
      cleanup()
    }
  })

  // ⚠️ THE CONTACT PAGE, NOT A mailto: (C-CONTACT, 2026-09-29) — /contact existed and nothing linked it.
  it('"Contact us" goes to /contact on both editions', async () => {
    for (const edition of EDITIONS) {
      const { container } = await renderFooter(edition, 'en')
      const contact = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Contact us')
      expect(contact?.getAttribute('href'), edition).toBe('/contact')
      cleanup()
    }
  })

  /**
   * ⛔ THE PHONE ACCORDION IS LOAD-BEARING ON BASE UI'S data-slot NAMES. globals.css hides
   * `#app-footer [data-slot=accordion-header]` and forces every `[data-slot=accordion-panel]` open from
   * 40rem; if either name changed, the desktop footer would collapse into five closed groups. And the
   * closed panels must still hold every link (hiddenUntilFound), or the crawl paths go with them.
   */
  it('renders each link group as an accordion item whose closed panel still holds its links', async () => {
    const { container, hrefs } = await renderFooter('marketplace', 'en')
    const headers = container.querySelectorAll('#app-footer [data-slot=accordion-header]')
    const panels = container.querySelectorAll('#app-footer [data-slot=accordion-panel]')
    expect(headers.length).toBe(5) // Explore + the four columns (Community is empty on both editions)
    expect(panels.length).toBe(5)
    // Each group keeps a static h3 for sm+, and the accordion header is itself an h3.
    expect([...headers].every((h) => h.tagName === 'H3')).toBe(true)
    for (const href of ['/c/rentals', '/help', '/about', '/post', '/hcmc-rent-index']) expect(hrefs).toContain(href)
    for (const p of panels) expect(p.querySelectorAll('a').length, p.textContent ?? '').toBeGreaterThan(0)
  })

  /**
   * ⛔ THE DESKTOP OVERRIDE HAS TO WIN BEFORE HYDRATION, NOT ONLY AFTER. React SSRs a closed panel as a
   * plain `hidden=""` (it only knows the boolean); Base UI writes `until-found` in a client layout
   * effect. Until then Tailwind preflight's `[hidden]:where(:not([hidden='until-found']))` hides it with
   * a LAYERED !important, which beats any normal declaration and any unlayered !important. Measured at
   * 1280 with the JS chunks blocked, an unlayered `display: block` left all five lists display:none,
   * with the footer at 711px, then 1,048px after hydration. Only a same-layer !important with the higher
   * (id) specificity outranks it.
   */
  it('forces the desktop panels open in @layer base with !important, so they show before hydration', () => {
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')
    expect(css).toMatch(
      /@layer base \{\s*@media \(min-width: 40rem\) \{\s*#app-footer \[data-slot=accordion-panel\] \{ display: block !important; \}/,
    )
  })

  // ⛔ O-04 (owner-approved 2026-09-29): no dashed "App Store · coming soon" chip while there is no link.
  it('shows a store only when it has a link — no "coming soon" chip', async () => {
    for (const lang of ['en', 'vi'] as const) {
      const { container, hrefs } = await renderFooter('marketplace', lang)
      expect(container.textContent).not.toMatch(/coming soon|sắp có/)
      expect(hrefs.some((h) => h.startsWith('https://play.google.com/'))).toBe(true)
      cleanup()
    }
  })

  // G-LANG: a guest's only way to change language or currency. Both editions, both languages.
  it('offers a language and a currency control to every visitor', async () => {
    for (const edition of EDITIONS) {
      const { container } = await renderFooter(edition, 'en')
      const group = container.querySelector('#app-footer [role=group][aria-label="Language and currency"]')
      expect(group, edition).not.toBeNull()
      expect(group?.textContent).toContain('English')
      expect(group?.textContent).toContain('₫')
      cleanup()
    }
  })
})
