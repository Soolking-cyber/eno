import 'server-only'
import { db } from '@/lib/db'
import { appendAudit } from '@/lib/compliance/audit'
import { deskSellerIds } from '@/lib/edition-scope'
import { NOT_REMOVED } from '@/lib/listing-removed'
import { refreshListingSurfaces } from '@/lib/listing-surfaces'
import { LICENCE_CHECK_SUBCATEGORIES, VISA_CATEGORY_SLUG } from '@/lib/taxonomy'
import { LICENCE_GRANDFATHER, LICENCE_HELD_NOTE, LICENCE_STAMP_PREFIX, licenceCleared, licenceGrandfatherEndsAt, licenceGrandfathered } from '@/lib/licence-stamp'

// ── THE LICENCE CHECK'S TWO SERVER HALVES (owner, 2026-10-14) ───────────────────────────────────────────────────────
//
// The rule (taxonomy.ts licenceCheckHold, src/lib/licence-stamp.ts): a listing in e-Visa or Legal & permits from anyone
// but eno's own desk is public only once an admin has approved the provider's values. Two things enforce it on rows that
// already exist:
//   · licenceBlockedIds — the exact pre-filter an existing-row publisher runs before its guarded write (admin Publish and
//     Activate, moderate approve, the enforcement restores, releaseIdentityHolds, a sync's revives — R1). setStatusCore's
//     relist and confirmCore's revive have already read the row, so they apply its predicate (licence-stamp.ts
//     licenceCleared) to that read instead of a second one. The write itself ANDs licenceClearedWhere, the necessary
//     condition that closes the race with an edit;
//   · sweepLicenceHolds — the daily backstop (/api/cron/licence-holds, 00:00 ICT): it unpublishes any live row that is
//     not cleared, whatever its status. It is also what ends VietKite's grandfather on the /prohibited in-force date,
//     and before that date it honours the grandfather only while its seller id still names VietKite's storefront.

/**
 * The ids, of those given, that must NOT be published yet: non-desk rows in a licence aisle whose values are missing or
 * not approved as they stand. One read; an empty set for no ids. `desk` is resolved once by a caller that needs it for
 * its own guard too, else here.
 */
export async function licenceBlockedIds(ids: string[], desk?: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (!unique.length) return new Set()
  desk ??= await deskSellerIds()
  // edition-lint-allow: a pre-filter for a WRITE over ids its caller already authorised (an admin session, the
  // enforcement engine, an identity release); nothing is rendered. The desk's own rows are exempt here by id — the
  // marketplace scope would make them invisible instead, and both editions share the one database.
  const rows = await db.listing.findMany({
    where: { id: { in: unique }, subcategorySlug: { in: [...LICENCE_CHECK_SUBCATEGORIES] } },
    select: { id: true, sellerId: true, subcategorySlug: true, attributes: true, verificationMethod: true, category: { select: { slug: true } } },
  })
  const blocked = new Set<string>()
  for (const r of rows) {
    const row = { categorySlug: r.category.slug, subcategorySlug: r.subcategorySlug, sellerId: r.sellerId, attributes: r.attributes, verificationMethod: r.verificationMethod }
    if (!licenceCleared(row, { desk: desk.includes(r.sellerId) })) blocked.add(r.id)
  }
  return blocked
}

/** The most rows one sweep run may unpublish; more is refused as a mass pull (?max= on the cron raises it, 1..500). */
export const LICENCE_SWEEP_MAX_PULL = 50

/** The error the sweep throws when the desk does not resolve — the cron answers it as `desk_unresolved`. */
export const LICENCE_SWEEP_DESK_UNRESOLVED = 'licence sweep: desk unresolved'

/**
 * ⛔ IS LICENCE_GRANDFATHER STILL VIETKITE? (R7, plan review 2026-10-14). The grandfather names VietKite by a hardcoded
 * seller id, and scripts/fix-vietkite-visa-claims.mjs records that an id can differ after a database restore. Trusted
 * blindly, a changed id would have the sweep pull VietKite's live e-Visa rows days before the owner's date, or keep
 * another storefront's rows live. So the id, the handle and the owner email — the facts that script refuses on — must
 * all name ONE storefront. The owner email compares case-insensitively; no other account's email is ever echoed.
 * Returns what does not line up, or null when the three agree.
 */
export async function licenceGrandfatherProblem(): Promise<string | null> {
  return (await grandfatherIdentity()).problem
}

/**
 * The grandfather's identity check, and every storefront its id, handle or owner names — the ones whose rows an
 * unresolved grandfather holds back (a restore can change the id while the handle and owner still point at VietKite).
 */
async function grandfatherIdentity(): Promise<{ problem: string | null; storefrontIds: string[] }> {
  const g = LICENCE_GRANDFATHER
  // edition-lint-allow: resolves the ONE storefront the cron sweep exempts, by its id, handle and owner; it returns no
  // listing and nothing is rendered — the identity check scripts/fix-vietkite-visa-claims.mjs runs before it writes.
  const found = await db.seller.findMany({
    where: { OR: [{ id: g.sellerId }, { handle: { handle: g.handle } }, { owner: { email: { equals: g.ownerEmail, mode: 'insensitive' } } }] },
    select: { id: true, handle: { select: { handle: true } }, owner: { select: { email: true } } },
  })
  const storefrontIds = found.map((s) => s.id)
  if (!found.length) return { problem: `no storefront has the seller id ${g.sellerId}, the handle "${g.handle}" or the owner ${g.ownerEmail}`, storefrontIds }
  if (found.length > 1) return { problem: `the seller id, the handle "${g.handle}" and the owner ${g.ownerEmail} name different storefronts: ${storefrontIds.join(', ')}`, storefrontIds }
  const s = found[0]
  const wrong: string[] = []
  if (s.id !== g.sellerId) wrong.push(`its id is not ${g.sellerId}`)
  if (s.handle?.handle !== g.handle) wrong.push(`its handle is not "${g.handle}"`)
  if ((s.owner?.email ?? '').toLowerCase() !== g.ownerEmail) wrong.push(`its owner is not ${g.ownerEmail}`)
  return { problem: wrong.length ? `storefront ${s.id}: ${wrong.join('; ')}` : null, storefrontIds }
}

export type LicenceSweepResult = {
  /** Live rows read in the two aisles (desk rows included). */
  checked: number
  /** Of those, eno's own desk's — exempt. */
  deskExempt: number
  /** Of those, VietKite's grandfathered rows (before LICENCE_GRANDFATHER.until). 0 when the grandfather is unresolved. */
  grandfathered: number
  /** Unpublished by this run — on a dry run, what a real run would unpublish now; 0 on a grandfather refusal (a mass-pull
   *  refusal still pulls the rows that never carried a stamp). */
  pulled: number
  pulledIds: string[]
  grandfatherUntil: string
  dryRun?: true
  /**
   * Some rows were held back, live (`wouldPull` counts them); every other unchecked row was still pulled (`pulled`):
   *   · 'grandfather_unresolved' — inside the window, LICENCE_GRANDFATHER no longer names VietKite's storefront
   *     (`grandfatherProblem` says why); no row counts as grandfathered, and the rows of every storefront its id, handle
   *     or owner names are held back;
   *   · 'mass_pull' — more than maxPull rows whose stamp no longer matches (a broken stamp recipe, not a real lapse):
   *     those stay live and are counted in `wouldPull`; rows that never had a stamp ARE pulled (`pulled`).
   */
  refused?: 'grandfather_unresolved' | 'mass_pull'
  wouldPull?: number
  grandfatherProblem?: string
}

/**
 * ⛔ THE DAILY BACKSTOP. Unpublishes every live (verified) row in e-Visa or Legal & permits that is neither eno's desk's,
 * nor cleared (licence-stamp.ts licenceCleared), nor inside VietKite's grandfather — in ANY status: a hidden or sold row
 * that is verified is one status change away from public. Every change back to active refuses an uncleared row as well
 * (R1, plan review 2026-10-14: relist, confirm, admin Activate, sync); this is the backstop behind those gates.
 *
 * Refuses rather than guesses:
 *   · an UNRESOLVED desk throws (LICENCE_SWEEP_DESK_UNRESOLVED) — with no desk ids, eno's own e-Visa rows would read as
 *     anyone's and be pulled;
 *   · an UNRESOLVED GRANDFATHER (R7) returns `refused: 'grandfather_unresolved'` — while the window is open,
 *     LICENCE_GRANDFATHER's id must still name VietKite's storefront (licenceGrandfatherProblem). The rows of every
 *     storefront its id, handle or owner names stay live (a restore that changed the ids must not pull VietKite early);
 *     every OTHER unchecked row is still pulled (commit gate: one broken identity must not suspend unrelated takedowns).
 *     After the end the grandfather exempts nothing, so nothing is checked and a vanished storefront cannot stall it;
 *   · more than `maxPull` rows whose STAMP NO LONGER MATCHES returns `refused: 'mass_pull'` and leaves THOSE live — a bad
 *     deploy that changed the stamp's recipe would otherwise unpublish every approved listing overnight. ⛔ The cap is
 *     only that suspicious case (commit gate, 2026-10-14): a row that NEVER carried an approval stamp — the grandfather
 *     ending, a legacy row — is pulled whatever the count, so a cap can never keep an unchecked listing live (both
 *     reviewers: an all-or-nothing cap left VietKite's rows public past the in-force date the moment anything else broke);
 *   · `dryRun` writes nothing and reports what it would pull — after the same refusals.
 * Each pull is its own transaction: a COMPARE-AND-SET on the values the decision was made on (the stamp, the aisle and
 * the attributes — raw-SQL writers never bump @updatedAt, so a version column would not do), then one
 * 'listing.licence_unpublished' audit row. A row an admin approved or a seller edited since the read is left alone. It
 * writes identityHold:false with verified:false, as every takedown does, so verifying cannot republish it. Emails nobody.
 */
export async function sweepLicenceHolds({ dryRun = false, now = new Date(), maxPull = LICENCE_SWEEP_MAX_PULL }: { dryRun?: boolean; now?: Date; maxPull?: number } = {}): Promise<LicenceSweepResult> {
  const desk = await deskSellerIds()
  if (!desk.length) throw new Error(LICENCE_SWEEP_DESK_UNRESOLVED)
  // Only while the window is open: after the end no row is grandfathered whoever the id names (licenceGrandfathered).
  const identity = now.getTime() < licenceGrandfatherEndsAt() ? await grandfatherIdentity() : { problem: null, storefrontIds: [] as string[] }
  const grandfatherProblem = identity.problem
  // edition-lint-allow: a cron-only WRITE pass (CRON_SECRET) over both aisles of the one shared database; nothing is
  // rendered, and the desk's rows are read in order to be EXEMPTED (deskSellerIds above), not shown.
  const rows = await db.listing.findMany({
    where: { verified: true, ...NOT_REMOVED, category: { slug: VISA_CATEGORY_SLUG }, subcategorySlug: { in: [...LICENCE_CHECK_SUBCATEGORIES] } },
    select: { id: true, sellerId: true, subcategorySlug: true, attributes: true, verificationMethod: true, verified: true, category: { select: { slug: true } } },
  })
  let deskExempt = 0
  let grandfathered = 0
  const toPull: typeof rows = []
  for (const r of rows) {
    if (desk.includes(r.sellerId)) { deskExempt++; continue }
    const row = { categorySlug: r.category.slug, subcategorySlug: r.subcategorySlug, sellerId: r.sellerId, attributes: r.attributes, verificationMethod: r.verificationMethod, verified: r.verified }
    if (licenceCleared(row, { desk: false })) continue
    // An unresolved grandfather exempts no row (R7) — the counts then show what honouring nobody would pull.
    if (!grandfatherProblem && licenceGrandfathered(row, now)) { grandfathered++; continue }
    toPull.push(r)
  }
  const counts = { checked: rows.length, deskExempt, grandfathered, grandfatherUntil: LICENCE_GRANDFATHER.until }
  // ⚠️ AN UNRESOLVED GRANDFATHER HOLDS BACK ONLY THE ROWS IT MIGHT COVER (commit gate, 2026-10-14): those under its seller
  // id and under every storefront its handle or owner names (a restore can change the id) stay live (refused, `wouldPull`
  // counts them), and every OTHER unchecked row is still pulled — one broken identity must not suspend the takedowns of
  // unrelated providers.
  const heldBack = grandfatherProblem
    ? toPull.filter((r) => r.sellerId === LICENCE_GRANDFATHER.sellerId || identity.storefrontIds.includes(r.sellerId))
    : []
  const candidates = heldBack.length ? toPull.filter((r) => !heldBack.includes(r)) : toPull
  // A row that never carried a stamp was never approved: always pulled. A STALE stamp (another seller, aisle or values
  // than an approval stamped) is capped — beyond maxPull it reads as a broken recipe, not as that many real lapses.
  const stale = candidates.filter((r) => (r.verificationMethod ?? '').startsWith(LICENCE_STAMP_PREFIX))
  const massPull = stale.length > maxPull
  const pulling = massPull ? candidates.filter((r) => !stale.includes(r)) : candidates
  // The grandfather's refusal outranks the cap's in the report (it is the one to fix first); each counts what it held back.
  const refusal = grandfatherProblem
    ? { refused: 'grandfather_unresolved' as const, grandfatherProblem, wouldPull: heldBack.length + (massPull ? stale.length : 0) }
    : massPull ? { refused: 'mass_pull' as const, wouldPull: stale.length } : {}
  if (dryRun) return { ...counts, ...refusal, dryRun: true, pulled: pulling.length, pulledIds: pulling.map((r) => r.id) }

  const pulledIds: string[] = []
  try {
    for (const r of pulling) {
      // The compare-and-set: exactly the row the decision above was made on, still live and not a tombstone.
      const unchanged = { id: r.id, verified: true, ...NOT_REMOVED, verificationMethod: r.verificationMethod, subcategorySlug: r.subcategorySlug, attributes: r.attributes }
      const pulled = await db.$transaction(async (tx) => {
        // Marked as the licence check's own hold (licence-stamp.ts LICENCE_HELD_NOTE): the row was live, so approving its
        // values puts it back.
        const { count } = await tx.listing.updateMany({ where: unchanged, data: { verified: false, identityHold: false, verificationNotes: LICENCE_HELD_NOTE } })
        if (count !== 1) return false
        await appendAudit(tx, {
          actorType: 'system',
          action: 'listing.licence_unpublished',
          subjectType: 'listing',
          subjectId: r.id,
          detail: { subcategory: r.subcategorySlug, reason: 'no_checked_licence' },
          legalBasis: 'ecommerceLaw',
        })
        return true
      })
      if (pulled) pulledIds.push(r.id)
    }
  } finally {
    // Whatever was pulled before a failure still leaves the page cache, the home rails and AI search — and a clean night
    // that pulled nothing purges nothing (commit gate).
    if (pulledIds.length) refreshListingSurfaces(pulledIds, 'licence.sweep', { home: true })
  }
  return { ...counts, ...refusal, pulled: pulledIds.length, pulledIds }
}
