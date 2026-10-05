// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

// ── <ReportContentButton> — Report on a review / help reply / help post (gate `ugc-safety`, R5) ────────

vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ openSignIn: vi.fn() }) }))

import { ReportContentButton } from './report-content-button'

const fetchMock = vi.fn()
function mount(props: React.ComponentProps<typeof ReportContentButton>) {
  return render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <ReportContentButton {...props} />
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

describe('ReportContentButton', () => {
  it('renders NOTHING while the gate is off', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const { container } = mount({ kind: 'review', id: 'cmreview0000001' })
    expect(container.textContent).toBe('')
  })

  it('mounts no dialog until tapped, then reports the REVIEW (never its author) with the content reasons only', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true, id: 'case-1' }) })
    mount({ kind: 'review', id: 'cmreview0000001' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Report/ }))
    expect(await screen.findByRole('dialog', { name: 'Report this review' })).toBeTruthy()
    // A review cannot be "sold", a "duplicate listing" or "counterfeit" — the chat subset applies.
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Scam', 'Offensive / harassment', 'Other'])
    fireEvent.click(screen.getByRole('radio', { name: 'Offensive / harassment' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit report' })) })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/report')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reviewId: 'cmreview0000001', reason: 'offensive' })
    expect(await screen.findByText('Report sent')).toBeTruthy()
  })

  it('names a help reply as commentId and a help post as postId', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true }) })
    mount({ kind: 'help-comment', id: 'cmcomment000001' })
    fireEvent.click(screen.getByRole('button', { name: /Report/ }))
    expect(await screen.findByRole('dialog', { name: 'Report this reply' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Other' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit report' })) })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ commentId: 'cmcomment000001', reason: 'other' })
  })

  it('says so when it is your own content', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'cannot_report_self' }) })
    mount({ kind: 'help-post', id: 'cmpost000000001' })
    fireEvent.click(screen.getByRole('button', { name: /Report/ }))
    await screen.findByRole('dialog', { name: 'Report this post' })
    fireEvent.click(screen.getByRole('radio', { name: 'Other' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit report' })) })
    expect((await screen.findByRole('alert')).textContent).toBe('You can’t report something you wrote yourself.')
  })
})
