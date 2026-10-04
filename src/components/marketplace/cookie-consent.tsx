'use client'

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
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
import { CONSENT_V2_KEY } from '@/lib/consent-value'
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

/**
 * ⛔ THE BAR PUBLISHES HOW TALL IT IS, SO WHAT SHARES ITS BOTTOM BAND CAN STAND ABOVE IT RATHER THAN UNDER IT.
 * Measured on prod 2026-10-03 at 390x844: the /vi pilot banner (lang-suggestion-banner.tsx) docks at
 * the same `bottom` as this bar, so when the bar arrived at t=4s its buttons sat on the banner's
 * "Xem bản tiếng Việt" link — elementFromPoint at the link's centre was this bar's "No thanks", and on
 * a local production build a tap aimed at the link RECORDED A REFUSAL nobody chose (the bar is z-[200],
 * the banner z-50; at 1280x800 the click died on the bar's padding instead). The bar now writes its
 * height plus a 0.5rem breath to this variable on <html>
 * while it is on screen, and the banner lifts itself by that much.
 * ⚠️ IT IS THE BAR'S OWN offsetHeight, read by a ResizeObserver: the question wraps differently in
 * each language and width, and Choose expands the bar in place. A hidden bar (the keyboard is up, or
 * an overlay scrim — see the wrapper) measures 0 and clears it, and so does unmounting.
 * ⚠️ IT MOVES NOTHING ABOUT CONSENT: no choice is stored, the bar keeps its place and its z-index, and
 * the banner sits beside it instead of beneath it. Both the bar and the banner float at the same
 * bottom offset on every width the banner appears on (5rem above the tab bar, 1rem from lg up), so
 * "lift by the bar's height" is exactly enough there; inside the native tab shell the bar sits lower
 * and the lift is only more than enough.
 */
export const CONSENT_CLEARANCE_VAR = '--consent-clearance'
const CLEARANCE_GAP_PX = 8

const ALL_OFF: ConsentFlags = { p: false, a: false, d: false }
const ALL_ON: ConsentFlags = { p: true, a: true, d: true }

/**
 * One purpose: its name, what it does, and its OWN switch (consent v2).
 *
 * ⛔ A REAL SWITCH (Base UI via ui/switch — role="switch", aria-checked, Space/Enter), NOT THE
 * aria-pressed BUTTON THAT WAS HERE. This is a consent decision: its state has to be announced as
 * on/off, and the house rule is a Base UI primitive before anything hand-rolled.
 * ⚠️ Named by the visible title and described by the line under it, so a screen reader hears
 * "Analytics, switch, off — Google Analytics measures …" rather than a bare "switch".
 * ⛔ THE DESCRIPTION IS `text-xs text-muted-foreground`, NEVER THE BAR'S SMALLEST TYPE. It is the only
 * place the settings view names each vendor and says a hashed email or phone goes to Meta — the
 * disclosure a Decree 356 Art 6(3) reading of "clear consent mechanics" hangs on.
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
 * ⛔ ONE BLOCK PER SENTENCE, SO THE BAR IS NEVER THE PAGE'S "LARGEST CONTENTFUL PAINT" (UX3 speed audit,
 * 2026-10-05: Chromium phone lab 390×844, CPU 4×, 5 cold loads per page, prod and preview alike). LCP counts a text candidate per BLOCK element, and the
 * first-layer sentence was one paragraph of 39,672 px² on a 390 px phone — bigger than the largest card photo
 * (32,041 px²) — painted 4 s in (SHOW_AFTER_MS). So on every first visit the phone LCP was this bar at 6.5–7.0 s
 * instead of the photo at ~1.5 s, on /, /c/*, /post and search (8.2 s on storefronts), in the lab and in PSI.
 * Split at sentence ends (. ? ! and 。？！ — a language without them, e.g. Thai, stays one block), each block is
 * smaller than a card photo, and the photo stays the LCP where the page has one (verified in the UX3 preview).
 * ⚠️ THE WORDS AND THE tr() STRINGS ARE UNCHANGED — the split happens on the translated text at render, so the
 * copy fingerprint (and CONSENT_COPY_VERSION) is untouched and no sentence is reworded or resized (text-sm
 * stays: "cut words — never the size"). The only visible change: each sentence starts on its own line.
 */
function SentenceBlocks({ text, tail }: { text: string; tail?: ReactNode }) {
  // ⛔ NO LOOKBEHIND (codex + opus, gate 2026-10-05): a `(?<=…)` regex literal is a SyntaxError when the chunk is
  // PARSED on iOS Safari < 16.4, and this file shares the root-layout chunk with the tab bar — one old iPhone
  // would lose the consent bar and the navigation together. Match sentences forward instead.
  const parts = (text.match(/[^.?!。？！]+[.?!。？！]+|[^.?!。？！]+$/g) ?? [text]).map((p) => p.trim()).filter(Boolean)
  // An empty translation must never take the Privacy Policy link with it (opus, gate): the link always renders.
  if (!parts.length) return tail ? <span className="block">{tail}</span> : null
  return (
    <>
      {parts.map((sentence, i) => (
        <span key={i} className="block">
          {sentence}
          {/* The space a sentence break had, kept: screen readers and textContent read "choose. Change", and a
              trailing space at the end of a block line paints nothing. */}
          {i < parts.length - 1 ? ' ' : tail ? <>{' '}{tail}</> : null}
        </span>
      ))}
    </>
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
export function screenBusy(): boolean {
  return document.documentElement.classList.contains('kb-open') || document.querySelector('.overlay-scrim') !== null
}
/** How often the auto-prompt re-checks `screenBusy()` — only while it is waiting or on screen. */
const BUSY_POLL_MS = 250

/** The consent bar — a slim strip docked above the tab bar (owner, 2026-09-25: "Slim bottom bar").
 *  One question and three equal choices: Accept / Decline / Settings. Settings expands the same bar
 *  into the per-purpose switches (consent v2: Personalization, Analytics, Advertising — each its own
 *  switch, all OFF until the visitor turns it on), which is also what the footer's "Cookie settings"
 *  opens directly. */
export function CookieConsent() {
  const { tr, lang } = useLanguage()
  // Where initial focus goes when the dialog opens — see initialFocus on the Popup below.
  const popupRef = useRef<HTMLDivElement>(null)
  /**
   * The popup's ref, which also keeps CONSENT_CLEARANCE_VAR in step with the bar's height for as long
   * as the bar is mounted — see the constant. A callback ref rather than an effect on `show`: the popup
   * mounts inside a portal, possibly a render after `show` flips, and this runs exactly when the node
   * exists. React 19 calls the returned cleanup when the node goes (Base UI's merged ref forwards it).
   */
  const popupMeasureRef = useCallback((el: HTMLDivElement | null) => {
    popupRef.current = el
    if (!el) return
    const root = document.documentElement.style
    const write = () => {
      const h = el.offsetHeight
      if (h > 0) root.setProperty(CONSENT_CLEARANCE_VAR, `${h + CLEARANCE_GAP_PX}px`)
      else root.removeProperty(CONSENT_CLEARANCE_VAR)
    }
    write()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(write) : null
    ro?.observe(el)
    return () => {
      ro?.disconnect()
      root.removeProperty(CONSENT_CLEARANCE_VAR)
      popupRef.current = null
    }
  }, [])
  /**
   * The pending first-visit timer, so `close()` can CANCEL it.
   *
   * ⚠️ THE GUARD INSIDE THE CALLBACK IS NOT ENOUGH ON ITS OWN, and review had to point that out
   * twice before this was right. Re-reading the stored answer covers "the user DECIDED during the
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
  /**
   * ⛔ EVERY SWITCH STARTS OFF, AND NOTHING COUPLES THEM (consent v2). v1 started "Personalized" ON
   * for a visitor who had not answered (and, until d2dcc590, "Ad personalization" too), so a
   * first-visit Save recorded a consent nobody gave; and it linked the toggles (ads on ⇒ personalized
   * on). Consent is per purpose (PDPL 91/2025 Art 9(4)(a)), so each switch writes exactly its own flag.
   */
  const [flags, setFlags] = useState<ConsentFlags>(ALL_OFF)
  /** Seed the settings view from the stored answer — ONE rule for both ways into it. No answer ⇒ all off. */
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
      if (consentAnswered()) return
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
    if (consentAnswered()) { setDeferred(false); return }
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
   * ⛔ A CHOICE MADE IN ANOTHER TAB CLOSES A CARD THAT OPENED ON ITS OWN HERE. Left open, a click on it
   * would overwrite the newer decision with whatever this stale card shows (codex, 2026-10-01). `storage`
   * fires in every OTHER tab when setConsent() writes its local copy (key null = storage cleared). A card
   * the visitor opened themselves (Cookie settings) stays: closing it under their hand would be worse.
   */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== CONSENT_V2_KEY) return
      if (!consentAnswered()) return
      setWaiting(false)
      setDeferred(false)
      if (!openedByUser) setShow(false)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [openedByUser])

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
        if (consentAnswered()) { setWaiting(false); return }
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
      /**
       * ⛔ A DELIBERATE OPEN CANCELS THE PENDING AUTO-OPEN, ANY DEFERRAL AND ANY WAIT (consent v2;
       * agy caught it on that diff). Left pending, the 4s timer or the next navigation would fire into
       * a bar the visitor is already setting switches on — and the automatic path does not know it
       * was opened by hand.
       */
      if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null }
      setDeferred(false)
      setWaiting(false)
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
   *     than the question, pre-filled from a stored answer that did not exist.
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
  /**
   * ⛔ INSIDE THE NATIVE APPS ANALYTICS AND ADVERTISING ARE NOT OFFERED AT ALL. The app is a web view
   * of this site, and Apple's App Tracking Transparency covers web views: sending a hashed email to
   * Meta from inside the app is "tracking", which needs the ATT prompt the apps do not show — and a
   * consent banner is not a substitute for it. So the two rows render locked OFF, "Accept" there
   * means personalization only, and src/lib/consent.ts + the server force both off whatever is stored.
   * Safe to read inline because the dialog never renders before mount (show starts false).
   */
  const isNative = isNativeContext()

  /** A choice that acts only once the bar has been on screen long enough to be seen — ARM_AFTER_MS. */
  const whenArmed = (act: () => void) => () => { if (armed.current) act() }
  /**
   * Store the answer (and its record — POST /api/consent), then close. The surface is read BEFORE
   * close() resets `openedByUser`: the auto-prompt (and its Settings view) is 'banner', the footer /
   * dashboard / privacy re-open is 'settings'.
   */
  const choose = (next: ConsentFlags, action: ConsentAction) => {
    const f = isNative ? { ...next, a: false, d: false } : next
    setConsent(f, { surface: openedByUser ? 'settings' : 'banner', action, locale: lang })
    close()
  }
  const allow = whenArmed(() => choose(ALL_ON, 'allow_all'))
  const save = whenArmed(() => choose(flags, 'save'))
  const decline = whenArmed(() => choose(ALL_OFF, 'decline_all'))
  const setFlag = (k: keyof ConsentFlags) => (v: boolean) => setFlags((f) => ({ ...f, [k]: v }))
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

  /**
   * ⛔ ONE CLASS STRING FOR ALL THREE CHOICES ON EITHER VIEW — Accept / Decline / Settings on the
   * question, and Save my choices / Decline all / Allow all on the switches. Equal weight is the owner's brief
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
            ⚠️ BOTTOM = THE TAB BAR (4.5rem, its footprint — which must track <BottomNavSpacer/> and
            the pill's height + gap in mobile-nav.tsx) + the safe area + a 0.5rem breath. The `max(env(), var())` pair is the same one
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
            ref={popupMeasureRef}
            // The sign-up prompt (signup-prompt.ts OPEN_LAYER_SELECTOR) may open over the card ONLY while it is the
            // unanswered auto-prompt — a visitor who never answers it is exactly who the prompt is for; the card
            // hides itself under any overlay scrim. A card the visitor OPENED (Cookie settings) still blocks it.
            // …and only on its first view: once the visitor presses "Choose" they are mid-decision (opus).
            data-consent-auto={autoShown && view === 'ask' ? '' : undefined}
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
              {/* ⚠️ THE TITLE IS NOW VISIBLE — AND THE ACCESSIBLE NAME STILL STARTS "Cookie consent"
                  (owner, 2026-10-01: "we use your data for these, help us to deliver you best service
                  … friendly to accept"). The warm headline is what a sighted reader sees; the sr-only
                  prefix keeps the dialog's name saying what the surface IS, for the reason above. */}
              <div className="md:flex-1">
              <DialogPrimitive.Title className="text-sm font-bold leading-tight text-foreground">
                <span className="sr-only">{tr('Cookie consent', 'Đồng ý cookie')}{': '}</span>
                {tr('Help us improve eno', 'Giúp eno tốt hơn')}
              </DialogPrimitive.Title>
              {/**
                * ⛔ STILL A QUESTION, AND IT SAYS WHAT "SOUNDS GOOD" TURNS ON — ALL THREE PURPOSES, BY
                * VENDOR. Minimal since 2026-10-03 (owner: "have less text on cookie minimal") — every
                * clause left is one of the facts below; anything more goes in the Choose view, which
                * spells each purpose out. Still a question because it is a request, not a notice:
                * shown while nothing is
                * stored, "We use cookies to…" would assert processing that has not been agreed to (opus,
                * on the diff; agy and opus both refused a conditional "If you agree, we’ll…" at plan
                * time for the same reason).
                * Accept stores consent v2 with all three purposes on (src/lib/consent.ts): the For You /
                * Recently viewed suggestions from the visitor's own activity (`p`), Google Analytics (`a`)
                * and Meta / Google ad measurement (`d`) — the settings rows say the same, one by one.
                * ⛔ AND IT SAYS WHY NOTHING IS ON YET: on-site behaviour is sensitive personal data under
                * Decree 356/2025 (Art 4(1) lists it; Art 6(4) requires saying so). The v1 line promised
                * Allow would "keep you signed in", which was never true: sign-in is essential storage
                * and works whatever is chosen. ⚠️ AND THAT IT CAN BE CHANGED ANYTIME, AND WHERE — the
                * right to withdraw, with its path ("Cookie settings", the footer link), stated before the
                * choice. A bare "Change anytime" was tried in the 2026-10-03 cut and both review seats
                * refused it: being told you can withdraw without being told how is the gap.
                * ⚠️ EACH USE IS NAMED AS A PURPOSE, THEN ITS VENDOR — "analytics (Google Analytics)", not
                * the brand alone (opus, same review): consent is to a purpose, and a vendor is not one. And
                * "listing suggestions", not bare "suggestions" (opus, round 2): bare, it can read as asking
                * the visitor for feedback, and the Vietnamese has always said "gợi ý tin đăng".
                * ⛔ "SUGGEST", NEVER "RANK" OR "REORDER" (codex, on the diff). /legal/ranking — the
                * disclosure a sàn TMĐT owes — says results are NOT reordered by personal data and two
                * people running the same search see the same order. Personalization feeds the For You
                * row, not the result order; a consent line saying "rank listings for you" would
                * contradict a legal page in the visitor's first ten seconds.
                * ⚠️ `text-sm`, never the smallest type on the bar: GDPR Art. 7(2) wants a consent
                * request "clearly distinguishable" and intelligible, and this is the whole request.
                * If the bar ever needs to be shorter, cut words — never the size.
                * ⚠️ LEGAL WORDING IS PENDING COUNSEL. Change it with the lawyer's text and bump
                * CONSENT_COPY_VERSION (consent-value.ts) — the test fingerprints every tr() here.
                * ⚠️ No trailing space inside tr(): the warm cron trims, so a padded string never
                * matched its cached translation. The space before the link is JSX.
                */}
              <p className="mt-1 text-sm leading-snug text-muted-foreground">
                <SentenceBlocks
                  text={isNative
                  ? tr(
                      'Can we use your app activity for listing suggestions? It’s sensitive personal data under Vietnamese law, so it’s off until you choose. Change anytime in Cookie settings. Analytics and advertising are always off in the app.',
                      'Bạn cho phép eno dùng hoạt động trong ứng dụng để gợi ý tin đăng không? Theo luật Việt Nam, đây là dữ liệu cá nhân nhạy cảm, nên mục này tắt đến khi bạn chọn. Đổi bất cứ lúc nào trong Cài đặt cookie. Phân tích và quảng cáo luôn tắt trong ứng dụng.',
                    )
                  : tr(
                      'Can we use cookies for listing suggestions, analytics (Google Analytics) and ad measurement (Meta, Google)? Your activity is sensitive personal data under Vietnamese law, so all stay off until you choose. Change anytime in Cookie settings.',
                      'Bạn cho phép eno dùng cookie để gợi ý tin đăng, phân tích (Google Analytics) và đo lường quảng cáo (Meta, Google) không? Theo luật Việt Nam, hoạt động của bạn là dữ liệu cá nhân nhạy cảm, nên tất cả đều tắt đến khi bạn chọn. Đổi bất cứ lúc nào trong Cài đặt cookie.',
                    )}
                  tail={<Link href="/privacy" prefetch={false} className="font-semibold text-accent-foreground underline underline-offset-2">{tr('Privacy Policy', 'Chính sách bảo vệ dữ liệu cá nhân')}</Link>}
                />
              </p>
              </div>
              {/**
                * ⚠️ ACCEPT · DECLINE · SETTINGS, IN THE OWNER'S ORDER, AND ONE ROW. Three equal
                * columns on a phone; beside the sentence from md up. Settings sits under the right
                * thumb, and it is the one choice that records nothing — a slip there opens the
                * detailed choices instead of writing a decision.
                * ⛔ Do NOT move Decline behind a second screen, give it less weight than Accept, or
                * add a tap to refuse. Those are the changes that turn a layout into a finding.
                * ⚠️ FRIENDLIER WORDS, SAME THREE ANSWERS (owner, 2026-10-01). "Sounds good" / "No
                * thanks" / "Choose" are equally warm — the refusal is not a guilt line — and each
                * button's aria-label STARTS with its visible words (WCAG 2.5.3, so voice control still
                * finds it) and then says the effect, so a screen reader hears "Sounds good — accept
                * all", never a bare pleasantry. The recorded actions are unchanged: allow_all /
                * decline_all, and Choose records nothing.
                */}
              <div className="grid grid-cols-3 gap-2 md:w-80 md:shrink-0">
                <Button variant="outline" size="none" onClick={allow} className={choice} aria-label={tr('Sounds good — accept all', 'Đồng ý — chấp nhận tất cả')}>
                  {tr('Sounds good', 'Đồng ý')}
                </Button>
                <Button variant="outline" size="none" onClick={decline} className={choice} aria-label={tr('No thanks — decline all', 'Không, cảm ơn — từ chối tất cả')}>
                  {tr('No thanks', 'Không, cảm ơn')}
                </Button>
                <Button variant="outline" size="none" onClick={openSettings} className={choice} aria-label={tr('Choose — pick what to allow', 'Tùy chọn — chọn từng mục')}>
                  {tr('Choose', 'Tùy chọn')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* THE DETAILED CHOICES — consent v2's three purposes, each its own switch, all OFF until
                  switched on. They expand the same bar upward rather than opening a second surface.
                  The cookie mascot stays beside them from sm up: the owner removed it from the first
                  layer on 2026-09-17 and kept it here. */}
              <div className="flex items-start gap-3">
              <Mascot name="cookie" className="hidden h-20 w-20 shrink-0 self-center text-foreground sm:block" />
              <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-base font-bold leading-tight text-foreground">{tr('Your choices', 'Lựa chọn của bạn')}</DialogPrimitive.Title>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">
                {isNative
                  ? tr(
                      'Switch on what you’re happy with. Your activity in the app is sensitive personal data under Vietnamese law, so personalization stays off until you switch it on. Analytics and advertising are always off in the app. Decline and everything still works, including sign-in.',
                      'Hãy bật những gì bạn thấy phù hợp. Theo pháp luật Việt Nam, dữ liệu về hoạt động của bạn trong ứng dụng là dữ liệu cá nhân nhạy cảm, nên cá nhân hóa luôn tắt cho đến khi bạn bật. Phân tích và quảng cáo luôn tắt trong ứng dụng. Nếu từ chối, mọi tính năng vẫn hoạt động, kể cả đăng nhập.',
                    )
                  : tr(
                      'Switch on what you’re happy with. Your activity on this site is sensitive personal data under Vietnamese law, so each use below stays off until you switch it on. Decline and everything still works, including sign-in.',
                      'Hãy bật những gì bạn thấy phù hợp. Theo pháp luật Việt Nam, dữ liệu về hoạt động của bạn trên trang này là dữ liệu cá nhân nhạy cảm, nên mỗi mục dưới đây đều tắt cho đến khi bạn bật. Nếu từ chối, mọi tính năng vẫn hoạt động, kể cả đăng nhập.',
                    )}
              </p>
              <div className="mt-1">
                <PurposeRow
                  title={tr('Personalization', 'Cá nhân hóa')}
                  /* ⛔ "SUGGESTS", NOT "RANKS" — see the note on the question above (/legal/ranking). */
                  desc={tr('Suggests listings you’ll like (the For you and Recently viewed rows) from what you search and view here. Never shared with advertisers.', 'Gợi ý tin đăng hợp với bạn (mục Dành cho bạn và Đã xem gần đây) theo những gì bạn tìm và xem tại đây. Không bao giờ chia sẻ cho bên quảng cáo.')}
                  checked={flags.p}
                  onChange={setFlag('p')}
                />
                <PurposeRow
                  title={tr('Analytics', 'Phân tích')}
                  desc={isNative
                    ? tr('Always off in the app.', 'Luôn tắt trong ứng dụng.')
                    : tr('Helps us see what works so we can improve: Google Analytics measures visits and pages, and which link brought you here.', 'Giúp chúng tôi biết điều gì hữu ích để cải thiện: Google Analytics đo lượt truy cập, trang đã xem và liên kết đã đưa bạn đến đây.')}
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
                    : tr('Helps us measure our ads, so we spend on the ones that bring people here: shares actions like views, contacts and sign-ups with Meta (and with Google, if Analytics is on too) — your email or phone is scrambled (hashed) first.', 'Giúp chúng tôi đo hiệu quả quảng cáo, để chỉ chi cho những quảng cáo thật sự đưa mọi người đến đây: chia sẻ các hành động như lượt xem, liên hệ và đăng ký với Meta (và với Google, nếu Phân tích cũng bật) — email hoặc số điện thoại được xáo trộn (băm) trước.')}
                  checked={isNative ? false : flags.d}
                  onChange={setFlag('d')}
                  locked={isNative}
                />
              </div>
              {/**
                * ⛔ THREE EQUAL CHOICES HERE TOO (consent v2): "Save my choices" saves EXACTLY the
                * switches above — all off is a refusal — and "Decline all" / "Allow all" are the two
                * all-or-nothing answers. Same `choice` class as the question's row, so refusing is
                * exactly as easy and as visible as accepting (Decree 356/2025 Art 6(3); EDPB 03/2022).
                * The view change re-arms the ARM_AFTER_MS window, so a double tap on Settings cannot
                * land on whichever of these sits under it.
                */}
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Button variant="outline" size="none" onClick={save} className={choice}>
                  {tr('Save my choices', 'Lưu lựa chọn')}
                </Button>
                <Button variant="outline" size="none" onClick={decline} className={choice}>
                  {tr('Decline all', 'Từ chối tất cả')}
                </Button>
                <Button variant="outline" size="none" onClick={allow} className={choice}>
                  {tr('Allow all', 'Cho phép tất cả')}
                </Button>
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
