import { protectedResourceResponse } from '@/lib/api/protected-resource'

// ── RFC 9728 · OAuth 2.0 Protected Resource Metadata ──────────────────────────────
// Served at /.well-known/oauth-protected-resource/api/v1 (and every other suffix but /api/mcp) via a rewrite in
// next.config.ts (see the sibling authorization-server route for why it cannot live under public/.well-known/).
// ⛔ NOT at the bare path since 2026-11-16: that one names the origin (./origin/route.ts, and
// src/lib/api/protected-resource.ts for why).
//
// This is the half an agent client reads FIRST: it hits the API, gets a 401 whose challenge points at
// /.well-known/oauth-protected-resource/api/v1, and looks there to learn which authorization server to go to and
// which scopes exist. This handler deliberately does NOT read the path: answering the REST document for any other
// suffix is better than 404ing a client that guessed the wrong shape.
//
// ⚠️ WHY THIS DOCUMENT'S `resource` IS THE /api/v1 ROOT AND NOT THE SITE ORIGIN (the bare path's origin document, added
// 2026-11-16, is discovery only: no token is ever issued for the origin — src/lib/api/protected-resource.ts). The token audience in practice is
// the partner API; the marketing site is not bearer-protected. Naming the origin would tell a
// client that every page needs a token. Since "Sign in with eno" (2026-11-13) the MCP server is its own resource
// (MCP_RESOURCE, the audience of sign-in tokens) with its own document at …/oauth-protected-resource/api/mcp, served
// by ./mcp/route.ts — both built by src/lib/api/protected-resource.ts.

export const runtime = 'nodejs'

/** The REST API's document, for every suffix but /api/mcp (which next.config sends to ./mcp/route.ts). */
export async function GET() {
  return protectedResourceResponse('rest')
}
