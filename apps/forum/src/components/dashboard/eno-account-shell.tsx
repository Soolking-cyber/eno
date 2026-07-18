'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  CircleHelp,
  ExternalLink,
  FileCheck2,
  Heart,
  Languages,
  LayoutDashboard,
  LogOut,
  ListChecks,
  MessageSquareText,
  Monitor,
  Moon,
  Route,
  PanelLeft,
  Scale,
  Settings,
  ShoppingBag,
  Store,
  Sun,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { LANGUAGES, useLanguage } from '@/context/language-context'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { useTheme, type Theme } from '@/context/theme-context'

const MARKETPLACE_URL = (process.env.NEXT_PUBLIC_MARKETPLACE_URL || 'https://eno.vn').replace(/\/$/, '')
const EXPANDED_STORAGE_KEY = 'eno-account-sidebar-expanded'

type AccountShellContextValue = {
  openAccount: () => void
  closeAccount: () => void
  expanded: boolean
}

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
  external?: boolean
}

const AccountShellContext = createContext<AccountShellContextValue>({
  openAccount: () => {},
  closeAccount: () => {},
  expanded: false,
})

export function useEnoAccountShell() {
  return useContext(AccountShellContext)
}

export function EnoAccountShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { user, openSignIn } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const restored = useRef(false)
  const isAdmin = pathname?.startsWith('/admin') ?? false

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!user) setMobileOpen(false)
  }, [user])

  useEffect(() => {
    try {
      setExpanded(window.localStorage.getItem(EXPANDED_STORAGE_KEY) === 'true')
    } finally {
      restored.current = true
    }
  }, [])

  useEffect(() => {
    if (!restored.current) return
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, String(expanded))
  }, [expanded])

  const openAccount = useCallback(() => {
    if (!user) {
      openSignIn()
      return
    }
    if (window.matchMedia('(min-width: 64rem)').matches) setExpanded(true)
    else setMobileOpen(true)
  }, [openSignIn, user])
  const closeAccount = useCallback(() => setMobileOpen(false), [])

  const value = { openAccount, closeAccount, expanded }
  if (isAdmin) return <AccountShellContext.Provider value={value}>{children}</AccountShellContext.Provider>

  return (
    <AccountShellContext.Provider value={value}>
      <div
        data-testid="eno-account-shell-content"
        className={cn(
          'transition-[padding] duration-200 motion-reduce:transition-none',
          user && (expanded ? 'lg:pl-[280px] lg:pr-[var(--account-w)]' : 'lg:px-[var(--account-w)]'),
        )}
        style={{ transitionTimingFunction: 'var(--ease-spring)' }}
      >
        {children}
      </div>
      {user && (
        <EnoAccountPanel
          mobileOpen={mobileOpen}
          expanded={expanded}
          setExpanded={setExpanded}
          onClose={closeAccount}
        />
      )}
    </AccountShellContext.Provider>
  )
}

function EnoAccountPanel({
  mobileOpen,
  expanded,
  setExpanded,
  onClose,
}: {
  mobileOpen: boolean
  expanded: boolean
  setExpanded: (value: boolean | ((current: boolean) => boolean)) => void
  onClose: () => void
}) {
  const pathname = usePathname()
  const { user, signOut } = useAuth()
  const { tr, lang, setLang } = useLanguage()
  const { theme, setTheme } = useTheme()
  const panelRef = useFocusTrap<HTMLElement>(mobileOpen)

  useEffect(() => {
    if (!mobileOpen) return
    const body = document.body
    const previousOverflow = body.style.overflow
    const previousOverscroll = body.style.overscrollBehavior
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    return () => {
      body.style.overflow = previousOverflow
      body.style.overscrollBehavior = previousOverscroll
    }
  }, [mobileOpen])

  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen, onClose])

  useEffect(() => {
    if (!expanded) return
    const onPointerDown = (event: PointerEvent) => {
      if (!window.matchMedia('(min-width: 64rem)').matches) return
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setExpanded(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [expanded, panelRef, setExpanded])

  const closeOnMobile = () => {
    if (!window.matchMedia('(min-width: 64rem)').matches) onClose()
  }
  const active = (item: NavItem) => !item.external && (item.exact
    ? pathname === item.href
    : pathname === item.href || (pathname?.startsWith(`${item.href}/`) ?? false))
  const navItemClass = (isActive: boolean) => cn(
    'flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/60',
    expanded ? 'lg:justify-start lg:gap-3 lg:px-3.5' : 'lg:justify-center lg:gap-0 lg:px-0',
    isActive && 'bg-secondary hover:bg-secondary',
  )
  const labelClass = cn(
    'max-w-[180px] overflow-hidden whitespace-nowrap opacity-100 transition-[max-width,opacity] duration-200',
    expanded ? 'lg:max-w-[180px] lg:opacity-100' : 'lg:max-w-0 lg:opacity-0',
  )

  // Unified rail hierarchy — the SAME two groups, same order, on both eno.vn and eno.forum;
  // here Marketplace links are absolute eno.vn URLs and Community links are internal.
  const navGroups: Array<{ caption: string; items: NavItem[] }> = [
    {
      caption: tr('Marketplace', 'Chợ eno'),
      items: [
        { href: MARKETPLACE_URL, label: tr('eno marketplace', 'Chợ eno'), icon: ShoppingBag, external: true },
        { href: `${MARKETPLACE_URL}/dashboard/listings`, label: tr('My listings', 'Tin của tôi'), icon: Store, external: true },
        { href: `${MARKETPLACE_URL}/messages`, label: tr('Messages', 'Tin nhắn'), icon: MessageSquareText, external: true },
        { href: `${MARKETPLACE_URL}/saved`, label: tr('Saved', 'Đã lưu'), icon: Heart, external: true },
        { href: `${MARKETPLACE_URL}/dashboard/availability`, label: tr('Availability review', 'Xác nhận còn hàng'), icon: ListChecks, external: true },
        { href: `${MARKETPLACE_URL}/dashboard/disputes`, label: tr('Disputes', 'Khiếu nại'), icon: Scale, external: true },
      ],
    },
    {
      caption: tr('Community', 'Cộng đồng'),
      items: [
        { href: '/', label: tr('Community forum', 'Diễn đàn cộng đồng'), icon: UsersRound, exact: true },
        { href: '/itinerary', label: tr('Itinerary planner', 'Lập lịch trình'), icon: Route },
        { href: '/visa', label: tr('Vietnam e-Visa', 'E-Visa Việt Nam'), icon: FileCheck2 },
        { href: '/dashboard', label: tr('Dashboard', 'Bảng điều khiển'), icon: LayoutDashboard, exact: true },
      ],
    },
  ]
  const themes: Array<{ value: Theme; label: string; icon: LucideIcon }> = [
    { value: 'system', label: tr('System', 'Hệ thống'), icon: Monitor },
    { value: 'light', label: tr('Light', 'Sáng'), icon: Sun },
    { value: 'dark', label: tr('Dark', 'Tối'), icon: Moon },
  ]

  const renderNav = (item: NavItem) => {
    const Icon = item.icon
    const isActive = active(item)
    const content = (
      <>
        <Icon className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
        <span className={labelClass}>{item.label}</span>
        {item.external && <ExternalLink className={cn('ml-auto h-3.5 w-3.5 text-ink-4', expanded ? 'lg:block' : 'lg:hidden')} aria-hidden />}
      </>
    )
    const control = item.external ? (
      <a href={item.href} aria-label={item.label} className={navItemClass(false)} onClick={closeOnMobile}>{content}</a>
    ) : (
      <Link href={item.href} aria-label={item.label} aria-current={isActive ? 'page' : undefined} className={navItemClass(isActive)} onClick={closeOnMobile}>{content}</Link>
    )
    return <Tooltip key={item.href} content={expanded ? undefined : item.label} side="right">{control}</Tooltip>
  }

  if (!user) return null
  const displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || tr('eno member', 'thành viên eno')
  const avatarUrl = user.user_metadata?.avatar_url as string | undefined

  return (
    <aside
      ref={panelRef}
      data-testid="eno-account-panel"
      data-expanded={expanded ? 'true' : 'false'}
      role={mobileOpen ? 'dialog' : undefined}
      aria-modal={mobileOpen ? true : undefined}
      aria-label={tr('eno account and services', 'Tài khoản và dịch vụ eno')}
      tabIndex={-1}
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-full flex-col overflow-hidden bg-background transition-[opacity,visibility] duration-150 motion-reduce:transition-none',
        mobileOpen ? 'visible opacity-100' : 'invisible opacity-0',
        'lg:visible lg:w-[var(--account-w)] lg:translate-x-0 lg:opacity-100 lg:transition-[width,background-color] lg:duration-200',
        expanded ? 'lg:w-[280px] lg:bg-background' : 'lg:bg-muted/10',
      )}
      style={{ transitionTimingFunction: 'var(--ease-spring)' }}
    >
      <div className="flex shrink-0 justify-end p-3 pt-[max(.75rem,env(safe-area-inset-top))] lg:hidden">
        <IconButton onClick={onClose} aria-label={tr('Close account menu', 'Đóng menu tài khoản')} size="sm" className="text-ink-4 transition-colors hover:bg-secondary hover:text-foreground">
          <X className="h-5 w-5" />
        </IconButton>
      </div>

      <div className="hidden shrink-0 px-3 pt-3 lg:block">
        <Tooltip content={expanded ? undefined : tr('Expand menu', 'Mở rộng menu')} side="right">
          <Button
            data-testid="eno-sidebar-toggle"
            type="button"
            variant="bare"
            size="none"
            onClick={() => setExpanded((current) => !current)}
            aria-label={expanded ? tr('Collapse sidebar', 'Thu gọn thanh bên') : tr('Expand sidebar', 'Mở rộng thanh bên')}
            aria-expanded={expanded}
            className={cn(navItemClass(false), 'group/toggle text-ink-4 hover:text-foreground')}
          >
            <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
              {!expanded && <img src="/logo-mark.svg" alt="" aria-hidden className="absolute inset-0 h-5 w-5 transition-opacity duration-150 group-hover/toggle:opacity-0" />}
              <PanelLeft
                strokeWidth={2}
                aria-hidden
                className={cn('h-5 w-5 transition-opacity duration-150', expanded ? 'opacity-100' : 'absolute inset-0 opacity-0 group-hover/toggle:opacity-100')}
              />
            </span>
            <span className={labelClass}>{tr('Collapse', 'Thu gọn')}</span>
          </Button>
        </Tooltip>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 pb-3 pt-3 lg:pt-2">
        <nav aria-label={tr('eno services', 'Dịch vụ eno')} className="space-y-4">
          {navGroups.map((group) => (
            <div key={group.caption}>
              {/* Captions hide on the collapsed desktop rail; space-y-4 still separates the groups. */}
              <p className={cn('px-3.5 pb-1 text-2xs font-bold uppercase tracking-wider text-ink-4', expanded ? 'lg:block' : 'lg:hidden')}>
                {group.caption}
              </p>
              <div className="space-y-1">{group.items.map(renderNav)}</div>
            </div>
          ))}
        </nav>

        <div className="mt-auto space-y-1 pt-3">
          <div className={cn('flex items-center gap-3 rounded-2xl px-3 py-2', expanded ? 'lg:justify-start lg:gap-3 lg:px-3' : 'lg:justify-center lg:gap-0 lg:px-0')}>
            <Avatar name={displayName} url={avatarUrl} size="md" className="h-9 w-9 text-xs" />
            <div className={cn('min-w-0 max-w-[180px] flex-1 overflow-hidden opacity-100 transition-[max-width,opacity] duration-200', expanded ? 'lg:max-w-[180px] lg:opacity-100' : 'lg:max-w-0 lg:opacity-0')}>
              <p className="truncate text-sm font-bold text-foreground">{displayName}</p>
              {user.email && <p className="truncate text-xs text-ink-4">{user.email}</p>}
            </div>
          </div>

          {renderNav({ href: `${MARKETPLACE_URL}/dashboard/settings`, label: tr('Settings', 'Cài đặt'), icon: Settings, external: true })}
          {renderNav({ href: `${MARKETPLACE_URL}/dashboard/help`, label: tr('Help', 'Trợ giúp'), icon: CircleHelp, external: true })}

          <div className={cn('px-1 pt-1', expanded ? 'lg:block' : 'lg:hidden')}>
            <DropdownMenu>
              <DropdownMenuTrigger render={
                <Button type="button" variant="bare" size="none" className="flex h-11 w-full items-center justify-between rounded-xl px-3 text-sm text-body hover:bg-muted" aria-label={tr('Choose language', 'Chọn ngôn ngữ')}>
                  <span className="flex items-center gap-2"><Languages className="h-4 w-4" />{tr('Language', 'Ngôn ngữ')}</span>
                  <span className="text-xs font-bold">{LANGUAGES.find((item) => item.code === lang)?.label}</span>
                </Button>
              } />
              <DropdownMenuContent align="start" className="w-56">
                {LANGUAGES.map((language) => (
                  <DropdownMenuItem key={language.code} onClick={() => setLang(language.code)}>
                    <span className="w-7 text-xs font-bold text-ink-4">{language.label}</span>
                    <span className="min-w-0 flex-1 truncate">{language.native}</span>
                    {lang === language.code && <Check className="ml-auto h-4 w-4 text-accent-foreground" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger render={
                <Button type="button" variant="bare" size="none" className="flex h-11 w-full items-center justify-between rounded-xl px-3 text-sm text-body hover:bg-muted" aria-label={tr('Choose display theme', 'Chọn giao diện')}>
                  <span className="flex items-center gap-2"><Sun className="h-4 w-4" />{tr('Display', 'Giao diện')}</span>
                  <span className="text-xs font-bold">{themes.find((item) => item.value === theme)?.label}</span>
                </Button>
              } />
              <DropdownMenuContent align="start" className="w-56">
                {themes.map((item) => {
                  const Icon = item.icon
                  return (
                    <DropdownMenuItem key={item.value} onClick={() => setTheme(item.value)}>
                      <Icon className="h-4 w-4 text-ink-4" />
                      <span className="min-w-0 flex-1">{item.label}</span>
                      {theme === item.value && <Check className="ml-auto h-4 w-4 text-accent-foreground" />}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Tooltip content={expanded ? undefined : tr('Sign out', 'Đăng xuất')} side="right">
            <Button
              type="button"
              variant="bare"
              size="none"
              onClick={() => { onClose(); void signOut() }}
              aria-label={tr('Sign out', 'Đăng xuất')}
              className={cn(navItemClass(false), 'text-destructive hover:bg-destructive/10 hover:text-destructive')}
            >
              <LogOut className="h-5 w-5 shrink-0" strokeWidth={2} />
              <span className={labelClass}>{tr('Sign out', 'Đăng xuất')}</span>
            </Button>
          </Tooltip>
        </div>
      </div>
    </aside>
  )
}
