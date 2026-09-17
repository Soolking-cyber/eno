/**
 * SUPERSPORTS → eno TAXONOMY. The merchant's own fields in, this app's category / subcategory /
 * facet values out.
 *
 * ⛔ A TABLE, NOT A TITLE-KEYWORD GUESS. SuperSports is a Shopify store and every product carries a
 * `product_type` the merchant chose — 94 distinct values across 5,978 products, measured
 * 2026-09-17. Mapping those 94 by hand is the whole of the placement problem, and it is exact:
 * `feed-taxonomy.ts`'s keyword rules exist because AccessTrade's feed has nothing better, and they
 * are the reason "Kệ sách" (a bookshelf) once had to be argued out of Books. Here there is a
 * better key, so the keyword path is a FALLBACK for a type the merchant adds after this was
 * written, never the primary.
 *
 * ⚠️ TESTED AGAINST THE MEASURED 94 (supersports-taxonomy.test.ts): the test holds the exact list
 * of types seen on the live catalogue and fails if one of them stops resolving. A new type from the
 * merchant therefore reaches the fallback — not a crash, and not a silent misfile either, because
 * the importer reports how many rows took the fallback.
 */
import { buildFacetTokens } from './facet-tokens'

/** What KIND of thing this is. Both the adult aisle and the kids aisle are derived from it, so a
 *  product cannot be a shoe in one and a garment in the other. */
export type SsGroup =
  | 'apparel' | 'footwear' | 'swim-apparel' | 'swim-gear' | 'gym'
  | 'racket-ball' | 'outdoor' | 'accessory' | 'nutrition'

/** The merchant's `product_type` → group. All 94 measured values, grouped. */
export const SS_GROUP: Record<string, SsGroup> = {
  // ── apparel (worn, sized by letter) ───────────────────────────────────────────
  'Áo Thun': 'apparel', 'Áo Polo': 'apparel', 'Áo Ba Lỗ': 'apparel', 'Áo Khoác': 'apparel',
  'Áo Sơ Mi': 'apparel', 'Áo Hoodie': 'apparel', 'Áo Nỉ': 'apparel', 'Áo Crop-Top': 'apparel',
  'Áo Lót': 'apparel', 'Áo Tập Nữ / Áo Bra': 'apparel', 'Áo Đá Bóng': 'apparel',
  'Quần Ngắn Thể Thao': 'apparel', 'Quần Dài Thể Thao': 'apparel', 'Quần Bó Thể Thao': 'apparel',
  'Quần Ngắn Thời Trang': 'apparel', 'Quần Jogger': 'apparel', 'Quần Lót': 'apparel',
  'Chân Váy': 'apparel', 'Đầm': 'apparel',
  // ── footwear (ALL of it, including slides and flip-flops) ─────────────────────
  // ⚠️ A SLIDE IS A SHOE. An earlier draft filed `Dép Quai Ngang` (slides, 99) and `Dép Xỏ Ngón`
  // (flip-flops, 23) under accessories; both reviewers called it out, and they were right — a
  // shopper browsing footwear expects them, and they are sized on the same US scale as trainers.
  'Giày Chạy Bộ': 'footwear', 'Giày Sneakers / Giày Thời Trang': 'footwear', 'Giày Clog': 'footwear',
  'Clog': 'footwear', 'Giày Luyện Tập': 'footwear', 'Giày Sandals': 'footwear',
  'Giày Đá Bóng': 'footwear', 'Giày Tennis': 'footwear', 'Giày Leo Núi': 'footwear',
  'Giày Golf': 'footwear', 'Giày Bóng Rổ': 'footwear', 'Giày Pickleball': 'footwear',
  'Giày Thể Thao Đa Năng': 'footwear', 'Giày Slip-On': 'footwear',
  'Dép Quai Ngang': 'footwear', 'Dép Xỏ Ngón': 'footwear',
  // ── swimming ──────────────────────────────────────────────────────────────────
  'Quần Bơi': 'swim-apparel', 'Áo Bơi': 'swim-apparel',
  'Đồ Bơi Một Mảnh': 'swim-apparel', 'Đồ Bơi Hai Mảnh': 'swim-apparel',
  'Kính Bơi': 'swim-gear', 'Mũ / Nón Bơi': 'swim-gear', 'Dụng Cụ Bơi & Thể Thao Biển': 'swim-gear',
  'Phao Bơi': 'swim-gear', 'Tròng Kính Bơi': 'swim-gear', 'Dây Kính Bơi': 'swim-gear',
  // A buoyancy vest is safety equipment, not swimwear — it is sized by weight, not by chest.
  'Áo Phao': 'swim-gear',
  // ── gym, yoga, recovery, machines ─────────────────────────────────────────────
  'Dụng Cụ Tập Gym': 'gym', 'Dụng Cụ Tập Yoga': 'gym', 'Dụng Cụ Massage': 'gym',
  'Ghế Massage': 'gym', 'Găng Tay Gym': 'gym', 'Máy Tập Liên Hoàn': 'gym', 'Máy Chạy Bộ': 'gym',
  'Xe Đạp Trong Nhà': 'gym', 'Máy Chèo Thuyền Và Tập Cơ': 'gym',
  // ── rackets, balls, sport-specific trainers ───────────────────────────────────
  'Vợt': 'racket-ball', 'Banh Bóng Đá': 'racket-ball', 'Banh Bóng Rổ': 'racket-ball',
  'Banh Bóng Ném': 'racket-ball', 'Banh Bóng Pickleball': 'racket-ball',
  'Pickleball Balls': 'racket-ball', 'Cầu Bay': 'racket-ball', 'Đĩa Ném': 'racket-ball',
  'Dụng Cụ Tập Bóng Đá': 'racket-ball', 'Dụng Cụ Tập Golf': 'racket-ball',
  // ── outdoor + wheels ──────────────────────────────────────────────────────────
  'Xe Đạp': 'outdoor', 'Phụ Kiện Xe Đạp': 'outdoor', 'Ván Trượt': 'outdoor', 'Xe Scooter': 'outdoor',
  // ── accessories ───────────────────────────────────────────────────────────────
  'Vớ / Tất': 'accessory', 'Jibbitz': 'accessory', 'Mũ Lưỡi Trai': 'accessory',
  'Mũ / Nón': 'accessory', 'Mũ Xô (Bucket)': 'accessory', 'Mũ Len': 'accessory',
  'Băng Đô': 'accessory', 'Kính Thể Thao': 'accessory', 'Ba Lô': 'accessory',
  'Túi Trống': 'accessory', 'Túi Đeo Chéo': 'accessory', 'Túi Bao Tử': 'accessory',
  'Túi Thể Thao': 'accessory', 'Túi Tote': 'accessory', 'Găng Tay Thể Thao': 'accessory',
  'Đồ Bảo Hộ Thể Thao': 'accessory', 'Bình Nước': 'accessory', 'Chăm Sóc Giày': 'accessory',
  'Thắt Lưng': 'accessory', 'Khăn Thể Thao Đa Năng': 'accessory', 'Quà Lưu Niệm': 'accessory',
  'Phụ Kiện': 'accessory', 'Phụ Kiện Thể Thao': 'accessory',
  // ── nutrition ─────────────────────────────────────────────────────────────────
  'Gel Năng Lượng': 'nutrition', 'Thanh Năng Lượng': 'nutrition',
}

/** Group → the `sports` shelf an ADULT product lands on. */
const ADULT_SHELF: Record<SsGroup, string> = {
  apparel: 'sportswear',
  footwear: 'sports-shoes',
  'swim-apparel': 'swimming',
  'swim-gear': 'swimming',
  gym: 'gym-yoga',
  'racket-ball': 'racket-ball',
  outdoor: 'outdoor-cycling',
  accessory: 'sports-accessories',
  nutrition: 'sports-nutrition',
}

/**
 * Group → the `baby-kids` shelf a KID'S product lands on (owner's choice: kids' goods live in the
 * Kids aisle, not the Sports one).
 *
 * ⚠️ NOT "EVERYTHING THAT IS NOT A SHOE IS CLOTHING", which is what the first draft said and what
 * both reviewers refused: a child's swim goggles, football and scooter are not clothes. The group
 * already knows what the thing is, so the kids aisle reads the same answer the adult one does.
 */
const KIDS_SHELF: Record<SsGroup, string> = {
  apparel: 'kids-clothing',
  'swim-apparel': 'kids-clothing',
  footwear: 'kids-shoes',
  'racket-ball': 'toys',
  outdoor: 'toys',
  'swim-gear': 'baby-gear',
  accessory: 'baby-gear',
  gym: 'baby-gear',
  nutrition: 'baby-gear',
}

/** Keyword fallback for a `product_type` the merchant adds later. Order matters: footwear before
 *  apparel, because "Giày" and "Áo" can both appear in one compound type. */
const FALLBACK: [RegExp, SsGroup][] = [
  [/giày|dép|sandal|clog|slip-?on/i, 'footwear'],
  [/bơi|swim/i, 'swim-gear'],
  [/vợt|banh|bóng|ball|đĩa ném|cầu/i, 'racket-ball'],
  [/yoga|gym|tạ|massage|máy (chạy|tập|chèo)/i, 'gym'],
  [/xe đạp|ván trượt|scooter|xe /i, 'outdoor'],
  [/gel|thanh năng lượng|protein/i, 'nutrition'],
  [/áo|quần|đầm|váy|jogger/i, 'apparel'],
  [/mũ|nón|vớ|tất|túi|ba ?lô|kính|găng|khăn|bình|thắt lưng|phụ kiện/i, 'accessory'],
]

/** The group for a merchant product type, or null when nothing recognises it. */
export function groupFor(productType: string | null | undefined): SsGroup | null {
  const t = (productType || '').trim()
  if (!t) return null
  if (SS_GROUP[t]) return SS_GROUP[t]
  for (const [re, g] of FALLBACK) if (re.test(t)) return g
  return null
}

export type SsGender = 'women' | 'men' | 'unisex' | 'boy' | 'girl' | 'kids' | null

/**
 * Gender from the ENGLISH title's prefix — "Men's Nike…", "Kids' Speedo…".
 *
 * ⛔ NOT FROM TAGS, WHICH LOOK AUTHORITATIVE AND ARE NOT. Measured: all 145 Jibbitz carry Nam AND
 * Nữ AND Unisex, and "Áo Thun" carries Nam on 513 rows and Nữ on 286 of the same 796 — they are
 * merchandising collections, not a product attribute. The title prefix is the merchant's own
 * statement about the product: Men's 2,309, Women's 1,917, Unisex 285, Kids'/Boys'/Girls' 353.
 * ⚠️ 1,114 products have NO prefix (socks, bags, balls). They get no gender, deliberately — a
 * guess here is a filter that lies.
 * ⚠️ The `Kids` TAG is used only as a cross-check, never as the source: it agrees with the kid
 * prefix on 352 of 353 rows, so it adds nothing and can only disagree.
 */
export function genderFromTitle(enTitle: string): SsGender {
  // ⚠️ `(?=\s|$)`, NOT `\b` — a word boundary after "Kids'" never matches, because an apostrophe
  // and the space that follows it are both non-word characters. Every kid's product in the
  // catalogue is titled "Kids' …", so `\b` silently classified all 353 of them as adult.
  const m = /^\s*(men's|women's|unisex|kids'|kid's|boys'|girls'|baby)(?=\s|$)/i.exec(enTitle || '')
  if (!m) return null
  const k = m[1].toLowerCase()
  if (k === "men's") return 'men'
  if (k === "women's") return 'women'
  if (k === 'unisex') return 'unisex'
  if (k === "boys'") return 'boy'
  if (k === "girls'") return 'girl'
  return 'kids'
}

/** True when the product belongs in the Kids aisle. */
export function isKidsGender(g: SsGender): boolean {
  return g === 'boy' || g === 'girl' || g === 'kids'
}

/**
 * The merchant's own kid markers, in either language — the CROSS-CHECK the gender prefix does not
 * need but the Kids aisle does (a reviewer's catch).
 *
 * ⚠️ WHY IT EXISTS: gender is read from the ENGLISH title, and a product the English locale has not
 * published yet is read from the Vietnamese one, where "Kids'" never appears. Such a product would
 * be filed as an adult item and then PINNED there, because a placed row is never re-filed. The
 * `Kids`/`Trẻ em` tag agrees with the English prefix on 352 of 353 rows (measured), so it is a safe
 * second opinion on this one question — and only on this one: it says nothing about men vs women,
 * which is why it is not folded into `genderFromTitle`.
 */
const KID_TAGS = new Set(['Kids', 'Trẻ em', 'Trẻ Em', 'Boys', 'Girls', 'Bé trai', 'Bé gái'])
export function looksLikeKids(enTitle: string, tags: string[], viTitle?: string): boolean {
  const stated = genderFromTitle(enTitle)
  if (isKidsGender(stated)) return true
  /**
   * ⛔ AN EXPLICIT ADULT PREFIX ENDS THE QUESTION, AND THE FIRST VERSION OF THIS FUNCTION FORGOT IT
   * (a reviewer's catch on the fix itself). Tags are a merchandising surface — the 145 Jibbitz carry
   * Nam AND Nữ AND Unisex — so a `Kids` tag on a product the merchant titled "Men's Nike …" would
   * have moved a men's shoe into the Kids aisle, dropped its shoe sizes, relabelled it `unisex`, and
   * PINNED it there, because a placed row is never re-filed. The tag is a second opinion only where
   * the title has none.
   */
  if (stated) return false
  if ((tags || []).some((t) => KID_TAGS.has(t.trim()))) return true
  return /(trẻ em|bé trai|bé gái)/iu.test(viTitle || '')
}

/**
 * Adult gender from a VIETNAMESE title — used only when the English row has not published yet (a
 * reviewer's catch: without it a women's shoe listed only in Vietnamese was converted on the MEN'S
 * chart, two EU sizes out). Whole words only: "Nam"/"Nữ" as a size or model fragment must not count.
 */
export function viAdultGender(viTitle?: string): 'men' | 'women' | null {
  if (/(^|\s)nữ(\s|$)/iu.test(viTitle || '')) return 'women'
  if (/(^|\s)nam(\s|$)/iu.test(viTitle || '')) return 'men'
  return null
}

/** Boy/girl from a Vietnamese title, for a product whose English row has not published yet. */
function viKidGender(viTitle?: string): 'boy' | 'girl' | null {
  if (/bé gái|bé nữ/iu.test(viTitle || '')) return 'girl'
  if (/bé trai|bé nam/iu.test(viTitle || '')) return 'boy'
  return null
}

/** Where this product goes: `sports` for adults, `baby-kids` for children. */
export function placementFor(
  productType: string | null | undefined,
  enTitle: string,
  /** The merchant's kid markers — see looksLikeKids. Omitted, only the English prefix decides. */
  kidHints?: { tags?: string[]; viTitle?: string },
): {
  categorySlug: string
  subcategorySlug: string | null
  group: SsGroup | null
} {
  const group = groupFor(productType)
  const kids = looksLikeKids(enTitle, kidHints?.tags ?? [], kidHints?.viTitle)
  if (!group) return { categorySlug: kids ? 'baby-kids' : 'sports', subcategorySlug: null, group: null }
  return {
    categorySlug: kids ? 'baby-kids' : 'sports',
    subcategorySlug: kids ? KIDS_SHELF[group] : ADULT_SHELF[group],
    group,
  }
}

/** Merchant tag → the `sport` facet value. Both languages appear in the same catalogue. */
const SPORT_TAGS: Record<string, string> = {
  'Chạy bộ': 'running', Running: 'running',
  'Luyện tập': 'training', Training: 'training', Gym: 'training', Hybrid: 'training',
  'Bơi lội': 'swimming', Swimming: 'swimming',
  'Bóng đá': 'football', Football: 'football',
  Tennis: 'tennis', Golf: 'golf',
  'Bóng rổ': 'basketball', Basketball: 'basketball',
  Yoga: 'yoga',
  Pickleball: 'pickleball', 'Pickle Ball': 'pickleball',
  Hiking: 'hiking', 'Leo núi': 'hiking', 'Đi bộ đường dài': 'hiking',
  Cycling: 'cycling', 'Xe đạp': 'cycling',
}

/** A product type that names its own sport, for the ~2,900 products no sport tag reaches. */
const TYPE_SPORT: Record<string, string> = {
  'Giày Chạy Bộ': 'running',
  'Giày Đá Bóng': 'football', 'Áo Đá Bóng': 'football', 'Banh Bóng Đá': 'football', 'Dụng Cụ Tập Bóng Đá': 'football',
  'Giày Tennis': 'tennis',
  'Giày Golf': 'golf', 'Dụng Cụ Tập Golf': 'golf',
  'Giày Bóng Rổ': 'basketball', 'Banh Bóng Rổ': 'basketball',
  'Giày Pickleball': 'pickleball', 'Banh Bóng Pickleball': 'pickleball', 'Pickleball Balls': 'pickleball',
  'Giày Leo Núi': 'hiking',
  'Dụng Cụ Tập Yoga': 'yoga',
  'Dụng Cụ Tập Gym': 'training', 'Găng Tay Gym': 'training', 'Máy Chạy Bộ': 'training',
  'Máy Tập Liên Hoàn': 'training', 'Xe Đạp Trong Nhà': 'training', 'Máy Chèo Thuyền Và Tập Cơ': 'training',
  'Xe Đạp': 'cycling', 'Phụ Kiện Xe Đạp': 'cycling',
  'Kính Bơi': 'swimming', 'Mũ / Nón Bơi': 'swimming', 'Quần Bơi': 'swimming', 'Áo Bơi': 'swimming',
  'Đồ Bơi Một Mảnh': 'swimming', 'Đồ Bơi Hai Mảnh': 'swimming', 'Phao Bơi': 'swimming',
  'Dụng Cụ Bơi & Thể Thao Biển': 'swimming', 'Tròng Kính Bơi': 'swimming', 'Dây Kính Bơi': 'swimming',
  'Áo Phao': 'swimming',
}

/** Every sport this product belongs to (a training shoe is tagged Running AND Training). */
export function sportsFor(tags: string[], productType: string | null | undefined): string[] {
  const out = new Set<string>()
  for (const t of tags || []) { const s = SPORT_TAGS[t.trim()]; if (s) out.add(s) }
  const byType = TYPE_SPORT[(productType || '').trim()]
  if (byType) out.add(byType)
  return [...out]
}

/** Merchant colour → one of the app's eight shared colour buckets. */
const COLOR_MAP: [RegExp, string][] = [
  [/^black|^jet black|^blac/i, 'black'],
  [/^white|^ivory|^cream/i, 'white'],
  [/^gray|^grey|^silver|^charcoal/i, 'grey'],
  [/^blue|^navy|^denim|^teal|^turquoise|^aqua/i, 'blue'],
  [/^green|^army|^olive|^mint|^lime|^khaki/i, 'green'],
  [/^red|^burgundy|^maroon|^coral|^wine/i, 'red'],
  [/^beige|^brown|^tan|^gold|^yellow|^sand|^nude|^taupe|^bronze/i, 'neutral'],
]

/**
 * ⚠️ PINK, PURPLE AND MULTICOLOR LAND IN "Other" (≈800 products), and that is a deliberate choice
 * not to widen a palette every other category shares for the sake of one import. The eight buckets
 * are the app's own (`COLOR_OPTIONS` in taxonomy.ts); adding chips there changes the colour filter
 * in Vehicles, Electronics and Furniture too. The merchant's exact colour word stays visible — it
 * is the last part of the title ("… - Pink").
 */
export function colorBucketFor(raw: string | null | undefined): string | null {
  const v = (raw || '').trim()
  if (!v) return null
  for (const [re, bucket] of COLOR_MAP) if (re.test(v)) return bucket
  return 'other'
}

const LETTER_SIZE: Record<string, string[]> = {
  XXXS: ['xs-s'], XXS: ['xs-s'], XS: ['xs-s'], S: ['xs-s'],
  M: ['m'], L: ['l'],
  XL: ['xl-up'], XXL: ['xl-up'], XXXL: ['xl-up'], '2XL': ['xl-up'], '3XL': ['xl-up'], '4XL': ['xl-up'],
  'S/M': ['xs-s', 'm'], 'M/L': ['m', 'l'], 'L/XL': ['l', 'xl-up'],
  'ONE SIZE': ['free-size'], ONESIZE: ['free-size'], OS: ['free-size'], 'FREE SIZE': ['free-size'],
  '1 PCS': ['free-size'], 'ONE SIZE FITS ALL': ['free-size'],
}

/**
 * Apparel size values → the shared `size` buckets.
 *
 * ⚠️ `A/M` AND `US/M` ARE LETTER SIZES WITH A REGION PREFIX (Asian / US cuts — 470 and 237
 * products). The letter after the slash is the size; the prefix says whose chart it is, which this
 * app's five coarse buckets do not model.
 * ⚠️ A NUMBER IS NOT A SIZE HERE. Swimwear carries chest/waist numbers (30…42, 107 products at
 * "34" alone) and kids' items carry "5-6 YRS". Neither maps onto XS–XL, so they produce nothing
 * rather than a bucket that would be wrong for every buyer who trusted it.
 */
export function apparelSizeBuckets(values: string[]): string[] {
  const out = new Set<string>()
  for (const raw of values || []) {
    const v = raw.trim().toUpperCase()
    const bare = /^(A|US|UK|EU|VN)\/(.+)$/.exec(v)?.[2] ?? v
    for (const b of LETTER_SIZE[bare] ?? []) out.add(b)
  }
  return [...out]
}

/**
 * US / UK shoe sizes → EU, per the conversion charts the brands themselves publish.
 *
 * ⚠️ MEN'S AND WOMEN'S US SIZES ARE DIFFERENT SCALES — US W8 is EU 39, US M8 is EU 41. Converting
 * both with one chart is the single biggest way this could quietly lie to a shopper, so the gender
 * the merchant states in the title picks the chart.
 * ⚠️ AN UNKNOWN SYSTEM PRODUCES NOTHING. Kids' "US C6", "5-6 YRS", a bare "23" (a cm length) and
 * swimwear chest numbers all fall through: no shoe-size facet is better than a wrong one, and the
 * full size run is still shown as text on the listing.
 * ⚠️ HALF SIZES FLOOR INTO THEIR BUCKET (EU 40.5 → `eu-40`), which is how the shared EU chips are
 * defined; anything from 44 up is `eu-44-plus`, anything below 35 is dropped (that is a child's
 * shoe, and the adult chips start at 35).
 */
const US_MEN_EU: Record<string, number> = {
  // ⚠️ IT HAS TO START AT 3, NOT AT 5 (a reviewer's catch). Crocs publishes `US M3W5`…`US M6W8` on
  // 410 products in this catalogue; with the chart starting at 5, `US_MEN_EU['4']` was `undefined`
  // and every one of those shoes silently lost its size facet.
  '3': 35, '3.5': 35.5, '4': 36, '4.5': 36.5, '5': 37.5, '5.5': 38,
  '6': 38.5, '6.5': 39, '7': 40, '7.5': 40.5, '8': 41, '8.5': 42, '9': 42.5, '9.5': 43,
  '10': 44, '10.5': 44.5, '11': 45, '11.5': 45.5, '12': 46, '12.5': 46.5, '13': 47.5, '14': 48.5,
}
const US_WOMEN_EU: Record<string, number> = {
  '4': 34.5, '4.5': 35, '5': 35.5, '5.5': 36, '6': 36.5, '6.5': 37.5, '7': 38, '7.5': 38.5,
  '8': 39, '8.5': 40, '9': 40.5, '9.5': 41, '10': 42, '10.5': 42.5, '11': 43, '12': 44,
}
const UK_MEN_EU: Record<string, number> = {
  '4': 37, '4.5': 37.5, '5': 38.5, '5.5': 39, '6': 39.5, '6.5': 40, '7': 40.5, '7.5': 41.5,
  '8': 42, '8.5': 42.5, '9': 43.5, '9.5': 44, '10': 44.5, '10.5': 45, '11': 46, '11.5': 46.5, '12': 47,
}
const UK_WOMEN_EU: Record<string, number> = {
  '2': 34.5, '2.5': 35, '3': 36, '3.5': 36.5, '4': 37, '4.5': 37.5, '5': 38, '5.5': 38.5,
  '6': 39, '6.5': 40, '7': 40.5, '7.5': 41, '8': 42, '8.5': 42.5, '9': 43,
}

function euBucket(eu: number): string | null {
  if (!Number.isFinite(eu)) return null
  const floor = Math.floor(eu)
  if (floor >= 44) return 'eu-44-plus'
  if (floor < 35) return null
  return `eu-${floor}`
}

export function shoeSizeBuckets(values: string[], gender: SsGender): string[] {
  // Unisex and unstated footwear is listed on the MEN'S US scale by this merchant (Crocs' "US M7W9"
  // spells both out, men first), so that is the chart an unstated product gets.
  const women = gender === 'women' || gender === 'girl'
  const us = women ? US_WOMEN_EU : US_MEN_EU
  const uk = women ? UK_WOMEN_EU : UK_MEN_EU
  const out = new Set<string>()
  for (const raw of values || []) {
    const v = raw.trim().toUpperCase().replace(/\s+/g, ' ')
    let bucket: string | null = null
    let m: RegExpExecArray | null
    if (/^(ONE SIZE|ONESIZE|OS|FREE SIZE)$/.test(v)) bucket = 'free-size'
    else if ((m = /^EU ?(\d{2}(?:\.5)?)$/.exec(v))) bucket = euBucket(Number(m[1]))
    // Crocs dual sizing: "US M7W9" — the men's number, read with the men's chart.
    else if ((m = /^US ?M(\d{1,2}(?:\.5)?)W\d{1,2}(?:\.5)?$/.exec(v))) bucket = euBucket(US_MEN_EU[m[1]])
    /**
     * ⚠️ A SIZE CAN NAME ITS OWN CHART, AND THEN THE TITLE DOES NOT GET A VOTE. Crocs and Teva
     * publish "US W5" / "US M7" (25 products), and a women's clog listed under a unisex title would
     * otherwise be converted on the men's chart — two full EU sizes out.
     */
    else if ((m = /^US ?W(\d{1,2}(?:\.5)?)$/.exec(v))) bucket = euBucket(US_WOMEN_EU[m[1]])
    else if ((m = /^US ?M(\d{1,2}(?:\.5)?)$/.exec(v))) bucket = euBucket(US_MEN_EU[m[1]])
    /**
     * ⛔ UNISEX DUAL SIZING IS MEN'S FIRST, "US 7/8.5" (HOKA, Under Armour — 94 products), AND
     * READING IT THE OTHER WAY ROUND IS A SHOE AND A HALF TOO BIG. The first draft took the second
     * number as the men's size; a reviewer called it, and the catalogue settles it: the same shop
     * spells Crocs out as `US M4W6` — men first, women second — and every dual pair here differs by
     * the 1.5 that separates a men's size from the women's size of the same foot (7 → 8.5). So the
     * FIRST number is the men's one, and it is the one this chart reads. The pair describes ONE
     * shoe, so it produces one bucket rather than two.
     */
    else if ((m = /^US ?(\d{1,2}(?:\.5)?)\/(\d{1,2}(?:\.5)?)$/.exec(v))) bucket = euBucket(US_MEN_EU[m[1]])
    // ⚠️ "US C6" is a CHILD's size and must not fall through to the adult chart.
    else if (/^US ?C\d/.test(v)) bucket = null
    else if ((m = /^US ?(\d{1,2}(?:\.5)?)$/.exec(v))) bucket = euBucket(us[m[1]])
    else if ((m = /^UK ?(\d{1,2}(?:\.5)?)$/.exec(v))) bucket = euBucket(uk[m[1]])
    if (bucket) out.add(bucket)
  }
  return [...out]
}

/**
 * The sizes a shopper can actually buy, listed — "S, M, XL", "US 7, US 8, US 9", "ONE SIZE".
 *
 * ⛔ A LIST, NOT A RANGE, AND THAT IS A CORRECTION. This returned `first–last`, which reads as a
 * continuous run: a shoe with only US 6 and US 12 left rendered "US 6–US 12" and advertised ten
 * sizes nobody could buy (two reviewers, independently). The input is the IN-STOCK size set, which
 * is exactly the set that can have holes in it, so the honest rendering is the set itself.
 * ⚠️ Capped, because this is one row of a spec table: past six sizes it says how many more.
 */
export function sizesLabel(values: string[]): string | null {
  const list = [...new Set((values || []).map((v) => v.trim()).filter(Boolean))]
  if (!list.length) return null
  if (list.length <= 6) return list.join(', ')
  return `${list.slice(0, 6).join(', ')} +${list.length - 6}`
}

/** Everything the importer writes for one product, in one call — so the aisle and the facets can
 *  never be computed from two different readings of the same row. */
export function supersportsFacets(input: {
  productType: string | null | undefined
  enTitle: string
  tags: string[]
  sizes: string[]
  color: string | null | undefined
  /** The Vietnamese title, when the English row is missing — see looksLikeKids. */
  viTitle?: string
  /**
   * ⚠️ THE CALLER KNOWS THIS AND A STRING COMPARISON DOES NOT (a reviewer's catch). This was
   * inferred from `viTitle === enTitle`, which the importer's own 180-char title cap breaks for any
   * longer product name — and a women's shoe that lost its `viOnly` flag was converted on the MEN'S
   * chart, two EU sizes out. Ask the caller instead.
   */
  enMissing?: boolean
}): {
  categorySlug: string
  subcategorySlug: string | null
  group: SsGroup | null
  gender: SsGender
  /** Single-valued facets, for `Listing.attributes`. */
  attributes: Record<string, string>
  /** Multi-valued facets, for `Listing.facetTokens`. */
  facetTokens: string | null
} {
  const { categorySlug, subcategorySlug, group } = placementFor(input.productType, input.enTitle, { tags: input.tags, viTitle: input.viTitle })
  /**
   * ⚠️ THE VIETNAMESE FALLBACK APPLIES ONLY WHEN THERE IS NO ENGLISH ROW — which the importer
   * signals by passing the same string as both titles. An English title that simply states no
   * gender (socks, bags: 1,114 products) keeps saying nothing, as the merchant does.
   */
  const viOnly = input.enMissing ?? (!!input.viTitle && input.viTitle === input.enTitle)
  const gender = genderFromTitle(input.enTitle) ?? (viOnly ? viAdultGender(input.viTitle) : null)
  const kids = looksLikeKids(input.enTitle, input.tags, input.viTitle)
  const color = colorBucketFor(input.color)
  const sports = sportsFor(input.tags, input.productType)
  const sizes = group === 'footwear' ? [] : apparelSizeBuckets(input.sizes)
  const shoeSizes = group === 'footwear' && !kids ? shoeSizeBuckets(input.sizes, gender) : []
  const sizesText = sizesLabel(input.sizes)

  const attributes: Record<string, string> = {}
  // The Kids aisle asks a different question with a different key; the Sports aisle asks `gender`.
  /**
   * ⚠️ `unisex` IS A CLAIM, SO IT IS ONLY MADE WHEN THE MERCHANT MAKES IT (a reviewer's catch). An
   * explicit "Kids'" title means unisex; "Boys'"/"Girls'" — or the Vietnamese "Bé trai"/"Bé gái"
   * when the English row is missing — means that; and a product identified as a child's only by a
   * tag says nothing about who it is for, so neither do we.
   */
  if (kids) {
    const kid = gender === 'boy' || gender === 'girl' ? gender : viKidGender(input.viTitle) ?? (gender === 'kids' ? 'unisex' : null)
    if (kid) attributes.kidsGender = kid
  }
  else if (gender) attributes.gender = gender
  if (color) attributes.color = color
  if (sizesText) attributes.sizes = sizesText

  return {
    categorySlug,
    subcategorySlug,
    group,
    gender,
    attributes,
    // ⚠️ Kids' rows carry their sports and sizes too: the tokens are what a future Kids-aisle facet
    // would read, and writing them now costs nothing. Only the chips that EXIST filter on them.
    facetTokens: buildFacetTokens({ sport: sports, size: sizes, shoeSize: shoeSizes }),
  }
}
