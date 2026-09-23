import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The e-Visa thank-you email, end to end through the REAL pieces: the real renderer
 * (src/lib/emails/visa-result.ts), the real mail client (src/lib/mail.ts) and the real eno-mailer
 * Worker (infra/cloudflare/eno-mailer.js) behind a stubbed fetch. src/lib/visa/result.test.ts mocks
 * the mailer and the renderer to test the ROUTE; this file exists for the two properties that only
 * hold across all three:
 *
 *   1. VISA_RESULT_ATTACH_MAX_BYTES is a number the wire can carry. A PDF of exactly that size,
 *      rendered as the real email in either language, must leave as an ATTACHMENT under the
 *      Worker's 4.9 MiB request cap — not quietly degrade to a link. Raising the constant past what
 *      fits turns this red instead of shipping a ceiling nothing enforces.
 *   2. A corrected PDF for the same case, inside the Worker's 24 h idempotency window, is DELIVERED.
 *      With a per-case key the Worker answered the corrected send with the wrong visa's messageId.
 */

const APP_ID = '3f2a91bc-1111-4222-8333-444455556666'
const KEY_FORUM = 'forum-key-0123456789abcdef0123456789abcd'
const URL_SEND = 'https://eno-mailer.example.workers.dev/v1/send'

const h = vi.hoisted(() => ({ locale: 'en' as 'en' | 'vi' }))

vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    profile: { findUnique: async () => ({ locale: h.locale }) },
    conversation: { findUnique: async () => ({ id: 'convo-1', buyerProfileId: 'u1', sellerProfileId: 's1', listingId: null, visaApplicationId: APP_ID }) },
  },
}))
vi.mock('@/lib/messages', () => ({ insertMessage: async () => ({ id: 'm' }) }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async () => {} }))
vi.mock('@/lib/visa-admin', () => ({ VISA_BUCKET: 'visa-documents' }))
vi.mock('@/lib/visa-shop', () => ({ getVisaShopSeller: async () => null, VISA_SHOP_OWNER_EMAILS: [] as readonly string[] }))
vi.mock('@/lib/visa/crypto', () => ({
  visaCryptoReady: () => true,
  // The longest given name the renderer keeps (40 characters), in multi-byte Vietnamese, so the
  // body is as large as a real one can get.
  decryptVisaPayload: () => ({ email: 'applicant.person@example.com', givenNames: 'Nguyễn Thị Phương Thảo Ngọc Ánh Hồng Như Ý' }),
}))
vi.mock('@/lib/visa/db', () => ({ getVisaDb: () => ({}) }))
vi.mock('@/lib/visa/dm-thread', () => ({ visaConversationIdFor: async () => 'convo-1' }))
vi.mock('@/lib/visa/storage', () => ({ removeVisaFiles: async () => true }))

const worker = (await import('../../../infra/cloudflare/eno-mailer.js')).default
const { sendVisaResultThankYou, VISA_RESULT_ATTACH_MAX_BYTES } = await import('./result')
const { MAILER_MAX_REQUEST_BYTES } = await import('@/lib/mail')

let bodies: string[]
let sent: Array<Record<string, unknown> & { attachments?: Array<{ content: string }> }>
let waits: Promise<unknown>[]

beforeEach(() => {
  bodies = []
  sent = []
  waits = []
  h.locale = 'en'
  vi.stubEnv('MAILER_URL', URL_SEND)
  vi.stubEnv('MAILER_KEY', KEY_FORUM)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
  // One KV for the whole test, so the Worker's 24 h idempotency memory spans the sends in it.
  const store = new Map<string, string>()
  const env = {
    EMAIL_FORUM: { async send(m: Record<string, unknown>) { sent.push(m); return { messageId: `msg-${sent.length}` } } },
    EMAIL_VN: { async send() { throw new Error('the forum key must never reach the vn binding') } },
    MAILER_KV: { async get(k: string) { return store.get(k) ?? null }, async put(k: string, v: string) { store.set(k, v) } },
    MAILER_KEY_FORUM: KEY_FORUM,
    MAILER_KEY_VN: 'v'.repeat(40),
  }
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    bodies.push(String(init.body))
    const res = await worker.fetch(new Request(url, { method: 'POST', headers: init.headers as Record<string, string>, body: String(init.body) }), env, { waitUntil: (p: Promise<unknown>) => { waits.push(p) } }) as Response
    await Promise.all(waits)
    return res
  })
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const send = (pdf: Buffer) => sendVisaResultThankYou({ applicationId: APP_ID, userId: 'u1', encryptedPayload: 'envelope', reference: 'EV-1042', pdf })

describe('visa result email — the attachment ceiling is one the wire can carry', () => {
  it.each(['en', 'vi'] as const)('a PDF of exactly VISA_RESULT_ATTACH_MAX_BYTES goes out ATTACHED, under the Worker cap (%s)', async (locale) => {
    h.locale = locale
    const pdf = Buffer.alloc(VISA_RESULT_ATTACH_MAX_BYTES, 0x25)
    expect(await send(pdf)).toBe('sent')
    expect(bodies).toHaveLength(1)
    const bytes = Buffer.byteLength(bodies[0], 'utf8')
    expect(bytes).toBeLessThanOrEqual(MAILER_MAX_REQUEST_BYTES)
    // The Worker received it and passed the whole file on to Cloudflare.
    expect(sent).toHaveLength(1)
    expect(sent[0].attachments?.[0].content.length).toBe(Math.ceil(pdf.length / 3) * 4)
    // And the MIME message Cloudflare builds from it stays under its 5 MiB cap: base64 wrapped at
    // 76 columns (+2 bytes per line), the html and text parts, and generous room for headers.
    const payload = JSON.parse(bodies[0]) as { html: string; text: string }
    const b64 = sent[0].attachments![0].content.length
    const mime = Math.ceil(b64 / 76) * 78 + Buffer.byteLength(payload.html) * 1.1 + Buffer.byteLength(payload.text) * 1.1 + 8192
    expect(mime).toBeLessThan(5 * 1024 * 1024)
  })
})

describe('visa result email — a corrected PDF is never swallowed as a duplicate', () => {
  it('the wrong PDF, then the corrected one for the SAME case: both delivered, the second with the corrected file', async () => {
    const wrong = Buffer.from('%PDF-1.7\nthe wrong visa\n%%EOF\n', 'latin1')
    const corrected = Buffer.from('%PDF-1.7\nthe corrected visa\n%%EOF\n', 'latin1')
    expect(await send(wrong)).toBe('sent')
    expect(await send(corrected)).toBe('sent')
    expect(sent).toHaveLength(2)
    expect(sent[1].attachments?.[0].content).toBe(corrected.toString('base64'))
  })

  it('the SAME file sent twice is still deduplicated by the Worker (one delivery)', async () => {
    const pdf = Buffer.from('%PDF-1.7\nsame\n%%EOF\n', 'latin1')
    expect(await send(pdf)).toBe('sent')
    expect(await send(pdf)).toBe('sent')
    expect(sent).toHaveLength(1)
  })
})
