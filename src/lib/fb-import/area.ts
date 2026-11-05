import vnUnits from '@/data/vn-units.json'

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim()
const PROVINCES = new Map<string, string>()
for (const { name, nameEn } of vnUnits as { name: string; nameEn: string }[]) {
  for (const k of [plain(name), plain(nameEn)]) { PROVINCES.set(k, name); PROVINCES.set(k.replace(/ /g, ''), name) }
}
for (const k of ['saigon', 'sai gon', 'hcm', 'hcmc', 'tphcm', 'tp hcm']) PROVINCES.set(k, 'Hồ Chí Minh')

function province(part: string): string | null {
  const k = plain(part).replace(/^(thanh pho|tinh|tp\.?)\s+/, '').replace(/\s+(city|province)$/, '').trim()
  return PROVINCES.get(k) ?? PROVINCES.get(k.replace(/ /g, '')) ?? null
}

/** The form the catalogue stores: "District 12" and "Q.12" are 'Quận 12', which is what the district chips match. */
function districtName(part: string): string {
  const n = /^(?:district|dist\.?|quan|q\.?)\s*(\d{1,2})$/.exec(plain(part))
  if (n) return `Quận ${Number(n[1])}`
  const city = /^(?:thành phố|tp\.?)\s*(.+)$/iu.exec(part)
  return (city ? `TP. ${city[1]}` : part).replace(/\s+district$/i, '').trim()
}

/**
 * Facebook's location line ("Quận 12, Hồ Chí Minh", measured 2026-11-05) as the area and province a listing stores. A post needs a place (assertHasLocation), and `city` defaults to Ho Chi Minh City when
 * absent, so a place outside the list keeps its own words rather than being filed under HCMC. No area in the line ("Ho Chi Minh City, Vietnam") gives null: the seller types it on the review screen.
 */
export function areaFromFacebook(text: string | null | undefined): { district: string | null; city: string | null } {
  const parts = (text ?? '').normalize('NFC').split(',').map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  while (parts.length && /^(vn|vietnam|viet nam|việt nam)$/i.test(parts[parts.length - 1])) parts.pop()
  if (!parts.length) return { district: null, city: null }
  const last = parts[parts.length - 1]
  if (parts.length === 1) return province(last) ? { district: null, city: province(last) } : { district: districtName(last), city: last }
  if (province(parts[0])) return { district: null, city: province(last) ?? province(parts[0]) }
  return { district: districtName(parts[0]), city: province(last) ?? last }
}

/** What a seller or the model typed as the area: its province if it names one, and numbered districts are Ho Chi Minh City's. Otherwise the province stays what it was. Pure, for the tests. */
export function areaFromTyped(text: string | null | undefined, knownCity: string | null): { district: string | null; city: string | null } {
  const parts = (text ?? '').normalize('NFC').split(',').map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!parts.length) return { district: null, city: knownCity }
  if (parts.length === 1 && province(parts[0])) return { district: null, city: province(parts[0]) }
  const district = districtName(parts[0])
  if (parts.length > 1 && province(parts[parts.length - 1])) return { district, city: province(parts[parts.length - 1]) }
  return { district, city: /^Quận \d+$/.test(district) ? 'Hồ Chí Minh' : knownCity }
}

