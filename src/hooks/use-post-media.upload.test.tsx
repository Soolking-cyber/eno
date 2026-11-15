// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A PHOTO UPLOADS ONCE (use-post-media.ts). A Publish retried after a failure — the video, a refused word, a
 * dropped connection halfway — used to upload every photo again. Each File's hosted URL is kept as its batch lands.
 */

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }) }))
const { usePostMedia } = await import('./use-post-media')
const { toast } = await import('sonner')
const { PhotoRefusedError } = await import('@/lib/upload-client')

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

/**
 * ⛔ A PHOTO THE CHECK REFUSED IS MARKED BY ITS FILE, never by tile index (tiles reorder and are keyed by index): the mark
 * follows a move, a ✕ and its Undo; a crop is a new File and is checked again.
 */
describe('usePostMedia — refused photos', () => {
  const refuseNames = (names: string[]) => vi.fn(async (_url: string, init?: RequestInit) => {
    const sent = (init!.body as FormData).getAll('files').map((f) => (f as File).name)
    return { ok: true, status: 200, json: async () => ({ urls: [], results: sent.map((n) => (names.includes(n) ? { reason: 'photo_flyer' } : { url: `https://cdn/${n}` })) }) }
  })

  it('marks the refused File, keeps the accepted ones up, and stops the next Publish before any upload', async () => {
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    const [a, b] = [file(1), file(2)]
    act(() => { hook.result.current.setPhotos([{ url: 'blob:a', file: a }, { url: 'blob:b', file: b }]) })
    const fetchMock = refuseNames(['p2.jpg'])
    vi.stubGlobal('fetch', fetchMock)
    let err: unknown
    await act(async () => { err = await hook.result.current.uploadPhotos(undefined, 'rentals').catch((e) => e) })
    expect(err).toBeInstanceOf(PhotoRefusedError)
    const sent = fetchMock.mock.calls[0][1]!.body as FormData
    expect([sent.get('check'), sent.get('category')]).toEqual(['listing', 'rentals'])
    const r = hook.result.current
    expect(r.photos.map((p) => r.refusalOf(p))).toEqual([undefined, 'flyer'])
    // Moved to the cover slot, the mark goes with it.
    act(() => { hook.result.current.movePhoto(1, 0) })
    const moved = hook.result.current
    expect(moved.photos.map((p) => moved.refusalOf(p))).toEqual(['flyer', undefined])
    fetchMock.mockClear()
    await expect(moved.uploadPhotos(undefined, 'rentals')).rejects.toThrow('upload_photo_refused')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('⛔ a flyer mark does not count once the category is Jobs (no flyer rule there); a contact mark still does', async () => {
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    act(() => { hook.result.current.setPhotos([{ url: 'blob:a', file: file(1) }]) })
    vi.stubGlobal('fetch', refuseNames(['p1.jpg']))
    await act(async () => { await hook.result.current.uploadPhotos(undefined, 'services').catch(() => {}) })
    const r = hook.result.current
    expect([r.refusalOf(r.photos[0], 'services'), r.refusalOf(r.photos[0], 'jobs')]).toEqual(['flyer', undefined])
    vi.stubGlobal('fetch', refuseNames([]))
    await expect(r.uploadPhotos(undefined, 'jobs')).resolves.toEqual(['https://cdn/p1.jpg'])
    const contact = renderHook(() => usePostMedia({ t: (_vi, en) => en, edit: { images: ['https://sb/h1.webp'], photoRefused: [{ url: 'https://sb/h1.webp', rule: 'contact' }] } }))
    await expect(contact.result.current.uploadPhotos(undefined, 'jobs')).rejects.toThrow('upload_photo_refused')
  })

  it('sends the aisle and the storefront with the check', async () => {
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    act(() => { hook.result.current.setPhotos([{ url: 'blob:a', file: file(1) }]) })
    const fetchMock = refuseNames([])
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { await hook.result.current.uploadPhotos(undefined, 'services', { subcategory: 'esim', seller: 's1' }) })
    const sent = fetchMock.mock.calls[0][1]!.body as FormData
    expect([sent.get('category'), sent.get('subcategory'), sent.get('seller')]).toEqual(['services', 'esim', 's1'])
  })

  it('✕ and its Undo carry the mark; a re-cropped photo is a new File and goes up again', async () => {
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en }))
    const a = file(1)
    act(() => { hook.result.current.setPhotos([{ url: 'blob:a', file: a, original: a, square: false }]) })
    vi.stubGlobal('fetch', refuseNames(['p1.jpg']))
    await act(async () => { await hook.result.current.uploadPhotos(undefined, 'rentals').catch(() => {}) })
    vi.mocked(toast).mockClear()
    act(() => { hook.result.current.removePhoto(0) })
    const undo = (vi.mocked(toast).mock.calls[0][1] as unknown as { action: { onClick: () => void } }).action
    act(() => { undo.onClick() })
    expect(hook.result.current.refusalOf(hook.result.current.photos[0])).toBe('flyer')
    const square = new File(['1-square'], 'p1-square.jpg', { type: 'image/jpeg' })
    URL.createObjectURL ??= () => 'blob:square'
    act(() => { hook.result.current.applySquareCrop(0, square) })
    expect(hook.result.current.refusalOf(hook.result.current.photos[0])).toBeUndefined()
    vi.stubGlobal('fetch', refuseNames([]))
    await expect(hook.result.current.uploadPhotos(undefined, 'rentals')).resolves.toEqual(['https://cdn/p1-square.jpg'])
  })

  it('an edit opens with its confirmed refusals marked (hosted photos, by URL); the save’s refusal marks by the URL sent', async () => {
    const hook = renderHook(() => usePostMedia({ t: (_vi, en) => en, edit: { images: ['https://sb/h1.webp', 'https://sb/h2.webp'], photoRefused: [{ url: 'https://sb/h2.webp', rule: 'contact' }] } }))
    expect(hook.result.current.photos.map((p) => hook.result.current.refusalOf(p))).toEqual([undefined, 'contact'])
    await expect(hook.result.current.uploadPhotos()).rejects.toThrow('upload_photo_refused')
    // Removed, the rest saves; then the server refuses a new photo by the URL it was sent as.
    act(() => { hook.result.current.setPhotos([{ url: 'https://sb/h1.webp' }, { url: 'blob:n', file: file(3) }]) })
    vi.stubGlobal('fetch', refuseNames([]))
    expect(await hook.result.current.uploadPhotos(undefined, 'rentals')).toEqual(['https://sb/h1.webp', 'https://cdn/p3.jpg'])
    act(() => { hook.result.current.markRefusedUrls(new Map([['https://cdn/p3.jpg', 'flyer']])) })
    expect(hook.result.current.photos.map((p) => hook.result.current.refusalOf(p))).toEqual([undefined, 'flyer'])
  })
})
