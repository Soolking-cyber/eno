import { beforeEach, describe, expect, it, vi } from 'vitest'

// listing-image.ts pins the bucket prefix to this env at load — set before anything imports it.
vi.hoisted(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.eno.vn' })

const h = vi.hoisted(() => ({
  client: {} as object | null,
  override: null as null | { id: bigint },
  overrideThrows: false,
  cache: new Map<string, unknown>(),
  kvThrows: false,
  budget: true,
  download: 'ok' as 'ok' | 'error',
  decodeThrows: false,
  check: { verdict: { ok: true }, model: 'gemini-3.5-flash-lite' } as unknown,
  checkThrows: false,
  checks: 0,
  sets: [] as Array<{ key: string; value: unknown; ex?: number }>,
  audits: [] as Array<Record<string, unknown>>,
  auditThrows: false,
  claims: new Set<string>(),
  dels: [] as string[],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/gemini', () => ({ getGeminiVertex: () => h.client }))
vi.mock('@/lib/log', () => ({ logError: () => {}, logWarn: () => {} }))
vi.mock('@/lib/db', () => ({ db: {
  complianceAudit: { findFirst: async () => { if (h.overrideThrows) throw new Error('db'); return h.override } },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => { if (h.auditThrows) throw new Error('lock timeout'); return fn({ $executeRaw: async () => 0 }) },
} }))
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async (_tx: unknown, input: Record<string, unknown>) => { h.audits.push(input) } }))
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    get: async (k: string) => { if (h.kvThrows) throw new Error('kv'); return h.cache.get(k) ?? null },
    set: async (key: string, value: unknown, o?: { ex?: number; nx?: boolean }) => {
      if (o?.nx) { if (h.claims.has(key)) return null; h.claims.add(key); return 'OK' }
      h.sets.push({ key, value, ex: o?.ex }); return 'OK'
    },
    del: async (key: string) => { h.dels.push(key); h.claims.delete(key) },
  },
  rateLimit: async () => ({ success: h.budget }),
}))
vi.mock('@/lib/supabase-admin', () => ({
  LISTINGS_BUCKET: 'listings',
  getSupabaseAdmin: () => ({ storage: { from: () => ({ download: async () => (h.download === 'ok' ? { data: new Blob([new Uint8Array([1, 2, 3])]), error: null } : { data: null, error: new Error('gone') }) }) } }),
}))
vi.mock('@/lib/teachers/photo-check', () => ({
  photoForCheck: async (b: Buffer) => { if (h.decodeThrows) throw new Error('decode'); return b },
  checkTeacherPhoto: async () => { h.checks++; if (h.checkThrows) throw new AggregateError([new Error('a'), new Error('b')]); return h.check },
}))

const URL_OK = 'https://sb.eno.vn/storage/v1/object/public/listings/1791898094623-rh7bov-h0000000929000801.webp'
const KEY = '1791898094623-rh7bov-h0000000929000801.webp'
const { teacherPhotoVerdict, teacherPhotoKey, PhotoCheckUnavailable, recordPhotoRefusal } = await import('./photo-verdict')
expect(teacherPhotoKey(URL_OK)).toBe(KEY)

beforeEach(() => {
  Object.assign(h, { client: {}, override: null, overrideThrows: false, kvThrows: false, budget: true, download: 'ok', decodeThrows: false, check: { verdict: { ok: true }, model: 'gemini-3.5-flash-lite' }, checkThrows: false, checks: 0, sets: [] })
  h.cache.clear(); h.claims.clear(); h.audits = []; h.dels = []; h.auditThrows = false
})

describe('teacherPhotoVerdict', () => {
  it('is "off" — and nothing else is read — when no Vertex client is configured', async () => {
    h.client = null
    await expect(teacherPhotoVerdict('p1', URL_OK, 'check')).resolves.toBe('off')
    expect(h.checks).toBe(0)
  })
  it('an admin\'s "this photo is fine" wins over a cached fail — no check', async () => {
    h.override = { id: BigInt(1) }
    h.cache.set(`teacher-photo:v1:${KEY}`, { ok: false, reason: 'no_face', model: 'm', at: 'x' })
    await expect(teacherPhotoVerdict('p1', URL_OK, 'check')).resolves.toEqual({ ok: true })
    expect(h.checks).toBe(0)
  })
  it('a cached verdict is the answer — the same photo is never sent twice', async () => {
    h.cache.set(`teacher-photo:v1:${KEY}`, { ok: false, reason: 'not_photo', model: 'm', at: 'x' })
    await expect(teacherPhotoVerdict('p1', URL_OK, 'check')).resolves.toEqual({ ok: false, reason: 'not_photo' })
    expect(h.checks).toBe(0)
  })
  it('no cache: the check runs and its verdict is cached for 180 days', async () => {
    h.check = { verdict: { ok: false, reason: 'no_face' }, model: 'gemini-3.8-flash' }
    await expect(teacherPhotoVerdict('p1', URL_OK, 'check')).resolves.toEqual({ ok: false, reason: 'no_face' })
    expect(h.checks).toBe(1)
    expect(h.sets).toEqual([{ key: `teacher-photo:v1:${KEY}`, value: expect.objectContaining({ ok: false, reason: 'no_face', model: 'gemini-3.8-flash' }), ex: 180 * 24 * 3600 }])
  })
  it('a kv that cannot be read is a cache miss — the check runs, never a guess', async () => {
    h.kvThrows = true
    await expect(teacherPhotoVerdict('p1', URL_OK, 'check')).resolves.toEqual({ ok: true })
    expect(h.checks).toBe(1)
  })
  it('⛔ every "cannot tell" is PhotoCheckUnavailable — never a reason', async () => {
    for (const set of [() => { h.overrideThrows = true }, () => { h.budget = false }, () => { h.download = 'error' }, () => { h.decodeThrows = true }, () => { h.checkThrows = true }]) {
      Object.assign(h, { overrideThrows: false, budget: true, download: 'ok', decodeThrows: false, checkThrows: false })
      set()
      await expect(teacherPhotoVerdict('p1', URL_OK, 'check')).rejects.toBeInstanceOf(PhotoCheckUnavailable)
    }
    expect(h.sets).toEqual([])
  })
  it('a URL that is not a photo stored on eno is refused as unavailable, never checked', async () => {
    await expect(teacherPhotoVerdict('p1', 'https://example.com/a.webp', 'check')).rejects.toBeInstanceOf(PhotoCheckUnavailable)
    expect(h.checks).toBe(0)
  })
})

describe('recordPhotoRefusal', () => {
  it('records a refusal once per account and photo', async () => {
    await recordPhotoRefusal('p1', KEY, 'no_face')
    await recordPhotoRefusal('p1', KEY, 'no_face')
    expect(h.audits).toEqual([expect.objectContaining({ action: 'teacher.photo.refused', subjectType: 'profile', subjectId: 'p1', detail: { key: KEY, reason: 'no_face' } })])
  })
  it('⛔ a write that fails releases its claim — the next refusal is recorded (never 30 days with nothing to approve)', async () => {
    h.auditThrows = true
    await recordPhotoRefusal('p1', KEY, 'not_photo')
    expect(h.dels).toEqual([`teacher-photo:refused-logged:p1:${KEY}`])
    h.auditThrows = false
    await recordPhotoRefusal('p1', KEY, 'not_photo')
    expect(h.audits).toHaveLength(1)
  })
})
