import { describe, it, expect } from 'vitest'
import { describeTrustEvent } from './trust'

/**
 * ⚠️ THE POINT OF THIS FILE IS ONE CLAIM: the data export must never tell a user that a person
 * judged them when a machine did.
 *
 * `manual_adjust` is an internal catch-all — the automated offer-spam penalty, the automatic
 * new_account / phone_verified / zalo_linked / kyc grants and genuine admin action all write it.
 * The PDPL export used to hand that raw string to the user, and /legal/ranking invites them to
 * dispute their score with support, so it is the one place the distinction reaches a human.
 */
describe('describeTrustEvent — the export must not claim a human acted', () => {
  it('describes the AUTOMATED offer-spam penalty as automatic, never as manual', () => {
    const s = describeTrustEvent('manual_adjust', 'nonneg_offer_spam')
    expect(s.toLowerCase()).toContain('automatic')
    expect(s.toLowerCase()).not.toContain('manual')
  })

  it.each(['new_account', 'phone_verified', 'zalo_linked', 'kyc', 'profile_complete'])(
    'describes the automatic one-time grant %s as automatic',
    (reason) => {
      const s = describeTrustEvent('manual_adjust', reason)
      expect(s.toLowerCase()).toContain('automatic')
      expect(s.toLowerCase()).not.toContain('manual')
    },
  )

  it('NEVER says "manual" for any known event, including a bare manual_adjust', () => {
    // A bare manual_adjust with no reason may well BE automated — an unrecognised caller. Claiming
    // a human acted is exactly the inaccuracy this function exists to prevent, so the fallback has
    // to be honest-but-vague rather than confidently wrong.
    for (const type of ['report_confirmed', 'report_dismissed', 'positive_review', 'fast_response',
                        'engagement', 'transaction', 'recompute_lift', 'decay_recover', 'manual_adjust']) {
      expect(describeTrustEvent(type, null).toLowerCase()).not.toContain('manual')
    }
    expect(describeTrustEvent('manual_adjust', undefined).toLowerCase()).not.toContain('manual')
    expect(describeTrustEvent('something_added_later', 'a_reason_nobody_mapped').toLowerCase()).not.toContain('manual')
  })

  it('does NOT leak the internal report id out of a false_report reason', () => {
    const s = describeTrustEvent('manual_adjust', 'false_report:clx123abc456')
    expect(s).not.toContain('clx123abc456')
    // NOT "contains no colon" — the legitimate sentence is "Penalty: a report you filed …".
    // What must not survive is the id, i.e. anything after the reason's own `false_report:`.
    expect(s).not.toContain('false_report')
    // It still has to tell the user what happened — this one genuinely WAS reviewed by a person.
    expect(s.toLowerCase()).toContain('report')
  })

  it('does not echo an unrecognised reason verbatim (it could carry an admin note)', () => {
    const s = describeTrustEvent('manual_adjust', 'internal note: suspected ring, see ticket 4471')
    expect(s).not.toContain('ticket')
    expect(s).not.toContain('suspected')
  })

  it('always returns a non-empty human sentence', () => {
    for (const [type, reason] of [['manual_adjust', 'nonneg_offer_spam'], ['engagement', null],
                                  ['unknown_type', null], ['manual_adjust', '']] as const) {
      const s = describeTrustEvent(type, reason)
      expect(s.length).toBeGreaterThan(8)
      expect(s).toBe(s.trim())
    }
  })
})
