import { z } from 'zod'
import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { rateLimit } from '@/lib/ratelimit'
import { decryptVisaPayload, encryptVisaPayload, visaApplicantSnapshotHash, visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { canonicalVisaListingId } from '@/lib/visa/dm-flow'
import { IS_SERVICES } from '@/lib/edition'
import { visaCaseOnLocalDesk } from '@/lib/visa-admin'
import { recordVisaEvent, serializeVisa, type VisaApplicationRow, type VisaDocumentRow } from '@/lib/visa/records'
import { VISA_AUTHORIZATION_VERSION, VISA_DECLARATION_VERSION, validateVisaForReview, visaDateDefaultsForStart } from '@/lib/visa/schema'
import { VISA_QUICK_DECLARATION_VERSION, validateVisaQuickSubmit } from '@/lib/visa/dm-steps'

// In-hub port of apps/forum/src/app/api/visa/applications/[id]/submit/route.ts —
// cookie-session auth, no CORS layer. Every action here reads the payload (cancel's
// serialize included), so the whole route is env-gated on visaCryptoReady().
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const actionSchema = z.discriminatedUnion('action', [
  // `intendedEntryDate` — the eno.forum quick flow's one answer, picked on the send-to-desk card.
  z.object({ action: z.literal('send_for_review'), declarationAccepted: z.literal(true), prefillAuthorized: z.literal(true), intendedEntryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
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
  /**
   * ⛔ THE eno.forum QUICK FLOW (owner, 2026-09-13): "user only uploads images picks entry date and
   * submits then admin will resolve payment through chat". On the services edition `send_for_review`
   * takes the entry date, derives the 90-day window from it, and requires ONLY the documents and that
   * window; the desk collects the rest in chat and files with the government off-system (owner's pick).
   * The full validator still guards `approve_for_prefill` below — nothing is authorised for the
   * hosted prefill on a quick case's partial answers.
   */
  // ⚠️ NOT for a case already PAID through the old checkout: that applicant answered every step, and a
  // needs_changes resubmit must keep its full declaration and prefill authorisation (a reviewer's catch).
  const quick = IS_SERVICES && parsed.data.action === 'send_for_review' && !app.paid_at
  let payload = decryptVisaPayload(app.encrypted_payload)
  let payloadChanged = false
  if (quick && parsed.data.action === 'send_for_review' && parsed.data.intendedEntryDate) {
    const date = parsed.data.intendedEntryDate
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10) // Vietnam date
    if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || date < today) {
      return NextResponse.json({ error: 'entry_date_invalid' }, { status: 400 })
    }
    payload = { ...payload, ...visaDateDefaultsForStart(date) }
    payloadChanged = true
  }
  const snapshotHash = visaApplicantSnapshotHash(payload)
  const issues = quick ? validateVisaQuickSubmit(payload, docs) : validateVisaForReview(payload, docs)
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
    /**
     * ⛔ `IS_SERVICES &&` — WITHOUT IT THIS 402s ON eno.vn TODAY, AND THE MEASUREMENT IS WHY IT IS
     * HERE RATHER THAN LEFT TO ENV HYGIENE.
     *
     * The gate asks "is this case paid?" only when payments are configured. That reads as "only
     * where we charge" — but `visaPaymentsConfig()` is a pure env check, and eno.vn's deployed
     * secret was measured on 2026-08-14 carrying `VISA_SERVICE_FEE_USD=25` plus live PAYPAL_*
     * values, inherited from when one deployment did everything. So on the licensed marketplace —
     * which cannot charge at all, whose checkout route is `.forum.svc.` and does not exist — this
     * would have refused every handoff with `payment_required_first`, and the "Send to the desk"
     * button that finishes the partner flow would fail on its only action.
     *
     * The edition is the honest question: eno.forum charges and must keep the pay-before-review
     * gate exactly as it is; eno.vn intermediates and takes no money, so a fee it never asked for
     * cannot block a submission. Fixing it here rather than by deleting env vars means it stays
     * correct even if those variables come back — and they are shared with a deployment that needs
     * them.
     */
    /**
     * ⛔ TWO REFUSALS, NOT ONE — AND THE MISSING SECOND ONE WAS A PAYMENT BYPASS THAT TWO REVIEWERS
     * FOUND. Guarding only `IS_SERVICES && visaPaymentsConfig() && !paid_at` means that when
     * eno.forum LOSES its payment env, `visaPaymentsConfig()` is null, the whole condition is false,
     * and an unpaid `send_for_review` is ACCEPTED into the operator queue. The guard I added to keep
     * eno.vn working had quietly re-opened the hole on the deployment that charges — the same
     * fail-open shape, moved one clause to the left.
     *
     * On a services build, "payments are not configured" is a BROKEN deployment, never a free pass:
     * it refuses outright. On the marketplace, which takes no money and whose checkout route does
     * not exist, neither refusal applies and the handoff proceeds.
     */
    // ⛔ NO PAYMENT GATE ON eno.forum ANY MORE — the desk takes payment in chat (owner, 2026-09-13).
    // Free submissions cost the desk's time and hold passport images, so an account may have only a
    // few cases waiting with the desk at once.
    if (IS_SERVICES && !app.paid_at) {
      // Counts the account's OTHER unpaid cases the desk has touched in the last 30 days — never this one,
      // and never stale ones, so an old abandoned case cannot lock a user out for good.
      const { count: open, error: openError } = await db.from('visa_applications').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).is('paid_at', null).neq('id', id)
        .in('status', ['ready_for_review', 'under_review', 'applicant_approval', 'ready_to_submit'])
        .gte('updated_at', new Date(Date.now() - 30 * 86400_000).toISOString())
      // A failed count is not a pass: the cap is the only brake on free submissions now.
      if (openError) throw openError
      if ((open ?? 0) >= 3) return NextResponse.json({ error: 'too_many_open_cases' }, { status: 429 })
    }
    /**
     * ⛔ AND THE FEE-FREE PATH IS ONLY FOR *THIS* DEPLOYMENT'S OWN DESK — closing a cross-edition
     * bypass. The two gates above are edition-local while the DATA is shared: eno.vn and eno.forum
     * read one `visa_applications` table with one auth system. So "this deployment does not charge"
     * must not become "any case reachable from this deployment does not have to pay". A case opened
     * on eno.forum, which does charge and is unpaid, would otherwise be handed to the desk from
     * eno.vn — the forum's own pay-before-review gate defeated through the other edition.
     * ⚠️ It happens to be unreachable today because the hidden desk makes eno.vn 404 that thread —
     * but that is a LICENSING control in another module doing an authorisation job by accident, and
     * one env edit from stopping. The rule lives with the money decision instead.
     */
    if (!IS_SERVICES && !(await visaCaseOnLocalDesk(id))) {
      return NextResponse.json({ error: 'payment_required_first' }, { status: 402 })
    }
    const sfr = await db.from('visa_applications').update({
      status: 'ready_for_review',
      checklist: [],
      ...(payloadChanged ? { encrypted_payload: encryptVisaPayload(payload) } : {}),
      applicant_confirmed_at: now,
      // A quick case's applicant vouched for their images and date only — record THAT text's version.
      applicant_confirmation_version: quick ? VISA_QUICK_DECLARATION_VERSION : VISA_DECLARATION_VERSION,
      applicant_snapshot_hash: snapshotHash,
      // A quick case authorises NO hosted prefill: its answers are partial and the desk files off-system.
      authorized_at: quick ? null : now,
      authorization_version: quick ? null : VISA_AUTHORIZATION_VERSION,
      authorization_snapshot_hash: quick ? null : snapshotHash,
      last_applicant_action_at: now,
      updated_at: now,
    // CAS on status + updated_at (audit P1 #4): the stamped snapshot hash must
    // describe the payload actually under review — a racing payload PATCH or
    // concurrent transition voids this write instead of being mis-stamped.
    }).eq('id', id).eq('status', app.status).eq('updated_at', app.updated_at).select('*').maybeSingle()
    if (sfr.error) throw sfr.error
    if (!sfr.data) return NextResponse.json({ error: 'application_status_changed' }, { status: 409 })
    const data = sfr.data
    await recordVisaEvent(id, 'applicant', 'sent_for_review', userId, quick
      ? { declarationVersion: VISA_QUICK_DECLARATION_VERSION, quickFlow: true, officialPrefillAuthorized: false }
      : {
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
