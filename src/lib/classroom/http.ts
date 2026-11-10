import 'server-only'
import { ApiError } from '@/lib/api/handler'
import { readBytesCapped } from '@/lib/api/body'

// The capped byte reader moved to src/lib/api/body.ts when route() started capping every JSON body; re-exported for
// the classroom routes that read raw audio and images through it.
export { readBytesCapped }

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
