'use client'

import { useEffect, useRef, useTransition } from 'react'

import { useRouter } from 'next/navigation'

import Link from 'next/link'
import type { MouseEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowBigUp,
  ChevronRight,
  FileCheck2,
  MapPinned,
  MessageCircle,
  MessageCircleQuestion,
  Route,
  Sparkles,
  Store,
} from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { hapticTap } from '@/lib/haptics'
import { FORUM_URL, goToForum } from '@/lib/forum-nav'
import type { ForumVisaResult } from '@/lib/forum-visa'
import { timeAgo } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatCount, formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { ForumActivity } from './forum/forum-client'
import { TripCard, type SavedItinerary } from './trips/trip-card'
import { STATUS as VISA_STATUS } from './visa/visa-client'

/** /dashboard HOME — THE canonical dashboard, rendered identically on both eno properties
 *  (owner 2026-07-18): welcome header + the canonical FOUR "eno services" cards + the
 *  1.45fr/.75fr content grid — LEFT Marketplace then Saved itineraries (TripCard's
 *  EXPANDABLE rows, same as the forum dashboard), RIGHT Visa applications then Forum
 *  activity. Marketplace data reads the SAME shared store the nav rail uses
 *  (useDashboard/useChat) plus the server-loaded saves aggregate; forum/trips/visa arrive
 *  server-loaded from page.tsx and fail soft into each card's empty body. The full
 *  experiences stay on their own sections (/dashboard/listings·forum·trips·visa).
 *
 *  MOBILE = a native-app dashboard SCREEN (owner "rebuild mobile dashboard natively"):
 *  the SAME tree, breakpoint-scoped with the repo's pc/mobile variants (mobile includes
 *  tablets — globals.css). Where the two designs diverge structurally, the desktop markup
 *  is kept BYTE-IDENTICAL inside `hidden pc:*` wrappers and a mobile counterpart renders
 *  under `pc:hidden`: greeting row instead of badge+big-h1, app-launcher icon grid instead
 *  of detail service cards, a snap strip for the marketplace stats, and native list rows
 *  (full-row tap target · leading icon/thumb · trailing chevron · hairline separators ·
 *  .press + hapticTap) instead of the tinted desktop rows. Card headers become the tap
 *  target on mobile (chevron), replacing the desktop "Open" buttons. */

// Canonical forum thread URL shape — same as forum-client (the forum routes threads off
// the ?post query param, not a path segment).
function threadPath(postId: string): string {
  return `/?post=${encodeURIComponent(postId)}`
}

// Cross-site anchor idiom copied from account-panel: the href stays a REAL plain URL for
// a11y / middle-click / cmd-click; a normal left-click is intercepted so goToForum can
// route natives through the single-use SSO handoff (web just location.assigns the same URL).
function forumClick(path: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    goToForum(path)
  }
}

// The forum dashboard's ServiceCard (shared tokens/primitives), now rendering BOTH
// breakpoint faces from one declaration: on pc the bg-card ring tile with the h-11 accent
// icon chip and a hover lift (byte-identical to the original); on mobile an app-launcher
// chip — accent icon tile + text-2xs label, the home category grid's app-like idiom —
// with .press + hapticTap and the detail line dropped. Every card is an INTERNAL Link
// (core-dashboard navigation never crosses to eno.forum — the sections' own CTAs carry
// the explicit goToForum handoffs).
function ServiceCard({ href, icon: Icon, title, short, detail }: {
  href: string
  icon: LucideIcon
  title: string
  /** Launcher-grid label — must survive text-2xs under a quarter-width column. */
  short: string
  detail: string
}) {
  const cardClassName =
    'hidden min-h-24 items-start gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pc:flex'
  const chipClassName =
    'press flex flex-col items-center gap-1.5 rounded-2xl py-1 text-center focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pc:hidden'
  const cardContent = (
    <>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-bold text-foreground">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-body">{detail}</span>
      </span>
    </>
  )
  const chipContent = (
    <>
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <Icon className="h-6 w-6" />
      </span>
      <span className="text-2xs font-semibold leading-tight text-foreground">{short}</span>
    </>
  )
  return (
    <>
      <Link href={href} onClick={() => hapticTap()} className={chipClassName}>{chipContent}</Link>
      <Link href={href} className={cardClassName}>{cardContent}</Link>
    </>
  )
}

// The card-header "Open" affordance — outline button linking to the full section.
// Desktop-only: on mobile the group header itself is the doorway (CardTitleLink below),
// so the button hides rather than doubling the same navigation.
function OpenButton({ href, label }: { href: string; label: string }) {
  return (
    <CardAction className="hidden pc:block">
      <Button asChild variant="outline" size="sm">
        <Link href={href}>{label}</Link>
      </Button>
    </CardAction>
  )
}

// Card title that is ALSO the mobile tap target: on mobile the whole header row is a
// native group-header link (≥48px hit via tap-48, trailing chevron, .press + hapticTap)
// navigating where the desktop "Open" button goes; on pc it renders the plain title span,
// byte-identical to before. One CardTitle element either way (heading semantics intact).
function CardTitleLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <CardTitle>
      <Link
        href={href}
        onClick={() => hapticTap()}
        className="press relative tap-48 flex items-center justify-between gap-2 pc:hidden"
      >
        {children}
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
      </Link>
      <span className="hidden pc:block">{children}</span>
    </CardTitle>
  )
}

// Marketplace stat tile — bg-tint row that doubles as the doorway to its section.
// `className`/`onClick` exist for the mobile snap-strip copies (min-w + snap + press +
// haptic); desktop call sites pass nothing, keeping their class list unchanged.
function StatTile({ href, value, label, className, onClick }: {
  href: string
  value: string | number
  label: string
  className?: string
  onClick?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn('block rounded-xl bg-tint px-3 py-3 transition-colors hover:bg-muted', className)}
    >
      <span className="block truncate text-lg font-bold tabular-nums text-foreground">{value}</span>
      <span className="mt-0.5 block text-xs text-body">{label}</span>
    </Link>
  )
}

// The forum dashboard's bg-tint empty-state body (icon + bold title + xs subtitle).
function TintEmpty({ icon: Icon, title, subtitle, action }: {
  icon: LucideIcon
  title: string
  subtitle: string
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl bg-tint px-5 py-8 text-center">
      <Icon className="mx-auto h-6 w-6 text-accent-foreground" />
      <p className="mt-3 font-bold">{title}</p>
      <p className="mt-1 text-xs text-body">{subtitle}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

// Below-fold card treatment: the scroll-driven reveal is a MOBILE-screen touch — pc must
// stay byte-identical, and `.reveal-on-scroll` is a plain (unlayered) globals class that a
// layered utility can only beat with `!`, hence `pc:animate-none!`. The reveal itself is
// already reduced-motion-safe (globals wraps it in prefers-reduced-motion: no-preference).
const REVEAL = 'reveal-on-scroll pc:animate-none!'

export function HomeClient({ forum, trips, visa, saves }: {
  forum: ForumActivity | null
  trips: SavedItinerary[] | null
  visa: ForumVisaResult
  saves: number | null
}) {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const { tr, lang } = useLanguage()
  const { dash, loading: dashLoading, refresh: refreshDash } = useDashboard()

  // Same cross-tab account-switch guard as the section clients: the server-loaded
  // forum/trips/visa props belong to the account that rendered them — hide them and
  // refresh when the session user changes underneath this open page.
  const [switching, startSwitch] = useTransition()
  const lastUid = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (user?.id && lastUid.current && user.id !== lastUid.current) startSwitch(() => router.refresh())
    if (user?.id) lastUid.current = user.id
  }, [user?.id, router])
  const { unread } = useChat()
  const locale = moneyLocale(lang)

  // Auth race gate, like every other section (client auth may still be resolving).
  if (authLoading || switching) {
    return (
      <div role="status" className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
        <span className="sr-only">{tr('Loading account', 'Đang tải tài khoản')}</span>
      </div>
    )
  }

  // Signed-out: the forum dashboard's centered welcome Card, with the CTA adapted to
  // eno.vn's sign-in page (the sections redirect instead; the HOME sells the account).
  // Mobile tightens: smaller heading, less vertical padding, full-width 48px CTA.
  if (!user) {
    return (
      <div className="mx-auto flex min-h-[55vh] w-full max-w-3xl items-center py-8">
        <Card className="w-full items-center px-5 py-8 text-center pc:py-10">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <Sparkles className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight pc:text-3xl">{tr('Your eno dashboard', 'Bảng điều khiển eno của bạn')}</h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-body">
            {tr(
              'Sign in with your shared eno account to access your listings, messages, itineraries, visa applications and forum activity in one place.',
              'Đăng nhập bằng tài khoản eno dùng chung để truy cập tin đăng, tin nhắn, lịch trình, hồ sơ visa và hoạt động diễn đàn tại một nơi.',
            )}
          </p>
          <Button variant="cta" className="mt-5 h-12 w-full pc:h-11 pc:w-auto" asChild>
            <Link href="/signin?next=/dashboard" onClick={() => hapticTap()}>{tr('Sign in to eno', 'Đăng nhập eno')}</Link>
          </Button>
        </Card>
      </div>
    )
  }

  const displayName =
    dash?.profile.businessName || dash?.profile.displayName || user.email?.split('@')[0] || user.phone || tr('eno member', 'thành viên eno')
  const initial = displayName.charAt(0).toUpperCase()
  const activeCount = dash ? dash.listings.filter((l) => l.status === 'active').length : 0
  // The forum loader takes 20 per group — an exact length up to there, honest "20+" past it.
  const capped = (n: number) => (n >= 20 ? '20+' : String(n))
  const forumTotal = forum ? forum.posts.length + forum.comments.length + forum.saved.length : 0
  // Same status wording + tones as dashboard-listing-row, so a listing never reads
  // differently on the home vs. the listings section. Shared by BOTH breakpoint row trees.
  const chipFor = (l: { verified: boolean; status: string }) =>
    !l.verified && l.status === 'active'
      ? { label: tr('Held', 'Đang giữ'), variant: 'warning' as const, className: undefined }
      : l.status === 'sold'
        ? { label: tr('Sold', 'Đã bán'), variant: 'neutral' as const, className: 'text-muted-foreground' }
        : l.status === 'hidden'
          ? { label: tr('Hidden', 'Đã ẩn'), variant: 'neutral' as const, className: 'text-muted-foreground' }
          : { label: tr('Live', 'Đang hiển thị'), variant: 'brand' as const, className: undefined }
  const listingTitle = (l: { title: string; titleVi: string | null }) => (lang === 'vi' ? l.titleVi || l.title : l.title)
  // The marketplace stat tiles, once — rendered into the desktop 4-up grid AND the
  // mobile snap strip below. 'Saves' is the SERVER sum of the user's listings' savedCount
  // (page.tsx aggregate), NOT the device-local favorites count: that one can't cross
  // origins and is a buyer metric, not a seller one. null = aggregate failed → honest em
  // dash, tile stays a doorway.
  const marketStats = dash
    ? [
        { href: '/dashboard/listings', value: activeCount as string | number, label: tr('Active listings', 'Tin đang đăng') },
        { href: '/messages', value: unread, label: tr('Unread messages', 'Tin nhắn chưa đọc') },
        { href: '/dashboard/listings', value: saves === null ? '—' : formatCount(saves, locale), label: tr('Saves', 'Lượt lưu') },
        {
          href: '/dashboard/listings',
          value: `${formatCount(dash.stats.totalViews, locale)} / ${formatCount(dash.stats.totalLeads, locale)}`,
          label: tr('Views / leads', 'Lượt xem / liên hệ'),
        },
      ]
    : []

  return (
    <>
      {/* Header: on mobile a native greeting row — avatar-or-initial chip + a tight
          text-xl h1, badge and marketing subline hidden (native apps don't carry them).
          On pc the inner div flattens (pc:contents) so badge/h1/subline stack exactly
          as before. One h1 either way (a11y/SEO). */}
      <div className="flex items-center gap-3 pc:block">
        <span className="shrink-0 pc:hidden" aria-hidden>
          {dash?.profile.avatarUrl ? (
            <img src={dash.profile.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-lg font-bold text-white">{initial}</span>
          )}
        </span>
        <div className="min-w-0 flex-1 pc:contents">
          <Badge variant="brand" className="hidden pc:inline-flex">{tr('One eno account', 'Một tài khoản eno')}</Badge>
          <h1 className="truncate text-xl font-bold tracking-tight pc:mt-3 pc:overflow-visible pc:whitespace-normal pc:text-4xl">{tr('Welcome', 'Chào')}, {displayName}</h1>
          <p className="mt-2 hidden max-w-2xl text-sm leading-relaxed text-body pc:block">
            {tr(
              'Your Vietnam plans, applications, community, and marketplace tools—together.',
              'Kế hoạch Việt Nam, hồ sơ, cộng đồng và công cụ chợ mua bán—tất cả tại một nơi.',
            )}
          </p>
        </div>
      </div>

      <section aria-labelledby="eno-services" className="mt-7">
        <h2 id="eno-services" className="text-lg font-bold">{tr('eno services', 'Dịch vụ eno')}</h2>
        {/* The canonical FOUR, canonical order (both properties): forum · planner · visa
            · marketplace. Each SELECTS its internal dashboard section (the one-dashboard
            model — no cross-site hop from the home); the marketplace card is this site's
            own front page. The sections themselves carry the explicit "Open the forum/
            planner/assistant" handoff CTAs. Each ServiceCard emits its mobile launcher
            chip AND its pc detail card; the grid is 4-up icon columns on mobile, today's
            gap-3 4-up card row on pc. */}
        <div className="mt-3 grid grid-cols-4 gap-2 pc:gap-3">
          <ServiceCard
            href="/dashboard/forum"
            icon={MessageCircleQuestion}
            title={tr('Community forum', 'Diễn đàn cộng đồng')}
            short={tr('Forum', 'Diễn đàn')}
            detail={tr('Ask, answer, and share useful Vietnam experience.', 'Hỏi, trả lời và chia sẻ kinh nghiệm hữu ích tại Việt Nam.')}
          />
          <ServiceCard
            href="/dashboard/trips"
            icon={Route}
            title={tr('Itinerary planner', 'Lập lịch trình')}
            short={tr('Planner', 'Lịch trình')}
            detail={tr('Research a practical trip; every completed plan saves automatically.', 'Nghiên cứu chuyến đi thực tế; mọi kế hoạch hoàn tất đều tự động lưu.')}
          />
          <ServiceCard
            href="/dashboard/visa"
            icon={FileCheck2}
            title={tr('Vietnam e-Visa', 'E-Visa Việt Nam')}
            short={tr('e-Visa', 'E-Visa')}
            detail={tr('Prepare, review, and track your private application.', 'Chuẩn bị, kiểm tra và theo dõi hồ sơ riêng tư.')}
          />
          <ServiceCard
            href="/"
            icon={Store}
            title={tr('eno marketplace', 'Chợ eno')}
            short={tr('Market', 'Chợ eno')}
            detail={tr('Find local products and services across Vietnam.', 'Tìm sản phẩm và dịch vụ địa phương trên khắp Việt Nam.')}
          />
        </div>
      </section>

      {/* grid-cols-[minmax(0,1fr)] on MOBILE is load-bearing: the implicit single track is
          min-content-sized, and the stat snap strip's non-shrinking 40vw tiles (~744px of
          min-content) would blow the track — and the whole layout viewport — past the phone
          (mobile browsers then zoom out to fit: the "tiny desktop soup" bug). minmax(0,…)
          lets the track shrink so overflow-x-auto can actually scroll. Same reason the lg
          tracks already carry minmax(0,…). min-w-0 on the columns is the belt. */}
      <div className="mt-7 grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,.75fr)] *:min-w-0">
        {/* LEFT (wide) — canonical order: marketplace, then saved itineraries. */}
        <div className="space-y-5">
          <Card className={REVEAL}>
            <CardHeader>
              <CardTitleLink href="/dashboard/listings">{tr('Marketplace', 'Chợ eno')}</CardTitleLink>
              <CardDescription className="text-xs">
                {tr('Your listings, messages and buyer demand.', 'Tin đăng, tin nhắn và nhu cầu người mua.')}
              </CardDescription>
              <OpenButton href="/dashboard/listings" label={tr('Open', 'Mở')} />
            </CardHeader>
            <CardContent>
              {!dash && dashLoading ? (
                <div className="space-y-2.5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 rounded-xl" />
                  ))}
                </div>
              ) : !dash ? (
                /* Fetch finished empty-handed — skeletons forever would read as loading. */
                <div className="rounded-2xl bg-tint px-5 py-8 text-center">
                  <p className="font-bold">{tr("Couldn't load your marketplace data", 'Không tải được dữ liệu chợ của bạn')}</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={refreshDash}>
                    {tr('Try again', 'Thử lại')}
                  </Button>
                </div>
              ) : (
                <>
                  {/* pc: today's 4-up tile grid, unchanged. */}
                  <div className="hidden grid-cols-2 gap-2 sm:grid-cols-4 pc:grid">
                    {marketStats.map((s) => (
                      <StatTile key={s.label} href={s.href} value={s.value} label={s.label} />
                    ))}
                  </div>
                  {/* mobile: horizontal SNAP strip (home-feed shelf idiom) — momentum
                      scroll, no scrollbar, ~40vw tiles, edge-bled to the card padding. */}
                  <div className="bubble-in -mx-(--card-spacing) flex snap-x snap-mandatory gap-2 overflow-x-auto px-(--card-spacing) scrollbar-none pc:hidden">
                    {marketStats.map((s) => (
                      <StatTile
                        key={s.label}
                        href={s.href}
                        value={s.value}
                        label={s.label}
                        className="press min-w-[40vw] shrink-0 snap-start"
                        onClick={() => hapticTap()}
                      />
                    ))}
                  </div>
                  {dash.listings.length === 0 ? (
                    <div className="mt-3">
                      <TintEmpty
                        icon={Store}
                        title={tr('No listings yet', 'Chưa có tin nào')}
                        subtitle={tr('Post your first listing and manage it here.', 'Đăng tin đầu tiên và quản lý tại đây.')}
                        action={
                          <Button variant="cta" size="sm" asChild>
                            <Link href="/post">{tr('Post a listing', 'Đăng tin')}</Link>
                          </Button>
                        }
                      />
                    </div>
                  ) : (
                    <>
                      {/* pc: today's tinted rows, unchanged. loading=lazy keeps the
                          display:none copy from double-fetching thumbs on mobile
                          (a lazy image with no box is never loaded). */}
                      <div className="mt-3 hidden space-y-2 pc:block">
                        {dash.listings.slice(0, 5).map((l) => {
                          const chip = chipFor(l)
                          return (
                            <Link
                              key={l.id}
                              href="/dashboard/listings"
                              className="flex items-center gap-3 rounded-xl bg-tint px-3 py-2.5 transition-colors hover:bg-muted"
                            >
                              {l.images[0] ? (
                                <img src={l.images[0]} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                              ) : (
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                                  <Store className="h-4 w-4" />
                                </span>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-foreground">{listingTitle(l)}</span>
                                <span className="mt-0.5 block text-xs text-body">
                                  {formatMoneyFull(l.price, l.currency, locale)} · {timeAgo(l.postedAt, lang)}
                                </span>
                              </span>
                              <Badge variant={chip.variant} className={chip.className}>{chip.label}</Badge>
                            </Link>
                          )
                        })}
                      </div>
                      {/* mobile: native list rows — full-row ≥48px targets, hairline
                          separators, trailing chevron, press + haptic. */}
                      <div className="bubble-in mt-1 divide-y divide-border pc:hidden">
                        {dash.listings.slice(0, 5).map((l) => {
                          const chip = chipFor(l)
                          return (
                            <Link
                              key={l.id}
                              href="/dashboard/listings"
                              onClick={() => hapticTap()}
                              className="press flex min-h-12 items-center gap-3 py-2.5"
                            >
                              {l.images[0] ? (
                                <img src={l.images[0]} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                              ) : (
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                                  <Store className="h-4 w-4" />
                                </span>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-foreground">{listingTitle(l)}</span>
                                <span className="mt-0.5 block text-xs text-body">
                                  {formatMoneyFull(l.price, l.currency, locale)} · {timeAgo(l.postedAt, lang)}
                                </span>
                              </span>
                              <Badge variant={chip.variant} className={chip.className}>{chip.label}</Badge>
                              <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
                            </Link>
                          )
                        })}
                      </div>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card className={REVEAL}>
            <CardHeader>
              <CardTitleLink href="/dashboard/trips">{tr('Saved itineraries', 'Lịch trình đã lưu')}</CardTitleLink>
              <CardDescription className="text-xs">
                {tr('Completed research appears here automatically.', 'Nghiên cứu hoàn tất sẽ tự động xuất hiện tại đây.')}
              </CardDescription>
              {/* 'New plan' opens the planner on its home site (the forum) — same
                  cross-site anchor idiom as the service cards. It STAYS on mobile: it is
                  a create action, not an "Open" duplicate of the header doorway. */}
              <CardAction>
                <Button asChild variant="outline" size="sm">
                  <a href={`${FORUM_URL}/itinerary`} onClick={forumClick('/itinerary')}>
                    <MapPinned className="h-4 w-4" />
                    {tr('New plan', 'Kế hoạch mới')}
                  </a>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {trips === null ? (
                <p className="rounded-xl bg-tint px-4 py-5 text-center text-xs text-body">
                  {tr('Itineraries could not be loaded right now.', 'Hiện chưa tải được lịch trình.')}
                </p>
              ) : trips.length === 0 ? (
                <TintEmpty
                  icon={Route}
                  title={tr('No saved itinerary yet', 'Chưa có lịch trình đã lưu')}
                  subtitle={tr('Research your first trip and it will appear here.', 'Nghiên cứu chuyến đi đầu tiên và lịch trình sẽ tự động xuất hiện tại đây.')}
                />
              ) : (
                <div className="space-y-2.5">
                  {/* The trips section's EXPANDABLE rows, reused as-is: summary line
                      opening in place to day plans + stay shortlist (canonical parity
                      with the forum dashboard). Its trigger is already a full-width
                      icon+meta+chevron row; restyling its internals belongs to
                      trip-card.tsx, not this call site. */}
                  {trips.map((trip) => (
                    <TripCard key={trip.id} trip={trip} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT — canonical order: visa applications, then the user's forum life. */}
        <div className="space-y-5">
          <Card className={REVEAL}>
            <CardHeader>
              <CardTitleLink href="/dashboard/visa">{tr('Visa applications', 'Hồ sơ visa')}</CardTitleLink>
              <OpenButton href="/dashboard/visa" label={tr('Open', 'Mở')} />
            </CardHeader>
            <CardContent>
              {visa.state !== 'ok' ? (
                // Covers 'unavailable' AND the server-saw-no-session edge — both are an
                // honest "can't show your applications right now", never a crash.
                <p className="rounded-xl bg-tint px-4 py-5 text-center text-xs text-body">
                  {tr(
                    "Can't reach the e-Visa assistant right now — your applications are safe on eno.forum.",
                    'Hiện chưa kết nối được trợ lý e-Visa — hồ sơ của bạn vẫn an toàn trên eno.forum.',
                  )}
                </p>
              ) : visa.applications.length === 0 ? (
                <p className="rounded-xl bg-tint px-4 py-5 text-center text-xs text-body">
                  {tr('No visa application yet.', 'Chưa có hồ sơ visa.')}
                </p>
              ) : (
                <>
                  {/* pc: today's tinted id/status rows, unchanged. */}
                  <div className="hidden space-y-2 pc:block">
                    {visa.applications.slice(0, 5).map((a) => {
                      const s = VISA_STATUS[a.status]
                      return (
                        <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl bg-tint px-3 py-3 text-sm">
                          <span className="font-mono text-xs text-body">{a.id.slice(0, 8)}</span>
                          <Badge variant={s?.variant ?? 'neutral'}>{s ? tr(s.en, s.vi) : a.status}</Badge>
                        </div>
                      )
                    })}
                  </div>
                  {/* mobile: native list rows into the visa section. */}
                  <div className="divide-y divide-border pc:hidden">
                    {visa.applications.slice(0, 5).map((a) => {
                      const s = VISA_STATUS[a.status]
                      return (
                        <Link
                          key={a.id}
                          href="/dashboard/visa"
                          onClick={() => hapticTap()}
                          className="press flex min-h-12 items-center gap-3 py-2.5"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                            <FileCheck2 className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1 font-mono text-xs text-body">{a.id.slice(0, 8)}</span>
                          <Badge variant={s?.variant ?? 'neutral'}>{s ? tr(s.en, s.vi) : a.status}</Badge>
                          <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
                        </Link>
                      )
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className={REVEAL}>
            <CardHeader>
              <CardTitleLink href="/dashboard/forum">{tr('Forum activity', 'Hoạt động diễn đàn')}</CardTitleLink>
              <OpenButton href="/dashboard/forum" label={tr('Open', 'Mở')} />
            </CardHeader>
            <CardContent>
              {/* forum === null covers the server-saw-no-session auth race AND a query
                  failure — both degrade to the honest empty body, never a crash. */}
              {forum === null || forumTotal === 0 ? (
                <TintEmpty
                  icon={MessageCircleQuestion}
                  title={tr('No forum activity yet', 'Chưa có hoạt động diễn đàn')}
                  subtitle={tr('Ask a question or share your experience with the community.', 'Đặt câu hỏi hoặc chia sẻ kinh nghiệm của bạn với cộng đồng.')}
                />
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <StatTile href="/dashboard/forum" value={capped(forum.posts.length)} label={tr('Posts', 'Bài viết')} />
                    <StatTile href="/dashboard/forum" value={capped(forum.comments.length)} label={tr('Comments', 'Bình luận')} />
                    <StatTile href="/dashboard/forum" value={capped(forum.saved.length)} label={tr('Saved', 'Đã lưu')} />
                  </div>
                  {forum.posts.length > 0 && (
                    <>
                      {/* pc: today's tinted post blocks, unchanged. */}
                      <div className="mt-3 hidden space-y-2 pc:block">
                        {forum.posts.slice(0, 3).map((p) => (
                          <a
                            key={p.id}
                            href={FORUM_URL + threadPath(p.id)}
                            onClick={forumClick(threadPath(p.id))}
                            className="block rounded-xl bg-tint px-3 py-2.5 transition-colors hover:bg-muted"
                          >
                            <span className="block truncate text-sm font-semibold text-foreground">{p.title}</span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-body">
                              <span className="inline-flex items-center gap-1">
                                <ArrowBigUp className="h-3.5 w-3.5" aria-hidden />
                                {p.score}
                                <span className="sr-only">{tr('votes', 'lượt bình chọn')}</span>
                              </span>
                              <span aria-hidden>·</span>
                              <span className="inline-flex items-center gap-1">
                                <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                                {p.commentCount}
                                <span className="sr-only">{tr('comments', 'bình luận')}</span>
                              </span>
                              <span aria-hidden>·</span>
                              <span>{timeAgo(p.createdAt, lang)}</span>
                            </span>
                          </a>
                        ))}
                      </div>
                      {/* mobile: native list rows to the thread (same cross-site anchor). */}
                      <div className="mt-1 divide-y divide-border pc:hidden">
                        {forum.posts.slice(0, 3).map((p) => (
                          <a
                            key={p.id}
                            href={FORUM_URL + threadPath(p.id)}
                            onClick={(e) => { hapticTap(); forumClick(threadPath(p.id))(e) }}
                            className="press flex min-h-12 items-center gap-3 py-2.5"
                          >
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                              <MessageCircleQuestion className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-foreground">{p.title}</span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-body">
                                <span className="inline-flex items-center gap-1">
                                  <ArrowBigUp className="h-3.5 w-3.5" aria-hidden />
                                  {p.score}
                                  <span className="sr-only">{tr('votes', 'lượt bình chọn')}</span>
                                </span>
                                <span aria-hidden>·</span>
                                <span className="inline-flex items-center gap-1">
                                  <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                                  {p.commentCount}
                                  <span className="sr-only">{tr('comments', 'bình luận')}</span>
                                </span>
                                <span aria-hidden>·</span>
                                <span>{timeAgo(p.createdAt, lang)}</span>
                              </span>
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
                          </a>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
