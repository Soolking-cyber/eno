import { NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { recordReview } from '@/lib/trust'
import { messagingGate } from '@/lib/enforcement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/sellers/[id]/reviews — a REAL buyer reviews a seller after a
// transaction, making the storefront "Verified buyer" badge earnable.
//
// Server-side gate (Prisma bypasses RLS — these checks ARE the guard):
//   1. signed in (401)
//   2. the conversation exists (404)
//   3. the caller is that conversation's BUYER (403)
//   4. the conversation's listing belongs to seller [id] (403)
//   5. a transaction actually happened: listing sold OR an offer in this thread
//      was accepted (403 'not_transacted')
//   6. one review per conversation — the DB unique index on conversationId is the
//      dedup (P2002 → 409 'already_reviewed')
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await getCurrentProfile()
  if (!me) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const rl = await rateLimit('review-create', me.id, 10, '1 h')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  // Enforcement (trust Phase 2): a suspended account can't leave reviews.
  const gate = await messagingGate(me.id)
  if (gate) return NextResponse.json(gate, { status: 403 })

  let body: { conversationId?: string; rating?: number; text?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const conversationId = String(body.conversationId || '')
  const rating = Number(body.rating)
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!conversationId || !Number.isInteger(rating) || rating < 1 || rating > 5 || text.length > 600) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const convo = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, buyerProfileId: true, listing: { select: { id: true, sellerId: true, status: true } } },
  })
  if (!convo) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // Only the conversation's BUYER may review (the seller is the subject).
  if (convo.buyerProfileId !== me.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  // The reviewed storefront must own the listing this conversation is about.
  if (convo.listing.sellerId !== id) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Transaction signal: the listing was sold, or an offer in THIS thread was accepted.
  const transacted =
    convo.listing.status === 'sold' ||
    (await db.message.count({ where: { conversationId, kind: 'offer', offerStatus: 'accepted' } })) > 0
  if (!transacted) return NextResponse.json({ error: 'not_transacted' }, { status: 403 })

  const author = me.displayName || me.email?.split('@')[0] || 'Buyer'
  let review: { id: string }
  try {
    review = await db.review.create({
      data: {
        sellerId: id,
        author,
        rating,
        text,
        authorProfileId: me.id,
        listingId: convo.listing.id,
        conversationId,
      },
      select: { id: true },
    })
  } catch (e) {
    const code = (e as { code?: string })?.code
    // The unique index on conversationId = one review per conversation.
    if (code === 'P2002') return NextResponse.json({ error: 'already_reviewed' }, { status: 409 })
    // Pre-migration DB (scripts/add-review-cols.mjs not yet run): the provenance
    // columns don't exist → retryable 503 instead of a 500, so this code can
    // deploy before the migration in any order.
    if (code === 'P2022' || /column .* does not exist/i.test(String((e as Error)?.message))) {
      return NextResponse.json({ error: 'migration_pending' }, { status: 503 })
    }
    throw e
  }

  // After the response flushes (zero added latency): refresh the storefront's
  // denormalized rating/reviewCount, and credit the seller's OWNER with the
  // verified-review trust event. Guest sellers (ownerId null) have no Profile to
  // attach an event to → skip trust silently (penalizeSeller's convention).
  after(async () => {
    try {
      const [seller, agg] = await Promise.all([
        db.seller.findUnique({ where: { id }, select: { ownerId: true } }),
        db.review.aggregate({ where: { sellerId: id }, _avg: { rating: true }, _count: { _all: true } }),
      ])
      await db.seller.update({
        where: { id },
        data: { rating: agg._avg.rating ?? rating, reviewCount: agg._count._all },
      })
      if (seller?.ownerId) await recordReview(seller.ownerId)
    } catch (err) {
      console.error('[reviews] post-create denorm/trust failed', err)
    }
  })

  return NextResponse.json({ ok: true, id: review.id }, { status: 201 })
}
