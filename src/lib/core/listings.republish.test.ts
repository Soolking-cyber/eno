import { describe, expect, it } from 'vitest'
import { minPhotosFor } from '@/lib/publish-guard'

/**
 * WHEN MAY EDITING A LISTING PUT IT BACK ON SALE?
 *
 * ⚠️ THIS EXISTS BECAUSE THE GUARD ASKED THE WRONG QUESTION AND ALWAYS GOT "YES". The branch in
 * `updateListingCore` that flips `verified` back to true tested
 * `seller.trustTier !== 'restricted'` — but the suspension ladder does not write `trustTier`. It
 * writes `Profile.enforcementState`. Measured on production 2026-07-27: every seller was
 * `standard` and NONE was `restricted`, so the condition was vacuously true for the entire
 * platform, and a seller whose catalogue had been pulled could restore any listing by opening the
 * edit screen and saving it. Moderation was advisory.
 *
 * The predicate below is the rule that branch now encodes. It is exported logic-shaped rather than
 * asserted through Prisma so the RULE can be tested without a database — the same reason
 * `thread-kind.ts` and `seo-landing-href.ts` are their own leaf modules.
 */
export function mayRepublishOnEdit(input: {
  verified: boolean
  trustTier: string | null | undefined
  enforcementState: string | null | undefined
  categorySlug: string | undefined
  photoCount: number
}): boolean {
  if (input.verified) return false // already public — nothing to republish
  if (input.trustTier === 'restricted') return false
  if (input.enforcementState === 'held' || input.enforcementState === 'suspended') return false
  return input.photoCount >= minPhotosFor(input.categorySlug)
}

const base = {
  verified: false,
  trustTier: 'standard' as string | null,
  enforcementState: 'good_standing' as string | null,
  categorySlug: 'services',
  photoCount: 1,
}

describe('a held or suspended seller cannot republish by editing', () => {
  it.each(['held', 'suspended'])('enforcementState=%s blocks it', (state) => {
    expect(mayRepublishOnEdit({ ...base, enforcementState: state })).toBe(false)
  })

  it('THE REGRESSION: a standard trustTier no longer waves it through', () => {
    // Exactly the production shape — trustTier 'standard' (nobody is 'restricted') while the
    // ladder holds the account. The old guard consulted only the first of these and said yes.
    expect(mayRepublishOnEdit({ ...base, trustTier: 'standard', enforcementState: 'suspended' })).toBe(false)
  })

  it.each(['good_standing', 'warned', 'throttled'])('%s is NOT a publishing block', (state) => {
    // The ladder's lower rungs are warnings, not takedowns; they must not strand a seller who is
    // simply adding the photo their listing was missing.
    expect(mayRepublishOnEdit({ ...base, enforcementState: state })).toBe(true)
  })

  it('a restricted trustTier still blocks it — the original rule is kept, not replaced', () => {
    expect(mayRepublishOnEdit({ ...base, trustTier: 'restricted' })).toBe(false)
  })
})

describe('the photo floor is the category’s, not a hard-coded 1', () => {
  it('goods need 3 — one photo is no longer enough to publish', () => {
    expect(minPhotosFor('vehicles')).toBe(3)
    expect(mayRepublishOnEdit({ ...base, categorySlug: 'vehicles', photoCount: 1 })).toBe(false)
    expect(mayRepublishOnEdit({ ...base, categorySlug: 'vehicles', photoCount: 3 })).toBe(true)
  })

  it('services need 1', () => {
    expect(mayRepublishOnEdit({ ...base, categorySlug: 'services', photoCount: 1 })).toBe(true)
    expect(mayRepublishOnEdit({ ...base, categorySlug: 'services', photoCount: 0 })).toBe(false)
  })

  it('an unknown category is treated strictly, not leniently', () => {
    expect(mayRepublishOnEdit({ ...base, categorySlug: undefined, photoCount: 1 })).toBe(false)
  })
})

describe('what this rule still cannot see', () => {
  it('⚠️ cannot tell an admin unpublish from a photo-hold — both are just verified=false', () => {
    // Documented as a KNOWN GAP rather than faked. `unpublish` (api/admin/moderate/route.ts:168)
    // writes `{ verified: false }` and nothing else, so a listing pulled by an admin from a
    // good-standing seller is indistinguishable from one held for missing photos — and it
    // republishes on edit. "A photo-hold has zero photos" cannot stand in as the discriminator
    // either: the one held listing in production carries 1 image. Closing this needs a column
    // recording WHY a listing is unverified.
    const adminPulled = { ...base, categorySlug: 'services', photoCount: 1, enforcementState: 'good_standing' }
    expect(mayRepublishOnEdit(adminPulled)).toBe(true) // ← the remaining hole, pinned so it is not forgotten
  })
})
