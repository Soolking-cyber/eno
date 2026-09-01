import { describe, it, expect } from 'vitest'
import { formatTokenAmount } from './token-amount'

describe('formatTokenAmount', () => {
  it('renders the ordinary USDC case', () => {
    expect(formatTokenAmount('10000000', 6)).toBe('10')
    expect(formatTokenAmount('12345678', 6)).toBe('12.345678')
  })

  // ⛔ THE TRAP THE FILE EXISTS FOR. Number('123456789012345678901') / 1e6 is 123456789012345.69
  // and formats in scientific notation past 1e21 — both wrong, neither throws.
  it('is exact past 2^53, where Number silently is not', () => {
    expect(formatTokenAmount('123456789012345678901', 6)).toBe('123456789012345.678901')
    expect(formatTokenAmount('1000000000000000000000000000', 6)).toBe('1000000000000000000000')
  })

  it('left-pads a balance smaller than one whole unit', () => {
    expect(formatTokenAmount('1', 6)).toBe('0.000001')
    expect(formatTokenAmount('999', 6)).toBe('0.000999')
  })

  // ⛔ codex named this: the general path would emit "5." for a token with no fractional part.
  it('handles a zero-decimal token without a trailing dot', () => {
    expect(formatTokenAmount('5', 0)).toBe('5')
    expect(formatTokenAmount('0', 0)).toBe('0')
  })

  it('trims trailing fractional zeros but keeps significant ones', () => {
    expect(formatTokenAmount('1500000', 6)).toBe('1.5')
    expect(formatTokenAmount('1000001', 6)).toBe('1.000001')
  })

  it('renders zero as 0, never -0 or 0.000000', () => {
    expect(formatTokenAmount('0', 6)).toBe('0')
    expect(formatTokenAmount('-0', 6)).toBe('0')
  })

  // ⛔ THE CASE THE TEST ABOVE MISSED. It only ever asked at 6 decimals, where the general path
  // normalises the sign; the `decimals === 0` early return jumped past that guard entirely. Both
  // reviewers found it in the finished diff.
  it('renders a zero-decimal negative zero as 0, not -0', () => {
    expect(formatTokenAmount('-0', 0)).toBe('0')
    expect(formatTokenAmount('-000', 0)).toBe('0')
    expect(formatTokenAmount('-5', 0)).toBe('-5')
  })

  it('keeps a real negative', () => {
    expect(formatTokenAmount('-1500000', 6)).toBe('-1.5')
  })

  /**
   * ⛔ REFUSES RATHER THAN GUESSING. BigInt() would accept '0x10' as 16 and '' as 0n, so each of
   * these would otherwise render a confident wrong balance instead of an honest failure.
   */
  it('refuses anything that is not a plain integer string', () => {
    for (const bad of ['', '  ', '0x10', '1e6', '1.5', '+5', 'abc', '1,000']) {
      expect(formatTokenAmount(bad, 6)).toBeNull()
    }
  })

  it('refuses a decimals value that is not a sane token scale', () => {
    for (const d of [-1, 1.5, 37, NaN, Infinity]) {
      expect(formatTokenAmount('1000000', d)).toBeNull()
    }
  })

  it('tolerates surrounding whitespace from a provider payload', () => {
    expect(formatTokenAmount(' 10000000 ', 6)).toBe('10')
  })
})
