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

/**
 * ⛔ `vague: true` MARKS A RULE THAT MATCHED A DEPARTMENT, NOT A PRODUCT TYPE, and it is the only
 * thing that may be overridden by the title. "Hàng cũ > Đồ gia dụng cũ" is TRUE and says nothing —
 * the same two crumbs carry a rice cooker and a robot vacuum. Everything else here names what the
 * thing IS, and a title guess must never argue with it.
 *
 * ⚠️ THIS DISTINCTION IS WHY THE TITLE OVERRIDE STOPPED BEING WHACK-A-MOLE. Letting the title beat
 * ANY breadcrumb produced a new hole on every review round — "Smartwatch band for Apple Watch 45mm",
 * "Kính cường lực Apple Watch Series 10", "Hàng cũ > Phụ kiện cũ > Bao da iPad" — each one a case
 * where the crumb was already right and a keyword rule talked over it. Narrowing the override to
 * vague rules closes all of them at once, because in every one of those the crumb is specific.
 */
type Rule = { match: RegExp; to: Placement; vague?: boolean }

/**
 * ⚠️ "Hàng cũ" (second-hand) IS NOT A CATEGORY, IT IS A CONDITION. The merchant files used stock
 * in its own tree, so "Hàng cũ > iPhone cũ" must land in phones-tablets like any other phone —
 * otherwise every used product becomes unfindable under the category a shopper browses. The
 * used-ness is carried by `Listing.condition`, which the importer already sets.
 */
const RULES: Rule[] = [
  /**
   * ── Used stock, routed by what the thing IS ─────────────────────────────────
   *
   * ⛔ THE PRODUCT-TYPE RULES MUST COME BEFORE THE BRAND CATCH-ALL, because the LAST crumb is
   * often a BRAND and `.*` reaches it. "Hàng cũ > Đồng hồ thông minh cũ > Xiaomi" is a used
   * SMARTWATCH, but `hàng cũ.*xiaomi` matched the brand at the end and filed 30 watches — Garmin,
   * Huawei, Oppo, Xiaomi — into phones-tablets. The owner saw them in the wrong aisle.
   *
   * The merchant's shape, measured over 2,184 used listings and 164 distinct paths: the SECOND
   * crumb is the product type, and a brand sits either at position 2 ("Hàng cũ > Samsung cũ >
   * Galaxy S cũ" — genuinely phones) or at position 3 under a type ("… > Máy ảnh cũ > Sony" — a
   * camera). Only ordering separates those two, so the brand rule is deliberately LAST: it is a
   * fallback for "the second crumb is just a phone brand", not a classifier.
   */
  // ⚠️ Watch ACCESSORIES before watches, for the same reason as the new-goods block below:
  // "Hàng cũ > Phụ kiện cũ > Dây đồng hồ" is a used strap, and `hàng cũ.*đồng hồ` reaches it.
  /**
   * ⛔ ACCESSORY SUB-TYPES COME FIRST, ABOVE THE DEVICE RULES. "Hàng cũ > Phụ kiện cũ > Bao da iPad"
   * is a used iPad SLEEVE, and `hàng cũ.*ipad` reaches it — so a case, a cable, a memory card or a
   * keyboard named after the device it fits was filed AS that device. Same shape as every other bug
   * in this file: a broad rule listed above a specific one wins forever.
   * ⚠️ Watch accessories lead the group, because "dây đồng hồ" contains "đồng hồ".
   */
  { match: /hàng cũ.*(dây đồng hồ|dây da|phụ kiện.*watch|phụ kiện đồng hồ|ốp đồng hồ)/i, to: { category: 'electronics', subcategory: 'accessories' } },
  { match: /hàng cũ.*(pin sạc dự phòng|sạc dự phòng|pin dự phòng)/i, to: { category: 'electronics', subcategory: 'power-banks' } },
  { match: /hàng cũ.*(cáp|củ sạc|adapter|\bsạc\b)/i, to: { category: 'electronics', subcategory: 'cables-chargers' } },
  { match: /hàng cũ.*(thẻ nhớ|ổ cứng|ssd|hdd)/i, to: { category: 'electronics', subcategory: 'storage' } },
  { match: /hàng cũ.*(chuột|bàn phím)/i, to: { category: 'electronics', subcategory: 'keyboards-mice' } },
  { match: /hàng cũ.*(ốp lưng|bao da)/i, to: { category: 'electronics', subcategory: 'phone-cases' } },

  // Then the devices themselves.
  // ⚠️ MEASURED, NOT GUESSED: 66 listings across 10 paths ("Hàng cũ > Màn hình cũ > Màn hình LG cũ",
  // "Hàng cũ > Tivi cũ") matched NO used rule — the new-goods `^tivi` and `^màn hình` rules are
  // anchored, so a "Hàng cũ >" prefix skips them entirely and the rows kept whatever they had.
  { match: /hàng cũ.*(tivi|màn hình|monitor)/i, to: { category: 'electronics', subcategory: 'tv-monitors' } },
  { match: /hàng cũ.*(đồng hồ|watch|vòng đeo tay)/i, to: { category: 'electronics', subcategory: 'smartwatch' } },
  { match: /hàng cũ.*(tai nghe|loa\b|âm thanh)/i, to: { category: 'electronics', subcategory: 'audio' } },
  { match: /hàng cũ.*(máy ảnh|camera|lens|flycam)/i, to: { category: 'electronics', subcategory: 'cameras' } },
  { match: /hàng cũ.*(laptop|macbook)/i, to: { category: 'electronics', subcategory: 'laptops-pcs' } },
  { match: /hàng cũ.*(ipad|máy tính bảng)/i, to: { category: 'electronics', subcategory: 'phones-tablets' } },

  // Home appliances, specific before the department.
  { match: /hàng cũ.*(máy giặt|tủ lạnh|điều hòa|máy lạnh)/i, to: { category: 'furniture-appliances', subcategory: 'white-goods' } },
  { match: /hàng cũ.*(nhà bếp|nồi|bếp)/i, to: { category: 'furniture-appliances', subcategory: 'kitchenware' } },
  { match: /hàng cũ.*(nhà thông minh|smart home)/i, to: { category: 'electronics', subcategory: 'accessories' }, vague: true },

  // ⚠️ VAGUE: "used home appliance" is a department, not a product type. This is the rule that hid
  // 30+ robot vacuums, air purifiers and humidifiers in the kitchen aisle, so the TITLE may
  // correct it — see the note on `Rule`. It is one of only four rules that may be overridden.
  { match: /hàng cũ.*đồ gia dụng/i, to: { category: 'furniture-appliances', subcategory: 'kitchenware' }, vague: true },

  // ⚠️ VAGUE: "used accessory" names no product type either.
  { match: /hàng cũ.*phụ kiện/i, to: { category: 'electronics', subcategory: 'accessories' }, vague: true },

  // ⚠️ LAST — `samsung|oppo|xiaomi` here are BRANDS, kept only because the merchant files used
  // phones under a bare brand crumb ("Hàng cũ > Samsung cũ"). A fallback, never a classifier.
  { match: /hàng cũ.*(iphone|điện thoại|samsung|android|oppo|xiaomi|realme|vivo|nokia)/i, to: { category: 'electronics', subcategory: 'phones-tablets' } },

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
  /**
   * ⛔ A WATCH STRAP AISLE SITS *INSIDE* THE WATCH AISLE, so the strap rule must come first. The
   * merchant's own path is "Đồng hồ thông minh > Dây đồng hồ" — smartwatches › watch bands — and
   * the broad rule below matches that first crumb, so 35 Spigen and Apple bands were filed as
   * SMARTWATCHES. Third time this exact shape appeared (see the used-stock and home-appliance
   * blocks): a department word listed above the specific thing underneath it wins forever.
   */
  { match: /dây đồng hồ|dây da đồng hồ|phụ kiện apple watch|phụ kiện đồng hồ|ốp đồng hồ/i, to: { category: 'electronics', subcategory: 'accessories' } },
  { match: /đồng hồ thông minh|smartwatch|apple watch|vòng đeo tay/i, to: { category: 'electronics', subcategory: 'smartwatch' } },
  { match: /^đồng hồ/i, to: { category: 'electronics', subcategory: 'smartwatch' } },
  { match: /^âm thanh|tai nghe|^loa\b/i, to: { category: 'electronics', subcategory: 'audio' } },
  { match: /gaming gear|máy chơi game|playstation|nintendo/i, to: { category: 'electronics', subcategory: 'gaming' } },
  // PC components (RAM sticks, CPUs, mainboards) have no home of their own; "accessories" is the
  // honest bucket rather than inventing a subcategory for a few dozen products.
  { match: /linh kiện máy tính/i, to: { category: 'electronics', subcategory: 'accessories' } },
  /**
   * ⛔ APPLIANCES BEFORE "Nhà thông minh", WHICH IS A DEPARTMENT. The merchant's own path is
   * "Nhà thông minh > Máy hút bụi > Robot hút bụi > Roborock" — smart home › VACUUM CLEANER › robot
   * vacuum — and it could not be more specific about what the thing is. But `nhà thông minh` matched
   * the first crumb, so 188 robot vacuums, handheld vacuums and air purifiers were filed as
   * accessories. Fifth instance of this exact shape in this file; the ordering IS the logic.
   */
  /**
   * ⛔ `bàn là(?=\s|$)` — "bàn là" (an IRON) is a PREFIX of "bàn làm việc" (a DESK), so the bare
   * form matched "Phụ kiện > Decor - Setup bàn làm việc" and filed 31 desk-setup accessories as
   * home appliances. `\b` cannot help: `à` is not a word character to JS. Same family as the `ốp`
   * note above, and the reason every Vietnamese token here is anchored explicitly.
   */
  { match: /quạt(?!\s*tản nhiệt)|bàn ủi|bàn là(?=\s|$)|cây nước|máy hút ẩm|máy lọc không khí|máy hút bụi|robot hút bụi/i, to: { category: 'furniture-appliances', subcategory: 'white-goods' } },
  { match: /máy cạo râu|máy massage|máy sấy tóc|chăm sóc sức khỏe|làm đẹp/i, to: { category: 'fashion-beauty', subcategory: 'beauty' } },

  // ⚠️ VAGUE: "smart home" is a department — a path that stops here has named no product.
  { match: /nhà thông minh|smart home/i, to: { category: 'electronics', subcategory: 'accessories' }, vague: true },

  // ── Not electronics at all ────────────────────────────────────────────────
  /**
   * ⛔ PERSONAL CARE AND NON-KITCHEN APPLIANCES MUST BE MATCHED BEFORE `đồ gia dụng`, which is the
   * merchant's whole home-appliance department and swallows everything under it. Measured over the
   * ~1,200 listings in that department: `Đồ gia dụng > Quạt` (147 fans), `> Bàn ủi` (83 irons),
   * `> Máy cạo râu` (77 shavers) and `> Cây nước nóng lạnh` (72 water dispensers) were all filed as
   * KITCHENWARE. The shaver rule further down already said fashion-beauty and simply never got a
   * turn — first match wins, and the broad rule was first. Same failure as the used-stock block.
   * `white-goods` is the right home for the rest: its label is "Appliances / Điện máy", not
   * laundry-specific, while `kitchenware` is "Kitchen / Đồ bếp".
   */
  // ⚠️ `quạt` EXCEPT a cooling fan — a crumb like "Phụ kiện > Quạt tản nhiệt CPU"
  // is a PC cooler, and the title override cannot rescue it because a null title verdict falls
  // back to exactly this breadcrumb result. Same narrowing as the fan rule in placementFromTitle.
  { match: /điều hòa|máy lạnh|máy giặt|tủ lạnh|máy rửa/i, to: { category: 'furniture-appliances', subcategory: 'white-goods' } },
  // Kitchen proper — the appliances that cook, boil, blend or store food.
  { match: /nồi cơm|nồi nấu|nhà bếp|bình giữ nhiệt|máy xay|nồi chiên|ấm siêu tốc|\bbếp\b|lò vi sóng|lò nướng|máy ép|máy làm sữa/i, to: { category: 'furniture-appliances', subcategory: 'kitchenware' } },
  // ⚠️ VAGUE: the bare department word, after every specific appliance above has had its turn.
  { match: /đồ gia dụng/i, to: { category: 'furniture-appliances', subcategory: 'kitchenware' }, vague: true },
  { match: /đèn|trang trí/i, to: { category: 'furniture-appliances', subcategory: 'lighting-decor' } },
  { match: /chăm sóc sức khỏe|làm đẹp|máy massage|máy cạo râu/i, to: { category: 'fashion-beauty', subcategory: 'beauty' } },

  // Deliberately last: "Phụ kiện" with nothing more specific above it.
  // ⚠️ VAGUE: the catch-all accessory department.
  { match: /^phụ kiện/i, to: { category: 'electronics', subcategory: 'accessories' }, vague: true },
]

/**
 * Resolve a merchant breadcrumb path to a placement, or null when no rule is confident.
 * ⚠️ RETURNS NULL RATHER THAN GUESSING. An unmatched path leaves the listing exactly as it is;
 * a wrong confident answer is worse than no answer, because nothing downstream will revisit it.
 */
export function placementForCrumbs(crumbs: string[]): Placement | null {
  return matchCrumbs(crumbs)?.to ?? null
}

/**
 * The same match, plus whether the rule that produced it was a DEPARTMENT rather than a product
 * type. Only a `vague` result may be overridden by `placementFromTitle` — see the note on `Rule`.
 */
export function matchCrumbs(crumbs: string[]): { to: Placement; vague: boolean } | null {
  const path = crumbs.filter((c) => c && c !== 'Root').join(' > ')
  if (!path) return null
  for (const r of RULES) if (r.match.test(path)) return { to: r.to, vague: r.vague === true }
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
  const same = (to: Placement) =>
    to.category === current.category && to.subcategory === current.subcategory ? null : to

  /**
   * ⛔ A WARRANTY PLAN NAMES ITS DEVICE, AND IT IS STILL A SERVICE. "Samsung Care+ Package 6 for
   * Samsung Galaxy Watch 7 40mm" reads to a keyword rule as a 40mm Galaxy Watch — nine of them
   * would have been dragged out of `services` into the Smartwatch aisle.
   */
  if (/\bcare\s?\+|applecare|samsung care|\bwarranty\b|bảo hành|gói bảo hành/i.test(t)) return null

  /**
   * ⛔ AND THIS GUARD RUNS BEFORE EVERY RULE, NOT BETWEEN THEM. It sat below the watch rule, so it
   * protected the appliance branch and nothing else — an "Apple Watch 45mm charging dock" was still
   * a smartwatch. A thing sold FOR a device is never that device, whichever rule would claim it.
   * ⚠️ `cabinet` is here because of a dry cabinet: "Andbon AD-30S Camera Dehumidifier Cabinet" is
   * camera storage — the dehumidifier is the FEATURE — and nine would have left the Cameras aisle.
   */
  if (/\b(filter|replacement|cover|mount|holder|dock|sleeve|pouch|bag|cabinet|charger|cable)\b|tủ chống ẩm|kính cường lực|miếng dán|dán cường lực|tempered glass|screen protector/i.test(t)) return null

  /**
   * ⛔ A WATCH BAND IS NOT A WATCH, AND NEITHER THE NOUN NOR THE MODEL NAME DECIDES IT.
   * "Apple Watch SE 3 40mm (5G) Aluminum Case Rubber Band" IS a watch — rescuing it from the Cases
   * aisle is why this function exists — while "Apple Watch Ultra 49mm Ocean Band" is a strap. Both
   * end in "Band", both name ONE size, and both carry a model word, so all three of those signals
   * are useless on their own.
   *
   * ⚠️ A "model marker OR no accessory noun" test was tried and is WRONG — two reviewers caught it
   * independently. Any band that advertises its compatibility ("Galaxy Watch7 Sport Band 44mm",
   * "Spigen Rugged Armor for Apple Watch Series 10 46mm") carries a model word, which cancelled the
   * accessory guard and would have dragged the 35 bands the breadcrumb rule just rescued straight
   * back into the Smartwatch aisle. Every band case in the test file happened to lack a model word,
   * so the tests agreed with the bug.
   *
   * What actually separates them is the WATCH BODY: a watch is sold by its case material, or says
   * "smartwatch". A band never mentions a case material, because it has no case. That is a positive
   * signal the accessory genuinely cannot have, rather than one more noun to enumerate.
   */
  const watchBody = /\b(aluminum|aluminium|stainless steel|titanium|ceramic|nhôm|thép không gỉ) case\b|smartwatch|đồng hồ thông minh/i.test(t)
  /**
   * ⚠️ NO TRAILING `\b` AFTER `watch` HERE EITHER — "for Galaxy Watch7" puts a digit there, the same
   * trap called out on the model-name line below. Neither shape exists in the catalogue today (0
   * listings, measured), which is exactly why it would have sat here unnoticed until it did.
   * `dây da` / `ốp` mirror the Vietnamese tokens the breadcrumb rule already recognises.
   * ⛔ AND `ốp` IS ANCHORED ON WHITESPACE, NOT `\b`. I wrote `\bốp\b` here and regex-lint caught it
   * within the minute: `ố` is not a word character to JS, so that boundary can NEVER match and the
   * guard would have been silently off. Ninth instance of this trap in this codebase, first one
   * caught by the linter instead of by a human reading wrong output.
   */
  const watchAccessory = /\bstrap\b|\bband\b|\bloop\b|\d{2}\s?\/\s?\d{2}|\b(for|cho)\b[^,]{0,30}\bwatch|dây (đeo|da|silicone|thép)|(^|\s)ốp\s/i.test(t)
  if ((watchBody || !watchAccessory)
    /**
     * ⚠️ NO TRAILING `\b` AFTER THE MODEL NAMES — "Galaxy Watch9" puts a DIGIT right after "watch",
     * and `\b` needs a non-word character there, so `\bgalaxy watch\b` could never match Samsung's
     * current line. Same family as the boundary traps regex-lint exists to catch.
     */
    && /\b(apple watch|galaxy watch|watch ultra|huawei watch|garmin|amazfit)/i.test(t)
    && /\b\d{2}\s?mm\b|smartwatch/i.test(t)) {
    return same({ category: 'electronics', subcategory: 'smartwatch' })
  }

  /**
   * ⛔ A DEPARTMENT-LEVEL BREADCRUMB IS NOT AN ANSWER ABOUT PRODUCT TYPE, and this is the case that
   * proves it. "Hàng cũ > Đồ gia dụng cũ" says only "used home appliance" — the same two crumbs
   * carry a rice cooker and a robot vacuum — so 30+ robot vacuums, air purifiers and humidifiers
   * sat in the KITCHEN aisle behind a breadcrumb that was never wrong, just silent.
   * ⚠️ The nouns are deliberately unambiguous: "iron" is spelled `steam iron` / `bàn ủi`, never
   * bare, and the fan patterns name household fan TYPES — see the note on that line.
   */
  const APPLIANCE: Array<[RegExp, Placement]> = [
    [/\b(robot |handheld |cordless )?vacuum cleaner\b|\bvacuum mop\b|máy hút bụi|robot hút bụi/i, { category: 'furniture-appliances', subcategory: 'white-goods' }],
    [/\bair purifier\b|máy lọc không khí/i, { category: 'furniture-appliances', subcategory: 'white-goods' }],
    [/\b(de)?humidifier\b|máy hút ẩm|máy tạo ẩm/i, { category: 'furniture-appliances', subcategory: 'white-goods' }],
    /**
     * ⚠️ `quạt` MINUS COOLING FANS — "Quạt tản nhiệt CPU" and "quạt tản nhiệt điện thoại" are
     * PC and phone accessories with perfectly good breadcrumbs, and this override now beats the
     * breadcrumb, so a bare match would have hauled them into Home Appliances. ⚠️ An earlier fix
     * enumerated household fan TYPES instead (`quạt đứng|treo|...`) and broke the plain crumb
     * "Đồ gia dụng > Quạt", sending 55 real fans back to the kitchen. Exclude the exception,
     * do not enumerate the rule.
     */
    [/\b(floor|stand|tower|ceiling|electric|box|desk|pedestal) fan\b|quạt(?!\s*tản nhiệt)/i, { category: 'furniture-appliances', subcategory: 'white-goods' }],
    [/\b(steam|clothes) iron\b|bàn ủi|bàn là(?=\s|$)/i, { category: 'furniture-appliances', subcategory: 'white-goods' }],
    [/\bwater dispenser\b|cây nước nóng lạnh/i, { category: 'furniture-appliances', subcategory: 'white-goods' }],
    /**
     * ⚠️ `beauty`, NOT a bare `fashion-beauty` with no subcategory. A row with a null subcategory
     * appears under no filter chip at all, so "move it to fashion-beauty" would have quietly made
     * 46 shavers and hair dryers HARDER to find than they were in the wrong aisle.
     */
    [/\b(shaver|hair dryer|hair clipper)\b|máy cạo râu|máy sấy tóc/i, { category: 'fashion-beauty', subcategory: 'beauty' }],
  ]
  for (const [re, to] of APPLIANCE) if (re.test(t)) return same(to)
  return null
}
