import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { partitionByIdentityGate, settleHolds } from '@/lib/compliance/seller-publish-gate'
import { licenceBlockedIds } from '@/lib/core/licence-check'
import { licenceClearedWhere } from '@/lib/licence-stamp'
import { NOT_REMOVED } from '@/lib/listing-removed'
import { NOT_A_REVIEW_SEATS_LISTING } from '@/lib/review-seat-accounts'
import { NOT_PHOTO_HELD, PHOTO_HELD_NOTE } from '@/lib/listing-photo-hold'
import { photoHeldIds, photoPassSoon } from '@/lib/listing-photo-hooks'

/** Report states that keep a licence approval or a photo release from publishing (R4): a case open, or upheld. */
export const OPEN_CASE = ['open', 'confirmed']
/** Owner enforcement states under which an approval or a release publishes nothing — the hold pulled the account's listings. */
export const OWNER_PULLED = ['held', 'suspended']

/**
 * ⚖️ PUBLISH — the admin console's "verify", the publish half of 'licence-approve' (owner, 2026-10-14) and the photo
 * check's self-release (owner, 2026-11-15). Moved here from api/admin/listings (a route file cannot export it):
 *   · ⛔ UNCLEARED LICENCE-AISLE ROWS ARE LEFT OUT FIRST (licenceBlockedIds) and counted as `licenceCheck`: they go live
 *     only through Catalogue › Licence checks. Not parked either — an identity hold on one would be a publish the moment
 *     its seller verifies (releaseIdentityHolds), the licence aside;
 *   · ⛔ SO ARE PHOTO-HELD ROWS (listing-photo-hold.ts), counted as `photoCheck` — unless `photoRelease`, the release's
 *     own call, which publishes ONLY a row still carrying the mark;
 *   · both writes AND licenceClearedWhere(desk) and the photo guard against an edit landing between the pre-filter and the
 *     write — spelled in the call, where public-state-writes.test.ts looks for them;
 *   · `onlyIf` is ANDed into both writes as well — 'licence-approve' and the release pass "no open or confirmed report,
 *     owner not held or suspended, not Restricted" (R4), so a report filed, a hold applied or an Unverify landing after
 *     their read cannot be published over. "verify" passes nothing: Publish has always been the admin's own call;
 *   · the publish write drops the licence and photo marks, as every publish of an existing row does: a public row is
 *     nobody's hold. The park keeps a licence mark, and drops the photo mark (A11): the identity gate owns that row now.
 * After a publish that was not a release, the photo pass looks at what went live (photoPassSoon).
 */
export async function publishListings(
  ids: string[], desk: string[], o: { onlyIf?: Prisma.ListingWhereInput; photoRelease?: true } = {},
): Promise<{ affected: number; held: number; alreadyHeld: number; licenceCheck: number; photoCheck: number }> {
  const blocked = await licenceBlockedIds(ids, desk)
  const photoHeld = o.photoRelease ? new Set<string>() : await photoHeldIds(ids)
  const eligible = blocked.size || photoHeld.size ? ids.filter((id) => !blocked.has(id) && !photoHeld.has(id)) : ids
  // ⚖️ For an owner the identity gate refuses, the admin's approval is recorded as a HOLD (identityHold) and becomes a
  // publish the moment they verify. Never a silent no-op. A gated row that is ALREADY verified is left exactly as it is
  // (counted, not rewritten): the gate governs entering public state, and re-verifying must not turn into a takedown.
  const { allowed, held: gated } = await partitionByIdentityGate(eligible)
  // `identityHold: false` rides the publish: a row parked earlier (the gate was on and has since
  // been switched off, or the owner verified and the release missed it) must not go live still
  // carrying a hold. Only the response is pinned byte-identical with the gate off — this column
  // is already false on every row the gate never touched.
  // ⛔ …and never a review seat's row (src/lib/review-seat-accounts.ts): the POST refuses one before this is reached, and
  // both writes AND the owner test as well, so nothing between that read and these writes can publish or park one.
  const publish = async (c: Pick<typeof db, 'listing'>) => (await c.listing.updateMany({ where: { id: { in: allowed }, ...NOT_REMOVED, AND: [licenceClearedWhere(desk), NOT_A_REVIEW_SEATS_LISTING, o.photoRelease ? { verificationNotes: PHOTO_HELD_NOTE } : NOT_PHOTO_HELD, ...(o.onlyIf ? [o.onlyIf] : [])] }, data: { verified: true, identityHold: false, verificationNotes: null } })).count
  // ⛔ The automatic release takes its owners' Profile rows FOR SHARE first: an enforcement hold (FOR UPDATE, enforcement.ts)
  // committing now is waited for and read by the publish, never published over.
  let affected = !allowed.length ? 0 : o.photoRelease ? await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Profile" p JOIN "Seller" s ON s."ownerId" = p.id JOIN "Listing" l ON l."sellerId" = s.id WHERE l.id = ANY(${allowed}::text[]) FOR SHARE OF p`
    return publish(tx)
  }) : await publish(db)
  let held = 0
  let alreadyHeld = 0
  if (gated.length) {
    // Read BEFORE the park and the re-check: afterwards a parked row and a pre-existing hold look
    // the same, and a pre-existing hold the re-check released would look "already verified".
    // edition-lint-allow: counts the publication state of ids the caller chose for a WRITE; nothing is rendered.
    const before = await db.listing.findMany({ where: { id: { in: gated }, ...NOT_REMOVED }, select: { verified: true, identityHold: true } })
    alreadyHeld = before.filter((r) => !r.verified && r.identityHold).length
    // `identityHold: false` in the WHERE: an already-parked row is not parked again, so it can
    // never be counted as held by this request.
    const parked = (await db.listing.updateManyAndReturn({ where: { id: { in: gated }, verified: false, identityHold: false, ...NOT_REMOVED, AND: [licenceClearedWhere(desk), NOT_A_REVIEW_SEATS_LISTING, o.photoRelease ? { verificationNotes: PHOTO_HELD_NOTE } : NOT_PHOTO_HELD, ...(o.onlyIf ? [o.onlyIf] : [])] }, data: o.photoRelease ? { identityHold: true, verificationNotes: null } : { identityHold: true }, select: { id: true } })).map((r) => r.id)
    const released = parked.length ? await settleHolds(parked) : 0
    held = parked.length - released
    // Already verified (left as asked, as the allowed path counts it) + parked-then-released here.
    affected += before.filter((r) => r.verified).length + released
  }
  if (!o.photoRelease) photoPassSoon(eligible)
  return { affected, held, alreadyHeld, licenceCheck: blocked.size, photoCheck: photoHeld.size }
}
