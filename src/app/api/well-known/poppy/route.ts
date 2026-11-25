import { OAUTH_ISSUER, SIGN_IN_SCOPES } from '@/lib/api/oauth'
import { COMPANY } from '@/lib/site-legal'
import { SCOPE_TEXT } from '@/app/[lang]/oauth/agent/scope-text'

export const runtime = 'nodejs'

/**
 * GET /.well-known/poppy.json — Personal Agent Protocol 1.0 discovery (personalagentprotocol.org/docs/1.0/spec; owner
 * 2026-11-22 "do all extra points": ora grades every file by 1.0 since November 2026, and 0.1 was ours).
 *
 * WEBSITE + SIGN-IN, NO `apis` / `agent` ENTRY, ON PURPOSE. Every listed API MUST accept the protocol's signed Session
 * header and enforce its scopes (§7), which /api/v1 and the MCP server do not implement; listing them would promise a
 * contract an agent would find broken. The sign-in itself is real and complete for 1.0 (§3.2): the protected-resource
 * metadata at /.well-known/oauth-protected-resource names this issuer, whose RFC 8414 metadata lists this domain in
 * `protected_resources`, a `revocation_endpoint` (RFC 7009, /api/v1/oauth/revoke) and refresh_token. With a single
 * authorization server `auth.issuer` may be left out (§3); scopes are described here (§4.7) so an agent can ask for only
 * what a task needs, with each scope's hints (`changes`, `personal_data`).
 * The domain is the host this document is served from, exactly (1.0 keeps a `www.` the host has).
 */
const SCOPES: Record<(typeof SIGN_IN_SCOPES)[number], string> = {
  'listings:read': SCOPE_TEXT['listings:read'].en,
  'listings:write': SCOPE_TEXT['listings:write'].en,
  'analytics:read': SCOPE_TEXT['analytics:read'].en,
  // Not on the consent page's list (the sign-in does not ask for it by default): the OpenAPI document's words.
  'media:write': 'Upload images and receive a first-party URL to use in a listing',
  // Not on the consent page's default list either: the OpenAPI document's words.
  'ads:write': 'Submit an ad creative for review and buy its run in the feed',
  'messages:read': SCOPE_TEXT['messages:read'].en,
  'messages:write': SCOPE_TEXT['messages:write'].en,
}
const HINTS: Record<(typeof SIGN_IN_SCOPES)[number], { changes: 'none' | 'reversible' | 'irreversible'; personal_data: boolean }> = {
  'listings:read': { changes: 'none', personal_data: false },
  // Deleting a listing cannot be undone.
  'listings:write': { changes: 'irreversible', personal_data: false },
  'analytics:read': { changes: 'none', personal_data: false },
  'media:write': { changes: 'reversible', personal_data: false },
  // A paid run cannot be taken back by the agent.
  'ads:write': { changes: 'irreversible', personal_data: false },
  'messages:read': { changes: 'none', personal_data: true },
  // A sent message cannot be unsent, and an offer binds the person if accepted.
  'messages:write': { changes: 'irreversible', personal_data: true },
}

export async function GET() {
  const domain = new URL(OAUTH_ISSUER).host
  return Response.json(
    {
      protocol_version: '1.0',
      organization: { name: COMPANY.nameEn, domain },
      auth: { scopes: SCOPES, scope_hints: HINTS },
      web: {},
    },
    { headers: { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' } },
  )
}
