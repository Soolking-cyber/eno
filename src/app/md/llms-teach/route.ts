import { NextResponse } from 'next/server'
import { IS_SERVICES } from '@/lib/edition'
import { LLMS_HEADERS, teachGuidesBody } from '@/lib/llms-txt'

// Matches sitemap.xml: rebuilt daily, not per request. Nothing here is per-visitor.
export const revalidate = 86400

/** /teach-in-vietnam/llms.txt (rewritten here from that path, next.config.ts) — the Teaching in Vietnam library as its own file. Marketplace only (the services edition
 * 308s the hub to eno.vn); always 200 on the marketplace — the index links it unconditionally. */
export function GET() {
  if (IS_SERVICES) return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  return new NextResponse(teachGuidesBody(), { headers: LLMS_HEADERS })
}
