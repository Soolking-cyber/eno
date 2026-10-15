import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The mailcow SMTP FALLBACK behind Resend. It is scoped to sendMail ONLY — the interactive,
// low-volume path (sign-in, visa, KYC, payout). The bulk paths (sendMailBatch digest, sendMailOnce
// teacher crons) deliberately do NOT fall over, so they are unchanged and not exercised here. Both
// transports are mocked; no test touches the network.
//
// ⚠️ The vitest env runs as the SERVICES edition (vitest.config → NEXT_PUBLIC_ENO_EDITION=services,
// SITE_NAME='eno.forum'), so the fallback mailbox must be on eno.forum to satisfy the licensing guard
// (From must be on this edition's own domain). That also lets us prove the guard.
const rs = vi.hoisted(() => ({ answer: null as unknown, throws: false }))
const nm = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>>, fail: null as null | { code?: string; command?: string; responseCode?: number } }))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: async () => { if (rs.throws) throw new Error('socket hang up'); return rs.answer } }
    batch = { send: async () => ({ data: null, error: null }) }
  },
}))

vi.mock('nodemailer', () => {
  const createTransport = () => ({
    on: () => {}, // pooled transport is an EventEmitter; mail.ts attaches an 'error' listener
    sendMail: async (payload: Record<string, unknown>) => {
      if (nm.fail) throw Object.assign(new Error('smtp failed'), nm.fail)
      nm.sent.push(payload)
      return { messageId: 'smtp-1' }
    },
  })
  return { createTransport, default: { createTransport } }
})

process.env.RESEND_API_KEY = 're_test'
process.env.MAIL_SMTP_HOST = 'mx.eno.forum' // host, user AND From must all be on the test edition's domain (eno.forum)
process.env.MAIL_SMTP_USER = 'no-reply@eno.forum'
process.env.MAIL_SMTP_PASS = 'pw'
process.env.MAIL_SMTP_PORT = '465'
const { sendMail } = await import('./mail')

const msg = { to: 'u@example.com', subject: 's', html: '<p>h</p>', text: 't' }
const ok = { data: { id: 'email_1' }, error: null, headers: {} }
const fail = (name: string, statusCode: number | null) => ({ data: null, error: { name, statusCode, message: 'm' }, headers: {} })

let errors: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  nm.sent = []; nm.fail = null
  rs.answer = ok; rs.throws = false
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { errors.mockRestore(); vi.restoreAllMocks() })

describe('sendMail — Resend primary, SMTP fallback', () => {
  it('resend ok → no SMTP', async () => {
    expect(await sendMail(msg)).toBe(true)
    expect(nm.sent).toHaveLength(0)
  })

  it.each([
    ['daily_quota_exceeded', 429], ['monthly_quota_exceeded', 429], ['rate_limit_exceeded', 429],
    ['application_error', 500], ['internal_server_error', 503], ['invalid_api_key', 401],
  ] as const)('resend %s → falls over to SMTP and returns true', async (name, status) => {
    rs.answer = fail(name, status)
    expect(await sendMail(msg)).toBe(true)
    expect(nm.sent).toHaveLength(1)
    expect(nm.sent[0]).toMatchObject({ to: 'u@example.com', from: 'no-reply@eno.forum' })
  })

  it('resend throws (network) → falls over to SMTP', async () => {
    rs.throws = true
    expect(await sendMail(msg)).toBe(true)
    expect(nm.sent).toHaveLength(1)
  })

  it('resend validation error → NO failover (SMTP cannot fix a bad message), returns false', async () => {
    rs.answer = fail('validation_error', 422)
    expect(await sendMail(msg)).toBe(false)
    expect(nm.sent).toHaveLength(0)
  })

  it('both transports down → false', async () => {
    rs.answer = fail('daily_quota_exceeded', 429); nm.fail = { command: 'CONN', code: 'ECONNECTION' }
    expect(await sendMail(msg)).toBe(false)
  })

  it('fromName becomes the display; address stays the authenticated mailbox', async () => {
    rs.answer = fail('daily_quota_exceeded', 429)
    await sendMail({ ...msg, fromName: 'VietKite Visa' })
    expect(nm.sent[0].from).toBe('"VietKite Visa" <no-reply@eno.forum>')
  })

  it('base64 attachment is decoded to a Buffer for nodemailer', async () => {
    rs.answer = fail('daily_quota_exceeded', 429)
    await sendMail({ ...msg, attachments: [{ filename: 'EV-1042-evisa.pdf', content: Buffer.from('hi').toString('base64'), contentType: 'application/pdf' }] })
    const att = (nm.sent[0].attachments as Array<{ filename: string; content: Buffer }>)[0]
    expect(Buffer.isBuffer(att.content)).toBe(true)
    expect(att.content.toString()).toBe('hi')
    expect(att.filename).toBe('EV-1042-evisa.pdf')
  })

  it('⛔ cross-edition From (eno.vn sender on the services edition) DISABLES smtp — licensing guard', async () => {
    vi.resetModules()
    process.env.MAIL_SMTP_FROM = 'no-reply@eno.vn' // the leak attempt: eno.vn sender on the forum edition
    try {
      const m = await import('./mail')
      rs.answer = fail('daily_quota_exceeded', 429)
      expect(await m.sendMail(msg)).toBe(false) // no failover across the licensing boundary
      expect(nm.sent).toHaveLength(0)
    } finally {
      delete process.env.MAIL_SMTP_FROM
      vi.resetModules()
    }
  })

  it('⛔ cross-edition USER (eno.vn auth account on the services edition) DISABLES smtp — licensing guard', async () => {
    vi.resetModules()
    process.env.MAIL_SMTP_USER = 'no-reply@eno.vn' // eno.vn relaying account on the forum edition
    try {
      const m = await import('./mail')
      rs.answer = fail('daily_quota_exceeded', 429)
      expect(await m.sendMail(msg)).toBe(false) // guard checks the authenticated account too, not just From
      expect(nm.sent).toHaveLength(0)
    } finally {
      process.env.MAIL_SMTP_USER = 'no-reply@eno.forum'
      vi.resetModules()
    }
  })

  it('⛔ cross-edition HOST (eno.vn MTA on the services edition) DISABLES smtp — forum mail never relays via eno.vn', async () => {
    vi.resetModules()
    process.env.MAIL_SMTP_HOST = 'mx.eno.vn' // relaying forum mail through eno.vn's mail server
    try {
      const m = await import('./mail')
      rs.answer = fail('daily_quota_exceeded', 429)
      expect(await m.sendMail(msg)).toBe(false) // guard checks the relay host too
      expect(nm.sent).toHaveLength(0)
    } finally {
      process.env.MAIL_SMTP_HOST = 'mx.eno.forum'
      vi.resetModules()
    }
  })
})

describe('SMTP-only mode (no Resend key)', () => {
  afterEach(() => { process.env.RESEND_API_KEY = 're_test'; vi.resetModules() })

  it('sendMail still sends via SMTP when Resend is unconfigured', async () => {
    vi.resetModules()
    delete process.env.RESEND_API_KEY
    const m = await import('./mail')
    expect(m.mailEnabled()).toBe(false) // mailEnabled gates the bulk crons on Resend, so they pause…
    expect(await m.sendMail(msg)).toBe(true) // …but interactive sendMail still goes out over SMTP
    expect(nm.sent).toHaveLength(1)
  })
})
