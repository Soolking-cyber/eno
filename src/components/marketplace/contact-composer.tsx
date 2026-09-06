'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Tag, Send, MessageCircle, Route, Loader2 } from '@/components/ui/icons'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { EnoSlider } from './eno-slider'
import { Button } from '@/components/ui/button'
import { stashCompose } from '@/lib/quick-contact'
import { hapticTap, hapticConfirm } from '@/lib/haptics'
import { scrollBehavior } from '@/lib/reduced-motion'

const MAX_DISCOUNT = 50 // % off the asking price the slider allows
export { COMPOSE_KEY } from '@/lib/quick-contact' // re-export: the key + writer live in the lib

/**
 * Unified contact + offer on the listing detail. No typing required: the SellerCard's
 * "Chat now" sends the canned opener ("Hi! Is this still available?") straight through
 * — one tap to a live thread. Below it, on any negotiable listing, the offer slider is
 * ALWAYS open (no trigger, no ✕): drag a discount, send a structured offer; still no
 * free-text box. On send we REDIRECT INSTANTLY to /messages/pending (no button
 * spinner); that resolver creates the conversation + posts the message/offer in the
 * background and swaps to the real thread. "Redirect first, load in background."
 */
export function ContactComposer({
  listingId, listingTitle, listingImage, sellerName, price, currency, negotiable = true,
  intent = 'buy',
}: {
  listingId: string
  listingTitle?: string
  listingImage?: string | null
  sellerName?: string
  price?: number
  currency: string // raw listing currency, e.g. '₫'
  negotiable?: boolean // false = fixed price → no offer control (ask directly)
  /**
   * What the traveller is starting, which decides the button, the canned opener and the
   * reassurance line beneath.
   *
   * ⚠️ 'plan' exists because the trip desk is not a stranger selling an object. The default
   * opener ("Is this still available?") is nonsense addressed to a planning service, and the
   * default footnote tells the buyer to ask for a phone number — advice about dealing with
   * strangers, aimed at eno's OWN desk. Since 2026-07-28 it sends NO opener at all: it opens the
   * thread and the itinerary wizard with it (see `chatNow`).
   *
   * It lives HERE rather than as a bespoke block on the PDP because the owner asked for ONE
   * button (2026-07-26) and the call site had grown a second CTA beside this one. When a call
   * site starts building its own version of a primitive, the primitive is what needs the
   * variant.
   */
  intent?: 'buy' | 'plan'
}) {
  const { user, loading, openSignIn } = useAuth()
  const { lang, tr } = useLanguage()
  const locale = moneyLocale(lang) // offer amounts follow the viewer's language
  const router = useRouter()
  // The offer is ALWAYS open on a negotiable listing (user decisions 2026-07-14): the
  // slider IS the negotiation invitation — hiding it behind a button buried the
  // marketplace's core ritual, and a ✕ to close it just gave the buyer a way to hide
  // the thing they came for. There is no `offering` state any more. The default
  // discount scales with the ticket: 5% on ordinary items, 1% on ≥1 tỷ đ (cars,
  // apartments), where 5% is tens of millions and reads as a lowball.
  const [discount, setDiscount] = useState(typeof price === 'number' && price >= 1_000_000_000 ? 1 : 5) // % off

  // Offers are only possible on a negotiable, priced listing.
  const hasPrice = typeof price === 'number' && price > 0
  const canOffer = hasPrice && negotiable
  const offerPrice = hasPrice ? Math.round(price! * (1 - discount / 100)) : 0

  const planning = intent === 'plan'
  const opener = () => tr('Hi! Is this still available?', 'Chào bạn! Món này còn không?')

  // Stash the first message + optional STRUCTURED offer (offerAmount — never a baked
  // text line, so it lands as a proper offer card kind='offer'), then redirect
  // instantly. The /messages/pending resolver posts it and swaps to the real thread.
  // A tap that lands while auth is still resolving is BUFFERED here (not dropped)
  // and drained by the effect below once `loading` settles — an early "Chat now"
  // click used to silently no-op, which e2e papered over with retries.
  const pendingRef = useRef<{ body?: string; offerAmount?: number | null; plan?: boolean } | null>(null)
  /**
   * ⚠️ THE PRIMARY CTA HAD NO PENDING STATE, AND THE WORST CASE WAS SILENT FOR SECONDS.
   * `send()` either buffers (auth still resolving) or stashes and pushes to /messages/pending —
   * a client navigation that fetches an RSC payload. Neither showed the buyer anything, so the
   * most consequential tap in the product answered with nothing and the natural response is to
   * tap again. A design review scored "visibility of system status" 2/4 on exactly this.
   *
   * `busy` covers BOTH waits with one flag, because from the buyer's side they are one wait:
   * "I asked to talk to this seller and it has not happened yet".
   * ⚠️ It is NOT cleared on the success path on purpose — the navigation unmounts this component,
   * and clearing it first would flash the idle label for a frame before the page changes. It IS
   * cleared whenever the flow stops here instead: a guest hitting the sign-in dialog, or a stash
   * failure. Anything that leaves the buyer on this page must leave the button usable.
   */
  const [busy, setBusy] = useState(false)
  const send = (opts: { body?: string; offerAmount?: number | null; plan?: boolean }) => {
    // Until auth resolves, treat as not-ready: don't push to /messages/pending
    // (which would 401-bounce). Prompt only once we know they're truly logged out.
    if (!user) {
      if (loading) { pendingRef.current = opts; return }
      setBusy(false) // the sign-in dialog is the answer; the buyer stays here and may retry
      openSignIn({ listingTitle, listingImage, sellerName })
      return
    }
    const offerAmount = opts.offerAmount ?? null
    // Shared single writer (src/lib/quick-contact) — a stash failure is deliberately
    // ignored here: the pending page falls back to /messages.
    stashCompose({ listingId, body: opts.body, offerAmount, listingTitle, listingImage, price, currency, plan: opts.plan })
    router.push('/messages/pending')
  }

  /**
   * ⚠️ A BACKSTOP, BECAUSE A STUCK SPINNER IS WORSE THAN NO SPINNER. The success path never
   * clears `busy` — the navigation unmounts this component, which is the correct and flicker-free
   * exit. But that makes the flag depend on a navigation actually happening. If `router.push`
   * stalls (a dead network mid-RSC-fetch is the realistic one), the buyer is left on the PDP
   * looking at "Opening chat…" forever, with the guard refusing further taps: a silent button, the
   * exact defect this state was added to remove, only now permanent.
   * 8s is chosen to be well past any plausible navigation on a slow connection — measured LCP on
   * this app at fast-3G+4x CPU is ~3s — so it should never fire on a healthy path. If it fires,
   * the button simply becomes pressable again.
   */
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => {
      // ⚠️ DISARM THE BUFFERED INTENT TOO, or the backstop creates the race it exists to prevent:
      // the button becomes pressable again while `pendingRef` is still loaded, so a re-tap would
      // stash once immediately AND once more when auth resolves and the drain fires. Releasing
      // the button has to mean releasing the whole attempt.
      pendingRef.current = null
      setBusy(false)
    }, 8000)
    return () => clearTimeout(t)
  }, [busy])

  // Drain a buffered intent once auth resolves: send() then routes it (signed-in →
  // stash + redirect; signed-out → sign-in prompt). One-shot: cleared before replay.
  useEffect(() => {
    if (loading || !pendingRef.current) return
    const opts = pendingRef.current
    pendingRef.current = null
    send(opts)
  }, [user, loading])

  // Touch feedback on the two highest-commitment taps in the app. Fired in the gesture
  // handler (never in send(), which also runs from the deferred auth drain — a buzz
  // arriving after the fact would confirm a tap the user has already forgotten about).
  //  · Chat now = a light tap: it acknowledges the press, the thread is the real payoff.
  //  · Send offer = the success texture, but ONLY when the offer will actually go out.
  //    A signed-out tap just opens sign-in — a normal gate, neither a success (lying) nor
  //    an error (punishing a guest for being a guest) — so it gets the same light tap.
  /**
   * ⚠️ THE PLANNER OPENS THE FORM; IT DOES NOT SAY HELLO. This button used to post
   * "Hi! I'd like to plan a trip to Vietnam." and stop there, on the theory that the line "doubles
   * as the wizard's cue". Nothing read it as a cue — the wizard is started by its own chip — so the
   * owner tapped it ten times on 2026-07-27/28 and got ten identical messages and no form
   * ("when i click plan my trip it just sends message instead of giving me the form"). A CTA that
   * names a form has to produce one.
   *
   * The canned opener stays for ORDINARY listings, where it is doing real work: it is a stranger's
   * first line to a seller, and typing it is the friction the one-tap flow exists to remove. There
   * is no equivalent for the desk's own planning service.
   */
  // `setBusy(true)` sits in the GESTURE handler, not in send(), for the same reason the haptic
  // does: send() also runs from the deferred auth drain, and a spinner starting there would
  // appear without a tap behind it.
  // ⚠️ THE `busy` GUARD IS LOAD-BEARING, NOT COSMETIC. Without it a second tap during the wait
  // calls stashCompose again and pushes a second navigation — and the whole reason this state
  // exists is that a silent button INVITES a second tap. `aria-disabled` announces it; this
  // returns early so the announcement is true.
  const chatNow = () => {
    if (busy) return
    hapticTap(); setBusy(true); send(planning ? { plan: true } : { body: opener() })
  }
  const sendOffer = () => {
    if (!canOffer) return
    // ⚠️ THE SAME GUARD, BECAUSE THE TWO BUTTONS SHARE `send()`. Gating only `chatNow` left the
    // double-send reachable through the adjacent control: during "Opening chat…" a tap on Send
    // offer fired a second stashCompose + push and clobbered the stashed opener. A reviewer caught
    // that the guard's own comment claimed more than the code did. If a third caller of send() is
    // ever added, it needs this line too.
    if (busy) return
    setBusy(true)
    if (user) hapticConfirm()
    else hapticTap()
    send({ offerAmount: offerPrice })
  }

  // Deep-link (/listings/id#contact): scroll the composer into view. ?offer=N (a card
  // quick-offer) pre-sets the slider to that discount; a plain #contact just brings the
  // composer into view — a shared link must NOT auto-fire a message.
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#contact') return
    const offerParam = Number(new URLSearchParams(window.location.search).get('offer'))
    // Ignore a stray ?offer= on a fixed-price listing (stale card link) — no offers here.
    const quickOffer = negotiable && Number.isFinite(offerParam) && offerParam >= 1 && offerParam <= MAX_DISCOUNT ? Math.round(offerParam) : null
    const t = window.setTimeout(() => {
      document.getElementById('contact')?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
      if (quickOffer != null) setDiscount(quickOffer)
    }, 150)
    return () => window.clearTimeout(t)
  }, [])

  // The SellerCard's "Chat now" sends the opener directly (one tap → live thread).
  // (There was an 'eno:open-offer' listener here too; it existed to un-collapse the
  // offer, nothing dispatches it any more, and the offer no longer collapses.)
  useEffect(() => {
    const onChat = () => chatNow()
    window.addEventListener('eno:chat-now', onChat)
    return () => window.removeEventListener('eno:chat-now', onChat)
  }, [canOffer, user, loading])

  // "Chat now" is now this composer's OWN primary CTA (moved here 2026-07-17 when the seller card
  // was consolidated into the shop-on-top link, which took over the identity/trust). chatNow() sends
  // the canned opener straight to a thread and gates guests to sign-in; the composer still ALSO
  // answers the eno:chat-now event (the mobile action bar).
  const safetyLine = (
    <p className="text-center text-xs text-muted-foreground">
      {planning
        // The desk is eno's own, so stranger-safety advice is both irrelevant and slightly
        // alarming here. Say what the tap actually does instead, including that it is free —
        // that reassurance was the one thing worth keeping from the block this replaced.
        ? tr('Free — you answer a few questions in the chat and get a day-by-day plan.', 'Miễn phí — bạn trả lời vài câu hỏi trong khung chat và nhận lịch trình theo từng ngày.')
        : tr('Request their number once they reply — one number works for both Zalo and WhatsApp.', 'Yêu cầu số điện thoại sau khi họ trả lời — một số dùng được cho cả Zalo và WhatsApp.')}
    </p>
  )
  const chatButton = (
    <Button
      type="button"
      variant="cta"
      size="none"
      onClick={chatNow}
      // No `active:scale-100` here. It used to sit alongside `press` to stop ui/button's
      // `active:scale-[0.97]` compounding with the press shrink — but .press now writes the
      // same `scale` property from @layer components, so the button's own value simply wins
      // and there is nothing to cancel. Keeping the class would now READ as "no press feel"
      // and actually DELIVER it, silently killing the tactile press on the PDP's main CTA.
      // ⚠️ `min-h-11` = 44px, THE TAP FLOOR — this is the PDP's primary action and it measured
      // 366×40 (`size="none"` + `py-2.5` leaves 20px of padding around a 20px line). 40px is
      // under the 44px minimum every touch guideline agrees on, on the one control the whole
      // page exists to get pressed. A floor, not fixed padding, so a wrapped label grows past
      // it instead of being clipped.
      // `aria-busy` rather than `disabled`: a disabled button drops out of the a11y tree and stops
      // announcing, so a screen-reader user would hear silence exactly when a sighted user sees the
      // spinner. `aria-disabled` + the guard in chatNow blocks the double-send instead.
      aria-busy={busy}
      aria-disabled={busy}
      // `aria-disabled:cursor-wait` — a reviewer noted an inert control still offering a click-me
      // cursor. The button stays visually undimmed on purpose: it is not disabled, it is working.
      className="press flex min-h-11 w-full items-center justify-center gap-1.5 py-2.5 cursor-pointer aria-disabled:cursor-wait"
    >
      {busy
        // ⚠️ THE LABEL CHANGES, NOT JUST THE ICON. A spinner beside an unchanged "Chat now" reads
        // as the button still asking to be pressed. Naming the state — "Opening chat…" — is what
        // makes the wait legible, and it is the difference the status heuristic was scoring.
        // ⚠️ ONE LABEL FOR BOTH BRANCHES, DELIBERATELY. The planning branch first said "Opening the
        // planner…", which reads better — and was wrong twice over. Both branches do the same
        // thing (open a chat thread), so the extra wording bought nothing; and it would have put
        // NEW itinerary vocabulary into `ui-strings.ts`, the catalogue eno.vn ships to every
        // browser. The planning branch cannot render on the marketplace edition (the PDP resolves
        // through `scopedListingWhere`, which excludes the desk's rows) but the STRING would still
        // be in the artifact, and that is the standard this repo holds the edition split to. A
        // reviewer flagged it; adding a licensing surface for a nicer verb is a bad trade.
        ? <><Loader2 className="h-4 w-4 animate-spin" /> {tr('Opening chat…', 'Đang mở khung chat…')}</>
        : planning
          ? <><Route className="h-4 w-4" /> {tr('Plan my trip in chat', 'Lên lịch trình trong chat')}</>
          : <><MessageCircle className="h-4 w-4" /> {tr('Chat now', 'Chat ngay')}</>}
    </Button>
  )

  // Fixed-price listing: no offer → Chat now + the safety reminder.
  if (!canOffer) return <div className="space-y-2">{chatButton}{safetyLine}</div>

  if (!loading && !user) {
    return (
      <div className="space-y-2">
        {chatButton}
        <Button
          type="button"
          variant="bare"
          size="none"
          onClick={() => openSignIn({ listingTitle, listingImage, sellerName })}
          // `active:scale-100` dropped — see the note on chatButton above.
          // `min-h-11` for the same reason as chatButton above — this measured 366×40 too, and
          // it is the second-most-important action on the page.
          // `items-center` comes WITH the floor and is not optional: a min-height taller than the
          // content leaves the icon and label hanging at the top of the box without it.
          // ⚠️ Horizontal alignment is deliberately NOT touched. A `justify-center` briefly rode
          // along here and a reviewer flagged it as an undisclosed visual change — correct: this
          // row is left-aligned today, that is a design decision nobody asked to revisit, and a
          // tap-target fix is the wrong place to smuggle one.
          className="press flex min-h-11 w-full cursor-pointer items-center gap-1.5 py-2.5 font-bold text-accent-foreground hover:bg-tint"
        >
          <Tag className="h-4 w-4" /> {tr('Sign in to make an offer', 'Đăng nhập để trả giá')}
        </Button>
        {safetyLine}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* The offer is always open on a negotiable listing (user decisions 2026-07-14:
          haggling is the norm here, so it opens at a default discount). There's no
          close ✕ and no "Make an offer" trigger — nothing to close it TO: leaving the
          slider untouched already costs the buyer nothing, and Chat now sits beside
          Send offer (owner 2026-07-18: one 70/30 row) for anyone who doesn't want
          to haggle. The standalone full-width Chat now remains for fixed-price and
          signed-out listings above. */}
      <div className="rounded-2xl bg-accent p-3">
        <span className="text-xs font-semibold text-body">{tr('Your offer', 'Giá đề nghị')}</span>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-price tabular-nums">{formatMoneyFull(offerPrice, currency, locale)}</span>
          {/* text-body, not muted-foreground: the latter is ~3.5:1 on the bg-accent
              tint → a serious WCAG AA contrast failure (axe caught it on the PDP). */}
          <span className="text-xs font-semibold text-body">−{discount}%</span>
        </div>
        <EnoSlider
          min={0} max={MAX_DISCOUNT} step={1} value={discount}
          onChange={setDiscount}
          aria-label={tr('Discount', 'Mức giảm')}
          className="mt-2"
        />
        <div className="flex justify-between text-3xs font-medium text-ink-4">
          <span>{tr('Asking', 'Giá rao')}: {formatMoneyFull(price!, currency, locale)}</span>
          <span>−{MAX_DISCOUNT}%</span>
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            variant="cta"
            size="none"
            onClick={sendOffer}
            className="flex min-w-0 basis-[70%] items-center justify-center gap-2 rounded-xl py-2.5 text-sm transition active:scale-[0.96] cursor-pointer"
          >
            <Send className="h-4 w-4 shrink-0" />
            <span className="truncate">{tr('Send offer', 'Gửi đề nghị')} · {formatMoneyFull(offerPrice, currency, locale)}</span>
          </Button>
          <Button
            type="button"
            variant="bare"
            size="none"
            onClick={chatNow}
            // `active:scale-100` dropped — see the note on chatButton above.
            className="press flex min-w-0 basis-[30%] items-center justify-center gap-1.5 rounded-xl bg-card py-2.5 text-sm font-bold text-accent-foreground hover:bg-tint cursor-pointer"
          >
            <MessageCircle className="h-4 w-4 shrink-0" /> <span className="truncate">{tr('Chat now', 'Chat ngay')}</span>
          </Button>
        </div>
      </div>

      {safetyLine}
    </div>
  )
}
