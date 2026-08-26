import { describe, it, expect } from 'vitest'
import { renderSignInEmail } from './sign-in-link'
import { renderSignInCodeEmail } from './sign-in-code'

// ⚠️ THE INVARIANT THESE PROTECT: the magic link and the 8-digit code are the SAME GoTrue
// token, measured against the live project on 2026-07-22 — consuming `hashed_token` makes
// that mint's `email_otp` return `otp_expired` immediately.
//
// So an email that carries BOTH is a self-inflicted denial of service: a corporate mail
// scanner (Office 365 Safe Links, Proofpoint) pre-fetches the link, burns the token, and
// the user's code is dead before they finish typing it. Copy edits are exactly how that
// would creep back in, which is why this is a test and not a comment.

const URL = 'https://eno.vn/auth/confirm?token_hash=42a11a5444fae64feead03e8cf9cd1b2a5295192477fa7293f98b692&type=magiclink&next=%2F'
// 6 digits, matching what Supabase mints today, and still leading-zero-bearing — the
// renderer must not strip or pad, whatever the length happens to be.
const CODE = '007302'
const ORIGIN = 'https://eno.vn'
const EMAIL = 'someone@example.com'

describe('sign-in emails · one token per email, never both', () => {
  it('the CODE email contains no link to the token', () => {
    const { html, text } = renderSignInCodeEmail({ code: CODE, origin: ORIGIN, email: EMAIL })
    const all = html + text
    expect(all).not.toMatch(/auth\/confirm/)
    expect(all).not.toMatch(/token_hash/)
    expect(all).toContain(CODE)
  })

  it('the LINK email contains no 8-digit code', () => {
    const { html, text } = renderSignInEmail({ url: URL, origin: ORIGIN, email: EMAIL })
    // The link's own token is hex, so a bare 8-digit run could only be an OTP.
    expect(text).not.toMatch(/\b\d{8}\b/)
    expect(html).toContain('auth/confirm')
  })
})

describe('sign-in emails · signup is visibly different from sign-in', () => {
  // The 2026-07-22 ghost-account incident: a one-character typo silently created an
  // account, because nothing in the email said "this address has none yet".
  it('says an account is being CREATED, and names the address', () => {
    const signup = renderSignInCodeEmail({ code: CODE, origin: ORIGIN, email: EMAIL, mode: 'signup' })
    expect(signup.subject).toMatch(/create/i)
    expect(signup.html).toContain(EMAIL)
    const signin = renderSignInCodeEmail({ code: CODE, origin: ORIGIN, email: EMAIL, mode: 'signin' })
    expect(signin.subject).not.toMatch(/create/i)
    expect(signin.subject).not.toEqual(signup.subject)
  })

  it('carries the anti-phishing line a code needs and a link does not', () => {
    const en = renderSignInCodeEmail({ code: CODE, origin: ORIGIN, email: EMAIL })
    expect(en.html).toMatch(/never ask you for this code/i)
    const vi = renderSignInCodeEmail({ code: CODE, origin: ORIGIN, email: EMAIL, lang: 'vi' })
    expect(vi.html).toContain('sẽ không bao giờ hỏi bạn mã này')
    expect(vi.subject).not.toEqual(en.subject)
  })

  // Leading zeros are real (observed 00730251). A Number() round-trip anywhere in the
  // render would silently ship "7302" and every such sign-in would fail.
  it('preserves leading zeros in the code', () => {
    const { html, text } = renderSignInCodeEmail({ code: CODE, origin: ORIGIN, email: EMAIL })
    expect(html).toContain(CODE)
    expect(text).toContain(CODE)
  })

  /**
   * ⚠️ LENGTH-AGNOSTIC ON PURPOSE. The code's length is a Supabase project setting we do not own
   * and it has already moved once (8 -> 6). A renderer that padded, sliced or asserted a width
   * would break the day it moves again — silently, in an email nobody reads in CI.
   */
  it('renders whatever length the code happens to be', () => {
    for (const code of ['007302', '00730251', '0073']) {
      const { html, text } = renderSignInCodeEmail({ code, origin: ORIGIN, email: EMAIL })
      expect(html, code).toContain(code)
      expect(text, code).toContain(code)
    }
  })
})
