// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { SwitchRow } from './switch'

/**
 * SwitchRow (2026-10-08) — "every switch has a VISIBLE label". The contract is what a screen reader and a finger get:
 * the name is the label alone, the description is read once as the description, and only the label row toggles —
 * a tap on a consent switch's notice while reading it must never flip it.
 */
afterEach(cleanup)
const LABEL = 'Available for cover lessons'
const NOTICE = 'Switching this on shows your free periods on your public profile.'

describe('SwitchRow', () => {
  it('names the switch by its VISIBLE label alone, and reads the description as its description', () => {
    render(<SwitchRow checked={false} onChange={() => {}} label={LABEL} description={NOTICE} />)
    const sw = screen.getByRole('switch', { name: LABEL })
    expect(screen.getByText(LABEL)).toBeTruthy() // visible, not an aria-label
    expect(sw.getAttribute('aria-labelledby')).toBeTruthy()
    const described = (sw.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent)
    expect(described).toEqual([NOTICE])
  })

  it('the label row toggles; the description does not', () => {
    const onChange = vi.fn()
    render(<SwitchRow checked={false} onChange={onChange} label={LABEL} description={NOTICE} />)
    fireEvent.click(screen.getByText(NOTICE))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('switch', { name: LABEL }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('reports its state, and no description means no aria-describedby', () => {
    render(<SwitchRow checked onChange={() => {}} label={LABEL} />)
    const sw = screen.getByRole('switch', { name: LABEL })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(sw.hasAttribute('aria-describedby')).toBe(false)
  })
})
