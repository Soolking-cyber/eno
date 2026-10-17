import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalAppPath } from './deep-link'
import attackTable from './deep-link-attack-table.json'

/**
 * ⛔ NO CI JOB COMPILES THE NATIVE SHELLS, so this is what keeps their deep-link validators and the web's in step
 * (speed plan item 11, 2026-10-17). AppDelegate.isRoutablePath (iOS) and MainActivity.isRoutablePath (Android) decide
 * which links reach the WebView at all; src/lib/deep-link.ts canonicalAppPath decides again on the web. All three refuse
 * the same prefixes, check every decoded spelling, decode leniently and fail closed — a drift compiles fine and shows
 * only on a device, or never (GHSA-rvm3-566m-v7fv: a path under "/_" reaches Capacitor's HTTP proxy on ≤8.4.2).
 * It also pins Capacitor itself: 8.4.3 carries the complete fix, 8.5.x is deferred (#8623 double safe-area padding on
 * Android ≤14 with our CSS) — a caret range would float to 8.5.x on the next install without anyone deciding it.
 * ⚠️ This reads the native code; it cannot run it. `node scripts/native-deep-link-check.mjs` EXECUTES both validators
 * (swift + a JDK, macOS) against the attack table — run it before every native release.
 */
const ROOT = join(__dirname, '..', '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

/** The body of the first `<signature> … { … }` block found after `marker` (brace-matched). */
const block = (src: string, marker: string): string => {
  const start = src.indexOf(marker)
  if (start < 0) throw new Error(`${marker} not found`)
  const open = src.indexOf('{', start)
  let end = open
  for (let depth = 0; end < src.length; end++) {
    if (src[end] === '{') depth++
    else if (src[end] === '}' && --depth === 0) break
  }
  return src.slice(open, end + 1)
}

const swift = read('ios/App/App/AppDelegate.swift')
const java = read('android/app/src/main/java/vn/eno/app/MainActivity.java')

const shells = [
  {
    name: 'iOS AppDelegate',
    path: block(swift, 'private static func isRoutablePath('),
    spelling: block(swift, 'private static func isRoutableSpelling('),
    prefix: 'hasPrefix',
    decoder: 'decodedLeniently(probe)',
    strictDecoder: 'removingPercentEncoding',
  },
  {
    name: 'Android MainActivity',
    path: block(java, 'private static boolean settlesRoutable('),
    spelling: block(java, 'private static boolean isRoutableSpelling('),
    prefix: 'startsWith',
    decoder: 'decodedLeniently(probe)',
    strictDecoder: 'URLDecoder',
  },
]

describe.each(shells)('$name deep-link validator', ({ path, spelling, prefix, decoder, strictDecoder }) => {
  it('refuses the prefixes canonicalAppPath refuses: /_ (framework), // (origin escape), /auth, /signin', () => {
    for (const p of ['/_', '//', '/auth', '/signin']) expect(spelling).toContain(`lower.${prefix}("${p}")`)
  })

  it('refuses dot segments and parser-splitting characters', () => {
    expect(spelling).toContain('hasParserSplitChars(spelling)')
    expect(spelling).toMatch(/"\.\."/)
  })

  it('checks EVERY spelling, decodes leniently, and fails closed when the path never settles', () => {
    // Each round checks the current spelling before decoding it again…
    expect(path.indexOf('isRoutableSpelling(probe)')).toBeGreaterThan(-1)
    expect(path.indexOf('isRoutableSpelling(probe)')).toBeLessThan(path.indexOf(decoder))
    // …with a decoder that never gives up on the whole string (a `%ZZ` must not hide the readable `%5F` beside it)…
    expect(path).not.toContain(strictDecoder)
    // …and a path still changing after the last round is refused, not waved through.
    expect(path).toMatch(/return false;?\s*\}$/)
  })
})

describe('Android: a path meets two decoders, and must settle routable under both', () => {
  it('isRoutablePath runs the Chromium-style chain AND the Uri.decode chain', () => {
    expect(block(java, 'private static boolean isRoutablePath(')).toMatch(/settlesRoutable\(rawPath, true\) && settlesRoutable\(rawPath, false\)/)
    expect(block(java, 'private static boolean settlesRoutable(')).toContain('chromium ? decodedLeniently(probe) : Uri.decode(probe)')
  })
})

describe('…and the web validator gives the same answer on every row of the shared attack table', () => {
  // The native validators run the same rows in scripts/native-deep-link-check.mjs (they need swift and a JDK).
  it.each(attackTable.cases)('$path → routable $routable ($why)', ({ path, routable }) => {
    expect(canonicalAppPath(path, { blockAuthPaths: true }) !== null).toBe(routable)
  })
})

describe('Capacitor is pinned to the release that carries the GHSA-rvm3-566m-v7fv fix', () => {
  it('package.json pins core, ios and android to exactly 8.4.3 — no range that could float to 8.5.x', () => {
    const deps = JSON.parse(read('package.json')).dependencies as Record<string, string>
    for (const name of ['@capacitor/core', '@capacitor/ios', '@capacitor/android']) expect(deps[name], name).toBe('8.4.3')
  })

  it('the iOS Swift package manifest and its lockfile resolve the same release', () => {
    expect(read('ios/App/CapApp-SPM/Package.swift')).toContain('capacitor-swift-pm.git", exact: "8.4.3"')
    const resolved = JSON.parse(read('ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'))
    const pin = (resolved.pins as { identity: string; state: { version?: string } }[]).find((p) => p.identity === 'capacitor-swift-pm')
    expect(pin?.state.version).toBe('8.4.3')
  })
})
