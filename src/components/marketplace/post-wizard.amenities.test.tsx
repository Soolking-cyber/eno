// @vitest-environment jsdom
/**
 * THE APARTMENT AMENITIES IN THE POST WIZARD (owner, 2026-10-20: "also add those filter chips when someone posts in our
 * app") — the wizard RUNNING. The iOS/Android apps show this same wizard in their webview.
 *   · an apartment for rent is asked the amenities as toggle chips — several pressed at once, each its own aria-pressed —
 *     with the taxonomy's labels, marked optional, after every other specific; no other shelf is asked them, and no
 *     "Looking to rent" ad (its page would never list them — multi-facet.ts sellerMultiFacets);
 *   · the EDIT screen opens on the listing's stored picks (the edit page reads them from `facetTokens` —
 *     multi-facet.ts editFormAttributes);
 *   · a save sends them as the list of picks in `attributes.amenities`, in taxonomy order — and `[]` once the last chip is
 *     un-picked (the server replaces the facet only when the body names it); none picked never blocks Publish.
 * The server half: core/listings.amenities.test.ts; the pure rules: multi-facet.test.ts.
 * ⚠️ No tr()/t() call with literal copy in here: the string harvester (scripts/gen-ui-strings.mjs) scans test files too.
 */
import { renderToString } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Each test cold-loads the whole post wizard: seconds under a loaded suite.
vi.setConfig({ testTimeout: 60_000 })
import type { ListingEditData } from './post-wizard'
import type { SerializedCategory } from '@/lib/types'
import { editFormAttributes } from '@/lib/multi-facet'

type Sent = { url: string; method: string; body: Record<string, unknown> }

const h = vi.hoisted(() => ({
  router: { push: vi.fn(), prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} },
  language: { lang: 'en', t: (k: string) => k, tr: (en: string) => en, setLang: () => {} },
  auth: { user: { id: 'u1' } as { id: string } | null, profile: null, loading: false, openSignIn: () => {} },
  sent: [] as Sent[],
}))

vi.mock('next/navigation', () => ({ useRouter: () => h.router, usePathname: () => '/post', useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, loading: () => {}, dismiss: () => {} }) }))
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
vi.mock('@/lib/analytics', () => ({ trackPostListing: () => {} }))
// No photo is required in these tests (the photo gate is not what they are about; a new post's photos live in IndexedDB,
// which jsdom does not have). Everything else in publish-guard is the real thing.
vi.mock('@/lib/publish-guard', async (orig) => ({ ...(await orig<typeof import('@/lib/publish-guard')>()), minPhotosFor: () => 0 }))

const { PostWizard } = await import('./post-wizard')

const CATS = [{ id: 'c-rentals', slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê', icon: 'Key', color: 'green' }] as unknown as SerializedCategory[]

/** The answers every apartment must give (rental period, furnishing, bedrooms — all required). */
const REQUIRED = { rentalPeriod: 'monthly', furnishing: 'fully', bedrooms: '1' }

/** An apartment rental on the edit screen — complete, so a Save reaches the server. */
const flat = (over: Partial<ListingEditData> = {}): ListingEditData => ({
  id: 'l1', title: 'Bright 1-bedroom flat near the river', description: 'Quiet street, ten minutes from the centre, available next month.',
  price: 9_000_000, negotiable: true, urgent: false, categorySlug: 'rentals', subcategorySlug: 'apartment-rental', listingType: 'rent',
  condition: null, brand: null, model: null, attributes: { ...REQUIRED }, priceUnit: 'VND/month', year: null, mileageKm: null, engineL: null, engineCc: null,
  areaM2: null, salaryM: null, district: 'Quận 2', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
  ...over,
})

/** A working Storage: under Node 25 vitest's jsdom `localStorage` is an empty object (post-wizard.services-entry.test.tsx). */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  } as Storage
}

beforeEach(() => {
  h.auth = { user: { id: 'u1' }, profile: null, loading: false, openSignIn: () => {} }
  h.router.push.mockReset()
  h.sent = []
  Element.prototype.scrollIntoView = function () {}
  window.scrollTo = (() => {}) as typeof window.scrollTo
  URL.createObjectURL ??= () => 'blob:photo'
  URL.revokeObjectURL ??= () => {}
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url)
    const method = init?.method ?? 'GET'
    if (path.startsWith('/api/me')) {
      return { ok: true, json: async () => ({ user: { id: 'u1', displayName: 'Lan', phone: '0901234567', sellerId: 's1', seller: { name: 'Lan', phone: '0901234567', officialPartner: false } } }) }
    }
    if (method !== 'GET') {
      h.sent.push({ url: path, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : {} })
      return { ok: true, status: 200, json: async () => ({ id: 'n1', verified: true }) }
    }
    return { ok: true, json: async () => ({}) }
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }
const chip = (name: string) => screen.getByRole('button', { name })
const isPressed = (name: string) => chip(name).getAttribute('aria-pressed') === 'true'
const publish = async () => { await click(screen.getAllByRole('button').find((b) => /Publish listing|Save changes/.test(b.textContent ?? ''))!); await settle() }
const saves = () => h.sent.filter((s) => s.url === '/api/listings' || s.url === '/api/listings/l1')
/** The amenities group — Field's role="group", labelled by its heading. */
const amenitiesGroup = () => screen.queryByRole('group', { name: /^Amenities/ })

describe('the post wizard — apartment amenities (2026-10-20)', () => {
  it('an apartment is asked the amenities: the taxonomy’s chips, optional, with a hint, AFTER every other specific', () => {
    const page = renderToString(<PostWizard categories={CATS} edit={flat()} />)
    for (const label of ['No live-in landlord', 'Car access', 'No curfew', 'Pets allowed', 'Wi-Fi', 'Gym']) expect(page, label).toContain(`>${label}</button>`)
    expect(page).toMatch(/>Amenities<span[^>]*> (?:<!-- -->)?\(optional\)<\/span>/)
    expect(page).toContain('Pick all that apply')
    // The long multi row comes last: after Bathrooms (optional) and Bedrooms (required).
    expect(page.indexOf('>Amenities<')).toBeGreaterThan(page.indexOf('>Bathrooms<'))
    expect(page.indexOf('>Amenities<')).toBeGreaterThan(page.indexOf('>Bedrooms<'))
  })

  it('no other shelf is asked them — a house, a room, a scooter', () => {
    for (const sub of ['house-rental', 'room-rental', 'motorbike-rental']) {
      const page = renderToString(<PostWizard categories={CATS} edit={flat({ subcategorySlug: sub })} />)
      expect(page, sub).not.toContain('>No live-in landlord</button>')
      expect(page, sub).not.toContain('Pick all that apply')
    }
  })

  // Reviewer's catch, 2026-10-20: a Wanted ad's picks filtered in browse while its page — amenities on a rent ad only —
  // never listed them. Only a `rent` ad answers them (multi-facet.ts sellerMultiFacets).
  it('⛔ a "Looking to rent" apartment is not asked them, and its save sends none', async () => {
    const wanted = flat({ listingType: 'wanted', attributes: { ...REQUIRED, amenities: 'pool' } })
    const page = renderToString(<PostWizard categories={CATS} edit={wanted} />)
    expect(page).not.toContain('>No live-in landlord</button>')
    expect(page).not.toContain('Pick all that apply')
    render(<PostWizard categories={CATS} edit={wanted} />)
    await settle()
    await publish()
    expect(saves()).toHaveLength(1)
    expect(saves()[0].body).toMatchObject({ listingType: 'wanted', attributes: { ...REQUIRED } })
    expect(saves()[0].body.attributes).not.toHaveProperty('amenities')
  })

  it('⛔ switching an edit to "Looking to rent" hides the chips and leaves them out of the save — back to Rent finds them pressed', async () => {
    render(<PostWizard categories={CATS} edit={flat({ attributes: { ...REQUIRED, amenities: 'pool,gym' } })} />)
    await settle()
    await click(chip('Looking to rent'))
    expect(amenitiesGroup()).toBeNull()
    await click(chip('For rent'))
    expect(amenitiesGroup()).not.toBeNull()
    expect(isPressed('Pool') && isPressed('Gym')).toBe(true)
    await click(chip('Looking to rent'))
    await publish()
    expect(saves()[0].body).toMatchObject({ listingType: 'wanted' })
    // Not named: the server's own rule then drops the stored picks (Rent → Wanted — core/listings.amenities.test.ts).
    expect(saves()[0].body.attributes).not.toHaveProperty('amenities')
  })

  it('the EDIT screen opens on the stored picks — several pressed at once, the rest not', async () => {
    // As the edit page builds it: the picks come from facetTokens, in taxonomy order (multi-facet.ts editFormAttributes).
    const attributes = editFormAttributes({ ...REQUIRED }, '|amenities:pets|amenities:no-landlord|rentalPeriod:weekly|', 'rentals', 'apartment-rental', 'rent')
    expect(attributes).toEqual({ ...REQUIRED, amenities: 'no-landlord,pets' })
    render(<PostWizard categories={CATS} edit={flat({ attributes })} />)
    await settle()
    expect(isPressed('No live-in landlord')).toBe(true)
    expect(isPressed('Pets allowed')).toBe(true)
    expect(isPressed('Car access')).toBe(false)
    expect(amenitiesGroup()).not.toBeNull()
  })

  it('⛔ taps toggle each chip on its own — several stay pressed — and Save sends the picks in taxonomy order', async () => {
    render(<PostWizard categories={CATS} edit={flat({ attributes: { ...REQUIRED, amenities: 'no-landlord' } })} />)
    await settle()
    await click(chip('Wi-Fi'))
    await click(chip('Car access'))
    expect(isPressed('Wi-Fi')).toBe(true)
    expect(isPressed('Car access')).toBe(true)
    expect(isPressed('No live-in landlord')).toBe(true)
    // A tap on a pressed chip takes only it out.
    await click(chip('No live-in landlord'))
    expect(isPressed('No live-in landlord')).toBe(false)
    expect(isPressed('Wi-Fi')).toBe(true)
    // Two quick taps in one batch keep BOTH (the toggle reads the latest state, never the render's).
    await act(async () => { fireEvent.click(chip('Gym')); fireEvent.click(chip('Pool')) })
    expect(isPressed('Gym') && isPressed('Pool')).toBe(true)
    await publish()
    expect(saves()).toHaveLength(1)
    expect(saves()[0]).toMatchObject({ method: 'PATCH', body: { attributes: { ...REQUIRED, amenities: ['car-alley', 'wifi', 'pool', 'gym'] } } })
  })

  it('⛔ un-picking the last chip sends `amenities: []` — "none", never an absent key the server would leave alone', async () => {
    render(<PostWizard categories={CATS} edit={flat({ attributes: { ...REQUIRED, amenities: 'pool' } })} />)
    await settle()
    await click(chip('Pool'))
    await publish()
    expect(saves()[0].body.attributes).toEqual({ ...REQUIRED, amenities: [] })
  })

  it('optional: an apartment with none picked saves, and sends the facet as an empty list', async () => {
    render(<PostWizard categories={CATS} edit={flat()} />)
    await settle()
    await publish()
    expect(saves()).toHaveLength(1)
    expect(saves()[0].body.attributes).toEqual({ ...REQUIRED, amenities: [] })
  })

  it('a NEW apartment post: the chips are there once Apartment is picked, and none picked never holds Publish', async () => {
    localStorage.setItem('eno-listing-draft', JSON.stringify({
      v: 2, savedAt: Date.now(), draftId: 'd1', photoCount: 0, categorySlug: 'rentals', subcategorySlug: 'apartment-rental', listingType: 'rent',
      attrs: { ...REQUIRED }, ranges: {}, title: 'Bright 1-bedroom flat near the river', description: 'Quiet street, ten minutes from the centre, available next month.',
      price: '9000000', negotiable: true, urgent: false, condition: '', brand: '', model: '',
      province: { code: '79', name: 'Hồ Chí Minh', nameEn: 'Ho Chi Minh City' }, ward: null, nearby: null,
    }))
    render(<PostWizard categories={CATS} />)
    await settle()
    expect(amenitiesGroup()).not.toBeNull()
    await click(chip('Car access'))
    await click(chip('No live-in landlord'))
    await publish()
    expect(saves()[0]).toMatchObject({ method: 'POST', body: { subcategorySlug: 'apartment-rental', attributes: { ...REQUIRED, amenities: ['no-landlord', 'car-alley'] } } })
  })

  it('moving the listing to a shelf without the amenities drops them from the form and from the save', async () => {
    render(<PostWizard categories={CATS} edit={flat({ attributes: { ...REQUIRED, amenities: 'pool,gym' } })} />)
    await settle()
    await click(chip('House'))
    expect(amenitiesGroup()).toBeNull()
    await publish()
    const sent = saves()[0]?.body
    expect(sent?.subcategorySlug).toBe('house-rental')
    expect(sent?.attributes).not.toHaveProperty('amenities')
  })
})
