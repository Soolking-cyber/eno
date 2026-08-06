import { db } from '@/lib/db'
import { isListingImageUrl } from '@/lib/listing-image'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The REPORTER adds detail/proof to their own open report — reached from the admin's
// "need more detail" notification (/reports/[id]). Mirror of the target-side appeal
// route. Supplements APPEND to Report.detail (timestamped, photo URLs as lines) so the
// moderation card and the admin AI review read them with zero extra plumbing.
const DETAIL_CAP = 6000

// ⚠️ WS6 MIGRATION — auth + rate limit hoisted, in the order they were already in. `auth: 'userId'`
// = the getCurrentProfileId() this replaces; the ownership decision is `report.reporterProfileId !==
// meId`, an id comparison, so no Profile row is needed. NOT `strict` — the original was fail-open.
// `params` arrives already awaited in ctx; the old `await params` sat between the limiter and the
// body parse and had no observable branch, so moving it first changes nothing.
//
// ⚠️ `body:` DELIBERATELY OMITTED — the old code hand-coerces (`String(body.text || '')`,
// `Array.isArray(body.images)`), so a non-object JSON body falls through to 400 `missing_fields`
// today; a zod object schema would answer 400 `bad_request`. Same status, different string.
//
// Branches unchanged: 401 `auth_required` · 429 `rate_limited` · 400 `bad_request` · 400
// `missing_fields` · 404 `not_found` · 403 `forbidden` (lowercase) · 409 `already_resolved` · 200
// {"ok":true}.
//
// ⚠️ FAILURE-PATH WIRE CHANGE, DELIBERATE: the findUnique/update are unguarded, so a DB error was
// Next's default 500 and is now `{"error":"internal_error"}` 500.
export const POST = route(
  { auth: 'userId', rateLimit: { bucket: 'report-supplement', limit: 10, window: '1 h' } },
  async ({ req, userId: meId, params }) => {
  const { id } = params
  let body: { text?: string; images?: unknown }
  try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }

  const text = String(body.text || '').trim().slice(0, 2000)
  const images = Array.isArray(body.images) ? (body.images as unknown[]).filter(isListingImageUrl).slice(0, 6) : []
  if (text.length < 3 && images.length === 0) throw new ApiError('missing_fields', 400)

  const report = await db.report.findUnique({
    where: { id },
    select: { id: true, reporterProfileId: true, status: true, detail: true },
  })
  if (!report) throw new ApiError('not_found', 404)
  // Only the person who filed it can supplement it.
  if (report.reporterProfileId !== meId) throw new ApiError('forbidden', 403)
  // Case already decided — supplements would be unread; tell the reporter plainly.
  if (report.status !== 'open') throw new ApiError('already_resolved', 409)

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const addition =
    `[Update ${stamp}]` +
    (text ? `\n${text}` : '') +
    images.map((u) => `\n📷 ${u}`).join('')
  const detail = ((report.detail ? `${report.detail}\n\n` : '') + addition).slice(0, DETAIL_CAP)

  await db.report.update({ where: { id }, data: { detail } })
  return { ok: true }
  },
)
