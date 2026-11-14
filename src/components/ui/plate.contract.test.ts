/**
 * THE PHOTO PLATE IS ONE DEFINITION (owner-approved 2026-11-14, cook r05 shell: "every control over a photo … one white
 * plate, ink glyph"). globals.css's `.icon-plate, .plate-host svg` lives in `@layer components`, so ANY utility at a call
 * site beats it: a `text-white` puts a white glyph on the white plate, a padding or `[&_svg]:bg-*` re-shapes or re-fills it,
 * and a drop-shadow filter rings it twice. This reads every source file that plates something and refuses those pairings,
 * and pins the stylesheet block itself (theme-invariant, so no `.dark` override).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CSS = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8')

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'generated' && name !== 'node_modules') yield* files(p) }
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p
  }
}

/** Every string literal on a line that names a plate (a class string is one literal — or a template, or a cn() call on one line). */
const BANNED = [
  /(?<![\w:-])text-white(?![\w/-])/, // a white glyph on the white plate
  /dark:text-neutral-900/, // the old dark-mode ink, meaningless on a theme-invariant plate
  /\[&_svg\]:(?:bg|p)-/, // re-fills or re-pads the plate from the call site
  /\[filter:drop-shadow/, // a second shadow around a plated glyph
  /icon-shadow-brand/, // the old over-photo glyph shadow
]

describe('the photo plate — call sites', () => {
  it('no source line that names plate-host / icon-plate / variant="overlay" also carries a banned ink, fill, padding or shadow', () => {
    const hits: string[] = []
    let plated = 0
    for (const f of files(SRC)) {
      const lines = readFileSync(f, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (/^\s*(?:\/\/|\*|\/\*|\{\/\*)/.test(line)) return // comments may quote history
        if (!/plate-host|icon-plate|variant="overlay"|variant: 'overlay'/.test(line)) return
        plated++
        for (const re of BANNED) if (re.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}  ${re}`)
      })
    }
    expect(plated).toBeGreaterThan(10) // the scan found the plate's call sites at all
    expect(hits).toEqual([])
  })

  it('every overlay variant and plated arrow inks its glyph with text-on-plate', () => {
    const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
    expect(read('src/components/ui/icon-button.tsx')).toContain("overlay: 'plate-host text-on-plate',")
    expect(read('src/components/ui/carousel.tsx')).toContain("const ARROW_GLYPH = 'icon-plate size-7 text-on-plate'")
    expect(read('src/hooks/use-scroll-arrows.tsx')).toContain("const arrowIcon = 'icon-plate size-7 text-on-plate'")
    expect(read('src/components/marketplace/back-to-top.tsx')).toContain('className="icon-plate size-7 text-on-plate"')
  })
})

describe('the photo plate — the stylesheet', () => {
  const block = (() => {
    const at = CSS.indexOf('  .icon-plate,\n  .plate-host svg {')
    expect(at).toBeGreaterThan(-1)
    return CSS.slice(at, CSS.indexOf('}', at) + 1)
  })()

  it('95% white, padded by --plate-pad (3px unless .plate-lg says 6), with its own shadow', () => {
    expect(block).toContain('background-color: var(--plate-fill);')
    expect(block).toContain('padding: var(--plate-pad, 3px);')
    expect(block).toContain('box-sizing: content-box;')
    expect(block).toContain('box-shadow: var(--shadow-plate);')
    expect(CSS).toMatch(/\.plate-lg \{\s*--plate-pad: 6px;\s*\}/)
    expect(CSS).toMatch(/--plate-fill: rgb\(255 255 255 \/ 0\.95\);/)
    expect(CSS).toMatch(/--on-plate: #141414;/)
  })

  it('theme-invariant: no `.dark` plate override, and the plate tokens are never redefined', () => {
    expect(CSS).not.toMatch(/\.dark \.plate-host/)
    expect(CSS).not.toMatch(/\.dark \.icon-plate/)
    expect(CSS).not.toMatch(/\.dark a:hover \.icon-plate/)
    for (const t of ['--plate-fill', '--on-plate', '--shadow-plate']) expect(CSS.split(`${t}:`).length - 1, t).toBe(1)
  })

  it('the photo badge is the plate as a 26px pill: fill, ink, 700 13/16, tabular', () => {
    const at = CSS.indexOf('  .photo-badge {')
    expect(at).toBeGreaterThan(-1)
    const b = CSS.slice(at, CSS.indexOf('}', at))
    for (const d of ['height: 26px;', 'background-color: var(--plate-fill);', 'color: var(--on-plate);', 'font-size: 0.8125rem;', 'line-height: 1rem;', 'font-weight: 700;', 'font-variant-numeric: tabular-nums;', 'box-shadow: var(--shadow-photo-badge);']) {
      expect(b).toContain(d)
    }
  })
})
