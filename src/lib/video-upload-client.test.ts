// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// uploadListingVideo's contract with the transcode route (2026-10-18, a teacher's intro video up to five minutes): the body
// names the kind; an intro video is polled every 5 s for up to 12 minutes, a listing's clip every 3 s for 330 s as always;
// and a clip the server found over its kind's length throws 'video_too_long' — on the synchronous 422 and on a failed poll —
// while every other failure keeps its old code.
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowser: () => ({ storage: { from: () => ({ uploadToSignedUrl: async (_p: string, _t: string, _f: File, o: { contentType: string }) => { h.stored.push(o.contentType); return { error: null } } }) } }),
}))

type Reply = { status: number; body: unknown }
const h = vi.hoisted(() => ({ posts: [] as unknown[], stored: [] as string[], polls: 0, transcode: { status: 202, body: { status: 'running' } } as Reply, poll: (): Reply => ({ status: 200, body: { status: 'running' } }) }))
const json = (r: Reply) => new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  h.posts = []; h.stored = []; h.polls = 0
  h.transcode = { status: 202, body: { status: 'running' } }
  h.poll = () => ({ status: 200, body: { status: 'running' } })
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/upload/video/sign') return json({ status: 200, body: { path: '1792300000000-abc123.mp4', token: 't' } })
    if (url === '/api/upload/video/complete') return json({ status: 200, body: { ok: true } })
    if (url === '/api/upload/video/transcode' && init?.method === 'POST') { h.posts.push(JSON.parse(String(init.body))); return json(h.transcode) }
    if (url.startsWith('/api/upload/video/transcode?path=')) { h.polls++; return json(h.poll()) }
    throw new Error(`unexpected ${url}`)
  }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const { uploadListingVideo, TRANSCODE_WAIT_MS, videoUploadType } = await import('./video-upload-client')
const clip = () => new File([new Uint8Array(8)], 'intro.mp4', { type: 'video/mp4' })
/** Runs the upload to its end with the clock advanced in steps, returning what it resolved or threw. */
async function settle(p: Promise<string | null>, ms: number): Promise<{ value?: string | null; error?: string }> {
  const out = p.then((value) => ({ value }), (e: Error) => ({ error: e.message }))
  for (let t = 0; t <= ms; t += 1_000) await vi.advanceTimersByTimeAsync(1_000)
  return out
}

describe('uploadListingVideo — kinds', () => {
  it('names the kind in the transcode request: a listing by default, an intro video when asked', async () => {
    h.transcode = { status: 200, body: { url: 'https://sb.eno.vn/x.mp4' } }
    expect(await settle(uploadListingVideo(clip()), 0)).toEqual({ value: 'https://sb.eno.vn/x.mp4' })
    expect(await settle(uploadListingVideo(clip(), { hevc: true, kind: 'teacher_intro' }), 0)).toEqual({ value: 'https://sb.eno.vn/x.mp4' })
    expect(h.posts).toEqual([
      { path: '1792300000000-abc123.mp4', hevc: false, kind: 'listing' },
      { path: '1792300000000-abc123.mp4', hevc: true, kind: 'teacher_intro' },
    ])
  })

  it('a listing\'s clip is polled every 3 s and given up on after 330 s — as always, no extra ask', async () => {
    expect(TRANSCODE_WAIT_MS.listing).toBe(330_000)
    expect(await settle(uploadListingVideo(clip()), 340_000)).toEqual({ value: null })
    expect(h.polls).toBe(110)
  })

  it('⛔ an intro video\'s encode that finished while the page slept past the deadline is still picked up by one last ask', async () => {
    let n = 0
    h.poll = () => (++n <= 144 ? { status: 200, body: { status: 'running' } } : { status: 200, body: { status: 'done', url: 'https://sb.eno.vn/late.mp4' } })
    expect(await settle(uploadListingVideo(clip(), { kind: 'teacher_intro' }), 730_000)).toEqual({ value: 'https://sb.eno.vn/late.mp4' })
    expect(h.polls).toBe(145)
  })

  it('an intro video holds the screen on while it uploads and encodes, and lets it go after; a listing\'s clip does not', async () => {
    const lock = { release: vi.fn(async () => {}) }
    const request = vi.fn(async () => lock)
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
    try {
      h.transcode = { status: 200, body: { url: 'https://sb.eno.vn/x.mp4' } }
      await settle(uploadListingVideo(clip()), 0)
      expect(request).not.toHaveBeenCalled()
      await settle(uploadListingVideo(clip(), { kind: 'teacher_intro' }), 0)
      expect(request).toHaveBeenCalledWith('screen')
      expect(lock.release).toHaveBeenCalledTimes(1)
      // A browser that refuses the lock still uploads.
      request.mockRejectedValueOnce(new Error('NotAllowedError'))
      expect(await settle(uploadListingVideo(clip(), { kind: 'teacher_intro' }), 0)).toEqual({ value: 'https://sb.eno.vn/x.mp4' })
      // The page hidden and back mid-upload (the browser dropped the lock): taken again, and let go at the end.
      request.mockClear(); lock.release.mockClear()
      h.transcode = { status: 202, body: { status: 'running' } }
      let n = 0
      h.poll = () => (++n < 3 ? { status: 200, body: { status: 'running' } } : { status: 200, body: { status: 'done', url: 'https://sb.eno.vn/y.mp4' } })
      const p = uploadListingVideo(clip(), { kind: 'teacher_intro' })
      await vi.advanceTimersByTimeAsync(1_000)
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      expect(await settle(p, 20_000)).toEqual({ value: 'https://sb.eno.vn/y.mp4' })
      expect(request).toHaveBeenCalledTimes(2)
      expect(lock.release).toHaveBeenCalledTimes(1)
      // After the upload, a visibility change takes nothing.
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(10)
      expect(request).toHaveBeenCalledTimes(2)
    } finally {
      delete (navigator as { wakeLock?: unknown }).wakeLock
    }
  })

  it('an intro video is polled every 5 s and waited on for 12 minutes — its encode may run 9', async () => {
    expect(TRANSCODE_WAIT_MS.teacher_intro).toBe(720_000)
    let n = 0
    h.poll = () => (++n < 100 ? { status: 200, body: { status: 'running' } } : { status: 200, body: { status: 'done', url: 'https://sb.eno.vn/long.mp4' } })
    // 100 polls at 5 s = 500 s: past a listing's 330 s, inside the intro video's 720 s.
    expect(await settle(uploadListingVideo(clip(), { kind: 'teacher_intro' }), 520_000)).toEqual({ value: 'https://sb.eno.vn/long.mp4' })
    expect(h.polls).toBe(100)
  })

  it('⛔ a clip the server found too long throws video_too_long — from a failed poll and from the synchronous 422', async () => {
    h.poll = () => ({ status: 200, body: { status: 'failed', reason: 'too_long' } })
    expect(await settle(uploadListingVideo(clip(), { kind: 'teacher_intro' }), 10_000)).toEqual({ error: 'video_too_long' })
    h.transcode = { status: 422, body: { error: 'video_too_long' } }
    expect(await settle(uploadListingVideo(clip(), { kind: 'teacher_intro' }), 0)).toEqual({ error: 'video_too_long' })
  })

  it('an intro video refused for too many tries (429) or asked to try again (503) is video_busy; a listing\'s clip keeps "video"', async () => {
    for (const status of [429, 503]) {
      h.transcode = { status, body: { error: status === 429 ? 'rate_limited' : 'retry' } }
      expect(await settle(uploadListingVideo(clip(), { kind: 'teacher_intro' }), 0)).toEqual({ error: 'video_busy' })
      expect(await settle(uploadListingVideo(clip()), 0)).toEqual({ error: 'video' })
    }
  })

  it('an intro video\'s 422 that is not too_long is "video" — it fails closed whatever its codec; a listing\'s stays video_hevc', async () => {
    h.transcode = { status: 422, body: { error: 'transcode_failed' } }
    expect(await settle(uploadListingVideo(clip(), { kind: 'teacher_intro' }), 0)).toEqual({ error: 'video' })
    expect(await settle(uploadListingVideo(clip(), { kind: 'teacher_intro', hevc: true }), 0)).toEqual({ error: 'video' })
    expect(await settle(uploadListingVideo(clip()), 0)).toEqual({ error: 'video_hevc' })
  })

  it('every other failure keeps its old code: a 422 is the HEVC retry, a failed poll is video / video_hevc', async () => {
    h.transcode = { status: 422, body: { error: 'transcode_failed' } }
    expect(await settle(uploadListingVideo(clip(), { hevc: true }), 0)).toEqual({ error: 'video_hevc' })
    h.transcode = { status: 202, body: { status: 'running' } }
    h.poll = () => ({ status: 200, body: { status: 'failed' } })
    expect(await settle(uploadListingVideo(clip()), 10_000)).toEqual({ error: 'video' })
    expect(await settle(uploadListingVideo(clip(), { hevc: true, kind: 'teacher_intro' }), 10_000)).toEqual({ error: 'video_hevc' })
  })
})

describe('uploadListingVideo — the type it signs', () => {
  const signed = () => vi.mocked(fetch).mock.calls.filter(([u]) => u === '/api/upload/video/sign').map(([, init]) => JSON.parse(init?.body as string))
  it('⛔ an .m4v typed video/x-m4v, and a clip with no type, are signed as a type the route allows — they were refused (415) on every retry', async () => {
    h.transcode = { status: 200, body: { url: 'https://sb.eno.vn/x.mp4' } }
    expect(await settle(uploadListingVideo(new File([new Uint8Array(8)], 'trip.m4v', { type: 'video/x-m4v' })), 0)).toEqual({ value: 'https://sb.eno.vn/x.mp4' })
    expect(signed()).toEqual([{ type: 'video/mp4', size: 8 }])
    expect(h.stored).toEqual(['video/mp4'])
    expect(await settle(uploadListingVideo(new File([new Uint8Array(8)], 'IMG_0001.MOV', { type: '' })), 0)).toEqual({ value: 'https://sb.eno.vn/x.mp4' })
    expect(h.stored).toEqual(['video/mp4', 'video/quicktime'])
    expect(signed()[1]).toEqual({ type: 'video/quicktime', size: 8 })
    expect(videoUploadType({ name: 'IMG_0001.MOV', type: '' })).toBe('video/quicktime')
    expect(videoUploadType({ name: 'clip.m4v', type: '' })).toBe('video/mp4')
    expect(videoUploadType({ name: 'clip.webm', type: '' })).toBe('video/webm')
    expect(videoUploadType({ name: 'clip.mp4', type: 'video/mp4' })).toBe('video/mp4')
    expect(videoUploadType({ name: 'notes', type: '' })).toBe('')
    expect(videoUploadType({ name: 'mp4', type: '' })).toBe('')
    expect(videoUploadType({ name: 'clip.constructor', type: '' })).toBe('')
    expect(videoUploadType({ name: 'clip.__proto__', type: '' })).toBe('')
  })
})
