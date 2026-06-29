import { NextRequest } from 'next/server'
import { resolveApiKey } from '@/lib/api/auth'
import { apiOk, apiError, apiAuthError } from '@/lib/api/respond'
import { storeListingImage, IMG_ALLOWED, IMG_MAX_BYTES } from '@/lib/core/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/v1/media — upload one image (multipart form-data `file`, OR a raw JPEG/PNG/WebP
// request body). Decoded + stripped + re-encoded to WebP and stored first-party; returns a
// URL to put in a listing's images[]. Scope: media:write.
export async function POST(req: NextRequest) {
  const r = await resolveApiKey(req, 'media:write')
  if (!r.ok) return apiAuthError(r)

  const ct = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  let buf: Buffer | null = null

  if (ct.startsWith('multipart/')) {
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (file instanceof File) {
      if (!IMG_ALLOWED.has(file.type) || file.size === 0 || file.size > IMG_MAX_BYTES) {
        return apiError(422, 'invalid_image', 'Image must be JPEG/PNG/WebP and ≤12MB.', r.rate)
      }
      buf = Buffer.from(await file.arrayBuffer())
    }
  } else if (IMG_ALLOWED.has(ct)) {
    const ab = await req.arrayBuffer()
    if (ab.byteLength === 0 || ab.byteLength > IMG_MAX_BYTES) {
      return apiError(422, 'invalid_image', 'Image must be a non-empty JPEG/PNG/WebP ≤12MB.', r.rate)
    }
    buf = Buffer.from(ab)
  }

  if (!buf) return apiError(422, 'invalid_image', 'Send an image as multipart `file` or a raw JPEG/PNG/WebP body.', r.rate)

  const url = await storeListingImage(buf, { pathPrefix: 'api/' })
  if (!url) return apiError(422, 'invalid_image', 'Could not decode/process the image.', r.rate)
  return apiOk({ url }, r.rate)
}
