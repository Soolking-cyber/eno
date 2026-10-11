import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/teachers/me/draft — the wire of src/lib/teachers/draft.ts (owner, 2026-10-11): private, never cached, and every
// refusal its own status, so the form knows whether to reload a newer draft, stop (published or discarded) or wait.
const h = vi.hoisted(() => ({ revs: [] as unknown[], deleteResult: 'deleted' as 'deleted' | 'stale', result: { ok: true, rev: 2, gen: '11111111-2222-4333-8444-555555555555', updatedAt: new Date('2026-10-11T10:00:00Z') } as Record<string, unknown>, deleted: [] as string[], draft: null as unknown }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => ({ id: 'p1', email: 'a@example.com' }), getCurrentProfileId: async () => 'p1', getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
vi.mock('@/lib/teachers/draft', () => ({
  TEACHER_DRAFT_MAX_BYTES: 65_536,
  readTeacherDraft: async () => h.draft,
  saveTeacherDraft: async () => h.result,
  deleteTeacherDraft: async (id: string, at?: unknown) => { h.deleted.push(id); h.revs.push(at); return h.deleteResult },
  parseDraftGen: (v: unknown) => (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) ? v : null),
}))

const { GET, PUT, DELETE } = await import('./route')
const put = (body: unknown) => PUT(new Request('https://eno.vn/api/teachers/me/draft', { method: 'PUT', body: JSON.stringify(body) }) as never, {} as never)

beforeEach(() => { h.result = { ok: true, rev: 2, gen: '11111111-2222-4333-8444-555555555555', updatedAt: new Date('2026-10-11T10:00:00Z') }; h.deleted = []; h.draft = null; h.revs = []; h.deleteResult = 'deleted' })

describe('/api/teachers/me/draft', () => {
  it('GET: the draft or null — private, never cached', async () => {
    let res = await GET(new Request('https://eno.vn/api/teachers/me/draft') as never, {} as never)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ draft: null })
    h.draft = { t: { fullName: 'Jane' }, step: 'where', rev: 4, gen: '11111111-2222-4333-8444-555555555555', updatedAt: new Date('2026-10-11T09:00:00Z') }
    res = await GET(new Request('https://eno.vn/api/teachers/me/draft') as never, {} as never)
    expect(await res.json()).toEqual({ draft: { t: { fullName: 'Jane' }, step: 'where', rev: 4, gen: '11111111-2222-4333-8444-555555555555', updatedAt: '2026-10-11T09:00:00.000Z' } })
  })
  it('PUT: the new revision', async () => {
    const res = await put({ t: {}, step: 'where', rev: 1 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rev: 2, gen: '11111111-2222-4333-8444-555555555555', updatedAt: '2026-10-11T10:00:00.000Z' })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })
  it.each([
    ['stale', 409, 'draft_stale'], ['gone', 409, 'draft_gone'], ['teacher_exists', 409, 'teacher_exists'],
    ['too_large', 413, 'payload_too_large'], ['bad_request', 400, 'bad_request'],
  ])('PUT refused %s → %i %s', async (reason, status, error) => {
    h.result = { ok: false, reason }
    const res = await put({ t: {}, step: 'where', rev: 1 })
    expect(res.status).toBe(status)
    expect((await res.json()).error).toBe(error)
  })
  it('PUT: a body far past any answer set is refused before it is read', async () => {
    const res = await PUT(new Request('https://eno.vn/api/teachers/me/draft', { method: 'PUT', body: '{}', headers: { 'content-length': String(65_536 * 4 + 1) } }) as never, {} as never)
    expect(res.status).toBe(413)
  })
  it('⛔ PUT: a body over the cap with NO length label (chunked) is refused as it streams in — never parsed', async () => {
    const big = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"t":"' + 'x'.repeat(65_536 * 4) + '"}')); c.close() } })
    const res = await PUT(new Request('https://eno.vn/api/teachers/me/draft', { method: 'PUT', body: big, duplex: 'half' } as RequestInit) as never, {} as never)
    expect(res.status).toBe(413)
  })

  it('DELETE ?rev=2: Start over of the revision the tab saw', async () => {
    const res = await DELETE(new Request(`https://eno.vn/api/teachers/me/draft?rev=2&gen=${'11111111-2222-4333-8444-555555555555'}`, { method: 'DELETE' }) as never, {} as never)
    expect(res.status).toBe(200)
    expect(h.deleted).toEqual(['p1'])
    expect(h.revs).toEqual([{ rev: 2, gen: '11111111-2222-4333-8444-555555555555' }])
  })

  it.each([[''], ['?rev='], ['?rev=-1'], ['?rev=abc'], ['?rev=99999999999999999999'], ['?rev=2'], ['?rev=2&gen=yesterday'], ['?rev=2&gen=2026-10-10T08:00:00.000Z']])('⛔ DELETE%s: 400 — never the unconditional delete', async (q) => {
    const res = await DELETE(new Request(`https://eno.vn/api/teachers/me/draft${q}`, { method: 'DELETE' }) as never, {} as never)
    expect(res.status).toBe(400)
    expect(h.deleted).toEqual([])
  })
  it('DELETE ?rev=: the revision the tab saw — a newer one saved elsewhere is 409 draft_stale', async () => {
    h.deleteResult = 'stale'
    const res = await DELETE(new Request(`https://eno.vn/api/teachers/me/draft?rev=3&gen=${'11111111-2222-4333-8444-555555555555'}`, { method: 'DELETE' }) as never, {} as never)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('draft_stale')
    expect(h.revs).toEqual([{ rev: 3, gen: '11111111-2222-4333-8444-555555555555' }])
  })
})

