// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A PHOTO UPLOADS ONCE (use-post-media.ts). A Publish retried after a failure — the video, a refused word, a
 * dropped connection halfway — used to upload every photo again. Each File's hosted URL is kept as its batch lands.
 */

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }) }))
const { usePostMedia } = await import('./use-post-media')

afterEach(() => { vi.unstubAllGlobals() })

const file = (n: number) => new File([String(n)], `p${n}.jpg`, { type: 'image/jpeg' })

describe('usePostMedia.uploadPhotos', () => {
  it('⛔ a retry sends only what is not up yet, and returns every URL in photo order', async () => {
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    const files = [1, 2, 3, 4, 5].map(file)
    act(() => { hook.result.current.setPhotos([{ url: 'hosted-0' }, ...files.map((f) => ({ url: `blob:${f.name}`, file: f }))]) })
    const bodies: string[][] = []
    let failSecond = true
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const names = (init!.body as FormData).getAll('files').map((f) => (f as File).name)
      bodies.push(names)
      if (names.includes('p4.jpg') && failSecond) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ urls: names.map((n) => `https://cdn/${n}`) }) }
    }))
    const progress: [number, number][] = []
    await expect(hook.result.current.uploadPhotos((d, t) => progress.push([d, t]))).rejects.toThrow('upload')
    expect(progress).toEqual([[0, 5], [3, 5]]) // the first batch landed before the second failed
    failSecond = false
    progress.length = 0
    const urls = await hook.result.current.uploadPhotos((d, t) => progress.push([d, t]))
    expect(bodies).toEqual([['p1.jpg', 'p2.jpg', 'p3.jpg'], ['p4.jpg', 'p5.jpg'], ['p4.jpg', 'p5.jpg']]) // p1–p3 never again
    expect(progress).toEqual([[3, 5], [5, 5]])
    expect(urls).toEqual(['hosted-0', 'https://cdn/p1.jpg', 'https://cdn/p2.jpg', 'https://cdn/p3.jpg', 'https://cdn/p4.jpg', 'https://cdn/p5.jpg'])
  })

  it('a re-cropped photo is a new File, so it uploads again — nothing is reused for different bytes', async () => {
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    const a = file(1)
    act(() => { hook.result.current.setPhotos([{ url: 'blob:a', file: a }]) })
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const names = (init!.body as FormData).getAll('files').map((f) => (f as File).name)
      sent.push(...names)
      return { ok: true, status: 200, json: async () => ({ urls: names.map((n) => `https://cdn/${n}-${sent.length}`) }) }
    }))
    await hook.result.current.uploadPhotos()
    const recropped = new File(['1-square'], 'p1.jpg', { type: 'image/jpeg' })
    act(() => { hook.result.current.setPhotos([{ url: 'blob:a2', file: recropped }]) })
    const urls = await hook.result.current.uploadPhotos()
    expect(sent).toEqual(['p1.jpg', 'p1.jpg'])
    expect(urls).toEqual(['https://cdn/p1.jpg-2'])
  })
})
