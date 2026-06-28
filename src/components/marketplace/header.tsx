'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { User, Search, MapPin, Clock, Heart, MessageSquare, X } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { useChat } from '@/context/chat-context'
import { useFavorites } from '@/context/favorites-context'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { cn } from '@/lib/utils'
import { AccountMenu } from './account-menu'
import { NotificationBell } from './notification-bell'
import { AreaFilter, type Nearby, type Geo } from './area-filter'
import { useSearchSuggest } from '@/hooks/use-search-suggest'
import { SearchSuggest, buildSuggestItems, type SuggestItem } from './search-suggest'
import { ImageSearchButton } from './image-search-button'
import { AISearchButton, AIConciergePanel } from './ai-concierge'
import { runVisualSearch, imageFromPaste } from '@/lib/visual-search'
import { toast } from 'sonner'

export function Header() {
  const { t, tr, lang } = useLanguage()
  const { user } = useAuth()
  const { unread } = useChat()
  const { count: savedCount } = useFavorites()
  const pathname = usePathname()
  const router = useRouter()
  // Roll the bar up on scroll-down, back down on scroll-up (mobile only — desktop
  // stays pinned via lg:translate-y-0).
  const hidden = useHideOnScroll()

  // Explorer pages (home + category) mount the ListingsExplorer, which listens for
  // our search/district custom events. Elsewhere we navigate to the home explorer.
  const isExplorerPage = pathname === '/' || (pathname?.startsWith('/c/') ?? false)
  // Active-page indicator for the desktop header icons (mirrors the mobile bottom nav).
  const savedActive = pathname === '/saved'
  const msgActive = pathname?.startsWith('/messages') ?? false

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
  const [aiMode, setAiMode] = useState(false)
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
      router.push('/') // off the explorer: jump to the home feed (area is session state)
    }
  }

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b border-border/60 bg-card pt-[env(safe-area-inset-top)] transition-[transform,opacity] duration-[250ms] ease-out [will-change:transform,opacity] motion-reduce:transition-none',
        // Facebook-style on ALL sizes (incl. desktop): slide UP off-screen + fade out on
        // scroll-down, slide back down + fade in on scroll-up (near the top = always shown).
        hidden ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100',
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 sm:gap-3 px-3 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link
          href="/"
          onClick={() => window.dispatchEvent(new CustomEvent('eno:reset-home'))}
          className="flex shrink-0 items-center"
          aria-label="eno.vn"
        >
          <img src="/logo-mark.svg" alt="eno.vn" width={48} height={48} className="h-12 w-12" />
        </Link>

        {showSearch ? (
          <form
            ref={searchFormRef}
            role="search"
            onSubmit={(e) => { e.preventDefault(); submitSearch(searchVal); setShowSuggestions(false) }}
            className="relative min-w-0 flex-1 animate-in fade-in duration-200"
          >
            {/* Morphing search "window": a rounded pill when idle that flattens its
                bottom and fuses with the suggestions panel into one continuous white
                window when open (Google-style monolith). */}
            <div className={cn(
              'relative z-50 flex items-center transition-all duration-200',
              panelOpen
                ? 'rounded-2xl bg-card shadow-pop sm:rounded-b-none'
                : 'rounded-2xl border border-transparent bg-tint focus-within:border-ring focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/30',
            )}>
              <Search className="pointer-events-none ml-3.5 h-6 w-6 shrink-0 text-ink-4" />
              <input
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
                placeholder={tr('Find products…', 'Tìm sản phẩm…')}
                aria-label={tr('Search', 'Tìm kiếm')}
                className="min-w-0 flex-1 bg-transparent py-3 pl-2 pr-2 text-base text-foreground outline-none placeholder:text-ink-4"
              />
              {/* Clear — appears once there's text, left of the location picker. */}
              {searchVal && (
                <button
                  type="button"
                  onClick={() => { setSearchVal(''); submitSearch('') }}
                  aria-label={tr('Clear search', 'Xóa tìm kiếm')}
                  className="mr-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-muted hover:text-foreground tap-44 relative"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
              {/* AI shopping concierge — pressable: press to enter AI mode (filled), press
                  again for normal search. Sits left of the camera in every search bar. */}
              <AISearchButton
                active={aiMode}
                onClick={() => { setAiMode((a) => !a); setShowSuggestions(false) }}
                className="mr-0.5 h-10 w-10"
              />
              {/* Visual search — take/upload/paste a photo, search by its subject. */}
              <ImageSearchButton
                iconClassName="h-6 w-6"
                className="mr-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-body transition-colors hover:bg-muted disabled:opacity-60 tap-44 relative"
                onStart={() => toast.loading(tr('Reading your photo…', 'Đang đọc ảnh…'), { id: 'vis' })}
                onResult={(r) => { toast.dismiss('vis'); setSearchVal(r.query); setShowSuggestions(false); submitVisual(r) }}
                onError={(m) => toast.error(m, { id: 'vis' })}
              />
            </div>

            {/* Recent searches + recent locations — flush bottom of the same window */}
            {suggestOpen && (
              <>
                <div className="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+3.75rem)] z-50 space-y-4 rounded-2xl bg-card p-4 shadow-pop animate-in fade-in slide-in-from-top-1 duration-100 sm:absolute sm:inset-x-0 sm:top-full sm:-mt-px sm:rounded-t-none sm:rounded-b-2xl">
                  {recentSearches.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><Clock className="h-3 w-3" />{tr('Recent', 'Tìm gần đây')}</span>
                        <button type="button" onClick={() => { localStorage.removeItem('eno:recent_searches'); setRecentSearches([]) }} className="text-[11px] font-semibold text-muted-foreground hover:text-red-500 cursor-pointer">{tr('Clear', 'Xóa')}</button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {recentSearches.map((term, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => { setSearchVal(term); submitSearch(term); setShowSuggestions(false) }}
                            className="rounded-xl px-3.5 py-2 text-sm font-semibold text-body hover:bg-muted transition-colors cursor-pointer"
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
                        <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><MapPin className="h-3 w-3" />{tr('Recent locations', 'Khu vực gần đây')}</span>
                        <button type="button" onClick={() => { localStorage.removeItem('eno:recent_locations'); setRecentLocations([]) }} className="text-[11px] font-semibold text-muted-foreground hover:text-red-500 cursor-pointer">{tr('Clear', 'Xóa')}</button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {recentLocations.map((loc, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => { applyArea({ province: loc.province, ward: loc.ward, nearby: null }); setShowSuggestions(false) }}
                            className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-body hover:bg-muted transition-colors cursor-pointer"
                          >
                            <MapPin className="h-3.5 w-3.5" />
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
              <div className="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+3.75rem)] z-50 max-h-[70vh] overflow-y-auto rounded-2xl bg-card p-3 shadow-pop animate-in fade-in slide-in-from-top-1 duration-100 sm:absolute sm:inset-x-0 sm:top-full sm:-mt-px sm:rounded-t-none sm:rounded-b-2xl">
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
              <Link href="/saved" aria-label={tr('Saved listings & searches', 'Tin & tìm kiếm đã lưu')} title={tr('Saved listings & searches', 'Tin & tìm kiếm đã lưu')} aria-current={savedActive ? 'page' : undefined} className="relative hidden sm:flex h-10 w-10 items-center justify-center rounded-xl text-body transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer tap-44">
                <Heart className={cn('h-6 w-6 sm:h-7 sm:w-7', savedCount > 0 ? 'fill-brand text-brand' : savedActive && 'text-brand')} />
                {savedCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{savedCount > 9 ? '9+' : savedCount}</span>
                )}
                {savedActive && <span aria-hidden className="absolute -bottom-0.5 left-1/2 h-0.5 w-7 -translate-x-1/2 rounded-full bg-brand" />}
              </Link>
              <Link href="/messages" aria-label={tr('Messages', 'Tin nhắn')} aria-current={msgActive ? 'page' : undefined} className="relative hidden sm:flex h-10 w-10 items-center justify-center rounded-xl text-body transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer tap-44">
                <MessageSquare className={cn('h-6 w-6 sm:h-7 sm:w-7', unread > 0 ? 'fill-brand text-brand' : msgActive && 'text-brand')} />
                {unread > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>
                )}
                {msgActive && <span aria-hidden className="absolute -bottom-0.5 left-1/2 h-0.5 w-7 -translate-x-1/2 rounded-full bg-brand" />}
              </Link>
            </>
          )}
          <NotificationBell />
          {user ? (
            <div className="hidden sm:block"><AccountMenu /></div>
          ) : (
            <Link
              href="/signin"
              className="hidden sm:flex items-center gap-1.5 rounded-xl px-2.5 h-9 text-sm font-semibold text-body transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer tap-44 relative"
              aria-label={tr('Sign in', 'Đăng nhập')}
            >
              <User className="h-6 w-6 sm:h-7 sm:w-7" />
              <span className="hidden lg:inline">{tr('Log in', 'Đăng nhập')}</span>
            </Link>
          )}

          <Link
            href={user ? '/dashboard?tab=post' : '/post'}
            className="hidden items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-brand-dark sm:flex cursor-pointer"
          >
            {t('header.postBtn')}
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

      <AIConciergePanel open={aiMode} onClose={() => setAiMode(false)} />
    </header>
  )
}

