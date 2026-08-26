'use client'

import { useEffect, useState, useRef, memo } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Heart, Building2, MapPin, MessageCircle, Tag, Play, ArrowRight } from '@/components/ui/icons'
import { OwnerEditButton } from '@/components/marketplace/owner-edit-button'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Tooltip } from '@/components/ui/tooltip'
import { PartnerBadge } from './partner-badge'
import { TrustScore } from './trust-score'
import { CardBadges } from './card-badges'
import Image from 'next/image'
import type { SerializedListingCard } from '@/lib/types'
import { Price } from './price'
import { isBookingCategory } from '@/lib/affiliate-kind'
import { formatMoneyFull, moneyLocale, dropPercent } from '@/lib/vnd'
import { CategoryIcon } from './category-icons'
import { cardSlots, isSwipe } from '@/lib/card-slots'
import { isMockImageUrl } from '@/lib/listing-image'
import { cn } from '@/lib/utils'
import { useLanguage, useTr } from '@/context/language-context'
// PostedAgo (not a bare timeAgo() call) so the card's relative time is the SAME string the PDP
// prints — it derives its label from useLanguage at render time, which is the repo's existing
// answer to relative time on a cached page (the PDP renders it inside the ISR'd listing route,
// and drop-countdown.tsx follows it). Client-time derivation means the label is computed at
// RENDER time, and the home route is ISR-cached for 6h with 12 cards baked into its HTML — so a
// card can ship "1h ago" in that HTML and hydrate to "7h ago". MEASURED on that baked HTML: the
// "New" badge above is already computed from Date.now() against a 48h window and is already baked
// 26× into it, so the CLASS of mismatch is not new — ⚠️ but be honest about frequency, because a
// reviewer was right to push on it: the badge only flips across one 48h boundary, while an
// hours-granularity label crosses a bucket on most cards of a 6h-old page. React recovers (the
// client value wins, which is the correct one) at the cost of re-rendering that subtree. Closing
// it properly means gating on mount, or the <LiveUntil> treatment the PDP already uses for its
// own Date.now()-derived claims — inside listing-content.tsx, which is a deliberate piece of work
// and not a line in this import.
import { useLocalized, PostedAgo } from './listing-content'
import { useFavorites } from '@/context/favorites-context'
import { useAuth } from '@/context/auth-context'
import { useMounted } from '@/hooks/use-mounted'
// Perf Phase 1: both are OPTIONAL card features — the video enhancement mounts only
// on in-viewport video cards, the discount slider only inside the owner's popover —
// so neither belongs in the default card path every page pays for.
const CardVideo = dynamic(() => import('./card-video').then((m) => m.CardVideo), { ssr: false })
const Slider = dynamic(() => import('@/components/ui/slider').then((m) => m.Slider), { ssr: false })

import { stashQuickCompose } from '@/lib/quick-contact'

// Tiny neutral blur (matches the card's bg) so images fade in instead of popping
// from a grey box. Shared across all cards.
const BLUR =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjYiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjYiIGZpbGw9IiNlZWYyZjYiLz48L3N2Zz4='

// Brand slug → label ("louis-vuitton" → "Louis Vuitton") for the card's brand line.
function prettyBrand(slug: string): string {
  return slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
}

/** Grace period before a hover-expanded card releases its extra slides (see `expanded`).
 *
 *  ⚠️ THIS DEFERS THE UNMOUNT; IT DOES NOT DEFER THE MOUNT. An earlier version of this comment
 *  claimed a graze "does not pay a mount/decode cycle" — untrue, and opus was right to call it:
 *  `onMouseEnter` expands synchronously with no dwell threshold, so brushing a card still mounts
 *  its extra slides and then holds them 400ms longer. What the window actually buys is the
 *  RE-entry case (clipping a corner, crossing one card to reach the next) not remounting.
 *
 *  Left as-is deliberately, because the direction of travel is what matters: before this change
 *  the same mouseenter mounted ALL of a listing's photos — a 12-photo card mounted twelve — and
 *  nothing ever released them, because `setExpanded(false)` did not exist. A graze now costs
 *  three lazy images and gets them back. A dwell timer would cut the graze cost to zero, but it
 *  would also mean a fast sweep arrives at slot 2 before slot 2 exists, and a blank slot under
 *  the pointer is a worse bug than a speculative fetch. */
const COLLAPSE_MS = 400

type Props = {
  listing: SerializedListingCard
  onOpen: (listing: SerializedListingCard) => void
  priority?: boolean
  // The single LCP card (first card of the first landing row): use next/image's
  // real `priority` so Next emits a <link rel=preload> for its image.
  lcp?: boolean
  // Accurate per-context sizing so the browser downloads card-sized images, not
  // full-width. Default = the result grid (2/3/4 cols); CardRow passes fixed px.
  sizes?: string
  // When set, a "locate on map" pin shows at the image bottom-right (mirrors the
  // heart) → jump to the map focused on this listing. Receives the listing so the
  // parent can pass ONE stable callback (keeps React.memo effective); `() => void`
  // callers stay compatible (they just ignore the arg).
  onLocate?: (listing: SerializedListingCard) => void
}

function ListingCardImpl({
  listing,
  onOpen,
  priority = false,
  lcp = false,
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw',
  onLocate,
}: Props) {
  const { lang, t, tr } = useLanguage()
  const images = listing.images
  const displayTitle = useLocalized(listing.title, listing.titleVi, listing.titleI18n)
  const displayLocation = useTr(listing.location)
  // Condition badge text for the metadata line. new/used are the canonical facet values
  // (verified in prod); an unexpected value is shown verbatim rather than dropped.
  const conditionLabel = listing.condition === 'new' ? tr('New', 'Mới')
    : listing.condition === 'used' ? tr('Used', 'Đã dùng')
    : listing.condition || null
  const { isFavorite, toggle, savedDelta } = useFavorites()
  const favorited = isFavorite(listing.id)
  // Base savedCount (real, server-side) + this session's own toggle, floored at 0.
  const savedTotal = Math.max(0, listing.savedCount + savedDelta(listing.id))
  // One-shot heart-burst: set ONLY when the user saves (not on unsave, and not
  // when favorites hydrate from storage on load). Cleared when the CSS animation
  // ends so a later save replays it.
  const [burst, setBurst] = useState(false)
  // Desktop quick-offer (hover bar): slide a discount, hand off to the PDP composer
  // in offer mode via ?offer=N#contact. null = collapsed.
  const [quickOffer, setQuickOffer] = useState<number | null>(null)
  const router = useRouter()
  const { user, loading: authLoading, openSignIn } = useAuth()
  // Gates the meta row's relative time — see the comment at its render site for why this route
  // in particular cannot afford an ungated client-clock value.
  const mounted = useMounted()

  // Quick actions land IN the conversation: stash the structured compose payload
  // and let /messages/pending create the thread + post it (same flow as the PDP
  // composer). Guests get the sign-in dialog with listing context.
  const quickGo = (opts: { body?: string; offerAmount?: number | null }) => {
    if (!user) { if (!authLoading) openSignIn({ listingTitle: displayTitle, listingImage: images[0] ?? null }); return }
    if (stashQuickCompose(listing, opts)) router.push('/messages/pending')
    else router.push(`/listings/${listing.id}#contact`)
  }
  // "Locate on map" is a default on every card (see card/feed standards). When a
  // parent that owns the map is on-screen (the explorer, its home rails) it passes
  // onLocate for an in-page focus; everywhere else (PDP related/recently-viewed,
  // AI results) we deep-link to the home map focused on this listing via ?focus=.
  const locate = onLocate ?? ((l: SerializedListingCard) => router.push(`/?focus=${l.id}`))
  // Video-on-card: <CardVideo> autoplays the clip (muted, looping, cover-first fade-in) once
  // the card settles in the viewport — mobile finally sees video without hover. The hover
  // flag just makes desktop start INSTANTLY instead of waiting for the settle beat.
  const [hoverVideo, setHoverVideo] = useState(false)
  const [idx, setIdx] = useState(0)
  // Only the first image is in the DOM until the user engages the carousel
  // (hover/touch) — cuts initial DOM nodes + image bytes on the homepage grid.
  const [expanded, setExpanded] = useState(false)
  // True while the CURRENT slide was chosen by hovering rather than by swiping. Hover is
  // transient — the pointer leaves and the card must go back to its cover — but a touch swipe is
  // a deliberate, sticky choice. Without this flag a hybrid device (a touchscreen laptop) would
  // snap back to photo 1 the moment the mouse happened to leave, undoing a swipe the finger made.
  const hoverNav = useRef(false)
  // Deferred release of the hover-mounted slides. ⚠️ This is NOT a debounce on the visual —
  // `idx` resets instantly on mouse-out. It only delays UNMOUNTING, so a pointer that grazes a
  // card on its way somewhere else does not pay a mount/decode cycle. (Codex raised the
  // unbounded case at plan time: without it, one sweep across a 48-card grid leaves every card
  // holding its extra slides for the life of the page.)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (collapseTimer.current) clearTimeout(collapseTimer.current) }, [])
  // A live mirror of `idx` for the collapse timer to read when it FIRES, 400ms after the handler
  // that scheduled it closed over its own value. Codex argued a hybrid-device ordering — touchend
  // changes idx, a mouse-leave whose closure still sees idx === 0 schedules the release, and the
  // slides are unmounted while the strip is translated to -200%, i.e. a blank card. React flushes
  // discrete updates (touchend is one) before dispatching the next event, so I could not make it
  // happen; this makes the argument moot rather than winning it. The release decision belongs at
  // fire time regardless — nothing about "should this collapse?" is knowable 400ms in advance.
  const idxRef = useRef(0)
  idxRef.current = idx
  // Image-failure recovery. All FIRST slides on a feed fetch simultaneously on page
  // load (later slides lazy-load), and the mock host (picsum) rate-limits under that
  // burst — a single onError used to placeholder the slide for the whole session even
  // though a retry succeeds. Now: first failure → placeholder + ONE delayed retry
  // (key bump remounts the <Image> → fresh fetch); a second failure → placeholder for
  // good (genuinely dead URL). Timers cleared on unmount.
  const [slideDown, setSlideDown] = useState<Record<number, boolean>>({})
  const [slideTry, setSlideTry] = useState<Record<number, number>>({})
  const imgAttempts = useRef<Record<number, number>>({})
  const retryTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { retryTimers.current.forEach(clearTimeout) }, [])
  const onImgError = (i: number) => {
    const n = (imgAttempts.current[i] ?? 0) + 1
    imgAttempts.current[i] = n
    setSlideDown((prev) => ({ ...prev, [i]: true }))
    if (n < 2) {
      // Jittered backoff so a whole grid of blipped cards doesn't re-stampede the host.
      retryTimers.current.push(setTimeout(() => {
        setSlideDown((prev) => ({ ...prev, [i]: false }))
        setSlideTry((prev) => ({ ...prev, [i]: n }))
      }, 1200 + Math.random() * 1500))
    }
  }
  const touchStartX = useRef<number | null>(null)
  /**
   * Start Y and time, so a decisive FLICK counts as a swipe. Distance alone meant a quick, short
   * gesture — the one people actually make on a photo — did nothing at all, while a slow 41px drag
   * paged. listing-gallery.tsx reached the same conclusion for the lightbox; this is the higher
   * traffic surface and it never got the fix.
   */
  const touchStartY = useRef<number | null>(null)
  const touchStartT = useRef<number>(0)
  /** The finger that began the gesture, so touchend measures against the same one. */
  const touchId = useRef<number | null>(null)
  /**
   * ⚠️ A TIMESTAMP, NOT A BOOLEAN, and that is the whole fix for two reviewer findings. A swipe
   * sets it so the release tap does not also open the listing — but that only works if a click
   * actually arrives to consume it. When the browser withholds the synthetic click (it does when
   * the gesture panned), a boolean flag survives and swallows the buyer's NEXT tap; and on a
   * hybrid device a finger-swipe followed by a real mouse click swallowed that instead. A window
   * expires on its own, so a stale suppression cannot outlive the gesture that set it.
   */
  const suppressClickAt = useRef(0)
  /**
   * ⚠️ SIZED TO THE SYNTHETIC CLICK, NOT TO "a while". The browser's touch-derived click follows
   * touchend within ~300ms (that is the legacy click delay's own ceiling), so 400ms covers it with
   * margin while staying well under a deliberate second tap — a reviewer rightly objected that a
   * 700ms window would eat a buyer who swipes a photo and immediately taps to open the listing.
   */
  const SWIPE_CLICK_WINDOW_MS = 400

  // Slot arithmetic — the hover-scan ceiling and the "+N" doorway. Lives in lib/card-slots.ts so
  // every count from 0 to 60 is covered by a test rather than by reading this line carefully.
  const { photoCount, overflow, moreCount, segments } = cardSlots(images.length)
  // Floored at 0 so an image-less listing (segments === 0) reports a sane upper bound rather than
  // -1. goTo's own Math.max already refuses to return a negative index, so this is belt-and-braces
  // — but `last` is read on its own below, and a -1 "last slide" is the kind of value that reads
  // as correct right up until someone compares against it.
  const last = Math.max(0, segments - 1)
  const goTo = (n: number) => setIdx(Math.max(0, Math.min(last, n)))
  // A live price-drop already signals "cheap" — don't also stack the below-market chip
  // (redundant, and it crowds the price row on a narrow card).
  const hasDrop = listing.prevPrice != null && !!dropPercent(listing.prevPrice, listing.price)

  return (
    // `data-card-root` is the hook for the NATIVE long-press action sheet (native-bootstrap.tsx),
    // and it has to hang on the ROOT rather than on the card link: the stretched <a data-card-link>
    // is a SIBLING of the photo (see below — it deliberately sits UNDER the image so the image's own
    // buttons stay clickable), so a touch on the photo can never `closest()` its way to the anchor,
    // and the sheet was unreachable over the ~70% of the card the photo covers. The root IS an
    // ancestor of both, so the handler resolves the link from here and the whole card — photo
    // included — is one long-press target. Inert on web.
    <div
      data-card-root
      // ⚠️ PRESS IS 0.97, NOT 0.985 — the old value was below the perceptual threshold on the
      // app's most-tapped surface. Scale is RELATIVE, so the same number is a different amount
      // of travel at different sizes: 0.985 on a 179px card moves the edge 2.7px, which reads
      // as nothing. 0.97 moves it 5.4px. Large surfaces do need LESS scale than small ones —
      // that part of the original reasoning was right — but 0.985 overshot the correction.
      // 0.97 is not a new number either: it is `ui/button`'s value, 26 live uses. Live census
      // when this changed: 0.96 ×114, 0.97 ×26, 0.985 ×25 — three depths across the rendered
      // page, and the 25 were all instances of THIS component (one per card), i.e. the card
      // was the only component wearing the third depth.
      // ⚠️ `has-[button:active]:scale-100` STOPS THE PRESS FROM COMPOUNDING. `:active` matches
      // ANCESTORS, so pressing an in-card control (favourite, share, the quick-action row —
      // all `<button>`) fired this scale as well as the button's own: 0.97 × 0.96 = 0.931, a
      // 6.9% shrink of the whole card because you tapped a 32px heart, resolving in two steps
      // on two clocks (200ms here, 160ms there). The defect predates this line (0.985 × 0.96
      // = 0.946) and raising the card to 0.97 made it louder, which is how a reviewer found
      // it. Only `button` is exempted, NOT `a`: the card's stretched link IS the card's own
      // press, so exempting anchors would delete the feedback this line exists to provide.
      className="reveal-on-scroll group relative flex flex-col h-full w-full text-left rounded-xl cursor-pointer transition-transform duration-200 [transition-timing-function:var(--ease-spring-snappy)] active:scale-[0.97] has-[button:active]:scale-100 [touch-action:manipulation]"
    >
      {/* Card = link, actions = siblings. The whole card navigates via this ONE real,
          keyboard-focusable stretched <a> (the card link). Every IconButton below is a
          SIBLING that paints ABOVE it (z-10 vs this z-0), so NO interactive control is
          nested inside another — a role=button/anchor may not contain buttons (the AX tree
          collapses them and click/keydown collide; that was the P1 this fixes). The link
          sits UNDER the image (the image container is an `isolate` stacking context, painted
          above this by tree order → its action buttons stay clickable) and OVER the in-flow
          body (so title/price/location clicks land on it). Image-area clicks are handled by
          the image container's own onClick, below (a plain div, NOT an interactive ancestor),
          which also lets a swipe suppress the release tap. The whole-card focus ring lives
          here now (it was on the old wrapper). Enter navigates; a modifier/middle click falls
          through to the real href → open-in-new-tab, which a div role=button never allowed. */}
      <a
        href={`/listings/${listing.id}`}
        aria-label={displayTitle}
        data-card-link
        draggable={false}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
          e.preventDefault()
          onOpen(listing)
        }}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      {/* Image carousel / placeholder.
          transform-gpu/isolate force a compositing layer so the rounded
          overflow-hidden actually clips the translateX-transformed carousel row
          — otherwise the adjacent (next) image leaks through at the edge on hover. */}
      <div
        data-protected
        data-rail-media
        // ⚠️ `rounded-2xl`, NOT `xl` — canon §2's size rule ("all media ≥ ~96px"), which this
        // 179px surface always satisfied. It sat at `xl` because the table used to carve
        // listing-card media out by name; that contradiction was resolved 2026-08-09 and the
        // carve-out deleted. Do not "restore" it: at the old xl this was a 9px corner on the
        // most-repeated photo in the product, which is most of why the feed read as generic.
        // ⚠️ `partner-ring-media` REPLACES THE PARTNER SEAL THAT USED TO SIT IN THE META ROW
        // (owner, 2026-08-11: ring on the products, remove the badge). It is an `::after` overlay
        // that hugs this rounded-2xl corner and takes no layout.
        // ⛔ THE EARLIER COMMENT HERE SAID IT WAS "an outline with a negative offset [that] paints
        // OVER the photo". THAT WAS FALSE and it is why the ring shipped invisible three times: an
        // inset outline is painted UNDER an absolutely-positioned child, and next/image `fill`
        // makes the photo exactly that. An inset box-shadow fails the same way. Proven with a 6px
        // red probe on the live page — see `.partner-ring-media` in globals.css for the full
        // measurement before reaching for either again.
        // The accessible name moved to the meta row; see the sr-only there.
        className={cn(
          'relative aspect-square w-full overflow-hidden rounded-2xl bg-tint transform-gpu isolate transition-shadow duration-200 ease-out group-hover:shadow-[var(--shadow-card)]',
        )}
        onClick={(e) => {
          // Image-area click → open the listing. It bubbles up from the photo, scrims,
          // badges and dots (none of which stopPropagation); the action buttons DO
          // stopPropagation, so they never reach here. A swipe sets suppressClick so the
          // release tap doesn't also open it. This div carries no role/tabindex → it is NOT
          // an interactive ancestor, so the buttons inside it are NOT nested-in-interactive
          // (which is exactly why it can't be an <a> — that would re-nest them). The card-link
          // <a> below sits UNDER the image, so it only catches clicks over the body/title.
          // ⚠️ The image therefore has to reproduce the anchor's modifier behaviour itself, or
          // Cmd/Ctrl/Shift-click over the PHOTO (the dominant area) would client-navigate instead
          // of opening a new tab — which is the whole point of having a real href. Middle-click is
          // handled in onAuxClick (it never fires onClick).
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
            window.open(`/listings/${listing.id}`, '_blank', 'noopener')
            return
          }
          if (Date.now() - suppressClickAt.current < SWIPE_CLICK_WINDOW_MS) { suppressClickAt.current = 0; return }
          onOpen(listing)
        }}
        onAuxClick={(e) => {
          // Middle-click (button 1) → open the listing in a new tab, matching the anchor and what
          // a middle-click on any real link does. onClick never fires for the middle button.
          if (e.button === 1) { e.preventDefault(); window.open(`/listings/${listing.id}`, '_blank', 'noopener') }
        }}
        onMouseEnter={() => {
          // A re-entry inside the grace period cancels the pending release, so the slides the
          // card already has are kept rather than remounted.
          if (collapseTimer.current) { clearTimeout(collapseTimer.current); collapseTimer.current = null }
          if (segments > 1) setExpanded(true)
          if (listing.video) setHoverVideo(true)
        }}
        onMouseLeave={() => {
          setQuickOffer(null)
          setHoverVideo(false)
          // ⚠️ TWO SEPARATE DECISIONS, AND THEY MUST NOT SHARE A GUARD.
          // (a) Rewind the slide — only if HOVER put us here. Hover is transient, so the grid
          //     never ends up a mosaic of cards frozen on somebody's third photo; but a slide the
          //     FINGER chose is a deliberate choice and is left alone.
          // (b) Release the mounted slides — ALWAYS, because onMouseEnter always mounts them.
          // Guarding (b) behind hoverNav leaked: entering the card over a z-10 control (the save
          // heart, whose 44px tap area reaches within ~2px of the corner) fires the media box's
          // own onMouseEnter — so `expanded` latches true — while no zone is ever entered, so
          // hoverNav stays false and the timer was never armed. `setExpanded(false)` exists
          // nowhere else, so those slides stayed mounted and fetched for the life of the page,
          // with no visual symptom. "Hover the heart, click it, move on" is the single most
          // common non-navigating gesture on a feed. Found by codex + the pointer-lens reviewer,
          // independently, at diff review; the earlier browser measurements could not see it
          // because they always entered over bare photo.
          const rewinding = hoverNav.current
          if (rewinding) { hoverNav.current = false; setIdx(0) }
          // ⚠️ Release ONLY when the card is (or is about to be) back on its cover. Unmounting
          // slides 2..n while slide 3 is the one on screen would leave the strip translated to
          // -200% over nothing — a blank card. That is the real reason the two were coupled, and
          // it is preserved here as an `idx === 0` test rather than as a hover test: the case
          // that must be protected is "a finger chose a slide", which is exactly idx > 0 without
          // a rewind, not "hover never happened".
          if (!rewinding && idx !== 0) return
          if (collapseTimer.current) clearTimeout(collapseTimer.current)
          collapseTimer.current = setTimeout(() => {
            collapseTimer.current = null
            // Re-checked at FIRE time against the live index, not the one this handler closed
            // over — see idxRef. Unmounting the slides while a non-cover slide is showing is the
            // one outcome that must be impossible, so it is tested where the damage would happen.
            if (idxRef.current === 0) setExpanded(false)
          }, COLLAPSE_MS)
        }}
        onTouchStart={(e) => {
          // ⚠️ DOES NOT CLEAR hoverNav — ownership transfers on the SWIPE, in onTouchEnd, not on
          // first contact. Clearing it here latched a card open on a touchscreen laptop: hover to
          // photo 3, then touch WITHOUT swiping (tap the heart, start a vertical scroll, or get a
          // touchcancel) and the hover-chosen slide was suddenly owned by nobody — mouse-out then
          // saw `!rewinding && idx !== 0` and bailed, so the card stayed on photo 3 with every
          // slide mounted, forever. A touch that does not move the strip has not chosen anything.
          if (collapseTimer.current) { clearTimeout(collapseTimer.current); collapseTimer.current = null }
          if (segments > 1) setExpanded(true)
          /**
           * ⚠️ THERE IS DELIBERATELY NO PINCH BRANCH HERE, and that is a decision, not an omission.
           * Four reviewer rounds went into detecting a second finger — `targetTouches`, a tracked
           * id, a live-contact test — and EVERY version swallowed an ordinary tap in some real
           * posture, most damningly the one-handed grip with a thumb resting on the glass, where a
           * buyer could not open a listing at all. What it prevents is that a pinch-zoom might page
           * the photo strip: the behaviour this card shipped with for months, on a control whose
           * worst outcome is showing a different photo of the same listing. Trading a working tap
           * for that is the wrong side of the trade, so there is no branch.
           * What DOES protect the measurement is the identifier match in onTouchEnd — the gesture
           * is measured from the finger that started it, never across two — and that can only ever
           * decline to page, never swallow anything.
           *
           * ⚠️ A FRESH GESTURE CLEARS THE SUPPRESSION WINDOW, the other half of the click
           * arbitration below. The 400ms window alone would eat a buyer who swipes a photo and then
           * deliberately taps to open the listing inside it; a touch-derived synthetic click always
           * arrives BEFORE any new touchstart, so clearing here can only release a real tap.
           */
          suppressClickAt.current = 0
          const t = e.changedTouches[0]
          touchId.current = t.identifier
          touchStartX.current = t.clientX
          touchStartY.current = t.clientY
          touchStartT.current = Date.now()
        }}
        // ⚠️ THE SWIPE IS CAPPED AT THE SAME FOUR SLOTS, AND THAT IS A DELIBERATE NARROWING.
        // This used to swipe through ALL of a listing's photos on a phone (`last` was
        // images.length - 1); now it stops at the doorway. The owner's spec describes the card as
        // having four sections, and a card that behaves one way under a mouse and another way
        // under a thumb is two components. Touch also GAINS the doorway, which is the thing the
        // old unbounded swipe never had: a phone buyer who wants photo 7 now has an obvious way
        // to ask for it instead of discovering by swiping that there were more. The full set
        // lives one tap away on the PDP either way.
        onTouchEnd={(e) => {
          /**
           * ⚠️ THE SAME FINGER THAT STARTED, MATCHED BY IDENTIFIER. `changedTouches[0]` is whichever
           * contact happened to lift; with two fingers down that can be the other one, and a
           * distance measured between two different fingers is not a gesture at all.
           */
          const end = Array.from(e.changedTouches).find((t) => t.identifier === touchId.current)
          const sx = touchStartX.current
          const sy = touchStartY.current
          // ⚠️ CLEARED FIRST, BEFORE ANY EARLY RETURN. A single-photo card (`segments < 2`) used to
          // return with the start point still set, so the refs held a dead coordinate until the
          // next touch. Read into locals, clear, then decide.
          touchStartX.current = null
          touchStartY.current = null
          touchId.current = null
          if (!end || sx == null) return
          if (segments < 2) return
          const dx = end.clientX - sx
          const dy = sy == null ? 0 : end.clientY - sy
          // The decision itself is `isSwipe` in card-slots.ts — pure, so it can be unit-tested.
          // It cannot be exercised from here: the live catalogue is single-image, `segments < 2`
          // short-circuits above, and a browser probe can only ever report "nothing happened".
          if (isSwipe(dx, dy, Date.now() - touchStartT.current)) {
            suppressClickAt.current = Date.now()
            // THIS is where touch takes ownership of the slide — a swipe that actually moved it.
            // From here a stray mouse-out (hybrid devices emit one) must not rewind the choice.
            hoverNav.current = false
            goTo(idx + (dx < 0 ? 1 : -1))
          }
        }}
        // The OS cancels the gesture when it claims the touch for a scroll; without this the start
        // point survives and the FOLLOWING touchend measures a swipe that never happened.
        onTouchCancel={() => {
          touchStartX.current = null
          touchStartY.current = null
          touchId.current = null
        }}
      >
        {images.length > 0 ? (
          <div
            // ⛔ `ease-out` IS DELIBERATE HERE — DO NOT "UPGRADE" THIS TO A SPRING.
            // It was changed to `--ease-spring` on the argument that a swipe should settle
            // rather than decelerate, and that an overshoot inside `overflow-hidden` is
            // harmless because it gets clipped. The second half is wrong, and two review
            // families caught it independently. Clipping bounds an overrun; it cannot
            // MANUFACTURE a slide. The track translates by -100%·index, so overshooting past
            // the LAST index pulls the strip further left than its content extends and opens
            // a blank sliver at the right edge — ~2px on a 179px card, ~4px in a full-width
            // gallery, 8–13 device px at dpr 2–3, against a photo boundary. Index 0 does the
            // same on the left. That is exactly the "resting position IS the boundary" case
            // the motion contract in globals.css forbids; a track END is a boundary just as
            // much as a viewport edge. A spring is only safe where the overrun has somewhere
            // to go.
            //
            // The DURATION is 200, not the 300 it carried before the hover-scan landed, and that
            // is a separate decision from the easing above — the no-spring rule is about the
            // curve and survives untouched. At 300 a left→right sweep across four slots lags
            // visibly behind the pointer, and hover-scan only works if the photos keep up with
            // the hand. Still a slide rather than a crossfade, because this same transform
            // carries the touch swipe and a swipe has to track the finger's direction.
            className="flex h-full w-full transition-transform duration-200 ease-out"
            style={{ transform: `translateX(-${idx * 100}%)` }}
          >
            {images.slice(0, expanded ? photoCount : 1).map((src, i) => (
              <div key={i} className="relative h-full w-full shrink-0 overflow-hidden">
                {slideDown[i] ? (
                  <div className="flex h-full w-full items-center justify-center bg-tint">
                    <CategoryIcon name={listing.category.icon} className="h-11 w-11 text-muted-foreground" />
                  </div>
                ) : (
                  <Image
                    key={`${i}:${slideTry[i] ?? 0}`}
                    src={src}
                    // ⚠️ The denominator is the LISTING's photo count, not the strip's. I briefly
                    // changed it to photoCount on the theory that "1/6" promises slides the card
                    // does not have; two reviewers pushed back and they were right. Alt text
                    // describes the photo set, and a screen-reader user realistically only ever
                    // reaches slide 0 (the rest mount on hover), so "1/3" on a six-photo listing
                    // is simply a false statement about the listing — while "1/6" is true, and
                    // no more misleading about what is reachable from the card than "1/3" was.
                    alt={images.length > 1 ? `${displayTitle} — ${i + 1}/${images.length}` : displayTitle}
                    fill
                    sizes={sizes}
                    // ⚠️ THE PHOTO DOES NOT MOVE ON HOVER, DELIBERATELY (owner decision, 2026-08-05).
                    // This was `group-hover:scale-[1.03]`. Scaling the product photo on hover is one of
                    // the most recognisable generated-UI signatures, and on a feed it also fights the
                    // thing the card exists to do: show the item honestly. The hover affordance is kept
                    // — the MEDIA brightens instead — so the card still answers the pointer without the
                    // imagery drifting under it. Brightness is a compositor-only filter, so this stays
                    // as cheap as the transform it replaced and never triggers layout.
                    className="object-cover transition-[filter] duration-200 group-hover:brightness-105"
                    placeholder="blur"
                    blurDataURL={BLUR}
                    quality={60}
                    // Mock/seed images (picsum) are already CDN-sized — bypass the Vercel
                    // optimizer (saves transformations AND removes a failure hop). No-op
                    // for real Supabase images; goes away with the mock data at launch.
                    unoptimized={isMockImageUrl(src)}
                    onError={() => onImgError(i)}
                    // The true LCP image (first card of the first row, first photo) uses
                    // next/image `priority` so Next emits a <link rel=preload> — the preload
                    // scanner fetches it before render. Other above-the-fold images just load
                    // eagerly (no preload flood across every row).
                    //
                    // ⚠️ SLIDES 2..n ARE EAGER, AND THAT IS NOT A CONTRADICTION OF THE LAZY FEED.
                    // They are only in the DOM at all because the pointer is on this card
                    // (`expanded`), so deferring them a second time buys nothing and costs the
                    // whole feature: `lazy` waits for an intersection that only happens once the
                    // slot is already under the pointer, so a sweep outran the fetch and slots 2
                    // and 3 rendered as the blur placeholder. Caught in the preview screenshots —
                    // the dev-mode runs had the images warm in cache and looked perfect.
                    //
                    // The objection to this is that a pointer merely crossing the grid now pays
                    // for images nobody looks at (agy, at the commit gate: "network flood",
                    // "massive spike in wasted bandwidth"). Right in direction, wrong in size —
                    // MEASURED, because the whole argument turns on a number: a fast pass across
                    // a full row of cards fired 6 requests for 19 KB, about 5 KB per card
                    // crossed. These are 360px webp thumbnails, not hero images. Weigh a real
                    // 5 KB against a blank slot under the pointer before changing this back, and
                    // re-measure rather than re-reasoning: `scripts` aside, the probe is a mouse
                    // sweep plus a content-length tally.
                    {...(lcp && i === 0
                      ? { priority: true }
                      : { loading: i === 0 ? (priority ? 'eager' : 'lazy') : 'eager' })}
                  />
                )}
              </div>
            ))}

            {/* THE DOORWAY — the fourth slot when there are more photos than slots. It is not a
                control: the whole media box already opens the listing on click, so this reads as a
                destination and inherits the behaviour for free (plain click, modifier-click and
                middle-click all bubble to the box's handlers, so "+6" opens in a new tab exactly
                like the rest of the card does).
                Backdrop = the FIRST unshown photo under a scrim, not a flat panel. A dead grey
                tile at the end of a sweep reads as "the photos ran out"; a real photo you can
                half-see reads as "there is more in here", which is the only reason the slot exists.
                aria-hidden: this is a hover affordance that duplicates the card link an AT user is
                already on, and the photos themselves live on the PDP. */}
            {overflow && expanded && (
              // bg-tint on the tile itself, not just on the media box behind it: if the backdrop
              // photo fails to load the <Image> is omitted entirely, and without a fill the scrim
              // would sit over nothing — a translucent grey rectangle with floating text. The
              // doorway has to keep working when its decoration does not. (Reviewer catch at the
              // commit gate; the other slides already do this via their own placeholder branch.)
              <div className="relative h-full w-full shrink-0 overflow-hidden bg-tint">
                {!slideDown[photoCount] && (
                  <Image
                    key={`${photoCount}:${slideTry[photoCount] ?? 0}`}
                    src={images[photoCount]}
                    alt=""
                    aria-hidden
                    fill
                    sizes={sizes}
                    className="object-cover"
                    placeholder="blur"
                    blurDataURL={BLUR}
                    // ⚠️ 60, NOT a cheaper number, even though this image is never seen
                    // unscrimmed. `qualities` in next.config.ts is an ALLOWLIST — [60, 70] — and
                    // Next's optimizer answers 400 to any `q` outside it (the same invariant
                    // src/lib/listing-image.ts:32 records for `w`). An off-list value fails
                    // ONLY for real Supabase photos: seeded mock images are `unoptimized`, so
                    // they bypass the optimizer entirely and a local grid of mock data renders a
                    // perfect doorway while production shows an empty one.
                    quality={60}
                    unoptimized={isMockImageUrl(images[photoCount])}
                    onError={() => onImgError(photoCount)}
                    // eager for the same reason as the slides above — it only mounts on hover.
                    loading="eager"
                  />
                )}
                <span aria-hidden className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/55 text-white">
                  {/* Black + white, not tokens: this sits ON a photo, so it must not follow the
                      theme — same rule as the legibility scrims and the save heart below. */}
                  <span className="text-lg font-bold leading-none tabular-nums">+{moreCount}</span>
                  <span className="text-2xs font-medium">{tr('photos', 'ảnh')}</span>
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-tint">
            <CategoryIcon name={listing.category.icon} className="h-11 w-11 text-muted-foreground" />
          </div>
        )}

        {/* THE HOVER ZONES — `segments` invisible equal columns laid over the photo. Entering one
            selects its slide, so sweeping left→right walks the strip with no clicking (Avito's
            card gallery; the owner's reference).
            · z-[1]: above the photo, BELOW every control. The heart, the quick-action row, the
              badges and the offer overlay are all z-10+, so they keep their own hover and clicks;
              only bare photo is covered. CardVideo is `pointer-events-none absolute inset-0` with
              no z-index, so it neither intercepts these nor paints over them.
            · A click on a zone bubbles to the media box → opens the listing, unchanged.
            · hover-pointer, not `pc`: the precondition is a real hovering pointer, not a wide
              screen. `pc` would deny hover-scan to a mouse user with a half-width window, and the
              arrows this replaces are gone. Gating it at all matters because touch devices emit a
              synthetic mouseenter on tap, which would jump the photo out from under the thumb. */}
        {segments > 1 && (
          <span aria-hidden className="pointer-events-none absolute inset-0 z-[1] hidden hover-pointer:flex">
            {Array.from({ length: segments }, (_, i) => (
              <span
                key={i}
                className="pointer-events-auto h-full flex-1"
                onMouseEnter={() => { setExpanded(true); hoverNav.current = true; setIdx(i) }}
              />
            ))}
          </span>
        )}

        {/* Video: autoplays over the cover once the card settles in view (see CardVideo —
            IO-gated, cover-beat fade-in, page-wide concurrency cap, Save-Data respected).
            pointer-events-none inside, so the card still handles hover + click. Swiping the
            photo carousel suspends it — the clip belongs to the cover slide. */}
        {listing.video && <CardVideo src={listing.video} hover={hoverVideo} suspend={idx !== 0} />}

        {/* Legibility scrims — faint top+bottom gradients so the white heart / locate
            pin / dots survive pale photos (sky, sand). Theme-neutral by design: they
            sit ON the photo, so black works in both light and dark. */}
        {images.length > 0 && (
          <>
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/20 to-transparent" />
            <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/20 to-transparent" />
          </>
        )}

        {/* eno.vn watermark — hidden until a save/copy/drag attempt (ImageShield) */}
        {images.length > 0 && <span className="img-watermark" aria-hidden />}

        {/* Top-left signal: ONE badge — the first of Urgent → price-drop % → New that applies
            (the shared, app-wide badge system — see card-badges.tsx, which carries the reasoning
            for why a suppressed drop loses nothing: the struck-through "was" price in the price
            row below states it a second time, independently of this chip). */}
        {/* ⚠️ THE BADGES DO NOT FADE ON HOVER ANY MORE. This carried `pc:group-hover:opacity-0`,
            which used motion to DELETE information — the price-drop %, "Bán gấp" and New — at the
            exact moment the buyer commits attention to the card. Those are the highest-value
            conversion signals on it. The stated reason was crowding, but the badges sit at
            `left-2 top-2` and the hover icon row is at `right-11 top-2`: they cannot collide at any
            width where that row renders. */}
        <CardBadges listing={listing} className="absolute left-2 top-2 z-10" />

        {/* Bottom-left status chips — a video indicator (so mobile, which has no hover,
            still knows there's a clip) + social proof "N saved" (≥3). One row so they never
            overlap; clear of the dots (center) and the action column (right). */}
        {(listing.video || savedTotal >= 3) && (
          <span className="pointer-events-none absolute left-2 bottom-2 z-10 flex items-center gap-1.5">
            {listing.video && (
              <span title={tr('Has a video', 'Có video')} className="flex h-5 items-center rounded-full bg-foreground/70 px-1.5 text-background material backdrop-blur-[2px]">
                {/* Filled micro-mark (icon-language §2 spirit: a 2-weight line vanishes at
                    this size inside a filled chip) at the ladder's 12px micro step. */}
                <Play className="h-3 w-3 fill-current" />
              </span>
            )}
            {/* base savedCount persists server-side (real saves); savedDelta adds this
                session's own toggle so it moves the moment the heart is tapped. */}
            {savedTotal >= 3 && (
              <span title={tr('people saved this', 'người đã lưu tin này')} className="flex h-5 items-center gap-1 rounded-full bg-foreground/70 px-2 text-3xs font-bold text-background material backdrop-blur-[2px]">
                <Heart className="h-3 w-3 fill-current" /> {new Intl.NumberFormat(moneyLocale(lang) === 'vi' ? 'vi-VN' : 'en-US').format(savedTotal)}
              </span>
            )}
          </span>
        )}

        {/* Quick actions (5a #6) — desktop ONLY: Chat · Offer · Locate unfurl
            horizontally OUT of the save heart (top-right), sliding LEFT into place
            with a slight stagger — chat (nearest the heart) first, then offer, then
            locate — so the row reads as fanning out of the save icon. flex-row-reverse
            lays them out [locate · offer · chat] left→right with chat against the heart.
            Mobile/tablet keep the always-on right-edge column below. Pressing Offer
            opens the centered discount bar (shared with mobile). */}
        <span className="pointer-events-none absolute right-11 top-2 z-10 hidden flex-row-reverse items-center gap-1 pc:flex">
          {quickOffer === null && (
            // Bare glyph — same face treatment as the heart/pin (white + drop-shadow) = variant="overlay".
            // tapTarget={false} is REQUIRED here: this is a gap-1 row of h-8 glyphs at ~36px pitch, so a
            // 44px ::before would overlap its neighbour and a boundary tap would fire OFFER, not CHAT.
            //
            // ⚠️ THE SPRING RIDES `transition-all`, AND THAT IS FINE HERE — all three reviewers
            // read it as an overshoot landing on opacity and colour, so the arithmetic is written
            // down once. --ease-spring-snappy peaks at 1.030, i.e. 3%. The travel is translate-x-3
            // = 12px, so the overrun is 0.36px (~1 device px at dpr 3) on a button that floats over
            // a photo — not docked to an edge, which is the case globals.css actually bans. Opacity
            // clamps at 1, so its overshoot is unobservable by definition. The scale is what the
            // spring is FOR. Narrowing the property list would be a separate, visually-tested change.
            <Tooltip content={tr('Chat with seller', 'Nhắn tin với người bán')} side="top">
              <IconButton
                size="sm"
                variant="overlay"
                tapTarget={false}
                aria-label={tr('Chat with seller', 'Nhắn tin với người bán')}
                onClick={(e) => { e.stopPropagation(); quickGo({ body: tr('Hi! Is this still available?', 'Chào bạn! Món này còn không?') }) }}
                className="pointer-events-auto translate-x-3 opacity-0 transition-all duration-200 ease-[var(--ease-spring-snappy)] hover:scale-110 active:scale-[0.96] group-hover:translate-x-0 group-hover:opacity-100 focus-visible:translate-x-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <MessageCircle className="icon-shadow-brand h-5 w-5" />
              </IconButton>
            </Tooltip>
          )}
          {listing.price > 0 && listing.negotiable !== false && (
            <Tooltip content={tr('Make an offer', 'Trả giá')} side="top">
              <IconButton
                size="sm"
                variant="overlay"
                tapTarget={false}
                aria-label={tr('Make an offer', 'Trả giá')}
                aria-pressed={quickOffer !== null}
                onClick={(e) => { e.stopPropagation(); setQuickOffer(quickOffer === null ? 10 : null) }}
                className={cn(
                  'pointer-events-auto translate-x-3 opacity-0 transition-all duration-200 ease-[var(--ease-spring-snappy)] hover:scale-110 active:scale-[0.96] group-hover:translate-x-0 group-hover:opacity-100 focus-visible:translate-x-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
                  quickOffer === null && 'delay-75 group-hover:delay-75',
                )}
              >
                {/* Pressed = brand fill, mirroring the heart's saved state (icon-language
                    §5: an active offer is user-state, the one solid-fill moment). The offer
                    controls open as ONE wide edge-to-edge bar (shared with mobile,
                    below) so the amount never gets cramped on a narrow card. */}
                <Tag className={cn('h-5 w-5', quickOffer !== null && 'fill-brand')} />
              </IconButton>
            </Tooltip>
          )}
          {quickOffer === null && (
            <Tooltip content={tr('Show on map', 'Xem trên bản đồ')} side="top">
              <IconButton
                size="sm"
                variant="overlay"
                tapTarget={false}
                aria-label={tr('Show on map', 'Xem trên bản đồ')}
                onClick={(e) => { e.stopPropagation(); locate(listing) }}
                className="pointer-events-auto translate-x-3 opacity-0 transition-all delay-150 duration-200 ease-[var(--ease-spring-snappy)] hover:scale-110 active:scale-[0.96] group-hover:translate-x-0 group-hover:opacity-100 group-hover:delay-150 focus-visible:translate-x-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <MapPin className="icon-shadow-brand h-5 w-5" />
              </IconButton>
            </Tooltip>
          )}
          {/* ⚠️ FOURTH AND OUTERMOST, AND IT RENDERS FOR NOBODY BUT THE SELLER WHO OWNS THIS LISTING.
              The row is `flex-row-reverse`, so the LAST child lays out furthest from the heart —
              which is where an owner-only action belongs: it never displaces chat, offer or locate,
              and for the ~everyone who does not own the listing the row is unchanged, same three
              glyphs at the same three positions.
              `delay-200` continues the existing stagger (chat 0, offer 0, locate 150) so it fans out
              last rather than arriving with the group.
              Owner, 2026-08-14: "when they see their own products ... add there as 4th one to edit". */}
          <OwnerEditButton
            listingId={listing.id}
            sellerId={listing.sellerId}
            compact
            dense
            className="pointer-events-auto translate-x-3 opacity-0 transition-all delay-200 duration-200 ease-[var(--ease-spring-snappy)] hover:scale-110 active:scale-[0.96] group-hover:translate-x-0 group-hover:opacity-100 group-hover:delay-200 focus-visible:translate-x-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          />
        </span>

        {/* Save (Heart) — pinned top-right on EVERY platform (the only control left on the
            photo). GHOST, not overlay: the heart's shadow lives on the icon itself at 0.5
            alpha (softer than overlay's 0.55 on the box), and its saved/unsaved fill is on
            the <Heart> child — so the primitive contributes only the shell. The mobile
            Chat/Offer/Map glyphs that used to stack down this edge now live in the card body
            (a quiet native action row); desktop keeps its on-hover unfurl above. */}
        <IconButton
          size="sm"
          // ⚠️ THE NAME IS CONSTANT ON PURPOSE — `aria-pressed` is what reports the state, and a
          // toggle button whose NAME also flips says the same thing twice, in contradictory
          // words: "Remove favorite" + pressed announces as though REMOVAL were the active state,
          // when what is active is the save. (ARIA APG, Button-Toggle: the label does not change
          // when the state does.) The pair to read is "Save listing, pressed".
          aria-label={tr('Save listing', 'Lưu tin')}
          aria-pressed={favorited}
          onClick={(e) => { e.stopPropagation(); if (!favorited) setBurst(true); toggle(listing.id) }}
          className="absolute right-2 top-2 z-10 transition-transform hover:scale-110 active:scale-[0.96]"
        >
          {/* Icon-only (no chip): white outline + subtle dark fill + drop-shadow —
              legible on ANY photo; solid fill-brand when saved (icon-language §5
              user-state — the line stays white because it sits over media); heart-pop
              on save. h-5 = the ladder's 20px step, same as the quick-action glyphs,
              so the whole photo-overlay cluster shares ONE optical size. */}
          <span onAnimationEnd={(e) => { if (e.animationName === 'heart-pop') setBurst(false) }} className={cn('inline-flex', burst && 'animate-heart-pop')}>
            {/* ⚠️ SAVED = RED, THE SAME RED AS THE COUNTERS (owner, 2026-08-13: "clicking on heart
                on products make it red similar to notif message counter red"), i.e. --destructive,
                the token the counter badge uses. It was `fill-brand text-white`.
                ⚠️ THE COLOUR HAS TO RIDE ON `text-*`, NOT `fill-*`, AND THAT IS WHY THE OLD PAIR
                LOOKED IDENTICAL IN BOTH STATES. These glyphs are generated with `fill="currentColor"`
                on each <path>, and a presentation attribute on the path beats a `fill:` inherited
                from the <svg> — so `fill-brand` never reached the ink and both states painted
                `text-white`. Setting `color` is what the paths actually follow. `fill-current` is
                kept so the shape stays solid rather than falling back to the unset default. */}
            {/* ⛔ `fill-none`, NOT `fill-black/25`. The translucent black interior made the heart a
                grey blob beside the chat and pin glyphs, which are unfilled outlines — the owner
                spotted it as "the save icon is different than others". save-listing-button.tsx had
                already reached this conclusion and written it down: a filled interior fights the
                outline, and the outline is what carries legibility. All three now share
                icon-shadow-brand so the trio is one treatment. */}
            <Heart className={cn('icon-own-ink h-5 w-5 transition-colors', favorited
              ? 'icon-shadow-saved fill-current text-destructive'
              : 'icon-shadow-brand fill-none text-white')} />
          </span>
        </IconButton>

        {/* Offer slide — ONE edge-to-edge bar for BOTH mobile + desktop (was a
            cramped inline panel on desktop that squeezed the amount on narrow cards).
            Tapping/clicking anywhere outside it closes the slider. */}
        {quickOffer !== null && (
          <span
            aria-hidden
            onClick={(e) => { e.stopPropagation(); setQuickOffer(null) }}
            className="absolute inset-0 z-10"
          />
        )}
        {quickOffer !== null && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-1 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-1.5 rounded-xl bg-popover/95 p-2 shadow-pop material backdrop-blur-[2px] animate-in slide-in-from-right-2 fade-in duration-150 ease-out"
          >
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-2xs font-bold tabular-nums text-foreground">−{quickOffer}%</span>
              <Slider
                min={5} max={50} step={1}
                value={quickOffer}
                onChange={setQuickOffer}
                aria-label={tr('Discount', 'Mức giảm')}
                className="min-w-0 flex-1 cursor-pointer"
              />
            </div>
            <Button
              variant="cta"
              size="none"
              type="button"
              onClick={() => quickGo({ offerAmount: Math.round(listing.price * (1 - quickOffer / 100)) })}
              className="w-full gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-2xs tabular-nums cursor-pointer"
            >
              {/* Real ArrowRight, not the old '→' text glyph — a literal arrow renders in
                  the font's weight, not the icon system's (same decision in the compact
                  row's CTA — keep the two in lockstep). h-3 beats the :where size-4 rule. */}
              {formatMoneyFull(Math.round(listing.price * (1 - quickOffer / 100)), listing.currency, moneyLocale(lang))}
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* ⚠️ THE HOVER ARROWS ARE GONE (2026-08-09), replaced by the zones above.
            They were `hidden … group-hover:flex` — `display:none` until the card was hovered, with
            no `focus-visible:` escape hatch. A KEYBOARD-ONLY user could therefore never reach them
            and loses nothing here. Stating it precisely, because I first put it too strongly and
            codex was right to push back: they WERE focusable while a pointer rested on the card,
            so a mouse-plus-keyboard user could tab to them, and that path does disappear. It is an
            acceptable trade — the same pointer that un-hid the arrows now scans the photos by
            itself, with no clicking or tabbing at all — and the two could not have coexisted
            anyway: the left arrow sat on top of slot 1's zone, so "previous" was unreachable by
            hover while the pointer was over it.
            Everyone still reaches every photo the way they always did: open the card. */}
        {segments > 1 && (
          <>
            {/* Slot indicator. Counts SLOTS, not photos: with nine photos this is four pips, not
                nine. Nine pips would promise a strip that does not exist and shrink each one below
                the point of being countable. */}
            <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1">
              {Array.from({ length: segments }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    // `shadow-onmedia` replaces an inline `0 0 2px rgba(0,0,0,0.4)` halo (2026-08-09).
                    // Same legibility job on pale photos — the scrim alone does NOT cover it, see the
                    // token — but lit from above like every other shadow in the app, and no raw
                    // colour literal in a `style` prop (design-lint bans those in className; an
                    // rgba() in `style` slipped the rule).
                    // ⚠️ `transition-[width,opacity]`, NOT `transition-all` — name what moves.
                    // The DURATION is deliberately left off: the theme default is what every other
                    // pip-sized tween in the app uses, and a bare perf edit is the wrong place to
                    // change how fast a control feels.
                    // The width tween DOES cost layout (measured: 158 layouts across 8 pip changes
                    // vs 0 for a transform), and it was deliberately kept: every zero-layout
                    // alternative changes the design. `scaleX` squares off the round ends visibly,
                    // and any fixed-width-slot version (cross-fade, clip-path) widens the rail from
                    // 42px to 60px. There is also no jitter to buy back — exactly one pip is ever
                    // 12px, so the rail's total width is already constant. Twenty scoped layouts on
                    // a three-element flex row, during an interaction the user just initiated, is
                    // the cheaper side of that trade.
                    'h-1.5 rounded-full bg-white transition-[width,opacity] shadow-onmedia',
                    i === idx ? 'w-3 opacity-100' : 'w-1.5 opacity-60',
                  )}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Body — a strict, scannable native hierarchy: price (the anchor) → title →
          one tightly-packed subdued metadata line → (mobile only) a quiet action row.
          gap-0.5 keeps it dense; the metadata line is pushed to the bottom (mt-auto)
          so cards with 1- vs 2-line titles still align their footers across the grid. */}
      {/* ⛔ AN `@container` + `<Price dual="fit">` PAIR WAS BUILT HERE AND REMOVED — DO NOT REDO IT
          WITHOUT READING THIS. The goal was real: this price wraps to two lines on a narrow card
          (179px at 390, 229px at 768, against ~262px of "3,030,000 VND / service ≈ $115"), and a
          viewport breakpoint cannot fix it because a wider viewport adds COLUMNS and makes the
          card NARROWER. A container query is the right tool. What sank it was that a FIXED
          threshold cannot gate a VARIABLE-LENGTH string: it hid the ≈ conversion on a small card
          showing "81,000 VND ≈ $3" that had room to spare, while a property price still overflowed
          a container comfortably past the threshold. It over-fired and under-fired at once — and
          `container-type: inline-size` additionally makes this box a containing block and a
          stacking context for anything absolutely positioned inside it.
          If this is attempted again it needs to key on the RENDERED width of the amount, not on a
          constant — and the wrap it fixes has been there all along, so it is a deliberate piece of
          work, not a tidy-up. */}
      <div className="flex flex-1 flex-col gap-0.5 px-0.5 pt-2.5">
        {/* PRIMARY — price. The card's single blue accent, bold and a step larger than
            everything else so the eye lands here first.
            ⚠️ `flex-wrap`, AND THE COMMENT ABOVE IT USED TO CLAIM THE OPPOSITE ("deal chips sit
            INLINE … so 'was'/'Good price' add no vertical bulk"). That held only while the current
            price fitted on one line. Owner, 2026-08-13, pointing at a 2-up rail card: "the discount
            price is off … it doesnt look nice and cohesive". Measured at 390px, where the price
            column is 175px: "1,800,000 VND ≈ $68" already needs TWO lines, and because this was a
            non-wrapping baseline row the struck-through anchor stayed pinned to the FIRST baseline
            and `truncate` clipped it mid-number — "2,000,000…" floating to the right of a wrapped
            price, with its own ≈ conversion cut off entirely.
            Wrapping lets the anchor take its own line, complete and left-aligned under the price it
            refers to. It costs 21px on a discounted card (45px → 66px, measured) and nothing on any
            other card — the row only wraps when there is genuinely no room. That is the honest
            price of showing a complete number, and a clipped one was not worth the 21px it saved.
            ⚠️ listing-card-skeleton.tsx reserves the TWO-line case (23+1+21=45px) and is correct to:
            it cannot know which listings carry a drop, and most do not. */}
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          {/* ⛔ `text-lg` IS THE CEILING HERE — `text-xl` WAS TRIED AND REVERTED IN THE SAME PASS.
              Context, because "make the prices bolder" keeps coming back: the WEIGHT lever is
              already spent. Every feed price was ALREADY `font-extrabold` (800) before that
              request; the pass that answered it moved the weight into <Price> and briefly tried
              900 before landing back on 800 (Be Vietnam Pro has no 900), so the net visual change
              was zero — which is exactly what kept being reported. That leaves the type scale.
              ⚠️ And the type scale is spent too, for width reasons, measured on a real card:
              a 272px card renders "3,030,000 VND / service ≈ $115" at 271px on ONE line at 18px,
              and at 20px it WRAPS — the approximation drops to a second line, which breaks the
              `mt-auto` footer alignment across the grid and reads as a broken card. A property
              price ("9,500,000,000 VND / month") is already 299px at 18px, so this line is at its
              limit today. Any future attempt to enlarge the price has to buy the width first —
              by dropping the unit suffix or the ≈ approximation on this surface — not by bumping
              the size and hoping. */}
          {/* ⚠️ "from" ONLY ON A PARTNER TICKET, and it is not decoration: the number we hold is the
              LOWEST adult ticket, while the price the visitor actually pays is set at the partner's
              checkout and varies by date. Without the qualifier the card states a price we do not
              control as if it were the price — the PDP already says "from" for the same reason.
              ⚠️ It is safe on the width budget documented above ONLY because partner tickets are
              short: a 5-6 digit VND price with no unit suffix. Do not extend this prefix to
              ordinary listings without re-measuring — "from 9,500,000,000 VND / month ≈ $361,000"
              is exactly the line that wraps and breaks the grid's mt-auto footer alignment. */}
          {listing.isPartnerBooking && isBookingCategory(listing.category?.slug) ? (
            <span className="text-xs font-semibold text-body">{tr('from', 'từ')}</span>
          ) : null}
          <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} compact className="text-lg leading-tight text-accent-foreground" />
          {/* Struck-through "was" anchor — server-computed 30-day-min reference, present
              whenever the listing HAS a live drop.
              ⚠️ IT IS NO LONGER TIED TO THE DROP BADGE, AND MUST NOT BE RE-TIED TO IT. The badge
              is now a single winner (card-badges.tsx), so an urgent listing that also dropped
              shows no "-24%" chip — and this struck price is then the ONLY place the card states
              the drop. `hasDrop` is computed here, from prevPrice, exactly so this line survives
              a badge the overlay chose not to render.
              ⚠️ `whitespace-nowrap`, NOT `truncate`, AND THE ≈ CONVERSION STAYS. `truncate` is what
              produced "2,000,000…" — an anchor price is a NUMBER, and half a number is worse than no
              number, because a shopper reads the fragment as the real figure. Now that the row above
              wraps there is a full line for it, so it never needs clipping.
              ⛔ Do NOT "simplify" this by passing `dual={false}` to shorten it. It was tried and
              rejected on the same pass: for a viewer whose display currency is USD, <Price>'s first
              slot is the CONVERTED dollar figure and this second one holds the stored đồng price
              (price.tsx documents it) — so dropping the dual would leave a USD-only struck price,
              which ND 340/2025 makes sanctionable for a licensed Vietnamese marketplace. */}
          {hasDrop && (
            <Price price={listing.prevPrice!} currency={listing.currency} priceUnit="VND" compact className="whitespace-nowrap text-2xs font-medium text-ink-4 line-through" />
          )}
          {/* Below the market band (< P25) → a quiet "Good price" cue tied to the price.
              Deal-positive only; yields to a live price-drop so the two cheapness signals
              never stack. */}
          {listing.goodPrice && !hasDrop && (
            <Badge variant="success" className="shrink-0 self-center px-1.5 py-0.5 text-3xs">
              {tr('Good price', 'Giá tốt')}
            </Badge>
          )}
        </span>

        {/* SECONDARY — title. Medium weight + neutral ink so it never competes with the
            price above it. Two lines max, then ellipsis. */}
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground group-hover:underline decoration-1 underline-offset-2">
          {displayTitle}
        </h3>

        {/* TERTIARY — one subdued metadata line: condition · area · posted-ago · brand/model
            truncate on the left; business + trust cluster (shrink-0) on the right. Everything on
            the left shares ONE truncating span so the row can never wrap, and the last two facts
            are `sm:`-only (see the measurement below). Business is an icon-only store glyph
            (role=img so AT still announces it) to keep the row from wrapping on a narrow card. The
            "N contacted" demand count moved to the PDP — one fewer shrink-0 item keeps this line
            from overflowing on a 2-col mobile card, and reads cleaner. */}
        <div className="mt-auto flex items-center gap-1.5 pt-1 text-2xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {/* condition leads the line (owner, 2026-07-23) — the fastest signal a buyer scans
                for. Stored values are the two facet buckets 'new'/'used'; anything else shows
                as-is, and null (services/jobs, where condition is meaningless) drops out. */}
            {/* ⚠️ THE RELATIVE TIME AND THE BRAND/MODEL TERM SHARE ONE `sm:`-ONLY SPAN, BECAUSE A
                PHONE CARD HAS ROOM FOR EXACTLY TWO FACTS. The brand was dropped below `sm` first,
                for this reason: at the feed's two-column phone width the card is ~179px and this
                line is 11px, so condition + ward + brand·model truncated on essentially EVERY
                card ("Used · Ấp 43 · Samso…", "New · Tân Nhựt · Paris…"). A line that always ends
                in an ellipsis is not three facts, it is two facts and a smudge — and the smudge
                lands on the term the buyer can least act on, because brand is already visible in
                the title and available as a filter.
                MEASURED on the real feed before adding the time, at 390px: card 179px, this row
                175px, and after the trust chip (45px) + gap the truncating span gets 124px — 104px
                when the Business glyph renders. At 11px the Vietnamese lead "Đã dùng · Bình Thạnh"
                is ALREADY 108.4px, and the shortest possible VI relative time adds 55.1px
                (" · vừa xong"); the common " · 3 ngày trước" adds 71.1px. So a third fact does not
                fit at ANY phone width — it renders as the ward plus a fragment of the time
                ("… · 3 ngà"), i.e. the same smudge, on the signal the spec actually asked for.
                ⚠️ THAT MEASUREMENT IS ALSO WHY THIS ROW STAYS AT `text-2xs` (11px) AND WAS NOT
                RAISED TO 12px: at 12px the same VI lead is 118.3px against a 124px budget, so a
                business seller's card (104px) would begin truncating with no new content at all.
                The width has to be bought first — one fewer fact, or shorter VI time strings in
                timeAgo() — not borrowed against.
                ORDER: the time sits immediately after the area ("area · relative time") and BEFORE
                brand/model, so when the line does overflow at sm/md the ellipsis eats the brand
                first — it is repeated in the title above — rather than the freshness signal, which
                appears nowhere else on the card. That ordering is doing real work, because `sm:` is
                a VIEWPORT query and this card is also used in rails, which are narrower than the
                grid at the same width: measured at 768px, a rail card is 229px but leaves this span
                only 154px and 6 of 9 rows truncate — and they truncated BEFORE the time existed
                too (~187px needed without it). The overflow is pre-existing; what this ordering
                decides is which fact survives it. */}
            {/* ⚠️ EVERY SEPARATOR IS CONDITIONAL ON WHAT PRECEDES IT, NEVER A LITERAL. A first
                version emitted `{' · '}` inside the brand span, which strands a LEADING middot
                the moment the left side is empty — and the left side is empty exactly where the
                comment above says it can be: services and jobs, which have no condition, and rows
                with no ward. Those listings would have rendered "· Foo" at every width. A reviewer
                caught it. The rule survives the time being inserted: the sm-only span opens with a
                middot only when `lead` is non-empty, and the brand's own middot is safe
                unconditionally ONLY because the time is inside the same span and always renders.
                ⚠️ THAT LAST CLAIM IS LOAD-BEARING, SO HERE IS ITS PROOF rather than an assertion —
                two reviewers read `card-badges.tsx`'s defensive `!!listing.postedAt` as evidence
                the field is nullable, and it is not: `Listing.postedAt` is `DateTime
                @default(now())` (NOT NULL) in schema.prisma, and serialize.ts projects it as
                `l.postedAt.toISOString()`, which would throw long before a card rendered. Move the
                time out of this span, or make it conditional, and the brand's middot has to become
                conditional in the same edit. */}
            {(() => {
              const lead = [conditionLabel, displayLocation].filter(Boolean)
              const brand = [listing.brandSlug ? prettyBrand(listing.brandSlug) : null, listing.model].filter(Boolean)
              return (
                <>
                  {lead.join(' · ')}
                  <span className="hidden sm:inline">
                    {/* ⛔ MOUNT-GATED, AND ON THIS ROUTE THAT IS NOT A NICETY — IT IS THE DIFFERENCE
                        BETWEEN AN ISR PAGE AND A CLIENT-RENDERED ONE. `PostedAgo` derives its label
                        from the CLIENT clock, and `/` is ISR-cached for 6h with 12 of these cards
                        baked into the HTML (app/(home)/page.tsx revalidate=21600, take:12). So the
                        HTML says "· 3h ago" and a visitor five hours later computes "· 8h ago".
                        React 19 does not patch a text mismatch the way 18 did — it throws
                        HydrationMismatchException and recovers by CLIENT-RENDERING FROM THE NEAREST
                        SUSPENSE BOUNDARY. This route has no user boundary; the only one is Next's
                        segment boundary from (home)/loading.tsx, which encloses the header, the whole
                        feed and the footer. One stale label anywhere in it re-renders the entire
                        route — on essentially every cache hit, on the page whose LCP was taken from
                        5.4s to 1.57s. `useMounted` is the repo's own answer to exactly this and says
                        so in its docblock; live-until.tsx and pdp-shop-link.tsx both already use the
                        two-pass shape for client-time values, the latter after review caught it.
                        ⚠️ BOTH SEPARATORS ARE INSIDE THE GATE, and the first version of this got it
                        wrong in the most instructive way: it gated the time but left the LEADING
                        " · " outside, so a listing with a lead and no brand rendered
                        "Bình Thạnh · " — a dangling middot baked into the 6h HTML, seen by Googlebot
                        and by every no-JS visitor permanently. The comment right here claimed the
                        separator was gated while the line above it proved otherwise; all three
                        review families caught it independently. A separator belongs to the thing it
                        separates, so it lives or dies with it. */}
                    {/* Two rules, each naming what it separates, so no state can strand one:
                        · before TIME  — only once the time exists, and only if something precedes it
                        · before BRAND — if brand exists AND anything precedes it (lead, or the time) */}
                    {mounted && lead.length > 0 ? ' · ' : ''}
                    {mounted && <PostedAgo iso={listing.postedAt} />}
                    {brand.length > 0 && (mounted || lead.length > 0) ? ' · ' : ''}
                    {brand.length > 0 ? brand.join(' · ') : ''}
                  </span>
                </>
              )
            })()}
          </span>
          {/* ⚠️ THE GLYPH IS GONE, THE NAME MUST NOT BE. The seal was removed in favour of the
              gold ring on the image above (owner, 2026-08-11). A ring cannot be announced and
              cannot be seen as gold by every reader, so the status stays here as text — and
              this row is the only place on a feed card where it can live. Partner still
              outranks and suppresses the plain Business glyph, exactly as before. */}
          {listing.seller.officialPartner ? (
            <span className="sr-only">{tr('Official partner', 'Đối tác chính thức')}</span>
          ) : listing.seller.isBusiness && (
            <span role="img" title={tr('Business', 'Doanh nghiệp')} aria-label={tr('Business', 'Doanh nghiệp')} className="inline-flex shrink-0 items-center">
              <Building2 className="h-3.5 w-3.5" />
            </span>
          )}
          {/* ⚠️ PARTNER REPLACES TRUST HERE (owner, 2026-08-13). An official partner shows the gold
              partner badge INSTEAD of a trust score — the partner claim is the stronger of the two
              and showing both spends two chips on one point. Same swap in seller-card,
              pdp-shop-link and compact-listing-row, so a partner reads identically everywhere. */}
          {/* Mini chip (glyph + number) — display only; the card itself is the button. */}
          {listing.seller.officialPartner
            ? <PartnerBadge className="shrink-0" />
            : <TrustScore score={listing.seller.trustScore} variant="mini" className="shrink-0" />}
        </div>
      </div>
    </div>
  )
}

// Memoized: the homepage/explorer feed re-renders on every map hover/focus state
// change. With stable `onOpen`/`onLocate` callbacks from the parent (useCallback),
// memo lets unaffected cards skip re-render — kills the map-hover re-render storm
// across a long grid. Favorite/language changes still flow via context.
export const ListingCard = memo(ListingCardImpl)
