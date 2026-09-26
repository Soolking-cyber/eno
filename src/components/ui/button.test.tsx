// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { Button } from './button'

/**
 * The press is a `scale` transition in the base class list. A caller's `transition-colors` (or
 * -opacity / -shadow) is the same tailwind-merge group, so it used to DELETE that list and leave
 * `active:scale-[0.97]` with nothing to tween — a one-frame jump on every tap. jsdom cannot see a
 * frame, but it can see the class list, which is where the bug lived.
 */
const classes = (el: HTMLElement) => el.className.split(/\s+/)
const hasScaleTransition = (el: HTMLElement) =>
  classes(el).some((c) => c.startsWith('transition-[') && c.includes('scale'))

afterEach(cleanup)

// Fixture labels as consts: `react/jsx-no-literals` lints tests too, and a bare word in JSX is
// indistinguishable to it from untranslated product copy.
const LOAD_MORE = 'Load more'
const [A, B, C, D, X] = ['a', 'b', 'c', 'd', 'x']

describe('Button keeps its press transition', () => {
  it('a caller transition-colors no longer deletes the base scale transition', () => {
    render(<Button className="transition-colors hover:bg-muted">{LOAD_MORE}</Button>)
    const el = screen.getByRole('button', { name: 'Load more' })
    expect(hasScaleTransition(el)).toBe(true)
    expect(classes(el)).not.toContain('transition-colors')
    expect(classes(el)).toContain('hover:bg-muted')
  })

  it('does the same for -opacity and -shadow, and on an asChild child', () => {
    render(
      <>
        <Button className="transition-opacity">{A}</Button>
        <Button className="transition-shadow">{B}</Button>
        <Button asChild>
          <a href="/x" className="transition-colors">{C}</a>
        </Button>
      </>,
    )
    expect(hasScaleTransition(screen.getByRole('button', { name: 'a' }))).toBe(true)
    expect(hasScaleTransition(screen.getByRole('button', { name: 'b' }))).toBe(true)
    expect(hasScaleTransition(screen.getByRole('link', { name: 'c' }))).toBe(true)
  })

  it('keeps deliberate choices: a list naming scale, transition-none, variant and important forms', () => {
    render(
      <>
        <Button className="transition-[scale]">{A}</Button>
        <Button className="transition-none">{B}</Button>
        <Button className="hover:transition-colors">{C}</Button>
        <Button className="transition-colors!">{D}</Button>
      </>,
    )
    expect(classes(screen.getByRole('button', { name: 'a' }))).toContain('transition-[scale]')
    expect(classes(screen.getByRole('button', { name: 'b' }))).toContain('transition-none')
    expect(classes(screen.getByRole('button', { name: 'c' }))).toContain('hover:transition-colors')
    expect(classes(screen.getByRole('button', { name: 'd' }))).toContain('transition-colors!')
  })

  it('a caller duration still merges with the base', () => {
    render(<Button className="transition-colors duration-300">{X}</Button>)
    const el = screen.getByRole('button', { name: 'x' })
    expect(classes(el)).toContain('duration-300')
    expect(classes(el)).not.toContain('duration-[160ms]')
  })
})
