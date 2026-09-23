/**
 * WHY A SELLER'S DELETE BECAME A HIDE, IN THE SELLER'S WORDS — bilingual.
 *
 * deleteListingCore (src/lib/core/listings.ts) hides instead of deleting while the account is held or
 * suspended, or a report about the listing or the shop is open: a listing delete cascades other
 * people's reports and chats. The WEB route (DELETE /api/listings/[id]) carries these sentences as
 * `message: { en, vi }` for the clients that do not word the outcome themselves — the native iOS and
 * Android dashboards call that same route, and without a sentence a held seller watched a "deleted"
 * listing come back as hidden with no explanation (review, 2026-09-24).
 *
 * The web dashboard words it itself with tr() in src/components/marketplace/use-listing-actions.ts
 * (literal tr() calls, so scripts/gen-ui-strings.mjs harvests them for the machine-translated
 * languages). The two are the SAME sentences, pinned together by
 * src/app/api/listings/[id]/route.delete.test.ts.
 *
 * A plain module (no server-only): nothing here is secret, and the test reads it without the core.
 */
export type DeleteHoldReason = 'account_suspended' | 'account_held' | 'open_report'

const UNDER_REVIEW = {
  en: 'Hidden, not deleted: your account is under review. You can delete it once the review is finished.',
  vi: 'Đã ẩn, chưa xóa: tài khoản của bạn đang được xem xét. Bạn có thể xóa tin sau khi việc xem xét kết thúc.',
}

export const DELETE_HOLD_COPY: Record<DeleteHoldReason, { en: string; vi: string }> = {
  account_suspended: UNDER_REVIEW,
  account_held: UNDER_REVIEW,
  open_report: {
    en: 'Hidden, not deleted: a report about this listing or your shop is still open. You can delete it once the report is resolved.',
    vi: 'Đã ẩn, chưa xóa: một báo cáo về tin này hoặc gian hàng của bạn vẫn đang được xử lý. Bạn có thể xóa tin sau khi báo cáo được giải quyết.',
  },
}
