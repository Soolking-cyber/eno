/**
 * WHEN A HELP POST'S COPY LAST CHANGED — or null when nobody can say.
 *
 * One rule for its three readers: the thread's visible "Updated" line, its JSON-LD dateModified
 * (src/app/[lang]/help/[id]) and its sitemap lastmod (src/app/sitemaps/pages.xml).
 *
 * ⛔ AN OFFICIAL ANSWER NEVER FALLS BACK TO createdAt. sync-help-center.ts writes that column as the
 * curated-ORDER key (a fixed 2026-07-21 base plus one minute per seed index) and says it "must never
 * stand in for" the modified date; editedAt only started moving on a copy change with C-DATES, so an
 * answer re-synced before then reads null and still carries newer copy. Every never-edited answer was
 * "Updated 21 Jul 2026", to the minute of its list position (review, 2026-09-29). No date is honest;
 * the line, the JSON-LD key and the lastmod are simply left out, as the static pages' lastmod is.
 * A member's post has a real createdAt, and a post never edited was last changed when it was written.
 */
export function helpModifiedAt<T extends string | Date>(post: {
  official: boolean
  editedAt?: T | null
  createdAt: T
}): T | null {
  return post.editedAt ?? (post.official ? null : post.createdAt)
}
