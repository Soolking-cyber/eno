// @vitest-environment jsdom
import type { PointerEvent as ReactPointerEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { usePointerReorder } from './use-pointer-reorder'

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
