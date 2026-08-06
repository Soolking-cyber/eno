import { z } from 'zod'
import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { rateLimit } from '@/lib/ratelimit'
import { encryptVisaPayload, visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent, serializeVisa, type VisaApplicationRow, type VisaDocumentRow, type VisaEventRow } from '@/lib/visa/records'
import { visaPayloadSchema } from '@/lib/visa/schema'
import { removeVisaFiles } from '@/lib/visa/storage'

// In-hub port of apps/forum/src/app/api/visa/applications/[id]/route.ts — cookie-session
// auth (Profile.id == auth uid == visa_applications.user_id), no CORS layer. GET and
// PATCH serialize/encrypt the payload, so both are env-gated on visaCryptoReady();
// DELETE never touches the ciphertext and stays available regardless.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const updateSchema = z.object({ payload: visaPayloadSchema })

// Non-uuid path segment would 400 at the uuid column, not 404 — pre-empt it (visa-admin idiom).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function load(id: string, userId: string) {
  const db = getVisaDb()
  const [application, documents, events] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', id).eq('user_id', userId).maybeSingle(),
    db.from('visa_documents').select('*').eq('application_id', id).order('created_at'),
    db.from('visa_events').select('*').eq('application_id', id).order('created_at'),
  ])
  if (application.error) throw application.error
  return { application: application.data as VisaApplicationRow | null, documents: (documents.data || []) as VisaDocumentRow[], events: (events.data || []) as VisaEventRow[] }
}

// ⚠️ WS6 MIGRATION — `auth: 'userId'`, which is the preamble verbatim: this route called
// `getCurrentProfileId()` (JWT verified locally, no DB) and answered `{error:'auth_required'}` 401,
// and it only ever needs "who is this" to scope `visa_applications.user_id`. Upgrading it to
// `profile` to look tidier would put a DB read and a presence heartbeat on a polled case view.
//
// THE WIRE, ENUMERATED. Guest → 401 `auth_required`; non-uuid `id` → 404 `not_found`; no
// encryption key → 503 `visa_encryption_not_configured`; case absent or owned by someone else →
// 404 `not_found` (one predicate — `load()` scopes by user_id, so "not yours" and "not there" are
// deliberately the same answer); success → 200 `{application}`; an UNREADABLE payload → still 200,
// payload-free plus `payloadUnreadable:true`. No rate limit and no request body on this method.
//
// ⚠️ ACCEPTED EXCEPTION: `load()` is awaited with no catch, so any unhandled throw in this handler
// moves from Next's default 500 HTML to `{"error":"internal_error"}` 500. Nothing deliberate
// changes — in particular the unreadable-payload branch keeps its 200.
export const GET = route({ auth: 'userId' }, async ({ params, userId }) => {
  const { id } = params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  const loaded = await load(id, userId)
  if (!loaded.application) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  try {
    return NextResponse.json({ application: serializeVisa(loaded.application, loaded.documents, loaded.events) })
  } catch (e) {
    // A forum-era row ciphered under the previous key (prod 2026-07-23): the case still
    // EXISTS — status, documents, deletion all work — it just has no readable answers
    // on this deployment. Payload-free + a flag, never a 500.
    console.error(`[visa] case ${id} payload unreadable — serving it payload-free`, e)
    return NextResponse.json({ application: { ...serializeVisa(loaded.application, loaded.documents, loaded.events, false), payloadUnreadable: true } })
  }
})

// ⚠️ WS6 MIGRATION — `auth: 'userId'` only. THE OTHER THREE OPTIONS ARE BLOCKED BY BYTES:
//
//   · `body:` cannot take `updateSchema`. The 400 here is
//     `{"error":"invalid_visa_payload","issues":[…]}` — an EXTRA FIELD beside `error`, carrying
//     zod's own issue list, which is what draws the per-field errors on the form. `apiFail()` can
//     only emit `{"error":"<code>"}`, so hoisting the schema would delete `issues` from the wire.
//   · `rateLimit:` cannot take the `visa-update` budget: it would run BEFORE the
//     `visaCryptoReady()` gate below, so a host without the key would answer 503 for 120 calls and
//     then 429 instead of 503 forever. Same ordering fact as the sibling routes.
//
// THE WIRE, ENUMERATED. Guest → 401 `auth_required`; no key → 503
// `visa_encryption_not_configured`; throttled → 429 `rate_limited`; unparseable/invalid payload →
// 400 `invalid_visa_payload` + `issues`; non-uuid `id` → 404 `not_found`; case absent or not yours
// → 404 `not_found`; case not in {draft, needs_changes} → 409 `application_locked`; the CAS update
// matching zero rows (it left the editable set between read and write) → 409 `application_locked`;
// success → 200 `{application}`.
//
// ⚠️ THE CAS IS UNTOUCHED AND MUST STAY THAT WAY: the `.eq(...).in('status', […])` on the UPDATE
// is the real guard, and route() moves nothing across it — the whole statement is still one
// awaited call inside this handler.
//
// ⚠️ ACCEPTED EXCEPTION: `if (error) throw error` and the surrounding reads have no catch, so any
// unhandled throw in this handler moves from Next's default 500 HTML to
// `{"error":"internal_error"}` 500.
export const PATCH = route({ auth: 'userId' }, async ({ req, params, userId }) => {
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  const limit = await rateLimit('visa-update', userId, 120, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_visa_payload', issues: parsed.error.issues }, { status: 400 })
  const { id } = params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const loaded = await load(id, userId)
  if (!loaded.application) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!['draft', 'needs_changes'].includes(loaded.application.status)) return NextResponse.json({ error: 'application_locked' }, { status: 409 })
  const now = new Date().toISOString()
  const { data, error } = await getVisaDb().from('visa_applications').update({
    encrypted_payload: encryptVisaPayload(parsed.data.payload), checklist: [], updated_at: now,
    applicant_confirmed_at: null, applicant_confirmation_version: null, authorized_at: null, authorization_version: null,
    applicant_snapshot_hash: null, authorization_snapshot_hash: null,
    last_applicant_action_at: now,
  }).eq('id', id).eq('user_id', userId).in('status', ['draft', 'needs_changes']).select('*').maybeSingle()
  if (error) throw error
  // CAS (audit P1 #4): the JS status pre-check above is not a guard — if the case
  // left the editable states between read and write (admin picked it up, payment
  // handoff fired), the save must MISS, never overwrite an under-review payload
  // and null its consent stamps.
  if (!data) return NextResponse.json({ error: 'application_locked' }, { status: 409 })
  await recordVisaEvent(id, 'applicant', 'answers_saved', userId)
  return NextResponse.json({ application: serializeVisa(data as VisaApplicationRow, loaded.documents) })
})

// Only a PRE-SUBMISSION draft or a dead (cancelled) case is user-deletable — and NEVER a paid one.
// ⚠️ visa_payments.application_id is ON DELETE CASCADE (scripts/visa-payment-setup.mjs), so hard-
// deleting a paid case would DESTROY its financial record. `needs_changes` is intentionally NOT
// here: it only exists AFTER ready_for_review, which requires payment, so it is always paid (both
// external reviewers flagged that listing it contradicts the paid_at guard). Deletion is blocked at
// three layers below (status, the denormalized paid_at, and the source-of-truth paid payment row),
// plus an atomic CAS on the delete. Durable DB-level protection (FK→RESTRICT or a BEFORE-DELETE
// trigger that keys off a PAID payment row — a plain RESTRICT would wrongly block drafts that carry
// an abandoned *unpaid* checkout row) and a soft-delete/archive UX for paid cases are the recommended
// follow-ups both reviewers asked for — see the coordination board.
const DELETABLE_STATUSES = ['draft', 'cancelled']

// ⚠️ WS6 MIGRATION — THE ONE METHOD IN THIS FILE WHERE THE LIMITER ALSO MOVES, and it moves only
// because DELETE has no `visaCryptoReady()` gate (deletion never touches the ciphertext — the
// header above says so). Its order is already auth → limiter → everything else, exactly route()'s
// fixed order, its key is the caller (`userId`, not a composite), its budget is
// `('visa-delete', userId, 10, '24 h', {strict:true})` — which is what `rateLimit:` passes
// verbatim — and its throttled answer is already `{"error":"rate_limited"}` 429. `strict` is kept:
// a limiter outage must not open a hard delete of applicant PII.
//
// THE WIRE, ENUMERATED. Guest → 401 `auth_required`; throttled → 429 `rate_limited`; non-uuid `id`
// → 404 `not_found`; case absent or not yours → 404 `not_found`; status outside
// {draft, cancelled} OR `paid_at` set → 409 `application_not_deletable`; a paid `visa_payments`
// row → 409 `application_not_deletable`; the DB BEFORE-DELETE trigger firing (23001) → 409
// `application_not_deletable`; the CAS delete matching zero rows → 409
// `application_not_deletable`; success → 200 `{deleted:true,id}`; anything the inner try catches →
// 500 `application_delete_failed`. No request body.
//
// ⚠️ THE THREE DELETION GUARDS AND THE CAS ARE UNTOUCHED. route() runs before the handler and
// after it returns; it does not sit between the paid-row probe and the delete.
//
// ⚠️ ACCEPTED EXCEPTION: `load()` and the `visa_payments` probe are awaited BEFORE the try, so an
// unhandled throw there moves from Next's default 500 HTML to `{"error":"internal_error"}` 500 —
// note the inner try's own `application_delete_failed` 500 is unchanged, and it still owns every
// failure from the delete onwards.
export const DELETE = route({ auth: 'userId', rateLimit: { bucket: 'visa-delete', limit: 10, window: '24 h', strict: true } }, async ({ params, userId }) => {
  const { id } = params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const db = getVisaDb()
  const loaded = await load(id, userId)
  if (!loaded.application) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Guard 1+2: pre-submission status, and not paid (the cheap denormalized flag).
  if (!DELETABLE_STATUSES.includes(loaded.application.status) || loaded.application.paid_at) {
    return NextResponse.json({ error: 'application_not_deletable' }, { status: 409 })
  }
  // Guard 3 (source of truth): a captured payment row can exist for a heartbeat while the app's
  // denormalized paid_at is still null (a partial markVisaPaidAndHandoff). Refuse if ANY paid
  // payment references this case, so the cascade can never take a real financial record.
  const paidRow = await db.from('visa_payments').select('id').eq('application_id', id).eq('status', 'paid').limit(1).maybeSingle()
  if (paidRow.error) throw paidRow.error
  if (paidRow.data) return NextResponse.json({ error: 'application_not_deletable' }, { status: 409 })

  try {
    // Delete the ROW first, atomically re-checking status + paid_at (CAS, mirrors PATCH): a case
    // that leaves the deletable set between the read and here (a concurrent submit/payment) is NOT
    // deleted. Files come off only AFTER the row is gone — an orphaned storage object (swept by the
    // visa-retention cron) is far less harmful than deleting a live/paid case's documents, and a
    // post-delete storage error must never report the (committed) delete as failed.
    const { data, error } = await db.from('visa_applications')
      .delete().eq('id', id).eq('user_id', userId).in('status', DELETABLE_STATUSES).is('paid_at', null).select('id')
    if (error) {
      // The DB-level BEFORE DELETE trigger (scripts/visa-delete-guard-trigger.mjs) raises when a PAID
      // visa_payments row exists — the ATOMIC backstop for the race where a payment commits between
      // the pre-check above and this delete. Surface it as the same friendly 409, not a 500.
      if (error.code === '23001' && /visa_application_has_paid_payment/.test(error.message ?? '')) {
        return NextResponse.json({ error: 'application_not_deletable' }, { status: 409 })
      }
      throw error
    }
    if (!data || data.length === 0) return NextResponse.json({ error: 'application_not_deletable' }, { status: 409 })
    try {
      await removeVisaFiles(loaded.documents.map((document) => document.storage_path), { strict: false })
    } catch (e) {
      console.error(`[visa] files orphaned after deleting case ${id} — retention cron will sweep`, e)
    }
    return NextResponse.json({ deleted: true, id })
  } catch {
    return NextResponse.json({ error: 'application_delete_failed' }, { status: 500 })
  }
})
