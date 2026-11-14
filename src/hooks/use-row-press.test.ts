// @vitest-environment jsdom
/**
 * useRowPress (extracted 2026-11-14 from compact-listing-row.tsx for the job card, no change): the press holds until the row
 * unmounts, a 4s floor frees it if the navigation never lands, and a second tap while pending is a no-op.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PENDING_MAX_MS, useRowPress } from './use-row-press'

afterEach(() => { vi.useRealTimers() })

describe('useRowPress', () => {
  it('opens once, holds, and frees itself after the floor', () => {
    vi.useFakeTimers()
    const onOpen = vi.fn()
    const { result } = renderHook(() => useRowPress(onOpen))
    act(() => { result.current.open() })
    act(() => { result.current.open() })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(result.current.pending).toBe(true)
    act(() => { vi.advanceTimersByTime(PENDING_MAX_MS - 1) })
    expect(result.current.pending).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.pending).toBe(false)
    act(() => { result.current.open() })
    expect(onOpen).toHaveBeenCalledTimes(2)
  })
  it('clears its timer on unmount', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useRowPress(vi.fn()))
    act(() => { result.current.open() })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
