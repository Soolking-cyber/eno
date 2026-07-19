import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CITIES } from './itinerary-data'

// Drift guard (audit P2): the forum's /api/itineraries/generate hardcodes its own
// CITY_CATALOG (zod-enum source), duplicating the ids in itinerary-data's CITIES.
// Adding a city to the data without mirroring the catalog makes the client offer an
// option the server rejects AFTER the user filled the whole form. Same for the root
// app's own generate route. Static source extraction keeps this self-maintaining.

const GENERATE_ROUTES = [
  'src/app/api/itineraries/generate/route.ts',
  'apps/forum/src/app/api/itineraries/generate/route.ts',
]

function catalogIds(source: string): string[] {
  const start = source.indexOf('const CITY_CATALOG')
  const end = source.indexOf('} as const', start)
  const block = source.slice(start, end)
  return [...block.matchAll(/^\s{2}([a-z]+): \{ name:/gm)].map((m) => m[1])
}

describe('itinerary CITY_CATALOG ↔ CITIES drift', () => {
  const dataIds = CITIES.map((c) => c.id).sort()

  for (const route of GENERATE_ROUTES) {
    it(`${route} catalog matches itinerary-data CITIES`, () => {
      const ids = catalogIds(readFileSync(route, 'utf8')).sort()
      expect(ids, `catalog ids in ${route}`).toEqual(dataIds)
    })
  }
})
