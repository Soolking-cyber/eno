'use client'

import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

// Pointer-based drag-to-reorder that works on BOTH touch and mouse (HTML5 native
// drag-and-drop fires no events on touch, so mobile couldn't rearrange). Bind the
// returned props to each draggable tile; as the pointer moves over another tile,
// the list reorders live via `move(from, to)`.
//
// Tiles get `touch-action: none` so dragging a thumbnail doesn't scroll the page.
// A pointerdown that lands on a <button> (remove / make-cover) is ignored, so those
// taps still work normally.
export function usePointerReorder(move: (from: number, to: number) => void) {
  const from = useRef<number | null>(null)

  const onPointerDown = (i: number) => (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return // let buttons handle their own taps
    from.current = i
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (from.current === null) return
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const tile = el?.closest('[data-reorder-idx]') as HTMLElement | null
    if (!tile) return
    const to = Number(tile.dataset.reorderIdx)
    if (!Number.isNaN(to) && to !== from.current) {
      move(from.current, to)
      from.current = to
    }
  }
  const end = () => { from.current = null }

  const bind = (i: number) => ({
    'data-reorder-idx': i,
    onPointerDown: onPointerDown(i),
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
    style: { touchAction: 'none' as const },
  })

  return { bind }
}
