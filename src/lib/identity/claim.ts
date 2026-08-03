import 'server-only'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'

// ── Leased verification claim: idempotency, per-profile mutex, and attempt accounting ───────────
//
// Three plan-review rounds converged on this shape. What it replaced, and why:
//
// ⚠️ A LEASE, NOT AN `in_flight` FLAG. A permanent flag deadlocks on any crash mid-call: the claim
// stays in-flight and every replay 409s forever, so a server restart during someone's verification
// bricks their account. `leaseUntil` is evaluated on READ, so an abandoned attempt self-heals —
// there is no reaper job to forget to schedule.
//
// ⚠️ THE CLAIM ROW IS THE MUTEX, so no Postgres advisory lock is held across the VNPT call. Holding
// one would pin a database connection through a ~3-minute external request; under any load that
// exhausts the pool and takes down far more than verification.
//
// ⚠️ ATTEMPT LIMITS ARE DERIVED FROM THESE ROWS, NOT FROM A COUNTER. A pre-incremented counter
// leaks on every crash — the claim heals, the counter does not — so a provider outage still burned
// the seller's attempts and locked them out through a different door. That was the round-1 lockout
// reappearing in a new place, and all three reviewers found it again. Counting rows means an
// abandoned attempt simply stops counting: nothing to release, nothing to leak.
//
// ⚠️ EXACTLY-ONCE VNPT SPEND IS IMPOSSIBLE AND THIS DOES NOT CLAIM IT. VNPT's API accepts no
// idempotency key, so a timeout after they processed a request is inherently ambiguous — we cannot
// know whether it was billed. This design BOUNDS duplication (one in-flight attempt per profile, a
// lease longer than the flow's own timeout budget, a global daily ceiling); it does not eliminate
// it. Anyone tightening the claim should read codex's round-3 finding first.

/** Longer than the flow's worst case (7 calls × 30s) so a live call is never overtaken. */
const LEASE_MS = 5 * 60_000
const WINDOW_MS = 24 * 60 * 60_000

export type ClaimState = 'in_flight' | 'done'

export type ClaimResult =
  | { ok: true; attempt: number }
  /** Someone else holds a live lease — a genuine concurrent submission. */
  | { ok: false; reason: 'in_flight'; retryAfterSec: number }
  /** Same key AND same bytes as a completed attempt: return the stored answer, do not re-run. */
  | { ok: false; reason: 'replay'; outcome: unknown }

/**
 * ⚠️ THE KEY IS BOUND TO THE PROFILE *AND* THE BYTES. codex caught that a key scoped only to the
 * profile lets a client reuse it with DIFFERENT documents and receive the previous answer — a
 * verified result for a passport nobody checked. Different bytes must be a MISS, not a cache hit.
 */
export function requestHash(tier: string, files: Uint8Array[]): string {
  const h = createHash('sha256').update(tier)
  for (const f of files) h.update(createHash('sha256').update(f).digest())
  return h.digest('hex')
}

/**
 * Claim the right to run one verification, atomically.
 *
 * ⚠️ ONE STATEMENT. The check ("is anyone running?") and the acquisition are the same UPDATE, so
 * two tabs cannot both observe "free" and both proceed. Postgres arbitrates, not us.
 */
export async function claimVerification(
  profileId: string,
  key: string,
  reqHash: string,
  now: Date = new Date(),
): Promise<ClaimResult> {
  const lease = new Date(now.getTime() + LEASE_MS)

  const rows = await db.$queryRaw<{ attempt: number }[]>`
    INSERT INTO public.identity_claim (profile_id, key, request_hash, state, attempt, lease_until, updated_at)
    VALUES (${profileId}::uuid, ${key}, ${reqHash}, 'in_flight', 1, ${lease}, now())
    ON CONFLICT (profile_id) DO UPDATE
       SET key = EXCLUDED.key, request_hash = EXCLUDED.request_hash, state = 'in_flight',
           attempt = identity_claim.attempt + 1, lease_until = EXCLUDED.lease_until,
           outcome = NULL, updated_at = now()
     WHERE identity_claim.state <> 'in_flight'
        OR identity_claim.lease_until < now()
    RETURNING attempt
  `
  if (rows[0]) return { ok: true, attempt: rows[0].attempt }

  // No row means the conflicting claim is genuinely live, OR it is a completed replay.
  const cur = await db.$queryRaw<{ key: string; request_hash: string; state: string; outcome: unknown; lease_until: Date }[]>`
    SELECT key, request_hash, state, outcome, lease_until FROM public.identity_claim WHERE profile_id = ${profileId}::uuid
  `
  const c = cur[0]
  if (c && c.state === 'done' && c.key === key && c.request_hash === reqHash) {
    return { ok: false, reason: 'replay', outcome: c.outcome }
  }
  const wait = c ? Math.max(1, Math.ceil((c.lease_until.getTime() - now.getTime()) / 1000)) : 30
  return { ok: false, reason: 'in_flight', retryAfterSec: wait }
}

/**
 * Record the outcome.
 *
 * ⚠️ FENCED BY `attempt`. After a lease takeover the ORIGINAL request can still finish and would
 * otherwise overwrite the newer attempt's result with a stale one (codex). The write only applies
 * if the attempt number is still the one this caller started with.
 */
export async function completeClaim(
  profileId: string,
  attempt: number,
  outcome: unknown,
): Promise<boolean> {
  const n = await db.$executeRaw`
    UPDATE public.identity_claim
       SET state = 'done', outcome = ${JSON.stringify(outcome)}::jsonb, updated_at = now()
     WHERE profile_id = ${profileId}::uuid AND attempt = ${attempt}
  `
  return n > 0
}

/**
 * Attempts in the trailing 24h, counted from claim rows.
 *
 * ⚠️ ABANDONED ATTEMPTS DO NOT COUNT. A crash leaves an expired in-flight claim; counting it would
 * charge the seller for our outage. Only completed attempts and genuinely-live ones count.
 */
export async function recentAttempts(profileId: string, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - WINDOW_MS)
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM public.identity_claim
     WHERE profile_id = ${profileId}::uuid
       AND created_at >= ${since}
       AND (state = 'done' OR lease_until > now())
  `
  return Number(rows[0]?.n ?? 0)
}

export const MAX_ATTEMPTS_PER_DAY = 5
