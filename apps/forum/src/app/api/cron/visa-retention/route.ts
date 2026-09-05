import { getVisaDb } from '@/lib/visa/db'
import { removeVisaFiles } from '@/lib/visa/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ⛔ THIS TREE IS DORMANT — AND THAT IS EXACTLY WHY THIS FILE WAS BEHIND (review S06, 2026-09-05).
// Nothing deploys `apps/forum`: the box builds the REPO ROOT twice and serves eno.forum from the
// services edition (see AGENTS.md and infra/vn-node/eno-build.sh). This endpoint therefore never
// ran — and drifted from `src/app/api/cron/visa-retention/route.svc.ts`, which had since learned
// three things this one had not: only TERMINAL cases may be purged, a failed storage removal must
// KEEP the row for retry, and a failed document LIST must never read as "there are no documents".
// If this tree is ever revived, it now deletes exactly what the root deletes.
//
// ⚠️ THE SEMANTICS BELOW ARE A PORT, NOT AN INVENTION. Keep them in step with the root file; the
// differences that matter are commented there at length.
const TERMINAL_STATUSES = ['approved', 'rejected', 'cancelled']
const BATCH = 100
const MAX_BATCHES = 20

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'cron_not_configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'unauthorized' }, { status: 401 })
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
    // ⛔ A FAILED SELECTION IS A 503, NOT AN EMPTY SWEEP. The previous version threw the raw error,
    // which Next served as a 500 HTML page; either way the operator needs to know the sweep did
    // not run, rather than reading `deleted: 0` as "nothing was due".
    if (error) {
      console.error('[visa-retention] expired-case query failed', error.code)
      return Response.json({ error: 'visa_database_unavailable' }, { status: 503 })
    }
    if (!applications?.length) break

    let batchDeleted = 0
    for (const application of applications) {
      try {
        const { data: documents, error: docError } = await db
          .from('visa_documents')
          .select('storage_path')
          .eq('application_id', application.id)
        // "Could not LIST the objects" must not read as "there are none": the old code ignored
        // this error and then deleted the row, orphaning every file it failed to see.
        if (docError) throw new Error(`document_list_failed:${docError.code ?? 'unknown'}`)
        await removeVisaFiles((documents ?? []).map((item) => item.storage_path), { strict: true })
        // The DELETE re-asserts the terminal gate: the selection check alone is a TOCTOU.
        // ⛔ AND IT MUST PROVE A ROW WENT, NOT MERELY THAT NOTHING ERRORED. A conditional delete
        // that matches nothing returns no error and no rows — so if the case left its terminal
        // state between the selection and here, the files above were ALREADY removed and this
        // would have counted the case as retained-and-deleted while a LIVE application lost its
        // documents. `.select('id')` makes the zero-row case observable, and it is reported as a
        // failure because that is what it is (gate, 2026-09-06).
        const result = await db.from('visa_applications').delete().eq('id', application.id).in('status', TERMINAL_STATUSES).select('id')
        if (result.error) throw new Error(`row_delete_failed:${result.error.code ?? 'unknown'}`)
        if (!result.data?.length) throw new Error('row_left_terminal_after_file_removal')
        deleted++
        batchDeleted++
      } catch (e) {
        // Per-case isolation, and the row is KEPT so the next run retries it.
        failed++
        console.error('[visa-retention] case sweep failed — row kept for retry', application.id, e)
      }
    }
    // Failed rows stay at the head of the oldest-first order, so a batch that deleted nothing
    // would re-query the same heads until the cap. Stop and let the next run retry.
    if (applications.length < BATCH || batchDeleted === 0) break
  }

  // Drift alarm: an EXPIRED retention on a LIVE case means a writer set the timestamp outside the
  // terminal transitions. Surface it; never act on it.
  // ⚠️ A FAILED COUNT IS `null`, NOT `0`. Both of these used to fall back to 0 through `?? 0`,
  // which turns "the database would not answer" into "there is no backlog" — the one reading an
  // operator would act on by doing nothing (gate).
  const skipped = await db
    .from('visa_applications')
    .select('id', { count: 'exact', head: true })
    .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`)
    .not('retention_until', 'is', null)
    .lt('retention_until', now)
  const left = await db
    .from('visa_applications')
    .select('id', { count: 'exact', head: true })
    .in('status', TERMINAL_STATUSES)
    .not('retention_until', 'is', null)
    .lt('retention_until', now)

  return Response.json(
    {
      ok: true,
      deleted,
      failed,
      remaining: left.error ? null : (left.count ?? 0),
      skippedNonTerminal: skipped.error ? null : (skipped.count ?? 0),
      checkedAt: now,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
