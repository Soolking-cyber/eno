import { describe, expect, it } from 'vitest'
import { acceptLanguageOrder, langVariantFor, matchSupportedLanguage, variantOfLanguage } from './lang-variant'

describe('langVariantFor', () => {
  it('serves Vietnamese to a Vietnamese browser with no cookie', () => {
    expect(langVariantFor(null, 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7')).toBe('vi')
    expect(langVariantFor(undefined, 'vi')).toBe('vi')
  })

  it('serves English to English, empty and unsupported browsers', () => {
    expect(langVariantFor(null, 'en-US,en;q=0.9')).toBe('en')
    expect(langVariantFor(null, null)).toBe('en')
    expect(langVariantFor(null, '')).toBe('en')
    expect(langVariantFor(null, 'de-DE,pt;q=0.5')).toBe('en')
  })

  it('picks the FIRST SUPPORTED language, like the client — not the first Vietnamese one', () => {
    // A Chinese reader who lists Vietnamese second sees Chinese on the client → English HTML here.
    expect(langVariantFor(null, 'zh-CN,vi;q=0.5')).toBe('en')
    // An unsupported first choice is skipped, so Vietnamese second wins.
    expect(langVariantFor(null, 'de-DE,vi;q=0.5,en;q=0.3')).toBe('vi')
  })

  it('orders by q-value, not header position', () => {
    expect(langVariantFor(null, 'en;q=0.4,vi;q=0.9')).toBe('vi')
    expect(langVariantFor(null, 'vi;q=0,en')).toBe('en') // q=0 means not acceptable
  })

  it('lets the cookie win in both directions', () => {
    expect(langVariantFor('en', 'vi-VN')).toBe('en')
    expect(langVariantFor('vi', 'en-US')).toBe('vi')
    // a machine-translated language is served the English variant and swapped client-side
    expect(langVariantFor('ko', 'vi-VN')).toBe('en')
    expect(langVariantFor('zh-Hans', 'vi-VN')).toBe('en')
  })

  it('ignores a garbage cookie instead of pinning English', () => {
    expect(langVariantFor('xx', 'vi-VN')).toBe('vi')
    expect(langVariantFor('', 'vi-VN')).toBe('vi')
  })
})

describe('helpers', () => {
  it('parses Accept-Language with stable ties', () => {
    expect(acceptLanguageOrder('fr;q=0.8, vi, en;q=0.8, *;q=0.1')).toEqual(['vi', 'fr', 'en'])
  })

  it('maps tags like the client', () => {
    expect(matchSupportedLanguage('zh-TW')).toBe('zh-Hans')
    expect(matchSupportedLanguage('VI-vn')).toBe('vi')
    expect(matchSupportedLanguage('de')).toBe(null)
  })

  it('maps client languages to server variants', () => {
    expect(variantOfLanguage('vi')).toBe('vi')
    expect(variantOfLanguage('en')).toBe('en')
    expect(variantOfLanguage('ja')).toBe('en')
  })
})
