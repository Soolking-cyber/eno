import { describe, it, expect } from 'vitest'
import { findBannedWord, containsContactInfo, assertPublishable, assertCleanContactName, assertEnoughAngles, minPhotosFor, publicSafeName, PublishBlockedError, type PublishBlockCode } from './publish-guard'

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

  // The English preposition "at" before a LITERAL-dot official domain is prose, not an
  // email — e-visa/service listings kept getting blocked (user report 2026-07-21).
  // Genuine obfuscation spells BOTH parts ("shop at gmail dot com") and still blocks.
  it('does NOT read prose "at <site>.gov/.vn" as an obfuscated email', () => {
    expect(containsContactInfo('Submit your application at evisa.gov.vn')).toBe(false)
    expect(containsContactInfo('Documents are processed at immigration.gov')).toBe(false)
    expect(containsContactInfo('Apply at the official portal before 10:00 AM')).toBe(false)
    // still catches real obfuscation + real domains/emails:
    expect(containsContactInfo('shop at gmail dot com')).toBe(true)       // spelled at + spelled dot
    expect(containsContactInfo('order at myshop.com')).toBe(true)         // real .com domain (LINK)
    expect(containsContactInfo('mail me at john@company.vn')).toBe(true)  // real email
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

// ── The seller's own CONTACT NAME ──────────────────────────────────────────────────
// Regression suite for a reported dead end: an account whose displayName was its raw
// email ("leagues1111@gmail.com") could not publish ANY listing. The wizard concatenated
// title + description + contactName into one blob, so the email tripped the contact rule
// and the seller was told to remove contact details from a LISTING whose title and
// description were completely clean — and the offending text wasn't editable from that
// screen. Root cause: PATCH /api/profile screened displayName for a PHONE but not for an
// EMAIL, while the publish gate rejected both.
describe('publish-guard · seller contact name', () => {
  it('reports an email in the contact name as contact_in_name, NOT contact_in_text', () => {
    // The distinct code is the whole point: it routes the message to Settings instead of
    // telling the seller to edit a listing that has nothing wrong with it.
    expect(blockCodeOf(() => assertCleanContactName('leagues1111@gmail.com'))).toBe('contact_in_name')
  })

  it('reports a phone in the contact name as contact_in_name', () => {
    expect(blockCodeOf(() => assertCleanContactName('0901234567'))).toBe('contact_in_name')
  })

  it('lets ordinary names through', () => {
    for (const name of ['Nguyễn Văn A', 'Saigon Visa Services', 'Minh', 'Anh Tuấn Motorbikes']) {
      expect(() => assertCleanContactName(name)).not.toThrow()
    }
  })

  it('publicSafeName masks a name that IS contact info, so a legacy account can still post', () => {
    expect(publicSafeName('leagues1111@gmail.com')).toBe('le***')
    expect(publicSafeName('0906104247')).toBe('09***')
  })

  it('publicSafeName leaves a real name untouched', () => {
    expect(publicSafeName('Nguyễn Văn A')).toBe('Nguyễn Văn A')
    expect(publicSafeName('Saigon Visa Services')).toBe('Saigon Visa Services')
  })

  it('a masked name passes the gate — the repair actually unblocks publishing', () => {
    expect(() => assertCleanContactName(publicSafeName('leagues1111@gmail.com'))).not.toThrow()
  })

  it('the reported listing text was never the problem', () => {
    // Exactly the title/description from the report: clean under every rule.
    const title = 'Vietnam Single Entry E-Visa - 1 Business Day'
    expect(containsContactInfo(title)).toBe(false)
    expect(() => assertPublishable({
      trustTier: 'standard',
      images: ['a.webp', 'b.webp', 'c.webp'],
      texts: [title, 'Official assistance. Secure application. Expert support.'],
    })).not.toThrow()
  })
})

// ── Photo minimum is per-CATEGORY ──────────────────────────────────────────────────
// Owner, 2026-07-21: "services category can have 1 image not 3, multiple is optional;
// products 3 enforced but services 1 is ok". The 3-angle rule is about letting a buyer
// inspect a physical object; a visa service or a language lesson has nothing to shoot
// from three sides, so the rule could only be met by padding with duplicates.
describe('publish-guard · photo minimum by category', () => {
  const one = ['a.webp']
  const goods = { trustTier: 'standard', texts: ['Like new iPhone 15'] }

  it('services publish with a single photo', () => {
    expect(minPhotosFor('services')).toBe(1)
    expect(() => assertEnoughAngles(one, 'services')).not.toThrow()
    expect(blockCodeOf(() => assertPublishable({ ...goods, images: one, categorySlug: 'services' }))).toBeNull()
  })

  it('physical categories still need 3 DISTINCT angles', () => {
    for (const slug of ['electronics', 'vehicles', 'property', 'fashion', 'rentals']) {
      expect(minPhotosFor(slug)).toBe(3)
      expect(blockCodeOf(() => assertPublishable({ ...goods, images: one, categorySlug: slug }))).toBe('photos_min')
    }
  })

  it('an unknown or missing category keeps the STRICT bar — relaxing must be opt-in', () => {
    expect(minPhotosFor(undefined)).toBe(3)
    expect(minPhotosFor(null)).toBe(3)
    expect(minPhotosFor('not-a-real-category')).toBe(3)
    expect(blockCodeOf(() => assertPublishable({ ...goods, images: one }))).toBe('photos_min')
  })

  it('services still need at least ONE photo', () => {
    expect(blockCodeOf(() => assertPublishable({ ...goods, images: [], categorySlug: 'services' }))).toBe('photo_required')
  })

  it('extra photos remain allowed for services (the minimum is a floor, not a cap)', () => {
    expect(() => assertEnoughAngles(['a.webp', 'b.webp', 'c.webp', 'd.webp'], 'services')).not.toThrow()
  })

  it('a service may repeat the same photo — the angle rule is what got relaxed', () => {
    // Goods reject this (one distinct angle < 3); services only need one photo at all.
    const dup = 'x-habcdef0123456789.webp'
    expect(() => assertEnoughAngles([dup, dup], 'services')).not.toThrow()
    expect(blockCodeOf(() => assertPublishable({ ...goods, images: [dup, dup], categorySlug: 'electronics' }))).toBe('photos_min')
  })
})
