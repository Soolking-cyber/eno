import { describe, it, expect } from 'vitest'
import { decideBeforeStatus, decideOwned, decisionForStatus } from './seller-publish-decision'
import { VNEID_LINK_DEADLINE_EXISTING, VNEID_LINK_DEADLINE_NEW } from './legal-basis'
import { assertIdentityVerified, identityBlockCodeFor, PublishBlockedError } from '@/lib/publish-guard'
import { canPublish, type VerificationStatus } from './account-state'

// ── The seller identity decision's RULES, without a database ────────────────────────────────────
//
// Every case is one of the ways the gate could quietly be wrong in the permissive direction (a guest
// slipping through, a late account getting the lenient deadline, an unknown status reading as fine)
// or in the destructive one (refusing while the switch is off, refusing a platform import seller).

const OLD_ACCOUNT = new Date('2026-05-01T10:00:00+07:00') // before 2026-09-28 → end-of-2026 deadline
const NEW_ACCOUNT = new Date('2026-10-02T10:00:00+07:00') // on/after 2026-09-28 → must link before selling
const base = { enforced: true, ownerId: 'owner-1', accountCreatedAt: OLD_ACCOUNT }

describe('decideBeforeStatus', () => {
  it('⛔ GATE OFF → ALLOWED, whatever else is true — even a guest', () => {
    const now = new Date('2027-06-01T00:00:00+07:00')
    expect(decideBeforeStatus({ enforced: false, ownerId: null, guestCreate: true, now })).toEqual({ ok: true })
    expect(decideBeforeStatus({ enforced: false, ownerId: 'o', accountCreatedAt: NEW_ACCOUNT, now })).toEqual({ ok: true })
  })

  it('⛔ a GUEST create is refused with its own code (the wizard says "sign in, then verify")', () => {
    const d = decideBeforeStatus({ enforced: true, ownerId: null, guestCreate: true, now: new Date('2026-09-23T12:00:00+07:00') })
    expect(d).toEqual({ ok: false, code: 'identity_sign_in_required' })
  })

  it('a guest is refused even INSIDE the grace window — there is no account for the grace to belong to', () => {
    const d = decideBeforeStatus({ enforced: true, ownerId: null, guestCreate: true, now: new Date('2026-01-01T00:00:00+07:00') })
    expect(d?.ok).toBe(false)
  })

  it('an OWNERLESS storefront on an admin/cron/script path is allowed — a platform import seller, nobody to verify', () => {
    expect(decideBeforeStatus({ enforced: true, ownerId: null, now: new Date('2027-06-01T00:00:00+07:00') })).toEqual({ ok: true })
  })

  it('⛔ an OWNED storefront always needs its owner\'s status — even inside the grace window', () => {
    expect(decideBeforeStatus({ ...base, now: new Date('2026-09-23T12:00:00+07:00') })).toBeNull()
  })
})

describe('decideOwned — grace, and what grace does NOT cover', () => {
  const G = (status: string, accountCreatedAt: Date | null, now: string) => decideOwned(status, accountCreatedAt, new Date(now))

  it('an EXISTING account is in grace until the end of 2026 (Decree 320/2026)', () => {
    expect(G('unverified', OLD_ACCOUNT, '2026-12-31T23:59:58+07:00')).toEqual({ ok: true })
  })

  it('…and needs to be verified from the deadline instant on (`<`, not `<=`)', () => {
    expect(decideOwned('unverified', OLD_ACCOUNT, VNEID_LINK_DEADLINE_EXISTING)).toEqual({ ok: false, code: 'identity_unverified' })
    expect(G('unverified', OLD_ACCOUNT, '2027-01-01T00:00:00+07:00').ok).toBe(false)
    expect(G('verified', OLD_ACCOUNT, '2027-01-01T00:00:00+07:00')).toEqual({ ok: true })
  })

  it('an account created BEFORE 2026-09-28 still gets the late deadline on 2026-10-01', () => {
    expect(G('pending', OLD_ACCOUNT, '2026-10-01T00:00:00+07:00')).toEqual({ ok: true })
  })

  it('⛔ an account created ON or AFTER 2026-09-28 has no grace at all', () => {
    expect(decideOwned('unverified', VNEID_LINK_DEADLINE_NEW, new Date('2026-09-28T00:00:01+07:00')).ok).toBe(false)
    expect(G('pending', NEW_ACCOUNT, '2026-10-02T11:00:00+07:00')).toEqual({ ok: false, code: 'identity_pending' })
  })

  it('before 2026-09-28 EVERY account is in grace (today, 2026-09-23)', () => {
    expect(G('unverified', new Date('2026-09-23T08:00:00+07:00'), '2026-09-23T12:00:00+07:00')).toEqual({ ok: true })
  })

  it('⚠️ an UNKNOWN creation date gets no grace — a missing Profile must not earn the lenient answer', () => {
    expect(G('unverified', null, '2026-09-23T12:00:00+07:00').ok).toBe(false)
  })

  it('⛔ EXPIRED is refused inside the grace window too — a lapsed document is not an unlinked account', () => {
    expect(G('expired', OLD_ACCOUNT, '2026-09-23T12:00:00+07:00')).toEqual({ ok: false, code: 'identity_expired' })
    expect(G('rejected', OLD_ACCOUNT, '2026-09-23T12:00:00+07:00')).toEqual({ ok: true })
  })

  it('⛔ REVOKED is refused even deep inside the grace window — grace is for LINKING, not for fraud or an authority order', () => {
    expect(G('revoked', OLD_ACCOUNT, '2026-09-23T12:00:00+07:00')).toEqual({ ok: false, code: 'identity_suspended' })
    expect(G('revoked', new Date('2026-09-23T08:00:00+07:00'), '2026-09-23T12:00:00+07:00').ok).toBe(false)
  })
})

describe('decisionForStatus — canPublish is the ONE predicate', () => {
  const cases: Array<[VerificationStatus | string, false | string]> = [
    ['verified', false],
    ['unverified', 'identity_unverified'],
    ['rejected', 'identity_unverified'],
    ['pending', 'identity_pending'],
    ['expired', 'identity_expired'],
    ['revoked', 'identity_suspended'],
    // ⚠️ FAIL CLOSED: a typo or a future status is not permission to publish.
    ['something-new', 'identity_unverified'],
    ['', 'identity_unverified'],
  ]
  it.each(cases)('%s → %s', (status, code) => {
    expect(decisionForStatus(status)).toEqual(code === false ? { ok: true } : { ok: false, code })
  })

  it('agrees with canPublish on every known status — there is no second copy of the rule', () => {
    for (const s of ['unverified', 'pending', 'verified', 'rejected', 'expired', 'revoked'] as VerificationStatus[]) {
      expect(decisionForStatus(s).ok).toBe(canPublish(s))
      expect(identityBlockCodeFor(s) === null).toBe(canPublish(s))
    }
  })

  it('assertIdentityVerified throws the mapped code and still treats a missing status as "not my job"', () => {
    expect(() => assertIdentityVerified(undefined)).not.toThrow()
    expect(() => assertIdentityVerified(null)).not.toThrow()
    expect(() => assertIdentityVerified('verified')).not.toThrow()
    try { assertIdentityVerified('revoked'); expect.unreachable() } catch (e) {
      expect(e).toBeInstanceOf(PublishBlockedError)
      expect((e as PublishBlockedError).code).toBe('identity_suspended')
    }
  })
})
