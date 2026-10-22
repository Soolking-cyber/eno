import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/auth/email-link — the emailed code's LENGTH travels with the answer (security review 2026-10-22, item 2), so
// GoTrue's MAILER_OTP_LENGTH can move (6 → 8) without an app release in lockstep. Pinned: the 200 carries `codeLength`
// = the length GoTrue just minted; an outcome that minted nothing answers the SAME shape with the last length seen (6
// before any mint) — the field's presence and value say nothing about the address (the route's ENUMERATION rule).

type Gen = { data: { properties?: Record<string, string> } | null; error: { message: string } | null }
const h = vi.hoisted(() => ({ gen: null as unknown as Gen, mailOk: true }))

vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => ({ auth: { admin: { generateLink: async () => h.gen } } }) }))
vi.mock('@/lib/turnstile-verify', () => ({ verifyTurnstile: async () => true }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }), escalatingCooldown: async () => ({ allowed: true }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.5' }))
vi.mock('@/lib/mail', () => ({ sendMail: async () => h.mailOk }))
vi.mock('@/lib/emails/sign-in-code', () => ({ renderSignInCodeEmail: () => ({ subject: 's', html: 'h', text: 't' }) }))
vi.mock('@/lib/emails/sign-in-link', () => ({ renderSignInEmail: () => ({ subject: 's', html: 'h', text: 't' }) }))

const minted = (code: string): Gen => ({ data: { properties: { email_otp: code, hashed_token: 'hash', verification_type: 'magiclink' } }, error: null })
const failed: Gen = { data: null, error: { message: 'boom' } }

async function freshPost() {
  vi.resetModules()
  return (await import('./route')).POST
}
async function send(POST: Awaited<ReturnType<typeof freshPost>>, deliver: 'code' | 'link' = 'code') {
  const res = await POST(new Request('https://eno.vn/api/auth/email-link', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'lan@example.com', captchaToken: 't', deliver }),
  }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => { h.mailOk = true })

describe('email-link — codeLength', () => {
  it('reports the length GoTrue minted: 8 after the box moves to 8, leading zeros and all', async () => {
    const POST = await freshPost()
    h.gen = minted('00730251')
    expect(await send(POST)).toEqual({ status: 200, body: { ok: true, codeLength: 8 } })
  })

  it('today\'s 6-digit code reports 6', async () => {
    const POST = await freshPost()
    h.gen = minted('123456')
    expect(await send(POST)).toEqual({ status: 200, body: { ok: true, codeLength: 6 } })
  })

  it('an outcome that minted nothing answers the SAME shape, with the last length seen — no enumeration signal', async () => {
    const POST = await freshPost()
    h.gen = failed
    expect(await send(POST), 'before any mint: the default').toEqual({ status: 200, body: { ok: true, codeLength: 6 } })
    h.gen = minted('12345678')
    await send(POST)
    h.gen = failed
    expect(await send(POST), 'after an 8-digit mint').toEqual({ status: 200, body: { ok: true, codeLength: 8 } })
  })

  it('a link send carries it too (one shape for every 200)', async () => {
    const POST = await freshPost()
    h.gen = minted('12345678')
    expect(await send(POST, 'link')).toEqual({ status: 200, body: { ok: true, codeLength: 8 } })
  })

  it('a failed delivery is still the 502 the form reports', async () => {
    const POST = await freshPost()
    h.gen = minted('123456')
    h.mailOk = false
    expect(await send(POST)).toEqual({ status: 502, body: { error: 'send_failed' } })
  })
})
