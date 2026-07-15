'use client'

import { useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Bookmark,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Coffee,
  Compass,
  FileText,
  Flame,
  HeartHandshake,
  Home,
  House,
  Languages,
  MapPin,
  MessageCircleQuestion,
  MessageSquareText,
  Plus,
  Search,
  SearchX,
  ShieldCheck,
  Sparkles,
  Store,
  UserRound,
  Users,
  Waves,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useAccountPanel } from '@/components/marketplace/account-panel'
import { useVirtualKeyboard } from '@/hooks/use-virtual-keyboard'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { CreatePostDialog, type NewForumPost } from './create-post-dialog'
import {
  FORUM_COMMUNITIES,
  INITIAL_FORUM_POSTS,
  formatForumCount,
  type ForumCommunity,
  type ForumPost,
} from './forum-data'
import { ForumHeader } from './forum-header'
import { ForumPostCard } from './forum-post-card'
import { ThreadDialog } from './thread-dialog'

type ForumSort = 'best' | 'latest' | 'top'
type FeedMode = 'all' | 'saved'

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

function CommunityIcon({ community, className }: { community: ForumCommunity; className?: string }) {
  const Icon = COMMUNITY_ICONS[community.slug] || MessageSquareText
  return (
    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground', className)}>
      <Icon className="h-4 w-4" />
    </span>
  )
}

function ForumLeftRail({
  activeCommunity,
  mode,
  sort,
  savedCount,
  onSelectCommunity,
  onNavigate,
}: {
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
    <aside aria-label={tr('Forum sections and communities', 'Các mục và cộng đồng diễn đàn')} className="hidden lg:block">
      <div className="sticky top-20 space-y-6">
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
            {FORUM_COMMUNITIES.map((community) => (
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

function ForumRightRail({ onOpenPost, onCreatePost }: { onOpenPost: (id: string) => void; onCreatePost: () => void }) {
  const { tr } = useLanguage()
  const totalMembers = FORUM_COMMUNITIES.reduce((sum, community) => sum + community.members, 0)
  const online = FORUM_COMMUNITIES.reduce((sum, community) => sum + community.online, 0)
  const popular = INITIAL_FORUM_POSTS.slice().sort((a, b) => b.score - a.score).slice(0, 3)

  return (
    <aside aria-label={tr('Forum information', 'Thông tin diễn đàn')} className="hidden xl:block">
      <div className="sticky top-20 space-y-4">
        <Card className="gap-0 bg-card py-0">
          <div className="bg-brand-deep px-4 py-5 text-white">
            <div className="flex items-center gap-2">
              <img src="/logo-mark.svg" alt="" className="h-9 w-9" />
              <div>
                <h2 className="text-base font-bold">{tr('About eno.forum', 'Về eno.forum')}</h2>
                <p className="text-2xs text-white/75">{tr('Real life in Vietnam, together.', 'Cùng nhau sống tốt hơn tại Việt Nam.')}</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-white/85">
              {tr('A practical, welcoming place for expats and locals to exchange firsthand help.', 'Nơi thân thiện để người nước ngoài và người Việt chia sẻ kinh nghiệm thực tế.')}
            </p>
          </div>
          <CardContent className="py-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-lg font-bold tabular-nums text-foreground">{formatForumCount(totalMembers)}</p>
                <p className="text-2xs text-body">{tr('community members', 'thành viên cộng đồng')}</p>
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-lg font-bold tabular-nums text-foreground">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  {formatForumCount(online)}
                </p>
                <p className="text-2xs text-body">{tr('online now', 'đang trực tuyến')}</p>
              </div>
            </div>
            <Button type="button" variant="cta" className="mt-4 w-full" onClick={onCreatePost}>
              <Plus className="h-4 w-4" />
              {tr('Start a post', 'Tạo bài viết')}
            </Button>
          </CardContent>
        </Card>

        <Card size="sm">
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
                  <span className="line-clamp-2 text-xs font-semibold leading-snug text-foreground">{post.title}</span>
                  <span className="mt-1 block text-2xs text-body">{post.commentCount} {tr('replies', 'phản hồi')}</span>
                </span>
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card size="sm">
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

        <Card size="sm">
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

function MobileForumNav({
  mode,
  sort,
  savedCount,
  onHome,
  onPopular,
  onCreate,
  onSaved,
}: {
  mode: FeedMode
  sort: ForumSort
  savedCount: number
  onHome: () => void
  onPopular: () => void
  onCreate: () => void
  onSaved: () => void
}) {
  const { tr } = useLanguage()
  const { user, openSignIn } = useAuth()
  const { openTo } = useAccountPanel()
  const { open: keyboardOpen } = useVirtualKeyboard()
  const itemClass = 'relative flex h-full flex-1 flex-col items-center justify-center gap-1 text-3xs font-semibold'

  return (
    <nav
      inert={keyboardOpen}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] transition-[transform,opacity] duration-[250ms] lg:hidden',
        keyboardOpen && 'pointer-events-none translate-y-full opacity-0',
      )}
      aria-label={tr('Forum mobile navigation', 'Điều hướng diễn đàn trên di động')}
    >
      <div className="flex h-16 items-stretch">
        <Button type="button" variant="bare" size="none" aria-pressed={mode === 'all' && sort === 'best'} className={cn(itemClass, mode === 'all' && sort === 'best' ? 'text-accent-foreground' : 'text-body')} onClick={onHome}>
          <Home className="h-5 w-5" />
          <span>{tr('Home', 'Trang chủ')}</span>
        </Button>
        <Button type="button" variant="bare" size="none" aria-pressed={mode === 'all' && sort === 'top'} className={cn(itemClass, mode === 'all' && sort === 'top' ? 'text-accent-foreground' : 'text-body')} onClick={onPopular}>
          <Flame className="h-5 w-5" />
          <span>{tr('Popular', 'Phổ biến')}</span>
        </Button>
        <Button type="button" variant="bare" size="none" className={itemClass} onClick={onCreate} aria-label={tr('Start a post', 'Tạo bài viết')}>
          <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-card">
            <Plus className="h-6 w-6" />
          </span>
          <span className="-mt-0.5 text-body">{tr('Post', 'Đăng')}</span>
        </Button>
        <Button type="button" variant="bare" size="none" aria-pressed={mode === 'saved'} className={cn(itemClass, mode === 'saved' ? 'text-accent-foreground' : 'text-body')} onClick={onSaved}>
          <span className="relative">
            <Bookmark className={cn('h-5 w-5', mode === 'saved' && 'fill-current')} />
            {savedCount > 0 && <Badge variant="counter-brand" size="count" className="absolute -right-3 -top-2">{savedCount}</Badge>}
          </span>
          <span>{tr('Saved', 'Đã lưu')}</span>
        </Button>
        <Button type="button" variant="bare" size="none" className={cn(itemClass, 'text-body')} onClick={() => user ? openTo('root') : openSignIn()}>
          <UserRound className="h-5 w-5" />
          <span>{user ? tr('Profile', 'Hồ sơ') : tr('Sign in', 'Đăng nhập')}</span>
        </Button>
      </div>
    </nav>
  )
}

function FeedList({
  posts,
  communityMap,
  votes,
  saved,
  onVote,
  onSave,
  onOpen,
  onReset,
}: {
  posts: ForumPost[]
  communityMap: Map<string, ForumCommunity>
  votes: Record<string, -1 | 0 | 1>
  saved: Set<string>
  onVote: (id: string, direction: -1 | 1) => void
  onSave: (id: string) => void
  onOpen: (id: string) => void
  onReset: () => void
}) {
  const { tr } = useLanguage()
  if (posts.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title={tr('No discussions match these filters.', 'Không có thảo luận phù hợp với bộ lọc.')}
        subtitle={tr('Try another community, location, or search term.', 'Hãy thử cộng đồng, địa điểm hoặc từ khóa khác.')}
        action={<Button type="button" variant="outline" onClick={onReset}>{tr('Reset filters', 'Đặt lại bộ lọc')}</Button>}
        className="bg-card"
      />
    )
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => {
        const community = communityMap.get(post.community)
        if (!community) return null
        return (
          <ForumPostCard
            key={post.id}
            post={post}
            community={community}
            vote={votes[post.id] || 0}
            saved={saved.has(post.id)}
            onVote={(direction) => onVote(post.id, direction)}
            onSave={() => onSave(post.id)}
            onOpen={() => onOpen(post.id)}
          />
        )
      })}
    </div>
  )
}

export function ForumClient() {
  const { tr } = useLanguage()
  const { user } = useAuth()
  const { open: accountPanelOpen } = useAccountPanel()
  const [hydrated, setHydrated] = useState(false)
  const [posts, setPosts] = useState<ForumPost[]>(INITIAL_FORUM_POSTS)
  const [query, setQuery] = useState('')
  const [community, setCommunity] = useState<string | null>(null)
  const [location, setLocation] = useState('all')
  const [sort, setSort] = useState<ForumSort>('best')
  const [mode, setMode] = useState<FeedMode>('all')
  const [votes, setVotes] = useState<Record<string, -1 | 0 | 1>>({})
  const [saved, setSaved] = useState<Set<string>>(() => new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [openPostId, setOpenPostId] = useState<string | null>(null)

  const communityMap = useMemo(() => new Map(FORUM_COMMUNITIES.map((item) => [item.slug, item])), [])

  useEffect(() => {
    setHydrated(true)
    const postId = new URLSearchParams(window.location.search).get('post')
    if (postId && INITIAL_FORUM_POSTS.some((post) => post.id === postId)) setOpenPostId(postId)
  }, [])

  const filteredPosts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const result = posts.filter((post) => {
      if (mode === 'saved' && !saved.has(post.id)) return false
      if (community && post.community !== community) return false
      if (location !== 'all' && post.location !== location && post.location !== 'all') return false
      if (!needle) return true
      const group = communityMap.get(post.community)
      return [post.title, post.body, post.author, group?.name, post.locationLabel]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(needle))
    })

    return result
  }, [posts, mode, saved, community, location, query, communityMap])

  const sortedPosts = (nextSort: ForumSort) => filteredPosts.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (nextSort === 'latest') return a.minutesAgo - b.minutesAgo
    if (nextSort === 'top') return (b.score + (votes[b.id] || 0)) - (a.score + (votes[a.id] || 0))
    return (b.score + b.commentCount * 1.5) - (a.score + a.commentCount * 1.5)
  })

  const activePost = posts.find((post) => post.id === openPostId) || null
  const activePostCommunity = activePost ? communityMap.get(activePost.community) || null : null
  const locationLabel = location === 'hcmc'
    ? tr('Ho Chi Minh City', 'TP. Hồ Chí Minh')
    : location === 'hanoi'
      ? tr('Hanoi', 'Hà Nội')
      : location === 'danang'
        ? tr('Da Nang', 'Đà Nẵng')
        : tr('All Vietnam', 'Toàn Việt Nam')

  const chooseCommunity = (slug: string | null) => {
    setCommunity(slug)
    setMode('all')
  }

  const navigateFeed = (nextMode: FeedMode, nextSort: ForumSort) => {
    setMode(nextMode)
    setSort(nextSort)
  }

  const votePost = (id: string, direction: -1 | 1) => {
    setVotes((current) => ({ ...current, [id]: current[id] === direction ? 0 : direction }))
  }

  const savePost = (id: string) => {
    setSaved((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
        toast.message(tr('Removed from saved posts.', 'Đã xóa khỏi bài viết đã lưu.'))
      } else {
        next.add(id)
        toast.success(tr('Saved for later.', 'Đã lưu để xem sau.'))
      }
      return next
    })
  }

  const openThread = (id: string) => {
    setOpenPostId(id)
    const url = new URL(window.location.href)
    url.searchParams.set('post', id)
    window.history.replaceState({}, '', url)
  }

  const closeThread = () => {
    setOpenPostId(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('post')
    window.history.replaceState({}, '', url)
  }

  const publishPost = (draft: NewForumPost) => {
    const next: ForumPost = {
      id: `local-${Date.now()}`,
      ...draft,
      flair: 'Community discussion',
      flairVi: 'Thảo luận cộng đồng',
      author: String(user?.user_metadata?.full_name || user?.email?.split('@')[0] || tr('You', 'Bạn')),
      minutesAgo: 0,
      timeLabel: tr('Just now', 'Vừa xong'),
      score: 1,
      commentCount: 0,
      location: 'all',
    }
    setPosts((current) => [next, ...current])
    setCommunity(draft.community)
    setMode('all')
    setSort('latest')
    setQuery('')
    toast.success(tr('Your post is live in the preview feed.', 'Bài viết đã xuất hiện trong bảng tin xem trước.'))
  }

  const resetFilters = () => {
    setQuery('')
    setCommunity(null)
    setLocation('all')
    setMode('all')
    setSort('best')
  }

  return (
    <div data-forum-page data-hydrated={hydrated ? 'true' : 'false'} className="min-h-screen bg-background pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0">
      <ForumHeader query={query} onQueryChange={setQuery} onCreatePost={() => setCreateOpen(true)} />

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mb-4 flex items-center rounded-2xl bg-tint px-3 sm:hidden">
          <Search className="h-5 w-5 shrink-0 text-ink-4" />
          <Input
            variant="unstyled"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tr('Search eno.forum', 'Tìm kiếm eno.forum')}
            aria-label={tr('Search the forum', 'Tìm kiếm trên diễn đàn')}
            className="min-w-0 flex-1 px-3 py-3 text-base"
          />
        </div>

        <section id="forum-communities" aria-labelledby="forum-communities-title" className="mb-4 lg:hidden">
          <div className="mb-2 flex items-center justify-between px-1">
            <p id="forum-communities-title" className="text-xs font-bold text-foreground">{tr('Find your community', 'Tìm cộng đồng của bạn')}</p>
            {community && <Button type="button" variant="bare" size="none" className="text-xs text-accent-foreground" onClick={() => setCommunity(null)}>{tr('See all', 'Xem tất cả')}</Button>}
          </div>
          <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:-mx-6 sm:px-6">
            {FORUM_COMMUNITIES.map((item) => (
              <Button
                key={item.slug}
                type="button"
                variant="bare"
                size="none"
                className={cn(
                  'h-10 shrink-0 gap-2 rounded-full border border-border bg-card px-3 text-xs font-semibold text-body shadow-xs',
                  community === item.slug && 'border-brand bg-accent text-accent-foreground',
                )}
                onClick={() => chooseCommunity(item.slug)}
                aria-pressed={community === item.slug}
              >
                <CommunityIcon community={item} className="h-6 w-6" />
                {tr(item.name, item.nameVi)}
              </Button>
            ))}
          </div>
        </section>

        <div className={cn(
          'grid items-start gap-6',
          accountPanelOpen ? 'grid-cols-1' : 'lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,680px)_300px]',
        )}>
          {!accountPanelOpen && (
            <ForumLeftRail
              activeCommunity={community}
              mode={mode}
              sort={sort}
              savedCount={saved.size}
              onSelectCommunity={chooseCommunity}
              onNavigate={navigateFeed}
            />
          )}

          <div className="min-w-0 space-y-4">
            <Card className="relative gap-0 overflow-hidden bg-brand-deep px-5 py-5 text-white ring-0 sm:px-6 sm:py-6">
              <div className="relative z-10 max-w-lg">
                <Badge variant="brand" size="sm" className="bg-white/10 text-white">
                  <Languages className="h-3 w-3" />
                  {tr('People-powered local knowledge', 'Kiến thức địa phương từ cộng đồng')}
                </Badge>
                <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
                  {tr('Vietnam feels easier together.', 'Cuộc sống ở Việt Nam dễ dàng hơn khi có nhau.')}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-white/80 sm:text-base">
                  {tr('Ask what search results cannot answer. Get current, firsthand help from people who live here.', 'Hỏi những điều khó tìm trên mạng. Nhận chia sẻ cập nhật từ những người đang sống tại đây.')}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button type="button" variant="cta" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4" />
                    {tr('Ask the community', 'Hỏi cộng đồng')}
                  </Button>
                  <Button type="button" variant="bare" className="text-white hover:bg-white/10" onClick={() => openThread('new-to-vietnam-checklist')}>
                    <CircleHelp className="h-4 w-4" />
                    {tr('Newcomer guide', 'Hướng dẫn người mới')}
                  </Button>
                </div>
              </div>
              <MessageCircleQuestion className="pointer-events-none absolute -bottom-8 -right-4 h-40 w-40 text-white/5 sm:h-48 sm:w-48" aria-hidden="true" />
            </Card>

            <Card className="gap-0 py-0">
              <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Avatar name={String(user?.user_metadata?.full_name || user?.email || tr('Guest', 'Khách'))} url={user?.user_metadata?.avatar_url} size="sm" />
                <Button type="button" variant="bare" size="none" className="h-11 min-w-0 flex-1 justify-start rounded-xl bg-tint px-4 text-left text-sm font-normal text-body hover:bg-muted" onClick={() => setCreateOpen(true)}>
                  <span className="truncate">{tr('Ask a question or share an experience…', 'Đặt câu hỏi hoặc chia sẻ trải nghiệm…')}</span>
                </Button>
              </div>
              <div className="grid grid-cols-3 border-t border-border/70">
                <Button type="button" variant="bare" size="none" className="h-10 gap-1.5 rounded-none text-xs text-body hover:bg-tint" onClick={() => setCreateOpen(true)}>
                  <MessageCircleQuestion className="h-4 w-4 text-accent-foreground" />
                  {tr('Ask', 'Đặt câu hỏi')}
                </Button>
                <Button type="button" variant="bare" size="none" className="h-10 gap-1.5 rounded-none border-x border-border/70 text-xs text-body hover:bg-tint" onClick={() => setCreateOpen(true)}>
                  <HeartHandshake className="h-4 w-4 text-accent-foreground" />
                  {tr('Share', 'Chia sẻ')}
                </Button>
                <Button type="button" variant="bare" size="none" className="h-10 gap-1.5 rounded-none text-xs text-body hover:bg-tint" onClick={() => setCreateOpen(true)}>
                  <CalendarDays className="h-4 w-4 text-accent-foreground" />
                  {tr('Meet up', 'Gặp gỡ')}
                </Button>
              </div>
            </Card>

            <Tabs value={sort} onValueChange={(value) => { setSort(value as ForumSort); setMode('all') }} className="gap-3">
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-card px-3 py-2 ring-1 ring-foreground/10">
                <TabsList variant="line" className="min-w-0 gap-0 group-data-horizontal/tabs:h-9">
                  <TabsTrigger value="best" className="h-9 cursor-pointer px-3 text-xs font-semibold">
                    <Sparkles className="h-4 w-4" />
                    {tr('Best', 'Nổi bật')}
                  </TabsTrigger>
                  <TabsTrigger value="latest" className="h-9 cursor-pointer px-3 text-xs font-semibold">
                    {tr('Latest', 'Mới nhất')}
                  </TabsTrigger>
                  <TabsTrigger value="top" className="h-9 cursor-pointer px-3 text-xs font-semibold">
                    {tr('Top', 'Hàng đầu')}
                  </TabsTrigger>
                </TabsList>

                <Select value={location} onValueChange={(value) => { if (typeof value === 'string') setLocation(value) }}>
                  <SelectTrigger size="sm" aria-label={tr('Filter by location', 'Lọc theo địa điểm')} className="shrink-0 cursor-pointer border-0 bg-tint text-xs">
                    <MapPin className="h-3.5 w-3.5" />
                    <SelectValue>{locationLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="all">{tr('All Vietnam', 'Toàn Việt Nam')}</SelectItem>
                    <SelectItem value="hcmc">{tr('Ho Chi Minh City', 'TP. Hồ Chí Minh')}</SelectItem>
                    <SelectItem value="hanoi">{tr('Hanoi', 'Hà Nội')}</SelectItem>
                    <SelectItem value="danang">{tr('Da Nang', 'Đà Nẵng')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(['best', 'latest', 'top'] as ForumSort[]).map((tab) => (
                <TabsContent key={tab} value={tab}>
                  {sort === tab && (
                    <FeedList
                      posts={sortedPosts(tab)}
                      communityMap={communityMap}
                      votes={votes}
                      saved={saved}
                      onVote={votePost}
                      onSave={savePost}
                      onOpen={openThread}
                      onReset={resetFilters}
                    />
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </div>

          {!accountPanelOpen && <ForumRightRail onOpenPost={openThread} onCreatePost={() => setCreateOpen(true)} />}
        </div>
      </main>

      <MobileForumNav
        mode={mode}
        sort={sort}
        savedCount={saved.size}
        onHome={resetFilters}
        onPopular={() => navigateFeed('all', 'top')}
        onCreate={() => setCreateOpen(true)}
        onSaved={() => setMode('saved')}
      />

      <CreatePostDialog
        open={createOpen}
        defaultCommunity={community || undefined}
        onOpenChange={setCreateOpen}
        onPublish={publishPost}
      />

      <ThreadDialog
        post={activePost}
        community={activePostCommunity}
        vote={activePost ? votes[activePost.id] || 0 : 0}
        saved={activePost ? saved.has(activePost.id) : false}
        onOpenChange={(open) => { if (!open) closeThread() }}
        onVote={(direction) => { if (activePost) votePost(activePost.id, direction) }}
        onSave={() => { if (activePost) savePost(activePost.id) }}
      />
    </div>
  )
}
