import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE PALETTE'S CONTRAST CLAIMS, MEASURED FROM THE STYLESHEET (the 2026-11-14 redesign, owner-approved: white ground,
 * an ink ladder, one accent #0060df, ink prices). globals.css states a ratio beside nearly every token; this file is
 * what makes those sentences true rather than remembered. It reads the tokens as TEXT, per theme, following var()
 * references the way the cascade does — the theme's own block first, then :root, which `.dark` inherits for every
 * token it does not redefine (the same resolver as marketplace/trust-contrast.test.ts).
 */

const AA = 4.5

// Here rather than beside globals.css: lang-segment.guard.test.ts allows no new entry at the src/app root.
const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8')
const blockAt = (marker: string) => {
  const start = css.indexOf(marker)
  expect(start, marker).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('\n}', start + 1))
}
const ROOT = blockAt('\n:root {')
const DARK = blockAt('\n.dark {')

function token(theme: 'light' | 'dark', name: string, seen: string[] = []): string {
  const find = (b: string) => b.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()
  const v = (theme === 'dark' ? find(DARK) : undefined) ?? find(ROOT)
  expect(v, `--${name} (${theme})`).toBeDefined()
  const ref = v!.match(/^var\(\s*--([\w-]+)\s*\)$/)
  if (!ref) return v!.toLowerCase()
  expect(seen, `--${name} resolves without a cycle`).not.toContain(ref[1])
  return token(theme, ref[1], [...seen, name])
}

const hex = (v: string) => {
  expect(v, 'a literal hex colour').toMatch(/^#[0-9a-f]{6}$/)
  return v
}
const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const INKS = ['foreground', 'ink', 'ink-2', 'ink-3', 'body', 'muted-foreground', 'ink-4']
const GROUNDS = ['background', 'card', 'popover', 'muted', 'tint', 'accent']

describe('every text ink clears AA on every ground it is written on', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const ink of INKS) {
      for (const ground of GROUNDS) {
        it(`${theme} · ${ink} on ${ground}`, () => {
          expect(contrast(token(theme, ink), token(theme, ground))).toBeGreaterThanOrEqual(AA)
        })
      }
    }
    it(`${theme} · accent-foreground on accent (the active capsule, the pressed glyph)`, () => {
      expect(contrast(token(theme, 'accent-foreground'), token(theme, 'accent'))).toBeGreaterThanOrEqual(AA)
    })
    for (const fill of ['primary', 'cta', 'cta-dark']) {
      it(`${theme} · white label on ${fill} (cta / commerce rest and press)`, () => {
        expect(contrast('#ffffff', token(theme, fill))).toBeGreaterThanOrEqual(AA)
      })
    }
    it(`${theme} · the price is ink, and commerce text is ink`, () => {
      expect(token(theme, 'price')).toBe(token(theme, 'foreground'))
      expect(token(theme, 'cta-ink')).toBe(token(theme, 'foreground'))
    })
    it(`${theme} · no commerce tint`, () => {
      expect(token(theme, 'cta-50')).toBe('transparent')
    })
    it(`${theme} · the saved heart's red on its white plate`, () => {
      expect(contrast(token(theme, 'saved'), '#ffffff')).toBeGreaterThanOrEqual(AA)
    })
  }

  it('light · text-brand on the brand-50 well', () => {
    expect(contrast(token('light', 'brand'), token('light', 'brand-50'))).toBeGreaterThanOrEqual(AA)
  })
  it('dark · text-brand on the canvas (the reason accent TEXT is text-brand, not text-primary)', () => {
    expect(contrast(token('dark', 'brand'), token('dark', 'background'))).toBeGreaterThanOrEqual(AA)
  })
})

describe('the redesign, as tokens', () => {
  it('light · the ground is white, every surface the same white (the flat canvas)', () => {
    for (const t of ['background', 'card', 'popover', 'wash-tail']) expect(token('light', t), t).toBe('#ffffff')
  })
  it('light · ONE accent: brand, primary, ring, cta, info, verified and accent-foreground are #0060df', () => {
    for (const t of ['brand', 'primary', 'ring', 'cta', 'info', 'verified', 'accent-foreground']) {
      expect(token('light', t), t).toBe('#0060df')
    }
    expect(token('light', 'brand-dark')).toBe('#004bb0')
    expect(token('light', 'cta-dark')).toBe('#004bb0')
  })
  it('light · the wells: tint and muted are the field grey; secondary, accent and brand-50 stay apart from it', () => {
    // Selection still marks itself with accent / brand-50 until it moves to ink (the redesign's next step): they must
    // not equal the resting grey, or "selected" and "resting" look the same (WCAG 1.4.1).
    for (const t of ['tint', 'muted']) expect(token('light', t), t).toBe('#f3f3f3')
    expect(token('light', 'secondary')).toBe('#e5e5e5')
    for (const t of ['accent', 'brand-50']) expect(token('light', t), t).not.toBe(token('light', 'tint'))
  })
  it('dark · the fills keep the light accent; the wells are the dark tint', () => {
    expect(token('dark', 'primary')).toBe('#0060df')
    expect(token('dark', 'cta')).toBe('#0060df')
    expect(token('dark', 'cta-dark')).toBe('#004bb0')
    expect(token('dark', 'accent')).not.toBe(token('dark', 'tint'))
    expect(token('dark', 'brand-50')).not.toBe(token('dark', 'tint'))
  })
  it('dark · text-brand on the brand-50 well clears AA', () => {
    expect(contrast(token('dark', 'brand'), token('dark', 'brand-50'))).toBeGreaterThanOrEqual(AA)
  })
  it('the ink ramp is monotonic in both themes (D-GREYS): a later stop is never stronger than an earlier one', () => {
    const ramp = ['ink', 'ink-2', 'ink-3', 'body', 'muted-foreground', 'ink-4']
    for (const theme of ['light', 'dark'] as const) {
      const ground = token(theme, 'background')
      const ratios = ramp.map((t) => contrast(token(theme, t), ground))
      for (let i = 1; i < ratios.length; i++) expect(ratios[i], `${theme} ${ramp[i]} ≤ ${ramp[i - 1]}`).toBeLessThanOrEqual(ratios[i - 1])
    }
  })
})

describe('the contrast helper itself', () => {
  it('matches WCAG reference ratios', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrast('#ffffff', '#0060df')).toBeCloseTo(5.62, 1)
  })
})
