import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { reconcileIdentities } from '@/lib/compliance/identity-reconcile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// One recompute per profile with an identity row (2–3 on 2026-10-15), sequential, each a dozen reads plus guarded
// writes. eno-cron.sh allows 900s.
export const maxDuration = 300

// ── THE NIGHTLY IDENTITY RECONCILE (owner, 2026-10-15 — src/lib/compliance/identity-reconcile.ts) ──────────────────────
//
// "A live verified identity counts in trust (+10) for every seller, on both editions — flat while current, gone on
// expiry or revocation, no penalty." The +10 is read live on every trust recompute; this run is what makes every
// profile with an identity row actually BE recomputed, nightly: the Profile.verification* cache (so a document that
// lapsed is recorded `expired`), the trust score and rank, the enforcement state, and a teacher's pages — catching
// lapses of any age, revocations, and any decision whose own effects failed. Idempotent.
//
// ⏰ 02:05 UTC = 09:05 ICT, daily — NOT AT MIDNIGHT, ON PURPOSE (infra/vn-node/cron/install-cron-timers.sh). A document
// lapses at 00:00 ICT the day after its expiry date, but what this run causes can reach the seller: losing the +10 can
// take a seller under 60 — the RESTRICTED trust tier, which refuses publishing — and, with confirmed conduct on the
// record, into `throttled`; gaining it can lift a throttle. Each such transition sends the enforcement ladder's bell +
// web push (src/lib/enforcement.ts syncEnforcement → notifyEnforcement). A morning run means none of THIS RUN's notices
// land in the night (a recompute another path runs at night still can — identity-effects.ts says when); five minutes
// after the 09:00 daily pass (daily-reminders), which re-scores storefront owners the same way.
// ⛔ ITS OWN TIMER, NEVER FOLDED INTO daily-reminders: that unit is EMAIL class (disabled by every full installer
// re-run) and shares a 60s budget with reminders, rank and stats — a backstop must not depend on either.
// ⚠️ ONE EDITION IS ENOUGH: both apps share the database and the ISR invalidation table (a purge on eno.vn purges both),
// so the timer is pinned to eno.vn:3001 whatever host the installer is run for.
// ⚠️ UNPAGINATED, AT TODAY'S SIZE ON PURPOSE (commit gate, 2026-10-15): one run walks every identity holder — 3 rows in
// identity_verifications on 2026-10-15 — inside this route's 300 s budget, a few tens of ms each. Long before the
// population nears thousands, give it a cursor (resume where the last run stopped); until then a run that times out
// shows as a red unit and the next day's run retries from the start.
// ⛔ NO ?all MODE: every run walks every profile with an identity row, so the first run after the deploy IS the backfill
// (each verified identity's +10 lands in full — trust.ts never caps the identity's own step). Unknown params are ignored.
//
// `?dryRun=1` reads only: per profile, the status the rows derive, the cached one, whether a real run would write or
// refuse the cache move, and whether it is a teacher — zero recomputes, zero writes, zero purges. The deploy-day check.
//
// Response — eno-cron.sh marks any non-200 FAILED, and keeps only the first 200 bytes, so the counts come first:
//   · 200 `{ ok: true, checked, recomputed, changed, failed: 0, illegal, trustMoved, purged, checkedAt }`
//     (a dry run adds `dryRun: true, mismatched, teachers, profiles` after the counts);
//   · 500 `{ ok: false, error: 'partial_failure', failed, … }` — a recompute threw or its effects did not complete. The
//     rest WERE reconciled; the unit stays red until a run finishes clean (each failure is in the log as
//     identity.reconcile or identity.effects.<step>).
//   · `illegal` (a cache move refused — out of `revoked`, say) is reported, NOT a failure: the cache is left as it was
//     for a person to look at, and the effects still ran on the derived status.
// Auth failures are route()'s 401; anything thrown is its generic 500.
export const GET = route({ auth: 'cron' }, async ({ req }) => {
  const params = new URL(req.url).searchParams
  // Fails SAFE, as licence-holds does: any dryRun value but an explicit 0 / false / no is a dry run — a typo such as
  // ?dryRun=true or ?dryrun=1 must never turn the deploy-day check into a real run.
  const dryKey = [...params.keys()].find((k) => /^dry[_-]?run$/i.test(k))
  const dryParam = dryKey === undefined ? null : params.get(dryKey)
  const dryRun = dryParam !== null && !/^(0|false|no)$/i.test(dryParam.trim())
  const r = await reconcileIdentities({ dryRun })
  if (r.failed > 0) {
    // `failed` right after the error, then the other counts — the journal's 200 bytes say how many and what ran.
    const { failed, ...counts } = r
    return NextResponse.json({ ok: false, error: 'partial_failure', failed, ...counts }, { status: 500 })
  }
  return { ok: true, ...r, checkedAt: new Date().toISOString() }
})
