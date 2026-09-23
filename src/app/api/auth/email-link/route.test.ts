import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /api/auth/email-link — the delivery half, after the 2026-09-23 move to Cloudflare Email Sending.
 *
 * ⛔ THE PROPERTY: every delivery failure answers the SAME generic 502 `send_failed`, including
 * `suppressed`. A suppressed address has bounced or complained before; whether it has is not
 * something an anonymous caller gets to learn from this enumeration-hardened route. The distinction
 * lives only in the server log, where an admin can act on it (the dashboard's Suppressions page).
 * Also pinned: the mail goes out as class 'signin' — the reserved share of the daily quota, and no
 * Reply-To at the Worker.
 */

const h = vi.hoisted(() => ({
  mails: [] as Array<Record<string, unknown>>,
  result: { ok: true, messageId: 'm-1' } as { ok: true; messageId: string } | { ok: false; code: string },
}))

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    auth: {
      admin: {
        generateLink: async () => ({
          data: { properties: { hashed_token: 'hashed-abc', email_otp: '012345', verification_type: 'magiclink' } },
          error: null,
        }),
      },
    },
  }),
}))
vi.mock('@/lib/turnstile-verify', () => ({ verifyTurnstile: async () => true }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: true, remaining: 10 }),
  escalatingCooldown: async () => ({ allowed: true, retryAfterSec: 0 }),
}))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => null, getCurrentProfile: async () => null, getCurrentProfileId: async () => null }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/mail', () => ({
  sendMailDetailed: async (m: Record<string, unknown>) => { h.mails.push(m); return h.result },
}))

const { POST } = await import('./route')

const post = (body: Record<string, unknown>) =>
  POST(new Request('https://eno.forum/api/auth/email-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify({ captchaToken: 'tok', lang: 'en', ...body }),
  }), { params: Promise.resolve({}) } as never)

let warns: string[]
beforeEach(() => {
  h.mails = []
  h.result = { ok: true, messageId: 'm-1' }
  warns = []
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { warns.push(a.map(String).join(' ')) })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

describe('email-link → mailer', () => {
  it('sends the link as class signin and answers 200', async () => {
    const res = await post({ email: 'Alice.Example@gmail.com' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(h.mails).toHaveLength(1)
    expect(h.mails[0]).toMatchObject({ to: 'alice.example@gmail.com', class: 'signin', tag: 'signin-link' })
    expect(String(h.mails[0].html)).toContain('token_hash=hashed-abc')
  })

  it('code mode is tagged signin-code and carries the code, not the link', async () => {
    await post({ email: 'alice.example@gmail.com', deliver: 'code' })
    expect(h.mails[0]).toMatchObject({ class: 'signin', tag: 'signin-code' })
    expect(String(h.mails[0].text)).toContain('012345')
    expect(String(h.mails[0].html)).not.toContain('hashed-abc')
  })

  it('⛔ a SUPPRESSED address gets exactly the generic send_failed every other failure gets', async () => {
    const answers: Array<{ status: number; body: unknown }> = []
    for (const code of ['suppressed', 'unavailable', 'daily_limit', 'budget', 'disabled']) {
      h.result = { ok: false, code }
      const res = await post({ email: 'alice.example@gmail.com' })
      answers.push({ status: res.status, body: await res.json() })
    }
    for (const a of answers) expect(a).toEqual({ status: 502, body: { error: 'send_failed' } })
  })

  it('logs the suppression server-side for an admin, without the address', async () => {
    h.result = { ok: false, code: 'suppressed' }
    await post({ email: 'alice.example@gmail.com' })
    const line = warns.find((w) => w.includes('suppression list'))
    expect(line).toBeTruthy()
    // The DASHBOARD is the way out (no token); the API script is only a laptop fallback, because the
    // token it needs can send mail as either domain.
    expect(line).toContain('Email Service → Sending → Suppressions')
    expect(line).not.toContain('scripts/email-suppression.mjs')
    expect(warns.join('\n')).not.toContain('alice.example@gmail.com')
  })

  it('logs no suppression hint for an ordinary outage', async () => {
    h.result = { ok: false, code: 'unavailable' }
    await post({ email: 'alice.example@gmail.com' })
    expect(warns.some((w) => w.includes('suppression list'))).toBe(false)
  })
})
