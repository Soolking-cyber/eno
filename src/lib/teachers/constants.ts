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
