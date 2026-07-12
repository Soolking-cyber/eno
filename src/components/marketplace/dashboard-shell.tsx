'use client'

import Link from 'next/link'
import Image from 'next/image'
import {
  PlusCircle, List, Settings, Scale, Code2, LifeBuoy, CalendarCheck, Upload,
  MessageSquareText, Store, ArrowLeft,
} from 'lucide-react'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail,
  SidebarSeparator, SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar'
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { Avatar } from '@/components/ui/avatar'
import { TrustScore } from '@/components/marketplace/trust-score'
import { SignOutButton } from '@/components/marketplace/account-actions'
import { useLanguage } from '@/context/language-context'

export type DashTab = 'post' | 'listings' | 'account' | 'help' | 'dev' | 'disputes'

// Tab menu, split out so it can call useSidebar (needs the SidebarProvider
// context, which DashboardShell itself renders): on mobile the sidebar is a
// full-screen Sheet, so switching tabs must ALSO close it — otherwise the
// content changes invisibly behind the overlay.
function DashNav({ tabs, tab, onTab }: {
  tabs: { key: DashTab; label: string; icon: React.ElementType }[]
  tab: DashTab
  onTab: (t: DashTab) => void
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <SidebarMenu>
      {tabs.map((t) => (
        <SidebarMenuItem key={t.key}>
          <SidebarMenuButton
            isActive={tab === t.key}
            onClick={() => { onTab(t.key); if (isMobile) setOpenMobile(false) }}
            tooltip={t.label}
            className="cursor-pointer"
          >
            <t.icon />
            <span>{t.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

// The seller dashboard's app shell — shadcn sidebar block (collapsible on
// desktop, Sheet on mobile) wrapped around the existing tab-driven content.
// Navigation REUSES the ?tab= routing contract so the header account-menu deep
// links keep working; this component owns layout only, zero data logic.
export function DashboardShell({
  tab, onTab, isBusiness, unread, profile, seller, actions, children,
}: {
  tab: DashTab
  onTab: (t: DashTab) => void
  isBusiness: boolean
  unread: number
  profile: { name: string | null; email: string | null; avatarUrl: string | null; avatarColor?: string; trustScore?: number } | null
  seller: { handle: string | null; id: string } | null
  /** Right side of the breadcrumb header (e.g. storefront link + share). */
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const { tr } = useLanguage()

  const TABS: { key: DashTab; label: string; icon: React.ElementType; show?: boolean }[] = [
    { key: 'post', label: tr('Post', 'Đăng tin'), icon: PlusCircle },
    { key: 'listings', label: tr('Listings', 'Tin đăng'), icon: List },
    { key: 'account', label: tr('Settings', 'Cài đặt'), icon: Settings },
    { key: 'disputes', label: tr('Disputes', 'Khiếu nại'), icon: Scale },
    { key: 'dev', label: tr('Developers', 'Lập trình'), icon: Code2, show: isBusiness },
    { key: 'help', label: tr('Help', 'Trợ giúp'), icon: LifeBuoy },
  ]
  const active = TABS.find((t) => t.key === tab)

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              {/* Brand row — doubles as "back to the marketplace". */}
              <SidebarMenuButton render={<Link href="/" />} size="lg" tooltip={tr('Back to eno.vn', 'Về eno.vn')}>
                  <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                    <Image src="/logo-mark.svg" alt="eno" width={32} height={32} unoptimized />
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-sm font-bold text-sidebar-foreground">eno.vn</span>
                    <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                      <ArrowLeft className="h-3 w-3" /> {tr('Marketplace', 'Chợ')}
                    </span>
                  </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>{tr('Dashboard', 'Quản lý')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <DashNav tabs={TABS.filter((t) => t.show !== false)} tab={tab} onTab={onTab} />
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator />

          <SidebarGroup>
            <SidebarGroupLabel>{tr('Shortcuts', 'Lối tắt')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton render={<Link href="/messages" />} tooltip={tr('Messages', 'Tin nhắn')}>
                    <MessageSquareText />
                    <span>{tr('Messages', 'Tin nhắn')}</span>
                  </SidebarMenuButton>
                  {unread > 0 && <SidebarMenuBadge className="rounded-full bg-destructive px-1.5 text-3xs font-bold text-white">{unread}</SidebarMenuBadge>}
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton render={<Link href="/dashboard/availability" />} tooltip={tr('Availability review', 'Xác nhận còn hàng')}>
                    <CalendarCheck />
                    <span>{tr('Availability review', 'Xác nhận còn hàng')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {isBusiness && (
                  <SidebarMenuItem>
                    <SidebarMenuButton render={<Link href="/dashboard/bulk" />} tooltip={tr('Bulk upload', 'Tải hàng loạt')}>
                      <Upload />
                      <span>{tr('Bulk upload', 'Tải hàng loạt')}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {seller && (
                  <SidebarMenuItem>
                    <SidebarMenuButton render={<a href={seller.handle ? `/${seller.handle}` : `/sellers/${seller.id}`} />} tooltip={tr('View storefront', 'Xem gian hàng')}>
                      <Store />
                      <span>{tr('View storefront', 'Xem gian hàng')}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          {profile && (
            <div className="flex items-center gap-2 overflow-hidden px-1 py-1 group-data-[collapsible=icon]:justify-center">
              <Avatar name={profile.name || profile.email} url={profile.avatarUrl} color={profile.avatarColor} size="sm" />
              <div className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-xs font-bold text-sidebar-foreground">{profile.name || tr('Your account', 'Tài khoản')}</p>
                  {typeof profile.trustScore === 'number' && <TrustScore score={profile.trustScore} size="sm" href="/trust" />}
                </div>
                {profile.email && <p className="truncate text-2xs text-muted-foreground">{profile.email}</p>}
              </div>
            </div>
          )}
          <div className="group-data-[collapsible=icon]:hidden">
            <SignOutButton />
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden sm:block">
                <BreadcrumbLink render={<button onClick={() => onTab('listings')} className="cursor-pointer" />}>
                  {tr('Dashboard', 'Quản lý')}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:block" />
              <BreadcrumbItem>
                {/* The active tab is the page's h1 (the removed identity header
                    used to carry it; the shell keeps exactly one per page). */}
                <h1 aria-current="page" className="text-sm font-semibold text-foreground">{active?.label}</h1>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
        </header>
        <div className="flex-1 px-3 pb-12 sm:px-6 lg:px-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
