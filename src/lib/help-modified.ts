/**
 * WHEN A HELP POST'S COPY LAST CHANGED: `editedAt ?? createdAt`.
 *
 * One rule for its three readers: the thread's visible "Updated" line (help-thread-client.tsx), its
 * JSON-LD dateModified (`modifiedAt` in src/lib/help-center-data.ts, read by src/app/[lang]/help/[id])
 * and its sitemap lastmod (src/app/sitemaps/pages.xml). The latter two state the same expression
 * inline; this helper must stay equal to it so the visible date and the crawler's date agree.
 *
 * ⛔ NEVER `updatedAt` (SEO wave B, I3c; C-DATES): Prisma restamps it on every view-count increment,
 * vote and comment, and on any re-run of the help-center sync. `editedAt` is set only by a real edit —
 * the forum edit route, and scripts/sync-help-center.ts since I3b (help-seed-diff.ts says what counts)
 * — and an answer never edited since it was written falls back to its `createdAt`, as upstream's I3c
 * contract for dateModified and lastmod has it.
 * ⚠️ `official` is accepted and ignored: an earlier version of this rule returned null for an official
 * answer with no `editedAt` (its createdAt is the curated-order key sync-help-center.ts writes). That
 * disagreed with the sitemap and JSON-LD, which I3c dates by createdAt, so it was brought into line.
 */
export function helpModifiedAt<T extends string | Date>(post: {
  official?: boolean
  editedAt?: T | null
  createdAt: T
}): T {
  return post.editedAt ?? post.createdAt
}
