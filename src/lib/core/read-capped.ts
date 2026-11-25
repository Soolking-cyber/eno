import { logError } from '@/lib/log'

/**
 * A response body read up to `max` bytes, or null past it (or with no body). The declared length refuses early; the
 * stream is counted as it arrives, so a body that lies about its length is cut off at the cap, never buffered whole.
 * Every server-side fetch of a URL someone else chose reads through this (core/bulk.ts re-hosting, the ad review).
 */
export async function readCapped(res: Response, max: number, op = 'read-capped.cancel'): Promise<Buffer | null> {
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > max) { await res.body?.cancel().catch((e) => logError(e, { op })); return null }
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) { await reader.cancel().catch((e) => logError(e, { op })); return null }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/**
 * The FIRST `max` bytes of a response body, then the stream is cancelled — for reading a page's <head> (the ad review's
 * landing page, ≤ 256 KB) where the rest of a long page does not matter. Null only when there is no body.
 */
export async function readPrefix(res: Response, max: number, op = 'read-prefix.cancel'): Promise<Buffer | null> {
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < max) {
    const { done, value } = await reader.read()
    if (done) return Buffer.concat(chunks)
    chunks.push(value.byteLength > max - total ? value.subarray(0, max - total) : value)
    total += value.byteLength
  }
  await reader.cancel().catch((e) => logError(e, { op }))
  return Buffer.concat(chunks)
}
