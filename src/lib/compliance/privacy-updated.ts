/**
 * /privacy's OWN publication date — for a change to the policy that ships OUTSIDE a legal amendment (D12, owner
 * 2026-10-08: one dated /privacy update, shipped with the Sign in with Apple dark deploy).
 *
 * The policy prints "Last updated" as the LATER of this and LEGAL_AMENDMENT.published (src/app/[lang]/privacy/page.tsx),
 * so a Terms amendment that re-dates /privacy still does, and a policy change between amendments carries its own
 * day — the RANKING_DISCLOSURE_UPDATED precedent (ranking-disclosure.ts).
 * What it dates today: the Sign in with Apple rows (Apple as a recipient, the account information, no email hash to
 * Meta for an Apple account or a relay address, Apple among the sign-in choices counted) and the teacher-profile
 * paragraph — none of them part of an amendment. And, the same Vietnamese day (2026-10-09), teacher job matching: the
 * Anthropic (Claude) recipient row, its purpose and the automated-decisions paragraph (owner: "apply recommended" —
 * immediate; its own record, PRIVACY_AMENDMENT, was dropped for this one).
 *
 * ⛔ THE DAY THE DEPLOY THAT CARRIES THOSE PARAGRAPHS ACTUALLY RUNS — set in THAT deploy's commit. The value below is
 * the PLANNED day, not a fact, and infra/vn-node/legal-amendment-gate.sh holds it to the truth: a deploy whose value
 * differs from the deployed commit's PUBLISHES it, and refuses unless today in Vietnam is that day (re-date it,
 * commit, re-run — or PRIVACY_TEXT_ACK=<date> for a text that really went live then). Keep the declaration on one
 * line, `export const PRIVACY_TEXT_PUBLISHED: string = 'YYYY-MM-DD'`: that is the shape the gate reads.
 * ⚠️ Typed, never read from the clock: the page prerenders, and a build-time date would move with every rebuild.
 */
export const PRIVACY_TEXT_PUBLISHED: string = '2026-10-09'

/**
 * ⛔ THE TEXT THAT DATE DATES — a fingerprint of /privacy as rendered (both editions, English and Vietnamese), checked
 * by src/app/[lang]/privacy/page.test.tsx (commit gate B2: the deploy gate holds the DAY, nothing held the TEXT, so an
 * edit that left the date alone shipped under a stale "Last updated"). A change to the policy fails that test until it
 * decides its date: outside a legal amendment, re-date PRIVACY_TEXT_PUBLISHED to the day it deploys; then paste the
 * fingerprint the failure prints here, in the same commit.
 */
export const PRIVACY_TEXT_FINGERPRINT = 'f7507f5f2cffd331'
