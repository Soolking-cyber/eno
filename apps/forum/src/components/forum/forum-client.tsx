'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays,
  CircleHelp,
  HeartHandshake,
  Languages,
  Loader2,
  MapPin,
  MessageCircleQuestion,
  Search,
  SearchX,
  Sparkles,
} from 'lucide-react'
import { Tr, useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { ForumFooter } from '@/components/forum/forum-footer'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import { canDeleteForumPost } from '@/lib/forum-api'
import { CreatePostDialog } from './create-post-dialog'
import { DeletePostDialog } from './delete-post-dialog'
import {
  FORUM_COMMUNITIES,
  INITIAL_FORUM_POSTS,
  type ForumCommunity,
  type ForumPost,
} from './forum-data'
import { ForumHeader } from './forum-header'
import { CommunityIcon, ForumLeftRail } from './forum-left-rail'
import { ForumRightRail, type ForumHelper } from './forum-right-rail'
import { MobileForumNav } from './mobile-forum-nav'
import { ForumPostCard } from './forum-post-card'
import { ThreadDialog } from './thread-dialog'
import { useForumFeed, type FeedMode, type ForumSort } from './use-forum-feed'

export type { ForumHelper } from './forum-right-rail'

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
  const { user, openSignIn } = useAuth()
  const [hydrated, setHydrated] = useState(false)
  // Never changes after mount — plain prop alias, not state (communityMap's
  // useMemo keys on it either way).
  const communities = initialCommunities
  const [query, setQuery] = useState('')
  const [community, setCommunity] = useState<string | null>(null)
  const [location, setLocation] = useState('all')
  const [sort, setSort] = useState<ForumSort>('best')
  const [mode, setMode] = useState<FeedMode>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [openPostId, setOpenPostId] = useState<string | null>(null)
  // True while the CURRENT history entry is one openThread pushed. Closing then
  // uses history.back() so Back/Forward stay coherent; direct-loaded deep links
  // (?post= present at mount) never set it and close via replaceState instead.
  const threadHistoryRef = useRef(false)

  const openThread = (id: string) => {
    setOpenPostId(id)
    const url = new URL(window.location.href)
    // Same thread already in the URL (re-opening a direct-loaded deep link):
    // pushing again would take two Backs to leave.
    if (url.searchParams.get('post') === id) return
    url.searchParams.set('post', id)
    if (threadHistoryRef.current) {
      // Our thread entry is already on the stack (e.g. jumping to another post
      // from the right rail) — swap it in place so ONE Back still closes.
      window.history.replaceState({}, '', url)
    } else {
      // Push an entry so Back (incl. Android hardware Back → popstate) closes
      // the thread; the popstate listener re-syncs openPostId from the URL.
      window.history.pushState({}, '', url)
      threadHistoryRef.current = true
    }
  }

  const closeThread = () => {
    setOpenPostId(null)
    if (threadHistoryRef.current) {
      // Consume the entry we pushed so the stack does not accumulate stale
      // ?post URLs; popstate confirms the close (openPostId is already null).
      threadHistoryRef.current = false
      window.history.back()
      return
    }
    // Direct-loaded deep link (or post-traversal entry): nothing of ours to
    // pop — rewrite the URL in place.
    const url = new URL(window.location.href)
    url.searchParams.delete('post')
    window.history.replaceState({}, '', url)
  }

  const {
    posts,
    votes,
    saved,
    threadComments,
    activePost,
    hasMorePosts,
    loadingMore,
    deleteTarget,
    setDeleteTarget,
    deletingPost,
    votePost,
    savePost,
    reportPost,
    blockPostAuthor,
    requestDeletePost,
    deletePost,
    addThreadReply,
    voteThreadComment,
    publishPost,
    loadMorePosts,
  } = useForumFeed({ initialPosts, openPostId, closeThread, setCommunity, setMode, setSort, setQuery })

  const communityMap = useMemo(() => new Map(communities.map((item) => [item.slug, item])), [communities])

  useEffect(() => {
    setHydrated(true)
    // Deep link: sync state only — openThread would push a second history entry
    // for a URL that already carries ?post=.
    let postId = new URLSearchParams(window.location.search).get('post')
    // /post/[id]'s "Join the discussion" CTA lands here as /#post=<id>: a hash
    // never reaches the server, so it cannot bounce off the home page's legacy
    // `?post=` → /post/[id] permanent redirect. Rewrite it in place to the
    // ?post= form the dialog flow owns (replaceState issues no request).
    if (!postId && window.location.hash.startsWith('#post=')) {
      postId = decodeURIComponent(window.location.hash.slice('#post='.length))
      const url = new URL(window.location.href)
      url.hash = ''
      url.searchParams.set('post', postId)
      window.history.replaceState({}, '', url)
    }
    if (postId) setOpenPostId(postId)
  }, [])

  useEffect(() => {
    // History traversal drives the thread dialog: ?post is the source of truth.
    // Inside the native Android WebView, hardware Back dispatches popstate — so
    // Back closes an open thread instead of exiting the app, which is exactly
    // the wanted behavior.
    const onPopState = () => {
      // After any traversal we can no longer prove the current entry is ours —
      // reset so closeThread falls back to replaceState (never a second back()
      // that could pop past the first entry and exit the WebView).
      threadHistoryRef.current = false
      setOpenPostId(new URLSearchParams(window.location.search).get('post'))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
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

            {mode === 'all' && hasMorePosts && (
              <div className="flex justify-center pt-1">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full max-w-xs"
                  disabled={loadingMore}
                  onClick={() => void loadMorePosts()}
                >
                  {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                  {tr('Load more discussions', 'Xem thêm thảo luận')}
                </Button>
              </div>
            )}
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

      <DeletePostDialog
        deleteTarget={deleteTarget}
        deletingPost={deletingPost}
        setDeleteTarget={setDeleteTarget}
        deletePost={deletePost}
      />
    </div>
  )
}
