import { NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { MESSAGE_ROW_SELECT, serializeMessage } from '@/lib/messages'
import { globalTopReactions } from '@/lib/reaction-tally'
import { maskEmailHandle } from '@/lib/utils'
import { threadKind } from '@/lib/thread-kind'
import { IS_MARKETPLACE } from '@/lib/edition'
import { deskSellerIds } from '@/lib/edition-scope'
import { syncBadgeToProfile } from '@/lib/native-push'
import { dayCoarse } from '@/lib/last-seen'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The e-Visa context of a thread that is BOUND to a case (Conversation.visaApplicationId).
 *
 * Everything here is a PUBLIC fact — a mode, a listing, a price, a rate — and nothing in it
 * decrypts a payload or touches applicant data. The applicant's own answers reach their
 * browser through GET /api/visa/applications/[id], which scopes by user_id; they never ride
 * on the thread payload, which both participants read.
 *
 * ⚠️ LAZY IMPORTS, on purpose (the records.ts / setVisaCheckoutStatus idiom). This route is
 * the most-polled endpoint in the app; the visa module graph (service-role Supabase client,
 * the shop catalogue, the FX quote) must not load on the ordinary messaging path. It is
 * pulled in only inside this function, i.e. only for a visa thread.
 *
 * ⚠️ MONEY IS SERVER TRUTH. The đồng price is re-read from the listing and the dollars are a
 * SERVER-ISSUED quote (src/lib/visa/fx.ts) minted here, at display time — never converted in
 * the browser, whose FX cache is up to 12h old. A null quote is the honest FX-down state: the
 * client renders the đồng price, says the dollar amount is unavailable, and disables paying.
 * The checkout route re-issues and re-compares its own quote before charging, so this one is
 * a DISPLAY value and a confirmation token, never an input to a charge.
 */
async function visaThreadContext(applicationId: string) {
  const [{ getVisaThreadMode }, { canonicalVisaListingId }, { resolveVisaProduct }, { quoteVisaUsd }, { visaPaymentsConfig }] = await Promise.all([
    import('@/lib/visa/dm-thread'),
    import('@/lib/visa/dm-flow'),
    import('@/lib/visa-shop'),
    import('@/lib/visa/fx'),
    import('@/lib/visa/payments'),
  ])
  const { expectedVisaReadyAt } = await import('@/lib/visa/eta')
  // CANONICAL, not event-derived (Phase 2): this listingId is what the client echoes back
  // to checkout as its confirmation token, so it must be the same read checkout compares
  // against — column first, legacy event fallback — or every pay attempt after a picker
  // selection would 409 `listing_selection_mismatch`.
  const [mode, listingId] = await Promise.all([
    getVisaThreadMode(applicationId),
    canonicalVisaListingId(applicationId),
  ])
  const product = listingId ? await resolveVisaProduct(listingId) : null
  const quote = product ? await quoteVisaUsd({ listingId: product.listingId, priceVnd: product.priceVnd }) : null
  return {
    applicationId,
    mode,
    product: product
      ? {
        listingId: product.listingId,
        title: product.title,
        entryType: product.entryType,
        speed: product.speed,
        priceVnd: product.priceVnd,
        currency: product.currency,
        // The tier's submission window, recomputed per request — a thread left open must
        // not keep offering a desk that closed twenty minutes ago.
        acceptingNow: product.window.acceptingNow,
        nextOpensIso: product.window.nextOpensIso,
        // ⚠️ THE AUTHORITATIVE READY INSTANT, computed on the SERVER at request time. The pay
        // card discloses this before taking money for a closed-desk order, and it must not be
        // derived from a `new Date()` in a client render — that hydrates differently and goes
        // stale across a cutoff/midnight/weekend boundary while the card sits open (codex +
        // Gemini). Null when no honest promise exists; the card then refuses to offer payment.
        expectedReadyIso: product.speed
          ? (expectedVisaReadyAt({ startedAt: new Date(), speed: product.speed })?.toISOString() ?? null)
          : null,
      }
      : null,
    quote,
    // WHICH providers, never a fee: visaPaymentsConfig().feeCents prices nothing now that
    // visa services are ordinary listings (see the note on the type).
    providers: visaPaymentsConfig()?.providers ?? [],
  }
}

// GET one conversation + its messages (participant-only). Marks the caller's
// unread count to 0 (opening the thread = read) — UNLESS ?peek=1.
//
// ⚠️ ?peek=1 is not an optimisation, it is a correctness fix. The inbox warms its
// cache by fetching threads the user has NOT opened: chat-context prefetches the top
// three the moment the list loads, and each row prefetches on touchstart. Every one of
// those hit this route and silently cleared unread, so the newest threads — precisely
// the ones that should carry a badge — were marked read milliseconds after rendering,
// and merely starting to SCROLL the list marked rows read. Prefetch passes peek=1;
// only a real open (messages/[id] load()) clears the count.
//
// WS6 — on route(). `auth: 'userId'`, which is what the old code called (getCurrentProfileId) and
// what this endpoint actually needs: `meId` is compared against buyerProfileId/sellerProfileId and
// echoed back as `me`. This is the most-polled endpoint in the app (~1.5s per open tab), so
// 'profile' would add a Profile read plus lazy provisioning to every poll — the exact hot path
// src/lib/admin.ts warns about. Branches held: guest → 401 auth_required · unknown thread → 404
// not_found · a desk thread on the marketplace edition → 404 not_found (deliberately
// indistinguishable) · non-participant → 403 forbidden · success → the same payload, peek and the
// unread-clearing write unchanged.
//
// ⚠️ ACCEPTED WIRE CHANGE ON THE FAILURE PATH ONLY: the conversation read, the unread update and
// threadKind were unguarded, so a DB rejection used to be Next's default 500 and is now
// {"error":"internal_error"} 500. The two blocks that already fail soft — the review lookup and
// visaThreadContext — keep their own catch and are untouched by this.
export const GET = route({ auth: 'userId' }, async ({ req, params, userId: meId }) => {
  const { id } = params
  const peek = new URL(req.url).searchParams.get('peek') === '1'

  const convo = await db.conversation.findUnique({
    where: { id },
    select: {
      id: true, buyerProfileId: true, sellerProfileId: true, buyerUnread: true, sellerUnread: true,
      // The e-Visa case this thread is bound to (null on every ordinary thread). It is what
      // every visa card is validated against server-side, and the client needs it to tell a
      // LIVE card from the inert history a rebound thread leaves behind.
      visaApplicationId: true,
      listing: { select: { id: true, title: true, images: true, price: true, currency: true, priceUnit: true, negotiable: true, availabilityConfirmedAt: true, status: true } },
      // `owner.locale` / `buyer.locale` = the counterpart's persisted app language, the ONLY
      // signal the live-translation toggle keys off (contract A). It is a language preference,
      // not personal data: nothing here says who they are or where they are.
      // `officialPartner` → the client hides the contact strip entirely.
      // ⚠️ THIS READS THE CONVERSATION'S SELLER; THE ENFORCEMENT READS THE LISTING'S. Two sources
      // for one fact, which a reviewer rightly flagged. They cannot diverge, and the reason is
      // worth writing down rather than rediscovering: `Conversation.listingId` IS retargeted (in
      // api/conversations/route.ts retargetForListing and lib/visa/dm-flow.ts) but `sellerId` is
      // not, and both retargets are seller-scoped — the candidate lookup filters on
      // `sellerId: listing.sellerId`, and the visa retarget stays inside the one desk storefront.
      // So conversation.seller IS the listing's seller, by construction of the only two writers.
      // If a third retarget is ever added that does not filter by seller, this display and the
      // server's refusal will disagree and the buyer gets a hidden strip on a revealable listing.
      // Belt: the server is authoritative either way, so the failure is a missing affordance, not
      // a leak.
      seller: { select: { id: true, name: true, avatarColor: true, avatarUrl: true, trustScore: true, trustTier: true, memberSince: true, reviewCount: true, officialPartner: true, owner: { select: { lastSeenAt: true, locale: true } } } },
      buyer: { select: { displayName: true, email: true, avatarColor: true, avatarUrl: true, lastSeenAt: true, locale: true } },
      // Bounded (audit P2): the full history shipped on EVERY call × a 15s poll per
      // open tab. Last 200 in reverse, un-reversed below — covers any realistic
      // active thread; older history is simply not re-sent.
      // MESSAGE_ROW_SELECT (src/lib/messages.ts) rather than a hand-listed set: it carries
      // metaJson, so a card kind can never be added without the thread reading its payload.
      messages: { orderBy: { createdAt: 'desc' }, take: 200, select: MESSAGE_ROW_SELECT },
    },
  })
  if (!convo) throw new ApiError('not_found', 404)

  /**
   * ⚠️ 404, NOT AN EMPTY THREAD. The two editions share one database, so a user who applied on
   * eno.forum can hold a direct link to that conversation and open it on eno.vn. Suppressing the
   * CARDS would not be enough: both concierges write their answers as kind-less plain text, so the
   * whole exchange stays readable as ordinary messages.
   *
   * Deliberately indistinguishable from a thread that does not exist — the same answer a stranger's
   * conversation id gets, so this cannot be used to confirm that a visa service exists.
   */
  if (IS_MARKETPLACE && convo.listing?.id) {
    const deskIds = await deskSellerIds()
    if (deskIds.length && convo.seller?.id && deskIds.includes(convo.seller.id)) {
      throw new ApiError('not_found', 404)
    }
  }

  const iAmBuyer = convo.buyerProfileId === meId
  const iAmSeller = convo.sellerProfileId === meId
  if (!iAmBuyer && !iAmSeller) throw new ApiError('forbidden', 403)

  // Mark my side read — but only WRITE when there's actually something to clear,
  // so the ~1.5s polling reads stay write-free.
  const myUnread = iAmBuyer ? convo.buyerUnread : convo.sellerUnread
  if (myUnread > 0 && !peek) {
    await db.conversation.update({
      where: { id },
      data: iAmBuyer ? { buyerUnread: 0 } : { sellerUnread: 0 },
    })
    // Refresh the app-icon badge — reading messages is one of only two ways the count goes
    // DOWN, and no ordinary push fires here. Deliberately INSIDE the `myUnread > 0` guard:
    // this route is polled roughly every 1.5s, and syncing on every poll would hammer APNs
    // to send the same number. after() keeps it off the response path.
    after(() => syncBadgeToProfile(meId))
  }

  // Counterpart's public storefront id (so the chat header name can deep-link to
  // their seller/business page). As a buyer that's the listing's seller directly;
  // as the seller it's the buyer's own storefront, if they have one.
  // When I'm the seller, the counterpart is the buyer's own storefront (if they have
  // one) — fetch its trust fields in the same lookup that resolves the deep-link id.
  const buyerStorefront = iAmBuyer
    ? null
    : await db.seller.findUnique({
        where: { ownerId: convo.buyerProfileId },
        select: { id: true, trustScore: true, trustTier: true, memberSince: true, reviewCount: true },
      })
  const counterpartSellerId = iAmBuyer ? convo.seller.id : (buyerStorefront?.id ?? null)

  // Trust meta for the chat header (under the counterpart's name). Only present when
  // the counterpart has a seller identity. `isNew` = account <30d old with no reviews
  // yet → the client shows a neutral "New user" chip instead of a positive badge
  // (asymmetric honesty). The raw responseRate number is intentionally NOT sent — the
  // response bucket needs a per-thread 90d conversation count we don't add to this
  // frequently-polled endpoint, so the client renders only score/tenure/new state.
  const trustSrc = iAmBuyer ? convo.seller : buyerStorefront
  const NEW_ACCOUNT_MS = 30 * 24 * 60 * 60 * 1000
  // Counterpart PRESENCE (owner 2026-07-23: bidirectional in threads) — the other
  // PERSON's heartbeat: the seller's owner Profile when I'm the buyer, the buyer's
  // Profile when I'm the seller. DAY-coarse only (dayCoarse), never a raw timestamp —
  // same contract as the PDP/storefront presence. Participant-gated above.
  const counterpartLastSeenDay = dayCoarse(iAmBuyer ? convo.seller.owner?.lastSeenAt ?? null : convo.buyer.lastSeenAt)
  const counterpartTrust = trustSrc
    ? {
        trustScore: trustSrc.trustScore,
        trustTier: trustSrc.trustTier,
        memberSinceYear: new Date(trustSrc.memberSince).getFullYear(),
        isNew: Date.now() - new Date(trustSrc.memberSince).getTime() < NEW_ACCOUNT_MS && trustSrc.reviewCount === 0,
        lastSeenDay: counterpartLastSeenDay,
      }
    : null

  // Buyer side only: has this conversation already produced a review? One indexed
  // exists-check (unique on Review.conversationId) powers the post-transaction
  // review prompt. Pre-migration DB (scripts/add-review-cols.mjs not yet run) the
  // column is absent → treat as not-reviewed instead of 500ing the whole thread.
  let hasReviewed = false
  if (iAmBuyer) {
    try {
      hasReviewed = !!(await db.review.findUnique({ where: { conversationId: id }, select: { id: true } }))
    } catch { hasReviewed = false }
  }

  const img = (() => { try { return (JSON.parse(convo.listing.images || '[]')[0] as string) ?? null } catch { return null } })()

  // FAILS SOFT, ALWAYS. A visa lookup (Supabase, the shop catalogue, the FX feed) must never
  // be able to 500 somebody's chat: without this block the thread simply renders the cards as
  // inert history, which is the same thing the desk's own side sees.
  let visa: Awaited<ReturnType<typeof visaThreadContext>> | null = null
  if (convo.visaApplicationId) {
    try {
      visa = await visaThreadContext(convo.visaApplicationId)
    } catch (e) {
      console.error('[conversations] visa context failed', e)
    }
  }

  // ⚠️ THE SAME PREDICATE THE INBOX AND THE ADMIN QUEUE USE, never a second rule. The desk sells
  // visas AND trip planning from ONE Seller row, so the thread's seller cannot say which it is; the
  // anchor listing can, and threadKind is where that lives. The thread page needs it to suppress
  // affordances that make no sense at a form desk — "is this still available?" being the obvious one.
  const kind = await threadKind({ listingId: convo.listing.id })

  return {
    id: convo.id,
    me: meId,
    /** 'visa' | 'itinerary' | 'listing' — what this thread is ABOUT. */
    kind,
    // The seller of the listing reveals nothing here (they ARE the contact) — the client
    // uses this to hide the "Request number / Zalo" action for the seller side.
    iAmSeller,
    // An OFFICIAL PARTNER shares no phone by agreement, so the client hides the whole contact strip
    // rather than offering a button the server will refuse with 403 partner_chat_only.
    // ⚠️ TOP-LEVEL, NOT INSIDE `listing`, DELIBERATELY. It is a Seller fact, and nesting it under
    // `listing` would send the next reader to the listing select above, where it does not exist —
    // and would become an outright lie the day a conversation retarget crosses sellers.
    sellerIsPartner: convo.seller.officialPartner,
    // availabilityConfirmedAt powers the buyer's instant "still available?" answer
    // (fresh seller confirmation → answered inline, no message sent).
    listing: { id: convo.listing.id, title: convo.listing.title, image: img, price: convo.listing.price, currency: convo.listing.currency, priceUnit: convo.listing.priceUnit, negotiable: convo.listing.negotiable, availabilityConfirmedAt: convo.listing.availabilityConfirmedAt?.toISOString() ?? null, status: convo.listing.status },
    // Buyer already reviewed this conversation → the thread UIs hide the review prompt.
    hasReviewed,
    // `locale` drives the live-translation toggle: the client offers it ONLY when the
    // counterpart's app language is KNOWN and differs from the viewer's. Null (they have
    // never synced a language) means no toggle at all — we never guess a language from a
    // name, a listing, or an IP, because a wrong guess translates a message that did not
    // need it and hides the words the other person actually chose.
    counterpart: iAmBuyer
      ? { name: convo.seller.name, avatarColor: convo.seller.avatarColor, avatarUrl: convo.seller.avatarUrl, sellerId: counterpartSellerId, trust: counterpartTrust, locale: convo.seller.owner?.locale ?? null }
      : { name: convo.buyer.displayName || maskEmailHandle(convo.buyer.email) || 'Buyer', avatarColor: convo.buyer.avatarColor, avatarUrl: convo.buyer.avatarUrl, sellerId: counterpartSellerId, trust: counterpartTrust, locale: convo.buyer.locale ?? null },
    // The e-Visa case this thread is bound to, and the desk state the cards render against
    // (mode · the picked product · the server-issued USD quote · which providers are live).
    // null on every ordinary conversation, and on a visa thread whose context lookup failed.
    visaApplicationId: convo.visaApplicationId,
    visa,
    // take:200 fetched newest-first — restore chronological order for the client.
    // `meta` is the card payload, parsed and RE-VALIDATED here (parseMessageMeta is a strict
    // zod parse that is tolerant on read): a row that predates the column, was written by
    // hand, or carries a version this build does not understand arrives as null and renders
    // as an inert bubble instead of a live prompt.
    // ⛔ THROUGH serializeMessage, NEVER HAND-BUILT. It is what redacts a recalled message's body
    //    (the row keeps it for dispute review — see prisma/schema.prisma) and what folds reactions
    //    per viewer so the raw profileIds never leave the server. Both are invisible when missed:
    //    the thread renders correctly while having been handed the text it is hiding.
    messages: [...convo.messages].reverse().map((m) => serializeMessage(m, meId)),
    // The site-wide top five, so the quick reaction bar shows what people actually use rather than
    // five glyphs picked in a constant. Cached for an hour per instance — see reaction-tally.ts.
    topReactions: await globalTopReactions(),
  }
})

// DELETE a conversation from MY inbox only (per-user hide, non-destructive).
// Stamps the caller's *DeletedAt = now(); the inbox query hides it until a newer
// message arrives, so it reappears if the other party replies. The conversation
// and its messages stay intact for the other participant.
//
// WS6 — on route(), `auth: 'userId'` for the same reason as the GET above: id comparison only.
// Branches held: guest → 401 auth_required · unknown thread → 404 not_found · non-participant →
// 403 forbidden · success → 204 with an EMPTY body, returned as a Response so the wrapper does not
// JSON-wrap it. ⚠️ Same accepted failure-path change: an unguarded DB rejection is now
// {"error":"internal_error"} 500 rather than Next's default 500.
//
// ⚠️ NOTE THE ASYMMETRY WITH THE GET: this handler does NOT hide desk threads on the marketplace
// edition. That is pre-existing and correct — deleting is per-user and reveals nothing, so a
// forum-created visa thread can still be removed from an eno.vn inbox. Left exactly as it was.
export const DELETE = route({ auth: 'userId' }, async ({ params, userId: meId }) => {
  const { id } = params

  const convo = await db.conversation.findUnique({
    where: { id },
    select: { buyerProfileId: true, sellerProfileId: true },
  })
  if (!convo) throw new ApiError('not_found', 404)

  const iAmBuyer = convo.buyerProfileId === meId
  const iAmSeller = convo.sellerProfileId === meId
  if (!iAmBuyer && !iAmSeller) throw new ApiError('forbidden', 403)

  await db.conversation.update({
    where: { id },
    data: iAmBuyer
      ? { buyerDeletedAt: new Date(), buyerUnread: 0 }
      : { sellerDeletedAt: new Date(), sellerUnread: 0 },
  })
  return new NextResponse(null, { status: 204 })
})
