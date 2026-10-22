import { kv, rateLimit } from '@/lib/ratelimit'
import { IMG_ALLOWED, IMG_MAX_BYTES, storeEvidenceImage } from '@/lib/core/media'
import { DISPUTE_IMAGES_MAX, loadDisputeForParty, partyCanPost, partyHasSubmitted, signEvidenceUrls } from '@/lib/dispute'
import { ApiError, route } from '@/lib/api/handler'
import { logError } from '@/lib/log'
import { db } from '@/lib/db'
import { EVIDENCE_BUCKET } from '@/lib/supabase-admin'
import { writeTombstones } from '@/lib/core/storage-tombstones'

/**
 * ⛔ A DURABLE PER-PARTY, PER-CASE CAP ON STORED EVIDENCE (security review 2026-10-22, item 11). Nothing ever deletes
 * from the `evidence` bucket, the bucket shares the server's disk with Postgres, and a party who never posts a
 * statement could keep calling this route: 60 requests/hour × 6 images ≈ 1 GB/hour per account, 24/7 — a slow
 * disk-fill that takes both editions down. A statement carries at most DISPUTE_IMAGES_MAX images, so three statements'
 * worth covers every retry and replacement a real party needs. The counter lives in kv (not the hourly rate window),
 * so waiting an hour does not refill it; it expires a while after the 72-hour evidence window closes.
 */
const DISPUTE_EVIDENCE_TOTAL_MAX = DISPUTE_IMAGES_MAX * 3
const EVIDENCE_COUNTER_TTL_SEC = 8 * 24 * 3600
/** A request can carry at most DISPUTE_IMAGES_MAX images of IMG_MAX_BYTES each, plus multipart overhead. */
const EVIDENCE_BODY_MAX_BYTES = DISPUTE_IMAGES_MAX * IMG_MAX_BYTES + 1024 * 1024

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

  // Storage-abuse vector → strict (Redis down = denied), like the other paid routes. 10/hour (was 60): a party
  // uploads one statement's worth of images, with retries — the per-case cap below is the real bound.
  const rl = await rateLimit('dispute-evidence', meId, 10, '1 h', { strict: true })
  if (!rl.success) throw new ApiError('rate_limited', 429)

  // Refuse an oversized body BEFORE parsing it into memory (item 11). An honest client always sends Content-Length;
  // a chunked body without one is still bounded by nginx's client_max_body_size.
  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > EVIDENCE_BODY_MAX_BYTES) throw new ApiError('payload_too_large', 413)

  let form: FormData
  try { form = await req.formData() } catch { throw new ApiError('invalid_body', 400) }
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) throw new ApiError('empty', 400)

  // Reserve slots atomically against the durable per-party cap, then give back whatever is not stored.
  const counterKey = `dispute-evid:${loaded.report.id}:${meId}`
  const want = Math.min(files.length, DISPUTE_IMAGES_MAX)
  const total = await kv.incrby(counterKey, want, EVIDENCE_COUNTER_TTL_SEC)
  const over = Math.max(0, total - DISPUTE_EVIDENCE_TOTAL_MAX)
  const allowed = want - over
  if (allowed <= 0) {
    await kv.incrby(counterKey, -want).catch((e) => logError(e, { op: 'dispute.evidence.capRelease' }))
    throw new ApiError('limit_reached', 429)
  }

  const paths: string[] = []
  let failed = 0
  try {
    for (const file of files.slice(0, allowed)) {
      if (!IMG_ALLOWED.has(file.type) || file.size === 0 || file.size > IMG_MAX_BYTES) { failed++; continue }
      const path = await storeEvidenceImage(Buffer.from(await file.arrayBuffer()), loaded.report.id)
      if (path) paths.push(path)
      else failed++
    }
  } finally {
    // Only STORED images consume the cap; a rejected or failed file gives its slot back. No TTL on the give-back,
    // so the counter keeps the expiry the reservation set.
    const unused = want - paths.length
    if (unused > 0) await kv.incrby(counterKey, -unused).catch((e) => logError(e, { op: 'dispute.evidence.capRelease' }))
  }
  // Files beyond the cap are reported as failed, so the client can tell the party why they did not attach.
  failed += Math.min(files.length, DISPUTE_IMAGES_MAX) - allowed

  // ⛔ AN UPLOAD NOBODY ATTACHES IS SWEPT (security review 2026-10-22, item 11). The images are stored here and attached by
  // a SEPARATE request (the party's statement), so an upload never posted — or replaced before posting — stayed in the
  // private bucket for good: receipts and screenshots carrying PII, on the disk Postgres uses. Each is tombstoned now
  // with its grace starting when the evidence window CLOSES, so the party keeps every minute of the window to post;
  // attaching clears the tombstone (dispute.ts addPartyStatementOnce), and the sweep deletes what was never attached
  // (storage-tombstones-sweep.svc.ts). A failed write is logged and the upload stands — unswept, as before.
  if (paths.length) {
    try {
      await writeTombstones(db, paths.map((path) => ({ bucket: EVIDENCE_BUCKET, path })), 'evidence_upload_pending', loaded.report.evidenceUntil ?? new Date())
    } catch (e) {
      logError(e, { op: 'dispute.evidence.tombstone' })
    }
  }

  return { paths, previews: await signEvidenceUrls(paths), failed }
})
