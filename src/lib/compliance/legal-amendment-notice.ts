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
//
// ⛔ AN IMMEDIATE AMENDMENT HAS NOTHING TO ANNOUNCE (owner, 2026-10-01: "no need for announcement").
// noticeSendable() refuses it at every instant, and the script refuses to count or send. The October 2026
// amendment became one AFTER 30 notices had gone out saying it "takes effect on 7 October 2026" — false
// once it is in force from 01/10 — so the script also has `--retract`, which deletes exactly the rows this
// module's id scheme produced (retractable() below says when that is allowed).
//
// ⛔ THE TERMS' VERSION 3 IS IMMEDIATE (owner, 2026-10-07: published and in force 07/10/2026, no window), so
// noticeSendable() refuses at every instant and no row is ever written for it. The copy below still names the
// Terms and /terms#changes, ready for the next amendment that has a window.

import { AMENDED, LEGAL_AMENDMENT, MIN_NOTICE_DAYS, daysBetween, type LegalAmendment } from './legal-amendment'

/**
 * Where the notice points: the change log of the text the amendment changed, which lists every edit — the
 * Terms' `changes` section for the Terms' version 3 (its last note). October's pointed at the Quy chế's
 * Article 17 (/regulations#changelog), the one log that listed everything it changed. The strip links here too.
 */
export const AMENDMENT_NOTICE_URL = '/terms#changes'

/**
 * The bell copy, per stored Profile.locale — Vietnamese for 'vi', English (machine-translated on display) otherwise.
 * ⚠️ THE DOCUMENT LIST IS THE TERMS' VERSION 3's ("Terms of Service" — October's was "Terms of Service, Operating
 * Regulations, Returns policy and Prohibited items list"): rewrite it for each amendment to name the texts THAT
 * amendment changes — here and in tos-change-notice.tsx together (legal-amendment-notice.test.ts holds them word
 * for word).
 */
export const AMENDMENT_NOTICE = {
  en: {
    title: 'Our terms have been amended',
    body: `Our Terms of Service have been amended. The changes take effect on ${AMENDED.inForceEn}.`,
  },
  vi: {
    title: 'Điều khoản đã được sửa đổi',
    body: `Điều khoản dịch vụ đã được sửa đổi. Nội dung sửa đổi có hiệu lực từ ngày ${AMENDED.inForceVi}.`,
  },
} as const

/**
 * One row per account per amendment, BY CONSTRUCTION: the id is derived, so a second run (or a re-run
 * after a crash) conflicts on the primary key instead of notifying anyone twice. It is also what makes a
 * retraction exact: a row is this script's iff its id is this prefix followed by its own recipient's id.
 */
export const noticeIdPrefix = (published: string) => `legal-amendment-${published}-`
export const AMENDMENT_NOTICE_ID_PREFIX = noticeIdPrefix(LEGAL_AMENDMENT.published)

/** Midnight in Vietnam (UTC+7, no DST) at the start of an ISO date. */
const vnMidnight = (iso: string) => Date.parse(`${iso}T00:00:00+07:00`)

/**
 * May the notice be sent at `now`? Only inside the notice window: before the publication day the texts
 * it announces are not published yet, and from the in-force instant it would announce a change that has
 * already happened — a notice with no notice period left. An immediate amendment has no window at all.
 */
export function noticeSendable(now: Date, a: LegalAmendment = LEGAL_AMENDMENT): { ok: true } | { ok: false; reason: string } {
  if (a.immediate) {
    return { ok: false, reason: `the amendment published on ${a.published} is immediate (in force the same day, owner's decision) — there is no notice window and nothing to announce` }
  }
  const t = now.getTime()
  if (!Number.isFinite(t)) return { ok: false, reason: 'unreadable clock' }
  if (t < vnMidnight(a.published)) {
    return { ok: false, reason: `the amendment is published on ${a.published} (Vietnam time) — deploy it first, then send` }
  }
  if (t >= vnMidnight(a.inForce)) {
    return { ok: false, reason: `the amendment took effect on ${a.inForce}; the notice window is over` }
  }
  return { ok: true }
}

/**
 * May the notices already sent for this amendment be DELETED (`--retract --apply`)? Only when it is
 * immediate: a notice of a real window is the announcement Quy chế Article 15 promises, and retracting it
 * would take that promise back. For an immediate amendment the sent notice names an in-force date that is
 * no longer true, and nothing replaces it — the owner decided there is nothing to announce.
 *
 * `published` is the date the rows were SENT under (the script's --published). It may differ from
 * a.published only when this same amendment was re-dated because its deploy slipped past midnight — so it
 * must fall 1 to MIN_NOTICE_DAYS + 1 days BEFORE a.published (the windowed version it replaced was in force
 * at least that many days after its own publication; past that, its notice came true). Any other date names
 * ANOTHER amendment's notices, which `a.immediate` says nothing about — refused (2026-10-01 review).
 */
export function retractable(a: LegalAmendment = LEGAL_AMENDMENT, published: string = a.published): { ok: true } | { ok: false; reason: string } {
  if (!a.immediate) {
    return { ok: false, reason: `the amendment published on ${a.published} has a notice window (in force ${a.inForce}); its notice is the announcement the Quy chế promises — not retracting it` }
  }
  if (published === a.published) return { ok: true }
  const back = daysBetween(published, a.published)
  return back >= 1 && back <= MIN_NOTICE_DAYS + 1
    ? { ok: true }
    : { ok: false, reason: `--published=${published} names another amendment's notices — only this amendment's own batch, sent under a date 1–${MIN_NOTICE_DAYS + 1} days before its publication date ${a.published} (re-dated after its deploy slipped), can be retracted` }
}
