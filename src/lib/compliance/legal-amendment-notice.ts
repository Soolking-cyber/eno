// ── The NOTICE TO REGISTERED USERS that Quy chế Article 15 promises with every amendment ─────────────
//
// ⛔ WHY IT EXISTS (2026-10-01 review). Article 15 — in force in version 1 and kept in version 2 — says every
// amendment is published on the platform at least 5 days ahead "kèm thông báo tới người sử dụng đã đăng ký
// tài khoản". The site-wide strip (tos-change-notice.tsx) is the on-platform announcement; it reaches only
// whoever happens to visit. This is the notice that goes to every account: one bell notification each,
// written by scripts/notify-legal-amendment.ts (dry run by default; `--apply` on the publication day,
// after the deploy that publishes the amendment). Pure: no database, no clock of its own.
//
// ⚠️ THE SENTENCE IS THE STRIP'S, WORD FOR WORD (legal-amendment-notice.test.ts holds it): two wordings
// of one announcement are two statements somebody has to keep true.
// ⚠️ BOTH EDITIONS SHARE ONE DATABASE, so one row per account reaches whichever site it is read on: the
// link is relative and the copy names no site and no service — nothing crosses the edition boundary.

import { AMENDED, LEGAL_AMENDMENT } from './legal-amendment'

/** Where the notice points: the change log of the Quy chế, which lists every edit. */
export const AMENDMENT_NOTICE_URL = '/regulations#changelog'

/** The bell copy, per stored Profile.locale — Vietnamese for 'vi', English (machine-translated on display) otherwise. */
export const AMENDMENT_NOTICE = {
  en: {
    title: 'Our terms have been amended',
    body: `Our Terms of Service, Operating Regulations, Returns policy and Prohibited items list have been amended. The changes take effect on ${AMENDED.inForceEn}.`,
  },
  vi: {
    title: 'Điều khoản đã được sửa đổi',
    body: `Điều khoản dịch vụ, Quy chế hoạt động, Chính sách đổi trả và Danh mục hàng hoá, dịch vụ cấm đăng đã được sửa đổi. Nội dung sửa đổi có hiệu lực từ ngày ${AMENDED.inForceVi}.`,
  },
} as const

/**
 * One row per account per amendment, BY CONSTRUCTION: the id is derived, so a second run (or a re-run
 * after a crash) conflicts on the primary key instead of notifying anyone twice.
 */
export const AMENDMENT_NOTICE_ID_PREFIX = `legal-amendment-${LEGAL_AMENDMENT.published}-`

/** Midnight in Vietnam (UTC+7, no DST) at the start of an ISO date. */
const vnMidnight = (iso: string) => Date.parse(`${iso}T00:00:00+07:00`)

/**
 * May the notice be sent at `now`? Only inside the notice window: before the publication day the texts
 * it announces are not published yet, and from the in-force instant it would announce a change that has
 * already happened — a notice with no notice period left.
 */
export function noticeSendable(now: Date): { ok: true } | { ok: false; reason: string } {
  const t = now.getTime()
  if (!Number.isFinite(t)) return { ok: false, reason: 'unreadable clock' }
  if (t < vnMidnight(LEGAL_AMENDMENT.published)) {
    return { ok: false, reason: `the amendment is published on ${LEGAL_AMENDMENT.published} (Vietnam time) — deploy it first, then send` }
  }
  if (t >= vnMidnight(LEGAL_AMENDMENT.inForce)) {
    return { ok: false, reason: `the amendment took effect on ${LEGAL_AMENDMENT.inForce}; the notice window is over` }
  }
  return { ok: true }
}
