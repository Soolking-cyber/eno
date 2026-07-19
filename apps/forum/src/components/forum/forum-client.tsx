'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  Loader2,
  MapPin,
  MessageCircleQuestion,
  MessageSquareText,
  Search,
  SearchX,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Waves,
} from 'lucide-react'
import { toast } from 'sonner'
import { Tr, useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { ForumFooter } from '@/components/forum/forum-footer'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { forumApi, ForumApiError } from '@/lib/api'
import {
  canDeleteForumPost,
  mapForumComment,
  mapForumPost,
  type ForumCommentResponse,
  type ForumPostResponse,
} from '@/lib/forum-api'
import { CreatePostDialog, type NewForumPost } from './create-post-dialog'
import {
  FORUM_COMMUNITIES,
  INITIAL_FORUM_POSTS,
  formatForumCount,
  type ForumCommunity,
  type ForumComment,
  type ForumPost,
} from './forum-data'
import { ForumHeader } from './forum-header'
import { MobileForumNav } from './mobile-forum-nav'
import { ForumPostCard } from './forum-post-card'
import { ThreadDialog } from './thread-dialog'
import { ForumTrustBadgeIcon } from './trust-badge'

type ForumSort = 'best' | 'latest' | 'top'
type FeedMode = 'all' | 'saved'
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

function insertThreadComment(comments: ForumComment[], comment: ForumComment, parentId: string | null): ForumComment[] {
  if (!parentId) return [comment, ...comments]
  return comments.map((item) => item.id === parentId
    ? { ...item, replies: [...(item.replies || []), comment] }
    : { ...item, replies: item.replies ? insertThreadComment(item.replies, comment, parentId) : item.replies })
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

function ForumRightRail({ communities, posts, helpers, onOpenPost }: { communities: ForumCommunity[]; posts: ForumPost[]; helpers: ForumHelper[]; onOpenPost: (id: string) => void }) {
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

function FeedList({
  posts,
  communityMap,
  votes,
  saved,
  onVote,
  onSave,
  onOpen,
  onBlock,
  onReport,
  viewerId,
  onDelete,
  onReset,
}: {
  posts: ForumPost[]
  communityMap: Map<string, ForumCommunity>
  votes: Record<string, -1 | 0 | 1>
  saved: Set<string>
  onVote: (id: string, direction: -1 | 1) => void
  onSave: (id: string) => void
  onOpen: (id: string) => void
  onBlock: (post: ForumPost) => void
  onReport: (post: ForumPost) => void
  viewerId: string | null
  onDelete: (post: ForumPost) => void
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
        className="bg-transparent ring-0"
      />
    )
  }

  return (
    <div>
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
            onBlock={() => onBlock(post)}
            onReport={() => onReport(post)}
            canDelete={canDeleteForumPost(post, viewerId)}
            onDelete={() => onDelete(post)}
          />
        )
      })}
    </div>
  )
}

export function ForumClient({
  initialPosts = INITIAL_FORUM_POSTS,
  initialCommunities = FORUM_COMMUNITIES,
  initialHelpers = [],
}: {
  initialPosts?: ForumPost[]
  initialCommunities?: ForumCommunity[]
  initialHelpers?: ForumHelper[]
}) {
  const { tr } = useLanguage()
  const { user, loading: authLoading, openSignIn } = useAuth()
  const [hydrated, setHydrated] = useState(false)
  const [posts, setPosts] = useState<ForumPost[]>(initialPosts)
  // Never changes after mount — plain prop alias, not state (communityMap's
  // useMemo keys on it either way).
  const communities = initialCommunities
  const [query, setQuery] = useState('')
  const [community, setCommunity] = useState<string | null>(null)
  const [location, setLocation] = useState('all')
  const [sort, setSort] = useState<ForumSort>('best')
  const [mode, setMode] = useState<FeedMode>('all')
  const [votes, setVotes] = useState<Record<string, -1 | 0 | 1>>({})
  const [saved, setSaved] = useState<Set<string>>(() => new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [openPostId, setOpenPostId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ForumPost | null>(null)
  const [deletingPost, setDeletingPost] = useState(false)
  const [threadComments, setThreadComments] = useState<Record<string, ForumComment[]>>({})
  const fetchedAuthenticatedViewer = useRef(false)
  // Monotonic per-action request ids — the reconciliation guard for rapid toggles.
  const actionSeq = useRef<Record<string, number>>({})

  const communityMap = useMemo(() => new Map(communities.map((item) => [item.slug, item])), [communities])

  useEffect(() => {
    setHydrated(true)
    const postId = new URLSearchParams(window.location.search).get('post')
    if (postId) setOpenPostId(postId)
  }, [])

  useEffect(() => {
    if (authLoading) return
    // The public feed was already fetched before first paint. Only fetch again
    // when viewer-specific vote/bookmark state is needed, or after that viewer
    // signs out. Never replace the visible post array during page hydration.
    if (!user && !fetchedAuthenticatedViewer.current) return
    let active = true
    forumApi<{ posts: ForumPostResponse[] }>('/api/forum/posts?limit=50')
      .then(({ posts: livePosts }) => {
        if (!active) return
        const liveById = new Map(livePosts.map((post) => [post.id, post]))
        setPosts((current) => current.map((post) => {
          const live = liveById.get(post.id)
          return live ? { ...post, score: live.score - live.viewerVote } : post
        }))
        // MERGE, never replace (audit P2): a `?post=` deep link outside the top-50
        // feed keeps its viewer vote/bookmark state — wholesale replacement erased it
        // whenever this feed refresh landed after the deep-linked post's own fetch.
        setVotes((current) => ({ ...current, ...Object.fromEntries(livePosts.map((post) => [post.id, post.viewerVote])) }))
        setSaved((current) => {
          const next = new Set(current)
          for (const post of livePosts) { if (post.saved) next.add(post.id); else next.delete(post.id) }
          return next
        })
        fetchedAuthenticatedViewer.current = Boolean(user)
      })
      .catch(() => {})
    return () => { active = false }
  }, [authLoading, user])

  useEffect(() => {
    if (!openPostId) return
    if (INITIAL_FORUM_POSTS.some((post) => post.id === openPostId)) return
    let active = true
    forumApi<{ post: ForumPostResponse; comments: ForumCommentResponse[] }>(`/api/forum/posts/${encodeURIComponent(openPostId)}`)
      .then(({ post, comments }) => {
        if (!active) return
        const mapped = mapForumPost(post)
        setPosts((current) => current.some((item) => item.id === mapped.id)
          ? current.map((item) => item.id === mapped.id ? mapped : item)
          : [mapped, ...current])
        setVotes((current) => ({ ...current, [mapped.id]: post.viewerVote }))
        setSaved((current) => {
          const next = new Set(current)
          if (post.saved) next.add(post.id)
          else next.delete(post.id)
          return next
        })
        setThreadComments((current) => ({ ...current, [post.id]: comments.map(mapForumComment) }))
      })
      .catch((error) => {
        if (!active) return
        // A deleted/never-existed deep link deserves an explanation + a clean URL;
        // transient network failures stay silent (the feed already rendered).
        if (error instanceof ForumApiError && error.status === 404) {
          toast.error(tr('This discussion is no longer available.', 'Thảo luận này không còn tồn tại.'))
          closeThread()
        }
      })
    return () => { active = false }
  }, [openPostId, user?.id])

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

  const activePost = posts.find((post) => post.id === openPostId)
    || INITIAL_FORUM_POSTS.find((post) => post.id === openPostId)
    || null
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

  const openCreatePost = () => {
    if (!user) { openSignIn(); return }
    setCreateOpen(true)
  }

  const votePost = (id: string, direction: -1 | 1) => {
    if (!user) { openSignIn(); return }
    const post = posts.find((item) => item.id === id)
    const previous = votes[id] || 0
    const next = previous === direction ? 0 : direction
    setVotes((current) => ({ ...current, [id]: next }))
    if (!post?.live) return
    // Per-post request seq (audit P2): rapid toggle puts two POSTs in flight; only the
    // LATEST request may reconcile state, else out-of-order responses re-show a vote
    // the user removed and drift the score until remount.
    const seq = (actionSeq.current[`vote:${id}`] = (actionSeq.current[`vote:${id}`] || 0) + 1)
    void forumApi<{ score: number; viewerVote: -1 | 0 | 1 }>(`/api/forum/posts/${encodeURIComponent(id)}/vote`, {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ value: next }),
    }).then((result) => {
      if (actionSeq.current[`vote:${id}`] !== seq) return
      setVotes((current) => ({ ...current, [id]: result.viewerVote }))
      setPosts((current) => current.map((item) => item.id === id ? { ...item, score: result.score - result.viewerVote } : item))
    }).catch(() => {
      if (actionSeq.current[`vote:${id}`] !== seq) return
      setVotes((current) => ({ ...current, [id]: previous }))
      toast.error(tr('Your vote could not be saved.', 'Không thể lưu bình chọn của bạn.'))
    })
  }

  const savePost = (id: string) => {
    if (!user) { openSignIn(); return }
    const post = posts.find((item) => item.id === id)
    const wasSaved = saved.has(id)
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
    if (!post?.live) return
    const seq = (actionSeq.current[`save:${id}`] = (actionSeq.current[`save:${id}`] || 0) + 1)
    void forumApi<{ saved: boolean }>(`/api/forum/posts/${encodeURIComponent(id)}/bookmark`, {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ saved: !wasSaved }),
    }).then((result) => {
      if (actionSeq.current[`save:${id}`] !== seq) return
      setSaved((current) => {
        const next = new Set(current)
        if (result.saved) next.add(id)
        else next.delete(id)
        return next
      })
    }).catch(() => {
      if (actionSeq.current[`save:${id}`] !== seq) return
      setSaved((current) => {
        const next = new Set(current)
        if (wasSaved) next.add(id)
        else next.delete(id)
        return next
      })
      toast.error(tr('Your saved posts could not be updated.', 'Không thể cập nhật bài viết đã lưu.'))
    })
  }

  const reportPost = (post: ForumPost) => {
    if (!user) { openSignIn(); return }
    if (!post.live) {
      toast.message(tr('Preview discussions cannot be reported.', 'Không thể báo cáo thảo luận xem trước.'))
      return
    }
    void forumApi('/api/forum/reports', {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ postId: post.id, reason: 'other' }),
    }).then(() => toast.success(tr('Report sent to the community team.', 'Báo cáo đã được gửi đến đội ngũ cộng đồng.')))
      .catch(() => toast.error(tr('The report could not be sent.', 'Không thể gửi báo cáo.')))
  }

  const blockPostAuthor = (post: ForumPost) => {
    if (!user) { openSignIn(); return }
    if (!post.live || !post.authorId) {
      setPosts((current) => current.filter((item) => item.id !== post.id))
      toast.message(tr('This discussion was hidden from your preview.', 'Thảo luận này đã được ẩn khỏi bản xem trước.'))
      return
    }
    void forumApi('/api/forum/blocks', {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ profileId: post.authorId, blocked: true }),
    }).then(() => {
      setPosts((current) => current.filter((item) => item.authorId !== post.authorId))
      if (openPostId === post.id) closeThread()
      toast.success(tr('Member blocked. Their posts are now hidden.', 'Đã chặn thành viên. Bài viết của họ hiện đã được ẩn.'))
    }).catch(() => toast.error(tr('This member could not be blocked.', 'Không thể chặn thành viên này.')))
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

  const requestDeletePost = (post: ForumPost) => {
    if (!user) { openSignIn(); return }
    if (!canDeleteForumPost(post, user.id)) {
      toast.error(tr('Only the post owner can delete this discussion.', 'Chỉ chủ bài viết mới có thể xóa thảo luận này.'))
      return
    }
    setDeleteTarget(post)
  }

  const deletePost = async () => {
    if (!deleteTarget || !user || !canDeleteForumPost(deleteTarget, user.id)) return
    const id = deleteTarget.id
    setDeletingPost(true)
    try {
      await forumApi<{ ok: true }>(`/api/forum/posts/${encodeURIComponent(id)}`, { method: 'DELETE', auth: 'required', direct: true })
      setPosts((current) => current.filter((post) => post.id !== id))
      setSaved((current) => { const next = new Set(current); next.delete(id); return next })
      setVotes((current) => { const next = { ...current }; delete next[id]; return next })
      setThreadComments((current) => { const next = { ...current }; delete next[id]; return next })
      if (openPostId === id) closeThread()
      setDeleteTarget(null)
      toast.success(tr('Your post was deleted.', 'Bài viết của bạn đã được xóa.'))
    } catch (error) {
      const code = error instanceof ForumApiError ? error.code : 'post_delete_failed'
      const copy: Record<string, [string, string]> = {
        forbidden: ['Only the post owner can delete this discussion.', 'Chỉ chủ bài viết mới có thể xóa thảo luận này.'],
        not_found: ['This post was already removed.', 'Bài viết này đã được xóa.'],
        rate_limited: ['Too many delete attempts. Please wait and try again.', 'Có quá nhiều lần xóa. Vui lòng chờ rồi thử lại.'],
        forum_delete_not_configured: ['Post deletion is temporarily unavailable. Please contact support.', 'Tính năng xóa bài tạm thời chưa khả dụng. Vui lòng liên hệ hỗ trợ.'],
      }
      const message = copy[code] || ['Your post could not be deleted. Please retry.', 'Không thể xóa bài viết của bạn. Vui lòng thử lại.']
      toast.error(tr(message[0], message[1]))
    } finally {
      setDeletingPost(false)
    }
  }

  const addThreadReply = async (body: string, parentId: string | null) => {
    // Same guard as every sibling mutation: open the sign-in dialog and throw a
    // typed code the thread dialog suppresses (no misleading "could not be
    // published" toast on top of the sign-in prompt).
    if (!user) { openSignIn(); throw new ForumApiError(401, 'auth_required') }
    if (!activePost) throw new Error('post_not_found')
    const { comment } = await forumApi<{ comment: ForumCommentResponse }>('/api/forum/comments', {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ postId: activePost.id, parentId, body }),
    })
    const mapped = mapForumComment(comment)
    setThreadComments((current) => ({
      ...current,
      [activePost.id]: insertThreadComment(current[activePost.id] || [], mapped, parentId),
    }))
    setPosts((current) => current.map((post) => post.id === activePost.id ? { ...post, commentCount: post.commentCount + 1 } : post))
    return mapped
  }

  const voteThreadComment = async (comment: ForumComment, value: -1 | 0 | 1) => {
    if (!user) { openSignIn(); throw new Error('auth_required') }
    if (!comment.live) return { score: comment.score + value, viewerVote: value }
    return forumApi<{ score: number; viewerVote: -1 | 0 | 1 }>(`/api/forum/comments/${encodeURIComponent(comment.id)}/vote`, {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ value }),
    })
  }

  const publishPost = async (draft: NewForumPost) => {
    try {
      const { post } = await forumApi<{ post: ForumPostResponse }>('/api/forum/posts', {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ ...draft, location: 'all', media: draft.media || [] }),
      })
      const mapped = mapForumPost(post)
      setPosts((current) => [mapped, ...current.filter((item) => item.id !== mapped.id)])
      setVotes((current) => ({ ...current, [mapped.id]: post.viewerVote }))
      setCommunity(draft.community)
      setMode('all')
      setSort('latest')
      setQuery('')
      toast.success(tr('Your post is live.', 'Bài viết của bạn đã được đăng.'))
    } catch (error) {
      toast.error(tr('Your post could not be published.', 'Không thể đăng bài viết của bạn.'))
      throw error
    }
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
      <ForumHeader query={query} onQueryChange={setQuery} onCreatePost={openCreatePost} />

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
            {communities.map((item) => (
              <Button
                key={item.slug}
                type="button"
                variant="bare"
                size="none"
                className={cn(
                  'h-10 shrink-0 gap-2 rounded-full border border-border bg-transparent px-3 text-xs font-semibold text-body',
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

        <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,680px)_300px]">
          <ForumLeftRail
            communities={communities}
            activeCommunity={community}
            mode={mode}
            sort={sort}
            savedCount={saved.size}
            onSelectCommunity={chooseCommunity}
            onNavigate={navigateFeed}
          />

          <div className="min-w-0 space-y-4">
            <Card className="relative gap-0 overflow-hidden rounded-none bg-transparent px-1 py-5 text-foreground ring-0 sm:px-1 sm:py-6">
              <div className="relative z-10 max-w-lg">
                <Badge variant="brand" size="sm">
                  <Languages className="h-3 w-3" />
                  {tr('People-powered local knowledge', 'Kiến thức địa phương từ cộng đồng')}
                </Badge>
                <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
                  {tr('Vietnam feels easier together.', 'Cuộc sống ở Việt Nam dễ dàng hơn khi có nhau.')}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-body sm:text-base">
                  {tr('Ask what search results cannot answer. Get current, firsthand help from people who live here.', 'Hỏi những điều khó tìm trên mạng. Nhận chia sẻ cập nhật từ những người đang sống tại đây.')}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button type="button" variant="soft" className="text-body" onClick={() => openThread('new-to-vietnam-checklist')}>
                    <CircleHelp className="h-4 w-4" />
                    {tr('Newcomer guide', 'Hướng dẫn người mới')}
                  </Button>
                </div>
              </div>
              <MessageCircleQuestion className="pointer-events-none absolute -bottom-8 -right-4 h-40 w-40 text-brand/5 sm:h-48 sm:w-48" aria-hidden="true" />
            </Card>

            <Card className="gap-0 rounded-none border-y border-border/80 bg-transparent py-0 ring-0">
              <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Avatar name={tr('Guest', 'Khách')} size="sm" />
                <Button type="button" variant="bare" size="none" className="h-11 min-w-0 flex-1 justify-start rounded-xl bg-tint px-4 text-left text-sm font-normal text-body hover:bg-muted" onClick={openCreatePost}>
                  <span className="truncate">{tr('Ask a question or share an experience…', 'Đặt câu hỏi hoặc chia sẻ trải nghiệm…')}</span>
                </Button>
              </div>
              <div className="grid grid-cols-3 border-t border-border/70">
                <Button type="button" variant="bare" size="none" className="h-10 gap-1.5 rounded-none text-xs text-body hover:bg-tint" onClick={openCreatePost}>
                  <MessageCircleQuestion className="h-4 w-4 text-accent-foreground" />
                  {tr('Ask', 'Đặt câu hỏi')}
                </Button>
                <Button type="button" variant="bare" size="none" className="h-10 gap-1.5 rounded-none border-x border-border/70 text-xs text-body hover:bg-tint" onClick={openCreatePost}>
                  <HeartHandshake className="h-4 w-4 text-accent-foreground" />
                  {tr('Share', 'Chia sẻ')}
                </Button>
                <Button type="button" variant="bare" size="none" className="h-10 gap-1.5 rounded-none text-xs text-body hover:bg-tint" onClick={openCreatePost}>
                  <CalendarDays className="h-4 w-4 text-accent-foreground" />
                  {tr('Meet up', 'Gặp gỡ')}
                </Button>
              </div>
            </Card>

            <Tabs value={sort} onValueChange={(value) => { setSort(value as ForumSort); setMode('all') }} className="gap-3">
              <div className="flex items-center justify-between gap-3 border-b border-border/80 px-0 py-2">
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
                      onBlock={blockPostAuthor}
                      onReport={reportPost}
                      viewerId={user?.id || null}
                      onDelete={requestDeletePost}
                      onReset={resetFilters}
                    />
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </div>

          <ForumRightRail communities={communities} posts={posts} helpers={initialHelpers} onOpenPost={openThread} />
        </div>
      </main>

      <ForumFooter />

      <MobileForumNav
        mode={mode}
        sort={sort}
        savedCount={saved.size}
        onHome={resetFilters}
        onPopular={() => navigateFeed('all', 'top')}
        onCreate={openCreatePost}
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
        comments={activePost?.live ? threadComments[activePost.id] || [] : null}
        onAddReply={addThreadReply}
        onCommentVote={voteThreadComment}
        canDelete={Boolean(activePost && canDeleteForumPost(activePost, user?.id))}
        onDelete={() => { if (activePost) requestDeletePost(activePost) }}
      />

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !deletingPost) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive"><Trash2 className="h-5 w-5" /></span>
            <DialogTitle className="text-lg font-bold">{tr('Delete this post?', 'Xóa bài viết này?')}</DialogTitle>
            <DialogDescription>{tr('This removes the discussion from the forum. This action cannot be undone.', 'Thao tác này sẽ xóa thảo luận khỏi diễn đàn và không thể hoàn tác.')}</DialogDescription>
          </DialogHeader>
          {deleteTarget && <p className="line-clamp-2 rounded-xl bg-tint px-4 py-3 text-sm font-semibold text-foreground">{deleteTarget.title}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" disabled={deletingPost} onClick={() => setDeleteTarget(null)}>{tr('Keep post', 'Giữ bài viết')}</Button>
            <Button type="button" variant="destructive" className="h-11" disabled={deletingPost} onClick={() => void deletePost()}>{deletingPost ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{tr('Delete post', 'Xóa bài viết')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
