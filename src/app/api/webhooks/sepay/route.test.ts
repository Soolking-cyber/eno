import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * ⛔ THE ROUTE ITSELF, NOT JUST THE PURE MODULES IT SPENDS. A reviewer pointed out that
 * `reference.ts` and `sepay.ts` were carefully tested while the handler that turns their answers
 * into money had no test at all — and then found a bug in it that only appears on the SECOND
 * request, which is exactly the class a single-call test would also have missed. So this file calls
 * the handler repeatedly on purpose.
 *
 * ⚠️ IT IMPORTS `route.svc.ts` DIRECTLY. That extension means Next never compiles the file into the
 * marketplace build; vitest has no such convention, so the module is importable here and the
 * edition boundary is proven separately by grepping the built artifact.
 */

const h = vi.hoisted(() => ({
  order: null as Record<string, unknown> | null,
  updateCount: 1,
  events: [] as Record<string, unknown>[],
  txThrows: false,
  txCode: null as string | null,
  logs: [] as string[],
}))

vi.mock('@/lib/db', () => ({
  db: {
    order: { findUnique: async () => h.order },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (h.txCode) { const e = new Error('constraint') as Error & { code?: string }; e.code = h.txCode; throw e }
      if (h.txThrows) throw new Error('db down')
      return fn({
        order: { updateMany: async () => ({ count: h.updateCount }) },
        orderEvent: { create: async (a: { data: Record<string, unknown> }) => { h.events.push(a.data); return a.data } },
      })
    },
  },
}))
vi.mock('@/lib/log', () => ({
  logInfo: (m: string) => { h.logs.push(`info:${m}`) },
  logWarn: (m: string) => { h.logs.push(`warn:${m}`) },
  logError: () => { h.logs.push('error') },
}))

const { POST } = await import('./route.forum.svc')

const CONFIGURED = 'sepay-shared-value-for-tests'
const REF = 'ENO7X2K9MQ4Z'

const post = (body: unknown, auth: string | null = `Apikey ${CONFIGURED}`) =>
  POST(new Request('https://eno.forum/api/webhooks/sepay', {
    method: 'POST',
    headers: auth ? { authorization: auth, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))

const transfer = (over: Record<string, unknown> = {}) => ({
  id: '92704', transferType: 'in', transferAmount: 540_000,
  content: `CHUYEN TIEN ${REF}`, referenceCode: 'FT2512', accountNumber: '0011001932418', ...over,
})

beforeEach(() => {
  vi.stubEnv('SEPAY_WEBHOOK_SECRET', CONFIGURED)
  h.order = { id: 'o1', status: 'awaiting_payment', rail: 'vietqr', amount: BigInt(540_000), currency: 'VND', reference: REF }
  h.updateCount = 1; h.events = []; h.txThrows = false; h.txCode = null; h.logs = []
})
afterEach(() => { vi.unstubAllEnvs() })

describe('⛔ the handler survives being called more than once', () => {
  it('⛔ TWO deliveries both get a readable 200 — the one-shot Response bug', async () => {
    /**
     * ⛔ THE BUG A REVIEWER FOUND AND NO SINGLE-CALL TEST WOULD. The ack was a module-scope
     * `NextResponse.json(...)`, and a Response body is a one-shot stream: the first request sends
     * it and leaves it disturbed, so the second throws during serialisation. The endpoint would
     * have answered 200 once and 500 forever after — and SePay retries a 500, so every retry 500s
     * too and the "answer 200 so retries stop" design collapses entirely.
     */
    const a = await post(transfer({ content: 'NO REFERENCE HERE' }))
    const b = await post(transfer({ content: 'NO REFERENCE HERE' }))
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    // ⚠️ THE BODY IS READ, not just the status — a disturbed stream throws here, not at construction.
    await expect(a.json()).resolves.toEqual({ ok: true })
    await expect(b.json()).resolves.toEqual({ ok: true })
  })

  it('a settlement followed by its replay both answer 200', async () => {
    const first = await post(transfer())
    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toEqual({ ok: true })

    h.order = { ...h.order!, status: 'paid' } // the replay finds it already settled
    const replay = await post(transfer())
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toEqual({ ok: true })
    expect(h.logs.some((l) => l.includes('replay'))).toBe(true)
  })
})

describe('authentication comes first', () => {
  it('⛔ refuses an unsigned or wrong call with 401, before touching the body', async () => {
    for (const auth of [null, 'Apikey wrong', 'Bearer x']) {
      const r = await post(transfer(), auth)
      expect(r.status, String(auth)).toBe(401)
    }
  })

  it('⛔ refuses everything when NO secret is configured', async () => {
    // The default state of an environment nobody has set up. Accepting here would let a stranger
    // mark their own order paid on the day this ships.
    vi.stubEnv('SEPAY_WEBHOOK_SECRET', '')
    expect((await post(transfer())).status).toBe(401)
  })
})

describe('what it does with a real notification', () => {
  it('settles the order and writes ONE audit event carrying the bank reference', async () => {
    await post(transfer())
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({ orderId: 'o1', type: 'payment_confirmed', toStatus: 'paid' })
    expect(String(h.events[0].metaJson)).toContain('FT2512')
  })

  it('⛔ losing the conditional-update race writes NO event', async () => {
    // Two simultaneous deliveries both read `awaiting_payment`; exactly one may change the row.
    h.updateCount = 0
    const r = await post(transfer())
    expect(r.status).toBe(200)
    expect(h.events).toHaveLength(0)
  })

  it('⛔ a WRONG AMOUNT settles nothing, however right the reference', async () => {
    const r = await post(transfer({ transferAmount: 539_999 }))
    expect(r.status).toBe(200)
    expect(h.events).toHaveLength(0)
    expect(h.logs.some((l) => l.includes('does not match'))).toBe(true)
  })

  it('⛔ an OUTGOING transfer settles nothing — a payout is not a payment', async () => {
    await post(transfer({ transferType: 'out' }))
    expect(h.events).toHaveLength(0)
  })

  it('an unknown reference is acknowledged, not retried', async () => {
    h.order = null
    const r = await post(transfer())
    expect(r.status).toBe(200)
    expect(h.logs.some((l) => l.includes('unknown'))).toBe(true)
  })

  it('⛔ a DATABASE failure answers 503, because a retry CAN fix that one', async () => {
    // The only path that asks SePay to come back. Every other refusal answers 200 precisely
    // because retrying would not help.
    h.txThrows = true
    expect((await post(transfer())).status).toBe(503)
  })

  it('⛔ a DUPLICATE bank transfer is acknowledged, not retried forever', async () => {
    /**
     * ⛔ 503 ON A UNIQUE VIOLATION IS A RETRY STORM. `railRef` is unique, so a redelivery of a
     * transfer already recorded against another order throws P2002 — and telling SePay to come back
     * means it throws again, forever. The constraint doing its job must not read as "our database
     * is down".
     */
    h.txCode = 'P2002'
    const r = await post(transfer())
    expect(r.status).toBe(200)
    expect(h.logs.some((l) => l.includes('already recorded'))).toBe(true)
  })

  it('⚠️ a NUMERIC id still settles — SePay sends both, and requiring a string dropped payments', async () => {
    await post(transfer({ id: 92704, referenceCode: undefined }))
    expect(h.events).toHaveLength(1)
  })
})
