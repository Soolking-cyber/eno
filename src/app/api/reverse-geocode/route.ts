import { NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { rateKeyForIp } from '@/lib/ip-key'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Paid Google Geocoding key (server-only). ONLY set this when the Geocoding API is
// actually enabled for the key — otherwise leave it unset and we use free Nominatim
// (no wasted failing Google round-trip). Not reusing the translate key on purpose.
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY

/**
 * ⛔ COST CONTROLS ON A PUBLIC, UNAUTHENTICATED, PAID ENDPOINT (security review 2026-10-22, item 14). It was limited only
 * per full IPv6 address — rotating addresses inside one /64 gave a fresh bucket each time, and each call can be a billed
 * Google request with no ceiling anywhere. Now:
 *  · the per-caller limit keys on the IPv6 /64 (rateKeyForIp);
 *  · Google calls have a GLOBAL daily budget — over it, the free provider answers instead;
 *  · the free fallback (Nominatim, whose usage policy allows ~1 request/second) has its own global brake, so a flood
 *    cannot get the box banned there either;
 *  · coordinates are rounded to 4 decimals (~11 m — finer than any district answer needs) and answers are cached
 *    in-process, so repeated lookups of the same spot cost nothing.
 * Set a matching quota on the GOOGLE_MAPS_API_KEY in GCP too (runbook) — this is the app-side half.
 */
const GEOCODE_GOOGLE_PER_DAY = 3000
const GEOCODE_FALLBACK_PER_MIN = 50
const GEOCODE_CACHE_MAX = 2000
const GEOCODE_CACHE_TTL_MS = 24 * 3600 * 1000
const geocodeCache = new Map<string, { at: number; value: unknown }>()
function cacheGet(k: string): unknown | undefined {
  const hit = geocodeCache.get(k)
  if (!hit) return undefined
  if (Date.now() - hit.at > GEOCODE_CACHE_TTL_MS) { geocodeCache.delete(k); return undefined }
  return hit.value
}
function cacheSet(k: string, value: unknown) {
  if (geocodeCache.size >= GEOCODE_CACHE_MAX) {
    const oldest = geocodeCache.keys().next().value
    if (oldest !== undefined) geocodeCache.delete(oldest)
  }
  geocodeCache.set(k, { at: Date.now(), value })
}

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
  // Bound the upstream — the two providers run SEQUENTIALLY and the post-wizard's
  // "use my location" spinner waits on this; a hung provider must not stall it.
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
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
  const res = await fetch(url, { headers: { 'User-Agent': 'eno.vn Marketplace/1.0 (https://eno.vn)' }, signal: AbortSignal.timeout(4000) })
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
//
// ⚠️ WS6 — NOT MIGRATED, AND THE REASON IS ORDER, NOT SHAPE. The limiter's code/status/key all match
// what `rateLimit: { bucket: 'geocode', limit: 30, window: '1 m', strict: true }` would emit — but the
// wrapper runs it BEFORE the handler, and here the `missing_coords` 400 deliberately runs FIRST. A
// caller sending junk coordinates currently costs nothing and always reads 400; hoisting would charge
// them 30 slots a minute and then answer 429 instead, throttling the post wizard's real "use my
// location" tap on the strength of malformed requests. `strict: true` makes that worse — the limiter
// fails CLOSED, so a limiter blip would 429 a request that today cannot get past validation. Public
// and no JSON body, so with the limiter pinned in place all four options are empty.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')
  const lang = searchParams.get('lang') === 'vi' ? 'vi' : 'en'
  if (!lat || !lng || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return NextResponse.json({ error: 'missing_coords' }, { status: 400 })
  }

  // It's a paid call — rate-limit per caller (IPv4, or the IPv6 /64) so it can't be hammered.
  const rl = await rateLimit('geocode', rateKeyForIp(clientIp(req)), 30, '1 m', { strict: true })
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  // Round, then answer repeats from the cache (item 14).
  const rLat = Number(lat).toFixed(4)
  const rLng = Number(lng).toFixed(4)
  const cacheKey = `${rLat},${rLng},${lang}`
  const cached = cacheGet(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    // Per-call catch so a Google timeout/error FALLS THROUGH to Nominatim instead of
    // bailing the whole request (the point of having a fallback provider).
    let result = null as Awaited<ReturnType<typeof geocodeGoogle>>
    if (GOOGLE_KEY) {
      const paid = await rateLimit('geocode-google-global', 'global', GEOCODE_GOOGLE_PER_DAY, '1 d', { strict: true })
      if (paid.success) result = await geocodeGoogle(rLat, rLng, lang).catch(() => null)
    }
    if (!result) {
      const free = await rateLimit('geocode-fallback-global', 'global', GEOCODE_FALLBACK_PER_MIN, '1 m', { strict: true })
      if (!free.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
      result = await geocodeNominatim(rLat, rLng, lang).catch(() => null)
    }
    if (!result) return NextResponse.json({ error: 'geocode_failed' }, { status: 502 })
    cacheSet(cacheKey, result)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'geocode_failed' }, { status: 502 })
  }
}
