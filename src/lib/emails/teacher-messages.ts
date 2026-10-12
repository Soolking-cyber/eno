import { renderBrandEmail, esc, EMAIL, senderIdentityText } from './layout'

/**
 * The teacher message emails, v2 (owner, 2026-10-12 — "school texted you … 24 hours remember to check the new message and 3
 * days you forgot to reply to the school … duolingo style"; rule: src/lib/teachers/message-emails.ts). Three stages per
 * episode, each only while its message is still unread:
 *   1 — an hour after it:  "A school sent you a message"
 *   2 — a day after it:    "Remember to check your new message"
 *   3 — 3 days after it:   "You haven't replied to a school yet" — and it says it is the last email about that message.
 * ONE EMAIL MAY COVER SEVERAL SCHOOLS AT DIFFERENT STAGES: the subject is the lowest stage's (the newest news) and the
 * body has one line per stage present — so a third-stage school always gets its "last email" line (codex, gate round 1).
 * A thread first seen late jumps to the stage due (the rule's header), so no line names an exact age: stage 2 says the
 * message is still unread, not "yesterday", and stage 3 says "a few days", not "3 days".
 * ⛔ NO SCHOOL NAME, NO MESSAGE TEXT. Business names are self-declared, so an email quoting one is a phishing surface with
 * eno.vn's name on it; the email counts threads and sends the teacher to their inbox (notify.ts has the same rule).
 * ⛔ A SERVICE NOTICE, NOT MARKETING: the nudge stays a nudge about the teacher's own messages — nothing promotional, no
 * claims about what schools do. It names its sender and can be stopped (layout.ts `sender: 'full'`, the list's own
 * unsubscribe link; the cron adds the RFC 8058 headers).
 * ⚠️ `siteName` comes from the caller (SITE_NAME) — the route is compiled into both editions. English only, like the
 * teacher job-match email: teacher accounts are foreign teachers.
 */
export function renderTeacherMessages(opts: {
  /** Threads per stage this email is about (at least one in all). */
  counts: Record<1 | 2 | 3, number>
  /** Every thread with an unread school message. */
  unreadThreads: number
  origin: string
  unsubscribeUrl: string
  recipientName?: string | null
  siteName: string
}): { subject: string; html: string; text: string } {
  const { counts, unreadThreads, origin, unsubscribeUrl, recipientName, siteName } = opts
  const [n1, n2, n3] = [counts[1], counts[2], counts[3]]
  const total = n1 + n2 + n3
  const subject =
    n1 ? (n1 === 1 ? `A school sent you a message on ${siteName}` : `${n1} schools sent you messages on ${siteName}`)
    : n2 ? (n2 === 1 ? `Remember to check your new message on ${siteName}` : `Remember to check your ${n2} new messages on ${siteName}`)
    : (n3 === 1 ? `You haven't replied to a school on ${siteName} yet` : `You haven't replied to ${n3} schools on ${siteName} yet`)
  const lines: string[] = []
  if (n1) lines.push(n1 === 1 ? 'A school has messaged you about your teacher profile.' : `${n1} schools have messaged you about your teacher profile.`)
  if (n2) lines.push(
    n1 ? (n2 === 1 ? 'A message from another school is still unread.' : `Messages from ${n2} other schools are still unread.`)
    : n2 === 1 ? 'A school messaged you about your teacher profile, and the message is still unread.'
    : `${n2} schools messaged you about your teacher profile, and their messages are still unread.`,
  )
  if (n3) {
    const who = n3 === 1 ? `${n1 || n2 ? 'another' : 'a'} school` : `${n3} ${n1 || n2 ? 'other ' : ''}schools`
    lines.push(`It's been a few days since ${who} messaged you about your teacher profile, and they haven't heard back yet. This is the last email we will send about ${n3 === 1 ? 'that message' : 'those messages'}.`)
  }
  if (unreadThreads > total) lines.push(`You have unread messages from ${unreadThreads} schools in all.`)
  const nudges = [
    ...(n3 ? ['A quick reply keeps the conversation going — even if it is just to say you are not available.'] : []),
    'Reply on the site — your phone number and email stay private until you choose to share them.',
  ]
  const first = recipientName?.trim().split(/\s+/)[0] || null
  const hi = first ? `Hi ${esc(first)},` : 'Hi,'
  const hiText = first ? `Hi ${first},` : 'Hi,'
  const inbox = `${origin}/messages`
  const bodyHtml = `
      <tr><td style="padding:4px 24px 8px;">
        <p style="margin:12px 0 0;font-size:15px;color:${EMAIL.INK};">${hi}</p>
        ${lines.map((l) => `<p style="margin:6px 0 0;font-size:14px;color:${EMAIL.INK};line-height:1.5;">${esc(l)}</p>`).join('\n        ')}
        ${nudges.map((l) => `<p style="margin:6px 0 0;font-size:14px;color:${EMAIL.MUTED};line-height:1.5;">${esc(l)}</p>`).join('\n        ')}
      </td></tr>`
  const audienceNote = `You're receiving this because schools can message you through your teacher profile on ${siteName}.`
  const html = renderBrandEmail({
    preheader: lines[0],
    bodyHtml,
    origin,
    cta: { label: total === 1 ? 'Read your message' : 'Read your messages', url: inbox },
    audienceNote,
    unsubscribeUrl,
    sender: 'full',
  })
  const text = [
    hiText, '',
    ...lines,
    ...nudges, '',
    `Read your messages: ${inbox}`,
    `Stop these emails: ${unsubscribeUrl}`,
    '',
    audienceNote,
    `Sent by ${senderIdentityText()}`,
  ].join('\n')
  return { subject, html, text }
}
