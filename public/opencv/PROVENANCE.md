# public/opencv — on-device document-edge detection

Self-hosted (CSP is `connect-src 'self'`; no CDN) OpenCV.js + jscanify, used ONLY on the seller
identity-verification document step to auto-capture the passport by detecting its rectangular edges
(a real detector, not a pixel heuristic). Lazy-loaded on that step; never on any other route.

## Files

- **opencv.js** (~8.98 MB) — the official OpenCV.js WebAssembly build (imgproc: Canny / contours /
  approxPolyDP / warpPerspective). WASM is embedded (self-contained; no separate `.wasm` fetch).
- **jscanify.js** (~7.5 KB) — jscanify v1.4.3 (MIT, github.com/puffinsoft/jscanify): finds the biggest
  paper contour and returns its four corners. A thin wrapper over the OpenCV calls above.

## Source

Both extracted VERBATIM from the `jscanify@1.4.3` npm package (`package/src/opencv.js`,
`package/src/jscanify.js`), which bundles the OpenCV.js build it targets. `npm pack jscanify@1.4.3`.

## CSP

opencv.js runs WebAssembly; `script-src` already carries `'unsafe-eval'` / `'wasm-unsafe-eval'` (for
the Tesseract MRZ reader — see public/tesseract/PROVENANCE.md), which covers this. Loaded from
`/opencv/*` (same origin) so `script-src 'self'` allows it; no external requests.

⚠️ Large binary assets: excluded from ESLint and from what the second-opinion reviewers read (still
hashed). Do not edit by hand.
