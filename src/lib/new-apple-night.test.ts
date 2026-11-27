import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
import { retireCap, verdictFor } from './new-apple-night'

const row = (status: 'active' | 'sold', price = 40_990_000, model = 'iPhone 18 Pro Max') => ({ status, price, model })

describe('verdictFor — one row, one page read', () => {
  it('sold only on positive evidence, and only an active row', () => {
    expect(verdictFor(row('active'), { kind: 'out', name: null })).toEqual({ act: 'retire' })
    expect(verdictFor(row('active'), { kind: 'gone', status: 404 })).toEqual({ act: 'retire' })
    expect(verdictFor(row('sold'), { kind: 'out', name: null })).toEqual({ act: 'none' })
  })
  it('unknown leaves the row alone', () => {
    expect(verdictFor(row('active'), { kind: 'unknown', why: 'HTTP 503' })).toEqual({ act: 'unknown', why: 'HTTP 503' })
  })
  it('in stock: price moves, sold comes back', () => {
    const page = (price: number) => ({ kind: 'in' as const, price, name: 'iPhone 18 Pro Max 256GB', images: [] })
    expect(verdictFor(row('active'), page(40_990_000))).toEqual({ act: 'none' })
    expect(verdictFor(row('active'), page(39_990_000))).toEqual({ act: 'price', to: 39_990_000, restore: false })
    expect(verdictFor(row('sold'), page(40_990_000))).toEqual({ act: 'restore' })
    expect(verdictFor(row('sold'), page(39_990_000))).toEqual({ act: 'price', to: 39_990_000, restore: true })
  })
  it('an implausible price is unknown, never written', () => {
    const page = (price: number) => ({ kind: 'in' as const, price, name: 'iPhone 18 Pro Max 256GB', images: [] })
    expect(verdictFor(row('active'), page(450_000)).act).toBe('unknown')
    expect(verdictFor(row('active', 40_990_000), page(79_990_000)).act).toBe('unknown')
    expect(verdictFor(row('active', 40_990_000, 'iPhone 17'), page(40_990_000)).act).toBe('unknown')
  })
})

describe('retireCap', () => {
  it('a third of the live rows, at least three', () => {
    expect(retireCap(0)).toBe(3)
    expect(retireCap(9)).toBe(3)
    expect(retireCap(36)).toBe(12)
  })
})
