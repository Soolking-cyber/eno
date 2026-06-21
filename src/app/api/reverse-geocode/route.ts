import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Paid Google Geocoding key (server-only). Falls back to the translate key if you
// enabled the Geocoding API on that same key; else we fall back to free Nominatim.
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_TRANSLATE_API_KEY

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

type Result = { address: string; district: string | null }

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
  const districtName = pick('administrative_area_level_2') || pick('administrative_area_level_3')
  const district = matchDistrict(`${districtName || ''} ${top.formatted_address || ''}`)
  // Google's formatted_address is clean; trim the trailing ", Vietnam".
  const address = String(top.formatted_address || '').replace(/,?\s*Vietnam$/i, '').trim()
  return { address, district }
}

// Nominatim (free) fallback.
async function geocodeNominatim(lat: string, lng: string, lang: string): Promise<Result | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&accept-language=${lang}&zoom=16`
  const res = await fetch(url, { headers: { 'User-Agent': 'ENO Marketplace/1.0 (https://www.eno.forum)' } })
  if (!res.ok) return null
  const data = await res.json()
  const a = (data.address || {}) as Record<string, string>
  const district = matchDistrict(`${Object.values(a).join(' ')} ${data.display_name || ''}`)
  const parts = [
    [a.house_number, a.road].filter(Boolean).join(' '),
    a.quarter || a.suburb || a.neighbourhood,
    a.city_district || a.district || a.county,
    a.city || a.town,
  ].filter(Boolean)
  return { address: parts.join(', ') || data.display_name || '', district }
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
  const ip = (req.headers.get('x-forwarded-for') || 'anon').split(',')[0].trim()
  const rl = await rateLimit('geocode', ip, 30, '1 m')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  try {
    const result = (await geocodeGoogle(lat, lng, lang)) || (await geocodeNominatim(lat, lng, lang))
    if (!result) return NextResponse.json({ error: 'geocode_failed' }, { status: 502 })
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'geocode_failed' }, { status: 502 })
  }
}
