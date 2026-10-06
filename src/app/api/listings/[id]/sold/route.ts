import { NextRequest, NextResponse } from 'next/server'
import { checkListingOwner } from '@/lib/listing-owner'
import { setStatusCore } from '@/lib/core/listings'
import { db } from '@/lib/db'
import { LISTING_REMOVED } from '@/lib/listing-removed'
import { isBlockedBetween } from '@/lib/user-blocks'
import { markSoldAsks, normalizeSalePrice, validateMarkSold, type DenyReason, type MarkSoldPatch } from '@/lib/trade-loop'
import {
  SALE_FACTS_SELECT,
  asksBuyerAbout,
  buyerThreadFor,
  factsUnchanged,
  notifySaleQuestion,
  saleFacts,
  withdrawSaleQuestion,
} from '@/lib/core/sale-loop'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Re-reads allowed when the row changes between the decision and the write (see the CAS below). */
const MAX_ATTEMPTS = 3

// Mark an OWNED listing sold WITH attribution — the web "Who bought it?" sheet (mark-sold-flow.tsx) and
// the native Mark-sold confirm sheet record who/where it sold and for how much:
//   { channel: 'eno' | 'external', buyerProfileId?, platform?, salePrice? }
//   - a buyer   → buyerProfileId MUST have a thread with this seller ABOUT THIS LISTING (anti-spoof) — the
//                 same scope GET /buyers?scope=listing lists (src/lib/core/sale-loop.ts), so the sheet can
//                 never offer someone this refuses. That buyer is then ASKED to confirm (the trade loop's
//                 buyer half): a bell notification + push into their thread with the seller, where
//                 sale-question / sale-confirmation take it from there.
//   - 'external' → platform is free text (the marketplace they sold on). Nobody is asked.
//   - neither    → a plain sold with no attribution.
// `salePrice` is the agreed price in whole VND. Stored when plausible; a 0 / missing / implausible figure
// is stored as NULL ("did not say") — never a refused sale: the sheet lets a seller acknowledge any
// figure (its order-of-magnitude check), and validateMarkSold's fat-finger bounds must not cost them the
// sale itself.
//
// ⚠️ THE STATUS / soldAt TRANSITION IS setStatusCore's, EXACTLY AS BEFORE: status, soldAt (kept on
// sold→sold — the #26 rule), purge, de-index, partner webhooks. validateMarkSold (src/lib/trade-loop.ts)
// decides the attribution and the `sale*` columns; its own `soldAt` is deliberately NOT written.
//
// ⚠️ ONE UPDATE, COMPARE-AND-SWAP. The sale columns ride in setStatusCore's write (SoldMeta.sale) with the
// facts this decision read as its precondition (SoldMeta.expect). A double tap therefore asks the buyer
// ONCE — the second request's write misses, it re-reads, and the same answer is now a no-op re-tap
// (validateMarkSold: same buyer, same price → no new ask) — and a mark-sold racing the buyer's own "Yes"
// can never erase it (the re-read sees the confirmation and refuses `already_confirmed`).
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
//    sold with no attribution". `body:` would turn that 200 into a 400 and break marking a listing sold
//    from anywhere but a confirm sheet. The `|| {}` exists because `req.json()` RETURNS null for a
//    literal `null` payload rather than throwing; a zod schema would reject it.
//
// Branches: guest → 401 auth_required · no storefront → 403 no_storefront · unknown id → 404 not_found ·
// not the owner → 403 forbidden · non-UUID buyerProfileId → 400 invalid_buyer · buyer with no thread
// about this listing, or a block between the two either way (gate `ugc-safety`) → 400
// buyer_not_in_conversations · naming yourself → 400 buyer_is_seller · a buyer
// who said "No" about this listing → 409 buyer_declined · re-marking a sale the buyer already confirmed
// → 409 already_confirmed · a price change with that buyer's asks spent → 409 ask_budget_exhausted ·
// a listing taken down by authority order → 409 listing_unavailable · the row kept changing under the
// decision → 409 not_actionable · core refusal → r.code with r.error · success → 200 {"ok":true,"asked"},
// `asked` = the buyer was actually notified just now (see notifySaleQuestion).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })

  // `|| {}` guards the literal `null` payload (req.json() returns null, not throws).
  let body: { channel?: unknown; buyerProfileId?: unknown; platform?: unknown; salePrice?: unknown } = {}
  try { body = (await req.json()) || {} } catch { /* empty/invalid body → plain sold */ }

  const rawBuyer = typeof body.buyerProfileId === 'string' ? body.buyerProfileId : null
  const channel = body.channel === 'external' ? 'external' : rawBuyer ? 'eno' : null
  // Buyer id feeds a @db.Uuid column — a malformed value makes Prisma throw a validation error (500),
  // so reject non-UUIDs up front with a clean 400.
  if (channel === 'eno' && !UUID_RE.test(rawBuyer!)) return NextResponse.json({ error: 'invalid_buyer' }, { status: 400 })
  // Coerce defensively — a non-string platform would throw on .trim().
  const platform = channel === 'external' ? (typeof body.platform === 'string' ? body.platform : '').trim().slice(0, 60) || null : null
  const buyerProfileId = channel === 'eno' ? rawBuyer! : null

  // ⛔ Never trust a client-supplied buyer id — it must be someone who messaged this seller ABOUT THIS
  // LISTING: a thread anchored here, or one that carried an offer about it before a retarget. The same
  // lookup names the thread the buyer's question opens.
  const buyerThread = buyerProfileId ? await buyerThreadFor(auth.sellerId, auth.profileId, id, buyerProfileId) : null
  if (buyerProfileId && !buyerThread) return NextResponse.json({ error: 'buyer_not_in_conversations' }, { status: 400 })
  // ⛔ App Store gate `ugc-safety`: never across a block, EITHER way. Naming them would put a bell row and a push
  // with this storefront's name in front of someone who cut contact (or reach someone this seller blocked),
  // opening the closed thread on "did you buy this?". The same answer as no thread at all — the block is not
  // revealed — and GET /buyers never offers them. Off ⇒ no query.
  if (buyerProfileId && await isBlockedBetween(auth.profileId, buyerProfileId)) return NextResponse.json({ error: 'buyer_not_in_conversations' }, { status: 400 })

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // edition-lint-allow: ONE row by id, the CALLER'S OWN listing — checkListingOwner above proved this
    // seller owns it; it feeds this write's decision and no listing field is serialized back.
    const row = await db.listing.findUnique({
      where: { id },
      select: {
        ...SALE_FACTS_SELECT,
        price: true, currency: true, title: true, listingType: true, sellerId: true,
        category: { select: { slug: true } },
        seller: { select: { ownerId: true, name: true } },
      },
    })
    if (!row || row.status === LISTING_REMOVED) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const facts = saleFacts(row)
    const now = new Date()
    // Normalised HERE so an implausible figure becomes "did not say" (null) instead of `invalid_price`
    // refusing the whole sale (see the header). A valid figure passes through validateMarkSold unchanged.
    const salePrice = normalizeSalePrice(body.salePrice, row.price) ?? null
    const decision = validateMarkSold(
      { channel, buyerProfileId, platform, salePrice },
      {
        actorProfileId: auth.profileId,
        sellerProfileId: row.seller.ownerId,
        complianceStatus: row.complianceStatus,
        askingPrice: row.price,
        conversationBuyerProfileIds: buyerProfileId && buyerThread ? [buyerProfileId] : [],
        facts,
        now,
      },
    )
    if (!decision.ok) return refusal(decision.reason)
    const { patch } = decision

    // Is there a question to put to this buyer at all? A sale of goods, never the services desk
    // (asksBuyerAbout). Where there is not, the attribution is still recorded — as it always was — but
    // the question columns stay exactly as they were: recording an ask nobody was sent is the divergence
    // trade-loop.ts exists to prevent.
    const asksBuyer = !!buyerProfileId && (await asksBuyerAbout({ sellerId: row.sellerId, listingType: row.listingType, categorySlug: row.category?.slug ?? null }))
    const sale: Pick<MarkSoldPatch, 'salePrice' | 'saleConfirmedAt' | 'saleDeclinedAt' | 'saleBuyerHistory' | 'saleConfirmPromptedAt'> = {
      salePrice: patch.salePrice,
      saleConfirmedAt: patch.saleConfirmedAt,
      saleDeclinedAt: patch.saleDeclinedAt,
      saleBuyerHistory: buyerProfileId && !asksBuyer ? facts.saleBuyerHistory : patch.saleBuyerHistory,
      saleConfirmPromptedAt: buyerProfileId && !asksBuyer ? facts.saleConfirmPromptedAt : patch.saleConfirmPromptedAt,
    }
    // Does this mark-sold put a (new) question to the buyer? Whether they are actually NOTIFIED is
    // notifySaleQuestion's answer below — the daily bound, or a change landing first, can say no.
    const asksNow = asksBuyer && markSoldAsks(patch, facts)

    const r = await setStatusCore(id, 'sold', { channel, buyerProfileId, platform, sale, expect: factsUnchanged(facts) })
    if (!r.ok) {
      // 404 = the compare-and-swap missed (the row changed since it was read) or the listing is gone:
      // re-read, which tells the two apart, and decide again on what is there now.
      if (r.code === 404) continue
      return NextResponse.json({ error: r.error }, { status: r.code })
    }

    // The question moved off an earlier buyer (re-attributed, or now off-eno / unattributed): their
    // "did you buy this?" is withdrawn with it — a bell that still asks them is wrong.
    if (facts.soldToProfileId && facts.soldToProfileId !== patch.soldToProfileId) await withdrawSaleQuestion(facts.soldToProfileId, id)
    const asked = asksNow && buyerProfileId && buyerThread
      ? await notifySaleQuestion({
          buyerProfileId,
          listingId: id,
          conversationId: buyerThread,
          sellerName: row.seller.name,
          listingTitle: row.title,
          price: patch.salePrice,
          currency: row.currency,
        })
      : false
    // `asked` is what HAPPENED: true only when a "did you buy this?" now stands in the buyer's bell with a
    // push on its way. The question itself is recorded either way, and the thread shows it.
    return NextResponse.json({ ok: true, asked })
  }
  return NextResponse.json({ error: 'not_actionable' }, { status: 409 })
}

/**
 * validateMarkSold's refusal, on the wire. Every code is a LITERAL on purpose: src/lib/api/errors.test.ts
 * harvests the codes this file can emit by text scan, and a code passed through a variable is invisible
 * to it.
 */
function refusal(reason: DenyReason): NextResponse {
  switch (reason) {
    case 'buyer_not_in_conversations': return NextResponse.json({ error: 'buyer_not_in_conversations' }, { status: 400 })
    case 'buyer_is_seller': return NextResponse.json({ error: 'buyer_is_seller' }, { status: 400 })
    case 'buyer_declined': return NextResponse.json({ error: 'buyer_declined' }, { status: 409 })
    case 'already_confirmed': return NextResponse.json({ error: 'already_confirmed' }, { status: 409 })
    case 'ask_budget_exhausted': return NextResponse.json({ error: 'ask_budget_exhausted' }, { status: 409 })
    case 'listing_unavailable': return NextResponse.json({ error: 'listing_unavailable' }, { status: 409 })
    // checkListingOwner already proved the caller owns the storefront; kept for the day it is not.
    case 'not_seller': return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    // Unreachable from this route — the price is normalised and the channel derived above — but a
    // refusal is never answered as a success.
    default: return NextResponse.json({ error: 'invalid_buyer' }, { status: 400 })
  }
}
