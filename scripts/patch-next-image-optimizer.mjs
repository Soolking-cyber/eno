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
 * ⚠️ DELETE THIS FILE (and its call in package.json `build`, the Dockerfile guard and
 * src/lib/next-image-optimizer-patch.test.ts) ONCE NEXT IS >= 16.4.0. Until then it FAILS THE BUILD
 * when it meets a shape it does not recognise, instead of guessing: a silent no-op here would ship
 * the wedge again with every gate green.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/** Written into the patched file so a second run is a no-op. Bump the suffix if AFTER changes. */
export const MARK = 'eno-patch: vercel/next.js#98168 backport v1'

/** The 16.3.x block, byte for byte (identical in 16.3.1 and 16.3.6). */
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
  if (state === 'patched' || state === 'fixed') return { state, source }
  if (state === 'unknown') {
    throw new Error("next/dist/server/image-optimizer.js: fetchInternalImage has a shape this patch does not know. Check whether vercel/next.js#98168 is in this Next version; if it is, delete scripts/patch-next-image-optimizer.mjs and its callers, otherwise update BEFORE/AFTER.")
  }
  if (source.split(BEFORE).length !== 2) {
    throw new Error('next/dist/server/image-optimizer.js: the vulnerable mock setup is present but not byte-identical to BEFORE (or appears twice); update the patch.')
  }
  const out = source.replace(BEFORE, AFTER)
  if (classify(out) !== 'patched') throw new Error('patch applied but the result does not classify as patched')
  return { state: 'vulnerable', source: out }
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
      console.log(`next ${version} image-optimizer: ${state}`)
      process.exit(state === 'patched' || state === 'fixed' ? 0 : 1)
    }
    const { state, source } = patchImageOptimizer(src)
    if (state === 'vulnerable') {
      writeFileSync(file, source)
      console.log(`next ${version}: patched image-optimizer.js (vercel/next.js#98168 backport)`)
    } else if (state === 'fixed') {
      console.log(`next ${version} already contains vercel/next.js#98168 — delete scripts/patch-next-image-optimizer.mjs and its callers`)
    } else {
      console.log(`next ${version}: image-optimizer.js already patched`)
    }
  } catch (e) {
    console.error(`✗ ${e.message}`)
    process.exit(1)
  }
}
