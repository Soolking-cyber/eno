// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { capturePosts, fileOf, installFakeImageCodec, noise, restoreFakeImageCodec } from '@/test/fake-image-codec'

/**
 * Owner, 2026-11-12: "when person uploads image do not crop but fit in so nothing from original image misses".
 * Until then every new photo was center-cropped to a square before upload, so a wide event banner reached the listing
 * as its middle third (377×377 on prod). A photo now goes up whole; a square crop is only what the seller picks.
 */

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), loading: vi.fn(), dismiss: vi.fn(), success: vi.fn() }) }))
const { usePostMedia } = await import('./use-post-media')

afterEach(() => { restoreFakeImageCodec() })

const sizeOf = async (f: File) => {
  const m = await sharp(Buffer.from(await f.arrayBuffer())).metadata()
  return `${m.width}x${m.height}`
}

describe('usePostMedia: a new photo is uploaded whole', () => {
  it('⛔ a wide banner goes up at its own 3:1 shape, not cropped to a square', async () => {
    installFakeImageCodec()
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    const banner = fileOf(await noise(300, 100).jpeg({ quality: 90 }).toBuffer(), 'banner.jpg', 'image/jpeg')
    await act(async () => { await hook.result.current.addPhotos([banner]) })
    expect(hook.result.current.photos).toHaveLength(1)
    expect(hook.result.current.photos[0].square).toBe(false)
    const posted = capturePosts()
    await act(async () => { await hook.result.current.uploadPhotos() })
    expect(posted).toHaveLength(1)
    expect(await sizeOf(posted[0])).toBe('300x100')
  })

  it('a tall photo goes up whole too', async () => {
    installFakeImageCodec()
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    const tall = fileOf(await noise(90, 160).jpeg({ quality: 90 }).toBuffer(), 'tall.jpg', 'image/jpeg')
    await act(async () => { await hook.result.current.addPhotos([tall]) })
    const posted = capturePosts()
    await act(async () => { await hook.result.current.uploadPhotos() })
    expect(await sizeOf(posted[0])).toBe('90x160')
  })
})
