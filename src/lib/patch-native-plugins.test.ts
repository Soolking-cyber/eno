import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
// The Xcode Cloud patch of plugin Swift that Xcode 27 warns about (owner 2026-11-24: "patch it").
import { PATCHES, applyPatches } from '../../scripts/patch-native-plugins.mjs'

describe('scripts/patch-native-plugins.mjs', () => {
  // ⛔ THE PIN: the patch still matches the INSTALLED plugin. When an upgrade changes that code this fails here, on the
  // web CI, instead of the iOS build quietly going back to a warning (the script itself never fails a build).
  it('every patch applies to the plugin versions in node_modules (or the file is already patched)', () => {
    const results = applyPatches(process.cwd(), { write: false })
    expect(results.map((r) => [r.name, r.status === 'patched' || r.status === 'already'])).toEqual(
      PATCHES.map((p) => [p.name, true]),
    )
  })

  it('patches once, is a no-op the second time, and leaves an unknown file alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'patch-native-'))
    for (const p of PATCHES) {
      const path = join(root, p.file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `before\n${p.from}\nafter\n`)
    }
    expect(applyPatches(root).map((r) => r.status)).toEqual(PATCHES.map(() => 'patched'))
    for (const p of PATCHES) expect(readFileSync(join(root, p.file), 'utf8')).toBe(`before\n${p.to}\nafter\n`)
    expect(applyPatches(root).map((r) => r.status)).toEqual(PATCHES.map(() => 'already'))

    for (const p of PATCHES) writeFileSync(join(root, p.file), 'upstream rewrote this\n')
    expect(applyPatches(root).map((r) => r.status)).toEqual(PATCHES.map(() => 'not-found'))
    for (const p of PATCHES) expect(readFileSync(join(root, p.file), 'utf8')).toBe('upstream rewrote this\n')
  })

  it('reports a missing plugin instead of throwing', () => {
    const root = mkdtempSync(join(tmpdir(), 'patch-native-empty-'))
    expect(applyPatches(root).map((r) => r.status)).toEqual(PATCHES.map(() => 'missing-file'))
  })

  it('a code block found twice is ambiguous and left untouched', () => {
    const root = mkdtempSync(join(tmpdir(), 'patch-native-twice-'))
    for (const p of PATCHES) {
      const path = join(root, p.file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${p.from}\n${p.from}\n`)
    }
    expect(applyPatches(root).map((r) => r.status)).toEqual(PATCHES.map(() => 'ambiguous'))
    for (const p of PATCHES) expect(readFileSync(join(root, p.file), 'utf8')).toBe(`${p.from}\n${p.from}\n`)
  })

  it('the Xcode Cloud post-clone script runs it after npm ci and before cap sync', () => {
    const sh = readFileSync('ios/App/ci_scripts/ci_post_clone.sh', 'utf8')
    const ci = sh.indexOf('npm ci --ignore-scripts')
    const patch = sh.indexOf('node scripts/patch-native-plugins.mjs')
    const sync = sh.indexOf('npx cap sync ios')
    expect(ci).toBeGreaterThan(-1)
    expect(patch).toBeGreaterThan(ci)
    expect(sync).toBeGreaterThan(patch)
  })
})
