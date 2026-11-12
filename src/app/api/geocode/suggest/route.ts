import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { photonBase, photonUrl, toSuggestions, type PlaceSuggestion } from '@/lib/geo-suggest'

export const dynamic = 'force-dynamic'

/**
 * PLACES AS THE SELLER TYPES (owner, 2026-11-12: "show suggestions like macdonalds thao dien show exact address … similar to
 * shoppee address or grab"; chose "Free OpenStreetMap" on our own server). Asks the `eno-photon` container (src/lib/geo-suggest.ts):
 * the text stays on eno's own box, so there is no outside budget to share and no per-request cost — only a per-account limit
 * sized for typing (the picker waits a quarter second between keystrokes).
 *
 * `available: false` = this server is missing or down (not "no place"): the picker then falls back to Enter, which asks
 * Nominatim through /api/geocode/search as before. Two failures in a row are remembered for half a minute so a typing seller
 * does not wait on a dead address at every keystroke.
 */
const TIMEOUT_MS = 2000
const DOWN_MS = 30_000
const CACHE_MS = 24 * 3600 * 1000
const CACHE_MAX = 2000
const cache = new Map<string, { at: number; value: PlaceSuggestion[] }>()
let downUntil = 0
// Two failures in a row before the half-minute pause: one slow answer (a cold start, a pause) must not turn the
// suggestions off for every seller (commit gate, opus). That request alone says "not available".
let failures = 0

// 300 a minute: one request per pause in typing is well under it, and a refusal shows as "press Enter", not an error.
export const GET = route({ auth: 'userId', rateLimit: { bucket: 'geocode-suggest', limit: 300, window: '1 m' } }, async ({ req }) => {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const lang = url.searchParams.get('lang') === 'vi' ? 'vi' : 'en'
  const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'))
  const near = url.searchParams.has('lat') && url.searchParams.has('lng') && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
  const ok = (results: PlaceSuggestion[], available = true) => NextResponse.json({ results, available }, { headers: { 'Cache-Control': 'no-store' } })
  if (q.length < 3) return ok([])
  // The bias point rounded to ~1 km: a nudged pin reuses the answer.
  const key = `${lang}:${near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : '-'}:${q.toLowerCase()}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return ok(hit.value)
  if (Date.now() < downUntil) return ok([], false)
  try {
    const res = await fetch(photonUrl(photonBase(), q, lang, near), { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
    // A query Photon refuses (400) is that query's answer; any other status (a 404 from a wrong path or version) is the server
    // being wrong, and counts as down (commit gate, opus).
    if (res.status === 400) { failures = 0; return ok([]) }
    if (!res.ok) throw new Error(`photon ${res.status}`)
    const body = (await res.json()) as { features?: unknown }
    const results = toSuggestions(body?.features)
    // Only answers with places are kept: an empty one may be a server still warming up (commit gate, opus).
    if (results.length) {
      if (cache.size >= CACHE_MAX) { const oldest = cache.keys().next().value; if (oldest !== undefined) cache.delete(oldest) }
      cache.set(key, { at: Date.now(), value: results })
    }
    failures = 0
    return ok(results)
  } catch {
    // After the pause, two new failures again: one slow answer after an outage is not a second outage (commit gate, opus).
    if (++failures >= 2) { downUntil = Date.now() + DOWN_MS; failures = 0 }
    return ok([], false)
  }
})
