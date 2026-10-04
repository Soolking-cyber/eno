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

/** A click event as far as the handlers read one: Clear looks up the field from its own button. */
const CLICK = { currentTarget: { parentElement: null } }

/** Every value the input would emit if the user tapped each of its buttons once, in document order. */
function emissionsFor(typed: string, props: Partial<Parameters<typeof VndInput>[0]> = {}): string[] {
  const emitted: string[] = []
  const tree = VndInput({ value: typed, onChange: (d) => emitted.push(d), ...props })
  const clicks: Array<(e: unknown) => void> = []
  collectClicks(tree, clicks as Array<() => void>)
  for (const click of clicks) click(CLICK)
  return emitted
}

const markup = (typed = '115', props: Partial<Parameters<typeof VndInput>[0]> = {}) =>
  renderToStaticMarkup(createElement(VndInput, { value: typed, onChange: () => {}, ...props }))

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
    // The in-field Clear comes first in document order and emits ''; then 115 → 115.000 /
    // 115.000.000 / 115 tỷ.
    expect(emissionsFor('115')).toEqual(['', '115000', '115000000', '115000000000'])
  })

  it('caps at 999 tỷ so a stray tap cannot mint an absurd price', () => {
    // 5.000.000.000 × 1.000.000.000 would be 5e18; CAP clamps every chip to 999 tỷ.
    const products = emissionsFor('5000000000').filter(Boolean)
    expect(products).toHaveLength(3)
    for (const emitted of products) {
      expect(Number(emitted)).toBeLessThanOrEqual(999_000_000_000)
    }
  })

  it('keeps Clear reachable — inside the field, and only once there is something to clear', () => {
    expect(markup()).toContain('aria-label="Clear price"')
    expect(markup('')).not.toContain('Clear price')
    // It is no longer a chip in the unit row, where it wrapped the row in a narrow column.
    expect(markup()).not.toContain('>Clear</button>')
  })
})

describe('VndInput — the ladder stops where the caller says', () => {
  it('drops tỷ when maxFactor is triệu, and multiplies by the other two exactly', () => {
    const html = markup('115', { maxFactor: 1_000_000 })
    expect(html).not.toContain('×1.000.000.000')
    expect((html.match(/×/g) ?? []).length).toBe(2)
    expect(emissionsFor('115', { maxFactor: 1_000_000 })).toEqual(['', '115000', '115000000'])
  })

  it('keeps the full ladder by default, so mark-sold-sheet is unchanged', () => {
    expect(markup()).toContain('×1.000.000.000</button>')
  })
})

describe('VndInput — the caller can say the amount is required', () => {
  it('passes aria-required through to the inner input', () => {
    expect(markup('', { 'aria-required': true })).toContain('aria-required="true"')
    expect(markup('')).not.toContain('aria-required')
  })
})

describe('VndInput — the field is đồng and says so', () => {
  it('suffixes đ', () => {
    expect(markup()).toContain('>đ</span>')
    // ⚠️ No currency prop, no other symbol: a listing is never composed in anything else.
    expect(markup()).not.toContain('>USD</span>')
    expect(markup()).not.toContain('$')
  })

  it('shows the period INSIDE the field, after the đ, and makes room for it', () => {
    const html = markup('150000', { unit: '/ ngày' })
    expect(html).toMatch(/<span>đ<\/span><span[^>]*>\/ ngày<\/span>/)
    expect(html).toContain('pr-32')
    expect(markup()).toContain('pr-20')
    expect(markup()).not.toContain('/ ')
  })

  it('announces the period: its span joins the field’s aria-describedby', () => {
    const html = markup('150000', { unit: '/ ngày', id: 'pw-price-input' })
    expect(html).toContain('id="pw-price-input-unit"')
    expect(html).toContain('aria-describedby="pw-price-input-unit"')
    // Beside an error id, not instead of it.
    expect(markup('150000', { unit: '/ ngày', id: 'pw-price-input', 'aria-describedby': 'pw-price-error' })).toContain('aria-describedby="pw-price-error pw-price-input-unit"')
    // No period, no extra id: the caller's description is passed through untouched.
    expect(markup('150000', { id: 'pw-price-input', 'aria-describedby': 'pw-price-error' })).toContain('aria-describedby="pw-price-error"')
    expect(markup('150000', { id: 'pw-price-input' })).not.toContain('aria-describedby')
  })

  it('reads the amount out in đồng units', () => {
    expect(markup('12000000')).toContain('= 12 triệu đ')
  })

  it('reserves the readability line when there is no amount, so the chips do not jump', () => {
    expect(markup('')).toContain('text-transparent')
  })
})
