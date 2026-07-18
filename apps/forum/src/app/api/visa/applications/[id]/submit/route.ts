import { z } from 'zod'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { rateLimit } from '@/lib/ratelimit'
import { getVisaUser } from '@/lib/visa/auth'
import { decryptVisaPayload, visaApplicantSnapshotHash } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent, serializeVisa, type VisaApplicationRow, type VisaDocumentRow } from '@/lib/visa/records'
import { VISA_AUTHORIZATION_VERSION, VISA_DECLARATION_VERSION, validateVisaForReview } from '@/lib/visa/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const METHODS = 'POST, OPTIONS'
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send_for_review'), declarationAccepted: z.literal(true), prefillAuthorized: z.literal(true) }),
  z.object({ action: z.literal('approve_for_prefill'), declarationAccepted: z.literal(true), prefillAuthorized: z.literal(true) }),
  z.object({ action: z.literal('cancel') }),
])
export function OPTIONS(request: Request) { return forumPreflight(request, METHODS) }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, METHODS)
  const user = await getVisaUser(request)
  if (!user) return forumJson(request, { error: 'auth_required' }, { status: 401 }, METHODS)
  const limit = await rateLimit('visa-submit', user.id, 20, '1 h', { strict: true })
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 }, METHODS)
  const parsed = actionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return forumJson(request, { error: 'invalid_action' }, { status: 400 }, METHODS)
  const { id } = await params
  const db = getVisaDb()
  const [{ data: application }, { data: documents }] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', id).eq('user_id', user.id).maybeSingle(),
    db.from('visa_documents').select('*').eq('application_id', id),
  ])
  if (!application) return forumJson(request, { error: 'not_found' }, { status: 404 }, METHODS)
  const app = application as VisaApplicationRow
  const docs = (documents || []) as VisaDocumentRow[]
  if (parsed.data.action === 'cancel') {
    if (['approved', 'rejected', 'cancelled'].includes(app.status)) return forumJson(request, { error: 'application_locked' }, { status: 409 }, METHODS)
    const now = new Date()
    const { data } = await db.from('visa_applications').update({ status: 'cancelled', resolved_at: now.toISOString(), retention_until: new Date(now.getTime() + 30 * 86400_000).toISOString(), updated_at: now.toISOString() }).eq('id', id).select('*').single()
    await recordVisaEvent(id, 'applicant', 'application_cancelled', user.id)
    return forumJson(request, { application: serializeVisa(data as VisaApplicationRow, docs) }, undefined, METHODS)
  }
  const payload = decryptVisaPayload(app.encrypted_payload)
  const snapshotHash = visaApplicantSnapshotHash(payload)
  const issues = validateVisaForReview(payload, docs)
  if (issues.length) {
    await db.from('visa_applications').update({ checklist: issues, updated_at: new Date().toISOString() }).eq('id', id)
    return forumJson(request, { error: 'application_incomplete', issues }, { status: 400 }, METHODS)
  }
  const now = new Date().toISOString()
  if (parsed.data.action === 'send_for_review') {
    if (!['draft', 'needs_changes'].includes(app.status)) return forumJson(request, { error: 'invalid_status_transition' }, { status: 409 }, METHODS)
    // Pay-before-review gate — MIRROR of eno.vn's (the visa tables are shared, so an
    // ungated submit HERE would bypass the fee entirely; caught in review 2026-07-18).
    // The forum never runs checkout: the gate keys on VISA_SERVICE_FEE_USD alone and
    // 402s toward eno.vn, where payment + the server-completed handoff live. ⚠️ The
    // owner must set VISA_SERVICE_FEE_USD on BOTH Vercel projects when activating.
    const fee = Number.parseFloat(process.env.VISA_SERVICE_FEE_USD || '')
    if (Number.isFinite(fee) && fee > 0 && !app.paid_at) {
      return forumJson(request, { error: 'payment_required_first' }, { status: 402 }, METHODS)
    }
    const { data, error } = await db.from('visa_applications').update({
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
    // describe the payload actually under review — a racing payload PATCH voids
    // this transition instead of being silently mis-stamped.
    }).eq('id', id).eq('status', app.status).eq('updated_at', app.updated_at).select('*').maybeSingle()
    if (error) throw error
    if (!data) return forumJson(request, { error: 'application_status_changed' }, { status: 409 }, METHODS)
    await recordVisaEvent(id, 'applicant', 'sent_for_review', user.id, {
      declarationVersion: VISA_DECLARATION_VERSION,
      authorizationVersion: VISA_AUTHORIZATION_VERSION,
      officialPrefillAuthorized: true,
    })
    return forumJson(request, { application: serializeVisa(data as VisaApplicationRow, docs) }, undefined, METHODS)
  }
  if (app.status !== 'applicant_approval') return forumJson(request, { error: 'invalid_status_transition' }, { status: 409 }, METHODS)
  const approve = await db.from('visa_applications').update({ status: 'ready_to_submit', applicant_confirmed_at: now, applicant_confirmation_version: VISA_DECLARATION_VERSION, applicant_snapshot_hash: snapshotHash, authorized_at: now, authorization_version: VISA_AUTHORIZATION_VERSION, authorization_snapshot_hash: snapshotHash, last_applicant_action_at: now, updated_at: now }).eq('id', id).eq('status', app.status).eq('updated_at', app.updated_at).select('*').maybeSingle()
  if (approve.error) throw approve.error
  if (!approve.data) return forumJson(request, { error: 'application_status_changed' }, { status: 409 }, METHODS)
  const data = approve.data
  await recordVisaEvent(id, 'applicant', 'prefill_authorized', user.id, { declarationVersion: VISA_DECLARATION_VERSION, authorizationVersion: VISA_AUTHORIZATION_VERSION })
  return forumJson(request, { application: serializeVisa(data as VisaApplicationRow, docs) }, undefined, METHODS)
}
