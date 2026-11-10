// @vitest-environment jsdom
import * as React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serializeListing } from '@/lib/serialize'
import type { SerializedListingCard } from '@/lib/types'

/**
 * Speed plan R20 (2026-11-10): the home page's "Outstanding businesses" and "Trending" rails stopped shipping
 * `description` and `descriptionVi` (src/lib/core/rail-listing.ts). That is only safe while the rail card never reads
 * them. Pinned here on the REAL rails and the REAL <ListingCard> with its real badges, price, partner badge and
 * availability toggle, fed exactly what the rail loaders shipped before R20 (the real serializeListing, both columns
 * filled), each row behind a Proxy that records every property the card reads. Only infrastructure is stubbed: the
 * router, next/image, the lazily-loaded video and slider, the signed-in state, favorites and the owner's Edit button
 * (which takes ids, not the listing).
 * ⚠️ IF THIS GOES RED, a rail card now reads the description: put it back in rail-listing.ts (or ship it another way)
 * before the card change ships, or the rail shows an empty field the feed does not.
 */

vi.setConfig({ testTimeout: 30_000 })

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, prefetch: vi.fn() }), usePathname: () => '/' }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text
  default: ({ fill: _f, priority: _p, unoptimized: _u, quality: _q, ...rest }: Record<string, unknown>) => <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}))
const openSignIn = vi.fn()
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn }) }))
vi.mock('@/context/favorites-context', () => ({
  useFavoriteMarks: () => ({ isFavorite: () => false, toggle: vi.fn(), savedDelta: () => 0 }),
}))
vi.mock('@/components/marketplace/owner-edit-button', () => ({ OwnerEditButton: () => null }))
// The card mounts its quick bar for a KEYBOARD focus only (`:focus-visible`, src/lib/focus-visible.ts), and jsdom's
// fireEvent.focus is not one. Answer "keyboard" here so the bar mounts and every control on it is pressed below.
vi.mock('@/lib/focus-visible', () => ({ isFocusVisible: () => true }))

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  } as Storage
}

// ── What the rail loaders shipped before R20: serializeListing over a full row ──────────────────────────────────────

const NOW = Date.now()
const HOUR = 3_600_000
const CAT = {
  rentals: { id: 'c-r', name: 'Rentals', nameVi: 'Cho thuê', slug: 'rentals', icon: 'home', color: 'blue', description: null },
  jobs: { id: 'c-j', name: 'Jobs', nameVi: 'Việc làm', slug: 'jobs', icon: 'briefcase', color: 'green', description: null },
  electronics: { id: 'c-e', name: 'Electronics', nameVi: 'Đồ điện tử', slug: 'electronics', icon: 'smartphone', color: 'purple', description: null },
  teachers: { id: 'c-t', name: 'Teachers', nameVi: 'Giáo viên', slug: 'teachers', icon: 'graduation-cap', color: 'orange', description: null },
  vehicles: { id: 'c-v', name: 'Vehicles', nameVi: 'Xe cộ', slug: 'vehicles', icon: 'bike', color: 'red', description: null },
}

function row(id: string, category: (typeof CAT)[keyof typeof CAT], over: Record<string, unknown> = {}, seller: Record<string, unknown> = {}) {
  return {
    id, title: `Listing ${id}`, titleVi: `Tin ${id}`,
    description: `The English description of ${id}. `.repeat(30), descriptionVi: `Mô tả tiếng Việt của ${id}. `.repeat(30),
    price: 12_000_000, priceUnit: 'VND', currency: 'VND', negotiable: true, sellerId: `s-${id}`,
    affiliateUrl: null, affiliateDiscountCode: null, affiliateDiscountPercent: null,
    previousPrice: null, priceDropAt: null, urgentUntil: null,
    location: 'Thảo Điền', district: 'Thủ Đức', city: 'Hồ Chí Minh', lat: null, lng: null, condition: 'used',
    images: JSON.stringify([`https://sb.example/storage/v1/object/public/l/${id}-1.webp`, `https://sb.example/storage/v1/object/public/l/${id}-2.webp`]),
    video: null, categoryId: category.id, subcategorySlug: null, brandSlug: null, model: null, listingType: 'sell',
    category, verified: true, status: 'active', postedAt: new Date(NOW - 2 * HOUR), createdAt: new Date(NOW - 2 * HOUR),
    views: 10, savedCount: 4, contactCount: 5, availabilityConfirmedAt: null, featured: false, attributes: null,
    year: null, mileageKm: null, engineL: null,
    seller: {
      id: `s-${id}`, name: 'Shop', avatarColor: 'blue', avatarUrl: null, rating: 4.8, reviewCount: 12, verifiedSeller: true,
      officialPartner: false, affiliateDiscountCode: null, affiliateDiscountPercent: null, trustTier: 'trusted', trustScore: 120,
      responseRate: 90, responseTime: 'within an hour', memberSince: new Date('2024-01-01'), ownerId: 'u1',
      owner: { accountType: 'business' }, ...seller,
    },
    ...over,
  } as unknown as Parameters<typeof serializeListing>[0]
}

/** One of each card branch a rail draws: a partner rental with a place (availability toggle, map pin), a job, a dropped and
 *  urgent phone with a video, a teacher, a vehicle. */
const ROWS = [
  row('rent', CAT.rentals, { subcategorySlug: 'apartment', priceUnit: 'VND/month', lat: 10.8, lng: 106.73, negotiable: false }, { officialPartner: true }),
  row('job', CAT.jobs, { listingType: 'job', price: 0, negotiable: false, attributes: JSON.stringify({ jobtype: 'fulltime' }) }),
  row('phone', CAT.electronics, {
    previousPrice: 15_000_000, priceDropAt: new Date(NOW - HOUR), urgentUntil: new Date(NOW + 24 * HOUR),
    video: 'https://sb.example/storage/v1/object/public/v/phone.mp4', brandSlug: 'apple', model: 'iPhone 15', condition: 'like_new',
  }),
  row('teacher', CAT.teachers, { listingType: 'teacher', price: 400_000, priceUnit: 'VND/hour' }, { owner: { accountType: 'individual' } }),
  row('bike', CAT.vehicles, { brandSlug: 'honda', model: 'Wave', year: 2021, mileageKm: 12_000, engineL: 0.11 }, { ownerId: null, owner: null }),
]

// ── The recorder ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Every property path read on a rail listing (`seller.trustScore`), `<path>*` for an enumeration of an object. */
const reads = new Set<string>()
/** Where a forbidden key was read from, for the failure message. */
const forbiddenAt: string[] = []
const FORBIDDEN = new Set(['description', 'descriptionVi'])

function note(path: string, key: PropertyKey) {
  if (typeof key !== 'string') return
  reads.add(path + key)
  if (path === '' && FORBIDDEN.has(key)) forbiddenAt.push(`${key}\n${new Error().stack}`)
}

/** A recording view of `obj`. Nested objects get one proxy each (cached), so identity holds across reads. */
function watched<T extends object>(obj: T, path = '', cache = new WeakMap<object, object>()): T {
  return new Proxy(obj, {
    get(t, k, r) {
      note(path, k)
      const v = Reflect.get(t, k, r)
      if (!v || typeof v !== 'object' || Array.isArray(v)) return v
      if (!cache.has(v)) cache.set(v, watched(v, `${path}${String(k)}.`, cache))
      return cache.get(v)
    },
    has(t, k) { note(path, k); return Reflect.has(t, k) },
    getOwnPropertyDescriptor(t, k) { note(path, k); return Reflect.getOwnPropertyDescriptor(t, k) },
    ownKeys(t) { reads.add(`${path}*`); return Reflect.ownKeys(t) },
  })
}

// Built once, outside any proxy: serializeListing is the pre-R20 wire, not the code under test.
const SHIPPED = ROWS.map((r) => serializeListing(r))
const seed = () => SHIPPED.map((l) => watched(l) as unknown as SerializedListingCard)

beforeEach(() => {
  reads.clear()
  forbiddenAt.length = 0
  push.mockClear()
  openSignIn.mockClear()
  vi.stubGlobal('localStorage', memoryStorage())
  // The Shelf's scroll arrows measure their scroller and the card asks for a touch pointer; jsdom has neither.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => null })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function mountRail(node: React.ReactNode) {
  const { LanguageProvider } = await import('@/context/language-context')
  const { CurrencyProvider } = await import('@/context/currency-context')
  const view = render(<LanguageProvider><CurrencyProvider seedUsd={26_000}>{node}</CurrencyProvider></LanguageProvider>)
  await act(async () => { await Promise.resolve() })
  return view
}

/** Everything a visitor can do to a rail card without leaving the page: point at it, focus it, open it, and press each
 *  of its controls (save, chat, offer, show on map, add to the availability check). */
async function exerciseEveryCard(container: HTMLElement) {
  const roots = [...container.querySelectorAll<HTMLElement>('[data-card-root]')]
  expect(roots).toHaveLength(SHIPPED.length)
  for (const root of roots) {
    await act(async () => {
      fireEvent.mouseEnter(root)
      fireEvent.focus(root)
      fireEvent.mouseLeave(root)
      fireEvent.click(root.querySelector<HTMLElement>('a[data-card-link]')!)
    })
    for (const b of [...root.querySelectorAll<HTMLButtonElement>('button')]) await act(async () => { fireEvent.click(b) })
  }
}

function expectNoDescriptionRead() {
  // The recorder is live: the card's ordinary reads arrive.
  for (const k of ['id', 'title', 'images', 'price', 'category.slug', 'seller.officialPartner']) expect(reads).toContain(k)
  expect(forbiddenAt, forbiddenAt.join('\n\n')).toEqual([])
  for (const k of FORBIDDEN) expect(reads).not.toContain(k)
  // …and nothing copied the listing whole (a spread or JSON.stringify), which would carry a description on to a reader
  // this test cannot see.
  expect(reads).not.toContain('*')
}

describe('the home rails never read a listing description (R20)', () => {
  it('"Outstanding businesses": render, hover, open and every control', async () => {
    const { BusinessRail } = await import('./business-rail')
    const { container } = await mountRail(<BusinessRail initial={seed()} />)
    await exerciseEveryCard(container)
    expect(push).toHaveBeenCalledWith('/listings/rent')
    expect(openSignIn).toHaveBeenCalled() // the chat and offer buttons ran (a guest is asked to sign in)
    expectNoDescriptionRead()
  })

  it('"Trending now": render, hover, open and every control, and the listing it hands the map', async () => {
    const located: unknown[] = []
    const onLocate = (e: Event) => { located.push((e as CustomEvent<{ listing?: unknown }>).detail.listing) }
    window.addEventListener('eno:locate', onLocate)
    try {
      const { ForYouRail } = await import('./for-you-rail')
      const listings = seed()
      const { container } = await mountRail(<ForYouRail initial={listings} />)
      await exerciseEveryCard(container)
      // "Show on map" hands the explorer this same card object; the explorer and the map type it SerializedListingCard,
      // which has no description field to read. (Compared by identity here: an `expect` on a listing would make the
      // matcher itself read the description.)
      expect(located.length).toBeGreaterThan(0)
      expect(located.every((l) => listings.includes(l as SerializedListingCard))).toBe(true)
    } finally {
      window.removeEventListener('eno:locate', onLocate)
    }
    expectNoDescriptionRead()
  })
})
