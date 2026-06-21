import type { SerializedListing } from '@/lib/types'

// Lean geo helpers (no Leaflet) — safe to import anywhere without pulling the map
// bundle. Prefer stored coordinates; fall back to a deterministic district-based
// guess so every listing has a plottable point.
export function getListingCoordinates(listing: SerializedListing) {
  if (typeof listing.lat === 'number' && typeof listing.lng === 'number') {
    return { lat: listing.lat, lng: listing.lng }
  }
  const city = listing.city.toLowerCase()
  const district = (listing.district || '').toLowerCase()

  let baseLat = 10.7769 // HCMC center
  let baseLng = 106.7009

  if (city.includes('hanoi') || city.includes('hà nội')) {
    baseLat = 21.0285; baseLng = 105.8542
    if (district.includes('tay ho') || district.includes('tây hồ')) { baseLat = 21.0718; baseLng = 105.8152 }
    else if (district.includes('hoan kiem') || district.includes('hoàn kiếm')) { baseLat = 21.0285; baseLng = 105.8522 }
    else if (district.includes('cau giay') || district.includes('cầu giấy')) { baseLat = 21.0264; baseLng = 105.7977 }
  } else if (city.includes('danang') || city.includes('đà nẵng')) {
    baseLat = 16.0471; baseLng = 108.2068
    if (district.includes('son tra') || district.includes('sơn trà')) { baseLat = 16.0820; baseLng = 108.2435 }
    else if (district.includes('ngu hanh son') || district.includes('ngũ hành sơn')) { baseLat = 16.0279; baseLng = 108.2494 }
    else if (district.includes('hai chau') || district.includes('hải châu')) { baseLat = 16.0594; baseLng = 108.2199 }
  } else {
    if (district.includes('district 2') || district.includes('thao dien') || district.includes('quận 2')) { baseLat = 10.8016; baseLng = 106.7368 }
    else if (district.includes('binh thanh') || district.includes('bình thạnh')) { baseLat = 10.7981; baseLng = 106.7061 }
    else if (district.includes('district 1') || district.includes('quận 1')) { baseLat = 10.7769; baseLng = 106.7009 }
    else if (district.includes('district 7') || district.includes('phu my hung') || district.includes('quận 7')) { baseLat = 10.7226; baseLng = 106.7271 }
  }

  const idHash = listing.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const latOffset = ((idHash % 20) - 10) * 0.0009
  const lngOffset = (((idHash >> 2) % 20) - 10) * 0.0009
  return { lat: baseLat + latOffset, lng: baseLng + lngOffset }
}

/** Great-circle distance in km between two {lat,lng} points (Haversine). */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
