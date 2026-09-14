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
 * ⚠️ THE FEED CHIP NO LONGER HAS A GRADIENT (owner, 2026-09-14: translucent plates). It was the
 * other half of a colour sync pair with the shield; the pair is gone, so the gradient half of this
 * file now guards the SHIELD alone, and the PLATE half below guards the chip's new claim.
 *
 * Sources are read as TEXT on purpose: the CSS tokens are never imported by anything, and a
 * test that imported a constant would prove only that the constant agrees with itself.
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

describe('trust shield gradients — every stop clears AA against its own ink', () => {
  const tiers = tiersFromTsx()

  // A parser that silently matches nothing would make every assertion below vacuous.
  it('parses all three earned tiers', () => {
    expect(Object.keys(tiers).sort()).toEqual(['elite', 'exceptional', 'trusted'])
    for (const tier of Object.values(tiers)) expect(tier.stops).toHaveLength(3)
  })

  for (const [name, tier] of Object.entries(tiers)) {
    for (const [i, stop] of tier.stops.entries()) {
      it(`${name} stop ${i + 1} (${stop}) vs ${tier.text}`, () => {
        expect(contrast(tier.text, stop)).toBeGreaterThanOrEqual(AA_NORMAL)
      })
    }
  }
})

/**
 * THE BADGE PLATES' CONTRAST CLAIM — `.badge-plate` in globals.css (owner, 2026-09-14).
 *
 * A plate is ink over a `--plate-alpha` wash of the tier hue, composited on whatever surface the
 * chip sits on. The claim is AA for the 10px bold label on the WORST surface in each theme:
 * - light: the DARKEST of the surfaces a chip sits on — dark ink loses contrast as the ground darkens.
 * - dark: the LIGHTEST of them — light ink loses contrast as the ground lightens.
 * The surfaces are the tokens behind every call site (feed and rail cards, the PDP shop link, the
 * seller card, the map popup, compact rows and their hover): --background, --card, --muted (the row
 * hover) and --popover. They are READ from the theme blocks, like the inks, hues and alphas — so
 * darkening a light surface, lightening a dark one, raising --plate-alpha or lightening an ink fails
 * here before it ships. A chip placed on any OTHER surface (--accent, --secondary) must add it here.
 */
const SURFACES = ['background', 'card', 'muted', 'popover']

function themeBlock(theme: 'light' | 'dark'): string {
  const css = readFileSync(repoFile('src/app/globals.css'), 'utf8')
  const start = theme === 'light' ? css.indexOf('\n:root {') : css.indexOf('\n.dark {')
  expect(start, `${theme} theme block`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('\n}', start + 1))
}

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`))
  expect(m, `--${name}`).not.toBeNull()
  return m![1].trim()
}

const hex = (v: string): string => {
  expect(v, 'a literal hex colour').toMatch(/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/)
  return norm(v)
}

/** `ink` over `alpha` of `tint` over `surface`, as color-mix(in srgb …) composites it. */
const composite = (tint: string, surface: string, alpha: number): string => {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16)
  return '#' + [1, 3, 5]
    .map((i) => Math.round(ch(tint, i) * alpha + ch(surface, i) * (1 - alpha)).toString(16).padStart(2, '0'))
    .join('')
}

describe('badge plates — ink clears AA over its own wash on the worst surface', () => {
  for (const theme of ['light', 'dark'] as const) {
    const block = themeBlock(theme)
    const grounds = SURFACES.map((name) => hex(token(block, name)))
    const byLuminance = [...grounds].sort((x, y) => relLuminance(x) - relLuminance(y))
    const surface = theme === 'light' ? byLuminance[0] : byLuminance[byLuminance.length - 1]
    const alpha = parseFloat(token(block, 'plate-alpha')) / 100

    // The same tint/ink pairs trust-score.tsx and partner-badge.tsx pass as --plate-tint/--plate-ink.
    const plates: [string, string, string][] = [
      ['restricted', 'trust-restricted', 'trust-restricted'],
      ['standard', 'trust-standard', 'trust-standard'],
      ['trusted', 'trust-trusted', 'trust-trusted'],
      ['exceptional', 'trust-exceptional', 'trust-exceptional-ink'],
      ['elite', 'trust-elite', 'trust-elite'],
      ['partner', 'partner-ink', 'partner-ink'],
    ]

    it(`${theme}: --plate-alpha is a sane percentage`, () => {
      expect(alpha).toBeGreaterThan(0)
      expect(alpha).toBeLessThan(0.5)
    })

    for (const [name, tintToken, inkToken] of plates) {
      it(`${theme} · ${name} plate on ${surface}`, () => {
        const ground = composite(hex(token(block, tintToken)), surface, alpha)
        expect(contrast(hex(token(block, inkToken)), ground)).toBeGreaterThanOrEqual(AA_NORMAL)
      })
    }
  }

  it('the plate rule and both call sites still use these tokens', () => {
    const css = readFileSync(repoFile('src/app/globals.css'), 'utf8')
    expect(css).toMatch(/\.badge-plate\s*\{[^}]*color-mix\(in srgb, var\(--plate-tint\) var\(--plate-alpha\), transparent\)/)
    expect(css).toMatch(/\.badge-plate\s*\{[^}]*color:\s*var\(--plate-ink\)/)
    const trust = readFileSync(repoFile('src/components/marketplace/trust-score.tsx'), 'utf8')
    expect(trust).toContain("band === 'exceptional' ? 'var(--trust-exceptional-ink)' : color")
    const partner = readFileSync(repoFile('src/components/marketplace/partner-badge.tsx'), 'utf8')
    expect(partner).toContain("'--plate-tint': 'var(--partner-ink)', '--plate-ink': 'var(--partner-ink)'")
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
