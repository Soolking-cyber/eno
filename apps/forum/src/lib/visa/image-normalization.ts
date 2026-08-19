// ⚠️ `import type { Metadata }`, not `Metadata`. sharp 0.35 (taken for the libvips CVEs
// CVE-2026-33327/33328/35590/35591) stopped exposing its types as a NAMESPACE on the default
// export, so the old `Metadata` stopped resolving and the production build failed with
// "Cannot find namespace 'sharp'" — tsc caught it, vitest did not, because no test imports this.
import sharp, { type Metadata } from 'sharp'

// ⚠️ BUMPED WITH THE RULES, NOT WITH THE FILE. This string is stamped into every stored
// `validation_report`, so it is the only way to tell whether a report was produced under the old
// floors (480×600 portrait / 600×900 passport, no AVIF or TIFF, no downscale fallback) or the
// relaxed ones. Leaving it at the July value would have made two genuinely different admission
// policies indistinguishable in the audit trail. Raised by a reviewer.
export const VISA_IMAGE_RULES_VERSION = 'evisa-images-2026-08-19'
export type VisaImageKind = 'portrait' | 'passport' | 'supporting'

const OFFICIAL_MAX_BYTES = 1_900_000
export const MAX_INTAKE_BYTES = 25 * 1024 * 1024

/**
 * THE UPLOAD FLOOR — EXPORTED SO THE APPLICANT IS TOLD THE SAME NUMBER THE SERVER ENFORCES.
 *
 * These were inline literals, and the applicant met them only as the refusal
 * `portrait_resolution_too_low` AFTER choosing a file. Owner, 2026-08-19: *"make these less
 * restrictive on upload image too small etc errors, also have clear dimension sample mock images
 * and accepted formats — user shouldnt have any difficulty uploading necessary images"*. A number
 * the UI can render before the picker opens has to be readable from one place, or the guidance and
 * the gate drift the first time either moves.
 *
 * ⚠️ RELAXING THIS IS AN UPLOAD-LAYER CHANGE AND NOTHING MORE. The seven blocking content checks in
 * image-quality.ts are untouched and must stay untouched: /vietnam-evisa/rejected publicly promises
 * we run them, and they are the only thing standing between an applicant and a non-refundable
 * government fee for an application the department will refuse. See the standing note in
 * eno-launch-lenience — lenience applies to gates protecting OUR norms, never to a gate we told
 * customers we run on their behalf against a THIRD PARTY's rules.
 *
 * ⚠️ PORTRAIT IS THE LOOSEST BECAUSE THE PIPELINE ALREADY UPSCALES IT. `withoutEnlargement` is
 * false for portraits — every portrait is resized to exactly 800×1200 — so the old 480×600 floor
 * rejected inputs the pipeline was going to enlarge anyway. codex refuted the tidy version of this
 * rationale and was right: upscaling creates pixels, not detail, so a 300×400 portrait can still
 * fail `clearImage` downstream. The trade is deliberate — a specific, fixable "the photo is blurry"
 * beats an opaque "too small" that names no remedy.
 *
 * ⚠️ THE TEST IS READABILITY, NOT SIZE — AND THAT IS WHY THESE NUMBERS ARE SO LOW. Owner,
 * 2026-08-19: *"as long as its readable passport photo accept it and image size format correct
 * accept"*. So this is deliberately NOT a quality bar. A dimension check cannot tell whether an
 * image is readable; it only guesses, and every guess it gets wrong refuses an applicant a document
 * the reader would in fact have read. The thing that actually knows is the reader — the MRZ
 * extraction and the AI checks, both of which already return a specific, fixable message
 * (`passport_mrz_unreadable`: "make both machine-readable lines sharp"). So the floor's only job
 * now is to reject input that cannot be an attempt at a document at all, and to stop us spending a
 * Gemini call on it.
 *
 * codex asked for empirical OCR evidence before lowering the passport floor. It was right that
 * arithmetic is not measurement — an ICAO data page is ~125×88 mm with MRZ glyphs ~3.1 mm tall, so
 * a 480 px long edge puts ~12 px per character, which should read but has not been tested against
 * real passports. The owner's instruction resolves that tension in the safe direction: when the
 * calculation is uncertain, the reader adjudicates rather than the ruler, and a wrong guess here
 * costs a retry with an actionable message instead of a refusal with none.
 */
export const VISA_MIN_DIMENSIONS: Record<VisaImageKind, { short: number; long: number }> = {
  portrait: { short: 240, long: 320 },
  passport: { short: 320, long: 480 },
  supporting: { short: 120, long: 120 },
}

function orientedDimensions(metadata: Metadata) {
  const rotated = metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8
  return {
    width: rotated ? metadata.height : metadata.width,
    height: rotated ? metadata.width : metadata.height,
  }
}

export async function normalizeVisaImage(input: Buffer, kind: VisaImageKind) {
  if (!input.length || input.length > MAX_INTAKE_BYTES) throw new Error('image_size_invalid')
  let metadata: Metadata
  try {
    metadata = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata()
  } catch {
    throw new Error('image_decode_failed')
  }
  if (!metadata.width || !metadata.height || (metadata.pages || 1) !== 1) throw new Error('image_dimensions_invalid')
  const oriented = orientedDimensions(metadata)
  if (!oriented.width || !oriented.height) throw new Error('image_dimensions_invalid')
  const shortEdge = Math.min(oriented.width, oriented.height)
  const longEdge = Math.max(oriented.width, oriented.height)
  const floor = VISA_MIN_DIMENSIONS[kind]
  if (shortEdge < floor.short || longEdge < floor.long) {
    if (kind === 'portrait') throw new Error('portrait_resolution_too_low')
    if (kind === 'passport') throw new Error('passport_resolution_too_low')
    throw new Error('image_dimensions_invalid')
  }

  const corrections = ['converted_to_jpeg', 'removed_embedded_metadata', 'white_background_applied']
  if ((metadata.orientation || 1) !== 1) corrections.push('orientation_corrected')
  if (kind === 'portrait') corrections.push('formatted_to_4x6_portrait')
  const target = kind === 'portrait'
    ? { width: 800, height: 1200, fit: 'contain' as const }
    : { width: 2400, height: 2400, fit: 'inside' as const }
  if (oriented.width > target.width || oriented.height > target.height || kind === 'portrait') corrections.push('resized_for_official_upload')

  const image = sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' })
    .rotate()
    .flatten({ background: '#fff' })
  let quality = 90
  let output = await image
    .resize({ ...target, background: '#fff', withoutEnlargement: kind !== 'portrait' })
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer()
  while (output.length >= OFFICIAL_MAX_BYTES && quality > 58) {
    quality -= 6
    output = await sharp(output).jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer()
  }
  /**
   * ⛔ DOWNSCALE BEFORE GIVING UP — `image_official_limit_failed` WAS AN ERROR THE APPLICANT COULD
   * NOT ACT ON. The quality ladder above stops at 58, and if the file is still ≥ 1.9 MB the upload
   * was refused with "the image could not be reduced below the official 2 MB limit" — true, and
   * useless: nothing in that sentence tells someone holding a phone what to do differently. A noisy
   * high-resolution scan is exactly the input that hits it, and it is not a bad document.
   *
   * Shrinking the longest edge fixes what the quality ladder cannot, because file size falls with
   * AREA. Each pass costs one more encode of an already-small image, so the loop is cheap.
   *
   * ⚠️ IT STOPS AT THE KIND'S OWN FLOOR, which is the guard codex asked for. Without a floor this
   * would happily shrink a passport until the MRZ was unreadable and then report success — trading
   * a refusal the applicant can see for a silent extraction failure they cannot. Reaching the floor
   * still ends in the original refusal, so the worst case is unchanged.
   */
  if (output.length >= OFFICIAL_MAX_BYTES) {
    /**
     * ⚠️ THE BOX IS SQUARE BUT THE IMAGE IS NOT, AND BOTH REVIEWERS CAUGHT ME ON IT.
     *
     * `fit: 'inside'` scales the LONGEST edge to the box, so bounding by
     * `max(floor.long, floor.short)` does not bound the short edge at all: an 800×1200 portrait
     * resized inside 320×320 comes out 213×320, under the 240 short-edge floor — while still
     * reporting `downscaled_for_official_limit` as though it had respected it. That is precisely
     * the failure the floor exists to prevent, so the loop now measures the ACTUAL dimensions each
     * pass and never takes a step that would breach either edge.
     */
    const floor = VISA_MIN_DIMENSIONS[kind]
    let current = await sharp(output).metadata()
    while (output.length >= OFFICIAL_MAX_BYTES) {
      const shortNow = Math.min(current.width || 0, current.height || 0)
      const longNow = Math.max(current.width || 0, current.height || 0)
      if (shortNow <= floor.short || longNow <= floor.long) break
      // The gentlest step is 20%; if 20% would cross a floor, take the smaller step that lands
      // exactly ON it instead, so the last attempt still happens at the smallest legal size.
      const scale = Math.max(0.8, floor.short / shortNow, floor.long / longNow)
      // ⚠️ `ceil`, NOT `round`. The step is chosen so that scaling the long edge leaves the short
      // edge exactly ON its floor; rounding DOWN would put it a pixel under, which is the whole
      // class of bug this loop was rewritten to fix. Rounding up can only overshoot upward, which
      // is safe.
      const nextLong = Math.max(floor.long, Math.ceil(longNow * scale))
      // ⚠️ And if a step cannot actually shrink the image, stop rather than iterate forever. With
      // integer pixels and scale < 1 this is unreachable, but "unreachable" is doing load-bearing
      // work in a `while` loop that re-encodes a 4-megapixel image each pass — so it is asserted
      // rather than argued.
      if (nextLong >= longNow) break
      output = await sharp(output)
        .resize({ width: nextLong, height: nextLong, fit: 'inside', withoutEnlargement: true })
        // ⚠️ `quality`, NOT A HIGHER LITERAL. This re-encoded at 72 while the ladder above had
        // already walked down to 58, so every downscale pass RAISED bytes-per-pixel and partly
        // undid the area reduction it had just paid for — reaching the dimension floor still over
        // the limit, and failing, on images that would have fitted. Flagged twice by the same
        // reviewer before I acted on it; the ladder's final quality is the correct carry-forward.
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer()
      current = await sharp(output).metadata()
    }
    if (output.length < OFFICIAL_MAX_BYTES) corrections.push('downscaled_for_official_limit')
  }
  if (output.length >= OFFICIAL_MAX_BYTES) throw new Error('image_official_limit_failed')
  if (input.length >= OFFICIAL_MAX_BYTES || quality < 90) corrections.push('compressed_below_2mb')
  const normalized = await sharp(output).metadata()
  return {
    output,
    width: normalized.width || null,
    height: normalized.height || null,
    report: {
      version: VISA_IMAGE_RULES_VERSION,
      kind,
      issues: [] as string[],
      corrections: [...new Set(corrections)],
      source: { format: metadata.format || 'unknown', sizeBytes: input.length, width: oriented.width, height: oriented.height },
      normalized: { format: 'jpeg', sizeBytes: output.length, width: normalized.width || null, height: normalized.height || null },
      technicalChecks: { decoded: true, singleImage: true, minimumResolution: true, jpeg: true, belowTwoMegabytes: true },
    },
  }
}
