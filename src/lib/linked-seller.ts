import { isImportSeller } from './import-sellers'

/**
 * WHICH STOREFRONTS SHOW NO TRUST SCORE, AND WHICH ONES ARE "LINKED SHOPS" (owner decisions, 2026-10-01).
 *
 * ⚠️ PURE AND CLIENT-SAFE. Cards (client components), the PDP and the storefront all read it, so it
 * imports nothing but the pure id list in import-sellers.ts.
 *
 * ── UNRATED ──────────────────────────────────────────────────────────────────────────────────────
 * `Seller.trustScore` is a MIRROR of the owner Profile's trust (schema.prisma, the note on the column:
 * "recomputed whenever the owner's score changes"). A storefront with no owner (`ownerId` null) has no
 * Profile behind it, so its number was never computed from anybody's behaviour — it is the schema
 * default (100) that every importer-created storefront starts at, kept for RANKING fairness. Shown as
 * a chip it read as the /trust "Trusted" tier for a source eno.vn never rated.
 * So: an ownerless storefront that is not an official partner shows NO trust number or chip anywhere
 * (cards, map popups, the PDP shop row, the storefront header). The number itself is untouched —
 * rankScore still reads it — so ranking does not move.
 * ⚠️ THIS ALSO COVERS A LEGACY GUEST STOREFRONT (a signed-out post, api/listings/resolve-seller.ts),
 * which is ownerless for the same reason and whose 100 is equally unearned. It is NOT a linked shop
 * (below) — it carries no imported or affiliate catalogue — so it shows nothing in the chip's place.
 * ⚠️ An official partner is excluded because it already shows the partner badge INSTEAD of a trust
 * chip (the 2026-08-13 swap), and since 2026-10-01 that badge is kept only for the companies the owner
 * named; scripts/set-official-partner.mjs is the per-seller switch.
 *
 * ── LINKED SHOP ──────────────────────────────────────────────────────────────────────────────────
 * An unrated storefront that carries imported or affiliate listings (each one links out to the source
 * site, where the reader contacts or buys). It shows a neutral "Linked shop" chip where the partner
 * badge used to be (the storefront header, the PDP shop row). Who decides "carries": the caller, from
 * the listing(s) it already holds — an `affiliateUrl` on the row, or a storefront in IMPORT_SELLERS.
 */
/**
 * ── THE PARTNER FLAG AS A PAGE SHOWS IT ───────────────────────────────────────────────────────────
 * The stored `Seller.officialPartner`, EXCEPT where the listing (or, on a storefront, its catalogue)
 * links out: that never shows the official-partner badge. Every projection and storefront header reads
 * the flag through this, and isUnratedStorefront / isLinkedShop are then asked of the result.
 *
 * ⛔ WHY IT EXISTS (2026-10-01). The badge's tooltip now states "a company with a signed agreement with
 * eno" (partner-badge.tsx). The flag was still stored TRUE on every import/affiliate storefront (Tiki,
 * CellphoneS, FPT Shop, the eSIM carriers, VinWonders) until each one is revoked by hand
 * (scripts/set-official-partner.mjs --off), and the pages that show it are CACHED: a PDP is ISR for
 * 30 days (listings/[id]/(pdp)/page.tsx `revalidate`), keyed by build (cache-handler.cjs), and a revoke
 * does not refresh it (set-official-partner.mjs says so). A PDP rendered by this code before the revoke
 * would have put a signed-agreement claim about Tiki on the page for a month. This makes the claim
 * depend on something the page itself knows, not on an operator running a script in time.
 * ⚠️ WHY "LINKS OUT" IS THE TEST. A signed partner is reached by CHAT: it shares no phone (the contact
 * route answers 403 partner_chat_only), and a listing that links out has nobody to chat to (the
 * conversations route answers 409 reference_listing). So a flagged storefront whose listing links out is a
 * stale grant by construction, never a signed partner's own row. The failure mode is the safe one: a
 * signed partner that one day lists with an outbound link loses the badge on THAT listing (it reads
 * as the linked, unrated row it is), never the other way round.
 */
export function partnerShown(officialPartner: boolean | null | undefined, linksOut: boolean): boolean {
  return officialPartner === true && !linksOut
}

export function isUnratedStorefront(s: { ownerId: string | null; officialPartner: boolean }): boolean {
  return s.ownerId == null && !s.officialPartner
}

/** An unrated storefront whose listings link out — see LINKED SHOP above. */
export function isLinkedShop(s: { id: string; ownerId: string | null; officialPartner: boolean }, carriesLinkedListings: boolean): boolean {
  return isUnratedStorefront(s) && (carriesLinkedListings || isImportSeller(s.id))
}

/**
 * Does a CARD (grid, compact row, map popup) withhold the seller's trust chip? One rule for every card
 * surface, so the four call sites cannot drift:
 *   · `seller.unrated` — the projection's isUnratedStorefront (serialize.ts);
 *   · an IMPORT_SELLERS storefront — the older rule, kept for a card built from a payload that predates
 *     `unrated` (a recently-viewed card stored on the device, say), so it fails toward no chip;
 *   · a linked JOB — the job board is not the employer, whoever owns the board's row.
 * ⚠️ The partner check comes FIRST at every call site (partner replaces trust), so this is only asked
 * of a non-partner.
 */
export function cardHidesTrust(card: { sellerId: string; isPartnerBooking?: boolean; listingType?: string; seller: { unrated?: boolean } }): boolean {
  return card.seller.unrated === true || isImportSeller(card.sellerId) || (!!card.isPartnerBooking && card.listingType === 'job')
}
