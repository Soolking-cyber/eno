import 'server-only'

import { db } from '@/lib/db'
import type { ForumActivity, ForumThreadItem } from './forum-client'

// The /dashboard/forum section's server queries, extracted so the dashboard HOME
// (/dashboard) can reuse them for its "Forum activity" card without duplicating the
// projections or the P2021 soft-degrade. Behavior is identical to when this lived in
// forum/page.tsx — the section page now calls this with the resolved profile id.

// Mirror of the forum-reply notification excerpt cap (api/forum/comments POST).
const EXCERPT_MAX = 180

// Same projection for "my posts" and "saved posts" — the two lists render identically.
const threadSelect = {
  id: true,
  title: true,
  score: true,
  commentCount: true,
  createdAt: true,
  community: { select: { name: true, nameVi: true } },
} as const

function toThreadItem(post: {
  id: string
  title: string
  score: number
  commentCount: number
  createdAt: Date
  community: { name: string; nameVi: string }
}): ForumThreadItem {
  return {
    id: post.id,
    title: post.title,
    community: post.community.name,
    communityVi: post.community.nameVi,
    score: post.score,
    commentCount: post.commentCount,
    createdAt: post.createdAt.toISOString(),
  }
}

export async function loadForumActivity(profileId: string): Promise<ForumActivity> {
  try {
    // status 'published' throughout: the forum only renders published threads at
    // /?post=<id>, so a hidden/removed row here would be a dead cross-site link.
    // Filters match the shapes /api/forum/posts uses (authorProfileId+createdAt and
    // profileId+createdAt are both indexed).
    const [posts, comments, bookmarks] = await Promise.all([
      db.forumPost.findMany({
        where: { authorProfileId: profileId, status: 'published' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: threadSelect,
      }),
      db.forumComment.findMany({
        where: { authorProfileId: profileId, status: 'published', post: { status: 'published' } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          postId: true,
          body: true,
          score: true,
          createdAt: true,
          post: { select: { title: true } },
        },
      }),
      db.forumBookmark.findMany({
        where: { profileId, post: { status: 'published' } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { post: { select: threadSelect } },
      }),
    ])
    return {
      posts: posts.map(toThreadItem),
      comments: comments.map((comment) => ({
        id: comment.id,
        postId: comment.postId,
        postTitle: comment.post.title,
        excerpt: comment.body.length > EXCERPT_MAX ? `${comment.body.slice(0, EXCERPT_MAX)}…` : comment.body,
        score: comment.score,
        createdAt: comment.createdAt.toISOString(),
      })),
      saved: bookmarks.map((bookmark) => toThreadItem(bookmark.post)),
    }
  } catch (error) {
    // P2021 = forum tables not migrated in this environment; soft-degrade to empty
    // groups exactly like the /api/forum/* routes do — never 500 the dashboard.
    if ((error as { code?: string }).code === 'P2021') return { posts: [], comments: [], saved: [] }
    throw error
  }
}
