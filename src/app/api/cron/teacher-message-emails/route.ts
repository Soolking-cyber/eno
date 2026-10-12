import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { sendMailOnce, mailEnabled, type OnceResult } from '@/lib/mail'
import { mintUnsubscribeToken } from '@/lib/unsubscribe-token'
import { renderTeacherMessages } from '@/lib/emails/teacher-messages'
import { IS_MARKETPLACE, SITE_NAME } from '@/lib/edition'
import {
  MESSAGE_EMAIL_RULES, claimMessageEmail, loadNewEmailsLast24h, loadUnreadTeacherThreads, messageEmailResult, planMessageEmails,
  releaseMessageEmail, type TeacherEmailState,
} from '@/lib/teachers/message-emails'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

/**
 * Email teachers about school messages (owner, 2026-10-12) — every 30 minutes, so the first email lands within the hour.
 * WHAT GOES OUT: src/lib/teachers/message-emails.ts — someone new → at once (≤ 8 in 24 h); otherwise one reminder a day,
 * in the 08:00 Vietnam run, while anything is unread; live teachers only; one email per teacher per run, no school name,
 * no message text.
 *
 * ⛔ NEVER TWICE: the teacher's state row is CLAIMED (compare-and-set on lastEmailAt, plus the "someone new" thread rows)
 * in one transaction BEFORE the send, re-checking that something is still unread; the send carries an idempotency key
 * made of the teacher and the claim's time. Then — the teacher-match-emails contract, unchanged:
 *   · 'sent'    → the claim stays;
 *   · 'refused' → nothing went out. A 429 is first retried once after its retry-after; a rate limit or a run-wide
 *                 refusal (`stopRun`: quota, key, sender) RELEASES the claim (conditionally — only if it is still ours) for
 *                 a later run and fails the unit, `stopRun` ending the run. A refusal of THIS message (validation — the
 *                 address comes from sign-in, so in practice a header or template fault) PARKS the claim: counted `invalid`,
 *                 the unit fails, and that teacher is tried again only at their next trigger (tomorrow's reminder, a new
 *                 school) — never every 30 minutes (Opus, gate rounds 1–3: released, a bad row retried and reddened the
 *                 unit all morning; a "fail only if every send failed" rule stayed green for a real fault at low volume);
 *   · 'unknown' → retried ONCE with the same key; still not 'sent' → the claim is KEPT: at worst an email is lost, never
 *                 doubled. Logged with ids only (no address).
 * ⛔ SEQUENTIAL AND PACED: Resend's 10 requests/second are shared with sign-in mail and the other crons — and at most
 * MESSAGE_EMAIL_RULES.maxSendsPerRun per run (`stopped: 'ceiling'`, a 200: the next run carries on).
 * ⛔ ONE TEACHER'S ERROR NEVER STOPS THE RUN (Opus, gate round 4): a throw while claiming or sending is counted `failed`
 * and the loop moves on — in a fixed plan order, one persistent error would otherwise starve everyone after it.
 * ⛔ ONE SENDER: both editions share the database, and teachers live on eno.vn — marketplace only (the box timer is
 * pinned to eno.vn:3001 too).
 * `?dryRun=1` answers what this run WOULD send — counts only, nothing claimed, nothing sent — for a check before the timer
 * is enabled. The answer stays under 200 bytes (eno-cron.sh prints only the first 200).
 */
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`
const GAP_MS = 150
const SLOW_GAP_MS = 1000
const UNKNOWN_RETRY_MS = 5000
const RATE_RETRY_MS = 1000
const MAX_RETRY_WAIT_MS = 10_000
/** No send STARTS after this: eno-cron.sh gives the request 900 s. */
const RUN_DEADLINE_MS = 12 * 60 * 1000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const GET = route({ auth: 'cron' }, async ({ req }) => {
  if (!IS_MARKETPLACE) return { ok: true, skipped: 'marketplace_only' }
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  if (!dryRun && !mailEnabled()) return { ok: true, mail: 'disabled' }
  const startedAt = Date.now()

  const threads = await loadUnreadTeacherThreads(db)
  const teacherIds = [...new Set(threads.map((t) => t.teacherProfileId))]
  const [stateRows, emailedRows, newEmailsLast24h] = teacherIds.length
    ? await Promise.all([
        db.teacherMessageEmailState.findMany({ where: { profileId: { in: teacherIds } }, select: { profileId: true, lastEmailAt: true, optedOutAt: true } }),
        db.teacherMessageEmailThread.findMany({ where: { conversationId: { in: threads.map((t) => t.conversationId) } }, select: { conversationId: true } }),
        loadNewEmailsLast24h(db, teacherIds, startedAt),
      ])
    : [[], [], new Map<string, number>()]
  const states = new Map<string, TeacherEmailState>(stateRows.map((s) => [s.profileId, { lastEmailAt: s.lastEmailAt, optedOutAt: s.optedOutAt }]))
  const plan = planMessageEmails(threads, states, new Set(emailedRows.map((r) => r.conversationId)), newEmailsLast24h, startedAt)

  if (dryRun) {
    // `tokens`: whether the unsubscribe secret is configured — without it every send is refused below (Opus, gate round 5).
    return { ok: true, dryRun: true, unreadThreads: threads.length, teachers: plan.length, new: plan.filter((p) => p.kind === 'new').length, reminders: plan.filter((p) => p.kind === 'reminder').length, tokens: !!mintUnsubscribeToken('dry-run') }
  }

  // The teacher's address: the ACCOUNT's current one first (Profile.email, mirrored from sign-in on every login), else the
  // copy the last profile save took (TeacherPrivate.email — a copy of the same, possibly stale).
  const found = plan.length
    ? await db.teacherProfile.findMany({
        where: { profileId: { in: plan.map((p) => p.teacherProfileId) } },
        select: { profileId: true, fullName: true, private: { select: { email: true } }, profile: { select: { email: true } } },
      })
    : []
  const byProfile = new Map(found.map((t) => [t.profileId, t]))

  let sent = 0, failed = 0, invalid = 0, unknown = 0, skipped = 0, left = 0
  let stopped: string | null = null
  let gap = GAP_MS
  /** Refusals of "this message" in a row: three is not an address problem but the email itself — stop (Opus, gate round 5). */
  let invalidRun = 0
  for (const [i, e] of plan.entries()) {
    if (Date.now() - startedAt > RUN_DEADLINE_MS) { stopped = 'deadline'; left = plan.length - i; break }
    // Emails that went out, or may have: a refused send uses no quota.
    if (sent + unknown >= MESSAGE_EMAIL_RULES.maxSendsPerRun) { stopped = 'ceiling'; left = plan.length - i; break }
    try {
      const t = byProfile.get(e.teacherProfileId)
      // The account's CURRENT address first (Opus, gate): TeacherPrivate.email is a copy taken at the last profile save.
      const to = t ? t.profile.email || t.private?.email : null
      // Minted BEFORE the claim, so a missing token never leaves a claim with no send. No token = a missing secret: a
      // configuration fault that would send nothing, so it FAILS the run rather than skipping quietly (Opus, gate round 5).
      const token = t ? mintUnsubscribeToken(e.teacherProfileId) : null
      if (!t || !to) { skipped++; continue }
      if (!token) { failed++; continue }

      const claimAt = new Date()
      const claimed = await claimMessageEmail(db, e, claimAt)
      if (!claimed) { skipped++; continue }

      const unsubscribeUrl = `${ORIGIN}/unsubscribe?token=${encodeURIComponent(token)}&list=teacher-messages`
      let rendered: ReturnType<typeof renderTeacherMessages>
      try {
        // The counts the CLAIM read (codex, gate) — never the plan's: a thread read or blocked since is not counted.
        rendered = renderTeacherMessages({
          kind: e.kind, newSchools: claimed.newThreads, unreadThreads: claimed.threads,
          origin: ORIGIN, unsubscribeUrl, recipientName: t.fullName, siteName: SITE_NAME,
        })
      } catch (err) {
        await releaseMessageEmail(db, e, claimAt) // nothing was sent: never strand a claim (Opus, gate)
        throw err
      }
      const { subject, html, text } = rendered
      const msg = {
        to, subject, html, text,
        headers: {
          'List-Unsubscribe': `<${ORIGIN}/api/unsubscribe?token=${encodeURIComponent(token)}&list=teacher-messages>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }
      // One claim, one key: a retry of this send inside this run is idempotent; a later run's claim has its own time.
      const idempotencyKey = `teacher-messages/${e.teacherProfileId}/${claimAt.getTime()}`

      // Once ANY attempt was unclear, the claim is never released, whatever a later attempt says (Opus, gate round 3 —
      // sendMailOnce cannot answer 'refused' after `afterUnknown`, mail.ts; this keeps the rule true if that ever changes).
      let uncertain = false
      let r: OnceResult = await sendMailOnce(msg, { idempotencyKey })
      if (r.outcome === 'refused' && r.name === 'rate_limit_exceeded') {
        gap = SLOW_GAP_MS
        await sleep(Math.min(r.retryAfterMs ?? RATE_RETRY_MS, MAX_RETRY_WAIT_MS))
        r = await sendMailOnce(msg, { idempotencyKey })
      }
      if (r.outcome === 'unknown') {
        uncertain = true
        await sleep(UNKNOWN_RETRY_MS)
        r = await sendMailOnce(msg, { idempotencyKey, afterUnknown: true })
      }

      if (r.outcome === 'sent') { sent++; invalidRun = 0 }
      else if (r.outcome === 'refused' && !uncertain && (r.stopRun || r.name === 'rate_limit_exceeded')) {
        // Run-wide, or a rate limit that outlasted its retry: STOP FIRST, then release best-effort — a release that throws
        // must never keep the run sending into an exhausted quota (codex + Opus, gate round 5).
        failed++
        stopped = r.name ?? 'refused'; left = plan.length - i - 1
        try { await releaseMessageEmail(db, e, claimAt) } catch (err) { console.error('[teacher-message-emails] release failed — claim parked', { teacherProfileId: e.teacherProfileId, error: (err as Error)?.message }) }
        break
      } else if (r.outcome === 'refused' && !uncertain) {
        invalid++
        if (++invalidRun >= 3) {
          // The third in a row: the email itself is refused, not an address — release this one and stop (the two before
          // stay parked, the unit is red, and tomorrow's reminder covers their schools once it is fixed).
          stopped = 'refused_systemic'; left = plan.length - i - 1
          try { await releaseMessageEmail(db, e, claimAt) } catch { /* parked */ }
          break
        }
        // This message: PARKED (the claim stays) — ids only, never the address.
        console.error('[teacher-message-emails] refused for this message — claim parked', { teacherProfileId: e.teacherProfileId, error: r.name })
      } else {
        unknown++
        // ⛔ THE CLAIM STAYS: Resend may have sent it. Ids only — never the address.
        console.error('[teacher-message-emails] unclear send — claim kept', { teacherProfileId: e.teacherProfileId, kind: e.kind, error: r.name })
      }
    } catch (err) {
      // Nothing claimed (the claim's transaction rolled back), or released already (the render path), or — after a claim —
      // a database error: then the claim stays parked (never a double email), counted, and on.
      failed++
      console.error('[teacher-message-emails] teacher failed — run continues', { teacherProfileId: e.teacherProfileId, error: (err as Error)?.message })
    }
    await sleep(gap)
  }

  const body = messageEmailResult({ teachers: plan.length, sent, failed, invalid, unknown, skipped, stopped, left })
  return failed > 0 || invalid > 0 || (stopped && stopped !== 'ceiling') ? Response.json(body, { status: 500 }) : body
})
