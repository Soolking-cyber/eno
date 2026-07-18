import { ForumClient } from '@/components/forum/forum-client'
import {
  FORUM_COMMUNITIES,
  INITIAL_FORUM_POSTS,
  type ForumCommunity,
} from '@/components/forum/forum-data'
import {
  mapForumPost,
  type ForumPostResponse,
} from '@/lib/forum-api'
import type { ForumHelper } from '@/components/forum/forum-client'

const MARKETPLACE_API_URL = (
  process.env.MARKETPLACE_API_URL
  || process.env.NEXT_PUBLIC_MARKETPLACE_URL
  || 'https://eno.vn'
).replace(/\/$/, '')

type CommunityResponse = Omit<ForumCommunity, 'members' | 'online'> & { memberCount: number }

async function forumJson<T>(path: string): Promise<T> {
  const response = await fetch(`${MARKETPLACE_API_URL}/api/forum/${path}`, {
    next: { revalidate: 30 },
    signal: AbortSignal.timeout(4_000),
  })
  if (!response.ok) throw new Error(`forum_${path}_unavailable`)
  return response.json() as Promise<T>
}

async function initialForumData() {
  if (process.env.FORUM_E2E_PREVIEW === '1') {
    return { posts: INITIAL_FORUM_POSTS, communities: FORUM_COMMUNITIES, helpers: [] }
  }

  const [postResult, communityResult, helperResult] = await Promise.allSettled([
    forumJson<{ posts: ForumPostResponse[] }>('posts?limit=50'),
    forumJson<{ communities: CommunityResponse[] }>('communities'),
    forumJson<{ helpers: ForumHelper[] }>('helpers'),
  ])

  const livePosts = postResult.status === 'fulfilled'
    ? postResult.value.posts.map(mapForumPost)
    : []
  const liveCommunities = communityResult.status === 'fulfilled'
    ? new Map(communityResult.value.communities.map((community) => [community.slug, community]))
    : new Map<string, CommunityResponse>()

  return {
    // Preview discussions are an outage/empty-database fallback only. They are
    // never painted briefly and replaced in the browser by a second feed.
    posts: livePosts.length > 0 ? livePosts : INITIAL_FORUM_POSTS,
    communities: FORUM_COMMUNITIES.map((fallback) => {
      const live = liveCommunities.get(fallback.slug)
      return live ? { ...fallback, ...live, members: live.memberCount, online: 0 } : fallback
    }),
    helpers: helperResult.status === 'fulfilled' ? helperResult.value.helpers : [],
  }
}

export default async function ForumHomePage() {
  const initial = await initialForumData()
  return (
    <ForumClient
      initialPosts={initial.posts}
      initialCommunities={initial.communities}
      initialHelpers={initial.helpers}
    />
  )
}
