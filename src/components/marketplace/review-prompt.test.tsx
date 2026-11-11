// @vitest-environment jsdom
/**
 * The review card when the deal stopped counting after it was shown (a "No" from another device, a takedown): the
 * route answers 403 not_transacted, and retrying could never succeed — the card goes and says why (sweep, 2026-10-22).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const toastError = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }))

import { LanguageProvider } from '@/context/language-context'
import { ReviewPrompt } from './review-prompt'

const ui = () => (
  <LanguageProvider>
    <ReviewPrompt sellerId="s1" sellerName="Minh Shop" conversationId="c1" />
  </LanguageProvider>
)
const answer = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) } as Response)))

beforeEach(() => { toastError.mockReset(); toastSuccess.mockReset() })
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

// ── A SERVICE DEAL (src/lib/service-deal.ts, 2026-11-11): the seller confirmed a rental / lesson / service in the thread. ──
const dealUi = (dealKind: 'rental' | 'lesson' | 'service') => (
  <LanguageProvider>
    <ReviewPrompt sellerId="s1" sellerName="Minh Shop" conversationId="c1" dealKind={dealKind} />
  </LanguageProvider>
)
const QUESTION = { rental: 'Did you rent from Minh Shop?', lesson: 'Did you have a lesson with Minh Shop?', service: "Did you use Minh Shop's service?" }
/** The "No" answer (spec v3): the event, not the person — never the old "No, I didn't" / 'Không, chưa'. */
const NO_EN = 'No, this didn’t happen'
const NO_VI = 'Không, việc này không diễn ra'


describe('ReviewPrompt — a service deal asks "did you…?" first', () => {
  it.each(['rental', 'lesson', 'service'] as const)('%s: the question, then Yes opens the star form', async (kind) => {
    answer(201, { ok: true, id: 'r1' })
    render(dealUi(kind))
    expect(screen.getByText(QUESTION[kind])).toBeTruthy()
    expect(screen.queryByRole('radio', { name: '4 stars' })).toBeNull()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Yes, I did' }))
    expect(screen.getByText('How was your experience with Minh Shop?')).toBeTruthy()
    expect(screen.getByRole('radio', { name: '4 stars' })).toBeTruthy()
    cleanup()
  })

  it('No: POSTs the decline to the deal route, and the card goes for good', async () => {
    answer(200, { ok: true, state: 'declined' })
    render(dealUi('rental'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: NO_EN }))
    await waitFor(() => expect(screen.queryByText(QUESTION.rental)).toBeNull())
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('/api/conversations/c1/deal')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ action: 'decline' })
    expect(toastSuccess).toHaveBeenCalledWith('Thanks — noted. No review will be asked for this.')
  })

  it('a failed decline keeps the question to try again', async () => {
    answer(500, { error: 'internal_error' })
    render(dealUi('rental'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: NO_EN }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not send your answer — please try again.'))
    expect(screen.getByText(QUESTION.rental)).toBeTruthy()
  })

  it.each(['not_reviewable', 'blocked', 'not_found'])('a decline refused with %s (it cannot change by asking again): the card goes, it never sticks', async (code) => {
    answer(403, { error: code })
    const { container } = render(dealUi('rental'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: NO_EN }))
    await waitFor(() => expect(screen.queryByText(QUESTION.rental)).toBeNull())
    expect(container.textContent).not.toContain(QUESTION.rental)
  })

  it('403 deal_withdrawn: the card goes, naming who withdrew', async () => {
    answer(403, { error: 'deal_withdrawn' })
    render(dealUi('rental'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Yes, I did' }))
    await user.click(screen.getByRole('radio', { name: '4 stars' }))
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.queryByText('How was your experience with Minh Shop?')).toBeNull())
    expect(toastError).toHaveBeenCalledWith("Minh Shop withdrew the confirmation, so a review can't be left now.")
  })

  it('403 review_window_closed: the card goes, with its own reason', async () => {
    answer(403, { error: 'review_window_closed' })
    render(dealUi('service'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Yes, I did' }))
    await user.click(screen.getByRole('radio', { name: '4 stars' }))
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('The time to leave this review has passed.'))
    expect(screen.queryByText('How was your experience with Minh Shop?')).toBeNull()
  })

  it('no dealKind (a goods sale / accepted offer): no question, the star form at once', () => {
    render(ui())
    expect(screen.queryByRole('button', { name: 'Yes, I did' })).toBeNull()
    expect(screen.getByRole('radio', { name: '4 stars' })).toBeTruthy()
  })

  it('⛔ focus follows the "Yes": it lands IN the star rating group (its tab stop), and no star is checked by it', async () => {
    render(dealUi('rental'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Yes, I did' }))
    const group = screen.getByRole('radiogroup', { name: 'Rating' })
    await waitFor(() => expect(group.contains(document.activeElement)).toBe(true))
    expect(document.activeElement?.getAttribute('role')).toBe('radio')
    for (const star of screen.getAllByRole('radio')) expect(star.getAttribute('aria-checked')).toBe('false')
    // …and from there the keyboard rates: the arrow keys move within the group.
    await user.keyboard('{ArrowRight}')
    expect(group.contains(document.activeElement)).toBe(true)
  })

  it('…but a goods card opening on its own never takes focus (the composer keeps it)', () => {
    render(ui())
    expect(screen.getByRole('radiogroup', { name: 'Rating' }).contains(document.activeElement)).toBe(false)
  })
})

describe('ReviewPrompt — spec v3 wording and the service-deal refusals', () => {
  const submitFor = async (status: number, body: unknown, kind: 'rental' | 'lesson' | 'service' | null = 'rental') => {
    answer(status, body)
    render(kind ? dealUi(kind) : ui())
    const user = userEvent.setup()
    if (kind) await user.click(screen.getByRole('button', { name: 'Yes, I did' }))
    await user.click(screen.getByRole('radio', { name: '4 stars' }))
    await user.click(screen.getByRole('button', { name: 'Submit' }))
  }

  it('the No reads "No, this didn’t happen" / "Không, việc này không diễn ra" — never "No, I didn\'t" / "Không, chưa"', () => {
    render(dealUi('lesson'))
    expect(screen.getByRole('button', { name: NO_EN })).toBeTruthy()
    expect(screen.queryByRole('button', { name: "No, I didn't" })).toBeNull()
    cleanup()
    render(
      <LanguageProvider initialLang="vi" initialViDict={{}}>
        <ReviewPrompt sellerId="s1" sellerName="Minh Shop" conversationId="c1" dealKind="lesson" />
      </LanguageProvider>,
    )
    expect(screen.getByRole('button', { name: NO_VI })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Không, chưa' })).toBeNull()
  })

  it('403 deal_declined: the card goes, with service-neutral words', async () => {
    await submitFor(403, { error: 'deal_declined' })
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('You said this didn’t happen, so it can’t be reviewed.'))
    expect(screen.queryByText('How was your experience with Minh Shop?')).toBeNull()
  })

  it('403 not_transacted on a SERVICE deal: service-neutral words, never the goods sentence', async () => {
    await submitFor(403, { error: 'not_transacted' }, 'service')
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('This can no longer be reviewed from this chat.'))
    expect(toastError).not.toHaveBeenCalledWith('Only the buyer of this item can review the seller.')
  })

  it('403 not_transacted on a goods card keeps the goods sentence', async () => {
    await submitFor(403, { error: 'not_transacted' }, null)
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Only the buyer of this item can review the seller.'))
  })

  it('403 review_not_open (the undo still open): its own words, and the card STAYS with the stars kept', async () => {
    await submitFor(403, { error: 'review_not_open' })
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Minh Shop can still undo the confirmation for a few minutes — please try again shortly.'))
    expect(screen.getByText('How was your experience with Minh Shop?')).toBeTruthy()
    expect((screen.getByRole('radio', { name: '4 stars' }) as HTMLElement).getAttribute('aria-checked')).toBe('true')
  })

  it('a "No" refused with review_not_open keeps the question, with the same words', async () => {
    answer(403, { error: 'review_not_open' })
    render(dealUi('rental'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: NO_EN }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Minh Shop can still undo the confirmation for a few minutes — please try again shortly.'))
    expect(screen.getByText(QUESTION.rental)).toBeTruthy()
  })
})
