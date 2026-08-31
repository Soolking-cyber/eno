import { describe, expect, it } from 'vitest'
import {
  REFERENCE_PREFIX, extractReference, isReference, matchesOrder, newReference, normaliseForMatch,
} from './reference'

// The reference is the ENTIRE link between a bank transfer and an order — no session, no callback,
// no return trip through our site. So these tests are mostly about what must NOT match.

describe('newReference', () => {
  it('is our prefix plus nine alphabet characters', () => {
    for (let i = 0; i < 50; i++) expect(isReference(newReference())).toBe(true)
  })

  it('⛔ never contains I, L, O or U — the glyphs a human reads wrong off a phone', () => {
    // A buyer editing the memo by hand is ordinary: some banking apps do not carry the pre-filled
    // text through every screen. `I`/`1`, `O`/`0` and `L`/`1` are where that goes wrong.
    // ⚠️ THE RANDOM PART ONLY. The prefix `ENO` contains an O by design — it is fixed, printed on
    // every code, and never something a human has to disambiguate.
    const many = Array.from({ length: 400 }, () => newReference().slice(REFERENCE_PREFIX.length)).join('')
    expect(many).not.toMatch(/[ILOU]/)
  })

  it('⛔ does not repeat itself — a collision is two orders sharing one payment', () => {
    const seen = new Set(Array.from({ length: 2000 }, newReference))
    expect(seen.size).toBe(2000)
  })

  it('⚠️ leaves room under the 25-character memo ceiling', () => {
    // `sanitiseMemo` truncates at 25 because banks do. 12 characters means nothing a bank appends
    // can eat the reference.
    expect(newReference().length).toBe(12)
  })

  it('⚠️ is drawn from crypto, so the NEXT one cannot be predicted', () => {
    // Not because it is secret — it is printed on a QR — but because a predictable sequence lets
    // someone watch for the next one and pay against an order that is not theirs. A flat
    // distribution over 32 symbols is the observable consequence.
    const chars = Array.from({ length: 300 }, newReference).join('').slice(REFERENCE_PREFIX.length)
    expect(new Set(chars).size).toBeGreaterThan(20)
  })
})

describe('normaliseForMatch — the same shape on both sides, or nothing matches', () => {
  it('survives everything a bank does to a memo', () => {
    const ref = 'ENO7X2K9MQ4Z'
    // ⚠️ NOT `ref.split('').join(' ')` — a bank that put a space between every CHARACTER has
    // destroyed the reference, and pretending otherwise is how a boundary check gets removed.
    for (const variant of [ref.toLowerCase(), ` ${ref} `, `CHUYEN TIEN ${ref}`, `${ref}/GD99`]) {
      expect(normaliseForMatch(variant)).toContain('ENO7X2K9MQ4Z')
    }
  })

  it('strips Vietnamese diacritics, so a transliterating bank still matches', () => {
    expect(normaliseForMatch('Chuyển tiền ENO7X2K9MQ')).toBe('CHUYEN TIEN ENO7X2K9MQ')
  })

  it('handles null and undefined rather than throwing on them', () => {
    expect(normaliseForMatch(null)).toBe('')
    expect(normaliseForMatch(undefined)).toBe('')
  })
})

describe('extractReference — located, not compared', () => {
  it('finds ours inside the bank’s own decoration', () => {
    expect(extractReference('CHUYEN TIEN ENO7X2K9MQ4Z GD 123456')).toBe('ENO7X2K9MQ4Z')
  })

  it('⛔ returns null when a memo names TWO references', () => {
    /**
     * ⛔ THE CASE THAT MUST NEVER BE GUESSED. A memo naming several orders is a human doing
     * something unusual, and picking one of them is exactly the guess that should not be automated.
     * An operator looks at it instead.
     */
    expect(extractReference('ENO111111111 AND ENO222222222')).toBeNull()
  })

  it('the same reference twice is still one reference', () => {
    expect(extractReference('ENO7X2K9MQ4Z ENO7X2K9MQ4Z')).toBe('ENO7X2K9MQ4Z')
  })

  it('returns null for a memo with nothing of ours in it', () => {
    for (const memo of ['', null, undefined, 'THANH TOAN', 'ENO', 'ENO123']) {
      expect(extractReference(memo), JSON.stringify(memo)).toBeNull()
    }
  })
})

const order = { reference: 'ENO7X2K9MQ4Z', amount: 540_000, currency: 'VND' as const }
const paid = (over: Record<string, unknown> = {}) => ({
  memo: `CHUYEN TIEN ${order.reference}`, amount: 540_000, currency: 'VND', ...over,
})

describe('matchesOrder — the one judgement money turns on', () => {
  it('matches an ordinary transfer', () => {
    expect(matchesOrder(order, paid())).toEqual({ ok: true })
  })

  it('matches however the bank mangled the memo', () => {
    for (const memo of [
      order.reference,
      order.reference.toLowerCase(),
      `chuyen tien ${order.reference} gd 99`,
      `Chuyển tiền ${order.reference}`,
      `  ${order.reference}  `,
    ]) expect(matchesOrder(order, paid({ memo })), memo).toEqual({ ok: true })
  })

  it('⛔ SPACES ARE KEPT, because they are the only boundary a reference has', () => {
    /**
     * ⛔ THE BUG THIS FILE'S OWN TEST CAUGHT. Stripping spaces looked harmless — a bank adding or
     * removing one means nothing — but it destroyed the boundary, so `ENO7X2K9MQ4Z` matched inside
     * `ENO7X2K9MQ4ZY` and a neighbouring order's reference would have taken the payment.
     * ⚠️ THE TRADE IS ONE-WAY: a bank that DELETES a space now causes a failure to match.
     * Unattributed money waits for an operator; money paid to the wrong seller does not come back.
     */
    expect(normaliseForMatch('CHUYEN TIEN ENO7X2K9MQ4Z')).toBe('CHUYEN TIEN ENO7X2K9MQ4Z')
    expect(matchesOrder(order, paid({ memo: 'CHUYENTIENENO7X2K9MQ4Z' })))
      .toEqual({ ok: false, reason: 'no_reference' })
  })

  it('⛔ a LONGER reference containing ours does NOT match', () => {
    /**
     * ⛔ WHY THIS EXTRACTS RATHER THAN CALLING `includes()`. A substring search for the stored
     * reference matches any longer string that contains it, so a neighbouring order's reference
     * with our characters as a prefix would take the payment. Extracting and comparing whole
     * strings is the only shape that cannot do that.
     */
    expect(matchesOrder(order, paid({ memo: 'ENO7X2K9MQ4ZY' }))).not.toEqual({ ok: true })
  })

  it('⛔ the wrong AMOUNT is not this payment, however right the reference', () => {
    // No tolerance: accepting an underpayment silently discounts the seller's item, and accepting
    // an overpayment owes change there is no mechanism to return. Both are for a human.
    for (const amount of [539_999, 540_001, 0, 54_000_000]) {
      expect(matchesOrder(order, paid({ amount })), String(amount)).toEqual({ ok: false, reason: 'amount_mismatch' })
    }
  })

  it('⛔ the wrong CURRENCY is not this payment either', () => {
    expect(matchesOrder(order, paid({ currency: 'USD' }))).toEqual({ ok: false, reason: 'amount_mismatch' })
  })

  it('⚠️ compares as bigint, because Prisma hands back int8 and a webhook sends a number', () => {
    // `1000n === 1000` is false, and Number(bigint) loses precision above 2^53.
    expect(matchesOrder({ ...order, amount: BigInt(540_000) }, paid())).toEqual({ ok: true })
    expect(matchesOrder(order, paid({ amount: BigInt(540_000) }))).toEqual({ ok: true })
  })

  it('distinguishes WHY it did not match, because the responses differ', () => {
    // A missing reference is unattributed money; an unknown one may be a typo; two is ambiguous.
    // An operator does something different in each case.
    expect(matchesOrder(order, paid({ memo: 'THANH TOAN' }))).toEqual({ ok: false, reason: 'no_reference' })
    expect(matchesOrder(order, paid({ memo: 'ENO000000000' }))).toEqual({ ok: false, reason: 'unknown_reference' })
    expect(matchesOrder(order, paid({ memo: 'ENO111111111 ENO222222222' })))
      .toEqual({ ok: false, reason: 'ambiguous_reference' })
  })

  it('⛔ a nonsense amount is refused rather than throwing', () => {
    // A webhook body is untrusted input; `BigInt(1.5)` throws.
    for (const amount of [1.5, NaN, Infinity]) {
      expect(() => matchesOrder(order, paid({ amount })), String(amount)).not.toThrow()
      expect(matchesOrder(order, paid({ amount })).ok, String(amount)).toBe(false)
    }
  })
})
