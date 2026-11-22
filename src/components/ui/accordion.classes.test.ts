import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ui/accordion's trigger and chevron utilities live in globals.css as .acc-trigger / .acc-chevron since 2026-11-22 (the home
 * FAQ draws 14 triggers; owner: the raw HTML's text ÷ markup ratio). This pins what they apply — the press state the trigger
 * had to gain (the comment in accordion.tsx), and the chevron's turn keyed on the NAMED group the trigger still carries.
 */
const ROOT = join(__dirname, '..', '..')
const CSS = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8')
const TSX = readFileSync(join(ROOT, 'components', 'ui', 'accordion.tsx'), 'utf8')
const block = (cls: string) => {
  const m = CSS.match(new RegExp(`\\.${cls} \\{\\s*@apply ([^;]+);\\s*\\}`))
  expect(m, `.${cls} in globals.css`).not.toBeNull()
  return m![1].split(/\s+/)
}

describe('ui/accordion classes', () => {
  it('the trigger keeps the named group its chevron keys on, and .acc-trigger keeps the press state', () => {
    expect(TSX).toContain('"acc-trigger group/acc-trigger"')
    expect(block('acc-trigger')).toEqual(expect.arrayContaining([
      'flex', 'flex-1', 'justify-between', 'py-4', 'text-left', 'text-base', 'font-bold', 'active:scale-[0.99]', 'active:duration-[60ms]',
      'hover:text-accent-foreground', 'focus-visible:outline-ring', 'disabled:pointer-events-none',
    ]))
  })

  it('.acc-chevron turns with the open panel', () => {
    expect(TSX).toContain('className="acc-chevron"')
    expect(block('acc-chevron')).toEqual(expect.arrayContaining(['h-4', 'w-4', 'transition-transform', 'group-data-panel-open/acc-trigger:rotate-180']))
  })
})
