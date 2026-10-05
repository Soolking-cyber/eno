// @vitest-environment jsdom
/**
 * Two /post defects from the UX3 navigation audit (2026-10-05), read from the wizard's server render the way
 * post-wizard.sell.test.tsx reads it — no effect runs first, so this is the markup a seller is handed.
 *   · N6b — "Thoát" was `<Link href="/">`, and `/` is the English-pinned pilot path: a Vietnamese seller who
 *     left the form landed on the English home. It goes through localizedHref now: `/vi` for Vietnamese.
 *   · N11 — "Tủ lạnh Toshiba 180L" under Nhà cửa › Điện máy was offered "Gợi ý: Tủ kệ?". The suggester now
 *     prefers the longest keyword (taxonomy.suggest.test.ts), and there is no chip at all while the chosen
 *     subcategory's own keywords already match the title.
 */
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ListingEditData } from './post-wizard'
import type { SerializedCategory } from '@/lib/types'

const h = vi.hoisted(() => ({
  router: { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} },
  language: { lang: 'en', t: (k: string) => k, tr: (en: string, vi?: string) => en, setLang: () => {} } as {
    lang: string; t: (k: string) => string; tr: (en: string, vi?: string) => string; setLang: () => void
  },
  auth: { user: { id: 'u1' }, profile: null, loading: false, openSignIn: () => {} },
}))

vi.mock('next/navigation', () => ({ useRouter: () => h.router, usePathname: () => '/post', useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => h.language,
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth }))
vi.mock('@/context/currency-context', () => ({
  vndPerUsd: () => null,
  useCurrency: () => ({ currency: 'VND', rates: null, ratesPending: false, format: (n: number) => String(n) }),
}))
vi.mock('./square-crop-dialog', () => ({ SquareCropDialog: () => null }))
// vitest runs as the SERVICES edition, where the `/vi` pilot is off; put the marketplace's lists in front
// (the same stand-in as not-found-body.test.tsx).
vi.mock('@/lib/lang-pinned', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/lang-pinned')>()
  return { ...m, localizedHref: (href: string, variant: string) => m.localizedHref(href, variant, { live: m.VI_PREFIX_PATHS, retired: [] }) }
})

const { PostWizard } = await import('./post-wizard')

const cat = (slug: string, name: string, nameVi: string) => ({ id: `c-${slug}`, slug, name, nameVi, icon: 'Package', color: 'blue' })
const CATS = [
  cat('electronics', 'Electronics', 'Điện tử'), cat('furniture-appliances', 'Home', 'Nhà cửa'), cat('rentals', 'Rentals', 'Cho thuê'),
] as unknown as SerializedCategory[]

const fridge: ListingEditData = {
  id: 'l1', title: 'Tủ lạnh Toshiba 180L', description: 'Còn mới 90%, chạy êm, giao trong Quận 7.',
  price: 3_500_000, negotiable: true, urgent: false, categorySlug: 'furniture-appliances', subcategorySlug: 'white-goods', listingType: 'sell',
  condition: 'used', brand: null, model: null, attributes: {}, year: null, mileageKm: null, engineL: null, engineCc: null,
  areaM2: null, salaryM: null, district: 'Quận 7', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
}

function render(lang: 'en' | 'vi', edit?: ListingEditData): string {
  h.language = {
    ...h.language,
    lang,
    tr: lang === 'vi' ? (en: string, vi?: string) => vi ?? en : (en: string) => en,
  }
  return renderToString(<PostWizard categories={CATS} edit={edit} />)
}

/** The href of the anchor whose text holds `label` — the wizard's own exit link. */
function hrefOf(html: string, label: string): string | null {
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    if (m[2].replace(/<[^>]+>/g, '').includes(label)) return m[1].match(/\bhref="([^"]*)"/)?.[1] ?? null
  }
  return null
}

describe('/post "Thoát / Exit" (N6b)', () => {
  it('a Vietnamese seller exits to /vi, the Vietnamese home — never the English-pinned /', () => {
    expect(hrefOf(render('vi'), 'Thoát')).toBe('/vi')
  })

  it('an English seller exits to /', () => {
    expect(hrefOf(render('en'), 'Exit')).toBe('/')
  })
})

describe('/post subcategory suggestion (N11)', () => {
  // The chip's own text — "Gợi ý: <subcategory>?" — not the shot list's "Gợi ý ảnh nên chụp" heading.
  const CHIP_VI = /Gợi ý: [^<]*\?/
  const CHIP_EN = /Suggestion: [^<]*\?/
  it('no chip for "Tủ lạnh Toshiba 180L" filed under Điện máy — the pick already matches the title', () => {
    expect(render('vi', fridge)).not.toMatch(CHIP_VI)
    expect(render('en', fridge)).not.toMatch(CHIP_EN)
  })

  it('no chip either when the pick is Tủ kệ — "tủ" is its own word, so the seller is not second-guessed', () => {
    expect(render('vi', { ...fridge, subcategorySlug: 'storage' })).not.toMatch(CHIP_VI)
  })

  it('a pick the title does not describe gets the LONGEST match: Điện máy, not Tủ kệ', () => {
    const html = render('vi', { ...fridge, subcategorySlug: 'sofa-seating' })
    expect(html).toContain('Gợi ý: Điện máy?')
    expect(html).not.toContain('Gợi ý: Tủ kệ?')
    expect(render('en', { ...fridge, subcategorySlug: 'sofa-seating' })).toContain('Suggestion: Appliances?')
  })

  it('existing suggestions still work: a phone title under Laptops is offered Phones', () => {
    const html = render('en', {
      ...fridge, title: 'iPhone 13 128GB', categorySlug: 'electronics', subcategorySlug: 'laptops-pcs', brand: 'Apple', model: 'iPhone 13',
    })
    expect(html).toContain('Suggestion: Phones?')
  })
})
