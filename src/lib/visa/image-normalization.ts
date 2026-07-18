import sharp from 'sharp'

export const VISA_IMAGE_RULES_VERSION = 'evisa-images-2026-07-16'
export type VisaImageKind = 'portrait' | 'passport' | 'supporting'

const OFFICIAL_MAX_BYTES = 1_900_000
const MAX_INTAKE_BYTES = 15 * 1024 * 1024

function orientedDimensions(metadata: sharp.Metadata) {
  const rotated = metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8
  return {
    width: rotated ? metadata.height : metadata.width,
    height: rotated ? metadata.width : metadata.height,
  }
}

export async function normalizeVisaImage(input: Buffer, kind: VisaImageKind) {
  if (!input.length || input.length > MAX_INTAKE_BYTES) throw new Error('image_size_invalid')
  let metadata: sharp.Metadata
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
  if (kind === 'portrait' && (shortEdge < 480 || longEdge < 600)) throw new Error('portrait_resolution_too_low')
  if (kind === 'passport' && (shortEdge < 600 || longEdge < 900)) throw new Error('passport_resolution_too_low')
  if (kind === 'supporting' && shortEdge < 300) throw new Error('image_dimensions_invalid')

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
