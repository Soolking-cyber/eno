import { chatgptFeedBody } from '@/lib/chatgpt-feed-body'
import { logError } from '@/lib/log'

function feedResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/jsonl; charset=utf-8',
      'Content-Disposition': 'inline; filename="eno-chatgpt-products.jsonl"',
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': 'noindex',
    },
  })
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * ── GET /api/feeds/chatgpt — eno's product feed for ChatGPT (Business Hub › Products › hosted URL; owner 2026-11-24).
 * JSON Lines in OpenAI's product feed schema (src/lib/chatgpt-feed.ts maps each row). The selection is the Google
 * Shopping feed's, clause for clause (src/app/api/feeds/google-shopping/route.ts says why each one is there), plus the
 * shop's public name and id for seller_name / seller_url — never its phone or email.
 * ⚠️ OPEN, UNLIKE THE GOOGLE AND META FEEDS: OpenAI's hosted-URL fetch takes no credentials ("Product and image URLs must
 * be publicly accessible"), and every row is a public listing page already. The built body is kept an hour per process
 * (below), so an open endpoint never turns into a full-catalogue read per request.
 */
export async function GET(req: Request) {
  try {
    // Placeholder (seed) images are left out unless explicitly asked for (?exclude_mock=0).
    const excludeMock = new URL(req.url).searchParams.get('exclude_mock') !== '0'
    const body = await chatgptFeedBody(excludeMock)
    // An empty feed is an outage, never a catalogue (the .jsonl.gz route says why).
    if (!body) return new Response(JSON.stringify({ error: 'feed_empty' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' } })
    return feedResponse(body)
  } catch (e) {
    logError(e, { op: 'feeds.chatgpt' })
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
