import { NextResponse } from 'next/server'
import { getAdmin } from '@/lib/admin'
import { getVisaDeskScope } from '@/lib/desk-operator'
import { rateLimit } from '@/lib/ratelimit'
import { loadVisaAdminCase, VISA_BUCKET, type VisaDocumentRow } from '@/lib/visa-admin'
import { decryptVisaPayload, visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { VISA_DM_PRODUCT_EVENT } from '@/lib/visa/dm-flow'
import { recordVisaEvent } from '@/lib/visa/records'
import { buildVisaHandoverBundle, type VisaBundleDocument } from '@/lib/visa/bundle'

// THE HANDOVER DOWNLOAD — one zip per case, forwarded to the agent who files it.
//
// The owner: "admin should receive as full info ready to download as folder inside 2
// images and an excel file with information about applicant. we will send it further to
// agents to apply for us." This route is the only way that pack exists; src/lib/visa/bundle.ts
// assembles it and explains the file format choices.
//
// ⚠️ THE MOST CONCENTRATED PII SURFACE IN THE APP. Five properties make it safe, and each
// one is a line you can point at below:
//
//  0. THE ENTITLEMENT MODEL, STATED (external review, GPT-5.6 2026-07-22, which correctly
//     refused to accept it as implicit): ANY account in ADMIN_EMAILS may export ANY case's
//     dossier. There is no per-case assignment, no visa-operator sub-role, and no status
//     predicate — loadVisaAdminCase selects by case id alone, through a service-role client.
//     That is DELIBERATE and matches the business: eno's desk is one operator that files
//     every application, and ADMIN_EMAILS currently resolves to a single support account.
//     ⚠️ It also means the blast radius of adding an address to ADMIN_EMAILS includes every
//     applicant's passport. If the desk ever grows past people who are all trusted with that,
//     this route needs its own allowlist (a VISA_ADMIN_EMAILS already exists as a concept on
//     the forum side) or a per-case assignment — do not let it grow by accident.
//  1. ADMIN ONLY. getAdmin() re-verifies the session with the auth server and matches it
//     against ADMIN_EMAILS — the same gate as the takeover route, and the documented
//     exception to the getClaims() fast path (a revoked admin must lose this immediately,
//     not at token expiry). NOTHING is read before it passes: the case load, the decrypt
//     and the storage reads all sit after the refusal, so a non-admin request touches no
//     applicant data at all. bundle.test.ts asserts exactly that, so deleting the gate
//     turns the suite red rather than quietly opening the dossier.
//  2. NOTHING IS WRITTEN DOWN. The pack is assembled in memory and handed to the response;
//     there is no temp file, no cache entry, no `revalidate`, and `no-store` on EVERY way out —
//     the success bytes and every refusal alike (see `refuse` below; an external review found
//     the refusals bare, and a cacheable 404 on this URL outlives the case it denied).
//  3. THE IMAGES ARE FETCHED SERVER-SIDE. The client never receives a signed (or any) URL
//     to a passport photo — only the bytes inside the archive it asked for.
//  4. EVERY DOWNLOAD IS AUDITED, and the audit is written BEFORE the bytes leave. If the
//     audit insert fails the download is REFUSED (503) — an unlogged export of a decrypted
//     passport dossier is precisely what an audit trail exists to prevent, and the desk
//     can simply click again. This is a deliberate departure from the best-effort,
//     after-the-fact event writes elsewhere in the visa admin surface.
//  5. NO APPLICANT VALUE IN ANY LOG, ERROR OR FILENAME. Errors answer with a fixed code;
//     the only thing logged is a stage name and a document KIND.
//
// A MISSING DOCUMENT IS NOT AN ERROR. If a photo was never uploaded, or storage cannot
// produce it, the pack still builds and says so in the sheet and the README — a
// half-complete case is exactly when the desk needs to look at one.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The pack's two images come out of our own normalization pipeline (~a few hundred KB).
 *  Anything wildly bigger is a broken row, not a photo — skip it rather than stream it. */
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
const PACK_KINDS = new Set(['passport', 'portrait'])

/** Pull one document's bytes out of the private bucket. Fail-soft: null degrades the pack
 *  into "this file is missing", never into a 500. */
async function fetchDocument(row: VisaDocumentRow): Promise<VisaBundleDocument> {
  const base = { kind: row.kind, mimeType: row.mime_type }
  if (row.size_bytes > MAX_DOCUMENT_BYTES) return { ...base, bytes: null }
  try {
    const { data, error } = await getVisaDb().storage.from(VISA_BUCKET).download(row.storage_path)
    if (error || !data) throw new Error('download_failed')
    const bytes = new Uint8Array(await data.arrayBuffer())
    // ⚠️ RE-CHECK THE ACTUAL BYTES. The guard above trusts visa_documents.size_bytes, which is
    // a row written at upload time — an external reviewer (GPT-5.6, 2026-07-22) pointed out
    // that a wrong or stale row therefore lets an arbitrarily large object into an IN-MEMORY
    // zip. The database says how big it should be; only the download says how big it is.
    if (bytes.length > MAX_DOCUMENT_BYTES) {
      console.error('[visa-bundle] document larger than the row claimed', row.kind)
      return { ...base, bytes: null }
    }
    return { ...base, bytes: bytes.length ? bytes : null }
  } catch {
    // Kind only — the storage path identifies an account and a case, and neither belongs
    // in a log line for a file that simply did not come back.
    console.error('[visa-bundle] document unavailable', row.kind)
    return { ...base, bytes: null }
  }
}

/**
 * Every refusal, with no-store.
 *
 * ⚠️ An external reviewer (GPT-5.6, 2026-07-22) refuted the file's own claim that this route
 * carries "no-store on the way out": only the SUCCESS response set the header, while 403 /
 * 404 / 429 / 500 / 503 all went out bare. A 404 is HEURISTICALLY CACHEABLE under HTTP even
 * with no explicit freshness — so an intermediary could cache "this case does not exist" for
 * the URL and keep serving it after the case became downloadable. That is an availability
 * failure on the desk's handover path, and the fix is one helper rather than five edits.
 */
const refuse = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } })

// ⚠️ WS6 — NOT MIGRATED: `auth: 'admin'` ANSWERS A DIFFERENT BYTE. This route refuses a non-admin
// with `{"error":"forbidden"}` — lowercase f — while the wrapper's admin branch is hardcoded to
// `apiFail('Forbidden', 403)`, capital F (handler.ts:189, and errors.ts keeps both spellings
// precisely because both are live on the wire). Same status, one changed character, on the gate
// guarding the most concentrated PII surface in the app.
//
// Independently blocking, either one on its own:
//   · `refuse()` attaches `Cache-Control: no-store, max-age=0, must-revalidate` to EVERY refusal —
//     403, 404, 429, 500, 503. That header is not cosmetic here: an external review found the
//     refusals bare and the header was added because a heuristically-cached 404 on this URL keeps
//     denying the desk after the case becomes downloadable. `apiFail()` sets no headers.
//   · `rateLimit:` is keyed on the ADMIN EMAIL (`rateLimit('visa-admin-bundle', admin, …)`), which
//     the wrapper cannot produce — `auth:'admin'` leaves `userId` null, so it would key on
//     `clientIp(req)` and pool the whole desk behind one office IP.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // ⚠️ THE VISA DESK'S OPERATOR, NOT A SITE ADMIN. This was getAdmin(), which on eno.vn would have
  // required putting VietKite into ADMIN_EMAILS to let them do the job they are paid for — filing
  // the visas they sell — and that grants every dispute room, every report and every OTHER
  // applicant's documents along with it. getVisaDeskOperator() still accepts an admin, so eno's own
  // support account is unaffected; it also accepts the account that owns THIS deployment's visa
  // storefront, and only that desk. See src/lib/desk-operator.ts.
  // ⛔ ENTITLEMENT IS NOT AUTHORISATION. getVisaDeskOperator() proves this session runs A visa desk;
  // it says nothing about WHICH cases are that desk's, and eno.vn and eno.forum share one
  // `visa_applications` table. Without the scope check below, a partner desk could name any uuid.
  const scope = await getVisaDeskScope()
  if (!scope) return refuse('forbidden', 403)
  const admin = scope.operator
  // Fails OPEN (no `strict`), like the takeover route: the caller is already an admin, so a
  // limiter outage must not lock the desk out of its own queue. The cap is here because
  // each call decrypts a dossier and pulls two images — worth a ceiling per operator.
  const limit = await rateLimit('visa-admin-bundle', admin, 120, '1 h')
  if (!limit.success) return refuse('rate_limited', 429)

  const { id } = await params
  if (!UUID_RE.test(id)) return refuse('not_found', 404)
  // The pack IS the decrypted answers; without the key there is nothing honest to build.
  if (!visaCryptoReady()) return refuse('visa_encryption_not_configured', 503)

  try {
    const loaded = await loadVisaAdminCase(id, scope)
    if (loaded.state === 'not-found') return refuse('not_found', 404)
    if (loaded.state === 'unavailable') return refuse('visa_database_not_configured', 503)
    const { application, documents, events } = loaded

    let payload
    try {
      payload = decryptVisaPayload(application.encrypted_payload)
    } catch {
      // Never echo the crypto error: its message can carry envelope internals.
      console.error('[visa-bundle] payload could not be decrypted')
      return refuse('visa_payload_unreadable', 500)
    }

    // The sold pair, from the chat's own product event (newest wins, id as the tiebreak —
    // the getVisaThreadMode ordering). Read off the events we already loaded rather than
    // re-querying, and absent ⇒ the sheet falls back to the applicant's answer.
    const product = [...events]
      .filter((event) => event.event === VISA_DM_PRODUCT_EVENT)
      .sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at)))
      .at(-1)?.metadata ?? null

    const packDocuments = await Promise.all(
      documents.filter((row) => PACK_KINDS.has(row.kind)).map(fetchDocument),
    )
    // Kinds the case holds but the pack does not carry (result PDFs, supporting files) are
    // still NAMED in the sheet, so the agent knows the case has more on it.
    const otherKinds: VisaBundleDocument[] = documents
      .filter((row) => !PACK_KINDS.has(row.kind))
      .map((row) => ({ kind: row.kind, mimeType: row.mime_type, bytes: null }))

    const bundle = buildVisaHandoverBundle({
      applicationId: application.id,
      // The pack is named by the READABLE reference (eno-visa-EV-1042), not a uuid slice —
      // the desk handles several at once and reads these numbers out loud.
      reference: application.reference,
      status: application.status,
      payload,
      documents: [...packDocuments, ...otherKinds],
      product: product as { entryType?: unknown; speed?: unknown } | null,
      createdAt: application.created_at,
      submittedAt: application.submitted_at,
      paidAt: application.paid_at,
      paymentProvider: application.payment_provider,
      generatedAt: new Date(),
    })

    // ⚠️ AUDIT BEFORE DELIVERY — see property 4 in the header. Metadata is counts and
    // kinds; no applicant value, ever.
    try {
      await recordVisaEvent(application.id, 'admin', 'admin_handover_downloaded', admin, {
        files: bundle.entries.length,
        missing: bundle.missing.map((item) => `${item.kind}:${item.reason}`),
      })
    } catch {
      console.error('[visa-bundle] audit write failed — download refused')
      return refuse('audit_unavailable', 503)
    }

    return new Response(bundle.bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        // ASCII-safe by construction (case reference + date), so no RFC 5987 encoding and
        // nothing about the applicant in the name the browser saves.
        'Content-Disposition': `attachment; filename="${bundle.filename}"`,
        'Content-Length': String(bundle.bytes.length),
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    console.error('[visa-bundle] pack could not be assembled')
    return refuse('bundle_failed', 500)
  }
}
