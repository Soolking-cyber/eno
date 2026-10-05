// @vitest-environment jsdom
/**
 * App Store gate `app-ai-notice` — the `listing` family (src/lib/ai-consent.ts): in the apps, "Polish with AI" sends the
 * description to Google (Gemini) only after "Allow"; "Not now" sends nothing and leaves the text as the seller wrote it.
 * Gate off ⇒ the request goes at once, exactly as before. (Autofill from photo takes the same two lines in the same
 * handler shape — post-wizard.tsx — behind the same family answer.) Mocks follow post-wizard.job.test.tsx.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ListingEditData } from './post-wizard'
import type { SerializedCategory } from '@/lib/types'
import { registerAiConsentAsker, setAiConsentAccount } from '@/lib/ai-consent'

const h = vi.hoisted(() => ({
  router: { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} },
  language: { lang: 'en', t: (k: string) => k, tr: (en: string) => en, setLang: () => {} },
  auth: { user: { id: '11111111-1111-4111-8111-111111111111' }, profile: null, loading: false, openSignIn: () => {} },
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
vi.mock('./square-crop-dialog', () => ({ SquareCropDialog: () => null }))
// jsdom has no canvas: a picked photo goes in as it is (the autofill test only needs a File in the wizard's photo list).
vi.mock('@/lib/normalize-image', () => ({ compressImageFile: async (f: File) => f }))
vi.mock('@/lib/square-crop', () => ({ centerCropSquare: async (f: File) => f }))

const { PostWizard } = await import('./post-wizard')

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const CATS = [
  { id: 'c-pets', slug: 'pets', name: 'Pets', nameVi: 'Thú cưng', icon: 'PawPrint', color: 'amber' },
] as unknown as SerializedCategory[]
const DESCRIPTION = 'friendly cat, two years old, vaccinated, needs a calm home'
const edit: ListingEditData = {
  id: 'l1', title: 'Friendly cat needs a home', description: DESCRIPTION,
  price: 0, negotiable: true, urgent: false, categorySlug: 'pets', subcategorySlug: '', listingType: 'sell',
  condition: null, brand: null, model: null, attributes: {}, year: null, mileageKm: null, engineL: null, engineCc: null,
  areaM2: null, salaryM: null, district: 'Bình Thạnh', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  })
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ text: 'Polished text', unclear: true }) }))
  vi.stubGlobal('fetch', fetchMock)
  URL.createObjectURL ??= () => 'blob:photo'
  URL.revokeObjectURL ??= () => {}
  vi.stubEnv('NEXT_PUBLIC_AI_ASSIST', '1')
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_APP)
  setAiConsentAccount(h.auth.user.id)
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setAiConsentAccount(null)
  registerAiConsentAsker(null)
})

const rephraseCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === '/api/ai/rephrase')
const classifyCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === '/api/ai/classify')
/** Pick a cover photo, then tap "Autofill from photo" — twice if asked. */
async function autofill(taps = 1) {
  const { container } = render(<PostWizard categories={CATS} edit={edit} />)
  const input = container.querySelector('input[type="file"][accept^="image/"]') as HTMLInputElement
  await act(async () => { fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'cat.jpg', { type: 'image/jpeg' })] } }) })
  const button = await screen.findByRole('button', { name: /Autofill from photo/ })
  for (let i = 0; i < taps; i++) await act(async () => { fireEvent.click(button) })
}
async function polish() {
  render(<PostWizard categories={CATS} edit={edit} />)
  const button = await screen.findByRole('button', { name: /Polish with AI/ })
  await act(async () => { fireEvent.click(button) })
}

describe('post wizard — Polish with AI and the Google AI question', () => {
  it('gate OFF, in the app: sent at once, as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const asker = vi.fn(async () => 'off' as const)
    registerAiConsentAsker(asker)
    await polish()
    await waitFor(() => expect(rephraseCalls()).toHaveLength(1))
    expect(asker).not.toHaveBeenCalled()
  })

  it('gate ON, in the app, "Not now": nothing sent, the description untouched', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    const asker = vi.fn(async () => 'off' as const)
    registerAiConsentAsker(asker)
    await polish()
    await waitFor(() => expect(asker).toHaveBeenCalledWith('listing', h.auth.user.id, undefined))
    expect(rephraseCalls()).toHaveLength(0)
    expect(screen.getByDisplayValue(DESCRIPTION)).toBeTruthy()
  })

  it('gate ON, in the app, "Allow": sent', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    registerAiConsentAsker(vi.fn(async () => 'on' as const))
    await polish()
    await waitFor(() => expect(rephraseCalls()).toHaveLength(1))
  })

  it('gate ON: a second tap while the question is open does nothing — "Allow" sends ONE request', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    let answer!: (ok: boolean) => void
    const asker = vi.fn(() => new Promise<'on' | 'off' | null>((resolve) => { answer = (ok) => resolve(ok ? 'on' : 'off') }))
    registerAiConsentAsker(asker)
    render(<PostWizard categories={CATS} edit={edit} />)
    const button = await screen.findByRole('button', { name: /Polish with AI/ })
    await act(async () => { fireEvent.click(button) })
    await act(async () => { fireEvent.click(button) })
    expect(asker).toHaveBeenCalledTimes(1)
    await act(async () => { answer(true) })
    await waitFor(() => expect(rephraseCalls()).toHaveLength(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(rephraseCalls()).toHaveLength(1)
  })

  it('Autofill from photo — gate OFF: the cover photo is sent at once, as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const asker = vi.fn(async () => 'off' as const)
    registerAiConsentAsker(asker)
    await autofill()
    await waitFor(() => expect(classifyCalls()).toHaveLength(1))
    expect(asker).not.toHaveBeenCalled()
  })

  it('Autofill from photo — gate ON: nothing sent on "Not now"; a double tap asks once and "Allow" sends once', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    registerAiConsentAsker(vi.fn(async () => 'off' as const))
    await autofill()
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(classifyCalls()).toHaveLength(0)
    cleanup()
    let answer!: (ok: boolean) => void
    const asker = vi.fn(() => new Promise<'on' | 'off' | null>((resolve) => { answer = (ok) => resolve(ok ? 'on' : 'off') }))
    registerAiConsentAsker(asker)
    await autofill(2)
    expect(asker).toHaveBeenCalledTimes(1)
    await act(async () => { answer(true) })
    await waitFor(() => expect(classifyCalls()).toHaveLength(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(classifyCalls()).toHaveLength(1)
  })

  it('gate ON, "Not now": the buttons are usable again (busy is released)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    registerAiConsentAsker(vi.fn(async () => 'off' as const))
    await polish()
    await waitFor(() => expect((screen.getByRole('button', { name: /Polish with AI/ }) as HTMLButtonElement).disabled).toBe(false))
  })
})
