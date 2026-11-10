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

describe('PUT /api/admin/calls — the byte cap (appsec-02): 1 MB', () => {
  // 500 addresses of 254 characters — the schema's largest cohort, ~128 KB, twice the 64 KB default.
  const cohort = Array.from({ length: 500 }, (_, i) => `${String(i).padStart(3, '0')}${'a'.repeat(243)}@x.co.vn`)

  it('the schema\'s largest cohort fits four times under the cap and is read, validated and written', async () => {
    expect(cohort[0]).toHaveLength(254)
    expect(Buffer.byteLength(JSON.stringify({ mode: 'beta', cohortEmails: cohort })) * 4).toBeLessThanOrEqual(1024 * 1024)
    const r = await put({ mode: 'beta', cohortEmails: cohort })
    expect(r.status).toBe(200)
    expect(h.sql[0]).toContain('cohort = EXCLUDED.cohort')
  })

  it('one byte past 1 MB is 413 payload_too_large and writes nothing', async () => {
    const shell = JSON.stringify({ mode: 'off', pad: '' })
    const r = await PUT(new Request('https://eno.vn/api/admin/calls', { method: 'PUT', body: JSON.stringify({ mode: 'off', pad: 'a'.repeat(1024 * 1024 + 1 - shell.length) }) }))
    expect(r.status).toBe(413)
    expect(await r.json()).toEqual({ error: 'payload_too_large' })
    expect(h.sql).toEqual([])
    expect(h.killed).toBe(0)
  })
})
