import { parsePassportMrz, type PassportMrzResult } from './mrz'

// ── Local (on-device) passport MRZ reading ──────────────────────────────────────────────────────
//
// Owner, 2026-08-03: expats verify via "local fast OCR" — the passport image is read IN THE BROWSER
// and never uploaded for the data-entry step. That is a real privacy win (an expat's passport does
// not traverse our infrastructure to fill a form) and a real cost win (no per-call cloud OCR).
//
// ⚠️⚠️ WHAT THIS IS NOT: THE VERIFICATION DECISION.
// MRZ check digits are COMPUTABLE. Anyone can author a fake MRZ whose every checksum passes — it is
// a mod-10 weighted sum, not a signature. So a browser that reports "valid MRZ, here are the
// fields" is making an ASSERTION, and a server that believes it has implemented self-declaration,
// not identity verification. That satisfies neither NĐ 248/2026 nor us.
//
// The division of labour is therefore:
//   · THIS MODULE (client)  — read the document instantly, tell the user if the photo is unusable,
//                             pre-fill the form. Zero round-trips, zero cloud spend.
//   · THE SERVER            — makes the decision, from evidence the client cannot forge.
//                             See verify-decision.ts. Client MRZ is a HINT there, never the proof.
//
// Keeping that boundary explicit is the whole point of this file's existence.
//
// ⚠️ THE ENGINE IS INJECTED. No tesseract/onnx import here. That keeps this module pure and unit-
// testable (the tests below drive it with a fake engine and no wasm), and leaves the heavyweight
// dependency choice — which is a real ~15MB decision — to the call site and to the owner.

/** An OCR engine: image region in, raw text out. Implemented by a worker-backed adapter. */
export type OcrEngine = (image: ImageLike, opts: OcrOptions) => Promise<string>

/** Deliberately structural, so tests can pass a plain object and the browser can pass ImageData. */
export type ImageLike = { width: number; height: number; data?: Uint8ClampedArray }

export type OcrOptions = {
  /** MRZ is OCR-B over a fixed alphabet. Restricting the charset is the single biggest accuracy win. */
  charset: string
  /** Region of interest, fractions of the full image. */
  crop: { top: number; left: number; width: number; height: number }
  /** Preprocessing knobs the variant search sweeps. */
  contrast: number
  invert: boolean
  upscale: number
}

/** ICAO 9303 TD3 (passport) MRZ: two lines of exactly 44 characters. */
export const MRZ_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'
export const TD3_LINE_LENGTH = 44

/**
 * ⚠️ CROP BEFORE OCR — THIS IS MOST OF THE "FAST". The MRZ occupies a fixed band across the bottom
 * of a passport bio page. Running OCR on the whole page is several times slower AND less accurate,
 * because the engine then has to contend with the photo, the signature, and mixed non-OCR-B
 * typefaces. The band is generous (bottom 30%) so a sloppily-framed photo still contains it.
 */
export const MRZ_BAND = { top: 0.70, left: 0.0, width: 1.0, height: 0.30 } as const

/**
 * Preprocessing variants, in the order they are tried.
 *
 * ⚠️ ORDERED BY EXPECTED HIT RATE, AND THE SEARCH STOPS AT THE FIRST FULL PASS. A phone photo of a
 * passport under a ceiling light is the common case, so the plain and higher-contrast variants come
 * first; inversion is last because it only helps the rare dark-background scan. Most reads finish
 * on variant 0 and never pay for the rest.
 */
export const VARIANTS: ReadonlyArray<Pick<OcrOptions, 'contrast' | 'invert' | 'upscale'>> = [
  { contrast: 1.0, invert: false, upscale: 2 },
  { contrast: 1.6, invert: false, upscale: 2 },
  { contrast: 2.2, invert: false, upscale: 3 },
  { contrast: 1.6, invert: true, upscale: 2 },
]

export type MrzReadResult =
  | { ok: true; mrz: PassportMrzResult; lines: [string, string]; variantIndex: number; attempts: number }
  | { ok: false; reason: 'no_mrz_found' | 'checksums_failed'; attempts: number; best?: PassportMrzResult }

/**
 * Pull the two MRZ lines out of raw OCR text.
 *
 * ⚠️ SELECT BY SHAPE, NOT BY POSITION. The engine returns whatever it found in the band, which can
 * include a stray line of print above the MRZ or a caption below it. The MRZ lines are identifiable
 * structurally — 44 characters drawn only from the MRZ alphabet, and line 1 of a passport always
 * begins with `P`. Taking "the last two lines" breaks the moment the crop catches one extra row.
 */
export function extractMrzLines(raw: string): [string, string] | null {
  const candidates = raw
    .split(/\r?\n/)
    .map((l) => l.toUpperCase().replace(/\s+/g, ''))
    // OCR frequently renders the filler '<' as 'K' or '«'; normalise before measuring length.
    .map((l) => l.replace(/[«‹]/g, '<'))
    .filter((l) => l.length >= TD3_LINE_LENGTH - 2 && l.length <= TD3_LINE_LENGTH + 2)
    .filter((l) => [...l].every((c) => MRZ_CHARSET.includes(c)))

  if (candidates.length < 2) return null
  // Prefer an adjacent pair whose first member looks like a TD3 line 1 (document code 'P').
  for (let i = 0; i < candidates.length - 1; i++) {
    if (candidates[i].startsWith('P')) return [candidates[i], candidates[i + 1]]
  }
  return [candidates[candidates.length - 2], candidates[candidates.length - 1]]
}

/**
 * Read the MRZ, sweeping preprocessing variants until the CHECK DIGITS pass.
 *
 * ⚠️ THE CHECK DIGITS ARE A FREE GROUND-TRUTH ORACLE, AND THAT IS THE WHOLE DESIGN.
 * Ordinary OCR has no way to know whether it read correctly, so it needs a human to confirm. An MRZ
 * carries its own mod-10 checksums over the document number, both dates, and a composite — so the
 * pipeline can grade its OWN output and keep trying preprocessing until it passes, with nobody
 * watching. That is what makes "fast" and "accurate" compatible here instead of a trade-off.
 *
 * ⚠️ It also means a PASS is strong evidence the read was CORRECT — and no evidence at all that the
 * document is GENUINE. See the trust-boundary note at the top of this file.
 */
export async function readMrz(image: ImageLike, engine: OcrEngine): Promise<MrzReadResult> {
  let attempts = 0
  let best: PassportMrzResult | undefined
  let sawAnyLines = false

  for (let i = 0; i < VARIANTS.length; i++) {
    attempts++
    let raw: string
    try {
      raw = await engine(image, { charset: MRZ_CHARSET, crop: { ...MRZ_BAND }, ...VARIANTS[i] })
    } catch {
      // ⚠️ A THROWING VARIANT MUST NOT ABORT THE SWEEP. One preprocessing setting failing (a wasm
      // hiccup, an out-of-memory upscale on a low-end phone) is not a reason to give up on the
      // three that might have worked.
      continue
    }
    const lines = extractMrzLines(raw)
    if (!lines) continue
    sawAnyLines = true
    const mrz = parsePassportMrz(lines[0], lines[1])
    if (mrz.valid) return { ok: true, mrz, lines, variantIndex: i, attempts }
    // Keep the most complete near-miss so the UI can say WHICH field failed rather than "try again".
    if (!best || countPassed(mrz) > countPassed(best)) best = mrz
  }

  return sawAnyLines
    ? { ok: false, reason: 'checksums_failed', attempts, best }
    : { ok: false, reason: 'no_mrz_found', attempts }
}

function countPassed(m: PassportMrzResult): number {
  return Object.values(m.checks).filter(Boolean).length
}

/**
 * Actionable guidance for a failed read.
 *
 * ⚠️ "Try again" IS NOT GUIDANCE. The overwhelmingly common failure is glare from photographing a
 * laminated page under a ceiling light, and the user cannot guess that from a generic error — they
 * retake the same photo the same way and fail identically. Naming the physical cause is what makes
 * the second attempt succeed.
 */
export function readFailureHint(r: Extract<MrzReadResult, { ok: false }>): { en: string; vi: string } {
  if (r.reason === 'no_mrz_found') {
    return {
      en: 'We could not find the two machine-readable lines at the bottom of your passport. Photograph the page with your photo on it, and make sure the whole bottom edge is inside the frame.',
      vi: 'Chúng tôi không tìm thấy hai dòng mã máy đọc ở cuối hộ chiếu. Vui lòng chụp trang có ảnh của bạn và đảm bảo toàn bộ mép dưới nằm trong khung hình.',
    }
  }
  return {
    en: 'We found the lines but could not read them cleanly — this is almost always glare. Tilt the passport slightly away from the light, or move out from under a ceiling lamp, and retake it.',
    vi: 'Chúng tôi tìm thấy hai dòng mã nhưng không đọc rõ — nguyên nhân hầu như luôn là loá sáng. Hãy nghiêng hộ chiếu ra khỏi nguồn sáng, hoặc tránh đứng dưới đèn trần, rồi chụp lại.',
  }
}
