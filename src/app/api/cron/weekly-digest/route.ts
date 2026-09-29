import { createHash, randomUUID } from 'node:crypto'
import { route } from '@/lib/api/handler'
import { mintUnsubscribeToken } from '@/lib/unsubscribe-token'
import { db } from '@/lib/db'
import { sendMailBatch, mailEnabled } from '@/lib/mail'
import { getDigestContent } from '@/lib/digest'
import { renderWeeklyDigest } from '@/lib/emails/weekly-digest'
import { SITE_NAME } from '@/lib/edition'
import { isAdminEmail } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Advisory on the box (self-hosted Next does not enforce it); the real ceiling is eno-cron.sh's
// `curl --max-time 900`. 5,000 recipients = 50 batches ≈ 50 × (1 s gap + one request) ≈ 2 minutes.
export const maxDuration = 900

const MAX_RECIPIENTS = 5000 // safety cap per run
/** Resend's batch ceiling: one request carries up to 100 emails. */
const BATCH = 100
/** Between batch requests. One request a second is a tenth of Resend's 10/s team limit. */
const BATCH_GAP_MS = 1000
/** A batch that failed with a retryable error (429, 5xx, network) is tried this many more times. */
const RETRIES = 2
const RETRY_DELAYS_MS = [2000, 6000]
/** Resend's `retry-after` is honoured, but never for longer than this — a long ask sleeps the run away. */
const MAX_RETRY_WAIT_MS = 10_000
/** Enough to refuse a blank or plainly malformed address before Resend does it every week forever. */
const PLAUSIBLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/**
 * No new batch starts after this. eno-cron.sh gives the request 900 s; a Resend outage retried on
 * every batch (1 s gap + 3 requests + two ≤10 s waits) must end the run with a red answer inside that,
 * never keep sending after the caller has given up.
 */
const RUN_DEADLINE_MS = 12 * 60 * 1000

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Weekly marketing digest (systemd timer on the box → infra/vn-node/cron/install-cron-timers.sh).
// Guarded by CRON_SECRET, exactly like daily-reminders. Builds the content ONCE and emails every
// opted-in account with an address.
//
// ⛔ WHY IT WAS BROKEN (measured 2026-09-29). The 2026-09-24 run returned
// {"recipients":21,"sent":10,"failed":11}: the fan-out fired 20 sendMail() calls at once against
// Resend's 10-requests-per-second team limit, exactly 10 were accepted, the rest got 429 — and a
// failed send was never retried, so half the list silently missed the week. It is now one Resend
// BATCH request per 100 recipients (sendMailBatch), retried on 429/5xx/network with the same
// idempotency key.
//
// ⚠️ RERUNS ARE A PERSON'S DECISION, AND ONLY SAFE WITHIN LIMITS. The key is site + ISO week + the
// batch's recipient ids, and Resend keeps it 24 h. A same-day rerun with an UNCHANGED list re-posts
// each batch under the key it had, so a batch Resend already accepted is never sent twice — but the
// body is rebuilt, and when the week's content has moved since (it usually has) Resend answers 409
// and the batch is reported FAILED even though its people have the email. Read a red rerun's
// errors before acting on it. It is NOT safe after 24 h (the keys are gone), nor once anyone has subscribed,
// unsubscribed or changed address (the batches — and so the keys — shift, and a re-keyed batch is
// sent again in full). A 409 (the key reused with a different body, e.g. the week's content moved)
// counts as FAILED, never as sent: it proves a record exists, not that it was a delivery. The timer
// itself never retries (eno-cron.sh units are Type=oneshot with no Restart=). A per-person "last
// sent" column would lift these limits; it was built and taken out again (2026-09-29) because it
// meant a Profile migration that must land before the code, on the table every sign-in reads.
//
// ⛔ A RUN WITH ANY FAILURE ANSWERS 500, NOT 200 (like business-verification-retention). eno-cron.sh exits non-zero on a non-200, so the
// unit shows as failed in `systemctl list-units --failed`. The run that dropped 11 of 21 answered
// 200 and nobody noticed for five days.
//
// ⚠️ MARKETING MAIL STAYS ON RESEND. The parked branch hold/email-consent moves TRANSACTIONAL mail
// to a Cloudflare Worker that refuses marketing, and as written it makes mailEnabled('marketing')
// always false — i.e. it would switch this digest off. When that branch lands, route this route's
// sendMailBatch() to Resend only (it already is: sendMailBatch has no other transport), so a spam
// complaint about the digest lands on Resend's suppression list and never on the one sign-in
// links share.
//
// ⚠️ ONE WEEKLY EMAIL PER PERSON, SENT BY eno.vn. Both editions share one Profile table, and the
// only weekly-digest timer on the box calls eno.vn (infra/vn-node/cron/install-cron-timers.sh), so a
// person gets eno's weekly email once, not once per site. Do not point a second timer at eno.forum:
// it would email the same accounts again.
//
// ⚠️ TRIAL: `?trial=<address>` renders this week's real email and sends it to that ONE address,
// subject prefixed "[Trial] ". The address must be in ADMIN_EMAILS or the request is refused with
// 400 before anything is read — it never falls through to the list. It goes
// through the SAME sendMailBatch() path as the real run (one message, a fresh key per trial so a
// second trial after a copy change is not a replay), so a trial proves the live batch call — the
// permissive validation, the per-message List-Unsubscribe headers — before a Thursday depends on it.
//
// ⚠️ WS6 MIGRATION — `auth: 'cron'`: unset CRON_SECRET, or a missing/malformed/wrong Bearer token →
// `{"error":"forbidden"}` 401. Branches:
//   · empty catalogue → `{"ok":true,"skipped":"no_content"}` 200
//   · no RESEND_API_KEY → `{"ok":true,"mail":"disabled",…}` 200
//   · trial → `{"ok":true,"trial":true,"sent":true|false}` 200 / 500; bad trial address → 400
//   · run → `{"ok":…,"recipients":…,"sent":…,"failed":…,"skippedInvalid":…,…}` 200, or 500 if
//     anything failed
export const GET = route({ auth: 'cron' }, async ({ req }) => {
  const trial = new URL(req.url).searchParams.get('trial')?.trim().toLowerCase() ?? null
  if (trial !== null && !isAdminEmail(trial)) {
    return Response.json({ ok: false, error: 'trial_address_not_allowed' }, { status: 400 })
  }

  const content = await getDigestContent()
  const counts = { homes: content.homes.length, picks: content.picks.length, sales: content.sales.length }
  // Nothing worth sending (e.g. an empty catalogue) — skip the whole run. A week of moving sales
  // alone is still worth an email.
  if (content.homes.length === 0 && content.picks.length === 0 && content.sales.length === 0) {
    return { ok: true, skipped: 'no_content', ...counts }
  }
  // Key not set yet → don't loop recipients; report the no-op so a manual hit is legible.
  if (!mailEnabled()) {
    return { ok: true, mail: 'disabled', ...counts }
  }

  const render = (r: { id: string | null; displayName: string | null; unsubscribeToken: string | null }) => {
    // ⚠️ Falls back to the stored cuid when no signing secret is configured, so a misconfigured
    // environment still sends a WORKING unsubscribe link rather than a broken one — a dead
    // unsubscribe link is worse than an unsigned one.
    const token = r.id ? (mintUnsubscribeToken(r.id) ?? r.unsubscribeToken) : null
    const unsubscribeUrl = token ? `${ORIGIN}/unsubscribe?token=${token}` : `${ORIGIN}/unsubscribe`
    const email = renderWeeklyDigest({ content, origin: ORIGIN, unsubscribeUrl, recipientName: r.displayName, siteName: SITE_NAME })
    const headers: Record<string, string> = token
      ? {
          // RFC 8058 one-click unsubscribe — Gmail/Apple render a native "Unsubscribe" control that
          // POSTs here; the visible footer link goes to the /unsubscribe page.
          'List-Unsubscribe': `<${ORIGIN}/api/unsubscribe?token=${token}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }
      : {}
    return { ...email, headers }
  }

  if (trial !== null) {
    // The admin's own profile if it has one, so the greeting and unsubscribe link are theirs.
    const own = await db.profile.findFirst({
      where: { email: { equals: trial, mode: 'insensitive' } },
      select: { id: true, displayName: true, unsubscribeToken: true },
    })
    const m = render(own ?? { id: null, displayName: null, unsubscribeToken: null })
    const res = await sendMailBatch(
      [{ to: trial, subject: `[Trial] ${m.subject}`, html: m.html, text: m.text, headers: m.headers }],
      { idempotencyKey: `weekly-digest-trial:${SITE_NAME}:${randomUUID()}` },
    )
    const sent = res.ok[0] === true
    return Response.json({ ok: sent, trial: true, sent, error: res.error, ...counts }, { status: sent ? 200 : 500 })
  }

  const recipients = await db.profile.findMany({
    where: { weeklyDigestOptIn: true, email: { not: null } },
    select: { id: true, email: true, displayName: true, unsubscribeToken: true },
    orderBy: { id: 'asc' }, // a stable order keeps each batch — and so its key — the same on a rerun
    take: MAX_RECIPIENTS,
  })

  // ⚠️ `email: { not: null }` still admits '' and junk. Those are skipped and COUNTED, never sent:
  // Resend would refuse them and turn every future run red on the same rows.
  const sendable = recipients.filter((r) => PLAUSIBLE_EMAIL.test(r.email ?? ''))
  const skippedInvalid = recipients.length - sendable.length

  const startedAt = Date.now()
  const week = isoWeek(new Date())
  let sent = 0
  let failed = 0
  let retried = 0
  const errors: string[] = []
  for (let i = 0; i < sendable.length; i += BATCH) {
    const chunk = sendable.slice(i, i + BATCH)
    if (Date.now() - startedAt > RUN_DEADLINE_MS) {
      failed += sendable.length - i
      errors.push('deadline')
      break
    }
    if (i > 0) await sleep(BATCH_GAP_MS)
    const msgs = chunk.map((r) => {
      const m = render(r)
      return { to: r.email as string, subject: m.subject, html: m.html, text: m.text, headers: m.headers }
    })
    // SITE_NAME is in the key only as a guard: the editions share one Profile table, and a run from
    // the other edition must not collide with this one's key.
    const key = `weekly-digest:${SITE_NAME}:${week}:${createHash('sha256').update(chunk.map((r) => r.id).join(',')).digest('hex').slice(0, 32)}`
    let res = await sendMailBatch(msgs, { idempotencyKey: key })
    for (let a = 0; a < RETRIES && res.retryable; a++) {
      retried++
      await sleep(Math.min(res.retryAfterMs ?? RETRY_DELAYS_MS[a], MAX_RETRY_WAIT_MS))
      res = await sendMailBatch(msgs, { idempotencyKey: key })
    }
    if (res.error) errors.push(res.error)
    const accepted = res.ok.filter(Boolean).length
    sent += accepted
    failed += chunk.length - accepted
  }

  const ok = failed === 0
  // `truncated`: the MAX_RECIPIENTS cap was hit, so accounts past it (by id) were not emailed this run.
  const truncated = recipients.length === MAX_RECIPIENTS
  const body = { ok, recipients: recipients.length, truncated, sent, failed, retried, skippedInvalid, errors: [...new Set(errors)], ...counts }
  return ok ? body : Response.json(body, { status: 500 })
})

/** "2026-W40" — ISO-8601 week of a UTC date. Not exported: a route file may export only route fields. */
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
