// ── The amendments of the published legal texts — their dates, typed ONCE ────────────────────────
//
// ⚠️ TWO RECORDS SINCE 2026-10-05, because the two amendments that stand did not change the same texts:
//   · LEGAL_AMENDMENT — the October 2026 amendment: Terms version 2, /returns, /prohibited, /privacy and
//     the Quy chế's version 2 with them (published and in force 01/10/2026). /terms ("Last updated" + the
//     change note), /returns (meta, changes section), /prohibited, /privacy and the Quy chế's FIRST
//     Article 17 entry (through legal-archive.ts V1_SUPERSEDED) read it, and it is the Terms' runtime
//     switch (below). The Quy chế-only amendment left it alone — its dates are still true of every text
//     it describes.
//   · REGULATIONS_AMENDMENT — the Quy chế's OWN newest amendment: version 3 (Article 14 — UX program 2's
//     ranking), which changed no other text. /regulations (META + Article 17's newest entry), the
//     /regulations/v2 archive ("replaced from …") and /legal/ranking's date (ranking-disclosure.ts
//     RANKING_DISCLOSURE_UPDATED, tied to it for this deploy) read it. It switches nothing at runtime:
//     Profile.tosVersion stamps the TERMS version, which this amendment did not change.
//   An amendment that changes both kinds of text (as October's did) sets BOTH records to its dates; a
//   Terms-only one moves LEGAL_AMENDMENT alone, a Quy chế-only one REGULATIONS_AMENDMENT alone. The deploy
//   gate (infra/vn-node/legal-amendment-gate.sh) holds EACH record to the same rules, independently.
//
// ⛔ `published` MUST BE THE DAY THE AMENDMENT IS ACTUALLY DEPLOYED, NOT THE DAY IT WAS WRITTEN.
// Deploys happen only on the owner's word (CLAUDE.md), so both dates are set on the deploy day, here
// and nowhere else. A page that typed its own date drifted from the others the first time one was
// corrected.
// ⚠️ /legal/ranking DOES NOT READ LEGAL_AMENDMENT (2026-10-04): the ranking disclosure follows the CODE and
// changes between amendments, so it prints its own date — RANKING_DISCLOSURE_UPDATED in
// ranking-disclosure.ts. Never move LEGAL_AMENDMENT's dates to re-date that page.
//
// ⛔ LEGAL_AMENDMENT's `inForce` IS ALSO A RUNTIME SWITCH, NOT ONLY A PRINTED DATE. src/lib/site-legal.ts derives
// TOS_EFFECTIVE_AT from it (midnight Vietnam time), and that instant decides which Terms version
// onboarding stamps on Profile.tosVersion (tosVersionInForce), what /terms and /md/terms headline as
// "in force", and whether a notice window exists at all (tosInNoticeWindow — the site-wide strip,
// tos-change-notice.tsx, and the bell notice, legal-amendment-notice.ts). Moving it moves all of those
// at once — which is the point, and also why it must never be edited casually.
// ⚠️ THE STRIP AND THE BELL NOTICE KNOW ONLY LEGAL_AMENDMENT. A Quy chế-only amendment WITH a notice window
// would be announced by nothing, breaking the very promise Article 15 makes — so until they learn
// REGULATIONS_AMENDMENT, that record is immediate or carries LEGAL_AMENDMENT's own dates
// (legal-amendment.test.ts fails otherwise).
//
// ⚠️ THE DEFAULT: inForce ≥ published + 6 CALENDAR DAYS. The texts promise at least 5 days' notice, and
// under the Civil Code 2015 Art 147–148 the day of publication is not counted: published 01/10 → notice
// runs 02/10–06/10 → in force 07/10. amendmentDatesProblem() below refuses a shorter gap, and so does the
// deploy gate (infra/vn-node/legal-amendment-gate.sh).
//
// ⛔ THE ONE EXCEPTION IS `immediate: true` — AN OWNER'S DECISION, NEVER A CONVENIENCE. It means "in force
// on the day it is published, no notice window, no announcement": inForce MUST equal published, nothing
// is announced (no strip, no bell notice), and the deploy gate wants LEGAL_AMENDMENT_IMMEDIATE=<published>
// on top of the publication-day rule. The October 2026 amendment is one, and so is the Quy chế's version 3
// (both below). The next amendment drops the flag and gets its 6 days again unless the owner decides
// otherwise for THAT amendment. Quy chế Article 15's 5-day promise stays in the text for every amendment
// after these.
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

/**
 * THE QUY CHẾ'S VERSION 3 — a Quy chế-only amendment of Article 14 (search and feed ranking as UX program 2
 * left it; the change list is Article 17's newest entry). The Terms stay at version 2 and LEGAL_AMENDMENT
 * keeps October's dates: nothing else was amended.
 *
 * ⛔ '2026-10-06' IS A PLACEHOLDER, NOT THE PUBLICATION DATE. The DEPLOYER sets BOTH dates to the real
 * deploy day (Vietnam time) in the commit that ships it — the same day, because it is immediate — and runs
 * the deploy with LEGAL_AMENDMENT_IMMEDIATE=<that day>; the gate refuses any other day and any deploy
 * without that ack. /legal/ranking's "Last updated" (RANKING_DISCLOSURE_UPDATED) is tied to `published`
 * here, so it moves with it — there is no second date to set.
 *
 * ⛔ OWNER, 2026-10-05: "apply best recommended" — the recommendation being the 2026-10-01 precedent (Terms
 * v2: "just change now we dont have users so its safe to implement just new terms no need for
 * announcement"): in force the day it is published, no notice window, no strip, no bell notice. Scoped to
 * THIS amendment — do not copy the flag forward.
 */
export const REGULATIONS_AMENDMENT: LegalAmendment = {
  published: '2026-10-06',
  inForce: '2026-10-06',
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

/** REGULATIONS_AMENDMENT's dates in both printed forms — what /regulations' META and newest Article 17 entry print. */
export const REGULATIONS_AMENDED = amendedDates(REGULATIONS_AMENDMENT)

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
