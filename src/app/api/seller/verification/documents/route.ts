import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  MAX_VERIFICATION_DOC_BYTES,
  sniffVerificationMime,
  storeVerificationDoc,
  VERIFICATION_DOC_KINDS,
  type VerificationDocKind,
} from '@/lib/business-verification-store'
import { appendVerificationDoc, getOrCreateDraft } from '@/lib/core/business-verification-service'
import { writeTombstones } from '@/lib/core/storage-tombstones'
import { BUSINESS_VERIFICATION_BUCKET } from '@/lib/supabase-admin'
import { logError } from '@/lib/log'
import { ApiError, route } from '@/lib/api/handler'

// Applicant uploads one business-verification document (identity / bank / authorization)
// to their OWN draft case. Mirrors the visa documents route's shape — auth → strict
// rateLimit → ownership → size-guard-before-arrayBuffer → MAGIC-BYTE validation (client
// MIME is NOT trusted) → store → append — minus the visa crypto/consent branches.
//
// ⚠️ WS6 MIGRATION — auth + the strict limiter become options, in the order they already ran
// (limiter BEFORE the ownership lookup, so a seller-less flooder still gets 429 first). Every code
// is unchanged: 401 `auth_required`, 429 `rate_limited`, 403 `no_storefront`, 400 `invalid_body` /
// `invalid_kind` / `invalid_document` / `file_too_large`, 415 `unsupported_file_type`,
// 409 `verification_locked`, 502 `store_failed`.
//
// ⚠️ `auth: 'userId'` — what the old code called (`getCurrentProfileId()`), and nothing here reads
// the Profile row: `userId` is used as the storefront's `ownerId` and as the doc's `profileId`.
//
// ⚠️ NO `body:` SCHEMA — THE PAYLOAD IS multipart/form-data, NOT JSON. route()'s `body:` calls
// `req.json()`, which would 400 every real upload. The formData parse stays in the handler with its
// own `invalid_body` 400, and the size guard stays BEFORE `arrayBuffer()` for the reason above it.
//
// ⚠️ SUCCESS IS 201, NOT 200, so it is a returned Response rather than a plain object — route()
// serialises a returned object with NextResponse.json's default 200 and would have silently
// downgraded the created-status.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL: the Prisma/storage calls were unwrapped, so a rejection was an
// unhandled throw answered by Next's default 500. route() now catches it and returns
// `{"error":"internal_error"}` 500 — an improvement, but a wire change on the failure path.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(
  {
    auth: 'userId',
    // Strict: uploads are an abuse/storage vector, so fail CLOSED if the limiter is down.
    rateLimit: { bucket: 'business-verif-doc', limit: 20, window: '1 h', strict: true },
  },
  async ({ req, userId }) => {
    const seller = await db.seller.findUnique({ where: { ownerId: userId }, select: { id: true } })
    if (!seller) throw new ApiError('no_storefront', 403)

    let form: FormData
    try { form = await req.formData() } catch { throw new ApiError('invalid_body', 400) }
    const kindRaw = form.get('kind')
    const file = form.get('file')
    if (typeof kindRaw !== 'string' || !VERIFICATION_DOC_KINDS.includes(kindRaw as VerificationDocKind)) {
      throw new ApiError('invalid_kind', 400)
    }
    if (!(file instanceof File)) throw new ApiError('invalid_document', 400)
    // Size guard BEFORE arrayBuffer() — never buffer a huge upload into memory to reject it.
    if (file.size > MAX_VERIFICATION_DOC_BYTES) throw new ApiError('file_too_large', 400)

    const bytes = Buffer.from(await file.arrayBuffer())
    const mime = sniffVerificationMime(bytes)
    if (!mime) throw new ApiError('unsupported_file_type', 415)

    const draft = await getOrCreateDraft(seller.id)
    if (!draft) throw new ApiError('verification_locked', 409)

    const stored = await storeVerificationDoc({ profileId: userId, kind: kindRaw as VerificationDocKind, bytes, mime })
    if (!stored) throw new ApiError('store_failed', 502)

    /**
     * ⛔ AN UPLOAD THAT IS STORED BUT NOT RECORDED MUST LEAVE A RETRYABLE TRACE. The object goes
     * into the private bucket first, so every way `appendVerificationDoc` can decline — a submit
     * that froze the case while this request was in flight, a lost row, a database error — leaves
     * a scan of somebody's identity document in storage with NOTHING referencing it. Nothing would
     * ever find it again: erasure and retention both work from the rows, and there are no rows.
     * A tombstone is that trace; the sweep re-checks references (this path has none by
     * construction) and removes the object, retrying until it succeeds.
     *
     * ⚠️ THE TOMBSTONE IS BEST-EFFORT AND THE UPLOAD STILL FAILS. Failing to queue the cleanup
     * must not turn a 409 into a 500 — the seller's problem is that their document was refused,
     * and the orphan is ours.
     */
    let appended = false
    try {
      appended = await appendVerificationDoc(draft.id, stored)
    } finally {
      if (!appended) {
        await writeTombstones(db, [{ bucket: BUSINESS_VERIFICATION_BUCKET, path: stored.path }], 'verification_doc_orphaned')
          .catch((e) => logError(e, { op: 'business-verification.orphan-tombstone' }))
      }
    }
    if (!appended) throw new ApiError('verification_locked', 409)

    return NextResponse.json({ ok: true, kind: stored.kind }, { status: 201 })
  },
)
