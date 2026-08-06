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
//
// ⚠️ WS6 — NOT MIGRATED, for two independent reasons.
//
// 1. Authorization is `checkListingOwner()`, which resolves the caller itself
//    (`getCurrentProfile()`) and answers FOUR outcomes — 401 auth_required · 403 no_storefront ·
//    404 not_found · 403 forbidden. `auth: 'profile'` emits only the 401 and would resolve the
//    caller a SECOND time (extra auth-server round-trip + extra Profile read) for no wire change;
//    `auth: 'public'` leaves every option empty, i.e. churn. The one-parameter unlock in
//    src/lib/listing-owner.ts is described in ../route.ts; that file is shared with confirm/ and
//    buyers/, outside this cluster, so it is deliberately untouched.
//
// 2. A MISSING, EMPTY, `null` OR UNPARSEABLE BODY IS A SUCCESS HERE, not a 400 — it means "a plain
//    sold with no attribution", which is what the web dashboard's Mark-sold sends. `body:` would
//    turn that 200 into a 400 and break marking a listing sold from anywhere but the native confirm
//    sheet. The `|| {}` on line below exists because `req.json()` RETURNS null for a literal `null`
//    payload rather than throwing; a zod schema would reject it.
//
// Branches held as-is: guest → 401 auth_required · no storefront → 403 no_storefront · unknown id
// → 404 not_found · not the owner → 403 forbidden · non-UUID buyerProfileId → 400 invalid_buyer ·
// buyer with no thread on this seller → 400 buyer_not_in_conversations · core refusal → r.code
// with r.error · success → 200 {"ok":true}.
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
