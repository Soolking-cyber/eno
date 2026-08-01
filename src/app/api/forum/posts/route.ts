import { z } from 'zod'
import { db } from '@/lib/db'
import { canParticipate, getForumAuth } from '@/lib/forum/auth'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { forumAuthorSelect, serializeForumPost } from '@/lib/forum/serialize'
import { rateLimit } from '@/lib/ratelimit'
import { withheldHelpTopicSlugs } from '@/lib/help-center'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const postKinds = ['guide', 'question', 'experience', 'event', 'discussion'] as const
const locations = ['all', 'hcmc', 'hanoi', 'danang'] as const

const createPostSchema = z.object({
  community: z.string().trim().min(2).max(80),
  kind: z.enum(postKinds).default('discussion'),
  title: z.string().trim().min(8).max(140),
  body: z.string().trim().min(20).max(30_000),
  location: z.enum(locations).default('all'),
  locationLabel: z.string().trim().max(100).nullable().optional(),
  media: z.array(z.object({
    storagePath: z.string().trim().min(3).max(500),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    width: z.number().int().positive().max(20_000).nullable().optional(),
    height: z.number().int().positive().max(20_000).nullable().optional(),
    altText: z.string().trim().max(300).nullable().optional(),
  })).max(8).default([]),
})

const flairByKind = {
  guide: ['Community guide', 'Hướng dẫn cộng đồng'],
  question: ['Need advice', 'Cần tư vấn'],
  experience: ['Firsthand experience', 'Kinh nghiệm thực tế'],
  event: ['Community event', 'Sự kiện cộng đồng'],
  discussion: ['Community discussion', 'Thảo luận cộng đồng'],
} as const

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'GET, POST, OPTIONS')
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const community = url.searchParams.get('community')?.trim() || null
  const location = url.searchParams.get('location')?.trim() || 'all'
  const query = url.searchParams.get('q')?.trim().slice(0, 100) || null
  const sort = url.searchParams.get('sort') || 'best'
  const savedOnly = url.searchParams.get('saved') === 'true'
  const take = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 50)
  // Keyset pagination: `cursor` is the id of the last post of the previous page.
  // Prisma's cursor translates it into a row-value comparison over THIS request's
  // orderBy columns, so the same opaque id works for every sort. Responses without
  // a cursor are byte-compatible with the pre-pagination shape plus `nextCursor`.
  const cursor = url.searchParams.get('cursor')?.trim().slice(0, 64) || null
  const auth = await getForumAuth(request)
  if (savedOnly && !auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'GET, POST, OPTIONS')

  try {
    const blockedIds = auth
      ? await db.forumUserBlock.findMany({
          where: { OR: [{ blockerProfileId: auth.profile.id }, { blockedProfileId: auth.profile.id }] },
          select: { blockerProfileId: true, blockedProfileId: true },
        }).then((rows) => rows.map((row) => row.blockerProfileId === auth.profile.id ? row.blockedProfileId : row.blockerProfileId))
      : []

    const posts = await db.forumPost.findMany({
      where: {
        status: 'published',
        ...(community ? { communitySlug: community } : {}),
        // ⚠️ Same withholding as the by-id route beside this one, and needed for the same reason:
        // `community` is caller-supplied, so asking for a services-only help topic by name would
        // otherwise list its articles straight out of eno.vn. Applied AFTER the caller's filter so
        // it cannot be overridden by it — `communitySlug` equality plus `notIn` both apply, and the
        // deny wins. Empty (and therefore absent) on the services edition.
        ...(withheldHelpTopicSlugs().length ? { AND: [{ communitySlug: { notIn: withheldHelpTopicSlugs() } }] } : {}),
        ...(location !== 'all' ? { location: { in: ['all', location] } } : {}),
        ...(blockedIds.length ? { authorProfileId: { notIn: blockedIds } } : {}),
        ...(savedOnly && auth ? { bookmarks: { some: { profileId: auth.profile.id } } } : {}),
        ...(query ? {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { body: { contains: query, mode: 'insensitive' } },
            { authorName: { contains: query, mode: 'insensitive' } },
          ],
        } : {}),
      },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      // `id` closes each sort's keyset: without a unique tiebreaker, rows that tie
      // on (pinned, score/hotScore, createdAt) could repeat or vanish across pages.
      orderBy: sort === 'latest'
        ? [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
        : sort === 'top'
          ? [{ pinned: 'desc' }, { score: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
          : [{ pinned: 'desc' }, { hotScore: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: {
        author: { select: forumAuthorSelect },
        media: { orderBy: { position: 'asc' } },
        votes: { where: { profileId: auth?.profile.id || '00000000-0000-0000-0000-000000000000' }, select: { value: true } },
        bookmarks: { where: { profileId: auth?.profile.id || '00000000-0000-0000-0000-000000000000' }, select: { postId: true } },
      },
    })

    const nextCursor = posts.length === take ? posts[posts.length - 1].id : null
    return forumJson(request, { posts: posts.map(serializeForumPost), nextCursor }, undefined, 'GET, POST, OPTIONS')
  } catch (error) {
    if ((error as { code?: string }).code === 'P2021') {
      return forumJson(request, { error: 'forum_schema_not_ready' }, { status: 503 }, 'GET, POST, OPTIONS')
    }
    // P2025: the cursor post was deleted between pages — the page simply ends.
    if (cursor && (error as { code?: string }).code === 'P2025') {
      return forumJson(request, { posts: [], nextCursor: null }, undefined, 'GET, POST, OPTIONS')
    }
    throw error
  }
}

export async function POST(request: Request) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, 'GET, POST, OPTIONS')
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'GET, POST, OPTIONS')
  if (!canParticipate(auth.profile)) return forumJson(request, { error: 'account_restricted' }, { status: 403 }, 'GET, POST, OPTIONS')

  const limit = await rateLimit('forum-post-create', auth.profile.id, 12, '1 h')
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 }, 'GET, POST, OPTIONS')

  const parsed = createPostSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return forumJson(request, { error: 'invalid_post', issues: parsed.error.issues }, { status: 400 }, 'GET, POST, OPTIONS')
  }

  const input = parsed.data
  if (input.media.some((item) => !item.storagePath.startsWith(`${auth.profile.id}/`))) {
    return forumJson(request, { error: 'invalid_media_path' }, { status: 400 }, 'GET, POST, OPTIONS')
  }

  const community = await db.forumCommunity.findUnique({ where: { slug: input.community }, select: { slug: true, status: true } })
  if (!community || community.status !== 'active') {
    return forumJson(request, { error: 'community_not_found' }, { status: 404 }, 'GET, POST, OPTIONS')
  }

  const [flair, flairVi] = flairByKind[input.kind]
  const postId = await db.$transaction(async (tx) => {
    const membership = await tx.forumCommunityMember.createMany({
      data: [{ communitySlug: input.community, profileId: auth.profile.id }],
      skipDuplicates: true,
    })
    if (membership.count) {
      await tx.forumCommunity.update({ where: { slug: input.community }, data: { memberCount: { increment: 1 } } })
    }

    const post = await tx.forumPost.create({
      data: {
        communitySlug: input.community,
        authorProfileId: auth.profile.id,
        authorName: auth.profile.displayName,
        kind: input.kind,
        flair,
        flairVi,
        title: input.title,
        body: input.body,
        location: input.location,
        locationLabel: input.locationLabel || null,
        score: 1,
        hotScore: 1,
        media: {
          create: input.media.map((item, position) => ({ ...item, position })),
        },
        votes: { create: { profileId: auth.profile.id, value: 1 } },
        subscriptions: { create: { profileId: auth.profile.id } },
      },
      select: { id: true },
    })
    await Promise.all([
      tx.forumCommunity.update({ where: { slug: input.community }, data: { postCount: { increment: 1 } } }),
      tx.forumProfile.upsert({
        where: { profileId: auth.profile.id },
        create: { profileId: auth.profile.id, postCount: 1 },
        update: { postCount: { increment: 1 }, lastSeenAt: new Date() },
      }),
    ])
    return post.id
  })

  const created = await db.forumPost.findUniqueOrThrow({
    where: { id: postId },
    include: {
      author: { select: forumAuthorSelect },
      media: { orderBy: { position: 'asc' } },
      votes: { where: { profileId: auth.profile.id }, select: { value: true } },
      bookmarks: { where: { profileId: auth.profile.id }, select: { postId: true } },
    },
  })
  return forumJson(request, { post: serializeForumPost(created) }, { status: 201 }, 'GET, POST, OPTIONS')
}
