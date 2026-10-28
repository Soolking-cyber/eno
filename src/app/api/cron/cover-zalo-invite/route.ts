import { route } from '@/lib/api/handler'
import { IS_MARKETPLACE } from '@/lib/edition'
import { runCoverZaloInvite } from '@/lib/teachers/zalo-invite'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

/**
 * The one-time "Zalo for urgent cover" invite (owner, 2026-10-29) — NO TIMER: the owner runs it by hand on the box,
 *   bash /opt/eno/bin/eno-cron.sh 'cover-zalo-invite?dryRun=1'      # counts only — nothing written, nothing sent
 *   bash /opt/eno/bin/eno-cron.sh cover-zalo-invite                  # sends (≤ 200 a run; run again for the rest)
 * Who, which channel and why never twice: src/lib/teachers/zalo-invite.ts. The answer stays under 200 bytes (eno-cron.sh
 * prints only the first 200) and names no one — the list of names is scripts/cover-zalo-invite-list.sql, read-only.
 * A run with failures goes red (500) at the end; one teacher's error never stops it.
 * ⛔ ONE SENDER: both editions share the database, and teachers live on eno.vn — marketplace only.
 */
export const GET = route({ auth: 'cron' }, async ({ req }) => {
  if (!IS_MARKETPLACE) return { ok: true, skipped: 'marketplace_only' }
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  const r = await runCoverZaloInvite({ dryRun })
  // A run that could not start for want of the desk's operator or its lock store is red too (commit review, opus: the
  // owner reads the colour); 'busy' and 'quiet' are a 200 — run it again later.
  const red = r.failed > 0 || r.stopped === 'no-operator' || r.stopped === 'lock-error' || r.stopped === 'stops-failed'
  const body = { ok: !red, ...r }
  return red ? Response.json(body, { status: 500 }) : body
})
