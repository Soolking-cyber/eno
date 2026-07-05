import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile, getCurrentProfileId } from '@/lib/admin'
import { insertMessage, type SerializedMessage } from '@/lib/messages'
import { sendPushToProfile } from '@/lib/push'
import { rateLimit } from '@/lib/ratelimit'
import { conversationGate } from '@/lib/enforcement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST: ensure a conversation exists for { listingId } with the current user as
// buyer (idempotent — one thread per buyer per listing). Returns { id }.
export async function POST(req: Request) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  // Each new thread fires a seller notification + web-push, so cap contact-initiations per
  // user — generous for real buyers (dozens/hour), but stops a script mass-spamming sellers.
  const rl = await rateLimit('conversation-create', profile.id, 30, '1 h')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { listingId?: string; message?: string; offerAmount?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const listingId = String(body.listingId || '').trim()
  if (!listingId) return NextResponse.json({ error: 'missing_listing' }, { status: 400 })
  // Optional first message — lets the composer create the thread AND send in one
  // round trip (snappier; the message side effects live in insertMessage).
  const initialMessage = String(body.message || '').trim().slice(0, 2000)
  // Optional STRUCTURED first offer (kind='offer' → renders as an offer card,
  // identical to in-thread offers) with an optional note alongside it.
  const rawAmount = Number(body.offerAmount)
  const isOffer = Number.isFinite(rawAmount) && rawAmount > 0
  const offerAmount = isOffer ? Math.min(Math.round(rawAmount), 1e12) : undefined

  const listing = await db.listing.findUnique({
    where: { id: listingId },
    select: { id: true, title: true, verified: true, sellerId: true, seller: { select: { ownerId: true } } },
  })
  if (!listing || !listing.verified) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Can't message your own storefront.
  if (listing.seller.ownerId && listing.seller.ownerId === profile.id) {
    return NextResponse.json({ error: 'own_listing' }, { status: 400 })
  }

  // Enforcement + probation (trust Phase 2): suspended blocks all conversation
  // activity; a probation account is capped on NEW threads per day — an existing
  // thread is exempt (the cap is on new outreach, not on continuing one).
  const gate = await conversationGate(profile.id)
  if (gate) {
    const existing = gate.error === 'account_suspended'
      ? null
      : await db.conversation.findUnique({
          where: { listingId_buyerProfileId: { listingId, buyerProfileId: profile.id } },
          select: { id: true },
        })
    if (!existing) return NextResponse.json(gate, { status: 403 })
  }

  // Create the conversation, letting the unique (listingId, buyerProfileId)
  // constraint be the single source of truth for new-vs-existing. `created` stays
  // accurate even under a double-tap / concurrent POST race (a non-atomic
  // read-then-upsert could report created:true for BOTH racers and double-count
  // the lead). A P2002 means the thread already exists → reuse it, created:false.
  const sellerProfileId = listing.seller.ownerId ?? null
  try {
    const convo = await db.conversation.create({
      data: {
        listingId,
        buyerProfileId: profile.id,
        sellerId: listing.sellerId,
        sellerProfileId,
      },
      select: { id: true },
    })
    const conv = { id: convo.id, buyerProfileId: profile.id, sellerProfileId, listingId }
    // Offer is the primary message (returned for the optimistic card); a note, if
    // present, follows as a plain message.
    let message: SerializedMessage | null = null
    if (isOffer) {
      // Offer body stays EMPTY — the offer line is derived client-side from the
      // structured offerAmount (locale + money format live in the renderer).
      message = await insertMessage(conv, profile.id, '', { kind: 'offer', offerAmount })
      if (initialMessage) await insertMessage(conv, profile.id, initialMessage)
    } else if (initialMessage) {
      message = await insertMessage(conv, profile.id, initialMessage)
    }
    // First-lead milestone: if THIS brand-new thread is the listing's first-ever
    // conversation, celebrate it once for the seller (bell + best-effort push).
    // Out of the hot path (after the response flushes), fail-quiet by design —
    // one thread per buyer per listing, so "count === 1" means exactly this one.
    if (sellerProfileId) {
      const newConvoId = convo.id
      const listingTitle = listing.title
      after(async () => {
        try {
          const threads = await db.conversation.findMany({ where: { listingId }, select: { id: true }, take: 2 })
          if (threads.length !== 1) return
          const title = 'First interested buyer!'
          const body = `"${listingTitle.slice(0, 80)}" just got its first message — reply quickly to keep them.`
          await db.notification.create({
            data: { recipientId: sellerProfileId, type: 'milestone', title, body, conversationId: newConvoId, listingId },
          })
          await sendPushToProfile(sellerProfileId, { title, body, url: `/messages/${newConvoId}`, tag: `convo-${newConvoId}` })
        } catch (e) {
          console.error('[conversations] first-lead milestone', e)
        }
      })
    }
    return NextResponse.json({ id: convo.id, created: true, message })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      const existing = await db.conversation.findUnique({
        where: { listingId_buyerProfileId: { listingId, buyerProfileId: profile.id } },
        select: { id: true },
      })
      if (existing) {
        // Thread already exists → still deliver the offer/message (reuse it).
        const conv = { id: existing.id, buyerProfileId: profile.id, sellerProfileId, listingId }
        let message: SerializedMessage | null = null
        if (isOffer) {
          // Offer body stays EMPTY — the offer line is derived client-side from the
      // structured offerAmount (locale + money format live in the renderer).
      message = await insertMessage(conv, profile.id, '', { kind: 'offer', offerAmount })
          if (initialMessage) await insertMessage(conv, profile.id, initialMessage)
        } else if (initialMessage) {
          message = await insertMessage(conv, profile.id, initialMessage)
        }
        return NextResponse.json({ id: existing.id, created: false, message })
      }
    }
    throw e
  }
}

// GET: the current user's inbox (conversations they're a participant in), newest first.
// Fast-path auth (getClaims, no network/DB) — read-only, the Profile already exists
// for any conversation. POST-create below keeps getCurrentProfile for provisioning.
export async function GET() {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const rows = await db.conversation.findMany({
    where: { OR: [{ buyerProfileId: meId }, { sellerProfileId: meId }] },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
    select: {
      id: true, lastMessageAt: true, lastMessageText: true,
      buyerProfileId: true, buyerUnread: true, sellerUnread: true,
      buyerDeletedAt: true, sellerDeletedAt: true,
      listing: { select: { id: true, title: true, images: true } },
      seller: { select: { id: true, name: true, avatarColor: true, avatarUrl: true } },
      buyer: { select: { displayName: true, email: true, avatarColor: true, avatarUrl: true } },
      // Latest message — to show offer direction/status in the inbox row.
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { senderProfileId: true, kind: true, offerStatus: true, offerAmount: true } },
    },
  })

  const conversations = rows.filter((c) => {
    // Hide conversations this user "deleted" — until a newer message arrives
    // (lastMessageAt > the delete time), at which point it reappears.
    const myDeletedAt = c.buyerProfileId === meId ? c.buyerDeletedAt : c.sellerDeletedAt
    return !(myDeletedAt && c.lastMessageAt <= myDeletedAt)
  }).map((c) => {
    const iAmBuyer = c.buyerProfileId === meId
    const img = (() => { try { return (JSON.parse(c.listing.images || '[]')[0] as string) ?? null } catch { return null } })()
    const lastMsg = c.messages[0]
    const lastOffer = lastMsg?.kind === 'offer'
      ? { mine: lastMsg.senderProfileId === meId, amount: lastMsg.offerAmount, status: lastMsg.offerStatus }
      : null
    return {
      id: c.id,
      listingId: c.listing.id,
      listingTitle: c.listing.title,
      listingImage: img,
      lastMessageAt: c.lastMessageAt.toISOString(),
      lastMessageText: c.lastMessageText,
      lastOffer,
      unread: iAmBuyer ? c.buyerUnread : c.sellerUnread,
      // The OTHER party's display identity.
      counterpart: iAmBuyer
        ? { name: c.seller.name, avatarColor: c.seller.avatarColor, avatarUrl: c.seller.avatarUrl }
        : { name: c.buyer.displayName || c.buyer.email || 'Buyer', avatarColor: c.buyer.avatarColor, avatarUrl: c.buyer.avatarUrl },
    }
  })
  return NextResponse.json({ conversations })
}
