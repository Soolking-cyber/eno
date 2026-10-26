// @vitest-environment jsdom
import * as React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE LISTINGS CONSOLE PAGES (sweep 2026-10-22). It loaded only the newest 80 rows under "2,400 total", with no next page:
 * older held listings could be reached only by guessing a search. "Load more" asks for the next page by offset and
 * appends it; a deep link opens the console on a filter (the Overview's "awaiting review" tile: Active + Held).
 * ⚠️ EXPLICIT CLEANUP: no vitest `globals`, so Testing Library registers no afterEach of its own.
 */
const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))

import { AdminListingsClient } from './admin-listings-client'

// Newest first, like the route: Listing 0 is the newest. createdAt counts DOWN, one minute apart.
const at = (i: number) => new Date(Date.UTC(2026, 9, 14, 12, 0) - i * 60_000).toISOString()
const row = (i: number) => ({ id: `l${String(i).padStart(3, '0')}`, title: `Listing ${i}`, status: 'active', verified: false, price: 1000, currency: '₫', image: null, featured: false, sellerName: 'Shop', category: 'Phones', subcategory: 'phones-tablets', createdAt: at(i) })
// Pages of 3 (the app's are 80) keep the jsdom table cheap. A short page is the end.
const SIZE = 3
let table: ReturnType<typeof row>[] = []
const fetchMock = vi.fn()
beforeEach(() => {
  table = Array.from({ length: 5 }, (_, k) => row(k))
  fetchMock.mockReset()
  // The route's keyset: rows strictly after `before` (createdAt desc, id desc), then `limit` of them.
  fetchMock.mockImplementation(async (url: string) => {
    const p = new URL(url, 'http://x').searchParams
    const [bAt, bId] = (p.get('before') ?? '').split('~')
    const after = bAt ? table.filter((r) => r.createdAt < bAt || (r.createdAt === bAt && r.id < bId)) : table
    return { ok: true, status: 200, json: async () => ({ listings: after.slice(0, Number(p.get('limit'))), total: table.length }) }
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const asked = () => fetchMock.mock.calls.map(([u]) => Object.fromEntries(new URL(u as string, 'http://x').searchParams))

describe('AdminListingsClient — paging', () => {
  it('"Load more" asks for the rows after the last one shown, appends them, and goes when a short page ends the list', async () => {
    render(<AdminListingsClient pageSize={SIZE} />)
    await screen.findByText('Listing 0')
    expect(screen.getByText(/Showing 3 of 5/)).toBeTruthy()
    // Between pages a new listing lands on top and a shown one leaves the filter: a keyset neither repeats nor skips.
    table = [row(-1), ...table.filter((r) => r.id !== 'l001')]
    fireEvent.click(screen.getByRole('button', { name: 'Load more (3 of 5)' }))
    await screen.findByText('Listing 4')
    expect(asked().map((q) => [q.limit, q.before ?? ''])).toEqual([['3', ''], ['3', `${at(2)}~l002`]])
    expect(['Listing 3', 'Listing 4'].every((t) => screen.getAllByText(t).length === 1)).toBe(true)
    expect(screen.queryByText('Listing -1')).toBeNull()
    expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull()
  })

  it('a refused page is an error — the rows and "Load more" stay, never "0 total"', async () => {
    render(<AdminListingsClient pageSize={SIZE} />)
    await screen.findByText('Listing 0')
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({ error: 'internal_error' }) }))
    toast.error.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Load more (3 of 5)' }))
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not load listings'))
    expect(screen.getByRole('button', { name: 'Load more (3 of 5)' })).toBeTruthy()
    expect(screen.getByText(/Showing 3 of 5/)).toBeTruthy()
  })

  it('opens on the filter a deep link names', async () => {
    render(<AdminListingsClient initialStatus="active" initialVerified="false" pageSize={SIZE} />)
    await screen.findByText('Listing 0')
    expect(asked()[0]).toMatchObject({ status: 'active', verified: 'false' })
    expect(asked()[0].before).toBeUndefined()
  })
})
