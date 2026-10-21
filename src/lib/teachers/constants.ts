/**
 * Teachers (owner, 2026-09-30) — shared constants. Import-free so client components, the proxy and
 * server code can all read them.
 */
export const TEACHERS_CATEGORY_SLUG = 'teachers'
/** The category's English name as seeded (src/lib/taxonomy.ts) — what a listing's Meta conversion reports as its category. */
export const TEACHERS_CATEGORY_NAME = 'Teachers'
export const TEACHER_LISTING_TYPE = 'teacher'
/**
 * The category plates that carry the teacher form's door — "Create a teacher profile" (or the viewer's own / "Continue")
 * — on the home rail and the phone's compact row: Teachers (owner, 2026-10-09) and Jobs (owner, 2026-10-12: "add here
 * create a teacher profile button somewhere nicely so teachers who want to create profile will find it" — a teacher
 * browsing work had posted themselves as a job ad).
 */
export const TEACHER_DOOR_CATEGORIES: readonly string[] = [TEACHERS_CATEGORY_SLUG, 'jobs']
/** The subdomain label that serves the teacher sign-up form (teacher.eno.vn). */
export const TEACHER_SUBDOMAIN = 'teacher'
/**
 * The home page's "Find a teacher" shelf (owner, 2026-10-13: "make teacher profiles more visible on the home page" —
 * the option picked was a shelf after the feed's first twelve listings): how many teacher cards it holds at most.
 * Eight is two pages of the widest row (four cards from `lg`). The 3-card floor is the rails' own MIN_RAIL_ITEMS,
 * applied client-side (teacher-shelf.tsx), so there is no second constant for it.
 */
export const HOME_TEACHER_SHELF_TAKE = 8
/**
 * ⛔ LISTINGS THE HOME SHELF NEVER SHOWS, BY ID. One today: the owner's DEMO teacher profile, created 2026-10-08 on the
 * owner's own business account (seller ENO COMPANY LIMITED) — a real name with mock details and "Demo profile" in its
 * headline. It is not a teacher a school can hire, and its high-trust business seller would likely rank it FIRST.
 * By its id, not by "no business accounts": an account's type is never switched (src/lib/core/first-onboarding.ts), so a rule on
 * the type would silently hide every real teacher who holds a business account. If the owner deletes the demo, this
 * entry can go.
 */
export const HOME_HIDDEN_TEACHER_LISTING_IDS = ['cmuzccru60000wvq4mojalida'] as const
/**
 * teacher.eno.vn has no session (cookies are host-scoped), so its half of the form hands the draft to
 * eno.vn in the URL FRAGMENT: `https://eno.vn/teachers/join#d=<base64url JSON>`. A fragment never
 * reaches any server, so there is no anonymous write endpoint and no origin-guard exemption.
 */
export const TEACHER_DRAFT_HASH_KEY = 'd'

/**
 * THE INTRO VIDEO IS REQUIRED "FROM NOW ON" (owner, 2026-10-16: "make short intor video mandatory from now on"). Every NEW
 * profile needs one to publish, and a profile created from this moment on keeps one — it can be replaced, never removed.
 * Profiles created before it keep the old rule (optional): 67 of the 84 live on 2026-10-16 had none.
 * ⛔ THE DAY AFTER THE DEPLOY, 00:00 ICT — and re-dated if the deploy slips, like PRIVACY_TEXT_PUBLISHED: a profile made
 * on the deploy day under the OLD code (no video) must never be held to "keep it" (plan review, 2026-10-16). Creating
 * always needs the video, whatever this date; it decides only who may later remove one.
 */
export const TEACHER_VIDEO_REQUIRED_FROM = '2026-10-18T00:00:00+07:00'
/**
 * Must this SAVED profile keep its intro video — was it created since the cutoff? (A new profile always needs one: the
 * caller says "no profile yet" itself.) An unknown creation time is an old profile: an edit is never blocked on a guess.
 */
export function videoRequiredSince(createdAt: Date | string | null | undefined): boolean {
  if (createdAt === null || createdAt === undefined) return false
  const t = new Date(createdAt).getTime()
  return Number.isFinite(t) && t >= Date.parse(TEACHER_VIDEO_REQUIRED_FROM)
}

/**
 * THE CV IS REQUIRED "FROM NOW ON" (owner, 2026-10-21: "when teacher creates profile it says cv is optional, its not they
 * should include cv"). Every NEW profile publishes with one, and a profile created from this moment on keeps one — it can
 * be replaced, never removed (DELETE /api/teachers/me/cv → 409 cv_required). Profiles created before it keep the old rule
 * (optional): 32 of the 124 live on 2026-10-21 had none.
 * ⛔ ENFORCED BY THE SERVER AT CREATE, NOT BY THE FORM (two refuting plan reviews, 2026-10-21): the join form uploads the
 * PDF BEFORE the PUT (POST /api/teachers/me/cv?pending=1) and the save that creates the profile attaches it in its own
 * transaction (publish.ts) — the intro video's precedent. A form-only rule left a live profile with no CV whenever the
 * upload after the PUT failed, was refused, or came from a tab opened before the rule.
 * ⛔ THE DAY AFTER THE DEPLOY, 00:00 ICT — and re-dated in the deploy commit if the deploy slips, like the video's: a
 * profile made on the deploy day under the OLD code (no CV) must never be held to "keep it". Creating always needs the CV,
 * whatever this date; it decides only who may later remove one.
 */
export const TEACHER_CV_REQUIRED_FROM = '2026-10-23T00:00:00+07:00'
/**
 * Must this SAVED profile keep its CV — was it created since the cutoff? (A new profile always needs one: the caller says
 * "no profile yet" itself.) An unknown creation time is an old profile: an edit is never blocked on a guess.
 */
export function cvRequiredSince(createdAt: Date | string | null | undefined): boolean {
  if (createdAt === null || createdAt === undefined) return false
  const t = new Date(createdAt).getTime()
  return Number.isFinite(t) && t >= Date.parse(TEACHER_CV_REQUIRED_FROM)
}
/**
 * The CV's ceiling, 10 MB — ONE number: the upload route's (cv-store.ts MAX_CV_BYTES is this), the private bucket's own
 * file_size_limit (scripts/teachers-ddl.mjs) and the form's check at pick time (a file that can never go up is said when
 * it is picked, not at Publish). Here because this file is import-free: the client reads it.
 */
export const TEACHER_CV_MAX_BYTES = 10 * 1024 * 1024
/**
 * A pending CV upload's token (POST /api/teachers/me/cv?pending=1 answers it as `cvUpload`; the first Publish names it):
 * exactly the lower-case UUID v4 node's randomUUID() mints — anything else is no token. ⛔ Only this crosses the wire,
 * never a path: the server rebuilds `<Profile.id>/<token>.pdf` from the caller's own id (cv-store.ts cvPathFor).
 */
export function isCvUploadToken(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
}

/**
 * ⛔ THE "IDENTITY VERIFIED" RULE AND NOTICE VERSION (owner, 2026-10-15; AUTOMATIC since 2026-10-16) — the version of the
 * words shown beside the teacher's switch (the IdentityMarkNote on Photo & publish: what the mark shows, where — the
 * profile, its card in lists, the chip a school or member sees in chat — to whom, on which conditions, that it never shows
 * the document, and that it can be hidden), AND the value a card's display cache carries (Listing.identityMarkNotice).
 * Since 2026-10-16 the mark is AUTOMATIC (src/lib/teachers/identity-mark.ts): the consent is the identity declaration,
 * so this version no longer gates whether the mark shows — a SHOW-again records it (TeacherProfile.
 * identityMarkNoticeVersion: the words on screen when the teacher last chose to show it), and the card cache carries it.
 * '2026-10-16' was the opt-in's notice; '2026-10-16-auto' is the automatic rule's — distinct, so a record says which
 * words a teacher saw.
 * ⛔ BUMP IT WHEN THOSE WORDS' MEANING, OR THE RULE, CHANGES — and know what a bump does: a card shows the tick only while
 * its cache equals THIS value (serialize.ts), and the public surfaces skip the live read unless it does
 * (identityMarkShownOnCard), so a bump takes the tick off EVERY card and profile line at once until re-derived.
 * ⚠️ AFTER A BUMP DEPLOY, run /api/cron/identity-marks once (`?dryRun=1` first) — its card pass selects every identity
 * holder, re-derives each card and purges the pages (the ISR cache survives a deploy) — or /api/cron/identity-reconcile,
 * whose loop does the same with the full recompute. Either is the backfill; unattended, the 00:05 ICT identity-marks run
 * does it (and the 09:05 reconcile again).
 * Here, not in profile.ts, because this file is import-free (the card serializer reads it); profile.ts re-exports it
 * beside PUBLISH_NOTICE_VERSION.
 */
export const IDENTITY_MARK_NOTICE_VERSION = '2026-10-16-auto'

/**
 * ⛔ HOW MANY NEW TEACHERS AN ACCOUNT MAY START A CHAT WITH PER DAY (owner, 2026-10-13: "an account without
 * verification can do 3 DMs a day if wants more ask to KYC so they can DM up to 10 accounts a day and if wants more ask
 * them to register as business and go through business kyc then 30 dms a day"). The ladder replaced the 2026-09-30
 * rule that only business accounts could message a teacher (owner, same day: "Anyone"). A day is the Vietnam calendar
 * day; only a NEW teacher counts — replies and re-opening a chat never do. The rules: src/lib/teachers/dm-quota.ts.
 *   · unverified — any account (individual, business without verification): 3
 *   · identity   — the account's identity check (KYC) is live: 10
 *   · business   — a business account whose business verification is live AND whose identity check is live: 30
 *   · revoked    — the identity was revoked (confirmed fraud or an authority order): 0, no way up
 */
export const TEACHER_DM_LIMITS = { revoked: 0, unverified: 3, identity: 10, business: 30 } as const
export type TeacherDmTier = keyof typeof TEACHER_DM_LIMITS
/**
 * Throwaway accounts (owner, 2026-10-13: "Phone later + IP pool"): while phone sign-in is off (auth-policy.ts
 * PHONE_OTP_ENABLED), the UNVERIFIED accounts on one internet connection share this many new teacher chats a day. Once
 * phone sign-in is back, an unverified account needs a confirmed phone number instead, and the pool stops applying.
 */
export const TEACHER_DM_IP_POOL = 6
/** A teacher who has not answered gets at most this many messages from the person who wrote (owner, 2026-10-13: "2 until reply"). */
export const TEACHER_UNANSWERED_MAX = 2
/** The step that raises the limit — what the refusal offers. */
export type TeacherDmNext =
  | 'verify_identity' | 'identity_pending' | 'renew_identity' | 'add_phone'
  | 'switch_to_business' | 'verify_business' | 'business_pending' | 'renew_business'
  | 'tomorrow' | 'none'
