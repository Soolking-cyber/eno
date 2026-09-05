import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { rateLimit } from '@/lib/ratelimit'
import { decryptVisaPayload, encryptVisaPayload, visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { MAX_INTAKE_BYTES } from '@/lib/visa/image-normalization'
import { recordVisaEvent } from '@/lib/visa/records'
import { removeVisaFiles, storeVisaImage, VISA_BUCKET } from '@/lib/visa/storage'
import { db as prisma } from '@/lib/db'
import { clearTombstones, writeTombstones } from '@/lib/core/storage-tombstones'

/**
 * ⛔ A REFUSED UPLOAD USED TO LEAVE NO TRACE ANYWHERE, WHICH IS WHY "USERS CANNOT UPLOAD" COULD
 * ONLY EVER BE ANSWERED WITH A GUESS.
 *
 * `visa_documents` keeps only the last attempt per kind (every upload deletes the previous row),
 * and `visa_events` was written only on SUCCESS — so size, format and decode failures produced no
 * row in either table. The existing note in the funnel memo says it plainly: a failed upload emits
 * no event, and that is not evidence it does not happen. When the owner reported people stuck on
 * "too small" on 2026-08-19 there was no query that could say how often, on which kind, or from
 * which format. codex named this the highest-value change in the whole task and it was right: every
 * threshold in this file is now a number we can check against behaviour instead of defend from
 * first principles.
 *
 * ⚠️ IT RECORDS SHAPE, NEVER CONTENT. Kind, refusal code, declared MIME, extension and byte size —
 * enough to see which format or ceiling is doing the refusing. The image itself is never read here
 * and the filename is reduced to its extension, because a passport scan's filename routinely
 * carries the holder's name and this table is not encrypted.
 *
 * ⚠️ IT NEVER THROWS. Instrumentation that can fail an upload is worse than no instrumentation: the
 * applicant already has a refusal to act on, and turning a 400 into a 500 would hide it.
 */
async function recordUploadFailure(applicationId: string, userId: string, kind: string, code: string, file: File) {
  try {
    await recordVisaEvent(applicationId, 'applicant', 'document_upload_failed', userId, {
      kind,
      code,
      // ⚠️ `file.type` IS THE CLIENT'S CLAIM, NOT AN OBSERVED FACT — it is a multipart header the
      // caller writes, so it can carry arbitrary text of arbitrary length straight into an audit
      // row that is not encrypted. Flagged by codex on the diff. Only a well-formed, short
      // `type/subtype` is kept; anything else is recorded as the fact that it was malformed, which
      // is the only part with diagnostic value anyway.
      mimeType: /^[a-z]+\/[a-z0-9.+-]{1,24}$/.test(file.type.toLowerCase()) ? file.type.toLowerCase() : 'malformed',
      extension: /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1]?.toLowerCase() || 'none',
      sizeBytes: file.size,
    })
  } catch { /* never let telemetry turn a clear 400 into a 500 */ }
}

// In-hub port of apps/forum/src/app/api/visa/applications/[id]/documents/route.ts —
// cookie-session auth, no CORS layer. A passport upload records AI-processing consent
// INSIDE the encrypted payload, so the route is env-gated on visaCryptoReady() (an
// upload that couldn't record consent would fork the two surfaces' behavior).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const kindSchema = z.enum(['portrait', 'passport', 'supporting'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ⚠️ WS6 MIGRATION — `auth: 'userId'` ONLY, AND THE LIMITER DELIBERATELY STAYS IN THE HANDLER.
// The old preamble's first line WAS getCurrentProfileId() answering 401 `auth_required`, so the
// auth mode is byte-identical. `rateLimit:` is NOT used because the wrapper's fixed order is
// auth → rateLimit → handler, while the bytes on the wire are auth → CRYPTO GATE → rateLimit: a
// caller who is over 20/h while VISA_ENCRYPTION_KEY is unset gets 503
// `visa_encryption_not_configured` today and would get 429 `rate_limited` if the limiter were
// hoisted. Same reason `body:` is unused — this is `multipart/form-data`, not JSON.
//
// THE FULL BRANCH INVENTORY, all unchanged:
//   guest                         401 {"error":"auth_required"}
//   crypto key unset              503 {"error":"visa_encryption_not_configured"}
//   over 20/h (strict, per user)  429 {"error":"rate_limited"}
//   non-uuid id                   404 {"error":"not_found"}
//   case absent or another user's 404 {"error":"not_found"}
//   status not draft/needs_changes 409 {"error":"application_locked"}   ← checked twice since
//                                     2026-09-05: here, and again inside visa_commit_document
//                                     under the row lock; the second answers the same 409
//   unreadable multipart          400 {"error":"invalid_body"}
//   bad `kind` or no File         400 {"error":"invalid_document"}
//   wrong mime AND wrong ext      415 {"error":"unsupported_image_type"}
//   file over 15 MB               400 {"error":"image_size_invalid"}
//   storeVisaImage refusal        400 {"error":"<that pipeline code>"}   ← computed, so it stays a
//                                     bare NextResponse rather than an ApiError
//   success                       201 {"document":{…}}
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL, AND IT IS THE ACCEPTED ONE. Any unhandled throw in this
// handler — including the deliberate `throw error` re-raise at the bottom for a storage failure the
// code list does not name — used to reach Next's own default 500. route() now catches it, logs it
// with an `op`, and answers `{"error":"internal_error"}` 500.
export const POST = route({ auth: 'userId' }, async ({ req, params, userId }) => {
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  const limit = await rateLimit('visa-document', userId, 20, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const { id } = params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const db = getVisaDb()
  const { data: application } = await db.from('visa_applications').select('id,status,encrypted_payload,updated_at').eq('id', id).eq('user_id', userId).maybeSingle()
  if (!application) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!['draft', 'needs_changes'].includes(application.status)) return NextResponse.json({ error: 'application_locked' }, { status: 409 })
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }
  const kind = kindSchema.safeParse(form.get('kind'))
  const file = form.get('file')
  if (!kind.success || !(file instanceof File)) return NextResponse.json({ error: 'invalid_document' }, { status: 400 })
  /**
   * ⚠️ AVIF AND TIFF WERE ADDED. BMP AND GIF WERE NOT, FOR DIFFERENT REASONS.
   *
   * Owner, 2026-08-19: *"image size format correct accept"* — a document refused for its container
   * is a document we simply declined to read. A flatbed scanner emits TIFF and a modern phone emits
   * AVIF without the user ever choosing either.
   *
   * ⛔ BMP WAS IN THIS LIST FOR ONE REVISION AND IS THE REASON TO TEST RATHER THAN ASSUME. I added
   * it believing "sharp decodes everything"; the prebuilt libvips binary has NO BMP loader (it
   * needs ImageMagick, which the npm package does not ship). Measured:
   *   `require('sharp').format.bmp` → undefined, and `.toFormat('bmp')` throws.
   * So a BMP under 3.7 MB would have travelled to the server untouched and died as
   * `image_decode_failed` — "That image is damaged or unreadable" — directly beneath UI copy
   * promising BMP was fine. Caught by a reviewer, confirmed by running it.
   *
   * GIF is excluded for a different reason: nobody scans a passport to GIF, so it buys no real
   * applicant anything, while animation makes "which frame is the document?" unanswerable.
   * Multi-page TIFF and decompression bombs were already answered upstream — normalizeVisaImage
   * rejects `(metadata.pages || 1) !== 1` and caps the decode at `limitInputPixels: 40_000_000`.
   */
  const acceptedMime = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif', 'image/tiff']
  const acceptedExtension = /\.(jpe?g|png|webp|heic|heif|avif|tiff?)$/i.test(file.name)
  if (!acceptedMime.includes(file.type.toLowerCase()) && !acceptedExtension) {
    await recordUploadFailure(id, userId, kind.data, 'unsupported_image_type', file)
    return NextResponse.json({ error: 'unsupported_image_type' }, { status: 415 })
  }
  try {
    // Size guard BEFORE arrayBuffer() — otherwise a huge upload is fully buffered into
  // memory before storeVisaImage's downstream validation ever sees it.
  if (file.size > MAX_INTAKE_BYTES) {
    await recordUploadFailure(id, userId, kind.data, 'image_size_invalid', file)
    return NextResponse.json({ error: 'image_size_invalid' }, { status: 400 })
  }
  const stored = await storeVisaImage(Buffer.from(await file.arrayBuffer()), userId, id, kind.data)
    // ⛔ THE OBJECT IS TOMBSTONED THE MOMENT IT EXISTS, before anything between it and the row
    // that will reference it can fail. The commit below drops the tombstone; if the commit never
    // happens — case locked meanwhile, a crash, an outage — the sweep removes the orphan after
    // its grace hour (2026-09-05 review, S04).
    await writeTombstones(prisma, [{ bucket: VISA_BUCKET, path: stored.storage_path }], 'visa_upload_intent')
    const document = { id: randomUUID(), application_id: id, kind: kind.data, ...stored, created_at: new Date().toISOString() }
    // ⛔ ONE TRANSACTION, HOLDING THE APPLICATION ROW: re-checks the status (the check above is a
    // TOCTOU on its own — a submit can land while the image is in flight), deletes the previous
    // rows of this kind, tombstones their objects, inserts the new row and drops the intent
    // tombstone. scripts/visa-commit-document-fn.mjs. Two concurrent uploads of the same kind
    // serialise on the row lock and leave exactly one document.
    const commit = await db.rpc('visa_commit_document', { p_application_id: id, p_user_id: userId, p_document: document, p_replace: kind.data !== 'supporting' })
    if (commit.error) throw commit.error
    const result = (commit.data ?? {}) as { ok?: boolean; code?: string; old_paths?: string[] }
    if (!result.ok) {
      // The row-level re-check lost: submitted or gone while the image was in flight. Nothing
      // references the new object; its tombstone stands and the sweep removes it.
      const gone = result.code === 'not_found'
      return NextResponse.json({ error: gone ? 'not_found' : 'application_locked' }, { status: gone ? 404 : 409 })
    }
    if (kind.data === 'passport') {
      // ⚠️ COMPARE-AND-SET ON updated_at. The consent stamp is a read-modify-write of the whole
      // encrypted payload; a concurrent PATCH (the applicant editing the form in another tab)
      // between our read and this write would be overwritten with a stale payload. The write is
      // gated on the updated_at we read; losing the race re-reads and re-applies on the newer
      // payload. Three attempts, then a loud failure — the document IS committed either way.
      let current: { encrypted_payload: string; updated_at: string } = application
      for (let attempt = 0; ; attempt++) {
        const payload = decryptVisaPayload(current.encrypted_payload)
        if (payload.aiDocumentProcessingConsent) break
        payload.aiDocumentProcessingConsent = true
        const consentUpdate = await db.from('visa_applications')
          .update({ encrypted_payload: encryptVisaPayload(payload), updated_at: new Date().toISOString() })
          .eq('id', id).eq('user_id', userId).eq('updated_at', current.updated_at).select('id')
        if (consentUpdate.error) throw consentUpdate.error
        if (consentUpdate.data?.length) break
        if (attempt >= 2) throw new Error('consent_stamp_lost')
        const reread = await db.from('visa_applications').select('encrypted_payload,updated_at').eq('id', id).eq('user_id', userId).maybeSingle()
        if (reread.error) throw reread.error
        if (!reread.data) throw new Error('consent_stamp_lost')
        current = reread.data
      }
    }
    const oldPaths = result.old_paths ?? []
    if (oldPaths.length) {
      // Fast path. The RPC already tombstoned these, so a failure here loses nothing — the sweep
      // finishes it after the grace hour; a success clears the tombstones now.
      const removed = await removeVisaFiles(oldPaths, { strict: false })
      if (removed) await clearTombstones(oldPaths.map((path) => ({ bucket: VISA_BUCKET, path })))
    }
    await recordVisaEvent(id, 'applicant', 'document_uploaded', userId, { kind: kind.data, corrections: document.validation_report.corrections })
    return NextResponse.json({ document: { id: document.id, kind: document.kind, mimeType: document.mime_type, sizeBytes: document.size_bytes, width: document.width, height: document.height, validationStatus: document.validation_status, validationReport: document.validation_report, createdAt: document.created_at } }, { status: 201 })
  } catch (error) {
    const code = (error as Error).message.split(':')[0]
    if (['image_size_invalid', 'image_dimensions_invalid', 'image_decode_failed', 'portrait_resolution_too_low', 'passport_resolution_too_low', 'image_official_limit_failed'].includes(code)) {
      await recordUploadFailure(id, userId, kind.data, code, file)
      return NextResponse.json({ error: code }, { status: 400 })
    }
    throw error
  }
})
