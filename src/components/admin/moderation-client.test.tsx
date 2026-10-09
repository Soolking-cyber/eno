// @vitest-environment jsdom
/**
 * THE LISTING LINE ON A MODERATION CASE SAYS ONLY WHAT IT KNOWS (2026-10-09). The case card's "<category> ·
 * <location>" line read "Teachers · " (a separator beside nothing) whenever the listing's location was empty, and
 * since the teacher onboarding redesign an empty location is a real row, not a corrupt one:
 *   · a teacher whose "Where are you now?" is unanswered is stored with location '' (projection.ts teacherHome's
 *     last branch; the backfill's 'none' decision writes it). A teacher ABROAD is not that case: their city is '',
 *     but their location reads "Not in Vietnam yet[ · Online]";
 *   · every SCRUBBED tombstone keeps its category and blanks its location (listing-tombstone.ts PERSONAL_SCRUB_DATA:
 *     a deleted teacher profile at once, any listing once the retention job reaches it), and the reports resolved
 *     on it stay in the Resolved tab.
 * ⛔ THE CONTRACT IS GENERIC, NEVER A TEACHERS SPECIAL CASE: the line joins only the parts that say something (an
 * empty or whitespace-only part drops out, its separator with it) and is not rendered at all when none does.
 * ⚠️ EXPLICIT CLEANUP: no vitest `globals`, so Testing Library registers no afterEach of its own.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text
  default: ({ fill: _f, sizes: _s, ...rest }: Record<string, unknown>) => <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

import { ModerationClient, type ModCase } from './moderation-client'

/** A report on a listing, as reports-inbox.tsx builds it from admin-reports.ts targetContext. */
function listingCase(listing: { title?: string; category: string; location: string }): ModCase {
  return {
    id: 'r1', reason: 'scam', detail: null, severity: null, createdAt: new Date().toISOString(), ageDays: 0,
    bucket: 'standard', priority: 1, reporter: null, conversationId: null, communityCount: 1,
    target: {
      kind: 'listing', name: 'Jane Doe', trustScore: 100, trustTier: 'standard', sellerId: 's1', profileId: 'p1', isGuest: false,
      listing: { id: 'l1', title: listing.title ?? 'Jane Doe', price: 0, currency: '₫', image: null, category: listing.category, location: listing.location },
    },
    internalNote: null, sellerResponse: null, sellerRespondedAt: null,
  }
}

/** Every <p> on the page that names the category — the listing line is the only one. RAW text, never normalised:
 *  Testing Library's matchers trim, which is exactly what would hide a trailing " · ". */
const linesNaming = (container: HTMLElement, category: string) =>
  Array.from(container.querySelectorAll('p')).map((p) => p.textContent ?? '').filter((t) => t.includes(category))

beforeEach(() => {
  // The client picks its layout from (min-width: 1024px); jsdom has no matchMedia. Narrow = one full card per case.
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('moderation case card: the "<category> · <location>" line', () => {
  it('a teacher with no home on record shows the category alone, with no dangling separator', () => {
    const { container } = render(<ModerationClient cases={[listingCase({ category: 'Teachers', location: '' })]} resolved={[]} />)
    expect(linesNaming(container, 'Teachers')).toEqual(['Teachers'])
  })

  it('a whitespace-only location says nothing either', () => {
    const { container } = render(<ModerationClient cases={[listingCase({ category: 'Teachers', location: '   ' })]} resolved={[]} />)
    expect(linesNaming(container, 'Teachers')).toEqual(['Teachers'])
  })

  it('any listing, not only a teacher: a scrubbed tombstone in the Resolved tab shows its category alone', () => {
    const tombstone = { ...listingCase({ title: '[removed]', category: 'Electronics', location: '' }), resolution: { status: 'confirmed', by: 'support@eno.vn', at: new Date().toISOString() } }
    const { container } = render(<ModerationClient cases={[]} resolved={[tombstone]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resolved (1)' }))
    expect(linesNaming(container, 'Electronics')).toEqual(['Electronics'])
  })

  it('both parts present keep the separator between them (control)', () => {
    const { container } = render(<ModerationClient cases={[listingCase({ category: 'Teachers', location: 'District 7, Ho Chi Minh City' })]} resolved={[]} />)
    expect(linesNaming(container, 'Teachers')).toEqual(['Teachers · District 7, Ho Chi Minh City'])
  })

  it('nothing to say renders no line at all: no lone separator, no empty paragraph', () => {
    const { container } = render(<ModerationClient cases={[listingCase({ category: '', location: '' })]} resolved={[]} />)
    const texts = Array.from(container.querySelectorAll('p')).map((p) => (p.textContent ?? '').trim())
    expect(texts).not.toContain('·')
    expect(texts).not.toContain('')
  })
})
