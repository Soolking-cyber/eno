import type { Prisma } from '@/generated/prisma/client'

/**
 * ⛔ THE PHOTO HOLD'S OWN MARK (owner, 2026-11-15: a listing whose every photo is a flyer or shows contact details is
 * hidden until a real photo is added) — `verificationNotes = 'photo:held'`, the LICENCE_HELD_NOTE pattern
 * (licence-stamp.ts). The pass (listing-photo-pass.ts) writes it with `verified: false` only on a row that was live or
 * identity-parked, and the self-release publishes ONLY a row still carrying it, so a photo release never undoes a
 * takedown:
 *  · every OTHER existing-row publish or park ANDs NOT_PHOTO_HELD (raw SQL: notPhotoHeldSql) — a held row goes back only
 *    through its own release (tripwire: compliance/public-state-writes.test.ts, `publishesWithoutPhotoGuard`);
 *  · every independent takedown clears the mark in the same write or transaction (plan amendment A10): the provenance
 *    and AI-moderation holds, admin Hide, Unverify, moderation Unpublish, a licence hold (licenceHeldMark answers null for
 *    it). An enforcement pull never touches a held row (it is not live); the release refuses while the owner is held or
 *    suspended instead (publish-listings.ts OWNER_PULLED);
 *  · a release the identity gate parks drops it in the park write (A11), so releaseIdentityHolds owns the row from then.
 * Never public: serializeListing nulls every verification* column. Relative/type-only imports: scripts/*.ts run it.
 */
export const PHOTO_HELD_NOTE = 'photo:held'

/** NULL-safe: a bare `{ not: PHOTO_HELD_NOTE }` is NULL — so false — for the many rows with no note at all. */
export const NOT_PHOTO_HELD = {
  OR: [{ verificationNotes: null }, { verificationNotes: { not: PHOTO_HELD_NOTE } }],
} satisfies Prisma.ListingWhereInput

/** A removal's record (audit `listing.photo.stripped`): the photos as they were, and the ones taken out. */
export type StrippedPhotos = { before: string[]; removed: Array<{ i: number; url: string; key: string; rule: 'flyer' | 'contact' }> }

/** The audit detail as a StrippedPhotos, or null when it is not one. */
export function strippedPhotosOf(detail: unknown): StrippedPhotos | null {
  const d = detail as Partial<StrippedPhotos> | null
  if (!d || !Array.isArray(d.before) || !Array.isArray(d.removed)) return null
  const removed = d.removed.filter((r) => r && typeof r.url === 'string' && typeof r.key === 'string' && Number.isInteger(r.i))
  return { before: d.before.filter((u): u is string => typeof u === 'string'), removed }
}

/** NOT_PHOTO_HELD for a raw `UPDATE "Listing"`; `alias` is the table prefix with its dot ('l.'), or none. */
export function notPhotoHeldSql(alias = ''): string {
  if (alias !== '' && !/^[a-z]\w*\.$/.test(alias)) throw new Error(`notPhotoHeldSql: bad alias ${JSON.stringify(alias)}`)
  return `${alias}"verificationNotes" IS DISTINCT FROM '${PHOTO_HELD_NOTE}'`
}
