import { describe, expect, it } from 'vitest'
import { renderTeacherMessages } from './teacher-messages'
import { senderIdentityText } from './layout'

// The teacher message email (2026-10-12): counts and a link to the inbox — never a school's name or a message's text —
// plus the sender's identity and the list's own unsubscribe link in both parts.
const base = { origin: 'https://eno.vn', unsubscribeUrl: 'https://eno.vn/unsubscribe?token=t&list=teacher-messages', siteName: 'eno.vn' }

describe('renderTeacherMessages', () => {
  it('subjects: someone new, several new, a reminder for one school and for several', () => {
    expect(renderTeacherMessages({ ...base, kind: 'new', newSchools: 1, unreadThreads: 1 }).subject).toBe('A school sent you a message on eno.vn')
    expect(renderTeacherMessages({ ...base, kind: 'new', newSchools: 3, unreadThreads: 3 }).subject).toBe('3 schools sent you messages on eno.vn')
    expect(renderTeacherMessages({ ...base, kind: 'reminder', newSchools: 0, unreadThreads: 1 }).subject).toBe('You have an unread message from a school on eno.vn')
    expect(renderTeacherMessages({ ...base, kind: 'reminder', newSchools: 0, unreadThreads: 4 }).subject).toBe('You have unread messages from 4 schools on eno.vn')
  })

  it('a new school among older unread threads says both', () => {
    const { text } = renderTeacherMessages({ ...base, kind: 'new', newSchools: 1, unreadThreads: 3 })
    expect(text).toContain('A school has messaged you about your teacher profile. You have unread messages from 3 schools in all.')
  })

  it('⛔ both parts link the inbox, name the sender and carry the list’s own unsubscribe link', () => {
    const { html, text } = renderTeacherMessages({ ...base, kind: 'new', newSchools: 1, unreadThreads: 1, recipientName: 'Jane Doe' })
    for (const part of [html, text]) {
      expect(part).toContain('https://eno.vn/messages')
      expect(part).toContain('list=teacher-messages')
    }
    expect(text).toContain(`Sent by ${senderIdentityText()}`)
    expect(text.startsWith('Hi Jane,')).toBe(true)
  })

  it('escapes the teacher’s own name in the HTML and keeps it plain in the text part', () => {
    const { html, text } = renderTeacherMessages({ ...base, kind: 'reminder', newSchools: 0, unreadThreads: 1, recipientName: '<b>Al</b> X' })
    expect(html).not.toContain('<b>Al</b>')
    expect(text.startsWith('Hi <b>Al</b>,')).toBe(true)
  })
})
