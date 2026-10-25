import 'server-only'
import { ApiError } from '@/lib/api/handler'
import { logWarn } from '@/lib/log'

/** The raw bytes of a body, read only up to `max` (the bio route's rule: nothing unbounded is read before a limit). */
export async function readBytesCapped(req: Request, max: number): Promise<Buffer> {
  if (Number(req.headers.get('content-length') || 0) > max) throw new ApiError('payload_too_large', 413)
  const reader = req.body?.getReader()
  if (!reader) throw new ApiError('bad_request', 400)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      // The body is refused anyway; a cancel that fails changes nothing for the caller.
      await reader.cancel().catch((e) => logWarn('[classroom] body cancel failed', { name: (e as Error)?.name ?? null }))
      throw new ApiError('payload_too_large', 413)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** A JSON object body, capped: 413 past the cap, 400 for anything but a JSON object. */
export async function readCapped(req: Request, max: number): Promise<Record<string, unknown>> {
  const bytes = await readBytesCapped(req, max)
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new ApiError('bad_request', 400)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ApiError('bad_request', 400)
  return parsed as Record<string, unknown>
}
