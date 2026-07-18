'use client'

import { useEffect, useRef, useTransition } from 'react'

import { useRouter } from 'next/navigation'

import Link from 'next/link'
import type { MouseEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowBigUp,
  CalendarDays,
  FileCheck2,
  MessageCircle,
  MessageCircleQuestion,
  Route,
  Sparkles,
  Store,
  Upload,
} from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { useFavorites } from '@/context/favorites-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { FORUM_URL, goToForum } from '@/lib/forum-nav'
import type { ForumVisaResult } from '@/lib/forum-visa'
import { timeAgo } from '@/lib/types'
import { formatCount, formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { ForumActivity } from './forum/forum-client'
import { STATUS as VISA_STATUS } from './visa/visa-client'

/** /dashboard HOME — ONE dashboard for both eno properties (owner 2026-07-18), a faithful
 *  port of the eno.forum card dashboard design: welcome header + "eno services" grid + the
 *  1.45fr/.75fr content grid of Cards. Marketplace data reads the SAME shared store the nav
 *  rail uses (useDashboard/useChat/useFavorites); forum/trips/visa arrive server-loaded from
 *  page.tsx and fail soft into each card's empty body. The full experiences stay on their
 *  own sections (/dashboard/listings·forum·trips·visa) — every card is a doorway, so rows
 *  here are compact and expansion-free by design. */

// Compact itinerary row shape the server loader in page.tsx produces for the home card.
export type HomeTrip = { id: string; title: string; days: number; updatedAt: string }

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

// The forum dashboard's ServiceCard, verbatim (shared tokens/primitives): bg-card ring
// tile with the h-11 accent icon chip and a hover lift. `forumPath` rows cross sites via
// the account-panel anchor idiom; everything else is an internal Link.
function ServiceCard({ href, forumPath, icon: Icon, title, detail }: {
  href?: string
  forumPath?: string
  icon: LucideIcon
  title: string
  detail: string
}) {
  const className =
    'flex min-h-24 items-start gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
  const content = (
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
  return forumPath !== undefined ? (
    <a href={FORUM_URL + forumPath} onClick={forumClick(forumPath)} className={className}>{content}</a>
  ) : (
    <Link href={href!} className={className}>{content}</Link>
  )
}

// The card-header "Open" affordance — outline button linking to the full section.
function OpenButton({ href, label }: { href: string; label: string }) {
  return (
    <CardAction>
      <Button asChild variant="outline" size="sm">
        <Link href={href}>{label}</Link>
      </Button>
    </CardAction>
  )
}

// Marketplace stat tile — bg-tint row that doubles as the doorway to its section.
function StatTile({ href, value, label }: { href: string; value: string | number; label: string }) {
  return (
    <Link href={href} className="block rounded-xl bg-tint px-3 py-3 transition-colors hover:bg-muted">
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

export function HomeClient({ forum, trips, visa }: {
  forum: ForumActivity | null
  trips: HomeTrip[] | null
  visa: ForumVisaResult
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
  const { count: savedCount } = useFavorites()
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
  if (!user) {
    return (
      <div className="mx-auto flex min-h-[55vh] w-full max-w-3xl items-center py-8">
        <Card className="w-full items-center px-5 py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <Sparkles className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight">{tr('Your eno dashboard', 'Bảng điều khiển eno của bạn')}</h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-body">
            {tr(
              'Sign in with your shared eno account to access your listings, messages, itineraries, visa applications and forum activity in one place.',
              'Đăng nhập bằng tài khoản eno dùng chung để truy cập tin đăng, tin nhắn, lịch trình, hồ sơ visa và hoạt động diễn đàn tại một nơi.',
            )}
          </p>
          <Button variant="cta" className="mt-5 h-11" asChild>
            <Link href="/signin?next=/dashboard">{tr('Sign in to eno', 'Đăng nhập eno')}</Link>
          </Button>
        </Card>
      </div>
    )
  }

  const displayName =
    dash?.profile.businessName || dash?.profile.displayName || user.email?.split('@')[0] || user.phone || tr('eno member', 'thành viên eno')
  const activeCount = dash ? dash.listings.filter((l) => l.status === 'active').length : 0
  // The forum loader takes 20 per group — an exact length up to there, honest "20+" past it.
  const capped = (n: number) => (n >= 20 ? '20+' : String(n))
  const forumTotal = forum ? forum.posts.length + forum.comments.length + forum.saved.length : 0

  return (
    <>
      <div>
        <Badge variant="brand">{tr('One eno account', 'Một tài khoản eno')}</Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{tr('Welcome', 'Chào')}, {displayName}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-body">
          {tr(
            'Your Vietnam plans, applications, community, and marketplace tools—together.',
            'Kế hoạch Việt Nam, hồ sơ, cộng đồng và công cụ chợ mua bán—tất cả tại một nơi.',
          )}
        </p>
      </div>

      <section aria-labelledby="eno-services" className="mt-7">
        <h2 id="eno-services" className="text-lg font-bold">{tr('eno services', 'Dịch vụ eno')}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ServiceCard
            href="/post"
            icon={Upload}
            title={tr('Post a listing', 'Đăng tin')}
            detail={tr('Sell or rent out anything on the eno marketplace.', 'Đăng bán hoặc cho thuê mọi thứ trên chợ eno.')}
          />
          <ServiceCard
            forumPath="/"
            icon={MessageCircleQuestion}
            title={tr('Community forum', 'Diễn đàn cộng đồng')}
            detail={tr('Ask, answer, and share useful Vietnam experience.', 'Hỏi, trả lời và chia sẻ kinh nghiệm hữu ích tại Việt Nam.')}
          />
          <ServiceCard
            forumPath="/itinerary"
            icon={Route}
            title={tr('Itinerary planner', 'Lập lịch trình')}
            detail={tr('Research a practical trip; every completed plan saves automatically.', 'Nghiên cứu chuyến đi thực tế; mọi kế hoạch hoàn tất đều tự động lưu.')}
          />
          <ServiceCard
            forumPath="/visa"
            icon={FileCheck2}
            title={tr('Vietnam e-Visa', 'E-Visa Việt Nam')}
            detail={tr('Prepare, review, and track your private application.', 'Chuẩn bị, kiểm tra và theo dõi hồ sơ riêng tư.')}
          />
        </div>
      </section>

      <div className="mt-7 grid items-start gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,.75fr)]">
        {/* LEFT — the host property first: marketplace, then the user's forum life. */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{tr('Marketplace', 'Chợ eno')}</CardTitle>
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
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <StatTile href="/dashboard/listings" value={activeCount} label={tr('Active listings', 'Tin đang đăng')} />
                    <StatTile href="/messages" value={unread} label={tr('Unread messages', 'Tin nhắn chưa đọc')} />
                    <StatTile href="/saved" value={savedCount} label={tr('Saved', 'Đã lưu')} />
                    <StatTile
                      href="/dashboard/listings"
                      value={`${formatCount(dash.stats.totalViews, locale)} / ${formatCount(dash.stats.totalLeads, locale)}`}
                      label={tr('Views / leads', 'Lượt xem / liên hệ')}
                    />
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
                    <div className="mt-3 space-y-2">
                      {dash.listings.slice(0, 5).map((l) => {
                        const title = lang === 'vi' ? l.titleVi || l.title : l.title
                        // Same status wording + tones as dashboard-listing-row, so a listing
                        // never reads differently on the home vs. the listings section.
                        const chip =
                          !l.verified && l.status === 'active'
                            ? { label: tr('Held', 'Đang giữ'), variant: 'warning' as const, className: undefined }
                            : l.status === 'sold'
                              ? { label: tr('Sold', 'Đã bán'), variant: 'neutral' as const, className: 'text-muted-foreground' }
                              : l.status === 'hidden'
                                ? { label: tr('Hidden', 'Đã ẩn'), variant: 'neutral' as const, className: 'text-muted-foreground' }
                                : { label: tr('Live', 'Đang hiển thị'), variant: 'brand' as const, className: undefined }
                        return (
                          <Link
                            key={l.id}
                            href="/dashboard/listings"
                            className="flex items-center gap-3 rounded-xl bg-tint px-3 py-2.5 transition-colors hover:bg-muted"
                          >
                            {l.images[0] ? (
                              <img src={l.images[0]} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                            ) : (
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                                <Store className="h-4 w-4" />
                              </span>
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
                              <span className="mt-0.5 block text-xs text-body">
                                {formatMoneyFull(l.price, l.currency, locale)} · {timeAgo(l.postedAt, lang)}
                              </span>
                            </span>
                            <Badge variant={chip.variant} className={chip.className}>{chip.label}</Badge>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tr('Forum activity', 'Hoạt động diễn đàn')}</CardTitle>
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
                    <div className="mt-3 space-y-2">
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
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT — the travel-side snapshots. */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{tr('Saved itineraries', 'Lịch trình đã lưu')}</CardTitle>
              <OpenButton href="/dashboard/trips" label={tr('Open', 'Mở')} />
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
                <div className="space-y-2">
                  {/* Compact rows only — expansion (day plans, stays) lives on /dashboard/trips. */}
                  {trips.map((t) => (
                    <Link
                      key={t.id}
                      href="/dashboard/trips"
                      className="flex items-center gap-3 rounded-xl bg-tint px-3 py-2.5 transition-colors hover:bg-muted"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                        <CalendarDays className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{t.title}</span>
                        <span className="mt-0.5 block text-xs text-body">
                          {t.days} {tr('days', 'ngày')} · {timeAgo(t.updatedAt, lang)}
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tr('Visa applications', 'Hồ sơ visa')}</CardTitle>
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
                <div className="space-y-2">
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
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
