import 'server-only'
import { PARTNER_STORES } from './partner-stores'
import { RENTAL_IMPORT_SELLERS } from './import-sellers'
import type { ProvenanceKind } from './import-provenance-copy'

/**
 * WHICH IMPORTED LISTINGS SAY WHERE THEY CAME FROM, AND WITH WHICH DATE (SEO wave B, P1).
 *
 * An imported listing is a REFERENCE to an ad on another site: eno.vn copied it, links to it, and
 * never vetted it. The provenance line under the CTA says so in one sentence — the site's name, the
 * date that is actually true for that source, and a link to the original — so neither a reader nor a
 * search engine takes the page for an eno seller's own post.
 *
 * ⛔ SERVER ONLY. It imports PARTNER_STORES, a ~600-line table of crawl notes that must never ride
 * into a client bundle; the component gets three small props from the page instead.
 *
 * ⚠️ JOBS NEVER GET THE LINE (decision P-b): a linked job keeps its own "Posted" date and apply-by
 * line. Nor does any other affiliate row (a park ticket, an eSIM, a vehicle-hire reference) — only the
 * two families below, whose wording the owner approved (CS-2, 2026-09-30).
 *
 * ⚠️ NO MACHINE-TRANSLATION CLAUSE, AND NO ALLOWLIST FOR ONE YET (decision P-f). "Text translated
 * automatically" on a retail item is a claim about how its text was made, and the query that would
 * list the hosts where it is true has not been run. The clause (CS-2 P1-7) ships with that allowlist,
 * here, and not before: fail closed.
 */

type RentalImportSellerId = (typeof RENTAL_IMPORT_SELLERS)[number]

/**
 * The rental sources whose stored `postedAt` IS the source's own post date — so the line may say
 * "posted there on". A subset of RENTAL_IMPORT_SELLERS (and so of IMPORT_SELLERS) by type.
 *   - Chợ Tốt Nhà: `list_time`, clamped to now, written on create only (nhatot-listing.ts).
 *   - Muaban.net: the ad's date, clamped to now, written on create only (muaban-net-map.ts).
 * ⛔ NOT Honeycomb: its `postedAt` is the sitemap's lastmod, a page-modified date (decision P-g leaves
 * it out). Not Batdongsan or Rever: they never set `postedAt`, so it defaults to the import moment.
 * Those three say "imported to eno on" with `createdAt`, which no importer writes.
 */
export const SOURCE_DATE_SELLERS = [
  'nhatot-import-seller-0001',
  'muaban-net-import-seller-0001',
] as const satisfies readonly RentalImportSellerId[]

export type ImportProvenance = {
  kind: ProvenanceKind
  /** The storefront's name as the page already prints it on the CTA ("Rent on Nhatot.com"). */
  site: string
  /** The instant to print as a Vietnam calendar day; null for a retail item. */
  iso: string | null
}

const hostOf = (url: string): string | null => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return null }
}

/**
 * The line for this listing, or null for every listing that gets none.
 *
 * `affiliateUrl` must be the CHECKED link (safeAffiliateUrl), the one the CTA and this line's own
 * link point at: a row whose link fails the check has no CTA, and a line naming a source nobody can
 * open would be the only trace of it.
 * ⚠️ `postedAt` and `createdAt` are the RAW columns. The serialized listing's `postedAt` is
 * `listedAt()` — the LATER of the two (stale.ts) — which for a Chợ Tốt ad is the import day, not the
 * source's date this line promises.
 */
export function importProvenance(l: {
  sellerId: string
  sellerName: string
  affiliateUrl: string | null
  listingType: string
  postedAt: Date
  createdAt: Date
}): ImportProvenance | null {
  if (!l.affiliateUrl || l.listingType === 'job') return null

  // ⚠️ EACH FAMILY IS ALSO KEYED ON ITS listingType. Production holds only `rent` rows under the rental
  // importers and only `sell` rows under the shops (2026-09-30: 29,686 and 16,658), but a row outside
  // that shape would otherwise be worded as the wrong kind of ad and lose its "Posted" date with it.
  if (l.listingType === 'rent' && (RENTAL_IMPORT_SELLERS as readonly string[]).includes(l.sellerId)) {
    const sourceDate = (SOURCE_DATE_SELLERS as readonly string[]).includes(l.sellerId)
    const at = sourceDate ? l.postedAt : l.createdAt
    if (!Number.isFinite(at.getTime())) return null
    return { kind: sourceDate ? 'source-date' : 'import-date', site: l.sellerName, iso: at.toISOString() }
  }

  // A retail item: the link goes to a PARTNER_STORES shop's own domain (import-partners.ts refuses
  // any other), AND the row is filed under that shop's storefront. Both, because a storefront name is
  // not unique — the host is the fact, the name only has to agree with it.
  if (l.listingType !== 'sell') return null
  const host = hostOf(l.affiliateUrl)
  const store = host ? PARTNER_STORES.find((s) => s.domain.toLowerCase().replace(/^www\./, '') === host) : undefined
  // NFC on both sides: a Vietnamese shop name can be stored decomposed and still read the same.
  if (store && store.name.normalize('NFC') === l.sellerName.normalize('NFC')) return { kind: 'retail', site: l.sellerName, iso: null }

  return null
}
