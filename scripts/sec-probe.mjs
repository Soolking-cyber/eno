#!/usr/bin/env node
// ── Partner-API security probe ────────────────────────────────────────────────────
// Black-box, NON-DESTRUCTIVE checks against a deployed eno.vn: every call is either
// unauthenticated or uses deliberately-invalid credentials, so it creates nothing and
// touches no real account. Asserts that the auth surfaces shipped with the Partner API
// (OAuth2 client-credentials, JWT access tokens, session-authed webhooks, MCP, admin)
// fail closed, and that the app ships its baseline security headers.
//
//   node scripts/sec-probe.mjs                 # probes https://eno.vn
//   node scripts/sec-probe.mjs http://localhost:3000
//   PROBE_BASE=https://staging.eno.vn node scripts/sec-probe.mjs
//
// Exits 0 if all checks pass, 1 otherwise (so it can gate CI / a post-deploy step).
import crypto from 'crypto'

const BASE = (process.argv[2] || process.env.PROBE_BASE || 'https://eno.vn').replace(/\/$/, '')
let pass = 0, fail = 0
const lines = []
function check(name, cond, detail = '') {
  lines.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  cond ? pass++ : fail++
}
const json = async (r) => { try { return await r.json() } catch { return null } }
const now = () => Math.floor(Date.now() / 1000)

// Forge a structurally-valid HS256 JWT signed with an attacker-chosen key — must be REJECTED
// (only a token signed with the server's HKDF-derived key may pass).
function forgeJwt(signKey, claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`
  return `${data}.${crypto.createHmac('sha256', signKey).update(data).digest('base64url')}`
}

async function main() {
  console.log(`# sec-probe → ${BASE}\n`)

  // ── 1. OAuth token endpoint (client-credentials) ───────────────────────────────
  {
    const noGrant = await fetch(`${BASE}/api/v1/oauth/token`, { method: 'POST', body: new URLSearchParams({ foo: 'bar' }) })
    const b = await json(noGrant)
    check('oauth: missing grant_type → 400 unsupported_grant_type', noGrant.status === 400 && b?.error === 'unsupported_grant_type')
    check('oauth: token response is Cache-Control: no-store', /no-store/.test(noGrant.headers.get('cache-control') || ''))

    const badGrant = await fetch(`${BASE}/api/v1/oauth/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password' }) })
    check('oauth: unsupported grant (password) → 400', badGrant.status === 400)

    const malformed = await fetch(`${BASE}/api/v1/oauth/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_secret: 'not-a-key' }) })
    const mb = await json(malformed)
    check('oauth: malformed client_secret → 401 invalid_client', malformed.status === 401 && mb?.error === 'invalid_client')

    const fakeKey = 'eno_live_' + 'a'.repeat(40)
    const unknown = await fetch(`${BASE}/api/v1/oauth/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_secret: fakeKey }) })
    check('oauth: well-formed but unknown key → 401', unknown.status === 401)

    const basic = Buffer.from(`eno_live_pfx:${fakeKey}`).toString('base64')
    const basicBad = await fetch(`${BASE}/api/v1/oauth/token`, { method: 'POST', headers: { authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: 'client_credentials' }) })
    check('oauth: HTTP Basic with unknown key → 401', basicBad.status === 401)
  }

  // ── 2. Forged access-token rejection on protected surfaces ─────────────────────
  {
    const claims = { iss: 'https://eno.vn', sub: 'attacker', sid: 'shop_x', pid: 'p_x', scope: 'listings:read analytics:read listings:write media:write', iat: now(), exp: now() + 3600, jti: crypto.randomUUID() }
    const forgeries = {
      'random-key': forgeJwt(crypto.randomBytes(32), claims),
      'empty-key': forgeJwt(Buffer.from(''), claims),
      'weak-guess': forgeJwt(Buffer.from('secret'), claims),
      'alg:none': (() => { const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); return `${b({ alg: 'none', typ: 'JWT' })}.${b(claims)}.` })(),
    }
    for (const [label, tok] of Object.entries(forgeries)) {
      const r = await fetch(`${BASE}/api/v1/shop`, { headers: { authorization: `Bearer ${tok}` } })
      check(`v1/shop: forged JWT (${label}) → 401`, r.status === 401)
    }
    const mcp = await fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { authorization: `Bearer ${forgeries['random-key']}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
    check('mcp: forged JWT → 401 (no tool access)', mcp.status === 401)
  }

  // ── 3. Unauthenticated access to protected endpoints ───────────────────────────
  {
    const v1 = await fetch(`${BASE}/api/v1/shop`)
    const vb = await json(v1)
    check('v1/shop: no bearer → 401 unauthorized', v1.status === 401 && vb?.error?.code === 'unauthorized')
    check('v1/shop: garbage bearer → 401', (await fetch(`${BASE}/api/v1/shop`, { headers: { authorization: 'Bearer xxxxxxxxxxxx' } })).status === 401)

    const whGet = await fetch(`${BASE}/api/webhooks`)
    const wb = await json(whGet)
    check('webhooks: no session → 403 business_only', whGet.status === 403 && wb?.error === 'business_only')
    check('webhooks: POST no session → 403', (await fetch(`${BASE}/api/webhooks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com/hook' }) })).status === 403)
    const whDel = await fetch(`${BASE}/api/webhooks/whatever`, { method: 'DELETE' })
    check('webhooks/[id]: DELETE no session → 404/403 (no leak)', whDel.status === 404 || whDel.status === 403)

    const mod = await fetch(`${BASE}/api/admin/moderate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'dismiss-report', id: 'x' }) })
    check('admin/moderate: no session → 401/403', mod.status === 401 || mod.status === 403)
  }

  // ── 4. Baseline security headers ───────────────────────────────────────────────
  {
    const h = (await fetch(`${BASE}/`)).headers
    check('headers: CSP present', !!h.get('content-security-policy'))
    check('headers: X-Content-Type-Options nosniff', (h.get('x-content-type-options') || '').includes('nosniff'))
    check('headers: clickjacking guard (XFO or frame-ancestors)', !!h.get('x-frame-options') || /frame-ancestors/.test(h.get('content-security-policy') || ''))
    check('headers: HSTS', !!h.get('strict-transport-security'))
  }

  console.log(lines.join('\n'))
  console.log(`\n${pass}/${pass + fail} passed` + (fail ? `  (${fail} FAILED)` : '  — all green'))
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('probe crashed:', e); process.exit(1) })
