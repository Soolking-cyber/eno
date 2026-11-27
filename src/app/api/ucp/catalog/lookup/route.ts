import { ucpLookup, UCP_LOOKUP } from '@/lib/ucp/catalog'
import { UCP_CORS, ucpPost } from '@/lib/ucp/http'

/** UCP catalog: POST /api/ucp/catalog/lookup (src/lib/ucp/catalog.ts). */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function POST(req: Request) {
  return ucpPost(req, UCP_LOOKUP, ucpLookup)
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: UCP_CORS })
}
