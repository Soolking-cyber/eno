'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { googleOauthBlocked } from '@/lib/in-app-browser'
import { useAuth } from '@/context/auth-context'
import { scrollBehavior } from '@/lib/reduced-motion'
import {
  drillDone,
  hasSeenTour,
  isDrillStep,
  markTourSeen,
  markTourPending,
  tourPending,
  tourAnchorFor,
  type TourStepId,
} from '@/lib/intro-tour'

/**
 * The first-run tour that starts when the intro/consent card closes.
 *
 * ⛔ NO BACKDROP, AND THIS IS NOT A STYLE CHOICE — READ cookie-consent.tsx BEFORE ADDING ONE. A
 * centred card over a `fixed inset-0` scrim cost THREE Google OAuth verification rejections
 * ("your home page is behind a login page"). A product tour is exactly the shape that tempts a
 * dimming overlay to make the highlighted element pop. The target gets a ring instead — see
 * `data-tour-active` in globals.css — and the page behind stays fully visible and clickable.
 *
 * ⚠️ IT RUNS ONCE, EVER, AND ONLY ON THE HOME PAGE. Both anchors live in the home header and rail;
 * on any other route the tour would point at nothing. A step whose anchor is missing is SKIPPED
 * rather than shown floating, so a layout change shortens the tour instead of breaking it.
 */


/** Padding around the hole, so the ring the tour draws on the target is inside it, not blurred off. */
const PAD = 8

/** Everything the tour needs from one step, resolved per render so copy stays translated. */
type Step = {
  id: TourStepId
  title: string
  body: string
  /** Label for the advance button; the last step's is the sign-up call to action. */
  next: string
}

export function IntroTour() {
  const { tr } = useLanguage()
  const { user } = useAuth()
  const pathname = usePathname()
  const [index, setIndex] = useState<number | null>(null)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  /**
   * The target's live viewport rect, re-read on scroll and resize. The mask is cut around it, so a
   * stale rect would blur the very control the step is asking the reader to press.
   */
  const [hole, setHole] = useState<DOMRect | null>(null)
  const [startedByClick, setStartedByClick] = useState(false)

  /**
   * ⛔ MARKED SEEN AT THE START, NOT AT THE END — "runs once, ever" was false until this. The flag
   * was written only on finish/skip/Esc, so reloading at step 3 brought step 1 back and a visitor
   * who reloads a few times got the tour every single time with no way to stop it. Marking on start
   * spends the one shot the moment it is taken, which is the honest reading of a first-run
   * introduction. The trade: someone who reloads during step 1 loses the rest of it, which is the
   * better failure than a walkthrough that cannot be escaped by leaving.
   * ⚠️ IN THE COMPONENT BODY, NOT INSIDE THE START EFFECT, because two paths now call it: the
   * consent card's event, and the parked-claim redeem keyed on `pathname`. See `byClick` below for
   * why those two must not be treated the same.
   */
  /**
   * ⛔ `byClick` IS BACK, AND REMOVING IT WAS A REAL REGRESSION I INTRODUCED. When the only way in
   * was the consent card's button, focus had just been destroyed with the control that was clicked,
   * so moving it into the tour card was the correct thing rather than a theft — and the flag looked
   * dead. Parking the claim brought the other case back: the redeem path fires on a NAVIGATION to
   * `/`, nobody has clicked anything, and pulling focus there can take the keyboard from someone
   * already typing in the very search box step 1 points at (and close the suggestions panel its
   * `onFocus` opened). A reviewer caught that the two changes interact. Keyboard reachability is
   * preserved on the path that has it: started by click, the card takes focus; arrived at by
   * navigation, it is left alone and the card stays reachable by Tab.
   */
  const begin = useCallback((byClick: boolean) => {
    markTourSeen()
    setStartedByClick(byClick)
    setIndex(0)
  }, [])

  /**
   * ⛔ THE UNANCHORED STEPS GET A VIRTUAL ANCHOR AT THE VIEWPORT CENTRE, and the first version's
   * comment claimed they were centred when they were not. Passing `anchor={undefined}` does not
   * centre anything — with no trigger to fall back on, the positioner simply KEEPS THE LAST
   * ANCHOR'S PLACEMENT. Measured: steps 3 and 4 rendered at the coordinates the category rail had
   * left behind (464, 534) rather than centred. Not offscreen, so it looked fine and was wrong for
   * a reason nobody would find later — and it drifts the moment the previous anchor scrolls away.
   * A virtual element is Base UI's documented way to position against a point rather than a node.
   */
  const centreAnchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0),
    }),
    [],
  )

  const allSteps: Step[] = useMemo(
    () => [
      {
        id: 'search',
        title: tr('Start by searching', 'Bắt đầu bằng tìm kiếm'),
        body: tr(
          'Type anything here — a model, a brand, or a few words in English or Vietnamese. Both languages find the same listings.',
          'Nhập bất cứ điều gì — mẫu máy, thương hiệu, hoặc vài từ bằng tiếng Việt hay tiếng Anh. Cả hai ngôn ngữ đều ra cùng kết quả.',
        ),
        next: tr('Next', 'Tiếp'),
      },
      /**
       * ⛔ FOUR STEPS THE VISITOR CLICKS THEMSELVES. Owner: "let them experience how to find". Each
       * of these has NO next button — the tour waits for the real control to be used and moves on
       * when the query string says it happened. The copy is an instruction, not a description.
       */
      {
        id: 'category',
        title: tr('Now narrow it down', 'Giờ thu hẹp lại'),
        body: tr('Tap Electronics in the row below.', 'Chạm vào Điện tử ở hàng bên dưới.'),
        next: '',
      },
      {
        id: 'subcategory',
        title: tr('Pick what kind', 'Chọn loại nào'),
        body: tr('Electronics is broad. Tap “Cases & covers”.', 'Điện tử rất rộng. Chạm vào “Ốp lưng & bao da”.'),
        next: '',
      },
      {
        id: 'brand',
        title: tr('Then the brand', 'Rồi đến thương hiệu'),
        body: tr('Tap Apple.', 'Chạm vào Apple.'),
        next: '',
      },
      {
        id: 'model',
        title: tr('And the exact model', 'Và đúng mẫu máy'),
        body: tr('Tap iPhone 17 Pro Max.', 'Chạm vào iPhone 17 Pro Max.'),
        next: '',
      },
      {
        id: 'result',
        title: tr('That is how you find one thing', 'Đó là cách tìm đúng một thứ'),
        body: tr(
          'Four taps from everything to cases that fit one exact phone. The same four work for a laptop, a scooter or an apartment.',
          'Bốn lần chạm từ tất cả đến ốp lưng vừa đúng một mẫu máy. Bốn bước đó cũng dùng cho laptop, xe máy hay căn hộ.',
        ),
        next: tr('Last thing', 'Điều cuối'),
      },
      {
        id: 'signup',
        title: tr('Save what you find', 'Lưu lại những gì bạn thích'),
        body: tr(
          'Sign up to save listings, message sellers and get told when a price drops. It takes one tap with Google.',
          'Đăng ký để lưu tin, nhắn tin với người bán và nhận báo khi giá giảm. Chỉ một chạm với Google.',
        ),
        next: tr('Continue with Google', 'Tiếp tục với Google'),
      },
    ],
    [tr],
  )

  /**
   * ⛔ THE SIGN-UP STEP IS DROPPED FOR ANYONE ALREADY SIGNED IN. A signed-in visitor can still
   * reach the tour — answering the cookie card is not proof of being new, since the card also
   * appears for a member who has cleared site data — and showing them "Sign up to save listings…
   * one tap with Google" would be a real misfire rather than a cosmetic one: the button hard-
   * navigates to /auth/google/start, which for an account created with an email link is an
   * identity-LINKING round trip, not a no-op. A reviewer caught it.
   */
  const steps = useMemo(() => (user ? allSteps.filter((s) => s.id !== 'signup') : allSteps), [user, allSteps])

  /**
   * ⚠️ CLAMPED, BECAUSE `steps` CAN SHRINK UNDER THE INDEX. `useAuth()` resolves the session from
   * /api/me after mount, so a visitor who reaches the last step as a guest and is then recognised
   * has `signup` filtered away beneath them — `steps[3]` becomes undefined and the popover would
   * simply vanish mid-sentence. A reviewer spotted the race. Ending deliberately is the same
   * outcome the visitor wanted (they are signed in; the last step was the sign-up pitch) and it
   * goes through the normal close rather than a blank frame.
   */
  const step = index === null ? null : (steps[index] ?? null)

  useEffect(() => {
    if (index !== null && index >= steps.length) finishRef.current()
  }, [index, steps.length])

  // ⚠️ A ref so the clamp effect above can call the latest `finish` without listing it as a
  // dependency and re-running on every render.
  const finishRef = useRef<() => void>(() => {})

  const finish = useCallback(() => {
    markTourSeen()
    setIndex(null)
    setAnchorEl(null)
  }, [])
  finishRef.current = finish

  // ── start: the intro card fires this when it closes, whatever the visitor chose ────────────────
  // ⚠️ ON EITHER CHOICE. Starting the tour only after "Allow" would make the tour a reward for
  // consenting, which is exactly the nudge PDPL/GDPR call out — consent has to be freely given, so
  // it cannot buy a better product experience.
  useEffect(() => {
    /**
     * ⛔ THE HOME PAGE IS THE ONLY PLACE IT CAN RUN, AND THAT USED TO COST THE TOUR ENTIRELY.
     * `CookieConsent` is global and fires this event wherever the visitor happens to be, while the
     * tour's anchors are the header search box and the category rail. The first version simply
     * returned off-home — and its comment claimed the flag stayed unmarked "so it runs on their
     * next visit to `/`", which was never true: consent is stored by then, the card never reopens,
     * and nothing else fires the event. Anyone whose first page was a shared listing link or a
     * search result lost the tour permanently. It is parked now; see `markTourPending`.
     */
    const start = () => {
      if (hasSeenTour()) return
      if (window.location.pathname === '/') begin(true)
      else markTourPending()
    }
    window.addEventListener('eno:start-tour', start)
    /**
     * ⛔ THE CONSENT CARD IS THE ONLY THING THAT STARTS THIS — owner, 2026-08-28: "onboarding tour
     * should fire only once when user passes through cookie screen not every time page reloads".
     * There WAS a second path here that also began the tour on mount for anyone who already had
     * consent stored and no tour flag. It existed to reach visitors who had answered the card
     * before the tour shipped, and it is what made the tour able to appear on a load nobody asked
     * for: any state where the flag failed to stick — private mode, cleared site data, storage
     * denied — turned every home-page visit into a fresh tour, with the card nowhere in sight to
     * explain why. Tying the tour to the one event that fires exactly once makes "only once" a
     * property of WHEN it starts rather than a promise the flag has to keep.
     * ⚠️ THE TRADE, STATED: someone who dismissed the cookie card before the tour existed will
     * never see the tour. That is the owner's call and the right one — a walkthrough is worth
     * having on your first minute and is an interruption on your fiftieth.
     * ⚠️ `markTourSeen()` on `begin` still matters, and the cookie mirror behind it more so: it is
     * what stops a reload MID-TOUR from restarting at step 1.
     */
    return () => window.removeEventListener('eno:start-tour', start)
  }, [])

  /**
   * ⛔ AND THE PARKED CLAIM IS REDEEMED WHENEVER THE VISITOR REACHES `/` — KEYED ON `pathname`, NOT
   * ON MOUNT. This started life inside the effect above, and a reviewer caught what that costs: the
   * app is a SPA and this component's layout does not unmount, so tapping the header logo to go
   * home changes the URL and runs no mount effect at all. The claim would sit unredeemed until a
   * hard reload — precisely the wrong visitor to ask that of, since they arrived on a shared
   * listing link and are navigating, not reloading. Reading `window.location.pathname` once was the
   * tell: a value read imperatively at mount cannot see a route change.
   * ⚠️ STILL A ONE-SHOT, which is the whole constraint. `markTourSeen()` writes `done` before the
   * tour opens, so `tourPending()` is false on every later run of this effect and on every later
   * navigation. Nothing here can replay it.
   */
  useEffect(() => {
    if (pathname === '/' && tourPending() && !hasSeenTour()) begin(false)
  }, [pathname])

  /**
   * ⚠️ RESOLVE THE ANCHOR AFTER PAINT, AND RE-RESOLVE ON EVERY STEP. The header and rail mount with
   * the page, but the rail in particular fills in after its fetch, so querying once at start would
   * miss it. A step whose element is absent is skipped rather than rendered unanchored.
   */
  useEffect(() => {
    if (!step) return
    const selector = tourAnchorFor(step.id)
    if (!selector) { setAnchorEl(null); return }
    /**
     * ⚠️ RETRY BEFORE GIVING UP. The rail fills in after its own fetch, so a single query at the
     * moment the step opens loses the race on a slow first load and silently skips step 2 — the
     * comment above named that race and the first version did not actually handle it (reviewer's
     * catch). Ten frames at 100ms is a second of patience, invisible when the element is already
     * there and enough for a rail that is still loading.
     */
    let tries = 0
    let el = document.querySelector<HTMLElement>(selector)
    const attach = (found: HTMLElement) => {
      setAnchorEl(found)
      found.setAttribute('data-tour-active', '')
      found.scrollIntoView({ block: 'center', behavior: scrollBehavior() })
    }
    if (!el) {
      // ⚠️ REMEMBER THE NODE WE MARKED. The cleanup used to re-query the selector, so if the rail
      // remounted — the very reason this poll exists — the ring was stripped from whichever element
      // matched second and left burning on the first. Reviewer's catch.
      let marked: HTMLElement | null = null
      const poll = setInterval(() => {
        el = document.querySelector<HTMLElement>(selector)
        if (el) { clearInterval(poll); marked = el; attach(el) }
        else if (++tries >= 10) {
          clearInterval(poll)
          /**
           * Out of patience: move on rather than point at nothing.
           * ⚠️ THE SIDE EFFECT IS OUTSIDE THE UPDATER. `setIndex(i => (…, markTourSeen(), …))` reads
           * naturally and is wrong: React double-invokes updaters under StrictMode, so the write
           * would run twice — harmless here, but the habit is how a real double-submit gets shipped.
           * A reviewer flagged it; `finish()` already does both things in the right order.
           */
          // ⚠️ Only the first two steps are anchored, so a poll timeout can never be the LAST step
          // — an earlier version carried a `markTourSeen()` here for that case, which could not
          // fire and duplicated what `finish()` already does. A reviewer called it dead; it is.
          setIndex((i) => (i === null ? null : i + 1))
        }
      }, 100)
      return () => { clearInterval(poll); marked?.removeAttribute('data-tour-active') }
    }
    setAnchorEl(el)
    // ⚠️ Bring it into view before pointing at it — the rail sits below the fold on a phone.
    // ⚠️ `scrollBehavior()`, NOT a literal 'smooth': an explicit behavior in the options bag
    // outranks the `scroll-behavior: auto !important` kill switch in globals.css, so the literal
    // would ignore prefers-reduced-motion while looking as though it respected it. design-lint
    // caught exactly that here.
    attach(el)
    const settled = el
    return () => settled.removeAttribute('data-tour-active')
  }, [step, steps.length])

  /**
   * ⛔ THE MASK'S HOLE HAS TO TRACK THE TARGET, NOT A REMEMBERED RECTANGLE. The rail scrolls, the
   * page scrolls, phones rotate — a hole measured once drifts off the control and ends up blurring
   * and blocking the thing the step just told the reader to tap. `scroll` is captured so it also
   * fires for the RAIL's own scroller, not just the window.
   */
  useEffect(() => {
    setHole(null)
    if (!anchorEl) return
    /**
     * ⛔ A FRAME LOOP, NOT SCROLL LISTENERS — and the listener version shipped a visible bug.
     * `attach()` calls `scrollIntoView` on the target, so the element is still MOVING when the hole
     * is first measured. Listening for `scroll` (even captured, so the rail's own scroller counts)
     * did not converge: measured on step 3, the hole was cut at the chip's pre-scroll position
     * (left ≈ 324) while the chip had settled at 119, so the mask covered the very control the step
     * was telling the reader to tap — reported as clickable in one probe and BLOCKED in another,
     * which is exactly what a race looks like from the outside.
     * ⚠️ A loop is immune to WHY the rect moved: smooth scrolling, a late image, a rotation, the
     * rail re-rendering. It reads one `getBoundingClientRect` per frame while a step is open and
     * calls `setHole` ONLY when the numbers actually change, so a settled target costs one cheap
     * read per frame and no renders at all.
     */
    let raf = 0
    let last = ''
    /**
     * ⛔ AND IT KEEPS THE TARGET IN VIEW, BECAUSE SCROLLING TO IT ONCE IS NOT ENOUGH. `attach()`
     * scrolls the anchor into view the moment it resolves — and then the page keeps moving under
     * it. The rail's images and counts arrive after the scroll, the explorer swaps placeholder
     * cards for real ones, a font settles: each one shifts the control the step is pointing at,
     * and on a phone that is the difference between "tap Electronics" landing on the chip and
     * landing on nothing. Reported by the owner as the tour not scrolling to the button at all.
     * The frame loop already knows where the target IS; this makes it act on that.
     *
     * ⚠️ TWO GUARDS, BECAUSE AN AUTO-SCROLL THAT FIGHTS THE READER IS WORSE THAN NO AUTO-SCROLL.
     *   · IT STOPS AT THE FIRST REAL GESTURE. `touchstart`/`wheel`/`keydown`/`pointerdown` are
     *     user intent and
     *     are never produced by programmatic scrolling, so they cleanly separate "the page moved
     *     under us" from "they are looking around" — a plain `scroll` listener cannot, because our
     *     own smooth scroll fires those too, which is how this kind of fix becomes a scroll fight.
     *     ⚠️ `pointerdown` is in the list for the DESKTOP scrollbar drag, which a reviewer spotted
     *     produces none of the other three. It also fires when the visitor taps the target itself,
     *     which is the right outcome — they have found it, so there is nothing left to correct.
     *   · IT IS A WINDOW, NOT A LEASH. Corrections stop after CORRECT_MS whatever happens, so the
     *     worst case is a couple of seconds of settling and never a page that refuses to be
     *     scrolled away from.
     * ⚠️ AND IT GIVES UP IF IT IS NOT WORKING: a target that cannot reach the band — a short page,
     * an element taller than the gap between the header and the card — would otherwise re-scroll
     * on every tick to no effect. If a correction does not move the page, that was the last one.
     */
    const CORRECT_MS = 2500
    const CORRECT_GAP = 400
    let correctUntil = performance.now() + CORRECT_MS
    let lastCorrection = 0
    let scrollAtCorrection = -1
    const stopCorrecting = () => { correctUntil = 0 }
    /**
     * ⛔ A TARGET INSIDE THE FIXED HEADER IS NEVER OUT OF VIEW, AND CORRECTING IT IS ALL COST. The
     * band test asks whether the target sits below the header's bottom edge — which is false BY
     * CONSTRUCTION for the header's own search box, step 1's anchor. So the loop would read "out of
     * view" on a control that is permanently visible and scroll the page trying to fix it. A
     * reviewer caught it. The give-up check happens to contain the damage (the first correction
     * moves nothing when the page is already at the top, so the second stops), but "saved by an
     * unrelated guard" is not the same as correct: from a scrolled position it would yank the page
     * to the top for no reason at all.
     */
    if (anchorEl.closest('#app-header')) correctUntil = 0
    window.addEventListener('touchstart', stopCorrecting, { passive: true })
    window.addEventListener('wheel', stopCorrecting, { passive: true })
    window.addEventListener('keydown', stopCorrecting)
    window.addEventListener('pointerdown', stopCorrecting, { passive: true })

    const tick = () => {
      const r = anchorEl.getBoundingClientRect()
      const key = `${r.top}|${r.left}|${r.width}|${r.height}`
      if (key !== last) { last = key; setHole(r) }
      const now = performance.now()
      if (now < correctUntil && now - lastCorrection > CORRECT_GAP) {
        // ⚠️ The header is FIXED and overlaps the top of the page, so "visible" is not `top >= 0`
        // — a chip tucked under the header is on screen and untappable. Measured live rather than
        // hardcoded: the header has three geometries and picks one by scroll position.
        const headerBottom = document.getElementById('app-header')?.getBoundingClientRect().bottom ?? 0
        // ⚠️ The lower bound leaves room for the tour card, which opens BELOW the target, and for
        // the bottom nav. It only has to be good enough to DETECT a bad position; `block: 'center'`
        // is what actually chooses where the target lands.
        const safeBottom = window.innerHeight * 0.62
        if (r.top < headerBottom + PAD || r.bottom > safeBottom) {
          if (scrollAtCorrection === Math.round(window.scrollY)) correctUntil = 0
          else {
            lastCorrection = now
            scrollAtCorrection = Math.round(window.scrollY)
            anchorEl.scrollIntoView({ block: 'center', behavior: scrollBehavior() })
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('touchstart', stopCorrecting)
      window.removeEventListener('wheel', stopCorrecting)
      window.removeEventListener('keydown', stopCorrecting)
      window.removeEventListener('pointerdown', stopCorrecting)
    }
  }, [anchorEl])

  /**
   * ⛔ THE TOUR ENDS IF THE VISITOR LEAVES THE HOME PAGE — except for the navigation IT performs.
   * Without this, tapping a listing card mid-tour leaves a popover pointing at an element that no
   * longer exists on the new route. The example step navigates within `/`, so the pathname does not
   * change and this does not fire for it.
   */
  useEffect(() => {
    if (index !== null && pathname !== '/') finish()
  }, [pathname, index, finish])

  /**
   * ⛔ THE DRILL STEPS ADVANCE ON THE VISITOR'S CLICK, NOT ON A BUTTON. Each one names a control and
   * waits for the query string to gain the parameter that using it produces. Polling rather than a
   * listener is deliberate: the explorer updates the URL with `history.pushState`, which fires no
   * event, and the chip the visitor actually taps may be the copy inside the "More" overflow rather
   * than the one being pointed at. Reading the URL is true however they got there.
   * ⚠️ 250ms is under the threshold where a confirmation feels laggy and costs nothing — it runs
   * only while a drill step is open.
   */
  useEffect(() => {
    // ⚠️ ONLY THE WAITING STEPS POLL. The first version's guard read `!drillDone(step.id, '?')`,
    // which is false for every step — so a 250ms interval also spun on the three steps that have a
    // button and could never satisfy it. It did no harm and read as if it meant something, which is
    // worse. `isDrillStep` says the thing out loud.
    if (!step || !isDrillStep(step.id)) return
    // ⚠️ CHECK IMMEDIATELY, THEN POLL. A visitor can arrive with the parameter already set — a
    // shared filter link, or Back from a listing — and that step is then already satisfied.
    if (drillDone(step.id, window.location.search)) { setIndex((i) => (i === null ? null : i + 1)); return }
    const t = setInterval(() => {
      if (drillDone(step.id, window.location.search)) {
        clearInterval(t)
        setIndex((i) => (i === null ? null : i + 1))
      }
    }, 250)
    return () => clearInterval(t)
  }, [step])

  // Esc leaves at any point, and leaving counts as seen — nobody wants it again tomorrow.
  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, finish])

  if (!step) return null

  const isLast = step.id === 'signup'

  const advance = () => {
    if (isLast) {
      // ⚠️ REUSE THE EXISTING GUARD RATHER THAN THE RAW ROUTE. `/auth/google/start` is fine in a
      // normal browser and dead inside an in-app browser (Facebook/Zalo webviews), which is what
      // `googleOauthBlocked()` detects — the same check sign-in-form.tsx makes. When it is blocked
      // the visitor goes to /signin, which owns the whole fallback story (system browser hand-off,
      // native deep links, first-party fallback). Duplicating that here would be a bug factory.
      const href = googleOauthBlocked() ? '/signin?next=%2F' : '/auth/google/start?next=%2F'
      markTourSeen()
      window.location.href = href
      return
    }
    setIndex((i) => (i === null ? null : i + 1))
  }

  /**
   * ⛔ FOUR PANELS AROUND THE TARGET, NOT ONE OVERLAY WITH A CSS HOLE. The mask has two jobs —
   * blur everything that is not the subject, and make everything that is not the subject
   * unclickable — and four rectangles do both for free: the gap between them is not covered by
   * anything, so the control underneath keeps its own sharpness AND its own clicks with no
   * `pointer-events` juggling. A single overlay with a `clip-path` hole would still swallow the
   * press, which is exactly what the guided steps need the reader to be able to make.
   * ⚠️ 8px of padding so the ring around the target is inside the hole rather than blurred off.
   * ⚠️ On the two centred steps there is no target, so one full-viewport panel covers everything —
   * nothing to press but the card.
   * ⛔ `backdrop-blur-md` matches the app's other floating chrome (`sticky-action-bar`), and the
   * `material` marker is what `.reduce-transparency` keys off: a reader who asks for less
   * transparency gets a solid scrim instead of a blur, which is the platform contract, not a
   * nicety. Blur is not motion, so `prefers-reduced-motion` deliberately does not touch it.
   */
  /**
   * ⛔ THE TINT AND THE BLUR LIVE IN `.tour-mask` IN globals.css, NOT IN UTILITIES HERE, and that
   * is a fix rather than a preference. As `bg-black/40 material backdrop-blur-md` these panels
   * were also matched by the two blocks that force `.material.bg-black\/40` to `#000` — measured
   * on an iPhone viewport with `prefers-contrast: more`, every panel came back `rgb(0, 0, 0)`
   * with the blur stripped, so four opaque rectangles around a small hole turned the whole page
   * black. That is right for a floating bar with text on it and wrong for a mask, whose only job
   * is to keep the page visible-but-demoted; the CSS file explains the split at length.
   * ⚠️ `material` STAYS. It is still a translucent surface and must still declare itself — the
   * marker is what `.reduce-transparency` keys off, and design-lint requires it beside a blur.
   * Only the two values moved.
   */
  const panel = 'fixed material tour-mask'
  /**
   * ⚠️ THE SIDE PANELS ARE CLAMPED TO THE VISIBLE PART OF THE HOLE, and the unclamped version had
   * a real artefact. When the target is scrolled partly above the fold, `hole.top` goes negative:
   * the sides then started at 0 but kept the full height, so they ran past where the bottom panel
   * begins and two `bg-black/40` layers with two blurs stacked into a visibly darker band beside
   * and under the highlighted control. Deriving top and bottom from the clamped edges keeps every
   * panel edge-to-edge with its neighbour and never overlapping.
   */
  /**
   * ⛔ AN ANCHORED STEP WITH NO MEASURED HOLE DRAWS NO MASK AT ALL — this is the fix for a real
   * one-frame bug, not caution. The rect is read in an effect, so the first paint after a step
   * change has no hole yet; falling back to the full-viewport panel there covered the very control
   * the new step was about to point at, and a fast tap in that window landed on a handler-less
   * blurred div and made the tour look dead. Showing nothing for one frame is invisible; showing
   * the wrong thing is a dead tap. The full panel is only for the steps that genuinely have no
   * target — `result` and `signup` — where covering everything is the intent.
   */
  const anchored = tourAnchorFor(step.id) !== null
  /**
   * ⛔ NO MASK WHILE THE TARGET IS OFF SCREEN, OR THE READER IS TRAPPED. Scroll the anchor past
   * either edge and the clamped geometry collapses the hole to nothing: one panel ends up covering
   * the whole viewport, so the page is blurred, every click is swallowed, and the thing the step
   * points at is nowhere to be seen. A reviewer walked that through. Dropping the mask hands the
   * page straight back — and it returns by itself the moment the target scrolls into view again,
   * because the frame loop above is still measuring.
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
      {/* ⚠️ z-[1150]: above the app's chrome (header and its neighbours run z-[60] to z-[130]) and
          below the tour's own popover, which is raised to z-[1160] on the Positioner. Both numbers
          exist because a mask that sits under the header would leave the header clickable — the one
          thing this is here to prevent. */}
      {mask.map(({ key, style }) => (
        <div key={key} aria-hidden="true" className={`${panel} z-[1150]`} style={style} />
      ))}
    {/*
     * ⛔ THE OUTSIDE PRESS MUST NOT CLOSE THIS, AND IT DID — the whole guided drill-down died on the
     * first click. Base UI's non-modal Popover dismisses on any press outside the popup, and every
     * drill step asks the visitor to press exactly such a control: tapping "Electronics" both
     * advanced the filter AND closed the tour, so the walkthrough vanished at the moment it started
     * working. Measured — the URL walked all four levels while the popover was already gone.
     * ⚠️ So closing is OURS alone: Skip, the final buttons, Esc (a keydown listener above) and
     * leaving the home page. `onOpenChange` is deliberately inert rather than removed, so nobody
     * re-adds a `finish()` here without reading this.
     */}
    <Popover open onOpenChange={() => { /* see above — never close on outside press */ }}>
      <PopoverContent
        // `anchor` positions against a real element rather than a trigger; null centres the card.
        anchor={anchorEl ?? centreAnchor}
        // Anchored steps sit under their target; the centred ones open downward from the midpoint,
        // which reads as a card in the middle of the screen rather than a bubble pointing nowhere.
        side="bottom"
        sideOffset={10}
        collisionPadding={12}
        positionerClassName="z-[1160]"
        // ⛔ NO `backdrop` — see the note at the top of this file. Three OAuth rejections.
        className="w-[min(22rem,calc(100vw-1.5rem))] gap-2"
        // See the note on `begin`: focus follows a click, never a passive arrival.
        initialFocus={startedByClick ? undefined : false}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs font-semibold uppercase tracking-wide text-ink-4">
            {tr('Quick tour', 'Hướng dẫn nhanh')} · {(index ?? 0) + 1}/{steps.length}
          </p>
          <Button variant="bare" size="none" onClick={finish} className="text-2xs font-semibold text-ink-4 hover:text-foreground cursor-pointer">
            {tr('Skip', 'Bỏ qua')}
          </Button>
        </div>
        <p className="text-sm font-bold leading-tight text-foreground">{step.title}</p>
        <p className="text-2xs leading-snug text-muted-foreground">{step.body}</p>
        <div className="mt-0.5 flex items-center gap-1.5">
          {/* ⚠️ NO BUTTON ON A WAITING STEP. An empty `next` means the tour is waiting for the
              visitor to use the control it is pointing at — offering a "Next" there would let them
              skip the very thing the step exists to teach, and the owner's ask was that they
              actually do it. The step still ends via Skip or Esc. */}
          {step.next ? (
            <Button variant="cta" size="none" onClick={advance} className="rounded-lg px-3 py-1.5 text-sm cursor-pointer">
              {step.next}
            </Button>
          ) : (
            <p className="text-2xs font-semibold text-accent-foreground">{tr('Waiting for your tap…', 'Đang chờ bạn chạm…')}</p>
          )}
          {isLast && (
            <Button variant="ghost" size="none" onClick={finish} className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-body hover:bg-muted cursor-pointer">
              {tr('Maybe later', 'Để sau')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
    </>
  )
}
