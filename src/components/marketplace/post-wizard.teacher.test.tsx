// @vitest-environment jsdom
/**
 * ⛔ A TEACHER LOOKING FOR WORK IS A TEACHER PROFILE, NEVER A JOBS POST (owner, 2026-10-12: "someone created a job post as
 * a teacher profile which is our mistake so we have to mitigate it wont happen again"). The wizard RUNNING:
 *   · in Jobs the two intents read "Hiring" / "Looking for work" — never "Job" / "Wanted", the words a teacher read as
 *     "post myself here";
 *   · "Looking for work" shows the teacher form's door (/teachers/join); on Teaching it HOLDS Publish — a check of the
 *     publish gate, listed as its own step — while every other aisle keeps posting as before;
 *   · before any category is picked, one line under the grid points a teacher at the same form.
 * Every request is answered by the fake below; nothing leaves the test.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCategory } from '@/lib/types'

const h = vi.hoisted(() => ({
  router: { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} },
  language: { lang: 'en', t: (k: string) => k, tr: (en: string) => en, setLang: () => {} },
  auth: { user: { id: 'u1' }, profile: null, loading: false, openSignIn: () => {} },
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
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { displayName: 'Minh Tran', phone: '0901234567', seller: { name: 'Minh Tran', phone: '0901234567' } } }) })
  }
  if ((init?.method ?? 'GET') !== 'GET') h.posts.push(path)
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
}

const HOLD = 'Teachers looking for work: create a teacher profile'
const button = (name: string) => screen.getAllByRole('button').find((b) => b.textContent?.trim() === name)
const tap = async (name: string) => {
  const b = button(name)
  if (!b) throw new Error(`no button "${name}" — have: ${screen.getAllByRole('button').map((x) => x.textContent?.trim()).join(' | ')}`)
  await act(async () => { fireEvent.click(b) })
}
const doorLinks = () => screen.queryAllByRole('link', { name: /Create a teacher profile/ })

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  h.posts = []
  window.history.replaceState(null, '', '/post')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function open() {
  render(<PostWizard categories={CATS} />)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('post wizard — a teacher looking for work is sent to the teacher form', () => {
  it('before a category is picked: one line under the grid → /teachers/join', async () => {
    await open()
    const links = doorLinks()
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('/teachers/join')
    expect(document.body.textContent).toContain('A teacher looking for work?')
  })

  it('in Jobs the intents read "Hiring" / "Looking for work" — never "Job" / "Wanted"', async () => {
    await open()
    await tap('Jobs')
    expect(button('Hiring')).toBeTruthy()
    expect(button('Looking for work')).toBeTruthy()
    expect(button('Wanted')).toBeUndefined()
    expect(button('Job')).toBeUndefined()
  })

  it('"Looking for work" shows the door as a pointer; Hiring shows none', async () => {
    await open()
    await tap('Jobs')
    expect(screen.queryByRole('note')).toBeNull()
    await tap('Looking for work')
    const card = screen.getByRole('note')
    expect(card.textContent).toContain('A teacher looking for work?')
    expect(within(card).getByRole('link', { name: 'Create a teacher profile' }).getAttribute('href')).toBe('/teachers/join')
    expect(document.body.textContent).not.toContain(HOLD)
    await tap('Hiring')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('⛔ Looking for work + Teaching HOLDS Publish: the card says why, and the gate lists it as a step of its own', async () => {
    await open()
    await tap('Jobs')
    await tap('Looking for work')
    await tap('Teaching')
    const hold = screen.getAllByRole('alert').find((a) => a.textContent?.includes(HOLD))!
    expect(hold).toBeTruthy()
    expect(hold.id).toBe('pw-teacher')
    expect(within(hold).getByRole('link', { name: 'Create a teacher profile' }).getAttribute('href')).toBe('/teachers/join')
    expect(hold.textContent).toContain('Hiring a teacher? Choose Hiring. Not looking for teaching work? Pick another subcategory.')
    // A check of the publish gate (canSubmit needs every check ok): the card's title + at least one step row.
    expect(document.body.textContent!.split(HOLD).length - 1).toBeGreaterThanOrEqual(2)
  })

  it('another Jobs aisle with "Looking for work" is not held — the card stays a pointer', async () => {
    await open()
    await tap('Jobs')
    await tap('Looking for work')
    await tap('Hospitality')
    expect(screen.getByRole('note').textContent).toContain('A teacher looking for work?')
    expect(document.body.textContent).not.toContain(HOLD)
  })
})
