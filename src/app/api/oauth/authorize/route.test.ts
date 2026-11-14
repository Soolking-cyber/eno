import { beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'

/**
 * The consent POST (route.ts) and the discovery around it. Pinned: a form from another origin never reaches the grant;
 * the ticket must belong to the person the auth server confirms; Cancel goes back as access_denied with `iss`; Allow
 * creates a PENDING grant and sends a code to the proven return address; the protected-resource document answers the
 * MCP server's own resource for the path its challenge names.
 */

process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-for-oauth-grant'

const h = vi.hoisted(() => ({ user: 'p1' as string | null, created: 0, shop: { id: 'shop1', name: 'My shop' } as { id: string; name: string } | null, kv: new Map<string, unknown>(), dbDown: false, accountType: 'business' }))
vi.mock('@/lib/db', () => ({
  db: {
    apiKey: { create: async () => { if (h.dbDown) throw new Error('db down'); h.created++; return { id: 'c' + h.created } }, deleteMany: async () => ({ count: 0 }) },
    seller: { findUnique: async () => h.shop },
    profile: { findUnique: async () => ({ accountType: h.accountType, enforcementState: 'good_standing' }) },
  },
}))
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    get: async (k: string) => h.kv.get(k) ?? null,
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => { if (o?.nx && h.kv.has(k)) return null; h.kv.set(k, v); return 'OK' },
    del: async (k: string) => { h.kv.delete(k) },
  },
  rateLimit: async () => ({ success: true, remaining: 9, limit: 10, resetSec: 60, windowSec: 60 }),
}))
const CLIENT = 'https://app.example.com/oauth/client.json'
const REDIRECT = 'https://app.example.com/callback'
vi.mock('@/lib/ssrf', () => ({
  safeFetch: async () => new Response(JSON.stringify({ client_id: CLIENT, client_name: 'Example App', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' })),
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: h.user ? { id: h.user } : null } }) } }) }))

const G = await import('@/lib/api/oauth-grant')
const { OAUTH_ISSUER } = await import('@/lib/api/oauth')
const { POST } = await import('./route')

const challenge = crypto.createHash('sha256').update('v'.repeat(50)).digest('base64url')
const now = () => Math.floor(Date.now() / 1000)
async function ticket(pid = 'p1') {
  const c = await G.checkAuthRequest(new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'st' }))
  if (!c.ok) throw new Error('refused')
  return G.issueConsentTicket(c.req, pid, ['shop1'], now())!
}
/** The answer page's forward address (route.ts sends a meta refresh, not a 303 — CSP form-action). */
async function forward(res: Response): Promise<URL> {
  expect(res.status).toBe(200)
  const m = /http-equiv="refresh" content="0;url=([^"]+)"/.exec(await res.text())
  return new URL(m![1].replace(/&amp;/g, '&'))
}
const post = (fields: Record<string, string>, origin: string | null = new URL(OAUTH_ISSUER).origin) => {
  const body = new URLSearchParams(fields)
  return POST(new Request(`${OAUTH_ISSUER}/api/oauth/authorize`, {
    method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}) },
  }))
}

beforeEach(() => { h.user = 'p1'; h.created = 0; h.shop = { id: 'shop1', name: 'My shop' }; h.kv.clear(); h.dbDown = false; h.accountType = 'business' })

describe('POST /api/oauth/authorize', () => {
  it('a forward address is HTML-escaped: a state with markup cannot break out of the page', async () => {
    const c = await G.checkAuthRequest(new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: '"><script>x</script>' }))
    if (!c.ok) throw new Error('refused')
    const t = G.issueConsentTicket(c.req, 'p1', ['shop1'], now())!
    const html = await (await post({ deny: t })).text()
    expect(html).not.toContain('<script>')
  })

  it('a form from another origin, or with no Origin, never reaches the grant', async () => {
    const t = await ticket()
    expect((await post({ allow: t }, 'https://evil.example')).status).toBe(403)
    expect((await post({ allow: t }, null)).status).toBe(403)
    expect(h.created).toBe(0)
  })

  it('the ticket must belong to the person the auth server confirms right now', async () => {
    const t = await ticket('p2')
    expect((await post({ allow: t })).status).toBe(403)
    h.user = null
    expect((await post({ allow: await ticket() })).status).toBe(401)
    expect(h.created).toBe(0)
  })

  it('Allow: a pending grant and a code to the proven return address, with state and iss', async () => {
    const res = await post({ allow: await ticket() })
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    const to = await forward(res)
    expect(to.origin + to.pathname).toBe(REDIRECT)
    expect(to.searchParams.get('code')).toBeTruthy()
    expect(to.searchParams.get('state')).toBe('st')
    expect(to.searchParams.get('iss')).toBe(OAUTH_ISSUER)
    expect(h.created).toBe(1)
  })

  it('one consent says Allow once: a double-click makes no second grant and shows the SAME answer', async () => {
    const t = await ticket()
    const first = await forward(await post({ allow: t }))
    const second = await forward(await post({ allow: t }))
    expect(second.toString()).toBe(first.toString())
    expect(h.created).toBe(1)
  })

  it('a failure on our side frees the screen: pressing Allow again after recovery makes the grant', async () => {
    const t = await ticket()
    h.dbDown = true
    expect((await post({ allow: t })).status).toBe(503)
    h.dbDown = false
    expect((await forward(await post({ allow: t }))).searchParams.get('code')).toBeTruthy()
    expect(h.created).toBe(1)
  })

  it('Cancel goes back as access_denied and creates nothing', async () => {
    const to = await forward(await post({ deny: await ticket() }))
    expect(to.searchParams.get('error')).toBe('access_denied')
    expect(to.searchParams.get('code')).toBeNull()
    expect(h.created).toBe(0)
  })

  it('only a business account may connect an app (the tier where Dashboard › Developers can disconnect it)', async () => {
    h.accountType = 'individual'
    expect((await post({ allow: await ticket() })).status).toBe(403)
    expect(h.created).toBe(0)
  })

  it('Cancel uses up the consent: the same screen pressed Allow afterwards still answers Cancel', async () => {
    const t = await ticket()
    expect((await forward(await post({ deny: t }))).searchParams.get('error')).toBe('access_denied')
    const later = await forward(await post({ allow: t }))
    expect(later.searchParams.get('error')).toBe('access_denied')
    expect(later.searchParams.get('code')).toBeNull()
    expect(h.created).toBe(0)
  })

  it('a shop that is no longer theirs is refused', async () => {
    h.shop = { id: 'other-shop', name: 'x' }
    expect((await post({ allow: await ticket() })).status).toBe(403)
    expect(h.created).toBe(0)
  })

  it('"Back to the app" without a ticket goes back only to a return address the client registered', async () => {
    const ok = await post({ cancel: new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, state: 'x' }).toString() })
    expect((await forward(ok)).searchParams.get('error')).toBe('access_denied')
    const bad = await post({ cancel: new URLSearchParams({ client_id: CLIENT, redirect_uri: 'https://evil.example/cb', state: 'x' }).toString() })
    expect(bad.status).toBe(400)
  })
})

describe('discovery for the sign-in', () => {
  it('the protected-resource document answers the MCP server for /api/mcp, the REST API otherwise', async () => {
    const { GET: mcpGET } = await import('@/app/api/well-known/oauth-protected-resource/mcp/route')
    const mcp = await (await mcpGET()).json()
    expect(mcp.resource).toBe(G.MCP_RESOURCE)
    expect(mcp.authorization_servers).toEqual([OAUTH_ISSUER])
    const { GET } = await import('@/app/api/well-known/oauth-protected-resource/route')
    const rest = await (await GET()).json()
    expect(rest.resource).toBe(`${OAUTH_ISSUER}/api/v1`)
  })

  it('the authorization server advertises code + PKCE S256 + CIMD + public clients', async () => {
    const { GET } = await import('@/app/api/well-known/oauth-authorization-server/route')
    const m = await (await GET()).json()
    expect(m).toMatchObject({
      issuer: OAUTH_ISSUER,
      authorization_endpoint: `${OAUTH_ISSUER}/oauth/authorize`,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    })
    expect(m.grant_types_supported).toEqual(expect.arrayContaining(['authorization_code', 'refresh_token', 'client_credentials']))
    expect(m.token_endpoint_auth_methods_supported).toContain('none')
  })
})
