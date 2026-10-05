// @vitest-environment jsdom
/**
 * /saved's "No longer available" rows (saved-unavailable.tsx): a save whose listing sold or expired is
 * kept and listed apart. Each row leads only where a page exists — a sold listing to its public sold
 * page, an expired one to its category — shows only the card this device already had, and can be removed.
 */
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SerializedListing } from '@/lib/types'

const toggle = vi.fn()
vi.mock('@/context/favorites-context', () => ({ useFavorites: () => ({ toggle }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/components/marketplace/listing-content', () => ({ useLocalized: (text: string) => text }))
vi.mock('next/image', () => ({ default: ({ src }: { src: string }) => <img data-thumb src={src} alt="" /> }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))

const { SavedUnavailableSection } = await import('./saved-unavailable')

const card = (id: string, title: string, category = 'rentals') =>
  ({ id, title, titleVi: null, images: [`https://picsum.photos/${id}`], category: { slug: category } }) as unknown as SerializedListing

afterEach(() => { cleanup(); toggle.mockClear() })

describe('SavedUnavailableSection', () => {
  it('renders nothing when no save has ended', () => {
    const { container } = render(<SavedUnavailableSection items={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('a SOLD save says so and leads to its public sold page', () => {
    render(<SavedUnavailableSection items={[{ id: 'L1', sold: true, card: card('L1', 'Road bike') }]} />)
    const row = screen.getByText('Road bike').closest('li')!
    expect(within(row).getByText('Sold')).toBeTruthy()
    expect(within(row).getByRole('link', { name: 'See listing' }).getAttribute('href')).toBe('/listings/L1')
  })

  it('an EXPIRED save leads to its category, never to its 404 listing page', () => {
    render(<SavedUnavailableSection items={[{ id: 'L2', sold: false, card: card('L2', 'Studio in District 1') }]} />)
    const row = screen.getByText('Studio in District 1').closest('li')!
    expect(within(row).getByText('No longer listed')).toBeTruthy()
    const link = within(row).getByRole('link', { name: 'See similar' })
    expect(link.getAttribute('href')).toBe('/c/rentals')
    expect(within(row).queryByRole('link', { name: 'See listing' })).toBeNull()
  })

  it('with no card this device ever had: a plain row, no invented title or photo, and no link', () => {
    render(<SavedUnavailableSection items={[{ id: 'L3', sold: false, card: null }]} />)
    const row = screen.getByText('A saved listing').closest('li')!
    expect(within(row).queryByRole('link')).toBeNull()
    expect(row.querySelector('[data-thumb]')).toBeNull()
  })

  it('Remove un-saves exactly that listing', () => {
    render(<SavedUnavailableSection items={[{ id: 'L1', sold: true, card: card('L1', 'Road bike') }, { id: 'L2', sold: false, card: card('L2', 'Sofa') }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from saved: Sofa' }))
    expect(toggle).toHaveBeenCalledWith('L2')
    expect(toggle).toHaveBeenCalledTimes(1)
  })
})
