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
 * immediate; its own record, PRIVACY_AMENDMENT, was dropped for this one). And 2026-10-11: the Meta row names
 * publishing a teacher profile among the actions reported (it is a listing posted — api/teachers/me PUT; deployed
 * c4b833d6e, 2026-10-11 20:03 in Vietnam). And 2026-10-12, in the deploy that carries this date: the unfinished
 * teacher profile saved to the account — the "Teacher profiles" paragraph, the on-device row and the sign-out line
 * (owner: live with the deploy, no 5-day notice — "Live with the deploy"). And, the same day (2026-10-12): TikTok as
 * a recipient (a new teacher profile's sign-up, sent by our server) — its recipients row, the Advertising paragraph and
 * the cross-border list; the consent card names TikTok the same day (CONSENT_COPY_VERSION).
 * ⛔ If that deploy slips past 2026-10-12, re-date BOTH this and TIKTOK_NAMED_FROM_S (src/lib/tiktok-consent.ts).
 * And 2026-10-13: the teacher DM ladder (owner — "Notify + privacy") — any signed-in account may message teachers, within
 * a daily limit set by identity / business verification, two messages until the teacher replies, the writer's
 * verification shown to the teacher; shared details and the private video go to "the account you are talking to"; the
 * identity-verification paragraph names the new use of the result. Deployed 2026-10-13 (b4d398f74); the teachers were
 * told the same day by a one-off in-app notice (37, no email — owner), whose route was then removed.
 * And 2026-10-15 (planned — the deploy day of the e-Visa subcategory, owner 2026-10-14: open to any seller on both
 * editions, live after eno's licence check): the shared "Messages to e-Visa sellers" paragraph and the partner e-Visa
 * section's narrowed first sentence — live with the deploy, no notice window (they describe what chat already does).
 * The /prohibited amendment in the same deploy has its own record and window (PROHIBITED_AMENDMENT).
 * And 2026-10-16 (planned — the deploy day of the teacher CV reader and Sign in with LinkedIn, owner 2026-10-15: "Add
 * LinkedIn sign-in too", "Gemini on Vertex"): Google reading a CV the teacher chooses (its recipients row, the teacher
 * paragraph, automated decisions), LinkedIn as a recipient (its row, the account information, withdrawing it), and the
 * email hash never sent for a LinkedIn account (D14). Live with the deploy — they describe new, opt-in features.
 * ⛔ If that deploy slips past 2026-10-16, re-date this (the deploy gate refuses until it matches the day).
 *
 * ⛔ THE DAY THE DEPLOY THAT CARRIES THOSE PARAGRAPHS ACTUALLY RUNS — set in THAT deploy's commit. The value below is
 * the PLANNED day, not a fact, and infra/vn-node/legal-amendment-gate.sh holds it to the truth: a deploy whose value
 * differs from the deployed commit's PUBLISHES it, and refuses unless today in Vietnam is that day (re-date it,
 * commit, re-run — or PRIVACY_TEXT_ACK=<date> for a text that really went live then). Keep the declaration on one
 * line, `export const PRIVACY_TEXT_PUBLISHED: string = 'YYYY-MM-DD'`: that is the shape the gate reads.
 * ⚠️ Typed, never read from the clock: the page prerenders, and a build-time date would move with every rebuild.
 */
export const PRIVACY_TEXT_PUBLISHED: string = '2026-10-16'

/**
 * ⛔ THE TEXT THAT DATE DATES — a fingerprint of /privacy as rendered (both editions, English and Vietnamese), checked
 * by src/app/[lang]/privacy/page.test.tsx (commit gate B2: the deploy gate holds the DAY, nothing held the TEXT, so an
 * edit that left the date alone shipped under a stale "Last updated"). A change to the policy fails that test until it
 * decides its date: outside a legal amendment, re-date PRIVACY_TEXT_PUBLISHED to the day it deploys; then paste the
 * fingerprint the failure prints here, in the same commit.
 */
export const PRIVACY_TEXT_FINGERPRINT = 'e944c8bdd3ff370b'
