// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

/**
 * The toast CSS (globals.css, guarded against sonner's own stylesheet by sonner.styles.test.ts) is keyed on
 * attributes sonner RENDERS — and a stylesheet test cannot see the DOM. If a sonner upgrade renamed one
 * (older versions emitted `data-theme`, not `data-sonner-theme`), the rule would out-rank nothing and match
 * nothing, and that test would stay green. This mounts the real Toaster and reads them back.
 */

vi.mock('@/context/theme-context', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ tr: (en: string) => en }) }))
const { Toaster } = await import('./sonner')

afterEach(() => { act(() => { toast.dismiss() }); cleanup() })

/** Mounts the Toaster, raises one toast and returns ITS card — found by its title, never "the first card":
 *  sonner's store is global, so a toast from an earlier test can still be on its way out. */
async function show(title: string, fire: () => void) {
  render(<Toaster />)
  await act(async () => { fire(); await new Promise((r) => setTimeout(r, 0)) })
  const toaster = document.querySelector('[data-sonner-toaster]')
  const card = [...document.querySelectorAll('[data-sonner-toaster] [data-sonner-toast][data-styled="true"]')]
    .find((c) => c.querySelector('[data-title]')?.textContent === title) ?? null
  return { toaster, card }
}

describe('ui/sonner — the attributes the toast CSS is keyed on', () => {
  it('the toaster carries data-sonner-theme (the font rule), the card data-styled="true" (the card rule)', async () => {
    const { toaster, card } = await show('Saved', () => toast('Saved'))
    expect(toaster?.getAttribute('data-sonner-theme')).toBe('light')
    expect(card).not.toBeNull()
    expect(card!.querySelector('[data-content] [data-title]')?.textContent).toBe('Saved')
    expect(card!.querySelector('[data-description]')).toBeNull() // a one-sentence toast: no heading, so 400
  })

  it('a title over a description sits in the same [data-content] (the heading rule), and the close button is [data-close-button]', async () => {
    const { card } = await show('Offer accepted', () => toast('Offer accepted', { description: '12.000.000 ₫', closeButton: true }))
    const content = card!.querySelector('[data-content]')!
    expect(content.querySelector('[data-title]')?.textContent).toBe('Offer accepted')
    expect(content.querySelector('[data-description]')?.textContent).toBe('12.000.000 ₫')
    expect(card!.querySelector('[data-close-button]')).not.toBeNull()
  })

  it('a { label, onClick } action is [data-button] and carries the 44px reach (relative + tap-44)', async () => {
    const { card } = await show('Your identity is not verified yet.', () => toast('Your identity is not verified yet.', { action: { label: 'Verify', onClick: () => {} } }))
    const action = card!.querySelector('[data-button]')
    expect(action?.textContent).toBe('Verify')
    expect(action?.className.split(/\s+/)).toEqual(expect.arrayContaining(['relative', 'tap-44']))
  })
})
