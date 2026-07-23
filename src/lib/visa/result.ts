import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { renderVisaResultEmail } from '@/lib/emails/visa-result'
import { sendMail } from '@/lib/mail'
import { insertMessage, type VisaResultMeta } from '@/lib/messages'
import { VISA_BUCKET } from '@/lib/visa-admin'
import { getVisaShopSeller } from '@/lib/visa-shop'
import { decryptVisaPayload, visaCryptoReady } from './crypto'
import { getVisaDb } from './db'
import { visaConversationIdFor } from './dm-thread'
import { removeVisaFiles } from './storage'
import { normalizeVisaReference } from './reference'

// ── THE FINISHED VISA ─────────────────────────────────────────────────────────────────
//
// The owner: "we can upload final result to the chat as pdf user can download there also
// auto send beautifully crafted email from no reply with pdf result and thanking for using
// service". One module owns everything that happens to that PDF: validating it, putting it
// in the private bucket, recording it, announcing it in the chat, and mailing it.
//
// ⚠️ ONE RESULT PER CASE, EVER — A HARD CAP (owner: "should be hard cap on reuploads only 1
// time result can be uploaded by admin"). Two mechanisms, and only one of them is the
// guarantee:
//   · `findVisaResultDocument` is the PRE-CHECK. The upload route calls it before it reads
//     the request body, so an ordinary second attempt is refused with `result_already_uploaded`
//     and NOTHING is stored — no object in the bucket, no row, no card, no email.
//   · `insertVisaResultDocument` is where the RACE IS CLOSED, and the closing happens in
//     Postgres: `visa_documents_one_result_key` is a partial unique index on
//     (application_id) WHERE kind='result' (scripts/visa-result-unique.mjs). Two clicks a
//     second apart both pass the pre-check; the second INSERT loses on that index with
//     SQLSTATE 23505 and is reported as the same refusal. A read-then-write in application
//     code cannot do this, and this module deliberately does not pretend otherwise.
// Because the row can only be created once, the thank-you email is sent exactly once BY
// CONSTRUCTION — there is no dedupe flag, no "already sent" column, and nothing to keep in
// sync. The single insert is the single send.
//
// ⚠️ RECOVERY FROM A WRONG UPLOAD. There is no replace, no force and no second chance
// through this code. A genuinely wrong PDF is fixed by an admin deleting that
// visa_documents row and its storage object DIRECTLY (see scripts/visa-result-unique.mjs),
// after which the control comes back on its own. That is why `checkVisaResultPdf` below is
// load-bearing rather than decorative: it is the last moment anything can be refused.
//
// ⚠️ PII. The result PDF is an identity document. It may reach the applicant and the desk
// and nobody else:
//   · the bucket is PRIVATE and no signed or public URL to a result is ever handed out —
//     both routes stream the bytes through an authenticated handler;
//   · the applicant's email address lives inside the ENCRYPTED payload. It is decrypted in
//     `sendVisaResultThankYou`, handed to sendMail, and never logged, never returned in a
//     response body and never written into a filename (sendMail masks it in its own logs);
//   · the FILENAME is built from the case reference alone (`EV-1042-evisa.pdf`) — no name,
//     no passport number, no date of birth. A filename is the one part of an attachment
//     that every hop, scanner and forwarding client reads in the clear;
//   · the CARD carries a document id and a case reference. It names a document, never a
//     person, and `visaResultMetaSchema` in src/lib/messages.ts makes anything else
//     structurally unwritable.

/**
 * The route's ceiling on an upload, and it is the SAME NUMBER the database enforces:
 * visa_documents carries `check (size_bytes > 0 and size_bytes <= 10485760)`. Keeping them
 * equal means every file the route accepts, the table also accepts — the constraint can
 * never be the thing that fails, so a rejection always comes with an error the desk can
 * read. A real e-Visa PDF is a few hundred KB.
 */
export const VISA_RESULT_MAX_BYTES = 10 * 1024 * 1024

/** Every way a candidate file is refused. Each is a distinct sentence in the admin UI. */
export type VisaResultPdfProblem =
  | 'result_pdf_empty'
  | 'result_pdf_too_large'
  | 'result_pdf_not_a_pdf'
  | 'result_pdf_truncated'

const PDF_HEADER = '%PDF-'
const PDF_EOF = '%%EOF'
/** How far back from the end to look for the trailer marker: generous enough for trailing
 *  newlines and the padding some signing tools append, tight enough to stay a real check. */
const EOF_WINDOW = 4096

/**
 * Is this actually a PDF, and a whole one?
 *
 * ⚠️ THE BYTES, NEVER THE HEADER. `file.type` is a string the uploading client chose; it
 * says nothing about the file. This reads the magic number at offset 0 (`%PDF-`, ISO
 * 32000-1 §7.5.2) and the trailer marker near the end (`%%EOF`, §7.5.5), which every
 * conforming PDF has.
 *
 * The truncation check is the one that earns its place. A half-uploaded file still starts
 * with `%PDF-`, so a header-only check accepts it, the hard cap then spends itself on a
 * broken visa, and the applicant's document is unrecoverable without a hand-edit of the
 * database. Refusing costs the desk a retry; accepting costs the applicant their visa. It
 * is deliberately asymmetric in the applicant's favour.
 */
export function checkVisaResultPdf(bytes: Uint8Array): VisaResultPdfProblem | null {
  if (!bytes.length) return 'result_pdf_empty'
  if (bytes.length > VISA_RESULT_MAX_BYTES) return 'result_pdf_too_large'
  // Latin1 so a byte is a character: the header is ASCII and must match exactly.
  if (Buffer.from(bytes.subarray(0, PDF_HEADER.length)).toString('latin1') !== PDF_HEADER) return 'result_pdf_not_a_pdf'
  const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - EOF_WINDOW))).toString('latin1')
  if (!tail.includes(PDF_EOF)) return 'result_pdf_truncated'
  return null
}

/**
 * The name the applicant's browser and mail client both save.
 *
 * ASCII-SAFE BY CONSTRUCTION: `normalizeVisaReference` re-emits only `EV`, `-` and digits
 * (src/lib/visa/reference.ts), so no separator, quote, newline or non-ASCII character can
 * reach a Content-Disposition header or an attachment name through here — and no applicant
 * value can either, because a reference is not one. A case written before the reference
 * column existed falls back to a constant rather than to the case uuid: a uuid in a
 * filename is noise to the customer and a correlatable identifier in their inbox.
 */
export function visaResultFilename(reference: string | null | undefined): string {
  const ref = normalizeVisaReference(reference)
  return ref ? `${ref}-evisa.pdf` : 'eno-evisa.pdf'
}

export type StoredVisaResult = {
  storage_path: string
  mime_type: 'application/pdf'
  size_bytes: number
  width: null
  height: null
  sha256: string
  validation_status: 'passed'
  validation_report: Record<string, unknown>
}

/**
 * Put the PDF in the private bucket.
 *
 * ⚠️ INTEROP: the object path is `${userId}/${applicationId}/result-${uuid}.pdf`, byte-
 * identical to the forum's storeVisaResult (apps/forum/src/lib/visa/storage.ts) so either
 * surface can serve a result the other one stored — the same contract src/lib/visa/storage.ts
 * states for images. `upsert:false` because a fresh uuid can only collide with itself.
 */
export async function storeVisaResultPdf(bytes: Buffer, userId: string, applicationId: string): Promise<StoredVisaResult> {
  const problem = checkVisaResultPdf(bytes)
  // Belt and braces: the route already refused, but this function is the only writer and a
  // future caller must not be able to store something unchecked.
  if (problem) throw new Error(problem)
  const path = `${userId}/${applicationId}/result-${randomUUID()}.pdf`
  const { error } = await getVisaDb().storage.from(VISA_BUCKET).upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: false,
    cacheControl: 'private, max-age=0',
  })
  if (error) throw new Error(`visa_storage_failed:${error.message}`)
  return {
    storage_path: path,
    mime_type: 'application/pdf',
    size_bytes: bytes.length,
    width: null,
    height: null,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    // 'passed' rather than 'pending': the only checks a result gets are the ones above, and
    // they have already run. The forum's writer records the same value for the same reason.
    validation_status: 'passed',
    validation_report: { kind: 'result', issues: [], technicalChecks: { validPdf: true } },
  }
}

export type VisaResultDocument = { id: string; storage_path: string; created_at: string }

/**
 * This case's result document, or null.
 *
 * FAILS CLOSED BY THROWING. A Supabase error must not read as "there is no result yet" —
 * that is the exact reading that would let a second PDF through the cap. Callers turn a
 * throw into a refusal, never into a permission.
 */
export async function findVisaResultDocument(applicationId: string): Promise<VisaResultDocument | null> {
  const { data, error } = await getVisaDb()
    .from('visa_documents')
    .select('id,storage_path,created_at')
    .eq('application_id', applicationId)
    .eq('kind', 'result')
    .order('created_at')
    .limit(1)
  if (error) throw new Error(`visa_result_lookup_failed:${error.code ?? 'unknown'}`)
  return (data as VisaResultDocument[] | null)?.[0] ?? null
}

/** Postgres unique_violation. PostgREST forwards the SQLSTATE verbatim in `code`. */
const UNIQUE_VIOLATION = '23505'

export type VisaResultInsert =
  | { ok: true; id: string }
  | { ok: false; error: 'result_already_uploaded' | 'insert_failed' }

/**
 * Record the stored PDF as this case's one result document.
 *
 * ⚠️ THIS IS WHERE THE HARD CAP IS DECIDED. The insert is plain — no upsert, no
 * ON CONFLICT — so the partial unique index `visa_documents_one_result_key` is free to
 * reject the loser of a concurrent double-upload, which surfaces as SQLSTATE 23505 and is
 * translated here into the same refusal the pre-check gives. If the index has not been
 * created yet (scripts/visa-result-unique.mjs), this function still behaves correctly for
 * every sequential upload and loses only the race — say so out loud rather than assuming
 * the deploy order.
 */
export async function insertVisaResultDocument(applicationId: string, stored: StoredVisaResult): Promise<VisaResultInsert> {
  const id = randomUUID()
  const { error } = await getVisaDb().from('visa_documents').insert({
    id,
    application_id: applicationId,
    kind: 'result',
    ...stored,
    created_at: new Date().toISOString(),
  })
  if (!error) return { ok: true, id }
  if (error.code === UNIQUE_VIOLATION) return { ok: false, error: 'result_already_uploaded' }
  // Code only. A PostgREST message can echo the row it refused, and this row names a
  // storage path that identifies an account and a case.
  console.error('[visa-result] document insert failed', error.code)
  return { ok: false, error: 'insert_failed' }
}

/** The conversation columns insertMessage needs (ConvoForSend) plus the binding it validates. */
const RESULT_THREAD_SELECT = {
  id: true, buyerProfileId: true, sellerProfileId: true, listingId: true, visaApplicationId: true,
} as const

type ResultThread = {
  id: string
  buyerProfileId: string
  sellerProfileId: string | null
  listingId: string
  visaApplicationId: string | null
}

/**
 * The thread this case's result card belongs in, resolved through the IMMUTABLE
 * visa_applications.conversation_id — NOT through Conversation.visaApplicationId.
 *
 * ⚠️ THIS IS THE STRANDING FIX. One buyer↔desk conversation is rebound from case to case, so
 * the live binding names only the case in flight. A repeat applicant who starts case B while
 * case A is still processing moves that pointer to B; looking case A's thread up by the live
 * binding then returns nothing, the result route treats "no thread" as "not delivered", and
 * DELETES the freshly uploaded PDF — case A's paid-for visa vanishes. conversation_id is the
 * handle that survives: set once at bind time, never rebound, so case A still finds the thread
 * its cards live in.
 *
 * Falls back to the live binding ONLY when conversation_id is null (a case that predates the
 * column, or one that never bound) — and SAYS SO in the log, because a delivery riding the
 * live pointer is exactly the pre-fix path that cannot reach a rebound case. A non-null link
 * is authoritative and never falls through.
 */
async function resolveVisaResultThread(applicationId: string): Promise<ResultThread | null> {
  const conversationId = await visaConversationIdFor(applicationId)
  if (conversationId) {
    return (await db.conversation.findUnique({ where: { id: conversationId }, select: RESULT_THREAD_SELECT })) ?? null
  }
  // No immutable link: the live binding is the only handle left, and it cannot reach a case a
  // later case rebound away. Named out loud so an operator can tell the fallback happened.
  console.warn('[visa-result] case has no conversation_id — resolving the thread by the live binding')
  return (await db.conversation.findUnique({ where: { visaApplicationId: applicationId }, select: RESULT_THREAD_SELECT })) ?? null
}

/**
 * Announce the finished visa in the applicant's own thread.
 *
 * ⚠️ AUTHORED AS THE SHOP, AND THERE IS NO SENDER ARGUMENT — the same rule
 * src/lib/visa/dm-thread.ts states for every other visa card, re-asserted here rather than
 * inherited: the sender is resolved server-side from the storefront row, and the conversation
 * must be one of the desk's own. The thread is now resolved by the IMMUTABLE conversation_id
 * (resolveVisaResultThread), not the live binding, so case A's result reaches case A's thread
 * even after case B rebinds the live pointer. The four authoring gates are in
 * src/lib/messages.ts, unchanged.
 *
 * insertMessage's binding guard now ACCEPTS the immutable link too (src/lib/messages.ts
 * buildCardMeta: the immutable link is authoritative, the live pointer only a fallback for a
 * case with no link), so a card for a REBOUND case is no longer refused there. Resolving the
 * right thread here + accepting it there together close the stranding bug end to end
 * (companion fixes, external review 2026-07-23).
 *
 * NO MODE GATE, deliberately: unlike a wizard step card, this is not the assistant talking
 * over a human. An admin who has taken the thread over is the very person who just uploaded
 * the PDF, and suppressing the card would hide the download from the applicant.
 *
 * Returns null — never throws — when the shop, the thread or the binding makes the card
 * illegal. By then the document is already committed, so a missing card must degrade to
 * "no card" (the applicant still has the email, and the card appears for the next case),
 * never to a 500 that tells the desk an upload failed when it did not.
 */
export async function sendVisaResultCard(input: {
  applicationId: string
  documentId: string
  reference: string | null | undefined
}): Promise<{ messageId: string } | null> {
  try {
    const shop = await getVisaShopSeller()
    if (!shop?.ownerId) return null
    const senderId = shop.ownerId

    const convo = await resolveVisaResultThread(input.applicationId)
    if (!convo || convo.sellerProfileId !== senderId) return null

    const reference = normalizeVisaReference(input.reference)
    const meta: VisaResultMeta = {
      v: 1,
      applicationId: input.applicationId,
      documentId: input.documentId,
      ...(reference ? { reference } : {}),
    }
    // Body EMPTY like every other card (the realtime-broadcast note in insertMessage); the
    // inbox line is this bilingual composite. It names a case number and nothing else —
    // lastMessageText is a plaintext column both parties' inboxes read.
    const message = await insertMessage(convo, senderId, '', {
      kind: 'visa_result',
      meta,
      preview: `Thị thực điện tử đã sẵn sàng · Your e-Visa is ready${reference ? ` — ${reference}` : ''}`,
    })
    return { messageId: message.id }
  } catch (e) {
    console.error('[visa-result] card refused', e)
    return null
  }
}

export type VisaResultMailOutcome = 'sent' | 'no_address' | 'unavailable' | 'failed'

/**
 * The thank-you email, with the visa attached.
 *
 * Sent exactly once per case because the document row it follows can only be created once
 * (see the header) — not because anything here checks whether it has run before.
 *
 * ⚠️ THE ADDRESS IS DECRYPTED HERE AND GOES NOWHERE ELSE. It is read out of the encrypted
 * payload, handed to sendMail, and dropped. It is not returned, not logged (sendMail masks
 * its own log lines) and not put in the attachment name. `no_address` is reported without
 * quoting what was found.
 *
 * NEVER THROWS. The visa is already stored and already in the chat; a mail outage must be
 * reported to the desk, not raised at them as a failed upload they cannot retry.
 */
export async function sendVisaResultThankYou(input: {
  applicationId: string
  userId: string
  encryptedPayload: string
  reference: string | null | undefined
  pdf: Buffer
}): Promise<VisaResultMailOutcome> {
  try {
    if (!visaCryptoReady()) return 'unavailable'
    const payload = decryptVisaPayload(input.encryptedPayload)
    const address = typeof payload.email === 'string' ? payload.email.trim() : ''
    // Deliberately a shape check, not a validator: the payload schema already validated the
    // address when the applicant gave it, and a stricter rule here would silently drop mail
    // for an address the government accepted.
    if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return 'no_address'

    // The applicant's own language preference, from their profile — the payload has no
    // locale field and guessing one from nationality would be worse than defaulting.
    const profile = await db.profile.findUnique({ where: { id: input.userId }, select: { locale: true } }).catch(() => null)
    const locale = profile?.locale === 'vi' ? 'vi' : 'en'

    const reference = normalizeVisaReference(input.reference)
    const email = renderVisaResultEmail({
      // Given names only. The email module documents why it carries no other field, and
      // this is the one call site that decides what it is handed.
      givenName: typeof payload.givenNames === 'string' && payload.givenNames.trim() ? payload.givenNames.trim() : null,
      reference: reference ?? '',
      origin: (process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').replace(/\/+$/, ''),
      locale,
    })

    const ok = await sendMail({
      to: address,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: [{
        filename: visaResultFilename(reference),
        // BASE64 TEXT, not a Buffer — src/lib/mail.ts documents why a Buffer arrives corrupt.
        content: input.pdf.toString('base64'),
        contentType: 'application/pdf',
      }],
    })
    return ok ? 'sent' : 'failed'
  } catch (e) {
    // No address, no payload contents, no attachment — just the stage that failed.
    console.error('[visa-result] thank-you email failed', (e as Error)?.name)
    return 'failed'
  }
}

/**
 * Undo a committed result upload, so a delivery failure does not spend the one-shot cap.
 *
 * ⚠️ WHY THIS EXISTS. The cap is one upload per case, and the chat card is the applicant's
 * only route to the file. Two external reviewers (GPT-5.6 and Gemini 3.1, 2026-07-23) landed
 * on the same dead end from different directions: commit the row, fail to post the card, and
 * the visa sits in a private bucket its owner cannot open — with the desk's single attempt
 * already used. Rolling back is the only move that keeps BOTH invariants: exactly one
 * DELIVERED result, and never a customer stranded from a document they paid for.
 *
 * ORDER MATTERS: the ROW goes first. While the row exists the partial unique index still
 * blocks a retry, so deleting the object first would leave a live row pointing at nothing —
 * the one state that is worse than either failure alone. Losing the object but keeping the
 * row would be unrecoverable through this route; losing the row but keeping the object is a
 * harmless few hundred KB that the retention sweep collects.
 *
 * Best-effort by necessity (it is already the failure path) but LOUD: a rollback that itself
 * fails is exactly the case a human has to look at, so it says so rather than passing quietly.
 */
export async function undoVisaResultUpload(input: { documentId: string; storagePath: string }): Promise<void> {
  try {
    const { error } = await getVisaDb().from('visa_documents').delete().eq('id', input.documentId)
    if (error) throw error
  } catch (e) {
    // The cap stays spent for this case and only a human can clear it — say so plainly.
    console.error('[visa-result] ROLLBACK FAILED: result row survives an undelivered upload', e)
    return
  }
  try {
    await removeVisaFiles([input.storagePath])
  } catch (e) {
    // The row is gone, so the desk can re-upload; this is a stray object, not a blocked case.
    console.error('[visa-result] rollback left a stored object behind', e)
  }
}
