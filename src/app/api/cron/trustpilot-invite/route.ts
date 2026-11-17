import { route } from '@/lib/api/handler'
import { IS_MARKETPLACE } from '@/lib/edition'
import { adminEmails } from '@/lib/admin'
import { HIDDEN_DESK_OWNER_EMAILS } from '@/lib/edition-scope'
import { rentalOperatorEmail } from '@/lib/rental-check/desk'
import { jobsOperatorEmail } from '@/lib/teachers/job-dms/desk'
import { TRUSTPILOT_INVITE, countTrustpilotInvites, sendTrustpilotInvites } from '@/lib/trustpilot-invite'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * The Trustpilot invite (owner, 2026-11-17) — one in-app bell per account, never twice, no push. Who and when:
 * src/lib/trustpilot-invite.ts. Daily at 10:15 ICT, at most TRUSTPILOT_INVITE.maxPerRun a run (the next run carries on).
 * ⛔ MARKETPLACE ONLY: the excluded addresses come from THIS container's env (ADMIN_EMAILS and the desk operators), and
 * the forum's may differ — the database dedupe stops a second ask, not an ask to someone the other list excludes.
 * `?dryRun=1` counts who is due — nothing written. A database error is a 500 (the unit goes red). The answer stays under
 * 200 bytes (eno-cron.sh prints only the first 200) and names no one.
 */
export const GET = route({ auth: 'cron' }, async ({ req }) => {
  if (!IS_MARKETPLACE) return { ok: true, skipped: 'marketplace_only' }
  // No empty entry: `x <> ALL(array with '')` stays true, but a NULL would make it NULL and silently drop everyone (the gate, 11-17).
  const excluded = [...adminEmails(), ...HIDDEN_DESK_OWNER_EMAILS, rentalOperatorEmail(), jobsOperatorEmail()].filter((e): e is string => typeof e === 'string' && e.length > 0).map((e) => e.toLowerCase())
  if (new URL(req.url).searchParams.get('dryRun') === '1') {
    const eligible = await countTrustpilotInvites(excluded)
    return { ok: true, dryRun: true, eligible, wouldInvite: Math.min(eligible, TRUSTPILOT_INVITE.maxPerRun) }
  }
  return { ok: true, invited: await sendTrustpilotInvites(excluded) }
})
