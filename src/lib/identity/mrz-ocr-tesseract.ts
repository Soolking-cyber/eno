'use client'

// ── Tesseract OcrEngine adapter for the on-device passport MRZ reader ────────────────────────────
//
// This is the heavyweight engine that src/lib/identity/mrz-ocr.ts deliberately does NOT import (that
// module stays pure + unit-testable with a fake engine). It is browser-only ('use client'). ⚠️ THE
// CODE SPLIT IS THE INTERNAL `await import('tesseract.js')` in createTesseractWorker — NOT this
// module's own import: verify-client imports createMrzOcrEngine STATICALLY (it is tiny), and the
// ~6MB of WASM + traineddata loads only when the first scan actually runs. Do not "fix" the static
// import to a dynamic one; the split already works and is verified by the chunk graph.
//
// Design decisions, all from the plan review (codex + antigravity + fable):
//   · SELF-HOSTED assets under /tesseract/ — the site CSP is connect-src 'self' / worker-src 'self'
//     blob:, so a CDN (tesseract.js's default) is blocked. See public/tesseract/PROVENANCE.md.
//   · NON-THREADED SIMD core — the threaded core needs SharedArrayBuffer, which needs COOP/COEP
//     headers that would break both editions. tesseract.js picks tesseract-core-simd-lstm.wasm.js
//     (non-threaded) for a SIMD browser; a non-SIMD browser gets no core and the caller falls back
//     to manual MRZ entry.
//   · CROP + PREPROCESS ON THE MAIN THREAD, then hand the worker only the small MRZ band. A 1920px
//     frame is ~11MB RGBA; cropping to the band and bounding the upscaled pixel count keeps a phone
//     off the WASM OOM cliff, and passing a small canvas keeps the postMessage copy cheap.
//   · MRZ whitelist + PSM 6 + dictionaries OFF — the LSTM engine honours a char whitelist only
//     weakly and its dictionaries actively corrupt MRZ (they "correct" `<` and OCR-B toward words),
//     so load_system_dawg / load_freq_dawg are disabled.
//
// ⚠️ This engine reads the document; it never DECIDES anything. The check digits in mrz.ts grade the
// read, and the server (verify-decision.ts) makes the identity decision from evidence the client
// cannot forge. See the trust-boundary note atop mrz-ocr.ts.

import type { OcrEngine, ImageLike, OcrOptions } from './mrz-ocr'

/** Bound the preprocessed band so a high upscale on a big frame cannot exhaust mobile WASM memory. */
const MAX_PREPROCESSED_PIXELS = 4_000_000 // ~16MB RGBA

type TesseractWorker = {
  recognize: (image: unknown) => Promise<{ data: { text: string } }>
  terminate: () => Promise<unknown>
}

/**
 * Build a configured Tesseract worker. NO module-level caching — each engine (createMrzOcrEngine)
 * owns its own worker so there is no shared global to race on: an old attempt's late rejection can
 * never null a healthy replacement, and one engine can never terminate another's worker (codex's ABA
 * finding). In this app exactly one engine exists at a time (verify-client's `engineRef`), so the
 * per-engine worker is also the only worker.
 */
async function createTesseractWorker(): Promise<TesseractWorker> {
  const { createWorker, PSM, OEM } = await import('tesseract.js')
  // oem LSTM_ONLY; assets pinned to our own origin (CSP-safe).
  const worker = await createWorker(
        'eng',
        OEM.LSTM_ONLY,
        {
          workerPath: '/tesseract/worker.min.js',
          corePath: '/tesseract',
          langPath: '/tesseract',
          // ⚠️ gzip:false + an UNCOMPRESSED eng.traineddata. Shipping the `.gz` risks a double
          // decompress if a CDN/host serves it with `Content-Encoding: gzip` (the browser inflates
          // it, then tesseract's pako inflates again → corrupt). Plain bytes are unambiguous; the
          // wire is still compressed by the edge. See public/tesseract/PROVENANCE.md.
          gzip: false,
        },
        {
          // ⚠️ INIT-ONLY. The dawg dictionaries load at engine init, and setParameters() AFTER init
          // cannot disable them — it is silently ignored. They must be disabled here, in the 4th
          // `config` argument, or Tesseract "corrects" the MRZ toward dictionary words and mangles it.
          load_system_dawg: '0',
          load_freq_dawg: '0',
        },
      )
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK, // 6 — one uniform block of text (the MRZ band)
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
  })
  return worker as unknown as TesseractWorker
}

/**
 * Crop the ROI band, scale it, and reduce it to a high-contrast (optionally inverted) GRAYSCALE image
 * on a 2D canvas (Tesseract's own Otsu does the thresholding — see the loop). Returns the canvas for
 * the worker to recognise. Pure DOM/canvas — no WASM here.
 */
function preprocess(image: ImageLike, opts: OcrOptions): HTMLCanvasElement {
  if (!image.data) throw new Error('mrz-ocr-tesseract: ImageLike has no pixel data')

  // Source frame → a canvas we can crop from.
  const src = document.createElement('canvas')
  src.width = image.width
  src.height = image.height
  const sctx = src.getContext('2d')
  if (!sctx) throw new Error('mrz-ocr-tesseract: no 2d context')
  const source = sctx.createImageData(image.width, image.height)
  source.data.set(image.data)
  sctx.putImageData(source, 0, 0)

  // ROI band in source pixels.
  const cx = Math.max(0, Math.round(opts.crop.left * image.width))
  const cy = Math.max(0, Math.round(opts.crop.top * image.height))
  const cw = Math.min(image.width - cx, Math.round(opts.crop.width * image.width))
  const ch = Math.min(image.height - cy, Math.round(opts.crop.height * image.height))
  // ⚠️ A zero/negative crop (a degenerate or tiny frame) would make drawImage throw an IndexSizeError
  // DOMException. Throw a clean error instead — readMrz's per-variant catch skips it and the read
  // fails over to manual entry, rather than an uncaught exception surfacing to the user.
  if (cw <= 0 || ch <= 0) throw new Error('mrz-ocr-tesseract: empty crop region')

  // Upscale toward the requested factor, then CAP to the memory bound. ⚠️ The cap can drop scale
  // BELOW 1 for a natively-huge crop (a 48MP upload whose MRZ band alone tops the bound) — that
  // downscale is exactly what keeps the band off the WASM OOM cliff, so it must not be floored at 1.
  let scale = Math.max(1, opts.upscale)
  if (cw > 0 && ch > 0) scale = Math.min(scale, Math.sqrt(MAX_PREPROCESSED_PIXELS / (cw * ch)))
  const dw = Math.max(1, Math.round(cw * scale))
  const dh = Math.max(1, Math.round(ch * scale))

  const dst = document.createElement('canvas')
  dst.width = dw
  dst.height = dh
  const dctx = dst.getContext('2d')
  if (!dctx) throw new Error('mrz-ocr-tesseract: no 2d context')
  dctx.drawImage(src, cx, cy, cw, ch, 0, 0, dw, dh)

  // Luma → contrast stretch → optional invert → CLAMPED GRAYSCALE (not a fixed-128 threshold: that
  // cancels the contrast sweep — see the loop). Tesseract's own Leptonica Otsu thresholds internally.
  const band = dctx.getImageData(0, 0, dw, dh)
  const px = band.data
  const contrast = opts.contrast
  for (let i = 0; i < px.length; i += 4) {
    // Rec. 601 luma.
    let v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    v = (v - 128) * contrast + 128
    if (opts.invert) v = 255 - v
    // ⚠️ GRAYSCALE, NOT a fixed 128 threshold. Binarizing at 128 after a contrast PIVOT of 128
    // cancels the contrast — (v-128)*c+128 >= 128 ⟺ v >= 128 for every c>0 — so all four variants
    // would hand Tesseract a byte-identical image and the sweep would do nothing. Passing clamped
    // grayscale keeps the contrast variants distinct and lets Leptonica's Otsu threshold internally.
    const g = v < 0 ? 0 : v > 255 ? 255 : v
    px[i] = px[i + 1] = px[i + 2] = g
    px[i + 3] = 255
  }
  dctx.putImageData(band, 0, 0)
  return dst
}

/**
 * A Tesseract-backed OcrEngine + its disposer. Pass the engine to `readMrz(image, engine)`; call
 * `terminate()` on unmount so the worker (and its WASM heap) is released and the OS camera/CPU is
 * not held. Creating the engine does NOT create the worker — the worker is lazily built on the first
 * `readMrz` call so merely opening the page pays nothing.
 */
export function createMrzOcrEngine(): { engine: OcrEngine; ready: () => Promise<void>; terminate: () => Promise<void> } {
  // Per-engine worker (see createTesseractWorker). Built lazily on the first read; a failed build
  // clears the slot ONLY if it is still the current attempt, so a retry gets a fresh worker and a
  // late rejection cannot null a healthy replacement.
  let workerPromise: Promise<TesseractWorker> | null = null
  // ⚠️ ONCE TERMINATED, STAY DEAD. Without this, an abandoned scan (its attempt reset/tier-switched)
  // whose `readMrz` is still in flight would call ensureWorker after terminate() nulled workerPromise,
  // silently REBUILD a fresh ~6MB worker inside a discarded engine that nothing ever terminates — an
  // orphaned WASM heap + re-download per abandoned attempt (fable). A dead engine rejects instead.
  let dead = false
  const ensureWorker = (): Promise<TesseractWorker> => {
    if (dead) return Promise.reject(new Error('mrz-ocr-tesseract: engine terminated'))
    if (!workerPromise) {
      const p = createTesseractWorker()
      workerPromise = p
      p.catch(() => { if (workerPromise === p) workerPromise = null })
    }
    return workerPromise
  }

  const engine: OcrEngine = async (image, opts) => {
    const canvas = preprocess(image, opts)
    const worker = await ensureWorker()
    const { data } = await worker.recognize(canvas)
    return data.text
  }
  // Warm the worker (the one-time ~6MB download + compile). NOT bounded by the read timeout — a
  // slow-network user must not time out mid-download and re-fetch from zero every retry. But it IS
  // capped generously (90s) so a genuinely HUNG fetch (open socket, no bytes) can't leave the caller
  // showing "Reading…" forever; on the cap the caller falls to manual entry.
  const ready = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        ensureWorker(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('ocr_init_timeout')), 90_000) }),
      ])
    } finally {
      if (timer) clearTimeout(timer) // no orphaned 90s timer / dangling rejection after a fast load
    }
  }
  const terminate = async () => {
    dead = true
    const p = workerPromise
    workerPromise = null
    if (p) {
      try {
        await (await p).terminate()
      } catch {
        // A worker that failed to build or is already gone needs no teardown.
      }
    }
  }
  return { engine, ready, terminate }
}
