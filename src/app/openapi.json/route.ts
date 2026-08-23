import { NextResponse } from 'next/server'
import { SPEC } from '@/app/api/v1/openapi.json/route'

/**
 * /openapi.json — the CONVENTIONAL location, aliasing the spec that already lived at
 * /api/v1/openapi.json.
 *
 * ⚠️ WHY AN ALIAS RATHER THAN A MOVE. The spec has been served at /api/v1/openapi.json since
 * the partner API shipped, and that URL may already be in a partner's codegen config; moving
 * it would break them for a discoverability win. Both paths serve the SAME exported object,
 * so they cannot drift — which is the failure an alias usually introduces.
 *
 * ⛔ THIS IS WHY AN AGENT AUDIT REPORTED "No OpenAPI/Swagger specification found" ON
 * 2026-08-23 while a complete 3.1.0 spec was being served. Tools look at /openapi.json and
 * /api/openapi.yaml; a spec at a path nobody probes is, to a machine, a spec that does not
 * exist. The document was never the problem.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(SPEC, {
    headers: {
      // Agents fetch this cold and rarely; a day at the edge is plenty and keeps a spec
      // change visible the same day rather than a week later.
      'cache-control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  })
}
