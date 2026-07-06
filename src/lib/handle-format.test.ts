import { describe, it, expect } from 'vitest'
import { slugifyHandle, validateHandle, HANDLE_RE } from './handle-format'

// @handle rules: "Alex Doe" → alex_doe (Telegram-style), one global namespace.
// Slugify must always yield a VALID base; validate must reject impersonation names.

describe('slugifyHandle', () => {
  it('turns display names into handles', () => {
    expect(slugifyHandle('Alex Doe')).toBe('alex_doe')
    expect(slugifyHandle('Apple Store')).toBe('apple_store')
    expect(slugifyHandle('SDC GIFT SHOP')).toBe('sdc_gift_shop')
  })

  it('folds Vietnamese diacritics', () => {
    expect(slugifyHandle('Nguyễn Văn Ánh')).toBe('nguyen_van_anh')
    expect(slugifyHandle('Cửa hàng Đồ cũ')).toBe('cua_hang_do_cu')
  })

  it('collapses punctuation runs and trims underscores', () => {
    expect(slugifyHandle("Anna's — Café & Bakery!")).toBe('anna_s_cafe_bakery')
    expect(slugifyHandle('__weird__name__')).toBe('weird_name')
  })

  it('always yields a valid handle, even from hostile names', () => {
    for (const name of ['84 Motors', '123', '🦄🦄', '', '   ', 'ồ', 'a'.repeat(80)]) {
      const s = slugifyHandle(name)
      expect(s, `from "${name}"`).toMatch(HANDLE_RE)
    }
  })

  it('caps at 30 chars', () => {
    expect(slugifyHandle('a'.repeat(80)).length).toBeLessThanOrEqual(30)
  })
})

describe('validateHandle', () => {
  it('accepts canonical handles', () => {
    expect(validateHandle('alex_doe')).toBeNull()
    expect(validateHandle('shop99')).toBeNull()
  })

  it('rejects bad shapes', () => {
    expect(validateHandle('ab')).toBe('invalid') // too short
    expect(validateHandle('9lives')).toBe('invalid') // digit start
    expect(validateHandle('Alex')).toBe('invalid') // uppercase (must be pre-lowercased)
    expect(validateHandle('a b')).toBe('invalid')
    expect(validateHandle('a'.repeat(31))).toBe('invalid')
  })

  it('rejects reserved / impersonation names', () => {
    for (const h of ['admin', 'eno', 'support', 'official', 'sellers', 'api', 'verified']) {
      expect(validateHandle(h), h).toBe('reserved')
    }
  })
})
