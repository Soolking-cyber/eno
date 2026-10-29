// @vitest-environment jsdom
/**
 * The AI guide's mark in the search bar (owner, 2026-10-29: "replace the ai icon with human with sound animation there
 * is one on solar pack"): Solar's user-speak-rounded drawn inline, so its two sound waves can pulse (globals.css
 * `guide-wave`), and the button that asks for help keeps its name and its "you are here" state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

import { AISearchButton, GuideMark } from './ai-concierge'

const NAME = 'AI shopping assistant'
afterEach(cleanup)

describe('GuideMark', () => {
  it('is a person with two sound waves, each one animated, the near one first', () => {
    const { container } = render(<GuideMark className="h-6 w-6" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.querySelectorAll('circle, ellipse')).toHaveLength(2)
    const waves = [...svg.querySelectorAll('path.guide-wave')]
    expect(waves.map((w) => w.classList.contains('guide-wave-near') ? 'near' : 'far')).toEqual(['near', 'far'])
  })
})

describe('AISearchButton', () => {
  it('draws the guide mark, keeps its name, and marks the AI chat as the current page', () => {
    const onClick = vi.fn()
    const { rerender } = render(<AISearchButton active={false} onClick={onClick} />)
    const btn = screen.getByRole('button', { name: NAME })
    expect(btn.querySelector('svg path.guide-wave')).toBeTruthy()
    expect(btn.getAttribute('aria-current')).toBeNull()
    btn.click()
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(<AISearchButton active onClick={onClick} />)
    expect(screen.getByRole('button', { name: NAME }).getAttribute('aria-current')).toBe('page')
  })
})
