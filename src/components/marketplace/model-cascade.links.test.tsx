// @vitest-environment jsdom
/**
 * The product-line cascade's chips and menu rows are LINKS when the rail can say where they go (owner, 2026-11-07:
 * right-click "Open link in new tab", Cmd/Ctrl and middle click on a chip). A one-model line's chip is an <a href> to
 * that model; a line's menu holds link rows (DropdownMenuLinkItem) for "All <line>" and each model on the desktop popup,
 * and the plain button rows it always had in the phone sheet, where a link row would release the sheet's Back entry.
 * A plain click picks in place; a modified click is the browser's. Without `hrefFor` everything stays a button.
 */
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { __resetBackToCloseForTests } from '@/lib/back-to-close'
import { installDrawerPolyfills, setViewport } from '@/test/drawer-env'
import { ModelCascade } from './model-cascade'

beforeAll(() => installDrawerPolyfills())
afterEach(() => { cleanup(); __resetBackToCloseForTests(); setViewport('desktop') })

const ROWS = [{ model: 'iPhone 15', count: 3 }, { model: 'iPhone 15 Pro', count: 2 }, { model: 'iPad Air', count: 2 }]
const hrefFor = (p: { line?: string; model?: string }) => `/?brand=apple${p.line ? `&line=${p.line}` : ''}${p.model ? `&model=${p.model}` : ''}`

function cascade(over: Partial<React.ComponentProps<typeof ModelCascade>> = {}) {
  const onPick = vi.fn()
  render(
    <LanguageProvider>
      <ModelCascade brandSlug="apple" rows={ROWS} activeLine="" activeModel="all" onPick={onPick} hrefFor={hrefFor} {...over} />
    </LanguageProvider>,
  )
  return { onPick }
}

describe('ModelCascade links', () => {
  it('a one-model line\'s chip is a link to that model; a plain click picks it, a modified click is the browser\'s', () => {
    const { onPick } = cascade()
    const chip = screen.getByRole('link', { name: /iPad Air/ })
    expect(chip.getAttribute('href')).toBe('/?brand=apple&model=iPad Air')
    const cmd = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true })
    chip.dispatchEvent(cmd)
    expect(cmd.defaultPrevented).toBe(false)
    expect(onPick).not.toHaveBeenCalled()
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    chip.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(true)
    expect(onPick).toHaveBeenCalledWith('', 'iPad Air')
  })

  it('the active one-model chip links to the brand alone', () => {
    cascade({ activeModel: 'iPad Air' })
    const chip = screen.getByRole('link', { name: /iPad Air/ })
    expect(chip.getAttribute('href')).toBe('/?brand=apple')
    expect(chip.getAttribute('aria-current')).toBe('true')
  })

  it('desktop: the line menu holds link rows for "All iPhone" and each model; a plain click picks and closes', async () => {
    const user = userEvent.setup()
    const { onPick } = cascade()
    await user.click(screen.getByRole('button', { name: /iPhone/ }))
    const all = await screen.findByRole('menuitem', { name: /All iPhone/ })
    expect(all.tagName).toBe('A')
    expect(all.getAttribute('href')).toBe('/?brand=apple&line=iPhone')
    const pro = screen.getByRole('menuitem', { name: /iPhone 15 Pro/ })
    expect(pro.getAttribute('href')).toBe('/?brand=apple&model=iPhone 15 Pro')
    await user.click(pro)
    expect(onPick).toHaveBeenCalledWith('', 'iPhone 15 Pro')
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: /iPhone 15 Pro/ })).toBeNull())
  })

  it('desktop: a Cmd click on a menu row is the browser\'s and picks nothing', async () => {
    const user = userEvent.setup()
    const { onPick } = cascade()
    await user.click(screen.getByRole('button', { name: /iPhone/ }))
    const row = await screen.findByRole('menuitem', { name: /iPhone 15 Pro/ })
    const cmd = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true })
    row.dispatchEvent(cmd)
    expect(cmd.defaultPrevented).toBe(false)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('phone sheet: the rows are the plain buttons they were (no href), and a tap picks', async () => {
    setViewport('phone')
    const user = userEvent.setup()
    const { onPick } = cascade()
    await user.click(screen.getByRole('button', { name: /iPhone/ }))
    const dialog = await screen.findByRole('dialog')
    const row = [...dialog.querySelectorAll('button')].find((b) => /iPhone 15 Pro/.test(b.textContent || ''))!
    expect(row).toBeTruthy()
    expect(row.hasAttribute('href')).toBe(false)
    expect(dialog.querySelector('a[href*="model="]')).toBeNull()
    await user.click(row)
    expect(onPick).toHaveBeenCalledWith('', 'iPhone 15 Pro')
  })

  it('without hrefFor the chip and rows stay buttons', async () => {
    const user = userEvent.setup()
    cascade({ hrefFor: undefined })
    expect(screen.queryByRole('link', { name: /iPad Air/ })).toBeNull()
    expect(screen.getByRole('button', { name: /iPad Air/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /iPhone/ }))
    const row = await screen.findByRole('menuitem', { name: /iPhone 15 Pro/ })
    expect(row.tagName).toBe('BUTTON')
  })
})
