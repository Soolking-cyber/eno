// @vitest-environment jsdom
/**
 * THE SITUATION-FIRST JOIN FLOW (teacher onboarding redesign, 2026-10-08), whole-form, as a teacher walks it:
 *   · step 1 answers re-derive the rest — the rail counts 6 / 5 / 4 steps by persona, Online is asked once;
 *   · ⛔ the home places are pre-selected but count only once CONFIRMED (B6 — the `confirm` refusal);
 *   · teacher.eno.vn is step 1 only, then hands over in a v2 `#d=` fragment that can carry no consent, cover or upload;
 *   · on eno.vn, signed out, "Your plans" ends in "Sign in", and a sign-in moves on by itself (2026-10-11 — from then on
 *     every answer is saved to the account; teacher-form.draft.test.tsx);
 *   · drafts restore cover OFF (periods and rate kept) and never an upload.
 * ⚠️ Harness notes (country-combobox.test.tsx's): heavy jsdom renders, so the house timeouts; StepWizard renders every
 * action twice (the phone's sticky bar first, the desktop inline twin after) — `[0]` is the bar's.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, getConfig, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { DRAFT_FIELDS, HANDOFF_FIELDS, draftResumeStep, handoffPart } from './teacher-form-rules'
import type { TeacherInput } from '@/lib/teachers/profile'
import { COMPLETE, b64url, fakeFetch, putDraft, storedDraft, stubBrowser, unb64url } from './teacher-form.fixtures'

const auth = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, openSignIn: vi.fn() }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/components/marketplace/push-opt-in-card', () => ({ PushOptInCard: () => null }))
// The form's own funnel counts (signup-prompt.ts TEACHER_FORM_EVENTS), recorded rather than sent.
const funnel = vi.hoisted(() => [] as string[])
vi.mock('@/lib/signup-counters', async (orig) => ({ ...(await orig<typeof import('@/lib/signup-counters')>()), countTeacherFormEvent: (e: string) => { funnel.push(e) } }))

import { TeacherForm } from './teacher-form'

const asyncUtilTimeout = getConfig().asyncUtilTimeout
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 60_000 })
afterAll(() => { configure({ asyncUtilTimeout }); vi.resetConfig() })
beforeAll(() => { Element.prototype.scrollIntoView ??= function () {} })
beforeEach(() => {
  stubBrowser()
  auth.user = null
  auth.loading = false
  auth.openSignIn = vi.fn()
  history.replaceState(null, '', '/teachers/join')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mount(props: Partial<React.ComponentProps<typeof TeacherForm>> = {}) {
  const ui = () => (
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <main><TeacherForm mode="join" draftHost={false} apexOrigin="https://eno.vn" {...props} /></main>
    </LanguageProvider>
  )
  const r = render(ui())
  return { ...r, user: userEvent.setup(), rerender: () => r.rerender(ui()) }
}
/**
 * Signed in, with the account's saved draft (`draft`, none by default): every step after "Your plans" is a signed-in step
 * since 2026-10-11. The fake answers the profile, the draft and its saves.
 */
function signedIn(draft: unknown = null) {
  auth.user = { id: 'u1' }
  let rev = 0
  const f = fakeFetch({
    'GET /api/teachers/me': () => ({ json: { teacher: null, publishGate: { ok: true, code: null }, prefill: null } }),
    'GET /api/teachers/me/draft': () => ({ json: { draft } }),
    'PUT /api/teachers/me/draft': () => ({ json: { rev: ++rev, gen: '8b3c4d5e-6f7a-4b2c-8d3e-4f5a6b7c8d9e', updatedAt: '2026-10-11T10:00:00.000Z' } }),
  })
  vi.stubGlobal('fetch', f.fn)
  return f
}
/** The sticky bar's copy of an action (StepWizard renders it twice). */
const action = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const railCount = () => document.querySelectorAll('[data-slot="step-rail"] li').length
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('step 1 · Your plans', () => {
  it('HCMC full-time job seeker: the rail grows to 6 steps; the Where step pre-selects HCMC and refuses Next until confirmed', async () => {
    signedIn()
    const { user } = mount()
    // Signed in, the form waits for the account's saved draft (none here) before it can be edited.
    await screen.findByText('Where are you now?')
    expect(railCount()).toBe(5) // nothing answered yet: no cover step
    await user.click(screen.getByRole('radio', { name: 'Ho Chi Minh City' }))
    expect(railCount()).toBe(6) // the home has cover → the Cover step appears
    await user.click(screen.getByRole('button', { name: 'Full-time' }))
    await user.click(screen.getByRole('radio', { name: /No, only around Ho Chi Minh City/ }))
    await user.click(action('Next'))

    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    // The home is pre-selected — and is only a suggestion.
    expect(pressed('Ho Chi Minh City')).toBe('true')
    const confirm = screen.getByRole('checkbox', { name: 'These are the places I can teach' })
    expect(confirm.getAttribute('aria-checked')).toBe('false')
    await user.click(action('Next'))
    expect(await screen.findByText('Please confirm these are the places you can teach — or change them.')).toBeTruthy()
    expect(confirm.getAttribute('aria-invalid')).toBe('true')
    expect(screen.queryByText('What do you teach?')).toBeNull()

    await user.click(confirm)
    await user.click(action('Next'))
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
  })

  it('any edit of the list is a confirmation too (B6): adding Online lets the teacher on', async () => {
    signedIn()
    putDraft({ ...COMPLETE, teachAreasConfirmed: false }, 'where')
    const { user } = mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Online lessons' }))
    expect(screen.getByRole('checkbox', { name: 'These are the places I can teach' }).getAttribute('aria-checked')).toBe('true')
    await user.click(action('Next'))
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
  })

  it('Online is asked once: abroad + "Online only" skips Where (a 4-step rail); with Full-time too, Where shows Online locked', async () => {
    signedIn()
    const { user } = mount()
    // Signed in, the form waits for the account's saved draft (none here) before it can be edited.
    await screen.findByText('Where are you now?')
    await user.click(screen.getByRole('radio', { name: 'Not in Vietnam yet' }))
    await user.click(screen.getByRole('button', { name: 'Private students' }))
    await user.click(screen.getByRole('radio', { name: /Online only/ }))
    expect(railCount()).toBe(4)
    expect(screen.queryByRole('button', { name: 'Online lessons' })).toBeNull() // never on step 1

    await user.click(screen.getByRole('button', { name: 'Full-time' }))
    expect(railCount()).toBe(5)
    await user.click(action('Next'))
    const online = await screen.findByRole('button', { name: 'Online lessons' })
    expect(online.getAttribute('aria-pressed')).toBe('true')
    expect(online.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('You chose “Online only” in step 1.')).toBeTruthy()
  })

  it('a Gia Lai teacher (somewhere else) sees 5 steps; the province search finds “Quy Nhơn”; “Hội An” switches to the Da Nang chip', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('radio', { name: 'Somewhere else in Vietnam' }))
    const province = screen.getByRole('combobox', { name: 'Which province?' })
    await user.type(province, 'quy nhon')
    await user.click(await screen.findByRole('option', { name: /Quy Nhon/ }))
    expect((province as HTMLInputElement).value).toBe('Gia Lai')
    expect(railCount()).toBe(5) // Gia Lai has no cover city

    await user.clear(province)
    await user.type(province, 'hoi an')
    await user.click(await screen.findByRole('option', { name: /Hoi An/ }))
    expect(screen.getByRole('radio', { name: 'Da Nang' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('combobox', { name: 'Which province?' })).toBeNull()
  })

  it('the work question may stay empty where cover is offered — with the hint saying so', async () => {
    signedIn()
    const { user } = mount()
    // Signed in, the form waits for the account's saved draft (none here) before it can be edited.
    await screen.findByText('Where are you now?')
    await user.click(screen.getByRole('radio', { name: 'Hanoi' }))
    expect(screen.getByText(/Only want cover lessons\? Leave this empty/)).toBeTruthy()
    await user.click(action('Next'))
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
  })

  it('…and is required where it is not (abroad), with no such hint', async () => {
    signedIn()
    const { user } = mount()
    // Signed in, the form waits for the account's saved draft (none here) before it can be edited.
    await screen.findByText('Where are you now?')
    await user.click(screen.getByRole('radio', { name: 'Not in Vietnam yet' }))
    expect(screen.queryByText(/Only want cover lessons/)).toBeNull()
    await user.click(action('Next'))
    expect(await screen.findByText('Please pick the work you are looking for.')).toBeTruthy()
  })

  it('⛔ “Prefer not to say” stays answered across a step change and a reload — storing nothing — and goes with a new home (gate review, 2026-10-08)', async () => {
    const district = () => screen.getByRole<HTMLInputElement>('combobox', { name: 'Which district do you live in? (optional)' })
    signedIn()
    const { user } = mount()
    // Signed in, the form waits for the account's saved draft (none here) before it can be edited.
    await screen.findByText('Where are you now?')
    await user.click(screen.getByRole('radio', { name: 'Ho Chi Minh City' }))
    await user.click(district())
    await user.click(await screen.findByRole('option', { name: 'Prefer not to say' }))
    await waitFor(() => expect(district().value).toBe('Prefer not to say'))
    await user.click(screen.getByRole('button', { name: 'Full-time' }))
    await user.click(screen.getByRole('radio', { name: /No, only around Ho Chi Minh City/ }))
    await user.click(action('Next'))
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await user.click(action('Back'))
    // The step change remounted the field: the answer is the form's, so it is still there.
    await waitFor(() => expect(district().value).toBe('Prefer not to say'))
    // Nothing stored for it — the draft carries it BESIDE the answers.
    expect(storedDraft()).toMatchObject({ districtNotSaying: true, t: { currentDistrictKey: '' } })

    // A reload (and the Google round trip, which comes back the same way): this tab's draft brings it back.
    cleanup()
    const again = mount()
    await screen.findByText('Where are you now?')
    await waitFor(() => expect(district().value).toBe('Prefer not to say'))
    // A new home lets it go: back in HCMC, its district is a new question.
    await again.user.click(screen.getByRole('radio', { name: 'Hanoi' }))
    await again.user.click(screen.getByRole('radio', { name: 'Ho Chi Minh City' }))
    expect(district().value).toBe('')
    expect(storedDraft().districtNotSaying).toBeUndefined()
  })

  it('?goal=cover asks "Also looking for a job? (optional)"', async () => {
    const { user } = mount({ goal: 'cover' })
    await user.click(screen.getByRole('radio', { name: 'Hanoi' }))
    expect(screen.getByText('Also looking for a job? (optional)')).toBeTruthy()
  })
})

describe('teacher.eno.vn → eno.vn', () => {
  it('the hand-off keeps the campaign tags the visitor arrived with — source, medium, campaign; never the click id', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign, hash: '', pathname: '/', search: '?utm_content=reel_v3&utm_campaign=teacher_profiles&fbclid=IwAR0x&utm_medium=paid_social&utm_source=meta' })
    putDraft({ ...COMPLETE, phone: '+84901234567' }, 'about', 5, null) // written signed out (the host has no session)
    const { user } = mount({ draftHost: true })
    expect(await screen.findByText('Where are you now?')).toBeTruthy() // the host is "Your plans" only (2026-10-11)
    await user.click(action('Continue'))
    expect(assign).toHaveBeenCalledTimes(1)
    // The whole address, parsed: eno.vn's join page — exactly the three tags (no `start=self`: the start screen it
    // skipped is gone, 2026-10-16), and one `#d=` draft after them.
    const to = new URL(String(assign.mock.calls[0][0]))
    expect(to.origin + to.pathname).toBe('https://eno.vn/teachers/join')
    expect(to.search).toBe('?utm_source=meta&utm_medium=paid_social&utm_campaign=teacher_profiles')
    expect(to.hash.startsWith('#d=')).toBe(true)
    expect((unb64url(to.hash.slice(3)) as { v: number }).v).toBe(2)
  })
  it('a teacher who came for cover AND from a campaign keeps both across the hosts', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign, hash: '', pathname: '/', search: '?utm_source=meta&utm_campaign=cover' })
    putDraft(COMPLETE, 'plans', 5, null)
    const { user } = mount({ draftHost: true, goal: 'cover' })
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(action('Continue'))
    const to = new URL(String(assign.mock.calls[0][0]))
    expect(to.search).toBe('?goal=cover&utm_source=meta&utm_campaign=cover')
  })
  it('teacher.eno.vn: “Your plans” + “Finish on eno.vn”; Continue checks step 1 and hands over a v2 fragment with no consent', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign, hash: '', pathname: '/', search: '' })
    putDraft({ ...COMPLETE, phone: '+84901234567' }, 'about', 5, null) // written signed out (the host has no session)
    const { user } = mount({ draftHost: true })
    // ⛔ Sign-in comes after step 1 (2026-10-11): the host's whole half is "Your plans".
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Full name' })).toBeNull()
    expect(railCount()).toBe(2)
    expect(screen.getByRole('img', { name: 'Finish on eno.vn' })).toBeTruthy()
    expect(screen.getByText(/Next: sign in on eno.vn — it takes a few seconds, your answers come with you/)).toBeTruthy()
    await user.click(action('Continue'))
    expect(assign).toHaveBeenCalledTimes(1)
    const url = String(assign.mock.calls[0][0])
    expect(url.startsWith('https://eno.vn/teachers/join#d=')).toBe(true)
    const payload = unb64url(url.split('#d=')[1]) as { v: number; t: Record<string, unknown> }
    expect(payload.v).toBe(2)
    // ⛔ Only the fields of the step the host SHOWS cross (commit gate, round 10): never what the tab kept behind it — on a
    // shared tab, the previous visitor's name and bio — nor a consent, the cover switch, a phone or an upload.
    expect(Object.keys(payload.t).sort()).toEqual([...DRAFT_FIELDS].sort())
    for (const k of HANDOFF_FIELDS) expect(payload.t[k]).toEqual(COMPLETE[k])
    expect(payload.t.teachAreas).toEqual(COMPLETE.teachAreas) // step 1 writes them (an online-only teacher skips Where)
    expect(payload.t.fullName).toBe('')
    expect(payload.t.headline).toBe('')
  })

  it('a teacher who came for cover keeps that intent across the hosts (?goal=cover)', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign, hash: '', pathname: '/', search: '' })
    putDraft(COMPLETE, 'plans', 5, null)
    const { user } = mount({ draftHost: true, goal: 'cover' })
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(action('Continue'))
    expect(String(assign.mock.calls[0][0]).startsWith('https://eno.vn/teachers/join?goal=cover#d=')).toBe(true)
  })

  it('teacher.eno.vn refuses the hand-off while step 1 is unanswered, on it', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign, hash: '', pathname: '/', search: '' })
    putDraft({ ...COMPLETE, livesIn: 'abroad', currentCity: '', currentDistrictKey: '', jobTypes: [], relocate: '' }, 'plans', 5, null)
    const { user } = mount({ draftHost: true })
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(action('Continue'))
    expect(assign).not.toHaveBeenCalled()
    expect(await screen.findByText('Please pick the work you are looking for.')).toBeTruthy()
  })

  it('a restored draft never lands past its first unanswered step (a draft "on About" with no experience opens on step 3)', async () => {
    signedIn()
    putDraft({ ...COMPLETE, experienceBand: null }, 'about')
    mount()
    expect(await screen.findByText('How long have you been teaching?')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Full name' })).toBeNull()
  })

  it('a v2 #d= arriving complete, signed out: “Your plans”, the sign-in opens ONCE, the fragment is stripped — and a crafted consent never arrives', async () => {
    const crafted = { ...COMPLETE, coverOpen: true, coverConsent: true, coverSlots: ['mon-am'], coverRateVnd: 300_000, matchEmailOptIn: true, staffContactOptIn: true, photoUrl: 'https://evil/x.webp', phone: '+84911111111' }
    history.replaceState(null, '', `/teachers/join#d=${b64url({ v: 2, t: crafted })}`)
    const { rerender } = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(window.location.hash).toBe('')
    await waitFor(() => expect(auth.openSignIn).toHaveBeenCalledTimes(1))
    const kept = storedDraft().t
    expect(kept).toMatchObject({ coverOpen: false, coverConsent: false, matchEmailOptIn: false, staffContactOptIn: false, photoUrl: null, phone: '' })
    expect(kept.coverSlots).toEqual([]) // a fragment carries no cover field at all
    // ⛔ Read as step 1 (decodeHandoff): no name, no headline — an older tab's four steps or a crafted link bring none —
    // so the sign-in this form opens for it may adopt it.
    expect(kept.fullName).toBe('')
    expect(kept.headline).toBe('')
    expect(typeof storedDraft().signIn).toBe('number')
    // Once per arrival — even when the auth context hands the form a new opener (a re-render of the provider).
    const again = vi.fn()
    auth.openSignIn = again
    rerender()
    await new Promise((r) => setTimeout(r, 50))
    expect(again).not.toHaveBeenCalled()
  })

  it('a step-1-only fragment (what teacher.eno.vn sends now: choices, no words) IS adopted at the form\'s sign-in', async () => {
    // what encodeHandoff sends from a step-1-only host form: the draft steps' fields, the later ones still empty
    const step1 = { livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', jobTypes: ['fulltime'], relocate: 'no', teachAreas: [], teachAreasConfirmed: false }
    history.replaceState(null, '', `/teachers/join#d=${b64url({ v: 2, t: step1 })}`)
    mount()
    await waitFor(() => expect(auth.openSignIn).toHaveBeenCalledTimes(1))
    expect(typeof storedDraft().signIn).toBe('number')
    expect(window.location.search).toBe('?teacher_signin=1') // the return marker the OAuth `next` carries back
  })

  it('a v1 fragment from before the redesign is mapped at the boundary and opens where it first fails (Where are you now?)', async () => {
    const v1 = {
      fullName: 'Jane Doe', headline: 'CELTA-certified English teacher', nationality: 'GB', nativeSpeaker: true,
      currentCity: 'ha-noi', preferredCities: ['ha-noi'], openToOnline: true, jobTypes: ['fulltime'], subjects: ['general-english'],
      ageGroups: ['adults'], yearsExperience: 4, coverOpen: true, coverConsent: true, consentPublic: true,
    }
    history.replaceState(null, '', `/teachers/join#d=${b64url(v1)}`)
    mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    const kept = storedDraft().t
    // mapped at the boundary, then step 1 only (the teaching areas it implies) — never the name or answers behind it
    expect(kept).toMatchObject({ livesIn: null, teachAreas: ['online', 'ha-noi'], fullName: '', subjects: [], coverOpen: false, coverConsent: false })
    expect(auth.openSignIn).not.toHaveBeenCalled()
  })
})

describe('eno.vn, the sign-in after “Your plans” (2026-10-11)', () => {
  it('signed out, “Your plans” ends in “Sign in”; a code sign-in moves on by itself to the next unanswered step', async () => {
    const f = signedIn()
    auth.user = null
    putDraft(COMPLETE, 'about', 5, null) // written signed out: read as step 1
    const { user, rerender } = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(screen.getByText(/Next you sign in: your answers are kept, and saved to your account at every step/)).toBeTruthy()
    await user.click(action('Sign in'))
    expect(auth.openSignIn).toHaveBeenCalledTimes(1)
    const next = draftResumeStep(handoffPart(COMPLETE as TeacherInput), 'about').step
    expect(next).not.toBe('about')
    expect(storedDraft().step).toBe(next) // a Google round trip lands there too
    expect(typeof storedDraft().signIn).toBe('number')
    auth.user = { id: 'u1' }
    rerender()
    expect(await screen.findByRole('button', { name: 'Start over' })).toBeTruthy()
    // ⛔ The form opened that sign-in for these answers: they are the account's draft at once (the dashboard row) — step 1,
    // never a name from a copy written signed out (commit gate, opus round 14).
    await waitFor(() => expect(f.calls.some((c) => c.method === 'PUT' && c.url === '/api/teachers/me/draft')).toBe(true))
    const put = f.calls.find((c) => c.method === 'PUT' && c.url === '/api/teachers/me/draft')!.body as { t: Record<string, unknown>; rev: number }
    expect(put.rev).toBe(0)
    expect(put.t.fullName).toBe('')
    expect(put.t.livesIn).toBe(COMPLETE.livesIn)
  })

  it('⛔ a four-step link (an older teacher.eno.vn tab, or a crafted one) brings step 1 only — after sign-in, no name the teacher never typed here', async () => {
    signedIn()
    auth.user = null
    history.replaceState(null, '', `/teachers/join#d=${b64url({ v: 2, t: COMPLETE })}`)
    const { rerender } = mount()
    await waitFor(() => expect(auth.openSignIn).toHaveBeenCalledTimes(1))
    auth.user = { id: 'u1' }
    rerender()
    expect(await screen.findByRole('button', { name: 'Start over' })).toBeTruthy()
    expect(screen.queryByDisplayValue('Jane Doe')).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Available for cover lessons' })).toBeNull()
  })

  it('a v4 draft restores cover OFF — periods and rate kept — and never an upload', async () => {
    signedIn()
    putDraft({ ...COMPLETE, coverOpen: true, coverConsent: true, coverSlots: ['mon-am'], coverRateVnd: 300_000, photoUrl: 'https://sb.eno.vn/p.webp', videoUrl: 'https://sb.eno.vn/v.mp4' }, 'cover')
    const { user } = mount()
    const sw = await screen.findByRole('switch', { name: 'Available for cover lessons' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    await user.click(sw)
    expect(screen.getByRole('button', { name: 'Monday morning' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('textbox', { name: 'Hourly rate for a cover lesson' }) as HTMLInputElement).value).toBe('300,000')
    await user.click(action('Next'))
    const finish = await screen.findByText('Profile photo')
    expect(within(finish.closest('section')!).queryByRole('img')).toBeNull() // no photo restored
  })
})

describe('the form’s own funnel (signup-prompt.ts TEACHER_FORM_EVENTS — owner, 2026-10-16: "find out" why people bounce)', () => {
  it('teacher.eno.vn: "ready" once it works; the first answer; Continue stopped by a missing answer, then given', async () => {
    funnel.length = 0
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign, hash: '', pathname: '/', search: '' })
    const { user } = mount({ draftHost: true })
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await waitFor(() => expect(funnel).toContain('step1_ready'))
    expect(funnel).not.toContain('step1_answered')
    await user.click(action('Continue'))
    expect(funnel).toContain('step1_blocked')
    expect(funnel).not.toContain('step1_continue')
    await user.click(screen.getByRole('radio', { name: 'Not in Vietnam yet' }))
    expect(funnel).toContain('step1_answered')
    await user.click(screen.getByRole('button', { name: 'Full-time' }))
    await user.click(screen.getByRole('radio', { name: /^Anywhere/ }))
    await user.click(action('Continue'))
    expect(funnel).toContain('step1_continue')
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it('a restored draft is never counted as an answer', async () => {
    funnel.length = 0
    vi.stubGlobal('location', { ...window.location, assign: vi.fn(), hash: '', pathname: '/', search: '' })
    putDraft(COMPLETE, 'plans', 5, null)
    mount({ draftHost: true })
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await waitFor(() => expect(funnel).toContain('step1_ready'))
    expect(funnel).not.toContain('step1_answered')
  })

  it('⛔ a visitor arriving with teacher.eno.vn\'s answers is not counted again on eno.vn (one visitor, one step 1)', async () => {
    funnel.length = 0
    history.replaceState(null, '', `/teachers/join#d=${b64url({ v: 2, t: COMPLETE })}`)
    const { user } = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await waitFor(() => expect(auth.openSignIn).toHaveBeenCalledTimes(1))
    // The visitor closes the sign-in and presses the step's own "Sign in": still the same step 1, done over there.
    await user.click(action('Sign in'))
    expect(funnel.filter((e) => e.startsWith('step1_'))).toEqual([])
  })

  it('signed in on eno.vn: step 1\'s Next counts as its Continue', async () => {
    funnel.length = 0
    signedIn()
    const { user } = mount()
    await screen.findByText('Where are you now?')
    await user.click(action('Next'))
    expect(funnel).toContain('step1_blocked')
  })

  it('⛔ a later step counts once it is ON SCREEN for a new profile — not while /api/teachers/me is unread (review, 2026-10-17)', async () => {
    funnel.length = 0
    const f = signedIn()
    let answerMe = () => {}
    const meAnswered = new Promise<void>((r) => { answerMe = r })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).split('?')[0] === '/api/teachers/me' && (init?.method ?? 'GET') === 'GET') await meAnswered
      return f.fn(input, init)
    }))
    putDraft({ ...COMPLETE, teachAreasConfirmed: false }, 'where')
    mount()
    // The restored later step waits behind the spinner (it may be an existing profile's owner): nothing counted.
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByText('Where can you teach?')).toBeNull()
    expect(funnel.filter((e) => e.startsWith('step_'))).toEqual([])
    answerMe()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await waitFor(() => expect(funnel).toContain('step_where'))
  })
})

const FB_IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/519.0.0.38.104;FBBV/737400000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/5]'

describe('the way out of Meta\'s built-in browsers (owner, 2026-10-17 — and FIRST, in place of step 1, since 2026-10-22)', () => {
  it('⛔ in place of step 1 before any answer: one tap to the real browser — and never a wall', async () => {
    funnel.length = 0
    const { user } = mount({ escape: { host: 'facebook', os: 'android' } })
    expect(await screen.findByTestId('escape-first')).toBeTruthy()
    expect(screen.queryByText('Where are you now?')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Create your teacher profile in your browser' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open in your browser' })).toBeTruthy()
    await waitFor(() => expect(funnel).toContain('escape_shown'))
    // step1_ready counts step 1 itself on screen — never behind the way out (review, 2026-10-22).
    expect(funnel).not.toContain('step1_ready')
    await user.click(screen.getByRole('button', { name: 'Continue in Facebook' }))
    expect(funnel).toContain('escape_stay')
    await waitFor(() => expect(funnel).toContain('step1_ready'))
    // Step 1 in the app, the compact offer still above it — gone with the first answer (the bare address carries none).
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    // The tapped button unmounted: step 1's heading holds the focus, never <body>.
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Create your teacher profile'))
    expect(screen.getByTestId('open-in-browser')).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Ho Chi Minh City' }))
    expect(screen.queryByTestId('open-in-browser')).toBeNull()
    expect(screen.queryByTestId('escape-first')).toBeNull()
  })

  it('iOS Facebook: "Open in Safari", with the app\'s own question said up front', async () => {
    mount({ escape: { host: 'facebook', os: 'ios' } })
    expect(await screen.findByRole('button', { name: 'Open in Safari' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Create your teacher profile in Safari' })).toBeTruthy()
    expect(screen.getByText('If your phone asks “Open in Safari?”, tap Open.')).toBeTruthy()
    expect(screen.queryByTestId('escape-pointer')).toBeNull()
  })

  it('⛔ a tap that hid the page and opened nothing: back in front, the way by hand shows (review, 2026-10-22)', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(FB_IOS_UA)
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    let state: DocumentVisibilityState = 'visible'
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state)
    try {
      const { user } = mount({ escape: { host: 'facebook', os: 'ios' } })
      await user.click(await screen.findByRole('button', { name: 'Open in Safari' }))
      // The test page is http://localhost (production's https:// becomes x-safari-https://): the mark rides along either way.
      expect(open).toHaveBeenCalledWith(expect.stringMatching(/[?&]iab=facebook(&|$)/), '_blank')
      state = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      await new Promise((r) => setTimeout(r, 4200))
      expect(screen.queryByTestId('escape-pointer')).toBeNull() // the timer saw a hidden page and stayed quiet
      state = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
      expect(await screen.findByTestId('escape-pointer')).toBeTruthy()
      expect(screen.getByText('Still here? Tap ⋯ at the top right, then “Open in browser”.')).toBeTruthy()
    } finally {
      vis.mockRestore(); open.mockRestore(); ua.mockRestore()
    }
  })

  it('…but a return MINUTES later (they finished in the browser, then opened the app again) says nothing', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(FB_IOS_UA)
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    let state: DocumentVisibilityState = 'visible'
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state)
    const t0 = Date.now()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => t0)
    try {
      const { user } = mount({ escape: { host: 'facebook', os: 'ios' } })
      await user.click(await screen.findByRole('button', { name: 'Open in Safari' }))
      state = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      await new Promise((r) => setTimeout(r, 4200))
      clock.mockImplementation(() => t0 + 5 * 60_000)
      state = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
      await new Promise((r) => setTimeout(r, 100))
      expect(screen.queryByTestId('escape-pointer')).toBeNull()
      expect(screen.queryByText('Still here? Tap ⋯ at the top right, then “Open in browser”.')).toBeNull()
    } finally {
      clock.mockRestore(); vis.mockRestore(); open.mockRestore(); ua.mockRestore()
    }
  })

  it('the app kept the link and came back here WITH the mark: the way by hand at once, the mark off the address', async () => {
    funnel.length = 0
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(FB_IOS_UA)
    try {
      history.replaceState(null, '', '/teachers/join?utm_source=meta&iab=facebook')
      mount({ escape: { host: 'facebook', os: 'ios' } })
      expect(await screen.findByText('Still here? Tap ⋯ at the top right, then “Open in browser”.')).toBeTruthy()
      expect(screen.getByTestId('escape-pointer')).toBeTruthy()
      // The app's own question is still said beside it (round 4 — never replaced by a claim it did not open).
      expect(screen.getByText('If your phone asks “Open in Safari?”, tap Open.')).toBeTruthy()
      expect(location.search).toBe('?utm_source=meta')
      expect(funnel).not.toContain('escape_arrived')
    } finally {
      ua.mockRestore()
    }
  })

  it('the real browser\'s end: an address with the mark counts the arrival once and loses the mark', async () => {
    funnel.length = 0
    history.replaceState(null, '', '/teachers/join?utm_source=meta&iab=instagram')
    const { rerender } = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await waitFor(() => expect(funnel).toContain('escape_arrived'))
    expect(location.search).toBe('?utm_source=meta')
    expect(screen.queryByTestId('escape-first')).toBeNull()
    rerender()
    expect(funnel.filter((e) => e === 'escape_arrived')).toHaveLength(1)
  })

  it('…once per TAB: a reload that still carries the mark (replaceState refused) counts no second arrival', async () => {
    funnel.length = 0
    const replace = vi.spyOn(history, 'replaceState')
    history.replaceState(null, '', '/teachers/join?iab=facebook')
    replace.mockImplementation(() => { throw new Error('refused') })
    try {
      mount()
      expect(await screen.findByText('Where are you now?')).toBeTruthy()
      await waitFor(() => expect(funnel).toContain('escape_arrived'))
      expect(location.search).toBe('?iab=facebook') // the mark stayed
      cleanup()
      funnel.length = 0
      mount() // the reload, same tab (same sessionStorage)
      expect(await screen.findByText('Where are you now?')).toBeTruthy()
      await new Promise((r) => setTimeout(r, 100))
      expect(funnel).not.toContain('escape_arrived')
    } finally {
      replace.mockRestore()
    }
  })

  it('a mark that is not ours counts nothing and stays where it is', async () => {
    funnel.length = 0
    history.replaceState(null, '', '/teachers/join?iab=zalo')
    mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(funnel).not.toContain('escape_arrived')
    expect(location.search).toBe('?iab=zalo')
  })

  it('never on a later step', async () => {
    signedIn()
    putDraft({ ...COMPLETE, teachAreasConfirmed: false }, 'where')
    mount({ escape: { host: 'facebook', os: 'ios' } })
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    expect(screen.queryByTestId('open-in-browser')).toBeNull()
    expect(screen.queryByTestId('escape-first')).toBeNull()
  })
})

describe('a session still being read (gate review, 2026-10-16 — the start screen used to hold this)', () => {
  it('⛔ waits: never the signed-out step 1 ("Sign in") for a request that came with a session cookie', async () => {
    auth.loading = true
    mount({ start: { importIntent: null, sessionHint: true, cvImport: false, campaign: '' } })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Where are you now?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
  })
  it('…and a signed-in account waits for /api/teachers/me (it may already have a profile)', async () => {
    let answer: (v: unknown) => void = () => {}
    auth.user = { id: 'u1' }
    vi.stubGlobal('fetch', vi.fn((u: string) => (String(u).startsWith('/api/teachers/me/draft')
      ? Promise.resolve(new Response(JSON.stringify({ draft: null }), { status: 200 }))
      : new Promise((r) => { answer = r }))))
    mount()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Where are you now?')).toBeNull()
    answer(new Response(JSON.stringify({ teacher: null, publishGate: { ok: true, code: null }, prefill: null }), { status: 200 }))
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
  })
  it('teacher.eno.vn never waits (it has no session): step 1 at once', async () => {
    auth.loading = true
    mount({ draftHost: true, start: { importIntent: null, sessionHint: true, cvImport: false, campaign: '' } })
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
  })
})
