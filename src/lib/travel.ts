// Friendly "how far is this from me" estimate for a listing on the map — NOT turn-by-turn
// routing (no external API/keys/cost). We take the straight-line (haversine) distance,
// inflate it by a road-detour factor (streets wander more than a crow flies), and divide
// by an average speed that scales from dense city traffic (short hops) up to intercity
// highway (long trips) — so it reflects "roads in the respective city" for local trips and
// motorway speeds for intercity. Returns null when it's clearly not a road trip
// (different country / intercontinental), so we never show a nonsense "drive to Europe".

import { haversineKm } from '@/lib/geo'

export type LatLng = { lat: number; lng: number }

// Past this it's not a same-region drive (intercountry / intercontinental) — don't estimate.
const MAX_ROAD_KM = 700

export type TravelEstimate = { straightKm: number; roadKm: number; minutes: number }

export function estimateTravel(from: LatLng, to: LatLng): TravelEstimate | null {
  const straight = haversineKm(from, to)
  if (!Number.isFinite(straight) || straight > MAX_ROAD_KM) return null
  // Detour factor: city streets wind more than highways.
  const detour = straight < 15 ? 1.4 : straight < 60 ? 1.3 : 1.2
  const roadKm = straight * detour
  // Average road speed (km/h): dense-city traffic for short hops → highway for intercity.
  const speed = straight < 12 ? 22 : straight < 40 ? 30 : straight < 120 ? 50 : 65
  const minutes = Math.max(1, Math.round((roadKm / speed) * 60))
  return { straightKm: straight, roadKm, minutes }
}

/** Localised "4,2 km" / "13 phút" strings (vi uses a comma decimal). */
export function formatTravel(e: TravelEstimate, lang: 'en' | 'vi'): { dist: string; time: string } {
  const km = e.roadKm
  const distNum = km < 10 ? km.toFixed(1) : Math.round(km).toString()
  const dist = `${lang === 'vi' ? distNum.replace('.', ',') : distNum} km`
  const m = e.minutes
  let time: string
  if (m < 60) {
    time = `${m} ${lang === 'vi' ? 'phút' : 'min'}`
  } else {
    const h = Math.floor(m / 60)
    const rem = m % 60
    const hUnit = lang === 'vi' ? ' giờ' : 'h'
    const mUnit = lang === 'vi' ? ' phút' : 'm'
    time = rem ? `${h}${hUnit} ${rem}${mUnit}` : `${h}${hUnit}`
  }
  return { dist, time }
}
