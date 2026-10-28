/**
 * HÀ NỘI'S DISTRICTS (owner, 2026-10-28: "find a teacher … add Hanoi districts chip") — the 12 inner districts schools
 * and teachers still name (the district tier is abolished since 2025-07-01; the 126 new wards are not how anyone says
 * where they teach). cover.ts makes them cover areas of 'ha-noi' (COVER_AREAS), places.ts teach areas.
 * ⛔ ITS OWN TABLE, NEVER `DISTRICTS` (listings-explorer.constants.ts): that one is HCMC's, fingerprinted by the rent index.
 * ⛔ IN A `district-` FILE ON PURPOSE: gen-ui-strings.mjs keeps place tables out of the machine-translation harvest
 * (PAIR_SCOPE) — a place name is never machine-translated (PlaceName's rule).
 * Keys are `hn-` prefixed so no HCMC slug, hub or province key can collide, and the ORDER is the stored order
 * (places.ts PLACE_KEYS) — append, never reorder. Vietnamese names, and their unaccented English forms.
 */
export const HANOI_DISTRICTS: readonly { key: string; en: string; vi: string }[] = [
  { key: 'hn-ba-dinh', en: 'Ba Dinh', vi: 'Ba Đình' },
  { key: 'hn-hoan-kiem', en: 'Hoan Kiem', vi: 'Hoàn Kiếm' },
  { key: 'hn-tay-ho', en: 'Tay Ho', vi: 'Tây Hồ' },
  { key: 'hn-long-bien', en: 'Long Bien', vi: 'Long Biên' },
  { key: 'hn-cau-giay', en: 'Cau Giay', vi: 'Cầu Giấy' },
  { key: 'hn-dong-da', en: 'Dong Da', vi: 'Đống Đa' },
  { key: 'hn-hai-ba-trung', en: 'Hai Ba Trung', vi: 'Hai Bà Trưng' },
  { key: 'hn-hoang-mai', en: 'Hoang Mai', vi: 'Hoàng Mai' },
  { key: 'hn-thanh-xuan', en: 'Thanh Xuan', vi: 'Thanh Xuân' },
  { key: 'hn-nam-tu-liem', en: 'Nam Tu Liem', vi: 'Nam Từ Liêm' },
  { key: 'hn-bac-tu-liem', en: 'Bac Tu Liem', vi: 'Bắc Từ Liêm' },
  { key: 'hn-ha-dong', en: 'Ha Dong', vi: 'Hà Đông' },
]
