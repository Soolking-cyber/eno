// @vitest-environment jsdom
/**
 * THE START SCREEN AND THE CV READER, whole-form (owner, 2026-10-15: "at the beginning add the connect linkedin feature …
 * alternatively when they upload their cv it should read … all necessary parts of teacher profile"):
 *   · the doors are real links, decided by the server for the first paint (teacher-start.tsx); none when there is no
 *     reader and no LinkedIn, when the teacher chose "myself", or when answers are already on the page;
 *   · ⛔ a session still being read shows neither doors nor step 1;
 *   · ⛔ the reading fills ONLY empty answers, is saved to the account's draft at once, and says what it filled; Undo of a
 *     first reading deletes the saved draft; the phone and the file are only OFFERED on Photo & publish;
 *   · every refusal says what to do next, and "Fill it in myself" is always there.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, fireEvent, getConfig, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { EMPTY_TEACHER } from '@/lib/teachers/profile'
import { TEACHER_IMPORT_NOTICE_VERSION } from '@/lib/teachers/import-notice'
import type { TeacherStartProps } from './teacher-start'
import { fakeFetch, stubBrowser, type Call } from './teacher-form.fixtures'

const auth = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string; app_metadata?: Record<string, unknown> },
  loading: false, openSignIn: vi.fn(), accountType: 'individual' as string | null, identityLoaded: true, markOnboarded: vi.fn(),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/components/marketplace/push-opt-in-card', () => ({ PushOptInCard: () => null }))
vi.mock('@/hooks/use-dashboard', () => ({ revalidateDashboard: () => {} }))
const gate = vi.hoisted(() => ({ needed: false, answer: true, asked: 0 }))
const li = vi.hoisted(() => ({ here: true }))
vi.mock('@/lib/linkedin-signin', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/linkedin-signin')>()), linkedinAvailableHere: () => li.here }))
vi.mock('@/lib/ai-consent', () => ({
  aiConsentNeeded: () => gate.needed,
  askAiConsent: async () => { gate.asked++; return gate.answer },
}))

import { TeacherForm } from './teacher-form'

const asyncUtilTimeout = getConfig().asyncUtilTimeout
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 60_000 })
afterAll(() => { configure({ asyncUtilTimeout }); vi.resetConfig() })
beforeAll(() => { Element.prototype.scrollIntoView ??= function () {} })

const START: TeacherStartProps = { importIntent: null, startSelf: false, li: null, sessionHint: false, cvImport: true, linkedin: 'on', mobile: false, campaign: '' }
const IMPORT = {
  source: 'cv',
  fields: {
    subjects: ['ielts'], ageGroups: ['adults'], experienceBand: '3-5-years',
    experience: [{ role: 'ESL Teacher', employer: 'ILA Vietnam', city: 'Ho Chi Minh City', from: '2023-02', to: '' }],
    degreeLevel: 'bachelor', degreeMajor: 'English', degreeInstitution: 'University of Leeds', degreeYear: 2016,
    certificates: [{ type: 'celta', hours: null, provider: 'Cambridge English', year: 2019 }],
    fullName: 'Jane Smith', nationality: 'GB', englishLevel: 'native', headline: 'CELTA-certified IELTS teacher', bio: 'I teach IELTS to adults.',
  },
  phone: '+447700900123',
  skippedJobs: 1,
}

let calls: Call[] = []
let saved: unknown = null
let importReply: () => { status?: number; json: unknown } = () => ({ json: { import: IMPORT } })
beforeEach(() => {
  stubBrowser()
  auth.user = null
  auth.loading = false
  auth.openSignIn = vi.fn()
  saved = null
  importReply = () => ({ json: { import: IMPORT } })
  Object.assign(gate, { needed: false, answer: true, asked: 0 })
  li.here = true
  let rev = 0
  const f = fakeFetch({
    'GET /api/teachers/me': () => ({ json: { teacher: null, publishGate: { ok: true, code: null }, prefill: { displayName: 'Jane LinkedIn', avatarUrl: null, phone: null } } }),
    'GET /api/teachers/me/draft': () => ({ json: { draft: saved } }),
    'PUT /api/teachers/me/draft': () => ({ json: { rev: ++rev, gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', updatedAt: '2026-10-15T10:00:00.000Z' } }),
    'DELETE /api/teachers/me/draft': () => ({ json: { ok: true } }),
    'POST /api/teachers/me/import': () => importReply(),
  })
  vi.stubGlobal('fetch', f.fn)
  calls = f.calls
  history.replaceState(null, '', '/teachers/join')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mount(props: Partial<React.ComponentProps<typeof TeacherForm>> = {}) {
  render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <main><TeacherForm mode="join" draftHost={false} apexOrigin="https://eno.vn" start={START} {...props} /></main>
    </LanguageProvider>,
  )
  return userEvent.setup()
}
const signIn = (extra: Partial<NonNullable<typeof auth.user>> = {}) => { auth.user = { id: 'u1', ...extra } }
const pdf = (name = 'cv.pdf', size = 2_000) => new File([new Uint8Array(size)], name, { type: 'application/pdf' })
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!
const draftPuts = () => calls.filter((c) => c.method === 'PUT' && c.url === '/api/teachers/me/draft').map((c) => c.body as { t: Record<string, unknown>; step: string })
const importPosts = () => calls.filter((c) => c.method === 'POST' && c.url === '/api/teachers/me/import')
const door = (id: string) => screen.getByTestId(`door-${id}`) as HTMLAnchorElement
/** Signed in on the CV panel, its draft loaded: the button that agrees and opens the picker. */
async function onCvPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId('door-cv'))
  const choose = await screen.findByTestId('import-choose')
  await waitFor(() => expect((choose as HTMLButtonElement).disabled).toBe(false))
  return choose
}

describe('the start screen', () => {
  it('signed out: LinkedIn first — a link to the sign-in with its notice beside it — then the CV, then "myself"', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'How would you like to start?' })).toBeTruthy()
    const li = door('linkedin')
    expect(li.textContent).toContain('Continue with LinkedIn')
    // The start route checks the notice version; the way back is the reading panel for the LinkedIn PDF.
    const url = new URL(li.href, 'https://eno.vn')
    expect(url.pathname).toBe('/auth/linkedin/start')
    expect(url.searchParams.get('n')).toBe('2026-10-15')
    expect(url.searchParams.get('next')).toBe('/teachers/join?import=linkedin')
    // ⛔ The notice is read before the act (LinkedIn API Terms 5.2): on screen, and the link points at it.
    expect(document.getElementById(li.getAttribute('aria-describedby')!)?.textContent).toMatch(/LinkedIn doesn’t share your jobs or education/)
    expect(door('cv').getAttribute('href')).toBe('?import=cv')
    expect(door('self').getAttribute('href')).toBe('?start=self')
    // Order on the page: LinkedIn, CV, myself.
    const order = [...document.querySelectorAll('[data-testid^="door-"]')].map((a) => a.getAttribute('data-testid'))
    expect(order).toEqual(['door-linkedin', 'door-cv', 'door-self'])
  })

  it('the doors carry the cover intent and the campaign tags; on teacher.eno.vn they lead to eno.vn', () => {
    mount({ draftHost: true, goal: 'cover', start: { ...START, campaign: 'utm_source=meta&utm_campaign=teachers' } })
    expect(door('cv').getAttribute('href')).toBe('https://eno.vn/teachers/join?import=cv&goal=cover&utm_source=meta&utm_campaign=teachers')
    const li = new URL(door('linkedin').href)
    expect(li.origin + li.pathname).toBe('https://eno.vn/auth/linkedin/start')
    expect(li.searchParams.get('next')).toBe('/teachers/join?import=linkedin&goal=cover&utm_source=meta&utm_campaign=teachers')
    // "Myself" stays on the teacher host: its step 1 needs no account.
    expect(door('self').getAttribute('href')).toBe('?start=self&goal=cover&utm_source=meta&utm_campaign=teachers')
  })

  it('no reader and no LinkedIn — or ?start=self, or no start screen at all — opens step 1 as before', async () => {
    mount({ start: { ...START, cvImport: false, linkedin: 'off' } })
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    cleanup()
    mount({ start: { ...START, startSelf: true } })
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    cleanup()
    mount({ start: undefined })
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(screen.queryByTestId('teacher-start')).toBeNull()
  })

  it('"Fill it in myself" opens step 1 in place, and the address remembers it', async () => {
    const user = mount()
    await user.click(door('self'))
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(window.location.search).toBe('?start=self')
  })

  it('in Facebook or Zalo: no LinkedIn door at all (a phone, and "Save to PDF" needs a computer) — the way to it is said instead', () => {
    mount({ start: { ...START, linkedin: 'browser' } })
    expect(screen.queryByTestId('door-linkedin')).toBeNull()
    const order = [...document.querySelectorAll('[data-testid^="door-"]')].map((a) => a.getAttribute('data-testid'))
    expect(order).toEqual(['door-cv', 'door-self'])
    expect(screen.getByText(/Open this page in your phone’s browser/)).toBeTruthy()
  })

  it('on a phone with LinkedIn sign-in off, the CV door comes before the LinkedIn PDF (which needs a computer)', () => {
    mount({ start: { ...START, linkedin: 'off', mobile: true } })
    const order = [...document.querySelectorAll('[data-testid^="door-"]')].map((a) => a.getAttribute('data-testid'))
    expect(order).toEqual(['door-cv', 'door-linkedin', 'door-self'])
    expect(door('linkedin').textContent).toMatch(/On a computer, save your LinkedIn profile as a PDF/)
  })

  it('⛔ where the browser says LinkedIn cannot finish (an iOS home-screen app), the door stays put and a tap says why', async () => {
    li.here = false
    const user = mount()
    const before = window.location.href
    await user.click(door('linkedin'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/LinkedIn sign-in can’t finish in this app/)
    expect(window.location.href).toBe(before)
  })

  it('a LinkedIn sign-in that came back cancelled is said, once — the address forgets it', () => {
    history.replaceState(null, '', '/teachers/join?li=cancelled')
    mount({ start: { ...START, li: 'cancelled' } })
    expect(screen.getByRole('alert').textContent).toMatch(/LinkedIn sign-in was cancelled/)
    expect(window.location.search).toBe('')
  })

  it('⛔ a LinkedIn sign-in that failed back to the FORM itself (step 1’s popup) is said there too — never stripped unread', async () => {
    history.replaceState(null, '', '/teachers/join?start=self&li=email')
    mount({ start: { ...START, startSelf: true, li: 'email' } })
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/LinkedIn email address isn’t confirmed/)
    expect(window.location.search).toBe('?start=self')
  })

  it('a door moves the focus to the new screen’s heading (nothing is left focused on a control that went away)', async () => {
    const user = mount()
    await user.click(door('cv'))
    const heading = await screen.findByRole('heading', { name: 'Fill it in from your CV' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('⛔ a request that came with a session waits for the account — neither the doors nor step 1 first', async () => {
    auth.loading = true
    mount({ start: { ...START, sessionHint: true } })
    expect(screen.queryByTestId('teacher-start')).toBeNull()
    expect(screen.queryByText('Where are you now?')).toBeNull()
  })

  it('signed in with nothing saved: the doors, once the account is known — LinkedIn as the PDF, not a second sign-in', async () => {
    signIn()
    mount({ start: { ...START, sessionHint: true } })
    const li = await screen.findByTestId('door-linkedin')
    expect(li.textContent).toContain('Use my LinkedIn profile')
    expect(li.getAttribute('href')).toBe('?import=linkedin')
  })

  it('signed in with a saved draft: the form opens where it was — no doors', async () => {
    signIn()
    saved = { t: { ...EMPTY_TEACHER, livesIn: 'abroad', jobTypes: ['fulltime'], relocate: 'anywhere' }, step: 'plans', rev: 3, gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', updatedAt: '2026-10-15T09:00:00.000Z' }
    mount({ start: { ...START, sessionHint: true } })
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(screen.queryByTestId('teacher-start')).toBeNull()
  })
})

describe('the reading panel', () => {
  it('signed out: the notice, and "Sign in to choose your CV" — nothing is read without an account', async () => {
    const user = mount()
    await user.click(door('cv'))
    expect(await screen.findByRole('heading', { name: 'Fill it in from your CV' })).toBeTruthy()
    expect(window.location.search).toBe('?import=cv')
    expect(screen.getByText(/Google's Gemini AI reads your CV on Google Cloud, outside Vietnam/)).toBeTruthy()
    await user.click(screen.getByTestId('import-sign-in'))
    expect(auth.openSignIn).toHaveBeenCalledTimes(1)
    expect(importPosts()).toHaveLength(0)
  })

  it('⛔ reads the file with the notice version, fills ONLY empty answers, saves at once and says what it filled', async () => {
    signIn()
    // The saved draft already names the teacher: the CV's name must not replace it.
    saved = { t: { ...EMPTY_TEACHER, fullName: 'Jane Q. Teacher' }, step: 'plans', rev: 1, gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', updatedAt: '2026-10-15T09:00:00.000Z' }
    const user = mount({ start: { ...START, importIntent: 'cv', sessionHint: true } })
    const choose = await screen.findByTestId('import-choose')
    await waitFor(() => expect((choose as HTMLButtonElement).disabled).toBe(false))
    expect(choose.textContent).toBe('Agree & choose my CV')
    fireEvent.change(fileInput(), { target: { files: [pdf()] } })
    expect(await screen.findByTestId('import-summary')).toBeTruthy()

    const sent = importPosts()[0].body as FormData
    expect(sent.get('notice')).toBe(TEACHER_IMPORT_NOTICE_VERSION)
    expect(sent.get('lang')).toBe('en')
    expect((sent.get('file') as File).name).toBe('cv.pdf')

    // The summary: what was filled, step by step — the band flagged as worked out.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/We filled in 10 answers from your CV/)
    expect(screen.getByText('IELTS')).toBeTruthy()
    expect(screen.getByText("Bachelor's · English · University of Leeds · 2016")).toBeTruthy()
    expect(screen.getByText('Worked out from your file — check it.')).toBeTruthy()
    expect(screen.getByText(/One past job had no end date/)).toBeTruthy()
    expect(screen.getByText(/Your CV has a phone number — we only offer it to you on the last step/)).toBeTruthy()
    expect(screen.queryByText('Jane Smith')).toBeNull() // not filled: the teacher's own name stays

    // Saved to the account's draft at once — the imported answers, the teacher's own name, never the phone — and the
    // summary says "Saved" only once the save has landed.
    await waitFor(() => expect(draftPuts().length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.getByTestId('import-save-state').textContent).toBe('Saved to your account as a private draft.'))
    const put = draftPuts().at(-1)!
    expect(put.t).toMatchObject({ subjects: ['ielts'], degreeInstitution: 'University of Leeds', fullName: 'Jane Q. Teacher' })
    expect(put.t.phone).toBe('')

    await user.click(screen.getByTestId('import-continue'))
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(window.location.search).toBe('?start=self')
    expect(screen.getByTestId('import-line').textContent).toMatch(/Your CV filled in later steps/)
  })

  it('⛔ a save that fails is never called saved', async () => {
    signIn()
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: { teacher: null, publishGate: { ok: true, code: null }, prefill: null } }),
      'GET /api/teachers/me/draft': () => ({ json: { draft: null } }),
      'PUT /api/teachers/me/draft': () => ({ status: 503, json: { error: 'unavailable' } }),
      'POST /api/teachers/me/import': () => ({ json: { import: IMPORT } }),
    })
    vi.stubGlobal('fetch', f.fn)
    const user = mount()
    await onCvPanel(user)
    fireEvent.change(fileInput(), { target: { files: [pdf()] } })
    await screen.findByTestId('import-summary')
    await waitFor(() => expect(screen.getByTestId('import-save-state').textContent).toBe('Not saved to your account yet — the answers stay on this page.'))
  })

  it('⛔ answers left in this tab signed out are never carried into the account by a reading — only once the teacher moves on with them on screen', async () => {
    // A signed-out visitor's step 1, left in the tab (no owner); then someone signs in here and reads a CV.
    sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'plans', t: { ...EMPTY_TEACHER, livesIn: 'abroad', jobTypes: ['fulltime'], relocate: 'anywhere' } }))
    signIn()
    const user = mount({ start: { ...START, importIntent: 'cv', sessionHint: true } })
    const choose = await screen.findByTestId('import-choose')
    await waitFor(() => expect((choose as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(fileInput(), { target: { files: [pdf()] } })
    await screen.findByTestId('import-summary')
    expect(screen.getByTestId('import-save-state').textContent).toMatch(/when you move on from the first step/)
    await new Promise((r) => setTimeout(r, 300))
    expect(draftPuts()).toHaveLength(0)
    // On step 1, with those answers on screen: moving on saves them all, as for any answers.
    await user.click(screen.getByTestId('import-continue'))
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(screen.getAllByRole('button', { name: 'Next' })[0])
    await waitFor(() => expect(draftPuts().length).toBeGreaterThan(0))
    expect(draftPuts().at(-1)!.t).toMatchObject({ livesIn: 'abroad', subjects: ['ielts'] })
  })

  it('a session that ended says so on the panel, with the way back — never "loading" for ever', async () => {
    signIn()
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: { teacher: null, publishGate: { ok: true, code: null }, prefill: null } }),
      'GET /api/teachers/me/draft': () => ({ status: 401, json: { error: 'unauthorized' } }),
    })
    vi.stubGlobal('fetch', f.fn)
    mount({ start: { ...START, importIntent: 'cv', sessionHint: true } })
    expect((await screen.findByRole('alert')).textContent).toMatch(/You are signed out — sign in again to read your file/)
    expect((screen.getByTestId('import-choose') as HTMLButtonElement).disabled).toBe(true)
  })

  it('Undo shows that it is working, and Continue waits for it', async () => {
    signIn()
    let release: () => void = () => {}
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: { teacher: null, publishGate: { ok: true, code: null }, prefill: null } }),
      'GET /api/teachers/me/draft': () => ({ json: { draft: null } }),
      'PUT /api/teachers/me/draft': () => ({ json: { rev: 1, gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', updatedAt: '2026-10-15T10:00:00.000Z' } }),
      'POST /api/teachers/me/import': () => ({ json: { import: IMPORT } }),
    })
    const slowDelete = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'DELETE') { await new Promise<void>((r) => { release = r }); return new Response('{}', { status: 200 }) }
      return f.fn(input, init)
    })
    vi.stubGlobal('fetch', slowDelete)
    const user = mount()
    await onCvPanel(user)
    fireEvent.change(fileInput(), { target: { files: [pdf()] } })
    await screen.findByTestId('import-summary')
    await waitFor(() => expect(screen.getByTestId('import-save-state').textContent).toBe('Saved to your account as a private draft.'))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('button', { name: /Undoing/ })).toBeTruthy()
    expect((screen.getByTestId('import-continue') as HTMLButtonElement).disabled).toBe(true)
    release()
    expect(await screen.findByTestId('import-choose')).toBeTruthy()
  })

  it('⛔ Undo is no back door: taking a reading back never saves answers left in this tab signed out', async () => {
    sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'plans', t: { ...EMPTY_TEACHER, livesIn: 'abroad', jobTypes: ['fulltime'], relocate: 'anywhere' } }))
    signIn()
    const user = mount({ start: { ...START, importIntent: 'cv', sessionHint: true } })
    const choose = await screen.findByTestId('import-choose')
    await waitFor(() => expect((choose as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(fileInput(), { target: { files: [pdf()] } })
    await screen.findByTestId('import-summary')
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByTestId('import-choose')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 300))
    expect(draftPuts()).toHaveLength(0)
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('⛔ Undo of a first reading deletes the saved draft and goes back to choosing', async () => {
    signIn()
    const user = mount()
    await onCvPanel(user)
    fireEvent.change(fileInput(), { target: { files: [pdf()] } })
    await screen.findByTestId('import-summary')
    await waitFor(() => expect(draftPuts().length).toBeGreaterThan(0))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.startsWith('/api/teachers/me/draft'))).toBe(true))
    expect(await screen.findByTestId('import-choose')).toBeTruthy()
  })

  it('a Word file is read in the browser and sent as text; an old .doc is refused with the way out', async () => {
    signIn()
    const user = mount()
    await onCvPanel(user)
    fireEvent.change(fileInput(), { target: { files: [new File(['x'], 'cv.doc', { type: 'application/msword' })] } })
    expect((await screen.findByRole('alert')).textContent).toMatch(/older document format/)
    expect(importPosts()).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Fill it in myself' })).toBeTruthy()
  })

  it.each([
    [{ status: 429, json: { error: 'import_rate_hour' } }, /several files in the last hour/],
    [{ status: 503, json: { error: 'import_capacity' } }, /reading a lot of files right now/],
    [{ status: 422, json: { error: 'import_locked' } }, /password-protected/],
    [{ json: { import: null, reason: 'not_cv' } }, /doesn’t look like a CV/],
    [{ json: { import: null, reason: 'empty' } }, /found nothing we could fill in/],
    [{ status: 409, json: { error: 'notice_changed', notice: 'import' } }, /Reload the page to read them/],
  ])('a refusal says what to do next: %j', async (reply, line) => {
    signIn()
    importReply = () => reply
    const user = mount()
    await onCvPanel(user)
    fireEvent.change(fileInput(), { target: { files: [pdf()] } })
    expect((await screen.findByRole('alert')).textContent).toMatch(line)
    // The same words in every state: the button is part of the notice the consent record names.
    expect(screen.getByTestId('import-choose').textContent).toBe('Agree & choose my CV')
  })

  it('409 teacher_exists: the account has a profile — the form says where it is', async () => {
    signIn()
    importReply = () => ({ status: 409, json: { error: 'teacher_exists' } })
    const user = mount()
    await onCvPanel(user)
    fireEvent.change(fileInput(), { target: { files: [pdf()] } })
    expect(await screen.findByRole('heading', { name: 'You already have a teacher profile' })).toBeTruthy()
  })

  it('in the apps with the review gate on: Google AI is asked about first, and the next tap opens the picker', async () => {
    signIn()
    gate.needed = true
    const user = mount()
    const choose = await onCvPanel(user)
    const click = vi.spyOn(fileInput(), 'click')
    await user.click(choose)
    expect(gate.asked).toBe(1)
    expect(click).not.toHaveBeenCalled()
    expect(await screen.findByText('Thanks — now choose your file.')).toBeTruthy()
    await user.click(choose)
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('⛔ an account only LINKED to LinkedIn later (made with Google) is never told it signed up with LinkedIn', async () => {
    signIn({ email: 'jane@gmail.com', app_metadata: { provider: 'google', providers: ['google', 'linkedin_oidc'] } })
    mount({ start: { ...START, importIntent: 'linkedin', sessionHint: true } })
    expect(await screen.findByRole('heading', { name: 'Bring in your LinkedIn profile' })).toBeTruthy()
    expect(screen.queryByText(/signed up with LinkedIn/)).toBeNull()
  })

  it('back from LinkedIn: the panel names the account, and step 4 offers the LinkedIn name', async () => {
    signIn({ email: 'jane@example.com', app_metadata: { provider: 'linkedin_oidc', providers: ['linkedin_oidc'] } })
    mount({ start: { ...START, importIntent: 'linkedin', sessionHint: true } })
    expect(await screen.findByRole('heading', { name: 'Bring in your LinkedIn profile' })).toBeTruthy()
    expect(screen.getByText(/You signed up with LinkedIn/).textContent).toContain('jane@example.com')
    expect(screen.getByText(/Save to PDF/)).toBeTruthy()
  })
})
