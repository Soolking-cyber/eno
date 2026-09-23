import { listingObjectKey, STORAGE_HOST } from '@/lib/listing-image'

export const runtime = 'nodejs'

// Match Next's source-image size ceiling. Count streamed bytes too: Content-Length is optional
// and cannot be trusted. Never return an upstream error document under an image content type.
const MAX_BYTES = 50_000_000
/** ⛔ TWO DIFFERENT CLOCKS, AND CONFLATING THEM IS WHAT THE FIRST VERSION GOT WRONG. CONNECT_MS
 *  bounds the upstream handshake; IDLE_MS bounds the gap BETWEEN chunks once a body is flowing.
 *  An absolute budget cannot do both: it either kills slow-but-healthy transfers (a multi-MB
 *  original over a VN mobile link, since the pull-driven body makes upstream read speed the
 *  CONSUMER's speed) or, raised high enough not to, stops bounding a stalled socket at all. */
const CONNECT_MS = 5000
const IDLE_MS = 15_000
const RASTER_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/avif', 'image/gif'])

function failure(status: number): Response {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** Public raster objects ONLY. This is outside /api so an internal optimizer read does not
 * require the Cloudflare edge header. No session, credentials, client headers, arbitrary target
 * URL, redirect following, or private-bucket access is allowed here. */
export async function GET(request: Request): Promise<Response> {
  // Next reconstructs query strings (including encoding '/'), so validate the decoded KEY,
  // not its transport encoding. This read-only endpoint never stores an aliased source URL.
  const entries = [...new URL(request.url).searchParams]
  const key = entries.length === 1 && entries[0][0] === 'key' ? entries[0][1] : ''
  if (!key || key.length > 2048) return failure(400)
  const object = listingObjectKey(`${STORAGE_HOST}/storage/v1/object/public/listings/${key}`)
  if (!object || object.bucket !== 'listings') return failure(400)

  // Runtime-only, set for BOTH deployment containers. Local previews continue to use the
  // canonical public origin. The flag selects one fixed service, never a caller-supplied host.
  const origin = process.env.LISTING_IMAGES_INTERNAL === 'true'
    ? 'http://supabase-envoy:8000'
    : STORAGE_HOST
  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), CONNECT_MS)
  let idle: ReturnType<typeof setTimeout> | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let streaming = false
  const cleanup = () => {
    clearTimeout(deadline)
    clearTimeout(idle)
    controller.abort()
    void reader?.cancel().catch(() => {})
  }
  try {
    const upstream = await fetch(`${origin}/storage/v1/object/public/listings/${object.key}`, {
      redirect: 'manual', cache: 'no-store', signal: controller.signal,
    })
    if (upstream.status !== 200) {
      await upstream.body?.cancel()
      return failure(upstream.status === 404 ? 404 : 502)
    }
    const type = upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
    if (!RASTER_TYPES.has(type) || Number(upstream.headers.get('content-length')) > MAX_BYTES) {
      await upstream.body?.cancel()
      return failure(502)
    }
    reader = upstream.body?.getReader()
    if (!reader) return failure(502)
    const first = await reader.read()
    if (first.done || !first.value.byteLength || first.value.byteLength > MAX_BYTES) return failure(502)
    let size = first.value.byteLength
    const source = reader
    const body = new ReadableStream<Uint8Array>({
      start(stream) { stream.enqueue(first.value) },
      async pull(stream) {
        try {
          // Armed around the read, not around the response: a chunk resets it, so a transfer that
          // keeps making progress is never cut off, while an upstream that goes quiet is.
          idle = setTimeout(() => controller.abort(), IDLE_MS)
          const { done, value } = await source.read()
          clearTimeout(idle)
          if (done) { stream.close(); cleanup(); return }
          size += value.byteLength
          if (size > MAX_BYTES) throw new Error('Image response exceeds size limit')
          stream.enqueue(value)
        } catch (error) {
          stream.error(error)
          cleanup()
        }
      },
      cancel() { cleanup() },
    })
    // ⛔ THE DEADLINE COVERS THE HANDSHAKE, NOT THE TRANSFER — CLEAR IT HERE, and both reviewers
    // caught that it was not. Armed before `fetch`, it was only ever cleared inside `cleanup()`,
    // which runs at EOF/error/cancel. Because the body is pull-driven, upstream read speed IS the
    // consumer's speed, so any response still streaming at 5.000s was aborted MID-BODY — after a
    // 200 and its headers had already flushed, so the client saw a truncated image and no error.
    // That made MAX_BYTES unreachable: nothing needing more than 5s of transfer could ever arrive.
    // Past this point the stream owns cancellation (`cleanup()` on close, error and cancel), which
    // is what the abort is actually for.
    clearTimeout(deadline)
    streaming = true
    return new Response(body, { headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=3600',
      'Content-Disposition': 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    } })
  } catch {
    return failure(controller.signal.aborted ? 504 : 502)
  } finally {
    if (!streaming) cleanup()
  }
}
