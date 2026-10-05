import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cn, getInitials } from './utils'

/**
 * THE Z LADDER'S NAMES ARE A tailwind-merge GROUP (D-Z, 2026-09-29). Without the extension in
 * utils.ts, `cn('z-overlay', 'z-[70]')` keeps both and Tailwind's sort order — `z-[70]` before
 * `z-overlay` — hands the win to the primitive, silently, over the caller.
 */
describe('cn — the z ladder', () => {
  it('a caller z replaces a ladder tier, and a tier replaces a number', () => {
    expect(cn('isolate z-overlay', 'z-[70]')).toBe('isolate z-[70]')
    expect(cn('z-50', 'z-fab')).toBe('z-fab')
    expect(cn('z-nav', 'z-tooltip')).toBe('z-tooltip')
  })

  it('knows exactly the tiers globals.css declares — the two lists cannot drift', () => {
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8')
    const tiers = [...css.matchAll(/--z-index-([a-z-]+):/g)].map((m) => m[1])
    expect(tiers.length).toBeGreaterThan(0)
    for (const t of tiers) expect(cn('z-0', `z-${t}`), t).toBe(`z-${t}`)
  })
})

/**
 * THE HOUSE CURVES ARE A tailwind-merge THEME SCALE TOO (D-LINT, 2026-09-29). They became named
 * utilities (`ease-spring-snappy` …) when they moved into `@theme static`, and without `theme.ease`
 * in utils.ts a caller's `ease-out` no longer replaced a primitive's curve: both shipped and the
 * named curve, emitted after `ease-out`, won. ui/button.tsx documents the opposite as its contract.
 */
describe('cn — the house curves', () => {
  it("a caller's stock curve replaces a primitive's house curve, and the reverse", () => {
    expect(cn('ease-spring-snappy', 'ease-out')).toBe('ease-out')
    expect(cn('duration-150 ease-spring', 'ease-out')).toBe('duration-150 ease-out')
    expect(cn('ease-out', 'ease-out-strong')).toBe('ease-out-strong')
    expect(cn('ease-in-out', 'ease-bounce')).toBe('ease-bounce')
  })

  it('knows exactly the curves globals.css declares — the two lists cannot drift', () => {
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8')
    const block = css.match(/@theme static \{([^}]*)\}/)
    expect(block, 'the @theme static block holding the curves').not.toBeNull()
    const curves = [...block![1].matchAll(/--ease-([a-z-]+):/g)].map((m) => m[1])
    expect(curves.length).toBeGreaterThan(0)
    for (const c of curves) expect(cn('ease-linear', `ease-${c}`), c).toBe(`ease-${c}`)
  })
})

/**
 * AVATAR INITIALS (break-ui, 2026-10-05): first + last word, whole graphemes, never an emoji half.
 * Every value is a real naming shape from the break-ui catalog, not filler.
 */
describe('getInitials', () => {
  it.each([
    ['Nguyễn Văn An', 'NA'], // was "NV" — shared by a third of the country
    ['Đặng Thị Ngọc Hân', 'ĐH'], // was "ĐT" — every "… Thị …" name
    ['Aleksandra Wiśniewska-Kowalczyk', 'AW'],
    ['Christopher Alexander Montgomery III', 'CM'], // the suffix is not the surname (not "CI")
    ['Jo', 'J'],
    ['J', 'J'],
    ['dana', 'D'],
    ['Ólafur Darri Ólafsson', 'ÓÓ'],
    ['王秀英', '王'], // written without spaces: one word, one initial
    ['  Sam   Lee ', 'SL'], // was "" — an empty circle
    ['🦊 Fox', 'F'], // was "�F" — half a surrogate pair
    ['👩🏽‍💻 Priya', 'P'], // a ZWJ emoji is skipped whole
    ['ศุภชัย ใจดี', 'ศุจ'], // whole graphemes (ศ + its below-vowel ุ); the leading vowel ใ is written first but is not the initial
    ['María José de la Cruz y Fernández', 'MF'],
    ['Lan V.', 'LV'], // a Vietnamese surname initial, not a suffix
    ['Studio V', 'SV'], // a shop name
    ['Studio III', 'SI'], // two words: the last one stays
    ['John Smith Jr', 'JS'],
    ['ßeta Müller', 'SM'], // ß uppercases to SS — one letter per initial
    ['क्षमा शर्मा', 'कश'], // no dangling virama to fuse with the surname's initial
    ['សុខា ស្រីពៅ', 'សុស'], // Khmer: the vowel sign stays, the coeng (subscript joiner) goes
  ])('%s → %s', (name, expected) => {
    expect(getInitials(name)).toBe(expected)
  })
  it('nothing usable is "?", never an empty circle', () => {
    expect(getInitials('')).toBe('?')
    expect(getInitials('   ')).toBe('?')
    expect(getInitials(null)).toBe('?')
    expect(getInitials('🦊')).toBe('?')
  })
})
