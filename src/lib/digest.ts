import { scopedListingWhere } from '@/lib/edition-scope'
import { db } from '@/lib/db'
import { dropPercent } from '@/lib/vnd'
import { districtLabel, districtLinkSlug, isCuratedDistrict, mergeDistrictGroups } from '@/lib/district-canonical'

// Content for the weekly digest email. Computed ONCE per cron run and shared across all recipients
// (not personalised: browsing-based personalisation needs consent eno does not collect yet).
//
// ⛔ RENTAL HOMES LEAD, BECAUSE THAT IS WHAT THE SITE IS NOW. Until 2026-09-29 the email led with
// "top picks" = the best rankScore among ALL listings created that week, and in the week it was
// fixed that meant six SIM/eSIM plans — while 4,815 homes for rent went live the same week and the
// site's one conversion is the free rental availability check. The digest now opens on those homes
// (`homes`, `homeCounts`, `districts`); what used to be "top picks" survives as a short "also new"
// list of everything else (`others`), and "moving sales" (a recent real price drop OR an active
// "Bán gấp" urgent flag) still appears when there is one.

export type DigestItem = {
  id: string
  title: string
  price: number
  currency: string
  image: string | null
  district: string | null
  drop: string | null // "−20%" when an active drop, else null
  urgent: boolean
  trustScore: number
}

// Only surface drops from the last two weeks so the "sales" stay genuinely fresh.
const DROP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

// The drop badge's own lifetime — mirrors DROP.BADGE_MS in src/lib/price-drop.ts and the copy of it
// in serialize.ts. A digest must never claim a discount the site itself has already retired.
const DROP_BADGE_MS = 3 * 24 * 60 * 60 * 1000

/**
 * How far back "new this week" reaches for the top picks, and the widening fallback.
 *
 * ⚠️ THE DIGEST USED TO SEND THE SAME SIX LISTINGS EVERY WEEK. `top` ordered by rankScore across
 * every active listing with no recency bound at all — and rankScore is a deliberately slow-moving
 * trust⊕recency blend, so the same winners held the top six indefinitely and a subscriber got an
 * identical email week after week. A weekly digest whose content does not change is unsubscribe
 * bait, and it also buries exactly what the email exists to surface: what is NEW.
 *
 * So the window is the primary filter and rankScore only ORDERS WITHIN it — subscribers get the
 * best of the new, not the best of all time. The fallback widens rather than dropping the window,
 * because on a quiet week the right answer is "the last fortnight's best" and never "the same six
 * again": each step still prefers recent listings, and the final 90-day step keeps the email from
 * going out empty while the catalogue is still small.
 */
const TOP_WINDOWS_MS = [7, 14, 30, 90].map((d) => d * 24 * 60 * 60 * 1000)
/** "Also new" is a footnote under the homes now, not the lead — three rows. */
const TOP_COUNT = 3

/**
 * Homes, not every rental: vehicle hire (rental-places.ts) and offices share the `rentals` category
 * but are not what "a home for rent" means to the person reading this email.
 */
const HOME_SUBCATS = ['apartment-rental', 'house-rental', 'room-rental'] as const
const HOME_COUNT = 6
/** Home windows widen like the "also new" ones, but stop at 30 days: a month-old rental is not news. */
const HOME_WINDOWS_MS = [7, 14, 30].map((d) => d * 24 * 60 * 60 * 1000)
/**
 * The card band, in VND per month. Imported rows carry the portals' own mistakes — a ₫1,200 room, a
 * ₫106,000,000 warehouse filed as a house — and one of those in a six-card email is a sixth of it.
 * Measured 2026-09-29 on the week's new apartments: p10 4.5M, p50 8M, p90 23M.
 * ⚠️ ONLY THE CARDS ARE BANDED. `homeCounts` counts every home added, because it says "added this
 * week", which is true of all of them.
 */
const HOME_PRICE_MIN = 2_000_000
const HOME_PRICE_MAX = 80_000_000
/** Over-fetch so one busy district cannot fill every card (max one card per district). */
const HOME_FETCH = 120
const DISTRICT_CHIPS = 6

export type DigestHome = {
  id: string
  /** "Apartment · 2 bed · 1 bath · 64 m²" — the importer's English title up to " for rent". */
  heading: string
  price: number
  currency: string
  image: string
  /** English district label ("Binh Thanh District"), or null when the row has none. */
  area: string | null
}

export type DigestContent = {
  homes: DigestHome[]
  homeCounts: { apartments: number; houses: number; rooms: number; total: number }
  /** Busiest curated districts among this week's homes — each one a live /c/rentals/<slug> page. */
  districts: { slug: string; label: string }[]
  /** "Also new": the best of the week's other listings (not rentals, not jobs). */
  others: DigestItem[]
  sales: DigestItem[]
}

type Row = {
  id: string
  title: string
  price: number
  currency: string
  images: string
  district: string | null
  city: string | null
  previousPrice: number | null
  priceDropAt: Date | null
  urgentUntil: Date | null
  seller: { trustScore: number }
}

const SELECT = {
  id: true, title: true, price: true, currency: true, images: true, district: true, city: true,
  previousPrice: true, priceDropAt: true, urgentUntil: true,
  seller: { select: { trustScore: true } },
} as const

function firstImage(images: string): string | null {
  try {
    const arr = JSON.parse(images)
    return Array.isArray(arr) && arr.length ? String(arr[0]) : null
  } catch {
    return null
  }
}

function toItem(l: Row): DigestItem {
  // ⚠️ THE DROP MUST STILL BE LIVE, not merely historical. This was
  // `l.previousPrice != null && l.previousPrice > l.price` with no window check at all — and
  // previousPrice is cleared ONLY on a price RAISE (price-drop.ts:86), so a listing that dropped
  // once and never raised kept it forever. The site retires the badge after DROP.BADGE_MS (3 days)
  // everywhere else, so every weekly digest from day 4 onward emailed a red "−25%" pill for a
  // discount the marketplace had already withdrawn, and the recipient clicked through to a PDP
  // showing a plain price. That is an outbound reference-price claim with no upper bound on its
  // age — the exact pattern price-drop.ts:11-14 cites EU-Omnibus Art 6a to prevent.
  const hasDrop =
    l.previousPrice != null &&
    l.previousPrice > l.price &&
    l.priceDropAt != null &&
    Date.now() - l.priceDropAt.getTime() < DROP_BADGE_MS
  return {
    id: l.id,
    title: l.title,
    price: l.price,
    currency: l.currency,
    image: firstImage(l.images),
    district: l.district || l.city || null,
    drop: hasDrop ? dropPercent(l.previousPrice as number, l.price) : null,
    urgent: !!l.urgentUntil && l.urgentUntil.getTime() > Date.now(),
    trustScore: l.seller?.trustScore ?? 100,
  }
}

/** "Apartment · 1 bed · 1 bath · 28 m² for rent — Tân Bình Ward…" → "Apartment · 1 bed · 1 bath · 28 m²". */
export function homeHeading(title: string): string {
  const cut = title.split(/\s+for rent\b/i)[0]?.trim()
  const h = cut && cut.length >= 3 ? cut : title.trim()
  return h.length > 70 ? `${h.slice(0, 67).trimEnd()}…` : h
}

type HomeRow = {
  id: string
  title: string
  price: number
  currency: string
  images: string
  district: string | null
  subcategorySlug?: string | null
  areaM2?: number | null
  attributes?: string | null
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
 * A card must not be a portal typo. Measured in the first live render (2026-09-29): "House · 3 bed ·
 * 2 bath · 16.5 m²" at 16,000,000 đ — the importer carried the plot WIDTH or a single room's size as
 * the floor area. A home under 12 m², or under 15 m² per bedroom, is left off the cards (it still
 * counts in `homeCounts` and still exists on the site).
 */
export function plausibleHome(r: Pick<HomeRow, 'areaM2' | 'attributes'>): boolean {
  if (r.areaM2 == null) return true
  if (r.areaM2 < 12) return false
  const beds = bedroomsOf(r.attributes)
  return beds == null || r.areaM2 >= 15 * beds
}

/**
 * Six homes from the week, AT MOST ONE PER DISTRICT, best rankScore first. Without the district cap
 * the busiest importer district (Gò Vấp had 579 of the week's homes) takes every card, and six
 * near-identical studios in one district read as a feed dump rather than a pick.
 *
 * ⚠️ APARTMENTS AND HOUSES FIRST, ROOMS ONLY TO FILL. The people this email is for search "apartment
 * for rent" (eno's /c/rentals is built for that query); the first live render gave two of six cards
 * to 15–30 m² rooms because rooms rank as fresh as anything else. Rooms still count and still fill a
 * quiet week.
 */
export function pickHomes(rows: readonly HomeRow[], count = HOME_COUNT): DigestHome[] {
  const seen = new Set<string>()
  const out: DigestHome[] = []
  const take = (r: HomeRow) => {
    const image = firstImage(r.images)
    if (!image || !plausibleHome(r)) return
    const slug = r.district?.trim() ? districtLinkSlug(r.district) : ''
    // A row with no district still gets a card, but only one such card.
    const key = slug || '(none)'
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      id: r.id,
      heading: homeHeading(r.title),
      price: r.price,
      currency: r.currency,
      image,
      area: slug ? districtLabel(slug, r.district).en : null,
    })
  }
  const isRoom = (r: HomeRow) => r.subcategorySlug === 'room-rental'
  for (const r of rows) { if (out.length < count && !isRoom(r)) take(r) }
  for (const r of rows) { if (out.length < count && isRoom(r)) take(r) }
  return out
}

export async function getDigestContent(): Promise<DigestContent> {
  const dropCutoff = new Date(Date.now() - DROP_WINDOW_MS)
  const now = new Date()
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  // The week's homes, for the counts and the district chips — wrapped whole (see the sales query).
  const homesThisWeek = await scopedListingWhere({
    verified: true,
    status: 'active',
    category: { slug: 'rentals' },
    subcategorySlug: { in: [...HOME_SUBCATS] },
    createdAt: { gte: weekAgo },
  })
  const [homeRows, countRows, districtRows, topRows, saleRows] = await Promise.all([
    // Homes — the same "best of what is new" rule as below, widened only as far as needed.
    (async () => {
      let rows: HomeRow[] = []
      for (const windowMs of HOME_WINDOWS_MS) {
        rows = await db.listing.findMany({
          where: await scopedListingWhere({
            verified: true,
            status: 'active',
            category: { slug: 'rentals' },
            subcategorySlug: { in: [...HOME_SUBCATS] },
            price: { gte: HOME_PRICE_MIN, lte: HOME_PRICE_MAX },
            createdAt: { gte: new Date(Date.now() - windowMs) },
          }),
          orderBy: [{ rankScore: 'desc' }, { id: 'desc' }],
          take: HOME_FETCH,
          select: { id: true, title: true, price: true, currency: true, images: true, district: true, subcategorySlug: true, areaM2: true, attributes: true },
        })
        if (pickHomes(rows).length >= HOME_COUNT) break
      }
      return rows
    })(),
    db.listing.groupBy({ by: ['subcategorySlug'], where: homesThisWeek, _count: { _all: true } }),
    db.listing.groupBy({ by: ['district'], where: homesThisWeek, _count: { _all: true } }),
    // "Also new" — THE BEST OF WHAT IS NEW, not the best of all time. The window is the filter and
    // rankScore only orders within it (see TOP_WINDOWS_MS). Widen only as far as needed: a busy week
    // never leaves the 7-day window, and a quiet one still prefers the most recent listings rather
    // than falling back to the same all-time winners the old query kept re-sending.
    (async () => {
      for (const windowMs of TOP_WINDOWS_MS) {
        const rows = await db.listing.findMany({
          // Not a job: the digest prints "— <price>", not true of a linked job posting at price 0
          // (scripts/import-jobs.ts). Not a rental: the homes section above owns those.
          // Wrapped whole, like every other query here: spreading a scoped fragment beside new keys
          // is the collision trap the sales query below describes.
          where: await scopedListingWhere({
            verified: true,
            status: 'active',
            listingType: { not: 'job' },
            category: { slug: { not: 'rentals' } },
            createdAt: { gte: new Date(Date.now() - windowMs) },
          }),
          orderBy: [{ rankScore: 'desc' }, { id: 'desc' }],
          take: TOP_COUNT,
          select: SELECT,
        })
        // Only the LAST window may return a short list; earlier ones widen instead of settling.
        if (rows.length >= TOP_COUNT || windowMs === TOP_WINDOWS_MS[TOP_WINDOWS_MS.length - 1]) return rows
      }
      return []
    })(),
    // Moving sales — a recent real drop (priceDropAt within the window) OR still urgent.
    // Over-fetch, then post-filter the previousPrice>price compare Prisma can't express.
    db.listing.findMany({
      // Wrapped whole: the existing OR survives as one operand of the generated AND. Spreading the
      // raw fragment beside it would be the collision trap.
      where: await scopedListingWhere({
        verified: true,
        status: 'active',
        OR: [
          { previousPrice: { not: null }, priceDropAt: { gte: dropCutoff } },
          { urgentUntil: { gt: now } },
        ],
      }),
      orderBy: [{ priceDropAt: 'desc' }, { rankScore: 'desc' }],
      take: 16,
      select: SELECT,
    }),
  ])

  const others = topRows.map(toItem)
  const homes = pickHomes(homeRows)
  const shownIds = new Set([...others, ...homes].map((t) => t.id))
  // Keep only genuine sales (a real drop or currently urgent), never duplicate a card above.
  const sales = saleRows
    .map(toItem)
    .filter((s) => (s.drop || s.urgent) && !shownIds.has(s.id))
    .slice(0, 4)

  const count = (slug: string) => countRows.find((r) => r.subcategorySlug === slug)?._count._all ?? 0
  const apartments = count('apartment-rental')
  const houses = count('house-rental')
  const rooms = count('room-rental')

  // ⚠️ CURATED DISTRICTS ONLY: every chip is a link, and only a curated district is guaranteed a live
  // /c/rentals/<slug> page (the rest can 404 since the 2026-09-27 real-404 work). The count only
  // ORDERS the chips and is never printed — it is a stored-name tally, not the page's scope.
  const districts = mergeDistrictGroups(districtRows.map((g) => ({ district: g.district, count: g._count._all })))
    .filter((c) => isCuratedDistrict(c.slug))
    .slice(0, DISTRICT_CHIPS)
    .map((c) => ({ slug: c.slug, label: c.label.en }))

  return {
    homes,
    homeCounts: { apartments, houses, rooms, total: apartments + houses + rooms },
    districts,
    others,
    sales,
  }
}
