import { db } from '@/lib/db'
import { isListingImageUrl } from '@/lib/listing-image'
import { DISPUTE_WINDOW_MS, notifyDispute } from '@/lib/dispute'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The reported party appeals a confirmed report by submitting an explanation + proof images.
// Re-opens the SAME report (status→open) tagged with the appeal so it re-surfaces in the
// moderation queue for review. Only the target can appeal; only once until re-resolved.
//
// ⚠️ WS6 MIGRATION — auth + rate limit hoisted; they were already the first two blocks, in the
// wrapper's own order, so nothing changes place. `auth: 'userId'` = the getCurrentProfileId() this
// replaces (the id is compared against report.targetProfileId; no Profile row is read). NOT `strict`
// — the original was fail-open, and this is the reported party's due-process channel.
//
// ⚠️ `body:` DELIBERATELY OMITTED — the old code hand-coerces (`String(body.reportId || '')`), so a
// non-object JSON body falls through to 400 `missing_fields` today; a zod object schema would answer
// 400 `bad_request` instead. Same status, different string = a silent wire change. Parse stays here.
//
// Branches unchanged: 401 `auth_required` · 429 `rate_limited` · 400 `bad_request` · 400
// `missing_fields` · 404 `not_found` · 403 `forbidden` (lowercase — NOT the wrapper's admin-mode
// `Forbidden`) · 409 `not_decided` · 200 {"ok":true,"already":true} · 200 {"ok":true}.
//
// ⚠️ FAILURE-PATH WIRE CHANGE, DELIBERATE: the update + notifyDispute are unguarded, so a DB error
// was Next's default 500 and is now `{"error":"internal_error"}` 500.
export const POST = route(
  { auth: 'userId', rateLimit: { bucket: 'appeal', limit: 10, window: '1 h' } },
  async ({ req, userId: meId }) => {
  let body: { reportId?: string; note?: string; images?: unknown }
  try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }

  const reportId = String(body.reportId || '').trim()
  const note = String(body.note || '').trim().slice(0, 2000)
  const images = Array.isArray(body.images) ? (body.images as unknown[]).filter(isListingImageUrl).slice(0, 6) : []
  if (!reportId || note.length < 5) throw new ApiError('missing_fields', 400)

  const report = await db.report.findUnique({ where: { id: reportId }, select: { id: true, targetProfileId: true, reporterProfileId: true, status: true, appealedAt: true } })
  if (!report) throw new ApiError('not_found', 404)
  // Only the reported account can appeal its own case.
  if (report.targetProfileId !== meId) throw new ApiError('forbidden', 403)
  // Already appealed and awaiting review → accept idempotently (no spam re-open).
  if (report.status === 'open' && report.appealedAt) return { ok: true, already: true }
  // An appeal only makes sense against a DECIDED case. Blocking it while the case is
  // still open stops a respondent from unilaterally dragging a case out of review and
  // resetting the 72h evidence window (they use the dispute room to respond instead).
  if (report.status === 'open') throw new ApiError('not_decided', 409)

  await db.report.update({
    where: { id: reportId },
    data: {
      status: 'open', appealNote: note, appealImages: images.length ? JSON.stringify(images) : null,
      appealedAt: new Date(), resolvedBy: null, resolvedAt: null, decisionNote: null,
      // Re-opened case → fresh evidence window so BOTH sides can respond to the
      // appeal in the dispute room (the appeal itself lands in the timeline).
      evidenceUntil: new Date(Date.now() + DISPUTE_WINDOW_MS),
      lastMessageAt: new Date(),
    },
  })
  // The reporter should know the case re-opened (their upheld outcome is on hold).
  if (report.reporterProfileId) await notifyDispute(report.reporterProfileId, reportId, 'new_message')
  return { ok: true }
  },
)
