import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_DECLARATION, DECLARATIONS } from '@/lib/compliance/declaration-text'

/**
 * ⛔ THE SHELVED SWIFTUI APP SAYS THE DECLARATION'S EXACT WORDS (dossier §8 q13d — the recommended course, adopted 2026-10-16). It once sent
 * 'identity-v1' while showing a paraphrase that left out clause 4 and the binding-language line — the record then
 * stored v1's digest for words the person never saw. The app is shelved (the shipped iOS app is the Capacitor web
 * build), but if it is ever revived it must send CURRENT_DECLARATION and render that version VERBATIM, in both
 * languages. Read from the Swift source, as the app would show it.
 */
// From this file, not the working directory (as native-retired-categories.test.ts does): src/lib/compliance → repo root.
const ROOT = join(__dirname, '..', '..', '..')
const model = readFileSync(join(ROOT, 'apps/ios/Eno/Features/Identity/IdentityModel.swift'), 'utf8')
const view = readFileSync(join(ROOT, 'apps/ios/Eno/Features/Identity/IdentityVerifyView.swift'), 'utf8')

/** A Swift string literal's value (the escapes this file uses: \n, \", \\). */
const unSwift = (lit: string) => lit.replace(/\\(n|"|\\)/g, (_, c: string) => (c === 'n' ? '\n' : c))

describe('the SwiftUI app’s identity declaration', () => {
  it('sends CURRENT_DECLARATION', () => {
    expect(model).toContain(`static let declarationVersion = "${CURRENT_DECLARATION}"`)
  })

  it('shows that version’s words verbatim — English and Vietnamese', () => {
    const m = view.match(/private var declaration: String \{\s*L10n\.tr\(\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"\)/)
    expect(m, 'the declaration literal').toBeTruthy()
    expect(unSwift(m![1])).toBe(DECLARATIONS[CURRENT_DECLARATION].en)
    expect(unSwift(m![2])).toBe(DECLARATIONS[CURRENT_DECLARATION].vi)
  })
})
