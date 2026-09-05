import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { sweepVerificationRetention } from '@/lib/core/business-verification-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // the drain is up to 1,000 rows × (remove + update); eno-cron.sh allows 900s

// Retention sweep for BUSINESS-REGISTRATION documents (SellerVerification). Every decision writes
// `retentionUntil` = now + 30 days; this is the job that acts on it — there was none before
// 2026-09-05 (review, S03): the sweep existed, had no caller, and swallowed storage errors.
//
// Installed as a systemd timer by infra/vn-node/cron/install-cron-timers.sh; the box calls it on
// 127.0.0.1 with the app's CRON_SECRET. One edition is enough — it is pure database + bucket
// work on the shared project, idempotent, and flushes no per-container cache.
//
// Response: `{ ok, swept, failed, malformed, skippedNonTerminal, remaining, checkedAt }`. ⛔ A run that
// leaves ANY document past its retention — a storage failure, a malformed record a human must repair,
// a backlog beyond the drain budget, or a draft/pending row carrying an expired retention (a bug's
// footprint) — is a **500** with the same body: eno-cron.sh exits non-zero on anything but 200, so
// the systemd unit shows FAILED and `list-units --failed` names it — a PII deletion that quietly
// did not happen must not leave a green journal. The rows are already pushed back for tomorrow's
// retry; the status is for the operator, not the retry. Yes, one broken record keeps the unit red
// every day until a human repairs it — PII held past its deadline behind a green journal is the
// worse outcome (three review rounds argued both sides; this is the side the law is on). Auth
// failures are `route()`'s standard 401.
export const GET = route({ auth: 'cron' }, async () => {
  const result = await sweepVerificationRetention()
  const ok = result.failed === 0 && result.malformed === 0 && result.remaining === 0 && result.skippedNonTerminal === 0
  const body = { ok, ...result, checkedAt: new Date().toISOString() }
  return ok ? body : NextResponse.json(body, { status: 500 })
})
