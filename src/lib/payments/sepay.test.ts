import { describe, expect, it } from 'vitest'
import { authorised, readTransfer } from './sepay'

// This endpoint is a public URL that marks orders paid. Everything below is about what it REFUSES.

/**
 * ⚠️ NOT NAMED `SECRET`, AND THE NAME IS THE POINT. Called that, this line tripped the commit
 * gate's credential scanner — which was RIGHT to stop on `SECRET = '<long string>'`. A scanner
 * that cannot tell a fixture from a credential should fail closed, and the fix is to stop writing
 * test fixtures that look like credentials rather than to teach it exceptions. Second time in this
 * codebase; the first was a secp256k1 test vector.
 */
const CONFIGURED = 'sepay-shared-value-for-tests'

describe('authorised — the only thing between a notification and a forgery', () => {
  it('accepts the configured value in SePay’s scheme', () => {
    expect(authorised(`Apikey ${CONFIGURED}`, CONFIGURED)).toBeNull()
  })

  it('the scheme word is case-insensitive, as HTTP auth schemes are', () => {
    for (const h of [`apikey ${CONFIGURED}`, `APIKEY ${CONFIGURED}`, `ApiKey  ${CONFIGURED}`]) {
      expect(authorised(h, CONFIGURED), h).toBeNull()
    }
  })

  it('⛔ NO SHARED VALUE CONFIGURED REFUSES EVERYTHING — it does not wave callers through', () => {
    /**
     * ⛔ THE DEFAULT STATE OF AN ENVIRONMENT NOBODY HAS SET UP, and the direction it fails in is the
     * whole question. An endpoint that accepts anything when unconfigured lets a stranger mark
     * their own order paid on the day the feature ships and before anyone notices.
     */
    for (const expected of [undefined, '', '   ']) {
      expect(authorised(`Apikey ${CONFIGURED}`, expected), JSON.stringify(expected))
        .toEqual({ ok: false, reason: 'not_configured' })
    }
  })

  it('⛔ refuses a wrong, absent, or nearly-right value', () => {
    for (const h of [
      null, undefined, '', 'Apikey', `Apikey ${CONFIGURED}x`, `Apikey ${CONFIGURED.slice(0, -1)}`,
      `Bearer ${CONFIGURED}`, CONFIGURED,
    ]) expect(authorised(h, CONFIGURED), JSON.stringify(h)).toEqual({ ok: false, reason: 'unauthorised' })
  })

  it('⛔ a WRONG-LENGTH value is refused, not a 500', () => {
    // `timingSafeEqual` throws on unequal lengths. Calling it without a length guard turns a
    // wrong-length guess into a different response — which is itself the leak the guard prevents.
    for (const h of [`Apikey x`, `Apikey ${'y'.repeat(500)}`]) {
      expect(() => authorised(h, CONFIGURED), h).not.toThrow()
      expect(authorised(h, CONFIGURED), h).toEqual({ ok: false, reason: 'unauthorised' })
    }
  })
})

const body = (over: Record<string, unknown> = {}) => ({
  id: '92704',
  transferType: 'in',
  transferAmount: 540_000,
  content: 'CHUYEN TIEN ENO7X2K9MQ4Z',
  referenceCode: 'FT25123456789',
  accountNumber: '0011001932418',
  ...over,
})

describe('readTransfer', () => {
  it('reads an ordinary incoming transfer', () => {
    expect(readTransfer(body())).toEqual({
      ok: true,
      transfer: {
        id: '92704',
        memo: 'CHUYEN TIEN ENO7X2K9MQ4Z',
        amountVnd: 540_000,
        bankRef: 'FT25123456789',
        accountNumber: '0011001932418',
      },
    })
  })

  it('⛔ REFUSES AN OUTGOING TRANSFER — a payout is not a payment', () => {
    /**
     * ⛔ SePay REPORTS BOTH DIRECTIONS ON THE SAME ENDPOINT. Treating money we SENT as money we
     * RECEIVED would mark an order paid because a seller was paid out — and the amounts would often
     * match, because it is the same order.
     */
    expect(readTransfer(body({ transferType: 'out' }))).toEqual({ ok: false, reason: 'not_incoming' })
  })

  it('⛔ an ABSENT direction is refused, never assumed incoming', () => {
    for (const transferType of [undefined, null, '', 'IN ', 'incoming', 123]) {
      const r = readTransfer(body({ transferType }))
      if (transferType === 'IN ') { expect(r.ok, 'trimmed and lowercased').toBe(true); continue }
      expect(r, JSON.stringify(transferType)).toEqual({ ok: false, reason: 'not_incoming' })
    }
  })

  it('accepts a numeric STRING amount, because SePay has sent both', () => {
    expect(readTransfer(body({ transferAmount: '540000' })).ok).toBe(true)
  })

  it('⛔ refuses an amount that is not whole, positive dong', () => {
    // `Number('')` and `Number(null)` are both 0 — coercing would turn a MISSING amount into a
    // zero-value payment, refused for the wrong reason.
    for (const transferAmount of [0, -1, 1.5, '', null, undefined, 'abc', NaN, Infinity, {}]) {
      expect(readTransfer(body({ transferAmount })), JSON.stringify(transferAmount))
        .toEqual({ ok: false, reason: 'not_incoming' })
    }
  })

  it('⛔ NO ID MEANS NO IDEMPOTENCY, so it is refused', () => {
    // SePay retries. Without a stable id a retry is indistinguishable from a second payment, and
    // only the order state machine would stand between that and a double credit.
    expect(readTransfer(body({ id: undefined, referenceCode: undefined })))
      .toEqual({ ok: false, reason: 'malformed' })
  })

  it('falls back to referenceCode when there is no id', () => {
    expect(readTransfer(body({ id: undefined })).ok).toBe(true)
  })

  it('⚠️ reads `description` when `content` is absent', () => {
    // The field carrying the reference has moved between SePay versions; reading the wrong one
    // means every payment silently fails to match.
    const r = readTransfer(body({ content: undefined, description: 'ENO7X2K9MQ4Z' }))
    expect(r.ok && r.transfer.memo).toBe('ENO7X2K9MQ4Z')
  })

  it('⛔ refuses a body that is not an object', () => {
    for (const b of [null, undefined, 'string', 42, [], [body()]]) {
      expect(readTransfer(b), JSON.stringify(b)).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('an EMPTY memo still reads — refusing it here would hide the real reason', () => {
    // A transfer with no memo is unattributable, but that is `matchesOrder`'s answer to give
    // (`no_reference`), not a parse failure. Collapsing the two would make an operator investigate
    // a malformed webhook when the truth is a buyer who cleared the memo field.
    const r = readTransfer(body({ content: undefined, description: undefined }))
    expect(r.ok && r.transfer.memo).toBe('')
  })
})
