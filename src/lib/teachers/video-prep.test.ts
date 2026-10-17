// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The required intro video's preparation (2026-10-16): the post wizard's rules (type, ≤ 60 s with 61 for rounding,
// compression over the 50 MB ceiling, HEVC flagged) — and, because a profile cannot publish without one, a clip whose
// length this browser cannot read still goes up when it needs no shrinking.
const h = vi.hoisted(() => ({ duration: 30 as number, compressOk: true, compressSupported: true, hevc: false }))
vi.mock('@/lib/video-compress', () => ({
  VIDEO_PICK_MAX_BYTES: 150 * 1024 * 1024,
  videoCompressionSupported: () => h.compressSupported,
  compressVideo: async (f: File) => { if (!h.compressOk) throw new Error('x'); return new File([new Uint8Array(10)], f.name.replace(/\.\w+$/, '.mp4'), { type: 'video/mp4' }) },
}))
vi.mock('@/lib/video-upload-client', () => ({ VIDEO_UPLOAD_MAX_BYTES: 50 * 1024 * 1024, hasHevcTrack: async () => h.hevc }))

const { prepareTeacherVideo } = await import('./video-prep')
const MB = 1024 * 1024
const clip = (bytes: number, name = 'hello.mp4', type = 'video/mp4') => {
  const f = new File([new Uint8Array(1)], name, { type })
  Object.defineProperty(f, 'size', { value: bytes })
  return f
}

const realCreate = document.createElement.bind(document)
beforeEach(() => {
  Object.assign(h, { duration: 30, compressOk: true, compressSupported: true, hevc: false })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }))
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'video') return realCreate(tag)
    const v = realCreate('video') as HTMLVideoElement
    Object.defineProperty(v, 'duration', { get: () => h.duration })
    Object.defineProperty(v, 'src', { set: () => { queueMicrotask(() => (Number.isNaN(h.duration) ? v.onerror?.(new Event('error')) : v.onloadedmetadata?.(new Event('loadedmetadata')))) } })
    return v
  }) as typeof document.createElement)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('prepareTeacherVideo', () => {
  it('a short clip under 50 MB goes up as it is, its HEVC flag read', async () => {
    h.hevc = true
    const f = clip(20 * MB)
    expect(await prepareTeacherVideo(f)).toEqual({ file: f, hevc: true })
  })
  it('only MP4, WebM or MOV — an empty type by its name', async () => {
    expect(await prepareTeacherVideo(clip(MB, 'a.avi', 'video/x-msvideo'))).toEqual({ error: 'type' })
    expect('file' in (await prepareTeacherVideo(clip(MB, 'a.mov', '')))).toBe(true)
  })
  it('over 60 seconds (61 for rounding) is refused; over 150 MB — the compressor\'s sound limit — is refused before reading', async () => {
    h.duration = 61.5
    expect(await prepareTeacherVideo(clip(MB))).toEqual({ error: 'too_long' })
    h.duration = 30
    expect(await prepareTeacherVideo(clip(151 * MB))).toEqual({ error: 'too_big' })
    // Owner, 2026-10-17: "put 150mb limit so we have all clips with sound" — 150 MB itself still goes (made smaller).
    expect('file' in (await prepareTeacherVideo(clip(150 * MB)))).toBe(true)
  })
  it('over 50 MB is made smaller — or says this browser cannot', async () => {
    const r = await prepareTeacherVideo(clip(120 * MB, 'big.mov', 'video/quicktime'))
    expect('file' in r && r.file.name).toBe('big.mp4')
    h.compressSupported = false
    expect(await prepareTeacherVideo(clip(120 * MB))).toEqual({ error: 'cannot_compress' })
    h.compressSupported = true
    h.compressOk = false
    expect(await prepareTeacherVideo(clip(120 * MB))).toEqual({ error: 'compress_failed' })
  })
  it('⛔ a length this browser cannot read (a recorded WebM\'s Infinity, an HEVC .mov it cannot open): under 50 MB it still goes up; over, it is refused', async () => {
    h.duration = Infinity
    const f = clip(30 * MB, 'rec.webm', 'video/webm')
    expect(await prepareTeacherVideo(f)).toEqual({ file: f, hevc: false })
    h.duration = NaN
    expect(await prepareTeacherVideo(clip(80 * MB, 'iphone.mov', 'video/quicktime'))).toEqual({ error: 'unreadable' })
  })
})
