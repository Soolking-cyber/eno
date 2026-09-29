/**
 * WHAT A HELP-CENTER SYNC RUN WOULD CHANGE ON ONE SEEDED ANSWER — pure, so it can be tested without
 * a database. scripts/sync-help-center.ts reads each row first and asks this before it writes.
 *
 * ⛔ WHY THE SYNC NO LONGER WRITES EVERY ROW: `ForumPost.updatedAt` is `@updatedAt`, which Prisma
 * restamps on EVERY update call, including one that sets each column to the value it already holds.
 * The script used to upsert every answer on every run, so one run anywhere moved every answer's
 * `updatedAt` to that minute, whether or not a word had changed. A date that moves when nothing
 * changed teaches a crawler to ignore the date.
 *
 * ⚠️ `updatedAt` IS NOT THE EDIT DATE AND THIS DOES NOT MAKE IT ONE: a GET of the post's API (it
 * bumps `viewCount`, api/forum/posts/[id]/route.ts), a vote or a comment restamps it too, and so
 * does a reorder or a pin written here. `editedAt` is the date that means "the answer changed"; readers that want that
 * (the sitemap's `<lastmod>`, the help page's `dateModified`) should read `editedAt ?? createdAt` —
 * rows seeded before this change have `editedAt = null`.
 *
 * ⚠️ TWO LEVELS, BECAUSE NOT EVERY WRITE IS AN EDIT:
 *   - `write`: some stored column differs, so the row must be updated.
 *   - `edited`: something a READER of the answer's own page sees differs — its title, body, flair,
 *     kind, topic, its curated Vietnamese, or it is coming back from retirement. Only this sets
 *     `editedAt`. Reordering the seed file changes `createdAt` (the curated-order key) of every
 *     answer below the move, and pinning changes the /help list; neither changes the answer.
 */

export type SeedAnswer = {
  community: string
  kind: string
  flair: string
  flairVi: string
  title: string
  body: string
  pinned: boolean
}

/** The stored columns the sync owns, as read back from the row. */
export type StoredAnswer = {
  communitySlug: string
  kind: string
  flair: string
  flairVi: string
  title: string
  body: string
  pinned: boolean
  official: boolean
  status: string
  createdAt: Date
}

export type SeedDiff = { write: boolean; edited: boolean }

/**
 * @param viChanged whether the curated Vietnamese title or body in the translation cache differs
 *   from the seed — it is stored in another table, so the caller measures it.
 */
export function diffSeedAnswer(
  seed: SeedAnswer,
  createdAt: Date,
  row: StoredAnswer | null,
  viChanged: boolean,
): SeedDiff {
  if (!row) return { write: true, edited: true }
  const edited =
    viChanged ||
    row.status !== 'published' ||
    row.communitySlug !== seed.community ||
    row.kind !== seed.kind ||
    row.flair !== seed.flair ||
    row.flairVi !== seed.flairVi ||
    row.title !== seed.title ||
    row.body !== seed.body
  const write =
    edited ||
    row.pinned !== seed.pinned ||
    row.official !== true ||
    row.createdAt.getTime() !== createdAt.getTime()
  return { write, edited }
}
