import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RETIRED_NAV_CATEGORIES } from './retired-categories'

/**
 * ⛔ THE NATIVE APPS' RETIRED-SHELF SETS ARE COPIES OF THE WEB'S, AND THIS IS WHAT KEEPS THEM COPIES.
 * apps/ios Categories.swift `retiredFromBrowse` and apps/android Core.kt `retiredFromBrowse` decide which
 * shelves the native browse grids leave out (second-hand focus, 2026-10-03). Each app's own unit test pins
 * its set to a literal in the same file, so a change to RETIRED_NAV_CATEGORIES alone would leave both apps
 * green and drifted (commit-gate review). The web suite reads both sources and fails until they match.
 */
const ROOT = join(__dirname, '..', '..')
const setLiteral = (src: string, pattern: RegExp) => {
  const m = src.match(pattern)
  if (!m) throw new Error(`retiredFromBrowse not found (${pattern})`)
  return new Set([...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]))
}

describe('native retired-shelf sets match the web (RETIRED_NAV_CATEGORIES)', () => {
  it('iOS Categories.swift', () => {
    const src = readFileSync(join(ROOT, 'apps/ios/Eno/Core/Categories.swift'), 'utf8')
    expect(setLiteral(src, /static let retiredFromBrowse: Set<String> = \[([^\]]*)\]/)).toEqual(new Set(RETIRED_NAV_CATEGORIES))
  })

  it('Android Core.kt', () => {
    const src = readFileSync(join(ROOT, 'apps/android/app/src/main/java/vn/eno/native_/core/Core.kt'), 'utf8')
    expect(setLiteral(src, /val retiredFromBrowse = setOf\(([^)]*)\)/)).toEqual(new Set(RETIRED_NAV_CATEGORIES))
  })
})
