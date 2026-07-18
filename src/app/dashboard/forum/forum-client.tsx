'use client'

import { useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowBigUp, Bookmark, MessageCircle, UsersRound } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { FORUM_URL, goToForum } from '@/lib/forum-nav'
import { timeAgo } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SectionHeader } from '@/components/marketplace/section-header'

export type ForumThreadItem = {
  id: string
  title: string
  community: string
  communityVi: string
  score: number
  commentCount: number
  createdAt: string
}

export type ForumCommentItem = {
  id: string
  postId: string
  postTitle: string
  excerpt: string
  score: number
  createdAt: string
}

export type ForumActivity = {
  posts: ForumThreadItem[]
  comments: ForumCommentItem[]
  saved: ForumThreadItem[]
}

// Canonical thread URL shape — the SAME one forum-reply notifications use
// (api/forum/comments: `${forumUrl}/?post=<id>`). The forum routes threads off
// the ?post query param, not a path segment.
function threadPath(postId: string): string {
  return `/?post=${encodeURIComponent(postId)}`
}

// Cross-site anchor idiom copied from account-panel: the href stays a REAL plain
// URL for a11y / middle-click / cmd-click; a normal left-click is intercepted so
// goToForum can route natives through the single-use SSO handoff (web just
// location.assigns the same URL).
function forumClick(path: string) {
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    goToForum(path)
  }
}

function ThreadAnchor({ postId, children }: { postId: string; children: React.ReactNode }) {
  const path = threadPath(postId)
  return (
    <a
      href={FORUM_URL + path}
      onClick={forumClick(path)}
      // press = the native-row tactile treatment (its base transition keeps the
      // hover:bg-muted colour animating); the whole row is already one full-row anchor.
      className="press block rounded-2xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted"
    >
      {children}
    </a>
  )
}

function ThreadMeta({ item }: { item: ForumThreadItem }) {
  const { tr, lang } = useLanguage()
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      <span>{lang === 'vi' ? item.communityVi : item.community}</span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1">
        <ArrowBigUp className="h-3.5 w-3.5" aria-hidden />
        {item.score}
        <span className="sr-only">{tr('votes', 'lượt bình chọn')}</span>
      </span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1">
        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
        {item.commentCount}
        <span className="sr-only">{tr('comments', 'bình luận')}</span>
      </span>
      <span aria-hidden>·</span>
      <span>{timeAgo(item.createdAt, lang)}</span>
    </p>
  )
}

function ThreadList({ items }: { items: ForumThreadItem[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.id}>
          <ThreadAnchor postId={item.id}>
            <p className="line-clamp-2 text-sm font-semibold text-foreground">{item.title}</p>
            <ThreadMeta item={item} />
          </ThreadAnchor>
        </li>
      ))}
    </ul>
  )
}

function CommentList({ items }: { items: ForumCommentItem[] }) {
  const { tr, lang } = useLanguage()
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.id}>
          <ThreadAnchor postId={item.postId}>
            <p className="line-clamp-2 text-sm text-foreground">{item.excerpt}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="line-clamp-1">
                {tr('On:', 'Trong:')} <span className="font-medium">{item.postTitle}</span>
              </span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <ArrowBigUp className="h-3.5 w-3.5" aria-hidden />
                {item.score}
                <span className="sr-only">{tr('votes', 'lượt bình chọn')}</span>
              </span>
              <span aria-hidden>·</span>
              <span>{timeAgo(item.createdAt, lang)}</span>
            </p>
          </ThreadAnchor>
        </li>
      ))}
    </ul>
  )
}

// Every empty group keeps a visible "Open the forum" CTA — an empty section with a
// clear next step is WANTED here (owner), never suppress-when-empty.
function OpenForumCta() {
  const { tr } = useLanguage()
  return (
    <Button variant="cta" asChild>
      <a href={`${FORUM_URL}/`} onClick={forumClick('/')}>
        {tr('Open the forum', 'Mở diễn đàn')}
      </a>
    </Button>
  )
}

/** /dashboard/forum — the signed-in user's forum life (posts / comments / saved),
 *  server-loaded from eno.vn's own forum tables and rendered in <main> like every
 *  other dashboard section. Auth-gated exactly like disputes/listings. */
export function ForumClient({ activity }: { activity: ForumActivity | null }) {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()
  // Server-rendered (or previously fetched) data belongs to the account that loaded it.
  // A cross-tab sign-in can swap the session to ANOTHER user while this page sits open
  // (Supabase broadcasts auth changes across tabs). Refresh inside a transition and
  // HIDE the stale payload for its duration — account A's data must never render
  // under account B, not even while the refresh is in flight.
  const [switching, startSwitch] = useTransition()
  const lastUid = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (user?.id && lastUid.current && user.id !== lastUid.current) startSwitch(() => router.refresh())
    if (user?.id) lastUid.current = user.id
  }, [user?.id, router])


  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/forum')
  }, [loading, user, router])

  if (loading || switching || !user) {
    return (
      <div role="status" className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  // `user` present but the server saw no session cookie (auth race on a fresh
  // sign-in): render the empty groups rather than crashing — a route refresh or
  // any navigation re-fetches with the cookie in place.
  const data = activity ?? { posts: [], comments: [], saved: [] }

  return (
    <>
      {/* Native stack-nav title bar (mobile only) — same established title string. */}
      <SectionHeader title={tr('Forum activity', 'Hoạt động diễn đàn')} />
      <div className="space-y-1">
        {/* The h1 stays for the document outline; on mobile the SectionHeader shows the
            visible title, so it drops to sr-only there (max-lg pairs with its lg:hidden). */}
        <h1 className="text-xl font-bold text-foreground max-lg:sr-only">{tr('Forum activity', 'Hoạt động diễn đàn')}</h1>
        <p className="text-sm text-muted-foreground">
          {tr('Your posts, comments and saved threads on eno.forum', 'Bài viết, bình luận và chủ đề đã lưu của bạn trên eno.forum')}
        </p>
      </div>
      <Tabs defaultValue="posts" className="mt-6">
        <TabsList>
          <TabsTrigger value="posts">{tr('Posts', 'Bài viết')}</TabsTrigger>
          <TabsTrigger value="comments">{tr('Comments', 'Bình luận')}</TabsTrigger>
          <TabsTrigger value="saved">{tr('Saved', 'Đã lưu')}</TabsTrigger>
        </TabsList>
        <TabsContent value="posts" className="mt-4">
          {data.posts.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title={tr('No posts yet', 'Chưa có bài viết nào')}
              subtitle={tr('Share a question or a guide with the community.', 'Chia sẻ câu hỏi hoặc kinh nghiệm với cộng đồng.')}
              action={<OpenForumCta />}
            />
          ) : (
            <ThreadList items={data.posts} />
          )}
        </TabsContent>
        <TabsContent value="comments" className="mt-4">
          {data.comments.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title={tr('No comments yet', 'Chưa có bình luận nào')}
              subtitle={tr('Join a thread and help someone out.', 'Tham gia thảo luận và giúp đỡ mọi người.')}
              action={<OpenForumCta />}
            />
          ) : (
            <CommentList items={data.comments} />
          )}
        </TabsContent>
        <TabsContent value="saved" className="mt-4">
          {data.saved.length === 0 ? (
            <EmptyState
              icon={Bookmark}
              title={tr('No saved threads yet', 'Chưa lưu chủ đề nào')}
              subtitle={tr('Bookmark threads on the forum to find them again here.', 'Lưu chủ đề trên diễn đàn để xem lại tại đây.')}
              action={<OpenForumCta />}
            />
          ) : (
            <ThreadList items={data.saved} />
          )}
        </TabsContent>
      </Tabs>
    </>
  )
}
