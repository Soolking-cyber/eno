import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

// VISA OPERATOR QUEUE data layer — the eno.vn side of the one-dashboard port
// (apps/forum/docs/CLAUDE_ONE_DASHBOARD_PROMPT.md item 6). The visa tables
// (visa_applications / visa_documents / visa_events) are plain postgres tables in
// the SAME Supabase project both apps share, written by the forum app
// (apps/forum/src/lib/visa/*). This module mirrors the forum's queries and status
// workflow (apps/forum/src/app/api/visa/admin/applications/[id]/route.ts) over
// eno.vn's own service-role client — no cross-site fetch, no iframe.
//
// TODO(VISA_DATA_ENCRYPTION_KEY): the forum admin additionally decrypts
// `encrypted_payload` (AES-256-GCM envelope, apps/forum/src/lib/visa/crypto.ts)
// with the VISA_DATA_ENCRYPTION_KEY env. That key is NOT present in eno.vn's
// environment, so this surface deliberately renders the queue and case detail
// WITHOUT applicant payload contents (and cannot edit the payload-resident
// adminMessage / government fields). If the owner adds VISA_DATA_ENCRYPTION_KEY
// to eno.vn, port decryptVisaPayload + the payload schema and light those up —
// never ship a copy of the crypto without its key.

// ── Row types (ported verbatim from apps/forum/src/lib/visa/records.ts) ─────────

export type VisaApplicationRow = {
  id: string; user_id: string; status: string; encrypted_payload: string; checklist: string[] | null
  applicant_confirmation_version: string | null; applicant_confirmed_at: string | null
  applicant_snapshot_hash: string | null; authorization_version: string | null; authorized_at: string | null
  authorization_snapshot_hash: string | null; assigned_admin: string | null
  submitted_at: string | null; resolved_at: string | null; retention_until: string | null
  created_at: string; updated_at: string
}
export type VisaDocumentRow = {
  id: string; application_id: string; kind: string; storage_path: string; mime_type: string; size_bytes: number
  width: number | null; height: number | null; sha256: string
  validation_status: 'pending' | 'passed' | 'failed' | 'unavailable'
  validation_report: Record<string, unknown> | null
  created_at: string
}
export type VisaEventRow = {
  id: string; application_id: string; actor_type: string; actor_ref: string | null
  event: string; metadata: Record<string, unknown>; created_at: string
}

// Private storage bucket the forum writes documents into (apps/forum/src/lib/visa/storage.ts).
const VISA_BUCKET = 'visa-documents'

// Missing-table fail-soft (the P2021 idiom from src/app/dashboard/page.tsx, in
// PostgREST dialect): 42P01 = postgres undefined_table, PGRST205 = table absent
// from the PostgREST schema cache. Only THESE degrade softly — any other error is
// a real failure and must surface, not read as an empty queue.
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])
const tableMissing = (error: { code?: string } | null): boolean =>
  !!error && MISSING_TABLE_CODES.has(error.code ?? '')

function visaDb(): SupabaseClient | null {
  // getSupabaseAdmin throws when service env is absent (build/preview) — that is
  // the same "section unavailable" condition as a missing table, not a crash.
  try { return getSupabaseAdmin() } catch { return null }
}

// ── Queue + case loads (mirroring apps/forum/src/app/admin/visas queries) ───────

export type VisaQueueData = { applications: VisaApplicationRow[]; documents: VisaDocumentRow[] }

/** All cases for the queue page, newest activity first. `null` = tables/env not provisioned here. */
export async function listVisaAdminCases(): Promise<VisaQueueData | null> {
  const db = visaDb()
  if (!db) return null
  const apps = await db.from('visa_applications').select('*').order('updated_at', { ascending: false }).limit(200)
  if (tableMissing(apps.error)) return null
  if (apps.error) throw new Error(`visa_queue_failed:${apps.error.message}`)
  // Documents scoped to the fetched cases — an unfiltered read walks the WHOLE table
  // and silently truncates at PostgREST's max-rows once the product grows.
  const ids = (apps.data ?? []).map((a) => (a as { id: string }).id)
  const docs = ids.length
    ? await db.from('visa_documents').select('*').in('application_id', ids).order('created_at')
    : { data: [], error: null }
  if (tableMissing(docs.error)) return null
  if (docs.error) throw new Error(`visa_queue_failed:${docs.error.message}`)
  return { applications: (apps.data ?? []) as VisaApplicationRow[], documents: (docs.data ?? []) as VisaDocumentRow[] }
}

export type VisaCaseResult =
  | { state: 'ok'; application: VisaApplicationRow; documents: VisaDocumentRow[]; events: VisaEventRow[] }
  | { state: 'unavailable' }
  | { state: 'not-found' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function loadVisaAdminCase(id: string): Promise<VisaCaseResult> {
  // A non-uuid path segment would 400 at the uuid column, not 404 — pre-empt it.
  if (!UUID_RE.test(id)) return { state: 'not-found' }
  const db = visaDb()
  if (!db) return { state: 'unavailable' }
  const [app, docs, events] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', id).maybeSingle(),
    db.from('visa_documents').select('*').eq('application_id', id).order('created_at'),
    db.from('visa_events').select('*').eq('application_id', id).order('created_at'),
  ])
  if (tableMissing(app.error) || tableMissing(docs.error) || tableMissing(events.error)) return { state: 'unavailable' }
  if (app.error) throw new Error(`visa_case_failed:${app.error.message}`)
  if (docs.error) throw new Error(`visa_case_failed:${docs.error.message}`)
  if (events.error) throw new Error(`visa_case_failed:${events.error.message}`)
  if (!app.data) return { state: 'not-found' }
  return {
    state: 'ok',
    application: app.data as VisaApplicationRow,
    documents: (docs.data ?? []) as VisaDocumentRow[],
    events: (events.data ?? []) as VisaEventRow[],
  }
}

/**
 * Short-lived signed URL for a private visa document (the bucket is never
 * public-URL'd, same posture as the disputes evidence bucket). Rendered once at
 * SSR, so sign for 6h like the admin dispute room does. Fail-soft null — the
 * detail page shows "preview unavailable" instead of crashing the case.
 */
export async function signVisaDocumentUrl(storagePath: string, ttl = 6 * 3600): Promise<string | null> {
  const db = visaDb()
  if (!db) return null
  const { data, error } = await db.storage.from(VISA_BUCKET).createSignedUrl(storagePath, ttl)
  return error || !data?.signedUrl ? null : data.signedUrl
}

// ── Status workflow (ported from the forum admin PATCH route) ───────────────────

/** Legal admin transitions — MUST stay identical to the forum route's map. */
export const VISA_ADMIN_TRANSITIONS: Record<string, string[]> = {
  draft: ['cancelled'], ready_for_review: ['under_review', 'needs_changes', 'applicant_approval', 'cancelled'],
  under_review: ['needs_changes', 'applicant_approval', 'cancelled'], needs_changes: ['under_review', 'cancelled'],
  applicant_approval: ['under_review', 'needs_changes', 'cancelled'], ready_to_submit: ['applicant_approval', 'submitted', 'payment_required', 'processing', 'needs_changes', 'cancelled'],
  submitted: ['payment_required', 'processing', 'needs_changes', 'rejected', 'cancelled'], payment_required: ['submitted', 'processing', 'rejected', 'cancelled'],
  processing: ['approved', 'rejected', 'needs_changes', 'cancelled'], approved: [], rejected: [], cancelled: [],
}

export type VisaTransitionResult = { ok: true } | { ok: false; error: string }

/**
 * Apply one admin status transition, with the same side effects as the forum's
 * PATCH handler: validate against VISA_ADMIN_TRANSITIONS, require a `result`
 * document before `approved`, claim assignment for the acting admin, null the
 * applicant authorization when returning ready_to_submit → applicant_approval,
 * stamp submitted_at / resolved_at / retention (90 days), and append the
 * status_changed audit event. Status-only by design: the forum also re-encrypts
 * the payload on every PATCH, which needs VISA_DATA_ENCRYPTION_KEY (absent here
 * — see the module TODO), so `encrypted_payload` is left byte-identical.
 */
export async function transitionVisaCase(id: string, next: string, admin: string): Promise<VisaTransitionResult> {
  const db = visaDb()
  if (!db) return { ok: false, error: 'visa_database_not_configured' }
  const loaded = await loadVisaAdminCase(id)
  if (loaded.state === 'unavailable') return { ok: false, error: 'visa_database_not_configured' }
  if (loaded.state === 'not-found') return { ok: false, error: 'not_found' }
  const app = loaded.application
  if (next === app.status) return { ok: true }
  if (!(VISA_ADMIN_TRANSITIONS[app.status] || []).includes(next)) return { ok: false, error: 'invalid_status_transition' }
  if (next === 'approved' && !loaded.documents.some((item) => item.kind === 'result')) {
    return { ok: false, error: 'result_document_required' }
  }
  const now = new Date()
  const final = ['approved', 'rejected', 'cancelled'].includes(next)
  const authorizationRefresh = next === 'applicant_approval' && app.status === 'ready_to_submit'
  const { data, error } = await db.from('visa_applications').update({
    status: next, assigned_admin: app.assigned_admin || admin,
    authorized_at: authorizationRefresh ? null : app.authorized_at,
    authorization_version: authorizationRefresh ? null : app.authorization_version,
    authorization_snapshot_hash: authorizationRefresh ? null : app.authorization_snapshot_hash,
    submitted_at: next === 'submitted' && !app.submitted_at ? now.toISOString() : app.submitted_at,
    resolved_at: final ? now.toISOString() : null,
    retention_until: final ? new Date(now.getTime() + 90 * 86400_000).toISOString() : app.retention_until,
    updated_at: now.toISOString(),
    // `.eq('status', …)` on top of the forum's id-only match: two operators (or
    // this surface racing the forum one) can't double-apply a transition — the
    // second write matches zero rows and reports stale instead of clobbering.
  }).eq('id', id).eq('status', app.status).select('id')
  if (error) return { ok: false, error: 'update_failed' }
  if (!data?.length) return { ok: false, error: 'case_changed_reload' }
  // Audit event, same shape as the forum's recordVisaEvent. Best-effort AFTER the
  // committed update: failing it must not tell the operator the transition failed
  // (it did not) and bait a re-click into invalid_status_transition.
  await db.from('visa_events').insert({
    id: crypto.randomUUID(), application_id: id, actor_type: 'admin', actor_ref: admin,
    event: 'status_changed', metadata: { from: app.status, to: next },
  })
  return { ok: true }
}
