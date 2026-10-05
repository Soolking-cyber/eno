// @vitest-environment jsdom
/**
 * BACK CLOSES WHAT THE TAP OPENED (UX3 NAV-1) — the overlay half: one state-only history entry per open phone
 * layer (filters / area / price sheet, header search panel), and every way that entry can end.
 * jsdom's `history.back()` is asynchronous and fires popstate, like a browser's; `waitFor` absorbs that.
 */
import React from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ENTRY_KEY, OVERLAY_KEY, VIEW_KEY, __resetBackToCloseForTests, backPressClosesOverlay, liveOverlayOnTop, popIsLayerClose,
  useBackToClose, whenLayerPopSettles,
} from './back-to-close'

type Api = { release: () => void }
let api: Api | null = null
const keepApi = (a: Api) => { api = a }
const closed = vi.fn()

/** A layer whose `open` the test drives, like a sheet's own state. */
function Layer({ open, onClose, onApi }: { open: boolean; onClose: () => void; onApi: (a: Api) => void }) {
  const a = useBackToClose(open, onClose, 'filters')
  React.useEffect(() => { onApi(a) })
  return null
}

function Harness({ initial = false }: { initial?: boolean }) {
  const [open, setOpen] = React.useState(initial)
  ;(Harness as unknown as { set: (v: boolean) => void }).set = setOpen
  return <Layer open={open} onClose={() => { closed(); setOpen(false) }} onApi={keepApi} />
}
const setOpen = (v: boolean) => act(() => { (Harness as unknown as { set: (v: boolean) => void }).set(v) })
const mark = () => (window.history.state as Record<string, unknown> | null)?.[OVERLAY_KEY] as { key: string; released?: true } | undefined
const tick = () => new Promise((r) => setTimeout(r, 30))

beforeEach(() => {
  __resetBackToCloseForTests()
  closed.mockClear()
  window.history.replaceState({ __NA: true, [ENTRY_KEY]: 'base' }, '', '/')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  api = null
})

describe('useBackToClose', () => {
  it('opening pushes ONE state-only entry on the same URL, carrying Next\'s state and the base entry id', () => {
    render(<Harness />)
    window.history.pushState(window.history.state, '', '/') // a clean top: no forward entries to truncate
    const before = window.history.length
    setOpen(true)
    expect(window.history.length).toBe(before + 1)
    expect(window.location.pathname).toBe('/')
    expect(mark()).toMatchObject({ key: expect.any(String) })
    expect(window.history.state).toMatchObject({ __NA: true, [ENTRY_KEY]: 'base' })
    expect(liveOverlayOnTop()).not.toBeNull()
    expect(backPressClosesOverlay()).toBe(true)
  })

  it('Back while open closes the layer — and pops nothing more', async () => {
    render(<Harness />)
    setOpen(true)
    act(() => window.history.back())
    await waitFor(() => expect(closed).toHaveBeenCalledTimes(1))
    await tick()
    expect(mark()).toBeUndefined()
    expect(window.history.state).toMatchObject({ [ENTRY_KEY]: 'base' })
    expect(backPressClosesOverlay()).toBe(false)
  })

  it('a UI close with nothing changed pops its entry, leaving history as it found it', async () => {
    render(<Harness />)
    setOpen(true)
    setOpen(false) // ✕ / scrim / Escape
    await waitFor(() => expect(mark()).toBeUndefined())
    expect(window.history.state).toMatchObject({ [ENTRY_KEY]: 'base' })
    expect(closed).not.toHaveBeenCalled() // the close was the UI's; popstate does not close it twice
  })

  it('a UI close after the URL changed KEEPS the entry as the committed step, unmarked, with its own identity', async () => {
    render(<Harness />)
    setOpen(true)
    // (Measured after the push: a push drops any forward entries an earlier test left behind.)
    const withHandle = window.history.length
    // A live filter tap rewrites the URL in place (the explorer's replaceState, preserving the state).
    window.history.replaceState(window.history.state, '', '/?category=rentals')
    setOpen(false)
    await tick()
    expect(window.history.length).toBe(withHandle) // kept, not popped
    expect(window.location.search).toBe('?category=rentals')
    expect(mark()).toBeUndefined()
    const id = (window.history.state as Record<string, unknown>)[ENTRY_KEY]
    expect(id).toEqual(expect.any(String))
    expect(id).not.toBe('base') // Back to the entry below finds ITS snapshot, not this one's
    // …and Back now undoes the step.
    act(() => window.history.back())
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it('a close the layer took over is left alone (a committed change stripped the mark first)', async () => {
    render(<Harness />)
    setOpen(true)
    const s = { ...(window.history.state as Record<string, unknown>) }
    delete s[OVERLAY_KEY]
    window.history.replaceState({ ...s, [ENTRY_KEY]: 'committed' }, '', '/?q=honda') // the explorer's absorb
    setOpen(false)
    await tick()
    expect(window.location.search).toBe('?q=honda')
    expect(window.history.state).toMatchObject({ [ENTRY_KEY]: 'committed' })
  })

  it('release(): the close never pops, and the NEXT push of any kind replaces the dead entry', async () => {
    render(<Harness />)
    setOpen(true)
    const withHandle = window.history.length
    act(() => api!.release()) // a suggestion that navigates
    expect(mark()).toMatchObject({ released: true })
    expect(backPressClosesOverlay()).toBe(false)
    setOpen(false)
    await tick()
    expect(mark()).toMatchObject({ released: true }) // not popped: an async back() would undo the navigation
    window.history.pushState({ __NA: true }, '', '/listings/abc') // the router's push
    expect(window.history.length).toBe(withHandle) // replaced, not stacked
    expect(window.location.pathname).toBe('/listings/abc')
    act(() => window.history.back())
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(window.history.state).toMatchObject({ [ENTRY_KEY]: 'base' }) // Back lands where the panel opened
  })

  it('only one push is replaced — the one after it stacks normally', () => {
    render(<Harness />)
    setOpen(true)
    act(() => api!.release())
    setOpen(false)
    const n = window.history.length
    window.history.pushState({}, '', '/a')
    window.history.pushState({}, '', '/b')
    expect(window.history.length).toBe(n + 1)
  })

  it('unmounting while open releases instead of popping (a route change may be what unmounted it)', async () => {
    const view = render(<Harness />)
    setOpen(true)
    view.unmount()
    await tick()
    expect(mark()).toMatchObject({ released: true })
  })

  it('no user activation, no entry: Chrome would make it skippable, so the layer opens without one', () => {
    vi.stubGlobal('navigator', { ...navigator, userActivation: { isActive: false } })
    render(<Harness />)
    const before = window.history.length
    setOpen(true)
    expect(window.history.length).toBe(before)
    expect(mark()).toBeUndefined()
  })

  it('a change the URL cannot show (the page\'s VIEW_KEY stamp — a near-you circle) counts: the entry is kept', async () => {
    render(<Harness />)
    setOpen(true)
    const withHandle = window.history.length
    window.history.replaceState({ ...(window.history.state as object), [VIEW_KEY]: '[10.7,106.7,5]' }, '') // same URL
    setOpen(false)
    await tick()
    expect(window.history.length).toBe(withHandle)
    expect(mark()).toBeUndefined()
    expect(window.history.state).toMatchObject({ [VIEW_KEY]: '[10.7,106.7,5]' })
  })

  it('a navigation the layer never heard of (a notification tap) REPLACES an open layer\'s entry instead of stacking on it', async () => {
    render(<Harness />)
    setOpen(true)
    const withHandle = window.history.length
    window.history.pushState({ __NA: true }, '', '/listings/xyz') // a router push from elsewhere
    expect(window.history.length).toBe(withHandle)
    expect(liveOverlayOnTop()).toBeNull()
    // A state-only push (a nested layer, the lightbox) still stacks.
    const n = window.history.length
    window.history.pushState({ lightbox: true }, '')
    expect(window.history.length).toBe(n + 1)
  })

  it('OUR pop is marked for the popstate it causes, and a layer opened meanwhile waits for it (review: it was closed by it)', async () => {
    const second = vi.fn()
    function Two({ a, b }: { a: boolean; b: boolean }) {
      useBackToClose(a, () => {}, 'price')
      useBackToClose(b, second, 'area')
      return null
    }
    const view = render(<Two a b={false} />)
    await waitFor(() => expect(mark()).toMatchObject({ key: expect.any(String) }))
    const seen: boolean[] = []
    const onPop = () => seen.push(popIsLayerClose())
    window.addEventListener('popstate', onPop)
    const deferred = vi.fn()
    try {
      // ✕ on the first sheet (untouched → popped) …
      view.rerender(<Two a={false} b={false} />)
      await Promise.resolve() // the close's microtask has called history.back(), which has not landed yet
      whenLayerPopSettles(deferred)
      expect(deferred).not.toHaveBeenCalled()
      // … and the second opened by the very next tap, before that traversal has landed.
      view.rerender(<Two a={false} b />)
      await waitFor(() => expect(seen).toEqual([true]))
      await waitFor(() => expect(deferred).toHaveBeenCalledTimes(1))
      // The second layer pushed AFTER the pop, so it was not closed by it, and it owns the top entry now.
      await waitFor(() => expect(mark()).toMatchObject({ key: expect.any(String) }))
      expect(second).not.toHaveBeenCalled()
      expect(backPressClosesOverlay()).toBe(true)
    } finally {
      window.removeEventListener('popstate', onPop)
    }
  })

  it('a STALE mark (restored by a reload or Forward) is not a live layer', () => {
    window.history.replaceState({ [OVERLAY_KEY]: { id: 'filters', key: 'from-another-document' } }, '', '/')
    expect(liveOverlayOnTop()).toBeNull()
    expect(backPressClosesOverlay()).toBe(false)
  })
})
