import 'server-only'
import { decryptVisaPayload } from '@/lib/visa/crypto'

export type VisaApplicationRow = {
  id: string; user_id: string; status: string; encrypted_payload: string; checklist: string[] | null
  applicant_confirmation_version: string | null; applicant_confirmed_at: string | null
  applicant_snapshot_hash: string | null; authorization_version: string | null; authorized_at: string | null
  authorization_snapshot_hash: string | null; assigned_admin: string | null
  submitted_at: string | null; resolved_at: string | null; retention_until: string | null
  // Service-fee stamp written by eno.vn's payment path (shared tables; columns added by
  // eno.vn scripts/visa-payment-setup.mjs). Optional: absent from rows predating it.
  paid_at?: string | null; payment_provider?: string | null; payment_ref?: string | null
  created_at: string; updated_at: string
}
export type VisaDocumentRow = {
  id: string; application_id: string; kind: string; storage_path: string; mime_type: string; size_bytes: number
  width: number | null; height: number | null; sha256: string
  validation_status: 'pending' | 'passed' | 'failed' | 'unavailable'
  validation_report: Record<string, unknown> | null
  created_at: string
}
export type VisaEventRow = { id: string; application_id: string; actor_type: string; actor_ref: string | null; event: string; metadata: Record<string, unknown>; created_at: string }

export function serializeVisa(application: VisaApplicationRow, documents: VisaDocumentRow[], events?: VisaEventRow[], includePayload = true) {
  return {
    id: application.id, status: application.status,
    payload: includePayload ? decryptVisaPayload(application.encrypted_payload) : undefined,
    checklist: Array.isArray(application.checklist) ? application.checklist : [],
    applicantConfirmedAt: application.applicant_confirmed_at, authorizedAt: application.authorized_at,
    assignedAdmin: application.assigned_admin, submittedAt: application.submitted_at, resolvedAt: application.resolved_at,
    createdAt: application.created_at, updatedAt: application.updated_at,
    documents: documents.map(({ storage_path: _storage, sha256: _hash, application_id: _application, ...document }) => ({
      id: document.id, kind: document.kind, mimeType: document.mime_type, sizeBytes: document.size_bytes,
      width: document.width, height: document.height, validationStatus: document.validation_status,
      validationReport: document.validation_report || {}, createdAt: document.created_at,
    })),
    events: events?.map((event) => ({ id: event.id, actorType: event.actor_type, event: event.event, metadata: event.metadata || {}, createdAt: event.created_at })),
  }
}

export async function recordVisaEvent(applicationId: string, actorType: 'applicant' | 'admin' | 'system', event: string, actorRef?: string, metadata: Record<string, unknown> = {}) {
  const { getVisaDb } = await import('@/lib/visa/db')
  const { error } = await getVisaDb().from('visa_events').insert({ id: crypto.randomUUID(), application_id: applicationId, actor_type: actorType, actor_ref: actorRef || null, event, metadata })
  if (error) throw new Error(`visa_event_failed:${error.message}`)
}
