import { NextResponse } from 'next/server'
import { OAUTH_ISSUER, OAUTH_SCOPES } from '@/lib/api/oauth'
import { MCP_RESOURCE } from '@/lib/api/oauth-grant'

/**
 * RFC 9728 protected-resource metadata, one document per resource (§3.3: the `resource` a client fetched metadata for
 * must be the one it is told about). Three routes serve it — see src/app/api/well-known/oauth-protected-resource/:
 *   · origin/route.ts → the origin (https://eno.vn), for the BARE path /.well-known/oauth-protected-resource;
 *   · route.ts        → the REST API (https://eno.vn/api/v1), for every suffix but /api/mcp;
 *   · mcp/route.ts    → the MCP server (MCP_RESOURCE), for /.well-known/oauth-protected-resource/api/mcp.
 * ⛔ THE BARE PATH NAMES THE ORIGIN (2026-11-16). §3.1 builds the well-known URL by inserting the resource's PATH after
 * /.well-known/oauth-protected-resource, so the document at the bare path is the one for the resource with NO path — the
 * origin. It said …/api/v1 until 2026-11-16, and isitagentready.com failed it as a resource mismatch; a strict RFC 9728
 * client would refuse it for the same reason. Nothing challenges with the bare URL: /api/v1's 401 points at …/api/v1
 * (discovery-links.ts DOC_PATHS.protectedResource) and /api/mcp's at …/api/mcp. Same authorization server and scopes in
 * all three, so a client that falls back to the bare document is told nothing the path documents contradict.
 * ⚠️ THE ORIGIN DOCUMENT IS FOR DISCOVERY ONLY — no token is ever issued FOR the origin. The authorization server refuses
 * every RFC 8707 `resource` but MCP_RESOURCE (oauth-grant.ts: invalid_target at authorize, code redemption and refresh),
 * client_credentials tokens carry no `aud`, and auth.ts compares a sign-in token's `aud` to the resource EXACTLY, so a
 * client that asks for `resource=https://eno.vn` gets an error, never a token valid on both /api/v1 and /api/mcp.
 * ⛔ BY PATH, NOT BY QUERY (2026-11-14, live): next.config sent the MCP suffix as `…?path=api/mcp` in the rewrite's
 * destination; a route handler never sees a rewrite's destination query (req.url keeps the original request), so the
 * MCP server's challenge pointed at a document naming /api/v1 and MCP clients refused to sign in. The unit test called the
 * handler with the query by hand and passed. src/app/md/not-found/route.test.ts pins the rewrite now.
 */
export function protectedResourceResponse(which: 'origin' | 'rest' | 'mcp') {
  const resource = which === 'mcp' ? MCP_RESOURCE : which === 'origin' ? OAUTH_ISSUER : `${OAUTH_ISSUER}/api/v1`
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
      resource_name: which === 'origin' ? new URL(OAUTH_ISSUER).host : `${new URL(OAUTH_ISSUER).host} Partner API`,
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
