// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import { SaleConfirmPrompt } from './sale-confirm-prompt'

/**
 * WHAT THIS FILE IS ACTUALLY DEFENDING.
 *
 * <SaleConfirmPrompt> is one paragraph and two buttons, so the temptation is to test that it
 * renders. The things that can silently break are elsewhere:
 *
 *  · THE MUTUALITY SENTENCE. "Confirm so it counts for both of you" is the only reason a buyer
 *    who already has the bike answers at all. It is the first thing a copy edit trims for being
 *    wordy, and losing it costs answer rate — which nobody would ever attribute to a copy edit.
 *  · THE DECLINE IS NOT A TRAP. Two separate guarantees: declining does not accuse anyone, and a
 *    declined prompt renders NO buttons at all, so there is nothing left to re-prompt with.
 *  · THE MONEY. A đồng amount rendered with commas is the shape that reads foreign to the home
 *    market, and this sentence is where the buyer verifies the figure they actually paid.
 *
 * ⚠️ EXPLICIT `cleanup`: this suite does not run with vitest globals, so Testing Library never
 * registers its own afterEach and renders would stack (see chat-send-button.test.tsx, where the
 * same line is explained at length).
 */
afterEach(cleanup)

/** ⚠️ The language is switched through the CONTEXT, not localStorage — under this jsdom
 *  environment `localStorage.setItem` is not a function, LanguageProvider swallows the throw by
 *  design, and the provider would quietly stay English (see zero-results.test.tsx). */
function ForceLang({ to }: { to: Language }) {
  const { lang, setLang } = useLanguage()
  React.useEffect(() => {
    if (lang !== to) setLang(to)
  }, [lang, to, setLang])
  return null
}

function renderPrompt(ui: React.ReactElement, lang?: Language) {
  return render(
    <LanguageProvider>
      {lang ? <ForceLang to={lang} /> : null}
      {ui}
    </LanguageProvider>,
  )
}

const BASE = {
  saleId: 'sale-1',
  sellerName: 'Minh',
  listingTitle: 'Honda Vision 2021',
  price: 11_200_000,
  onConfirm: () => {},
  onDecline: () => {},
}

describe('SaleConfirmPrompt asks ONE question', () => {
  it('names the seller, the thing and the price in one sentence', () => {
    renderPrompt(<SaleConfirmPrompt {...BASE} />)
    // The sentence is assembled from translated fragments, so assert on the group's whole text
    // rather than on a single text node.
    const prompt = screen.getByRole('group')
    expect(prompt.textContent).toContain('Minh')
    expect(prompt.textContent).toContain('Honda Vision 2021')
    expect(prompt.textContent).toContain('says you bought')
    expect(prompt.textContent).toContain('11,200,000 VND')
  })

  it('says confirming is what makes it count FOR BOTH — the reason a buyer answers at all', () => {
    renderPrompt(<SaleConfirmPrompt {...BASE} />)
    expect(screen.getByText('Confirm so it counts for both of you.')).toBeTruthy()
  })

  it('is labelled by the question, so the group announces what it is asking', () => {
    renderPrompt(<SaleConfirmPrompt {...BASE} />)
    const prompt = screen.getByRole('group')
    const labelledBy = prompt.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy!)?.textContent).toContain('says you bought')
  })

  it('renders đồng in the home market convention — DOT thousands, "đ" suffix', async () => {
    renderPrompt(<SaleConfirmPrompt {...BASE} />, 'vi')
    const prompt = await screen.findByRole('group')
    // Wait for the provider's setLang effect to land.
    await vi.waitFor(() => expect(prompt.textContent).toContain('11.200.000 đ'))
    expect(prompt.textContent).not.toContain('11,200,000')
  })
})

describe('SaleConfirmPrompt — the two answers and their accessible names', () => {
  it('offers exactly two controls, both named in plain words', () => {
    renderPrompt(<SaleConfirmPrompt {...BASE} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Yes, I bought it', 'No, I did not'])
  })

  it('confirming calls back once', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderPrompt(<SaleConfirmPrompt {...BASE} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('declining calls back once', async () => {
    const user = userEvent.setup()
    const onDecline = vi.fn()
    renderPrompt(<SaleConfirmPrompt {...BASE} onDecline={onDecline} />)
    await user.click(screen.getByRole('button', { name: 'No, I did not' }))
    expect(onDecline).toHaveBeenCalledTimes(1)
  })

  it('promises up front that saying no reports nobody — before the tap, not after it', () => {
    renderPrompt(<SaleConfirmPrompt {...BASE} />)
    expect(
      screen.getByText('No is a normal answer. It reports nobody, and we will not ask about this one again.'),
    ).toBeTruthy()
  })

  it('locks both answers while one is in flight, so a double tap cannot send two', () => {
    renderPrompt(<SaleConfirmPrompt {...BASE} pending="confirm" />)
    for (const b of screen.getAllByRole('button')) {
      expect((b as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('LOCKS ITSELF on the first answer, before the parent can set pending', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderPrompt(<SaleConfirmPrompt {...BASE} onConfirm={onConfirm} />)
    const yes = screen.getByRole('button', { name: 'Yes, I bought it' })
    await user.click(yes)
    await user.click(yes)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('and a fumbled tap cannot follow a yes with a no — a contradiction in a public record', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onDecline = vi.fn()
    renderPrompt(<SaleConfirmPrompt {...BASE} onConfirm={onConfirm} onDecline={onDecline} />)
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    await user.click(screen.getByRole('button', { name: 'No, I did not' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onDecline).not.toHaveBeenCalled()
  })

  it('a DIFFERENT sale at the same position is asked fresh, not handed the last one lock', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const { rerender } = renderPrompt(<SaleConfirmPrompt {...BASE} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))

    // ⚠️ Same component instance, same `status`/`pending`, IDENTICAL displayed values — a seller
    // with two of the same item at the same price, which is commonplace. Only the sale id differs,
    // which is exactly why the lock is keyed on it and not on the words on screen. Without that,
    // this buyer meets two dead buttons for a question they were never asked.
    rerender(
      <LanguageProvider>
        <SaleConfirmPrompt {...BASE} onConfirm={onConfirm} saleId="sale-2" />
      </LanguageProvider>,
    )
    expect((screen.getByRole('button', { name: 'Yes, I bought it' }) as HTMLButtonElement).disabled).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('NEVER lets a yes be followed by a no for the same sale, however the parent re-renders', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onDecline = vi.fn()
    const { rerender } = renderPrompt(
      <SaleConfirmPrompt {...BASE} onConfirm={onConfirm} onDecline={onDecline} />,
    )
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))

    // ⚠️ A parent that clears `pending` a tick before it settles `status` re-opens the general
    // answer lock — correct for retrying the SAME answer, wrong for the opposite one. "Yes" then
    // "No" for one sale is not a retry, it is a contradiction in a public trust record.
    rerender(
      <LanguageProvider>
        <SaleConfirmPrompt {...BASE} onConfirm={onConfirm} onDecline={onDecline} pending="confirm" />
      </LanguageProvider>,
    )
    rerender(
      <LanguageProvider>
        <SaleConfirmPrompt {...BASE} onConfirm={onConfirm} onDecline={onDecline} pending={null} />
      </LanguageProvider>,
    )
    const no = screen.getByRole('button', { name: 'No, I did not' }) as HTMLButtonElement
    expect(no.disabled).toBe(true)
    await user.click(no)
    expect(onDecline).not.toHaveBeenCalled()
  })

  it('a FAILED yes can still be corrected to no — the one-way door has a record behind it or it is not shut', async () => {
    const user = userEvent.setup()
    const onDecline = vi.fn()
    const { rerender } = renderPrompt(<SaleConfirmPrompt {...BASE} onDecline={onDecline} />)
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))

    rerender(
      <LanguageProvider>
        <SaleConfirmPrompt {...BASE} onDecline={onDecline} errorMessage="That did not send." />
      </LanguageProvider>,
    )
    // Nothing was written, so refusing the opposite answer would trap the buyer into retrying an
    // answer they may no longer want to give.
    await user.click(screen.getByRole('button', { name: 'No, I did not' }))
    expect(onDecline).toHaveBeenCalledTimes(1)
  })

  it('a REPEATED identical error never deadlocks this card — it has no Cancel, Escape or swipe', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const yes = () => screen.getByRole('button', { name: 'Yes, I bought it' })
    const at = (pending: 'confirm' | null, errorMessage: string | null) => (
      <LanguageProvider>
        <SaleConfirmPrompt {...BASE} onConfirm={onConfirm} pending={pending} errorMessage={errorMessage} />
      </LanguageProvider>
    )
    const { rerender } = renderPrompt(<SaleConfirmPrompt {...BASE} onConfirm={onConfirm} />)

    // ⚠️ Failure #2 reports the IDENTICAL string, so React bails out and an error-only signal never
    // fires. The spinner coming down with an error still up is the same report; without counting
    // it, a caller that repeats a message would leave this card dead — and unlike the mark-sold
    // sheet it has no Cancel, no Escape and no swipe to escape through.
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((yes() as HTMLButtonElement).disabled).toBe(false)
      await user.click(yes())
      rerender(at('confirm', 'That did not send.'))
      rerender(at(null, 'That did not send.'))
    }
    expect(onConfirm).toHaveBeenCalledTimes(3)
  })

  it('A FUMBLED "No" AFTER RETRYING "Yes" REACHES NOBODY — the contradiction window is shut', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onDecline = vi.fn()
    const failed = (
      <LanguageProvider>
        <SaleConfirmPrompt {...BASE} onConfirm={onConfirm} onDecline={onDecline} errorMessage="That did not send." />
      </LanguageProvider>
    )
    const { rerender } = renderPrompt(
      <SaleConfirmPrompt {...BASE} onConfirm={onConfirm} onDecline={onDecline} />,
    )
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    rerender(failed) // attempt 1 failed — retrying is now allowed

    // ⚠️ THE HOLE THIS PINS. Releasing the lock while an error is merely DISPLAYED left it off for
    // as long as the message was up: the buyer retries Yes, fumbles No a second later before the
    // parent has re-rendered, and both callbacks fire for one sale.
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' })) // retry
    await user.click(screen.getByRole('button', { name: 'No, I did not' }))
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(onDecline).not.toHaveBeenCalled()
  })

  it('a SUCCESS that clears pending before status lands does not re-light either button', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onDecline = vi.fn()
    const { rerender } = renderPrompt(
      <SaleConfirmPrompt {...BASE} onConfirm={onConfirm} onDecline={onDecline} />,
    )
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    for (const p of ['confirm', null] as const) {
      rerender(
        <LanguageProvider>
          <SaleConfirmPrompt {...BASE} onConfirm={onConfirm} onDecline={onDecline} pending={p} />
        </LanguageProvider>,
      )
    }
    // Nothing failed, so nothing was reported — the lock has no reason to open, and the frame
    // before `status` catches up cannot be used to confirm twice or to contradict.
    expect((screen.getByRole('button', { name: 'Yes, I bought it' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'No, I did not' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('TWO identical failures still leave "No" available — the honest answer is never welded shut', async () => {
    const user = userEvent.setup()
    const onDecline = vi.fn()
    const failed = (
      <LanguageProvider>
        <SaleConfirmPrompt {...BASE} onDecline={onDecline} errorMessage="That did not send." />
      </LanguageProvider>
    )
    const pendingAgain = (
      <LanguageProvider>
        <SaleConfirmPrompt {...BASE} onDecline={onDecline} pending="confirm" errorMessage="That did not send." />
      </LanguageProvider>
    )
    const { rerender } = renderPrompt(<SaleConfirmPrompt {...BASE} onDecline={onDecline} />)
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    rerender(failed)
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' })) // retry
    // ⚠️ The same message again produces NO prop change for React to see, so an error-only signal
    // would never fire. The spinner coming down with an error still up is the same report, and it
    // is what keeps this from deadlocking.
    rerender(pendingAgain)
    rerender(failed)

    // ⚠️ THE VERSION THIS REPLACES compared the error against the one showing WHEN THEY ANSWERED,
    // which is sharper against a stale message — and welded this door shut forever the moment a
    // caller repeated a string. Nothing has been recorded here; a buyer locked out of "No" on a
    // card with no Cancel, no Escape and no swipe is the one outcome this component exists to
    // prevent, so the door opens on any displayed error and the sharper rule was given up.
    await user.click(screen.getByRole('button', { name: 'No, I did not' }))
    expect(onDecline).toHaveBeenCalledTimes(1)
  })

  it('surfaces a failed write and re-opens on it, so the buyer is never stuck without a reason', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const { rerender } = renderPrompt(<SaleConfirmPrompt {...BASE} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))

    rerender(
      <LanguageProvider>
        <SaleConfirmPrompt {...BASE} onConfirm={onConfirm} errorMessage="That did not send." />
      </LanguageProvider>,
    )
    expect(screen.getByRole('alert').textContent).toBe('That did not send.')
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('re-opens on a REPORTED FAILURE, so a failed write is retryable', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const { rerender } = renderPrompt(<SaleConfirmPrompt {...BASE} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    expect((screen.getByRole('button', { name: 'Yes, I bought it' }) as HTMLButtonElement).disabled).toBe(true)

    // The parent flags the write, then reports it finished and failed. ⚠️ It is the FAILURE that
    // re-opens it, not the mere fact that something changed — see the sibling test where a success
    // walks the same pending transitions and the buttons stay shut.
    rerender(
      <LanguageProvider>
        <SaleConfirmPrompt {...BASE} onConfirm={onConfirm} pending="confirm" />
      </LanguageProvider>,
    )
    rerender(
      <LanguageProvider>
        <SaleConfirmPrompt {...BASE} onConfirm={onConfirm} pending={null} errorMessage="That did not send." />
      </LanguageProvider>,
    )
    expect((screen.getByRole('button', { name: 'Yes, I bought it' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('SaleConfirmPrompt settles — and a settled prompt cannot re-ask', () => {
  it('confirmed: says it now counts for both, and offers NO buttons', () => {
    renderPrompt(<SaleConfirmPrompt {...BASE} status="confirmed" />)
    expect(screen.getByText('Confirmed — this deal now counts for both of you.')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('declined: accuses nobody, promises not to ask again, and offers NO buttons', () => {
    renderPrompt(<SaleConfirmPrompt {...BASE} status="declined" />)
    expect(
      screen.getByText('Noted. Nobody was reported, and we will not ask about this one again.'),
    ).toBeTruthy()
    // ⚠️ THE ANTI-TRAP ASSERTION. With no control left there is nothing to press, so the surface
    // itself cannot become a nag. (Whether the PARENT re-mounts it with status="asking" is the
    // integrator's half of the contract — stated in the component header.)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    // And it does not editorialise about the seller.
    const settled = screen.getByRole('status')
    expect(settled.textContent).not.toContain('Minh')
  })

  it('ANNOUNCES the settled state — the live region exists before it has anything to say', () => {
    // ⚠️ THE ASSERTION THAT MATTERS IS THE FIRST ONE. A role="status" element inserted together
    // with its text is frequently never announced: a screen reader watches a live region for
    // CHANGES, and a region that did not exist a moment ago has nothing to change from. So the
    // region has to be in the tree while the question is still being asked.
    const { rerender } = renderPrompt(<SaleConfirmPrompt {...BASE} />)
    const region = screen.getByRole('status')
    expect(region.textContent).toBe('')

    rerender(
      <LanguageProvider>
        <SaleConfirmPrompt {...BASE} status="confirmed" />
      </LanguageProvider>,
    )
    // Same node, new content — which is the change a live region is defined to announce.
    expect(screen.getByRole('status')).toBe(region)
    expect(region.textContent).toContain('counts for both of you')
  })
})

describe('SaleConfirmPrompt — hostile inputs', () => {
  it('a title containing a regex replacement pattern survives verbatim', () => {
    // `$&` is String.replace's "the whole match" token. Composing the sentence with .replace()
    // would have expanded it; splitting on the tokens does not.
    renderPrompt(<SaleConfirmPrompt {...BASE} listingTitle="Honda $& Vision" />)
    expect(screen.getByRole('group').textContent).toContain('Honda $& Vision')
  })

  it('a zero or negative price never renders a negative amount', () => {
    renderPrompt(<SaleConfirmPrompt {...BASE} price={-5} />)
    const text = screen.getByRole('group').textContent ?? ''
    expect(text).toContain('0 VND')
    expect(text).not.toContain('-5')
  })
})
