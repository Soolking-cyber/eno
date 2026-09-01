import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * ⚠️ THE EDITION AND THE ENV ARE BOTH MOCKED, because the gate is the AND of two switches and a
 * test that only moved one would pass while the other was inverted.
 */
const editionMock = { IS_MARKETPLACE: true }
vi.mock('@/lib/edition', () => editionMock)

const readVerifiedIdentity = vi.fn()
vi.mock('./identity', () => ({ readVerifiedIdentity }))

const { personBeforeBusinessEnforced, ownerPersonVerified } = await import('./person-gate')

describe('personBeforeBusinessEnforced', () => {
  beforeEach(() => {
    editionMock.IS_MARKETPLACE = true
    delete process.env.PERSON_BEFORE_BUSINESS
  })

  // ⛔ OFF BY DEFAULT. Wiring a compliance gate and switching it on are different decisions; a
  // default-on flag would refuse every business seller the moment this ships, with no route out.
  it('is off unless the env var is exactly "1"', () => {
    expect(personBeforeBusinessEnforced()).toBe(false)
    process.env.PERSON_BEFORE_BUSINESS = 'true'
    expect(personBeforeBusinessEnforced()).toBe(false)
    process.env.PERSON_BEFORE_BUSINESS = '1'
    expect(personBeforeBusinessEnforced()).toBe(true)
  })

  /**
   * ⛔ MARKETPLACE ONLY. The seller-authentication mandate binds the licensed Vietnamese platform;
   * eno.forum is deliberately outside it. Both plan reviewers raised the edition question — without
   * this, turning the flag on would impose a marketplace policy on forum sellers.
   */
  it('is off on the services edition even with the flag set', () => {
    process.env.PERSON_BEFORE_BUSINESS = '1'
    editionMock.IS_MARKETPLACE = false
    expect(personBeforeBusinessEnforced()).toBe(false)
  })
})

describe('ownerPersonVerified', () => {
  beforeEach(() => readVerifiedIdentity.mockReset())

  it('is true only when the read model returns an identity', async () => {
    readVerifiedIdentity.mockResolvedValue({ fullName: 'A B' })
    expect(await ownerPersonVerified('p1')).toBe(true)
    readVerifiedIdentity.mockResolvedValue(null)
    expect(await ownerPersonVerified('p1')).toBe(false)
  })

  /**
   * ⛔ A GUEST SELLER HAS NO OWNER AND THEREFORE NO IDENTITY — the same fact `listings.ts` records.
   * Returning true for the absence of a person would make the gate a no-op on exactly the rows
   * least accounted for, and it must not even ASK the read model with an empty id.
   */
  it('refuses a seller with no owner, without consulting the read model', async () => {
    expect(await ownerPersonVerified(null)).toBe(false)
    expect(await ownerPersonVerified(undefined)).toBe(false)
    expect(await ownerPersonVerified('')).toBe(false)
    expect(readVerifiedIdentity).not.toHaveBeenCalled()
  })
})
