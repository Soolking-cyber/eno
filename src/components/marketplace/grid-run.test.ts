import { describe, expect, it } from 'vitest'
import { rowsContinue } from './grid-run'

const rows = (...ids: string[]) => ids.map((id) => ({ id }))

describe('rowsContinue', () => {
  it('an appended page continues, and so do the same rows again', () => {
    expect(rowsContinue(rows('a', 'b'), rows('a', 'b', 'c'))).toBe(true)
    expect(rowsContinue(rows('a', 'b'), rows('a', 'b'))).toBe(true)
    expect(rowsContinue([], rows('a'))).toBe(true)
  })
  it('a listing in both answers at another place does not: it would slide across the page as a layout shift', () => {
    expect(rowsContinue(rows('a', 'b', 'c'), rows('c', 'a'))).toBe(false)
    expect(rowsContinue(rows('a', 'b'), rows('b', 'a', 'c'))).toBe(false)
  })
  it('fewer rows do not', () => {
    expect(rowsContinue(rows('a', 'b'), rows('a'))).toBe(false)
  })
})
