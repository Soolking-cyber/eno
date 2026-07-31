import { deskSellerIds, scopedListingWhere } from '@/lib/edition-scope'
import { IS_MARKETPLACE } from '@/lib/edition'
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile, getCurrentProfileId } from '@/lib/admin'
import { insertMessage, type SerializedMessage } from '@/lib/messages'
import { sendPushToProfile } from '@/lib/push'
import { rateLimit } from '@/lib/ratelimit'
import { conversationGate } from '@/lib/enforcement'
import { maskEmailHandle } from '@/lib/utils'
import { recordFixedPriceOfferAttempt } from '@/lib/offer-guard'
import { threadKind } from '@/lib/thread-kind'
import { getVisaShopSeller, isVisaShopListing } from '@/lib/visa-shop'
import { VISA_SUBCATEGORY_SLUG } from '@/lib/taxonomy'
import { startVisaDmFlow } from '@/lib/visa/dm-flow'

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

  // findFirst — scopedListingWhere returns an { AND: [...] } wrapper with no top-level unique
  // field, which ListingWhereUniqueInput rejects. On eno.vn a desk listing now resolves to null, so
  // no conversation can be opened against a service the licensed marketplace does not offer.
  const listing = await db.listing.findFirst({
    where: await scopedListingWhere({ id: listingId }),
    // subcategorySlug is the local "is this a visa product?" second opinion the uncertainty check
    // below needs — see the note there; it costs nothing on a row we already fetch.
    select: { id: true, title: true, verified: true, negotiable: true, sellerId: true, subcategorySlug: true, seller: { select: { ownerId: true } } },
  })
  if (!listing || !listing.verified) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Can't message your own storefront.
  if (listing.seller.ownerId && listing.seller.ownerId === profile.id) {
    return NextResponse.json({ error: 'own_listing' }, { status: 400 })
  }

  // ⚠️ ENFORCEMENT RUNS BEFORE THE VISA BRANCH, AND THE ORDER IS THE SECURITY PROPERTY.
  //
  // My first cut put the visa branch above this, which handed suspended and probation accounts a
  // clean bypass: every other route into a thread passes through conversationGate, and a visa
  // listing would have been the one door that did not. Found independently by BOTH reviewers.
  // Nothing below this line may be reordered above it.
  //
  // Suspension blocks outright; probation caps NEW outreach but exempts a seller this buyer
  // already has a thread with — which is why the visa branch is safe underneath it, since
  // startVisaDmFlow reuses an existing case rather than opening fresh outreach.
  const gate = await conversationGate(profile.id)
  if (gate) {
    const existing = gate.error === 'account_suspended'
      ? null
      : await db.conversation.findFirst({
          where: { sellerId: listing.sellerId, buyerProfileId: profile.id },
          select: { id: true },
        })
    if (!existing) return NextResponse.json(gate, { status: 403 })
  }

  // ⚠️ CONTACTING A VISA PRODUCT STARTS THE APPLICATION — IT DOES NOT OPEN A CHAT.
  //
  // The PDP already knew this: it renders <VisaStart> instead of <ContactComposer>, because the
  // whole application happens inside the thread and only the server emits step 1. But the PDP is
  // not the only way to contact a listing — listing-card.tsx, compact-listing-row.tsx and
  // listings-video-feed.tsx all stash a quick-compose and push to /messages/pending, which lands
  // HERE. None of them knew about visa, so tapping Message on a visa product anywhere except the
  // PDP opened a blank conversation with "Hi! Is this still available?" in it, and no wizard ever
  // began. Reported by the owner as "message button on visa related posts all should start
  // application process and not chat" — and it is the same reason the iOS app could not apply,
  // since the native shell is this web app in a WebView and its users reach products through the
  // feed rather than by URL.
  //
  // The fix belongs at THIS chokepoint rather than in three cards: every entry point already
  // funnels through here, so one predicate fixes all of them at once and any FUTURE contact
  // surface inherits it. The same "one predicate everywhere" rule the shared visa/trip desk
  // taught us — see isVisaShopListing, which is deliberately wider than resolveVisaProduct so a
  // half-built product still gets the application flow rather than silently falling back to chat.
  //
  // ⚠️ ANY TYPED MESSAGE OR OFFER IS DELIBERATELY DROPPED. Posting "Is this still available?" into
  // a government-form thread is nonsense, and an offer on a fixed-fee service is worse. The card
  // buttons attach that opener without asking, so it is discarded here rather than trusted — the
  // same call the trip planner made when its CTA stopped posting a canned line nobody read.
  const isVisaProduct = await isVisaShopListing(listing.id)

  // ⚠️ "COULD NOT TELL" MUST NOT MEAN "NOT A VISA PRODUCT". isVisaShopListing answers from the
  // desk storefront read, which swallows its own errors and returns [] — so a transient blip would
  // classify a real visa product as an ordinary listing and open exactly the blank chat this whole
  // branch exists to prevent, permanently, with a push notification to the desk. Both reviewers
  // called the fail-open wrong and they were right.
  //
  // The listing's OWN subcategory is the local second opinion: it needs no desk lookup and cannot
  // blip. When it says visa but the storefront read disagreed, we are uncertain rather than
  // informed, so the honest answer is a retryable 503 — never a chat we cannot undo.
  //
  // Deliberately NOT "fail closed whenever the desk is unreachable": that would 503 every ordinary
  // listing's Message button on a deployment where the visa desk simply is not seeded.
  // ⚠️ THE PREDICATE MIRRORS getVisaShopListings' OWN `where`, and that is the point. That query is
  // EXCLUDE-shaped — a desk row counts as visa unless it DECLARES a different subcategory — so
  // testing only for an explicit `visa-legal` slug left the null case open: a visa product whose
  // subcategory was never set would still have fallen through to a permanent blank chat. codex
  // caught that my first fail-closed guard was incomplete. Measured 2026-07-29: 0 of 35 listings
  // have a null subcategory and all 14 visa products carry `visa-legal`, so the hole is currently
  // empty — which is a reason to close it cheaply, not a reason to leave it.
  //
  // The trip-assistance anchor lives on the SAME storefront and declares `service-other`, so it is
  // correctly excluded here rather than 503-ing the trip desk. And when the desk seller itself
  // cannot be resolved, the slug test still stands on its own.
  // ⚠️ SCOPED TO THE DESK SELLER, BOTH BRANCHES. `visa-legal` is a PUBLIC subcategory — a law firm
  // or agency can post under it — so testing the slug alone would have handed every such seller a
  // permanent 503 on their Message button, since isVisaShopListing correctly says false for a row
  // that is not the desk's. Only the desk's own rows can be visa PRODUCTS. codex caught this;
  // measured 2026-07-29, all 14 `visa-legal` rows are the desk's today, which makes it a latent
  // trap rather than a live outage — and exactly the kind that ships unnoticed.
  const visaDesk = await getVisaShopSeller()
  const mightBeVisa = visaDesk
    ? listing.sellerId === visaDesk.id
      && (listing.subcategorySlug === VISA_SUBCATEGORY_SLUG || listing.subcategorySlug === null)
    // The desk itself is unresolvable, so sellers cannot be compared at all. In that state
    // isVisaShopListing is false for EVERY row, so the explicit slug is the only signal left — and
    // a transient 503 beats a permanent blank chat on a real visa product. An ordinary seller's
    // visa-legal listing is only affected while the desk lookup is down.
    : listing.subcategorySlug === VISA_SUBCATEGORY_SLUG
  if (!isVisaProduct && mightBeVisa) {
    /**
     * ⚠️ ON THE MARKETPLACE EDITION THIS ANSWERS 404, NOT 503, AND THE DIFFERENCE IS THE WHOLE
     * POINT. A desk listing never reaches here — the scoped lookup above already 404s it — but a
     * THIRD-PARTY listing filed under the visa subcategory would, and `shop_unavailable` with a
     * retry-shaped 503 tells the caller that a visa shop exists and is temporarily down. On a
     * licensed sàn TMĐT that is an advertisement. eno.forum keeps the honest 503, which is what it
     * is for: "we could not tell, try again" rather than "no chat for you".
     */
    if (IS_MARKETPLACE) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ error: 'shop_unavailable' }, { status: 503 })
  }

  if (isVisaProduct) {
    const started = await startVisaDmFlow({
      userId: profile.id,
      email: profile.email || '',
      listingId: listing.id,
      // The SAME 'visa-create' quota the dashboard and /api/visa/applications/start charge, so
      // this entry point cannot be used to mint government forms around that budget.
      allowCreate: async () => (await rateLimit('visa-create', profile.id, 5, '24 h', { strict: true })).success,
    })
    if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status })
    // `id` so every existing caller works unchanged — /messages/pending reads it and routes to the
    // thread, where step 1 is already waiting. `created: false` keeps the contact-seller analytics
    // event off a government form; `visa: true` lets a caller that cares tell the difference.
    // `discardedInput` is not decoration: the caller asked us to send something and we did not, so
    // a 200 that stayed silent about it would be a small lie. Reviewers asked for the signal.
    return NextResponse.json({
      id: started.conversationId,
      created: false,
      visa: true,
      ...(initialMessage || isOffer ? { discardedInput: true } : {}),
    })
  }

  // Fixed-price listing → no opening offer (UI hides it; this is the bypass/stale-tab
  // path). Reject and dock trust past a grace. Plain first messages are unaffected.
  if (isOffer && !listing.negotiable) {
    await recordFixedPriceOfferAttempt(profile.id)
    return NextResponse.json({ error: 'not_negotiable' }, { status: 409 })
  }

  // Create the conversation, letting the unique (listingId, buyerProfileId)
  // constraint be the single source of truth for new-vs-existing. `created` stays
  // accurate even under a double-tap / concurrent POST race (a non-atomic
  // read-then-upsert could report created:true for BOTH racers and double-count
  // the lead). A P2002 means the thread already exists → reuse it, created:false.
  const sellerProfileId = listing.seller.ownerId ?? null

  // Deliver the optional first message into a just-resolved thread. The offer is
  // the primary message (returned for the optimistic card); its body stays EMPTY —
  // the offer line is derived client-side from the structured offerAmount (locale
  // + money format live in the renderer). A note, if present, follows as a plain
  // message. Shared by all three resolution paths (seller-thread reuse / fresh
  // create / P2002 race fallback) so their delivery semantics can't drift.
  const deliverFirstMessage = async (conv: {
    id: string; buyerProfileId: string; sellerProfileId: string | null; listingId: string
  }): Promise<SerializedMessage | null> => {
    let message: SerializedMessage | null = null
    if (isOffer) {
      message = await insertMessage(conv, profile.id, '', { kind: 'offer', offerAmount })
      if (initialMessage) await insertMessage(conv, profile.id, initialMessage)
    } else if (initialMessage) {
      message = await insertMessage(conv, profile.id, initialMessage)
    }
    return message
  }

  /**
   * Point a reused thread at the listing the buyer just asked about, and answer with the thread
   * the message must ACTUALLY go into, plus that thread's effective listing.
   *
   * ⚠️ THE RETURN CARRIES THE LISTING FOR A REASON. `insertMessage` writes `convo.listingId` onto
   * the notification it raises, so telling it the target listing while the row still points
   * somewhere else would file the seller's notification against a listing that thread is not
   * about. The effective listing is whatever is true after this function, not what the caller
   * asked for.
   *
   * ⚠️ THE `update` IS GUARDED, AND ITS BEING UNGUARDED WAS A LIVE HTTP 500 (owner's iPhone,
   * production, 2026-07-27). Retargeting writes (listingId, buyerProfileId), which is a UNIQUE
   * index — so it throws P2002 whenever the buyer ALREADY has a thread on the target listing. The
   * visa path learned this first and works around it in `retargetVisaThreadListing`; this route,
   * which is where the pattern was copied FROM, never did.
   */
  const retargetForListing = async (
    candidate: { id: string; listingId: string },
  ): Promise<{ id: string; listingId: string }> => {
    if (candidate.listingId === listingId) return candidate
    try {
      await db.conversation.update({ where: { id: candidate.id }, data: { listingId } })
      return { id: candidate.id, listingId }
    } catch (e) {
      if ((e as { code?: string })?.code !== 'P2002') throw e
      // Somebody else holds (listingId, buyer) — that row IS the canonical thread for this
      // listing, so deliver there instead of retargeting.
      const winner = await db.conversation.findUnique({
        where: { listingId_buyerProfileId: { listingId, buyerProfileId: profile.id } },
        select: { id: true },
      })
      if (winner) return { id: winner.id, listingId }
      // It collided and then vanished (a concurrent delete between the two statements). Deliver
      // into the candidate un-retargeted: a stale header line beats a 500, and the candidate is
      // guaranteed to be the same KIND of thread by the reuse rule below, so this is the thread
      // that rule would have chosen anyway.
      console.error('[conversations] retarget collided but the winning thread was gone', { candidate: candidate.id, listingId })
      return candidate
    }
  }

  // ⚠️ THE BUYER'S EXISTING THREAD ON THIS LISTING WINS, AND ASKING FIRST IS THE 500 FIX. The rule
  // below reuses a thread with the same SELLER and retargets its listing — which is a write to the
  // unique (listingId, buyerProfileId) index, and therefore throws the moment the buyer already
  // holds a thread on the listing being retargeted TO. Resolving the exact thread first means the
  // common shape of that collision never reaches a write at all. Indexed unique read; cheap.
  const canonical = await db.conversation.findUnique({
    where: { listingId_buyerProfileId: { listingId, buyerProfileId: profile.id } },
    select: { id: true },
  })
  if (canonical) {
    const message = await deliverFirstMessage({ id: canonical.id, buyerProfileId: profile.id, sellerProfileId, listingId })
    return NextResponse.json({ id: canonical.id, created: false, message })
  }

  // One thread per buyer↔seller (user decision 2026-07-14): inquiring about a
  // DIFFERENT listing from the same seller reuses the existing thread and
  // retargets its listing context (header card + offer math follow), instead of
  // opening a parallel chat per product.
  //
  // ⚠️ …EXCEPT ACROSS THREAD KINDS, because "one thread per seller" is the wrong rule for the eno
  // desk. `Seller.ownerId` is @unique, so the e-visa catalogue and the trip-planning anchor are
  // sold from ONE Seller row — a buyer's visa thread and their trip thread have the same sellerId
  // and are not interchangeable. Retargeting one onto the other's listing does not merely collide
  // (that is the 500 above); when it SUCCEEDS it silently converts a conversation full of visa
  // cards into an itinerary thread, and `threadKind` — which every surface now agrees on — starts
  // answering 'itinerary' for it. Reusing only a thread of the SAME kind keeps them apart.
  //
  // For an ordinary storefront this changes nothing: every thread and every target is kind
  // 'listing', so the newest still wins on the first comparison, exactly as before.
  //
  // ⚠️ This seller-level rule is find-then-create with NO DB constraint behind it —
  // the only unique index is (listingId, buyerProfileId). Two concurrent first
  // contacts on the SAME listing collide on that constraint (handled by the P2002
  // fallback below); two concurrent first contacts on DIFFERENT listings of the
  // same seller can, in a narrow race, each create a thread. That's rare and
  // benign (both threads work; the inbox shows the newest), and we accept it
  // rather than serialize creates here.
  const sellerThreads = await db.conversation.findMany({
    where: { sellerId: listing.sellerId, buyerProfileId: profile.id },
    orderBy: { lastMessageAt: 'desc' },
    // A buyer has one thread per listing of a seller, so this is newest-few, not a page. Ordinary
    // sellers match on the first row; only the desk ever has more than one kind to look past.
    take: 20,
    select: { id: true, listingId: true },
  })
  let existingWithSeller: { id: string; listingId: string } | null = null
  if (sellerThreads.length > 0) {
    // Resolved once and only when a reuse is actually in question — `threadKind` costs two desk
    // lookups, and an ordinary first contact (no candidate rows at all) must not pay for them.
    // Both resolvers are React-cache()d, so scanning every candidate costs no further queries.
    const targetKind = await threadKind({ listingId })
    for (const thread of sellerThreads) {
      if ((await threadKind(thread)) === targetKind) { existingWithSeller = thread; break }
    }
  }
  if (existingWithSeller) {
    const thread = await retargetForListing(existingWithSeller)
    const message = await deliverFirstMessage({ id: thread.id, buyerProfileId: profile.id, sellerProfileId, listingId: thread.listingId })
    return NextResponse.json({ id: thread.id, created: false, message })
  }

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
    const message = await deliverFirstMessage({ id: convo.id, buyerProfileId: profile.id, sellerProfileId, listingId })
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
    // Double-tap / concurrent-POST loser: the (listingId, buyerProfileId) unique
    // constraint rejected our create → the winner's thread already exists. Refetch
    // it and deliver into it instead of 500ing. If the winner's listingId was
    // retargeted by yet another request between our failed create and this refetch,
    // findUnique misses — fall back to the same-seller lookup (and retarget the
    // listing context exactly like the reuse path above) so the race still can't 500.
    if ((e as { code?: string })?.code === 'P2002') {
      const existing =
        (await db.conversation.findUnique({
          where: { listingId_buyerProfileId: { listingId, buyerProfileId: profile.id } },
          select: { id: true, listingId: true },
        })) ??
        (await db.conversation.findFirst({
          where: { sellerId: listing.sellerId, buyerProfileId: profile.id },
          orderBy: { lastMessageAt: 'desc' },
          select: { id: true, listingId: true },
        }))
      if (existing) {
        // Thread already exists → still deliver the offer/message (reuse it). Through the SAME
        // guarded helper as the reuse path above: this retarget writes the same unique index and
        // was equally capable of turning a lost race into a 500.
        const thread = await retargetForListing(existing)
        const message = await deliverFirstMessage({ id: thread.id, buyerProfileId: profile.id, sellerProfileId, listingId: thread.listingId })
        return NextResponse.json({ id: thread.id, created: false, message })
      }
      // ⚠️ THE CONSTRAINT FIRED AND THEN THE ROW VANISHED — both lookups missed, so the thread we
      // lost the race to was deleted between our failed create and this refetch. The old code
      // rethrew here, which is a 500 describing a conflict that no longer exists. One retry: the
      // slot is free now, so this is the create that should have succeeded.
      //
      // Deliberately NOT looped. A second collision means the row was recreated in the same
      // instant by yet a third writer, and at that point rethrowing is the honest answer rather
      // than spinning. The first-lead milestone is skipped on this path — it is a best-effort
      // celebration, and this branch is already the rarest thing that happens here.
      const retried = await db.conversation.create({
        data: { listingId, buyerProfileId: profile.id, sellerId: listing.sellerId, sellerProfileId },
        select: { id: true },
      })
      const message = await deliverFirstMessage({ id: retried.id, buyerProfileId: profile.id, sellerProfileId, listingId })
      return NextResponse.json({ id: retried.id, created: true, message })
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

  /**
   * ⚠️ HIDE THE THREAD, NOT JUST ITS CARDS, AND EXCLUDE IT IN THE `where` — BEFORE THE take.
   *
   * The two apps share one database, so a user who applied on eno.forum really does have visa and
   * trip threads sitting here. A card-kind denylist cannot hide them: both concierges insert their
   * ANSWERS with no `kind`, so they default to 'text' and remain readable prose with every card
   * suppressed, and the inbox preview column carries bilingual e-Visa product copy written by the
   * other edition. Filtering after the take would also silently shrink the page.
   *
   * deskSellerIds() is edition-blind, so the IS_MARKETPLACE test is what keeps eno.forum's own desk
   * threads visible where they belong.
   */
  const hiddenSellerIds = IS_MARKETPLACE ? await deskSellerIds() : []
  const rows = await db.conversation.findMany({
    where: {
      OR: [{ buyerProfileId: meId }, { sellerProfileId: meId }],
      ...(hiddenSellerIds.length ? { sellerId: { notIn: hiddenSellerIds } } : {}),
    },
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

  const visible = rows.filter((c) => {
    // Hide conversations this user "deleted" — until a newer message arrives
    // (lastMessageAt > the delete time), at which point it reappears.
    const myDeletedAt = c.buyerProfileId === meId ? c.buyerDeletedAt : c.sellerDeletedAt
    return !(myDeletedAt && c.lastMessageAt <= myDeletedAt)
  })
  // ⚠️ ONE LABEL SOURCE. The kind comes from `threadKind` — the same predicate the thread page and
  // the admin queue use — never from a second rule restated here. Visa and trips are sold from ONE
  // Seller row, so "which seller is this?" cannot tell them apart; the anchor listing can, and
  // threadKind is where that knowledge lives.
  //
  // Cheap despite the loop: both resolvers inside threadKind are React-cache()d, so the whole page
  // of conversations costs ONE desk lookup and one catalogue lookup, then in-memory comparisons.
  const kinds = await Promise.all(visible.map((c) => threadKind({ listingId: c.listing.id })))

  const conversations = visible.map((c, i) => {
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
      // 'visa' | 'itinerary' | 'listing' — what this thread is ABOUT, for the inbox label.
      kind: kinds[i],
      // The OTHER party's display identity.
      counterpart: iAmBuyer
        ? { name: c.seller.name, avatarColor: c.seller.avatarColor, avatarUrl: c.seller.avatarUrl }
        : { name: c.buyer.displayName || maskEmailHandle(c.buyer.email) || 'Buyer', avatarColor: c.buyer.avatarColor, avatarUrl: c.buyer.avatarUrl },
    }
  })
  return NextResponse.json({ conversations })
}
