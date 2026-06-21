'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Plus, User, Search, MapPin } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { cn } from '@/lib/utils'
import { AccountMenu } from './account-menu'
import { CustomSelect } from './custom-select'
import { NotificationBell } from './notification-bell'
import { DISTRICTS } from './listings-explorer.constants'

export function Header() {
  const { t, tr, lang } = useLanguage()
  const { user } = useAuth()
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
  const [area, setArea] = useState('all')

  // Seed the controls from the URL so a revealed search reflects the active query.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    setSearchVal(p.get('q') || '')
    setArea(p.get('district') || 'all')
  }, [pathname])

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

  const submitDistrict = (slug: string) => {
    setArea(slug)
    if (isExplorerPage) {
      window.dispatchEvent(new CustomEvent('eno:set-district', { detail: { district: slug } }))
    } else {
      router.push(slug && slug !== 'all' ? `/?district=${slug}` : '/')
    }
  }

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b border-slate-200/60 bg-card pt-[env(safe-area-inset-top)] transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none',
        hidden ? '-translate-y-full lg:translate-y-0' : 'translate-y-0',
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 sm:gap-3 px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center" aria-label="ENO">
          <img src="/logo-mark.svg" alt="ENO" width={40} height={40} className="h-10 w-10" />
        </Link>

        {showSearch ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 animate-in fade-in duration-200">
            {/* Area selector — icon-only on mobile, labelled on desktop */}
            <CustomSelect
              value={area}
              onChange={submitDistrict}
              options={DISTRICTS.map((d) => ({ value: d.slug, label: lang === 'vi' ? d.name : d.nameEn }))}
              placeholder={tr('Area', 'Khu vực')}
              icon={<MapPin className="h-4 w-4 shrink-0 text-[#0a66c2]" />}
              wrapperClassName="shrink-0"
              className="w-auto px-2.5 py-2"
              labelClassName="hidden sm:inline"
            />

            {/* Search */}
            <form onSubmit={(e) => { e.preventDefault(); submitSearch(searchVal) }} className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
              <input
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                autoComplete="off"
                placeholder={tr('Find products…', 'Tìm sản phẩm…')}
                aria-label={tr('Search', 'Tìm kiếm')}
                className="w-full rounded-full bg-[#f1f5f9] py-2.5 pl-9 pr-3 text-sm text-[#1a202c] outline-none transition-all placeholder:text-[#94a3b8] focus:bg-white focus:ring-2 focus:ring-[#0a66c2]/20"
              />
            </form>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        {/* Actions. The notification bell shows on ALL sizes (top-right, per the
            Chợ Tốt pattern); account + Post are desktop-only (mobile uses the bottom nav). */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <NotificationBell />
          {user ? (
            <div className="hidden sm:block"><AccountMenu /></div>
          ) : (
            <Link
              href="/signin"
              className="hidden sm:flex items-center gap-1.5 rounded-full px-2.5 h-9 text-sm font-semibold text-[#1a202c] transition-colors hover:bg-[#e8f1fb] hover:text-[#0a66c2] cursor-pointer"
              aria-label={tr('Sign in', 'Đăng nhập')}
            >
              <User className="h-5 w-5" />
              <span className="hidden lg:inline">{tr('Log in', 'Đăng nhập')}</span>
            </Link>
          )}

          <Link
            href="/post"
            className="hidden items-center gap-1.5 rounded-full bg-[#0a66c2] px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-[#004182] sm:flex cursor-pointer"
          >
            <Plus className="h-4 w-4" /> {t('header.postBtn')}
          </Link>
        </div>
      </div>
    </header>
  )
}
