import { rateLimit } from '@/lib/ratelimit'
import { IMG_ALLOWED, IMG_MAX_BYTES, storeEvidenceImage } from '@/lib/core/media'
import { DISPUTE_IMAGES_MAX, loadDisputeForParty, partyCanPost, partyHasSubmitted, signEvidenceUrls } from '@/lib/dispute'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Evidence upload for a dispute case — party-gated + window-gated, stored in the
// PRIVATE evidence bucket (receipts/screenshots carry PII; the public listings
// bucket is wrong for this). Same sharp pipeline as listings (EXIF/GPS stripped,
// decompression-bomb guarded) but no watermark and a higher-detail edge cap.
// Returns storage PATHS (to attach to a message) + short-lived preview URLs.
//
// ⚠️ WS6 MIGRATION — THE AUTH PREAMBLE ONLY, AND THE RATE LIMIT DELIBERATELY STAYS IN THE HANDLER.
// route() runs `rateLimit:` BEFORE the handler, but here it ran AFTER the party/window/one-shot
// gates. Hoisting it would flip the answer for a caller who trips both — a non-party burning the
// bucket currently gets 404 `not_found` and would start getting 429 `rate_limited`, which is both a
// wire change and a case-id oracle (a 429 proves the request got past the party check). So it stays
// exactly where it was, strict:true intact, raised as ApiError so the code and status are identical.
//
// ⚠️ NO `body:` — the payload is multipart/form-data, not JSON. route()'s body option calls
// req.json(); giving it a schema would 400 every real upload.
//
// `auth: 'userId'` = the getCurrentProfileId() this replaces; the party check needs an id, not a row.
// Branches unchanged: 401 `auth_required` · 404 `not_found` · 409 `window_closed` · 409
// `already_submitted` · 429 `rate_limited` · 400 `invalid_body` · 400 `empty` · 200 {paths,previews,failed}.
//
// ⚠️ FAILURE-PATH WIRE CHANGE, DELIBERATE: storeEvidenceImage()/signEvidenceUrls() were unguarded, so
// a throw was Next's default 500 and is now `{"error":"internal_error"}` 500.
export const POST = route({ auth: 'userId' }, async ({ req, userId: meId, params }) => {
  const { id } = params

  const loaded = await loadDisputeForParty(id, meId)
  if (!loaded) throw new ApiError('not_found', 404)
  if (!partyCanPost(loaded.report)) throw new ApiError('window_closed', 409)
  // One-shot: no more uploads once this party has submitted their single statement.
  if (await partyHasSubmitted(loaded.report.id, meId)) throw new ApiError('already_submitted', 409)

  // Storage-abuse vector → strict (Redis down = denied), like the other paid routes.
  const rl = await rateLimit('dispute-evidence', meId, 60, '1 h', { strict: true })
  if (!rl.success) throw new ApiError('rate_limited', 429)

  let form: FormData
  try { form = await req.formData() } catch { throw new ApiError('invalid_body', 400) }
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) throw new ApiError('empty', 400)

  const paths: string[] = []
  let failed = 0
  for (const file of files.slice(0, DISPUTE_IMAGES_MAX)) {
    if (!IMG_ALLOWED.has(file.type) || file.size === 0 || file.size > IMG_MAX_BYTES) { failed++; continue }
    const path = await storeEvidenceImage(Buffer.from(await file.arrayBuffer()), loaded.report.id)
    if (path) paths.push(path)
    else failed++
  }

  return { paths, previews: await signEvidenceUrls(paths), failed }
})
