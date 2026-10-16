import 'server-only'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { TEACHERS_CATEGORY_SLUG } from '@/lib/teachers/constants'
import { legacyDistrictKey } from '@/lib/teachers/profile'

/**
 * THE PUBLIC PAGES A TEACHER ROW IS ON — one list, shared by the writers that own a teacher row: the teacher publish core
 * (src/lib/teachers/publish.ts — the full save, the cover save, the "Identity verified" hide and show-again, hide/show
 * and delete),
 * the generic listing cores when the listing is a teacher's (src/lib/core/listings.ts purgeTeacherPages — the dashboard
 * row's Hide / Relist / Delete, /api/v1 and MCP reach setStatusCore and deleteListingCore), the account erasure
 * (src/lib/core/account-erasure.ts)
 * and, since 2026-10-15, every identity recompute of a teacher account (src/lib/compliance/identity-effects.ts — a
 * KYC submission, decision or revocation, and the nightly reconcile, /api/cron/identity-reconcile): a live verified
 * identity moves trust, which the pages bake into the order and the score, so the purge follows unconditionally — and
 * the card-tick pass (src/lib/compliance/identity-reconcile.ts — after the 09:05 reconcile, and alone at 00:05 ICT,
 * /api/cron/identity-marks, when a document lapses), which purges a teacher whose "Identity verified" card cache it
 * rewrote, every identity holder who has not hidden the mark (automatic since 2026-10-16 — a failed purge of a lapse or a
 * revocation is retried), and a teacher who hid it in the last 7 days.
 * Moved out of publish.ts on 2026-10-13, when the home page gained its "Find a teacher" shelf.
 * ⚠️ NOT EVERY WRITER: moderation (reject, unpublish, a confirmed report, an approval), an enforcement hold and the AI /
 * provenance auto-holds purge a teacher's listing page and the home page, but not /c/teachers or the district page, which
 * keep the profile for their own ISR window — a known follow-up (those generic paths do not know the row's district).
 * And two seller doors write a teacher's listing with no teacher purge and no profile sync at all (pre-existing, and
 * each a defect of its own — a person is never "sold", setStatusCore says so): the daily availability review's "sold"
 * (api/listings/availability) and a "still available" confirm that revives a hidden row (core/listings.ts confirmCore).
 * ⚠️ Nor does a relist through a generic door (setStatusCore — the dashboard row's Relist, /api/v1, MCP) pass the gates
 * the teacher's own Visibility switch does (publish.ts setTeacherStatus: a job goal or public cover, the trust tier):
 * pre-existing too. It does sync the profile, and it purges these pages.
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
 * this. ⚠️ EVERY call purges it, for the profiles that are not on the shelf too (hidden, or ranked below eight) — telling
 * those apart would need the before-and-after state of every writer.
 * ⚠️ WHAT A PURGE COSTS, AND WHY NO WRITER CAPS IT. Purges between two requests coalesce: the cost is at most ONE home
 * regeneration, on the next request that reaches the origin. An anonymous request comes through the edge cache, which
 * re-asks at most once per FRESH_TTL (five minutes) per location and language key (infra/cloudflare/eno-html-edge-
 * cache.js). A SIGNED-IN one bypasses it, so a write followed by a reload of '/' costs one regeneration — what a
 * signed-in reload of any force-dynamic page already costs, with no write needed (and the write is no free action: the
 * generic status door also purges the listing's page, reindexes it and fires its webhook; the teacher routes are capped
 * per account: 30 saves, 60 cover saves, 60 "Identity verified" show-agains — a hide, the takedown direction, is never
 * capped — 60 visibility changes, 10 deletes an hour).
 * So the purge opens no new way to make the origin work, and a cap would only leave a takedown past it on the home shelf
 * for six hours (review,
 * 2026-10-13: one was tried on the status door and withdrawn, as was skipping a re-send that "changed nothing" — judged
 * on a status read before the write, it raced a concurrent relist).
 * The tombstones a purge writes are shared by both editions (cache-handler.cjs), so a teacher removed through eno.vn
 * leaves eno.forum's home shelf too.
 */
export function revalidateTeacherPages(listingId: string | null, districts: (string | null | undefined)[]) {
  if (listingId) revalidatePublicPath(`/listings/${listingId}`)
  revalidatePublicPath(`/c/${TEACHERS_CATEGORY_SLUG}`)
  for (const key of new Set(districts.filter((k): k is string => !!k))) revalidatePublicPath(`/c/${TEACHERS_CATEGORY_SLUG}/${key}`)
  revalidatePublicPath('/')
}
