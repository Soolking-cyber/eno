import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// Plain ESM (packages/eno-vn ships JavaScript only); allowJs reads its JSDoc types.
import { buildRequest, parseArgs, run, UsageError, USAGE } from '../../packages/eno-vn/bin/eno-vn.mjs'

/**
 * The eno-vn CLI (packages/eno-vn, published to npm as `eno-vn`): each command is one documented /api/v1 call. Offline:
 * `run` takes an injected fetch and environment.
 */
type Call = { url: string; init: { method: string; headers: Record<string, string>; body?: unknown } }
function fakeFetch(pages: Array<{ status?: number; body: unknown; location?: string }>) {
  const calls: Call[] = []
  let i = 0
  const impl = async (url: string, init: Call['init']) => {
    calls.push({ url, init })
    const p = pages[Math.min(i++, pages.length - 1)]
    const status = p.status ?? 200
    const h: Record<string, string | null> = { location: p.location ?? null, 'x-request-id': 'req-1' }
    return { ok: status >= 200 && status < 300, status, headers: { get: (n: string) => h[n.toLowerCase()] ?? null }, text: async () => JSON.stringify(p.body) }
  }
  return { calls, impl }
}
const KEY = `eno_live_${'A'.repeat(32)}`
const env = { ENO_API_KEY: KEY }
const quiet = () => {}
const dir = mkdtempSync(join(tmpdir(), 'eno-vn-cli-'))
const file = (name: string, body: unknown) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(body)); return p }

describe('eno-vn: every command is a documented /api/v1 call', () => {
  it('maps commands to method + path', () => {
    const rows: Array<[string[], string, string, boolean]> = [
      [['status'], 'GET', '/api/v1/status', false],
      [['openapi'], 'GET', '/openapi.json', false],
      [['shop'], 'GET', '/api/v1/shop', true],
      [['listings', '--limit', '50'], 'GET', '/api/v1/listings?limit=50', true],
      [['listing', 'abc'], 'GET', '/api/v1/listings/abc', true],
      [['set-status', 'abc', 'sold'], 'POST', '/api/v1/listings/abc/status', true],
      [['delete', 'abc'], 'DELETE', '/api/v1/listings/abc', true],
      [['analytics'], 'GET', '/api/v1/analytics/summary', true],
      [['analytics-listings', '--from', '2026-11-01', '--to=2026-11-10'], 'GET', '/api/v1/analytics/listings?from=2026-11-01&to=2026-11-10', true],
      [['webhooks'], 'GET', '/api/v1/webhooks', true],
      [['webhook-delete', 'w1'], 'DELETE', '/api/v1/webhooks/w1', true],
    ]
    for (const [argv, method, path, auth] of rows) {
      expect(buildRequest(argv), argv.join(' ')).toMatchObject({ method, path, auth })
    }
    // Ids are path segments, never path syntax.
    expect(buildRequest(['listing', '../shop']).path).toBe('/api/v1/listings/..%2Fshop')
  })

  it('every path it calls is in the OpenAPI document (or is the document)', async () => {
    const { SPEC } = await import('@/app/api/v1/openapi.json/route')
    const paths = Object.keys((SPEC as unknown as { paths: Record<string, unknown> }).paths)
    const used = ['/status', '/shop', '/listings', '/listings/{id}', '/listings/{id}/status', '/listings/bulk', '/listings/sync', '/media', '/analytics/summary', '/analytics/listings', '/webhooks', '/webhooks/{id}', '/oauth/token']
    for (const p of used) expect(paths, p).toContain(p)
  })

  it('reads JSON bodies from files; sync --full sets mode', () => {
    const f = file('l.json', { categorySlug: 'electronics', title: 'x', price: 1 })
    expect(buildRequest(['create', f])).toMatchObject({ method: 'POST', path: '/api/v1/listings', body: readFileSync(f, 'utf8') })
    expect(buildRequest(['create', f]).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(buildRequest(['create', f, '--idempotency-key', 'k-1']).idempotencyKey).toBe('k-1')
    expect(() => buildRequest(['sync', file('m.json', { listings: [], mode: 'full' })])).toThrow(/pass --full/)
    const s = file('s.json', { listings: [] })
    expect(JSON.parse(buildRequest(['sync', s, '--full']).body)).toEqual({ listings: [], mode: 'full' })
    expect(JSON.parse(buildRequest(['sync', s]).body)).toEqual({ listings: [] })
  })

  it('refuses bad input as a usage error (exit 2), before any network call', () => {
    for (const argv of [['bogus'], ['listing'], ['set-status', 'a', 'archived'], ['create', join(dir, 'missing.json')], ['upload', 'photo.gif']]) {
      expect(() => buildRequest(argv), argv.join(' ')).toThrow(UsageError)
    }
    writeFileSync(join(dir, 'bad.json'), '{nope')
    expect(() => buildRequest(['create', join(dir, 'bad.json')])).toThrow(/not valid JSON/)
    // ⛔ Not an object: an array would drop sync --full's mode silently; null used to crash with exit 1.
    for (const v of [[], null, 3, 'x']) {
      writeFileSync(join(dir, 'v.json'), JSON.stringify(v))
      expect(() => buildRequest(['sync', join(dir, 'v.json'), '--full']), JSON.stringify(v)).toThrow(/must contain a JSON object/)
    }
    expect(() => buildRequest(['create', file('k.json', {}), '--idempotency-key'])).toThrow(UsageError)
    expect(USAGE).toContain('There is no test key: every key is live.')
  })

  it('⛔ refuses every undeclared or malformed flag and argument, before any request', () => {
    const f = file('d.json', { listings: [] })
    const bad: string[][] = [
      ['sync', f, '--ful'], // a typo never passes for a normal sync
      ['listings', '--all=true'], // a bool takes no value: never one page reported as whole
      ['token', '--scope'], // no value: never an unscoped token
      ['token', '--scope='],
      ['create', f, '--idempotency-key='], // empty: never a create without retry protection
      ['create', f, '--idempotency-key', '--x'],
      ['listings', '--limit', '5', '--limit', '6'],
      ['shop', 'extra'],
      ['set-status', 'id1', 'sold', 'now'],
      ['delete', '..'], // never path syntax
      ['set-status', '.', 'sold'],
      ['status', '--all'],
      ['delete', 'id1', '--constructor', 'x'], // inherited names are not declared flags
      ['toString'],
      ['__proto__'],
      ['--idempotency-key', 'create', 'delete', 'id1'], // the command is argv[0], never a flag's value
      ['--limit', '5', 'listings'],
    ]
    for (const argv of bad) expect(() => buildRequest(argv), argv.join(' ')).toThrow(UsageError)
    expect(buildRequest(['webhook-add', 'https://h.example/x', 'listing.created', 'listing.updated']).body).toBe(
      JSON.stringify({ url: 'https://h.example/x', events: ['listing.created', 'listing.updated'] }),
    )
  })

  it('every documented command is declared, and only those', async () => {
    const { COMMANDS } = await import('../../packages/eno-vn/bin/eno-vn.mjs')
    for (const name of Object.keys(COMMANDS)) expect(USAGE, name).toMatch(new RegExp(`^  ${name}( |$)`, 'm'))
  })

  it('parses flags in both forms and keeps positionals', () => {
    expect(parseArgs(['listings', '--limit', '5', '--all'])).toEqual({ positional: ['listings'], flags: { limit: '5', all: true } })
    expect(parseArgs(['token', '--scope=listings:read'])).toEqual({ positional: ['token'], flags: { scope: 'listings:read' } })
  })
})

describe('eno-vn: what goes on the wire', () => {
  it('sends the key as a Bearer header, a user agent, and an Idempotency-Key on creates — and says which', async () => {
    const f = fakeFetch([{ body: { listing: { id: 'n1' } } }])
    const said: string[] = []
    const res = await run(['create', file('c.json', { title: 't' })], { env, fetchImpl: f.impl, log: (m: string) => said.push(m) })
    expect(said.join('\n')).toContain(`--idempotency-key ${f.calls[0].init.headers['Idempotency-Key']}`)
    const g = fakeFetch([{ body: {} }])
    await run(['create', file('c2.json', { title: 't' }), '--idempotency-key', 'retry-1'], { env, fetchImpl: g.impl, log: quiet })
    expect(g.calls[0].init.headers['Idempotency-Key']).toBe('retry-1')
    expect(res).toMatchObject({ ok: true, status: 200 })
    const h = f.calls[0].init.headers
    expect(f.calls[0].url).toBe('https://eno.vn/api/v1/listings')
    expect(h.Authorization).toBe(`Bearer ${KEY}`)
    expect(h['User-Agent']).toMatch(/^eno-vn-cli\//)
    expect(h['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('needs no key for status, and never sends one there', async () => {
    const f = fakeFetch([{ body: { status: 'ok' } }])
    await run(['status'], { env: {}, fetchImpl: f.impl, log: quiet })
    expect(f.calls[0].init.headers.Authorization).toBeUndefined()
  })

  it('refuses a keyed command with no ENO_API_KEY, before any call', async () => {
    const f = fakeFetch([{ body: {} }])
    await expect(run(['shop'], { env: {}, fetchImpl: f.impl, log: quiet })).rejects.toBeInstanceOf(UsageError)
    expect(f.calls).toHaveLength(0)
  })

  it('returns an API refusal as data (exit 1 in main), never a throw', async () => {
    const f = fakeFetch([{ status: 401, body: { error: { code: 'unauthorized', message: 'x' } } }])
    expect(await run(['shop'], { env, fetchImpl: f.impl, log: quiet })).toEqual({ ok: false, status: 401, body: { error: { code: 'unauthorized', message: 'x' } } })
  })

  it('token: the client-credentials form the token endpoint documents (client_id = the key prefix)', async () => {
    const f = fakeFetch([{ body: { access_token: 't' } }])
    await run(['token', '--scope', 'listings:read'], { env, fetchImpl: f.impl, log: quiet })
    const form = new URLSearchParams(String(f.calls[0].init.body))
    expect(form.get('grant_type')).toBe('client_credentials')
    expect(form.get('client_id')).toBe(KEY.slice(0, 16))
    expect(form.get('client_secret')).toBe(KEY)
    expect(form.get('scope')).toBe('listings:read')
    expect(f.calls[0].init.headers.Authorization).toBeUndefined()
  })

  it('--all follows next_cursor, keeping the filters, and joins the pages', async () => {
    const f = fakeFetch([
      { body: { listings: [{ id: 1 }], next_cursor: 'c1' } },
      { body: { listings: [{ id: 2 }], next_cursor: 'c 2' } },
      { body: { listings: [{ id: 3 }], next_cursor: null } },
    ])
    const res = await run(['listings', '--limit', '1', '--all'], { env, fetchImpl: f.impl, log: quiet })
    expect(res.body).toEqual({ listings: [{ id: 1 }, { id: 2 }, { id: 3 }], next_cursor: null })
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://eno.vn/api/v1/listings?limit=1',
      'https://eno.vn/api/v1/listings?limit=1&cursor=c1',
      'https://eno.vn/api/v1/listings?limit=1&cursor=c+2',
    ])
  })

  it('⛔ --all never reports a partial list as complete: a repeated cursor is an error', async () => {
    const f = fakeFetch([{ body: { listings: [{ id: 1 }], next_cursor: 'same' } }])
    const res = await run(['listings', '--all'], { env, fetchImpl: f.impl, log: quiet })
    expect(res.ok).toBe(false)
    expect(res.body.error.code).toBe('incomplete')
  })

  it('⛔ --all refuses a response that is not a page (an HTML 200, a renamed field) rather than call it complete', async () => {
    for (const pages of [
      [{ body: '<html>' }],
      [{ body: { items: [], next_cursor: null } }],
      [{ body: { listings: [{ id: 1 }], next_cursor: 'c1' } }, { body: { listings: [{ id: 2 }] } }],
      [{ body: { listings: [{ id: 1 }], next_cursor: '' } }], // an empty cursor is not "done"
      [{ body: { listings: [{ id: 1 }], next_cursor: 'c1' } }, { body: { listings: [], next_cursor: '' } }],
    ]) {
      const f = fakeFetch(pages)
      const res = await run(['listings', '--all'], { env, fetchImpl: f.impl, log: quiet })
      expect(res.ok, JSON.stringify(pages)).toBe(false)
      expect(res.body.error.code).toBe('unexpected_response')
    }
  })

  it('⛔ a 2xx that is not JSON (a proxy or challenge page) is never a success; an empty body is', async () => {
    const html = { ok: true, status: 200, headers: { get: (n: string) => (n === 'x-request-id' ? 'r' : null) }, text: async () => '<html>challenge</html>' }
    const res = await run(['set-status', 'id1', 'sold'], { env, fetchImpl: async () => html, log: quiet })
    expect(res).toMatchObject({ ok: false, status: 200, body: { error: { code: 'unexpected_response' } } })
    const empty = { ok: true, status: 204, headers: { get: (n: string) => (n === 'x-request-id' ? 'r' : null) }, text: async () => '' }
    expect(await run(['delete', 'id1'], { env, fetchImpl: async () => empty, log: quiet })).toEqual({ ok: true, status: 204, body: null })
    const empty200 = { ok: true, status: 200, headers: { get: (n: string) => (n === 'x-request-id' ? 'r' : null) }, text: async () => '' }
    const r = await run(['set-status', 'id1', 'sold'], { env, fetchImpl: async () => empty200, log: quiet })
    expect(r).toMatchObject({ ok: false, body: { error: { code: 'unexpected_response' } } })
    // After a SENT write, an unexpected answer carries the same warning as a dropped connection.
    expect(r.body.error.message).toContain('may already have been made')
    const truncated = { ok: true, status: 200, headers: { get: (n: string) => (n === 'x-request-id' ? 'r' : null) }, text: async () => '{"listing":{"id"' }
    const t = await run(['create', file('tr.json', { title: 't' }), '--idempotency-key', 'k8'], { env, fetchImpl: async () => truncated, log: quiet })
    expect(t.body.error.message).toContain('--idempotency-key k8')
  })

  it('⛔ a JSON 2xx without the API\'s X-Request-Id (a proxy, a portal) never confirms a change', async () => {
    const foreign = { ok: true, status: 200, headers: { get: () => null }, text: async () => '{"challenge":"required"}' }
    expect(await run(['set-status', 'id1', 'sold'], { env, fetchImpl: async () => foreign, log: quiet })).toMatchObject({ ok: false, body: { error: { code: 'unexpected_response' } } })
    // The token endpoint builds its own headers (no X-Request-Id), so the token itself is checked instead.
    expect(await run(['token'], { env, fetchImpl: async () => foreign, log: quiet })).toMatchObject({ ok: false, body: { error: { code: 'unexpected_response' } } })
    const minted = { ok: true, status: 200, headers: { get: () => null }, text: async () => '{"access_token":"eyJ.x.y","token_type":"Bearer"}' }
    expect((await run(['token'], { env, fetchImpl: async () => minted, log: quiet })).ok).toBe(true)
  })

  it('⛔ a request that never answers times out; a timed-out write says it may have happened, with the retry key', async () => {
    const hang = (_u: string, init: { signal: AbortSignal }) => new Promise((_r, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('t'), { name: 'TimeoutError' })))
    })
    const realTimeout = AbortSignal.timeout
    AbortSignal.timeout = () => realTimeout.call(AbortSignal, 5)
    try {
      const res = await run(['create', file('t.json', { title: 't' }), '--idempotency-key', 'k9'], { env, fetchImpl: hang as never, log: quiet })
      expect(res).toMatchObject({ ok: false, body: { error: { code: 'timeout' } } })
      expect(res.body.error.message).toContain('--idempotency-key k9')
    } finally {
      AbortSignal.timeout = realTimeout
    }
  })

  it('⛔ a body that stalls after the headers, or a dropped connection, still answers JSON with the write warning', async () => {
    const stalled = { ok: true, status: 200, headers: { get: () => 'r' }, text: async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }) } }
    const a = await run(['create', file('s1.json', { title: 't' }), '--idempotency-key', 'k7'], { env, fetchImpl: async () => stalled, log: quiet })
    expect(a).toMatchObject({ ok: false, status: 0, body: { error: { code: 'timeout' } } })
    expect(a.body.error.message).toContain('may already have been made')
    expect(a.body.error.message).toContain('--idempotency-key k7')
    const reset = async () => { throw new Error('ECONNRESET') }
    const b = await run(['webhook-add', 'https://h.example/x'], { env, fetchImpl: reset, log: quiet })
    expect(b).toMatchObject({ ok: false, body: { error: { code: 'network_error' } } })
    expect(b.body.error.message).toContain('may already have been made')
    const c = await run(['shop'], { env, fetchImpl: reset, log: quiet })
    expect(c.body.error.message).not.toContain('may already have been made') // a read changes nothing
  })

  it('exit codes: 1 only for an API refusal, 3 when nothing confirms the outcome', async () => {
    const { main } = await import('../../packages/eno-vn/bin/eno-vn.mjs')
    expect(USAGE).toContain('3 no confirmed answer')
    const prev = { key: process.env.ENO_API_KEY, fetch: globalThis.fetch, log: console.log, err: console.error }
    process.env.ENO_API_KEY = KEY
    console.log = () => {}
    console.error = () => {}
    try {
      globalThis.fetch = (async () => ({ ok: false, status: 401, headers: { get: () => 'r' }, text: async () => '{"error":{"code":"unauthorized","message":"x"}}' })) as never
      expect(await main(['shop'])).toBe(1)
      globalThis.fetch = (async () => { throw new Error('ECONNRESET') }) as never
      expect(await main(['shop'])).toBe(3)
      // A server error CODE that happens to read like a client failure is still the API refusing: 1, not 3.
      globalThis.fetch = (async () => ({ ok: false, status: 409, headers: { get: () => 'r' }, text: async () => '{"error":{"code":"timeout","message":"x"}}' })) as never
      expect(await main(['shop'])).toBe(1)
      // A 2xx carrying an error envelope confirms nothing.
      globalThis.fetch = (async () => ({ ok: true, status: 200, headers: { get: () => 'r' }, text: async () => '{"error":{"code":"challenge_required"}}' })) as never
      expect(await main(['shop'])).toBe(3)
      expect(await main(['bogus'])).toBe(2)
    } finally {
      globalThis.fetch = prev.fetch
      console.log = prev.log
      console.error = prev.err
      if (prev.key === undefined) delete process.env.ENO_API_KEY
      else process.env.ENO_API_KEY = prev.key
    }
  })

  it('⛔ a 5xx, or a refusal without X-Request-Id (a gateway), after a write is unconfirmed (exit 3), with the warning', async () => {
    const h = (rid: string | null) => ({ get: (n: string) => (n === 'x-request-id' ? rid : null) })
    const fivexx = { ok: false, status: 502, headers: h(null), text: async () => '{"error":{"code":"bad_gateway"}}' }
    const r = await run(['create', file('g.json', { title: 't' }), '--idempotency-key', 'k5'], { env, fetchImpl: async () => fivexx, log: quiet })
    expect(r).toMatchObject({ ok: false, body: { error: { code: 'unexpected_response' } } })
    expect(r.body.error.message).toContain('--idempotency-key k5')
    const api500 = { ok: false, status: 500, headers: h('r'), text: async () => '{"error":{"code":"internal_error"}}' }
    expect((await run(['set-status', 'a', 'sold'], { env, fetchImpl: async () => api500, log: quiet })).body.error.code).toBe('unexpected_response')
    const api422 = { ok: false, status: 422, headers: h('r'), text: async () => '{"error":{"code":"invalid_input"}}' }
    expect((await run(['set-status', 'a', 'sold'], { env, fetchImpl: async () => api422, log: quiet })).body).toEqual({ error: { code: 'invalid_input' } })
  })

  it('token refuses an access token in ENO_API_KEY (it would be posted as client_secret)', async () => {
    const f = fakeFetch([{ body: { access_token: 't' } }])
    await expect(run(['token'], { env: { ENO_API_KEY: 'eyJ.a.b' }, fetchImpl: f.impl, log: quiet })).rejects.toBeInstanceOf(UsageError)
    expect(f.calls).toHaveLength(0)
  })

  it('⛔ only the API\'s two shapes count: an object success, an {error:{code}} refusal; anything else is unconfirmed', async () => {
    const h = { get: (n: string) => (n === 'x-request-id' ? 'r' : null) }
    for (const [status, body] of [[200, 'null'], [200, 'true'], [200, '[1]'], [403, '{"challenge":"required"}'], [404, '"nope"']] as const) {
      const r = await run(['shop'], { env, fetchImpl: async () => ({ ok: status < 300, status, headers: h, text: async () => body }), log: quiet })
      expect(r, `${status} ${body}`).toMatchObject({ ok: false, unconfirmed: true })
    }
    const ok = await run(['shop'], { env, fetchImpl: async () => ({ ok: true, status: 200, headers: h, text: async () => '{"shop":{"id":"s"}}' }), log: quiet })
    expect(ok).toEqual({ ok: true, status: 200, body: { shop: { id: 's' } } })
  })

  it('a token refusal in the OAuth shape is the API refusing (exit 1 path), not unconfirmed', async () => {
    const refused = { ok: false, status: 401, headers: { get: () => null }, text: async () => '{"error":"invalid_client","error_description":"x"}' }
    expect(await run(['token'], { env, fetchImpl: async () => refused, log: quiet })).toEqual({ ok: false, status: 401, body: { error: 'invalid_client', error_description: 'x' } })
  })

  it('--all refuses to start from a --cursor (it would call a partial list whole)', () => {
    expect(() => buildRequest(['listings', '--all', '--cursor', 'c1'])).toThrow(UsageError)
    expect(() => buildRequest(['analytics-listings', '--cursor=c1', '--all'])).toThrow(UsageError)
  })

  it('a key or idempotency key fetch could not send is a usage error, never "may already have been made"', async () => {
    const f = fakeFetch([{ body: {} }])
    await expect(run(['shop'], { env: { ENO_API_KEY: 'eno_live_…' }, fetchImpl: f.impl, log: quiet })).rejects.toBeInstanceOf(UsageError)
    await expect(run(['create', file('ik.json', { title: 't' }), '--idempotency-key', 'clé à'], { env, fetchImpl: f.impl, log: quiet })).rejects.toBeInstanceOf(UsageError)
    expect(f.calls).toHaveLength(0)
  })

  it('an empty access_token is not a token', async () => {
    const empty = { ok: true, status: 200, headers: { get: () => null }, text: async () => '{"access_token":""}' }
    expect((await run(['token'], { env, fetchImpl: async () => empty, log: quiet })).ok).toBe(false)
  })

  it('webhook-add with no events sends "*", which the endpoint accepts', () => {
    expect(JSON.parse(buildRequest(['webhook-add', 'https://h.example/x']).body)).toEqual({ url: 'https://h.example/x', events: '*' })
    expect(readFileSync(join(process.cwd(), 'src/app/api/v1/webhooks/route.ts'), 'utf8')).toContain('events must be an array of event names or "*"')
  })

  it('⛔ never follows a redirect: a POST turned GET, or a cross-origin hop dropping the key, is an error naming the target', async () => {
    const f = fakeFetch([{ status: 308, body: '', location: 'https://www.eno.forum/api/v1/listings' }])
    const res = await run(['create', file('r.json', { title: 't' })], { env: { ...env, ENO_BASE_URL: 'https://eno.forum' }, fetchImpl: f.impl, log: quiet })
    expect(res).toMatchObject({ ok: false, status: 308, body: { error: { code: 'redirected' } } })
    expect(res.body.error.message).toContain('https://www.eno.forum/api/v1/listings')
    expect(res.body.error.message).toContain('may already have been made') // a write was sent; never "just run it again"
    expect(f.calls).toHaveLength(1)
    expect((f.calls[0].init as unknown as { redirect: string }).redirect).toBe('manual')
  })

  it('a missing upload file is a usage error (exit 2), never "the API refused"', async () => {
    await expect(run(['upload', join(dir, 'nope.png')], { env, fetchImpl: async () => { throw new Error('no call') }, log: quiet })).rejects.toBeInstanceOf(UsageError)
  })

  it('analytics-listings --all pages on the `listings` key the endpoint returns (src/lib/listing-analytics.ts)', async () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/listing-analytics.ts'), 'utf8')
    expect(src).toMatch(/listings: unknown\[\]; next_cursor: string \| null/)
    const f = fakeFetch([
      { body: { range: { from: 'a', to: 'b' }, listings: [{ id: 1 }], next_cursor: 'c1' } },
      { body: { range: { from: 'a', to: 'b' }, listings: [{ id: 2 }], next_cursor: null } },
    ])
    const res = await run(['analytics-listings', '--from', '2026-11-01', '--all'], { env, fetchImpl: f.impl, log: quiet })
    expect(res.body.listings).toEqual([{ id: 1 }, { id: 2 }])
    expect(f.calls[1].url).toBe('https://eno.vn/api/v1/analytics/listings?from=2026-11-01&cursor=c1')
  })

  it('upload: multipart `file`, the type from the extension', async () => {
    const img = join(dir, 'p.png')
    writeFileSync(img, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const f = fakeFetch([{ body: { url: 'https://x/y.webp' } }])
    await run(['upload', img], { env, fetchImpl: f.impl, log: quiet })
    const body = f.calls[0].init.body as FormData
    const part = body.get('file') as Blob
    expect(part.type).toBe('image/png')
    expect(f.calls[0].init.headers['Content-Type']).toBeUndefined()
  })

  it('⛔ sends the key over HTTPS only (localhost aside)', async () => {
    const f = fakeFetch([{ body: {} }])
    for (const base of ['http://eno.vn', 'ftp://eno.vn', 'not a url', 'https://eno.vn?source=cli', 'https://eno.vn#x', 'https://eno.vn/api', 'https://u:p@eno.vn']) {
      await expect(run(['shop'], { env: { ...env, ENO_BASE_URL: base }, fetchImpl: f.impl, log: quiet }), base).rejects.toBeInstanceOf(UsageError)
    }
    expect(f.calls).toHaveLength(0)
    await run(['status'], { env: { ENO_BASE_URL: 'http://localhost:3000' }, fetchImpl: f.impl, log: quiet })
    expect(f.calls[0].url).toBe('http://localhost:3000/api/v1/status')
  })

  it('honours ENO_BASE_URL (eno.forum, a preview)', async () => {
    const f = fakeFetch([{ body: {} }])
    await run(['status'], { env: { ENO_BASE_URL: 'https://www.eno.forum/' }, fetchImpl: f.impl, log: quiet })
    expect(f.calls[0].url).toBe('https://www.eno.forum/api/v1/status')
  })
})

describe('eno-vn: the package', () => {
  it('ships one bin, no dependencies, and the version the CLI reports', async () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'packages/eno-vn/package.json'), 'utf8'))
    const { VERSION } = await import('../../packages/eno-vn/bin/eno-vn.mjs' as string)
    expect(pkg.name).toBe('eno-vn')
    expect(pkg.bin).toEqual({ 'eno-vn': 'bin/eno-vn.mjs' })
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.version).toBe(VERSION)
    expect(readFileSync(join(process.cwd(), 'packages/eno-vn/bin/eno-vn.mjs'), 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true)
  })
})

describe('/developers/cli shows only commands the CLI accepts', () => {
  it('⛔ names ENO_BASE_URL on any edition but eno.vn (the CLI defaults to eno.vn)', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/[lang]/developers/cli/page.tsx'), 'utf8')
    expect(page).toContain("SITE_ORIGIN === 'https://eno.vn' ? '' : `export ENO_BASE_URL=${SITE_ORIGIN}")
  })

  it('parses every example on the page', async () => {
    const { CLI_EXAMPLES } = await import('@/app/[lang]/developers/cli/examples')
    const shell = (cmd: string) => (cmd.match(/"[^"]*"|\S+/g) ?? []).map((t) => t.replace(/^"|"$/g, ''))
    for (const [cmd] of CLI_EXAMPLES) {
      const argv = shell(cmd)
      expect(argv.slice(0, 2), cmd).toEqual(['npx', 'eno-vn'])
      const rest = argv.slice(2).map((a) => (a.endsWith('.json') ? file(a, {}) : a))
      expect(() => buildRequest(rest), cmd).not.toThrow()
    }
  })
})
