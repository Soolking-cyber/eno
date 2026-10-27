// @vitest-environment jsdom
/**
 * /teachers/check-in — the teachers' weekly check-in (owner, 2026-10-27: "are you still looking for a job or still
 * available for cover, no sold there"). Pinned: the question follows the profile; "Yes" is one POST and the page then
 * shows the server's state; there is no "sold" anywhere; "hide my profile" sends NOTHING until its confirm says what it
 * does and is accepted — then it is the Visibility switch (PATCH status hidden), never a sale; a hidden profile shows
 * what that means, not the question; signed out → a sign-in prompt and no request.
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { auth } = vi.hoisted(() => ({
  auth: { user: null as null | { id: string }, loading: false, openSignIn: vi.fn() },
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

import { CheckInPanel, checkInViewOf } from './check-in-panel'

const LIVE = { teacher: true, live: true, hidden: false, jobTypes: ['fulltime'], coverOpen: true, coverSlots: ['mon-am'], confirmedAt: null }
type Answer = { status: number; body: unknown }
let answers: Answer[] = []
const requests: Array<{ url: string; method: string; body: unknown }> = []
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  requests.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
  const a = answers.shift()
  if (!a) throw new TypeError('Failed to fetch')
  return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body }
})
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => {
  Object.assign(auth, { user: { id: 'p1' }, loading: false })
  auth.openSignIn.mockClear()
  answers = []
  requests.length = 0
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the weekly check-in page', () => {
  it('asks in the profile\'s terms, shows what it offers, and never offers "sold"', async () => {
    answers = [{ status: 200, body: LIVE }]
    render(<CheckInPanel />)
    await settle()
    expect(screen.getByRole('heading', { name: 'Still looking for a teaching job — and free for cover lessons?' })).toBeTruthy()
    expect(document.body.textContent).toContain('Full-time')
    expect(document.body.textContent).toContain('Monday morning')
    expect(document.body.textContent).not.toMatch(/sold/i)
  })

  it('"Yes" is one POST to the check-in, then the page shows the thanks from the server\'s answer', async () => {
    answers = [{ status: 200, body: LIVE }, { status: 200, body: { ok: true } }, { status: 200, body: { ...LIVE, confirmedAt: '2026-10-28T02:00:00.000Z' } }]
    render(<CheckInPanel />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, I’m still available' }))
    await settle()
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual(['GET /api/teachers/me/check-in', 'POST /api/teachers/me/check-in', 'GET /api/teachers/me/check-in'])
    expect(screen.getByRole('status').textContent).toContain('your profile stays up')
  })

  it('"Yes" refused (the profile went down meanwhile): no thanks — the line says why', async () => {
    answers = [{ status: 200, body: LIVE }, { status: 409, body: { error: 'teacher_profile_not_live' } }, { status: 200, body: { ...LIVE, live: false } }]
    render(<CheckInPanel />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, I’m still available' }))
    await settle()
    expect(document.body.textContent).not.toContain('your profile stays up')
    expect(screen.getByRole('alert').textContent).toContain('nothing to confirm')
  })

  it('"Yes" refused while the re-read fails: the line, and no live question or "Yes" left beside it', async () => {
    answers = [{ status: 200, body: LIVE }, { status: 409, body: { error: 'teacher_profile_not_live' } }]
    render(<CheckInPanel />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, I’m still available' }))
    await settle()
    expect(screen.getByRole('alert').textContent).toContain('nothing to confirm')
    expect(screen.queryByRole('button', { name: 'Yes, I’m still available' })).toBeNull()
  })

  it('"hide my profile" sends nothing until its confirm is accepted; then the Visibility switch, never a sale', async () => {
    answers = [{ status: 200, body: LIVE }]
    render(<CheckInPanel />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Not available now — hide my profile' }))
    await settle()
    expect(requests).toHaveLength(1)
    expect(screen.getByRole('alertdialog').textContent).toContain('Nothing is deleted')
    fireEvent.click(screen.getByRole('button', { name: 'Keep it visible' }))
    await settle()
    expect(requests).toHaveLength(1)

    answers = [{ status: 200, body: { ok: true, status: 'hidden' } }, { status: 200, body: { ...LIVE, live: false, hidden: true } }]
    fireEvent.click(screen.getByRole('button', { name: 'Not available now — hide my profile' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Hide my profile' }))
    await settle()
    expect(requests[1]).toEqual({ url: '/api/teachers/me/status', method: 'PATCH', body: { status: 'hidden' } })
    expect(screen.getByRole('status').textContent).toContain('Your profile is hidden')
  })

  it('a hide that went through while the re-read failed: drawn hidden — no live question, no "Yes" left behind', async () => {
    answers = [{ status: 200, body: LIVE }, { status: 200, body: { ok: true, status: 'hidden' } }]
    render(<CheckInPanel />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Not available now — hide my profile' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Hide my profile' }))
    await settle()
    expect(screen.queryByRole('button', { name: 'Yes, I’m still available' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Your profile is hidden')
  })

  it('a hidden profile: what that means and the way to the profile — not the question', async () => {
    answers = [{ status: 200, body: { ...LIVE, live: false, hidden: true } }]
    render(<CheckInPanel />)
    await settle()
    expect(screen.queryByRole('button', { name: 'Yes, I’m still available' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Your profile is hidden')
    expect(screen.getByRole('link', { name: 'Change my details' }).getAttribute('href')).toBe('/teachers/edit')
  })

  it('signed out: a sign-in prompt — and no request', async () => {
    auth.user = null
    render(<CheckInPanel />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(auth.openSignIn).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checkInViewOf rejects a body that is not a view (a proxy page, an error body)', () => {
    expect(checkInViewOf({ error: 'x' })).toBeNull()
    expect(checkInViewOf(LIVE)).toEqual(LIVE)
  })
})
