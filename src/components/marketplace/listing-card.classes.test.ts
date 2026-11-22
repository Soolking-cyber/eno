import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The listing card's five repeated utility sets live in globals.css as .card-root / .card-link / .card-media / .card-img /
 * .card-pips since 2026-11-22 (owner: the home page's content-no-js ratio — each card carried ~0.85 KB of utility text, on up
 * to ~32 cards a page). The card tests used to read these utilities off the elements; they read the class now, and this pins
 * what each class applies, so a behaviour those tests guarded (the pressed scale, the pending dim, the pips' place, the
 * photo's tint and stacking) cannot quietly fall out of the CSS. ⛔ And the classes stay in @layer components, below the
 * utilities, so a conditional utility the card still adds keeps overriding them as it overrode the same utilities before.
 */
const CSS = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8')
const block = (cls: string) => {
  const m = CSS.match(new RegExp(`\\.${cls} \\{\\s*@apply ([^;]+);\\s*\\}`))
  expect(m, `.${cls} in globals.css`).not.toBeNull()
  return m![1].split(/\s+/)
}

describe('the listing card classes in globals.css', () => {
  it('sit in @layer components, after .plate-lg', () => {
    const at = CSS.lastIndexOf('.card-root {')
    const layer = CSS.lastIndexOf('@layer components {', at)
    expect(layer).toBeGreaterThan(CSS.indexOf('.plate-lg {'))
    // Nothing closes the layer between its opening and the five classes.
    expect(CSS.slice(layer, at).match(/^\}/m)).toBeNull()
  })

  it('.card-root: the pressed scale, the in-card button guard and the pending scale', () => {
    expect(block('card-root')).toEqual(expect.arrayContaining([
      'relative', 'flex', 'flex-col', 'h-full', 'w-full', 'text-left', 'cursor-pointer', 'transition-transform', 'duration-200',
      'active:scale-[0.97]', 'has-[button:active]:scale-100', 'data-pending:scale-[0.97]', '[touch-action:manipulation]',
    ]))
  })

  it('.card-link: covers the card under the photo, with the focus ring', () => {
    expect(block('card-link')).toEqual(expect.arrayContaining(['absolute', 'inset-0', 'z-0', 'focus-visible:ring-2', 'focus-visible:ring-offset-2']))
  })

  it('.card-media: the tint, the stacking context, the hover lift and the pending dim — never the ratio (the element keeps aspect-square)', () => {
    const b = block('card-media')
    expect(b).toEqual(expect.arrayContaining(['relative', 'isolate', 'w-full', 'overflow-hidden', 'bg-tint', 'transform-gpu', 'group-hover:shadow-[var(--shadow-card)]', 'group-data-pending:opacity-80']))
    expect(b.some((t) => t.startsWith('aspect-'))).toBe(false)
  })

  it('.card-img and .card-pips', () => {
    expect(block('card-img')).toEqual(expect.arrayContaining(['transition-[filter]', 'group-hover:brightness-105', 'dark:brightness-[0.92]']))
    expect(block('card-pips')).toEqual(expect.arrayContaining(['pointer-events-none', 'absolute', 'bottom-2', 'left-1/2', 'z-10', 'flex', '-translate-x-1/2']))
  })
})
