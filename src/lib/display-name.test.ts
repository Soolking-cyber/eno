import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cleanDisplayName, DISPLAY_NAME_MAX } from './display-name'

// A provider-supplied name (Google's profile, Apple's name sheet, a form_post `user`) seeds the public
// displayName and the handle — so what reaches them is cleaned here first (Sign in with Apple plan, A5).
describe('cleanDisplayName', () => {
  it('keeps an ordinary name, in any script, as it is', () => {
    expect(cleanDisplayName('Nguyễn Văn An')).toBe('Nguyễn Văn An')
    expect(cleanDisplayName('Jane Doe')).toBe('Jane Doe')
    expect(cleanDisplayName('张伟')).toBe('张伟')
  })

  it('composes to NFC, so the same name is the same string', () => {
    const decomposed = 'Nguye\u0302\u0303n' // e + combining circumflex + combining tilde
    expect(cleanDisplayName(decomposed)).toBe('Nguyễn')
    expect(cleanDisplayName(decomposed)).toBe(cleanDisplayName('Nguyễn'))
  })

  it('strips bidi embeddings, overrides and isolates — the reversed-text trick', () => {
    expect(cleanDisplayName('Ali\u202Ece\u202C')).toBe('Alice')
    expect(cleanDisplayName('\u2066Bob\u2069 \u2067Smith\u2069 \u2068x\u2069')).toBe('Bob Smith x')
    expect(cleanDisplayName('a\u202Ab\u202Bc\u202Dd')).toBe('abcd')
    expect(cleanDisplayName('\u061CName')).toBe('Name')
  })

  it('strips zero-width characters and the BOM, so two names cannot look identical and differ', () => {
    expect(cleanDisplayName('Jo\u200Bhn\u200C \u200DDoe\u200E\u200F\uFEFF')).toBe('John Doe')
  })

  it('turns whitespace controls into one space and drops the other control characters', () => {
    expect(cleanDisplayName('John\nDoe')).toBe('John Doe')
    expect(cleanDisplayName('John\r\n\tDoe')).toBe('John Doe')
    expect(cleanDisplayName('Jo\u0000hn\u0007 \u001BDoe\u007F\u0085')).toBe('John Doe')
  })

  it('collapses runs of spaces (including non-breaking ones) and trims', () => {
    expect(cleanDisplayName('   Jane \u00A0\u00A0  Doe   ')).toBe('Jane Doe')
    expect(cleanDisplayName('Jane\u2028Doe')).toBe('Jane Doe')
  })

  it('caps at 80 UTF-16 units', () => {
    expect(DISPLAY_NAME_MAX).toBe(80)
    expect(cleanDisplayName('x'.repeat(5000))).toHaveLength(80)
    // A cut that lands after a space is trimmed rather than ending on one.
    expect(cleanDisplayName(`${'a'.repeat(79)} bbbb`)).toBe('a'.repeat(79))
  })

  it('never splits a surrogate pair at the cut', () => {
    const name = `${'a'.repeat(79)}😀`
    const out = cleanDisplayName(name)
    expect(out).toBe('a'.repeat(79))
    expect(/[\uD800-\uDBFF]$/.test(out)).toBe(false)
    // …and keeps a pair that fits whole.
    expect(cleanDisplayName(`${'a'.repeat(78)}😀`)).toBe(`${'a'.repeat(78)}😀`)
    expect(cleanDisplayName('Anh 🇻🇳')).toBe('Anh 🇻🇳')
  })

  it('is empty for nothing, non-strings and names that clean down to nothing', () => {
    expect(cleanDisplayName(undefined)).toBe('')
    expect(cleanDisplayName(null)).toBe('')
    expect(cleanDisplayName(42)).toBe('')
    expect(cleanDisplayName({ full_name: 'x' })).toBe('')
    expect(cleanDisplayName('  \u200B\u202E\n ')).toBe('')
  })
})

/**
 * ⛔ THE CHARACTERS IT STRIPS ARE WRITTEN AS ESCAPES, NEVER RAW (opus gate O3, 2026-10-08). Raw, they are invisible in an
 * editor and in a diff, and raise GitHub's hidden-Unicode banner on the very file that defends against them — a reviewer
 * cannot tell a range edited from a range intact. \p{Cf} is the whole format category: the bidi controls, the
 * zero-width characters and the BOM, U+061C included. This test file obeys the same rule, so it can say so.
 */
describe('the source', () => {
  it('writes every invisible formatting character as a \\u escape — in display-name.ts and in this test', () => {
    for (const f of ['src/lib/display-name.ts', 'src/lib/display-name.test.ts']) {
      const raw = [...readFileSync(f, 'utf8')].filter((c) => /\p{Cf}/u.test(c)).map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
      expect(raw, f).toEqual([])
    }
  })

  it("strips exactly the plan's format characters, as the literal version did: U+061C, U+200B–U+200F, U+202A–U+202E, U+2066–U+2069, U+FEFF", () => {
    expect(readFileSync('src/lib/display-name.ts', 'utf8')).toContain(String.raw`/[\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g`)
    // Every format character in the BMP, through the function: the ones it removes are exactly these, no more, no fewer.
    const format = Array.from({ length: 0x10000 }, (_, i) => String.fromCharCode(i)).filter((c) => /\p{Cf}/u.test(c))
    const stripped = format.filter((c) => cleanDisplayName(`a${c}b`) === 'ab').map((c) => c.charCodeAt(0))
    expect(stripped).toEqual([0x061c, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff])
  })
})
