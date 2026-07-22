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
 * ⚠️ THIS FIELD IS ĐỒNG, ALWAYS — every listing on eno is stored in ₫ (listingMoneyFor
 * in @/lib/taxonomy), so there is no currency to switch and this component must never
 * grow one. A short-lived rule stored e-Visa products in '$' and made the input
 * currency-aware to survive it (f7f8ca40); the owner's answer is that the admin prices
 * in VND like every other seller, and the USD a foreign buyer pays is a server-issued
 * conversion at checkout — never a compose-time currency. So what is asserted here is
 * the ₫ behaviour, in full:
 *
 * ×1.000 / ×1.000.000 / ×1.000.000.000 are the VIETNAMESE unit ladder (nghìn → triệu →
 * tỷ). They exist because a đồng price is typed in units, and they are the fastest way
 * to mistype a price by 1000× if they ever multiply by the wrong factor — so both their
 * presence and their exact arithmetic are fenced.
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
function emissionsFor(typed: string): string[] {
  const emitted: string[] = []
  const tree = VndInput({ value: typed, onChange: (d) => emitted.push(d) })
  const clicks: Array<() => void> = []
  collectClicks(tree, clicks)
  for (const click of clicks) click()
  return emitted
}

const markup = (typed = '115') =>
  renderToStaticMarkup(createElement(VndInput, { value: typed, onChange: () => {} }))

describe('VndInput — the ₫ unit ladder', () => {
  it('renders all three multiplier chips', () => {
    const html = markup()
    expect(html).toContain('×1.000</button>')
    expect(html).toContain('×1.000.000</button>')
    expect(html).toContain('×1.000.000.000</button>')
    // Exactly three: the ladder and nothing else carries a ×.
    expect((html.match(/×/g) ?? []).length).toBe(3)
  })

  it('multiplies the typed amount by exactly nghìn / triệu / tỷ', () => {
    // 115 → 115.000 / 115.000.000 / 115 tỷ, plus the Clear chip's ''.
    expect(emissionsFor('115')).toEqual(['115000', '115000000', '115000000000', ''])
  })

  it('caps at 999 tỷ so a stray tap cannot mint an absurd price', () => {
    // 5.000.000.000 × 1.000.000.000 would be 5e18; CAP clamps every chip to 999 tỷ.
    for (const emitted of emissionsFor('5000000000').slice(0, 3)) {
      expect(Number(emitted)).toBeLessThanOrEqual(999_000_000_000)
    }
  })

  it('keeps Clear reachable', () => {
    expect(markup()).toContain('Clear')
  })
})

describe('VndInput — the field is đồng and says so', () => {
  it('suffixes VND', () => {
    expect(markup()).toContain('>VND</span>')
    // ⚠️ No currency prop, no other symbol: a listing is never composed in anything else.
    expect(markup()).not.toContain('>USD</span>')
    expect(markup()).not.toContain('$')
  })

  it('reads the amount out in đồng units', () => {
    expect(markup('12000000')).toContain('= 12 triệu VND')
  })

  it('reserves the readability line when there is no amount, so the chips do not jump', () => {
    expect(markup('')).toContain('text-transparent')
  })
})
