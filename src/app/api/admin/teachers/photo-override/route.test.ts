import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/admin/teachers/photo-override — "Photo is fine" (2026-10-16): the human route against a wrong refusal.
// Admin only; only for a photo this account was refused or asked about; a durable audit row FOR THIS ACCOUNT — never the
// shared verdict cache.
const h = vi.hoisted(() => ({
  admin: 'mod@eno.vn' as string | null,
  seen: true,
  audits: [] as Array<Record<string, unknown>>,
  where: null as unknown,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => h.admin, getCurrentProfile: async () => null, getCurrentProfileId: async () => null, isAdminEmail: () => true }))
vi.mock('@/lib/db', () => ({
  db: {
    complianceAudit: { findFirst: async ({ where }: { where: unknown }) => { h.where = where; return h.seen ? { id: 1 } : null } },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  },
}))
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async (_tx: unknown, input: Record<string, unknown>) => { h.audits.push(input) } }))

const { POST } = await import('./route')
const PROFILE = '11111111-2222-4333-8444-555555555555'
const call = (body: unknown) => POST(new Request('https://eno.vn/api/admin/teachers/photo-override', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://eno.vn' }, body: JSON.stringify(body) }) as never, {} as never)

beforeEach(() => { Object.assign(h, { admin: 'mod@eno.vn', seen: true, audits: [], where: null }) })

describe('POST /api/admin/teachers/photo-override', () => {
  it('writes the durable override for THIS account, actor the admin', async () => {
    const res = await call({ profileId: PROFILE, key: '1791898094623-rh7bov.webp' })
    expect(res.status).toBe(200)
    expect(h.audits).toEqual([expect.objectContaining({ actorType: 'admin', actorId: 'mod@eno.vn', action: 'teacher.photo.override', subjectType: 'profile', subjectId: PROFILE, detail: { key: '1791898094623-rh7bov.webp' } })])
  })
  it('⛔ only a photo this account was refused or asked about — 404 otherwise, nothing written', async () => {
    h.seen = false
    const res = await call({ profileId: PROFILE, key: '1791898094623-rh7bov.webp' })
    expect(res.status).toBe(404)
    expect(h.audits).toEqual([])
    expect(JSON.stringify(h.where)).toContain('teacher.photo.refused')
  })
  it('⛔ not an admin → 403; a malformed id or key → 400', async () => {
    h.admin = null
    expect((await call({ profileId: PROFILE, key: 'a.webp' })).status).toBe(403)
    h.admin = 'mod@eno.vn'
    expect((await call({ profileId: 'not-a-uuid', key: 'a.webp' })).status).toBe(400)
    expect((await call({ profileId: PROFILE, key: '../etc/passwd' })).status).toBe(400)
    expect(h.audits).toEqual([])
  })
})
