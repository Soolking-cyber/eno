import { NextRequest, NextResponse } from 'next/server'
import { checkListingOwner } from '@/lib/listing-owner'
import { setStatusCore } from '@/lib/core/listings'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Mark an OWNED listing sold WITH attribution — the native "Mark sold" confirm sheet
// records who/where it sold: { channel: 'eno' | 'external', buyerProfileId?, platform? }.
//   - 'eno'      → buyerProfileId MUST own a conversation on this listing (anti-spoof).
//   - 'external' → platform is free text (the marketplace they sold on).
//   - neither    → a plain sold with no attribution.
// Delegates to setStatusCore, so the cache purge / de-index / partner webhooks all fire.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })

  // `|| {}` guards the literal `null` payload (req.json() returns null, not throws).
  let body: { channel?: unknown; buyerProfileId?: unknown; platform?: unknown } = {}
  try { body = (await req.json()) || {} } catch { /* empty/invalid body → plain sold */ }

  const rawBuyer = typeof body.buyerProfileId === 'string' ? body.buyerProfileId : null
  const channel = body.channel === 'external' ? 'external' : rawBuyer ? 'eno' : null
  let buyerProfileId: string | null = null
  let platform: string | null = null

  if (channel === 'eno') {
    // Buyer id feeds a @db.Uuid column — a malformed value makes Prisma throw a
    // validation error (500), so reject non-UUIDs up front with a clean 400.
    if (!UUID_RE.test(rawBuyer!)) return NextResponse.json({ error: 'invalid_buyer' }, { status: 400 })
    // Never trust a client-supplied buyer id — it must be a real conversation buyer of
    // THIS seller (matches the seller-scoped /buyers picker; anti-spoof without dropping
    // buyers whose thread has since retargeted to another listing).
    const convo = await db.conversation.findFirst({
      where: { sellerId: auth.sellerId, buyerProfileId: rawBuyer! },
      select: { id: true },
    })
    if (!convo) return NextResponse.json({ error: 'buyer_not_in_conversations' }, { status: 400 })
    buyerProfileId = rawBuyer
  } else if (channel === 'external') {
    // Coerce defensively — a non-string platform would throw on .trim().
    platform = (typeof body.platform === 'string' ? body.platform : '').trim().slice(0, 60) || null
  }

  const r = await setStatusCore(id, 'sold', { channel, buyerProfileId, platform })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code })
  return NextResponse.json({ ok: true })
}
