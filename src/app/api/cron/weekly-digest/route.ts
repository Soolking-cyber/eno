import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { sendMail, mailEnabled } from '@/lib/mail'
import { getDigestContent } from '@/lib/digest'
import { renderWeeklyDigest } from '@/lib/emails/weekly-digest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_RECIPIENTS = 5000 // safety cap per run
const CONCURRENCY = 20 // bounded fan-out so we don't serialize thousands of sends

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

// Weekly marketing digest (Vercel Cron → see vercel.json). Guarded by CRON_SECRET,
// exactly like daily-reminders. Builds the content ONCE (top picks + moving sales) and
// emails every opted-in account with an address. Fully env-gated: with no RESEND_API_KEY
// it short-circuits without touching recipients (nothing sends until the key lands).
//
// ⚠️ WS6 MIGRATION — `auth: 'cron'`. "Exactly like daily-reminders" above was literal: the guard
// deleted here was one of five byte-identical `bearerOk()` copies, now a single timing-safe
// comparison in `src/lib/api/handler.ts`. All four branches unchanged:
//   · unset CRON_SECRET, or a missing/malformed/wrong Bearer token → `{"error":"forbidden"}` 401
//   · empty catalogue → `{"ok":true,"skipped":"no_content"}` 200
//   · no RESEND_API_KEY → `{"ok":true,"mail":"disabled","top":…,"sales":…}` 200
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
  // Key not set yet → don't loop recipients; report the no-op so a manual hit is legible.
  if (!mailEnabled()) {
    return { ok: true, mail: 'disabled', top: top.length, sales: sales.length }
  }

  const recipients = await db.profile.findMany({
    where: { weeklyDigestOptIn: true, email: { not: null } },
    select: { email: true, displayName: true, unsubscribeToken: true },
    take: MAX_RECIPIENTS,
  })

  let sent = 0
  let failed = 0
  for (let i = 0; i < recipients.length; i += CONCURRENCY) {
    const batch = recipients.slice(i, i + CONCURRENCY)
    const res = await Promise.all(
      batch.map(async (r) => {
        if (!r.email) return false
        const unsubscribeUrl = `${ORIGIN}/unsubscribe?token=${r.unsubscribeToken}`
        const { subject, html, text } = renderWeeklyDigest({
          top, sales, origin: ORIGIN, unsubscribeUrl, recipientName: r.displayName,
        })
        return sendMail({
          to: r.email,
          subject,
          html,
          text,
          headers: {
            // RFC 8058 one-click unsubscribe — Gmail/Apple render a native "Unsubscribe"
            // control that POSTs here; the visible footer link goes to the /unsubscribe page.
            'List-Unsubscribe': `<${ORIGIN}/api/unsubscribe?token=${r.unsubscribeToken}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        })
      }),
    )
    for (const ok of res) { if (ok) sent++; else failed++ }
  }

  return { ok: true, recipients: recipients.length, sent, failed, top: top.length, sales: sales.length }
})
