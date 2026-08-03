import 'server-only'
import { db } from '@/lib/db'

// ── VNPT free-tier quota, reserved atomically ───────────────────────────────────────────────────
//
// ⚠️ RESERVE BEFORE CALLING, IN ONE STATEMENT. qwen flagged the earlier shape: reading `used` and
// then incrementing lets two concurrent verifications both observe `limit - 1` and both proceed.
// On a metered API that is a small bill; on a FREE TIER it is a hard stop, and the overrun lands on
// whichever honest seller happens to be verifying at the time.
//
// `UPDATE ... SET used = used + 1 WHERE used < quota RETURNING used` makes the check and the
// increment a single atomic statement. No row returned means exhausted — Postgres arbitrates,
// not us. The CHECK constraint on the table is the belt to that braces: even a hand-written UPDATE
// cannot push `used` past `quota`.
//
// ⚠️ RESERVE BEFORE THE CALL, NOT AFTER. Incrementing on success undercounts every request that was
// billed and then failed — which is exactly the class VNPT charges for (a rejected document is
// still a processed request). Undercounting a free tier means discovering exhaustion by 429 rather
// than by our own accounting, one failed seller too late.

/** Monthly period key. VNPT free tiers are billed monthly; a date PK keeps the table trivially small. */
function periodOf(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
}

export const DEFAULT_QUOTA = Number(process.env.VNPT_MONTHLY_QUOTA || 0)

export type Reservation =
  | { ok: true; used: number; quota: number; remaining: number }
  | { ok: false; reason: 'exhausted' | 'unconfigured'; used?: number; quota?: number }

/**
 * Claim one call against this period's quota.
 *
 * ⚠️ `quota = 0` MEANS UNCONFIGURED, AND MUST NOT SILENTLY MEAN "UNLIMITED". VNPT has not told us
 * the free-tier ceiling yet (it is on the Plan Management page). Defaulting an unknown limit to
 * infinity would let a runaway retry loop drain the whole allowance before anyone noticed; treating
 * it as zero-and-refuse would block every seller for a number we simply have not typed in. So it
 * returns a DISTINCT `unconfigured` that the caller routes to manual review — the same
 * "we could not ask" handling as a provider outage, never a rejection of the person.
 */
export async function reserveQuota(now: Date = new Date(), count = 1): Promise<Reservation> {
  if (!DEFAULT_QUOTA) return { ok: false, reason: 'unconfigured' }
  const period = periodOf(now)

  // Create this period's row if it is the first call of the month. ON CONFLICT DO NOTHING so two
  // concurrent first-calls cannot both insert.
  await db.$executeRaw`
    INSERT INTO public.vnpt_quota (period, used, quota)
    VALUES (${period}::date, 0, ${DEFAULT_QUOTA})
    ON CONFLICT (period) DO UPDATE SET quota = EXCLUDED.quota
    -- ⚠️ DO UPDATE, NOT DO NOTHING (codex). With DO NOTHING an existing row keeps a STALE ceiling:
    -- raising the plan leaves sellers blocked at the old limit, and lowering it permits overuse.
    -- The configured value is the authority.
  `

  const rows = await db.$queryRaw<{ used: number; quota: number }[]>`
    UPDATE public.vnpt_quota
       SET used = used + ${count}, updated_at = now()
     WHERE period = ${period}::date
       AND used + ${count} <= quota
    RETURNING used, quota
  `
  const row = rows[0]
  if (!row) {
    const cur = await db.$queryRaw<{ used: number; quota: number }[]>`
      SELECT used, quota FROM public.vnpt_quota WHERE period = ${period}::date
    `
    return { ok: false, reason: 'exhausted', used: cur[0]?.used, quota: cur[0]?.quota }
  }
  return { ok: true, used: row.used, quota: row.quota, remaining: row.quota - row.used }
}

/**
 * Hand a reservation back when the call never reached VNPT.
 *
 * ⚠️ ONLY FOR CALLS THAT WERE NEVER MADE — a token failure, a validation refusal on our side. A
 * request VNPT actually processed is billed whether it verified or rejected, so releasing on a
 * REJECTION would systematically undercount and hide the approach of the ceiling.
 * ⚠️ Floors at zero so a double release cannot drive `used` negative and trip the CHECK constraint,
 * turning a bookkeeping slip into a hard failure for the next seller.
 */
export async function releaseQuota(now: Date = new Date(), count = 1): Promise<void> {
  const period = periodOf(now)
  await db.$executeRaw`
    UPDATE public.vnpt_quota
       SET used = GREATEST(0, used - ${count}), updated_at = now()
     WHERE period = ${period}::date
  `
}

export async function quotaSnapshot(now: Date = new Date()): Promise<{ used: number; quota: number } | null> {
  const rows = await db.$queryRaw<{ used: number; quota: number }[]>`
    SELECT used, quota FROM public.vnpt_quota WHERE period = ${periodOf(now)}::date
  `
  return rows[0] ?? null
}

/** Alert threshold — 80%. Warning at exhaustion is telling someone after it already broke. */
export function quotaState(used: number, quota: number): 'ok' | 'warn' | 'exhausted' {
  if (used >= quota) return 'exhausted'
  return used >= quota * 0.8 ? 'warn' : 'ok'
}
