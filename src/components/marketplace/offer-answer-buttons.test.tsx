// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { LanguageProvider } from '@/context/language-context'
import { OfferAnswerButtons } from './offer-answer-buttons'

/**
 * THE OFFER ANSWER ROW — owner, 2026-09-25: "add clear spacing between the two buttons (≥12px, 44px
 * targets)". jsdom has no layout, so this pins the CLASSES that make the geometry (the same approach as
 * touch-targets.test.tsx): each button's visible box is the 44px target, no invisible tap-44 reach,
 * and one 12px gap on both axes. Plus the Counter gate, which is money.
 *
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 */
afterEach(cleanup)

const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)
const renderRow = (props: Partial<React.ComponentProps<typeof OfferAnswerButtons>> = {}) => {
  const p = { onAccept: vi.fn(), onDecline: vi.fn(), onCounter: vi.fn(), canCounter: true, ...props }
  render(<LanguageProvider><OfferAnswerButtons {...p} /></LanguageProvider>)
  return p
}

describe('geometry: 44px targets, 12px apart', () => {
  it('every button is DRAWN 44px tall and carries no tap-44 reach (what the finger sees is what it hits)', () => {
    renderRow()
    for (const name of ['Accept', 'Decline', 'Counter']) {
      const t = tokens(screen.getByRole('button', { name }))
      expect(t).toContain('min-h-11')
      expect(t).not.toContain('tap-44')
    }
  })

  it('the row keeps 12px between targets on both axes, including where it wraps at 320px', () => {
    renderRow()
    const row = screen.getByRole('button', { name: 'Accept' }).parentElement!
    const t = tokens(row)
    expect(t).toContain('flex-wrap')
    expect(t).toContain('gap-3')
    // The old split gap (8px across, 20px down) existed only to keep invisible reaches apart.
    expect(t.some((c) => /^gap-[xy]-/.test(c))).toBe(false)
  })
})

describe('behaviour', () => {
  it('each button calls its own handler, once', () => {
    const p = renderRow()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Counter' }))
    expect(p.onAccept).toHaveBeenCalledTimes(1)
    expect(p.onDecline).toHaveBeenCalledTimes(1)
    expect(p.onCounter).toHaveBeenCalledTimes(1)
  })

  it('⛔ Counter does not exist when the caller says the listing is not negotiable (a counter SENDS an offer: 409 + trust penalty)', () => {
    renderRow({ canCounter: false })
    expect(screen.queryByRole('button', { name: 'Counter' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy()
  })
})
