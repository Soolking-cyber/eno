/**
 * ⛔ ONE SAFETY VOICE (batch 62): the listing page's bottom note is printed only where the SafetyStrip on the same page does
 * not already say it. The strip picks its line by CATEGORY, so this matrix walks category against listing type, both editions.
 */
import { describe, expect, it } from 'vitest'
import { pdpSafetyNoteKind, stripLineKind } from './pdp-safety-note'

const base = { listingType: 'sell', categorySlug: 'furniture-appliances', subcategorySlug: null as string | null, linked: false, visaCopyHeld: false, forum: false }
const kind = (o: Partial<typeof base>) => pdpSafetyNoteKind({ ...base, ...o })

describe('pdpSafetyNoteKind', () => {
  it('a job and a linked listing never print one (the strip carries their lines)', () => {
    for (const forum of [false, true]) {
      expect(kind({ listingType: 'job', categorySlug: 'jobs', forum })).toBeNull()
      expect(kind({ listingType: 'job', categorySlug: 'services', forum })).toBeNull()
      expect(kind({ linked: true, forum })).toBeNull()
      expect(kind({ linked: true, listingType: 'rent', categorySlug: 'rentals', forum })).toBeNull()
    }
  })

  it('rentals and property: none — the strip\'s housing line has the owner\'s papers, its vehicle-hire line the chassis', () => {
    for (const forum of [false, true]) {
      for (const listingType of ['rent', 'sell', 'wanted']) {
        expect(kind({ listingType, categorySlug: 'rentals', subcategorySlug: 'apartment-rental', forum })).toBeNull()
        expect(kind({ listingType, categorySlug: 'rentals', subcategorySlug: 'motorbike-rental', forum })).toBeNull()
        expect(kind({ listingType, categorySlug: 'property', forum })).toBeNull()
      }
    }
  })

  it('a rental filed elsewhere: none beside the vehicle line (papers, no deposit through a link); kept beside goods or job lines', () => {
    for (const forum of [false, true]) {
      expect(kind({ listingType: 'rent', categorySlug: 'vehicles', subcategorySlug: 'motorbike', forum })).toBeNull()
      expect(kind({ listingType: 'rent', categorySlug: 'vehicles', subcategorySlug: 'parts-gear', forum })).toBe('rent')
      expect(kind({ listingType: 'rent', categorySlug: 'electronics', forum })).toBe('rent')
      expect(kind({ listingType: 'rent', categorySlug: 'services', forum })).toBe('rent')
      expect(kind({ listingType: 'rent', categorySlug: 'jobs', forum })).toBe('rent')
    }
  })

  it('a non-job filed under Jobs keeps its goods note: the strip there says the job line', () => {
    for (const forum of [false, true]) for (const listingType of ['sell', 'wanted']) expect(kind({ listingType, categorySlug: 'jobs', forum })).toBe('goods')
  })

  it('a service keeps its note (who holds the licence); the e-visa page keeps the line it had', () => {
    for (const forum of [false, true]) {
      expect(kind({ listingType: 'service', categorySlug: 'services', subcategorySlug: 'cleaning', forum })).toBe('service')
      expect(kind({ listingType: 'sell', categorySlug: 'services', forum })).toBe('service')
      expect(kind({ listingType: 'service', categorySlug: 'services', subcategorySlug: 'visa-legal', visaCopyHeld: true, forum })).toBe('goods')
    }
  })

  it('a vehicle for sale keeps its note (meet in public; the strip speaks of the chassis); parts are goods', () => {
    expect(kind({ categorySlug: 'vehicles', subcategorySlug: 'motorbike' })).toBe('goods')
    expect(kind({ categorySlug: 'vehicles', subcategorySlug: null })).toBe('goods')
    expect(kind({ categorySlug: 'vehicles', subcategorySlug: 'parts-gear' })).toBeNull()
  })

  it('plain goods: none on eno.vn (the strip\'s goods line is the same advice); eno.forum keeps its own-voiced note', () => {
    for (const categorySlug of ['furniture-appliances', 'electronics', 'fashion']) {
      for (const listingType of ['sell', 'wholesale', 'wanted']) {
        expect(kind({ categorySlug, listingType })).toBeNull()
        expect(kind({ categorySlug, listingType, forum: true })).toBe('goods')
      }
    }
    expect(kind({ categorySlug: 'vehicles', subcategorySlug: 'parts-gear', forum: true })).toBe('goods')
  })
})

describe('stripLineKind — the one selector the strip and the note share', () => {
  it('job, vehicle, housing, goods', () => {
    expect(stripLineKind('jobs', null, false)).toBe('job')
    expect(stripLineKind('electronics', null, true)).toBe('job')
    expect(stripLineKind('vehicles', 'motorbike', false)).toBe('vehicle')
    expect(stripLineKind('vehicles', null, false)).toBe('vehicle')
    expect(stripLineKind('rentals', 'motorbike-rental', false)).toBe('vehicle')
    expect(stripLineKind('rentals', 'car-rental', false)).toBe('vehicle')
    expect(stripLineKind('rentals', 'apartment-rental', false)).toBe('housing')
    expect(stripLineKind('rentals', null, false)).toBe('housing')
    expect(stripLineKind('property', null, false)).toBe('housing')
    expect(stripLineKind('vehicles', 'parts-gear', false)).toBe('goods')
    expect(stripLineKind('furniture-appliances', null, false)).toBe('goods')
    expect(stripLineKind('services', 'cleaning', false)).toBe('goods')
  })
})
