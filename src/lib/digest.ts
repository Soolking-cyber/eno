import { scopedListingWhere } from '@/lib/edition-scope'
import { db } from '@/lib/db'
import { districtLabel, districtLinkSlug } from '@/lib/district-canonical'
import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'

// Content for the weekly digest email. Computed ONCE per cron run and shared across all recipients
// (not personalised: browsing-based personalisation needs consent eno does not collect yet).
//
// ⛔ DELIBERATELY SHORT (owner, 2026-10-15): the 2 newest apartments + the 2 newest teachers + a
// "sell your second-hand items" prompt, nothing else. This REPLACED the older busy digest (a homes
// grid, one cross-category "pick" from each of six categories, and a "moving sales" row). Recover
// that design from git history (pre-2026-10-15 src/lib/digest.ts) if it is ever wanted again.

export type DigestApartment = {
  id: string
  /** "Apartment · 2 bed · 1 bath · 64 m²" — the importer's English title up to " for rent". */
  heading: string
  price: number
  currency: string
  /** Raw first-party image URL; the email template runs it through emailThumb. */
  image: string
  /** English district label ("Binh Thanh District"), or null. */
  area: string | null
}

export type DigestTeacher = {
  id: string
  /** The teacher's full name. */
  name: string
  /** Short headline ("IELTS 8.0 · 5 yrs"), or null. */
  headline: string | null
  /** Raw first-party photo URL; the email template runs it through emailThumb. */
  image: string
}

export type DigestContent = {
  apartments: DigestApartment[]
  teachers: DigestTeacher[]
}

/** Two of each — the email shows exactly this many cards. */
const APARTMENT_COUNT = 2
const TEACHER_COUNT = 2
/** Over-fetch within the window so the image + plausibility filters still leave COUNT cards. Generous
 *  so a run of malformed/implausible newest rows can't starve a card while valid in-window rows exist. */
const FETCH = 50
/**
 * "This week" is a real claim: only items ADDED in the last 7 days are shown, so a quiet week shows
 * fewer (or none) rather than re-sending old listings under a "new this week" heading. With the weekly
 * cron a listing normally lands in a single send; a run that fires early/late (or a manual trial) can
 * overlap or gap the window — acceptable for a marketing digest (not the never-twice guarantee of the
 * transactional path).
 * ⚠️ A teacher's createdAt is the LISTING's create time (teachers aren't imported, so it == publish).
 * A profile drafted long ago that only just went live keeps its old createdAt and won't show as new —
 * a known limitation; sort/filter on teacherProfile.verifiedAt (go-live) if teacher coverage is thin.
 */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000
/**
 * Price band (VND/month) to drop portal typos — a ₫1,200 room or a ₫106M warehouse filed as a flat
 * would be half of a two-card email. Measured 2026-09-29: p10 4.5M, p50 8M, p90 23M.
 */
const PRICE_MIN = 2_000_000
const PRICE_MAX = 80_000_000

function firstImage(images: string): string | null {
  try {
    const arr = JSON.parse(images)
    return Array.isArray(arr) && arr.length ? String(arr[0]) : null
  } catch {
    return null
  }
}

/** "Apartment · 1 bed · 1 bath · 28 m² for rent — Tân Bình Ward…" → "Apartment · 1 bed · 1 bath · 28 m²". */
export function homeHeading(title: string): string {
  const cut = title.split(/\s+for rent\b/i)[0]?.trim()
  const h = cut && cut.length >= 3 ? cut : title.trim()
  return h.length > 70 ? `${h.slice(0, 67).trimEnd()}…` : h
}

function bedroomsOf(attributes: string | null | undefined): number | null {
  if (!attributes) return null
  try {
    const n = Number((JSON.parse(attributes) as { bedrooms?: unknown }).bedrooms)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/**
 * A card must not be a portal typo. "House · 3 bed · 2 bath · 16.5 m²" at 16,000,000 đ carried the
 * plot WIDTH or one room's size as the floor area. A home under 12 m², or under 15 m² per bedroom, is
 * left off the cards. Exported for the unit test.
 */
export function plausibleHome(r: { areaM2?: number | null; attributes?: string | null }): boolean {
  if (r.areaM2 == null) return true
  if (r.areaM2 < 12) return false
  const beds = bedroomsOf(r.attributes)
  return beds == null || r.areaM2 >= 15 * beds
}

export async function getDigestContent(): Promise<DigestContent> {
  const since = new Date(Date.now() - WINDOW_MS) // only items ADDED in the last 7 days — see WINDOW_MS
  const [homeRows, teacherRows] = await Promise.all([
    // The newest APARTMENTS added to eno THIS WEEK. Recency = createdAt (when added here), NEVER
    // postedAt — importers keep postedAt at the portal's own source date (apartment-freshness.ts).
    db.listing.findMany({
      where: await scopedListingWhere({
        verified: true, // publication gate (verified + active, schema.prisma)
        status: 'active',
        category: { slug: 'rentals' },
        subcategorySlug: 'apartment-rental',
        price: { gte: PRICE_MIN, lte: PRICE_MAX },
        images: { not: '[]' },
        createdAt: { gte: since },
      }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: FETCH,
      select: { id: true, title: true, price: true, currency: true, images: true, district: true, city: true, areaM2: true, attributes: true },
    }),
    // The newest LIVE teachers added THIS WEEK. Teachers are EXCLUDED from every listing query by
    // default — opt the category back in with the 2nd arg { teachers: true } (edition-scope.ts).
    db.listing.findMany({
      where: await scopedListingWhere(
        {
          verified: true,
          status: 'active',
          listingType: TEACHER_LISTING_TYPE,
          teacherProfile: { is: { status: 'live' } },
          createdAt: { gte: since },
        },
        { teachers: true },
      ),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: FETCH,
      select: { id: true, title: true, images: true, teacherProfile: { select: { fullName: true, headline: true, photoUrl: true } } },
    }),
  ])

  const apartments: DigestApartment[] = []
  for (const r of homeRows) {
    if (apartments.length >= APARTMENT_COUNT) break
    const image = firstImage(r.images)
    if (!image || !plausibleHome(r)) continue
    const slug = r.district?.trim() ? districtLinkSlug(r.district) : ''
    apartments.push({
      id: r.id,
      heading: homeHeading(r.title),
      price: r.price,
      currency: r.currency,
      image,
      area: slug ? districtLabel(slug, r.district).en : (r.city || null),
    })
  }

  const teachers: DigestTeacher[] = []
  for (const r of teacherRows) {
    if (teachers.length >= TEACHER_COUNT) break
    // Trim before the truthiness fallback: a whitespace-only photoUrl would otherwise win over a real
    // listing image (broken card), and a whitespace-only name would print blank instead of the title.
    const image = r.teacherProfile?.photoUrl?.trim() || firstImage(r.images)
    if (!image) continue
    teachers.push({
      id: r.id,
      name: r.teacherProfile?.fullName?.trim() || r.title,
      headline: r.teacherProfile?.headline?.trim() || null,
      image,
    })
  }

  return { apartments, teachers }
}
