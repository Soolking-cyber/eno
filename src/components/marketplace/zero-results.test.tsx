// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import { ZeroResults, type ZeroResultsRelaxation } from './zero-results'

/**
 * ⚠️ THE TEST THIS FILE EXISTS FOR IS "a relaxation with a count of 0 is never offered".
 *
 * Everything else here is ordinary component coverage. That one is a product invariant with a
 * specific failure: offering "Any year" to a buyer who then lands on a SECOND empty page is the same
 * dead end again, with an extra tap and a promise broken — and it is invisible in a preview, because
 * the seeded catalogue always has something. It has to be held by a test.
 *
 * ⚠️ EXPLICIT `cleanup`: this suite does not run with vitest globals, so Testing Library's own
 * afterEach is never registered and renders would stack across tests (see chat-send-button.test.tsx,
 * where the same line is explained at length).
 */
afterEach(cleanup)

/**
 * ⚠️ THE LANGUAGE IS SWITCHED THROUGH THE CONTEXT, NOT THROUGH localStorage — MEASURED, because the
 * obvious way silently does nothing. Under this vitest jsdom environment the bare `localStorage`
 * global is a plain empty object: `localStorage.setItem` is not a function at all (it throws
 * TypeError). LanguageProvider wraps every storage read in try/catch precisely so a storage-blocked
 * WebView cannot take the app down, so a seeded preference would be swallowed and the provider would
 * quietly stay English — i.e. the Vietnamese test would pass against English copy if the assertions
 * were weaker. Driving `setLang` is the path a real user takes anyway.
 */
function ForceLang({ to }: { to: Language }) {
  const { lang, setLang } = useLanguage()
  React.useEffect(() => {
    if (lang !== to) setLang(to)
  }, [lang, to, setLang])
  return null
}

// ZeroResults reads `tr` from the language context, so every render needs the provider.
function renderZero(ui: React.ReactElement, lang?: Language) {
  return render(
    <LanguageProvider>
      {lang ? <ForceLang to={lang} /> : null}
      {ui}
    </LanguageProvider>,
  )
}

const RELAXATIONS: ZeroResultsRelaxation[] = [
  { id: 'price', label: 'Raise to 12M', count: 38, onSelect: () => {} },
  { id: 'year', label: 'Any year', count: 96, onSelect: () => {} },
]

describe('ZeroResults states the fact', () => {
  it('names the PRICE as the thing that emptied the page when the caller says so', () => {
    renderZero(<ZeroResults reason="price" />)
    expect(screen.getByText('Nothing at that price yet')).toBeTruthy()
  })

  it('falls back to the neutral sentence, which is also what to say when the caller does not know', () => {
    renderZero(<ZeroResults />)
    expect(screen.getByText('Nothing matches that yet')).toBeTruthy()
  })

  it('renders on its own with nothing to offer — no nearest, no relaxations, no actions', () => {
    renderZero(<ZeroResults />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('Relax one thing')).toBeNull()
  })
})

describe('ZeroResults points at the nearest true thing', () => {
  it('quotes the count, what the set is, and the real floor price', () => {
    renderZero(<ZeroResults reason="price" nearest={{ count: 38, label: 'Honda Vision', fromPrice: 11_500_000 }} />)
    expect(screen.getByText('38 Honda Vision from 11,500,000 VND')).toBeTruthy()
  })

  it('omits the price clause when there is no floor worth quoting', () => {
    renderZero(<ZeroResults nearest={{ count: 38, label: 'Honda Vision' }} />)
    expect(screen.getByText('38 Honda Vision')).toBeTruthy()
  })

  it('is a real control when the caller can run it, and firing it is the whole point', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    renderZero(<ZeroResults nearest={{ count: 38, label: 'Honda Vision', fromPrice: 11_500_000, onSelect }} />)
    await user.click(screen.getByRole('button', { name: /38 Honda Vision/ }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('claims nothing when the nearest set is itself empty', () => {
    renderZero(<ZeroResults nearest={{ count: 0, label: 'Honda Vision', fromPrice: 11_500_000 }} />)
    expect(screen.queryByText(/Honda Vision/)).toBeNull()
  })

  /**
   * ⚠️ Intl.NumberFormat RENDERS NaN AND Infinity RATHER THAN THROWING — "NaN VND", "∞ VND" — so a
   * failed MIN() aggregate upstream would have printed nonsense on the one line of this surface
   * whose entire job is to be a TRUE claim. A price we cannot state honestly is dropped; the count
   * and the label, which are still true, are not.
   */
  it('drops an unstateable floor price instead of printing it', () => {
    // 0 is in the list deliberately: "from 0 VND" is a failed aggregate far more often than a real
    // floor, and a caller with nothing to quote is told to omit the field.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      renderZero(<ZeroResults nearest={{ count: 38, label: 'Honda Vision', fromPrice: bad }} />)
      expect(screen.getByText('38 Honda Vision')).toBeTruthy()
      cleanup()
    }
  })
})

/**
 * ⚠️ A REVIEWER CLAIM THAT DID NOT SURVIVE MEASURING, PINNED SO NOBODY RE-LITIGATES IT. The concern
 * was real in principle: a bare <button> defaults to type="submit", so inside the search <form> a
 * press — or Enter in the query field — would submit the form and discard the buyer's typing. It is
 * not real here, because ui/button renders Base UI's Button, which stamps type="button" itself.
 * Measured on every control this surface draws. If that primitive ever stops doing it, this fails
 * rather than the bug shipping.
 */
describe('ZeroResults is form-safe', () => {
  it('every control it renders is type="button", never a submit', () => {
    const { container } = renderZero(
      <ZeroResults
        nearest={{ count: 3, label: 'Honda Vision', onSelect: () => {} }}
        relaxations={RELAXATIONS}
        onSaveSearch={() => {}}
        onNotify={() => {}}
      />,
    )
    const types = [...container.querySelectorAll('button')].map((b) => b.getAttribute('type'))
    expect(types.length).toBeGreaterThan(3)
    expect(types.every((t) => t === 'button')).toBe(true)
  })
})

describe('ZeroResults — relax one thing', () => {
  it('offers each candidate WITH its own count', () => {
    renderZero(<ZeroResults relaxations={RELAXATIONS} />)
    expect(screen.getByText('Relax one thing')).toBeTruthy()
    const chips = within(screen.getByRole('group')).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['Raise to 12M· 38', 'Any year· 96'])
  })

  /**
   * ⚠️ COUNTS ARE EXACT, NEVER ABBREVIATED. `formatCount(1150)` is "1.2k" — which rounds 1.150
   * listings UP into a claim of 1.200 on a surface whose whole argument is that everything it says
   * is true. Same objection that makes an unstateable price get dropped entirely.
   */
  it('states a four-figure count exactly rather than rounding it up', () => {
    renderZero(
      <ZeroResults
        nearest={{ count: 1150, label: 'Honda Vision' }}
        relaxations={[{ id: 'year', label: 'Any year', count: 1150, onSelect: () => {} }]}
      />,
    )
    expect(screen.getByText('1,150 Honda Vision')).toBeTruthy()
    expect(within(screen.getByRole('group')).getByRole('button').textContent).toBe('Any year· 1,150')
  })

  /** ⚠️ THE INVARIANT. A relaxation that leads to another empty page is not an escape route. */
  it('NEVER offers a relaxation whose count is 0 — that is the same dead end again', () => {
    renderZero(
      <ZeroResults
        relaxations={[
          { id: 'price', label: 'Raise to 12M', count: 38, onSelect: () => {} },
          { id: 'year', label: 'Any year', count: 0, onSelect: () => {} },
        ]}
      />,
    )
    const chips = within(screen.getByRole('group')).getAllByRole('button')
    expect(chips).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Any year/ })).toBeNull()
  })

  it('drops every count that is not a whole positive number — NaN, Infinity, negative, fractional', () => {
    renderZero(
      <ZeroResults
        relaxations={[
          { id: 'a', label: 'Raise to 12M', count: -1, onSelect: () => {} },
          { id: 'b', label: 'Any year', count: Number.NaN, onSelect: () => {} },
          { id: 'c', label: 'Any district', count: Number.POSITIVE_INFINITY, onSelect: () => {} },
          // A count of listings is a whole number; 0.5 means a broken aggregate upstream, and
          // advertising it would be a promise nobody can keep.
          { id: 'd', label: 'Any condition', count: 0.5, onSelect: () => {} },
          { id: 'e', label: 'Any brand', count: 4, onSelect: () => {} },
        ]}
      />,
    )
    const chips = within(screen.getByRole('group')).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['Any brand· 4'])
  })

  it('hides the whole section when every candidate is a dead end', () => {
    renderZero(<ZeroResults relaxations={[{ id: 'year', label: 'Any year', count: 0, onSelect: () => {} }]} />)
    expect(screen.queryByText('Relax one thing')).toBeNull()
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('runs the relaxation the buyer picked', async () => {
    const raise = vi.fn()
    const anyYear = vi.fn()
    const user = userEvent.setup()
    renderZero(
      <ZeroResults
        relaxations={[
          { id: 'price', label: 'Raise to 12M', count: 38, onSelect: raise },
          { id: 'year', label: 'Any year', count: 96, onSelect: anyYear },
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Any year/ }))
    expect(anyYear).toHaveBeenCalledTimes(1)
    expect(raise).not.toHaveBeenCalled()
  })
})

describe('ZeroResults — save the search, and be told when one appears', () => {
  it('offers neither affordance when the caller wired neither', () => {
    renderZero(<ZeroResults relaxations={RELAXATIONS} />)
    expect(screen.queryByRole('button', { name: 'Save this search' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tell me when one appears' })).toBeNull()
  })

  it('saves the search', async () => {
    const onSaveSearch = vi.fn()
    const user = userEvent.setup()
    renderZero(<ZeroResults onSaveSearch={onSaveSearch} />)
    await user.click(screen.getByRole('button', { name: 'Save this search' }))
    expect(onSaveSearch).toHaveBeenCalledTimes(1)
  })

  /**
   * ⚠️ A DOUBLE-TAP MUST NOT BUY TWO SUBSCRIPTIONS. While the state prop still reads `idle` the
   * handler is live, so an impatient second tap over slow data fired `onPress` twice — two alert
   * subscriptions, two streams of email to one buyer. The obligation used to sit in a comment
   * addressed to callers, which any handler that awaits its POST before flipping the prop breaks —
   * and that is the natural way to write it.
   */
  it('a double tap in one state buys exactly one subscription', async () => {
    const onNotify = vi.fn()
    const user = userEvent.setup()
    renderZero(<ZeroResults onNotify={onNotify} />)
    const btn = screen.getByRole('button', { name: 'Tell me when one appears' })
    await user.click(btn)
    await user.click(btn)
    expect(onNotify).toHaveBeenCalledTimes(1)
  })

  /**
   * ⚠️ AND THE GUARD MUST NOT EAT THE RETRY. An offline fetch rejects in ~50ms, so a buyer who taps,
   * reads the failure and taps again is well inside the 600ms window — a pure time guard would
   * swallow the retry on the very state that exists to make retrying possible. A state TRANSITION
   * reopens the control immediately.
   */
  it('a state change reopens the control at once, so a retry is never swallowed', async () => {
    const onNotify = vi.fn()
    const user = userEvent.setup()
    const { rerender } = renderZero(<ZeroResults onNotify={onNotify} />)
    await user.click(screen.getByRole('button', { name: 'Tell me when one appears' }))
    expect(onNotify).toHaveBeenCalledTimes(1)

    // The request failed immediately — well inside the double-tap window.
    rerender(
      <LanguageProvider>
        <ZeroResults onNotify={onNotify} notifyState="error" />
      </LanguageProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Tell me when one appears' }))
    expect(onNotify).toHaveBeenCalledTimes(2)
  })

  it('takes the buyer address for later', async () => {
    const onNotify = vi.fn()
    const user = userEvent.setup()
    renderZero(<ZeroResults onNotify={onNotify} />)
    await user.click(screen.getByRole('button', { name: 'Tell me when one appears' }))
    expect(onNotify).toHaveBeenCalledTimes(1)
  })

  /**
   * ⚠️ `done` MUST NOT USE A NATIVE `disabled` EITHER, and an earlier draft did — which only moved
   * the focus loss from the press to the CONFIRMATION, the moment the user is most likely to still
   * be on the control. Inert is expressed with `aria-disabled` and the absence of a handler, so the
   * caret never leaves. Asserted on the attributes, not only on "the handler did not fire": without
   * these lines the test would pass just as happily if the button were live and the click had missed.
   */
  it('confirms in place once done, stays put, and cannot be fired twice', async () => {
    const onSaveSearch = vi.fn()
    const user = userEvent.setup()
    renderZero(<ZeroResults onSaveSearch={onSaveSearch} saveState="done" />)
    const btn = screen.getByRole('button', { name: 'Search saved' })
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn.hasAttribute('disabled')).toBe(false)

    btn.focus()
    await user.click(btn)
    expect(onSaveSearch).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(btn)
  })

  /**
   * ⚠️ CONFIRMING BY DISABLING IS SILENT. On `done` the control changes label AND goes disabled,
   * which drops focus to <body> — so the user who just pressed it is the one told nothing. The
   * polite live region on the row is the whole announcement; without it this surface confirms only
   * to people who can see it.
   */
  it('announces the confirmation instead of only showing it', () => {
    const { container } = renderZero(<ZeroResults onSaveSearch={() => {}} saveState="done" />)
    const region = container.querySelector('[role="status"]')
    expect(region?.textContent).toBe('Search saved')
  })

  /**
   * ⚠️ THE LIVE REGION MUST NOT CONTAIN THE CONTROLS. When `aria-live` sat on the button ROW, every
   * subtree mutation was an announcement — entering `pending` re-read "Save this search Tell me when
   * one appears", a list of controls rather than a status. Empty until there is something to say is
   * what makes the one thing it announces worth announcing.
   */
  /**
   * ⚠️ A FAILED SAVE MUST BE VISIBLE, AND WITHOUT AN `error` STATE IT COULD NOT BE. The state machine
   * was idle/pending/done: a POST that 500s left the caller holding `pending` forever (a dimmed,
   * handler-less button) or snapping back to `idle`, which reverts in silence — the buyer walks away
   * believing they are on the list. `error` keeps the button pressable, so pressing again IS the
   * retry, and puts the failure in the status region.
   */
  it('a failure stays pressable and says so ON SCREEN, not only to a screen reader', async () => {
    const onNotify = vi.fn()
    const user = userEvent.setup()
    const { container } = renderZero(<ZeroResults onNotify={onNotify} notifyState="error" />)
    const btn = screen.getByRole('button', { name: 'Tell me when one appears' })
    expect(btn.getAttribute('aria-disabled')).toBeNull()

    // ⚠️ THE VISIBLE LINE IS THE ASSERTION. An `error` button renders byte-for-byte like one that
    // was never pressed, so an sr-only message would leave a sighted buyer believing the alert was
    // set — the exact outcome this state exists to prevent. The first draft failed this way and the
    // test passed anyway, because it only checked the status node.
    // Two nodes carry this text — the visible line and the status region — so the assertion is that
    // at LEAST one of them is not sr-only. Matching either would be the bug this test guards.
    const nodes = screen.getAllByText('Tell me when one appears: That did not work. Try again.')
    expect(nodes.some((n) => !n.className.includes('sr-only'))).toBe(true)
    // ...and it is announced too, once, through the same status region.
    expect(container.querySelector('[role="status"]')?.textContent).toContain('That did not work.')

    // ⚠️ AND THE BUTTON POINTS AT IT. The live region fires once; someone who tabs away and back, or
    // who reaches the control for the first time after the failure, would otherwise hear only the
    // label with nothing to say the last press did not take.
    // `getElementById`, not a `#id` selector: React.useId produces colons, which are invalid in a
    // CSS selector, and this jsdom build ships no CSS.escape to quote them with.
    const describedBy = btn.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)?.textContent).toContain('That did not work.')

    await user.click(btn)
    expect(onNotify).toHaveBeenCalledTimes(1) // pressing again is the retry
  })

  it('names WHICH action failed when both are on the page', () => {
    renderZero(<ZeroResults onSaveSearch={() => {}} saveState="error" onNotify={() => {}} notifyState="done" />)
    // Unattributed, the buyer has two buttons and no idea which one to press again.
    expect(screen.getByText('Save this search: That did not work. Try again.')).toBeTruthy()
  })

  it('says nothing at all until there is something to confirm', () => {
    const { container } = renderZero(<ZeroResults onSaveSearch={() => {}} onNotify={() => {}} notifyState="pending" />)
    const region = container.querySelector('[role="status"]')
    expect(region?.textContent).toBe('')
    // And the controls are outside it, so their labels can never be read out as a status.
    expect(region?.querySelector('button')).toBeNull()
  })

  /**
   * ⚠️ IN-FLIGHT MUST NOT USE A NATIVE `disabled`, AND THE FIRST VERSION DID. `disabled` takes the
   * element out of the tab order, so the browser drops focus to <body> — the keyboard or
   * screen-reader user who just pressed the button loses their place on the page the instant they
   * act, and is somewhere else entirely when the answer arrives. Busy-but-focusable is the fix:
   * `aria-disabled` + `aria-busy`, no handler, focus untouched.
   */
  it('stays focusable while the request is in flight — it must not drop the pressers focus', async () => {
    const onNotify = vi.fn()
    const user = userEvent.setup()
    renderZero(<ZeroResults onNotify={onNotify} notifyState="pending" />)
    const btn = screen.getByRole('button', { name: 'Tell me when one appears' })
    expect(btn.getAttribute('aria-busy')).toBe('true')
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn.hasAttribute('disabled')).toBe(false)

    btn.focus()
    expect(document.activeElement).toBe(btn)
    await user.click(btn)
    // Busy, so nothing fires — but the caret is still where the user left it.
    expect(onNotify).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(btn)
  })
})

describe('ZeroResults in Vietnamese', () => {
  /**
   * ⚠️ THE SEPARATORS ARE THE ASSERTION. Vietnamese groups thousands with DOTS and suffixes "đ";
   * a comma-grouped "11,500,000 VND" reads foreign to the home market (src/lib/vnd.ts states the
   * rule at length). This is also the test that would catch anyone hand-formatting the figure here
   * instead of going through formatMoneyFull.
   */
  it('renders the authored Vietnamese copy and native money separators', async () => {
    renderZero(
      <ZeroResults reason="price" nearest={{ count: 38, label: 'Honda Vision', fromPrice: 11_500_000 }} onNotify={() => {}} />,
      'vi',
    )
    await waitFor(() => expect(screen.getByText('Chưa có món nào ở mức giá đó')).toBeTruthy())
    expect(screen.getByText('38 Honda Vision từ 11.500.000 đ')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Báo tôi khi có hàng' })).toBeTruthy()
  })
})
