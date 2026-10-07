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

/**
 * ⛔ WHY A PUBLISH STOPPED SHOWS NEXT TO THE BUTTON, AND THE FORM JUMPS TO THE FIELD (Emil-skills audit, publish).
 * The form's error line sits at its foot — off-screen on a phone, under a desktop Publish pinned at the top — so the
 * button just went back to its label with no visible reason, and "remove the phone number" did not say where.
 */
describe('a refused save', () => {
  const EDIT: ListingEditData = {
    id: 'l1', title: 'English teacher, full-time', description: 'Teach adults in the evenings, 20 hours a week.',
    price: 45_000_000, negotiable: false, urgent: false, categorySlug: 'jobs', subcategorySlug: 'teaching', listingType: 'job',
    condition: null, brand: null, model: null, attributes: { jobtype: 'fulltime', experience: '1-3-years', workMode: 'on-site' }, year: null, mileageKm: null, engineL: null, engineCc: null,
    areaM2: null, salaryM: 45, district: 'Bình Thạnh', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
  }
  function refuseSave(code: string) {
    let release = () => {}
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === '/api/listings/l1' && init?.method === 'PATCH') {
        return new Promise((resolve) => { release = () => resolve({ ok: false, json: () => Promise.resolve({ error: code }) }) })
      }
      return fakeFetch(url, init)
    }))
    return () => release()
  }

  it('⛔ while it saves the buttons are busy (spinner, focus kept), and a refusal is said beside them, with a jump to its field', async () => {
    h.me = { user: { displayName: 'Minh Tran', phone: '0901234567', seller: { name: 'Minh Tran', phone: '0901234567' } } }
    const release = refuseSave('phone_taken')
    const scrolledTo: string[] = []
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) { scrolledTo.push(this.id) })
    render(<PostWizard categories={CATS} edit={EDIT} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(document.querySelector('[data-publish-status]')?.textContent).toBe('') // mounted before anything happens
    await act(async () => { publishButtons()[0].click() })
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('[data-publish-status]')?.textContent).toBe('Saving…') // the one region a screen reader hears
    // Mid-save the label reads "Saving…" (publishButtons() matches the idle labels, so it would find nothing here).
    const saving = screen.getAllByRole('button').filter((b) => /Saving…/.test(b.textContent ?? ''))
    expect(saving).toHaveLength(2) // the desktop button and the mobile bar's
    expect(saving.every((b) => b.getAttribute('aria-busy') === 'true')).toBe(true)
    expect(saving.some((b) => b.hasAttribute('disabled'))).toBe(false) // never the focus-dropping native `disabled`
    expect(saving.every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true) // refused by aria-disabled instead
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)) })
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) })
    const reason = /This phone number is already used by another account/
    // The form's own alert (heard), plus the copy beside the desktop button and in the mobile bar (seen).
    expect(screen.getAllByText(reason).length).toBe(3)
    expect(screen.getAllByText(reason).filter((p) => p.getAttribute('aria-hidden') === 'true').length).toBe(2)
    expect(scrolledTo).toContain('pw-contact') // the jump to the field it is about — its section, as the number shows verified here
    scrolled.mockRestore()
  })

  it('⛔ a phone number caught in the DESCRIPTION before sending: said beside the button, and the textarea has focus', async () => {
    h.me = { user: { displayName: 'Minh Tran', phone: '0901234567', seller: { name: 'Minh Tran', phone: '0901234567' } } }
    render(<PostWizard categories={CATS} edit={{ ...EDIT, description: 'Teach adults in the evenings. Call me on 0912 345 678 to apply.' }} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await act(async () => { publishButtons()[0].click() })
    const reason = /Do not put a phone number, email, link or street address in your job post/
    expect(screen.getAllByText(reason).filter((p) => p.getAttribute('aria-hidden') === 'true').length).toBe(2)
    expect(document.activeElement?.tagName).toBe('TEXTAREA') // its id sits on the wrapper; the control is focused
    expect(h.posts).toEqual([]) // nothing was sent
  })
})
