/**
 * ⛔ PURE LITERALS, ZERO IMPORTS — this file must stay import-free. It exists so `src/lib/handle-format.ts`
 * (pulled into the CLIENT bundle via next.config.ts → root-segments.ts) can read the reserved guide slugs
 * WITHOUT importing `phone-guides.ts` / `expat-guides.ts`, whose derived `*_PATHS`/`*_SLUGS` consts are
 * `GUIDES.map(g => g.slug)` and therefore drag the entire (multi-KB) guide-content arrays into every page's
 * JS (speed plan item 8 — ~15.7 KB raw off home/floor). handle-format imports these literals instead, and
 * the big arrays tree-shake out of the client. ⚠️ Being import-free also keeps it safe for the config-time
 * transpile that forbids the `@/` alias (see handle-format.ts's relative-import landmine).
 *
 * ⛔ THESE MUST MATCH `PHONE_GUIDES`/`EXPAT_GUIDES`/`MARKETPLACE_GUIDES` EXACTLY. They are hand-copied, so
 * `src/lib/guide-slugs.test.ts` asserts each list equals the derived `GUIDES.map(g => g.slug)`; add a guide
 * → that test fails until you add its slug here. Do not edit one without the other.
 */

/** Phone-guide slugs (en+vi pairs). Mirrors `PHONE_GUIDE_PATHS` in phone-guides.ts. */
export const PHONE_GUIDE_SLUGS: readonly string[] = [
  'best-place-to-buy-iphone-vietnam', 'mua-iphone-o-dau-uy-tin',
  'chinh-hang-vs-xach-tay-vietnam', 'iphone-chinh-hang-va-xach-tay',
  'buying-a-used-iphone-vietnam', 'kinh-nghiem-mua-iphone-cu',
  'phone-instalments-vietnam', 'mua-dien-thoai-tra-gop',
  'iphone-18-vs-iphone-17-vietnam', 'co-nen-len-doi-iphone-18',
  'iphone-vs-samsung-vietnam', 'nen-mua-iphone-hay-samsung',
  'foldable-phones-vietnam', 'dien-thoai-gap-nen-mua-loai-nao',
  'esim-vietnam-guide', 'esim-viettel-vinaphone-mobifone',
  'vat-refund-phone-vietnam', 'hoan-thue-vat-mua-dien-thoai',
  'ipad-buying-guide-vietnam', 'mua-ipad-loai-nao-tot',
  'budget-5g-phones-vietnam', 'dien-thoai-5g-gia-re',
  'phone-warranty-repair-vietnam', 'bao-hanh-sua-chua-dien-thoai',
  'selling-your-phone-vietnam', 'ban-dien-thoai-cu-duoc-gia',
  'best-value-phones-vietnam', 'dien-thoai-tam-trung-dang-mua',
  'samsung-galaxy-buying-guide-vietnam', 'mua-samsung-galaxy-dong-nao',
  'iphone-battery-replacement-vietnam', 'thay-pin-iphone-o-dau',
  'phones-under-10-million-vietnam', 'dien-thoai-duoi-10-trieu',
  'phone-accessories-vietnam', 'phu-kien-dien-thoai-nen-mua',
]

/** Expat/services-edition guide slugs. Mirrors `EXPAT_GUIDE_SLUGS` in expat-guides.ts. */
export const EXPAT_GUIDE_SLUGS: readonly string[] = [
  'moving-to-vietnam', 'first-month-in-vietnam',
]

/** Marketplace guide slugs (bare, no leading `/`). Mirrors `MARKETPLACE_GUIDE_SLUGS` in expat-guides.ts. */
export const MARKETPLACE_GUIDE_SLUGS: readonly string[] = [
  'furnishing-a-home-in-vietnam', 'selling-up-before-you-leave-vietnam',
  'secondhand-furniture-ho-chi-minh-city', 'thanh-ly-do-gia-dung-cu-tphcm',
  'do-cu-cua-nguoi-nuoc-ngoai', 'renting-an-apartment-vietnam-foreigner',
  'rental-deposit-vietnam', 'ban-do-cu-o-dau-duoc-gia',
  'car-rental-ho-chi-minh-city', 'thue-xe-tu-lai-tphcm',
  'motorbike-rental-ho-chi-minh-city', 'thue-xe-may-tphcm',
  'dang-tin-ban-hang-mien-phi',
]
