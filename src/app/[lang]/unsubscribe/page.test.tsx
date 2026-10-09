// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// /unsubscribe — the teacher job-match emails are their OWN list with their own words (plan review E3): never the
// weekly digest's copy, and never a one-tap re-subscribe (turning them back on is a consent to AI matching, given in the
// teacher profile, where the AI notice is shown). The digest's page is unchanged.
let query = ''
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query) }))

import { LanguageProvider } from '@/context/language-context'
import UnsubscribePage from './page'

const calls: { url: string; body: unknown }[] = []
let status = 200
beforeEach(() => {
  calls.length = 0
  status = 200
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify(status === 200 ? { ok: true, optIn: false } : { error: 'invalid_token' }), { status })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'languages') })

function open(q: string, lang: 'en' | 'vi' = 'en') {
  query = q
  // The provider's mount effect reconciles to the browser's languages: make them agree with the variant under test.
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => (lang === 'vi' ? ['vi-VN', 'vi'] : ['en-US', 'en']) })
  return render(<LanguageProvider initialLang={lang} initialViDict={{}}><UnsubscribePage /></LanguageProvider>)
}

describe('/unsubscribe — teacher job-match emails', () => {
  it('names the match emails — never the weekly digest — and unsubscribes that list only', async () => {
    const { container } = open('token=t1&list=teacher-matches')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Stop teaching-job match emails?')
    expect(container.textContent).not.toMatch(/weekly/i)
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    await waitFor(() => expect(screen.getByText('You won’t get teaching-job match emails anymore.')).toBeTruthy())
    expect(calls).toEqual([{ url: '/api/unsubscribe?token=t1&list=teacher-matches', body: { optIn: false } }])
    expect(container.textContent).not.toMatch(/weekly/i)
  })

  it('⛔ offers NO re-subscribe button — the way back is the teacher profile', async () => {
    open('token=t1&list=teacher-matches')
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Turn them back on in your teacher profile' })).toBeTruthy())
    expect(screen.getByRole('link', { name: 'Turn them back on in your teacher profile' }).getAttribute('href')).toBe('/teachers/edit')
    expect(screen.queryByRole('button', { name: /re-subscribe/i })).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('⚠️ a 409 retry (or no answer) is OURS: "try again" — never "invalid or expired" for a link that works (commit gate, 2026-10-09)', async () => {
    status = 409
    open('token=t1&list=teacher-matches')
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    await waitFor(() => expect(screen.getByText("That didn't go through")).toBeTruthy())
    expect(screen.queryByText(/invalid or expired/)).toBeNull()
    status = 200
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByText('You won’t get teaching-job match emails anymore.')).toBeTruthy())
    expect(calls.map((c) => c.body)).toEqual([{ optIn: false }, { optIn: false }])
  })

  it('a dead link points to the teacher profile, not to account settings', async () => {
    status = 404
    open('token=bad&list=teacher-matches')
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    await waitFor(() => expect(screen.getByText(/turn teaching-job match emails off in your teacher profile/)).toBeTruthy())
    expect(screen.getByRole('link', { name: 'Open my teacher profile' }).getAttribute('href')).toBe('/teachers/edit')
  })

  it('reads in Vietnamese on the Vietnamese variant', () => {
    open('token=t1&list=teacher-matches', 'vi')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ngừng nhận email gợi ý việc làm giảng dạy?')
  })
})

describe('/unsubscribe — the weekly digest is unchanged', () => {
  it('keeps its own copy and its re-subscribe', async () => {
    open('token=t1')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Unsubscribe from the weekly digest?')
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Re-subscribe' })).toBeTruthy())
    expect(calls[0].url).toBe('/api/unsubscribe?token=t1')
  })
})
