// @vitest-environment jsdom
/**
 * THE ACCOUNT'S SAVED TEACHER DRAFT, as the form uses it (owner, 2026-10-11: "every step they input should be saved and
 * able to resume when they want to" — teacher-form.tsx draftRev, src/lib/teachers/draft.ts):
 *   · ⛔ the saved draft wins over a `#d=` hand-off and this tab's copy, and the screen says it reopened it;
 *   · ⛔ answers on screen that the form did not sign in for are saved only once the teacher changes something;
 *   · ⛔ a draft save never carries the phone;
 *   · a save refused as stale or gone stops saving and asks; a failed one says so;
 *   · Start over deletes the saved draft and the tab copy; edit mode with no profile offers the draft back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, configure, getConfig, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { COMPLETE, b64url, fakeFetch, putDraft, storedDraft, stubBrowser, type Call } from './teacher-form.fixtures'

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as null | { id: string }, loading: false, openSignIn: vi.fn(), accountType: 'individual' as string | null, identityLoaded: true, markOnboarded: vi.fn() }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/components/marketplace/push-opt-in-card', () => ({ PushOptInCard: () => null }))
const dash = vi.hoisted(() => ({ revalidated: [] as string[] }))
vi.mock('@/hooks/use-dashboard', () => ({ revalidateDashboard: (uid: string) => { dash.revalidated.push(uid) } }))

import { TeacherForm } from './teacher-form'

const asyncUtilTimeout = getConfig().asyncUtilTimeout
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 60_000 })
afterAll(() => { configure({ asyncUtilTimeout }); vi.resetConfig() })
beforeAll(() => { Element.prototype.scrollIntoView ??= function () {} })

type Draft = { t: unknown; step: string; rev: number; gen?: string; updatedAt: string } | null
let calls: Call[] = []
let saved: Draft = null
let putReply: (body: unknown) => { status?: number; json: unknown } = () => ({ json: {} })
let me: Record<string, unknown> = { teacher: null, publishGate: { ok: true, code: null }, prefill: null }
beforeEach(() => {
  stubBrowser()
  auth.user = { id: 'u1' }
  auth.openSignIn = vi.fn()
  dash.revalidated = []
  saved = null
  me = { teacher: null, publishGate: { ok: true, code: null }, prefill: null }
  let rev = 0
  putReply = () => ({ json: { rev: ++rev, gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', updatedAt: '2026-10-11T10:00:00.000Z' } })
  const f = fakeFetch({
    'GET /api/teachers/me': () => ({ json: me }),
    'GET /api/teachers/me/draft': () => ({ json: { draft: saved } }),
    'PUT /api/teachers/me/draft': (b) => putReply(b),
    'DELETE /api/teachers/me/draft': () => ({ json: { ok: true } }),
  })
  vi.stubGlobal('fetch', f.fn)
  calls = f.calls
  history.replaceState(null, '', '/teachers/join')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mount(mode: 'join' | 'edit' = 'join') {
  render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <main><TeacherForm mode={mode} draftHost={false} apexOrigin="https://eno.vn" /></main>
    </LanguageProvider>,
  )
  return userEvent.setup()
}
const action = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const draftPuts = () => calls.filter((c) => c.method === 'PUT' && c.url === '/api/teachers/me/draft').map((c) => c.body as { t: Record<string, unknown>; step: string; rev: number })

describe('loading the account\'s saved draft', () => {
  it('⛔ the saved draft wins over a #d= hand-off — reopened where it left off, and the screen says so', async () => {
    saved = { t: { ...COMPLETE, fullName: 'Saved Name' }, step: 'teaching', rev: 3, updatedAt: '2026-10-10T08:00:00.000Z', gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
    history.replaceState(null, '', `/teachers/join#d=${b64url({ v: 2, t: { ...COMPLETE, currentCity: 'ha-noi', currentDistrictKey: '' } })}`)
    const user = mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    expect(screen.getByText('You had already started a teacher profile — it is open where you left off.')).toBeTruthy()
    // The next save builds on the saved revision.
    await user.click(action('Next'))
    await waitFor(() => expect(draftPuts().length).toBeGreaterThan(0))
    expect(draftPuts()[0].rev).toBe(3)
    expect(draftPuts()[0].t.fullName).toBe('Saved Name')
  })

  it('…and the answers it replaced are one tap away — then saved over it, on its revision', async () => {
    saved = { t: { ...COMPLETE, fullName: 'Saved Name' }, step: 'about', rev: 4, updatedAt: '2026-10-10T08:00:00.000Z', gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
    putDraft({ ...COMPLETE, fullName: 'Typed Here' }, 'about')
    const user = mount()
    expect(await screen.findByDisplayValue('Saved Name')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Use the answers I just gave instead' }))
    expect(await screen.findByDisplayValue('Typed Here')).toBeTruthy() // and back on the step they were on (About)
    // Chosen: saved over the saved draft at once, on its revision.
    await waitFor(() => expect(draftPuts().length).toBeGreaterThan(0))
    expect(draftPuts()[0]).toMatchObject({ rev: 4, t: { fullName: 'Typed Here' } })
  })

  it('⛔ nothing can be typed before the saved draft answers — the form waits for it', async () => {
    let answer: (v: unknown) => void = () => {}
    const pending = new Promise((r) => { answer = r })
    const f = fakeFetch({ 'GET /api/teachers/me': () => ({ json: me }) })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/teachers/me/draft') { await pending; return new Response(JSON.stringify({ draft: { t: COMPLETE, step: 'teaching', rev: 1, gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', updatedAt: '2026-10-10T08:00:00.000Z' } }), { status: 200 }) }
      return f.fn(input, init)
    }))
    putDraft(COMPLETE, 'where')
    mount()
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByText('Where can you teach?')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    answer(null)
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
  })

  it('a load that fails shows the form, says nothing is saved yet, and saves nothing until it answers', async () => {
    const f = fakeFetch({ 'GET /api/teachers/me': () => ({ json: me }), 'GET /api/teachers/me/draft': () => ({ status: 503, json: { error: 'unavailable' } }) })
    vi.stubGlobal('fetch', f.fn)
    putDraft(COMPLETE, 'where')
    const user = mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    expect(await screen.findByText('Not saved yet — we will try again. Your answers stay on this page.')).toBeTruthy()
    await user.click(action('Next'))
    await new Promise((r) => setTimeout(r, 100))
    expect(f.calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('⛔ with nothing saved, answers this form did not sign in for are saved only once the teacher changes something', async () => {
    putDraft(COMPLETE, 'where') // this tab's copy, with no sign-in mark
    const user = mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    expect(await screen.findByText(/^Your answers are saved to your account each time you move to another step\./)).toBeTruthy()
    await new Promise((r) => setTimeout(r, 100))
    expect(draftPuts()).toHaveLength(0)
    await user.click(action('Next'))
    await waitFor(() => expect(draftPuts()).toHaveLength(1))
    expect(draftPuts()[0]).toMatchObject({ rev: 0, step: 'teaching' })
    expect(await screen.findByText(/^Saved to your account — finish any time, on any device\./)).toBeTruthy()
    // The first save made the dashboard's "Teacher profile — Continue" row.
    expect(dash.revalidated).toEqual(['u1'])
  })

  it('⛔ a draft save never carries the phone — nor a consent, the cover switch or an upload', async () => {
    putDraft({ ...COMPLETE, phone: '+84901234567', coverOpen: true, coverConsent: true, photoUrl: 'https://sb.eno.vn/p.webp' }, 'where')
    const user = mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await user.click(action('Next'))
    await waitFor(() => expect(draftPuts()).toHaveLength(1))
    expect(draftPuts()[0].t).toMatchObject({ phone: '', coverOpen: false, coverConsent: false, photoUrl: null })
  })
})

describe('a save that is refused or fails', () => {
  it('stale (another window or device saved since): saving stops; "Open the latest" brings the saved answers', async () => {
    putReply = () => ({ status: 409, json: { error: 'draft_stale' } })
    putDraft(COMPLETE, 'where')
    const user = mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await user.click(action('Next'))
    expect(await screen.findByText('Your profile was changed in another window or on another device.')).toBeTruthy()
    // ⛔ Saving STOPS until the teacher chooses — no timer, retry or page-exit save re-sends it.
    const sent = draftPuts().length
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((r) => setTimeout(r, 200))
    expect(draftPuts()).toHaveLength(sent)
    expect(screen.getByText('Your profile was changed in another window or on another device.')).toBeTruthy()
    saved = { t: { ...COMPLETE, fullName: 'From the phone' }, step: 'about', rev: 7, updatedAt: '2026-10-11T09:00:00.000Z', gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
    await user.click(screen.getByRole('button', { name: 'Open the latest' }))
    expect(await screen.findByDisplayValue('From the phone')).toBeTruthy()
    expect(screen.queryByText('Your profile was changed in another window or on another device.')).toBeNull()
  })

  it('gone (published, started over or expired elsewhere): "Save the answers on this page" starts a new draft', async () => {
    let first = true
    putReply = () => {
      if (first) { first = false; return { status: 409, json: { error: 'draft_gone' } } }
      return { json: { rev: 1, gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', updatedAt: '2026-10-11T10:00:00.000Z' } }
    }
    putDraft(COMPLETE, 'where')
    const user = mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await user.click(action('Next'))
    await user.click(await screen.findByRole('button', { name: 'Save the answers on this page' }))
    await waitFor(() => expect(draftPuts()).toHaveLength(2))
    expect(draftPuts()[1].rev).toBe(0)
  })

  it('an outage never turns typing into a request per keystroke: one failed save, then the paced retry', async () => {
    putReply = () => ({ status: 503, json: { error: 'unavailable' } })
    putDraft(COMPLETE, 'where')
    const user = mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await user.click(action('Next'))
    await waitFor(() => expect(draftPuts()).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'IELTS' }))
    await user.click(screen.getByRole('button', { name: 'Kids' }))
    await new Promise((r) => setTimeout(r, 150))
    expect(draftPuts()).toHaveLength(1)
  })

  it('a failed save never looks saved', async () => {
    putReply = () => ({ status: 503, json: { error: 'unavailable' } })
    putDraft(COMPLETE, 'where')
    const user = mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await user.click(action('Next'))
    expect(await screen.findByText('Not saved yet — we will try again. Your answers stay on this page.')).toBeTruthy()
    expect(screen.queryByText(/^Saved to your account/)).toBeNull()
  })

  it('a profile made meanwhile (another tab published): the form offers it, never a second one', async () => {
    putReply = () => ({ status: 409, json: { error: 'teacher_exists' } })
    putDraft(COMPLETE, 'where')
    const user = mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await user.click(action('Next'))
    expect(await screen.findByRole('heading', { name: 'You already have a teacher profile' })).toBeTruthy()
  })
})

describe('Start over, and the edit page', () => {
  it('deletes the saved draft and this tab\'s copy, and opens an empty form', async () => {
    saved = { t: COMPLETE, step: 'teaching', rev: 2, updatedAt: '2026-10-10T08:00:00.000Z', gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
    const user = mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    await user.click(await screen.findByRole('button', { name: 'Start over' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === `/api/teachers/me/draft?rev=2&gen=${encodeURIComponent('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b')}`)).toBe(true))
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(storedDraft()).toBeNull()
    expect(dash.revalidated).toContain('u1')
  })

  it('edit mode with no profile but a saved draft offers it back', async () => {
    saved = { t: COMPLETE, step: 'teaching', rev: 2, updatedAt: '2026-10-10T08:00:00.000Z', gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
    mount('edit')
    expect(await screen.findByRole('link', { name: 'Continue my teacher profile' })).toBeTruthy()
  })
})

describe('saved on every step change — and the line never says "saved" for answers that are not', () => {
  it('typing on a step sends nothing; the line says the step is saved when the teacher moves on; moving on saves it', async () => {
    saved = { t: COMPLETE, step: 'teaching', rev: 2, updatedAt: '2026-10-10T08:00:00.000Z', gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
    const user = mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    expect(screen.getByText(/^Saved to your account — finish any time, on any device\./)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'IELTS' }))
    expect(await screen.findByText(/^Saved up to your last step — this step is saved when you move on\./)).toBeTruthy()
    await new Promise((r) => setTimeout(r, 150))
    expect(draftPuts()).toHaveLength(0)
    await user.click(action('Next'))
    await waitFor(() => expect(draftPuts()).toHaveLength(1))
    expect(draftPuts()[0]).toMatchObject({ rev: 2, step: 'about' })
  })

  it('"Open the latest" that cannot reach the saved profile keeps the choice on screen — never a silent "keep"', async () => {
    putReply = () => ({ status: 409, json: { error: 'draft_stale' } })
    putDraft(COMPLETE, 'where')
    const user = mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await user.click(action('Next'))
    expect(await screen.findByText('Your profile was changed in another window or on another device.')).toBeTruthy()
    const f = fakeFetch({ 'GET /api/teachers/me/draft': () => ({ status: 503, json: { error: 'unavailable' } }) })
    vi.stubGlobal('fetch', f.fn)
    await user.click(screen.getByRole('button', { name: 'Open the latest' }))
    expect(await screen.findByText('Could not reach your saved profile — please try again.')).toBeTruthy()
    expect(screen.getByText('Your profile was changed in another window or on another device.')).toBeTruthy()
    expect(f.calls.some((c) => c.method === 'PUT')).toBe(false)
  })
})

describe('adoption and leaving (commit gate, 2026-10-11)', () => {
  it('⛔ a restored mark WITHOUT the return marker (someone signed in elsewhere, then came here) adopts nothing', async () => {
    sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'where', t: COMPLETE, signIn: Date.now() }))
    mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 150))
    expect(draftPuts()).toHaveLength(0)
  })

  it('…and WITH it (the return from the form\'s own Google sign-in), signed in: adopted at once', async () => {
    history.replaceState(null, '', '/teachers/join?teacher_signin=1')
    sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'where', t: COMPLETE, signIn: Date.now() }))
    mount()
    await waitFor(() => expect(draftPuts()).toHaveLength(1))
    expect(draftPuts()[0]).toMatchObject({ rev: 0 })
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it('⛔ a sign-in mark restored on a page that loads SIGNED OUT (Google left half-way) is dropped after the grace — the answers stay', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      auth.user = null
      sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'where', t: COMPLETE, signIn: Date.now() }))
      history.replaceState(null, '', '/teachers/join?teacher_signin=1')
      mount()
      expect(await screen.findByText('Where are you now?')).toBeTruthy()
      await vi.advanceTimersByTimeAsync(1_000)
      // ⛔ kept in the copy until it is decided: a second reload within the grace still adopts (commit gate, round 16)
      expect(typeof storedDraft().signIn).toBe('number')
      await vi.advanceTimersByTimeAsync(5_000)
      await waitFor(() => expect(storedDraft().signIn).toBeUndefined())
      expect(storedDraft().t.livesIn).toBe(COMPLETE.livesIn) // the answers stay (written signed out: step 1)
    } finally { vi.useRealTimers() }
  })

  it('⛔ a #d= link opened while SIGNED IN is not adopted: nothing is saved until the teacher changes something', async () => {
    history.replaceState(null, '', `/teachers/join#d=${b64url({ v: 2, t: COMPLETE })}`)
    const user = mount()
    expect(await screen.findByText(/^Your answers are saved to your account each time you move to another step\./)).toBeTruthy()
    await new Promise((r) => setTimeout(r, 150))
    expect(draftPuts()).toHaveLength(0)
    expect(auth.openSignIn).not.toHaveBeenCalled()
    await user.click(action('Back')) // the teacher moves on with it (a step change): saved now
    await waitFor(() => expect(draftPuts()).toHaveLength(1))
  })

  it('⛔ after Start over, leaving the tab sends no empty draft', async () => {
    saved = { t: COMPLETE, step: 'teaching', rev: 2, updatedAt: '2026-10-10T08:00:00.000Z', gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
    const user = mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    await user.click(await screen.findByRole('button', { name: 'Start over' }))
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pagehide'))
    await new Promise((r) => setTimeout(r, 150))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    expect(draftPuts()).toHaveLength(0)
  })
})

describe('reloads and failures (commit gate, 2026-10-11)', () => {
  it('a reload mid-step keeps THIS tab\'s newer answers when they build on the account\'s current revision — saved next', async () => {
    saved = { t: { ...COMPLETE, fullName: 'Saved Name' }, step: 'about', rev: 2, updatedAt: '2026-10-10T08:00:00.000Z', gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
    sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'about', t: { ...COMPLETE, fullName: 'Typed Before Reload' }, base: { uid: 'u1', rev: 2, gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }, owner: 'u1' }))
    mount()
    expect(await screen.findByDisplayValue('Typed Before Reload')).toBeTruthy()
    expect(screen.queryByText('You had already started a teacher profile — it is open where you left off.')).toBeNull()
    await waitFor(() => expect(draftPuts()).toHaveLength(1))
    expect(draftPuts()[0]).toMatchObject({ rev: 2, t: { fullName: 'Typed Before Reload' } })
  })

  it('…but a revision saved since (another device) wins, and the tab\'s answers are offered', async () => {
    saved = { t: { ...COMPLETE, fullName: 'From the phone' }, step: 'about', rev: 5, updatedAt: '2026-10-11T08:00:00.000Z', gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
    sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'about', t: { ...COMPLETE, fullName: 'Older Tab' }, base: { uid: 'u1', rev: 2, gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' } }))
    mount()
    expect(await screen.findByDisplayValue('From the phone')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use the answers I just gave instead' })).toBeTruthy()
    expect(draftPuts()).toHaveLength(0)
  })

  it('a Start over whose delete fails changes nothing and says so', async () => {
    saved = { t: COMPLETE, step: 'teaching', rev: 2, updatedAt: '2026-10-10T08:00:00.000Z', gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: me }),
      'GET /api/teachers/me/draft': () => ({ json: { draft: saved } }),
      'DELETE /api/teachers/me/draft': () => ({ status: 503, json: { error: 'unavailable' } }),
    })
    vi.stubGlobal('fetch', f.fn)
    const user = mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    await user.click(await screen.findByRole('button', { name: 'Start over' }))
    expect(await screen.findByText('Could not start over — please try again.')).toBeTruthy()
    expect(screen.getByText('What do you teach?')).toBeTruthy()
  })
})

describe('round-4 review cases (commit gate, 2026-10-11)', () => {
  it('"Open the latest" when nothing is saved any more (deleted elsewhere): the deleted state — never brought back unasked', async () => {
    putReply = () => ({ status: 409, json: { error: 'draft_stale' } })
    putDraft(COMPLETE, 'where')
    const user = mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await user.click(action('Next'))
    expect(await screen.findByText('Your profile was changed in another window or on another device.')).toBeTruthy()
    saved = null
    const before = draftPuts().length
    await user.click(screen.getByRole('button', { name: 'Open the latest' }))
    expect(await screen.findByText('Your saved answers were deleted — published, started over, or not changed for 90 days.')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 100))
    expect(draftPuts()).toHaveLength(before)
  })

  it('after Start over the first answer is not saved by itself — moving on saves it', async () => {
    saved = { t: COMPLETE, step: 'teaching', rev: 2, updatedAt: '2026-10-10T08:00:00.000Z', gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
    const user = mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    await user.click(await screen.findByRole('button', { name: 'Start over' }))
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Ho Chi Minh City' }))
    await new Promise((r) => setTimeout(r, 150))
    expect(draftPuts()).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Full-time' }))
    await user.click(screen.getByRole('radio', { name: /No, only around Ho Chi Minh City/ }))
    await user.click(action('Next'))
    await waitFor(() => expect(draftPuts()).toHaveLength(1))
    expect(draftPuts()[0]).toMatchObject({ rev: 0 })
  })
})

describe('round-5 review cases (commit gate, 2026-10-11)', () => {
  it('⛔ a form that unmounts (a sign-out remounts it) fires nothing afterwards — no retry under the next session', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      putReply = () => ({ status: 503, json: { error: 'unavailable' } })
      putDraft(COMPLETE, 'where')
      render(
        <LanguageProvider initialLang="en" initialViDict={{}}>
          <main><TeacherForm mode="join" draftHost={false} apexOrigin="https://eno.vn" /></main>
        </LanguageProvider>,
      )
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      expect(await screen.findByText('Where can you teach?')).toBeTruthy()
      await user.click(action('Next'))
      await waitFor(() => expect(draftPuts()).toHaveLength(1))
      // The failed save armed its 30s retry (a FAKE timer now): mounted, it would fire.
      cleanup()
      await vi.advanceTimersByTimeAsync(120_000)
      expect(draftPuts()).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a refusal that will not be retried says so — never "we will try again"', async () => {
    putReply = () => ({ status: 400, json: { error: 'bad_request' } })
    putDraft(COMPLETE, 'where')
    const user = mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await user.click(action('Next'))
    expect(await screen.findByText('Could not save your answers — we will try again when you move to another step. They stay on this page.')).toBeTruthy()
  })
})

describe('round-6 review cases (commit gate, 2026-10-11)', () => {
  it('Back and Next again while a save is on its way: the changes made meanwhile are saved when it lands', async () => {
    let release: () => void = () => {}
    let n = 0
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: me }),
      'GET /api/teachers/me/draft': () => ({ json: { draft: null } }),
      'PUT /api/teachers/me/draft': () => ({ json: { rev: ++n, gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', updatedAt: '2026-10-11T10:00:00.000Z' } }),
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/teachers/me/draft' && init?.method === 'PUT' && n === 0) await new Promise<void>((r) => { release = r })
      return f.fn(input, init)
    }))
    putDraft(COMPLETE, 'where')
    const user = mount()
    expect(await screen.findByText('Where can you teach?')).toBeTruthy()
    await user.click(action('Next')) // → teaching; the first save hangs
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    await user.click(action('Back'))
    await user.click(screen.getByRole('button', { name: 'Online lessons' }))
    await user.click(action('Next')) // back on teaching — the step the hanging save was sent from
    release()
    await waitFor(() => expect(f.calls.filter((c) => c.method === 'PUT')).toHaveLength(2))
    const last = f.calls.filter((c) => c.method === 'PUT').at(-1)!.body as { t: { teachAreas: string[] }; rev: number }
    expect(last.rev).toBe(1)
    expect(last.t.teachAreas).toContain('online')
  })
})

describe('round-7 review cases (commit gate, 2026-10-11)', () => {
  it('Start over names the revision it saw; a newer one saved elsewhere is not deleted — the choice is asked', async () => {
    saved = { t: COMPLETE, step: 'teaching', rev: 2, updatedAt: '2026-10-10T08:00:00.000Z', gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: me }),
      'GET /api/teachers/me/draft': () => ({ json: { draft: saved } }),
      'DELETE /api/teachers/me/draft': () => ({ status: 409, json: { error: 'draft_stale' } }),
    })
    vi.stubGlobal('fetch', f.fn)
    const user = mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    await user.click(await screen.findByRole('button', { name: 'Start over' }))
    expect(await screen.findByText('Your profile was changed in another window or on another device.')).toBeTruthy()
    expect(f.calls.find((c) => c.method === 'DELETE')!.url).toBe(`/api/teachers/me/draft?rev=2&gen=${encodeURIComponent('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b')}`)
    expect(screen.getByText('What do you teach?')).toBeTruthy() // nothing was cleared
  })
})

describe('round-8 review cases (commit gate, 2026-10-11)', () => {
  it('a refused Next still saves what was given — a partial step 1 reaches the account', async () => {
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Not in Vietnam yet' }))
    await user.click(action('Next')) // refused: no work picked
    expect(await screen.findByText('Please pick the work you are looking for.')).toBeTruthy()
    await waitFor(() => expect(draftPuts()).toHaveLength(1))
    expect(draftPuts()[0]).toMatchObject({ rev: 0, step: 'plans', t: { livesIn: 'abroad' } })
  })

  it('a tab sent to the background saves what is unsaved, once, through the queue', async () => {
    saved = { t: COMPLETE, step: 'teaching', rev: 2, updatedAt: '2026-10-10T08:00:00.000Z', gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
    const user = mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'IELTS' }))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    await waitFor(() => expect(draftPuts()).toHaveLength(1))
    expect(draftPuts()[0]).toMatchObject({ rev: 2, step: 'teaching' })
  })
})

describe('round-9 review cases (commit gate, 2026-10-11)', () => {
  const GEN = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
  const AT = '2026-10-10T08:00:00.000Z'
  it('⛔ an ended session on the load: "You are signed out" with "Sign in again" — asked again quietly, nothing saved', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const f = fakeFetch({
        'GET /api/teachers/me': () => ({ json: me }),
        'GET /api/teachers/me/draft': () => ({ status: 401, json: { error: 'unauthorized' } }),
      })
      vi.stubGlobal('fetch', f.fn)
      mount()
      await waitFor(() => expect(screen.getByTestId('draft-line').textContent).toContain('You are signed out — sign in again to keep saving.'))
      expect(screen.getByRole('button', { name: 'Sign in again' })).toBeTruthy()
      // ⛔ no promise the page cannot keep: a session that ended elsewhere remounts the form (TeacherForm)
      expect(screen.getByTestId('draft-line').textContent).not.toContain('Your answers stay on this page')
      // a sign-in in another tab is found by a later try — asked less often each time (30s, then 1 minute…), never a save
      const gets = () => f.calls.filter((c) => c.method === 'GET' && c.url === '/api/teachers/me/draft').length
      // (React renders on a real macrotask: each count is awaited, never read straight after the clock moves)
      await vi.advanceTimersByTimeAsync(31_000)
      await waitFor(() => expect(gets()).toBe(2))
      await vi.advanceTimersByTimeAsync(45_000)
      await act(async () => {})
      expect(gets()).toBe(2) // the next try waits a minute, not 30s
      await vi.advanceTimersByTimeAsync(20_000)
      await waitFor(() => expect(gets()).toBe(3))
      expect(f.calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
    } finally { vi.useRealTimers() }
  })

  it('⛔ a reload after the draft was deleted elsewhere: said, never brought back unasked', async () => {
    saved = null
    sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'about', t: { ...COMPLETE, fullName: 'Tab Copy' }, base: { uid: 'u1', rev: 3, gen: GEN }, owner: 'u1' }))
    const user = mount()
    expect(await screen.findByText('Your saved answers were deleted — published, started over, or not changed for 90 days.')).toBeTruthy()
    await user.click(action('Next'))
    await new Promise((r) => setTimeout(r, 50))
    expect(draftPuts()).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Save the answers on this page' }))
    await waitFor(() => expect(draftPuts()).toHaveLength(1))
    expect(draftPuts()[0]).toMatchObject({ rev: 0, t: { fullName: 'Tab Copy' } })
  })

  it('a save answered 2xx but unreadable is checked, not reported as a conflict: Start over deletes the revision the account holds', async () => {
    saved = { t: COMPLETE, step: 'teaching', rev: 2, updatedAt: '2026-10-10T08:00:00.000Z', gen: GEN }
    let row = saved as Record<string, unknown>
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: me }),
      'GET /api/teachers/me/draft': () => ({ json: { draft: row } }),
      // committed (rev 3), but the answer is lost
      'PUT /api/teachers/me/draft': (body) => { row = { ...(body as object), rev: 3, gen: GEN, updatedAt: '2026-10-11T10:00:00.000Z' }; return { status: 200, json: {} } }, // no revision in the answer
      'DELETE /api/teachers/me/draft': () => ({ json: { ok: true } }),
    })
    vi.stubGlobal('fetch', f.fn)
    const user = mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    await user.click(action('Next'))
    await waitFor(() => expect(screen.getByTestId('draft-line').textContent).toContain('Not saved yet — we will try again.'))
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    await user.click(await screen.findByRole('button', { name: 'Start over' }))
    await waitFor(() => expect(f.calls.some((c) => c.method === 'DELETE')).toBe(true))
    expect(f.calls.find((c) => c.method === 'DELETE')!.url).toBe(`/api/teachers/me/draft?rev=3&gen=${encodeURIComponent(GEN)}`)
    expect(screen.queryByText('Your profile was changed in another window or on another device.')).toBeNull()
  })
})

describe('round-10 review cases (commit gate, 2026-10-12)', () => {
  const GEN = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
  const AT = '2026-10-10T08:00:00.000Z'
  const ui = () => (
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <main><TeacherForm mode="join" draftHost={false} apexOrigin="https://eno.vn" /></main>
    </LanguageProvider>
  )

  it('a FIRST save that committed but answered without a revision: checked, and the next builds on it — no false conflict', async () => {
    const GEN1 = '7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d'
    let row: Record<string, unknown> | null = null
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: me }),
      'GET /api/teachers/me/draft': () => ({ json: { draft: row } }),
      'PUT /api/teachers/me/draft': (body) => {
        const b = body as { t: unknown; step: string; rev: number; gen?: string }
        if (b.rev === 0 && !row) { row = { t: b.t, step: b.step, rev: 1, gen: b.gen ?? GEN1, updatedAt: '2026-10-12T01:00:00.000Z' }; return { json: {} } }
        if (row && b.rev === row.rev && b.gen === row.gen) { row = { ...row, t: b.t, step: b.step, rev: b.rev + 1 }; return { json: { rev: row.rev, gen: row.gen, updatedAt: '2026-10-12T01:00:00.000Z' } } }
        return { status: 409, json: { error: 'draft_stale' } }
      },
    })
    vi.stubGlobal('fetch', f.fn)
    putDraft(COMPLETE, 'plans')
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    const puts = () => f.calls.filter((c) => c.method === 'PUT' && c.url === '/api/teachers/me/draft').map((c) => c.body as Record<string, unknown>)
    await user.click(action('Next'))
    await waitFor(() => expect(screen.getByTestId('draft-line').textContent).toContain('Not saved yet — we will try again.'))
    await user.click(action('Next'))
    await waitFor(() => expect(puts()).toHaveLength(2))
    // the first save proposed its generation (a random id); the next names it
    expect(puts()[0].gen).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(puts()[1]).toMatchObject({ rev: 1, gen: puts()[0].gen })
    await waitFor(() => expect(screen.getByTestId('draft-line').textContent).toContain('Saved'))
    expect(screen.queryByText('Your profile was changed in another window or on another device.')).toBeNull()
  })

  it('⛔ an ended session: "Sign in again" opens the sign-in, and the new session for this account loads at once', async () => {
    let n = 0
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: me }),
      'GET /api/teachers/me/draft': () => (++n === 1 ? { status: 401, json: { error: 'unauthorized' } } : { json: { draft: null } }),
    })
    vi.stubGlobal('fetch', f.fn)
    const r = render(ui())
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByTestId('draft-line').textContent).toContain('You are signed out — sign in again to keep saving.'))
    await user.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(auth.openSignIn).toHaveBeenCalled()
    auth.user = { id: 'u1' } // the sign-in landed: a new session, same account
    r.rerender(ui())
    await waitFor(() => expect(f.calls.filter((c) => c.method === 'GET' && c.url === '/api/teachers/me/draft')).toHaveLength(2))
    await waitFor(() => expect(screen.getByTestId('draft-line').textContent).not.toContain('signed out'))
  })

  it('⛔ a tab copy written under ANOTHER account never reaches this one — not shown, not offered, not saved; deleted unread', async () => {
    saved = { t: COMPLETE, step: 'teaching', rev: 2, updatedAt: AT, gen: GEN }
    sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'about', t: { ...COMPLETE, fullName: 'Someone Else', phone: '+84901111222' }, base: { uid: 'u9', rev: 4, gen: GEN }, owner: 'u9' }))
    mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use the answers I just gave instead' })).toBeNull()
    await waitFor(() => expect((storedDraft()?.t as { fullName?: string } | undefined)?.fullName).not.toBe('Someone Else'))
    expect(JSON.stringify(sessionStorage.getItem('eno.teacherDraft.v1'))).not.toContain('84901111222')
  })
})

describe('round-11 review cases (commit gate, 2026-10-12)', () => {
  const GEN = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
  const AT = '2026-10-10T08:00:00.000Z'
  it('⛔ another account\'s copy, and this account has NOTHING saved: an empty form — never their answers saved as this one\'s', async () => {
    saved = null
    sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'about', t: { ...COMPLETE, fullName: 'Someone Else' }, owner: 'u9' }))
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    expect(screen.queryByDisplayValue('Someone Else')).toBeNull()
    expect(sessionStorage.getItem('eno.teacherDraft.v1')).toBeNull()
    await user.click(screen.getByRole('radio', { name: 'Not in Vietnam yet' }))
    await user.click(action('Next'))
    await waitFor(() => expect(draftPuts()).toHaveLength(1))
    expect(JSON.stringify(draftPuts()[0])).not.toContain('Someone Else')
  })

  it('this account\'s own copy is put back once the session is known (a reload mid-step)', async () => {
    saved = { t: { ...COMPLETE, fullName: 'Saved Name' }, step: 'about', rev: 2, updatedAt: AT, gen: GEN }
    sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'about', t: { ...COMPLETE, fullName: 'Mine, Typed' }, base: { uid: 'u1', rev: 2, gen: GEN }, owner: 'u1' }))
    mount()
    expect(await screen.findByDisplayValue('Mine, Typed')).toBeTruthy()
    await waitFor(() => expect(draftPuts()).toHaveLength(1))
    expect(draftPuts()[0]).toMatchObject({ rev: 2, t: { fullName: 'Mine, Typed' } })
  })

  it('⛔ signed out, another account\'s copy: the form waits a few seconds for a late session — then it is deleted unread', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      auth.user = null
      sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'where', t: { ...COMPLETE, fullName: 'Someone Else' }, owner: 'u9' }))
      mount()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(sessionStorage.getItem('eno.teacherDraft.v1')).not.toBeNull() // still waiting for a late session
      await vi.advanceTimersByTimeAsync(5_000)
      await waitFor(() => expect(sessionStorage.getItem('eno.teacherDraft.v1')).toBeNull())
      expect(await screen.findByText('Where are you now?')).toBeTruthy()
      expect(screen.queryByRole('radio', { name: 'Not in Vietnam yet', checked: true })).toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('⛔ a sign-in opened within the grace of an abandoned round trip keeps its own mark and marker', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      auth.user = null
      history.replaceState(null, '', '/teachers/join?teacher_signin=1')
      sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'where', t: COMPLETE, signIn: Date.now() - 1_000 }))
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <LanguageProvider initialLang="en" initialViDict={{}}>
          <main><TeacherForm mode="join" draftHost={false} apexOrigin="https://eno.vn" /></main>
        </LanguageProvider>,
      )
      expect(await screen.findByText('Where are you now?')).toBeTruthy()
      await user.click(action('Sign in'))
      expect(auth.openSignIn).toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(6_000)
      expect(typeof storedDraft().signIn).toBe('number')
      expect(window.location.search).toBe('?teacher_signin=1')
    } finally { vi.useRealTimers() }
  })
})

describe('round-12 review cases (commit gate, 2026-10-12)', () => {
  const GEN = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
  const AT = '2026-10-10T08:00:00.000Z'
  it('⛔ a failed first load on an UNTOUCHED page, then a retry: the saved draft is loaded — never overwritten by the next tap', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let n = 0
      const f = fakeFetch({
        'GET /api/teachers/me': () => ({ json: me }),
        'GET /api/teachers/me/draft': () => (++n === 1
          ? { status: 503, json: { error: 'unavailable' } }
          : { json: { draft: { t: COMPLETE, step: 'teaching', rev: 5, gen: GEN, updatedAt: AT } } }),
      })
      vi.stubGlobal('fetch', f.fn)
      mount()
      await waitFor(() => expect(screen.getByTestId('draft-line').textContent).toContain('Not saved yet — we will try again.'))
      await vi.advanceTimersByTimeAsync(31_000)
      expect(await screen.findByText('What do you teach?')).toBeTruthy() // the saved draft, at its step
      expect(f.calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
    } finally { vi.useRealTimers() }
  })

  it('a Start over whose request stalls gives up after its timeout — said, nothing changed, the form free again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      saved = { t: COMPLETE, step: 'teaching', rev: 2, updatedAt: AT, gen: GEN }
      const base = fakeFetch({
        'GET /api/teachers/me': () => ({ json: me }),
        'GET /api/teachers/me/draft': () => ({ json: { draft: saved } }),
      })
      const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => (init?.method === 'DELETE'
        ? new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
        : base.fn(input, init)))
      vi.stubGlobal('fetch', fn)
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <LanguageProvider initialLang="en" initialViDict={{}}>
          <main><TeacherForm mode="join" draftHost={false} apexOrigin="https://eno.vn" /></main>
        </LanguageProvider>,
      )
      expect(await screen.findByText('What do you teach?')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Start over' }))
      await user.click(await screen.findByRole('button', { name: 'Start over' }))
      await vi.advanceTimersByTimeAsync(31_000)
      expect(await screen.findByText('Could not start over — please try again.')).toBeTruthy()
      expect(screen.getByText('What do you teach?')).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Start over' }) as HTMLButtonElement).disabled).toBe(false)
    } finally { vi.useRealTimers() }
  })
})

describe('round-13 review cases (commit gate, 2026-10-12)', () => {
  const GEN = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
  it('⛔ a reload with NOTHING changed is saved already — no new revision for another device to meet as a conflict', async () => {
    saved = { t: COMPLETE, step: 'teaching', rev: 2, updatedAt: '2026-10-10T08:00:00.000Z', gen: GEN }
    sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'teaching', t: COMPLETE, base: { uid: 'u1', rev: 2, gen: GEN }, owner: 'u1' }))
    mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 150))
    expect(draftPuts()).toHaveLength(0)
    expect(screen.getByTestId('draft-line').textContent).toContain('Saved to your account')
  })
})

describe('round-14 review cases (commit gate, 2026-10-12)', () => {
  it('⛔ a cut-off FIRST save that did not land, while another device made a draft with the same answers: never taken for ours', async () => {
    const THEIRS = '9c4d5e6f-7a8b-4c3d-9e4f-5a6b7c8d9e0f'
    let row: Record<string, unknown> | null = null
    const f = fakeFetch({
      'GET /api/teachers/me': () => ({ json: me }),
      'GET /api/teachers/me/draft': () => ({ json: { draft: row } }),
      'PUT /api/teachers/me/draft': (body) => {
        const b = body as { t: unknown; step: string; rev: number; gen?: string }
        if (b.rev === 0 && !row) {
          // ours never lands (answered without a revision); another device's identical first save does
          row = { t: b.t, step: b.step, rev: 1, gen: THEIRS, updatedAt: '2026-10-12T01:00:00.000Z' }
          return { json: {} }
        }
        if (row && b.rev === row.rev && b.gen === row.gen) return { json: { rev: (row.rev as number) + 1, gen: row.gen, updatedAt: '2026-10-12T01:00:00.000Z' } }
        return { status: 409, json: { error: 'draft_stale' } }
      },
    })
    vi.stubGlobal('fetch', f.fn)
    putDraft(COMPLETE, 'plans')
    const user = mount()
    expect(await screen.findByText('Where are you now?')).toBeTruthy()
    await user.click(action('Next'))
    await waitFor(() => expect(screen.getByTestId('draft-line').textContent).toContain('Not saved yet — we will try again.'))
    await user.click(action('Next'))
    // the check finds a draft of ANOTHER generation: not ours — the next save is refused as stale and the choice is asked
    expect(await screen.findByText('Your profile was changed in another window or on another device.')).toBeTruthy()
    const puts = f.calls.filter((c) => c.method === 'PUT').map((c) => c.body as { rev: number; gen?: string })
    expect(puts.every((p) => p.gen !== THEIRS)).toBe(true)
  })
})

describe('round-15 review cases (commit gate, 2026-10-12)', () => {
  const GEN = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
  const ui = () => (
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <main><TeacherForm mode="join" draftHost={false} apexOrigin="https://eno.vn" /></main>
    </LanguageProvider>
  )
  it('⛔ "Use the answers I just gave instead" with a step-1 hand-off keeps the saved later steps — never a blank saved over them', async () => {
    saved = { t: { ...COMPLETE, fullName: 'Saved Name' }, step: 'about', rev: 3, updatedAt: '2026-10-10T08:00:00.000Z', gen: GEN }
    history.replaceState(null, '', `/teachers/join#d=${b64url({ v: 2, t: { ...COMPLETE, jobTypes: ['parttime'] } })}`)
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Use the answers I just gave instead' }))
    await waitFor(() => expect(draftPuts()).toHaveLength(1))
    expect(draftPuts()[0].t).toMatchObject({ jobTypes: ['parttime'], fullName: 'Saved Name' })
  })

  it('a late session for the copy\'s OWN account, within the grace: put back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      auth.user = null
      sessionStorage.setItem('eno.teacherDraft.v1', JSON.stringify({ v: 5, savedAt: Date.now(), step: 'about', t: { ...COMPLETE, fullName: 'Mine, Late' }, owner: 'u1' }))
      const r = render(ui())
      await vi.advanceTimersByTimeAsync(2_000)
      auth.user = { id: 'u1' }
      r.rerender(ui())
      expect(await screen.findByDisplayValue('Mine, Late')).toBeTruthy()
    } finally { vi.useRealTimers() }
  })

  it('a Start over with a saved revision but no generation to name it by: nothing deleted — said', async () => {
    saved = { t: COMPLETE, step: 'teaching', rev: 2, updatedAt: '2026-10-10T08:00:00.000Z' }
    const user = mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    await user.click(await screen.findByRole('button', { name: 'Start over' }))
    expect(await screen.findByText('Could not start over — please try again.')).toBeTruthy()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })
})

describe('round-16 review cases (commit gate, 2026-10-12)', () => {
  it('⛔ a session that ended while a cut-off save is checked: "You are signed out" — no poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      saved = { t: COMPLETE, step: 'teaching', rev: 2, updatedAt: '2026-10-10T08:00:00.000Z', gen: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }
      let gets = 0
      const f = fakeFetch({
        'GET /api/teachers/me': () => ({ json: me }),
        'GET /api/teachers/me/draft': () => (++gets === 1 ? { json: { draft: saved } } : { status: 401, json: { error: 'unauthorized' } }),
        'PUT /api/teachers/me/draft': () => ({ json: {} }), // committed or not — the answer is lost
      })
      vi.stubGlobal('fetch', f.fn)
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <LanguageProvider initialLang="en" initialViDict={{}}>
          <main><TeacherForm mode="join" draftHost={false} apexOrigin="https://eno.vn" /></main>
        </LanguageProvider>,
      )
      expect(await screen.findByText('What do you teach?')).toBeTruthy()
      await user.click(action('Next'))
      await waitFor(() => expect(screen.getByTestId('draft-line').textContent).toContain('Not saved yet'))
      await user.click(action('Back')) // the next save checks first — and the session has ended
      await waitFor(() => expect(screen.getByTestId('draft-line').textContent).toContain('You are signed out — sign in again to keep saving.'))
      const before = f.calls.length
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      await act(async () => {})
      expect(f.calls.length).toBe(before) // nothing polls; a new session for the account tries again (sessionLostFor)
    } finally { vi.useRealTimers() }
  })
})

