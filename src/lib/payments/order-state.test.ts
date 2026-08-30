import { describe, expect, it } from 'vitest'
import {
  allowedEvents,
  applyEvent,
  isTerminal,
  validAmount,
  type Order,
  type OrderEventType,
  type OrderStatus,
} from './order-state'

// The expensive bugs in a payment system are not failed API calls — they are orders leaving a state
// they should never have left. So most of this asserts what is REFUSED.

const order = (over: Partial<Order> = {}): Order => ({
  status: 'awaiting_payment',
  rail: 'crossmint',
  amount: 1_000_000, // 1.00 USDC in minor units
  currency: 'USD',
  ...over,
})

const ALL_STATUSES: OrderStatus[] = [
  'pending', 'awaiting_payment', 'paid', 'fulfilled', 'refunded', 'cancelled', 'disputed', 'refund_due',
]
const ALL_EVENTS: OrderEventType[] = [
  'seller_accepted', 'seller_declined', 'buyer_cancelled', 'expired', 'payment_confirmed',
  'fulfilled', 'refund_issued', 'dispute_opened', 'dispute_resolved_refund', 'dispute_resolved_release',
  'late_payment_received',
]

describe('the happy path', () => {
  it('pending → awaiting_payment → paid → fulfilled', () => {
    expect(applyEvent(order({ status: 'pending', rail: null }), 'seller_accepted')).toEqual({ status: 'awaiting_payment' })
    expect(applyEvent(order({ status: 'awaiting_payment' }), 'payment_confirmed')).toEqual({ status: 'paid' })
    expect(applyEvent(order({ status: 'paid' }), 'fulfilled')).toEqual({ status: 'fulfilled' })
  })
})

describe('⛔ what may never happen', () => {
  it('money cannot un-arrive — there is no edge from paid back to awaiting_payment', () => {
    expect(applyEvent(order({ status: 'paid' }), 'payment_confirmed')).toEqual({ error: 'illegal_transition' })
    expect(applyEvent(order({ status: 'paid' }), 'buyer_cancelled')).toEqual({ error: 'illegal_transition' })
    expect(applyEvent(order({ status: 'paid' }), 'expired')).toEqual({ error: 'illegal_transition' })
  })

  it('a REPLAYED payment webhook is refused by state alone', () => {
    // Crossmint delivers `wallets.transfer.in` at least once. The second delivery arrives when the
    // order is already `paid`, where the event has no transition — idempotency without a delivery
    // id table to keep, sweep and get wrong.
    const paid = applyEvent(order(), 'payment_confirmed')
    expect(paid).toEqual({ status: 'paid' })
    expect(applyEvent(order({ status: 'paid' }), 'payment_confirmed')).toEqual({ error: 'illegal_transition' })
  })

  it('nothing moves a terminal order, including an admin', () => {
    for (const status of ['refunded'] as OrderStatus[]) {
      expect(isTerminal(status)).toBe(true)
      expect(allowedEvents(status)).toEqual([])
      for (const e of ALL_EVENTS) {
        expect(applyEvent(order({ status }), e), `${status} + ${e}`).toEqual({ error: 'illegal_transition' })
      }
    }
  })

  it('an unpaid order cannot be fulfilled, refunded or disputed', () => {
    for (const status of ['pending', 'awaiting_payment'] as OrderStatus[]) {
      for (const e of ['fulfilled', 'refund_issued', 'dispute_opened'] as OrderEventType[]) {
        expect(applyEvent(order({ status }), e), `${status} + ${e}`).toEqual({ error: 'illegal_transition' })
      }
    }
  })

  it('⛔ nothing reaches paid without a rail', () => {
    expect(applyEvent(order({ rail: null }), 'payment_confirmed')).toEqual({ error: 'rail_required' })
  })

  it('⛔ nothing reaches paid with a nonsense amount', () => {
    for (const amount of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 2]) {
      expect(applyEvent(order({ amount }), 'payment_confirmed'), String(amount)).toEqual({ error: 'amount_invalid' })
    }
  })

  it('⛔ the rail and amount are checked ONLY at the money edge', () => {
    // An order may legitimately sit in `pending` with no rail — nobody has chosen one yet.
    expect(applyEvent(order({ status: 'pending', rail: null, amount: 0 }), 'seller_accepted'))
      .toEqual({ status: 'awaiting_payment' })
  })
})

describe('⛔ money that arrives late, and disputes after delivery', () => {
  it('a payment landing on a CANCELLED order becomes refund_due, not a lost webhook', () => {
    // An on-chain USDC transfer is irreversible and asynchronous, so a buyer paying moments before
    // an expiry is an ordinary race. The first version had no transition for it — real funds with
    // nowhere to be recorded. Two reviewers found it.
    expect(applyEvent(order({ status: 'cancelled' }), 'late_payment_received')).toEqual({ status: 'refund_due' })
    expect(applyEvent(order({ status: 'refund_due' }), 'refund_issued')).toEqual({ status: 'refunded' })
  })

  it('⛔ a delivered order can still be disputed', () => {
    // Delivery is when a buyer discovers the goods are wrong; `fulfilled` being terminal closed the
    // door at the moment it is most needed.
    expect(applyEvent(order({ status: 'fulfilled' }), 'dispute_opened')).toEqual({ status: 'disputed' })
    expect(applyEvent(order({ status: 'fulfilled' }), 'refund_issued')).toEqual({ status: 'refunded' })
    expect(isTerminal('fulfilled')).toBe(false)
  })

  it('accepts a bigint amount, as Prisma returns it', () => {
    // `Number.isSafeInteger(1000000n)` is false, so a bigint-only check would have rejected every
    // real payment at the money edge.
    expect(validAmount(BigInt(1_000_000))).toBe(true)
    expect(validAmount(BigInt(0))).toBe(false)
    expect(validAmount(BigInt(-1))).toBe(false)
    expect(applyEvent(order({ amount: BigInt(1_000_000) }), 'payment_confirmed')).toEqual({ status: 'paid' })
  })
})

describe('disputes are a state, not a flag', () => {
  it('resolve either way, and both ways are terminal', () => {
    expect(applyEvent(order({ status: 'disputed' }), 'dispute_resolved_refund')).toEqual({ status: 'refunded' })
    expect(applyEvent(order({ status: 'disputed' }), 'dispute_resolved_release')).toEqual({ status: 'fulfilled' })
  })

  it('⛔ cancelled accepts ONLY a late payment — nothing else revives it', () => {
    for (const e of ALL_EVENTS.filter((x) => x !== 'late_payment_received')) {
      expect(applyEvent(order({ status: 'cancelled' }), e), e).toEqual({ error: 'illegal_transition' })
    }
  })

  it('⛔ a disputed order cannot be quietly fulfilled or refunded around the dispute', () => {
    expect(applyEvent(order({ status: 'disputed' }), 'fulfilled')).toEqual({ error: 'illegal_transition' })
    expect(applyEvent(order({ status: 'disputed' }), 'refund_issued')).toEqual({ error: 'illegal_transition' })
  })

  it('disputed is NOT terminal — it has to resolve', () => {
    expect(isTerminal('disputed')).toBe(false)
  })
})

describe('the table is total', () => {
  it('every status has an entry, so an unknown state cannot silently allow everything', () => {
    for (const status of ALL_STATUSES) {
      expect(Array.isArray(allowedEvents(status)), status).toBe(true)
    }
  })

  it('every reachable status is reachable', () => {
    const reached = new Set<OrderStatus>(['pending'])
    for (const from of ALL_STATUSES) {
      for (const e of allowedEvents(from)) {
        const r = applyEvent(order({ status: from, rail: 'paypal', amount: 100 }), e)
        if ('status' in r) reached.add(r.status)
      }
    }
    for (const s of ALL_STATUSES) expect(reached.has(s), `${s} unreachable`).toBe(true)
  })
})

describe('validAmount — minor units, integer, positive', () => {
  it('accepts a positive integer', () => {
    expect(validAmount(1)).toBe(true)
    expect(validAmount(1_000_000)).toBe(true)
  })

  it('⛔ rejects floats, zero, negatives and unsafe integers', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754; a marketplace that rounds a cent per order rounds a real
    // amount per year, so money never crosses this module as a float.
    for (const bad of [0, -1, 0.1, 1.5, NaN, Infinity, -Infinity, 2 ** 53]) {
      expect(validAmount(bad), String(bad)).toBe(false)
    }
  })
})
