// @vitest-environment jsdom
/**
 * ⛔ THE CONTACT ROW STAYS AN INPUT WHILE IT IS BEING TYPED IN (sweep 2026-10-22, post#0). ContactSection shows the
 * account's number as text with "Change number", and an input when there is none — and it used to decide that from the
 * value BEING TYPED: `phoneOk` (≥ 9 digits) turned true on the 9th key, the input unmounted under the seller's finger
 * (the keyboard closed, the 10th digit went nowhere), and "0901234567" was published — and stored as the storefront's
 * phone — as "090123456". The name row did the same at its 2nd character. Every account without a phone (Google, Apple,
 * Facebook, email sign-ups) types its number here on its first listing.
 * The REAL wizard, signed in, /api/me answering — keys typed one at a time into the focused field.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCategory } from '@/lib/types'

const h = vi.hoisted(() => ({
  router: { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} },
  language: { lang: 'en', t: (k: string) => k, tr: (en: string) => en, setLang: () => {} },
  auth: { user: { id: 'u1' } as { id: string } | null, profile: null, loading: false, openSignIn: (() => {}) as (ctx?: unknown) => void },
  /** What /api/me answers for the signed-in account. */
  me: {} as Record<string, unknown>,
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

function fakeFetch(url: string) {
  if (String(url).startsWith('/api/me')) return Promise.resolve({ ok: true, json: () => Promise.resolve(h.me) })
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
}

/** The wizard mounted, signed in, with /api/me's answer in. */
async function renderWizard() {
  render(<PostWizard categories={CATS} />)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
const phoneInput = () => document.getElementById('pw-contactPhone') as HTMLInputElement | null
const contactSection = () => document.getElementById('pw-contact')

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  h.auth = { user: { id: 'u1' }, profile: null, loading: false, openSignIn: () => {} }
  h.me = { user: { displayName: 'An Nguyen', phone: null, seller: null } }
  window.history.replaceState(null, '', '/post')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the contact phone, typed key by key', () => {
  it('⛔ 0901234567 typed one key at a time: the SAME input stays mounted and focused, and holds all ten digits', async () => {
    await renderWizard()
    const input = phoneInput()
    expect(input).toBeTruthy()
    const user = userEvent.setup()
    await user.click(input!)
    for (const key of '0901234567') {
      await user.keyboard(key)
      // Not merely "an input is there": the one being typed in — a remount would drop focus and the keyboard.
      expect(phoneInput(), `after "${input!.value}"`).toBe(input)
      expect(document.activeElement).toBe(input)
    }
    expect(input!.value).toBe('0901234567')
    expect(contactSection()?.textContent).not.toContain('Change number')
  })

  it('a foreign number in international form is typed to the end too (no VN-only gate)', async () => {
    await renderWizard()
    const user = userEvent.setup()
    await user.type(phoneInput()!, '+44 7700 900123')
    expect(phoneInput()?.value).toBe('+44 7700 900123')
  })

  it('stays an input after the field is left — the seller can still correct the number', async () => {
    await renderWizard()
    const user = userEvent.setup()
    await user.type(phoneInput()!, '0901234567')
    await user.tab()
    expect(phoneInput()?.value).toBe('0901234567')
  })

  it('CONTROL: a number the ACCOUNT has is shown as text with "Change number", and Change opens the input on it', async () => {
    h.me = { user: { displayName: 'An Nguyen', phone: '+84901234567', seller: null } }
    await renderWizard()
    expect(phoneInput()).toBeNull()
    expect(contactSection()?.textContent).toContain('+84901234567')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Change number' }))
    expect(phoneInput()?.value).toBe('+84901234567')
  })
})

describe('the contact name, typed key by key', () => {
  it('⛔ an account with no display name types "Nam Tran" to the end — the field is not cut at "Na"', async () => {
    h.me = { user: { displayName: '', phone: null, seller: null } }
    await renderWizard()
    const name = screen.getByPlaceholderText('Name buyers will see') as HTMLInputElement
    const user = userEvent.setup()
    await user.click(name)
    for (const key of 'Nam Tran') {
      await user.keyboard(key)
      expect(screen.queryByPlaceholderText('Name buyers will see'), `after "${name.value}"`).toBe(name)
    }
    expect(name.value).toBe('Nam Tran')
  })

  it('CONTROL: the account’s own name is shown as text, with no field', async () => {
    await renderWizard()
    expect(screen.queryByPlaceholderText('Name buyers will see')).toBeNull()
    expect(contactSection()?.textContent).toContain('An Nguyen')
  })
})
