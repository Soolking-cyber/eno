// @vitest-environment jsdom
/**
 * /teachers/edit in the situation-first flow (teacher onboarding redesign, 2026-10-08): the same steps, a rail that
 * jumps both ways, Save changes on every step, a warning before a change drops saved answers, and ⛔ every consent
 * given under an OLDER notice loading OFF (plan review D5) — switching it on again is the fresh consent.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, getConfig, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { AI_NOTICE_VERSION, PUBLISH_NOTICE_VERSION } from '@/lib/teachers/profile'
import { COVER_CONSENT_VERSION, coverStamp } from '@/lib/teachers/cover'
import { COMPLETE, DRAFT_KEY, fakeFetch, putDraft, stubBrowser, type Call } from './teacher-form.fixtures'

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as null | { id: string }, loading: false, openSignIn: vi.fn() }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/components/marketplace/push-opt-in-card', () => ({ PushOptInCard: () => null }))

import { TeacherForm } from './teacher-form'

const asyncUtilTimeout = getConfig().asyncUtilTimeout
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 60_000 })
afterAll(() => { configure({ asyncUtilTimeout }); vi.resetConfig() })
beforeAll(() => { Element.prototype.scrollIntoView ??= function () {} })

const PHOTO = 'https://sb.eno.vn/storage/v1/object/public/listings/me.webp'
/** The saved profile as GET /api/teachers/me returns it (the TeacherProfile row + the owner-only extras). */
const ROW = {
  id: 'tp1', profileId: 'u1', listingId: 'L1', status: 'live', listingLive: true, situationVersion: 1,
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', currentProvince: null, currentDistrict: 'Quận 7 (Phú Mỹ Hưng)',
  teachAreas: ['d4', 'd7'], teachAreasConfirmedAt: '2026-10-08T00:00:00.000Z', preferredCities: ['ho-chi-minh-city'],
  jobTypes: ['fulltime'], expectedSalaryM: 30, availableFrom: '2026-11-01T00:00:00.000Z',
  subjects: ['general-english'], teachLanguages: [], ageGroups: ['adults'], experienceBand: '3-5-years', yearsExperience: 3, experience: [],
  degreeLevel: null, degreeMajor: null, degreeInstitution: null, degreeYear: null, certificates: [],
  fullName: 'Jane Doe', nationality: 'GB', englishLevel: 'native', nativeSpeaker: true, languages: [], headline: 'CELTA English teacher, five years', bio: '',
  coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null, coverConsentVersion: null, coverConsentAt: null, coverConfirmedAt: null,
  photoUrl: PHOTO, videoUrl: null, videoOnRequest: false, videoVersion: 0, hasPrivateVideo: false, cvFileName: null, phone: '',
  matchEmailOptIn: false, matchEmailNoticeVersion: null, staffContactOptIn: false, staffContactNoticeVersion: null,
  consentPublicVersion: PUBLISH_NOTICE_VERSION,
}
const COVER_ON = { coverOpen: true, coverSlots: ['mon-eve'], coverAreas: ['d4', 'd7'], coverRateVnd: 300_000, coverConsentVersion: COVER_CONSENT_VERSION, coverConfirmedAt: '2026-10-08' }

let calls: Call[] = []
let row: Record<string, unknown> | null = ROW
beforeEach(() => {
  stubBrowser()
  auth.user = { id: 'u1' }
  row = ROW
  history.replaceState(null, '', '/teachers/edit')
  const f = fakeFetch({
    'GET /api/teachers/me': () => ({ json: { teacher: row, publishGate: { ok: true, code: null } } }),
    'PUT /api/teachers/me': () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: { onRequest: false, version: 0, hasPrivate: false, url: null } } }),
    'PATCH /api/teachers/me/status': () => ({ json: { ok: true } }),
  })
  calls = f.calls
  vi.stubGlobal('fetch', f.fn)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mount(mode: 'edit' | 'join' = 'edit') {
  render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <main><TeacherForm mode={mode} draftHost={false} apexOrigin="https://eno.vn" /></main>
    </LanguageProvider>,
  )
  return userEvent.setup()
}
const action = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const rail = (name: string) => within(document.querySelector('[data-slot="step-rail"]') as HTMLElement).getByRole('button', { name })
const lastPut = () => calls.filter((c) => c.method === 'PUT').at(-1)?.body as Record<string, unknown> | undefined

describe('editing a saved profile', () => {
  it('the rail jumps FORWARD and back, and "Save changes" is on every step', async () => {
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(action('Save changes')).toBeTruthy()
    await user.click(rail('About you'))
    expect(await screen.findByRole('textbox', { name: 'Full name' })).toBeTruthy()
    expect(action('Save changes')).toBeTruthy()
    await user.click(rail('Your plans'))
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
  })

  it('saving from step 1 sends the whole profile with the bases it loaded and the publish notice', async () => {
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(action('Save changes'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(lastPut()).toMatchObject({
      teacherProfileId: 'tp1', videoBase: 0, publishNotice: PUBLISH_NOTICE_VERSION,
      coverBase: coverStamp({ coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null }),
      teachAreas: ['d4', 'd7'], teachAreasConfirmed: true, expectedSalaryM: 30, availableFrom: '2026-11-01',
    })
    expect(await screen.findByText('Profile saved')).toBeTruthy()
  })

  it('removing Full-time WARNS before the salary and start month go — "Keep my answers" keeps them', async () => {
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    const fulltime = screen.getByRole('button', { name: 'Full-time' })
    await user.click(fulltime)
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('your expected salary')).toBeTruthy()
    expect(within(dialog).getByText('your start month')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Keep my answers' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('button', { name: 'Full-time' }).getAttribute('aria-pressed')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'Full-time' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Change it' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Full-time' }).getAttribute('aria-pressed')).toBe('false'))
  })

  it('moving abroad warns that cover switches off and the home places go', async () => {
    row = { ...ROW, ...COVER_ON }
    const user = mount()
    await user.click(await screen.findByRole('radio', { name: 'Not in Vietnam yet' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('cover lessons (they switch off)')).toBeTruthy()
    expect(within(dialog).getByText(/District 4 · District 7/)).toBeTruthy()
  })

  it('⛔ no work wanted and cover off: the edit SAVES (the server hides it) — never refused for want of a goal (D6)', async () => {
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: { teacher: { ...ROW, expectedSalaryM: null, availableFrom: null }, publishGate: { ok: true, code: null } } }),
      'PUT /api/teachers/me': () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: false, noGoal: true, cover: null, video: { onRequest: false, version: 0, hasPrivate: false, url: null } } }),
    })
    vi.stubGlobal('fetch', f.fn)
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Full-time' }))
    expect(screen.queryByRole('alertdialog')).toBeNull() // nothing saved hangs on it here
    await user.click(rail('Cover lessons'))
    expect(await screen.findByText(/saving hides your profile/)).toBeTruthy()
    await user.click(action('Save changes'))
    // Asked first (gate review, 2026-10-08) — then saved and hidden: the goal rule never refuses an edit.
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/No work is chosen in step 1 and cover lessons are off/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Save and hide' }))
    await waitFor(() => expect(f.calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(await screen.findByText(/Your profile is now hidden/)).toBeTruthy()
  })

  it('clearing the district ("Prefer not to say") is the teacher’s own answer — no warning', async () => {
    const user = mount()
    const district = await screen.findByRole('combobox', { name: 'Which district do you live in? (optional)' })
    await user.click(district)
    await user.click(await screen.findByRole('option', { name: 'Prefer not to say' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect((district as HTMLInputElement).value).toBe('Prefer not to say'))
  })

  it('a change that drops nothing saved asks nothing (adding Part-time)', async () => {
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Part-time' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Part-time' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('⛔ a save that would HIDE a shown profile is asked first (gate review, 2026-10-08)', () => {
  // A cover-only teacher (no work wanted) whose cover was switched on under the previous cover notice.
  const COVER_ONLY_OLD = { ...ROW, ...COVER_ON, coverConsentVersion: '2026-10-07', jobTypes: [], expectedSalaryM: null, availableFrom: null }

  it('in on ?step=about to fix a typo: the step says cover loaded off, and Save asks before hiding — never a silent hide', async () => {
    row = COVER_ONLY_OLD
    history.replaceState(null, '', '/teachers/edit?step=about')
    const user = mount()
    expect(await screen.findByRole('textbox', { name: 'Full name' })).toBeTruthy()
    // Said on THIS step — it sat on step 1 alone.
    expect(screen.getByText(/Cover lessons: the notice changed/)).toBeTruthy()
    await user.click(action('Save changes'))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/The cover-lessons notice has changed/)).toBeTruthy()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('"Go to cover lessons" opens the switch — the teacher’s own act — and "Save and hide" still saves (D6)', async () => {
    row = COVER_ONLY_OLD
    history.replaceState(null, '', '/teachers/edit?step=about')
    const user = mount()
    expect(await screen.findByRole('textbox', { name: 'Full name' })).toBeTruthy()
    await user.click(action('Save changes'))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Go to cover lessons' }))
    expect((await screen.findByRole('switch', { name: 'Available for cover lessons' })).getAttribute('aria-checked')).toBe('false')
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    await user.click(action('Save changes'))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Save and hide' }))
    await waitFor(() => expect(lastPut()).toMatchObject({ coverOpen: false, jobTypes: [], publishNotice: PUBLISH_NOTICE_VERSION }))
  })

  it('a profile the teacher already hid saves with no question — its visibility does not change', async () => {
    row = { ...ROW, status: 'hidden', jobTypes: [], expectedSalaryM: null, availableFrom: null }
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(action('Save changes'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('an old opt-in’s line is on every step too — not only step 1', async () => {
    row = { ...ROW, matchEmailOptIn: true, matchEmailNoticeVersion: null }
    history.replaceState(null, '', '/teachers/edit?step=teaching')
    mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    expect(screen.getByText(/Job matches: the notice changed/)).toBeTruthy()
  })
})

describe('⛔ "saved" is not "shown": a hidden profile says so, with the way back right there (gate review, 2026-10-09)', () => {
  // A save never shows a hidden profile (an edit never publishes); the Visibility switch's call is the one way back.
  const savedHidden = (noGoal = false) => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: false, noGoal, cover: null, video: { onRequest: false, version: 0, hasPrivate: false, url: null } } })
  const NO_GOAL = { status: 'hidden', jobTypes: [], expectedSalaryM: null, availableFrom: null }

  it('a save over a profile the teacher hid: "hidden", never "Schools can now find you" — and "Show my profile to schools" shows it', async () => {
    row = { ...ROW, status: 'hidden' }
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: { teacher: row, publishGate: { ok: true, code: null } } }),
      'PUT /api/teachers/me': () => savedHidden(),
      'PATCH /api/teachers/me/status': () => ({ json: { ok: true, status: 'live' } }),
    })
    vi.stubGlobal('fetch', f.fn)
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(action('Save changes'))
    expect(await screen.findByText('Your profile is hidden: schools can’t find it or open it.')).toBeTruthy()
    expect(screen.queryByText(/Schools can now find you/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show my profile to schools' }))
    await waitFor(() => expect(f.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'live' }))
    expect(await screen.findByText(/Schools can now find you/)).toBeTruthy()
    expect(screen.queryByText(/Your profile is hidden/)).toBeNull()
  })

  it('a save that HID it (no work, cover off — D6): the goal first, saved, THEN show — and no Show button that can only be refused', async () => {
    row = { ...ROW, ...NO_GOAL }
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: { teacher: row, publishGate: { ok: true, code: null } } }),
      'PUT /api/teachers/me': () => savedHidden(true),
    })
    vi.stubGlobal('fetch', f.fn)
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(action('Save changes'))
    expect(await screen.findByText(/To show it again, pick the work you want or switch cover lessons on and save — then tap “Show my profile to schools”/)).toBeTruthy()
    expect(screen.queryByText(/Schools can now find you/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show my profile to schools' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Pick the work you want' }))
    expect(await screen.findByRole('button', { name: 'Full-time' })).toBeTruthy() // step 1, where the work is picked
  })

  it('switch ON but the listing held (moderation, an identity hold): said — never a Show button no tap of theirs can make work', async () => {
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: { teacher: { ...ROW, listingLive: false }, publishGate: { ok: true, code: null } } }),
      'PUT /api/teachers/me': () => savedHidden(),
    })
    vi.stubGlobal('fetch', f.fn)
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(action('Save changes'))
    expect(await screen.findByText(/Your profile is under review and not visible right now/)).toBeTruthy()
    expect(screen.queryByText(/Schools can now find you/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show my profile to schools' })).toBeNull()
  })

  it('⛔ the Visibility switch over a profile with nothing to be found for: refused (409 no_teaching_goal), and the line says what comes first', async () => {
    row = { ...ROW, ...NO_GOAL }
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: { teacher: row, publishGate: { ok: true, code: null } } }),
      'PATCH /api/teachers/me/status': () => ({ status: 409, json: { error: 'no_teaching_goal' } }),
    })
    vi.stubGlobal('fetch', f.fn)
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Photo & publish' }))
    const vis = await screen.findByRole('switch', { name: 'Show my profile to schools' })
    expect(vis.getAttribute('aria-checked')).toBe('false')
    await user.click(vis)
    expect(await screen.findByText('Pick the work you want, or switch cover lessons on, and save first.')).toBeTruthy()
    expect(f.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'live' })
    expect(screen.getByRole('switch', { name: 'Show my profile to schools' }).getAttribute('aria-checked')).toBe('false')
  })

  it('the warnings before a hiding save never promise "any time" — showing it again needs the goal first', async () => {
    row = { ...ROW, jobTypes: [], expectedSalaryM: null, availableFrom: null } // shown, no work wanted, cover off
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(rail('Cover lessons'))
    const stepLine = await screen.findByText(/saving hides your profile/)
    expect(stepLine.textContent).toMatch(/To show it again later, pick the work you want or switch cover lessons on first\.$/)
    expect(stepLine.textContent).not.toMatch(/any time/)
    await user.click(action('Save changes'))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/To show your profile again later, pick the work you want or switch cover lessons on first\./)).toBeTruthy()
    expect(dialog.textContent).not.toMatch(/any time/)
  })

  it('"Still available" over a hidden profile: the card says schools can’t see it — never just "Saved." — and shows it from there', async () => {
    row = { ...ROW, ...COVER_ON, status: 'hidden' }
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: { teacher: row, publishGate: { ok: true, code: null } } }),
      'PATCH /api/teachers/me/cover': () => ({ json: { ok: true, coverOpen: true, confirmedAt: '2026-10-09', coverSlots: ['mon-eve'], coverAreas: ['d4', 'd7'], coverRateVnd: 300_000, hidden: false, live: false } }),
      'PATCH /api/teachers/me/status': () => ({ json: { ok: true, status: 'live' } }),
    })
    vi.stubGlobal('fetch', f.fn)
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /Still available/ }))
    expect(await screen.findByText('Your profile is hidden, so schools can’t see your cover lessons.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Show my profile to schools' }))
    await waitFor(() => expect(f.calls.find((c) => c.url === '/api/teachers/me/status')?.body).toEqual({ status: 'live' }))
    await waitFor(() => expect(screen.queryByText(/Your profile is hidden/)).toBeNull())
    expect(screen.getByText('Saved.')).toBeTruthy()
  })
})

describe('⛔ consents given under an older notice load OFF (plan review D5)', () => {
  it('an opt-in from the Gemini-era notice loads OFF, and the step says why; one under today’s notice loads ON', async () => {
    row = { ...ROW, matchEmailOptIn: true, matchEmailNoticeVersion: null, staffContactOptIn: true, staffContactNoticeVersion: AI_NOTICE_VERSION }
    const user = mount()
    expect(await screen.findByText(/Job matches: the notice changed/)).toBeTruthy()
    await user.click(rail('Photo & publish'))
    expect((await screen.findByRole('switch', { name: 'Email me jobs that match my profile' })).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'Our staff may call me' }).getAttribute('aria-checked')).toBe('true')
  })

  it('both opt-ins old: the Photo & publish step asks for a fresh switch-on, and a save sends them OFF (withdrawn), with no aiNotice', async () => {
    row = { ...ROW, matchEmailOptIn: true, matchEmailNoticeVersion: null }
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Photo & publish' }))
    expect(await screen.findByText(/The job-matching notice below has changed/)).toBeTruthy()
    await user.click(action('Save changes'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(lastPut()).toMatchObject({ matchEmailOptIn: false })
    expect('aiNotice' in lastPut()!).toBe(false)
  })

  it('cover switched on under an older notice loads OFF; "Still available" asks to switch it on again instead', async () => {
    row = { ...ROW, ...COVER_ON, coverConsentVersion: '2026-10-07' }
    const user = mount()
    expect(await screen.findByText(/Cover lessons: the notice changed/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Still available/ }))
    expect(await screen.findByText(/The cover-lessons notice was updated/)).toBeTruthy()
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
    await user.click(rail('Cover lessons'))
    expect((await screen.findByRole('switch', { name: 'Available for cover lessons' })).getAttribute('aria-checked')).toBe('false')
  })

  it('cover under today’s notice loads ON, and "Still available" re-sends the saved values — never cover areas', async () => {
    row = { ...ROW, ...COVER_ON }
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: { teacher: row, publishGate: { ok: true, code: null } } }),
      'PATCH /api/teachers/me/cover': () => ({ json: { ok: true, coverOpen: true, confirmedAt: '2026-10-09', coverSlots: ['mon-eve'], coverAreas: ['d4', 'd7'], coverRateVnd: 300_000, hidden: false } }),
    })
    vi.stubGlobal('fetch', f.fn)
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /Still available/ }))
    await waitFor(() => expect(f.calls.some((c) => c.method === 'PATCH')).toBe(true))
    const body = f.calls.find((c) => c.method === 'PATCH')!.body as Record<string, unknown>
    expect(body).toMatchObject({ coverOpen: true, coverSlots: ['mon-eve'], coverRateVnd: 300_000, coverConsent: true, coverNotice: COVER_CONSENT_VERSION })
    expect('coverAreas' in body).toBe(false)
  })
})

describe('the edit page’s other doors', () => {
  it('no profile: "You don’t have a teacher profile yet" and Create — never an empty edit form', async () => {
    row = null
    mount()
    expect(await screen.findByText('You don’t have a teacher profile yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create my teacher profile' }).getAttribute('href')).toBe('/teachers/join')
  })

  it('a ?step= deep link opens that step', async () => {
    history.replaceState(null, '', '/teachers/edit?step=finish')
    mount()
    expect(await screen.findByText('Profile photo')).toBeTruthy()
  })

  it('⛔ a new CV picked over the saved one can be let go — “Keep my saved CV” — and nothing is uploaded (gate review, 2026-10-08)', async () => {
    row = { ...ROW, cvFileName: 'old-cv.pdf' }
    history.replaceState(null, '', '/teachers/edit?step=finish')
    const user = mount()
    const cv = within((await screen.findByText('CV (optional)')).closest('section')!)
    expect(cv.getByText('old-cv.pdf')).toBeTruthy()
    await user.upload(document.querySelector<HTMLInputElement>('input[accept="application/pdf,.pdf"]')!, new File(['%PDF-1.4'], 'new-cv.pdf', { type: 'application/pdf' }))
    expect(cv.getByText('new-cv.pdf')).toBeTruthy()
    // The saved CV's own Remove waits while a pick is pending (it would delete the SAVED one).
    expect(cv.queryByRole('button', { name: 'Remove' })).toBeNull()
    await user.click(cv.getByRole('button', { name: 'Keep my saved CV' }))
    expect(cv.getByText('old-cv.pdf')).toBeTruthy()
    expect(cv.getByRole('button', { name: 'Remove' })).toBeTruthy()
    await user.click(action('Save changes'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(calls.some((c) => c.url.startsWith('/api/teachers/me/cv'))).toBe(false)
  })

  it('?review=draft fills the hand-off’s answers over the saved profile, UNSAVED, and lets the draft go', async () => {
    putDraft({ ...COMPLETE, headline: 'IELTS teacher who loves phonics' }, 'about')
    history.replaceState(null, '', '/teachers/edit?review=draft')
    const user = mount()
    expect(await screen.findByText(/Your new answers are filled in below and are not saved yet/)).toBeTruthy()
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(window.location.search).toBe('')
    await user.click(rail('About you'))
    expect((await screen.findByRole('textbox', { name: 'Headline' }) as HTMLInputElement).value).toBe('IELTS teacher who loves phonics')
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('a reviewed hand-off that would clear saved answers says so up front (moving abroad: cover goes)', async () => {
    row = { ...ROW, ...COVER_ON }
    putDraft({ ...COMPLETE, livesIn: 'abroad', currentCity: '', currentDistrictKey: '', jobTypes: ['private'], relocate: 'online-only', teachAreas: ['online'] }, 'about')
    history.replaceState(null, '', '/teachers/edit?review=draft')
    mount()
    expect(await screen.findByText(/Saving them also clears:/)).toBeTruthy()
    expect(screen.getByText(/cover lessons \(they switch off\)/)).toBeTruthy()
  })

  it('the visibility switch has a visible label and saves at once', async () => {
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Photo & publish' }))
    const vis = await screen.findByRole('switch', { name: 'Show my profile to schools' })
    expect(screen.getByText('Show my profile to schools')).toBeTruthy()
    await user.click(vis)
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'hidden' }))
  })

  it('/join for an account that already has a profile, with answers just made: review them in the profile, or keep it', async () => {
    putDraft(COMPLETE, 'about')
    mount('join')
    expect(await screen.findByText('You already have a teacher profile')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Review these answers in my profile' }).getAttribute('href')).toBe('/teachers/edit?review=draft')
    expect(screen.getByRole('button', { name: 'Keep my profile' })).toBeTruthy()
  })
})
