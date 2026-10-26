// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { PageActionBar, PageActions, PageActionsInline } from './page-actions'
import { BARS_IN_COLUMN, COLUMN } from './column'

/**
 * MOBILE FIRST (owner, 2026-10-26: "the whole ui should take mobile first approach"). A classroom page's one action is
 * pinned to the bottom edge on a phone (ui/sticky-action-bar) and inline from `lg`, built from the SAME action objects;
 * and every classroom page is one phone-width column at every size.
 */
afterEach(cleanup)
const ERROR = 'Not saved'

describe('PageActions', () => {
  it('⛔ a Back that appears on the next step does not take the focus from the primary (both halves)', () => {
    // The join flow's Who → Consent step adds `secondary` under a primary the learner just pressed with the keyboard: the
    // primary must stay the same element (an empty slot holds Back's place), or a second Space would go BACK.
    const next = { label: 'Next', onClick: () => {} }
    const { rerender } = render(<PageActions primary={next} note={null} />)
    const [inlineNext, barNext] = screen.getAllByRole('button', { name: 'Next' })
    inlineNext.focus()
    rerender(<PageActions primary={{ ...next, label: 'Join the class' }} secondary={{ label: 'Back', onClick: () => {} }} note={null} />)
    expect(document.activeElement).toBe(inlineNext)
    expect(inlineNext.textContent).toBe('Join the class')
    barNext.focus()
    rerender(<PageActions primary={next} note={null} />)
    rerender(<PageActions primary={{ ...next, label: 'Yes' }} secondary={{ label: 'Back', onClick: () => {} }} note={null} />)
    expect(document.activeElement).toBe(barNext)
    expect(barNext.textContent).toBe('Yes')
  })

  it('the pinned bar (with its spacer) below lg, the inline twin from lg — the same two actions in both', () => {
    const { container } = render(<PageActions primary={{ label: 'Join the class', onClick: () => {} }} secondary={{ label: 'Back', onClick: () => {} }} note={null} />)
    expect(container.querySelector('[data-slot="sticky-action-bar"]')!.className).toContain('lg:hidden')
    expect(container.querySelector('[data-slot="sticky-action-bar-spacer"]')!.className).toContain('lg:hidden')
    const inline = container.querySelector('.lg\\:flex')!
    expect(inline.className).toContain('hidden')
    expect(screen.getAllByRole('button', { name: 'Join the class' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Back' })).toHaveLength(2)
  })

  it('note={null} keeps the stacked panel, so an error arriving later does not remount the primary', () => {
    const { container } = render(<PageActions primary={{ label: 'Next', onClick: () => {} }} note={null} />)
    expect(container.querySelector('[data-slot="sticky-action-bar-panel"]')!.className).toContain('flex-col')
  })

  it('an error note rides both halves — beside the button that was tapped', () => {
    render(<PageActions primary={{ label: 'Next', onClick: () => {} }} note={<p role="alert">{ERROR}</p>} />)
    expect(screen.getAllByText(ERROR)).toHaveLength(2)
  })

  it('the inline twin acts, keeps disabled, and is a 48px target whose label may wrap', () => {
    const onClick = vi.fn()
    const { rerender, container } = render(<PageActionsInline primary={{ label: 'Save', onClick }} />)
    const button = container.querySelector('button')!
    expect(button.className).toContain('min-h-12')
    expect(button.className).toContain('whitespace-normal')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(<PageActionsInline primary={{ label: 'Save', onClick, disabled: true }} />)
    fireEvent.click(container.querySelector('button')!)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('the bar half alone is the bar and its spacer, nothing inline', () => {
    const { container } = render(<PageActionBar primary={{ label: 'Sign in to start', onClick: () => {} }} />)
    expect(container.querySelectorAll('[data-slot="sticky-action-bar"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="sticky-action-bar-spacer"]')).toHaveLength(1)
    expect(container.querySelector('.lg\\:flex')).toBeNull()
  })
})

describe('the phone-width column', () => {
  it('is 28rem wide, centred, with gutters that clear a sideways notch', () => {
    expect(COLUMN).toContain('max-w-md')
    expect(COLUMN).toContain('mx-auto')
    expect(COLUMN).toContain('pl-[max(1rem,env(safe-area-inset-left))]')
    expect(COLUMN).toContain('pr-[max(1rem,env(safe-area-inset-right))]')
    expect(BARS_IN_COLUMN).toContain('[&_[data-slot=sticky-action-bar-panel]]:max-w-md')
  })

  it('the layout, its <main> and the header row all take it', () => {
    const layout = readFileSync('src/app/[lang]/classroom/layout.tsx', 'utf8')
    expect(layout).toContain("cn('flex min-h-page flex-col bg-background', BARS_IN_COLUMN)")
    expect(layout).toMatch(/<main id="main"[^>]*className=\{cn\(COLUMN,/)
    const header = readFileSync('src/components/classroom/classroom-header.tsx', 'utf8')
    expect(header).toContain("className={cn(COLUMN, 'flex h-14 items-center justify-between gap-3')}")
  })
})
