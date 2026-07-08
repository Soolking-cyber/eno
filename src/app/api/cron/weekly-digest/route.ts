import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
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

function bearerOk(header: string | null, secret: string): boolean {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Weekly marketing digest (Vercel Cron → see vercel.json). Guarded by CRON_SECRET,
// exactly like daily-reminders. Builds the content ONCE (top picks + moving sales) and
// emails every opted-in account with an address. Fully env-gated: with no RESEND_API_KEY
// it short-circuits without touching recipients (nothing sends until the key lands).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !bearerOk(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 })
  }

  const { top, sales } = await getDigestContent()
  // Nothing worth sending (e.g. an empty catalogue) — skip the whole run.
  if (top.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'no_content' })
  }
  // Key not set yet → don't loop recipients; report the no-op so a manual hit is legible.
  if (!mailEnabled()) {
    return NextResponse.json({ ok: true, mail: 'disabled', top: top.length, sales: sales.length })
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

  return NextResponse.json({ ok: true, recipients: recipients.length, sent, failed, top: top.length, sales: sales.length })
}
