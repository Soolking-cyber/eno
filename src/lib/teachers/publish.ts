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
import { assertCleanContactName, assertCleanTexts, PublishBlockedError } from '@/lib/publish-guard'
import { fold } from '@/lib/fold'
import { deleteListingCore, parseVideoField } from '@/lib/core/listings'
import { clearTombstones, writeTombstones, type TombstoneRef } from '@/lib/core/storage-tombstones'
import { purgeStorageObjects } from '@/lib/core/storage-purge'
import { logError } from '@/lib/log'
import { LISTING_VIDEOS_BUCKET, TEACHER_CVS_BUCKET, TEACHER_VIDEOS_BUCKET } from '@/lib/supabase-admin'
import { planVideoChange, type StoredVideo, type VideoBody, type VideoPlan } from '@/lib/teachers/video'
import {
  copyPrivateVideoToPublic, copyPublicVideoToPrivate, ownsPublicVideo, privateVideoPathFor, publicVideoKeyFor,
  removeUnreferencedPrivateVideos,
} from '@/lib/teachers/video-store'
import { TEACHERS_CATEGORY_SLUG, TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import {
  AI_NOTICE_VERSION, COVER_FIELDS, PUBLISH_NOTICE_VERSION, TEACHER_SITUATION_VERSION, coverIsPublic, hasTeachingGoal,
  isLegacyTeacherBody, legacyDistrictKey, normalizeCoverFields, normalizeForSave, normalizeTeacherInput, splitGoalErrors,
  teacherFacetTokens, teacherFreeTextFields, validateTeacherInput, whereSkipped, type TeacherErrors, type TeacherInput,
} from '@/lib/teachers/profile'
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

/**
 * A visa MENTION in a person's own words. ⚠️ NOT job-listing's `hasVisaWord`, which is a fail-closed
 * SUBSTRING test built for scraped ads — on a teacher's profile it blocked real people: "Western
 * Visayas", "Visayas State University", the name "Visakha" (Opus, commit gate 09-30). Here "visa" must
 * stand as its own word (visa, visas, e-visa, #visa). "thị thực" is also the tail of "siêu thị thực
 * phẩm" (a food supermarket), so that one reading is excluded; CJK/Cyrillic words match as before.
 */
export function teacherVisaMention(raw: string): boolean {
  const folded = fold(raw)
  // Only SPELLED-OUT letters are collapsed (v.i.s.a → visa). Stripping every joiner was a bypass:
  // "visa-sponsored" became "visasponsored" and no longer stood as a word (Opus, commit gate 09-30).
  const spelled = folded.replace(/(?<![a-z])(?:[a-z][._*-]){2,}[a-z](?![a-z])/g, (m) => m.replace(/[._*-]/g, ''))
  return /(^|[^a-z])(e-?)?visas?([^a-z]|$)/.test(spelled) || /(?<!sieu\s)thi[\s._*-]*thuc/.test(folded) || /비자|签证|簽證|ビザ|виза/i.test(raw)
}

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
 * ⛔ EACH OPT-IN IS ITS OWN CONSENT, WITH ITS OWN EVIDENCE (plan review B9/C2, 2026-10-08 — PDP Law 91/2025 Art 9(4)(d),
 * Decree 356/2025 Art 6(3): no default consent). "Email me jobs that match my profile" and "Our staff may call me":
 *   · switched ON — when, and under which AI notice (AI_NOTICE_VERSION, naming Anthropic and the transfer abroad);
 *     an opt-in kept on from an older notice is RE-STAMPED once saved under today's (the page showed today's words —
 *     `aiNotice`, checked by the save), which is how a Gemini-era opt-in becomes one the matcher may use (D5);
 *   · switched OFF — the withdrawal's time; the last grant stays on record (a re-grant shows as a later At).
 * Pure: the same rule for the form's save and for any future one-click unsubscribe.
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

/** The district a stored teacher row shows on — its key, or (a row the backfill has not migrated) its old district text's. */
const districtPagesOf = (row: { currentDistrictKey?: string | null; currentDistrict?: string | null } | null | undefined): (string | null)[] =>
  row ? [row.currentDistrictKey ?? null, legacyDistrictKey(row.currentDistrict)] : []

/**
 * ⛔ EVERY PUBLIC PAGE A TEACHER ROW IS ON, PURGED BY EVERY WRITER THAT CHANGES WHAT IT SHOWS: the profile's own page,
 * /c/teachers and the district page of each district given (a DISTRICTS key IS the /c/teachers/<district> slug). One
 * list for the full save, the cover save, hide/show and delete — a cover save that HID a profile purged only the first
 * two, so the teacher stayed on their district page for its 24-hour ISR window (gate review, 2026-10-09).
 */
function revalidateTeacherPages(listingId: string | null, districts: (string | null | undefined)[]) {
  if (listingId) revalidatePublicPath(`/listings/${listingId}`)
  revalidatePublicPath(`/c/${TEACHERS_CATEGORY_SLUG}`)
  for (const key of new Set(districts.filter((k): k is string => !!k))) revalidatePublicPath(`/c/${TEACHERS_CATEGORY_SLUG}/${key}`)
}

/**
 * Screen every field a teacher typed. Throws PublishBlockedError with the listing wizard's codes — and as its detail
 * the KEY OF THE REFUSED FIELD ('bio', 'experience.2', …), never the word (plan, 2026-10-08): the form jumps to that
 * field, and a banned or visa word never reaches eno.vn's UI or wire.
 */
export function screenTeacherTexts(t: TeacherInput) {
  for (const [field, text] of teacherFreeTextFields(t)) {
    try {
      if (field === 'fullName') assertCleanContactName(text)
      else assertCleanTexts([text])
    } catch (e) {
      if (e instanceof PublishBlockedError) throw new PublishBlockedError(e.code, field)
      throw e
    }
    // ⛔ eno.vn carries no visa wording (licensing split) — on BOTH editions, since the row is shared.
    if (teacherVisaMention(text)) throw new PublishBlockedError('banned_words', field)
  }
}

/** The stored columns a save reads under the account lock: cover, video version, the consent records, and the mirrors'
 *  inputs (the years a band may keep, the teach areas a confirmation stamp compares). */
const LOCKED_SELECT = {
  id: true, listingId: true, ...STORED_COVER_SELECT, videoVersion: true, yearsExperience: true, teachAreas: true, teachAreasConfirmedAt: true,
  currentDistrictKey: true, currentDistrict: true,
  consentPublicVersion: true, consentPublicAt: true,
  matchEmailOptIn: true, matchEmailOptInAt: true, matchEmailNoticeVersion: true, matchEmailWithdrawnAt: true,
  staffContactOptIn: true, staffContactOptInAt: true, staffContactNoticeVersion: true, staffContactWithdrawnAt: true,
} as const

/**
 * Create or update the caller's teacher profile and its listing. Returns the listing id.
 * Throws TeacherValidationError (400), TeacherNoticeChangedError (409 notice_changed), TeacherProfileChangedError (409
 * profile_changed — also for an OLD-SHAPE body) or PublishBlockedError (the wizard's codes).
 * `expectTeacherProfileId`, judged under the lock (TeacherProfileChangedError): a string = the profile an edit form was
 * loaded for, which must still be the caller's; `null` = the body claims there is none, so the save may only CREATE;
 * absent = no check (callers outside the PUT route). The PUT route always passes one (gate review, 2026-10-08).
 * `noGoal` in the result: the save went through on a profile with neither a job goal nor public cover, which it HID
 * (plan review D6) — the form says so.
 */
export async function saveTeacherProfile(
  profile: { id: string; email: string | null },
  raw: unknown,
  opts: { expectTeacherProfileId?: string | null } = {},
): Promise<{ listingId: string; teacherProfileId: string; created: boolean; live: boolean; noGoal: boolean; cover: SavedCoverState | null; video: SavedVideoState }> {
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
  if (Object.keys(errors).length) throw new TeacherValidationError({ ...goalErrors, ...errors })
  if (Object.keys(goalErrors).length && expected === null) throw new TeacherValidationError(goalErrors)
  screenTeacherTexts(t)

  await assertSellerMayPublish({ ownerId: profile.id, guestCreate: false })
  const [seller, category, existing] = await Promise.all([
    sellerFor(profile.id, t.fullName),
    teachersCategory(),
    db.teacherProfile.findUnique({ where: { profileId: profile.id }, select: { id: true, listingId: true, status: true } }),
  ])
  if (seller.trustTier === 'restricted') throw new PublishBlockedError('account_restricted')

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

  const { listingId, teacherProfileId, saved, noGoal, location, districtPages, video: savedVideo } = await db.$transaction(async (tx) => {
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
    // Read under the lock, so a cover save racing this one cannot make consent/withdrawal lie.
    assertCoverBase(coverBaseOf(raw), locked)
    // The video plan was made from a read BEFORE the lock (its copy cannot run inside it). Every video change bumps the
    // version, so an unchanged version proves nothing moved in between; otherwise refuse (the copy's tombstone collects it).
    if ((locked?.videoVersion ?? null) !== (pre?.videoVersion ?? null)) throw new TeacherVideoConflictError()
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
      title: p.title, description: p.description, price: 0, priceUnit: 'VND/month', currency: '₫', negotiable: false,
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
      create: { ...profileData, ...cover, profileId: profile.id, listingId: id, consentPublicAt: now, consentAt: now, videoVersion: plan.changed ? 1 : 0 },
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
    // The phone is optional unless staff may call (owner, 2026-10-08): none is stored as none, never as ''.
    await tx.teacherPrivate.upsert({
      where: { teacherProfileId: tp.id },
      create: { teacherProfileId: tp.id, phone: tc.phone || null, email: profile.email, videoPath: finalVideoPath },
      update: { phone: tc.phone || null, email: profile.email, videoPath: finalVideoPath },
    })
    const { id: teacherProfileId, videoVersion, videoOnRequest, ...saved } = tp
    return {
      listingId: id, teacherProfileId, saved, noGoal, location: p.location,
      districtPages: [...districtPagesOf(locked), tc.currentDistrictKey],
      video: { onRequest: videoOnRequest, version: videoVersion, hasPrivate: !!finalVideoPath, url: finalVideoUrl },
    }
  })

  // The district pages the teacher left and joined: without this a teacher who moved stayed on the old district's cached
  // page until its ISR window ran out (integration, 2026-10-08).
  revalidateTeacherPages(listingId, districtPages)
  // The displaced video objects go now — reference-checked, so another listing that copied a public URL keeps it; what
  // this does not finish, the tombstone sweep does.
  const purgeUrls = plan.displaced.flatMap((d) => (d.bucket === 'listing-videos' ? [d.url] : []))
  const purgePaths = plan.displaced.flatMap((d) => (d.bucket === 'teacher-videos' ? [d.path] : []))
  if (purgeUrls.length || purgePaths.length) {
    after(async () => {
      try {
        const settled = [...(purgeUrls.length ? (await purgeStorageObjects(purgeUrls)).settled : []), ...(await removeUnreferencedPrivateVideos(purgePaths))]
        if (settled.length) await clearTombstones(settled)
      } catch (e) {
        logError(e, { op: 'teachers.video.purge' })
      }
    })
  }
  after(() => moderateListingById(listingId))
  after(() => warmTranslations([t.headline, t.bio, location].filter(Boolean)))
  const live = await db.listing.findUnique({ where: { id: listingId }, select: { status: true, verified: true } })
  // The cover state AS STORED — the form keeps it as its base and its "confirmed on" date (never its own guess).
  // teacherProfileId: a form that created the profile (edit mode, none loaded) names it on its next Save and Remove.
  return { listingId, teacherProfileId, created: !existing?.listingId, live: live?.status === 'active' && live.verified, noGoal, cover: saved, video: savedVideo }
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
      const data = tp.situationVersion == null
        ? withoutCoverFacets((await tx.listing.findUnique({ where: { id: tp.listingId }, select: { facetTokens: true, searchText: true } })) ?? { facetTokens: null, searchText: null })
        : { facetTokens: teacherFacetTokens(t), searchText: teacherSearchText(t, category) }
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
 * Remove the caller's PRIVATE intro video (DELETE /api/teachers/me/video) — the one change a save body never makes
 * ("videoUrl: null" over a private video keeps it: the form never holds its URL — video.ts). Under the same account lock
 * and version check as a save (`base` = the videoVersion the form loaded); the object is tombstoned with the row change
 * and purged after commit, and every school it was sent to loses it. Null when there is no private video to remove.
 * `expectTeacherProfileId` — the profile the form was loaded for; another profile under the lock is a conflict.
 */
export async function deleteTeacherVideo(profileId: string, base: number | null, expectTeacherProfileId: string): Promise<SavedVideoState | null> {
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
    const tp = await tx.teacherProfile.findUnique({ where: { profileId }, select: { id: true, listingId: true, videoOnRequest: true, videoVersion: true, private: { select: { videoPath: true } } } })
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
    // deleteMany: deleteListingCore above already removes the profile with its listing.
    await tx.teacherProfile.deleteMany({ where: { id: tp.id } })
  })
  revalidateTeacherPages(tp.listingId, districtPagesOf(tp))
  return true
}
