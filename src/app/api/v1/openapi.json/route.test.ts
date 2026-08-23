import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The spec is consumed by codegen and by LLM tool-callers, so its defects are silent: a wrong
 * `servers` URL produces a client that calls the wrong domain, and a missing operationId
 * produces a tool nothing can name. Neither shows up as an error anywhere.
 */
const load = async () => { vi.resetModules(); return import('./route') }
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn'); vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace') })
afterEach(() => vi.unstubAllEnvs())

describe('the partner API spec', () => {
  it('⛔ GIVES EVERY OPERATION A UNIQUE operationId — function calling needs a name', async () => {
    // An audit on 2026-08-23 found 18 of 18 missing, which made a complete spec unusable for
    // tool calling. These are public symbols: renaming one breaks generated clients we do not
    // control, so the test pins uniqueness AND presence, not a specific list.
    const { SPEC } = await load()
    const ops = Object.values(SPEC.paths).flatMap((p) => Object.values(p as Record<string, { operationId?: string }>))
    expect(ops.length).toBeGreaterThan(0)
    const ids = ops.map((o) => o.operationId).filter(Boolean)
    expect(ids.length, 'every operation needs an operationId').toBe(ops.length)
    expect(new Set(ids).size, 'operationIds must be unique').toBe(ids.length)
  })

  it('⛔ POINTS AT THE DEPLOYMENT SERVING IT, NOT A HARDCODED eno.vn', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    const { SPEC } = await load()
    // The bug: /api/v1 compiles into BOTH editions, so eno.forum served a spec titled
    // "eno.vn Partner API" with servers: https://eno.vn/api/v1 — every client generated from
    // it would call the other domain.
    expect(SPEC.servers[0].url).toBe('https://www.eno.forum/api/v1')
    expect(SPEC.servers[0].url).not.toContain('eno.vn')
    expect(SPEC.info.title).not.toContain('eno.vn')
  })

  it('names the marketplace correctly on the marketplace', async () => {
    const { SPEC } = await load()
    expect(SPEC.servers[0].url).toBe('https://eno.vn/api/v1')
    expect(SPEC.info.title).toContain('eno.vn')
  })

  it('⚠️ DECLARES ITS AUTH, so an agent knows it cannot just call these', async () => {
    // Every operation is authenticated. A spec that omits securitySchemes reads as a public
    // API and produces agents that call it and get 401s they cannot explain.
    const { SPEC } = await load()
    expect(Object.keys(SPEC.components.securitySchemes)).toContain('bearerAuth')
    expect(SPEC.security?.length).toBeGreaterThan(0)
  })

  it('every operation documents its responses', async () => {
    const { SPEC } = await load()
    const ops = Object.values(SPEC.paths).flatMap((p) => Object.values(p as Record<string, { responses?: unknown }>))
    expect(ops.every((o) => o.responses), 'an operation with no documented response is unusable for codegen').toBe(true)
  })
})
