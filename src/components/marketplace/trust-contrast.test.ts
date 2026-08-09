import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * THE TRUST BADGE'S CONTRAST CLAIM, ENFORCED INSTEAD OF ASSERTED.
 *
 * Both files carrying the tier gradients used to state, in a comment, that their text held
 * ≥4.5:1 "against the lightest gradient stop". Neither claim was true, and nobody could tell,
 * because a sentence in a comment is not checked by anything. Measured 2026-08-09: Trusted's
 * lightest stop gave white 3.68:1, and Exceptional's dark ink gave 4.04:1 against its DARKEST
 * stop. This badge renders the score at ~10px on every listing card, so the large-text
 * allowance never applied.
 *
 * ⚠️ THE ORIGINAL RULE WAS WRONG, NOT JUST THE VALUES, and that is what this file really
 * guards. "Check the lightest stop" only holds for LIGHT ink. White text is worst over the
 * lightest stop; dark text is worst over the DARKEST one. Exceptional carries dark ink on
 * gold, so checking its lightest stop returned a comfortable 6.58:1 from the very gradient
 * that was failing at the other end. This test checks EVERY stop, so the direction of the
 * comparison cannot be got wrong again.
 *
 * ⚠️ IT ALSO GUARDS A SYNC PAIR WITH NO COMPILER. A CSS class cannot paint an SVG fill, so
 * the feed chip (`.trust-fill-*` in globals.css) and the shield badge (`SHIELD_GRADIENT` in
 * trust-score.tsx) each need their own copy of the same six colours. Nothing but this file
 * stops them drifting into two different blues for one score.
 *
 * Both sources are read as TEXT on purpose. Importing the TS constant would prove only that
 * the constant agrees with itself; the CSS is the other half of the pair and is never
 * imported by anything.
 */

const AA_NORMAL = 4.5

const relLuminance = (hex: string): number => {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Expand #fff → #ffffff so both sources can be compared literally. */
const norm = (hex: string): string => {
  const h = hex.trim().toLowerCase()
  return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h
}

type Tier = { stops: string[]; text: string }

/**
 * Resolve against THIS FILE, not the process cwd. `readFileSync('src/…')` only works when
 * vitest happens to be rooted at the repo root, which is true today and is not a property of
 * the test.
 */
const repoFile = (rel: string) => new URL(`../../../${rel}`, import.meta.url)

/** The stop OFFSETS both sources must agree on — colours are only half of the sync pair. */
const SVG_STOP_OFFSETS = ['0%', '55%', '100%']

/** `SHIELD_GRADIENT` in trust-score.tsx — the SVG shield. */
function tiersFromTsx(): Record<string, Tier> {
  const src = readFileSync(repoFile('src/components/marketplace/trust-score.tsx'), 'utf8')
  const block = src.split('const SHIELD_GRADIENT')[1]?.split('}\n')[0] ?? ''
  const out: Record<string, Tier> = {}
  for (const m of block.matchAll(
    /(\w+):\s*\{\s*from:\s*'(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))',\s*mid:\s*'(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))',\s*to:\s*'(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))',\s*text:\s*'(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))'/g,
  )) {
    out[m[1]] = { stops: [norm(m[2]), norm(m[3]), norm(m[4])], text: norm(m[5]) }
  }
  return out
}

/** `.trust-fill-*` in globals.css — the feed chip. */
function tiersFromCss(): Record<string, Tier> {
  const src = readFileSync(repoFile('src/app/globals.css'), 'utf8')
  const out: Record<string, Tier> = {}
  for (const m of src.matchAll(/\.trust-fill-(\w+)\s*\{([\s\S]*?)\}/g)) {
    const [, tier, body] = m
    const stops = [...body.matchAll(/(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))\s+\d+%/g)].map((s) => norm(s[1]))
    const text = body.match(/(?:^|[\s;])color:\s*(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))/)?.[1]
    if (stops.length && text) out[tier] = { stops, text: norm(text) }
  }
  return out
}

describe('trust tier gradients — every stop clears AA against its own ink', () => {
  const sources: [string, Record<string, Tier>][] = [
    ['SHIELD_GRADIENT (trust-score.tsx)', tiersFromTsx()],
    ['.trust-fill-* (globals.css)', tiersFromCss()],
  ]

  // A parser that silently matches nothing would make every assertion below vacuous.
  it.each(sources)('%s parses all three earned tiers', (_label, tiers) => {
    expect(Object.keys(tiers).sort()).toEqual(['elite', 'exceptional', 'trusted'])
    for (const tier of Object.values(tiers)) expect(tier.stops).toHaveLength(3)
  })

  for (const [label, tiers] of sources) {
    for (const [name, tier] of Object.entries(tiers)) {
      for (const [i, stop] of tier.stops.entries()) {
        it(`${label} · ${name} stop ${i + 1} (${stop}) vs ${tier.text}`, () => {
          expect(contrast(tier.text, stop)).toBeGreaterThanOrEqual(AA_NORMAL)
        })
      }
    }
  }
})

describe('the two sources are a sync pair', () => {
  it('chip and shield paint identical colours for every tier', () => {
    expect(tiersFromCss()).toEqual(tiersFromTsx())
  })

  /**
   * ⚠️ COLOURS ALONE ARE ONLY HALF THE PAIR. Exceptional's chip put its mid stop at 45% while
   * every shield uses 55%, so that one tier rendered a visibly different gold in the feed than
   * on a profile — with identical colours, and a green colour-only test. A reviewer found it.
   * The SVG's offsets are literals in the JSX, so the CSS is checked against them.
   */
  it('chip stop offsets match the shield’s', () => {
    const css = readFileSync(repoFile('src/app/globals.css'), 'utf8')
    const rules = [...css.matchAll(/\.trust-fill-(\w+)\s*\{([\s\S]*?)\}/g)]
    expect(rules).toHaveLength(3) // non-vacuous: the rules were actually found
    for (const [, tier, body] of rules) {
      const offsets = [...body.matchAll(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\s+(\d+%)/g)].map((m) => m[1])
      expect(offsets, `.trust-fill-${tier}`).toEqual(SVG_STOP_OFFSETS)
    }
  })
})

describe('the contrast helper itself', () => {
  // If these drift, every assertion above becomes meaningless.
  it('matches known WCAG reference ratios', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    // The exact value that shipped broken, kept as a regression anchor.
    expect(contrast('#ffffff', '#3b82f6')).toBeCloseTo(3.68, 1)
  })

  it('is symmetric in its arguments', () => {
    expect(contrast('#3473da', '#ffffff')).toBeCloseTo(contrast('#ffffff', '#3473da'), 10)
  })
})
