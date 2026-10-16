// @vitest-environment jsdom
/**
 * THE START SCREEN AND THE CV READER, whole-form (owner, 2026-10-15: "when they upload their cv it should read … all
 * necessary parts of teacher profile"; LinkedIn removed 2026-10-16 — "profile read only from cv is enough"):
 *   · the doors are real links, decided by the server for the first paint (teacher-start.tsx); none when there is no
 *     reader, when the teacher chose "myself", or when answers are already on the page;
 *   · ⛔ a session still being read shows neither doors nor step 1;
 *   · ⛔ the reading fills ONLY empty answers, is saved to the account's draft at once, and says what it filled; Undo of a
 *     first reading deletes the saved draft; the phone and the file are only OFFERED on Photo & publish;
 *   · every refusal says what to do next, and "Fill it in myself" is always there.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, fireEvent, getConfig, render, screen, waitFor, within } from '@testing-library/react'
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

const START: TeacherStartProps = { importIntent: null, sessionHint: false, cvImport: true, campaign: '' }
/** `?import=cv` — a link straight to the reading panel (eno.vn). */
const PANEL: TeacherStartProps = { ...START, importIntent: 'cv' }
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
  let rev = 0
  const f = fakeFetch({
    'GET /api/teachers/me': () => ({ json: { teacher: null, publishGate: { ok: true, code: null }, prefill: { displayName: 'Jane Account', avatarUrl: null, phone: null } } }),
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
/** The panel, opened by `?import=cv` (mount with PANEL): its button that agrees and opens the picker, once usable. */
async function onCvPanel(_user: ReturnType<typeof userEvent.setup>) {
  const choose = await screen.findByTestId('import-choose')
  await waitFor(() => expect((choose as HTMLButtonElement).disabled).toBe(false))
  return choose
}

describe('how a new profile opens (owner, 2026-10-16: "start with this page and move cv read for later pages")', () => {
  it('⛔ step 1 first — no screen of choices before it, no LinkedIn', async () => {
    mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(screen.queryByText('How would you like to start?')).toBeNull()
    expect(screen.queryByTestId('door-cv')).toBeNull()
    expect(screen.queryByText(/LinkedIn/)).toBeNull()
    // Not offered before sign-in: the reader needs an account, and step 1 asks none of what a CV answers.
    expect(screen.queryByTestId('cv-handy')).toBeNull()
  })

  it('on teacher.eno.vn too, whatever the campaign — and `?import=cv` never opens a panel there (no session to read under)', async () => {
    mount({ draftHost: true, goal: 'cover', start: { ...PANEL, campaign: 'utm_source=meta&utm_campaign=teachers' } })
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(screen.queryByTestId('import-panel')).toBeNull()
  })

  it('no reader configured: `?import=cv` opens the form, never a dead end', async () => {
    mount({ start: { ...PANEL, cvImport: false } })
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
  })

  it('`?import=cv` (a link from a guide or an ad) opens the reading panel', async () => {
    mount({ start: PANEL })
    expect(await screen.findByRole('heading', { name: 'Fill it in from your CV' })).toBeTruthy()
  })

  it('⛔ a request that came with a session waits for the account before the panel', async () => {
    auth.loading = true
    mount({ start: { ...PANEL, sessionHint: true } })
    expect(screen.queryByTestId('import-panel')).toBeNull()
  })

  it('signed in on "Your teaching": the CV card opens the panel, and "Back to the form" returns to that step', async () => {
    signIn()
    saved = { t: { ...EMPTY_TEACHER, livesIn: 'abroad', jobTypes: ['fulltime'], relocate: 'anywhere', teachAreas: ['online'], teachAreasConfirmed: true }, step: 'teaching', rev: 3, gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', updatedAt: '2026-10-15T09:00:00.000Z' }
    const user = mount({ start: { ...START, sessionHint: true } })
    const card = await screen.findByTestId('cv-handy', {}, { timeout: 15_000 })
    await user.click(within(card).getByRole('button', { name: 'Use my CV' }))
    expect(await screen.findByRole('heading', { name: 'Fill it in from your CV' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Back to the form/ }))
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
  })
})

describe('the reading panel', () => {
  it('signed out: the notice, and "Sign in to choose your CV" — nothing is read without an account', async () => {
    const user = mount({ start: PANEL })
    expect(await screen.findByRole('heading', { name: 'Fill it in from your CV' })).toBeTruthy()
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
    // ⛔ AUTOFILLED, NOT OFFERED (owner, 2026-10-16): the CV's phone into the empty field, the PDF as the private CV — said.
    expect(screen.getByText(/We added the phone number from your CV:/).textContent).toContain('+447700900123')
    expect(screen.getByText(/Your CV will be attached to your profile when you publish\. It stays private/)).toBeTruthy()
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
    // The address drops `import=cv`, so a reload opens the form, not the panel (and never the retired `start=self`).
    expect(window.location.search).toBe('')
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
    const user = mount({ start: PANEL })
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
    const user = mount({ start: PANEL })
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
    const user = mount({ start: PANEL })
    await onCvPanel(user)
    fireEvent.change(fileInput(), { target: { files: [pdf()] } })
    await screen.findByTestId('import-summary')
    await waitFor(() => expect(draftPuts().length).toBeGreaterThan(0))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.startsWith('/api/teachers/me/draft'))).toBe(true))
    expect(await screen.findByTestId('import-choose')).toBeTruthy()
  })

  it('⛔ only a PDF becomes the attached CV, and only a phone the form would accept is filled in (gate review, 2026-10-16)', async () => {
    signIn()
    importReply = () => ({ json: { import: { ...IMPORT, phone: 'ext. 12 (office)' } } })
    const user = mount({ start: PANEL })
    await onCvPanel(user)
    fireEvent.change(fileInput(), { target: { files: [new File([new Uint8Array(2_000)], 'cv.jpg', { type: 'image/jpeg' })] } })
    expect(await screen.findByTestId('import-summary')).toBeTruthy()
    // A photo of a CV is read, never attached (the panel keeps only a PDF, and the form takes only a PDF) — and a number
    // the form would refuse is not filled into a field the teacher never typed in.
    expect(screen.queryByText(/Your CV will be attached to your profile/)).toBeNull()
    expect(screen.queryByText(/We added the phone number from your CV/)).toBeNull()
  })

  it('a Word file is read in the browser and sent as text; an old .doc is refused with the way out', async () => {
    signIn()
    const user = mount({ start: PANEL })
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
    const user = mount({ start: PANEL })
    await onCvPanel(user)
    fireEvent.change(fileInput(), { target: { files: [pdf()] } })
    expect((await screen.findByRole('alert')).textContent).toMatch(line)
    // The same words in every state: the button is part of the notice the consent record names.
    expect(screen.getByTestId('import-choose').textContent).toBe('Agree & choose my CV')
  })

  it('409 teacher_exists: the account has a profile — the form says where it is', async () => {
    signIn()
    importReply = () => ({ status: 409, json: { error: 'teacher_exists' } })
    const user = mount({ start: PANEL })
    await onCvPanel(user)
    fireEvent.change(fileInput(), { target: { files: [pdf()] } })
    expect(await screen.findByRole('heading', { name: 'You already have a teacher profile' })).toBeTruthy()
  })

  it('in the apps with the review gate on: Google AI is asked about first, and the next tap opens the picker', async () => {
    signIn()
    gate.needed = true
    const user = mount({ start: PANEL })
    const choose = await onCvPanel(user)
    const click = vi.spyOn(fileInput(), 'click')
    await user.click(choose)
    expect(gate.asked).toBe(1)
    expect(click).not.toHaveBeenCalled()
    expect(await screen.findByText('Thanks — now choose your file.')).toBeTruthy()
    await user.click(choose)
    expect(click).toHaveBeenCalledTimes(1)
  })
})
