// @vitest-environment jsdom
/**
 * THE SITUATION-FIRST JOIN FLOW (teacher onboarding redesign, 2026-10-08), whole-form, as a teacher walks it:
 *   · step 1 answers re-derive the rest — the rail counts 6 / 5 / 4 steps by persona, Online is asked once;
 *   · ⛔ the home places are pre-selected but count only once CONFIRMED (B6 — the `confirm` refusal);
 *   · teacher.eno.vn hands over steps 1–4 in a v2 `#d=` fragment that can carry no consent, cover or upload;
 *   · on eno.vn, signed out, "About you" ends in "Sign in", and a sign-in moves on by itself;
 *   · drafts restore cover OFF (periods and rate kept) and never an upload.
 * ⚠️ Harness notes (country-combobox.test.tsx's): heavy jsdom renders, so the house timeouts; StepWizard renders every
 * action twice (the phone's sticky bar first, the desktop inline twin after) — `[0]` is the bar's.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, getConfig, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { DRAFT_FIELDS } from './teacher-form-rules'
import { COMPLETE, b64url, fakeFetch, putDraft, storedDraft, stubBrowser, unb64url } from './teacher-form.fixtures'

const auth = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, openSignIn: vi.fn() }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/components/marketplace/push-opt-in-card', () => ({ PushOptInCard: () => null }))

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
/** The sticky bar's copy of an action (StepWizard renders it twice). */
const action = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const railCount = () => document.querySelectorAll('[data-slot="step-rail"] li').length
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('step 1 · Your plans', () => {
  it('HCMC full-time job seeker: the rail grows to 6 steps; the Where step pre-selects HCMC and refuses Next until confirmed', async () => {
    const { user } = mount()
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
    putDraft({ ...COMPLETE, teachAreasConfirmed: false }, 'where')
    const { user } = mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Online lessons' }))
    expect(screen.getByRole('checkbox', { name: 'These are the places I can teach' }).getAttribute('aria-checked')).toBe('true')
    await user.click(action('Next'))
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
  })

  it('Online is asked once: abroad + "Online only" skips Where (a 4-step rail); with Full-time too, Where shows Online locked', async () => {
    const { user } = mount()
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
    const { user } = mount()
    await user.click(screen.getByRole('radio', { name: 'Hanoi' }))
    expect(screen.getByText(/Only want cover lessons\? Leave this empty/)).toBeTruthy()
    await user.click(action('Next'))
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
  })

  it('…and is required where it is not (abroad), with no such hint', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('radio', { name: 'Not in Vietnam yet' }))
    expect(screen.queryByText(/Only want cover lessons/)).toBeNull()
    await user.click(action('Next'))
    expect(await screen.findByText('Please pick the work you are looking for.')).toBeTruthy()
  })

  it('⛔ “Prefer not to say” stays answered across a step change and a reload — storing nothing — and goes with a new home (gate review, 2026-10-08)', async () => {
    const district = () => screen.getByRole<HTMLInputElement>('combobox', { name: 'Which district do you live in? (optional)' })
    const { user } = mount()
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
  it('teacher.eno.vn: 4 steps + “Finish on eno.vn”; Continue checks steps 1–4 and hands over a v2 fragment with no consent', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign, hash: '', pathname: '/', search: '' })
    putDraft({ ...COMPLETE, phone: '+84901234567' }, 'about')
    const { user } = mount({ draftHost: true })
    expect(await screen.findByRole('textbox', { name: 'Full name' })).toBeTruthy()
    expect(railCount()).toBe(5)
    expect(screen.getByRole('img', { name: 'Finish on eno.vn' })).toBeTruthy()
    await user.click(action('Continue on eno.vn'))
    expect(assign).toHaveBeenCalledTimes(1)
    const url = String(assign.mock.calls[0][0])
    expect(url.startsWith('https://eno.vn/teachers/join#d=')).toBe(true)
    const payload = unb64url(url.split('#d=')[1]) as { v: number; t: Record<string, unknown> }
    expect(payload.v).toBe(2)
    // ⛔ Only the draft steps' fields cross: never a consent, the cover switch, a phone or an upload.
    expect(Object.keys(payload.t).sort()).toEqual([...DRAFT_FIELDS].sort())
    expect(payload.t.fullName).toBe('Jane Doe')
  })

  it('teacher.eno.vn refuses the hand-off while a draft step is unanswered, on that step', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign, hash: '', pathname: '/', search: '' })
    putDraft({ ...COMPLETE, nationality: '' }, 'about')
    const { user } = mount({ draftHost: true })
    expect(await screen.findByRole('textbox', { name: 'Full name' })).toBeTruthy()
    await user.click(action('Continue on eno.vn'))
    expect(assign).not.toHaveBeenCalled()
    expect(await screen.findByText('This is required.')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Nationality' })))
  })

  it('a restored draft never lands past its first unanswered step (a draft "on About" with no experience opens on step 3)', async () => {
    putDraft({ ...COMPLETE, experienceBand: null }, 'about')
    mount({ draftHost: true })
    expect(await screen.findByText('How long have you been teaching?')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Full name' })).toBeNull()
  })

  it('a v2 #d= arriving complete, signed out: About, the sign-in opens ONCE, the fragment is stripped — and a crafted consent never arrives', async () => {
    const crafted = { ...COMPLETE, coverOpen: true, coverConsent: true, coverSlots: ['mon-am'], coverRateVnd: 300_000, matchEmailOptIn: true, staffContactOptIn: true, photoUrl: 'https://evil/x.webp', phone: '+84911111111' }
    history.replaceState(null, '', `/teachers/join#d=${b64url({ v: 2, t: crafted })}`)
    const { rerender } = mount()
    expect(await screen.findByRole('textbox', { name: 'Full name' })).toBeTruthy()
    expect(window.location.hash).toBe('')
    await waitFor(() => expect(auth.openSignIn).toHaveBeenCalledTimes(1))
    const kept = storedDraft().t
    expect(kept).toMatchObject({ coverOpen: false, coverConsent: false, matchEmailOptIn: false, staffContactOptIn: false, photoUrl: null, phone: '' })
    expect(kept.coverSlots).toEqual([]) // a fragment carries no cover field at all
    // Once per arrival — even when the auth context hands the form a new opener (a re-render of the provider).
    const again = vi.fn()
    auth.openSignIn = again
    rerender()
    await new Promise((r) => setTimeout(r, 50))
    expect(again).not.toHaveBeenCalled()
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
    expect(kept).toMatchObject({ livesIn: null, teachAreas: ['online', 'ha-noi'], englishLevel: 'native', experienceBand: '3-5-years', coverOpen: false, coverConsent: false })
    expect(auth.openSignIn).not.toHaveBeenCalled()
  })
})

describe('eno.vn, the sign-in after “About you”', () => {
  it('signed out, About ends in “Sign in”; a code sign-in moves on by itself to Cover (HCMC)', async () => {
    const { fn } = fakeFetch({ 'GET /api/teachers/me': () => ({ json: { teacher: null, publishGate: { ok: true, code: null }, prefill: { displayName: null, avatarUrl: null, phone: null } } }) })
    vi.stubGlobal('fetch', fn)
    putDraft(COMPLETE, 'about')
    const { user, rerender } = mount()
    expect(await screen.findByRole('textbox', { name: 'Full name' })).toBeTruthy()
    await user.click(action('Sign in'))
    expect(auth.openSignIn).toHaveBeenCalledTimes(1)
    expect(storedDraft().step).toBe('cover') // a Google round trip lands there too
    auth.user = { id: 'u1' }
    rerender()
    expect(await screen.findByRole('switch', { name: 'Available for cover lessons' })).toBeTruthy()
  })

  it('a v4 draft restores cover OFF — periods and rate kept — and never an upload', async () => {
    const { fn } = fakeFetch({ 'GET /api/teachers/me': () => ({ json: { teacher: null, publishGate: { ok: true, code: null }, prefill: null } }) })
    vi.stubGlobal('fetch', fn)
    auth.user = { id: 'u1' }
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
