// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react'

/**
 * THE UNDO WINDOW — owner, 2026-09-25: "Undo toast, 5 seconds … the POST is sent only when the toast
 * expires (or the user navigates away — then send, never silently drop)".
 *
 * Each test below is one way the window can close, and asserts the ONE thing that must happen then:
 * commit exactly once, or never. sonner is replaced by a recorder so the toast's lifetime can be read
 * back and its Undo control actually clicked.
 *
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

const toasts = vi.hoisted(() => {
  type Opts = { description?: string; duration?: number; action?: unknown }
  const state = { seq: 0, shown: [] as { id: number; title: string; opts: Opts }[], dismissed: [] as (string | number)[] }
  const toast = Object.assign(
    (title: string, opts: Opts) => { const id = ++state.seq; state.shown.push({ id, title, opts }); return id },
    { dismiss: (id: string | number) => { state.dismissed.push(id) } },
  )
  return { state, toast }
})
vi.mock('sonner', () => ({ toast: toasts.toast }))

import { UNDO_WINDOW_MS, useUndoWindow, type UndoableAction } from './use-undo-window'

afterEach(cleanup)
beforeEach(() => {
  vi.useFakeTimers()
  toasts.state.seq = 0
  toasts.state.shown.length = 0
  toasts.state.dismissed.length = 0
})
afterEach(() => { vi.useRealTimers() })

function action(over: Partial<UndoableAction> = {}): UndoableAction & { commit: ReturnType<typeof vi.fn>; undo: ReturnType<typeof vi.fn> } {
  return { title: 'Offer accepted', description: '12.000.000 ₫', undoLabel: 'Undo', commit: vi.fn(), undo: vi.fn(), ...over } as never
}

/** Render the toast's action element (what sonner would mount) and click it. */
function clickUndo(i = 0) {
  const el = toasts.state.shown[i].opts.action as React.ReactElement
  const { getByRole, unmount } = render(el)
  fireEvent.click(getByRole('button', { name: 'Undo' }))
  unmount()
}

describe('the window is ours, not sonner’s', () => {
  it('shows a toast with NO sonner timer (duration Infinity), carrying the title, the amount and an Undo', () => {
    const { result } = renderHook(() => useUndoWindow())
    act(() => { result.current.start('o1', action()) })
    expect(toasts.state.shown).toHaveLength(1)
    const { title, opts } = toasts.state.shown[0]
    expect(title).toBe('Offer accepted')
    expect(opts.description).toBe('12.000.000 ₫')
    expect(opts.duration).toBe(Infinity)
    expect(React.isValidElement(opts.action)).toBe(true)
  })

  it('Undo is a real 44px target: a positioned tap-44 button, not sonner’s 24px default', () => {
    const { result } = renderHook(() => useUndoWindow())
    act(() => { result.current.start('o1', action()) })
    const { getByRole } = render(toasts.state.shown[0].opts.action as React.ReactElement)
    const cls = (getByRole('button', { name: 'Undo' }).getAttribute('class') ?? '').split(/\s+/)
    expect(cls).toContain('tap-44')
    expect(cls).toContain('relative') // without it the pseudo escapes to the toast — globals.css
  })
})

describe('commit happens exactly once, and only when the window closes', () => {
  it('does NOT send before 5s, sends at 5s with via=timer, and takes the toast down with it', () => {
    const { result } = renderHook(() => useUndoWindow())
    const a = action()
    act(() => { result.current.start('o1', a) })
    act(() => { vi.advanceTimersByTime(UNDO_WINDOW_MS - 1) })
    expect(a.commit).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(a.commit).toHaveBeenCalledTimes(1)
    expect(a.commit).toHaveBeenCalledWith('timer')
    expect(toasts.state.dismissed).toEqual([1])
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(a.commit).toHaveBeenCalledTimes(1)
  })

  it('Undo inside the window restores and NEVER sends — not at 5s, not on leaving', () => {
    const { result, unmount } = renderHook(() => useUndoWindow())
    const a = action()
    act(() => { result.current.start('o1', a) })
    act(() => { vi.advanceTimersByTime(2000) })
    clickUndo()
    expect(a.undo).toHaveBeenCalledTimes(1)
    expect(toasts.state.dismissed).toEqual([1])
    act(() => { vi.advanceTimersByTime(60_000) })
    window.dispatchEvent(new Event('pagehide'))
    unmount()
    expect(a.commit).not.toHaveBeenCalled()
    expect(a.undo).toHaveBeenCalledTimes(1)
  })

  it('an Undo tapped after the window closed does nothing (the send already went out)', () => {
    const { result } = renderHook(() => useUndoWindow())
    const a = action()
    act(() => { result.current.start('o1', a) })
    act(() => { vi.advanceTimersByTime(UNDO_WINDOW_MS) })
    clickUndo()
    expect(a.undo).not.toHaveBeenCalled()
    expect(a.commit).toHaveBeenCalledTimes(1)
  })
})

describe('leaving sends immediately — never a silent drop', () => {
  it('unmount (in-app navigation away) sends with via=leave', () => {
    const { result, unmount } = renderHook(() => useUndoWindow())
    const a = action()
    act(() => { result.current.start('o1', a) })
    unmount()
    expect(a.commit).toHaveBeenCalledTimes(1)
    expect(a.commit).toHaveBeenCalledWith('leave')
    act(() => { vi.advanceTimersByTime(60_000) }) // the cleared timer must not send a second time
    expect(a.commit).toHaveBeenCalledTimes(1)
  })

  it('pagehide (reload, full navigation, closing the tab) sends with via=leave', () => {
    const { result } = renderHook(() => useUndoWindow())
    const a = action()
    act(() => { result.current.start('o1', a) })
    window.dispatchEvent(new Event('pagehide'))
    expect(a.commit).toHaveBeenCalledWith('leave')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(a.commit).toHaveBeenCalledTimes(1)
  })

  it('the page going hidden (app switch — a phone may discard the tab with no pagehide) sends; visible does not', () => {
    const { result } = renderHook(() => useUndoWindow())
    const a = action()
    act(() => { result.current.start('o1', a) })
    const vis = vi.spyOn(document, 'visibilityState', 'get')
    vis.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(a.commit).not.toHaveBeenCalled()
    vis.mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(a.commit).toHaveBeenCalledTimes(1)
    expect(a.commit).toHaveBeenCalledWith('leave')
    vis.mockRestore()
  })
})

describe('several windows at once', () => {
  it('a second answer does not cut the first one’s window short; each sends on its own clock', () => {
    const { result } = renderHook(() => useUndoWindow())
    const a = action()
    const b = action({ title: 'Offer declined' })
    act(() => { result.current.start('o1', a) })
    act(() => { vi.advanceTimersByTime(3000) })
    act(() => { result.current.start('o2', b) })
    expect(a.commit).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(a.commit).toHaveBeenCalledTimes(1)
    expect(b.commit).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(3000) })
    expect(b.commit).toHaveBeenCalledTimes(1)
  })

  it('the same key cannot open twice (a double tap is one answer)', () => {
    const { result } = renderHook(() => useUndoWindow())
    const a = action()
    const again = action()
    let second = true
    act(() => { result.current.start('o1', a); second = result.current.start('o1', again) })
    expect(second).toBe(false)
    expect(toasts.state.shown).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(UNDO_WINDOW_MS) })
    expect(a.commit).toHaveBeenCalledTimes(1)
    expect(again.commit).not.toHaveBeenCalled()
  })

  it('cancel() closes a window with neither send nor undo (the server already answered the offer)', () => {
    const { result, unmount } = renderHook(() => useUndoWindow())
    const a = action()
    act(() => { result.current.start('o1', a) })
    expect(result.current.isOpen('o1')).toBe(true)
    let cancelled = false
    act(() => { cancelled = result.current.cancel('o1') })
    expect(cancelled).toBe(true)
    expect(result.current.isOpen('o1')).toBe(false)
    expect(toasts.state.dismissed).toEqual([1])
    act(() => { vi.advanceTimersByTime(60_000) })
    unmount()
    expect(a.commit).not.toHaveBeenCalled()
    expect(a.undo).not.toHaveBeenCalled()
  })

  it('returns one stable object across renders (it sits in the deps of the thread’s load())', () => {
    const { result, rerender } = renderHook(() => useUndoWindow())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
