import type { PaymentRailId } from './eligibility'

/**
 * THE ORDER LIFECYCLE — one state machine, shared by every rail.
 *
 * ⛔ THE MACHINE IS RAIL-AGNOSTIC ON PURPOSE, AND THAT IS THE WHOLE POINT OF PUTTING IT HERE. A
 * wallet transfer, a PayPal capture and (later) a shipment all move an order through the SAME
 * states; only the evidence differs. Writing the flow per-rail is how a marketplace ends up with
 * "paid" meaning something subtly different depending on how the buyer paid — and then a refund,
 * a dispute or an accounting report has to know which. One machine, and the rail is a field on it.
 *
 * ⛔ IT IS PURE, AND IT MUST STAY THAT WAY. No database, no Crossmint, no clock. Every transition
 * this app can make is enumerated below and testable without a network — which matters because the
 * expensive bugs in payment systems are not "the API call failed", they are "we let an order move
 * from a state it should never have left".
 *
 * ⚠️ SHIPMENT IS NOT MODELLED YET AND ITS SLOT IS DELIBERATE. Owner, 2026-08-30: shipment comes to
 * eno.forum later. `paid → fulfilled` is where it will go, as an intermediate `shipped` state; the
 * terminal set and the refund edges are drawn so that inserting it does not have to reopen them.
 */

export type OrderStatus =
  /** Created by the buyer, nothing owed yet — the seller may still decline. */
  | 'pending'
  /** Seller accepted; the buyer owes money and a rail has been chosen. */
  | 'awaiting_payment'
  /** Funds confirmed on the rail. For the wallet this means an on-chain transfer we have seen. */
  | 'paid'
  /** Goods handed over / service delivered. The state shipment tracking will feed. */
  | 'fulfilled'
  /** Money returned to the buyer after it had been paid. */
  | 'refunded'
  /** Ended before payment, by either side or by expiry. */
  | 'cancelled'
  /** A party raised a dispute; the case room owns it until it resolves. */
  | 'disputed'
  /**
   * ⛔ MONEY ARRIVED THAT SHOULD NOT HAVE, AND SOMEONE MUST SEND IT BACK. Reached when a payment
   * lands on an order that was already cancelled. Two reviewers found the hole: an on-chain USDC
   * transfer is IRREVERSIBLE and asynchronous, so a buyer paying moments before an expiry or a
   * seller decline is an ordinary race, not an edge case — and the first version had no legal
   * transition for it, which meant real funds with nowhere to be recorded.
   * ⚠️ IT IS A STATE, NOT AN ERROR LOG. Money that has moved must be visible in the order it moved
   * against, or the only record of it is a webhook nobody reads.
   */
  | 'refund_due'

/**
 * ⚠️ TERMINAL MEANS NOTHING MAY MOVE IT AGAIN, INCLUDING AN ADMIN. `disputed` is deliberately NOT
 * terminal — a dispute resolves back into `refunded` or `fulfilled`, which is exactly why it must
 * be a state rather than a flag on the side.
 * ⛔ AND `fulfilled` LEFT THIS SET. It was terminal in the first version, which meant a buyer who
 * received broken or missing goods had no way to dispute — delivery is exactly when most disputes
 * start. `refund_due` is not terminal either: it exists precisely to be resolved.
 */
export const TERMINAL: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['refunded', 'cancelled'])

export type OrderEventType =
  | 'seller_accepted'
  | 'seller_declined'
  | 'buyer_cancelled'
  | 'expired'
  | 'payment_confirmed'
  | 'fulfilled'
  | 'refund_issued'
  | 'dispute_opened'
  | 'dispute_resolved_refund'
  | 'dispute_resolved_release'
  /** A rail confirmed a payment against an order that was already cancelled. */
  | 'late_payment_received'

/**
 * ⛔ THE ONLY LEGAL MOVES. An event not listed for a state is refused rather than ignored — see
 * `applyEvent`. Read this table as the specification; the code below is only its enforcement.
 *
 * ⚠️ `payment_confirmed` IS ONLY REACHABLE FROM `awaiting_payment`, WHICH IS WHAT MAKES A REPLAYED
 * WEBHOOK SAFE. Crossmint delivers `wallets.transfer.in` at least once, and a retry after we have
 * already moved to `paid` must not re-run anything; here it simply has no transition and is
 * rejected. Idempotency by state, not by remembering delivery ids.
 * ⚠️ AND THERE IS NO EDGE OUT OF `paid` BACK TO `awaiting_payment`. Money that arrived cannot
 * un-arrive; a wrong payment is a REFUND, which is a different event with its own record.
 */
const TRANSITIONS: Readonly<Record<OrderStatus, Partial<Record<OrderEventType, OrderStatus>>>> = {
  pending: {
    seller_accepted: 'awaiting_payment',
    seller_declined: 'cancelled',
    buyer_cancelled: 'cancelled',
    expired: 'cancelled',
  },
  awaiting_payment: {
    payment_confirmed: 'paid',
    buyer_cancelled: 'cancelled',
    seller_declined: 'cancelled',
    expired: 'cancelled',
  },
  paid: {
    fulfilled: 'fulfilled',
    refund_issued: 'refunded',
    dispute_opened: 'disputed',
  },
  /**
   * ⚠️ A DELIVERED ORDER CAN STILL BE DISPUTED, and refunded on the way out. Delivery is when a
   * buyer discovers the goods are wrong, so making `fulfilled` terminal closed the door at the
   * moment it is most needed.
   */
  fulfilled: {
    dispute_opened: 'disputed',
    refund_issued: 'refunded',
  },
  refunded: {},
  /**
   * ⛔ A CANCELLED ORDER CAN STILL RECEIVE MONEY. See `refund_due` — an irreversible on-chain
   * transfer does not care that we expired the order a second earlier.
   */
  cancelled: {
    late_payment_received: 'refund_due',
  },
  refund_due: {
    refund_issued: 'refunded',
    dispute_opened: 'disputed',
  },
  disputed: {
    dispute_resolved_refund: 'refunded',
    dispute_resolved_release: 'fulfilled',
  },
}

export type Order = {
  status: OrderStatus
  /** Chosen when the seller accepts; null while pending. */
  rail: PaymentRailId | null
  /** Minor units of `currency` — never a float, and `bigint` as Prisma returns it. See `validAmount`. */
  amount: number | bigint
  currency: 'USD' | 'VND'
}

export type TransitionError =
  | 'illegal_transition'
  | 'rail_required'
  | 'amount_invalid'

/**
 * Apply an event, or say why it cannot be applied.
 *
 * ⚠️ RETURNS A NEW STATUS RATHER THAN MUTATING, so a caller writes the row and the audit event in
 * ONE transaction and cannot end up with an order whose status has moved but whose history has not.
 */
export function applyEvent(order: Order, event: OrderEventType): { status: OrderStatus } | { error: TransitionError } {
  const next = TRANSITIONS[order.status]?.[event]
  if (!next) return { error: 'illegal_transition' }
  /**
   * ⛔ A RAIL AND A SANE AMOUNT ARE CHECKED AT THE MONEY EDGE, NOT AT CREATION. An order can sit in
   * `pending` with no rail — the buyer has not chosen and the seller has not accepted — but nothing
   * may reach `paid` without both, or the ledger records money arriving with no statement of how or
   * how much. This is the one transition where being strict costs nothing and being loose is
   * unrecoverable.
   */
  if (next === 'paid') {
    if (!order.rail) return { error: 'rail_required' }
    if (!validAmount(order.amount)) return { error: 'amount_invalid' }
  }
  return { status: next }
}

/** The events legal from this state, for building a UI that cannot offer an impossible action. */
export function allowedEvents(status: OrderStatus): OrderEventType[] {
  return Object.keys(TRANSITIONS[status] ?? {}) as OrderEventType[]
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL.has(status)
}

/**
 * ⛔ MINOR UNITS, INTEGER, POSITIVE. Money is never a float in this system: 0.1 + 0.2 is not 0.3 in
 * IEEE-754, and a marketplace that rounds a cent per order rounds a real amount per year. USDC has
 * 6 decimals on-chain and VND has none, so the rail adapter converts at its own boundary — what
 * crosses THIS module is always an integer count of the currency's smallest unit.
 * ⚠️ ALSO REJECTS ZERO. A free item is not an order; it is a listing with no payment, and letting a
 * zero-value order reach `paid` would put an empty settlement in the ledger.
 */
export function validAmount(amount: number | bigint): boolean {
  /**
   * ⚠️ IT TAKES `bigint` TOO, BECAUSE PRISMA HANDS ONE BACK. `Order.amount` is int8 in the database
   * (int4 overflows at $2 147 once USDC's six decimals are counted), so a row read returns a
   * `bigint` — and `Number.isSafeInteger(1000000n)` is FALSE, which would have rejected every real
   * payment at the money edge. A reviewer caught the mismatch between the two layers.
   */
  // ⚠️ `BigInt(0)` NOT `0n` — this project targets ES2017, where the literal is a syntax error.
  if (typeof amount === 'bigint') return amount > BigInt(0) && amount <= BigInt(Number.MAX_SAFE_INTEGER)
  return Number.isSafeInteger(amount) && amount > 0
}
