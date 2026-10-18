// @vitest-environment jsdom
/**
 * CustomSelect AT BOTH WIDTHS (owner, 2026-10-18: "also mobile all dropdowns should be bottom up card style like the
 * filter card"). From `sm` up it is the anchored popover it always was; below `sm` (useIsPhone's real gate, answered
 * through a matchMedia stub — src/test/drawer-env.ts) the same trigger opens a bottom sheet with the same listbox in it.
 *
 * What is defended:
 *  · ONE TRIGGER. The trigger is the same element on both widths (no swap after hydration), with the same name.
 *  · THE SHEET IS THE FILTER CARD: a named dialog in a ui/drawer popup, options as role="option" with aria-selected,
 *    a check on the current row, the search field on top of a long list.
 *  · A PICK commits once, closes the sheet, and hands focus back to the trigger; re-picking the current row only closes.
 *  · KEYBOARD: an arrow key on the trigger opens the sheet with focus in the list; arrows move the active option and
 *    Enter picks.
 *  · BACK closes it (one history entry while open, none left after a dismiss).
 *
 * ⚠️ EXPLICIT `cleanup` — this suite runs without vitest globals.
 */
import { useState } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, configure, fireEvent, getConfig, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { __resetBackToCloseForTests, overlayMarkOf } from '@/lib/back-to-close'
import { installDrawerPolyfills, setViewport } from '@/test/drawer-env'
import { CustomSelect, type SelectOption } from './custom-select'

const asyncUtilTimeout = getConfig().asyncUtilTimeout
beforeAll(() => {
  installDrawerPolyfills()
  configure({ asyncUtilTimeout: 5_000 })
})
afterAll(() => { configure({ asyncUtilTimeout }) })
afterEach(() => {
  cleanup()
  __resetBackToCloseForTests()
  setViewport('desktop')
})

const TYPES: SelectOption[] = [
  { value: 'all', label: 'Any type' },
  { value: 'sell', label: 'For sale' },
  { value: 'free', label: 'Free' },
]
const WARDS: SelectOption[] = [
  { value: 'all', label: 'All' },
  { value: 'q1', label: 'Quận 1', count: '12' },
  { value: 'q3', label: 'Quận 3', count: '4' },
  { value: 'q7', label: 'Quận 7', count: '1' },
  { value: 'bt', label: 'Bình Thạnh', count: '2' },
  { value: 'td', label: 'Thủ Đức', count: '9' },
]

function Host({ options, initial = 'all', onChange, searchable }: { options: SelectOption[]; initial?: string; onChange: (v: string) => void; searchable?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <LanguageProvider>
      <CustomSelect
        value={value}
        onChange={(v) => { onChange(v); setValue(v) }}
        options={options}
        label="Listing type"
        placeholder="Type"
        searchable={searchable}
      />
    </LanguageProvider>
  )
}

// `hidden: true`: behind an open sheet the page is inert (aria-hidden), and the trigger is still the same element.
const trigger = () => screen.getByRole('combobox', { name: /Listing type/, hidden: true })

describe.each(['desktop', 'phone'] as const)('CustomSelect · %s', (mode) => {
  beforeEach(() => { setViewport(mode) })

  it('the trigger is named by its label AND its value, and opens a listbox with the current option selected', async () => {
    render(<Host options={TYPES} initial="sell" onChange={vi.fn()} />)
    expect(trigger()).toHaveProperty('textContent', expect.stringContaining('For sale'))
    await userEvent.setup().click(trigger())
    const list = await screen.findByRole('listbox')
    expect(within(list).getByRole('option', { name: 'For sale' }).getAttribute('aria-selected')).toBe('true')
    expect(within(list).getByRole('option', { name: 'Free' }).getAttribute('aria-selected')).toBe('false')
  })

  it('a pick commits once and closes the list', async () => {
    const onChange = vi.fn()
    render(<Host options={TYPES} onChange={onChange} />)
    const user = userEvent.setup()
    await user.click(trigger())
    await user.click(await screen.findByRole('option', { name: 'Free' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(onChange).toHaveBeenCalledWith('free')
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Free' })).toBeNull())
    expect(trigger().textContent).toContain('Free')
  })

  it('a long list is searchable: accents optional, counts never matched', async () => {
    render(<Host options={WARDS} onChange={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(trigger())
    const input = await screen.findByPlaceholderText('Search')
    await user.type(input, 'quan 7')
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Quận 7 · 1']))
    await user.clear(input)
    await user.type(input, '1')
    // "1" finds District 1 by its NAME — never Quận 7, whose COUNT is 1.
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Quận 1 · 12']))
  })
})

describe('CustomSelect · hydration', () => {
  it('the server HTML is the same for a phone and a desktop, and a phone hydrates it without a mismatch', async () => {
    // The server cannot know the viewport (useIsPhone's server snapshot is false): the trigger must not depend on it.
    setViewport('desktop')
    const desktopHtml = renderToString(<Host options={TYPES} initial="sell" onChange={vi.fn()} />)
    setViewport('phone')
    const phoneHtml = renderToString(<Host options={TYPES} initial="sell" onChange={vi.fn()} />)
    expect(phoneHtml).toBe(desktopHtml)

    const container = document.createElement('div')
    container.innerHTML = phoneHtml
    document.body.appendChild(container)
    const recoverable = vi.fn()
    const root = await act(async () => hydrateRoot(container, <Host options={TYPES} initial="sell" onChange={vi.fn()} />, { onRecoverableError: recoverable }))
    expect(recoverable).not.toHaveBeenCalled()
    // …and once hydrated on a phone, the same trigger opens the sheet.
    await userEvent.setup().click(within(container).getByRole('combobox', { name: /Listing type/ }))
    expect(await screen.findByRole('dialog', { name: 'Listing type' })).toBeTruthy()
    act(() => root.unmount())
    container.remove()
  })
})

describe('CustomSelect · phone sheet', () => {
  beforeEach(() => { setViewport('phone') })

  it('opens the filter card: a named dialog in a drawer popup, rows with a check on the current one', async () => {
    render(<Host options={TYPES} initial="sell" onChange={vi.fn()} />)
    const before = trigger()
    await userEvent.setup().click(before)
    const dialog = await screen.findByRole('dialog', { name: 'Listing type' })
    expect(dialog.closest('[data-slot="drawer-popup"]') ?? dialog.matches('[data-slot="drawer-popup"]')).toBeTruthy()
    // The ✕ of the filter card's header row.
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy()
    const current = within(dialog).getByRole('option', { name: 'For sale' })
    expect(current.querySelector('svg')).not.toBeNull()
    expect(within(dialog).getByRole('option', { name: 'Free' }).querySelector('svg')).toBeNull()
    // Rows are the 48px box; the trigger stayed the same element (no swap) and says it is expanded.
    expect(current.className).toContain('min-h-12')
    expect(trigger()).toBe(before)
    expect(before.getAttribute('aria-expanded')).toBe('true')
    // No anchored popup was opened behind the sheet: the sheet's listbox is the only one in the tree.
    expect(screen.getAllByRole('listbox', { hidden: false })).toHaveLength(1)
  })

  it('a pick hands focus back to the trigger; re-picking the current row only closes', async () => {
    const onChange = vi.fn()
    render(<Host options={TYPES} initial="sell" onChange={onChange} />)
    const user = userEvent.setup()
    await user.click(trigger())
    await user.click(await screen.findByRole('option', { name: 'For sale' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onChange).not.toHaveBeenCalled()
    await user.click(trigger())
    await user.click(await screen.findByRole('option', { name: 'Free' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('free'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger()))
  })

  it('a long list puts the search field at the top, outside the scrolling list', async () => {
    render(<Host options={WARDS} onChange={vi.fn()} />)
    await userEvent.setup().click(trigger())
    const dialog = await screen.findByRole('dialog', { name: 'Listing type' })
    const input = within(dialog).getByPlaceholderText('Search')
    const body = dialog.querySelector('[data-slot="picker-sheet-body"]')!
    expect(body.contains(input)).toBe(false)
    expect(body.contains(within(dialog).getByRole('listbox'))).toBe(true)
  })

  it('keyboard: ArrowDown on the trigger opens it with focus in the list; arrows move, Enter picks', async () => {
    const onChange = vi.fn()
    render(<Host options={TYPES} onChange={onChange} />)
    trigger().focus()
    const user = userEvent.setup()
    await user.keyboard('{ArrowDown}')
    const list = await screen.findByRole('listbox')
    await waitFor(() => expect(document.activeElement).toBe(list))
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(list.getAttribute('aria-activedescendant')).toBeTruthy())
    const active = () => document.getElementById(list.getAttribute('aria-activedescendant')!)
    // Walk to "Free" whatever row the cursor started on, then commit it.
    for (let i = 0; i < 3 && active()?.textContent !== 'Free'; i++) await user.keyboard('{ArrowDown}')
    expect(active()?.textContent).toBe('Free')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('free'))
  })

  it('Escape closes it without a pick', async () => {
    const onChange = vi.fn()
    render(<Host options={TYPES} onChange={onChange} />)
    await userEvent.setup().click(trigger())
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Back closes the sheet: it owns one history entry while open, and a dismissed sheet leaves none behind', async () => {
    render(<Host options={TYPES} onChange={vi.fn()} />)
    const user = userEvent.setup()
    // jsdom keeps one history across this file, so an earlier test's (released) mark can sit below ours: compare keys.
    const mark = () => overlayMarkOf(window.history.state)?.key
    await user.click(trigger())
    await screen.findByRole('dialog')
    await waitFor(() => expect(mark()).toBeTruthy())
    const first = mark()
    await act(async () => { window.history.back() })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mark()).not.toBe(first)
    // Opened and dismissed (✕): the entry it pushed is popped again.
    const below = mark()
    await user.click(trigger())
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(mark()).not.toBe(below))
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(mark()).toBe(below))
  })
})
