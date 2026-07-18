import { z } from 'zod'
import { getVisaAdmin } from '@/lib/visa/auth'
import { decryptVisaPayload, encryptVisaPayload } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent, serializeVisa, type VisaApplicationRow, type VisaDocumentRow, type VisaEventRow } from '@/lib/visa/records'
import { visaStatuses } from '@/lib/visa/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({
  status: z.enum(visaStatuses).optional(), applicantMessage: z.string().trim().max(1200).optional(),
  governmentRegistrationCode: z.string().trim().max(160).optional(), governmentApplicationStatus: z.string().trim().max(160).optional(),
})
const transitions: Record<string, string[]> = {
  draft: ['cancelled'], ready_for_review: ['under_review', 'needs_changes', 'applicant_approval', 'cancelled'],
  under_review: ['needs_changes', 'applicant_approval', 'cancelled'], needs_changes: ['under_review', 'cancelled'],
  applicant_approval: ['under_review', 'needs_changes', 'cancelled'], ready_to_submit: ['applicant_approval', 'submitted', 'payment_required', 'processing', 'needs_changes', 'cancelled'],
  submitted: ['payment_required', 'processing', 'needs_changes', 'rejected', 'cancelled'], payment_required: ['submitted', 'processing', 'rejected', 'cancelled'],
  processing: ['approved', 'rejected', 'needs_changes', 'cancelled'], approved: [], rejected: [], cancelled: [],
}

async function load(id: string) {
  const db = getVisaDb()
  const [app, docs, events] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', id).maybeSingle(),
    db.from('visa_documents').select('*').eq('application_id', id).order('created_at'),
    db.from('visa_events').select('*').eq('application_id', id).order('created_at'),
  ])
  return { application: app.data as VisaApplicationRow | null, documents: (docs.data || []) as VisaDocumentRow[], events: (events.data || []) as VisaEventRow[] }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getVisaAdmin()
  if (!admin) return Response.json({ error: 'admin_required' }, { status: 403 })
  const { id } = await params
  const loaded = await load(id)
  if (!loaded.application) return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json({ application: serializeVisa(loaded.application, loaded.documents, loaded.events) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getVisaAdmin()
  if (!admin) return Response.json({ error: 'admin_required' }, { status: 403 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'invalid_update' }, { status: 400 })
  const { id } = await params
  const loaded = await load(id)
  if (!loaded.application) return Response.json({ error: 'not_found' }, { status: 404 })
  const app = loaded.application
  const next = parsed.data.status || app.status
  if (next !== app.status && !(transitions[app.status] || []).includes(next)) return Response.json({ error: 'invalid_status_transition' }, { status: 409 })
  if (next === 'approved' && !loaded.documents.some((item) => item.kind === 'result')) return Response.json({ error: 'result_document_required' }, { status: 409 })
  const payload = decryptVisaPayload(app.encrypted_payload)
  if (parsed.data.applicantMessage !== undefined) payload.adminMessage = parsed.data.applicantMessage
  if (parsed.data.governmentRegistrationCode !== undefined) payload.governmentRegistrationCode = parsed.data.governmentRegistrationCode
  if (parsed.data.governmentApplicationStatus !== undefined) payload.governmentApplicationStatus = parsed.data.governmentApplicationStatus
  const now = new Date()
  const final = ['approved', 'rejected', 'cancelled'].includes(next)
  const authorizationRefresh = next === 'applicant_approval' && app.status === 'ready_to_submit'
  const { data, error } = await getVisaDb().from('visa_applications').update({
    status: next, encrypted_payload: encryptVisaPayload(payload), assigned_admin: app.assigned_admin || admin,
    authorized_at: authorizationRefresh ? null : app.authorized_at,
    authorization_version: authorizationRefresh ? null : app.authorization_version,
    authorization_snapshot_hash: authorizationRefresh ? null : app.authorization_snapshot_hash,
    submitted_at: next === 'submitted' && !app.submitted_at ? now.toISOString() : app.submitted_at,
    resolved_at: final ? now.toISOString() : null, retention_until: final ? new Date(now.getTime() + 90 * 86400_000).toISOString() : app.retention_until,
    updated_at: now.toISOString(),
  // CAS on status AND updated_at (audit P1 #4): this update RE-ENCRYPTS a payload
  // decrypted from the read above — without the guard, a concurrent applicant PATCH
  // (or another admin) lands between read and write and is silently clobbered, and
  // the write can complete a transition that was validated against a stale status.
  }).eq('id', id).eq('status', app.status).eq('updated_at', app.updated_at).select('*').maybeSingle()
  if (error) throw error
  if (!data) return Response.json({ error: 'case_changed_reload' }, { status: 409 })
  await recordVisaEvent(id, 'admin', next === app.status ? 'case_details_updated' : 'status_changed', admin, next === app.status ? {} : { from: app.status, to: next })
  return Response.json({ application: serializeVisa(data as VisaApplicationRow, loaded.documents, loaded.events) }, { headers: { 'Cache-Control': 'no-store' } })
}
