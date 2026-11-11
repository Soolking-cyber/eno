import { NextResponse } from 'next/server'
import { DOC_PATHS, docUrl } from '@/lib/api/discovery-links'
import { API_CATALOG_MEDIA_TYPE, apiCatalog } from '@/lib/api/api-catalog'

// ── RFC 9727 · api-catalog · /.well-known/api-catalog ────────────────────────────────────────────
// Served at /.well-known/api-catalog via a rewrite in next.config.ts (the app router ignores dot-folders; see the
// sibling OAuth routes). Measured 2026-11-11: the path was a 404, and the agent-readiness scan reported "no
// machine-verifiable API surface confirmed" while /openapi.json, /api/v1/status and the RFC 9728 document all
// answered 200. This is the one document an RFC defines for "which APIs live on this host, and where are their
// descriptions".
//
// What RFC 9727 asks, and where each is met:
//  - §2: a GET returns the catalogue; a HEAD returns a `Link` header with rel="api-catalog". Both answer here.
//  - §4.2: the document "MUST" be a Linkset, `application/linkset+json` (RFC 9264), and "SHOULD" carry the profile
//    parameter "https://www.rfc-editor.org/info/rfc9727" — both on the Content-Type.
//  - §4.1: it "MUST include hyperlinks to API endpoints" — the `item` links on the catalogue's own anchor (Appendix
//    A.2's form) — and SHOULD describe each with service-desc / service-doc / service-meta / status (RFC 8631),
//    one context object per API (Appendix A.1's form).
//  - §8: HTTPS only, read-only, public: nothing here is private, so CORS is open like the MCP card's.
//
// The document is built in src/lib/api/api-catalog.ts (a route module may export only handlers). Two APIs, because
// there are two endpoints a machine can call: the REST API and the MCP server. One credential serves both (src/app/api/well-known/oauth-protected-resource/route.ts says why that is one resource).
// ⚠️ EVERY href IS A ROUTE IN THIS BUILD, from DOC_PATHS — never a new literal. Per edition: OAUTH_ISSUER.

export const runtime = 'nodejs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Expose-Headers': 'Link',
}

function headers(): Record<string, string> {
  return {
    'Content-Type': API_CATALOG_MEDIA_TYPE,
    // §2's HEAD requirement, sent on GET too so either method finds the same pointer.
    Link: `<${docUrl(DOC_PATHS.apiCatalog)}>; rel="api-catalog"`,
    // Build-constant public metadata, an hour like the OAuth documents and the MCP card.
    'Cache-Control': 'public, max-age=3600',
    ...CORS,
  }
}

export function GET() {
  return new NextResponse(JSON.stringify(apiCatalog()), { status: 200, headers: headers() })
}

export function HEAD() {
  return new NextResponse(null, { status: 200, headers: headers() })
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } })
}
