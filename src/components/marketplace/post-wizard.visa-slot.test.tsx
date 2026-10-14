// @vitest-environment jsdom
/**
 * THE e-VISA SUBCATEGORY IN THE POST WIZARD (owner, 2026-10-14: "also have an evisa dedicated subcategory", then
 * "Anyone posts, live after check") — read from its render the way post-wizard.sell.test.tsx reads it:
 *   · both editions, every poster: the chip is offered, named "e-Visa", beside "Legal & permits";
 *   · picking it announces the licence check before Publish (EVisaLicenceNote) — to an official partner too: only
 *     eno's own desk is exempt (taxonomy.ts licenceCheckHold), and it does not post through this form;
 *   · a listing ALREADY in the slot keeps its chip on the edit screen, and is not re-announced (no move).
 * The edit screen is used because its subcategory chips always render (the category is frozen there).
 * The server half — the hold itself — is core/listings.sell-rules.test.ts. This retires O-34b's partner-only picker.
 */
import { renderToString } from 'react-dom/server'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Each test cold-loads the whole post wizard under an edition re-import: seconds under a loaded suite.
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

/** A services listing on the edit screen, in `subcategorySlug`. */
const services = (subcategorySlug: string): ListingEditData => ({
  id: 'l1', title: 'Help with your paperwork', description: 'We prepare the documents with you, in English or Vietnamese.',
  price: 500_000, negotiable: false, urgent: false, categorySlug: 'services', subcategorySlug, listingType: 'service',
  condition: null, brand: null, model: null, attributes: {}, priceUnit: 'VND/service', year: null, mileageKm: null, engineL: null, engineCc: null,
  areaM2: null, salaryM: null, district: 'Quận 1', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
})

/** The licence-check note's title (post-wizard-evisa.tsx). */
const NOTE = 'e-Visa listings go live after a licence check'

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

for (const edition of ['marketplace', 'services'] as const) {
  describe(`the post wizard and the e-Visa subcategory (${edition})`, () => {
    it('offers it to an ordinary seller, named “e-Visa”, beside “Legal & permits”', async () => {
      const PostWizard = await wizardFor(edition)
      const page = renderToString(<PostWizard categories={CATS} edit={services('cleaning')} />)
      expect(page).toContain('>e-Visa<')
      expect(page).toContain('Legal &amp; permits')
      expect(page).toContain('>Cleaning<')
      expect(page).not.toContain(NOTE) // nothing picked, nothing announced
    })

    it('a listing ALREADY in it keeps its chip, picked — and is not re-announced (resending its own subcategory is no move)', async () => {
      const PostWizard = await wizardFor(edition)
      const page = renderToString(<PostWizard categories={CATS} edit={services('visa-legal')} />)
      expect(page).toMatch(/aria-pressed="true"[^>]*>(?:(?!<\/button>)[\s\S])*e-Visa/)
      expect(page).not.toContain(NOTE)
    })

    it('moving a listing into it announces the licence check — to an official partner too (only eno’s desk is exempt)', async () => {
      const PostWizard = await wizardFor(edition)
      render(<PostWizard categories={CATS} edit={services('cleaning')} />)
      await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
      await act(async () => { screen.getByRole('button', { name: /e-Visa/ }).click() })
      expect(screen.getByText(NOTE)).toBeTruthy()
      cleanup()
      h.partner = true
      render(<PostWizard categories={CATS} edit={services('cleaning')} />)
      await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
      await act(async () => { screen.getByRole('button', { name: /e-Visa/ }).click() })
      expect(screen.getByText(NOTE)).toBeTruthy()
    })
  })
}
