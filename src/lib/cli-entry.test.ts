import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { invokedDirectly } from './cli-entry'

/**
 * src/lib/cli-entry.ts — a script's "was I the one that was run?" check, on REAL paths. The case it
 * exists for: started through a symlinked directory, the old `pathToFileURL(argv[1]).href ===
 * import.meta.url` was false, so the script skipped main() and exited 0 in silence.
 */
const root = mkdtempSync(join(tmpdir(), 'cli-entry-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
mkdirSync(join(root, 'real', 'scripts'), { recursive: true })
const script = join(root, 'real', 'scripts', 'job.ts')
writeFileSync(script, '// a script\n')
writeFileSync(join(root, 'real', 'scripts', 'other.ts'), '// another\n')
symlinkSync(join(root, 'real'), join(root, 'link'))
const viaLink = join(root, 'link', 'scripts', 'job.ts')
/** What the module URL is at run time: the RESOLVED file (Node's loader realpaths the main module). */
const moduleUrl = pathToFileURL(script).href

describe('invokedDirectly', () => {
  it('is true for the script itself, by its own path or through a symlinked directory', () => {
    expect(invokedDirectly(moduleUrl, script)).toBe(true)
    expect(invokedDirectly(moduleUrl, viaLink)).toBe(true)
    // ⛔ The check it replaces, on the same invocation: false — main() would silently not run.
    expect(pathToFileURL(viaLink).href === moduleUrl).toBe(false)
  })

  it('is true when started WITHOUT the extension (`npx tsx scripts/job`), directly or through the link', () => {
    expect(invokedDirectly(moduleUrl, script.replace(/\.ts$/, ''))).toBe(true)
    expect(invokedDirectly(moduleUrl, viaLink.replace(/\.ts$/, ''))).toBe(true)
    expect(pathToFileURL(script.replace(/\.ts$/, '')).href === moduleUrl).toBe(false)
    // …but never for another script's name, nor for an argv[1] that carries some other extension.
    expect(invokedDirectly(moduleUrl, join(root, 'real', 'scripts', 'other'))).toBe(false)
    expect(invokedDirectly(moduleUrl, join(root, 'real', 'scripts', 'job.js'))).toBe(false)
  })

  it('is false when another script was run, when imported by a test runner, or with no argv[1]', () => {
    expect(invokedDirectly(moduleUrl, join(root, 'real', 'scripts', 'other.ts'))).toBe(false)
    expect(invokedDirectly(moduleUrl, join(root, 'link', 'scripts', 'other.ts'))).toBe(false)
    expect(invokedDirectly(moduleUrl, join(root, 'node_modules', 'vitest', 'vitest.mjs'))).toBe(false)
    expect(invokedDirectly(moduleUrl, undefined)).toBe(false)
    expect(invokedDirectly(moduleUrl, '')).toBe(false)
  })

  it('reads process.argv[1] by default — which, under the test runner, is not this module', () => {
    expect(invokedDirectly(moduleUrl)).toBe(false)
    expect(invokedDirectly(import.meta.url)).toBe(false)
  })
})
