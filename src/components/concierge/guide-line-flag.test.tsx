// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { GuideLineFlag } from './guide-line-flag'

// ── The voice guide's one-tap Report on its line (Google Play, AI-Generated Content; gate `ugc-safety`) ─────────

const fetchMock = vi.fn()
const LINE = 'District 7 is quiet and close to the river.'
const ui = (line: string) => (
  <LanguageProvider initialLang="en" initialViDict={{}}>
    <GuideLineFlag line={line} href={() => '/listings/abc?x=1'} />
  </LanguageProvider>
)
const filed = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('GuideLineFlag', () => {
  it('renders NOTHING while the gate is off', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect(render(ui(LINE)).container.textContent).toBe('')
  })

  it('one tap files THE LINE as Feedback of kind "ai" with the page under the guide; "Reported" beside the flag for a moment', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    fetchMock.mockResolvedValue({ ok: true, status: 201 })
    render(ui(LINE))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Report this answer' })) })
    await vi.waitFor(() => expect(screen.getByText('Reported')).toBeTruthy())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/feedback')
    expect(filed()).toEqual([{ kind: 'ai', message: `Reported in the voice guide\n\nThe answer:\n${LINE}`, url: '/listings/abc?x=1' }])
    // The flag stays, for whatever is on screen next — a new line is never left without one (codex, round 4).
    const again = screen.getByRole('button', { name: 'Report this answer' })
    expect(again.hasAttribute('disabled') || again.getAttribute('aria-disabled') === 'true').toBe(false)
    act(() => { vi.advanceTimersByTime(4_000) })
    expect(screen.queryByText('Reported')).toBeNull()
  })

  it('not sent: says so on screen, and the flag stays to try again', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    fetchMock.mockResolvedValue({ ok: false, status: 429 })
    render(ui(LINE))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Report this answer' })) })
    await vi.waitFor(() => expect(screen.getByText('Not sent')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Not sent — report this answer again' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(4_000) })
    expect(screen.queryByText('Not sent')).toBeNull()
  })

  it('while a report is on its way the flag waits: a second tap sends nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    let answer!: (v: unknown) => void
    fetchMock.mockReturnValue(new Promise((r) => { answer = r }))
    render(ui(LINE))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Report this answer' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Report this answer' })) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { answer({ ok: true, status: 201 }) })
    await vi.waitFor(() => expect(screen.getByText('Reported')).toBeTruthy())
  })

  it('files whatever is on screen when tapped', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    fetchMock.mockResolvedValue({ ok: true, status: 201 })
    const { rerender } = render(ui('First sentence.'))
    rerender(ui('First sentence. Second sentence.'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Report this answer' })) })
    expect(filed()[0].message).toBe('Reported in the voice guide\n\nThe answer:\nFirst sentence. Second sentence.')
  })
})
