// @vitest-environment jsdom
/**
 * services › Pricing IN THE POST WIZARD (owner, 2026-10-14: "service price if its hourly or one time payment"): an EDIT of
 * a service opens its Pricing chip on what the stored unit says — the chip is required and rows posted before it existed
 * carry no answer, so an edit must not stop on a question the price already answers — and an hourly service's price
 * field reads "/ hour", exactly where the server stamps 'VND/hour' (listingMoneyFor).
 */
import { renderToString } from 'react-dom/server'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The first test cold-loads the whole post wizard (and an edition re-import per test): seconds under a loaded suite.
vi.setConfig({ testTimeout: 60_000 })
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

/** A services listing on the edit screen, in `subcategorySlug`, stored with `priceUnit`. */
const services = (subcategorySlug: string, priceUnit = 'VND/service'): ListingEditData => ({
  id: 'l1', title: 'Help with your paperwork', description: 'We prepare the documents with you, in English or Vietnamese.',
  price: 500_000, negotiable: false, urgent: false, categorySlug: 'services', subcategorySlug, listingType: 'service',
  condition: null, brand: null, model: null, attributes: {}, priceUnit, year: null, mileageKm: null, engineL: null, engineCc: null,
  areaM2: null, salaryM: null, district: 'Quận 1', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
})

beforeEach(() => {
  h.partner = false
  h.auth = { user: { id: 'u1' }, profile: null, loading: false, openSignIn: () => {} }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** The chip the page shows pressed (aria-pressed="true"), by its label. */
const pressed = (page: string, label: string) => new RegExp(`aria-pressed="true"[^>]*>(?:(?!</button>)[\\s\\S])*${label}`).test(page)

describe('the post wizard and services › Pricing', () => {
  it('an hourly service opens on "Hourly", and its price reads "/ hour"', async () => {
    const PostWizard = await wizardFor('marketplace')
    const page = renderToString(<PostWizard categories={CATS} edit={services('cleaning', 'VND/hour')} />)
    expect(pressed(page, 'Hourly')).toBe(true)
    expect(page).toContain('/ hour')
  })

  it('a service stored per service — or posted before the chip, with a bare VND — opens on "One-time", no "/ hour"', async () => {
    const PostWizard = await wizardFor('marketplace')
    for (const unit of ['VND/service', 'VND']) {
      const page = renderToString(<PostWizard categories={CATS} edit={services('cleaning', unit)} />)
      expect(pressed(page, 'One-time'), unit).toBe(true)
      expect(page, unit).not.toContain('/ hour')
    }
  })

  it('⛔ the stored unit wins over a stale answer: an "hourly" attribute on a per-service price opens on "One-time"', async () => {
    const PostWizard = await wizardFor('marketplace')
    const page = renderToString(<PostWizard categories={CATS} edit={{ ...services('cleaning', 'VND/service'), attributes: { priceBasis: 'hourly' } }} />)
    expect(pressed(page, 'One-time')).toBe(true)
    expect(page).not.toContain('/ hour')
  })

  it('⛔ a stale answer stored where the chip is not asked is dropped: moved to an aisle that asks, the chip starts empty', async () => {
    const PostWizard = await wizardFor('services')
    render(<PostWizard categories={CATS} edit={{ ...services('esim'), attributes: { priceBasis: 'hourly' } }} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    await act(async () => { screen.getByRole('button', { name: /Cleaning/ }).click() })
    expect(screen.getByRole('button', { name: 'Hourly' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'One-time' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('an e-Visa or eSIM listing is not asked at all', async () => {
    const PostWizard = await wizardFor('services')
    for (const sub of ['visa-legal', 'esim']) {
      const page = renderToString(<PostWizard categories={CATS} edit={services(sub)} />)
      expect(page, sub).not.toContain('One-time')
      expect(page, sub).not.toContain('>Pricing<')
    }
  })
})
