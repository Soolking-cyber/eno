import 'server-only'
import sharp from 'sharp'
import { looksLikePdf } from '@/lib/teachers/cv-store'
import { IMPORT_MAX_PDF_PAGES } from '@/lib/teachers/import-limits'

/**
 * WHAT A TEACHER MAY UPLOAD TO FILL THE FORM (owner, 2026-10-15) — a CV or a LinkedIn profile PDF as a PDF or a photo of
 * it, sniffed by its bytes (never by the name or the browser's MIME), bounded, and turned into what the model reads:
 * inline bytes. Nothing here writes anywhere; the bytes live in this request's memory only.
 *
 * ⛔ NO ZIP IS EVER OPENED HERE. A Word file's text is read IN THE BROWSER (src/lib/teachers/docx-text.ts) and posted as
 * text: fflate sizes its output from the entry's DECLARED size and keeps inflating past it, so a ~1 MiB entry that
 * declares 1 KiB blocked Node's event loop for ~29 s when measured (plan review, 2026-10-15) — on the box that is every
 * visitor's request. bulk-media.ts is safe for the same reason: it runs in the browser.
 * ⚠️ A PDF's text layer cannot be inspected here (no PDF parser on the box — deliberately no new dependency), so hidden
 * text in a PDF reaches the model; it is told the file is data, never instructions, and the teacher checks every answer.
 */

export { IMPORT_MAX_BYTES, IMPORT_MAX_PDF_PAGES, IMPORT_MAX_TEXT_CHARS } from '@/lib/teachers/import-limits'

export type ImportFile =
  | { kind: 'pdf'; mimeType: 'application/pdf'; data: Buffer }
  | { kind: 'image'; mimeType: 'image/jpeg'; data: Buffer }
export type ImportFileError = 'import_type' | 'import_too_long' | 'import_locked' | 'import_empty'

const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
const isWebp = (b: Uint8Array) => b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP'

/**
 * A PDF's page count, ROUGHLY: page objects ("/Type /Page", never the "/Pages" tree nodes) in the raw bytes. Pages
 * inside compressed object streams are not seen, so this can only UNDER-count — it refuses the obviously long file
 * cheaply; size, the model's own limits and the daily caps bound the rest.
 */
export function roughPdfPages(bytes: Buffer): number {
  const s = bytes.toString('latin1')
  return (s.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length
}

/** An encrypted PDF (a password, or owner restrictions the model would refuse) — its trailer names an /Encrypt dictionary. */
const pdfLocked = (bytes: Buffer) => /\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(bytes.toString('latin1'))

/** The uploaded bytes → what the model may read, or why not. Never throws. */
export async function readImportFile(raw: Uint8Array): Promise<ImportFile | ImportFileError> {
  const bytes = Buffer.from(raw)
  if (bytes.length === 0) return 'import_empty'
  if (looksLikePdf(bytes)) {
    if (pdfLocked(bytes)) return 'import_locked'
    if (roughPdfPages(bytes) > IMPORT_MAX_PDF_PAGES) return 'import_too_long'
    return { kind: 'pdf', mimeType: 'application/pdf', data: bytes }
  }
  if (isJpeg(bytes) || isPng(bytes) || isWebp(bytes)) {
    try {
      // Re-encoded here: EXIF (a phone photo's GPS) never leaves the box, and a decompression bomb stops at the pixel cap.
      // 25 MP: the browser sends a photo already shrunk (normalize-image.ts) — anything bigger came another way.
      const data = await sharp(bytes, { limitInputPixels: 25_000_000, failOn: 'error' })
        .rotate()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        // A transparent PNG/WebP CV (Canva, Figma) would lose its alpha onto BLACK — dark text on a black page.
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 85 })
        .toBuffer()
      return { kind: 'image', mimeType: 'image/jpeg', data }
    } catch {
      return 'import_type'
    }
  }
  return 'import_type'
}
