// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

import { PartnerBuyButton } from './partner-buy-button'

afterEach(() => cleanup())

// Owner 2026-11-23: "the link non suspicious looking official looking … or just click here to buy".
describe('PartnerBuyButton', () => {
  it('a "Buy now" button whose href is the link — the URL is never shown as text; new tab, a paid link', () => {
    const BUY = 'https://go.isclix.com/deep_link/7053736680188167797/6800497735607325103?url=https%3A%2F%2Fshopdunk.com%2Fx'
    const { container } = render(<PartnerBuyButton href={BUY} />)
    const a = screen.getByRole('link', { name: /Buy now/ })
    expect(a.getAttribute('href')).toBe(BUY)
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toMatch(/noopener/)
    expect(a.getAttribute('rel')).toMatch(/sponsored/)
    expect(a.getAttribute('rel')).toMatch(/nofollow/)
    expect(container.textContent).not.toMatch(/isclix|https?:/)
  })
})
