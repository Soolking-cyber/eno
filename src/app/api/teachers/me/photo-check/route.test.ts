import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/teachers/me/photo-check — the form's early answer (owner, 2026-10-16): only a photo stored on eno, the
// account's own limits first, "try again" (503) when the check cannot run, the reason when it fails — and a refusal
// recorded once for the admin queue.
const h = vi.hoisted(() => ({
  limits: [] as string[],
  deny: null as string | null,
  verdict: { ok: true } as unknown,
  unavailable: false,
  audits: [] as { action: string; subjectId: string; detail: Record<string, unknown> }[],
  claimed: new Set<string>(),
  budgets: [] as string[],
  owner: 'p1' as string | null,
  refusals: [] as Array<{ profileId: string; key: string; reason: string }>,
}))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.7' }))
// Who uploaded the photo (image-owner.ts) — this account, unless a test says otherwise.
vi.mock('@/lib/image-owner', () => ({ imageOwner: async () => h.owner }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => ({ id: 'p1', email: 'a@example.com', avatarUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/my-avatar.webp' }), getCurrentProfileId: async () => 'p1', getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (name: string) => { h.limits.push(name); return { success: h.deny !== name, resetSec: 0 } },
  kv: { set: async (k: string) => { if (h.claimed.has(k)) return null; h.claimed.add(k); return 'OK' } },
}))
vi.mock('@/lib/db', () => ({ db: { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $executeRaw: async () => 0 }) } }))
vi.mock('@/lib/compliance/audit', () => ({
  appendAudit: async (_tx: unknown, input: { action: string; subjectId: string; detail: Record<string, unknown> }) => { h.audits.push(input) },
}))
vi.mock('@/lib/log', () => ({ logWarn: () => {}, logError: () => {}, logInfo: () => {} }))
vi.mock('@/lib/teachers/photo-verdict', () => {
  class PhotoCheckUnavailable extends Error { why = 'model' }
  return {
    PhotoCheckUnavailable,
    teacherPhotoKey: (u: unknown) => (typeof u === 'string' && u.startsWith('https://sb.eno.vn/storage/v1/object/public/listings/') ? u.split('/').pop() : null),
    teacherPhotoVerdict: async (_p: string, _u: string, budget: string) => { h.budgets.push(budget); if (h.unavailable) throw new PhotoCheckUnavailable(); return h.verdict },
    recordPhotoRefusal: async (profileId: string, key: string, reason: string) => { h.refusals.push({ profileId, key, reason }) },
  }
})

const { POST } = await import('./route')
const URL_OK = 'https://sb.eno.vn/storage/v1/object/public/listings/1791898094623-rh7bov.webp'
const call = (body: unknown) => POST(new Request('https://eno.vn/api/teachers/me/photo-check', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://eno.vn' }, body: JSON.stringify(body) }) as never, {} as never)

beforeEach(() => { Object.assign(h, { limits: [], deny: null, verdict: { ok: true }, unavailable: false, audits: [], budgets: [], refusals: [], owner: 'p1' }); h.claimed.clear() })

describe('POST /api/teachers/me/photo-check', () => {
  it('a photo that passes: { checked, ok } — the account limits asked (hour, day), then the connection\'s; the early check\'s own budget', async () => {
    const res = await call({ url: URL_OK })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ checked: true, ok: true })
    expect(h.limits).toEqual(['teacher-photo-check', 'teacher-photo-check-day', 'teacher-photo-check-ip'])
    expect(h.budgets).toEqual(['check'])
  })
  it('a photo that fails: the reason — and the refusal recorded for the admin queue (the record "Photo is fine" needs)', async () => {
    h.verdict = { ok: false, reason: 'not_photo' }
    expect(await (await call({ url: URL_OK })).json()).toEqual({ checked: true, ok: false, reason: 'not_photo' })
    expect(h.refusals).toEqual([{ profileId: 'p1', key: '1791898094623-rh7bov.webp', reason: 'not_photo' }])
  })
  it('no Vertex client: { checked: false } — the form says nothing', async () => {
    h.verdict = 'off'
    expect(await (await call({ url: URL_OK })).json()).toEqual({ checked: false })
  })
  it('⛔ cannot tell → 503 photo_check_unavailable, never a reason', async () => {
    h.unavailable = true
    const res = await call({ url: URL_OK })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('photo_check_unavailable')
  })
  it('not a photo stored on eno → 400, before any limit is spent', async () => {
    const res = await call({ url: 'https://example.com/me.jpg' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('photo_check_invalid')
    expect(h.limits).toEqual([])
  })
  it('the hour used → 429 photo_check_rate, the day not spent', async () => {
    h.deny = 'teacher-photo-check'
    const res = await call({ url: URL_OK })
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('photo_check_rate')
    expect(h.limits).toEqual(['teacher-photo-check'])
  })
  it('⛔ only this account\'s own photo — one it uploaded, or its account photo — never any listing photo a caller names', async () => {
    h.owner = 'someone-else'
    let res = await call({ url: URL_OK })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('photo_check_invalid')
    expect(h.budgets).toEqual([])
    res = await call({ url: 'https://sb.eno.vn/storage/v1/object/public/listings/my-avatar.webp' })
    expect(res.status).toBe(200)
  })
})
