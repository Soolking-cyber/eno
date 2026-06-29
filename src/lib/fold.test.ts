import { describe, it, expect } from 'vitest'
import { fold, buildSearchText } from './fold'

// fold powers accent-insensitive, cross-language search ("Quận 1" matches "quan 1").
describe('fold', () => {
  it('lowercases, strips diacritics, maps đ → d, keeps word boundaries', () => {
    expect(fold('Quận 1')).toBe('quan 1')
    expect(fold('Căn hộ')).toBe('can ho')
    expect(fold('Đà Nẵng')).toBe('da nang')
  })

  it('collapses internal whitespace and trims', () => {
    expect(fold('  Honda   Wave  ')).toBe('honda wave')
  })
})

describe('buildSearchText', () => {
  it('drops null/undefined parts then folds the join', () => {
    expect(buildSearchText(['iPhone', null, 'Quận 3', undefined])).toBe('iphone quan 3')
  })
})
