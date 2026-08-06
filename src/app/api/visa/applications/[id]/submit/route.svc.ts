import { z } from 'zod'
import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { rateLimit } from '@/lib/ratelimit'
import { decryptVisaPayload, visaApplicantSnapshotHash, visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { canonicalVisaListingId } from '@/lib/visa/dm-flow'
import { visaPaymentsConfig } from '@/lib/visa/payments'
import { recordVisaEvent, serializeVisa, type VisaApplicationRow, type VisaDocumentRow } from '@/lib/visa/records'
import { VISA_AUTHORIZATION_VERSION, VISA_DECLARATION_VERSION, validateVisaForReview } from '@/lib/visa/schema'

// In-hub port of apps/forum/src/app/api/visa/applications/[id]/submit/route.ts —
// cookie-session auth, no CORS layer. Every action here reads the payload (cancel's
// serialize included), so the whole route is env-gated on visaCryptoReady().
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send_for_review'), declarationAccepted: z.literal(true), prefillAuthorized: z.literal(true) }),
  z.object({ action: z.literal('approve_for_prefill'), declarationAccepted: z.literal(true), prefillAuthorized: z.literal(true) }),
  z.object({ action: z.literal('cancel') }),
])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ⚠️ WS6 MIGRATION — `auth: 'userId'` AND NOTHING ELSE. THIS IS THE IRREVERSIBLE ONE (it stamps
// the consent hashes and hands a government form to the desk), so the migration is deliberately
// the smallest possible: the auth preamble was `getCurrentProfileId()` + `{error:'auth_required'}`
// 401, which is `auth: 'userId'` exactly, and every other line — the env gate, the limiter, the
// schema, the uuid test, all three CAS updates and every return — is byte-for-byte what it was.
//
// THE OTHER OPTIONS ARE BLOCKED BY ORDER. This route runs auth → 503 env gate → limiter → body →
// uuid, and route()'s fixed order is auth → limiter → body → handler. Hoisting either would put
// it in FRONT of the `visaCryptoReady()` gate, so a host without the key would answer 429
// `rate_limited` (after 20 calls) or 400 `invalid_action` where it answers 503 today.
//
// THE WIRE, ENUMERATED. Guest → 401 `auth_required`; no key → 503
// `visa_encryption_not_configured`; throttled → 429 `rate_limited`; body not one of the three
// actions → 400 `invalid_action`; non-uuid `id` → 404 `not_found`; case absent or not yours → 404
// `not_found`; cancel on a resolved case → 409 `application_locked`; cancel → 200 `{application}`;
// checklist issues → 400 `{error:'application_incomplete',issues}` (an EXTRA field beside `error`,
// which is a second reason no schema hoist could carry this route's 400s); send_for_review from a
// non-editable status → 409 `invalid_status_transition`; no product selected → 409
// `product_not_selected`; payments configured and unpaid → **402** `payment_required_first`;
// either CAS matching zero rows → 409 `application_status_changed`; approve_for_prefill outside
// `applicant_approval` → 409 `invalid_status_transition`; success → 200 `{application}`.
//
// ⚠️ THE TWO CAS UPDATES ARE THE SUBMISSION'S SAFETY PROPERTY AND ARE NOT TOUCHED. Each is one
// awaited statement carrying `.eq('status', app.status).eq('updated_at', app.updated_at)`; route()
// runs strictly before and after this handler and cannot move anything across either of them.
//
// ⚠️ ACCEPTED EXCEPTION, and on this route it is the whole method: there is no try/catch anywhere
// below, so any unhandled throw in this handler used to reach Next's default 500 HTML and now
// answers `{"error":"internal_error"}` 500 with the throw logged. Stated as a shape rather than an
// inventory of causes. No deliberate branch changes, and nothing that WRITES changes at all.
export const POST = route({ auth: 'userId' }, async ({ req, params, userId }) => {
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  const limit = await rateLimit('visa-submit', userId, 20, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const parsed = actionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  const { id } = params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const db = getVisaDb()
  const [{ data: application }, { data: documents }] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', id).eq('user_id', userId).maybeSingle(),
    db.from('visa_documents').select('*').eq('application_id', id),
  ])
  if (!application) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const app = application as VisaApplicationRow
  const docs = (documents || []) as VisaDocumentRow[]
  if (parsed.data.action === 'cancel') {
    if (['approved', 'rejected', 'cancelled'].includes(app.status)) return NextResponse.json({ error: 'application_locked' }, { status: 409 })
    const now = new Date()
    const { data } = await db.from('visa_applications').update({ status: 'cancelled', resolved_at: now.toISOString(), retention_until: new Date(now.getTime() + 30 * 86400_000).toISOString(), updated_at: now.toISOString() }).eq('id', id).select('*').single()
    await recordVisaEvent(id, 'applicant', 'application_cancelled', userId)
    return NextResponse.json({ application: serializeVisa(data as VisaApplicationRow, docs) })
  }
  const payload = decryptVisaPayload(app.encrypted_payload)
  const snapshotHash = visaApplicantSnapshotHash(payload)
  const issues = validateVisaForReview(payload, docs)
  if (issues.length) {
    await db.from('visa_applications').update({ checklist: issues, updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ error: 'application_incomplete', issues }, { status: 400 })
  }
  const now = new Date().toISOString()
  if (parsed.data.action === 'send_for_review') {
    if (!['draft', 'needs_changes'].includes(app.status)) return NextResponse.json({ error: 'invalid_status_transition' }, { status: 409 })
    // No product, no submission — IN BOTH payments modes (Phase 2, external review: the
    // dormant-payments path previously let a product-less case reach the desk, because
    // the only selection gate lived in checkout and checkout never ran). The picker card
    // in the thread is where this state gets fixed, and the client already has copy for
    // this code.
    if (!(await canonicalVisaListingId(id))) {
      return NextResponse.json({ error: 'product_not_selected' }, { status: 409 })
    }
    // Pay-before-admin gate (owner 2026-07-18): with payments configured, the handoff
    // to ready_for_review requires the service fee to be PAID — the normal path is the
    // checkout route + server-side handoff on confirmation, and this direct action only
    // serves ALREADY-paid cases (e.g. consent voided by a post-checkout edit, or a
    // needs_changes resubmit — both already paid). Dormant (no env) keeps today's flow.
    if (visaPaymentsConfig() && !app.paid_at) {
      return NextResponse.json({ error: 'payment_required_first' }, { status: 402 })
    }
    const sfr = await db.from('visa_applications').update({
      status: 'ready_for_review',
      checklist: [],
      applicant_confirmed_at: now,
      applicant_confirmation_version: VISA_DECLARATION_VERSION,
      applicant_snapshot_hash: snapshotHash,
      authorized_at: now,
      authorization_version: VISA_AUTHORIZATION_VERSION,
      authorization_snapshot_hash: snapshotHash,
      last_applicant_action_at: now,
      updated_at: now,
    // CAS on status + updated_at (audit P1 #4): the stamped snapshot hash must
    // describe the payload actually under review — a racing payload PATCH or
    // concurrent transition voids this write instead of being mis-stamped.
    }).eq('id', id).eq('status', app.status).eq('updated_at', app.updated_at).select('*').maybeSingle()
    if (sfr.error) throw sfr.error
    if (!sfr.data) return NextResponse.json({ error: 'application_status_changed' }, { status: 409 })
    const data = sfr.data
    await recordVisaEvent(id, 'applicant', 'sent_for_review', userId, {
      declarationVersion: VISA_DECLARATION_VERSION,
      authorizationVersion: VISA_AUTHORIZATION_VERSION,
      officialPrefillAuthorized: true,
    })
    return NextResponse.json({ application: serializeVisa(data as VisaApplicationRow, docs) })
  }
  if (app.status !== 'applicant_approval') return NextResponse.json({ error: 'invalid_status_transition' }, { status: 409 })
  const approve = await db.from('visa_applications').update({ status: 'ready_to_submit', applicant_confirmed_at: now, applicant_confirmation_version: VISA_DECLARATION_VERSION, applicant_snapshot_hash: snapshotHash, authorized_at: now, authorization_version: VISA_AUTHORIZATION_VERSION, authorization_snapshot_hash: snapshotHash, last_applicant_action_at: now, updated_at: now }).eq('id', id).eq('status', app.status).eq('updated_at', app.updated_at).select('*').maybeSingle()
  if (approve.error) throw approve.error
  if (!approve.data) return NextResponse.json({ error: 'application_status_changed' }, { status: 409 })
  const data = approve.data
  await recordVisaEvent(id, 'applicant', 'prefill_authorized', userId, { declarationVersion: VISA_DECLARATION_VERSION, authorizationVersion: VISA_AUTHORIZATION_VERSION })
  return NextResponse.json({ application: serializeVisa(data as VisaApplicationRow, docs) })
})
