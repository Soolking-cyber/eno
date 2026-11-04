import { describe, expect, it } from 'vitest'
import { collapseRepeatedName, collapseRepeatedNames } from './location-text'

describe('collapseRepeatedName', () => {
  it('folds a bracket that repeats the name', () => {
    expect(collapseRepeatedName('The House of Bee (The House of Bee)')).toBe('The House of Bee')
    expect(collapseRepeatedName('vinhomes (Vinhomes) ')).toBe('vinhomes')
  })
  it('keeps a bracket that adds something', () => {
    expect(collapseRepeatedName('District 1 (Quận 1)')).toBe('District 1 (Quận 1)')
    expect(collapseRepeatedName('Quận 1, Hồ Chí Minh')).toBe('Quận 1, Hồ Chí Minh')
    expect(collapseRepeatedName('')).toBe('')
  })
  it('folds translations too, and passes an absent map through', () => {
    expect(collapseRepeatedNames({ ko: '꿀벌의 집 (꿀벌의 집)', ja: 'A (B)' })).toEqual({ ko: '꿀벌의 집', ja: 'A (B)' })
    expect(collapseRepeatedNames(null)).toBeNull()
    expect(collapseRepeatedNames(undefined)).toBeUndefined()
  })
})
