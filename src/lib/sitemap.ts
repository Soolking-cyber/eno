import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { IS_SERVICES } from '@/lib/edition'
import { teacherSitemapScope } from '@/lib/teachers/search-index'

/**
 * THE SITEMAP IS PAGED INTO CHILDREN, and every child is capped.
 *
 *   /sitemap.xml                 ONE FLAT <urlset> (pages.xml's URLs, then listings-0.xml's) while there are
 *                                ≤ 45,000 submitted listings and ≤ 50,000 URLs in all; past that, the
 *                                <sitemapindex>: the pages child + one child per LISTINGS_PER_SITEMAP.
 *                                Flat since 2026-11-18: crawlers that read /sitemap.xml's locs as pages took
 *                                the children for untitled pages (src/app/sitemap.xml/build.ts).
 *   /sitemaps/pages.xml          <urlset>: home, static/editorial pages, help, categories, category ×
 *                                district combos, storefronts — everything that is not a listing
 *   /sitemaps/listings-<k>.xml   <urlset>: the k-th slice of the SUBMITTED listings, ordered by id
 *
 * ⛔ WHY: THE SINGLE FILE WAS TWO `take: 45000` WINDOWS ORDERED BY `updatedAt desc`. One fed the
 * category lastmods, the category × district combos and the storefront URLs; the other fed the
 * listing URLs. Any bulk write that touches `updatedAt` — a 44,000-row nhatot import, an affiliate
 * sync — fills a window with its own rows, and everything older silently drops out: districts that
 * only older stock covers lose their combo URL, and their sellers' storefronts leave the sitemap,
 * with nothing reporting it. The fix is not a bigger number: the derivations are now whole-table
 * GROUP BYs (src/app/sitemaps/pages.xml/build.ts), and the listing URLs are paged into as many
 * children as the count needs.
 *
 * ⚠️ WHAT "EVERY PUBLIC LISTING" MEANS HERE IS UNCHANGED: `submittedListingWhere()` below. Imported
 * reference/affiliate rows stay crawlable but NOT submitted — the owner's 2026-09-17 decision, whose
 * reasoning sits in pages.xml/build.ts beside the old listing loop. Paging does not widen the set;
 * it stops the set being truncated.
 */

/** Sitemap protocol: ≤ 50,000 URLs per file. Listing children keep the old headroom. */
export const LISTINGS_PER_SITEMAP = 45_000
export const MAX_URLS_PER_SITEMAP = 50_000
/**
 * A sanity bound on `listings-<k>.xml`, not a policy: 200 × 45,000 = 9M submitted listings. Each
 * child is an ISR cache entry, so an unbounded `k` would let any crawler mint cache entries (and
 * database OFFSET scans) by asking for `listings-999999.xml`.
 */
export const MAX_LISTING_SITEMAPS = 200

export function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
}

/**
 * THE ONE DEFINITION OF A LISTING THIS SITE ASKS GOOGLE TO INDEX — used by the index (to count)
 * and by every listing child (to page), so the two cannot disagree about how many children exist.
 *
 *   · `verified: true, status: 'active'` — exactly what the PDP serves without `noindex`
 *     (src/app/[lang]/listings/[id]/(pdp)/page.tsx: robots is undefined only for verified+active).
 *   · `scopedListingWhere` — the edition boundary: the licensed marketplace never submits the desk.
 *   · teacher profiles ON eno.vn ONLY — eno.forum 308s each to eno.vn (src/lib/teachers/surface.ts), so it submits none.
 *   · `affiliateUrl: null` — imported stock is crawlable, not submitted (see pages.xml/build.ts).
 *   · ⛔ A TEACHER PROFILE ONLY WHILE ITS SEARCH VERDICT LETS IT IN (owner decisions 7 and 14, 2026-10-20 —
 *     src/lib/teachers/search-floor.ts): not under the quality floor (an About text of fewer than 30 words and
 *     no intro video), never for a masked name, never once the teacher switched "Hide my profile from search
 *     engines" on — exactly the profiles whose page answers `noindex`. Measured 2026-10-20: 30 of the 112 live.
 *     It narrows every user of this predicate: the listing children and the index's count, and pages.xml's
 *     category × district combos (a teacher under the floor no longer counts toward a district's ten) and its
 *     storefront block (a teacher-only storefront is submitted only while its profile is — search-index.ts).
 *   · ⛔ NO THIN IMPORT — `notThinImport()` below (owner 2026-11-19). Narrows the same users: a storefront whose every
 *     row is a thin import (GoPlus, Điện Thoại Vui on 2026-11-19) leaves pages.xml too.
 *
 * ⚠️ NESTED IN AN `AND`, NOT SPREAD: whatever shape scopedListingWhere returns, the extra key cannot
 * collide with it (the note that used to sit on this query in sitemap.xml/route.ts).
 *
 * `extra` narrows further (the category × district block passes `district: { not: null }`); it can
 * only ADD conditions — the rules above always apply.
 */
export async function submittedListingWhere(extra: Prisma.ListingWhereInput = {}) {
  /**
   * Teacher profiles are public and indexed by owner decision (2026-09-30) — on eno.vn, those that pass the search verdict
   * (2026-10-20, src/lib/teachers/search-index.ts), through the last element. ⛔ eno.forum hands every teacher page to
   * eno.vn with a 308 (owner decision 6, 2026-10-20; src/lib/teachers/surface.ts), and a submitted URL that redirects is a
   * Search Console error, so there the scope's default teacher exclusion stands. Every derivation from this predicate
   * follows, which is the point: the forum's listing children and the index's count, its /c/teachers/<district> combos
   * (pages.xml/build.ts) and a storefront whose ONLY own listing is a profile (the seller aggregate there) — a page left
   * with nothing of its own on the forum, and the rule for those is "crawlable, not asked for".
   */
  const [scoped, teachers, notThin] = await Promise.all([
    scopedListingWhere({ ...extra, verified: true, status: 'active' }, { teachers: !IS_SERVICES }),
    teacherSitemapScope(),
    notThinImport(),
  ])
  return { AND: [scoped, { affiliateUrl: null }, teachers, notThin] }
}

/**
 * ⛔ AN IMPORT WHOSE DESCRIPTION IS UNDER 200 CHARACTERS IS CRAWLABLE, NOT SUBMITTED (owner, 2026-11-19: "Unsubmit
 * thinnest imports"). Search Console that day: 1,529 "Crawled - currently not indexed", 81% of a 500-URL sample listing
 * pages, mostly GoPlus rooms and CellphoneS rows. The page stays 200, linked and indexable; we only stop asking for it.
 *
 * IMPORT = an `externalId` that is not `fb:` (a member's own Facebook import, src/lib/fb-import/publish.ts — a member post).
 * Every PartnerPurchaseLink row has one (4,065 of 4,065), so the chat-only partners need no relation filter.
 * ⛔ MEMBER POSTS ARE NEVER DROPPED BY LENGTH (81 of 295 live are under 200).
 *
 * WHY 200, measured 2026-11-19 on live verified imports without affiliateUrl (English `description`, what the page shows):
 *   GoPlus 5,379 rows, 104–166 chars (one template: "1-bedroom apartment of 40 m² on …, Message GoPlus to …") — all drop
 *   Hoàng Hà 2,663 (p90 130) — 2,659 drop · Điện Thoại Vui 106 (p90 126) — all drop · ShopDunk 214 (p90 134) — 198 drop
 *   CellphoneS 1,082 (p50 82, spread to 350) — 828 drop, 254 stay
 *   Saigon Cribs 154 (p10 1,146), Blvck, KarPlus, An Khánh, Carbi, Quê Hương, Evisa Saigon… (all ≥ 300) — none drop
 *   → ≈9,959 before, ≈788 after, before the scope and teacher rules (9,171 drop; 295 member posts + 493 imports stay).
 *
 * ⛔ AN ID LIST, NOT A RELATION OR A FUNCTION: Prisma cannot express `length()`, and a relation filter in the sorted
 * child query took 81 s (2026-11-19). So one raw read (47 ms, 493 ids) names the imports long enough to submit, and
 * the predicate stays plain columns: `externalId` + `id IN (…)` (42 ms for the child query). Kept imports, not thin
 * ones, so the list is short and a row the read missed is left out, never let in. ⚠️ Past ~30,000 kept imports the
 * list nears Prisma's bind-parameter cap: move to a stored flag then.
 */
export const MIN_IMPORT_DESCRIPTION_CHARS = 200

async function notThinImport(): Promise<Prisma.ListingWhereInput> {
  const long = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM "Listing"
    WHERE verified AND status = 'active' AND "affiliateUrl" IS NULL
      AND "externalId" IS NOT NULL AND "externalId" NOT LIKE 'fb:%'
      AND length(description) >= ${MIN_IMPORT_DESCRIPTION_CHARS}`)
  return { OR: [{ externalId: null }, { externalId: { startsWith: 'fb:' } }, { id: { in: long.map((r) => r.id) } }] }
}

/** How many `listings-<k>.xml` children `total` submitted listings need (0 → none). */
export function listingSitemapCount(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.min(MAX_LISTING_SITEMAPS, Math.ceil(total / LISTINGS_PER_SITEMAP))
}

export function listingSitemapPath(k: number): string {
  return `/sitemaps/listings-${k}.xml`
}

export const PAGES_SITEMAP_PATH = '/sitemaps/pages.xml'

/** `listings-<k>.xml` → k, or null for anything else (including a `k` past the bound, or `01`). */
export function parseListingSitemapFile(file: string): number | null {
  const m = /^listings-(0|[1-9]\d{0,5})\.xml$/.exec(file)
  if (!m) return null
  const k = Number(m[1])
  return k < MAX_LISTING_SITEMAPS ? k : null
}

export function sitemapIndexXml(locs: string[]): string {
  const body = locs.map((loc) => `  <sitemap><loc>${loc}</loc></sitemap>\n`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}</sitemapindex>`
}

/**
 * Wrap pre-rendered `<url>` entries in a urlset, trimming past the protocol cap.
 *
 * ⚠️ A FILE OVER 50,000 URLs IS REJECTED WHOLE, so trimming the tail is the lesser failure — and it
 * is logged, because a trimmed sitemap is a real defect to fix (split the file), not a steady state.
 */
export function urlsetXml(entries: string[], label: string): string {
  let kept = entries
  if (entries.length > MAX_URLS_PER_SITEMAP) {
    console.error(`[sitemap] ${label} has ${entries.length} URLs — trimmed to ${MAX_URLS_PER_SITEMAP}; split it into another child`)
    kept = entries.slice(0, MAX_URLS_PER_SITEMAP)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${kept.join('')}</urlset>`
}

export function xmlResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
    },
  })
}
