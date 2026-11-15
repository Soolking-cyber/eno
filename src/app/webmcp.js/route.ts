import { searchToolDescriptors } from '@/app/api/mcp/search/tools'
import { buildWebmcpScript, WEBMCP_HEADERS } from '@/lib/webmcp-script'

// Built once per deploy (the descriptors are code), refreshed daily like /llms.txt. Nothing here is per-visitor.
export const revalidate = 86400

/**
 * /webmcp.js — the public search tools for a browser agent, written out as literal `registerTool` calls. Why this shape,
 * and everything the script promises: src/lib/webmcp-script.ts. Loaded by `<script src="/webmcp.js" async>` in the
 * [lang] layout; proxy.ts's matcher skips dotted paths, so it is not rewritten to /en or /vi.
 */
export function GET() {
  return new Response(buildWebmcpScript(searchToolDescriptors()), { headers: WEBMCP_HEADERS })
}
