// Shared static data for the listings explorer + its extracted sub-components.

// Provinces/cities of Vietnam (slug ↔ VI/EN label). HCMC is the live market (its
// districts are below); other provinces are selectable so the picker is complete,
// but listings currently exist only in Ho Chi Minh City.
export const PROVINCES: { slug: string; name: string; nameEn: string }[] = [
  { slug: 'ho-chi-minh', name: 'TP. Hồ Chí Minh', nameEn: 'Ho Chi Minh City' },
  { slug: 'ha-noi', name: 'Hà Nội', nameEn: 'Hanoi' },
  { slug: 'da-nang', name: 'Đà Nẵng', nameEn: 'Da Nang' },
  { slug: 'hai-phong', name: 'Hải Phòng', nameEn: 'Hai Phong' },
  { slug: 'can-tho', name: 'Cần Thơ', nameEn: 'Can Tho' },
  { slug: 'an-giang', name: 'An Giang', nameEn: 'An Giang' },
  { slug: 'ba-ria-vung-tau', name: 'Bà Rịa - Vũng Tàu', nameEn: 'Ba Ria - Vung Tau' },
  { slug: 'bac-giang', name: 'Bắc Giang', nameEn: 'Bac Giang' },
  { slug: 'bac-kan', name: 'Bắc Kạn', nameEn: 'Bac Kan' },
  { slug: 'bac-lieu', name: 'Bạc Liêu', nameEn: 'Bac Lieu' },
  { slug: 'bac-ninh', name: 'Bắc Ninh', nameEn: 'Bac Ninh' },
  { slug: 'ben-tre', name: 'Bến Tre', nameEn: 'Ben Tre' },
  { slug: 'binh-dinh', name: 'Bình Định', nameEn: 'Binh Dinh' },
  { slug: 'binh-duong', name: 'Bình Dương', nameEn: 'Binh Duong' },
  { slug: 'binh-phuoc', name: 'Bình Phước', nameEn: 'Binh Phuoc' },
  { slug: 'binh-thuan', name: 'Bình Thuận', nameEn: 'Binh Thuan' },
  { slug: 'ca-mau', name: 'Cà Mau', nameEn: 'Ca Mau' },
  { slug: 'cao-bang', name: 'Cao Bằng', nameEn: 'Cao Bang' },
  { slug: 'dak-lak', name: 'Đắk Lắk', nameEn: 'Dak Lak' },
  { slug: 'dak-nong', name: 'Đắk Nông', nameEn: 'Dak Nong' },
  { slug: 'dien-bien', name: 'Điện Biên', nameEn: 'Dien Bien' },
  { slug: 'dong-nai', name: 'Đồng Nai', nameEn: 'Dong Nai' },
  { slug: 'dong-thap', name: 'Đồng Tháp', nameEn: 'Dong Thap' },
  { slug: 'gia-lai', name: 'Gia Lai', nameEn: 'Gia Lai' },
  { slug: 'ha-giang', name: 'Hà Giang', nameEn: 'Ha Giang' },
  { slug: 'ha-nam', name: 'Hà Nam', nameEn: 'Ha Nam' },
  { slug: 'ha-tinh', name: 'Hà Tĩnh', nameEn: 'Ha Tinh' },
  { slug: 'hai-duong', name: 'Hải Dương', nameEn: 'Hai Duong' },
  { slug: 'hau-giang', name: 'Hậu Giang', nameEn: 'Hau Giang' },
  { slug: 'hoa-binh', name: 'Hòa Bình', nameEn: 'Hoa Binh' },
  { slug: 'hung-yen', name: 'Hưng Yên', nameEn: 'Hung Yen' },
  { slug: 'khanh-hoa', name: 'Khánh Hòa', nameEn: 'Khanh Hoa' },
  { slug: 'kien-giang', name: 'Kiên Giang', nameEn: 'Kien Giang' },
  { slug: 'kon-tum', name: 'Kon Tum', nameEn: 'Kon Tum' },
  { slug: 'lai-chau', name: 'Lai Châu', nameEn: 'Lai Chau' },
  { slug: 'lam-dong', name: 'Lâm Đồng', nameEn: 'Lam Dong' },
  { slug: 'lang-son', name: 'Lạng Sơn', nameEn: 'Lang Son' },
  { slug: 'lao-cai', name: 'Lào Cai', nameEn: 'Lao Cai' },
  { slug: 'long-an', name: 'Long An', nameEn: 'Long An' },
  { slug: 'nam-dinh', name: 'Nam Định', nameEn: 'Nam Dinh' },
  { slug: 'nghe-an', name: 'Nghệ An', nameEn: 'Nghe An' },
  { slug: 'ninh-binh', name: 'Ninh Bình', nameEn: 'Ninh Binh' },
  { slug: 'ninh-thuan', name: 'Ninh Thuận', nameEn: 'Ninh Thuan' },
  { slug: 'phu-tho', name: 'Phú Thọ', nameEn: 'Phu Tho' },
  { slug: 'phu-yen', name: 'Phú Yên', nameEn: 'Phu Yen' },
  { slug: 'quang-binh', name: 'Quảng Bình', nameEn: 'Quang Binh' },
  { slug: 'quang-nam', name: 'Quảng Nam', nameEn: 'Quang Nam' },
  { slug: 'quang-ngai', name: 'Quảng Ngãi', nameEn: 'Quang Ngai' },
  { slug: 'quang-ninh', name: 'Quảng Ninh', nameEn: 'Quang Ninh' },
  { slug: 'quang-tri', name: 'Quảng Trị', nameEn: 'Quang Tri' },
  { slug: 'soc-trang', name: 'Sóc Trăng', nameEn: 'Soc Trang' },
  { slug: 'son-la', name: 'Sơn La', nameEn: 'Son La' },
  { slug: 'tay-ninh', name: 'Tây Ninh', nameEn: 'Tay Ninh' },
  { slug: 'thai-binh', name: 'Thái Bình', nameEn: 'Thai Binh' },
  { slug: 'thai-nguyen', name: 'Thái Nguyên', nameEn: 'Thai Nguyen' },
  { slug: 'thanh-hoa', name: 'Thanh Hóa', nameEn: 'Thanh Hoa' },
  { slug: 'thua-thien-hue', name: 'Thừa Thiên Huế', nameEn: 'Thua Thien Hue' },
  { slug: 'tien-giang', name: 'Tiền Giang', nameEn: 'Tien Giang' },
  { slug: 'tra-vinh', name: 'Trà Vinh', nameEn: 'Tra Vinh' },
  { slug: 'tuyen-quang', name: 'Tuyên Quang', nameEn: 'Tuyen Quang' },
  { slug: 'vinh-long', name: 'Vĩnh Long', nameEn: 'Vinh Long' },
  { slug: 'vinh-phuc', name: 'Vĩnh Phúc', nameEn: 'Vinh Phuc' },
  { slug: 'yen-bai', name: 'Yên Bái', nameEn: 'Yen Bai' },
]

// HCMC districts (slug ↔ VI/EN label). `match` = substrings used by the listings
// API to filter the listing `district` field (EN + VI variants).
//
// ⛔ THE `all` ENTRY SAID "All HCMC" / "Toàn bộ HCMC", AND `all` HAS NEVER FILTERED BY CITY. It is
// "no district scope" (districtScopeForSlug returns null for it), so the default view returns every
// city's rows. That was merely imprecise while every listing was in HCMC; with Hà Nội and Đà Nẵng
// rentals imported (nhatot, muaban, 2026-09) the default rentals view would show them under a label
// saying HCMC. The label now says what the filter does. A caller that knows the selected province
// should label it with `allDistrictsLabel()`, which names that province instead.
export const DISTRICTS: { slug: string; name: string; nameEn: string; match?: string[] }[] = [
  { slug: 'all', name: 'Tất cả thành phố', nameEn: 'All cities' },
  { slug: 'thu-duc', name: 'TP Thủ Đức', nameEn: 'Thu Duc City', match: ['Thu Duc', 'Thủ Đức', 'Thao Dien', 'Thảo Điền', 'District 2', 'Quận 2', 'District 9', 'Quận 9'] },
  { slug: 'd1', name: 'Quận 1', nameEn: 'District 1', match: ['District 1', 'Quận 1'] },
  { slug: 'd3', name: 'Quận 3', nameEn: 'District 3', match: ['District 3', 'Quận 3'] },
  { slug: 'd4', name: 'Quận 4', nameEn: 'District 4', match: ['District 4', 'Quận 4'] },
  { slug: 'd5', name: 'Quận 5', nameEn: 'District 5', match: ['District 5', 'Quận 5'] },
  { slug: 'd6', name: 'Quận 6', nameEn: 'District 6', match: ['District 6', 'Quận 6'] },
  { slug: 'd7', name: 'Quận 7 (Phú Mỹ Hưng)', nameEn: 'District 7 (Phu My Hung)', match: ['District 7', 'Quận 7', 'Phu My Hung', 'Phú Mỹ Hưng'] },
  { slug: 'd8', name: 'Quận 8', nameEn: 'District 8', match: ['District 8', 'Quận 8'] },
  { slug: 'd10', name: 'Quận 10', nameEn: 'District 10', match: ['District 10', 'Quận 10'] },
  { slug: 'd11', name: 'Quận 11', nameEn: 'District 11', match: ['District 11', 'Quận 11'] },
  { slug: 'd12', name: 'Quận 12', nameEn: 'District 12', match: ['District 12', 'Quận 12'] },
  { slug: 'binh-tan', name: 'Bình Tân', nameEn: 'Binh Tan District', match: ['Binh Tan', 'Bình Tân'] },
  { slug: 'binh-thanh', name: 'Bình Thạnh', nameEn: 'Binh Thanh District', match: ['Binh Thanh', 'Bình Thạnh'] },
  { slug: 'go-vap', name: 'Gò Vấp', nameEn: 'Go Vap District', match: ['Go Vap', 'Gò Vấp'] },
  { slug: 'phu-nhuan', name: 'Phú Nhuận', nameEn: 'Phu Nhuan District', match: ['Phu Nhuan', 'Phú Nhuận'] },
  { slug: 'tan-binh', name: 'Tân Bình', nameEn: 'Tan Binh District', match: ['Tan Binh', 'Tân Bình'] },
  { slug: 'tan-phu', name: 'Tân Phú', nameEn: 'Tan Phu District', match: ['Tan Phu', 'Tân Phú'] },
  { slug: 'binh-chanh', name: 'Bình Chánh', nameEn: 'Binh Chanh District', match: ['Binh Chanh', 'Bình Chánh'] },
  { slug: 'can-gio', name: 'Cần Giờ', nameEn: 'Can Gio District', match: ['Can Gio', 'Cần Giờ'] },
  { slug: 'cu-chi', name: 'Củ Chi', nameEn: 'Cu Chi District', match: ['Cu Chi', 'Củ Chi'] },
  { slug: 'hoc-mon', name: 'Hóc Môn', nameEn: 'Hoc Mon District', match: ['Hoc Mon', 'Hóc Môn'] },
  { slug: 'nha-be', name: 'Nhà Bè', nameEn: 'Nha Be District', match: ['Nha Be', 'Nhà Bè'] },
]

/**
 * The label for the district picker's `all` option — which is "no district scope", NOT "all of HCMC".
 *
 * With no province chosen the feed spans every city, so it says so. With one chosen (the area
 * filter's `?province=`), the province filter is what narrows the feed and `all` means "anywhere in
 * it", so the province is named. Display only: the filter value stays `all` either way.
 */
export function allDistrictsLabel(
  province: { name: string; nameEn: string } | null | undefined,
  lang: string,
  /** The caller's `tr` from useLanguage(), so the copy reaches the MT languages through ui-strings. */
  tr: (en: string, vi: string) => string = (en, vi) => (lang === 'vi' ? vi : en),
): string {
  if (!province) return tr('All cities', 'Tất cả thành phố')
  return `${tr('All of', 'Toàn bộ')} ${lang === 'vi' ? province.name : province.nameEn}`
}

/** The vn-units.json GSO code of Hồ Chí Minh — the one province `DISTRICTS` lists districts for. */
export const DISTRICTS_PROVINCE_CODE = '79'

/**
 * The district options the picker offers under the area filter's province.
 *
 * ⛔ `DISTRICTS` IS HCMC'S LIST. With Hà Nội or Đà Nẵng chosen, offering "District 1 … Nhà Bè" under
 * an "All of Ha Noi" heading states that those are Hà Nội districts, and picking one ANDs an HCMC
 * district with the Hà Nội province: an empty feed. So under any other province only `all` is
 * offered — plus the current pick when it is an HCMC district, so a selection that has not been
 * reset yet (useDropStaleDistrict resets it on the province change) still has its option. No
 * province, or HCMC, keeps the full list.
 * ⚠️ A /c/<category>/<district> landing slug outside `DISTRICTS` (`thao-dien`) has never been an
 * option here, under any province — that predates this function. Its active-filter chip shows and
 * clears it, and it is not reset on a province change because nothing here knows which province a
 * landing slug belongs to (an imported Hà Nội district is one too).
 */
export function districtOptionsFor(
  province: { code: string } | null | undefined,
  activeDistrict: string,
): typeof DISTRICTS {
  if (!province || province.code === DISTRICTS_PROVINCE_CODE) return DISTRICTS
  return DISTRICTS.filter((d) => d.slug === 'all' || d.slug === activeDistrict)
}

/**
 * The district pick to keep when the province becomes `provinceCode`.
 *
 * ⛔ AN HCMC DISTRICT DOES NOT SURVIVE A MOVE TO ANOTHER PROVINCE: Hà Nội AND "District 1" is an empty
 * feed, and the picker (districtOptionsFor) no longer offers HCMC's districts there. So a `DISTRICTS`
 * slug resets to `all` under any other province. No province or HCMC keeps it, and a slug that is not
 * in `DISTRICTS` (a /c/<category>/<district> landing slug, resolved by the server) is left alone.
 */
export function districtAfterProvinceChange(provinceCode: string | null | undefined, activeDistrict: string): string {
  if (!provinceCode || provinceCode === DISTRICTS_PROVINCE_CODE || activeDistrict === 'all') return activeDistrict
  return DISTRICTS.some((d) => d.slug === activeDistrict) ? 'all' : activeDistrict
}

/** A district option's label in `lang`; the `all` option goes through `allDistrictsLabel()`. */
export function districtOptionLabel(
  d: { slug: string; name: string; nameEn: string },
  lang: string,
  province?: { name: string; nameEn: string } | null,
  tr?: (en: string, vi: string) => string,
): string {
  if (d.slug === 'all') return allDistrictsLabel(province, lang, tr)
  return lang === 'vi' ? d.name : d.nameEn
}
