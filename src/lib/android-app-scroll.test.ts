import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The Android app's scroll costs (owner, 2026-10-29: "android app performance is bad doesnt scroll smooth gittery … should
 * be similar experience as ios app"). Two effects Chromium pays for on every scrolling frame are switched off in the
 * Android app only — `native-android` on <html>, set before first paint by the head script — and iOS keeps both.
 */
const css = readFileSync('src/app/globals.css', 'utf8')
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`)
  return at < 0 ? null : css.slice(at, css.indexOf('}', at) + 1)
}

describe('the Android app scrolls without the two per-frame effects', () => {
  it('no backdrop blur on any material there — the blur only (unprefixed, so the build emits both spellings); tints untouched', () => {
    const r = rule('.native-android .material')
    expect(r).not.toBeNull()
    expect(r).toMatch(/backdrop-filter: none !important;/)
    expect(r).not.toMatch(/-webkit-backdrop-filter/)
    // ⛔ reduce-transparency's opaque fills are NOT copied to Android: they repaint the home strip's wash.
    expect(css).not.toMatch(/\.native-android[^{]*\{[^}]*background/)
  })

  it('no scroll-driven card reveal there — a top-level rule that outranks the one inside @supports', () => {
    expect(rule('html.native-android .reveal-on-scroll')).toMatch(/animation: none;/)
    const reveal = css.indexOf('.reveal-on-scroll {')
    const off = css.indexOf('html.native-android .reveal-on-scroll {')
    expect(off).toBeGreaterThan(reveal)
  })

  it('the head script sets native-android before first paint (the hook both rules hang on)', () => {
    const layout = readFileSync('src/app/[lang]/layout.tsx', 'utf8')
    expect(layout).toContain("dc.add('native-'+(C.getPlatform?C.getPlatform():'ios'))")
  })
})
