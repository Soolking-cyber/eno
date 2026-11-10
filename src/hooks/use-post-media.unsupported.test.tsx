// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { capturePosts, fileOf, headKind, installFakeImageCodec, noise, restoreFakeImageCodec } from '@/test/fake-image-codec'

/**
 * R37 through the post wizard's own media hook. The square crop always re-encodes, so the bytes that reach /api/upload
 * unchanged are the ones behind "Keep full photo" (`original`, which is compressImageFile's output). An AVIF named
 * photo.jpg must go up as WebP there, and a photo the browser cannot read is refused when it is picked, with the
 * wizard's existing format copy, and never posted.
 */

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), loading: vi.fn(), dismiss: vi.fn(), success: vi.fn() }) }))
const { toast } = await import('sonner')
const { usePostMedia } = await import('./use-post-media')

afterEach(() => { restoreFakeImageCodec(); vi.mocked(toast.error).mockClear() })

describe('usePostMedia: a photo goes up as JPEG, PNG or WebP bytes, or is refused at pick time', () => {
  it('⛔ "Keep full photo" on an AVIF named photo.jpg posts WebP bytes, not the AVIF', async () => {
    installFakeImageCodec()
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    const avif = fileOf(await noise(64, 48).avif({ quality: 30 }).toBuffer(), 'photo.jpg', 'image/jpeg')
    await act(async () => { await hook.result.current.addPhotos([avif]) })
    expect(hook.result.current.photos).toHaveLength(1)
    act(() => { hook.result.current.keepFullPhoto(0) })
    const posted = capturePosts()
    await act(async () => { await hook.result.current.uploadPhotos() })
    expect(posted).toHaveLength(1)
    expect(await headKind(posted[0])).toBe('webp')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('⛔ a photo the browser cannot decode, and the server would refuse, gets the format message and is never posted', async () => {
    installFakeImageCodec() // Chrome: no TIFF decoder
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    const tiff = fileOf(await noise(64, 48).tiff().toBuffer(), 'scan.jpg', 'image/jpeg')
    await act(async () => { await hook.result.current.addPhotos([tiff]) })
    expect(toast.error).toHaveBeenCalledWith('That photo format is not supported — use a JPG, PNG or WebP.')
    expect(hook.result.current.photos).toHaveLength(0)
    const posted = capturePosts()
    await act(async () => { await hook.result.current.uploadPhotos() })
    expect(posted).toHaveLength(0)
  })
})
