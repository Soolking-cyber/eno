'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { googleOauthBlocked } from '@/lib/in-app-browser'
import { prefersReducedMotion, scrollBehavior } from '@/lib/reduced-motion'
import { Search, Sparkles, Tag } from '@/components/ui/icons'
import {
  TOUR_EXAMPLE_QUERY,
  drillDone,
  isDrillStep,
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
 * ⚠️ ONLY THE SEARCH STEP IS TIMED — the other four wait for the visitor — so these three numbers
 * are the entire pacing of the part that plays itself. `READ` is how long the line stays up before
 * the query is submitted, `KEY` is the per-character typing interval, and `SETTLE` is the pause
 * afterwards, before the facet walk takes over.
 * ⚠️ `SETTLE` WAS 1100 AND THAT WAS MEASURED TOO SHORT. The search fires, the results come back over
 * the network, and only then is there anything to look at: sampled on a real build, the count
 * reached 105 at t+3.5s and the step handed over at t+4.2s, so the whole point of the step — a
 * number visibly falling from 10,020 — was on screen for seven tenths of a second. The settle has
 * to outlast the request, not the render.
 * ⚠️ NOT TUNED TO A STOPWATCH — tuned to "can you read six words and see the grid change". Shorten
 * these and the tour stops being legible before it stops being fast.
 */
const READ_MS = 1500
const SETTLE_MS = 1900
const KEY_MS = 45

type Step = {
  id: TourStepId
  icon: React.ReactNode
  /** ⛔ ONE LINE. Owner: "just words with icon". No paragraph, no title/body pair. */
  line: string
}

/**
 * FIRST-RUN TOUR — the tour WRITES, the visitor TAPS.
 *
 * Owner, 2026-08-28, across three passes: "just words with icon ex search hand icon taps and writes
 * Macbook pro 16 inch m5 64GB 1TB with smooth text reveal inside search bar then next taps icon on
 * with text select category electronics", then "sign up and save these should auto trigger google
 * login", then — after seeing it play by itself — "dont auto run taps make it user do the taps".
 *
 * ⛔ SO ONE THING IS DEMONSTRATED AND ONE THING IS ASKED FOR, and the split is the design rather
 * than a compromise. The search query types itself into the real bar, because nobody could mistake
 * that for their own work and it is the fastest way to show what the box is for. The four facet
 * steps do NOT act: each highlights one real chip and waits for the visitor to press it. The full
 * back-and-forth that got here is in src/lib/intro-tour.ts and is worth keeping — every version of
 * it was a reasonable thing to want, and the trade (doing teaches better, watching finishes more
 * often) is the kind that gets rediscovered as a fresh idea otherwise.
 *
 * ⛔ THE SEARCH STEP DRIVES THE APP'S OWN FILTER EVENT, NOT THE DOM. `router.replace` was tried and
 * shipped a demonstration that demonstrated nothing: it wrote a perfect query string while the grid
 * behind the card still read "10,020 listings", because the EXPLORER owns this URL — it maintains
 * the query string with `history.pushState` and reads changes from `popstate`, which a client-side
 * replace never fires. `eno:apply-url` is the app's own door, used by the notification bell's deep
 * links and the header's brand picks, so the tour produces exactly the state a real interaction
 * produces. The four facet steps need none of this: the visitor's own tap does it.
 *
 * ⚠️ `replace`, NOT `push`, so the visitor does not have to press Back six times to leave.
 *
 * ⛔ AND THE VISITOR CAN ALWAYS TAKE THE WHEEL — but the tap the tour ASKED FOR is not taking over,
 * which is the distinction that makes a wait-for-tap tour work at all. A click anywhere except the
 * card and the highlighted chip ends it, and ending undoes only what the tour itself did: the typed
 * search, and only while no facet has been tapped yet. Filters the visitor pressed are theirs, and
 * clearing those on the way out would be the hijacking this rule exists to prevent.
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
   * ⛔ WHICH SIDE THE CARD OPENS ON, DECIDED ONCE PER STEP. Reading it from `hole` on every render
   * looked equivalent and was not: `hole` updates every frame the target moves, so a smooth
   * `scrollIntoView` sweeps the anchor straight through the threshold and the card jumps from below
   * the target to above it mid-scroll — during the very re-centring that exists to steady things. A
   * reviewer spotted the missing hysteresis; latching per step is simpler than a dead band and has
   * no flicker at all.
   */
  const [side, setSide] = useState<'top' | 'bottom'>('bottom')

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
        line: tr('Tap Electronics', 'Chạm Đồ điện tử'),
      },
      {
        id: 'subcategory',
        icon: <Tag className="h-5 w-5 text-brand" aria-hidden />,
        line: tr('Tap Laptops & PCs', 'Chạm Laptop & PC'),
      },
      {
        id: 'brand',
        icon: <Tag className="h-5 w-5 text-brand" aria-hidden />,
        line: tr('Tap Apple', 'Chạm Apple'),
      },
      {
        id: 'model',
        icon: <Tag className="h-5 w-5 text-brand" aria-hidden />,
        line: tr('Tap MacBook Pro M5', 'Chạm MacBook Pro M5'),
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
   * ⛔ THE TAP THE TOUR ASKED FOR IS NOT A TAKEOVER, AND GETTING THAT WRONG BREAKS THE WHOLE TOUR.
   * Four of the six steps now wait for the visitor to press the highlighted chip — so a listener
   * that ends the tour on "any click outside the card" would end it on precisely the click the step
   * exists to invite. The anchor is excluded for that reason, not as a nicety.
   * ⚠️ Everything ELSE still ends it: an auto-playing card that keeps pointing while someone is
   * trying to use the page is the failure both reviewers led with, and the typing step genuinely
   * does drive the page.
   * ⚠️ `click`, NOT `pointerdown`/`touchstart`. On a phone a scroll BEGINS with a touch, so a
   * pointer-level listener would end the tour the moment anyone scrolled to see the chip it is
   * pointing at. A click is a completed intent; scrolling never produces one.
   */
  useEffect(() => {
    if (index === null) return
    /**
     * ⛔ THE CLICK LISTENER RUNS ONLY WHILE THE TOUR IS DRIVING — i.e. the typing step — AND A
     * REVIEWER FOUND WHY THAT MATTERS. On the four waiting steps the visitor is being ASKED to tap,
     * and the chip they are told to press may be the copy inside the rail's "More" overflow rather
     * than the one being pointed at; `drillDone` is read off the URL precisely so that path counts.
     * With a blanket listener that tap lands outside both the card and the anchor, so it read as
     * "the visitor took over": the tour ended AND undid the category they had just correctly
     * applied — exactly the hijacking this was written to prevent.
     * ⚠️ Esc and Skip still leave from any step; only this listener is narrowed.
     */
    const driving = step?.id === 'search'
    /**
     * ⚠️ RESTORE ONLY WHAT THE TOUR ITSELF DID. It types a search query; the visitor does the rest.
     * So abandoning before any facet has been tapped undoes the typed search — which was never
     * theirs — and abandoning after undoes nothing, because those filters are the result of their
     * own presses and clearing them would be the hijacking this rule exists to prevent.
     */
    // ⚠️ DERIVED FROM THE STEP, NOT A MAGIC INDEX. `index <= 1` said the same thing until someone
    // reorders the steps, at which point it silently scopes the wrong ones. Nothing has been tapped
    // until the category step is behind us, so those are the two where the state is still the
    // tour's to undo. A reviewer flagged the literal.
    const mine = step?.id === 'search' || step?.id === 'category'
    const takeOver = (e: Event) => {
      const t = e.target as Node | null
      if (t && (cardRef.current?.contains(t) || anchorEl?.contains(t))) return
      close(mine)
    }
    const onKey = (e: KeyboardEvent) => {
      /**
       * ⛔ NOT WHEN THE KEY IS MEANT FOR THE CARD. `e.key.length === 1` is true for SPACE — so a
       * keyboard visitor tabbing to "Sign up to save these" and pressing Space fired this listener
       * first, closed the tour, and the button's own handler never ran. A reviewer caught it: the
       * one control the last step exists for was reachable only with a mouse. Esc is deliberately
       * NOT excluded — leaving is leaving, wherever focus happens to be.
       */
      if (e.key !== 'Escape' && cardRef.current?.contains(e.target as Node)) return
      if (e.key === 'Escape' || e.key.length === 1 || e.key === 'Backspace') close(mine)
    }
    if (driving) window.addEventListener('click', takeOver, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', takeOver, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [index, step, anchorEl, close])

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
      else if (++tries >= 12) {
        clearInterval(poll)
        /**
         * ⛔ MOVE ON RATHER THAN POINT AT NOTHING — and for a WAITING step this is not cosmetic. Its
         * chip is the only way to satisfy it, so a rail that never loads leaves "Tap Electronics" on
         * screen with nothing to tap and no way forward but Skip. A reviewer caught that the
         * previous design's stated safety ("the app still moves") had been removed with the
         * auto-advance and not replaced.
         */
        setIndex((i) => (i === null || i >= steps.length - 1 ? i : i + 1))
      }
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
    /**
     * ⛔ AND IT KEEPS THE TARGET ON SCREEN, BECAUSE SCROLLING TO IT ONCE IS NOT ENOUGH — owner,
     * 2026-08-28, from a phone: "on mobile scrolling breaks center the button that needs to be
     * tapped". `attach()` centres the chip the moment it resolves, and then the page keeps moving:
     * results arrive, the rail's images land, a facet panel opens and pushes everything down. On the
     * waiting steps that is the difference between "tap Laptops & PCs" naming something under your
     * thumb and naming something off the edge of the screen.
     *
     * ⚠️ THREE GUARDS, BECAUSE RE-CENTRING IS ONLY HELPFUL WHEN IT IS NOT FIGHTING ANYONE.
     *   · It acts only when the target is genuinely OUT of the comfortable band, never to nudge
     *     something that is merely off-centre.
     *   · It stands down for `QUIET_MS` after any real scroll gesture, so someone deliberately
     *     looking around is never yanked back mid-swipe — it re-centres once they stop.
     * ⚠️ THERE IS DELIBERATELY NO "GIVE UP" LATCH. The first version stopped correcting for the
     * rest of the step once a scroll failed to move the page — and a reviewer traced the hole in
     * that: the latch was keyed on scrollY while the failure mode is LAYOUT. A chip that cannot
     * reach the band once, then gets pushed under the header when the facet panel opens at the
     * same scroll position, would never be recovered. Throttling is enough; a `scrollIntoView` that
     * has nothing to do is a cheap no-op, and retrying is what makes it self-heal.
     */
    const GAP_MS = 700
    const QUIET_MS = 1200
    let lastFix = 0
    let lastGesture = 0
    const gesture = () => { lastGesture = performance.now() }
    window.addEventListener('touchstart', gesture, { passive: true })
    window.addEventListener('touchmove', gesture, { passive: true })
    window.addEventListener('wheel', gesture, { passive: true })

    const tick = () => {
      const r = anchorEl.getBoundingClientRect()
      const key = `${r.top}|${r.left}|${r.width}|${r.height}`
      if (key !== last) {
        // ⚠️ The side is taken from the FIRST measurement of this step and then left alone — see
        // the note on `side`. `last === ''` is that first frame.
        if (!last) setSide(r.bottom > window.innerHeight * 0.58 ? 'top' : 'bottom')
        last = key
        setHole(r)
      }
      const now = performance.now()
      if (now - lastGesture > QUIET_MS && now - lastFix > GAP_MS) {
        // ⚠️ The header is FIXED and overlays the page, so "visible" is not `top >= 0` — a chip
        // tucked under it is on screen and untappable. Measured live rather than hardcoded: the
        // header has three geometries and picks one by scroll position.
        const headerBottom = document.getElementById('app-header')?.getBoundingClientRect().bottom ?? 0
        const offVertically = r.top < headerBottom + PAD || r.bottom > window.innerHeight - 120
        const offHorizontally = r.left < 0 || r.right > window.innerWidth
        if (offVertically || offHorizontally) {
          lastFix = now
          anchorEl.scrollIntoView({ block: 'center', inline: 'center', behavior: scrollBehavior() })
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('touchstart', gesture)
      window.removeEventListener('touchmove', gesture)
      window.removeEventListener('wheel', gesture)
    }
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
     * ⚠️ THE SEARCH STEP SETS ONLY `q`, AND NOTHING CLEARS IT AFTERWARDS. When the tour performed
     * the facet taps itself it rebuilt this whole string each step, and an earlier version emptied
     * the search bar as the facet walk began, because the explorer treats a plain `?q=` as a raw
     * text search and dropped it once facets arrived — three surfaces disagreeing. The visitor does
     * the tapping now, so the app layers their facets onto their live search exactly as it would
     * for anyone else. Emptying the bar under them would be the tour interfering with a search it
     * had already handed over.
     */
    const params = new URLSearchParams()
    params.set('q', TOUR_EXAMPLE_QUERY)

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
    const next = () => setIndex((i) => (i === null || i >= steps.length - 1 ? i : i + 1))

    const go = () => {
      if (!alive()) return
      ownsUrl.current = true
      window.dispatchEvent(new CustomEvent('eno:apply-url', { detail: { url: `/?${params.toString()}` } }))
    }


    /**
     * ⛔ ONLY THE SEARCH STEP ACTS. Owner, 2026-08-28: "dont auto run taps make it user do the
     * taps". The tour WRITES — the query types itself, which no one could mistake for their own
     * work — and the visitor TAPS. The four facet steps below schedule nothing at all; they wait,
     * in the effect further down, for the query string to gain the parameter their chip produces.
     */
    /**
     * ⛔ THE FACET WALK STARTS CLEAN, AND MEASUREMENT IS WHY. Leaving the typed query applied while
     * the visitor taps put three surfaces in disagreement: measured on a real build, after tapping
     * Electronics the bar still read "Macbook Pro M5 1TB" while the count showed 7,690 — the
     * category total, with the query silently dropped. That is the explorer's own convention (a
     * plain `?q=` is a raw text search, superseded once facets arrive) and a real visitor doing the
     * same thing would see it too; but the tour is the one that put them there, so it is the tour's
     * job not to demonstrate a contradiction.
     * ⚠️ Reading it as two demonstrations is also the truer story: here is the search box, and here
     * is the other way to find the same thing.
     */
    if (step.id === 'category') {
      window.dispatchEvent(new CustomEvent('eno:search-preview', { detail: { text: '' } }))
      window.dispatchEvent(new CustomEvent('eno:apply-url', { detail: { url: '/' } }))
    }

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
        else later(() => { go(); later(next, SETTLE_MS) }, READ_MS)
      }
      if (prefersReducedMotion()) {
        window.dispatchEvent(new CustomEvent('eno:search-preview', { detail: { text: TOUR_EXAMPLE_QUERY } }))
        later(() => { go(); later(next, SETTLE_MS) }, READ_MS)
      } else {
        later(() => type(1), 450)
      }
    }

    return () => { timers.forEach(clearTimeout) }
    // ⚠️ `index` alone: `step` and `steps` are derived from it, and listing them would re-run the
    // machine — restarting the typing — on every unrelated re-render.
  }, [index])

  /**
   * ⛔ THE FOUR FACET STEPS ADVANCE ON THE VISITOR'S OWN TAP. Polling rather than a click listener
   * is deliberate and was true of the first version of this tour too: the explorer updates the URL
   * with `history.pushState`, which fires no event, and the chip the visitor actually presses may be
   * the copy inside the "More" overflow rather than the one being pointed at. Reading the query
   * string is true however they got there.
   * ⚠️ CHECK IMMEDIATELY, THEN POLL. A visitor can arrive with the parameter already set — a shared
   * filter link, or Back from a listing — and that step is then already satisfied.
   * ⚠️ 250ms is under the threshold where a confirmation feels laggy, and it runs only while one of
   * the four waiting steps is open.
   */
  useEffect(() => {
    if (!step || !isDrillStep(step.id)) return
    const bump = () => setIndex((i) => (i === null ? null : i + 1))
    if (drillDone(step.id, window.location.search)) { bump(); return }
    const t = setInterval(() => { if (drillDone(step.id, window.location.search)) { clearInterval(t); bump() } }, 250)
    return () => clearInterval(t)
  }, [step])

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
   * ⛔ ONE OVERLAY WITH A CLIP-PATH HOLE — AND THE FOUR PANELS IT REPLACES WERE THE SINGLE LARGEST
   * SOURCE OF JITTER ON THE PAGE. The old mask was four `position: fixed` divs whose `top`, `left`,
   * `width` and `height` were rewritten from the frame loop as the target moved. Those are LAYOUT
   * properties, so every frame of every scroll produced layout-shift entries. Measured on
   * production with the Layout Instability API: tapping a brand while the tour was open scored
   * CLS 8.74, and `DIV.fixed material tour-mask` was the source of the three worst shifts; with the
   * tour off the same tap scored 0.03. The owner reported the page as "gittery" and the rails were
   * only part of it — this was most of it.
   *
   * ⚠️ A `clip-path` COSTS NOTHING BECAUSE IT IS PAINT, NOT LAYOUT. The element never moves or
   * resizes; only the shape it paints through changes, so the Layout Instability API has nothing to
   * report. The polygon traces the viewport and cuts in to the hole through a seam on the left edge
   * — the standard single-path keyhole, used rather than `polygon(evenodd, …)` because the fill-rule
   * argument is still not safe at this app's browserslist floor.
   *
   * ⛔ AND IT NO LONGER BLOCKS CLICKS, WHICH IS A REAL CHANGE. The four panels made everything
   * except the target unclickable; one element cannot be transparent to pointers in one region and
   * opaque in another, so this is `pointer-events-none` and stray taps now reach the page. That is
   * the right trade TODAY and would not have been six hours ago: the tour asks the visitor to tap a
   * specific control, and a tap anywhere else is handled — the takeover listener ends the tour and
   * hands back whatever state the tour had borrowed. A swallowed tap would just look broken.
   */
  const anchored = tourAnchorFor(step.id) !== null
  /**
   * ⚠️ HORIZONTALLY TOO, NOT JUST VERTICALLY — and the vertical-only version had teeth. The brand
   * and category rails scroll SIDEWAYS, so a target routinely leaves the viewport left or right
   * while its top and bottom stay perfectly in range. The polygon below would then be traced
   * backwards (`right + PAD` negative, or `left - PAD` past the far edge), the winding stops
   * subtracting, and the result is a full-viewport dim with no hole and no visible target — the
   * exact trap the four-panel version's comment said its guard existed to prevent. A reviewer
   * walked it through.
   */
  const onScreen =
    !!hole &&
    hole.bottom > 0 &&
    hole.top < window.innerHeight &&
    hole.right > 0 &&
    hole.left < window.innerWidth
  /**
   * ⚠️ NO HOLE MEANS NO MASK ON AN ANCHORED STEP, not a full-viewport dim. The rect is read in an
   * effect, so the first paint after a step change has none yet; dimming everything for that frame
   * flashes over the very control the step is about to point at.
   */
  const clip = hole && onScreen ? (() => {
    const l = Math.max(0, hole.left - PAD)
    const r = Math.min(window.innerWidth, hole.right + PAD)
    const t = Math.max(0, hole.top - PAD)
    const btm = Math.min(window.innerHeight, hole.bottom + PAD)
    // ⚠️ BAIL RATHER THAN EMIT A BACKWARDS RECT. Clamping both ends can still cross when the target
    // is only a sliver on screen; a zero-or-negative box traces the hole in reverse and cancels it.
    if (r <= l || btm <= t) return null
    return `polygon(0px 0px, 0px 100%, ${l}px 100%, ${l}px ${t}px, ${r}px ${t}px, ${r}px ${btm}px, ${l}px ${btm}px, ${l}px 100%, 100% 100%, 100% 0px)`
  })() : null

  return (
    <>
      {/* z-[1150]: above the app's chrome (header and neighbours run z-[60] to z-[130]) and below
          the tour's own card, which is raised to z-[1160] on the Positioner. */}
      
      {(clip || !anchored) && (
        <div
          aria-hidden="true"
          /**
           * ⛔ IT BLOCKS ONLY WHEN THERE IS NOTHING TO TAP. One element cannot be transparent to
           * pointers in one region and opaque in another, so the choice is per-step: a step with a
           * hole must let the target through, and the closing step — a full dim with no target —
           * has no such need and should absorb strays. Without that split a tap on a listing card
           * under the final card navigates away from the sign-up the step exists for. A reviewer
           * caught it; the four-panel version blocked everywhere and this is the half worth keeping.
           */
          className={cn('fixed inset-0 z-[1150] material tour-mask', clip && 'pointer-events-none')}
          style={clip ? { clipPath: clip } : undefined}
        />
      )}

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
          /**
           * ⛔ THE CARD FLIPS AWAY FROM THE TARGET. Fixed to `bottom` it opened downward whatever
           * the target's position — and on a phone, where the subcategory panel fills most of the
           * screen, that put the card directly over the chip the step was telling the visitor to
           * tap (owner's screenshot, 2026-08-28). Base UI would flip it on a collision with the
           * viewport EDGE, but the collision here is with the anchor itself, which it has no reason
           * to avoid. Below the target when there is room beneath it, above when there is not.
           */
          side={side}
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
