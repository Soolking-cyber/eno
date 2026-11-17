/**
 * The official MCP Registry record of eno.vn's hosted MCP server — the DNS-verified `vn.eno` namespace, published
 * 2026-11-11 (memory: eno-agent-readiness-2026-11-11). Linked from /developers/mcp and llms.txt so an agent or a
 * scanner can tie the registry entry to this site (ora.ai asks for exactly that, 2026-11-15).
 * ⛔ eno.vn's only: the forum edition prints no registry line (callers check `IS_SERVICES`).
 */
export const MCP_REGISTRY_NAME = 'vn.eno/partner-api'
/** The EXACT record, never a search: `?search=` matches any name containing the string, so a DNS-verified
 * `com.foo.vn.eno/partner-api` would be listed beside ours under a link that says "the official entry" (commit gate,
 * opus). Measured 2026-11-15: this URL answers 200 with the vn.eno/partner-api record. */
export const MCP_REGISTRY_URL = `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(MCP_REGISTRY_NAME)}/versions/latest`

/** The listing search server's record (2026-11-16): it carries the npm package below as its local form (packages[]). */
export const MCP_SEARCH_REGISTRY_NAME = 'vn.eno/search'
export const MCP_SEARCH_REGISTRY_URL = `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(MCP_SEARCH_REGISTRY_NAME)}/versions/latest`
/**
 * The npm package of the MCP servers (packages/eno-vn-mcp — its package.json name and mcpName, held together by
 * src/lib/eno-vn-mcp.test.ts and mcp-page.test.ts). Linked from the ENTRY POINTS agents and scanners read — llms.txt,
 * /agents.md, /developers — not only from /developers/mcp (owner 2026-11-17, "the next one that affects the score the
 * most": ora's mcp-registry-listed asks to "link the registry entry or package from your homepage or docs").
 */
export const MCP_NPM_PACKAGE = 'eno-vn-mcp'
export const MCP_NPM_URL = `https://www.npmjs.com/package/${MCP_NPM_PACKAGE}`
