// @vitest-environment jsdom
import type { PointerEvent as ReactPointerEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook } from '@testing-library/react'

import { slotNearest, usePointerReorder } from './use-pointer-reorder'

/**
 * ONE POINTER OWNS A DRAG. A second finger — or a resting palm while an Apple Pencil drags, both of
 * which report `isPrimary` for their own pointer type — must not restart, move or end a lifted drag.
 * Before this, the second contact overwrote the drag's start point and the owner's next move read as
 * a scroll, dropping the drag mid-gesture.
 */
const tile = document.createElement('div')
document.body.appendChild(tile) // the long-press lift only lifts a connected tile
// jsdom has no layout: the move handler asks elementFromPoint for the tile under the pointer.
document.elementFromPoint = () => null
const ev = (pointerId: number, pointerType: string, isPrimary = true) =>
  ({ pointerId, pointerType, isPrimary, button: 0, clientX: 10, clientY: 10, target: tile, currentTarget: tile }) as unknown as ReactPointerEvent<HTMLElement>

describe('usePointerReorder', () => {
  it('a second pointer cannot hijack or end a lifted drag; the owner ends it', () => {
    const { result } = renderHook(() => usePointerReorder(vi.fn()))
    act(() => result.current.bind(0).onPointerDown(ev(1, 'mouse'))) // a mouse lifts at once…
    act(() => result.current.bind(0).onPointerMove(ev(1, 'mouse'))) // …and shows it on the first move
    expect(result.current.dragging).toBe(0)

    act(() => result.current.bind(2).onPointerDown(ev(7, 'touch'))) // palm: primary for its own type
    act(() => result.current.bind(2).onPointerMove(ev(7, 'touch')))
    act(() => result.current.bind(2).onPointerUp(ev(7, 'touch')))
    act(() => result.current.bind(2).onPointerCancel(ev(7, 'touch')))
    expect(result.current.dragging).toBe(0) // still the owner's drag

    act(() => result.current.bind(0).onPointerUp(ev(1, 'mouse')))
    expect(result.current.dragging).toBeNull()
  })

  it('the owner lifting OUTSIDE every tile still ends the drag (no stranded lift)', () => {
    const { result } = renderHook(() => usePointerReorder(vi.fn()))
    act(() => result.current.bind(0).onPointerDown(ev(4, 'mouse')))
    act(() => result.current.bind(0).onPointerMove(ev(4, 'mouse')))
    expect(result.current.dragging).toBe(0)
    act(() => { window.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 9 })) }) // someone else
    expect(result.current.dragging).toBe(0)
    act(() => { window.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 4 })) }) // the owner
    expect(result.current.dragging).toBeNull()
  })

  it('a touch whose pointerup is lost BEFORE the long-press never lifts later (no frozen page)', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => usePointerReorder(vi.fn()))
      act(() => result.current.bind(1).onPointerDown(ev(5, 'touch'))) // arms the long-press timer
      act(() => { window.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 5 })) }) // lifted elsewhere
      act(() => { vi.advanceTimersByTime(2000) })
      expect(result.current.dragging).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a resting palm (touch) does not steal a pending Pencil press', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => usePointerReorder(vi.fn()))
      act(() => result.current.bind(0).onPointerDown(ev(11, 'pen'))) // pen waits on the long-press
      act(() => result.current.bind(3).onPointerDown(ev(12, 'touch'))) // the palm lands on tile 3
      act(() => { vi.advanceTimersByTime(2000) })
      expect(result.current.dragging).toBe(0) // the pen's tile lifted, not the palm's
    } finally {
      vi.useRealTimers()
    }
  })

  it('a non-primary contact never starts a drag', () => {
    const { result } = renderHook(() => usePointerReorder(vi.fn()))
    act(() => result.current.bind(1).onPointerDown(ev(3, 'mouse', false)))
    expect(result.current.dragging).toBeNull()
  })
})

/**
 * ⛔ THE TARGET SLOT COMES FROM THE TILES' GEOMETRY (Emil audit, tier 3). elementFromPoint found nothing in the gaps
 * between tiles, past the last photo, or under whatever is drawn on top (the sticky action bar).
 * A row of three 100px tiles with 8px gaps: centres at x = 50, 158, 266; y = 50.
 */
describe('slotNearest', () => {
  const tiles = [0, 1, 2].map((i) => {
    const t = document.createElement('div')
    t.dataset.reorderIdx = String(i)
    const left = i * 108
    t.getBoundingClientRect = () => ({ left, top: 0, right: left + 100, bottom: 100, width: 100, height: 100, x: left, y: 0, toJSON: () => ({}) })
    return t
  })

  it('⛔ in the gap between two tiles, the nearer slot (elementFromPoint found nothing there)', () => {
    expect(slotNearest(tiles, 214, 50, 0)).toBe(2) // in the 1|2 gap (208–216), nearer 2
    expect(slotNearest(tiles, 106, 50, 2)).toBe(1) // in the 0|1 gap (100–108), nearer 1
  })

  it('⛔ past the last photo (still within half a tile of the grid), the last slot', () => {
    expect(slotNearest(tiles, 330, 50, 0)).toBe(2)
  })

  it('far outside the grid, the photo stays where it is', () => {
    expect(slotNearest(tiles, 600, 50, 0)).toBe(0)
    expect(slotNearest(tiles, 150, 400, 1)).toBe(1)
  })

  it('on the boundary between two slots, no flicker: a slot must be clearly nearer before the photo moves', () => {
    expect(slotNearest(tiles, 106, 50, 0)).toBe(0) // 2px nearer slot 1 than slot 0 — stays
    expect(slotNearest(tiles, 106, 50, 1)).toBe(1) // and from slot 1 it stays at 1
  })

  it('no measurable tile (no layout), or only one (markup that wraps each tile) → null: the hook falls back', () => {
    const flat = document.createElement('div')
    flat.dataset.reorderIdx = '0'
    expect(slotNearest([flat], 10, 10, 0)).toBeNull()
    expect(slotNearest([tiles[0]], 10, 10, 0)).toBeNull()
  })

  it('⛔ a part-filled last row: right of the last photo means the end, not the photo above (review)', () => {
    // Three columns; photo 3 alone on row two (top 108). The empty cells after it are nearer photo 2's centre.
    const row2 = document.createElement('div')
    row2.dataset.reorderIdx = '3'
    row2.getBoundingClientRect = () => ({ left: 0, top: 108, right: 100, bottom: 208, width: 100, height: 100, x: 0, y: 108, toJSON: () => ({}) })
    expect(slotNearest([...tiles, row2], 266, 158, 0)).toBe(3)
    expect(slotNearest([...tiles, row2], 158, 158, 0)).toBe(3)
    expect(slotNearest([...tiles, row2], 266, 50, 0)).toBe(2) // row one is unchanged
  })

  it('the last-row region is a band: no jump at its edge, and no flicker on the way out', () => {
    const row2 = document.createElement('div')
    row2.dataset.reorderIdx = '3'
    row2.getBoundingClientRect = () => ({ left: 0, top: 108, right: 100, bottom: 208, width: 100, height: 100, x: 0, y: 108, toJSON: () => ({}) })
    const all = [...tiles, row2]
    expect(slotNearest(all, 266, 112, 2)).toBe(2) // 4px into the last row: not yet inside the band
    expect(slotNearest(all, 266, 104, 3)).toBe(3) // and from the last slot, 4px above it: not yet out
  })
})

describe('usePointerReorder — the slot comes from the hook\'s own tiles', () => {
  it('⛔ a drag that crosses a gap reorders', () => {
    const grid = document.createElement('div')
    const cells = [0, 1, 2].map((i) => {
      const t = document.createElement('div')
      t.dataset.reorderIdx = String(i)
      const left = i * 108
      t.getBoundingClientRect = () => ({ left, top: 0, right: left + 100, bottom: 100, width: 100, height: 100, x: left, y: 0, toJSON: () => ({}) })
      grid.appendChild(t)
      return t
    })
    document.body.appendChild(grid)
    const move = vi.fn()
    const { result } = renderHook(() => usePointerReorder(move))
    cells.forEach((c, i) => result.current.bind(i).ref(c)) // as the tiles' refs do on render
    const at = (x: number) => ({ pointerId: 21, pointerType: 'mouse', isPrimary: true, button: 0, clientX: x, clientY: 50, target: cells[0], currentTarget: cells[0] }) as unknown as ReactPointerEvent<HTMLElement>
    act(() => result.current.bind(0).onPointerDown(at(50)))
    act(() => result.current.bind(0).onPointerMove(at(214))) // the 1|2 gap: elementFromPoint (stubbed null here) finds nothing
    expect(move).toHaveBeenCalledWith(0, 2)
    act(() => result.current.bind(0).onPointerMove(at(900))) // far outside: stays
    expect(move).toHaveBeenCalledTimes(1)
    act(() => result.current.bind(0).onPointerUp(at(900)))
    grid.remove()
  })

  it('the elementFromPoint fallback only takes one of the hook\'s own tiles (another grid\'s, nested or not, is ignored)', () => {
    const mine = document.createElement('div')
    const own = document.createElement('div')
    own.dataset.reorderIdx = '0'
    mine.appendChild(own)
    const other = document.createElement('div')
    const foreign = document.createElement('div')
    foreign.dataset.reorderIdx = '4'
    other.appendChild(foreign)
    document.body.append(mine, other)
    const was = document.elementFromPoint
    document.elementFromPoint = () => foreign // another reorder grid is under the pointer
    try {
      const move = vi.fn()
      const { result } = renderHook(() => usePointerReorder(move))
      result.current.bind(0).ref(own)
      const e = { pointerId: 31, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 5, clientY: 5, target: own, currentTarget: own } as unknown as ReactPointerEvent<HTMLElement>
      act(() => result.current.bind(0).onPointerDown(e))
      act(() => result.current.bind(0).onPointerMove(e))
      expect(move).not.toHaveBeenCalled()
      act(() => result.current.bind(0).onPointerUp(e))
    } finally {
      document.elementFromPoint = was
      mine.remove(); other.remove()
    }
  })
})

describe('usePointerReorder — through real markup (the props spread on each tile, as the post form does)', () => {
  function Grid({ move }: { move: (a: number, b: number) => void }) {
    const { bind } = usePointerReorder(move)
    return <div>{[0, 1, 2].map((i) => <div key={i} data-testid={`t${i}`} {...bind(i)} />)}</div>
  }

  it('⛔ the spread ref registers each tile, and a drag across a gap reorders', () => {
    const move = vi.fn()
    const { getByTestId, unmount } = render(<Grid move={move} />)
    try {
      for (const i of [0, 1, 2]) {
        const left = i * 108
        getByTestId(`t${i}`).getBoundingClientRect = () => ({ left, top: 0, right: left + 100, bottom: 100, width: 100, height: 100, x: left, y: 0, toJSON: () => ({}) })
      }
      const t0 = getByTestId('t0')
      const p = (x: number) => ({ pointerId: 41, pointerType: 'mouse', isPrimary: true, button: 0, clientX: x, clientY: 50 })
      fireEvent.pointerDown(t0, p(50))
      fireEvent.pointerMove(t0, p(214)) // the 1|2 gap
      expect(move).toHaveBeenCalledWith(0, 2)
      fireEvent.pointerUp(t0, p(214))
    } finally {
      unmount()
    }
  })

  it('with no tile registered (a ref that never reached the DOM), the elementFromPoint fallback works as before', () => {
    const under = document.createElement('div')
    under.dataset.reorderIdx = '2'
    document.body.appendChild(under)
    const was = document.elementFromPoint
    document.elementFromPoint = () => under
    try {
      const move = vi.fn()
      const { result } = renderHook(() => usePointerReorder(move))
      const e = { pointerId: 51, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 5, clientY: 5, target: under, currentTarget: under } as unknown as ReactPointerEvent<HTMLElement>
      act(() => result.current.bind(0).onPointerDown(e))
      act(() => result.current.bind(0).onPointerMove(e))
      expect(move).toHaveBeenCalledWith(0, 2)
      act(() => result.current.bind(0).onPointerUp(e))
    } finally {
      document.elementFromPoint = was
      under.remove()
    }
  })

  it('a tile that is not measurable this move never makes the photo jump', () => {
    const t = (i: number, w: number) => {
      const el = document.createElement('div')
      el.dataset.reorderIdx = String(i)
      el.getBoundingClientRect = () => ({ left: i * 108, top: 0, right: i * 108 + w, bottom: w, width: w, height: w, x: i * 108, y: 0, toJSON: () => ({}) })
      return el
    }
    expect(slotNearest([t(0, 0), t(1, 100), t(2, 100)], 158, 50, 0)).toBe(0) // the lifted tile (0) has no box
    const thin = t(1, 100)
    thin.getBoundingClientRect = () => ({ left: 108, top: 0, right: 108, bottom: 100, width: 0, height: 100, x: 108, y: 0, toJSON: () => ({}) })
    expect(slotNearest([t(0, 100), thin, t(2, 100)], 110, 50, 0)).toBe(0) // a collapsed (0-wide) tile is no target
  })
})
