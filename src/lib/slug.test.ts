import { describe, it, expect } from 'vitest'
import { slugify } from './slug'

// slugify underpins the SEO /c/[category]/[district] match and brand slugs.
describe('slugify', () => {
  it('lowercases and dashes spaces', () => {
    expect(slugify('District 1')).toBe('district-1')
  })

  it('strips Vietnamese diacritics and maps đ → d', () => {
    expect(slugify('Thảo Điền')).toBe('thao-dien')
    expect(slugify('Quận 7')).toBe('quan-7')
    expect(slugify('Đà Nẵng')).toBe('da-nang')
  })

  it('collapses punctuation and trims edge dashes', () => {
    expect(slugify('  Hello, World!  ')).toBe('hello-world')
  })
})
