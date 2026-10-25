import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { buildSearchText } from '@/lib/fold'
import { warmTranslations } from '@/lib/translate'
import { isListingImageUrl, listingObjectKey } from '@/lib/listing-image'
import { browseRankScore } from '@/lib/ranking'
import { moderateListingById } from '@/lib/ai-moderation'
import { initialSellerTrust } from '@/lib/trust'
import { assertSellerMayPublish } from '@/lib/compliance/seller-publish-gate'
import { PublishBlockedError } from '@/lib/publish-guard'
import { teacherTextRefusal } from '@/lib/teachers/text-screen'
import { deleteListingCore, parseVideoField } from '@/lib/core/listings'
import { clearTombstones, writeTombstones, type TombstoneRef } from '@/lib/core/storage-tombstones'
import { purgeStorageObjects } from '@/lib/core/storage-purge'
import { logError } from '@/lib/log'
import { appendAudit } from '@/lib/compliance/audit'
import { LISTING_VIDEOS_BUCKET, TEACHER_CVS_BUCKET, TEACHER_VIDEOS_BUCKET } from '@/lib/supabase-admin'
import { planVideoChange, type StoredVideo, type VideoBody, type VideoPlan } from '@/lib/teachers/video'
import {
  copyPrivateVideoToPublic, copyPublicVideoToPrivate, ownsPublicVideo, privateVideoPathFor, publicVideoKeyFor,
  removeUnreferencedPrivateVideos,
} from '@/lib/teachers/video-store'
import { IDENTITY_MARK_NOTICE_VERSION, TEACHERS_CATEGORY_SLUG, TEACHER_LISTING_TYPE, isCvUploadToken } from '@/lib/teachers/constants'
import { cvPathFor, safeCvFileName } from '@/lib/teachers/cv-store'
import { PhotoCheckUnavailable, recordPhotoRefusal, teacherPhotoKey, teacherPhotoVerdict } from '@/lib/teachers/photo-verdict'
import { districtPagesOf, revalidateTeacherPages } from '@/lib/teachers/revalidate'
import { IDENTITY_MARK_TP_SELECT, identityMarkHidden, identityMarkShownFor, identityMarkState, type IdentityMarkState } from '@/lib/teachers/identity-mark'
import { writeIdentityMarkCard } from '@/lib/teachers/identity-mark-card'
import {
  AI_NOTICE_VERSION, COVER_FIELDS, PUBLISH_NOTICE_VERSION, TEACHER_SITUATION_VERSION, coverIsPublic, hasTeachingGoal,
  isLegacyTeacherBody, normalizeCoverFields, normalizeForSave, normalizeTeacherInput, phoneWaived, splitGoalErrors,
  teacherFacetTokens, teacherFreeTextFields, validateTeacherInput, whereSkipped, type TeacherErrors, type TeacherInput,
  teacherCardPrice, teacherCardPriceFromSaved } from '@/lib/teachers/profile'
import { COVER_CONSENT_VERSION, coverStamp } from '@/lib/teachers/cover'
import { coverReachOf } from '@/lib/teachers/places'
import {
  teacherInputOfRow, teacherListingProjection, teacherMirrors, teacherSearchText, withoutCoverFacets,
} from '@/lib/teachers/projection'

/**
 * THE ONLY WRITER OF TEACHER LISTINGS (owner, 2026-09-30). Every generic create/update path refuses
 * the teachers category (NON_POSTING_CATEGORIES), so a teacher row always has a TeacherProfile and
 * derived — never client-supplied — facets.
 *
 * ⚠️ NOT createListingCore, deliberately: that core syndicates to eno's Facebook Page, fires a Meta
 * CAPI "Lead", indexes into the shared Vertex search and calls partner webhooks. A person's profile
 * must do none of those. What it DOES keep from that core: the identity gate, the trust gate, the
 * content screens, AI moderation and translation warming.
 *
 * ⛔ THE TEACHER'S PHONE NEVER GOES ON THE SELLER ROW. Seller.phone is what the generic contact route
 * reveals; the teacher's number lives only in TeacherPrivate, behind their "Share" tap.
 */

/**
 * The cover state changed since this form loaded it (another tab switched cover off, or on) — 409 `cover_changed`.
 * ⛔ THE ONE CONTRACT FOR STALE CLIENTS (gate review, 2026-10-07): an edit-mode save sends the stamp of the cover state
 * it loaded (cover.ts coverStamp — on/off, periods, areas, rate) as `coverBase`, and the save refuses under the account
 * lock when the stored state differs — rather than a stale tab re-enabling cover with a "fresh" consent after a
 * withdrawal, or writing back periods and areas the teacher removed in another window. A save with no base (the join
 * form) may not overwrite a cover that is ON (assertCoverBase).
 */
export class TeacherCoverConflictError extends Error {
  constructor() {
    super('cover_changed')
    this.name = 'TeacherCoverConflictError'
  }
}

/** `coverBase` from a request body: the coverStamp of the cover state the client loaded, when it sent one. */
const coverBaseOf = (raw: unknown): string | null => {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).coverBase : undefined
  return typeof v === 'string' ? v : null
}
const NO_COVER = { coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null }

/**
 * ⛔ THE STALE-CLIENT RULE, ONE FOR BOTH SAVES. A client that loaded a cover state sends its stamp, and it must match the
 * row read under the lock. A client that loaded none (the join form, or a body without `coverBase`) may not overwrite a
 * cover that is ON: from a draft it would withdraw it, or re-grant it with old values, behind the teacher's back. Over
 * an OFF cover it is the form's ordinary job (gate review, 2026-10-07).
 */
function assertCoverBase(base: string | null, stored: Parameters<typeof coverStamp>[0] | null) {
  if (base === null ? stored?.coverOpen === true : coverStamp(stored ?? NO_COVER) !== base) throw new TeacherCoverConflictError()
}

/**
 * ⛔ THE COVER PART OF A BODY: EVERY COVER FIELD, OR THE SAVE IS REFUSED (400 coverOpen 'incomplete'). Periods sent
 * without the switch would read the switch as OFF and withdraw the teacher (gate review, 2026-10-07). And since the
 * onboarding redesign a body with NO cover field is refused too (gate review, 2026-10-09): every v2 client sends its whole
 * state, cover included; the client "from before cover lessons" that once sent none is also from before the redesign (no
 * teach-area list) and is refused first, 409 profile_changed. The branch that kept the stored cover for it read a cover
 * kept ON under an older notice as unconsented — and coverWrites then recorded a WITHDRAWAL the teacher never made.
 */
export function coverPartOf(raw: unknown): 'none' | 'all' | 'partial' {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const n = COVER_FIELDS.filter((k) => k in body).length
  return n === 0 ? 'none' : n === COVER_FIELDS.length ? 'all' : 'partial'
}

/**
 * Did the client SHOW today's notice? It echoes the version it rendered — `coverNotice` beside the cover switch,
 * `publishNotice` beside Publish, `aiNotice` beside the two opt-ins. A consent counts only under the notice in force: a
 * tab loaded before a notice change re-sends a consent given to the old words, and stamping today's version on it would
 * record a consent the teacher never gave (gate review, 2026-10-07). Checked, never stored as sent.
 */
const noticeIs = (raw: unknown, field: 'coverNotice' | 'publishNotice' | 'aiNotice', version: string) =>
  !!raw && typeof raw === 'object' && (raw as Record<string, unknown>)[field] === version
const noticeShown = (raw: unknown) => noticeIs(raw, 'coverNotice', COVER_CONSENT_VERSION)

/**
 * The page showed an older notice than the one in force (409 `notice_changed` — "This page was updated, reload to
 * save"). ⛔ Never a silent downgrade: an opt-in or the cover switch quietly saved OFF would drop a choice the teacher
 * just made, and saved ON it would record consent to words they never saw (teacher onboarding redesign, 2026-10-08).
 * ⚠️ NOT the "Identity verified" switch any more: under its opt-in (2026-10-16) a switch-on beside older words answered
 * `identity`; since the mark is AUTOMATIC (owner, 2026-10-16) a show-again consents to nothing and names no notice
 * (saveTeacherIdentityMark), so nothing raises that variant.
 */
export class TeacherNoticeChangedError extends Error {
  constructor(public notice: 'publish' | 'cover' | 'ai') {
    super('notice_changed')
    this.name = 'TeacherNoticeChangedError'
  }
}
/** What a save hands back about the stored cover: the form's next `coverBase` and its "confirmed on" date. */
const SAVED_COVER_SELECT = { coverOpen: true, coverSlots: true, coverAreas: true, coverRateVnd: true, coverConfirmedAt: true, coverConsentVersion: true } as const
export type SavedCoverState = { coverOpen: boolean; coverSlots: string[]; coverAreas: string[]; coverRateVnd: number | null; coverConfirmedAt: Date | null; coverConsentVersion: string | null }

/**
 * The form was loaded for a TeacherProfile that is no longer the caller's (a session switched in another tab, or the
 * profile was deleted, or deleted and made again), or a body that claims there is none meets one → 409
 * `profile_changed`. ⛔ Judged UNDER THE ACCOUNT LOCK, in the transaction that writes: the PUT route's own read before
 * the save is only a fast path, and a delete or re-create landing between it and the write slipped past it (gate
 * review, 2026-10-08).
 */
export class TeacherProfileChangedError extends Error {
  constructor() {
    super('profile_changed')
    this.name = 'TeacherProfileChangedError'
  }
}

/**
 * "Show my profile to schools" over a profile with NOTHING TO BE FOUND FOR — no job goal and no public cover → 409
 * `no_teaching_goal` (gate review, 2026-10-09). ⛔ That is exactly the state an edit save HIDES (plan review D6), and
 * an edit never publishes; the Visibility switch re-showed it, so D6 held only until the teacher's next tap. Judged by
 * the saves' own rule (setTeacherStatus); the way back is the form's — pick the work wanted, or switch cover on, save,
 * then show.
 */
export class TeacherNoGoalError extends Error {
  constructor() {
    super('no_teaching_goal')
    this.name = 'TeacherNoGoalError'
  }
}

/** A stale window would change the intro video over a newer state (src/lib/teachers/video.ts) → 409 video_changed. */
export class TeacherVideoConflictError extends Error {
  constructor() {
    super('video_changed')
    this.name = 'TeacherVideoConflictError'
  }
}
/** A bucket move failed before anything was written → 502 video_store_failed (the copy's tombstone collects it). */
export class TeacherVideoStoreError extends Error {
  constructor() {
    super('video_store_failed')
    this.name = 'TeacherVideoStoreError'
  }
}
/** The profile photo check could not run (photo-verdict.ts) → 503 photo_check_unavailable: "try again", never the photo's fault. */
export class TeacherPhotoCheckUnavailableError extends Error {
  constructor(why: string) {
    super(`photo_check_unavailable:${why}`)
    this.name = 'TeacherPhotoCheckUnavailableError'
  }
}

/** The stored intro-video state, as the planner reads it. */
const VIDEO_STATE_SELECT = { videoOnRequest: true, videoUrl: true, videoVersion: true, private: { select: { videoPath: true } } } as const
type VideoStateRow = { videoOnRequest: boolean; videoUrl: string | null; videoVersion: number; private: { videoPath: string | null } | null }
const storedVideoOf = (r: VideoStateRow | null): StoredVideo | null =>
  r ? { videoOnRequest: r.videoOnRequest, videoUrl: r.videoUrl, videoPath: r.private?.videoPath ?? null, videoVersion: r.videoVersion } : null
/** A displaced object as a tombstone ref — a public one by its key (never the URL), a private one by its path. */
const displacedRef = (d: Extract<VideoPlan, { kind: 'apply' }>['displaced'][number]): TombstoneRef | null => {
  if (d.bucket === 'teacher-videos') return { bucket: TEACHER_VIDEOS_BUCKET, path: d.path }
  const ref = listingObjectKey(d.url)
  return ref && ref.bucket === LISTING_VIDEOS_BUCKET ? { bucket: LISTING_VIDEOS_BUCKET, path: ref.key } : null
}
/** What a save hands back about the video: the form's next base, and where the video now is. */
export type SavedVideoState = { onRequest: boolean; version: number; hasPrivate: boolean; url: string | null }

export class TeacherValidationError extends Error {
  constructor(public errors: TeacherErrors) {
    super('invalid_teacher_profile')
    this.name = 'TeacherValidationError'
  }
}

async function teachersCategory() {
  const cat = await db.category.findUnique({ where: { slug: TEACHERS_CATEGORY_SLUG }, select: { id: true, name: true, nameVi: true } })
  if (!cat) throw new Error('teachers category row missing — run scripts/sync-categories.ts')
  return cat
}

/** The account's storefront, created with NO phone when it has none (see the note above). */
async function sellerFor(profileId: string, name: string) {
  const owned = await db.seller.findUnique({ where: { ownerId: profileId } })
  if (owned) return owned
  try {
    return await db.seller.create({
      data: { name, phone: null, ownerId: profileId, verifiedSeller: false, rating: 0, reviewCount: 0, responseRate: 100, ...(await initialSellerTrust(profileId)) },
    })
  } catch {
    // Lost a create race to this same account (Seller.ownerId is unique) — read the winner.
    return db.seller.findUniqueOrThrow({ where: { ownerId: profileId } })
  }
}

// The visa-word screen lives in a pure module so the CV import drops exactly what Publish refuses.
export { teacherVisaMention } from '@/lib/teachers/visa-mention'

// The listing's searchable text, city, district, location and tokens: ONE builder for every writer —
// src/lib/teachers/projection.ts (teacherListingProjection / teacherSearchText), shared with the backfill.

type StoredCover = {
  coverOpen: boolean
  coverSlots: string[]
  coverAreas: string[]
  coverRateVnd: number | null
  coverConsentAt: Date | null
  coverConsentVersion: string | null
  coverConfirmedAt: Date | null
  coverWithdrawnAt: Date | null
}

/**
 * The SERVER-WRITTEN cover columns for a save of `t` over `stored` (null on a first save). Never read from the
 * request: the teacher sends only the switch, the periods and the rate (plus `coverBase` and `coverNotice`, which are
 * checked, never stored); the areas are DERIVED (2026-10-08 — places.ts coverReachOf, the teach areas near home).
 *   · consent — recorded when cover goes on, and again when the notice's version moved since the last grant;
 *   · withdrawal — recorded when cover goes off (plan review D6: switching off ALWAYS saves and stamps it);
 *   · confirmation — the "confirmed on" date moves only when the teacher actually confirmed: cover switched on, a
 *     cover field changed (the reach included), or an explicit "Still available" (`confirm`). A full save that only
 *     edited the bio must not present stale availability as freshly confirmed (gate review, 2026-10-07).
 * ⛔ coverOpen is written as coverIsPublic(t): never ON without a reach, periods, a rate and a consent under today's
 * notice — exactly what the database CHECK TeacherProfile_cover_bounds demands of an ON row.
 */
export function coverWrites(t: TeacherInput, stored: StoredCover | null, now: Date, opts: { confirm?: boolean } = {}) {
  const on = coverIsPublic(t)
  const wasOn = stored?.coverOpen === true
  const reach = coverReachOf(t)
  const changed = !stored || stored.coverRateVnd !== t.coverRateVnd
    || (stored.coverSlots ?? []).join() !== t.coverSlots.join() || (stored.coverAreas ?? []).join() !== reach.join()
  const confirmed = on && (opts.confirm === true || !wasOn || changed)
  const freshConsent = on && (!wasOn || stored?.coverConsentVersion !== COVER_CONSENT_VERSION)
  return {
    coverOpen: on,
    coverSlots: t.coverSlots,
    coverAreas: reach,
    coverRateVnd: t.coverRateVnd,
    coverConfirmedAt: confirmed ? now : (stored?.coverConfirmedAt ?? null),
    coverConsentAt: freshConsent ? now : (stored?.coverConsentAt ?? null),
    coverConsentVersion: freshConsent ? COVER_CONSENT_VERSION : (stored?.coverConsentVersion ?? null),
    coverWithdrawnAt: wasOn && !on ? now : (stored?.coverWithdrawnAt ?? null),
  }
}

/** One opt-in's stored record — the switch and its evidence (plan review C2). */
export type StoredOptIn = { on: boolean; at: Date | null; version: string | null; withdrawnAt: Date | null }
/**
 * ⛔ EACH OPT-IN IS ITS OWN SWITCH, WITH ITS OWN EVIDENCE (plan review B9/C2, 2026-10-08). "Email me jobs that match my
 * profile" and "Our staff may call me":
 *   · switched ON — when, and under which AI notice (AI_NOTICE_VERSION, naming Anthropic and the transfer abroad);
 *     an opt-in kept on from an older notice is RE-STAMPED once saved under today's (the page showed today's words —
 *     `aiNotice`, checked by the save), which is how a Gemini-era opt-in becomes one the matcher may use (D5);
 *   · switched OFF — the withdrawal's time; the last grant stays on record (a re-grant shows as a later At).
 * ⚖️ ON BY DEFAULT SINCE 2026-10-22 (owner: "all toggles should be on by default" — "On by default everywhere", web and
 * the native apps). Until then this rule read PDP Law 91/2025 Art 9(4)(d) and Decree 356/2025 Art 6(3) as "no default
 * consent"; the owner accepted that legal risk, and it is recorded in the dossier ([OWNER DECISION 2026-10-22]). What
 * changed is the FORM, not this rule: the form applies the default to a NEW profile (teacher-form.tsx optInChoice), so
 * the stamp records the switch's state AT THE SAVE — on because the teacher left it on, or switched it on — and never
 * a choice the teacher made apart from it. Which switches a new profile saved with their default still on is recorded
 * beside it, in the compliance log, as 'teacher.optins.default' (saveTeacherProfile, in the same transaction).
 * Pure: the same rule for the form's save and for any future one-click unsubscribe.
 * ⚠️ NOT the "Identity verified" switch's rule (it borrowed this one, with its own notice, under the opt-in of
 * 2026-10-16): the mark is AUTOMATIC since, and its switch only HIDES it or shows it again — saveTeacherIdentityMark.
 */
export function optInWrites(on: boolean, stored: StoredOptIn | null, now: Date): StoredOptIn {
  const wasOn = stored?.on === true
  const fresh = on && (!wasOn || stored?.version !== AI_NOTICE_VERSION)
  return {
    on,
    at: fresh ? now : (stored?.at ?? null),
    version: fresh ? AI_NOTICE_VERSION : (stored?.version ?? null),
    withdrawnAt: wasOn && !on ? now : (stored?.withdrawnAt ?? null),
  }
}

const STORED_COVER_SELECT = {
  coverOpen: true, coverSlots: true, coverAreas: true, coverRateVnd: true,
  coverConsentAt: true, coverConsentVersion: true, coverConfirmedAt: true, coverWithdrawnAt: true,
} as const

// districtPagesOf / revalidateTeacherPages — every public page a teacher row is on, the home page's "Find a teacher"
// shelf included — live in src/lib/teachers/revalidate.ts since 2026-10-13: the account erasure purges the same list.

/**
 * Screen every field a teacher typed — the ONE decision, src/lib/teachers/text-screen.ts teacherTextRefusal (shared with
 * the CV import and the form). Throws PublishBlockedError with the listing wizard's codes — and as its detail the KEY OF
 * THE REFUSED FIELD ('bio', 'experience.2', …), never the word (plan, 2026-10-08): nothing but the field goes on the wire.
 * ⚠️ Since 2026-10-21 the FORM shows the teacher their own refused words, found in the text it already holds
 * (teacherRefusedWords) — a teacher refused three times without being told which word published his complaint as his bio.
 * ⛔ eno.vn carries no visa wording (licensing split) — on BOTH editions, since the row is shared: teacherTextRefusal runs
 * the visa screen on EVERY field, the name included (a name like "Visa Help Vietnam" would be a listing of its own).
 */
export function screenTeacherTexts(t: TeacherInput) {
  for (const [field, text] of teacherFreeTextFields(t)) {
    const code = teacherTextRefusal(field, text)
    if (code) throw new PublishBlockedError(code, field)
  }
}

/** The stored columns a save reads under the account lock: cover, video version, the consent records, and the mirrors'
 *  inputs (the years a band may keep, the teach areas a confirmation stamp compares). And the "Identity verified" hide
 *  (identity-mark.ts identityMarkHidden — its two columns) — READ, never written, by an edit: the card's tick follows the
 *  name this save writes (below). */
const LOCKED_SELECT = {
  id: true, listingId: true, createdAt: true, ...STORED_COVER_SELECT, videoVersion: true, videoUrl: true, yearsExperience: true, teachAreas: true, teachAreasConfirmedAt: true,
  currentDistrictKey: true, currentDistrict: true,
  consentPublicVersion: true, consentPublicAt: true,
  matchEmailOptIn: true, matchEmailOptInAt: true, matchEmailNoticeVersion: true, matchEmailWithdrawnAt: true,
  staffContactOptIn: true, staffContactOptInAt: true, staffContactNoticeVersion: true, staffContactWithdrawnAt: true,
  identityMarkOn: true, identityMarkWithdrawnAt: true,
  // Whether the profile HAS a phone, read under the lock for the phone waiver (phoneWaived) — never sent anywhere.
  private: { select: { phone: true } },
} as const

/**
 * The join form's "Identity verified" choice as a first Publish carries it (owner, 2026-10-16: the teacher may hide the
 * mark "before publishing too"): a top-level `identityMarkHidden` that is exactly `true` — any other value, or none, is
 * not a hide. ⛔ CREATE-ONLY (saveTeacherProfile): honoured only by the save that CREATES the TeacherProfile, and ignored
 * by an edit — the switch's own endpoint owns the hide there (saveTeacherIdentityMark), so a profile save that refuses can
 * never hold a hide back. Never in TeacherInput (normalizeTeacherInput never reads it), never in a draft, never echoed.
 */
const hiddenAtPublish = (raw: unknown): boolean =>
  !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).identityMarkHidden === true

/**
 * THE CV A FIRST PUBLISH CARRIES (owner, 2026-10-21: "when teacher creates profile it says cv is optional, its not they
 * should include cv"). The join form uploads the PDF BEFORE the PUT (POST /api/teachers/me/cv?pending=1, tombstoned first —
 * 'teacher_cv_pending') and names the upload here: a top-level `cvUpload` (its token — isCvUploadToken, anything else is
 * none) and `cvFileName` (its display name, sanitised again). ⛔ CREATE-ONLY, like hiddenAtPublish: honoured only by the
 * save that CREATES the TeacherProfile and ignored by an edit, whose CV is attached after its save by the CV route itself.
 * Never in TeacherInput, never in a draft, never echoed. ⛔ A TOKEN, NEVER A PATH: the path is rebuilt from the caller's
 * own Profile id (cv-store.ts cvPathFor), so another account's token can only name an object this account never uploaded.
 */
const cvUploadOf = (raw: unknown): string | null => {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).cvUpload : undefined
  return isCvUploadToken(v) ? v : null
}
/** A `cvUpload` that is THERE — not absent, not null — but no token: a CV the form meant to attach and cannot name. */
const cvUploadUnnamed = (raw: unknown): boolean => {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).cvUpload : undefined
  return v !== undefined && v !== null && !isCvUploadToken(v)
}
const cvFileNameOf = (raw: unknown): unknown => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>).cvFileName : undefined)
/** A pending upload is attached only with at least this much of its grace hour left (the sweep never meets a claimed one). */
const CV_PENDING_MIN_GRACE_MS = 10 * 60_000

/**
 * ⚖️ WHICH JOB-MATCH SWITCHES A NEW PROFILE LEFT AT THEIR DEFAULT (owner, 2026-10-22: they start ON in a new profile's form
 * — accepted risk, the dossier's [OWNER DECISION 2026-10-22]). The join form sends a top-level `optInDefaults` —
 * `{ matchEmail, staffCall }`, `false` for a switch the teacher touched. ⛔ CONSERVATIVE (commit gate, codex + opus
 * 2026-10-22): the flag is the client's word, so it can only take a default AWAY — a body with no `optInDefaults` object
 * (an older tab, another client) is recorded as "unreported", i.e. as if each switch it stored ON were left at the
 * default: the record never claims more consent than was shown. ⛔ CREATE-ONLY, like hiddenAtPublish: an edit never
 * reads it. Never in TeacherInput, never in a draft, never echoed.
 */
const optInDefaultsOf = (raw: unknown): { reported: boolean; matchEmail: boolean; staffCall: boolean } => {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).optInDefaults : undefined
  if (!v || typeof v !== 'object') return { reported: false, matchEmail: true, staffCall: true }
  const d = v as Record<string, unknown>
  return { reported: true, matchEmail: d.matchEmail !== false, staffCall: d.staffCall !== false }
}

/**
 * Create or update the caller's teacher profile and its listing. Returns the listing id.
 * Throws TeacherValidationError (400), TeacherNoticeChangedError (409 notice_changed), TeacherProfileChangedError (409
 * profile_changed — also for an OLD-SHAPE body) or PublishBlockedError (the wizard's codes).
 * `expectTeacherProfileId`, judged under the lock (TeacherProfileChangedError): a string = the profile an edit form was
 * loaded for, which must still be the caller's; `null` = the body claims there is none, so the save may only CREATE;
 * absent = no check (callers outside the PUT route). The PUT route always passes one (gate review, 2026-10-08).
 * `noGoal` in the result: the save went through on a profile with neither a job goal nor public cover, which it HID
 * (plan review D6) — the form says so.
 * `identityMarkHidden: true` in the body (hiddenAtPublish): the join form's "Identity verified" switch, turned off before
 * the first Publish — recorded as a hide by the save that CREATES the profile, ignored by every other.
 * `cvUpload` + `cvFileName` in the body (cvUploadOf): the CV the join form uploaded before this save — attached by the save
 * that creates the profile, in its own transaction, when one is named (TeacherValidationError `cv`: 'expired' when its
 * pending upload is gone); a create that names none publishes without a CV (owner, 2026-10-22: publish before video/CV);
 * ignored by every other save.
 */
export async function saveTeacherProfile(
  profile: { id: string; email: string | null },
  raw: unknown,
  // `onboard`: the one-time account step of a new account (src/lib/core/first-onboarding.ts individualOnboardingWrite),
  // written IN this save's transaction — see below.
  opts: { expectTeacherProfileId?: string | null; onboard?: { data: { accountType: 'individual'; tosAcceptedAt?: Date; tosVersion?: string }; nameIfNone: boolean } } = {},
): Promise<{ listingId: string; teacherProfileId: string; created: boolean; live: boolean; noGoal: boolean; cover: SavedCoverState | null; video: SavedVideoState; onboarded: boolean }> {
  const expected = opts.expectTeacherProfileId
  // ⛔ ONE SHAPE (plan review D1/D2, 2026-10-08): a body with no teach-area list is a tab opened before the redesign. The
  // server never guesses what it meant — the route refuses it first (409 profile_changed, "reload"); this is the guarantee.
  if (isLegacyTeacherBody(raw)) throw new TeacherProfileChangedError()
  // ⛔ THE PUBLISH TAP IS THE CONSENT — under the notice beside it, and only that one (stamped below).
  if (!noticeIs(raw, 'publishNotice', PUBLISH_NOTICE_VERSION)) throw new TeacherNoticeChangedError('publish')
  // The whole cover, every time — none of it is refused like part of it (coverPartOf): absence is never read as "off".
  if (coverPartOf(raw) !== 'all') throw new TeacherValidationError({ coverOpen: 'incomplete' })
  const parsed = normalizeTeacherInput(raw)
  // The cover SWITCH is the consent (no tick box any more): switched on under an older notice, the page must reload.
  if (parsed.coverOpen && parsed.coverConsent && !noticeShown(raw)) throw new TeacherNoticeChangedError('cover')
  // ⛔ An answer to a question the teacher's other answers hide is never stored or published (normalizeForSave).
  const t = normalizeForSave(!noticeShown(raw) ? { ...parsed, coverConsent: false } : parsed)
  // Each opt-in is stamped with the AI notice shown beside it — so it must be today's (optInWrites).
  if ((t.matchEmailOptIn || t.staffContactOptIn) && !noticeIs(raw, 'aiNotice', AI_NOTICE_VERSION)) throw new TeacherNoticeChangedError('ai')
  const allErrors = validateTeacherInput(t)
  // The goal rule alone (no job type, cover off) refuses a CREATE but never an edit, which saves and hides (D6) — decided
  // under the lock, where it is known whether a profile exists.
  const { goal: goalErrors, other: errors } = splitGoalErrors(allErrors)
  if (!isListingImageUrl(t.photoUrl)) errors.photoUrl = 'required'
  const video = parseVideoField(t.videoUrl)
  if (t.videoUrl && video.action !== 'set') errors.videoUrl = 'invalid'
  // ⛔ PUBLISH BEFORE VIDEO/CV (owner, 2026-10-22): a CREATE no longer needs the CV (or the intro video) — after the video
  // and then the CV became required, teachers publishing within a day fell from 80% to 47% and real-browser publishes to a
  // third. A create that names an uploaded CV still attaches it (under the lock, below); one that names none publishes
  // without, and the CV route attaches one later — or removes it (owner, 2026-10-25: "Allow removal").
  // ⛔ THE PHONE "ON NEXT SAVE" (owner, 2026-10-22: "phone number is mandatory" — "Everyone, on next save"): refused with
  // the other answers for a body that claims a CREATE (`null`). Any other — an edit, or a caller that names no profile
  // (outside the PUT route) — is judged once the saved profile is read, below: a profile with no phone yet may still save
  // a withdrawal without one (phoneWaived), only the saved row says what it had on, and no saved row is a create, refused
  // there (commit gate, 2026-10-22: a withdrawal is waived whoever sends it). 'invalid' (junk) is refused always.
  if (expected !== null && errors.phone === 'required') delete errors.phone
  // A body that claims a CREATE and names a CV it cannot (cvUploadUnnamed): refused here, before the photo check and any
  // bucket copy (review, 2026-10-25) — and again under the lock, for a create no body claimed.
  if (expected === null && cvUploadUnnamed(raw)) errors.cv = 'expired'
  if (Object.keys(errors).length) throw new TeacherValidationError({ ...goalErrors, ...errors })
  if (Object.keys(goalErrors).length && expected === null) throw new TeacherValidationError(goalErrors)
  screenTeacherTexts(t)

  await assertSellerMayPublish({ ownerId: profile.id, guestCreate: false })
  const [seller, category, existing] = await Promise.all([
    sellerFor(profile.id, t.fullName),
    teachersCategory(),
    db.teacherProfile.findUnique({
      where: { profileId: profile.id },
      select: {
        id: true, listingId: true, status: true, photoUrl: true, createdAt: true,
        matchEmailOptIn: true, staffContactOptIn: true, coverOpen: true, videoUrl: true, private: { select: { phone: true } },
      },
    }),
  ])
  if (seller.trustTier === 'restricted') throw new PublishBlockedError('account_restricted')
  // ⛔ THE PHONE ON AN EDIT (owner, 2026-10-22): a saved profile with a phone can never clear it, and one with none adds
  // it the next time it is saved — unless this save only withdraws: it HIDES the profile (no goal left, D6) or switches
  // OFF something the saved profile had on ("hiding a profile or switching things off is NEVER blocked" — phoneWaived,
  // the form's own rule). Read before the lock like the photo's and the video's rules; a profile that vanished or changed
  // since is refused under the lock (profile_changed), and a CREATE is judged there too (no row, no phone, no save).
  // (`hides`: this edit saves and hides — the D6 rule the save itself applies below.)
  const hides = Object.keys(goalErrors).length > 0 || !hasTeachingGoal(t)
  if (existing && !t.phone) {
    const stored = {
      phone: !!existing.private?.phone?.trim(),
      matchEmailOptIn: existing.matchEmailOptIn, staffContactOptIn: existing.staffContactOptIn, coverOpen: existing.coverOpen,
      publicVideo: !!existing.videoUrl,
    }
    if (!phoneWaived(stored, t, hides)) throw new TeacherValidationError({ phone: 'required' })
  }
  // No saved profile: this save creates one, and a new profile always has a phone (also judged under the lock below) —
  // unless the body claims an EDIT: its profile is gone, and the lock answers profile_changed ("reload"), never a phone
  // error for a form that is stale (commit gate, opus 2026-10-22).
  if (!existing && !t.phone && typeof expected !== 'string') throw new TeacherValidationError({ phone: 'required' })

  // ── THE PROFILE PHOTO (owner, 2026-10-16: "check uploaded profile pictures so it clearly shows face of the teacher") ──
  // A NEW photo — a first publish, or a URL other than the one saved — needs a passing verdict: the form asked already
  // (POST /api/teachers/me/photo-check), so this is usually the cache; else the check runs now. ⛔ FAIL CLOSED: a check
  // that cannot run refuses the save with "try again" (plan review, 2026-10-16) — only a server with no Vertex client at
  // all ('off') saves unchecked. A photo already saved is never re-judged here: existing teachers keep editing, and a
  // flagged one is asked to change it (/api/cron/teacher-photo-recheck). Before the video's bucket copy: a refusal costs none.
  if (!existing || existing.photoUrl !== t.photoUrl) {
    let photo: Awaited<ReturnType<typeof teacherPhotoVerdict>>
    try {
      // (A URL that is not a listing image was refused above as photoUrl 'required'.)
      // The save's own budget (photo-verdict.ts): the form's early check, which any account can call, never drains it.
      photo = await teacherPhotoVerdict(profile.id, t.photoUrl ?? '', 'save')
    } catch (e) {
      if (e instanceof PhotoCheckUnavailable) throw new TeacherPhotoCheckUnavailableError(e.why)
      throw e
    }
    // 'off' — no Vertex client on this server: saved unchecked, as the CV door is off, but SAID (gate review, 2026-10-16).
    if (photo === 'off') logError(new Error('teacher photo check off: no Vertex client'), { op: 'teachers.photo.checkOff' })
    if (photo !== 'off' && !photo.ok) {
      // Recorded for the admin queue, so a wrong refusal can be approved by a person (gate review, 2026-10-16).
      const key = teacherPhotoKey(t.photoUrl)
      if (key) await recordPhotoRefusal(profile.id, key, photo.reason)
      throw new TeacherValidationError({ photoUrl: photo.reason })
    }
  }

  // ── THE INTRO VIDEO (2026-10-07): plan against the stored state; any bucket copy runs BEFORE the transaction ──────
  const rawBody = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pre = await db.teacherProfile.findUnique({ where: { profileId: profile.id }, select: VIDEO_STATE_SELECT })
  const preStored = storedVideoOf(pre)
  const videoBody: VideoBody = {
    ...('videoOnRequest' in rawBody ? { videoOnRequest: rawBody.videoOnRequest === true } : {}),
    videoUrl: video.action === 'set' ? video.url : null,
    videoBase: typeof rawBody.videoBase === 'number' ? rawBody.videoBase : null,
  }
  // Ownership is asked only of a NEW url (the stored public video is grandfathered — video.ts).
  const freshUrl = videoBody.videoUrl && videoBody.videoUrl !== preStored?.videoUrl ? videoBody.videoUrl : null
  const ownsFresh = freshUrl ? await ownsPublicVideo(freshUrl, profile.id) : false
  const plan = planVideoChange(preStored, videoBody, (u) => u === freshUrl && ownsFresh)
  if (plan.kind === 'refuse') {
    if (plan.code === 'video_not_owned') throw new TeacherValidationError({ videoUrl: 'not_owned' })
    throw new TeacherVideoConflictError()
  }
  // THE INTRO VIDEO IS OPTIONAL — to publish and to keep (owner: "publish before video/CV" 2026-10-22, "Allow removal" 2026-10-25
  // of a video or CV once added). It was required of new profiles 2026-10-16..25, and a profile created from 2026-10-18 could
  // only replace one; both rules are gone — a save may set, replace or remove it.
  let finalVideoUrl: string | null = plan.home.kind === 'public' ? plan.home.url : null
  let finalVideoPath: string | null = plan.home.kind === 'private' ? plan.home.path : null
  // The copy's destination is tombstoned FIRST: a crash after the upload then cannot orphan it (the sweep deletes it
  // unless the committed row references it — and the commit deletes this tombstone when it does).
  let pendingCopy: TombstoneRef | null = null
  if (plan.home.kind === 'private' && plan.home.copyFromPublic) {
    finalVideoPath = privateVideoPathFor(profile.id, plan.home.copyFromPublic)
    pendingCopy = { bucket: TEACHER_VIDEOS_BUCKET, path: finalVideoPath }
    await writeTombstones(db, [pendingCopy], 'teacher_video_pending')
    if (!(await copyPublicVideoToPrivate(plan.home.copyFromPublic, finalVideoPath))) throw new TeacherVideoStoreError()
  } else if (plan.home.kind === 'public' && plan.home.copyFromPrivate) {
    const key = publicVideoKeyFor(plan.home.copyFromPrivate)
    pendingCopy = { bucket: LISTING_VIDEOS_BUCKET, path: key }
    await writeTombstones(db, [pendingCopy], 'teacher_video_pending')
    finalVideoUrl = await copyPrivateVideoToPublic(plan.home.copyFromPrivate, key, profile.id)
    if (!finalVideoUrl) throw new TeacherVideoStoreError()
  }
  const status = existing?.status === 'hidden' ? 'hidden' : 'active'

  const { listingId, teacherProfileId, saved, noGoal, location, districtPages, video: savedVideo, onboarded, live } = await db.$transaction(async (tx) => {
    // ⛔ ONE SAVE AT A TIME PER ACCOUNT. Two first saves racing (a double tap) both saw "no profile"
    // and both created a listing; the loser's row was left live with no profile (Opus, commit gate
    // 09-30). The lock is per profile and held to COMMIT; the row is then re-read under it.
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profile.id}))`
    const locked = await tx.teacherProfile.findUnique({ where: { profileId: profile.id }, select: LOCKED_SELECT })
    // ⛔ The profile the form was loaded for, judged WITH the write (gate review, 2026-10-08): gone, or another one — or,
    // for a body that claims none (`null`), any profile at all — refuses before anything is written. A throw anywhere in
    // here rolls the whole save back; a bucket copy made
    // before the transaction keeps its pending tombstone (the deleteMany that clears it never commits) and nothing
    // committed references it, so the sweep collects it.
    if (expected !== undefined && (locked?.id ?? null) !== expected) throw new TeacherProfileChangedError()
    // ⛔ THE PHONE, AUTHORITATIVELY FOR A CREATE (owner, 2026-10-22): no row under the lock means this save makes the
    // profile, and a new profile always has a phone — whatever the read before the lock saw (a profile deleted in between
    // would otherwise turn a waived edit into a phone-less create). After the profile check, so a body that claimed an
    // edit of a profile that is gone answers profile_changed ("reload"), never a phone error for a form that is stale.
    if (!locked && !t.phone) throw new TeacherValidationError({ phone: 'required' })
    // …and an EDIT's waiver judged again on the row under the lock (checker, 2026-10-22): another tab that added a phone
    // between the read above and this lock must not have it wiped by a "withdrawal" save with none (the upsert below
    // writes `phone: null`) — a profile that HAS a phone can never clear it.
    if (locked && !t.phone && !phoneWaived({
      phone: !!locked.private?.phone?.trim(),
      matchEmailOptIn: locked.matchEmailOptIn, staffContactOptIn: locked.staffContactOptIn, coverOpen: locked.coverOpen,
      publicVideo: !!locked.videoUrl,
    }, t, hides)) throw new TeacherValidationError({ phone: 'required' })
    // Read under the lock, so a cover save racing this one cannot make consent/withdrawal lie.
    assertCoverBase(coverBaseOf(raw), locked)
    // The video plan was made from a read BEFORE the lock (its copy cannot run inside it). Every video change bumps the
    // version, so an unchanged version proves nothing moved in between; otherwise refuse (the copy's tombstone collects it).
    if ((locked?.videoVersion ?? null) !== (pre?.videoVersion ?? null)) throw new TeacherVideoConflictError()
    // (The video state read before the lock still holds: the version check just above proves nothing moved.)
    // ⛔ THE CV, ATTACHED BY THE SAVE THAT CREATES THE PROFILE WHEN IT NAMES ONE (owner, 2026-10-21; optional at publish since
    // 2026-10-22 — a create naming none publishes without, and the CV route attaches one later) — no row under the lock: its token, and the
    // upload's PENDING tombstone still there, at the path rebuilt from THIS account's id. Gone means the sweep took it (an
    // hour after the upload) or it was never this account's: 'expired' — the form uploads it again and saves once more. An
    // edit never reads either field; its CV is the CV route's (attach after save, replace, the cutoff's 409).
    // ⛔ …and with time left on its grace (CV_PENDING_MIN_GRACE_MS): a token named near the end of its hour could meet the
    // sweep mid-run — claimed here, its file removed there. The form never names one older than half that hour
    // (teacher-form.tsx CV_PENDING_REUSE_MS), so this refuses only a replayed token, as 'expired' (gate review, 2026-10-21).
    let cvAttach: { path: string; fileName: string } | null = null
    const token = !locked ? cvUploadOf(raw) : null
    // ⛔ A `cvUpload` that is THERE but no token (review, 2026-10-25): the form sends a token or null — anything else is a
    // CV it meant to attach and cannot name, never "no CV": refused as 'expired', so the form uploads it again (it did
    // with 'required' while the CV was required). Absent or null alone means "publish without a CV".
    if (!locked && cvUploadUnnamed(raw)) throw new TeacherValidationError({ cv: 'expired' })
    if (token) {
      const path = cvPathFor(profile.id, token)
      const pendingCv = await tx.storageTombstone.findUnique({ where: { bucket_path: { bucket: TEACHER_CVS_BUCKET, path } }, select: { reason: true, notBefore: true } })
      if (pendingCv?.reason !== 'teacher_cv_pending' || pendingCv.notBefore.getTime() - Date.now() < CV_PENDING_MIN_GRACE_MS) throw new TeacherValidationError({ cv: 'expired' })
      cvAttach = { path, fileName: safeCvFileName(cvFileNameOf(raw)) }
    }
    // Facets and search text read the video from the FINAL state — only a public video says "has a video" (video.ts).
    const tc: TeacherInput = { ...t, videoUrl: finalVideoUrl, videoOnRequest: plan.videoOnRequest }
    // ⛔ NOTHING TO BE FOUND FOR (no job goal, no public cover): a CREATE is refused; an EDIT saves and HIDES the profile —
    // switching cover off, or dropping the last job type, must never be blocked by having to invent a goal (D6).
    const noGoal = !hasTeachingGoal(tc)
    if (noGoal && !locked) throw new TeacherValidationError(Object.keys(goalErrors).length ? goalErrors : { jobTypes: 'required' })
    const now = new Date()
    // ALWAYS written: the reach is derived from the teach areas, which this save may have moved — a cover left ON with
    // no reach would break the cover CHECK, so coverWrites switches it off (and records the withdrawal) instead.
    const cover = coverWrites(tc, locked, now)
    const optIn = (on: boolean, s: StoredOptIn | null) => optInWrites(on, s, now)
    const email = optIn(tc.matchEmailOptIn, locked ? { on: locked.matchEmailOptIn, at: locked.matchEmailOptInAt, version: locked.matchEmailNoticeVersion, withdrawnAt: locked.matchEmailWithdrawnAt } : null)
    const calls = optIn(tc.staffContactOptIn, locked ? { on: locked.staffContactOptIn, at: locked.staffContactOptInAt, version: locked.staffContactNoticeVersion, withdrawnAt: locked.staffContactWithdrawnAt } : null)
    const p = teacherListingProjection(tc, category)
    const listingWrite = {
      // The card's price: the expected salary a month (job seekers) or the cover rate an hour (profile.ts teacherCardPrice).
      title: p.title, description: p.description, ...teacherCardPrice(tc), currency: '₫', negotiable: false,
      city: p.city, district: p.district, location: p.location,
      images: JSON.stringify([tc.photoUrl]), video: finalVideoUrl, searchText: p.searchText, categoryId: category.id,
      subcategorySlug: p.subcategorySlug, listingType: TEACHER_LISTING_TYPE, attributes: null, facetTokens: p.facetTokens,
      salaryM: p.salaryM,
    }
    // The places the teacher confirmed (or edited) in this form, and when — a list the backfill wrote keeps no stamp
    // until the teacher saves it here (B6/C3).
    const sameAreas = !!locked && (locked.teachAreas ?? []).join() === tc.teachAreas.join()
    const areasConfirmed = tc.teachAreasConfirmed || whereSkipped(tc)
    // The Publish tap under PUBLISH_NOTICE_VERSION: a first save, or one under a notice the last grant did not see, is a
    // fresh public consent (its time moves); otherwise the grant stands and only the last-saved time does.
    const freshPublic = !locked || locked.consentPublicVersion !== PUBLISH_NOTICE_VERSION
    // "Identity verified" hidden before the first Publish (hiddenAtPublish): only when THIS save creates the profile — no
    // row under the lock — and recorded exactly as the switch's own hide records one (saveTeacherIdentityMark): the
    // switch off, the hide's time. Written in the create below, so the card is judged on it in this same transaction.
    const hideAtPublish = !locked && hiddenAtPublish(raw)
    const profileData = {
      // ⛔ ONE HOME: the profile row's public URL is the PLAN's final one — exactly the listing's (null for a private or no
      // video), never the body's. publish.video.test.ts pins both writes (gate reviews, 2026-10-07).
      videoUrl: finalVideoUrl,
      fullName: tc.fullName, headline: tc.headline, bio: tc.bio, photoUrl: tc.photoUrl, nationality: tc.nationality, languages: tc.languages,
      // ── the v2 answers ──
      livesIn: tc.livesIn, currentCity: tc.currentCity, currentDistrictKey: tc.currentDistrictKey || null, currentProvince: tc.currentProvince || null,
      teachAreas: tc.teachAreas, teachLanguages: tc.teachLanguages, englishLevel: tc.englishLevel, experienceBand: tc.experienceBand,
      availableFrom: tc.availableFrom ? new Date(`${tc.availableFrom}T00:00:00Z`) : null,
      jobTypes: tc.jobTypes, ageGroups: tc.ageGroups, subjects: tc.subjects,
      experience: tc.experience, degreeLevel: tc.degreeLevel, degreeMajor: tc.degreeMajor || null,
      degreeInstitution: tc.degreeInstitution || null, degreeYear: tc.degreeYear, certificates: tc.certificates,
      expectedSalaryM: tc.expectedSalaryM,
      // ── the old columns, rewritten as mirrors so the old readers keep their meaning (projection.ts) ──
      ...teacherMirrors(tc, locked),
      situationVersion: TEACHER_SITUATION_VERSION,
      teachAreasConfirmedAt: areasConfirmed && (!sameAreas || !locked?.teachAreasConfirmedAt) ? now : (locked?.teachAreasConfirmedAt ?? null),
      consentPublicVersion: PUBLISH_NOTICE_VERSION,
      matchEmailOptIn: email.on, matchEmailOptInAt: email.at, matchEmailNoticeVersion: email.version, matchEmailWithdrawnAt: email.withdrawnAt,
      staffContactOptIn: calls.on, staffContactOptInAt: calls.at, staffContactNoticeVersion: calls.version, staffContactWithdrawnAt: calls.withdrawnAt,
      videoOnRequest: plan.videoOnRequest,
    }
    // Every displaced object is tombstoned WITH the row change; the copy, now referenced, loses its pending tombstone.
    const displaced = plan.displaced.map(displacedRef).filter((r): r is TombstoneRef => r !== null)
    if (displaced.length) await writeTombstones(tx, displaced, 'teacher_video_replaced')
    if (pendingCopy) await tx.storageTombstone.deleteMany({ where: { bucket: pendingCopy.bucket, path: pendingCopy.path } })
    // …and so does the CV this create attaches (below): referenced by the TeacherPrivate row it writes, in this commit.
    if (cvAttach) await tx.storageTombstone.deleteMany({ where: { bucket: TEACHER_CVS_BUCKET, path: cvAttach.path } })
    // The private video changed or left: every school it was SENT to loses it (a school sent v1 must not see v2). Only
    // sent grants (`sharedAt` set): a school's pending ASK stands — it asked for the teacher's video, whichever version,
    // and wiping it would silently drop the "this school asked" the teacher sees (gate review, 2026-10-07).
    if (plan.revokeGrants && locked?.listingId) {
      await tx.teacherVideoShare.updateMany({ where: { sharedAt: { not: null }, revokedAt: null, conversation: { listingId: locked.listingId, sellerProfileId: profile.id } }, data: { revokedAt: new Date() } })
    }
    let id = locked?.listingId ?? null
    if (id) {
      // ⛔ An edit NEVER PUBLISHES: it never touches `verified`, and `status` only ever goes to 'hidden' (no goal left, D6).
      // AI moderation pulls a row with status 'hidden' + verified false, and a re-save must not quietly republish it.
      await tx.listing.update({ where: { id }, data: noGoal ? { ...listingWrite, status: 'hidden' } : listingWrite })
    } else {
      const created = await tx.listing.create({
        data: {
          ...listingWrite,
          status,
          verified: true,
          sellerId: seller.id,
          sellerTrustScore: seller.trustScore,
          rankScore: browseRankScore({ sellerTrustScore: seller.trustScore, postedAt: now, featured: false }),
        },
        select: { id: true },
      })
      id = created.id
    }
    const tp = await tx.teacherProfile.upsert({
      where: { profileId: profile.id },
      create: {
        ...profileData, ...cover, profileId: profile.id, listingId: id, consentPublicAt: now, consentAt: now, videoVersion: plan.changed ? 1 : 0,
        ...(hideAtPublish ? { identityMarkOn: false, identityMarkWithdrawnAt: now } : {}),
      },
      update: {
        ...profileData, ...cover, listingId: id, consentAt: now,
        ...(freshPublic ? { consentPublicAt: now } : {}),
        ...(noGoal ? { status: 'hidden' } : {}),
        ...(plan.changed ? { videoVersion: { increment: 1 } } : {}),
      },
      select: { id: true, ...SAVED_COVER_SELECT, videoVersion: true, videoOnRequest: true },
    })
    // ⚠️ And once more on what the upsert touched: deleteTeacherProfile takes no lock, so a delete committing after the
    // read above makes this upsert CREATE a fresh row — the form's profile is gone all the same. Rolled back with the rest.
    // A `null` claim needs no second look: only this locked save creates a row, and a delete cannot create one.
    if (typeof expected === 'string' && tp.id !== expected) throw new TeacherProfileChangedError()
    // ⚖️ THE CARD'S "IDENTITY VERIFIED" TICK FOLLOWS THE NAME (owner, 2026-10-15: shown only while the profile's name is
    // within the ID's) — AND IS WRITTEN BY EVERY SAVE, a first one included (owner, 2026-10-16: AUTOMATIC once the
    // identity check is live). ⛔ AN EDIT NEVER CARRIES OR CHANGES THE HIDE — the switch's own endpoint does
    // (saveTeacherIdentityMark, plan review R2): no TeacherInput field, and no identityMark* column in profileData; the
    // one exception is the CREATE's hide above (hideAtPublish), so a teacher who switched it off on the join form is never
    // shown for a moment. This save writes the NAME the tick vouches for, so the card cache is re-derived here, LIVE, from
    // the stored hide (or the create's) and the new name, under this lock, in this transaction: a teacher verified BEFORE
    // they had a profile gets the tick with their first Publish (the approval's own sync found no profile to write), and a
    // rename to anything not within the ID takes it off with the rename, never a day later at the nightly reconcile; the
    // purge after the commit carries either. ⛔ JUDGED LIVE (identityMarkShownFor), NEVER GATED ON THE CARD CACHE: this is
    // a writer of that cache (identityMarkShownOnCard is for the public surfaces). Zero identity reads only for a hidden
    // mark; every other save makes one indexed read.
    // ⚠️ FAIL CLOSED, NEVER FAIL THE SAVE (commit gate, 2026-10-16): the identity read runs on THIS transaction, inside a
    // SAVEPOINT — a read that fails rolls back to the savepoint (a failed statement would otherwise poison the whole
    // transaction), hides the tick (NULL) instead of refusing an ordinary profile edit, and the nightly card passes
    // re-derive it (they select every identity holder — identity-reconcile.ts). Not a second connection: one waiting on a
    // busy pool while this transaction holds its own (and the teacher lock) would time the save out instead (round 7).
    let markShown = false
    await tx.$executeRaw`SAVEPOINT identity_mark`
    try {
      markShown = await identityMarkShownFor({
        profileId: profile.id, fullName: tc.fullName,
        // The row as this save leaves it: an edit's stored hide (never written here), or the create's.
        identityMarkOn: locked ? locked.identityMarkOn : false,
        identityMarkWithdrawnAt: locked ? locked.identityMarkWithdrawnAt : (hideAtPublish ? now : null),
      }, now, tx)
      await tx.$executeRaw`RELEASE SAVEPOINT identity_mark`
    } catch (e) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT identity_mark`
      try { logError(e, { op: 'teachers.save.identityMark', profileId: profile.id }) } catch { /* the logger never throws */ }
    }
    await writeIdentityMarkCard(tx, id, markShown)
    // The phone is REQUIRED since 2026-10-22 (owner: "phone number is mandatory" — checked above: always for a create, on
    // an edit unless it only withdraws, phoneWaived), no longer only while staff may call (2026-10-08). A profile saved
    // before then, or a waived withdrawal, still has none: stored as none, never as ''.
    // The CV only in the CREATE (cvAttach — this save made the profile, so its private row is new too): an edit's update
    // never touches cvPath or cvFileName.
    await tx.teacherPrivate.upsert({
      where: { teacherProfileId: tp.id },
      create: {
        teacherProfileId: tp.id, phone: tc.phone || null, email: profile.email, videoPath: finalVideoPath,
        ...(cvAttach ? { cvPath: cvAttach.path, cvFileName: cvAttach.fileName } : {}),
      },
      update: { phone: tc.phone || null, email: profile.email, videoPath: finalVideoPath },
    })
    // The unfinished profile this save publishes has done its job (src/lib/teachers/draft.ts): deleted IN the save's
    // transaction, under the lock a draft save also takes — so no late autosave can bring it back beside the profile.
    await tx.teacherDraft.deleteMany({ where: { profileId: profile.id } })
    // ⛔ THE ONE-TIME ACCOUNT STEP, IN THIS TRANSACTION (owner, 2026-10-11; commit gate, codex): a new account's first
    // profile and its account type + Terms acceptance commit together or not at all — never a live profile on an untyped
    // account with no Terms record. Conditional, so a type chosen meanwhile (another tab's /onboard, which recorded its
    // own Terms acceptance) is never overwritten: the profile publishes under that type, as any onboarded account's does
    // — a teacher profile never depended on the type.
    // The display name, where the account has none, is the name this save publishes — validated and screened above.
    const onboarded = opts.onboard
      ? (await tx.profile.updateMany({
        where: { id: profile.id, accountType: null },
        data: { ...opts.onboard.data, ...(opts.onboard.nameIfNone ? { displayName: tc.fullName.trim().slice(0, 80) || null } : {}) },
      })).count > 0
      : false
    // Whether schools see it now — read here, inside the transaction, so nothing after the COMMIT can fail this request
    // (commit gate, codex 2026-10-11: a read after it threw, the request answered 500 for a save — and an account step —
    // already committed, and the retry met "you already have a profile").
    const liveRow = await tx.listing.findUnique({ where: { id }, select: { status: true, verified: true } })
    const { id: teacherProfileId, videoVersion, videoOnRequest, ...saved } = tp
    // ⚖️ A DEFAULT LEFT ON, ON RECORD — IN THIS TRANSACTION (commit gate, codex + opus 2026-10-22: written after the commit,
    // best effort, a busy log could leave a default-ON stamp that read as a deliberate opt-in). The save that CREATES the
    // profile with a job-match switch stored ON at its default (optInDefaultsOf — conservatively, any it does not say the
    // teacher touched) writes one 'teacher.optins.default' row: which, under which AI notice, and whether the form said
    // so. Last in the transaction: no profile is saved without it, and nothing is recorded for a save that rolls back.
    if (!locked) {
      const d = optInDefaultsOf(raw)
      const leftOn = { matchEmail: tc.matchEmailOptIn && d.matchEmail, staffCall: tc.staffContactOptIn && d.staffCall }
      if (leftOn.matchEmail || leftOn.staffCall) {
        // A bounded wait on the log's own lock (commit gate, 2026-10-22: the consent route's rule) — the last statement of
        // this transaction, so nothing else waits under it; a log busy for 2 s fails the Publish, which the teacher repeats.
        await tx.$executeRaw`SELECT set_config('lock_timeout', '2000ms', true)`
        await appendAudit(tx, {
          actorType: 'user', actorId: profile.id, action: 'teacher.optins.default', subjectType: 'profile', subjectId: profile.id,
          detail: { ...leftOn, aiNotice: AI_NOTICE_VERSION, teacherProfileId, source: d.reported ? 'form' : 'unreported' },
        })
      }
    }
    return {
      onboarded, live: liveRow?.status === 'active' && liveRow.verified === true,
      listingId: id, teacherProfileId, saved, noGoal, location: p.location,
      districtPages: [...districtPagesOf(locked), tc.currentDistrictKey],
      video: { onRequest: videoOnRequest, version: videoVersion, hasPrivate: !!finalVideoPath, url: finalVideoUrl },
    }
  })

  // ⛔ COMMITTED FROM HERE: nothing below may fail the request (the account step may have been written with it), and
  // each step has its OWN guard, so one failing never skips the next — moderation first (commit gate, opus 2026-10-11).
  const guard = (op: string, fn: () => void) => { try { fn() } catch (e) { logError(e, { op }) } }
  guard('teachers.moderate', () => after(() => moderateListingById(listingId)))
  guard('teachers.translate', () => after(() => warmTranslations([t.headline, t.bio, location].filter(Boolean))))
  // The district pages the teacher left and joined: without this a teacher who moved stayed on the old district's cached
  // page until its ISR window ran out (integration, 2026-10-08).
  guard('teachers.revalidate', () => revalidateTeacherPages(listingId, districtPages))
  // The displaced video objects go now — reference-checked, so another listing that copied a public URL keeps it; what
  // this does not finish, the tombstone sweep does.
  const purgeUrls = plan.displaced.flatMap((d) => (d.bucket === 'listing-videos' ? [d.url] : []))
  const purgePaths = plan.displaced.flatMap((d) => (d.bucket === 'teacher-videos' ? [d.path] : []))
  if (purgeUrls.length || purgePaths.length) {
    guard('teachers.video.purge', () => after(async () => {
      try {
        const settled = [...(purgeUrls.length ? (await purgeStorageObjects(purgeUrls)).settled : []), ...(await removeUnreferencedPrivateVideos(purgePaths))]
        if (settled.length) await clearTombstones(settled)
      } catch (e) {
        logError(e, { op: 'teachers.video.purge' })
      }
    }))
  }
  // The cover state AS STORED — the form keeps it as its base and its "confirmed on" date (never its own guess).
  // teacherProfileId: a form that created the profile (edit mode, none loaded) names it on its next Save and Remove.
  return { listingId, teacherProfileId, created: !existing?.listingId, live, noGoal, cover: saved, video: savedVideo, onboarded }
}

/**
 * A cover body from the form before the redesign: it still sends the picked areas, which the redesigned form never
 * does (the reach is derived). Its switch-on is refused with 409 profile_changed ("reload") by the route — never
 * re-read with areas the teacher did not see; its switch-off still saves (a withdrawal is never blocked, D6).
 */
export const isLegacyCoverBody = (raw: unknown): boolean => !!raw && typeof raw === 'object' && 'coverAreas' in (raw as object)

/**
 * Save ONLY the caller's cover availability (the edit page's quick panel, and its "Still available" tap,
 * which re-sends the same values). Returns null when they have no profile.
 *
 * ⛔ WHAT IT MAY TOUCH: the TeacherProfile cover columns, and on the Listing exactly `facetTokens` and
 * `searchText` — never `verified` (src/lib/compliance/public-state-writes.test.ts pins this file's single publish
 * write), and `status` only ever to 'hidden' (below); no moderation re-run, because no free text changes.
 * ⛔ THE TOKENS ARE REBUILT FROM THE WHOLE STORED PROFILE plus the cover fields, never from the request alone — a
 * cover save must not wipe the teacher's subject, city or experience facets. The reach comes from the STORED teach
 * areas (places.ts coverReachOf): this panel cannot change where the teacher teaches.
 * ⛔ SWITCHING OFF ALWAYS SAVES (plan review D6): it stamps the withdrawal, and when the teacher then has no job goal
 * either, the profile is HIDDEN (`hidden: true` — the panel says so) rather than the withdrawal being refused.
 * ⚠️ `live` — what schools see after the save, exactly as the full save's (listing active AND verified). A save never
 * shows a hidden profile again (an edit never publishes — public-state-writes.test.ts): cover switched back on, or
 * re-confirmed, over a profile hidden by D6, by the teacher or by moderation leaves it hidden, and `live: false` is how
 * the panel knows to say so — the Visibility switch (setTeacherStatus) is the one way back, through the publish gates
 * and only with a goal to be found for (TeacherNoGoalError).
 */
export async function saveTeacherCover(profileId: string, raw: unknown): Promise<{ coverOpen: boolean; confirmedAt: Date | null; coverSlots: string[]; coverAreas: string[]; coverRateVnd: number | null; hidden: boolean; live: boolean } | null> {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  // The whole cover, every time: a cover save never reads an absent field as "off" (coverPartOf).
  if (coverPartOf(body) !== 'all') throw new TeacherValidationError({ coverOpen: 'incomplete' })
  const fields = normalizeCoverFields(body)
  // The switch is the consent: switched on under an older notice, the page must reload (never a silent off).
  if (fields.coverOpen && fields.coverConsent && !noticeShown(body)) throw new TeacherNoticeChangedError('cover')
  // Showing cover publicly is publishing: the same identity and trust gates as the profile itself (gate review).
  if (fields.coverOpen) {
    await assertSellerMayPublish({ ownerId: profileId, guestCreate: false })
    const seller = await db.seller.findUnique({ where: { ownerId: profileId }, select: { trustTier: true } })
    if (seller?.trustTier === 'restricted') throw new PublishBlockedError('account_restricted')
  }
  const category = await teachersCategory()
  const result = await db.$transaction(async (tx) => {
    // The same per-account lock as saveTeacherProfile, so a full save and a cover save never interleave.
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
    const tp = await tx.teacherProfile.findUnique({ where: { profileId } })
    if (!tp) return null
    assertCoverBase(coverBaseOf(body), tp)
    // The cover fields from the body (all present, coverPartOf), the rest of the profile — its places too — as stored.
    const t: TeacherInput = { ...teacherInputOfRow(tp), ...fields, coverConsent: fields.coverConsent && noticeShown(body) }
    const { goal, other } = splitGoalErrors(validateTeacherInput(t, ['cover']))
    if (Object.keys(other).length) throw new TeacherValidationError({ ...goal, ...other })
    const hidden = !hasTeachingGoal(t)
    // A cover-only save IS the teacher confirming their availability ("Still available").
    const cover = coverWrites(t, tp, new Date(), { confirm: true })
    await tx.teacherProfile.update({ where: { id: tp.id }, data: hidden ? { ...cover, status: 'hidden' } : cover })
    let listing: { status: string; verified: boolean } | null = null
    if (tp.listingId) {
      // ⛔ A ROW THE BACKFILL HAS NOT MIGRATED (situationVersion NULL — one the old code wrote after --apply) has no v2
      // answers: re-projected from them, its listing lost every place, native, experience and city facet while staying
      // live (gate review, 2026-10-09). So its cover save changes only the COVER part of what the old code wrote
      // (projection.ts withoutCoverFacets) — never a re-projection, and never the old columns read as answers (D1).
      // Cover cannot be ON here: no teach areas, no reach, refused above — so only the cover tokens and words go.
      // The card's price follows the cover too (profile.ts teacherCardPriceFromSaved, owner 2026-10-11): a cover switched
      // off or a new rate moves an hourly card price now, not at the next full save (commit gate, 2026-10-11). Read from
      // the row as this save leaves it; a row the backfill has not migrated keeps its price, like its other answers (D1).
      const data = tp.situationVersion == null
        ? withoutCoverFacets((await tx.listing.findUnique({ where: { id: tp.listingId }, select: { facetTokens: true, searchText: true } })) ?? { facetTokens: null, searchText: null })
        : {
          facetTokens: teacherFacetTokens(t), searchText: teacherSearchText(t, category),
          ...teacherCardPriceFromSaved({ jobTypes: tp.jobTypes, expectedSalaryM: tp.expectedSalaryM, coverOpen: cover.coverOpen, coverRateVnd: cover.coverRateVnd }),
          // As every full save writes it: a person takes no offers, whatever price the card states (commit gate, codex).
          negotiable: false,
        }
      listing = await tx.listing.update({ where: { id: tp.listingId }, data: hidden ? { ...data, status: 'hidden' } : data, select: { status: true, verified: true } })
    }
    return {
      listingId: tp.listingId, districts: districtPagesOf(tp), hidden, live: listing?.status === 'active' && listing.verified === true,
      coverOpen: cover.coverOpen, confirmedAt: cover.coverConfirmedAt, coverSlots: cover.coverSlots, coverAreas: cover.coverAreas, coverRateVnd: cover.coverRateVnd,
    }
  })
  if (!result) return null
  revalidateTeacherPages(result.listingId, result.districts)
  // What was SAVED — the form compares it with what it sent; the areas are the derived reach.
  return { coverOpen: result.coverOpen, confirmedAt: result.confirmedAt, coverSlots: result.coverSlots, coverAreas: result.coverAreas, coverRateVnd: result.coverRateVnd, hidden: result.hidden, live: result.live }
}

/**
 * The "Identity verified" switch changed in another window since this form loaded it → 409 `identity_mark_changed`
 * ("This changed elsewhere — reload"). ⛔ THE STALE-TAB RULE FOR SHOWING IT AGAIN (plan review R2, codex #2): a show is a
 * compare-and-set against the stamps the form loaded — tab A loaded it hidden, tab B showed it and hid it again, and tab A
 * must never be able to un-hide it over that newer hide. A hide carries no base: it is never refused.
 */
export class TeacherIdentityMarkConflictError extends Error {
  constructor() {
    super('identity_mark_changed')
    this.name = 'TeacherIdentityMarkConflictError'
  }
}

/**
 * The "Identity verified" switch's stamps as the wire carries them (ISO 8601 or null) — a show-again's CAS base:
 * `at` = the last SHOW (TeacherProfile.identityMarkAt — a show-again; under the opt-in before 2026-10-16, a switch-on),
 * `withdrawnAt` = the last HIDE (identityMarkWithdrawnAt). History, both: whether it is hidden is identityMarkHidden's.
 */
export type IdentityMarkStamps = { at: string | null; withdrawnAt: string | null }

/** One stamp as sent against one as stored: both absent, or the same instant (by epoch ms, so the ISO spelling is free). */
const sameStamp = (sent: string | null, stored: Date | null) =>
  sent === null ? stored === null : stored !== null && Date.parse(sent) === stored.getTime()

/** What the switch's save reads under the lock: the mark's inputs (the hide's two columns among them), the last show,
 *  and where its pages are. */
const IDENTITY_MARK_LOCKED_SELECT = {
  id: true, listingId: true, currentDistrictKey: true, currentDistrict: true,
  ...IDENTITY_MARK_TP_SELECT, identityMarkAt: true,
} as const

/**
 * Save ONLY the caller's "Identity verified" switch (owner, 2026-10-15; AUTOMATIC since 2026-10-16) — PUT
 * /api/teachers/me/identity-mark. The mark shows by itself while the identity check is live and the name is within the
 * ID's (identity-mark.ts); this switch is the teacher's way to HIDE it, and to show it again. Returns the mark's state
 * after the save (`{ shown, reason }` — the teacher's own form shows it) and the stamps as stored (the form's next CAS
 * base); null when the caller has no TeacherProfile (the join form holds its choice and sends it with the first Publish —
 * saveTeacherProfile hiddenAtPublish).
 *
 * ⛔ ITS OWN ENDPOINT, NEVER THE PROFILE SAVE (Opus #1, codex #2): a switch saved with the whole profile could not be
 * hidden whenever anything else in the profile refused to save — a bio that trips a screen added since it was written,
 * a video conflict, an older Publish notice. So, as saveTeacherCover (D6: "a withdrawal is never blocked"):
 *   · NOTHING ELSE IS SCREENED OR VALIDATED HERE — not the profile, not its texts, not the publish gates;
 *   · A HIDE (`on: false`) ALWAYS SUCCEEDS: no base, no notice, no identity read. It writes the switch off and the hide's
 *     time WHENEVER the mark is not hidden already — the untouched default (false, NULL) included, which is SHOWN
 *     (identityMarkHidden) — keeping the last show as history; the card's tick is cleared in the same transaction and
 *     the pages purged after the commit;
 *   · A SHOW (`on: true`) carries the stamps the form loaded (`base`), which must still match the stored ones (else
 *     TeacherIdentityMarkConflictError → 409 identity_mark_changed, NOTHING written) — so a stale tab can never un-hide
 *     over a newer hide. Over a hide it writes the switch on, the show's time and the words on screen
 *     (IDENTITY_MARK_NOTICE_VERSION — a record of which words, never a gate), the hide kept as history; over a mark that
 *     is not hidden it writes nothing. ⛔ IT CONSENTS TO NOTHING: the consent is the identity declaration (identity-mark.ts
 *     header), so a show names no notice — the route ignores one an older form still sends.
 * A show is never refused for the identity itself: the teacher may show it again before or while their check is pending
 * — the mark then simply is not shown, and the returned `reason` says why (identity-mark.ts).
 * ⛔ UNDER THE SAVES' PER-ACCOUNT LOCK, taken FIRST, with the row read under it: a full save, a cover save, an identity
 * sync (identity-mark-card.ts) and this never interleave. A show is then judged on the LIVE identity (on `tx`) — always,
 * so a show over a mark that was not hidden re-syncs a card that drifted — and the card cache written from it
 * (writeIdentityMarkCard); after the commit the teacher's pages are purged when anything moved (revalidateTeacherPages —
 * the profile line, the cards and the home shelf bake it in).
 * ⚠️ The purge is NOT swallowed (saveTeacherCover does not swallow its own either): if it throws, the request fails
 * AFTER the commit and the teacher sees an error. A retried hide is then a no-op (hidden and card already clear — no
 * purge, by design: hides are never rate-limited); what retries the purge is the nightly card passes, which keep a hide
 * of the last 7 days selected and purge it at 00:05 and 09:05 ICT (compliance/identity-reconcile.ts). So a failed purge
 * leaves a hidden tick on a cached page for at most until the next pass — never indefinitely.
 */
export async function saveTeacherIdentityMark(
  profileId: string,
  req: { on: boolean; base?: IdentityMarkStamps | null },
): Promise<{ identityMark: IdentityMarkState; stamps: IdentityMarkStamps } | null> {
  const result = await db.$transaction(async (tx) => {
    // The same per-account lock as every teacher save, FIRST.
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
    const tp = await tx.teacherProfile.findUnique({ where: { profileId }, select: IDENTITY_MARK_LOCKED_SELECT })
    if (!tp) return null
    // ⛔ THE CAS, A SHOW only and under the lock: a show is made over exactly the state the form showed, or not at all. A
    // body with no base cannot say what it was made over — refused the same way (fail closed).
    if (req.on && !(req.base && sameStamp(req.base.at, tp.identityMarkAt) && sameStamp(req.base.withdrawnAt, tp.identityMarkWithdrawnAt))) {
      throw new TeacherIdentityMarkConflictError()
    }
    const now = new Date()
    const hidden = identityMarkHidden(tp)
    // ⛔ EVERY ACT WRITES THE LAST ACT, AND ONLY WHEN IT CHANGES ONE (identity-mark.ts: hidden is read from the two switch
    // columns): a hide over a mark that is not hidden — the untouched default included — and a show over a hide. A hide
    // over a hide and a show over a shown mark write nothing (no second hide time, no second show time).
    const write = req.on
      ? (hidden ? { identityMarkOn: true, identityMarkAt: now, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION } : null)
      : (hidden ? null : { identityMarkOn: false, identityMarkWithdrawnAt: now })
    if (write) await tx.teacherProfile.update({ where: { id: tp.id }, data: write })
    const row = { ...tp, ...(write ?? {}) }
    // ⛔ A HIDE READS NOTHING ABOUT THE IDENTITY (commit gate, 2026-10-16): a hidden mark is never shown, so there is
    // nothing to judge — and an identity read that failed would have rolled the HIDE back. A show is judged on the live
    // identity in THIS transaction, and the card's cache is written from it.
    const identityMark: IdentityMarkState = req.on
      ? await identityMarkState({ profileId, fullName: row.fullName, identityMarkOn: row.identityMarkOn, identityMarkWithdrawnAt: row.identityMarkWithdrawnAt }, now, tx)
      : { shown: false, reason: 'hidden' }
    const cardMoved = tp.listingId ? await writeIdentityMarkCard(tx, tp.listingId, identityMark.shown) : false
    return {
      listingId: tp.listingId, districts: districtPagesOf(tp), identityMark,
      // ⚠️ A REPEATED HIDE IS A NO-OP — no purge (commit gate): hides are never rate-limited, so a hide over a mark that is
      // already hidden and a card already clear must not cost the teacher's pages and '/' a revalidation each. A hide
      // whose purge failed is retried by the nightly card passes (recent hides stay selected).
      purge: write !== null || cardMoved,
      stamps: { at: row.identityMarkAt?.toISOString() ?? null, withdrawnAt: row.identityMarkWithdrawnAt?.toISOString() ?? null },
    }
  })
  if (!result) return null
  if (result.purge) revalidateTeacherPages(result.listingId, result.districts)
  return { identityMark: result.identityMark, stamps: result.stamps }
}

/**
 * Remove the caller's PRIVATE intro video (DELETE /api/teachers/me/video) — the one change a save body never makes
 * ("videoUrl: null" over a private video keeps it: the form never holds its URL — video.ts). Under the same account lock
 * and version check as a save (`base` = the videoVersion the form loaded); the object is tombstoned with the row change
 * and purged after commit, and every school it was sent to loses it. Null when there is no private video to remove.
 * `expectTeacherProfileId` — the profile the form was loaded for; another profile under the lock is a conflict.
 */
export async function deleteTeacherVideo(profileId: string, base: number | null, expectTeacherProfileId: string): Promise<SavedVideoState | null> {
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
    const tp = await tx.teacherProfile.findUnique({ where: { profileId }, select: { id: true, listingId: true, createdAt: true, videoOnRequest: true, videoVersion: true, private: { select: { videoPath: true } } } })
    // ⛔ Under the lock, with the write — the DELETE route's own read is only a fast path (gate review, 2026-10-08). A
    // profile re-made since the form loaded starts its versions low, so `base` alone could match it.
    if (tp && tp.id !== expectTeacherProfileId) throw new TeacherVideoConflictError()
    const path = tp?.private?.videoPath
    if (!tp || !path) return null
    if (base === null || base !== tp.videoVersion) throw new TeacherVideoConflictError()
    await writeTombstones(tx, [{ bucket: TEACHER_VIDEOS_BUCKET, path }], 'teacher_video_replaced')
    await tx.teacherPrivate.update({ where: { teacherProfileId: tp.id }, data: { videoPath: null } })
    const saved = await tx.teacherProfile.update({ where: { id: tp.id }, data: { videoVersion: { increment: 1 } }, select: { videoVersion: true, videoOnRequest: true } })
    if (tp.listingId) {
      // Sent grants only — a pending ask stands (see saveTeacherProfile).
      await tx.teacherVideoShare.updateMany({ where: { sharedAt: { not: null }, revokedAt: null, conversation: { listingId: tp.listingId, sellerProfileId: profileId } }, data: { revokedAt: new Date() } })
    }
    return { path, listingId: tp.listingId, video: { onRequest: saved.videoOnRequest, version: saved.videoVersion, hasPrivate: false, url: null } satisfies SavedVideoState }
  })
  if (!result) return null
  after(async () => {
    try {
      const settled = await removeUnreferencedPrivateVideos([result.path])
      if (settled.length) await clearTombstones(settled)
    } catch (e) {
      logError(e, { op: 'teachers.video.deletePurge' })
    }
  })
  if (result.listingId) revalidatePublicPath(`/listings/${result.listingId}`)
  revalidatePublicPath(`/c/${TEACHERS_CATEGORY_SLUG}`)
  return result.video
}

/**
 * Show or hide the caller's profile (the listing follows) — the Visibility switch, the ONE way a hidden profile comes
 * back (a save never shows one). False when they have none. Hiding is never refused.
 * ⛔ SHOWING IS A RELIST, behind every gate a publish passes: the identity and trust gates; never over a moderation pull
 * or an identity hold (the listing filter below); and never a profile with nothing to be found for — no job goal and no
 * public cover, the state an edit save hides (D6) — TeacherNoGoalError (gate review, 2026-10-09).
 */
export async function setTeacherStatus(profileId: string, status: 'live' | 'hidden'): Promise<boolean> {
  const tp = await db.teacherProfile.findUnique({ where: { profileId }, select: { id: true, listingId: true, currentDistrictKey: true, currentDistrict: true } })
  if (!tp) return false
  // Showing the profile again is a relist: the same identity + trust gates a first publish passes.
  if (status === 'live') {
    await assertSellerMayPublish({ ownerId: profileId, guestCreate: false })
    const seller = await db.seller.findUnique({ where: { ownerId: profileId }, select: { trustTier: true } })
    if (seller?.trustTier === 'restricted') throw new PublishBlockedError('account_restricted')
  }
  await db.$transaction(async (tx) => {
    if (status === 'live') {
      // ⛔ THE GOAL, JUDGED UNDER THE SAVES' PER-ACCOUNT LOCK on the row as stored: a full save dropping the last goal
      // (and hiding the profile, D6) commits before this read or waits for this write — never between the two.
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
      const row = await tx.teacherProfile.findUnique({ where: { id: tp.id } })
      // ⚠️ THE SAVES' RULE, NOT A SECOND ONE: profile.ts hasTeachingGoal — a job type, or cover that is public — over the
      // stored row exactly as saveTeacherCover reads it (teacherInputOfRow: a cover kept ON under an older notice is not
      // consented, so not public; the form loads it OFF and asks for a fresh switch-on). saveTeacherProfile's noGoal is
      // the same test on what it writes.
      if (row && !hasTeachingGoal(teacherInputOfRow(row))) throw new TeacherNoGoalError()
    }
    // `verified: true, identityHold: false` in the filter: a row moderation or an identity hold
    // pulled stays down whatever the teacher toggles — they can hide it, never republish it.
    const moved = tp.listingId
      ? (await tx.listing.updateMany({ where: { id: tp.listingId, verified: true, identityHold: false }, data: { status: status === 'live' ? 'active' : 'hidden' } })).count
      : 0
    // Record "live" only when the listing really went live — never tell the teacher a lie.
    if (status === 'hidden' || moved > 0) await tx.teacherProfile.update({ where: { id: tp.id }, data: { status } })
    else throw new PublishBlockedError('account_restricted')
  })
  revalidateTeacherPages(tp.listingId, districtPagesOf(tp))
  return true
}

/**
 * Delete the caller's teacher profile: the listing (through deleteListingCore, so an open report
 * turns it into a hide rather than erasing evidence), the profile, its private row and matches
 * (cascade), and a tombstone for the CV so the private object is swept.
 */
export async function deleteTeacherProfile(profileId: string): Promise<boolean> {
  const tp = await db.teacherProfile.findUnique({ where: { profileId }, select: { id: true, listingId: true, currentDistrictKey: true, currentDistrict: true, private: { select: { cvPath: true, videoPath: true } } } })
  if (!tp) return false
  if (tp.listingId) await deleteListingCore(tp.listingId)
  await db.$transaction(async (tx) => {
    // The CV and a private intro video: their objects outlive the row unless tombstoned here (2026-10-07: the video).
    const refs = [
      ...(tp.private?.cvPath ? [{ bucket: TEACHER_CVS_BUCKET, path: tp.private.cvPath }] : []),
      ...(tp.private?.videoPath ? [{ bucket: TEACHER_VIDEOS_BUCKET, path: tp.private.videoPath }] : []),
    ]
    if (refs.length) await writeTombstones(tx, refs, 'teacher_profile_deleted')
    // ⛔ NO PROFILE, NO "IDENTITY VERIFIED": the card cache is cleared with the profile. A tombstone's scrub already
    // blanks it (PERSONAL_SCRUB_DATA), but a delete that met an open report HID the listing instead (deleteListingCore),
    // and a hidden, profile-less row must not keep a claim a later relist could show. NULL — allowed on any row.
    if (tp.listingId) await writeIdentityMarkCard(tx, tp.listingId, false)
    // deleteMany: deleteListingCore above already removes the profile with its listing.
    await tx.teacherProfile.deleteMany({ where: { id: tp.id } })
    // The job-messages switch and its record go with the profile: a profile made again later must be asked again
    // (job-dms/consent.ts), never inherit an old "on" it did not see the notice for.
    await tx.teacherJobDmConsent.deleteMany({ where: { profileId } })
    await tx.teacherJobDm.deleteMany({ where: { profileId } })
    await tx.teacherJobDmDay.deleteMany({ where: { profileId } })
    // And any unfinished copy (normally gone at publish): a deleted profile leaves nothing of the teacher's behind.
    await tx.teacherDraft.deleteMany({ where: { profileId } })
  })
  revalidateTeacherPages(tp.listingId, districtPagesOf(tp))
  return true
}
