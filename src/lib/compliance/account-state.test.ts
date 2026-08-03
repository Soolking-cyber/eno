import { describe, it, expect } from 'vitest'
import {
  ACCOUNT_STATE, canPublish, canSelfRetry, canMessage, canTransition, assertTransition,
  shouldNudge, NUDGE_DAYS, type VerificationStatus,
} from './account-state'
import { publishBlockedBody } from './publish-block-response'
import { assertIdentityVerified, PublishBlockedError } from '@/lib/publish-guard'

const ALL: VerificationStatus[] = ['unverified', 'pending', 'verified', 'rejected', 'expired', 'revoked']
const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n))

describe('publishing gate', () => {
  it('ONLY verified may publish', () => {
    // The single most important assertion in this file: if this inverts, unverified sellers post.
    for (const s of ALL) expect(canPublish(s), s).toBe(s === 'verified')
  })

  it('everyone except a suspended account may still message', () => {
    // A suspended seller mid-deal still has a buyer waiting; severing chat strands that buyer.
    for (const s of ALL) expect(canMessage(s), s).toBe(s !== 'revoked')
  })

  it('separates fixable rejection from suspension — the states must NOT be merged', () => {
    expect(canSelfRetry('rejected')).toBe(true)   // blurry scan → retry now
    expect(canSelfRetry('expired')).toBe(true)    // renewed TRC → retry now
    expect(canSelfRetry('revoked')).toBe(false)   // fraud/authority → human only
  })
})

describe('state transitions', () => {
  it('a suspended account has NO self-service way back', () => {
    for (const s of ALL) expect(canTransition('revoked', s), `revoked→${s}`).toBe(false)
  })

  it('verified can expire without any user action (document clock)', () => {
    expect(canTransition('verified', 'expired')).toBe(true)
  })

  it('rejected and expired can re-enter review', () => {
    expect(canTransition('rejected', 'pending')).toBe(true)
    expect(canTransition('expired', 'pending')).toBe(true)
  })

  it('cannot jump straight from unverified to verified — review is not skippable', () => {
    expect(canTransition('unverified', 'verified')).toBe(false)
    expect(() => assertTransition('unverified', 'verified')).toThrow(/illegal/)
  })

  it('every public state name is distinct', () => {
    const names = Object.values(ACCOUNT_STATE)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('publish-guard identity gate', () => {
  it('fails CLOSED on an unknown status', () => {
    // A typo or a future status must never become permission to publish.
    expect(() => assertIdentityVerified('VERIFIED')).toThrow(PublishBlockedError) // wrong case
    expect(() => assertIdentityVerified('banana')).toThrow(PublishBlockedError)
    expect(() => assertIdentityVerified('')).toThrow(PublishBlockedError)
  })

  it('is a no-op when the caller has no profile loaded', () => {
    // The wizard runs content checks before resolving a profile; undefined means "not my job".
    expect(() => assertIdentityVerified(undefined)).not.toThrow()
    expect(() => assertIdentityVerified(null)).not.toThrow()
  })

  it('emits a DISTINCT code per state so the copy can differ', () => {
    const code = (s: string) => {
      try { assertIdentityVerified(s); return 'ok' } catch (e) { return (e as PublishBlockedError).code }
    }
    expect(code('verified')).toBe('ok')
    expect(code('pending')).toBe('identity_pending')
    expect(code('expired')).toBe('identity_expired')
    expect(code('revoked')).toBe('identity_suspended')
    expect(code('rejected')).toBe('identity_unverified')
  })
})

describe('blocked-publish response', () => {
  it('points a fixable block at the verify route and preserves the draft', () => {
    const b = publishBlockedBody('identity_unverified', 'unverified')
    expect(b.accountState).toBe('PENDING_VERIFICATION')
    expect(b.actionable).toBe(true)
    expect(b.verifyUrl).toBe('/dashboard/account/verify')
    expect(b.draftPreserved).toBe(true)
    expect(b.legalBasis?.vi).toContain('248/2026')
  })

  it('offers no self-service route on suspension', () => {
    const b = publishBlockedBody('identity_suspended', 'revoked')
    expect(b.actionable).toBe(false)
    expect(b.verifyUrl).toBeNull()
  })

  it('does NOT cite a decree for a quality block', () => {
    // Quoting law at someone whose photo has glare trains users to ignore the citation.
    const b = publishBlockedBody('photos_min', 'verified')
    expect(b.legalBasis).toBeUndefined()
  })

  it('never tells an expired seller they are unverified', () => {
    const b = publishBlockedBody('identity_expired', 'expired')
    expect(b.message.en).toMatch(/expired/i)
    expect(b.message.en).not.toMatch(/not verified/i)
  })
})

describe('30-day nudge scheduling', () => {
  const base = {
    createdAt: day(0), status: 'unverified' as VerificationStatus, hasSellingIntent: true,
    lastPromptAt: null, promptCount: 0, optedOut: false,
  }

  it('does not nudge before day 1', () => {
    expect(shouldNudge({ ...base, now: day(0) }).send).toBe(false)
  })

  it('sends the welcome step on day 1 even with no selling intent', () => {
    const d = shouldNudge({ ...base, hasSellingIntent: false, now: day(1) })
    expect(d).toMatchObject({ send: true, step: 0, tone: 'welcome' })
  })

  it('⚠️ does NOT nag a pure buyer past the welcome step', () => {
    // The failure this prevents: mailing an escalating compliance warning to everyone who ever
    // signed up to buy a motorbike, then losing deliverability to their spam complaints.
    const d = shouldNudge({ ...base, hasSellingIntent: false, promptCount: 1, now: day(7) })
    expect(d).toEqual({ send: false, reason: 'no_selling_intent' })
  })

  it('escalates to deadline tone at day 30', () => {
    const d = shouldNudge({ ...base, promptCount: 3, now: day(30) })
    expect(d).toMatchObject({ send: true, tone: 'deadline' })
  })

  it('enforces a cooldown even if the schedule says due', () => {
    // Guards the real-world case: an hourly cron reading a stale promptCount after a failed write.
    const d = shouldNudge({ ...base, promptCount: 1, lastPromptAt: day(29), now: day(30) })
    expect(d).toEqual({ send: false, reason: 'cooldown' })
  })

  it('stops once the schedule is exhausted', () => {
    const d = shouldNudge({ ...base, promptCount: NUDGE_DAYS.length, now: day(90) })
    expect(d).toEqual({ send: false, reason: 'schedule_exhausted' })
  })

  it.each([
    ['verified', 'already_verified'],
    ['pending', 'review_in_progress'],
    ['revoked', 'suspended_needs_human'],
  ] as const)('never nudges a %s account', (status, reason) => {
    expect(shouldNudge({ ...base, status, promptCount: 1, now: day(30) })).toEqual({ send: false, reason })
  })

  it('respects opt-out above everything else', () => {
    expect(shouldNudge({ ...base, optedOut: true, now: day(30) })).toEqual({ send: false, reason: 'opted_out' })
  })
})

describe('edition gating', () => {
  it('⚠️ identity is required on the MARKETPLACE only', async () => {
    // Owner, 2026-08-03: "eno.forum doesnt need it". The regression this pins is severe and silent:
    // publish-guard.ts is SHARED, so an ungated check would refuse every forum publish the moment
    // verificationStatus started being populated — and with no VNPT channel on that side, no seller
    // could ever clear it. A total publish lockout on a surface nobody is watching.
    const { IDENTITY_VERIFICATION_REQUIRED } = await import('./account-state')
    const { IS_MARKETPLACE } = await import('@/lib/edition')
    expect(IDENTITY_VERIFICATION_REQUIRED).toBe(IS_MARKETPLACE)
  })
})
