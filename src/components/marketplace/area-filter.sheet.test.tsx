// @vitest-environment jsdom
/**
 * THE AREA PANEL ON A PHONE IS THE FILTER CARD IN BOTH MODES (owner, 2026-10-18: "also mobile all dropdowns should be
 * bottom up card style like the filter card"). The post wizard's location picker (`mode: 'pick'`) stayed an anchored
 * popover on phones until then; now it is the same bottom sheet as the explorer's Area panel, and the Province / Ward
 * fields inside open their own sheets over it (CustomSelect's phone sheet, a nested drawer).
 * Desktop is untouched: both modes keep the anchored popover ("Choose area").
 *
 * ⚠️ Harness as area-filter.district.test.tsx: explicit cleanup, fetch stubbed (/api/geo answers on open). The phone
 * is useIsPhone's real gate answered through a matchMedia stub (src/test/drawer-env.ts).
 */
import * as React from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, configure, getConfig, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CurrencyProvider } from '@/context/currency-context'
import { LanguageProvider } from '@/context/language-context'
import { __resetBackToCloseForTests, overlayMarkOf } from '@/lib/back-to-close'
import { installDrawerPolyfills, setViewport } from '@/test/drawer-env'
import { AreaFilter, type Geo } from './area-filter'
import { DISTRICTS_PROVINCE_CODE } from './listings-explorer.constants'

/** The wizard's trigger, held in a constant for the i18n lint. */
const SET_AREA = 'Set area'
const HCM: Geo = { code: DISTRICTS_PROVINCE_CODE, name: 'Hồ Chí Minh', nameEn: 'Ho Chi Minh' }
const HN: Geo = { code: '01', name: 'Hà Nội', nameEn: 'Ha Noi' }

const asyncUtilTimeout = getConfig().asyncUtilTimeout
beforeAll(() => { installDrawerPolyfills(); configure({ asyncUtilTimeout: 5_000 }) })
afterAll(() => { configure({ asyncUtilTimeout }) })
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const body = String(url).includes('type=provinces') ? { provinces: [HCM, HN] } : String(url).includes('type=wards') ? { wards: [] } : {}
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as unknown as Response)
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  __resetBackToCloseForTests()
  setViewport('desktop')
})

function Wizard({ mode }: { mode: 'pick' | 'search' }) {
  const [open, setOpen] = React.useState(false)
  const anchor = React.useRef<HTMLButtonElement>(null)
  const [picked, setPicked] = React.useState<string>('')
  return (
    <LanguageProvider>
      <CurrencyProvider>
        <button ref={anchor} type="button" onClick={() => setOpen(true)}>{SET_AREA}</button>
        <output>{picked}</output>
        <AreaFilter
          mode={mode}
          hideLocate={mode === 'pick'}
          open={open}
          anchorRef={anchor}
          onClose={() => setOpen(false)}
          province={null}
          ward={null}
          nearby={null}
          onApply={({ province }) => setPicked(province?.nameEn ?? '')}
          onReset={() => setPicked('')}
        />
      </CurrencyProvider>
    </LanguageProvider>
  )
}

describe('Area panel · phone', () => {
  beforeEach(() => { setViewport('phone') })

  it("the post wizard's picker is the filter card: a sheet named Location, ending on Clear / Apply", async () => {
    render(<Wizard mode="pick" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Set area' }))
    const sheet = await screen.findByRole('dialog', { name: 'Location' })
    expect(sheet.closest('[data-slot="drawer-popup"]') ?? (sheet.matches('[data-slot="drawer-popup"]') ? sheet : null)).not.toBeNull()
    expect(within(sheet).getByRole('button', { name: 'Clear' })).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: /Apply/ })).toBeTruthy()
    // The anchored popover's name is not on screen: the sheet REPLACED it.
    expect(screen.queryByRole('dialog', { name: 'Choose area' })).toBeNull()
  })

  it('the explorer keeps its sheet, named Area', async () => {
    render(<Wizard mode="search" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Set area' }))
    expect(await screen.findByRole('dialog', { name: 'Area' })).toBeTruthy()
  })

  it('Province opens a sheet of its own over the Area sheet; a pick closes only that one', async () => {
    render(<Wizard mode="pick" />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Set area' }))
    const sheet = await screen.findByRole('dialog', { name: 'Location' })
    const province = await within(sheet).findByRole('combobox', { name: /Province \/ City/ })
    await waitFor(() => expect(province.textContent).toContain('Ho Chi Minh'))
    await user.click(province)
    const nested = await screen.findByRole('dialog', { name: 'Province / City' })
    await user.click(within(nested).getByRole('option', { name: 'Ha Noi' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Province / City' })).toBeNull())
    // The Area sheet is still open, and its field shows the pick.
    const still = screen.getByRole('dialog', { name: 'Location' })
    await waitFor(() => expect(within(still).getByRole('combobox', { name: /Province \/ City/, hidden: true }).textContent).toContain('Ha Noi'))
    await user.click(within(still).getByRole('button', { name: /Apply/ }))
    await waitFor(() => expect(document.querySelector('output')?.textContent).toBe('Ha Noi'))
  })

  it('nested: focus comes back to the field in the Area sheet, and Back closes only the top sheet', async () => {
    render(<Wizard mode="pick" />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: SET_AREA }))
    const sheet = await screen.findByRole('dialog', { name: 'Location' })
    const province = await within(sheet).findByRole('combobox', { name: /Province \/ City/ })
    await waitFor(() => expect(province.textContent).toContain('Ho Chi Minh'))
    // Back with the Province sheet over the Area sheet: only the Province sheet goes.
    await user.click(province)
    await screen.findByRole('dialog', { name: 'Province / City' })
    await waitFor(() => expect(overlayMarkOf(window.history.state)?.id).toBe('picker'))
    await act(async () => { window.history.back() })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Province / City' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Location' })).toBeTruthy()
    expect(overlayMarkOf(window.history.state)?.id).toBe('location')
    // A pick in the Province sheet hands focus back to the field it came from.
    await user.click(within(screen.getByRole('dialog', { name: 'Location' })).getByRole('combobox', { name: /Province \/ City/, hidden: true }))
    const nested = await screen.findByRole('dialog', { name: 'Province / City' })
    await user.click(within(nested).getByRole('option', { name: 'Ha Noi' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Province / City' })).toBeNull())
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('combobox'))
    expect(document.activeElement?.textContent).toContain('Ha Noi')
  })

  it('Back closes the wizard’s sheet (it owns a history entry while open)', async () => {
    render(<Wizard mode="pick" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Set area' }))
    await screen.findByRole('dialog', { name: 'Location' })
    await waitFor(() => expect((window.history.state as Record<string, unknown> | null)?.enoOverlay).toBeTruthy())
    await act(async () => { window.history.back() })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Location' })).toBeNull())
  })
})

describe('Area panel · desktop', () => {
  it('both modes keep the anchored popover', async () => {
    render(<Wizard mode="pick" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Set area' }))
    const panel = await screen.findByRole('dialog', { name: 'Choose area' })
    expect(panel.closest('[data-slot="drawer-popup"]')).toBeNull()
  })
})
