import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { bumpBrandCount } from '@/lib/brand'
import { reindexListing } from '@/lib/listing-index'
import { fold } from '@/lib/fold'
import { LISTING_CARD_SELECT, serializeListingCard } from '@/lib/serialize'

export const dynamic = 'force-dynamic'

// Admin listings tool — browse + batch-act on listings. Every action re-checks
// getAdmin(). GET lists (search/status/verified filters, paginated); POST runs a
// batch action over selected ids.

export async function GET(req: NextRequest) {
  if (!(await getAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  const status = searchParams.get('status') // active | hidden | sold | all
  const verified = searchParams.get('verified') // true | false | all
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 100)
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)

  const AND: Record<string, unknown>[] = []
  if (q) AND.push({ searchText: { contains: fold(q) } })
  if (status && status !== 'all') AND.push({ status })
  if (verified === 'true') AND.push({ verified: true })
  else if (verified === 'false') AND.push({ verified: false })
  const where = AND.length ? { AND } : {}

  // ⚠️ CARD serializer + CARD select, matched ON PURPOSE. This handler used to feed
  // serializeListing (the FULL-listing serializer) a seller narrowed to {name,
  // trustScore} behind an `as never` — the serializer's `seller.memberSince
  // .toISOString()` then threw on EVERY request, a deterministic 500 the cast had
  // silenced since the two shipped together. Nothing e2e-opens this queue, so it
  // surfaced only when the desk did (prod 5xx alert, 2026-07-23). The card
  // projection carries everything this table renders; the admin extras ride the row.
  const [rows, total] = await Promise.all([
    db.listing.findMany({
      where,
      select: {
        ...LISTING_CARD_SELECT,
        status: true,
        featured: true,
        createdAt: true,
        seller: { select: { name: true, trustScore: true, owner: { select: { accountType: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.listing.count({ where }),
  ])

  const listings = rows.map((r) => {
    const l = serializeListingCard(r)
    return { id: l.id, title: l.titleVi || l.title, price: l.price, currency: l.currency, image: l.images[0] ?? null, status: r.status, verified: r.verified, featured: r.featured, sellerName: r.seller.name, category: l.category.name, createdAt: r.createdAt.toISOString() }
  })
  return NextResponse.json({ listings, total })
}

export async function POST(req: NextRequest) {
  if (!(await getAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: { action?: string; ids?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string').slice(0, 500) : []
  if (!ids.length) return NextResponse.json({ error: 'no_ids' }, { status: 400 })

  let affected = 0
  switch (body.action) {
    case 'delete': {
      // Decrement brand counts for any branded listings before they're gone.
      const branded = await db.listing.findMany({ where: { id: { in: ids }, brandSlug: { not: null } }, select: { brandSlug: true } })
      const byBrand = new Map<string, number>()
      for (const b of branded) if (b.brandSlug) byBrand.set(b.brandSlug, (byBrand.get(b.brandSlug) ?? 0) + 1)
      const res = await db.listing.deleteMany({ where: { id: { in: ids } } })
      affected = res.count
      await Promise.all([...byBrand].map(([slug, n]) => bumpBrandCount(slug, -n)))
      break
    }
    case 'hide': affected = (await db.listing.updateMany({ where: { id: { in: ids } }, data: { status: 'hidden' } })).count; break
    case 'activate': affected = (await db.listing.updateMany({ where: { id: { in: ids } }, data: { status: 'active' } })).count; break
    case 'feature': affected = (await db.listing.updateMany({ where: { id: { in: ids } }, data: { featured: true } })).count; break
    case 'unfeature': affected = (await db.listing.updateMany({ where: { id: { in: ids } }, data: { featured: false } })).count; break
    case 'verify': affected = (await db.listing.updateMany({ where: { id: { in: ids } }, data: { verified: true } })).count; break
    case 'unverify': affected = (await db.listing.updateMany({ where: { id: { in: ids } }, data: { verified: false } })).count; break
    default: return NextResponse.json({ error: 'bad_action' }, { status: 400 })
  }

  revalidatePath('/')
  // Sync AI search: each id upserts if it's still public, else drops out (handles
  // hide/unverify/delete → remove, activate/verify → add, feature → refresh).
  after(() => { for (const id of ids) reindexListing(id) })
  return NextResponse.json({ ok: true, affected })
}
