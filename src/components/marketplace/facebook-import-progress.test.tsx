// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
const { FacebookImportProgress } = await import('./facebook-import-progress')
afterEach(cleanup)

const started = new Date(Date.now() - 83_000).toISOString()
const item = (id: string, status: string, categorySlug: string | null = null) => ({ id, status, photo: null, fbTitle: `Listing ${id}`, categorySlug })

// Only what the job reports: the phase, its listings as they arrive, and how long it has run (2026-11-06).
describe('Import from Facebook: the wait', () => {
  it('in the queue, nothing read yet: the first step says so, no list, no bar', () => {
    render(<FacebookImportProgress status="queued" startedAt={started} items={[]} />)
    expect(screen.getByRole('status').textContent).toBe('Waiting for our reader')
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('list', { name: 'Your listings so far' })).toBeNull()
    expect(screen.getByText(/1:2\d/)).toBeTruthy()
  })
  it('reading: each listing as it arrives, and the count in the step', () => {
    render(<FacebookImportProgress status="reading" startedAt={started} items={[item('1', 'raw'), item('2', 'raw')]} />)
    expect(screen.getByRole('status').textContent).toBe('Reading your listings: 2')
    expect(screen.getByText('Listing 1')).toBeTruthy()
    expect(screen.getAllByText('Reading')).toHaveLength(2)
  })
  it('sorting: a real bar, k of n, and a sorted listing shows its shelf', () => {
    render(<FacebookImportProgress status="sorting" startedAt={started} items={[item('1', 'draft', 'electronics'), item('2', 'raw')]} />)
    const bar = screen.getByRole('progressbar', { name: 'Listings sorted' })
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
    expect(bar.getAttribute('aria-valuemax')).toBe('2')
    expect(screen.getByText('Electronics')).toBeTruthy()
  })
})
