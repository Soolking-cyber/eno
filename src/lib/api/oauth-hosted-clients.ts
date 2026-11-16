import { OAUTH_ISSUER } from '@/lib/api/oauth'

/**
 * ── CLIENT ID METADATA DOCUMENTS eno PUBLISHES FOR AN APP THAT HAS NONE OF ITS OWN (2026-11-16, owner: "do grok setup") ──
 *
 * eno's sign-in accepts CIMD clients only (src/lib/api/oauth-grant.ts): the client_id is an https URL serving that
 * client's metadata, which is what Claude, ChatGPT and Muse send by themselves. Grok's custom connector does not: on
 * grok.com/connectors → New Connector → Custom it asks the person for a "Client ID", signs in as a public client with
 * PKCE ("Token Auth Method: none"), and returns to https://grok.com/connectors-oauth-exchange-code/ (docs.x.com,
 * x-ads-api/mcp, read 2026-11-16). So the person pastes GROK_CLIENT_ID, and the authorization server reads this
 * document exactly like anyone else's (src/app/api/mcp/clients/grok/route.ts serves it).
 *
 * ⛔ SAFE BECAUSE OF THE ONE RETURN ADDRESS: a code issued to this client_id can only travel to grok.com's callback,
 * and PKCE ties it to the Grok session that started the sign-in. NO LOOPBACK ADDRESS IS LISTED on purpose: any program
 * on a person's computer could then sign in under the name "Grok".
 */
export const GROK_CLIENT_ID = `${OAUTH_ISSUER}/api/mcp/clients/grok`
export const GROK_REDIRECT_URI = 'https://grok.com/connectors-oauth-exchange-code/'
// The same callback without its trailing slash: xAI documents the slashed form, and redirect URIs match exactly, so a
// client that drops the slash would otherwise fail every sign-in. Both are grok.com's.
const GROK_REDIRECT_URI_NO_SLASH = GROK_REDIRECT_URI.replace(/\/$/, '')

export function grokClientDocument() {
  return {
    client_id: GROK_CLIENT_ID,
    client_name: 'Grok',
    client_uri: 'https://grok.com',
    redirect_uris: [GROK_REDIRECT_URI, GROK_REDIRECT_URI_NO_SLASH],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
}

/** Every client document eno publishes itself, by exact client_id. */
export const HOSTED_CLIENT_IDS: ReadonlySet<string> = new Set([GROK_CLIENT_ID])

/**
 * The address the consent screen asks the person to recognise. Normally the client's own host (its client_id URL). A
 * document eno publishes itself (above) names an app on ANOTHER site, so there the app's return address is its identity:
 * "the app you started from: eno.vn" would be false for someone who came from grok.com.
 * ⛔ KEYED ON THE EXACT client_id, NEVER ON THE HOST: any other eno URL that happened to serve a passing document must keep
 * showing eno's own host, never borrow its return address as an identity (review 2026-11-16).
 */
export function consentIdentityHost(clientId: string, clientHost: string, returnHost: string | null): string {
  return returnHost && HOSTED_CLIENT_IDS.has(clientId) ? returnHost : clientHost
}
