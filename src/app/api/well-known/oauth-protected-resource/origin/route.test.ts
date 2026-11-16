import { describe, it, expect } from 'vitest'
import { OAUTH_ISSUER } from '@/lib/api/oauth'

// The bare /.well-known/oauth-protected-resource names the ORIGIN (RFC 9728 §3.1/§3.3; src/lib/api/protected-resource.ts).
describe('RFC 9728 — the origin document (bare path)', () => {
  it('names the origin, with the same authorization server, scopes and bearer method as the REST document', async () => {
    const origin = await (await (await import('./route')).GET()).json()
    const rest = await (await (await import('../route')).GET()).json()
    expect(origin.resource).toBe(OAUTH_ISSUER)
    expect(rest.resource).toBe(`${OAUTH_ISSUER}/api/v1`)
    expect(origin.authorization_servers).toEqual(rest.authorization_servers)
    expect(origin.scopes_supported).toEqual(rest.scopes_supported)
    expect(origin.bearer_methods_supported).toEqual(['header'])
  })
})
