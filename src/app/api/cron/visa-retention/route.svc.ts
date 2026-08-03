import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { getVisaDb } from '@/lib/visa/db'
import { removeVisaFiles } from '@/lib/visa/storage'

// PDPD RETENTION SWEEP — deletes visa cases (passport PII: encrypted payloads, passport
// scans, portraits, the finished visa PDF) whose retention window has passed.
//
// PORTED from apps/forum/api/cron/visa-retention (visa-ownership row, 2026-07-23): the
// forum deployment was the ONLY thing deleting expired PII — eno.vn wrote retention_until
// and never acted on it, so retiring the forum would have silently ended data-protection
// compliance. Both apps share the same tables/bucket; the forum's cron may keep running
// beside this one until the owner retires it (a concurrent double-sweep is idempotent: the
// loser's row DELETE matches 0 rows).
//
// ⚠️ NOT a faithful copy — the dual plan review (codex GPT-5.6 + Gemini 3.1, 2026-07-23)
// refuted three defects in the forum's shipped semantics, fixed here:
//   1. FAIL-CLOSED object removal. The forum removed storage objects fail-open and deleted
//      the row regardless — an object-store blip orphaned passport scans in the bucket
//      with no surviving row to ever find them again. Here the row is deleted ONLY after
//      strict object removal succeeds; a failure leaves the case discoverable for the next
//      run (re-sweepable by construction).
//   2. TERMINAL-STATUS GATE. retention_until is only ever written on the terminal
//      transitions (approved/rejected/cancelled — visa-admin.ts:200 and the applicant
//      cancel route), so a case matching this sweep with a LIVE status means a bug wrote
//      the timestamp early. Such rows are SKIPPED and counted, never destroyed mid-flight;
//      `skippedNonTerminal` in the response is the drift alarm.
//   3. DRAIN, DON'T STARVE. The forum's single LIMIT 100 could fall behind forever past
//      100 expiries/day. This loops oldest-first until the backlog is empty (bounded by
//      MAX_BATCHES as a runaway stop) and reports what remains.
//
// What deletion leaves BEHIND, deliberately: the marketplace chat thread and its visa
// cards. Their meta holds ids only (never applicant data — the messages.ts card contract);
// every server endpoint they point at re-reads the row (result download 404s once the
// cascade takes visa_documents). The applicant losing the PDF after the window IS the
// compliance intent — don't hold identity documents forever.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TERMINAL_STATUSES = ['approved', 'rejected', 'cancelled']
const BATCH = 100
const MAX_BATCHES = 20 // runaway stop: 2000 deletions per run is a backlog, not a sweep

function bearerOk(header: string | null, secret: string): boolean {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || !bearerOk(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 })
  }

  const db = getVisaDb()
  const now = new Date().toISOString()
  let deleted = 0
  let failed = 0

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data: applications, error } = await db
      .from('visa_applications')
      .select('id')
      .in('status', TERMINAL_STATUSES)
      .not('retention_until', 'is', null)
      .lt('retention_until', now)
      .order('retention_until', { ascending: true })
      .limit(BATCH)
    if (error) {
      console.error('[visa-retention] expired-case query failed', error.code)
      return NextResponse.json({ error: 'visa_database_unavailable' }, { status: 503 })
    }
    if (!applications?.length) break

    let batchDeleted = 0
    for (const application of applications) {
      try {
        const { data: documents, error: docError } = await db
          .from('visa_documents')
          .select('storage_path')
          .eq('application_id', application.id)
        // "Could not LIST the objects" must not read as "there are none" — skip; the row
        // survives and the next run retries. Same reasoning as the strict removal below.
        if (docError) throw new Error(`document_list_failed:${docError.code ?? 'unknown'}`)
        await removeVisaFiles((documents ?? []).map((item) => item.storage_path), { strict: true })
        // The DELETE re-asserts the terminal gate itself (diff review: the selection check
        // alone is a TOCTOU). Terminal states are absorbing in the transition map, so this
        // guards only a manual/DB-side flip — but PII deletion earns the second lock.
        const result = await db.from('visa_applications').delete().eq('id', application.id).in('status', TERMINAL_STATUSES)
        if (result.error) throw new Error(`row_delete_failed:${result.error.code ?? 'unknown'}`)
        deleted++
        batchDeleted++
      } catch (e) {
        // Per-case isolation: one stubborn case must not stall the whole backlog. No case
        // id in the log line beyond what an operator needs; no applicant data exists here.
        failed++
        console.error('[visa-retention] case sweep failed — row kept for retry', application.id, e)
      }
    }
    // ⚠️ PER-BATCH progress, not cumulative (diff review): failed rows are KEPT, so they
    // stay at the head of the oldest-first order — a batch that deleted nothing would
    // re-query the very same heads and churn until the cap. Stop; the next run retries,
    // and `failed`/`remaining` in the response are the operator's signal.
    if (applications.length < BATCH || batchDeleted === 0) break
  }

  // Drift alarm (dual review): an EXPIRED retention on a LIVE case means some writer set
  // the timestamp outside the terminal transitions — surface it, never act on it.
  const { count: skippedNonTerminal } = await db
    .from('visa_applications')
    .select('id', { count: 'exact', head: true })
    .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`)
    .not('retention_until', 'is', null)
    .lt('retention_until', now)
  const { count: remaining } = await db
    .from('visa_applications')
    .select('id', { count: 'exact', head: true })
    .in('status', TERMINAL_STATUSES)
    .not('retention_until', 'is', null)
    .lt('retention_until', now)

  return NextResponse.json(
    { ok: true, deleted, failed, remaining: remaining ?? 0, skippedNonTerminal: skippedNonTerminal ?? 0, checkedAt: now },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
