import { describe, expect, it } from 'vitest'
import { RADIO_CARD, RADIO_CHIP } from './shared'

/**
 * The teacher form's two radio looks, checked = the SELECTED GREY (owner, 2026-11-17: "Grey everywhere"; ui/chip-style.ts has
 * the ruling) — never the blue they were (the accent tint inside a 2px brand inset ring; a brand edge on the card).
 */
const cls = (s: string) => s.split(/\s+/)

describe('teacher form radios', () => {
  it('RADIO_CHIP checked: the selected grey under ink, edge and inset ring transparent (same widths, nothing moves)', () => {
    expect(cls(RADIO_CHIP)).toEqual(expect.arrayContaining([
      'data-checked:border-transparent', 'data-checked:bg-line-strong', 'data-checked:text-foreground', 'data-checked:inset-ring-transparent',
    ]))
    for (const c of ['data-checked:bg-accent', 'data-checked:text-accent-foreground', 'data-checked:inset-ring-2', 'data-checked:inset-ring-brand']) {
      expect(cls(RADIO_CHIP), c).not.toContain(c)
    }
    // unchanged: the resting outline, and an unchecked radio never hovers into the checked look
    expect(cls(RADIO_CHIP)).toEqual(expect.arrayContaining(['bg-card', 'inset-ring', 'inset-ring-line-strong', 'not-data-checked:hover:bg-muted']))
  })

  it('RADIO_CARD checked: the selected grey with a grey edge, a muted second line lifted to ink-3; the rest unchanged', () => {
    expect(cls(RADIO_CARD)).toEqual(expect.arrayContaining([
      'border', 'border-border', 'data-checked:border-line-strong', 'data-checked:bg-line-strong', 'data-checked:text-foreground',
      'data-checked:[&_.text-muted-foreground]:text-ink-3',
    ]))
    expect(cls(RADIO_CARD)).not.toContain('data-checked:border-brand')
  })
})
