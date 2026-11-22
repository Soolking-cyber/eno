/**
 * ── THIN IMPORTS: one rule for the sitemap and the listing page's robots tag ───────────────────────────────────────────
 * An IMPORT is a row with an `externalId` that is not `fb:` (a member's own Facebook import is a member post). A THIN
 * import is one whose stored `description` is under MIN_IMPORT_DESCRIPTION_CHARS characters.
 *
 * ⛔ NOT SUBMITTED (owner, 2026-11-19: "Unsubmit thinnest imports", src/lib/sitemap.ts) AND, SINCE 2026-11-22, `noindex,
 * follow` (owner: "16k still not indexed … if need sitewide cleanup do it, i want best proper handling"). Measured that
 * day: 11,272 live listings, 10,388 of them imports under 200 characters (GoPlus 6,711 rooms from one template,
 * CellphoneS 814); Search Console had 1,473 "Crawled - currently not indexed" (885 of a 1,000 sample listing pages) and
 * 432 "Duplicate, Google chose different canonical" (GoPlus rooms). Google was already declining these pages; saying so
 * keeps the near-duplicates out of its view of the site, and the district and category pages that list the same rooms
 * stay indexable. Cost measured from 90 days of clicks: 4 of the 30 most-clicked listings were live thin imports,
 * 1–2 clicks each. `follow`: the page still passes its links (seller, district, category).
 * ⛔ MEMBER POSTS ARE NEVER JUDGED BY LENGTH (a short post from a person is still a person's post).
 * ⚠️ Characters as Postgres counts them (code points), so the page and the sitemap's SQL `length()` agree.
 */
export const MIN_IMPORT_DESCRIPTION_CHARS = 200

export function isImport(externalId: string | null | undefined): boolean {
  // As the sitemap's SQL reads it: `"externalId" IS NOT NULL AND NOT LIKE 'fb:%'` (an empty string is an import too).
  return typeof externalId === 'string' && !externalId.startsWith('fb:')
}

export function isThinImport(row: { externalId?: string | null; description?: string | null }): boolean {
  return isImport(row.externalId) && Array.from(row.description ?? '').length < MIN_IMPORT_DESCRIPTION_CHARS
}
