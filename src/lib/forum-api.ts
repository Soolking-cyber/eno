import type { ForumComment, ForumPost, ForumPostKind, ForumTrustBadge } from '@/components/forum/forum-data'

export type ForumAuthorResponse = {
  id: string | null
  name: string
  avatarUrl: string | null
  avatarColor: string | null
  role: string | null
  trustScore: number | null
  trustTier: string | null
  badge: ForumTrustBadge | null
}

export type ForumPostResponse = {
  id: string
  community: string
  kind: string
  flair: string
  flairVi: string
  title: string
  body: string
  author: ForumAuthorResponse
  location: string
  locationLabel: string | null
  pinned: boolean
  official: boolean
  score: number
  commentCount: number
  viewCount: number
  createdAt: string
  updatedAt: string
  viewerVote: -1 | 0 | 1
  saved: boolean
  media: Array<{ url: string | null; altText: string | null; width: number | null; height: number | null }>
}

export type ForumCommentResponse = {
  id: string
  postId: string
  parentId: string | null
  body: string
  author: ForumAuthorResponse
  helpful: boolean
  score: number
  replyCount: number
  createdAt: string
  updatedAt: string
  viewerVote: -1 | 0 | 1
  replies: ForumCommentResponse[]
}

function timeParts(createdAt: string) {
  const minutesAgo = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000))
  const timeLabel = minutesAgo < 1
    ? 'Just now'
    : minutesAgo < 60
      ? `${minutesAgo} min ago`
      : minutesAgo < 1_440
        ? `${Math.floor(minutesAgo / 60)} hr ago`
        : `${Math.floor(minutesAgo / 1_440)} d ago`
  return { minutesAgo, timeLabel }
}

function isForumKind(value: string): value is ForumPostKind {
  return ['guide', 'question', 'experience', 'event', 'discussion'].includes(value)
}

export function mapForumPost(post: ForumPostResponse): ForumPost {
  return {
    id: post.id,
    community: post.community,
    kind: isForumKind(post.kind) ? post.kind : 'discussion',
    flair: post.flair,
    flairVi: post.flairVi,
    title: post.title,
    body: post.body,
    author: post.author.name,
    authorId: post.author.id,
    authorAvatarUrl: post.author.avatarUrl,
    authorAvatarColor: post.author.avatarColor,
    authorRole: post.author.role || undefined,
    trustScore: post.author.trustScore,
    trustTier: post.author.trustTier,
    trustBadge: post.author.badge,
    ...timeParts(post.createdAt),
    // Card state adds viewerVote optimistically, so keep the server aggregate
    // normalized to the score before this viewer's vote.
    score: post.score - post.viewerVote,
    commentCount: post.commentCount,
    location: post.location === 'hcmc' || post.location === 'hanoi' || post.location === 'danang' ? post.location : 'all',
    locationLabel: post.locationLabel || undefined,
    pinned: post.pinned,
    official: post.official,
    live: true,
    media: post.media.filter((item): item is typeof item & { url: string } => Boolean(item.url)),
  }
}

export function canDeleteForumPost(post: ForumPost, viewerId: string | null | undefined) {
  return Boolean(post.live && viewerId && post.authorId === viewerId)
}

export function mapForumComment(comment: ForumCommentResponse): ForumComment {
  return {
    id: comment.id,
    author: comment.author.name,
    authorId: comment.author.id,
    authorAvatarUrl: comment.author.avatarUrl,
    authorAvatarColor: comment.author.avatarColor,
    authorRole: comment.author.role || undefined,
    trustScore: comment.author.trustScore,
    trustTier: comment.author.trustTier,
    trustBadge: comment.author.badge,
    body: comment.body,
    score: comment.score - comment.viewerVote,
    timeLabel: timeParts(comment.createdAt).timeLabel,
    helpful: comment.helpful,
    viewerVote: comment.viewerVote,
    live: true,
    replies: comment.replies.map(mapForumComment),
  }
}
