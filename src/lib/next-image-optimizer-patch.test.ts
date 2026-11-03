import { describe, it, expect, vi } from 'vitest'
import Module, { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { existsSync, promises as fsPromises, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AFTER, BEFORE, HIT_AFTER, HIT_BEFORE, SCAN_AFTER, SCAN_BEFORE, SET_AFTER, SET_BEFORE, WRITE_AFTER, WRITE_BEFORE, classify, classifyScan, patchImageOptimizer } from '../../scripts/patch-next-image-optimizer.mjs'

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
const { resetDiskLRU } = require('next/dist/server/lib/disk-lru-cache.external') as { resetDiskLRU: () => void }
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
    expect(runner).toContain('eno-patch: image cache scan')
  })
})

/**
 * ⛔ EVERY PHOTO WAITED FOR A SCAN OF THE WHOLE IMAGE CACHE AFTER A RESTART. Same method as above: the installed
 * Next's own ImageOptimizerCache, compiled as shipped and patched, with an LRU promise that never settles standing
 * in for a scan still running.
 */
describe('the image cache scan after a restart', () => {
  type Cache = {
    cacheDiskLRU: Promise<unknown>
    get(key: string): Promise<{ value: { buffer: Buffer } } | null>
    set(key: string, value: unknown, opts: { cacheControl: { revalidate: number } }): Promise<void>
  }
  type Compiled = { ImageOptimizerCache: new (o: unknown) => Cache }
  const shippedScan = [[SCAN_AFTER, SCAN_BEFORE], [HIT_AFTER, HIT_BEFORE], [SET_AFTER, SET_BEFORE], [WRITE_AFTER, WRITE_BEFORE]].reduce((s, [a, b]) => s.replace(a, () => b), shipped)
  const patchedScan = patchImageOptimizer(shippedScan).source
  const BODY = Buffer.from('fake image bytes')
  const config = { images: { minimumCacheTTL: 60, maximumDiskCacheSize: undefined }, experimental: { isrFlushToDisk: true } }
  const seeded = (keys: string[]) => {
    const distDir = mkdtempSync(path.join(tmpdir(), 'eno-img-scan-'))
    for (const k of keys) {
      const dir = path.join(distDir, 'cache', 'images', k)
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, `60.${Date.now() + 60_000}.etag.up.webp`), BODY)
    }
    return distDir
  }
  const cacheFrom = (source: string, distDir: string) => {
    resetDiskLRU()
    return new (compile(source) as unknown as Compiled).ImageOptimizerCache({ distDir, nextConfig: config })
  }
  const stuck = (c: Cache) => { c.cacheDiskLRU = new Promise(() => {}) }
  const race = <T,>(p: Promise<T>) => Promise.race([p.then((v) => ({ settled: true as const, v })), new Promise<{ settled: false }>((r) => setTimeout(() => r({ settled: false }), 400))])
  const entry = { kind: 'IMAGE', etag: 'e', buffer: BODY, extension: 'webp', upstreamEtag: 'u' }

  it('recognises the installed Next', () => {
    expect(classifyScan(shippedScan)).toBe('unpatched')
    expect(classifyScan(patchedScan)).toBe('patched')
    expect(patchImageOptimizer(patchedScan).source).toBe(patchedScan)
  })

  it('CONTROL: as shipped, a cached photo and a new one both wait for the scan', async () => {
    const c = cacheFrom(shippedScan, seeded(['hit']))
    stuck(c)
    expect((await race(c.get('hit'))).settled).toBe(false)
    expect((await race(c.set('new', entry, { cacheControl: { revalidate: 60 } }))).settled).toBe(false)
  })

  it('patched, neither waits, and the new photo is on disk', async () => {
    const distDir = seeded(['hit'])
    const c = cacheFrom(patchedScan, distDir)
    stuck(c)
    const hit = await race(c.get('hit'))
    expect(hit.settled && hit.v?.value.buffer.equals(BODY)).toBe(true)
    expect((await race(c.set('new', entry, { cacheControl: { revalidate: 60 } }))).settled).toBe(true)
    expect(readdirSync(path.join(distDir, 'cache', 'images', 'new'))).toHaveLength(1)
  })

  it('when a slow scan ends, a promotion and a new photo reach the LRU', async () => {
    const c = cacheFrom(patchedScan, seeded(['hit']))
    let finish!: (lru: unknown) => void
    c.cacheDiskLRU = new Promise((r) => { finish = r })
    await c.get('hit')
    await c.set('new', entry, { cacheControl: { revalidate: 60 } })
    const lru = { get: vi.fn(), set: vi.fn(() => true) }
    finish(lru)
    await new Promise((r) => setTimeout(r, 0))
    expect(lru.get).toHaveBeenCalledWith('hit')
    expect(lru.set).toHaveBeenCalledWith('new', BODY.byteLength)
  })

  it('a photo the LRU refuses when the scan ends is taken off the disk', async () => {
    const distDir = seeded([])
    const c = cacheFrom(patchedScan, distDir)
    let finish!: (lru: unknown) => void
    c.cacheDiskLRU = new Promise((r) => { finish = r })
    await c.set('big', entry, { cacheControl: { revalidate: 60 } })
    expect(existsSync(path.join(distDir, 'cache', 'images', 'big'))).toBe(true)
    finish({ get: vi.fn(), set: vi.fn(() => false) })
    await vi.waitFor(() => expect(existsSync(path.join(distDir, 'cache', 'images', 'big'))).toBe(false))
  })

  it('a scan that ends in the middle of the write: the refused photo still comes off the disk', async () => {
    const distDir = seeded([])
    const c = cacheFrom(patchedScan, distDir)
    let finish!: (lru: unknown) => void
    c.cacheDiskLRU = new Promise((r) => { finish = r })
    const real = fsPromises.writeFile
    const write = vi.spyOn(fsPromises, 'writeFile').mockImplementation(async (...args: Parameters<typeof real>) => {
      finish({ get: vi.fn(), set: vi.fn(() => false) })
      await new Promise((r) => setTimeout(r, 20))
      return real(...args)
    })
    await c.set('big', entry, { cacheControl: { revalidate: 60 } })
    write.mockRestore()
    await vi.waitFor(() => expect(existsSync(path.join(distDir, 'cache', 'images', 'big'))).toBe(false))
  })

  it('once the scan is done Next still refuses what the LRU cannot hold, and an empty image', async () => {
    const distDir = seeded([])
    resetDiskLRU()
    const c = new (compile(patchedScan) as unknown as Compiled).ImageOptimizerCache({ distDir, nextConfig: { ...config, images: { ...config.images, maximumDiskCacheSize: 4 } } })
    await c.cacheDiskLRU
    await c.set('big', entry, { cacheControl: { revalidate: 60 } })
    expect(existsSync(path.join(distDir, 'cache', 'images', 'big'))).toBe(false)
    await c.set('empty', { ...entry, buffer: Buffer.alloc(0) }, { cacheControl: { revalidate: 60 } })
    expect(existsSync(path.join(distDir, 'cache', 'images', 'empty'))).toBe(false)
  })

  it('the scan reads past its first batch of 64', async () => {
    const keys = Array.from({ length: 130 }, (_, i) => `k${i}`)
    const lru = (await cacheFrom(patchedScan, seeded(keys)).cacheDiskLRU) as { has(k: string): boolean; size: number }
    for (const k of keys) expect(lru.has(k), k).toBe(true)
  })

  it('the scan learns the same entries from sizes alone, and reads no image', async () => {
    const distDir = seeded(['a', 'b', 'c'])
    const empty = path.join(distDir, 'cache', 'images', 'empty')
    mkdirSync(empty)
    writeFileSync(path.join(empty, `60.${Date.now() + 60_000}.etag.up.webp`), '')
    mkdirSync(path.join(distDir, 'cache', 'images', 'no-file'))
    const reads = vi.spyOn(fsPromises, 'readFile')
    const lru = (await cacheFrom(patchedScan, distDir).cacheDiskLRU) as { has(k: string): boolean; currentSize: number; size: number }
    expect(reads).not.toHaveBeenCalled()
    reads.mockRestore()
    for (const k of ['a', 'b', 'c']) expect(lru.has(k), k).toBe(true)
    for (const k of ['empty', 'no-file']) expect(lru.has(k), k).toBe(false)
    expect(lru.currentSize).toBe(3 * BODY.byteLength)
  })
})
