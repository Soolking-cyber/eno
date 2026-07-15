import 'server-only'

type PublicAuthor = {
  id: string
  displayName: string | null
  avatarUrl: string | null
  avatarColor: string
  trustScore: number
  trustTier: string
  seller: {
    name: string
    verified: boolean
    verifiedSeller: boolean
  } | null
  forumProfile: {
    residentSince: number | null
    reputation: number
    helpfulAnswerCount: number
  } | null
}

export type ForumAuthorDto = {
  id: string | null
  name: string
  avatarUrl: string | null
  avatarColor: string | null
  role: string | null
  trustScore: number | null
  trustTier: string | null
  badge: 'verified_seller' | 'trusted_member' | 'established_expat' | 'top_helper' | null
}

export const forumAuthorSelect = {
  id: true,
  displayName: true,
  avatarUrl: true,
  avatarColor: true,
  trustScore: true,
  trustTier: true,
  seller: { select: { name: true, verified: true, verifiedSeller: true } },
  forumProfile: { select: { residentSince: true, reputation: true, helpfulAnswerCount: true } },
} as const

export function serializeForumAuthor(
  author: PublicAuthor | null,
  fallbackName?: string | null,
  fallbackRole?: string | null,
): ForumAuthorDto {
  if (!author) {
    return {
      id: null,
      name: fallbackName || 'Former member',
      avatarUrl: null,
      avatarColor: null,
      role: fallbackRole || null,
      trustScore: null,
      trustTier: null,
      badge: null,
    }
  }

  const currentYear = new Date().getUTCFullYear()
  const badge = author.seller?.verifiedSeller || author.seller?.verified
    ? 'verified_seller'
    : author.forumProfile && author.forumProfile.helpfulAnswerCount >= 5
      ? 'top_helper'
      : author.trustTier === 'exceptional' || author.trustTier === 'trusted'
        ? 'trusted_member'
        : author.forumProfile?.residentSince && currentYear - author.forumProfile.residentSince >= 2
          ? 'established_expat'
          : null

  return {
    id: author.id,
    name: author.displayName || author.seller?.name || fallbackName || 'eno member',
    avatarUrl: author.avatarUrl,
    avatarColor: author.avatarColor,
    role: fallbackRole || null,
    trustScore: author.trustScore,
    trustTier: author.trustTier,
    badge,
  }
}

export function forumMediaUrl(storagePath: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/')
  return `${base}/storage/v1/object/public/forum-media/${encodedPath}`
}

type PublicForumPost = {
  id: string
  communitySlug: string
  kind: string
  flair: string
  flairVi: string
  title: string
  body: string
  authorName: string | null
  authorRole: string | null
  author: PublicAuthor | null
  location: string
  locationLabel: string | null
  pinned: boolean
  official: boolean
  score: number
  commentCount: number
  viewCount: number
  createdAt: Date
  updatedAt: Date
  media: Array<{ storagePath: string; mimeType: string; width: number | null; height: number | null; altText: string | null; position: number }>
  votes: Array<{ value: number }>
  bookmarks: Array<{ postId: string }>
}

export function serializeForumPost(post: PublicForumPost) {
  return {
    id: post.id,
    community: post.communitySlug,
    kind: post.kind,
    flair: post.flair,
    flairVi: post.flairVi,
    title: post.title,
    body: post.body,
    author: serializeForumAuthor(post.author, post.authorName, post.authorRole),
    location: post.location,
    locationLabel: post.locationLabel,
    pinned: post.pinned,
    official: post.official,
    score: post.score,
    commentCount: post.commentCount,
    viewCount: post.viewCount,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    viewerVote: post.votes[0]?.value || 0,
    saved: post.bookmarks.length > 0,
    media: post.media.map((item) => ({ ...item, url: forumMediaUrl(item.storagePath) })),
  }
}

type PublicForumComment = {
  id: string
  postId: string
  parentId: string | null
  body: string
  authorName: string | null
  authorRole: string | null
  author: PublicAuthor | null
  helpful: boolean
  score: number
  replyCount: number
  createdAt: Date
  updatedAt: Date
  votes: Array<{ value: number }>
}

export type ForumCommentDto = ReturnType<typeof serializeForumComment> & {
  replies: ForumCommentDto[]
}

export function serializeForumComment(comment: PublicForumComment) {
  return {
    id: comment.id,
    postId: comment.postId,
    parentId: comment.parentId,
    body: comment.body,
    author: serializeForumAuthor(comment.author, comment.authorName, comment.authorRole),
    helpful: comment.helpful,
    score: comment.score,
    replyCount: comment.replyCount,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    viewerVote: comment.votes[0]?.value || 0,
  }
}
