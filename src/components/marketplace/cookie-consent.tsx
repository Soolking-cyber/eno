'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useLanguage } from '@/context/language-context'
import { getConsent, setConsent, syncConsentCookie } from '@/lib/consent'
import { Mascot } from './mascot'
import { cn } from '@/lib/utils'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'

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
     * ⛔ CLOSING THIS NO LONGER STARTS ANYTHING. It used to dispatch `eno:start-tour`, because the
     * owner asked for onboarding to begin here (2026-08-28: "once they close popup the onboarding
     * process should start") — and on 2026-09-16 they asked for that tour to go: "remove onboarding
     * autoplay where it shows top seach bar and taps the category brand too jittery". The compliance
     * reasoning that surrounded it (start on EITHER choice, so a walkthrough is never a reward for
     * consenting) is moot now that nothing starts; if onboarding ever returns, it belongs on both
     * branches for that reason, not just on "Allow".
     */
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
        {/* ⚠️ THE TOP GUTTER COLLAPSES ON A SHORT VIEWPORT AND THE BOTTOM ONE NEVER DOES — they look
            symmetrical and they are not doing the same job. The BOTTOM 4.5rem clears the fixed
            mobile tab bar (it tracks <BottomNavSpacer/>) plus the home indicator, so it is load
            bearing at every height. The TOP 4.5rem is only breathing room, and on a 320px-tall
            landscape phone the pair took 144px — 45% of the screen — leaving the card 176px of
            `max-h-full`, which is LESS than the pinned consent half needs. MEASURED at 480x320:
            Allow sat on screen but the Cookie settings / Decline row began 12px below the fold and
            took a scroll to reach, which is the one failure this card must not have. Collapsing the
            top gutter alone gives the card 232px and the whole pinned half fits with room over.
            ⚠️ This is a GUTTER, not content: nothing is hidden by viewport here, which is the trap
            recorded further down. */}
        <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center px-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-[4.5rem] [@media(max-height:480px)]:pt-4 lg:px-4 lg:py-4">
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
              {/* ⚠️ HEIGHT-CLAMPED, NOT WIDTH-CLAMPED — that is what "fit nicely across all
                  platforms" actually requires here. The cut-out is ~1.2:1, so sizing it by width
                  would make it ~375px tall inside a 448px card, taller than the whole consent half,
                  and it would push Allow off a landscape phone. `clamp(6.5rem,24vh,12.5rem)` ties
                  the photo to the VIEWPORT's height instead: 200px on a phone held upright, ~104px
                  on a 360px-tall landscape one, never more than 200px on a desktop card. `w-auto`
                  lets the width follow, so it stays centred and uncropped at every size.
                  ⚠️ `alt=""` ON PURPOSE. The two lines below ARE the words in the picture and they
                  are the dialog's accessible name; a descriptive alt would announce that sentence
                  twice. */}
              <div className="flex justify-center">
                <Image
                  src="/consent-team.webp"
                  alt=""
                  width={1000}
                  height={837}
                  sizes="250px"
                  className="h-[clamp(6.5rem,24vh,12.5rem)] w-auto max-w-full object-contain"
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
              <div className="sticky bottom-0 z-10 -mx-3 mt-2.5 border-t border-line bg-popover px-3 pt-2.5 sm:-mx-4 sm:px-4">
              {/* ⛔ THE COOKIE MASCOT IS GONE FROM THIS VIEW — owner, 2026-09-17, pointing straight at
                  the node: "remove this". It shared the pinned half with the consent question and it
                  cost that half ~92px of permanent height, which is why it used to hide itself under
                  `max-height:560px`. The card now opens on a photograph of the team, so a second
                  illustration two inches below it was competing with the thing it introduces.
                  ⚠️ THE SETTINGS VIEW KEEPS ITS COPY, and that is not an oversight: that view has no
                  photo, so the mascot is the only thing standing between three toggles and a wall of
                  plain rows. Removing it there is a separate decision nobody has made. */}
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
