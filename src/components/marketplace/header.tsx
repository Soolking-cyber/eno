'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { User, Search, MapPin, Map, Clock, X } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { NotificationBell } from './notification-bell'
import type { Nearby, Geo } from './area-filter'
import { useSearchSuggest } from '@/hooks/use-search-suggest'
import { buildSuggestItems, type SuggestItem } from './search-suggest'
import { TrendingSearches } from './trending-searches'
import { useTrendingSearches } from '@/hooks/use-trending-searches'
import { searchPanels, trendingEnabled } from '@/lib/search-panel'
import { AISearchButton } from './ai-concierge'
import {
  useSuggestKeyboardNav, activeSuggestOptionId, visualSearchFromPaste,
  readRecentSearches, readRecentLocations, RECENT_LOCATIONS_KEY, type RecentLocation,
} from '@/hooks/use-search-box'
import { RECENT_SEARCHES_KEY } from '@/lib/reco-signals'
import { SITE_NAME } from '@/lib/edition'
import { STROKE_NAV } from '@/lib/icon-tokens'
// ⚠️ The rail's REAL open state, not a guess at it — see the logo's className below.
import { useAccountPanel } from './account-panel'
import { UiArt } from '@/components/marketplace/ui-art'

// The typeahead listbox this bar owns. Static (one Header per page), and distinct
// from the hero bar's so both can be in the DOM at once without id collisions.
const SUGGEST_ID = 'header-search-suggest'

// One uniform lucide stroke across the whole header, matching the bottom nav — a slightly
// thicker, identical weight reads softer and keeps every icon visually the same weight.
// Perf Phase 1: popover-only widgets load on demand — the suggest dropdown doesn't
// belong in the header's initial chunk. (The AreaFilter dynamic import that lived here
// was vestigial — nothing in the header could open it since the in-bar area pill moved
// to the facet bar; its chunk, state and render were removed in the icon pass.)
const SearchSuggest = dynamic(() => import('./search-suggest').then((m) => m.SearchSuggest), { ssr: false })

// STROKE_NAV = the platform weight for nav chrome (docs/icon-language.md §2), shared
// with the bottom nav so the two chrome bars carry one line weight.
const STROKE = STROKE_NAV

export function Header() {
  const { t, tr, lang } = useLanguage()
  const { user } = useAuth()
  // ⚠️ `open` IS THE RAIL'S OWN STATE, and the header logo hides on exactly it. Using `user`
  // instead left a hole all three reviewers found independently (2026-08-03): `user && lg:hidden`
  // hides via CSS the instant the session resolves, but the rail only mounts after
  // AccountPanelShell's matchMedia effect runs — so a signed-in desktop visitor had NO brand mark
  // at all during hydration, and none server-side either. Reading the same boolean the rail mounts
  // on makes the handover exact: the logo cannot leave the header before the rail has it.
  const { open: railOpen } = useAccountPanel()
  const pathname = usePathname()
  const router = useRouter()
  // Roll the bar up on scroll-down, back down on scroll-up — at EVERY width. The parenthetical
  // that used to sit here ("mobile only — desktop stays pinned via lg:translate-y-0") described a
  // class this file does not contain and has not for some time; the className below applies the
  // transform unconditionally, and its own comment says so. Corrected 2026-08-12 while wiring the
  // explorer's sort bar to this same state, where believing the stale version would have meant
  // building a desktop branch for a difference that does not exist.
  const hidden = useHideOnScroll()

  // Notch/Dynamic-Island handling for the installed PWA (and any web target with a real
  // safe-area inset). The prelaunch banner sits above the header and clears the notch
  // itself, so at the very top the header drops its own env(safe-area-inset-top) to avoid
  // a double gap. But the header is sticky: once the page scrolls past the banner it pins
  // to y=0 with nothing above it, so it must reclaim the inset or its content slides under
  // the camera pill. Toggle the .page-at-top class the CSS keys off (see globals.css).
  // On the native shell the banner is hidden entirely, and post-launch there's no banner —
  // in both cases the header keeps its inset unconditionally, so there's nothing to wire.
  useEffect(() => {
    const root = document.documentElement
    const isNative = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
    const banner = document.getElementById('prelaunch-banner')
    if (isNative || !banner) {
      root.classList.remove('page-at-top')
      return
    }
    let ticking = false
    const sync = () => {
      ticking = false
      // Banner still overlapping the top → it shields the notch; header inset off.
      root.classList.toggle('page-at-top', window.scrollY < banner.offsetHeight)
    }
    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(sync)
      }
    }
    // ⚠️ THE INITIAL SYNC RUNS IN A rAF, NOT INLINE — AND IT IS NOT OPTIONAL.
    // `sync()` reads `window.scrollY` and `banner.offsetHeight`; calling it here means calling it
    // inside React's commit, with the tree React just mutated still dirty, which forces a full
    // style+layout recalc. Measured on prod 2026-08-23 (headless chromium, mobile emulation, 4x CPU):
    // this site plus the two `useHideOnScroll` mounts and the virtual-keyboard initial sync were
    // 202.18 ms of the 314.01 ms total forced style+layout; deferring all four drops a 177 ms long
    // task to ~38 ms so it stops being a long task at all. Deferring only the OTHERS does not help —
    // the ~47 ms simply RELOCATES into this line, because whichever read hits the dirty tree first
    // pays for the whole recalc. That is why all four had to move together.
    // Safe because the pre-paint inline script in layout.tsx already adds `page-at-top` when
    // `!window.scrollY`, so the class is right from first paint on every top-of-page load; this pass
    // only corrects a load restored mid-scroll, one frame later, before anything can be perceived.
    const initialRaf = requestAnimationFrame(sync)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(initialRaf)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  // Explorer pages (home + category) mount the ListingsExplorer, which listens for
  // our search/district custom events. Elsewhere we navigate to the home explorer.
  const isExplorerPage = pathname === '/' || (pathname?.startsWith('/c/') ?? false)
  // Active-page indicator for the desktop header icons (mirrors the mobile bottom nav).

  // Chợ Tốt-style: the in-header search + area selector appear once the big hero
  // search pill scrolls out of view (or immediately on any page without a hero).
  // The explorer announces hero presence via the `eno:hero` event; while present we
  // watch it with an IntersectionObserver and reveal the header search on scroll-past.
  // ⚠️ STARTS TRUE, AND THAT IS AN SSR FIX, not a default (2026-08-03, all three reviewers).
  // It was `false`, and `setShowSearch(true)` only ever runs inside the effect below — so once the
  // hero search was deleted, the SERVER-RENDERED HTML and the first client paint contained NO
  // search bar anywhere on the page. That is worse than the old behaviour (the hero bar was in the
  // SSR markup), it is invisible to a crawler, it is permanent with JS disabled, and it pops the
  // bar in after hydration. Starting true means the bar is in the HTML; the effect below still
  // hides it if a page ever reintroduces `#eno-hero-search`.
  const [showSearch, setShowSearch] = useState(true)
  const [searchVal, setSearchVal] = useState('')

  /**
   * ⛔ THE FIRST-RUN TOUR TYPES INTO THIS INPUT, AND THIS IS THE ONLY DOOR IN. The tour demonstrates
   * a search by revealing a query character by character in the real search bar, and this input is
   * controlled state owned here — so without a listener the tour's only options were to fake a bar
   * on top of the real one, or to reach into the DOM and fight React for the value. Both are worse
   * than four lines.
   * ⚠️ IT SETS THE TEXT AND NOTHING ELSE. No focus, no suggestions panel, no submit: stealing focus
   * would take the keyboard from someone already typing (and on a phone would raise the keyboard
   * over the very results the tour is about to show), and the tour submits through the existing
   * `eno:search` path when it is ready. The suggestions panel opens `onFocus`, so leaving focus
   * alone is also what keeps it shut.
   * ⚠️ THE VISITOR ALWAYS WINS. `intro-tour.tsx` cancels its own typing on any real keystroke or
   * pointer press, so these two states cannot fight — but the tour is the only sender, and if that
   * ever stops being true this listener needs a guard of its own.
   */
  useEffect(() => {
    const onPreview = (e: Event) => setSearchVal(String((e as CustomEvent<{ text?: string }>).detail?.text ?? ''))
    window.addEventListener('eno:search-preview', onPreview)
    return () => window.removeEventListener('eno:search-preview', onPreview)
  }, [])
  // Quick-select suggestions (same store as the hero/in-explorer search): the user's
  // recent searches + recently-used areas, shown when the header search is focused.
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [recentLocations, setRecentLocations] = useState<RecentLocation[]>([])

  const searchFormRef = useRef<HTMLFormElement>(null)

  // Read fresh on focus so it reflects searches/areas made elsewhere this session
  // (`?? []` because a re-read must also RESET state when history was cleared).
  const openSuggestions = () => {
    setRecentSearches(readRecentSearches() ?? [])
    setRecentLocations(readRecentLocations() ?? [])
    setShowSuggestions(true)
  }

  // Retract the suggestions when clicking anywhere outside the search, or on Escape.
  useEffect(() => {
    if (!showSuggestions) return
    const onDown = (e: MouseEvent) => {
      if (searchFormRef.current && !searchFormRef.current.contains(e.target as Node)) setShowSuggestions(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSuggestions(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [showSuggestions])

  /**
   * The window is "open" (morph + panel) when focused with EITHER history to show (0-1 chars) OR
   * live instant-match results (>=2 chars). Otherwise it stays a normal pill (no flat-bottom).
   *
   * ⛔ BOTH RANGES AND THE FETCH GATE LIVE IN `lib/search-panel.ts`, TOGETHER AND TESTED, BECAUSE
   * THE BUG WAS THE GAP BETWEEN THEM. At exactly one character the whole dropdown used to vanish:
   * this panel wanted an EMPTY query and the instant panel wants two characters, so one character
   * satisfied NEITHER and the window blinked out and back in mid-word. Measured on a returning user
   * with history: 0 chars present -> 1 char ABSENT -> 2 chars present, and the same flash in reverse
   * while deleting. Every returning user who searches saw it, on every search.
   * ⚠️ It is invisible on a FIRST visit, which is why it survived so long: with no history and no
   * trending the panel is closed at 0 chars too, so the sequence is absent -> absent -> present and
   * nothing appears to flicker. Seed `eno:recent_searches` before testing this by hand — or just
   * read search-panel.test.ts, where 9 of 16 tests go red against the old rule.
   */
  const trending = useTrendingSearches(trendingEnabled(showSuggestions, searchVal))
  const { suggestOpen, instantOpen, panelOpen } = searchPanels(
    showSuggestions,
    searchVal,
    recentSearches.length > 0 || recentLocations.length > 0 || trending.length > 0,
  )

  // Instant matches (debounced typeahead) — brands + categories + listings, with the
  // 'Search for "{q}"' row ALWAYS first: Enter with no arrow-key selection submits the
  // raw free-text search (never a suggestion); arrow keys still navigate suggestions.
  const live = useSearchSuggest(searchVal, showSuggestions)
  const suggestItems = buildSuggestItems(searchVal, live.brands, live.categories, live.listings)
  // Arrow-key virtual focus + its aria-activedescendant announcement — shared with
  // the hero bar (see use-search-box.ts for the a11y contract).
  const { activeIdx, moveDown, moveUp } = useSuggestKeyboardNav(searchVal)
  const activeOptionId = activeSuggestOptionId(SUGGEST_ID, instantOpen, activeIdx, suggestItems.length)

  const pickSuggest = (it: SuggestItem) => {
    setShowSuggestions(false)
    if (it.type === 'query') { submitSearch(searchVal); return }
    if (it.type === 'brand') {
      // Open the brand's facets — the explorer resolves its dominant category.
      const url = `/?brand=${encodeURIComponent(it.slug)}`
      if (isExplorerPage) window.dispatchEvent(new CustomEvent('eno:apply-url', { detail: { url } }))
      else router.push(url)
      return
    }
    router.push(it.type === 'category' ? `/c/${it.slug}` : `/listings/${it.listing.id}`)
  }
  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!instantOpen || suggestItems.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); moveDown(suggestItems.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveUp() }
    else if (e.key === 'Enter' && activeIdx >= 0 && suggestItems[activeIdx]) { e.preventDefault(); pickSuggest(suggestItems[activeIdx]) }
  }

  // Seed the search box from the URL so a revealed search reflects the active query.
  useEffect(() => {
    if (typeof window === 'undefined') return
    setSearchVal(new URLSearchParams(window.location.search).get('q') || '')
  }, [pathname])

  // The explorer filters in place (history.replaceState, which Next's router can't
  // observe) — it broadcasts the active query so the persistent top bar stays in
  // sync (e.g. after tapping a recent-search chip on the landing hero).
  useEffect(() => {
    const onQuery = (e: Event) => setSearchVal((e as CustomEvent<{ query?: string }>).detail?.query ?? '')
    window.addEventListener('eno:query', onQuery)
    return () => window.removeEventListener('eno:query', onQuery)
  }, [])

  useEffect(() => {
    let io: IntersectionObserver | null = null
    const detach = () => { if (io) { io.disconnect(); io = null } }
    const attach = () => {
      detach()
      const el = document.getElementById('eno-hero-search')
      if (!el) { setShowSearch(true); return } // no hero on this page → show search now
      io = new IntersectionObserver(
        ([entry]) => setShowSearch(!entry.isIntersecting),
        { rootMargin: '-72px 0px 0px 0px' }, // reveal once the hero passes under the header
      )
      io.observe(el)
    }
    // The explorer announces hero presence on mount + whenever landing mode toggles.
    const onHero = (e: Event) => {
      const present = (e as CustomEvent<{ present?: boolean }>).detail?.present
      if (present) attach()
      else { detach(); setShowSearch(true) }
    }
    window.addEventListener('eno:hero', onHero)
    attach() // best-effort in case the hero is already in the DOM
    return () => { window.removeEventListener('eno:hero', onHero); detach() }
  }, [pathname])

  const submitSearch = (raw: string) => {
    const q = raw.trim()
    if (isExplorerPage) {
      window.dispatchEvent(new CustomEvent('eno:search', { detail: { query: q } }))
    } else {
      router.push(q ? `/?q=${encodeURIComponent(q)}` : '/')
    }
  }

  // Visual search → loose (any-word) match + detected category, so a photo returns the
  // closest items, not an exact-phrase match. On the explorer it hands off via event;
  // elsewhere it navigates with ?match=any (read by the explorer's param parser).
  const submitVisual = (r: { query: string; category?: string | null; brand?: string | null }) => {
    const q = (r.query || '').trim()
    if (!q) return
    if (isExplorerPage) {
      window.dispatchEvent(new CustomEvent('eno:visual-search', { detail: r }))
    } else {
      const p = new URLSearchParams({ q, match: 'any' })
      if (r.category) p.set('category', r.category)
      router.push(`/?${p.toString()}`)
    }
  }

  const applyArea = ({ province: p, ward: w, nearby: nb }: { province: Geo | null; ward: Geo | null; nearby: Nearby | null }) => {
    if (isExplorerPage) {
      window.dispatchEvent(new CustomEvent('eno:set-area', { detail: { province: p, ward: w, nearby: nb } }))
    } else {
      // One-shot handoff (audit P2): the explorer only hears LIVE eno:set-area events,
      // so a recent-location pick from a PDP/anywhere navigated home and silently
      // dropped the chosen area. Same consume-once sessionStorage idiom as
      // eno:video-return; the explorer applies it on mount.
      try { sessionStorage.setItem('eno:pending-area', JSON.stringify({ province: p, ward: w, nearby: nb })) } catch { /* storage blocked */ }
      router.push('/') // off the explorer: jump to the home feed
    }
  }

  return (
    <header
      id="app-header"
      className={cn(
        // FLAT header (owner 2026-07-17): the SAME background as the page canvas, separated only by a
        // hairline bottom LINE — NO shadow, no floating pill. The opaque bg covers content scrolling
        // under it; the balanced content padding (AccountPanelShell) already insets it clear of the
        // left nav rail, so it never needs a pill to avoid a collision.
        // The hairline lives on the inner max-w-7xl bar (below), not here — so it's cut to the
        // navbar's own length (owner 2026-07-17) instead of bleeding edge-to-edge across the viewport.
        //
        // ⚠️ `bg-background` HAS TWO REMOTE TWINS IN globals.css, and both must move with it:
        //   · `html.native-ios { background-color: var(--background) }` — in the iOS app the WebView
        //     rubber-bands for the native pull-to-refresh, and a sticky/fixed bar does NOT stay
        //     pinned through that bounce, so the drag uncovers the <html> canvas directly above this
        //     header. That rule exists solely to keep the two the same colour (it was --card until
        //     2026-07-21, which showed as a seam in dark mode on every pull-to-refresh).
        //   · `#status-bar-backdrop` — paints the notch strip for the moment this header auto-hides
        //     on scroll-down, and hardcodes var(--background) for the same reason.
        // Change the header's surface and those two are a REQUIRED part of the same change.
        // ⚠️ `translate`, NOT `transform` — AND THE HEADER HAS NEVER ACTUALLY SLID.
        // Tailwind v4 compiles `-translate-y-full` / `translate-y-0` to the STANDALONE `translate`
        // property (verified in the built CSS: `--tw-translate-y:-100%; translate:var(--tw-translate-x)
        // var(--tw-translate-y)`), not to `transform`. So this list subscribed to a property nothing
        // writes: the 64px bar jumped its whole height in ONE frame on every scroll-direction
        // reversal while only `opacity` tweened over 250ms. That mismatch is what the owner reported
        // as jitter, and it is the same v4 trap already documented at pdp-shop-link.tsx:135-137 and
        // in globals.css §motion — the note there computing a sub-pixel overshoot budget for this
        // slide was reasoning about an animation that was never running.
        // ⚠️ `ease-out` STAYS. globals.css explains why: this bar docks flush to the viewport edge,
        // so an overshooting spring opens a ~0.7px gap that shows the page sliding underneath. Now
        // that the tween actually happens, that rule finally has something to protect.
        'sticky top-0 z-40 bg-background pt-[env(safe-area-inset-top)] transition-[translate,opacity] duration-[var(--duration-sticky,250ms)] ease-out [will-change:translate,opacity] motion-reduce:transition-none',
        // Facebook-style on ALL sizes (incl. desktop): slide UP off-screen + fade out on
        // scroll-down, slide back down + fade in on scroll-up (near the top = always shown).
        hidden ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100',
      )}
    >
      {/* ⚠️ NO HORIZONTAL PADDING, DELIBERATELY — the logo and the action buttons sit flush to the
          bar's edges (owner, 2026-08-02: "logo and other buttons should have no padding on both
          sides"). This BREAKS FROM THE CANONICAL PAGE GUTTER on purpose: every other surface uses
          `max-w-7xl px-3 sm:px-6 lg:px-8` (docs/design-language.md), so the header's contents no
          longer align with the content column beneath them. That misalignment is the requested
          look, not an oversight — do not "fix" it by restoring the gutter.
          The border-b still spans the full max-w-7xl, so the hairline is unchanged. */}
      {/* ⚠️ PADDED ON MOBILE, FLUSH FROM sm UP — both halves are deliberate and they came from the
          owner in that order (2026-08-02 "logo and other buttons should have no padding on both
          sides", then "on mobile and app have some padding"). On a phone the mark and the action
          icons sat hard against the screen edge, which on iOS is where the swipe-back gesture and
          the rounded display corners live; from sm up there is room and the flush look is wanted.
          Still NOT the canonical page gutter (`px-3 sm:px-6 lg:px-8`, docs/design-language.md), so
          the header deliberately does not align with the content column beneath it — see the note
          on the logo below. Do not "restore" the gutter. */}
      {/* ⚠️ ALIGNED TO THE HERO BANNER — this SUPERSEDES the 2026-08-02 "no padding on both
          sides" instruction and the two notes above it (owner, 2026-08-07: the header
          "width should match banner width … the other banner below with 3 images", i.e.
          the hero carousel, not the full-bleed prelaunch strip). The hero renders at the
          canonical page gutter, measured 112→1328 at a 1440 viewport; the header was
          flush at 0→1440, so the logo and the action buttons hung outside the content
          column that starts directly beneath them. Using the SAME canonical frame here
          (`max-w-7xl px-3 sm:px-6 lg:px-8`, docs/design-language.md) makes the two edges
          share one line at every breakpoint. Do not restore the flush variant without the
          owner: it is the older instruction, not the current one. */}
      <div className="relative mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
        {/* ⚠️ THE HAIRLINE IS INSET TO THE CONTENT EDGES, not drawn on the padded box
            (owner, 2026-08-07: "match the line between top navbar and the banner — the line
            is sticking out"). A `border-b` on this container spans its BORDER box, which is
            the gutter wider than the hero banner beneath it (80→1360 vs 112→1328 at 1440),
            so the rule overhung the banner by one gutter on each side. Mirroring the px-*
            scale as inset-x-* lands the line exactly on the content column at every
            breakpoint. Keep the two scales in lockstep if either ever changes. */}
        <span aria-hidden className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-border/60 sm:inset-x-6 lg:inset-x-8" />
        {/* Logo */}
        <Link
          href="/"
          prefetch={false}
          onClick={() => window.dispatchEvent(new CustomEvent('eno:reset-home'))}
          // ⚠️ HIDDEN ON DESKTOP FOR SIGNED-IN USERS ONLY — the brand moved to the top of the left
          // rail (owner, 2026-08-03, Alibaba/QwenCloud layout: mark collapsed, mark + wordmark on
          // hover). It CANNOT be dropped outright: the rail renders only for a signed-in user at
          // ≥lg (see AccountPanelShell's media query), so a guest or anyone on a phone would be left
          // with no brand mark and no way home. `user && 'lg:hidden'` mirrors that exact condition —
          // change one and the other must follow, or the logo vanishes for people who have no rail.
            className={cn(
              'flex shrink-0 items-center transition-transform duration-200 ease-[var(--ease-spring-snappy)] hover:scale-110 active:scale-[0.96]',
              railOpen && 'lg:hidden',
            )}
          aria-label={SITE_NAME}
        >
          {/* The square "e" mark (owner, 2026-08-02), replacing the wide "eno.vn" lockup that lived
              here for one day.

              ⚠️ /logo-mark.svg, NOT the eno-e-mark.svg in the brand kit — they are the SAME mark but
              the brand-kit file is a rough auto-trace: 192 straight-line commands and zero curves,
              so its edges are visibly lumpy (rendered and compared side by side, 2026-08-02). This
              is the clean vector of it. The owner rejected the auto-trace once already for exactly
              this: "its jaggy need version with smooth like before smooth super crisp and sharp".

              ⚠️ NOT per-edition, unlike the lockup it replaced — and that is the point. "e" claims
              neither domain, so it is safe on eno.forum, which must never display the licensed
              marketplace's name. The footer has used this same file on both editions all along.

              Square: 1024×1024 intrinsic with h-8 w-8, so it reserves a 32×32 box before load (no
              CLS) and hands the header search back the ~65px the .vn lockup was taking on mobile. */}
          {/* h-12 = 48px, matching the header search pill's measured height exactly (owner,
              2026-08-02: "make logo mark as tall as the searchbar next to it"), so the two line up
              as one row instead of the mark floating small beside it. Square, so it costs 16px of
              width — the search form is `min-w-0 flex-1` and absorbs it. */}
          <img src="/logo-mark.svg?v=d88a7892" alt={SITE_NAME} width={1024} height={1024} className="h-12 w-12" />
          {/* ⚠️ NO TEXT WORDMARK BESIDE THE MARK — removed 2026-08-02 at the owner's request, one
              hour after being added. It was added on the theory that Google's "app name does not
              match" needed the name as PAINTED text somewhere above the fold (an <img alt> is never
              rendered, and both logo SVGs are <path> geometry with zero <text>). A later review of
              the live site pointed at a more likely cause — the "under construction / in test
              operation" banner plus the placeholder business-identity fields in the footer — so the
              text is not the load-bearing part and the header stays a clean mark.
              The name still appears on the page: the hero wordmark image, the sr-only <h1>, the
              <title>, og:site_name and the manifest. If the name complaint outlives the launch-
              readiness fixes, this span is the thing to restore. */}
        </Link>

        {showSearch ? (
          <form
            ref={searchFormRef}
            role="search"
            // ⚠️ A REAL GET TARGET, SO ENTER SEARCHES BEFORE REACT HYDRATES.
            // `onSubmit` preventDefaults, so once hydrated these never fire and behaviour is
            // unchanged — the explorer still handles the query via its event, with no document
            // navigation. They matter only in the window between first paint and hydration, where
            // the box is fully visible and looks ready: without an action and a field name, Enter
            // did nothing at all and the keystroke was silently lost.
            // Measured on the built artifact: dead at 0ms after DOMContentLoaded, working from
            // ~500ms. `/?q=…` is the same destination submitSearch() uses off the explorer, so the
            // unhydrated path lands exactly where the hydrated one would.
            // ⚠️ This works WITHOUT a submit button because the form has exactly ONE field that
            // blocks implicit submission (the search input; the Map and clear controls are
            // type="button" on purpose). Add a second text field and Enter stops submitting —
            // at which point this needs a visually-hidden submit button, not a shrug.
            action="/"
            method="get"
            // ⚠️ THE QUERY COMES FROM THE FIELD, NOT FROM REACT STATE, and that is a correctness
            // fix rather than a style choice. There is a window during hydration where the handler
            // is already attached but `searchVal` is still '' — React does not adopt text the user
            // typed into the SSR input before it attached its onChange. In that window the old
            // code preventDefaulted the native submit and then searched for an EMPTY string, so a
            // fast typist on a slow phone got "no results" for a query they had clearly typed.
            // That is worse than the dead-Enter it replaced: a dead key invites a retry, an empty
            // result set looks like an answer. Found by re-landing the home layout split, which
            // makes the header hydrate first and widens the window until it is reproducible.
            // The DOM value is authoritative in every state — it is literally what the user can
            // see in the box — and post-hydration it is identical to `searchVal`, so this changes
            // nothing once React owns the input. `searchVal` stays as the fallback for the
            // programmatic callers that submit without a form event.
            onSubmit={(e) => {
              e.preventDefault()
              const field = e.currentTarget.elements.namedItem('q')
              const typed = field instanceof HTMLInputElement ? field.value : null
              submitSearch(typed ?? searchVal)
              setShowSuggestions(false)
            }}
            className="relative min-w-0 flex-1 animate-in fade-in duration-200 ease-out"
          >
            {/* Positioning context for the whole search component. The form is `flex-1`, so the bar
                now stretches END TO END — from the eno wordmark to the action icons (owner 2026-07-17:
                dropped the old max-w-xl cap that centred it at 576px). `relative` makes THIS the offset
                parent for the `sm:absolute sm:inset-x-0` panels below, so the fused dropdown inherits
                this full width and the bar + panel read as one continuous rectangle. */}
            <div className="relative w-full">
            {/* Morphing search "window": a rounded pill when idle that flattens its
                bottom and fuses with the suggestions panel into one continuous white
                window when open (Google-style monolith). */}
            <div className={cn(
              'relative z-50 flex items-center transition-all duration-200 ease-out',
              panelOpen
                // Open = the fused search WINDOW (a panel, not an input): rounded-2xl to match the
                // suggestions panel it fuses with at sm+ (bottom flattened where they join), so the
                // fused silhouette is one consistent radius. The floating shadow is the standard
                // popover treatment for a layer over content — not canvas elevation.
                ? 'rounded-2xl bg-popover shadow-pop sm:rounded-b-none'
                // Idle = maximally seamless: rounded-2xl (matches the hero search pill + the fused-open
                // state, so there's no corner jump on open) and PURE bg-tint — zero border, zero ring,
                // and NO bg swap on focus (a white focus fill would merge into the bg-card header).
                // The only focus cue is the text caret. It's distinguished from the header solely by
                // the tint, exactly as requested.
                // `search-beam` — a brand-blue glow breathing inward from the edge while idle (globals.css).
                // ⚠️ IDLE ONLY, and that is why it is on this branch rather than the shared string:
                // once the panel is open the reader is already engaged and a moving edge competes
                // with the suggestions they came for.
                : 'search-beam rounded-2xl bg-tint',
            )}
            /* ⚠️ THE FIRST-RUN TOUR POINTS AT THIS ELEMENT (src/lib/intro-tour.ts, TOUR_TARGETS).
               A step whose anchor is missing is skipped, so removing this shortens the tour
               silently rather than breaking it — intro-tour.test.ts asserts both ends exist. */
            data-tour="search">
              {/* ⚠️ NEVER `lit`: this one is decoration inside the field, not a control that can be
                  chosen, so there is no pressed state for it to have. Grey is its only state. */}
              <UiArt name="search" className="pointer-events-none ml-3.5 h-6 w-6" />
              <Input
                variant="unstyled"
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                onFocus={openSuggestions}
                onKeyDown={onSearchKeyDown}
                onPaste={(e) => visualSearchFromPaste(e, tr, (r) => { setSearchVal(r.query); setShowSuggestions(false); submitVisual(r) })}
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                // Keyboard contract, identical to the hero bar's twin (listings-explorer's
                // #listings-search-input) — these were only on the hero, so the same query typed
                // into the header got autocapitalised + autocorrected on mobile: "iphone" became
                // "Iphone", and iOS "corrected" Vietnamese model names mid-word.
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                // Inside a chat thread, drop this out of the focus order so the composer is
                // the ONLY navigable form field — that greys out the iOS keyboard's prev/next
                // chevrons over the composer (the accessory bar's "Done" itself is a native
                // WKWebView feature the web can't remove). Still tap-usable elsewhere.
                tabIndex={pathname && /^\/messages\/.+/.test(pathname) ? -1 : undefined}
                // Named so the pre-hydration GET above actually carries the query.
                name="q"
                placeholder={tr('Find products…', 'Tìm sản phẩm…')}
                aria-label={tr('Search', 'Tìm kiếm')}
                // Combobox semantics for the typeahead the arrow keys already drive.
                // aria-expanded/-controls track `instantOpen` ONLY — the empty-focus
                // panel (recents/locations/trending) is not this listbox, and claiming
                // it is would point aria-controls at an element that isn't rendered.
                // Its chips are real, focusable buttons and are announced on their own.
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={instantOpen}
                aria-controls={instantOpen ? SUGGEST_ID : undefined}
                aria-activedescendant={activeOptionId}
                className="min-w-0 flex-1 bg-transparent py-3 pl-2 pr-2 text-base text-foreground outline-none placeholder:text-ink-4"
              />
              {/* De-crowd rule — keyed on ENGAGEMENT (suggest panel open), never on text
                  presence. searchVal persists after submit, so a value-based swap would hide
                  Map + AI on every results page — regressing the owner's 2026-08-03 mandate
                  ("add mapview back to searchbar in top navbar"); all three diff reviewers
                  flagged exactly that. While the panel is open the one affordance that
                  matters is clearing (✕ with text, nothing when empty — an empty slot also
                  means clearing can't land the next tap on ✨, the reviewer-caught mis-tap);
                  the pair returns on submit/blur/Escape, all of which close the panel.
                  h-6 per the §4 ladder — "header search/map/✕" share the 24px step. */}
              {showSuggestions ? (searchVal ? (
                <IconButton
                  size="md"
                  onClick={() => { setSearchVal(''); submitSearch('') }}
                  aria-label={tr('Clear search', 'Xóa tìm kiếm')}
                  // tap-48 overrides the IconButton's baked-in tap-44 (defined later in the sheet)
                  // for a 48px hit area — forgiving for kids / fast scrollers — with no size change.
                  className="mr-0.5 tap-48 text-ink-4 transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-[38px] w-[38px] shrink-0" strokeWidth={STROKE} />
                </IconButton>
              ) : null) : (
                <>
                  {/* AI shopping concierge — pressable: press to enter AI mode (duotone), press
                      again for normal search. Sits left of the map in every search bar. */}
                  <AISearchButton
                    active={pathname === '/messages/ai'}
                    onClick={() => { router.push('/messages/ai'); setShowSuggestions(false) }}
                    /* relative + tap-48 → a 48px hit area around the 40px visual (invisible ::before).
                       ⛔ mr-2, NOT mr-0.5, AND THE ARITHMETIC IS THE POINT: a 40px visual plus a 2px
                       margin is a 42px PITCH carrying a 48px hit area, so consecutive buttons'
                       ::before boxes overlapped by 6px and the later one won. Measured by sweeping
                       elementFromPoint across y=96 at 390px: this button owned only x=250..283 (34px,
                       under the 44px minimum) while Map owned 284..331 — so a tap on the AI button's
                       own right edge opened the map. mr-2 makes the pitch 48px, exactly the hit area. */
                    /* ⚠️ ml-2 AS WELL: mr-2 alone only cleared the RIGHT neighbour. The 48px pseudo
                       still overhung the search input on the left, which owns those pixels, so this
                       button measured 38px — under the 44px minimum. Margin on both sides gives the
                       hit area room in both directions. */
                    className="relative ml-2 mr-2 h-10 w-10 tap-48"
                  />
                  {/* ⚠️ MAP VIEW, BACK IN THE BAR (owner, 2026-08-03: "add mapview back to searchbar in
                      top navbar, inside to the right of ai search icon"). It lived in the hero search
                      that was deleted when the bar moved up here, so the entry point vanished with it —
                      this restores the same action in its new home.
                      Dispatches `eno:view-map` rather than calling setViewMode: the header is a SIBLING
                      of the explorer, not its parent, and the explorer already listens for the header's
                      other search events. Off an explorer page it routes home with ?view=map instead, so
                      the button never dead-ends. Icon weight matches the magnifier and the ✨ beside it
                      (STROKE_NAV) — the search-bar icon standard. Hover is a colour move only
                      (icon-language §8: scale-on-hover belongs to tile glyphs, not chrome). */}
                  <Button
                    // ⚠️ type="button" IS LOAD-BEARING — this sits inside the search <form> (line ~358)
                    // and ui/button sets no default type, so without it the browser treats it as
                    // type="submit": tapping Map would ALSO submit the search, racing the map action
                    // against a query navigation. codex caught this; the failure is intermittent and
                    // would have read as "the map button sometimes just searches instead".
                    type="button"
                    variant="bare"
                    size="none"
                    onClick={() => {
                      setShowSuggestions(false)
                      if (isExplorerPage) window.dispatchEvent(new CustomEvent('eno:view-map'))
                      else router.push('/?view=map')
                    }}
                    aria-label={tr('Map', 'Bản đồ')}
                    title={tr('Map', 'Bản đồ')}
                    className="relative mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-4 tap-48 transition-[color,scale] duration-200 ease-[var(--ease-spring-snappy)] hover:text-accent-foreground active:scale-[0.96] cursor-pointer"
                  >
                    <UiArt name="map" className="h-6 w-6" />
                  </Button>
                </>
              )}
              {/* Photo search folded into the AI assistant (✨ → camera in the chat
                  composer) — one smart entry point, less icon crowding. Pasting an
                  image into this bar still visual-searches (handler above). */}
            </div>

            {/* Recent searches + recent locations — flush bottom of the same window */}
            {suggestOpen && (
              <>
                <div className="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+3.75rem)] z-50 space-y-4 rounded-2xl bg-popover p-4 shadow-pop animate-in fade-in slide-in-from-top-1 duration-100 ease-out sm:absolute sm:inset-x-0 sm:top-full sm:-mt-px sm:rounded-t-none sm:rounded-b-2xl">
                  {recentSearches.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        {/* Micro-meta eyebrow icons ride the UI tier (lucide default 2) — STROKE_NAV
                            is reserved for h-6/h-7 chrome (§2); 2.25 at 12px reads smudged. */}
                        <span className="flex items-center gap-1 text-2xs font-bold uppercase tracking-wider text-muted-foreground"><Clock className="h-3 w-3" />{tr('Recent', 'Tìm gần đây')}</span>
                        <Button variant="bare" size="none" type="button" onClick={() => { localStorage.removeItem(RECENT_SEARCHES_KEY); setRecentSearches([]) }} className="text-2xs font-semibold text-muted-foreground hover:text-destructive cursor-pointer">{tr('Clear', 'Xóa')}</Button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {recentSearches.map((term, i) => (
                          <Button
                            key={i}
                            variant="soft"
                            size="none"
                            type="button"
                            onClick={() => { setSearchVal(term); submitSearch(term); setShowSuggestions(false) }}
                            className="whitespace-normal rounded-xl px-3.5 py-2 text-sm font-semibold text-body hover:text-accent-foreground cursor-pointer"
                          >
                            {term}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  {recentLocations.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-2xs font-bold uppercase tracking-wider text-muted-foreground"><MapPin className="h-3 w-3" />{tr('Recent locations', 'Khu vực gần đây')}</span>
                        <Button variant="bare" size="none" type="button" onClick={() => { localStorage.removeItem(RECENT_LOCATIONS_KEY); setRecentLocations([]) }} className="text-2xs font-semibold text-muted-foreground hover:text-destructive cursor-pointer">{tr('Clear', 'Xóa')}</Button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {recentLocations.map((loc, i) => (
                          <Button
                            key={i}
                            variant="soft"
                            size="none"
                            type="button"
                            onClick={() => { applyArea({ province: loc.province, ward: loc.ward, nearby: null }); setShowSuggestions(false) }}
                            className="whitespace-normal gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-body hover:text-accent-foreground cursor-pointer"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                            {loc.ward ? (lang === 'vi' ? loc.ward.name : loc.ward.nameEn) : (lang === 'vi' ? loc.province.name : loc.province.nameEn)}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Trending searches — hottest committed queries site-wide; hidden
                      when unavailable. Shared component (mobile + desktop, header + hero). */}
                  <TrendingSearches
                    items={trending}
                    variant="header"
                    onPick={(term) => { setSearchVal(term); submitSearch(term); setShowSuggestions(false) }}
                  />
                </div>
              </>
            )}

            {/* Instant matches — live listings + categories as you type (≥2 chars) */}
            {instantOpen && (
              <div className="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+3.75rem)] z-50 max-h-[70vh] overflow-y-auto rounded-2xl bg-popover p-3 shadow-pop animate-in fade-in slide-in-from-top-1 duration-100 ease-out sm:absolute sm:inset-x-0 sm:top-full sm:-mt-px sm:rounded-t-none sm:rounded-b-2xl">
                <SearchSuggest
                  items={suggestItems}
                  loading={live.loading}
                  query={searchVal}
                  activeIndex={activeIdx}
                  listboxId={SUGGEST_ID}
                  onPick={pickSuggest}
                  onSubmitQuery={() => { submitSearch(searchVal); setShowSuggestions(false) }}
                />
              </div>
            )}
            </div>
          </form>
        ) : (
          <div className="flex-1" />
        )}

        {/* Actions. The notification bell shows on ALL sizes (top-right, per the
            Chợ Tốt pattern); account + Post are desktop-only (mobile uses the bottom nav). */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Saved + Messages live in the LEFT nav rail (desktop) / bottom nav (mobile) for signed-in
              users — removed from here (owner 2026-07-18) so the top bar doesn't duplicate them. */}
          <NotificationBell />
          {/* Signed-in users reach their account via the persistent LEFT nav rail (desktop) / the
              bottom-nav Account tab (mobile/tablet) — no header avatar (owner 2026-07-17). Guests
              still get a Sign in link here. */}
          {!user && (
            <Link
              href="/signin"
              prefetch={false}
              /* ⚠️ THE ONLY HEADER CONTROL WITH NO PRESS RESPONSE UNTIL NOW — measured against its
                 own neighbours: 0 of 7,872 pixels changed under a held pointer, while /post moved
                 1,120px, the logo 727, the bell 409, AI 187 and Map 212, all at scale ~0.96.
                 ⚠️ AND THE `hover:bg-accent` DEFENCE DOES NOT COVER TOUCH: Tailwind gates `hover:`
                 behind `@media (hover: hover)`, and this link renders from `sm` up — which includes
                 touch tablets, where it therefore had no feedback at all. */
              className="hidden sm:flex items-center gap-1.5 rounded-xl px-2.5 h-9 text-sm font-semibold text-body transition-[color,background-color,scale] hover:bg-accent hover:text-accent-foreground active:scale-[0.97] active:duration-[60ms] cursor-pointer tap-48 relative"
              aria-label={tr('Sign in', 'Đăng nhập')}
            >
              <UiArt name="user" className="h-6 w-6 sm:h-7 sm:w-7" />
              <span className="hidden lg:inline">{tr('Log in', 'Đăng nhập')}</span>
            </Link>
          )}

          {/* Desktop only: mobile/tablet get the bottom-nav "+" Post button instead. Hide via a
              WRAPPER, not on the button — `<Button asChild>` (Radix Slot) concatenates the
              Button's base `inline-flex` onto the child WITHOUT tailwind-merge, so any display
              utility on the button itself (hidden / mobile:hidden) loses to `inline-flex`. The
              wrapper has no competing display, so mobile:hidden reliably hides it; pc:contents
              keeps the button a direct flex child on desktop (zero layout change). */}
          <div className="mobile:hidden pc:contents">
            {/* gap/weight ride on the BUTTON: asChild composes through Base UI's render
                prop, which CONCATENATES classNames — only the Button's own className is
                twMerged. On the child these were decided by stylesheet order instead of
                intent (base gap-2 beat the child's gap-1.5). */}
            <Button asChild variant="cta" size="none" className="gap-1.5 font-semibold">
              <Link
                href={user ? '/dashboard?tab=post' : '/post'}
                prefetch={false}
                className="px-4 py-2 text-sm inline-flex cursor-pointer"
              >
                {t('header.postBtn')}
              </Link>
            </Button>
          </div>
        </div>
      </div>

    </header>
  )
}
