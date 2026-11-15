// @vitest-environment jsdom
/**
 * ⛔ A PHOTO THE LISTING PHOTO CHECK REFUSED, IN THE POST WIZARD RUNNING (owner, 2026-11-15: no flyers, no contact details).
 * /api/upload answers per file; a refused photo's tile gets a red ring and one line (a job's names contact details only —
 * a job may use a logo), the banner says to remove the marked ones, and Publish is refused before any upload until they go.
 * The same for a photo already on the listing whose refusal is confirmed (the edit page's `photoRefused`) and for the
 * save's own `photo_not_allowed`. Harness: post-wizard.job-text.test.tsx (a job needs no photo, so a Save reaches the server).
 * ⚠️ No tr()/t() call with literal copy in here: the string harvester (scripts/gen-ui-strings.mjs) scans test files too.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingEditData } from './post-wizard'
import type { SerializedCategory } from '@/lib/types'

vi.setConfig({ testTimeout: 60_000 })

const h = vi.hoisted(() => ({
  router: { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} },
  language: { lang: 'en', t: (k: string) => k, tr: (en: string) => en, setLang: () => {} },
  auth: { user: { id: 'u1' }, profile: null, loading: false, openSignIn: () => {} },
  /** What /api/upload answers for each file, by name. */
  uploadAnswer: (_name: string): Record<string, unknown> => ({ url: 'https://cdn.test/x.webp' }),
  uploads: [] as FormData[],
  saves: [] as Record<string, unknown>[],
  /** What the save answers: null = ok, else a 400 body. */
  saveRefusal: null as Record<string, unknown> | null,
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
vi.mock('@/lib/analytics', () => ({ trackPostListing: () => {} }))
vi.mock('@/lib/normalize-image', () => ({ compressImageFile: async (f: File) => f }))

const { PostWizard } = await import('./post-wizard')

const CATS = [
  { id: 'c-jobs', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm', icon: 'Briefcase', color: 'violet' },
  { id: 'c-pets', slug: 'pets', name: 'Pets', nameVi: 'Thú cưng', icon: 'PawPrint', color: 'amber' },
] as unknown as SerializedCategory[]

const job: ListingEditData = {
  id: 'l1', title: 'English teacher, District 7', description: 'Teach adults in the evenings, 20 hours a week, at our centre.',
  price: 25_000_000, negotiable: false, urgent: false, categorySlug: 'jobs', subcategorySlug: 'teaching', listingType: 'job',
  condition: null, brand: null, model: null, attributes: { jobtype: 'fulltime', experience: '1-3-years', workMode: 'on-site' },
  year: null, mileageKm: null, engineL: null, engineCc: null, areaM2: null, salaryM: 25,
  district: 'Quận 7', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
}

const BANNER = 'Some photos are not allowed — remove the marked ones and post again.'
const JOB_LINE = 'No phone numbers or contact details on photos'
const LINE = 'Use a real photo — no flyers or phone numbers'
const H1 = 'https://sb.test/storage/v1/object/public/listings/h1.webp'
const H2 = 'https://sb.test/storage/v1/object/public/listings/h2.webp'

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

let scrolledTo: string[] = []

beforeEach(() => {
  scrolledTo = []
  h.uploads = []
  h.saves = []
  h.saveRefusal = null
  h.uploadAnswer = (name) => ({ url: `https://cdn.test/${name}.webp` })
  Element.prototype.scrollIntoView = function (this: Element) { scrolledTo.push(this.id) }
  URL.createObjectURL = () => `blob:${Math.random().toString(36).slice(2)}`
  URL.revokeObjectURL = () => {}
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url)
    if (path.startsWith('/api/me')) {
      return { ok: true, json: async () => ({ user: { id: 'u1', displayName: 'Saigon English Centre', phone: '0901234567', seller: { name: 'Saigon English Centre', phone: '0901234567' } } }) }
    }
    if (path === '/api/upload') {
      const form = init!.body as FormData
      h.uploads.push(form)
      return { ok: true, status: 200, json: async () => ({ urls: [], results: form.getAll('files').map((f) => h.uploadAnswer((f as File).name)) }) }
    }
    if ((init?.method ?? 'GET') !== 'GET') {
      h.saves.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return h.saveRefusal ? { ok: false, status: 400, json: async () => h.saveRefusal } : { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    return { ok: true, json: async () => ({}) }
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const frame = async () => { await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) }) }
const save = async () => {
  await act(async () => { fireEvent.click(screen.getAllByRole('button').find((b) => /Save changes/.test(b.textContent ?? ''))!) })
  await settle()
  await frame()
}
const addPhoto = async (name: string) => {
  const input = document.querySelector('input[type="file"][accept^="image/"]') as HTMLInputElement
  await act(async () => { fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })] } }) })
  await settle()
}
const tiles = () => [...document.querySelectorAll('#pw-photo [role="group"] > div.group')] as HTMLElement[]
const removeTile = async (i: number) => {
  await act(async () => { fireEvent.click(tiles()[i].querySelector('button[aria-label="Remove photo"]')!) })
  await settle()
}

describe('the post wizard — a photo the check refused', () => {
  it('⛔ marks the refused tile with the job line, says to remove it, sends nothing to the save — then publishes once it is gone', async () => {
    h.uploadAnswer = (name) => (name === 'menu.jpg' ? { reason: 'photo_contact' } : { url: `https://cdn.test/${name}.webp` })
    render(<PostWizard categories={CATS} edit={job} />)
    await settle()
    await addPhoto('office.jpg')
    await addPhoto('menu.jpg')
    await save()
    expect(h.uploads.map((f) => [f.get('check'), f.get('category')])).toEqual([['listing', 'jobs']])
    expect(document.body.textContent).toContain(BANNER)
    expect(scrolledTo).toContain('pw-photo')
    expect(h.saves).toHaveLength(0)
    const [office, menu] = tiles()
    expect(menu.textContent).toContain(JOB_LINE)
    expect(menu.className).toContain('ring-destructive')
    expect(office.textContent).not.toContain(JOB_LINE)
    // Publish again with it still there: refused before any upload.
    await save()
    expect(h.uploads).toHaveLength(1)
    expect(h.saves).toHaveLength(0)
    // ✕ on it, and the save goes through with the photo that was accepted (uploaded once).
    await removeTile(1)
    await save()
    expect(h.uploads).toHaveLength(1)
    expect(h.saves.at(-1)?.images).toEqual(['https://cdn.test/office.jpg.webp'])
  })

  it('an edit opens with its confirmed refusals marked, and Save is refused until they are removed', async () => {
    render(<PostWizard categories={CATS} edit={{ ...job, images: [H1, H2], photoRefused: [{ url: H2, rule: 'contact' }] }} />)
    await settle()
    expect(tiles()[1].textContent).toContain(JOB_LINE)
    await save()
    expect(document.body.textContent).toContain(BANNER)
    expect(h.saves).toHaveLength(0)
    await removeTile(1)
    await save()
    expect(h.saves.at(-1)?.images).toEqual([H1])
  })

  it('the save’s own refusal (photo_not_allowed) marks the photos it names', async () => {
    h.saveRefusal = { error: 'photo_not_allowed', detail: `contact:${H2}` }
    render(<PostWizard categories={CATS} edit={{ ...job, images: [H1, H2] }} />)
    await settle()
    await save()
    expect(document.body.textContent).toContain(BANNER)
    expect(tiles().map((t) => t.textContent?.includes(JOB_LINE))).toEqual([false, true])
  })

  it('outside jobs the line names flyers too', async () => {
    render(<PostWizard categories={CATS} edit={{ ...job, categorySlug: 'pets', subcategorySlug: '', listingType: 'sell', salaryM: null, attributes: {}, images: [H1], photoRefused: [{ url: H1, rule: 'flyer' }] }} />)
    await settle()
    expect(tiles()[0].textContent).toContain(LINE)
    expect(tiles()[0].textContent).not.toContain(JOB_LINE)
  })
})
