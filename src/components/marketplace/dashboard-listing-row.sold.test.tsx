// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SerializedListing } from '@/lib/types'

/**
 * THE DASHBOARD'S "MARK SOLD", END TO END (B6) — the real row, the real useListingActions, the real
 * mark-sold flow and sheet; only the network, the router and the image component are stand-ins.
 * dashboard-listing-row.test.tsx pins the wiring with the flow stubbed; this pins what a seller sees:
 * nobody ever messaged (the route PROVES it) → "someone not on eno" is already picked (one tap); an empty
 * list the route cannot vouch for → nothing is picked; the row flips to Sold at once, and a refusal puts it
 * back and says why.
 *
 * ⚠️ EXPLICIT `cleanup` — no vitest globals, so Testing Library registers no afterEach of its own.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
const toasts = vi.hoisted(() => ({ success: [] as string[], error: [] as string[] }))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: (m: string) => { toasts.success.push(m) }, error: (m: string) => { toasts.error.push(m) } }),
}))
const lang = vi.hoisted(() => ({ lang: 'en', tr: (en: string) => en, t: (k: string) => k, setLang: () => {} }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => lang, useTr: () => lang.tr }))
vi.mock('./quick-discount', () => ({ QuickDiscount: () => null }))
vi.mock('./listing-sparkline', () => ({ ListingSparkline: () => null }))
vi.mock('./price', () => ({ Price: () => null }))
vi.mock('next/image', () => ({ default: () => null }))

const { DashboardListingRow } = await import('./dashboard-listing-row')

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
  Element.prototype.getAnimations ??= () => []
  Element.prototype.scrollIntoView ??= () => {}
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
  }
})

const LISTING = {
  id: 'l1', title: 'Road bike', titleVi: null, images: [], price: 1_000_000, currency: '₫', priceUnit: null,
  verified: true, status: 'active', views: 3, contactCount: 0, savedCount: 0, listingType: 'sell', category: { slug: 'sports' },
} as unknown as SerializedListing

let calls: { url: string; method: string; body?: unknown }[] = []
let buyers: unknown[] = []
/** What the route vouches for beside the list (GET /buyers?scope=listing). */
let nobodyMessaged = true
let soldStatus = 200

beforeEach(() => {
  calls = []
  buyers = []
  nobodyMessaged = true
  soldStatus = 200
  toasts.success.length = 0
  toasts.error.length = 0
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const json = (status: number, body: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response)
    if (url === '/api/listings/l1/buyers?scope=listing') return json(200, { buyers, nobodyMessaged, asksBuyer: true })
    if (url === '/api/listings/l1/sold' && method === 'POST') return json(soldStatus, soldStatus === 200 ? { ok: true } : { error: 'server_error' })
    return json(200, {})
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
async function openSheet() {
  render(<DashboardListingRow listing={LISTING} onChanged={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Mark sold' }))
  const title = await screen.findByText('Who bought it?')
  await settle()
  return title.closest('[role="dialog"]') as HTMLElement
}
/** The row's own status chip — outside the sheet, which (being modal) hides the page from role queries. */
const statusChip = () => screen.getAllByText(/^(Live|Sold)$/).find((el) => !el.closest('[role="dialog"]'))?.textContent

describe('the dashboard\'s "Mark sold" on a sale (B6)', () => {
  it('nobody messaged → "someone not on eno" is already picked: ONE tap files it, the row says Sold, the sheet closes', async () => {
    const s = await openSheet()
    expect(calls.filter((c) => c.url.includes('/buyers'))).toEqual([{ url: '/api/listings/l1/buyers?scope=listing', method: 'GET', body: undefined }])
    expect(within(s).getByRole('radio', { name: /Someone not on eno/ }).getAttribute('aria-checked')).toBe('true')
    await act(async () => { fireEvent.click(within(s).getByRole('button', { name: 'Mark as sold' })) })
    await settle()
    expect(calls.filter((c) => c.url === '/api/listings/l1/sold')).toEqual([{ url: '/api/listings/l1/sold', method: 'POST', body: { channel: 'external', salePrice: 1_000_000 } }])
    expect(calls.some((c) => c.url.endsWith('/status'))).toBe(false)
    expect(statusChip()).toBe('Sold')
    expect(toasts.success).toEqual(['Marked as sold'])
  })

  it('⛔ an EMPTY list the route cannot vouch for (a thread may have moved away) → nothing is picked, and the line says only what is known', async () => {
    nobodyMessaged = false
    const s = await openSheet()
    expect(within(s).getByRole('radio', { name: /Someone not on eno/ }).getAttribute('aria-checked')).toBe('false')
    expect((within(s).getByRole('button', { name: 'Mark as sold' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(s).getByText('No chat is linked to this listing right now.')).toBeTruthy()
    expect(within(s).queryByText('Nobody has messaged about this listing yet.')).toBeNull()
    // The seller can still say it themselves — one more tap, never a guess filed for them.
    await act(async () => { fireEvent.click(within(s).getByRole('radio', { name: /Someone not on eno/ })) })
    await act(async () => { fireEvent.click(within(s).getByRole('button', { name: 'Mark as sold' })) })
    await settle()
    expect(calls.filter((c) => c.url === '/api/listings/l1/sold').map((c) => c.body)).toEqual([{ channel: 'external', salePrice: 1_000_000 }])
  })

  it('someone DID message → nobody is pre-picked (no thread to say who): the seller chooses, and that person is named', async () => {
    buyers = [{ conversationId: 'c1', profileId: 'p-minh', name: 'Minh', avatarUrl: null, avatarColor: null, lastMessageAt: '2026-10-01T00:00:00.000Z' }]
    const s = await openSheet()
    expect((within(s).getByRole('button', { name: 'Mark as sold' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { fireEvent.click(within(s).getByRole('radio', { name: /Minh/ })) })
    // The promise is on: the route says naming someone really asks them (`asksBuyer`).
    expect(within(s).getByText('Minh will be asked to confirm.')).toBeTruthy()
    await act(async () => { fireEvent.click(within(s).getByRole('button', { name: 'Mark as sold' })) })
    await settle()
    expect(calls.filter((c) => c.url === '/api/listings/l1/sold').map((c) => c.body)).toEqual([{ buyerProfileId: 'p-minh', salePrice: 1_000_000 }])
  })

  it('⛔ a refusal puts the row back to Live and says why in the sheet — never a silent undo, never a stale Sold', async () => {
    soldStatus = 500
    const s = await openSheet()
    await act(async () => { fireEvent.click(within(s).getByRole('button', { name: 'Mark as sold' })) })
    await settle()
    expect(statusChip()).toBe('Live')
    expect(within(s).getByRole('alert').textContent).toBe('Could not mark as sold — please try again.')
    expect((within(s).getByRole('button', { name: 'Mark as sold' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
