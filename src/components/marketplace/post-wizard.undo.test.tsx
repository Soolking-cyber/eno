// @vitest-environment jsdom
/**
 * ONE TAP THAT OVERWRITES THE SELLER'S WORK COMES WITH AN UNDO (Emil-skills audit, missing confirmations):
 *  · "Polish with AI" replaced the description — and anything typed while it ran;
 *  · "Autofill from photo" replaced the category, its specifics (ranges wiped outright), condition, brand, model;
 * (the photo ✕ is the hook's — use-post-media.undo.test.tsx). Mocks follow post-wizard.ai-consent.test.tsx.
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
  toasts: [] as { title: string; opts?: { id?: string; action?: { label: string; onClick: () => void } } }[],
  dismissed: [] as unknown[],
}))

vi.mock('next/navigation', () => ({ useRouter: () => h.router, usePathname: () => '/post', useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({
  toast: Object.assign(
    (title: string, opts?: { action?: { label: string; onClick: () => void } }) => { h.toasts.push({ title, opts }); return h.toasts.length },
    { success: () => {}, error: () => {}, loading: () => {}, dismiss: (id?: unknown) => { h.dismissed.push(id) } },
  ),
}))
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
vi.mock('@/lib/normalize-image', () => ({ compressImageFile: async (f: File) => f }))
vi.mock('@/lib/square-crop', () => ({ centerCropSquare: async (f: File) => f }))

const { PostWizard } = await import('./post-wizard')

const CATS = [
  { id: 'c-pets', slug: 'pets', name: 'Pets', nameVi: 'Thú cưng', icon: 'PawPrint', color: 'amber' },
  { id: 'c-el', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', icon: 'Smartphone', color: 'blue' },
] as unknown as SerializedCategory[]
const DESCRIPTION = 'friendly cat, two years old, vaccinated, needs a calm home'
const edit: ListingEditData = {
  id: 'l1', title: 'Friendly cat needs a home', description: DESCRIPTION,
  price: 0, negotiable: true, urgent: false, categorySlug: 'pets', subcategorySlug: '', listingType: 'sell',
  condition: null, brand: null, model: null, attributes: {}, year: null, mileageKm: null, engineL: null, engineCc: null,
  areaM2: null, salaryM: null, district: 'Bình Thạnh', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
}

let release: (() => void) | null = null
let classifyAnswer: Record<string, unknown> = { categorySlug: 'electronics', attributes: {} }
beforeEach(() => {
  h.toasts = []
  h.dismissed = []
  release = null
  classifyAnswer = { categorySlug: 'electronics', attributes: {} }
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  })
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (String(url) === '/api/ai/rephrase') {
      return new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ text: 'Polished text' }) }) })
    }
    if (String(url) === '/api/ai/classify') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(classifyAnswer) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  }))
  URL.createObjectURL ??= () => 'blob:photo'
  URL.revokeObjectURL ??= () => {}
  vi.stubEnv('NEXT_PUBLIC_AI_ASSIST', '1')
  vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
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

const descriptionBox = () => screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement

describe('Polish with AI', () => {
  it('⛔ the field is read-only while it runs (nothing typed can be lost to the answer), and Undo brings the seller’s words back', async () => {
    render(<PostWizard categories={CATS} edit={edit} />)
    const button = await screen.findByRole('button', { name: /Polish with AI/ })
    await act(async () => { fireEvent.click(button) })
    await waitFor(() => expect(release).not.toBeNull())
    expect(descriptionBox().readOnly).toBe(true)
    await act(async () => { release!(); await new Promise((r) => setTimeout(r, 0)) })
    expect(descriptionBox().value).toBe('Polished text')
    expect(descriptionBox().readOnly).toBe(false)
    const undo = h.toasts.find((t) => t.title === 'Description polished with AI')
    expect(undo?.opts?.action?.label).toBe('Undo')
    await act(async () => { undo!.opts!.action!.onClick() })
    expect(descriptionBox().value).toBe(DESCRIPTION)
  })
})

describe('Polish with AI — an edit after the answer is the seller’s newer word', () => {
  it('Undo does nothing once the polished text has been edited (it must not wipe the edit)', async () => {
    render(<PostWizard categories={CATS} edit={edit} />)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Polish with AI/ })) })
    await waitFor(() => expect(release).not.toBeNull())
    await act(async () => { release!(); await new Promise((r) => setTimeout(r, 0)) })
    await act(async () => { fireEvent.change(descriptionBox(), { target: { value: 'Polished text, and one more line of my own.' } }) })
    await act(async () => { h.toasts.find((t) => t.title === 'Description polished with AI')!.opts!.action!.onClick() })
    expect(descriptionBox().value).toBe('Polished text, and one more line of my own.')
  })
})

async function pickPhotoAndAutofill() {
  const { container } = render(<PostWizard categories={CATS} edit={edit} />)
  const input = container.querySelector('input[type="file"][accept^="image/"]') as HTMLInputElement
  await act(async () => { fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'cat.jpg', { type: 'image/jpeg' })] } }) })
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Autofill from photo/ })) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('Autofill from photo — no Undo when nothing the seller had changes', () => {
  it('the photo reads as the category already chosen, nothing else to fill: no toast', async () => {
    classifyAnswer = { categorySlug: 'pets', attributes: {} }
    await pickPhotoAndAutofill()
    await waitFor(() => expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(([u]) => u === '/api/ai/classify')).toBe(true))
    // Wait for autofill to FINISH (its button comes back from busy) — not just to have asked, or this proves nothing.
    await waitFor(() => expect((screen.getByRole('button', { name: /Autofill from photo/ }) as HTMLButtonElement).disabled).toBe(false))
    expect(h.toasts.find((t) => t.title.startsWith('Filled in from your photo'))).toBeUndefined()
  }, 30_000)
})

describe('Autofill from photo', () => {
  it('⛔ replacing what the seller had chosen comes with an Undo that puts it back', async () => {
    // A NEW post with a category the seller picked (in edit mode the category is fixed — not the case under test).
    const { container } = render(<PostWizard categories={CATS} />)
    const petsChip = await waitFor(() => {
      const el = container.querySelector('[data-cat-slug="pets"]') ?? null
      if (!el) {
        const more = screen.queryByRole('button', { name: /More/ })
        if (more) fireEvent.click(more)
        throw new Error('pets chip not shown yet')
      }
      return el as HTMLElement
    })
    await act(async () => { fireEvent.click(petsChip) })
    const chosen = () => document.getElementById('pw-category-summary')?.textContent ?? ''
    await waitFor(() => expect(chosen()).toMatch(/Pets/))
    const input = container.querySelector('input[type="file"][accept^="image/"]') as HTMLInputElement
    await act(async () => { fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'cat.jpg', { type: 'image/jpeg' })] } }) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Autofill from photo/ })) })
    const undo = await waitFor(() => {
      const t = h.toasts.find((x) => x.title.startsWith('Filled in from your photo'))
      if (!t) throw new Error('no undo toast yet')
      return t
    })
    expect(undo.opts?.action?.label).toBe('Undo')
    expect(chosen()).toMatch(/Electronics/) // the photo's category took over (the chosen summary, not the picker's list)
    await act(async () => { undo.opts!.action!.onClick() })
    await waitFor(() => expect(chosen()).toMatch(/Pets/)) // and the seller's came back
  }, 30_000) // the photo goes through the wizard's whole pick pipeline first — slow in jsdom on a loaded machine
})
