import { createHash } from 'node:crypto'
import { agentCard } from '@/lib/a2a/agent'

export const runtime = 'nodejs'

/**
 * GET /.well-known/agent-card.json (and the 0.2 name /.well-known/agent.json, by rewrite in next.config.ts): the A2A
 * Agent Card for /api/a2a. §8.6.1: Cache-Control with a max-age and an ETag of the content.
 */
export async function GET(req: Request) {
  const body = JSON.stringify(agentCard())
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
    ETag: etag,
    'Access-Control-Allow-Origin': '*',
  }
  // Weak comparison (RFC 9110 §13.1.2): the edge weakens a strong ETag when it compresses the body (W/"…"), and a
  // client may send a list.
  const tags = (req.headers.get('if-none-match') ?? '').split(',').map((t) => t.trim().replace(/^W\//, ''))
  if (tags.includes(etag) || tags.includes('*')) return new Response(null, { status: 304, headers })
  return new Response(body, { headers })
}
