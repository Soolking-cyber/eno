import { scopedListingWhere } from '@/lib/edition-scope'
import { db } from '@/lib/db'
import { dropPercent } from '@/lib/vnd'

// Content for the weekly digest email — "top products" (the trust⊕recency blend, same
// order as the Recommended feed) + "moving sales" (a recent real price drop OR an
// active "Bán gấp" urgent flag). Computed ONCE per cron run and shared across all
// recipients (the digest is not personalised in v1).

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
const TOP_COUNT = 6

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

export async function getDigestContent(): Promise<{ top: DigestItem[]; sales: DigestItem[] }> {
  const dropCutoff = new Date(Date.now() - DROP_WINDOW_MS)
  const now = new Date()

  // Hoisted: both queries below build ONE email, so they must share a predicate. An await inside a
  // Promise.all element would also serialise the pair.
  const liveWhere = await scopedListingWhere({ verified: true, status: 'active' })
  const [topRows, saleRows] = await Promise.all([
    // Top products — THE BEST OF WHAT IS NEW, not the best of all time. The window is the filter and
    // rankScore only orders within it (see TOP_WINDOWS_MS). Widen only as far as needed: a busy week
    // never leaves the 7-day window, and a quiet one still prefers the most recent listings rather
    // than falling back to the same all-time winners the old query kept re-sending.
    (async () => {
      for (const windowMs of TOP_WINDOWS_MS) {
        const rows = await db.listing.findMany({
          where: { ...liveWhere, createdAt: { gte: new Date(Date.now() - windowMs) } },
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

  const top = topRows.map(toItem)
  const topIds = new Set(top.map((t) => t.id))
  // Keep only genuine sales (a real drop or currently urgent), never duplicate a top pick.
  const sales = saleRows
    .map(toItem)
    .filter((s) => (s.drop || s.urgent) && !topIds.has(s.id))
    .slice(0, 4)

  return { top, sales }
}
