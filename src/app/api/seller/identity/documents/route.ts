import { route, ApiError } from '@/lib/api/handler'
import { KYC_IMAGE_KINDS, KYC_MAX_INTAKE_BYTES, KycImageError, type KycImageKind } from '@/lib/kyc/image'
import { storeKycImage } from '@/lib/kyc/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS: readonly KycImageKind[] = KYC_IMAGE_KINDS



// One KYC capture: the passport data page, or the selfie holding it with the challenge code.
//
// ⚠️ THE content-length CHECK IS AN OPTIMISATION, NOT A GUARANTEE, AND THE COMMENT HERE USED TO
// CLAIM OTHERWISE. It said the guard "runs BEFORE arrayBuffer()" so an oversized body never lands
// in memory — true only when the client SENDS a content-length. A chunked request has none,
// `Number(null || 0)` is 0, and the body is fully buffered before the real check refuses it. Two
// external reviewers caught the false claim independently.
//
// What actually bounds this today: Cloud Run caps a request body well below anything dangerous, the
// route is `auth: 'userId'`, and the limiter is 30/hour STRICT. So the exposure is a signed-in
// seller buffering a platform-capped body 30 times an hour — bounded, not closed.
// ⚠️ TO CLOSE IT, read `req.body` as a stream and abort past the ceiling rather than calling
// arrayBuffer(). Not done here because it is a behaviour change on the upload path with no e2e
// covering it; tracked rather than half-done.
//
// ⛔ NO MIME SNIFF HERE, AND THAT IS NOT A GAP. normalizeKycImage DECODES the bytes with sharp: a
// file that is not really an image cannot survive a decode-and-re-encode, which is a stronger check
// than reading magic bytes and trusting the rest of the file.
export const POST = route(
  { auth: 'userId', rateLimit: { bucket: 'identity-documents', limit: 30, window: '1 h', strict: true } },
  async ({ req, userId }) => {
    const url = new URL(req.url)
    const kind = url.searchParams.get('kind') as KycImageKind | null
    if (!kind || !KINDS.includes(kind)) throw new ApiError('invalid_body', 400)

    const declared = Number(req.headers.get('content-length') || 0)
    if (declared > KYC_MAX_INTAKE_BYTES) throw new ApiError('file_too_large', 413)

    const bytes = Buffer.from(await req.arrayBuffer())
    // content-length is a claim; the real length is authoritative.
    if (!bytes.length || bytes.length > KYC_MAX_INTAKE_BYTES) throw new ApiError('file_too_large', 413)

    try {
      const stored = await storeKycImage({ profileId: userId, kind, bytes })
      if (!stored) throw new ApiError('internal_error', 503)
      // ⛔ THE PATH GOES BACK, THE URL DOES NOT. This is a private bucket; handing the client a
      // readable link would make a passport photo fetchable by anyone who saw the response.
      return Response.json(
        { path: stored.path, width: stored.width, height: stored.height, sha256: stored.sha256 },
        { status: 201, headers: { 'cache-control': 'no-store' } },
      )
    } catch (e) {
      // The image pipeline's codes are seller-facing and actionable ("retake it closer") — pass
      // them through rather than flattening everything to a generic failure.
      // ⚠️ NARROWED, NOT CAST. `as never` here would let any string the pipeline invents onto the
      // wire, where the client cannot narrow it — errors.ts exists to stop exactly that. An
      // unrecognised code degrades to a generic 422 rather than leaking an unhandled string.
      // ⚠️ SPELLED OUT, ONE THROW PER CASE WITH THE CODE AS A LITERAL, AND THAT IS NOT STYLE. Two
      // shorter versions failed before this: passing the pipeline's code through apiErrorCode(),
      // then a lookup map. errors.test.ts harvests the wire by TEXT-SCANNING routes for three
      // literal forms, so a code reaching the error constructor through a variable is invisible to
      // it and looks unemitted — which that file warns about in as many words. (It then caught a
      // second one: an earlier draft of THIS comment quoted a fake call with a placeholder code,
      // and the scan harvested the placeholder as a real code. Never write one in prose here.)
      // It also reads better: this is the one place you can see which retake each failure asks for.
      if (e instanceof KycImageError) {
        switch (e.code) {
          // Too big or empty before we even decoded it.
          case 'image_size_invalid': throw new ApiError('image_size_invalid', 422)
          // Not an image, or an encoding sharp cannot read.
          case 'image_decode_failed': throw new ApiError('image_decode_failed', 422)
          // Multi-page, or zero-dimension.
          case 'image_dimensions_invalid': throw new ApiError('image_dimensions_invalid', 422)
          // The actionable one: legible to a phone, not to a reviewer. "Move closer, hold it steady."
          case 'image_too_small_to_review': throw new ApiError('image_too_small_to_review', 422)
          // Could not be squeezed under the 1.9 MB ceiling even after downscaling.
          case 'image_official_limit_failed': throw new ApiError('image_official_limit_failed', 422)
          default: throw new ApiError('invalid_body', 422)
        }
      }
      throw e
    }
  },
)
