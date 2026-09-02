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
  // `pool` carries every check-valid field accumulated SO FAR (this read merged into the caller's prior
  // pool). The caller persists it and passes it back on the next capture, so successive frames converge
  // even when no single frame is complete — see readMrz's priorPool argument.
  | { ok: true; mrz: PassportMrzResult; lines: [string, string]; variantIndex: number; attempts: number; pool: MrzFieldPool }
  | { ok: false; reason: 'no_mrz_found' | 'checksums_failed'; attempts: number; best?: PassportMrzResult; pool: MrzFieldPool; missing: Array<'passportNumber' | 'dateOfBirth' | 'expiry'> }

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

// ── ICAO 9303 check digit (LOCAL copy) ───────────────────────────────────────────────────────────
// mrz.ts's `checkDigit` is not exported (and mrz.ts is sync-paired with the forum, so widening its
// surface is friction). The algorithm is a frozen standard — a mod-10 weighted sum over 7,3,1 — so a
// local copy here cannot drift. Used only by the cross-variant salvage below.
const CHECK_WEIGHTS = [7, 3, 1]
function icaoCheck(value: string): string {
  const total = [...value].reduce((sum, c, i) => {
    const v = /\d/.test(c) ? Number(c) : /[A-Z]/.test(c) ? c.charCodeAt(0) - 55 : 0
    return sum + v * CHECK_WEIGHTS[i % 3]
  }, 0)
  return String(total % 10)
}
function checkPasses(value: string, expected: string): boolean {
  return /^\d$/.test(expected) && icaoCheck(value) === expected
}

/** Check-digit-VALIDATED MRZ line-2 fields, plus the best-read name line. Every string here has been
 *  proven correct by its own check digit (names excepted — line 1 has none). Accumulated across frames. */
export type MrzFieldPool = {
  passportNumber?: string // 9 chars incl. trailing filler, check digit already validated
  dateOfBirth?: string    // 6 digits YYMMDD
  expiry?: string         // 6 digits YYMMDD
  sex?: string            // 'M' | 'F'
  nationality?: string    // 3 letters
  nameLine?: string       // TD3 line 1, padded to 44 (best-effort; no check digit)
}

function isMrzDate(v: string, kind: 'birth' | 'expiry'): boolean {
  if (!/^\d{6}$/.test(v)) return false
  const mm = Number(v.slice(2, 4)), dd = Number(v.slice(4, 6))
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false
  if (kind === 'birth') return true // birth century is disambiguated downstream by parsePassportMrz
  // Expiry: a REAL plausibility band, not the old `yy<=now+15 || yy>=now` which is true for every year
  // 00–99 (agy, 2026-09-02). A passport is valid ~10 yr; a full year far outside this band is garbage OCR
  // that happened to pass its check digit. This is a sanity filter, NOT expiry policy — decideTierB owns that.
  const full = 2000 + Number(v.slice(0, 2))
  const now = new Date().getUTCFullYear()
  return full >= now - 2 && full <= now + 15
}

/**
 * ⚠️ ANCHORED, INSERTION-TOLERANT FIELD EXTRACTION — the core of the multi-frame salvage.
 *
 * Measured on a 1280×720 webcam (2026-09-02): the OCR does not merely SUBSTITUTE characters, it also
 * INSERTS and DROPS them (a line comes out 43 or 45 chars, or line 1 loses its trailing filler). Fixed
 * TD3 position slicing then aligns to the wrong characters and every check digit fails, even though the
 * digits are mostly right. So we do not slice by position — we ANCHOR:
 *   · DOB + expiry: find an `M`/`F` (the sex char sits between them); the 6 chars before it + the next
 *     char are DOB+check, the 6 after + the following char are expiry+check. Requiring BOTH a valid
 *     check digit AND a valid calendar date on each makes a false anchor astronomically unlikely.
 *   · passport number: a 9-char window whose check digit passes AND is followed by a 3-letter country.
 *   · name line: the first line starting with `P`, padded to 44.
 * Each accepted field is check-digit-proven, so pooling them across many frames is safe: a field only
 * enters the pool once some frame read it correctly. This is exactly how a phone MRZ scanner locks in
 * fields over a live camera feed — the errors between frames are decorrelated, so the union converges.
 */
export function extractMrzFields(rawTexts: string[]): MrzFieldPool {
  const clean = (l: string) => l.toUpperCase().replace(/\s/g, '').replace(/[«‹]/g, '<').replace(/[^A-Z0-9<]/g, '')
  const lines = rawTexts.flatMap((t) => t.split(/\r?\n/)).map(clean).filter((l) => l.length >= 20)
  const f: MrzFieldPool = {}

  // Name line + issuing state (nationality) from line 1 — reliably read as `P<XXX…`.
  const nameLine = lines.map((l) => (l.startsWith('P') ? (l + '<'.repeat(44)).slice(0, 44) : null)).find(Boolean)
  if (nameLine) {
    f.nameLine = nameLine
    const nat = nameLine.slice(2, 5)
    if (/^[A-Z]{3}$/.test(nat)) f.nationality = nat
  }

  // DOB + expiry, anchored on the sex character. ⚠️ An `M`/`F` is only the REAL sex position when the
  // DOB immediately before it validates (check digit + calendar) — otherwise the `M` in a country code
  // like TK`M` is a false anchor whose "expiry" slot lands on the DOB and mislabels it as the expiry.
  for (const l of lines) {
    for (let i = 7; i < l.length - 7; i++) {
      const s = l[i]
      // ICAO 9303 sex is M | F | X (unspecified) | < (also unspecified). Accepting X keeps non-binary /
      // unspecified passports working (agy, 2026-09-02); a bare `<` is NOT anchored on (every filler is a
      // `<`, which would flood false anchors). The DOB-before-check below is what proves this is the real
      // sex position regardless of the character.
      if (s !== 'M' && s !== 'F' && s !== 'X') continue
      const dob = l.slice(i - 7, i - 1), dobChk = l[i - 1]
      if (!(checkPasses(dob, dobChk) && isMrzDate(dob, 'birth'))) continue // not the sex position
      if (!f.dateOfBirth) { f.dateOfBirth = dob; f.sex = (s === 'M' || s === 'F') ? s : undefined }
      const exp = l.slice(i + 1, i + 7), expChk = l[i + 7]
      if (!f.expiry && checkPasses(exp, expChk) && isMrzDate(exp, 'expiry')) f.expiry = exp
    }
  }

  // Passport number: a 9-char window + valid check digit, anchored by a 3-letter country code after it.
  // ⛔ CONSENSUS REQUIRED — ≥2 lines must agree on the SAME number. The ICAO check digit is mod-10 and
  // the filler `<`, `0`, `A`(10), `K`(20), `U`(30) are all ≡ 0 mod 10, so a single-line misread of a
  // trailing filler as a letter (`B1234567<` → `B1234567K`) passes checkPasses undetected (fable,
  // 2026-09-02). The number is the identity anchor and the server prefers it over the typed field, so a
  // lone check-valid read is not enough; two independent variants making the identical misread is not
  // plausible. Genuine reads agree across all four variants, so this never blocks a real number.
  const pnPerLine: string[] = []
  for (const l of lines) {
    for (let start = 0; start <= 4 && start + 13 <= l.length; start++) {
      const val = l.slice(start, start + 9)
      if (checkPasses(val, l[start + 9]) && /^[A-Z]{3}$/.test(l.slice(start + 10, start + 13))) { pnPerLine.push(val); break }
    }
  }
  const pnCounts = new Map<string, number>()
  for (const v of pnPerLine) pnCounts.set(v, (pnCounts.get(v) ?? 0) + 1)
  let bestPn: string | undefined
  for (const [v, n] of pnCounts) if (n >= 2 && (!bestPn || n > pnCounts.get(bestPn)!)) bestPn = v
  if (bestPn) f.passportNumber = bestPn
  return f
}

/** Merge freshly-extracted fields into the running pool WITHOUT overwriting an already-validated field
 *  (the first check-valid reading wins; a later frame cannot corrupt a locked field). Name line updates
 *  to the longest seen (more filler read = more of the name captured).
 *
 *  ⛔ IDENTITY SAFETY: if the new frame's check-valid passport number OR date of birth DISAGREES with
 *  the pool's, the camera is now on a DIFFERENT document — discard the pool and start fresh from the new
 *  frame, so fields from two identities can never be fused into one Frankenstein MRZ. Both anchors are
 *  check-digit-validated, so a disagreement is real, not OCR noise. */
export function mergeMrzPool(pool: MrzFieldPool, next: MrzFieldPool): MrzFieldPool {
  const conflict = (a?: string, b?: string) => !!a && !!b && a !== b
  if (conflict(pool.passportNumber, next.passportNumber) || conflict(pool.dateOfBirth, next.dateOfBirth)) {
    pool = {} // different document — drop everything accumulated for the old one
  }
  const out: MrzFieldPool = { ...pool }
  for (const k of ['passportNumber', 'dateOfBirth', 'expiry', 'sex', 'nationality'] as const) {
    if (!out[k] && next[k]) out[k] = next[k]
  }
  if (next.nameLine && (!out.nameLine || next.nameLine.replace(/<+$/, '').length > out.nameLine.replace(/<+$/, '').length)) {
    out.nameLine = next.nameLine
  }
  return out
}

/** Assemble a canonical, fully check-valid TD3 MRZ from a complete pool, or null if a field is missing.
 *  Optional data is FILLER (we don't collect the personal-number field — it is not identity data) and
 *  the composite is freshly computed, so parsePassportMrz validates every check digit. */
export function poolToMrzLines(pool: MrzFieldPool): [string, string] | null {
  const { passportNumber, dateOfBirth, expiry } = pool
  if (!passportNumber || !dateOfBirth || !expiry) return null
  const nationality = pool.nationality && /^[A-Z]{3}$/.test(pool.nationality) ? pool.nationality : '<<<'
  const sex = pool.sex === 'M' || pool.sex === 'F' ? pool.sex : '<'
  // ⛔ ALWAYS a NAME-LESS line 1 — never an OCR'd name. This is a SYNTHESIZED MRZ (fields harvested and
  // check-validated separately, composite recomputed); its line 1 is not a faithful read. The server
  // (kyc/service.ts `readDocument`) PREFERS MRZ-derived fields over the user's typed input, so shipping a
  // salvaged name here would let OCR garbage — or, for a passport number beginning `P`, a copy of line 2 —
  // OVERWRITE the name the user confirmed (all reviewers, 2026-09-02). So we emit only `P` + issuing state
  // + filler: the name comes exclusively from the user's typed, now-required surname/given fields. A
  // genuinely faithful SINGLE-variant read still returns its real name line via readMrz's fast path above.
  const nameLine = `P<${nationality}${'<'.repeat(44)}`.slice(0, 44)
  const filler = '<'.repeat(14)
  const head =
    passportNumber + icaoCheck(passportNumber) + nationality + dateOfBirth + icaoCheck(dateOfBirth) +
    sex + expiry + icaoCheck(expiry) + filler + icaoCheck(filler) // 9+1+3+6+1+1+6+1+14+1 = 43
  const composite = icaoCheck(`${head.slice(0, 10)}${head.slice(13, 20)}${head.slice(21, 43)}`)
  return [nameLine, head + composite] // 44 + 44
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
export async function readMrz(image: ImageLike, engine: OcrEngine, priorPool: MrzFieldPool = {}): Promise<MrzReadResult> {
  let attempts = 0
  let best: PassportMrzResult | undefined
  let sawAnyLines = false
  // ⚠️ Every variant's RAW OCR text, kept for the cross-variant salvage below: the camera flips a
  // different single digit each pass (and often drops line 1's trailing filler, so extractMrzLines
  // finds no pair), yet the union of variants usually contains a check-valid reading of every field.
  const rawTexts: string[] = []

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
    rawTexts.push(raw)
    const lines = extractMrzLines(raw)
    if (!lines) continue
    sawAnyLines = true
    const mrz = parsePassportMrz(lines[0], lines[1])
    // Even a fully-valid single variant merges into the pool (harmless) so the caller's pool stays current.
    if (mrz.valid) return { ok: true, mrz, lines, variantIndex: i, attempts, pool: mergeMrzPool(priorPool, extractMrzFields(rawTexts)) }
    // Keep the most complete near-miss so the UI can say WHICH field failed rather than "try again".
    if (!best || countPassed(mrz) > countPassed(best)) best = mrz
  }

  // MULTI-FRAME FUSION: merge this capture's check-valid fields into the caller's accumulated pool, then
  // try to assemble a complete, valid MRZ. This is what rescues a frame missing one field — an earlier
  // (or later) frame supplied it. A single capture with all fields present validates on its own here.
  const pool = mergeMrzPool(priorPool, extractMrzFields(rawTexts))
  const assembled = poolToMrzLines(pool)
  if (assembled) {
    const mrz = parsePassportMrz(assembled[0], assembled[1])
    if (mrz.valid) return { ok: true, mrz, lines: assembled, variantIndex: -1, attempts, pool } // -1 = salvaged/fused
  }
  // Which identity fields are still missing — the UI turns this into "hold steady and capture again;
  // we still need the passport-number line", which makes a retake productive instead of a blind retry.
  const missing = (['passportNumber', 'dateOfBirth', 'expiry'] as const).filter((k) => !pool[k])
  if (pool.passportNumber || pool.dateOfBirth || pool.expiry) sawAnyLines = true // we recovered SOME field

  return sawAnyLines
    ? { ok: false, reason: 'checksums_failed', attempts, best, pool, missing }
    : { ok: false, reason: 'no_mrz_found', attempts, pool, missing }
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
export function readFailureHint(r: { reason: 'no_mrz_found' | 'checksums_failed' }): { en: string; vi: string } {
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
