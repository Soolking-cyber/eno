// @vitest-environment jsdom
import { Suspense, act } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { retryingLazy } from './picker-sheet-kit'

afterEach(cleanup)

type P = { open: boolean; onClose: () => void; name?: string }
function Unavailable({ open, onClose }: P) {
  if (open) queueMicrotask(onClose)
  return null
}
function Real({ open, name }: P) {
  return open ? <p>{name ?? 'the sheet'}</p> : null
}
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('retryingLazy — ⛔ a failed sheet load is not for ever, and only a tap retries it (gate 2026-10-18)', () => {
  it('offline first open closes; re-renders do not refetch; the next TAP (retry) loads the sheet', async () => {
    const load = vi.fn<() => Promise<typeof Real>>()
      .mockRejectedValueOnce(new Error('ChunkLoadError: offline'))
      .mockResolvedValue(Real)
    const Sheet = retryingLazy<P>(load, Unavailable)
    const onClose = vi.fn()
    const view = render(<Suspense fallback={null}><Sheet open onClose={onClose} /></Suspense>)
    await settle()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    // Re-rendered, open or closed, with no new tap: no refetch — an offline page must never retry in a loop.
    view.rerender(<Suspense fallback={null}><Sheet open onClose={onClose} /></Suspense>)
    view.rerender(<Suspense fallback={null}><Sheet open={false} onClose={onClose} /></Suspense>)
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    // The visitor taps again (the trigger's preload calls retry), and the open renders the real sheet.
    Sheet.retry()
    view.rerender(<Suspense fallback={null}><Sheet open onClose={onClose} /></Suspense>)
    expect(await screen.findByText('the sheet')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('⛔ a DIFFERENT picker of the kind, first tapped after the failure, opens — it mounts already open', async () => {
    const load = vi.fn<() => Promise<typeof Real>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(Real)
    const Sheet = retryingLazy<P>(load, Unavailable)
    const onCloseA = vi.fn()
    render(<Suspense fallback={null}><Sheet open onClose={onCloseA} name="sort" /></Suspense>)
    await vi.waitFor(() => expect(onCloseA).toHaveBeenCalled())
    Sheet.retry() // the footer's Language trigger, pressed once the connection is back
    render(<Suspense fallback={null}><Sheet open onClose={() => {}} name="language" /></Suspense>)
    expect(await screen.findByText('language')).toBeTruthy()
  })

  it('a load that worked is kept: retry() is a no-op and nothing is fetched twice', async () => {
    const load = vi.fn(async () => Real)
    const Sheet = retryingLazy<P>(load, Unavailable)
    const view = render(<Suspense fallback={null}><Sheet open onClose={() => {}} /></Suspense>)
    expect(await screen.findByText('the sheet')).toBeTruthy()
    Sheet.retry()
    view.rerender(<Suspense fallback={null}><Sheet open={false} onClose={() => {}} /></Suspense>)
    view.rerender(<Suspense fallback={null}><Sheet open onClose={() => {}} /></Suspense>)
    expect(await screen.findByText('the sheet')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
  })
})
