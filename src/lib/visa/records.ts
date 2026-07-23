import 'server-only'
import { decryptVisaPayload } from '@/lib/visa/crypto'
// Row shapes are already declared (verbatim from the forum) by the admin data layer —
// reuse them instead of a third copy.
import type { VisaApplicationRow, VisaDocumentRow, VisaEventRow } from '@/lib/visa-admin'

export type { VisaApplicationRow, VisaDocumentRow, VisaEventRow }

// Ported from apps/forum/src/lib/visa/records.ts — the applicant-facing serializer.
// ⚠️ serializeVisa with includePayload=true DECRYPTS: callers must gate on
// visaCryptoReady() first (env-absent hosts answer 503, never a crypto throw).
export function serializeVisa(application: VisaApplicationRow, documents: VisaDocumentRow[], events?: VisaEventRow[], includePayload = true) {
  return {
    id: application.id, status: application.status,
    payload: includePayload ? decryptVisaPayload(application.encrypted_payload) : undefined,
    checklist: Array.isArray(application.checklist) ? application.checklist : [],
    applicantConfirmedAt: application.applicant_confirmed_at, authorizedAt: application.authorized_at,
    assignedAdmin: application.assigned_admin, submittedAt: application.submitted_at, resolvedAt: application.resolved_at,
    // Rows created before the payment columns shipped read undefined via PostgREST — coerce to null.
    paidAt: application.paid_at ?? null, paymentProvider: application.payment_provider ?? null,
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

/**
 * Does this user hold ANY e-Visa case? Cheap head-only count (no rows, no decrypt), fail-soft.
 *
 * Drives the dashboard rail: the "My e-Visa" row is shown ONLY to people who have applied
 * (owner 2026-07-23 — "available only for people who applied for visa in chat"), and applying
 * is a chat-only flow now, so the row is dead weight for everyone else. Fails to `false`: if
 * the visa tables are unprovisioned or Supabase hiccups, hiding the row is the safe default —
 * far better than showing a section that then errors, and a real applicant sees it next load.
 */
export async function userHasVisaApplication(userId: string): Promise<boolean> {
  if (!userId) return false
  try {
    const { getVisaDb } = await import('@/lib/visa/db')
    const { count, error } = await getVisaDb()
      .from('visa_applications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
    if (error) throw error
    return (count ?? 0) > 0
  } catch (e) {
    console.error('[visa] hasApplication check failed', e)
    return false
  }
}
