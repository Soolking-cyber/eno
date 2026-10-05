/**
 * THE EXPLORER'S AREA, READ BACK FROM A URL — `?province=<code>&ward=<code>` (UX3 NAV-2, nav audit N3).
 *
 * The area (province → ward, Vietnam's 2025 two-tier units) was the one filter the explorer never wrote to
 * its URL, so Back, a reload and a shared link all dropped it silently — measured: jobs + Hồ Chí Minh = 14
 * results, open a job, Back → 25. The explorer now writes the CODES and this module turns them back into
 * the `{ code, name, nameEn }` the explorer holds (the API filters on `nameEn`, the chip shows `name` in
 * Vietnamese, the cache key uses `code`).
 *
 * ⚠️ PROVINCES ARE A STATIC TABLE, WARDS ARE FETCHED. The 34 provinces fit in ~1.5 KB, so a `?province=`
 * link resolves in the same render — no request that goes out without the province and then refetches.
 * The 3,321 wards would put ~190 KB of data/vn-units.json into the client bundle, so a ward is resolved
 * through /api/geo (hard-cached at the edge, s-maxage 1 day) and remembered for the document.
 * ⚠️ THE TABLE IS PINNED TO data/vn-units.json BY vn-areas.test.ts (code, name and nameEn, both
 * directions), so an edit to the dataset fails the suite until it is mirrored here.
 *
 * ⛔ NEVER THE "NEAR YOU" CIRCLE. Coordinates are personal data (PDPL) and leak through Referer headers and
 * server logs; the explorer keeps them out of the URL entirely (listings-explorer.tsx, the URL writer).
 */

export type AreaGeo = { code: string; name: string; nameEn: string }

/** The 34 provincial units of data/vn-units.json — code, Vietnamese name, English name. */
export const VN_PROVINCES: readonly AreaGeo[] = [
  { code: '01', name: 'Hà Nội', nameEn: 'Ha Noi' },
  { code: '04', name: 'Cao Bằng', nameEn: 'Cao Bang' },
  { code: '08', name: 'Tuyên Quang', nameEn: 'Tuyen Quang' },
  { code: '11', name: 'Điện Biên', nameEn: 'Dien Bien' },
  { code: '12', name: 'Lai Châu', nameEn: 'Lai Chau' },
  { code: '14', name: 'Sơn La', nameEn: 'Son La' },
  { code: '15', name: 'Lào Cai', nameEn: 'Lao Cai' },
  { code: '19', name: 'Thái Nguyên', nameEn: 'Thai Nguyen' },
  { code: '20', name: 'Lạng Sơn', nameEn: 'Lang Son' },
  { code: '22', name: 'Quảng Ninh', nameEn: 'Quang Ninh' },
  { code: '24', name: 'Bắc Ninh', nameEn: 'Bac Ninh' },
  { code: '25', name: 'Phú Thọ', nameEn: 'Phu Tho' },
  { code: '31', name: 'Hải Phòng', nameEn: 'Hai Phong' },
  { code: '33', name: 'Hưng Yên', nameEn: 'Hung Yen' },
  { code: '37', name: 'Ninh Bình', nameEn: 'Ninh Binh' },
  { code: '38', name: 'Thanh Hoá', nameEn: 'Thanh Hoa' },
  { code: '40', name: 'Nghệ An', nameEn: 'Nghe An' },
  { code: '42', name: 'Hà Tĩnh', nameEn: 'Ha Tinh' },
  { code: '44', name: 'Quảng Trị', nameEn: 'Quang Tri' },
  { code: '46', name: 'Huế', nameEn: 'Hue' },
  { code: '48', name: 'Đà Nẵng', nameEn: 'Da Nang' },
  { code: '51', name: 'Quảng Ngãi', nameEn: 'Quang Ngai' },
  { code: '52', name: 'Gia Lai', nameEn: 'Gia Lai' },
  { code: '56', name: 'Khánh Hoà', nameEn: 'Khanh Hoa' },
  { code: '66', name: 'Đắk Lắk', nameEn: 'Dak Lak' },
  { code: '68', name: 'Lâm Đồng', nameEn: 'Lam Dong' },
  { code: '75', name: 'Đồng Nai', nameEn: 'Dong Nai' },
  { code: '79', name: 'Hồ Chí Minh', nameEn: 'Ho Chi Minh' },
  { code: '80', name: 'Tây Ninh', nameEn: 'Tay Ninh' },
  { code: '82', name: 'Đồng Tháp', nameEn: 'Dong Thap' },
  { code: '86', name: 'Vĩnh Long', nameEn: 'Vinh Long' },
  { code: '91', name: 'An Giang', nameEn: 'An Giang' },
  { code: '92', name: 'Cần Thơ', nameEn: 'Can Tho' },
  { code: '96', name: 'Cà Mau', nameEn: 'Ca Mau' },
]

/** A URL value that can be a unit code at all — digits only, so nothing else reaches /api/geo. */
const CODE = /^\d{1,6}$/

/** The province a `?province=` code names, or null (unknown code, junk, absent). */
export function provinceByCode(code: string | null | undefined): AreaGeo | null {
  if (!code || !CODE.test(code)) return null
  return VN_PROVINCES.find((p) => p.code === code) ?? null
}

/** Wards seen in this document, keyed `provinceCode:wardCode` — the area panel's picks and every resolve. */
const knownWards = new Map<string, AreaGeo>()
const wardKey = (provinceCode: string, wardCode: string) => `${provinceCode}:${wardCode}`

/**
 * Remember a ward the explorer applied (from the Area panel, the header's recent places, a hand-off), so
 * Back to its URL resolves it in the same render instead of asking /api/geo again.
 */
export function rememberWard(provinceCode: string | null | undefined, ward: AreaGeo | null | undefined): void {
  if (!provinceCode || !ward?.code) return
  knownWards.set(wardKey(provinceCode, ward.code), { code: ward.code, name: ward.name, nameEn: ward.nameEn })
}

/** A ward already known in this document, or null — synchronous. */
export function peekWard(provinceCode: string | null | undefined, wardCode: string | null | undefined): AreaGeo | null {
  if (!provinceCode || !wardCode) return null
  return knownWards.get(wardKey(provinceCode, wardCode)) ?? null
}

/** One request per province per document, shared by every resolve (a failure is forgotten so a retry can ask again).
 *  ⚠️ A NON-OK ANSWER IS A FAILURE TOO (codex, gate 2026-10-05): a 500/503 kept as "no wards" would make every ward of
 *  that province unresolvable until a reload. */
const wardLists = new Map<string, Promise<AreaGeo[]>>()
function fetchWards(provinceCode: string): Promise<AreaGeo[]> {
  let p = wardLists.get(provinceCode)
  if (!p) {
    p = fetch(`/api/geo?type=wards&province=${encodeURIComponent(provinceCode)}`)
      .then((r) => { if (!r.ok) throw new Error(`/api/geo ${r.status}`); return r.json() })
      .then((d: { wards?: AreaGeo[] }) => (Array.isArray(d?.wards) ? d.wards : []))
      .catch(() => { wardLists.delete(provinceCode); return [] })
    wardLists.set(provinceCode, p)
  }
  return p
}

/** The ward a `?ward=` code names inside `provinceCode`, resolved through /api/geo when not already known. */
export async function resolveWard(provinceCode: string, wardCode: string): Promise<AreaGeo | null> {
  if (!CODE.test(provinceCode) || !CODE.test(wardCode)) return null
  const known = peekWard(provinceCode, wardCode)
  if (known) return known
  const hit = (await fetchWards(provinceCode)).find((w) => w.code === wardCode) ?? null
  if (hit) rememberWard(provinceCode, hit)
  return hit
}

/** Tests only: forget every ward this document has seen or asked for. */
export function __resetAreaCachesForTests(): void {
  knownWards.clear()
  wardLists.clear()
}
