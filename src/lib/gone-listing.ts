import type { Metadata } from 'next'
import { SITE_NAME } from './edition'
import { fold } from './fold'
import { screenImportRow } from './import-screen'
import { isLinkedShop, partnerShown } from './linked-seller'
import { isJournaledGone } from './gone-listing-ids'

/**
 * THE "GONE" PAGE — WHAT A LISTING URL SHOWS WHEN AN IMPORT SHOP'S ROW HAS LEFT eno (UX program 2, B8).
 *
 * On 2026-10-03 the owner hid ~68,250 new-goods rows from eight retail import shops (the second-hand
 * focus), and on 2026-10-05 31 "[New 100%]" laptops. Google Shopping and organic results still link
 * those PDPs ('oppo a6c giá bao nhiêu' → position 1) while 'oppo a6c' has live second-hand matches, and
 * a 404 drops that buyer on the floor. So those URLs answer 200 + noindex,follow (the sold page's
 * standard) with a page that names the item and offers live, used alternatives
 * (src/components/marketplace/gone-listing.tsx).
 *
 * ⛔ WHO GETS IT — ALL OF THESE, and nothing else (a plain 404 that reveals nothing stays the answer):
 *   · ⛔ JOURNALED by the owner's second-hand cleanup (gone-listing-ids.ts) — the reason a row was hidden is
 *     recorded nowhere else, so nothing outside those journals gets the page.
 *   · `verified` and status `'hidden'`. Every other non-live status — held, stale, expired, removed, a
 *     draft, anything new — is a 404, and active/sold keep their own pages (get-listing.ts).
 *   · goods (`listingType 'sell'`): the page offers second-hand goods, which is no alternative to a
 *     flat or a job. Hidden import rentals and jobs stay a 404 (5,189 + 83 rows on 2026-10-05).
 *   · an OWNERLESS IMPORT SHOP, asked exactly as the PDP asks it: `isLinkedShop` over the partner flag
 *     as the page shows it (`partnerShown` — src/lib/linked-seller.ts, used read-only). A person's own
 *     post hidden by moderation has an owner and stays a 404; so does a legacy guest storefront
 *     (ownerless, but no link out and not an import seller).
 *   · `complianceStatus 'clear'`: a row under an authority order is never shown, whatever its status.
 *   · ⛔ A ROW THE IMPORT SCREEN WOULD PUBLISH (`screenImportRow`, src/lib/import-screen.ts), fed the
 *     same fields the importers and scripts/hide-ad-banned.ts feed it. Some hidden import rows are hidden
 *     BECAUSE OF what they advertise — the 48 ad-banned rows of 2026-10-01 (infant formula, veterinary
 *     drugs), the banned-word rows the importers' screen hides. A page naming one would put the
 *     advertisement back up, so anything short of 'import' — 'review' included — stays a 404.
 *     ⚠️ THE DESCRIPTION GOES IN TOO, although the page never shows it: the infant-formula rule takes an
 *     explicit age from the description ("Sữa bột … 900g" + "cho bé từ 6 tháng" is 'ban'), so a
 *     title-only screen would pass a row the hide script banned (review, 2026-10-05).
 *
 * ⛔ WHAT IT SHOWS: the title, for context. No photo, price, seller, contact or description —
 * `goneListingView` is the whole projection the page component receives.
 *
 * ⚠️ ISR: the page is the PDP route's own render, so it is cached under the same route tags for the
 * same 30 days (listings/[id]/(pdp)/page.tsx `revalidate`). Nothing here caches the decision itself:
 * an in-app status change purges the path (refreshListingSurfaces, src/lib/listing-surfaces.ts), and
 * after a SQL restore `scripts/purge-isr-listings.mjs` tombstones the route — the next visit renders
 * the live PDP again.
 */

/** The columns the decision reads. A full `getListing` row satisfies it structurally. */
export type GoneCandidate = {
  id: string
  /** The row's last write — see GONE_CLEANUP_ENDED. */
  updatedAt: Date
  verified: boolean
  status: string
  listingType: string
  complianceStatus: string
  affiliateUrl: string | null
  title: string
  titleVi: string | null
  /** Read by the screen only — never shown (see above). */
  description: string | null
  descriptionVi: string | null
  subcategorySlug: string | null
  category: { slug: string }
  seller: { id: string; ownerId: string | null; officialPartner: boolean; name: string }
}

/**
 * ⛔ AND NOT WRITTEN SINCE THE CLEANUP (gate, 2026-10-05). A journaled row the owner restores and someone later
 * hides again — after a counterfeit report, say — is a NEW hide whose reason is unknown, so it must lose the page.
 * The restore and the re-hide both write the row through the app, which stamps `updatedAt`; the cleanup's own
 * SQL did not. Measured read-only 2026-10-05: all 68,008 journaled rows still hidden were last written by
 * 2026-10-02 20:04; the only journaled rows written since the cleanup day are the 15 restored "Activated"
 * phones the importer refreshes (live, so never gone). So the line is the START of the cleanup day: any app
 * write on or after it disqualifies the row. Journal membership proves the owner's decision; this proves
 * nothing has happened to the row since. ⚠️ A raw-SQL re-hide stamps nothing — take a row down for a reason
 * (counterfeit, IP, merchant request) with verified:false or complianceStatus, the house takedown contract,
 * and run scripts/purge-isr-listings.mjs, as for any PDP change made outside the app.
 */
export const GONE_CLEANUP_ENDED = new Date('2026-10-03T00:00:00+07:00')

export function isGoneListing(row: GoneCandidate | null | undefined): boolean {
  if (!row || !row.verified || row.status !== 'hidden' || row.listingType !== 'sell' || row.complianceStatus !== 'clear') return false
  // ⛔ ONLY A ROW THE OWNER'S CLEANUP JOURNALED (gone-listing-ids.ts) — every other hidden row, whatever it looks
  // like, may have been taken down for a reason this page must not undo.
  if (!isJournaledGone(row.id)) return false
  if (!(row.updatedAt instanceof Date) || row.updatedAt.getTime() >= GONE_CLEANUP_ENDED.getTime()) return false
  // The STORED column for "links out", as the PDP reads it: an import is an import even if its link
  // fails safeAffiliateUrl.
  const linksOut = !!row.affiliateUrl
  const shown = { id: row.seller.id, ownerId: row.seller.ownerId, officialPartner: partnerShown(row.seller.officialPartner, linksOut) }
  if (!isLinkedShop(shown, linksOut)) return false
  // The fields scripts/hide-ad-banned.ts classifies with, so a row it hid can never pass here.
  return screenImportRow({
    title: row.title, titleVi: row.titleVi, description: row.description, descriptionVi: row.descriptionVi,
    category: row.category.slug, subcategory: row.subcategorySlug, merchant: row.seller.name,
  }).action === 'import'
}

/**
 * EVERYTHING the gone page is told about the row. Seven fields, none of them a photo, a price, a seller
 * or a way to reach one — the page cannot leak what it is never handed.
 */
export type GoneListingView = {
  id: string
  title: string
  titleVi: string | null
  categorySlug: string
  subcategorySlug: string | null
  brandSlug: string | null
  model: string | null
}

export function goneListingView(row: {
  id: string; title: string; titleVi: string | null; subcategorySlug: string | null
  brandSlug: string | null; model: string | null; category: { slug: string }
}): GoneListingView {
  return {
    id: row.id,
    title: row.title,
    titleVi: row.titleVi,
    categorySlug: row.category.slug,
    subcategorySlug: row.subcategorySlug,
    brandSlug: row.brandSlug,
    model: row.model,
  }
}

/** The `<title>` and robots of a gone page: the variant's title, never indexed, links followed (as sold). */
export function goneMetadata(row: { title: string; titleVi: string | null }, lang: string | undefined): Metadata {
  const vi = lang === 'vi'
  // ⚠️ `||`, not `??`: an empty `titleVi` is no title (generateMetadata's own rule).
  const title = vi ? row.titleVi || row.title : row.title
  return { title: `${title} — ${vi ? 'Không còn trên eno' : 'No longer on eno'} | ${SITE_NAME}`, robots: { index: false, follow: true } }
}

/**
 * THE QUERY THE PAGE'S SEARCH LINK PREFILLS: brand + model when the row has both, else the title's key
 * words (`titleKeywords`) in the page's language.
 * ⚠️ SHORT ON PURPOSE. The feed ANDs every 2+ character token (src/lib/search-match.ts), so each extra
 * word can only REMOVE second-hand matches — "OPPO A6c" finds the used ones, "OPPO A6c 4GB/128GB Chính
 * Hãng" finds none.
 */
export function goneSearchQuery(l: Pick<GoneListingView, 'title' | 'titleVi' | 'model'>, brandName: string | null, lang: string | undefined): string {
  const model = l.model?.replace(/\s+/g, ' ').trim()
  const brand = brandName?.replace(/\s+/g, ' ').trim()
  if (model && brand) {
    // A model that already names its brand ("OPPO A6c") is not prefixed twice.
    const named = `${fold(model)} `.startsWith(`${fold(brand)} `) || words(model).some((w) => same(w, brand))
    return named ? model : `${brand} ${model}`
  }
  return titleKeywords(lang === 'vi' ? l.titleVi || l.title : l.title, brand || null)
}

const MAX_WORDS = 4
// Letters and digits in any script — the boundary every pattern below uses instead of an ASCII `\b`.
const EDGE_L = '(?<![\\p{L}\\p{N}])'
const EDGE_R = '(?![\\p{L}\\p{N}])'
/** Shop wording that says nothing about WHICH item: "Genuine", "Chính hãng", "[New 100%]" and kin. */
const NOISE = new RegExp(
  `${EDGE_L}(?:hàng chính hãng|chính hãng|genuine|authentic|brand new|new 100%|100% new|mới 100%|100% mới|nguyên seal|nguyên hộp|full ?box|vn/a|giá rẻ)${EDGE_R}|${EDGE_L}100%`,
  'giu',
)
/** A memory spec ("4GB/128GB", "512 GB", "8GB RAM") — a used match rarely repeats it. */
const SPEC = new RegExp(`${EDGE_L}\\d+(?:[.,]\\d+)?\\s?(?:gb|tb|mb)(?:\\s?/\\s?\\d+(?:[.,]\\d+)?\\s?(?:gb|tb|mb))?${EDGE_R}|${EDGE_L}(?:ram|rom)${EDGE_R}`, 'giu')
/** Where a title stops naming the item and starts describing it: " - White", ", 30 meters", " | …".
 *  ⚠️ A comma only before a space: "1,5L" is a Vietnamese decimal, not a break. */
const SEPARATOR = /\s+[-–—|]\s+|[,;](?:\s+|$)/u
const PUNCT_EDGES = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu

const same = (a: string, b: string) => fold(a) === fold(b)
const words = (s: string) => s.split(/\s+/).map((w) => w.replace(PUNCT_EDGES, '')).filter(Boolean)

/** A leading word that only says what KIND of thing it is, which a used listing rarely repeats ("Book: Mindset"). */
const LEADING_KIND = new Set(['book', 'sach'])

/**
 * The words of a title that name the item: brackets and shop wording out, the first segment that is
 * more than one word (so "Book - Waiting for You…" keeps the book, not "Book"), memory specs out, a
 * leading "Book"/"Sách" out, and — when the brand comes within the first two words ("Điện thoại OPPO
 * A6c", "Laptop Dell Latitude 7420") — from the brand on. At most four words; the raw title's first four
 * if nothing is left.
 */
export function titleKeywords(title: string, brandName: string | null): string {
  const unbracketed = title.replace(/&amp;/gi, '&').replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】|\{[^}]*\}/g, ' ')
  const segments = unbracketed.split(SEPARATOR).map((s) => s.replace(NOISE, ' ').replace(SPEC, ' ')).map(words).filter((w) => w.length)
  let picked = segments.find((w) => w.length > 1) ?? segments[0] ?? []
  if (picked.length > 1 && LEADING_KIND.has(fold(picked[0]))) picked = picked.slice(1)
  const brandWord = brandName ? words(brandName)[0] : undefined
  if (brandWord) {
    const at = picked.findIndex((w) => same(w, brandWord))
    if (at > 0 && at <= 2) picked = picked.slice(at)
  }
  const out = picked.slice(0, MAX_WORDS)
  return (out.length ? out : words(title).slice(0, MAX_WORDS)).join(' ')
}
