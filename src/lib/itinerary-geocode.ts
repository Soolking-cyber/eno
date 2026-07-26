import 'server-only'
import { db } from './db'
import { fold } from './fold'
import { CITY_MAP, type CityId } from './itinerary-data'
import { isInVietnam, isNearCity } from './itinerary-geo'
import { rateLimit } from './ratelimit'

/**
 * GEOCODE ONCE, REMEMBER FOREVER.
 *
 * The landmark catalogue will never hold the places a real itinerary names — a restaurant, a
 * water-puppet theatre, a wharf park. Measured on production: of six stops, compound-splitting can
 * reach two and the other four are exactly that kind of venue. They are not catalogue gaps to fill
 * by hand; they are the long tail, and it never ends.
 *
 * So each unique (place, city) is looked up ONCE in the product's lifetime and the answer is kept.
 * The catalogue self-grows: the second traveller to be sent to Cuc Gach Quan costs nothing, and the
 * table is small because places repeat far more than they vary.
 *
 * ⚠️ THE MODEL IS NEVER ASKED FOR COORDINATES, and this module is not a way around that. That was
 * the original plan for this work and BOTH external reviewers refuted it independently: the
 * validation radii are 25–120km, so a hallucinated point sits comfortably inside `isNearCity` while
 * being in the wrong district — a pin that is confidently, invisibly wrong. A geocoder answers from
 * a gazetteer; a language model answers from a plausible-sounding average. The existing comment in
 * generate/route.ts saying the model is never asked for coordinates is CORRECT and stays.
 *
 * ⚠️ EVERY COORDINATE PASSES THE SAME GATES AS THE CATALOGUE — isInVietnam, then isNearCity against
 * the city it was looked up for — BEFORE it is cached or returned. A geocoder will happily return
 * Portland, Oregon for "Saigon Kitchen". The provider is a source, not an authority.
 */

/** Providers, in order. Google only when a key is actually configured — the same rule the
 *  reverse-geocode route follows, so an unset key means the free provider rather than a wasted
 *  failing round-trip. Not the translate key: that one is a different product and may be
 *  referrer-restricted. */
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY

/** Bound every upstream. A hung provider must never hold a generation open. */
const PROVIDER_TIMEOUT_MS = 4000

/**
 * Outbound lookups per DAY, across all users — the hard cost ceiling (see geocodePlace).
 *
 * 500/day ≈ $2.50/day at Google's ~$5/1000, so ~$75/month if it were saturated every single day.
 * It will not be: every answer is remembered, so the steady state trends towards zero as the
 * catalogue self-grows, and 500 novel places a day is far above launch traffic. Env-overridable so
 * a real spike can be widened without a deploy — but it is a LIMIT, so the fallback is the
 * constant, never "unset means unlimited".
 */
const GEOCODE_DAILY_LIMIT = Number(process.env.GEOCODE_DAILY_LIMIT) > 0
  ? Number(process.env.GEOCODE_DAILY_LIMIT)
  : 500

export type GeocodeHit = { lat: number; lng: number; source: 'cache' | 'google' | 'nominatim' }

/**
 * The cache key.
 *
 * ⚠️ THE CATALOGUE'S OWN FOLD, imported rather than reimplemented. I wrote a second copy first —
 * same rules, same output on every case I tried — and that is exactly the drift that bites later:
 * two normalisers agreeing today and disagreeing after somebody fixes one of them means a place
 * geocoded under one key and looked up under another, silently paying for the same lookup forever.
 */
export const foldPlaceKey = (name: string): string => fold(name ?? '')

/**
 * Look up a place, preferring the remembered answer.
 *
 * Returns null on anything uncertain. A miss must leave the stop unmapped — an approximate pin is
 * worse than no pin, because the traveller cannot tell which they are looking at.
 */
export async function geocodePlace(name: string, cityId: CityId): Promise<GeocodeHit | null> {
  const key = foldPlaceKey(name)
  if (!key) return null
  const city = CITY_MAP.get(cityId)
  if (!city) return null

  const cached = await readCache(key, cityId)
  if (cached) return cached

  // ⚠️ THE SPEND CEILING, and it has to live HERE because no GCP-side control can cover it.
  //
  // Google Geocoding bills ~$5/1000. The volume ceiling above this is
  // MAX_GEOCODES_PER_PASS (8) × the global AI day cap (AI_GLOBAL_DAILY_LIMIT = 2000) = 16,000
  // lookups/day ≈ $80/day ≈ $2,400/month in the worst case. The cache makes that wildly
  // pessimistic in practice — places repeat — but "unlikely" is not a limit.
  //
  // A project quota override cannot help: the working key belongs to a DIFFERENT GCP project, so
  // its usage bills that project's account and is invisible to this one's budgets and quotas.
  // The only control that holds whichever key is configured is this one, in our own code.
  //
  // Counted AFTER the cache read, so a remembered answer is free and the budget is only ever
  // spent on a genuinely new place. Covers both providers: Nominatim is free but rate-policed,
  // and one ceiling for "outbound lookups" is easier to reason about than two.
  //
  // strict: true — fails CLOSED. src/lib/ratelimit.ts names geocode as exactly this case: if the
  // limiter errors, an outage must not silently un-cap a billing drain. A skipped lookup leaves
  // the stop unmapped, which is a known state the whole module is already built around.
  const budget = await rateLimit('geocode-global', 'global', GEOCODE_DAILY_LIMIT, '1 d', { strict: true })
  if (!budget.success) {
    console.warn('[itinerary-geocode] daily lookup ceiling reached — leaving stop unmapped')
    return null
  }

  const fetched = (await geocodeGoogle(name, cityId).catch(() => null))
    ?? (await geocodeNominatim(name, cityId).catch(() => null))
  if (!fetched) return null

  // THE GATES. Applied to the provider's answer, not to our own cache write, so a bad coordinate
  // never reaches the table in the first place — a poisoned cache row would otherwise be permanent.
  if (!isInVietnam(fetched.lat, fetched.lng)) return null
  if (!isNearCity({ lat: fetched.lat, lng: fetched.lng }, { lat: city.lat, lng: city.lng }, cityId)) return null

  await writeCache(key, cityId, fetched)
  return fetched
}

// ── the remembered answers ────────────────────────────────────────────────────────────────
//
// ⚠️ RAW SQL, NOT A PRISMA MODEL, and that is a scope constraint rather than a preference.
// prisma/schema.prisma is not in this task's owned paths, so the table is created by
// scripts/place-geocode-ddl.sql (the repo's established pattern — BannedIdentity, Notification,
// PriceChange and half a dozen others were all added this way) and read through $queryRaw, exactly
// as the rate limiter reads rl_check. Flagged for Alex: this belongs in the Prisma schema once
// somebody owns that file, at which point these two helpers collapse into ordinary queries.
//
// ⚠️ EVERY PATH FAILS SOFT. If the table does not exist yet — which is true until the DDL is
// applied — the cache read and write both no-op and geocoding still works, just without memory.
// A missing cache must degrade the feature's COST, never its correctness.

async function readCache(key: string, cityId: string): Promise<GeocodeHit | null> {
  try {
    const rows = await db.$queryRaw<Array<{ lat: number; lng: number }>>`
      select lat, lng from "PlaceGeocode" where "placeKey" = ${key} and "cityId" = ${cityId} limit 1`
    const row = rows[0]
    return row ? { lat: row.lat, lng: row.lng, source: 'cache' } : null
  } catch {
    return null
  }
}

async function writeCache(key: string, cityId: string, hit: GeocodeHit): Promise<void> {
  try {
    // ON CONFLICT DO NOTHING: two generations racing the same new place both geocode, and the
    // loser simply keeps the winner's row. There is nothing to reconcile — they asked the same
    // question of the same gazetteer.
    await db.$executeRaw`
      insert into "PlaceGeocode" ("placeKey", "cityId", lat, lng, source)
      values (${key}, ${cityId}, ${hit.lat}, ${hit.lng}, ${hit.source})
      on conflict ("placeKey", "cityId") do nothing`
  } catch {
    /* no table yet, or a transient failure — the lookup still returned, it just is not remembered */
  }
}

// ── providers ─────────────────────────────────────────────────────────────────────────────

/** The city name is appended so the gazetteer disambiguates — "Botanical Gardens" alone is a
 *  question with a hundred answers, and the nearest one to the equator is not the intended one. */
function queryFor(name: string, cityId: CityId): string {
  const city = CITY_MAP.get(cityId)
  return `${name}, ${city?.name ?? ''}, Vietnam`.replace(/,\s*,/g, ',')
}

async function geocodeGoogle(name: string, cityId: CityId): Promise<GeocodeHit | null> {
  if (!GOOGLE_KEY) return null
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(queryFor(name, cityId))}&region=vn&key=${GOOGLE_KEY}`
  const res = await fetch(url, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
  if (!res.ok) return null
  const data = await res.json()
  if (data.status !== 'OK' || !data.results?.length) return null
  const loc = data.results[0]?.geometry?.location
  if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') return null
  return { lat: loc.lat, lng: loc.lng, source: 'google' }
}

/**
 * Nominatim's one-request-per-second policy, enforced HERE rather than by the caller.
 *
 * ⚠️ IT LIVED IN THE CALLER AND WAS BYPASSABLE TWO WAYS, both of which were live:
 *  1. The delay was conditional on `!GOOGLE_KEY`, on the assumption that a configured key means
 *     Google answers. It does not follow. A key that is present but REFUSED — which is exactly
 *     the state of this project's key, since Maps Platform is billing-blocked — falls straight
 *     through to Nominatim with the delay switched off. Configuring the key would therefore have
 *     started hammering a free community service, i.e. made things worse than having no key.
 *  2. The caller `continue`d on a miss before reaching its own sleep, so a run of unresolvable
 *     names issued back-to-back requests even with no key configured at all.
 *
 * Both disappear once the throttle belongs to the function that makes the request: it cannot be
 * skipped by a control-flow path, and it does not care which provider the caller HOPED would win.
 * The gap is measured from the last request rather than slept unconditionally, so a cache hit or a
 * catalogue hit in between costs nothing.
 */
const NOMINATIM_MIN_SPACING_MS = 1100
let lastNominatimAt = 0
async function throttleNominatim(): Promise<void> {
  const wait = lastNominatimAt + NOMINATIM_MIN_SPACING_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastNominatimAt = Date.now()
}

async function geocodeNominatim(name: string, cityId: CityId): Promise<GeocodeHit | null> {
  await throttleNominatim()
  // countrycodes=vn narrows before we do — cheaper than rejecting a Portland result afterwards,
  // though isInVietnam still runs either way.
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=vn&q=${encodeURIComponent(queryFor(name, cityId))}`
  const res = await fetch(url, {
    // Nominatim's usage policy REQUIRES an identifying User-Agent; anonymous clients get blocked.
    headers: { 'User-Agent': 'eno.vn Marketplace/1.0 (https://eno.vn)' },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  })
  if (!res.ok) return null
  const data = await res.json()
  const top = Array.isArray(data) ? data[0] : null
  const lat = Number(top?.lat)
  const lng = Number(top?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng, source: 'nominatim' }
}

// ── filling stops that are already saved ──────────────────────────────────────────────────

/**
 * A generation is ALREADY the most expensive path in the app; it must not also wait on a gazetteer.
 * So this runs AFTER the response has been sent (Next's `after`), against the rows that were just
 * saved. The traveller gets their plan at the usual speed and the pins appear a moment later —
 * and, because every answer is remembered, only ever the FIRST time anyone is sent somewhere new.
 *
 * ⚠️ BOUNDED, and the bound is not arbitrary. Nominatim's usage policy is one request per second,
 * so an unbounded pass over a 10-day plan would sit in `after` for half a minute and be killed
 * mid-way on a serverless host. Whatever is left simply stays unmapped and is picked up by the next
 * generation or the backfill script — an unmapped stop is a known state, not a broken one.
 */
const MAX_GEOCODES_PER_PASS = 8

export async function fillMissingStopCoordinates(
  itineraryId: string,
  cityIds: readonly CityId[],
  resolveCityForArea: (area: string) => CityId | null,
): Promise<{ attempted: number; filled: number }> {
  let attempted = 0
  let filled = 0
  try {
    const stops = await db.itineraryStop.findMany({
      where: { lat: null, day: { itineraryId } },
      select: { id: true, place: true, day: { select: { area: true } } },
      orderBy: { id: 'asc' },
      take: MAX_GEOCODES_PER_PASS,
    })
    for (const stop of stops) {
      // The trip's own cities only — never a nationwide lookup, for the same reason findPlace
      // refuses one: a same-named place in another province is a pin ~1000km away.
      const cityId = resolveCityForArea(stop.day.area) ?? (cityIds.length === 1 ? cityIds[0] : null)
      if (!cityId || !stop.place) continue
      attempted += 1
      const hit = await geocodePlace(stop.place, cityId)
      if (!hit) continue
      // Only ever fills a NULL. A coordinate somebody (or something) already set is not overwritten
      // by a gazetteer guess.
      const written = await db.itineraryStop.updateMany({
        where: { id: stop.id, lat: null },
        data: { lat: hit.lat, lng: hit.lng },
      })
      if (written.count === 1) filled += 1
      // No sleep here any more — throttleNominatim owns the spacing, so it applies on a MISS too
      // (this loop used to `continue` past the delay) and is not disabled by a configured-but-
      // refused Google key.
    }
  } catch (e) {
    // Best-effort by design: the itinerary is saved and served either way.
    console.error('[itinerary-geocode] fill pass failed', (e as Error)?.message?.slice(0, 200))
  }
  return { attempted, filled }
}
