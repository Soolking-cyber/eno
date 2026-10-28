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
 * And 2026-10-18 (the deploy day of the teacher funnel's measurement — owner 2026-10-17: "rest recommended", the
 * bounce study's "count what is invisible", then "deploy" that evening; that deploy's box build hung past midnight in
 * Vietnam, so the text goes live on the 18th): the "Sign-up reminder counts" paragraph now also
 * names the teacher form's later steps reached, the intro video chosen / turned down in the browser / not prepared or uploaded / uploaded,
 * Publish tapped / refused (for the video, the photo, the kind of work or another answer) / did not go through, "Open in
 * Safari" or "Open in your browser" tapped, and — with step 1's Continue — the coarse source of the link (an ad's, a
 * Facebook group's, Zalo's, another, none; read from the page's own address, never stored apart from the total). The
 * same anonymous daily totals and classes; live with the deploy (it describes counting, no new recipient or purpose).
 * ⛔ The gate holds this one (production carries 2026-10-17): it refuses a deploy on any other Vietnamese day — re-date
 * it to that day and retake the fingerprint.
 * And the deploy day of TEACHER JOB MESSAGES (owner, 2026-10-20 — src/lib/teachers/job-dms): the "Job messages for
 * teachers" paragraph (the switch on its own page, the sources, the posts kept privately on our server and deleted 30 days
 * after we receive them, what of the profile is used, matched on our own server in Vietnam with no AI company abroad, the
 * caps, STOP, the one in-app invite), its consent purpose and its automated-decisions paragraph. Live with the deploy — a
 * new, opt-in feature, OFF until the teacher switches it on. Dated 2026-10-21 — still the PLANNED day: the owner said
 * "deploy" on 2026-10-21 (the first plan was 2026-10-20). Deployed on any other Vietnamese day, re-date it to that day in
 * the deploy's commit and retake the fingerprint (page.test.tsx says the value); the amendment gate refuses the deploy
 * until then. And the same day, in a later deploy (PLANNED for 2026-10-21 — the date stands): job messages are ON for
 * every teacher until they switch them off (owner: "turn on for all now and they can turn off after first one", then "On
 * for all today" over a 5-day notice — treated as not material, their call) — the paragraph's opening, its record and its
 * one notice, the purpose's basis ("as part of the teacher service", no longer consent) and the automated-decisions
 * opening. ⛔ Deployed on any later Vietnamese day, re-date both to that day, as above.
 * And 2026-10-22 (planned — the deploy day of two teacher changes, owner 2026-10-21: "add ai enhancement once they write
 * about them … use gemini 3.8 flash" and "it says cv is optional, its not they should include cv"): "Improve with AI"
 * under the teacher's About text — the Google row (what it receives: the About text without its contact-detail
 * sentences and the form's answers, never the name field, phone, email, photo, video, CV, salary, start date, cover
 * lessons or a consent; on the CV reader's terms) and its purpose, a teacher-paragraph passage (when it runs, the
 * suggestion replacing the form's text and published only with the profile, the consent and outcome records — counts,
 * never text — in the data export) and an automated-decisions paragraph; and the CV REQUIRED for a new teacher profile
 * — the teacher paragraph (a PDF of up to 10 MB uploaded at Publish, an upload no profile ends up using deleted
 * automatically, replaced at any time, deleted with the profile), the CV reader's "replace the CV on the last step", the
 * Google row's CV clause, and "the CV" among the counted Publish refusals (publish_refused_cv); and the Anthropic row's
 * about text "as the teacher saved them" (it may be a suggestion the teacher kept). Live with the deploy — the owner's
 * call: the rewrite is a new feature that runs only when the teacher asks (consent, recorded before anything is sent),
 * and the CV rule tightens what a new profile needs and changes no recipient (schools still get a CV only through the
 * Share tap).
 * ✅ That CV rule WENT LIVE on 2026-10-22, so its dates are facts now, no longer re-dated with this value:
 * TEACHER_CV_REQUIRED_FROM (src/lib/teachers/constants.ts) is 2026-10-23T00:00:00+07:00, and /privacy's "(a profile
 * created before 23 October 2026 can also remove it)" / "(hồ sơ tạo trước ngày 23 tháng 10 năm 2026 cũng có thể gỡ CV)"
 * are FIXED text — page.test.tsx pins all three as literals (until 2026-10-22 it derived them from this date). ⛔ A
 * later re-date of this value — the change below, or any after — must NEVER move them: a teacher who joined on the old
 * optional rule keeps the removal the policy promised.
 * ⇒ ENDED with the 2026-10-25 deploy (owner, 2026-10-25: "Allow removal"): every teacher may remove a CV, so the cutoff,
 *   its constant and both sentences are gone — the promise to older profiles is kept and extended to all.
 * And 2026-10-25 — decided on 2026-10-22, live with its own deploy three days later, the reason this value and the
 * day /privacy names were re-dated from the 22nd (owner, 2026-10-22 11:37 ICT: "also phone number is mandatory and all toggles should be on by default go"; asked, the phone
 * is "Everyone, on next save" and the toggles "On by default everywhere" — web and the native apps): the teacher PHONE
 * is required on every teacher-profile save — a new profile at Publish, an existing one without a phone the next time
 * it is saved, never for a save that only
 * hides the profile or switches something off (profile.ts phoneWaived) — and is never published, reaches a chat account
 * only through the Share tap, and is called by staff only while "Our staff may call me" is on; and the two JOB-MATCH
 * SWITCHES ("Email me jobs that match my profile", "Our staff may call me") are ON BY DEFAULT in the form of a NEW
 * teacher profile (an existing profile keeps its own choice), switched off at any time in the profile or from any
 * match email, with one 'teacher.optins.default' compliance record per new profile published with a default left on.
 * The Anthropic row and its purpose, the teacher paragraph, the consent purpose, the general basis's second carve-out and
 * the automated-decisions paragraph. Live with the deploy, NOT treated as material — no 5-day notice (the owner's call,
 * "live with the deploy"): the default is an accepted legal risk (PDP Law 91/2025 Art 9(4)(d), Decree 356/2025 Art 6(3),
 * Decree 91/2020 anti-spam, App Store 5.1.2(i)), recorded in docs/compliance/pdpl-dossier-draft.md
 * [OWNER DECISION 2026-10-22] with counsel's question (§8 question 15). AI_NOTICE_VERSION stays '2026-10-08': no
 * existing opt-in is asked again. The policy names the day in its own words ("since 25 October 2026" / "từ ngày 25
 * tháng 10 năm 2026" — the teacher paragraph, the consent purpose and the basis; a test derives them from this value) —
 * ⛔ if this deploy slips past 2026-10-25, re-date this value AND those words (and their pins in page.test.tsx and the
 * dossier's 25/10 dates) in the deploy's commit, then retake the fingerprint below; the CV dates above stay as they are.
 * And, LIVE on 2026-10-22 (deploy 7cb9dcba8), the way out first (owner 2026-10-22: "creatively route them to
 * normal browser"): the sign-up counters paragraph names the three new teacher-form totals — the screen offering the
 * browser shown, the visitor going on in the app, a page then opening in the browser from it (escape_shown /
 * escape_stay / escape_arrived — the same anonymous daily totals). Live with the deploy: no new data, no recipient.
 * It went live that day, under that day's date.
 * And 2026-10-25 as well, in a SECOND deploy that day — the phone's went live at ~14:35 ICT (2f31c854b) — so this text
 * must deploy on 2026-10-25 too, or re-date with its phone sentences pinned first (owner, 2026-10-22: "Publish before video/CV" — after the video and then the
 * CV became required, teachers publishing within a day fell 80% → 47% and real-browser publishes to a third): the teacher
 * paragraph's CV sentence — "A teacher profile can include a CV … you can upload it when you publish your profile or add it
 * later … you can replace or remove it at any time" (it said a new profile NEEDS one, and that only a profile created
 * before 23 October 2026 could remove it — owner, 2026-10-25: "Allow removal"; the cutoff text is gone with the rule),
 * and the CV-reading row's "which you can replace or remove at any time". Live with the deploy — it asks LESS of a
 * teacher and changes no recipient. It went live that day (deploy 495f3f20e, ~17:01 ICT).
 * And 2026-10-25 again — a THIRD deploy that day (planned for the 26th; owner at 23:03 ICT: "deploy now", so re-dated to the
 * day it runs) (owner, 2026-10-25: "Full fix" of Google inside an app's built-in browser — the pairing hand-off signed
 * in 2 of 62 visitors who started it): "Account information" says that choosing Google inside an app's browser opens the
 * page in the phone's own browser, and that the teacher form's step-1 answers wait on our server for that browser under a
 * link that works for 30 minutes — "delete them then, or otherwise within an hour" (src/lib/auth/carry.ts: dropped once
 * the form there has them; otherwise 30 minutes, then the 15-minute
 * kv_store sweep). New data held, for at most an hour, for the visitor's own continuation; no new recipient. The
 * job-match switches' "25 October 2026" became literal in page.test.tsx first (that deploy has run). In the same deploy
 * (owner, 2026-10-22: "VI visitors → See teachers"), the sign-up counters paragraph counts "how many times “See teachers”
 * was tapped in the teacher form or on that screen" (see_teachers — the same anonymous daily totals).
 *
 * And PLANNED for 2026-10-28 (owner, 2026-10-28: "ask for zalo number from teachers who opted in to cover … schools can
 * request their number and it can be show without them texting back. Schools can reveal 1 zalo number per day for more
 * they have to upload and go through business kyc"): the teacher paragraph's "only your Share tap" now names its ONE
 * exception — "Zalo for urgent cover (since 28 October 2026)": the teacher's own switch and number (usually the phone),
 * who may ask (a business account), the caps (zalo-rules.ts: 1 a day unverified, 2 per connection, 3 per teacher; 20
 * verified), the record of who saw it (TeacherZaloReveal, kept with the profile, the name kept after the account goes),
 * the in-app bell each time, and the deletion on switch-off or cover-off — plus, in "How long we keep your data", the
 * Zalo retention (the number while on; who saw it while the profile exists, the school's name kept after its account goes;
 * the connection code erased after the next day — zalo.ts sweepZalo). NEW DISCLOSURE, by the teacher's opt-in: the
 * deploy must carry it on the day the text says — ⛔ if it slips, re-date this value AND "28 October 2026" / "28 tháng 10
 * năm 2026" in the teacher paragraph and their pins in page.test.tsx, then retake the fingerprint.
 * ⛔ THE DAY THE DEPLOY THAT CARRIES THOSE PARAGRAPHS ACTUALLY RUNS — set in THAT deploy's commit. The value below is
 * the PLANNED day, not a fact, and infra/vn-node/legal-amendment-gate.sh holds it to the truth: a deploy whose value
 * differs from the deployed commit's PUBLISHES it, and refuses unless today in Vietnam is that day (re-date it,
 * commit, re-run — or PRIVACY_TEXT_ACK=<date> for a text that really went live then). Keep the declaration on one
 * line, `export const PRIVACY_TEXT_PUBLISHED: string = 'YYYY-MM-DD'`: that is the shape the gate reads.
 * ⚠️ Typed, never read from the clock: the page prerenders, and a build-time date would move with every rebuild.
 */
export const PRIVACY_TEXT_PUBLISHED: string = '2026-10-28'

/**
 * ⛔ THE TEXT THAT DATE DATES — a fingerprint of /privacy as rendered (both editions, English and Vietnamese), checked
 * by src/app/[lang]/privacy/page.test.tsx (commit gate B2: the deploy gate holds the DAY, nothing held the TEXT, so an
 * edit that left the date alone shipped under a stale "Last updated"). A change to the policy fails that test until it
 * decides its date: outside a legal amendment, re-date PRIVACY_TEXT_PUBLISHED to the day it deploys; then paste the
 * fingerprint the failure prints here, in the same commit.
 */
export const PRIVACY_TEXT_FINGERPRINT = 'bcedccbbcf0f256f'
