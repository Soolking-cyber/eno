import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { SITE_NAME } from '@/lib/edition'

/**
 * The listing-search MCP server's Server Card (src/app/api/mcp/search/server-card/route.ts serves it; its header says
 * why it exists). Here, not in the route file: a Next route module may export only its handlers and config.
 * ⛔ Every field is true of src/app/api/mcp/search/route.ts; search/server-card/server-card.test.ts pins the protocol
 * versions and the version against its initialize, and the name against the site-wide card's `mcpServers` key.
 */
export const SEARCH_CARD_TYPE = 'application/mcp-server-card+json'

const RDNS = SITE_NAME.split('.').reverse().join('.')

export function searchServerCard() {
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
    // The same key the site-wide card's `mcpServers` map gives this server.
    name: `${RDNS}/search`,
    version: '1.0.0',
    // ⚠️ 100 characters at most (the card schema).
    description: 'Search live listings: housing, vehicles, jobs, services and second-hand goods. No sign-in.',
    title: `${SITE_NAME} Search`,
    websiteUrl: `${OAUTH_ISSUER}/developers/mcp#search`,
    // The same icon the server's initialize names (serverInfo.icons, MCP 2025-11-25 Implementation shape).
    icons: [{ src: `${OAUTH_ISSUER}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] }],
    remotes: [
      {
        type: 'streamable-http',
        url: `${OAUTH_ISSUER}/api/mcp/search`,
        supportedProtocolVersions: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'],
      },
    ],
  }
}

/** True when `accept` names the card type with q > 0 (a `;q=0` anywhere in that entry's parameters refuses it). */
export function acceptsCardType(accept: string): boolean {
  return accept.split(',').some((part) => {
    const [media, ...params] = part.split(';').map((p) => p.trim().toLowerCase())
    if (media !== SEARCH_CARD_TYPE) return false
    const q = params.find((p) => p.startsWith('q='))
    return q === undefined || Number(q.slice(2)) > 0
  })
}
