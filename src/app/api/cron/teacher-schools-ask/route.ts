import { route } from '@/lib/api/handler'
import { IS_MARKETPLACE, SITE_NAME } from '@/lib/edition'
import { adminEmails } from '@/lib/admin'
import { HIDDEN_DESK_OWNER_EMAILS } from '@/lib/edition-scope'
import { rentalOperatorEmail } from '@/lib/rental-check/desk'
import { jobsOperatorEmail, resolveJobsOperatorProfileId } from '@/lib/teachers/job-dms/desk'
import { isQuiet } from '@/lib/teachers/job-dms/run'
import {
  SCHOOLS_ASK, emailSchoolsAsk, inEmailWindow, schoolStats, schoolsAskCandidates, schoolsAskEmailsOwed, schoolsAskEmailsToday,
  schoolsAskReady, sendSchoolsAskMessage,
} from '@/lib/teachers/schools-ask'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 600

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`

/**
 * The schools ask (owner, 2026-11-20) — who, what and the email budget: src/lib/teachers/schools-ask.ts. Daily at 08:20
 * ICT (POLICY timer: installed, enabled by hand after a dry run), at most SCHOOLS_ASK.perRun chat messages a run and
 * SCHOOLS_ASK.emailsPerDay emails a day, emails only inside the window before the digest. Quiet 21:00–08:00 ICT.
 * ⛔ MARKETPLACE ONLY (teachers live on eno.vn); the excluded addresses are this container's admins and desk operators.
 * `?dryRun=1` counts — nothing written, nothing sent. One teacher's error never stops the run (counted `failed`, a 500 at
 * the end). The answer stays under 200 bytes (eno-cron.sh prints only the first 200) and names no one.
 */
export const GET = route({ auth: 'cron' }, async ({ req }) => {
  if (!IS_MARKETPLACE) return { ok: true, skipped: 'marketplace_only' }
  if (!(await schoolsAskReady())) return { ok: true, skipped: 'no_table' }
  const now = new Date()
  const excluded = [...adminEmails(), ...HIDDEN_DESK_OWNER_EMAILS, rentalOperatorEmail(), jobsOperatorEmail()]
    .filter((e): e is string => typeof e === 'string' && e.length > 0).map((e) => e.toLowerCase())
  const candidates = await schoolsAskCandidates(now, excluded)
  if (new URL(req.url).searchParams.get('dryRun') === '1') {
    const owed = (await schoolsAskEmailsOwed(excluded)).length
    return { ok: true, dryRun: true, eligible: candidates.length, withEmail: candidates.filter((c) => c.emailOk).length, owed, wouldAsk: Math.min(candidates.length, SCHOOLS_ASK.perRun) }
  }
  if (isQuiet(now)) return { ok: true, stopped: 'quiet' }
  const operatorId = await resolveJobsOperatorProfileId()
  if (!operatorId) return { ok: false, error: 'no_operator' }
  const stats = await schoolStats()
  let asked = 0, held = 0, failed = 0, emailed = 0, emailFailed = 0
  let emailBudget = inEmailWindow(now) ? Math.max(0, SCHOOLS_ASK.emailsPerDay - (await schoolsAskEmailsToday(now))) : 0
  let mailStopped = false
  const email = async (t: Parameters<typeof emailSchoolsAsk>[0]) => {
    if (mailStopped || emailBudget <= 0 || !inEmailWindow(new Date())) return
    try {
      const r = await emailSchoolsAsk(t, stats, ORIGIN)
      if (r === 'sent' || r === 'unknown') { emailed++; emailBudget-- }
      else if (r === 'stop') mailStopped = true
      else if (r === 'refused') emailFailed++
    } catch (e) {
      emailFailed++
      console.error('[schools-ask] email', e)
    }
  }
  // Emails a refused send left owed first, then new asks.
  for (const t of await schoolsAskEmailsOwed(excluded)) await email(t)
  for (const t of candidates.slice(0, SCHOOLS_ASK.perRun)) {
    if (isQuiet(new Date())) break
    try {
      if ((await sendSchoolsAskMessage(t, operatorId, stats, ORIGIN)) === 'held') { held++; continue }
      asked++
      await email(t)
    } catch (e) {
      failed++
      console.error('[schools-ask] ask', e)
    }
  }
  const out = { ok: failed === 0, asked, held, failed, emailed, emailFailed, left: Math.max(0, candidates.length - asked - held - failed) }
  return failed > 0 ? Response.json(out, { status: 500 }) : out
})
