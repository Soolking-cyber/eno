import { describe, it, expect, vi } from 'vitest'

// The component's ONLY hook. Stubbed so the input can be rendered (and called) outside a
// React tree; 'vi' is the home-market locale, where the ladder reads "×1.000".
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'vi', tr: (en: string) => en }),
}))

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { VndInput } from './vnd-input'

/**
 * THE MONEY-SAFETY CONTRACT OF <VndInput>.
 *
 * ×1.000 / ×1.000.000 / ×1.000.000.000 are the VIETNAMESE unit ladder (nghìn → triệu →
 * tỷ). They exist because a đồng price is typed in units. On the e-Visa storefront, whose
 * listings are stored and charged in whole US dollars (listingMoneyFor → '$' /
 * sellablePriceCents), the same three buttons are a live money bug: one tap on a $115
 * e-visa mints a buyable $115,000 product. This file is the regression fence — it asserts
 * both that the ladder is THERE for ₫ (removing it would wreck every ordinary listing) and
 * that it CANNOT BE REACHED for USD.
 *
 * SSR markup + a direct call of the component are enough: <VndInput> takes no state and
 * uses no hook but the mocked one, so its rendered tree IS its behaviour.
 */

/** Every onClick handler in a rendered element tree, in document order. */
function collectClicks(node: unknown, out: Array<() => void>): void {
  if (Array.isArray(node)) {
    for (const child of node) collectClicks(child, out)
    return
  }
  if (!node || typeof node !== 'object') return
  const props = (node as { props?: Record<string, unknown> }).props
  if (!props) return
  if (typeof props.onClick === 'function') out.push(props.onClick as () => void)
  collectClicks(props.children, out)
}

/** Every value the input would emit if the user tapped each of its chips once. */
function emissionsFor(currency: 'VND' | 'USD', typed: string): string[] {
  const emitted: string[] = []
  const tree = VndInput({ value: typed, onChange: (d) => emitted.push(d), currency })
  const clicks: Array<() => void> = []
  collectClicks(tree, clicks)
  for (const click of clicks) click()
  return emitted
}

const markup = (currency: 'VND' | 'USD', typed = '115') =>
  renderToStaticMarkup(createElement(VndInput, { value: typed, onChange: () => {}, currency }))

describe('VndInput — the ×unit ladder is ₫-only', () => {
  it('renders all three multiplier chips for VND', () => {
    const html = markup('VND')
    expect(html).toContain('×1.000</button>')
    expect(html).toContain('×1.000.000</button>')
    expect(html).toContain('×1.000.000.000</button>')
    // Exactly three: the ladder and nothing else carries a ×.
    expect((html.match(/×/g) ?? []).length).toBe(3)
  })

  it('renders NO multiplier chip for USD', () => {
    const html = markup('USD')
    expect(html).not.toContain('×')
    expect(html).not.toContain('1.000.000')
  })

  it('keeps the currency-agnostic chips for USD (only the ladder goes)', () => {
    // Clear still has to be reachable — this is a suppression of the VN units, not of
    // the whole chip row.
    expect(markup('USD')).toContain('Clear')
  })

  it('multiplies the typed amount for VND — the behaviour the ladder exists for', () => {
    // 115 → 115.000 / 115.000.000 / 115 tỷ, plus the Clear chip's ''.
    expect(emissionsFor('VND', '115')).toEqual(['115000', '115000000', '115000000000', ''])
  })

  it('has NO chip that can inflate a USD amount', () => {
    const emitted = emissionsFor('USD', '115')
    // Clear ('') only. Nothing a tap can do makes $115 into $115,000.
    expect(emitted).toEqual([''])
    for (const value of emitted) expect(Number(value || '0')).toBeLessThanOrEqual(115)
  })
})

describe('VndInput — suffix and readability line follow the stored currency', () => {
  it('suffixes VND and reads the amount out in đồng units', () => {
    const html = markup('VND', '12000000')
    expect(html).toContain('>VND</span>')
    expect(html).toContain('= 12 triệu VND')
  })

  it('suffixes USD and shows no đồng reading', () => {
    const html = markup('USD')
    expect(html).toContain('>USD</span>')
    expect(html).not.toContain('VND')
    expect(html).not.toContain('triệu')
    // The line is still reserved (so the layout does not jump) but says nothing.
    expect(html).toContain('text-transparent')
  })

  it('defaults to VND, so every existing call site is untouched', () => {
    const withoutProp = renderToStaticMarkup(createElement(VndInput, { value: '115', onChange: () => {} }))
    expect(withoutProp).toBe(markup('VND'))
  })
})
