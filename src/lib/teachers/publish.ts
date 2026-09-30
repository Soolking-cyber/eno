import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { buildSearchText } from '@/lib/fold'
import { warmTranslations } from '@/lib/translate'
import { isListingImageUrl } from '@/lib/listing-image'
import { browseRankScore } from '@/lib/ranking'
import { moderateListingById } from '@/lib/ai-moderation'
import { initialSellerTrust } from '@/lib/trust'
import { assertSellerMayPublish } from '@/lib/compliance/seller-publish-gate'
import { assertCleanContactName, assertCleanTexts, PublishBlockedError } from '@/lib/publish-guard'
import { fold } from '@/lib/fold'
import { deleteListingCore, parseVideoField } from '@/lib/core/listings'
import { writeTombstones } from '@/lib/core/storage-tombstones'
import { TEACHER_CVS_BUCKET } from '@/lib/supabase-admin'
import { TEACHERS_CATEGORY_SLUG, TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import {
  CITY_PROVINCE, TEACHER_OPTIONS, normalizeTeacherInput, validateTeacherInput, teacherFreeTexts,
  teacherFacetTokens, teacherListingDescription, teacherSubcategory, type TeacherErrors, type TeacherInput,
} from '@/lib/teachers/profile'

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
 */
export async function saveTeacherProfile(profile: { id: string; email: string | null }, raw: unknown): Promise<{ listingId: string; created: boolean; live: boolean }> {
  const t = normalizeTeacherInput(raw)
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
    video: video.action === 'set' ? video.url : null,
    searchText: buildSearchText([
      t.fullName, t.headline, t.bio, t.degreeMajor, t.degreeInstitution, ...t.languages,
      ...t.subjects, ...t.certificates.map((c) => c.type), ...t.preferredCities.map(cityLabel), cityLabel(t.currentCity),
      category.name, category.nameVi,
    ]),
    categoryId: category.id,
    subcategorySlug: teacherSubcategory(t),
    listingType: TEACHER_LISTING_TYPE,
    attributes: null,
    facetTokens: teacherFacetTokens(t),
    salaryM: t.expectedSalaryM,
  }
  const profileData = {
    fullName: t.fullName, headline: t.headline, bio: t.bio, photoUrl: t.photoUrl, videoUrl: listingData.video,
    nationality: t.nationality, nativeSpeaker: t.nativeSpeaker, languages: t.languages,
    currentCity: t.currentCity, currentDistrict: t.currentDistrict || null, preferredCities: t.preferredCities,
    openToOnline: t.openToOnline, availableFrom: t.availableFrom ? new Date(`${t.availableFrom}T00:00:00Z`) : null,
    jobTypes: t.jobTypes, ageGroups: t.ageGroups, subjects: t.subjects, yearsExperience: t.yearsExperience,
    experience: t.experience, degreeLevel: t.degreeLevel, degreeMajor: t.degreeMajor || null,
    degreeInstitution: t.degreeInstitution || null, degreeYear: t.degreeYear, certificates: t.certificates,
    expectedSalaryM: t.expectedSalaryM, staffContactOptIn: t.staffContactOptIn, matchEmailOptIn: t.matchEmailOptIn,
  }

  const listingId = await db.$transaction(async (tx) => {
    // ⛔ ONE SAVE AT A TIME PER ACCOUNT. Two first saves racing (a double tap) both saw "no profile"
    // and both created a listing; the loser's row was left live with no profile (Opus, commit gate
    // 09-30). The lock is per profile and held to COMMIT; the row is then re-read under it.
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profile.id}))`
    const locked = await tx.teacherProfile.findUnique({ where: { profileId: profile.id }, select: { listingId: true } })
    let id = locked?.listingId ?? null
    if (id) {
      // ⛔ An edit NEVER touches status or `verified`: AI moderation pulls a row with
      // status 'hidden' + verified false, and a re-save must not quietly republish it.
      await tx.listing.update({ where: { id }, data: listingData })
    } else {
      const now = new Date()
      const created = await tx.listing.create({
        data: {
          ...listingData,
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
      create: { ...profileData, profileId: profile.id, listingId: id, consentPublicAt: new Date() },
      update: { ...profileData, listingId: id, consentAt: new Date() },
      select: { id: true },
    })
    await tx.teacherPrivate.upsert({
      where: { teacherProfileId: tp.id },
      create: { teacherProfileId: tp.id, phone: t.phone, email: profile.email },
      update: { phone: t.phone, email: profile.email },
    })
    return id
  })

  revalidatePublicPath(`/listings/${listingId}`)
  revalidatePublicPath(`/c/${TEACHERS_CATEGORY_SLUG}`)
  after(() => moderateListingById(listingId))
  after(() => warmTranslations([t.headline, t.bio, listingData.location].filter(Boolean)))
  const live = await db.listing.findUnique({ where: { id: listingId }, select: { status: true, verified: true } })
  return { listingId, created: !existing?.listingId, live: live?.status === 'active' && live.verified }
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
  const tp = await db.teacherProfile.findUnique({ where: { profileId }, select: { id: true, listingId: true, private: { select: { cvPath: true } } } })
  if (!tp) return false
  if (tp.listingId) await deleteListingCore(tp.listingId)
  await db.$transaction(async (tx) => {
    if (tp.private?.cvPath) await writeTombstones(tx, [{ bucket: TEACHER_CVS_BUCKET, path: tp.private.cvPath }], 'teacher_profile_deleted')
    // deleteMany: deleteListingCore above already removes the profile with its listing.
    await tx.teacherProfile.deleteMany({ where: { id: tp.id } })
  })
  revalidatePublicPath(`/c/${TEACHERS_CATEGORY_SLUG}`)
  return true
}
