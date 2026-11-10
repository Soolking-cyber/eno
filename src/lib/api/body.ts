import 'server-only'
import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/api/api-error'
import { logWarn } from '@/lib/log'

/**
 * ⛔ THE CEILING ON A JSON REQUEST BODY, 64 KB, unless a route passes its own. Without one, Next hands a route up to
 * 10 MB (proxyClientMaxBodySize, because /api/* runs through src/proxy.ts) and `req.json()` parses all of it: ~0.5-0.75 s
 * and ~110 MB per request before any limiter, and through a zod array schema several seconds and gigabytes of issues
 * (audit appsec-02, 2026-11). Every real body is far smaller; a route whose largest real body is over 16 KB passes a cap
 * of at least four times that.
 */
export const JSON_BODY_CAP = 64 * 1024

/** The raw bytes of a body, read only up to `max`: 413 `payload_too_large` past it, by its label or as it streams in. */
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
      // ⚠️ NOT AWAITED: a cancel that never settles (a stream whose other reader is still open) must not hold the 413 back.
      const failed = (e: unknown) => logWarn('[api] body cancel failed', { name: (e as Error)?.name ?? null })
      try { void reader.cancel().catch(failed) } catch (e) { failed(e) }
      throw new ApiError('payload_too_large', 413)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/**
 * `req.json()` with a ceiling: 413 `payload_too_large` past `max` (nothing is parsed), 400 `bad_request` for a missing
 * body or anything that is not JSON. Any JSON value comes back, `null` and arrays included, exactly as `req.json()`
 * returns them. Decoded the way `req.json()` decodes: UTF-8, a leading byte-order mark dropped.
 */
export async function readJsonCapped<T = unknown>(req: Request, max: number = JSON_BODY_CAP): Promise<T> {
  const bytes = await readBytesCapped(req, max)
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    throw new ApiError('bad_request', 400)
  }
}

/**
 * For a handler outside route()'s catch: the 413 `{"error":"payload_too_large"}` when `e` is the size refusal from the
 * readers above, else null (the handler then answers its own malformed-body response). `headers` is for a route whose
 * every answer carries a header (the handoff and native-session routes' no-store), so its 413 does too.
 */
export function bodyTooLarge(e: unknown, headers?: HeadersInit): NextResponse | null {
  return e instanceof ApiError && e.status === 413 ? NextResponse.json({ error: 'payload_too_large' }, { status: 413, headers }) : null
}
