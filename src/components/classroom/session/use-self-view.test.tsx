// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSelfView } from './use-self-view'

/**
 * THE SELF-VIEW'S CAMERA (owner, 2026-10-27: the call screen "as close as possible" to Praktika's). ⛔ A camera request
 * still waiting — the permission prompt up — when the learner turns it off or the screen goes is let go the moment it
 * arrives: never a camera light with no button left to turn it off (review, codex + opus).
 */
type Track = { stop: ReturnType<typeof vi.fn> }
function fakeCamera() {
  const asks: { resolve: (s: MediaStream) => void; track: Track }[] = []
  const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => {
    const track = { stop: vi.fn() }
    asks.push({ resolve, track })
  }))
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia }, permissions: { query: async () => ({ state: 'granted' }) } })
  const answer = (i: number) => asks[i].resolve({ getTracks: () => [asks[i].track] } as unknown as MediaStream)
  return { asks, answer, getUserMedia }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); try { localStorage.clear() } catch { /* none */ } })

describe('useSelfView', () => {
  it('on, then off: the stream shows, then every track stops', async () => {
    const cam = fakeCamera()
    const { result } = renderHook(() => useSelfView(true, 'seat-1'))
    let r: Promise<string>
    act(() => { r = result.current.toggle() })
    await act(async () => { cam.answer(0); expect(await r).toBe('on') })
    expect(result.current.stream).not.toBeNull()
    await act(async () => { expect(await result.current.toggle()).toBe('off') })
    expect(cam.asks[0].track.stop).toHaveBeenCalled()
    expect(result.current.stream).toBeNull()
  })

  it('⛔ the screen goes while the browser is still asking: the camera that arrives later is stopped at once', async () => {
    const cam = fakeCamera()
    const { result, unmount } = renderHook(() => useSelfView(true, 'seat-1'))
    let r: Promise<string>
    act(() => { r = result.current.toggle() })
    unmount() // End, or the screen closed — the prompt still up
    cam.answer(0) // …then the learner taps Allow
    expect(await r!).toBe('off')
    expect(cam.asks[0].track.stop).toHaveBeenCalled()
  })

  it('⛔ a second press while it is still asking cancels — it never asks twice or ends up on', async () => {
    const cam = fakeCamera()
    const { result } = renderHook(() => useSelfView(true, 'seat-1'))
    let first: Promise<string>
    act(() => { first = result.current.toggle() })
    await act(async () => { expect(await result.current.toggle()).toBe('off') })
    expect(cam.getUserMedia).toHaveBeenCalledTimes(1)
    await act(async () => { cam.answer(0); expect(await first).toBe('off') })
    expect(cam.asks[0].track.stop).toHaveBeenCalled()
    expect(result.current.stream).toBeNull()
  })

  it('⛔ no longer allowed: the camera goes, and a request still waiting is let go when it arrives', async () => {
    const cam = fakeCamera()
    const { result, rerender } = renderHook(({ ok }) => useSelfView(ok, 'seat-1'), { initialProps: { ok: true } })
    let r: Promise<string>
    act(() => { r = result.current.toggle() })
    rerender({ ok: false })
    await act(async () => { cam.answer(0); expect(await r).toBe('off') })
    expect(cam.asks[0].track.stop).toHaveBeenCalled()
    expect(result.current.stream).toBeNull()
  })

  it('⛔ another learner on the same screen: the first one\'s camera goes', async () => {
    const cam = fakeCamera()
    const { result, rerender } = renderHook(({ who }) => useSelfView(true, who), { initialProps: { who: 'seat-1' } })
    let r: Promise<string>
    act(() => { r = result.current.toggle() })
    await act(async () => { cam.answer(0); expect(await r).toBe('on') })
    rerender({ who: 'seat-2' })
    expect(cam.asks[0].track.stop).toHaveBeenCalled()
    expect(result.current.stream).toBeNull()
  })

  it('no camera API (an in-app browser): "unsupported", not "blocked"; never offered when not allowed', async () => {
    vi.stubGlobal('navigator', {})
    const { result } = renderHook(() => useSelfView(true, 'seat-1'))
    await act(async () => { expect(await result.current.toggle()).toBe('unsupported') })
    const cam = fakeCamera()
    const child = renderHook(() => useSelfView(false, 'seat-2'))
    await act(async () => { expect(await child.result.current.toggle()).toBe('off') })
    expect(cam.getUserMedia).not.toHaveBeenCalled()
  })

  it('at Start it comes back only if left on AND the browser already allows it — never a prompt', async () => {
    const cam = fakeCamera()
    const { result } = renderHook(() => useSelfView(true, 'seat-1'))
    localStorage.setItem('eno-classroom-self-view:seat-2', 'on') // ANOTHER learner left theirs on
    await act(async () => { await result.current.resume() })
    expect(cam.getUserMedia).not.toHaveBeenCalled() // not this learner's
    localStorage.setItem('eno-classroom-self-view:seat-1', 'on')
    let p: Promise<void>
    act(() => { p = result.current.resume() })
    await act(async () => {
      await vi.waitFor(() => expect(cam.asks).toHaveLength(1)) // after the permission check, with no prompt
      cam.answer(0)
      await p
    })
    expect(result.current.stream).not.toBeNull()
  })
})
