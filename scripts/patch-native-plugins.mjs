#!/usr/bin/env node
// Patches Capacitor plugin Swift in node_modules that Xcode 27's Swift (6.4) warns about and upstream has not fixed
// (owner, 2026-11-24: "patch it", for the last warning in Xcode Cloud build 11).
//
// Run by ios/App/ci_scripts/ci_post_clone.sh after `npm ci --ignore-scripts` and before `cap sync ios`: the iOS
// project builds every plugin from node_modules by path (SPM), so the patched file is the one Xcode compiles.
// Locally, run it by hand before an Xcode build if you want the same source (`node scripts/patch-native-plugins.mjs`).
//
// ⚠️ IT NEVER FAILS THE BUILD. A cosmetic patch must not block an App Store build: when the expected code is not
// there (an upgrade changed it), it prints a warning and exits 0. The vitest pin (patch-native-plugins.test.ts)
// turns the web CI run red on such an upgrade; a red run pages nobody, so read `gh run list` after a plugin bump.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PATCHES = [
  {
    // @capacitor/camera 8.2.1 … 8.2.6 (identical in all), getLimitedLibraryPhotos: the outer closures capture self
    // strongly, so Swift 6.4 warns that this inner `[weak self]` is not what it looks like. A strong capture is what
    // the code already had in effect, and it always resolves the call (a plugin lives as long as the bridge).
    // The app never calls getLimitedLibraryPhotos (src/lib/native-photos.ts calls Camera.getPhoto only).
    name: 'camera: getLimitedLibraryPhotos weak-self (CameraPlugin.swift)',
    file: 'node_modules/@capacitor/camera/ios/Sources/CameraPlugin/CameraPlugin.swift',
    from: 'group.notify(queue: .global(qos: .utility)) { [weak self] in\n                        self?.returnImages(processedImages)',
    to: 'group.notify(queue: .global(qos: .utility)) {\n                        self.returnImages(processedImages)',
  },
]

/**
 * One status per patch: 'patched' | 'already' | 'missing-file' | 'not-found' | 'ambiguous' | 'write-failed'.
 * Writes only when `write` is true, and never throws (a read-only node_modules is a status, not a failed build).
 */
export function applyPatches(root, { write = true } = {}) {
  return PATCHES.map((p) => {
    const path = join(root, p.file)
    let src
    try {
      src = readFileSync(path, 'utf8')
    } catch {
      return { name: p.name, status: 'missing-file' }
    }
    const hits = src.split(p.from).length - 1
    if (hits === 0) return { name: p.name, status: src.includes(p.to) ? 'already' : 'not-found' }
    if (hits > 1) return { name: p.name, status: 'ambiguous' }
    if (write) {
      try {
        writeFileSync(path, src.replace(p.from, p.to))
      } catch {
        return { name: p.name, status: 'write-failed' }
      }
    }
    return { name: p.name, status: 'patched' }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const r of applyPatches(process.cwd())) {
    const line = `patch-native-plugins: ${r.status} — ${r.name}`
    if (r.status === 'patched' || r.status === 'already') console.log(line)
    else console.warn(`⚠️ ${line} (re-check the patch against the installed plugin; the build goes on unpatched)`)
  }
}
