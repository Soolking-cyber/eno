// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { Chip, chipVariants } from './chip'

/**
 * D-CHIP (2026-09-29). Two elements behind one component, chosen by whether `pressed` is passed —
 * the contract is which ARIA each one carries, because that is what a screen reader and the
 * forced-colors rules in globals.css key on.
 */
afterEach(cleanup)
const cls = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)
const [ASK, FILTER] = ['Is it still available?', 'Furnished']

describe('Chip', () => {
  it('without `pressed` it is an action button: no aria-pressed, and the click fires', () => {
    const fn = vi.fn()
    render(<Chip size="xs" tone="ghost" onClick={fn}>{ASK}</Chip>)
    const el = screen.getByRole('button', { name: ASK })
    expect(el.hasAttribute('aria-pressed')).toBe(false)
    expect(el.getAttribute('data-slot')).toBe('button')
    // The 28px composer chip: min-h (never h — the OS text size grows the line box), transparent at rest.
    expect(cls(el)).toEqual(expect.arrayContaining(['min-h-7', 'rounded-full', 'text-xs', 'text-body', 'hover:bg-muted']))
    expect(cls(el)).not.toContain('bg-tint')
    fireEvent.click(el)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('with `pressed` it is a toggle: aria-pressed + data-pressed follow the prop, and a tap asks for the flip', () => {
    const onPressedChange = vi.fn()
    const { rerender } = render(<Chip pressed={false} onPressedChange={onPressedChange}>{FILTER}</Chip>)
    const el = screen.getByRole('button', { name: FILTER })
    expect(el.getAttribute('aria-pressed')).toBe('false')
    expect(el.hasAttribute('data-pressed')).toBe(false)
    fireEvent.click(el)
    expect(onPressedChange).toHaveBeenCalledWith(true)
    rerender(<Chip pressed onPressedChange={onPressedChange}>{FILTER}</Chip>)
    const on = screen.getByRole('button', { name: FILTER })
    expect(on.getAttribute('aria-pressed')).toBe('true')
    expect(on.hasAttribute('data-pressed')).toBe(true)
  })

  it('sizes are 28 / 32 / 36 and neutral is the default tone', () => {
    expect(chipVariants({ size: 'xs' })).toContain('min-h-7')
    expect(chipVariants({ size: 'sm' })).toContain('min-h-8')
    expect(chipVariants({ size: 'md' })).toContain('min-h-9')
    expect(chipVariants({})).toContain('bg-tint')
  })
})
