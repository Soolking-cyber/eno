/**
 * ── THE LISTING TOMBSTONE ───────────────────────────────────────────────────────────────────────
 *
 * ⛔ LISTINGS ARE NEVER HARD-DELETED ANY MORE (2026-10-01). Law 122/2025/QH15 Art 17.1(e) requires a
 * platform to keep the information posted on it for at least a year, and the Quy chế promises three.
 * A seller's delete, a moderator's reject and the admin console's bulk "remove" all used to
 * `DELETE FROM "Listing"` — which also cascaded the listing's reports and every buyer's conversation
 * about it, i.e. destroyed the evidence a dispute or an authority request would ask for.
 *
 * They now write a TOMBSTONE instead: `status = 'removed'`, `verified = false`, `identityHold = false`,
 * `featured = false` (src/lib/core/listing-tombstone.ts), plus a hash-chained compliance_audit row
 * saying who removed it and why. The row, its photos, its reports and its conversations stay.
 * A moderator's or admin's removal also CLOSES the listing's open reports as 'confirmed' in the same
 * transaction (api/admin/moderate 'reject', api/admin/listings 'delete') — the cascade used to take the
 * case out of the queue; a kept-but-open report would sit there and hold the seller's later deletes.
 *
 * WHY A NEW STATUS AND NOT 'hidden': 'hidden' is a SELLER state — it shows in the seller's dashboard
 * and the seller can relist it. A removed listing is gone from the seller's point of view (it must not
 * reappear in "My listings") and a moderator's removal must not be undoable by the seller.
 *
 * HOW IT STAYS INVISIBLE: every public read pins `verified = true AND status = 'active'` (and the PDP
 * 404s anything not verified + active|sold), so the tombstone's two flags exclude it from all of them.
 * The OWNER-scoped reads — which deliberately show sold/hidden/held rows — AND `NOT_REMOVED` in
 * (dashboard, the partner API's list and summary, MCP, analytics, the account payload, the
 * availability batch), and the ownership checks (checkListingOwner, listingOwnedBy) answer
 * not-found, so no edit, status change, confirm or sale can be applied to one. The admin console's
 * bulk hide/activate/feature/publish/unverify skip tombstones too (api/admin/listings, `NOT_REMOVED` in
 * every WHERE) — only "remove" itself touches them, and it is idempotent.
 *
 * WHAT A TOMBSTONE KEEPS, AND FOR HOW LONG: everything that was posted — EXCEPT a teacher's profile
 * listing, which is a person, and is scrubbed of the person at once (PERSONAL_SCRUB_DATA in
 * core/listing-tombstone.ts). Every other tombstone gets the same scrub when its retention period is
 * over (core/listing-tombstone-retention.ts, /api/cron/listing-tombstone-retention), unless an
 * investigation hold keeps it.
 *
 * Client-safe on purpose: no imports.
 */
export const LISTING_REMOVED = 'removed' as const

/** Prisma where-fragment: every row except tombstones. AND it into owner-scoped reads. */
export const NOT_REMOVED = { status: { not: LISTING_REMOVED } }

export const isRemovedStatus = (status: string | null | undefined): boolean => status === LISTING_REMOVED
