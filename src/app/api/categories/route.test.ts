import { describe, expect, it, vi } from 'vitest'

/**
 * GET /api/categories — THE NATIVE APPS' POST SCHEMA, AND ITS `licenceCheck` FLAG (owner, 2026-10-14).
 *
 * e-Visa (services/visa-legal) and Legal & permits (services/legal-permits) listings need the provider's registered
 * business name and licence number and wait for eno's licence check. Today's iOS and Android builds still offer both
 * aisles and send no values, so a post there is refused with a bilingual sentence; the flag is what the NEXT builds
 * read to hide the two aisles or ask for the fields. It is ADDITIVE — a real boolean on EVERY subcategory, true for
 * exactly those two — and the aisles themselves stay in the list (plan review R8: the apps browse from it too).
 *
 * ⚠️ DATA SAFETY — the database and the wrapper's auth/limiter are mocked by name.
 */

type Row = Record<string, any>

vi.mock('@/lib/db', async () => {
  const { TAXONOMY } = await vi.importActual<typeof import('@/lib/taxonomy')>('@/lib/taxonomy')
  return { db: { category: { findMany: async () => TAXONOMY.map((c) => ({ slug: c.slug, name: c.name, nameVi: c.nameVi })) } } }
})
vi.mock('@/lib/admin', () => ({ getAdmin: async () => null, getCurrentProfile: async () => null, getCurrentProfileId: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

import { NextRequest } from 'next/server'
const { GET } = await import('./route')

async function categories(): Promise<Row[]> {
  const res = await GET(new NextRequest('https://eno.vn/api/categories'))
  expect(res.status).toBe(200)
  return ((await res.json()) as { categories: Row[] }).categories
}

describe('GET /api/categories — licenceCheck', () => {
  it('⛔ is true for exactly services/visa-legal and services/legal-permits', async () => {
    const flagged = (await categories()).flatMap((c) => (c.subcategories as Row[]).filter((s) => s.licenceCheck).map((s) => `${c.slug}/${s.slug}`))
    expect(flagged.sort()).toEqual(['services/legal-permits', 'services/visa-legal'])
  })

  it('is a real boolean on EVERY subcategory (no absent-vs-false for a client to tell apart)', async () => {
    const subs = (await categories()).flatMap((c) => c.subcategories as Row[])
    expect(subs.length).toBeGreaterThan(20)
    for (const s of subs) expect(typeof s.licenceCheck, s.slug).toBe('boolean')
  })

  it('keeps both aisles in the list, with the fields every client already reads (R8: the apps browse from it too)', async () => {
    const services = (await categories()).find((c) => c.slug === 'services')!
    for (const slug of ['visa-legal', 'legal-permits']) {
      expect((services.subcategories as Row[]).find((s) => s.slug === slug)).toMatchObject({ slug, name: expect.any(String), nameVi: expect.any(String), icon: expect.any(String), licenceCheck: true })
    }
  })
})

// GoPlus partnership (2026-10-19): the apartment amenities facet is MULTI-SELECT (src/lib/multi-facet.ts) — the apps'
// browse learns it from `multi`, a real boolean on every facet; "Has video" is filter-only, so it is not a post field.
describe('GET /api/categories — multi', () => {
  it('is true for exactly the rentals amenities facet, and a boolean everywhere', async () => {
    const facets = (await categories()).flatMap((c) => (c.facets as Row[]).map((f): Row => ({ ...f, cat: c.slug })))
    for (const f of facets) expect(typeof f.multi, `${f.cat}/${f.key}`).toBe('boolean')
    expect(facets.filter((f) => f.multi).map((f) => `${f.cat}/${f.key}`)).toEqual(['rentals/amenities'])
    expect(facets.some((f) => f.key === 'hasVideo')).toBe(false)
  })
})
