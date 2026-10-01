/**
 * "SELLER INFORMATION" — WHAT THE PDP AND THE STOREFRONT MAY SAY ABOUT WHO IS SELLING, AND WHEN.
 *
 * ⚠️ PURE AND CLIENT-SAFE: the server pages build the props here, and the two identity editors
 * (business-profile-editor.tsx, account-type-switcher.tsx) read the switch below to word their notice.
 *
 * Two shapes (rendered by src/components/marketplace/seller-info.tsx):
 *   · `source`   — a LINKED storefront (src/lib/linked-seller.ts): it names the source site. Nobody's
 *                  personal data, so it is not behind the switch below.
 *   · `business` — a business account's legal name, address and tax code. BEHIND THE SWITCH BELOW.
 *
 * ⛔ WHY THE BUSINESS SHAPE IS SWITCHED OFF (review, 2026-10-01).
 * Every legal identity already stored was typed under a notice that promised the opposite: the business
 * editor said "Kept private … Never shown on your storefront", the account-type switch said "never shown
 * publicly". Printing those rows on deploy would publish data collected under a privacy promise — and
 * `Seller.legalAddress` is a person's HOME for an individual (schema.prisma: "residence (individual)").
 * The PDP is ISR for 30 days and crawled; a publication cannot be taken back.
 * So the rows render only for an identity SAVED UNDER THE NEW NOTICE: `Seller.identityUpdatedAt` (stamped
 * by every identity save — src/lib/core/seller.ts and /api/profile/account-type) on or after
 * SELLER_INFO_NOTICE_SINCE. The editors show the old "never shown" notice while this is null (true: nothing
 * is shown) and the new "shown under Seller information" notice once it is set — one switch for both, so
 * the notice a seller read always matches what happens to what they typed under it.
 *
 * TO TURN IT ON (owner + counsel, in this order):
 *   1. Counsel signs off the display (Decree 248 Art 18.1.c; PDPL consent/notice for an individual's name).
 *   2. /privacy lists "Seller information" among what is published (W-B's "what is published" paragraph).
 *   3. Set SELLER_INFO_NOTICE_SINCE to an ISO instant AT OR AFTER the moment the deploy carrying it is live
 *      (e.g. the next midnight, Asia/Ho_Chi_Minh). Earlier is UNSAFE: a save made before the deploy, under
 *      the old promise, would be published. Later only delays it (the safe direction).
 *   4. Re-notify existing business sellers that their details are shown once they re-save them.
 * Identities saved before that instant stay private for good, as they were promised, until re-saved.
 */
export const SELLER_INFO_NOTICE_SINCE: string | null = null

export type SellerInfoProps =
  | {
      kind: 'business'
      /**
       * `person` when the stored ID number is not a business registration number (a 12-digit CCCD, a
       * 9-digit CMND, or none). A person's address is their home and their tax code a personal identifier,
       * so a `person` carries neither — only the name (see sellerIdentityHolder).
       */
      holder: 'company' | 'person'
      legalName: string | null
      legalAddress: string | null
      taxCode: string | null
    }
  | {
      kind: 'source'
      source: string
      /** What the reader does on the source site — the caption's verb (sourceActionFor). */
      action: SourceAction
    }

/**
 * THE VERB UNDER A LINKED SHOP'S "Source" ROW (2026-10-01). The caption said "you contact or buy on the
 * source website" on every linked PDP — including a JOB (nobody buys a job; you apply on the board's
 * posting — page.tsx `isJob`) and a RENTAL (Batdongsan/Rever homes: you contact the agent; Mioto/BonbonCar
 * cars and the bike shops: you book — vehicle-rental-listing.ts writes `listingType: 'rent'` for all of them).
 *   · `apply` — every linked row is `listingType: 'job'`;
 *   · `rent`  — every linked row is `listingType: 'rent'` (homes and vehicle hire alike);
 *   · `buy`   — every linked row is anything else (sell, service, event … — shops, eSIMs, tickets);
 *   · `any`   — a mix, or nothing to read (an IMPORT_SELLERS storefront with no live rows): no verb is
 *               claimed.
 */
export type SourceAction = 'buy' | 'rent' | 'apply' | 'any'

export function sourceActionFor(listingTypes: readonly (string | null | undefined)[]): SourceAction {
  const kinds = new Set(listingTypes.map((t): SourceAction => (t === 'job' ? 'apply' : t === 'rent' ? 'rent' : 'buy')))
  return kinds.size === 1 ? [...kinds][0] : 'any'
}

/**
 * A business registration (an ERC / enterprise code is the 10-digit MST, 13 digits with a branch suffix —
 * the formats src/lib/core/seller.ts accepts for `taxCode`) versus a person (CCCD 12 / CMND 9, or nothing
 * entered). ⚠️ UNKNOWN COUNTS AS A PERSON: it is the reading that publishes less.
 */
export function sellerIdentityHolder(idNumber: string | null | undefined): 'company' | 'person' {
  const digits = (idNumber ?? '').replace(/\D/g, '')
  return digits.length === 10 || digits.length === 13 ? 'company' : 'person'
}

/** Was this identity saved under the notice that says it is shown? False while the switch is off. */
export function sellerIdentityPublishable(identityUpdatedAt: Date | string | null | undefined, since: string | null = SELLER_INFO_NOTICE_SINCE): boolean {
  if (!since || !identityUpdatedAt) return false
  const at = new Date(identityUpdatedAt).getTime()
  const from = Date.parse(since)
  return Number.isFinite(at) && Number.isFinite(from) && at >= from
}

export type SellerIdentityRow = {
  legalName: string | null
  legalAddress: string | null
  taxCode: string | null
  /** Read ONLY to tell a company from a person — it never reaches the props. */
  idNumber: string | null
  identityUpdatedAt: Date | string | null
}

/**
 * The one builder for both pages (PDP, storefront), so the two cannot drift. Null = render nothing.
 * ⚠️ Called with the RAW row on the server: the serialized seller carries none of these columns.
 */
export function buildSellerInfo(
  s: {
    linkedShop: boolean
    isBusiness: boolean
    storefrontName: string
    identity: SellerIdentityRow
    /** `listingType` of the linked row(s) the page holds — the PDP's one row, the storefront's loaded rows. */
    linkedListingTypes: readonly (string | null | undefined)[]
  },
  since: string | null = SELLER_INFO_NOTICE_SINCE,
): SellerInfoProps | null {
  if (s.linkedShop) return { kind: 'source', source: s.storefrontName, action: sourceActionFor(s.linkedListingTypes) }
  if (!s.isBusiness || !sellerIdentityPublishable(s.identity.identityUpdatedAt, since)) return null
  const holder = sellerIdentityHolder(s.identity.idNumber)
  return {
    kind: 'business',
    holder,
    legalName: s.identity.legalName,
    legalAddress: holder === 'company' ? s.identity.legalAddress : null,
    taxCode: holder === 'company' ? s.identity.taxCode : null,
  }
}
