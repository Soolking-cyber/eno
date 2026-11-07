import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { rateLimit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * AN ADDRESS THE SELLER TYPED, TURNED INTO PLACES ON THE MAP (owner, 2026-11-07: "auto finds when user types address on map the place, like when you pin
 * location on shopee or grab"; chose "Free OpenStreetMap, on Enter"). OpenStreetMap's Nominatim, already named on /privacy for turning a location into an
 * address.
 *
 * ⛔ ON ENTER ONLY, NEVER AS YOU TYPE: Nominatim's usage policy forbids autocomplete, so the picker asks once per submitted search (import-location-picker.tsx).
 * ⛔ FROM OUR SERVER, the text only: no account, no IP address (the /privacy row). Vietnam only, five places at most, answers cached a day, the same global
 * per-minute budget as reverse geocoding (Nominatim's one-request-per-second rule), and a per-account limit.
 */
const VN = { minLat: 8, maxLat: 23.6, minLng: 102, maxLng: 110 }
const PER_MIN_GLOBAL = 50
const CACHE_MS = 24 * 3600 * 1000
const CACHE_MAX = 1000
const cache = new Map<string, { at: number; value: Place[] }>()
type Place = { label: string; lat: number; lng: number }

export const GET = route({ auth: 'userId', rateLimit: { bucket: 'geocode-search', limit: 20, window: '1 m', strict: true } }, async ({ req }) => {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
  const lang = url.searchParams.get('lang') === 'vi' ? 'vi' : 'en'
  const ok = (results: Place[]) => NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
  if (q.length < 3) return ok([])
  const key = `${lang}:${q.toLowerCase()}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return ok(hit.value)
  // Nominatim's one request per second, for this route's own calls, inside the per-minute budget it shares with reverse geocoding (commit gate, codex).
  const [free, second] = await Promise.all([rateLimit('geocode-fallback-global', 'global', PER_MIN_GLOBAL, '1 m', { strict: true }), rateLimit('geocode-search-second', 'global', 1, '1 s', { strict: true })])
  if (!free.success || !second.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  try {
    const u = new URL('https://nominatim.openstreetmap.org/search')
    for (const [k, v] of [['format', 'jsonv2'], ['q', q], ['countrycodes', 'vn'], ['limit', '5'], ['accept-language', lang], ['viewbox', `${VN.minLng},${VN.maxLat},${VN.maxLng},${VN.minLat}`], ['bounded', '1']]) u.searchParams.set(k, v)
    const res = await fetch(u, { headers: { 'User-Agent': 'eno.vn Marketplace/1.0 (https://eno.vn)' }, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return NextResponse.json({ error: 'geocode_failed' }, { status: 502 })
    const rows = (await res.json().catch(() => [])) as { display_name?: unknown; lat?: unknown; lon?: unknown }[]
    const results = (Array.isArray(rows) ? rows : [])
      .map((r) => ({ label: String(r.display_name ?? '').replace(/,\s*(Việt Nam|Vietnam|Viet Nam)$/i, '').slice(0, 200), lat: Number(r.lat), lng: Number(r.lon) }))
      .filter((p) => p.label && p.lat >= VN.minLat && p.lat <= VN.maxLat && p.lng >= VN.minLng && p.lng <= VN.maxLng)
    if (cache.size >= CACHE_MAX) { const oldest = cache.keys().next().value; if (oldest !== undefined) cache.delete(oldest) }
    cache.set(key, { at: Date.now(), value: results })
    return ok(results)
  } catch {
    return NextResponse.json({ error: 'geocode_failed' }, { status: 502 })
  }
})
