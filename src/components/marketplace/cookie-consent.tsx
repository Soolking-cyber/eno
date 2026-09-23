'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useLanguage } from '@/context/language-context'
import {
  consentAnswered,
  isNativeContext,
  readConsent,
  setConsent,
  syncConsentStorage,
  type ConsentAction,
  type ConsentFlags,
} from '@/lib/consent'
import { Mascot } from './mascot'
import { cn } from '@/lib/utils'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

/**
 * ⚠️ THE ONE ROUTE THIS CARD MUST NOT COVER. `/signin` centres the sign-in card in exactly the
 * place this one occupies; see the note in the auto-open effect. Named rather than inlined because
 * two separate checks read it and they must never drift apart.
 */
const SIGNIN_PATH = '/signin'

const ALL_OFF: ConsentFlags = { p: false, a: false, d: false }

/**
 * One purpose: its name, what it does, and its OWN switch.
 *
 * ⛔ A REAL SWITCH (Base UI via ui/switch — role="switch", aria-checked, Space/Enter), NOT THE
 * aria-pressed BUTTON THAT WAS HERE. This is a consent decision: its state has to be announced as
 * on/off, and the house rule is a Base UI primitive before anything hand-rolled.
 * ⚠️ Named by the visible title and described by the line under it, so a screen reader hears
 * "Analytics, switch, off — Google Analytics measures …" rather than a bare "switch".
 * ⛔ THE DESCRIPTION IS `text-xs text-muted-foreground`, NEVER THE CARD'S SMALLEST TYPE. It is the only
 * place the first layer names each vendor and says a hashed email or phone goes to Meta — the
 * disclosure a Decree 356 Art 6(3) reading of "clear consent mechanics" hangs on. It was `text-2xs
 * text-ink-4`, the least legible text on the card, against the rule written above the consent half.
 */
function PurposeRow({ title, desc, checked, onChange, locked = false }: { title: string; desc: string; checked: boolean; onChange: (v: boolean) => void; locked?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p id={`${id}-t`} className="text-sm font-semibold leading-tight text-foreground">{title}</p>
        <p id={`${id}-d`} className="mt-0.5 text-xs leading-snug text-muted-foreground">{desc}</p>
      </div>
      <Switch
        size="sm"
        checked={checked}
        onChange={locked ? undefined : onChange}
        disabled={locked}
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
        className="mt-0.5"
      />
    </div>
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

/** The consent card (consent v2): three purposes, each with its own switch and all OFF until the
 *  visitor turns them on, plus "Allow all" and "Decline all" of equal weight and "Save my choices".
 *  The same card is the first-visit prompt and the footer/settings/privacy re-open. */
export function CookieConsent() {
  const { tr, lang } = useLanguage()
  // Where initial focus goes when the dialog opens — see initialFocus on the Popup below.
  const popupRef = useRef<HTMLDivElement>(null)
  /**
   * The pending first-visit timer, so `close()` can CANCEL it.
   *
   * ⚠️ THE GUARD INSIDE THE CALLBACK IS NOT ENOUGH ON ITS OWN, and review had to point that out
   * twice before this was right. Re-reading the stored answer covers "the user DECIDED during the
   * delay". It does not cover "the user LOOKED AND LEFT" — opening the footer's Cookie settings at
   * t=2s, reading it, and closing with Esc without choosing. The answer is still missing, so the timer
   * fired and the card reappeared unbidden seconds after they dismissed it. Cancelling on close
   * covers both, and is the behaviour a person would describe as "I closed it".
   */
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [show, setShow] = useState(false)
  /**
   * Did the CARD open because the user asked for it (footer "Cookie settings"), or did it appear on
   * its own after the delay? Only the first may move focus — see `initialFocus` on the Popup. It also
   * picks the header (photo vs "Your choices") and is recorded as the surface of the choice.
   */
  const pathname = usePathname()
  const [openedByUser, setOpenedByUser] = useState(false)
  /** Latches on the first open so the popup survives its own closing frame — see the note below. */
  const [everShown, setEverShown] = useState(false)
  /** The auto-open fired while the visitor was on /signin; show it once they are elsewhere. */
  const [deferred, setDeferred] = useState(false)
  /**
   * ⛔ EVERY SWITCH STARTS OFF, AND NOTHING COUPLES THEM. v1 started "Personalized" ON for a visitor
   * who had not answered (and, until d2dcc590, "Ad personalization" too), so a first-visit Save
   * recorded a consent nobody gave; and it linked the toggles (ads on ⇒ personalized on). Consent is
   * per purpose (PDPL 91/2025 Art 9(4)(a)), so each switch writes exactly its own flag.
   */
  const [flags, setFlags] = useState<ConsentFlags>(ALL_OFF)
  /** Pre-fill from the stored answer — ONE rule for both ways into the card. No answer ⇒ all off. */
  const seedFromConsent = () => {
    const c = readConsent()
    setFlags(c ? { p: c.p, a: c.a, d: c.d } : ALL_OFF)
  }

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
    syncConsentStorage()
    // ⚠️ A v1 'all' / 'personalized' reads as NOT ANSWERED here, so those visitors are asked once more
    // (consent v2 — see src/lib/consent-value.ts). A v1 'essential' is an answer and is never re-asked.
    if (consentAnswered()) return
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
      if (consentAnswered()) return
      if (window.location.pathname === SIGNIN_PATH) setDeferred(true)
      else { setFlags(ALL_OFF); setShow(true) }
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
    if (consentAnswered()) { setDeferred(false); return }
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
      if (show && !openedByUser) { setShow(false); setDeferred(true) }
      return
    }
    if (!deferred) return
    setFlags(ALL_OFF)
    setShow(true)
    setDeferred(false)
  }, [deferred, pathname, show, openedByUser])

  useEffect(() => { if (show) setEverShown(true) }, [show])

  // Withdrawal right (PDPL): the footer "Cookie settings" link dispatches this to
  // reopen the banner any time, pre-filled with the current choice, so consent is
  // as easy to change as to give (compliance verification 2026-07-06).
  useEffect(() => {
    const reopen = () => {
      /**
       * ⛔ A DELIBERATE OPEN CANCELS THE PENDING AUTO-OPEN AND ANY DEFERRAL. Both of those paths reset
       * the switches to all-off when they fire (right for an automatic first ask), so a visitor who
       * opened Cookie settings within the first 4 s — or on /signin after the timer had parked — would
       * have their half-set switches wiped under their fingers when the timer or the next navigation
       * fired. Reviewer (agy) caught it on the finished diff.
       */
      if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null }
      setDeferred(false)
      seedFromConsent()
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
   * Closing means closed. Two things reset, and each was a bug found in review:
   *   · CANCEL the pending first-visit timer — otherwise dismissing the footer-opened card at t=2s
   *     without choosing let the timer re-open it at t=4s.
   *   · `openedByUser` back to false, so a later automatic appearance cannot inherit "the user
   *     asked for this" from an earlier footer click and steal focus.
   * (There is no separate settings view any more to reset: the switches ARE the first layer, and both
   * ways in seed them — all off for an unanswered visitor, the stored answer on a re-open.)
   */
  const close = () => {
    if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null }
    setShow(false)
    setOpenedByUser(false)
    /**
     * ⛔ CLOSING THIS NO LONGER STARTS ANYTHING. It used to dispatch `eno:start-tour`, because the
     * owner asked for onboarding to begin here (2026-08-28: "once they close popup the onboarding
     * process should start") — and on 2026-09-16 they asked for that tour to go: "remove onboarding
     * autoplay where it shows top seach bar and taps the category brand too jittery". The compliance
     * reasoning that surrounded it (start on EITHER choice, so a walkthrough is never a reward for
     * consenting) is moot now that nothing starts; if onboarding ever returns, it belongs on both
     * branches for that reason, not just on "Allow".
     */
  }

  /**
   * ⛔ INSIDE THE NATIVE APPS ANALYTICS AND ADVERTISING ARE NOT OFFERED AT ALL. The app is a web view
   * of this site, and Apple's App Tracking Transparency covers web views: sending a hashed email to
   * Meta from inside the app is "tracking", which needs the ATT prompt the apps do not show — and a
   * consent banner is not a substitute for it. So the two rows render locked OFF, "Allow all" there
   * means personalization only, and src/lib/consent.ts + the server force both off whatever is stored.
   * Safe to read inline because the dialog never renders before mount (show starts false).
   */
  const isNative = isNativeContext()

  /** Store the answer (and its record), then close. The surface is read BEFORE close() resets it. */
  const choose = (next: ConsentFlags, action: ConsentAction) => {
    const f = isNative ? { ...next, a: false, d: false } : next
    setConsent(f, { surface: openedByUser ? 'settings' : 'banner', action, locale: lang })
    close()
  }
  const allowAll = () => choose({ p: true, a: true, d: true }, 'allow_all')
  const declineAll = () => choose(ALL_OFF, 'decline_all')
  const save = () => choose(flags, 'save')
  const setFlag = (k: keyof ConsentFlags) => (v: boolean) => setFlags((f) => ({ ...f, [k]: v }))
  const pairButton = 'press flex min-h-11 w-full items-center justify-center whitespace-normal rounded-xl px-3 py-2.5 text-center text-sm font-bold leading-tight cursor-pointer'

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
        {/* ⚠️ THE TOP GUTTER COLLAPSES ON A SHORT VIEWPORT AND THE BOTTOM ONE NEVER DOES — they look
            symmetrical and they are not doing the same job. The BOTTOM 4.5rem clears the fixed
            mobile tab bar (it tracks <BottomNavSpacer/>) plus the home indicator, so it is load
            bearing at every height. The TOP 4.5rem is only breathing room, and on a 320px-tall
            landscape phone the pair took 144px — 45% of the screen — leaving the card 176px of
            `max-h-full`, which is LESS than the pinned consent half needs. MEASURED at 480x320:
            Allow sat on screen but the Cookie settings / Decline row began 12px below the fold and
            took a scroll to reach, which is the one failure this card must not have. Collapsing the
            top gutter alone gives the card 232px and the whole pinned half fits with room over.
            ⚠️ The threshold moved from 480px to 560px with consent v2: three switches made the
            consent half taller, and the same 560px line is where that half stops being sticky and
            the photo hides — one breakpoint for the three, so they cannot disagree.
            ⚠️ This is a GUTTER, not content: nothing is hidden by viewport here, which is the trap
            recorded further down. */}
        <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center px-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-[4.5rem] [@media(max-height:560px)]:pt-4 lg:px-4 lg:py-4">
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
             * "Allow all" button — pre-focusing the accept action would make Enter consent for the
             * user, and PDPL requires consent be an affirmative act.
             */
            initialFocus={openedByUser ? popupRef : false}
            /* pointer-events-auto re-arms clicks on the card ITSELF — the wrapper disables them so
               the page behind stays usable. Do not move this to the wrapper.
               Zooms in now that it is centred; a slide-from-bottom on a centred card reads as the
               card having missed its mark. */
            /* ⚠️ `max-h-full overflow-y-auto` IS INSURANCE, NOT A FIX FOR A LIVE BUG. Measured on
               844x390 and 740x360 landscape, 360x640 and 320x480 (v1 card). The card has no height
               cap otherwise, and the copy is translated — a longer Vietnamese string, a third
               language, or the three consent-v2 switches push the actions off a landscape phone. A
               consent card whose "Decline all" cannot be reached is the worst possible failure mode
               here, so it scrolls rather than overflowing. Raised in review. */
            className="pointer-events-auto relative flex max-h-full w-full max-w-md flex-col overflow-y-auto rounded-2xl bg-popover p-3 shadow-overlay outline-none animate-in fade-in zoom-in-95 duration-200 sm:p-4 data-closed:animate-out data-closed:fade-out data-closed:zoom-out-95"
          >
            {/* ⛔ THE CARD IS TWO STACKED SECTIONS, NOT TWO COLUMNS — owner, 2026-08-28. The mascot
            used to be a sibling of the whole content block, so it occupied a full-height left
            column: on a tall card it floated in the middle of its own empty gutter, and the rule
            beneath the introduction could only ever span the RIGHT column, which read as a divider
            inside one section rather than a division of the card.
            Now the introduction runs the full width above the rule and the consent half below it.
            (Consent v2: the first-visit card and the re-open are ONE card — the switches are the
            first layer — so the only thing that differs between them is the header.) */}
        <div>
          {openedByUser ? (
            /* The re-open (footer / dashboard settings / privacy page): a deliberate visit to change a
               choice, so it opens on its title rather than the introduction photo. The cookie mascot
               stays beside it — owner, 2026-09-17, kept it on this view when it left the first one. */
            <div className="flex items-center gap-3">
              <Mascot name="cookie" className="hidden h-12 w-12 shrink-0 text-foreground sm:block" />
              <DialogPrimitive.Title className="text-base font-bold leading-tight text-foreground">{tr('Your choices', 'Lựa chọn của bạn')}</DialogPrimitive.Title>
            </div>
          ) : (
            <>
              {/**
                * ⛔ THE INTRODUCTION IS A PHOTOGRAPH NOW — owner, 2026-09-17: remove the headline,
                * the one-line pitch and the three proof points, "replace with image make it fit
                * nicely across all platforms". What went is recorded rather than mourned: a
                * headline, a what-we-do line and three claims that each had to be checkable in the
                * product on the day it shipped. Those claims are gone WITH the copy, so this card
                * now asserts nothing about verification, pricing or placement — which is the
                * safest state a pre-consent surface can be in.
                * ⚠️ WHAT MUST NOT COME BACK IS A SPLASH. The note above the Root records three
                * Google OAuth verification rejections that a centred card over a backdrop cost us.
                * A photograph is a cheaper introduction than five blocks of copy and it has to stay
                * that way: if this grows a headline AND a pitch AND bullets again, the card is back
                * to scrolling on a landscape phone.
                *
                * ⛔ THE TAGLINE IS LIVE TEXT, NOT THE PIXELS IT ARRIVED IN, AND THAT IS NOT A LIBERTY
                * TAKEN WITH THE ARTWORK. The supplied image bakes "We help you to buy, sell, rent,
                * connect." into itself, in dark blue on a white plate. Two things make that
                * unshippable on this card, both measurable rather than aesthetic:
                *   · IT WOULD BE ENGLISH ONLY. Vietnamese is the primary market, every user-facing
                *     string here goes through tr(), and this one is a promise read BEFORE consent.
                *     A promise that exists in one language only is the thing this repo does not do.
                *   · IT WOULD BE UNREADABLE IN DARK MODE. Keeping the white plate puts a white slab
                *     inside a dark popover; dropping the plate leaves dark-blue lettering on a
                *     near-black card.
                * So the photograph is cut out of its white background and the words are set as type
                * that follows the theme and the language. ⚠️ The cut-out floods IN FROM THE BORDER,
                * which is why the white `e` on each polo and the white collar trim survive — they
                * are enclosed by blue and never reachable from an edge. Source artwork is the
                * owner's original; the asset is public/consent-team.webp and nothing regenerates
                * it, so keep the original if it ever needs re-cropping.
                *
                * ⛔ THE RULE THE DELETED COPY LEFT BEHIND, KEPT HERE BECAUSE IT OUTLIVED ITS TEXT:
                * NEVER PUT AN EDITION BRANCH INSIDE `tr()` ON THIS CARD. The old intro line briefly
                * branched on IS_MARKETPLACE to name trips and e-visa on the forum — correct at
                * RENDER and wrong in the ARTIFACT, because scripts/gen-ui-strings.mjs scrapes tr()
                * calls out of the SOURCE, so both branches landed in the marketplace string table
                * and eno.vn shipped a bundle containing copy for services it may not advertise. A
                * reviewer caught it and src/generated/ui-strings.ts settled it. If the editions
                * ever need different copy here, the services variant belongs in its own `.svc.`
                * module the marketplace build never compiles — not in a ternary the generator
                * flattens. The photograph and the tagline below name no service, so today this
                * file is edition-neutral and must stay that way.
                */}
              {/* ⚠️ HIDDEN BELOW 560px OF VIEWPORT HEIGHT (consent v2): the card now carries three
                  switches, and on a landscape phone every pixel goes to the controls — see the note
                  on the consent half below.
                  ⚠️ HEIGHT-CLAMPED, NOT WIDTH-CLAMPED — that is what "fit nicely across all
                  platforms" actually requires here. The cut-out is ~1.2:1, so sizing it by width
                  would make it ~375px tall inside a 448px card, taller than the whole consent half,
                  and it would push Allow off a landscape phone. `clamp(6.5rem,24vh,12.5rem)` ties
                  the photo to the VIEWPORT's height instead: 200px on a phone held upright, ~104px
                  on a 360px-tall landscape one, never more than 200px on a desktop card. `w-auto`
                  lets the width follow, so it stays centred and uncropped at every size.
                  ⚠️ `alt=""` ON PURPOSE. The two lines below ARE the words in the picture and they
                  are the dialog's accessible name; a descriptive alt would announce that sentence
                  twice. */}
              <div className="flex justify-center [@media(max-height:560px)]:hidden">
                <Image
                  src="/consent-team.webp"
                  alt=""
                  width={1000}
                  height={837}
                  sizes="250px"
                  /**
                   * ⚠️ THE EDGES ARE MASKED, NOT CROPPED (owner, 2026-09-18: "the image on cookie
                   * popup make its edges softer more pleasant"). The photo is a cut-out on a flat
                   * ground, so on the dark theme it met the dialog as a hard rectangle. A radial
                   * mask fades the last ~15% of the frame to nothing, which reads as the picture
                   * sitting IN the card instead of on top of it, in either theme — a vignette in
                   * alpha rather than a painted gradient, so it never fights the surface colour.
                   * `-webkit-mask-image` alongside it because Safari still needs the prefix.
                   */
                  className="h-[clamp(6.5rem,24vh,12.5rem)] w-auto max-w-full object-contain [mask-image:radial-gradient(115%_95%_at_50%_44%,#000_62%,rgba(0,0,0,0.45)_84%,transparent_100%)] [-webkit-mask-image:radial-gradient(115%_95%_at_50%_44%,#000_62%,rgba(0,0,0,0.45)_84%,transparent_100%)]"
                />
              </div>
              {/* ⛔ THE TITLE IS "Cookie consent" AND IT IS INVISIBLE; THE TAGLINE IS ORDINARY TEXT
                  BESIDE IT. The tagline WAS the Title, and an `aria-label` on the popup was then
                  added to correct the name — both wrong, and a reviewer caught the second one from
                  the spec. Accessible-name computation takes `aria-labelledby` FIRST and ignores
                  `aria-label` when both are present; Base UI always points `aria-labelledby` at the
                  Title, so the label did nothing and the dialog kept announcing itself as "We help
                  you to buy, sell, rent, connect." Verified in the rendered accessibility tree, not
                  from the argument.
                  ⚠️ So the Title says what the dialog IS — the one thing a screen reader user needs
                  before deciding whether to engage with it, on a surface that asks for consent —
                  and the tagline stays in the reading order as content, announced when they reach
                  it. Neither is hidden from anyone; they are in the order each is useful.
                  ⚠️ `tracking-tight` on the display line only: letters read too far apart as type
                  grows, so the canon wants negative tracking at display sizes and none at body. */}
              <DialogPrimitive.Title className="sr-only">{tr('Cookie consent', 'Đồng ý cookie')}</DialogPrimitive.Title>
              <p className="mt-1.5 text-center leading-tight">
                <span className="block text-sm font-bold text-foreground">
                  {tr('We help you to', 'Chúng tôi giúp bạn')}
                </span>
                <span className="block text-xl font-extrabold tracking-tight text-accent-foreground">
                  {tr('buy, sell, rent, connect.', 'mua, bán, thuê, kết nối.')}
                </span>
              </p>
            </>
          )}
              {/**
                * ⛔ THE CONSENT ASK IS ITS OWN SECTION, AT FULL SIZE. GDPR Art. 7(2) requires a consent
                * request be "clearly distinguishable from other matters" and intelligible, so the text
                * that explains the switches is `text-sm`, never the smallest type on the card.
                * ⚠️ If the card ever needs to be shorter, cut the introduction — never this.
                *
                * ⚠️ `-mx-3 px-3` (and the sm: pair) BLEEDS THE RULE TO THE CARD EDGES, so it reads as the
                * seam between two sections rather than an underline.
                * ⚠️ `sticky bottom-0` keeps this whole half pinned while the introduction scrolls behind
                * it — EXCEPT below 560px of viewport height, where it turns `static`. With three switches
                * the half is taller than a landscape phone's card, and a sticky element taller than its
                * scroll box cannot be scrolled into view: its top (the explanation) would sit above the
                * card with no way to reach it. Static, the whole card scrolls and every word and button
                * is reachable. `bg-popover` matches the card so the pinned half is opaque in both themes.
                */}
              <div className={cn('z-10 -mx-3 bg-popover px-3 sm:-mx-4 sm:px-4', openedByUser ? 'mt-1.5' : 'sticky bottom-0 mt-2.5 border-t border-line pt-2.5 [@media(max-height:560px)]:static')}>
              {/**
                * ⛔ WHAT THE FIRST SCREEN MUST SAY, AND WHAT IT MUST NOT (consent v2, owner decision
                * "Consent v2, full"). It names every purpose and vendor before anything is switched on,
                * says that on-site behaviour is sensitive personal data under Vietnamese law (Decree
                * 356/2025 Art 4(1) lists it; Art 6(4) requires saying so), and that declining costs
                * nothing — sign-in included. The old line promised "Allow cookies … and keep you signed
                * in", which was false: sign-in never depended on consent, so the promise only made
                * "Decline" sound like it would sign you out.
                * ⚠️ LEGAL WORDING IS PENDING COUNSEL. Clear and accurate, not a claim of compliance —
                * change it with the lawyer's text, and bump CONSENT_COPY_VERSION (consent-value.ts) so
                * every record says which words the answer was given to.
                * ⛔ NO EDITION BRANCH INSIDE tr() (see the note on the introduction above): this copy is
                * edition-neutral and must stay that way.
                */}
              <p className="text-sm leading-snug text-muted-foreground">
                {isNative
                  ? tr(
                      'Your activity in the app is sensitive personal data under Vietnamese law, so personalization stays off until you switch it on. Analytics and advertising are always off in the app. Decline and everything still works, including sign-in. ',
                      'Theo pháp luật Việt Nam, dữ liệu về hoạt động của bạn trong ứng dụng là dữ liệu cá nhân nhạy cảm, nên cá nhân hoá luôn tắt cho đến khi bạn bật. Phân tích và quảng cáo luôn tắt trong ứng dụng. Nếu từ chối, mọi tính năng vẫn hoạt động, kể cả đăng nhập. ',
                    )
                  : tr(
                      'Your activity on this site is sensitive personal data under Vietnamese law, so each use below stays off until you switch it on. Decline and everything still works, including sign-in. ',
                      'Theo pháp luật Việt Nam, dữ liệu về hoạt động của bạn trên trang này là dữ liệu cá nhân nhạy cảm, nên mỗi mục dưới đây đều tắt cho đến khi bạn bật. Nếu từ chối, mọi tính năng vẫn hoạt động, kể cả đăng nhập. ',
                    )}
                <Link href="/privacy" prefetch={false} className="font-semibold text-accent-foreground underline underline-offset-2">{tr('Privacy policy', 'Chính sách quyền riêng tư')}</Link>
              </p>
              <div className="mt-1.5">
                <PurposeRow
                  title={tr('Personalization', 'Cá nhân hoá')}
                  desc={tr('Ranks listings for you from what you search and view here. Never shared with advertisers.', 'Xếp hạng tin đăng cho bạn theo những gì bạn tìm và xem tại đây. Không bao giờ chia sẻ cho bên quảng cáo.')}
                  checked={flags.p}
                  onChange={setFlag('p')}
                />
                <PurposeRow
                  title={tr('Analytics', 'Phân tích')}
                  desc={isNative
                    ? tr('Always off in the app.', 'Luôn tắt trong ứng dụng.')
                    : tr('Google Analytics measures visits and pages, and which link brought you here.', 'Google Analytics đo lượt truy cập, trang đã xem và liên kết đã đưa bạn đến đây.')}
                  checked={isNative ? false : flags.a}
                  onChange={setFlag('a')}
                  locked={isNative}
                />
                <PurposeRow
                  title={tr('Advertising', 'Quảng cáo')}
                  desc={isNative
                    ? tr('Always off in the app.', 'Luôn tắt trong ứng dụng.')
                    /* ⚠️ "AND GOOGLE" ONLY WITH ANALYTICS: Google's ad signals travel inside Google
                       Analytics, which is never loaded without the Analytics switch, so Advertising
                       alone reaches Meta and nobody else. And the Vietnamese says "băm" (hashed),
                       never "mã hoá" — hashing is not encryption, and the sentence must not promise
                       it is. */
                    : tr('Shares actions like views, contacts and sign-ups with Meta (and with Google, if Analytics is on too) to measure our ads — your email or phone is scrambled (hashed) first.', 'Chia sẻ các hành động như lượt xem, liên hệ và đăng ký với Meta (và với Google, nếu Phân tích cũng bật) để đo hiệu quả quảng cáo — email hoặc số điện thoại được xáo trộn (băm) trước.')}
                  checked={isNative ? false : flags.d}
                  onChange={setFlag('d')}
                  locked={isNative}
                />
              </div>
              {/**
                * ⛔ "ALLOW ALL" AND "DECLINE ALL" CARRY EQUAL WEIGHT — same variant, same size, side by
                * side (consent v2; this REPLACES the owner's 2026-08-28 one-dominant-CTA layout). Decree
                * 356/2025 Art 6(3) forbids consent mechanics that blur consent and refusal, and a filled
                * "Allow" over a text-link "Decline" is the prominence gap EDPB Guidelines 03/2022 name
                * directly. Refusing must be exactly as easy and as visible as accepting.
                * ⚠️ "Save my choices" saves EXACTLY the switches above — all off is a refusal — and sits
                * ABOVE the pair so neither of the two all-or-nothing buttons is the one a thumb lands on
                * first by accident. Do NOT make it (or either of the pair) visually dominant, move a
                * button behind a second screen, or add a tap to refuse.
                * ⚠️ `.press` on all three (the house press utility — 40ms in, spring back, no 300ms tap
                * delay) and `min-h-11` (a real 44px target). `rounded-xl` is the canon button tier.
                * `whitespace-normal` because "Cho phép tất cả" in half a 320px card must wrap, not clip.
                */}
              <Button
                variant="outline"
                size="none"
                onClick={save}
                className="press mt-2 flex min-h-11 w-full items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold cursor-pointer"
              >
                {tr('Save my choices', 'Lưu lựa chọn')}
              </Button>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="cta" size="none" onClick={declineAll} className={pairButton}>
                  {tr('Decline all', 'Từ chối tất cả')}
                </Button>
                <Button variant="cta" size="none" onClick={allowAll} className={pairButton}>
                  {tr('Allow all', 'Cho phép tất cả')}
                </Button>
              </div>
              </div>
        </div>
      </DialogPrimitive.Popup>
    </div>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
  )
}
