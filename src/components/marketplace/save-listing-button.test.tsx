// @vitest-environment jsdom
/**
 * The PDP save control is an ARIA TOGGLE in BOTH variants: a constant name ("Save listing") and
 * `aria-pressed` carrying the state. The labelled (non-compact) variant used to flip its name
 * Save/Saved; it had no call sites until the compact linked-job header (O-28) rendered it, and the
 * guest e2e "the save heart is a real ARIA toggle" went red on every job PDP. Pinned here so the
 * name cannot drift back without a unit test noticing — the e2e only sees it after a rebuild.
 */
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/ui/icons', () => ({ Heart: (props: React.SVGProps<SVGSVGElement>) => <svg {...props} /> }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
}))
// A real toggle behind the mock, so pressing it actually changes `isFavorite`.
vi.mock('@/context/favorites-context', () => ({
  useFavorites: () => {
    const [ids, setIds] = useState<Set<string>>(new Set())
    return {
      isFavorite: (id: string) => ids.has(id),
      toggle: (id: string) => setIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }),
    }
  },
}))

import { SaveListingButton } from './save-listing-button'

afterEach(cleanup)

describe('SaveListingButton — a constant-name ARIA toggle', () => {
  for (const compact of [false, true]) {
    it(`${compact ? 'compact' : 'labelled'}: name stays "Save listing" while aria-pressed flips`, () => {
      render(<SaveListingButton id="l1" compact={compact} />)
      const btn = screen.getByRole('button', { name: 'Save listing' })
      expect(btn.getAttribute('aria-pressed')).toBe('false')
      fireEvent.click(btn)
      expect(btn.getAttribute('aria-pressed')).toBe('true')
      expect(btn.getAttribute('aria-label')).toBe('Save listing')
    })
  }

  it('labelled: the visible word is contained in the name in both states (WCAG 2.5.3)', () => {
    render(<SaveListingButton id="l1" />)
    const btn = screen.getByRole('button', { name: 'Save listing' })
    const visible = () => btn.textContent!.trim()
    expect(btn.getAttribute('aria-label')).toContain(visible())
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-label')).toContain(visible())
  })
})
