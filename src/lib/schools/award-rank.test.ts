import { describe, expect, it } from 'vitest'
import { awardWindow, currentAwardYear, placesOf, qualifies, rankCategory } from './award-rank'

describe('award window', () => {
  it('is Saigon’s calendar year', () => {
    const { start, end } = awardWindow(2026)
    expect(start.toISOString()).toBe('2025-12-31T17:00:00.000Z')
    expect(end.toISOString()).toBe('2026-12-31T17:00:00.000Z')
  })
  it('the open year turns at midnight in Saigon, not in UTC', () => {
    expect(currentAwardYear(new Date('2026-12-31T16:59:59Z'))).toBe(2026)
    expect(currentAwardYear(new Date('2026-12-31T17:00:00Z'))).toBe(2027)
  })
})

describe('ranking a category', () => {
  const t = (name: string, up: number, down: number, reviews = 3) => ({ schoolId: name, name, up, down, reviews })
  it('qualifies with 10 voters and 3 reviews, not fewer', () => {
    expect(qualifies(t('a', 10, 0))).toBe(true)
    expect(qualifies(t('a', 9, 0))).toBe(false)
    expect(qualifies(t('a', 6, 4, 2))).toBe(false)
  })
  it('never names a place most of its voters do not recommend, however few rivals it has', () => {
    expect(qualifies(t('a', 2, 9))).toBe(false)
    expect(qualifies(t('a', 5, 5))).toBe(false) // a tie is not a recommendation
    expect(qualifies(t('a', 6, 5))).toBe(true)
    expect(rankCategory([t('Disliked', 2, 9), t('Split', 20, 30)])).toEqual([])
  })
  it('ranks by the Wilson lower bound, so many votes beat a few perfect ones', () => {
    const r = rankCategory([t('Few', 10, 0), t('Many', 90, 10), t('Unqualified', 5, 0)])
    expect(r.map((x) => x.name)).toEqual(['Many', 'Few'])
    expect(r[0].score).toBeGreaterThan(r[1].score)
    for (const x of r) expect(x.score).toBeGreaterThanOrEqual(0)
  })
  it('ties: more voters, then the name', () => {
    expect(rankCategory([t('B', 10, 0), t('A', 10, 0)]).map((x) => x.name)).toEqual(['A', 'B'])
  })
  it('awards three places at most', () => {
    const places = placesOf(rankCategory([t('A', 50, 0), t('B', 40, 0), t('C', 30, 0), t('D', 20, 0)]))
    expect(places.map((p) => [p.name, p.rank])).toEqual([['A', 1], ['B', 2], ['C', 3]])
  })
})
