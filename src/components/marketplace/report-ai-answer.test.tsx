// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { ReportAiAnswer } from './report-ai-answer'

// ── <ReportAiAnswer> — Report under an eno AI answer (Google Play, AI-Generated Content; gate `ugc-safety`) ──

const fetchMock = vi.fn()
const ANSWER = 'Try District 7 — it is quiet.'
function mount() {
  return render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <ReportAiAnswer answer={ANSWER} />
    </LanguageProvider>,
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('ReportAiAnswer', () => {
  it('renders NOTHING while the gate is off', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect(mount().container.textContent).toBe('')
  })

  it('mounts no dialog until tapped, then files THE ANSWER as Feedback of kind "ai", with the reason and the note', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    mount()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Report/ }))
    expect(await screen.findByRole('dialog', { name: 'Report this answer' })).toBeTruthy()
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Offensive or harmful', 'Wrong or misleading', 'Something else'])
    fireEvent.click(screen.getByRole('radio', { name: 'Wrong or misleading' }))
    fireEvent.change(screen.getByPlaceholderText('Details (optional)'), { target: { value: 'D7 is not quiet' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit report' })) })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/feedback')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.kind).toBe('ai')
    expect(body.message).toBe(`Reported in eno AI chat: wrong\n\nD7 is not quiet\n\nThe answer:\n${ANSWER}`)
    expect(await screen.findByText('Report sent')).toBeTruthy()
  })

  it('sends nothing without a reason, and says so when the server did not take it — the form stays to try again', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Report/ }))
    await screen.findByRole('dialog', { name: 'Report this answer' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit report' })) })
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'Offensive or harmful' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit report' })) })
    expect((await screen.findByRole('alert')).textContent).toBe('Could not send — please try again.')
    expect(screen.getByRole('button', { name: 'Submit report' })).toBeTruthy()
  })
})
