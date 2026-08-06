import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
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

// ⚠️ WS6 MIGRATION — `auth: 'cron'`. THIS WAS THE SIXTH COPY, and closing it is the whole point of
// the mode existing. Verified before editing, not assumed: the local `bearerOk()` deleted here was
// byte-identical to the one `src/app/api/cron/price-stats/route.ts` carried at HEAD~5 (`diff` of the
// two six-line functions: no output), and the gate block was identical too — same
// `if (!secret || !bearerOk(<req>.headers.get('authorization'), secret))`, same
// `{ error: 'forbidden' }`, same status **401**, differing only in the request parameter's NAME
// (`request` here, `req` there). `cronAuthorized()` in `src/lib/api/handler.ts` reproduces it
// exactly, including the fail-closed unset-secret branch and the `a.length === b.length &&`
// short-circuit that keeps `timingSafeEqual` from throwing on unequal lengths.
//
// EVERY BRANCH, UNCHANGED:
//   · unset CRON_SECRET, or a missing / malformed / wrong-length / wrong Bearer token
//                                            → `{"error":"forbidden"}` 401
//   · the expired-case query errors          → `{"error":"visa_database_unavailable"}` 503
//   · success (including a run where individual cases failed and were counted in `failed`)
//     → `{ok,deleted,failed,remaining,skippedNonTerminal,checkedAt}` 200 + `Cache-Control: no-store`
//
// ⚠️ BOTH RETURNS STAY `NextResponse`, VIA route()'s PASS-THROUGH, FOR TWO DIFFERENT REASONS.
// The 200 carries a `Cache-Control: no-store` header, and neither `apiFail()` nor a returned plain
// object can emit one — a sweep report is per-invocation and must never be served from a cache.
// The 503 stays a Response because a returned object is serialised at **200**: `{"error":"…"}` with
// a success status is exactly the silent failure a retention sweep must not have. route() passes a
// handler-returned `Response` through unchanged, which is the escape hatch for both.
//
// ⚠️ ONE ACCEPTED WIRE CHANGE, STATED AS A SHAPE: any unhandled throw in this handler now returns
// `{"error":"internal_error"}` 500 instead of Next's default 500 HTML. The per-case work is inside
// a try, but nothing else is — `getVisaDb()` and the two trailing `count` queries are bare — so
// this is a live path, not a hypothetical.
export const GET = route({ auth: 'cron' }, async () => {
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
})
