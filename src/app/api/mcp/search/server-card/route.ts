import { NextRequest, NextResponse } from 'next/server'
import { SEARCH_CARD_TYPE, acceptsCardType, searchServerCard } from '@/lib/mcp/search-server-card'

export const runtime = 'nodejs'

/**
 * ── THE LISTING-SEARCH SERVER'S OWN CARD, AT `<streamable-http-url>/server-card` (2026-11-16) ──────────────────────────
 *
 * The site-wide card (/.well-known/mcp.json and its four aliases, src/app/api/well-known/mcp-server-card) describes the
 * Partner API alone: its `remotes[0]` is /api/mcp, and the search server appears there only in the Claude-Desktop-style
 * `mcpServers` map. ora's agent-readiness scan picked /api/mcp/search as the site's MCP server on 2026-11-16 and failed
 * `mcp-server-card` ("No MCP server card found for https://eno.vn/api/mcp/search … checked <server>/server-card").
 * This is that location: the one the Server Card WG reserves (experimental-ext-server-card, docs/discovery.md), and
 * the only card that describes THIS server. Same document shape as the site-wide card; read that file's header before
 * changing a field.
 *
 * ⛔ EVERY FIELD IS TRUE OF src/app/api/mcp/search/route.ts: no credential (so no `headers`), Streamable HTTP over POST,
 * the protocol versions its initialize accepts (server-card.test.ts pins them against the route), and the
 * name/title/version of its serverInfo. No tool list, on purpose: tools/list is the source of truth.
 * It names no visa, itinerary or payment surface: this ships in the licensed marketplace build.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export function GET(req: NextRequest) {
  // The card's own media type only when asked for with q > 0; the bytes are the same JSON either way (the site-wide
  // card's GET explains why only the label may move).
  const type = acceptsCardType(req.headers.get('accept') ?? '') ? SEARCH_CARD_TYPE : 'application/json'
  return NextResponse.json(searchServerCard(), {
    headers: { 'Content-Type': `${type}; charset=utf-8`, Vary: 'Accept', ...CORS },
  })
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
