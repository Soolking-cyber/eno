// @vitest-environment jsdom
/**
 * The review card when the deal stopped counting after it was shown (a "No" from another device, a takedown): the
 * route answers 403 not_transacted, and retrying could never succeed — the card goes and says why (sweep, 2026-10-22).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }))

import { LanguageProvider } from '@/context/language-context'
import { ReviewPrompt } from './review-prompt'

const ui = () => (
  <LanguageProvider>
    <ReviewPrompt sellerId="s1" sellerName="Minh Shop" conversationId="c1" />
  </LanguageProvider>
)
const answer = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) } as Response)))

beforeEach(() => { toastError.mockReset() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ReviewPrompt — a refused deal', () => {
  it('403 not_transacted: the card goes, with the reason', async () => {
    answer(403, { error: 'not_transacted' })
    render(ui())
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: '4 stars' }))
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.queryByText('How was your experience with Minh Shop?')).toBeNull())
    expect(toastError).toHaveBeenCalledWith('Only the buyer of this item can review the seller.')
  })

  it('any other failure keeps the card to try again', async () => {
    answer(500, { error: 'internal' })
    render(ui())
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: '4 stars' }))
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not submit your review — please try again.'))
    expect(screen.getByText('How was your experience with Minh Shop?')).toBeTruthy()
  })
})
