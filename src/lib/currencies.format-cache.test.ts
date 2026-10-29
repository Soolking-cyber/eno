import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** formatMoney keeps one Intl.NumberFormat per currency (a new one per card render was a top JS cost on the feed). */
const Real = Intl.NumberFormat
/** Attempts to build a CURRENCY formatter (formatMoney's — VND's own formatting builds others), counted BEFORE Intl runs,
 *  so a currency Intl refuses still counts. A Proxy, so both `new Intl.NumberFormat()` and a bare call keep working. */
let built = 0
const isCurrency = (args: unknown[]) => (args[1] as { style?: string } | undefined)?.style === 'currency'
const Counting = new Proxy(Real, {
  construct(target, args, newTarget) { if (isCurrency(args)) built += 1; return Reflect.construct(target, args, newTarget) },
  apply(target, self, args) { if (isCurrency(args)) built += 1; return Reflect.apply(target, self, args) },
})

describe('formatMoney — one formatter per currency', () => {
  beforeEach(() => {
    built = 0
    Object.defineProperty(Intl, 'NumberFormat', { value: Counting, configurable: true, writable: true })
  })
  afterEach(() => {
    Object.defineProperty(Intl, 'NumberFormat', { value: Real, configurable: true, writable: true })
    vi.resetModules()
  })

  it('the same words as before, and the formatter is built once per currency, however many prices', async () => {
    const { formatMoney } = await import('./currencies')
    const rates = { USD: 1 / 25_000, EUR: 1 / 27_000 }
    for (let i = 0; i < 50; i++) formatMoney(2_500_000 + i, 'USD', rates)
    expect(formatMoney(2_500_000, 'USD', rates)).toBe('$100')
    expect(formatMoney(2_700_000, 'EUR', rates)).toBe('€100')
    expect(built).toBe(2)
  })

  it('a currency Intl refuses still falls back to VND, and is never kept (asked again next time)', async () => {
    const { formatMoney } = await import('./currencies')
    const rates = { 'NOT A CODE': 1 }
    expect(formatMoney(10_000, 'NOT A CODE', rates)).toMatch(/₫|đ/)
    expect(formatMoney(10_000, 'NOT A CODE', rates)).toMatch(/₫|đ/)
    expect(built).toBe(2) // asked of Intl both times: a refusal is never kept
  })
})
