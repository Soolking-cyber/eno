// @vitest-environment jsdom
import * as React from 'react'
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
  const { Footer } = await import('./footer')
  // `initialViDict` so a Vietnamese render does not suspend on the dictionary fetch.
  const { container } = render(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      <Footer />
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
const DEAD = ['/motorbikes-for-sale-vietnam', '/c/property', '/c/moving-sale', '/c/community-events']

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
      // A bilingual pair: the href follows the language.
      expect(hrefs).toContain(lang === 'vi' ? '/mua-iphone-o-dau-uy-tin' : '/best-place-to-buy-iphone-vietnam')
      expect(hrefs).not.toContain(lang === 'vi' ? '/best-place-to-buy-iphone-vietnam' : '/mua-iphone-o-dau-uy-tin')
    })

    // ⚠️ Not on eno.forum: there they would promote eno.forum's duplicate copies of eno.vn's pages
    // (self-canonical, indexable) before the owner decides the cross-host canonicals.
    it(`services/${lang}: does not promote the forum's copies of the rentals page or the guides`, async () => {
      const { hrefs, container } = await renderFooter('services', lang)
      expect(container.textContent).not.toContain(lang === 'vi' ? 'Căn hộ cho thuê tại TP.HCM' : 'Apartments for rent in Ho Chi Minh City')
      for (const href of ['/renting-an-apartment-vietnam-foreigner', '/best-place-to-buy-iphone-vietnam', '/mua-iphone-o-dau-uy-tin']) {
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
})
