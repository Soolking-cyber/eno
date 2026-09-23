import { route } from '@/lib/api/handler'
import { mintUnsubscribeToken } from '@/lib/unsubscribe-token'
import { db } from '@/lib/db'
import { sendMail, mailEnabled } from '@/lib/mail'
import { getDigestContent } from '@/lib/digest'
import { renderWeeklyDigest } from '@/lib/emails/weekly-digest'
import { SITE_NAME } from '@/lib/edition'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_RECIPIENTS = 5000 // safety cap per run
const CONCURRENCY = 20 // bounded fan-out so we don't serialize thousands of sends

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`

// Weekly marketing digest (Vercel Cron → see vercel.json). Guarded by CRON_SECRET,
// exactly like daily-reminders. Builds the content ONCE (top picks + moving sales) and
// emails every opted-in account with an address.
//
// ⛔ IT CANNOT SEND TODAY, BY DESIGN (2026-09-23). Mail moved from Resend to Cloudflare Email
// Sending, which is TRANSACTIONAL-ONLY and keeps ONE suppression list for the whole account — a
// spam complaint about a digest would block that address's sign-in links on both editions, with
// no expiry. So `mailEnabled('marketing')` is always false and this route answers
// `mail: "disabled"` without touching recipients; the sends below also declare
// `class: 'marketing'`, which src/lib/mail.ts and the Worker both refuse, so a bypass fails
// closed. Resend, now eno.vn's fallback transport, is no way around this: mail.ts refuses
// marketing before it picks a transport. Reviving the digest needs a provider that permits
// marketing mail AND a suppression list of its own.
//
// ⚠️ WS6 MIGRATION — `auth: 'cron'`. "Exactly like daily-reminders" above was literal: the guard
// deleted here was one of five byte-identical `bearerOk()` copies, now a single timing-safe
// comparison in `src/lib/api/handler.ts`. All four branches unchanged:
//   · unset CRON_SECRET, or a missing/malformed/wrong Bearer token → `{"error":"forbidden"}` 401
//   · empty catalogue → `{"ok":true,"skipped":"no_content"}` 200
//   · marketing mail disabled (always, see above) → `{"ok":true,"mail":"disabled","top":…,"sales":…}` 200
//   · success → `{"ok":true,"recipients":…,"sent":…,"failed":…,"top":…,"sales":…}` 200
//
// ⚠️ ONE ACCEPTED WIRE CHANGE, AS A SHAPE: any unhandled throw in this handler now returns
// `{"error":"internal_error"}` 500 instead of Next's default 500 HTML. Nothing here is wrapped in
// a try/catch — including the per-recipient `sendMail` inside the fan-out, where a rejection
// (rather than a `false`) already aborted the whole run.
export const GET = route({ auth: 'cron' }, async () => {
  const { top, sales } = await getDigestContent()
  // Nothing worth sending (e.g. an empty catalogue) — skip the whole run.
  if (top.length === 0) {
    return { ok: true, skipped: 'no_content' }
  }
  // Marketing mail is off (see the header) → don't loop recipients; report the no-op so a
  // manual hit is legible.
  if (!mailEnabled('marketing')) {
    return { ok: true, mail: 'disabled', top: top.length, sales: sales.length }
  }

  const recipients = await db.profile.findMany({
    where: { weeklyDigestOptIn: true, email: { not: null } },
    select: { id: true, email: true, displayName: true, unsubscribeToken: true },
    take: MAX_RECIPIENTS,
  })

  let sent = 0
  let failed = 0
  for (let i = 0; i < recipients.length; i += CONCURRENCY) {
    const batch = recipients.slice(i, i + CONCURRENCY)
    const res = await Promise.all(
      batch.map(async (r) => {
        if (!r.email) return false
        // ⚠️ Falls back to the stored cuid when no signing secret is configured, so a
        // misconfigured environment still sends a WORKING unsubscribe link rather than a
        // broken one — a dead unsubscribe link is worse than an unsigned one.
        const unsubToken = mintUnsubscribeToken(r.id) ?? r.unsubscribeToken
        const unsubscribeUrl = `${ORIGIN}/unsubscribe?token=${unsubToken}`
        const { subject, html, text } = renderWeeklyDigest({
          top, sales, origin: ORIGIN, unsubscribeUrl, recipientName: r.displayName, siteName: SITE_NAME,
        })
        return sendMail({
          to: r.email,
          class: 'marketing',
          tag: 'weekly-digest',
          subject,
          html,
          text,
          headers: {
            // RFC 8058 one-click unsubscribe — Gmail/Apple render a native "Unsubscribe"
            // control that POSTs here; the visible footer link goes to the /unsubscribe page.
            'List-Unsubscribe': `<${ORIGIN}/api/unsubscribe?token=${unsubToken}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        })
      }),
    )
    for (const ok of res) { if (ok) sent++; else failed++ }
  }

  return { ok: true, recipients: recipients.length, sent, failed, top: top.length, sales: sales.length }
})
