import { route, ApiError } from '@/lib/api/handler'
import { KYC_IMAGE_KINDS, KYC_MAX_INTAKE_BYTES, KycImageError, type KycImageKind } from '@/lib/kyc/image'
import { storeKycImage } from '@/lib/kyc/store'
import { hasLiveChallenge } from '@/lib/identity/challenge'
import { db } from '@/lib/db'
import { writeTombstones } from '@/lib/core/storage-tombstones'
import { BUSINESS_VERIFICATION_BUCKET } from '@/lib/supabase-admin'
import { logError } from '@/lib/log'

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
    /**
     * ⛔ CONSENT BEFORE COLLECTION — THE FIRST THING THIS ROUTE ASKS, BEFORE IT READS A SINGLE BYTE.
     * A live challenge exists only because the person affirmed the declaration to get one (see the
     * challenge route), so this single check is also the consent check. Until it was added, this
     * endpoint accepted identity documents from anyone with a session: someone who photographed
     * their passport and then closed the tab left those images in our private bucket with no record
     * of permission to hold them. Both plan reviewers found it independently, and under the PDPL
     * the consent has to precede the COLLECTION, not the submission.
     * ⚠️ 403, NOT 401. The caller IS authenticated; what they lack is a started, un-expired
     * verification attempt — a different problem with a different fix (go back and start again).
     */
    if (!(await hasLiveChallenge(userId))) throw new ApiError('forbidden', 403)

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
      /**
       * ⛔ THE CAPTURE IS TRACKED FROM THE MOMENT IT EXISTS, NOT FROM THE MOMENT IT IS SUBMITTED.
       * This route stores a passport photograph and a selfie; the `IdentityVerification` row that
       * points at them is only written when the applicant finishes the form two steps later. Anyone
       * who photographs their document and then closes the tab therefore left those images in the
       * private bucket with NOTHING referencing them — and both erasure and retention are
       * row-driven, so nothing would ever look for them again. Measured as the gap it is: no row,
       * no reference, no expiry.
       *
       * An intent tombstone is the missing reference. The sweep re-checks the surviving rows before
       * it deletes anything, so a capture that IS submitted is found in the evidence and its
       * tombstone is dropped; one that is abandoned is removed. This is the same shape the visa
       * uploads already use (`visa_upload_intent`).
       *
       * ⚠️ BEST-EFFORT, AND THE UPLOAD STILL SUCCEEDS IF IT FAILS. Refusing a capture because its
       * cleanup record could not be written would break verification for a storage-queue problem
       * that is ours, not the applicant's — and the erasure prefix walk is the backstop.
       */
      /**
       * ⚠️ A DAY OF GRACE, NOT THE DEFAULT HOUR. The sweep reads "no IdentityVerification row points
       * at this yet" as abandoned, and the default hour is only safe if nobody can still be filling
       * the form after it. The challenge does expire in ten minutes, so in principle they cannot —
       * but the cost of being wrong is an applicant's passport photo deleted mid-flow, surfacing to
       * a reviewer as a missing object after four 201s, and the cost of being generous is an
       * abandoned capture living one extra day in a bucket the sweep will empty anyway (external
       * review). `writeTombstones` derives notBefore from this instant plus its own hour.
       */
      const KYC_INTENT_GRACE_MS = 23 * 60 * 60 * 1000
      await writeTombstones(
        db,
        [{ bucket: BUSINESS_VERIFICATION_BUCKET, path: stored.path }],
        'kyc_capture_intent',
        new Date(Date.now() + KYC_INTENT_GRACE_MS),
      ).catch((e) => logError(e, { op: 'kyc.capture-intent' }))
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
