import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST/GET /api/upload/video/transcode — the kind (2026-10-18: a teacher's intro video up to five minutes).
 * ⛔ Pinned: the body's `kind` reaches the encode and sizes the lease (wall + 150 s); anything that is not a kind is a
 * listing's clip, exactly as before; an intro video the encode found over five minutes FAILS CLOSED — `video_too_long`, on
 * the poll and on the synchronous fallback — with nothing uploaded and the raw left for the GC (never published cut, never
 * fallen open to the over-long raw); an intro video's failed encode never falls open to its raw (its header length cannot be
 * trusted — WebKit's reads 7,158,338 s for 60 s); and an intro video never runs synchronously (gate review, 2026-10-18).
 */
type Job = { state: string; reason?: string; token?: string }
const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  sets: [] as Array<{ key: string; ex?: number }>,
  kvDown: false,
  after: [] as Array<() => Promise<void>>,
  transcodes: [] as string[],
  result: Buffer.from('ok') as Buffer | 'too_long' | null,
  uploads: 0,
  removes: 0,
  owner: 'p1' as string | null,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => 'p1', getAdmin: async () => null, getCurrentProfile: async () => null }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: true, resetSec: 1 }),
  kv: {
    set: async (key: string, value: string, o: { nx?: boolean; ex?: number }) => {
      if (h.kvDown) throw new Error('kv down')
      h.sets.push({ key, ex: o.ex })
      if (o.nx && h.store.has(key)) return null
      h.store.set(key, value)
      return 'OK'
    },
    get: async (key: string) => (h.kvDown ? null : h.store.get(key) ?? null),
    del: async (key: string) => { h.store.delete(key) },
  },
}))
vi.mock('@/lib/db', () => ({ db: { listing: { count: async () => 0 } } }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/core/video-owner', () => ({ videoOwner: async () => h.owner, recordVideoOwner: async () => {} }))
vi.mock('@/lib/supabase-admin', () => ({
  LISTING_VIDEOS_BUCKET: 'listing-videos',
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://sb.eno.vn/storage/v1/object/public/listing-videos/${p}` } }),
        upload: async () => { h.uploads++; return { error: null } },
        remove: async () => { h.removes++; return { error: null } },
      }),
    },
  }),
}))
vi.mock('@/lib/core/video-transcode', async (orig) => ({
  ...(await orig<typeof import('@/lib/core/video-transcode')>()),
  transcodeToMp4: async (_in: string, kind: string) => { h.transcodes.push(kind); return h.result },
}))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => Promise<void>) => { h.after.push(fn) } }))

const { POST, GET } = await import('./route')
const PATH = '1792300000000-abc123.mp4'
const post = async (body: unknown) => {
  const res = await POST(new Request('https://eno.vn/api/upload/video/transcode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}
const poll = async () => {
  const res = await GET(new Request(`https://eno.vn/api/upload/video/transcode?path=${PATH}`))
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}
const runAfter = async () => { for (const fn of h.after.splice(0)) await fn() }
const job = () => JSON.parse(h.store.get(`xc:${PATH}`) ?? 'null') as Job | null

beforeEach(() => {
  h.store.clear(); h.sets = []; h.kvDown = false; h.after = []; h.transcodes = []
  h.result = Buffer.from('ok'); h.uploads = 0; h.removes = 0; h.owner = 'p1'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(64))))
})

describe('POST /api/upload/video/transcode — kinds', () => {
  it('an intro video is encoded as one, under a lease 150 s past its 540 s wall', async () => {
    expect(await post({ path: PATH, hevc: false, kind: 'teacher_intro' })).toEqual({ status: 202, body: { status: 'running' } })
    expect(h.sets[0]).toEqual({ key: `xc:${PATH}`, ex: 690 })
    await runAfter()
    expect(h.transcodes).toEqual(['teacher_intro'])
    expect(await poll()).toEqual({ status: 200, body: { status: 'done', url: expect.stringMatching(/\/listing-videos\/\d+-[a-z0-9]+\.mp4$/) } })
  })

  it('⛔ no kind, or one that is not a kind, is a listing\'s clip — the 360 s lease and the minute\'s encode, as before', async () => {
    for (const kind of [undefined, 'teacher', 'TEACHER_INTRO', 42, { kind: 'teacher_intro' }]) {
      h.store.clear(); h.sets = []; h.transcodes = []
      await post({ path: PATH, hevc: false, ...(kind === undefined ? {} : { kind }) })
      expect(h.sets[0].ex).toBe(360)
      await runAfter()
      expect(h.transcodes).toEqual(['listing'])
    }
  })

  it('⛔ an intro video found over five minutes fails CLOSED — the poll says too_long; nothing uploaded, the raw kept for the GC', async () => {
    h.result = 'too_long'
    await post({ path: PATH, hevc: false, kind: 'teacher_intro' })
    await runAfter()
    expect(job()).toMatchObject({ state: 'failed', reason: 'too_long' })
    expect(await poll()).toEqual({ status: 200, body: { status: 'failed', reason: 'too_long' } })
    expect(h.uploads).toBe(0)
    expect(h.removes).toBe(0)
  })

  it('…and a re-submit of that finished job answers 422 video_too_long — while any other failure stays transcode_failed', async () => {
    h.result = 'too_long'
    await post({ path: PATH, hevc: false, kind: 'teacher_intro' })
    await runAfter()
    expect(await post({ path: PATH, hevc: false, kind: 'teacher_intro' })).toEqual({ status: 422, body: { error: 'video_too_long' } })
    h.store.clear(); h.result = null
    await post({ path: PATH, hevc: true })
    await runAfter()
    expect(await post({ path: PATH, hevc: true })).toEqual({ status: 422, body: { error: 'transcode_failed' } })
  })

  it('⛔ an intro video never runs synchronously: with the job store down it is told to try again — a listing\'s clip still runs', async () => {
    h.kvDown = true
    expect(await post({ path: PATH, hevc: false, kind: 'teacher_intro' })).toEqual({ status: 503, body: { error: 'retry' } })
    expect(h.transcodes).toEqual([])
    expect((await post({ path: PATH, hevc: false })).status).toBe(200)
    expect(h.transcodes).toEqual(['listing'])
  })

  it('⛔ an intro video\'s failed encode FAILS CLOSED, whatever its codec — never its raw; a listing\'s H.264 clip still falls open', async () => {
    h.result = null
    await post({ path: PATH, hevc: false, kind: 'teacher_intro' })
    await runAfter()
    expect(job()).toEqual({ state: 'failed' })
    expect(await poll()).toEqual({ status: 200, body: { status: 'failed' } })
    h.store.clear()
    await post({ path: PATH, hevc: false })
    await runAfter()
    expect(job()).toMatchObject({ state: 'done', url: `https://sb.eno.vn/storage/v1/object/public/listing-videos/${PATH}`, fallback: true })
  })

  it('a failed poll without a reason is what it always was', async () => {
    h.result = null
    await post({ path: PATH, hevc: true })
    await runAfter()
    expect(await poll()).toEqual({ status: 200, body: { status: 'failed' } })
  })
})

// Security review 2026-10-22, item 32d: the job deletes the raw upload when it succeeds, so only its uploader may start it.
describe('ownership of the raw upload', () => {
  it('⛔ someone else’s raw upload is refused with 403 — nothing is transcoded, uploaded or deleted', async () => {
    h.owner = 'someone-else'
    expect(await post({ path: PATH, hevc: false, kind: 'listing' })).toEqual({ status: 403, body: { error: 'forbidden' } })
    await runAfter()
    expect(h.transcodes).toEqual([])
    expect(h.uploads).toBe(0)
    expect(h.removes).toBe(0)
  })
  it('⛔ an upload with no recorded uploader (expired) is not adopted — 403', async () => {
    h.owner = null
    expect((await post({ path: PATH, hevc: false, kind: 'listing' })).status).toBe(403)
    expect(h.transcodes).toEqual([])
  })
})
