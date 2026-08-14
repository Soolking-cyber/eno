import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
// Prisma, for the ONE thing Supabase cannot answer: which desk a case's conversation belongs to.
// Named `db2` because `db` is already this module's Supabase handle (`visaDb()`).
import { db as db2 } from '@/lib/db'
import type { VisaDeskScope } from '@/lib/desk-operator'

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
  /** The human case number (EV-1042). Assigned once by a DB default, never edited — it is
   *  what the desk reads down a phone line and what names the handover pack. */
  reference: string
  // Phase-1 redesign (scripts/visa-case-conversation-cols.mjs). conversation_id = the IMMUTABLE
  // thread this case's cards live in (set once, never rebound — fixes result-delivery stranding).
  // selected_* = the CANONICAL product choice (what checkout charges; frozen at pay), not just
  // the dm_product_selected audit event. All nullable: an older/orphan case may carry none.
  conversation_id: string | null
  selected_listing_id: string | null; selected_entry_type: string | null
  selected_speed: string | null; selected_at: string | null
  applicant_snapshot_hash: string | null; authorization_version: string | null; authorized_at: string | null
  authorization_snapshot_hash: string | null; assigned_admin: string | null
  submitted_at: string | null; resolved_at: string | null; retention_until: string | null
  // Service-fee payment stamp (scripts/visa-payment-setup.mjs) — null until the
  // eno service fee is paid; the pay-before-admin gate + queue badges read these.
  paid_at: string | null; payment_provider: string | null; payment_ref: string | null
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
// Exported: the applicant-side upload path (src/lib/visa/storage.ts) writes the SAME bucket
// with byte-identical object paths so both surfaces stay interoperable.
export const VISA_BUCKET = 'visa-documents'

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

/** Queue rows carry everything EXCEPT the ciphertext — the list never decrypts, and
 *  200 × encrypted_payload was the page's dominant transfer weight (audit §G). */
export type VisaQueueRow = Omit<VisaApplicationRow, 'encrypted_payload'>
const QUEUE_COLUMNS =
  'id,user_id,status,reference,conversation_id,selected_listing_id,selected_entry_type,selected_speed,selected_at,checklist,applicant_confirmation_version,applicant_confirmed_at,applicant_snapshot_hash,authorization_version,authorized_at,authorization_snapshot_hash,assigned_admin,submitted_at,resolved_at,retention_until,paid_at,payment_provider,payment_ref,created_at,updated_at'

export type VisaQueueData = { applications: VisaQueueRow[]; documents: VisaDocumentRow[] }

/** All cases for the queue page, newest activity first. `null` = tables/env not provisioned here.
 *  DRAFTS ARE EXCLUDED (owner 2026-07-18): a draft is the applicant's private local work —
 *  the admin first sees a case when it reaches ready_for_review, which (with payments
 *  configured) happens only after the service fee is paid. needs_changes stays visible:
 *  by then the admin has already engaged with the case.
 *  ⚠️ …EXCEPT A PAID DRAFT (Phase 2, external review): a capture whose handoff was
 *  withheld (consent hash voided by a late edit, or a payment/selection mismatch) leaves
 *  the case paid but still 'draft' — money taken, and under the plain status filter the
 *  desk would never see it. Paid cases are ALWAYS visible, whatever their status. */
/** The documents for a fetched page of cases. Shared by both queue paths so the chunked branch
 *  cannot drift from the plain one. Scoped to the ids on screen — an unfiltered read walks the
 *  WHOLE table and silently truncates at PostgREST's max-rows once the product grows. */
async function queueDocuments(db: SupabaseClient, ids: string[]): Promise<VisaDocumentRow[] | null> {
  if (!ids.length) return []
  const docs = await db.from('visa_documents').select('*').in('application_id', ids).order('created_at')
  /**
   * ⚠️ `null` FOR A MISSING TABLE, AND EXTRACTING THIS HELPER LOST THAT ONCE — a reviewer caught it.
   * `visa_documents` can legitimately be absent on a half-provisioned deployment (that is the whole
   * reason `tableMissing` exists), and the caller answers `null` with the "section unavailable"
   * screen. Throwing instead turns that into a 500 on the operator queue. Any OTHER error is still a
   * real failure and must surface.
   */
  if (tableMissing(docs.error)) return null
  if (docs.error) throw new Error(`visa_queue_failed:${docs.error.message}`)
  return (docs.data ?? []) as VisaDocumentRow[]
}

/**
 * ⛔ THE SCOPE ARGUMENT IS A SECURITY BOUNDARY, NOT A FILTER — see `getVisaDeskScope()` in
 * src/lib/desk-operator.ts for why it exists. `visa_applications` is ONE table shared by eno.vn and
 * eno.forum, so an unscoped read hands a partner desk the other deployment's applicants. It is
 * REQUIRED rather than optional precisely so a new call site cannot omit it and silently get
 * everything; `{ all: true }` is what an admin passes, and it has to be written down.
 */
export async function listVisaAdminCases(scope: VisaDeskScope): Promise<VisaQueueData | null> {
  const db = visaDb()
  if (!db) return null

  /**
   * ⛔ THE DESK PREDICATE GOES IN THE QUERY, NOT AFTER IT — AND THE FIRST CUT OF THIS GOT IT
   * BACKWARDS, WHICH ALL THREE EXTERNAL REVIEWERS CAUGHT INDEPENDENTLY.
   *
   * That version fetched the 200 most-recently-updated rows of the SHARED `visa_applications`
   * table and then filtered them to the desk. It is correct only while the table is small: let
   * eno.forum update 200 cases in a stretch and every one of VietKite's falls outside the window,
   * so the partner's queue renders EMPTY, with no error and no clue — and the "paid cases are
   * ALWAYS visible" invariant silently fails for exactly the tenant this scoping exists to serve.
   * A limit applied before a tenant filter is a starvation bug wearing a pagination costume.
   *
   * ⚠️ SO THE ID LIST IS FETCHED FIRST, and the earlier objection to that ("unbounded") was the
   * wrong trade: it is bounded by ONE DESK's own conversations, which is the desk's own workload,
   * whereas the other ordering is bounded by the whole SHARED table's activity — something this
   * deployment does not control. A desk with more threads than PostgREST can take in an `in()` has
   * a queue that needs real pagination anyway; silently showing nothing is not the failure mode to
   * choose.
   *
   * ⚠️ An admin still takes the unfiltered path — no id list, one query, exactly as before.
   */
  let query = db.from('visa_applications').select(QUEUE_COLUMNS).or('status.neq.draft,paid_at.not.is.null')
  if (!scope.all) {
    /**
     * ⚠️ `sellerProfileId` ALONE — deliberately NOT also `visaApplicationId: { not: null }`, which
     * is the narrowing that looks like an optimisation and is the repo's own documented stranding
     * bug. `Conversation.visaApplicationId` is the LIVE binding and holds at most ONE case per
     * thread, so a repeat applicant's second case REBINDS it; filtering on it would drop every
     * thread whose pointer had moved on, taking the earlier cases with it (src/lib/visa/dm-thread.ts
     * records exactly this failure for result delivery). The question here is "which threads are
     * this desk's", and the answer is the seller, full stop. Non-visa threads in the list cost
     * nothing — no case's `conversation_id` matches them.
     */
    const mine = await db2.conversation.findMany({
      where: { sellerProfileId: scope.deskProfileId },
      select: { id: true },
    })
    // No threads yet → no cases. Return early rather than sending `in.()`, which PostgREST reads as
    // "match nothing" only by luck of syntax; an explicit empty result cannot be misparsed.
    if (!mine.length) return { applications: [], documents: [] }
    /**
     * ⚠️ CHUNKED, BECAUSE A SINGLE `.in()` OF EVERY CONVERSATION IS A URL, NOT A BIND PARAMETER.
     * PostgREST puts the list in the query string, so a desk with enough threads stops getting a
     * queue and starts getting a request-too-large error — the reviewer's point, and the honest
     * cost of moving the predicate into the query (which was still the right move: the alternative
     * silently returned an EMPTY queue instead of an error).
     * 300 ids is roughly 11KB of URL, comfortably inside every proxy default. Beyond that the desk
     * is queried in slices and the rows are merged, so the answer is the same shape at any size —
     * and the `updated_at` ordering is re-applied below rather than trusted per slice.
     */
    const CHUNK = 300
    const ids = mine.map((c) => c.id)
    if (ids.length <= CHUNK) {
      query = query.in('conversation_id', ids)
    } else {
      const slices: string[][] = []
      for (let i = 0; i < ids.length; i += CHUNK) slices.push(ids.slice(i, i + CHUNK))
      const parts = await Promise.all(slices.map((slice) =>
        db.from('visa_applications').select(QUEUE_COLUMNS).or('status.neq.draft,paid_at.not.is.null')
          .in('conversation_id', slice).order('updated_at', { ascending: false }).limit(200)))
      const failed = parts.find((r) => r.error)
      if (failed && tableMissing(failed.error)) return null
      if (failed?.error) throw new Error(`visa_queue_failed:${failed.error.message}`)
      const merged = (parts.flatMap((r) => r.data ?? []) as unknown as VisaQueueRow[])
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
        .slice(0, 200)
      const mergedDocs = await queueDocuments(db, merged.map((r) => r.id))
      if (mergedDocs === null) return null
      return { applications: merged, documents: mergedDocs }
    }
  }
  const apps = await query.order('updated_at', { ascending: false }).limit(200)
  if (tableMissing(apps.error)) return null
  if (apps.error) throw new Error(`visa_queue_failed:${apps.error.message}`)
  const rows = (apps.data ?? []) as unknown as VisaQueueRow[]
  const documents = await queueDocuments(db, rows.map((a) => a.id))
  if (documents === null) return null
  return { applications: rows, documents }
}

/**
 * ⛔ THE ONE PREDICATE FOR "MAY THIS OPERATOR TOUCH THIS CASE". Every entitled surface calls it —
 * the queue's case load, the bundle download, the result upload, the chat takeover, the status
 * transition — because each of those was written as its own query and three of them read
 * `visa_applications` directly by id with no owner predicate at all.
 *
 * ⚠️ ENTITLEMENT AND SCOPE ARE TWO SEPARATE CHECKS AND BOTH ARE REQUIRED. `getVisaDeskScope()` says
 * "you operate a visa desk"; this says "and this case is yours". A route that does only the first
 * is exactly the cross-tenant hole this pair exists to close: eno.vn and eno.forum share one
 * `visa_applications` table, so a partner desk with only the first check can name any uuid.
 *
 * ⚠️ THE LINK IS THE CONVERSATION'S SELLER, because it is the only link that exists — the table has
 * no desk column. An unbound case (`conversation_id` null) is NOT in a partner's scope: it is a case
 * this desk is demonstrably not answering. Admins are unaffected, which is what keeps eno.forum's
 * queue — including legacy cases whose conversation was never backfilled — working exactly as before.
 */
export async function visaCaseInScope(applicationId: string, scope: VisaDeskScope): Promise<boolean> {
  if (scope.all) return true
  if (!UUID_RE.test(applicationId)) return false
  const db = visaDb()
  if (!db) return false
  const { data, error } = await db
    .from('visa_applications').select('conversation_id').eq('id', applicationId).maybeSingle()
  // ⚠️ A LOOKUP ERROR IS NOT "OUT OF SCOPE" AND NOT "IN SCOPE" — it is a failure, and the only safe
  // answer for an authorisation predicate is to refuse. Returning false here degrades a transient
  // Supabase hiccup into a 404 for a legitimate operator, which is the direction we want.
  if (error || !data) return false
  const convoId = (data as { conversation_id?: string | null }).conversation_id
  if (!convoId) return false
  const mine = await db2.conversation.findFirst({
    where: { id: convoId, sellerProfileId: scope.deskProfileId },
    select: { id: true },
  })
  return !!mine
}

/**
 * ⛔ IS THIS CASE ANSWERED BY *THIS DEPLOYMENT'S* VISA DESK? — the applicant-side twin of
 * `visaCaseInScope`, and the guard that closes a CROSS-EDITION FEE BYPASS a reviewer found.
 *
 * `visa_applications`, auth and the messages surface are all shared between eno.vn and eno.forum.
 * The pay-before-review gate in `/submit` is edition-local ("this deployment does not charge"), so
 * without this a case created on eno.forum — which DOES charge and is unpaid — could be handed to
 * the desk from eno.vn, where the fee check does not apply. eno.forum's own gate, bypassed through
 * the other edition.
 *
 * ⚠️ IT IS DEFENDED TODAY BY SOMETHING ELSE ENTIRELY, WHICH IS EXACTLY WHY IT NEEDS ITS OWN GUARD.
 * A forum visa thread is owned by the hidden desk seller, so `HIDDEN_DESK_OWNER_EMAILS` makes
 * eno.vn 404 the conversation and the applicant never reaches the button. That is a licensing
 * control in a different module doing an authorisation job by accident — one env edit away from
 * silently ceasing to. The rule belongs where the money decision is made.
 *
 * Fails CLOSED: no desk, no conversation, or a lookup error → false.
 */
export async function visaCaseOnLocalDesk(applicationId: string): Promise<boolean> {
  const { getVisaShopSeller } = await import('@/lib/visa-shop')
  const deskProfileId = (await getVisaShopSeller())?.ownerId
  if (!deskProfileId) return false
  return visaCaseInScope(applicationId, { operator: 'local-desk', all: false, deskProfileId })
}

export type VisaCaseResult =
  | { state: 'ok'; application: VisaApplicationRow; documents: VisaDocumentRow[]; events: VisaEventRow[] }
  | { state: 'unavailable' }
  | { state: 'not-found' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * ⛔ SCOPED, FOR THE SAME REASON AS THE QUEUE — and this is the more dangerous of the two, because
 * it is what `GET /api/visa/admin/applications/[id]/bundle` loads before decrypting a dossier and
 * signing URLs for the applicant's passport and portrait. Unscoped, any uuid worked for any
 * operator across BOTH deployments. A case outside the scope answers `not-found`, never
 * `forbidden`: an operator who may not see a case must not learn that it exists.
 */
export async function loadVisaAdminCase(id: string, scope: VisaDeskScope): Promise<VisaCaseResult> {
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
  // ⚠️ `not-found`, never `forbidden` — an operator who may not see a case must not learn it exists.
  if (!(await visaCaseInScope(id, scope))) return { state: 'not-found' }
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

/**
 * Every code an admin visa transition can put on the wire.
 *
 * ⚠️ NAMED FOR THE SAME REASON AS `ListingUpdateErrorCode` — BUT DELIBERATELY *NOT* COUPLED TO
 * `ApiErrorCode`, AND THE DIFFERENCE MATTERS. `transitionVisaCase` has exactly one consumer,
 * `src/app/admin/visas/[id]/actions.ts`, which is a SERVER ACTION rather than a route: its return
 * value is an RPC result, not an HTTP response body. So these codes are not on the API wire and
 * forcing them into that union would make it describe something it does not describe. An earlier
 * draft of this comment said "the visa-admin routes answer `{ error: result.error }`" — there are
 * no such routes, and review caught the contradiction between this file and errors.ts.
 *
 * Naming the union earned its place anyway: it immediately exposed `admin_required`, returned by
 * the server-action WRAPPER and never by this function, which a bare `string` had let through.
 */
export type VisaTransitionErrorCode =
  | 'visa_database_not_configured'
  | 'not_found'
  | 'invalid_status_transition'
  | 'result_document_required'
  | 'update_failed'
  | 'case_changed_reload'
  // ⚠️ NOT emitted by `transitionVisaCase` itself — the server action wrapper
  // `src/app/admin/visas/[id]/actions.ts:14` re-checks getAdmin() and returns this as a
  // `VisaTransitionResult`. Naming the union surfaced that; while the type was `string` the
  // wrapper could widen the contract without anyone noticing, which is exactly the drift this
  // narrowing exists to stop.
  | 'admin_required'

export type VisaTransitionResult = { ok: true } | { ok: false; error: VisaTransitionErrorCode }

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
export async function transitionVisaCase(id: string, next: string, admin: string, scope: VisaDeskScope): Promise<VisaTransitionResult> {
  const db = visaDb()
  if (!db) return { ok: false, error: 'visa_database_not_configured' }
  // ⚠️ The scope travels all the way down rather than being checked only at the action. This
  // function reads the case, its documents and its events, and it is exported — a future caller
  // that gates on entitlement alone would otherwise reintroduce the cross-tenant read here.
  const loaded = await loadVisaAdminCase(id, scope)
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
