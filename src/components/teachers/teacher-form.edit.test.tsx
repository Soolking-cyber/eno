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
import { AI_NOTICE_VERSION, IDENTITY_MARK_NOTICE_VERSION, PUBLISH_NOTICE_VERSION } from '@/lib/teachers/profile'
import { COVER_CONSENT_VERSION, coverStamp } from '@/lib/teachers/cover'
import { COMPLETE, DRAFT_KEY, fakeFetch, putDraft, stubBrowser, type Call } from './teacher-form.fixtures'

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as null | { id: string }, loading: false, openSignIn: vi.fn() }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
// App Store gate `ios-hide-kyc` — off (the web) unless a test turns it on.
const ios = vi.hoisted(() => ({ on: false }))
vi.mock('@/hooks/use-ios-hide-kyc', () => ({ useIosHideKyc: () => ios.on }))
vi.mock('@/components/marketplace/push-opt-in-card', () => ({ PushOptInCard: () => null }))

import { TeacherForm } from './teacher-form'

const asyncUtilTimeout = getConfig().asyncUtilTimeout
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 60_000 })
afterAll(() => { configure({ asyncUtilTimeout }); vi.resetConfig() })
beforeAll(() => { Element.prototype.scrollIntoView ??= function () {} })

const PHOTO = 'https://sb.eno.vn/storage/v1/object/public/listings/me.webp'
/**
 * The saved profile as GET /api/teachers/me returns it (the TeacherProfile row + the owner-only extras). With a phone: it
 * is required on every save since 2026-10-22 (owner: "phone number is mandatory") — a profile without one is ROW_NO_PHONE.
 */
const ROW = {
  id: 'tp1', profileId: 'u1', listingId: 'L1', status: 'live', listingLive: true, situationVersion: 1,
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', currentProvince: null, currentDistrict: 'Quận 7 (Phú Mỹ Hưng)',
  teachAreas: ['d4', 'd7'], teachAreasConfirmedAt: '2026-10-08T00:00:00.000Z', preferredCities: ['ho-chi-minh-city'],
  jobTypes: ['fulltime'], expectedSalaryM: 30, availableFrom: '2026-11-01T00:00:00.000Z',
  subjects: ['general-english'], teachLanguages: [], ageGroups: ['adults'], experienceBand: '3-5-years', yearsExperience: 3, experience: [],
  degreeLevel: null, degreeMajor: null, degreeInstitution: null, degreeYear: null, certificates: [],
  fullName: 'Jane Doe', nationality: 'GB', englishLevel: 'native', nativeSpeaker: true, languages: [], headline: 'CELTA English teacher, five years', bio: '',
  coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null, coverConsentVersion: null, coverConsentAt: null, coverConfirmedAt: null,
  photoUrl: PHOTO, videoUrl: null, videoOnRequest: false, videoVersion: 0, hasPrivateVideo: false, cvFileName: null, phone: '+84901234567',
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); ios.on = false })

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

  // ── THE CV "FROM NOW ON" (owner, 2026-10-21): a profile created since TEACHER_CV_REQUIRED_FROM that has a CV keeps one —
  // replaced, never removed (DELETE → 409 cv_required); an older one (or a row with no creation time) keeps "optional".
  // An edit never carries `cvUpload`: its picked CV goes up AFTER the save, attached at once by the CV route.
  describe('the CV on an edit', () => {
    const AFTER = '2026-10-24T03:00:00.000Z' // created after the cutoff (constants.ts TEACHER_CV_REQUIRED_FROM)
    const cvSection = async (name: string) => within((await screen.findByRole('heading', { name })).closest('section')!)
    const cvCalls = () => calls.filter((c) => c.url.startsWith('/api/teachers/me/cv'))
    const routes = (extra: Record<string, (body: unknown) => { status?: number; json: unknown }>) => {
      const f = fakeFetch({
        'GET /api/teachers/me': () => ({ json: { teacher: row, publishGate: { ok: true, code: null } } }),
        'PUT /api/teachers/me': () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: { onRequest: false, version: 0, hasPrivate: false, url: null } } }),
        ...extra,
      })
      calls = f.calls
      vi.stubGlobal('fetch', f.fn)
    }

    it('a legacy profile (no creation time, no CV) still saves — "CV (optional)", nothing asked for, nothing uploaded', async () => {
      history.replaceState(null, '', '/teachers/edit?step=finish')
      const user = mount()
      const cv = await cvSection('CV (optional)')
      expect(cv.getByText('Choose PDF')).toBeTruthy()
      await user.click(action('Save changes'))
      await waitFor(() => expect(lastPut()).toBeTruthy())
      expect('cvUpload' in lastPut()!).toBe(false)
      expect(cvCalls()).toEqual([])
      expect(await screen.findByText('Profile saved')).toBeTruthy()
      // The done screen asks for one, first.
      expect(screen.getAllByRole('button', { name: /^Add / })[0].textContent).toBe('Add your CV')
    })

    it('⛔ a profile created since the cutoff with a CV: "CV", no Remove for the saved one — a new pick replaces it after the save', async () => {
      row = { ...ROW, createdAt: AFTER, cvFileName: 'old-cv.pdf' }
      routes({ 'POST /api/teachers/me/cv': () => ({ json: { ok: true, cvFileName: 'new-cv.pdf' } }) })
      history.replaceState(null, '', '/teachers/edit?step=finish')
      const user = mount()
      const cv = await cvSection('CV')
      expect(cv.getByText('old-cv.pdf')).toBeTruthy()
      expect(cv.queryByRole('button', { name: 'Remove' })).toBeNull()
      expect(cv.getByText('Replace CV')).toBeTruthy()
      await user.upload(document.querySelector<HTMLInputElement>('input[accept="application/pdf,.pdf"]')!, new File(['%PDF-1.4'], 'new-cv.pdf', { type: 'application/pdf' }))
      // A pending pick can still be let go — back to the saved one.
      expect(cv.getByRole('button', { name: 'Keep my saved CV' })).toBeTruthy()
      await user.click(action('Save changes'))
      expect(await screen.findByText('Profile saved')).toBeTruthy()
      // Uploaded AFTER the PUT, by the edit's own call (never a pending one), and never named by the save.
      const put = calls.findIndex((c) => c.method === 'PUT')
      expect(cvCalls().map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/teachers/me/cv'])
      expect(calls.indexOf(cvCalls()[0])).toBeGreaterThan(put)
      expect('cvUpload' in lastPut()!).toBe(false)
      expect(screen.queryByRole('button', { name: 'Add your CV' })).toBeNull()
    })

    it('a 409 cv_required from the server (it knows the profile is new) is said, and the CV stays', async () => {
      // No creation time on the row: the form does not know — the server does.
      row = { ...ROW, cvFileName: 'old-cv.pdf' }
      routes({ 'DELETE /api/teachers/me/cv': () => ({ status: 409, json: { error: 'cv_required' } }) })
      history.replaceState(null, '', '/teachers/edit?step=finish')
      const user = mount()
      const cv = await cvSection('CV (optional)')
      await user.click(cv.getByRole('button', { name: 'Remove' }))
      expect(await screen.findByText('Your profile needs a CV — upload a new one to replace it.')).toBeTruthy()
      expect(cv.getByText('old-cv.pdf')).toBeTruthy()
    })

    it('an older profile may still remove its CV; a removal that fails is said — never silent', async () => {
      row = { ...ROW, createdAt: '2026-10-01T03:00:00.000Z', cvFileName: 'old-cv.pdf' }
      let ok = false
      routes({ 'DELETE /api/teachers/me/cv': () => (ok ? { json: { ok: true } } : { status: 500, json: { error: 'internal_error' } }) })
      history.replaceState(null, '', '/teachers/edit?step=finish')
      const user = mount()
      const cv = await cvSection('CV (optional)')
      await user.click(cv.getByRole('button', { name: 'Remove' }))
      expect(await screen.findByText('Could not remove your CV. Please try again.')).toBeTruthy()
      expect(cv.getByText('old-cv.pdf')).toBeTruthy()
      ok = true
      await user.click(cv.getByRole('button', { name: 'Remove' }))
      await waitFor(() => expect(cv.queryByText('old-cv.pdf')).toBeNull())
      expect(screen.queryByText('Could not remove your CV. Please try again.')).toBeNull()
      expect(cv.getByText('Choose PDF')).toBeTruthy()
    })

    it('a CV upload that fails AFTER the save is said on the done screen — the save stands (never "Something went wrong")', async () => {
      routes({ 'POST /api/teachers/me/cv': () => { throw new TypeError('Failed to fetch') } })
      history.replaceState(null, '', '/teachers/edit?step=finish')
      const user = mount()
      await cvSection('CV (optional)')
      await user.upload(document.querySelector<HTMLInputElement>('input[accept="application/pdf,.pdf"]')!, new File(['%PDF-1.4'], 'new-cv.pdf', { type: 'application/pdf' }))
      await user.click(action('Save changes'))
      expect(await screen.findByText('Profile saved')).toBeTruthy()
      expect(screen.getByText('CV upload failed.')).toBeTruthy()
      expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull()
      expect(screen.getAllByRole('button', { name: /^Add / })[0].textContent).toBe('Add your CV')
    })

    it('an edit form with no profile id (its load failed) saves as a CREATE — so its CV goes up first, as a pending upload the PUT names', async () => {
      const { id: _id, ...noId } = ROW
      row = noId
      routes({ 'POST /api/teachers/me/cv?pending=1': () => ({ json: { ok: true, cvUpload: 'aaaaaaaa-0000-4000-8000-00000000000e', cvFileName: 'new-cv.pdf' } }) })
      history.replaceState(null, '', '/teachers/edit?step=finish')
      const user = mount()
      await cvSection('CV (optional)')
      await user.upload(document.querySelector<HTMLInputElement>('input[accept="application/pdf,.pdf"]')!, new File(['%PDF-1.4'], 'new-cv.pdf', { type: 'application/pdf' }))
      await user.click(action('Save changes'))
      expect(await screen.findByText('Profile saved')).toBeTruthy()
      expect(cvCalls().map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/teachers/me/cv?pending=1'])
      expect(calls.indexOf(cvCalls()[0])).toBeLessThan(calls.findIndex((c) => c.method === 'PUT'))
      expect(lastPut()).toMatchObject({ teacherProfileId: null, cvUpload: 'aaaaaaaa-0000-4000-8000-00000000000e', cvFileName: 'new-cv.pdf' })
    })

    it('⛔ a CV refusal from the server opens Photo & publish from any step (stepOfField: cv → finish)', async () => {
      routes({ 'PUT /api/teachers/me': () => ({ status: 400, json: { error: 'invalid_teacher_profile', fields: { cv: 'required' } } }) })
      const user = mount()
      expect(await screen.findByText('Where are you now?')).toBeTruthy()
      await user.click(action('Save changes'))
      const cv = await cvSection('CV (optional)')
      expect(await cv.findByText(/^Please add your CV — a PDF up to 10 MB/)).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'CV (optional)' }).closest('section')!.hasAttribute('data-invalid')).toBe(true)
    })
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

  it('⛔ ?review=draft never brings ANOTHER account\'s tab copy into this profile (commit gate, round 15)', async () => {
    putDraft({ ...COMPLETE, headline: 'Someone else, phonics' }, 'about', 5, 'u9')
    history.replaceState(null, '', '/teachers/edit?review=draft')
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(screen.queryByText(/Your new answers are filled in below and are not saved yet/)).toBeNull()
    await user.click(rail('About you'))
    expect((await screen.findByRole('textbox', { name: 'Headline' }) as HTMLInputElement).value).toBe(ROW.headline)
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

  /**
   * "Hide my profile from search engines" (owner decision 14, 2026-10-20): loaded from GET /api/teachers/me (the row's
   * hideFromSearch), saved AT ONCE through its own endpoint — never with the profile save — and moved only by the
   * server's answer; a failed save leaves it where the server last said and says so.
   */
  it('"Hide my profile from search engines" loads as saved and saves at once through its own endpoint', async () => {
    row = { ...ROW, hideFromSearch: true }
    const replies: Array<{ status?: number; json: unknown }> = [{ json: { hidden: false } }, { status: 500, json: { error: 'internal' } }]
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: { teacher: row, publishGate: { ok: true, code: null } } }),
      'PUT /api/teachers/me/search': () => replies.shift() ?? { status: 500, json: {} },
    })
    vi.stubGlobal('fetch', f.fn)
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Photo & publish' }))
    const sw = await screen.findByRole('switch', { name: 'Hide my profile from search engines' })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    await user.click(sw)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Hide my profile from search engines' }).getAttribute('aria-checked')).toBe('false'))
    expect(f.calls.filter((c) => c.url === '/api/teachers/me/search')).toEqual([{ url: '/api/teachers/me/search', method: 'PUT', body: { hidden: false } }])
    // Never the profile save.
    expect(f.calls.some((c) => c.url === '/api/teachers/me' && c.method === 'PUT')).toBe(false)
    // A failed save: the switch stays where the server last said, and the line says so.
    await user.click(screen.getByRole('switch', { name: 'Hide my profile from search engines' }))
    expect(await screen.findByText('Could not save the switch. Please try again.')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Hide my profile from search engines' }).getAttribute('aria-checked')).toBe('false')
  })

  it('/join for an account that already has a profile, with answers just made: review them in the profile, or keep it', async () => {
    putDraft(COMPLETE, 'about')
    mount('join')
    expect(await screen.findByText('You already have a teacher profile')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Review these answers in my profile' }).getAttribute('href')).toBe('/teachers/edit?review=draft')
    expect(screen.getByRole('button', { name: 'Keep my profile' })).toBeTruthy()
  })
})

describe('sharing the profile (owner, 2026-10-11)', () => {
  it('a profile schools can see: "Share my profile" by the title', async () => {
    mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Share my profile' })).toBeTruthy()
  })

  it('⛔ "Share my profile" sends what the public page shows — never an edit not saved yet', async () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(rail('About you'))
    const headline = await screen.findByRole('textbox', { name: 'Headline' })
    await user.clear(headline)
    await user.type(headline, 'Unsaved headline')
    await user.click(screen.getByRole('button', { name: 'Share my profile' }))
    await user.click(await screen.findByRole('button', { name: /WhatsApp/ }))
    const sent = decodeURIComponent(String(open.mock.calls.at(-1)?.[0]))
    expect(sent).toContain(ROW.headline)
    expect(sent).not.toContain('Unsaved headline')
  })

  it('⛔ a save the server leaves held (moderation, an identity hold): "Share my profile" goes — on the done screen and back in the form', async () => {
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: { teacher: ROW, publishGate: { ok: true, code: null } } }),
      'PUT /api/teachers/me': () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: false, noGoal: false, cover: null, video: { onRequest: false, version: 0, hasPrivate: false, url: null } } }),
    })
    vi.stubGlobal('fetch', f.fn)
    const user = mount()
    expect(await screen.findByRole('button', { name: 'Share my profile' })).toBeTruthy()
    await user.click(action('Save changes'))
    expect(await screen.findByText(/Your profile is under review and not visible right now/)).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Share your profile' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Share my profile' })).toBeNull()
  })

  it('held (moderation, an identity hold) or hidden: nothing to share', async () => {
    row = { ...ROW, listingLive: false }
    mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Share my profile' })).toBeNull()
    cleanup()
    row = { ...ROW, status: 'hidden' }
    mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Share my profile' })).toBeNull()
  })
})

/**
 * ⛔ "IDENTITY VERIFIED" — AUTOMATIC, HIDDEN BY ITS OWN SWITCH ON ITS OWN ENDPOINT (owner, 2026-10-15; automatic since
 * 2026-10-16; plan review R2). On Photo & publish, for a saved profile: the switch loads ON unless the server says the
 * teacher hid it (`identityMarkHidden` — never re-derived from the row's columns); it saves ON TOGGLE through PUT
 * /api/teachers/me/identity-mark — a HIDE with nothing else, a SHOW-again with the stamps the form loaded as its base and
 * no notice — and moves only on the server's answer, whose stamps are the next base; a 409 (another window moved the
 * switch) says so calmly and re-reads; a 429 (a show only) says so. The profile save NEVER carries it, and a rename
 * re-reads its line.
 */
describe('⛔ the "Identity verified" switch — automatic, hidden on toggle, never with the profile', () => {
  const MARK_NAME = 'Show “Identity verified” on my profile'
  const SHOWN_AT = '2026-10-16T01:00:00.000Z'
  const HIDDEN_AT = '2026-10-16T02:00:00.000Z'
  type Reply = { status?: number; json: unknown }
  let hidden: boolean
  // The row's raw switch columns as the GET spreads them — what the form must NOT judge the switch from.
  let raw: Record<string, unknown>
  let state: { shown: boolean; reason: string | null } | null
  let stamps: { at: string | null; withdrawnAt: string | null }
  let markReply: (body: unknown) => Reply | Promise<Reply>
  let f: ReturnType<typeof fakeFetch>
  const markPuts = () => f.calls.filter((c) => c.url === '/api/teachers/me/identity-mark')
  const gets = () => f.calls.filter((c) => c.method === 'GET' && c.url === '/api/teachers/me')
  const profilePut = () => f.calls.filter((c) => c.method === 'PUT' && c.url === '/api/teachers/me').at(-1)?.body as Record<string, unknown> | undefined
  const sw = () => screen.getByRole('switch', { name: MARK_NAME })
  /** Another window (or the server) moved the switch: the stored state the next read and the CAS see. */
  const storeHidden = (h: boolean) => {
    hidden = h
    state = h ? { shown: false, reason: 'hidden' } : { shown: true, reason: null }
    stamps = h ? { at: stamps.at, withdrawnAt: HIDDEN_AT } : { at: SHOWN_AT, withdrawnAt: stamps.withdrawnAt }
  }

  beforeEach(() => {
    hidden = false
    raw = {}
    state = { shown: true, reason: null }
    stamps = { at: null, withdrawnAt: null }
    // As the endpoint answers: a hide stamps the hide (the show stamp kept as history), a show-again stamps the show.
    markReply = (body) => {
      storeHidden(!(body as { on: boolean }).on)
      return { json: { identityMark: state, stamps } }
    }
    f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: { teacher: { ...row, identityMarkAt: stamps.at, identityMarkWithdrawnAt: stamps.withdrawnAt, ...raw }, publishGate: { ok: true, code: null }, identityMark: state, identityMarkStamps: stamps, identityMarkHidden: hidden } }),
      'PUT /api/teachers/me': () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: { onRequest: false, version: 0, hasPrivate: false, url: null } } }),
      // The fixture's fetch fake answers synchronously; a Promise here is awaited by the form, so a test can hold it.
      'PUT /api/teachers/me/identity-mark': (b) => markReply(b) as Reply,
    })
    const plain = f.fn.getMockImplementation()!
    f.fn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/teachers/me/identity-mark') {
        const body = JSON.parse(String(init?.body))
        f.calls.push({ url: String(input), method: 'PUT', body })
        const r = await markReply(body)
        return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } })
      }
      return plain(input, init)
    })
    vi.stubGlobal('fetch', f.fn)
    history.replaceState(null, '', '/teachers/edit?step=finish')
  })

  it('loads ON unless the server says the teacher hid it — from its flag, never from the row\'s raw columns', async () => {
    // An untouched row (never switched): ON — the default — even though its raw `identityMarkOn` is false.
    raw = { identityMarkOn: false, identityMarkWithdrawnAt: null }
    mount()
    expect((await screen.findByRole('switch', { name: MARK_NAME })).getAttribute('aria-checked')).toBe('true')
    cleanup()
    // Columns that LOOK hidden, but the server's flag says not: still ON.
    raw = { identityMarkOn: false, identityMarkWithdrawnAt: HIDDEN_AT }
    mount()
    expect((await screen.findByRole('switch', { name: MARK_NAME })).getAttribute('aria-checked')).toBe('true')
    cleanup()
    raw = {}
    storeHidden(true)
    mount()
    expect((await screen.findByRole('switch', { name: MARK_NAME })).getAttribute('aria-checked')).toBe('false')
    // No opt-in nudge of any kind beside it.
    expect(screen.queryByText(/What this switch does has changed|switch (this|it) on/i)).toBeNull()
  })

  it('a SHOW-again sends the loaded stamps as its base and no notice — and flips only when the server has answered (never optimistic)', async () => {
    hidden = true
    state = { shown: false, reason: 'hidden' }
    stamps = { at: '2026-10-01T00:00:00.000Z', withdrawnAt: '2026-10-02T00:00:00.000Z' }
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    const answer = markReply
    markReply = async (body) => { await held; return answer(body) }
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: MARK_NAME }))
    await waitFor(() => expect(markPuts()).toHaveLength(1))
    expect(markPuts()[0].body).toEqual({ on: true, base: { at: '2026-10-01T00:00:00.000Z', withdrawnAt: '2026-10-02T00:00:00.000Z' } })
    expect(JSON.stringify(markPuts()[0].body)).not.toContain(IDENTITY_MARK_NOTICE_VERSION)
    // On its way: still OFF on screen, and saying so.
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Saving…')).toBeTruthy()
    release()
    await waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('true'))
  })

  it('a HIDE sends { on: false } alone, and moves only on the answer — whose stamps are the next show\'s base', async () => {
    stamps = { at: SHOWN_AT, withdrawnAt: null }
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    const answer = markReply
    markReply = async (body) => { await held; return answer(body) }
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: MARK_NAME }))
    await waitFor(() => expect(markPuts()).toHaveLength(1))
    expect(markPuts()[0].body).toEqual({ on: false })
    expect(sw().getAttribute('aria-checked')).toBe('true')
    release()
    await waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('false'))
    await user.click(sw())
    await waitFor(() => expect(markPuts()).toHaveLength(2))
    expect(markPuts()[1].body).toEqual({ on: true, base: { at: SHOWN_AT, withdrawnAt: HIDDEN_AT } })
    await waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('true'))
  })

  it('409 identity_mark_changed: a calm line, a fresh read — and the switch shows what is saved', async () => {
    storeHidden(true)
    markReply = () => {
      // Another window showed it meanwhile: the stored stamps moved, so this tab's base is stale.
      storeHidden(false)
      return { status: 409, json: { error: 'identity_mark_changed' } }
    }
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: MARK_NAME }))
    expect(await screen.findByText('This switch was changed in another window. It now shows what is saved — change it again if you want to.')).toBeTruthy()
    await waitFor(() => expect(gets()).toHaveLength(2))
    await waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('true'))
  })

  it('429 (a show only — a hide is never rate-limited): said — the switch stays as it was', async () => {
    storeHidden(true)
    markReply = () => ({ status: 429, json: { error: 'rate_limited' } })
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: MARK_NAME }))
    expect(await screen.findByText('Too many requests — please try again in a few minutes.')).toBeTruthy()
    expect(sw().getAttribute('aria-checked')).toBe('false')
  })

  // ⛔ Commit gate, 2026-10-16: every line about what the switch shows comes from a FRESH READ, never ahead of one.
  it('a failed hide is said only when the fresh read shows the server does not hold it — the switch stays as saved', async () => {
    markReply = () => { throw new TypeError('network down') }
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: MARK_NAME }))
    expect(await screen.findByText('Could not save the switch. Please try again.')).toBeTruthy()
    expect(gets()).toHaveLength(2)
    expect(sw().getAttribute('aria-checked')).toBe('true')
  })

  it('a hide whose answer was LOST is no failure: the fresh read shows it saved, and nothing is said', async () => {
    markReply = () => {
      // The server committed the hide; its answer never arrived.
      storeHidden(true)
      throw new TypeError('connection reset')
    }
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: MARK_NAME }))
    await waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('false'))
    expect(gets()).toHaveLength(2)
    expect(screen.queryByText('Could not save the switch. Please try again.')).toBeNull()
  })

  it('a 409 whose fresh read FAILS claims nothing about the switch: "could not check — reload"', async () => {
    storeHidden(true)
    markReply = () => {
      storeHidden(false)
      return { status: 409, json: { error: 'identity_mark_changed' } }
    }
    const impl = f.fn.getMockImplementation()!
    let n = 0
    f.fn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/teachers/me' && (init?.method ?? 'GET') === 'GET' && ++n > 1) {
        f.calls.push({ url: '/api/teachers/me', method: 'GET', body: undefined })
        throw new TypeError('network down')
      }
      return impl(input, init)
    })
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: MARK_NAME }))
    expect(await screen.findByText('Could not check the switch. Reload the page to see what is saved.')).toBeTruthy()
    expect(gets()).toHaveLength(2)
    expect(screen.queryByText(/It now shows what is saved/)).toBeNull()
  })

  it('⛔ the profile save never carries the switch — not after a hide, not ever (no `identityMarkHidden` on an edit)', async () => {
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: MARK_NAME }))
    await waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('false'))
    await user.click(action('Save changes'))
    await waitFor(() => expect(profilePut()).toBeTruthy())
    const body = profilePut()!
    for (const k of Object.keys(body)) expect(k, k).not.toMatch(/identity/i)
    expect('identityMarkHidden' in body).toBe(false)
    expect(JSON.stringify(body)).not.toContain(IDENTITY_MARK_NOTICE_VERSION)
  })

  it('a save that RENAMED the teacher re-reads the line (the name is what the mark vouches for); one that did not, does not', async () => {
    const user = mount()
    expect(await screen.findByRole('switch', { name: MARK_NAME })).toBeTruthy()
    await user.click(action('Save changes'))
    expect(await screen.findByText('Profile saved')).toBeTruthy()
    expect(gets()).toHaveLength(1)
    // An edit's done screen never says the mark "now shows" — the switch is on its own step.
    expect(screen.queryByTestId('identity-mark-done')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    await user.click(rail('About you'))
    const name = await screen.findByRole('textbox', { name: 'Full name' })
    await user.clear(name)
    await user.type(name, 'Jane Q Doe')
    state = { shown: false, reason: 'name_mismatch' }
    await user.click(action('Save changes'))
    expect(await screen.findByText('Profile saved')).toBeTruthy()
    await waitFor(() => expect(gets()).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    await user.click(rail('Photo & publish'))
    expect(await screen.findByText(/Not showing: the name on your profile doesn’t match your verified ID/)).toBeTruthy()
  })

  it('each reason\'s line is on the step; the trust line only while the check is live — a hide included', async () => {
    state = { shown: false, reason: 'pending' }
    mount()
    expect(await screen.findByText('eno’s team is checking your ID. It shows once approved.')).toBeTruthy()
    expect(screen.queryByText(/adds 10 points to your trust score/)).toBeNull()
    cleanup()
    storeHidden(true)
    mount()
    expect(await screen.findByText(/adds 10 points to your trust score/)).toBeTruthy()
  })

  it('⛔ iOS (`ios-hide-kyc`): "verify first" names the website — never a link', async () => {
    ios.on = true
    state = { shown: false, reason: 'unverified' }
    mount()
    expect(await screen.findByText('Verify your identity first — eno’s team checks an ID document and a selfie.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Verify my identity' })).toBeNull()
    expect(screen.getByText(/Identity verification is available on our website, in a web browser:/)).toBeTruthy()
  })
})

// ── THE PHONE IS MANDATORY "ON NEXT SAVE" (owner, 2026-10-22: "Everyone, on next save") — a saved profile with no phone
// (24 of 125 live ones that day) adds one the next time it is saved, but ⛔ "hiding a profile or switching things off is
// NEVER blocked" (profile.ts phoneWaived): a save that hides it (D6) or switches off something it had on goes through.
// And ⛔ the job-match switches of an existing profile are NEVER flipped by the new default: they load as stored. ─────────
describe('⛔ the phone on an edit, and the switches as stored (owner, 2026-10-22)', () => {
  const ROW_NO_PHONE = { ...ROW, phone: '' }
  const OPTINS_ON = { matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION, staffContactOptIn: true, staffContactNoticeVersion: AI_NOTICE_VERSION }
  const phoneLine = 'Please add your phone number — it stays private: the person you are chatting with gets it only when you share it.'

  it('a profile with no saved phone: Save is refused ON THE PHONE (Photo & publish opens), nothing sent — and saves once one is added', async () => {
    row = ROW_NO_PHONE
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(action('Save changes'))
    expect(await screen.findByText(phoneLine)).toBeTruthy()
    const phone = screen.getByRole('textbox', { name: 'Phone number' })
    expect(phone.getAttribute('aria-invalid')).toBe('true')
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    await user.type(phone, '+84 901 234 567')
    await user.click(action('Save changes'))
    await waitFor(() => expect(lastPut()).toMatchObject({ phone: '+84 901 234 567' }))
    expect(await screen.findByText('Profile saved')).toBeTruthy()
  })

  it('⛔ …except a save that switches job emails OFF — a withdrawal is never refused for the phone', async () => {
    // Staff calls off: since 2026-10-08 they needed a phone, so a saved profile without one never had them on.
    row = { ...ROW_NO_PHONE, ...OPTINS_ON, staffContactOptIn: false, staffContactNoticeVersion: null }
    history.replaceState(null, '', '/teachers/edit?step=finish')
    const user = mount()
    const email = await screen.findByRole('switch', { name: 'Email me jobs that match my profile' })
    expect(email.getAttribute('aria-checked')).toBe('true')
    await user.click(email)
    await user.click(action('Save changes'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(lastPut()).toMatchObject({ phone: '', matchEmailOptIn: false, staffContactOptIn: false })
    expect(screen.queryByText(phoneLine)).toBeNull()
  })

  it('⛔ a WITHDRAWAL only (commit gate, 2026-10-22): staff calls kept on beside a switch-off still need the number', async () => {
    row = { ...ROW_NO_PHONE, ...OPTINS_ON }
    history.replaceState(null, '', '/teachers/edit?step=finish')
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: 'Email me jobs that match my profile' }))
    await user.click(action('Save changes'))
    expect(await screen.findByText(phoneLine)).toBeTruthy()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('…while the same profile saved with nothing switched off still needs the phone', async () => {
    row = { ...ROW_NO_PHONE, ...OPTINS_ON }
    history.replaceState(null, '', '/teachers/edit?step=finish')
    const user = mount()
    expect(await screen.findByRole('switch', { name: 'Email me jobs that match my profile' })).toBeTruthy()
    await user.click(action('Save changes'))
    expect(await screen.findByText(phoneLine)).toBeTruthy()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('⛔ …and a save that HIDES it (no work wanted, cover off — D6) goes through without a phone, still asked first', async () => {
    row = { ...ROW_NO_PHONE, expectedSalaryM: null, availableFrom: null }
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Full-time' })) // the last job type: nothing to be found for
    await user.click(action('Save changes'))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/No work is chosen in step 1 and cover lessons are off/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Save and hide' }))
    await waitFor(() => expect(lastPut()).toMatchObject({ phone: '', jobTypes: [] }))
    expect(screen.queryByText(phoneLine)).toBeNull()
  })

  it('a phone that IS saved can never be cleared — not even by a save that switches something off', async () => {
    row = { ...ROW, ...OPTINS_ON }
    history.replaceState(null, '', '/teachers/edit?step=finish')
    const user = mount()
    await user.clear(await screen.findByRole('textbox', { name: 'Phone number' }))
    await user.click(screen.getByRole('switch', { name: 'Email me jobs that match my profile' }))
    await user.click(action('Save changes'))
    expect(await screen.findByText(phoneLine)).toBeTruthy()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('⛔ stored OFF stays OFF — the new-profile default never flips an existing profile — and the save sends them off, no aiNotice, no optInDefaults', async () => {
    history.replaceState(null, '', '/teachers/edit?step=finish')
    const user = mount()
    const email = await screen.findByRole('switch', { name: 'Email me jobs that match my profile' })
    expect(email.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'Our staff may call me' }).getAttribute('aria-checked')).toBe('false')
    await user.click(action('Save changes'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(lastPut()).toMatchObject({ matchEmailOptIn: false, staffContactOptIn: false })
    expect('aiNotice' in lastPut()!).toBe(false)
    expect('optInDefaults' in lastPut()!).toBe(false)
  })

  it('stored ON stays ON, and saves ON with the aiNotice — no optInDefaults on an edit', async () => {
    row = { ...ROW, ...OPTINS_ON }
    history.replaceState(null, '', '/teachers/edit?step=finish')
    const user = mount()
    expect((await screen.findByRole('switch', { name: 'Email me jobs that match my profile' })).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Our staff may call me' }).getAttribute('aria-checked')).toBe('true')
    await user.click(action('Save changes'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(lastPut()).toMatchObject({ matchEmailOptIn: true, staffContactOptIn: true, aiNotice: AI_NOTICE_VERSION })
    expect('optInDefaults' in lastPut()!).toBe(false)
  })
})
