import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The headers every /api/v1 response carries (respond.ts): the discovery `Link` (RFC 8631, RFC 9745 §3, RFC 9727) and,
 * on an auth refusal, the Bearer challenge (RFC 6750 §3, RFC 9728 §5.1). OAUTH_ISSUER folds NEXT_PUBLIC_APP_URL in at
 * import time, so each case re-imports after stubbing it.
 */
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

async function load(app = 'https://eno.vn') {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', app)
  return import('./respond')
}

const RATE = { success: false, limit: 30, remaining: 0, resetSec: 12, windowSec: 60 } as never

describe('the discovery Link header', () => {
  it('is on success and on error, naming the spec, the docs, the deprecation policy and the catalogue', async () => {
    const { apiOk, apiError } = await load()
    for (const res of [apiOk({ ok: true }), apiError(422, 'invalid_input', 'x'), apiError(429, 'rate_limited', 'x', RATE)]) {
      const link = res.headers.get('link')
      expect(link).toBe(
        '<https://eno.vn/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json", ' +
          '<https://eno.vn/developers>; rel="service-doc"; type="text/html", ' +
          '<https://eno.vn/developers/versioning>; rel="deprecation"; type="text/html", ' +
          '<https://eno.vn/.well-known/api-catalog>; rel="api-catalog"',
      )
      // ⛔ Nothing is deprecated: a Deprecation or Sunset FIELD here would declare every operation deprecated.
      expect(res.headers.get('deprecation')).toBeNull()
      expect(res.headers.get('sunset')).toBeNull()
    }
  })

  it("names the edition's own origin", async () => {
    const { apiOk } = await load('https://www.eno.forum')
    const link = apiOk({}).headers.get('link') || ''
    expect(link).toContain('<https://www.eno.forum/developers/versioning>; rel="deprecation"')
    expect(link).not.toContain('eno.vn')
  })
})

describe('the Bearer challenge on an auth refusal', () => {
  const resource = 'resource_metadata="https://eno.vn/.well-known/oauth-protected-resource/api/v1"'

  it('401 with no credential: no error code (RFC 6750 §3.1), the RFC 9728 document named', async () => {
    const { apiAuthError } = await load()
    const res = apiAuthError({ ok: false, status: 401, code: 'unauthorized', message: 'Missing.' })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(`Bearer realm="eno.vn Partner API", ${resource}`)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Missing.' } })
  })

  it('401 with a bad credential: invalid_token', async () => {
    const { apiAuthError } = await load()
    const res = apiAuthError({ ok: false, status: 401, code: 'unauthorized', message: 'Revoked.', challenge: { error: 'invalid_token' } })
    expect(res.headers.get('www-authenticate')).toBe(`Bearer realm="eno.vn Partner API", error="invalid_token", ${resource}`)
  })

  it('403 insufficient_scope: names the scope the call needed', async () => {
    const { apiAuthError } = await load()
    const res = apiAuthError({ ok: false, status: 403, code: 'insufficient_scope', message: 'x', challenge: { error: 'insufficient_scope', scope: 'listings:write' } })
    expect(res.status).toBe(403)
    expect(res.headers.get('www-authenticate')).toBe(`Bearer realm="eno.vn Partner API", error="insufficient_scope", scope="listings:write", ${resource}`)
  })

  it('no challenge on a 429, a 503 or an unrelated 403, and the 429 keeps Retry-After', async () => {
    const { apiAuthError, apiError } = await load()
    const limited = apiAuthError({ ok: false, status: 429, code: 'rate_limited', message: 'x', rate: RATE })
    expect(limited.headers.get('www-authenticate')).toBeNull()
    expect(limited.headers.get('retry-after')).toBe('12')
    expect(apiAuthError({ ok: false, status: 503, code: 'unavailable', message: 'x' }).headers.get('www-authenticate')).toBeNull()
    expect(apiError(403, 'account_restricted', 'x').headers.get('www-authenticate')).toBeNull()
  })
})
