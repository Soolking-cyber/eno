// @vitest-environment jsdom
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import { PRICE_TOKEN, type Opener, type OpenerListing } from '@/lib/openers'
import { OpenerPicker, type OpenerPickerProps } from './opener-picker'

/**
 * THE OPENER ROW — the five things a screenshot cannot show and production would.
 *
 *  1. THE 409 GATE, THROUGH THE UI. src/lib/openers.test.ts proves the rule; this proves the
 *     rule reaches the screen. On a fixed-price listing there must be no offer chip to tap.
 *  2. WHAT ACTUALLY LANDS IN THE COMPOSER. The chip shows a short label; the callback must hand
 *     back the FULL sentence, translated, with the money already substituted and no {price}
 *     token left in it.
 *  3. THE HYDRATION GATE. Both halves of this component are client-clock values on a route that
 *     can be cached (the PDP is 30d ISR), and the mismatch would be STRUCTURAL — a different
 *     chip, not different text — which suppressHydrationWarning does not cover. Asserted against
 *     real renderToStaticMarkup output, not by reading the component.
 *  4. THE HONESTY GATE ON THE WARNING. An unmeasured seller gets NO line: Seller.responseRate
 *     defaults to 100, so a warning built on one is fabricated.
 *  5. THAT THE WARNING BLOCKS NOTHING. It is one line of prose — no dialog, no disabled control,
 *     nothing that stands between the buyer and sending anyway.
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

function renderIn(lang: Language, props: OpenerPickerProps) {
  return render(
    <LanguageProvider>
      <LangSwitch to={lang} />
      <OpenerPicker {...props} />
    </LanguageProvider>,
  )
}

// 09:00 local — see the TZ note in src/lib/openers.test.ts: the slot reads the LOCAL hour, so a
// UTC epoch literal would make this file's answer depend on the machine running it.
const MORNING = new Date(2026, 7, 12, 9, 0).getTime()
const NOW = new Date(2026, 7, 12, 12, 0).getTime()

const MOTORBIKE: OpenerListing = {
  categorySlug: 'vehicles',
  subcategorySlug: 'motorbike',
  listingType: 'sell',
  price: 12_000_000,
  currency: '₫',
  priceUnit: 'VND',
  negotiable: true,
}

/** A seller the nightly job HAS measured, quiet for 11 days. Measured 2026-08-12, exactly one
 *  live seller is in this state — and their display bucket is suppressed, so today a buyer sees
 *  nothing at all about them. */
const MEASURED_AND_QUIET = {
  responseMetricAt: new Date(2026, 7, 11, 12, 0).getTime(),
  convoCount: 12,
  // The OLDEST STILL-UNANSWERED incoming message, not the seller's last reply — see the
  // false-accusation note in src/lib/openers.ts.
  unansweredSince: new Date(2026, 7, 1, 12, 0).getTime(),
}

function props(over: Partial<OpenerPickerProps> = {}): OpenerPickerProps {
  return { listing: MOTORBIKE, listingId: 'listing-a', onPick: () => {}, now: MORNING, ...over }
}

describe('the chips', () => {
  it('hands the composer the FULL sentence, not the chip label', () => {
    const picked: { opener: Opener; text: string }[] = []
    renderIn('en', props({ onPick: (opener, text) => picked.push({ opener, text }) }))

    screen.getByRole('button', { name: /km and papers/i }).click()
    expect(picked).toHaveLength(1)
    expect(picked[0].opener.id).toBe('ask.km-papers')
    // The label is a preview; what lands in the box is the message.
    expect(picked[0].text).toBe('Two questions: how many km has it done, and are the papers complete?')
  })

  it('substitutes the money before the text ever reaches the composer', () => {
    const picked: { opener: Opener; text: string }[] = []
    renderIn('en', props({ onPick: (opener, text) => picked.push({ opener, text }) }))

    screen.getByRole('button', { name: /^Offer/i }).click()
    expect(picked[0].text).toContain('11,400,000 VND')
    expect(picked[0].text).not.toContain(PRICE_TOKEN)
    // ⚠️ The amount rides along so the caller can send a STRUCTURED offer (kind='offer') rather
    // than a number baked into a sentence nobody can accept.
    expect(picked[0].opener.offerAmount).toBe(11_400_000)
  })

  it('NEVER OFFERS A PRICE ON A FIXED-PRICE LISTING — the 409 the buyer would pay for', () => {
    // The send route answers 409 not_negotiable AND recordFixedPriceOfferAttempt() docks the
    // BUYER's trust. There must be nothing here to tap.
    renderIn('en', props({ listing: { ...MOTORBIKE, negotiable: false } }))
    expect(screen.queryByRole('button', { name: /^Offer/i })).toBeNull()
    expect(screen.getByRole('button', { name: /km and papers/i })).toBeTruthy()
  })

  it('speaks Vietnamese, with Vietnamese money', async () => {
    renderIn('vi', props())
    // Written, not translated: "Chiều nay 6 giờ mình qua xem được không ạ?" is what a buyer on
    // Chợ Tốt actually sends. A literal rendering of the English idiom would mark the sender as
    // someone reading from a script.
    expect(await screen.findByRole('button', { name: 'Chiều nay qua xem' }, { timeout: 8000 })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hỏi km và giấy tờ' })).toBeTruthy()
    // DOT thousands separators — a comma there is a different number to a Vietnamese reader.
    expect(screen.getByRole('button', { name: /11\.400\.000 đ/ })).toBeTruthy()
  })

  it('stays reachable while the buyer types — the row does not vanish under the thumb', () => {
    // Typing is the primary path and must never be the harder one. A chip row that disappeared on
    // the first keystroke would shift the composer mid-tap; the WARNING retires, the chips do not.
    renderIn('en', props({ draft: 'Chào bạn' }))
    expect(screen.getByRole('group', { name: /openers/i })).toBeTruthy()
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
  })
})

describe('the honest warning', () => {
  it('AN UNMEASURED SELLER GETS NO WARNING, however long they have been quiet', () => {
    renderIn('en', props({ silence: { ...MEASURED_AND_QUIET, responseMetricAt: null }, now: NOW }))
    expect(screen.queryByText(/still unanswered/i)).toBeNull()
    // No silence facts at all is the same answer, not a crash.
    cleanup()
    renderIn('en', props({ now: NOW }))
    expect(screen.queryByText(/still unanswered/i)).toBeNull()
  })

  it('SAYS NOTHING ABOUT A SELLER WITH NOTHING TO ANSWER', () => {
    // The false-accusation case an external reviewer refuted on 2026-08-12: a seller with a
    // perfect record who has simply not been asked anything must not be told on.
    renderIn('en', props({ silence: { ...MEASURED_AND_QUIET, unansweredSince: null }, now: NOW }))
    expect(screen.queryByText(/still unanswered/i)).toBeNull()
  })

  it('says the measured thing once, and blocks nothing', () => {
    renderIn('en', props({ silence: MEASURED_AND_QUIET, now: NOW }))
    const line = screen.getByText(/a message from 11 days ago that is still unanswered/i)
    expect(line).toBeTruthy()
    // Once. Not one per chip, not one per render.
    expect(screen.getAllByText(/still unanswered/i)).toHaveLength(1)
    // ⚠️ NEVER BLOCKING: no dialog to dismiss, and nothing disabled. The buyer may well be right
    // to write anyway — this is their decision, not ours.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelectorAll('[disabled], [aria-disabled="true"]')).toHaveLength(0)
    // …and it does not shame: no verdict words, no score, no comparison with other sellers.
    expect(line.textContent ?? '').not.toMatch(/unreliable|bad|ignore|avoid|warning|never/i)
  })

  it('retires the moment the buyer starts writing, AND DOES NOT COME BACK', () => {
    const { rerender } = renderIn('en', props({ silence: MEASURED_AND_QUIET, now: NOW }))
    expect(screen.getByText(/still unanswered/i)).toBeTruthy()

    const withDraft = props({ silence: MEASURED_AND_QUIET, now: NOW, draft: 'Chào bạn' })
    rerender(
      <LanguageProvider>
        <LangSwitch to="en" />
        <OpenerPicker {...withDraft} />
      </LanguageProvider>,
    )
    expect(screen.queryByText(/still unanswered/i)).toBeNull()

    // ⚠️ THE BUG THIS HALF EXISTS FOR (reviewer, 2026-08-12). `hasDraft` describes the composer's
    // CURRENT contents, so select-all-and-delete flips it back to false. Mirroring it re-inserted
    // ~34px above the composer under a buyer who was mid-edit. The brief said "once", and a line
    // that can come back is not once.
    rerender(
      <LanguageProvider>
        <LangSwitch to="en" />
        <OpenerPicker {...props({ silence: MEASURED_AND_QUIET, now: NOW, draft: '' })} />
      </LanguageProvider>,
    )
    expect(screen.queryByText(/still unanswered/i)).toBeNull()
  })

  it('offers at most two nearby alternatives, as links', () => {
    renderIn(
      'en',
      props({
        silence: MEASURED_AND_QUIET,
        now: NOW,
        alternatives: [
          { id: 'a', title: 'Honda Vision 2022', href: '/listing/a', price: 24_000_000, currency: '₫' },
          { id: 'b', title: 'Honda Lead 2021', href: '/listing/b' },
          { id: 'c', title: 'Yamaha Janus', href: '/listing/c' },
        ],
      }),
    )
    const links = screen.getAllByRole('link')
    // A third turns a one-line note into a shelf.
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute('href')).toBe('/listing/a')
    // Prices on an alternative go through the same money formatter as everything else.
    expect(links[0].textContent).toContain('24,000,000 VND')
  })

  it('shows no alternatives when there is no warning to attach them to', () => {
    renderIn('en', props({ alternatives: [{ id: 'a', title: 'Honda Vision 2022', href: '/listing/a' }] }))
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})

describe('the hydration gate', () => {
  /** ⚠️ NO LangSwitch: LanguageProvider initialises to 'en' and picks up a preference in a mount
   *  EFFECT, which never runs during a server render — so 'en' is what every server render
   *  produces, in every locale. (Same note as offer-card.test.tsx.) */
  function ssr(p: OpenerPickerProps) {
    return renderToStaticMarkup(
      <LanguageProvider>
        <OpenerPicker {...p} />
      </LanguageProvider>,
    )
  }

  it('emits NO clock-derived chip on the server', () => {
    // The commitment chip is "today at 6pm" before 3pm and "tomorrow at 10am" after it, and the
    // warning counts days. Baked ISR markup and a fresh client compute legitimately disagree, and
    // an element appearing/disappearing is a structural mismatch, not a text one.
    const html = ssr({ listing: MOTORBIKE, listingId: 'listing-a', onPick: () => {}, silence: MEASURED_AND_QUIET })
    expect(html).not.toMatch(/6pm|10am|unanswered/)
    // The chip row's own height is still reserved, so filling it in after mount cannot shift the
    // composer under the buyer's thumb.
    expect(html).toContain('min-h-8')
  })

  it('EMITS NOTHING EVEN WHEN THE CALLER PINS `now` — a pinned epoch is not a pinned slot', () => {
    // ⚠️ THE BUG THIS TEST EXISTS FOR (codex, 2026-08-12). An earlier version let a supplied `now`
    // bypass the mount gate, on the theory that a pinned clock cannot mismatch. But the slot is
    // chosen from `new Date(now).getHours()` — the LOCAL hour of whichever machine evaluates it —
    // so a Server Component passing `now` renders it in the container timezone (UTC on Cloud Run)
    // while the browser renders the same number in Asia/Ho_Chi_Minh. Seven hours apart, straddling
    // the 15:00 cutoff for most of the day. The server must emit no chip whatever the caller does.
    const morning = ssr({ listing: MOTORBIKE, listingId: 'listing-a', onPick: () => {}, now: MORNING })
    const evening = ssr({ listing: MOTORBIKE, listingId: 'listing-a', onPick: () => {}, now: new Date(2026, 7, 12, 20, 0).getTime() })
    expect(morning).not.toMatch(/6pm|10am/)
    expect(evening).not.toMatch(/6pm|10am/)
    // …and byte-identically so, which is the property hydration actually needs.
    expect(morning).toBe(evening)
  })
})

describe('the clock, unpinned — what production actually runs', () => {
  it('DOES NOT RE-TICK WHEN THE PARENT RE-RENDERS', () => {
    /**
     * ⚠️ THIS TEST PASSES NO `now`, AND THAT IS THE WHOLE POINT. Every other test in this file
     * pins the clock, which short-circuits `??` and makes the production expression unreachable —
     * a reviewer found the re-tick bug precisely because the suite could not see it (2026-08-12).
     * Here `Date.now()` is stubbed instead, so the component takes the real path and the clock can
     * be moved across the 15:00 cutoff between renders.
     */
    const clock = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 7, 12, 14, 59).getTime())
    try {
      const { rerender } = renderIn('en', { listing: MOTORBIKE, listingId: 'listing-a', onPick: () => {} })
      expect(screen.getByRole('button', { name: /today at 6pm/i })).toBeTruthy()

      // 15:01 — two minutes later, one keystroke, one re-render.
      clock.mockReturnValue(new Date(2026, 7, 12, 15, 1).getTime())
      rerender(
        <LanguageProvider>
          <LangSwitch to="en" />
          <OpenerPicker listing={MOTORBIKE} listingId="listing-a" onPick={() => {}} draft="Chào bạn" />
        </LanguageProvider>,
      )
      // The chip must not mutate under the buyer's thumb mid-sentence.
      expect(screen.getByRole('button', { name: /today at 6pm/i })).toBeTruthy()
      expect(screen.queryByRole('button', { name: /tomorrow at 10am/i })).toBeNull()
    } finally {
      clock.mockRestore()
    }
  })
})

describe('per-listing state — the same instance, a different listing', () => {
  it('RESETS THE WARNING LATCH AND THE PINNED CLOCK WHEN THE LISTING CHANGES', () => {
    /**
     * ⚠️ THE BUG THIS TEST EXISTS FOR (reviewers, 2026-08-12, twice). Both pieces of state live
     * for the component INSTANCE while the feature is about a LISTING. A buyer writes in listing
     * A's composer, then client-navigates to listing B whose seller is the measured-and-quiet one:
     * with instance-scoped state the latch is still set and B's honest warning — the single case
     * this feature exists for — never renders, and B inherits A's frozen time slot.
     *
     * ⚠️ AND B IS RENDERED WITH `hasDraft` STILL TRUE, WHICH IS THE HALF THAT KEPT SLIPPING. On a
     * docked composer the text survives navigation, so the first "fix" (reset the latch on
     * identity change) was undone on its own next render pass by the branch that latches on the
     * LEVEL of hasDraft. Giving B no draft is exactly how the previous version of this test missed
     * it — a reviewer predicted that dodge one round before another reviewer found the code doing
     * it. A and B are also field-for-field identical: two standard motorbikes at 12,000,000 ₫
     * negotiable is Tuesday on a classifieds marketplace, and only the ID separates them.
     */
    const clock = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 7, 12, 9, 0).getTime())
    try {
      const A = { ...MOTORBIKE }
      const B = { ...MOTORBIKE }
      const { rerender } = renderIn('en', {
        listing: A,
        listingId: 'listing-a',
        onPick: () => {},
        silence: MEASURED_AND_QUIET,
      })
      expect(screen.getByText(/still unanswered/i)).toBeTruthy()
      expect(screen.getByRole('button', { name: /today at 6pm/i })).toBeTruthy()

      // The buyer starts writing to A: the line retires, as it should.
      rerender(
        <LanguageProvider>
          <LangSwitch to="en" />
          <OpenerPicker listing={A} listingId="listing-a" onPick={() => {}} silence={MEASURED_AND_QUIET} draft="Chào bạn" />
        </LanguageProvider>,
      )
      expect(screen.queryByText(/still unanswered/i)).toBeNull()

      // Same instance, different listing, the draft still in the box — and it is now the evening.
      clock.mockReturnValue(new Date(2026, 7, 12, 20, 0).getTime())
      rerender(
        <LanguageProvider>
          <LangSwitch to="en" />
          <OpenerPicker listing={B} listingId="listing-b" onPick={() => {}} silence={MEASURED_AND_QUIET} draft="Chào bạn" />
        </LanguageProvider>,
      )
      // B's buyer gets the warning B's seller earned, carried-over draft or not.
      expect(screen.getByText(/still unanswered/i)).toBeTruthy()
      // …and the slot re-pinned rather than promising a 6pm that has passed.
      expect(screen.getByRole('button', { name: /tomorrow at 10am/i })).toBeTruthy()

      // ⚠️ AND IT STILL RETIRES ON THE NEXT KEYSTROKE. This is the half a reviewer said the test
      // was missing, and it is the reason the prop is the TEXT rather than a boolean: with a
      // carried-over draft the boolean never changes, so an edge over it would have left this
      // line nagging above the composer for the whole message.
      rerender(
        <LanguageProvider>
          <LangSwitch to="en" />
          <OpenerPicker listing={B} listingId="listing-b" onPick={() => {}} silence={MEASURED_AND_QUIET} draft="Chào bạn m" />
        </LanguageProvider>,
      )
      expect(screen.queryByText(/still unanswered/i)).toBeNull()
    } finally {
      clock.mockRestore()
    }
  })
})

describe('the tap', () => {
  it('fires one haptic per pick and never auto-sends', () => {
    // Nothing here sends. The sentence lands in the composer, where the buyer reads it, edits it
    // and presses send — the openers remove the typing, not the decision.
    const vibrate = vi.fn()
    Object.defineProperty(window.navigator, 'vibrate', { value: vibrate, configurable: true })
    const picked: string[] = []
    renderIn('en', props({ onPick: (_o, text) => picked.push(text) }))
    screen.getByRole('button', { name: /km and papers/i }).click()
    expect(picked).toHaveLength(1)
    expect(vibrate).toHaveBeenCalledTimes(1)
  })
})
