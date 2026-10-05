import { route } from '@/lib/api/handler'
import { sweepProofRetention } from '@/lib/schools/employment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Retention for /schools proofs of employment (src/lib/schools/employment.ts sweepProofRetention): LinkedIn
// URLs and codes erased 30 days after a decision, undecided proofs closed after 60 days. What the consent line
// at submission promises, kept on a schedule rather than whenever a moderator opens the admin page.
//
// Installed as a systemd timer by infra/vn-node/cron/install-cron-timers.sh; the box calls it on 127.0.0.1
// with the app's CRON_SECRET. One edition is enough — database work on the shared project, idempotent.
export const GET = route({ auth: 'cron' }, async () => {
  const result = await sweepProofRetention()
  return { ok: true, ...result, checkedAt: new Date().toISOString() }
})
