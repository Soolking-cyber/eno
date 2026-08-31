import 'server-only'
import { db } from '@/lib/db'
import { newReference } from './reference'
import { availableRails, vietqrPayoutReady, type PaymentRailId, type PartyIdentity } from './eligibility'

/**
 * CREATING AN ORDER — the only place a payment reference is minted.
 *
 * ⛔ THE REFERENCE IS MADE HERE OR NOWHERE. `Order.reference` is required and unique because it is
 * the entire link between a bank transfer and an order (see reference.ts); three reviewers pointed
 * out that adding that column without a writer left a table nobody could insert into and a webhook
 * that could never settle anything. This function is that writer, and keeping it the only one is
 * what stops a second code path inventing a reference with different rules.
 *
 * ⚠️ IT DECIDES THE RAIL, IT DOES NOT ACCEPT ONE. A caller passing `rail` could offer a buyer a
 * rail the country rules refuse — the client would simply say `crossmint` and the server would
 * agree. The rails come from `availableRails`, which is edition-gated and country-gated, and the
 * order records which one was chosen so the checkout renders the right thing.
 */

export type CreateOrderInput = {
  listingId: string
  sellerId: string
  buyerId: string
  /**
   * ⚠️ MINOR UNITS OF `currency`. For VND that is whole dong (there is no subdivision); for USD it
   * is cents, and for a USDC settlement it is the six-decimal base unit. order-state.ts refuses a
   * float at the money edge, and so does this.
   */
  amount: number
  currency: 'VND' | 'USD'
  buyer: PartyIdentity
  seller: PartyIdentity
}

export type CreateOrderFailure =
  /** Neither party may settle, or no rail is open to them — see availableRails. */
  | 'no_rail'
  /** The amount is not a positive whole number of minor units. */
  | 'bad_amount'
  /** Could not mint a reference nobody else holds. Vanishingly unlikely; never silent. */
  | 'reference_collision'

export type CreateOrderResult =
  | { ok: true; id: string; reference: string; rail: PaymentRailId }
  | { ok: false; reason: CreateOrderFailure }

/**
 * ⚠️ RETRIED, BECAUSE A UNIQUE INDEX IS THE REAL GUARANTEE AND IT FAILS BY THROWING. Nine random
 * Crockford characters make a collision vanishingly unlikely, but "unlikely" is not "handled": the
 * database refuses the insert and this asks for another reference rather than surfacing a P2002 to
 * a buyer who did nothing wrong. Three attempts, then an honest failure — a silent loop here would
 * be a request that never returns.
 */
const MINT_ATTEMPTS = 3

/**
 * ⚠️ WHAT EACH RAIL ACTUALLY MOVES. A NAPAS 247 transfer is dong and nothing else; the stablecoin
 * and PayPal rails settle in USD. This is not configuration — it is what the rail IS — so an order
 * whose currency no available rail speaks has no rail, rather than a rail that will misprice it.
 */
const RAIL_CURRENCY: Record<PaymentRailId, 'VND' | 'USD'> = {
  vietqr: 'VND',
  crossmint: 'USD',
  paypal: 'USD',
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  /**
   * ⛔ A WHOLE, POSITIVE AMOUNT, CHECKED BEFORE ANYTHING IS WRITTEN. order-state.ts refuses a float
   * at the money edge, but an order created with one would sit in `awaiting_payment` displaying a
   * price no bank can be asked for.
   */
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) return { ok: false, reason: 'bad_amount' }

  /**
   * ⛔ THE RAIL IS DERIVED, NOT SUPPLIED. `availableRails` is gated on the edition (eno.vn is
   * paymentless), on both parties' KYC, and on the country rules that keep a Vietnamese resident off
   * the stablecoin rail. Accepting a rail from the caller would let a client choose one the law
   * refuses, and the server would have agreed.
   * ⚠️ THE FIRST ONE IS THE PREFERENCE ORDER: wallet, then the QR, then PayPal.
   */
  const rails = availableRails(input.buyer, input.seller)
  /**
   * ⛔ AND THE RAIL MUST SPEAK THE ORDER'S CURRENCY. A reviewer found the gap: nothing stopped a
   * `vietqr` order priced in USD, which would have rendered a NAPAS code asking for that number of
   * DONG — a hundredth of the price — and no webhook could ever settle it, because the match
   * compares currencies. VietQR is a domestic dong transfer and the wallet settles in USD; neither
   * is a preference we get to override per order.
   */
  const rail = rails.find((r) => RAIL_CURRENCY[r] === input.currency)
  if (!rail) return { ok: false, reason: 'no_rail' }

  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    const reference = newReference()
    try {
      const order = await db.order.create({
        data: {
          buyerId: input.buyerId,
          sellerId: input.sellerId,
          listingId: input.listingId,
          /**
           * ⚠️ CREATED DIRECTLY IN `awaiting_payment`, NOT `pending`. `pending` is the state where a
           * seller has not yet accepted; an order reaching this function has an agreed price and a
           * buyer about to be shown a QR. Starting in `pending` would mean the checkout renders a
           * code for money the state machine does not yet expect, and `payment_confirmed` is only
           * legal from `awaiting_payment`.
           */
          status: 'awaiting_payment',
          rail,
          amount: BigInt(input.amount),
          currency: input.currency,
          reference,
        },
        select: { id: true, reference: true },
      })
      return { ok: true, id: order.id, reference: order.reference, rail }
    } catch (e) {
      // ⚠️ ONLY A REFERENCE COLLISION IS RETRIED. Any other failure — a bad foreign key, the
      // composite listing/seller constraint — is a real error and must not be masked by three
      // identical attempts.
      const err = e as { code?: string; meta?: { target?: unknown } }
      const target = Array.isArray(err.meta?.target) ? err.meta.target.map(String) : []
      const isReferenceClash = err.code === 'P2002' && target.some((t) => t.toLowerCase().includes('reference'))
      if (!isReferenceClash) throw e
    }
  }
  return { ok: false, reason: 'reference_collision' }
}

/**
 * What a checkout needs to render, for the rail this order is on.
 *
 * ⛔ THE SELLER'S BANK DETAILS ARE READ HERE AND NOWHERE NEAR A LISTING. They live in
 * `seller_payout` precisely so they cannot ride along on an ordinary Seller query, and this is the
 * one place that deliberately joins them — for a buyer who is actually paying, on an order that
 * actually exists.
 */
export async function payoutTargetFor(sellerId: string): Promise<{
  bankBin: string
  bankAccountNo: string
  bankAccountName: string
} | null> {
  const payout = await db.sellerPayout.findUnique({
    where: { sellerId },
    select: { bankBin: true, bankAccountNo: true, bankAccountName: true },
  })
  // ⚠️ THE SAME PREDICATE THE RAIL GATE USES, so "this seller can be paid by QR" cannot mean one
  // thing when the rail is offered and another when the code is drawn.
  return vietqrPayoutReady(payout) ? payout : null
}
