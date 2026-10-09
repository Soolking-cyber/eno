// ── The amendments of the published legal texts — their dates, typed ONCE ────────────────────────
//
// ⚠️ THREE RECORDS (two since 2026-10-05, /privacy's own since 2026-10-08), because the amendments that stand did not
// change the same texts:
//   · LEGAL_AMENDMENT — the Terms' newest amendment: since 2026-10-07 the Terms' VERSION 3 (App Store
//     Guideline 1.2 — decision D8), which also dated the /privacy text that changed with it (until /privacy got its
//     own record, below). /terms ("Last updated", the "not yet in force" line, its change note), /md/terms, the
//     /terms/v2 banner (through legal-archive.ts TERMS_V2_SUPERSEDED_BY), the strip and the bell notice read it, and
//     it is the Terms' runtime switch (below).
//     ⚠️ IT USED TO BE THE OCTOBER 2026 AMENDMENT (Terms version 2, /returns, /prohibited, /privacy and the
//     Quy chế's version 2 with them — published and in force 01/10/2026, immediate). Re-using the record
//     for version 3 moved those dates out of it: they are LITERALS now, in legal-archive.ts
//     (V1_SUPERSEDED_BY), and every text version 3 did not change reads them there — /returns,
//     /prohibited, the Quy chế's FIRST Article 17 entry, the version-1 and version-2 archives and the
//     version-2 note in /terms' change log. A text that read LEGAL_AMENDMENT for a date version 3 did not
//     give it would now print 7 October for an October-1 change.
//   · REGULATIONS_AMENDMENT — the Quy chế's OWN newest amendment: version 3 (Article 14 — UX program 2's
//     ranking), which changed no other text. /regulations (META + Article 17's newest entry), the
//     /regulations/v2 archive ("replaced from …") and /legal/ranking's date (ranking-disclosure.ts
//     RANKING_DISCLOSURE_UPDATED, tied to it for this deploy) read it. It switches nothing at runtime:
//     Profile.tosVersion stamps the TERMS version, which this amendment did not change.
//   · PRIVACY_AMENDMENT — /privacy's OWN newest amendment (since 2026-10-08: the Anthropic (Claude) recipient row and
//     teacher job matching). /privacy's "Last updated" reads it (PRIVACY_AMENDED) and nothing else; it switches nothing
//     at runtime. Before it existed, /privacy changes rode the Terms' record — version 3 dated /privacy 07/10/2026.
//   An amendment that changes several kinds of text (as October's did) sets EACH of their records to its dates; a
//   Terms-only one moves LEGAL_AMENDMENT alone, a Quy chế-only one REGULATIONS_AMENDMENT alone, a privacy-only one
//   PRIVACY_AMENDMENT alone. The deploy gate (infra/vn-node/legal-amendment-gate.sh) holds EACH record to the same
//   rules, independently.
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
// (legal-amendment.test.ts fails otherwise). PRIVACY_AMENDMENT is held to the same rule: /privacy promises
// "material changes are announced at least 5 days before they take effect", and nothing announces its record.
//
// ⚠️ THE DEFAULT: inForce ≥ published + 6 CALENDAR DAYS. The texts promise at least 5 days' notice, and
// under the Civil Code 2015 Art 147–148 the day of publication is not counted: published 01/10 → notice
// runs 02/10–06/10 → in force 07/10. amendmentDatesProblem() below refuses a shorter gap, and so does the
// deploy gate (infra/vn-node/legal-amendment-gate.sh).
//
// ⛔ THE ONE EXCEPTION IS `immediate: true` — AN OWNER'S DECISION, NEVER A CONVENIENCE. It means "in force
// on the day it is published, no notice window, no announcement": inForce MUST equal published, nothing
// is announced (no strip, no bell notice), and the deploy gate wants LEGAL_AMENDMENT_IMMEDIATE=<published>
// on top of the publication-day rule. The October 2026 amendment was one, and so are the Quy chế's version 3
// and — owner, 2026-10-07 — the Terms' version 3 (both below). The next amendment drops the flag and gets its
// 6 days again unless the owner decides otherwise for THAT amendment. Quy chế Article 15's 5-day promise stays
// in the text for every amendment after these.
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

/**
 * THE TERMS' VERSION 3 — App Store Guideline 1.2 (decision D8, docs/ios-appstore-release.md): zero tolerance
 * for objectionable content and abusive users, a 24-hour review of those reports, and no chance to put it
 * right for them (/terms `conduct`, `complaints`, `termination`; the edits are listed in its `changes` note).
 * It also dated /privacy, whose text changed in the same deploy: the moderators' AI review of reports (the
 * Google row, "Automated decisions") and eno.vn's partner e-Visa section — /privacy reads PRIVACY_AMENDMENT since
 * 2026-10-08, so the Terms' next amendment no longer moves it. The Quy chế did not change —
 * REGULATIONS_AMENDMENT keeps its own dates — and neither did /returns or /prohibited (V1_SUPERSEDED_BY).
 *
 * ⛔ IMMEDIATE — THE OWNER'S DECISION (2026-10-07, on the record below): published AND in force 07/10/2026, from
 * midnight Vietnam time, with no notice window and no announcement — the 2026-10-01 precedent. From that
 * instant version 3 is the version in force (tosVersionInForce — onboarding stamps '3', /terms and /md/terms
 * headline version 3, and /terms' "not yet in force" line never renders); /terms' change note and the
 * /terms/v2 banner print their one-date variants on their own; <TosChangeNotice /> is NOT mounted in
 * providers.tsx (legal-amendment.test.ts holds the mount to the flag); and scripts/notify-legal-amendment.ts
 * refuses to send a bell notice. It was written with the default window (published 07/10, in force
 * 13/10/2026); the tests keep that machinery on fixtures, for the next amendment that has one.
 * ⛔ 2026-10-07 IS THE DAY IT IS MEANT TO SHIP, NOT YET A FACT: `published` must be the day it actually deploys
 * (Vietnam time). If that is another day, the deployer re-dates BOTH — to the same day, because it is
 * immediate — in the commit that ships it, and runs the deploy with LEGAL_AMENDMENT_IMMEDIATE=<that day>; the
 * deploy gate (legal-amendment-gate.sh) refuses any other day and any deploy without that ack.
 */
export const LEGAL_AMENDMENT: LegalAmendment = {
  published: '2026-10-07',
  inForce: '2026-10-07',
  // ⛔ OWNER, 2026-10-07 (AskUserQuestion: "When should that Terms change take effect?"): "Immediately
  // (Recommended)" — in force on the deploy day, no notice window, no announcement; the 2026-10-01 precedent.
  // It was planned with the default 6-day window (in force 13/10); this makes version 3 binding from its
  // publication day. The deploy runs with LEGAL_AMENDMENT_IMMEDIATE=2026-10-07. Scoped to THIS amendment — do
  // not copy it forward.
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
 * announcement") — and, confirmed explicitly at the deploy the same day: "deploy all no need for notice
 * now". In force the day it is published, no notice window, no strip, no bell notice. Scoped to THIS
 * amendment — do not copy the flag forward.
 */
export const REGULATIONS_AMENDMENT: LegalAmendment = {
  published: '2026-10-05',
  inForce: '2026-10-05',
  immediate: true,
}

/**
 * /PRIVACY'S OWN RECORD (2026-10-08, teacher job matching — plan review E4): the "Anthropic (Claude)" row in "Who else
 * receives your data", Anthropic in "Processing outside Vietnam", the teacher-matching purpose and its paragraph in
 * "Automated decisions". A privacy-only change: the Terms and the Quy chế keep their records (and the Terms' record,
 * LEGAL_AMENDMENT, is also the Terms' runtime switch — it must never move for a privacy change).
 *
 * ⛔ DATED THE DEPLOY DAY (owner, 2026-10-09: "also deploy" + "apply recommended") — BOTH dates are the day it ships
 * (Vietnam time), and the deploy runs with LEGAL_AMENDMENT_IMMEDIATE=2026-10-09; the deploy gate
 * (legal-amendment-gate.sh) refuses any other day and any deploy without that ack. A deploy that slips past the day
 * re-dates it (and only it) first.
 *
 * ⛔ IMMEDIATE — THE OWNER'S CALL, MADE 2026-10-09 ("apply recommended"). Why:
 * nothing announces a /privacy record (the strip and the bell notice know only LEGAL_AMENDMENT), so a windowed record
 * would promise a notice nobody gives; and the change binds no one who has not agreed to it afresh — the processing it
 * describes runs only for teachers who tick an opt-in under the new AI notice naming Anthropic (profile.ts
 * aiMatchConsented), never on an older tick. If the owner wants the 5-day window instead, the strip and the bell must
 * learn this record first (legal-amendment.test.ts holds that).
 */
export const PRIVACY_AMENDMENT: LegalAmendment = {
  published: '2026-10-09',
  inForce: '2026-10-09',
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

/** PRIVACY_AMENDMENT's dates in both printed forms — /privacy's "Last updated". */
export const PRIVACY_AMENDED = amendedDates(PRIVACY_AMENDMENT)

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
