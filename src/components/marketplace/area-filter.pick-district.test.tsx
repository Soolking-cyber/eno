// @vitest-environment jsdom
import * as React from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, getConfig, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CurrencyProvider } from '@/context/currency-context'
import { LanguageProvider } from '@/context/language-context'
import { installDrawerPolyfills, setViewport } from '@/test/drawer-env'
import { AreaFilter, type Geo } from './area-filter'
import { DISTRICTS_PROVINCE_CODE } from './listings-explorer.constants'

/**
 * THE IMPORT PICKER'S DISTRICT FIELD (owner, 2026-11-12, the Facebook import: "select from dropdown city ward or district").
 * `withDistrict` draws District between the city and the ward for a province whose wards come grouped under their old
 * district (HCMC); a district narrows the wards, a ward sets its district, and a district alone is a valid pick. The post
 * form's picker (no `withDistrict`) keeps city and ward only.
 */
const HCM: Geo = { code: DISTRICTS_PROVINCE_CODE, name: 'Thành phố Hồ Chí Minh', nameEn: 'Ho Chi Minh City' }
const WARDS = [
  { code: '27000', name: 'Phường Tân Thuận', nameEn: 'Tan Thuan Ward', group: 'Quận 7 (Phú Mỹ Hưng)', groupEn: 'District 7 (Phu My Hung)' },
  { code: '26800', name: 'Phường An Khánh', nameEn: 'An Khanh Ward', group: 'TP Thủ Đức', groupEn: 'Thu Duc City' },
  { code: '25750', name: 'Phường Thủ Dầu Một', nameEn: 'Thu Dau Mot Ward', group: 'Bình Dương (cũ)', groupEn: 'Former Binh Duong' },
]

const asyncUtilTimeout = getConfig().asyncUtilTimeout
beforeAll(() => { installDrawerPolyfills(); configure({ asyncUtilTimeout: 5_000 }) })
afterAll(() => { configure({ asyncUtilTimeout }) })
beforeEach(() => {
  setViewport('desktop')
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const body = String(url).includes('type=provinces') ? { provinces: [HCM] } : String(url).includes('type=wards') ? { wards: WARDS } : {}
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as unknown as Response)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
vi.setConfig({ testTimeout: 30_000 })

function renderPicker(over: Partial<React.ComponentProps<typeof AreaFilter>> = {}) {
  const onApply = vi.fn()
  render(
    <LanguageProvider>
      <CurrencyProvider>
        <AreaFilter mode="pick" hideLocate open onClose={vi.fn()} province={HCM} ward={null} nearby={null} onApply={onApply} onReset={vi.fn()} withDistrict {...over} />
      </CurrencyProvider>
    </LanguageProvider>,
  )
  return onApply
}
const field = (name: RegExp) => screen.findByRole('combobox', { name, hidden: true })
const pick = async (user: ReturnType<typeof userEvent.setup>, name: RegExp, option: string) => {
  await user.click(await field(name))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('the import picker’s District field', () => {
  it('a district alone is the pick: Apply gives it, with no ward', async () => {
    const user = userEvent.setup()
    const onApply = renderPicker()
    await pick(user, /^District/, 'District 7 (Phu My Hung)')
    await user.click(screen.getByRole('button', { name: /Apply/ }))
    // Filed by its plain name: the list's "(Phu My Hung)" note is for choosing, not for the listing.
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ province: expect.objectContaining({ code: DISTRICTS_PROVINCE_CODE }), ward: null, district: { code: '', name: 'Quận 7', nameEn: 'District 7' } }))
  })
  it('a district narrows the wards to its own', async () => {
    const user = userEvent.setup()
    renderPicker()
    await pick(user, /^District/, 'Thu Duc City')
    await user.click(await field(/Ward/))
    expect(await screen.findByRole('option', { name: 'An Khanh Ward' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Tan Thuan Ward' })).toBeNull()
  })
  it('"All districts" goes back to every ward (commit gate, opus)', async () => {
    const user = userEvent.setup()
    renderPicker()
    await pick(user, /^District/, 'Thu Duc City')
    await pick(user, /^District/, 'All districts')
    await user.click(await field(/Ward/))
    expect(await screen.findByRole('option', { name: 'Tan Thuan Ward' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Thu Dau Mot Ward' })).toBeTruthy()
  })
  it('"All districts" after a ward keeps the ward (commit gate, opus)', async () => {
    const user = userEvent.setup()
    const onApply = renderPicker()
    await pick(user, /Ward/, 'An Khanh Ward')
    await pick(user, /^District/, 'All districts')
    await user.click(screen.getByRole('button', { name: /Apply/ }))
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ ward: expect.objectContaining({ code: '26800' }) }))
  })
  it('a ward sets its district', async () => {
    const user = userEvent.setup()
    renderPicker()
    await pick(user, /Ward/, 'An Khanh Ward')
    await waitFor(async () => expect((await field(/^District/)).textContent).toContain('Thu Duc City'))
  })
  it('⛔ a "Former Binh Duong" heading is not offered as a district; its wards stay in the full list (commit gate, opus)', async () => {
    const user = userEvent.setup()
    const onApply = renderPicker()
    await user.click(await field(/^District/))
    expect(await screen.findByRole('option', { name: 'Thu Duc City' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Former Binh Duong' })).toBeNull()
    await user.keyboard('{Escape}')
    await pick(user, /Ward/, 'Thu Dau Mot Ward')
    await user.click(screen.getByRole('button', { name: /Apply/ }))
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ ward: expect.objectContaining({ code: '25750' }), district: null }))
  })
  it('⛔ Apply before the wards have loaded keeps the saved district (commit gate, codex)', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).includes('type=wards') ? new Promise(() => {}) : Promise.resolve({ ok: true, json: () => Promise.resolve({ provinces: [HCM] }) } as unknown as Response))))
    const user = userEvent.setup()
    const d7 = { code: '', name: 'Quận 7', nameEn: 'District 7' }
    const onApply = renderPicker({ districtValue: d7 })
    await user.click(await screen.findByRole('button', { name: /Apply/ }))
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ ward: null, district: d7 }))
  })
  it('⛔ reopened on a district picked alone, it shows that district and Apply keeps it (commit gate, codex + opus)', async () => {
    const user = userEvent.setup()
    const onApply = renderPicker({ districtValue: { code: '', name: 'Quận 7', nameEn: 'District 7' } })
    await waitFor(async () => expect((await field(/^District/)).textContent).toContain('District 7 (Phu My Hung)'))
    await user.click(await field(/Ward/))
    expect(await screen.findByRole('option', { name: 'Tan Thuan Ward' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /Apply/ }))
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ ward: null, district: { code: '', name: 'Quận 7', nameEn: 'District 7' } }))
  })
  it('the post form’s picker (no withDistrict) has no District field', async () => {
    renderPicker({ withDistrict: false })
    await field(/Ward/)
    expect(screen.queryByRole('combobox', { name: /^District/, hidden: true })).toBeNull()
  })
})
