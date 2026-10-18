import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⛔ The iPhone box round the filters (owner, 2026-10-18: "make sure you remove that box"). Under prefers-contrast:
// more (iOS Increase Contrast) every `.material` surface gets a 1px currentColor outline — right for a floating
// surface, wrong for the explorer's in-flow sticky strip, which drew a full-width white box on the dark theme.
const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8')
const toolbar = readFileSync(join(__dirname, '../components/marketplace/explorer-toolbar.tsx'), 'utf8')

/** The `@media (prefers-contrast: more)` block itself: from its opening line to the first unindented `}` after it. */
function contrastBlock(): string {
  const start = css.indexOf('@media (prefers-contrast: more) {')
  expect(start).toBeGreaterThan(-1)
  const end = css.indexOf('\n}\n', start)
  expect(end).toBeGreaterThan(start)
  return css.slice(start, end)
}

describe('high contrast: no box round an in-flow material bar', () => {
  it('inside the prefers-contrast block, the outline rule skips `.material-bar` and still yields to focus', () => {
    const block = contrastBlock()
    expect(block).toMatch(/\.material:not\(:focus-visible\):not\(\.material-bar\)\s*\{\s*outline: 1px solid currentColor;/)
    // No second, unguarded copy of the outline anywhere in the stylesheet.
    expect(css).not.toMatch(/\.material:not\(:focus-visible\)\s*\{/)
  })
  it('the explorer strip — the sticky one with the frosted fill — is marked a bar, and keeps its `material` marker', () => {
    const line = toolbar.split('\n').find((l) => /'sticky z-30 [^']*backdrop-blur/.test(l))
    expect(line).toBeDefined()
    const tokens = line!.slice(line!.indexOf("'") + 1, line!.lastIndexOf("'")).split(/\s+/)
    expect(tokens).toEqual(expect.arrayContaining(['material', 'material-bar', 'backdrop-blur']))
  })
})
