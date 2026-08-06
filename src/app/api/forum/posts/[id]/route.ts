import { z } from 'zod'
import { db } from '@/lib/db'
import { canParticipate, getForumAuth } from '@/lib/forum/auth'
import { withheldHelpTopicSlugs } from '@/lib/help-center'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import {
  forumAuthorSelect,
  serializeForumComment,
  serializeForumPost,
  type ForumCommentDto,
} from '@/lib/forum/serialize'
import { rateLimit } from '@/lib/ratelimit'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const editSchema = z.object({
  title: z.string().trim().min(8).max(140),
  body: z.string().trim().min(20).max(30_000),
})

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'GET, PATCH, DELETE, OPTIONS')
}

function commentTree(rows: ReturnType<typeof serializeForumComment>[]): ForumCommentDto[] {
  const byId = new Map(rows.map((row) => [row.id, { ...row, replies: [] as ForumCommentDto[] }]))
  const roots: ForumCommentDto[] = []
  for (const row of byId.values()) {
    const parent = row.parentId ? byId.get(row.parentId) : null
    if (parent) parent.replies.push(row)
    else roots.push(row)
  }
  return roots
}

// ⚠️ WS6 — NOT MIGRATED (all three method exports; see PATCH and DELETE for their own blockers).
// GET branches: 404 not_found (missing, unpublished, or edition-withheld) · 404 not_found (viewer
// blocked either way) · 200 {post,comments} · 503 forum_schema_not_ready (P2021). Three blockers:
//   · AUTH IS OPTIONAL AND FEEDS THE QUERY. A guest gets a full 200; `auth?.profile.id` (or the
//     all-zeroes UUID) selects the viewer's own vote and bookmark rows and drives the block check.
//     `auth: 'profile'` would 401 every signed-out reader of a help article; 'public' gives the
//     handler nothing, so it resolves the caller itself either way.
//   · CORS ON EVERY RESPONSE: forumJson sets Access-Control-Allow-Methods:
//     'GET, PATCH, DELETE, OPTIONS', -Allow-Headers and -Max-Age on all four returns (+ -Allow-Origin
//     and Vary: Origin for an allowlisted Origin). route()/apiFail carry no headers.
//   · AUTH IS getForumAuth() (bearer or cookie; its bearer path fails closed on absent
//     Supabase env — NOT a cookies-only-wrapper issue, see forum/posts/[id]/route.ts:138).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getForumAuth(request)
  const viewerId = auth?.profile.id || '00000000-0000-0000-0000-000000000000'

  try {
    const post = await db.forumPost.findFirst({
      /**
       * ⚠️ EDITION-SCOPED, BECAUSE 404-ING THE PAGE IS NOT WITHHOLDING THE CONTENT.
       *
       * `/help/[id]` refuses services-only help topics on the marketplace edition, and this route
       * served the identical row to anyone who asked for it by id — same database, no community
       * filter, no edition test, and it IS compiled into the marketplace build. So eno.vn went on
       * serving the e-visa help article as JSON while its own page said 404: the licensed
       * marketplace publishing the content it is not licensed to offer, to exactly the automated
       * clients that do not render pages. CORS binds browsers; it does nothing to a crawler or a
       * curl. Found by a verification pass reading this file rather than curling it — line 74
       * increments viewCount, so probing would have written to production.
       *
       * `withheldHelpTopicSlugs()` is empty on the services edition, so eno.forum is unchanged.
       */
      where: {
        id,
        status: { in: ['published', 'locked'] },
        ...(withheldHelpTopicSlugs().length ? { communitySlug: { notIn: withheldHelpTopicSlugs() } } : {}),
      },
      include: {
        author: { select: forumAuthorSelect },
        media: { orderBy: { position: 'asc' } },
        votes: { where: { profileId: viewerId }, select: { value: true } },
        bookmarks: { where: { profileId: viewerId }, select: { postId: true } },
        comments: {
          where: { status: { in: ['published', 'removed'] } },
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: forumAuthorSelect },
            votes: { where: { profileId: viewerId }, select: { value: true } },
          },
        },
      },
    })
    if (!post) return forumJson(request, { error: 'not_found' }, { status: 404 }, 'GET, PATCH, DELETE, OPTIONS')

    if (auth && post.authorProfileId) {
      const blocked = await db.forumUserBlock.findFirst({
        where: {
          OR: [
            { blockerProfileId: auth.profile.id, blockedProfileId: post.authorProfileId },
            { blockerProfileId: post.authorProfileId, blockedProfileId: auth.profile.id },
          ],
        },
        select: { blockerProfileId: true },
      })
      if (blocked) return forumJson(request, { error: 'not_found' }, { status: 404 }, 'GET, PATCH, DELETE, OPTIONS')
    }

    void db.forumPost.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch((e) => logError(e, { op: 'forumPost.incrementViews' }))
    const comments = post.comments.map((comment) => serializeForumComment({
      ...comment,
      body: comment.status === 'removed' ? '[removed]' : comment.body,
      author: comment.status === 'removed' ? null : comment.author,
      authorName: comment.status === 'removed' ? null : comment.authorName,
      authorRole: comment.status === 'removed' ? null : comment.authorRole,
    }))
    return forumJson(request, {
      post: serializeForumPost(post),
      comments: commentTree(comments),
    }, undefined, 'GET, PATCH, DELETE, OPTIONS')
  } catch (error) {
    if ((error as { code?: string }).code === 'P2021') {
      return forumJson(request, { error: 'forum_schema_not_ready' }, { status: 503 }, 'GET, PATCH, DELETE, OPTIONS')
    }
    throw error
  }
}

// ⚠️ WS6 — NOT MIGRATED. Branches: 403 origin_not_allowed · 401 auth_required · 403
// account_restricted · 429 rate_limited · 400 invalid_post(+issues) · 404 not_found · 403 forbidden
// · 200 {ok:true}. Four blockers:
//   · THE ERROR ENVELOPE IS NOT THE WRAPPER'S — a bad body answers
//     `{"error":"invalid_post","issues":[…]}`, and apiFail() can only emit `{"error":"<code>"}`.
//   · THE ORIGIN GUARD RUNS BEFORE AUTH, and the limiter runs after `canParticipate()` — under the
//     wrapper's fixed auth → rateLimit order a suspended author over `forum-post-edit` would flip
//     from 403 account_restricted to 429.
//   · CORS ON EVERY RESPONSE. ⚠️ NOTE THE EXACT VALUE: these eight returns call forumJson with NO
//     methods argument, so they carry the DEFAULT `Access-Control-Allow-Methods: GET, POST, PATCH,
//     DELETE, OPTIONS` — which differs from the 'GET, PATCH, DELETE, OPTIONS' the OPTIONS preflight
//     and the GET above send. That inconsistency is live on the wire; preserve it rather than
//     tidying it, and do not let a future migration normalise the two.
//   · AUTH IS getForumAuth(), whose bearer path builds its OWN Supabase client and fails closed
//     when NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY are absent (src/lib/forum/auth.ts:31-33).
//     ⚠️ THE DIFFERENCE IS NOT BEARER-VS-COOKIE. `getCurrentProfile()` passes `bearerToken()` to
//     Supabase too (src/lib/admin.ts:78, helper at :138), so "the wrapper only reads cookies" —
//     asserted in an earlier draft of this comment and in four sibling files — is FALSE, and a
//     reviewer had to read admin.ts to catch it. The fail-closed env branch is the real gap.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 })
  const { id } = await params
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 })
  if (!canParticipate(auth.profile)) return forumJson(request, { error: 'account_restricted' }, { status: 403 })
  const limit = await rateLimit('forum-post-edit', auth.profile.id, 30, '1 h')
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 })
  const parsed = editSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return forumJson(request, { error: 'invalid_post', issues: parsed.error.issues }, { status: 400 })

  const existing = await db.forumPost.findUnique({ where: { id }, select: { authorProfileId: true, title: true, body: true, status: true } })
  if (!existing || existing.status === 'removed') return forumJson(request, { error: 'not_found' }, { status: 404 })
  if (existing.authorProfileId !== auth.profile.id) return forumJson(request, { error: 'forbidden' }, { status: 403 })

  await db.$transaction([
    db.forumPostRevision.create({ data: { postId: id, editorProfileId: auth.profile.id, title: existing.title, body: existing.body } }),
    db.forumPost.update({ where: { id }, data: { ...parsed.data, editedAt: new Date() } }),
  ])
  return forumJson(request, { ok: true })
}

// ⚠️ WS6 — NOT MIGRATED. Branches: 403 origin_not_allowed · 401 auth_required · 404 not_found · 403
// forbidden · 200 {ok:true}. Three blockers:
//   · THE ORIGIN GUARD RUNS BEFORE AUTH (403 origin_not_allowed to a guest, where route() would
//     resolve the caller first and answer 401 auth_required).
//   · CORS ON EVERY RESPONSE, and as with PATCH above these returns pass NO methods argument, so
//     they carry the DEFAULT `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`
//     rather than the preflight's 'GET, PATCH, DELETE, OPTIONS'. route() carries no headers at all.
//   · AUTH IS getForumAuth() (bearer or cookie; its bearer path fails closed on absent
//     Supabase env — NOT a cookies-only-wrapper issue, see forum/posts/[id]/route.ts:138), and `auth.profile.id` is then the WHERE clause of
//     the atomic claim, not just a gate.
//
// ⚠️ A CORRECTION WORTH KEEPING, BECAUSE IT INVERTS WHO CALLS THIS FILE. An earlier draft said this
// DELETE is "the one export the forum browser calls with `direct: true`
// (apps/forum/src/components/forum/use-forum-feed.ts:249)". It is not. `direct: true` does not mean
// "skip the proxy and go cross-origin to eno.vn" — `apps/forum/src/lib/api.ts:32` is
// `fetch(direct ? path : '/api/backend' + path)` with a RELATIVE path, so `direct` resolves against
// the FORUM'S OWN origin, and `apps/forum/src/app/api/forum/posts/[id]/route.ts:36` is a
// forum-local DELETE sitting at exactly that path (with its own `forum-post-delete` limiter, which
// this file does not have — that is the discriminator). Every other forum-browser call goes through
// `/api/backend`, which forwards only accept/authorization/content-type and therefore sends no
// Origin at all. So there is NO browser cross-origin caller of this route anywhere in the tree.
// The skip is unaffected and rests on the bytes above: `withForumCors` sets three headers on every
// response (src/lib/forum/cors.ts:59-61) and route()/apiFail emit none. But the "visible only in a
// real browser at the second origin" argument was fiction, and a future migrator would have wasted
// a day looking for that browser.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 })
  const { id } = await params
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 })
  const existing = await db.forumPost.findUnique({ where: { id }, select: { authorProfileId: true, communitySlug: true, status: true } })
  if (!existing || existing.status === 'removed') return forumJson(request, { error: 'not_found' }, { status: 404 })
  if (existing.authorProfileId !== auth.profile.id) return forumJson(request, { error: 'forbidden' }, { status: 403 })

  // Claim atomically so two concurrent DELETEs can't both decrement the counters.
  const claimed = await db.forumPost.updateMany({
    where: { id, authorProfileId: auth.profile.id, status: { not: 'removed' } },
    data: { status: 'removed', title: '[removed]', body: '[removed]', editedAt: new Date() },
  })
  if (claimed.count === 1) {
    await db.$transaction([
      db.forumCommunity.update({ where: { slug: existing.communitySlug }, data: { postCount: { decrement: 1 } } }),
      db.forumProfile.update({ where: { profileId: auth.profile.id }, data: { postCount: { decrement: 1 } } }),
    ])
  }
  return forumJson(request, { ok: true })
}

