import { NextResponse } from 'next/server'
import { grokClientDocument } from '@/lib/api/oauth-hosted-clients'

export const runtime = 'nodejs'

/**
 * Grok's Client ID Metadata Document, which eno publishes because Grok's custom connector asks for a client ID instead of
 * sending a document of its own (src/lib/api/oauth-hosted-clients.ts says why it is safe). Under /api/mcp: the path the
 * Cloudflare challenge rules exempt, so the authorization server's own fetch of it (oauth-grant.ts loadClient) is
 * never challenged.
 */
export function GET() {
  return NextResponse.json(grokClientDocument(), {
    headers: { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
  })
}
