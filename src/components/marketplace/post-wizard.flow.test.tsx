// @vitest-environment jsdom
/**
 * The posting wizard RUNNING (effects and all), for the two behaviours a static render cannot show:
 *   · a hung /api/me no longer holds Publish on "Loading your details…" forever — after ME_TIMEOUT_MS
 *     the profile counts as loaded with an unknown contact (new post: the ordinary missing-field
 *     path), and an EDIT is never held behind it at all;
 *   · `?resume=publish` leaves the address after a successful publish made with the ORDINARY button,
 *     not only on mount or through the banner.
 * Every request is answered by the fake below; nothing leaves the test.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingEditData } from './post-wizard'
import type { SerializedCategory } from '@/lib/types'

const h = vi.hoisted(() => ({
  router: { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} },
  language: { lang: 'en', t: (k: string) => k, tr: (en: string) => en, setLang: () => {} },
  auth: { user: { id: 'u1' } as { id: string } | null, profile: null, loading: false, openSignIn: (() => {}) as (ctx?: unknown) => void },
  /** How /api/me answers: 'hang' never does (until aborted); otherwise the JSON. */
  me: 'hang' as 'hang' | Record<string, unknown>,
  posts: [] as string[],
}))

vi.mock('next/navigation', () => ({ useRouter: () => h.router, usePathname: () => '/post', useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, loading: () => {} }) }))
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
vi.mock('@/lib/analytics', () => ({ trackPostListing: () => {} }))

const { PostWizard } = await import('./post-wizard')

const CATS = [
  { id: 'c-jobs', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm', icon: 'Briefcase', color: 'violet' },
  { id: 'c-el', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', icon: 'Smartphone', color: 'blue' },
] as unknown as SerializedCategory[]

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

function fakeFetch(url: string, init?: RequestInit) {
  const path = String(url)
  if (path.startsWith('/api/me')) {
    if (h.me === 'hang') {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    }
    const body = h.me
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  }
  if ((init?.method ?? 'GET') !== 'GET') h.posts.push(path)
  if (path === '/api/listings' && init?.method === 'POST') return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'new-1' }) })
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
}

/** The Publish / Save controls (the desktop button and the mobile bar's twin), by their visible name. */
const publishButtons = () => screen.getAllByRole('button').filter((b) => /Publish listing|Loading your details…|Save changes/.test(b.textContent ?? ''))

beforeEach(() => {
  // jsdom has no layout: scrollIntoView is not implemented (the wizard calls it on a failed Publish).
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  h.auth = { user: { id: 'u1' }, profile: null, loading: false, openSignIn: () => {} }
  h.me = 'hang'
  h.posts = []
  window.history.replaceState(null, '', '/post')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('a hung /api/me', () => {
  it('⛔ holds a NEW post’s Publish only until the timeout, then falls back to the missing-contact path', async () => {
    vi.useFakeTimers()
    render(<PostWizard categories={CATS} />)
    await act(async () => { await Promise.resolve() })
    expect(publishButtons().some((b) => b.getAttribute('aria-busy') === 'true')).toBe(true)
    expect(publishButtons()[0].textContent).toContain('Loading your details…')
    await act(async () => { vi.advanceTimersByTime(10_000) })
    await act(async () => { await Promise.resolve() })
    expect(publishButtons().some((b) => b.getAttribute('aria-busy') === 'true')).toBe(false)
    expect(publishButtons()[0].textContent).toContain('Publish listing')
    // The contact is unknown, so the seller is asked for it — the ordinary missing-field path.
    expect(screen.getByLabelText('Phone number')).toBeTruthy()
  })

  it('⛔ never holds an EDIT: Save is not busy while /api/me is still out', async () => {
    const edit: ListingEditData = {
      id: 'l1', title: 'English teacher, full-time', description: 'Teach adults in the evenings, 20 hours a week.',
      price: 45_000_000, negotiable: false, urgent: false, categorySlug: 'jobs', subcategorySlug: 'teaching', listingType: 'job',
      condition: null, brand: null, model: null, attributes: {}, year: null, mileageKm: null, engineL: null, engineCc: null,
      areaM2: null, salaryM: 45, district: 'Bình Thạnh', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
    }
    render(<PostWizard categories={CATS} edit={edit} />)
    await act(async () => { await Promise.resolve() })
    const save = publishButtons()
    expect(save.length).toBeGreaterThan(0)
    expect(save.some((b) => b.getAttribute('aria-busy') === 'true')).toBe(false)
    expect(save[0].textContent).toContain('Save changes')
  })
})

describe('an account switch', () => {
  it('⛔ empties A’s contact the moment B signs in — a failed or slow read for B never publishes A’s phone', async () => {
    vi.useFakeTimers()
    h.me = { user: { displayName: 'Minh Tran', phone: '0901234567', seller: { name: 'Minh Tran', phone: '0901234567' } } }
    const r = render(<PostWizard categories={CATS} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(document.body.textContent).toContain('0901234567')
    expect(document.body.textContent).toContain('Minh Tran')
    // B signs in; B's /api/me never answers.
    h.auth = { user: { id: 'u2' }, profile: null, loading: false, openSignIn: () => {} }
    h.me = 'hang'
    r.rerender(<PostWizard categories={CATS} />)
    await act(async () => { await Promise.resolve() })
    expect(document.body.textContent).not.toContain('0901234567')
    // …and after the timeout B is asked for B's own contact — A's is gone, not merely hidden.
    await act(async () => { vi.advanceTimersByTime(10_000) })
    await act(async () => { await Promise.resolve() })
    expect(document.body.textContent).not.toContain('0901234567')
    expect(document.body.textContent).not.toContain('Minh Tran')
    expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('')
  })
})

describe('?resume=publish after a successful publish', () => {
  it('⛔ leaves the address when the seller publishes with the ORDINARY button after an in-dialog sign-in', async () => {
    // A complete job post (no photos required), restored from the draft the guest typed.
    localStorage.setItem('eno-listing-draft', JSON.stringify({
      savedAt: Date.now(), draftId: 'd1', photoCount: 0, categorySlug: 'jobs', subcategorySlug: 'teaching', listingType: 'job',
      attrs: { jobtype: 'fulltime', experience: '1-3-years', workMode: 'on-site' }, ranges: {},
      title: 'English teacher, full-time', description: 'Teach adults in the evenings, 20 hours a week.',
      price: '', negotiable: false, urgent: false, condition: '', brand: '', model: '',
      province: { code: 79, name: 'Hồ Chí Minh' }, ward: null, nearby: null,
    }))
    // The guest presses Publish: the gate adds ?resume=publish and opens the sign-in popup.
    h.auth = { user: null, profile: null, loading: false, openSignIn: () => {} }
    h.me = { user: null }
    const r = render(<PostWizard categories={CATS} />)
    await act(async () => { await new Promise((res) => setTimeout(res, 0)) })
    await act(async () => { publishButtons()[0].click() })
    expect(window.location.search).toBe('?resume=publish')
    // Signed in inside the popup (an email code): the account answers with a name and a phone.
    h.auth = { user: { id: 'u1' }, profile: null, loading: false, openSignIn: () => {} }
    h.me = { user: { displayName: 'Minh Tran', phone: '0901234567', seller: { name: 'Minh Tran', phone: '0901234567' } } }
    r.rerender(<PostWizard categories={CATS} />)
    await act(async () => { await new Promise((res) => setTimeout(res, 0)) })
    // The ORDINARY Publish button, not the banner.
    await act(async () => { publishButtons()[0].click() })
    await act(async () => { await new Promise((res) => setTimeout(res, 0)) })
    expect(h.posts).toContain('/api/listings')
    expect(screen.getByRole('heading', { name: /job post is live|first listing is live/i })).toBeTruthy()
    expect(window.location.search).toBe('')
  })
})
