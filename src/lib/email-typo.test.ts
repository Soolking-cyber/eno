import { describe, expect, it } from 'vitest'
import { emailLooksComplete, suggestEmailDomain, webmailFor, withEmailDomain } from './email-typo'

/** auth-06 (2026-10-04): the sign-in form's email checks. See email-typo.ts. */
describe('emailLooksComplete — a "." after the "@"', () => {
  it('enables only for something@domain.tld', () => {
    for (const ok of ['an@gmail.com', ' an.nguyen@yahoo.com.vn ', 'a+b@x.io']) expect(emailLooksComplete(ok), ok).toBe(true)
    for (const no of ['an@', 'an@gmail', 'an@gmail.', '@gmail.com', 'an@.com', 'an @gmail.com', 'an@@gmail.com', '']) expect(emailLooksComplete(no), no).toBe(false)
  })
})

describe('suggestEmailDomain — offer a fix for a common-domain typo, never for a real domain', () => {
  it('catches the usual slips', () => {
    expect(suggestEmailDomain('an@gmial.com')).toBe('gmail.com')
    expect(suggestEmailDomain('an@gmai.com')).toBe('gmail.com')
    expect(suggestEmailDomain('an@gmail.con')).toBe('gmail.com')
    expect(suggestEmailDomain('an@gmail.co')).toBe('gmail.com')
    expect(suggestEmailDomain('an@gamil.com')).toBe('gmail.com')
    expect(suggestEmailDomain('an@hotmal.com')).toBe('hotmail.com')
    expect(suggestEmailDomain('an@outlok.com')).toBe('outlook.com')
    expect(suggestEmailDomain('an@yahoo.com.v')).toBe('yahoo.com.vn')
    expect(suggestEmailDomain('An@GMIAL.COM')).toBe('gmail.com')
  })
  it('leaves correct, real and unknown domains alone', () => {
    for (const e of ['an@gmail.com', 'an@yahoo.com.vn', 'an@mail.com', 'an@email.com', 'an@ymail.com', 'an@me.com', 'an@fpt.edu.vn', 'an@company.vn', 'an@gmail', 'an@']) {
      expect(suggestEmailDomain(e), e).toBeNull()
    }
  })
  it('a big provider’s own country domain is real mail, not a typo — only a one-letter slip is offered there', () => {
    for (const e of ['an@yahoo.com.au', 'an@yahoo.com.sg', 'an@yahoo.com.ph', 'an@yahoo.ca', 'an@hotmail.ca', 'an@outlook.com.vn', 'an@live.com.au']) {
      expect(suggestEmailDomain(e), e).toBeNull()
    }
    expect(suggestEmailDomain('an@yahoo.com.vm')).toBe('yahoo.com.vn')
    expect(suggestEmailDomain('an@yahoo.co')).toBe('yahoo.com')
    expect(suggestEmailDomain('an@hotmail.co')).toBe('hotmail.com')
  })
  it('swaps only the domain, keeping the local part as typed', () => {
    expect(withEmailDomain(' An.Nguyen@gmial.com ', 'gmail.com')).toBe('An.Nguyen@gmail.com')
  })
})

describe('webmailFor — "Open Gmail" / "Open Outlook" on the sent screen', () => {
  it('by domain', () => {
    expect(webmailFor('an@gmail.com')?.name).toBe('Gmail')
    expect(webmailFor('an@hotmail.com')?.name).toBe('Outlook')
    expect(webmailFor('an@outlook.com')?.name).toBe('Outlook')
    expect(webmailFor('an@live.com')?.url).toBe('https://outlook.live.com/mail/')
    expect(webmailFor('an@yahoo.com')).toBeNull()
    expect(webmailFor('an@company.vn')).toBeNull()
  })
})
