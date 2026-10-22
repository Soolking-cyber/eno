// @vitest-environment jsdom
/**
 * STEPS 5–6 AND PUBLISH (teacher onboarding redesign, 2026-10-08) — each consent is ONE act with its notice beside it:
 *   · the cover switch IS the consent (no tick box); the reach is a read-only line;
 *   · the two opt-ins are LABELLED switches, job seekers only, with one AI note naming Anthropic — ON BY DEFAULT for a new
 *     profile since 2026-10-22 (owner: "all toggles should be on by default"), held beside the answers, never in them; a
 *     refusal survives a reload, another tab or device (the account draft) and Start over (teacher-form.draft.test.tsx);
 *   · the phone is REQUIRED (owner, 2026-10-22: "phone number is mandatory");
 *   · Publish is the consent: the action bar says what goes public, "What's public?" lists it, and the save carries the
 *     notice versions the contract checks (publishNotice always; coverNotice with cover on; aiNotice with an opt-in on),
 *     and — a new profile — which switch was left at its default (`optInDefaults`).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, configure, fireEvent, getConfig, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { AI_NOTICE_VERSION, PUBLISH_NOTICE_VERSION } from '@/lib/teachers/profile'
import { COVER_CONSENT_VERSION } from '@/lib/teachers/cover'
import { resetTeacherFormCountsForTests } from '@/lib/signup-counters'
import { COMPLETE, fakeFetch, putDraft, storedDraft, stubBrowser, type Call } from './teacher-form.fixtures'

const auth = vi.hoisted(() => ({
  user: { id: 'u1' } as null | { id: string }, loading: false, openSignIn: vi.fn(),
  // An onboarded account by default; the "new account" cases below clear it.
  accountType: 'individual' as string | null, identityLoaded: true, markOnboarded: vi.fn(),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/components/marketplace/push-opt-in-card', () => ({ PushOptInCard: () => <div data-testid="push-card" /> }))
// App Store gate `ios-hide-kyc` — off (the web) unless a test turns it on.
const ios = vi.hoisted(() => ({ on: false }))
vi.mock('@/hooks/use-ios-hide-kyc', () => ({ useIosHideKyc: () => ios.on }))
// THE INTRO VIDEO IS REQUIRED for a new profile (owner, 2026-10-16) — jsdom reads no video metadata, so the preparation
// (video-prep.ts, tested in the browser path it copies) and the upload are stood in for.
const VIDEO = 'https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000001-efgh34.mp4'
vi.mock('@/lib/teachers/video-prep', () => ({ prepareTeacherVideo: async (file: File) => ({ file, hevc: false }) }))
vi.mock('@/lib/video-upload-client', () => ({ uploadListingVideo: async () => VIDEO }))
vi.mock('@/lib/normalize-image', () => ({ compressImageFile: async (f: File) => f }))

import { TeacherForm } from './teacher-form'

const asyncUtilTimeout = getConfig().asyncUtilTimeout
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 60_000 })
afterAll(() => { configure({ asyncUtilTimeout }); vi.resetConfig() })
beforeAll(() => { Element.prototype.scrollIntoView ??= function () {} })

const PHOTO = 'https://sb.eno.vn/storage/v1/object/public/listings/me.webp'
// THE CV IS REQUIRED for a new profile (owner, 2026-10-21) and goes up BEFORE the PUT: POST /api/teachers/me/cv?pending=1
// answers a token (a lower-case UUID v4), and the PUT names it as `cvUpload`.
const CV_TOKEN = 'aaaaaaaa-0000-4000-8000-000000000001'
const CV_TOKEN_2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const pdf = (name = 'my-cv.pdf', type = 'application/pdf') => new File(['%PDF-1.4'], name, { type })
const cvInput = () => document.querySelector<HTMLInputElement>('input[accept="application/pdf,.pdf"]')!
let cvReply: () => { status?: number; json: unknown } = () => ({ json: { ok: true, cvUpload: CV_TOKEN, cvFileName: 'my-cv.pdf' } })
let calls: Call[] = []
let putReply: (body: unknown) => { status?: number; json: unknown } = () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: null } })
let gate: { ok: boolean; code: string | null } = { ok: true, code: null }
// GET /api/teachers/me's "Identity verified" state for an account with no profile yet (identity-mark.ts: no name to judge)
// — not known (null, no line) unless a test says otherwise.
let markState: { shown: boolean; reason: string | null } | null = null
// The account's own name, photo and phone — FILLED into empty answers since 2026-10-16 ("autofill as much as possible").
let prefill: { displayName: string | null; avatarUrl: string | null; phone: string | null } = { displayName: 'Bea Smith', avatarUrl: 'x', phone: '+84901234567' }

beforeEach(() => {
  stubBrowser()
  auth.user = { id: 'u1' }
  auth.accountType = 'individual'
  auth.identityLoaded = true
  auth.markOnboarded = vi.fn()
  history.replaceState(null, '', '/teachers/join')
  gate = { ok: true, code: null }
  markState = null
  prefill = { displayName: 'Bea Smith', avatarUrl: PHOTO, phone: '+84901234567' }
  ios.on = false
  putReply = () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: null } })
  cvReply = () => ({ json: { ok: true, cvUpload: CV_TOKEN, cvFileName: 'my-cv.pdf' } })
  const f = fakeFetch({
    'GET /api/teachers/me': () => ({ json: { teacher: null, publishGate: gate, prefill, identityMark: markState, identityMarkHidden: false, identityMarkStamps: { at: null, withdrawnAt: null } } }),
    'PUT /api/teachers/me': (b) => putReply(b),
    'POST /api/teachers/me/cv?pending=1': () => cvReply(),
  })
  calls = f.calls
  vi.stubGlobal('fetch', f.fn)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mount() {
  render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <main><TeacherForm mode="join" draftHost={false} apexOrigin="https://eno.vn" /></main>
    </LanguageProvider>,
  )
  return userEvent.setup()
}
const action = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const lastPut = () => calls.filter((c) => c.method === 'PUT').at(-1)?.body as Record<string, unknown> | undefined
const puts = () => calls.filter((c) => c.method === 'PUT' && c.url === '/api/teachers/me')
/** Every CV upload the form sent — the join form's go up as PENDING ones (`?pending=1`), before its Publish. */
const cvPosts = () => calls.filter((c) => c.method === 'POST' && c.url.startsWith('/api/teachers/me/cv'))
/** The CV section (its heading is "CV" where it is required — every new profile — else "CV (optional)"). */
const cvSection = async () => within((await screen.findByRole('heading', { name: /^CV( \(optional\))?$/ })).closest('section')!)
/**
 * The account photo is on the page by itself (prefill); the intro video is added and a PDF picked as the CV — what every
 * Publish below needs (both required for a new profile: the video since 2026-10-16, the CV since 2026-10-21).
 * `cv: false` leaves the CV out, for the tests of the CV itself.
 */
async function addVideo(user: ReturnType<typeof userEvent.setup>, { cv = true }: { cv?: boolean } = {}) {
  await waitFor(() => expect(document.querySelector('img[src="' + PHOTO + '"]')).toBeTruthy())
  await user.upload(document.querySelector<HTMLInputElement>('input[accept="video/mp4,video/quicktime,video/webm"]')!, new File(['v'], 'hello.mp4', { type: 'video/mp4' }))
  await screen.findByText('Replace video')
  if (!cv) return
  await user.upload(cvInput(), pdf())
  await screen.findByText('my-cv.pdf')
}

describe('step 5 · Cover lessons', () => {
  it('the switch IS the consent — no tick box — with its notice beside it; on, it shows where schools find the teacher', async () => {
    putDraft({ ...COMPLETE, teachAreas: ['d7', 'd4'] }, 'cover')
    const user = mount()
    const sw = await screen.findByRole('switch', { name: 'Available for cover lessons' })
    // The notice is the switch's DESCRIPTION, read with it — and not part of its name.
    const desc = (sw.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
    expect(desc).toMatch(/Anyone can see your profile: schools, other members and search engines/)
    expect(screen.queryByRole('checkbox')).toBeNull()
    await user.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    // In the stored (canonical) order, whatever order they were picked in.
    expect(screen.getByTestId('cover-reach').textContent).toBe('District 4 · District 7 (Phu My Hung)')
  })

  it('the reach never names a relocation city or Online, and "All of HCMC" carries the tip to narrow it', async () => {
    putDraft({ ...COMPLETE, relocate: 'some', teachAreas: ['online', 'ho-chi-minh-city', 'ha-noi'] }, 'cover')
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: 'Available for cover lessons' }))
    expect(screen.getByTestId('cover-reach').textContent).toBe('Ho Chi Minh City')
    expect(screen.getByText(/Tip: schools look for cover by district/)).toBeTruthy()
  })

  it('with the work question left empty, cover must be switched on (goal_required)', async () => {
    putDraft({ ...COMPLETE, jobTypes: [], relocate: '' }, 'cover')
    const user = mount()
    expect(await screen.findByRole('switch', { name: 'Available for cover lessons' })).toBeTruthy()
    await user.click(action('Next'))
    expect(await screen.findByText(/Switch on cover lessons — or go back to step 1/)).toBeTruthy()
  })
})

describe('step 6 · Photo & publish', () => {
  it('job seekers get the two opt-ins as LABELLED switches, ON by default for a new profile (owner, 2026-10-22), with ONE AI note naming Anthropic and the transfer abroad', async () => {
    putDraft(COMPLETE, 'finish')
    mount()
    const email = await screen.findByRole('switch', { name: 'Email me jobs that match my profile' })
    const calls_ = screen.getByRole('switch', { name: 'Our staff may call me' })
    // ON once /api/teachers/me has said this account has no profile (it has, by the time the form shows).
    await waitFor(() => expect(email.getAttribute('aria-checked')).toBe('true'))
    expect(calls_.getAttribute('aria-checked')).toBe('true')
    expect(calls.some((c) => c.method === 'GET' && c.url === '/api/teachers/me')).toBe(true)
    // ⛔ …and never INTO the answers: the tab copy holds no consent.
    expect(storedDraft().t).toMatchObject({ matchEmailOptIn: false, staffContactOptIn: false })
    expect('optInsOff' in storedDraft()).toBe(false)
    const notes = screen.getAllByTestId('ai-note')
    expect(notes).toHaveLength(1)
    // WP5's wording, word for word (it matches what the matcher's export sends) — "While either option above is on" since
    // the switches start ON (2026-10-22); the rest unchanged, and so is AI_NOTICE_VERSION.
    expect(notes[0].textContent).toBe("While either option above is on, an AI model — Anthropic's Claude, which processes data outside Vietnam — compares your profile with teaching jobs. It receives your headline and about text (with your name taken out), your nationality and whether you are a native speaker, the city you live in and the cities you can teach in, subjects, age groups, job types, years of experience, degree, certificate types, expected salary and start date. It never receives your name, photo, video, phone, email or CV. See our Privacy Policy.")
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy')
  })

  it('a teacher with no job goal (cover only) is asked neither opt-in', async () => {
    putDraft({ ...COMPLETE, jobTypes: [], relocate: '', coverSlots: ['mon-am'], coverRateVnd: 300_000 }, 'finish')
    const user = mount()
    // A draft holds no cover switch (forDraft), and a cover-only profile needs it: it reopens on Cover, where it is given
    // again — never past the first step that fails (draftResumeStep, 2026-10-11).
    const sw = await screen.findByRole('switch', { name: 'Available for cover lessons' })
    await user.click(sw)
    await user.click(action('Next'))
    expect(await screen.findByText('Profile photo')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'Email me jobs that match my profile' })).toBeNull()
    expect(screen.queryByTestId('ai-note')).toBeNull()
  })

  it('⛔ the phone is REQUIRED (owner, 2026-10-22) — Publish without one is refused ON THE PHONE, whatever the switches say', async () => {
    prefill = { ...prefill, phone: null }
    putDraft({ ...COMPLETE, photoUrl: PHOTO }, 'finish')
    const user = mount()
    const phone = await screen.findByRole('textbox', { name: 'Phone number' })
    expect(screen.queryByRole('textbox', { name: 'Phone number (optional)' })).toBeNull()
    expect(phone.getAttribute('aria-required')).toBe('true')
    // Both switches off — the phone is still required (it was required only for staff calls before).
    const email = screen.getByRole('switch', { name: 'Email me jobs that match my profile' })
    await waitFor(() => expect(email.getAttribute('aria-checked')).toBe('true'))
    await user.click(email)
    await user.click(screen.getByRole('switch', { name: 'Our staff may call me' }))
    await addVideo(user)
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Please add your phone number — it stays private: the person you are chatting with gets it only when you share it.')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Phone number' }).getAttribute('aria-invalid')).toBe('true'))
    expect(screen.getByText('Profile photo')).toBeTruthy() // still on Photo & publish, where the phone is
    expect(lastPut()).toBeUndefined()
    expect(cvPosts()).toEqual([])
    // …and a phone that is only punctuation is refused as such (isTeacherPhone: 8 digits at least).
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '(...) ...-....')
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Please check this value.')).toBeTruthy()
    expect(lastPut()).toBeUndefined()
  })

  it('⛔ a picked CV can be let go before Publish — back to none — and the Publish is then refused on the CV, nothing uploaded (gate review, 2026-10-08; required since 2026-10-21)', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    const cv = await cvSection()
    await user.upload(cvInput(), pdf())
    expect(cv.getByText('my-cv.pdf')).toBeTruthy()
    await user.click(cv.getByRole('button', { name: 'Remove' }))
    expect(cv.queryByText('my-cv.pdf')).toBeNull()
    expect(cv.getByText('Choose PDF')).toBeTruthy()
    await addVideo(user, { cv: false })
    await user.click(action('Publish profile'))
    expect(await cv.findByText(/^Please add your CV — a PDF up to 10 MB/)).toBeTruthy()
    expect(lastPut()).toBeUndefined()
    expect(cvPosts()).toEqual([])
  })

  it('⛔ the account photo and phone FILL empty answers (owner, 2026-10-16: "autofill as much as possible") — never over one given', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Phone number' }) as HTMLInputElement).value).toBe('+84901234567'))
    expect(document.querySelector(`img[src="${PHOTO}"]`)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use my account photo' })).toBeNull()
    // Cleared by the teacher: offered again, never refilled unasked.
    await user.clear(screen.getByRole('textbox', { name: 'Phone number' }))
    expect(screen.getByRole('button', { name: /Use my number/ })).toBeTruthy()
  })

  it('⛔ a new profile needs its intro video — Publish without one is refused on the video (owner, 2026-10-16)', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    expect(await screen.findByRole('heading', { name: 'Intro video' })).toBeTruthy()
    await waitFor(() => expect(document.querySelector(`img[src="${PHOTO}"]`)).toBeTruthy())
    await user.click(action('Publish profile'))
    expect(await screen.findByText(/Please add a short intro video/)).toBeTruthy()
    expect(lastPut()).toBeUndefined()
  })

  it('an identity check the account still needs shows at the TOP of the step, not as a refusal at the last tap', async () => {
    gate = { ok: false, code: 'identity_unverified' }
    putDraft(COMPLETE, 'finish')
    mount()
    expect(await screen.findByText(/Vietnamese law requires sellers to verify their identity/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Verify my identity' }).getAttribute('href')).toBe('/dashboard/account/verify')
  })

  it('the Publish notice rides the action bar, and "What’s public?" lists every public field and what never is', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    const note = (await screen.findAllByTestId('publish-notice'))[0]
    expect(note.textContent).toMatch(/everything except your phone, email, CV and a private video/)
    await user.click(screen.getAllByRole('button', { name: 'What’s public?' })[0])
    expect(await screen.findByText('Never public')).toBeTruthy()
    expect(screen.getByText(/Cover lessons — your free periods, hourly rate and where schools find you — only while cover is on/)).toBeTruthy()
    // ⛔ "Identity verified" IS in this list since 2026-10-16 (owner: automatic once verified, so publishing makes it
    // public): the list is the text PUBLISH_NOTICE_VERSION stands for, bumped with it (profile.ts) — on its conditions,
    // never the document, and that it can be hidden.
    const markItems = screen.getAllByRole('listitem').filter((li) => /Identity verified/.test(li.textContent ?? ''))
    expect(markItems.map((li) => li.textContent)).toEqual(['“Identity verified” — while your identity check is current and the name on your profile matches your ID (never your document); you can hide it'])
    // Bumped with it: never the words before the mark was listed ('2026-10-13') — re-dated with the deploy if it slips.
    expect(PUBLISH_NOTICE_VERSION >= '2026-10-16').toBe(true)
  })

  it('⛔ iOS (`ios-hide-kyc`): the identity check at the top names the website — never a "Verify my identity" link', async () => {
    ios.on = true
    gate = { ok: false, code: 'identity_unverified' }
    putDraft(COMPLETE, 'finish')
    mount()
    expect(await screen.findByText(/Vietnamese law requires sellers to verify their identity/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Verify my identity' })).toBeNull()
    expect(screen.getAllByText(/Identity verification is available on our website, in a web browser:/).length).toBeGreaterThan(0)
  })

  it('no notice under the earlier steps of a NEW profile — only beside Publish', async () => {
    putDraft(COMPLETE, 'teaching')
    mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    expect(screen.queryByTestId('publish-notice')).toBeNull()
  })
})

describe('Publish', () => {
  it('sends the notices it showed: publishNotice; coverNotice with cover on; aiNotice with an opt-in on — and never cover areas', async () => {
    putDraft({ ...COMPLETE, teachAreas: ['d7'] }, 'cover')
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: 'Available for cover lessons' }))
    await user.click(screen.getByRole('button', { name: 'Monday evening' }))
    await user.click(screen.getByRole('button', { name: /300,000/ }))
    await user.click(action('Next'))
    await addVideo(user)
    // Job emails left at their default (ON); staff calls switched OFF by the teacher.
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Our staff may call me' }).getAttribute('aria-checked')).toBe('true'))
    await user.click(screen.getByRole('switch', { name: 'Our staff may call me' }))
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    const body = lastPut()!
    expect(body).toMatchObject({
      publishNotice: PUBLISH_NOTICE_VERSION, coverNotice: COVER_CONSENT_VERSION, aiNotice: AI_NOTICE_VERSION,
      coverOpen: true, coverConsent: true, coverSlots: ['mon-eve'], coverRateVnd: 300_000,
      matchEmailOptIn: true, staffContactOptIn: false, photoUrl: PHOTO, teachAreas: ['d7'], teachAreasConfirmed: true,
      teacherProfileId: null, coverBase: null, videoBase: null,
      optInDefaults: { matchEmail: true, staffCall: false },
    })
    expect('coverAreas' in body).toBe(false)
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    expect(screen.getByTestId('push-card')).toBeTruthy() // cover is on: the push prompt is worth asking
  })

  it('without cover and with both opt-ins switched off, neither notice is sent — publishNotice always is', async () => {
    putDraft({ ...COMPLETE, photoUrl: null }, 'finish')
    const user = mount()
    await addVideo(user)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Email me jobs that match my profile' }).getAttribute('aria-checked')).toBe('true'))
    await user.click(screen.getByRole('switch', { name: 'Email me jobs that match my profile' }))
    await user.click(screen.getByRole('switch', { name: 'Our staff may call me' }))
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    const body = lastPut()!
    expect(body.publishNotice).toBe(PUBLISH_NOTICE_VERSION)
    expect('coverNotice' in body).toBe(false)
    expect('aiNotice' in body).toBe(false)
    expect(body).toMatchObject({ matchEmailOptIn: false, staffContactOptIn: false, optInDefaults: { matchEmail: false, staffCall: false } })
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    expect(screen.queryByTestId('push-card')).toBeNull() // no cover: no push prompt
    // Published with its intro video (required since 2026-10-16): the done screen no longer suggests adding one.
    expect(screen.queryByRole('link', { name: 'Add an intro video' })).toBeNull()
  })

  it('with a phone on file, the done screen names the button "Share my phone, email & CV"', async () => {
    putDraft({ ...COMPLETE, phone: '+84901234567' }, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    expect(await screen.findByText(/“Share my phone, email & CV”/)).toBeTruthy()
  })

  it('a text the server refuses sends the teacher to THAT field, named by the server (never the word)', async () => {
    putReply = () => ({ status: 422, json: { error: 'contact_in_text', detail: 'bio' } })
    putDraft({ ...COMPLETE, bio: 'call me' }, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    const bio = await screen.findByRole('textbox', { name: 'About you (optional)' })
    // The bio has its own error slot now (2026-10-21) — and a text the browser cannot point into keeps the general line.
    expect(bio.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getAllByText(/Please remove phone numbers, emails and links/).length).toBeGreaterThan(0)
  })

  it('a refusal the browser cannot point into keeps the lines it always had — never "shown under the field" with nothing shown', async () => {
    putReply = () => ({ status: 422, json: { error: 'banned_words', detail: 'bio' } })
    putDraft({ ...COMPLETE, bio: 'I teach young learners.' }, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    expect((await screen.findAllByText('Your profile contains a word we do not allow. Please rephrase.')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('This contains a word we do not allow. Please rephrase it.').length).toBeGreaterThan(0)
    expect(screen.queryAllByText(/shown under the field/).length).toBe(0)
  })

  // ⛔ Owner, 2026-10-21: a teacher refused three times with "a word we do not allow" could not know which word. The form
  // screens the texts as Publish will (text-screen.ts) and shows the teacher's OWN words under the field — nothing is sent.
  it('⛔ a refused word is caught at Publish, before the save, and SHOWN under its field — quoted from the teacher\'s own text', async () => {
    putDraft({ ...COMPLETE, bio: 'Experienced IELTS teacher. I hold a valid work visa until March and can start now.' }, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    const bio = await screen.findByRole('textbox', { name: 'About you (optional)' })
    await waitFor(() => expect(bio.getAttribute('aria-invalid')).toBe('true'))
    expect((await screen.findAllByText(/We can’t publish this: “visa”\. Please rephrase or remove it\./)).length).toBeGreaterThan(0)
    expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/teachers/me')).toBe(false)
    // Rephrased: the mark goes — the quote AND the field's invalid state (editing a field clears its error).
    await user.clear(bio)
    await user.type(bio, 'Experienced IELTS teacher. I can start now.')
    expect(screen.queryAllByText(/We can’t publish this/).length).toBe(0)
    expect(bio.getAttribute('aria-invalid')).not.toBe('true')
    expect(screen.queryAllByText(/word we do not allow/).length).toBe(0)
  })

  it('⛔ a refused certificate PROVIDER marks the provider input — focus never lands on Remove, where Enter deleted it', async () => {
    putDraft({ ...COMPLETE, certificates: [{ type: 'celta', provider: 'Visa help desk', hours: null, year: null }] }, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    const provider = await screen.findByRole('textbox', { name: 'Provider (optional)' })
    await waitFor(() => expect(provider.getAttribute('aria-invalid')).toBe('true'))
    await waitFor(() => expect(document.activeElement).toBe(provider))
    expect((await screen.findAllByText(/We can’t publish this: “Visa”/)).length).toBeGreaterThan(0)
    expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/teachers/me')).toBe(false)
  })

  it('…and a certificate\'s hours out of range mark the HOURS input — again never Remove', async () => {
    putDraft({ ...COMPLETE, certificates: [{ type: 'celta', provider: 'Cambridge', hours: 5000, year: null }] }, 'finish')
    const user = mount()
    // A validation error reopens the draft on its step (draftResumeStep); Next there marks the input.
    const hours = await screen.findByRole('textbox', { name: 'Hours (optional)' })
    await user.click(action('Next'))
    await waitFor(() => expect(hours.getAttribute('aria-invalid')).toBe('true'))
    await waitFor(() => expect(document.activeElement).toBe(hours))
  })

  it('…and ordinary words go through', async () => {
    putReply = () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: null } })
    putDraft({ ...COMPLETE, bio: 'I love Hoi An and its cao lầu. I am happy to take students on school trips.' }, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(lastPut()!.bio).toContain('its cao lầu')
  })
})

// ── THE CV IS REQUIRED FOR A NEW PROFILE (owner, 2026-10-21: "when teacher creates profile it says cv is optional, its not
// they should include cv") — and the SERVER enforces it at create, so the CV goes up BEFORE the PUT as a pending upload
// (POST /api/teachers/me/cv?pending=1) and the PUT names its token (publish.ts cvUploadOf). A pick is checked as it is
// made; an upload that fails refuses the Publish on the CV with nothing sent; one the server no longer holds ('expired')
// is uploaded again and the PUT sent once more. ────────────────────────────────────────────────────────────────────────
describe('the CV — required for a new profile, uploaded before its Publish', () => {
  const LIVE = { json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: null } }
  const counted = (e: string) => calls.some((c) => c.url === '/api/signup-prompt' && (c.body as { t?: string } | null)?.t === e)
  /** The Publish button once the last tap has settled (it reads "Saving…", disabled, while one is on its way). */
  const publishReady = async () => {
    await waitFor(() => expect((action('Publish profile') as HTMLButtonElement).disabled).toBe(false))
    return action('Publish profile')
  }

  it('⛔ Publish without a CV is refused ON THE CV SECTION — marked invalid, the line, the counter — nothing uploaded, no PUT', async () => {
    resetTeacherFormCountsForTests()
    putDraft(COMPLETE, 'finish')
    const user = mount()
    // Required, so said so: no "(optional)", and why schools want it — still private.
    const cv = await cvSection()
    expect(screen.getByRole('heading', { name: 'CV' })).toBeTruthy()
    expect(screen.queryByText('CV (optional)')).toBeNull()
    expect(cv.getByText(/^PDF, up to 10 MB\. Schools ask for it first\. Private:/)).toBeTruthy()
    // …and what to leave out of it, said where it is chosen (PDPL minimisation — gate review, 2026-10-22).
    expect(cv.getByText('Leave out what schools don’t need — health details, ID numbers, your referees’ phone numbers.')).toBeTruthy()
    await addVideo(user, { cv: false })
    await user.click(action('Publish profile'))
    expect(await cv.findByText('Please add your CV — a PDF up to 10 MB. It stays private: schools get it only when you share it in a chat.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'CV' }).closest('section')!.hasAttribute('data-invalid')).toBe(true)
    expect(lastPut()).toBeUndefined()
    expect(cvPosts()).toEqual([])
    await waitFor(() => expect(counted('publish_refused_cv')).toBe(true))
    // …and a pick clears the line.
    await user.upload(cvInput(), pdf())
    expect(await cv.findByText('my-cv.pdf')).toBeTruthy()
    expect(cv.queryByText(/^Please add your CV/)).toBeNull()
    expect(screen.getByRole('heading', { name: 'CV' }).closest('section')!.hasAttribute('data-invalid')).toBe(false)
  })

  it('⛔ the CV goes up as a PENDING upload BEFORE the PUT, and the PUT names it — its token and name, never a path', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    const posts = cvPosts()
    expect(posts.map((c) => c.url)).toEqual(['/api/teachers/me/cv?pending=1'])
    expect(((posts[0].body as FormData).get('file') as File).name).toBe('my-cv.pdf')
    expect(calls.indexOf(posts[0])).toBeLessThan(calls.indexOf(puts()[0]))
    expect(lastPut()).toMatchObject({ cvUpload: CV_TOKEN, cvFileName: 'my-cv.pdf', teacherProfileId: null })
    expect(JSON.stringify(lastPut())).not.toMatch(/cvPath|\.pdf"?:/)
    // Saved with the profile: the done screen does not ask for one — while its list of suggestions IS there (links in join
    // mode), so this absence can fail.
    expect(screen.getByRole('link', { name: 'Say more about yourself' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Add your CV' })).toBeNull()
  })

  it('an upload that fails refuses the Publish on the CV — no PUT — and keeps the file: the next tap goes through', async () => {
    let fail: 'store' | 'network' | null = 'store'
    cvReply = () => {
      if (fail === 'network') throw new TypeError('Failed to fetch')
      return fail ? { status: 502, json: { error: 'cv_store_failed' } } : { json: { ok: true, cvUpload: CV_TOKEN, cvFileName: 'my-cv.pdf' } }
    }
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    const cv = await cvSection()
    expect(await cv.findByText('Your CV didn’t upload. Please try again.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'CV' }).closest('section')!.hasAttribute('data-invalid')).toBe(true)
    expect(puts()).toEqual([])
    expect(cv.getByText('my-cv.pdf')).toBeTruthy()
    // A network failure is the same line — never "Something went wrong" over a Publish that was never sent.
    fail = 'network'
    await user.click(await publishReady())
    await waitFor(() => expect(cvPosts()).toHaveLength(2))
    expect(await cv.findByText('Your CV didn’t upload. Please try again.')).toBeTruthy()
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull()
    expect(puts()).toEqual([])
    fail = null
    await user.click(await publishReady())
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    expect(cvPosts()).toHaveLength(3)
    expect(puts()).toHaveLength(1)
    expect(lastPut()!.cvUpload).toBe(CV_TOKEN)
  })

  it('a file the server will never take (cv_type — a renamed file) is let go, and the section asks for a PDF — no PUT', async () => {
    cvReply = () => ({ status: 415, json: { error: 'cv_type' } })
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    const cv = await cvSection()
    expect(await cv.findByText('Your CV must be a PDF.')).toBeTruthy()
    expect(cv.queryByText('my-cv.pdf')).toBeNull()
    expect(cv.getByText('Choose PDF')).toBeTruthy()
    expect(puts()).toEqual([])
  })

  it('a connection’s day cap (cv_capacity) is said as "busy on this network" — never "your limit" — and the file is kept', async () => {
    cvReply = () => ({ status: 503, json: { error: 'cv_capacity' } })
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    const cv = await cvSection()
    expect(await cv.findByText('CV uploads are busy on this network right now — please try again later, or from another connection.')).toBeTruthy()
    expect(cv.getByText('my-cv.pdf')).toBeTruthy()
    expect(puts()).toEqual([])
  })

  it('the account’s upload limit (429) is said as such — never "try again", which would only spend more of it — and the file is kept', async () => {
    cvReply = () => ({ status: 429, json: { error: 'rate_limited' } })
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    const cv = await cvSection()
    expect(await cv.findByText('Too many CV uploads from this account — please try again in an hour.')).toBeTruthy()
    expect(cv.getByText('my-cv.pdf')).toBeTruthy()
    expect(puts()).toEqual([])
  })

  it('⛔ "expired" (the server no longer holds that upload): uploaded again and the PUT sent once more — ONCE', async () => {
    let n = 0
    cvReply = () => ({ json: { ok: true, cvUpload: ++n === 1 ? CV_TOKEN : CV_TOKEN_2, cvFileName: 'my-cv.pdf' } })
    let expired = 1
    putReply = () => (expired-- > 0 ? { status: 400, json: { error: 'invalid_teacher_profile', fields: { cv: 'expired' } } } : LIVE)
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    expect(cvPosts().map((c) => c.url)).toEqual(['/api/teachers/me/cv?pending=1', '/api/teachers/me/cv?pending=1'])
    expect(puts().map((c) => (c.body as Record<string, unknown>).cvUpload)).toEqual([CV_TOKEN, CV_TOKEN_2])
  })

  it('…and a second "expired" is said on the CV — never a third upload or PUT', async () => {
    putReply = () => ({ status: 400, json: { error: 'invalid_teacher_profile', fields: { cv: 'expired' } } })
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    const cv = await cvSection()
    expect(await cv.findByText('Your CV upload expired. Please tap Publish again.')).toBeTruthy()
    expect(cvPosts()).toHaveLength(2)
    expect(puts()).toHaveLength(2)
  })

  it('a Publish refused for something else, tapped again, names the SAME upload — the file is never uploaded twice', async () => {
    let first = true
    putReply = () => { if (first) { first = false; return { status: 503, json: { error: 'photo_check_unavailable' } } } return LIVE }
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    expect((await screen.findAllByText(/We couldn’t check your photo just now/)).length).toBeGreaterThan(0)
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    expect(cvPosts()).toHaveLength(1)
    expect(puts().map((c) => (c.body as Record<string, unknown>).cvUpload)).toEqual([CV_TOKEN, CV_TOKEN])
  })

  it('⛔ a pick that is no PDF, or over 10 MB, is refused AT PICK TIME — not kept, said on the CV section; a PDF by its name alone is taken', async () => {
    putDraft(COMPLETE, 'finish')
    mount()
    const cv = await cvSection()
    const section = () => screen.getByRole('heading', { name: 'CV' }).closest('section')!
    // fireEvent, not user.upload: user-event drops a file the input's `accept` does not list — a picker need not.
    fireEvent.change(cvInput(), { target: { files: [new File(['x'], 'cv.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })] } })
    expect(await cv.findByText('Your CV must be a PDF.')).toBeTruthy()
    expect(cv.queryByText('cv.docx')).toBeNull()
    expect(section().hasAttribute('data-invalid')).toBe(true)
    const big = pdf('big-cv.pdf')
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 })
    fireEvent.change(cvInput(), { target: { files: [big] } })
    expect(await cv.findByText('Your CV must be 10 MB or smaller.')).toBeTruthy()
    expect(cv.queryByText('big-cv.pdf')).toBeNull()
    // Some pickers give no type: the name decides — and a good pick clears the line.
    fireEvent.change(cvInput(), { target: { files: [pdf('scan.PDF', '')] } })
    expect(await cv.findByText('scan.PDF')).toBeTruthy()
    expect(cv.queryByText('Your CV must be 10 MB or smaller.')).toBeNull()
    expect(section().hasAttribute('data-invalid')).toBe(false)
    expect(cvPosts()).toEqual([]) // a pick uploads nothing: Publish does
  })

  it('the first step says up front that the CV is asked for, as a PDF', async () => {
    putDraft({ ...COMPLETE, photoUrl: null }, 'plans')
    mount()
    expect(await screen.findByText(/You will add a clear photo of yourself, a short intro video \(20–30 seconds is enough\) and your CV as a PDF\./)).toBeTruthy()
  })
})

// ── A new account signs in on this form and is NOT sent to /onboard (onboarding-gate.ts resumesInPlace) — so its first
// Publish is the assent, under the Terms line, and the SERVER records the account step (api/teachers/me PUT) — owner,
// 2026-10-11; commit gate: never from the browser, never skipped while the identity loads. ────────────────────────────
describe('Publish for an account that has not chosen its type yet', () => {
  const putBodies = () => calls.filter((c) => c.method === 'PUT').map((c) => c.body as Record<string, unknown>)

  it('⛔ the line above Publish names the three documents, and the save carries acceptTerms — no browser-side account call', async () => {
    auth.accountType = null
    putReply = () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: null, onboarded: true } })
    putDraft(COMPLETE, 'finish')
    const user = mount()
    const terms = (await screen.findAllByTestId('publish-terms'))[0]
    expect(terms.textContent).toBe('By publishing you agree to our Terms of Service, Operating regulations and Privacy Policy.')
    await addVideo(user)
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(lastPut()!.acceptTerms).toBe(true)
    expect(calls.some((c) => c.url === '/api/profile/account-type')).toBe(false)
    // the server said it recorded the step: the session learns it, so the gate never sends this account to /onboard
    await waitFor(() => expect(auth.markOnboarded).toHaveBeenCalledWith('individual'))
  })

  it('⛔ while the identity is still loading: no line, so no acceptTerms — the server refuses (terms_required), the line appears, and the next Publish under it goes through', async () => {
    auth.accountType = null
    auth.identityLoaded = false
    let first = true
    putReply = () => {
      if (first) { first = false; return { status: 409, json: { error: 'terms_required' } } }
      return { json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: null, onboarded: true } }
    }
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await addVideo(user)
    expect(screen.queryAllByTestId('publish-terms')).toHaveLength(0)
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Please read the line below, then tap Publish again.')).toBeTruthy()
    expect(screen.getAllByTestId('publish-terms').length).toBeGreaterThan(0)
    expect(putBodies()[0].acceptTerms).toBeUndefined()
    await user.click(action('Publish profile'))
    await waitFor(() => expect(putBodies()).toHaveLength(2))
    expect(putBodies()[1].acceptTerms).toBe(true)
  })

  it('an onboarded account sees no Terms line and sends no acceptTerms', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await addVideo(user)
    expect(screen.queryAllByTestId('publish-terms')).toHaveLength(0)
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(lastPut()!.acceptTerms).toBeUndefined()
    expect(auth.markOnboarded).not.toHaveBeenCalled()
  })
})

describe('sharing the profile (owner, 2026-10-11: "easy to share on facebook and zalo or whatsapp")', () => {
  it('the done screen offers the public page on Zalo, WhatsApp and Facebook', async () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    putDraft({ ...COMPLETE, photoUrl: null }, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    const share = within(screen.getByRole('region', { name: 'Share your profile' }))
    // this edition's own host (the env, else the form's apexOrigin) — the page's canonical
    const page = encodeURIComponent(`${(process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').replace(/\/+$/, '')}/listings/L1`)
    await user.click(share.getByRole('button', { name: 'Zalo' }))
    await user.click(share.getByRole('button', { name: 'WhatsApp' }))
    await user.click(share.getByRole('button', { name: 'Facebook' }))
    const urls = open.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toBe(`https://sp.zalo.me/plugins/share?url=${page}`)
    expect(urls[1]).toMatch(/^https:\/\/wa\.me\/\?text=/)
    expect(urls[1]).toContain(page)
    expect(urls[2]).toBe(`https://www.facebook.com/sharer/sharer.php?u=${page}`)
  })

  it('a profile saved but not visible to schools is not offered for sharing', async () => {
    putReply = () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: false, noGoal: false, cover: null, video: null } })
    putDraft({ ...COMPLETE, photoUrl: null }, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Profile saved')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Share your profile' })).toBeNull()
  })
})

// "IDENTITY VERIFIED" ON A NEW PROFILE (owner, 2026-10-15; AUTOMATIC since 2026-10-16; plan review R2): the mark shows by
// itself once the identity is verified, and the teacher keeps a way to hide it BEFORE publishing too. Its endpoint needs a
// profile, so before the first Publish the switch is held on the page — ON by default, enabled, with its notice and its
// line — and a hide rides that Publish as the create-only `identityMarkHidden: true`; nothing else ever carries it. Once
// published, a verified teacher is told the mark now shows, with the way to hide it — never pointed at switching it on.
describe('the "Identity verified" switch on a NEW profile', () => {
  const MARK_NAME = 'Show “Identity verified” on my profile'
  const markCalls = () => calls.filter((c) => c.url.startsWith('/api/teachers/me/identity-mark'))
  const meReads = () => calls.filter((c) => c.method === 'GET' && c.url === '/api/teachers/me').length
  /** The re-read after Publish was ISSUED (more reads than `before`) and its answer applied — before saying "no line". */
  const reReadLanded = async (before: number) => {
    await waitFor(() => expect(meReads()).toBeGreaterThan(before))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  }

  it('ON by default and ENABLED before the profile exists — a tap is held on the page and sends nothing', async () => {
    markState = { shown: false, reason: 'no_profile' }
    putDraft(COMPLETE, 'finish')
    const user = mount()
    const sw = await screen.findByRole('switch', { name: MARK_NAME })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('identity-mark-note').textContent).toMatch(/^On by default once your identity is verified\./)
    expect(screen.getByText('Your choice is saved when you publish.')).toBeTruthy()
    // The identity check is live (only the profile is missing): the trust line, and no opt-in nudge.
    expect(screen.getByText(/adds 10 points to your trust score/)).toBeTruthy()
    expect(screen.queryByText(/switch this on|switch it on/i)).toBeNull()
    await user.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    await user.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(markCalls()).toEqual([])
  })

  it('still to verify: the line says so, with the way there — and the switch is still the teacher\'s to set', async () => {
    markState = { shown: false, reason: 'unverified' }
    putDraft(COMPLETE, 'finish')
    const user = mount()
    const sw = await screen.findByRole('switch', { name: MARK_NAME })
    expect(screen.getByText(/^Verify your identity first/)).toBeTruthy()
    await user.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(markCalls()).toEqual([])
  })

  it('⛔ a hide before the first Publish rides it as the create-only `identityMarkHidden: true` — never the draft, never the endpoint', async () => {
    markState = { shown: false, reason: 'no_profile' }
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: MARK_NAME }))
    // Not in this tab's copy of the answers, nor in any draft save.
    expect(JSON.stringify(storedDraft() ?? {})).not.toMatch(/identity/i)
    await addVideo(user)
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    const body = lastPut()!
    expect(body.identityMarkHidden).toBe(true)
    expect(Object.keys(body).filter((k) => /identity/i.test(k))).toEqual(['identityMarkHidden'])
    expect(calls.filter((c) => c.url.startsWith('/api/teachers/me/draft')).some((c) => /identity/i.test(JSON.stringify(c.body ?? null)))).toBe(false)
    expect(markCalls()).toEqual([])
  })

  it('kept ON (or switched back on): Publish carries nothing about the switch — never `false`, never a notice', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    const sw = await screen.findByRole('switch', { name: MARK_NAME })
    await user.click(sw)
    await user.click(sw)
    await addVideo(user)
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    for (const k of Object.keys(lastPut()!)) expect(k, k).not.toMatch(/identity/i)
    expect(markCalls()).toEqual([])
  })

  it('while the Publish is on its way, a tap on the switch is dropped — it could never reach the profile', async () => {
    putDraft(COMPLETE, 'finish')
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    const inner = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/teachers/me' && init?.method === 'PUT') await held
      return inner(input, init)
    }))
    const user = mount()
    const sw = await screen.findByRole('switch', { name: MARK_NAME })
    await addVideo(user)
    await user.click(action('Publish profile'))
    await user.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    release()
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect('identityMarkHidden' in lastPut()!).toBe(false)
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
  })

  it('a verified teacher\'s first Publish: the done screen says the mark now shows, with the way to hide it; not shown: nothing', async () => {
    markState = { shown: true, reason: null }
    putDraft({ ...COMPLETE, photoUrl: null }, 'finish')
    let user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    const line = await screen.findByTestId('identity-mark-done')
    expect(line.textContent).toBe('“Identity verified” now shows on your profile. You can hide it in Photo & publish.')
    expect(within(line).getByRole('link', { name: 'You can hide it in Photo & publish.' }).getAttribute('href')).toBe('/teachers/edit?step=finish')
    // ⛔ No "Show “Identity verified”" pointer any more: there is nothing to switch on.
    expect(screen.queryByRole('link', { name: MARK_NAME })).toBeNull()
    for (const s of [{ shown: false, reason: 'unverified' }, { shown: false, reason: 'hidden' }, { shown: false, reason: 'name_mismatch' }, null]) {
      cleanup()
      markState = s
      putDraft({ ...COMPLETE, photoUrl: null }, 'finish')
      user = mount()
      await addVideo(user)
      const before = meReads()
      await user.click(action('Publish profile'))
      expect(await screen.findByText('Your profile is live')).toBeTruthy()
      await reReadLanded(before)
      expect(screen.queryByTestId('identity-mark-done'), JSON.stringify(s)).toBeNull()
      expect(screen.queryByRole('link', { name: MARK_NAME })).toBeNull()
    }
  })

  it('…not while schools cannot see the profile (held): the mark is not public either', async () => {
    markState = { shown: true, reason: null }
    putReply = () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: false, noGoal: false, cover: null, video: null } })
    putDraft({ ...COMPLETE, photoUrl: null }, 'finish')
    const user = mount()
    await addVideo(user)
    const before = meReads()
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Profile saved')).toBeTruthy()
    await reReadLanded(before)
    expect(screen.queryByTestId('identity-mark-done')).toBeNull()
  })

  // Commit gate, 2026-10-16: the state read on load had no profile to judge (no name), so the line can only come from a
  // re-read AFTER the first publish — the hand-set state above never exercised that.
  it('a FIRST publish re-reads the mark: nothing known before the profile existed, the line once the server can judge it', async () => {
    markState = null
    putReply = () => {
      markState = { shown: true, reason: null }
      return { json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: null } }
    }
    putDraft({ ...COMPLETE, photoUrl: null }, 'finish')
    const user = mount()
    await addVideo(user)
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    expect((await screen.findByTestId('identity-mark-done')).textContent).toMatch(/^“Identity verified” now shows on your profile\./)
    const putAt = calls.findIndex((c) => c.method === 'PUT')
    expect(calls.slice(putAt + 1).some((c) => c.method === 'GET')).toBe(true)
  })
})

describe('the photo check waits for "Photo & publish" (gate review, 2026-10-16)', () => {
  const photoChecks = () => calls.filter((c) => c.url === '/api/teachers/me/photo-check')
  it('⛔ the account photo filled in for the teacher is never sent for checking while they answer step 1', async () => {
    putDraft({ ...COMPLETE, photoUrl: null }, 'plans')
    mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    // The prefill has run (the account answered) — and still nothing went to the check.
    await waitFor(() => expect(calls.some((c) => c.url === '/api/teachers/me')).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(photoChecks()).toEqual([])
  })
  it('on "Photo & publish" the account photo still waits for Publish; a photo the teacher uploads is checked at once, once', async () => {
    const UPLOADED = 'https://sb.eno.vn/storage/v1/object/public/listings/1791898094623-rh7bov.webp'
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: { teacher: null, publishGate: { ok: true, code: null }, prefill, identityMark: null, identityMarkStamps: { at: null, withdrawnAt: null } } }),
      'POST /api/upload': () => ({ json: { urls: [UPLOADED] } }),
      'POST /api/teachers/me/photo-check': () => ({ json: { checked: true, ok: true } }),
    })
    vi.stubGlobal('fetch', f.fn)
    putDraft({ ...COMPLETE, photoUrl: null }, 'finish')
    const user = mount()
    await waitFor(() => expect(document.querySelector('img[src="' + PHOTO + '"]')).toBeTruthy())
    await new Promise((r) => setTimeout(r, 50))
    const checks = () => f.calls.filter((c) => c.url === '/api/teachers/me/photo-check')
    expect(checks()).toEqual([])
    await user.upload(document.querySelector<HTMLInputElement>('input[accept="image/jpeg,image/png,image/webp,.heic,.heif"]')!, new File(['p'], 'me.jpg', { type: 'image/jpeg' }))
    await waitFor(() => expect(checks()).toHaveLength(1))
    expect(checks()[0].body).toEqual({ url: UPLOADED })
    await new Promise((r) => setTimeout(r, 50))
    expect(checks()).toHaveLength(1)
  })
})

// ── THE JOB-MATCH SWITCHES ARE ON BY DEFAULT FOR A NEW PROFILE (owner, 2026-10-22: "all toggles should be on by default" →
// "On by default everywhere"; accepted legal risk, recorded in the dossier with which teachers left a default on). The
// default rides BESIDE the answers (teacher-form.tsx optInChoice): never in `t`, a draft or a link; only a refusal is kept,
// per tab; Publish says which switch was left at its default (`optInDefaults`). ─────────────────────────────────────────
describe('the job-match switches — ON by default for a new profile', () => {
  const email = () => screen.getByRole('switch', { name: 'Email me jobs that match my profile' })
  const staff = () => screen.getByRole('switch', { name: 'Our staff may call me' })

  it('⛔ a switch turned OFF survives a reload in the same tab — kept as a refusal BESIDE the answers, never in them', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await screen.findByRole('switch', { name: 'Email me jobs that match my profile' })
    await waitFor(() => expect(email().getAttribute('aria-checked')).toBe('true'))
    await user.click(email())
    expect(email().getAttribute('aria-checked')).toBe('false')
    await waitFor(() => expect(storedDraft().optInsOff).toEqual(['matchEmail']))
    // Only the refusal: no consent in the answers, and an explicit ON is never written (ON is the default).
    expect(storedDraft().t).toMatchObject({ matchEmailOptIn: false, staffContactOptIn: false })
    // The reload: a fresh page in the same tab (sessionStorage stays).
    cleanup()
    mount()
    await screen.findByRole('switch', { name: 'Email me jobs that match my profile' })
    await waitFor(() => expect(staff().getAttribute('aria-checked')).toBe('true'))
    expect(email().getAttribute('aria-checked')).toBe('false')
  })

  it('…and switching it back ON drops the refusal from the tab copy', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await screen.findByRole('switch', { name: 'Email me jobs that match my profile' })
    await waitFor(() => expect(email().getAttribute('aria-checked')).toBe('true'))
    await user.click(email())
    await waitFor(() => expect(storedDraft().optInsOff).toEqual(['matchEmail']))
    await user.click(email())
    await waitFor(() => expect('optInsOff' in storedDraft()).toBe(false))
  })

  it('the PUT carries the values in effect, the aiNotice, and optInDefaults — true for an untouched ON, false once the teacher touched it', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await addVideo(user)
    await waitFor(() => expect(email().getAttribute('aria-checked')).toBe('true'))
    // Job emails: off, then on again — the teacher's own ON now, not the default. Staff calls: untouched.
    await user.click(email())
    await user.click(email())
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(lastPut()).toMatchObject({
      matchEmailOptIn: true, staffContactOptIn: true, aiNotice: AI_NOTICE_VERSION,
      optInDefaults: { matchEmail: false, staffCall: true },
    })
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    // A done Publish clears the tab copy — refusals included.
    expect(storedDraft()).toBeNull()
  })

  it('a cover-only teacher is asked neither, and the save keeps both OFF — so neither is reported as a default', async () => {
    putDraft({ ...COMPLETE, jobTypes: [], relocate: '', coverSlots: ['mon-am'], coverRateVnd: 300_000 }, 'finish')
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: 'Available for cover lessons' }))
    await user.click(action('Next'))
    await addVideo(user)
    expect(screen.queryByRole('switch', { name: 'Email me jobs that match my profile' })).toBeNull()
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    // The switches go AS SAVED (normalizeForSave: no job, no opt-in) — never a default ON as a claim, nor its aiNotice
    // (checker, 2026-10-22) — and so neither is reported as a default.
    expect(lastPut()).toMatchObject({ matchEmailOptIn: false, staffContactOptIn: false })
    expect(lastPut()).not.toHaveProperty('aiNotice')
    expect(lastPut()!.optInDefaults).toEqual({ matchEmail: false, staffCall: false })
  })

  it('the default does not wait for /api/teachers/me — never an OFF that flips ON with no tap (commit gate, 2026-10-22); an answer that failed leaves it ON', async () => {
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ status: 503, json: { error: 'unavailable' } }),
      'PUT /api/teachers/me': (b) => putReply(b),
      'POST /api/teachers/me/cv?pending=1': () => cvReply(),
    })
    calls = f.calls
    vi.stubGlobal('fetch', f.fn)
    putDraft({ ...COMPLETE, phone: '+84901234567' }, 'finish')
    mount()
    await screen.findByRole('switch', { name: 'Email me jobs that match my profile' })
    expect(email().getAttribute('aria-checked')).toBe('true')
    expect(staff().getAttribute('aria-checked')).toBe('true')
  })
})
