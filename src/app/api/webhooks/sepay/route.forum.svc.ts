import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logError, logWarn, logInfo } from '@/lib/log'
import { authorised, readTransfer } from '@/lib/payments/sepay'
import { extractReference, matchesOrder } from '@/lib/payments/reference'
import { applyEvent } from '@/lib/payments/order-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * SEPAY BANK WEBHOOK — where a VietQR transfer becomes a paid order.
 *
 * ⛔ `.svc.` SO IT DOES NOT EXIST ON eno.vn AT ALL. Settlement is a services-edition feature, and a
 * route file with this extension is excluded by `pageExtensions` at BUILD time — not gated at
 * runtime, not conditionally rendered: the licensed marketplace image simply has no such endpoint.
 * That is the strongest form of the boundary available and this is exactly what it is for.
 *
 * ⛔ IT IS A PUBLIC URL THAT MARKS ORDERS PAID. Anyone can POST to it. The shared secret is the only
 * thing between a real bank notification and someone paying for their own order with a curl command,
 * which is why it is checked FIRST, in constant time, and refuses everything when unconfigured.
 *
 * ⚠️ AND IT DOES NOT SPEAK OUR API'S ERROR ENVELOPE, deliberately. The `errors.ts` contract test
 * harvests `error: '…'` literals out of route files so a client can type-check against every code
 * the API emits — and it caught this endpoint adding `unauthorised` and `malformed` to that public
 * vocabulary. They do not belong there: the only consumer of these responses is SePay's retry
 * logic, which reads the STATUS and nothing else. Adding them to the client-facing type would have
 * been the easy way to make the gate green and would have described an API surface that does not
 * exist. `{ ok, reason }` says the same thing to SePay without claiming to be part of our contract.
 *
 * ⚠️ IT DOES NOT USE THE HOUSE `route()` WRAPPER, deliberately. That helper's auth modes are
 * session- and API-key-shaped; a webhook authenticates with a provider's own scheme and must not
 * acquire a rate limit that could make a bank notification bounce. The trade is that everything the
 * wrapper normally provides — the error envelope, the logging — is written out here.
 */

/**
 * ⚠️ 200 FOR ANYTHING WE UNDERSTOOD, EVEN WHEN WE COULD NOT USE IT. SePay retries on a non-2xx, and
 * a memo that does not match will not match on the fourth attempt either — retrying turns one
 * unattributable payment into a stream of them. The money is not lost by answering 200: it is on a
 * bank statement, and the log line below is what an operator reconciles from. Only a failure that a
 * RETRY COULD FIX (our database being down) gets a 5xx.
 */
function ack() {
  /**
   * ⛔ A FUNCTION, NOT A MODULE-SCOPE CONSTANT — AND THE CONSTANT WAS A SEVERE BUG. A `Response`
   * body is a ONE-SHOT STREAM: the first request sends it and leaves it disturbed, so the second
   * delivery returning the same object throws while Next serialises it. The endpoint would have
   * answered 200 once and then 500 forever, which SePay retries, which 500s too — the whole
   * "answer 200 so retries stop" design collapsing after a single request per process. A reviewer
   * found it; no test would have, because every test calls the handler once.
   */
  return NextResponse.json({ ok: true })
}

export async function POST(req: Request) {
  const auth = authorised(req.headers.get('authorization'), process.env.SEPAY_WEBHOOK_SECRET)
  if (auth) {
    // ⚠️ THE SAME 401 FOR BOTH, and the log tells them apart. Answering `not_configured`
    // differently would let a stranger discover that this environment has no secret set.
    logWarn('sepay webhook refused', { at: 'webhook.sepay.auth', reason: auth.reason })
    return NextResponse.json({ ok: false, reason: 'unauthorised' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'malformed' }, { status: 400 })
  }

  const parsed = readTransfer(body)
  if (!parsed.ok) {
    logWarn('sepay payload not usable', { at: 'webhook.sepay.parse', reason: parsed.reason })
    // ⚠️ 200: an outgoing transfer or a shape we do not act on is not an error SePay can fix.
    return ack()
  }
  const transfer = parsed.transfer

  const reference = extractReference(transfer.memo)
  if (!reference) {
    /**
     * ⛔ MONEY THAT ARRIVED WITH NOTHING TO ATTACH IT TO. This is the state an operator has to
     * resolve by hand, so the log carries everything needed to find it on a statement: the bank's
     * own reference, the amount, and the memo as sent.
     */
    logWarn('sepay transfer carries no usable order reference', {
      at: 'webhook.sepay.unattributed',
      sepayId: transfer.id, bankRef: transfer.bankRef, amountVnd: transfer.amountVnd, memo: transfer.memo,
    })
    return ack()
  }

  try {
    const order = await db.order.findUnique({
      where: { reference },
      select: { id: true, status: true, rail: true, amount: true, currency: true, reference: true },
    })
    if (!order) {
      logWarn('sepay transfer names an unknown order', {
        at: 'webhook.sepay.unknown', reference, sepayId: transfer.id, amountVnd: transfer.amountVnd,
      })
      return ack()
    }

    const match = matchesOrder(
      { reference: order.reference, amount: order.amount, currency: order.currency as 'VND' | 'USD' },
      { memo: transfer.memo, amount: transfer.amountVnd, currency: 'VND' },
    )
    if (!match.ok) {
      /**
       * ⛔ THE RIGHT ORDER AND THE WRONG MONEY IS NOT A PAYMENT. No tolerance: accepting an
       * underpayment silently discounts the seller's item and accepting an overpayment owes change
       * we cannot return. A human decides.
       */
      logWarn('sepay transfer does not match its order', {
        at: 'webhook.sepay.mismatch', reference, reason: match.reason,
        expected: String(order.amount), got: transfer.amountVnd, sepayId: transfer.id,
      })
      return ack()
    }

    const next = applyEvent(
      { status: order.status as never, rail: order.rail as never, amount: order.amount, currency: order.currency as 'VND' | 'USD' },
      'payment_confirmed',
    )
    if ('error' in next) {
      /**
       * ⚠️ ALMOST ALWAYS A REPLAY, AND THAT IS THE DESIGN WORKING. SePay delivers at least once, so
       * the second delivery finds the order already `paid`, where `payment_confirmed` has no legal
       * transition. Idempotency by STATE rather than by remembering delivery ids — see
       * order-state.ts. It is logged at info because it is expected, not at warn.
       */
      logInfo('sepay transfer had no legal transition — most likely a replay', {
        at: 'webhook.sepay.replay', reference, from: order.status, error: next.error,
      })
      return ack()
    }

    /**
     * ⛔ ONE TRANSACTION, BECAUSE THE STATUS AND ITS AUDIT ROW MUST NOT COME APART. Two reviewers
     * traced it: the update could succeed and the event insert fail, the handler answers 503, and
     * SePay's retry then finds an already-`paid` order, calls it a replay and returns 200 — leaving
     * a settled order with no record of how it settled, forever, and nothing anywhere saying so.
     * order-state.ts already says a caller must write the row and the history together; this is
     * that instruction honoured.
     *
     * ⛔ AND THE UPDATE IS STILL CONDITIONAL INSIDE IT. Two simultaneous deliveries both read
     * `awaiting_payment`; `updateMany` with the status in the WHERE clause means exactly one
     * changes a row and the loser sees `count: 0`. A transaction alone would not settle that race —
     * both would commit.
     * ⚠️ `railRef` IS UNIQUE, so one bank transfer cannot be recorded against two orders even if a
     * memo somehow named both.
     */
    const settled = await db.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: order.id, status: 'awaiting_payment' },
        data: { status: next.status, paidAt: new Date(), railRef: `sepay:${transfer.id}` },
      })
      if (count === 0) return false
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'payment_confirmed',
          fromStatus: order.status,
          toStatus: next.status,
          // ⚠️ THE AUDIT ROW CARRIES THE BANK'S OWN REFERENCE, because reconciling against a
          // statement months later is done by that number, not by ours.
          metaJson: JSON.stringify({ rail: 'vietqr', sepayId: transfer.id, bankRef: transfer.bankRef, amountVnd: transfer.amountVnd }),
        },
      })
      return true
    })
    if (!settled) {
      logInfo('sepay settlement lost the race — another delivery got there first', {
        at: 'webhook.sepay.race', reference, sepayId: transfer.id,
      })
      return ack()
    }

    logInfo('order paid by bank transfer', {
      at: 'webhook.sepay.paid', reference, orderId: order.id, amountVnd: transfer.amountVnd,
    })
    return ack()
  } catch (e) {
    /**
     * ⛔ A UNIQUE VIOLATION IS NOT RETRYABLE, AND ANSWERING 503 TO ONE IS A RETRY STORM. A reviewer
     * traced it: `railRef` is unique, so a redelivery of a transfer already recorded against
     * another order throws P2002 — and 503 tells SePay to come back, where it throws again, forever.
     * The constraint doing its job must not read as "our database is down".
     */
    const code = (e as { code?: string })?.code
    if (code === 'P2002') {
      logWarn('this bank transfer is already recorded against an order', {
        at: 'webhook.sepay.duplicate', reference, sepayId: transfer.id,
      })
      return ack()
    }
    /**
     * ⛔ 5xx HERE, AND ONLY HERE. This is the one failure a RETRY could fix — our database was
     * unreachable, the money is real, and SePay retrying in a minute is exactly what we want. Every
     * other path above answers 200 precisely because retrying would not help.
     */
    logError(e, { at: 'webhook.sepay.persist', reference, sepayId: transfer.id })
    return NextResponse.json({ ok: false, reason: 'retry' }, { status: 503 })
  }
}
