/**
 * Work out which BRAND a merchant product belongs to, from its title.
 *
 * ⛔ WHY THE IMPORTER'S VERSION WAS NOT ENOUGH. It matched a hardcoded list of 19 brand NAMES
 * against the title, so anything whose title names a product LINE rather than its maker came back
 * null — an "iPhone 16 Pro Max" never contains the word "Apple". Measured on the live catalogue:
 * 6,470 of 9,726 products (67%) had no brand at all, including 267 of the 274 iPhones. The brand
 * rail is the main way anyone narrows 9,726 products, and two thirds of the stock was invisible to
 * it (owner, 2026-08-25: "i chose phones and apple but cant see iphone models").
 *
 * ⛔ THE HARD PART IS THAT AN ACCESSORY NAMES TWO BRANDS. "Spigen Core Armor Case for iPhone 16"
 * is a SPIGEN product that FITS an Apple one. Mapping "iphone" to Apple everywhere would file every
 * third-party case under Apple and make the brand filter worse than useless — the opposite of the
 * complaint. So the device-line map is consulted ONLY where the product IS the device; on an
 * accessory the compatibility is already carried by the `compatibleWith` spec, which exists for
 * exactly this.
 */

/** Subcategories where the product is an accessory FOR something else. */
const ACCESSORY_SUBCATS = new Set([
  'phone-cases', 'screen-protectors', 'bags-sleeves', 'cables-chargers', 'accessories', 'power-banks',
])

/**
 * Product line → maker, for titles that never name the maker.
 * ⚠️ Ordered longest-first at match time so "galaxy tab" wins over "galaxy".
 */
/**
 * ⛔ EVERY ENTRY MUST BE A WORD THAT MEANS NOTHING ELSE. The first version mapped Dell's "Precision"
 * line and immediately filed a "Tefal Easy Fry + Grill Precision EY505815 Air Fryer" as a Dell.
 * The same trap was waiting in `gram` (LG's laptop, and the unit of mass), `latitude`, `surface`,
 * `switch`, `envy`, `swift`, `predator`, `creator`, `prestige` and `pixel` — all ordinary English
 * or ordinary product words. They are dropped rather than tightened: a line word only matters when
 * the brand NAME is absent from the title, and "Dell Precision" or "LG Gram" almost always says
 * the brand. Losing a handful of correct matches is the cheap side of this trade; a wrong brand
 * hides a product from the filter it belongs in and pollutes the one it does not.
 */
const LINES: [RegExp, string][] = [
  [/\b(iphone|ipad|macbook|imac|mac mini|mac studio|airpods|airtag|apple watch|applecare)\b/i, 'apple'],
  [/\b(galaxy|samsung care)\b/i, 'samsung'],
  [/\b(redmi|poco|mi band|mi pad)\b/i, 'xiaomi'],
  [/\b(thinkpad|ideapad|yoga slim|legion|loq)\b/i, 'lenovo'],
  [/\b(vivobook|zenbook|expertbook|proart|tuf gaming|rog )\b/i, 'asus'],
  [/\b(pavilion|victus|elitebook|probook)\b/i, 'hp'],
  [/\b(inspiron|vostro|alienware)\b/i, 'dell'],
  [/\b(aspire|travelmate)\b/i, 'acer'],
  [/\b(katana|cyborg)\b/i, 'msi'],
  [/\b(xbox|surface pro|surface laptop|surface go)\b/i, 'microsoft'],
  [/\b(playstation|dualsense|ps5|bravia|walkman|wh-\d|wf-\d)\b/i, 'sony'],
  [/\b(nintendo|switch oled)\b/i, 'nintendo'],
  [/\b(meta quest|quest \d)\b/i, 'meta'],
  [/\b(google pixel|pixel \d|nest hub|chromecast)\b/i, 'google'],
  [/\b(reno\d|find x)\b/i, 'oppo'],
  [/\bnord \d\b/i, 'oneplus'],
  [/\b(matebook|matepad|freebuds)\b/i, 'huawei'],
]

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Makers whose NAME also appears on other people's accessories.
 * ⛔ WITHOUT THIS, "Spigen case for Samsung Galaxy S26" RESOLVES TO SAMSUNG — both names are in the
 * title and "samsung" is the longer string, so longest-first picks the wrong one. The earlier
 * accessory guard only covered the LINE map ("iphone"), so the trap survived wherever the device
 * maker's name is written out. Every Android accessory in the catalogue was exposed to it, and the
 * tests missed it because they all used iPhone — a word that does not literally contain "apple".
 */
const DEVICE_MAKERS = new Set([
  'apple', 'samsung', 'xiaomi', 'lenovo', 'asus', 'hp', 'dell', 'acer', 'msi', 'microsoft',
  'sony', 'nintendo', 'meta', 'google', 'oppo', 'oneplus', 'huawei', 'lg', 'vivo', 'realme',
  'honor', 'nokia', 'nothing', 'tecno', 'infinix',
])

/**
 * @param known every brand slug the catalogue knows, so a name in the title resolves to the SAME
 *   brand a human would have picked from the directory rather than to a new near-duplicate.
 * @returns a brand slug, or null when nothing is certain. ⛔ Null is a real answer: a wrong brand
 *   is worse than none, because it puts the product in a filter where nobody looking for it will be
 *   and hides it from the one where they are.
 */
export function inferBrand(
  title: string,
  titleVi: string | null,
  subcategorySlug: string | null,
  known: Iterable<string>,
): string | null {
  /**
   * ⛔ PLATFORM NAMES ARE NOT MAKERS. Vietnamese TV listings are titled "Google Tivi Sony 55 inch"
   * or "Android Tivi TCL" — the first word is the OPERATING SYSTEM. Matching brand names naively
   * filed 22 Sony televisions under Google, because "google" is a longer string than "sony" and
   * both were in the title. The platform phrase is removed before anything else looks at the text;
   * a genuine Google device ("Google Pixel", "Google Nest Hub") never says "tivi"/"tv" next to it.
   */
  const hay = ` ${title} ${titleVi ?? ''} `
    .toLowerCase()
    .replace(/\b(google|android|smart|coocaa)\s+(tivi|tv)\b/g, ' ')

  /**
   * A brand NAME written in the title always wins, whatever the product is — it is the strongest
   * evidence there is, and it is what makes "Spigen … for iPhone" a Spigen product.
   * ⚠️ LONGEST FIRST: "asus rog" must not resolve to a hypothetical "as" brand, and a two-word
   * brand must beat a one-word substring of it.
   */
  const names = [...known].filter((b) => b.length >= 2).sort((a, b) => b.length - a.length)
  const matches = names.filter((slug) => {
    // The slug is the brand's canonical form; match it as whole words, hyphen or space separated.
    const pattern = esc(slug).replace(/-/g, '[\\s-]?')
    return new RegExp(`\\b${pattern}\\b`, 'i').test(hay)
  })
  const isAccessory = !!subcategorySlug && ACCESSORY_SUBCATS.has(subcategorySlug)
  if (matches.length) {
    /**
     * ⚠️ ON AN ACCESSORY, A NON-DEVICE MAKER WINS. "Spigen case for Samsung Galaxy S26" names both;
     * the product is Spigen's and the Samsung is compatibility. A device maker is still returned
     * when it is the ONLY match, because Apple and Samsung do sell their own cases.
     */
    if (isAccessory) {
      const thirdParty = matches.find((m) => !DEVICE_MAKERS.has(m))
      if (thirdParty) return thirdParty
      /**
       * ⛔ A DEVICE MAKER NAMED ONLY AFTER "FOR" IS COMPATIBILITY, NOT AUTHORSHIP.
       * "Case for Samsung Galaxy S26" is somebody's case; "Samsung Silicone Case for Galaxy S26" is
       * Samsung's. The preposition is the whole difference, and it is the same word in Vietnamese
       * ("cho", "dành cho"). If the maker's name appears ONLY on the compatibility side, we do not
       * know who made it — and null is the honest answer.
       */
      const soleMaker = matches[0]
      const pattern = esc(soleMaker).replace(/-/g, '[\\s-]?')
      const anywhere = new RegExp(`\\b${pattern}\\b`, 'i')
      // ⚠️ `\S` NOT `\w`. JS character classes are ASCII-only, so `[\w\d-]+` cannot cross
      // "điện thoại" — "Ốp lưng cho điện thoại Samsung" slipped the guard and became a Samsung
      // product. Ninth time this trap has appeared in this codebase.
      const afterFor = new RegExp(`\\b(for|cho|dành cho|danh cho)\\s+(?:\\S+\\s+){0,3}${pattern}\\b`, 'i')
      const beforeFor = hay.split(/\b(?:for|cho|dành cho|danh cho)\b/i)[0]
      if (afterFor.test(hay) && !anywhere.test(beforeFor)) return null
    }
    return matches[0]
  }

  /**
   * ⛔ ONLY NOW, AND ONLY IF THE PRODUCT IS THE DEVICE. On an accessory the device name is a
   * compatibility statement, not a maker — see the file header.
   */
  if (isAccessory) return null
  for (const [re, slug] of LINES) if (re.test(hay)) return slug
  return null
}

/** The brand slugs `inferBrand` can produce from a product line, for seeding the Brand table. */
export function lineBrandSlugs(): string[] {
  return [...new Set(LINES.map(([, slug]) => slug))]
}
