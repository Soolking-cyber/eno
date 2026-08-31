import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  /** Queue of errors to throw from `create`, one per attempt. */
  throwOn: [] as (Error | null)[],
  payout: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/db', () => ({
  db: {
    order: {
      create: async (a: { data: Record<string, unknown> }) => {
        const e = h.throwOn.shift()
        if (e) throw e
        h.created.push(a.data)
        return { id: `o${h.created.length}`, reference: a.data.reference }
      },
    },
    sellerPayout: { findUnique: async () => h.payout },
  },
}))

const { createOrder, payoutTargetFor } = await import('./orders')

const p2002 = (target: string[]) => {
  const e = new Error('unique') as Error & { code?: string; meta?: { target?: string[] } }
  e.code = 'P2002'; e.meta = { target }
  return e
}

const abroad = { kycVerified: true, nationality: 'GBR', residenceCountry: 'GBR' }
const inVietnam = { kycVerified: true, nationality: 'GBR', residenceCountry: 'VNM' }

const input = (over: Record<string, unknown> = {}) => ({
  listingId: 'l1', sellerId: 's1', buyerId: 'b1',
  amount: 540_000, currency: 'VND' as const,
  buyer: inVietnam, seller: { ...inVietnam, vietqrPayout: true },
  ...over,
})

beforeEach(() => {
  h.created = []; h.throwOn = []; h.payout = null
  vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('createOrder — the only place a reference is minted', () => {
  it('creates an order carrying a fresh reference', async () => {
    const r = await createOrder(input())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reference).toMatch(/^ENO[0-9A-HJKMNP-TV-Z]{9}$/)
    expect(h.created[0]).toMatchObject({ status: 'awaiting_payment', currency: 'VND', reference: r.reference })
  })

  it('⛔ starts in `awaiting_payment`, because that is the only state a payment can settle from', async () => {
    // `pending` is where a seller has not yet accepted. An order reaching here has an agreed price
    // and a buyer about to be shown a QR — and `payment_confirmed` is only legal from
    // `awaiting_payment`, so starting anywhere else means the webhook can never settle it.
    await createOrder(input())
    expect(h.created[0].status).toBe('awaiting_payment')
  })

  it('⛔ the RAIL IS DERIVED, never taken from the caller', async () => {
    /**
     * ⛔ ACCEPTING A RAIL WOULD LET A CLIENT PICK ONE THE LAW REFUSES and the server would agree.
     * A Vietnamese resident gets the QR; a foreign resident gets the wallet first. Neither asked.
     */
    const vn = await createOrder(input())
    expect(vn.ok && vn.rail, 'a VN pair paying dong gets the QR').toBe('vietqr')

    const foreign = await createOrder(input({
      buyer: abroad, seller: { ...abroad, vietqrPayout: true }, currency: 'USD', amount: 12_50,
    }))
    expect(foreign.ok && foreign.rail, 'a foreign pair paying USD gets the wallet').toBe('crossmint')
  })

  it('⛔ the rail must SPEAK the order’s currency', async () => {
    /**
     * ⛔ A `vietqr` ORDER PRICED IN USD WOULD HAVE RENDERED A NAPAS CODE ASKING FOR THAT NUMBER OF
     * DONG — a hundredth of the price — and no webhook could ever settle it, because the match
     * compares currencies. A reviewer found the gap. VietQR moves dong; the wallet and PayPal move
     * USD; neither is a per-order preference.
     */
    // ⛔ A FOREIGN PAIR PRICED IN DONG HAS NO RAIL AT ALL. VietQR is the only dong rail and it needs
    // a buyer who can reach NAPAS; the wallet and PayPal move USD. Better no order than one whose
    // QR asks for a hundredth of the price.
    const vndAbroad = await createOrder(input({
      buyer: abroad, seller: { ...abroad, vietqrPayout: true }, currency: 'VND',
    }))
    expect(vndAbroad, 'a foreign pair has no dong rail').toEqual({ ok: false, reason: 'no_rail' })

    /**
     * ⚠️ A VIETNAMESE PAIR PAYING IN USD GETS PAYPAL, AND THAT IS CORRECT — this test asserted
     * `no_rail` until running it said otherwise. PayPal is lawful for a Vietnamese party and settles
     * USD; what the DTI Law forbids them is the stablecoin rail, which the country gate already
     * refuses. The currency rule picks the rail that speaks the price, it does not narrow the law.
     */
    const usdInVietnam = await createOrder(input({ currency: 'USD', amount: 12_50 }))
    expect(usdInVietnam.ok && usdInVietnam.rail).toBe('paypal')
    // ⛔ AND NEVER THE WALLET, whatever the currency.
    expect(usdInVietnam.ok && usdInVietnam.rail).not.toBe('crossmint')
  })

  it('⛔ refuses when no rail is open to the pair', async () => {
    // An unverified party settles nothing, on any rail.
    const r = await createOrder(input({ buyer: { ...inVietnam, kycVerified: false } }))
    expect(r).toEqual({ ok: false, reason: 'no_rail' })
    expect(h.created).toHaveLength(0)
  })

  it('⛔ refuses a nonsense amount before writing anything', async () => {
    // order-state.ts refuses a float at the money edge, but an order created with one would sit in
    // `awaiting_payment` displaying a price no bank can be asked for.
    for (const amount of [0, -1, 1.5, NaN, Infinity, 2 ** 53]) {
      expect(await createOrder(input({ amount })), String(amount)).toEqual({ ok: false, reason: 'bad_amount' })
    }
    expect(h.created).toHaveLength(0)
  })

  it('⚠️ retries a reference collision rather than showing a buyer a P2002', async () => {
    // The unique index is the real guarantee and it fails by throwing. "Unlikely" is not "handled".
    h.throwOn = [p2002(['reference'])]
    const r = await createOrder(input())
    expect(r.ok).toBe(true)
    expect(h.created).toHaveLength(1)
  })

  it('⛔ gives up honestly rather than looping forever', async () => {
    h.throwOn = [p2002(['reference']), p2002(['reference']), p2002(['reference'])]
    expect(await createOrder(input())).toEqual({ ok: false, reason: 'reference_collision' })
  })

  it('⛔ does NOT retry a different constraint — that would mask a real error three times', async () => {
    // A bad foreign key, or the composite listing/seller constraint, is a genuine failure. Three
    // identical attempts would hide it behind a collision message that is not true.
    h.throwOn = [p2002(['listingId', 'sellerId'])]
    await expect(createOrder(input())).rejects.toThrow()
  })
})

describe('payoutTargetFor — the one place bank details are read', () => {
  it('returns them when the seller is genuinely payable', async () => {
    h.payout = { bankBin: '970415', bankAccountNo: '0011001932418', bankAccountName: 'NGUYEN VAN A' }
    expect(await payoutTargetFor('s1')).toEqual(h.payout)
  })

  it('⛔ null when there is no payout row at all — the default for every seller', async () => {
    h.payout = null
    expect(await payoutTargetFor('s1')).toBeNull()
  })

  it('⛔ null when the details are MALFORMED, not merely absent', async () => {
    // The same predicate the rail gate uses, so "payable by QR" cannot mean one thing when the rail
    // is offered and another when the code is drawn.
    for (const bad of [
      { bankBin: '97041', bankAccountNo: '0011001932418', bankAccountName: 'A' },
      { bankBin: '970415', bankAccountNo: '00-11', bankAccountName: 'A' },
      { bankBin: '970415', bankAccountNo: '0011001932418', bankAccountName: '  ' },
    ]) {
      h.payout = bad
      expect(await payoutTargetFor('s1'), JSON.stringify(bad)).toBeNull()
    }
  })
})
