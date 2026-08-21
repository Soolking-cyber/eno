import 'server-only'
import sharp from 'sharp'
import { MAX_INTAKE_BYTES, normalizeVisaImage, VISA_MIN_DIMENSIONS } from '@/lib/visa/image-normalization'

// ── SELLER KYC IMAGES: A WRAPPER, NEVER A FORK ──────────────────────────────────────────────────
//
// ⛔ THE VISA PIPELINE IS BYTE-LOCKED AND MUST NOT BE EDITED. src/lib/sync-pairs.test.ts:46-49
// couples `visa/image-normalization.ts`, `visa/image-quality.ts` and `visa/mrz.ts` byte-for-byte to
// their apps/forum copies; changing one fails the root suite until both are mirrored. So this
// module IMPORTS them and adds what KYC needs on top. In particular: do NOT add a 'document' or
// 'selfie' member to VisaImageKind — that union is inside the lock.
//
// What is reused, and it is most of the work: HEIC/AVIF decode, EXIF orientation, the single-image
// guard, the 40 MP decode bomb limit, iterative downscale to the 1.9 MB official ceiling, and the
// JPEG re-encode. All of it was hard-won on real applicant uploads.
//
// ⚠️ AND THE SELFIE IS NOT A 'portrait'. The visa `portrait` kind means a passport-style headshot;
// ours is a person at arm's length holding a document AND a handwritten code, which needs enough
// resolution to read six characters off paper. Mapping it to `portrait` would import a 240x320
// floor that is far too low to review. It maps to `passport` for the floor and carries its own,
// higher minimum below.

/**
 * ⚠️ THE ARRAY IS THE SOURCE OF TRUTH, AND THE TYPE IS DERIVED FROM IT. store.ts builds the
 * filename allow-list from this list, so a third kind added as a bare type member would be
 * accepted by the upload route and then REFUSED by the ownership check — a split that only shows
 * up as a seller who can upload but cannot submit.
 */
export const KYC_IMAGE_KINDS = ['document', 'selfie'] as const
export type KycImageKind = (typeof KYC_IMAGE_KINDS)[number]

/** Which locked visa kind carries the right decode rules for each of ours. */
const VISA_KIND: Record<KycImageKind, 'passport' | 'supporting'> = {
  // A passport data page IS the visa `passport` case — same document, same expectations.
  document: 'passport',
  // Floor only; the real minimum is KYC_MIN_DIMENSIONS below.
  selfie: 'passport',
}

/**
 * ⚠️ HIGHER THAN THE VISA FLOORS, ON PURPOSE. A reviewer has to read a passport number off the
 * document and six handwritten characters off a sheet of paper in the selfie. VISA_MIN_DIMENSIONS
 * .passport is 320x480 — legible for a machine reading an MRZ, not for a human reading handwriting
 * in a photo taken at arm's length. These are the numbers a review can actually be done at.
 */
export const KYC_MIN_DIMENSIONS: Record<KycImageKind, { short: number; long: number }> = {
  document: { short: 640, long: 960 },
  selfie: { short: 720, long: 960 },
}

export const KYC_MAX_INTAKE_BYTES = MAX_INTAKE_BYTES

/**
 * ⚠️ EXIF IS A SIGNAL FOR A HUMAN, NEVER A CHECK — and it must be read BEFORE normalisation,
 * because the JPEG re-encode strips it.
 *
 * ⛔ DO NOT GATE ON ANY OF THIS. Every field is attacker-controlled: `exiftool` rewrites a
 * timestamp in one command, and a screenshot or a re-saved image legitimately has no EXIF at all.
 * Absent EXIF is the NORMAL case for a perfectly honest seller — some Android cameras strip it, and
 * every messaging app does. Its only value is the reviewer noticing that a "photo taken just now"
 * carries a capture date from 2019, which is a reason to look harder rather than a reason to reject.
 */
export type ExifProbe = {
  hasExif: boolean
  capturedAt: string | null
  make: string | null
  model: string | null
  /** True when the image has no camera make/model — common and innocent, never disqualifying. */
  looksProcessed: boolean
}

export async function probeExif(input: Buffer): Promise<ExifProbe> {
  const empty: ExifProbe = { hasExif: false, capturedAt: null, make: null, model: null, looksProcessed: true }
  try {
    const meta = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata()
    if (!meta.exif) return empty
    // sharp hands back the raw EXIF block rather than parsed tags. Rather than take a dependency to
    // read three fields, scan the buffer for the ASCII forms — a miss costs a null, which this type
    // already treats as normal.
    const raw = meta.exif.toString('latin1')
    const dt = raw.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/)
    const capturedAt = dt ? `${dt[1]}-${dt[2]}-${dt[3]}T${dt[4]}:${dt[5]}:${dt[6]}` : null
    const printable = raw.replace(/[^\x20-\x7E]+/g, ' ').trim()
    const make = printable.match(/\b(Apple|samsung|Xiaomi|OPPO|vivo|realme|HUAWEI|Google|OnePlus|Sony|Canon|NIKON)\b/i)?.[0] ?? null
    return { hasExif: true, capturedAt, make, model: null, looksProcessed: !make }
  } catch {
    return empty
  }
}

export type KycNormalizeResult = {
  output: Buffer
  width: number | null
  height: number | null
  /** The locked pipeline's own report, carried through verbatim for the audit trail. */
  report: Awaited<ReturnType<typeof normalizeVisaImage>>['report']
  exif: ExifProbe
}

export class KycImageError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'KycImageError'
  }
}

/**
 * Decode, orient, downscale and re-encode one KYC capture.
 *
 * ⛔ THE RESOLUTION FLOOR IS CHECKED ON THE ORIGINAL, NOT THE OUTPUT. normalizeVisaImage may
 * DOWNSCALE a large image to fit the 1.9 MB ceiling, so measuring afterwards would reject a
 * perfectly good 12 MP photo for being small after we shrank it ourselves. Probe first, then hand
 * the bytes over.
 *
 * ⚠️ Errors are CODES, not prose: they reach a seller mid-capture and need bilingual copy at the
 * call site. Reusing the locked pipeline's own strings keeps that vocabulary in one place.
 */
export async function normalizeKycImage(input: Buffer, kind: KycImageKind): Promise<KycNormalizeResult> {
  if (!input.length || input.length > KYC_MAX_INTAKE_BYTES) throw new KycImageError('image_size_invalid')

  let width = 0
  let height = 0
  try {
    const meta = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata()
    // EXIF orientation 5-8 swap the axes; comparing raw width/height would reject a portrait photo
    // taken sideways. The locked pipeline does the same thing internally.
    const swapped = (meta.orientation ?? 1) >= 5
    width = (swapped ? meta.height : meta.width) || 0
    height = (swapped ? meta.width : meta.height) || 0
  } catch {
    throw new KycImageError('image_decode_failed')
  }
  if (!width || !height) throw new KycImageError('image_dimensions_invalid')

  const floor = KYC_MIN_DIMENSIONS[kind]
  if (Math.min(width, height) < floor.short || Math.max(width, height) < floor.long) {
    throw new KycImageError('image_too_small_to_review')
  }

  // Read EXIF before the re-encode strips it.
  const exif = await probeExif(input)

  let normalized: Awaited<ReturnType<typeof normalizeVisaImage>>
  try {
    normalized = await normalizeVisaImage(input, VISA_KIND[kind])
  } catch (e) {
    // Surface the locked pipeline's own code rather than inventing a second vocabulary for the
    // same failure.
    throw new KycImageError(e instanceof Error ? e.message : 'image_decode_failed')
  }
  return { output: normalized.output, width: normalized.width, height: normalized.height, report: normalized.report, exif }
}

/** The visa floors, re-exported so a caller can show both numbers without importing the locked module. */
export { VISA_MIN_DIMENSIONS }
