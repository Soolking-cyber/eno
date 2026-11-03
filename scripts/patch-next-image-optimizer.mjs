#!/usr/bin/env node
/**
 * ⛔ BACKPORT OF vercel/next.js#98168 — ONE DROPPED REQUEST WEDGES A `/_next/image` VARIANT UNTIL
 * THE SERVER RESTARTS. Next 16.3.x has the bug; the fix shipped in 16.4.0-canary.26 and was not
 * backported. It runs at the start of `npm run build`, so every build path applies it: the box's
 * Docker builder stage (`npm run build` in the Dockerfile), CI's e2e job and a local build. The
 * standalone bundle traces `node_modules/next/dist/server/image-optimizer.js` AFTER this has run,
 * and the Dockerfile's runner stage refuses to finish an image whose copy is still unpatched.
 *
 * THE MECHANISM (measured 2026-09-27 on 16.3.1 and on the real 16.3.6 files). For a LOCAL `url=`
 * the optimizer reads the file through a mocked request/response pair, and 16.3.x gives BOTH mocks
 * the requester's real socket. `send` (under `serveStatic`) treats `socket.writable === false` as a
 * finished response, so when the browser has already dropped the request it destroys its file stream
 * and never ends the mock. `fetchInternalImage` awaits that mock with no timeout, the per-variant
 * dedupe entry (url × w × q × Accept) never settles, and every later request for the variant hangs
 * until restart — 15 KB of heap per wedged key, 14 KB per parked request, never freed.
 * `images.localPatterns` (next.config.ts) already refuses every public/ file, but Next appends
 * `/_next/static/media/**` to it itself and no config removes it, so without this the favicon,
 * icons and fonts there stayed wedgeable from outside (every `#n` fragment is a fresh key).
 *
 * THE FIX IS UPSTREAM'S, VERBATIM: the mocked REQUEST keeps the socket (resolve-routes reads
 * `socket.encrypted`, base-server reads `remoteAddress`; the fallback socket is a Proxy that throws
 * on anything else, so `socket: null` on both — an earlier idea — is not safe), the mocked RESPONSE
 * gets none. ⚠️ Not a timeout: the hang is at `await handleRequest(…)`, before `hasStreamed`, and a
 * timeout would turn a success into a 5xx without releasing anything the socket fix does not.
 *
 * ⚠️ DELETE THE BACKPORT (not the scan patch below; read that one again on its own) ONCE NEXT IS >= 16.4.0. Until then it FAILS THE BUILD
 * when it meets a shape it does not recognise, instead of guessing: a silent no-op here would ship
 * the wedge again with every gate green.
 *
 * ⛔ THE SECOND PATCH: EVERY PHOTO WAITS FOR A SCAN OF THE WHOLE IMAGE CACHE AFTER EACH RESTART. Next 16's
 * disk LRU learns its entries' sizes by READING EVERY CACHED IMAGE, one at a time (`initCacheEntries`), and
 * `get()` awaits that even for a hit. 28,000 images, then every `/_next/image` that reached the origin hung
 * and then released in the same instant, while pages kept answering: measured 2026-11-02 and 11-03, 8 and
 * 16 minutes after a swap, under the deploy's warm-up, with nginx answering 504 at 60 s (127 of them to 51
 * clients on 11-02). So: the scan stats instead of reading, in batches, and neither a hit nor a new photo
 * waits for it. The LRU catches up when the scan ends. Without the warm-up the scan took 10.5 s on a Mac.
 * This one has no upstream fix to compare with, so an unknown shape fails the build the same way.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/** Written into the patched file so a second run is a no-op. Bump the suffix if AFTER changes. */
export const MARK = 'eno-patch: vercel/next.js#98168 backport v1'

/** The 16.3.x block, byte for byte (identical in 16.3.1, 16.3.6 and 16.3.8). */
export const BEFORE = `        const mocked = (0, _mockrequest.createRequestResponseMocks)({
            url: href,
            method,
            socket: _req.socket,
            maximumResponseBody
        });`

export const AFTER = `        // ${MARK} (scripts/patch-next-image-optimizer.mjs). The mocked RESPONSE must
        // not carry the requester's socket: \`send\` treats a dead socket as a finished response,
        // never ends the mock, and the coalesced cache key hangs until the server restarts.
        const mocked = {
            req: new _mockrequest.MockedRequest({
                url: href,
                method,
                headers: {},
                socket: _req.socket
            }),
            res: new _mockrequest.MockedResponse({
                maximumResponseBody
            })
        };`

/** The part of `fetchInternalImage` that builds the mocks — everything before the internal read. */
function mockSetup(source) {
  const start = source.indexOf('async function fetchInternalImage(')
  if (start < 0) return null
  const end = source.indexOf('await handleRequest(', start)
  return end < 0 ? null : source.slice(start, end)
}

/** Written into the patched file; the Dockerfile's guard looks for it. Bump the suffix if the AFTER blocks change. */
export const SCAN_MARK = 'eno-patch: image cache scan v1'

export const SCAN_BEFORE = `    const entries = [];
    for (const cacheKey of cacheKeys){
        try {
            const { expireAt, buffer } = await readFromCacheDir(cacheDir, cacheKey);
            entries.push({
                key: cacheKey,
                size: buffer.byteLength,
                expireAt
            });
        } catch  {
        // Skip entries that can't be read from disk
        }
    }`

export const SCAN_AFTER = `    const entries = [];
    // ${SCAN_MARK} (scripts/patch-next-image-optimizer.mjs). Sizes only, 64 at a time: reading every
    // image one by one held every photo for minutes after a restart. A file with no size is skipped,
    // which is what reading it did: \`LRUCache.set()\` refuses a size of 0.
    for (let i = 0; i < cacheKeys.length; i += 64) {
        await Promise.all(cacheKeys.slice(i, i + 64).map(async (cacheKey)=>{
            try {
                const dir = (0, _path.join)(/* turbopackIgnore: true */ cacheDir, cacheKey);
                const file = (await _fs.promises.readdir(dir))[0];
                if (!file) return;
                const { size } = await _fs.promises.stat((0, _path.join)(/* turbopackIgnore: true */ dir, file));
                if (size > 0) entries.push({
                    key: cacheKey,
                    size,
                    expireAt: Number(file.split('.', 5)[1])
                });
            } catch  {
            // Skip entries that can't be read from disk
            }
        }));
    }`

export const HIT_BEFORE = `            const lru = await this.cacheDiskLRU;
            lru == null ? void 0 : lru.get(cacheKey);`

export const HIT_AFTER = `            // ${SCAN_MARK}: a hit never waits for the scan; the promotion lands when it is done.
            Promise.resolve(this.cacheDiskLRU).then((lru)=>lru == null ? void 0 : lru.get(cacheKey)).catch(()=>{});`

export const SET_BEFORE = `            const lru = await this.cacheDiskLRU;
            const success = lru == null ? void 0 : lru.set(cacheKey, value.buffer.byteLength);`

export const SET_AFTER = `            // ${SCAN_MARK}: nor does a new photo. Once the scan is done this is Next's own admission, unchanged.
            const size = value.buffer.byteLength;
            const lru = await Promise.race([this.cacheDiskLRU, null]);
            const success = lru ? lru.set(cacheKey, size) : size > 0;`

export const WRITE_BEFORE = `            await writeToCacheDir(this.cacheDir, cacheKey, value.extension, revalidate, expireAt, value.buffer, value.etag, value.upstreamEtag);`

export const WRITE_AFTER = `${WRITE_BEFORE}
            // ${SCAN_MARK}: written during the scan, the LRU hears of it when the scan ends, and one it refuses is deleted.
            // After the write, so the delete can never run ahead of the file.
            if (!lru) Promise.resolve(this.cacheDiskLRU).then((later)=>{
                if (later && later.set(cacheKey, size) === false) return deleteFromCacheDir(this.cacheDir, cacheKey);
            }).catch((err)=>_log.error(\`Failed to track image in cache \${cacheKey}\`, err));`

/** `unpatched`, `patched`, or `unknown` when any block has moved. Unknown fails the build. */
export function classifyScan(source) {
  if (source.includes(SCAN_AFTER) && source.includes(HIT_AFTER) && source.includes(SET_AFTER) && source.includes(WRITE_AFTER)) return 'patched'
  if (source.split(SCAN_BEFORE).length === 2 && source.split(HIT_BEFORE).length === 2 && source.split(SET_BEFORE).length === 2 && source.split(WRITE_BEFORE).length === 2) return 'unpatched'
  return 'unknown'
}

/**
 * `vulnerable`  — 16.3.x as shipped: the response mock gets the requester's socket.
 * `patched`     — this script already ran.
 * `fixed`       — upstream's shape (Next >= 16.4.0-canary.26): a response mock built without one.
 * `unknown`     — anything else. Treated as a failure: re-read the upstream PR before trusting it.
 */
export function classify(source) {
  const setup = mockSetup(source)
  if (!setup) return 'unknown'
  if (setup.includes(MARK)) return 'patched'
  if (/createRequestResponseMocks\)\(\{[^}]*\bsocket\s*:/.test(setup)) return 'vulnerable'
  const res = /new _mockrequest\.MockedResponse\(\{([^}]*)\}\)/.exec(setup)
  if (res && !/\bsocket\b/.test(res[1]) && !setup.includes('createRequestResponseMocks')) return 'fixed'
  return 'unknown'
}

/** Pure: returns the patched source, or throws when the file is not a shape this knows. */
export function patchImageOptimizer(source) {
  const state = classify(source)
  if (state === 'unknown') {
    throw new Error("next/dist/server/image-optimizer.js: fetchInternalImage has a shape this patch does not know. Check whether vercel/next.js#98168 is in this Next version; if it is, delete the backport from this script.mjs and its callers, otherwise update BEFORE/AFTER.")
  }
  if (state === 'vulnerable' && source.split(BEFORE).length !== 2) {
    throw new Error('next/dist/server/image-optimizer.js: the vulnerable mock setup is present but not byte-identical to BEFORE (or appears twice); update the patch.')
  }
  let out = state === 'vulnerable' ? source.replace(BEFORE, AFTER) : source
  if (state === 'vulnerable' && classify(out) !== 'patched') throw new Error('patch applied but the result does not classify as patched')
  const scan = classifyScan(out)
  if (scan === 'unknown') {
    throw new Error('next/dist/server/image-optimizer.js: the image cache scan has a shape this patch does not know. Read initCacheEntries and ImageOptimizerCache.get again before changing it: a silent no-op holds every photo after a restart.')
  }
  if (scan === 'unpatched') out = out.replace(SCAN_BEFORE, () => SCAN_AFTER).replace(HIT_BEFORE, () => HIT_AFTER).replace(SET_BEFORE, () => SET_AFTER).replace(WRITE_BEFORE, () => WRITE_AFTER)
  if (classifyScan(out) !== 'patched') throw new Error('scan patch applied but the result does not classify as patched')
  return { state, scan, source: out }
}

// CLI: patch the installed copy in place. `--check` only reports, and fails if still vulnerable.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const require = createRequire(import.meta.url)
  const file = require.resolve('next/dist/server/image-optimizer.js', { paths: [process.cwd()] })
  const { version } = require(require.resolve('next/package.json', { paths: [process.cwd()] }))
  const src = readFileSync(file, 'utf8')
  const check = process.argv.includes('--check')
  try {
    if (check) {
      const state = classify(src)
      const scan = classifyScan(src)
      console.log(`next ${version} image-optimizer: ${state}, cache scan ${scan}`)
      process.exit((state === 'patched' || state === 'fixed') && scan === 'patched' ? 0 : 1)
    }
    const { state, source } = patchImageOptimizer(src)
    if (source !== src) writeFileSync(file, source)
    console.log(source !== src ? `next ${version}: patched image-optimizer.js` : `next ${version}: image-optimizer.js already patched`)
    if (state === 'fixed') console.log(`next ${version} already contains vercel/next.js#98168: delete that backport from scripts/patch-next-image-optimizer.mjs`)
  } catch (e) {
    console.error(`✗ ${e.message}`)
    process.exit(1)
  }
}
