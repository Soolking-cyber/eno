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
