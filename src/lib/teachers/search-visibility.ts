import 'server-only'
import { db } from '@/lib/db'
import { revalidatePublicPath } from '@/lib/revalidate-lang'

/**
 * "HIDE MY PROFILE FROM SEARCH ENGINES" — THE ONE WRITER OF TeacherProfile.hideFromSearch (owner decision 14,
 * 2026-10-20). The teacher's own switch, behind PUT /api/teachers/me/search (auth 'profile': the signed-in account's
 * own row, keyed by its profile id — never an id from the request). Saved on toggle, never with the profile save, never
 * in TeacherInput or a draft. What it does is the search verdict's (src/lib/teachers/search-floor.ts): on, the profile
 * page answers `noindex` and leaves every sitemap — eno itself still shows it to everyone.
 * ⛔ ONE STATEMENT, AND IT DOES NOT MOVE @updatedAt: a switch is not an edit of the profile. updatedAt is the matcher's
 * seen-cache key (a bump would send the teacher back to the AI judge — match-io.ts) and the JSON-LD's dateModified;
 * scripts/teachers-match.ts writes lastMatchedAt the same way, for the same reason.
 * ⛔ IT WRITES — AND PURGES — ONLY A CHANGE (review round 1, codex + opus): a hide is never rate-limited (the route), so
 * a request that finds the switch already where it was asked to be must cost nothing: no write, no purge. Otherwise
 * one session looping on `{ hidden: true }` would regenerate the profile page without limit. A real change purges the
 * profile page (both languages, revalidatePublicPath), so its robots tag changes with its next request rather than after
 * the page's 30-day ISR window — /listings/* is routed past the HTML edge Worker (infra/cloudflare/eno-html-edge-cache.js
 * ROUTES), so no edge copy outlives the purge. Nothing else needs it: /c/teachers, the home shelf and the district pages
 * render the same cards either way (the profile stays on eno), a storefront's tag is read live (force-dynamic —
 * search-index.ts storefrontTeacherRobots), and the sitemaps leave the profile out from their next daily build, as they
 * do for every listing change (nothing purges them; the page's own noindex is what search engines obey).
 * Null when the account has no teacher profile.
 */
export async function setTeacherSearchHidden(profileId: string, hidden: boolean): Promise<{ hidden: boolean } | null> {
  const changed = await db.$queryRaw<{ listingId: string | null }[]>`
    UPDATE "TeacherProfile" SET "hideFromSearch" = ${hidden}
     WHERE "profileId" = ${profileId}::uuid AND "hideFromSearch" IS DISTINCT FROM ${hidden}
     RETURNING "listingId"`
  if (changed.length) {
    if (changed[0].listingId) revalidatePublicPath(`/listings/${changed[0].listingId}`)
    return { hidden }
  }
  // Nothing changed: already so — or no profile at all.
  const row = await db.teacherProfile.findUnique({ where: { profileId }, select: { hideFromSearch: true } })
  return row ? { hidden: row.hideFromSearch } : null
}
