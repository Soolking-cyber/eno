import { NextResponse } from 'next/server'
import { OAUTH_ISSUER, OAUTH_SCOPES } from '@/lib/api/oauth'

// ── RFC 9728 · OAuth 2.0 Protected Resource Metadata ──────────────────────────────
// Served at /.well-known/oauth-protected-resource via a rewrite in next.config.ts (see the
// sibling authorization-server route for why it cannot live under public/.well-known/).
//
// This is the half an agent client reads FIRST: it hits the API, gets a 401, and looks here to
// learn which authorization server to go to and which scopes exist. RFC 9728 also defines a
// path-suffixed form — /.well-known/oauth-protected-resource/api/v1 for the resource
// https://eno.vn/api/v1 — so the rewrite is registered with a `:path*` suffix as well. This
// handler deliberately does NOT read the path: there is exactly one protected resource here, and
// answering the same document for any suffix is better than 404ing a client that guessed the
// wrong shape.
//
// ⚠️ WHY `resource` IS THE /api/v1 ROOT AND NOT THE SITE ORIGIN. The token audience in practice is
// the partner API; the marketing site is not bearer-protected. Naming the origin would tell a
// client that every page needs a token. /api/mcp is served by the same key auth (resolveApiKey
// with no required scope) and is intentionally not listed as a separate resource — one credential,
// one authorization server, and a second entry would imply a second trust boundary that does not
// exist.

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(
    {
      // Imported, never rebuilt — issuer and resource must agree with the `iss` we mint and with
      // the `servers[0].url` the OpenAPI spec publishes. Per edition:
      // https://eno.vn/api/v1 (marketplace) / https://www.eno.forum/api/v1 (services).
      resource: `${OAUTH_ISSUER}/api/v1`,
      // One authorization server: ourselves. Its metadata is the sibling document at
      // /.well-known/oauth-authorization-server on this same origin.
      authorization_servers: [OAUTH_ISSUER],
      // Same list the authorization server advertises, from the same constant, because a client
      // that sees different scope sets on the two documents cannot tell which one to request.
      scopes_supported: [...OAUTH_SCOPES],
      // resolveApiKey reads `Authorization: Bearer …` and NOTHING else — no `access_token` query
      // parameter, no form body. Advertising either would invite a client to put a credential in a
      // URL, where it lands in every access log and Referer header on the way.
      bearer_methods_supported: ['header'],
      resource_name: `${new URL(OAUTH_ISSUER).host} Partner API`,
      resource_documentation: `${OAUTH_ISSUER}/developers`,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  )
}
