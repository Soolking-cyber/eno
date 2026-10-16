import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { reconcileIdentityMarks } from '@/lib/compliance/identity-reconcile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// One sync per selected teacher — every teacher holding an identity row, every card carrying a value, every hide of the
// last 7 days (a handful: 2–3 identity holders on 2026-10-15) — sequential, each a lock, two reads and one guarded
// UPDATE. eno-cron.sh allows 900s; give the pass a cursor long before the identity holders number in the thousands.
export const maxDuration = 300

// ── THE TEACHER CARD'S "IDENTITY VERIFIED" TICK, RE-DERIVED AT 00:05 ICT (review, 2026-10-16) ──────────────────────────
//
// The owner's rule: the mark shows "only while the identity check is LIVE". A document lapses at 00:00 ICT the day after
// its expiry date (src/lib/compliance/derive-verification.ts) — a clock, not an event, so no decision, save or recompute
// re-derives the card's display cache at that moment, and the nightly identity reconcile (/api/cron/identity-reconcile)
// runs at 09:05 ICT. Without this run every card, and the profile line its ISR page baked in, would keep saying
// "Identity verified" for nine hours after each lapse. So the reconcile's card-tick pass runs here ALONE, five minutes
// after midnight (src/lib/compliance/identity-reconcile.ts reconcileIdentityMarks): every teacher whose account holds an
// identity row, whose card cache carries a value, or who hid the mark in the last 7 days is synced from the LIVE identity
// (syncIdentityMarkCard — the cache's one writer, under the teacher lock), and their pages are purged when the cache
// changed, every night for an identity holder who has not hidden the mark (AUTOMATIC since 2026-10-16 — so a failed
// purge of a lapse or a revocation is retried), and for 7 nights after a hide.
// ⛔ NOTHING ELSE: no recompute, no verification cache, no trust, no enforcement — the things that can send a bell or a
// push stay at 09:05 (the reconcile's header says why), so this run is silent at any hour. That is also why its timer IS
// replayed at boot when missed, where the reconcile's is not.
// ⚠️ ONE EDITION IS ENOUGH: both apps share the database and the ISR invalidation table (a purge on eno.vn purges both),
// so the timer is pinned to eno.vn:3001 whatever host the installer is run for.
// ⚠️ THE BACKFILL: after the deploy that made the mark AUTOMATIC (2026-10-16), and after any IDENTITY_MARK_NOTICE_VERSION
// bump or rule change that adds ticks (src/lib/teachers/constants.ts), run THIS once by hand — `?dryRun=1` first: its
// selection covers every identity holder, so it writes every card the rule now shows, clears the old version from every
// other, and purges the HTML that baked either in (Next's ISR cache survives a deploy). /api/cron/identity-reconcile does
// the same through its loop (and trust with it); until one of them runs, a verified teacher's card has no tick.
//
// `?dryRun=1` reads only: each selected teacher's mark judged with the same predicate against the stored cache — zero
// syncs, zero writes, zero purges — and how many caches would change, how many pages would be purged, how many cards
// would show the tick.
//
// Response — eno-cron.sh marks any non-200 FAILED and keeps only the first 200 bytes, so the counts come first:
//   · 200 `{ ok: true, checked, changed, purged, failed: 0, checkedAt }` (a dry run adds `shown` and `dryRun: true`);
//   · 500 `{ ok: false, error: 'partial_failure', failed, checked, changed, purged }` — the selection could not be read,
//     or a teacher's sync or purge threw (logged as identity.reconcile.mark). The rest WERE synced; the unit stays red
//     until a run finishes clean.
// Auth failures are route()'s 401; anything thrown is its generic 500.
export const GET = route({ auth: 'cron' }, async ({ req }) => {
  const params = new URL(req.url).searchParams
  // Fails SAFE, as identity-reconcile and licence-holds do: any dryRun value but an explicit 0 / false / no is a dry run.
  const dryKey = [...params.keys()].find((k) => /^dry[_-]?run$/i.test(k))
  const dryParam = dryKey === undefined ? null : params.get(dryKey)
  const dryRun = dryParam !== null && !/^(0|false|no)$/i.test(dryParam.trim())
  const r = await reconcileIdentityMarks({ dryRun })
  if (r.failed > 0) {
    // `failed` right after the error, then the other counts — the journal's 200 bytes say how many and what ran.
    const { failed, ...counts } = r
    return NextResponse.json({ ok: false, error: 'partial_failure', failed, ...counts }, { status: 500 })
  }
  return { ok: true, ...r, checkedAt: new Date().toISOString() }
})
