// POST /api/admin/schools — moderation for /schools (2026-10-04). Admin only (getAdmin, re-checked here).
// Actions: approve / reject a pending review, publish the school's reply under a review, resolve a report
// or a school complaint, hide / show a school. Every change purges the school's page and the list.
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { revalidatePublicPath } from '@/lib/revalidate-lang'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ⛔ `seenUpdatedAt` IS THE VERSION THE MODERATOR READ (diff review, codex + Opus), on approve AND reject:
// without it, a teacher who edits between the moderator opening the queue and clicking would get text no
// moderator saw published (or rejected with a reason about other text). A mismatch answers 409.
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), reviewId: z.string().max(40), seenUpdatedAt: z.string().datetime() }),
  z.object({ action: z.literal('reject'), reviewId: z.string().max(40), reason: z.string().trim().min(3).max(500), seenUpdatedAt: z.string().datetime() }),
  z.object({ action: z.literal('reply'), reviewId: z.string().max(40), text: z.string().trim().max(2000), seenUpdatedAt: z.string().datetime() }),
  z.object({ action: z.literal('resolve'), reportId: z.string().max(40), status: z.enum(['resolved', 'dismissed']) }),
  z.object({ action: z.literal('school_status'), schoolId: z.string().max(40), status: z.enum(['active', 'hidden']) }),
])

function purge(slug: string) {
  revalidatePublicPath('/schools')
  revalidatePublicPath(`/schools/${slug}`)
}

export const POST = route({ auth: 'admin', body: Body }, async ({ admin, body }) => {
  switch (body.action) {
    case 'approve':
    case 'reject': {
      const r = await db.schoolReview.findUnique({ where: { id: body.reviewId }, select: { id: true, status: true, school: { select: { slug: true } } } })
      if (!r || r.status === 'removed') throw new ApiError('not_found', 404)
      // THE STATE MACHINE: approve only what is waiting; reject (or unpublish) only what is waiting or live.
      const from = body.action === 'approve' ? ['pending'] : ['pending', 'published']
      const done = await db.schoolReview.updateMany({
        where: { id: r.id, status: { in: from }, updatedAt: new Date(body.seenUpdatedAt) },
        data: body.action === 'approve'
          ? { status: 'published', moderatedAt: new Date(), moderatedBy: admin, rejectReason: null }
          : { status: 'rejected', moderatedAt: new Date(), moderatedBy: admin, rejectReason: body.reason },
      })
      if (done.count === 0) {
        if (!from.includes(r.status)) throw new ApiError('invalid_status_transition', 409)
        throw new ApiError('review_changed_reload', 409)
      }
      purge(r.school.slug)
      return { ok: true }
    }
    case 'reply': {
      const r = await db.schoolReview.findUnique({ where: { id: body.reviewId }, select: { id: true, school: { select: { slug: true } } } })
      if (!r) throw new ApiError('not_found', 404)
      // A response only ever sits under the PUBLISHED text it answers (a teacher's edit clears it).
      // …and the version the moderator was looking at: a reply must never land under text it did not answer.
      const done = await db.schoolReview.updateMany({ where: { id: r.id, status: 'published', updatedAt: new Date(body.seenUpdatedAt) }, data: body.text ? { replyText: body.text, replyAt: new Date() } : { replyText: null, replyAt: null } })
      if (done.count === 0) {
        const now = await db.schoolReview.findUnique({ where: { id: r.id }, select: { status: true } })
        throw new ApiError(now?.status === 'published' ? 'review_changed_reload' : 'invalid_status_transition', 409)
      }
      purge(r.school.slug)
      return { ok: true }
    }
    case 'resolve': {
      const rep = await db.schoolReport.findUnique({ where: { id: body.reportId }, select: { id: true } })
      if (!rep) throw new ApiError('not_found', 404)
      // Only an OPEN report: two moderators on stale views must not overwrite each other's decision.
      const done = await db.schoolReport.updateMany({ where: { id: rep.id, status: 'open' }, data: { status: body.status, resolvedBy: admin, resolvedAt: new Date() } })
      if (done.count === 0) throw new ApiError('already_resolved', 409)
      return { ok: true }
    }
    case 'school_status': {
      const s = await db.school.findUnique({ where: { id: body.schoolId }, select: { id: true, slug: true } })
      if (!s) throw new ApiError('not_found', 404)
      await db.school.update({ where: { id: s.id }, data: { status: body.status } })
      purge(s.slug)
      return { ok: true }
    }
  }
})
