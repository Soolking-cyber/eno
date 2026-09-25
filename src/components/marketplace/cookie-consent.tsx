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
      // The on/off state has to be ANNOUNCED — it is a consent decision, not decoration.
      aria-pressed={value}
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

/**
 * ⛔ HOW LONG A FRESHLY SHOWN BAR — OR A FRESHLY SWITCHED VIEW — IGNORES CLICKS ON ITS CHOICES.
 *
 * The bar arrives on its own, four seconds in, at the bottom of the screen: the band a thumb is
 * already working in. Measured on the old centred card (prod, 390x844): a tap aimed at a listing
 * card landed on "Allow cookies" as the card appeared, and a photo tap on the PDP landed on the
 * card. A tap the finger had already committed to before the bar existed is not a choice, and on
 * this surface a mis-tap WRITES a consent decision the reader never made, in either direction.
 * So for 400ms after the bar appears nothing on it records anything; the same window re-arms when
 * the view changes, because Settings expands the bar in place and a double-tap on it would
 * otherwise land its second half on Save, and whenever the bar comes back after stepping aside.
 * ⚠️ ONLY WHAT APPEARS ON ITS OWN IS GUARDED. The footer's "Cookie settings" is a deliberate open —
 * the reader asked for it and is already aimed — so that bar acts on its first click (review, twice:
 * a silent no-op on the withdrawal path is the one place a dropped click is not acceptable).
 * ⚠️ IGNORED IN onClick, NOT WITH `pointer-events-none`. Disarming the hit test would let that
 * in-flight tap fall THROUGH the bar onto whatever is underneath — the opposite of the point. The
 * bar keeps catching every tap in its box; it just does not act on the too-early ones.
 * ⚠️ 400ms is below a deliberate read-aim-tap (a new surface has to be seen before it is aimed at)
 * and above the lag between a finger committing and the press landing; it is the figure the mobile
 * audit recommended. A tap it swallows costs one more tap. A tap it lets through costs a consent.
 */
const ARM_AFTER_MS = 400

/**
 * Is something else holding the screen — a scrimmed overlay open, or the virtual keyboard up?
 *
 * ⛔ THE AUTO-PROMPT NEVER SITS ON TOP OF EITHER: it waits for both to clear before it appears, and
 * if one opens while it is up it steps aside and comes back when they close. The bar lives at
 * z-[200] in the bottom band, which is exactly where a sheet's or a dialog's primary action sits: a
 * guest who taps Account at t=2s would have the sign-in sheet's buttons covered at t=4s. And with the
 * keyboard up the bar would ride above it, over the search field or a chat composer — the tab bar
 * hides then for the same reason (`html.kb-open`, globals.css).
 * ⚠️ STEPPING ASIDE IS A STATE CHANGE, NOT ONLY A HIDE, so the bar re-enters with its animation and a
 * fresh ARM_AFTER_MS window: it returns the moment the overlay closes, which is the moment a finger
 * that just closed it is still in the bottom band. (The wrapper ALSO hides by CSS — instantly, for
 * the ≤BUSY_POLL_MS before the state catches up. That is only safe because pointer dismissal is off:
 * hidden but dismissible, the first tap inside the sheet would have closed a consent prompt nobody
 * could see, storing nothing — opus caught that shape at plan time.)
 * ⚠️ `.overlay-scrim` is the one class every scrimmed overlay renders while open — ui/dialog,
 * sheet, drawer, alert-dialog, select, dropdown, combobox, and the explorer's area filter and
 * custom select — and none of them keep it mounted when closed, so it is the "something else owns
 * the screen" signal (back-to-top reads the same idea off data-slots).
 */
function screenBusy(): boolean {
  return document.documentElement.classList.contains('kb-open') || document.querySelector('.overlay-scrim') !== null
}
/** How often the auto-prompt re-checks `screenBusy()` — only while it is waiting or on screen. */
const BUSY_POLL_MS = 250

/** The consent bar — a slim strip docked above the tab bar (owner, 2026-09-25: "Slim bottom bar").
 *  One sentence and three equal choices: Accept / Decline / Settings. Settings expands the same bar
 *  into the detailed choices, which is also what the footer's "Cookie settings" opens directly. */
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
  /** Whether the choices act on a click yet — see ARM_AFTER_MS. A ref, so a click reads it live. */
  const armed = useRef(false)
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
  /** The auto-open fired while an overlay or the keyboard held the screen — see screenBusy(). */
  const [waiting, setWaiting] = useState(false)
  const [view, setView] = useState<'ask' | 'settings'>('ask')
  const [perso, setPerso] = useState(true)
  // ⛔ AD PERSONALIZATION STARTS OFF. It started ON, so a first visitor who opened "Cookie settings"
  // from the card and pressed Save without touching anything was recorded as consenting to Meta/Google
  // retargeting (hasAdConsent() === true) — consent they never gave. (Audit finding #8.)
  const [ads, setAds] = useState(false)
  /** Seed the settings view from the stored choice — ONE rule for both ways into it. */
  const seedFromConsent = () => {
    const c = getConsent()
    setPerso(c !== 'essential')
    setAds(c === 'all')
  }
  /**
   * The levels are NESTED (all ⊃ personalized ⊃ essential), so the toggles are coupled here rather
   * than in storage: ad personalization on implies personalization on, and personalization off
   * implies ads off. Uncoupled, turning Personalized OFF with ads on was saved as 'all' — the
   * visitor's explicit "no" recorded as a yes.
   */
  const onPerso = (v: boolean) => { setPerso(v); if (!v) setAds(false) }
  const onAds = (v: boolean) => { setAds(v); if (v) setPerso(true) }

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
     * THAT WRONG. When this was a centred card it sat dead centre of the viewport, and `/signin`
     * centres the sign-in card (the popup's own `<SignInCard>`) in the same place: measured on a
     * 1440x900 build, the consent card covered the heading, the Google button, the email field and
     * the submit, and the page was reported as "empty". The bar now docks at the bottom instead, but
     * on a phone the sign-in form's submit and legal line sit in that same bottom band, so the
     * deferral still earns its place and is kept as it was.
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
      else if (screenBusy()) setWaiting(true)
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
     * navigate to the sign-in route, where it lands on the form exactly as before. This used to
     * self-resolve by accident — clicking a sign-in link was an outside press, which dismissed the
     * non-modal card on the way out — and the bar no longer closes on an outside press (see the Root
     * below), so this branch is now the ONLY thing that moves it off /signin. A test pins it.
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
    setDeferred(false)
    // Off /signin, but something may still hold the screen — hand over to the wait, not the bar.
    if (screenBusy()) setWaiting(true)
    else setShow(true)
  }, [deferred, pathname, show, openedByUser])

  /**
   * The other half of `screenBusy()`, for the automatic prompt only. While it WAITS, look again every
   * BUSY_POLL_MS and show it the moment the overlay has closed and the keyboard is down — the same
   * three exits as the timer: decided meanwhile → never; on /signin → the route deferral above takes
   * it; otherwise → shown. While it is UP, step it aside the moment something else takes the screen.
   * A poll, not a MutationObserver on <body>: what it watches is a class on <html> as well as an
   * element anywhere in the portal layer, a mutation observer there would fire on every feed append,
   * and a querySelector four times a second is nothing. It runs only while the prompt is waiting or
   * showing, and a deliberate (footer) open is left alone — the reader asked for it.
   */
  const autoShown = show && !openedByUser
  useEffect(() => {
    if (!waiting && !autoShown) return
    const iv = setInterval(() => {
      if (waiting) {
        if (getConsent() !== null) { setWaiting(false); return }
        if (screenBusy()) return
        setWaiting(false)
        if (window.location.pathname === SIGNIN_PATH) setDeferred(true)
        else setShow(true)
      } else if (screenBusy()) {
        setShow(false)
        setWaiting(true)
      }
    }, BUSY_POLL_MS)
    return () => clearInterval(iv)
  }, [waiting, autoShown])

  useEffect(() => { if (show) setEverShown(true) }, [show])

  /**
   * Arm the choices ARM_AFTER_MS after the bar appears on its own, and again after every view change
   * — see the constant for why. Before the effect runs `armed` is already false (it starts false and
   * `close()` resets it), so there is no frame in which a just-shown bar acts on a click. A deliberate
   * open (the footer's Cookie settings) is armed at once.
   */
  useEffect(() => {
    if (!show) return
    if (openedByUser) { armed.current = true; return }
    armed.current = false
    const t = setTimeout(() => { armed.current = true }, ARM_AFTER_MS)
    return () => clearTimeout(t)
  }, [show, view, openedByUser])

  // Withdrawal right (PDPL): the footer "Cookie settings" link dispatches this to
  // reopen the banner any time, pre-filled with the current choice, so consent is
  // as easy to change as to give (compliance verification 2026-07-06).
  useEffect(() => {
    const reopen = () => {
      seedFromConsent()
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
   * it — so the `data-closed:animate-out` on the popup below never had a frame to run in, and the
   * card vanished instantly after animating in. Declared-but-dead exit animation, and the same
   * shape auth-context.tsx already solved for the sign-in dialog (its note on `everOpened` explains
   * the identical trade).
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
   * The bar adds two more: the choices disarm, so the next appearance starts its ARM_AFTER_MS
   * window from zero; and a waiting auto-open (screenBusy) is cancelled with the timer it continues.
   */
  const close = () => {
    if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null }
    armed.current = false
    // A waiting auto-open is the timer's continuation, so it is cancelled with it: a visitor who
    // opened Cookie settings while it waited and then closed it must not get the prompt back.
    setWaiting(false)
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
  /** A choice that acts only once the bar has been on screen long enough to be seen — ARM_AFTER_MS. */
  const whenArmed = (act: () => void) => () => { if (armed.current) act() }
  const allow = whenArmed(() => { setConsent('all'); close() })
  const save = whenArmed(() => { setConsent(ads ? 'all' : perso ? 'personalized' : 'essential'); close() })
  const decline = whenArmed(() => { setConsent('essential'); close() })
  /**
   * Settings expands the bar in place. ⚠️ FOCUS MOVES TO THE BAR ITSELF, because the button that was
   * just pressed is about to unmount with the ask view — left alone, a keyboard user's focus falls
   * to <body> and their next Tab starts from the top of the page. The popup, not the first toggle:
   * the same reason `initialFocus` names the popup (a pre-focused control is one Enter away from
   * changing a consent setting on the user's behalf).
   */
  const openSettings = whenArmed(() => {
    seedFromConsent()
    setView('settings')
    popupRef.current?.focus({ preventScroll: true })
  })

  // Native copy branch is PRESENTATION-ONLY: same trigger, choices, storage and events —
  // the WebView shares the site's tracking signals, so PDPL consent semantics are identical;
  // only the browser-cookie framing is swapped for app wording. Safe to read inline because
  // the dialog never renders before mount (show starts false).
  const isNative = typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()

  const primary = 'rounded-lg px-4 py-1.5 text-sm transition-colors active:scale-[0.96] cursor-pointer'
  const ghost = 'rounded-lg px-3 py-1.5 text-sm font-semibold text-body transition-colors hover:bg-muted hover:text-body active:scale-[0.96] cursor-pointer'
  /**
   * ⛔ ONE CLASS STRING FOR ALL THREE FIRST-LAYER CHOICES — equal weight is the owner's brief
   * (2026-09-25: "Accept / Decline / Settings with EQUAL visual weight"), and it REPLACES the
   * 2026-08-28 one-dominant-CTA layout (a filled full-width "Allow cookies" over text-link
   * "Cookie settings" / "Decline"). That layout's own note called its prominence gap "the ceiling,
   * not a starting point": EDPB Guidelines 03/2022 on deceptive design patterns name a filled
   * accept over a plain-text refuse directly. Same variant, same box, same type, so the only thing
   * that distinguishes the three is the word on each.
   * ⚠️ `outline`, not `cta` ×3: three filled brand buttons would make the strip the loudest thing
   * on the page, which is the opposite of a slim bar. ⚠️ `min-h-11` is a real 44px target;
   * `whitespace-normal` because "Chấp nhận" in a third of a 320px bar must wrap, not clip; `.press`
   * is the house press (ui/button presses once at 0.97 with it — see docs/design-language.md §6).
   */
  const choice = 'press min-h-11 w-full whitespace-normal rounded-xl px-2 py-2 text-center text-sm font-semibold leading-tight text-foreground'

  return (
    /* ⛔ A BAR AT THE BOTTOM, NEVER A CARD IN THE MIDDLE — AND STILL NEVER WITH A BACKDROP.
       Owner, 2026-09-25: "Slim bottom bar". The centred card this replaces measured 366x473 at
       y=186 on a 390x844 phone — 53% of the screen, over the feed and the PDP gallery, with its team
       photo as the first-visit LCP (5.0s fast, 11.2s at 4x CPU). The bar docks above the tab bar,
       holds one sentence and three choices, and leaves the middle of the screen alone.
       ⛔ THE TWO THINGS THAT FIXED THREE GOOGLE OAUTH VERIFICATION REJECTIONS STAY EXACTLY AS THEY
       WERE. An earlier centred version sat over a `fixed inset-0 bg-black/40 backdrop-blur-[2px]`
       backdrop and auto-opened on every first visit; Google's brand reviewer is ALWAYS a first
       visit, so they screenshotted a dialog over a blurred, un-clickable page — "Your home page is
       behind a login page" and "the app name does not match". The culprit was the backdrop, so:
         · `modal={false}` — the page behind stays interactive and un-trapped.
         · `pointer-events-none` on the wrapper (re-armed to `auto` on the bar alone) — clicks pass
           through everywhere except the bar, so nothing is blocked.
       There is no backdrop element here and there must not be one. If you find yourself adding
       `inset-0 bg-*` or any blur to make the bar "pop", that is the exact change that was
       rejected three times. The 4s delay above helps the same reviewer for free.

       Consent semantics are unchanged by any of this — nothing non-essential fires until a choice
       is stored (src/lib/consent.ts), which is what PDPL requires. A wall was never the mechanism,
       and a bar is not one either. */
    /* ⛔ `disablePointerDismissal`: A TAP OR A SWIPE ON THE PAGE NO LONGER CLOSES IT. A non-modal
       Base UI dialog closes on any outside press by default — a touch drag of 10px counts — and
       closing stores nothing and cancels the timer, so the visitor is not asked again until a full
       reload. On the centred card that let a 53%-of-the-screen card get out of the way. On a slim
       bar it means the first scroll of the feed removes the prompt before anyone reads it — measured
       on the local build: one 240px swipe, bar gone, consent null. Review raised it on both seats.
       This file's own rule decides it: on a PDPL surface, silently never asking is the worse failure.
       So the bar stays until it is answered; it covers 13–15% of a phone screen at the bottom, not the
       page. Escape still closes it (a deliberate key, not a stray touch), and it still steps aside for
       /signin and for any overlay or the keyboard (screenBusy). */
    <DialogPrimitive.Root open={show} modal={false} disablePointerDismissal onOpenChange={(open) => { if (!open) close() }}>
      <DialogPrimitive.Portal>
        {/* ⛔ GEOMETRY ONLY — no background, no blur, and `pointer-events-none`, which is what keeps
            a wrapper this size from swallowing taps on the page (see the note above).
            ⚠️ BOTTOM = THE TAB BAR (4.5rem, which must track <BottomNavSpacer/> and mobile-nav's
            min-h) + the safe area + a 0.5rem breath. The `max(env(), var())` pair is the same one
            back-to-top uses: Android WebView < 140 hands the inset over as a CSS variable instead
            of env(), and everywhere else the variable is unset and this equals plain env().
            ⚠️ IT DOES NOT FOLLOW THE TAB BAR WHEN THAT SCROLLS AWAY. A consent control that slides
            72px under a thumb that is aiming at it is a mis-tap generator; a floating rounded bar
            reads as intended whether the tab bar is there or not. Where there is NO web tab bar —
            desktop (lg), and the native SwiftUI shell's embedded tabs (`html.native-tabs`) — the
            4.5rem goes.
            ⚠️ `top-0` + `items-end` make the wrapper a bottom-anchored column, so the bar's
            `max-h-full` has a real height to cap against when Settings expands it; the top padding
            keeps it off the notch.
            ⚠️ z-[200] IS ABOVE THE BACK-TO-TOP / SUPPORT CLUSTER (z-60, right-4, the same 5rem
            band) AND THE INSTALL HINT (z-70), ON PURPOSE: the bar covers them while it is up rather
            than the other way round, where the support bubble would sit on the Settings button and
            take its taps. It is also above every modal (z-50) — which is why the auto-prompt waits
            while one is open and steps aside when one opens (see screenBusy()), and why the wrapper
            is `display:none` the instant a scrim or the keyboard appears, before that state change
            lands. (Also for the footer-opened bar, which does not step aside: hidden, it just waits
            under the overlay with its switches as they were.) */}
        <div
          className={cn(
            'pointer-events-none fixed inset-x-0 top-0 z-[200] flex items-end justify-center px-2 pt-[max(0.5rem,env(safe-area-inset-top),var(--safe-area-inset-top,0px))]',
            'bottom-[calc(5rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))] lg:bottom-4 lg:px-4',
            '[html.native-tabs_&]:bottom-[calc(0.5rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))]',
            '[html.kb-open_&]:hidden [body:has(.overlay-scrim)_&]:hidden',
          )}
        >
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
             * "Accept" button — pre-focusing the accept action would make Enter consent for the
             * user, and PDPL requires consent be an affirmative act.
             */
            initialFocus={openedByUser ? popupRef : false}
            /* pointer-events-auto re-arms taps on the BAR ITSELF — its whole box, the gaps between
               the buttons and its padding included, so no tap inside it ever reaches the page
               underneath. The wrapper disables them so the page behind stays usable. Do not move
               this to the wrapper.
               ⚠️ `max-h-full overflow-y-auto` IS WHAT KEEPS DECLINE REACHABLE WHEN SETTINGS EXPANDS
               THE BAR on a landscape phone (844x390: ~300px between the notch pad and the tab bar)
               or under a longer translation: it scrolls rather than pushing a choice off-screen,
               which is the one failure this surface must not have.
               ⚠️ 150ms IN, 100ms OUT, ON THE STRONG EASE-OUT — the timing wave 1 settled for this
               surface (exits faster than entrances; the reader just answered, so leaving is the
               system responding). The zoom it had is gone with the centring: a docked bar rises
               from the edge it is docked to and sinks back into it, a 1rem travel it can do without
               ever reading as a slide across the page. Reduced motion is the global kill switch in
               globals.css (every animation and transition at 0.01ms), as for every overlay here. */
            className="pointer-events-auto relative flex max-h-full w-full max-w-3xl flex-col overflow-y-auto rounded-2xl bg-popover p-3 shadow-overlay outline-none md:px-4 animate-in fade-in slide-in-from-bottom-4 duration-150 ease-[var(--ease-out-strong)] data-closed:animate-out data-closed:fade-out data-closed:slide-out-to-bottom-4 data-closed:duration-100"
          >
          {view === 'ask' ? (
            <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:gap-4">
              {/* ⛔ THE TITLE IS "Cookie consent" AND IT IS INVISIBLE. It is the dialog's accessible
                  name (Base UI points `aria-labelledby` at the Title, which outranks any
                  `aria-label`), so it says what the dialog IS — the one thing a screen reader user
                  needs before deciding whether to engage with a surface that asks for consent.
                  ⛔ THE TEAM PHOTOGRAPH AND ITS TAGLINE ARE GONE FROM THE FIRST LAYER (owner,
                  2026-09-25: a slim bar, "no team photo"). On a first visit that photo was the
                  page's LCP element — 47,600px² against the largest feed image's 32,041px², painted
                  at ~5s — so it was costing the metric as well as the screen. The asset stays in
                  public/ (src/lib/import-photo-check.test.ts reads it); nothing renders it now.
                  ⛔ NEVER PUT AN EDITION BRANCH INSIDE `tr()` ON THIS CARD. scripts/gen-ui-strings.mjs
                  scrapes tr() calls out of the SOURCE, so both branches of a ternary land in the
                  marketplace string table — an eno.forum-only sentence naming trips or e-visa would
                  ship in eno.vn's bundle. The copy below names no service and must stay that way;
                  a services variant would belong in its own `.svc.` module. */}
              <DialogPrimitive.Title className="sr-only">{tr('Cookie consent', 'Đồng ý cookie')}</DialogPrimitive.Title>
              {/**
                * ⛔ ONE SENTENCE, A QUESTION, AND IT SAYS WHAT "ACCEPT" TURNS ON. A question because it is
                * a request, not a notice: shown while nothing is stored, "We use cookies to…" would
                * assert processing that has not been agreed to (opus, on the diff). Accept stores 'all', which is
                * the "For You" suggestions built from the visitor's own activity PLUS Meta/Google ad
                * signals — the settings view's own rows say the same. The long sentence this replaces
                * named only the first and promised Allow would "keep you signed in", which was never
                * true: sign-in is essential storage and works whatever is chosen, so the promise only
                * made Decline sound like it would sign you out.
                * ⛔ "SUGGEST", NEVER "RANK" OR "REORDER" (codex, on the diff). /legal/ranking — the
                * disclosure a sàn TMĐT owes — says results are NOT reordered by personal data and two
                * people running the same search see the same order. Personalization feeds the For You
                * row, not the result order; a consent line saying "rank listings for you" would
                * contradict a legal page in the visitor's first ten seconds.
                * ⚠️ `text-sm`, never the smallest type on the bar: GDPR Art. 7(2) wants a consent
                * request "clearly distinguishable" and intelligible, and this is the whole request.
                * If the bar ever needs to be shorter, cut words — never the size.
                * ⚠️ Wording is a legal surface: the parked consent v2 (hold/email-consent) carries
                * counsel-pending text that will replace this; see the report for what it must keep.
                */}
              <p className="text-sm leading-snug text-muted-foreground md:flex-1">
                {isNative
                  ? tr(
                      'Can we use your activity in the app to suggest listings for you and to personalize ads on Meta and Google? ',
                      'Bạn có đồng ý để chúng tôi dùng hoạt động của bạn trong ứng dụng để gợi ý tin đăng và cá nhân hoá quảng cáo trên Meta và Google? ',
                    )
                  : tr(
                      'Can we use cookies to suggest listings for you and to personalize ads on Meta and Google? ',
                      'Bạn có đồng ý để chúng tôi dùng cookie gợi ý tin đăng cho bạn và cá nhân hoá quảng cáo trên Meta và Google? ',
                    )}
                <Link href="/privacy" prefetch={false} className="font-semibold text-accent-foreground underline underline-offset-2">{tr('Privacy policy', 'Chính sách quyền riêng tư')}</Link>
              </p>
              {/**
                * ⚠️ ACCEPT · DECLINE · SETTINGS, IN THE OWNER'S ORDER, AND ONE ROW. Three equal
                * columns on a phone; beside the sentence from md up. Settings sits under the right
                * thumb, and it is the one choice that records nothing — a slip there opens the
                * detailed choices instead of writing a decision.
                * ⛔ Do NOT move Decline behind a second screen, give it less weight than Accept, or
                * add a tap to refuse. Those are the changes that turn a layout into a finding.
                */}
              <div className="grid grid-cols-3 gap-2 md:w-80 md:shrink-0">
                <Button variant="outline" size="none" onClick={allow} className={choice}>
                  {tr('Accept', 'Chấp nhận')}
                </Button>
                <Button variant="outline" size="none" onClick={decline} className={choice}>
                  {tr('Decline', 'Từ chối')}
                </Button>
                <Button variant="outline" size="none" onClick={openSettings} className={choice}>
                  {tr('Settings', 'Tùy chỉnh')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* THE DETAILED CHOICES, UNCHANGED — "Settings opens the existing detailed choices"
                  (owner brief). They expand the same bar upward rather than opening a second
                  surface. The cookie mascot stays beside them from sm up: the owner removed it
                  from the first layer on 2026-09-17 and kept it here, where it is the only thing
                  between three toggles and a wall of plain rows. */}
              <div className="flex items-center gap-3">
              <Mascot name="cookie" className="hidden h-20 w-20 shrink-0 self-center text-foreground sm:block" />
              <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-base font-bold leading-tight text-foreground">{tr('Your choices', 'Lựa chọn của bạn')}</DialogPrimitive.Title>
              <div className="mt-1.5 -ml-1.5 space-y-0">
                <Toggle locked value title={tr('Essential', 'Cần thiết')} desc={tr('Sign-in & speed. Always on.', 'Đăng nhập & tốc độ. Luôn bật.')} />
                <Toggle value={perso} onChange={onPerso} title={tr('Personalized', 'Cá nhân hoá')} desc={tr('Rank the most relevant items first from your activity.', 'Xếp hạng mục phù hợp nhất theo hoạt động của bạn.')} />
                <Toggle value={ads} onChange={onAds} title={tr('Ad personalization', 'Quảng cáo cá nhân hoá')} desc={tr('Ad-network signals (Meta/Google) for retargeting.', 'Tín hiệu mạng quảng cáo (Meta/Google) để tiếp thị lại.')} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <Button variant="cta" size="none" onClick={save} className={primary}>{tr('Save', 'Lưu')}</Button>
                <Button variant="ghost" size="none" onClick={decline} className={ghost}>{tr('Decline all', 'Từ chối tất cả')}</Button>
              </div>
              </div>
              </div>
            </>
          )}
      </DialogPrimitive.Popup>
    </div>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
  )
}
