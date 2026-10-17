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
 * And 2026-10-16 as well (the deploy day of the KYC trust input and the teacher's "Identity verified" mark — efc3e64c9,
 * LIVE 2026-10-16; owner 2026-10-15: not material, live with the deploy): a verified identity counts toward the trust
 * score while it is current — every account, both editions (the identity and trust paragraphs; "a selfie"; "điểm uy tín"
 * throughout the Vietnamese) — and the teacher's "Identity verified" mark on the profile, its card in lists and the chats
 * about it (the teacher paragraph and its consent purpose), an OPT-IN in that deploy and automatic since (next).
 * And 2026-10-16 again (planned — the deploy day of the AUTOMATIC mark; owner 2026-10-16: "if they verify it should be
 * auto not need to ask they consent by uploading kyc", the identity-v1 cohort "Show theirs too", and the 5-day
 * material-change promise "On deploy" — treated as NOT material, the owner's call, recorded with counsel's questions in
 * docs/compliance/pdpl-dossier-draft.md): the identity paragraph's pointer; the teacher paragraph (shown while current
 * and the name matches, never the document, the identity declaration — identity-v2's clause 5 — as its consent and
 * record, the identity-v1 cohort shown on the same terms and told so, hidden at any time — before publishing too — and
 * what is recorded); the consent purpose; and the general "each is off until you turn it on", which now carves the mark
 * out by name. Live with its deploy.
 * ⛔ If that deploy is not on 2026-10-16, re-date in its commit: this; identity-v2's `effective`
 * (src/lib/compliance/declaration-text.ts — not hashed, so no record moves); the day /privacy gives as the earlier
 * declaration's last ("used until 16 October 2026" / "dùng đến ngày 16 tháng 10 năm 2026", in the teacher paragraph and
 * the consent purpose — page.test.tsx fails until it equals `effective`); then the fingerprint below. ⚠️ The deploy gate
 * cannot catch a forgotten re-date this time: production (efc3e64c9) already carries 2026-10-16, so an unchanged value
 * passes as "already live" and the page would print a stale "Last updated".
 * And 2026-10-16 (planned — the deploy day of speed plan item 5, owner 2026-10-16: "Anonymous, no consent", live with
 * the deploy): the "Page speed measurements" paragraph — anonymous daily totals of load and response times, counted
 * whatever the Analytics choice, like the sign-up reminder counts. ⛔ The value below did NOT change for it — and the
 * deploy gate only checks the day when the value DIFFERS from the deployed commit's (already 2026-10-16 there) — so it
 * cannot notice a slip: if item 5 deploys on a later Vietnamese day, re-date this to THAT day (and retake the fingerprint).
 * And 2026-10-17 (planned — the deploy day of teacher onboarding v3, owner 2026-10-16: "remove linkedin login and
 * profile read only from cv is enough … check uploaded profile pictures so it clearly shows face of the teacher … the cv
 * info like number and cv itself stays as default"): Sign in with LinkedIn is GONE (its recipients row, the account
 * information, the D14 mentions, the cookie note and the withdrawal paragraph — it was never switched on, so nobody's data
 * is affected); the CV reader no longer names a LinkedIn PDF, fills the phone into an empty field and attaches a PDF as
 * the private CV; and the teacher profile photo check (Google Gemini: a real photo showing a face) — the Google row, the
 * teacher paragraph and an automated-decision paragraph with its human route. And "Continue with Facebook" (owner, the same
 * day: "if needed add sign in with facebook"): its Meta recipients row, the account information, and Facebook among the
 * sign-in choices the sign-up counters name — dark until GoTrue has it on, so it describes a choice nobody can make
 * before the owner configures it — and the sign-up counters now also total the teacher profile form's first step and its
 * publishes (the same anonymous daily totals; signup-prompt.ts TEACHER_FORM_EVENTS). Live with the deploy — the photo check is the moderation of a listing photo the policy
 * already names (purpose 2, performance of contract); the rest removes, describes or adds an optional way to sign in.
 * ⛔ Re-date with the deploy, as above.
 * And 2026-10-17 again (the deploy day of the teacher funnel's measurement — owner 2026-10-17: "rest recommended", the
 * bounce study's "count what is invisible", then "deploy" that evening): the "Sign-up reminder counts" paragraph now also
 * names the teacher form's later steps reached, the intro video chosen / turned down in the browser / not prepared or uploaded / uploaded,
 * Publish tapped / refused (for the video, the photo, the kind of work or another answer) / did not go through, "Open in
 * Safari" or "Open in your browser" tapped, and — with step 1's Continue — the coarse source of the link (an ad's, a
 * Facebook group's, Zalo's, another, none; read from the page's own address, never stored apart from the total). The
 * same anonymous daily totals and classes; live with the deploy (it describes counting, no new recipient or purpose).
 * ⚠️ Production already carries 2026-10-17 (onboarding v3's deploy), so the gate passes this as "already live": if this
 * deploy slips past 2026-10-17 in Vietnam, re-date it to its day by hand and retake the fingerprint.
 *
 * ⛔ THE DAY THE DEPLOY THAT CARRIES THOSE PARAGRAPHS ACTUALLY RUNS — set in THAT deploy's commit. The value below is
 * the PLANNED day, not a fact, and infra/vn-node/legal-amendment-gate.sh holds it to the truth: a deploy whose value
 * differs from the deployed commit's PUBLISHES it, and refuses unless today in Vietnam is that day (re-date it,
 * commit, re-run — or PRIVACY_TEXT_ACK=<date> for a text that really went live then). Keep the declaration on one
 * line, `export const PRIVACY_TEXT_PUBLISHED: string = 'YYYY-MM-DD'`: that is the shape the gate reads.
 * ⚠️ Typed, never read from the clock: the page prerenders, and a build-time date would move with every rebuild.
 */
export const PRIVACY_TEXT_PUBLISHED: string = '2026-10-17'

/**
 * ⛔ THE TEXT THAT DATE DATES — a fingerprint of /privacy as rendered (both editions, English and Vietnamese), checked
 * by src/app/[lang]/privacy/page.test.tsx (commit gate B2: the deploy gate holds the DAY, nothing held the TEXT, so an
 * edit that left the date alone shipped under a stale "Last updated"). A change to the policy fails that test until it
 * decides its date: outside a legal amendment, re-date PRIVACY_TEXT_PUBLISHED to the day it deploys; then paste the
 * fingerprint the failure prints here, in the same commit.
 */
export const PRIVACY_TEXT_FINGERPRINT = '83c886fc31028c88'
