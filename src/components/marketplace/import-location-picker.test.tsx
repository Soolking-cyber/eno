// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
// The popover itself is the post form's, tested there; here only that the picker passes the place through.
const area = vi.hoisted(() => ({ props: null as null | { onApply: (a: { province: unknown; ward: unknown; nearby: unknown; district?: unknown }) => void; nearby: unknown; withDistrict?: boolean } }))
vi.mock('./area-filter', async (orig) => ({ ...(await orig<typeof import('./area-filter')>()), AreaFilter: (p: never) => { area.props = p; return null } }))
const { ImportLocationPicker } = await import('./import-location-picker')
type ImportPlace = import('./import-location-picker').ImportPlace
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
vi.setConfig({ testTimeout: 30_000 })

const answers = (u: string, suggest: unknown = { results: [], available: false }) => {
  if (u.startsWith('/api/geocode/suggest')) return suggest
  if (u.startsWith('/api/geocode/search')) return { results: [{ label: 'Song Hành, Phường An Khánh, Hồ Chí Minh', lat: 10.8016, lng: 106.7371 }] }
  if (u.startsWith('/api/reverse-geocode')) return { province: 'Hồ Chí Minh', ward: 'Phường An Khánh', wardCandidates: ['Phường An Khánh'] }
  if (u.includes('type=provinces')) return { provinces: [{ code: '79', name: 'Thành phố Hồ Chí Minh', nameEn: 'Ho Chi Minh City' }] }
  if (u.includes('type=wards')) return { wards: [{ code: '26800', name: 'Phường An Khánh', nameEn: 'An Khanh Ward' }] }
  return {}
}
const HCMC = { code: '79', name: 'Thành phố Hồ Chí Minh', nameEn: 'Ho Chi Minh City' }
const AN_KHANH = { code: '26800', name: 'Phường An Khánh', nameEn: 'An Khanh Ward' }
const EMPTY = { province: null, ward: null, lat: null, lng: null }
const MCD = { title: "McDonald's", detail: '159-161 Đường Võ Nguyên Giáp, An Khánh, Thành phố Thủ Đức', lat: 10.80244, lng: 106.74157 }
const asked = (f: ReturnType<typeof vi.fn>, path: string) => f.mock.calls.filter(([u]) => String(u).startsWith(path)).length
const box = () => screen.getByRole('combobox', { name: 'Search an address' })

// Owner, 2026-11-07: a city and ward picker, plus "auto finds when user types address on map the place, like … grab".
// Owner, 2026-11-12: suggestions WHILE typing ("macdonalds thao dien show exact address … like grab"), from eno's own
// OpenStreetMap server (api/geocode/suggest); Enter and Nominatim stay as the fallback when that server is down.
describe('Import location picker', () => {
  it('suggests places while typing; a pick fills the field, sets the pin, then the city and ward from the map — Nominatim never asked', async () => {
    const f = vi.fn(async (u: string) => new Response(JSON.stringify(answers(String(u), { results: [MCD], available: true }))))
    vi.stubGlobal('fetch', f)
    const onChange = vi.fn()
    render(<ImportLocationPicker value={EMPTY} onChange={onChange} />)
    fireEvent.change(box(), { target: { value: 'mcdonalds thao dien' } })
    fireEvent.click(await screen.findByRole('option', { name: /McDonald's.*Võ Nguyên Giáp/ }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ lat: 10.80244, lng: 106.74157, province: HCMC, ward: AN_KHANH, district: null }))
    // ⛔ The new pin first empties the city and ward, so an old ward is never confirmed under it.
    expect(onChange.mock.calls[0][0]).toEqual({ lat: 10.80244, lng: 106.74157, province: null, ward: null, district: null })
    expect((box() as HTMLInputElement).value).toBe("McDonald's, 159-161 Đường Võ Nguyên Giáp, An Khánh, Thành phố Thủ Đức")
    expect(asked(f, '/api/geocode/search')).toBe(0)
    // The picked text is the answer, not a new search.
    const before = asked(f, '/api/geocode/suggest')
    await new Promise((r) => setTimeout(r, 400))
    expect(asked(f, '/api/geocode/suggest')).toBe(before)
  })
  it('after a pick, new typing is kept when the field is left (the pick does not come back over it)', async () => {
    const f = vi.fn(async (u: string) => new Response(JSON.stringify(answers(String(u), { results: [MCD], available: true }))))
    vi.stubGlobal('fetch', f)
    render(<ImportLocationPicker value={EMPTY} onChange={vi.fn()} />)
    fireEvent.change(box(), { target: { value: 'mcdonalds thao dien' } })
    fireEvent.click(await screen.findByRole('option', { name: /McDonald's/ }))
    await waitFor(() => expect((box() as HTMLInputElement).value).toContain("McDonald's"))
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: 'Landmark 81' } })
    fireEvent.blur(box())
    await new Promise((r) => setTimeout(r, 50))
    expect((box() as HTMLInputElement).value).toBe('Landmark 81')
  })
  it('⛔ the same row picked again moves the pin back to it (commit gate, opus)', async () => {
    const f = vi.fn(async (u: string) => new Response(JSON.stringify(answers(String(u), { results: [MCD], available: true }))))
    vi.stubGlobal('fetch', f)
    const onChange = vi.fn()
    render(<ImportLocationPicker value={EMPTY} onChange={onChange} />)
    fireEvent.change(box(), { target: { value: 'mcdonalds' } })
    fireEvent.click(await screen.findByRole('option', { name: /McDonald's/ }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lat: MCD.lat })))
    const before = onChange.mock.calls.filter(([v]) => v.lat === MCD.lat).length
    fireEvent.change(box(), { target: { value: 'mcdonald' } })
    fireEvent.click(await screen.findByRole('option', { name: /McDonald's/ }))
    await waitFor(() => expect(onChange.mock.calls.filter(([v]) => v.lat === MCD.lat).length).toBeGreaterThan(before))
  })
  it('one request per pause, not one per key', async () => {
    const f = vi.fn(async (u: string) => new Response(JSON.stringify(answers(String(u), { results: [MCD], available: true }))))
    vi.stubGlobal('fetch', f)
    render(<ImportLocationPicker value={EMPTY} onChange={vi.fn()} />)
    for (const v of ['mcd', 'mcdo', 'mcdon', 'mcdona']) fireEvent.change(box(), { target: { value: v } })
    await screen.findByRole('option', { name: /McDonald's/ })
    expect(asked(f, '/api/geocode/suggest')).toBe(1)
    expect(String(f.mock.calls.find(([u]) => String(u).startsWith('/api/geocode/suggest'))![0])).toContain('q=mcdona')
  })
  it('⛔ the last query\'s rows go the moment the text changes: Enter never picks a place for words typed since', async () => {
    let answer: unknown = { results: [MCD], available: true }
    const f = vi.fn(async (u: string) => new Response(JSON.stringify(answers(String(u), answer))))
    vi.stubGlobal('fetch', f)
    const onChange = vi.fn()
    render(<ImportLocationPicker value={EMPTY} onChange={onChange} />)
    fireEvent.change(box(), { target: { value: 'mcdonalds' } })
    await screen.findByRole('option', { name: /McDonald's/ })
    answer = { results: [], available: true }
    fireEvent.change(box(), { target: { value: 'mcdonalds quan 1' } })
    expect(screen.queryByRole('option', { name: /McDonald's/ })).toBeNull()
    fireEvent.keyDown(box(), { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 50))
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ lat: MCD.lat }))
  })
  it('⛔ while eno\'s own search is down, the field says to press Enter, and Enter searches the old way (Nominatim)', async () => {
    const f = vi.fn(async (u: string) => new Response(JSON.stringify(answers(String(u)))))
    vi.stubGlobal('fetch', f)
    const onChange = vi.fn()
    render(<ImportLocationPicker value={EMPTY} onChange={onChange} />)
    fireEvent.change(box(), { target: { value: 'Song Hành An Khánh' } })
    await waitFor(() => expect(box().getAttribute('placeholder')).toBe('Type an address, then press Enter'))
    // The placeholder is hidden under the text: the Enter way is said under the field.
    expect(screen.getByText('Press Enter to search.')).toBeTruthy()
    expect(asked(f, '/api/geocode/search')).toBe(0)
    fireEvent.keyDown(box(), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('button', { name: /Song Hành, Phường An Khánh/ }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ lat: 10.8016, lng: 106.7371, province: HCMC, ward: AN_KHANH, district: null }))
  })
  it('nothing found by Enter says so and points at the city and ward picker', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => new Response(JSON.stringify(String(u).startsWith('/api/geocode/suggest') ? { results: [], available: false } : { results: [] }))))
    render(<ImportLocationPicker value={EMPTY} onChange={vi.fn()} />)
    fireEvent.change(box(), { target: { value: 'nowhere at all' } })
    await waitFor(() => expect(box().getAttribute('placeholder')).toBe('Type an address, then press Enter'))
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(await screen.findByText(/No place found/)).toBeTruthy()
  })
  it('shows the chosen ward and city on the picker button — or the district, picked with no ward', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
    render(<ImportLocationPicker value={{ province: HCMC, ward: { code: '1', name: 'Phường An Khánh', nameEn: 'An Khanh Ward' }, lat: null, lng: null }} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'City and ward' }).textContent).toContain('An Khanh Ward, Ho Chi Minh City')
    cleanup()
    render(<ImportLocationPicker value={{ province: HCMC, ward: null, district: { code: '', name: 'Quận 7', nameEn: 'District 7' }, lat: null, lng: null }} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'City and ward' }).textContent).toContain('District 7, Ho Chi Minh City')
  })
  it('⛔ a ward picked by hand drops the old pin and gets one in that ward; the popover is never handed the old pin to give back', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => new Response(JSON.stringify(String(u).startsWith('/api/geocode/search') ? { results: [{ label: 'Thảo Điền', lat: 10.803, lng: 106.733 }] } : {}))))
    const onChange = vi.fn()
    const old = { province: HCMC, ward: { code: '1', name: 'Phường An Khánh', nameEn: 'An Khanh' }, lat: 10.8016, lng: 106.7371 }
    render(<ImportLocationPicker value={old} onChange={onChange} />)
    expect(area.props!.nearby).toBeNull()
    const ward = { code: '2', name: 'Phường Thảo Điền', nameEn: 'Thao Dien' }
    area.props!.onApply({ province: old.province, ward, nearby: null, district: { code: '', name: 'TP Thủ Đức', nameEn: 'Thu Duc City' } })
    // With a ward, the district is implied: only the ward is the place.
    expect(onChange.mock.calls[0][0]).toEqual({ province: old.province, ward, district: null, lat: null, lng: null })
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ lat: 10.803, lng: 106.733 })))
  })
  it('a district picked with no ward is the place, and the pin goes to it (owner, 2026-11-12: "city ward or district")', async () => {
    const f = vi.fn(async (u: string) => new Response(JSON.stringify(String(u).startsWith('/api/geocode/search') ? { results: [{ label: 'Quận 7', lat: 10.734, lng: 106.722 }] } : {})))
    vi.stubGlobal('fetch', f)
    const seen: ImportPlace[] = []
    // The panel's own state: the pin's late answer lands on the place the seller just picked.
    function Panel() {
      const [v, setV] = useState<ImportPlace>(EMPTY)
      return <ImportLocationPicker value={v} onChange={(n) => { seen.push(n); setV(n) }} />
    }
    render(<Panel />)
    expect(area.props!.withDistrict).toBe(true)
    const d7 = { code: '', name: 'Quận 7', nameEn: 'District 7' }
    act(() => area.props!.onApply({ province: HCMC, ward: null, nearby: null, district: d7 }))
    expect(seen[0]).toEqual({ province: HCMC, ward: null, district: d7, lat: null, lng: null })
    await waitFor(() => expect(seen.at(-1)).toEqual({ province: HCMC, ward: null, district: d7, lat: 10.734, lng: 106.722 }))
    expect(String(f.mock.calls.find(([u]) => String(u).startsWith('/api/geocode/search'))![0])).toContain(encodeURIComponent('Quận 7, Thành phố Hồ Chí Minh'))
  })
  it('a refused Enter search says the search is busy, not that the place does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (String(u).startsWith('/api/geocode/suggest') ? new Response(JSON.stringify({ results: [], available: false })) : new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 }))))
    render(<ImportLocationPicker value={EMPTY} onChange={vi.fn()} />)
    fireEvent.change(box(), { target: { value: 'Thảo Điền' } })
    await waitFor(() => expect(box().getAttribute('placeholder')).toBe('Type an address, then press Enter'))
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(await screen.findByText(/The search is busy/)).toBeTruthy()
    expect(screen.queryByText(/No place found/)).toBeNull()
  })
})
