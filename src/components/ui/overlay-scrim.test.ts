import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * EVERY 75ms-EXIT OVERLAY PRIMITIVE HANDS ITS SCRIM THE SAME EXIT.
 *
 * Base UI unmounts a backdrop when the POPUP's exit ends, not the backdrop's own. `.overlay-scrim`
 * fades out over 150ms by default (globals.css), so a popup leaving in 75ms cut its scrim at ~0.38
 * opacity — tint and blur snapping off on every close of a menu, select, combobox, popover or dialog.
 * area-filter.tsx and custom-select.tsx had fixed it locally; the primitives had not. The fix is the
 * `--scrim-exit` token on each backdrop. jsdom runs no transitions, so this pins the declaration in
 * the source — the timing itself was measured in a real browser.
 */
const SCRIM_EXIT = '[--scrim-exit:75ms_var(--ease-out-strong)]'
const PRIMITIVES = ['popover', 'dropdown-menu', 'select', 'combobox', 'dialog', 'alert-dialog']

describe('overlay primitives: the scrim leaves with its 75ms popup', () => {
  it.each(PRIMITIVES)('%s', (name) => {
    const src = readFileSync(join(__dirname, `${name}.tsx`), 'utf8')
    // Each primitive's popup exits in 75–100ms…
    expect(src).toMatch(/data-closed:duration-(75|100)\b/)
    // …so every overlay-scrim CLASS STRING in it carries the matching exit (comments that mention
    // `.overlay-scrim` in prose are not class strings: a class string opens with the quote).
    const scrims = src.split('\n').filter((line) => /["']overlay-scrim\b/.test(line))
    expect(scrims.length).toBeGreaterThan(0)
    for (const line of scrims) expect(line).toContain(SCRIM_EXIT)
  })
})

/**
 * THE DRAWER'S SCRIM FOLLOWS THE FINGER. Its opacity is driven per drag frame by
 * --drawer-swipe-progress, and the unlayered `.overlay-scrim` transition beats a layered utility —
 * so the zero duration while swiping has to be !important (`duration-0!`) or the dimming trails the
 * sheet by 150ms. And those per-frame variables are registered non-inheriting, so a drag frame does
 * not restyle everything inside the sheet. jsdom evaluates neither; the cascade and the inheritance
 * were measured on the built CSS.
 */
describe('drawer drag', () => {
  it('zeroes the scrim transition while swiping, with the !important that beats the unlayered rule', () => {
    const src = readFileSync(join(__dirname, 'drawer.tsx'), 'utf8')
    const scrim = src.split('\n').find((line) => /["']overlay-scrim\b/.test(line))!
    expect(scrim).toMatch(/\sdata-swiping:duration-0!\s/)
  })

  it('registers the per-frame drag variables as non-inheriting', () => {
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')
    for (const [name, syntax] of [['--drawer-swipe-movement-x', '<length>'], ['--drawer-swipe-movement-y', '<length>'], ['--drawer-swipe-progress', '<number>']])
      expect(css).toMatch(new RegExp(`@property ${name} \\{ syntax: '${syntax}'; inherits: false;`))
  })
})
