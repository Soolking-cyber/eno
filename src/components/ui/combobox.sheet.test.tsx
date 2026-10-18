// @vitest-environment jsdom
/**
 * ui/combobox ON A PHONE (owner, 2026-10-18: "also mobile all dropdowns should be bottom up card style like the filter
 * card"). Below `sm` (useIsPhone's real gate through a matchMedia stub), a combobox WITH ROWS turns its page field into a
 * tap target and opens the list in the filter card, the search field on top — Base UI's inline "Combobox.Root > Dialog"
 * composition, mirroring the page root, so each caller's rules hold.
 *
 * Covered here with the two shapes the app has:
 *  · the CLOSED list (teacher form, closed-combobox.tsx — via the province picker): typing only filters, a row is the
 *    answer, Enter with no row moved to keeps the list open;
 *  · the CREATABLE field (post wizard Brand): the typed text IS the value, so closing the sheet must keep it (Base UI's
 *    end-of-close `input-clear` is not forwarded) and a pick replaces it; with no rows it stays a field you type in.
 * Desktop is the anchored popup, unchanged.
 */
import { useState } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, getConfig, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

import { __resetBackToCloseForTests } from '@/lib/back-to-close'
import { installDrawerPolyfills, setViewport } from '@/test/drawer-env'
import { ProvinceCombobox } from '@/components/teachers/province-combobox'
import {
  Combobox, ComboboxClear, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxList,
  ComboboxTrigger,
} from './combobox'

const asyncUtilTimeout = getConfig().asyncUtilTimeout
beforeAll(() => { installDrawerPolyfills(); configure({ asyncUtilTimeout: 5_000 }) })
afterAll(() => { configure({ asyncUtilTimeout }); vi.resetConfig() })
vi.setConfig({ testTimeout: 30_000 })
afterEach(() => {
  cleanup()
  __resetBackToCloseForTests()
  setViewport('desktop')
})

/** Visible labels, held in constants for the i18n lint. */
const [PROVINCE_LABEL, BRAND_LABEL, NOT_LISTED] = ['Which province?', 'Brand', 'Not in the list — we will use the name you typed.']

function Province() {
  const onPick = vi.fn()
  function Host() {
    const [v, setV] = useState('')
    return <><label htmlFor="p">{PROVINCE_LABEL}</label><ProvinceCombobox id="p" value={v} onPick={(k) => { onPick(k); if (k.startsWith('p-') || !k) setV(k) }} /></>
  }
  render(<Host />)
  return { onPick, field: () => screen.getByRole('combobox', { name: PROVINCE_LABEL, hidden: true }) as HTMLInputElement }
}

function Brand({ items = ['Honda', 'Yamaha', 'VinFast'] }: { items?: string[] }) {
  const [brand, setBrand] = useState('')
  return (
    <>
      <label htmlFor="pw-brand">{BRAND_LABEL}</label>
      <Combobox
        id="pw-brand"
        items={items}
        value={brand || null}
        inputValue={brand}
        onValueChange={(v) => setBrand(typeof v === 'string' ? v : '')}
        onInputValueChange={(v) => setBrand(v.slice(0, 40))}
        autoHighlight
      >
        <ComboboxInputGroup>
          <ComboboxInput placeholder="e.g. Honda" />
          <ComboboxClear aria-label="Clear brand" />
          <ComboboxTrigger aria-label="Open brand list" aria-labelledby={undefined} />
        </ComboboxInputGroup>
        <ComboboxContent>
          <ComboboxEmpty>{NOT_LISTED}</ComboboxEmpty>
          <ComboboxList>{(b: string) => <ComboboxItem key={b} value={b}>{b}</ComboboxItem>}</ComboboxList>
        </ComboboxContent>
      </Combobox>
      <output>{brand}</output>
    </>
  )
}
const brandField = () => screen.getByRole('combobox', { name: BRAND_LABEL, hidden: true }) as HTMLInputElement

describe('ui/combobox · phone sheet', () => {
  beforeEach(() => { setViewport('phone') })

  it('the closed list: the field is a tap target; the sheet is named by its label, its search field on top', async () => {
    const { field } = Province()
    expect(field().readOnly).toBe(true)
    const user = userEvent.setup()
    await user.click(field())
    const sheet = await screen.findByRole('dialog', { name: PROVINCE_LABEL })
    const search = within(sheet).getByRole('combobox', { name: PROVINCE_LABEL })
    const body = sheet.querySelector('[data-slot="picker-sheet-body"]')!
    expect(body.contains(search)).toBe(false)
    expect(body.contains(within(sheet).getByRole('listbox'))).toBe(true)
    expect(within(sheet).getAllByRole('option')[0].className).toContain('min-h-12')
  })

  it('the closed list: typing filters, a tap on a row is the answer, the sheet closes', async () => {
    const { field, onPick } = Province()
    const user = userEvent.setup()
    await user.click(field())
    const sheet = await screen.findByRole('dialog', { name: PROVINCE_LABEL })
    await user.type(within(sheet).getByRole('combobox', { name: PROVINCE_LABEL }), 'quy nhon')
    await user.click(await within(sheet).findByRole('option', { name: 'Quy Nhon → Gia Lai' }))
    expect(onPick).toHaveBeenLastCalledWith('p-52')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(field().value).toBe('Gia Lai'))
  })

  it('the closed list: Enter with no row moved to keeps the sheet open and commits nothing', async () => {
    const { field, onPick } = Province()
    const user = userEvent.setup()
    await user.click(field())
    const sheet = await screen.findByRole('dialog', { name: PROVINCE_LABEL })
    await user.type(within(sheet).getByRole('combobox', { name: PROVINCE_LABEL }), 'gia lai')
    expect(await within(sheet).findByRole('option', { name: 'Gia Lai' })).toBeTruthy()
    await user.keyboard('{Enter}')
    await new Promise((r) => setTimeout(r, 50))
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: PROVINCE_LABEL })).toBeTruthy()
  })

  it('the creatable field: typed text survives the close, and a tap on a row replaces it', async () => {
    render(<Brand />)
    const user = userEvent.setup()
    await user.click(brandField())
    let sheet = await screen.findByRole('dialog', { name: BRAND_LABEL })
    await user.type(within(sheet).getByRole('combobox', { name: BRAND_LABEL }), 'MyBrand')
    expect(within(sheet).getByText(NOT_LISTED)).toBeTruthy()
    await user.click(within(sheet).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Base UI clears an inline field at the end of the close; that clear must not wipe the answer.
    await new Promise((r) => setTimeout(r, 50))
    expect(document.querySelector('output')?.textContent).toBe('MyBrand')
    expect(brandField().value).toBe('MyBrand')
    await user.click(brandField())
    sheet = await screen.findByRole('dialog', { name: BRAND_LABEL })
    const search = within(sheet).getByRole('combobox', { name: BRAND_LABEL })
    await user.clear(search)
    await user.click(await within(sheet).findByRole('option', { name: 'Yamaha' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.querySelector('output')?.textContent).toBe('Yamaha')
  })

  it('the chevron opens the same sheet', async () => {
    render(<Brand />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open brand list', hidden: true }))
    expect(await screen.findByRole('dialog', { name: BRAND_LABEL })).toBeTruthy()
  })

  it('with no rows to offer, the field stays a field you type in', async () => {
    render(<Brand items={[]} />)
    expect(brandField().readOnly).toBe(false)
    await userEvent.setup().type(brandField(), 'Kawa')
    expect(document.querySelector('output')?.textContent).toBe('Kawa')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('ui/combobox · desktop', () => {
  it('the field is typed in and the list anchors under it, as ever', async () => {
    const { field, onPick } = Province()
    expect(field().readOnly).toBe(false)
    const user = userEvent.setup()
    await user.type(field(), 'quy nhon')
    await user.click(await screen.findByRole('option', { name: 'Quy Nhon → Gia Lai' }))
    expect(onPick).toHaveBeenLastCalledWith('p-52')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
