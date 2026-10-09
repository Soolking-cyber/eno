import { createHash } from 'node:crypto'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { sendMailOnce, mailEnabled, type OnceResult } from '@/lib/mail'
import { mintUnsubscribeToken } from '@/lib/unsubscribe-token'
import { renderTeacherMatches } from '@/lib/emails/teacher-matches'
import { IS_MARKETPLACE, SITE_NAME } from '@/lib/edition'
import { EMAIL_TEACHER_SELECT } from '@/lib/teachers/match-io'
import {
  MAILABLE_TEACHER_WHERE, loadCooling, loadPendingMatchRows, mailableMatchWhere, matchEmailJob, matchEmailResult, planMatchEmails,
} from '@/lib/teachers/match-emails'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

/**
 * Email each opted-in teacher the NEW jobs the local matcher found for them (2026-09-30; the /teachers flow 2026-10-08).
 *
 * ⛔ WHO SENDS IT: the owner's daily /teachers skill starts `eno-cron-teacher-match-emails.service` on the box AFTER the
 * owner approved that day's plan — the unit has NO timer at all (infra/vn-node/cron/install-cron-timers.sh MANUAL, since
 * the gate review of 2026-10-08: a disabled timer was one pasted cutover line away from a 10:30 send nobody approved).
 * ⛔ WHAT GOES OUT: src/lib/teachers/match-emails.ts — the ONE rule the plan was made with (opt-in under the current AI
 * notice, judged by Claude Haiku 5.5 after that consent, ≤ 5 jobs, ≤ 1 email per teacher per 3 days, no visa wording).
 * ⛔ NEVER THE SAME MATCH TWICE: the rows are CLAIMED (emailedAt flipped from null) BEFORE the send, and the send carries
 * an idempotency key made of the teacher and the claimed match ids (sendMailOnce).
 * ⛔ THE CLAIM IS THE SELECTION, RE-READ ATOMICALLY (gate review, 2026-10-08 — codex + Opus): its UPDATE carries the whole
 * mailableMatchWhere — the email consent under the current notice, a live profile with a live listing, a live TEACHING
 * job, the v2 judge, the freshness as of this run's start — plus the consent GRANT the plan saw (matchEmailOptInAt). A job
 * or a profile pulled mid-run, or a consent withdrawn and re-granted (the rule mails only matches judged after the current
 * grant), between the read and the claim, claims less than the plan: released, skipped, never mailed. Then:
 *   · 'sent'    → the claim stays;
 *   · 'refused' → Resend proved nothing was sent: the claim is released for a later run (a 429 is first retried once,
 *                 after its retry-after); with `stopRun` (quota, key, sender) the run ends there, since every later send
 *                 would fail the same way;
 *   · 'unknown' → retried ONCE after UNKNOWN_RETRY_MS with the same key (Resend answers a same-key repeat with the first
 *                 result for 24 h); still not 'sent' → the claim is KEPT, so the match is never emailed twice — at worst it
 *                 is lost. Counted as `unknown` and logged with the teacher and match ids (no address) for a check in Resend.
 *   A crash between the claim and the send keeps the claim too: lost, never doubled.
 * ⛔ SEQUENTIAL AND PACED, NOT A FAN-OUT. Resend allows 10 requests/second PER TEAM, and that budget is shared with the
 * sign-in mail and the other box crons (daily-reminders 02:00, saved-search-alerts 05:00, the weekly digest Thu 02:00
 * UTC). GAP_MS between sends, plus each send's own round trip, keeps this route at ~5 requests/second or less; after a
 * 429 the rest of the run slows to one send per second.
 * ⛔ ONE SENDER: teachers sign up on eno.vn (teacher.eno.vn), and both editions share the database — two senders would
 * race for the same rows and brand the email by whichever won (Opus, gate 09-30). Marketplace only.
 * ⛔ THE ANSWER STAYS UNDER 200 BYTES: eno-cron.sh prints only the first 200, and the /teachers send records that line.
 * 200 when nothing a retry could fix failed; 500 when a send was refused or the run stopped early — so the unit fails and
 * the skill records a failed send (a retry re-sends only the released, refused rows; `unknown` rows keep their claim).
 */
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`
const GAP_MS = 150
const SLOW_GAP_MS = 1000
const UNKNOWN_RETRY_MS = 5000
const RATE_RETRY_MS = 1000
const MAX_RETRY_WAIT_MS = 10_000
/** No send STARTS after this: eno-cron.sh gives the request 900 s, and the run must answer inside it. */
const RUN_DEADLINE_MS = 12 * 60 * 1000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const GET = route({ auth: 'cron' }, async () => {
  if (!IS_MARKETPLACE) return { ok: true, skipped: 'marketplace_only' }
  if (!mailEnabled()) return { ok: true, mail: 'disabled' }
  const startedAt = Date.now()
  // The cooldown FIRST: the read below leaves those teachers out before its row cap (match-emails.ts).
  const cooling = await loadCooling(db, startedAt)
  const plan = planMatchEmails(await loadPendingMatchRows(db, startedAt, cooling), cooling)
  const ids = plan.teachers.map((t) => t.teacherProfileId)
  const found = ids.length
    ? await db.teacherProfile.findMany({
        // Consent and liveness again, read now — the claim below checks the whole condition once more, atomically.
        where: { id: { in: ids }, ...MAILABLE_TEACHER_WHERE },
        select: EMAIL_TEACHER_SELECT,
      })
    : []
  const byId = new Map(found.map((t) => [t.id, t]))

  let sent = 0, failed = 0, unknown = 0, skipped = 0, left = 0
  let stopped: string | null = null
  let gap = GAP_MS
  for (const [i, { teacherProfileId, matches }] of plan.teachers.entries()) {
    if (Date.now() - startedAt > RUN_DEADLINE_MS) { stopped = 'deadline'; left = plan.teachers.length - i; break }
    const t = byId.get(teacherProfileId)
    const to = t ? t.private?.email || t.profile.email : null
    // Minted BEFORE the claim, so a missing token can never leave rows claimed-but-unsent.
    const token = t ? mintUnsubscribeToken(t.profileId) : null
    if (!t || !to || !token) { skipped++; continue }

    // ⛔ CLAIM BEFORE SENDING — and only while the WHOLE rule still holds (mailableMatchWhere, as of this run's start) under
    // the SAME consent grant the plan saw: rows this run flips from null are the only ones it mails, so a second run at the
    // same moment (a manual start, the other edition) finds nothing to send, and a grant withdrawn and given again since the
    // read (a newer matchEmailOptInAt — these rows were judged before it) claims nothing.
    const matchIds = matches.map((m) => m.id)
    const grantedAt = matches[0]?.teacherProfile?.matchEmailOptInAt ?? null
    if (!grantedAt) { skipped++; continue } // planMatchEmails never plans one without it; never claim on a guess
    const claimAt = new Date()
    const claimed = await db.teacherJobMatch.updateMany({
      where: { ...mailableMatchWhere(startedAt, { ...MAILABLE_TEACHER_WHERE, matchEmailOptInAt: grantedAt }), id: { in: matchIds } },
      data: { emailedAt: claimAt },
    })
    const release = () => db.teacherJobMatch.updateMany({ where: { id: { in: matchIds }, emailedAt: claimAt }, data: { emailedAt: null } })
    if (claimed.count !== matchIds.length) {
      // Someone else got there (fully or partly), or the rule stopped holding for a row: release ours, leave this teacher.
      await release()
      skipped++; continue
    }

    const unsubscribeUrl = `${ORIGIN}/unsubscribe?token=${encodeURIComponent(token)}&list=teacher-matches`
    const { subject, html, text } = renderTeacherMatches({
      jobs: matches.map((m) => matchEmailJob(m, ORIGIN)), origin: ORIGIN, unsubscribeUrl, recipientName: t.fullName, siteName: SITE_NAME,
    })
    const msg = {
      to, subject, html, text,
      // RFC 8058 one-click: the mail client POSTs here, and /api/unsubscribe switches matchEmailOptIn off and stamps
      // the withdrawal. The visible footer link opens the /unsubscribe page.
      headers: {
        'List-Unsubscribe': `<${ORIGIN}/api/unsubscribe?token=${encodeURIComponent(token)}&list=teacher-matches>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }
    // ⚠️ THE KEY IS THIS RUN'S (`startedAt`): it makes one run's retries of one send idempotent, nothing more (commit gate,
    // 2026-10-09 — Opus). Keyed on the matches alone, a later run re-sending rows an earlier send released (refused) reused
    // that key inside Resend's 24 h window — a changed body answers 409 `invalid_idempotent_request`, read as "unknown", the
    // claim kept and the match never mailed. Across runs nothing double-sends: an unclear send keeps its claim.
    const idempotencyKey = `teacher-matches/${startedAt}/${teacherProfileId}/${createHash('sha256').update([...matchIds].sort().join(',')).digest('hex')}`

    let r: OnceResult = await sendMailOnce(msg, { idempotencyKey })
    if (r.outcome === 'refused' && r.name === 'rate_limit_exceeded') {
      // Nothing was sent: wait as Resend asks, then once more under the same key — and slow the rest of the run down.
      gap = SLOW_GAP_MS
      await sleep(Math.min(r.retryAfterMs ?? RATE_RETRY_MS, MAX_RETRY_WAIT_MS))
      r = await sendMailOnce(msg, { idempotencyKey })
    }
    if (r.outcome === 'unknown') {
      await sleep(UNKNOWN_RETRY_MS)
      r = await sendMailOnce(msg, { idempotencyKey, afterUnknown: true })
    }

    if (r.outcome === 'sent') sent++
    else if (r.outcome === 'refused') {
      failed++
      await release()
      if (r.stopRun) { stopped = r.name ?? 'refused'; left = plan.teachers.length - i - 1; break }
    } else {
      unknown++
      // ⛔ THE CLAIM STAYS: Resend may have sent it. Ids only — never the address — for a look in Resend's log.
      console.error('[teacher-match-emails] unclear send — claim kept', { teacherProfileId, matchIds, error: r.name })
    }
    await sleep(gap)
  }

  // { ok, rules, teachers, sent, failed, unknown, skipped } (+ stopped, left) — under 200 bytes, always (match-emails.ts).
  const body = matchEmailResult({ teachers: plan.teachers.length, sent, failed, unknown, skipped, stopped, left })
  return failed > 0 || stopped ? Response.json(body, { status: 500 }) : body
})
