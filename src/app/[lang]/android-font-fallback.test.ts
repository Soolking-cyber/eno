import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ ANDROID'S SWAP FACE (speed plan R64, audit media-05; the @font-face note in globals.css).
 * next/font's adjusted fallback is local(Arial), which Android cannot match, so a late Open Runde used to move a
 * listing page by up to 0.08 CLS there. The fix is a metric-adjusted Roboto face, and its one way to go wrong is
 * position: a local() face AHEAD of the web face is how the app rendered in Arial for months (price.tsx). next/font
 * writes its own "openRunde Fallback" first and then this `fallback:` list, so the Android face must open the list.
 */
const LAYOUT = readFileSync(join(process.cwd(), 'src/app/[lang]/layout.tsx'), 'utf8')
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
const FAMILY = 'openRunde Fallback Android'

/** The string items of `fallback: [...]` in the localFont call, outer JS quotes removed. */
function fallbackList(): string[] {
  const call = LAYOUT.slice(LAYOUT.indexOf('const openRunde = localFont('))
  const list = call.match(/\bfallback:\s*\[([^\]]*)\]/)?.[1] ?? ''
  return [...list.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2])
}

/** The body of the @font-face block that declares FAMILY. */
function androidFace(): string {
  const at = CSS.indexOf(`font-family: "${FAMILY}";`)
  const open = CSS.lastIndexOf('@font-face {', at)
  return at > 0 && open > 0 ? CSS.slice(open, CSS.indexOf('}', at) + 1) : ''
}

/** A unicode-range list with case and whitespace normalised away, so the two sources compare as text. */
const norm = (ranges: string) => ranges.replace(/\s+/g, '').toUpperCase()

/** gen-fonts.sh's UNICODES: `UNICODES="…"` plus every `UNICODES+=",…"`, joined as bash does, leading commas dropped. */
function subsetUnicodes(): string {
  const sh = readFileSync(join(process.cwd(), 'scripts/gen-fonts.sh'), 'utf8')
  return norm([...sh.matchAll(/^UNICODES\+?="([^"]+)"/gm)].map((m) => m[1].replace(/^,/, '')).join(','))
}

describe('the Android fallback face', () => {
  it('opens next/font fallback list, so it sits right after "openRunde Fallback" and ahead of the system stack', () => {
    const list = fallbackList()
    // Single quotes, and no double quote in any item: the build writes this list into a double-quoted JS string as is
    // (a double-quoted family name failed the production build with "Expected ',', got 'ident'").
    expect(list[0]).toBe(`'${FAMILY}'`)
    for (const item of list) expect(item).not.toContain('"')
    expect(list.slice(1)).toEqual(['ui-sans-serif', 'system-ui', 'sans-serif'])
    // The Arial face next/font generates must stay on, or this one would lead on every platform with Roboto.
    expect(LAYOUT).not.toMatch(/adjustFontFallback:\s*false/)
  })

  it('is local Roboto with the measured overrides, no download, no weight range, and only the subset code points', () => {
    const face = androidFace()
    expect(face).not.toBe('')
    expect(face).toContain('src: local("Roboto"), local("Roboto-Regular");')
    expect(face).toContain('size-adjust: 106.6%;')
    expect(face).toContain('ascent-override: 90.8%;')
    expect(face).toContain('descent-override: 22.6%;')
    expect(face).toContain('line-gap-override: 0%;')
    expect(face).not.toMatch(/url\(/)
    // A `100 900` range would make static Roboto (Android 11 and older) paint bold text regular.
    expect(face).not.toMatch(/font-weight/)
    // ⛔ Swap-only means exactly Open Runde's code points. With no range (or a stale one after a subset change) every
    // glyph the subset lacks, all Cyrillic for the `ru` UI and Latin Ext-A/B, stays in this 6.6%-larger fake-bold face
    // on Android after Open Runde loads, instead of system Roboto.
    const subset = subsetUnicodes()
    expect(subset).toMatch(/^U\+0000-00FF,.*U\+1EA0-1EF9,.*U\+FFFD$/) // the parser read the generator
    expect(norm(face.match(/unicode-range:([^;]*);/)?.[1] ?? '')).toBe(subset)
  })

  it('is declared once', () => {
    expect(CSS.split(`font-family: "${FAMILY}"`).length - 1).toBe(1)
  })
})
