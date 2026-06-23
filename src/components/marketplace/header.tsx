'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Plus, User, Search, MapPin, Clock, MessageSquare } from 'lucide-react'
import { SavedSearchIcon } from './saved-search-icon'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { useChat } from '@/context/chat-context'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { cn } from '@/lib/utils'
import { AccountMenu } from './account-menu'
import { NotificationBell } from './notification-bell'
import { AreaFilter, type Nearby, type Geo } from './area-filter'
import { useSearchSuggest } from '@/hooks/use-search-suggest'
import { SearchSuggest, buildSuggestItems, type SuggestItem } from './search-suggest'

export function Header() {
  const { t, tr, lang } = useLanguage()
  const { user } = useAuth()
  const { unread } = useChat()
  const pathname = usePathname()
  const router = useRouter()
  // Roll the bar up on scroll-down, back down on scroll-up (mobile only — desktop
  // stays pinned via lg:translate-y-0).
  const hidden = useHideOnScroll()

  // Explorer pages (home + category) mount the ListingsExplorer, which listens for
  // our search/district custom events. Elsewhere we navigate to the home explorer.
  const isExplorerPage = pathname === '/' || (pathname?.startsWith('/c/') ?? false)

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
  const suggestOpen = showSuggestions && searchVal.trim().length === 0 && (recentSearches.length > 0 || recentLocations.length > 0)
  const instantOpen = showSuggestions && searchVal.trim().length >= 2
  const panelOpen = suggestOpen || instantOpen

  // Instant matches (debounced typeahead) — listings + categories.
  const live = useSearchSuggest(searchVal, showSuggestions)
  const suggestItems = buildSuggestItems(live.categories, live.listings)
  const [activeIdx, setActiveIdx] = useState(-1)
  useEffect(() => { setActiveIdx(-1) }, [searchVal])

  const pickSuggest = (it: SuggestItem) => {
    setShowSuggestions(false)
    router.push(it.type === 'category' ? `/c/${it.slug}` : `/listings/${it.id}`)
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

  const applyArea = ({ province: p, ward: w, nearby: nb }: { province: Geo | null; ward: Geo | null; nearby: Nearby | null }) => {
    setProvince(p)
    setWard(w)
    setNearby(nb)
    if (isExplorerPage) {
      window.dispatchEvent(new CustomEvent('eno:set-area', { detail: { province: p, ward: w, nearby: nb } }))
    } else {
      router.push('/') // off the explorer: jump to the home feed (area is session state)
    }
  }

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b border-border/60 bg-card pt-[env(safe-area-inset-top)] transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none',
        hidden ? '-translate-y-full lg:translate-y-0' : 'translate-y-0',
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 sm:gap-3 px-3 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link
          href="/"
          onClick={() => { if (pathname === '/') window.dispatchEvent(new CustomEvent('eno:reset-home')) }}
          className="flex shrink-0 items-center"
          aria-label="eno.vn"
        >
          <img src="/logo-mark.svg" alt="eno.vn" width={40} height={40} className="h-10 w-10" />
        </Link>

        {showSearch ? (
          <form
            ref={searchFormRef}
            onSubmit={(e) => { e.preventDefault(); submitSearch(searchVal); setShowSuggestions(false) }}
            className="relative min-w-0 flex-1 animate-in fade-in duration-200"
          >
            {/* Morphing search "window": a rounded pill when idle that flattens its
                bottom and fuses with the suggestions panel into one continuous white
                window when open (Google-style monolith). */}
            <div className={cn(
              'relative z-50 flex items-center transition-all duration-200',
              panelOpen
                ? 'rounded-t-2xl bg-card shadow-pop'
                : 'rounded-2xl border border-transparent bg-tint focus-within:border-ring focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/30',
            )}>
              <Search className="pointer-events-none ml-3 h-4 w-4 shrink-0 text-ink-4" />
              <input
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                onFocus={openSuggestions}
                onKeyDown={onSearchKeyDown}
                autoComplete="off"
                placeholder={tr('Find products…', 'Tìm sản phẩm…')}
                aria-label={tr('Search', 'Tìm kiếm')}
                className="min-w-0 flex-1 bg-transparent py-2.5 pl-2 pr-2 text-sm text-foreground outline-none placeholder:text-ink-4"
              />
              {/* Area filter — small location pin inside the search bar (right) */}
              <button
                type="button"
                ref={areaBtnRef}
                onClick={() => { setAreaOpen((o) => !o); setShowSuggestions(false) }}
                aria-label={tr('Area', 'Khu vực')}
                className={cn(
                  'mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all active:scale-95',
                  province || ward || nearby
                    ? 'bg-[#0a66c2] text-white shadow-sm'
                    : 'text-body hover:bg-muted',
                )}
              >
                <MapPin className="h-4 w-4" />
              </button>
            </div>

            {/* Recent searches + recent locations — flush bottom of the same window */}
            {suggestOpen && (
              <>
                <div className="absolute left-0 right-0 top-full z-50 -mt-px space-y-3.5 rounded-b-2xl bg-card p-3.5 shadow-pop animate-in fade-in slide-in-from-top-1 duration-100">
                  {recentSearches.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><Clock className="h-3 w-3" />{tr('Recent', 'Tìm gần đây')}</span>
                        <button type="button" onClick={() => { localStorage.removeItem('eno:recent_searches'); setRecentSearches([]) }} className="text-[10px] font-semibold text-muted-foreground hover:text-red-500 cursor-pointer">{tr('Clear', 'Xóa')}</button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {recentSearches.map((term, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => { setSearchVal(term); submitSearch(term); setShowSuggestions(false) }}
                            className="rounded-xl px-3 py-1.5 text-xs font-semibold text-body hover:bg-muted transition-colors cursor-pointer"
                          >
                            {term}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {recentLocations.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><MapPin className="h-3 w-3" />{tr('Recent locations', 'Khu vực gần đây')}</span>
                        <button type="button" onClick={() => { localStorage.removeItem('eno:recent_locations'); setRecentLocations([]) }} className="text-[10px] font-semibold text-muted-foreground hover:text-red-500 cursor-pointer">{tr('Clear', 'Xóa')}</button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {recentLocations.map((loc, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => { applyArea({ province: loc.province, ward: loc.ward, nearby: null }); setShowSuggestions(false) }}
                            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-body hover:bg-muted transition-colors cursor-pointer"
                          >
                            <MapPin className="h-3 w-3" />
                            {loc.ward ? (lang === 'vi' ? loc.ward.name : loc.ward.nameEn) : (lang === 'vi' ? loc.province.name : loc.province.nameEn)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Instant matches — live listings + categories as you type (≥2 chars) */}
            {instantOpen && (
              <div className="absolute left-0 right-0 top-full z-50 -mt-px max-h-[70vh] overflow-y-auto rounded-b-2xl bg-card p-2.5 shadow-pop animate-in fade-in slide-in-from-top-1 duration-100">
                <SearchSuggest
                  listings={live.listings}
                  categories={live.categories}
                  loading={live.loading}
                  query={searchVal}
                  activeIndex={activeIdx}
                  onPick={pickSuggest}
                  onSubmitQuery={() => { submitSearch(searchVal); setShowSuggestions(false) }}
                />
              </div>
            )}
          </form>
        ) : (
          <div className="flex-1" />
        )}

        {/* Actions. The notification bell shows on ALL sizes (top-right, per the
            Chợ Tốt pattern); account + Post are desktop-only (mobile uses the bottom nav). */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Desktop quick actions (mobile uses the bottom nav): Saved · Messages · Bell */}
          {user && (
            <>
              <Link href="/saved" aria-label={tr('Saved listings & searches', 'Tin & tìm kiếm đã lưu')} title={tr('Saved listings & searches', 'Tin & tìm kiếm đã lưu')} className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer">
                <SavedSearchIcon className="h-5 w-5" />
              </Link>
              <Link href="/messages" aria-label={tr('Messages', 'Tin nhắn')} className="relative hidden sm:flex h-9 w-9 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer">
                <MessageSquare className="h-5 w-5" />
                {unread > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0a66c2] px-1 text-[9px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>
                )}
              </Link>
            </>
          )}
          <NotificationBell />
          {user ? (
            <div className="hidden sm:block"><AccountMenu /></div>
          ) : (
            <Link
              href="/signin"
              className="hidden sm:flex items-center gap-1.5 rounded-xl px-2.5 h-9 text-sm font-semibold text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer"
              aria-label={tr('Sign in', 'Đăng nhập')}
            >
              <User className="h-5 w-5" />
              <span className="hidden lg:inline">{tr('Log in', 'Đăng nhập')}</span>
            </Link>
          )}

          <Link
            href="/post"
            className="hidden items-center gap-1.5 rounded-xl bg-[#0a66c2] px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-[#004182] sm:flex cursor-pointer"
          >
            <Plus className="h-4 w-4" /> {t('header.postBtn')}
          </Link>
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

