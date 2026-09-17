import { brandSlugify } from './brand-normalize'

/**
 * TITLE → TAXONOMY, for any imported product feed.
 *
 * ⛔ EXTRACTED FROM `scripts/import-accesstrade.ts` FOR THE REASON THAT FILE ALREADY RECORDS ABOUT
 * ITS OWN SIBLING. `modelFor` used to live inline there too, and its note says why it left: "this
 * file imports ../src/lib/db at module scope, so nothing in it can be unit-tested; the rule sat
 * here and invented a product ('Apple Watch Ultra 4', from the 49 in '49mm') across 6 live
 * listings before anyone could write a test for it. It now has 17." These three rules had the same
 * shape and the same exposure — pure string matching, no I/O, deciding what a shopper sees — and
 * now the same remedy. Nothing about their behaviour changed in the move; the AccessTrade dry run
 * reports byte-identical counts before and after.
 *
 * ⚠️ A SECOND IMPORTER IS WHY THIS HAPPENED NOW. The partner-shop catalogues need exactly this
 * mapping, and a copy-paste would have been two divergent answers to "is a fridge a wardrobe?" —
 * which is a mis-filing this file's own comments describe having already made once.
 */

/**
 * ⛔ `\b` IS ASCII-ONLY IN JAVASCRIPT REGEX, AND IT FAILS SILENTLY ON HALF OF VIETNAMESE. Measured:
 * `/\btủ\b/i.test('Tủ quần áo')` is **false**, because `ủ` is not a `\w` character so the trailing
 * boundary never matches. But `/\bbàn\b/i.test('Bàn làm việc')` is **true**, because `bàn` happens
 * to end in an ASCII `n`. That partial success is what makes it dangerous: `bàn` and `chuột` work,
 * `tủ`, `kệ` and `ghế` do not, so a rule set reads as correct and quietly files every wardrobe and
 * every shelf as uncategorised. The unit test caught it on the first run.
 *
 * `w()` builds the Unicode-aware equivalent — a letter boundary expressed with `\p{L}` lookarounds,
 * which needs the `u` flag. Use it for every Vietnamese term; a bare `\b` here is a bug.
 */
const w = (...words: string[]) => new RegExp(`(?<!\\p{L})(?:${words.join('|')})(?!\\p{L})`, 'iu')

/**
 * Feed category → our taxonomy.
 * ⚠️ DERIVED FROM THE TITLE, because `cate` is EMPTY on 93% of rows (measured on 1,000 CellphoneS
 * products: 934 blank, 66 "camera"). Keyword order matters — "đồng hồ" before "phụ kiện" so a
 * watch is not filed as an accessory.
 */
const RULES: [RegExp, string][] = [
  /**
   * ⛔ BOOKS FIRST, AND ONLY WHEN THE TITLE SAYS SO UP FRONT (2026-09-13). Tiki's feed is half books and
   * every one of them fell through to the `electronics` default — measured: ~23,100 of 48,775 unfiled
   * electronics rows. First, because a book title is ordinary Vietnamese prose and the furniture rule
   * below claims any standalone `bàn` ("Sách Bàn Về Tự Do" is a book about liberty, not a table).
   * ⚠️ ANCHORED AT THE START for `sách`/`truyện`, so "Kệ sách" and "Giá sách" (bookshelves) stay furniture.
   */
  [new RegExp(`^(?:combo\\s+(?:\\d+\\s+)?(?:cuốn\\s+)?)?(?:sách|bộ sách|truyện tranh|truyện|tiểu thuyết|từ điển)(?!\\p{L})|(?<!\\p{L})tái bản(?!\\p{L})|nhà xuất bản|(?<!\\p{L})nxb(?!\\p{L})`, 'iu'), 'books-stationery'],
  // ⚠️ No `bìa cứng` (a carton box is "hộp carton bìa cứng") and no `giấy a4` ("Máy in giấy A4" is a printer).
  [w('văn phòng phẩm', 'bút bi', 'bút gel', 'sổ tay', 'sổ lò xo', 'bìa hồ sơ'), 'books-stationery'],
  /**
   * ⛔ THE KEYBOARD-VERSUS-DESK TRAP, AND IT MUST BE TESTED FIRST. "bàn phím" is a KEYBOARD and
   * "bàn" is a TABLE, so a naive `bàn` rule files every keyboard as furniture. Same shape as the
   * `tủ lạnh`/`tủ` fridge-versus-wardrobe bug the subcategory rules already carry a warning about.
   */
  /**
   * ⛔ "để bàn" MEANS DESKTOP/TABLETOP, NOT A TABLE. "Máy tính để bàn" is a desktop COMPUTER and
   * "Loa Bluetooth để bàn" is a desk SPEAKER; both contain a standalone "bàn" and both were filed
   * as furniture/tables-desks. Measured on the staged catalogue before this line existed.
   * `bàn phím` (keyboard) and `bàn là` (iron) are the same trap in different clothes.
   */
  // ⚠️ `bàn là` (clothes iron) NEEDS THE BOUNDARY — as a bare substring it matches inside
  // "bàn LÀm việc" (work desk) and files every office desk as electronics. Caught by the probe
  // immediately after fixing the spec-token ordering; one trap replaced another.
  [new RegExp(`bàn phím|bàn di chuột|để bàn|mouse pad|keyboard|(?<!\\p{L})bàn là(?!\\p{L})`, 'iu'), 'electronics'],
  [/tủ lạnh|máy giặt|điều hòa|máy lạnh|lò vi sóng|nồi chiên|máy hút bụi|quạt |bếp /i, 'furniture-appliances'],
  /**
   * ⛔ FURNITURE WAS ENTIRELY ABSENT AND 3,343 PRODUCTS PAID FOR IT. These rules were written for a
   * phone retailer, so every desk, wardrobe and sofa in a furniture-liquidation catalogue fell
   * through to the `electronics` default — measured across 6,160 staged products: 97% landed in
   * electronics and 83% got no subcategory at all. A buyer looking for a second-hand office desk
   * would have found it filed under Electronics with no subcategory, i.e. not found it.
   */
  [w('bàn', 'ghế', 'giường', 'sofa', 'nệm', 'đệm', 'kệ', 'tủ', 'quầy', 'locker', 'vách ngăn'), 'furniture-appliances'],
  [/xe đạp|xe điện|scooter/i, 'vehicles'],
  // ⚠️ SMARTWATCHES ARE ELECTRONICS, analogue watches are fashion — tested in that order because
  // "đồng hồ thông minh" contains "đồng hồ".
  [/apple watch|galaxy watch|smartwatch|đồng hồ thông minh/i, 'electronics'],
  [/đồng hồ|watch band|dây đeo/i, 'fashion-beauty'],
  [/loa |tai nghe|headphone|earbud|airpod/i, 'electronics'],
]

const DEFAULT_CATEGORY = 'electronics'

export function categoryFor(name: string): string {
  for (const [re, slug] of RULES) if (re.test(name)) return slug
  return DEFAULT_CATEGORY
}

/**
 * Subcategory, as ORDERED rules per category rather than the taxonomy's own keyword arrays.
 *
 * ⛔ THE TAXONOMY'S KEYWORDS CANNOT BE USED RAW HERE, AND THE REASON IS A REAL MIS-FILING: the
 * `storage` subcategory lists `tủ` (cabinet) and `tủ lạnh` is a REFRIGERATOR, so a first-match scan
 * files every fridge in the feed as a wardrobe. `white-goods` would have caught it, but its
 * keywords are English-only (`fridge|refrigerator|washer`) and this feed is Vietnamese. Order is
 * the fix: the specific two-word appliance terms are tested before the generic one-word ones.
 *
 * ⚠️ NO MATCH LEAVES IT NULL. Half this feed is appliances and accessories with no good home in
 * our taxonomy; guessing would put a phone case under "Phones" and make the facet useless. An
 * unset subcategory is honest and the category filter still works.
 */
const SUBCATS: Record<string, [RegExp, string][]> = {
  'books-stationery': [
    [w('văn phòng phẩm', 'bút bi', 'bút gel', 'sổ tay', 'sổ lò xo', 'giấy a4', 'bìa hồ sơ'), 'stationery-office'],
    [/truyện tranh|manga|comic/i, 'comics-manga'],
    [/từ điển|dictionary|ielts|toeic|tiếng anh|tiếng nhật|tiếng hàn|tiếng trung/i, 'languages-dictionaries'],
    [/giáo khoa|luyện thi|bài tập|tham khảo|(?<!\p{L})lớp \d/iu, 'textbooks-exam'],
    [/thiếu nhi|cho bé|mẫu giáo|tuổi thơ/i, 'childrens-books'],
  ],
  electronics: [
    /**
     * ⛔ PRODUCT TYPE BEATS SPEC TOKEN, AND THE FIRST ORDERING GOT THIS EXACTLY BACKWARDS.
     * Component words (`ssd`, `usb`, `wifi`, `kit`, `sạc`, `switch`) sat above the product rules,
     * so a title that NAMES a product was filed by a spec it merely mentions. Measured on the
     * 6,160-product staging file: 260 laptops filed as `storage` ("Dell Precision 3480 … SSD
     * 512GB"), 36 tablets as `networking` ("iPad Gen 9 WiFi"), "AirPods Pro 2 (USB-C)" as storage,
     * "Canon EOS R50 Kit 18-45mm" as an accessory. Four reviewers found it independently.
     *
     * The rule: if the title says what the thing IS, that wins. Component and accessory buckets
     * are FALLBACKS for titles that are genuinely about a cable, a drive or a router — so they
     * come last, not first.
     */
    /**
     * ⛔ AN ACCESSORY NAMES THE DEVICE IT FITS, AND THE RULE ABOVE READS THAT NAME AS THE PRODUCT.
     * Measured on live rows 2026-09-17: **95 of the 127 "iPhone 18" listings were cases, tempered
     * glass and protector combos filed under `phones-tablets`** — "Ốp lưng iPhone 18 Pro Max Wiwu
     * Areoshield…" matched `iphone` before it ever reached the `ốp lưng` rule below, so the phone
     * model facet and every brand/model browse view were three-quarters phone cases. That is not
     * the "spec token" mistake the note above describes: `ốp lưng`/`case`/`cường lực` ARE what the
     * thing IS. The product word is in the title, just not first.
     *
     * ⚠️ ABOVE `cameras`, NOT MERELY ABOVE `phones-tablets` — astra's catch when this plan was
     * reviewed. The camera rule owns the bare token `\blens\b`, so "JCPAL … Camera Lens Protector
     * for iPhone 18 Pro" (a real live title) files as a CAMERA unless the protector rule is tested
     * first. Protectors therefore come before cases: a title carrying both words ("case with
     * tempered glass") is sold as the glass.
     *
     * ⚠️ ENGLISH TERMS ARE NOT OPTIONAL HERE. The partner-shop importer stores machine-translated
     * titles, so the same product arrives as "Ốp lưng…" from AccessTrade and "… Case …" from a
     * shop catalogue; a Vietnamese-only rule set fixes one importer and silently misses the other.
     */
    /**
     * ⚠️ EVERY NARROWING BELOW IS A MEASURED FALSE POSITIVE, not caution. Re-classifying all 60,000
     * imported titles with the first cut of these two rules moved 1,712 rows, and the diff showed:
     *   · `miếng dán` alone claimed eye patches, scar dressings and reflective car stickers — so it
     *     must be followed by the thing being covered (`màn hình|camera|cường lực|kính`).
     *   · `\bốp\b` matched **"Xốp"** (foam) in a mop and a coaster set, because JavaScript's `\b` is
     *     ASCII-only and fires between `X` and `ố` — the exact trap this file's `w()` helper exists
     *     for. `ốp lưng` is the real term and needs no bare fallback.
     *   · `\bcase\b` matched "Giá đỡ Laptop S-Case" (a stand) on the hyphen boundary; requiring no
     *     preceding word character or hyphen keeps "iPhone 18 Pro Case" and drops "S-Case".
     * A laptop case is routed to `accessories` on the line above these, because `phone-cases` would
     * file 67 MacBook sleeves under phone cases — the same class of lie this whole block removes.
     */
    // ⛔ A DEVICE'S SPEC LINE SAYS "Case" TOO. Apple titles its own watches "Apple Watch SE 2025 44mm
    // GPS Aluminum Case with Sport Band" — the MATERIAL of the watch body — and the first version of
    // this carve-out read that as a watch case: a repair pass moved 22 real Apple Watches (and 5 DJI
    // mics sold with a charging case) onto `accessories` before opus caught it on review. They were
    // restored from the pass's snapshot. `case` after a material word is a spec, never a product.
    // ⚠️ THE HOST LIST IS NOT JUST LAPTOPS. `ốp lưng`/`bao da` now outrank the camera and watch
    // rules, so a camera bag or an e-reader sleeve would file as a phone case — opus's catch on the
    // diff. Measured: 3 live titles, all e-readers, none a camera today; the carve-out is here so
    // the next Fujifilm case does not have to be.
    [/(ốp lưng|bao da|túi chống sốc|(?<![\w-])(?<!charging )(?<!(?:alumin(?:i)?um|titanium|steel|nhôm|carbon fiber) )case\b)[^|]*(macbook|laptop|máy tính xách tay|máy ảnh|ống kính|gopro|\bdji\b|máy đọc sách|kindle|apple watch|galaxy watch)|(macbook|laptop|máy tính xách tay|máy ảnh|ống kính|gopro|\bdji\b|máy đọc sách|kindle|apple watch|galaxy watch)[^|]*(ốp lưng|bao da|túi chống sốc|(?<![\w-])(?<!charging )(?<!(?:alumin(?:i)?um|titanium|steel|nhôm|carbon fiber) )case\b)/i, 'accessories'],
    // A desktop chassis is a "case" and is often sold WITH a tempered-glass side panel — both of
    // the rules below would claim it, and neither answer is true. Measured: "Case máy tính Corsair
    // 6500X Tempered Glass Mid-Tower".
    [/case máy tính|vỏ máy tính|mid[- ]?tower|full[- ]?tower/i, 'accessories'],
    // A bundle of protection for a phone is a bundle of ACCESSORIES — 4 live rows ("Combo Bảo Vệ
    // iPhone 18 Series", ₫1,050,000) sat in `phones-tablets` at a tenth of any phone's price.
    // ⚠️ …UNLESS IT NAMES A STORAGE TIER, which a protection bundle never does and a bundled HANDSET
    // always does ("Combo Xiaomi Redmi Note 14 8GB/256GB + sạc nhanh"). Without that guard the rule
    // reaches past the 4 rows it was measured on and files phones as accessories (opus).
    [/(?<!\p{L})combo(?!\p{L})(?![^|]*\d+\s*(?:GB|TB)(?![\p{L}\p{N}]))[^|]{0,40}(iphone|ipad|galaxy|samsung|xiaomi|oppo|vivo|realme|pixel)/iu, 'accessories'],
    [/kính cường lực|cường lực|dán (bảo vệ|màn hình|camera|lưng)|miếng dán (màn hình|camera|cường lực|kính)|screen protector|tempered glass|lens protector|camera protector/i, 'screen-protectors'],
    /**
     * ⚠️ THE ENGLISH WORD `case` NEEDS A DEVICE NEXT TO IT; the Vietnamese terms do not. Measured on
     * the 60,000 imported titles: a bare `\bcase\b` claimed 10 Dell laptops ("14.0 FHD Alumium
     * Case" — the chassis), 7 Raspberry Pi enclosures, a GoPro housing, a DJI mic's charging case
     * and a Waveshare LCD "with Case". `ốp lưng` and `bao da` have no such second meaning, which is
     * why they stay unconditional — including for the iPad folios that make up most of this bucket.
     */
    [/ốp lưng|bao da|(?:iphone|ipad|galaxy|samsung|xiaomi|oppo|vivo|realme|pixel|điện thoại|smartphone|tablet|máy tính bảng)[^|]{0,60}(?<![\w-])(?<!charging )(?<!(?:alumin(?:i)?um|titanium|steel|nhôm|carbon fiber) )case\b|(?<![\w-])(?<!charging )(?<!(?:alumin(?:i)?um|titanium|steel|nhôm|carbon fiber) )case\b[^|]{0,30}(?:for|cho)\s+(?:iphone|ipad|galaxy|samsung|xiaomi|oppo|vivo|realme|pixel|điện thoại|máy tính bảng)/i, 'phone-cases'],
    // ── what the thing IS ───────────────────────────────────────────────────────────────
    [w('apple watch', 'galaxy watch', 'smartwatch', 'đồng hồ thông minh'), 'smartwatch'],
    [/máy ảnh|máy quay|ống kính|\blens\b|gopro|\bdji\b|flycam|canon|nikon|fujifilm|\bngàm\b/i, 'cameras'],
    [/iphone|ipad|galaxy tab|điện thoại|máy tính bảng|smartphone|tablet/i, 'phones-tablets'],
    [/macbook|laptop|thinkpad|thinkbook|latitude|elitebook|probook|inspiron|\bxps\b|precision|zbook|ideapad|vivobook|máy tính xách tay|máy tính để bàn|\bpc\b|desktop|\bnuc\b|optiplex/i, 'laptops-pcs'],
    [/màn hình|monitor|smart tivi|\btivi\b|\btv\b|television/i, 'tv-monitors'],
    [/tai nghe|headphone|earbud|airpod|\bloa\b|speaker|soundbar/i, 'audio'],
    // ⚠️ `switch mạng` is a network switch — it must be tested BEFORE the console rule claims
    // the bare word "switch" for a Nintendo.
    [/switch mạng|router|modem|access point|bộ phát wifi/i, 'networking'],
    [/đĩa game|playstation|\bps[45]\b|xbox|nintendo|\bswitch\b|tay cầm chơi game/i, 'gaming'],
    [/máy in|printer|mực in/i, 'printers'],
    // Components: hshop.vn is 1,086 sensors and dev boards. Below the product rules so a
    // "Kit 18-45mm" camera lens is not swallowed by `kit`.
    [/cảm biến|mạch |module|\bkit\b|động cơ|đầu nối|arduino|raspberry|breakout/i, 'accessories'],
    // ── what the thing is FOR (fallbacks) ───────────────────────────────────────────────
    // ⚠️ power-banks BEFORE cables-chargers: the standard term is "pin sạc dự phòng", which the
    // `sạc` rule would otherwise claim, leaving power-banks permanently unreachable.
    [/pin dự phòng|pin sạc dự phòng|sạc dự phòng|power ?bank/i, 'power-banks'],
    [w('bàn phím', 'chuột', 'keyboard', 'mouse'), 'keyboards-mice'],
    // ⚠️ THE `phone-cases` / `screen-protectors` RULES USED TO SIT HERE and are now at the top of
    // this table — see the note there. They are not duplicated back into the fallback section: two
    // copies of the same pattern in one ordered list is a rule set that can disagree with itself.
    [/sạc|cáp |adapter|charger|\bcable\b|củ sạc/i, 'cables-chargers'],
    [/\bssd\b|\bhdd\b|ổ cứng|thẻ nhớ|\busb\b|memory card/i, 'storage'],
    [/phụ kiện|dock|hub |giá đỡ|balo|túi chống sốc/i, 'accessories'],
  ],
  'furniture-appliances': [
    // ⛔ These FIRST — "tủ lạnh" contains "tủ", which `storage` claims.
    [/tủ lạnh|tủ đông|máy giặt|máy sấy|điều hòa|máy lạnh|máy rửa (bát|chén)/i, 'white-goods'],
    [/nồi|chảo|bếp |lò vi sóng|máy xay|ấm |máy pha cà phê/i, 'kitchenware'],
    [w('sofa', 'ghế', 'ghế xoay', 'ghế văn phòng'), 'sofa-seating'],
    [w('giường', 'nệm', 'đệm'), 'beds-mattresses'],
    // ⚠️ Desks before storage: "bàn" is unambiguous once keyboards are gone, but "quầy lễ tân"
    // (reception counter) and "bàn hồ sơ" would otherwise be pulled in by the cabinet rule.
    [w('bàn', 'quầy', 'vách ngăn', 'desk', 'table'), 'tables-desks'],
    [/đèn |lamp|light|tranh |gương/i, 'lighting-decor'],
    [w('tủ', 'kệ', 'locker', 'wardrobe', 'cabinet', 'shelf'), 'storage'],
  ],
}

/**
 * ⛔ A REFRESH KEEPS THE ROW'S PLACEMENT (2026-09-13). The importers re-ran `categoryFor` on every refresh
 * and wrote the answer over whatever the row held — so a product re-filed by the Gemini pass, a
 * classify script or an admin went straight back to the title rules' guess (and for Tiki, that guess was
 * `electronics` for tens of thousands of books). The row's stored placement wins; the feed's answer only
 * fills what is missing: a row with no category takes the feed's, and a row whose category AGREES with
 * the feed but has no subcategory takes the feed's subcategory, which is how an improved rule still
 * reaches old rows without overruling a deliberate re-file.
 */
export function refreshPlacement(
  existing: { categorySlug: string | null; subcategorySlug: string | null } | null,
  feed: { categorySlug: string; subcategorySlug: string | null },
): { categorySlug: string; subcategorySlug: string | null } {
  if (!existing?.categorySlug) return feed
  // ⛔ THE DEFAULT BUCKET IS NOT A DECISION. `electronics` with no subcategory is where categoryFor() put
  // everything it could not recognise, so a row still sitting there was never re-filed by anyone — and
  // pinning it would have kept ~23,000 Tiki books in Electronics forever while the book rule could see
  // them (four reviewers). A deliberate re-file never lands in that bucket, so it is safe to let the feed
  // move those rows, and only those.
  if (existing.categorySlug === DEFAULT_CATEGORY && !existing.subcategorySlug && feed.categorySlug !== DEFAULT_CATEGORY) return feed
  if (existing.categorySlug === feed.categorySlug && !existing.subcategorySlug) return feed
  return { categorySlug: existing.categorySlug, subcategorySlug: existing.subcategorySlug }
}

/**
 * A FREE GIFT IS NOT THE PRODUCT. VN retail titles advertise the bundle inline — "Xiaomi Redmi Pad
 * 2 Wifi 8GB/256GB Chính Hãng (Tặng Kèm Bao Da Chính Hãng)" is a TABLET, and every accessory rule
 * below would read `bao da` and file it as a case. agy raised this against the accessory reordering
 * and it is real, if rare: measured across 2,201 live titles carrying a gift clause, exactly one
 * product flipped (the two other hits were genuine accessories whose own gift clause changed
 * nothing). Cutting the clause is better than special-casing the accessory rules, because the same
 * clause misleads every rule in the table — "tặng kèm tai nghe" on a phone reaches `audio` too.
 *
 * ⚠️ THE CLAUSE IS BOUNDED TO SIX WORDS, not "to the next separator". Unbounded, a title that LEADS
 * with the gift — "Tặng kèm ốp lưng chính hãng khi mua iPhone 18 Pro 256GB" — was cut to nothing,
 * fell back to the original, and then filed a PHONE as a phone case off the words it was supposed to
 * ignore (agy). Six words covers the real clauses ("tặng kèm bao da chính hãng") and leaves the
 * product standing when the clause comes first.
 *
 * Cut from `tặng`, and drop a parenthesis that contains it. "Mua 1 tặng 1 Tấm
 * dán màn hình…" survives correctly — "mua N tặng N" is a buy-one-get-one offer whose product
 * comes AFTER the word, so that idiom is excluded and the title is matched whole.
 */
export function withoutGiftClause(name: string): string {
  const cut = name
    // ⚠️ A TRAILING "- Kèm …" IS THE BUNDLE TOO. "Lenovo Idea Tab Wifi 8GB 128GB ZAFR0366VN - Kèm bút- ốp
    // lưng" is a TABLET that ships with a stylus and a case; the first repair pass read `ốp lưng` and
    // filed it under phone cases (restored from its snapshot; opus predicted the class). Only after a
    // separator — "Ốp lưng kèm bàn phím ZAGG" is a case whose `kèm` describes the product itself.
    .replace(/\s[-–|,]\s*kèm(?!\p{L})[^|]*$/giu, ' ')
    .replace(/[([][^)\]]*tặng[^)\]]*[)\]]/giu, ' ')
    .replace(/(?<!mua\s*\d+\s*)(?<!\p{L})tặng(?!\p{L})(?:\s+(?!khi(?!\p{L})|mua(?!\p{L}))[^\s\-|,;([]+){0,6}/giu, ' ')
    .replace(/[\s-]{2,}/g, ' ')
    .trim()
  /**
   * ⚠️ A CUT THAT TAKES MOST OF THE TITLE TOOK THE PRODUCT WITH IT. The clause runs to the next
   * separator, so a title that LEADS with the gift — "Tặng kèm ốp lưng khi mua iPhone 18 Pro 256GB"
   * — would be cut to nothing and the phone would file as unclassified. Both reviewers raised it on
   * the diff; measured, 53 live titles (all books with a trailing clause) lose more than 60% of
   * their letters. Below that threshold the original is the safer input: a gift clause misleads a
   * rule occasionally, an empty string misleads it always.
   */
  return cut.length >= name.length * 0.4 ? cut : name
}

export function subcategoryFor(categorySlug: string, name: string): string | null {
  const clean = withoutGiftClause(name)
  for (const [re, slug] of SUBCATS[categorySlug] ?? []) if (re.test(clean)) return slug
  return null
}

/**
 * Brands worth having, chosen by FREQUENCY not by recognition.
 *
 * ⚠️ MEASURED ON 2,000 FEED ROWS: these are every brand appearing 15+ times. Twenty more appeared
 * fewer than 15 times and are deliberately left out — the brand facet is a navigation aid, and a
 * list with a 3-product long tail is worse than a short one (owner: "keep tight not too many").
 * A product whose brand is not here simply gets none, which is also true of ~43% of this feed.
 */
export const FEED_BRANDS = ['apple', 'samsung', 'lg', 'panasonic', 'toshiba', 'sharp', 'sony', 'asus', 'canon',
  'dji', 'msi', 'honor', 'fujifilm', 'logitech', 'electrolux', 'xiaomi', 'hp', 'philips', 'casio']

/**
 * ⚠️ `\b` WORD BOUNDARIES ARE LOAD-BEARING. Without them "hp" matches inside "shop", "sharp" and
 * "graphics", and "lg" inside "Belgium" — a brand facet full of products that have nothing to do
 * with the brand. The boundaries are why this is a regex and not an `includes`.
 */
const BRAND_RE = new RegExp(`\\b(${FEED_BRANDS.join('|')})\\b`, 'i')

/**
 * ⛔ A PRODUCT LINE THAT ONLY ONE COMPANY MAKES NAMES ITS BRAND. Merchants title Apple devices by the line
 * alone — CellphoneS lists "iPhone 18 Pro 256GB", never "Apple iPhone 18 Pro" — so the brand-word regex
 * returned null and the phone landed with NO brand. Measured 2026-09-15: 4 of the 8 live iPhone 18 phones
 * had an empty brandSlug, which drops them from the Apple brand facet, the brand page and the market-price
 * band that is keyed on brand + model.
 * ⚠️ Only lines that are unambiguous trademarks of one maker, whole-word. "Galaxy" is NOT here: "Galaxy
 * Buds" is Samsung, but Galaxy also appears in unrelated product names and toy titles.
 */
const LINE_BRAND: [RegExp, string][] = [
  [/\b(iphone|ipad|macbook|imac|airpods|apple\s*watch|apple\s*pencil|homepod|vision\s*pro)\b/i, 'apple'],
]

/**
 * ⚠️ …BUT NOT WHEN THE PRODUCT IS SOMETHING MADE *FOR* THAT LINE. The same CellphoneS feed carries 107
 * accessories that name the phone — "Ốp lưng iPhone 18 Pro/17 Pro Zagg …", "Miếng dán camera iPhone 18 Pro
 * … Mipow" — and those are Zagg and Mipow products, not Apple's. Accessory nouns and "for"-words
 * ("cho", "dành cho", "for", "compatible") mean the line is the TARGET, so no brand is inferred from it.
 */
const ACCESSORY_RE = /(?:^|[^\p{L}])(ốp|op lung|case|bao da|miếng dán|dán|kính cường lực|cường lực|dây đeo|dây|cáp|củ sạc|sạc|giá đỡ|túi|ví|bút cảm ứng|phụ kiện|cho|dành cho|for|compatible)(?![\p{L}])/iu

/**
 * ⛔ A DEVICE MAKER'S NAME INSIDE AN ACCESSORY TITLE IS THE TARGET, NOT THE MAKER — and until
 * 2026-09-17 that only held for the `LINE_BRAND` fallback below, never for the brand WORD. Measured
 * on the live catalogue: **914 cases, films and folios were branded with the phone they fit** —
 * "Miếng Dán Cường Lực Camera Lens Dành Cho Samsung Galaxy S23 Ultra Zeelot" filed under `samsung`,
 * a Zeelot product. Both external reviewers found it independently on the diff review.
 *
 * The rule is not "an accessory has no brand": a Zagg case is a Zagg. So on an accessory title the
 * host-device brands are SKIPPED and the search continues — the first brand that is not a device
 * maker wins, and only when there is none does this return null.
 */
export const HOST_BRANDS = new Set([
  'apple', 'samsung', 'xiaomi', 'oppo', 'vivo', 'realme', 'huawei', 'honor', 'google', 'sony',
  'nokia', 'oneplus', 'motorola', 'asus', 'lenovo', 'dell', 'hp', 'msi', 'acer',
])
const BRAND_RE_G = new RegExp(BRAND_RE.source, 'gi')

/**
 * ⚠️ THE TEST IS THE SHELF, NOT THE ACCESSORY WORDS — and the first cut got that wrong in a way
 * only a measurement showed. Keying on `ACCESSORY_RE` unbranded **2,888 rows**, among them "Tai
 * nghe Bluetooth Apple AirPods 3 2022 sạc có dây", "AppleCare+ cho AirPods" and Apple's own
 * "Dây đeo Apple Watch Alpine Loop", because that pattern holds `sạc`, `dây`, `túi`, `cho` and
 * `for` — words that appear in plenty of titles for the device itself. opus predicted exactly this
 * on the diff review. Cases and protectors are the two shelves whose products are DEFINED by the
 * device they fit, so they are the only ones where a device maker's name is presumed to be the
 * target rather than the maker.
 */
/** Shelves whose products are made FOR another device — a product line named there is the target. */
const ACCESSORY_SHELVES = new Set(['phone-cases', 'screen-protectors', 'cables-chargers', 'power-banks', 'accessories'])

/**
 * What follows a device maker's name when the name refers to the DEVICE ("Samsung Galaxy S26",
 * "Apple iPad Pro") rather than to the maker of the product in hand.
 *
 * ⛔ WITHOUT THIS, A MAKER'S OWN CASE LOST ITS MAKER. The rule used to treat every host brand on a
 * case shelf as the target, so "Ốp lưng Galaxy S26 Ultra PC Samsung Chính hãng" and "Ốp lưng iPhone
 * 17 Pro Apple With Magsafe Clear" — Samsung's and Apple's own products — were unbranded along with
 * the Mutural and Nillkin folios the rule was aimed at. Measured: 67 of the 497 brands a repair pass
 * removed were the manufacturer's own; they were restored. The tell is word order: a brand followed
 * by a device line names the device, a brand followed by anything else names the maker.
 */
const DEVICE_AFTER_BRAND: Record<string, RegExp> = {
  apple: /^\s*(iphone|ipad|watch|pencil|macbook|airpods|imac|tv|vision)/i,
  samsung: /^\s*(galaxy|s\d|note|z\s?(fold|flip)|tab|a\d)/i,
  xiaomi: /^\s*(redmi|pad|mi\b|poco|\d|civi|mix)/i,
  oppo: /^\s*(reno|find|a\d|f\d|k\d)/i,
  vivo: /^\s*(v\d|y\d|x\d|t\d|s\d)/i,
  realme: /^\s*(\d|c\d|gt|note|narzo)/i,
  huawei: /^\s*(p\d|mate|nova|pura|matepad|y\d)/i,
  honor: /^\s*(x\d|magic|\d)/i,
  google: /^\s*(pixel)/i,
  sony: /^\s*(xperia)/i,
}
const namesTheDevice = (slug: string, after: string) => (DEVICE_AFTER_BRAND[slug] ?? /^\s*[a-z]*\d/i).test(after)

const fitsAHostDevice = (name: string) => {
  const shelf = subcategoryFor('electronics', name)
  return shelf === 'phone-cases' || shelf === 'screen-protectors'
}

export function brandFor(rawName: string): string | null {
  // ⚠️ THE GIFT CLAUSE IS CUT HERE TOO, for the reason `subcategoryFor` cuts it: "Xiaomi Redmi Pad 2
  // (Tặng Kèm Bao Da)" is a TABLET, and the free folio in its title would otherwise route it down
  // the accessory path, where `xiaomi` is skipped as a host brand and the tablet ends up unbranded.
  const name = withoutGiftClause(rawName)
  /**
   * ⛔ A BRAND NAMED AFTER "cho" / "for" IS THE TARGET, NOT THE MAKER. This is the precise version
   * of the rule the shelf test above approximates: "Cáp sạc USB-C cho iPhone 18" is somebody's
   * cable, while "Dây đeo Apple Watch Alpine Loop Titanium" is Apple's own strap — and the only
   * difference between them is which side of that word the device name sits on. A blunter guard
   * (any accessory noun anywhere) unbranded 2,888 rows including Apple's own products.
   */
  const hostFitting = fitsAHostDevice(name)
  /**
   * ⚠️ …AND ONLY WHEN THE PRODUCT IS AN ACCESSORY. On a device the same word is ordinary prose —
   * "Laptop dành cho sinh viên Dell Inspiron 15", "Tai nghe cho game thủ Sony INZONE" — and reading
   * the brand after it as a target unbranded the device itself (opus). The marker only means
   * "fits this" on a product that is made to fit something.
   */
  const shelf = subcategoryFor('electronics', name)
  const found = name.match(/(?:^|[^\p{L}])(?:dành cho|cho|for|compatible with|fits)(?![\p{L}])/iu)
  // The shelf alone misses cables: the phone rule outranks the charger rule, so "Cáp sạc USB-C cho
  // iPhone 18" sits on `phones-tablets`. An accessory NOUN in front of the marker settles it.
  const nounBefore = found?.index !== undefined
    && /(cáp|sạc|cable|charger|adapter|giá đỡ|dây đeo|ốp|bao da|túi|miếng dán|cường lực|bút cảm ứng|phụ kiện|case|cover|stand|holder|mount)/i.test(name.slice(0, found.index))
  const isAccessory = hostFitting || nounBefore || (shelf !== null && ACCESSORY_SHELVES.has(shelf))
  const marker = isAccessory ? found : null
  const targetFrom = marker?.index ?? Number.POSITIVE_INFINITY

  let accessoryMaker: string | null = null
  for (const m of name.matchAll(BRAND_RE_G)) {
    const slug = brandSlugify(m[1])
    const isHost = HOST_BRANDS.has(slug)
    /**
     * ⚠️ ON A CASE SHELF A DEVICE MAKER IS THE TARGET **UNLESS IT IS NAMED BEFORE THE "cho"**.
     * Apple sells cases for its own phones and titles them "Ốp lưng Apple MagSafe cho iPhone 15
     * Pro" — 77 such rows would have been unbranded by the blunter version of this line. The
     * device-as-target shape is the one with no compatibility marker at all ("Ốp lưng Samsung
     * Galaxy S26 Ultra Slimcase"), where the phone's name IS the product description.
     */
    const namesTheTarget = (m.index ?? 0) > targetFrom
      || (hostFitting && isHost && namesTheDevice(slug, name.slice((m.index ?? 0) + m[0].length)))
    if (!namesTheTarget) return slug
    // A maker named inside the compatibility half is still the maker when it makes no devices —
    // "… for iPhone 18 Pro, by Zagg" — so it is remembered rather than returned immediately.
    if (!isHost) accessoryMaker ??= slug
  }
  if (accessoryMaker) return accessoryMaker

  if (hostFitting) return null
  /**
   * ⚠️ THE LINE PATH IS GUARDED BY THE SHELF, NOT BY ACCESSORY WORDS ANYWHERE IN THE TITLE. Testing
   * `ACCESSORY_RE` here read "iPhone 18 Pro 256GB kèm sạc nhanh" as an accessory — the word `sạc` is
   * in that pattern — and returned null for a phone (agy). The shelf answers the same question
   * without the collateral: a laptop sleeve lands on `accessories`, a case on `phone-cases`, while a
   * phone that merely mentions its charger stays on `phones-tablets` and keeps its brand.
   */
  if (isAccessory) return null
  for (const [re, brand] of LINE_BRAND) {
    const m = name.match(re)
    if (m && (m.index ?? 0) < targetFrom) return brand
  }
  return null
}
