/**
 * ── ENO-RUN PARTNER STOREFRONTS (owner, 2026-11-14) ──────────────────────────────────────────────────────────────────
 *
 * "Partners now, admins sell", refined the same night: "same as other partners users just text our admins to buy we buy and
 * send seperately no links that lead to another website" + "only admins should see the link to purchase devices for users"
 * + "and send in chat if needed".
 *
 * CellphoneS and Điện Thoại Vui are AccessTrade storefronts (their catalogue, prices and stock come from AccessTrade's
 * datafeed) that eno RUNS: an eno-held login owns each one (scripts/claim-partner-storefront.mjs), customers chat with it,
 * and eno's admins buy from the shop and deliver. Their purchase links live in the staff-only "PartnerPurchaseLink" table,
 * never in the public `Listing.affiliateUrl` column (src/lib/partner-purchase-link.ts).
 *
 * ⛔ A STOREFRONT IS ENO-RUN ONLY AS A PINNED (sellerId, ownerProfileId) PAIR, AND ONLY WITH officialPartner (plan review,
 * codex + opus 2026-11-14): CellphoneS was already officialPartner while ownerless, so a seller-id list alone would have
 * handed every power below to whoever claimed it first. The pair names the eno-held login the claim script created; if the
 * storefront is ever owned by anyone else the pair simply stops matching, and every path treats it as a person's shop again.
 *
 * What the pair unlocks, and nothing else does:
 *   · the AccessTrade datafeed paths (nightly reprice/restock, the importer, the ad-ban and AccessTrade sweeps, the undo
 *     journals, the lowest-price tables) treat the shop as eno's, exactly as they treat an ownerless one;
 *   · its purchase links stay in PartnerPurchaseLink (the nightly job and the importer write them there);
 *   · the staff-only purchase-link endpoint answers its owner login;
 *   · the Partner inbox counts its unread chats; the partner strip shows it.
 *
 * ⚠️ EMPTY UNTIL THE CLAIM. Each pair is pasted from the claim script's output and shipped by a deploy; until then every
 * function here answers false / FALSE / [] and the code that calls it behaves exactly as before.
 */

export type EnoRunPartner = { sellerId: string; ownerProfileId: string; name: string }

export const ENO_RUN_PARTNERS: readonly EnoRunPartner[] = []

const SELLER_ID = /^[a-z0-9]{20,40}$/
const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** The pairs are interpolated into SQL (enoRunPartnerSql): each one is checked for shape before it is ever used. */
function checked(list: readonly EnoRunPartner[]): readonly EnoRunPartner[] {
  for (const p of list) {
    if (!SELLER_ID.test(p.sellerId) || !PROFILE_ID.test(p.ownerProfileId)) throw new Error(`eno-run partner pair malformed: ${JSON.stringify(p)}`)
  }
  return list
}

/** The seller ids alone — for the claim refusal and the strip/inbox rosters; never a power on their own. */
export function enoRunPartnerSellerIds(list: readonly EnoRunPartner[] = ENO_RUN_PARTNERS): string[] {
  return checked(list).map((p) => p.sellerId)
}

/** Is this storefront one eno runs: a pinned (id, owner) pair, flagged officialPartner? */
export function isEnoRunPartner(
  seller: { id?: string | null; ownerId?: string | null; officialPartner?: boolean | null } | null | undefined,
  list: readonly EnoRunPartner[] = ENO_RUN_PARTNERS,
): boolean {
  if (!seller?.id || !seller.ownerId || seller.officialPartner !== true) return false
  return checked(list).some((p) => p.sellerId === seller.id && p.ownerProfileId === seller.ownerId)
}

const SQL_ALIAS = /^(?:[A-Za-z_][A-Za-z0-9_]*\.)?$/

/**
 * The SQL twin, on a "Seller" alias (`s.` → `s.id`, `s."ownerId"`, `s."officialPartner"`). With no pairs it is the literal
 * FALSE, so `ownerless OR <this>` is exactly the ownerless rule it widens.
 */
export function enoRunPartnerSql(alias: string, list: readonly EnoRunPartner[] = ENO_RUN_PARTNERS): string {
  if (!SQL_ALIAS.test(alias)) throw new Error(`enoRunPartnerSql: not a table alias: ${alias}`)
  const pairs = checked(list)
  if (!pairs.length) return 'FALSE'
  const tuples = pairs.map((p) => `('${p.sellerId}', '${p.ownerProfileId}'::uuid)`).join(', ')
  return `((${alias}id, ${alias}"ownerId") IN (${tuples}) AND ${alias}"officialPartner")`
}

/** The Prisma twin: OR arms for a Seller `where`, to sit beside `{ ownerId: null }`. */
export function enoRunPartnerWhere(list: readonly EnoRunPartner[] = ENO_RUN_PARTNERS): { id: string; ownerId: string; officialPartner: true }[] {
  return checked(list).map((p) => ({ id: p.sellerId, ownerId: p.ownerProfileId, officialPartner: true as const }))
}
