import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Reach's partner-inbox total (route.ts): off without the token, refused without the right one, never cached. */
vi.mock('@/lib/partner-inbox', () => ({ partnerInboxCounts: vi.fn(async () => ({ shops: [{ name: 'GoPlus' }], unreadChats: 3, unreadMessages: 7 })) }))
const { partnerInboxCounts } = await import('@/lib/partner-inbox')
const { GET } = await import('./route')

const TOKEN = 'x'.repeat(40)
const req = (auth?: string) => new Request('https://eno.vn/api/partner-inbox/counts', auth ? { headers: { authorization: auth } } : {})

beforeEach(() => { vi.mocked(partnerInboxCounts).mockClear(); vi.unstubAllEnvs() })
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/partner-inbox/counts', () => {
  it('is off (404) until PARTNER_INBOX_TOKEN is set — and a short token counts as unset', async () => {
    let r = await GET(req(`Bearer ${TOKEN}`))
    expect(r.status).toBe(404)
    vi.stubEnv('PARTNER_INBOX_TOKEN', 'short')
    r = await GET(req('Bearer short'))
    expect(r.status).toBe(404)
    expect(partnerInboxCounts).not.toHaveBeenCalled()
  })

  it('refuses a missing or wrong token before counting anything', async () => {
    vi.stubEnv('PARTNER_INBOX_TOKEN', TOKEN)
    for (const a of [undefined, 'Bearer', `Bearer ${TOKEN}x`, TOKEN.slice(1)]) {
      const r = await GET(req(a))
      expect(r.status, String(a)).toBe(401)
      expect(r.headers.get('cache-control')).toBe('private, no-store')
    }
    expect(partnerInboxCounts).not.toHaveBeenCalled()
  })

  it('with the token: the total and where to open it — no shop, no message — never cached', async () => {
    vi.stubEnv('PARTNER_INBOX_TOKEN', TOKEN)
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn/')
    const r = await GET(req(`Bearer ${TOKEN}`))
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(await r.json()).toEqual({ unreadChats: 3, adminUrl: 'https://eno.vn/admin/partner-inbox' })
  })
})
