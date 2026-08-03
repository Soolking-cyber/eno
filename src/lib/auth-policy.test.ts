import { describe, expect, it } from 'vitest'
import { pendingOnboardingStep, SIGNUP_REQUIRES_PHONE } from './auth-policy'

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
