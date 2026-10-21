// @vitest-environment jsdom
/**
 * "IMPROVE WITH AI" UNDER THE ABOUT TEXT (owner, 2026-10-21: "once they write about them use ai … it should read all
 * teacher info that was inputed and description they have and enhance it in short concise but very effective form"),
 * whole-form — teacher-form.tsx improveBio, steps/about-step.tsx:
 *   · offered only when GET /api/teachers/me says the AI is there (`bioAi`), and only once there is something to improve
 *     (a hint before), with its notice as the chip's own description;
 *   · ⛔ what is sent: the answers bio-notice.ts names, field by field — never the name, phone, photo, video, salary, start
 *     month, cover or a consent — with the page's language, the notice version and the hash of the words it showed;
 *   · while it runs the text is read-only and the bar's primary waits; the answer replaces the text with an Undo that
 *     works only while the text is still the AI's; a late answer (the text changed, the teacher left About) is dropped;
 *   · every refusal says what to do next, as a status line (never an alert or a field error); in the apps the Google AI
 *     question (family teacher_bio) comes first and "Not now" sends nothing; a double tap sends once;
 *   · edit mode: the same button from ?step=about, and "Save changes" carries the AI's text.
 * ⚠️ NEXT_PUBLIC_APP_REVIEW_GATES is stubbed in every test: the shell's .env leaks into vitest (vitest.config.ts).
 */
import { createHash } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, configure, fireEvent, getConfig, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { forgetAiConsentMemory, registerAiConsentAsker } from '@/lib/ai-consent'
import { BIO_ACTION_LABEL, BIO_NOTICE, TEACHER_BIO_NOTICE_VERSION } from '@/lib/teachers/bio-notice'
import { AI_NOTICE_VERSION, PUBLISH_NOTICE_VERSION } from '@/lib/teachers/profile'
import { COVER_CONSENT_VERSION } from '@/lib/teachers/cover'
import { COMPLETE, fakeFetch, putDraft, storedDraft, stubBrowser, type Call } from './teacher-form.fixtures'

/** The notice as the About step shows it: its parts, one after another. */
const NOTICE_EN = BIO_NOTICE.map((p) => p.en).join(' ')

const auth = vi.hoisted(() => ({
  user: { id: 'u1' } as null | { id: string }, loading: false, openSignIn: vi.fn(),
  accountType: 'individual' as string | null, identityLoaded: true, markOnboarded: vi.fn(),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/components/marketplace/push-opt-in-card', () => ({ PushOptInCard: () => null }))
vi.mock('@/hooks/use-dashboard', () => ({ revalidateDashboard: () => {} }))
// App Store gate `ios-hide-kyc` — off: the finish step is not under test here.
vi.mock('@/hooks/use-ios-hide-kyc', () => ({ useIosHideKyc: () => false }))

import { TeacherForm } from './teacher-form'

const asyncUtilTimeout = getConfig().asyncUtilTimeout
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 60_000 })
afterAll(() => { configure({ asyncUtilTimeout }); vi.resetConfig() })
beforeAll(() => { Element.prototype.scrollIntoView ??= function () {} })

const BIO_URL = '/api/teachers/me/bio-rewrite'
const GEN = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const OWN = 'I teach IELTS speaking to adults in small groups, with lots of practice.'
const AI = 'I am a CELTA-qualified English teacher who helps adults speak with confidence. In small IELTS speaking groups I keep the practice frequent and the feedback clear.'
const UNDO_LINE = 'Rewritten with AI — read it and make it yours.'
const FAILED_LINE = 'AI couldn’t improve this text. Try again, or add a little more about how you teach.'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** ⛔ The contract (brief B2 / bio-notice.ts): what the rewrite may send, and what it may never send. */
const ALLOWED = [
  'livesIn', 'currentCity', 'currentDistrictKey', 'currentProvince', 'jobTypes', 'relocate', 'teachAreas', 'teachAreasConfirmed',
  'subjects', 'teachLanguages', 'ageGroups', 'experienceBand', 'experience', 'degreeLevel', 'degreeMajor', 'degreeInstitution',
  'degreeYear', 'certificates', 'nationality', 'englishLevel', 'languages', 'headline', 'bio',
]
const NEVER = [
  'fullName', 'phone', 'photoUrl', 'videoUrl', 'videoOnRequest', 'expectedSalaryM', 'availableFrom',
  'coverOpen', 'coverSlots', 'coverRateVnd', 'coverConsent', 'matchEmailOptIn', 'staffContactOptIn',
]

let calls: Call[] = []
let me: Record<string, unknown> = {}
let bioReply: (body: unknown) => { status?: number; json: unknown } = () => ({ json: { bio: AI, model: 'gemini-3.8-flash' } })
let bioThrows = false
// A request held open until the test lets it answer (teacher-form.draft.test.tsx's pending-fetch pattern) — by default
// the rewrite; recorded when sent, answered on `open()`.
const held = new Map<string, Promise<void>>()
const hold = (key = `POST ${BIO_URL}`) => {
  let open: () => void = () => {}
  held.set(key, new Promise<void>((r) => { open = r }))
  return () => { held.delete(key); open() }
}

beforeEach(() => {
  stubBrowser()
  vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
  auth.user = { id: 'u1' }
  history.replaceState(null, '', '/teachers/join')
  me = { teacher: null, publishGate: { ok: true, code: null }, prefill: null, bioAi: true }
  bioReply = () => ({ json: { bio: AI, model: 'gemini-3.8-flash' } })
  bioThrows = false
  held.clear()
  let rev = 0
  const f = fakeFetch({
    'GET /api/teachers/me': () => ({ json: me }),
    'GET /api/teachers/me/draft': () => ({ json: { draft: null } }),
    'PUT /api/teachers/me/draft': () => ({ json: { rev: ++rev, gen: GEN, updatedAt: '2026-10-21T10:00:00.000Z' } }),
    'PUT /api/teachers/me': () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: { onRequest: false, version: 1, hasPrivate: false, url: null } } }),
    [`POST ${BIO_URL}`]: (b) => bioReply(b),
  })
  calls = f.calls
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === BIO_URL && bioThrows) throw new TypeError('Failed to fetch')
    const res = await f.fn(input, init)
    const wait = held.get(`${(init?.method ?? 'GET').toUpperCase()} ${String(input).split('?')[0]}`)
    if (wait) await wait
    return res
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  registerAiConsentAsker(null)
  forgetAiConsentMemory()
})

function mount(mode: 'join' | 'edit' = 'join', lang: 'en' | 'vi' = 'en') {
  render(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      <main><TeacherForm mode={mode} draftHost={false} apexOrigin="https://eno.vn" /></main>
    </LanguageProvider>,
  )
  return userEvent.setup()
}
const action = (name: string | RegExp) => screen.getAllByRole('button', { name })[0] as HTMLButtonElement
const box = () => screen.getByRole('textbox', { name: 'About you (optional)' }) as HTMLTextAreaElement
const improve = () => screen.findByRole('button', { name: 'Improve with AI' })
const bioCalls = () => calls.filter((c) => c.method === 'POST' && c.url === BIO_URL)
type BioBody = { t: Record<string, unknown>; lang: string; notice: string; shown?: string }
const draftPuts = () => calls.filter((c) => c.method === 'PUT' && c.url === '/api/teachers/me/draft').map((c) => c.body as { t: Record<string, unknown>; step: string })
/** Settled: the chip is no longer working (a status line or the new text has landed, or nothing was sent). */
const settled = () => waitFor(async () => expect((await improve()).getAttribute('aria-busy')).toBeNull())

describe('"Improve with AI" — when it is offered', () => {
  it('nothing of it shows unless GET /api/teachers/me says the AI is there (`bioAi`) — an older server says nothing', async () => {
    for (const bioAi of [false, undefined]) {
      me = { teacher: null, publishGate: { ok: true, code: null }, prefill: null, ...(bioAi === undefined ? {} : { bioAi }) }
      putDraft({ ...COMPLETE, bio: OWN }, 'about')
      mount()
      expect(await screen.findByRole('textbox', { name: 'About you (optional)' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Improve with AI' })).toBeNull()
      expect(screen.queryByText(/then AI can polish it/)).toBeNull()
      expect(screen.queryByText(NOTICE_EN)).toBeNull()
      cleanup()
    }
  })

  it('under three characters a hint says what to write first; then the chip, with its notice as its own description', async () => {
    putDraft({ ...COMPLETE, bio: 'hi' }, 'about')
    const user = mount()
    expect(await screen.findByText('Write a line or two about how you teach — then AI can polish it.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Improve with AI' })).toBeNull()
    await user.type(box(), ' there')
    const chip = await improve()
    expect(screen.queryByText(/then AI can polish it/)).toBeNull()
    const note = document.getElementById(chip.getAttribute('aria-describedby') ?? '')
    expect(note?.textContent).toBe(NOTICE_EN)
    // The notice is the chip's alone — never read as the textarea's description.
    expect((box().getAttribute('aria-describedby') ?? '').split(' ')).not.toContain(note?.id)
    // ⛔ Under the description, never in the label row: the textarea stays the Field's first focusable control.
    expect(box().compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('"Improve with AI" — a tap', () => {
  it('the chip spins, the text is read-only and Next waits; the answer replaces the text, with an Undo line', async () => {
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    const open = hold()
    await user.click(await improve())
    await waitFor(() => expect(bioCalls()).toHaveLength(1))
    expect((await improve()).getAttribute('aria-busy')).toBe('true')
    expect(box().readOnly).toBe(true)
    expect(action('Next').disabled).toBe(true)
    // Typing does nothing meanwhile: the text sent is the text replaced.
    await user.type(box(), ' More')
    expect(box().value).toBe(OWN)
    open()
    await waitFor(() => expect(box().value).toBe(AI))
    expect(box().readOnly).toBe(false)
    expect(action('Next').disabled).toBe(false)
    expect(screen.getByText(UNDO_LINE).getAttribute('role')).toBe('status')
    expect(screen.getByRole('button', { name: 'Undo the AI rewrite' })).toBeTruthy()
    // Saved like typing: this tab's copy holds it at once, and the account's draft on the next step change.
    expect(storedDraft().t.bio).toBe(AI)
    await user.click(action('Next'))
    await waitFor(() => expect(draftPuts().at(-1)?.t.bio).toBe(AI))
  })

  it('⛔ sends the page’s language, the notice version it showed and the hash of the words it showed — and the text as written', async () => {
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    await user.click(await improve())
    await waitFor(() => expect(bioCalls()).toHaveLength(1))
    const body = bioCalls()[0].body as BioBody
    expect(body).toMatchObject({ lang: 'en', notice: TEACHER_BIO_NOTICE_VERSION, shown: sha256([BIO_ACTION_LABEL, ...BIO_NOTICE].map((p) => p.en).join('\n')) })
    expect(Object.keys(body).sort()).toEqual(['lang', 'notice', 'shown', 't'])
    expect(body.t.bio).toBe(OWN)
    expect(Object.keys(body.t).sort()).toEqual([...ALLOWED].sort())
  })

  it('in Vietnamese: the page’s language and the Vietnamese words it showed', async () => {
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount('join', 'vi')
    await user.click(await screen.findByRole('button', { name: BIO_ACTION_LABEL.vi }))
    await waitFor(() => expect(bioCalls()).toHaveLength(1))
    expect(bioCalls()[0].body).toMatchObject({ lang: 'vi', shown: sha256([BIO_ACTION_LABEL, ...BIO_NOTICE].map((p) => p.vi).join('\n')) })
    expect(screen.getByText(BIO_NOTICE.map((p) => p.vi).join(' '))).toBeTruthy()
  })

  it('⛔ ONE status line, there before the tap — its words change, the element does not (a live region inserted already holding its text is often not read out — gate review, 2026-10-22)', async () => {
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    const chip = await improve()
    const region = document.querySelector<HTMLElement>('#tf-bio-ai-note ~ div [role="status"]')
    expect(region?.textContent).toBe('')
    await user.click(chip)
    await waitFor(() => expect(box().value).toBe(AI))
    expect(screen.getByText(UNDO_LINE)).toBe(region)
    // The Undo button is beside it, never inside what is read out.
    expect(region?.contains(screen.getByRole('button', { name: 'Undo the AI rewrite' }))).toBe(false)
  })

  it('Undo puts the teacher’s own words back, and the line goes', async () => {
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    await user.click(await improve())
    await waitFor(() => expect(box().value).toBe(AI))
    await user.click(screen.getByRole('button', { name: 'Undo the AI rewrite' }))
    expect(box().value).toBe(OWN)
    expect(screen.queryByText(UNDO_LINE)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo the AI rewrite' })).toBeNull()
  })

  it('⛔ an edit after the rewrite is the teacher’s newer word: the Undo line is gone, and nothing takes the edit back', async () => {
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    await user.click(await improve())
    await waitFor(() => expect(box().value).toBe(AI))
    await user.type(box(), ' Ask me about mock tests.')
    expect(screen.queryByText(UNDO_LINE)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo the AI rewrite' })).toBeNull()
    expect(box().value).toBe(`${AI} Ask me about mock tests.`)
    // …and the text made the AI's again by hand brings no stale Undo back (gate review, codex 2026-10-22).
    await user.clear(box())
    await user.type(box(), AI)
    expect(box().value).toBe(AI)
    expect(screen.queryByRole('button', { name: 'Undo the AI rewrite' })).toBeNull()
  })

  it('⛔ a late answer is dropped when the text changed meanwhile (a writer other than typing)', async () => {
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    const open = hold()
    await user.click(await improve())
    await waitFor(() => expect(bioCalls()).toHaveLength(1))
    fireEvent.change(box(), { target: { value: 'Changed while it ran, by something else.' } })
    open()
    await settled()
    expect(box().value).toBe('Changed while it ran, by something else.')
    expect(screen.queryByText(UNDO_LINE)).toBeNull()
  })

  it('⛔ an answer written from answers changed meanwhile (a headline typed while it ran) never lands — said, and the next tap sends the new (gate review, 2026-10-22)', async () => {
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    const open = hold()
    await user.click(await improve())
    await waitFor(() => expect(bioCalls()).toHaveLength(1))
    const headline = screen.getByRole('textbox', { name: 'Headline' }) as HTMLInputElement
    await user.type(headline, ' and phonics')
    open()
    expect(await screen.findByText('Your answers changed while AI was writing — tap “Improve with AI” again.')).toBeTruthy()
    expect(box().value).toBe(OWN)
    expect(screen.queryByText(UNDO_LINE)).toBeNull()
    await user.click(await improve())
    await waitFor(() => expect(box().value).toBe(AI))
    expect((bioCalls()[1].body as { t: { headline: string } }).t.headline).toMatch(/ and phonics$/)
  })

  it('⛔ leaving About lets a rewrite on its way go: Next is never held up elsewhere, and its late answer changes nothing', async () => {
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    const open = hold()
    await user.click(await improve())
    await waitFor(() => expect(bioCalls()).toHaveLength(1))
    await user.click(action('Back'))
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    expect(action('Next').disabled).toBe(false)
    open()
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    await user.click(action('Next'))
    expect(await screen.findByRole('textbox', { name: 'About you (optional)' })).toBeTruthy()
    expect(box().value).toBe(OWN)
    expect(box().readOnly).toBe(false)
    expect(screen.queryByText(UNDO_LINE)).toBeNull()
    expect((await improve()).getAttribute('aria-busy')).toBeNull()
    // What the account's draft was given on the way is the teacher's own text.
    await waitFor(() => expect(draftPuts().length).toBeGreaterThan(0))
    expect(draftPuts().every((p) => p.t.bio === OWN)).toBe(true)
  })

  it('⛔ back on About while the let-go rewrite still runs on the server: the chip waits — a tap sends nothing — until it settles (gate review, 2026-10-21)', async () => {
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    const open = hold()
    await user.click(await improve())
    await waitFor(() => expect(bioCalls()).toHaveLength(1))
    await user.click(action('Back'))
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    await user.click(action('Next'))
    expect(await screen.findByRole('textbox', { name: 'About you (optional)' })).toBeTruthy()
    // The server still holds its one-at-a-time lock: the chip spins and is disabled, the text is the teacher's to edit.
    const chip = await improve()
    expect(chip.getAttribute('aria-busy')).toBe('true')
    expect(box().readOnly).toBe(false)
    act(() => { chip.click() })
    expect(bioCalls()).toHaveLength(1)
    open()
    await settled()
    expect(box().value).toBe(OWN)
    expect(screen.queryByText(UNDO_LINE)).toBeNull()
    await user.click(await improve())
    await waitFor(() => expect(box().value).toBe(AI))
    expect(bioCalls()).toHaveLength(2)
  })

  it('⛔ the CV reader taking the form’s place on About lets the answer go — it never lands behind the panel, nor rides the reading’s draft save (gate review, 2026-10-21)', async () => {
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    render(
      <LanguageProvider initialLang="en" initialViDict={{}}>
        <main><TeacherForm mode="join" draftHost={false} apexOrigin="https://eno.vn" start={{ importIntent: null, sessionHint: true, cvImport: true, campaign: '' }} /></main>
      </LanguageProvider>,
    )
    const user = userEvent.setup()
    const open = hold()
    await user.click(await improve())
    await waitFor(() => expect(bioCalls()).toHaveLength(1))
    const card = await screen.findByTestId('cv-handy')
    await user.click(within(card).getByRole('button', { name: 'Use my CV' }))
    expect(await screen.findByRole('heading', { name: 'Fill it in from your CV' })).toBeTruthy()
    open()
    await act(async () => { await new Promise((r) => setTimeout(r, 100)) })
    expect(storedDraft()?.t?.bio).toBe(OWN)
    expect(draftPuts().every((p) => p.t.bio === OWN)).toBe(true)
  })

  it('a rewrite of the AI’s own text keeps the teacher’s words as Undo’s target — never the first AI answer', async () => {
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    await user.click(await improve())
    await waitFor(() => expect(box().value).toBe(AI))
    const AI2 = 'I teach IELTS speaking to adults in small groups. My classes give every student lots of practice, and I give clear feedback after each one.'
    bioReply = () => ({ json: { bio: AI2, model: 'gemini-3.8-flash' } })
    await user.click(await improve())
    await waitFor(() => expect(box().value).toBe(AI2))
    await user.click(screen.getByRole('button', { name: 'Undo the AI rewrite' }))
    expect(box().value).toBe(OWN)
  })

  it('a double tap sends ONE request', async () => {
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    mount()
    const chip = await improve()
    // Both taps before React re-renders: the second meets the busy flag, not a spinning chip.
    act(() => { chip.click(); chip.click() })
    await waitFor(() => expect(box().value).toBe(AI))
    expect(bioCalls()).toHaveLength(1)
  })
})

describe('"Improve with AI" — refusals, each as the teacher’s next step', () => {
  it.each([
    [401, { error: 'auth_required' }, 'Your session ended — sign in again to use AI.'],
    [409, { error: 'notice_changed', notice: 'bio' }, 'The words on this page changed since you opened it. Reload the page to read them, then try again.'],
    [429, { error: 'rate_limited' }, 'Too many tries — please try again in a few minutes.'],
    [503, { error: 'ai_unavailable' }, 'AI isn’t available right now — please try again later.'],
    [400, { error: 'too_short' }, 'Write a little more first.'],
    [400, { error: 'bad_request' }, FAILED_LINE],
    [502, { error: 'ai_failed' }, FAILED_LINE],
    [200, { model: 'gemini-3.8-flash' }, FAILED_LINE],
    // ⛔ The teacher's own text handed back is no rewrite: never "Rewritten with AI" with an Undo that changes nothing.
    [200, { bio: OWN, model: 'gemini-3.8-flash' }, FAILED_LINE],
  ])('%i %j → its line, as a status (never an alert or a field error), and the text stays the teacher’s', async (status, json, line) => {
    bioReply = () => ({ status, json })
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    await user.click(await improve())
    const said = await screen.findByText(line)
    expect(said.getAttribute('role')).toBe('status')
    expect(said.closest('[data-invalid], [aria-invalid="true"], [role="alert"], [data-form-error]')).toBeNull()
    expect(box().getAttribute('aria-invalid')).not.toBe('true')
    expect(box().value).toBe(OWN)
    expect(box().readOnly).toBe(false)
    expect(screen.queryByText(UNDO_LINE)).toBeNull()
  })

  it('no answer at all (offline) → "Couldn’t reach eno" (never "eno.vn": the form is on both sites); the next tap clears the line', async () => {
    bioThrows = true
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    await user.click(await improve())
    expect(await screen.findByText('Couldn’t reach eno — check your connection and try again.')).toBeTruthy()
    expect(box().value).toBe(OWN)
    bioThrows = false
    await user.click(await improve())
    await waitFor(() => expect(box().value).toBe(AI))
    expect(screen.queryByText(/Couldn’t reach eno/)).toBeNull()
  })

  it('⛔ a refusal’s line goes once the teacher changes the text — "Write a little more first" never outlives the more (gate review, codex 2026-10-22)', async () => {
    bioReply = () => ({ status: 400, json: { error: 'too_short' } })
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    await user.click(await improve())
    expect(await screen.findByText('Write a little more first.')).toBeTruthy()
    await user.type(box(), ' I teach phonics with songs.')
    expect(screen.queryByText('Write a little more first.')).toBeNull()
  })
})

describe('"Improve with AI" in the apps — the Google AI question first (gate app-ai-notice, family teacher_bio)', () => {
  const inApp = () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_APP)
  }

  it('"Not now": nothing is sent, and the text stays as the teacher wrote it — editable', async () => {
    inApp()
    const asker = vi.fn(async () => 'off' as const)
    registerAiConsentAsker(asker)
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    await user.click(await improve())
    await waitFor(() => expect(asker).toHaveBeenCalledWith('teacher_bio', 'u1', undefined))
    await settled()
    expect(bioCalls()).toHaveLength(0)
    expect(box().value).toBe(OWN)
    expect(box().readOnly).toBe(false)
  })

  it('"Allow": sent', async () => {
    inApp()
    registerAiConsentAsker(vi.fn(async () => 'on' as const))
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    const user = mount()
    await user.click(await improve())
    await waitFor(() => expect(box().value).toBe(AI))
    expect(bioCalls()).toHaveLength(1)
  })

  it('a second tap while the question is open asks nothing more — "Allow" sends ONE request', async () => {
    inApp()
    let answer: (ok: boolean) => void = () => {}
    const asker = vi.fn(() => new Promise<'on' | 'off' | null>((resolve) => { answer = (ok) => resolve(ok ? 'on' : 'off') }))
    registerAiConsentAsker(asker)
    putDraft({ ...COMPLETE, bio: OWN }, 'about')
    mount()
    const chip = await improve()
    await act(async () => { fireEvent.click(chip) })
    await act(async () => { fireEvent.click(chip) })
    expect(asker).toHaveBeenCalledTimes(1)
    expect(bioCalls()).toHaveLength(0)
    await act(async () => { answer(true) })
    await waitFor(() => expect(box().value).toBe(AI))
    expect(bioCalls()).toHaveLength(1)
  })
})

// ── EDIT: /teachers/edit?step=about — the done screen's "Say more about yourself" lands here ─────────────────────────
const PHOTO = 'https://sb.eno.vn/storage/v1/object/public/listings/me.webp'
const VIDEO = 'https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000001-efgh34.mp4'
/** A saved profile (edit.test.tsx's ROW) with EVERY answer the rewrite must never send filled in. */
const ROW = {
  id: 'tp1', profileId: 'u1', listingId: 'L1', status: 'live', listingLive: true, situationVersion: 1,
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', currentProvince: null, currentDistrict: 'Quận 7 (Phú Mỹ Hưng)',
  teachAreas: ['d4', 'd7'], teachAreasConfirmedAt: '2026-10-08T00:00:00.000Z', preferredCities: ['ho-chi-minh-city'],
  jobTypes: ['fulltime'], expectedSalaryM: 30, availableFrom: '2026-11-01T00:00:00.000Z',
  subjects: ['general-english'], teachLanguages: [], ageGroups: ['adults'], experienceBand: '3-5-years', yearsExperience: 3,
  experience: [{ role: 'ESL Teacher', employer: 'ILA Vietnam', city: 'Ho Chi Minh City', from: '2023-02', to: '' }],
  degreeLevel: 'bachelor', degreeMajor: 'English', degreeInstitution: 'University of Leeds', degreeYear: 2016,
  certificates: [{ type: 'celta', hours: 120, provider: 'Cambridge English', year: 2019 }],
  fullName: 'Jane Doe', nationality: 'GB', englishLevel: 'native', nativeSpeaker: true, languages: ['French'], headline: 'CELTA English teacher, five years', bio: OWN,
  coverOpen: true, coverSlots: ['mon-eve'], coverAreas: ['d4', 'd7'], coverRateVnd: 300_000, coverConsentVersion: COVER_CONSENT_VERSION, coverConsentAt: '2026-10-08T00:00:00.000Z', coverConfirmedAt: '2026-10-08',
  photoUrl: PHOTO, videoUrl: VIDEO, videoOnRequest: false, videoVersion: 1, hasPrivateVideo: false, cvFileName: 'my-cv.pdf', phone: '+84901234567',
  matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION, staffContactOptIn: true, staffContactNoticeVersion: AI_NOTICE_VERSION,
  consentPublicVersion: PUBLISH_NOTICE_VERSION,
}
const rail = (name: string) => within(document.querySelector('[data-slot="step-rail"]') as HTMLElement).getByRole('button', { name })
const lastPut = () => calls.filter((c) => c.method === 'PUT' && c.url === '/api/teachers/me').at(-1)?.body as Record<string, unknown> | undefined

describe('"Improve with AI" on an edit (?step=about)', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/teachers/edit?step=about')
    me = { teacher: ROW, publishGate: { ok: true, code: null }, bioAi: true }
  })

  it('⛔ the request carries exactly the allowlisted answers — never the name, phone, photo, video, salary, start month, cover or a consent', async () => {
    const user = mount('edit')
    await user.click(await improve())
    await waitFor(() => expect(bioCalls()).toHaveLength(1))
    const body = bioCalls()[0].body as BioBody
    expect(Object.keys(body.t).sort()).toEqual([...ALLOWED].sort())
    for (const k of NEVER) expect(body.t).not.toHaveProperty(k)
    const wire = JSON.stringify(body)
    for (const v of ['Jane Doe', '+84901234567', PHOTO, VIDEO, 'my-cv.pdf', 'mon-eve', '2026-11-01']) expect(wire).not.toContain(v)
    // …and what it does carry is the form's answers, as a save keeps them.
    expect(body.t).toMatchObject({
      bio: OWN, headline: 'CELTA English teacher, five years', nationality: 'GB', englishLevel: 'native', languages: ['French'],
      subjects: ['general-english'], ageGroups: ['adults'], experienceBand: '3-5-years', degreeLevel: 'bachelor', degreeYear: 2016,
      experience: [{ role: 'ESL Teacher', employer: 'ILA Vietnam', city: 'Ho Chi Minh City', from: '2023-02', to: '' }],
      certificates: [{ type: 'celta', hours: 120, provider: 'Cambridge English', year: 2019 }],
      livesIn: 'city', currentCity: 'ho-chi-minh-city', jobTypes: ['fulltime'],
    })
    expect(body).toMatchObject({ lang: 'en', notice: TEACHER_BIO_NOTICE_VERSION })
  })

  it('"Save changes" waits while it runs, then carries the AI’s text', async () => {
    const user = mount('edit')
    const open = hold()
    await user.click(await improve())
    await waitFor(() => expect(bioCalls()).toHaveLength(1))
    expect(action('Save changes').disabled).toBe(true)
    open()
    await waitFor(() => expect(box().value).toBe(AI))
    expect(action('Save changes').disabled).toBe(false)
    await user.click(action('Save changes'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(lastPut()?.bio).toBe(AI)
  })

  it('while a save is on its way the chip waits (one thing at a time — the form’s `busy`), never a dead tap', async () => {
    const user = mount('edit')
    const chip = await improve()
    expect((chip as HTMLButtonElement).disabled).toBe(false)
    const open = hold('PUT /api/teachers/me')
    await user.click(action('Save changes'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(((await improve()) as HTMLButtonElement).disabled).toBe(true)
    expect(bioCalls()).toHaveLength(0)
    open()
    expect(await screen.findByText('Profile saved')).toBeTruthy()
  })

  it('"Next step" while it runs lets it go — back on About, the text is the teacher’s own', async () => {
    const user = mount('edit')
    const open = hold()
    await user.click(await improve())
    await waitFor(() => expect(bioCalls()).toHaveLength(1))
    await user.click(action('Next step'))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'About you (optional)' })).toBeNull())
    expect(action('Save changes').disabled).toBe(false)
    open()
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    await user.click(rail('About you'))
    expect(await screen.findByRole('textbox', { name: 'About you (optional)' })).toBeTruthy()
    expect(box().value).toBe(OWN)
    expect(screen.queryByText(UNDO_LINE)).toBeNull()
  })
})
