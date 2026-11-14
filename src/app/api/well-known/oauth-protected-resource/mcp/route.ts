import { protectedResourceResponse } from '@/lib/api/protected-resource'

// The MCP server's RFC 9728 document (resource = MCP_RESOURCE), served at /.well-known/oauth-protected-resource/api/mcp
// by a next.config rewrite to THIS PATH — see src/lib/api/protected-resource.ts for why it is a path and not a query.
export const runtime = 'nodejs'

export async function GET() {
  return protectedResourceResponse('mcp')
}
