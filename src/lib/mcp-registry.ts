/**
 * The official MCP Registry record of eno.vn's hosted MCP server — the DNS-verified `vn.eno` namespace, published
 * 2026-11-11 (memory: eno-agent-readiness-2026-11-11). Linked from /developers/mcp and llms.txt so an agent or a
 * scanner can tie the registry entry to this site (ora.ai asks for exactly that, 2026-11-15).
 * ⛔ eno.vn's only: the forum edition prints no registry line (callers check `IS_SERVICES`).
 */
/** ONE server since 2026-11-23 (owner: "make all into 1 … name something neutral like eno agentic commerce tools"): /api/mcp
 *  serves the search, shop, chat, ad and docs tools as "eno Agentic Commerce". Its registry record is a NEW name, because a
 *  registry name cannot be renamed; vn.eno/partner-api and vn.eno/search are marked deprecated there. ⏳ Until vn.eno/commerce
 *  is published, its exact-record URL answers 404 — publish it in the same hour as the deploy that links it. */
export const MCP_SERVER_TITLE = 'eno Agentic Commerce'
export const MCP_REGISTRY_NAME = 'vn.eno/commerce'
/** The two records the one server replaces (deprecated in the registry, kept here for the pages that name the history). */
export const MCP_LEGACY_REGISTRY_NAMES = ['vn.eno/partner-api', 'vn.eno/search'] as const
/** The EXACT record, never a search: `?search=` matches any name containing the string, so a DNS-verified
 * `com.foo.vn.eno/partner-api` would be listed beside ours under a link that says "the official entry" (commit gate,
 * opus). Measured 2026-11-15: this URL answers 200 with the vn.eno/partner-api record. */
export const MCP_REGISTRY_URL = `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(MCP_REGISTRY_NAME)}/versions/latest`

/**
 * The npm package of the MCP servers (packages/eno-vn-mcp — its package.json name and mcpName, held together by
 * src/lib/eno-vn-mcp.test.ts and mcp-page.test.ts). Linked from the ENTRY POINTS agents and scanners read — llms.txt,
 * /agents.md, /developers — not only from /developers/mcp (owner 2026-11-17, "the next one that affects the score the
 * most": ora's mcp-registry-listed asks to "link the registry entry or package from your homepage or docs").
 */
export const MCP_NPM_PACKAGE = 'eno-vn-mcp'
export const MCP_NPM_URL = `https://www.npmjs.com/package/${MCP_NPM_PACKAGE}`
