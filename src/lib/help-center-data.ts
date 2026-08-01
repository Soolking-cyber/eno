import 'server-only'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { HELP_TOPIC_SLUGS } from '@/lib/help-center'
import { forumAuthorSelect, serializeForumPost } from '@/lib/forum/serialize'

// Server-side reads for the Help Center at /help.
//
// WHY Prisma and not a fetch to /api/forum/*: eno.vn and eno.forum share ONE database,
// and Prisma lives here. /dashboard/forum already reads the Forum* tables directly for
// exactly this reason (src/app/dashboard/forum/load-activity.ts). Going out over HTTP to
// our own API would add a hop, lose the request's cookie identity, and buy nothing.
//
// The payload shape is produced by the SAME serializer the API uses
// (src/lib/forum/serialize.ts), so a help card and a forum card are fed identical
// objects and the two renderers cannot drift in what they receive.

export type HelpPost = ReturnType<typeof serializeForumPost>

export type HelpReview = {
  id: string
  sellerId: string
  sellerName: string
  sellerAvatarUrl: string | null
  sellerAvatarColor: string
  sellerVerified: boolean
  rating: number
  text: string
  author: string
  verifiedBuyer: boolean
  createdAt: string
}

export type HelpCenterData = {
  answers: HelpPost[]
  questions: HelpPost[]
  reviews: HelpReview[]
}

// One viewer-scoped select, reused by both post queries. `votes`/`bookmarks` are filtered
// to the viewer so serializeForumPost can report viewerVote/saved; a signed-out reader
// gets an impossible id rather than a branch, which keeps the query shape constant.
function postSelect(viewerId: string) {
  return {
    id: true,
    communitySlug: true,
    kind: true,
    flair: true,
    flairVi: true,
    title: true,
    body: true,
    authorName: true,
    authorRole: true,
    author: { select: forumAuthorSelect },
    location: true,
    locationLabel: true,
    pinned: true,
    official: true,
    score: true,
    commentCount: true,
    viewCount: true,
    createdAt: true,
    updatedAt: true,
    media: {
      select: { storagePath: true, mimeType: true, width: true, height: true, altText: true, position: true },
      orderBy: { position: 'asc' },
    },
    votes: { where: { profileId: viewerId }, select: { value: true } },
    bookmarks: { where: { profileId: viewerId }, select: { postId: true } },
  } as const
}

export async function loadHelpCenter(): Promise<HelpCenterData> {
  const profile = await getCurrentProfile().catch(() => null)
  // A UUID column cannot be compared against an arbitrary string, so signed-out reads
  // use the nil UUID — a value no Profile can hold — rather than skipping the relation.
  const viewerId = profile?.id ?? '00000000-0000-0000-0000-000000000000'
  const select = postSelect(viewerId)

  const [answers, questions, reviews] = await Promise.all([
    // Curated answers: the eno-team posts seeded by scripts/sync-help-center.ts.
    // Ordered by SCORE first — upvotes are meant to reorder the FAQ, which is the
    // owner's "people can upvote info they liked". createdAt breaks ties so a fresh
    // seed with no votes yet still reads in its curated order.
    db.forumPost.findMany({
      where: { communitySlug: { in: HELP_TOPIC_SLUGS }, status: 'published', official: true },
      orderBy: [{ pinned: 'desc' }, { score: 'desc' }, { createdAt: 'asc' }],
      select,
      take: 120,
    }),
    // Community questions asked inside the help topics — the Reddit half of the page.
    db.forumPost.findMany({
      where: { communitySlug: { in: HELP_TOPIC_SLUGS }, status: 'published', official: false },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      select,
      take: 30,
    }),
    // Business reviews are READ-ONLY here (owner decision 2026-07-21): they surface as
    // cards that deep-link to the canonical storefront, and are NOT syndicated into
    // ForumPost rows. Review has no status/moderation column and Report cannot target a
    // Review, so a copy on the forum could outlive a removal on the storefront.
    db.review.findMany({
      where: { text: { not: '' } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        sellerId: true,
        rating: true,
        text: true,
        author: true,
        authorProfileId: true,
        conversationId: true,
        createdAt: true,
        seller: { select: { name: true, avatarUrl: true, avatarColor: true, verified: true, verifiedSeller: true } },
      },
    }),
  ])

  return {
    answers: answers.map(serializeForumPost),
    questions: questions.map(serializeForumPost),
    reviews: reviews.map((review) => ({
      id: review.id,
      sellerId: review.sellerId,
      sellerName: review.seller.name,
      sellerAvatarUrl: review.seller.avatarUrl,
      sellerAvatarColor: review.seller.avatarColor,
      sellerVerified: review.seller.verifiedSeller || review.seller.verified,
      rating: review.rating,
      text: review.text,
      author: review.author,
      // Same provenance rule the storefront uses: a review born from a real
      // conversation is a verified purchase; seeded/legacy rows carry no badge.
      verifiedBuyer: Boolean(review.authorProfileId && review.conversationId),
      createdAt: review.createdAt.toISOString(),
    })),
  }
}

/**
 * One help answer + its comment tree, for /help/[id]. Returns null when the id is not a
 * published post in a help topic — so a normal forum thread id 404s here rather than
 * rendering inside the Help Center chrome.
 *
 * ⚠️ AND `HELP_TOPIC_SLUGS` IS EDITION-SCOPED, WHICH MAKES THIS FUNCTION THE 404 ITSELF.
 * A topic declared services-only in src/lib/help-center.ts is absent from that list on a
 * MARKETPLACE build, so its articles do not match, this returns null, and
 * src/app/help/[id]/page.tsx calls `notFound()`. That is a genuine 404 — no redirect, no
 * empty shell, no soft-404 that Google keeps in the index.
 *
 * This was live in production: `/help/help-vietnam-evisa-entry-basics` returned 200 on
 * eno.vn (a licensed sàn TMĐT that may not surface e-visa services) and was in its
 * sitemap, on 2026-08-01. The article is a database ROW, so the `.svc.` route exclusion
 * and the `resolveAlias` stubs — this repo's two usual instruments — could not reach it.
 * The topic declaration is the only lever the code owns.
 */
export async function loadHelpThread(id: string) {
  const profile = await getCurrentProfile().catch(() => null)
  const viewerId = profile?.id ?? '00000000-0000-0000-0000-000000000000'

  const post = await db.forumPost.findFirst({
    where: { id, status: 'published', communitySlug: { in: HELP_TOPIC_SLUGS } },
    select: postSelect(viewerId),
  })
  if (!post) return null

  const comments = await db.forumComment.findMany({
    where: { postId: id, status: 'published' },
    orderBy: [{ helpful: 'desc' }, { score: 'desc' }, { createdAt: 'asc' }],
    take: 200,
    select: {
      id: true,
      postId: true,
      parentId: true,
      body: true,
      authorName: true,
      authorRole: true,
      author: { select: forumAuthorSelect },
      helpful: true,
      score: true,
      replyCount: true,
      createdAt: true,
      updatedAt: true,
      votes: { where: { profileId: viewerId }, select: { value: true } },
    },
  })

  return { post: serializeForumPost(post), comments }
}
