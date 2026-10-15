// ── THE LICENCE CHECK'S APPROVAL STAMP (owner, 2026-10-14) ──────────────────────────────────────────────────────────
//
// ⛔ THE OWNER'S DECISIONS (2026-10-14): e-Visa (services/visa-legal) is open to anyone and goes live after eno's licence
// check ("Anyone posts, live after check"); Legal & permits (services/legal-permits) gets the same hold ("Check them
// too"); the seller enters the provider's registered business name and licence number (src/lib/provider-licence.ts),
// eno checks them against the copies the provider emails, and ANY change of either value or of the aisle re-holds the
// listing (Quy chế Article 5: an expired, revoked or changed licence). eno's own desk (deskSellerIds) is exempt, and so
// is every storefront on LICENCE_WHITELIST (owner, 2026-10-15: "whitelist vietkite") — exempt the same way, never hidden.
// (LICENCE_GRANDFATHER, VietKite's window until the /prohibited in-force date, is moot since the whitelist and expires.)
//
// ⛔ FOUR LEGACY COLUMNS ARE REPURPOSED, NOT ADDED (no DDL, nothing under prisma/ changes):
//   · Listing.verificationMethod — THE STAMP: LICENCE_STAMP_PREFIX + sha256(seller, aisle, name, number). It binds the
//     approval to exactly the values the admin compared: a changed value, a move to the other aisle or another seller's
//     row no longer matches, so the row stops being cleared without anyone having to remember to clear it;
//   · Listing.verifiedAt — when the approval was given;
//   · Listing.verifiedBy and Listing.verificationNotes — stay NULL. The approving admin is recorded ONLY in
//     compliance_audit ('listing.licence_approved'), hash-chained, never on the row.
// ⛔ serializeListing MUST NEVER EMIT THESE COLUMNS (src/lib/serialize.ts sends all four as constant nulls): the stamp is
// eno's private record, and a future reader must not take verifiedAt for "published at". A legacy value without the
// prefix can never clear a row.
// ⛔ THE ONE STAMP WRITER is POST /api/admin/listings 'licence-approve' (pinned by compliance/public-state-writes.test.ts);
// every other writer only clears (LICENCE_STAMP_CLEARED).
//
// Server code and tsx scripts only — node:crypto, so never import it from a 'use client' module (the wizard reads the
// pure half, provider-licence.ts). Relative imports and a type-only Prisma import, so scripts/*.ts run it under tsx.

import { createHash } from 'node:crypto'
import type { Prisma } from '../generated/prisma/client'
import { LICENCE_CHECK_SUBCATEGORIES, VISA_CATEGORY_SLUG, attributeBag, isLicenceCheckSlot } from './taxonomy'
import { checkProviderLicence, normalizeLegalName, normalizeLicenceNo, providerLicenceFromInput, providerLicenceOf, type ProviderLicence } from './provider-licence'
import { LICENCE_WHITELIST, isLicenceWhitelisted } from './licence-whitelist'

/** Every stamp starts with this — the SQL guards test for it (a legacy verificationMethod value never carries it). */
export const LICENCE_STAMP_PREFIX = 'licence:v1:'

/** The stamp for these values on this seller's listing in this aisle. Deterministic; the values are normalised first, so
 *  whitespace or NFD never makes an approved row look changed. */
export function licenceStampFor(row: { sellerId: string; subcategorySlug: string | null }, v: ProviderLicence): string {
  const parts = ['v1', row.sellerId, row.subcategorySlug ?? '', normalizeLegalName(v.legalName), normalizeLicenceNo(v.licenceNo)]
  return LICENCE_STAMP_PREFIX + createHash('sha256').update(parts.join('\u0000')).digest('hex')
}

export { LICENCE_WHITELIST, isLicenceWhitelisted }

/** The whitelisted rows as a Prisma filter — an OR of (seller, aisles); matches nothing when the list is empty. */
export function licenceWhitelistWhere(): Prisma.ListingWhereInput {
  return { OR: LICENCE_WHITELIST.map((w) => ({ sellerId: w.sellerId, subcategorySlug: { in: [...w.aisles] } })) }
}

/** What every licence decision reads off a listing. */
export type LicenceRow = {
  categorySlug: string
  subcategorySlug: string | null
  sellerId: string
  attributes: string | null
  verificationMethod: string | null
}

/**
 * May this row be public as far as the licence check goes? Outside the aisles, for eno's own desk and for a whitelisted
 * storefront, always; inside, only when its values are there and its stamp is the stamp of exactly those values.
 */
export function licenceCleared(row: LicenceRow, opts: { desk: boolean }): boolean {
  if (!isLicenceCheckSlot(row.categorySlug, row.subcategorySlug)) return true
  if (opts.desk || isLicenceWhitelisted(row.sellerId, row.subcategorySlug)) return true
  const v = providerLicenceOf(row.attributes)
  return !!v && row.verificationMethod === licenceStampFor(row, v)
}

/**
 * ⛔ THE GUARD EVERY PUBLISH OF AN EXISTING ROW ANDs INTO ITS WHERE (`AND: [licenceClearedWhere(desk)]`): admin Publish and
 * its identity park, moderate approve, the enforcement restores, releaseIdentityHolds — and every status change back to
 * active (R1, plan review 2026-10-14: relist, confirm, sync), since a verified row goes public by status alone. A
 * NECESSARY condition — SQL cannot recompute the hash, so it accepts any stamped row — and the caller pre-filters with
 * licenceBlockedIds (core/licence-check.ts) for the exact check, or, where it has just read the row itself (setStatusCore's
 * relist, confirmCore's revive), applies licenceCleared to that row. Its job is the race: an edit that clears the stamp
 * between that read and this write makes the publish match nothing. `desk` empty → the desk branch is omitted (fails
 * closed).
 */
export function licenceClearedWhere(desk: readonly string[]): Prisma.ListingWhereInput {
  return {
    OR: [
      { subcategorySlug: null },
      { subcategorySlug: { notIn: [...LICENCE_CHECK_SUBCATEGORIES] } },
      ...(desk.length ? [{ sellerId: { in: [...desk] } }] : []),
      // The whitelist (owner, 2026-10-15): exempt like the desk, by seller AND aisle.
      ...(LICENCE_WHITELIST.length ? [licenceWhitelistWhere()] : []),
      { verificationMethod: { startsWith: LICENCE_STAMP_PREFIX } },
    ],
  }
}

const SQL_ALIAS = /^(?:[A-Za-z_][A-Za-z0-9_]*\.)?$/

/**
 * licenceClearedWhere for a raw `UPDATE "Listing" … SET verified = true` (scripts/publish-held.ts,
 * scripts/release-identity-holds.ts): `alias` is the table prefix ('l.'). A CONSTANT — no parameters, and NO DESK
 * BRANCH: a script cannot resolve the desk the way the app does, so it fails closed and leaves an unstamped desk row
 * held rather than guess. The WHITELIST is inlined (its ids are UUIDs, checked at load): exempt here as everywhere.
 */
export function licenceClearedSql(alias = ''): string {
  if (!SQL_ALIAS.test(alias)) throw new Error(`licenceClearedSql: not a table alias: ${alias}`)
  const aisles = LICENCE_CHECK_SUBCATEGORIES.map((s) => `'${s}'`).join(',')
  const whitelist = LICENCE_WHITELIST.map((w) => ` OR (${alias}"sellerId" = '${w.sellerId}' AND ${alias}"subcategorySlug" IN (${w.aisles.map((a) => `'${a}'`).join(',')}))`).join('')
  return `(${alias}"subcategorySlug" IS NULL OR ${alias}"subcategorySlug" NOT IN (${aisles})${whitelist} OR ${alias}"verificationMethod" LIKE '${LICENCE_STAMP_PREFIX}%')`
}

/** What every re-hold, revoke and move out writes: no stamp, no approval time — and the two never-used columns null too. */
export const LICENCE_STAMP_CLEARED = { verificationMethod: null, verifiedAt: null, verifiedBy: null, verificationNotes: null } as const

/**
 * ⛔ THE LICENCE HOLD'S OWN MARK (commit gate, 2026-10-14) — `verificationNotes = 'licence:held'`.
 *
 * `verified: false` is overloaded: an admin Unverify, the moderation queue, the provenance and AI auto-holds and the
 * enforcement pull all write the same boolean the licence check does. 'licence-approve' publishes only a row whose
 * unpublished state the licence check ITSELF caused — a licence verdict is not a content verdict, and must never undo a
 * takedown — and this mark is how it knows. Written by every licence hold (a held create, an edit's re-hold, the sweep,
 * a revoke, the fill script, the backfill) through licenceHeldMark, which keeps it only for a row that was LIVE, PARKED
 * by the identity gate (a publish waiting on the owner's verification — the approval's publish re-parks it if need be)
 * or already marked: holding a row something else had already taken down must not launder that takedown into a pure
 * licence hold. Each of those writes decides on the row AS IT WRITES IT (a compare-and-set, or a conditional write), so
 * a takedown landing between a read and the write is never overwritten with a mark.
 * Dropped by EVERY write that publishes an existing row — the approval's own (which also requires it in its WHERE, so an
 * Unverify landing in between wins), admin Publish, moderation approve, the identity releases, the enforcement restores
 * and the operator scripts (compliance/public-state-writes.test.ts holds them to it, as it does identityHold) — so it
 * only ever sits on an UNPUBLISHED row; and by a move out of the aisles and the two takedowns that leave no other trace
 * (admin Unverify, moderation Unpublish) — the others leave a report or an owner state the approval checks itself. A row
 * the approval stamped but could not publish (a report, a held owner, a Restricted storefront) keeps it until then.
 *
 * Fails closed: a row without it is approved but stays down (`stillHeld`, "Publish (Listings tab) makes it live").
 * Never public: serializeListing nulls all four verification* columns.
 */
export const LICENCE_HELD_NOTE = 'licence:held'

/** What licenceHeldMark decides on: the row's publication and its mark, as the write that carries the mark sees them. */
export type LicenceMarkFacts = { verified: boolean; identityHold: boolean; verificationNotes: string | null }

/** The mark a licence hold writes: the hold's own only for a row that was live, identity-parked or already marked. */
export function licenceHeldMark(row: LicenceMarkFacts): { verificationNotes: string | null } {
  return { verificationNotes: row.verified || row.identityHold || row.verificationNotes === LICENCE_HELD_NOTE ? LICENCE_HELD_NOTE : null }
}

/**
 * ⛔ VIETKITE'S GRANDFATHER (owner, 2026-10-14). Its e-Visa listings were live before the check existed; they stay live
 * WITHOUT values until 00:00 ICT on `until` — the /prohibited amendment's in-force date (PROHIBITED_AMENDMENT.inForce,
 * compliance/legal-amendment.ts; licence-stamp.test.ts holds the two equal until that day passes, so re-date both
 * together). By id, not by name or partner flag: no other seller, and not Legal & permits. A VietKite row that gains
 * values is no longer grandfathered — it waits for its check like anyone's.
 * ⛔ THE ID IS CHECKED BEFORE THE SWEEP HONOURS IT (R7, plan review 2026-10-14): an id can differ after a database restore
 * (scripts/fix-vietkite-visa-claims.mjs), so `handle` and `ownerEmail` are the other two facts that script identifies
 * VietKite by, and while the window is open the sweep refuses to run unless all three name ONE storefront
 * (core/licence-check.ts licenceGrandfatherProblem) — rather than pull VietKite's live rows early, or keep another
 * storefront's rows live.
 * ⚠️ ONLY the sweep, the admin tab and tile and GET /api/admin/listings consult it. A PUBLISHER NEVER DOES: no path may
 * put a grandfathered row back live once it is down.
 */
export const LICENCE_GRANDFATHER = {
  sellerId: 'b6b7b817-6af9-4d37-a762-cf54f6ec74e6',
  handle: 'vietkite',
  ownerEmail: 'info@vietkite.com.vn',
  subcategorySlug: 'visa-legal',
  // Re-dated with the /prohibited amendment, made immediate on 2026-10-15 (owner: "apply from now"): over the day it
  // began. LICENCE_WHITELIST exempts VietKite's e-Visa rows instead.
  until: '2026-10-15',
} as const

/** The instant the grandfather ends: 00:00 in Vietnam (UTC+7) on `until`. */
export function licenceGrandfatherEndsAt(): number {
  return Date.parse(`${LICENCE_GRANDFATHER.until}T00:00:00+07:00`)
}

/** Is this one of VietKite's grandfathered rows — live, e-Visa, no values, before the end? */
/** Does the row carry either provider value at all (half-filled included)? */
function hasAnyProviderValue(attributes: string | null): boolean {
  const v = providerLicenceFromInput(attributeBag(attributes) ?? {})
  return !!(v && (v.legalName || v.licenceNo))
}

export function licenceGrandfathered(row: LicenceRow & { verified: boolean }, now: Date | number = Date.now()): boolean {
  const t = typeof now === 'number' ? now : now.getTime()
  return row.verified
    && row.sellerId === LICENCE_GRANDFATHER.sellerId
    && row.categorySlug === VISA_CATEGORY_SLUG
    && row.subcategorySlug === LICENCE_GRANDFATHER.subcategorySlug
    // NEITHER value present — a row that carries even one has entered the check and is no longer the grandfathered,
    // untouched one (commit gate, 2026-10-14: providerLicenceOf answers null for a half-filled row too).
    && !hasAnyProviderValue(row.attributes)
    && t < licenceGrandfatherEndsAt()
}

/**
 * Where a row stands with the check — what the admin tab sections by, the overview tile counts and the admin listings
 * console shows:
 *   · 'not_aisle' — outside e-Visa and Legal & permits;   · 'exempt' — eno's own desk;
 *   · 'approved' — stamped for exactly its values;        · 'grandfathered' — VietKite's window (LICENCE_GRANDFATHER);
 *   · 'pending' — both values there and acceptable, waiting for an admin;
 *   · 'missing' — absent or not acceptable (the seller fixes them in the post form; nothing to approve).
 */
export type LicenceState = 'not_aisle' | 'exempt' | 'approved' | 'grandfathered' | 'pending' | 'missing'

export function licenceStateOf(row: LicenceRow & { verified: boolean }, opts: { desk: boolean; now?: Date | number }): LicenceState {
  if (!isLicenceCheckSlot(row.categorySlug, row.subcategorySlug)) return 'not_aisle'
  if (opts.desk || isLicenceWhitelisted(row.sellerId, row.subcategorySlug)) return 'exempt'
  if (licenceCleared(row, { desk: false })) return 'approved'
  if (licenceGrandfathered(row, opts.now)) return 'grandfathered'
  const v = providerLicenceOf(row.attributes)
  return v && !checkProviderLicence(v, row.subcategorySlug) ? 'pending' : 'missing'
}
