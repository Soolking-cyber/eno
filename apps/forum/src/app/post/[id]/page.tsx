import type { Metadata } from 'next'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { ArrowBigUp, CheckCircle2, MapPin, MessageCircle } from 'lucide-react'
import { Tr } from '@/context/language-context'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ForumFooter } from '@/components/forum/forum-footer'
import { ForumHeader } from '@/components/forum/forum-header'
import { ForumTrustBadgeIcon } from '@/components/forum/trust-badge'
import {
  DEFAULT_THREAD_COMMENTS,
  FORUM_COMMUNITIES,
  INITIAL_FORUM_POSTS,
  THREAD_COMMENTS,
  type ForumComment,
  type ForumPost,
} from '@/components/forum/forum-data'
import {
  mapForumComment,
  mapForumPost,
  type ForumCommentResponse,
  type ForumPostResponse,
} from '@/lib/forum-api'

const MARKETPLACE_API_URL = (
  process.env.MARKETPLACE_API_URL
  || process.env.NEXT_PUBLIC_MARKETPLACE_URL
  || 'https://eno.vn'
).replace(/\/$/, '')

const FORUM_URL = (process.env.NEXT_PUBLIC_FORUM_URL || 'https://eno.forum').replace(/\/$/, '')

// Minimal serializable comment shape kept alongside the mapped UI comments,
// because mapForumComment drops createdAt and JSON-LD needs real dates.
type ThreadCommentLd = { body: string; author: string; createdAt: string; replies: ThreadCommentLd[] }

type Thread = {
  post: ForumPost
  comments: ForumComment[]
  createdAt: string
  updatedAt: string
  commentsLd: ThreadCommentLd[]
}

function liveCommentLd(comment: ForumCommentResponse): ThreadCommentLd {
  return {
    body: comment.body,
    author: comment.author.name,
    createdAt: comment.createdAt,
    replies: comment.replies.map(liveCommentLd),
  }
}

function previewCommentLd(comments: ForumComment[], createdAt: string): ThreadCommentLd[] {
  return comments.map((comment) => ({
    body: comment.body,
    author: comment.author,
    createdAt,
    replies: previewCommentLd(comment.replies || [], createdAt),
  }))
}

// React cache() (not bare fetch dedup): the AbortSignal option would otherwise
// make the generateMetadata and page fetches distinct requests.
const getThread = cache(async (id: string): Promise<Thread | null> => {
  if (process.env.FORUM_E2E_PREVIEW === '1') {
    // Mirror the home page's outage/e2e fallback so preview post permalinks
    // resolve in the same environments where the feed serves preview posts.
    const post = INITIAL_FORUM_POSTS.find((item) => item.id === id)
    if (!post) return null
    const comments = THREAD_COMMENTS[post.id] || DEFAULT_THREAD_COMMENTS
    const createdAt = new Date(Date.now() - post.minutesAgo * 60_000).toISOString()
    return { post, comments, createdAt, updatedAt: createdAt, commentsLd: previewCommentLd(comments, createdAt) }
  }

  const response = await fetch(`${MARKETPLACE_API_URL}/api/forum/posts/${encodeURIComponent(id)}`, {
    next: { revalidate: 30 },
    signal: AbortSignal.timeout(4_000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error('forum_post_unavailable')
  const body = await response.json() as { post: ForumPostResponse; comments: ForumCommentResponse[] }
  return {
    post: mapForumPost(body.post),
    comments: body.comments.map(mapForumComment),
    createdAt: body.post.createdAt,
    updatedAt: body.post.updatedAt,
    commentsLd: body.comments.map(liveCommentLd),
  }
})

function postDescription(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 155)
}

function jsonLd(data: object) {
  return { __html: JSON.stringify(data).replace(/</g, '\\u003c') }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const thread = await getThread(id)
  if (!thread) return {}
  const { post } = thread
  const description = postDescription(post.body)
  const path = `/post/${encodeURIComponent(post.id)}`
  return {
    // The layout's `%s | eno.forum` template appends the site name.
    title: post.title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: `${post.title} | eno.forum`,
      description,
      url: path,
      siteName: 'eno.forum',
      type: 'article',
      ...(post.media?.length ? { images: post.media.map((item) => item.url) } : {}),
    },
    twitter: { card: 'summary', title: post.title, description },
  }
}

function toCommentLd(item: ThreadCommentLd): object {
  return {
    '@type': 'Comment',
    text: item.body,
    dateCreated: item.createdAt,
    author: { '@type': 'Person', name: item.author },
    ...(item.replies.length ? { comment: item.replies.map(toCommentLd) } : {}),
  }
}

// Read-only server render of a comment branch — the interactive tree (votes,
// reply composer, collapse) lives in thread-dialog and stays client-side.
function ReadOnlyComment({ comment }: { comment: ForumComment }) {
  const replies = comment.replies || []
  return (
    <article className="flex gap-3">
      <Avatar name={comment.author} url={comment.authorAvatarUrl} color={comment.authorAvatarColor} size="sm" className="h-8 w-8 text-2xs" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-bold text-foreground">{comment.author}</span>
          <ForumTrustBadgeIcon badge={comment.trustBadge} trustScore={comment.trustScore} />
          {comment.authorRole && <span className="text-2xs text-body">{comment.authorRole}</span>}
          <span className="text-2xs text-ink-4">{comment.timeLabel}</span>
          {comment.helpful && (
            <Badge variant="brand" size="sm">
              <CheckCircle2 className="h-3 w-3" />
              <Tr text="Helpful answer" vi="Câu trả lời hữu ích" />
            </Badge>
          )}
        </div>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground">{comment.body}</p>
        <p className="mt-2 inline-flex items-center gap-1 text-xs font-bold tabular-nums text-body">
          <ArrowBigUp className="h-4 w-4" aria-hidden="true" />
          {comment.score}
        </p>
        {replies.length > 0 && (
          <div className="mt-4 space-y-4 border-l border-border pl-4">
            {replies.map((reply) => <ReadOnlyComment key={reply.id} comment={reply} />)}
          </div>
        )}
      </div>
    </article>
  )
}

export default async function ForumPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const thread = await getThread(id)
  if (!thread) notFound()
  const { post, comments } = thread
  const community = FORUM_COMMUNITIES.find((item) => item.slug === post.community) || null
  const postUrl = `${FORUM_URL}/post/${encodeURIComponent(post.id)}`
  // The interactive client (vote/reply/save dialog) opens via a HASH deep link:
  // a hash never reaches the server, so it cannot bounce off the home page's
  // legacy `?post=` → /post/[id] permanent redirect.
  const joinHref = `/#post=${encodeURIComponent(post.id)}`

  const discussionLd = {
    '@context': 'https://schema.org',
    '@type': 'DiscussionForumPosting',
    '@id': postUrl,
    url: postUrl,
    headline: post.title,
    text: post.body,
    author: { '@type': 'Person', name: post.author },
    datePublished: thread.createdAt,
    dateModified: thread.updatedAt,
    ...(post.media?.length ? { image: post.media.map((item) => item.url) } : {}),
    interactionStatistic: [
      { '@type': 'InteractionCounter', interactionType: { '@type': 'LikeAction' }, userInteractionCount: Math.max(post.score, 0) },
      { '@type': 'InteractionCounter', interactionType: { '@type': 'CommentAction' }, userInteractionCount: post.commentCount },
    ],
    comment: thread.commentsLd.map(toCommentLd),
  }

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'eno.forum', item: `${FORUM_URL}/` },
      { '@type': 'ListItem', position: 2, name: post.title, item: postUrl },
    ],
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(discussionLd)} />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(breadcrumbLd)} />
      <ForumHeader />

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-3 py-6 sm:px-6">
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs text-body">
          <a href="/" className="shrink-0 rounded-md font-semibold text-accent-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
            <Tr text="Forum" vi="Diễn đàn" />
          </a>
          {community && (
            <>
              <span className="text-ink-4" aria-hidden="true">/</span>
              <span className="shrink-0"><Tr text={community.name} vi={community.nameVi} /></span>
            </>
          )}
          <span className="text-ink-4" aria-hidden="true">/</span>
          <span className="min-w-0 truncate text-ink-4">{post.title}</span>
        </nav>

        <article>
          <header>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-body">
              <Avatar name={post.author} url={post.authorAvatarUrl} color={post.authorAvatarColor} size="sm" className="h-8 w-8" />
              {community && (
                <>
                  <span className="font-bold text-foreground"><Tr text={community.name} vi={community.nameVi} /></span>
                  <span className="text-ink-4" aria-hidden="true">·</span>
                </>
              )}
              <span>{post.author}</span>
              <ForumTrustBadgeIcon badge={post.trustBadge} trustScore={post.trustScore} />
              <span className="text-ink-4" aria-hidden="true">·</span>
              <time dateTime={thread.createdAt} className="text-ink-4">{post.timeLabel}</time>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {post.pinned && (
                <Badge variant="brand" size="sm">
                  <Tr text="Pinned" vi="Đã ghim" />
                </Badge>
              )}
              <Badge variant={post.kind === 'question' ? 'warning' : post.kind === 'event' ? 'success' : 'neutral'} size="sm">
                <Tr text={post.flair} vi={post.flairVi} />
              </Badge>
              {post.locationLabel && (
                <span className="inline-flex items-center gap-1 text-2xs font-medium text-body">
                  <MapPin className="h-3 w-3" />
                  {post.locationLabel}
                </span>
              )}
            </div>

            <h1 className="mt-3 text-2xl font-bold leading-snug tracking-tight text-foreground sm:text-3xl">
              {post.title}
            </h1>
          </header>

          <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-body">{post.body}</p>

          {post.media?.length ? (
            <div className={post.media.length > 1 ? 'mt-4 grid grid-cols-2 gap-2 overflow-hidden rounded-xl' : 'mt-4 grid gap-2 overflow-hidden rounded-xl'}>
              {post.media.map((item) => (
                <img key={item.url} src={item.url} alt={item.altText || ''} className="max-h-96 w-full object-cover" />
              ))}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-tint px-3 text-xs font-bold tabular-nums text-foreground">
              <ArrowBigUp className="h-4 w-4" aria-hidden="true" />
              {post.score}
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-tint px-3 text-xs font-bold tabular-nums text-foreground">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {post.commentCount} <Tr text="replies" vi="phản hồi" />
            </span>
            <Button asChild variant="cta" size="sm" className="ml-auto">
              <a href={joinHref}>
                <MessageCircle className="h-4 w-4" />
                <Tr text="Join the discussion" vi="Tham gia thảo luận" />
              </a>
            </Button>
          </div>
        </article>

        <div className="my-6 flex items-center gap-3">
          <Separator className="flex-1" />
          <h2 className="shrink-0 text-xs font-semibold text-body">
            <Tr text="Community replies" vi="Phản hồi từ cộng đồng" /> · {comments.length}
          </h2>
          <Separator className="flex-1" />
        </div>

        {comments.length > 0 ? (
          <div className="space-y-6">
            {comments.map((comment) => <ReadOnlyComment key={comment.id} comment={comment} />)}
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-body">
            <Tr text="No replies yet — be the first to share a helpful answer." vi="Chưa có phản hồi — hãy là người đầu tiên chia sẻ câu trả lời hữu ích." />
          </p>
        )}
      </main>

      <ForumFooter />
    </div>
  )
}
