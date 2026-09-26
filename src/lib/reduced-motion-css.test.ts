import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * REDUCED MOTION IS GENTLER, NOT NONE — pinned in the stylesheet.
 *
 * The universal reduced-motion block forces every transition and keyframe to 0.01ms, which also
 * removed every overlay's opacity fade: dialogs, popovers, menus and their scrims popped in one frame
 * for exactly the users who asked for calmer UI. The contract: the blanket kill stays, and two NARROW
 * exceptions restore the fade only — tw-animate entrances/exits (their own duration, travel zeroed)
 * and the overlay scrim's own opacity transition. jsdom evaluates no media queries, so this pins the
 * declarations; the behaviour was measured on the production preview with reducedMotion: 'reduce'.
 */
// Lives in src/lib, not beside globals.css: src/app's root is reserved for routes and metadata
// (lang-segment.guard.test.ts fails on any other entry there).
const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8')
const start = css.indexOf('ACCESSIBILITY — honor reduced-motion preference')
// Declarations only: the block's own comments quote the rules they replaced.
const block = css.slice(start, css.indexOf('View Transitions', start)).replace(/\/\*[\s\S]*?\*\//g, '')

describe('globals.css reduced-motion block', () => {
  it('exists where expected, and the exceptions sit INSIDE its media query', () => {
    expect(start).toBeGreaterThan(0)
    // Walk the braces from the @media opener: every rule we pin must close before the query does,
    // or a moved `}` would hand every user the zoom-less, 150ms-forced overlays.
    const open = css.indexOf('@media (prefers-reduced-motion: reduce) {', start)
    let depth = 0
    let end = -1
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) { end = i; break }
    }
    const inside = css.slice(open, end)
    for (const rule of ["[class~='animate-in']", '.overlay-scrim { transition', '.overlay-scrim[data-ending-style] { transition'])
      expect(inside).toContain(rule)
  })

  it('keeps the blanket kill for every other transition and animation', () => {
    expect(block).toMatch(/\*, \*::before, \*::after \{[^}]*animation-duration:\s*0\.01ms !important/)
    expect(block).toMatch(/\*, \*::before, \*::after \{[^}]*transition-duration:\s*0\.01ms !important/)
    // The refuted first version narrowed transition-property on `*` — authored duration lists then
    // cycled onto the wrong properties and `transition-none` was overridden. Never again.
    expect(block).not.toMatch(/\*, \*::before, \*::after \{[^}]*transition-property/)
  })

  it('tw-animate overlays keep their own fade duration with the travel zeroed — whole tokens only', () => {
    expect(block).toContain("[class~='animate-in'], [class~='animate-out'], [class*=':animate-in'], [class*=':animate-out']")
    expect(block).not.toContain("[class*='animate-in']")
    expect(block).toMatch(/animation-duration:\s*var\(--tw-animation-duration, var\(--tw-duration/)
    for (const v of ['--tw-enter-scale: 1', '--tw-enter-translate-x: 0', '--tw-enter-translate-y: 0', '--tw-exit-scale: 1', '--tw-exit-translate-y: 0'])
      expect(block).toContain(v)
  })

  it('the skeleton pulses instead of freezing', () => {
    expect(block).toContain('.shimmer::after { animation: none !important; }')
    expect(block).toMatch(/\.shimmer \{\s*animation: reduced-motion-pulse/)
  })

  it('the scrim keeps its own opacity fade, exit timing included', () => {
    expect(block).toMatch(/\.overlay-scrim \{ transition: opacity 150ms ease-out !important; \}/)
    expect(block).toMatch(/\.overlay-scrim\[data-ending-style\] \{ transition: opacity var\(--scrim-exit, 150ms ease-out\) !important; \}/)
  })
})
