import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { COMPANY } from '@/lib/site-legal'

export const runtime = 'nodejs'

/**
 * GET /.well-known/poppy.json — Personal Agent Protocol (draft 0.1, personalagentprotocol.org) discovery, WEBSITE-ONLY.
 *
 * ⛔ NO `agent`, `apis` OR `auth` BLOCK, ON PURPOSE. Declaring an API or agent here requires `auth.issuer`, and the
 * issuer's RFC 8414 metadata must then carry `poppy_domains` and a `revocation_endpoint` (RFC 7009). Ours has no
 * revocation endpoint (a grant is revoked in Dashboard › Developers), so declaring the MCP server or /api/a2a here
 * would claim an issuer binding the scanner — and a client — would find broken. Add them with a real revocation
 * endpoint, not before. The domain is this edition's own host, which is the host this document is served from (the
 * draft's rule, §3: it must match the requested host, ignoring a leading www).
 */
export async function GET() {
  const domain = new URL(OAUTH_ISSUER).hostname.replace(/^www\./, '')
  return Response.json(
    { protocol_version: '0.1', organization: { name: COMPANY.nameEn, domain }, web: {} },
    { headers: { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' } },
  )
}
