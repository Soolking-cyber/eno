import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Map an OSM/Nominatim address blob to one of our HCMC district slugs.
const DISTRICT_KEYS: Record<string, string[]> = {
  d1: ['quận 1', 'district 1', 'quan 1', 'ben nghe', 'bến nghé'],
  d3: ['quận 3', 'district 3'],
  d4: ['quận 4', 'district 4'],
  d7: ['quận 7', 'district 7', 'phú mỹ hưng', 'phu my hung'],
  'binh-thanh': ['bình thạnh', 'binh thanh'],
  'thu-duc': ['thủ đức', 'thu duc', 'thảo điền', 'thao dien', 'quận 2', 'district 2'],
  'phu-nhuan': ['phú nhuận', 'phu nhuan'],
  'tan-binh': ['tân bình', 'tan binh'],
}

// GET /api/reverse-geocode?lat=&lng=&lang= → { address, district }
// Proxies Nominatim server-side so we can set a proper User-Agent (their policy)
// and keep it same-origin for the client. Best-effort.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')
  const lang = searchParams.get('lang') === 'vi' ? 'vi' : 'en'
  if (!lat || !lng || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return NextResponse.json({ error: 'missing_coords' }, { status: 400 })
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&accept-language=${lang}&zoom=16`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ENO Marketplace/1.0 (https://www.eno.forum)' },
    })
    if (!res.ok) return NextResponse.json({ error: 'geocode_failed' }, { status: 502 })
    const data = await res.json()
    const a = (data.address || {}) as Record<string, string>

    const hay = `${Object.values(a).join(' ')} ${data.display_name || ''}`.toLowerCase()
    let district: string | null = null
    for (const [slug, keys] of Object.entries(DISTRICT_KEYS)) {
      if (keys.some((k) => hay.includes(k))) { district = slug; break }
    }

    const parts = [
      [a.house_number, a.road].filter(Boolean).join(' '),
      a.quarter || a.suburb || a.neighbourhood,
      a.city_district || a.district || a.county,
      a.city || a.town,
    ].filter(Boolean)
    const address = parts.join(', ') || data.display_name || ''

    return NextResponse.json({ address, district })
  } catch {
    return NextResponse.json({ error: 'geocode_failed' }, { status: 502 })
  }
}
