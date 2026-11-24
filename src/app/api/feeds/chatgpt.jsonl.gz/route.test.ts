import { gunzipSync } from 'zlib'
import { describe, expect, it, vi } from 'vitest'

/** /api/feeds/chatgpt.jsonl.gz is the plain feed, gzipped as a FILE (ChatGPT's hosted URL takes .jsonl.gz, not .jsonl). */
vi.mock('server-only', () => ({}))
const BODY = '{"item_id":"a","price":"1000 VND"}\n{"item_id":"b","price":"2000 VND"}\n'
const h = vi.hoisted(() => ({ body: '' }))
vi.mock('@/lib/chatgpt-feed-body', () => ({ chatgptFeedBody: async () => h.body }))
const { GET } = await import('./route')

describe('GET /api/feeds/chatgpt.jsonl.gz', () => {
  it('answers the feed as gzip bytes that decompress to the exact JSON Lines body', async () => {
    h.body = BODY
    const r = await GET()
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/gzip')
    expect(r.headers.get('content-encoding')).toBeNull()
    expect(r.headers.get('cache-control')).toContain('no-transform')
    const bytes = Buffer.from(await r.arrayBuffer())
    expect(bytes[0]).toBe(0x1f)
    expect(bytes[1]).toBe(0x8b)
    expect(gunzipSync(bytes).toString('utf8')).toBe(BODY)
  })

  it('⛔ an empty feed is a 503 (ChatGPT keeps its last copy), never a 200 that empties the catalogue', async () => {
    h.body = ''
    const r = await GET()
    expect(r.status).toBe(503)
  })
})
