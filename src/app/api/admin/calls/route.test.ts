import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── PUT /api/admin/calls — the runtime switch, from an admin session ────────────────────────────────────────────────
// 'off' always works and ends every live call — even while the switch row cannot be read (round-9 review); nothing
// but 'off' is allowed without a running sweep; 'all' stays shut until KYC records a birth year.

const h = vi.hoisted(() => ({
  readOk: true,
  swept: true,
  sql: [] as string[],
  killed: 0,
}))
vi.mock('server-only', () => ({}))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: () => {} }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => 'admin@eno.vn' }))
vi.mock('@/lib/db', () => ({
  db: {
    $executeRaw: (strings: TemplateStringsArray) => { h.sql.push(strings.join('?').replace(/\s+/g, ' ').trim()); return Promise.resolve(1) },
    $queryRaw: async () => [],
    profile: { findMany: async () => [] },
  },
}))
vi.mock('@/lib/calls/server/config', () => ({
  MODE_ALL_OPEN: false,
  readCallsConfig: async () => ({ mode: 'off', cohort: new Set<string>(), video: true, relay: 'cloudflare', readOk: h.readOk }),
  resetCallsConfigCache: () => {},
}))
vi.mock('@/lib/calls/server/relay', () => ({ relayConfigured: () => false }))
vi.mock('@/lib/calls/server/session', () => ({
  sweepIsFresh: async () => h.swept,
  sweepStale: async ({ killAll }: { killAll?: boolean }) => { if (killAll) h.killed++; return [] },
}))
vi.mock('@/lib/calls/server/finish', () => ({ afterCallEnded: async () => {} }))

const { PUT } = await import('./route')
const put = (body: Record<string, unknown>) => PUT(new Request('https://eno.vn/api/admin/calls', { method: 'PUT', body: JSON.stringify(body) }))

beforeEach(() => { h.readOk = true; h.swept = true; h.sql = []; h.killed = 0 })

describe('PUT /api/admin/calls', () => {
  it('⛔ "off" works even while the switch cannot be read — it writes only the mode, and ends every live call', async () => {
    h.readOk = false; h.swept = false
    const r = await put({ mode: 'off' })
    expect(r.status).toBe(200)
    expect(h.sql).toHaveLength(1)
    expect(h.sql[0]).toContain("SET mode = 'off'")
    expect(h.sql[0]).not.toContain('cohort')
    expect(h.killed).toBe(1)
  })

  it('anything but "off" needs a running sweep (503 not_configured)', async () => {
    h.swept = false
    const r = await put({ mode: 'staff' })
    expect(r.status).toBe(503)
    expect(h.sql).toEqual([])
  })

  it('⛔ "all" stays shut until KYC records a birth year', async () => {
    expect((await put({ mode: 'all' })).status).toBe(400)
    expect(h.sql).toEqual([])
  })

  it('turning calls on writes the whole switch — and refuses to when the row cannot be read', async () => {
    expect((await put({ mode: 'beta' })).status).toBe(200)
    expect(h.sql[0]).toContain('cohort = EXCLUDED.cohort')
    h.sql = []; h.readOk = false
    expect((await put({ mode: 'beta' })).status).toBe(503)
    expect(h.sql).toEqual([])
  })
})
