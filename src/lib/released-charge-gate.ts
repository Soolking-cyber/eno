import 'server-only'
import { db } from './db'
import { computeTrustV2 } from './trust'
import { ENFORCEMENT } from './enforcement-machine'
import { SCAM_RELEASE_PREFIX } from './trust-math'

/**
 * POSTING AFTER A SCAM-HOLD RELEASE (owner, 2026-09-24: "you decide" — decided).
 *
 * A release ends the HOLD, not the CHARGE: the confirmed scam keeps its full, frozen weight in C
 * (trust-math decayFactor), so the account stays in the restricted trust tier — and that tier's
 * publish refusal (publish-guard `account_restricted`) kept a released seller from posting anything,
 * with no path or timeline, since graduation is not built. The decision:
 *
 *   • a seller whose ONLY standing scam charges are RELEASED regains posting: the restricted-tier
 *     refusal is waived for them (`waivesRestricted`) — when it is those charges that keep the account
 *     under the floor, i.e. with their weight out of C the score clears ENFORCEMENT.RESTRICTED_SCORE
 *     (trust.ts scoreWithoutReleasedScams). A seller restricted by OTHER confirmed conduct as well
 *     stays restricted: the waiver is for the released charges, not for the trust floor;
 *   • while ANY released charge stands, the storefront may hold at most
 *     ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS listings in status 'active' — the same status set
 *     the probation cap counts. Enforced on every path that makes a listing active: create
 *     (createListingCore — web, /api/v1, MCP), bulk import and catalogue sync (core/bulk, core/sync),
 *     relist (setStatusCore) and a confirm that revives (confirmCore). Refusal code
 *     `released_charge_listing_cap`;
 *   • a HELD (unreleased) charge still blocks posting exactly as before: the account is `held`
 *     (postingGate / enforcementBlockForRevive) and the restricted refusal is NOT waived;
 *   • the public caution note stays — nothing here touches the storefront, the tier or the score.
 *
 * ⚠️ The cap governs what the seller ADDS. The release's own restore (enforcement.ts restoreListings)
 * brings back everything the hold pulled — an admin decision — and those rows count toward the cap,
 * so a seller who had 30 live listings gets them back and cannot add or relist until below the limit.
 *
 * ⚠️ ACCEPTED RACE (the same check-then-create TOCTOU the probation cap and the urgent quota accept):
 * two simultaneous creates at 9 active can both pass. Bounded by the seller's own concurrency.
 *
 * "Standing" and "released" are computeTrustV2's own derivation (inputs.scamCharges — the charges
 * scam-hold.ts releases and overturns), never a second reading of the ledger: an overturned or
 * appealed-away charge stops counting the moment it stops standing.
 */

/** The account-wide half: is this owner under the released-charge regime at all? (No listing count.) */
export type ReleasedChargeStanding = {
  /** Every standing scam charge is released — the restricted-tier publish refusal does not apply. */
  waivesRestricted: boolean
  /** Active listings the storefront may hold while a released charge stands. */
  limit: number
}

/** Standing plus the storefront's current count: what a single activation is checked against. */
export type ReleasedChargeGate = ReleasedChargeStanding & {
  /** Listings in status 'active' on the storefront now (a pulled or parked row counts: it is active). */
  active: number
  /** How many more may become active before the cap refuses (0 = refuse the next one). */
  remaining: number
}

/**
 * Null = no released scam charge stands: the ordinary gates apply, untouched.
 *
 * ONE cheap read for everyone else — has a release marker EVER been written for this owner? Only
 * then is the full derivation run (a release is rare, and the marker is the only way into the regime).
 * A DB failure throws: a gate that cannot answer must not wave a listing through.
 */
export async function releasedChargeStanding(ownerId: string | null | undefined): Promise<ReleasedChargeStanding | null> {
  if (!ownerId) return null // an ownerless storefront (platform import) has no trust ledger
  const marker = await db.trustEvent.findFirst({
    where: { subjectProfileId: ownerId, type: 'manual_adjust', reason: { startsWith: SCAM_RELEASE_PREFIX } },
    select: { id: true },
  })
  if (!marker) return null
  const breakdown = await computeTrustV2(ownerId)
  const charges = breakdown?.inputs.scamCharges ?? []
  const released = charges.filter((c) => c.stage === 'released').length
  // Every released charge has since been reversed (an overturn, a won appeal): the regime is over.
  if (!breakdown || released === 0) return null
  const onlyReleased = released === charges.length
  const releasedAreTheReason = breakdown.inputs.scoreWithoutReleasedScams >= ENFORCEMENT.RESTRICTED_SCORE
  return { waivesRestricted: onlyReleased && releasedAreTheReason, limit: ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS }
}

/** Count a storefront's active listings against a standing (the sync reuses one standing per call). */
export async function releasedChargeGateFor(standing: ReleasedChargeStanding, sellerId: string): Promise<ReleasedChargeGate> {
  const active = await db.listing.count({ where: { sellerId, status: 'active' } })
  return { ...standing, active, remaining: Math.max(0, standing.limit - active) }
}

/** Standing + count in one call — what createListingCore, setStatusCore and confirmCore ask. */
export async function releasedChargeGate(ownerId: string | null | undefined, sellerId: string): Promise<ReleasedChargeGate | null> {
  const standing = await releasedChargeStanding(ownerId)
  return standing ? releasedChargeGateFor(standing, sellerId) : null
}
