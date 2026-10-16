import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENCIES, formatMoney } from './currencies'

/**
 * ⛔ EVERY CURRENCY THE APP PRINTS IS DRAWN BY THE APP'S FONT (speed plan item 7, 2026-10-16 — opus, on the 7b gate).
 *
 * scripts/gen-fonts.sh subsets Open Runde to what the screen draws, and since 7b that means the currency signs the app
 * prints (₫ € ₩ ₹ ₽), not the whole currency block. A currency added here later — ₱, ₺, ₴ — would pass every other
 * test and render its sign in the fallback face beside Open Runde digits. This reads the generator's UNICODES and
 * fails instead, so the range is added in the same change. ⚠️ It reads the GENERATOR, not the .woff2 files (no font
 * parser here): regenerating after an edit is still on whoever edits it, and gen-fonts.sh's own cmap check proves the
 * output.
 */

/** The code points the generator asks for, parsed from it (UNICODES="…" plus every +=, concatenated as bash does). */
function subsetRanges(): Array<[number, number]> {
  const sh = readFileSync(join(process.cwd(), 'scripts/gen-fonts.sh'), 'utf8')
  // join(''), as bash's += does: a piece without its leading comma then fails here exactly as it breaks the subset.
  const parts = [...sh.matchAll(/^UNICODES\+?="([^"]+)"/gm)].map((m) => m[1]).join('')
  return parts.split(',').filter(Boolean).map((r) => {
    const [lo, hi] = r.replace(/^U\+/, '').split('-')
    return [parseInt(lo, 16), parseInt(hi ?? lo, 16)]
  })
}

/** Scripts the subset leaves to the system font on purpose — whole writing systems, not signs (gen-fonts.sh). */
const SYSTEM_SCRIPT = [
  [0x0e00, 0x0e7f], // Thai — ฿
  [0x1780, 0x17ff], // Khmer — ៛
]

describe('currency signs ⊂ the Open Runde subset', () => {
  const ranges = subsetRanges()
  const covered = (cp: number) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi) || SYSTEM_SCRIPT.some(([lo, hi]) => cp >= lo && cp <= hi)

  it('parses the generator (a guard that reads nothing guards nothing)', () => {
    expect(ranges.length).toBeGreaterThan(10)
    expect(covered(0x20ab)).toBe(true) // ₫
    expect(covered(0x0100)).toBe(false) // Ā — Latin Extended-A is out, measured (gen-fonts.sh)
  })

  it('every character of every listed symbol, and of every price formatMoney prints, in both server languages', () => {
    const missing = new Set<string>()
    const rates = Object.fromEntries(CURRENCIES.map((c) => [c.code, 0.00004]))
    for (const c of CURRENCIES) {
      const printed = [c.symbol, formatMoney(12_500_000, c.code, rates, 'en'), formatMoney(12_500_000, c.code, rates, 'vi')]
      for (const s of printed) for (const ch of s) if (!covered(ch.codePointAt(0)!)) missing.add(`${c.code} ${JSON.stringify(ch)} U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
    }
    expect([...missing]).toEqual([])
  })
})
