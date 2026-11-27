import { describe, expect, it } from 'vitest'
import { keepCardsInPlace } from './feed-stable'

type Row = { id: string; isSponsored?: boolean; v?: number }
const r = (id: string, extra: Partial<Row> = {}): Row => ({ id, ...extra })
const ad = (id: string) => r(id, { isSponsored: true })
const ids = (rows: Row[]) => rows.map((x) => x.id).join(' ')

describe('keepCardsInPlace', () => {
  const seed = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => r(id))

  it('the live answer measured 2026-11-27: two paid rows (0, 3) and two new ones — unpaid cards keep their cells', () => {
    const fresh = [ad('ad1'), r('n1'), r('n2'), ad('ad2'), r('a'), r('b'), r('d'), r('e'), r('f')]
    const out = keepCardsInPlace(seed, fresh)
    // cells 0 and 3 are the ads'; c (dropped) gives its cell to the first new row; b, e, f keep theirs; the rest follow
    expect(ids(out)).toBe('ad1 b n1 ad2 e f n2 a d')
    expect(out.findIndex((x) => x.id === 'e')).toBe(4)
  })

  it('takes the answer\'s data for a card it keeps', () => {
    const out = keepCardsInPlace([r('a', { v: 1 }), r('b', { v: 1 })], [r('b', { v: 2 }), r('a', { v: 2 })])
    expect(ids(out)).toBe('a b')
    expect(out.map((x) => x.v)).toEqual([2, 2])
  })

  it('⛔ never keeps a card the answer dropped (a takedown or a licence hold looks the same as a sale): its cell is refilled', () => {
    const out = keepCardsInPlace(seed, [r('a'), r('c'), r('d'), r('e'), r('f'), r('g')])
    expect(out.map((x) => x.id)).not.toContain('b')
    expect(ids(out)).toBe('a g c d e f')
  })

  it('with nothing to refill it, the dropped card goes and the gap closes', () => {
    expect(ids(keepCardsInPlace(seed, [r('a'), r('c'), r('d'), r('e'), r('f')]))).toBe('a c d e f')
  })

  it('a listing on screen that the answer now pays for moves to its paid index and keeps its label', () => {
    const out = keepCardsInPlace(seed, [ad('d'), r('a'), r('b'), r('c'), r('e'), r('f'), r('d')])
    expect(out[0]).toEqual({ id: 'd', isSponsored: true })
    expect(ids(out)).toBe('d b c a e f')
  })

  it('an unpaid copy listed before the paid one never takes its place or its label', () => {
    const out = keepCardsInPlace([r('a'), r('b')], [r('z'), r('a'), ad('z')])
    expect(out.find((x) => x.id === 'z')).toEqual({ id: 'z', isSponsored: true })
  })

  it('a creative ad arriving as the first cell: the row in cell 0 moves down, cells 1… keep theirs', () => {
    expect(ids(keepCardsInPlace(seed, seed, { leadingSlot: true }))).toBe('b c d e f a')
  })

  it('a leading creative never pushes a paid row to the end', () => {
    const out = keepCardsInPlace(seed, [ad('x'), ...seed], { leadingSlot: true })
    expect(out[0].id).toBe('x')
    expect(ids(out)).toBe('x c d e f a b')
  })

  it('a paid row past the drawn rows joins the end; no id twice', () => {
    const out = keepCardsInPlace([r('a'), r('b')], [r('a'), r('b'), r('x'), ad('p')])
    expect(ids(out)).toBe('a b p x')
    expect(new Set(out.map((x) => x.id)).size).toBe(out.length)
  })

  it('the same answer as the seed changes nothing', () => {
    expect(ids(keepCardsInPlace(seed, seed))).toBe(ids(seed))
  })
})
