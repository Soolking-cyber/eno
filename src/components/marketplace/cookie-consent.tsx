'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLanguage } from '@/context/language-context'
import { getConsent, setConsent, syncConsentCookie } from '@/lib/consent'
import { Mascot } from './mascot'
import { cn } from '@/lib/utils'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'

import { ShieldCheck, Sparkles, MessageCircle } from '@/components/ui/icons'

/**
 * ⚠️ THE ONE ROUTE THIS CARD MUST NOT COVER. `/signin` centres the sign-in card in exactly the
 * place this one occupies; see the note in the auto-open effect. Named rather than inlined because
 * two separate checks read it and they must never drift apart.
 */
const SIGNIN_PATH = '/signin'

function Toggle({ title, desc, value, onChange, locked = false }: { title: string; desc: string; value: boolean; onChange?: (v: boolean) => void; locked?: boolean }) {
  return (
    <Button
      variant="bare"
      size="none"
      type="button"
      disabled={locked}
      onClick={() => onChange?.(!value)}
      className={cn('flex w-full items-start gap-2.5 whitespace-normal rounded-lg p-1.5 text-left transition-colors font-normal disabled:opacity-70', locked ? 'opacity-70' : 'hover:bg-muted cursor-pointer')}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-2xs leading-snug text-ink-4">{desc}</span>
      </span>
      <span className={cn('mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors', value ? 'bg-primary' : 'bg-line-strong')}>
        <span className={cn('h-4 w-4 rounded-full bg-white shadow-sm transition-transform', value && 'translate-x-4')} />
      </span>
    </Button>
  )
}

/**
 * How long the home page gets to itself before the first-visit consent card appears.
 *
 * Owner asked for "3-5 seconds"; 4s is the middle of that and is deliberately a named constant
 * rather than an inline literal, because the value is a product decision (how long the page reads
 * as uninterrupted) and not a timing detail. ⚠️ It applies ONLY to the automatic first-visit
 * prompt — the footer's "Cookie settings" re-open is a direct response to a click and must stay
 * instant, or the withdrawal path feels broken.
 */
const SHOW_AFTER_MS = 4_000

/** Sleek, compact consent banner — a horizontal card with the shield mascot filling
 *  the height on the left and tight copy + slim actions on the right. "Allow" turns on
 *  personalized recommendations + ad signals; "Settings" fine-tunes each or declines. */
export function CookieConsent() {
  const { tr } = useLanguage()
  // Where initial focus goes when the dialog opens — see initialFocus on the Popup below.
  const popupRef = useRef<HTMLDivElement>(null)
  /**
   * The pending first-visit timer, so `close()` can CANCEL it.
   *
   * ⚠️ THE GUARD INSIDE THE CALLBACK IS NOT ENOUGH ON ITS OWN, and review had to point that out
   * twice before this was right. Re-reading `getConsent()` covers "the user DECIDED during the
   * delay". It does not cover "the user LOOKED AND LEFT" — opening the footer's Cookie settings at
   * t=2s, reading it, and closing with Esc without choosing. Consent is still null, so the timer
   * fired and the card reappeared unbidden seconds after they dismissed it. Cancelling on close
   * covers both, and is the behaviour a person would describe as "I closed it".
   */
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [show, setShow] = useState(false)
  /**
   * Did the CARD open because the user asked for it (footer "Cookie settings"), or did it appear on
   * its own after the delay? Only the first may move focus — see `initialFocus` on the Popup.
   */
  const pathname = usePathname()
  const [openedByUser, setOpenedByUser] = useState(false)
  /** Latches on the first open so the popup survives its own closing frame — see the note below. */
  const [everShown, setEverShown] = useState(false)
  /** The auto-open fired while the visitor was on /signin; show it once they are elsewhere. */
  const [deferred, setDeferred] = useState(false)
  const [view, setView] = useState<'ask' | 'settings'>('ask')
  const [perso, setPerso] = useState(true)
  const [ads, setAds] = useState(true)

  /**
   * ⚠️ THE FIRST-VISIT PROMPT IS DELAYED; THE FOOTER RE-OPEN BELOW IS NOT.
   *
   * The page gets `SHOW_AFTER_MS` to itself before the card appears. Two reasons, and the second is
   * the one that costs money if it regresses:
   *   · A consent card that paints in the same frame as the hero reads as an interstitial. Letting
   *     the home page land first makes it an interruption of a page the visitor is already looking
   *     at, which is also the shape PDPL guidance describes.
   *   · Google's OAuth brand reviewer is ALWAYS a first visit, so whatever auto-opens is what they
   *     screenshot. Three verification rejections came out of that (see the note on the wrapper
   *     below); a few seconds of unobstructed home page is free insurance on the next review.
   *
   * Cleared on unmount so a fast navigate-away cannot fire setState on a dead component.
   */
  useEffect(() => {
    syncConsentCookie()
    if (getConsent() !== null) return
    /**
     * ⛔ DEFERRED, NOT SUPPRESSED, ON THE SIGN-IN ROUTE — AND THE FIRST VERSION OF THIS GUARD GOT
     * THAT WRONG. This card is `fixed inset-0 … items-center justify-center` — dead centre of the
     * viewport by design, and with no backdrop it simply sits over whatever is there. `/signin` now
     * centres the sign-in card in the same place (it renders the popup's own `<SignInCard>`), so
     * the two overlapped almost perfectly: measured on a 1440x900 build, the consent card covered
     * the heading, the Google button, the email field and the submit, leaving only the legal line
     * and "Back to eno.vn" visible around its edges. Reported as the page being "empty", which is
     * exactly how it reads.
     * ⛔ BUT A BARE `return` HERE WOULD HAVE SUPPRESSED CONSENT FOR THE WHOLE SESSION, not deferred
     * it, and the comment claiming otherwise would have been false. This component is mounted from
     * a layout that never unmounts, so a visitor who ENTERS at /signin — a magic-link landing, an
     * OAuth return, any of the twelve `redirect('/signin?next=…')` guards — and then navigates on
     * would never remount it, the effect would never re-run, and they would never be asked at all.
     * A reviewer traced it. On a PDPL surface, silently never asking is the worse failure.
     * ⚠️ SO THE TIMER STILL RUNS ON /signin AND PARKS ITS RESULT. Re-keying this whole effect on
     * the pathname would have been the other trap: the delay would restart on every navigation, and
     * someone clicking through pages faster than that would never see the card either.
     */
    const t = setTimeout(() => {
      autoTimer.current = null
      /**
       * ⚠️ RE-READ THE CHOICE INSIDE THE CALLBACK — the delay opened a window that did not exist
       * before, and review caught it. Four seconds is plenty of time for the visitor to open the
       * footer's "Cookie settings" themselves, decide, and close; the timer would then fire and
       * re-open the card on top of a decision they just made. The same applies to a choice stored
       * in ANOTHER TAB during the delay. The immediate version could not hit either case, because
       * it read and showed in the same tick.
       */
      if (getConsent() !== null) return
      if (window.location.pathname === SIGNIN_PATH) setDeferred(true)
      else setShow(true)
    }, SHOW_AFTER_MS)
    autoTimer.current = t
    return () => clearTimeout(t)
  }, [])

  /**
   * ⚠️ KEYED ON `pathname`, WHICH IS THE HALF THE TIMER CANNOT DO. `usePathname()` re-renders on a
   * client-side navigation where a mount effect does not, so this is what actually delivers the
   * "asked on the next page" promise above. It fires at most once — `setShow(true)` and the
   * consent write both close it off.
   */
  useEffect(() => {
    /**
     * ⚠️ CONSENT DECIDED ELSEWHERE ENDS THE DEFERRAL TOO — another tab, or the footer's settings.
     * Without clearing the flag it would dangle for the life of a layout that never unmounts. It
     * renders nothing either way; a reviewer was right that it is exactly the stale state the
     * comment above claims cannot happen.
     */
    if (getConsent() !== null) { setDeferred(false); return }
    /**
     * ⛔ AND A CARD THAT IS ALREADY OPEN STEPS ASIDE WHEN THE VISITOR ARRIVES AT /signin. The timer
     * check cannot cover this: the card may have opened legitimately on `/` and the visitor then
     * navigate to the sign-in route, where it lands on the form exactly as before. Measured, the
     * realistic path self-resolves — clicking a sign-in link is an outside press, which dismisses
     * this non-modal dialog on the way out — but that makes the invariant accidentally true rather
     * than true, and a Back navigation does not press anything. A reviewer walked it through.
     * ⚠️ `!openedByUser`, so a visitor who deliberately opened Cookie settings on /signin (their
     * PDPL withdrawal right, reachable from the footer everywhere) is not closed out from under
     * their own click.
     */
    if (pathname === SIGNIN_PATH) {
      // ⚠️ BACK TO THE `ask` VIEW WITH IT. Stepping aside is not a close, so a visitor who had
      // opened the settings pane would otherwise meet the card again on the next page already in
      // `settings` with half-set toggles, which is not how an auto-open ever presents itself.
      if (show && !openedByUser) { setShow(false); setView('ask'); setDeferred(true) }
      return
    }
    if (!deferred) return
    setShow(true)
    setDeferred(false)
  }, [deferred, pathname, show, openedByUser])

  useEffect(() => { if (show) setEverShown(true) }, [show])

  // Withdrawal right (PDPL): the footer "Cookie settings" link dispatches this to
  // reopen the banner any time, pre-filled with the current choice, so consent is
  // as easy to change as to give (compliance verification 2026-07-06).
  useEffect(() => {
    const reopen = () => {
      const c = getConsent()
      setPerso(c !== 'essential')
      setAds(c === 'all')
      setView('settings')
      setOpenedByUser(true)
      setShow(true)
    }
    window.addEventListener('eno:open-consent', reopen)
    return () => window.removeEventListener('eno:open-consent', reopen)
  }, [])
  /**
   * ⛔ MOUNTED ONCE SHOWN, SO THE EXIT ANIMATION THE POPUP DECLARES CAN ACTUALLY RUN. This was
   * `if (!show) return null`, which unmounts `DialogPrimitive.Root` in the same commit that closes
   * it — so `data-closed:animate-out fade-out zoom-out-95` on the popup below never had a frame to
   * run in, and the card vanished instantly after fading in over 200ms. Declared-but-dead exit
   * animation, and the same shape auth-context.tsx already solved for the sign-in dialog (its note
   * on `everOpened` explains the identical trade).
   * ⚠️ `everShown`, NOT a plain `true`: nothing renders before the 4s timer or the footer's reopen
   * fires, so a visitor who never sees the card never mounts a dialog at all.
   * ⚠️ `|| show` IS WHAT KEEPS THE OPEN INSTANT. `everShown` latches in an effect, which runs after
   * the commit — so gating on it alone returned `null` for the render where `show` first turned
   * true and the card arrived one frame late. A reviewer caught it. Reading `show` directly here
   * mounts in the same pass; `everShown` then holds the subtree open for the exit, which is the
   * only job it has.
   */
  if (!everShown && !show) return null

  /**
   * Closing means closed. Three things reset, and each was a bug found in review:
   *   · CANCEL the pending first-visit timer — otherwise dismissing the footer-opened card at t=2s
   *     without choosing let the timer re-open it at t=4s.
   *   · `view` back to 'ask' — otherwise that same re-open landed on the SETTINGS toggles rather
   *     than the question, pre-filled from a `getConsent()` that had returned null.
   *   · `openedByUser` back to false, so a later automatic appearance cannot inherit "the user
   *     asked for this" from an earlier footer click and steal focus.
   */
  const close = () => {
    if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null }
    setShow(false)
    setOpenedByUser(false)
    setView('ask')
    /**
     * ⚠️ THE TOUR STARTS ON EITHER CHOICE, AND THAT IS A COMPLIANCE POINT rather than a nicety.
     * Owner, 2026-08-28: "once they close popup the onboarding process should start". Starting it
     * only after "Allow" would make the walkthrough a reward for consenting — the exact nudge
     * PDPL/GDPR mean by consent not being freely given. Allow, Decline and Esc all lead here.
     * ⚠️ NOT fired for the footer re-open: someone editing their choice a month later is not a
     * first-run visitor. `intro-tour.tsx` also refuses to run twice, so this is belt and braces.
     */
    if (!openedByUser) window.dispatchEvent(new CustomEvent('eno:start-tour'))
  }
  const allow = () => { setConsent('all'); close() }
  const save = () => { setConsent(ads ? 'all' : perso ? 'personalized' : 'essential'); close() }
  const decline = () => { setConsent('essential'); close() }

  // Native copy branch is PRESENTATION-ONLY: same trigger, choices, storage and events —
  // the WebView shares the site's tracking signals, so PDPL consent semantics are identical;
  // only the browser-cookie framing is swapped for app wording. Safe to read inline because
  // the dialog never renders before mount (show starts false).
  const isNative = typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()

  const primary = 'rounded-lg px-4 py-1.5 text-sm transition-colors active:scale-[0.96] cursor-pointer'
  const ghost = 'rounded-lg px-3 py-1.5 text-sm font-semibold text-body transition-colors hover:bg-muted hover:text-body active:scale-[0.96] cursor-pointer'

  return (
    /* ⚠️ CENTERED AGAIN (owner, 2026-08-06) — BUT NEVER WITH A BACKDROP. READ THIS BEFORE EDITING.
       An earlier centred version cost THREE Google OAuth verification rejections. It sat over a
       `fixed inset-0 bg-black/40 backdrop-blur-[2px]` backdrop and auto-opened on every first
       visit; Google's brand reviewer is ALWAYS a first visit, so what they screenshotted was a
       dialog on top of a blurred, un-clickable page — reported back as "Your home page is behind a
       login page" and, because the heading was unreadable behind it, "the app name does not match
       the app name on your home page". (The third, "does not explain the purpose", was the sr-only
       <h1> — fixed in c0c3017b.)

       ⚠️ THE CULPRIT WAS THE BACKDROP, NOT THE POSITION — "both complaints, one backdrop", as the
       previous note itself recorded. So centring is safe to restore and the two things that fixed
       the rejection are kept, and must stay kept:
         · `modal={false}` — the page behind stays interactive and un-trapped.
         · `pointer-events-none` on this wrapper (re-armed to `auto` on the card alone) — clicks
           pass through everywhere except the card, so nothing is blocked.
       There is no backdrop element here and there must not be one. If you find yourself adding
       `inset-0 bg-*` or any blur to make the card "pop", that is the exact change that was
       rejected three times.

       The 4s delay above helps the same reviewer for free: they see the home page first.

       Consent semantics are unchanged either way — nothing non-essential fires until a choice is
       stored (src/lib/consent.ts), which is what PDPL requires. A wall was never the mechanism. */
    <DialogPrimitive.Root open={show} modal={false} onOpenChange={(open) => { if (!open) close() }}>
      <DialogPrimitive.Portal>
        {/* Centred in the viewport. `inset-0` here is GEOMETRY ONLY — it is what lets flex centre
            the card — and carries no background or blur; see the note above for why that matters.
            `pointer-events-none` is what keeps a full-viewport element from swallowing every click
            on the page behind it, so it is load-bearing rather than tidy. Padded on all sides so
            the card never touches the edge, and `py-` clears the mobile tab bar / safe area when a
            short viewport pushes it low. */}
        <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center px-3 py-[calc(4.5rem+env(safe-area-inset-bottom))] lg:px-4 lg:py-4">
          <DialogPrimitive.Popup
            ref={popupRef}
            /**
             * ⚠️ THE AUTO-PROMPT TAKES NO FOCUS AT ALL; THE USER-OPENED ONE FOCUSES THE CARD.
             * This split exists because of the delay. Focus used to move in the same breath as the
             * page appearing, before anyone could plausibly be typing. Now the card arrives four
             * seconds in, so grabbing focus would take it from a visitor already using the page —
             * someone mid-word in the search field at t=3.5s loses the rest of their keystrokes.
             * Review raised it and it is a real regression the immediate version could not have.
             * `false` leaves focus where the user put it. The footer's "Cookie settings" IS a
             * deliberate request, so that path still focuses.
             *
             * ⚠️ THE TRADE-OFF, STATED RATHER THAN GLOSSED: review is right that a non-modal
             * `role="dialog"` inserted without focus is not guaranteed to be ANNOUNCED, so a screen
             * reader user may not learn the card appeared until they reach it in the tab order. The
             * alternative is worse and was itself a review finding: moving focus four seconds after
             * landing takes it from anyone already typing. Neither option is free, and this one
             * fails toward "the user keeps control of their keyboard" rather than "the user loses a
             * sentence". The card stays reachable by Tab, the footer link reopens it at any time,
             * and nothing non-essential fires until a choice is stored — so a missed announcement
             * delays the prompt, it does not consent on anyone's behalf. Revisit if the pattern
             * changes; do not silently switch it back to stealing focus.
             *
             * Why the CARD rather than the first tabbable thing inside it: Base UI's default is
             * `interactionType === 'touch' ? popup : true`, which put initial focus on the inline
             * "Privacy policy" link mid-sentence and painted a focus ring split across the line
             * wrap (visible on the very first screen of the native app). Deliberately NOT the
             * "Allow" button — pre-focusing the accept action would make Enter consent for the
             * user, and PDPL requires consent be an affirmative act.
             */
            initialFocus={openedByUser ? popupRef : false}
            /* pointer-events-auto re-arms clicks on the card ITSELF — the wrapper disables them so
               the page behind stays usable. Do not move this to the wrapper.
               Zooms in now that it is centred; a slide-from-bottom on a centred card reads as the
               card having missed its mark. */
            /* ⚠️ `max-h-full overflow-y-auto` IS INSURANCE, NOT A FIX FOR A LIVE BUG. Measured on
               844x390 and 740x360 landscape, 360x640 and 320x480: nothing clips and all three
               buttons stay on screen today. But the card has no height cap otherwise, and the copy
               is translated — a longer Vietnamese string, a third language, or one more toggle in
               the settings view would push the actions off a landscape phone with no way to reach
               them. A consent card whose "Decline" cannot be reached is the worst possible failure
               mode here, so it scrolls rather than overflowing. Raised in review. */
            className="pointer-events-auto relative flex max-h-full w-full max-w-md flex-col overflow-y-auto rounded-2xl bg-popover p-3 shadow-overlay outline-none animate-in fade-in zoom-in-95 duration-200 sm:p-4 data-closed:animate-out data-closed:fade-out data-closed:zoom-out-95"
          >
            {/* ⛔ THE CARD IS TWO STACKED SECTIONS, NOT TWO COLUMNS — owner, 2026-08-28. The mascot
            used to be a sibling of the whole content block, so it occupied a full-height left
            column: on a tall card it floated in the middle of its own empty gutter, and the rule
            beneath the introduction could only ever span the RIGHT column, which read as a divider
            inside one section rather than a division of the card.
            Now the introduction runs the full width above the rule, and the mascot sits beside the
            cookie question below it, where it belongs — it is the cookie mascot, and that is the
            cookie half. */}
        <div>
          {view === 'ask' ? (
            <>
              {/**
                * ⛔ AN INTRODUCTION THAT STILL ASKS — AND IT MUST NOT GROW INTO AN INTERSTITIAL.
                * Owner, 2026-08-28: the card should say who we are, what we do and why to use us,
                * "to industry standards". The standard landing shape is value proposition → proof →
                * one action, and that is what this is: a headline that names the marketplace, one
                * line of what it does, three proof points, then the consent question.
                * ⚠️ WHAT IT DELIBERATELY IS NOT is a full-page splash. Read the note above the
                * Root: a centred card over a backdrop cost THREE Google OAuth verification
                * rejections. The proof points are one tight row precisely so the card stays a card;
                * if a future edit makes this scroll on a landscape phone, cut copy rather than
                * raising the height.
                * ⚠️ EDITION-AWARE, BECAUSE THE COPY IS A LEGAL SURFACE. eno.vn may not describe
                * visa or trip services at all, so the services line only exists on the forum build.
                */}
              {/* ⚠️ `tracking-tight` IS SIZE-SPECIFIC, NOT DECORATION. Letters read too far apart as
                  type grows, so display sizes want negative tracking while body stays near zero —
                  a single letter-spacing across the ramp is wrong somewhere. This is the one line
                  on the card big enough to need it; nothing else here gets tracking.
                  ⚠️ `text-lg`, not larger: it is the canon's display step (SECTION_TITLE), and the
                  card has to keep its Decline reachable on a 320x480 landscape phone. */}
              <DialogPrimitive.Title className="text-lg font-bold leading-tight tracking-tight text-foreground">
                {tr('Buy and sell in Vietnam, without the guesswork', 'Mua bán tại Việt Nam, không còn mơ hồ')}
              </DialogPrimitive.Title>
              {/* ⛔ NOTHING IS HIDDEN BY VIEWPORT ANY MORE — THE ACTIONS ARE PINNED INSTEAD, and
                  the three drafts it took to get here are worth knowing. The card grew, and at
                  740x360 the actions fell below the fold. First fix hid the intro under a height
                  query; that deleted the whole introduction for a desktop reader at 200% zoom,
                  whose CSS viewport is also short (WCAG 1.4.4). Second fix added `pointer:coarse`
                  to keep it to phones; that re-opened the original bug for a touch device docked
                  to a trackpad — an iPad with a keyboard, a 2-in-1 in laptop posture — which
                  reports `pointer: fine` at 740x360 and got the overflow back. Each fix moved the
                  failure to a population the previous one had not thought about.
                  ⛔ THE REQUIREMENT WAS NEVER "hide the intro", IT WAS "the consent controls are
                  always on screen". So the consent block is `sticky bottom-0` inside the card's own
                  scrollport: the introduction scrolls away behind it when there is no room, and
                  Allow, Decline and Cookie settings never leave. No viewport is special-cased, no
                  reader loses the explanation, and zoom is irrelevant. */}
              <p className="mt-1 text-sm leading-snug text-muted-foreground">
                {/* ⛔ ONE LINE FOR BOTH EDITIONS, AND AN EDITION TERNARY HERE WAS A LICENSING LEAK.
                    The first version branched on IS_MARKETPLACE to mention trips and e-visa on the
                    forum — correct at RENDER, and wrong in the artifact: scripts/gen-ui-strings.mjs
                    scrapes tr() calls out of the source, so BOTH branches landed in the MARKETPLACE
                    string table and eno.vn shipped a bundle containing "listings, trips and e-visa
                    in one place". A reviewer caught it; measured in src/generated/ui-strings.ts
                    before believing it. eno.vn may not name those services in any form.
                    ⚠️ So the rule for this file: never put an edition branch inside `tr()`. If the
                    editions ever genuinely need different intro copy, the services variant belongs
                    in its own `.svc.` module that the marketplace build never compiles — not in a
                    ternary the generator will flatten. */}
                {tr(
                  'eno is the marketplace for people living in Vietnam — everything from phones to apartments, in English and Vietnamese, with prices in đồng and dollars.',
                  'eno là chợ trực tuyến cho người sống tại Việt Nam — từ điện thoại đến căn hộ, bằng tiếng Việt và tiếng Anh, giá theo đồng và đô la.',
                )}
              </p>
              {/**
                * ⛔ EVERY CLAIM HERE HAS TO BE TRUE TODAY, AND THE FIRST VERSION'S WAS NOT. It led
                * with "Verified sellers — ID-checked, with a trust score". Measured against the
                * production database before shipping it: 9 sellers, `verified` = 0,
                * `verifiedSeller` = 0. Not "mostly unverified" — none. VNPT eKYC is still blocked
                * on their token endpoint (`VNPT_MONTHLY_QUOTA` defaults to 0 and the flow reports
                * "eKYC quota not configured"), so the badge exists in the schema and nothing wears
                * it. A pre-consent trust claim that is flatly false is a consumer-protection
                * problem on any marketplace and a worse one for a company mid-way through a sàn
                * TMĐT licence. A reviewer flagged it as unverified; the database settled it.
                * ⚠️ THE RULE THIS LEAVES BEHIND: this card is the first thing a stranger reads, so
                * nothing goes in it that cannot be checked in the product on the day it ships.
                * When eKYC actually goes live, the verified-sellers line is a good one — add it
                * back then, not before.
                *
                * ⛔ AND THE RULE HAD TO BE APPLIED TWICE. The replacement bullets were WRITTEN, not
                * measured, and a reviewer caught that: "Chat in-app — never hand out your number"
                * was false in the same way. `api/listings/[id]/contact/route.ts` says it in its own
                * comment — "this route reveals a seller's phone number to a buyer" — so a seller
                * does hand one over, and OTP sign-in takes one too. The claim now describes what is
                * actually guaranteed: you can message a seller without swapping contact details,
                * because revealing a phone is a separate, deliberate step.
                * ⚠️ The price line is scoped to "popular models" rather than claiming a band
                * everywhere: the band is computed per brand+model+segment and is suppressed under
                * five samples, so a thin category genuinely has none.
                * ⚠️ Paid placement: the schema carries no isFeatured/boostedUntil/bumpedAt column,
                * so nothing can be bought up the list today. Free republish exists and moves
                * `postedAt` — which is why the word is "paid" and has to stay.
                * ⚠️ EN AND VI MUST PROMISE THE SAME THING, and two pairs had to be fixed for it.
                * "never hand out your number" was absolute where the Vietnamese said "no need to
                * give your number"; and "buy their way up the list" described RANKING while the
                * Vietnamese described display SLOTS — a gap that matters because free republish
                * does move `postedAt` and therefore does move a listing up. Both now say the same
                * narrow, true thing: nobody can PAY to rank higher. Vietnamese is the primary
                * market and this is a pre-consent representation; a promise cannot differ by
                * locale.
                * ⚠️ Wrapping, not truncating — an earlier `truncate` cut the qualifier off exactly
                * where Vietnamese runs longest, deleting the proof in the primary market's own
                * language. `gap`, not margins, so removing one row cannot collapse the spacing.
                * ⚠️ `text-xs` AND `text-ink-4`, NOT `text-2xs` / `text-muted-foreground`. The
                * qualifiers are what make these claims TRUE — "on popular models" is the scope that
                * keeps the price line honest, "without swapping contact details" is the whole
                * distinction on the chat line. They were set as the smallest, faintest text on a
                * card a stranger reads before consenting, which is a qualifier nobody reads and so
                * a claim nobody has actually seen scoped. `--ink-4` is ~6:1 rather than ~4.6:1.
                */}
              <ul className="mt-2 flex flex-col gap-1">
                {[
                  { Icon: Sparkles, label: tr('Market prices', 'Giá thị trường'), sub: tr('see the going rate on popular models', 'xem mức giá phổ biến của các mẫu thông dụng') },
                  { Icon: MessageCircle, label: tr('Chat in-app', 'Nhắn tin trong ứng dụng'), sub: tr('message a seller without swapping contact details', 'nhắn tin với người bán mà không cần trao đổi thông tin liên hệ') },
                  { Icon: ShieldCheck, label: tr('No paid placement', 'Không có vị trí trả tiền'), sub: tr('nobody can pay to rank higher', 'không ai trả tiền để được xếp hạng cao hơn') },
                ].map(({ Icon, label, sub }) => (
                  <li key={label} className="flex items-start gap-1.5 text-xs leading-snug">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-foreground" />
                    <span className="min-w-0">
                      <span className="font-semibold text-foreground">{label}</span>
                      <span className="text-ink-4"> — {sub}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {/**
                * ⛔ THE CONSENT ASK IS ITS OWN SECTION, AT FULL SIZE, AND THE FIRST DRAFT BROKE THAT.
                * Adding the introduction pushed this line to `text-2xs` under a marketing headline —
                * so the smallest type on the card was the only place explaining what "Allow" does.
                * GDPR Art. 7(2) requires a consent request be "clearly distinguishable from other
                * matters" and intelligible; a reviewer was right that the diff argued consent law to
                * justify when the TOUR starts while quietly weakening the NOTICE. The rule above
                * separates the introduction from the request, and the size goes back to `text-sm`.
                * ⚠️ If the card ever needs to be shorter, cut the introduction — never this.
                */}
              {/* ⚠️ `-mx-3 px-3` (and the sm: pair) BLEEDS THE RULE TO THE CARD EDGES. Inside the
                  padding it stops short of both sides and reads as an underline under the proof
                  list; edge to edge it reads as what it is, the seam between two sections.
                  ⚠️ Still `sticky bottom-0` — this whole half stays pinned, so the introduction
                  scrolls behind it and the controls never leave the screen. `bg-popover` matches
                  the card's own token so the pinned half is opaque in both themes. */}
              <div className="sticky bottom-0 z-10 -mx-3 mt-2.5 flex items-center gap-3 border-t border-line bg-popover px-3 pt-2.5 sm:-mx-4 sm:px-4">
              {/* ⛔ THE MASCOT DROPS ON A SHORT VIEWPORT, AND IT IS THE RIGHT THING TO DROP.
                  It now lives inside the pinned half, so it costs that half ~92px of permanent
                  height — measured at 740x360, the sticky block was 185px of a 216px card, leaving
                  31px of scroll room and an introduction nobody could reach. That is the trade the
                  comment above warns about.
                  ⚠️ Hiding THIS is not the same as hiding the introduction, which is why there is
                  no `pointer` gate here: the mascot is decoration and carries no claim, so a
                  zoomed desktop reader losing a drawing loses nothing. The copy, the proof and the
                  consent question stay for everyone at every size. */}
              <Mascot name="cookie" className="h-20 w-20 shrink-0 self-center text-foreground [@media(max-height:560px)]:hidden sm:h-24 sm:w-24" />
              <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-muted-foreground">
                {isNative
                  ? tr(
                      'Allow us to put the most relevant products first and to measure what works, so the app keeps getting better for you. ',
                      'Cho phép chúng tôi đưa sản phẩm phù hợp nhất lên đầu và đo lường hiệu quả, để ứng dụng ngày càng hợp với bạn hơn. ',
                    )
                  : tr(
                      'Allow cookies and we’ll put the most relevant products first — and keep you signed in. ',
                      'Cho phép cookie để chúng tôi đưa sản phẩm phù hợp nhất lên đầu — và giữ bạn đăng nhập. ',
                    )}
                <Link href="/privacy" prefetch={false} className="font-semibold text-accent-foreground underline underline-offset-2">{tr('Privacy policy', 'Chính sách quyền riêng tư')}</Link>
              </p>
              {/**
                * ⛔ ONE DOMINANT CTA, THE OTHER TWO AS TEXT BENEATH IT — owner's call, 2026-08-28,
                * made after the trade was put to them twice. Allow is a full-width filled button
                * at the LOWEST point of the card, which on a phone is the centre of the natural
                * thumb arc; Cookie settings and Decline sit under it as text, split left and right
                * so a right thumb travelling to Allow cannot brush Decline on the way.
                *
                * ⚠️ WHAT THIS TRADES, RECORDED SO THE DECISION STAYS VISIBLE RATHER THAN BECOMING
                * FOLKLORE. The risk here is NOT the position: Decline is still one tap, on the
                * first layer, in legible ink — and that is what CNIL's €150M/€60M decisions against
                * Google and Meta actually turned on, where refusing took MORE clicks than
                * accepting. The risk is the PROMINENCE gap between a filled button and a text
                * link, which EDPB Guidelines 03/2022 on deceptive design patterns name directly,
                * and eno is mid-licensing as a sàn TMĐT.
                * ⛔ SO THIS IS THE CEILING, NOT A STARTING POINT. Do NOT move Decline behind a
                * second screen, add a tap to refuse, or fade it until it stops reading as a
                * control. Those are the changes that turn an arguable layout into a fineable one.
                * The equal-weight version is one swap — Decline back to a `variant="ghost"` button
                * of the same width and height as Allow — and the design canvas keeps it drawn.
                *
                * ⚠️ `.press` ON ALL THREE, NOT A HAND-WRITTEN TRANSITION. The old `transition-colors`
                * animated colour and nothing else, so the `active:scale` snapped in and snapped back
                * — press feedback that was there in the markup and absent on screen. The obvious fix
                * (`transition-[transform,…]`) is ALSO wrong and design-lint caught it: Tailwind v4
                * compiles `scale-*` to the standalone `scale` property, not `transform`, so that
                * list subscribes to something nothing writes. `.press` is the house utility and it
                * already encodes the right behaviour — 40ms in on `:active`, a 220ms spring back
                * out, on `scale` — plus `touch-action: manipulation`, which drops the legacy 300ms
                * tap delay. Feedback on the press, and no latency in front of it.
                * ⚠️ `rounded-xl` (12px), NOT the mockup's 14px: `--radius-xl` is the button tier in
                * docs/design-language.md and design-lint enforces the scale. ⚠️ `min-h-11` on the
                * text actions is a real 44px target — they are the interactive element themselves,
                * so this does NOT use the `tap-44` utility, whose pseudo-overlay covers a
                * positioned ancestor when it lands on an unpositioned element.
                */}
              <Button
                variant="cta"
                size="none"
                onClick={allow}
                className="press mt-3 flex w-full items-center justify-center rounded-xl px-4 py-3 text-base font-extrabold cursor-pointer"
              >
                {tr('Allow cookies', 'Cho phép cookie')}
              </Button>
              {/* ⚠️ `mt-3`, NOT `mt-1`. Four pixels under a full-width primary put a 44px Decline
                  target directly in the path of an overshooting thumb — and a mis-tap here writes
                  a consent decision the reader did not make, in either direction. The earlier
                  reasoning only considered horizontal travel; the collision is vertical. */}
              <div className="mt-3 flex items-center justify-between gap-3">
                <Button
                  variant="ghost"
                  size="none"
                  onClick={() => setView('settings')}
                  className="press min-h-11 rounded-lg px-1 text-sm font-semibold text-body hover:text-foreground cursor-pointer"
                >
                  {tr('Cookie settings', 'Tùy chỉnh cookie')}
                </Button>
                <Button
                  variant="ghost"
                  size="none"
                  onClick={decline}
                  className="press min-h-11 rounded-lg px-1 text-sm font-semibold text-foreground cursor-pointer"
                >
                  {tr('Decline', 'Từ chối')}
                </Button>
              </div>
              </div>
              </div>
            </>
          ) : (
            <>
              {/* ⚠️ The settings view keeps the mascot beside it — the ask view moved its copy into
                  the consent half, and without this the mascot would vanish entirely on this view. */}
              <div className="flex items-center gap-3">
              <Mascot name="cookie" className="hidden h-20 w-20 shrink-0 self-center text-foreground sm:block" />
              <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-base font-bold leading-tight text-foreground">{tr('Your choices', 'Lựa chọn của bạn')}</DialogPrimitive.Title>
              <div className="mt-1.5 -ml-1.5 space-y-0">
                <Toggle locked value title={tr('Essential', 'Cần thiết')} desc={tr('Sign-in & speed. Always on.', 'Đăng nhập & tốc độ. Luôn bật.')} />
                <Toggle value={perso} onChange={setPerso} title={tr('Personalized', 'Cá nhân hoá')} desc={tr('Rank the most relevant items first from your activity.', 'Xếp hạng mục phù hợp nhất theo hoạt động của bạn.')} />
                <Toggle value={ads} onChange={setAds} title={tr('Ad personalization', 'Quảng cáo cá nhân hoá')} desc={tr('Ad-network signals (Meta/Google) for retargeting.', 'Tín hiệu mạng quảng cáo (Meta/Google) để tiếp thị lại.')} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <Button variant="cta" size="none" onClick={save} className={primary}>{tr('Save', 'Lưu')}</Button>
                <Button variant="ghost" size="none" onClick={decline} className={ghost}>{tr('Decline all', 'Từ chối tất cả')}</Button>
              </div>
              </div>
              </div>
            </>
          )}
        </div>
      </DialogPrimitive.Popup>
    </div>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
  )
}
