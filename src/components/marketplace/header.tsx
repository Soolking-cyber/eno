'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { User, Search, MapPin, Clock, X } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { NotificationBell } from './notification-bell'
import { AreaFilter, type Nearby, type Geo } from './area-filter'
import { useSearchSuggest } from '@/hooks/use-search-suggest'
import { SearchSuggest, buildSuggestItems, suggestOptionId, type SuggestItem } from './search-suggest'
import { TrendingSearches } from './trending-searches'
import { useTrendingSearches } from '@/hooks/use-trending-searches'
import { AISearchButton } from './ai-concierge'
import { runVisualSearch, imageFromPaste } from '@/lib/visual-search'
import { toast } from 'sonner'

// The typeahead listbox this bar owns. Static (one Header per page), and distinct
// from the hero bar's so both can be in the DOM at once without id collisions.
const SUGGEST_ID = 'header-search-suggest'

// One uniform lucide stroke across the whole header, matching the bottom nav — a slightly
// thicker, identical weight reads softer and keeps every icon visually the same weight.
const STROKE = 2.25

export function Header() {
  const { t, tr, lang } = useLanguage()
  const { user } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  // Roll the bar up on scroll-down, back down on scroll-up (mobile only — desktop
  // stays pinned via lg:translate-y-0).
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
    sync()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Explorer pages (home + category) mount the ListingsExplorer, which listens for
  // our search/district custom events. Elsewhere we navigate to the home explorer.
  const isExplorerPage = pathname === '/' || (pathname?.startsWith('/c/') ?? false)
  // Active-page indicator for the desktop header icons (mirrors the mobile bottom nav).

  // Chợ Tốt-style: the in-header search + area selector appear once the big hero
  // search pill scrolls out of view (or immediately on any page without a hero).
  // The explorer announces hero presence via the `eno:hero` event; while present we
  // watch it with an IntersectionObserver and reveal the header search on scroll-past.
  const [showSearch, setShowSearch] = useState(false)
  const [searchVal, setSearchVal] = useState('')
  const [province, setProvince] = useState<Geo | null>(null)
  const [ward, setWard] = useState<Geo | null>(null)
  const [nearby, setNearby] = useState<Nearby | null>(null)
  const [areaOpen, setAreaOpen] = useState(false)
  const areaBtnRef = useRef<HTMLButtonElement>(null)
  // Quick-select suggestions (same store as the hero/in-explorer search): the user's
  // recent searches + recently-used areas, shown when the header search is focused.
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [recentLocations, setRecentLocations] = useState<{ province: Geo; ward: Geo | null }[]>([])

  const searchFormRef = useRef<HTMLFormElement>(null)

  // Read fresh on focus so it reflects searches/areas made elsewhere this session.
  const openSuggestions = () => {
    try { const h = localStorage.getItem('eno:recent_searches'); setRecentSearches(h ? JSON.parse(h) : []) } catch { setRecentSearches([]) }
    try { const l = localStorage.getItem('eno:recent_locations'); setRecentLocations(l ? JSON.parse(l) : []) } catch { setRecentLocations([]) }
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

  // The window is "open" (morph + panel) when focused with EITHER history to show
  // (empty query) OR live instant-match results (≥2 chars). Otherwise it stays a
  // normal pill (no flat-bottom).
  // Trending searches — lazily fetched while the empty-focus panel is eligible, so a
  // first-time visitor with no local history still gets a populated dropdown.
  const trending = useTrendingSearches(showSuggestions && searchVal.trim().length === 0)
  const suggestOpen = showSuggestions && searchVal.trim().length === 0 && (recentSearches.length > 0 || recentLocations.length > 0 || trending.length > 0)
  const instantOpen = showSuggestions && searchVal.trim().length >= 2
  const panelOpen = suggestOpen || instantOpen

  // Instant matches (debounced typeahead) — brands + categories + listings, with the
  // 'Search for "{q}"' row ALWAYS first: Enter with no arrow-key selection submits the
  // raw free-text search (never a suggestion); arrow keys still navigate suggestions.
  const live = useSearchSuggest(searchVal, showSuggestions)
  const suggestItems = buildSuggestItems(searchVal, live.brands, live.categories, live.listings)
  const [activeIdx, setActiveIdx] = useState(-1)
  useEffect(() => { setActiveIdx(-1) }, [searchVal])
  // DOM focus stays in the input while the arrows move `activeIdx`, so there is no
  // focus event to announce the highlighted row. aria-activedescendant IS that
  // announcement — it points the screen reader's "virtual focus" at the option the
  // highlight is on. Bounds-checked because a dangling id would announce nothing at
  // all, which is the exact failure we're fixing.
  const activeOptionId = instantOpen && activeIdx >= 0 && activeIdx < suggestItems.length
    ? suggestOptionId(SUGGEST_ID, activeIdx)
    : undefined

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
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(suggestItems.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(-1, i - 1)) }
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
    setProvince(p)
    setWard(w)
    setNearby(nb)
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
        'sticky top-0 z-40 bg-background pt-[env(safe-area-inset-top)] transition-[transform,opacity] duration-[250ms] ease-out [will-change:transform,opacity] motion-reduce:transition-none',
        // Facebook-style on ALL sizes (incl. desktop): slide UP off-screen + fade out on
        // scroll-down, slide back down + fade in on scroll-up (near the top = always shown).
        hidden ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100',
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 sm:gap-3 border-b border-border/60 px-3 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link
          href="/"
          onClick={() => window.dispatchEvent(new CustomEvent('eno:reset-home'))}
          className="flex shrink-0 items-center transition-transform duration-200 hover:scale-110 active:scale-95"
          aria-label="eno.vn"
        >
          {/* eno WORDMARK (owner 2026-07-16, was the square logo-mark). The SVG viewBox is now
              cropped to the glyph ink (was ~20% empty padding each side), so h-8 + w-auto renders
              a TIGHT ~88px box instead of 128px — the letters are the same size, just no dead
              padding, which balances the mobile header and gives the search bar back ~40px. The
              intrinsic 219×80 matches the cropped 823:300 aspect so there's no CLS. */}
          <img src="/logo.svg" alt="eno.vn" width={219} height={80} className="h-8 w-auto" />
        </Link>

        {showSearch ? (
          <form
            ref={searchFormRef}
            role="search"
            onSubmit={(e) => { e.preventDefault(); submitSearch(searchVal); setShowSuggestions(false) }}
            className="relative min-w-0 flex-1 animate-in fade-in duration-200"
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
              'relative z-50 flex items-center transition-all duration-200',
              panelOpen
                // Open = the fused search WINDOW (a panel, not an input): rounded-2xl to match the
                // suggestions panel it fuses with at sm+ (bottom flattened where they join), so the
                // fused silhouette is one consistent radius. The floating shadow is the standard
                // popover treatment for a layer over content — not canvas elevation.
                ? 'rounded-2xl bg-card shadow-pop sm:rounded-b-none'
                // Idle = maximally seamless: rounded-2xl (matches the hero search pill + the fused-open
                // state, so there's no corner jump on open) and PURE bg-tint — zero border, zero ring,
                // and NO bg swap on focus (a white focus fill would merge into the bg-card header).
                // The only focus cue is the text caret. It's distinguished from the header solely by
                // the tint, exactly as requested.
                : 'rounded-2xl bg-tint',
            )}>
              <Search className="pointer-events-none ml-3.5 h-6 w-6 shrink-0 text-ink-4" strokeWidth={STROKE} />
              <Input
                variant="unstyled"
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                onFocus={openSuggestions}
                onKeyDown={onSearchKeyDown}
                onPaste={async (e) => {
                  const f = imageFromPaste(e); if (!f) return; e.preventDefault()
                  toast.loading(tr('Reading your photo…', 'Đang đọc ảnh…'), { id: 'vis' })
                  const r = await runVisualSearch(f)
                  if (r?.query) { toast.dismiss('vis'); setSearchVal(r.query); setShowSuggestions(false); submitVisual(r) }
                  else toast.error(tr("Couldn't recognize the item — try a clearer photo.", 'Không nhận ra món đồ — thử ảnh rõ hơn.'), { id: 'vis' })
                }}
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                // Inside a chat thread, drop this out of the focus order so the composer is
                // the ONLY navigable form field — that greys out the iOS keyboard's prev/next
                // chevrons over the composer (the accessory bar's "Done" itself is a native
                // WKWebView feature the web can't remove). Still tap-usable elsewhere.
                tabIndex={pathname && /^\/messages\/.+/.test(pathname) ? -1 : undefined}
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
              {/* Clear — appears once there's text, left of the location picker. */}
              {searchVal && (
                <IconButton
                  size="sm"
                  onClick={() => { setSearchVal(''); submitSearch('') }}
                  aria-label={tr('Clear search', 'Xóa tìm kiếm')}
                  // tap-48 overrides the IconButton's baked-in tap-44 (defined later in the sheet)
                  // for a 48px hit area — forgiving for kids / fast scrollers — with no size change.
                  className="mr-0.5 tap-48 text-ink-4 transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-5 w-5" strokeWidth={STROKE} />
                </IconButton>
              )}
              {/* AI shopping concierge — pressable: press to enter AI mode (filled), press
                  again for normal search. Sits left of the camera in every search bar. */}
              <AISearchButton
                active={pathname === '/messages/ai'}
                onClick={() => { router.push('/messages/ai'); setShowSuggestions(false) }}
                // relative + tap-48 → a 48px hit area around the 40px visual (invisible ::before).
                className="relative mr-0.5 h-10 w-10 tap-48"
              />
              {/* Photo search folded into the AI assistant (✨ → camera in the chat
                  composer) — one smart entry point, less icon crowding. Pasting an
                  image into this bar still visual-searches (handler above). */}
            </div>

            {/* Recent searches + recent locations — flush bottom of the same window */}
            {suggestOpen && (
              <>
                <div className="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+3.75rem)] z-50 space-y-4 rounded-2xl bg-card p-4 shadow-pop animate-in fade-in slide-in-from-top-1 duration-100 sm:absolute sm:inset-x-0 sm:top-full sm:-mt-px sm:rounded-t-none sm:rounded-b-2xl">
                  {recentSearches.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-2xs font-bold uppercase tracking-wider text-muted-foreground"><Clock className="h-3 w-3" strokeWidth={STROKE} />{tr('Recent', 'Tìm gần đây')}</span>
                        <Button variant="bare" size="none" type="button" onClick={() => { localStorage.removeItem('eno:recent_searches'); setRecentSearches([]) }} className="text-2xs font-semibold text-muted-foreground hover:text-destructive cursor-pointer">{tr('Clear', 'Xóa')}</Button>
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
                        <span className="flex items-center gap-1 text-2xs font-bold uppercase tracking-wider text-muted-foreground"><MapPin className="h-3 w-3" strokeWidth={STROKE} />{tr('Recent locations', 'Khu vực gần đây')}</span>
                        <Button variant="bare" size="none" type="button" onClick={() => { localStorage.removeItem('eno:recent_locations'); setRecentLocations([]) }} className="text-2xs font-semibold text-muted-foreground hover:text-destructive cursor-pointer">{tr('Clear', 'Xóa')}</Button>
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
                            <MapPin className="h-3.5 w-3.5" strokeWidth={STROKE} />
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
              <div className="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+3.75rem)] z-50 max-h-[70vh] overflow-y-auto rounded-2xl bg-card p-3 shadow-pop animate-in fade-in slide-in-from-top-1 duration-100 sm:absolute sm:inset-x-0 sm:top-full sm:-mt-px sm:rounded-t-none sm:rounded-b-2xl">
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
              className="hidden sm:flex items-center gap-1.5 rounded-xl px-2.5 h-9 text-sm font-semibold text-body transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer tap-48 relative"
              aria-label={tr('Sign in', 'Đăng nhập')}
            >
              <User className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={STROKE} />
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
                className="px-4 py-2 text-sm inline-flex cursor-pointer"
              >
                {t('header.postBtn')}
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <AreaFilter
        open={areaOpen}
        anchorRef={areaBtnRef}
        onClose={() => setAreaOpen(false)}
        province={province}
        ward={ward}
        nearby={nearby}
        onApply={applyArea}
        onReset={() => applyArea({ province: null, ward: null, nearby: null })}
      />
    </header>
  )
}
