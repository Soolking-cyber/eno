import { describe, it, expect } from 'vitest'
import { notificationScope, SERVICES_ONLY_NOTIFICATION_TYPES } from './route'

/**
 * ⛔ IMPORTS THE REAL PREDICATE, per the idiom in report/cooldown.test.ts — re-implementing the
 * clause here would pin a copy and stay green against drifted code.
 *
 * What this guards: `sendVisaResultCard` writes a notification row titled "eno e-Visa", and
 * /api/notifications is `route.ts` — compiled into BOTH editions — selecting title and body
 * verbatim. Without scoping, an applicant who signs into eno.vn saw eno's own e-Visa service in
 * the marketplace bell. eno.vn is a licensed sàn TMĐT that may not surface it at all, so this is
 * a licensing failure rather than a cosmetic one. Two external reviewers found it independently;
 * the existing guard covered only the BUNDLE (no visa string in notification-bell.tsx) and left
 * the DATA path open.
 */
describe('notificationScope', () => {
  it('⛔ EXCLUDES SERVICES-TIER TYPES ON THE MARKETPLACE', () => {
    const w = notificationScope('u1', true) as { type?: { notIn: string[] } }
    expect(w.type?.notIn).toContain('visa_result')
  })

  it('⛔ EXCLUDES NOTHING ON THE SERVICES EDITION — eno.forum is where these belong', () => {
    // Over-filtering here is the opposite failure and just as bad: the applicant would stop
    // being told their visa result on the only edition allowed to tell them.
    expect(notificationScope('u1', false)).toEqual({ recipientId: 'u1' })
  })

  it('always scopes to the recipient, in both editions', () => {
    // The licensing filter must never be able to widen the query. If a future edit reorders the
    // spread, recipientId could be overwritten and one user would read another's notifications.
    expect(notificationScope('u1', true).recipientId).toBe('u1')
    expect(notificationScope('u2', false).recipientId).toBe('u2')
  })

  it('⚠️ THE DENY-LIST IS NOT EMPTY — an empty notIn silently disables the whole guard', () => {
    expect(SERVICES_ONLY_NOTIFICATION_TYPES.length).toBeGreaterThan(0)
  })
})
