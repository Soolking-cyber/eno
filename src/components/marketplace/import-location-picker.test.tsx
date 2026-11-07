// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
// The popover itself is the post form's, tested there; here only that the picker passes the place through.
const area = vi.hoisted(() => ({ props: null as null | { onApply: (a: { province: unknown; ward: unknown; nearby: unknown }) => void; nearby: unknown } }))
vi.mock('./area-filter', async (orig) => ({ ...(await orig<typeof import('./area-filter')>()), AreaFilter: (p: never) => { area.props = p; return null } }))
const { ImportLocationPicker } = await import('./import-location-picker')
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
vi.setConfig({ testTimeout: 30_000 })

const answers = (u: string) => {
  if (u.startsWith('/api/geocode/search')) return { results: [{ label: 'Song Hành, Phường An Khánh, Hồ Chí Minh', lat: 10.8016, lng: 106.7371 }] }
  if (u.startsWith('/api/reverse-geocode')) return { province: 'Hồ Chí Minh', ward: 'Phường An Khánh', wardCandidates: ['Phường An Khánh'] }
  if (u.includes('type=provinces')) return { provinces: [{ code: '79', name: 'Thành phố Hồ Chí Minh', nameEn: 'Ho Chi Minh City' }] }
  if (u.includes('type=wards')) return { wards: [{ code: '26800', name: 'Phường An Khánh', nameEn: 'An Khanh Ward' }] }
  return {}
}

// Owner, 2026-11-07: a city and ward picker, plus "auto finds when user types address on map the place, like … grab" (OpenStreetMap, on Enter).
describe('Import location picker', () => {
  it('⛔ nothing is searched while typing; Enter searches; picking a place sets the pin, then the city and ward from the map', async () => {
    const f = vi.fn(async (u: string) => new Response(JSON.stringify(answers(String(u)))))
    vi.stubGlobal('fetch', f)
    const onChange = vi.fn()
    render(<ImportLocationPicker value={{ province: null, ward: null, lat: null, lng: null }} onChange={onChange} />)
    const box = screen.getByRole('textbox', { name: 'Search an address' })
    fireEvent.change(box, { target: { value: 'Song Hành An Khánh' } })
    expect(f.mock.calls.some(([u]) => String(u).startsWith('/api/geocode/search'))).toBe(false)
    fireEvent.submit(box.closest('form')!)
    fireEvent.click(await screen.findByRole('button', { name: /Song Hành, Phường An Khánh/ }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ lat: 10.8016, lng: 106.7371, province: { code: '79', name: 'Thành phố Hồ Chí Minh', nameEn: 'Ho Chi Minh City' }, ward: { code: '26800', name: 'Phường An Khánh', nameEn: 'An Khanh Ward' } }))
    // ⛔ The new pin first empties the city and ward, so an old ward is never confirmed under it.
    expect(onChange.mock.calls[0][0]).toEqual({ lat: 10.8016, lng: 106.7371, province: null, ward: null })
  })
  it('nothing found says so and points at the city and ward picker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [] }))))
    render(<ImportLocationPicker value={{ province: null, ward: null, lat: null, lng: null }} onChange={vi.fn()} />)
    const box = screen.getByRole('textbox', { name: 'Search an address' })
    fireEvent.change(box, { target: { value: 'nowhere at all' } })
    fireEvent.submit(box.closest('form')!)
    expect(await screen.findByText(/No place found/)).toBeTruthy()
  })
  it('shows the chosen ward and city on the picker button', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
    render(<ImportLocationPicker value={{ province: { code: '79', name: 'Thành phố Hồ Chí Minh', nameEn: 'Ho Chi Minh City' }, ward: { code: '1', name: 'Phường An Khánh', nameEn: 'An Khanh Ward' }, lat: null, lng: null }} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'City and ward' }).textContent).toContain('An Khanh Ward, Ho Chi Minh City')
  })
  it('⛔ a ward picked by hand drops the old pin and gets one in that ward; the popover is never handed the old pin to give back', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => new Response(JSON.stringify(String(u).startsWith('/api/geocode/search') ? { results: [{ label: 'Thảo Điền', lat: 10.803, lng: 106.733 }] } : {}))))
    const onChange = vi.fn()
    const old = { province: { code: '79', name: 'Thành phố Hồ Chí Minh', nameEn: 'Ho Chi Minh City' }, ward: { code: '1', name: 'Phường An Khánh', nameEn: 'An Khanh' }, lat: 10.8016, lng: 106.7371 }
    render(<ImportLocationPicker value={old} onChange={onChange} />)
    expect(area.props!.nearby).toBeNull()
    const ward = { code: '2', name: 'Phường Thảo Điền', nameEn: 'Thao Dien' }
    area.props!.onApply({ province: old.province, ward, nearby: null })
    expect(onChange.mock.calls[0][0]).toEqual({ province: old.province, ward, lat: null, lng: null })
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ lat: 10.803, lng: 106.733 })))
  })
  it('a refused search says the search is busy, not that the place does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 })))
    render(<ImportLocationPicker value={{ province: null, ward: null, lat: null, lng: null }} onChange={vi.fn()} />)
    const box = screen.getByRole('textbox', { name: 'Search an address' })
    fireEvent.change(box, { target: { value: 'Thảo Điền' } })
    fireEvent.submit(box.closest('form')!)
    expect(await screen.findByText(/The search is busy/)).toBeTruthy()
    expect(screen.queryByText(/No place found/)).toBeNull()
  })
})
