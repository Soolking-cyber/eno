import { describe, expect, it } from 'vitest'
import { pendingOnboardingStep, phoneConfirmationTrusted, PHONE_OTP_ENABLED, SIGNUP_REQUIRES_PHONE } from './auth-policy'

// ⚠️ THE GATE MUST AGREE WITH ITSELF IN THREE PLACES (auth-finish, /onboard's server guard, its
// client). These pin the one predicate they all call, so a future edit cannot quietly let the phone
// step be skipped by URL while everyone else is stopped by it.
describe('pendingOnboardingStep', () => {
  it('asks for the account type first', () => {
    expect(pendingOnboardingStep({ accountType: null, phone: null })).toBe('account-type')
    expect(pendingOnboardingStep({ accountType: null, phone: '+84901234567' })).toBe('account-type')
  })

  it('treats a complete profile as done', () => {
    expect(pendingOnboardingStep({ accountType: 'individual', phone: '+84901234567' })).toBe(null)
    expect(pendingOnboardingStep({ accountType: 'business', phone: '+84901234567' })).toBe(null)
  })

  // ⚠️ FAILS OPEN ON UNKNOWN IDENTITY, deliberately: the server guard falls through to the client
  // when it cannot read a session, and the client fails CLOSED. Asserting a step here instead would
  // let a DB hiccup lock a real user into onboarding.
  it('never asserts a step for an unknown profile', () => {
    expect(pendingOnboardingStep(null)).toBe(null)
    expect(pendingOnboardingStep(undefined)).toBe(null)
  })

  // Today's shipped setting. When the flag flips this test flips with it — that is the point:
  // enabling the requirement should be a deliberate, visible edit, not a silent behaviour change.
  it('phone is NOT required while SIGNUP_REQUIRES_PHONE is off', () => {
    expect(SIGNUP_REQUIRES_PHONE).toBe(false)
    expect(pendingOnboardingStep({ accountType: 'individual', phone: null })).toBe(null)
  })
})

// Security review 2026-10-22, item 4: while eno's phone sign-in is off, a phone confirmation stamped
// since it went off is not proof of anything — eno could not have sent the code.
describe('phoneConfirmationTrusted', () => {
  it('never trusts a missing or unreadable confirmation', () => {
    expect(phoneConfirmationTrusted(null)).toBe(false)
    expect(phoneConfirmationTrusted(undefined)).toBe(false)
    expect(phoneConfirmationTrusted('')).toBe(false)
    expect(phoneConfirmationTrusted('not a date')).toBe(PHONE_OTP_ENABLED)
  })
  it('keeps confirmations eno made before phone sign-in went off', () => {
    expect(phoneConfirmationTrusted('2026-07-01T10:00:00Z')).toBe(true)
    expect(phoneConfirmationTrusted('2026-08-17T23:59:59Z')).toBe(true)
  })
  it('refuses confirmations stamped while phone sign-in is off', () => {
    expect(phoneConfirmationTrusted('2026-08-18T00:00:00Z')).toBe(PHONE_OTP_ENABLED)
    expect(phoneConfirmationTrusted('2026-10-22T08:00:00Z')).toBe(PHONE_OTP_ENABLED)
  })
})
