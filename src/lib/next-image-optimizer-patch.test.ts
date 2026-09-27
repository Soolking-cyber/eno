import { describe, it, expect } from 'vitest'
import Module, { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AFTER, BEFORE, classify, patchImageOptimizer } from '../../scripts/patch-next-image-optimizer.mjs'

/**
 * ⛔ THE NEXT 16.3.x `/_next/image` WEDGE, REPRODUCED IN-PROCESS — AND THE PATCH THAT FIXES IT.
 * scripts/patch-next-image-optimizer.mjs has the mechanism. This runs the INSTALLED Next's own
 * `fetchInternalImage` + `serveStatic` against a requester whose socket is already dead (a dropped
 * request), once as Next ships it and once patched. Neither copy is written to disk: each is compiled
 * as a module AT the real file's path, so its relative requires resolve to the real Next beside it.
 * That keeps this independent of whether `npm run build` has patched node_modules yet — CI's unit
 * job restores node_modules from a cache and never builds.
 */
const require = createRequire(import.meta.url)
const FILE = require.resolve('next/dist/server/image-optimizer.js')
const { serveStatic } = require('next/dist/server/serve-static') as {
  serveStatic: (req: unknown, res: unknown, file: string, opts: { root: string }) => Promise<void>
}
type Optimizer = {
  fetchInternalImage: (href: string, req: unknown, res: unknown, max: number, handle: (req: unknown, res: unknown) => Promise<void>) => Promise<{ buffer: Buffer }>
}

function compile(source: string): Optimizer {
  const M = Module as unknown as { _nodeModulePaths(dir: string): string[] }
  const m = new Module(FILE) as Module & { _compile(src: string, file: string): void }
  m.filename = FILE
  m.paths = M._nodeModulePaths(path.dirname(FILE))
  m._compile(source, FILE)
  return m.exports as Optimizer
}

const installed = readFileSync(FILE, 'utf8')
const state = classify(installed)
// Next as shipped, whatever node_modules holds right now (a build patches it in place).
const shipped = state === 'patched' ? installed.replace(AFTER, BEFORE) : installed

const root = mkdtempSync(path.join(tmpdir(), 'eno-img-wedge-'))
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
writeFileSync(path.join(root, 'icon.png'), PNG)

/** One internal read of `/icon.png`, raced against `ms`. `writable:false` = the browser has gone. */
function read(opt: Optimizer, writable: boolean, ms: number) {
  const socket = Object.assign(new EventEmitter(), { writable, destroyed: !writable, encrypted: false, remoteAddress: '127.0.0.1' })
  return Promise.race([
    opt.fetchInternalImage('/icon.png', { method: 'GET', socket }, {}, 50_000_000, (req, res) => serveStatic(req, res, 'icon.png', { root }))
      .then((r) => ({ settled: true as const, bytes: r.buffer.length })),
    new Promise<{ settled: false }>((resolve) => setTimeout(() => resolve({ settled: false }), ms)),
  ])
}

describe('Next image-optimizer dropped-request wedge (vercel/next.js#98168 backport)', () => {
  it('recognises the installed Next', () => {
    expect(['vulnerable', 'patched', 'fixed'], `classify() = ${state}: the patch script would fail the build`).toContain(state)
  })

  it.runIf(state !== 'fixed')('CONTROL: Next as shipped never settles an internal read whose requester dropped', async () => {
    expect(classify(shipped)).toBe('vulnerable')
    expect(await read(compile(shipped), false, 1_500)).toEqual({ settled: false })
  })

  it('patched, the same dropped read settles with the whole file', async () => {
    const { source } = patchImageOptimizer(shipped)
    expect(classify(source)).toBe(state === 'fixed' ? 'fixed' : 'patched')
    const opt = compile(source)
    expect(await read(opt, false, 3_000)).toEqual({ settled: true, bytes: PNG.length })
    // …and a live requester still gets it, i.e. the request mock kept the socket it needs.
    expect(await read(opt, true, 3_000)).toEqual({ settled: true, bytes: PNG.length })
  })

  it('is idempotent and refuses a shape it does not know', () => {
    const once = patchImageOptimizer(shipped).source
    expect(patchImageOptimizer(once).source).toBe(once)
    expect(() => patchImageOptimizer('module.exports = {}')).toThrow(/shape this patch does not know/)
  })

  it('runs first in every build, and the runner image refuses an unpatched copy', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts.build.startsWith('node scripts/patch-next-image-optimizer.mjs && ')).toBe(true)
    const dockerfile = readFileSync('Dockerfile', 'utf8')
    const runner = dockerfile.slice(dockerfile.indexOf('AS runner'))
    expect(runner).toContain("node_modules/next/dist/server/image-optimizer.js")
    expect(runner).toContain('socket: _req\\.socket,\\s*maximumResponseBody')
  })
})
