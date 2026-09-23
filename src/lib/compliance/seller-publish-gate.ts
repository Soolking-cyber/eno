import 'server-only'
import { db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'
import { refreshPublicSurfaces, releaseIdentityHolds } from './identity-holds'
import { logError } from '@/lib/log'
import { PublishBlockedError } from '@/lib/publish-guard'
import { identityGateEnforced } from './account-state'
import { verificationStatusForDecision } from './recompute-verification'
import { PUBLISH_ALLOWED, decideBeforeStatus, decideOwned, type SellerPublishDecision } from './seller-publish-decision'

export { PUBLISH_ALLOWED, type SellerPublishDecision } from './seller-publish-decision'
export { releaseIdentityHolds } from './identity-holds'

// ── THE SELLER IDENTITY GATE — every transition of a listing INTO public state asks this ──────────
//
// A listing is public iff `verified = true AND status = 'active'`, and there is no central read-side
// predicate to hang a check on (the feed, search, sitemap, product feeds and the PDP each filter for
// themselves). So the gate sits on the WRITES instead: every path that can move a listing into that
// state resolves the owner's decision here. src/lib/compliance/public-state-writes.test.ts fails the suite
// when a new file starts writing public state without being audited against this list.
//
// TWO RESPONSES, CHOSEN BY WHO ACTED (owner, 2026-09-23):
//   · SELLER-INITIATED (create, bulk, sync, relist/setStatus, confirm) → REFUSE with the identity
//     code. The seller is right there and can go and verify; a silent hold would read as "posted".
//   · ADMIN / ENFORCEMENT / SCRIPT / CLAIM → HOLD: keep `verified = false`, set `identityHold = true`,
//     report the count. A moderator approving a listing has made a CONTENT decision that should
//     survive the identity one — so it is parked, not discarded, and releaseIdentityHolds() below
//     publishes it the moment the seller verifies.
//
// ⛔ WITH THE GATE OFF, NOTHING HERE READS OR WRITES ANYTHING. Every helper returns before its first
// query when identityGateEnforced() is false, so the switch really is a switch: flipping it off
// restores the exact pre-gate behaviour, and scripts/release-identity-holds.ts publishes whatever
// was parked while it was on.

/**
 * The decision for ONE owner. Resolve it once per request or batch and pass it down — never once
 * per row: it costs a Profile read and an identity_verifications read.
 */
export async function sellerPublishDecision(input: {
  ownerId: string | null
  guestCreate?: boolean
  now?: Date
}): Promise<SellerPublishDecision> {
  const now = input.now ?? new Date()
  const enforced = identityGateEnforced()
  if (!enforced) return PUBLISH_ALLOWED
  // Only an owned storefront needs the account's age; skip the read for the ownerless branches.
  const accountCreatedAt = input.ownerId
    ? (await db.profile.findUnique({ where: { id: input.ownerId }, select: { createdAt: true } }))?.createdAt ?? null
    : null
  const early = decideBeforeStatus({ enforced, ownerId: input.ownerId, guestCreate: input.guestCreate, accountCreatedAt, now })
  if (early) return early
  // ⛔ identity_verifications, NEVER the Profile cache — see verificationStatusForDecision.
  return decideOwned(await verificationStatusForDecision(input.ownerId!, now), accountCreatedAt, now)
}

/** The assert form for paths that already speak PublishBlockedError (createListingCore). */
export async function assertSellerMayPublish(input: { ownerId: string | null; guestCreate?: boolean; now?: Date }): Promise<void> {
  const d = await sellerPublishDecision(input)
  if (!d.ok) throw new PublishBlockedError(d.code)
}

/**
 * Split listing ids by whether their owner may publish — for the admin/enforcement/script batches
 * that HOLD rather than refuse. One decision per distinct owner, however many rows share it.
 * Gate off → every id is allowed and nothing is read.
 */
export async function partitionByIdentityGate(
  listingIds: string[],
  now: Date = new Date(),
): Promise<{ allowed: string[]; held: string[] }> {
  if (!identityGateEnforced() || !listingIds.length) return { allowed: listingIds, held: [] }
  const rows = await db.listing.findMany({ where: { id: { in: listingIds } }, select: { id: true, seller: { select: { ownerId: true } } } })
  const owners = [...new Set(rows.map((r) => r.seller.ownerId).filter((o): o is string => !!o))]
  const refused = new Set<string>()
  for (const ownerId of owners) {
    if (!(await sellerPublishDecision({ ownerId, now })).ok) refused.add(ownerId)
  }
  const heldSet = new Set(rows.filter((r) => r.seller.ownerId && refused.has(r.seller.ownerId)).map((r) => r.id))
  return { allowed: listingIds.filter((id) => !heldSet.has(id)), held: listingIds.filter((id) => heldSet.has(id)) }
}

/**
 * Close the check-then-write window every HOLD leaves open. Call it AFTER the hold write commits,
 * with the ids that were parked. Returns how many of them it released, so the caller can report
 * the true held count.
 *
 * ⚠️ WHY: each hold path decides first (partitionByIdentityGate / sellerPublishDecision) and writes
 * `identityHold = true` afterwards, with no lock between. If the seller's KYC approval lands in that
 * window, recomputeVerification → releaseIdentityHolds runs BEFORE the hold exists, finds nothing,
 * and the hold written a moment later belongs to a now-verified seller — and nothing ever runs the
 * release again (no scheduled recompute; relisting an active row never touches `verified`). The
 * re-check closes it: either this read sees the verification (and releases here), or the
 * verification committed after this read — in which case its own release runs after our hold
 * committed and finds it. Only an owner whose decision is NOW ok is released; a hold for an owner
 * still refused is left exactly as written.
 *
 * Fail-quiet (logged): the hold itself already landed, and failing the admin act or the login over
 * a best-effort re-check would be worse than a hold the next recompute releases.
 * Gate off → nothing was held, nothing is read.
 */
export async function settleHolds(heldIds: string[], at?: Date): Promise<number> {
  if (!heldIds.length || !identityGateEnforced()) return 0
  try {
    // A FRESH instant, not the one the hold decided with: the point is to see what changed since.
    // (`at` exists for tests that pin the clock; production callers never pass it.)
    const now = at ?? new Date()
    const rows = await db.listing.findMany({ where: { id: { in: heldIds }, identityHold: true }, select: { id: true, seller: { select: { ownerId: true } } } })
    const owners = [...new Set(rows.map((r) => r.seller.ownerId).filter((o): o is string => !!o))]
    let released = 0
    for (const ownerId of owners) {
      if (!(await sellerPublishDecision({ ownerId, now })).ok) continue
      await releaseIdentityHolds(ownerId)
      released += rows.filter((r) => r.seller.ownerId === ownerId).length
    }
    if (released) console.warn('[identity-gate] hold raced a verification — released on re-check', { released })
    return released
  } catch (e) {
    logError(e, { op: 'identityGate.settleHolds' })
    return 0
  }
}

/**
 * Claim an unowned guest storefront for an account — THE ONE WAY A STOREFRONT CHANGES HANDS.
 * Returns whether the claim won and how many live listings were parked behind the identity gate.
 *
 * Every claim path (the login auto-claim in src/lib/profile.ts, the post-time claim in
 * src/app/api/listings/resolve-seller.ts, business onboarding in
 * src/app/api/profile/account-type/route.ts) calls this, and public-state-writes.test.ts fails the
 * suite when a new file writes `ownerId` onto a Seller outside it. There were three claim paths and
 * the first wiring of the gate found only two.
 *
 * WHY THE HOLD LIVES HERE: the guest's listings are live, and attaching them to an account the gate
 * refuses would publish under that account without a verification. So, gate on and refused, every
 * live row is parked (verified=false, identityHold=true) until the owner verifies.
 *
 * ⚠️ THE CLAIM AND THE HOLD ARE ONE TRANSACTION when there is a hold to write. They were two steps,
 * with the hold after the claim and fail-quiet: a failed or skipped hold left the storefront owned —
 * so the claim-once guard never let it run again — and its listings public under an unverified
 * account for good.
 *
 * ⚠️ ONLY `verified = true AND status = 'active'` ROWS ARE PARKED. A row a moderator already pulled
 * (verified = false) must NOT gain identityHold, or verifying would republish a takedown.
 *
 * Gate off, or an owner who may publish → exactly the single claim-once `updateMany` each path made
 * before the gate existed, and no other read or write.
 */
export async function claimGuestStorefront(input: {
  /** Which unowned storefront: by id, or by the verified phone it was posted under. */
  match: { id: string } | { phone: string }
  ownerId: string
  /** Extra columns the claiming path stamps (business name, legal fields). */
  data?: Omit<Prisma.SellerUpdateManyMutationInput, 'ownerId' | 'claimedAt'>
  /** Tests pin the clock; production callers never pass it. */
  now?: Date
}): Promise<{ claimed: boolean; held: number }> {
  const where = { ...input.match, ownerId: null }
  const claimedAt = new Date()
  // ⚠️ The `data` literal is written INLINE at both writes below, not hoisted into a variable: the
  // claim tripwire in public-state-writes.test.ts reads `ownerId:` inside a seller write's arguments,
  // and a hoisted payload is invisible to it.
  const d = await sellerPublishDecision({ ownerId: input.ownerId, now: input.now })
  if (d.ok) {
    const r = await db.seller.updateMany({ where, data: { ownerId: input.ownerId, ...input.data, claimedAt } })
    return { claimed: r.count > 0, held: 0 }
  }
  const out = await db.$transaction(async (tx) => {
    const r = await tx.seller.updateMany({ where, data: { ownerId: input.ownerId, ...input.data, claimedAt } })
    if (!r.count) return { claimed: false, ids: [] as string[] }
    // Seller.ownerId is @unique, so the storefront this account now owns is the one just claimed.
    const seller = await tx.seller.findUnique({ where: { ownerId: input.ownerId }, select: { id: true } })
    if (!seller) return { claimed: true, ids: [] as string[] }
    const live = await tx.listing.findMany({ where: { sellerId: seller.id, status: 'active', verified: true }, select: { id: true } })
    const ids = live.map((l) => l.id)
    if (ids.length) await tx.listing.updateMany({ where: { id: { in: ids }, verified: true }, data: { verified: false, identityHold: true } })
    return { claimed: true, ids }
  })
  if (!out.ids.length) return { claimed: out.claimed, held: 0 }
  refreshPublicSurfaces(out.ids)
  const held = Math.max(0, out.ids.length - (await settleHolds(out.ids, input.now)))
  console.warn('[identity-gate] claim held listings', { ownerId: input.ownerId, code: d.code, held })
  return { claimed: true, held }
}
