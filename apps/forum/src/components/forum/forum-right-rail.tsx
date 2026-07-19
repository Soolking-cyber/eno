'use client'

import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Flame,
  HeartHandshake,
  MapPin,
  ShieldCheck,
} from 'lucide-react'
import { Tr, useLanguage } from '@/context/language-context'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  FORUM_COMMUNITIES,
  formatForumCount,
  type ForumCommunity,
  type ForumPost,
} from './forum-data'
import { ForumTrustBadgeIcon } from './trust-badge'

export type ForumHelper = {
  author: {
    name: string
    avatarUrl: string | null
    avatarColor: string | null
    trustScore: number | null
    badge: import('./forum-data').ForumTrustBadge | null
  }
  helpfulAnswers: number
}

export function ForumRightRail({ communities, posts, helpers, onOpenPost }: { communities: ForumCommunity[]; posts: ForumPost[]; helpers: ForumHelper[]; onOpenPost: (id: string) => void }) {
  const { tr } = useLanguage()
  const totalMembers = communities.reduce((sum, community) => sum + community.members, 0)
  const online = communities.reduce((sum, community) => sum + community.online, 0)
  // Suppress-when-empty: the live API reports online=0 for every community (no
  // presence tracking yet) — the only nonzero counts come from the hard-coded
  // FORUM_COMMUNITIES fallback rows. Never dress fallback fiction in a live-green
  // "online now" dot: hide the stat when the sum is zero or when any nonzero count
  // matches its hard-coded fallback value (server props lose object identity, so
  // this is a value check, not a reference check).
  const fallbackOnline = new Map(FORUM_COMMUNITIES.map((c) => [c.slug, c.online]))
  const showOnline = online > 0 && communities.every((c) => c.online === 0 || c.online !== fallbackOnline.get(c.slug))
  const popular = posts.slice().sort((a, b) => b.score - a.score).slice(0, 3)

  return (
    <aside
      aria-label={tr('Forum information', 'Thông tin diễn đàn')}
      className="hidden xl:sticky xl:top-20 xl:block xl:h-[calc(100dvh-6rem)] xl:overflow-y-auto xl:overscroll-contain xl:border-l xl:border-border/80 xl:pl-5"
    >
      <div className="space-y-4 pb-4">
        <Card className="gap-0 rounded-none border-b border-border/80 bg-transparent py-0 ring-0">
          <div className="px-4 py-5 text-foreground">
            <div className="flex items-center gap-2">
              <img src="/logo-mark.svg" alt="" className="h-9 w-9" />
              <div>
                <h2 className="text-base font-bold">{tr('About eno.forum', 'Về eno.forum')}</h2>
                <p className="text-2xs text-body">{tr('Real life in Vietnam, together.', 'Cùng nhau sống tốt hơn tại Việt Nam.')}</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-body">
              {tr('A practical, welcoming place for expats and locals to exchange firsthand help.', 'Nơi thân thiện để người nước ngoài và người Việt chia sẻ kinh nghiệm thực tế.')}
            </p>
          </div>
          <CardContent className="py-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-lg font-bold tabular-nums text-foreground">{formatForumCount(totalMembers)}</p>
                <p className="text-2xs text-body">{tr('community members', 'thành viên cộng đồng')}</p>
              </div>
              {showOnline && (
                <div>
                  <p className="flex items-center gap-1.5 text-lg font-bold tabular-nums text-foreground">
                    <span className="h-2 w-2 rounded-full bg-success" />
                    {formatForumCount(online)}
                  </p>
                  <p className="text-2xs text-body">{tr('online now', 'đang trực tuyến')}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card size="sm" className="rounded-none border-b border-border/80 bg-transparent ring-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-bold">
              <HeartHandshake className="h-4 w-4 text-accent-foreground" />
              {tr('Top helpers this week', 'Người hỗ trợ nổi bật tuần này')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {helpers.length > 0 ? helpers.slice(0, 5).map((helper, index) => (
              <div key={`${helper.author.name}-${index}`} className="flex items-center gap-2.5 py-1">
                <span className="w-4 text-xs font-bold tabular-nums text-ink-4">{index + 1}</span>
                <Avatar name={helper.author.name} url={helper.author.avatarUrl} color={helper.author.avatarColor} size="sm" className="h-8 w-8" />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{helper.author.name}</span>
                <ForumTrustBadgeIcon badge={helper.author.badge} trustScore={helper.author.trustScore} />
                <span className="text-2xs font-bold tabular-nums text-accent-foreground">{helper.helpfulAnswers}</span>
              </div>
            )) : (
              <p className="text-xs leading-relaxed text-body">{tr('Helpful answers will earn the first places here.', 'Các câu trả lời hữu ích sẽ giành những vị trí đầu tiên tại đây.')}</p>
            )}
          </CardContent>
        </Card>

        <Card size="sm" className="rounded-none border-b border-border/80 bg-transparent ring-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-bold">
              <Flame className="h-4 w-4 text-accent-foreground" />
              {tr('Popular this week', 'Phổ biến tuần này')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 px-2">
            {popular.map((post, index) => (
              <Button
                key={post.id}
                type="button"
                variant="bare"
                size="none"
                className="h-auto w-full items-start justify-start gap-3 whitespace-normal rounded-xl px-2 py-2 text-left hover:bg-tint"
                onClick={() => onOpenPost(post.id)}
              >
                <span className="mt-0.5 text-sm font-bold tabular-nums text-ink-4">{index + 1}</span>
                <span className="min-w-0">
                  <span className="line-clamp-2 text-xs font-semibold leading-snug text-foreground"><Tr text={post.title} /></span>
                  <span className="mt-1 block text-2xs text-body">{post.commentCount} {tr('replies', 'phản hồi')}</span>
                </span>
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card size="sm" className="rounded-none border-b border-border/80 bg-transparent ring-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-bold">
              <CalendarDays className="h-4 w-4 text-accent-foreground" />
              {tr('Meet offline', 'Gặp gỡ ngoài đời')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="success" size="sm">{tr('This Saturday', 'Thứ Bảy tuần này')}</Badge>
            <p className="mt-2 text-sm font-bold text-foreground">{tr('Board games in Tay Ho', 'Chơi board game tại Tây Hồ')}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-body">
              <MapPin className="h-3.5 w-3.5" />
              {tr('Tay Ho, Hanoi · 6:30 pm', 'Tây Hồ, Hà Nội · 18:30')}
            </p>
            <Button type="button" variant="link" size="none" className="mt-3 h-auto justify-start p-0 text-xs font-bold" onClick={() => onOpenPost('tay-ho-board-games')}>
              {tr('See meetup details', 'Xem chi tiết buổi gặp')}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>

        <Card size="sm" className="rounded-none bg-transparent ring-0">
          <CardHeader>
            <CardTitle className="font-bold">{tr('Community values', 'Giá trị cộng đồng')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-body">
            <p className="flex gap-2"><HeartHandshake className="h-4 w-4 shrink-0 text-accent-foreground" />{tr('Be kind to people finding their footing.', 'Tử tế với những người đang làm quen cuộc sống mới.')}</p>
            <p className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-accent-foreground" />{tr('Prefer firsthand, current information.', 'Ưu tiên thông tin thực tế và cập nhật.')}</p>
            <p className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-accent-foreground" />{tr('Protect private and sensitive details.', 'Bảo vệ thông tin riêng tư và nhạy cảm.')}</p>
          </CardContent>
        </Card>
      </div>
    </aside>
  )
}
