// @vitest-environment jsdom
/**
 * O-34b (owner, 2026-10-05: "apply best recommended") — WHAT THE POST WIZARD OFFERS in the visa slot
 * (services/visa-legal), read from its render the way post-wizard.sell.test.tsx reads it:
 *   · eno.vn, an ordinary seller: the slot ("Legal & permits") is not a subcategory chip;
 *   · eno.vn, an official partner (VietKite — /api/me says seller.officialPartner): it is, once the account
 *     has answered;
 *   · eno.vn, a listing ALREADY in the slot: its own chip stays on the edit screen (editing without moving);
 *   · eno.forum: offered to everyone, named "Visa".
 * The edit screen is used because its subcategory chips always render (the category is frozen there).
 * The server half — refusing a pick or a move — is core/listings.sell-rules.test.ts.
 */
import { renderToString } from 'react-dom/server'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingEditData } from './post-wizard'
import type { SerializedCategory } from '@/lib/types'

const h = vi.hoisted(() => ({
  router: { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} },
  language: { lang: 'en', t: (k: string) => k, tr: (en: string) => en, setLang: () => {} },
  auth: { user: { id: 'u1' } as { id: string } | null, profile: null, loading: false, openSignIn: () => {} },
  /** Seller.officialPartner as /api/me answers it. */
  partner: false,
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

/** The wizard as the given edition builds it — the edition is read once, when @/lib/edition first loads. */
async function wizardFor(edition: 'marketplace' | 'services') {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  vi.resetModules()
  return (await import('./post-wizard')).PostWizard
}

const CATS = [{ id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ', icon: 'Wrench', color: 'cyan' }] as unknown as SerializedCategory[]

/** A services listing on the edit screen, in `subcategorySlug`. */
const services = (subcategorySlug: string): ListingEditData => ({
  id: 'l1', title: 'Help with your paperwork', description: 'We prepare the documents with you, in English or Vietnamese.',
  price: 500_000, negotiable: false, urgent: false, categorySlug: 'services', subcategorySlug, listingType: 'service',
  condition: null, brand: null, model: null, attributes: {}, priceUnit: 'VND/service', year: null, mileageKm: null, engineL: null, engineCc: null,
  areaM2: null, salaryM: null, district: 'Quận 1', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
})

/** The labels of the subcategory chips, as rendered (React escapes `&`). */
const SLOT_EN = 'Legal &amp; permits'

beforeEach(() => {
  h.partner = false
  h.auth = { user: { id: 'u1' }, profile: null, loading: false, openSignIn: () => {} }
  // /api/me answers for the signed-in account; every other read (price guidance …) answers nothing useful.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).startsWith('/api/me')
      ? { user: { id: 'u1', displayName: 'Shop', phone: '0901234567', seller: { name: 'Shop', phone: '0901234567', officialPartner: h.partner } } }
      : {}),
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('the post wizard and the visa slot on eno.vn (marketplace)', () => {
  it('⛔ an ordinary seller is not offered the slot — every other services aisle is', async () => {
    const PostWizard = await wizardFor('marketplace')
    const page = renderToString(<PostWizard categories={CATS} edit={services('cleaning')} />)
    expect(page).not.toContain(SLOT_EN)
    expect(page).toContain('>Other<')
    expect(page).toContain('>Cleaning<')
  })

  it('⛔ …and still not once /api/me has answered that the seller is not a partner', async () => {
    const PostWizard = await wizardFor('marketplace')
    render(<PostWizard categories={CATS} edit={services('cleaning')} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByRole('button', { name: /Cleaning/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Legal & permits/ })).toBeNull()
  })

  it('an official partner is offered the slot, named “Legal & permits”, once the account has answered', async () => {
    h.partner = true
    const PostWizard = await wizardFor('marketplace')
    render(<PostWizard categories={CATS} edit={services('cleaning')} />)
    expect(await screen.findByRole('button', { name: /Legal & permits/ })).toBeTruthy()
  })

  it('a listing ALREADY in the slot keeps its own chip on the edit screen (editing without moving)', async () => {
    const PostWizard = await wizardFor('marketplace')
    const page = renderToString(<PostWizard categories={CATS} edit={services('visa-legal')} />)
    expect(page).toContain(SLOT_EN)
    // …and it is the picked one.
    expect(page).toMatch(/aria-pressed="true"[^>]*>(?:(?!<\/button>)[\s\S])*Legal &amp; permits/)
  })
})

describe('the post wizard and the visa slot on eno.forum (services) — unchanged', () => {
  it('offers the slot, named “Visa”, to an ordinary seller', async () => {
    const PostWizard = await wizardFor('services')
    const page = renderToString(<PostWizard categories={CATS} edit={services('cleaning')} />)
    expect(page).toContain('>Visa<')
    expect(page).not.toContain(SLOT_EN)
  })
})
