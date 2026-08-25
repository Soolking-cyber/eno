/**
 * Map a merchant's OWN category path onto our taxonomy.
 *
 * ⛔ THE MERCHANT'S BREADCRUMB BEATS EVERY GUESS WE CAN MAKE. Classifying 9,726 products from
 * their titles produced, measured: MacBooks filed under cables-chargers (the title says "70W
 * Charger"), a Kodak microSD card under cables-chargers, iPads under services (the title says
 * "Warranty exchange"), and 1,677 rows with no subcategory at all. CellphoneS already publishes
 * the answer on every product page — "Laptop > ASUS", "Phụ kiện > Ốp lưng | Bao da" — and a
 * retailer is not wrong about what aisle its own product sits in.
 *
 * ⚠️ RULES ARE ORDERED, MOST SPECIFIC FIRST, and matched against the JOINED path. "Phụ kiện"
 * (accessories) is a huge bucket holding cases, chargers, cameras, network gear and AppleCare, so
 * a top-level-only match would be almost useless — the second crumb is what carries the meaning.
 */

export type Placement = { category: string; subcategory: string | null }

type Rule = { match: RegExp; to: Placement }

/**
 * ⚠️ "Hàng cũ" (second-hand) IS NOT A CATEGORY, IT IS A CONDITION. The merchant files used stock
 * in its own tree, so "Hàng cũ > iPhone cũ" must land in phones-tablets like any other phone —
 * otherwise every used product becomes unfindable under the category a shopper browses. The
 * used-ness is carried by `Listing.condition`, which the importer already sets.
 */
const RULES: Rule[] = [
  // ── Used stock, routed by what the thing IS ────────────────────────────────
  { match: /hàng cũ.*(iphone|điện thoại|samsung|android|oppo|xiaomi)/i, to: { category: 'electronics', subcategory: 'phones-tablets' } },
  { match: /hàng cũ.*(ipad|máy tính bảng)/i, to: { category: 'electronics', subcategory: 'phones-tablets' } },
  { match: /hàng cũ.*laptop|hàng cũ.*macbook/i, to: { category: 'electronics', subcategory: 'laptops-pcs' } },
  { match: /hàng cũ.*(đồng hồ|watch)/i, to: { category: 'electronics', subcategory: 'smartwatch' } },
  { match: /hàng cũ.*(tai nghe|loa|âm thanh)/i, to: { category: 'electronics', subcategory: 'audio' } },
  { match: /hàng cũ.*phụ kiện/i, to: { category: 'electronics', subcategory: 'accessories' } },

  // ── Service products (a warranty plan or a SIM plan is genuinely a service) ─
  { match: /apple\s?care|samsung care|bảo hành mở rộng|gói bảo hành/i, to: { category: 'services', subcategory: null } },
  { match: /\bsim\b|gói cước|nạp tiền|phần mềm|office|windows|bản quyền/i, to: { category: 'services', subcategory: null } },

  // ── Accessories: the second crumb is the whole meaning ─────────────────────
  { match: /ốp lưng|bao da|case điện thoại/i, to: { category: 'electronics', subcategory: 'phone-cases' } },
  { match: /dán (điện thoại|màn hình|laptop)|cường lực|miếng dán/i, to: { category: 'electronics', subcategory: 'screen-protectors' } },
  { match: /chuột|bàn phím/i, to: { category: 'electronics', subcategory: 'keyboards-mice' } },
  { match: /sạc|cáp|adapter|củ sạc/i, to: { category: 'electronics', subcategory: 'cables-chargers' } },
  { match: /balo|túi xách|túi chống sốc|cặp laptop/i, to: { category: 'electronics', subcategory: 'bags-sleeves' } },
  { match: /pin dự phòng|sạc dự phòng/i, to: { category: 'electronics', subcategory: 'power-banks' } },
  { match: /thẻ nhớ|usb|ổ cứng|ssd|hdd/i, to: { category: 'electronics', subcategory: 'storage' } },
  { match: /thiết bị mạng|router|wifi|modem/i, to: { category: 'electronics', subcategory: 'networking' } },
  { match: /máy in|máy scan/i, to: { category: 'electronics', subcategory: 'printers' } },
  { match: /camera|máy ảnh|webcam|flycam/i, to: { category: 'electronics', subcategory: 'cameras' } },

  // ── Core device families ──────────────────────────────────────────────────
  /*
   * ⚠️ ANCHORED. `/^laptop|macbook/` parses as `(^laptop)|(macbook)`, so a bare "macbook" would
   * match ANYWHERE in the path — filing a "Đế tản nhiệt Macbook" (laptop stand) as a laptop.
   * Measured across the whole crawl: 0 paths were actually misfiled, because the accessory rules
   * above win first. Anchored anyway — that safety is an accident of rule order, and rule order is
   * exactly the thing a later edit changes without noticing.
   */
  { match: /^laptop\b|^macbook/i, to: { category: 'electronics', subcategory: 'laptops-pcs' } },
  { match: /^tivi|^smart tivi|android tivi/i, to: { category: 'electronics', subcategory: 'tv-monitors' } },
  { match: /^màn hình/i, to: { category: 'electronics', subcategory: 'tv-monitors' } },
  { match: /^điện thoại|^máy tính bảng|^ipad/i, to: { category: 'electronics', subcategory: 'phones-tablets' } },
  { match: /đồng hồ thông minh|smartwatch|apple watch|vòng đeo tay/i, to: { category: 'electronics', subcategory: 'smartwatch' } },
  { match: /^đồng hồ/i, to: { category: 'electronics', subcategory: 'smartwatch' } },
  { match: /^âm thanh|tai nghe|^loa\b/i, to: { category: 'electronics', subcategory: 'audio' } },
  { match: /gaming gear|máy chơi game|playstation|nintendo/i, to: { category: 'electronics', subcategory: 'gaming' } },
  // PC components (RAM sticks, CPUs, mainboards) have no home of their own; "accessories" is the
  // honest bucket rather than inventing a subcategory for a few dozen products.
  { match: /linh kiện máy tính/i, to: { category: 'electronics', subcategory: 'accessories' } },
  { match: /nhà thông minh|smart home/i, to: { category: 'electronics', subcategory: 'accessories' } },

  // ── Not electronics at all ────────────────────────────────────────────────
  { match: /điều hòa|máy lạnh|máy giặt|tủ lạnh|máy rửa|quạt điều hòa/i, to: { category: 'furniture-appliances', subcategory: 'white-goods' } },
  { match: /đồ gia dụng|nồi cơm|nhà bếp|bình giữ nhiệt|máy xay|nồi chiên/i, to: { category: 'furniture-appliances', subcategory: 'kitchenware' } },
  { match: /đèn|trang trí/i, to: { category: 'furniture-appliances', subcategory: 'lighting-decor' } },
  { match: /chăm sóc sức khỏe|làm đẹp|máy massage|máy cạo râu/i, to: { category: 'fashion-beauty', subcategory: null } },

  // Deliberately last: "Phụ kiện" with nothing more specific above it.
  { match: /^phụ kiện/i, to: { category: 'electronics', subcategory: 'accessories' } },
]

/**
 * Resolve a merchant breadcrumb path to a placement, or null when no rule is confident.
 * ⚠️ RETURNS NULL RATHER THAN GUESSING. An unmatched path leaves the listing exactly as it is;
 * a wrong confident answer is worse than no answer, because nothing downstream will revisit it.
 */
export function placementForCrumbs(crumbs: string[]): Placement | null {
  const path = crumbs.filter((c) => c && c !== 'Root').join(' > ')
  if (!path) return null
  for (const r of RULES) if (r.match.test(path)) return r.to
  return null
}

/**
 * Correct a placement from the TITLE alone, for rows the breadcrumb crawl has not reached yet.
 *
 * ⛔ "CASE" IS THE WORD THAT BREAKS TITLE CLASSIFICATION. An Apple Watch is sold as
 * "Apple Watch SE 3 40mm (5G) Aluminum Case Rubber Band" — the case is the watch's BODY — so a
 * keyword classifier files it under phone cases and the Cases & covers aisle fills with watches
 * (owner, 2026-08-25: "apple watches in cases subcategory"). The same trap catches
 * "Galaxy Watch … Case" and "Keyboard + Case" tablet bundles.
 *
 * ⚠️ DELIBERATELY NARROW. This is not a second classifier; it only overrides a placement that is
 * demonstrably wrong from an unambiguous product name. Returns null when it has nothing to say,
 * so the breadcrumb (when it arrives) stays the authority.
 */
export function placementFromTitle(title: string, current: Placement): Placement | null {
  const t = ` ${title} `
  // A named smartwatch with a case size is a watch, whatever else the title mentions.
  if (/\b(apple watch|galaxy watch|watch ultra|huawei watch|garmin|amazfit)\b/i.test(t) && /\b\d{2}\s?mm\b/i.test(t)) {
    return current.subcategory === 'smartwatch' ? null : { category: 'electronics', subcategory: 'smartwatch' }
  }
  return null
}
