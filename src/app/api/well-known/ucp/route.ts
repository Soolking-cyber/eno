import { IS_SERVICES } from '@/lib/edition'
import { ucpProfile } from '@/lib/ucp/catalog'

/**
 * /.well-known/ucp (rewrite in next.config.ts) — eno.vn's Universal Commerce Protocol business profile: the catalog
 * service and its two capabilities, no payment handlers (src/lib/ucp/catalog.ts). The hosting rules of the 2026-08-25
 * spec: HTTPS, never a redirect, `Cache-Control: public` with max-age ≥ 60 s, readable without authentication.
 * eno.vn only: a services build answers 404.
 */
export const dynamic = 'force-static'

export function GET() {
  if (IS_SERVICES) return new Response('Not found\n', { status: 404 })
  return Response.json(ucpProfile(), {
    headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' },
  })
}
