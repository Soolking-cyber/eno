// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CurrencyProvider } from '@/context/currency-context'
import { LanguageProvider } from '@/context/language-context'
import { AreaFilter, type Geo } from './area-filter'
import { CustomSelect } from './custom-select'
import { CookieConsent } from './cookie-consent'
import { DISTRICTS_PROVINCE_CODE } from './listings-explorer.constants'

/**
 * OVERLAY MOTION ON THE FILTER SURFACES — one system: grow from the trigger, enter in 100ms, leave in
 * 75ms, both on the strong ease-out; the scrim leaves WITH its popup; the Area panel's main action
 * never scrolls out of the panel.
 *
 * jsdom runs no animations (it has no `getAnimations`, so Base UI unmounts at once), so this pins the
 * classes that declare the motion. The timings themselves were measured in a real browser before this
 * was written: Area panel popup and scrim both at 0 within ~75ms of a backdrop tap; 'Any type' enters
 * in 100ms from `--transform-origin` and exits in 75ms on cubic-bezier(0.23,1,0.32,1); the consent
 * card 150ms in / 100ms out.
 *
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 */
afterEach(cleanup)

const HCM: Geo = { code: DISTRICTS_PROVINCE_CODE, name: 'Hồ Chí Minh', nameEn: 'Ho Chi Minh' }
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const body = String(url).includes('type=provinces') ? { provinces: [HCM] } : {}
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as unknown as Response)
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)
/** Both halves of the ui/popover recipe, on the strong ease-out. */
const POPOVER_RECIPE = [
  'origin-(--transform-origin)', 'duration-100', 'ease-[var(--ease-out-strong)]',
  'data-open:animate-in', 'data-open:fade-in-0', 'data-open:zoom-in-95',
  'data-closed:animate-out', 'data-closed:fade-out-0', 'data-closed:zoom-out-95', 'data-closed:duration-75',
]
const SCRIM_EXIT = '[--scrim-exit:75ms_var(--ease-out-strong)]'

function wrap(ui: React.ReactNode) {
  return render(<LanguageProvider><CurrencyProvider>{ui}</CurrencyProvider></LanguageProvider>)
}

describe('Area panel', () => {
  function openPanel() {
    wrap(<AreaFilter open onClose={vi.fn()} province={null} ward={null} nearby={null} onApply={vi.fn()} onReset={vi.fn()} district="all" onPickDistrict={vi.fn()} />)
    return screen.findByRole('dialog', { name: 'Choose area' })
  }

  it('animates BOTH ways from the trigger (it had only a centred fade-in, and hard-cut on close)', async () => {
    const panel = await openPanel()
    expect(tokens(panel)).toEqual(expect.arrayContaining(POPOVER_RECIPE))
    expect(tokens(panel)).not.toContain('duration-150')
  })

  it('the scrim fades both ways off Base UI\'s styles (no keyframe enter) and leaves with the 75ms popup', async () => {
    await openPanel()
    const scrim = document.querySelector('.overlay-scrim')!
    expect(scrim).not.toBeNull()
    expect(tokens(scrim)).not.toContain('animate-in')
    expect(tokens(scrim)).toContain(SCRIM_EXIT)
  })

  it('Apply sits in a sticky, opaque action row at the panel\'s bottom edge (it was 274px below it)', async () => {
    const panel = await openPanel()
    const apply = within(panel).getByRole('button', { name: /Apply/ })
    const row = apply.parentElement!
    expect(tokens(row)).toEqual(expect.arrayContaining(['sticky', 'bottom-0', 'bg-popover', 'border-t']))
    // The row carries the bottom padding — the popup has none — so the sticky row sits FLUSH with the
    // panel edge instead of 16px above it with content scrolling through the gap.
    expect(tokens(panel)).not.toContain('p-4')
    expect(tokens(panel)).toEqual(expect.arrayContaining(['px-4', 'pt-4']))
    expect(tokens(row)).not.toContain('-mb-4')
  })

  it('district chips are py-2 (they were 34px)', async () => {
    const panel = await openPanel()
    const group = await within(panel).findByRole('group', { name: /District/ })
    const chips = within(group).getAllByRole('button')
    expect(chips.length).toBeGreaterThan(3)
    for (const c of chips) expect(tokens(c)).toContain('py-2')
  })
})

describe('filter selects (CustomSelect)', () => {
  const OPTS = [
    { value: 'all', label: 'Any type' },
    { value: 'sell', label: 'For sale' },
    { value: 'free', label: 'Free' },
  ]

  it('the plain select popup carries both halves of the recipe, and its scrim leaves with it', async () => {
    const user = userEvent.setup()
    wrap(<CustomSelect value="all" onChange={vi.fn()} options={OPTS} label="Type" placeholder="Any type" searchable={false} />)
    await user.click(screen.getByRole('combobox'))
    const list = await screen.findByRole('listbox')
    // The listbox's popup is the element carrying the motion (the list is inside it).
    const popup = list.closest('[class*="origin-(--transform-origin)"]')
    expect(popup).not.toBeNull()
    expect(tokens(popup!)).toEqual(expect.arrayContaining(POPOVER_RECIPE))
    expect(tokens(popup!)).not.toContain('duration-150')
    expect(tokens(document.querySelector('.overlay-scrim')!)).toContain(SCRIM_EXIT)
  })

  // "Typing on a CLOSED select still changes its value" is checked in a real browser, not here:
  // Base UI's closed-trigger typeahead does not fire under jsdom even on the untouched component.

  it('the searchable popup carries both halves too', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 8 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` }))
    wrap(<CustomSelect value="v0" onChange={vi.fn()} options={many} label="Ward" placeholder="Pick" searchable />)
    await user.click(screen.getByRole('combobox'))
    const list = await screen.findByRole('listbox')
    const popup = list.closest('[class*="origin-(--transform-origin)"]')
    expect(popup).not.toBeNull()
    expect(tokens(popup!)).toEqual(expect.arrayContaining(POPOVER_RECIPE))
  })
})

describe('cookie consent card', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    const m = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, String(v)) },
      removeItem: (k: string) => { m.delete(k) },
      clear: () => m.clear(),
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() { return m.size },
    })
  })
  afterEach(() => { vi.useRealTimers() })

  it('enters in 150ms and leaves in 100ms on the strong ease-out (was a symmetric 200ms `ease`)', async () => {
    render(<LanguageProvider><CookieConsent /></LanguageProvider>)
    await act(async () => { vi.advanceTimersByTime(5_000) })
    const card = document.querySelector('.shadow-overlay.max-w-md')
    expect(card).not.toBeNull()
    expect(tokens(card!)).toEqual(expect.arrayContaining(['duration-150', 'ease-[var(--ease-out-strong)]', 'data-closed:duration-100', 'data-closed:animate-out']))
    expect(tokens(card!)).not.toContain('duration-200')
  })
})
