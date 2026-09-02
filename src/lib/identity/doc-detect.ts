'use client'

// ── ON-DEVICE DOCUMENT-EDGE DETECTION (auto-capture) ─────────────────────────────────────────────
//
// The seamless way to auto-capture a passport is to detect the DOCUMENT ITSELF by its rectangular
// edges — a real computer-vision detector, not a pixel heuristic that can't tell a page from a face.
// This drives a Web Worker (public/opencv/detect-worker.js) that runs self-hosted OpenCV.js + jscanify
// OFF the main thread — loading/compiling the ~9MB OpenCV WASM on the main thread froze the page, so
// all of it lives in the worker. The page grabs a small RGBA frame and asks the worker how much of it
// the largest paper quad fills; KycCapture auto-captures once that is large and stable. OCR (Tesseract
// MRZ) still runs POST-capture for autofill — this module only decides WHEN.
//
// ⚠️ LAZY + degrades gracefully: the worker (and its ~9MB WASM) loads only when the document step arms
// the detector; everything falls back to the manual shutter if the worker can't start.

/** Axis-aligned bounding box of the detected document, as fractions (0..1) of the frame. */
export type DocBox = { x: number; y: number; w: number; h: number }
export type DocResult = { cov: number; box: DocBox | null }

export type DocDetector = {
  /** Detect a document rectangle in the frame → its coverage (0..1) + normalised bounding box, or
   *  null if none. Runs in the worker; the ImageData buffer is TRANSFERRED (do not reuse it). */
  detect: (frame: ImageData) => Promise<DocResult | null>
  dispose: () => void
}

/**
 * Spin up the detection worker and wait for its OpenCV runtime to be ready. Rejects if the worker
 * can't start or WASM init times out — the caller then falls back to the manual shutter.
 */
export async function createDocDetector(): Promise<DocDetector> {
  const worker = new Worker('/opencv/detect-worker.js')
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => { fail(new Error('doc-detect: worker init timeout')) }, 40_000)
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'ready') { cleanup(); resolve() }
      else if (e.data?.type === 'error') { fail(new Error(`doc-detect: ${e.data.message}`)) }
    }
    const onErr = () => { fail(new Error('doc-detect: worker error')) }
    function cleanup() { clearTimeout(t); worker.removeEventListener('message', onMsg); worker.removeEventListener('error', onErr) }
    // ⛔ TERMINATE ON FAILURE. Init fails whenever OpenCV's WASM can't load (e.g. a CSP that blocks the
    // data: fetch), and the caller does NOT get the worker handle unless we resolve — so a rejected init
    // that only removed listeners leaked a ~9MB worker on every document-step entry (codex, 2026-09-02).
    function fail(err: Error) { cleanup(); worker.terminate(); reject(err) }
    worker.addEventListener('message', onMsg)
    worker.addEventListener('error', onErr)
  })

  let seq = 0
  const detect = (frame: ImageData): Promise<DocResult | null> =>
    new Promise((resolve) => {
      const id = ++seq
      const onMsg = (e: MessageEvent) => {
        if (e.data?.id !== id) return
        worker.removeEventListener('message', onMsg)
        resolve(e.data.cov == null ? null : { cov: e.data.cov, box: e.data.box ?? null })
      }
      worker.addEventListener('message', onMsg)
      // Transfer the pixel buffer (zero-copy). The caller grabs a fresh frame each time, so detaching it is fine.
      worker.postMessage({ id, imageData: frame }, [frame.data.buffer])
    })

  return { detect, dispose: () => worker.terminate() }
}

/** Grab a downscaled RGBA frame from a video element on the MAIN thread (cheap) to send to the worker. */
export function grabDetectFrame(video: HTMLVideoElement, maxDim = 480): ImageData | null {
  const vw = video.videoWidth, vh = video.videoHeight
  if (!vw || !vh) return null
  const scale = Math.min(1, maxDim / Math.max(vw, vh))
  const w = Math.max(1, Math.round(vw * scale)), h = Math.max(1, Math.round(vh * scale))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const cx = c.getContext('2d', { willReadFrequently: true }); if (!cx) return null
  cx.drawImage(video, 0, 0, w, h)
  try { return cx.getImageData(0, 0, w, h) } catch { return null }
}

/** Grab the DOCUMENT region as a full-resolution still for OCR: crop the video to the detected box
 *  (+ a small margin) so the MRZ band fills far more of the pixels than a full-frame grab would — the
 *  single biggest lever on read success. With no box, returns the whole frame (bounded). */
export function grabDocStill(video: HTMLVideoElement, box: DocBox | null, maxDim = 2200): ImageData | null {
  const vw = video.videoWidth, vh = video.videoHeight
  if (!vw || !vh) return null
  let sx = 0, sy = 0, sw = vw, sh = vh
  if (box && box.w > 0 && box.h > 0) {
    const m = 0.05 // a little margin so a slightly-tight box doesn't clip the MRZ at the edge
    const bx = Math.max(0, box.x - m), by = Math.max(0, box.y - m)
    const bw = Math.min(1 - bx, box.w + 2 * m), bh = Math.min(1 - by, box.h + 2 * m)
    sx = Math.round(bx * vw); sy = Math.round(by * vh); sw = Math.round(bw * vw); sh = Math.round(bh * vh)
  }
  if (sw <= 0 || sh <= 0) { sx = 0; sy = 0; sw = vw; sh = vh }
  const scale = Math.min(1, maxDim / Math.max(sw, sh)) // native resolution of the region (bounded); no upscaling
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const cx = c.getContext('2d', { willReadFrequently: true }); if (!cx) return null
  cx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h)
  try { return cx.getImageData(0, 0, w, h) } catch { return null }
}

/** Put an ImageData onto a canvas so we can crop / downscale it (the source, once captured, is no
 *  longer the live video). */
function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
  c.getContext('2d')?.putImageData(img, 0, 0)
  return c
}

/** A downscaled copy of a captured still, to hand the detector when we want to locate the document in
 *  the STILL itself (the hold-still fallback captured without a box). */
export function downscaleImageData(img: ImageData, maxDim = 480): ImageData | null {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const cx = c.getContext('2d', { willReadFrequently: true }); if (!cx) return null
  cx.drawImage(imageDataToCanvas(img), 0, 0, w, h)
  try { return cx.getImageData(0, 0, w, h) } catch { return null }
}

/** Crop a captured still to a normalised box (+ margin) — used to tighten a full-frame still onto the
 *  passport for OCR once the detector found where it is. */
export function cropImageData(img: ImageData, box: DocBox, margin = 0.05): ImageData | null {
  const bx = Math.max(0, box.x - margin), by = Math.max(0, box.y - margin)
  const bw = Math.min(1 - bx, box.w + 2 * margin), bh = Math.min(1 - by, box.h + 2 * margin)
  const sx = Math.round(bx * img.width), sy = Math.round(by * img.height)
  const sw = Math.round(bw * img.width), sh = Math.round(bh * img.height)
  if (sw <= 0 || sh <= 0) return img
  const c = document.createElement('canvas'); c.width = sw; c.height = sh
  const cx = c.getContext('2d', { willReadFrequently: true }); if (!cx) return null
  cx.drawImage(imageDataToCanvas(img), sx, sy, sw, sh, 0, 0, sw, sh)
  try { return cx.getImageData(0, 0, sw, sh) } catch { return null }
}
