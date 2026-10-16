import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { appendAudit } from '@/lib/compliance/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * "THIS PHOTO IS FINE" — the human route against a wrong automated refusal of a teacher's profile photo (owner,
 * 2026-10-16; plan review: a person must be able to overturn it). Admin › Catalogue › Teacher photos. Writes the DURABLE
 * record — an audit row `teacher.photo.override` {key}, subject the teacher's account, actor the admin — which the save,
 * the re-check and the edit form all read before any cached verdict (photo-verdict.ts). FOR THIS ACCOUNT ONLY: never the
 * shared verdict cache, which another account naming the same photo would pass on (gate review, 2026-10-16).
 * Only for an object key this account was refused or asked about: an admin never approves a photo out of thin air.
 */
export const POST = route({ auth: 'admin' }, async ({ req, admin }) => {
  const body = (await req.json().catch(() => null)) as { profileId?: unknown; key?: unknown } | null
  const profileId = typeof body?.profileId === 'string' ? body.profileId : ''
  const key = typeof body?.key === 'string' ? body.key : ''
  if (!/^[0-9a-f-]{36}$/.test(profileId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(key)) throw new ApiError('bad_request', 400)
  const seen = await db.complianceAudit.findFirst({
    where: { action: { in: ['teacher.photo.refused', 'teacher.photo.ask'] }, subjectType: 'profile', subjectId: profileId, detail: { path: ['key'], equals: key } },
    select: { id: true },
  })
  if (!seen) throw new ApiError('not_found', 404)
  await db.$transaction(async (tx) => {
    await appendAudit(tx, { actorType: 'admin', actorId: admin, action: 'teacher.photo.override', subjectType: 'profile', subjectId: profileId, detail: { key } })
  })
  return { ok: true }
})
