import { route } from '@/lib/api/handler'
import { IS_MARKETPLACE } from '@/lib/edition'
import {
  JOB_DM_INVITE, claimAndInvite, countInviteCandidates, inviteIsQuiet, loadInviteCandidates,
} from '@/lib/teachers/job-dms/invite'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

/**
 * The job-messages NOTICE (owner, 2026-10-20; ON by default since 2026-10-21) — ONE in-app bell per live teacher not yet told (no web
 * push: the push permission was given for messages, not for news of a feature — opus, gate 5b, Decree 91/2020),
 * pointing at /teachers/job-messages. Who, and why never twice: src/lib/teachers/job-dms/invite.ts.
 * Daily (a new teacher is invited on the next run): at most JOB_DM_INVITE.maxPerRun a run (`stopped: 'ceiling'`, a 200 —
 * the next run carries on), and none 21:00–08:00 Vietnam time (`stopped: 'quiet'`, a 200 — checked at the start and
 * before every teacher, so a run that crosses 21:00 stops there).
 * ⛔ ONE TEACHER'S ERROR NEVER STOPS THE RUN: a claim that throws wrote nothing (one transaction) — counted `failed`, and
 * the unit goes red (500) at the end.
 * ⛔ ONE SENDER: both editions share the database, and teachers live on eno.vn — marketplace only.
 * `?dryRun=1` counts who WOULD be invited — nothing claimed, nothing written, nothing sent. The answer stays under 200
 * bytes (eno-cron.sh prints only the first 200) and names no one.
 */
export const GET = route({ auth: 'cron' }, async ({ req }) => {
  if (!IS_MARKETPLACE) return { ok: true, skipped: 'marketplace_only' }
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  const quiet = inviteIsQuiet(Date.now())
  const eligible = await countInviteCandidates()
  if (dryRun) return { ok: true, dryRun: true, eligible, wouldInvite: quiet ? 0 : Math.min(eligible, JOB_DM_INVITE.maxPerRun), quiet }
  if (quiet) return { ok: true, invited: 0, left: eligible, stopped: 'quiet' }

  const ids = eligible ? await loadInviteCandidates(JOB_DM_INVITE.maxPerRun) : []
  let invited = 0, skipped = 0, failed = 0, tried = 0
  let stopped: 'quiet' | 'ceiling' | null = null
  for (const profileId of ids) {
    if (inviteIsQuiet(Date.now())) { stopped = 'quiet'; break }
    tried++
    let claimed: boolean
    try {
      claimed = await claimAndInvite(profileId)
    } catch (e) {
      failed++
      // Ids and an error CODE only — never a message, which can quote a query.
      console.error('[job-dms-invite] teacher failed — run continues', { profileId, error: (e as { code?: string })?.code ?? (e as Error)?.name })
      continue
    }
    if (!claimed) { skipped++; continue }
    invited++
  }
  // A run that loaded fewer than its ceiling loaded everyone left; only a full load (or the quiet hours) leaves some over.
  const more = stopped === 'quiet' || ids.length === JOB_DM_INVITE.maxPerRun
  // A teacher whose claim FAILED is still to be invited: counted as left, not as done (codex, gate 5a).
  const left = more ? Math.max(0, eligible - tried + failed) : failed
  if (!stopped && more && left > 0) stopped = 'ceiling'
  const body = { ok: failed === 0, invited, skipped, failed, left, ...(stopped ? { stopped } : {}) }
  return failed > 0 ? Response.json(body, { status: 500 }) : body
})
