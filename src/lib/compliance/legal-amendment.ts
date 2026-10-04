// ── The October 2026 amendment of the published legal texts — its dates, typed ONCE ──────────────
//
// ⛔ `published` MUST BE THE DAY THE AMENDMENT IS ACTUALLY DEPLOYED, NOT THE DAY IT WAS WRITTEN.
// Deploys happen only on the owner's word (CLAUDE.md), so both dates are set on the deploy day, here
// and nowhere else: /regulations (META + Article 17), /terms ("Last updated" + the change note),
// /returns (meta, changes section), /prohibited and /privacy read them.
// A page that typed its own date drifted from the others the first time one was corrected.
// ⚠️ /legal/ranking NO LONGER READS THEM (2026-10-04): the ranking disclosure follows the CODE and changes
// between amendments, so it prints its own date — RANKING_DISCLOSURE_UPDATED in ranking-disclosure.ts,
// also set on the deploy day. Never move these dates to re-date that page.
//
// ⛔ `inForce` IS ALSO A RUNTIME SWITCH, NOT ONLY A PRINTED DATE. src/lib/site-legal.ts derives
// TOS_EFFECTIVE_AT from it (midnight Vietnam time), and that instant decides which Terms version
// onboarding stamps on Profile.tosVersion (tosVersionInForce), what /terms and /md/terms headline as
// "in force", and whether a notice window exists at all (tosInNoticeWindow — the site-wide strip,
// tos-change-notice.tsx, and the bell notice, legal-amendment-notice.ts). Moving it moves all of those
// at once — which is the point, and also why it must never be edited casually.
//
// ⚠️ THE DEFAULT: inForce ≥ published + 6 CALENDAR DAYS. The texts promise at least 5 days' notice, and
// under the Civil Code 2015 Art 147–148 the day of publication is not counted: published 01/10 → notice
// runs 02/10–06/10 → in force 07/10. amendmentDatesProblem() below refuses a shorter gap, and so does the
// deploy gate (infra/vn-node/legal-amendment-gate.sh).
//
// ⛔ THE ONE EXCEPTION IS `immediate: true` — AN OWNER'S DECISION, NEVER A CONVENIENCE. It means "in force
// on the day it is published, no notice window, no announcement": inForce MUST equal published, nothing
// is announced (no strip, no bell notice), and the deploy gate wants LEGAL_AMENDMENT_IMMEDIATE=<published>
// on top of the publication-day rule. The October 2026 amendment is one (below). The next amendment drops
// the flag and gets its 6 days again unless the owner decides otherwise for THAT amendment.
//
// ⚠️ TYPED, NEVER READ FROM THE CLOCK: these pages prerender, and a build-time date moves with every
// rebuild.

export type LegalAmendment = {
  /** ISO date (Vietnam) the amended texts went live. */
  readonly published: string
  /** ISO date (Vietnam) they bind from — midnight Vietnam time. */
  readonly inForce: string
  /** Owner-decided: in force on publication, no notice window. Requires inForce === published. */
  readonly immediate?: true
}

export const LEGAL_AMENDMENT: LegalAmendment = {
  published: '2026-10-01',
  inForce: '2026-10-01',
  // ⛔ OWNER, 2026-10-01 (~18:00 Vietnam), quoting the site-wide strip that announced 07/10/2026: "just
  // change now we dont have users so its safe to implement just new terms no need for announcement".
  // It shipped earlier that day with a 6-day window (110295be: published 01/10, in force 07/10); this makes
  // version 2 binding from 01/10 with no window. Scoped to THIS amendment — do not copy it forward.
  immediate: true,
}

/** The advance notice the texts promise (Quy chế Art 15, Terms "Changes"). */
export const MIN_NOTICE_DAYS = 5

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function parts(iso: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) throw new Error(`legal-amendment: not an ISO date: ${iso}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** 2026-10-07 → "07/10/2026" — the Vietnamese legal form. */
export function dateVi(iso: string): string {
  const [y, mo, d] = parts(iso)
  return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`
}

/** 2026-10-07 → "7 October 2026". */
export function dateEn(iso: string): string {
  const [y, mo, d] = parts(iso)
  return `${d} ${MONTHS_EN[mo - 1]} ${y}`
}

/** Both dates of an amendment in both printed forms. */
export function amendedDates(a: LegalAmendment) {
  return {
    publishedVi: dateVi(a.published),
    publishedEn: dateEn(a.published),
    inForceVi: dateVi(a.inForce),
    inForceEn: dateEn(a.inForce),
  } as const
}

export const AMENDED = amendedDates(LEGAL_AMENDMENT)

/** Days from one ISO date to another (UTC calendar arithmetic — both are plain dates). */
export const daysBetween = (from: string, to: string) => {
  const [y1, m1, d1] = parts(from)
  const [y2, m2, d2] = parts(to)
  return (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000
}

/**
 * Why an amendment's dates are not acceptable, or null. The rule legal-amendment.test.ts and the deploy
 * gate (legal-amendment-gate.sh) both hold: by default at least MIN_NOTICE_DAYS clear days between
 * publication and the in-force date (publication day not counted → inForce ≥ published + 6); with
 * `immediate`, the two dates must be EQUAL — equal dates are allowed only then.
 */
export function amendmentDatesProblem(a: LegalAmendment): string | null {
  const gap = daysBetween(a.published, a.inForce)
  if (a.immediate) {
    return gap === 0 ? null : `an immediate amendment is in force on its publication day: inForce ${a.inForce} must equal published ${a.published}`
  }
  return gap >= MIN_NOTICE_DAYS + 1
    ? null
    : `in force ${a.inForce} is only ${gap} day(s) after publication ${a.published}; at least ${MIN_NOTICE_DAYS + 1} are needed for ${MIN_NOTICE_DAYS} clear days' notice (or an owner-decided immediate: true with equal dates)`
}
