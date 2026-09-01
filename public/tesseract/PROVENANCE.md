# Self-hosted Tesseract assets (on-device passport MRZ OCR)

Served at `/tesseract/*` for the stage-1 identity verification passport scan
(`src/lib/identity/mrz-ocr-tesseract.ts`). Self-hosted, NOT from a CDN, because the
site CSP is `connect-src 'self'` / `worker-src 'self' blob:` — a CDN would be blocked.

| file | source | version | license |
|---|---|---|---|
| `worker.min.js` | tesseract.js | 6.0.1 | Apache-2.0 |
| `tesseract-core-simd-lstm.wasm.js` | tesseract.js-core | 6.1.2 | Apache-2.0 |
| `eng.traineddata` (UNCOMPRESSED — the adapter fetches the bare name with `gzip:false` to avoid a `.gz` double-decompress if a CDN sets `Content-Encoding: gzip`) | tessdata_fast 4.0.0 (tessdata.projectnaptha.com, gunzipped) | 4.0.0 fast | Apache-2.0 |

Integrity (verified byte-identical to the pinned npm packages before commit):
`worker.min.js` == `node_modules/tesseract.js/dist/worker.min.js`,
`tesseract-core-simd-lstm.wasm.js` == `node_modules/tesseract.js-core/…`,
`eng.traineddata` sha256 = `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`.

SIMD+LSTM core only (non-threaded — no SharedArrayBuffer/COOP-COEP needed). A browser
without WASM SIMD gets no core and the scan degrades to manual MRZ entry (the pre-existing
fallback). To refresh: re-copy the two files from `node_modules/tesseract.js*` after a
version bump, and re-fetch the traineddata.
