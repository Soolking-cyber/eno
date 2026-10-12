import { describe, expect, it } from 'vitest'
import { renderTeacherMessages } from './teacher-messages'
import { senderIdentityText } from './layout'

// The teacher message emails, v2 (2026-10-12): three stages per episode — an hour ("a school sent you a message"), a day
// ("remember to check your new message"), three days ("you haven't replied", the last email about it). One email may cover
// schools at different stages: the subject is the lowest stage's, and every stage present gets its own line. Counts and a
// link to the inbox — never a school's name or a message's text — plus the sender's identity and the list's unsubscribe link.
const base = { origin: 'https://eno.vn', unsubscribeUrl: 'https://eno.vn/unsubscribe?token=t&list=teacher-messages', siteName: 'eno.vn', unreadThreads: 1 }
const only = (stage: 1 | 2 | 3, n = 1) => ({ 1: 0, 2: 0, 3: 0, [stage]: n }) as Record<1 | 2 | 3, number>

describe('renderTeacherMessages — the three stages', () => {
  it('stage 1, an hour after: a school sent you a message', () => {
    expect(renderTeacherMessages({ ...base, counts: only(1) }).subject).toBe('A school sent you a message on eno.vn')
    expect(renderTeacherMessages({ ...base, counts: only(1, 3), unreadThreads: 3 }).subject).toBe('3 schools sent you messages on eno.vn')
  })

  it('stage 2, a day after: remember to check your new message — and no "yesterday" (a late-seen thread jumps here)', () => {
    const { subject, text } = renderTeacherMessages({ ...base, counts: only(2) })
    expect(subject).toBe('Remember to check your new message on eno.vn')
    expect(text).toContain('A school messaged you about your teacher profile, and the message is still unread.')
  })

  it('⛔ stage 3, three days after: you have not replied — "a few days", and it is the last email about that message', () => {
    const { subject, text } = renderTeacherMessages({ ...base, counts: only(3) })
    expect(subject).toBe("You haven't replied to a school on eno.vn yet")
    expect(text).toContain("It's been a few days since a school messaged you about your teacher profile, and they haven't heard back yet. This is the last email we will send about that message.")
    expect(text).toContain('A quick reply keeps the conversation going')
    expect(renderTeacherMessages({ ...base, counts: only(3, 2), unreadThreads: 2 }).text).toContain('about those messages.')
  })

  it('⛔ mixed stages: the newest news leads, and a third-stage school still gets its "last email" line (codex, gate round 1)', () => {
    const { subject, text } = renderTeacherMessages({ ...base, counts: { 1: 1, 2: 1, 3: 1 }, unreadThreads: 3 })
    expect(subject).toBe('A school sent you a message on eno.vn')
    expect(text).toContain('A school has messaged you about your teacher profile.')
    expect(text).toContain('A message from another school is still unread.')
    expect(text).toContain("It's been a few days since another school messaged you about your teacher profile")
    expect(text).toContain('This is the last email we will send about that message.')
  })

  it('counts the other unread schools when there are more than the email is about', () => {
    const { text } = renderTeacherMessages({ ...base, counts: only(1), unreadThreads: 3 })
    expect(text).toContain('You have unread messages from 3 schools in all.')
  })

  it('⛔ both parts link the inbox, name the sender and carry the list’s own unsubscribe link', () => {
    const { html, text } = renderTeacherMessages({ ...base, counts: only(1), recipientName: 'Jane Doe' })
    for (const part of [html, text]) {
      expect(part).toContain('https://eno.vn/messages')
      expect(part).toContain('list=teacher-messages')
    }
    expect(text).toContain(`Sent by ${senderIdentityText()}`)
    expect(text.startsWith('Hi Jane,')).toBe(true)
  })

  it('escapes the teacher’s own name in the HTML and keeps it plain in the text part', () => {
    const { html, text } = renderTeacherMessages({ ...base, counts: only(2), recipientName: '<b>Al</b> X' })
    expect(html).not.toContain('<b>Al</b>')
    expect(text.startsWith('Hi <b>Al</b>,')).toBe(true)
  })
})
