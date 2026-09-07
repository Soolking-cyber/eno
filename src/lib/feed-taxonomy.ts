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

export function categoryFor(name: string): string {
  for (const [re, slug] of RULES) if (re.test(name)) return slug
  return 'electronics'
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
    [/ốp lưng|bao da|\bcase\b/i, 'phone-cases'],
    [/cường lực|dán màn hình|screen protector/i, 'screen-protectors'],
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

export function subcategoryFor(categorySlug: string, name: string): string | null {
  for (const [re, slug] of SUBCATS[categorySlug] ?? []) if (re.test(name)) return slug
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

export function brandFor(name: string): string | null {
  const m = name.match(BRAND_RE)
  return m ? brandSlugify(m[1]) : null
}
