// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The photo ✕ comes with an Undo (Emil-skills audit, missing confirmations). It used to drop the photo AND revoke its
 * blob at once, so it could not even be shown again. The hook revokes every blob it made on unmount instead.
 */

const toasts = vi.hoisted(() => [] as { title: string; opts?: { id?: string; onAutoClose?: () => void; onDismiss?: () => void; action?: { label: string; onClick: () => void } } }[])
vi.mock('sonner', () => ({
  toast: Object.assign((title: string, opts?: { action?: { label: string; onClick: () => void } }) => { toasts.push({ title, opts }); return toasts.length }, { error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
}))
const { usePostMedia } = await import('./use-post-media')

afterEach(() => { toasts.length = 0; vi.restoreAllMocks() })

const photo = (n: number) => ({ url: `blob:p${n}`, file: new File([String(n)], `p${n}.jpg`, { type: 'image/jpeg' }) })

describe('usePostMedia.removePhoto', () => {
  it('⛔ removes the photo, keeps its blob, and Undo puts it back where it was — once', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    const [a, b, c] = [photo(1), photo(2), photo(3)]
    act(() => { hook.result.current.setPhotos([a, b, c]) })
    act(() => { hook.result.current.removePhoto(1) })
    expect(hook.result.current.photos).toEqual([a, c])
    expect(revoke).not.toHaveBeenCalled() // still showable, for the Undo
    const undo = toasts.find((t) => t.title === 'Photo removed')
    expect(undo?.opts?.action?.label).toBe('Undo')
    act(() => { undo!.opts!.action!.onClick() })
    expect(hook.result.current.photos).toEqual([a, b, c])
    act(() => { undo!.opts!.action!.onClick() }) // a second tap
    expect(hook.result.current.photos).toEqual([a, b, c])
  })

  it('⛔ two removals keep two Undos: the second ✕ does not take the first one’s way back', () => {
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    const [a, b, c] = [photo(1), photo(2), photo(3)]
    act(() => { hook.result.current.setPhotos([a, b, c]) })
    act(() => { hook.result.current.removePhoto(0) }) // a
    act(() => { hook.result.current.removePhoto(0) }) // then b
    const removals = toasts.filter((t) => t.title === 'Photo removed')
    expect(removals).toHaveLength(2)
    expect((removals[0].opts as { id?: string }).id).not.toBe((removals[1].opts as { id?: string }).id) // never one toast replacing the other
    act(() => { removals[0].opts!.action!.onClick() }) // the FIRST removal's Undo still works…
    expect(hook.result.current.photos).toEqual([a, c])
    act(() => { removals[1].opts!.action!.onClick() }) // …and the second lands where it was: [a, b, c], not [b, a, c]
    expect(hook.result.current.photos).toEqual([a, b, c])
  })

  it('undone in the other order, the two still land as they were', () => {
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    const [a, b, c] = [photo(1), photo(2), photo(3)]
    act(() => { hook.result.current.setPhotos([a, b, c]) })
    act(() => { hook.result.current.removePhoto(0) })
    act(() => { hook.result.current.removePhoto(0) })
    const removals = toasts.filter((t) => t.title === 'Photo removed')
    act(() => { removals[1].opts!.action!.onClick() })
    act(() => { removals[0].opts!.action!.onClick() })
    expect(hook.result.current.photos).toEqual([a, b, c])
  })

  it('a removed photo’s blob is let go when its Undo closes unused — not held until the form unmounts', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    const [a, b] = [photo(1), photo(2)]
    act(() => { hook.result.current.setPhotos([a, b]) })
    act(() => { hook.result.current.removePhoto(0) })
    act(() => { toasts.find((t) => t.title === 'Photo removed')!.opts!.onAutoClose!() })
    expect(revoke).toHaveBeenCalledWith('blob:p1')
  })

  it('…but kept when the photo came back', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    const [a, b] = [photo(1), photo(2)]
    act(() => { hook.result.current.setPhotos([a, b]) })
    act(() => { hook.result.current.removePhoto(0) })
    const undo = toasts.find((t) => t.title === 'Photo removed')!
    act(() => { undo.opts!.action!.onClick() })
    expect(hook.result.current.photos).toEqual([a, b])
    expect(revoke).not.toHaveBeenCalledWith('blob:p1')
  })

  it('Undo does not overfill a form that has been filled up again (6 photos) — and the blob it could not restore is still let go', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    const six = [1, 2, 3, 4, 5, 6].map(photo)
    act(() => { hook.result.current.setPhotos(six) })
    act(() => { hook.result.current.removePhoto(0) })
    act(() => { hook.result.current.setPhotos((p) => [...p, photo(7)]) }) // back to six
    const undo = toasts.find((t) => t.title === 'Photo removed')!
    act(() => { undo.opts!.action!.onClick() }) // sonner then closes the toast WITHOUT onDismiss — so the action itself lets go
    expect(hook.result.current.photos).toHaveLength(6)
    expect(revoke).toHaveBeenCalledWith('blob:p1')
  })
})
