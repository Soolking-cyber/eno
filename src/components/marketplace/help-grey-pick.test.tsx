// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * ⛔ GREY EVERYWHERE (owner, 2026-11-17: "make sure mobile top navigation is consistent … the black pressed state was replaced
 * by gray all experience should follow across the app cohesive harmonized experience", then "Grey everywhere"; ui/chip-style.ts
 * has the ruling). A picked chip, toggle or preset is the selected grey — `line-strong` under an ink label, its edge gone
 * transparent so nothing moves — never the blue it was here (the brand edge on the accent tint, and Help's feedback toggle's
 * brand-100 glyph wash). A chip that holds a glyph carries `icon-own-ink`, so the pressed-blue `.i-on` rule cannot repaint it.
 * Pinned on: /help's topic chips, its feedback-kind toggles, the Helpful vote, and the discount dialog's presets.
 */

const h = vi.hoisted(() => ({ user: null as null | { id: string }, openSignIn: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/help' }))
vi.mock('next/link', () => ({ default: ({ href, children, prefetch: _p, ...rest }: { href: string; prefetch?: boolean; children?: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: h.user, loading: false, openSignIn: h.openSignIn }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => <>{text}</>,
}))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

import { HelpCenter } from './help-center'
import { HelpFeedback } from './help-feedback'
import { HelpVote } from './help-vote'
import { DISCOUNT_PRESETS, PercentPicker } from './quick-discount'

afterEach(cleanup)

const cls = (el: Element) => el.className.split(/\s+/)
const SELECTED = ['border-transparent', 'bg-line-strong', 'text-foreground']
const BLUE = ['border-brand', 'bg-accent', 'text-accent-foreground']
const expectPicked = (el: Element) => {
  expect(el.getAttribute('aria-pressed')).toBe('true')
  expect(cls(el)).toEqual(expect.arrayContaining(SELECTED))
  for (const c of BLUE) expect(cls(el), c).not.toContain(c)
  expect(el.className).not.toMatch(/fill-brand-100/)
}
const expectResting = (el: Element) => {
  expect(el.getAttribute('aria-pressed')).toBe('false')
  expect(cls(el)).toEqual(expect.arrayContaining(['bg-transparent', 'text-body', 'hover:bg-muted']))
  expect(cls(el)).not.toContain('bg-line-strong')
}

describe('/help topic chips', () => {
  it('"All topics" opens picked in the selected grey; a topic picked takes it over, glyph in its own ink', () => {
    render(<HelpCenter data={{ answers: [], questions: [], reviews: [] }} />)
    const all = screen.getByRole('button', { name: 'All topics' })
    expectPicked(all)
    const topic = screen.getByRole('button', { name: 'Getting started' })
    expectResting(topic)
    expect(cls(topic)).toContain('icon-own-ink')
    fireEvent.click(topic)
    expectPicked(topic)
    expect(cls(topic)).toContain('icon-own-ink')
    expectResting(all)
  })
})

describe('Help feedback — the kind toggles', () => {
  it('the picked kind is the selected grey with no glyph wash; the other rests', () => {
    render(<HelpFeedback />)
    const feedback = screen.getByRole('button', { name: 'Send feedback' })
    const technical = screen.getByRole('button', { name: 'Technical problem' })
    expectPicked(feedback)
    expect(cls(feedback)).toContain('icon-own-ink')
    expect(cls(technical)).toEqual(expect.arrayContaining(['border-border', 'bg-transparent', 'text-body']))
    fireEvent.click(technical)
    expectPicked(technical)
    expect(cls(feedback)).not.toContain('bg-line-strong')
  })
})

describe('Help — the Helpful vote', () => {
  it('voted is the selected grey (the arrow keeps its own user-state mark); not voted rests', () => {
    render(<HelpVote id="p1" kind="post" score={1} viewerVote={1} />)
    const voted = screen.getByRole('button', { name: 'Helpful' })
    expectPicked(voted)
    expect(cls(voted)).toContain('icon-own-ink')
    cleanup()
    render(<HelpVote id="p1" kind="post" score={1} viewerVote={0} />)
    expectResting(screen.getByRole('button', { name: 'Helpful' }))
  })
})

describe('Discount dialog — the presets', () => {
  it('the preset matching the slider is the selected grey; the others keep the hairline', () => {
    render(<PercentPicker pct={DISCOUNT_PRESETS[1]} onPct={() => {}} />)
    const on = screen.getByRole('button', { name: `−${DISCOUNT_PRESETS[1]}%` })
    expect(cls(on)).toEqual(expect.arrayContaining(SELECTED))
    for (const c of BLUE) expect(cls(on), c).not.toContain(c)
    const off = screen.getByRole('button', { name: `−${DISCOUNT_PRESETS[0]}%` })
    expect(cls(off)).toEqual(expect.arrayContaining(['border-border', 'text-foreground', 'hover:bg-muted']))
    expect(cls(off)).not.toContain('bg-line-strong')
  })
})
