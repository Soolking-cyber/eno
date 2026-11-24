import { gzipSync } from 'zlib'
import { chatgptFeedBody } from '@/lib/chatgpt-feed-body'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * ── GET /api/feeds/chatgpt.jsonl.gz — the ChatGPT product feed gzipped, at an address ending in .jsonl.gz: the form
 * ChatGPT's Business Hub hosted-URL fetch accepts (".parquet (preferred), .jsonl.gz, .csv.gz, or .tsv.gz"; plain .jsonl is
 * not on its list). Same body as /api/feeds/chatgpt (src/lib/chatgpt-feed-body.ts), compressed once per build.
 * ⚠️ A gzip FILE, not Content-Encoding: the fetcher must receive the .gz bytes, so no proxy may decompress them on the way.
 */
let gz: { body: string; bytes: Buffer } | null = null

export async function GET() {
  try {
    const body = await chatgptFeedBody(true)
    // ⛔ AN EMPTY FEED IS AN OUTAGE, NOT A CATALOGUE: a 200 with no rows would tell ChatGPT eno sells nothing and empty the
    // whole product list. 503 keeps its last good copy until the next fetch.
    if (!body) return new Response(JSON.stringify({ error: 'feed_empty' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' } })
    if (!gz || gz.body !== body) gz = { body, bytes: gzipSync(Buffer.from(body, 'utf8')) }
    return new Response(new Uint8Array(gz.bytes), {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': 'attachment; filename="eno-chatgpt-products.jsonl.gz"',
        'Cache-Control': 'public, max-age=300, no-transform',
        'X-Robots-Tag': 'noindex',
      },
    })
  } catch (e) {
    logError(e, { op: 'feeds.chatgpt.gz' })
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
