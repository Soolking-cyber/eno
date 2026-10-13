import 'server-only'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { TEACHERS_CATEGORY_SLUG } from '@/lib/teachers/constants'
import { legacyDistrictKey } from '@/lib/teachers/profile'

/**
 * THE PUBLIC PAGES A TEACHER ROW IS ON — one list, shared by the writers that own a teacher row: the teacher publish core
 * (src/lib/teachers/publish.ts — the full save, the cover save, hide/show and delete) and the account erasure
 * (src/lib/core/account-erasure.ts). Moved out of publish.ts on 2026-10-13, when the home page gained its "Find a
 * teacher" shelf and the erasure needed the same list.
 * ⚠️ NOT EVERY WRITER: moderation (reject, unpublish, a confirmed report) and an enforcement hold purge a teacher's
 * listing page and the home page, but not /c/teachers or the district page, which keep the profile for their own ISR
 * window — a known follow-up (the generic paths do not know the row's district).
 */

/** The district a stored teacher row shows on — its key, or (a row the backfill has not migrated) its old district text's. */
export const districtPagesOf = (row: { currentDistrictKey?: string | null; currentDistrict?: string | null } | null | undefined): (string | null)[] =>
  row ? [row.currentDistrictKey ?? null, legacyDistrictKey(row.currentDistrict)] : []

/**
 * ⛔ EVERY PUBLIC PAGE A TEACHER ROW IS ON, PURGED BY EVERY WRITER THAT CHANGES WHAT IT SHOWS: the profile's own page,
 * /c/teachers, the district page of each district given (a DISTRICTS key IS the /c/teachers/<district> slug) — and the
 * HOME PAGE, in both languages. One list for the full save, the cover save, hide/show and delete — a cover save that HID
 * a profile purged only the first two, so the teacher stayed on their district page for its 24-hour ISR window (gate
 * review, 2026-10-09).
 * ⛔ '/' SINCE THE HOME SHELF (owner, 2026-10-13): the home page bakes up to eight teacher cards into its 6h-ISR HTML
 * (src/lib/core/teacher-shelf.ts), so a hidden, deleted or re-priced profile stayed on it for up to six hours without
 * this. ⚠️ EVERY teacher write purges it, the profiles that are not on the shelf too (hidden, or ranked below eight) —
 * telling those apart would need the before-and-after state of every writer. What bounds it is the write routes' own
 * per-account rate limits (api/teachers/me: 30 saves, 60 cover saves, 60 visibility changes, 10 deletes an hour) and the
 * edge cache in front of the origin, which re-asks for '/' at most once per its window however often it is purged.
 */
export function revalidateTeacherPages(listingId: string | null, districts: (string | null | undefined)[]) {
  if (listingId) revalidatePublicPath(`/listings/${listingId}`)
  revalidatePublicPath(`/c/${TEACHERS_CATEGORY_SLUG}`)
  for (const key of new Set(districts.filter((k): k is string => !!k))) revalidatePublicPath(`/c/${TEACHERS_CATEGORY_SLUG}/${key}`)
  revalidatePublicPath('/')
}
