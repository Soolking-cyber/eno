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
  const hasDrop = l.previousPrice != null && l.previousPrice > l.price
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
    // Top products — the bounded trust⊕recency blend (rankScore), same as "Recommended".
    db.listing.findMany({
      where: liveWhere,
      orderBy: [{ rankScore: 'desc' }, { id: 'desc' }],
      take: 6,
      select: SELECT,
    }),
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
