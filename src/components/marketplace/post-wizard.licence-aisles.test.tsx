// @vitest-environment jsdom
/**
 * THE LICENCE AISLES IN THE POST WIZARD (owner, 2026-10-14: e-Visa — "Anyone posts, live after check" — and Legal &
 * permits — "Check them too"; "seller enters") — the wizard RUNNING, on both editions. Renamed from
 * post-wizard.visa-slot.test.tsx (e-Visa only) when Legal & permits became a licence aisle too.
 *   · both aisles are offered to every poster; the provider's two fields show on EVERY in-aisle form — a new pick, an
 *     edit, an approved edit — and never on an exempt desk edit;
 *   · the note: 'new' for a new pick or a move in from outside, 'resubmit' for a changed value or a row not approved
 *     yet, none for an approved edit with its values unchanged (the quiet hint instead);
 *   · Publish is held until both values pass the server's own rules; errors on blur and on attempt; the jump;
 *   · e-Visa ↔ Legal & permits keeps the values, any other shelf drops them (with Undo);
 *   · a photo fill never picks an aisle, and keeps the aisle (and values) the form is in;
 *   · a draft from before the aisles (no v:2) gives up its aisle pick, a v:2 draft keeps it;
 *   · Wanted: no aisle offered, an aisle pick dropped;
 *   · the held success screen and the edit toast speak per aisle; the provider refusals jump to their field;
 *     listing_changed (R2) is worded;
 *   · R3: a Services post whose words file it in an aisle waits for the seller's pick — it is never sent unpicked,
 *     where the server would refuse it with no field on screen to fix.
 * The server half is core/listings.sell-rules.test.ts; the rules on the values, provider-licence.test.ts.
 * ⚠️ No tr()/t() call with literal copy in here: the string harvester (scripts/gen-ui-strings.mjs) scans test files too.
 */
import { renderToString } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Each test cold-loads the whole post wizard under an edition re-import: seconds under a loaded suite.
vi.setConfig({ testTimeout: 60_000 })
import type { ListingEditData } from './post-wizard'
import type { SerializedCategory } from '@/lib/types'
import { LISTING_CHANGED_COPY } from '@/lib/licence-check-copy'

type Sent = { url: string; method: string; body: Record<string, unknown> }

const h = vi.hoisted(() => ({
  router: { push: vi.fn(), prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} },
  language: { lang: 'en', t: (k: string) => k, tr: (en: string) => en, setLang: () => {} },
  auth: { user: { id: 'u1' } as { id: string } | null, profile: null, loading: false, openSignIn: () => {} },
  /** Seller.officialPartner as /api/me answers it. */
  partner: false,
  /** The signed-in account's storefront as /api/me answers it (`sellerId`). */
  sellerId: null as string | null,
  /** sonner's toast (and so subtleToast's): every call, message and options. */
  toast: vi.fn(),
  /** What a save answers (POST /api/listings, PATCH /api/listings/l1), and what /api/ai/classify reads off a photo. */
  save: { ok: true, body: {} as Record<string, unknown> },
  classify: {} as Record<string, unknown>,
  sent: [] as Sent[],
}))

vi.mock('next/navigation', () => ({ useRouter: () => h.router, usePathname: () => '/post', useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({ toast: Object.assign((...a: unknown[]) => h.toast(...a), { success: () => {}, error: () => {}, loading: () => {}, dismiss: () => {} }) }))
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
vi.mock('@/lib/analytics', () => ({ trackPostListing: () => {} }))
// jsdom has no canvas: a picked photo goes in as it is, and "uploads" to a fixed URL.
vi.mock('@/lib/normalize-image', () => ({ compressImageFile: async (f: File) => f }))
vi.mock('@/lib/square-crop', () => ({ centerCropSquare: async (f: File) => f }))
vi.mock('@/lib/upload-client', () => ({
  uploadInBatches: async (files: File[], onBatch?: (f: File[], urls: string[]) => void) => {
    const urls = files.map((_, i) => `https://cdn.eno.vn/test/${i}.jpg`)
    onBatch?.(files, urls)
    return urls
  },
}))
// No photo is required in these tests: the photo gate is not what they are about, and a new post's photos live in
// IndexedDB, which jsdom does not have. Everything else in publish-guard is the real thing (provider-licence.ts uses it).
vi.mock('@/lib/publish-guard', async (orig) => ({ ...(await orig<typeof import('@/lib/publish-guard')>()), minPhotosFor: () => 0 }))

/** The wizard as the given edition builds it — the edition is read once, when @/lib/edition first loads. */
async function wizardFor(edition: 'marketplace' | 'services') {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  vi.resetModules()
  return (await import('./post-wizard')).PostWizard
}

const CATS = [{ id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ', icon: 'Wrench', color: 'cyan' }] as unknown as SerializedCategory[]

const NAME = 'CÔNG TY TNHH VISA5S.VN'
const VISA_NO = '79-123/2019/TCDL-GP LHQT'
const LEGAL_NO = '0312345678'
const values = (legalName: string, licenceNo: string) => ({ providerLegalName: legalName, providerLicenceNo: licenceNo })
const APPROVED = { approved: true, exempt: false }
const WAITING = { approved: false, exempt: false }

/** A services listing on the edit screen, in `subcategorySlug` — complete, so a Save reaches the server. */
const services = (subcategorySlug: string, over: Partial<ListingEditData> = {}): ListingEditData => ({
  id: 'l1', title: 'Help with your paperwork', description: 'We prepare the documents with you, in English or Vietnamese.',
  price: 500_000, negotiable: false, urgent: false, categorySlug: 'services', subcategorySlug, listingType: 'service',
  condition: null, brand: null, model: null, attributes: {}, priceUnit: 'VND/service', year: null, mileageKm: null, engineL: null, engineCc: null,
  areaM2: null, salaryM: null, district: 'Quận 1', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
  ...over,
})

/** A complete NEW services post, restored from the autosave (the way a seller comes back to one). */
function draft(over: Record<string, unknown>) {
  localStorage.setItem('eno-listing-draft', JSON.stringify({
    v: 2, savedAt: Date.now(), draftId: 'd1', photoCount: 0, categorySlug: 'services', subcategorySlug: '', listingType: 'service',
    attrs: {}, ranges: {}, title: 'Visa help', description: 'Applications prepared with you, start to finish, online.',
    price: '800000', negotiable: false, urgent: false, condition: '', brand: '', model: '',
    province: { code: '79', name: 'Hồ Chí Minh', nameEn: 'Ho Chi Minh City' }, ward: null, nearby: null,
    ...over,
  }))
}

/** A working Storage: under Node 25 vitest's jsdom `localStorage` is an empty object (post-wizard.services-entry.test.tsx). */
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

let scrolledTo: string[] = []

beforeEach(() => {
  h.partner = false
  h.sellerId = null
  h.auth = { user: { id: 'u1' }, profile: null, loading: false, openSignIn: () => {} }
  h.toast.mockReset()
  h.router.push.mockReset()
  h.save = { ok: true, body: {} }
  h.classify = {}
  h.sent = []
  scrolledTo = []
  // jsdom has no layout: scrollIntoView and scrollTo are not implemented — recorded instead (the jumps).
  Element.prototype.scrollIntoView = function (this: Element) { scrolledTo.push(this.id) }
  window.scrollTo = (() => {}) as typeof window.scrollTo
  URL.createObjectURL ??= () => 'blob:photo'
  URL.revokeObjectURL ??= () => {}
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url)
    const method = init?.method ?? 'GET'
    if (path.startsWith('/api/me')) {
      return { ok: true, json: async () => ({ user: { id: 'u1', displayName: 'Shop', phone: '0901234567', sellerId: h.sellerId, seller: { name: 'Shop', phone: '0901234567', officialPartner: h.partner } } }) }
    }
    if (path === '/api/ai/classify') return { ok: true, json: async () => h.classify }
    if (method !== 'GET') {
      h.sent.push({ url: path, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : {} })
      return { ok: h.save.ok, status: h.save.ok ? 200 : 400, json: async () => h.save.body }
    }
    return { ok: true, json: async () => ({}) }
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const frame = async () => { await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) }) }
const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }
const chip = (name: string) => screen.getByRole('button', { name })
const nameInput = () => document.getElementById('pw-providerLegalName') as HTMLInputElement | null
const numberInput = () => document.getElementById('pw-providerLicenceNo') as HTMLInputElement | null
const type = async (el: Element | null, value: string) => { await act(async () => { fireEvent.change(el!, { target: { value } }) }) }
/** The Publish / Save controls (the desktop button and the mobile bar's twin), by their visible name. */
const publish = async () => { await click(screen.getAllByRole('button').find((b) => /Publish listing|Save changes/.test(b.textContent ?? ''))!) ; await settle() }
const saves = () => h.sent.filter((s) => s.url === '/api/listings' || s.url === '/api/listings/l1')
/** The note's title (post-wizard-evisa.tsx), per aisle. */
const VISA_NOTE = 'e-Visa listings go live after a licence check'
const LEGAL_NOTE = 'Legal & permits listings go live after a licence check'
const RESUBMIT = 'Saving sends this listing back for eno’s licence check'
const APPROVED_HINT = 'Changing either sends the listing back for eno’s licence check.'
const text = () => document.body.textContent ?? ''

for (const edition of ['marketplace', 'services'] as const) {
  describe(`the post wizard and the licence aisles (${edition})`, () => {
    it('offers both aisles to an ordinary seller — “e-Visa” beside “Legal & permits” — and asks nothing before a pick', async () => {
      const PostWizard = await wizardFor(edition)
      const page = renderToString(<PostWizard categories={CATS} edit={services('cleaning', { licence: APPROVED })} />)
      expect(page).toContain('>e-Visa<')
      expect(page).toContain('Legal &amp; permits')
      expect(page).toContain('>Cleaning<')
      expect(page).not.toContain(VISA_NOTE)
      expect(page).not.toContain('pw-providerLegalName')
    })

    it('a NEW pick in either aisle: the note in that aisle’s words, then both fields — Legal & permits names no visa', async () => {
      window.history.replaceState(null, '', '/post?category=services')
      const PostWizard = await wizardFor(edition)
      render(<PostWizard categories={CATS} />)
      await settle()
      await click(chip('e-Visa'))
      expect(text()).toContain(VISA_NOTE)
      expect(text()).toContain('Only a licensed business may list a visa service.')
      expect(text()).toMatch(/to support@eno\.(vn|forum)\./) // the edition's operator inbox, filled after translation
      expect(nameInput()?.getAttribute('autocomplete')).toBe('organization')
      expect(numberInput()?.getAttribute('translate')).toBe('no')
      expect(text()).toContain('Licence number')
      expect(text()).toContain(`Exactly as on the licence, e.g. ${VISA_NO}. Shown on your listing.`)
      cleanup()

      render(<PostWizard categories={CATS} />)
      await settle()
      await click(chip('Legal & permits'))
      const note = document.getElementById('pw-evisa')!
      expect(note.textContent).toContain(LEGAL_NOTE)
      expect(note.textContent).toContain('work-permit, residence-card, legal and tax services')
      expect(note.textContent).not.toMatch(/visa/i)
      expect(text()).toContain('Licence or registration number')
      expect(text()).toContain('or the 10-digit enterprise code. Never a personal ID number. Shown on your listing.')
      expect(nameInput()).toBeTruthy()
    })

    it('an APPROVED edit opens with its values and no note — only the quiet hint; a changed value brings the resubmit note', async () => {
      const PostWizard = await wizardFor(edition)
      render(<PostWizard categories={CATS} edit={services('visa-legal', { attributes: values(NAME, VISA_NO), licence: APPROVED })} />)
      await settle()
      expect(nameInput()?.value).toBe(NAME)
      expect(numberInput()?.value).toBe(VISA_NO)
      expect(text()).not.toContain(VISA_NOTE)
      expect(text()).toContain(APPROVED_HINT)
      expect(text()).toContain('Goes live instantly.')
      // Whitespace is no change (the server compares normalised values too).
      await type(numberInput(), `  ${VISA_NO.replace(' ', '  ')} `)
      expect(text()).not.toContain(RESUBMIT)
      await type(numberInput(), '79-124/2019/TCDL-GP LHQT')
      expect(text()).toContain(VISA_NOTE)
      expect(text()).toContain(RESUBMIT)
      expect(text()).not.toContain(APPROVED_HINT)
      expect(text()).toContain('Goes live after eno’s licence check.')
    })

    it('a row NOT approved yet (VietKite’s grandfathered rows: no values) shows the resubmit note and asks for both', async () => {
      const PostWizard = await wizardFor(edition)
      render(<PostWizard categories={CATS} edit={services('visa-legal', { licence: WAITING })} />)
      await settle()
      expect(text()).toContain(RESUBMIT)
      expect(nameInput()?.value).toBe('')
      expect(numberInput()?.value).toBe('')
    })

    it('eno’s own desk (exempt) is asked nothing — no note, no fields — and saves as before', async () => {
      const PostWizard = await wizardFor(edition)
      render(<PostWizard categories={CATS} edit={services('visa-legal', { licence: { approved: true, exempt: true } })} />)
      await settle()
      expect(text()).not.toContain(VISA_NOTE)
      expect(nameInput()).toBeNull()
      await publish()
      expect(saves()).toHaveLength(1)
    })

    it('moving a listing INTO an aisle from outside announces the whole check — to an official partner too', async () => {
      const PostWizard = await wizardFor(edition)
      for (const partner of [false, true]) {
        h.partner = partner
        render(<PostWizard categories={CATS} edit={services('cleaning', { licence: APPROVED })} />)
        await settle()
        await click(chip('e-Visa'))
        expect(text(), String(partner)).toContain(VISA_NOTE)
        expect(text(), String(partner)).toContain('After you publish, send a copy of the licence')
        expect(nameInput(), String(partner)).toBeTruthy()
        cleanup()
      }
    })

    it('⛔ Publish is held until both values pass the server’s rules: errors on attempt (and on blur), the step jumps to the field', async () => {
      const PostWizard = await wizardFor(edition)
      render(<PostWizard categories={CATS} edit={services('visa-legal', { licence: WAITING })} />)
      await settle()
      // On leaving the field: its own error, nothing else yet.
      await act(async () => { fireEvent.blur(nameInput()!) })
      expect(text()).toContain('Add the registered business name.')
      expect(text()).not.toContain('Add the licence number.')
      // A failed attempt: nothing sent, every field at fault flagged, focus on the first.
      await publish()
      expect(saves()).toHaveLength(0)
      expect(text()).toContain('Add the licence number.')
      expect(document.activeElement?.id).toBe('pw-providerLegalName')
      expect(text()).toContain('Add the registered business name') // the step, in the desktop checklist
      // A bare number is never an e-Visa licence; a phone cut up by slashes is contact (R6).
      await type(nameInput(), NAME)
      await type(numberInput(), '0312345678')
      expect(text()).toContain('Enter the number exactly as on the licence, letters included')
      await type(numberInput(), 'ZALO/0903/123/456')
      expect(text()).toContain('Remove the phone number, email or link from the number.')
      await publish()
      expect(saves()).toHaveLength(0)
      expect(document.activeElement?.id).toBe('pw-providerLicenceNo')
      // Both acceptable: the save goes, carrying both values with the listing's other answers.
      await type(numberInput(), VISA_NO)
      await publish()
      expect(saves()).toHaveLength(1)
      expect(saves()[0]).toMatchObject({ method: 'PATCH', body: { subcategorySlug: 'visa-legal', attributes: values(NAME, VISA_NO) } })
    })

    it('e-Visa ↔ Legal & permits keeps both values (the server re-holds the move); another shelf drops them — with Undo', async () => {
      const PostWizard = await wizardFor(edition)
      render(<PostWizard categories={CATS} edit={services('visa-legal', { attributes: values(NAME, VISA_NO), licence: APPROVED })} />)
      await settle()
      await click(chip('Legal & permits'))
      expect(nameInput()?.value).toBe(NAME)
      expect(numberInput()?.value).toBe(VISA_NO)
      expect(text()).toContain(LEGAL_NOTE)
      expect(text()).toContain(RESUBMIT) // a move between the aisles goes back for the check
      expect(h.toast.mock.calls.some(([, o]) => (o as { id?: string } | undefined)?.id === 'pw-cat-undo')).toBe(false)
      await click(chip('Cleaning'))
      expect(nameInput()).toBeNull()
      const undo = h.toast.mock.calls.find(([, o]) => (o as { id?: string } | undefined)?.id === 'pw-cat-undo')
      expect(undo?.[0]).toBe('Category changed — the old details were cleared')
      await act(async () => { (undo![1] as { action: { onClick: () => void } }).action.onClick() })
      expect(nameInput()?.value).toBe(NAME)
      expect(numberInput()?.value).toBe(VISA_NO)
    })

    it('a photo fill never PICKS an aisle (Opus #7), and keeps the aisle the form is in — with the seller’s values, never the AI’s', async () => {
      vi.stubEnv('NEXT_PUBLIC_AI_ASSIST', '1')
      vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
      const PostWizard = await wizardFor(edition)
      const addPhoto = async (container: HTMLElement) => {
        const input = container.querySelector('input[type="file"][accept^="image/"]') as HTMLInputElement
        await act(async () => { fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'cover.jpg', { type: 'image/jpeg' })] } }) })
        await click(await screen.findByRole('button', { name: /Autofill from photo/ }))
        await settle()
      }
      // A new post: the photo reads as e-Visa — not picked, no fields.
      window.history.replaceState(null, '', '/post?category=services')
      h.classify = { categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: values('AI GUESS CO', VISA_NO) }
      let r = render(<PostWizard categories={CATS} />)
      await settle()
      await addPhoto(r.container)
      expect(chip('e-Visa').getAttribute('aria-pressed')).toBe('false')
      expect(nameInput()).toBeNull()
      cleanup()
      // An edit in e-Visa: the photo reads as cleaning — the aisle stays, and so do the seller's values.
      h.classify = { categorySlug: 'services', subcategorySlug: 'cleaning', attributes: { serviceLocation: 'online', providerLegalName: 'AI GUESS CO' } }
      r = render(<PostWizard categories={CATS} edit={services('visa-legal', { attributes: values(NAME, VISA_NO), licence: APPROVED })} />)
      await settle()
      await addPhoto(r.container)
      expect(chip('e-Visa').getAttribute('aria-pressed')).toBe('true')
      expect(nameInput()?.value).toBe(NAME)
      await publish()
      // Only what e-Visa asks rides along: no serviceLocation (not asked there), no AI licence value.
      expect(saves()[0]?.body.attributes).toEqual(values(NAME, VISA_NO))
    })

    it('a draft from BEFORE the licence aisles (no v:2) gives up its aisle pick; a v:2 draft keeps it, values and all', async () => {
      const PostWizard = await wizardFor(edition)
      draft({ v: undefined, subcategorySlug: 'legal-permits', title: 'Notary and translation', attrs: { priceBasis: 'one-time', ...values(NAME, LEGAL_NO) } })
      render(<PostWizard categories={CATS} />)
      await settle()
      expect(chip('Legal & permits').getAttribute('aria-pressed')).toBe('false')
      expect(nameInput()).toBeNull()
      cleanup()
      draft({ subcategorySlug: 'legal-permits', title: 'Notary and translation', attrs: { priceBasis: 'one-time', ...values(NAME, LEGAL_NO) } })
      render(<PostWizard categories={CATS} />)
      await settle()
      expect(text()).toContain('Services › Legal & permits')
      expect(nameInput()?.value).toBe(NAME)
      expect(numberInput()?.value).toBe(LEGAL_NO)
    })

    it('a Wanted post is offered neither aisle, and an aisle picked before the switch is dropped', async () => {
      window.history.replaceState(null, '', '/post?category=services')
      const PostWizard = await wizardFor(edition)
      render(<PostWizard categories={CATS} />)
      await settle()
      await click(chip('e-Visa'))
      expect(nameInput()).toBeTruthy()
      await click(chip('Wanted'))
      expect(nameInput()).toBeNull()
      expect(screen.queryByRole('button', { name: 'e-Visa' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Legal & permits' })).toBeNull()
      expect(chip('Cleaning')).toBeTruthy()
    })

    // ⛔ Owner, 2026-10-15: "whitelist vietkite" (src/lib/licence-whitelist.ts — the REAL list here): a whitelisted
    // storefront posting in e-Visa is not asked for the two values, and is not told it waits for a check.
    it('a WHITELISTED storefront’s new e-Visa post asks no licence values and publishes without them', async () => {
      const PostWizard = await wizardFor(edition)
      h.sellerId = 'b6b7b817-6af9-4d37-a762-cf54f6ec74e6'
      h.save = { ok: true, body: { id: 'n1', verified: true } }
      draft({ subcategorySlug: 'visa-legal', title: 'Vietnam e-visa, 3 days', attrs: {} })
      render(<PostWizard categories={CATS} />)
      await settle()
      expect(document.getElementById('pw-providerLegalName')).toBeNull()
      expect(document.getElementById('pw-providerLicenceNo')).toBeNull()
      await publish()
      expect(saves()[0]).toMatchObject({ method: 'POST', body: { subcategorySlug: 'visa-legal' } })
      expect(saves()[0].body.attributes ?? {}).not.toHaveProperty('providerLegalName')
    })

    // Commit gate, 2026-10-15: on an edit the exemption is per AISLE — a whitelisted storefront's listing moved to Legal &
    // permits is asked for the values the server will require there.
    it('an edit exempt only in e-Visa asks for the values in Legal & permits, and not in e-Visa', async () => {
      const PostWizard = await wizardFor(edition)
      render(<PostWizard categories={CATS} edit={services('legal-permits', { licence: { approved: true, exempt: false, exemptAisles: ['visa-legal'] } })} />)
      await settle()
      expect(document.getElementById('pw-providerLegalName')).not.toBeNull()
      cleanup()
      render(<PostWizard categories={CATS} edit={services('visa-legal', { licence: { approved: true, exempt: true, exemptAisles: ['visa-legal'] } })} />)
      await settle()
      expect(document.getElementById('pw-providerLegalName')).toBeNull()
    })

    it('a new listing held for the check lands on the success screen in its aisle’s words', async () => {
      const PostWizard = await wizardFor(edition)
      h.save = { ok: true, body: { id: 'n1', verified: false, held: true } }
      draft({ subcategorySlug: 'legal-permits', title: 'Work permit renewal help', attrs: { priceBasis: 'one-time', ...values(NAME, LEGAL_NO) } })
      render(<PostWizard categories={CATS} />)
      await settle()
      await publish()
      expect(saves()[0]).toMatchObject({ method: 'POST', body: { subcategorySlug: 'legal-permits', attributes: { priceBasis: 'one-time', ...values(NAME, LEGAL_NO) } } })
      expect(screen.getByRole('heading', { name: 'Sent for a licence check' })).toBeTruthy()
      expect(text()).toContain('Legal & permits listings go live after eno’s team has checked the provider’s licence.')
      expect(text()).not.toMatch(/visa|is live|View your listing/i)
      cleanup()
      draft({ subcategorySlug: 'visa-legal', title: 'Vietnam e-visa, 3 days', attrs: values(NAME, VISA_NO) })
      render(<PostWizard categories={CATS} />)
      await settle()
      await publish()
      expect(text()).toContain('e-Visa listings go live after eno’s team has checked the provider’s licence.')
    })

    it('an edit the server holds goes to the dashboard with a toast in its aisle’s words', async () => {
      const PostWizard = await wizardFor(edition)
      h.save = { ok: true, body: { ok: true, held: true } }
      render(<PostWizard categories={CATS} edit={services('legal-permits', { attributes: values(NAME, LEGAL_NO), licence: APPROVED })} />)
      await settle()
      await type(numberInput(), '0312345679')
      await publish()
      expect(h.toast.mock.calls.map(([m]) => m)).toContain('Saved. Legal & permits listings go live after eno’s team has checked the provider’s licence.')
      expect(h.router.push).toHaveBeenCalledWith('/dashboard')
    })

    // Commit gate, 2026-10-14: a Wanted ad filed in an aisle before the rule is never asked for a licence when edited —
    // the server files it under Other on save (core/listings.ts).
    it('an edit of an older Wanted ad sitting in an aisle asks no licence values and saves', async () => {
      const PostWizard = await wizardFor(edition)
      h.save = { ok: true, body: { ok: true } }
      render(<PostWizard categories={CATS} edit={services('visa-legal', { listingType: 'wanted', title: 'Looking for a visa agent', description: 'Need help with a 90-day e-visa for my parents, this month.', attributes: { priceBasis: 'one-time' } })} />)
      await settle()
      expect(document.getElementById('pw-providerLegalName')).toBeNull()
      expect(document.getElementById('pw-providerLicenceNo')).toBeNull()
      await publish()
      expect(saves()[0]).toMatchObject({ method: 'PATCH', body: { listingType: 'wanted' } })
    })

    // Commit gate, 2026-10-14: a held answer on a form outside both aisles is an unchecked listing MOVED OUT — off the
    // site, but no longer waiting for a licence, so not the aisle's words (which used to fall back to e-Visa's).
    it('a held save of a form outside both aisles (a move out of an unchecked listing) says it is off the site, not e-Visa', async () => {
      const PostWizard = await wizardFor(edition)
      h.save = { ok: true, body: { ok: true, held: true } }
      render(<PostWizard categories={CATS} edit={services('cleaning', { title: 'Weekly home cleaning', description: 'Two cleaners, three hours, every week — supplies included.', attributes: { priceBasis: 'hourly', serviceLocation: 'at-customer' }, licence: APPROVED })} />)
      await settle()
      await publish()
      expect(saves()[0]).toMatchObject({ method: 'PATCH', body: { subcategorySlug: 'cleaning' } })
      const toasts = h.toast.mock.calls.map(([m]) => m)
      expect(toasts).toContain('Saved. It’s off the site until eno’s team has reviewed it.')
      expect(toasts.join(' ')).not.toMatch(/e-Visa|licence/)
      expect(h.router.push).toHaveBeenCalledWith('/dashboard')
    })

    it('a provider refusal jumps to the field the server names; listing_changed (R2) says reload', async () => {
      const PostWizard = await wizardFor(edition)
      h.save = { ok: false, body: { error: 'provider_licence_invalid', detail: 'providerLicenceNo:contact' } }
      render(<PostWizard categories={CATS} edit={services('visa-legal', { attributes: values(NAME, VISA_NO), licence: APPROVED })} />)
      await settle()
      await publish()
      await frame()
      expect(text()).toContain('Check the licence details: one of them cannot be accepted as written.')
      expect(scrolledTo).toContain('pw-providerLicenceNo')
      cleanup()
      scrolledTo = []
      h.save = { ok: false, body: { error: 'provider_licence_required' } }
      render(<PostWizard categories={CATS} edit={services('visa-legal', { attributes: values(NAME, VISA_NO), licence: APPROVED })} />)
      await settle()
      await publish()
      await frame()
      expect(text()).toContain('Add the business’s registered name and licence number — e-Visa and Legal & permits listings need both.')
      expect(scrolledTo).toContain('pw-providerLegalName')
      cleanup()
      h.save = { ok: false, body: { error: 'listing_changed' } }
      render(<PostWizard categories={CATS} edit={services('visa-legal', { attributes: values(NAME, VISA_NO), licence: APPROVED })} />)
      await settle()
      await publish()
      // The route's own sentence (licence-check-copy.ts LISTING_CHANGED_COPY), so web and native say the same thing.
      expect(text()).toContain(LISTING_CHANGED_COPY.en)
    })

    it('⛔ R3: a Services post whose WORDS file it in an aisle is never sent unpicked — it waits for the seller’s pick, then the values', async () => {
      const PostWizard = await wizardFor(edition)
      draft({ title: 'Vietnam e-visa, 1 hour', description: 'Fast applications for every nationality, done online with you.' })
      render(<PostWizard categories={CATS} />)
      await settle()
      expect(text()).toContain('Pick a subcategory') // a step, before anything is pressed
      await publish()
      expect(saves()).toHaveLength(0)
      expect(scrolledTo).toContain('pw-subcategory')
      expect(text()).toContain('Pick a subcategory. If this is a visa service, pick e-Visa and add the provider’s licence details.')
      // The form never picks for the seller: no aisle, no fields — until the seller's own tap.
      expect(nameInput()).toBeNull()
      await click(chip('e-Visa'))
      expect(text()).toContain(VISA_NOTE)
      await publish()
      expect(saves()).toHaveLength(0) // now the values hold it
      await type(nameInput(), NAME)
      await type(numberInput(), VISA_NO)
      await publish()
      expect(saves()).toHaveLength(1)
      expect(saves()[0].body).toMatchObject({ subcategorySlug: 'visa-legal', attributes: values(NAME, VISA_NO) })
    })

    it('R3: the Legal & permits words get their own hint; a Wanted post and a post that reads as no aisle go as before', async () => {
      const PostWizard = await wizardFor(edition)
      draft({ title: 'Work permit renewal help', description: 'Renewals and first applications, with the documents checked.' })
      render(<PostWizard categories={CATS} />)
      await settle()
      await publish()
      expect(saves()).toHaveLength(0)
      expect(text()).toContain('pick Legal & permits and add the provider’s licence details.')
      cleanup()
      // A Wanted ad (filed under Services › Other by the server) and a cleaning post: sent unpicked, as before.
      // (With no subcategory, Services asks the pricing and the location chips: both answered.)
      for (const over of [
        { listingType: 'wanted', title: 'Looking for a visa agent', attrs: { priceBasis: 'one-time', serviceLocation: 'online' } },
        { title: 'Deep cleaning, 3 hours', attrs: { priceBasis: 'hourly', serviceLocation: 'at-customer' } },
      ]) {
        h.sent = []
        draft(over)
        render(<PostWizard categories={CATS} />)
        await settle()
        await publish()
        expect(saves(), over.title).toHaveLength(1)
        expect(saves()[0].body.subcategorySlug, over.title).toBeNull()
        cleanup()
      }
    })
  })
}
