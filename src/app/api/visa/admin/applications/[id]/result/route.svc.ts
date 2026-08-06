import { NextResponse } from 'next/server'
import { getAdmin } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent } from '@/lib/visa/records'
import {
  VISA_RESULT_MAX_BYTES,
  checkVisaResultPdf,
  findVisaResultCard,
  findVisaResultDocument,
  insertVisaResultDocument,
  sendVisaResultCard,
  sendVisaResultThankYou,
  storeVisaResultPdf,
} from '@/lib/visa/result'
import { readVisaFile, removeVisaFiles } from '@/lib/visa/storage'

// THE DESK UPLOADS THE FINISHED VISA — the last thing that happens to a case.
//
// The owner: "we can upload final result to the chat as pdf user can download there also
// auto send beautifully crafted email from no reply with pdf result and thanking for using
// service". One POST does all three: stores the PDF privately, posts the download card in
// the applicant's thread, and mails it to them.
//
// ⚠️ ONE RESULT PER CASE, EVER (owner: "should be hard cap on reuploads only 1 time result
// can be uploaded by admin"). Where each half of that lives:
//   · THE REFUSAL the desk sees is step 4 below — findVisaResultDocument runs BEFORE the
//     request body is read, so a second attempt stores no object, writes no row, posts no
//     card and sends no email. It answers 409 `result_already_uploaded`.
//   · THE RACE is closed in POSTGRES, by the partial unique index
//     `visa_documents_one_result_key` (scripts/visa-result-unique.mjs). Two clicks a second
//     apart both pass step 4; the losing INSERT violates that index and step 8 turns the
//     violation into the same 409 — after DELETING the object it had already uploaded, so a
//     lost race leaves nothing behind in the bucket.
// The admin UI renders the control as SPENT once a result exists, so this refusal is a
// backstop rather than the normal experience (src/app/admin/visas/[id]/case-actions.tsx).
//
// ⚠️ DELIBERATELY DIFFERENT FROM THE FORUM'S ROUTE, which replaces an existing result
// (apps/forum/src/app/api/visa/admin/applications/[id]/result/route.ts deletes the old row
// and object). eno.vn refuses instead. That is the owner's rule, and it means a wrong PDF
// uploaded once is unfixable through this route BY DESIGN — recovery is an admin deleting
// the row and its storage object directly (documented in scripts/visa-result-unique.mjs).
// Which is exactly why the PDF validation in step 6 is load-bearing: it is the last moment
// anything can be refused.
//
// ⚠️ IT DOES NOT CHANGE THE CASE STATUS. Uploading the result is what UNLOCKS the existing
// `approved` transition — src/lib/visa-admin.ts:173 refuses to approve a case with no
// result document — and the desk presses that separately, through the control that already
// has the CAS and the audit event. Flipping status here would make that gate unreachable.
//
// ⚠️ ONCE THE DOCUMENT ROW IS COMMITTED, THIS ROUTE MUST ANSWER SUCCESS. The cap forbids a
// retry, so a 500 raised after the insert would strand the desk with a stored visa it can
// neither see nor re-send. Everything after step 8 — the audit, the card, the email — is
// therefore best-effort and REPORTED in the response body rather than raised, so the
// operator can see exactly which of the three landed.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Case states where a result PDF is definitionally wrong: the applicant is still typing, or
 * the case is over without a visa. Everything else is allowed on purpose — the government
 * sometimes issues before the queue's status catches up, and a status gate that keeps a
 * real visa from its applicant is a worse failure than an early upload (owner's launch
 * lenience policy). A case already in `approved` necessarily holds a result, so the cap
 * refuses it one step later anyway.
 */
const BLOCKED_STATUSES = new Set(['draft', 'cancelled', 'rejected'])

/** Every way out, with no-store — refusals included (the bundle route's `refuse` idiom:
 *  a cacheable 404/409 on this URL outlives the state that produced it). */
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } as const
const refuse = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE })

// ⚠️ WS6 — NOT MIGRATED: same three bytes as the sibling bundle route.
//   · `auth: 'admin'` would change the refusal from `{"error":"forbidden"}` to
//     `{"error":"Forbidden"}` (handler.ts:189 hardcodes the capital F).
//   · `refuse()` puts `Cache-Control: no-store, max-age=0, must-revalidate` on every way out —
//     403, 404, both 409s, all the 400s and the 503s — and so do the two success responses.
//     `apiFail()` sets no headers.
//   · `rateLimit:` is keyed on the ADMIN EMAIL; with `auth:'admin'` the wrapper's `userId` is null
//     so it would key on `clientIp(req)`.
// `body:` is unavailable regardless: the payload is `multipart/form-data`, and it is deliberately
// read only AFTER the one-result-per-case cap has been checked, so a refused 10 MB PDF is never
// buffered. The wrapper parses the body before the handler runs.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // (1) ADMIN ONLY. getAdmin() re-verifies the session with the auth server and matches it
  // against ADMIN_EMAILS — the same gate as the bundle and takeover routes. NOTHING is read
  // or written before it passes; result.test.ts drives a non-admin request with every data
  // call counted and asserts all the counters stay at zero, so deleting this turns the
  // suite red rather than quietly opening the upload.
  const admin = await getAdmin()
  if (!admin) return refuse('forbidden', 403)
  // Fails OPEN (no `strict`), like the sibling admin routes: the caller is already an admin,
  // so a limiter outage must not lock the desk out of delivering a visa.
  const limit = await rateLimit('visa-admin-result', admin, 60, '1 h')
  if (!limit.success) return refuse('rate_limited', 429)

  // (2) A non-uuid segment would 400 at the uuid column, not 404 — pre-empt it.
  const { id } = await params
  if (!UUID_RE.test(id)) return refuse('not_found', 404)

  // (3) The case. `user_id` is needed for the storage path (byte-identical to the forum's)
  // and `reference` for the filename and the card; `encrypted_payload` is carried so the
  // email can be sent without a second read — it is decrypted inside sendVisaResultThankYou
  // and nowhere in this file.
  const db = getVisaDb()
  const { data: application, error: loadError } = await db
    .from('visa_applications')
    .select('id,user_id,status,reference,encrypted_payload')
    .eq('id', id)
    .maybeSingle()
  if (loadError) {
    console.error('[visa-result] case load failed', loadError.code)
    return refuse('visa_database_unavailable', 503)
  }
  if (!application) return refuse('not_found', 404)
  if (BLOCKED_STATUSES.has(application.status)) return refuse('application_not_ready_for_result', 409)

  // (4) THE HARD CAP, before the body is read — nothing is stored on the refusing path, and
  // a 10 MB upload is not buffered just to be thrown away. Throws (fails closed) if the
  // lookup itself errors: "I could not tell" must never read as "there is no result yet".
  //
  // DELIVERY-AWARE since 2026-07-23 (dual plan review): a hit here is a true duplicate ONLY
  // when the document's card is already in the thread. A committed document with NO card is
  // the aftermath of a delivery failure (the card step below answered 503 without undoing),
  // and the desk's retry must RESUME — post the missing card for the EXISTING document and
  // send the never-sent email — not be told "already uploaded" about a visa its owner
  // cannot reach. findVisaResultCard THROWS when it cannot tell (transient) → 503, no
  // resume; the concurrent-retry double-card race is decided by the partial unique index
  // message_one_result_card_per_document (the loser's card refuses → it 503s without
  // emailing; exactly-once holds).
  try {
    const existing = await findVisaResultDocument(id)
    if (existing) {
      let delivered: { messageId: string } | null
      try {
        delivered = await findVisaResultCard(id, existing.id)
      } catch {
        console.error('[visa-result] delivery check failed — refusing without resume')
        return refuse('visa_database_unavailable', 503)
      }
      if (delivered) return refuse('result_already_uploaded', 409)

      const card = await sendVisaResultCard({ applicationId: id, documentId: existing.id, reference: application.reference })
      if (!card) {
        console.error('[visa-result] resume could not post the card — still undelivered')
        return refuse('result_not_delivered', 503)
      }
      // The thank-you email provably never went: it is only ever sent AFTER a successful
      // card post, and this document had no card until just now. The attachment is re-read
      // from storage (the original request's bytes are long gone); an unreadable object
      // degrades to the email's own 'failed' outcome — the card, the route that matters,
      // is already up.
      let mail: Awaited<ReturnType<typeof sendVisaResultThankYou>> = 'failed'
      try {
        const pdf = await readVisaFile(existing.storage_path)
        mail = await sendVisaResultThankYou({
          applicationId: id,
          userId: application.user_id,
          encryptedPayload: application.encrypted_payload,
          reference: application.reference,
          pdf,
        })
      } catch {
        console.error('[visa-result] resume could not re-read the stored PDF for the email')
      }
      try {
        await recordVisaEvent(id, 'admin', 'result_delivery_resumed', admin, { documentId: existing.id })
      } catch { console.error('[visa-result] audit write failed for a resumed delivery') }
      return NextResponse.json(
        { document: { id: existing.id, kind: 'result' }, card: 'posted', email: mail, resumed: true },
        { status: 200, headers: NO_STORE },
      )
    }
  } catch {
    console.error('[visa-result] existing-result lookup failed — upload refused')
    return refuse('visa_database_unavailable', 503)
  }

  // (5) The file.
  let form: FormData
  try { form = await request.formData() } catch { return refuse('invalid_body', 400) }
  const file = form.get('file')
  if (!(file instanceof File)) return refuse('pdf_required', 400)
  // Size BEFORE arrayBuffer(), or an oversized upload is fully buffered into memory before
  // anything looks at it (the documents route's lesson).
  if (file.size > VISA_RESULT_MAX_BYTES) return refuse('result_pdf_too_large', 400)

  const bytes = Buffer.from(await file.arrayBuffer())
  // (6) IS IT ACTUALLY A PDF? Magic bytes and the trailer marker, never `file.type` — that
  // is a string the uploading client chose. A wrong file here is the applicant's visa, and
  // the cap means there is no second chance to notice.
  const problem = checkVisaResultPdf(bytes)
  if (problem) return refuse(problem, 400)

  // (7) Store it in the PRIVATE bucket. No signed URL is minted here or anywhere else —
  // both surfaces stream the bytes through an authenticated handler.
  let stored
  try {
    stored = await storeVisaResultPdf(bytes, application.user_id, id)
  } catch {
    console.error('[visa-result] storage upload failed')
    return refuse('visa_storage_failed', 503)
  }

  // (8) Record it. The unique index decides a concurrent double-upload; the loser's object
  // is removed so a lost race leaves no orphan in the bucket.
  const inserted = await insertVisaResultDocument(id, stored)
  if (!inserted.ok) {
    // Either way the row does not exist, so the object must not either — a stored PDF with
    // no row is invisible to every reader and would still count against nothing.
    await removeVisaFiles([stored.storage_path])
    const lost = inserted.error === 'result_already_uploaded'
    return refuse(lost ? 'result_already_uploaded' : 'result_record_failed', lost ? 409 : 503)
  }

  // ── COMMITTED. From here nothing may fail the request. ────────────────────────────
  // (9) Audit. Best-effort AFTER the write, unlike the handover download (which refuses
  // rather than export an unlogged dossier): there the audit gates bytes leaving, here the
  // bytes are already in, and answering 503 would bait the desk into a retry the cap
  // refuses. Metadata is a size and a hash — no applicant value, no storage path.
  let audited = true
  try {
    await recordVisaEvent(id, 'admin', 'result_uploaded', admin, {
      documentId: inserted.id,
      sizeBytes: stored.size_bytes,
      sha256: stored.sha256,
    })
  } catch {
    audited = false
    console.error('[visa-result] audit write failed after a committed upload')
  }

  // (10) The card in the applicant's own thread, authored server-side as the shop.
  const card = await sendVisaResultCard({ applicationId: id, documentId: inserted.id, reference: application.reference })

  // ⚠️ NO CARD ⇒ 503, UPLOAD KEPT (the undo this branch used to run is gone, 2026-07-23
  // dual plan review). The dead end the undo guarded — a committed visa its owner cannot
  // reach, cap spent — is now closed the other way round: the desk's retry lands in step
  // (4)'s delivery-aware branch, which RESUMES by posting the missing card for this very
  // document. Keeping the upload means a transient blip no longer costs a 10MB re-upload
  // cycle, and delivery is idempotent instead of destructive. The email is still NOT
  // attempted here: an attachment arriving for a case with no card is the confusing
  // half-state we are avoiding — the resume branch sends it after the card lands.
  if (!card) {
    console.error('[visa-result] card could not be posted — upload kept; retry resumes delivery')
    return refuse('result_not_delivered', 503)
  }

  // (11) The thank-you email, with the PDF attached. Exactly once by construction: it hangs
  // off an insert that can only happen once.
  const mail = await sendVisaResultThankYou({
    applicationId: id,
    userId: application.user_id,
    encryptedPayload: application.encrypted_payload,
    reference: application.reference,
    pdf: bytes,
  })

  return NextResponse.json(
    {
      document: { id: inserted.id, kind: 'result' },
      // What actually landed, so the operator is never told "done" about a step that did not.
      card: card ? 'posted' : 'skipped',
      email: mail,
      audited,
    },
    { status: 201, headers: NO_STORE },
  )
}
