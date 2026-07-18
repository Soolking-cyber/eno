import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { rateLimit } from '@/lib/ratelimit'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getVisaUser as getForumUser } from '@/lib/visa/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const METHODS = 'DELETE, OPTIONS'
const REMOVED_TITLE = '[removed]'
// The shared ForumPost constraint requires a body of at least 20 characters.
// The former marketplace marker (`[removed]`) was too short and rolled back
// every delete transaction.
const REMOVED_BODY = 'This post was removed.'

export function OPTIONS(request: Request) {
  return forumPreflight(request, METHODS)
}

async function refreshPostCounts(communitySlug: string, profileId: string) {
  const db = getSupabaseAdmin()
  const [communityPosts, profilePosts] = await Promise.all([
    db.from('ForumPost').select('id', { count: 'exact', head: true }).eq('communitySlug', communitySlug).neq('status', 'removed'),
    db.from('ForumPost').select('id', { count: 'exact', head: true }).eq('authorProfileId', profileId).neq('status', 'removed'),
  ])
  await Promise.all([
    communityPosts.error || communityPosts.count === null
      ? Promise.resolve()
      : db.from('ForumCommunity').update({ postCount: communityPosts.count }).eq('slug', communitySlug),
    profilePosts.error || profilePosts.count === null
      ? Promise.resolve()
      : db.from('ForumProfile').update({ postCount: profilePosts.count }).eq('profileId', profileId),
  ])
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, METHODS)
  const user = await getForumUser(request)
  if (!user) return forumJson(request, { error: 'auth_required' }, { status: 401 }, METHODS)
  const limit = await rateLimit('forum-post-delete', user.id, 30, '1 h')
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 }, METHODS)

  try {
    const { id } = await params
    const db = getSupabaseAdmin()
    const { data: post, error: readError } = await db
      .from('ForumPost')
      .select('id,authorProfileId,communitySlug,status')
      .eq('id', id)
      .maybeSingle()
    if (readError) throw readError
    if (!post || post.status === 'removed') return forumJson(request, { error: 'not_found' }, { status: 404 }, METHODS)
    if (post.authorProfileId !== user.id) return forumJson(request, { error: 'forbidden' }, { status: 403 }, METHODS)

    const { data: removed, error: updateError } = await db
      .from('ForumPost')
      .update({ status: 'removed', title: REMOVED_TITLE, body: REMOVED_BODY, editedAt: new Date().toISOString() })
      .eq('id', id)
      .eq('authorProfileId', user.id)
      .neq('status', 'removed')
      .select('id')
      .maybeSingle()
    if (updateError) throw updateError
    if (!removed) return forumJson(request, { error: 'not_found' }, { status: 404 }, METHODS)

    await refreshPostCounts(post.communitySlug, user.id)
    return forumJson(request, { ok: true }, undefined, METHODS)
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === '42P01' || code === 'PGRST205') return forumJson(request, { error: 'forum_schema_not_ready' }, { status: 503 }, METHODS)
    if ((error as Error).message === 'supabase_admin_not_configured') return forumJson(request, { error: 'forum_delete_not_configured' }, { status: 503 }, METHODS)
    return forumJson(request, { error: 'post_delete_failed' }, { status: 500 }, METHODS)
  }
}
