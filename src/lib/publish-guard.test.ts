import { describe, it, expect } from 'vitest'
import { fold } from './fold'
import { BANNED_ACCENTED, findBannedWordAccentAware, findBannedWord, assertCleanTexts, containsContactInfo, assertPublishable, assertCleanContactName, assertEnoughAngles, minPhotosFor, publicSafeName, PublishBlockedError, type PublishBlockCode } from './publish-guard'

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

  it('flags a pre-activated eSIM the way it flags a pre-activated SIM — and nothing a device or a carrier says', () => {
    expect(findBannedWord('Bán esim kích hoạt sẵn data khủng')).toBeTruthy()
    expect(findBannedWord('Pre-activated SIM for tourists')).toBeTruthy()
    expect(findBannedWord('preactivated eSIM, works on arrival')).toBeTruthy()
    // "Already activated" describes a DEVICE too — an honest used-watch post must publish.
    expect(findBannedWord('Apple Watch LTE, eSIM đã kích hoạt')).toBeNull()
    expect(findBannedWord('iPhone quốc tế, sim đã kích hoạt được')).toBeNull()
    // How a carrier listing talks about activation must stay publishable.
    expect(findBannedWord('Quét mã QR để cài eSIM và gọi 900 để kích hoạt')).toBeNull()
    expect(findBannedWord('Viettel eSIM — new prepaid number, activate by QR code')).toBeNull()
  })

  // Advertising-banned goods /prohibited already lists (2026-10-01): only names that mean nothing else.
  it('flags vapes, heated tobacco and prescription / veterinary prescription drugs by name', () => {
    for (const t of ['Pod vape Relx Infinity còn mới', 'Tinh dầu vape 30ml', 'Terea Amber 1 cây', 'E-liquid 60ml mango', 'Thuốc lá thế hệ mới IQOS',
      'Bravecto cho chó 10-20kg', 'NexGard Spectra 3 viên', 'Simparica Trio', 'Amoxicillin 500mg', 'Ozempic 1mg pen', 'Viagra 100mg']) {
      expect(findBannedWord(t), t).toBeTruthy()
    }
  })

  it('does NOT flag the context-dependent ad-banned categories — those are classified, not word-listed', () => {
    // A word list cannot tell these from the regulated product; src/lib/ad-banned.ts does, for imports.
    for (const t of ['Máy hâm bình sữa Fatz Baby', 'Hộp đựng núm ti giả', 'Ly Hennessy pha lê', 'Tủ rượu vang Kadeka 18 chai',
      'Tỉ giá USD hôm nay', 'Ti gia ngoai te', 'Sữa bột cho bé 2-6 tuổi', 'Bia Tiger thùng 24 lon', 'AirPods Pro 2', 'Anker PowerPort III Pod Lite 65W']) {
      expect(findBannedWord(t), t).toBeNull()
    }
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
  // Real HCMC coordinates: assertPublishable now also gates on location, so every fixture
  // that is testing a DIFFERENT gate has to carry a valid point or it trips this one first.
  const ok = { trustTier: 'standard', images: ['a.webp', 'b.webp', 'c.webp'], texts: ['Like new iPhone 15, great condition'], lat: 10.7769, lng: 106.7009 }

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
      lat: 10.7769, lng: 106.7009,
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
  const goods = { trustTier: 'standard', texts: ['Like new iPhone 15'] , lat: 10.7769, lng: 106.7009 }

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

  // Owner, 2026-10-01: the job post must be tailored to hiring. A job has nothing to photograph, so
  // its photo is OPTIONAL (a logo or the workplace) — and every surface renders a photo-less job.
  it('jobs publish with NO photo — minPhotosFor is the one source and says 0', () => {
    expect(minPhotosFor('jobs')).toBe(0)
    expect(() => assertEnoughAngles([], 'jobs')).not.toThrow()
    expect(blockCodeOf(() => assertPublishable({ ...goods, images: [], categorySlug: 'jobs' }))).toBeNull()
  })

  it('a job with photos is not held to a distinct-angle bar either', () => {
    const dup = 'x-habcdef0123456789.webp'
    expect(() => assertEnoughAngles([dup, dup], 'jobs')).not.toThrow()
    expect(() => assertEnoughAngles(one, 'jobs')).not.toThrow()
  })

  it('relaxing jobs relaxed NOTHING else — unknown/missing still 3, services still 1', () => {
    expect(minPhotosFor('not-a-real-category')).toBe(3)
    expect(minPhotosFor(undefined)).toBe(3)
    expect(minPhotosFor('services')).toBe(1)
    expect(blockCodeOf(() => assertPublishable({ ...goods, images: [] }))).toBe('photo_required')
  })

  it('a service may repeat the same photo — the angle rule is what got relaxed', () => {
    // Goods reject this (one distinct angle < 3); services only need one photo at all.
    const dup = 'x-habcdef0123456789.webp'
    expect(() => assertEnoughAngles([dup, dup], 'services')).not.toThrow()
    expect(blockCodeOf(() => assertPublishable({ ...goods, images: [dup, dup], categorySlug: 'electronics' }))).toBe('photos_min')
  })
})

describe('publish-guard · location is required', () => {
  const base = { trustTier: 'standard', images: ['a.webp', 'b.webp', 'c.webp'], texts: ['Like new iPhone 15'] }

  // THE REGRESSION THIS SUITE EXISTS FOR. lat/lng are an OPTIONAL precise pin; what a
  // seller actually picks is a ward. Gating on coordinates blocked every ordinary listing
  // and broke posting the day it shipped — "it asks to choose location" right after the
  // seller chose one.
  it('accepts a picked ward with NO coordinates — the ordinary path', () => {
    expect(blockCodeOf(() => assertPublishable({ ...base, district: 'Phường Bến Nghé' }))).toBeNull()
  })

  it('still rejects when neither a ward nor a point is given', () => {
    expect(blockCodeOf(() => assertPublishable({ ...base, district: '' }))).toBe('location_required')
    expect(blockCodeOf(() => assertPublishable({ ...base, district: '   ' }))).toBe('location_required')
  })

  it('accepts a real point', () => {
    expect(blockCodeOf(() => assertPublishable({ ...base, lat: 10.7769, lng: 106.7009 }))).toBeNull()
  })

  it('rejects a missing point', () => {
    expect(blockCodeOf(() => assertPublishable(base))).toBe('location_required')
    expect(blockCodeOf(() => assertPublishable({ ...base, lat: null, lng: null }))).toBe('location_required')
  })

  // The regression this gate exists for: eight live listings stored (0,0) and plotted in
  // the Atlantic while their district read "Hồ Chí Minh". A null check would pass all eight.
  it('rejects Null Island, which a `!= null` check would let through', () => {
    expect(blockCodeOf(() => assertPublishable({ ...base, lat: 0, lng: 0 }))).toBe('location_required')
  })

  it('rejects out-of-range and non-finite coordinates', () => {
    expect(blockCodeOf(() => assertPublishable({ ...base, lat: 91, lng: 106 }))).toBe('location_required')
    expect(blockCodeOf(() => assertPublishable({ ...base, lat: 10.7, lng: NaN }))).toBe('location_required')
  })

  // A real coordinate that happens to have one zero component is NOT Null Island.
  it('accepts a point on the equator or prime meridian', () => {
    expect(blockCodeOf(() => assertPublishable({ ...base, lat: 0, lng: 106.7 }))).toBeNull()
  })
})

// The import screen's reading of the same list (src/lib/import-screen.ts): a Vietnamese term counts
// only when the words carry ITS accents. Every collision below refused a live merchant row (2026-10-01).
describe('findBannedWordAccentAware — the folded list, read with the accents', () => {
  it('still flags the real thing, with accents, without them, and with old-style tone marks', () => {
    expect(findBannedWordAccentAware('Cần bán vũ khí tự chế')).toBe('vu khi')
    expect(findBannedWordAccentAware('MA TÚY giá tốt')).toBe('ma tuy')
    expect(findBannedWordAccentAware('ma tuý')).toBe('ma tuy') // "tuý" = "túy"
    expect(findBannedWordAccentAware('bán hoá đơn VAT giá rẻ')).toBe('hoa don vat') // "hoá" = "hóa"
    expect(findBannedWordAccentAware('ban sung dan gia re')).toBe('sung dan') // no accents typed at all
    expect(findBannedWordAccentAware('Juul pods')).toBe('juul') // English terms: exactly findBannedWord
    expect(findBannedWordAccentAware('Samsung Galaxy S24')).toBeNull()
  })

  it('does not flag a folding collision whose words carry OTHER accents', () => {
    for (const t of [
      'Điều hòa Casper thuộc phiên bản 2024', 'Ổ khóa mật mã tùy thích', 'Laptop HP hiệu năng cao hỗ trợ đa nhiệm',
      'Áo polo xanh cô ban đậm',
    ]) {
      expect(findBannedWord(t), t).not.toBeNull() // the folded list does trip…
      expect(findBannedWordAccentAware(t), t).toBeNull() // …the accented reading does not
    }
  })

  // ⛔ Per WORD, not per text (2026-10-01, review): an unaccented banned term inside an accented title
  // is how an evasion looks, so an unaccented word is always read folded.
  it('flags an UNACCENTED banned term inside an otherwise accented title', () => {
    expect(findBannedWordAccentAware('Cần bán sung dan')).toBe('sung dan')
    expect(findBannedWordAccentAware('Cần bán Ma tuy giá rẻ')).toBe('ma tuy')
    expect(findBannedWordAccentAware('Thanh lý vu khi cũ')).toBe('vu khi')
    // Mixed within the term: the accented word must carry the term's accent, the bare one matches folded.
    expect(findBannedWordAccentAware('Bán vu khí')).toBe('vu khi')
    expect(findBannedWordAccentAware('Bán súng dan')).toBe('sung dan')
    expect(findBannedWordAccentAware('Bán sừng dan')).toBeNull() // "sừng" (horn) is not "súng" (gun)
  })

  it('⚠️ the accepted price: an honestly unaccented phrase that folds onto a term is refused (to review, never live)', () => {
    // "vi vu khi" has no accents in correct Vietnamese. Measured 2026-10-01: 1 of 111,007 live imported
    // rows (a Babolat dampener, "tiếng kêu vi vu khi vung vợt").
    expect(findBannedWordAccentAware('Balo du lịch vi vu khi đi phượt')).toBe('vu khi')
  })

  it('BANNED_ACCENTED stays in step with the list: every key is a banned term, every spelling folds to it', () => {
    for (const [key, spellings] of Object.entries(BANNED_ACCENTED)) {
      expect(findBannedWord(key), key).toBe(key)
      for (const sp of spellings) expect(fold(sp), sp).toBe(key)
      // …and every spelling is flagged by the accented reading (a spelling the matcher could not read as
      // Vietnamese would silently stop matching itself).
      for (const sp of spellings) expect(findBannedWordAccentAware(sp), sp).toBe(key)
    }
  })

  // ⛔ STACKED / STRAY COMBINING MARKS (2026-10-01, review). NFC cannot compose a precomposed vowel with a
  // SECOND mark, so "tú́y" is ú + U+0301 and "tụ́y" is ụ + U+0301. Splitting words on non-letters cut them
  // in two, the folded hit matched no run of words, and the import screen answered null where the folded
  // screen said 'ma tuy'. A mark belongs to its letter; a doubled mark is the same mark; and a word no
  // Vietnamese spelling produces (two tones, a foreign mark, a mark on nothing) cannot prove itself a
  // different word, so it is read on its folded letters.
  it('flags a banned term written with stacked or stray combining marks, exactly as findBannedWord does', () => {
    for (const t of [
      'Bán ma tú\u0301y',              // ú + a second acute: "túy", the mark doubled
      'Cần bán ma tụ\u0301y giá rẻ',   // ụ + an acute: two tone marks on one syllable
      'Bán ma tüy',                    // a mark Vietnamese never writes
      'Bán ma \u0301túy',              // a mark with no letter under it
      'Cần bán vũ\u0303 khí',          // ũ + a second tilde
    ]) {
      expect(findBannedWord(t), t).not.toBeNull()
      expect(findBannedWordAccentAware(t), t).toBe(findBannedWord(t))
    }
  })

  it('fails CLOSED when the folded hit cannot be located in the words (the two readings disagree)', () => {
    // fold() sees a word boundary before "ma" (π is not an ASCII word character); the word split does not.
    const t = 'Bán πma túy'
    expect(findBannedWord(t)).toBe('ma tuy')
    expect(findBannedWordAccentAware(t)).toBe('ma tuy')
  })

  it('the stricter reading of marks does not cost the real collisions: a properly accented OTHER word still clears', () => {
    for (const t of [
      'Ổ khóa mật mã tùy thích',
      'Bán ma tù\u0300y', // "tùy" with its grave doubled is still "tùy" (deduped), not "túy" and not unreadable
      'Điều hòa Casper thuộc phiên bản 2024', 'Áo polo xanh cô ban đậm', 'Bán sừng dan',
    ]) {
      expect(findBannedWordAccentAware(t), t).toBeNull()
    }
  })
})

// ⛔ A SELLER'S OWN POST IS NOT READ WITH ACCENTS — the accent-aware relaxation is for imports only
// (src/lib/import-screen.ts). assertCleanTexts — the user-post screen behind createListingCore,
// updateListingCore, teachers/publish and the linked-job/nhatot importers — keeps the FOLDED match it
// had before the import screen existed: every collision the import screen lets through is still
// refused here, exactly as at HEAD (fbd817e4).
describe('user posts keep the folded banned-word screen', () => {
  const blocked = (t: string) => { try { assertCleanTexts([t]); return null } catch (e) { return e instanceof PublishBlockedError ? e.code : 'threw' } }
  it.each([
    'Cần bán súng đạn', 'Cần bán sung dan', 'ban sung dan gia re', 'Áo polo xanh cô ban đậm', 'Balo du lịch vi vu khi đi phượt',
    'Điều hòa Casper thuộc phiên bản 2024', 'Ổ khóa mật mã tùy thích', 'Laptop HP hiệu năng cao hỗ trợ đa nhiệm',
  ])('%s → banned_words', (t) => expect(blocked(t)).toBe('banned_words'))
})
