import { protectedResourceResponse } from '@/lib/api/protected-resource'

// The ChatGPT app's address of the MCP server (RFC 9728 §3.3: its resource is …/api/mcp/chatgpt), served at
// /.well-known/oauth-protected-resource/api/mcp/chatgpt by a next.config rewrite.
export const runtime = 'nodejs'

export async function GET() {
  return protectedResourceResponse('mcp-chatgpt')
}
