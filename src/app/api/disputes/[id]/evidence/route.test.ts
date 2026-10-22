import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Security review 2026-10-22, item 11: dispute evidence is never deleted and shares the server's disk with Postgres,
 * so a party must not be able to store evidence without bound. These pin the durable per-party, per-case cap (3 ×
 * DISPUTE_IMAGES_MAX), the give-back of slots a rejected or failed file did not use, and the early 413.
 */

const h = vi.hoisted(() => ({
  counters: new Map<string, number>(),
  stored: [] as string[],
  storeOk: true,
  tombstones: [] as Array<{ refs: Array<{ bucket: string; path: string }>; reason: string; clock: Date }>,
  windowCloses: new Date(Date.now() + 3600_000),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: async () => 'party-1',
  getCurrentProfile: async () => null,
  getAdmin: async () => null,
}))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: true, remaining: 9 }),
  kv: {
    incrby: async (key: string, by: number) => {
      const v = (h.counters.get(key) ?? 0) + by
      h.counters.set(key, v)
      return v
    },
  },
}))
vi.mock('@/lib/dispute', () => ({
  DISPUTE_IMAGES_MAX: 6,
  loadDisputeForParty: async () => ({ report: { id: 'case-1', status: 'open', evidenceUntil: h.windowCloses } }),
  partyCanPost: () => true,
  partyHasSubmitted: async () => false,
  signEvidenceUrls: async (paths: string[]) => paths.map((p) => `https://signed/${p}`),
}))
vi.mock('@/lib/core/media', () => ({
  IMG_ALLOWED: new Set(['image/jpeg']),
  IMG_MAX_BYTES: 12 * 1024 * 1024,
  storeEvidenceImage: async () => {
    if (!h.storeOk) return null
    const p = `disputes/case-1/${h.stored.length}.webp`
    h.stored.push(p)
    return p
  },
}))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/core/storage-tombstones', () => ({
  writeTombstones: async (_tx: unknown, refs: Array<{ bucket: string; path: string }>, reason: string, clock: Date) => { h.tombstones.push({ refs, reason, clock }); return refs.length },
}))

const { POST } = await import('./route')

const KEY = 'dispute-evid:case-1:party-1'
const jpeg = (n: number) => Array.from({ length: n }, (_, i) => new File([new Uint8Array([0xff, 0xd8, i])], `e${i}.jpg`, { type: 'image/jpeg' }))
function upload(files: File[]) {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  return POST(new Request('https://eno.vn/api/disputes/case-1/evidence', { method: 'POST', body: form }), { params: Promise.resolve({ id: 'case-1' }) })
}

beforeEach(() => {
  h.counters.clear()
  h.stored = []
  h.storeOk = true
})

describe('dispute evidence — the durable per-party cap (item 11)', () => {
  it('stores one statement’s worth and counts it', async () => {
    const r = await upload(jpeg(6))
    expect(r.status).toBe(200)
    expect((await r.json()).paths).toHaveLength(6)
    expect(h.counters.get(KEY)).toBe(6)
  })

  it('refuses once the case cap (18) is reached — and does not consume the refused slots', async () => {
    for (let i = 0; i < 3; i++) expect((await upload(jpeg(6))).status).toBe(200)
    expect(h.counters.get(KEY)).toBe(18)
    const r = await upload(jpeg(6))
    expect(r.status).toBe(429)
    expect((await r.json()).error).toBe('limit_reached')
    expect(h.counters.get(KEY)).toBe(18)
    expect(h.stored).toHaveLength(18)
  })

  it('stores only what fits under the cap and reports the rest as failed', async () => {
    h.counters.set(KEY, 15)
    const r = await upload(jpeg(6))
    const body = await r.json()
    expect(body.paths).toHaveLength(3)
    expect(body.failed).toBe(3)
    expect(h.counters.get(KEY)).toBe(18)
  })

  it('a rejected file gives its slot back (only stored images count)', async () => {
    const bad = [new File([new Uint8Array([1, 2, 3])], 'x.gif', { type: 'image/gif' })]
    const r = await upload(bad)
    expect((await r.json()).failed).toBe(1)
    expect(h.counters.get(KEY)).toBe(0)
  })

  it('a storage failure gives its slot back', async () => {
    h.storeOk = false
    await upload(jpeg(2))
    expect(h.counters.get(KEY)).toBe(0)
  })

  it('an oversized declared body is refused with 413 before it is parsed', async () => {
    const r = await POST(
      new Request('https://eno.vn/api/disputes/case-1/evidence', {
        method: 'POST',
        body: 'x',
        headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(500 * 1024 * 1024) },
      }),
      { params: Promise.resolve({ id: 'case-1' }) },
    )
    expect(r.status).toBe(413)
    expect(h.counters.size).toBe(0)
  })
})

describe('an upload nobody attaches is swept (security review 2026-10-22, item 11)', () => {
  it('every stored image is tombstoned, its grace starting when the evidence window closes', async () => {
    h.tombstones = []
    const res = await upload(jpeg(2))
    expect(res.status).toBe(200)
    expect(h.tombstones).toHaveLength(1)
    expect(h.tombstones[0].reason).toBe('evidence_upload_pending')
    expect(h.tombstones[0].refs.map((r) => r.bucket)).toEqual(['evidence', 'evidence'])
    expect(h.tombstones[0].refs.map((r) => r.path)).toEqual((await res.json()).paths)
    expect(h.tombstones[0].clock).toBe(h.windowCloses)
  })

  it('nothing stored, nothing tombstoned', async () => {
    h.tombstones = []
    h.storeOk = false
    await upload(jpeg(1))
    expect(h.tombstones).toEqual([])
  })
})
