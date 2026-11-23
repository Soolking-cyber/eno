import { logError } from '@/lib/log'

/** A request body as text, or null once it passes `max` bytes: counted while streaming, so an oversized body is dropped as
 *  soon as it crosses the line, whatever Content-Length claims (or when there is none). The same reader the search and docs
 *  routes carry (2026-11-13), shared here for /api/mcp's calls without a credential (2026-11-23, one server). */
export async function readCapped(req: Request, max: number, op: string): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > max) return null
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) { await reader.cancel().catch((e) => logError(e, { op })); return null }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { all.set(c, at); at += c.byteLength }
  return new TextDecoder().decode(all)
}
