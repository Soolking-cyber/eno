import { NextRequest, NextResponse } from 'next/server'
import { SEARCH_CARD_TYPE, acceptsCardType } from '@/lib/mcp/search-server-card'
import { docsServerCard } from '@/lib/mcp/docs-server-card'

export const runtime = 'nodejs'

/** The DOCS MCP server's own card, at `<streamable-http-url>/server-card` — the location the Server Card WG reserves, as for
 * the search server (its card route explains the shape). Every field is true of src/app/api/mcp/docs/route.ts. */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export function GET(req: NextRequest) {
  // The card's own media type only when asked for with q > 0; the bytes are the same JSON either way (the site-wide
  // card's GET explains why only the label may move).
  const type = acceptsCardType(req.headers.get('accept') ?? '') ? SEARCH_CARD_TYPE : 'application/json'
  return NextResponse.json(docsServerCard(), {
    headers: { 'Content-Type': `${type}; charset=utf-8`, Vary: 'Accept', ...CORS },
  })
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
