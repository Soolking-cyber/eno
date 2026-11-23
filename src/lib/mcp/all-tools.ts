import 'server-only'
import { toolDescriptors } from '@/lib/mcp/tools'
import { searchToolDescriptors } from '@/app/api/mcp/search/tools'
import { docsToolDescriptors } from '@/lib/mcp/docs-tools'

/**
 * Every tool of the one MCP server, eno Agentic Commerce, in the order `tools/list` answers (owner 2026-11-23: "make all
 * into 1"): find first (the search tools, no credential), then the shop, chat and ad tools, then the docs (no credential).
 * The single list /api/mcp's tools/list and the AI catalogue's `capabilities` read, so neither can drift from the other.
 */
export function allToolDescriptors() {
  return [...searchToolDescriptors(), ...toolDescriptors(), ...docsToolDescriptors()]
}
