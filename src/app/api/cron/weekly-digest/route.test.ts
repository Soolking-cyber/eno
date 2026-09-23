import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE WEEKLY DIGEST CANNOT SEND THROUGH CLOUDFLARE EMAIL SENDING (2026-09-23).
 *
 * It is marketing, the provider is transactional-only, and its suppression list is shared with
 * sign-in: one complaint about a digest would block that address's sign-in links on both editions,
 * with no expiry. This runs the route with the REAL src/lib/mail.ts and a FULLY configured mailer —
 * the state production is in after the cutover — and proves it neither reads a recipient nor
 * makes a request.
 */

const h = vi.hoisted(() => ({ findMany: 0, fetches: 0 }))

vi.mock('@/lib/db', () => ({ db: { profile: { findMany: async () => { h.findMany++; return [{ id: 'p1', email: 'reader@gmail.com', displayName: 'R', unsubscribeToken: 't' }] } } } }))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => null, getCurrentProfile: async () => null, getCurrentProfileId: async () => null }))
vi.mock('@/lib/digest', () => ({ getDigestContent: async () => ({ top: [{ id: 'l1' }], sales: [] }) }))
vi.mock('@/lib/emails/weekly-digest', () => ({ renderWeeklyDigest: () => ({ subject: 's', html: '<p>h</p>', text: 't' }) }))

beforeEach(() => {
  h.findMany = 0
  h.fetches = 0
  vi.stubEnv('CRON_SECRET', 'sekret')
  vi.stubEnv('MAILER_URL', 'https://eno-mailer.example.workers.dev/v1/send')
  vi.stubEnv('MAILER_KEY', 'k'.repeat(64))
  vi.stubGlobal('fetch', async () => { h.fetches++; return new Response('{"ok":true,"messageId":"m"}') })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('weekly digest', () => {
  it('reports mail disabled and touches no recipient, with the mailer fully configured', async () => {
    const { GET } = await import('./route')
    const res = await GET(new Request('https://eno.vn/api/cron/weekly-digest', { headers: { authorization: 'Bearer sekret' } }), { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, mail: 'disabled' })
    expect(h.findMany).toBe(0)
    expect(h.fetches).toBe(0)
  })
})
