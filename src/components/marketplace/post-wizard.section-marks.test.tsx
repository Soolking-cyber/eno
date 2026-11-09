// @vitest-environment jsdom
/**
 * THE PHONE SEES WHAT EACH SECTION STILL NEEDS (UI climb 2026-11-09, phone UX hunt). Desktop lists the publish steps under
 * Publish; the phone had only "N items left" naming the first, and its "Still needed" chips appear only after a failed Publish.
 * Each section heading now carries its state below lg — ✓ done, "Needed" open — a view of the same `steps` the badge counts.
 * Never on an edit. Before a category is picked the photo step names no number ("Add photos"): the minimum is the category's.
 * Read from the server render, as post-wizard.sell.test.tsx does: a guest's count is ready at once.
 */
import { renderToString } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingEditData } from './post-wizard'
import type { SerializedCategory } from '@/lib/types'

const h = vi.hoisted(() => ({
  router: { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} },
  language: { lang: 'en', t: (k: string) => k, tr: (en: string) => en, setLang: () => {} },
  auth: { user: null as { id: string } | null, profile: null, loading: false, openSignIn: () => {} },
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
// react-easy-crop's stylesheet cannot load under the test transform; the dialog renders nothing here.
vi.mock('./square-crop-dialog', () => ({ SquareCropDialog: () => null }))

const { PostWizard } = await import('./post-wizard')

afterEach(() => cleanup())

const cat = (slug: string, name: string, icon = 'Package') => ({ id: `c-${slug}`, slug, name, nameVi: name, icon, color: 'blue' })
// The order /post hands them over in: by ENGLISH name (post/page.tsx).
const CATS = [
  cat('baby-kids', 'Baby & kids'), cat('electronics', 'Electronics'), cat('fashion-beauty', 'Fashion & beauty'),
  cat('furniture-appliances', 'Furniture & appliances'), cat('jobs', 'Jobs'), cat('moving-sale', 'Moving sale'),
  cat('pets', 'Pets'), cat('property', 'Property'), cat('rentals', 'Rentals'), cat('services', 'Services'), cat('vehicles', 'Vehicles'),
] as unknown as SerializedCategory[]

const base: ListingEditData = {
  id: 'l1', title: 'Honda Vision 2022 for rent', description: 'Helmet included, delivery in District 1 and 3.',
  price: 150_000, negotiable: true, urgent: false, categorySlug: 'rentals', subcategorySlug: 'motorbike-rental', listingType: 'rent',
  condition: null, brand: 'Honda', model: 'Vision', attributes: { rentalPeriod: 'daily' }, year: null, mileageKm: null, engineL: null, engineCc: null,
  areaM2: null, salaryM: null, district: 'Quận 1', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
}
const html = (edit?: ListingEditData) => renderToString(<PostWizard categories={CATS} edit={edit} />)

afterEach(() => { h.auth.user = null })

const marksIn = (page: string) => (page.match(/<span class="lg:hidden"><span class="text-xs font-medium text-ink-4">Needed<\/span><\/span>/g) ?? []).length

describe('post wizard — section marks on a phone', () => {
  it('a fresh guest form: the open sections say "Needed", phone only', () => {
    const page = html()
    expect(marksIn(page)).toBeGreaterThanOrEqual(3)
    // Photos and Category lead the form; both are open on a fresh form.
    expect(page).toMatch(/>Photos<\/h2><span class="lg:hidden"><span class="text-xs font-medium text-ink-4">Needed/)
    expect(page).toMatch(/>Category<\/h2><span class="lg:hidden"><span class="text-xs font-medium text-ink-4">Needed/)
  })

  it('before a category, the photo step names no number', () => {
    const page = html()
    expect(page).toContain('Add photos')
    expect(page).not.toContain('Add 3 photos')
  })

  it('a guest is told sign-in comes last, on the phone line under the title', () => {
    expect(html()).toContain('sign-in comes last, when you publish.')
  })

  it('an edit shows no marks at all', () => {
    h.auth.user = { id: 'u1' }
    const page = html(base)
    expect(marksIn(page)).toBe(0)
    expect(page).not.toContain('<span class="sr-only">Done</span>')
  })
})

describe('post wizard — a section turns ✓ when its steps are done (client render)', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)) },
      removeItem: (k: string) => { store.delete(k) }, clear: () => store.clear(), key: () => null, length: 0,
    })
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('picking a category puts a ✓ on the Category heading, and Photos still says "Needed"', async () => {
    render(<PostWizard categories={CATS} />)
    const heading = () => screen.getByRole('heading', { level: 2, name: 'Category' })
    expect(heading().parentElement?.textContent).toContain('Needed')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Electronics/ })) })
    expect(heading().parentElement?.textContent).toContain('Done')
    expect(heading().parentElement?.textContent).not.toContain('Needed')
    expect(screen.getByRole('heading', { level: 2, name: 'Photos' }).parentElement?.textContent).toContain('Needed')
  })
})
