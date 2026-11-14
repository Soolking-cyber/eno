// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

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

  // The base curve became the NAMED `ease-spring-snappy` (D-LINT). A caller's `ease-out` must
  // still replace it — rental-check-pill's 200ms entrance depends on it — which needs the curve
  // names taught to tailwind-merge in lib/utils.ts.
  it("a caller's curve replaces the base house curve instead of shipping beside it", () => {
    render(<Button className="ease-out">{X}</Button>)
    const el = screen.getByRole('button', { name: 'x' })
    expect(classes(el)).toContain('ease-out')
    expect(classes(el).filter((c) => c.startsWith('ease-'))).toEqual(['ease-out'])
  })
})

// D-BTNLOAD (2026-09-29). The busy state's whole contract is observable in the DOM: the name stays,
// the state is announced, the click is refused, and focus survives the switch.
const SAVE = 'Save'
describe('Button loading', () => {
  it('keeps its accessible name, reports busy + disabled, and shows exactly one spinner', () => {
    render(<Button loading>{SAVE}</Button>)
    const el = screen.getByRole('button', { name: 'Save' })
    expect(el.getAttribute('aria-busy')).toBe('true')
    expect(el.getAttribute('aria-disabled')).toBe('true')
    // Focusable while busy: NOT the native attribute, which would throw focus to <body>.
    expect(el.hasAttribute('disabled')).toBe(false)
    expect(el.querySelectorAll('svg.animate-spin')).toHaveLength(1)
    // The label is hidden by opacity, never removed or `invisible` (that would drop the name).
    const label = el.querySelector('[data-slot=button-label]')!
    expect(label.textContent).toBe('Save')
    expect(classes(label as HTMLElement)).toContain('opacity-0')
    expect(classes(label as HTMLElement)).not.toContain('invisible')
    // The spinner settles in (@starting-style), never a one-frame swap (Emil audit, tier 4) — and the label has no
    // starting style: @starting-style runs on first mount too, so a button born busy would flash its text.
    expect(classes(label as HTMLElement).some((c) => c.startsWith('starting:'))).toBe(false)
    const spinner = el.querySelector('svg.animate-spin')!.parentElement as HTMLElement
    expect(classes(spinner)).toEqual(expect.arrayContaining(['starting:opacity-0', 'starting:scale-75']))
  })

  it('refuses the click while loading', () => {
    const fn = vi.fn()
    render(<Button loading onClick={fn}>{SAVE}</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(fn).not.toHaveBeenCalled()
  })

  it('keeps focus when it switches from idle to loading and back', () => {
    const { rerender } = render(<Button>{SAVE}</Button>)
    const el = screen.getByRole('button', { name: 'Save' })
    el.focus()
    expect(document.activeElement).toBe(el)
    rerender(<Button loading>{SAVE}</Button>)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }))
    rerender(<Button>{SAVE}</Button>)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }))
  })

  it('beats a caller disabled={false}, and a caller absolute still beats its relative', () => {
    render(<Button loading disabled={false} className="absolute cursor-pointer">{SAVE}</Button>)
    const el = screen.getByRole('button', { name: 'Save' })
    expect(el.getAttribute('aria-disabled')).toBe('true')
    expect(classes(el)).toContain('absolute')
    expect(classes(el)).not.toContain('relative')
    // The wait cursor is variant-scoped so the caller's cursor-pointer cannot delete it.
    expect(classes(el)).toContain('data-loading:cursor-wait')
  })

  it('is inert when false — the idle markup has no wrapper and no busy attributes', () => {
    render(<Button loading={false}>{SAVE}</Button>)
    const el = screen.getByRole('button', { name: 'Save' })
    expect(el.hasAttribute('aria-busy')).toBe(false)
    expect(el.querySelector('[data-slot=button-label]')).toBeNull()
    expect(el.hasAttribute('loading')).toBe(false)
  })
})

describe('Button — the phone size contract (owner-approved 2026-11-14)', () => {
  // jsdom applies no stylesheet: the classes are the contract. Below 640px a primary or secondary at the default or lg
  // size is 48px with a 16px label (`max-sm:min-h-12 max-sm:text-base`); a caller that sizes the button itself keeps it.
  const PHONE = ['max-sm:min-h-12', 'max-sm:text-base']
  const cls = (name = 'Save') => classes(screen.getByRole('button', { name }))
  /** A label (jsx-no-literals wants none written in JSX). */
  const T = (label: string) => label

  it.each(['default', 'cta', 'outline', 'secondary'] as const)('a full-width %s button at the default and lg sizes takes it', (variant) => {
    render(<><Button variant={variant} className="w-full">{SAVE}</Button><Button variant={variant} size="lg" className="max-sm:w-full">{T('Go')}</Button></>)
    expect(cls()).toEqual(expect.arrayContaining(PHONE))
    expect(cls('Go')).toEqual(expect.arrayContaining(PHONE))
    // Below sm only (review r31, 2026-11-07): a `w-full sm:w-auto` button keeps its size from 640px, where it sits inline.
    expect(cls().some((c) => c.startsWith('max-lg:'))).toBe(false)
  })

  it('never on sm / icon / none sizes, nor on ghost, bare, link, destructive or commerce', () => {
    render(<>
      <Button size="sm">{T('A')}</Button><Button size="icon">{T('B')}</Button><Button size="none">{T('C')}</Button>
      <Button variant="ghost">{T('D')}</Button><Button variant="bare">{T('E')}</Button><Button variant="link">{T('F')}</Button>
      <Button variant="destructive">{T('G')}</Button><Button variant="commerce">{T('H')}</Button>
    </>)
    for (const name of 'ABCDEFGH') expect(cls(name)).not.toContain('max-sm:min-h-12')
  })

  it('an inline button keeps its size (review: no 36×48 ovals, no grown inline secondaries)', () => {
    render(<>
      <Button>{T('A')}</Button><Button className="size-9 p-0">{T('B')}</Button><Button variant="outline" className="sm:h-10">{T('C')}</Button>
      <Button className="sm:w-full">{T('D')}</Button><Button className="w-full rounded-full">{T('E')}</Button>
    </>)
    for (const name of 'ABCDE') expect(cls(name)).not.toContain('max-sm:min-h-12')
  })

  it('a full-width button takes 48px over its own min-h (the 2026-11-07 floor), but not with a small label', () => {
    render(<><Button variant="cta" className="min-h-11 w-full text-sm">{SAVE}</Button><Button variant="cta" className="w-full text-xs">{T('Tiny')}</Button></>)
    expect(cls()).toEqual(expect.arrayContaining([...PHONE, 'min-h-11', 'w-full']))
    expect(cls('Tiny')).not.toContain('max-sm:min-h-12')
  })

  it('an icon sized through an arbitrary variant is not the box: `[&_svg]:h-4` does not opt out', () => {
    render(<Button className="w-full [&_svg]:h-4">{SAVE}</Button>)
    expect(cls()).toEqual(expect.arrayContaining(PHONE))
  })

  it('asChild reads the child\'s classes too', () => {
    render(<Button asChild><a href="/x" className="h-8">{T('Link')}</a></Button>)
    expect(classes(screen.getByRole('link', { name: 'Link' }))).not.toContain('max-sm:min-h-12')
  })

  it('one primary, one secondary: accent fill + bold; white + 1px ink edge + ink bold label', () => {
    render(<><Button>{SAVE}</Button><Button variant="outline">{T('Out')}</Button><Button variant="secondary">{T('Sec')}</Button></>)
    expect(cls()).toEqual(expect.arrayContaining(['bg-primary', 'font-bold', 'hover:bg-cta-dark', 'active:bg-cta-dark']))
    for (const name of ['Out', 'Sec']) {
      expect(cls(name)).toEqual(expect.arrayContaining(['border', 'border-foreground', 'bg-background', 'text-foreground', 'font-bold', 'active:bg-muted']))
      expect(cls(name)).not.toContain('bg-secondary')
    }
  })
})
