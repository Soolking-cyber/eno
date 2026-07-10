import { describe, it, expect } from 'vitest'
import { findBannedWord, containsContactInfo, assertPublishable, PublishBlockedError, type PublishBlockCode } from './publish-guard'

// publish-guard is the automated gate every new/edited listing passes. False NEGATIVES let
// illegal goods or off-platform contact through; false POSITIVES block legitimate sellers
// (a real listing says "hàng thật, không lừa đảo"; a phở shop is on a "phố"). Both directions
// are pinned here because both have bitten before.

// Capture the thrown block code (or null if it didn't throw).
function blockCodeOf(fn: () => void): PublishBlockCode | null {
  try { fn(); return null } catch (e) { return e instanceof PublishBlockedError ? e.code : ('OTHER' as PublishBlockCode) }
}

describe('findBannedWord — illegal content only', () => {
  it('flags illegal goods/services (accent- and case-insensitive)', () => {
    expect(findBannedWord('bán heroin giá rẻ')).toBeTruthy()
    expect(findBannedWord('MA TÚY giá tốt')).toBeTruthy()       // uppercase + accents
    expect(findBannedWord('ma tuy gia tot')).toBeTruthy()       // no accents
    expect(findBannedWord('cần bán vũ khí')).toBeTruthy()
    expect(findBannedWord('súng đạn còn mới')).toBeTruthy()
    expect(findBannedWord('giấy tờ giả làm nhanh')).toBeTruthy()
    expect(findBannedWord('escort service')).toBeTruthy()
  })

  it('does NOT flag innocent words that merely contain a banned substring (word boundary)', () => {
    expect(findBannedWord('Samsung Galaxy S24')).toBeNull()      // "sung" ⊄ match → not "súng đạn"
    expect(findBannedWord('heroine of the novel')).toBeNull()    // \bheroin\b ≠ "heroine"
    expect(findBannedWord('methodology textbook')).toBeNull()    // ≠ "meth"
  })

  it('does NOT flag trust/quality words — those are for the report system, not a word filter', () => {
    expect(findBannedWord('hàng thật, không lừa đảo')).toBeNull() // "no scam"
    expect(findBannedWord('no fake, authentic only')).toBeNull()
    expect(findBannedWord('iPhone 15, không phải hàng giả')).toBeNull()
  })

  it('returns null for empty/nullish input', () => {
    expect(findBannedWord('')).toBeNull()
    expect(findBannedWord(null)).toBeNull()
    expect(findBannedWord(undefined)).toBeNull()
  })
})

describe('containsContactInfo — off-platform bypass', () => {
  it('catches emails (plain and obfuscated)', () => {
    expect(containsContactInfo('reach me at john.doe@gmail.com')).toBe(true)
    expect(containsContactInfo('john at gmail dot com')).toBe(true)
    expect(containsContactInfo('shop (at) yahoo [dot] com')).toBe(true)
  })

  it('catches links, @handles, and social/messaging handles', () => {
    expect(containsContactInfo('see https://my-shop.com/deal')).toBe(true)
    expect(containsContactInfo('visit www.myshop.vn')).toBe(true)
    expect(containsContactInfo('check myshop.store today')).toBe(true)
    expect(containsContactInfo('dm me @my_handle now')).toBe(true)
    expect(containsContactInfo('zalo: 0901234567')).toBe(true)
    expect(containsContactInfo('telegram @myshop99')).toBe(true)
  })

  it('catches an unambiguous house number', () => {
    expect(containsContactInfo('đến số nhà 42 nhận hàng')).toBe(true)
  })

  it('does NOT false-positive on diacritic look-alikes or general areas', () => {
    expect(containsContactInfo('Phở ngon ở phố cổ Hà Nội')).toBe(false)     // phố/phở ≠ contact
    expect(containsContactInfo('Quận 1, gần chợ Bến Thành')).toBe(false)    // general area allowed
    expect(containsContactInfo('size 42, like new condition')).toBe(false)  // "42" ≠ house number
    expect(containsContactInfo('Like new iPhone, great deal')).toBe(false)
    expect(containsContactInfo('')).toBe(false)
  })
})

describe('assertPublishable — gate priority & happy path', () => {
  // 3 DISTINCT angles required. These URLs carry no embedded dHash (…-h<hex>.), so each counts
  // as a distinct angle (fail-open), which is what a clean 3-photo listing looks like to the gate.
  const ok = { trustTier: 'standard', images: ['a.webp', 'b.webp', 'c.webp'], texts: ['Like new iPhone 15, great condition'] }

  it('passes a clean listing from a non-restricted account with 3 photos', () => {
    expect(blockCodeOf(() => assertPublishable(ok))).toBeNull()
  })

  it('blocks a restricted account first — before any content/photo check', () => {
    expect(blockCodeOf(() => assertPublishable({ ...ok, trustTier: 'restricted', images: [] }))).toBe('account_restricted')
  })

  it('requires at least one photo (before content checks)', () => {
    expect(blockCodeOf(() => assertPublishable({ ...ok, images: [], texts: ['bán heroin'] }))).toBe('photo_required')
  })

  it('requires at least 3 photos (fewer → photos_min, before content checks)', () => {
    expect(blockCodeOf(() => assertPublishable({ ...ok, images: ['a.webp', 'b.webp'], texts: ['bán heroin'] }))).toBe('photos_min')
  })

  it('treats the SAME photo repeated as one angle (photos_min)', () => {
    // Identical embedded dHash → one cluster → 1 distinct angle → below the bar of 3.
    const dup = 'x-habcdef0123456789.webp'
    expect(blockCodeOf(() => assertPublishable({ ...ok, images: [dup, dup, dup] }))).toBe('photos_min')
  })

  it('blocks a phone number in text', () => {
    expect(blockCodeOf(() => assertPublishable({ ...ok, texts: ['gọi 0901234567'] }))).toBe('contact_in_text')
  })

  it('blocks off-platform contact in text', () => {
    expect(blockCodeOf(() => assertPublishable({ ...ok, texts: ['email me john@gmail.com'] }))).toBe('contact_in_text')
  })

  it('blocks banned words (when there is no phone/contact)', () => {
    expect(blockCodeOf(() => assertPublishable({ ...ok, texts: ['bán heroin giá rẻ'] }))).toBe('banned_words')
  })

  it('carries the detail tag so the UI can tell the user what to fix', () => {
    try { assertPublishable({ ...ok, texts: ['gọi 0901234567'] }) } catch (e) {
      expect((e as PublishBlockedError).detail).toBe('phone')
    }
  })
})
