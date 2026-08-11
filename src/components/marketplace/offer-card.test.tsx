// @vitest-environment jsdom
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import { OFFER } from '@/lib/offers'
import { OfferCard, type OfferCardProps } from './offer-card'

/**
 * THE OFFER CARD — the five things a screenshot cannot show and production would.
 *
 *  1. THE HYDRATION GATE. The countdown is a client-clock value on a page that can be cached, so
 *     the SERVER markup must contain no clock at all, and a 25-hour-old offer must render
 *     byte-identically to a fresh one server-side. That is asserted against real
 *     renderToStaticMarkup output, not by reading the component.
 *  2. THE COUNTER GATE. On a fixed-price listing, Counter must not exist — the send route answers
 *     409 not_negotiable and recordFixedPriceOfferAttempt() docks the BUYER's trust for a button
 *     we drew.
 *  3. THE ACCESSIBLE NAMES. Three buttons announced as "Accept" in a thread of several offers tell
 *     a screen-reader user nothing about which price they are agreeing to.
 *  4. THE MONEY. Vietnamese reads 12.000.000 đ; a comma there is a different number.
 *  5. THE SAFETY LINE, which must appear for BOTH parties on agreement and cannot be an
 *     English-only string.
 *
 * ⚠️ EXPLICIT CLEANUP — this suite does not run with vitest `globals: true`, so Testing Library
 * never registers its own afterEach. Without it the second render in the file fails with
 * "Found multiple elements". (Same note as count-chip.test.tsx; any new component test needs it.)
 */
afterEach(cleanup)

/**
 * ⚠️ THE LANGUAGE IS DRIVEN THROUGH `setLang`, NOT localStorage — the provider's mount effect
 * reads localStorage, but under this vitest/jsdom combination `window.localStorage` has no
 * getItem/setItem at all, so a stored preference is silently swallowed and every "vi" assertion
 * would have run in English. Same harness, and same reason, as count-chip.test.tsx.
 */
function clearLangPref() {
  try {
    window.localStorage?.removeItem?.('lang')
  } catch {
    /* no usable storage in this environment — nothing to clear */
  }
}
beforeEach(clearLangPref)
afterEach(clearLangPref)

function LangSwitch({ to }: { to: Language }) {
  const { lang, setLang } = useLanguage()
  React.useEffect(() => {
    if (lang !== to) setLang(to)
  }, [lang, to, setLang])
  return null
}

const NOW = Date.parse('2026-08-11T09:00:00.000Z')
const HOUR = 60 * 60 * 1000

/** A live offer from the other party: 12,000,000 ₫ on a 15,000,000 ₫ negotiable listing.
 *  The three world facts are REQUIRED props, so this fixture must state all of them — that is
 *  the compile-time replacement for the permissive folds two reviewers refuted. */
function props(over: Partial<OfferCardProps> = {}): OfferCardProps {
  return {
    amount: 12_000_000,
    mine: false,
    status: 'pending',
    createdAt: new Date(NOW - HOUR).toISOString(),
    askingPrice: 15_000_000,
    negotiable: true,
    listingActive: true,
    threadHasAcceptedOffer: false,
    onAccept: () => {},
    onDecline: () => {},
    onCounter: () => {},
    ...over,
  }
}

function renderIn(lang: Language, p: OfferCardProps) {
  return render(
    <LanguageProvider>
      <LangSwitch to={lang} />
      <OfferCard {...p} />
    </LanguageProvider>,
  )
}

/** Server-side markup, exactly as it would be baked into a cached page.
 *
 *  ⚠️ NO LangSwitch, AND THAT IS NOT AN OVERSIGHT. LanguageProvider initialises to 'en' and picks
 *  up a stored/device preference in a mount EFFECT, which never runs during a server render — so
 *  'en' is not merely this test's default, it is what every server render of this component
 *  produces, in every locale. There is no Vietnamese SSR output to assert against. */
function ssr(p: OfferCardProps) {
  return renderToStaticMarkup(
    <LanguageProvider>
      <OfferCard {...p} />
    </LanguageProvider>,
  )
}

// The clock is frozen for every DOM test: the card reads Date.now() in its mount effect, and a
// countdown asserted against a moving clock is a flake waiting for a slow CI box.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the hydration gate on the countdown', () => {
  it('the SERVER markup carries no clock at all', () => {
    const html = ssr(props())
    expect(html).toContain('12,000,000')
    expect(html).not.toContain('Expires in')
    expect(html).not.toContain('Offer expired')
  })

  it('a LAPSED offer renders identically to a live one on the server — which is what makes hydration match', () => {
    // ⚠️ THE REGRESSION THIS EXISTS FOR: resolving expiry during render bakes the generation-time
    // answer into a cached page, and the reader's clock disagrees. Element appearing/disappearing
    // is a structural mismatch that suppressHydrationWarning does not cover.
    const live = ssr(props({ createdAt: new Date(NOW - HOUR).toISOString() }))
    const lapsed = ssr(props({ createdAt: new Date(NOW - 25 * HOUR).toISOString() }))
    expect(lapsed).toBe(live)
  })

  it('⚠️ ships NO CLOCK-DERIVED STATUS either — a lapsed offer must not read "Pending" in cached HTML', () => {
    // The second draft suppressed the buttons and the countdown and still baked the amber Pending
    // pill into the markup, so a three-day-old offer looked live indefinitely to a reader on a
    // slow connection or with JS off. Suppressing two thirds of a clock is not suppressing it.
    const html = ssr(props({ createdAt: new Date(NOW - 25 * HOUR).toISOString() }))
    expect(html).not.toContain('Pending')
    expect(html).not.toContain('Waiting for a response')
    expect(html).not.toContain('fill-brand')
  })

  it('still renders a RESOLVED status server-side, because that one is not the clock', () => {
    expect(ssr(props({ status: 'accepted' }))).toContain('Accepted')
    expect(ssr(props({ status: 'declined' }))).toContain('Declined')
  })

  it('ships NO controls in the server markup at all', () => {
    // Two reviewers flagged the first draft for baking live-looking Accept/Decline into cached
    // HTML for a lapsed offer, retracted only after hydration. Gating the controls on mount
    // closes it — and a reader with no JavaScript is no longer shown three buttons whose whole
    // behaviour is an onClick handler.
    const html = ssr(props())
    expect(html).not.toContain('<button')
  })

  it('after mount the clock arrives and the lapsed offer retracts its controls', () => {
    renderIn('en', props({ createdAt: new Date(NOW - 25 * HOUR).toISOString() }))
    expect(screen.queryByRole('button', { name: /Accept/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Decline/ })).toBeNull()
    expect(screen.getByText(/Offer expired/)).toBeTruthy()
  })

  it('a live offer shows the remaining window, in both units so it never understates it', () => {
    renderIn('en', props({ createdAt: new Date(NOW - HOUR - 15 * 60_000).toISOString() }))
    // 24h window, 1h15m elapsed → 22h 45m left.
    expect(screen.getByText(/Expires in/).textContent).toContain('22h 45m')
  })

  it('renders the Vietnamese countdown with the Vietnamese units', () => {
    renderIn('vi', props({ createdAt: new Date(NOW - HOUR - 15 * 60_000).toISOString() }))
    expect(screen.getByText(/Hết hạn sau/).textContent).toContain('22 giờ 45 phút')
  })

  it('does not put a clock on a resolved offer — an accepted deal has no deadline', () => {
    renderIn('en', props({ status: 'accepted', createdAt: new Date(NOW - 90 * HOUR).toISOString() }))
    expect(screen.queryByText(/Expires in/)).toBeNull()
    expect(screen.queryByText(/Offer expired/)).toBeNull()
    expect(screen.getByText(/Accepted/)).toBeTruthy()
  })

  it('the window is 24 hours', () => {
    expect(OFFER.TTL_MS).toBe(24 * HOUR)
  })
})

describe('the countdown timer is scoped to a live offer', () => {
  // ⚠️ THE REGRESSION THIS EXISTS FOR: the first draft started an unconditional 30s interval in
  // every card. A haggled-over thread holds dozens of resolved offers, so opening it spawned
  // dozens of permanent timers waking forever to re-render components that can never change.
  it('starts one timer for a pending offer', () => {
    const before = vi.getTimerCount()
    renderIn('en', props())
    expect(vi.getTimerCount()).toBeGreaterThan(before)
  })

  it.each(['accepted', 'declined', 'countered'])('starts NO timer for a %s offer', (status) => {
    const before = vi.getTimerCount()
    renderIn('en', props({ status }))
    expect(vi.getTimerCount()).toBe(before)
  })

  it('starts NO timer for an offer whose window has already closed', () => {
    const before = vi.getTimerCount()
    renderIn('en', props({ createdAt: new Date(NOW - 25 * HOUR).toISOString() }))
    expect(screen.getByText(/Offer expired/)).toBeTruthy()
    expect(vi.getTimerCount()).toBe(before)
  })

  it('stops ticking once a live offer lapses, rather than waking forever', () => {
    // Two minutes left: the timer must retire itself at the deadline, not keep running.
    renderIn('en', props({ createdAt: new Date(NOW - OFFER.TTL_MS + 2 * 60_000).toISOString() }))
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    // act() so the wake's setNow is flushed — advancing the clock without it fires the callback
    // but leaves React un-rendered, and the assertion below would read a stale DOM.
    act(() => {
      vi.advanceTimersByTime(3 * 60_000)
    })
    expect(screen.getByText(/Offer expired/)).toBeTruthy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('⚠️ RETRACTS THE CONTROLS ON THE DEADLINE, NOT UP TO A TICK LATE', () => {
    // A fixed 30s interval noticed expiry only on its next wake, so Accept stayed live for most
    // of a minute past a window whose entire purpose is that it closes. The last wake is
    // scheduled for the remaining time, so 40 seconds before the deadline the card is live and
    // one second after it, it is not.
    renderIn('en', props({ createdAt: new Date(NOW - OFFER.TTL_MS + 40_000).toISOString() }))
    expect(screen.getByRole('button', { name: /^Accept/ })).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(41_000)
    })
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull()
    expect(screen.getByText(/Offer expired/)).toBeTruthy()
  })

  it('says the last minute in words rather than showing "0m" beside live controls', () => {
    renderIn('en', props({ createdAt: new Date(NOW - OFFER.TTL_MS + 30_000).toISOString() }))
    expect(screen.getByText(/Expires in/).textContent).toContain('under a minute')
    expect(screen.getByRole('button', { name: /^Accept/ })).toBeTruthy()
  })
})

describe('three taps, no typing', () => {
  it('gives the recipient three real controls whose accessible names carry the amount', () => {
    renderIn('en', props())
    for (const label of ['Accept', 'Decline', 'Counter']) {
      const btn = screen.getByRole('button', { name: new RegExp(`^${label} — `) })
      expect(btn.textContent).toBe(label)
      // The price is in the accessible name, not only in the line above it.
      expect(btn.getAttribute('aria-label')).toContain('12,000,000')
    }
  })

  it('⚠️ HIDES COUNTER ON A FIXED-PRICE LISTING — the button that docks the buyer trust', () => {
    renderIn('en', props({ negotiable: false }))
    expect(screen.queryByRole('button', { name: /^Counter/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Accept/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Decline/ })).toBeTruthy()
  })

  it('never renders a control it has no handler for — a dead button looks alive', () => {
    renderIn('en', { ...props(), onCounter: undefined })
    expect(screen.queryByRole('button', { name: /^Counter/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Accept/ })).toBeTruthy()
  })

  it('drops Accept on a listing that is no longer active, and keeps Decline so the card is clearable', () => {
    renderIn('en', props({ listingActive: false }))
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Counter/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Decline/ })).toBeTruthy()
  })

  it('drops Accept once the thread has already closed at a price', () => {
    renderIn('en', props({ threadHasAcceptedOffer: true }))
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Decline/ })).toBeTruthy()
  })

  it('gives the SENDER no controls at all, and says what they are waiting for', () => {
    renderIn('en', props({ mine: true }))
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText(/Waiting for a response/)).toBeTruthy()
  })

  it('fires the handler it was given, and disables every control while a tap is in flight', () => {
    const onAccept = vi.fn()
    const { rerender } = render(
      <LanguageProvider>
        <LangSwitch to="en" />
        <OfferCard {...props({ onAccept })} />
      </LanguageProvider>,
    )
    screen.getByRole('button', { name: /^Accept/ }).click()
    expect(onAccept).toHaveBeenCalledTimes(1)

    rerender(
      <LanguageProvider>
        <LangSwitch to="en" />
        <OfferCard {...props({ onAccept, busy: true })} />
      </LanguageProvider>,
    )
    expect(screen.getByRole('button', { name: /^Accept/ }).hasAttribute('disabled')).toBe(true)
  })

  it('offers nothing on a status it does not recognise, rather than a control the server would 409', () => {
    renderIn('en', props({ status: null }))
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('the money and the reason', () => {
  it('renders VND with DOT thousands separators in Vietnamese', () => {
    renderIn('vi', props())
    expect(screen.getByText(/12\.000\.000 đ/)).toBeTruthy()
    expect(screen.queryByText(/12,000,000/)).toBeNull()
  })

  it('states the offer as a share of the asking price', () => {
    renderIn('en', props())
    expect(screen.getByText(/80%/)).toBeTruthy()
  })

  it('guards the DIVISOR, not the amount — a zero offer still reads as 0%', () => {
    // The first draft tested `askingPrice && amount`, which silently dropped the whole line for a
    // zero offer. The numerator being zero is a fact worth stating; the denominator is the one
    // with no answer. (The send route rejects amount <= 0 today, so this is the card being right
    // rather than the API being wrong.)
    renderIn('en', props({ amount: 0 }))
    expect(screen.getByText(/0%/)).toBeTruthy()
  })

  it('drops the line entirely when there is no asking price to compare against', () => {
    const { container } = renderIn('en', props({ askingPrice: null }))
    expect(container.textContent).not.toContain('of asking')
  })

  it('shows the REASON, which is what makes a number answerable', () => {
    renderIn('en', props({ reason: 'cash' }))
    expect(screen.getByText(/Paying cash today/)).toBeTruthy()
  })

  it('translates the reason', () => {
    renderIn('vi', props({ reason: 'timing' }))
    expect(screen.getByText(/Có thể đến lấy hôm nay/)).toBeTruthy()
  })

  it('ignores a reason code it does not know instead of printing it raw', () => {
    const { container } = renderIn('en', props({ reason: 'javascript:alert(1)' }))
    expect(container.textContent).not.toContain('javascript')
  })

  it('does not repeat the amount when a legacy row carries a baked offer body', () => {
    const { container } = renderIn('en', props({ note: '💰 Offered 12,000,000 VND' }))
    expect(container.textContent).not.toContain('💰')
    cleanup()
    const vi = renderIn('en', props({ note: '💰 Trả giá 12.000.000 đ' }))
    expect(vi.container.textContent).not.toContain('💰')
  })

  it.each([
    // The thread page and the admin view both test `startsWith('💰')`, which drops these buyers'
    // entire messages and leaves the seller a bare number. The match must require the word AND
    // the amount that always followed it — the second case is the one a word-only match still ate.
    '💰 Cash in hand, can meet at 6',
    '💰 Offered cash, available tonight',
    '💰 Trả giá thế nào cũng được',
  ])('⚠️ DOES NOT EAT A REAL NOTE THAT STARTS WITH THE SAME EMOJI: %s', (note) => {
    const { container } = renderIn('en', props({ note }))
    expect(container.textContent).toContain(note.slice(2).trim())
  })

  it('shows a note the sender actually typed', () => {
    renderIn('en', props({ note: 'Can collect this evening' }))
    expect(screen.getByText(/Can collect this evening/)).toBeTruthy()
  })
})

describe('agreement', () => {
  it('shows the shared safety line to BOTH parties, in Vietnamese too', () => {
    // Imported from chat-safety-note.tsx — never a second translation of one safety rule.
    renderIn('vi', props({ status: 'accepted' }))
    expect(screen.getByText(/Hẹn nơi công cộng, kiểm tra hàng rồi mới thanh toán\./)).toBeTruthy()
    cleanup()
    renderIn('vi', props({ status: 'accepted', mine: true }))
    expect(screen.getByText(/Hẹn nơi công cộng, kiểm tra hàng rồi mới thanh toán\./)).toBeTruthy()
  })

  it('hands the SELLER off to mark-as-sold, and never the buyer', () => {
    renderIn('en', props({ status: 'accepted', iAmSeller: true, listingId: 'l1', listingTitle: 'Honda Wave' }))
    expect(screen.getByText(/Mark "Honda Wave" as sold\?/)).toBeTruthy()
    cleanup()
    renderIn('en', props({ status: 'accepted', iAmSeller: false, listingId: 'l1', listingTitle: 'Honda Wave' }))
    expect(screen.queryByText(/as sold\?/)).toBeNull()
  })

  it('⚠️ RETIRES THE MARK-AS-SOLD PROMPT ONCE THE LISTING IS SOLD, instead of asking forever', () => {
    // MarkSoldPrompt's confirmation is component state, so it survives exactly one session.
    // Gated only on `accepted && iAmSeller`, it came back on every reload asking the seller to
    // mark an already-sold listing as sold. The card refuses to draw Accept on an inactive
    // listing; the follow-through has to obey the same fact.
    renderIn(
      'en',
      props({ status: 'accepted', iAmSeller: true, listingActive: false, listingId: 'l1', listingTitle: 'Honda Wave' }),
    )
    expect(screen.queryByText(/as sold\?/)).toBeNull()
    // The safety line is NOT collateral damage — it must survive, for both parties.
    expect(screen.getByText(/Meet in public/)).toBeTruthy()
  })

  it('never shows the safety line before there is a deal', () => {
    for (const status of ['pending', 'declined', 'countered']) {
      renderIn('en', props({ status }))
      expect(screen.queryByText(/Meet in public/)).toBeNull()
      cleanup()
    }
  })
})
