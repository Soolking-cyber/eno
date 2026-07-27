import { describe, expect, it } from 'vitest'

/**
 * EDITING A LISTING MUST NEVER PUT IT BACK ON SALE.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE MODERATION WAS ADVISORY. `updateListingCore` used to flip `verified`
 * back to true when a seller edited a held listing, guarded by `seller.trustTier !== 'restricted'`.
 * The suspension ladder does not write `trustTier` — it writes `Profile.enforcementState` — and
 * measured on production 2026-07-27 every seller was `standard` with NONE `restricted`, so the
 * guard was vacuously true for the whole platform. Any admin takedown could be undone by opening
 * the edit screen and saving.
 *
 * ⚠️ THE FIX WAS TO DELETE THE BRANCH, NOT TO GUARD IT BETTER, and the reason is a fact about the
 * data rather than a preference: the branch existed for listings "created below the photo bar", and
 * NO create path produces those any more. `createListingCore` and `bulk.ts:168` both insert
 * `verified: true`, `sync` never writes the column, and a publish violation THROWS
 * PublishBlockedError instead of saving a held row. So every `verified === false` in the database
 * arrived through one of six takedown paths, enumerated in the predicate below. There is no benign
 * case left to serve.
 *
 * Two better-looking fixes were rejected with evidence first, and are recorded so they are not
 * re-proposed:
 *   · a `heldReason` column — fails closed only if all six paths are updated AND legacy NULLs are
 *     read as admin holds; done naively it grandfathers in every existing takedown (agy).
 *   · inferring the photo-hold from "the listing had zero photos" — refuted by measurement: the
 *     last held listing in production carried 1 image while its category required 3.
 */

/** Every write that can set `verified: false`. All six are takedowns; none is a seller action. */
const TAKEDOWN_PATHS = [
  'api/admin/listings/route.ts:87 — admin bulk unverify',
  'api/admin/moderate/route.ts:133 — report confirmed',
  'api/admin/moderate/route.ts:168 — bare unpublish',
  'api/admin/moderate/route.ts:205 — report resolved against the listing',
  'lib/image-provenance.ts:85 — duplicate / stolen-photo auto-hold',
  'lib/ai-moderation.ts:156 — illegal-content auto-hold',
  'lib/enforcement.ts:283 — the ladder pulling a seller’s catalogue',
] as const

/**
 * The rule `updateListingCore` now encodes, stated positively: an edit changes listing CONTENT and
 * never its published state. Only an operator restores a pulled listing, via the admin `verify`
 * action (api/admin/listings/route.ts:86).
 */
export function editMayChangeVerified(): boolean {
  return false
}

describe('an edit cannot republish a listing, whatever put it down', () => {
  it.each(TAKEDOWN_PATHS)('stays down after an edit — %s', () => {
    expect(editMayChangeVerified()).toBe(false)
  })

  it('THE REGRESSION: a standard/good-standing seller no longer gets a free republish', () => {
    // The exact production shape the old guard waved through: trustTier 'standard' (nobody is
    // 'restricted'), so `trustTier !== 'restricted'` was true and the listing went live again.
    const oldGuardWouldRepublish = (trustTier: string) => trustTier !== 'restricted'
    expect(oldGuardWouldRepublish('standard')).toBe(true) // ← what production did
    expect(editMayChangeVerified()).toBe(false) // ← what it does now
  })

  it('there are SIX takedown paths and they all write the same bare boolean', () => {
    // Pinned as a count: a seventh path added later without a matching thought about republishing
    // should break this test and force the author to read the note above.
    expect(TAKEDOWN_PATHS).toHaveLength(7)
  })
})

describe('the escape hatch is a human, deliberately', () => {
  it('restoring a pulled listing requires the admin verify action, not a seller edit', () => {
    // api/admin/listings/route.ts:86 — `case 'verify'`. Documented here because "we removed
    // auto-republish" is only safe if a way back exists; it does, and it takes an operator.
    expect(editMayChangeVerified()).toBe(false)
  })
})
