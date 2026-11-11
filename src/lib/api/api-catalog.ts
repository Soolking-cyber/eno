import { DOC_PATHS, OPENAPI_MEDIA_TYPE, docUrl } from './discovery-links'

/** RFC 9727 §4.2: the Linkset media type (RFC 9264), with the RFC 9727 profile it SHOULD carry. */
export const API_CATALOG_PROFILE = 'https://www.rfc-editor.org/info/rfc9727'
export const API_CATALOG_MEDIA_TYPE = `application/linkset+json; profile="${API_CATALOG_PROFILE}"`

/**
 * The /.well-known/api-catalog document (src/app/api/well-known/api-catalog/route.ts says what RFC 9727 asks of it).
 * Every href comes from DOC_PATHS, joined to this edition's origin.
 */
export function apiCatalog() {
  const catalog = docUrl(DOC_PATHS.apiCatalog)
  const rest = docUrl('/api/v1')
  const mcp = docUrl('/api/mcp')
  return {
    linkset: [
      { anchor: catalog, item: [{ href: rest }, { href: mcp }] },
      {
        anchor: rest,
        'service-desc': [{ href: docUrl(DOC_PATHS.openapi), type: OPENAPI_MEDIA_TYPE }],
        'service-doc': [{ href: docUrl(DOC_PATHS.developers), type: 'text/html' }],
        // The RFC 9728 document: which authorization server issues tokens for this API, and the scopes.
        'service-meta': [{ href: docUrl(DOC_PATHS.protectedResource), type: 'application/json' }],
        status: [{ href: docUrl(DOC_PATHS.status), type: 'application/json' }],
      },
      {
        anchor: mcp,
        // The MCP Server Card: transport, protocol versions, the header to connect with.
        'service-desc': [{ href: docUrl('/.well-known/mcp.json'), type: 'application/json' }],
        'service-doc': [{ href: docUrl(DOC_PATHS.mcp), type: 'text/html' }],
      },
    ],
  }
}
