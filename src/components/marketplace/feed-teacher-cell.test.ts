/**
 * Batch 80 (commit review): a teacher card is taller than the plain card (its proof line), so the explorer marks a
 * teacher's grid cell `data-teacher-cell` and globals.css gives that cell its own never-rendered size guess at every
 * breakpoint the plain card has one. Source pins: a rule dropped at one breakpoint, or the marker dropped from the cell,
 * fails here (the CSS is not evaluated by jsdom).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
const explorer = readFileSync(join(process.cwd(), 'src/components/marketplace/listings-explorer.tsx'), 'utf8')

describe('a teacher cell in the feed has its own size guess', () => {
  it('the explorer marks a teacher card\'s grid cell, and only a teacher\'s', () => {
    expect(explorer).toContain("data-teacher-cell={l.listingType === 'teacher' || undefined}")
  })

  it('every plain [data-feed-card] fallback has a teacher twin, taller by the proof line', () => {
    const plain = [...css.matchAll(/^\s*\[data-feed-card\] \{ contain-intrinsic-size: auto ([^;]+);/gm)].map((m) => m[1])
    const teacher = [...css.matchAll(/^\s*\[data-feed-card\]\[data-teacher-cell\] \{ contain-intrinsic-size: auto ([^;]+);/gm)].map((m) => m[1])
    // The base rule is a block (content-visibility + size); the three breakpoints are one-liners.
    expect(css).toMatch(/\[data-feed-card\] \{\n\s*content-visibility: auto;\n\s*contain-intrinsic-size: auto calc\(50vw \+ 65px\);/)
    expect(plain).toEqual(['calc((100vw - 64px) / 3 + 73px)', 'calc((100vw - 88px) / 4 + 73px)', '371px'])
    expect(teacher).toEqual(['calc(50vw + 83.5px)', 'calc((100vw - 64px) / 3 + 94.75px)', 'calc((100vw - 88px) / 4 + 94.75px)', '392.75px'])
  })
})
