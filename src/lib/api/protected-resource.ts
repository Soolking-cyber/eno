import { NextResponse } from 'next/server'
import { OAUTH_ISSUER, OAUTH_SCOPES } from '@/lib/api/oauth'
import { MCP_RESOURCE } from '@/lib/api/oauth-grant'

/**
 * RFC 9728 protected-resource metadata, one document per resource (§3.3: the `resource` a client fetched metadata for
 * must be the one it is told about). Two routes serve it — see src/app/api/well-known/oauth-protected-resource/:
 *   · route.ts      → the REST API (https://eno.vn/api/v1), for the bare path and every other suffix;
 *   · mcp/route.ts  → the MCP server (MCP_RESOURCE), for /.well-known/oauth-protected-resource/api/mcp.
 * ⛔ BY PATH, NOT BY QUERY (2026-11-14, live): next.config sent the MCP suffix as `…?path=api/mcp` in the rewrite's
 * destination; a route handler never sees a rewrite's destination query (req.url keeps the original request), so the
 * MCP server's challenge pointed at a document naming /api/v1 and MCP clients refused to sign in. The unit test called the
 * handler with the query by hand and passed. src/app/md/not-found/route.test.ts pins the rewrite now.
 */
export function protectedResourceResponse(which: 'rest' | 'mcp') {
  const resource = which === 'mcp' ? MCP_RESOURCE : `${OAUTH_ISSUER}/api/v1`
  return NextResponse.json(
    {
      // Imported, never rebuilt — issuer and resource must agree with the `iss` we mint and with
      // the `servers[0].url` the OpenAPI spec publishes. Per edition:
      // https://eno.vn/api/v1 (marketplace) / https://www.eno.forum/api/v1 (services).
      resource,
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
