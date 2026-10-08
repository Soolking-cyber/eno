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
  CITY_PROVINCE, COVER_FIELDS, TEACHER_OPTIONS, coverIsPublic, normalizeTeacherInput, validateTeacherInput, teacherFreeTexts,
  teacherFacetTokens, teacherListingDescription, teacherSubcategory, type TeacherErrors, type TeacherInput,
} from '@/lib/teachers/profile'
import { COVER_CONSENT_VERSION, coverStamp } from '@/lib/teachers/cover'

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
 * ⛔ THE COVER PART OF A BODY IS ALL OR NOTHING. No cover field: a client from before cover lessons, so the stored cover
 * is kept and nothing is written (withStoredCover). Every cover field: the cover is replaced. Anything in between is
 * refused, because periods sent without the switch would read the switch as OFF and withdraw the teacher (gate
 * review, 2026-10-07).
 */
export function coverPartOf(raw: unknown): 'none' | 'all' | 'partial' {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const n = COVER_FIELDS.filter((k) => k in body).length
  return n === 0 ? 'none' : n === COVER_FIELDS.length ? 'all' : 'partial'
}

/**
 * Did the client SHOW today's cover notice? It sends the COVER_CONSENT_VERSION it rendered as `coverNotice`. A consent
 * tick counts only under the notice in force: a tab loaded before a notice change re-sends a tick given to the old
 * words, and stamping today's version on it would record a consent the teacher never gave (gate review, 2026-10-07).
 */
const noticeShown = (raw: unknown) =>
  !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).coverNotice === COVER_CONSENT_VERSION
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

const cityLabel = (slug: string) => TEACHER_OPTIONS.workIn.find((o) => o.value === slug)?.label ?? slug

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

/**
 * The listing's searchable text — ONE builder for the full save and the cover-only save, so the two can never
 * disagree. ⚠️ Cover adds "cover lessons / dạy thay" and NOTHING about areas: district words in searchText
 * would let district-query infer a HOME district from them (the teacher's home is `Listing.district`).
 */
function teacherSearchText(t: TeacherInput, category: { name: string; nameVi: string | null }): string {
  return buildSearchText([
    t.fullName, t.headline, t.bio, t.degreeMajor, t.degreeInstitution, ...t.languages,
    ...t.subjects, ...t.certificates.map((c) => c.type), ...t.preferredCities.map(cityLabel), cityLabel(t.currentCity),
    category.name, category.nameVi,
    ...(coverIsPublic(t) ? ['cover lessons', 'cover teacher', 'substitute teacher', 'dạy thay', 'giáo viên dạy thay'] : []),
  ])
}

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
 * request: the teacher sends only the four cover fields and the consent tick (plus `coverBase` and `coverNotice`,
 * which are checked, never stored).
 *   · consent — recorded when cover goes on, and again when the notice's version moved since the last grant;
 *   · withdrawal — recorded when cover goes off;
 *   · confirmation — the "confirmed on" date moves only when the teacher actually confirmed: cover switched on, a
 *     cover field changed, or an explicit "Still available" (`confirm`). A full save that only edited the bio must not
 *     present stale availability as freshly confirmed (gate review, 2026-10-07).
 */
export function coverWrites(t: TeacherInput, stored: StoredCover | null, now: Date, opts: { confirm?: boolean } = {}) {
  const on = coverIsPublic(t)
  const wasOn = stored?.coverOpen === true
  const changed = !stored || stored.coverRateVnd !== t.coverRateVnd
    || (stored.coverSlots ?? []).join() !== t.coverSlots.join() || (stored.coverAreas ?? []).join() !== t.coverAreas.join()
  const confirmed = on && (opts.confirm === true || !wasOn || changed)
  const freshConsent = on && (!wasOn || stored?.coverConsentVersion !== COVER_CONSENT_VERSION)
  return {
    coverOpen: on,
    coverSlots: t.coverSlots,
    coverAreas: t.coverAreas,
    coverRateVnd: t.coverRateVnd,
    coverConfirmedAt: confirmed ? now : (stored?.coverConfirmedAt ?? null),
    coverConsentAt: freshConsent ? now : (stored?.coverConsentAt ?? null),
    coverConsentVersion: freshConsent ? COVER_CONSENT_VERSION : (stored?.coverConsentVersion ?? null),
    coverWithdrawnAt: wasOn && !on ? now : (stored?.coverWithdrawnAt ?? null),
  }
}

const STORED_COVER_SELECT = {
  coverOpen: true, coverSlots: true, coverAreas: true, coverRateVnd: true,
  coverConsentAt: true, coverConsentVersion: true, coverConfirmedAt: true, coverWithdrawnAt: true,
} as const

/**
 * A body with NO cover field at all — a client from before cover lessons (a tab left open across the deploy) — keeps
 * the stored cover state: absence is never read as "switch cover off", which would withdraw consent and drop the
 * teacher from cover search behind their back (gate review, 2026-10-07). A body with every cover field is taken as
 * is; one with only some of them is refused before this is reached (coverPartOf).
 */
export function withStoredCover(
  raw: unknown,
  prev: { coverOpen: boolean; coverSlots: string[] | null; coverAreas: string[] | null; coverRateVnd: number | null; coverConsentVersion: string | null } | null,
): unknown {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (!prev || COVER_FIELDS.some((k) => k in body)) return raw
  return {
    ...body,
    coverOpen: prev.coverOpen, coverSlots: prev.coverSlots ?? [], coverAreas: prev.coverAreas ?? [], coverRateVnd: prev.coverRateVnd,
    coverConsent: prev.coverOpen && prev.coverConsentVersion === COVER_CONSENT_VERSION,
  }
}

/** Screen every field a teacher typed. Throws PublishBlockedError with the listing wizard's codes. */
export function screenTeacherTexts(t: TeacherInput) {
  assertCleanContactName(t.fullName)
  const texts = teacherFreeTexts(t)
  assertCleanTexts(texts)
  // ⛔ eno.vn carries no visa wording (licensing split) — on BOTH editions, since the row is shared.
  // ⛔ The detail names no term: a visa word must not reach eno.vn's UI or wire either.
  if (texts.some(teacherVisaMention)) throw new PublishBlockedError('banned_words', 'restricted_term')
}

/**
 * Create or update the caller's teacher profile and its listing. Returns the listing id.
 * Throws TeacherValidationError (400) or PublishBlockedError (the wizard's codes).
 * `expectTeacherProfileId`, judged under the lock (TeacherProfileChangedError): a string = the profile an edit form was
 * loaded for, which must still be the caller's; `null` = the body claims there is none, so the save may only CREATE;
 * absent = no check (callers outside the PUT route). The PUT route always passes one (gate review, 2026-10-08).
 */
export async function saveTeacherProfile(
  profile: { id: string; email: string | null },
  raw: unknown,
  opts: { expectTeacherProfileId?: string | null } = {},
): Promise<{ listingId: string; teacherProfileId: string; created: boolean; live: boolean; cover: SavedCoverState | null; video: SavedVideoState }> {
  const expected = opts.expectTeacherProfileId
  // A client from before cover lessons sends no cover field: its cover is taken from the row UNDER THE LOCK below,
  // and never written (withStoredCover). Its own (absent) cover reads as off here, which validates trivially.
  const part = coverPartOf(raw)
  if (part === 'partial') throw new TeacherValidationError({ coverOpen: 'incomplete' })
  const sendsCover = part === 'all'
  const parsed = normalizeTeacherInput(raw)
  // A tick given under an older notice is no consent today (noticeShown): cover ON then fails validation below.
  const t = sendsCover && !noticeShown(raw) ? { ...parsed, coverConsent: false } : parsed
  const errors = validateTeacherInput(t)
  if (!isListingImageUrl(t.photoUrl)) errors.photoUrl = 'required'
  const video = parseVideoField(t.videoUrl)
  if (t.videoUrl && video.action !== 'set') errors.videoUrl = 'invalid'
  if (Object.keys(errors).length) throw new TeacherValidationError(errors)
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
  // Facets and search text read the video from the FINAL state: only a public video says "has a video" (video.ts).
  const tv: TeacherInput = { ...t, videoUrl: finalVideoUrl, videoOnRequest: plan.videoOnRequest }

  const status = existing?.status === 'hidden' ? 'hidden' : 'active'
  const description = teacherListingDescription(t)
  const listingData = {
    title: t.fullName,
    description,
    price: 0,
    priceUnit: 'VND/month',
    currency: '₫',
    negotiable: false,
    city: CITY_PROVINCE[t.currentCity] ?? 'Hồ Chí Minh',
    district: t.currentDistrict || null,
    location: t.currentDistrict ? `${t.currentDistrict}, ${cityLabel(t.currentCity)}` : cityLabel(t.currentCity),
    images: JSON.stringify([t.photoUrl]),
    video: finalVideoUrl,
    searchText: teacherSearchText(tv, category),
    categoryId: category.id,
    subcategorySlug: teacherSubcategory(t),
    listingType: TEACHER_LISTING_TYPE,
    attributes: null,
    facetTokens: teacherFacetTokens(tv),
    salaryM: t.expectedSalaryM,
  }
  const profileData = {
    // ⛔ ONE HOME: the profile row's public URL is the PLAN's final one — exactly the listing's (null for a private or no
    // video), never the body's. publish.video.test.ts pins both writes (gate reviews, 2026-10-07).
    videoUrl: finalVideoUrl,
    fullName: t.fullName, headline: t.headline, bio: t.bio, photoUrl: t.photoUrl,
    nationality: t.nationality, nativeSpeaker: t.nativeSpeaker, languages: t.languages,
    currentCity: t.currentCity, currentDistrict: t.currentDistrict || null, preferredCities: t.preferredCities,
    openToOnline: t.openToOnline, availableFrom: t.availableFrom ? new Date(`${t.availableFrom}T00:00:00Z`) : null,
    jobTypes: t.jobTypes, ageGroups: t.ageGroups, subjects: t.subjects, yearsExperience: t.yearsExperience,
    experience: t.experience, degreeLevel: t.degreeLevel, degreeMajor: t.degreeMajor || null,
    degreeInstitution: t.degreeInstitution || null, degreeYear: t.degreeYear, certificates: t.certificates,
    expectedSalaryM: t.expectedSalaryM, staffContactOptIn: t.staffContactOptIn, matchEmailOptIn: t.matchEmailOptIn,
    videoOnRequest: plan.videoOnRequest,
  }

  const { listingId, teacherProfileId, saved, video: savedVideo } = await db.$transaction(async (tx) => {
    // ⛔ ONE SAVE AT A TIME PER ACCOUNT. Two first saves racing (a double tap) both saw "no profile"
    // and both created a listing; the loser's row was left live with no profile (Opus, commit gate
    // 09-30). The lock is per profile and held to COMMIT; the row is then re-read under it.
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profile.id}))`
    const locked = await tx.teacherProfile.findUnique({ where: { profileId: profile.id }, select: { id: true, listingId: true, ...STORED_COVER_SELECT, videoVersion: true } })
    // ⛔ The profile the form was loaded for, judged WITH the write (gate review, 2026-10-08): gone, or another one — or,
    // for a body that claims none (`null`), any profile at all — refuses before anything is written. A throw anywhere in
    // here rolls the whole save back; a bucket copy made
    // before the transaction keeps its pending tombstone (the deleteMany that clears it never commits) and nothing
    // committed references it, so the sweep collects it.
    if (expected !== undefined && (locked?.id ?? null) !== expected) throw new TeacherProfileChangedError()
    // Read under the lock, so a cover save racing this one cannot make consent/withdrawal lie.
    if (sendsCover) assertCoverBase(coverBaseOf(raw), locked)
    // The video plan was made from a read BEFORE the lock (its copy cannot run inside it). Every video change bumps the
    // version, so an unchanged version proves nothing moved in between; otherwise refuse (the copy's tombstone collects it).
    if ((locked?.videoVersion ?? null) !== (pre?.videoVersion ?? null)) throw new TeacherVideoConflictError()
    // A legacy body keeps the stored cover (resolved here, under the lock) and writes no cover column.
    const tc = { ...(sendsCover ? t : normalizeTeacherInput(withStoredCover(raw, locked))), videoUrl: finalVideoUrl, videoOnRequest: plan.videoOnRequest }
    const cover = sendsCover ? coverWrites(t, locked, new Date()) : {}
    const listingWrite = { ...listingData, facetTokens: teacherFacetTokens(tc), searchText: teacherSearchText(tc, category) }
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
      // ⛔ An edit NEVER touches status or `verified`: AI moderation pulls a row with
      // status 'hidden' + verified false, and a re-save must not quietly republish it.
      await tx.listing.update({ where: { id }, data: listingWrite })
    } else {
      const now = new Date()
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
      create: { ...profileData, ...cover, profileId: profile.id, listingId: id, consentPublicAt: new Date(), videoVersion: plan.changed ? 1 : 0 },
      update: { ...profileData, ...cover, listingId: id, consentAt: new Date(), ...(plan.changed ? { videoVersion: { increment: 1 } } : {}) },
      select: { id: true, ...SAVED_COVER_SELECT, videoVersion: true, videoOnRequest: true },
    })
    // ⚠️ And once more on what the upsert touched: deleteTeacherProfile takes no lock, so a delete committing after the
    // read above makes this upsert CREATE a fresh row — the form's profile is gone all the same. Rolled back with the rest.
    // A `null` claim needs no second look: only this locked save creates a row, and a delete cannot create one.
    if (typeof expected === 'string' && tp.id !== expected) throw new TeacherProfileChangedError()
    await tx.teacherPrivate.upsert({
      where: { teacherProfileId: tp.id },
      create: { teacherProfileId: tp.id, phone: t.phone, email: profile.email, videoPath: finalVideoPath },
      update: { phone: t.phone, email: profile.email, videoPath: finalVideoPath },
    })
    const { id: teacherProfileId, videoVersion, videoOnRequest, ...saved } = tp
    return { listingId: id, teacherProfileId, saved, video: { onRequest: videoOnRequest, version: videoVersion, hasPrivate: !!finalVideoPath, url: finalVideoUrl } }
  })

  revalidatePublicPath(`/listings/${listingId}`)
  revalidatePublicPath(`/c/${TEACHERS_CATEGORY_SLUG}`)
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
  after(() => warmTranslations([t.headline, t.bio, listingData.location].filter(Boolean)))
  const live = await db.listing.findUnique({ where: { id: listingId }, select: { status: true, verified: true } })
  // The cover state AS STORED — the form keeps it as its base and its "confirmed on" date (never its own guess).
  // teacherProfileId: a form that created the profile (edit mode, none loaded) names it on its next Save and Remove.
  return { listingId, teacherProfileId, created: !existing?.listingId, live: live?.status === 'active' && live.verified, cover: saved, video: savedVideo }
}

/**
 * Save ONLY the caller's cover availability (the edit page's quick panel, and its "Still available" tap,
 * which re-sends the same values). Returns null when they have no profile.
 *
 * ⛔ WHAT IT MAY TOUCH: the TeacherProfile cover columns, and on the Listing exactly `facetTokens` and
 * `searchText` — never `status` or `verified` (src/lib/compliance/public-state-writes.test.ts pins this
 * file's single publish write), and no moderation re-run, because no free text changes.
 * ⛔ THE TOKENS ARE REBUILT FROM THE WHOLE STORED PROFILE plus the four cover fields, never from the request
 * alone — a cover save must not wipe the teacher's subject, city or experience facets.
 */
export async function saveTeacherCover(profileId: string, raw: unknown): Promise<{ coverOpen: boolean; confirmedAt: Date | null; coverSlots: string[]; coverAreas: string[]; coverRateVnd: number | null } | null> {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  // The whole cover, every time: a cover save never reads an absent field as "off" (coverPartOf).
  if (coverPartOf(body) !== 'all') throw new TeacherValidationError({ coverOpen: 'incomplete' })
  // Showing cover publicly is publishing: the same identity and trust gates as the profile itself (gate review).
  if (body.coverOpen === true) {
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
    const stored = normalizeTeacherInput({ ...tp, availableFrom: tp.availableFrom ? tp.availableFrom.toISOString().slice(0, 10) : null })
    // The four cover fields and the tick from the body (all present, coverPartOf), the rest of the profile as stored.
    const t = normalizeTeacherInput({
      ...stored,
      ...Object.fromEntries(COVER_FIELDS.map((k) => [k, body[k]])),
      coverConsent: body.coverConsent === true && noticeShown(body),
    })
    const errors = validateTeacherInput(t, ['cover'])
    if (Object.keys(errors).length) throw new TeacherValidationError(errors)
    // A cover-only save IS the teacher confirming their availability ("Still available").
    const cover = coverWrites(t, tp, new Date(), { confirm: true })
    await tx.teacherProfile.update({ where: { id: tp.id }, data: cover })
    if (tp.listingId) {
      await tx.listing.update({ where: { id: tp.listingId }, data: { facetTokens: teacherFacetTokens(t), searchText: teacherSearchText(t, category) } })
    }
    return { listingId: tp.listingId, coverOpen: cover.coverOpen, confirmedAt: cover.coverConfirmedAt, coverSlots: cover.coverSlots, coverAreas: cover.coverAreas, coverRateVnd: cover.coverRateVnd }
  })
  if (!result) return null
  if (result.listingId) revalidatePublicPath(`/listings/${result.listingId}`)
  revalidatePublicPath(`/c/${TEACHERS_CATEGORY_SLUG}`)
  // What was SAVED — the form compares it with what it sent (an area in a city not yet saved is dropped).
  return { coverOpen: result.coverOpen, confirmedAt: result.confirmedAt, coverSlots: result.coverSlots, coverAreas: result.coverAreas, coverRateVnd: result.coverRateVnd }
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

/** Show or hide the caller's profile (the listing follows). Null when they have none. */
export async function setTeacherStatus(profileId: string, status: 'live' | 'hidden'): Promise<boolean> {
  const tp = await db.teacherProfile.findUnique({ where: { profileId }, select: { id: true, listingId: true } })
  if (!tp) return false
  // Showing the profile again is a relist: the same identity + trust gates a first publish passes.
  if (status === 'live') {
    await assertSellerMayPublish({ ownerId: profileId, guestCreate: false })
    const seller = await db.seller.findUnique({ where: { ownerId: profileId }, select: { trustTier: true } })
    if (seller?.trustTier === 'restricted') throw new PublishBlockedError('account_restricted')
  }
  await db.$transaction(async (tx) => {
    // `verified: true, identityHold: false` in the filter: a row moderation or an identity hold
    // pulled stays down whatever the teacher toggles — they can hide it, never republish it.
    const moved = tp.listingId
      ? (await tx.listing.updateMany({ where: { id: tp.listingId, verified: true, identityHold: false }, data: { status: status === 'live' ? 'active' : 'hidden' } })).count
      : 0
    // Record "live" only when the listing really went live — never tell the teacher a lie.
    if (status === 'hidden' || moved > 0) await tx.teacherProfile.update({ where: { id: tp.id }, data: { status } })
    else throw new PublishBlockedError('account_restricted')
  })
  if (tp.listingId) revalidatePublicPath(`/listings/${tp.listingId}`)
  revalidatePublicPath(`/c/${TEACHERS_CATEGORY_SLUG}`)
  return true
}

/**
 * Delete the caller's teacher profile: the listing (through deleteListingCore, so an open report
 * turns it into a hide rather than erasing evidence), the profile, its private row and matches
 * (cascade), and a tombstone for the CV so the private object is swept.
 */
export async function deleteTeacherProfile(profileId: string): Promise<boolean> {
  const tp = await db.teacherProfile.findUnique({ where: { profileId }, select: { id: true, listingId: true, private: { select: { cvPath: true, videoPath: true } } } })
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
  revalidatePublicPath(`/c/${TEACHERS_CATEGORY_SLUG}`)
  return true
}
