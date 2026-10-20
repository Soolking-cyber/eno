// @vitest-environment jsdom
/**
 * /teachers/job-messages — the job-messages switch (owner, 2026-10-20). Pinned: signed out → a sign-in prompt and no
 * request; no teacher profile → the door to create one; the switch draws the SERVER's `current` and moves only on its
 * answer (never optimistic, disabled while a toggle is on its way); an ON carries the notice version THIS bundle shows,
 * an OFF nothing else; a stale page's 409 says "reload", a 429 says so, and an unclear failure re-reads the server and
 * says "could not save" only when the server really differs; an ON under an older notice reads OFF with its line.
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JOB_DM_NOTICE_VERSION } from '@/lib/teachers/job-dms/constants'

const { auth } = vi.hoisted(() => ({
  auth: { user: null as null | { id: string }, loading: false, openSignIn: vi.fn() },
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

import { JobMessagesPanel, jobDmRequest, jobDmViewOf } from './job-messages-panel'

type View = { on: boolean; noticeVersion: string | null; current: boolean; teacher: boolean; paused: boolean }
const OFF: View = { on: false, noticeVersion: null, current: false, teacher: true, paused: false }
const ON: View = { on: true, noticeVersion: JOB_DM_NOTICE_VERSION, current: true, teacher: true, paused: false }
const LABEL = 'Message me matching jobs and cover lessons in eno chat'

/** Queued answers, in order: GET reads and POST saves share the queue — each request takes the next. */
type Answer = { status: number; body: unknown } | 'network'
let answers: Answer[] = []
const requests: Array<{ method: string; body: unknown }> = []
/** A POST held open until the test releases it — to look at the page while a toggle is on its way. */
let hold: { release: () => void } | null = null
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url !== '/api/teachers/me/job-dms') throw new Error(`unexpected request: ${url}`)
  const method = init?.method ?? 'GET'
  requests.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null })
  if (method === 'POST' && hold) await new Promise<void>((r) => { hold!.release = r })
  const a = answers.shift()
  if (!a || a === 'network') throw new TypeError('Failed to fetch')
  return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body }
})
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const sw = () => screen.getByRole('switch', { name: LABEL })

beforeEach(() => {
  Object.assign(auth, { user: { id: 'p1' }, loading: false })
  auth.openSignIn.mockClear()
  answers = []
  requests.length = 0
  hold = null
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the job-messages page', () => {
  it('paused: the switch draws OFF with a line saying why; switching on resumes, and "stop completely" withdraws', async () => {
    const PAUSED = { ...ON, current: false, paused: true }
    answers = [{ status: 200, body: PAUSED }, { status: 200, body: { ...OFF, on: false, noticeVersion: JOB_DM_NOTICE_VERSION } }]
    render(<JobMessagesPanel />)
    await settle()
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('status').textContent).toContain('paused after one of your replies')
    fireEvent.click(screen.getByRole('button', { name: 'Stop job messages completely' }))
    await settle()
    expect(requests.at(-1)).toEqual({ method: 'POST', body: { on: false } })
  })

  it('signed out: a sign-in prompt — and no request', async () => {
    auth.user = null
    render(<JobMessagesPanel />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(auth.openSignIn).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('no teacher profile: the door to create one, and no switch to turn on', async () => {
    answers = [{ status: 200, body: { ...OFF, teacher: false } }]
    render(<JobMessagesPanel />)
    await settle()
    expect(screen.getByRole('link', { name: 'Create my teacher profile' }).getAttribute('href')).toBe('/teachers/join')
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('a switch still ON with no profile left stays offered — so it can always be switched off', async () => {
    answers = [{ status: 200, body: { ...ON, teacher: false } }]
    render(<JobMessagesPanel />)
    await settle()
    expect(screen.getByRole('link', { name: 'Create my teacher profile' })).toBeTruthy()
    expect(sw().getAttribute('aria-checked')).toBe('true')
  })

  it('shows the switch OFF with its notice — what it uses, where it runs, the caps, STOP — and the policy link', async () => {
    answers = [{ status: 200, body: OFF }]
    render(<JobMessagesPanel />)
    await settle()
    expect(sw().getAttribute('aria-checked')).toBe('false')
    const notice = screen.getByTestId('job-dm-notice').textContent ?? ''
    for (const s of [
      'shown in chat as “Alex · eno.vn”, may send you automatic messages',
      'Facebook teaching-job groups, LinkedIn job alerts, posts our team passes on and eno.vn’s own job listings',
      'on eno’s own server in Vietnam — no AI company outside Vietnam receives your profile for this',
      'English level, degree, certificate types, years of experience and expected salary',
      'your cover areas, free periods and hourly rate',
      'At most one jobs message and one cover-lesson message a day, with at most 5 jobs in each, and at most two messages until you reply',
      'Reply STOP, or switch this off here, at any time.',
    ]) expect(notice, s).toContain(s)
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy')
  })

  it('⛔ an ON sends the notice THIS page shows, and the switch moves only on the answer — disabled meanwhile', async () => {
    answers = [{ status: 200, body: OFF }, { status: 200, body: ON }]
    render(<JobMessagesPanel />)
    await settle()
    hold = { release: () => {} }
    fireEvent.click(sw())
    await settle()
    // On its way: still OFF (the server's last answer), and a second tap is dropped.
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(sw().hasAttribute('data-disabled')).toBe(true)
    fireEvent.click(sw())
    await act(async () => { hold!.release() })
    await settle()
    expect(requests.filter((r) => r.method === 'POST')).toEqual([{ method: 'POST', body: { on: true, notice: JOB_DM_NOTICE_VERSION } }])
    expect(sw().getAttribute('aria-checked')).toBe('true')
  })

  it('an OFF sends nothing but the switch', async () => {
    answers = [{ status: 200, body: ON }, { status: 200, body: { ...ON, on: false, current: false } }]
    render(<JobMessagesPanel />)
    await settle()
    fireEvent.click(sw())
    await settle()
    expect(requests[1]).toEqual({ method: 'POST', body: { on: false } })
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(jobDmRequest(false)).toEqual({ on: false })
  })

  it('⛔ a page that showed an older notice: 409 → "reload", the switch unchanged', async () => {
    answers = [{ status: 200, body: OFF }, { status: 409, body: { error: 'notice_changed', notice: 'job_dms' } }]
    render(<JobMessagesPanel />)
    await settle()
    fireEvent.click(sw())
    await settle()
    expect(screen.getByRole('alert').textContent).toMatch(/This page is out of date/)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(sw().getAttribute('aria-checked')).toBe('false')
  })

  it('429: said, the switch unchanged', async () => {
    answers = [{ status: 200, body: OFF }, { status: 429, body: { error: 'rate_limited' } }]
    render(<JobMessagesPanel />)
    await settle()
    fireEvent.click(sw())
    await settle()
    expect(screen.getByRole('alert').textContent).toMatch(/Too many changes/)
    expect(sw().getAttribute('aria-checked')).toBe('false')
  })

  it('⛔ an unclear failure re-reads the server: "could not save" only when it really differs', async () => {
    // The save failed and the server still says OFF.
    answers = [{ status: 200, body: OFF }, { status: 500, body: { error: 'internal_error' } }, { status: 200, body: OFF }]
    render(<JobMessagesPanel />)
    await settle()
    fireEvent.click(sw())
    await settle()
    expect(screen.getByRole('alert').textContent).toMatch(/could not save/)
    expect(sw().getAttribute('aria-checked')).toBe('false')
    cleanup()
    // The answer was lost but the save committed: no failure line — the switch simply shows it.
    answers = [{ status: 200, body: OFF }, 'network', { status: 200, body: ON }]
    render(<JobMessagesPanel />)
    await settle()
    fireEvent.click(sw())
    await settle()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(sw().getAttribute('aria-checked')).toBe('true')
  })

  it('an ON under an older notice reads OFF, with the line that says to switch it on again', async () => {
    answers = [{ status: 200, body: { on: true, noticeVersion: '2026-10-01', current: false, teacher: true } }]
    render(<JobMessagesPanel />)
    await settle()
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('status').textContent).toMatch(/has changed since you switched this on/)
  })

  it('a failed load offers a retry that reads again', async () => {
    answers = ['network', { status: 200, body: OFF }]
    render(<JobMessagesPanel />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await settle()
    expect(sw().getAttribute('aria-checked')).toBe('false')
  })

  it('jobDmViewOf takes the endpoint’s five fields and nothing that is not one', () => {
    expect(jobDmViewOf({ ...ON, extra: 1 })).toEqual(ON)
    for (const bad of [null, 'x', {}, { ...ON, on: 'true' }, { ...ON, noticeVersion: 5 }, { ...ON, teacher: undefined }]) {
      expect(jobDmViewOf(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})
