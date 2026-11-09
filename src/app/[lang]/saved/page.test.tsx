// @vitest-environment jsdom
/**
 * /saved under a failed read (best-practice gap 2026-11-10): with nothing loaded the page is a FAULT with Try again — never
 * "0 saved listings", the warning row and "No saved listings yet" at once, which tells a signed-in reader their saves are gone.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fav: {} as Record<string, unknown>,
  auth: { user: { id: 'u1' }, loading: false, openSignIn: () => {} } as Record<string, unknown>,
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, prefetch: () => {} }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/context/favorites-context', () => ({ useFavorites: () => h.fav }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth }))
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))
vi.mock('@/components/marketplace/saved-searches', () => ({ SavedSearches: () => null }))
vi.mock('@/components/marketplace/mascot', () => ({ Mascot: () => null }))
vi.mock('@/components/marketplace/listing-card', () => ({ ListingCard: ({ listing }: { listing: { id: string } }) => <div data-testid="card">{listing.id}</div> }))
vi.mock('@/components/marketplace/saved-unavailable', () => ({
  SavedUnavailableSection: ({ items }: { items: unknown[] }) => (items.length ? <div data-testid="unavailable">{items.length}</div> : null),
}))

import SavedPage from './page'

const base = { count: 0, saved: [], savedUnavailable: [], savedError: false, retrySaved: () => {}, synced: true }
const set = (over: Record<string, unknown>) => { h.fav = { ...base, ...over } }
const FAULT = "Couldn't load your saved listings."
const WARNING = "Some saved listings couldn't be loaded."
const EMPTY = 'No saved listings yet'

afterEach(cleanup)

describe('/saved: a read that failed with nothing on screen is a fault', () => {
  it('an account read that failed (count unknown): the fault block alone, and no "0 saved listings"', () => {
    set({ savedError: true })
    render(<SavedPage />)
    expect(screen.getByText(FAULT)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    // Nothing was lost, and a way on besides retrying (the empty state's own browse link).
    expect(screen.getByText('Nothing you saved was removed. Try again, or keep browsing meanwhile.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Browse listings' }).getAttribute('href')).toBe('/')
    expect(screen.queryByText(WARNING)).toBeNull()
    expect(screen.queryByText(EMPTY)).toBeNull()
    expect(screen.queryByText(/0 saved listings/)).toBeNull()
  })

  it('a list loaded empty whose next fetch failed after a new heart: the true count stays, the page says it failed', () => {
    set({ savedError: true, count: 1 })
    render(<SavedPage />)
    expect(screen.getByText(FAULT)).toBeTruthy()
    expect(screen.queryByText(EMPTY)).toBeNull()
    expect(screen.queryByText(WARNING)).toBeNull()
    expect(screen.getByText(/1 saved listing/)).toBeTruthy()
  })

  it('a partly loaded list keeps the warning row over the cards that did load', () => {
    set({ savedError: true, count: 3, saved: [{ id: 'a', sellerId: 's' }] })
    render(<SavedPage />)
    expect(screen.getByText(WARNING)).toBeTruthy()
    expect(screen.getAllByTestId('card')).toHaveLength(1)
    expect(screen.queryByText(FAULT)).toBeNull()
  })

  it('only "No longer available" saves loaded: the warning row and that section, not the fault', () => {
    set({ savedError: true, count: 2, savedUnavailable: [{ id: 'x' }] })
    render(<SavedPage />)
    expect(screen.getByText(WARNING)).toBeTruthy()
    expect(screen.getByTestId('unavailable')).toBeTruthy()
    expect(screen.queryByText(FAULT)).toBeNull()
  })

  it('nothing saved and nothing failed: the mascot empty state, as before', () => {
    set({})
    render(<SavedPage />)
    expect(screen.getByText(EMPTY)).toBeTruthy()
    expect(screen.queryByText(FAULT)).toBeNull()
    expect(screen.getByText(/0 saved listings/)).toBeTruthy()
  })

  it('the account list unavailable here, signed in: "on this device only" without a leading separator or a guessed 0', () => {
    set({ savedError: true, synced: false })
    const { container } = render(<SavedPage />)
    expect(screen.getByText(FAULT)).toBeTruthy()
    const meta = screen.getByText('on this device only')
    expect(meta.textContent!.startsWith(' · ')).toBe(false)
    expect(container.textContent).not.toMatch(/0 saved listings/)
  })
})
