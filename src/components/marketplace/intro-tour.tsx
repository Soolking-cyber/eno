'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { googleOauthBlocked } from '@/lib/in-app-browser'
import { prefersReducedMotion, scrollBehavior } from '@/lib/reduced-motion'
import { Search, Sparkles, Tag } from '@/components/ui/icons'
import {
  TOUR_DEMO,
  TOUR_EXAMPLE_QUERY,
  hasSeenTour,
  markTourPending,
  markTourSeen,
  tourAnchorFor,
  tourPending,
  type TourStepId,
} from '@/lib/intro-tour'

/** Padding around the hole, so the ring the tour draws on the target is inside it, not blurred off. */
const PAD = 8

/**
 * ⚠️ TIMINGS ARE THE WHOLE UX OF AN AUTO-PLAYING TOUR, so they are named rather than sprinkled.
 * `SETTLE` is the pause after a step's action fires, before the next step begins — the results have
 * to visibly change or the demonstration has demonstrated nothing. `READ` is how long a step's line
 * stays up. `KEY` is the per-character typing interval.
 * ⚠️ NOT TUNED TO A STOPWATCH — tuned to "can you read six words and see the grid change". If these
 * are shortened, the tour stops being legible before it stops being fast.
 */
const READ_MS = 1500
const SETTLE_MS = 1100
const KEY_MS = 45

type Step = {
  id: TourStepId
  icon: React.ReactNode
  /** ⛔ ONE LINE. Owner: "just words with icon". No paragraph, no title/body pair. */
  line: string
}

/**
 * FIRST-RUN TOUR — it DEMONSTRATES the app rather than asking the visitor to drive it.
 *
 * Owner, 2026-08-28: "the tour make it simpler just words with icon ex search hand icon taps and
 * writes Macbook pro 16 inch m5 64GB 1TB with smooth text reveal inside search bar then next taps
 * icon on with text select category electronics then similar select subcategory then select model
 * and lastly select brand", and "sign up and save these should auto trigger google login".
 *
 * ⛔ THIS REVERSES THE PREVIOUS DESIGN, WHICH IS RECORDED IN src/lib/intro-tour.ts AND SHOULD STAY
 * RECORDED. Earlier the same day the ask was the opposite — "make user click 1 by one … let them
 * experience how to find" — and the steps waited on the URL gaining each parameter. Doing teaches
 * better than watching; watching finishes far more often. Both are true, the owner has now picked,
 * and knowing the other was tried is what stops it being rediscovered as a fresh idea later.
 *
 * ⛔ IT DRIVES THE APP'S OWN FILTER EVENT, NOT THE DOM. The obvious implementation of "the hand taps
 * Electronics" is `el.click()` on the real chip, and two reviewers independently said don't: the
 * rail fills in after its own fetch, so the chip may not be mounted when the step fires; it scrolls
 * horizontally inside its own scroller; and `.click()` skips the pointer sequence some handlers key
 * on. So each step dispatches `eno:apply-url` with the next parameter — the same event the
 * notification bell's deep links and the header's brand picks use — and the explorer applies it
 * exactly as it would a real tap. The hand still animates to the chip when it is there; when it is
 * not, the step narrates and the app still moves, instead of stalling on an element that never came.
 *
 * ⚠️ `replace`, NOT `push`, so the visitor does not have to press Back six times to leave.
 *
 * ⛔ AND THE VISITOR CAN ALWAYS TAKE THE WHEEL. This is the thing an auto-playing tour gets wrong:
 * it mutates a page nobody asked it to mutate. So a real click outside the card or any keypress
 * ENDS it, and ending restores the URL the tour started from — but only while the tour still owns
 * that URL, so a visitor who navigated themselves is never yanked backwards. Leaving four filters
 * applied on a page someone was trying to escape is the anti-pattern both reviewers named.
 */
export function IntroTour() {
  const { tr } = useLanguage()
  const { user } = useAuth()
  const pathname = usePathname()

  const [index, setIndex] = useState<number | null>(null)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  /**
   * The target's live viewport rect, re-read every frame. The mask is cut around it and the hand is
   * parked on it, so a stale rect blurs — and points at — the wrong thing.
   */
  const [hole, setHole] = useState<DOMRect | null>(null)

  /**
   * ⛔ A RUN ID, BECAUSE THIS TOUR SCHEDULES WORK IN THE FUTURE. Typing and step advancement are
   * timers; Skip, Esc, a takeover click or leaving the page must make every timer already in flight
   * a no-op. Comparing a captured id against this ref is the only thing that makes "stop" mean
   * stopped rather than "stop after the next tick fires".
   */
  const runId = useRef(0)
  /** The URL the tour found the visitor on, restored if they abandon it. */
  const pristineUrl = useRef<string | null>(null)
  /** True while every URL change since the tour began was the tour's own. */
  const ownsUrl = useRef(false)
  const cardRef = useRef<HTMLDivElement | null>(null)

  const begin = useCallback(() => {
    markTourSeen()
    runId.current += 1
    pristineUrl.current = window.location.pathname + window.location.search
    ownsUrl.current = true
    setIndex(0)
  }, [])

  /**
   * ⚠️ THE UNANCHORED LAST STEP GETS A VIRTUAL ANCHOR AT THE VIEWPORT CENTRE. Passing
   * `anchor={undefined}` does not centre anything — with no trigger to fall back on the positioner
   * keeps its last position, so the card would sit wherever the previous step left it.
   */
  const centreAnchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        new DOMRect(typeof window === 'undefined' ? 0 : window.innerWidth / 2, typeof window === 'undefined' ? 0 : window.innerHeight / 2, 0, 0),
    }),
    [],
  )

  /**
   * ⚠️ ONE ICON AND ONE LINE PER STEP — the whole brief. The facet lines name the control AND the
   * value ("Select category · Electronics") because the value is what makes it a demonstration
   * rather than a label; the chip is highlighted at the same moment, so the two agree on screen.
   */
  const steps: Step[] = useMemo(
    () => [
      {
        id: 'search',
        icon: <Search className="h-5 w-5 text-brand" aria-hidden />,
        line: tr('Search anything', 'Tìm bất cứ thứ gì'),
      },
      {
        id: 'category',
        icon: <Tag className="h-5 w-5 text-brand" aria-hidden />,
        line: tr('Category · Electronics', 'Danh mục · Đồ điện tử'),
      },
      {
        id: 'subcategory',
        icon: <Tag className="h-5 w-5 text-brand" aria-hidden />,
        line: tr('Type · Laptops & PCs', 'Loại · Laptop & PC'),
      },
      {
        id: 'brand',
        icon: <Tag className="h-5 w-5 text-brand" aria-hidden />,
        line: tr('Brand · Apple', 'Hãng · Apple'),
      },
      {
        id: 'model',
        icon: <Tag className="h-5 w-5 text-brand" aria-hidden />,
        line: tr('Model · MacBook Pro M5', 'Mẫu · MacBook Pro M5'),
      },
      {
        id: 'result',
        icon: <Sparkles className="h-5 w-5 text-brand" aria-hidden />,
        line: tr('That is how you find one exact thing', 'Đó là cách tìm đúng một thứ'),
      },
    ],
    [tr],
  )

  const step = index === null ? null : (steps[index] ?? null)
  const isLast = index !== null && index === steps.length - 1

  const finishRef = useRef<() => void>(() => {})

  /**
   * ⚠️ `restore` IS THE DIFFERENCE BETWEEN LEAVING AND BEING LEFT SOMEWHERE. Finishing normally
   * KEEPS the demonstrated results — the visitor watched them being found and the last step points
   * at them. Abandoning restores the page they were on. Same function, opposite intent, so the
   * caller says which.
   */
  const close = useCallback(
    (restore: boolean) => {
      runId.current += 1
      markTourSeen()
      setIndex(null)
      setAnchorEl(null)
      setHole(null)
      if (restore && ownsUrl.current && pristineUrl.current) {
        // Same door back out — see `go` for why the router cannot do this.
        window.dispatchEvent(new CustomEvent('eno:apply-url', { detail: { url: pristineUrl.current } }))
      }
      ownsUrl.current = false
      // Clear the demonstration text out of the search bar; it was never the visitor's.
      if (restore) window.dispatchEvent(new CustomEvent('eno:search-preview', { detail: { text: '' } }))
    },
    [],
  )
  const finish = useCallback(() => close(false), [close])
  finishRef.current = finish

  // ── start: the intro card fires this when it closes, whatever the visitor chose ────────────────
  // ⚠️ ON EITHER CHOICE. Starting the tour only after "Allow" would make it a reward for consenting,
  // which is exactly the nudge PDPL/GDPR call out — consent has to be freely given, so it cannot buy
  // a better product experience.
  useEffect(() => {
    /**
     * ⛔ THE HOME PAGE IS THE ONLY PLACE IT CAN RUN, AND OFF IT THE CLAIM IS PARKED RATHER THAN
     * DROPPED. `CookieConsent` is global and fires this wherever the visitor is; the tour's anchors
     * are the header search box and the category rail. Returning early off-home lost the tour
     * permanently for everyone who arrived on a shared listing link — consent is stored by then and
     * the card never reopens to fire it again.
     */
    const start = () => {
      if (hasSeenTour()) return
      if (window.location.pathname === '/') begin()
      else markTourPending()
    }
    window.addEventListener('eno:start-tour', start)
    return () => window.removeEventListener('eno:start-tour', start)
  }, [begin])

  /**
   * ⛔ THE PARKED CLAIM IS REDEEMED WHENEVER THE VISITOR REACHES `/` — KEYED ON `pathname`, NOT ON
   * MOUNT. The app is a SPA and this component's layout does not unmount, so tapping the header
   * logo to go home runs no mount effect at all; the claim would sit unredeemed until a hard
   * reload, which is the wrong thing to ask of someone who is navigating rather than reloading.
   * ⚠️ STILL A ONE-SHOT: `begin()` writes `done` before the first step opens.
   */
  useEffect(() => {
    if (pathname === '/' && tourPending() && !hasSeenTour()) begin()
  }, [pathname, begin])

  /**
   * ⛔ THE TOUR ENDS IF THE VISITOR LEAVES THE HOME PAGE. Its anchors live here, and a card pointing
   * at an element on another route is worse than no card. The demo changes only the query string,
   * never the pathname, so this does not fire for its own steps.
   */
  useEffect(() => {
    if (index !== null && pathname !== '/') finish()
  }, [pathname, index, finish])

  /**
   * ⛔ THE VISITOR TAKES OVER AND THE TOUR GETS OUT OF THE WAY. An auto-playing sequence that keeps
   * driving while someone is trying to use the page is the failure both reviewers led with, so a
   * real click outside the card, or any keypress, ends it AND hands back the URL it borrowed.
   * ⚠️ `click`, NOT `pointerdown`/`touchstart`. On a phone a scroll BEGINS with a touch, so a
   * pointer-level listener would end the tour the moment anyone scrolled to see what it was talking
   * about. A click is a completed intent; scrolling never produces one.
   */
  useEffect(() => {
    if (index === null) return
    /**
     * ⚠️ THE LAST STEP DOES NOT RESTORE, AND THAT IS NOT AN INCONSISTENCY. Everywhere else a
     * takeover means "I did not ask for this", so the borrowed URL goes back. On the closing step
     * the demonstration is finished and the results ARE the thing being pointed at — "Sign up to
     * save these" refers to them. Restoring there would clear the filters out from under a visitor
     * who is about to press that button, and hand its `next=` a page that no longer shows what it
     * promised. A reviewer traced it.
     */
    const takeOver = (e: Event) => {
      const t = e.target as Node | null
      if (t && cardRef.current?.contains(t)) return
      close(!isLast)
    }
    const onKey = (e: KeyboardEvent) => {
      /**
       * ⛔ NOT WHEN THE KEY IS MEANT FOR THE CARD, WHICH THE FIRST VERSION GOT WRONG AND A REVIEWER
       * CAUGHT. `e.key.length === 1` is true for SPACE — so a keyboard visitor tabbing to "Sign up
       * to save these" and pressing Space fired this listener first, closed the tour, and the
       * button's own handler never ran. The one control the last step exists for was reachable
       * only with a mouse. Esc is deliberately NOT excluded: leaving is leaving, wherever focus is.
       */
      if (e.key !== 'Escape' && cardRef.current?.contains(e.target as Node)) return
      // Everything else at the window level is the visitor starting to type or navigate.
      if (e.key === 'Escape' || e.key.length === 1 || e.key === 'Backspace') close(!isLast)
    }
    window.addEventListener('click', takeOver, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', takeOver, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [index, isLast, close])

  /**
   * ⚠️ RESOLVE THE ANCHOR AFTER PAINT, AND RE-RESOLVE ON EVERY STEP. The rail fills in after its own
   * fetch, so querying once at start would miss it. A step whose element never arrives is NOT
   * skipped any more — the demo drives the URL, so it still works; the hand simply has nothing to
   * point at and the mask stays out of the way.
   */
  useEffect(() => {
    if (!step) return
    const selector = tourAnchorFor(step.id)
    if (!selector) { setAnchorEl(null); return }
    let tries = 0
    let marked: HTMLElement | null = null
    const attach = (found: HTMLElement) => {
      marked = found
      setAnchorEl(found)
      found.setAttribute('data-tour-active', '')
      // ⚠️ `scrollBehavior()`, NOT a literal 'smooth': an explicit behavior in the options bag
      // outranks the `scroll-behavior: auto !important` kill switch in globals.css, so the literal
      // would ignore prefers-reduced-motion while looking as though it respected it.
      found.scrollIntoView({ block: 'center', inline: 'center', behavior: scrollBehavior() })
    }
    const el = document.querySelector<HTMLElement>(selector)
    if (el) { attach(el); return () => el.removeAttribute('data-tour-active') }
    const poll = setInterval(() => {
      const late = document.querySelector<HTMLElement>(selector)
      if (late) { clearInterval(poll); attach(late) }
      else if (++tries >= 12) clearInterval(poll)
    }, 100)
    // ⚠️ REMEMBER THE NODE WE MARKED. Re-querying the selector in cleanup meant that if the rail
    // remounted — the very reason this poll exists — the ring was stripped from whichever element
    // matched second and left burning on the first.
    return () => { clearInterval(poll); marked?.removeAttribute('data-tour-active') }
  }, [step])

  /**
   * ⛔ THE MASK'S HOLE TRACKS THE TARGET EVERY FRAME, NOT ONCE. The rail scrolls, the page scrolls,
   * results load and push things down; a rect measured once drifts off the control and ends up
   * blurring — and pointing at — the wrong thing. A loop is immune to WHY it moved, and it calls
   * `setHole` only when the numbers actually change, so a settled target costs one cheap read per
   * frame and no renders at all.
   */
  useEffect(() => {
    setHole(null)
    if (!anchorEl) return
    let raf = 0
    let last = ''
    const tick = () => {
      const r = anchorEl.getBoundingClientRect()
      const key = `${r.top}|${r.left}|${r.width}|${r.height}`
      if (key !== last) { last = key; setHole(r) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [anchorEl])

  /**
   * ⛔ THE STEP MACHINE. Each step: let its line be read, perform its action, let the results
   * settle, advance. Every timeout is checked against the run id it was scheduled under, so Skip,
   * Esc, a takeover or a route change makes work already in flight a no-op rather than something
   * that lands a second later on a page the tour no longer owns.
   * ⚠️ THE ACTION IS A URL, and the URL is cumulative: each step adds one parameter to the last, so
   * the visitor watches the result count fall the way it would if they were tapping. Measured
   * against production before it was written: 25 → 25 → 25 → 25 → 8. It ends on real listings,
   * which is the rule this file has carried from the start.
   */
  useEffect(() => {
    if (index === null || !step) return
    const my = runId.current
    const alive = () => runId.current === my
    const timers: ReturnType<typeof setTimeout>[] = []
    const later = (fn: () => void, ms: number) => { timers.push(setTimeout(() => { if (alive()) fn() }, ms)) }

    /**
     * ⛔ THE SEARCH STEP AND THE FACET STEPS ARE TWO SEPARATE DEMONSTRATIONS, AND MIXING THEM PUT
     * THREE THINGS ON SCREEN THAT DISAGREED. The first version carried `q` through every step. The
     * explorer treats a plain `?q=` as a RAW TEXT search by convention (its own comment says so) and
     * drops it once facets arrive, so the measured result was: the search bar still showing "Macbook
     * Pro M5 1TB", the URL still carrying it, and the count showing 7,690 — the category total,
     * ignoring the query entirely. A demonstration cannot have its own three surfaces contradict
     * each other.
     * ⚠️ So the text search IS the first step and ends with it; the facet walk is the second thing
     * being shown, and it starts from a clean bar. The bar is cleared at the same moment, below.
     */
    const params = new URLSearchParams()
    if (step.id === 'search') params.set('q', TOUR_EXAMPLE_QUERY)
    for (const d of TOUR_DEMO) {
      const at = steps.findIndex((s) => s.id === d.id)
      if (at !== -1 && at <= index) params.set(d.param, d.value)
    }

    /**
     * ⛔ `eno:apply-url`, NOT `router.replace` — AND THE ROUTER VERSION SHIPPED A TOUR THAT
     * DEMONSTRATED NOTHING. It wrote the right query string and the address bar looked perfect;
     * measured on a real build, the grid behind the card still read "10,020 listings" and the rail
     * still showed every category, because the EXPLORER owns this URL. It maintains the query
     * string itself with `history.pushState` and reads changes from `popstate` — which a Next
     * client-side replace does not fire — so a router write is a URL the app never looks at again.
     * A demonstration whose demonstration does not happen is worse than no tour.
     * ⚠️ THIS IS THE APP'S OWN DOOR, not one opened for the tour: the notification bell's deep links
     * and the header's brand picks both apply filters this way. Using it means the tour produces
     * exactly the state a real interaction produces, which is the entire point of demonstrating.
     */
    const go = () => {
      if (!alive()) return
      ownsUrl.current = true
      window.dispatchEvent(new CustomEvent('eno:apply-url', { detail: { url: `/?${params.toString()}` } }))
    }

    const advance = () => setIndex((i) => (i === null || i >= steps.length - 1 ? i : i + 1))

    if (step.id === 'search') {
      /**
       * ⛔ THE TEXT IS REVEALED IN THE REAL SEARCH BAR, via `eno:search-preview`, which header.tsx
       * listens for. The alternatives were faking a bar over the real one, or fighting React for a
       * controlled input's value; a four-line listener beats both.
       * ⚠️ NO FOCUS IS TAKEN. Focusing would open the suggestions panel over the very results this
       * is about to produce, and on a phone would raise the keyboard.
       * ⚠️ WHOLE-STRING UNDER REDUCED MOTION. A character-by-character reveal IS motion; the step
       * still dwells the same length so the pacing does not change, only the animation.
       */
      const type = (n: number) => {
        if (!alive()) return
        window.dispatchEvent(new CustomEvent('eno:search-preview', { detail: { text: TOUR_EXAMPLE_QUERY.slice(0, n) } }))
        if (n < TOUR_EXAMPLE_QUERY.length) later(() => type(n + 1), KEY_MS)
        else later(() => { go(); later(advance, SETTLE_MS) }, READ_MS)
      }
      if (prefersReducedMotion()) {
        window.dispatchEvent(new CustomEvent('eno:search-preview', { detail: { text: TOUR_EXAMPLE_QUERY } }))
        later(() => { go(); later(advance, SETTLE_MS) }, READ_MS)
      } else {
        later(() => type(1), 450)
      }
    } else if (!isLast) {
      // ⚠️ The bar is emptied as the facet walk begins — see the note on `params`. Doing it here
      // rather than once at the start means the typed query stays visible for the whole of its own
      // step, which is the step it is demonstrating.
      if (step.id === 'category') window.dispatchEvent(new CustomEvent('eno:search-preview', { detail: { text: '' } }))
      later(() => { go(); later(advance, SETTLE_MS) }, READ_MS)
    }

    return () => { timers.forEach(clearTimeout) }
    // ⚠️ `index` alone: `step` and `steps` are derived from it, and listing them would re-run the
    // machine (restarting the typing) on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  /**
   * ⛔ THE LAST STEP GOES STRAIGHT TO GOOGLE — owner: "sign up and save these should auto trigger
   * google login". It briefly opened the in-app sign-in popup instead; that was my change and the
   * owner reversed it.
   * ⚠️ REUSE THE EXISTING GUARD RATHER THAN THE RAW ROUTE. `/auth/google/start` is fine in a normal
   * browser and dead inside an in-app browser (Facebook/Zalo webviews), which is what
   * `googleOauthBlocked()` detects — the same check sign-in-form.tsx makes. When it is blocked the
   * visitor goes to /signin, which owns the whole fallback story.
   * ⚠️ AND `next` IS THE RESULTS THEY WERE JUST SHOWN, not `/`. Signing in to save "these" and
   * landing on an unfiltered home page loses the very things the sentence was pointing at.
   */
  const signUp = () => {
    const back = encodeURIComponent(window.location.pathname + window.location.search)
    markTourSeen()
    window.location.href = googleOauthBlocked() ? `/signin?next=${back}` : `/auth/google/start?next=${back}`
  }

  if (index === null || !step) return null

  /**
   * ⛔ FOUR PANELS AROUND THE TARGET, NOT ONE OVERLAY WITH A CSS HOLE. The mask has two jobs — demote
   * everything that is not the subject, and leave the subject itself alone — and four rectangles do
   * both for free: the gap between them is covered by nothing, so the control underneath keeps its
   * own sharpness and its own clicks with no `pointer-events` juggling.
   * ⚠️ On the last step there is no target, so one full-viewport panel covers everything.
   * ⛔ THE DIM MATCHES `.overlay-scrim`, the backdrop under every popover in the app, because both
   * demote the page for the same reason. `material` is what `.reduce-transparency` keys off: a
   * reader who asks for less transparency loses the BLUR and gets a deeper — but still translucent —
   * scrim, since a mask that goes opaque hides the page it is explaining.
   */
  const panel = 'fixed material tour-mask'
  const anchored = tourAnchorFor(step.id) !== null
  /**
   * ⛔ NO MASK WHILE THE TARGET IS OFF SCREEN, OR THE READER IS TRAPPED. Scroll the anchor past
   * either edge and the clamped geometry collapses the hole to nothing: one panel ends up covering
   * the viewport, the page is dimmed, and the thing the step points at is nowhere to be seen.
   */
  const onScreen = !!hole && hole.bottom > 0 && hole.top < window.innerHeight
  const mask = hole && onScreen ? (() => {
    const top = Math.max(0, hole.top - PAD)
    const bottom = Math.min(window.innerHeight, hole.bottom + PAD)
    const height = Math.max(0, bottom - top)
    return [
      { key: 'top', style: { left: 0, right: 0, top: 0, height: top } },
      { key: 'bottom', style: { left: 0, right: 0, top: bottom, bottom: 0 } },
      { key: 'left', style: { left: 0, width: Math.max(0, hole.left - PAD), top, height } },
      { key: 'right', style: { left: Math.max(0, hole.right + PAD), right: 0, top, height } },
    ]
  })() : anchored ? [] : [{ key: 'all', style: { inset: 0 } }]

  return (
    <>
      {/* z-[1150]: above the app's chrome (header and neighbours run z-[60] to z-[130]) and below
          the tour's own card, which is raised to z-[1160] on the Positioner. */}
      {mask.map(({ key, style }) => (
        <div key={key} aria-hidden="true" className={`${panel} z-[1150]`} style={style} />
      ))}

      {/* ⛔ THE HAND — the owner's "hand icon taps". Decorative and `aria-hidden`: it says nothing a
          screen reader needs, and the step's own line is announced instead. It parks at the bottom
          edge of the highlighted control so it reads as a finger about to press it, and it is
          suppressed entirely under reduced motion, where a gliding cursor is exactly the kind of
          movement the preference is asking us not to make. */}
      {hole && onScreen && !prefersReducedMotion() && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[1155] transition-[translate] duration-500 ease-[var(--ease-spring-snappy)]"
          /**
           * ⚠️ INSIDE THE TARGET'S BOTTOM-RIGHT, NOT BELOW ITS CENTRE. Parked under the middle of
           * the control it was almost entirely hidden by the card, which opens centred 14px below
           * the same anchor — measured on a phone, only the fingertip showed. Inside the box it
           * stays within the one region the mask leaves lit, so it reads as a finger on the control
           * rather than a stray glyph, and it cannot collide with the card at any width.
           * ⚠️ Clamped to the viewport so a target flush with the right edge does not push it off.
           */
          style={{
            left: 0,
            top: 0,
            // ⚠️ Clamped at BOTH ends. A target scrolled so its bottom is within 26px of the top
            // edge still counts as on-screen, and the unclamped form put the hand at a negative
            // offset — off the viewport, pointing at nothing. A reviewer spotted the missing floor.
            translate: `${Math.round(Math.max(0, Math.min(hole.right - 26, window.innerWidth - 30)))}px ${Math.round(Math.max(0, hole.bottom - 26))}px`,
          }}
        >
          <span className="relative flex h-6 w-6">
            <span className="absolute inset-0 animate-ping rounded-full bg-brand/30" />
            <svg viewBox="0 0 24 24" className="relative h-6 w-6 drop-shadow-sm" fill="none">
              <path
                d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V12m0-1a1.5 1.5 0 0 1 3 0v1.5m0 0v3A5.5 5.5 0 0 1 12.5 21h-1a5.5 5.5 0 0 1-5.5-5.5v-4a1.5 1.5 0 0 1 3 0"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-brand"
                fill="var(--card)"
              />
            </svg>
          </span>
        </div>
      )}

      {/* ⛔ THE OUTSIDE PRESS MUST NOT CLOSE THIS THROUGH BASE UI — the takeover listener above owns
          that, because it also has to hand the URL back. Base UI's non-modal Popover dismisses on
          any outside press, which would close the card and leave four filters applied. */}
      <Popover open onOpenChange={() => { /* see above — closing is ours alone */ }}>
        <PopoverContent
          anchor={anchorEl ?? centreAnchor}
          side="bottom"
          sideOffset={14}
          collisionPadding={12}
          positionerClassName="z-[1160]"
          // ⛔ NO `backdrop` — three Google OAuth brand reviews rejected a dimmed page behind a card.
          className="w-[min(20rem,calc(100vw-1.5rem))] gap-2"
          // ⚠️ FOCUS IS NEVER TAKEN. The tour plays by itself and the visitor may be reading, or
          // typing; there is no control here they must reach to make it progress. Skip is reachable
          // by Tab, and any keypress ends the tour anyway.
          initialFocus={false}
        >
          {/* ⚠️ CENTRED — owner, 2026-08-28, on the button row: "center its content". The whole card
              is centred rather than only the buttons: an icon-plus-one-line card that centres its
              text and left-aligns its actions reads as two different cards. */}
          <div ref={cardRef} className="flex flex-col items-center gap-2 text-center">
            <div className="flex items-center gap-2">
              <p className="text-2xs font-semibold uppercase tracking-wide text-ink-4">
                {tr('Quick tour', 'Hướng dẫn nhanh')} · {(index ?? 0) + 1}/{steps.length}
              </p>
            </div>

            {/* ⚠️ A POLITE LIVE REGION. The tour advances on a timer with no visitor input, so a
                screen reader would otherwise be told nothing at all as the page changes underneath.
                One announcement per step, never interrupting. */}
            <div className="flex items-center gap-2" aria-live="polite">
              {step.icon}
              <p className="text-sm font-bold leading-tight text-foreground">{step.line}</p>
            </div>

            <div className="mt-0.5 flex items-center justify-center gap-1.5">
              {isLast ? (
                <>
                  {/*
                    ⛔ A MEMBER MUST NOT BE SENT THROUGH GOOGLE, AND THE FIRST VERSION SENT THEM.
                    Only the LABEL branched on `user`; the handler was `signUp` either way, so
                    "Got it" hard-navigated a signed-in visitor to /auth/google/start — which for an
                    account created with an email link is an identity-LINKING round trip, not a
                    no-op. The file this replaced carried that exact warning and I dropped it with
                    the rewrite; a reviewer put it back. The button says what it does now.
                  */}
                  <Button variant="cta" size="none" onClick={user ? finish : signUp} className="rounded-lg px-3 py-1.5 text-sm cursor-pointer">
                    {user ? tr('Got it', 'Đã hiểu') : tr('Sign up to save these', 'Đăng ký để lưu tin')}
                  </Button>
                  <Button variant="ghost" size="none" onClick={finish} className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-body hover:bg-muted cursor-pointer">
                    {tr('Maybe later', 'Để sau')}
                  </Button>
                </>
              ) : (
                <Button variant="bare" size="none" onClick={() => close(true)} className="text-2xs font-semibold text-ink-4 hover:text-foreground cursor-pointer">
                  {tr('Skip', 'Bỏ qua')}
                </Button>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
