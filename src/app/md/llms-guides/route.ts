import { NextResponse } from 'next/server'
import { IS_SERVICES } from '@/lib/edition'
import { LLMS_HEADERS, marketplaceGuidesBody } from '@/lib/llms-txt'

// Matches sitemap.xml: rebuilt daily, not per request. Nothing here is per-visitor.
export const revalidate = 86400

/** /guides/llms.txt (rewritten here from that path, next.config.ts) — the guides section of /llms.txt as its own file. Marketplace only: the forum's index lists none. */
export function GET() {
  if (IS_SERVICES) return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  return new NextResponse(marketplaceGuidesBody(), { headers: LLMS_HEADERS })
}
