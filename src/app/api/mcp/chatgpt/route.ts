// The ChatGPT app's address: the same MCP server, without the tools that price or sell an ad (owner, 2026-11-26). The
// handlers tell the two addresses apart by path (../route.ts, Surface); the why is there.
export { POST, GET, OPTIONS } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
