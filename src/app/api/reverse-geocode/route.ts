import { NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Paid Google Geocoding key (server-only). ONLY set this when the Geocoding API is
// actually enabled for the key — otherwise leave it unset and we use free Nominatim
// (no wasted failing Google round-trip). Not reusing the translate key on purpose.
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY

// Map an address blob to one of our HCMC district slugs.
const DISTRICT_KEYS: Record<string, string[]> = {
  d1: ['quận 1', 'district 1', 'quan 1', 'bến nghé', 'ben nghe'],
  d3: ['quận 3', 'district 3'],
  d4: ['quận 4', 'district 4'],
  d7: ['quận 7', 'district 7', 'phú mỹ hưng', 'phu my hung'],
  'binh-thanh': ['bình thạnh', 'binh thanh'],
  'thu-duc': ['thủ đức', 'thu duc', 'thảo điền', 'thao dien', 'quận 2', 'district 2'],
  'phu-nhuan': ['phú nhuận', 'phu nhuan'],
  'tan-binh': ['tân bình', 'tan binh'],
}

function matchDistrict(hay: string): string | null {
  const h = hay.toLowerCase()
  for (const [slug, keys] of Object.entries(DISTRICT_KEYS)) {
    if (keys.some((k) => h.includes(k))) return slug
  }
  return null
}

type Result = { address: string; district: string | null; province: string; ward: string; wardCandidates: string[] }

// Google Geocoding (preferred): administrative_area_level_2 is the district.
async function geocodeGoogle(lat: string, lng: string, lang: string): Promise<Result | null> {
  if (!GOOGLE_KEY) return null
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(`${lat},${lng}`)}&language=${lang}&key=${GOOGLE_KEY}`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  if (data.status !== 'OK' || !data.results?.length) return null
  const top = data.results[0]
  const comps: { long_name: string; types: string[] }[] = top.address_components || []
  const pick = (type: string) => comps.find((c) => c.types.includes(type))?.long_name
  // The top result is street/hamlet-level (e.g. "Ấp 43") and often SKIPS the official
  // ward/commune — scan ALL results for ward-likely components so auto-select has more
  // names to match against the 2025 ward list.
  type Comp = { long_name: string; types: string[] }
  const allComps: Comp[] = (data.results as { address_components?: Comp[] }[]).flatMap((r) => r.address_components || [])
  const pickAll = (type: string) => allComps.filter((c) => c.types.includes(type)).map((c) => c.long_name)
  const districtName = pick('administrative_area_level_2') || pick('administrative_area_level_3')
  const district = matchDistrict(`${districtName || ''} ${top.formatted_address || ''}`)
  const province = pick('administrative_area_level_1') || ''
  const wardCandidates = Array.from(new Set([
    ...pickAll('administrative_area_level_3'),
    ...pickAll('sublocality_level_1'),
    ...pickAll('sublocality_level_2'),
    ...pickAll('sublocality'),
    ...pickAll('administrative_area_level_2'),
    ...pickAll('locality'),
    ...pickAll('neighborhood'),
  ].filter(Boolean)))
  const ward = wardCandidates[0] || ''
  // Google's formatted_address is clean; trim the trailing ", Vietnam".
  const address = String(top.formatted_address || '').replace(/,?\s*Vietnam$/i, '').trim()
  return { address, district, province, ward, wardCandidates }
}

// Nominatim (free) fallback.
async function geocodeNominatim(lat: string, lng: string, lang: string): Promise<Result | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&accept-language=${lang}&zoom=16`
  const res = await fetch(url, { headers: { 'User-Agent': 'eno.vn Marketplace/1.0 (https://eno.vn)' } })
  if (!res.ok) return null
  const data = await res.json()
  const a = (data.address || {}) as Record<string, string>
  const district = matchDistrict(`${Object.values(a).join(' ')} ${data.display_name || ''}`)
  const province = a.state || a.city || a.region || ''
  const wardCandidates = Array.from(new Set([a.quarter, a.suburb, a.ward, a.neighbourhood, a.village, a.hamlet, a.city_district, a.municipality].filter(Boolean)))
  const ward = wardCandidates[0] || ''
  const parts = [
    [a.house_number, a.road].filter(Boolean).join(' '),
    a.quarter || a.suburb || a.neighbourhood,
    a.city_district || a.district || a.county,
    a.city || a.town,
  ].filter(Boolean)
  return { address: parts.join(', ') || data.display_name || '', district, province, ward, wardCandidates }
}

// GET /api/reverse-geocode?lat=&lng=&lang= → { address, district }
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')
  const lang = searchParams.get('lang') === 'vi' ? 'vi' : 'en'
  if (!lat || !lng || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return NextResponse.json({ error: 'missing_coords' }, { status: 400 })
  }

  // It's a paid call — rate-limit per IP so it can't be hammered.
  const ip = clientIp(req)
  const rl = await rateLimit('geocode', ip, 30, '1 m', { strict: true })
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  try {
    const result = (await geocodeGoogle(lat, lng, lang)) || (await geocodeNominatim(lat, lng, lang))
    if (!result) return NextResponse.json({ error: 'geocode_failed' }, { status: 502 })
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'geocode_failed' }, { status: 502 })
  }
}
