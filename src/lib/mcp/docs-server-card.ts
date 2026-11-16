import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { SITE_NAME } from '@/lib/edition'

/**
 * The DOCS MCP server's Server Card (src/app/api/mcp/docs/server-card/route.ts), the same shape as the search server's
 * (src/lib/mcp/search-server-card.ts). ⛔ Every field is true of src/app/api/mcp/docs/route.ts: no credential, Streamable
 * HTTP over POST, the protocol versions its initialize accepts, and its serverInfo's name/title/version.
 */
const RDNS = SITE_NAME.split('.').reverse().join('.')

export function docsServerCard() {
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
    name: `${RDNS}/docs`,
    version: '1.0.0',
    // ⚠️ 100 characters at most (the card schema).
    description: 'Search and read the docs for agents and developers: APIs, MCP, auth and rules. No sign-in.',
    title: `${SITE_NAME} Docs`,
    websiteUrl: `${OAUTH_ISSUER}/developers`,
    icons: [{ src: `${OAUTH_ISSUER}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] }],
    remotes: [
      {
        type: 'streamable-http',
        url: `${OAUTH_ISSUER}/api/mcp/docs`,
        supportedProtocolVersions: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'],
      },
    ],
  }
}
