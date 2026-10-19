// @vitest-environment jsdom
/**
 * THE WAYS IN FOR A SERVICE PROVIDER (owner, 2026-10-14): `/post?category=services` (/c/services' "Post your service",
 * every empty category page's "Post a listing") opens the form on that category when there is no draft to resume — a
 * draft wins — and only for a category this page offers. And a teacher offering lessons in Services › Languages is
 * pointed at the teacher profile, without being blocked ("a teacher should remain").
 * The same way in serves a school (teacher visibility plan §4 channel 6, 2026-10-18): "Hiring? Post your job ad"
 * (teaching-links.tsx PostJobLink) links `/post?category=jobs`, which must land on Hiring — a school can post in Teaching.
 */
import { renderToString } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

const CATS = [
  { id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ', icon: 'Wrench', color: 'cyan' },
  { id: 'c-electronics', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', icon: 'Smartphone', color: 'blue' },
  { id: 'c-jobs', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm', icon: 'Briefcase', color: 'violet' },
  // Never handed over by /post (not postable) — here to prove the wizard's OWN guard refuses it.
  { id: 'c-teachers', slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên', icon: 'GraduationCap', color: 'violet' },
] as unknown as SerializedCategory[]

/** A services listing on the edit screen, in `subcategorySlug`. */
const services = (subcategorySlug: string): ListingEditData => ({
  id: 'l1', title: 'Help with your paperwork', description: 'We prepare the documents with you, in English or Vietnamese.',
  price: 500_000, negotiable: false, urgent: false, categorySlug: 'services', subcategorySlug, listingType: 'service',
  condition: null, brand: null, model: null, attributes: {}, priceUnit: 'VND/service', year: null, mileageKm: null, engineL: null, engineCc: null,
  areaM2: null, salaryM: null, district: 'Quận 1', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
})


vi.setConfig({ testTimeout: 60_000 })

/** A working Storage: under Node 25 vitest's jsdom `localStorage` is an empty object, so the wizard's draft read would
 *  fail silently and the draft-wins case could never be exercised (the favorites-context test's helper). */
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
  h.partner = false
  h.auth = { user: { id: 'u1' }, profile: null, loading: false, openSignIn: () => {} }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }

describe('the post wizard — ways in for a provider', () => {
  it('/post?category=services opens on Services: its intents and aisles are offered', async () => {
    window.history.replaceState(null, '', '/post?category=services')
    const PostWizard = await wizardFor('marketplace')
    render(<PostWizard categories={CATS} />)
    await settle()
    expect(screen.getByRole('button', { name: /Dog|Pets/ })).toBeTruthy() // services' aisles are on screen
    expect(screen.getByRole('button', { name: /Cleaning/ })).toBeTruthy()
    // …and none is picked: the link never files a provider into an aisle — least of all e-Visa, Services' first.
    expect(screen.getByRole('button', { name: /e-Visa/ }).getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelectorAll('[aria-pressed="true"]').length).toBeGreaterThan(0) // the intent chip (Service)
  })

  it('teachers (not postable — refused by the wizard itself, even if handed over) or junk is ignored', async () => {
    for (const q of ['teachers', 'not-a-category']) {
      window.history.replaceState(null, '', `/post?category=${q}`)
      const PostWizard = await wizardFor('marketplace')
      render(<PostWizard categories={CATS} />)
      await settle()
      expect(screen.queryByRole('button', { name: /Cleaning/ }), q).toBeNull()
      cleanup()
    }
  })

  it('a draft wins over the link — the seller’s own unfinished post is never replaced', async () => {
    localStorage.setItem('eno-listing-draft', JSON.stringify({ categorySlug: 'electronics', title: 'iPhone 13', savedAt: Date.now() }))
    window.history.replaceState(null, '', '/post?category=services')
    const PostWizard = await wizardFor('marketplace')
    render(<PostWizard categories={CATS} />)
    await settle()
    expect(screen.queryByRole('button', { name: /Cleaning/ })).toBeNull()
    expect((screen.getByDisplayValue('iPhone 13') as HTMLInputElement).value).toBe('iPhone 13')
  })

  // The employer prompt's way in, on both editions (it shows on both): Jobs with Hiring picked, and Teaching takes it.
  it.each(['marketplace', 'services'] as const)('%s: /post?category=jobs opens on Jobs with Hiring picked — a school can post in Teaching', async (edition) => {
    window.history.replaceState(null, '', '/post?category=jobs')
    const PostWizard = await wizardFor(edition)
    render(<PostWizard categories={CATS} />)
    await settle()
    expect(screen.getByRole('button', { name: 'Hiring' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Looking for work' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /Teaching/ }))
    await settle()
    // Hiring in Teaching is a school's post: no teacher-profile hold, title or checklist step (that is "Looking for work").
    expect(screen.queryAllByText('Teachers looking for work: create a teacher profile')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Hiring' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('Services › Languages shows the teacher-profile door as a pointer, never a hold', async () => {
    const PostWizard = await wizardFor('marketplace')
    const page = renderToString(<PostWizard categories={CATS} edit={services('language-lessons')} />)
    expect(page).toContain('A teacher looking for work?')
    expect(page).toContain('/teachers/join')
    expect(page).not.toContain('Teachers looking for work: create a teacher profile') // the blocking title
  })
})
