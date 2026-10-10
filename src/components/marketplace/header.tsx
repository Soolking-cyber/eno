'use client'
import { categoryFromPath, explorerMounted, explorerFallbackUrl } from '@/lib/explorer-presence'
import { categoryHasMap } from './map-pin-rows'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { User, Search, MapPin, Map, Clock, X, ChevronLeftIcon, LayoutGrid, Sparkles, Heart } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { preloadSignIn, useAuth } from '@/context/auth-context'
import { useFavoriteCount } from '@/context/favorites-context'
import { useSafeBack } from '@/lib/safe-back'
import { useBackToClose } from '@/lib/back-to-close'
import { LANG_VARIANTS, variantOfLanguage } from '@/lib/lang-variant'
import { hereVariant, localizedHref } from '@/lib/lang-pinned'
import { categoryEntryLabel } from '@/lib/category-entry-label'
import { isPostFlowPath } from '@/lib/post-flow-path'
import { useIsPhone } from '@/hooks/use-is-phone'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { NotificationBell } from './notification-bell'
import { AppDownload } from './app-download'
import type { Nearby, Geo } from './area-filter'
import { useSearchSuggest } from '@/hooks/use-search-suggest'
import { buildSuggestItems, type PanelSuggestItem } from './search-suggest'
import { TrendingSearches } from './trending-searches'
import { useTrendingPanel } from '@/hooks/use-trending-searches'
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

// The typeahead listbox this bar owns. Static (one Header per page), and distinct
// from the hero bar's so both can be in the DOM at once without id collisions.
const SUGGEST_ID = 'header-search-suggest'
// The empty-focus panel's list names (its eyebrows) — static for the same reason.
const RECENT_LABEL_ID = 'header-search-recent'
const CATEGORIES_LABEL_ID = 'header-search-categories'

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

/**
 * ⚠️ "HAS THIS DOCUMENT HYDRATED", AS A STORE RATHER THAN A mounted-EFFECT. The sign-in link's
 * `?next=` cannot trust the SERVER's pathname: a prerendered page is built as `/en/help` and served
 * at `/help` by the proxy's rewrite, so usePathname() disagrees between the build render and the
 * browser (mobile-nav.tsx's `mounted` note measured the same trap as React #418), and the href spells
 * the path out. The server snapshot is `false`, so SSR and the hydration pass render the path-free
 * fallback; the client snapshot is `true`, so a Header that mounts on a later CLIENT navigation
 * renders the real thing on its first frame. A per-mount `useState(false)` would flash the fallback on
 * every page change instead.
 */
const noopSubscribe = () => () => {}

/**
 * Could a press on this element navigate (or commit something)? A link, a button, any control — and ANY
 * listing card (`data-card-root`, on every <ListingCard>): a rail card opens from its PHOTO's own click
 * handler, and the card's link is that photo's sibling, not its ancestor (review). The search panel's
 * outside-press handler RELEASES its history entry for these instead of popping it (see
 * `releaseSearchPanel`) — an asynchronous pop would race the navigation; a press on bare page pops it.
 */
const MAY_NAVIGATE = 'a[href],button,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="switch"],[role="option"],input,select,textarea,label,summary,[data-feed-card],[data-card-root]'
function mayNavigate(t: EventTarget | null): boolean {
  return t instanceof Element && !!t.closest(MAY_NAVIGATE) && !t.closest('[data-header-back]')
}

/**
 * ⚠️ HOME, AS A TEST THAT AGREES ON BOTH SIDES OF THE REWRITE. The installed-PWA Back button needs
 * only "is this home", not the path itself, so it can render on the server with no hydration gate
 * (which cost a logo→Back swap after hydration in standalone). The proxy maps the public `/` to
 * `/en` or `/vi`, and every other public path P to `/<variant>P`, which is never one of those three.
 * So the server's pathname, internal or public, and the browser's always give the same answer. The
 * one public `/en` or `/vi` is a force-dynamic 404, whose server pathname stays public.
 */
const HOME_PATHS = new Set(['/', ...LANG_VARIANTS.map((v) => `/${v}`)])

/**
 * THE POST FLOW'S OWN PAGES — /post and /listings/<id>/edit. Like HOME_PATHS, a test that agrees on
 * both sides of the proxy's rewrite, so the header decides at RENDER time with no hydration gate.
 * It lives in lib/post-flow-path.ts now (the footer and the support FAB ask the same question, O-30);
 * re-exported here for the callers that already import it from the header.
 */
export { isPostFlowPath }

export function Header() {
  const { t, tr, lang } = useLanguage()
  // The server variant this page renders in: every explorer-bound link goes to its `/vi` twin on a
  // Vietnamese page, so a search, brand pick or map tap never lands on the English-pinned `/?…`
  // (A1-LANG, field-01). Identity for English and for any target outside the live pilot list.
  const variant = variantOfLanguage(lang)
  // What a HANDLER navigates with: the same, except on a storefront's own host (`<label>.eno.vn` — the
  // header renders there too), which has no pilot: a `/vi…` target would bounce to the apex and out of the
  // shop (src/proxy.ts), while the plain `/?…` is that shop's own explorer, in the reader's language — what
  // a search there always opened (lang-pinned.ts hereVariant). Asked at click time only, so SSR and
  // hydration never see the host.
  const navVariant = () => hereVariant(variant)
  const { user, openSignIn } = useAuth()
  // The guest's saved count for the desktop heart (NAV-7) — device-local, 0 until it hydrates (client-only).
  const savedCount = useFavoriteCount()
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)
  // ⚠️ `open` IS THE RAIL'S OWN STATE, and the header logo hides on exactly it. Using `user`
  // instead left a hole all three reviewers found independently (2026-08-03): `user && lg:hidden`
  // hides via CSS the instant the session resolves, but the rail only mounts after
  // AccountPanelShell's matchMedia effect runs — so a signed-in desktop visitor had NO brand mark
  // at all during hydration, and none server-side either. Reading the same boolean the rail mounts
  // on makes the handover exact: the logo cannot leave the header before the rail has it.
  const { open: railOpen } = useAccountPanel()
  const pathname = usePathname()
  const router = useRouter()
  // Installed-PWA Back (see the button before the logo): pop when there is an in-app entry behind
  // us, else land home — safe-back.ts owns the cold-start and double-tap cases.
  const onBack = useSafeBack('/')
  // Anywhere but the home feed. The explorer filters '/' in place with replaceState, so on '/' there
  // is nothing of its own to pop. NOT hydration-gated: see HOME_PATHS. So a standalone first paint
  // already shows Back, not the logo it replaces.
  const backable = !!pathname && !HOME_PATHS.has(pathname)
  // The sign-in link's `?next=` spells the path out, so it IS gated (see `hydrated`).
  const offHome = hydrated && backable
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

  // ⛔ ASK, DON'T GUESS FROM THE PATH. The ListingsExplorer listens for our search/area/map events;
  // where it is not mounted we navigate to the home explorer instead (keeping a /c/<category> page's
  // category — see explorer-presence.ts). Deciding by pathname sent every /c/* page's search into
  // the void: those pages never mounted the explorer. Evaluated at ACTION time, not render time.
  const onExplorer = () => explorerMounted()
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
   * ⛔ THE `eno:search-preview` LISTENER IS GONE WITH THE TOUR THAT WAS ITS ONLY SENDER (owner,
   * 2026-09-16: "remove onboarding autoplay where it shows top seach bar and taps the category brand
   * too jittery"). It existed so the first-run tour could reveal a query character by character in
   * THIS input — `searchVal` is controlled state owned here, so the alternatives were faking a second
   * bar or fighting React for the DOM value. Nothing dispatches that event any more; re-add the four
   * lines with the sender if a demo search ever comes back.
   */
  // Quick-select suggestions (same store as the hero/in-explorer search): the user's
  // recent searches + recently-used areas, shown when the header search is focused.
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [recentLocations, setRecentLocations] = useState<RecentLocation[]>([])

  const searchFormRef = useRef<HTMLFormElement>(null)
  // The panel hook's `release` (declared further down, where `panelOpen` is known), for the outside-press
  // handler registered above it. Synced in an effect beside the hook, never assigned during render.
  const releaseSearchRef = useRef<() => void>(() => {})

  /**
   * ⛔ TEXT TYPED BEFORE HYDRATION USED TO BE WIPED ~40ms AFTER IT. React leaves a controlled input's
   * DOM value alone while hydrating (react-dom initInput: `isHydrating || … element.value = value`),
   * but every later render runs updateInput with `searchVal` and writes it over the field — and
   * `searchVal` was '' (no onChange fires before React owns the input), then the URL-seeding effect
   * below set it to '' again explicitly. So a query typed on a slow phone vanished, and Enter
   * searched for nothing even though the 05b84816 submit fix reads the DOM: by then the DOM was ''.
   * Found by CI 2026-09-27 (/c/vehicles: fill('bicycle') then Enter landed on /?category=vehicles
   * with no q) and traced write-by-write on a fixture build. TWO halves, both needed: this layout
   * effect adopts the typed text before the first re-render can overwrite it, and the seeding effect
   * does not clobber it on its first run, whatever the URL's q. e2e/ci pins it deterministically
   * by holding the JS chunks until the field is filled (fails 5/5 without, passes 25/25 with).
   */
  useLayoutEffect(() => {
    const field = searchFormRef.current?.elements.namedItem('q')
    if (field instanceof HTMLInputElement && field.value) setSearchVal(field.value)
  }, [])

  // Read fresh on focus so it reflects searches/areas made elsewhere this session
  // (`?? []` because a re-read must also RESET state when history was cleared).
  const openSuggestions = () => {
    // Only strings: the stored list is unvalidated JSON (use-search-box.ts), and these become rows.
    const recent = readRecentSearches()
    setRecentSearches(Array.isArray(recent) ? recent.filter((t): t is string => typeof t === 'string') : [])
    setRecentLocations(readRecentLocations() ?? [])
    setShowSuggestions(true)
  }

  // Retract the suggestions when clicking anywhere outside the search, on Escape, or when focus
  // moves to anything outside the search form.
  useEffect(() => {
    if (!showSuggestions) return
    const outside = (t: EventTarget | null) => !!searchFormRef.current && !searchFormRef.current.contains(t as Node)
    // ⛔ A PRESS OUTSIDE ON A CONTROL MAY BE A NAVIGATION (a card, a tab, a link) — the panel's history entry is
    // RELEASED, not popped: an asynchronous `history.back()` would land after that navigation's push and undo
    // it (src/lib/back-to-close.ts). A press on bare page is a plain dismissal and pops it. Phone only (the hook).
    // ⚠️ THE HEADER'S OWN BACK IS NOT A NAVIGATION THAT PUSHES (opus, gate 2026-10-05): it is a traversal, so the
    // close pops the panel's entry and its click then goes back, like the system Back. Released, its first tap
    // only popped that same-URL entry and looked dead (mayNavigate excludes `data-header-back`).
    const onDown = (e: MouseEvent) => {
      if (!outside(e.target)) return
      if (mayNavigate(e.target)) releaseSearchRef.current()
      setShowSuggestions(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSuggestions(false) }
    /**
     * ⛔ TAB USED TO LEAVE THE PANEL OPEN OVER THE PAGE (D-KEYBOARD, S-TYPEAHEAD, measured headless on
     * production 2026-09-29: six Tabs later focus sat on "Search all listings" and the fixed panel was
     * still drawn on top of it). Only a mousedown outside or Escape closed it.
     * ⚠️ `focusin` ON THE DOCUMENT, NOT `blur`/`focusout` ON THE FORM, AND THAT IS THE SAFARI TRAP.
     * Safari does not focus a tapped <button>, so tapping a chip blurs the input with a null
     * relatedTarget — a blur handler cannot tell that from "focus left", closes the panel, and the
     * chip unmounts before its click fires (the same happens in Chrome for a press on the panel's own
     * padding). `focusin` only fires when something ELSE RECEIVES focus: a Tab to the bell, a click on
     * a link or a field elsewhere. Focus that goes nowhere fires nothing, and the mousedown handler
     * above already covers a press outside. Focus moving WITHIN the form (the panel's rows, chips and
     * ✕ buttons live inside it) is ignored by the same containment test.
     */
    const onFocusIn = (e: FocusEvent) => { if (outside(e.target)) setShowSuggestions(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [showSuggestions])

  /**
   * One recent search, forgotten — the row's ✕. The panel stays open and the caret stays in the
   * field: the ✕ holds focus off itself (mousedown preventDefault) and this puts it back for a
   * keyboard press, so removing three stale terms is three taps, not three re-opens.
   * The last term out removes the key, exactly as Clear does.
   */
  const removeRecent = (term: string) => {
    const next = recentSearches.filter((x) => x !== term)
    try {
      if (next.length) localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next))
      else localStorage.removeItem(RECENT_SEARCHES_KEY)
    } catch { /* storage blocked — the row still goes for this visit */ }
    setRecentSearches(next)
    const field = searchFormRef.current?.elements.namedItem('q')
    if (field instanceof HTMLInputElement) field.focus()
  }

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
  // Trending terms AND the category shortcuts — one fetch, one memo (use-trending-searches.ts).
  const { items: trending, categories: shortcutCategories } = useTrendingPanel(trendingEnabled(showSuggestions, searchVal))
  /**
   * ⛔ BELOW 640px ✨ AND MAP LIVE IN THE FOCUS PANEL, NOT IN THE PILL (owner, O-03 G-SEARCH Option A,
   * 2026-09-30 — reverses the 2026-08-03 "add mapview back to searchbar" mandate ON PHONES ONLY; desktop
   * and tablets are unchanged). In the pill they cost the field 104px, which left a phone's idle box
   * 30–82px of text room (Android, "Get the app" shown) — "Find pr…" on every phone. Out of the pill,
   * the box reads as a search box, and the two actions become the panel's first two rows the moment the
   * field is touched, which is also the moment someone is deciding HOW to look.
   * ⚠️ THE PILL SIDE IS CSS (`hidden sm:flex` on both buttons), so the server HTML is already right on a
   * phone — no paint-then-hide. Only the PANEL side asks JS, and only after a focus, which is always
   * after hydration: `isPhone` is false on the server snapshot and the panel is never in the SSR HTML.
   * ⚠️ `isPhone` COUNTS AS CONTENT for the history panel, so on a phone the panel opens on the first
   * tap even for a first visit with no history and trending not yet landed — the rows ARE its content.
   */
  const isPhone = useIsPhone()
  const { suggestOpen, instantOpen, panelOpen } = searchPanels(
    showSuggestions,
    searchVal,
    // ⚠️ The category shortcuts count: they are what a FIRST visit sees — no history, and trending
    // needs three distinct searchers before it shows a term at all.
    recentSearches.length > 0 || recentLocations.length > 0 || trending.length > 0 || shortcutCategories.length > 0 || isPhone,
  )
  /**
   * ⛔ BACK CLOSES THE PHONE SEARCH PANEL (UX3 NAV-1, src/lib/back-to-close.ts). Below 640px the panel is a
   * fixed layer over the page, and Back went straight through it and off the page. It now owns one history
   * entry while open: Back closes it; ✕ / Escape / a press on bare page pops the entry again.
   * ⚠️ AN ACTION THAT NAVIGATES RELEASES FIRST (`releaseSearchPanel()` right before every router.push and on
   * the category links): an asynchronous `history.back()` would land after that navigation and undo it.
   * Released, the entry is replaced by the page the action opens, so Back from there comes straight back
   * here. An action ON the explorer (a search, a facet pick, the map, an area) does not release: the
   * explorer commits it in the same commit and takes the entry over itself (or, when it changed nothing,
   * the untouched entry is popped). From sm the panel is a dropdown, not a layer, and keeps no entry.
   * ⚠️ Back closes the panel with the field still focused, and the panel opens on FOCUS — so the field is
   * blurred too, or tapping it again would fire nothing and show nothing (review).
   */
  const { release: releaseSearchPanel } = useBackToClose(isPhone && panelOpen, () => {
    setShowSuggestions(false)
    const field = searchFormRef.current?.elements.namedItem('q')
    if (field instanceof HTMLInputElement) field.blur()
  }, 'search')
  useEffect(() => { releaseSearchRef.current = releaseSearchPanel }, [releaseSearchPanel])
  // The search window is ONE element for both panels (see its comment below), so it keeps its
  // scrollTop across the switch — two separate mounts used to start each panel at the top. Reset it
  // before paint when the contents switch, or the instant results open scrolled past their top rows.
  const searchWindowRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (searchWindowRef.current) searchWindowRef.current.scrollTop = 0
  }, [suggestOpen])

  /**
   * ⛔ THE PHONE PANEL HANGS FROM THE HEADER'S REAL BOTTOM EDGE, MEASURED — NOT FROM "THE HEADER IS AT y=0".
   * Below 640px the search window is `fixed`, and its top used to be the constant safe-area + 3.75rem: the
   * header's 64px less the 4px it tucks under the hairline. That holds only while nothing sits above the
   * header. An in-flow strip above it (the Terms-amendment notice, tos-change-notice.tsx, whenever an
   * amendment has a notice window and it is mounted; the pre-launch banner before it) pushes the sticky
   * header down by its own height at scroll-top, so the panel opened at
   * y=60 OVER the header's own search field — z-50 over z-40 — and a visitor who tapped search on landing
   * typed into an input the panel hid (2026-10-01 review). The window now publishes the measured edge as
   * `--search-panel-top`, and its top and max-height read that; the old constant stays as the fallback, so
   * with nothing above the header the geometry is byte-for-byte what it was (bottom 64 − 4 = 60) — the
   * state since 2026-10-01, when the strip was unmounted (an immediate amendment has nothing to announce).
   * Kept rather than reverted: it is exact with or without a strip, and the next one needs it.
   * Re-measured on scroll and resize while open: the header is sticky, so scrolling past the strip moves
   * it up under a `fixed` window. Only while open — this reads layout, and must not run on page load
   * (the forced-layout note on the .page-at-top effect above). From sm the window is `absolute`
   * `top-full` and the class ignores the variable; only its max-height still reads it, correctly.
   */
  const headerRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const win = searchWindowRef.current
    const bar = headerRef.current
    if (!panelOpen || !win || !bar) return
    let raf = 0
    const sync = () => {
      raf = 0
      win.style.setProperty('--search-panel-top', `${Math.max(Math.round(bar.getBoundingClientRect().bottom) - 4, 0)}px`)
    }
    const onMove = () => { if (!raf) raf = requestAnimationFrame(sync) }
    sync()
    window.addEventListener('scroll', onMove, { passive: true })
    window.addEventListener('resize', onMove)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onMove)
      window.removeEventListener('resize', onMove)
    }
  }, [panelOpen])

  // Instant matches (debounced typeahead) — brands + categories + listings, with the
  // 'Search for "{q}"' row ALWAYS first: Enter with no arrow-key selection submits the
  // raw free-text search (never a suggestion); arrow keys still navigate suggestions.
  const live = useSearchSuggest(searchVal, showSuggestions)
  const suggestItems = buildSuggestItems(searchVal, live.brands, live.categories, live.listings, live.lines, live.scope, live.didYouMean)
  // Arrow-key virtual focus + its aria-activedescendant announcement — shared with
  // the hero bar (see use-search-box.ts for the a11y contract).
  const { activeIdx, moveDown, moveUp } = useSuggestKeyboardNav(searchVal)
  const activeOptionId = activeSuggestOptionId(SUGGEST_ID, instantOpen, activeIdx, suggestItems.length)

  const pickSuggest = (it: PanelSuggestItem) => {
    setShowSuggestions(false)
    if (it.type === 'query') { submitSearch(searchVal); return }
    // A typo's likely spelling: the box takes the corrected words, and they are searched as typed.
    if (it.type === 'didYouMean') { setSearchVal(it.q); submitSearch(it.q); return }
    // A facet link: applied in place on the explorer (it filters with replaceState, so a push would
    // not reach it), navigated to anywhere else.
    const openUrl = (url: string) => {
      if (onExplorer()) window.dispatchEvent(new CustomEvent('eno:apply-url', { detail: { url } }))
      else { releaseSearchPanel(); router.push(url) }
    }
    // Open the brand's facets — the explorer resolves its dominant category.
    if (it.type === 'brand') { openUrl(localizedHref(`/?brand=${encodeURIComponent(it.slug)}`, navVariant())); return }
    /**
     * A product line, with the category most of it lives in. With a brand set, the explorer sends that
     * category as a boost (`priorityCategory`), not a filter, so the total is the row's count; it is in
     * the URL so the rail lights the right category on arrival instead of after the brand-heal fetch
     * (api/search/suggest/suggest-entities.ts).
     */
    if (it.type === 'line') {
      openUrl(localizedHref(`/?category=${encodeURIComponent(it.category)}&brand=${encodeURIComponent(it.brand)}&line=${encodeURIComponent(it.line)}`, navVariant()))
      return
    }
    // The query, in its aisle. The words stay the query, so the explorer's box shows them.
    if (it.type === 'scope') {
      openUrl(localizedHref(`/?q=${encodeURIComponent(searchVal.trim())}&category=${encodeURIComponent(it.category)}&subcategory=${encodeURIComponent(it.subcategory)}`, navVariant()))
      return
    }
    releaseSearchPanel()
    router.push(it.type === 'category' ? localizedHref(`/c/${it.slug}`, navVariant()) : `/listings/${it.listing.id}`)
  }
  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!instantOpen || suggestItems.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); moveDown(suggestItems.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveUp() }
    else if (e.key === 'Enter' && activeIdx >= 0 && suggestItems[activeIdx]) { e.preventDefault(); pickSuggest(suggestItems[activeIdx]) }
  }

  // Seed the search box from the URL so a revealed search reflects the active query.
  const urlSeededRef = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const fromUrl = new URLSearchParams(window.location.search).get('q') || ''
    // FIRST run only: text typed before hydration beats the URL (adopted above). The server always
    // renders this box EMPTY (`searchVal` starts ''), so any text in it now was typed by the user —
    // including over a results page's own ?q=, where re-seeding would undo their refinement (agy +
    // opus review). Later runs are navigations, where the URL is the truth and the box follows it.
    // One run is enough: reactStrictMode is false (next.config.ts), so effects do not replay.
    if (!urlSeededRef.current) {
      urlSeededRef.current = true
      const field = searchFormRef.current?.elements.namedItem('q')
      if (field instanceof HTMLInputElement && field.value) return
    }
    setSearchVal(fromUrl)
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
    if (onExplorer()) {
      window.dispatchEvent(new CustomEvent('eno:search', { detail: { query: q } }))
    } else {
      releaseSearchPanel() // a navigation — never popped behind it (see the hook above)
      router.push(explorerFallbackUrl(pathname, { q }, navVariant()))
    }
  }

  // Visual search → loose (any-word) match + detected category, so a photo returns the
  // closest items, not an exact-phrase match. On the explorer it hands off via event;
  // elsewhere it navigates with ?match=any (read by the explorer's param parser).
  const submitVisual = (r: { query: string; category?: string | null; brand?: string | null }) => {
    const q = (r.query || '').trim()
    if (!q) return
    if (onExplorer()) {
      window.dispatchEvent(new CustomEvent('eno:visual-search', { detail: r }))
    } else {
      releaseSearchPanel()
      // The photo's detected category wins; otherwise the landing page's own.
      router.push(explorerFallbackUrl(pathname, { q, match: 'any', ...(r.category ? { category: r.category } : {}) }, navVariant()))
    }
  }

  // The map view — the pill's Map button (sm+) and the phone panel's Map row (O-03) run the same action.
  // ⛔ A landing whose category has no map (/c/teachers — map-pin-rows.ts `categoryHasMap`) opens the MARKETPLACE map, not
  // its own: the category's map is always empty, and the explorer would show that feed's list instead — a Map press that
  // went nowhere (gate review, 2026-10-09). The explorer's `eno:view-map` answers the same way, so on and off it agree.
  const openMap = () => {
    setShowSuggestions(false)
    if (onExplorer()) window.dispatchEvent(new CustomEvent('eno:view-map'))
    else {
      releaseSearchPanel()
      router.push(explorerFallbackUrl(categoryHasMap(categoryFromPath(pathname)) ? pathname : null, { view: 'map' }, navVariant()))
    }
  }
  // The AI concierge — likewise the pill's ✨ (sm+) and the phone panel's first row.
  const openAi = () => { releaseSearchPanel(); router.push('/messages/ai'); setShowSuggestions(false) }

  const applyArea = ({ province: p, ward: w, nearby: nb }: { province: Geo | null; ward: Geo | null; nearby: Nearby | null }) => {
    if (onExplorer()) {
      window.dispatchEvent(new CustomEvent('eno:set-area', { detail: { province: p, ward: w, nearby: nb } }))
    } else {
      // One-shot handoff (audit P2): the explorer only hears LIVE eno:set-area events,
      // so a recent-location pick from a PDP/anywhere navigated home and silently
      // dropped the chosen area. Same consume-once sessionStorage idiom as
      // eno:video-return; the explorer applies it on mount.
      try { sessionStorage.setItem('eno:pending-area', JSON.stringify({ province: p, ward: w, nearby: nb })) } catch { /* storage blocked */ }
      releaseSearchPanel()
      router.push(explorerFallbackUrl(pathname, {}, navVariant())) // off the explorer: jump to the home feed (same category)
    }
  }

  /**
   * The placeholder ladder's container-query classes per language — see the note on the overlay in
   * the search field. Whole literals, so Tailwind sees every class it has to generate.
   */
  const placeholderFit =
    lang === 'vi'
      ? { overlay: 'peer-placeholder-shown:@min-[5.55em]/q:flex', long: '@min-[8.7em]/q:block', short: '@min-[8.7em]/q:hidden' }
      : lang === 'en'
        ? { overlay: 'peer-placeholder-shown:@min-[4.55em]/q:flex', long: '@min-[8.6em]/q:block', short: '@min-[8.6em]/q:hidden' }
        : { overlay: 'peer-placeholder-shown:@min-[15em]/q:flex', long: 'block', short: 'hidden' }

  return (
    <header
      ref={headerRef}
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
        {/* ⚠️ INSTALLED-PWA BACK — `display:none` IN A NORMAL TAB, AND THE DISPLAY MODE IS DECIDED BY CSS,
            NOT BY A RENDER BRANCH. manifest.ts installs the site as `display: standalone` (the owner's
            only iOS web-push route), which removes the browser's own Back, and nothing here replaced it:
            a PDP opened from a push notification was a dead end but for the tab bar. globals.css turns
            this on under `@media (display-mode: standalone)` (never in the native shells, which carry
            html.native) and hides the logo that follows it, so a normal tab paints exactly what it did
            before and nothing branches on display mode or hydration: `backable` agrees on server and
            client (HOME_PATHS), so the SSR HTML already carries the button.
            ChevronLeftIcon, NOT ChevronLeft: the header is on every page and only the former is in the
            core sprite (scripts/critical-icons.mjs). */}
        {backable && (
          <IconButton
            size="lg"
            onClick={onBack}
            data-header-back=""
            aria-label={tr('Back', 'Quay lại')}
            className="standalone-back hidden shrink-0 press tap-48 text-foreground"
          >
            <ChevronLeftIcon className="h-7 w-7" strokeWidth={STROKE} aria-hidden />
          </IconButton>
        )}
        {/* Logo */}
        <Link
          // The `/vi` pilot (SEO wave B, V3b): a Vietnamese page's logo goes to `/vi` once `/` is piloted —
          // the identity while the pilot is off (lang-pinned.ts localizedHref).
          href={localizedHref('/', variantOfLanguage(lang))}
          prefetch={false}
          data-header-logo=""
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
          <img src="/logo-mark.svg?v=2b609517" alt={SITE_NAME} width={1024} height={1024} className="h-12 w-12" />
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
            // A Vietnamese page submits to the `/vi` twin, not the English-pinned `/` (A1-LANG, field-01).
            // ⚠️ The server's variant, because this attribute is in the cached HTML; it is only ever used
            // BEFORE hydration — after it, onSubmit routes through submitSearch, which knows a shop's host.
            action={localizedHref('/', variant)}
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
            /* ⚠️ NO ENTRANCE ANIMATION HERE ON PURPOSE — it was `animate-in fade-in duration-200
               ease-out` and it was removed. This form is in the SSR HTML of every page, so the
               fade was not an entrance at all: it replayed on hydration and again on the first
               state change, making the header's most-seen element flicker on a load where nothing
               had appeared. An element that was already on screen has nothing to animate in. */
            className="relative min-w-0 flex-1"
          >
            {/* ⚠️ Before hydration Enter is a native GET to "/": on a /c/<category> landing page this
                keeps the category, so the unhydrated search lands where submitSearch() sends the
                hydrated one (explorerFallbackUrl). A hidden field does not block implicit submission. */}
            {categoryFromPath(pathname) ? <Input type="hidden" name="category" value={categoryFromPath(pathname) ?? ''} readOnly /> : null}
            {/* Positioning context for the whole search component. The form is `flex-1`, so the bar
                now stretches END TO END — from the eno wordmark to the action icons (owner 2026-07-17:
                dropped the old max-w-xl cap that centred it at 576px). `relative` makes THIS the offset
                parent for the `sm:absolute sm:inset-x-0` panels below, so the fused dropdown inherits
                this full width and the bar + panel read as one continuous rectangle. */}
            <div className="relative w-full">
            {/* Morphing search "window": a rounded pill when idle that flattens its
                bottom and fuses with the suggestions panel into one continuous white
                window when open (Google-style monolith).
                ⚠️ THREE NAMED PROPERTIES, NEVER `transition-all`. What changes between idle and open
                is paint only — the fill, the shadow, the bottom radius. `all` also caught the layout
                that re-flows inside on focus (the input grows 76→180px while the AI and Map buttons
                unmount), so opening the field could animate geometry nobody asked to see. */}
            <div className={cn(
              'relative z-50 flex items-center transition-[background-color,box-shadow,border-radius] duration-200 ease-[var(--ease-out-strong)]',
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
            >
              <Search className="pointer-events-none ml-3.5 h-6 w-6 shrink-0 text-ink-4" strokeWidth={STROKE} />
              {/* The field's slot. `@container/q` so the placeholder below can ask how wide the field
                  is; `text-base` so its `em` thresholds are the field's own 16px. */}
              <div className="@container/q relative flex min-w-0 flex-1 text-base">
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
                // `text-ellipsis` is for TYPED text that outgrows the field. The placeholder is painted
                // by the overlay below — the native one is transparent (`placeholder:text-transparent`)
                // but stays in the attribute: it is the field's accessible description, the e2e
                // suites find the box by it, and `:placeholder-shown` needs it to be non-empty.
                // `forced-color-adjust-none` on it: in Windows High Contrast a forced text colour must
                // not paint it back UNDER the overlay (Chromium keeps the transparency; this makes
                // that the rule for every engine, not a behaviour we happened to measure).
                className="peer w-full min-w-0 bg-transparent py-3 pl-2 pr-2 text-base text-ellipsis text-foreground outline-none placeholder:text-transparent placeholder:forced-color-adjust-none"
              />
              {/* ⛔ THE PLACEHOLDER NEVER TRUNCATES (G-SEARCH-lite, main thread 2026-09-29).
                  ⚠️ SINCE O-03 (2026-09-30) ✨ AND MAP ARE OUT OF THE PILL BELOW 640px, so the numbers in the
                  next paragraph are the BEFORE state. Re-measured after (dev build, guest, en + vi): the idle
                  field is 110 / 150 / 165 / 180px at 320 / 360 / 375 / 390 on Android ("Get the app" shown)
                  and 154 / 194 / 209 / 224px on iOS — so every phone from 360 up now shows the LONG copy
                  ("Find products…" / "Tìm sản phẩm…"), and only a 320px Android falls to the one word.
                  The ladder stays: it is what keeps that 320px case and the MT languages honest.
                  BEFORE O-03 — measured on the integrated build at every phone width, guest, en and vi: the idle
                  field's text room is 0 / 30 / 45 / 60 / 82px at 320 / 360 / 375 / 390 / 412 on Android
                  (the "Get the app" control is shown) and 34 / 74 / 89 / 104 / 126px on iOS (it is
                  hidden, G-APPSTORE). "Find products…" needs 117px and "Tìm sản phẩm…" 119px, so on
                  EVERY phone but a 412px iPhone it read "Find pr…" / "Tìm s…". No copy fits Android
                  Vietnamese at 390, so this is a LADDER, not a new string: the long copy where it fits
                  (desktop, tablets, an open panel — the field widens when ✨ and Map step aside), the
                  one word the field is named by where that fits ("Search" 52.6px, "Tìm kiếm" 68.2px,
                  = the aria-label, so what a voice user sees is what they can say), and NOTHING below
                  that — the magnifier, ✨ and Map already say "search", and half a word says less.
                  ⚠️ CSS, NOT A MEASURING EFFECT, BECAUSE OF THE FIRST PAINT. The field is in the SSR
                  HTML of every page; a JS pick would paint the long copy truncated until hydration and
                  then swap it — on every phone load. Container queries on the field's own width pick
                  the rung before the first frame, in the language the server rendered.
                  ⚠️ THE THRESHOLDS ARE MEASURED TEXT WIDTHS in the field's font (Open Runde 16px, canvas
                  measureText) + the 16px of padding + 4px for the fallback face, in em so a zoomed
                  font scales them too: en 72.8 / 137.6px, vi 88.8 / 139.2px. CHANGE A STRING, RE-MEASURE.
                  ⚠️ The nine machine-translated languages have no width we can know ahead of time,
                  so they get only the long copy, and only with 224px of room — never a guess that
                  might be cut. `truncate` on each rung is a backstop for a fallback face, not a mode. */}
              <span
                aria-hidden="true"
                data-search-placeholder=""
                className={cn('pointer-events-none absolute inset-y-0 left-2 right-2 hidden items-center text-ink-4', placeholderFit.overlay)}
              >
                <span data-rung="long" className={cn('hidden min-w-0 truncate', placeholderFit.long)}>{tr('Find products…', 'Tìm sản phẩm…')}</span>
                <span data-rung="short" className={cn('min-w-0 truncate', placeholderFit.short)}>{tr('Search', 'Tìm kiếm')}</span>
              </span>
              </div>
              {/* ⚠️ From sm up only — below 640px ✨ and Map are the focus panel's first rows (O-03), so on a
                  phone this branch renders two `hidden` buttons and the idle pill is field-only.
                  De-crowd rule — keyed on ENGAGEMENT (suggest panel open), never on text
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
                  // ⚠️ `/65` SOFTENS THE RING, AND THE SIZE IS NOT THE LEVER. Owner, 2026-08-29:
                  // "make outline of this x icon subtle, too harsh". The mark is Solar
                  // `close-circle` — the ring IS the glyph — and it is drawn at 38px so it FILLS
                  // its button, which is the owner's own instruction from 2026-08-26 (43dd9bcf).
                  // Shrinking it back would undo that, and a class cannot reach inside a `<use>`
                  // shadow tree to dim the ring alone, so the whole mark is dimmed at rest.
                  // ⛔ 75% IS THE FLOOR, AND 65% WAS BELOW IT — a reviewer refuted the first pass
                  // and the numbers back it. Composited and measured, ink-4 over the light tint:
                  // 100% → 5.68:1, 80% → 3.67:1, 75% → 3.34:1, 70% → 3.04:1, 65% → 2.75:1. WCAG
                  // 1.4.11 wants 3:1 for a control that carries no text of its own, so 65% FAILED
                  // and 70% clears it by 0.04. 75% keeps a real margin and still visibly softens.
                  // Dark is not the binding case (75% → 3.94:1 on the #262626 tint, 3.79:1 on the
                  // #2a2a2a panel); light is, and every number here is composited and measured.
                  // ⚠️ FOCUS RESTORES FULL INK ALONGSIDE HOVER, AND ONLY HOVER DID AT FIRST. A
                  // reviewer pointed out the obvious consequence: a keyboard user tabbing onto
                  // Clear never triggers hover, so they met the softened glyph and nothing else —
                  // the softened state is the measured 3.34:1, which is exactly the reader WCAG
                  // 1.4.11 is written for. Pointer and keyboard now get the same affordance.
                  // ⚠️ DO NOT GO LOWER FOR LOOKS. This is the only "clear" affordance while the
                  // search panel is open, and it is the tap that stops the next one landing on ✨.
                  // Hover and focus restore full ink, so the softening costs nothing on approach.
                  className="mr-0.5 tap-48 text-ink-4/75 transition-[color,background-color,scale] duration-150 active:duration-[60ms] active:scale-[0.96] hover:bg-muted hover:text-foreground focus-visible:text-foreground"
                >
                  <X className="h-[38px] w-[38px] shrink-0" strokeWidth={STROKE} />
                </IconButton>
              ) : null) : (
                <>
                  {/* AI shopping concierge — pressable: press to enter AI mode (duotone), press
                      again for normal search. Sits left of the map in every search bar. */}
                  {/* ⛔ `hidden sm:flex` — PHONES GET THIS AS THE PANEL'S FIRST ROW INSTEAD (O-03, see `isPhone`). */}
                  <AISearchButton
                    active={pathname === '/messages/ai'}
                    onClick={openAi}
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
                    className="relative ml-2 mr-2 hidden h-10 w-10 tap-48 sm:flex"
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
                    onClick={openMap}
                    aria-label={tr('Map', 'Bản đồ')}
                    title={tr('Map', 'Bản đồ')}
                    // `hidden sm:flex` — the phone reaches the map from the focus panel's second row (O-03).
                    className="relative mr-2 hidden h-10 w-10 sm:flex shrink-0 items-center justify-center rounded-full text-ink-4 tap-48 transition-[color,scale] duration-200 ease-[var(--ease-spring-snappy)] hover:text-accent-foreground active:scale-[0.96] cursor-pointer"
                  >
                    <Map className="h-6 w-6" strokeWidth={STROKE} />
                  </Button>
                </>
              )}
              {/* Photo search folded into the AI assistant (✨ → camera in the chat
                  composer) — one smart entry point, less icon crowding. Pasting an
                  image into this bar still visual-searches (handler above). */}
            </div>

            {/* Recent searches + recent locations — flush bottom of the same window.
                ⚠️ BOTH PANELS STOP ABOVE THE ON-SCREEN KEYBOARD. They open on focus, so the keyboard
                is up whenever they are, and a 70vh cap alone ran them under it (y60–551 for 'Quận 7'
                against a keyboard top near 508 on a 390×844 phone). `--kb-h` is the app-wide
                keyboard height (globals.css, KEYBOARD GEOMETRY; 0 when there is none), subtracted with
                the panel's own top (`--search-panel-top`, measured from the header — see headerRef —
                falling back to 3.75rem) plus a 12px gap; the rest scrolls inside the panel.
                ⛔ ONE WINDOW FOR BOTH PANELS, NOT ONE EACH. It used to be two sibling elements, each with its
                own entrance keyframe — so the 2nd typed character (or a backspace to 1) unmounted one and
                mounted the other, and the whole window faded + slid in again MID-TYPING. A keystroke never
                animates (Emil's rule; the blink search-panel.ts removed, back in 100ms form). The window
                mounts once on `panelOpen` — the entrance plays for the tap that opens it — and only its
                contents switch.
                ⚠️ `transition-none` IS PART OF THE FIX. `duration-100` (there for the entrance) sets a
                transition-duration, and with no transition-property named the initial `all` applies — so
                the window's own padding change on that keystroke (p-4 → p-3) animated over 100ms,
                measured as four padding transitions. The entrance is a keyframe; nothing here transitions. */}
            {panelOpen && (
              <div
                ref={searchWindowRef}
                className={cn(
                  'fixed inset-x-2 top-[var(--search-panel-top,calc(env(safe-area-inset-top)+3.75rem))] z-50 max-h-[min(70vh,calc(100dvh-var(--kb-h,0px)-var(--search-panel-top,calc(env(safe-area-inset-top)+3.75rem))-0.75rem))] overflow-y-auto rounded-2xl bg-popover shadow-pop transition-none animate-in fade-in slide-in-from-top-1 duration-100 ease-out sm:absolute sm:inset-x-0 sm:top-full sm:-mt-px sm:rounded-t-none sm:rounded-b-2xl',
                  suggestOpen ? 'space-y-4 p-4' : 'p-3',
                )}
              >
                {suggestOpen ? (
                <>
                  {/* ⛔ PHONES ONLY: ✨ AND MAP AS THE PANEL'S FIRST TWO ROWS (owner, O-03 G-SEARCH Option A). They
                      left the idle pill below 640px (see `isPhone`), so this is where a phone finds them — above
                      history, because they are ways to search, not things searched. `sm:hidden` rather than an
                      `isPhone &&`, so a desktop window dragged narrow and back never shows a stale pair; `isPhone`
                      only decides whether the panel OPENS with nothing else in it.
                      Same row geometry as the recent-search rows below (44px, `-mx-2` so the icons line up under
                      the eyebrows' glyphs), and both hold focus in the field on press like those rows do, so the
                      keyboard does not drop and shift the panel under the finger before the click lands.
                      ⚠️ The AI row keeps the pill button's `aria-current` on /messages/ai. */}
                  <ul aria-label={tr('Other ways to search', 'Cách tìm khác')} className="-mx-2 sm:hidden">
                    <li>
                      <Button
                        variant="bare"
                        size="none"
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={openAi}
                        aria-current={pathname === '/messages/ai' ? 'page' : undefined}
                        className="flex w-full items-center justify-start gap-2.5 rounded-xl px-2 py-3 text-left text-sm font-semibold text-body hover:bg-muted cursor-pointer"
                      >
                        <Sparkles className="h-5 w-5 shrink-0 text-accent-foreground" />
                        <span className="min-w-0 truncate">{tr('Ask eno AI', 'Hỏi eno AI')}</span>
                      </Button>
                    </li>
                    <li>
                      <Button
                        variant="bare"
                        size="none"
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={openMap}
                        className="flex w-full items-center justify-start gap-2.5 rounded-xl px-2 py-3 text-left text-sm font-semibold text-body hover:bg-muted cursor-pointer"
                      >
                        <Map className="h-5 w-5 shrink-0 text-accent-foreground" />
                        <span className="min-w-0 truncate">{tr('Browse on the map', 'Xem tin trên bản đồ')}</span>
                      </Button>
                    </li>
                  </ul>
                  {recentSearches.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        {/* Micro-meta eyebrow icons ride the UI tier (lucide default 2) — STROKE_NAV
                            is reserved for h-6/h-7 chrome (§2); 2.25 at 12px reads smudged. */}
                        <span id={RECENT_LABEL_ID} className="flex items-center gap-1 text-2xs font-bold uppercase tracking-wider text-muted-foreground"><Clock className="h-3 w-3" />{tr('Recent', 'Tìm gần đây')}</span>
                        <Button variant="bare" size="none" type="button" onClick={() => { localStorage.removeItem(RECENT_SEARCHES_KEY); setRecentSearches([]) }} className="text-2xs font-semibold text-muted-foreground hover:text-destructive cursor-pointer">{tr('Clear', 'Xóa')}</Button>
                      </div>
                      {/* ROWS, EACH WITH ITS OWN ✕, not chips (S-TYPEAHEAD 2026-09-29): one stale term
                          could only go with all the others ("Clear"). Geometry, pixel for pixel:
                          `-mx-2` hangs each row's hover fill 8px into the panel padding so the clock
                          lines up under the eyebrow's clock; `pr-2` brings the ✕ back so its edge meets
                          Clear's. The term is a 44px row (py-3 + 20px line); the ✕ is a 28px button
                          whose 44px hit area (tap-44) is kept clear of the term by `ml-2` — exactly
                          its 8px overhang — and ends inside the panel's 16px padding on the right.
                          Both hold focus off themselves (mousedown preventDefault), so a tap never
                          blurs the field under the keyboard. */}
                      <ul aria-labelledby={RECENT_LABEL_ID} className="-mx-2">
                        {recentSearches.slice(0, 5).map((term, i) => (
                          <li key={i} className="flex items-center pr-2">
                            <Button
                              variant="bare"
                              size="none"
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => { setSearchVal(term); submitSearch(term); setShowSuggestions(false) }}
                              className="flex min-w-0 flex-1 items-center justify-start gap-2.5 rounded-xl px-2 py-3 text-left text-sm font-medium text-body hover:bg-muted cursor-pointer"
                            >
                              <Clock className="h-4 w-4 shrink-0 text-ink-4" />
                              <span className="truncate">{term}</span>
                            </Button>
                            <IconButton
                              size="xs"
                              aria-label={`${tr('Remove', 'Xóa')} “${term}”`}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => removeRecent(term)}
                              // The Clear-search ✕'s treatment above, for the same mark: `/75` at rest
                              // (≥3:1 non-text contrast, measured there), full ink on hover AND focus.
                              className="ml-2 text-ink-4/75 transition-[color,background-color,scale] duration-150 active:duration-[60ms] active:scale-[0.96] hover:bg-muted hover:text-foreground focus-visible:text-foreground"
                            >
                              {/* round((28 − 2) / 0.9) — the close-mark rule in ui/icon-button. */}
                              <X className="h-[29px] w-[29px] shrink-0" />
                            </IconButton>
                          </li>
                        ))}
                      </ul>
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
                  {/* Category shortcuts — the home grid's first six (the owner's lead order, then
                      live demand), so a first visit with no history and no trending still opens on
                      somewhere to go. Links, not buttons: each is a place with a URL (new tab, long
                      press, the status bar). Same chip as Trending, same eyebrow. */}
                  {shortcutCategories.length > 0 && (
                    <div className="space-y-1.5">
                      <span id={CATEGORIES_LABEL_ID} className="flex items-center gap-1 text-2xs font-bold uppercase tracking-wider text-muted-foreground"><LayoutGrid className="h-3 w-3" />{tr('Categories', 'Danh mục')}</span>
                      <ul aria-labelledby={CATEGORIES_LABEL_ID} className="flex flex-wrap gap-1.5">
                        {/* A way in, so Teachers reads "Find a teacher" (category-entry-label.ts) — applied HERE,
                            not in /api/search/trending, so the route's payload and its edge-cached copies keep
                            the category's own name for any other reader. */}
                        {shortcutCategories.map((c) => ({ ...c, ...categoryEntryLabel(c) })).map((c) => (
                          <li key={c.slug}>
                            {/* Classes on the BUTTON: asChild concatenates, and only these are twMerged.
                                ⛔ IN THE PAGE'S LANGUAGE (UX3 NAV-8, nav audit N6a): a raw `/c/${slug}` sent a
                                Vietnamese reader to the English-pinned `/c/furniture-appliances` ("Home in
                                Vietnam" under a VI banner). `localizedHref` gives the `/vi` twin of a piloted
                                path and leaves every other path as it is — the server variant, like the logo's
                                href (the panel only renders after a focus, so this never meets hydration). */}
                            <Button asChild variant="soft" size="none" className="whitespace-normal rounded-xl px-3.5 py-2 text-sm font-semibold text-body hover:text-accent-foreground cursor-pointer">
                              <Link href={localizedHref(`/c/${c.slug}`, variant)} prefetch={false} onClick={() => { releaseSearchPanel(); setShowSuggestions(false) }}>
                                {tr(c.name, c.nameVi)}
                              </Link>
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
                ) : (
                  /* Instant matches — live listings + categories as you type (≥2 chars) */
                  <SearchSuggest
                    items={suggestItems}
                    loading={live.loading}
                    query={searchVal}
                    activeIndex={activeIdx}
                    listboxId={SUGGEST_ID}
                    onPick={pickSuggest}
                    onSubmitQuery={() => { submitSearch(searchVal); setShowSuggestions(false) }}
                  />
                )}
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
          {/* ⛔ …BUT A DESKTOP GUEST HAD NO WAY TO SAVED BUT THE FOOTER (UX3 NAV-7, nav audit N7): no rail (it is
              signed-in only) and no tab bar (phones only), so "Saved listings" sat at y≈3,000 — even right after
              the visitor tapped a heart (t11-desk-01). This is the heart Chợ Tốt's desktop header and FB's
              "Saved" give them, with the same count the phone's Saved tab shows (red `counter`, O-08 reverted).
              · lg+ only and guests only — the same gate as the rail's absence (`!user`, like Sign in beside it),
                so a signed-in reader never gets the duplicate the 2026-07-18 note removed; phones unchanged.
              · The COUNT IS CLIENT-ONLY: favourites live in this device's localStorage and hydrate in an effect,
                so the edge-cached HTML (one copy for everyone) carries the bare heart and no number.
              · A LINK, through `localizedHref` like every header destination (identity for /saved today).
              · `size-7`, not `h-7 w-7`: ui/button's base `[&_svg:not([class*='size-'])]:size-4` would shrink an
                h-/w- sized glyph to 16px under `asChild` (CLAUDE.md, "ui/button inflates small icons"). */}
          {!user && (
            <Button
              asChild
              variant="bare"
              size="none"
              className="relative hidden h-10 w-10 shrink-0 items-center justify-center rounded-full tap-44 text-body transition-[background-color,color,scale] duration-100 hover:bg-accent hover:text-accent-foreground active:scale-[0.96] lg:flex"
            >
              <Link
                href={localizedHref('/saved', variant)}
                prefetch={false}
                aria-label={savedCount > 0 ? `${tr('Saved', 'Đã lưu')}, ${savedCount}` : tr('Saved', 'Đã lưu')}
                // Hydration-gated like the Sign in link's `?next=`: the server's pathname can be the internal
                // `/en/saved` (see `hydrated`), and React does not patch an attribute on hydration.
                aria-current={hydrated && pathname === '/saved' ? 'page' : undefined}
                data-header-saved=""
              >
                <Heart className="size-7" strokeWidth={STROKE} />
                {savedCount > 0 && (
                  <Badge aria-hidden variant="counter" size="count" className="absolute right-1 top-1">
                    {savedCount > 99 ? '99+' : savedCount}
                  </Badge>
                )}
              </Link>
            </Button>
          )}
          <NotificationBell />
          {/* "Get the app" — ONE control placed to satisfy both placements the owner asked for
              (2026-09-16): on a phone, where Post lives in the bottom nav, it lands immediately to the
              RIGHT OF THE BELL; on desktop it is the control immediately LEFT OF POST. Renders nothing
              inside the native shell. */}
          <AppDownload />
          {/* Signed-in users reach their account via the persistent LEFT nav rail (desktop) / the
              bottom-nav Account tab (mobile/tablet) — no header avatar (owner 2026-07-17). Guests
              still get a Sign in link here. */}
          {/* ⛔ THE ONE POPUP, NOT THE PAGE (owner, 2026-08-28: "unify all login signup pages to this
              only 1 popup"). This link was the last guest gate that NAVIGATED to /signin — every other
              one (the bell, the gated tabs, the first save) opens the dialog in place, and the dialog
              returns the visitor to the page they were on (sign-in-form's nextPath). A plain click now
              does the same; the href stays a real URL, carrying `?next=`, for a middle/modified click
              and for no-JS. /signin and every /auth route sanitise `next` through safeNextPath, so it
              can only ever name a same-origin path.
              ⚠️ NO aria-label, AND THE VISIBLE WORD IS THE NAME (WCAG 2.5.3 label-in-name). It read
              "Log in" on screen while announcing "Sign in" — a voice user saying what they saw
              matched nothing. The span is the accessible name at every width: sr-only below lg,
              visible from lg, and the User glyph is aria-hidden (ui/icons). */}
          {!user && (
            <Link
              href={offHome ? `/signin?next=${encodeURIComponent(pathname)}` : '/signin'}
              prefetch={false}
              onPointerEnter={preloadSignIn}
              onFocus={preloadSignIn}
              onClick={(e) => {
                if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                e.preventDefault()
                openSignIn()
              }}
              /* ⚠️ THE ONLY HEADER CONTROL WITH NO PRESS RESPONSE UNTIL NOW — measured against its
                 own neighbours: 0 of 7,872 pixels changed under a held pointer, while /post moved
                 1,120px, the logo 727, the bell 409, AI 187 and Map 212, all at scale ~0.96.
                 ⚠️ AND THE `hover:bg-accent` DEFENCE DOES NOT COVER TOUCH: Tailwind gates `hover:`
                 behind `@media (hover: hover)`, and this link renders from `sm` up — which includes
                 touch tablets, where it therefore had no feedback at all. */
              className="hidden sm:flex items-center gap-1.5 rounded-xl px-2.5 h-9 text-sm font-semibold text-body transition-[color,background-color,scale] hover:bg-accent hover:text-accent-foreground active:scale-[0.97] active:duration-[60ms] cursor-pointer tap-48 relative"
            >
              <User className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={STROKE} />
              <span className="sr-only lg:not-sr-only">{tr('Sign in', 'Đăng nhập')}</span>
            </Link>
          )}

          {/* Desktop only: mobile/tablet get the bottom-nav "+" Post button instead. Hide via a
              WRAPPER, not on the button — `<Button asChild>` (Radix Slot) concatenates the
              Button's base `inline-flex` onto the child WITHOUT tailwind-merge, so any display
              utility on the button itself (hidden / mobile:hidden) loses to `inline-flex`. The
              wrapper has no competing display, so mobile:hidden reliably hides it; pc:contents
              keeps the button a direct flex child on desktop (zero layout change). */}
          {/* ⚠️ THE ORANGE POST BUTTON STANDS DOWN ON THE POST FLOW ITSELF (/post, /listings/[id]/edit):
              a second "Free Post" above a form that IS the post flow reads as a restart.
              ⛔ DECIDED FROM THE PATHNAME AT RENDER TIME, NOT FROM AN EFFECT. The first version hid it
              only once the wizard's effect set `data-post-wizard` on <html>, so the server HTML carried
              the button and hydration removed it: the header controls beside it jumped ~105px at
              1280px (review, 2026-09-29, CLS 0.0017). isPostFlowPath answers the same on the server
              and in the browser, so the server HTML already omits it.
              The wizard still writes one attribute — `data-post-done`, on its SUCCESS screen, where
              posting another IS the next step — and this hook lets the button back then. A
              SUBJECT-position hook (`html:not([…]) .x`), deliberately not a `body:has(…)` one: `:has()`
              in a non-subject position makes every DOM mutation re-test the whole document, the cost
              design-lint's :has rule exists to keep out. Its (0,2,1) specificity beats `pc:contents`. */}
          <div className={isPostFlowPath(pathname) ? 'mobile:hidden pc:contents [html:not([data-post-done])_&]:hidden' : 'mobile:hidden pc:contents'}>
            {/* gap/weight ride on the BUTTON: asChild composes through Base UI's render
                prop, which CONCATENATES classNames — only the Button's own className is
                twMerged. On the child these were decided by stylesheet order instead of
                intent (base gap-2 beat the child's gap-1.5). */}
            {/* ⛔ `commerce`, NOT `cta` — THIS BUTTON IS THE ORANGE ONE (owner, 2026-09-18: "prices
                orange and free post … orange"). `cta` is the shared primary-action variant behind 128
                controls and stays brand blue; the commerce orange is scoped to this Post button, the
                bottom nav's Post coin and the price. See the variant's own ⛔ note in ui/button. */}
            <Button asChild variant="commerce" size="none" className="gap-1.5 font-semibold">
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
