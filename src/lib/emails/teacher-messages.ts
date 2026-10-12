import { renderBrandEmail, esc, EMAIL, senderIdentityText } from './layout'

/**
 * "A school sent you a message" — the teacher message email (owner, 2026-10-12; rule: src/lib/teachers/message-emails.ts).
 * `new`: a school that never triggered an email has written (sent at once). `reminder`: the once-a-day nudge while
 * anything stays unread.
 * ⛔ NO SCHOOL NAME, NO MESSAGE TEXT. Business names are self-declared, so an email quoting one is a phishing surface with
 * eno.vn's name on it; the email only counts threads and sends the teacher to their inbox (notify.ts has the same rule).
 * ⛔ A SERVICE NOTICE, NOT MARKETING: nothing promotional may be added here (codex, plan review — the opt-out-only basis
 * is that it tells the teacher about messages sent to them through the service). It still names its sender and can be
 * stopped (layout.ts `sender: 'full'`, the list's own unsubscribe link; the cron adds the RFC 8058 headers).
 * ⚠️ `siteName` comes from the caller (SITE_NAME) — the route is compiled into both editions. English only, like the
 * teacher job-match email: teacher accounts are foreign teachers.
 */
export function renderTeacherMessages(opts: {
  kind: 'new' | 'reminder'
  /** Schools new to this email (kind 'new'). */
  newSchools: number
  /** Every thread with an unread message. */
  unreadThreads: number
  origin: string
  unsubscribeUrl: string
  recipientName?: string | null
  siteName: string
}): { subject: string; html: string; text: string } {
  const { kind, newSchools, unreadThreads, origin, unsubscribeUrl, recipientName, siteName } = opts
  const schools = (n: number) => (n === 1 ? 'a school' : `${n} schools`)
  const subject = kind === 'new'
    ? newSchools === 1 ? `A school sent you a message on ${siteName}` : `${newSchools} schools sent you messages on ${siteName}`
    : unreadThreads === 1 ? `You have an unread message from a school on ${siteName}` : `You have unread messages from ${unreadThreads} schools on ${siteName}`
  const lead = kind === 'new'
    ? `${newSchools === 1 ? 'A school has' : `${newSchools} schools have`} messaged you about your teacher profile.${unreadThreads > newSchools ? ` You have unread messages from ${schools(unreadThreads)} in all.` : ''}`
    : `You have unread messages from ${schools(unreadThreads)} about your teacher profile.`
  const privacy = 'Reply on the site — your phone number and email stay private until you choose to share them.'
  const first = recipientName?.trim().split(/\s+/)[0] || null
  const hi = first ? `Hi ${esc(first)},` : 'Hi,'
  const hiText = first ? `Hi ${first},` : 'Hi,'
  const inbox = `${origin}/messages`
  const bodyHtml = `
      <tr><td style="padding:4px 24px 8px;">
        <p style="margin:12px 0 0;font-size:15px;color:${EMAIL.INK};">${hi}</p>
        <p style="margin:6px 0 0;font-size:14px;color:${EMAIL.INK};line-height:1.5;">${esc(lead)}</p>
        <p style="margin:6px 0 0;font-size:14px;color:${EMAIL.MUTED};line-height:1.5;">${esc(privacy)}</p>
      </td></tr>`
  const audienceNote = `You're receiving this because schools can message you through your teacher profile on ${siteName}.`
  const html = renderBrandEmail({
    preheader: lead,
    bodyHtml,
    origin,
    cta: { label: 'Read your messages', url: inbox },
    audienceNote,
    unsubscribeUrl,
    sender: 'full',
  })
  const text = [
    hiText, '',
    lead,
    privacy, '',
    `Read your messages: ${inbox}`,
    `Stop these emails: ${unsubscribeUrl}`,
    '',
    audienceNote,
    `Sent by ${senderIdentityText()}`,
  ].join('\n')
  return { subject, html, text }
}
