'use client'

import type { LucideIcon } from 'lucide-react'
import {
  Bookmark,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Coffee,
  Compass,
  FileText,
  Flame,
  Home,
  House,
  MessageSquareText,
  Sparkles,
  Users,
  Waves,
} from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatForumCount, type ForumCommunity } from './forum-data'
import type { FeedMode, ForumSort } from './use-forum-feed'

const COMMUNITY_ICONS: Record<string, LucideIcon> = {
  'vietnam-101': Compass,
  'visas-residency': FileText,
  housing: House,
  'jobs-careers': BriefcaseBusiness,
  'daily-life': Coffee,
  hanoi: Home,
  hcmc: Building2,
  danang: Waves,
  'families-schools': Users,
  'events-meetups': CalendarDays,
}

export function CommunityIcon({ community, className }: { community: ForumCommunity; className?: string }) {
  const Icon = COMMUNITY_ICONS[community.slug] || MessageSquareText
  return (
    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground', className)}>
      <Icon className="h-4 w-4" />
    </span>
  )
}

export function ForumLeftRail({
  communities,
  activeCommunity,
  mode,
  sort,
  savedCount,
  onSelectCommunity,
  onNavigate,
}: {
  communities: ForumCommunity[]
  activeCommunity: string | null
  mode: FeedMode
  sort: ForumSort
  savedCount: number
  onSelectCommunity: (slug: string | null) => void
  onNavigate: (mode: FeedMode, sort: ForumSort) => void
}) {
  const { tr } = useLanguage()
  const nav = [
    { id: 'home', label: tr('Home', 'Trang chủ'), icon: Home, active: mode === 'all' && sort === 'best' && !activeCommunity, action: () => { onSelectCommunity(null); onNavigate('all', 'best') } },
    { id: 'popular', label: tr('Popular', 'Phổ biến'), icon: Flame, active: mode === 'all' && sort === 'top', action: () => onNavigate('all', 'top') },
    { id: 'latest', label: tr('Latest', 'Mới nhất'), icon: Sparkles, active: mode === 'all' && sort === 'latest', action: () => onNavigate('all', 'latest') },
    { id: 'saved', label: tr('Saved', 'Đã lưu'), icon: Bookmark, active: mode === 'saved', action: () => onNavigate('saved', sort) },
  ]

  return (
    <aside
      aria-label={tr('Forum sections and communities', 'Các mục và cộng đồng diễn đàn')}
      className="hidden lg:sticky lg:top-20 lg:block lg:h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-border/80 lg:pr-5"
    >
      <div className="space-y-6 pb-4">
        <nav aria-label={tr('Forum navigation', 'Điều hướng diễn đàn')} className="space-y-1">
          {nav.map((item) => {
            const Icon = item.icon
            return (
              <Button
                key={item.id}
                type="button"
                variant="bare"
                size="none"
                onClick={item.action}
                aria-current={item.active ? 'page' : undefined}
                className={cn(
                  'h-10 w-full justify-start gap-3 rounded-xl px-3 text-sm font-semibold text-body hover:bg-tint hover:text-foreground',
                  item.active && 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
                {item.id === 'saved' && savedCount > 0 && (
                  <Badge variant="counter-brand" size="count" className="ml-auto">{savedCount}</Badge>
                )}
              </Button>
            )
          })}
        </nav>

        <div>
          <div className="mb-2 flex items-center justify-between px-3">
            <p className="text-xs font-bold uppercase tracking-wider text-ink-4">{tr('Communities', 'Cộng đồng')}</p>
            {activeCommunity && (
              <Button type="button" variant="bare" size="none" className="text-xs text-accent-foreground" onClick={() => onSelectCommunity(null)}>
                {tr('Clear', 'Xóa')}
              </Button>
            )}
          </div>
          <div className="space-y-0.5">
            {communities.map((community) => (
              <Button
                key={community.slug}
                type="button"
                variant="bare"
                size="none"
                onClick={() => onSelectCommunity(community.slug)}
                aria-pressed={activeCommunity === community.slug}
                className={cn(
                  'h-auto w-full justify-start gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-body hover:bg-tint hover:text-foreground',
                  activeCommunity === community.slug && 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <CommunityIcon community={community} className="h-7 w-7" />
                <span className="min-w-0 flex-1 truncate">{tr(community.name, community.nameVi)}</span>
                <span className="text-2xs tabular-nums text-ink-4">{formatForumCount(community.members)}</span>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}
