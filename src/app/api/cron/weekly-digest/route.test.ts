import { describe, expect, it, vi } from 'vitest'

// ⛔ /api/cron/weekly-digest is a NO-OP since 2026-11-19 (the digest moved to /api/cron/digest-daily). It must never send:
// the old Thursday timer may still call it, and the path's whole point is that nothing here can mail the list.
const sendMailBatch = vi.fn()
const sendMail = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/mail', () => ({ sendMailBatch, sendMail, mailEnabled: () => true }))

const { GET } = await import('./route')

describe('GET /api/cron/weekly-digest (moved)', () => {
  it('answers that it moved and sends nothing', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    const res = await GET(new Request('https://eno.vn/api/cron/weekly-digest', { headers: { authorization: 'Bearer cron-secret' } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, skipped: 'moved', to: '/api/cron/digest-daily' })
    expect(sendMailBatch).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('still refuses without the cron bearer', async () => {
    expect((await GET(new Request('https://eno.vn/api/cron/weekly-digest'))).status).toBe(401)
  })
})
