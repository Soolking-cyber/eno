import { db } from '@/lib/db'
import { getForumAuth } from '@/lib/forum/auth'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'GET, DELETE, OPTIONS')
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'GET, DELETE, OPTIONS')
  const itinerary = await db.itinerary.findFirst({
    where: { id, profileId: auth.profile.id, status: { not: 'archived' } },
    include: { dayPlans: { orderBy: { dayNumber: 'asc' } }, stays: { orderBy: { position: 'asc' } } },
  })
  if (!itinerary) return forumJson(request, { error: 'not_found' }, { status: 404 }, 'GET, DELETE, OPTIONS')
  return forumJson(request, {
    itinerary: { ...itinerary, interests: JSON.parse(itinerary.interests) as string[] },
  }, undefined, 'GET, DELETE, OPTIONS')
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, 'GET, DELETE, OPTIONS')
  const { id } = await params
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'GET, DELETE, OPTIONS')
  const updated = await db.itinerary.updateMany({
    where: { id, profileId: auth.profile.id, status: { not: 'archived' } },
    data: { status: 'archived' },
  })
  if (!updated.count) return forumJson(request, { error: 'not_found' }, { status: 404 }, 'GET, DELETE, OPTIONS')
  return forumJson(request, { ok: true }, undefined, 'GET, DELETE, OPTIONS')
}

