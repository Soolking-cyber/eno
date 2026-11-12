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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
const toastMock = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh, push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: toastMock }))
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

/**
 * UNDO THE SELLER'S CONFIRMATION (owner, 2026-11-12) — one destructive item in the case card's existing ⋯ menu, never a
 * new row. Present only while reports-inbox.tsx found a live confirmation on an OPEN chat report's own thread
 * (`dealConfirmation`); the click posts the confirmation the card SHOWS, says what happened whatever the answer, and
 * refreshes the queue every time so a stale item leaves the menu.
 */
describe('moderation case card: "Undo the seller\'s confirmation"', () => {
  const CONFIRMED_AT = '2026-11-09T08:00:00.123Z'
  const chatCase = (over: Partial<ModCase> = {}): ModCase => ({
    id: 'r9', reason: 'scam', detail: null, severity: null, createdAt: new Date().toISOString(), ageDays: 0,
    bucket: 'standard', priority: 1, reporter: null, conversationId: 'c9', communityCount: 1,
    target: { kind: 'chat', name: 'Minh Shop', trustScore: 90, trustTier: 'standard', sellerId: 's9', profileId: 'p9', isGuest: false, listing: null },
    internalNote: null, sellerResponse: null, sellerRespondedAt: null,
    dealConfirmation: { kind: 'rental', confirmedAt: CONFIRMED_AT },
    ...over,
  })
  const ITEM = /Undo the seller's confirmation/
  const openMenu = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    return screen.findByRole('menuitem', { name: ITEM })
  }
  /** The item only ASKS (no redo exists); the dialog's button sends it. */
  const confirmUndo = async () => fireEvent.click(await screen.findByRole('button', { name: 'Undo confirmation' }))
  const answer = (status: number, body: unknown) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  beforeEach(() => {
    nav.refresh.mockClear(); toastMock.success.mockClear(); toastMock.warning.mockClear(); toastMock.error.mockClear()
  })

  it('the item only asks — Cancel sends nothing, and nothing refreshes', async () => {
    const fetchMock = answer(200, { ok: true })
    render(<ModerationClient cases={[chatCase()]} resolved={[]} />)
    fireEvent.click(await openMenu())
    expect(await screen.findByText(/There is no redo/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText(/There is no redo/)).toBeNull())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(nav.refresh).not.toHaveBeenCalled()
  })

  it('a chat case with a live confirmation: the item is in ⋯ (with its kind), and the click posts withdraw-deal with the confirmation it shows', async () => {
    const fetchMock = answer(200, { ok: true })
    render(<ModerationClient cases={[chatCase()]} resolved={[]} />)
    const item = await openMenu()
    expect(item.textContent).toContain("Undo the seller's confirmation (rental)")
    fireEvent.click(item)
    await confirmUndo()
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/admin/moderate')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ action: 'withdraw-deal', id: 'r9', confirmedAt: CONFIRMED_AT })
    expect(toastMock.success).toHaveBeenCalledWith("Seller's confirmation withdrawn — the buyer can no longer review this chat.")
  })

  it('without the field the item is absent (the menu still opens)', async () => {
    render(<ModerationClient cases={[chatCase({ dealConfirmation: null })]} resolved={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    await screen.findAllByRole('menuitem')
    expect(screen.queryByRole('menuitem', { name: ITEM })).toBeNull()
  })

  it('a resolved case has no menu at all, even if the field were set', () => {
    const closed = chatCase({ resolution: { status: 'dismissed', by: 'mod@eno.vn', at: new Date().toISOString() } })
    render(<ModerationClient cases={[]} resolved={[closed]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resolved (1)' }))
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })

  it.each([
    [409, { error: 'already_reviewed' }, 'warning', 'The buyer has already reviewed — nothing was withdrawn.'],
    [409, { error: 'already_resolved' }, 'warning', 'This case is closed — nothing was withdrawn.'],
    [409, { error: 'not_confirmed' }, 'warning', 'This confirmation changed or is gone — the case was refreshed.'],
    [409, { error: 'deal_declined' }, 'warning', 'This confirmation changed or is gone — the case was refreshed.'],
    [503, { error: 'migration_pending' }, 'error', 'Could not confirm the result — check the refreshed case before trying again.'],
    [500, { error: 'internal_error' }, 'error', 'Could not confirm the result — check the refreshed case before trying again.'],
  ] as const)('%s %o → a %s toast that says so, and the queue refreshes', async (status, body, kind, line) => {
    answer(status, body)
    render(<ModerationClient cases={[chatCase()]} resolved={[]} />)
    fireEvent.click(await openMenu())
    await confirmUndo()
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1))
    expect(toastMock[kind]).toHaveBeenCalledWith(line)
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('a network failure → "could not confirm the result" (it may have committed), never "unchanged", and the queue still refreshes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    render(<ModerationClient cases={[chatCase()]} resolved={[]} />)
    fireEvent.click(await openMenu())
    await confirmUndo()
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1))
    expect(toastMock.error).toHaveBeenCalledWith('Could not confirm the result — check the refreshed case before trying again.')
  })
})
