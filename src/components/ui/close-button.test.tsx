// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { LanguageProvider } from '@/context/language-context'
import { CLOSE_GLYPH } from '@/lib/icon-tokens'
import { CloseButton } from './close-button'

/**
 * D-CLOSE (2026-09-29). What the primitive promises, in the DOM: a NAME (the ✕ says nothing to a
 * screen reader on its own), the 44px hit area, and a glyph DERIVED from the button box — the two
 * sizes could be edited apart at every hand-typed call site, and appeal/reports drew a 26px ring on
 * a 20px plate because they were.
 */
afterEach(cleanup)
const wrap = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>)
const cls = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)
const REMOVE = 'Remove'

describe('CloseButton', () => {
  it('is a button named "Close" by default, with the 44px hit area, and fires onClick', () => {
    const fn = vi.fn()
    wrap(<CloseButton onClick={fn} />)
    const el = screen.getByRole('button', { name: 'Close' })
    expect(cls(el)).toContain('tap-44')
    expect(cls(el)).toContain('relative')
    fireEvent.click(el)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('takes the label it is given — the ✕ is not always "Close"', () => {
    wrap(<CloseButton label={REMOVE} />)
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
  })

  it('derives the glyph from the button: the ghost ✕ fills its box (owner rule, 43dd9bcf)', () => {
    for (const size of ['xs', 'sm', 'md', 'lg'] as const) {
      cleanup()
      wrap(<CloseButton size={size} />)
      const svg = screen.getByRole('button').querySelector('svg')!
      expect(cls(svg)).toContain(CLOSE_GLYPH.ghost[size])
    }
    expect(CLOSE_GLYPH.ghost).toMatchObject({ xs: 'size-[29px]', sm: 'size-[33px]', md: 'size-[38px]', lg: 'size-[42px]' })
  })

  it('the overlay ✕ is the button minus its 6px plate — 2xs is the 24px photo-tile remove, 18px mark', () => {
    wrap(<CloseButton size="2xs" variant="overlay" tapTarget={false} label={REMOVE} />)
    const el = screen.getByRole('button', { name: 'Remove' })
    expect(cls(el)).toEqual(expect.arrayContaining(['h-6', 'w-6', 'plate-host']))
    expect(cls(el)).not.toContain('tap-44')
    // The overlay owns its ink (white on the plate) — the ghost tone must not leak onto it.
    expect(cls(el)).not.toContain('text-ink-4')
    expect(cls(el.querySelector('svg')!)).toContain('size-[18px]')
  })

  it('wears the house close ink, and a caller ink replaces it rather than stacking', () => {
    wrap(<CloseButton className="text-body" />)
    const el = screen.getByRole('button', { name: 'Close' })
    expect(cls(el)).toContain('text-body')
    expect(cls(el)).not.toContain('text-ink-4')
    expect(cls(el)).toContain('hover:text-foreground')
  })

  // A migrated close that never darkened on hover (trip-map, availability) pins its old ink; the
  // caller's hover ink must REPLACE the ghost tone's, not ship beside it and lose on stylesheet order.
  it("a caller's hover ink replaces the ghost tone's hover:text-foreground", () => {
    wrap(<CloseButton className="text-ink-3 hover:text-ink-3" />)
    const el = screen.getByRole('button', { name: 'Close' })
    expect(cls(el)).toEqual(expect.arrayContaining(['text-ink-3', 'hover:text-ink-3']))
    expect(cls(el)).not.toContain('hover:text-foreground')
  })
})
