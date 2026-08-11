// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import { MarkSoldSheet, type MarkSoldBuyer, type MarkSoldSubmission } from './mark-sold-sheet'

/**
 * WHAT THIS FILE IS ACTUALLY DEFENDING.
 *
 *  · THE OFF-ENO OPTION EXISTS, ALWAYS, AND ALONE WHEN NOBODY MESSAGED. If it ever disappears —
 *    or degrades into something smaller than a buyer row — sellers whose deal finished on Zalo
 *    will pick a name at random, and every number built on completed deals inherits that lie.
 *  · THE PRICE IS THE AGREED PRICE. Defaulted, editable, and it stops following the selection the
 *    moment the seller types. A default that keeps overwriting typed input is silent data loss.
 *  · THE MONEY IS THE VIEWER'S OWN CONVENTION. A đồng amount grouped with commas reads foreign;
 *    the vi case is asserted, not assumed.
 *  · EVERY CONTROL HAS A NAME. This sheet is a radio list plus a bare-<div> money widget, which is
 *    precisely the shape that ends up announcing as "blank edit field".
 *
 * ⚠️ EXPLICIT `cleanup` — this suite runs without vitest globals, so Testing Library never
 * registers its own afterEach and renders would stack (chat-send-button.test.tsx explains it).
 */
afterEach(cleanup)

/**
 * ⚠️ jsdom HAS NO ResizeObserver, AND Base UI's Drawer CONSTRUCTS ONE. Without this the sheet
 * throws on mount and every assertion below fails for a reason that has nothing to do with the
 * component. `getAnimations` is the same class of gap: the popup asks the platform whether it is
 * still animating before it unmounts.
 */
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
})

/** ⚠️ Language through the CONTEXT, not localStorage — see zero-results.test.tsx: under this jsdom
 *  environment `localStorage.setItem` is not a function and LanguageProvider swallows the throw by
 *  design, so a seeded preference silently stays English. */
function ForceLang({ to }: { to: Language }) {
  const { lang, setLang } = useLanguage()
  React.useEffect(() => {
    if (lang !== to) setLang(to)
  }, [lang, to, setLang])
  return null
}

const LISTING = { id: 'l1', title: 'Honda Vision 2021', price: 12_000_000 }

const BUYERS: MarkSoldBuyer[] = [
  { id: 'u1', name: 'Minh', hint: 'Messaged 2 days ago' },
  { id: 'u2', name: 'Lan', hint: 'Offered 11.000.000 đ', acceptedOffer: 11_000_000 },
  { id: 'u3', name: 'Trang' },
]

type Overrides = Partial<React.ComponentProps<typeof MarkSoldSheet>>

function renderSheet(props: Overrides = {}, lang?: Language) {
  const onConfirm = vi.fn<(s: MarkSoldSubmission) => void>()
  const onOpenChange = vi.fn()
  const ui = (open: boolean, extra: Overrides) => (
    <LanguageProvider>
      {lang ? <ForceLang to={lang} /> : null}
      <MarkSoldSheet
        open={open}
        onOpenChange={onOpenChange}
        listing={LISTING}
        buyers={BUYERS}
        buyersLoaded
        onConfirm={onConfirm}
        {...props}
        {...extra}
      />
    </LanguageProvider>
  )
  const view = render(ui(true, {}))
  return {
    ...view,
    onConfirm,
    onOpenChange,
    setOpen: (open: boolean) => view.rerender(ui(open, {})),
    /** Re-render the OPEN sheet with different props — the async/refresh cases. */
    update: (extra: Overrides) => view.rerender(ui(true, extra)),
  }
}

/** The one money field. Named by hand, because VndInput renders a <div> and cannot be labelled. */
const priceField = () => screen.getByRole('textbox', { name: 'Agreed price' }) as HTMLInputElement
const cta = () => screen.getByRole('button', { name: 'Mark as sold' }) as HTMLButtonElement

describe('MarkSoldSheet lists the people who actually messaged', () => {
  it('shows one row per person and nothing else — no ranking, no extras', () => {
    renderSheet()
    for (const b of BUYERS) expect(screen.getByRole('radio', { name: new RegExp(b.name) })).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(BUYERS.length + 1) // + "Someone not on eno"
  })

  it('puts the hint on the row, so the seller can tell two Minhs apart', () => {
    renderSheet()
    expect(screen.getByRole('radio', { name: /Messaged 2 days ago/ })).toBeTruthy()
  })

  it('has NO search box — on a normal listing this list is two to five people', () => {
    renderSheet()
    expect(screen.queryByRole('searchbox')).toBeNull()
    // Exactly one text field in the whole sheet, and it is the money one.
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(priceField()).toBeTruthy()
  })

  it('names the group, so the radio list announces what it is asking', () => {
    renderSheet()
    expect(screen.getByRole('radiogroup', { name: 'Who bought it?' })).toBeTruthy()
  })
})

describe('MarkSoldSheet — "Someone not on eno" is first class', () => {
  it('is offered even when three people messaged', () => {
    renderSheet()
    const off = screen.getByRole('radio', { name: /Someone not on eno/ })
    expect(off).toBeTruthy()
    // Same row shape as a buyer: it is a radio in the SAME group, not a link or a footnote.
    expect(within(screen.getByRole('radiogroup')).getAllByRole('radio')).toContain(off)
  })

  it('THE EMPTY CASE: nobody messaged ⇒ it is the only option, and it is already chosen', () => {
    renderSheet({ buyers: [] })
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(1)
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Nobody has messaged about this listing yet.')).toBeTruthy()
    // And the sheet is immediately submittable — the price already carries the asking figure.
    expect(cta().disabled).toBe(false)
  })

  it('reports an off-eno sale as buyerId null, not as an error or a fake id', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Someone not on eno/ }))
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledWith({ buyerId: null, price: 12_000_000 })
  })

  it('says plainly that nobody will confirm an off-eno sale', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('radio', { name: /Someone not on eno/ }))
    expect(screen.getByText('Recorded as sold off eno. Nobody is asked to confirm.')).toBeTruthy()
  })
})

describe('MarkSoldSheet — the agreed price', () => {
  it('defaults to the asking price, grouped for the viewer', () => {
    renderSheet()
    expect(priceField().value).toBe('12,000,000')
  })

  it('groups with DOTS for Vietnamese — the home-market convention', async () => {
    renderSheet({}, 'vi')
    // ⚠️ The field's accessible NAME is translated too, so it cannot be found by the English one —
    // which is itself worth asserting: a money field that loses its name in the home-market
    // language is exactly the "blank edit field" failure this suite exists to catch.
    await vi.waitFor(() => {
      const vnField = screen.getByRole('textbox', { name: 'Giá đã chốt' }) as HTMLInputElement
      expect(vnField.value).toBe('12.000.000')
    })
    expect(screen.queryByRole('textbox', { name: 'Agreed price' })).toBeNull()
  })

  it('switches to the ACCEPTED OFFER when that person is picked', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('radio', { name: /Lan/ }))
    expect(priceField().value).toBe('11,000,000')
  })

  it('falls back to the asking price for a person with no accepted offer', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('radio', { name: /Lan/ }))
    await user.click(screen.getByRole('radio', { name: /Trang/ }))
    expect(priceField().value).toBe('12,000,000')
  })

  it('STOPS following the selection once the seller has typed — a default must not eat input', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.clear(priceField())
    await user.type(priceField(), '9500000')
    expect(priceField().value).toBe('9,500,000')
    // Lan carries an accepted offer; picking her must NOT overwrite the typed figure.
    await user.click(screen.getByRole('radio', { name: /Lan/ }))
    expect(priceField().value).toBe('9,500,000')
  })

  it('submits the digits the seller sees, not the asking price', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.clear(priceField())
    await user.type(priceField(), '9500000')
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledWith({ buyerId: 'u1', price: 9_500_000 })
  })

  it('refuses an empty price, and says why out loud', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.clear(priceField())
    expect(cta().disabled).toBe(true)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Enter what it sold for.')
    // The field itself reports its state — the red ring alone reaches nobody.
    expect(priceField().getAttribute('aria-invalid')).toBe('true')
    expect(priceField().getAttribute('aria-describedby')).toBe(alert.id)
  })

  it('SAYS NOTHING WHILE TYPING — every prefix of a đồng price is "far from asking"', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.clear(priceField())
    // 1 → 12 → 120 … are all ≤ asking/5. A live check would fire role="alert" on nearly every
    // keystroke of a perfectly normal edit, which is how a real warning gets tuned out.
    for (const ch of '12000000') {
      await user.type(priceField(), ch)
      expect(screen.queryByText('That is very different from your asking price — check the zeros.')).toBeNull()
    }
  })

  it('CATCHES an order-of-magnitude slip at the tap, and the way past it is a DIFFERENT control', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.clear(priceField())
    // 1.200.000 instead of 12.000.000 — one missing zero, and it looks right at a glance.
    await user.type(priceField(), '1200000')
    expect(screen.queryByRole('alert')).toBeNull()

    await user.click(cta())
    // The first press asks instead of filing, and shuts the button behind it.
    expect(onConfirm).toHaveBeenCalledTimes(0)
    expect(screen.getByRole('alert').textContent).toContain(
      'That is very different from your asking price — check the zeros.',
    )
    expect(cta().disabled).toBe(true)

    // ⚠️ THE DOUBLE-TAP TEST. The first design answered its own question with a SECOND TAP ON THE
    // SAME BUTTON — so the hurried seller this check exists for tapped twice and filed at one
    // tenth the price without ever reading the warning. The answer now lives beside the number,
    // and the button under their thumb is dead until it is given.
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledTimes(0)

    // ⚠️ AND FOCUS FOLLOWS THE QUESTION. The press disabled the button that had focus, so without
    // this a keyboard seller is dropped onto <body> and has to tab from the top of the document to
    // reach the only control that lets them continue.
    expect(document.activeElement?.getAttribute('role')).toBe('checkbox')

    // It never BLOCKS: ticking the box is one tap, and the CTA then carries the figure.
    await user.click(screen.getByRole('checkbox', { name: 'Yes, it sold for 1,200,000 VND' }))
    await user.click(screen.getByRole('button', { name: 'Yes, sold at 1,200,000 VND' }))
    expect(onConfirm).toHaveBeenCalledWith({ buyerId: 'u1', price: 1_200_000 })
  })

  it('NEVER accuses the seller of a slip in a figure the sheet itself supplied', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderSheet({
      buyers: [{ id: 'u9', name: 'Huy', acceptedOffer: 2_000_000 }],
    })
    // 2.000.000 accepted on a 12.000.000 listing is far below asking — but it is an offer the
    // system has on record and pre-filled itself, not something anyone typed. Warning about the
    // zeros here is the sheet accusing its own data.
    await user.click(screen.getByRole('radio', { name: /Huy/ }))
    expect(priceField().value).toBe('2,000,000')
    await user.click(cta())
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(onConfirm).toHaveBeenCalledWith({ buyerId: 'u9', price: 2_000_000 })
  })

  it('a refreshed listing price NEVER clobbers the selected buyer accepted offer', async () => {
    const user = userEvent.setup()
    const { update } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Lan/ }))
    expect(priceField().value).toBe('11,000,000') // Lan's accepted offer, untouched

    // ⚠️ THE BUG THIS PINS: the re-anchor used to reach for `asking` unconditionally, so a price
    // edit landing in another tab silently rewrote Lan's agreed 11.000.000 to 13.000.000 while the
    // footer still said "Lan will be asked to confirm" — filing 18% above what she agreed to.
    update({ listing: { ...LISTING, price: 13_000_000 } })
    expect(priceField().value).toBe('11,000,000')
  })

  it('an accepted offer that arrives AFTER the pick still becomes the default', async () => {
    const user = userEvent.setup()
    const { update } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Trang/ })) // no offer yet
    expect(priceField().value).toBe('12,000,000')

    update({ buyers: BUYERS.map((b) => (b.id === 'u3' ? { ...b, acceptedOffer: 9_000_000 } : b)) })
    expect(priceField().value).toBe('9,000,000')
  })

  it('re-anchors an UNTOUCHED price when the listing price changes underneath the open sheet', async () => {
    const { update } = renderSheet()
    expect(priceField().value).toBe('12,000,000')
    update({ listing: { ...LISTING, price: 13_000_000 } })
    expect(priceField().value).toBe('13,000,000')
  })

  it('but leaves a TYPED price alone when that happens', async () => {
    const user = userEvent.setup()
    const { update } = renderSheet()
    await user.clear(priceField())
    await user.type(priceField(), '9500000')
    update({ listing: { ...LISTING, price: 13_000_000 } })
    expect(priceField().value).toBe('9,500,000')
  })

  it('a new figure withdraws the question AND its answer', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.clear(priceField())
    await user.type(priceField(), '1200000')
    await user.click(cta())
    await user.click(screen.getByRole('checkbox', { name: 'Yes, it sold for 1,200,000 VND' }))

    await user.clear(priceField())
    await user.type(priceField(), '120000') // a DIFFERENT suspicious figure
    expect(screen.queryByRole('checkbox')).toBeNull() // the question is withdrawn, not carried over
    await user.click(cta())
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'Yes, it sold for 120,000 VND' })).toBeTruthy()
  })

  it('stays quiet on an ordinary haggle', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.clear(priceField())
    await user.type(priceField(), '10500000')
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledWith({ buyerId: 'u1', price: 10_500_000 })
  })
})

/**
 * ⚠️ EVERY TEST BELOW EXISTS BECAUSE A REVIEWER FOUND THE BUG IT PINS, AND EVERY ONE OF THEM IS AN
 * ASYNC-ARRIVAL CASE: the first draft read `buyers` and `listing` exactly once, at mount, and the
 * original suite only ever passed them synchronously — so the whole class was invisible.
 */
describe('MarkSoldSheet reconciles with props that arrive late or change underneath it', () => {
  it('WHILE THE LIST IS LOADING there is no answer to submit at all', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderSheet({ buyers: [], buyersLoaded: false })
    // "we have not looked yet" must never render as "this sale happened off eno".
    expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(cta().disabled).toBe(true)
    expect(screen.getByText('Looking up who messaged you…')).toBeTruthy()

    // ⚠️ AND THE ROW CANNOT BE TAPPED EITHER. Suppressing the DEFAULT alone was not enough: a
    // seller staring at a list that had not arrived could still answer "nobody messaged me" by
    // hand and be wrong — the same false record, one tap slower.
    await user.click(screen.getByRole('radio', { name: /Someone not on eno/ }))
    expect(cta().disabled).toBe(true)
    await user.click(cta())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('and once the lookup comes back empty, off-eno IS the answer', () => {
    const { update } = renderSheet({ buyers: [], buyersLoaded: false })
    update({ buyers: [], buyersLoaded: true })
    expect(screen.getByRole('radio', { name: /Someone not on eno/ }).getAttribute('aria-checked')).toBe('true')
    expect(cta().disabled).toBe(false)
  })

  it('a list that arrives AFTER the sheet opens un-picks the off-eno default', async () => {
    const { update, onConfirm } = renderSheet({ buyers: [] })
    // While loading, off-eno is the only true answer and is pre-selected.
    expect(screen.getAllByRole('radio')[0].getAttribute('aria-checked')).toBe('true')
    expect(cta().disabled).toBe(false)

    update({ buyers: BUYERS })

    // The moment real people exist, "nobody was on eno" stops being an answer the sheet may assume.
    expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(cta().disabled).toBe(true)
    expect(screen.getByText('Pick who bought it.')).toBeTruthy()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('re-asks even if the seller had TAPPED the off-eno row while the list was empty', async () => {
    const user = userEvent.setup()
    const { update } = renderSheet({ buyers: [] })
    // ⚠️ MEASURED, AND IT IS WHY THIS RESOLVES THE WAY IT DOES. Base UI drives selection off the
    // hidden input's `change` event, and a browser fires none when you click an ALREADY-CHECKED
    // radio (documented at length in ui/radio-group.tsx). So a tap on the pre-selected off-eno row
    // is indistinguishable from no tap at all — there is no "the seller really meant it" bit to
    // preserve.
    await user.click(screen.getByRole('radio', { name: /Someone not on eno/ }))
    update({ buyers: BUYERS })

    // Which lands on the safe side on purpose: once real people exist, the sheet asks again rather
    // than filing "nobody was on eno" for a deal that had a buyer. The cost is one tap in a rare
    // race; the alternative is a false completed-deal record.
    expect(screen.getByRole('radio', { name: /Someone not on eno/ }).getAttribute('aria-checked')).toBe('false')
    expect(cta().disabled).toBe(true)
  })

  it('an off-eno answer given while people ARE listed is never second-guessed', async () => {
    const user = userEvent.setup()
    const { update } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Someone not on eno/ }))
    update({ buyers: [...BUYERS, { id: 'u4', name: 'Huy' }] })
    expect(screen.getByRole('radio', { name: /Someone not on eno/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('a selected person who disappears from a refreshed list is no longer a submittable answer', async () => {
    const user = userEvent.setup()
    const { update, onConfirm } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Lan/ }))
    expect(cta().disabled).toBe(false)

    update({ buyers: BUYERS.filter((b) => b.id !== 'u2') })

    // ⚠️ THE BUG THIS PINS: the footer used to fall through to the off-eno sentence (there was no
    // buyer object to describe) while submit still sent Lan's id — the seller reads "nobody is
    // asked to confirm" and a real person is pinged.
    expect(screen.queryByText('Recorded as sold off eno. Nobody is asked to confirm.')).toBeNull()
    expect(screen.getByText('Pick who bought it.')).toBeTruthy()
    expect(cta().disabled).toBe(true)
    await user.click(cta())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('swapping the LISTING on an open sheet starts a clean answer', async () => {
    const user = userEvent.setup()
    const { update } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Lan/ }))
    expect(priceField().value).toBe('11,000,000')

    update({ listing: { id: 'l2', title: 'iPhone 13', price: 8_000_000 } })

    expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(priceField().value).toBe('8,000,000')
  })
})

describe('MarkSoldSheet files one sale per sale', () => {
  it('a double tap does NOT file two sales, even before the caller sets submitting', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.click(cta())
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('a reported failure RE-ARMS it, so the latch can never strand a retry', async () => {
    const user = userEvent.setup()
    const { onConfirm, update } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledTimes(1)

    update({ errorMessage: 'Could not mark it sold.' })
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('a SECOND failure with the identical message still leaves a retry available', async () => {
    const user = userEvent.setup()
    const { onConfirm, update } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))

    // Two full failure cycles with the SAME message. ⚠️ The first version COMPARED against the
    // snapshot instead of clearing it, and `feedback` is a value that oscillates: the second cycle
    // returned it to the identical string, the latch silently re-engaged, and the seller was left
    // with a visible error and a permanently dead button.
    for (let cycle = 0; cycle < 2; cycle++) {
      await user.click(cta())
      update({ submitting: true, errorMessage: null })
      update({ submitting: false, errorMessage: 'Could not mark it sold.' })
    }
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(cta().disabled).toBe(false)
  })

  it('A SUCCESSFUL write does NOT re-arm it — silence is not permission', async () => {
    const user = userEvent.setup()
    const { onConfirm, update } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledTimes(1)

    // ⚠️ THE CASE AN EARLIER LATCH GOT WRONG. Snapshotting the caller's whole state and releasing
    // on any change released on SUCCESS too: a caller that raises `submitting` and drops it again
    // before closing the sheet (an `await refresh()`, a router transition) handed the seller a live
    // CTA with the same answer still in it. The sheet cannot tell "finished, succeeded" from
    // "finished", so only an error — the caller actually asking for a retry — re-arms it.
    update({ submitting: true })
    update({ submitting: false })
    expect(cta().disabled).toBe(true)
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('never leaves the seller with BOTH buttons dead — Cancel tracks submitting, not the latch', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.click(cta())
    // ⚠️ The latch is engaged here (the CTA is dead) and the caller has reported nothing. Tying
    // Cancel to the latch as well was tried and reverted: it puts a seller under a full-viewport
    // drawer with no working control at all. There is always a way out.
    expect(cta().disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a retry that SUCCEEDS while a stale error is still on screen cannot file a second sale', async () => {
    const user = userEvent.setup()
    const { onConfirm, update } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.click(cta())
    update({ submitting: false, errorMessage: 'Could not mark it sold.' }) // attempt 1 failed
    await user.click(cta()) // retry
    expect(onConfirm).toHaveBeenCalledTimes(2)

    // ⚠️ The caller here never clears the message, so on the way OUT of attempt 2 the sheet sees a
    // spinner going down with an error still set — which is byte-identical to "failed again". An
    // earlier version treated that as permission to re-arm, so a successful retry left a live CTA
    // and one more tap filed the same sale twice. The sheet does not guess; it stays shut.
    update({ submitting: true, errorMessage: 'Could not mark it sold.' })
    update({ submitting: false, errorMessage: 'Could not mark it sold.' })
    expect(cta().disabled).toBe(true)
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('and the caller that DOES clear its error gets a clean retry every time', async () => {
    const user = userEvent.setup()
    const { onConfirm, update } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    // `errorMessage` describes the LATEST attempt — cleared when a new one starts. That is the
    // documented contract, and it is what makes "an error appeared" mean "this attempt failed".
    for (let cycle = 0; cycle < 3; cycle++) {
      await user.click(cta())
      update({ submitting: true, errorMessage: null })
      update({ submitting: false, errorMessage: 'Could not mark it sold.' })
    }
    expect(onConfirm).toHaveBeenCalledTimes(3)
  })

  it('A GIVEAWAY CAN BE RECORDED — a 0 đ listing sells at 0, with no scolding on the way', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderSheet({ listing: { id: 'free-1', title: 'Free sofa', price: 0 } })
    // ⚠️ `asking = 0` leaves the field blank. Flagging that on the first paint is the app scolding
    // the seller for its own data — and requiring a positive figure left them no completable path
    // at all: no truthful number to type, a dead CTA, and an invented price feeding price guidance.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(priceField().getAttribute('aria-invalid')).toBeNull()

    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledWith({ buyerId: 'u1', price: 0 })
  })

  it('but a PRICED listing still refuses an emptied field', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.clear(priceField())
    expect(cta().disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('Enter what it sold for.')
    await user.click(cta())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('a caller that re-enters its loading state cannot revoke an answer already given', async () => {
    const user = userEvent.setup()
    const { update } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Lan/ }))
    // ⚠️ `router.refresh()` in a failure path is the obvious retry shape, and it puts the caller
    // back in "loading". The gate exists to stop an UNINFORMED off-eno answer, not to take a named
    // one away and grey out the list while the seller watches.
    update({ buyersLoaded: false })
    expect(screen.getByRole('radio', { name: /Lan/ }).getAttribute('aria-checked')).toBe('true')
    expect(cta().disabled).toBe(false)
  })

  it('a buyer arriving DURING the write cannot un-say an off-eno answer already sent', async () => {
    const user = userEvent.setup()
    const { onConfirm, update } = renderSheet({ buyers: [] })
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledWith({ buyerId: null, price: 12_000_000 })

    // ⚠️ THE HOLE THIS PINS: the off-eno pre-selection was DERIVED from `buyers.length === 0`, so a
    // late arrival mid-write flipped the answer back to "nothing selected" — which changed the
    // latch's key and re-armed the CTA, and swapped the footer's "nobody is asked to confirm" for
    // "pick who bought it" while the write was still out.
    update({ buyers: BUYERS })
    expect(screen.getByRole('radio', { name: /Someone not on eno/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Recorded as sold off eno. Nobody is asked to confirm.')).toBeTruthy()
    expect(cta().disabled).toBe(true)
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('an anchor change SKIPPED during a write is applied once the sheet is free again', async () => {
    const user = userEvent.setup()
    const { update } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.click(cta())

    // The listing price moves while the answer is out; the guard correctly refuses to touch it.
    update({ listing: { ...LISTING, price: 13_000_000 }, errorMessage: null, submitting: true })
    expect(priceField().value).toBe('12,000,000')

    // ⚠️ AND THE SENTINEL MUST NOT HAVE EATEN IT. Advancing `prevAnchor` inside the outer `if` and
    // then skipping the write consumed the change: the field could never catch up, and a retry
    // filed the old figure against the sheet's own stated rule.
    update({ listing: { ...LISTING, price: 13_000_000 }, submitting: false, errorMessage: 'Could not mark it sold.' })
    expect(priceField().value).toBe('13,000,000')
  })

  it('a prop-driven price change after dispatch cannot re-arm the CTA', async () => {
    const user = userEvent.setup()
    const { onConfirm, update } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Trang/ }))
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledTimes(1)

    // ⚠️ THE HOLE THIS PINS: the latch is keyed on the ANSWER, and the anchor re-sync could move
    // the price from PROPS — a `router.refresh()` returning a new listing price, or a late
    // accepted offer. The answer changed underneath, the latch read "different answer", and a
    // second tap filed a second completed deal at a figure nobody typed.
    update({ listing: { ...LISTING, price: 13_000_000 } })
    expect(priceField().value).toBe('12,000,000')
    expect(cta().disabled).toBe(true)
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('AND THE RETRY ITSELF CANNOT BE DOUBLE-TAPPED — the case the first latch got wrong', async () => {
    const user = userEvent.setup()
    const { onConfirm, update } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.click(cta())
    update({ errorMessage: 'Could not mark it sold.' })

    // ⚠️ The first version tested `dispatched && !errorMessage`, a LEVEL test: with the error
    // still on screen it read "open" during the retry, so tap 2 of a double tap dispatched again —
    // failing on exactly the tap it existed for. Snapshotting the caller's feedback makes it an
    // EDGE test, and this is what proves it.
    await user.click(cta())
    await user.click(cta())
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('editing the answer also re-arms it', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    await user.click(cta())
    await user.click(screen.getByRole('radio', { name: /Trang/ }))
    await user.click(cta())
    expect(onConfirm).toHaveBeenNthCalledWith(2, { buyerId: 'u3', price: 12_000_000 })
  })
})

describe('MarkSoldSheet — the controls and what they promise', () => {
  it('will not submit until someone is picked', async () => {
    const user = userEvent.setup()
    renderSheet()
    expect(cta().disabled).toBe(true)
    expect(screen.getByText('Pick who bought it.')).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    expect(cta().disabled).toBe(false)
  })

  it('tells the seller the buyer will be asked to confirm, and why that matters', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    expect(
      screen.getByText('Minh will be asked to confirm — that is what makes it count for both of you.'),
    ).toBeTruthy()
  })

  it('names its actions in plain words', () => {
    renderSheet()
    expect(screen.getByRole('button', { name: 'Mark as sold' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Asking price' })).toBeTruthy()
  })

  it('cancelling asks the parent to close and submits nothing', async () => {
    const user = userEvent.setup()
    const { onOpenChange, onConfirm } = renderSheet()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('locks the CTA while the caller writes, so one sale cannot be filed twice', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderSheet({ submitting: true })
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    expect(cta().disabled).toBe(true)
    await user.click(cta())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('locks CANCEL while the caller writes — that button must never lie about aborting', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderSheet({ submitting: true })
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    await user.click(cancel)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('but Escape and the swipe handle still work mid-write — ONLY the lying control is locked', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderSheet({ submitting: true })
    await user.keyboard('{Escape}')
    // ⚠️ A DELIBERATE TRADE, AND BOTH SIDES WERE ON THE TABLE. Refusing EVERY route out while
    // `submitting` is set (which an earlier draft did) means a `POST` that never resolves — a
    // dropped mobile connection, a caller that throws before clearing the flag — traps the seller
    // under a full-viewport drawer with no exit but a page reload. Closing the sheet never
    // cancelled the write in either design; what was wrong was a control LABELLED "Cancel"
    // implying it did. So the button is disabled and the unlabelled dismissals stay open.
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange.mock.calls[0][0]).toBe(false)
  })

  it('FREEZES the answer while the caller writes — what is on screen is what is being recorded', async () => {
    const user = userEvent.setup()
    const { update } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    update({ submitting: true })

    await user.click(screen.getByRole('radio', { name: /Trang/ }))
    expect(screen.getByRole('radio', { name: /Minh/ }).getAttribute('aria-checked')).toBe('true')

    await user.clear(priceField())
    expect(priceField().value).toBe('12,000,000')
  })

  it('announces a failed write instead of silently doing nothing', () => {
    renderSheet({ errorMessage: 'Could not mark it sold.' })
    expect(screen.getByRole('alert').textContent).toBe('Could not mark it sold.')
  })

  it('RE-OPENING STARTS CLEAN — a previous sale must not be pre-filled into the next one', async () => {
    const user = userEvent.setup()
    const { setOpen } = renderSheet()
    await user.click(screen.getByRole('radio', { name: /Lan/ }))
    expect(priceField().value).toBe('11,000,000')

    setOpen(false)
    // ⚠️ MEASURED, AND IT IS WHY THE COMPONENT RESETS ITSELF RATHER THAN TRUSTING THE PORTAL:
    // with `open={false}` the popup is STILL in the document (it is mid exit-transition, and in
    // jsdom that transition never finishes) — 4 radios and the money field are all still queryable
    // here. So "closing unmounts the form" is false, and the state would survive into the next
    // sale if the component did not bump its own key.
    expect(screen.queryAllByRole('radio')).toHaveLength(BUYERS.length + 1)
    setOpen(true)

    expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(priceField().value).toBe('12,000,000')
  })
})
