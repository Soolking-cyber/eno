import 'server-only'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import { recomputeTrust } from '@/lib/trust'
import { syncEnforcement } from '@/lib/enforcement'
import { districtPagesOf, revalidateTeacherPages } from '@/lib/teachers/revalidate'
import type { VerificationStatus } from './account-state'

// ── WHAT AN IDENTITY RECOMPUTE MOVES BESIDE THE CACHE (owner, 2026-10-15) ───────────────────────────────────────────
//
// "A live verified identity counts in trust (+10) for every seller, on both editions — flat while current, gone on
// expiry or revocation, no penalty." So every identity recompute — an approval, a rejection, a submission, a
// revocation, the nightly reconcile — re-derives what reads that identity: the trust score (V_KYC) and, through it,
// the listings' rank key; the enforcement state built on the score; and a teacher's public pages, which bake both in.
//
// ⛔ CALLED ONLY BY recomputeVerification (recompute-verification.ts), WITH THE DERIVED STATUS — never the cache's
// answer, which an illegal transition leaves where it was. Trust does not even read the status: it re-reads the rows
// (computeTrustV2 → verifiedProfileIds). `derived` is here for the log line and for the mark sync C4 adds.
// ⛔ NO FLAG IN EITHER DIRECTION. An approval needs no "uncapped" or "approved": recomputeTrust lands the identity's own
// step in full on ANY recompute and keeps everything else capped (trust.ts, R1) — an uncapped recompute would land a
// whole review backlog beside the +10. A revocation or a lapse needs none either: downward moves always land in full.
// ⚠️ EACH STEP HAS ITS OWN GUARD — FAIL-QUIET. A KYC decision, a revocation or the reconcile never fails over a side
// effect: a step that throws is logged (op identity.effects.<step>), marks the result `failed`, and the next step
// still runs. The nightly reconcile (/api/cron/identity-reconcile) re-runs all of it, so a failed step is retried
// within a day — it counts `failed` and its unit goes red until one succeeds.
// ⚠️ syncEnforcement CAN SPEAK. Losing the +10 can take a seller under 60 (the restricted tier) and, with conduct on
// the record, into `throttled`; gaining it can lift a throttle. Each transition sends its bell + push
// (enforcement.ts notifyEnforcement) — which is why the reconcile runs at 09:05 ICT, so ITS notices land in the day.
// ⚠️ It cannot promise that for every recompute: a lapse takes effect at 00:00 ICT, so any recompute another path runs
// in the night (an admin settling a report at 01:00, a seller's own KYC submission at 02:00) drops the +10 then, with
// whatever notice that triggers.
// ⚠️ THE PURGE IS LAST AND UNCONDITIONAL FOR A TEACHER ACCOUNT, by the rule in src/lib/teachers/revalidate.ts (no
// "nothing changed" skip): /c/teachers, its district pages, the profile page and '/' bake the score and the order,
// and judging "unchanged" would need the before-and-after state of every writer. Bounded: submissions are capped at
// five a day, decisions are an admin's, and the reconcile walks only accounts that have an identity row. A
// non-teacher has no page of its own to purge — the trust cascade has already re-ranked its listings.

export type IdentityEffects = {
  /** The persisted trust score moved (recomputeTrust's score differs from the one it found cached). */
  trustMoved: boolean
  /** The teacher card's identity tick changed — the mark sync C4 adds before the purge; false until it does. */
  markChanged: boolean
  /** A teacher account's public pages were purged (revalidateTeacherPages). */
  purged: boolean
  /** A step threw. Logged; the reconcile counts the profile as failed. */
  failed: boolean
}

/**
 * Re-derive what reads this profile's identity, in order: trust, then enforcement on that breakdown, then — for an
 * account that owns a TeacherProfile — its pages, LAST. Never throws.
 *
 * `now` is the instant the status was derived at (recomputeVerification's clock), for the mark sync C4 adds. Trust
 * reads the wall clock, as every recompute does — the same call, so the same ICT day.
 */
export async function applyIdentityEffects(profileId: string, derived: VerificationStatus, now: Date): Promise<IdentityEffects> {
  const out: IdentityEffects = { trustMoved: false, markChanged: false, purged: false, failed: false }
  const step = async <T>(op: string, fn: () => T | Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      out.failed = true
      try { logError(e, { op: `identity.effects.${op}`, profileId, derived }) } catch { /* the logger never throws; belt and braces */ }
      return fallback
    }
  }

  // 1. TRUST — V_KYC follows the live identity; the guarded cascade re-ranks the seller's listings when it moves.
  const res = await step('trust', () => recomputeTrust(profileId), null)
  if (res) {
    out.trustMoved = res.score !== res.breakdown.cached.score
    // 2. ENFORCEMENT on that same breakdown and the PERSISTED score, as every recompute's caller does
    // (trust.ts runTrustMaintenance, settleReportCharges). No breakdown, nothing to derive from: skipped, and the
    // reconcile retries it with the trust step. (syncEnforcement is fail-quiet itself; the guard is belt and braces.)
    await step('enforcement', () => syncEnforcement(profileId, res.breakdown, { persistedScore: res.score }), undefined)
  }

  // 3. A TEACHER'S PAGES. A failed read is a failed step and purges nothing — it cannot know the listing or the
  // districts, and the reconcile retries.
  const tp = await step(
    'teacher',
    () => db.teacherProfile.findUnique({ where: { profileId }, select: { listingId: true, currentDistrictKey: true, currentDistrict: true } }),
    null,
  )
  if (!tp) return out
  // [C4: the identity-mark card sync goes HERE — after trust, before the purge, which carries its change too.]
  await step('purge', () => {
    revalidateTeacherPages(tp.listingId, districtPagesOf(tp))
    out.purged = true
  }, undefined)
  return out
}
