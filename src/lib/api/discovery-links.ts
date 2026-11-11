import { OAUTH_ISSUER } from './oauth'

/**
 * WHERE THE PARTNER API'S DOCUMENTS LIVE: one list, read by the response headers (respond.ts), the RFC 9727 API
 * catalogue (src/app/api/well-known/api-catalog), GET /api/v1/status, the OpenAPI document, llms.txt, the sitemap and
 * the two docs pages. Every path here is a real route in this build; the tests curl none of them, so a rename must
 * land here and in the route in the same change.
 *
 * Root-relative paths, joined to OAUTH_ISSUER (the per-edition origin) only where a header or a JSON document needs an
 * absolute URL, so eno.forum's copy names eno.forum's documents.
 */
export const DOC_PATHS = {
  /** The human reference (src/app/[lang]/developers/page.tsx). */
  developers: '/developers',
  /** The MCP server's own page (src/app/[lang]/developers/mcp). */
  mcp: '/developers/mcp',
  /** The eno-vn command-line client (src/app/[lang]/developers/cli; the package is packages/eno-vn). */
  cli: '/developers/cli',
  /** Versioning and deprecation policy (src/app/[lang]/developers/versioning). */
  versioning: '/developers/versioning',
  /** The OpenAPI 3.1 document (src/app/openapi.json/route.ts). */
  openapi: '/openapi.json',
  /** RFC 9727 API catalogue (rewrite in next.config.ts → src/app/api/well-known/api-catalog). */
  apiCatalog: '/.well-known/api-catalog',
  /** The one credential-free call (src/app/api/v1/status/route.ts). */
  status: '/api/v1/status',
  /** RFC 9728 metadata, PATH-INSERTED for the resource `<origin>/api/v1` (RFC 9728 §3.1). */
  protectedResource: '/.well-known/oauth-protected-resource/api/v1',
} as const

/** The IANA-registered media type for an OpenAPI document. The file itself is served as application/json. */
export const OPENAPI_MEDIA_TYPE = 'application/vnd.oai.openapi+json'

export function docUrl(path: string): string {
  return `${OAUTH_ISSUER}${path}`
}

/**
 * The `Link` header on every response respond.ts builds — every documented /api/v1 operation but POST /oauth/token, which
 * builds its own headers — so a client holding any one response can find the rest:
 *  - `service-desc` / `service-doc` (RFC 8631): the machine-readable description and the human documentation;
 *  - `deprecation` (RFC 9745 §3): the deprecation policy. ⚠️ SENT WHILE NOTHING IS DEPRECATED, AS THE RFC ALLOWS: §3
 *    says the link "can happen before the actual deprecation to make a deprecation policy discoverable", and §3.1's
 *    example is exactly this — the link with no `Deprecation` field, meaning "not (yet) deprecated". Never add a
 *    `Deprecation` field here: that would declare every operation deprecated.
 *  - `api-catalog` (RFC 9727 §3).
 */
export function apiLinkHeader(): string {
  return [
    `<${docUrl(DOC_PATHS.openapi)}>; rel="service-desc"; type="${OPENAPI_MEDIA_TYPE}"`,
    `<${docUrl(DOC_PATHS.developers)}>; rel="service-doc"; type="text/html"`,
    `<${docUrl(DOC_PATHS.versioning)}>; rel="deprecation"; type="text/html"`,
    `<${docUrl(DOC_PATHS.apiCatalog)}>; rel="api-catalog"`,
  ].join(', ')
}

/**
 * The Bearer challenge for a refused /api/v1 request (RFC 6750 §3, RFC 9728 §5.1).
 *
 * ⛔ A 401 WITHOUT WWW-Authenticate BREAKS HTTP ITSELF: RFC 9110 §15.5.2 says the server "MUST send a WWW-Authenticate
 * header field" on a 401, and every /api/v1 401 shipped without one until 2026-11-11. ⚠️ /api/mcp keeps its bare `Bearer`
 * on purpose: pointing MCP clients that auto-run OAuth at an authorization server with only the client-credentials
 * grant could make them start a flow that cannot finish, instead of using the header they were configured with.
 * `resource_metadata` is how a client that has only the 401 finds the RFC 9728 document, and from it the token
 * endpoint and the scopes.
 *
 * `error`: none when the request carried no credential (RFC 6750 §3.1: "SHOULD NOT include an error code"),
 * `invalid_token` for a bad, expired or revoked one, `insufficient_scope` (with the `scope` it needed) on a 403.
 */
export function bearerChallenge(opts: { error?: 'invalid_token' | 'insufficient_scope'; scope?: string } = {}): string {
  const parts = [`realm="${new URL(OAUTH_ISSUER).host} Partner API"`]
  if (opts.error) parts.push(`error="${opts.error}"`)
  if (opts.error === 'insufficient_scope' && opts.scope) parts.push(`scope="${opts.scope}"`)
  parts.push(`resource_metadata="${docUrl(DOC_PATHS.protectedResource)}"`)
  return `Bearer ${parts.join(', ')}`
}
