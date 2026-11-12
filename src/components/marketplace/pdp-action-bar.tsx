'use client'

import * as React from 'react'

import { StickyActionBar } from '@/components/ui/sticky-action-bar'
import { ArrowUpRight, MessageCircle } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'

/**
 * THE LISTING'S OWN ACTION, PINNED ONCE ITS BUTTON HAS SCROLLED AWAY (owner, 2026-11-10: "1-6 1 by one go", item 1 of
 * the decision scorecard, which reopened the 2026-07-18 removal of `PdpMobileBar`).
 *
 * The phone benchmark's most repeated finding, on rentals, goods, teachers and jobs alike: one screen down a listing,
 * nothing on screen lets the reader act. Blind A/B against today's pages: codex 7.41 to 7.81, Fable 7.25 to 7.84
 * (ergonomics +1.1 and +1.4).
 *
 * ⛔ IT NEVER TAKES THE NAVIGATION AWAY, WHICH IS WHAT THE OWNER REVERTED IN JULY ("buyers lost the app's navigation on
 * the page they spend the most time on": `PdpMobileBar` hid the tab bar on the whole page). This bar shows only while
 * BOTH hold:
 *   · the page's own action has scrolled off the top of the screen, and
 *   · the tab bar has already left (`useHideOnScroll`, the signal the tab bar itself reads: the reader is moving down).
 * The moment the reader scrolls up the tab bar returns and this bar goes. It only ever fills the slot the tab bar has
 * vacated, and the five tabs are one upward flick away, as on every other page.
 *
 * ⛔ IT IS A REMOTE CONTROL FOR THE PAGE'S OWN BUTTON, NOT A SECOND ACTION. Everything that decides what a reader may do
 * here already lives in the control in the page: the sign-in gate and the opener (contact-composer), the daily limit and
 * the cover ladder (teacher-contact), a closed job (JobApplyGuard), the iOS app's hidden contact, the seller looking at
 * their own listing. Re-deciding any of it here would be a second copy that drifts, so this component READS the control
 * when it is about to show and mirrors it:
 *   · a button (`data-pdp-primary`): the bar's button carries the same words and presses THAT button;
 *   · a link (`data-affiliate-cta`): the bar's link has the same address, the same `rel` and the same target, marked
 *     `data-affiliate-cta-repeat` like the in-flow repeat, so the guest e2e still counts one `[data-affiliate-cta]` and
 *     AffiliateProductStep still hears the click. It carries the page's own words, with ONE exception:
 * ⛔ A 'BUY' LINK READS "Visit shop ↗" / "Đến cửa hàng ↗", AND THE CAPTION UNDER THE PRICE NAMES THE SHOP: "Source: <shop>" /
 *   "Nguồn: <shop>", Seller information's own "Source" row wording, in place of the title (owner, 2026-11-12: "do all with
 *   recommended", i.e. yes to the tested variant B).
 *   WHAT IT REPLACES: until that day this note said the link had "the same words" as the buy box, labelled "owner,
 *   2026-09-30". That day's record (commit 6fb853901) has the owner saying only "do what's recommended" to an in-flow repeat
 *   with the "same target"; "same words" was the implementer's reason, and it still holds for that in-flow repeat
 *   (affiliate-booking.tsx AffiliateCtaRepeat), which keeps the buy box's words.
 *   WHY: "Buy on Tuấn Nguyễn Mobile ↗" filled the 48px button on two lines, squeezed the price block to 127px at 390px
 *   and cut the caption to "Used iPhone 16 128…"; at 320px the three-line rule below took the price away. With "Visit
 *   shop ↗" the button is one line (227 → 144px wide), the price block 210px, and at 320px the price stays. Blind A/B on
 *   eno.vn's goods page (pdp_product, 390px, real scroll) against the bar as it was: gpt-6.1-sol 7.45 → 7.66 (+0.21, trust
 *   +0.3), Opus 7.31 → 7.47 (+0.16, trust ±0), both picked it. The same short words with the title kept as the caption
 *   (variant A) scored +0.18 / +0.13 but LOST trust (−0.2 / −0.1): nothing on the bar said where "Visit shop" goes. Hence
 *   the caption.
 *   WHAT STAYS: the button's accessible name starts with its visible words and names the shop ("Visit shop: <shop>",
 *   WCAG 2.5.3 label in name); the buy box and its in-flow repeat keep "Buy on <shop>", so the listing still names its
 *   source site and its button still opens it (/terms, /regulations Art 3, /partners); Rent on / Book on / Apply on are
 *   mirrored word for word (owner, 2026-09-21: "action button not buy but rent on rever.vn"); a commission link is never
 *   pinned (below). The action and the shop are read from the link's `data-cta-verb` / `data-cta-shop`
 *   (affiliate-booking.tsx), never parsed out of words that arrive in eleven languages. And the short words are only ever
 *   shown BESIDE the caption that names the shop: a 'buy' link with no shop name, or a bar whose price has stepped aside
 *   (the three-line rule below), carries the page's own words.
 * No control, a control that is not rendered, a disabled one: no bar.
 * ⛔ AND IT KEEPS READING WHILE IT IS UP (commit review, 2026-11-10). The page's control changes under it: a press makes
 * Chat now say "Opening chat…" and refuse a second press, sign-in or a language switch replaces its words, a job closes
 * and its Apply goes. The bar watches the block (a MutationObserver, only while shown) and follows: the busy control's
 * words with the action disabled, the new words, or no bar. A press looks the control up afresh and does nothing if it is
 * gone or busy; it never falls back to a node the page has let go of.
 *
 * ⛔ TWO CASES STAY OUT BY THEIR OWN MARK:
 *   · `data-commission` on the link: a commission link carries its disclosure sentence under it wherever it appears
 *     (owner, 2026-10-01, ad labelling), and a bar with that sentence in it is two lines taller than the slot. The mark
 *     is always stated and the bar copies a link only when it reads "false": a link that does not say is left out;
 *   · `data-no-pin` on the block: an e-visa listing's action must follow its disclaimer (2026-09-10), never float free.
 *
 * Geometry: the shared sticky bar's 68px `leading` row at `offsetBottom="0px"`: the tab bar's own top edge, inside the
 * 72px its spacer already reserves under every page (<BottomNavSpacer/>), so the page needs no spacer of its own and
 * nothing in flow moves. Not at the tab bar's `pc` breakpoint: where there is no tab bar there is no slot, and from lg
 * the buy box is sticky beside the text.
 */

/** The top band a sticky header may cover: the page's control counts as gone once its bottom edge is above this. */
const TOP_CLEAR = 64
/** The exit: the bar slides back down for this long, then leaves the DOM (and the back-to-top button's clearance with it). */
const EXIT_MS = 200
/** The action's box at two lines of its label (its 48px floor, plus slack for a fractional line box). Taller = a third line. */
const TWO_LINES = 56
/** globals.css `@custom-variant pc`: the tab bar is not shown here. */
const PC_QUERY = '(min-width: 64rem) and (pointer: fine)'

export type Mirror =
  | { kind: 'button'; what: string; label: string; busy: boolean; press: () => void }
  /** `verb` / `shop`: the link's `data-cta-verb` / `data-cta-shop` (affiliate-booking.tsx), '' when it does not say. */
  | { kind: 'link'; href: string; rel: string; target: string; label: string; verb: string; shop: string; allowed: () => boolean }

/**
 * The page's own primary control inside `block` if it can be acted on NOW: in the document, rendered (the iOS app hides some
 * contact blocks with CSS; a closed job renders no Apply at all), and not under an e-visa block's `data-no-pin`. Every use
 * goes through this, the press included, so a press can never reach a control the page is not showing.
 */
function liveControl(block: Element | null, selector: string): HTMLElement | null {
  if (!block || !block.isConnected || block.hasAttribute('data-no-pin')) return null
  const el = (block.matches(selector) ? block : block.querySelector(selector)) as HTMLElement | null
  if (!el || el.getClientRects().length === 0) return null
  // Boxes are not enough: a control can keep its box and still be out of the reader's reach.
  if (el.closest('[inert]') || getComputedStyle(el).visibility === 'hidden') return null
  return el
}

/**
 * The page's own primary control, as the bar should mirror it now; null when there is nothing to mirror. `find` returns
 * the block afresh each time it is called (the page may have re-mounted it since).
 */
export function readPrimary(block: Element | null, selector: string, find: () => Element | null = () => block): Mirror | null {
  const el = liveControl(block, selector)
  if (!el) return null
  const label = (el.textContent || '').replace(/\s+/g, ' ').trim()
  if (!label) return null
  if (el instanceof HTMLAnchorElement) {
    // ⛔ FAIL CLOSED: only a link the page marks `data-commission="false"`. A commission link ('true') keeps its disclosure
    // sentence under it; a link that does not say is treated as one (commit review, 2026-11-10).
    if (el.getAttribute('data-commission') !== 'false' || !el.href) return null
    // The address, the rel AND the target: the copy opens where the page's own link opens.
    // `allowed`: asked on the click itself, as a button's press is. The copy is followed only while the page still shows
    // that same link (the page can hide it from outside the block, where the observer below does not look).
    const href = el.href
    const allowed = () => { const now = liveControl(find(), selector); return now instanceof HTMLAnchorElement && now.getAttribute('data-commission') === 'false' && now.href === href }
    // Which action the link names and whose site it opens, as the page states them (owner, 2026-11-12: a 'buy' link is
    // pinned as "Visit shop"). Read as data, never parsed out of the words, which are translated.
    const verb = el.getAttribute('data-cta-verb') || ''
    const shop = (el.getAttribute('data-cta-shop') || '').replace(/\s+/g, ' ').trim()
    return { kind: 'link', href, rel: el.rel, target: el.target, label, verb, shop, allowed }
  }
  if ((el as HTMLButtonElement).disabled) return null
  // `aria-disabled` is the page's "working on it" (contact-composer: "Opening chat…"): the bar stays, says so in the page's
  // words and takes no press, instead of vanishing under the finger that just pressed it.
  const busy = el.getAttribute('aria-disabled') === 'true'
  // Pressed through a FRESH lookup of the block and of the control, with every check above made again: React may have
  // replaced either since the bar read them, the page may have hidden the control, and a node the page has let go of is
  // never clicked.
  const press = () => {
    const now = liveControl(find(), selector)
    if (!now || now instanceof HTMLAnchorElement) return
    if ((now as HTMLButtonElement).disabled || now.getAttribute('aria-disabled') === 'true') return
    now.click()
  }
  return { kind: 'button', what: el.getAttribute('data-pdp-primary') || '', label, busy, press }
}

/** Do two readings say the same thing? (`press` is a fresh closure every time and always looks the control up again.) */
function sameMirror(a: Mirror | null, b: Mirror | null): boolean {
  // (`press` and `allowed` are fresh closures every time and always look the control up again.)
  if (!a || !b) return a === b
  if (a.kind !== b.kind || a.label !== b.label) return false
  if (a.kind === 'link' && b.kind === 'link') return a.href === b.href && a.rel === b.rel && a.target === b.target && a.verb === b.verb && a.shop === b.shop
  if (a.kind === 'button' && b.kind === 'button') return a.what === b.what && a.busy === b.busy
  return false
}

export function PdpActionBar({
  price,
  block = '#contact',
  control = '[data-affiliate-cta], [data-pdp-primary]',
  hideWhile,
}: {
  /** The listing's price as the page prints it, for the start of the row; the page's title rides under it. Without one the action takes the whole row. */
  price?: React.ReactNode
  /**
   * The block whose position decides "scrolled away", and inside which the control is looked for.
   * ⛔ AN ELEMENT THE PAGE KEEPS, NEVER THE CONTROL ITSELF: both observers below are bound to this node, and a control is
   * re-mounted by sign-in or a language switch; an observer on a node the page has let go of never fires again (commit
   * review, 2026-11-10: the teacher profile first passed its button as the block).
   */
  block?: string
  /** The page's own primary control, inside the block. */
  control?: string
  /** While this element is on screen the bar stays away: the teacher profile's full contact block further down the page. */
  hideWhile?: string
}) {
  const { tr } = useLanguage()
  const barsHidden = useHideOnScroll()
  const [past, setPast] = React.useState(false)
  const [covered, setCovered] = React.useState(false)
  // `shown` holds what the bar says while it is in the DOM; `open` is whether it is up (false = sliding out).
  const [shown, setShown] = React.useState<{ mirror: Mirror; title: string } | null>(null)
  const [open, setOpen] = React.useState(false)
  // The price steps aside when the action's words need the row (see the layout effect below).
  const [noPrice, setNoPrice] = React.useState(false)
  const wrapRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const el = document.querySelector(block)
    if (!el || typeof IntersectionObserver === 'undefined') return
    // Past = out of view AND above the screen (out of view below it is "not reached yet").
    // ⚠️ THE LAST ENTRY, NOT THE FIRST: a fast fling past the block and back can queue two entries for one callback, and
    // the first is the older (commit review, 2026-11-10: read first, `past` ended up inverted until the next crossing).
    // ⚠️ The BLOCK, not the button inside it: the button is re-mounted by sign-in and by a language switch, and an
    // observer on a node the page has let go of never fires again. The block is at most a few lines taller.
    const io = new IntersectionObserver((entries) => { const e = entries[entries.length - 1]; setPast(!e.isIntersecting && e.boundingClientRect.bottom <= TOP_CLEAR) }, { rootMargin: `-${TOP_CLEAR}px 0px 0px 0px` })
    io.observe(el)
    const other = hideWhile ? document.querySelector(hideWhile) : null
    const io2 = other ? new IntersectionObserver((entries) => setCovered(entries[entries.length - 1].isIntersecting)) : null
    if (other && io2) io2.observe(other)
    return () => { io.disconnect(); io2?.disconnect() }
  }, [block, hideWhile])

  // Never where there is no tab bar (its own `pc` breakpoint): the class below hides the bar there, and this keeps it out
  // of the DOM too, so nothing floating is told to clear a bar nobody can see. Subscribed, so a window dragged across
  // the breakpoint (or a tablet gaining a mouse) is followed without waiting for the next scroll.
  const [pc, setPc] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia?.(PC_QUERY)
    if (!mq) return
    const sync = () => setPc(mq.matches)
    sync()
    mq.addEventListener?.('change', sync)
    return () => mq.removeEventListener?.('change', sync)
  }, [])

  const wanted = past && barsHidden && !covered && !pc
  React.useEffect(() => {
    if (!wanted) {
      setOpen(false)
      const t = window.setTimeout(() => setShown(null), EXIT_MS)
      return () => window.clearTimeout(t)
    }
    // Read the page's control at the moment the bar is about to show, never before: by then the page has hydrated,
    // auth has settled and the control says what this reader may do. The title is the page's own <h1>, in the
    // reader's language, as the page shows it.
    const find = () => document.querySelector(block)
    const host = find()
    const read = () => {
      const mirror = readPrimary(find(), control, find)
      const title = (document.querySelector('main h1')?.textContent || '').replace(/\s+/g, ' ').trim()
      setShown((prev) => (prev && mirror && prev.title === title && sameMirror(prev.mirror, mirror) ? prev : mirror ? { mirror, title } : null))
      setOpen(!!mirror)
    }
    setNoPrice(false)
    read()
    // …and again whenever the page's control changes while the bar is up (see the note at the top).
    // …and when the window changes size: a breakpoint can hide the page's control (the teacher's button leaves at lg) or
    // give the price its room back, and neither is a mutation. The price gets a fresh measurement with the new width.
    const onResize = () => { setNoPrice(false); read() }
    window.addEventListener('resize', onResize)
    const mo = host && typeof MutationObserver !== 'undefined' ? new MutationObserver(read) : null
    if (mo && host) mo.observe(host, { subtree: true, childList: true, characterData: true, attributes: true })
    return () => { window.removeEventListener('resize', onResize); mo?.disconnect() }
  }, [wanted, block, control])

  /**
   * ⛔ THE ACTION'S WORDS ARE NEVER SQUEEZED INTO THREE LINES TO KEEP A PRICE BESIDE THEM. Measured at 320px: "Buy on Tuấn
   * Nguyễn Mobile" beside "12,000,000 đ" wrapped to three lines, the bar grew from 68 to 92px, and the install card above it
   * hopped 24px every time the bar came and went (layout shift 0.02 a time). The action is the bar's purpose and the price
   * is its caption, so when the action stands taller than its two-line box the price goes and the action takes the row.
   * A measurement, not a width rule: it also holds for a long partner name on a wide phone and for a reader's larger text
   * size. In a layout effect, so the three-line state is never painted, and re-checked when the action's box changes.
   * (Since 2026-11-12 that listing's bar reads "Visit shop ↗" beside the price, one line, so it no longer trips this; when
   * the rule does trip on a 'buy' link, the caption naming the shop goes with the price and the words go back to the
   * page's own "Buy on <shop>", which name it. See the note at the top.)
   */
  React.useLayoutEffect(() => {
    if (!shown || noPrice || !price) return
    const action = wrapRef.current?.querySelector<HTMLElement>('[data-action="primary"]')
    if (!action) return
    const check = () => { if (action.offsetHeight > TWO_LINES) setNoPrice(true) }
    check()
    // The row can narrow, or the reader's text grow, while the bar is up.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(action)
    return () => ro.disconnect()
  }, [shown, noPrice, price])

  if (!shown) return null
  const { mirror, title } = shown
  // The price block stands beside the action (the rule above has not moved it aside).
  const withPrice = !!price && !noPrice
  // ⛔ A 'buy' link: "Visit shop ↗", and the caption under the price says whose shop (owner, 2026-11-12; the note at the top).
  // Only while that caption is on screen: with no shop name, or no price block, the shop would be named nowhere on the bar.
  const shop = mirror.kind === 'link' && mirror.verb === 'buy' && withPrice ? mirror.shop : ''
  const visit = shop ? tr('Visit shop', 'Đến cửa hàng') : null
  // Seller information's own words for the shop ("Source" / "Nguồn", seller-info.tsx), the shop's name as written.
  const caption = shop ? `${tr('Source', 'Nguồn')}: ${shop}` : title

  return (
    // A box of no size around a fixed bar: somewhere to measure from, and `inert` the moment the bar starts to leave, so
    // nothing in it takes a key press or focus during the 200ms it is sliding out.
    <div ref={wrapRef} data-pdp-bar="" inert={!open}>
    <StickyActionBar
      // Leaving: the same slide the bar arrived with, reversed, and no taps on the way out.
      className={open ? 'pc:hidden' : 'pc:hidden pointer-events-none translate-y-full opacity-0 duration-200 ease-out'}
      offsetBottom="0px"
      label={tr('This listing', 'Tin đăng này')}
      // `null`, never undefined: the bar is the 68px row either way (ui/sticky-action-bar `leading`).
      leading={withPrice ? (
        <>
          <div data-pdp-bar-price="" className="truncate">{price}</div>
          {/* `w-0 min-w-full`: the caption (the title, or a 'buy' link's "Source: <shop>") fills the block and never widens it.
              The block's own width is the price's, so a long caption cannot push the action into wrapping. */}
          {caption ? <p className="w-0 min-w-full truncate text-xs text-muted-foreground">{caption}</p> : null}
        </>
      ) : null}
      primary={mirror.kind === 'link'
        ? {
            label: <>{visit ?? mirror.label} <ArrowUpRight className="size-4" aria-hidden /></>,
            // The visible words first, then the shop they lead to (WCAG 2.5.3): "Visit shop: Tuấn Nguyễn Mobile".
            ariaLabel: visit ? `${visit}: ${shop}` : undefined,
            render: <a href={mirror.href} target={mirror.target || undefined} rel={mirror.rel} data-affiliate-cta-repeat="true" data-pdp-bar-action="" />,
            // Not followed if the page no longer shows this link (see `allowed`).
            onClick: (e) => { if (!mirror.allowed()) e.preventDefault() },
          }
        : {
            label: mirror.label,
            icon: mirror.what === 'chat' && !mirror.busy ? <MessageCircle className="h-4 w-4" /> : undefined,
            disabled: mirror.busy,
            onClick: mirror.press,
          }}
    />
    </div>
  )
}
