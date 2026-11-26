import { describe, expect, it } from 'vitest'
import { vehicleHubRelated } from './vehicle-hub-related'
import { GUIDES, guideEntry, isGuideLive } from './guides/registry'
import { VEHICLE_HUB_SLUGS } from './vehicle-hub-slugs'

const NOW = new Date('2026-11-26T12:00:00Z')

describe('vehicleHubRelated — "Keep reading" under a vehicle hub (OpenSEO audit 2026-11-26)', () => {
  it('the motorbike hub leads with the motorbike guides in its own language, then the car hub', () => {
    const vi = vehicleHubRelated('motorbike', 'vi', NOW)
    expect(vi[0].href).toBe('/huong-dan/thue-xe-may-sai-gon-kinh-nghiem')
    expect(vi.every((l) => l.href.startsWith('/huong-dan/') || l.href === `/${VEHICLE_HUB_SLUGS.car.vi}`)).toBe(true)
    expect(vi.at(-1)!.href).toBe(`/${VEHICLE_HUB_SLUGS.car.vi}`)
    const en = vehicleHubRelated('motorbike', 'en', NOW)
    expect(en[0].href).toBe('/guides/renting-a-motorbike-in-ho-chi-minh-city')
    expect(en.at(-1)!.href).toBe(`/${VEHICLE_HUB_SLUGS.car.en}`)
  })

  it('never a furniture or phone guide, never more than six (keepReading keeps the order), every card labelled', () => {
    for (const kind of ['car', 'motorbike'] as const) for (const lang of ['en', 'vi'] as const) {
      const links = vehicleHubRelated(kind, lang, NOW)
      expect(links.length).toBeGreaterThan(1)
      expect(links.length).toBeLessThanOrEqual(6)
      for (const l of links) {
        expect(l.href).not.toMatch(/furniture|do-cu|iphone|phone|dien-thoai/)
        expect(l.label.length).toBeGreaterThan(5)
        expect(l.label).not.toBe(l.href.split('/').pop())
      }
    }
  })

  it('only guides that exist, are live and are in the hub\'s language', () => {
    for (const kind of ['car', 'motorbike'] as const) for (const lang of ['en', 'vi'] as const) {
      for (const l of vehicleHubRelated(kind, lang, NOW).slice(0, -1)) {
        const e = guideEntry(l.href.split('/').pop()!)
        expect(e?.lang).toBe(lang)
        expect(isGuideLive(e!, NOW)).toBe(true)
      }
    }
    // A guide before its release day is left out, not linked early.
    const early = new Date('2026-11-01T00:00:00Z')
    expect(vehicleHubRelated('motorbike', 'vi', early).map((l) => l.href)).not.toContain('/huong-dan/thue-xe-may-sai-gon-kinh-nghiem')
    expect(GUIDES.length).toBeGreaterThan(0)
  })
})
