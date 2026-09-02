/* ── Document-edge detection Web Worker ──────────────────────────────────────────────────────────
 * Runs OpenCV.js OFF the main thread (loading/compiling the ~9MB WASM on the main thread froze the
 * page). The page posts a downscaled RGBA frame; this replies with the fraction of the frame a real
 * DOCUMENT quadrilateral fills — or null if there isn't one. See public/opencv/PROVENANCE.md.
 *
 * ⚠️ WHY NOT jscanify.findPaperContour: it returns the single largest contour and a bounding box, so
 * ANY big edge in a scene (a wall, a monitor, the frame border) reads as ~full coverage → it captured
 * instantly with no passport. Here we require a genuine 4-vertex CONVEX quad of document-like size —
 * a face or a room does not produce one.
 */
/* global importScripts, cv */
importScripts('/opencv/opencv.js')

let ready = false
function markReady() { ready = true; postMessage({ type: 'ready' }) }
if (typeof cv !== 'undefined' && cv.Mat) markReady()
else if (typeof cv !== 'undefined') cv.onRuntimeInitialized = markReady
else postMessage({ type: 'error', message: 'cv global missing' })

/** Return the coverage (0..1) of the best document-like rectangle in the frame, or null.
 *
 * ⚠️ RECTANGULARITY, not an exact 4-vertex polygon. Requiring `approxPolyDP === 4 corners` was too
 * brittle — a real passport (rounded corners, a hand over an edge, a busy background) rarely gives a
 * clean 4-gon, so it detected NOTHING. Instead: fit each contour's rotated bounding rectangle
 * (minAreaRect) and keep it only if the contour FILLS that rectangle well (a rectangle ≈ 1.0; a face
 * or a blob is far lower) AND has a document-like aspect. Robust to skew, rounded corners, and noise;
 * still rejects faces/rooms (low rectangularity) and the whole-frame border (coverage capped). */
function detectQuad(src, w, h) {
  const frameArea = w * h
  const gray = new cv.Mat(), blur = new cv.Mat(), edges = new cv.Mat()
  const kernel = cv.Mat.ones(5, 5, cv.CV_8U)
  const contours = new cv.MatVector(), hierarchy = new cv.Mat()
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT)
    cv.Canny(blur, edges, 50, 150)
    cv.dilate(edges, edges, kernel) // close small gaps so the document's outline is one contour
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    let bestCov = null
    let bestBox = null // axis-aligned bounding box of the detected document, NORMALISED 0..1
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i)
      const area = cv.contourArea(cnt)
      if (area < frameArea * 0.12) { cnt.delete(); continue } // too small to be the held document
      const rect = cv.minAreaRect(cnt)
      const rw = rect.size.width, rh = rect.size.height
      const rectArea = rw * rh
      const rectangularity = rectArea > 0 ? area / rectArea : 0 // 1.0 = perfectly fills its bounding rectangle
      const aspect = rectArea > 0 ? Math.max(rw, rh) / Math.min(rw, rh) : 99 // passport 1.42, ID 1.58; allow skew
      const cov = rectArea / frameArea
      // ⚠️ Deliberately FORGIVING — a real passport held in a hand against a busy background rarely
      // gives a textbook rectangle. Better to detect it loosely (the hold-still fallback + review step
      // catch a bad shot) than to never fire on a real passport.
      const isDocument =
        rectangularity >= 0.6 &&
        aspect >= 1.0 && aspect <= 3.0 &&
        cov >= 0.12 && cov <= 0.98 // a chunk of the frame, but not the whole thing (that's a wall/border)
      if (isDocument && (bestCov == null || cov > bestCov)) {
        bestCov = cov
        const br = cv.boundingRect(cnt) // axis-aligned, in frame px → normalise for the caller
        bestBox = { x: br.x / w, y: br.y / h, w: br.width / w, h: br.height / h }
      }
      cnt.delete()
    }
    return bestCov == null ? null : { cov: bestCov, box: bestBox }
  } finally {
    gray.delete(); blur.delete(); edges.delete(); kernel.delete(); contours.delete(); hierarchy.delete()
  }
}

self.onmessage = (e) => {
  const { id, imageData } = e.data || {}
  if (id == null) return
  if (!ready || !imageData) { postMessage({ id, cov: null }); return }
  let src = null
  try {
    src = cv.matFromImageData(imageData)
    const r = detectQuad(src, imageData.width, imageData.height) // { cov, box } | null
    postMessage({ id, cov: r ? r.cov : null, box: r ? r.box : null })
  } catch (err) {
    postMessage({ id, cov: null, box: null })
  } finally {
    try { if (src) src.delete() } catch (_) { /* already gone */ }
  }
}
